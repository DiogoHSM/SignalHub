# Decisions

## 2026-07-25: Event funnel keeps the auto actor-key fallback, computed entirely in SQL

Decision: `getEventFunnel` was rewritten as a single SQL aggregation (materialized CTE over matched step events plus one `LEFT JOIN LATERAL` per step, backed by a new `events(project_id, environment_id, name, timestamp DESC)` index) instead of pulling event rows into Node. The actor key stays the existing `coalesce(user_id, tenant_id, session_id, trace_id)` fallback ("auto" mode) rather than introducing a selectable `actor` param (`user|tenant|session|trace|auto`) in this pass.

Rationale: the actor-key change is orthogonal to the OOM/performance problem this rewrite solves, and changing it now would silently reprocess the semantics of every funnel already relied on by operators. A dedicated `actor` override is left for a future issue (also relevant to PER-440/PER-442, which reuse the same actor-key helper) so it can be designed and tested on its own.

## 2026-07-25: Anchor retention cohorts on first_seen_at and add a daily actor rollup

Decision: `GET /query/events/retention` now computes cohort × period retention entirely in SQL (a single CTE query), anchoring each actor's cohort on `user_profiles.first_seen_at` instead of the minimum `entry_event` timestamp observed inside the queried window. `entry_event` becomes an optional cohort eligibility filter rather than the cohort anchor, and `return_event` becomes optional (absent means any event counts as retained). Retention is scoped to actors with a `user_profiles` row; session/trace-only activity does not anchor a cohort. A new `event_actor_daily` table, maintained by a dedicated worker scheduler (`EVENT_ROLLUPS_*`), serves `range_days` queries that reach further back than `RETENTION_EVENTS_DAYS`, reported via a `source: "raw" | "rollup"` field.

Rationale: the previous implementation defined a cohort's start as the earliest `entry_event` inside the queried window, so an actor who existed long before the window but happened to re-fire the entry event inside it was miscounted as a brand-new cohort member — a real correctness bug for any product with recurring "start" events. Anchoring on `first_seen_at` fixes this at the cost of a documented, intentional behavior change: existing cohorts change size after deploy, since the anchor is now global (real first appearance) rather than local (first occurrence in-window). Materializing the retention window's events in Node also did not scale past a `LIMIT`-free full window scan; the CTE rewrite keeps aggregation in Postgres. The rollup table exists because raw `events` retention (default 90 days) would otherwise make long-range retention queries silently incomplete once raw rows are purged; `event_actor_daily` is not subject to raw event retention and survives the purge of the `events` rows it was built from.

## 2026-07-26: Segment definitions become a compiled boolean tree; v1 stays valid forever

Decision: `AnalyticsSegmentDefinition` becomes a union of the original flat single-condition shape (`v1`, no `version` field) and a new boolean tree shape (`v2`, `{ version: 2, window?, root }`) compiled to parameterized SQL by `packages/db/src/repositories/analytics-segment-compiler.ts`. Existing `v1` rows in `analytics_segments.definition` are never rewritten on disk; `upgradeDefinition()` converts them to the `v2` shape in memory on every read, including the `propertyName` without `propertyValue` case, which maps to an `exists` operator rather than `eq ""` to keep matching the exact same actors as before. Segment-scoped actor filtering across `telemetry-query.ts` (event list, session replay list, event paths) switched from executing a query, collecting actor ids into a Node array, and re-injecting them as `WHERE actor_id IN (...)`, to a single correlated `EXISTS`/count SQL predicate built by the compiler and passed straight into the outer query's `WHERE` clause.

Rationale: The flat one-condition shape could not express the "AND/OR/NOT across multiple event and trait conditions" segments operators were asking for, and materializing every matching actor id in Node before filtering another table does not scale and duplicates work the database already does better with a semi-join. Because segment operators, property/trait names, and values all come from the client (`POST /admin/analytics-segments`), the compiler treats SQL injection as the primary risk: operators are looked up only through a closed `Record<SegmentOperator, string>` map (an operator outside the map throws `segment_invalid_operator` and never reaches string concatenation), every name and value is passed through Kysely's `sql` template tag as a bind parameter (never as a raw identifier), and property/trait names are additionally checked against a strict charset regex as a second, redundant layer of defense. Structural limits (max depth 5, max 32 nodes, max 8 children per group) cap both planner blowup from deeply nested `EXISTS` chains and worst-case recursion over a corrupted or adversarial definition. Trait equality conditions compile to `jsonb` containment (`traits @> jsonb_build_object(...)`) specifically so they can use the new `user_profiles`/`tenant_profiles` GIN indexes (`0044_profile_traits_gin.sql`, `jsonb_path_ops`) — but that containment form only earns its keep for de-correlated, bulk trait lookups; the per-actor correlated `EXISTS` shape used inline in a segment filter typically resolves through the profiles table's primary key instead, since a single-row point lookup is cheaper than a GIN bitmap scan. `contains`/`gt`/`lt`/`neq` trait conditions fall back to an un-indexed `->>` comparison, which is an accepted, documented performance asymmetry rather than a gap to close in this change.

Keeping `v1` readable forever (instead of a one-time backfill migration) avoids a write-lock migration over `analytics_segments` and avoids any risk of silently changing which actors a saved segment matches for installations upgrading in place.

## 2026-07-25: Discontinue `AnalyticsDashboardsPanel` instead of porting it to v2

Decision: The v2 Events/Analytics workspace (PER-436) replaces `EventInvestigationPanel.tsx` with the `EventsScreen`/`AnalyticsScreen` v2 screens, but does **not** create a v2 equivalent for `AnalyticsDashboardsPanel.tsx`. `listAnalyticsDashboards`/`createAnalyticsDashboard`/`archiveAnalyticsDashboard`/`getDashboardReport` stay intact on the API client; the v1 component is removed together with the rest of the v1 shell in PER-438.

Rationale: `AnalyticsDashboardsPanel` has no widget editor — `createDashboard` always writes the fixed `starterWidgets` array, so a "custom dashboard" is really an immutable preset. Its `trend.*` widgets render only a summed total (`trendTotal`), a regression compared to the v2 `OverviewScreen`, which already plots `Bars`/`Sparkline` over the same data. Porting it properly would mean designing a real widget builder, which is product scope that belongs to PER-442 (saved trends/insights), not a like-for-like v1→v2 migration.

## 2026-07-02: Keep messaging campaigns native but measurement-first

Decision: SignalMonitor adds native message campaign definitions, campaign event measurement, and opt-out visibility, but does not yet send messages automatically from the scheduler/worker.

Rationale: Operators need one place to correlate product messaging with delivery, engagement, conversion, and privacy outcomes. Keeping the first native slice measurement-first avoids early lock-in to a specific ESP, webhook workflow, or in-app delivery runtime while still making campaigns observable and governable inside Sigmon.

## 2026-07-02: Scope data governance to project environments first

Decision: Data governance starts as a project/environment policy that stores per-category retention windows and JSON property mask/block rules. The worker applies property rules before persistence and retention applies scoped windows after the installation-level retention pass.

Rationale: SignalMonitor is self-hosted, so installation-level environment variables remain the hard maximum retention boundary. Project policies let operators shorten retention and suppress sensitive properties for individual monitored products without introducing a SaaS organization model or a full data catalog service.

## 2026-05-25: Publish the SDK on public npm

Decision: The JavaScript/TypeScript SDK is prepared for public npm publication as `@sigmon/sdk`, with GitHub Packages deferred as an optional mirror rather than the primary distribution channel.

Rationale: Public npm gives programmers and code agents the lowest-friction install path with normal `pnpm add @sigmon/sdk` behavior. GitHub Packages would require extra registry and token configuration in every consuming project, which would slow adoption.

Publishing uses npm Trusted Publishing through GitHub Actions OIDC instead of a long-lived `NPM_TOKEN`. This keeps release automation tied to repository workflow identity and avoids storing a broad npm publish secret in GitHub.

## 2026-05-24: Deploy only application services from GitHub Actions

Decision: GitHub Actions may trigger EasyPanel deploy hooks for the repository-built `api`, `worker`, and optional split `scheduler` services after the `main` CI gates pass. Postgres and Redis are excluded from repository-triggered deploy hooks.

Rationale: API, worker, and scheduler are stateless application services that should roll forward with repository builds. Postgres and Redis are stateful template services; redeploying them from GitHub would add unnecessary operational risk and does not correspond to a code build.

## 2026-05-19: Use SignalMonitor as the product identity

Decision: SignalMonitor is the current product identity. The project was formerly developed as SignalHub. The intended public website/domain is `sigmon.app`, and the intended deployed application host is `my.sigmon.app`.

Rationale: The Phase 6E rename gives the product a clearer monitoring-focused identity while preserving explicit historical context where useful. MicroERP remains Diogo's personal project and first real validation target, not part of the SignalMonitor product or repository.

## 2026-05-10: Store source maps locally and resolve stacks on demand

Decision: SignalMonitor supports source-map artifacts as a local-first admin workflow. The API stores uploaded `.map` files under `SOURCE_MAPS_LOCAL_DIR`, stores artifact metadata and cached resolved frames in Postgres, and resolves raw error stacks on demand.

Rationale: Self-hosted operators need production stack resolution without introducing SaaS dependencies or object storage as a first requirement. Strict project, environment, release, and minified-file matching avoids unsafe guessing. The console shows resolved frame metadata but not original source code or `sourcesContent`.

## 2026-05-10: Store grouped error workflow separately from raw occurrences

Decision: SignalMonitor adds an `error_groups` table for operational error triage while preserving immutable raw `errors` records linked by `error_group_id`.

Rationale: Operators need issue-level counts, status, regression, and prioritization without losing audit/debug access to every raw occurrence. Keeping the mutable workflow on groups avoids mutating individual occurrence history and keeps self-hosted storage simple.

## 2026-05-10: Add read-only operator diagnostics before release automation

Decision: SignalMonitor adds a read-only operator doctor command before introducing broader release automation.

Rationale: Phase 4D needs a repeatable install and release baseline that can identify configuration, placeholder secret, Compose, and health issues without mutating operator data or exposing secrets.

## 2026-05-02: Phase 2 SDK sends one request per signal

Decision: The first JavaScript SDK targets the existing single-signal ingestion endpoints and does not add batch ingestion.

Rationale: This keeps Phase 2 installable and compatible with the completed self-hosted core. Buffered client flush and bounded retries improve product integration without changing backend storage or queue contracts.

## Phase 1 Runtime Shape

Use Fastify API, Redis/BullMQ queueing, a worker process, and Postgres as the source of truth for Phase 1.

Rationale: this produces an installable telemetry foundation without adding ClickHouse, object storage, or SaaS platform complexity before the core ingestion contract is proven.

## API Keys

Ingestion uses bearer API keys scoped to one project and one environment. API keys are stored hashed and only the prefix is retained for lookup and operator identification.

Rationale: clients should not choose project or environment scope on each request, and leaked database records should not reveal usable ingestion secrets.

## Human Access

Use a bootstrap admin seed plus local email/password login for Phase 1. Admins manage installation resources; authenticated humans can query telemetry.

Rationale: the product needs real operator access but not a SaaS organization model or enterprise identity matrix yet.

## Sanitization Boundary

The worker recursively sanitizes sensitive values before typed persistence.

Rationale: queued ingestion payloads are accepted quickly, while persistence remains responsible for ensuring stored telemetry is safe for operator querying.

## Compose as Primary Install Path

Docker Compose is the supported production-oriented self-hosted installation path for this release line.

Rationale: the stack has only API, worker, Postgres, and Redis, and Compose gives operators a reproducible local/self-hosted deployment without extra infrastructure. Kubernetes, Helm, and systemd are deferred.

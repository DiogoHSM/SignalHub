# Decisions

## 2026-09-01: Human sessions are opaque and revocable; privileged integration secrets use a rotatable application keyring

Decision: password and Google OAuth login issue a random 32-byte opaque session token. The cookie contains only that token, while Postgres stores only its SHA-256 hash in `auth_sessions`. Active-session lookup requires an unexpired, unrevoked row joined to an unarchived user, and updates `last_seen_at` no more often than every fifteen minutes. Logout revokes the presented session before clearing its cookie; password changes and user archival revoke every session for that user in the same transaction as the user change. Expiry and revocation are enforced on every lookup. The repository exposes `pruneExpiredAuthSessions`, which deletes rows whose `expires_at` is at or before the pruning time, but no production scheduler or manual command calls it yet; physical pruning is not the authentication boundary. Legacy signed `payload.signature` cookies are deliberately rejected, so this upgrade invalidates all existing human sessions and requires a fresh login.

Decision: local password login has three independent admission controls. A login-specific source quota uses Fastify's trusted `request.ip`; a shared Redis account quota uses an HMAC-SHA-256 of the normalized email, keyed by `SESSION_SECRET`, so Redis never receives the email as the key; and a FIFO semaphore limits concurrent Argon2 verification. The account increment and first-write expiry are one atomic Redis operation. Schema-invalid or over-1,024-byte input returns `400`; a source or account quota rejection returns `429`; and unavailable or malformed quota state fails closed with `503 auth_unavailable`. Those outcomes happen before Argon2 and remain intentionally distinct. Only a schema-valid request admitted by both quotas reaches credential verification: missing, archived, and passwordless accounts verify one known valid dummy Argon2id hash, while wrong-password accounts verify their real hash; those invalid credentials receive a capped progressive delay and the same `401 invalid_credentials` response.

Decision: warehouse connection URLs and notification secret-header values are stored in a versioned AES-256-GCM envelope, `v1.<key-id>.<nonce>.<tag>.<ciphertext>`. The non-secret key id identifies a configured current or previous 32-byte key, and associated data binds every ciphertext to its table, row id, and field name. New writes always use `DATA_ENCRYPTION_KEY`; `DATA_ENCRYPTION_KEY_PREVIOUS` exists only for one-step reads and rewrapping during rotation. Production configuration fails before startup when the current key is absent or malformed. Unknown keys, tampered ciphertext, wrong associated data, and legacy plaintext all fail closed at privileged-use boundaries rather than falling back to plaintext.

Decision: migration `0050_encrypted_integration_secrets.sql` is additive for a staged release. It adds encrypted columns and a non-secret warehouse preview, makes the legacy warehouse plaintext column nullable, and leaves legacy plaintext columns present temporarily. The restartable `pnpm secrets:migrate` command locks and reclassifies each row in its own transaction, encrypts or rewraps it, decrypt-verifies the result, then atomically persists ciphertext and clears plaintext. It emits counts only. The plaintext columns are removed by a later release after migration is confirmed. Rotation is complete only after a confirmation run reports `{"migrated":0,"rotated":0}`; the previous key must remain provisioned until then.

Decision: generated ingestion API keys continue to use peppered SHA-256 rather than Argon2id. These keys are high-entropy machine-generated secrets, the pepper remains outside the database, and verification occurs on every ingestion request. Moving this hot path to Argon2 would require a verification cache and add bypass, eviction, and availability surfaces without the low-entropy benefit Argon2 provides. Human passwords remain Argon2id because they are user-chosen, lower-entropy credentials for which memory-hard offline-guessing resistance is material.

Operational consequence: encryption keys must be provisioned and backed up independently from database backups. Losing every key that can decrypt a row is not recoverable from ciphertext alone. Application rollback after plaintext has been cleared requires either the pre-upgrade database backup or an explicitly reviewed reverse data migration while the matching keyring is still available. The exact upgrade, rotation, and recovery procedures are maintained in `docs/SELF-HOSTING.md`; secret formats and custody rules are maintained in `.claude/docs/SECRETS.md`.

## 2026-09-01: Ingestion credentials are capability-scoped and privacy boundaries are enforced on the server

Decision: existing ingestion keys are treated as browser-capability keys after upgrade. They continue to submit ordinary telemetry, but they cannot call either identify endpoint; `POST /v1/identify/user` and `POST /v1/identify/tenant` require a server-capability key. URL query-value removal and MCP response privacy are server-side controls: feedback URLs are sanitized in ingestion, worker, read, and remediation paths, while MCP drops raw detail by default and redacts URL-like values even when a trusted process explicitly enables per-call raw detail.

Rationale: a legacy key can already exist in browser-delivered configuration, so preserving it as a server credential would leave durable profile mutation exposed to a public capability. Enforcing the boundary at the API rather than relying on SDK selection makes it apply equally to direct callers and old SDKs. Likewise, privacy must survive old queued payloads, stored legacy rows, direct API clients, and MCP clients; client-side conventions cannot cover those paths.

Migration and rollback: before deployment, inventory every server-side identify integration, create a server-capability key, place it only in server secret storage, and switch each integration to that key. Before and after every API deployment or rollback, run the three-path release smoke: browser-key identify must return `403 api_key_capability_forbidden`, server-key identify must return `202`, and browser-key ordinary telemetry must return `202`. The minimum safe API rollback target is a release containing both capability-aware key lookup and browser-key guards on both identify routes. Keeping the new server key in its integration is not sufficient protection against rolling the API back further, because other active browser/legacy keys would regain identify access. If no capability-enforcing artifact is available, externally block both identify routes and revoke every browser/legacy key before the rollback; keep server identify unavailable until the safe API is restored. A failed server integration may restore its previous secret reference only when that reference already points to a server-capability key; never reclassify or reuse an exposed legacy/browser key as a server credential. After deployment run `pnpm privacy:redact-feedback-urls` once against the production database and retain its scanned/updated log for the release record; reads remain sanitized until the backfill has completed. URL query-value redaction is intentionally irreversible, and MCP raw-detail exposure is rolled back by setting `MCP_ALLOW_RAW_DETAIL=false` and restarting the MCP process.

## 2026-08-28: `@sigmon/loadgen` is its own package, generates via one seeded timeline, sends only through the SDK's public client

Decision: synthetic telemetry generation lives in a new private package, `packages/loadgen`, not inside `apps/api`, the console, or an existing package. It ships a CLI (`sigmon-loadgen`) plus a standalone `sigmon-loadgen-fake-target` binary. Architecture is four isolated units: pure scenario-profile data (`ecommerce`/`fintech`/`saas-b2b`, each with a service dependency graph, baseline rates, and incident templates), a pure `generateTimeline()` that threads one `createRng(seed)` through every generator for reproducible output, an executor that dispatches through `@sigmon/sdk`'s public `SignalMonitorClient` — never the SDK's internal `retry.ts`/`sendSignal`, which isn't part of its public export surface — in two modes from one timeline (backfill fires immediately with a stamped past timestamp; live sleeps until the real scheduled time), and a fake-target HTTP server for simulating an HTTP monitor outage against a real Sigmon instance. The tool only ever reads pre-provisioned API keys and monitor secrets from a local `.loadgen.json` (gitignored); it never logs in as admin or auto-provisions anything.

Rationale: SignalMonitor had no way to generate realistic multi-service telemetry on demand, blocking demoing a fresh install, stress-testing the ingestion pipeline, and prototyping future console visualizations (PER-496 timeline/sequencer, PER-497 topology graph) against real multi-service data instead of one mostly-empty project. A declarative timeline (compute the full schedule first, then either replay it live or fire it all at once with historical timestamps) serves both the "populate days of history instantly" and "soak test for hours" use cases from one code path, rather than two.

Constraint found and fixed during the final whole-branch review, worth keeping visible: monitor-outage simulation only ever acts on incident windows in the run's live portion (`window.endMs > nowMs`) — Sigmon has no ingestion path for a historical monitor-check record, so a backfilled outage window is skipped, not attempted. The window-placement formula also has a known edge case (tracked as a PER-499 follow-up, not blocking): if a `--backfill`-only span is shorter than an incident template's duration, the window's `endMs` can still land past `nowMs` and block the process on an unrequested live outage — pick a `--backfill` window comfortably longer than the profile's longest incident duration until that's fixed.

Rejected: implementing `IncidentWindow` outage simulation as a general-purpose feature the executor validates on every send. Monitor outages are the only signal kind with a real-time-only ingestion path (no historical monitor-check record exists), so the live-only constraint is specific to that one code path, not a general rule the rest of the executor needs to enforce.

## 2026-08-26: Core relicensed from MIT to Elastic License 2.0; `@sigmon/sdk` stays MIT

Decision: the repository's root `LICENSE` is now the Elastic License 2.0 (verbatim SPDX text plus a copyright line). The `@sigmon/sdk` package keeps its own MIT license (`packages/sdk/LICENSE`, `"license": "MIT"` in its manifest) because it is embedded in customers' applications and must impose nothing on them.

Rationale: the owner wants the project fully open to download, read, use, modify, and self-host — including commercially, for products people monitor with it — but does not want third parties reselling SignalMonitor itself. ELv2 encodes exactly that boundary for this product category (its only substantive limitation is offering the software to third parties as a hosted or managed service, plus notice preservation), is widely understood, and has no time-based conversion clause. Copies already distributed under MIT remain MIT; the change applies from this commit forward. If the owner later wants to also forbid selling modified self-hosted forks (not only hosted services), PolyForm Shield 1.0.0 is the stricter candidate.

## 2026-08-26: `GET /` is a host-aware web entry point; app hosts skip `/console` typing

Decision: the API registers `GET /`. Hosts in `LANDING_HOSTS` (default `sigmon.app,www.sigmon.app`) get the static marketing landing page (`apps/api/src/landing/index.html`, served by `apps/api/src/routes/landing.ts`); all other hosts 302-redirect to `/console` when the console is enabled, and get the landing page when it is disabled. Both public domains can therefore point at the same Coolify service. The console SPA stays served under the `/console/` base path — the redirect, not a base-path change, is what makes `my.sigmon.app` open the console directly.

Rationale: serving the SPA at `/` would require changing the Vite base and router base while other work is in flight on the console; a redirect achieves the operator-visible goal (type `my.sigmon.app`, land in the console) with no console changes. Host-based branching keeps the landing page on the public domain without a second deployment or web server, and the landing route is exempted in `DOCS_INFRA_ROUTES` (like the docs UI) because it is web plumbing, not product API surface.

## 2026-08-25: Mobile gets its own status view instead of a responsive console shell

Decision: `/console/status` renders a separate, single-column `MobileStatusView` component chosen at the `App.tsx` root, not a responsive breakpoint added to `ConsoleShellV2`. It reuses the existing `useFleet` data and shows only a fleet status banner and a tap-to-expand project/environment list — no navigation, no mutations.

Rationale: the console shell (`.sh-v2 .app`) is a fixed 3-column desktop grid, and screens like Overview lean on inline fixed `gridTemplateColumns` (a 6-column KPI row, a 1.45fr/1fr split) rather than CSS classes a media query could target — confirmed broken at a 390px viewport (overlapping cards, no usable content) before this change. Making that shell responsive would mean auditing and reworking every screen's inline layout to survive narrow viewports, for a need that turned out to be much narrower: "is everything ok," not full investigation, from a phone. A small purpose-built view answers that directly without risking the desktop shell or committing to responsive-izing screens nobody asked to use on a phone.

## 2026-08-24: `@sigmon/mcp` is its own package, stdio-first, with response budgeting owned outside the API

Decision: MCP investigation tooling lives in a new private package, `packages/mcp`, not inside `apps/api` or the console. It ships nine read-only tools (`describe_scope`, `whats_broken`, `investigate_error`, `trace_request`, `slow_endpoints`, `user_journey`, `llm_costs`, `search_events`, `query`) over a stdio transport, authenticated with the read token from the 2026-08-23 decision below. `server.ts` registers tools independently of transport so a later HTTP/OAuth transport is a new file, not a rewrite. Response pruning and truncation (`budget.ts`) live in the MCP package, not the API — every list-shaped field is capped and has sensitive sub-fields (stack traces, raw event payloads, span bodies) dropped by default, with a `truncated` marker when a cap actually cut something, so a calling agent can tell a partial result from a complete one instead of inferring an empty environment from a truncated list.

Rejected: one tool per `/query/*` route (54 at the time of design). A 1:1 mirror degrades model tool choice — investigating one error is one conceptual action for an agent, not six route calls it has to sequence itself. Task-shaped tools (compose `investigate_error` from six routes internally) keep the tool surface small enough for a model to reliably pick the right one.

Rejected: reusing `apps/api`'s response shapes unpruned. A telemetry MCP's characteristic failure mode is a single tool call returning enough raw payload to blow an agent's context window before it can act on it — pruning has to be a contract every tool honors by construction, not something each tool author remembers to add, which is why it's a shared `budget.ts` module every tool routes list fields through rather than a per-tool convention.

Follow-up gap found during implementation: no `/query/*` route exposed a read-token principal's own `projectId`/`environmentId` back to the caller, which `describe_scope` needs. Added `GET /query/me` (IDs only, no name lookup) rather than inventing a client-side workaround — the guard (`requireQueryPrincipal`) already computes this on every request, it just never returned it.

## 2026-08-23: Read tokens are a new credential type that overrides scope instead of validating it

Decision: `/query/*` reads accept a new `shread_`-prefixed read token (table `read_tokens`, scoped to one project + environment, revocable) as an alternative to the human session cookie. When a read-token principal calls a read route, the token's stored project/environment **replaces** the caller's `project_id`/`environment_id` query parameters — it is never validated against them. The two fleet routes (`GET /query/fleet`, `GET /query/fleet/projects/:id/environments`) refuse a read-token principal with `403 read_token_scope_insufficient` rather than being scoped down, and every mutation under `/query/*` refuses one with `403 read_token_is_read_only`.

Rejected: reusing the session cookie for external tools. The cookie is stateless for 7 days with no revocation (see PER-473); an external agent holding it for that long with no way to cut it off is a worse exposure than a purpose-built credential, and the only realistic way to hand a non-human caller the same access would have been to put an admin's password into a local agent's config file.

Rejected: validating the token's scope against the request's `project_id`/`environment_id` instead of overriding them. Validation fails a mismatched request with an empty result, which a caller reads as "there is no data" — indistinguishable from an empty project. Overriding makes the scope a fact the caller cannot get wrong: a read token is *for* one project and environment, full stop, so there is nothing to validate.

Rejected: scoping the fleet routes down to the token's single project instead of refusing them. Fleet views are install-wide by construction — they summarize every project's health in one response — so "the token's scope" has no meaning there; scoping the response would silently return a fleet of one project under a route whose contract is "all projects," which is a worse lie than refusing outright.

## 2026-08-09: `pending` is a third state, not a failure

Decision: aggregates count a signal as failed only when `status = 'error'`. The previous `status <> 'success'` test is gone from all 15 sites in `packages/db/src/repositories/telemetry-query.ts` (APM endpoint rollups, service map, release health, operations summaries, LLM summaries, and the recent-failure lists). The ingestion schemas keep `pending` as a legitimate third status and their defaults are unchanged.

Rationale: `tracePayloadSchema` and `spanPayloadSchema` default `status` to `pending`, and the SDK's one-shot `trace()`/`span()` path sends that default (`packages/sdk/src/mapping.ts` uses `input.status ?? "pending"`). Reading "not success" as failure therefore counted every un-finalized trace as an error — anyone instrumenting with `signal.trace({ name, startedAt, durationMs })` saw their whole dashboard red. Only `startTrace().end()` escaped, because it defaults to `success`. Changing the schema defaults instead was rejected: a trace that never ended is not a success, and collapsing `pending` into either bucket loses the distinction the status field exists to carry. This lowers reported error rates on existing installs; that is the correction, not a regression.

## 2026-08-02: CI runs automatically; deploys stay manual

Decision: `.github/workflows/ci.yml` runs on every pull request to `main` and every push to `main`, in addition to `workflow_dispatch`. The deploy half of the 2026-07-26 decision is unchanged and still binding: production rolls forward only through a manual Coolify webhook or the panel, and no deploy job may be added to a workflow. `scripts/ci-workflow.test.ts` enforces both halves — the automatic triggers and the absence of any deploy step. This amends the CI half of "Move hosting to Coolify with manual-only CI and manual deploys" (2026-07-26).

Rationale: the manual-only CI policy was adopted alongside the local-first pipeline of a sibling private repository, where GitHub Actions minutes are billed and the CI/CD workflows cost roughly 296 minutes a month. This repository is public, so standard-runner minutes are free and unlimited — the policy carried the cost reasoning across without the cost. What it did carry was a real downside: the release gates only ran when someone remembered to run them, and nothing verified a merge to `main` before it became the deployable commit. Automating CI removes that gap at no cost. Deploys are a separate question and stay manual because the operator wants to choose when production rolls forward, which is the part of the 2026-07-26 decision that was actually about control rather than cost.

## 2026-07-26: Move hosting to Coolify with manual-only CI and manual deploys

**Amended 2026-08-02** by "CI runs automatically; deploys stay manual": the manual-only CI rule below no longer applies. The manual-deploy rule does.

Decision: Production hosting moved from EasyPanel to Coolify (project `sigmon`, environment `production`), with `api`, `worker`, and `scheduler` as separate Coolify applications built from the repository Dockerfile and Postgres/Redis as Coolify-managed database resources. GitHub Actions is manual-only (`workflow_dispatch`); the release gates run locally before every push, and production deploys are triggered manually through Coolify deploy webhooks (or the panel) after merging to `main`. Auto-deploy from CI is not to be recreated. This supersedes the 2026-05-24 decision "Deploy only application services from GitHub Actions".

Rationale: The hosting platform changed and the project adopted a local-first CI policy, so CI-triggered deploy hooks no longer match how releases actually ship. Manual webhook deploys keep the operator in control of when production rolls forward and remove the coupling between GitHub Actions availability and deployability. The stateful-services rule from the superseded decision is preserved: Postgres and Redis are never redeployed from repository builds.

## 2026-07-26: Statement timeout scoped to the API's request pool, not migrations or the worker

Decision: PER-449 adds a `statement_timeout` to the pg `Pool` created by `createDb` (`packages/db/src/client.ts`), applied per connection at startup. `apps/api/src/main.ts` now creates two pools: a short-lived, timeout-free `migrationDb` used only for `migrate()` and destroyed immediately after, and the long-lived `db` used for everything else, with `statement_timeout` set from `DB_STATEMENT_TIMEOUT_MS` (default 15000ms, 0 disables). `apps/worker/src/main.ts` uses its own env var, `DB_WORKER_STATEMENT_TIMEOUT_MS`, defaulting to 0 (disabled).

Rationale: the audit finding behind this change (`.claude/docs/AUDIT-2026-07-26/findings/PER-439.md`, F2) measured the event-funnel chain query going from 0.09s to 101.5s between 1k and 30k actors with no cap anywhere in the path — a single request from an authenticated human user, no elevated privilege required. A blanket timeout on the API's single pre-existing pool was rejected because that same pool runs `migrate()` at boot, and at least one existing migration (`0041_event_name_index.sql`, a `CREATE INDEX` without `CONCURRENTLY` on the high-volume `events` table) can legitimately take longer than any timeout tight enough to protect a read route. The worker runs long-lived jobs (rollups, retention, backups, source-map cleanup) that are expected to occasionally run long, so it keeps its own independent, disabled-by-default timeout rather than inheriting the API's.

## 2026-07-26: Funnel scope guard is a cheap pre-count, not a row cap on the chain itself

Decision: `getEventFunnel` (`packages/db/src/repositories/telemetry-query.ts`) now runs `assertFunnelScopeWithinLimit` before building the funnel chain: a single `count(DISTINCT actor_key)` scan over the exact same predicates as the `matched` CTE (factored into a shared `funnelMatchedWhere` helper so the two can never drift), compared against `FUNNEL_MAX_ACTORS` (default 50000, 0 disables). Exceeding the cap throws `FunnelScopeTooLargeError`, mapped by `apps/api/src/routes/query.ts` to `400 { error: "funnel_scope_too_large" }` instead of the route's default `503 query_unavailable`.

Rationale: the chain's cost is driven by distinct actors in scope (`|s0 actors| x steps x |matched|`, per F2), so a count of exactly that quantity is both a faithful predictor of cost and cheap to compute (single index-friendly scan, no `LATERAL` join, no materialization). This is preferred over a raw `LIMIT` on the `matched` CTE, which would silently truncate results instead of failing loudly, and over deferring the guard to `statement_timeout` alone, which still burns the configured timeout's worth of Postgres CPU on every oversized request instead of failing fast.

## 2026-07-25: Event funnel keeps the auto actor-key fallback, computed entirely in SQL

Decision: `getEventFunnel` was rewritten as a single SQL aggregation (materialized CTE over matched step events plus one `LEFT JOIN LATERAL` per step, backed by a new `events(project_id, environment_id, name, timestamp DESC)` index) instead of pulling event rows into Node. The actor key stays the existing `coalesce(user_id, tenant_id, session_id, trace_id)` fallback ("auto" mode) rather than introducing a selectable `actor` param (`user|tenant|session|trace|auto`) in this pass.

Rationale: the actor-key change is orthogonal to the OOM/performance problem this rewrite solves, and changing it now would silently reprocess the semantics of every funnel already relied on by operators. A dedicated `actor` override is left for a future issue (also relevant to PER-440/PER-442, which reuse the same actor-key helper) so it can be designed and tested on its own.

## 2026-07-25: Anchor retention cohorts on first_seen_at and add a daily actor rollup

Decision: `GET /query/events/retention` now computes cohort × period retention entirely in SQL (a single CTE query), anchoring each actor's cohort on `user_profiles.first_seen_at` instead of the minimum `entry_event` timestamp observed inside the queried window. `entry_event` becomes an optional cohort eligibility filter rather than the cohort anchor, and `return_event` becomes optional (absent means any event counts as retained). Retention is scoped to actors with a `user_profiles` row; session/trace-only activity does not anchor a cohort. A new `event_actor_daily` table, maintained by a dedicated worker scheduler (`EVENT_ROLLUPS_*`), serves `range_days` queries that reach further back than `RETENTION_EVENTS_DAYS`, reported via a `source: "raw" | "rollup"` field.

Rationale: the previous implementation defined a cohort's start as the earliest `entry_event` inside the queried window, so an actor who existed long before the window but happened to re-fire the entry event inside it was miscounted as a brand-new cohort member — a real correctness bug for any product with recurring "start" events. Anchoring on `first_seen_at` fixes this at the cost of a documented, intentional behavior change: existing cohorts change size after deploy, since the anchor is now global (real first appearance) rather than local (first occurrence in-window). Materializing the retention window's events in Node also did not scale past a `LIMIT`-free full window scan; the CTE rewrite keeps aggregation in Postgres. The rollup table exists because raw `events` retention (default 90 days) would otherwise make long-range retention queries silently incomplete once raw rows are purged; `event_actor_daily` is not subject to raw event retention and survives the purge of the `events` rows it was built from.

**2026-07-26 appendix (PER-451):** the rollup path above did not actually survive the purge it was built for. The `entry_event` eligibility check always queried raw `events`, so once raw rows for a cohort's period aged past `RETENTION_EVENTS_DAYS` (the same horizon that flips a query into `source: "rollup"` in the first place), a long-range query with `entry_event` set would find nothing there and collapse old cohorts toward zero entrants — the exact failure mode this rollup was supposed to prevent. Separately, the `activity` CTE in rollup mode read only `event_actor_daily`, which the worker (`apps/worker/src/event-rollups.ts`) never populates for the current UTC day, so the most recent bucket of any rollup-mode query silently undercounted actual retention. Both paths are now rollup-aware: eligibility resolves against `event_actor_daily` (its primary key already carries `event_name`), and both eligibility and the `activity` CTE additionally UNION in a raw-`events` tail scoped to today (deduped by actor/day) to cover activity the nightly rollup hasn't processed yet. Because this closes real undercounting, retention numbers for long-range (`rollup`-sourced) queries with `entry_event` set can shift upward after this fix — this is a correction, not a new regression.

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

## 2026-07-30: Use promoted properties and hybrid rollups for saved trends

Decision: Saved event trends are persisted as bounded definitions, not SQL. Property breakdowns require a project/environment-scoped promoted-property record and expression index. Count trends may combine completed hourly rollups with a raw recent tail, while filtered queries and exact unique actors retain a raw-data correctness path. Dashboard widgets reference insight ids and resolve them inside the dashboard scope.

Rationale: Arbitrary JSON-property breakdowns over the full event table make dashboard latency and storage cost unpredictable. Explicit promotion makes the performance decision visible and reversible while preserving safe ad-hoc property filters. The hybrid policy keeps recent and late-arriving data correct without giving up the lower-cost historical count path. Referencing an insight avoids silently diverging copies of the same product metric across dashboards.

## 2026-05-24: Deploy only application services from GitHub Actions (superseded 2026-07-26)

Superseded by "Move hosting to Coolify with manual-only CI and manual deploys" (2026-07-26). Kept for historical context.

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

# Architecture

SignalMonitor is a self-hosted operational core with five runtime components:

- Fastify API service.
- Queue worker service.
- Scheduler worker service.
- Postgres.
- Redis with BullMQ.

## Request Paths

Ingestion:

1. Client calls `POST /v1/events`, `/v1/errors`, `/v1/breadcrumbs`, `/v1/clicks`, `/v1/replays`, `/v1/surveys/responses`, `/v1/feedback`, `/v1/llm`, `/v1/web-vitals`, `/v1/profiles`, `/v1/traces`, or `/v1/spans`.
2. API extracts the bearer API key and verifies the stored hash with `API_KEY_PEPPER`.
3. API validates the JSON payload with Zod.
4. API generates a signal id, attaches project and environment scope from the API key, enqueues the job, and returns `202 Accepted`.
5. Worker consumes the job, validates again, recursively sanitizes sensitive values, and writes the typed record into Postgres.

Telemetry queue jobs use deterministic IDs derived from the payload IDs. The worker writes telemetry through idempotent repository paths so duplicate queue delivery or retry attempts do not create duplicate telemetry rows.

Project data governance policies are loaded by the worker per project/environment before persistence. Policy rules can mask or block configured JSON paths in shared metadata, event properties, error context, span input/output/error, breadcrumb data, replay event data, and identity traits; built-in secret redaction still runs after policy application.

Identify:

1. SDKs or raw clients call `POST /v1/identify/user` or `POST /v1/identify/tenant`.
2. API authenticates the same project/environment ingestion API key used for telemetry.
3. API validates the identify payload, applies project data-governance rules to `identity.traits`, sanitizes traits, and upserts the scoped profile row directly. New identify traits shallow-merge into existing stored traits.
4. Identify request `metadata` is accepted for envelope compatibility, but this MVP does not persist it in profile rows. Persisted profile data is `traits` plus project, environment, user/tenant IDs, timestamps, and optional user tenant linkage.

Telemetry rows that contain `user_id` or `tenant_id` update profile `last_seen_at` timestamps for the same project/environment scope. They do not overwrite profile traits; only explicit identify calls update traits.

Human operations:

1. Admin seed creates the first admin user.
2. Humans log in through `/auth/login` and receive a signed cookie.
3. Admin-only routes manage users, projects, environments, project browser origins, and API keys.
4. Authenticated users can query raw telemetry and aggregates.

Browser ingestion CORS is limited to public `/v1/*` ingestion paths. The API allows an origin when it is either present in the optional global `BROWSER_CORS_ORIGINS` allowlist or stored as an active project browser origin. Project browser origins are normalized to exact `URL.origin` values before storage.

Production human sessions use `__Host-sigmon_session` with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`. The OAuth state cookie remains `sigmon_oauth_state` because it is intentionally scoped to `/auth/google/callback`, which is incompatible with the `__Host-` prefix.

## Storage

Operational tables:

- `users`
- `projects`
- `project_browser_origins`
- `environments`
- `api_keys`
- `system_heartbeats`
- `retention_runs`
- `backup_runs`
- `notification_channels`
- `alert_rules`
- `alert_events`
- `notification_deliveries`
- `monitors`
- `monitor_checks`
- `analytics_segments`
- `analytics_dashboards`
- `experiments`
- `surveys`
- `message_campaigns`
- `message_campaign_events`
- `message_campaign_opt_outs`
- `feedback_widget_settings`
- `feedback_items`
- `data_governance_policies`
- `warehouse_destinations`
- `warehouse_export_runs`
- `project_code_integrations`
- `incident_external_links`
- `release_metadata`
- `source_map_artifacts`
- `source_map_upload_tokens`
- `error_stack_resolutions`

Telemetry tables:

- `events`
- `error_groups`
- `errors`
- `breadcrumbs`
- `llm_calls`
- `web_vitals`
- `traces`
- `spans`
- `survey_responses`

Profile tables:

- `user_profiles`
- `tenant_profiles`

All telemetry records include project, environment, optional tenant/user/session/trace identifiers, timestamps, source, release, and metadata.
Errors are stored as immutable raw occurrences and are attached to operational `error_groups` through deterministic grouping fingerprints. `error_groups.priority` stores an optional operator priority override (`urgent`, `high`, `normal`, or `low`) separately from derived severity and workflow status.

`user_profiles` and `tenant_profiles` are scoped by project and environment so the same end-user or tenant identifier can have different traits in different monitored products or deployment environments. Traits are recursively sanitized before storage. The profile rows store sanitized traits, first/last seen timestamps, update timestamps, and identifiers; identify envelope metadata is intentionally not stored in this MVP.

Source-map artifacts are admin-uploaded metadata rows scoped to project, environment, release, and minified filename. The source-map files themselves live on the API filesystem under `SOURCE_MAPS_LOCAL_DIR`; Postgres stores metadata and cached resolved stack-frame locations only.

Source-map CI uploads use dedicated `source_map_upload_tokens`, not ingestion API keys. Admins create and revoke these tokens from the Artifacts console. `POST /v1/source-maps` authenticates a token, enforces its project/environment scope, and writes artifacts through the existing local source-map storage service with token attribution.

Archived projects and environments are inactive scopes. Ingestion API key verification, identify writes, source-map token creation, source-map uploads, source-map resolution reads, and worker telemetry writes all require an active project/environment pair. This protects already-queued telemetry jobs from writing into archived scopes after an operator archives a project or environment.

Breadcrumbs are stored in the `breadcrumbs` telemetry table. They use the same project, environment, tenant, user, session, trace, source, release, timestamp, received_at, and metadata envelope as other telemetry signals. The API accepts `POST /v1/breadcrumbs`, the worker persists sanitized rows, and `GET /query/sessions/:sessionId/timeline` returns a mixed session timeline across breadcrumbs, events, errors, traces, and LLM calls.

Opt-in browser click maps are stored in the `click_events` telemetry table. `POST /v1/clicks` accepts normalized viewport coordinates, viewport dimensions, route, safe selector, and optional element tag/role metadata. The browser SDK helper avoids text, values, DOM snapshots, screenshots, and form fields by design. `GET /query/events/click-map` aggregates click density by route, safe selector, and bounded grid bucket for Events investigation. `click_events` expires with the events retention window.

Privacy-safe browser replays are stored in the `session_replays` telemetry table. `POST /v1/replays` accepts a masked interaction timeline keyed by `replay_id`; errors and product events can include the same `replay_id`. Incident detail returns linked replay context for errors, `GET /query/replays/:replayId` returns the replay plus linked product-event markers for event investigation, and `GET /query/replays` lists replay samples filtered by saved segment, tenant, user, and event name. The v2 incident view carries the primary occurrence timestamp into the replay panel so the UI can compute and highlight the error offset while keeping stack and breadcrumb context beside the masked timeline. Replay payloads store route, safe selectors, normalized click coordinates, sanitized messages, and bounded event data only. They do not store screenshots, DOM snapshots, raw text, input values, passwords, cookies, or HTML. `session_replays` expires with the events retention window and is counted with deleted events.

Web Vitals are stored in the `web_vitals` telemetry table. Browser SDK helpers send LCP, INP, CLS, FCP, FID, and TTFB samples through `POST /v1/web-vitals` with route, navigation type, rating, release, and the shared telemetry envelope. `GET /query/apm/web-vitals` aggregates p75 values by metric and route, rating counts, latest/previous release p75 values, and regression percentage for the Traces/APM workspace.

Runtime profiles are stored in the `profiles` telemetry table. Node SDK helpers send bounded opt-in CPU and memory snapshots through `POST /v1/profiles`; custom runtimes can use the same REST contract directly. `GET /query/apm/profiles` aggregates CPU profile count, memory profile count, average duration, latest memory usage, recent profiles, and hot functions for the Traces/APM workspace. Profiles are designed for targeted investigations rather than always-on raw profiler dumps.

Feedback widget settings are stored per project/environment in `feedback_widget_settings`; submissions are stored in `feedback_items`. `POST /v1/feedback` accepts short browser-safe user feedback with optional category, page URL, path, user agent, identifiers, and metadata. The JavaScript SDK exposes `installFeedbackWidget()` for a lightweight textual widget, while screenshot capture remains intentionally disabled until masking and explicit consent controls exist. Operators configure copy/enablement and triage open/reviewed/archived submissions from Project Settings.

NPS tracking reuses the existing `surveys` and `survey_responses` tables. A standard NPS campaign is a survey with a 0-10 `nps` rating question and optional text comment. `GET /query/surveys/:id/nps` calculates score, promoter/passive/detractor counts, daily trend buckets, and tenant/release/plan segments from stored survey responses.

## API Surface

Health:

- `GET /health`
- `GET /ready`
- `GET /system/health`
- `POST /system/actions/doctor`
- `POST /system/actions/backup`
- `POST /system/actions/retention`

Auth:

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /auth/google`
- `GET /auth/google/callback` when Google OAuth is enabled. Google sign-in only links and logs in existing local users with verified Google email addresses.

Admin:

- `/admin/users`
- `/admin/projects`
- `/admin/projects/:projectId/environments`
- `/admin/projects/:projectId/api-keys`
- `/admin/environments/:id`
- `/admin/api-keys/:id`
- `/admin/notification-channels`
- `/admin/alert-rules`
- `/admin/monitors`
- `/admin/monitors/http`
- `/admin/monitors/heartbeat`
- `/admin/monitors/:id`
- `/admin/monitors/:id/checks`
- `/admin/analytics-segments`
- `/admin/analytics-segments/:id`
- `/admin/analytics-segments/:id/preview`
- `/admin/analytics-dashboards`
- `/admin/analytics-dashboards/:id`
- `/admin/surveys`
- `/admin/surveys/:id`
- `/admin/message-campaigns`
- `/admin/message-campaigns/:id`
- `/admin/feedback-widget`
- `/admin/data-governance`
- `/admin/warehouse-destinations`
- `/admin/warehouse-destinations/:id`
- `/admin/warehouse-destinations/:id/runs`
- `/admin/projects/:projectId/code-integrations`
- `/admin/projects/:projectId/code-integrations/:id`
- `/admin/projects/:projectId/release-metadata`
- `/admin/source-maps`
- `/admin/source-map-upload-tokens`

Ingestion:

- `POST /v1/events`
- `POST /v1/errors`
- `POST /v1/breadcrumbs`
- `POST /v1/clicks`
- `POST /v1/replays`
- `POST /v1/surveys/responses`
- `POST /v1/feedback`
- `POST /v1/identify/user`
- `POST /v1/identify/tenant`
- `POST /v1/llm`
- `POST /v1/web-vitals`
- `POST /v1/heartbeats/:id`
- `POST /v1/source-maps`
- `POST /v1/traces`
- `POST /v1/spans`

Query:

- `GET /query/events`
- `GET /query/replays`
- `GET /query/replays/:replayId`
- `GET /query/errors`
- `GET /query/error-groups`
- `GET /query/error-groups/:id`
- `GET /query/error-groups/:id/errors`
- `PATCH /query/error-groups/:id`
- `GET /query/incidents/error-groups/:id`
- `POST /query/incidents/error-groups/:id/external-issues`
- `POST /query/incidents/error-groups/:id/external-issues/draft`
- `GET /query/errors/:id/source-map-resolution`
- `GET /query/sessions/:sessionId/timeline`
- `GET /query/llm-calls`
- `GET /query/traces`
- `GET /query/traces/:id/spans`
- `GET /query/entities/tenants`
- `GET /query/entities/tenants/:tenantKey`
- `GET /query/users`
- `GET /query/users/:userKey`
- `GET /query/overview`
- `GET /query/recent-activity`
- `GET /query/reports/dashboards/:id`
- `GET /query/surveys/:id/results`
- `GET /query/surveys/:id/nps`
- `GET /query/message-campaigns/:id/results`
- `GET /query/feedback`
- `PATCH /query/feedback/:id`
- `GET /query/operations`
- `GET /query/apm/endpoints`
- `GET /query/apm/service-map`
- `GET /query/apm/web-vitals`
- `GET /query/aggregates/events`
- `GET /query/aggregates/errors`
- `GET /query/aggregates/llm`
- `GET /query/aggregates/traces`

Alerts:

- `GET /alerts/events`
- `GET /alerts/events/:id`
- `GET /alerts/suggestions`

## Deferred Boundaries

ClickHouse, object storage, stored log telemetry, SaaS workspace scope, and billing are intentionally deferred. Internal boundaries remain narrow enough to add those later without changing the ingestion contracts.

## Integration Console

`apps/console` contains the Vite + React + TypeScript browser console.

The API exposes `GET /console/config` for non-secret browser configuration and serves built console assets from `/console` in production. The console uses existing session authentication, admin routes, and query routes.

## Operational Safety

The background worker can run as a queue worker, scheduler, or combined process through `WORKER_ROLE`. Queue liveness is recorded in `system_heartbeats` as `worker`; scheduler liveness is recorded separately as `scheduler`, so split deployments can be diagnosed independently from the console `System` mode.

The scheduler role owns the retention scheduler. When `RETENTION_ENABLED=true`, it periodically deletes old telemetry from `events`, `click_events`, `session_replays`, `errors`, `traces`, `spans`, `llm_calls`, `web_vitals`, `profiles`, and `breadcrumbs`, and expires old `dead_letter_jobs` using configured retention windows and bounded batches. Project data governance policies can define shorter per-project/environment retention windows by category; these scoped windows run after the installation-level retention pass. `click_events` and `session_replays` use the events retention window by default and are counted with deleted events. Retention run outcomes are recorded in `retention_runs`, including `deleted_web_vitals`, `deleted_profiles`, and `deleted_dead_letter_jobs` counts.

The scheduler role also owns the event rollup job. When `EVENT_ROLLUPS_ENABLED=true`, it maintains a per-day, per-actor, per-event-name rollup in `event_actor_daily` so long-range retention queries stay fast without materializing raw events. Progress is tracked by a generic `event_rollup_state` watermark table (keyed by project, environment, and rollup name; the actor-daily rollup uses a sentinel global scope since it processes every project/environment in one pass). The job always reprocesses the trailing two days to absorb late-arriving telemetry, upserts are idempotent (`events` is overwritten, not incremented), and `EVENT_ROLLUPS_LOOKBACK_DAYS` (default 400, intentionally longer than the default raw event retention window) bounds first-run backfill. The rollup table is not subject to raw event retention deletion, so it outlives the purged raw `events` rows it was built from.

The scheduler role also owns warehouse exports. Project/environment-scoped `warehouse_destinations` select datasets and store durable per-dataset cursors. Export runs write into the external Postgres landing table `sigmon_telemetry_export` with idempotent upserts by dataset and source id, and each attempt is recorded in `warehouse_export_runs` for operator audit and retry visibility.

Project code hosting metadata lives in `project_code_integrations`, `incident_external_links`, and `release_metadata`. Integrations are project-scoped, tokenless GitHub/GitLab repository references in this slice: SignalMonitor can build issue-draft URLs and link incidents to external issues, but it does not store code-hosting access tokens or mutate repositories directly. Release metadata enriches Overview release rows with commit, pull request, and deployed-by context.

The worker also prunes local source-map artifacts when source-map retention is enabled. Source-map cleanup is reported through the existing retention run status path and removes local files, artifact metadata, and cached stack resolutions. File cleanup runs outside the telemetry deletion transaction so permanent filesystem side effects are not coupled to telemetry rollback behavior.

The worker owns the backup scheduler. When `BACKUPS_ENABLED=true`, it creates scheduled Postgres logical backups with `pg_dump` custom format and writes them to `BACKUPS_LOCAL_DIR`. The `backup_runs` table stores backup metadata only: run status, trigger, filename, byte size, optional S3 bucket/key, timestamps, and sanitized error text. Backup dump contents are stored on the configured filesystem path and optional S3-compatible bucket, not in Postgres metadata tables.

The scheduler role owns simple alert scheduling and monitor evaluation. When `ALERTS_ENABLED=true`, it evaluates enabled project/environment-scoped `alert_rules` under an advisory lock, records triggered `alert_events`, and sends optional webhook or email notifications through `notification_channels`. Error-derived rules also return the dominant triggering `error_group_id`; if that incident group is silenced, the scheduler records evaluation time but suppresses the alert event and notification. Alert rules can also define an optional escalation channel and delay; triggered alert events receive an `escalation_due_at` timestamp, and the scheduler sends one escalation delivery if the event is still triggered when due. Acknowledged, snoozed, and resolved alert events suppress escalation. Webhook and email delivery outcomes are stored in `notification_deliveries`.

HTTP and heartbeat monitors live in `monitors`; individual probe and check-in history lives in `monitor_checks`. Admin monitor routes create and manage monitor definitions. Heartbeat monitors return a one-time `shhb_...` secret on creation; only the hash is stored, and `POST /v1/heartbeats/:id` verifies the bearer secret before recording a successful check-in. Monitor down/recovery events are represented as `alert_events` with `monitor_id` set.

Generic webhook notification URLs are validated through the shared network-safety boundary in `packages/config`. Targets resolving to local, private, link-local, multicast, loopback, or cloud metadata networks are rejected in every environment. Production webhook delivery fetches the validated resolved address to avoid DNS rebinding after preflight. Alert webhook delivery is bounded by `ALERTS_WEBHOOK_TIMEOUT_MS` and retries transient request failures, timeouts, rate limits, and 5xx responses with a short bounded backoff. Invalid URLs, unsafe targets, permanent DNS failures, redirects, and non-retryable 4xx responses fail fast and are recorded once as final delivery failures.

API and worker processes use structured logs with secret-bearing fields redacted. The API global error handler logs redacted errors and returns sanitized JSON. API startup failures run cleanup after logging, and API/worker shutdown paths are ordered and bounded.

Backups write SHA-256 sidecar files next to local dump files and upload matching sidecars when S3-compatible upload is enabled. Restore verifies the sidecar when present before running `pg_restore`.

Failed backup dumps are cleaned up before the failed run is recorded. S3-compatible backup upload retries are limited to retryable transport, timeout, rate-limit, and server-side failures, with a short bounded backoff; permanent client/auth failures are not retried. Google OAuth token/userinfo fetches and the source-map upload CLI also use explicit request timeouts so operator-facing network workflows do not hang indefinitely.

Worker jobs that permanently fail are copied into `dead_letter_jobs` with sanitized payload and error details. New telemetry dead-letter rows preserve project and environment scope from the failed job envelope when available; legacy or non-telemetry rows can remain unscoped for backward compatibility. Admin APIs expose list, queue/job/error text/creation-window filters, detail, action-history, delete, and replay workflows for these rows. Active dead-letter rows are treated as `pending`; replay/delete/expiration state is preserved in the action history. Replay is limited to telemetry queue payloads, validates the outer job envelope and the kind-specific telemetry payload, enqueues with a fresh replay-scoped BullMQ job id, and deletes the dead-letter row only after enqueue succeeds. Delete and replay cleanup run through a transaction that records the acting admin in `dead_letter_job_actions`, while the original telemetry id is preserved so repository-level idempotency still prevents duplicate persisted telemetry. Scheduled retention expires old dead-letter rows after `RETENTION_DEAD_LETTER_JOBS_DAYS` and records a retained `expired` action for each removed row.

Alert rules include a `dead_letter_count` rule type for project/environment-scoped DLQ backlog. Its observed value is the current count of pending scoped dead-letter jobs for the rule environment rather than a time-windowed telemetry rate.

The Docker runtime runs under the non-root `sigmon` user with `tini` as PID 1. Docker Compose defines healthchecks for Postgres, Redis, API, and worker.

API responses include baseline HTTP security headers: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Content-Security-Policy`, and production `Strict-Transport-Security`.

`GET /system/health` is a logged-in system snapshot for the console. It reports API, worker, Postgres, Redis, telemetry queue counts, dead-letter count, ingestion freshness, retention policy/run status, and backup status. A nonzero dead-letter count marks the queue and overall system as degraded so operators see permanently failed jobs without opening the admin API first.

The System console exposes admin-only manual actions backed by `POST /system/actions/doctor`, `POST /system/actions/backup`, and `POST /system/actions/retention`. Doctor is read-only and summarizes the current health snapshot. Backup reuses the worker backup runner with a manual trigger. Retention reuses the scheduler retention runner and is treated as a destructive operator action because it deletes expired telemetry and retention-managed artifacts.

## Investigation Console

The console includes a read-only `Investigate` mode for Events. It uses the existing human-session query route `GET /query/events` and keeps project/environment scope tied to the active console selection.

The Events query supports exact `event_name` filtering in addition to project, environment, tenant, user, session, trace, date range, and limit filters. The first investigation slice does not mutate telemetry data and does not add new storage tables.

`GET /query/events/properties` builds a read-only property governance catalog from event JSON properties for a selected project/environment window. It reports property frequency, event coverage, inferred JSON type counts, safe sample values, type conflicts, and similar property-name groups without enforcing schemas at ingest time.

`GET /query/events/funnel` analyzes ordered product-event conversion for a selected project/environment window. It is read-only, stateless, and aggregated entirely in SQL: operators pass 2-12 event names, and a single query (a materialized CTE over the matched events plus one `LEFT JOIN LATERAL` per step) computes actor progression using `user_id`, then `tenant_id`, `session_id`, or `trace_id` as the actor key (a dedicated `actor` override param is deferred). No per-actor row data leaves Postgres. It returns per-step actors, conversion, drop-off, and sample actors without adding persisted funnel definitions yet. Optional params add an entry-anchored `conversion_window`, a `breakdown_property` that splits results into up to 20 series, and `tenant_id`/`segment_id` actor scoping. An `events(project_id, environment_id, name, timestamp DESC)` index backs the step-name scan.

`GET /query/events/retention` analyzes temporal retention for a selected project/environment window. Cohorts are computed entirely in SQL as a cohort-by-period CTE, anchored on each actor's `user_profiles.first_seen_at` rather than the minimum entry-event timestamp inside the queried window, so an actor who existed before the window but re-fires the entry event inside it does not start a bogus new cohort. Retention is scoped to actors with a `user_profiles` row (identified via `user_id`); session/trace-only activity does not anchor a cohort. Operators pass an optional entry event (a cohort eligibility filter), an optional return event (absent means any event counts as retained), a period (`daily`, `weekly`, or `monthly`), an interval count, and an optional `range_days` (1..730) that overrides the `window`-derived range for long lookback queries. Ranges older than the configured `RETENTION_EVENTS_DAYS` are served from the `event_actor_daily` daily rollup table (maintained by a dedicated worker scheduler) instead of raw events, and the response reports `source: "raw" | "rollup"`.

Saved analytics segments live in `analytics_segments` and are scoped to one project/environment. Segment definitions are bounded JSON, not arbitrary SQL. The original (v1) shape is a single condition: actor type (`user` or `tenant`), window, optional event name, and optional event property condition. Segments created after the multi-condition compiler landed can instead persist a v2 tree definition (`{ version: 2, window?, root }`) built from `and`/`or`/`not` groups over event leaves (event name, property condition, frequency threshold, recency window) and trait leaves (equality/comparison over `user_profiles`/`tenant_profiles` traits). v1 rows already on disk are never rewritten; they are upgraded to the v2 shape in memory on read so existing segments keep matching the same actors. `packages/db/src/repositories/analytics-segment-compiler.ts` compiles a validated tree into a single parameterized boolean SQL expression (`compileSegmentDefinition`) used as a correlated `EXISTS`/count predicate against whichever query is being filtered (events, session replays, or event paths) — operators are looked up from a closed map (never concatenated from client input), and every name/value is bound, never interpolated as an identifier. Structural limits (max depth 5, max 32 nodes, max 8 children per group) reject pathological trees with a named error and `400` before persistence. Trait equality conditions compile to a `jsonb` containment expression (`traits @> jsonb_build_object(...)`) so they can use the `user_profiles`/`tenant_profiles` traits GIN indexes (`0044_profile_traits_gin.sql`) when the query shape allows it; other trait operators (`contains`, `gt`, `lt`, `neq`) fall back to an un-indexed `->>` comparison — see the ADR in `DECISIONS.md` for the tradeoffs. Admin routes create, edit, archive, list, and preview active segments, validating v2 trees with the same compiler before persisting. `GET /query/events` accepts `segment_id` to filter event investigation to actors matching a saved segment via a correlated subquery rather than a materialized `IN(array)`.

`GET /query/events/paths` analyzes common user journey paths from existing event telemetry. Operators provide a start event or end event, optional actor type (`auto`, `user`, `tenant`, `session`, or `trace`), max path depth, and the same project/environment/time/entity filters used elsewhere. The query compacts repeated adjacent event names per actor, aggregates the most common paths, supports saved segment filtering, and returns sample event ids for direct event drilldown in the console.

Events can store optional `replay_id` values. The Events detail drawer uses `GET /query/replays/:replayId` to load the privacy-safe replay and overlay linked product events in the same timeline, letting operators move from a product event to surrounding browser context without relying on screenshots or DOM capture. The Events investigation workspace also uses `GET /query/replays` to show replay samples for the active saved segment and current event filters, including user, tenant, route, timestamp, and linked event/error context.

Saved analytics dashboards live in `analytics_dashboards` and are scoped to one project/environment. Dashboard definitions store bounded JSON filters and whitelisted widget definitions, not arbitrary SQL. Admin routes list, create, edit, and archive active dashboards with project/environment-scoped mutations. `GET /query/reports/dashboards/:id` renders a saved dashboard by combining its saved window/filter defaults with `GET /query/overview` aggregates and returns metric, trend, and top-list widget data for the console.

Experiments live in `experiments` and are scoped to one project/environment. The first implementation supports A/B-style experiments with a stable key, actor type, exposure event, conversion event, weighted variants, and a bounded primary metric. The SDK helper deterministically assigns a subject to a variant and records an exposure event. `GET /query/experiments/:id/results` calculates variant exposure, conversion, conversion rate, and lift from normal event telemetry containing `experiment_key` and `variant` properties.

In-app surveys live in `surveys`, with answers stored in `survey_responses`. Survey definitions are scoped to one project/environment and include a stable key, status, actor type, optional trigger event, bounded question definitions, and lightweight targeting metadata. Browser and server integrations submit answers through `POST /v1/surveys/responses` or SDK `submitSurvey`; the worker applies data-governance rules before persistence. `GET /query/surveys/:id/results` returns response totals, per-question summaries, and recent responses for the selected window.

Message campaigns live in `message_campaigns`, with delivery/engagement/conversion/opt-out measurements stored in `message_campaign_events` and audience opt-outs stored in `message_campaign_opt_outs`. Campaign definitions are scoped to one project/environment and include a stable key, status, channel type (`in_app`, `email`, or `webhook`), optional notification channel id, optional analytics segment id, optional conversion event, copy, consent category, and privacy note. The first native slice is measurement-first: Sigmon creates, updates, archives, and reports campaign definitions, but does not yet run automated sends from the scheduler. `GET /query/message-campaigns/:id/results` returns totals, rates, recent campaign events, and opt-outs for the selected window.

Feature flags live in `feature_flags` with companion `feature_flag_audit` rows for created/updated/archived history. Flags are scoped to one project/environment, have active/paused/draft/archived status, a safe default variant, bounded variants, and ordered targeting rules over user, tenant, session, and trait equality. Rules can also include deterministic percentage rollout by user, tenant, or session stickiness; the DB preview and SDK use the same stable hash contract so actor assignment stays consistent. The SDK exposes `evaluateFlag` for local/safe evaluation and records `sigmon.feature_flag.evaluated` as normal event telemetry unless exposure tracking is disabled.

Beta programs live in `beta_programs` with participant rows in `beta_program_participants`. Programs are scoped to one project/environment, can target users or tenants, and can optionally link to a feature flag variant. Active participants are synchronized into generated targeting rules on the linked flag; removing a participant or archiving the program removes those generated rules. Adoption is calculated from normal event telemetry for active participants, so runtime applications keep using `evaluateFlag` rather than a separate beta-program SDK call.

High-volume investigation lists use opaque cursor pagination scoped to the exact project, environment, and active filters. This includes events, errors, LLM calls, traces, trace spans, error groups, source-map artifacts, and monitor check history. Monitor check cursors are additionally bound to the selected monitor id. Query migrations keep composite indexes aligned with the primary drilldown patterns for scope/time, trace id, tenant id, user id, source-map release, alert events, and error group ordering so operator views can page without broad table scans.

The console includes an Errors investigation workflow with grouped triage and raw occurrence drilldown. Grouped errors use `GET /query/error-groups`, `GET /query/error-groups/:id`, and `PATCH /query/error-groups/:id` for exact project/environment-scoped status and priority workflows. Raw occurrences remain available through the peer Raw occurrences tab and `GET /query/errors`, including exact `error_group_id` filtering.

The dedicated Incident view uses `GET /query/incidents/error-groups/:id` with project, environment, and optional raw error scope. The incident repository returns the selected group, a primary occurrence, source-map resolution status, suggested priority, saved priority override, AI-ready code context, and two context collections. Strongly related context matches the incident by strong identifiers such as trace, session, user, tenant, and release. Nearby context is lower-confidence activity around the primary occurrence timestamp and is labeled separately so operators can use it as supporting context rather than direct causality.

Incident code context is deterministic and privacy-first in this slice. It combines `release_metadata`, tokenless `project_code_integrations`, cached `error_stack_resolutions`, raw stack frames, trace ids, related signals, and replay linkage into a summary, probable files, evidence list, and suggested next steps. It does not read repository source code, store code-hosting tokens, or send incident payloads to external AI providers. Future AI providers should use this object as the bounded evidence envelope and remain project-configurable.

Raw error details can resolve minified production stack frames on demand through `GET /query/errors/:id/source-map-resolution`. Resolution requires exact active project, active environment, release, and minified filename matches against uploaded artifacts. Resolved frames are cached in `error_stack_resolutions`; database constraints bind each cached row to the same error scope, artifact scope, release, and minified file so direct SQL writes cannot cross-link source maps between projects, environments, releases, or bundles. Deleting a source-map artifact invalidates full cached stacks for any error that referenced the deleted artifact. The console displays file, line, column, and symbol metadata only, never original source code or `sourcesContent`.

Raw error details can also show session context when the selected error has a `session_id`. The timeline combines breadcrumbs and nearby existing signals in chronological order, highlights the selected error, and displays safe summaries only. Full visual replay and a dedicated Sessions investigation tab remain deferred.

The console also includes a Traces/APM view for raw traces, ordered spans, endpoint performance, and span-derived service dependencies. It uses `GET /query/traces` for trace rows, `GET /query/traces/:id/spans` for spans loaded after selecting a trace, `GET /query/apm/endpoints` for endpoint-level latency/throughput rollups, and `GET /query/apm/service-map` for service dependency edges inferred from span `metadata.service`, `metadata.target_service`, `metadata.peer_service`, `metadata.peer`, source, and operation names. This slice does not add new storage tables or ingestion routes.

The console also includes a read-only LLM view for raw AI calls and compact aggregate totals. It uses `GET /query/llm-calls` for call rows and `GET /query/aggregates/llm` for total calls, input tokens, output tokens, and total cost. This slice supports exact `provider`, `model`, `prompt_name`, and `status` filters and does not add charts, grouping, mutation, cross-signal timelines, storage tables, or ingestion routes.

The console also includes a read-only Entities view for tenant-first investigation. It uses `GET /query/entities/tenants` for impact-ranked tenant summaries and `GET /query/entities/tenants/:tenantKey` for selected tenant details. Entity queries are implemented behind the repository boundary in `packages/db/src/repositories/entities-query.ts` and aggregate existing `events`, `errors`, `traces`, and `llm_calls` records. Tenant profiles with identify traits can also appear without activity in the selected window, with zeroed counters and profile timestamps, so operators can inspect durable tenant identity data. When a tenant profile exists, the view shows trait-derived labels, key trait chips, and full profile traits from `tenant_profiles.traits`. Spans are intentionally excluded from entity timelines; trace rows link operators into the existing Traces investigation flow when span detail is needed.

The console also includes a read-only Users view for user-first investigation. It uses `GET /query/users` for impact-ranked user summaries and `GET /query/users/:userKey` for selected user details. User queries are implemented behind the repository boundary in `packages/db/src/repositories/users-query.ts` and aggregate existing `events`, `errors`, `traces`, and `llm_calls` records. User profiles with identify traits can also appear without activity in the selected window, with zeroed counters and profile timestamps, so operators can inspect durable user identity data. When a user profile exists, the view shows trait-derived labels, key trait chips, and full profile traits from `user_profiles.traits`. Spans are intentionally excluded from user timelines; trace rows link operators into the existing Traces investigation flow when span detail is needed.

## Overview Console

The console includes a read-only `Overview` mode for the selected project and environment. It uses `GET /query/overview` to load KPIs, prior-window KPI deltas, UTC-bucketed mini trends, top lists, and recent important signals for `24h`, `7d`, or `30d` windows.

Overview aggregates are computed from the existing events, errors, traces, and LLM call tables. Independent current KPI, prior-window KPI, trend, top-list, and recent-signal queries are dispatched together rather than awaited in serial, and bigint/numeric aggregate values pass through finite safe-number helpers before becoming JavaScript numbers. Delta fields report current, previous, absolute, percent, and direction per KPI; previous values are `null` when the prior window has no telemetry. It does not add storage tables, chart libraries, mutation routes, or SaaS workspace scope. Top-list rows can drill into existing investigation tabs by seeding exact filters; tenant top-list rows open the Entities investigation for the selected tenant. Recent signals remain read-only summaries without exact-record deep links.

Release tracking is a derived Overview dimension in this slice. `GET /query/releases` lists recently observed release values for the active project/environment/window by aggregating existing events, errors, traces, and LLM calls. `GET /query/overview` accepts an optional exact `release` filter so operators can compare deploy-scoped KPIs and trends without adding a release table yet. Incidents and source-map workflows continue to use the same release value for stack resolution and related-context grouping.

## Operations Console

The console includes a read-only `Operations` mode for the selected project and environment. It uses `GET /query/operations` to load monitored health, alert state, error rate, p95 trace latency, ingestion freshness, active incidents, recent monitor and alert activity, top latency names, anomaly detection, and setup gaps for `24h`, `7d`, or `30d` windows.

Operations aggregates are computed in `packages/db/src/repositories/operations-query.ts` from existing monitors, monitor checks, alert rules, alert events, notification delivery state, error groups, events, errors, traces, and LLM calls. It does not add storage tables or mutation routes. Drilldowns route to existing Monitors, Alerts, Investigate, and Incident views.

Anomaly detection is heuristic and explainable. The repository compares the current Operations window with the previous equivalent baseline and reports outliers in event volume, error volume, error rate, route p95 latency, and LLM cost when both the sample size and deviation thresholds are high enough. Each anomaly includes observed value, baseline value, sample sizes, percent change, threshold explanation, suggested alert-rule type when one exists, and a drilldown target.

Operations also returns a first predictive analytics slice through `predictions`. The initial prediction is an explainable `operational_risk` score for the next equivalent window. It is computed from current monitors, incidents, alert firings, alert delivery failures, telemetry error rate, failed traces, p95 latency, setup coverage, detected anomalies, and a previous-window baseline. The response includes severity, score, probability, confidence, validation sample sizes, baseline risk score, delta, top weighted factors, and a suggested drilldown. This is deterministic heuristic scoring, not an external ML or AI call, and it does not introduce new storage tables.

`System` remains global Sigmon install health. `Operations` is scoped to a monitored project/environment, so a self-monitoring `sigmon.app` project can be added like any other project without special product logic.

## Alerts Console

The console includes an operational `Alerts` mode for the active project and environment. It uses admin routes to manage alert rules and notification channels (generic webhook, native Slack, native Discord, or email), and read routes to show recent alert history and delivery status. Webhook, Slack, and Discord channels share the same `{url, secretHeaderName, secretHeaderValue}` shape and delivery pipeline (retry/timeout/SSRF checks); Slack and Discord only differ in the request body formatter applied before POST (`toSlackPayload`/`toDiscordPayload` in `apps/worker/src/alerts.ts`), so a generic webhook channel's exact payload shape stays unchanged. Webhook/Slack/Discord secret header values are write-only and redacted after save. Email alert notifications render both a plain-text and an HTML body, with an optional deep link back to the console alert (`{SIGMON_PUBLIC_ENDPOINT}/console#/alerts/:alertEventId`) when `SIGMON_PUBLIC_ENDPOINT` is configured.

The console also surfaces deterministic alert-rule suggestions via the read-only `GET /alerts/suggestions` route, backed by `buildAlertSuggestions()` in `packages/db/src/repositories/alerts.ts`. It derives candidate rules from the trailing 24h of telemetry (critical errors, route-scoped error spikes, trace p95 latency, and LLM cost), deduped against active rules, with thresholds set at a margin above observed values. Suggestions are metadata only; a one-click create issues a normal alert-rule mutation with no channel attached. Channel test-send is deferred — the per-channel Test control ships as a disabled affordance.

The console includes an admin `Artifacts` mode for the active project and environment. It uses `/admin/source-maps` to list, upload, filter, and delete local source-map artifacts. Supported uploads are single `.map` files and `.zip` bundles. It also uses `/admin/source-map-upload-tokens` to create, list, and revoke CI-only source-map upload tokens. Object storage, source-code browsing, indexed source maps, and cross-release guessing are deferred.

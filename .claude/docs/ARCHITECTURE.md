# Architecture

SignalMonitor is a self-hosted operational core with five runtime components:

- Fastify API service.
- Queue worker service.
- Scheduler worker service.
- Postgres.
- Redis with BullMQ.

## Request Paths

Ingestion:

1. Client calls `POST /v1/events`, `/v1/errors`, `/v1/llm`, `/v1/traces`, or `/v1/spans`.
2. API extracts the bearer API key and verifies the stored hash with `API_KEY_PEPPER`.
3. API validates the JSON payload with Zod.
4. API generates a signal id, attaches project and environment scope from the API key, enqueues the job, and returns `202 Accepted`.
5. Worker consumes the job, validates again, recursively sanitizes sensitive values, and writes the typed record into Postgres.

Telemetry queue jobs use deterministic IDs derived from the payload IDs. The worker writes telemetry through idempotent repository paths so duplicate queue delivery or retry attempts do not create duplicate telemetry rows.

Identify:

1. SDKs or raw clients call `POST /v1/identify/user` or `POST /v1/identify/tenant`.
2. API authenticates the same project/environment ingestion API key used for telemetry.
3. API validates the identify payload, sanitizes traits, and upserts the scoped profile row directly.
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
- `source_map_artifacts`
- `source_map_upload_tokens`
- `error_stack_resolutions`

Telemetry tables:

- `events`
- `error_groups`
- `errors`
- `breadcrumbs`
- `llm_calls`
- `traces`
- `spans`

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
- `/admin/source-maps`
- `/admin/source-map-upload-tokens`

Ingestion:

- `POST /v1/events`
- `POST /v1/errors`
- `POST /v1/breadcrumbs`
- `POST /v1/identify/user`
- `POST /v1/identify/tenant`
- `POST /v1/llm`
- `POST /v1/heartbeats/:id`
- `POST /v1/source-maps`
- `POST /v1/traces`
- `POST /v1/spans`

Query:

- `GET /query/events`
- `GET /query/errors`
- `GET /query/error-groups`
- `GET /query/error-groups/:id`
- `GET /query/error-groups/:id/errors`
- `PATCH /query/error-groups/:id`
- `GET /query/incidents/error-groups/:id`
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
- `GET /query/operations`
- `GET /query/apm/endpoints`
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

The scheduler role owns the retention scheduler. When `RETENTION_ENABLED=true`, it periodically deletes old telemetry from `events`, `errors`, `traces`, `spans`, `llm_calls`, and `breadcrumbs`, and expires old `dead_letter_jobs` using configured retention windows and bounded batches. Retention run outcomes are recorded in `retention_runs`, including a `deleted_dead_letter_jobs` count.

The worker also prunes local source-map artifacts when source-map retention is enabled. Source-map cleanup is reported through the existing retention run status path and removes local files, artifact metadata, and cached stack resolutions. File cleanup runs outside the telemetry deletion transaction so permanent filesystem side effects are not coupled to telemetry rollback behavior.

The worker owns the backup scheduler. When `BACKUPS_ENABLED=true`, it creates scheduled Postgres logical backups with `pg_dump` custom format and writes them to `BACKUPS_LOCAL_DIR`. The `backup_runs` table stores backup metadata only: run status, trigger, filename, byte size, optional S3 bucket/key, timestamps, and sanitized error text. Backup dump contents are stored on the configured filesystem path and optional S3-compatible bucket, not in Postgres metadata tables.

The scheduler role owns simple alert scheduling and monitor evaluation. When `ALERTS_ENABLED=true`, it evaluates enabled project/environment-scoped `alert_rules` under an advisory lock, records triggered `alert_events`, and sends optional webhook or email notifications through `notification_channels`. Alert rules can also define an optional escalation channel and delay; triggered alert events receive an `escalation_due_at` timestamp, and the scheduler sends one escalation delivery if the event is still triggered when due. Acknowledged, snoozed, and resolved alert events suppress escalation. Webhook and email delivery outcomes are stored in `notification_deliveries`.

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

High-volume investigation lists use opaque cursor pagination scoped to the exact project, environment, and active filters. This includes events, errors, LLM calls, traces, trace spans, error groups, source-map artifacts, and monitor check history. Monitor check cursors are additionally bound to the selected monitor id. Query migrations keep composite indexes aligned with the primary drilldown patterns for scope/time, trace id, tenant id, user id, source-map release, alert events, and error group ordering so operator views can page without broad table scans.

The console includes an Errors investigation workflow with grouped triage and raw occurrence drilldown. Grouped errors use `GET /query/error-groups`, `GET /query/error-groups/:id`, and `PATCH /query/error-groups/:id` for exact project/environment-scoped status and priority workflows. Raw occurrences remain available through the peer Raw occurrences tab and `GET /query/errors`, including exact `error_group_id` filtering.

The dedicated Incident view uses `GET /query/incidents/error-groups/:id` with project, environment, and optional raw error scope. The incident repository returns the selected group, a primary occurrence, source-map resolution status, suggested priority, saved priority override, and two context collections. Strongly related context matches the incident by strong identifiers such as trace, session, user, tenant, and release. Nearby context is lower-confidence activity around the primary occurrence timestamp and is labeled separately so operators can use it as supporting context rather than direct causality.

Raw error details can resolve minified production stack frames on demand through `GET /query/errors/:id/source-map-resolution`. Resolution requires exact active project, active environment, release, and minified filename matches against uploaded artifacts. Resolved frames are cached in `error_stack_resolutions`; database constraints bind each cached row to the same error scope, artifact scope, release, and minified file so direct SQL writes cannot cross-link source maps between projects, environments, releases, or bundles. Deleting a source-map artifact invalidates full cached stacks for any error that referenced the deleted artifact. The console displays file, line, column, and symbol metadata only, never original source code or `sourcesContent`.

Raw error details can also show session context when the selected error has a `session_id`. The timeline combines breadcrumbs and nearby existing signals in chronological order, highlights the selected error, and displays safe summaries only. Full visual replay and a dedicated Sessions investigation tab remain deferred.

The console also includes a Traces/APM view for raw traces, ordered spans, endpoint performance, and span-derived service dependencies. It uses `GET /query/traces` for trace rows, `GET /query/traces/:id/spans` for spans loaded after selecting a trace, `GET /query/apm/endpoints` for endpoint-level latency/throughput rollups, and `GET /query/apm/service-map` for service dependency edges inferred from span `metadata.service`, `metadata.target_service`, `metadata.peer_service`, `metadata.peer`, source, and operation names. This slice does not add new storage tables or ingestion routes.

The console also includes a read-only LLM view for raw AI calls and compact aggregate totals. It uses `GET /query/llm-calls` for call rows and `GET /query/aggregates/llm` for total calls, input tokens, output tokens, and total cost. This slice supports exact `provider`, `model`, `prompt_name`, and `status` filters and does not add charts, grouping, mutation, cross-signal timelines, storage tables, or ingestion routes.

The console also includes a read-only Entities view for tenant-first investigation. It uses `GET /query/entities/tenants` for impact-ranked tenant summaries and `GET /query/entities/tenants/:tenantKey` for selected tenant details. Entity queries are implemented behind the repository boundary in `packages/db/src/repositories/entities-query.ts` and aggregate existing `events`, `errors`, `traces`, and `llm_calls` records only. When a tenant profile exists, the view shows trait-derived labels and key trait chips from `tenant_profiles.traits`. Spans are intentionally excluded from entity timelines; trace rows link operators into the existing Traces investigation flow when span detail is needed.

The console also includes a read-only Users view for user-first investigation. It uses `GET /query/users` for impact-ranked user summaries and `GET /query/users/:userKey` for selected user details. User queries are implemented behind the repository boundary in `packages/db/src/repositories/users-query.ts` and aggregate existing `events`, `errors`, `traces`, and `llm_calls` records only. When a user profile exists, the view shows trait-derived labels and key trait chips from `user_profiles.traits`. Spans are intentionally excluded from user timelines; trace rows link operators into the existing Traces investigation flow when span detail is needed.

## Overview Console

The console includes a read-only `Overview` mode for the selected project and environment. It uses `GET /query/overview` to load KPIs, UTC-bucketed mini trends, top lists, and recent important signals for `24h`, `7d`, or `30d` windows.

Overview aggregates are computed from the existing events, errors, traces, and LLM call tables. Independent KPI, trend, top-list, and recent-signal queries are dispatched together rather than awaited in serial, and bigint/numeric aggregate values pass through finite safe-number helpers before becoming JavaScript numbers. It does not add storage tables, chart libraries, mutation routes, or SaaS workspace scope. Top-list rows can drill into existing investigation tabs by seeding exact filters; tenant top-list rows open the Entities investigation for the selected tenant. Recent signals remain read-only summaries without exact-record deep links.

## Operations Console

The console includes a read-only `Operations` mode for the selected project and environment. It uses `GET /query/operations` to load monitored health, alert state, error rate, p95 trace latency, ingestion freshness, active incidents, recent monitor and alert activity, top latency names, and setup gaps for `24h`, `7d`, or `30d` windows.

Operations aggregates are computed in `packages/db/src/repositories/operations-query.ts` from existing monitors, monitor checks, alert rules, alert events, notification delivery state, error groups, events, errors, and traces. It does not add storage tables or mutation routes. Drilldowns route to existing Monitors, Alerts, Investigate, and Incident views.

`System` remains global Sigmon install health. `Operations` is scoped to a monitored project/environment, so a self-monitoring `sigmon.app` project can be added like any other project without special product logic.

## Alerts Console

The console includes an operational `Alerts` mode for the active project and environment. It uses admin routes to manage alert rules and generic webhook notification channels, and read routes to show recent alert history and delivery status. Webhook secret header values are write-only and redacted after save.

The console also surfaces deterministic alert-rule suggestions via the read-only `GET /alerts/suggestions` route, backed by `buildAlertSuggestions()` in `packages/db/src/repositories/alerts.ts`. It derives candidate rules from the trailing 24h of telemetry (critical errors, route-scoped error spikes, trace p95 latency, and LLM cost), deduped against active rules, with thresholds set at a margin above observed values. Suggestions are metadata only; a one-click create issues a normal alert-rule mutation with no channel attached. Channel test-send is deferred — the per-channel Test control ships as a disabled affordance.

The console includes an admin `Artifacts` mode for the active project and environment. It uses `/admin/source-maps` to list, upload, filter, and delete local source-map artifacts. Supported uploads are single `.map` files and `.zip` bundles. It also uses `/admin/source-map-upload-tokens` to create, list, and revoke CI-only source-map upload tokens. Object storage, source-code browsing, indexed source maps, and cross-release guessing are deferred.

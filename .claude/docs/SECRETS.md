# Secrets

This file documents required environment variables with safe examples only. Do not store real secrets here.

Root-level `SECRETS.md` is ignored and may be used for local private notes.

| Variable | Required | Safe example | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | Runtime mode. Valid values are `development`, `test`, and `production`. |
| `WORKER_ROLE` | No | `all` | Non-secret operational config for `pnpm start:worker`. Use `queue` for the queue worker service, `scheduler` for the scheduler service, or `all` for a combined worker. |
| `PORT` | No | `3000` | API listen port. |
| `DATABASE_URL` | Yes | `Postgres URL with local host, database, and encoded password` | Postgres URL for local Node commands. Use the same password as `POSTGRES_PASSWORD`; URL-encode reserved characters. Do not commit the full URL. |
| `REDIS_URL` | Yes | `redis://localhost:6379` | Redis URL for local Node commands. |
| `POSTGRES_PASSWORD` | Yes for Compose | `example-local-password-change-me` | Compose Postgres user password. Replace before first database start. |
| `POSTGRES_PASSWORD_URLENCODED` | Sometimes | `example-local-password-change-me` | URL-encoded password for Compose internal `DATABASE_URL` when the raw password has URL-reserved characters. |
| `POSTGRES_PORT` | No | `5432` | Host port for Compose Postgres binding. |
| `REDIS_PORT` | No | `6379` | Host port for Compose Redis binding. |
| `SESSION_SECRET` | Yes | `replace-with-32-plus-random-characters` | At least 32 characters outside tests. Used to sign human session cookies. |
| `API_KEY_PEPPER` | Yes | `replace-with-32-plus-random-characters` | At least 32 characters outside tests. Used for ingestion API key hashing. |
| `CONSOLE_ENABLED` | No | `true` | Enables serving the built Integration Console from the API. Defaults to `true` in production. |
| `SIGMON_PUBLIC_ENDPOINT` | No | `https://sigmon.example.com` | Public API origin used in console snippets and, when set, in the alert email's "View in Sigmon" deep link. Defaults to the browser origin when blank; the alert email link is omitted when unset. |
| `LANDING_HOSTS` | No | `sigmon.app,www.sigmon.app` | Non-secret. Comma-separated bare hostnames (no scheme or port) that receive the public landing page at `GET /`. Every other host is redirected from `/` to `/console` when the console is enabled. Defaults to `sigmon.app,www.sigmon.app`. |
| `BROWSER_CORS_ORIGINS` | No | `https://app.example.com` | Optional non-secret global browser origin allowlist for public ingestion endpoints. Prefer project-scoped origins in Project Settings for normal setup. |
| `SIGMON_SOURCE_MAP_TOKEN` | CI only | `shsmap_example` | Source-map upload token created from the Artifacts console. Store only in CI secret storage. |
| `SIGMON_URL` | `@sigmon/mcp` only | `https://my.sigmon.app` | Not a secret itself. Sigmon instance base URL the `sigmon-mcp` stdio server calls. Set in the coding agent's MCP client config, not on the Sigmon instance. |
| `SIGMON_READ_TOKEN` | `@sigmon/mcp` only | `shread_example` | Read token created from Project Settings → Read tokens, scoped to one project/environment and revocable. `sigmon-mcp` fails fast at startup if unset. Store only in the coding agent's local MCP client config, never committed. |
| Coolify deploy webhook URLs | Operator only | `https://coolify.example.com/api/v1/deploy?uuid=...` | Manual deploy triggers for the `api`, `worker`, and `scheduler` Coolify applications. Keep only in the uncommitted root `SECRETS.md`; not configured in GitHub Actions. |
| Coolify API token | Operator only | `3|example-token` | Bearer token for the deploy webhooks above, scoped to `deploy` only. Kept in the uncommitted root `SECRETS.md` and deliberately not a GitHub Actions secret, because deploys are manual. |
| `SOURCE_COMMIT` | Injected | `e8460fbfef11972f7605a2221fee2d19c452ca9d` | Non-secret. Set automatically by Coolify to the built commit SHA; reported as `version` by `GET /health` so a deploy can be verified by effect. Unset locally and under Compose, where `version` is `null`. |
| `SOURCE_MAPS_LOCAL_DIR` | No | `/var/lib/sigmon/source-maps` | Non-secret operational config. Local directory for uploaded source-map artifacts. |
| `SOURCE_MAPS_MAX_UPLOAD_MB` | No | `50` | Non-secret operational config. Maximum source-map upload size in MiB. |
| `SOURCE_MAPS_RETENTION_ENABLED` | No | `true` | Non-secret operational config. Enables worker cleanup of old local source-map artifacts when telemetry retention is enabled. |
| `SOURCE_MAPS_RETENTION_DAYS` | No | `180` | Non-secret operational config. Retention window for source-map artifacts by upload time. |
| `SOURCE_MAPS_RETENTION_BATCH_SIZE` | No | `100` | Non-secret operational config. Maximum source-map artifacts cleaned per retention run. |
| `SYSTEM_HEALTH_HISTORY_ENABLED` | No | `true` | Non-secret operational config. Enables the worker health-history sampler that records a bounded system_health_samples time-series. |
| `SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES` | No | `5` | Non-secret operational config. Minutes between health-history samples. |
| `SYSTEM_HEALTH_HISTORY_RETENTION_HOURS` | No | `48` | Non-secret operational config. Age after which health-history samples are pruned on every sampler run. |
| `DB_STATEMENT_TIMEOUT_MS` | No | `15000` | Non-secret operational config. Postgres `statement_timeout` (ms) applied to the API's request-serving connection pool; `0` disables it. Migrations run on a separate, timeout-free pool. |
| `DB_WORKER_STATEMENT_TIMEOUT_MS` | No | `0` | Non-secret operational config. Postgres `statement_timeout` (ms) applied to the worker's connection pool; `0` (default) disables it, since rollups/retention/backups can legitimately run long. |
| `FUNNEL_MAX_ACTORS` | No | `50000` | Non-secret operational config. Maximum distinct actors allowed into a `GET /query/events/funnel` request before it is rejected with `400 funnel_scope_too_large`; `0` disables the guard. |
| `BOOTSTRAP_ADMIN_EMAIL` | Yes | `admin@example.com` | Email used by `pnpm seed:admin`. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Yes | `replace-with-32-plus-random-characters` | At least 32 characters outside tests. Initial admin login password. |
| `GOOGLE_OAUTH_ENABLED` | No | `false` | Enables Google OAuth when set to `true` and all Google settings are present. |
| `GOOGLE_CLIENT_ID` | If OAuth enabled | `example-client-id.apps.googleusercontent.com` | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | If OAuth enabled | `example-client-secret` | Google OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | If OAuth enabled | `https://my.sigmon.app/auth/google/callback` | Exact Google OAuth callback URL. Configure all four `GOOGLE_*` variables on the API service only; use `http://localhost:3000/auth/google/callback` for local development. |
| `RETENTION_ENABLED` | No | `true` | Non-secret operational config. Enables scheduled telemetry deletion in the worker. |
| `RETENTION_INTERVAL_MINUTES` | No | `60` | Non-secret operational config. Minutes between scheduled retention runs. |
| `RETENTION_BATCH_SIZE` | No | `1000` | Non-secret operational config. Maximum rows deleted per telemetry table per delete batch. |
| `RETENTION_EVENTS_DAYS` | No | `90` | Non-secret operational config. Event retention window. |
| `RETENTION_ERRORS_DAYS` | No | `180` | Non-secret operational config. Error retention window. |
| `RETENTION_TRACES_DAYS` | No | `90` | Non-secret operational config. Trace retention window. |
| `RETENTION_SPANS_DAYS` | No | `90` | Non-secret operational config. Span retention window. |
| `RETENTION_LLM_CALLS_DAYS` | No | `180` | Non-secret operational config. LLM call retention window. |
| `RETENTION_PROFILES_DAYS` | No | `30` | Non-secret operational config. Runtime CPU/memory profile retention window. |
| `RETENTION_BREADCRUMBS_DAYS` | No | `30` | Non-secret operational config. Breadcrumb retention window. |
| `RETENTION_DEAD_LETTER_JOBS_DAYS` | No | `30` | Non-secret operational config. Dead-letter job retention window; action history remains in `dead_letter_job_actions`. |
| `EVENT_ROLLUPS_ENABLED` | No | `true` | Non-secret operational config. Enables the worker's daily `event_actor_daily` rollup job used to serve long-range retention queries. |
| `EVENT_ROLLUPS_INTERVAL_MINUTES` | No | `60` | Non-secret operational config. Minutes between scheduled event rollup runs. |
| `EVENT_ROLLUPS_LOOKBACK_DAYS` | No | `400` | Non-secret operational config. Backfill window on the rollup's first run; intentionally longer than `RETENTION_EVENTS_DAYS` so the rollup finishes covering a day before raw events for it are purged. |
| `ALERTS_ENABLED` | No | `true` | Non-secret operational config. Enables scheduled alert evaluation in the worker. |
| `ALERTS_INTERVAL_MINUTES` | No | `1` | Non-secret operational config. Minutes between scheduled alert evaluation runs. |
| `ALERTS_WEBHOOK_TIMEOUT_MS` | No | `5000` | Non-secret operational config. Timeout for generic webhook alert deliveries. |
| `WAREHOUSE_EXPORTS_ENABLED` | No | `true` | Non-secret scheduler config. Enables scheduled warehouse exports; set it on the scheduler service in split deployments. |
| `WAREHOUSE_EXPORTS_INTERVAL_MINUTES` | No | `15` | Non-secret scheduler config. Minutes between scheduled warehouse export passes; set it on the scheduler service in split deployments. |
| `BACKUPS_ENABLED` | No | `true` | Non-secret operational config. Enables scheduled Postgres logical backups in the worker. |
| `BACKUPS_INTERVAL_HOURS` | No | `24` | Non-secret operational config. Hours between scheduled backup runs. |
| `BACKUPS_LOCAL_DIR` | No | `/var/lib/sigmon/backups` | Non-secret operational config. Local directory for backup dump files. |
| `BACKUPS_RETENTION_DAYS` | No | `14` | Non-secret operational config. Local backup retention window. |
| `BACKUPS_S3_ENABLED` | No | `false` | Non-secret operational config. Enables S3-compatible backup uploads. |
| `BACKUPS_S3_ENDPOINT` | If S3 enabled | `https://example.r2.cloudflarestorage.com` | S3-compatible endpoint, for example Cloudflare R2. |
| `BACKUPS_S3_REGION` | If S3 enabled | `auto` | S3-compatible region. Cloudflare R2 commonly uses `auto`. |
| `BACKUPS_S3_BUCKET` | If S3 enabled | `sigmon-backups` | Private S3-compatible backup bucket name. |
| `BACKUPS_S3_ACCESS_KEY_ID` | If S3 enabled | `example-r2-access-key-id` | S3-compatible access key id. Store only in environment or secret manager. |
| `BACKUPS_S3_SECRET_ACCESS_KEY` | If S3 enabled | `example-r2-secret-access-key` | S3-compatible secret access key. Store only in environment or secret manager. |
| `BACKUPS_S3_PREFIX` | No | `production/sigmon` | Non-secret object key prefix for uploaded backups. |

Operational rules:

- Generate new values for `SESSION_SECRET`, `API_KEY_PEPPER`, `BOOTSTRAP_ADMIN_PASSWORD`, and `POSTGRES_PASSWORD` outside disposable local use.
- Do not commit `.env`.
- Do not commit root-level `SECRETS.md`.
- S3-compatible backup credentials must remain environment-only or in the deployment secret manager. Do not place real `BACKUPS_S3_ACCESS_KEY_ID` or `BACKUPS_S3_SECRET_ACCESS_KEY` values in committed docs.
- API key secrets returned by `/admin/projects/:projectId/api-keys` are one-time values and should be copied directly into the target client secret store.
- Coolify deploy webhook URLs can trigger production deploys. They are called manually by the operator; store them only in the uncommitted root `SECRETS.md`, never in committed files, GitHub Actions secrets, or shared shell history.
- SDK publishing uses npm Trusted Publishing through GitHub Actions OIDC. Do not create or store a long-lived npm publish token for the SDK workflow.
- Source-map upload tokens are separate from ingestion API keys. They should be stored only in CI secret storage and never shipped to browser clients.
- Webhook notification channel secret header values are write-only. The API and console only expose whether a secret is saved; saved values are redacted.
- Source-map settings are not secrets. Uploaded source maps may contain sensitive source paths or embedded `sourcesContent`; SignalMonitor stores them locally and the console displays resolved frame metadata only, not source content.
- Source-map retention deletes local source-map files, artifact metadata, and cached stack resolutions. It does not configure object-storage lifecycle policies.
- `RETENTION_BREADCRUMBS_DAYS` is not a secret. Breadcrumb payloads can still contain sensitive application data if callers misuse the API, so SDK/browser helpers sanitize aggressively and documentation forbids secrets, form values, bodies, cookies, and headers.
- Production startup and operator doctor checks reject placeholder values for required production secrets.
- Production doctor checks also fail when `POSTGRES_PASSWORD` is missing or still uses the local-only Compose placeholder.
- Doctor output redacts secret values and reports only variable names, status, and actionable remediation.
- Browser ingestion API keys are expected to be public but must remain project/environment scoped. Server-side ingestion keys must stay in server secret storage and must not be bundled into browser code.
- Identify calls use the existing project/environment ingestion API keys. They do not introduce new environment variables, secrets, tokens, or key types.
- Production session cookies use `__Host-sigmon_session` with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`.

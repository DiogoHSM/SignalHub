# Secrets

This file documents required environment variables with safe examples only. Do not store real secrets here.

Root-level `SECRETS.md` is ignored and may be used for local private notes.

| Variable | Required | Safe example | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | Runtime mode. Valid values are `development`, `test`, and `production`. |
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
| `SIGNALHUB_PUBLIC_ENDPOINT` | No | `https://signalhub.example.com` | Public API origin used in console snippets. Defaults to the browser origin when blank. |
| `SIGNALHUB_SOURCE_MAP_TOKEN` | CI only | `shsmap_example` | Source-map upload token created from the Artifacts console. Store only in CI secret storage. |
| `SOURCE_MAPS_LOCAL_DIR` | No | `/var/lib/signalhub/source-maps` | Non-secret operational config. Local directory for uploaded source-map artifacts. |
| `SOURCE_MAPS_MAX_UPLOAD_MB` | No | `50` | Non-secret operational config. Maximum source-map upload size in MiB. |
| `BOOTSTRAP_ADMIN_EMAIL` | Yes | `admin@example.com` | Email used by `pnpm seed:admin`. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Yes | `replace-with-32-plus-random-characters` | At least 32 characters outside tests. Initial admin login password. |
| `GOOGLE_OAUTH_ENABLED` | No | `false` | Enables Google OAuth when set to `true` and all Google settings are present. |
| `GOOGLE_CLIENT_ID` | If OAuth enabled | `example-client-id.apps.googleusercontent.com` | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | If OAuth enabled | `example-client-secret` | Google OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | If OAuth enabled | `http://localhost:3000/auth/google/callback` | OAuth callback URL. |
| `RETENTION_ENABLED` | No | `true` | Non-secret operational config. Enables scheduled telemetry deletion in the worker. |
| `RETENTION_INTERVAL_MINUTES` | No | `60` | Non-secret operational config. Minutes between scheduled retention runs. |
| `RETENTION_BATCH_SIZE` | No | `1000` | Non-secret operational config. Maximum rows deleted per telemetry table per delete batch. |
| `RETENTION_EVENTS_DAYS` | No | `90` | Non-secret operational config. Event retention window. |
| `RETENTION_ERRORS_DAYS` | No | `180` | Non-secret operational config. Error retention window. |
| `RETENTION_TRACES_DAYS` | No | `90` | Non-secret operational config. Trace retention window. |
| `RETENTION_SPANS_DAYS` | No | `90` | Non-secret operational config. Span retention window. |
| `RETENTION_LLM_CALLS_DAYS` | No | `180` | Non-secret operational config. LLM call retention window. |
| `RETENTION_BREADCRUMBS_DAYS` | No | `30` | Non-secret operational config. Breadcrumb retention window. |
| `ALERTS_ENABLED` | No | `true` | Non-secret operational config. Enables scheduled alert evaluation in the worker. |
| `ALERTS_INTERVAL_MINUTES` | No | `1` | Non-secret operational config. Minutes between scheduled alert evaluation runs. |
| `ALERTS_WEBHOOK_TIMEOUT_MS` | No | `5000` | Non-secret operational config. Timeout for generic webhook alert deliveries. |
| `BACKUPS_ENABLED` | No | `true` | Non-secret operational config. Enables scheduled Postgres logical backups in the worker. |
| `BACKUPS_INTERVAL_HOURS` | No | `24` | Non-secret operational config. Hours between scheduled backup runs. |
| `BACKUPS_LOCAL_DIR` | No | `/var/lib/signalhub/backups` | Non-secret operational config. Local directory for backup dump files. |
| `BACKUPS_RETENTION_DAYS` | No | `14` | Non-secret operational config. Local backup retention window. |
| `BACKUPS_S3_ENABLED` | No | `false` | Non-secret operational config. Enables S3-compatible backup uploads. |
| `BACKUPS_S3_ENDPOINT` | If S3 enabled | `https://example.r2.cloudflarestorage.com` | S3-compatible endpoint, for example Cloudflare R2. |
| `BACKUPS_S3_REGION` | If S3 enabled | `auto` | S3-compatible region. Cloudflare R2 commonly uses `auto`. |
| `BACKUPS_S3_BUCKET` | If S3 enabled | `signalhub-backups` | Private S3-compatible backup bucket name. |
| `BACKUPS_S3_ACCESS_KEY_ID` | If S3 enabled | `example-r2-access-key-id` | S3-compatible access key id. Store only in environment or secret manager. |
| `BACKUPS_S3_SECRET_ACCESS_KEY` | If S3 enabled | `example-r2-secret-access-key` | S3-compatible secret access key. Store only in environment or secret manager. |
| `BACKUPS_S3_PREFIX` | No | `production/signalhub` | Non-secret object key prefix for uploaded backups. |

Operational rules:

- Generate new values for `SESSION_SECRET`, `API_KEY_PEPPER`, `BOOTSTRAP_ADMIN_PASSWORD`, and `POSTGRES_PASSWORD` outside disposable local use.
- Do not commit `.env`.
- Do not commit root-level `SECRETS.md`.
- S3-compatible backup credentials must remain environment-only or in the deployment secret manager. Do not place real `BACKUPS_S3_ACCESS_KEY_ID` or `BACKUPS_S3_SECRET_ACCESS_KEY` values in committed docs.
- API key secrets returned by `/admin/projects/:projectId/api-keys` are one-time values and should be copied directly into the target client secret store.
- Source-map upload tokens are separate from ingestion API keys. They should be stored only in CI secret storage and never shipped to browser clients.
- Webhook notification channel secret header values are write-only. The API and console only expose whether a secret is saved; saved values are redacted.
- Source-map settings are not secrets. Uploaded source maps may contain sensitive source paths or embedded `sourcesContent`; SignalHub stores them locally and the console displays resolved frame metadata only, not source content.
- `RETENTION_BREADCRUMBS_DAYS` is not a secret. Breadcrumb payloads can still contain sensitive application data if callers misuse the API, so SDK/browser helpers sanitize aggressively and documentation forbids secrets, form values, bodies, cookies, and headers.
- Production startup and operator doctor checks reject placeholder values for required production secrets.
- Doctor output redacts secret values and reports only variable names, status, and actionable remediation.

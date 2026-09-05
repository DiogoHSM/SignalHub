# SignalMonitor Self-Hosting Guide

SignalMonitor is self-hosted software. This release line supports Docker Compose as the production-oriented installation path for independent operators. Kubernetes, Helm, systemd units, hosted SaaS, billing, and managed multi-tenant workspace operations are outside the supported surface for now.

## Support Matrix

| Area | Status | Notes |
| --- | --- | --- |
| License | Supported | Elastic License 2.0 (source-available). Free to download, use, modify, and self-host; may not be offered to third parties as a hosted or managed service. The `@sigmon/sdk` package stays MIT so it can be embedded in any application. See `LICENSE`. |
| Runtime | Supported | Node.js 22.x and pnpm 9.15.x. |
| Install path | Supported | Docker Compose with Postgres 16, Redis 7, API, and worker/scheduler. |
| Local development | Supported | Native Node.js API/worker with Compose Postgres and Redis. |
| Backups | Supported | Worker-owned `pg_dump` custom-format backups with SHA-256 sidecars and optional S3-compatible upload. |
| Restore | Supported | Destructive `pg_restore` flow with API/worker stopped. |
| Upgrade | Supported | Backup, pull, install, build, migrate, restart, doctor. |
| Reverse proxy / TLS | Operator-owned | Put HTTPS, routing, and certificates in your proxy or platform. Set `SIGMON_PUBLIC_ENDPOINT`. |
| Object storage for backups | Supported | S3-compatible backup uploads, including Cloudflare R2. |
| Source-map object storage | Deferred | Source maps are local-volume backed in this release line. |
| Kubernetes / Helm | Not supported | Can be built by operators, but is not maintained as an official path yet. |
| Hosted SaaS / billing / per-project RBAC | Not supported | One self-hosted install with local admins and project/environment scopes. |
| Enterprise SLA | Not provided | The Elastic License 2.0 ships software without warranty. Operators own uptime and incident response. |

## Minimum Production Shape

For a small production install, run:

- Postgres 16 with persistent storage and backups.
- Redis 7 with persistent storage.
- API container serving `/console`, `/docs`, `/sdk`, and ingestion/query/admin endpoints.
- Worker process with `WORKER_ROLE=all`, or split services:
  - `WORKER_ROLE=queue` for ingestion queue processing.
  - `WORKER_ROLE=scheduler` for retention, scheduled and queued manual backups, alerts, monitors, system health samples, and warehouse exports.

Use split worker/scheduler services when ingestion volume or operational jobs need independent restarts and health checks. A queue-only worker does not consume maintenance jobs. Keep at least one scheduler-role worker running even when `BACKUPS_ENABLED=false`, because that flag disables the schedule but not administrator-requested backups.

### Private split services on Coolify

Only the API is an HTTP service. When API, queue worker, and scheduler are separate Coolify applications:

- Configure the public domain and proxy routing only on the API application.
- Leave **Domains** empty on the `WORKER_ROLE=queue` and `WORKER_ROLE=scheduler` applications.
- Reset any stale custom proxy labels after clearing a previously generated domain. The running queue-worker and scheduler containers must not have Traefik or Caddy routing labels.
- Redeploy each internal application after changing its domain or labels, then confirm the former public URL returns `404` and the container still reports its intended role.
- Repeat the label and URL checks after a later normal redeploy. A generated `sslip.io` hostname on an internal application is a routing regression, not a required health endpoint.

Do not add a public route merely to obtain platform health status. Verify the queue worker through its startup/processing logs and queue metrics, and verify the scheduler through its startup log and heartbeat on the System Health screen.

## Quick Start

```sh
git clone https://github.com/DiogoHSM/sigmon.git
cd sigmon
cp .env.example .env
```

Edit `.env` before first start:

- Replace `POSTGRES_PASSWORD`, `SESSION_SECRET`, `API_KEY_PEPPER`, and `BOOTSTRAP_ADMIN_PASSWORD`.
- Provision `DATA_ENCRYPTION_KEY` as the canonical base64 encoding of exactly 32 random bytes. Create and store it directly in the deployment secret manager; do not print it into a terminal, log, or committed file.
- Set `BOOTSTRAP_ADMIN_EMAIL`.
- Set `SIGMON_PUBLIC_ENDPOINT` to the public HTTPS origin, for example `https://my-sigmon.example.com`.
- If `POSTGRES_PASSWORD` has URL-reserved characters, set `POSTGRES_PASSWORD_URLENCODED`.

Then run:

```sh
pnpm install
pnpm run doctor
docker compose up -d postgres redis
docker compose run --rm api pnpm seed:admin
docker compose up -d --build
pnpm run doctor -- --compose --api-url http://localhost:3000
```

Open:

- Console: `http://localhost:3000/console`
- API docs: `http://localhost:3000/docs`
- SDK docs: `http://localhost:3000/sdk`
- Health: `http://localhost:3000/health`
- Readiness: `http://localhost:3000/ready`

## Reverse Proxy

Terminate TLS in your platform or proxy, forward HTTP to the API container, and preserve standard proxy headers. Set:

```dotenv
NODE_ENV=production
SIGMON_PUBLIC_ENDPOINT=https://sigmon.example.com
CONSOLE_ENABLED=true
TRUSTED_PROXY_CIDRS=
```

`TRUSTED_PROXY_CIDRS` is empty by default. With that conservative setting, forwarded headers do not create a client identity: the direct TCP peer is authoritative. If a reverse proxy is present, set a comma-separated list containing only the exact IP or CIDR of each immediate proxy peer that can connect to the API. Fastify evaluates a forwarded chain right-to-left from that trusted peer and stops at the first untrusted address. The direct peer remains authoritative when it is not trusted.

Determine the address from the deployment rather than guessing. Before enabling proxy trust, send a staging request through the proxy and inspect the API request log or network telemetry for the direct peer. For a proxy container on the same Docker network, inspect that container's attachment (for example, `docker inspect --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' <proxy-container>`) and use a `/32` for its IPv4 address or `/128` for its IPv6 address. If the address can change, reserve a stable address or use the platform's exact documented proxy range. A host proxy connected through Docker NAT may appear as the bridge gateway rather than `127.0.0.1`; verify what the API actually sees. For a managed load balancer, use only the provider's documented source CIDRs that are immediate peers.

Do not use a whole Docker, VPC, or cloud-provider subnet merely because the proxy is somewhere inside it. Boolean trust, hop counts, `0.0.0.0/0`, `::/0`, mapped-IPv4 trust-all ranges such as `::ffff:0:0/96`, and other overly broad ranges let an unintended peer spoof client identity. The production parser rejects the trust-all forms and rejects non-IP values such as booleans or hop counts; operators must still keep every accepted CIDR as narrow as the actual proxy layout permits.

Browser SDK telemetry from another origin also needs that app origin in `Project Settings > Browser origins` or the bootstrap `BROWSER_CORS_ORIGINS` environment variable. The global request limiter runs before the database-backed browser-origin lookup, including for preflight requests. Production counters are Redis-backed; the stricter login source/account quotas remain separate controls. Positive and negative database-origin results are cached in each API process for 60 seconds, with at most 1,000 entries. Admin changes invalidate the current replica immediately, but other replicas may take up to 60 seconds to converge unless requests are routed consistently.

## Persistent Data

Docker Compose defines these persistent volumes:

| Volume | Contents |
| --- | --- |
| `postgres_data` | Primary Postgres database. |
| `redis_data` | Redis append-only data. |
| `backup_data` | Local backup dumps and SHA-256 sidecars. |
| `source_map_data` | Uploaded source-map artifacts. |

The Compose API and worker mounts are the same read-write `source_map_data:/var/lib/sigmon/source-maps` volume. In a split deployment, every API and worker/scheduler instance must receive that same persistent backing store at the same `SOURCE_MAPS_LOCAL_DIR`; separately named local volumes are not shared storage.

Do not delete these volumes unless you intentionally want to wipe the install. No migration, reconciliation command, application startup, or rollout step automatically removes a volume.

## Telemetry Retention Precedence

Installation retention environment variables are defaults. A valid project/environment category value saved through Data Governance replaces its installation default whether shorter or longer; a missing policy, an absent category in a partial policy, or an invalid legacy value uses the default. For example, with a 30-day events default, a scoped 90-day value preserves a 60-day event, a scoped 7-day value deletes an 8-day event, and a policy containing only a clicks value leaves events on 30 days. Cutoffs are exact elapsed 24-hour intervals and deletion is strict `<`, so a row exactly at the cutoff survives.

Each physical table has one deletion owner. `events`, `click_events`, and `session_replays` are owned by the events, clicks, and replays categories respectively; `session_replays` is never also selected by events. Because this release has no independent installation defaults for clicks, replays, or web vitals, those categories use `RETENTION_EVENTS_DAYS` only when their scoped values are absent or invalid. Retention-run metadata and APIs continue to aggregate click and replay deletion totals into the `events` counter.

Before an upgrade from the former installation-boundary behavior, inventory scoped values that exceed their installation defaults and confirm the longer lifetime is intended. A database backup protects the upgrade, but the new behavior cannot restore telemetry deleted by an earlier run. After deployment, run a manual retention action from System Health and inspect the recorded counts for the expected categories.

Heartbeat ingestion now treats monitor, environment, and project archival as the same inactive scope. A check-in against any archived level returns `404 heartbeat_monitor_not_found`; a wrong secret on an otherwise active heartbeat remains `401 invalid_heartbeat_secret`. The write transaction revalidates and serializes all three lifecycle rows, so an archive cannot slip between route lookup and persistence.

## Human Sessions And Login Controls

Human login creates a seven-day opaque session. The browser receives a random token; Postgres stores only its SHA-256 hash. An active lookup rejects expired or revoked sessions and sessions belonging to archived users. Logout revokes the current row before clearing the cookie. An administrator password change or user archival revokes every session for that user in the same database transaction, so a copied cookie stops working immediately. `last_seen_at` is touched at most once per fifteen minutes. Expiry and revocation are enforced on lookup. The repository exposes `pruneExpiredAuthSessions`, which deletes rows at `expires_at <= now`, but this release has no production scheduler or manual command that invokes it; expired rows can remain stored but cannot authenticate.

The opaque token format intentionally has no compatibility path for the former signed `payload.signature` cookie. The first upgrade that creates `auth_sessions` invalidates every existing human session; tell operators and users to expect one fresh password or Google OAuth login. Changing a password or archiving a user has the same intentional session-invalidation effect.

Password login applies these controls before it creates a session:

| Variable | Default | Effect |
| --- | ---: | --- |
| `LOGIN_SOURCE_MAX_ATTEMPTS` | `10` | Maximum attempts in the source-IP window. |
| `LOGIN_SOURCE_WINDOW_MS` | `60000` | Source-IP quota window in milliseconds. |
| `LOGIN_ACCOUNT_MAX_ATTEMPTS` | `8` | Maximum attempts in the normalized-account window. |
| `LOGIN_ACCOUNT_WINDOW_MS` | `900000` | Shared account quota window in milliseconds. |
| `LOGIN_ARGON2_CONCURRENCY` | `4` | Maximum concurrent password Argon2 verifications in each API process. |
| `LOGIN_PROGRESSIVE_DELAY_MAX_MS` | `2000` | Cap for the exponential delay applied to failed credentials. |

The source quota uses Fastify's trusted `request.ip`. Until trusted proxy CIDRs are explicitly configured, an untrusted proxy can collapse clients into one conservative bucket but cannot create extra source identities. The account quota is shared through Redis and keyed by an HMAC of the trimmed, lower-cased email rather than the email itself. Its increment and first expiry are atomic. The dedicated quota client has bounded connection, command, socket, and retry behavior; if a source or account check cannot be trusted, login returns `503 auth_unavailable` instead of bypassing the guard. Existing database sessions continue to use Postgres, although a wider Redis outage can independently affect queued ingestion.

Admission failures remain distinct and do not perform Argon2 work: malformed or over-1,024-byte input returns `400`, a source or normalized-account quota rejection returns `429`, and unavailable or malformed Redis quota state returns `503 auth_unavailable`. Only a schema-valid request admitted by both quotas reaches credential verification. That path performs exactly one Argon2 verification: missing, archived, and OAuth-only accounts use a valid dummy Argon2id hash, while password-backed accounts use their stored Argon2id hash. The invalid credentials on that admitted path receive the bounded progressive delay and the same `401 invalid_credentials` contract. Keep password storage on Argon2id; the peppered SHA-256 decision applies only to high-entropy generated ingestion API keys.

## Integration Credential Encryption

Production API, worker, scheduler, and migration processes require `DATA_ENCRYPTION_KEY`, the canonical base64 encoding of exactly 32 random bytes. Provision the same current key to every service through the deployment secret manager. During rotation only, also provision `DATA_ENCRYPTION_KEY_PREVIOUS` with the old key; the values must differ. Keep an access-controlled, tested escrow copy outside the database and its backups. Never paste either key into commands, issue trackers, logs, or committed configuration. `.claude/docs/SECRETS.md` records the format and custody rules without real values.

Warehouse connection URLs, all generic/Slack/Discord notification delivery URLs, and notification secret-header values use AES-256-GCM envelopes with a random 12-byte nonce and 16-byte authentication tag. Associated data binds the ciphertext to its table, row id, and field name, so copying an envelope to another row or field fails authentication. New writes always use the current key. Ordinary admin list responses expose only persisted redacted URL previews and metadata; plaintext is decrypted only at the privileged execution boundary.

Migration `0050_encrypted_integration_secrets.sql` is intentionally additive. It adds encrypted columns and non-secret URL previews for warehouse and notification destinations, makes the old warehouse plaintext column nullable, and retains the old plaintext columns for this staged release. `pnpm secrets:migrate` processes bounded, stable ID batches. Each row is locked and freshly classified in its own transaction, then encrypted or rewrapped, decrypt-verified, persisted, and cleared of plaintext atomically. A notification URL and its optional secret header are handled in the same row transaction. The command reports only `migrated` and `rotated` row counts; a notification row with two changed fields counts once, and a legacy migration takes precedence over a simultaneous previous-key rotation.

## Outbound Integration Policy

Privileged outbound consumers share one destination policy. With the defaults below, only public destinations are allowed:

```dotenv
OUTBOUND_PRIVATE_CIDRS=
ALLOW_LOOPBACK_OUTBOUND=false
```

`OUTBOUND_PRIVATE_CIDRS` accepts only exact RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) or IPv6 ULA (`fc00::/7`) subnets, and a destination is allowed only when its resolved address falls inside an explicitly configured CIDR. Prefer a single host route such as `/32` or `/128`; this is not a broad private-network switch. `ALLOW_LOOPBACK_OUTBOUND=true` is accepted only in `development` or `test` and production refuses to start with it enabled.

Loopback, unspecified, link-local and cloud-metadata, CGNAT, documentation, benchmark, multicast, reserved, malformed numeric, and other non-routable addresses remain forbidden. IPv4-mapped, IPv4-compatible, SIIT, NAT64 well-known-prefix, and 6to4 encodings are classified by their embedded IPv4 address, so transition encoding cannot hide a private or forbidden target. These rules apply even when a hostname is initially public: every DNS answer is checked by the lookup used at actual socket creation. A separate DNS preflight is not a security boundary.

Transport and redirect behavior is consumer-specific:

| Consumer | Transport and redirects | Deadline |
| --- | --- | --- |
| Generic webhook | Public HTTP is allowed only when no secret header is configured. A secret-bearing webhook requires verified HTTPS, except an explicitly enabled non-production loopback target. Redirects are not followed. | `ALERTS_WEBHOOK_TIMEOUT_MS`; one budget covers the bounded retry series and its backoff. |
| Slack / Discord webhook | Verified HTTPS is required, with the same non-production loopback exception. Redirects are not followed. | `ALERTS_WEBHOOK_TIMEOUT_MS`. |
| HTTP monitor | Public HTTP or HTTPS is allowed. Destination and socket-DNS policy still apply, and redirects are not followed. | The monitor's own timeout when set, otherwise `MONITORS_HTTP_TIMEOUT_MS`. |
| S3-compatible backup | The configured endpoint requires verified HTTPS, except explicit non-production loopback. The SDK uses the policy-enforcing socket lookup and no application redirect allowance. | A fixed 30,000 ms application deadline covers sidecar validation, both uploads, and retries; expiry aborts the operation and triggers client/handler cleanup. It is not an environment variable. |
| PostgreSQL warehouse | Only `postgres://` and `postgresql://` URLs are accepted. Missing `sslmode` is upgraded to verified TLS; if supplied, it must be `sslmode=verify-full`. Plaintext is allowed only for an explicit non-production literal-loopback destination. The original hostname is retained for certificate verification/SNI. | Connection, statement, lock, query, transaction-idle, and total destination bounds described below. |

The configured integration deadlines are positive milliseconds:

| Variable | Default | Effect |
| --- | ---: | --- |
| `ALERTS_WEBHOOK_TIMEOUT_MS` | `5000` | Total generic/Slack/Discord webhook delivery budget, including bounded retries and backoff. |
| `MONITORS_HTTP_TIMEOUT_MS` | `5000` | Default HTTP monitor request budget; a saved monitor timeout can replace it. |
| `WAREHOUSE_CONNECTION_TIMEOUT_MS` | `5000` | Bounds PostgreSQL connection establishment. |
| `WAREHOUSE_STATEMENT_TIMEOUT_MS` | `30000` | Server-side PostgreSQL statement limit. |
| `WAREHOUSE_LOCK_TIMEOUT_MS` | `5000` | Server-side PostgreSQL lock wait limit. |
| `WAREHOUSE_QUERY_TIMEOUT_MS` | `35000` | Client-side limit for each PostgreSQL query. |
| `WAREHOUSE_TOTAL_TIMEOUT_MS` | `60000` | One destination budget beginning before DNS/connect and covering table setup, transaction writes, and commit; expiry forces socket/client teardown. |

Warehouse timeout values are limited to 900,000 ms. The total must be strictly greater than every component, and the query timeout must be at least the statement timeout; incoherent configuration fails startup with `warehouse_export_timeouts_incoherent`. A total timeout destroys the socket, ends the client, records a sanitized `warehouse_destination_timeout`, and allows the scheduler to continue with the next destination. Other safe operator-visible examples include `outbound_address_forbidden`, `Webhook delivery timed out`, and `backup_s3_upload_failed`. Real credentials, secret headers, and credential-bearing URLs must never appear in an error example or log.

## Network Audit Evidence

- **PER-507:** config and API tests cover empty and exact trusted-proxy lists, spoofed versus trusted forwarding, right-to-left identity derivation, IPv6 normalization, global limiting before database-backed CORS work, Redis-backed production counters, and the bounded 60-second/1,000-entry origin cache.
- **PER-508:** config and worker/API tests cover public and exact-private CIDR policy, forbidden special and transition-encoded addresses, all-answer validation in the actual socket lookup, redirect rejection, verified transport rules, warehouse URL/TLS handling, and connection/query/total deadline teardown while later destinations continue.

These controls are application-layer verification evidence. SignalMonitor does not provision a deployment firewall, egress ACL, reverse proxy, WAF, or managed rate-limiting edge. Operators still own those controls and should use them as independent defense in depth.

## Backups

Enable backups with:

```dotenv
BACKUPS_ENABLED=true
BACKUPS_INTERVAL_HOURS=24
BACKUPS_LOCAL_DIR=/var/lib/sigmon/backups
BACKUPS_RETENTION_DAYS=14
```

The scheduler role owns both scheduled and API-requested backup execution. An administrator action in the console, or `POST /system/actions/backup`, enqueues a maintenance job and returns `202 Accepted` only after Redis accepts it. It does not mean a dump has finished. Requests in the same UTC minute use the same one-minute dedupe id. Treat the returned `jobId` as a correlation value, not as a job-status endpoint; inspect the eventual latest success or failure in `/system/health` or the console System Health screen. The scheduler consumes manual jobs even when scheduled backups are disabled.

Manual and scheduled jobs call the same worker runtime, advisory lock, `pg_dump`, checksum, optional upload, retention, and backup-run recording path. The same advisory lock prevents a schedule tick, queued request, or operator CLI from creating concurrent dumps.

For split deployments, `WORKER_ROLE=scheduler` must have Redis and Postgres access plus the durable `BACKUPS_LOCAL_DIR` mount. `WORKER_ROLE=queue` handles telemetry only and does not need the backup volume. The API never writes dump files and does not need the backup volume.

For an operator-controlled one-off backup, run the worker CLI:

```sh
docker compose run --rm worker pnpm backup:create
```

`pnpm backup:create` executes the worker backup path directly; it does not enqueue an API maintenance job. Run it from the worker image or another trusted operational environment with the intended `DATABASE_URL`, full worker configuration, and persistent `BACKUPS_LOCAL_DIR`. A native checkout without the production backup mount can create a valid dump in the wrong local filesystem. Database credentials and supported libpq settings are passed to `pg_dump` through its scrubbed child environment, not process arguments; failures expose only stable redacted categories.

Optional S3-compatible backup upload:

```dotenv
BACKUPS_S3_ENABLED=true
BACKUPS_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKUPS_S3_REGION=auto
BACKUPS_S3_BUCKET=sigmon-backups
BACKUPS_S3_ACCESS_KEY_ID=<access-key-id>
BACKUPS_S3_SECRET_ACCESS_KEY=<secret-access-key>
BACKUPS_S3_PREFIX=production/sigmon
```

Use a private bucket and lifecycle rules for remote retention.

## Restore

Restore is destructive. Stop writers first:

```sh
docker compose stop api worker
docker compose run --rm worker pnpm backup:restore -- /var/lib/sigmon/backups/sigmon-YYYYMMDDTHHMMSSZ.dump --yes
docker compose start api worker
pnpm run doctor -- --compose --api-url http://localhost:3000
```

Practice restore in a disposable environment before relying on it during an incident.

## Source-map Storage And Reconciliation

The API writes source-map files and the worker performs retention, so both roles require one authoritative persistent storage root. Compose mounts `source_map_data:/var/lib/sigmon/source-maps` into both. On startup the API validates the root, creates the exact regular-file marker `.sigmon-source-map-storage` when it is absent, validates its exact versioned contents, and only then begins listening. Compose waits for API health before starting the worker; the worker opens the existing root in require-only mode and never creates or repairs the marker. Preserve this API-first initialization order in split deployments.

If the root is absent, unreadable, changed, or has a missing, wrong, partial, special, or symlinked marker, source-map retention fails closed with `source_map_storage_unavailable`. It does not list candidates or delete a file, artifact metadata, or cached resolution. A validated authoritative root may still contain metadata for an individually absent file; normal retention treats that file as already absent and can soft-delete its metadata.

Secure production local storage requires Linux procfs at `/proc/self/fd`. Artifact traversal and mutation stay bound to an opened root capability rather than trusting a previously checked path. Native non-Linux production fails closed because Node does not expose an equivalent descriptor-relative no-follow boundary. Non-Linux development and test support only new direct-root flat-v2 artifacts and reject nested legacy artifact access. Run production with the documented Linux container rather than bypassing these checks.

Reconciliation is an explicit operator command and never runs automatically during startup, migration, retention, or rollout. It validates the root marker before opening the database and does not run migrations. First run the read-only default:

```sh
docker compose run --rm worker pnpm source-maps:reconcile
```

Review its counts before enabling mutation. Apply mode accepts only one exact `--apply` argument:

```sh
docker compose run --rm worker pnpm source-maps:reconcile -- --apply
```

Both modes scan stable pages of 100. Output contains bounded counts and metadata ids only, never file contents; reported metadata-id samples are capped at 100. Apply performs a complete dry preflight, then uses the same dedicated source-map advisory lock as retention, revalidates authority immediately before mutation, conditionally soft-deletes metadata whose file is absent, and deletes only unreferenced regular files older than the scan-start one-hour orphan grace. Lock contention exits non-zero without mutation. A concurrently running upload, a fresh orphan, a symlink, a special file, or a changed marker is not deleted.

For recovery, stop the API and every worker role, snapshot or copy the source-map volume, and verify that all roles mount the same backing store and path. Inspect `.sigmon-source-map-storage` as a regular non-symlink file with the expected contents before any offline repair. A genuinely missing marker can be recreated by an API-first restart; a wrong or partial marker is deliberately not overwritten and needs an operator-reviewed offline repair. Start the API, wait for health, then start workers and run read-only reconciliation before considering `--apply`. Do not run `docker compose down -v` or `docker volume rm` as a repair step: neither source-map recovery nor this release requires volume removal.

## Upgrade

For the release that introduces opaque sessions and encrypted integration credentials, use this order. It deliberately stops every writer before schema and data migration. If queue and scheduler roles are separate applications, stop both as well as the API.

Before these commands, provision `DATA_ENCRYPTION_KEY` directly in the secret manager for the API, worker, scheduler, and one-off migration container. Do not generate it with a command that prints it. Preserve the pre-upgrade backup and the matching encryption-key escrow separately.

```sh
docker compose run --rm worker pnpm backup:create
git pull
pnpm install
docker compose build
docker compose stop api worker
docker compose run --rm api pnpm db:migrate
docker compose run --rm api pnpm secrets:migrate --kind all --batch-size 100
docker compose run --rm api pnpm secrets:migrate --kind all --batch-size 100
docker compose up -d
pnpm run doctor -- --compose --api-url http://localhost:3000
```

The first migration command may report non-zero `migrated` or `rotated` counts. The confirmation run must report `{"migrated":0,"rotated":0}` before the release is considered migrated. Then verify a fresh password login, Google OAuth if enabled, one webhook delivery, one warehouse export, and a backup. Existing signed human cookies are expected to fail; users must log in again.

Migration `0049_auth_sessions.sql` creates the empty session store, which is why old signed cookies cannot survive. Migration `0050_encrypted_integration_secrets.sql` adds the staged encrypted columns without dropping the plaintext columns. Notification delivery URLs and optional secret headers are both in the notification migration inventory. Do not treat the legacy columns' continued schema presence as permission to write or read plaintext: new writes clear plaintext, and privileged work refuses legacy plaintext until the data migration succeeds.

The migration is restartable. If it is interrupted, keep all services stopped and run the same command again; committed rows are recognized as current, and an interrupted row's transaction is rolled back. Do not manually clear plaintext or edit envelopes.

### Encryption-key rotation

1. Create the new 32-byte key directly in the approved secret manager.
2. Configure the new key as `DATA_ENCRYPTION_KEY` and the old key as `DATA_ENCRYPTION_KEY_PREVIOUS` on every API, worker, scheduler, and migration process.
3. Restart the processes so they share the same keyring, then run the migration and its confirmation pass:

   ```sh
   docker compose run --rm api pnpm secrets:migrate --kind all --batch-size 100
   docker compose run --rm api pnpm secrets:migrate --kind all --batch-size 100
   ```

4. Require the second run to report `{"migrated":0,"rotated":0}`. Exercise webhook and warehouse controls before removing the previous key.
5. Remove `DATA_ENCRYPTION_KEY_PREVIOUS` from every service and restart. Retain the old key according to the backup-retention policy for backups created while it was current.

Never remove the previous key after only a non-zero rotation run. A crash after its last reported row or a service that missed the new keyring could otherwise leave unreadable ciphertext.

### Failure and recovery

| Symptom | Safe behavior | Recovery |
| --- | --- | --- |
| Redis unavailable during login | Login fails closed with `503 auth_unavailable`; the account guard is not bypassed. | Restore Redis, confirm it is reachable, then retry. Do not disable the quota to regain login. Existing Postgres-backed sessions remain valid unless another dependency is unavailable. |
| Current encryption key absent or malformed | Production configuration refuses startup. | Restore the exact current key from the deployment secret manager or tested key escrow. |
| Key id unknown after a key change | Privileged integration work refuses to decrypt. | Restore the matching current/previous keyring. Do not create a replacement key and expect it to decrypt existing rows. |
| Ciphertext or associated data tampered | AES-GCM authentication fails and the value is not used. | Restore the row from a trusted backup or replace the credential through the normal admin control plane, then investigate database access. |
| Legacy plaintext remains | Privileged webhook or warehouse reads fail with `legacy_plaintext_secret_present`; there is no plaintext fallback. | Stop writers and rerun `pnpm secrets:migrate --kind all --batch-size 100` until the confirmation pass is zero. |
| Migration interrupted or a row fails verification | The row transaction rolls back; already committed rows remain safe. | Correct the reported safe error, preserve the same keyring, and rerun the command. It resumes without re-encrypting current rows. |
| Old or copied session cookie rejected | Legacy, malformed, expired, revoked, logged-out, password-invalidated, and archived-user cookies do not authenticate. | Use a fresh password or Google OAuth login. Do not restore the legacy signed-cookie path. |
| Encryption key lost | Ciphertext cannot be recovered from the database or backup alone. | Restore both a database backup and its matching escrowed key. If neither matching key exists, replace affected external credentials and save them again through the admin control plane. |

## Rollback

Rollback only undoes application code. Migrations are forward-only and run inside one transaction at API startup, so rolling code back does not undo a schema change. After the secret migration clears plaintext, an older plaintext-only application is not a safe rollback target even though migration 0050 left additive columns in place. Restore the pre-upgrade backup and its matching configuration, or perform an explicitly reviewed reverse data migration while the correct encryption key is still available; never point old code at ciphertext-only rows and never drop the keyring first.

For a code-only rollback, go to a known-good commit and rebuild:

```sh
git checkout <previous-tag-or-commit>
pnpm install
docker compose build
docker compose stop api worker
docker compose up -d
pnpm run doctor -- --compose --api-url http://localhost:3000
```

Return to `main` (`git checkout main`) once you've confirmed the rollback resolved the issue, so the next `git pull` in the Upgrade flow above works normally.

## Sizing Guidance

Start small and scale from measured pressure:

| Install size | Suggested shape |
| --- | --- |
| Trial / low traffic | 1 vCPU, 2 GB RAM, single `WORKER_ROLE=all`, 10-20 GB disk. |
| Small production | 2 vCPU, 4 GB RAM, split API and worker/scheduler, 50+ GB disk. |
| Higher ingestion | Separate queue worker and scheduler, increase Redis/Postgres resources, lower retention windows, and monitor queue depth. |

Watch the console `System Health` screen for API, worker, scheduler, Postgres, Redis, queue depth, retention, backups, SMTP, and deployment configuration.

## Operational Checks

Before deploys or upgrades:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
pnpm smoke:compose
```

After deploys:

```sh
curl https://sigmon.example.com/health
curl https://sigmon.example.com/ready
```

Then open `System Health` in the console and confirm API, worker, scheduler, Postgres, Redis, retention, backups, monitors, alerts, and SMTP are in the expected state.

## Known Limits

- No official Helm chart or Kubernetes manifest yet.
- No hosted SaaS control plane.
- No per-project RBAC, billing, or invite workflow.
- Source maps are stored on local volume storage.
- Backups cover Postgres. Operators must also protect source-map volume data if source maps are business-critical.
- The Elastic License 2.0 provides no warranty or managed SLA.

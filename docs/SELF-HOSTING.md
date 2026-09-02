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
  - `WORKER_ROLE=scheduler` for retention, backups, alerts, monitors, system health samples, and warehouse exports.

Use split worker/scheduler services when ingestion volume or operational jobs need independent restarts and health checks.

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
```

Browser SDK telemetry from another origin also needs that app origin in `Project Settings > Browser origins` or the bootstrap `BROWSER_CORS_ORIGINS` environment variable.

## Persistent Data

Docker Compose defines these persistent volumes:

| Volume | Contents |
| --- | --- |
| `postgres_data` | Primary Postgres database. |
| `redis_data` | Redis append-only data. |
| `backup_data` | Local backup dumps and SHA-256 sidecars. |
| `source_map_data` | Uploaded source-map artifacts. |

Do not delete these volumes unless you intentionally want to wipe the install.

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

## Backups

Enable backups with:

```dotenv
BACKUPS_ENABLED=true
BACKUPS_INTERVAL_HOURS=24
BACKUPS_LOCAL_DIR=/var/lib/sigmon/backups
BACKUPS_RETENTION_DAYS=14
```

Run a manual backup:

```sh
docker compose run --rm worker pnpm backup:create
```

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

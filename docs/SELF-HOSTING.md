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

Create a backup before every upgrade:

```sh
docker compose run --rm worker pnpm backup:create
git pull
pnpm install
docker compose build
docker compose stop api worker
docker compose run --rm api pnpm db:migrate
docker compose up -d
pnpm run doctor -- --compose --api-url http://localhost:3000
```

If you split queue and scheduler services outside Compose, stop and restart both service roles around migrations.

## Rollback

Rollback only undoes application code. Migrations are forward-only and run inside one transaction at API startup, so rolling code back does not undo a schema change. If the upgrade you're rolling back applied a migration, restore the backup you took before that upgrade (see Restore above) instead of just checking out older code against the already-migrated database.

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


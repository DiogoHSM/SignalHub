# Phase 4C Backup and Restore Design

## Source

This design extends `PRD.md` v0.2 and the completed Phase 4A and 4B operational maturity work:

- Worker-owned scheduled operational jobs.
- Postgres operational metadata.
- Authenticated system health.
- Read-only operational console surfaces.
- Self-hosted Docker Compose operation.
- Environment-first configuration.

The approved direction is Postgres backup and restore for self-hosted operators, with Cloudflare R2 documented as the recommended S3-compatible offsite target.

## Product Boundary

In scope:

- Create scheduled Postgres logical backups from the worker process.
- Use `pg_dump` custom format for backups.
- Write every backup to a local backup directory first.
- Optionally upload successful backups to S3-compatible object storage.
- Document Cloudflare R2 configuration as the default S3 example.
- Record backup run metadata in Postgres.
- Show backup status in `/system/health`.
- Show backup status in the existing console `System` panel.
- Add manual backup and restore scripts for operators.
- Mount a local backup volume in Docker Compose.

Out of scope:

- Redis backup.
- Continuous WAL archiving.
- Point-in-time recovery.
- In-app backup download or restore.
- API-triggered restore.
- Worker-triggered restore.
- Client-side backup encryption.
- Automatic deletion of remote S3 backups.
- Object storage for telemetry payloads.
- Backup of non-Postgres services.

## Recommended Approach

Use the worker as the scheduled backup owner, Postgres as the source of status metadata, and operator scripts for manual backup and restore.

The worker already owns scheduled retention and alert jobs. Keeping backup scheduling in the worker avoids adding a new sidecar service and keeps the self-hosted Compose install small. Backup contents stay on disk and optionally in S3-compatible storage; the application database stores only operational metadata about each attempt.

Alternatives considered:

- Manual scripts only: simpler, but weak for self-hosted safety because operators can forget to run them.
- Separate backup sidecar container: clean separation, but adds another runtime component before it is necessary.
- S3-only backups: simpler retention story, but local-first backups are easier to inspect, test, and restore during incidents.

## Configuration

Add backup configuration:

```txt
BACKUPS_ENABLED=true
BACKUPS_INTERVAL_HOURS=24
BACKUPS_LOCAL_DIR=/var/lib/signalhub/backups
BACKUPS_RETENTION_DAYS=14
BACKUPS_S3_ENABLED=false
BACKUPS_S3_ENDPOINT=
BACKUPS_S3_REGION=auto
BACKUPS_S3_BUCKET=
BACKUPS_S3_ACCESS_KEY_ID=
BACKUPS_S3_SECRET_ACCESS_KEY=
BACKUPS_S3_PREFIX=signalhub
```

Validation rules:

- `BACKUPS_INTERVAL_HOURS` must be a positive integer.
- `BACKUPS_RETENTION_DAYS` must be a positive integer.
- `BACKUPS_LOCAL_DIR` must be non-empty when backups are enabled.
- When `BACKUPS_S3_ENABLED=true`, endpoint, bucket, access key id, and secret access key are required.
- S3 credentials must never be returned by API responses, health responses, logs, or console UI.

Cloudflare R2 should be documented as an S3-compatible target:

- Endpoint: `https://<account-id>.r2.cloudflarestorage.com`
- Region: `auto`
- Bucket: private R2 bucket
- Access key: scoped R2 token with object read/write permissions for the backup bucket

## Data Model

Add a `backup_runs` operational table:

- `id`
- `started_at`
- `finished_at`
- `status`: `success` or `failed`
- `trigger`: `scheduled` or `manual`
- `filename`
- `local_path`
- `size_bytes`
- `s3_bucket`
- `s3_key`
- `error_message`
- `created_at`

The table stores metadata only. It must not store backup contents, database URLs, S3 endpoints with credentials, access keys, or secret access keys.

Use indexes for:

- latest backup runs by `started_at`
- successful backup lookups
- failed backup lookups

## Scheduled Backup Flow

1. Worker backup scheduler wakes up every `BACKUPS_INTERVAL_HOURS`.
2. Worker takes a Postgres advisory lock so only one backup runs at a time across worker processes.
3. Worker records a started backup run with trigger `scheduled`.
4. Worker runs `pg_dump` in custom format against `DATABASE_URL`.
5. Worker writes the dump to `BACKUPS_LOCAL_DIR`.
6. Worker records file size and local path.
7. If S3 is enabled, worker uploads the dump to the configured bucket and prefix.
8. Worker marks the run `success` only after local backup creation and required S3 upload have both succeeded.
9. Worker prunes local backup files older than `BACKUPS_RETENTION_DAYS`.
10. Worker records a sanitized failure when any required step fails.

If S3 is enabled, S3 upload failure should fail the backup run. Once an operator configures offsite backup, a local-only backup is not enough to report success.

Remote S3 objects are not automatically pruned in this slice. Operators can use bucket lifecycle rules for remote retention.

## Manual Backup and Restore Flow

Add operator scripts:

```txt
pnpm backup:create
pnpm backup:restore -- <file> --yes
```

Manual backup uses the same backup implementation as the scheduled worker flow and records trigger `manual`.

Restore is intentionally destructive and must never run automatically. The restore script should:

- Require an explicit backup file path.
- Require `--yes`.
- Refuse to run without confirmation.
- Be documented as requiring API and worker shutdown before restore.
- Use `pg_restore` for custom-format dumps.
- Document how to run restore through Docker Compose against the Compose Postgres service.

Restore does not write a `backup_runs` row because restoring from a dump can replace the metadata table itself.

## Health and Console Status

Extend `/system/health` with backup status:

- whether backups are enabled
- backup interval
- local retention days
- whether S3 upload is enabled
- latest successful backup metadata
- latest failed backup metadata
- whether the latest successful backup is stale

Stale backup logic:

- If backups are disabled, stale status is not applicable.
- If backups are enabled and no successful backup exists, report stale.
- If latest success is older than `BACKUPS_INTERVAL_HOURS * 2`, report stale.

The console `System` panel should render backup status in the existing operational health area. It should not expose paths containing secrets, S3 credentials, database URLs, or full environment values. Displaying local filename, size, latest success time, latest failure time, S3 enabled status, and stale status is acceptable.

## Security and Operational Guardrails

- Backup filenames must be timestamped and must not include secrets.
- Backup process logs must not print `DATABASE_URL`, S3 keys, or secret values.
- Failure messages stored in `backup_runs.error_message` must be sanitized.
- S3 credentials remain environment-only.
- Operators should use a private R2 bucket.
- Operators should use scoped R2 credentials limited to the backup bucket.
- The local backup directory should be a Docker volume, not an ephemeral container path.
- API and worker containers should not expose restore endpoints.

## Testing

Required verification:

- Config tests for backup defaults, explicit settings, and missing required S3 settings.
- Repository tests for recording and reading `backup_runs`.
- Worker unit tests for backup success, `pg_dump` failure, S3 upload failure, advisory-lock skip, and local pruning.
- System health tests for backup status, stale status, and redaction.
- Console tests for backup status rendering.
- Script-level tests or focused command tests for restore confirmation behavior.
- `docker compose config --quiet`.
- Full workspace tests and production build before completion.

## Documentation

Update:

- `.env.example`
- `README.md`
- `.claude/docs/ARCHITECTURE.md`
- `.claude/docs/DEPLOYMENT.md`
- `.claude/docs/SECRETS.md`
- `.claude/docs/INFRASTRUCTURE.md`
- `.claude/docs/PROJECT-SUMMARY.md`
- `.claude/docs/UI-UX.md`

Documentation must include:

- How backups run by default.
- How to configure Cloudflare R2.
- How to create a manual backup.
- How to restore from a backup.
- That restore is destructive.
- That API and worker should be stopped before restore.
- That remote retention should be managed with bucket lifecycle rules for this slice.

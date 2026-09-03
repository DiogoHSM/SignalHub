# Backup and Source-map Storage Ownership Design

**Linear:** PER-509, PER-510

## Goal

Keep database credentials out of subprocess arguments, make manual and scheduled backups use one durable worker-owned path, and prevent source-map metadata cleanup when the worker cannot see the authoritative storage volume.

## Non-goals

- A production restore drill, which remains PER-500.
- Replacing local source-map storage with object storage.
- Deleting Docker volumes during rollout.
- Changing source-map upload or resolution matching.

## Backup subprocess credentials

Parse `DATABASE_URL` before invoking `pg_dump` or `pg_restore`. Build a sanitized connection target without username, password, or sensitive query parameters. Pass the username and password through the child environment (`PGUSER`, `PGPASSWORD`) and map supported non-secret libpq settings deliberately. Reject credential-like or unsupported query parameters rather than forwarding them in argv.

Command errors and structured logs contain the binary name and safe host/database metadata only. They never include the raw URL or child environment.

## Worker-owned manual backups

Manual API backup requests enqueue a dedicated maintenance job in Redis and return `202` with a job id. The scheduler/worker is the only process that runs backup creation, checksum, upload, retention, and run recording. The API exposes job/run status through the existing system-health/admin surface rather than reading local dump files.

This avoids requiring the API and worker to share a filesystem in split deployments. Compose retains `backup_data` only on the worker. Queue jobs are idempotent and use the existing backup advisory lock so a manual request and scheduled tick cannot create concurrent dumps.

## Source-map volume authority

Compose mounts `source_map_data` into both API and worker at the same path because the API writes and the worker performs retention. The storage root contains a Sigmon marker created by the API after validating the directory. Retention requires the root directory and marker before listing expired artifacts.

If the root or marker is unavailable, retention records `source_map_storage_unavailable` and does not delete files or metadata. Once the authoritative root is available, an individual missing artifact file is treated as already absent and its metadata may be soft-deleted. A present file is removed before metadata. Symlink and path-containment protections remain.

Split deployments must mount the same persistent source-map storage into both roles or disable source-map retention. Documentation states that separately named local volumes are not shared storage.

## Reconciliation

A read-only reconciliation command reports metadata-without-file and file-without-metadata counts after validating the marker. A separate explicit `--apply` mode may soft-delete missing-file metadata and remove orphan files in bounded batches. It never runs automatically during the migration release.

## Acceptance criteria

- Raw database credentials are absent from process arguments and error output.
- A manual API request results in a worker-created durable backup with checksum and normal retention/upload behavior.
- Scheduled and manual requests cannot run concurrently.
- Source-map cleanup stops without metadata mutation when the volume is absent or wrong.
- Available-volume cleanup removes files and metadata together and handles already-absent files deterministically.
- Reconciliation defaults to read-only.

## Verification

Add backup argv/environment unit tests, queue integration tests, worker lock tests, Compose contract tests, source-map root/marker/present/absent/inaccessible tests, reconciliation dry-run/apply tests, and documentation checks. Run Compose configuration and the smoke harness after focused tests when Docker is available.

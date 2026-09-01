# Backup and Source-map Storage Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove database credentials from backup subprocess arguments, execute manual backups in the worker, and fail source-map retention closed when authoritative storage is unavailable.

**Architecture:** Add a safe libpq subprocess descriptor, a dedicated BullMQ maintenance queue consumed by the worker, and a source-map root marker checked before destructive cleanup. Add a separate reconciliation command that is read-only unless `--apply` is explicit.

**Tech Stack:** TypeScript, Node child_process/fs, BullMQ/ioredis, PostgreSQL/Kysely, Docker Compose, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-operational-storage-design.md`

## Global Constraints

- Raw `DATABASE_URL`, passwords, and credential query parameters never appear in argv, errors, or logs.
- API manual backup requests enqueue work and return `202`; only worker/scheduler processes create backup files.
- Manual and scheduled backups share the existing advisory lock, checksum, upload, retention, and run-recording path.
- Source-map metadata is never deleted when the root or Sigmon marker is unavailable.
- Reconciliation defaults to read-only and never runs automatically during migration.
- No Docker volume is deleted by this work.

---

### Task 1: Safe backup subprocess descriptor

**Files:**
- Create: `apps/worker/src/libpq-subprocess.ts`
- Create: `apps/worker/test/libpq-subprocess.test.ts`
- Modify: `apps/worker/src/backups.ts`
- Modify: `apps/worker/test/backups.test.ts`
- Modify: `scripts/backup-restore.ts`

**Interfaces:**
- Produces: `buildLibpqSubprocess(databaseUrl): { argsConnection: string; env: NodeJS.ProcessEnv; safeLabel: string }`.
- Consumes: `pg_dump` and `pg_restore` spawn wrappers.

- [ ] **Step 1: Write failing argv tests**

```ts
const result = buildLibpqSubprocess("postgres://alice:p%40ss@db.test:5432/sigmon?sslmode=require");
expect(result.argsConnection).not.toContain("alice");
expect(result.argsConnection).not.toContain("p%40ss");
expect(result.env.PGUSER).toBe("alice");
expect(result.env.PGPASSWORD).toBe("p@ss");
expect(result.safeLabel).toBe("db.test:5432/sigmon");
```

Reject password/token/secret query names and unsupported libpq parameters. Prove spawned argv and sanitized errors omit the original URL.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/worker/test/libpq-subprocess.test.ts apps/worker/test/backups.test.ts`

Expected: current spawn arguments retain the connection URL.

- [ ] **Step 3: Implement and wire**

Parse with `URL`, allow only `sslmode`, `sslrootcert`, `sslcert`, `sslkey`, `connect_timeout`, and `application_name`; map each deliberately to libpq environment. Reject any query key containing `password`, `pass`, `token`, `secret`, `credential`, or `key` unless it is one of the explicitly supported TLS path keys. Pass a clean env object to both dump and restore.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm vitest run apps/worker/test/libpq-subprocess.test.ts apps/worker/test/backups.test.ts`

```bash
git add apps/worker/src/libpq-subprocess.ts apps/worker/test/libpq-subprocess.test.ts apps/worker/src/backups.ts apps/worker/test/backups.test.ts scripts/backup-restore.ts
git commit -m "fix(backups): keep database credentials out of argv"
```

### Task 2: Worker-owned maintenance queue

**Files:**
- Create: `packages/queues/src/index.ts`
- Create: `packages/queues/src/maintenance-queue.ts`
- Create: `packages/queues/test/maintenance-queue.test.ts`
- Modify: `tsconfig.base.json`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/test/system.test.ts`
- Modify: `apps/worker/src/main.ts`
- Create: `apps/worker/src/maintenance-worker.ts`
- Create: `apps/worker/test/maintenance-worker.test.ts`

**Interfaces:**
- Produces: `MaintenanceJob = { kind: "backup.create"; requestedBy: string; requestedAt: string }`, queue producer, and worker handler exported through `@sigmon/queues`.
- Consumes: existing Redis connection, backup advisory lock, `runBackupOnce`.

- [ ] **Step 1: Write failing API/worker tests**

```ts
it("enqueues a manual backup and returns 202", async () => {
  const response = await adminPost(app, "/admin/system/backups/run");
  expect(response.statusCode).toBe(202);
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: "backup.create", requestedBy: "usr_1" }));
});

it("runs a queued backup through the shared locked path", async () => {
  await handleMaintenanceJob(backupJob, runtime);
  expect(runtime.runBackupOnce).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/queues/test/maintenance-queue.test.ts apps/api/test/system.test.ts apps/worker/test/maintenance-worker.test.ts`

Expected: API still imports/runs worker backup directly.

- [ ] **Step 3: Implement queue and worker**

Create a package entrypoint that re-exports the existing telemetry queue and the new maintenance queue, then point the `@sigmon/queues` path alias at that entrypoint. Use queue name `sigmon-maintenance`, job id `backup-create:<UTC-minute>` for retry/idempotency, attempts 3 with exponential backoff, and remove-on-complete/fail bounds matching telemetry queue conventions. The worker handler calls the same `runBackupOnce` runtime used by the scheduler; the advisory lock handles overlap.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm vitest run packages/queues/test/maintenance-queue.test.ts apps/api/test/system.test.ts apps/worker/test/maintenance-worker.test.ts apps/worker/test/backups.test.ts`

```bash
git add packages/queues/src/index.ts packages/queues/src/maintenance-queue.ts packages/queues/test/maintenance-queue.test.ts tsconfig.base.json apps/api/src/main.ts apps/api/src/routes/admin.ts apps/api/test/system.test.ts apps/worker/src/main.ts apps/worker/src/maintenance-worker.ts apps/worker/test/maintenance-worker.test.ts
git commit -m "fix(backups): run manual backups in worker"
```

### Task 3: Source-map root marker and fail-closed cleanup

**Files:**
- Create: `apps/api/src/source-maps/storage-root.ts`
- Create: `apps/api/src/source-maps/storage-root.test.ts`
- Modify: `apps/api/src/source-maps/storage.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/worker/src/source-map-retention.ts`
- Modify: `apps/worker/test/telemetry-worker.test.ts`
- Modify: `docker-compose.yml`
- Modify: `scripts/smoke-compose.test.ts`

**Interfaces:**
- Produces: marker `.sigmon-source-map-storage`; `assertSourceMapStorageRoot(localDir, mode)`.
- Consumes: existing containment/symlink checks and retention error accounting.

- [ ] **Step 1: Write failing storage-state tests**

Test present root/marker/file, present root/marker/missing file, absent root, root without marker, unreadable root, and marker symlink. For unavailable/wrong roots, assert neither `removeFile` nor `softDeleteArtifact` runs.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/src/source-maps/storage-root.test.ts apps/worker/test/telemetry-worker.test.ts scripts/smoke-compose.test.ts`

Expected: missing files can still lead to metadata deletion without proving volume authority, and Compose lacks the worker mount.

- [ ] **Step 3: Implement marker lifecycle**

API startup validates/creates the directory and writes the exact marker contents `sigmon-source-map-storage-v1\n` with exclusive-safe semantics. Worker retention requires a regular file with exact contents before listing/deleting. Marker/root errors become `SourceMapRetentionError("source_map_storage_unavailable", zeroCounts, cause)`.

Mount `source_map_data:/var/lib/sigmon/source-maps` read-write into the worker and assert both services use the same named volume/path in the Compose contract test.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm vitest run apps/api/src/source-maps/storage-root.test.ts apps/worker/test/telemetry-worker.test.ts scripts/smoke-compose.test.ts`

```bash
git add apps/api/src/source-maps/storage-root.ts apps/api/src/source-maps/storage-root.test.ts apps/api/src/source-maps/storage.ts apps/api/src/main.ts apps/worker/src/source-map-retention.ts apps/worker/test/telemetry-worker.test.ts docker-compose.yml scripts/smoke-compose.test.ts
git commit -m "fix(sourcemaps): verify authoritative retention volume"
```

### Task 4: Read-only source-map reconciliation

**Files:**
- Create: `scripts/reconcile-source-maps.ts`
- Create: `scripts/reconcile-source-maps.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm source-maps:reconcile` and explicit `--apply` mode.
- Consumes: Task 3 root validation plus DB artifact listing and filesystem traversal.

- [ ] **Step 1: Write failing dry-run/apply tests**

```ts
expect(await reconcile(runtime({ apply: false }))).toEqual({ metadataWithoutFile: 1, filesWithoutMetadata: 1, metadataDeleted: 0, filesDeleted: 0 });
expect(removeFile).not.toHaveBeenCalled();
expect(softDelete).not.toHaveBeenCalled();
```

Add apply-mode bounded deletion and invalid-marker refusal.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run scripts/reconcile-source-maps.test.ts`

Expected: command does not exist.

- [ ] **Step 3: Implement bounded reconciliation**

Default `apply=false`; require literal `--apply`; use batch size 100; never follow symlinks; print counts and ids only, never file contents. Apply deletes a present orphan file or soft-deletes missing-file metadata after the root marker passes.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run scripts/reconcile-source-maps.test.ts`

```bash
git add scripts/reconcile-source-maps.ts scripts/reconcile-source-maps.test.ts package.json
git commit -m "feat(sourcemaps): add safe storage reconciliation"
```

### Task 5: Documentation and slice verification

**Files:**
- Modify: `docs/SELF-HOSTING.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: deployment/migration/runbook evidence for PER-509/PER-510.

- [ ] **Step 1: Document ownership and recovery**

Describe worker-owned backups, asynchronous `202` behavior, shared source-map storage, marker failures, read-only reconciliation, and that volumes are never auto-removed.

- [ ] **Step 2: Run focused verification**

Run: `pnpm vitest run apps/worker/test/libpq-subprocess.test.ts apps/worker/test/backups.test.ts packages/queues/test/maintenance-queue.test.ts apps/api/test/system.test.ts apps/worker/test/maintenance-worker.test.ts apps/api/src/source-maps/storage-root.test.ts apps/worker/test/telemetry-worker.test.ts scripts/reconcile-source-maps.test.ts scripts/smoke-compose.test.ts`

Run: `docker compose config --quiet`

Expected: all tests PASS and Compose config exits 0.

- [ ] **Step 3: Run builds and commit**

Run: `pnpm --filter @sigmon/queues build`

Run: `pnpm --filter @sigmon/api build`

Run: `pnpm --filter @sigmon/worker build`

```bash
git add docs/SELF-HOSTING.md README.md
git commit -m "docs(operations): define backup and source-map ownership"
```

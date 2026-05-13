# Phase 5E Source Map Retention Design

## Summary

Add worker-owned retention for local source-map artifacts.

Phase 5B added local-first source-map storage and on-demand stack resolution. Phase 5D added CI uploads. That makes source maps operationally useful, but a self-hosted install still needs bounded disk growth. Phase 5E adds global, env-configured source-map retention that deletes expired artifact metadata, cached stack resolutions, and local files through the existing worker retention flow.

This phase is retention-only. It does not add object storage, Cloudflare R2, source-code viewing, source-map indexing, per-project retention policies, or manual cleanup UI.

## Goals

- Prevent unbounded growth of local source-map storage.
- Keep source-map retention global and env-configured for the first slice.
- Reuse the existing worker retention scheduler, advisory lock, and `retention_runs` reporting model.
- Delete expired source-map artifact metadata, cached `error_stack_resolutions`, and local files together.
- Surface source-map retention policy and deleted counts through existing System health retention data.
- Keep file deletion failures visible instead of silently orphaning local storage.
- Document the new settings and operational behavior for self-hosted operators.

## Non-Goals

- Object storage or Cloudflare R2 support for source-map artifacts.
- Bucket lifecycle integration.
- Source-code viewer or rendering `sourcesContent`.
- Per-project, per-environment, or per-release retention controls.
- Admin UI for changing retention policy.
- Manual prune button or standalone cleanup command.
- Cross-release source-map matching or artifact pinning.
- Retention for source-map upload tokens.

## Approach Options

### Recommended: Extend Existing Retention

Add source-map retention to the current worker-owned retention flow. Extend config, repository deletion helpers, `retention_runs`, System health, and docs.

This is the best fit because retention is already a worker concern in SignalHub. Operators get one scheduler, one status surface, and one place to reason about cleanup behavior.

### Alternative: Separate Source-Map Retention Subsystem

Create a dedicated scheduler and `source_map_retention_runs` table. This gives conceptual separation, but it adds more operational surfaces for a narrow first slice and duplicates existing retention mechanics.

### Alternative: Manual Cleanup Only

Add an admin action or CLI command to prune old source maps. This is simpler than scheduling, but weaker for self-hosted safety because operators must remember to run it.

## Configuration

Add source-map retention settings to `packages/config`:

```txt
SOURCE_MAPS_RETENTION_ENABLED=true
SOURCE_MAPS_RETENTION_DAYS=180
SOURCE_MAPS_RETENTION_BATCH_SIZE=100
```

Defaults:

- `SOURCE_MAPS_RETENTION_ENABLED=true`
- `SOURCE_MAPS_RETENTION_DAYS=180`
- `SOURCE_MAPS_RETENTION_BATCH_SIZE=100`

Rules:

- Source-map retention is controlled separately from `RETENTION_ENABLED`, but it runs inside the same worker retention scheduler.
- If `RETENTION_ENABLED=false`, the scheduler does not run and source-map retention also does not run.
- If `SOURCE_MAPS_RETENTION_ENABLED=false`, telemetry retention can still run while source-map artifact cleanup is skipped.
- Values must be positive integers where applicable.

## Data Model

Extend `retention_runs` rather than adding a new table.

Add policy fields:

```txt
source_maps_enabled boolean
source_maps_days integer
source_maps_batch_size integer
```

Add deleted-count fields:

```txt
deleted_source_map_artifacts integer
deleted_source_map_files integer
```

Semantics:

- `deleted_source_map_artifacts` counts metadata rows successfully removed.
- `deleted_source_map_files` counts local files successfully removed.
- In normal operation these counts should match.
- If cleanup fails after some work, the run is recorded as failed with the partial counts available only if implementation can preserve them safely without hiding the failure. It is acceptable for failed runs to record zero source-map counts in the first implementation, as long as the error is visible.

## Retention Flow

The worker continues to call the existing retention scheduler. During each locked retention run:

1. Delete expired telemetry using the existing policy.
2. If source-map retention is enabled, find source-map artifacts where `created_at` is older than the source-map cutoff.
3. Select at most `SOURCE_MAPS_RETENTION_BATCH_SIZE` artifacts per run.
4. For each selected artifact, delete cached stack resolutions, delete the local file, and mark/delete the artifact metadata through the repository boundary.
5. Record telemetry and source-map cleanup counts in `retention_runs`.

The cutoff is based on `source_map_artifacts.created_at`, not release name or upload token activity.

## File Deletion Safety

Source-map retention must not silently orphan local files or metadata.

Rules:

- File paths must be resolved through the same source-map storage path safety helpers used by artifact deletion.
- Cleanup must only delete files under `SOURCE_MAPS_LOCAL_DIR`.
- If a file is already missing, retention may treat that file as deleted and continue removing metadata. This supports recovery from manual filesystem cleanup.
- If deleting a present file fails because of permissions, path safety, or filesystem errors, the retention run should fail visibly and record a sanitized error message.
- Metadata should not be removed before the corresponding file deletion path has either succeeded or been confirmed missing.

This favors conservative cleanup over hiding storage problems.

## Repository Boundaries

Add source-map retention helpers near the existing source-map repository/storage boundary:

- A DB helper to list expired source-map artifacts by cutoff and batch size.
- A DB helper to remove a source-map artifact and its cached resolutions in a transaction.
- A storage-level worker helper that combines safe file deletion with metadata deletion.

The worker should not hand-roll SQL or path manipulation directly. It should call repository/storage functions with clear inputs and testable behavior.

## System Health

Extend the retention portion of `GET /system/health`:

- Include source-map retention policy in `retention.policy`.
- Include source-map deleted counts in `retention.lastRun.deleted`.

The console `System` panel should show the source-map policy/counts in the existing retention card if space allows. This should stay compact and operational; no new top-level mode or separate retention page.

## Documentation

Update:

- `.env.example`
- `README.md`
- `.claude/docs/SECRETS.md`
- `.claude/docs/DEPLOYMENT.md`
- `.claude/docs/ARCHITECTURE.md`
- `.claude/docs/PROJECT-SUMMARY.md`
- `.claude/docs/INFRASTRUCTURE.md`
- `.claude/docs/UI-UX.md` if the System panel display changes
- `CLAUDE.md` if source-map retention becomes a project convention
- versioned memory

Docs should state:

- Source-map retention is local-storage cleanup.
- It is global/env-configured in this release line.
- It deletes local artifact files, metadata, and cached stack resolutions.
- Object storage lifecycle remains deferred.

## Error Handling

- Configuration errors fail startup through the existing config parser.
- Retention lock contention skips the run as today.
- Source-map file deletion failures fail the retention run with sanitized error text.
- Missing local files do not fail cleanup.
- DB failures fail the run and should not be masked.
- System health should surface failed retention runs through the existing retention failure status path.

## Testing

Coverage should include:

- Config defaults and overrides for source-map retention settings.
- Migration shape for new `retention_runs` columns.
- Repository helper lists only expired artifacts and respects batch size.
- Retention deletes cached stack resolutions and artifact metadata.
- Retention deletes local files under `SOURCE_MAPS_LOCAL_DIR`.
- Missing local file is tolerated.
- File deletion failure records a failed retention run.
- Disabled source-map retention leaves artifacts untouched while telemetry retention can still run.
- System health serializes source-map retention policy and deleted counts.
- Console System panel renders source-map retention counts/policy if UI is updated.

Final verification should run:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor -- --env-file /tmp/signalhub-doctor.env
```

## Open Decisions

None. Phase 5E is retention-only, global env-only, and implemented by extending the existing retention flow and `retention_runs` model.

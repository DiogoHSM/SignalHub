# Task 5 report — encrypted integration credentials

## Status and commits

- Status: review round 1 implemented; all scoped security, regression, migration, CLI, and exact owning-package build gates pass.
- Original Task 5 commit: `5878811` (`fix(security): encrypt privileged integration credentials`).
- Review fix: this commit (`fix(security): isolate integration secret boundaries`).
- The inherited Task 3 build repair in `b2830a8` is preserved unchanged.
- No push, merge, publish, Linear update, worktree removal, or unrelated cleanup was performed.

## Security boundary

- Warehouse create and secret-changing update operations encrypt before persistence and save a redacted preview alongside the ciphertext.
- Ordinary warehouse create/list/non-secret-update mapping never decrypts stored credentials. It needs no `SecretBox` to return metadata, remains usable for unknown-key or malformed ciphertext, and returns neither plaintext nor ciphertext.
- API list/create/update routes defensively strip both plaintext and ciphertext-shaped properties before serialization.
- Only explicit privileged execution reads decrypt warehouse credentials; they retain exact table/row/field AAD and fail closed.
- The migration candidate scan reads IDs only. Every row is reloaded with `SELECT ... FOR UPDATE`; legacy/current/previous-key classification, decrypt/authenticate, encrypt/verify, preview derivation, persistence, and plaintext clearing occur in that same transaction.
- The migration CLI imports `loadConfig` and `SecretBox` only from the public `@sigmon/config` entrypoint. The root declares the workspace dependency, and the config package exports its public entrypoint.

## TDD evidence

### Control-plane RED/GREEN

Command:

`pnpm vitest run packages/db/test/warehouse-exports.test.ts apps/api/test/admin.test.ts -t "keeps ordinary control-plane paths|manages warehouse export destinations"`

- RED: repository create attempted a decrypt during ordinary DTO construction and threw the synthetic `ordinary_path_must_not_decrypt` guard; the API route serialized synthetic plaintext/ciphertext properties.
- GREEN: 2/2 focused tests passed after persisting previews, separating ordinary and privileged mapping, and adding route-level defensive serialization.
- The final repository case also proves ordinary list and non-secret update tolerate unknown-key and malformed ciphertext without a decrypt call.

### Migration RED/GREEN

Command:

`pnpm vitest run scripts/migrate-integration-secrets.test.ts`

- RED: the prior migration contract classified full secret rows outside the transaction and failed the new ID-candidate/locked-row processor tests (including deterministic batching and interruption behavior).
- GREEN: 9/9 passed after moving all row decisions into the transactional processor.
- Database-backed cases deterministically change a selected candidate to legacy plaintext, previous-key ciphertext, or current-key ciphertext before row locking and prove the locked state controls the outcome. Authentication and write-trigger failures prove rollback preserves the stored row.

### Public-entrypoint RED/GREEN

- RED: `pnpm exec tsx -e "import('@sigmon/config')..."` failed with `ERR_MODULE_NOT_FOUND` before the root dependency/public export was added.
- GREEN: the same import printed only `public_config_entrypoint_loaded`.

## Fresh verification

- Required Task 5 gate: 5 files, 62/62 passed.
- Focused API wiring: 2 files, 128/128 passed.
- Tasks 1–4 regression set: 8 files, 199/199 passed.
- Migration registry subset: 8 passed, 249 skipped by the `migrations` filter.
- Exact builds passed without workaround flags:
  - `pnpm --filter @sigmon/config build`
  - `pnpm --filter @sigmon/db build`
  - `pnpm --filter @sigmon/api build`
  - `pnpm --filter @sigmon/worker build`
- CLI safe-failure smoke returned only the fixed application error payload `secret_migration_kind_invalid` (plus package-manager lifecycle framing) and exited 1.
- `git diff --check` passed.

## Migration and rollback notes

- Migration `0050_encrypted_integration_secrets.sql` remains registered immediately after `0049_auth_sessions.sql`; it adds the encrypted secret columns plus the non-secret warehouse preview column and makes the legacy warehouse plaintext nullable.
- Run `pnpm secrets:migrate --kind all --batch-size 100` with the current data-encryption key configured. Batch size accepts 1–1000.
- The command scans candidate IDs in stable order. Each candidate is then locked and freshly classified in its own transaction. Newly encrypted/rewrapped values are decrypt-verified before the atomic ciphertext write and plaintext clear.
- Safe restart: rerun after interruption. Current-key rows are authenticated and revalidated under lock; previous-key rows rotate; legacy rows migrate.
- Keep the previous key configured until a subsequent run reports zero rotations.
- There is no automatic down migration. Retain encryption keys. Application rollback requires either restoring a pre-migration backup or an explicitly reviewed reverse data migration before reverting to plaintext-only readers.

## Self-review and concerns

- Traced ordinary and privileged repository callers and API serialization boundaries.
- Challenged no-box, malformed/unknown-key ciphertext, legacy/current/previous state changes, wrong authentication, interrupted batches, and failed writes using synthetic fixtures only.
- Confirmed the lockfile diff is limited to the root `@sigmon/config` workspace dependency.
- Confirmed no secret or ciphertext values are logged by the implementation or migration command.
- No unresolved Task 5 concern remains. The planned worker warehouse test intentionally writes one expected synthetic error stack to stderr while asserting failure-history behavior; the suite passes.

## Docker

- All Task 5 Testcontainers resources stopped and were removed automatically.
- No dangling images were present.
- Existing Pinima containers/images and its stopped seed container were preserved as unrelated owned resources.
- No Docker containers, images, volumes, or build cache were removed; no recovery action is needed.

# Task 5 report — encrypted integration credentials

## Status and commits

- Status: final whole-plan review fix implemented; all focused security gates, the constrained full suite, and exact owning-package builds pass.
- Original Task 5 commit: `5878811` (`fix(security): encrypt privileged integration credentials`).
- Review round 1 commit: `388ebea` (`fix(security): isolate integration secret boundaries`).
- Final review fix: this commit (`fix(security): encrypt notification delivery urls`).
- The inherited Task 3 build repair in `b2830a8` and completed Tasks 1–6 are preserved.
- No push, merge, publish, Linear update, worktree removal, or unrelated cleanup was performed.

## Security boundary

- Every generic webhook, Slack, and Discord delivery URL is encrypted before persistence with exact AAD `{ table: "notification_channels", rowId, field: "url" }`. The optional secret header retains its separate field-bound AAD.
- Active notification rows store URL/header ciphertext, null plaintext credential columns, and only a masked URL preview. Create and secret-changing update write those fields atomically.
- Ordinary repository, admin API, and console paths never decrypt and do not require a `SecretBox`. They expose only `hasUrl` and the masked preview, defensively remove plaintext/ciphertext-shaped fields, and remain usable when ciphertext is malformed, uses an unknown key, or has wrong AAD.
- Only explicit worker delivery reads request decrypted URL/header values. Missing boxes, legacy plaintext, tamper, wrong AAD, and unknown keys fail closed before an outbound request.
- Backups contain encrypted envelopes but omit raw URL/header credentials. Changed production files do not log credential values.

## TDD evidence

### Final review RED

Command:

`pnpm vitest run packages/db/test/alert-evaluation.test.ts apps/api/test/alerts.test.ts scripts/migrate-integration-secrets.test.ts apps/worker/test/backups.test.ts packages/db/test/auth-sessions.test.ts`

- RED: 7 failed and 92 passed before production changes.
- Failures proved generic webhook API responses exposed raw URLs, active rows retained URL plaintext, migration lacked the encrypted URL column and atomic two-field handling, backups contained raw notification credentials, and repository delivery boundaries did not meet the encrypted-URL contract.
- The exact session equality fixture already passed because production SQL correctly uses the inclusive expiry boundary; the test now locks that behavior directly.
- Self-review found that a generic-webhook preview could reveal the first characters of an arbitrary credential path. A second focused RED produced 2/2 expected failures; GREEN passed 2/2 after generic previews became origin-only while the established Slack/Discord provider-safe masks remained unchanged.

### Final review GREEN

- Core focused rerun: 99/99 passed.
- Required Task 5 gate: 5 files, 66/66 passed.
- API notification/admin wiring: 2 files, 128/128 passed.
- Worker delivery: 85/85 passed.
- Console client/hooks/monitor fixtures: 120/120 passed.
- Updated security and Tasks 1–4 regression gate: 15 files, 603/603 passed.
- Constrained full suite: 188 files, 2,868/2,868 passed.

The tests prove ordinary paths make no decrypt call, serialize neither plaintext nor ciphertext, and remain available with tampered data. Privileged delivery receives the decrypted value only at the request boundary. Migration tests deterministically reclassify locked legacy/current/previous-key states, cover restart/count semantics, and prove a failed write rolls back both URL and header changes. The backup regression performs a real PostgreSQL dump and confirms synthetic raw credentials are absent.

## Fresh verification

- Migration registry: the idempotent migration test passed (1 passed, 256 skipped by filter); `0050` remains registered immediately after `0049`.
- Exact builds passed without workaround flags:
  - `pnpm --filter @sigmon/config build`
  - `pnpm --filter @sigmon/db build`
  - `pnpm --filter @sigmon/api build`
  - `pnpm --filter @sigmon/worker build`
  - `pnpm --filter @sigmon/console build` (1,682 modules transformed)
- CLI validation smoke exited nonzero and emitted only the fixed safe error code for an invalid kind.
- `git diff --check` passed.
- Credential-log and non-test serializer searches found no production leak path; API ciphertext-name occurrences are the defensive destructuring denylist.
- Generic webhook previews now expose only the origin plus a mask; no arbitrary path prefix is persisted or serialized.

## Migration and rollback notes

- Unreleased additive migration `0050_encrypted_integration_secrets.sql` adds notification URL ciphertext and masked-preview columns alongside the existing encrypted header column, while retaining the staged legacy plaintext shape needed before data migration.
- Run `pnpm secrets:migrate --kind all --batch-size 100` with the current data-encryption key configured. Batch size accepts 1–1000.
- The candidate scan reads IDs only. Each row is reloaded with `SELECT ... FOR UPDATE`; URL and optional header are classified from that locked state, legacy/current/previous ciphertext is authenticated, every new ciphertext is decrypt-verified, and both fields are written/cleared atomically in the same transaction.
- Notification counts are row counts: a row with any legacy field counts once as migrated; otherwise any previous-key field counts once as rotated; an all-current/empty-optional row counts zero. Reruns are safe and current-key skips are revalidated under lock.
- Keep the previous key configured until a subsequent run reports zero rotations.
- There is no automatic down migration. Retain encryption keys. Application rollback requires either restoring a protected pre-migration backup or an explicitly reviewed reverse data migration before reverting to plaintext-only readers.

## Self-review and concerns

- Traced repository create/list/update/privileged reads, API serialization, console preview handling, worker delivery, migration/rotation, and backup/export boundaries.
- Challenged no-box, legacy plaintext, malformed/tampered/unknown-key/wrong-AAD ciphertext, concurrent legacy/current/previous changes, interrupted reruns, and failed writes using synthetic fixtures only.
- Canonical design, implementation plan, README, self-hosting runbook, and secret-handling guide now document encryption/migration/rotation for both delivery URLs and optional secret headers, including row-count semantics.
- No unresolved Task 5 security concern remains.

## Docker

- All Testcontainers resources created by the verification run stopped and were removed automatically.
- No dangling images were present.
- Existing Pinima containers/images, its stopped seed container, and two older anonymous volumes were preserved because they are unrelated or their ownership cannot be proven safely.
- No Docker resource was removed. No recovery action is needed.

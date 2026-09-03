# Authentication, Sessions, and Secret Storage Design

**Linear:** PER-473, PER-506

## Goal

Make administrator sessions revocable, make login work bounded and account-enumeration resistant, and remove warehouse and notification credentials from plaintext database storage and backups.

## Non-goals

- MFA, password recovery, or enterprise identity.
- Replacing Google OAuth.
- Moving API-key verification to Argon2 on the ingestion hot path.
- Requiring an external KMS for self-hosted installs.

## Revocable sessions

Replace the signed seven-day payload cookie with a random 32-byte opaque token. Store only its SHA-256 hash in a new `auth_sessions` table with `id`, `user_id`, `token_hash`, `created_at`, `expires_at`, `revoked_at`, and `last_seen_at`. The cookie keeps the existing name and security flags; its value no longer contains a user id.

Password and OAuth login create a session row and set the token. Request authentication hashes the cookie, loads an unexpired, unrevoked session joined to an active user, and updates `last_seen_at` at a bounded interval rather than on every request. Logout revokes the current row before clearing the cookie. Password changes and user archival revoke every active session for that user in the same database transaction as the state change.

The legacy signed cookie format is rejected after rollout. Requiring one fresh login is preferable to retaining an unrevocable compatibility path.

## Login abuse controls

The login body limits passwords to 1,024 UTF-8 bytes before Argon2. A known valid Argon2id dummy hash is verified for missing and passwordless accounts. Responses retain the same `401 invalid_credentials` body for every credential failure.

Three independent controls apply:

- a login-specific source quota keyed by the trusted `request.ip`;
- an account quota keyed by an HMAC of normalized email, never the email itself;
- an in-process Argon2 semaphore limiting concurrent password verifications.

The account quota uses Redis so it is shared across API replicas. If its atomic check is unavailable, login fails `503 auth_unavailable` rather than bypassing the control. Source identity remains conservative before trusted-proxy configuration: an untrusted proxy may collapse clients into one bucket but cannot create extra identities. PER-507 later enables explicitly trusted proxy CIDRs.

Successful login clears the account failure counter. Failed attempts receive a bounded progressive delay after the initial quota window; tests inject time so the suite does not sleep.

## Encrypted secret storage

Add `DATA_ENCRYPTION_KEY` and optional `DATA_ENCRYPTION_KEY_PREVIOUS`, each a base64-encoded 32-byte key. Production requires the current key. AES-256-GCM ciphertext is versioned and includes a non-secret key identifier, random nonce, authentication tag, and ciphertext. Associated data binds the value to its table, row id, and field name so ciphertext cannot be copied to another record.

Warehouse connection URLs, notification delivery URLs, and notification secret-header values move to encrypted columns. All webhook endpoint URLs are treated uniformly as credentials, including generic, Slack, and Discord channels. Repositories encrypt on write and decrypt only at the worker/API boundary that uses the value. List and admin responses never return plaintext.

An explicit restartable migration command encrypts legacy values in bounded transactions, verifies decryption, clears plaintext columns, and reports counts only. Application startup refuses privileged outbound work while legacy plaintext remains. After one release, a follow-up migration removes the plaintext columns.

Rotation uses the current key for writes and tries the previous key only for reads. The same migration command rewraps previous-key rows with the current key; operators remove the previous key only after the command reports zero old-key rows.

## API-key hashing decision

Keep the existing peppered SHA-256 API-key verifier. API keys are high-entropy generated secrets, the pepper is outside the database, and verification is on every ingestion request. Argon2 would require a verification cache and introduce a new bypass/eviction surface. Record this decision in `.claude/docs/DECISIONS.md`; password hashing remains Argon2id.

## Acceptance criteria

- A copied session cookie fails after logout, password change, or user archival.
- Expired, revoked, malformed, and legacy cookies fail without authenticating a user.
- Missing, passwordless, and wrong-password accounts perform one Argon2 verification and return the same failure contract.
- Source/account quotas and the Argon2 semaphore bound guessing and CPU use.
- Raw warehouse and notification credentials are absent from active database rows, application logs, and backups after migration.
- Current and previous encryption keys support a tested one-step rotation.

## Verification

Add migration/repository tests, auth route and integration tests, Redis quota tests, deterministic semaphore/delay tests, encryption known-answer/tamper/AAD tests, worker integration tests, and copied-token lifecycle tests. Verify both malicious cases and ordinary password/OAuth login, ingestion, webhook, and warehouse behavior.

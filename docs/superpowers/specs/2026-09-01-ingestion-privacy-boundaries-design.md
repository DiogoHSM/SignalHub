# Ingestion and Privacy Boundaries Design

**Linear:** PER-504, PER-505

## Goal

Separate public browser ingestion from trusted identity mutation, bound every recursive telemetry value before recursive parsing or sanitization, and prevent URL secrets or unnecessary raw telemetry from crossing storage and MCP boundaries.

## Non-goals

- Project membership or tenant authorization.
- General-purpose PII classification across arbitrary telemetry.
- Removing trusted server-side identify calls.
- Batch ingestion.

## API-key capabilities

`api_keys` gains a closed capability value: `browser` or `server`. Both capabilities may send ordinary telemetry to their stored project/environment scope. Only `server` keys may call `/v1/identify/user` and `/v1/identify/tenant`.

Existing keys migrate to `browser`. This is intentionally security-first: an operator who used a legacy key for identify must create a new server key and rotate that integration. Defaulting legacy keys to `server` would leave every key embedded in a browser able to mutate durable profiles.

The admin key-creation contract requires an explicit capability and returns it in list responses. The console explains that browser keys are safe to embed but cannot identify users or tenants; server keys must never be shipped to a browser. Identify rejects a valid browser key with `403 { error: "api_key_capability_forbidden" }`. Invalid keys remain `401`, and database or verification failures remain `503`.

## Bounded JSON processing

A shared iterative inspector in `packages/telemetry` validates unknown JSON before any `z.lazy` recursive schema or sanitizer traverses it. General telemetry bounds are:

- maximum container depth: 8;
- maximum total nodes: 2,048;
- maximum total object keys: 512;
- maximum items in one array: 512;
- cycles rejected.

Replay event data keeps its stricter existing depth/key and forbidden-field limits. Endpoint schemas run the general preflight first and then their specialized checks. `sanitizeValue` is rewritten iteratively so corrupt, replayed, or internally supplied values cannot bypass stack-safety by avoiding route validation. Rejection is deterministic `400 invalid_<kind>_payload` with a bounded path and message; values are never truncated into a different accepted payload.

## URL privacy

`sanitizeTelemetryUrl` becomes the single URL boundary. It accepts absolute and relative browser URLs, removes fragments, and preserves query parameter names while replacing every value with `[REDACTED]`. Malformed input is reduced by string delimiters so query and fragment contents are still removed rather than returned unchanged.

The SDK applies the helper before enqueueing feedback. The worker applies it again before persistence so older SDKs receive the same protection. MCP result pruning applies it to URL-like fields before any optional raw detail is returned.

Existing rows are handled by a bounded, restartable database maintenance command that updates feedback URLs in primary-key batches and records counts without logging original values. Read paths also sanitize until that maintenance command reports no remaining rows.

## MCP raw-detail contract

Raw detail requires two independent opt-ins: process configuration `MCP_ALLOW_RAW_DETAIL=true` and the existing per-call `includeRawDetail=true`. Without both, sensitive fields are pruned. With both, keys are still recursively redacted, URLs are sanitized, response budgets still apply, and the response carries an explicit `rawDetailIncluded: true` metadata marker. The default remains safe if a caller blindly mirrors tool output to an external model.

## Data and contract changes

- Add `api_keys.capability` with a closed database check and application union type.
- Extend admin API and console key creation/list models with `capability`.
- Add the raw-detail process flag to config, `.env.example`, and self-hosting/MCP documentation.
- Document the identify-key rotation path and the feedback URL backfill command.

## Safety and compatibility

Ordinary event/error/trace ingestion continues for migrated keys. Only identity mutation changes. The server-side URL boundary protects old clients. The backfill is restartable and never prints old URLs. General bounds are high enough for current documented payloads and are tested against existing fixtures before rollout.

## Acceptance criteria

- A migrated or newly created browser key receives `403` from both identify endpoints.
- A server key can still identify inside its stored project/environment scope.
- Deep, broad, cyclic, and oversized recursive values fail before recursive Zod parsing or sanitization.
- Query values and fragments are absent from SDK output, worker persistence, existing-row reads, and MCP output.
- Default MCP calls cannot return raw detail; double opt-in output remains redacted and budgeted.

## Verification

Add focused tests in telemetry schemas/sanitization, SDK feedback/mapping, API identify/ingestion, worker persistence, DB maintenance, MCP budget/tools, admin API, and console key management. Run those tests first, then the affected package builds and the full repository suite.

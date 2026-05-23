# Phase 6D Critical Hygiene Design

## Summary

Close the audit Top 10 hygiene findings before the EasyPanel VPS deployment phase.

Phase 6D is a release-quality hardening pass, not a product-feature phase. It should make SignalMonitor safer to run as Diogo's self-hosted observability service by addressing the highest-risk security, reliability, runtime, backup, SDK, and container gaps identified in `review/00-summary.md`.

The target is to cover the full Top 10 if possible. Scope is still guarded: each item should be implemented as the smallest durable fix that removes the critical deployment risk. If a finding expands into a larger redesign, this phase should land the safety boundary and record the larger work as a follow-up.

## Goals

- Block webhook SSRF to private, loopback, link-local, multicast, and otherwise unsafe network ranges in all environments.
- Make telemetry ingestion idempotent across BullMQ retries and stalled-job recovery.
- Add structured runtime logging and a global API error handler with secret redaction.
- Harden the Docker image and Compose defaults for production-oriented self-hosting.
- Add backup integrity evidence and restore-time verification.
- Make SDK browser and server usage boundaries explicit enough that browser apps do not accidentally ship secret ingestion keys.
- Handle API listen failures with structured logs and cleanup.
- Add an explicit retention table allowlist for raw SQL table-name usage.
- Make API and worker shutdown ordered and bounded.
- Add HTTP security headers and cookie hardening compatible with the integrated console and local Compose install path.
- Update active docs, release-readiness docs, and memory with the hardening changes.

## Non-Goals

- Adding SaaS workspace, billing, invite, RBAC, or hosted deployment features.
- Building EasyPanel deployment automation; that remains Phase 6F.
- Adding new alert channel types, escalation, silencing, acknowledgement, or DLQ replay.
- Replacing Docker Compose with Kubernetes, Helm, systemd, Terraform, or image publishing.
- Adding source-map object storage, source-code viewing, or broader artifact storage.
- Rewriting the SDK as a complete multi-runtime analytics framework.
- Adding a full APM, metrics, or OpenTelemetry exporter for SignalMonitor itself.
- Broad console UX cleanup unrelated to the Top 10.

## Approach Options

### Recommended: Full Top 10 With Scope Guards

Attempt all Top 10 audit remediations in one focused hygiene phase. Each remediation gets tests, documentation, and a small commit. Larger follow-up ideas are documented but not allowed to expand the phase.

This is the best fit because Phase 6F intends to deploy SignalMonitor, and the audit findings are release blockers. It also gives MicroERP a cleaner validation target before it depends on SignalMonitor for production-shaped telemetry.

### Alternative: Critical-Only Hygiene

Fix SSRF, idempotency, logging, container user, placeholder secrets, and listen/shutdown safety first. Defer SDK boundary, backup integrity, retention allowlist, and headers.

This lowers immediate implementation risk but leaves visible Top 10 audit items unresolved before deployment.

### Alternative: Hygiene Plus Release Polish

Fix the Top 10 and also clean up stale PRD claims, UI stubs, DLQ operations, runbooks, and broader documentation gaps.

This would improve the release story but is too broad for one phase. It mixes critical hardening with product cleanup and makes completion harder to prove.

## Remediation Tracks

### 1. SSRF Hardening

Create one shared unsafe-network validation path for webhook URLs. The validator should:

- run in every environment, not only `NODE_ENV=production`;
- reject URL credentials;
- resolve DNS before outbound delivery;
- reject loopback, private IPv4, link-local, carrier-grade NAT, multicast, unspecified, IPv6 local/link-local/unique-local/multicast, and cloud metadata-style addresses;
- be used by admin webhook channel validation and worker webhook delivery;
- preserve the existing DNS rebinding defense by validating resolved addresses immediately before fetch.

The implementation should not require operators to configure an allowlist in this phase.

### 2. Telemetry Idempotency

Telemetry retry behavior should be safe if BullMQ retries a job after a transient failure or stalled-worker recovery.

The queue should use deterministic `jobId` values based on telemetry payload IDs. Database writes for telemetry records should tolerate duplicate IDs with `ON CONFLICT (id) DO NOTHING` or an equivalent Kysely expression. Error group counters must not increment twice for a duplicate error occurrence.

The desired outcome is: a duplicate telemetry job is treated as already accepted, does not enter the DLQ because of a unique constraint, and does not inflate aggregate error-group counters.

### 3. Structured Logging And API Error Handler

Enable Fastify structured logging with redaction for headers, cookies, authorization values, API keys, upload tokens, session secrets, and backup/S3 credentials.

Add a global `setErrorHandler` that logs unexpected errors with request context but returns sanitized JSON to clients. Known route-level errors can keep explicit status handling, but silent broad catches should log enough context to debug production incidents.

Worker logs should move behind a small structured logging helper or pino-compatible logger so worker heartbeat, retention, backups, alerts, and queue failures include consistent event names and contextual fields.

### 4. Container And Compose Hardening

Run the production container as a non-root user. Add `tini` or an equivalent init path so PID 1 signal handling is predictable. Add a container healthcheck that exercises the API health endpoint for the API service and a low-risk process/readiness check for worker where practical.

Remove operationally dangerous default placeholders from Compose examples. Local-only placeholders may remain documented for disposable development only if production validation rejects them. The Docker and Compose docs should make it clear that real secrets are required before first production start.

### 5. Backup Integrity

Add backup integrity evidence without turning this into a full encrypted backup product.

Backups should record a checksum for each local dump file. Restore should verify the checksum before running `pg_restore` when metadata or a sidecar checksum is available. Compression should be explicit and verifiable; if `pg_dump` custom format already supplies compression, document that and avoid double-compression unless tests show a clear benefit.

Optional encryption is a follow-up unless it can be added with a small, well-tested envelope and clear key-management docs. The phase must not invent weak encryption or store encryption keys beside backups.

### 6. SDK Browser And Server Boundary

Make it difficult to accidentally put a secret server ingestion key in a public browser bundle.

The preferred minimal outcome is explicit package exports and documentation for browser-safe and server-side usage:

- browser exports should only expose APIs that are safe for public ingestion keys or clearly named public/browser keys;
- server/node exports can support secret ingestion usage;
- README snippets should stop implying that a secret key belongs in client-side code;
- tests or build checks should prove browser-facing entrypoints do not import Node-only modules and that server-only entrypoints are named clearly.

If a complete package split is too large for this phase, land the naming/export/docs guardrail now and record a future dedicated SDK packaging phase.

### 7. API Listen Failure Handling

Wrap API startup so `app.listen(...)` failures are logged with structured context and trigger cleanup of initialized resources. Bind failures, invalid host/port settings, and startup dependency failures should not crash silently.

The implementation should avoid hiding non-zero exits. Startup failures should still fail the process after cleanup.

### 8. Retention Table Allowlist

Replace open-ended table-name deletion with an explicit allowlist for retention-supported tables. The repository function should reject unknown table names before constructing raw SQL identifiers.

This is a regression guard. Current callers are expected to remain hardcoded, but the type and runtime boundary should prevent future unsafe expansion.

### 9. Ordered Bounded Shutdown

Make API and worker shutdown deterministic:

- stop accepting new API requests before closing shared Redis, queue, and DB resources;
- close queue resources before Redis clients they depend on;
- give each shutdown stage a timeout;
- log stage failures without hanging forever;
- preserve non-zero exit behavior for fatal startup/runtime errors.

The implementation should not introduce a process manager. It should stay compatible with Docker Compose and GitHub Actions smoke runs.

### 10. Security Headers And Cookie Hardening

Add baseline HTTP headers appropriate for a self-hosted admin console:

- `Content-Security-Policy` compatible with the built console assets;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options` or equivalent CSP frame protection;
- `Referrer-Policy`;
- HSTS only when the deployment is behind HTTPS or when configuration makes it safe.

Session cookies should use secure defaults and, where compatible with local development and Compose, the `__Host-` prefix. If `__Host-` cannot be safely enabled for local HTTP installs, document the constraint and apply the strongest compatible cookie settings.

## Documentation

Update active operator documentation where behavior changes:

- `README.md` for production secret expectations, SDK snippets, backup integrity, and deployment checks.
- `.claude/docs/ARCHITECTURE.md` for queue idempotency, logging, security headers, SSRF, and backup integrity.
- `.claude/docs/DEPLOYMENT.md` for container hardening, healthchecks, production secrets, and smoke gates.
- `.claude/docs/STACK.md` for any new runtime packages.
- `.claude/docs/CONSTRAINTS.md` for explicit non-goals and retained limitations.
- `.claude/docs/SECRETS.md` for any new variables or changed cookie/backup settings.
- `.claude/docs/INFRASTRUCTURE.md` for operational verification and backup checksum behavior.

Historical phase docs and review reports do not need to be rewritten.

## Validation Strategy

Each track should include focused tests before implementation where practical. The final phase gate is:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
pnpm smoke:compose
```

Use `rtk proxy` when investigating failed tests, failed smoke runs, diffs, or logs that need complete output.

Additional targeted checks should include:

- duplicate telemetry job processing does not create DLQ entries or duplicate error-group increments;
- unsafe webhook URLs are rejected in non-production environments;
- backup restore refuses files with mismatched checksums when checksum metadata is available;
- API startup bind failure logs and exits after cleanup;
- Docker image runs as a non-root user;
- browser-facing SDK entrypoints do not expose server-only secret-key guidance.

## Completion Criteria

Phase 6D is complete when:

- all Top 10 findings from `review/00-summary.md` have either a committed remediation or a documented reason for deferral;
- any deferral is smaller than the original critical risk and has a safe guardrail landed in this phase;
- focused tests cover the changed security and reliability boundaries;
- active docs describe the new operational behavior;
- local final verification passes;
- CI passes after the Phase 6D PR is opened;
- versioned memory records the completed hygiene release and the next planned phase, Phase 6F EasyPanel VPS deployment.

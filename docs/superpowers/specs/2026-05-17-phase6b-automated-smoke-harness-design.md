# Phase 6B Automated Smoke Harness Design

## Summary

Build the first automated release smoke harness for SignalHub as a local-first, CI-ready TypeScript runner.

Phase 6A proved the Docker Compose fresh-install path manually and produced a durable run record. It also identified two follow-ups: reduce optional native binding noise during Docker builds, and harden the manual drill into an automated smoke flow. Phase 6B focuses on the second follow-up by turning the proven manual RC drill into a repeatable operator command.

This phase does not add new product behavior. It adds a release-readiness harness that can be run locally now and adopted by CI later with minimal shell glue.

## Goals

- Add a repo-native automated smoke command for the Docker Compose install path.
- Reuse the critical path proven by the Phase 6A drill.
- Keep the first version local-first while avoiding local-only assumptions that would block future GitHub Actions use.
- Generate disposable, non-placeholder local secrets without leaking them in logs.
- Start and verify an isolated Compose stack.
- Exercise bootstrap admin, project setup, environment setup, API key creation, ingestion, query, source-map upload/resolution, backup, guarded restore, and post-restore checks.
- Produce compact operator-friendly output with clear step status and redacted failure details.
- Clean up containers, volumes, temp files, and secrets by default.
- Provide a preserve/debug mode for failed runs.

## Non-Goals

- Adding a GitHub Actions workflow in this phase.
- Publishing Docker images, tags, or GitHub releases.
- Adding Kubernetes, Helm, systemd, Terraform, or SaaS deployment support.
- Adding browser or Playwright console screenshots.
- Building a product-facing setup wizard or in-app smoke status UI.
- Adding load, soak, or performance checks.
- Testing object storage or R2 for backups or source maps.
- Fixing optional Docker native-binding build warnings unless they become hard blockers for the smoke harness.

## Approach Options

### Recommended: TypeScript Smoke Runner

Add a TypeScript script exposed as `pnpm smoke:compose`. The runner orchestrates Docker Compose, prepares a disposable `.env`, calls the API, verifies query responses, runs backup/restore commands, and reports structured step results.

This is the best fit because SignalHub is already TypeScript-first, the existing scripts use `tsx`, and the smoke flow needs safer JSON handling, retries, redaction, and cleanup than a shell script would comfortably provide.

### Alternative: Shell Harness

Add a shell script that follows the Phase 6A command log closely.

This would be fast to write, but it would be brittle around JSON parsing, process cleanup, redaction, retries, cross-platform behavior, and future CI portability.

### Alternative: Vitest Integration Suite

Encode the smoke flow as a long-running Vitest file.

This gives assertion ergonomics, but it is less natural for operator lifecycle work such as starting Compose, preserving stacks after failure, printing release-friendly logs, and restoring backups. The command should feel like an operator tool, not a unit test.

## Architecture

Add a repo-native runner with a thin package script:

- `scripts/smoke-compose.ts`: orchestration entrypoint.
- `pnpm smoke:compose`: package script that invokes the runner.
- Optional small helper modules only if they keep the entrypoint readable, such as command execution, HTTP calls, polling, redaction, temporary file management, and structured step reporting.
- Deterministic smoke fixture data embedded in the runner or adjacent script-local module.

The runner should treat Docker Compose and the local API as external systems. It should not import API internals or database repositories. This keeps the smoke harness close to the operator path and useful as an install gate rather than another unit-level integration test.

## Runner Interface

The initial command is:

```sh
pnpm smoke:compose
```

Supported options:

- `--project-name <name>`: override the Compose project name.
- `--api-url <url>`: override the API URL, defaulting to `http://localhost:3000`.
- `--preserve`: keep Compose resources and temp files after failure or success for debugging.

Supported environment overrides:

- `SIGNALHUB_SMOKE_PROJECT_NAME`: default project name when the flag is absent.
- `SIGNALHUB_SMOKE_API_URL`: default API URL when the flag is absent.

The default project name should be deterministic enough for cleanup, but isolated enough to avoid clobbering normal development stacks. The implementation plan can choose the exact value.

## Smoke Flow

The smoke harness automates the critical path from Phase 6A:

1. Print the commit under test and selected Compose project name.
2. Generate a temporary `.env` from `.env.example` with non-placeholder local secrets.
3. Run `pnpm run doctor` against the generated env file when supported by the doctor interface.
4. Run `docker compose config --quiet`.
5. Start Postgres and Redis for the smoke project.
6. Seed the bootstrap admin.
7. Start the full stack.
8. Run compose-aware doctor.
9. Verify `/health` and `/ready`.
10. Log in as the bootstrap admin and keep the session cookie in memory or a temp file.
11. Create a smoke project and production environment.
12. Create an ingestion API key and keep the one-time secret redacted.
13. Create a source-map upload token and keep the one-time secret redacted.
14. Ingest deterministic event, error, trace/span, LLM call, and breadcrumb payloads.
15. Poll until worker persistence makes the smoke data queryable.
16. Verify Events, Errors, Error Groups, Traces, Spans, LLM calls, LLM aggregate, Entities, Users, and Session Timeline.
17. Create a deterministic source-map fixture.
18. Upload the source map and verify resolution for the known minified error.
19. Run a manual backup.
20. Assert that restore without `--yes` refuses to run.
21. Stop API and worker, run confirmed restore, then start API and worker.
22. Re-run health, readiness, compose-aware doctor, and restored-data queries.
23. Clean up Compose resources, volumes, temp files, and generated secrets unless `--preserve` is set.

## Smoke Data Scope

Use deterministic data with a unique run marker. The marker should appear in telemetry payloads and query assertions so stale local data cannot accidentally satisfy the smoke.

Required proof points:

- event ingestion and `/query/events`;
- error ingestion, grouping, `/query/errors`, and `/query/error-groups`;
- trace/span ingestion and ordered span query;
- LLM ingestion and aggregate query;
- tenant and user visibility in Entities and Users;
- breadcrumb visibility in Session Timeline;
- source-map upload with a dedicated token and stack-frame resolution;
- backup creation;
- guarded restore behavior;
- restored smoke data queryability after restore.

The smoke data must not require private credentials, external services, or network access beyond the local Docker Compose stack.

## Error Handling And Operator Experience

Each step should print a compact status line:

- `PASS` for required successful checks;
- `WARN` for advisory conditions that do not prevent the smoke from continuing;
- `FAIL` for release blockers.

On failure, the runner prints:

- step name;
- command or endpoint;
- redacted stderr, stdout, or response body excerpt;
- suggested next command when obvious, such as `docker compose -p <project> logs api`.

The runner exits `0` only when all required steps pass. It exits `1` for release blockers.

Warnings do not fail unless they make a later required step impossible.

## Secret Handling

The runner must never print secret values.

Redacted values include:

- generated admin password;
- session cookie;
- ingestion API key secret;
- source-map upload token secret;
- database password;
- API key pepper;
- session secret;
- URLs that contain credentials.

Secrets should live in process memory or temp files under a runner-created temp directory. If `--preserve` is not set, the temp directory is removed during cleanup. If `--preserve` is set, the runner prints the temp directory path and reminds the operator that it contains local-only generated secrets.

## Cleanup

Cleanup runs by default after success and after failure.

Default cleanup removes:

- Compose containers and network for the smoke project;
- Compose volumes for the smoke project;
- temp files and generated fixtures;
- local cookie jars or secret files created by the runner.

With `--preserve`, cleanup should keep resources and print:

- Compose project name;
- API URL;
- temp directory path;
- commands to inspect logs;
- command to remove preserved resources.

The runner should avoid deleting anything outside its selected Compose project name and temp directory.

## CI Readiness

Phase 6B does not add CI wiring, but the runner must be suitable for later GitHub Actions use:

- no interactive prompts;
- deterministic exit codes;
- configurable project name and API URL;
- no reliance on pre-existing local services or database state;
- all generated secrets created at runtime;
- output that is useful in CI logs;
- cleanup that does not require manual intervention in the happy path.

Future CI adoption can wrap `pnpm install`, Docker availability checks, `pnpm smoke:compose`, and artifact collection without changing the runner's core behavior.

## Testing Strategy

Unit tests should cover runner internals that can be tested without Docker:

- argument and environment parsing;
- command result handling;
- redaction;
- retry and polling behavior;
- JSON response assertions;
- cleanup decision logic;
- summary rendering.

The acceptance check for the harness is the harness itself:

```sh
pnpm smoke:compose
```

Final verification for the phase should include:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
pnpm smoke:compose
```

If `pnpm smoke:compose` fails due to local Docker availability rather than product behavior, the implementation record should state that clearly and include the failing command output.

## Documentation Updates

Update operator documentation only where it helps future users understand and run the smoke harness:

- `README.md`: add the smoke command and when to use it.
- `.claude/docs/DEPLOYMENT.md`: mention it as a release-readiness check, not a production runtime service.
- `.claude/docs/STACK.md`: list the new script command.
- `.claude/docs/CONSTRAINTS.md`: clarify that Docker Compose remains the supported production install path.

Do not add long command logs to durable docs. Keep detailed run output in implementation evidence if needed.

## Rollout

Implementation order:

1. Add testable runner helpers and unit tests.
2. Add the smoke orchestration entrypoint.
3. Add the package script.
4. Run the smoke locally against disposable Compose resources.
5. Fix only blocker-level harness or install-path issues discovered by the smoke.
6. Update docs and memory.
7. Run final verification.

## Open Decisions

None. Phase 6B is a TypeScript `pnpm smoke:compose` harness that runs locally first and is structured for later CI adoption.

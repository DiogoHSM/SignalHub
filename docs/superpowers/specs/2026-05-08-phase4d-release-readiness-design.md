# Phase 4D Release Readiness and Install Hardening Design

## Summary

Add the next operational maturity slice for SignalHub: release readiness and self-hosted install hardening. This phase makes a fresh Docker Compose installation easier to verify, safer to run in production-like environments, and clearer to upgrade or restore.

The primary new operator surface is a read-only project doctor script run with `pnpm run doctor`. It validates local environment configuration, Compose configuration, service availability, API health, and operational assumptions without modifying data. Documentation is updated around the same flow so a new operator can clone the project, configure it, start it, verify it, back it up, restore it, and upgrade it without reading source code.

## Goals

- Keep Docker Compose as the only supported production install path for now.
- Add a safe operator doctor command for install and upgrade verification.
- Detect dangerous production placeholder secrets before startup where practical.
- Make `.env` setup, password encoding, public endpoint, backups, retention, and alerts easier to reason about.
- Document fresh install, upgrade, backup, restore drill, and troubleshooting procedures.
- Establish a release/versioning baseline for future tagged releases.
- Preserve the self-hosted core without adding SaaS services or hosted control planes.

## Non-Goals

- Kubernetes, Helm, systemd, Terraform, or managed cloud deployment support.
- GitHub release automation.
- Docker image publishing automation.
- In-app setup checklist.
- New product analytics, investigation, alerting, or dashboard features.
- Automatic secret generation or password rotation.
- Automatic project, environment, API key, or admin user creation from the doctor command.
- Destructive restore execution from the doctor command.
- Enforcing HTTPS at runtime. TLS may terminate at a reverse proxy.

## Approach Options

### Recommended: Operator Doctor plus Release Docs

Add a focused root `doctor` package script, run as `pnpm run doctor`, that checks the install from the operator machine and optionally performs Compose-aware checks when Docker is available. Pair it with stricter production config safety and practical install, upgrade, restore, and troubleshooting docs.

This is the best fit now because SignalHub already has the main MVP runtime features. The next adoption risk is not missing another screen; it is an operator cloning the repo and being unsure whether the installation is configured safely.

### Alternative: In-App Setup Checklist

The console could show a setup and operations checklist. This is useful after the API, console, auth, and database are already working, but it does not help with broken first installs, invalid Compose config, startup config failures, or unreachable services.

### Alternative: Release Packaging First

The project could focus on release artifacts, changelog conventions, and GitHub release flow. That is useful later, but release automation without a strong install verification command can still produce builds that are hard to operate safely.

## Supported Install Path

Phase 4D supports Docker Compose as the production-oriented self-hosted path.

The intended operator flow is:

1. Clone the repository.
2. Copy `.env.example` to `.env`.
3. Fill secrets, Postgres password, public endpoint, and optional backup settings.
4. Run `pnpm install`.
5. Run `pnpm run doctor` before startup for static checks.
6. Start the Compose stack.
7. Seed the bootstrap admin.
8. Run `pnpm run doctor -- --compose` to verify running services.
9. Open `/console`.
10. Before upgrades, create a backup, update code or image, run migrations, restart, and run doctor again.

Local Node development remains supported for contributors, but production documentation should avoid presenting multiple competing deployment models.

## Doctor Command

Add a root script:

```sh
pnpm run doctor
pnpm run doctor -- --compose
pnpm run doctor -- --api-url http://localhost:3000
```

The command is read-only by default. It must not create projects, mutate users, rotate secrets, run migrations, restore backups, delete data, or enqueue telemetry.

Use `pnpm run doctor` rather than `pnpm doctor` because `pnpm doctor` is pnpm's own built-in diagnostic command and does not invoke project scripts.

### Check Categories

The command reports checks as:

- `pass`: the check succeeded.
- `warn`: the install can continue, but the operator should review something.
- `fail`: the install or upgrade is unsafe or unlikely to work.

The process exits with:

- `0` when there are no failed checks.
- non-zero when one or more failed checks exist.

Warnings do not cause a non-zero exit.

### Default Host Checks

Default `pnpm run doctor` checks:

- Node.js version is compatible with the project.
- pnpm version is compatible with the project package manager field.
- `.env` exists.
- required environment variables are present.
- known placeholder production secrets are not used when `NODE_ENV=production`.
- `SESSION_SECRET`, `API_KEY_PEPPER`, and `BOOTSTRAP_ADMIN_PASSWORD` satisfy configured minimum lengths outside tests.
- `DATABASE_URL` and `REDIS_URL` parse as URLs.
- `POSTGRES_PASSWORD_URLENCODED` guidance is clear when the Postgres password contains URL-reserved characters.
- `SIGNALHUB_PUBLIC_ENDPOINT` parses as a URL.
- `docker compose config --quiet` succeeds when Docker Compose is available.
- backup, retention, and alert scheduler settings are internally coherent.

The default mode may also try unauthenticated API checks if `--api-url` is supplied or if `SIGNALHUB_PUBLIC_ENDPOINT` points to a reachable local service. Unreachable API checks should be warnings unless the operator explicitly requests a running-service mode.

### Compose Checks

`pnpm run doctor -- --compose` adds running-stack checks:

- Docker is available.
- Docker Compose is available.
- Compose services are known and inspectable.
- Postgres, Redis, API, and worker containers exist.
- service health states are visible where Compose exposes them.
- API `/health` returns successfully.
- API `/ready` returns successfully.

Authenticated `/system/health` is not required in this phase because the doctor command should not require an admin password or a session cookie. Worker heartbeat remains visible through the console once the operator is logged in. A future phase may add an explicit session-cookie option for authenticated checks.

### Safety Constraints

The doctor command must be safe to run:

- in CI,
- on a developer laptop,
- before the stack is started,
- after the stack is started,
- on a production host,
- before and after upgrades.

All network and command checks should be bounded by timeouts and should produce actionable messages.

## Production Config Hardening

Keep local development permissive enough to run quickly, but reject dangerous production configuration at startup where practical.

When `NODE_ENV=production`, config loading rejects known placeholders:

- `SESSION_SECRET=change-me-to-a-long-random-secret`
- `API_KEY_PEPPER=change-me-to-a-long-random-pepper`
- `BOOTSTRAP_ADMIN_PASSWORD=change-me-admin-password-32-chars-min`
- `POSTGRES_PASSWORD=signalhub-local-only-change-me`

Existing minimum length validation stays in place for `SESSION_SECRET`, `API_KEY_PEPPER`, and `BOOTSTRAP_ADMIN_PASSWORD` outside tests.

The doctor command reports softer warnings:

- `SIGNALHUB_PUBLIC_ENDPOINT` is localhost while `NODE_ENV=production`.
- `SIGNALHUB_PUBLIC_ENDPOINT` uses plain HTTP while `NODE_ENV=production`.
- backups are enabled but local directory or S3/R2 settings look incoherent.
- S3/R2 upload is enabled with missing endpoint, bucket, access key, secret key, or prefix.
- Google OAuth is enabled with missing Google settings.

Runtime HTTPS enforcement is deferred because self-hosted operators may terminate TLS at a reverse proxy.

## Release and Upgrade Documentation

Update operator documentation around practical procedures:

- Fresh Compose install from clone to console login.
- Production `.env` checklist covering secrets, public endpoint, password encoding, Google OAuth optionality, backups/R2, retention, and alerts.
- Upgrade flow: backup first, pull/update, install dependencies or rebuild image, run migrations, restart, run doctor.
- Restore drill: how to validate a backup restore path before an incident.
- Troubleshooting guide for Postgres, Redis, migrations, admin seed, worker heartbeat, webhooks, backups, and public endpoint mistakes.
- Release baseline: versioning convention and required verification before tagging.

Documentation should prefer commands that actually exist in `package.json` or `docker-compose.yml`. Examples must not imply unsupported Kubernetes, systemd, or SaaS deployment paths.

## Implementation Boundaries

The doctor command should be implemented as a TypeScript script under `scripts/`, using small testable helper functions for:

- environment loading and classification,
- version checks,
- URL checks,
- placeholder detection,
- command execution checks,
- HTTP health checks,
- result formatting and exit-code mapping.

Config hardening should live in `packages/config` so API, worker, scripts, and tests share the same production safety rules.

No new database tables are required for this phase.

## Error Handling

Doctor failures should be specific and actionable. Examples:

- Missing `.env`: tell the operator to copy `.env.example`.
- Placeholder secret in production: name the variable and explain it must be replaced.
- Compose config failure: show the failed command and concise output.
- API unreachable: show the URL and whether this was a warning or required running-stack check.
- Backup configuration issue: name the missing or inconsistent backup variables.

The doctor command should redact secret values in output. It may print variable names, presence, length class, and safe URLs, but not raw secret values.

## Testing

Backend and script tests:

- Doctor pass, warn, and fail result classification.
- Exit-code mapping.
- Missing `.env` behavior.
- Production placeholder detection.
- URL parsing and public endpoint warnings.
- Postgres password URL-encoding guidance.
- Backup/R2 configuration warnings.
- Docker/Compose command checks with command execution mocked.
- API health checks with HTTP calls mocked.
- Production config rejection in `packages/config`.

Documentation verification:

- Commands in docs match package scripts and Compose service names.
- No docs claim Kubernetes, systemd, or hosted SaaS support.

Verification commands:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
```

## Rollout

Implementation order:

1. Add production placeholder safety rules in shared config.
2. Add doctor result model and pure validation helpers.
3. Add command and HTTP check adapters with timeouts.
4. Add `scripts/doctor.ts` and root `doctor` package script.
5. Add tests for config hardening and doctor behavior.
6. Update README and `.claude/docs` operational documentation.
7. Run full verification.

## Acceptance Criteria

- `pnpm run doctor` exists and runs safely without mutating application data.
- `pnpm run doctor` returns non-zero only for failed checks, not warnings.
- `pnpm run doctor -- --compose` verifies a running Compose install when Docker is available.
- Production startup rejects known unsafe placeholder secrets.
- Fresh install, upgrade, backup, restore drill, and troubleshooting docs are clear and command-accurate.
- Docker Compose remains the only supported production install path in docs.
- No new SaaS dependency, hosted control plane, or external scheduler is introduced.
- `pnpm test`, `pnpm build`, `docker compose config --quiet`, and `pnpm run doctor` pass in a safe local mode.

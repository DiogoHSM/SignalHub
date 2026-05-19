# Phase 6E SignalMonitor Rename Design

## Summary

Rename SignalHub to SignalMonitor, with `sigmon.app` as the public brand and `my.sigmon.app` as the planned operator deployment hostname.

This phase happens before the 0.1.1 hygiene work and before VPS deployment because there is no production deployment to preserve yet. A clean rename now avoids deploying one identity and immediately migrating to another.

MicroERP is Diogo's personal project and will be the first real consumer used to test SignalMonitor as an observability vendor. It should be described that way in project documentation: a personal validation project, not an external customer or commercial commitment.

## Goals

- Rename user-facing product references from SignalHub to SignalMonitor.
- Use `sigmon.app` as the brand/site identity.
- Document `my.sigmon.app` as the intended self-hosted deployment hostname.
- Rename internal package scope from `@signal-hub/*` to `@sigmon/*`.
- Rename root package from `signal-hub` to `sigmon`.
- Rename environment variables from `SIGNALHUB_*` to `SIGMON_*`.
- Rename Docker, database, filesystem, smoke, and backup defaults from `signalhub` to `sigmon`.
- Rename examples, snippets, CI source-map secret examples, and docs to the new identity.
- Keep old names only where history requires them, such as previous phase documents, run records, migration context, or explicit "formerly SignalHub" notes.
- Preserve git history and make the rename mechanically reviewable.

## Non-Goals

- Fixing 0.1.1 hygiene findings such as SSRF, idempotency, logging, or SDK browser safety.
- Deploying to EasyPanel or changing live infrastructure.
- Adding product features or new telemetry behavior.
- Creating a visual brand system, logo, marketing site, or landing page.
- Maintaining runtime backward compatibility for old `SIGNALHUB_*` environment variables, old package aliases, old Docker paths, or old volume names.
- Migrating production data or volumes, because there is no production deployment yet.

## Approach Options

### Recommended: Full Clean Rename Now

Rename public, internal, Docker, env, package, and documentation identifiers in one controlled phase.

This is the best fit because the product is not deployed yet. It creates one consistent identity before hygiene fixes and before the VPS deployment, and it avoids carrying compatibility aliases that would make the first deployment harder to reason about.

### Alternative: Public Rename Only

Rename docs, README, console text, examples, and repository metadata while leaving package scopes, env vars, Docker names, database names, and filesystem paths as `signalhub`.

This is safer mechanically, but it leaves the repo split-branded. It is a poor fit before first deployment because operators would see `SignalMonitor` in docs while configuring `SIGNALHUB_*` variables and `/var/lib/signalhub` paths.

### Alternative: Deploy First, Rename Later

Finish hygiene, deploy SignalHub to the VPS, then rename after observing the deployment.

This creates avoidable migration work. Since there is no running production instance, delaying the rename only increases future friction.

## Naming Map

Use this mapping consistently:

| Current | New |
| --- | --- |
| SignalHub | SignalMonitor |
| Signal Hub | SignalMonitor |
| signal-hub | sigmon |
| signalhub | sigmon |
| SIGNALHUB | SIGMON |
| `@signal-hub/*` | `@sigmon/*` |
| `signal-hub` root package | `sigmon` |
| `signalhub.example.com` | `sigmon.app` or `my.sigmon.app` depending on context |
| `/var/lib/signalhub/...` | `/var/lib/sigmon/...` |
| `signalhub_smoke` | `sigmon_smoke` |
| `signalhub_ci_smoke` | `sigmon_ci_smoke` |

Use `SignalMonitor` for product prose and UI. Use `sigmon` for technical identifiers. Use `sigmon.app` for public/domain examples and `my.sigmon.app` for the intended deployment host.

## Repository Rename

The GitHub repository should be renamed from `SignalHub` to `sigmon` after the code rename is merged. The local checkout path can be renamed after the remote rename, but it is not required for the code change to be correct.

The versioned memory project slug may continue to reference the old local path until the local directory is renamed. If the local directory changes, add a memory note that future entries should use the new slug.

## Package And Import Rename

All workspace package names should move to the new scope:

- `@signal-hub/api` to `@sigmon/api`
- `@signal-hub/worker` to `@sigmon/worker`
- `@signal-hub/config` to `@sigmon/config`
- `@signal-hub/db` to `@sigmon/db`
- `@signal-hub/queues` to `@sigmon/queues`
- `@signal-hub/telemetry` to `@sigmon/telemetry`
- `@signal-hub/sdk` to `@sigmon/sdk`
- `@signal-hub/cli` to `@sigmon/cli`
- `@signal-hub/console` to `@sigmon/console`

Update `package.json`, `pnpm-lock.yaml`, `tsconfig.base.json`, Vitest aliases, source imports, tests, docs, and snippets together. Do not leave compatibility aliases unless a test fixture explicitly needs to mention the old name.

## Environment Variables

Rename project-specific environment variables:

- `SIGNALHUB_PUBLIC_ENDPOINT` to `SIGMON_PUBLIC_ENDPOINT`
- `SIGNALHUB_SOURCE_MAP_TOKEN` to `SIGMON_SOURCE_MAP_TOKEN`
- `SIGNALHUB_PROJECT_ID` to `SIGMON_PROJECT_ID`
- `SIGNALHUB_ENVIRONMENT_ID` to `SIGMON_ENVIRONMENT_ID`
- `SIGNALHUB_ENV_FILE` to `SIGMON_ENV_FILE`
- `SIGNALHUB_SMOKE_PROJECT_NAME` to `SIGMON_SMOKE_PROJECT_NAME`
- `SIGNALHUB_SMOKE_API_URL` to `SIGMON_SMOKE_API_URL`
- `SIGNALHUB_SMOKE_PROJECT_ID` to `SIGMON_SMOKE_PROJECT_ID`
- `SIGNALHUB_SMOKE_ENVIRONMENT_ID` to `SIGMON_SMOKE_ENVIRONMENT_ID`

This phase should not preserve old env aliases because there is no production deployment. Tests and docs should fail fast if the old variables remain in active paths.

## Docker, Database, And Filesystem Rename

Rename Compose and runtime defaults:

- Postgres database/user examples from `signalhub` to `sigmon`.
- Local-only password placeholder from `signalhub-local-only-change-me` to `sigmon-local-only-change-me`.
- Docker filesystem paths from `/var/lib/signalhub/...` to `/var/lib/sigmon/...`.
- Backup file prefix from `signalhub-YYYYMMDD...` to `sigmon-YYYYMMDD...`.
- Smoke Compose project defaults from `signalhub_smoke` to `sigmon_smoke`.
- CI smoke project from `signalhub_ci_smoke` to `sigmon_ci_smoke`.

Do not add data migration scripts for existing volumes. If a developer has old local volumes, the documented path is to remove or recreate them before running the renamed stack.

## Documentation And Product Identity

Update canonical docs, README, examples, and active operator docs to use SignalMonitor and sigmon.app.

Document these points explicitly:

- SignalMonitor was formerly developed as SignalHub.
- MicroERP is Diogo's personal project and the first real validation consumer for SignalMonitor.
- The planned deployment hostname is `my.sigmon.app`.
- Phase 6D will address 0.1.1 hygiene findings under the new name.
- Phase 6F will deploy SignalMonitor to Diogo's shared EasyPanel VPS.

Historical design and implementation docs may keep old names when they describe completed phases. Active docs should not instruct operators to use old package scopes, env vars, Docker paths, or domains.

## Validation Strategy

Run:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
docker compose config --quiet
pnpm smoke:compose
```

Run grep checks after implementation:

```sh
rg -n "SignalHub|Signal Hub|signal-hub|signalhub|SIGNALHUB" .
rg -n "SignalMonitor|sigmon|SIGMON" .
```

Expected remaining old-name references should be limited to:

- historical phase docs and run records;
- explicit "formerly SignalHub" notes;
- git metadata or external review artifacts that are not part of active operator instructions.

If active code, env handling, package aliases, Compose defaults, README setup steps, or console UI still use the old name, the phase is not complete.

## Completion Criteria

Phase 6E is complete when:

- active product identity is SignalMonitor;
- active domain examples use `sigmon.app` and planned deployment docs mention `my.sigmon.app`;
- workspace packages and imports use `@sigmon/*`;
- root package name is `sigmon`;
- active project env vars use `SIGMON_*`;
- Compose/database/path/smoke defaults use `sigmon`;
- docs identify MicroERP as Diogo's personal validation project;
- local verification passes;
- grep evidence shows no old-name references in active code or operator docs except intentional historical mentions;
- versioned memory records the rename and the next planned phases: 6D hygiene, then 6F EasyPanel VPS deployment.

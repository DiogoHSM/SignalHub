# SignalMonitor Project Context

SignalMonitor is a self-hosted telemetry core for product analytics, errors, LLM calls, traces, and spans. Keep project-facing documentation in English.

- Current phase: Phase 6C CI Smoke Gate.

## Canonical Docs

- `.claude/docs/PROJECT-SUMMARY.md`: project purpose, current phase, scope, and operator flow.
- `.claude/docs/ARCHITECTURE.md`: runtime components, request paths, storage, and API surface.
- `.claude/docs/STACK.md`: language, packages, services, and common commands.
- `.claude/docs/DEPLOYMENT.md`: local and Compose deployment workflow.
- `.claude/docs/CONSTRAINTS.md`: technical and product constraints.
- `.claude/docs/DECISIONS.md`: durable architectural decisions.
- `.claude/docs/SECRETS.md`: sanitized environment variable documentation only.
- `.claude/docs/INFRASTRUCTURE.md`: runtime infrastructure and operational checks.
- `.claude/docs/UI-UX.md`: console UX principles and visual conventions.

## Project Conventions

- The core runtime is a pnpm TypeScript workspace with `apps/api`, `apps/worker`, `@sigmon/sdk`, `@sigmon/cli`, and shared packages under `packages/*`.
- Use Postgres as the source of truth for Phase 1 operational and typed telemetry data.
- Use Redis/BullMQ for ingestion queue handoff between API acceptance and worker persistence.
- Keep ingestion contracts scoped by project and environment API keys.
- Keep the admin console in `apps/console` and serve its production build from the API at `/console`.
- Keep Overview and investigation console views read-only unless a design explicitly introduces a mutation workflow.
- Keep source-map artifact storage local-first for the current release line. Resolution must use strict project, environment, release, and minified-file matching, and the console must not display original source content.
- Keep source-map retention worker-owned, env-configured, and local-storage-only until object storage is explicitly designed.
- Keep source-map upload tokens separate from browser ingestion API keys. They are CI-only secrets created from the Artifacts console and used by `pnpm source-maps:upload`.
- Use `pnpm smoke:compose` as the local-first release smoke gate for the Docker Compose install path.
- Keep GitHub Actions CI focused on tests, build, Docker Compose config validation, and the Compose smoke gate until a dedicated release-management phase expands it.
- Keep root-level `SECRETS.md` and local `.env` files uncommitted.

## Verification

Run these checks before considering telemetry-core changes complete:

```sh
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config
```

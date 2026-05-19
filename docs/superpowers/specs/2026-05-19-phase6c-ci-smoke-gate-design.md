# Phase 6C CI Smoke Gate Design

## Summary

Add the first GitHub Actions CI gate for SignalHub, centered on the Phase 6B Docker Compose smoke harness.

Phase 6B produced `pnpm smoke:compose`, a local-first smoke command that validates the critical self-hosted Docker Compose install path. Phase 6C makes that harness part of the pull request and main-branch quality gate, alongside normal test, build, and Compose configuration checks.

This phase does not add product behavior or a new deployment mode. It turns the existing verification commands into a repeatable GitHub-hosted CI workflow.

## Goals

- Add a GitHub Actions workflow for pull requests targeting `main`.
- Run the workflow on pushes to `main`.
- Allow manual workflow dispatch for ad hoc reruns.
- Verify normal code correctness with `pnpm test`.
- Verify TypeScript/package build health with `pnpm build`.
- Verify Docker Compose rendering with `docker compose config --quiet`.
- Verify the self-hosted install path with a dedicated `pnpm smoke:compose` job.
- Keep the smoke job separate from unit/build jobs so failure signals are easy to classify.
- Use Node.js 22 and the repo-pinned pnpm version.
- Collect useful Docker diagnostics when the smoke job fails.
- Document CI as a release-readiness gate.

## Non-Goals

- Enforcing GitHub branch protection settings.
- Publishing Docker images or build artifacts.
- Creating GitHub releases, tags, or changelog automation.
- Adding nightly or scheduled CI runs.
- Adding browser screenshots or Playwright visual checks.
- Testing external services such as R2 or hosted object storage.
- Adding Kubernetes, Helm, systemd, Terraform, or hosted SaaS deployment support.
- Replacing local `pnpm smoke:compose` usage.

## Approach Options

### Recommended: PR CI With A Separate Smoke Job

Add one GitHub Actions workflow with separate jobs for tests, build, Compose config, and the Compose smoke harness. Run it for pull requests, pushes to `main`, and manual dispatch.

This is the best first CI slice because it creates a complete baseline quality gate while keeping the long-running install-path smoke isolated from ordinary code checks.

### Alternative: Smoke-Only Workflow

Add only a workflow that runs `pnpm smoke:compose`.

This is faster to implement, but it leaves PRs without CI proof that tests and builds pass. It also makes the smoke gate carry too much meaning: a green install smoke does not prove the whole workspace is type-safe or unit-tested.

### Alternative: Full Release Candidate Pipeline

Add tests, build, smoke, artifact upload, scheduled runs, release notes, and branch protection guidance all at once.

This is too broad for Phase 6C. It risks mixing CI adoption with release management and makes early CI failures harder to interpret.

## Workflow Shape

Create `.github/workflows/ci.yml`.

Workflow name:

```yaml
name: CI
```

Triggers:

- `pull_request` targeting `main`;
- `push` to `main`;
- `workflow_dispatch`.

Jobs:

- `test`: run `pnpm test`;
- `build`: run `pnpm build`;
- `compose-config`: run `docker compose config --quiet`;
- `smoke-compose`: run `pnpm smoke:compose --project-name signalhub_ci_smoke --preserve`.

The jobs run independently. A failed test job should not hide whether the smoke job would also fail, and a smoke failure should not be confused with TypeScript or unit-test failure.

## Runtime Environment

Use GitHub-hosted `ubuntu-latest` runners.

Each job should:

1. Check out the repository.
2. Set up Node.js 22.
3. Enable Corepack.
4. Prepare pnpm from the repository `packageManager` declaration.
5. Install dependencies with `pnpm install --frozen-lockfile`.
6. Run the job-specific command.

The workflow should avoid committed secrets. The smoke harness already generates local-only secrets at runtime and does not need GitHub secrets.

## Smoke Job Behavior

The smoke job runs:

```sh
pnpm smoke:compose --project-name signalhub_ci_smoke --preserve
```

The explicit project name makes CI logs and cleanup easier to understand. It also avoids depending on the default local project name used in operator docs. The `--preserve` flag keeps smoke resources available long enough for CI failure diagnostics.

If the smoke command fails, the workflow should attempt Docker diagnostics before the explicit cleanup step:

```sh
docker compose -p signalhub_ci_smoke ps -a
docker compose -p signalhub_ci_smoke logs --no-color
docker system df
```

These commands are best-effort diagnostics. They should run before cleanup so failures preserve useful container logs when possible. The smoke command log remains the primary evidence.

## Error Handling

The workflow should fail fast within each job when the job command fails.

The smoke diagnostic step should run with `if: failure()` so it does not clutter successful runs. Diagnostic commands should not mask the original failure. A final cleanup step should run with `if: always()` and remove `signalhub_ci_smoke` resources with `docker compose -p signalhub_ci_smoke down -v || true`.

If CI exposes smoke harness timeout or readiness issues that do not appear locally, Phase 6C may tune the harness enough to be reliable in GitHub Actions. Those changes should stay scoped to CI stability and diagnostics. Broad product changes remain out of scope.

## Documentation

Update documentation to describe CI as a verification gate:

- `README.md`: add a short CI section after the Compose Smoke Harness section.
- `.claude/docs/DEPLOYMENT.md`: document the CI release-readiness checks.
- `.claude/docs/STACK.md`: list GitHub Actions as the CI runner for tests, build, Compose config, and smoke.
- `.claude/docs/CONSTRAINTS.md`: clarify that CI validates the Docker Compose install path but does not add hosted deployment, image publishing, Kubernetes, Helm, or systemd support.

Documentation should not imply that CI replaces local verification for release work. It should say CI is the automated baseline and that `pnpm smoke:compose` remains runnable locally.

## Validation Strategy

Local validation for the implementation should include:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm smoke:compose
```

Workflow validation should include:

- `gh workflow view` after the workflow exists;
- inspecting the GitHub PR checks after opening the Phase 6C PR.

If GitHub Actions does not report a run for the Phase 6C PR, record that limitation with evidence instead of inventing a local substitute for the workflow run.

## Completion Criteria

Phase 6C is complete when:

- a GitHub Actions workflow exists and is committed;
- PRs to `main` run tests, build, Compose config, and smoke jobs;
- the smoke job uses `pnpm smoke:compose` with an explicit CI project name;
- smoke failure diagnostics are available in Actions logs;
- documentation describes the CI gate;
- local verification passes;
- the Phase 6C PR shows the workflow running or the limitation is recorded with evidence.

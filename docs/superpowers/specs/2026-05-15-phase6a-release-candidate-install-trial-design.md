# Phase 6A Release Candidate Install Trial Design

## Summary

Run the first release-candidate install trial for SignalHub as a manual, evidence-driven fresh-install drill.

Phase 4D hardened the supported Docker Compose install path with `pnpm run doctor`, production placeholder rejection, and operator documentation. Phases 5A through 5E added the last major release-line capabilities around grouped errors, source maps, CI upload tokens, session breadcrumbs, and source-map retention. Phase 6A validates that a new self-hosted operator can actually install, configure, run, smoke test, back up, restore, and troubleshoot the current product from a clean checkout by following the public path.

This phase is not a new product surface. It is a release-readiness drill that produces a run record, targeted fixes for discovered friction, and a sharper release gate for the next phase.

## Goals

- Validate the supported Docker Compose install path from a clean checkout and fresh volumes.
- Follow public operator documentation rather than relying on maintainer knowledge.
- Prove the bootstrap admin, console login, project setup, environment setup, API key creation, and ingestion path work in a fresh install.
- Smoke test the primary investigation surfaces with real ingested data.
- Validate source-map upload, token use, stack resolution, and source-map retention visibility in the install context.
- Validate manual backup creation and guarded restore behavior against the fresh install.
- Run `pnpm run doctor` before startup and after the stack is running, and capture any confusing output.
- Fix documentation, scripts, defaults, or small product bugs discovered by the drill.
- Produce a concise RC drill record that can become the baseline for future automated smoke tests.

## Non-Goals

- Building a full automated install smoke script in this phase.
- Publishing Docker images or GitHub releases.
- Adding Kubernetes, Helm, systemd, Terraform, or SaaS deployment support.
- Adding a hosted onboarding flow or in-app setup wizard.
- Adding new telemetry product features.
- Exhaustive browser coverage of every console state.
- Load, soak, or performance testing.
- Full security audit or penetration testing.
- Testing managed object storage for source maps.
- Changing the supported production install path away from Docker Compose.

## Approach Options

### Recommended: Manual Fresh-Install RC Drill

Use a clean worktree or temporary checkout, an isolated Compose project name, fresh Compose volumes, and a realistic `.env` derived from `.env.example`. Execute the documented install flow exactly, record the commands and outcomes, and patch the repo only where the drill exposes real friction.

This is the best first RC step because SignalHub has accumulated enough operator-facing behavior that the next risk is integration truth, not another isolated unit. A manual drill also gives better judgment on unclear docs, awkward command ordering, confusing doctor output, and console friction before those assumptions get frozen into automation.

### Alternative: Automated Smoke Script First

Write a one-command smoke script that starts Compose, seeds an admin, creates resources, ingests sample telemetry, and verifies API responses.

This is useful soon, but risky as the first step because it can encode maintainer shortcuts before the public install path has been felt end to end. It also makes it easier to miss documentation gaps that a real operator would hit.

### Alternative: Manual Drill plus Automation in One Phase

Run the manual drill and immediately build the smoke script from the results.

This is attractive, but it makes the phase broad. The first RC drill should stay focused on discovering and fixing install friction. Automation can become Phase 6B once the manual flow is proven and the shape of the smoke data is clear.

## Trial Environment

The trial uses an isolated install context so the main development workspace and existing volumes are not trusted as proof.

Required properties:

- Clean checkout or clean git worktree based on current `origin/main`.
- Fresh Docker Compose project name that does not reuse existing SignalHub volumes.
- Fresh Postgres, Redis, backup, and source-map volumes.
- `.env` created from `.env.example`, with local test secrets replaced by non-placeholder values.
- Public endpoint set to the local Compose API origin used by the drill.
- No hand-edited database state outside documented migrations, seed commands, APIs, and console actions.

The drill may use local filesystem paths under the workspace or `/tmp` for generated smoke fixtures, source maps, and backup artifacts. Any such files should be ignored or removed unless they are intentional documentation artifacts.

## Drill Flow

The manual drill follows the operator path in this order:

1. Create the isolated checkout and verify the branch/commit under test.
2. Create `.env` from `.env.example` and replace required secrets.
3. Run `pnpm install` if dependencies are not already available in the isolated checkout.
4. Run `pnpm run doctor` before startup.
5. Render Compose config with `docker compose config --quiet`.
6. Start Postgres and Redis, then seed the bootstrap admin by documented command.
7. Start the full Compose stack.
8. Run `pnpm run doctor -- --compose --api-url http://localhost:3000`.
9. Verify unauthenticated `/health` and `/ready`.
10. Log into `/console` as the bootstrap admin.
11. Create or confirm a project, environment, and ingestion API key.
12. Ingest representative event, error, trace/span, LLM call, breadcrumb, and source-map-related error data.
13. Confirm Overview and investigation tabs show the fresh data.
14. Create a source-map upload token, upload a source map through the CLI/API path, ingest a matching minified error, and confirm stack resolution metadata appears.
15. Confirm System health surfaces worker, retention, source-map retention, and backup status coherently.
16. Run a manual backup.
17. Perform a guarded restore drill against the fresh install, including the required confirmation flag and stopped API/worker state.
18. Re-run health, readiness, doctor, and a small telemetry smoke after restore.
19. Capture failures, confusing steps, and fixes in the RC drill record.

If a step fails, the drill pauses long enough to capture the command, expected behavior, actual behavior, and likely fix. Small fixes can be implemented in the same phase when they directly unblock or clarify the release path.

## Smoke Data Scope

Use minimal deterministic smoke data rather than broad fixture suites.

The drill should prove:

- events can be ingested and queried;
- errors can be ingested, grouped, triaged, and drilled into as raw occurrences;
- traces and spans can be ingested and inspected in order;
- LLM calls can be ingested and reflected in aggregate totals;
- tenant/user attributes appear in Entities and Users where supplied;
- breadcrumbs appear in raw error session context;
- source maps can be uploaded with a dedicated token and matched by project, environment, release, and minified file;
- backups can be created and a restore command can restore a known fresh-install state.

The smoke data should not require private credentials, external services, or network calls beyond the local install.

## Fix Policy

Phase 6A may include targeted fixes discovered by the drill:

- documentation corrections;
- missing or wrong commands in install, upgrade, backup, restore, or troubleshooting docs;
- `.env.example` gaps;
- confusing doctor messages;
- small script bugs in install-adjacent commands;
- small console or API defects that block the RC drill.

Larger feature ideas should be recorded as follow-up scope rather than pulled into Phase 6A. Examples include a full automated smoke runner, image publishing, release automation, object storage for source maps, or a guided setup wizard.

## RC Drill Record

Add a written run record under `docs/superpowers/` during implementation. The exact path can be chosen in the implementation plan, but it should be distinct from the design and implementation plan.

The record should include:

- commit under test;
- environment shape;
- commands run;
- pass/fail outcome by drill step;
- fixes made during the phase;
- unresolved follow-ups;
- final RC recommendation.

The record should be concise enough to be useful as a release note input and concrete enough to seed a future automated smoke script.

## Documentation Updates

Update operator docs only where the drill proves they need changes.

Likely candidates:

- `README.md`
- `.env.example`
- `.claude/docs/DEPLOYMENT.md`
- `.claude/docs/INFRASTRUCTURE.md`
- `.claude/docs/SECRETS.md`
- `.claude/docs/PROJECT-SUMMARY.md`
- `.claude/docs/STACK.md`
- `.claude/docs/CONSTRAINTS.md`
- `docs/HTTP-INGESTION.md`

Documentation must continue to present Docker Compose as the only production-supported install path for this release line.

## Error Handling

The drill should distinguish three classes of failure:

- **Release blocker:** a fresh install cannot start, cannot seed an admin, cannot ingest telemetry, cannot query core data, cannot back up/restore, or exposes unsafe defaults.
- **Release friction:** the install works, but docs, commands, or diagnostics are misleading, incomplete, or need maintainer knowledge.
- **Follow-up:** the product works as currently scoped, but a missing convenience, automation, or future capability would improve release maturity.

Release blockers must be fixed or explicitly called out before the phase can be considered complete. Release friction should be fixed when the change is small and local. Follow-ups should be recorded without broadening the phase.

## Testing and Verification

Final verification for Phase 6A should include the normal repo checks:

```sh
pnpm test
pnpm build
docker compose config --quiet
pnpm run doctor
```

It should also include the manual RC evidence:

- fresh install doctor before startup;
- Compose-aware doctor after startup;
- health and readiness checks;
- authenticated console smoke;
- ingestion and investigation smoke;
- source-map upload and resolution smoke;
- manual backup and guarded restore drill;
- post-restore health and telemetry smoke.

Browser verification should be used for console flows that cannot be proven by API responses alone. Screenshots are useful for diagnosing layout issues, but this phase does not require a polished screenshot report unless a UI fix is made.

## Rollout

Implementation order:

1. Prepare the isolated install environment.
2. Execute the documented fresh-install flow without making fixes.
3. Record every blocker and friction point.
4. Apply targeted fixes.
5. Re-run the affected drill steps.
6. Complete backup/restore and source-map smoke validation.
7. Run final repo verification.
8. Write the RC drill record and update project memory.

## Open Decisions

None. Phase 6A is a manual fresh-install release-candidate drill. Automated smoke scripting is intentionally deferred to a later phase after this manual flow is proven.

# U1 — CI automatic trigger + `/health` version — findings

Branch `diogohsm/ci-automatico-health-version`, commit `5ff8500c`.
Diff: `git diff main...diogohsm/ci-automatico-health-version` (11 files, +144/-17).

Method: read full files on the branch (not diff-only) via `git show <branch>:<path>`,
confirmed repo visibility with `gh repo view` (PUBLIC), ran the real test suite in an
isolated `git worktree` (`scripts/ci-workflow.test.ts`, `apps/api/test/health.test.ts` —
13/13 pass), and reproduced a guard-test bypass by appending a real deploy job to
`.github/workflows/ci.yml` and re-running the guard test in that worktree. Worktree was
removed afterward; no source, commit, or branch state was touched in the main checkout.

## Findings

### 1. `scripts/ci-workflow.test.ts` guard is a substring check that a real deploy job trivially bypasses — HIGH — guard-test-quality

- **File**: `scripts/ci-workflow.test.ts:129-136` (the "has no hosted deploy job" test), enforcing against `.github/workflows/ci.yml`.
- **Evidence**: Appended this job to `ci.yml` in an isolated worktree and reran the guard test:
  ```yaml
    deploy:
      name: Deploy
      runs-on: ubuntu-latest
      needs: [test, build]
      steps:
        - name: Trigger production deploy
          run: |
            curl -X POST -H "Authorization: Bearer ${{ secrets.DEPLOY_TOKEN }}" "${{ secrets.DEPLOY_URL }}"
  ```
  `npx vitest run scripts/ci-workflow.test.ts` → **9/9 pass**, including the deploy guard. The job never contains the literal strings `deploy-easypanel:`, `EASYPANEL`, `COOLIFY`, or `api/v1/deploy`, so none of the four `not.toContain` assertions fire, yet the job is a fully functional auto-deploy trigger (any repo secret holding a webhook URL works).
- **Why it matters**: This diff turns CI from `workflow_dispatch`-only into automatic on every push to `main` — exactly the scenario the diff's own added comment in the test file calls out: *"This guard carries more weight now that CI fires on every push to main: a deploy job added here would silently become auto-deploy."* The guard does not deliver on that claim. `.claude/docs/DECISIONS.md:5` (new 2026-08-02 entry) states outright that `scripts/ci-workflow.test.ts` "enforces both halves — the automatic triggers and the absence of any deploy step," which is an overclaim given the demonstrated bypass. Because deploys are meant to stay strictly manual (ADR 2026-07-26, amended 2026-08-02) and this test is the *only* automated technical control for that invariant, a reviewer or future contributor could reasonably trust a green CI run as proof no deploy job exists — it is not proof.
- **Suggested fix**: Assert structurally instead of by keyword: parse the YAML (or reuse the existing `jobBlock`/job-name enumeration helpers) and fail if any job other than the four known-good ones (`test`, `build`, `compose-config`, `smoke-compose`) exists, or if any step's `run:` contains `curl`/`wget`/an HTTP client invocation combined with a `secrets.` reference. An allowlist of job names is far harder to route around than a blocklist of vendor strings.
- **Confidence**: 0.95 (reproduced directly, not inferred).

### 2. `/health` `version` disclosure and CI trigger risk — solid, no finding

- Confirmed via `gh repo view --json visibility` that the repository is **PUBLIC**, which is the correct context for judging this. A full commit SHA on an unauthenticated `/health` endpoint doesn't disclose anything not already visible in the public git history; `apps/api/src/routes/health.ts:9-13` reads `process.env.SOURCE_COMMIT` fresh on every call (no caching), so staleness isn't a concern either.
- `.github/workflows/ci.yml` uses `pull_request` (not `pull_request_target`), the top-level `permissions: contents: read` applies to every job (no job overrides it), and no step references `secrets.*`, so a malicious fork PR gains no elevated token or secret exposure by triggering CI. This is the correct, minimal-risk pattern for a public repo.
- `concurrency: group: ci-${{ github.ref }}` is correct for both event types: `pull_request` runs key on `refs/pull/<n>/merge` (unique per PR, so PRs never cancel each other or a `main` push), and `push`/`workflow_dispatch` on `main` share `refs/heads/main` and legitimately supersede each other, matching the stated intent ("a new push supersedes the run still in flight for the same ref").
- No secret, IP, hostname, webhook URL, or app UUID was newly committed to a versioned file. The two new `.claude/docs/SECRETS.md:25-26` rows (Coolify API token, `SOURCE_COMMIT`) use placeholder values consistent with the rest of the table.

### 3. `/health` consumers checked — no breakage

- `scripts/doctor.ts:304-325` (`checkApiHealth`) only inspects `response.ok`/`response.status`, never the JSON body — confirmed by reading the function; adding `version` to the payload is a no-op for it.
- `apps/console` calls `/system/health` and `/system/health/history` (`apps/console/src/api/client.ts:1800-1808`), a distinct admin route, not `GET /health` — unaffected.
- `scripts/smoke-compose.ts` has no reference to `/health` or `version` at all (`grep` returned zero matches) — unaffected.
- `apps/api/src/openapi.ts` only carries an `example`, not a formal JSON Schema with `required`/`additionalProperties: false`, so adding a field is not a spec-breaking change for any schema-validating client. (Minor completeness nit, not a defect: the example only shows the non-null case; the null case is described in prose only. Confidence 0.4, severity trivial — not worth a line item on its own.)

### 4. `apps/api/test/health.test.ts` env mutation — solid

- Both new tests (`health.test.ts:25-47`, `:49-67`) save `process.env.SOURCE_COMMIT`, mutate it, and restore it in a `finally` block including the `undefined` case (`delete` vs reassignment). Vitest runs tests within a file sequentially, and other tests in this file don't read `SOURCE_COMMIT`, so there's no observed leakage. Ran the full file — 4/4 pass, including the pass alongside `ci-workflow.test.ts` in the same run.

### 5. Docs/ADR coherence — solid

- Grepped the whole branch (`git grep`) for stale manual-only-CI language outside the touched files (`PROJECT-SUMMARY.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`, `INFRASTRUCTURE.md`, `UI-UX.md`) — no hits. `README.md`, `CLAUDE.md`, `.claude/docs/DEPLOYMENT.md`, `.claude/GUARDRAILS.md` were all updated consistently with the new automatic-CI/manual-deploy split.
- `.claude/docs/DECISIONS.md`'s 2026-07-26 entry still contains the sentence "GitHub Actions is manual-only (`workflow_dispatch`)" verbatim in its original decision body, but this is preceded by an explicit `**Amended 2026-08-02**` note pointing at the new entry and stating exactly which half no longer applies — this is coherent ADR-amendment style (historical record preserved, amendment flagged), not a live contradiction. Matches the stated intent of "amend, not supersede."
- Historical/archival docs (`docs/superpowers/plans/*.md`, `review/02-backend-logic-errors.md`) still show the old `{ok: true}` shape — these are dated planning/review artifacts, not canonical docs per `CLAUDE.md`'s "Canonical Docs" list, so not in scope and not a finding.

## Summary of severities

- **1 HIGH**: guard-test bypass (finding 1).
- **0 CRIT / MED / LOW** findings raised. (One trivial doc-completeness nit noted inline in finding 3, not counted — confidence 0.4, no user-facing or invariant impact.)

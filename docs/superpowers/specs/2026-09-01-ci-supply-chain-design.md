# CI Dependency Immutability Design

**Linear:** PER-514

## Goal

Make third-party GitHub Actions execution immutable and keep workflow OIDC permission limited to the SDK publishing job that requires it.

## Non-goals

- Replacing GitHub Actions.
- Automatic deployment.
- Changing the Node or pnpm versions selected by existing workflows.
- Adding long-lived npm credentials.

## Immutable executable dependencies

Every third-party `uses:` reference is pinned to the reviewed full 40-character commit SHA for its intended release. A trailing comment retains the human-readable release, for example `# v6`. Commit selection is resolved from the upstream action repository and checked against the release tag immediately before implementation; remembered or search-result-only SHAs are not accepted.

Local actions, if added later, must use a repository-relative path. Docker actions must use an immutable digest.

The npm CLI executed on the publishing boundary is also pinned. The reviewed version is npm 11.19.1 (`sha512-ztsxKxt/kkIaAs+2i0GU6I+DRmUdrNasxTZKJe9TCdSjKxlhah/4r/hl5ygMD6XAg1qZ9c2TNomR4qgOydp10g==` in the public npm registry). The workflow must never install `npm@latest` or another range. Before the next SDK release, maintainers review the current npm Trusted Publishing requirements and advisories, update the exact version deliberately, and run the workflow contract and package dry-run gates.

## Controlled updates

Add `.github/dependabot.yml` with a weekly `github-actions` ecosystem update for `/`. Dependabot PRs remain subject to normal CI and review. The reviewer confirms both the release notes and old/new commit SHAs before merge. Dependabot does not manage the workflow's npm CLI string, so its exact version follows the explicit pre-release review above.

## Permissions

CI keeps workflow-level `contents: read`. Publish SDK moves `id-token: write` from workflow scope to the `publish-sdk` job, alongside `contents: read`. No other current or future job receives OIDC. Because the workflow currently contains only that job and GitHub has no step-level permission primitive, this is future-proof scoping rather than a reduction in the steps currently able to request a token. Full build/publish job separation is out of scope because it would add an artifact handoff and additional trusted actions. Trusted Publishing remains the only npm authentication mechanism.

## Contract tests

Extend `scripts/ci-workflow.test.ts` to scan all workflow files plus `.github/actions/**/action.{yml,yaml}`. Repository actions require a full 40-character commit SHA and release comment; Docker actions require `@sha256:` plus a 64-character digest; repository-relative local actions remain allowed. Fail when `id-token: write` appears outside the publish job. Assert `package-manager-cache: false`, exact npm 11.19.1 with no `@latest`, and the Dependabot GitHub Actions configuration.

## Acceptance criteria

- No third-party action uses a mutable tag or branch.
- No mutable npm CLI version is installed on the publish boundary.
- Each pin has a readable release comment.
- Dependabot can propose reviewed action updates.
- OIDC is granted only to the SDK publish job.
- Existing test, build, Compose, smoke, and manual publishing behavior is unchanged.

## Verification

Run the workflow contract tests; independently parse every discovered workflow, composite-action manifest, and Dependabot YAML file; inspect GitHub's rendered workflow diff; and run the repository test/build gates. The first live GitHub run after merge is observed before PER-514 closes.

# CI Dependency Immutability Design

**Linear:** PER-514

## Goal

Make third-party GitHub Actions execution immutable and keep workflow OIDC permission limited to the SDK publishing job that requires it.

## Non-goals

- Replacing GitHub Actions.
- Automatic deployment.
- Changing the Node or pnpm versions selected by existing workflows.
- Adding long-lived npm credentials.

## Immutable actions

Every third-party `uses:` reference is pinned to the reviewed full 40-character commit SHA for its intended release. A trailing comment retains the human-readable release, for example `# v6`. Commit selection is resolved from the upstream action repository and checked against the release tag immediately before implementation; remembered or search-result-only SHAs are not accepted.

Local actions, if added later, must use a repository-relative path. Docker actions must use an immutable digest.

## Controlled updates

Add `.github/dependabot.yml` with a weekly `github-actions` ecosystem update for `/`. Dependabot PRs remain subject to normal CI and review. The reviewer confirms both the release notes and old/new commit SHAs before merge.

## Permissions

CI keeps workflow-level `contents: read`. Publish SDK moves `id-token: write` from workflow scope to the `publish-sdk` job, alongside `contents: read`. No other job receives OIDC. Trusted Publishing remains the only npm authentication mechanism.

## Contract tests

Extend `scripts/ci-workflow.test.ts` to parse all workflow files and fail when a non-local `uses:` value lacks a full SHA, when its release comment is missing, or when `id-token: write` appears outside the publish job. Add a contract assertion for the Dependabot GitHub Actions configuration.

## Acceptance criteria

- No third-party action uses a mutable tag or branch.
- Each pin has a readable release comment.
- Dependabot can propose reviewed action updates.
- OIDC is granted only to the SDK publish job.
- Existing test, build, Compose, smoke, and manual publishing behavior is unchanged.

## Verification

Run the workflow contract tests, parse both YAML files with an independent parser, inspect GitHub's rendered workflow diff, and run the repository test/build gates. The first live GitHub run after merge is observed before PER-514 closes.

# Phase 5D Source Map CI Upload Design

## Summary

Add CI-friendly source-map uploads without weakening the existing ingestion API-key model.

Phase 5B added local-first source-map storage and admin-console uploads. That works for manual operation, but production frontend builds need an automated way to upload release artifacts after each deployment. Phase 5D adds dedicated source-map upload tokens, a scoped CI upload API, a small token-management UI in `Artifacts`, and a repo-local CLI package for build pipelines.

This phase keeps source maps self-hosted and local-first. It does not add object storage, source-code viewing, visual session replay, or a broad permission system.

## Goals

- Let admins create and revoke source-map upload tokens scoped to one project and environment.
- Return each token secret only once at creation time.
- Let CI upload a single `.map` file or a `.zip` bundle with a dedicated token.
- Keep normal browser ingestion API keys unable to upload source maps.
- Reuse the existing source-map parsing, validation, storage, and metadata path.
- Add a first CLI command for CI and local scripts.
- Add documentation for GitHub Actions and generic shell CI usage.
- Keep the implementation safe for self-hosted installs and easy to operate.

## Non-Goals

- npm publishing automation for the CLI.
- A GitHub Action wrapper.
- Object storage or Cloudflare R2 for source-map artifacts.
- Source-code viewer or `sourcesContent` rendering.
- Source-map retention scheduler.
- Upload tokens with arbitrary roles or broad permissions.
- Reusing ingestion API keys for artifact uploads.
- Uploading source maps directly from unauthenticated browsers.
- Cross-release source-map matching or guessing.

## Approach Options

### Recommended: Dedicated Upload Tokens Plus CLI

Create a separate source-map upload token model and add `POST /v1/source-maps` for token-authenticated CI uploads. Add `packages/cli` with `signalhub sourcemaps upload` so CI systems do not have to hand-roll multipart requests.

This is the best fit because it removes production friction while keeping upload authority separate from keys that may live in browser applications.

### Alternative: Dedicated Upload Tokens with HTTP Docs Only

The backend would be safe, but every operator would still need to build multipart upload logic in CI. That leaves the main adoption problem mostly unsolved.

### Alternative: Reuse Existing Ingestion API Keys

This is simpler but too permissive. Browser ingestion keys can be exposed to client apps, and source-map uploads should not be available to those secrets.

## Data Model

Add `source_map_upload_tokens`:

```txt
id
project_id
environment_id
name
prefix
hash
created_at
last_used_at
revoked_at
```

Rules:

- `project_id` and `environment_id` must reference an active project/environment pair when a token is created.
- `prefix` is unique and is used to find the candidate token before hash verification.
- `hash` stores a peppered hash of the one-time secret.
- `last_used_at` updates after successful token authentication.
- `revoked_at` disables the token immediately.

Update `source_map_artifacts` attribution:

```txt
uploaded_by_user_id nullable
uploaded_by_token_id nullable
```

Exactly one attribution field should be set for new uploads:

- Admin console uploads set `uploaded_by_user_id`.
- CI token uploads set `uploaded_by_token_id`.

Existing source-map artifacts keep their user attribution. API and console responses should tolerate either attribution shape without exposing token hashes or secrets.

## Token Secret Format

Source-map upload token secrets should be distinguishable from regular ingestion API keys, for example:

```txt
shsmap_<random>
```

The prefix returned in list responses should be long enough for operators to identify a secret in CI logs without exposing the full value. The full secret is returned only from token creation.

Hashing uses the existing `API_KEY_PEPPER` strategy in this phase. A separate artifact-token pepper is out of scope.

## Admin API

Add admin-session routes:

```txt
GET /admin/source-map-upload-tokens?project_id=&environment_id=
POST /admin/source-map-upload-tokens
DELETE /admin/source-map-upload-tokens/:id?project_id=&environment_id=
```

Create body:

```json
{
  "projectId": "prj_1",
  "environmentId": "env_1",
  "name": "GitHub Actions production"
}
```

Create response:

```json
{
  "token": {
    "id": "smtok_1",
    "projectId": "prj_1",
    "environmentId": "env_1",
    "name": "GitHub Actions production",
    "prefix": "shsmap_abcd",
    "createdAt": "2026-05-11T12:00:00.000Z",
    "lastUsedAt": null,
    "revokedAt": null,
    "secret": "shsmap_abcd..."
  }
}
```

List responses must omit `hash` and `secret`.

Delete should revoke, not hard-delete, so operators keep audit context and old CI secrets stop working.

## CI Upload API

Add:

```txt
POST /v1/source-maps
Authorization: Bearer <source-map-upload-token>
Content-Type: multipart/form-data
```

Single map fields:

```txt
project_id
environment_id
release
minified_file optional
file
```

Bundle fields:

```txt
project_id
environment_id
release
bundle
```

The token provides the authoritative project/environment scope. The request must include `project_id` and `environment_id` as a guardrail, and the API rejects mismatches with a scope error. This prevents a CI job from silently uploading a release to the wrong environment when a wrong token is configured.

The route uses the same multipart limits as admin source-map uploads. It calls the same single-map and bundle upload services, but passes token attribution instead of user attribution.

Response:

```json
{
  "artifacts": [
    {
      "id": "smap_1",
      "projectId": "prj_1",
      "environmentId": "env_1",
      "release": "web@1.2.3",
      "minifiedFile": "assets/app.js",
      "originalFilename": "app.js.map",
      "byteSize": 12345,
      "sha256": "...",
      "createdAt": "2026-05-11T12:00:00.000Z"
    }
  ]
}
```

The CI upload response must not include storage paths. The existing admin source-map responses can keep their current contract for this phase.

## CLI Package

Add `packages/cli` as `@signal-hub/cli`.

Binary:

```txt
signalhub
```

First command:

```txt
signalhub sourcemaps upload
```

Supported flags:

```txt
--endpoint <url>
--token <secret>
--project-id <id>
--environment-id <id>
--release <release>
--file <path>
--bundle <path>
--minified-file <path>
```

Environment fallbacks:

```txt
SIGNALHUB_ENDPOINT
SIGNALHUB_SOURCE_MAP_TOKEN
SIGNALHUB_PROJECT_ID
SIGNALHUB_ENVIRONMENT_ID
SIGNALHUB_RELEASE
```

Validation:

- `--endpoint`, token, project id, environment id, and release are required through flags or environment.
- Exactly one of `--file` and `--bundle` is required.
- `--minified-file` is allowed only with `--file`.
- File paths must exist and be regular files.
- Endpoint is normalized without duplicating slashes before `/v1/source-maps`.

Output:

```txt
Uploaded 3 source map artifact(s) for release web@1.2.3.
- assets/app.js
- assets/vendor.js
- assets/runtime.js
```

Failures should be concise and CI-friendly. Token values must never be printed.

Implementation should use Node 22 built-in `fetch`, `FormData`, `Blob`, and filesystem APIs rather than adding an HTTP client dependency.

## Admin Console

Extend `Artifacts` with an `Upload tokens` section scoped to the active project and environment.

The section should include:

- token list,
- create form with token name,
- one-time secret display after create,
- revoke action,
- loading, empty, unavailable, and retry states.

Token rows show:

```txt
name
prefix
created_at
last_used_at
revoked_at or active state
```

The UI should stay compact and operational. It should not introduce role management, token scopes beyond the active project/environment, or a wizard.

## Security and Privacy

- Upload tokens are not admin sessions.
- Upload tokens cannot list, delete, resolve, or read source maps.
- Upload tokens cannot upload telemetry signals.
- Upload tokens cannot override their project/environment scope.
- Revoked tokens fail authentication immediately.
- Token hashes and full secrets are never returned after creation.
- CLI and API errors must not echo full token values.
- Source-map parsing rules from Phase 5B still apply, including no source-content rendering.
- Multipart limits still apply.
- Failed uploads should not leave orphaned files beyond the cleanup guarantees already required by the source-map storage service.

## Documentation

Update:

- `README.md` with a Source Map CI Upload section.
- `.claude/docs/ARCHITECTURE.md` with the new token model and CI upload route.
- `.claude/docs/SECRETS.md` with CI token environment variable guidance and redaction rules.
- `.claude/docs/STACK.md` with `packages/cli`.
- `.claude/docs/UI-UX.md` with the Artifacts token-management behavior.
- `.claude/docs/PROJECT-SUMMARY.md` with Phase 5D status.
- Project memory with the Phase 5D decision and completion status.

Documentation should include generic shell usage and a GitHub Actions example using repository secrets.

## Testing

Repository tests:

- create/list/find/revoke source-map upload tokens,
- reject token creation for archived or mismatched project/environment scope,
- update `last_used_at` after successful authentication,
- artifact attribution for admin uploads and token uploads.

API tests:

- admin token list/create/revoke authorization,
- one-time secret returned only on create,
- source-map CI upload succeeds for single map,
- source-map CI upload succeeds for bundle,
- invalid/revoked token rejected,
- project/environment mismatch rejected,
- invalid multipart rejected,
- too-large upload returns payload-too-large response,
- CI route does not expose storage paths or token metadata.

CLI tests:

- parses flags,
- uses environment fallbacks,
- uploads single map,
- uploads bundle,
- rejects missing required inputs,
- rejects both file and bundle,
- handles non-2xx responses,
- does not leak token values in output.

Console tests:

- loads token list in Artifacts,
- creates token and displays secret once,
- refreshes list after create,
- revokes token,
- resets token state when project/environment changes.

## Rollout Notes

This phase can ship without changing existing source-map admin uploads. Existing operators can keep using the console upload path, while CI users create a dedicated token and move automation to `POST /v1/source-maps`.

Future phases can add an npm publish workflow, GitHub Action wrapper, object storage, source-map retention, or source-code viewer without changing the core token boundary.

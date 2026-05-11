# Phase 5B Source Maps and Release Artifacts Design

## Summary

Add the first source-map workflow for SignalHub so frontend production errors can be resolved back to original source locations.

Phase 5A made Errors operational through grouped triage. Phase 5B makes frontend error details more actionable by letting admins upload source maps for a specific project, environment, and release. When an operator opens a raw error, SignalHub resolves minified stack frames on demand against the matching release artifacts and shows original file, line, column, and function metadata.

This phase optimizes for safe self-hosted operation first: local artifact storage, admin-session upload, strict release matching, and no original source-content display.

## Goals

- Allow admins to upload one `.map` file for a release.
- Allow admins to upload a `.zip` bundle containing multiple `.map` files for one release.
- Store uploaded artifacts on a local filesystem path mounted in Docker Compose.
- Store artifact metadata in Postgres.
- Match errors to source maps only within the same project, environment, and release.
- Resolve raw error stack frames on demand when viewing an error.
- Cache resolved stack-frame metadata for reuse.
- Invalidate cached resolutions when a related artifact is deleted.
- Add an admin console UI to upload, list, and delete release artifacts.
- Show resolved frame metadata in raw error details without rendering original source code contents.

## Non-Goals

- Object storage for source maps.
- CLI or CI upload helper.
- Public ingestion API changes for source map uploads.
- Accepting source map uploads with ingestion API keys.
- Source code viewer or `sourcesContent` rendering.
- Source map retention automation.
- Cross-release guessing.
- Semantic stack matching.
- Rewriting stored raw error stacks.
- Resolving trace spans, LLM calls, events, or backend stack traces beyond raw error details.

## Approach Options

### Recommended: Local Artifact Store with DB Metadata and On-Demand Resolution

Store uploaded source maps under a configured local directory and store metadata in Postgres. Resolve raw error stacks only when the operator opens an error detail, then cache the resolved frame metadata.

This fits the self-hosted core because it avoids a new external dependency, keeps ingestion fast, supports older errors after maps are uploaded, and makes operational behavior easy to inspect.

### Alternative: Store Source Map Contents in Postgres

This avoids mounting a source-map directory, but large maps and bundles would bloat the primary database and make backups heavier. It also makes artifact deletion and disk-level inspection less straightforward.

### Alternative: Object Storage First

S3-compatible storage is better for larger deployments, but it adds credentials, buckets, lifecycle rules, and upload failure modes before the resolver model is proven. This remains a later extension.

## Data Model

Add `source_map_artifacts`:

```txt
id
project_id
environment_id
release
minified_file
original_filename
content_type
byte_size
sha256
storage_path
uploaded_by_user_id
created_at
deleted_at
```

Add `error_stack_resolutions`:

```txt
id
error_id
project_id
environment_id
release
source_map_artifact_id
frame_index
minified_file
minified_line
minified_column
original_source
original_line
original_column
original_name
created_at
```

Constraints and indexes:

- `source_map_artifacts(project_id, environment_id, release, minified_file)` is unique for non-deleted artifacts.
- `source_map_artifacts(project_id, environment_id, release, created_at desc)` supports release artifact lists.
- `error_stack_resolutions(error_id, frame_index)` is unique.
- `error_stack_resolutions(source_map_artifact_id)` supports cache invalidation on artifact delete.

Artifact contents stay on disk. Postgres stores paths and resolution metadata only.

## Local Storage

Add non-secret config:

```dotenv
SOURCE_MAPS_LOCAL_DIR=/var/lib/signalhub/source-maps
SOURCE_MAPS_MAX_UPLOAD_MB=50
```

Docker Compose mounts a `source_map_data` volume into the API container at `/var/lib/signalhub/source-maps`.

The API writes artifacts below the configured directory using server-generated names, not user-provided paths. A safe path shape is:

```txt
<SOURCE_MAPS_LOCAL_DIR>/<project_id>/<environment_id>/<release>/<artifact_id>.map
```

The implementation must reject path traversal and must never trust filenames inside uploaded ZIP files as filesystem paths. ZIP entries are used only to discover `.map` files and infer metadata.

## Upload Workflow

Uploads are admin-session authenticated.

Single map upload input:

```txt
project_id
environment_id
release
minified_file
file
```

ZIP upload input:

```txt
project_id
environment_id
release
bundle
```

For ZIP uploads:

- only `.map` entries are accepted,
- nested path names are normalized to basename-like metadata,
- each map is parsed to infer its minified file from `file` when available,
- maps without an inferable minified file are rejected,
- the bundle is handled as multiple artifact records under the same release.

If an upload conflicts with an existing non-deleted artifact for the same project, environment, release, and minified file, the API should reject it with a conflict response. Operators can delete the existing artifact and upload a replacement.

## Source Map Parsing

Use a proven source-map parser library for the core mapping logic.

Supported source map shape for this phase:

- source map version 3,
- JSON source map files,
- regular `mappings`,
- `sources`,
- `names`,
- optional `sourcesContent` may be present but is not displayed in the console.

Indexed source maps are out of scope for this slice.

## Stack Frame Parsing

The resolver parses common browser stack frame formats from the stored raw `errors.stack` string:

```txt
at functionName (https://cdn.example.com/assets/app.abc123.js:10:1234)
at https://cdn.example.com/assets/app.abc123.js:10:1234
functionName@https://cdn.example.com/assets/app.abc123.js:10:1234
```

For each parsed frame, extract:

```txt
frame_index
function_name
minified_file
minified_line
minified_column
```

`minified_file` matching should compare normalized URL/path basenames and suffixes. It must still require exact project, environment, and release match before considering files.

Frames that cannot be parsed remain unresolved and are shown as raw stack lines.

## On-Demand Resolution

When an operator opens a raw error detail:

1. The console loads the raw error as it does today.
2. If the error has a non-empty `release` and `stack`, the console can request stack resolution.
3. The API checks cached `error_stack_resolutions` for the error.
4. If cache exists, return it.
5. If cache is missing, parse stack frames.
6. For each frame, find a source map artifact with matching project, environment, release, and minified file.
7. Resolve the original position through the source map parser.
8. Store successful frame resolutions.
9. Return resolved frame metadata plus unresolved frame count.

Resolution is best-effort per frame. One bad frame, missing map, or parser failure must not fail the raw error detail.

Ingestion does not resolve stacks. Uploading maps after errors already exist works because resolution happens on demand.

## Cache Invalidation

Deleting a source map artifact first deletes the physical artifact file, then soft-deletes the artifact metadata and removes cached `error_stack_resolutions` rows referencing that artifact.

If physical file deletion fails, the API returns a failure and leaves metadata plus cached resolutions unchanged. This favors honest operator state over hiding metadata for a file that may still exist on disk.

## API

Add admin routes:

```txt
GET /admin/source-maps?project_id=&environment_id=&release=
POST /admin/source-maps
DELETE /admin/source-maps/:id?project_id=&environment_id=
```

The POST route accepts multipart form data.

Add query route:

```txt
GET /query/errors/:id/source-map-resolution?project_id=&environment_id=
```

The query route returns:

```txt
errorId
release
status: resolved | partially_resolved | unresolved | unavailable
frames: [
  {
    frameIndex
    minifiedFile
    minifiedLine
    minifiedColumn
    originalSource
    originalLine
    originalColumn
    originalName
    sourceMapArtifactId
  }
]
unresolvedFrameCount
```

If the error has no release, no stack, or no matching maps, return `unresolved` with an empty `frames` array, not an error.

## Console UX

Add an admin-focused `Artifacts` top-level console mode.

The Artifacts view is scoped to the active project and environment and includes:

- release input,
- single `.map` upload with explicit `minified_file`,
- ZIP bundle upload for a release,
- list of uploaded artifacts grouped or filterable by release,
- artifact metadata: release, minified file, original filename, size, upload time, uploader,
- delete action for bad uploads.

Raw error details show a Source map resolution section:

- `Unresolved` when release/stack/maps are missing,
- `Partially resolved` when some frames resolve,
- `Resolved` when all parsed frames resolve,
- resolved frame rows with original source, line, column, and optional original name,
- raw stack remains visible.

The console must not render original source code contents from `sourcesContent` in this phase.

## Security and Safety

- Uploads require authenticated admin sessions.
- Ingestion API keys cannot upload artifacts.
- The API enforces max upload size.
- ZIP extraction must defend against zip-slip path traversal and excessive entry counts.
- Uploaded artifact paths are server-generated.
- File names and minified file values are treated as metadata and escaped by the UI.
- Source map contents may contain proprietary source; do not expose source contents in API or UI responses in this phase.
- Doctor should warn if the configured source-map directory is missing or not writable when source-map support is enabled by default.

## Testing

Backend tests:

- migration creates artifact and resolution tables,
- single map upload stores metadata and file,
- ZIP upload creates multiple artifact records,
- duplicate artifact upload returns conflict,
- delete invalidates cached resolutions,
- resolver requires matching project, environment, and release,
- resolver returns unresolved for missing release, missing stack, or missing map,
- resolver resolves a simple minified stack frame to original source position.

Console tests:

- Artifacts mode lists artifacts for active scope,
- single map upload sends multipart form data,
- ZIP upload sends release bundle,
- delete removes an artifact row,
- raw error detail shows unresolved state,
- raw error detail shows resolved frame metadata without source content.

Operational verification:

- `pnpm test`
- `pnpm build`
- `docker compose config --quiet`
- `pnpm run doctor`

## Documentation Updates

Update:

- `.env.example` with source-map local directory and upload size.
- `README.md` with manual source-map upload flow.
- `.claude/docs/ARCHITECTURE.md` with artifact metadata and resolver flow.
- `.claude/docs/DEPLOYMENT.md` with the Compose source-map volume.
- `.claude/docs/INFRASTRUCTURE.md` with local artifact storage.
- `.claude/docs/SECRETS.md` for new non-secret config.
- `.claude/docs/UI-UX.md` for the Artifacts mode and error detail resolution section.
- `.claude/docs/DECISIONS.md` for local-first source-map artifact storage.

## Acceptance Criteria

- Admins can upload one `.map` file for a project, environment, and release.
- Admins can upload a `.zip` with multiple `.map` files for one release.
- Uploaded maps persist on local storage and metadata persists in Postgres.
- Raw errors resolve only against matching project, environment, and release artifacts.
- Old errors can resolve after source maps are uploaded.
- Cached resolutions are reused.
- Deleting an artifact invalidates related cached resolutions.
- The console can list and delete artifacts.
- Raw error details can show resolved original file, line, column, and name metadata.
- The console does not show original source code contents.
- Full tests, build, Compose config, and doctor checks pass.

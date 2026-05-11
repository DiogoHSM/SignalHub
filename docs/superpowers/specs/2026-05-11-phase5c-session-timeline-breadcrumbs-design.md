# Phase 5C Session Timeline and Breadcrumbs Design

## Summary

Add lightweight session breadcrumbs so operators can understand what happened around a user session before an error, trace failure, or relevant event without recording full visual session replay.

Phase 5A made Errors actionable through grouping. Phase 5B made production frontend stack traces readable through source maps. Phase 5C adds the missing behavioral context: a safe chronological trail of navigation, interactions, console signals, selected network summaries, and custom application breadcrumbs tied to the same project, environment, user, tenant, session, trace, source, and release identifiers already used by the telemetry core.

This phase optimizes for self-hosted safety first. It stores structured breadcrumbs, not DOM snapshots or screen recordings. It avoids raw form values, request bodies, response bodies, and high-volume replay payloads.

## Goals

- Add a `breadcrumb` ingestion signal for lightweight session activity.
- Store breadcrumbs in Postgres with the same project/environment scope as other telemetry.
- Support optional tenant, user, session, trace, source, release, timestamp, and metadata context.
- Add a JavaScript SDK method for manual breadcrumbs.
- Add safe browser helper options for route, click, console, and failed/slow network breadcrumbs.
- Keep automatic browser capture disabled or explicitly configurable where privacy risk is higher.
- Add query APIs for session-scoped breadcrumb timelines.
- Show session context from raw error details when the error has a `session_id`.
- Keep the console timeline compact, filterable by time window, and linked to existing investigation views where possible.
- Add short retention support for breadcrumbs.

## Non-Goals

- Full visual session replay.
- DOM mutation recording.
- Screenshots, canvas capture, or video capture.
- Keystroke capture.
- Form field values.
- Request or response bodies.
- Full network waterfall tracing.
- Backend automatic framework instrumentation.
- Browser bundle CDN packaging.
- Cross-project session correlation.
- User deletion workflows beyond future retention/deletion extensions.
- Alert rules based on breadcrumbs.

## Approach Options

### Recommended: Structured Breadcrumbs with Session Timeline

Add breadcrumbs as a new structured signal type and render them as a session timeline in the console. The SDK supports manual breadcrumbs immediately, with narrowly scoped browser auto-capture helpers that sanitize aggressively before enqueueing.

This gives operators most of the debugging value needed after an error while keeping storage, privacy, and operations manageable for self-hosted installs.

### Alternative: Full Session Replay First

Recording DOM changes and replaying them visually would be more familiar to users of replay products, but it carries much higher implementation and safety risk. Reliable masking, replay correctness, storage volume, and retention become the core project rather than a small debugging improvement.

### Alternative: Reuse Product Events as Breadcrumbs

SignalHub could treat existing events as the session timeline. That avoids a table, but it mixes product analytics with debugging context, cannot represent console or network breadcrumbs cleanly, and makes retention and privacy controls less precise.

## Breadcrumb Model

Add a `breadcrumbs` telemetry table:

```txt
id
project_id
environment_id
tenant_id
user_id
session_id
trace_id
timestamp
received_at
source
release
metadata
type
category
message
level
data
```

Recommended field meanings:

- `type`: broad breadcrumb kind.
- `category`: optional narrower namespace such as `route`, `click`, `console`, `fetch`, or application-defined areas.
- `message`: short human-readable summary.
- `level`: `debug`, `info`, `warning`, `error`, or `fatal`.
- `data`: sanitized structured detail specific to the breadcrumb kind.
- `metadata`: shared envelope metadata, consistent with other telemetry tables.

Supported breadcrumb types for this phase:

```txt
navigation
click
console
network
custom
```

Breadcrumb rows are immutable telemetry. They do not have operator workflow state.

## Ingestion Contract

Add `POST /v1/breadcrumbs` with API-key authentication.

Payload:

```json
{
  "timestamp": "2026-05-11T12:00:00.000Z",
  "tenant_id": "tenant_1",
  "user_id": "user_1",
  "session_id": "session_1",
  "trace_id": "trace_1",
  "source": "web",
  "release": "web@1.2.3",
  "metadata": {},
  "type": "navigation",
  "category": "route",
  "message": "Navigated to /checkout",
  "level": "info",
  "data": {
    "from": "/cart",
    "to": "/checkout"
  }
}
```

Validation rules:

- `type` is required and limited to supported values.
- `message` is required, trimmed, and bounded.
- `category` is optional and bounded.
- `level` defaults to `info`.
- `data` and `metadata` are JSON objects, recursively bounded by existing sanitization and payload size limits.
- `session_id` is optional at ingestion, but session timeline queries require it.

Worker ingestion follows the existing pattern: validate again, sanitize recursively, persist to Postgres, and record dead-letter failures through the existing queue safety path.

## SDK Contract

Add SDK types:

```ts
type BreadcrumbType = "navigation" | "click" | "console" | "network" | "custom";
type BreadcrumbLevel = "debug" | "info" | "warning" | "error" | "fatal";

type BreadcrumbInput = {
  type: BreadcrumbType;
  category?: string;
  message: string;
  level?: BreadcrumbLevel;
  data?: SignalMetadata;
  timestamp?: Date | string;
};
```

Add client method:

```ts
client.breadcrumb(input: BreadcrumbInput, context?: SignalContext): void
```

Manual breadcrumbs are the foundation. They let applications mark meaningful session steps without waiting for automatic browser helpers.

## Browser Helper

Add an optional browser helper on top of the SDK rather than making browser behavior implicit in the base client.

Proposed shape:

```ts
createBrowserBreadcrumbs(client, {
  navigation: true,
  clicks: true,
  console: true,
  network: false,
  maxBreadcrumbsPerMinute: 120
});
```

Default safety:

- route/navigation capture can be enabled by default by the helper,
- click capture is opt-in,
- console warning/error capture is opt-in,
- network capture is disabled by default,
- no helper captures input values,
- all helper-generated breadcrumbs go through the same SDK sanitization and payload size enforcement.

This keeps the core SDK usable in Node and non-browser environments while giving browser products a practical path to session context.

## Sanitization and Privacy

Breadcrumb collection must be conservative.

Navigation:

- Store path-like URL summaries.
- Redact query parameter values by default.
- Do not store URL fragments unless explicitly allowed later.

Click:

- Store safe element summary only.
- Allowed data examples: tag name, role, sanitized aria-label, sanitized visible text snippet, safe CSS-like selector summary.
- Do not store form values, input values, textarea values, selected values, or full DOM paths with unbounded text.
- Bound text snippets aggressively.

Console:

- Capture warning/error level and sanitized message.
- Do not capture arbitrary object expansions in this phase.
- Stack traces are allowed only as bounded sanitized strings if available.

Network:

- Capture method, sanitized URL path, status, duration, and failure class.
- Do not capture headers, cookies, request bodies, response bodies, or full URLs with secrets.
- Disabled by default.

Custom:

- Use the existing recursive sanitization and payload size limit.
- Documentation must tell users not to pass secrets or raw form values.

## Retention

Add breadcrumb retention config:

```dotenv
RETENTION_BREADCRUMBS_DAYS=30
```

The worker retention scheduler deletes old breadcrumb rows in bounded batches, consistent with other telemetry cleanup.

The default is shorter than errors and LLM calls because breadcrumbs can be more numerous and closer to user behavior.

## Query API

Add session timeline query:

```txt
GET /query/sessions/:sessionId/timeline
```

Required query:

```txt
project_id
environment_id
```

Optional query:

```txt
tenant_id
user_id
from
to
center
before
after
types
limit
cursor
```

Behavior:

- Requires a logged-in human session.
- Always scopes by project and environment.
- Filters to exact `session_id`.
- Supports optional exact tenant/user narrowing.
- Default ordering is chronological ascending for timeline rendering.
- `center`, `before`, and `after` support loading a bounded window around an error timestamp.
- Cursor pagination supports expanding older/newer context.

Response:

```ts
type SessionTimelineResponse = {
  sessionId: string;
  scope: { projectId: string; environmentId: string };
  range: { from: string | null; to: string | null };
  items: SessionTimelineItem[];
  page: { nextCursor: string | null; previousCursor: string | null };
};
```

Timeline items should include breadcrumbs plus selected existing signals when they share the same session:

- breadcrumbs,
- events,
- errors,
- traces,
- LLM calls.

Spans remain reachable through trace detail, not expanded into the session timeline in this phase.

## Console Experience

### Error Detail Session Context

When a raw error has `session_id`, the error detail drawer shows a `Session context` section.

Default behavior:

- Load a bounded timeline around the error timestamp.
- Show breadcrumbs and nearby existing signals in timestamp order.
- Highlight the selected error.
- Let operators open matching raw signal views through existing drilldown behavior where possible.
- Show empty and unavailable states clearly.

If an error has no `session_id`, show no session context section or show a quiet unavailable state.

### Sessions Investigation Tab

The first 5C implementation adds a reusable session timeline component and mounts it from raw error details. A full `Sessions` investigation tab is deferred until the timeline model is proven with real breadcrumb data.

The design reserves `Sessions` as the eventual investigation area for searching sessions by tenant, user, activity, and error count.

## Data Flow

Manual breadcrumb:

1. Application calls `client.breadcrumb`.
2. SDK merges default context and per-call context.
3. SDK sanitizes and queues the payload.
4. SDK sends `POST /v1/breadcrumbs`.
5. API validates auth and payload, enqueues the job, and returns `202 Accepted`.
6. Worker validates, sanitizes, and writes the breadcrumb row.
7. Console queries timeline rows by session when needed.

Browser helper breadcrumb:

1. Helper observes a configured browser event.
2. Helper builds a safe summary.
3. Helper calls `client.breadcrumb`.
4. The normal SDK ingestion path handles queueing, sanitization, delivery, and retry.

## Error Handling

- Invalid breadcrumb payloads return the same validation-style ingestion errors as other signals.
- Breadcrumb queue failures use existing SDK retry and overflow behavior.
- Browser helper observer failures must be swallowed and reported through SDK `onError` only when useful.
- Timeline query failures show unavailable state and retry in the console.
- Missing session id returns a client-side empty state rather than an API error where the UI can avoid the request.

## Testing

Backend:

- schema migration creates `breadcrumbs`,
- ingestion schema accepts valid breadcrumbs and rejects unsafe/oversized shapes,
- API accepts `POST /v1/breadcrumbs` with API key and rejects unauthenticated requests,
- worker persists sanitized breadcrumbs,
- retention deletes old breadcrumbs,
- session timeline query scopes by project/environment/session and supports center windows.

SDK:

- `client.breadcrumb` maps context correctly,
- manual breadcrumb payloads use `/v1/breadcrumbs`,
- queue, retry, payload size, and sanitization behavior remain consistent,
- browser helper captures only enabled sources,
- helper sanitizes URLs, clicks, console messages, and network summaries.

Console:

- error detail loads session context only when `sessionId` exists,
- session timeline renders mixed item types in order,
- selected error is highlighted,
- unavailable, loading, and empty states are covered,
- drilldowns preserve project/environment and relevant filters.

## Documentation

Update:

- README ingestion examples with manual breadcrumb usage.
- SDK guide with safe browser helper examples.
- `.claude/docs/ARCHITECTURE.md` with breadcrumb storage and session timeline query.
- `.claude/docs/PROJECT-SUMMARY.md` current phase.
- `.claude/docs/STACK.md` only if dependencies change.
- `.claude/docs/SECRETS.md` only if new env values are added.
- `.claude/docs/UI-UX.md` with the session context behavior.

## Deferred Follow-Ups

- Full visual session replay.
- DOM mutation replay.
- Session search and full Sessions investigation tab.
- Per-project breadcrumb capture controls in the admin console.
- Per-environment sampling controls in the admin console.
- User data deletion tooling.
- Network allow/deny rules.
- Browser CDN bundle.
- Framework-specific automatic integrations.
- Alert rules based on breadcrumb patterns.

## Acceptance Criteria

- Operators can ingest manual breadcrumbs through the SDK.
- Browser products can opt into safe automatic breadcrumb sources.
- Breadcrumbs are stored as scoped telemetry and retained with a shorter configurable window.
- Opening a raw error with `session_id` shows nearby session context.
- The timeline never displays raw form values, request bodies, response bodies, cookies, or headers.
- Existing telemetry ingestion, query, retention, and console tests remain green.

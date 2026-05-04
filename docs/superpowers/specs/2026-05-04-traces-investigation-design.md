# Phase 3 Traces Investigation Design

## Source

This design extends `PRD.md` v0.2 and the completed Phase 3 Events and Errors investigation workspaces.

The goal is to add the third read-only investigation view: traces with their ordered spans. This slice should reuse the established `Investigate` list/detail pattern and avoid cross-signal timelines, charts, or mutation workflows until those are explicitly designed.

## Product Boundary

In scope:

- Enable `Traces` inside the existing `Investigate` workspace.
- Keep `Events` as the default active investigation tab.
- Keep `LLM` visible but disabled.
- Show raw trace records in a dense list.
- Filter traces by project, environment, tenant, user, session, trace id, date range, and limit.
- Selecting a trace opens a read-only detail drawer.
- Load ordered spans for the selected trace.
- Show span input, output, error, metadata, parent span id, duration, status, start time, and cost when present.
- Keep trace and span queries lazy and scoped to the active project/environment.

Out of scope:

- Related Events, Errors, or LLM calls in the same timeline.
- Trace aggregate charts.
- Gantt-style visual timeline.
- Span tree indentation beyond showing `parentSpanId`.
- Trace or span status mutation.
- New storage tables.
- New ingestion endpoints.
- Cursor pagination UI.
- New database indexes unless implementation reveals an existing query bug.

## Recommended Approach

Use the same investigation pattern as Events and Errors, with one addition: selecting a trace loads its spans into the detail drawer.

This gives the console a real debugging chain without overbuilding. Events and Errors already expose `traceId`, so enabling Traces makes those identifiers useful while staying within existing query/storage contracts. A full cross-signal timeline is deferred because it needs broader UX and ordering semantics across events, errors, LLM calls, traces, and spans.

## Backend Contract

Use existing query routes:

```txt
GET /query/traces
GET /query/traces/:id/spans
```

`GET /query/traces` required filters:

- `project_id`
- `environment_id`

`GET /query/traces` optional filters:

- `tenant_id`
- `user_id`
- `session_id`
- `trace_id`
- `from`
- `to`
- `limit`

`GET /query/traces/:id/spans` required route/path and query scope:

- path `:id` is the selected trace id.
- `project_id`
- `environment_id`

Optional span query filters stay limited to existing shared scope/date filters. For this UI, the console should call the spans route with project/environment and selected trace id. It should not add span-specific filters.

Blank values should behave as omitted filters. Invalid dates keep the existing `400 invalid_query` behavior. Query dependency failures keep the existing `503 query_unavailable` behavior.

No new backend routes are required for this slice.

## Frontend Structure

The existing `InvestigationWorkspace` should enable the `Traces` tab and keep `LLM` disabled.

Recommended components:

- `InvestigationWorkspace`
  - Owns active investigation tab state.
  - Defaults to `Events`.
  - Renders `EventInvestigationPanel`, `ErrorInvestigationPanel`, or `TraceInvestigationPanel` only when the corresponding tab is active.
  - Keeps `LLM` disabled.
  - Shows the setup-required empty state when project or environment is missing.

- `TraceInvestigationPanel`
  - Owns trace query state, span query state, selected trace, filter application, reset, retry, and stale-response guards.
  - Defaults to latest 50 traces.
  - Does not query while the Traces tab is inactive.
  - Loads spans only after a trace is selected.
  - Clears selected trace and span state when project, environment, or applied filters change.

- `TraceFilters`
  - Controlled form for trace id, tenant, user, session, from, to, and limit.
  - Does not auto-query on each keystroke.
  - `Apply` runs the trace query.
  - `Reset` clears optional filters while preserving active project/environment.

- `TraceList`
  - Dense rows for raw trace records.
  - Shows trace name, status, duration, started time, user, tenant, and trace id.
  - Selecting a row sets the active trace.

- `TraceDetailDrawer`
  - Read-only detail drawer for the selected trace.
  - Shows trace identifiers, name, status, timestamps, duration, source, release, tenant/user/session ids, trace id, and metadata JSON.
  - Shows the selected trace's spans as an ordered list.

- `SpanTimeline`
  - Renders spans ordered by `startedAt`.
  - Shows span name, parent span id, status, duration, start time, cost, and JSON sections for input, output, error, and metadata.
  - Uses a dense ordered list, not a graphical Gantt chart.

## Data Types

Add or expose `TraceRecord` and `SpanRecord` types in the console API package matching the existing query response shapes.

`TraceRecord` fields:

- `id`
- `projectId`
- `environmentId`
- `tenantId`
- `userId`
- `sessionId`
- `traceId`
- `timestamp`
- `receivedAt`
- `source`
- `release`
- `metadata`
- `name`
- `status`
- `startedAt`
- `endedAt`
- `durationMs`

`SpanRecord` fields:

- `id`
- `projectId`
- `environmentId`
- `tenantId`
- `userId`
- `sessionId`
- `traceId`
- `timestamp`
- `receivedAt`
- `source`
- `release`
- `metadata`
- `parentSpanId`
- `name`
- `status`
- `startedAt`
- `endedAt`
- `durationMs`
- `input`
- `output`
- `error`
- `costUsd`

Console API methods:

- `listTraces(filters): Promise<QueryListResponse<TraceRecord>>`
- `listTraceSpans(traceId, filters): Promise<QueryListResponse<SpanRecord>>`

`listTraceSpans` should encode the selected trace id in the path and project/environment scope in the query string.

## UX Behavior

Investigation mode:

- Remains read-only.
- Requires an active project and environment.
- Keeps project and environment selection consistent with setup mode.
- Does not create, update, archive, or mutate telemetry records.

Traces view:

- Loads latest 50 traces by default when the Traces tab is opened.
- Does not query in the background while Events or Errors is active.
- Does not load spans until a trace is selected.
- Shows trace-list loading, empty, unavailable, and results states.
- Applies filters only when the operator clicks `Apply`.
- `Reset` clears optional filters and returns to latest 50 traces.
- Selecting a trace opens the detail drawer and loads spans for that trace.
- Switching project/environment or applying new trace filters clears the selected trace and span timeline.
- Stale trace responses must not overwrite newer trace state.
- Stale span responses must not overwrite the currently selected trace's spans.

Trace row priority:

1. Name should be the dominant scan target.
2. Status and duration should be visible without opening the drawer.
3. Started time should help operators orient recent executions.
4. User, tenant, and trace id should make correlation possible.

Span timeline priority:

1. Spans should be ordered by `startedAt` ascending.
2. Span name and status should be visible first.
3. Duration should be visible without expanding JSON fields.
4. Parent span id should be visible when present.
5. Input, output, error, and metadata should be readable as formatted JSON.

## Error Handling

Frontend:

- Missing project/environment: show the setup-required empty state.
- Trace query loading: show compact loading state in the Traces panel.
- Trace query failure: show `Traces unavailable` with a retry action.
- Empty trace result: show `No traces found` and keep filters visible.
- No selected trace: show `Select a trace to inspect its spans.`
- Span query loading: show `Loading spans`.
- Empty span result: show `No spans found for this trace.`
- Span query failure: show `Spans unavailable` with a retry action.
- Stale async responses after project/environment/filter/selection changes must not overwrite newer state.

Backend:

- Missing `project_id` or `environment_id` keeps existing `400 invalid_query` behavior.
- Invalid date filters keep existing `400 invalid_query` behavior.
- Conflicting trace id in `/query/traces/:id/spans` keeps existing `400 invalid_query` behavior.
- Query dependency failures keep existing `503 query_unavailable` behavior.

## Testing Plan

Backend and data:

- Existing `GET /query/traces` behavior remains unchanged.
- Existing `GET /query/traces/:id/spans` behavior remains unchanged.
- DB trace query continues to filter by project, environment, tenant, user, session, trace id, and date range.
- DB span query returns spans for the selected trace id and active project/environment.

Console API client:

- `listTraces` encodes trace filters.
- `listTraceSpans` encodes selected trace id in the path and project/environment in the query.
- `listTraceSpans` returns `QueryListResponse<SpanRecord>`.
- Existing Events and Errors client behavior remains unchanged.

Console UI:

- `InvestigationWorkspace` enables Traces and keeps Events default.
- LLM remains disabled.
- Traces does not query until the Traces tab is opened.
- Opening Traces loads latest 50 traces and does not load spans.
- Selecting a trace loads spans for that trace.
- Applying filters reloads traces and clears selected trace/spans.
- Reset clears optional filters and reloads latest traces.
- Trace list loading, empty, unavailable, and retry states render correctly.
- Span loading, empty, unavailable, and retry states render correctly.
- Trace detail drawer renders trace metadata and ordered spans.
- Stale trace responses are ignored.
- Stale span responses are ignored.
- Existing Events and Errors investigation tests still pass.

Full verification:

```sh
pnpm test
pnpm build
docker compose config --quiet
```

## Future Expansion

This slice leaves clean space for later work:

- Cross-signal timeline by `trace_id` including Events, Errors, and LLM calls.
- Graphical span waterfall or Gantt timeline.
- Span tree indentation and parent/child folding.
- Trace aggregate cards.
- Trace status mutation workflow.
- Deep links from Events and Errors into selected traces.
- Trace performance indexes if production data volume requires them.

Those features should not be added in this slice.

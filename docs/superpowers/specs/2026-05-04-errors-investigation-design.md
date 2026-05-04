# Phase 3 Errors Investigation Design

## Source

This design extends `PRD.md` v0.2 and the completed Phase 3 Events investigation workspace.

The goal is to add the second read-only investigation view: raw error occurrences. This slice should reuse the Events investigation pattern and avoid introducing grouping, mutation, or triage workflow semantics before those are explicitly designed.

## Product Boundary

In scope:

- Enable `Errors` inside the existing `Investigate` workspace.
- Keep `Events` as the default active investigation tab.
- Keep `Traces` and `LLM` visible but disabled.
- Show raw error occurrences, not grouped issues.
- Filter errors by project, environment, severity, status, fingerprint, tenant, user, session, trace, date range, and limit.
- Render a dense read-only error list.
- Selecting an error opens a read-only detail drawer.
- Add exact optional `severity`, `status`, and `fingerprint` filters to `GET /query/errors`.

Out of scope:

- Error status mutation.
- Grouping by fingerprint.
- Occurrence counts.
- Assignment or ownership.
- Charts or overview metrics.
- Cross-signal links.
- Free-text message search.
- New storage tables.
- Cursor pagination UI.
- Mutating investigation data from the console.

## Recommended Approach

Use the same list/detail drawer pattern as Events.

This keeps the console predictable: operators can switch from Events to Errors without learning a different workflow. It also keeps the first Errors slice close to existing storage and query capabilities. Grouping and status changes are deferred because they need clear semantics for occurrence aggregation, fingerprint behavior, and write permissions.

## Backend Contract

The existing query route remains the primary contract:

```txt
GET /query/errors
```

Existing required filters:

- `project_id`
- `environment_id`

Existing optional filters:

- `tenant_id`
- `user_id`
- `session_id`
- `trace_id`
- `from`
- `to`
- `limit`
- `cursor`

New optional exact filters:

- `severity`
- `status`
- `fingerprint`

Example:

```txt
/query/errors?project_id=prj_123&environment_id=env_123&severity=critical&status=open
```

Blank values should behave as omitted filters. Invalid dates keep the existing `400 invalid_query` behavior. Query dependency failures keep the existing `503 query_unavailable` behavior.

The new filters should apply only to error queries. They should not change Events, LLM calls, Traces, Trace spans, or aggregate routes.

## Frontend Structure

The existing `InvestigationWorkspace` should become a small tabbed workspace with enabled `Events` and `Errors` tabs.

Recommended components:

- `InvestigationWorkspace`
  - Owns active investigation tab state.
  - Defaults to `Events`.
  - Renders `EventInvestigationPanel` only when Events is active.
  - Renders `ErrorInvestigationPanel` only when Errors is active.
  - Keeps `Traces` and `LLM` disabled.
  - Shows the existing setup-required empty state when project or environment is missing.

- `ErrorInvestigationPanel`
  - Owns error query state, loading/error/empty states, selected error, filter application, reset, retry, and stale-response guard.
  - Defaults to latest 50 errors.
  - Does not query while the Errors tab is inactive.
  - Clears selected error and reloads when project or environment changes.

- `ErrorFilters`
  - Controlled form for severity, status, fingerprint, tenant, user, session, trace, from, to, and limit.
  - Does not auto-query on each keystroke.
  - `Apply` runs the query.
  - `Reset` clears optional filters while preserving active project/environment.

- `ErrorList`
  - Dense, scannable rows for raw error occurrences.
  - Shows severity, status, message, type or fingerprint, timestamp, user, tenant, and trace or session context.
  - Selecting a row sets the active error.

- `ErrorDetailDrawer`
  - Read-only detail drawer for the selected error.
  - Shows message, type, severity, status, ID, project/environment IDs, tenant/user/session/trace IDs, timestamps, source, release, fingerprint, stack, context, and metadata.
  - JSON fields should be formatted with stable indentation.

## Data Types

Add or expose an `ErrorRecord` type in the console API package matching the existing error query response shape:

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
- `message`
- `type`
- `severity`
- `stack`
- `status`
- `fingerprint`
- `context`

`listErrors` should return `QueryListResponse<ErrorRecord>`.

The console `QueryFilters` type should include optional `severity`, `status`, and `fingerprint`, encoded as same-name query parameters.

## UX Behavior

Investigation mode:

- Remains read-only.
- Requires an active project and environment.
- Keeps project and environment selection consistent with setup mode.
- Does not create, update, archive, or mutate telemetry records.

Errors view:

- Loads latest 50 errors by default when the Errors tab is opened.
- Does not query in the background while Events is active.
- Shows loading, empty, unavailable, and results states.
- Applies filters only when the operator clicks `Apply`.
- `Reset` clears optional filters and returns to latest 50 errors.
- Selecting a row opens the detail drawer.
- Switching project or environment clears the selected error and reloads.
- Long identifiers should use monospace styling and be selectable.

Error row priority:

1. Severity and status should be visible without opening the drawer.
2. Message should be the dominant scan target.
3. Type or fingerprint should help distinguish similar messages.
4. Trace or session context should be visible when present.

## Error Handling

Frontend:

- Missing project/environment: show the setup-required empty state.
- Query loading: show compact loading state in the Errors panel.
- Query failure: show `Errors unavailable` with a retry action.
- Empty result: show `No errors found` and keep filters visible.
- Stale async responses after project/environment/filter changes must not overwrite newer state.

Backend:

- Missing `project_id` or `environment_id` keeps existing `400 invalid_query` behavior.
- Invalid date filters keep existing `400 invalid_query` behavior.
- Query dependency failures keep existing `503 query_unavailable` behavior.
- `severity`, `status`, and `fingerprint` are optional and should not affect non-error query routes.

## Testing Plan

Backend and data:

- Query route parses `severity`, `status`, and `fingerprint` for error queries.
- DB error query applies exact filtering for severity, status, and fingerprint.
- Existing error query behavior remains unchanged when new filters are absent.
- New filters do not change Events, LLM, Traces, Trace spans, or aggregates.

Console API client:

- `listErrors` encodes `severity`, `status`, and `fingerprint`.
- `listErrors` returns `QueryListResponse<ErrorRecord>`.
- Existing query filters still encode correctly.

Console UI:

- `InvestigationWorkspace` switches between Events and Errors.
- Errors does not query until the Errors tab is opened.
- Errors loads latest 50 for the active project/environment.
- Typing filters does not auto-query.
- Applying filters calls `listErrors` with exact filter values.
- Reset clears optional filters and reloads latest errors.
- Empty and unavailable states render correctly.
- Selecting an error opens the detail drawer.
- Project/environment changes clear selection and guard stale responses.
- Existing Events investigation and Setup mode tests still pass.

Full verification:

```sh
pnpm test
pnpm build
docker compose config --quiet
```

## Future Expansion

This slice leaves clean space for later work:

- Grouped errors by fingerprint.
- Occurrence counts and first/last seen.
- Status mutation workflow.
- Assignment or ownership.
- Cross-links to traces, users, tenants, and sessions.
- Error aggregates and Overview dashboard cards.

Those features should not be added in this slice.

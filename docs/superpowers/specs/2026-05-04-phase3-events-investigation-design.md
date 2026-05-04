# Phase 3 Events Investigation Design

## Source

This design is based on `PRD.md` v0.2 and the completed self-hosted telemetry core, JavaScript SDK, and Integration Console.

Phase 3 begins the Operational Console. The first implementation slice is intentionally narrow: a read-only Events investigation workspace that establishes the layout, filter model, and detail drawer pattern for later Errors, Traces, and LLM views.

## Product Boundary

This slice adds investigation capability to the existing `apps/console` browser console.

In scope:

- Top-level console mode split between `Setup` and `Investigate`.
- `Setup` keeps the current project, environment, API key, snippets, connection check, and simple user administration workflow.
- `Investigate` starts with an `Events` view.
- Events can be filtered by project, environment, event name, tenant, user, session, trace, date range, and limit.
- Event results render in a dense read-only list.
- Selecting an event opens a read-only detail drawer with event properties, metadata, timestamps, source, release, and correlation identifiers.
- The backend adds one optional `event_name` filter to the existing `GET /query/events` route.

Out of scope:

- Error investigation UI.
- Trace timeline UI.
- LLM cost/token analytics.
- Overview dashboard KPIs.
- Error status changes, grouping, or triage workflow.
- Saved filters.
- Fuzzy or partial event-name search.
- Cursor pagination UI.
- Cross-signal unified timeline.
- New storage tables.
- Mutating investigation data from the console.

## Recommended Approach

Use a conservative read-only extension of the current console.

The existing setup workflow remains available but is moved behind a `Setup` mode. A new `Investigate` mode owns investigation tabs and starts with `Events`. Future `Errors`, `Traces`, and `LLM` tabs can be visible as disabled or placeholder navigation entries, but they must not imply fake functionality.

Event investigation should use the active project and environment from the existing console state. If no project or environment exists, the investigation workspace shows a compact empty state that tells the operator to finish setup first.

## Backend Contract

The existing query route remains the primary contract:

```txt
GET /query/events
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

New optional filter:

- `event_name`

Example:

```txt
/query/events?project_id=prj_123&environment_id=env_123&event_name=checkout.started
```

`event_name` should be an exact match in this slice.

Rationale:

- Event names are usually copied directly from application code or snippets.
- Exact matching is predictable for operators.
- Exact matching is easier to test and index later.
- Partial search can be added after real usage shows the right semantics.

Invalid or blank `event_name` should behave like the filter was omitted. The route should keep the existing authentication, validation, and unavailable-state behavior.

## Frontend Structure

The console should be reorganized into smaller focused components so `ConsoleShell` does not keep absorbing every feature.

Recommended components:

- `ConsoleModeTabs`
  - Switches between `Setup` and `Investigate`.
  - Uses simple tabs or segmented controls consistent with the current console style.

- `SetupWorkspace`
  - Wraps the current setup-oriented content.
  - Owns rendering of environment selection, API keys, snippets, connection check, and user administration.
  - Receives project/environment state and callbacks from `ConsoleShell`.

- `InvestigationWorkspace`
  - Receives active project, active environment, and API client.
  - Renders the investigation side navigation.
  - Starts with `Events` as the only enabled investigation view.
  - Shows a setup-required empty state if project or environment is missing.

- `EventInvestigationPanel`
  - Owns event query state, loading/error/empty states, selected event, and filter application.
  - Defaults to the latest 50 events.
  - Clears selected event and reloads when project or environment changes.

- `EventFilters`
  - Controlled filter form for event name, tenant, user, session, trace, from, to, and limit.
  - Does not auto-query on each keystroke.
  - `Apply` runs the query.
  - `Reset` clears optional filters while preserving active project/environment.

- `EventList`
  - Dense, scannable list/table of events.
  - Shows event name, timestamp, user, tenant, session or trace context where present.
  - Selecting a row sets the active event.

- `EventDetailDrawer`
  - Read-only detail drawer for the selected event.
  - Shows name, timestamp, received time, project/environment IDs, tenant/user/session/trace IDs, source, release, properties, and metadata.
  - JSON fields should be formatted with stable indentation.

## Data Types

The console API client should stop treating event query results as `unknown` for this view.

Add or expose an `EventRecord` type matching the current event query response shape:

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
- `properties`

`listEvents` should return `QueryListResponse<EventRecord>`.

The client `QueryFilters` type should include optional `eventName`, encoded as `event_name` in the query string.

## UX Behavior

Investigation mode:

- Is read-only.
- Requires an active project and environment.
- Keeps project and environment selection consistent with setup mode.
- Does not create, update, archive, or mutate telemetry records.

Events view:

- Loads latest 50 events by default.
- Shows loading, empty, unavailable, and results states.
- Does not query on every keystroke.
- Applies filters only when the operator clicks `Apply`.
- `Reset` clears optional filters and returns to latest 50 events.
- Selecting a row opens the detail drawer.
- Switching project or environment clears the selected event and reloads.
- Long identifiers should use monospace styling and be selectable.
- Copy buttons are deferred unless they are trivial and do not distract from the first slice.

## Error Handling

Frontend:

- Missing project/environment: show a setup-required empty state.
- Query loading: show a compact loading state in the Events panel.
- Query failure: show `Events unavailable` with a retry action.
- Empty result: show `No events found` and keep filters visible.
- Stale async responses after project/environment/filter changes must not overwrite newer state.

Backend:

- Missing `project_id` or `environment_id` keeps the existing `400 invalid_query` behavior.
- Invalid date filters keep the existing `400 invalid_query` behavior.
- Query dependency failures keep the existing `503 query_unavailable` behavior.
- `event_name` is optional and should not affect other query routes.

## Testing Plan

Backend and data:

- Query route parses `event_name` and passes it as `eventName`.
- DB event query applies exact event-name filtering.
- Existing event query behavior remains unchanged when `event_name` is absent.

Console API client:

- `listEvents` encodes `eventName` as `event_name`.
- Existing query filters still encode correctly.

Console UI:

- `ConsoleModeTabs` switches between Setup and Investigate without losing project/environment state.
- `InvestigationWorkspace` shows setup-required state when project/environment is missing.
- `EventInvestigationPanel` loads latest events for the active project/environment.
- Applying event-name filter calls `listEvents` with `eventName`.
- Reset clears optional filters and reloads latest events.
- Empty and unavailable states render correctly.
- Selecting an event opens the detail drawer.
- Project/environment changes clear selection and guard stale responses.
- Existing setup workflow tests still pass after extracting `SetupWorkspace`.

Full verification:

```sh
pnpm test
pnpm build
docker compose config --quiet
```

## Future Expansion

This slice establishes reusable investigation patterns for:

- Errors list/detail with severity, stack trace, status display, and affected users.
- Trace list/detail with span timeline.
- LLM list/detail with cost, token, model, prompt, and latency fields.
- Overview dashboard cards built from aggregate routes.
- Cross-signal links by trace, user, tenant, and session.

The first slice should not implement those features. It should make Events investigation useful and leave clean boundaries for subsequent Phase 3 work.

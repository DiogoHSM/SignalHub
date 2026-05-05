# Phase 3 LLM Investigation Design

## Source

This design extends `PRD.md` v0.2 and the completed Phase 3 Events, Errors, and Traces investigation workspaces.

The goal is to add the fourth read-only investigation view: LLM calls with cost, token, latency, status, prompt, model, and preview details. This slice should complete the raw signal investigation set before Overview dashboards or cross-signal user timelines.

## Product Boundary

In scope:

- Enable `LLM` inside the existing `Investigate` workspace.
- Keep `Events` as the default active investigation tab.
- Keep Events, Errors, and Traces behavior unchanged.
- Show raw LLM call records in a dense list.
- Show a compact aggregate strip for total calls, input tokens, output tokens, and total cost.
- Filter LLM calls by project, environment, tenant, user, session, trace id, provider, model, prompt name, status, date range, and limit.
- Apply filters only when the operator clicks `Apply`.
- Reset filters to latest 50 calls.
- Selecting an LLM call opens a read-only detail drawer.
- Show provider, model, prompt name, status, token counts, cost, latency, trace/session/user/tenant context, input preview, output preview, error text, and metadata JSON.
- Keep LLM calls and aggregate queries scoped to the active project/environment.

Out of scope:

- Charts.
- Cost by model, prompt, tenant, user, or project breakdown tables.
- Prompt grouping.
- Status mutation.
- Deep links from Traces to LLM calls.
- Cross-signal timeline.
- Cursor pagination UI.
- New storage tables.
- New ingestion endpoints.
- New database indexes unless implementation reveals an existing query bug.

## Recommended Approach

Use the same investigation pattern as Events, Errors, and Traces: tab-gated panel mounting, controlled filters, dense list, detail drawer, empty/unavailable/retry states, and stale-response guards.

Add one small difference: the LLM panel should load an aggregate strip alongside the raw list. This makes the view useful for cost and token inspection without becoming an Overview dashboard. The aggregate strip should use the existing `GET /query/aggregates/llm` route and the same applied filters as the list.

## Backend Contract

Use existing query routes:

```txt
GET /query/llm-calls
GET /query/aggregates/llm
```

Both routes require:

- `project_id`
- `environment_id`

Both routes should support shared optional filters:

- `tenant_id`
- `user_id`
- `session_id`
- `trace_id`
- `from`
- `to`
- `limit` for the list route only

Both routes should support LLM-specific exact filters:

- `provider`
- `model`
- `prompt_name`
- `status`

Blank values should behave as omitted filters. Invalid dates keep the existing `400 invalid_query` behavior. Query dependency failures keep the existing `503 query_unavailable` behavior.

No new backend routes are required for this slice.

## Frontend Structure

The existing `InvestigationWorkspace` should enable the `LLM` tab. Events remains the default active tab.

Recommended components:

- `InvestigationWorkspace`
  - Owns active investigation tab state.
  - Defaults to `Events`.
  - Renders `EventInvestigationPanel`, `ErrorInvestigationPanel`, `TraceInvestigationPanel`, or `LlmInvestigationPanel` only when the corresponding tab is active.
  - Shows the setup-required empty state when project or environment is missing.

- `LlmInvestigationPanel`
  - Owns LLM call query state, aggregate query state, selected call, filter application, reset, retry, and stale-response guards.
  - Defaults to latest 50 calls.
  - Does not query while the LLM tab is inactive.
  - Loads aggregate totals with the same applied filters as the list.
  - Clears selected call when project, environment, or applied filters change.

- `LlmFilters`
  - Controlled form for provider, model, prompt name, status, tenant, user, session, trace id, from, to, and limit.
  - Does not auto-query on each keystroke.
  - `Apply` runs list and aggregate queries.
  - `Reset` clears optional filters while preserving active project/environment.

- `LlmAggregateStrip`
  - Shows total calls, input tokens, output tokens, and total cost.
  - Has loading, unavailable, and retry states independent of the list.

- `LlmCallList`
  - Dense rows for raw LLM call records.
  - Shows provider/model, prompt name, status, cost, tokens, latency, timestamp, user, and tenant.
  - Selecting a row sets the active call.

- `LlmCallDetailDrawer`
  - Read-only detail drawer for the selected call.
  - Shows identifiers, provider, model, prompt name, status, tokens, cost, latency, trace/session/user/tenant ids, source, release, error text, input preview, output preview, and metadata JSON.

## Data Types

Add or expose `LlmCallRecord` and `LlmAggregates` types in the console API package matching the existing query response shapes.

`LlmCallRecord` fields:

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
- `provider`
- `model`
- `promptName`
- `inputTokens`
- `outputTokens`
- `costUsd`
- `latencyMs`
- `status`
- `error`
- `inputPreview`
- `outputPreview`

`LlmAggregates` fields:

- `totalCalls`
- `totalInputTokens`
- `totalOutputTokens`
- `totalCostUsd`

Console API methods:

- `listLlmCalls(filters): Promise<QueryListResponse<LlmCallRecord>>`
- `getLlmAggregates(filters): Promise<AggregateResponse<LlmAggregates>>`

## UX Behavior

Investigation mode:

- Remains read-only.
- Requires an active project and environment.
- Keeps project and environment selection consistent with setup mode.
- Does not create, update, archive, or mutate telemetry records.

LLM view:

- Loads latest 50 LLM calls by default when the LLM tab is opened.
- Loads aggregate totals when the LLM tab is opened.
- Does not query in the background while Events, Errors, or Traces is active.
- Shows list loading, empty, unavailable, and results states.
- Shows aggregate loading, unavailable, and ready states independently from the list.
- Applies filters only when the operator clicks `Apply`.
- `Reset` clears optional filters and returns to latest 50 calls.
- Selecting a call opens the detail drawer.
- Switching project/environment or applying new filters clears the selected call.
- Stale list responses must not overwrite newer list state.
- Stale aggregate responses must not overwrite newer aggregate state.

LLM row priority:

1. Provider/model should be the dominant scan target.
2. Prompt name and status should be visible without opening the drawer.
3. Cost, token count, and latency should be visible without opening the drawer.
4. Timestamp should help operators orient recent calls.
5. User and tenant should make correlation possible.

Detail drawer priority:

1. Provider, model, prompt name, and status should be visible first.
2. Token counts, cost, and latency should be visible without parsing JSON.
3. Trace/session/user/tenant ids should support correlation.
4. Error, input preview, output preview, and metadata should remain readable as text/JSON.

## Error Handling

Frontend:

- Missing project/environment: show the setup-required empty state.
- LLM list loading: show compact loading state in the LLM panel.
- LLM list failure: show `LLM calls unavailable` with a retry action.
- Empty LLM list result: show `No LLM calls found` and keep filters visible.
- No selected call: show `Select an LLM call to inspect its details.`
- Aggregate loading: show compact loading placeholders in the aggregate strip.
- Aggregate failure: show `LLM totals unavailable` with a retry action.
- Stale async responses after project/environment/filter changes must not overwrite newer state.

Backend:

- Missing `project_id` or `environment_id` keeps existing `400 invalid_query` behavior.
- Invalid date filters keep existing `400 invalid_query` behavior.
- Query dependency failures keep existing `503 query_unavailable` behavior.
- LLM-specific filters are exact matches.

## Testing Plan

Backend and data:

- `GET /query/llm-calls` forwards `provider`, `model`, `prompt_name`, and `status`.
- `GET /query/aggregates/llm` forwards `provider`, `model`, `prompt_name`, and `status`.
- DB LLM list query filters by project, environment, tenant, user, session, trace id, provider, model, prompt name, status, and date range.
- DB LLM aggregate query uses the same supported LLM filters, excluding list-only `limit`.
- LLM-specific filters do not affect Events, Errors, Traces, Trace spans, or unrelated aggregate routes.

Console API client:

- `listLlmCalls` encodes shared and LLM-specific filters.
- `getLlmAggregates` encodes shared and LLM-specific filters.
- Existing Events, Errors, and Traces client behavior remains unchanged.

Console UI:

- `InvestigationWorkspace` enables LLM and keeps Events default.
- LLM does not query until the LLM tab is opened.
- Opening LLM loads latest 50 calls and aggregate totals.
- Applying filters reloads calls and aggregate totals and clears selected call.
- Reset clears optional filters and reloads latest calls and aggregate totals.
- LLM list loading, empty, unavailable, and retry states render correctly.
- LLM aggregate loading, unavailable, and retry states render correctly.
- LLM detail drawer renders call metadata, previews, cost, tokens, latency, status, and identifiers.
- Stale LLM list responses are ignored.
- Stale LLM aggregate responses are ignored.
- Existing Events, Errors, Traces, and Setup tests still pass.

Full verification:

```sh
pnpm test
pnpm build
docker compose config --quiet
```

## Future Expansion

This slice leaves clean space for later work:

- Overview dashboard cards for AI cost today, calls today, tokens, and latency.
- Cost by model, prompt, tenant, user, and project breakdown tables.
- Prompt grouping and prompt-level performance comparisons.
- Deep links from Traces into selected LLM calls.
- Cross-signal timeline by `trace_id`.
- LLM alert rules for cost, failure rate, and latency.
- LLM filter indexes if production data volume requires them.

Those features should not be added in this slice.

# Phase 3 Entities Investigation Design

## Summary

Add a read-only `Entities` investigation tab focused on tenants. This view helps operators answer which tenant is impacted, what happened recently, which users were involved, how much AI cost was generated, and which existing raw investigation view should be opened next.

This design extends the completed Phase 3 Overview, Events, Errors, Traces, and LLM investigation workspaces. It uses existing telemetry tables only and keeps SignalHub self-hosted, project/environment scoped, and read-only.

## Goals

- Add a combined `Entities` investigation view with tenants as the primary path.
- Rank tenant rows by a deterministic impact score by default.
- Show tenant summaries for usage, errors, traces, LLM calls, LLM cost, active users, active sessions, and last activity.
- Show a tenant detail timeline across events, errors, traces, and LLM calls.
- Let operators filter the selected tenant timeline by user and signal type.
- Preserve existing investigation ergonomics: explicit Apply, retry states, stale response protection, and exact-filter drilldowns.
- Keep `Unassigned` tenant activity visible when `tenantId` is null.

## Non-Goals

- User-first investigation screen.
- Saved entities, cohorts, segments, or audiences.
- Custom date ranges.
- Null-tenant detail drilldown.
- Raw spans in the entity timeline.
- Mutation workflows, notes, alert rules, or status changes.
- New storage tables, rollups, or materialized views.
- SaaS workspace, organization, or per-project permission changes.

## Position in the Console

`Entities` is a peer tab inside `Investigate`:

```txt
Events | Errors | Traces | LLM | Entities
```

The tab loads only while active. It remains scoped to the selected project and environment from the console shell.

## Windows

Entities uses the same fixed windows as Overview:

- `24h`
- `7d`
- `30d`

The default window is `7d`, because entity investigation usually needs more context than the Overview default. Window boundaries must be computed in UTC and tested for non-UTC runtime time zones.

## Layout

The approved layout is `Tenant List + Detail Timeline`.

Left side:

- Tenant list.
- Window selector.
- Search input for tenant id or user id.
- Sort controls.
- Disabled `Unassigned` row when present.

Right side:

- Empty state before tenant selection.
- Tenant summary cards after selection.
- Top users for selected tenant.
- Timeline filters.
- Cross-signal timeline.

## Tenant List

Each tenant row should include:

- Label: tenant id or `Unassigned`.
- Impact score.
- Last seen timestamp.
- Events.
- Errors.
- Failed traces.
- LLM calls.
- LLM cost.
- Active users.

Rows should be selectable except `Unassigned`. `Unassigned` is visible to surface instrumentation gaps and account for activity with missing tenant context, but detail selection is disabled in v1 because the query contract does not include null-tenant filters.

## Default Ranking

The default sort is impact score.

Impact score is deterministic and intentionally simple:

```txt
impactScore =
  severeErrors * 15
  + openErrors * 8
  + errors * 5
  + failedTraces * 4
  + failedLlmCalls * 4
  + min(llmCostUsd, 100) * 0.25
```

Tie-breakers:

1. More recent `lastSeenAt`.
2. Higher event count.
3. Label ascending.

The UI may also expose sort buttons for:

- Impact.
- Usage.
- Errors.
- LLM cost.
- Recent.

These are view-level sorts over the returned tenant list. The API can accept a sort parameter later, but v1 does not require server-side sort beyond impact ranking.

## API

Add two read-only human-session query endpoints.

### `GET /query/entities/tenants`

Required query params:

- `project_id`
- `environment_id`

Optional query params:

- `window`, default `7d`, one of `24h`, `7d`, `30d`
- `search`
- `limit`, default `50`, max `100`

Response:

```ts
type EntityWindow = "24h" | "7d" | "30d";

type TenantSummary = {
  tenantId: string | null;
  label: string;
  isUnassigned: boolean;
  impactScore: number;
  lastSeenAt: string | null;
  events: number;
  errors: number;
  openErrors: number;
  severeErrors: number;
  traces: number;
  failedTraces: number;
  llmCalls: number;
  failedLlmCalls: number;
  llmCostUsd: string;
  activeUsers: number;
  activeSessions: number;
};

type TenantListResponse = {
  window: EntityWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  tenants: TenantSummary[];
};
```

Search applies to `tenant_id` and `user_id` across events, errors, traces, and LLM calls. Search uses safe parameterized substring matching with `ilike` and trims leading/trailing whitespace. Empty search is ignored.

### `GET /query/entities/tenants/:tenantKey`

Required query params:

- `project_id`
- `environment_id`

Optional query params:

- `window`, default `7d`, one of `24h`, `7d`, `30d`
- `user_id`
- `signal_type`, one of `event`, `error`, `trace`, `llm`
- `limit`, default `50`, max `100`
- `cursor`

Path parameter:

- `tenantKey`: URL-safe tenant id.
- `_unassigned` is reserved and returns `400` in v1.

Response:

```ts
type EntitySignalType = "event" | "error" | "trace" | "llm";

type TenantTopUser = {
  userId: string;
  events: number;
  errors: number;
  traces: number;
  llmCalls: number;
  llmCostUsd: string;
  lastSeenAt: string;
};

type TenantTimelineRow =
  | {
      type: "event";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      eventName: string;
    }
  | {
      type: "error";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      severity: string;
      status: string;
      message: string;
    }
  | {
      type: "trace";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      status: string;
      durationMs: number | null;
      name: string;
    }
  | {
      type: "llm";
      id: string;
      timestamp: string;
      label: string;
      userId: string | null;
      sessionId: string | null;
      traceId: string | null;
      provider: string;
      model: string;
      promptName: string | null;
      status: string;
      costUsd: string;
    };

type TenantDetailResponse = {
  window: EntityWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  tenant: TenantSummary;
  topUsers: TenantTopUser[];
  timeline: TenantTimelineRow[];
  cursor?: string;
};
```

Timeline ordering is newest first. Cursor pagination is required for v1 because tenant timelines can grow quickly. The cursor is an opaque base64url JSON payload containing the last row's `timestamp`, `type`, and `id`. The repository must order rows by `timestamp desc`, then `type asc`, then `id asc`, and use the cursor to fetch rows strictly after the last returned row in that ordering. Invalid cursors return `400`.

## Timeline Semantics

Included signal types:

- Events.
- Errors.
- Traces.
- LLM calls.

Excluded:

- Spans.

Rationale: spans are step-level trace detail and become noisy in an entity timeline. Trace rows can drill into the existing Traces tab, where spans already load lazily after trace selection.

Timeline labels:

- Event: event name.
- Error: message.
- Trace: trace name.
- LLM: `provider / model`, with prompt and cost in metadata.

## Drilldowns

Timeline drilldowns seed existing investigation filters:

- Event row -> Events with `tenantId` and `eventName`; include `traceId` when present.
- Error row -> Errors with `tenantId`, `severity`, `status`; include `traceId` when present.
- Trace row -> Traces with `tenantId` and `traceId`.
- LLM row -> LLM with `tenantId`, `provider`, `model`, `status`; include `promptName` when present and not `Unspecified`.

Overview tenant top rows should open Entities detail for assigned tenants:

- Tenant usage -> Entities selected tenant.
- Tenant errors -> Entities selected tenant.
- Tenant LLM calls/cost -> Entities selected tenant.

`Unassigned` tenant rows do not drill down in v1.

## UI States

Tenant list:

- Loading with shape-preserving placeholders.
- Empty when no tenant or unassigned activity exists in the selected window.
- Unavailable with retry.
- Stale responses ignored when project, environment, window, or search changes.

Tenant detail:

- Empty prompt before selection.
- Loading with summary/timeline placeholders.
- Unavailable with retry.
- Empty timeline when selected tenant has no matching rows after detail filters.
- Detail resets when project/environment changes.

Filters:

- Search applies to tenant list.
- User id and signal type apply to selected tenant timeline.
- User id filter applies only after `Apply`, consistent with existing investigation panels.

## Repository Design

Prefer a focused repository module:

```txt
packages/db/src/repositories/entities-query.ts
```

This avoids growing `telemetry-query.ts`, which already owns broad raw query and overview aggregate behavior. The new module should share small local helpers for:

- Window parsing.
- UTC range calculation.
- Numeric string normalization for costs.
- Tenant id labeling.
- Timeline row mapping.

The repository should use existing typed telemetry tables only. No migrations are required for the first slice unless final verification shows unacceptable query behavior on realistic test volume.

## Safety and Privacy

- Do not expose event properties, error context, LLM previews, or span input/output in the Entities timeline.
- Timeline rows show identifiers and concise labels only.
- Existing detail drawers remain the place for deeper raw payload inspection.
- No new secrets, roles, or project permissions.

## Testing Requirements

Backend route tests:

- Defaults to `7d`.
- Accepts `24h`, `7d`, `30d`.
- Rejects invalid windows.
- Rejects `_unassigned` detail path.
- Parses `user_id`, `signal_type`, `limit`, and valid cursor.
- Rejects invalid cursor.

DB repository tests:

- Tenant summaries aggregate across events, errors, traces, and LLM calls.
- Impact score orders tenants deterministically.
- Severe errors include `error`, `critical`, and `fatal`.
- `Unassigned` appears when tenant id is null.
- `Unassigned` is not returned as selectable detail data.
- Window scoping excludes old rows.
- Search can find by tenant id and user id.
- Timeline orders mixed signal rows newest first.
- Timeline excludes spans.
- Timeline filters by user id and signal type.
- LLM cost is returned as a stable decimal string.

Console client tests:

- Encodes tenant list query params.
- Encodes tenant detail query params.
- Does not encode unsupported filters.

UI tests:

- Entities tab loads only when active.
- Default window is `7d`.
- Tenant list renders impact-ranked rows.
- Selecting tenant loads summary, top users, and timeline.
- `Unassigned` row is visible but disabled.
- User filter applies only after Apply.
- Signal type filter updates timeline.
- Retry works for list and detail failures.
- Stale list/detail responses do not override current state.
- Timeline drilldowns switch to existing tabs with correct filters.
- Overview tenant rows open Entities for assigned tenants.

## Acceptance Criteria

- Operators can open `Investigate -> Entities` and see impact-ranked tenants for the selected project/environment.
- Operators can select a tenant and inspect summary, top users, and cross-signal timeline for the selected window.
- Timeline includes events, errors, traces, and LLM calls, and excludes spans.
- `Unassigned` tenant activity is visible but not selectable.
- Drilldowns move from Entities into existing raw investigation tabs with seeded filters.
- Final verification passes `pnpm test`, `pnpm build`, and `docker compose config --quiet`.

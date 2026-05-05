# Phase 3 Users Investigation Design

## Summary

Add a read-only `Users` investigation tab focused on user impact and recent activity. This view helps operators answer which user was affected, what happened around that user, which tenant and sessions were involved, how much AI cost was generated, and which raw investigation view should be opened next.

This design extends the completed Phase 3 Overview, Events, Errors, Traces, LLM, and Entities investigation workspaces. It uses existing telemetry tables only and keeps SignalHub self-hosted, project/environment scoped, and read-only.

## Goals

- Add a user-first investigation view as a peer tab inside `Investigate`.
- Rank user rows by a deterministic impact score by default.
- Show user summaries for usage, errors, traces, LLM calls, LLM cost, active tenants, active sessions, and last activity.
- Show recent sessions for a selected user.
- Show a selected user timeline across events, errors, traces, and LLM calls.
- Let operators filter the user list by tenant and search by user, tenant, or session.
- Let operators filter the selected user timeline by tenant and signal type.
- Preserve existing investigation ergonomics: explicit Apply for text filters, retry states, stale response protection, cursor pagination, and exact-filter drilldowns.
- Keep anonymous user activity visible when `userId` is null.

## Non-Goals

- Persistent user profile storage.
- User properties from `identify()`.
- Saved cohorts, segments, or audiences.
- Separate Sessions investigation tab.
- Session replay.
- Custom date ranges.
- Anonymous-user detail drilldown.
- Raw spans in the user timeline.
- Mutation workflows, notes, alert rules, status changes, or profile edits.
- New storage tables, rollups, or materialized views.
- SaaS workspace, organization, or per-project permission changes.

## Position in the Console

`Users` is a peer tab inside `Investigate`:

```txt
Events | Errors | Traces | LLM | Entities | Users
```

The tab loads only while active. It remains scoped to the selected project and environment from the console shell.

## Windows

Users uses the same fixed windows as Overview and Entities:

- `24h`
- `7d`
- `30d`

The default window is `7d`, because user investigation usually needs enough context to connect events, failures, sessions, traces, and AI cost. Window boundaries must be computed in UTC and tested for non-UTC runtime time zones.

## Layout

The approved layout is `User List + Detail Timeline`.

Left side:

- User list.
- Window selector.
- Search input for user id, tenant id, or session id.
- Tenant filter input.
- Sort controls.
- Disabled `Anonymous / Unassigned` row when present.

Right side:

- Empty state before user selection.
- User summary cards after selection.
- Recent sessions for selected user.
- Timeline filters.
- Cross-signal timeline.
- Load more control when the detail response includes a cursor.

## User List

Each user row should include:

- Label: user id or `Anonymous / Unassigned`.
- Impact score.
- Last seen timestamp.
- Events.
- Errors.
- Failed traces.
- LLM calls.
- LLM cost.
- Active tenants.
- Active sessions.

Rows should be selectable except `Anonymous / Unassigned`. Anonymous activity is visible to surface instrumentation gaps and account for activity with missing user context, but detail selection is disabled in v1 because the query contract does not include null-user filters.

## Default Ranking

The default sort is impact score.

Impact score is deterministic and intentionally aligned with Entities:

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

These are view-level sorts over the returned user list. The API can accept a sort parameter later, but v1 does not require server-side sort beyond impact ranking.

## API

Add two read-only human-session query endpoints.

### `GET /query/users`

Required query params:

- `project_id`
- `environment_id`

Optional query params:

- `window`, default `7d`, one of `24h`, `7d`, `30d`
- `search`
- `tenant_id`
- `limit`, default `50`, max `100`

Response:

```ts
type UserWindow = "24h" | "7d" | "30d";

type UserSummary = {
  userId: string | null;
  label: string;
  isAnonymous: boolean;
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
  activeTenants: number;
  activeSessions: number;
};

type UserListResponse = {
  window: UserWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  users: UserSummary[];
};
```

Search applies to `user_id`, `tenant_id`, and `session_id` across events, errors, traces, and LLM calls. Search uses safe parameterized substring matching with `ilike` and trims leading/trailing whitespace. Empty search is ignored.

The optional `tenant_id` filter restricts the user list to activity inside that tenant. It is exact-match, trimmed, and ignored when empty.

### `GET /query/users/:userKey`

Required query params:

- `project_id`
- `environment_id`

Optional query params:

- `window`, default `7d`, one of `24h`, `7d`, `30d`
- `tenant_id`
- `signal_type`, one of `event`, `error`, `trace`, `llm`
- `limit`, default `50`, max `100`
- `cursor`

Path parameter:

- `userKey`: URL-safe user id.
- `_anonymous` is reserved and returns `400` in v1.

Response:

```ts
type UserSignalType = "event" | "error" | "trace" | "llm";

type UserRecentSession = {
  sessionId: string;
  tenantId: string | null;
  events: number;
  errors: number;
  traces: number;
  llmCalls: number;
  llmCostUsd: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

type UserTimelineRow =
  | {
      type: "event";
      id: string;
      timestamp: string;
      label: string;
      tenantId: string | null;
      sessionId: string | null;
      traceId: string | null;
      eventName: string;
    }
  | {
      type: "error";
      id: string;
      timestamp: string;
      label: string;
      tenantId: string | null;
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
      tenantId: string | null;
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
      tenantId: string | null;
      sessionId: string | null;
      traceId: string | null;
      provider: string;
      model: string;
      promptName: string | null;
      status: string;
      costUsd: string;
    };

type UserDetailResponse = {
  window: UserWindow;
  generatedAt: string;
  scope: {
    projectId: string;
    environmentId: string;
  };
  range: {
    from: string;
    to: string;
  };
  user: UserSummary;
  recentSessions: UserRecentSession[];
  timeline: UserTimelineRow[];
  cursor?: string;
};
```

Timeline ordering is newest first. Cursor pagination is required for v1 because active users can generate long timelines. The cursor is an opaque base64url JSON payload containing the last row's `timestamp`, `type`, and `id`. The repository must order rows by `timestamp desc`, then `type asc`, then `id asc`, and use the cursor to fetch rows strictly after the last returned row in that ordering. Invalid cursors return `400`.

## Timeline Semantics

Included signal types:

- Events.
- Errors.
- Traces.
- LLM calls.

Excluded:

- Spans.

Rationale: spans are step-level trace detail and become noisy in a user timeline. Trace rows can drill into the existing Traces tab, where spans already load lazily after trace selection.

Timeline labels:

- Event: event name.
- Error: message.
- Trace: trace name.
- LLM: `provider / model`, with prompt and cost in concise row text.

Timeline rows must not expose event properties, error context, stack traces, LLM previews, raw metadata, or span input/output. Existing detail drawers remain the place for deeper raw payload inspection after a drilldown.

## Recent Sessions

Selected user detail includes recent sessions above the timeline.

Recent session rows are derived from non-null `session_id` values across events, errors, traces, and LLM calls for the selected user, project, environment, window, and optional tenant filter. Rows should be sorted by `lastSeenAt desc`, then total signal count desc, then `sessionId asc`, and limited to 10 sessions.

Each row shows:

- Session id.
- Tenant id when present.
- Events.
- Errors.
- Traces.
- LLM calls.
- LLM cost.
- First seen.
- Last seen.

This is intentionally not a separate Sessions investigation tab. It gives enough context to understand user activity without expanding scope.

## Drilldowns

Timeline drilldowns seed existing investigation filters:

- Event row -> Events with `userId` and `eventName`; include `tenantId`, `sessionId`, and `traceId` when present.
- Error row -> Errors with `userId`, `severity`, and `status`; include `tenantId`, `sessionId`, and `traceId` when present.
- Trace row -> Traces with `userId`; include `tenantId`, `sessionId`, and `traceId` when present.
- LLM row -> LLM with `userId`, `provider`, `model`, and `status`; include `promptName` when present and not `Unspecified`; include `tenantId`, `sessionId`, and `traceId` when present.

`Anonymous / Unassigned` user rows do not drill down in v1.

## UI States

User list:

- Loading with shape-preserving placeholders.
- Empty when no user or anonymous activity exists in the selected window.
- Unavailable with retry.
- Stale responses ignored when project, environment, window, search, or tenant filter changes.

User detail:

- Empty prompt before selection.
- Loading with summary/timeline placeholders.
- Unavailable with retry.
- Empty recent sessions when selected user has no non-null sessions in the current filters.
- Empty timeline when selected user has no matching rows after detail filters.
- Load more control when `cursor` exists.
- Load more unavailable state with retry by clicking Load more again after a failed page fetch.
- Detail resets when project/environment changes.

Filters:

- Search and tenant filter apply to the user list.
- Tenant and signal type apply to selected user detail.
- Search and tenant text inputs apply only after `Apply`, consistent with existing investigation panels.
- Signal type changes immediately.

## Repository Design

Prefer a focused repository module:

```txt
packages/db/src/repositories/users-query.ts
```

This avoids growing `telemetry-query.ts` and keeps the user-first aggregate logic separate from tenant-first entity queries. The module can mirror the proven `entities-query.ts` shape while using user-centric naming and active tenant counts.

The repository should use existing typed telemetry tables only. No migrations are required for this slice.

## Safety and Privacy

- Project and environment scope are mandatory on all routes.
- All query filters use parameterized SQL.
- Do not expose event properties, error context, stack traces, LLM previews, raw metadata, or span input/output in the Users timeline.
- Timeline rows show identifiers and concise labels only.
- Existing raw detail drawers remain the place for deeper payload inspection.
- Anonymous user activity is visible but not selectable.
- No new secrets, roles, or project permissions.
- No persistent user profile storage in this slice.

## Testing Requirements

Backend route tests:

- Defaults to `7d`.
- Accepts `24h`, `7d`, `30d`.
- Rejects invalid windows.
- Rejects `_anonymous` detail path.
- Parses `tenant_id`, `signal_type`, `limit`, and valid cursor.
- Rejects invalid cursor.
- Trims empty search and tenant filters.
- Returns `501` when the repository dependency is missing.
- Returns `503` when the repository throws.

DB repository tests:

- User summaries aggregate across events, errors, traces, and LLM calls.
- Impact score orders users deterministically.
- Severe errors include `error`, `critical`, and `fatal`.
- `Anonymous / Unassigned` appears when user id is null.
- `Anonymous / Unassigned` is not returned as selectable detail data.
- Window scoping excludes old rows.
- Search can find by user id, tenant id, and session id.
- Tenant filter restricts list and detail data.
- Recent sessions aggregate only non-null sessions for the selected user.
- Timeline orders mixed signal rows newest first.
- Timeline excludes spans.
- Timeline filters by tenant id and signal type.
- Timeline cursor uses `timestamp`, `type`, and `id` with the required ordering.
- LLM cost is returned as a stable decimal string.

Console client tests:

- Encodes user list query params.
- Encodes user detail query params.
- Encodes user ids as path segments.
- Does not encode unsupported filters.

UI tests:

- Users tab loads only when active.
- Default window is `7d`.
- User list renders impact-ranked rows.
- User rows include required summary metrics.
- `Anonymous / Unassigned` row is visible but disabled.
- Search and tenant list filters apply only after Apply.
- Selecting user loads summary, recent sessions, and timeline.
- Detail tenant filter applies only after Apply.
- Signal type filter updates timeline immediately.
- Retry works for list and detail failures.
- Load more consumes `cursor` and appends timeline rows.
- Stale list/detail/page responses do not override current state.
- Timeline drilldowns switch to existing tabs with correct filters.
- Responsive desktop and mobile visual checks show no horizontal overflow.

## Acceptance Criteria

- Operators can open `Investigate -> Users` and see impact-ranked users for the selected project/environment.
- Operators can filter the user list by search and tenant.
- Operators can select an assigned user and inspect summary, recent sessions, and cross-signal timeline for the selected window.
- Timeline includes events, errors, traces, and LLM calls, and excludes spans.
- `Anonymous / Unassigned` user activity is visible but not selectable.
- Drilldowns move from Users into existing raw investigation tabs with seeded filters.
- Final verification passes `pnpm test`, `pnpm build`, `docker compose config --quiet`, and a desktop/mobile visual check.

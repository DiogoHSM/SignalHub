# Phase 5A Error Groups and Status Workflow Design

## Summary

Add the first post-MVP investigation upgrade for SignalHub: grouped error issues with an operator status workflow.

Today the Errors investigation view is a raw occurrence list. That is useful for audit and debugging, but it does not answer the operational question well: "What issue should I work on first, how many users are affected, and did this come back after being resolved?" Phase 5A adds an `error_groups` layer over immutable raw `errors`, making Errors useful for triage without turning SignalHub into a full incident-management system.

The default Errors experience becomes grouped issues, while raw occurrences stay available in a peer tab and through drilldowns.

## Goals

- Group similar raw error occurrences into operational error groups.
- Preserve raw error occurrences as immutable telemetry records.
- Add a mutable group status workflow: `open`, `investigating`, `resolved`, `ignored`.
- Reopen resolved groups when a new matching occurrence arrives and mark the group as regressed.
- Keep ignored groups ignored when new matching occurrences arrive.
- Make grouped errors the default Errors console experience.
- Keep the existing raw occurrence list/detail workflow available.
- Provide query APIs for group list, group detail, group occurrences, and group status updates.
- Keep the first grouping algorithm deterministic and explainable.

## Non-Goals

- AI or semantic error grouping.
- Source map upload or minified stack trace translation.
- Issue assignment, comments, labels, owners, or SLA workflow.
- Notifications triggered by group status changes.
- Incident management, escalation, or acknowledgement workflows.
- Rewriting raw error occurrence status when a group status changes.
- Deleting or mutating raw error occurrences.
- Grouping logs, traces, LLM calls, alerts, or future signals into a generic issue model.
- Cross-environment grouping.

## Approach Options

### Recommended: Worker-Maintained Error Groups

Add an `error_groups` table and attach each raw `errors` row to a group during persistence. The worker or existing telemetry write path computes a deterministic grouping fingerprint, upserts the matching group, updates counts and lifecycle fields, then stores `error_group_id` and `grouping_fingerprint` on the raw error occurrence.

This is the best fit because SignalHub already persists telemetry through a worker-owned path and the console needs fast, status-aware group queries.

### Alternative: Query-Time Grouping Only

Aggregate raw `errors` on demand by fingerprint or normalized error shape. This avoids a new table initially, but it is a poor fit for mutable workflow state, regression detection, and efficient triage queries.

### Alternative: Generic Issues Engine

Introduce a broader issue model for errors, traces, alerts, logs, and future signals. This is useful long term, but it is too broad for Phase 5A and risks delaying the practical error triage upgrade.

## Data Model

Add a new `error_groups` table:

```txt
id
project_id
environment_id
grouping_fingerprint
message
type
top_stack_frame
severity
status
first_seen_at
last_seen_at
last_regressed_at
occurrence_count
affected_users_count
affected_tenants_count
latest_error_id
created_at
updated_at
resolved_at
ignored_at
```

Add columns to `errors`:

```txt
error_group_id
grouping_fingerprint
```

Constraints and indexes:

- `error_groups(project_id, environment_id, grouping_fingerprint)` is unique.
- `errors(error_group_id, timestamp desc)` supports group occurrence drilldowns.
- group list indexes should support project/environment plus status, severity, and latest-seen ordering.

Raw `errors.status` remains an occurrence field. It is not the operator workflow state for a group.

## Grouping Algorithm

Group scope is `project_id + environment_id`.

Fingerprint selection:

1. If the payload includes `fingerprint`, use that explicit value.
2. Otherwise compute a deterministic fingerprint from normalized `type + message + top stack frame`.

Normalization:

- trim whitespace,
- lowercase where appropriate,
- collapse repeated whitespace,
- remove obvious volatile values from the message where safe, such as UUID-like values and long numeric IDs,
- derive top stack frame from the first meaningful stack frame line,
- hash the normalized grouping source into a stable compact fingerprint.

The group stores both the compact `grouping_fingerprint` and representative fields such as message, type, top stack frame, severity, and latest error id.

The first version does not attempt semantic similarity, stack-frame family trees, source-map-aware grouping, or cross-release inference beyond exact matching.

## Lifecycle

When a new error occurrence is persisted:

1. Compute or select `grouping_fingerprint`.
2. Find or create the matching group for the same project and environment.
3. Attach the raw error to `error_group_id`.
4. Update group summary fields:
   - `last_seen_at`
   - `latest_error_id`
   - `occurrence_count`
   - `affected_users_count`
   - `affected_tenants_count`
   - representative severity if the new severity is more severe
5. If the group is `resolved`, change status to `open` and set `last_regressed_at`.
6. If the group is `ignored`, keep status as `ignored`.

Status updates are operator actions on the group only:

- `open`: active issue.
- `investigating`: someone is looking at it.
- `resolved`: believed fixed; future matching occurrence reopens it.
- `ignored`: intentionally suppressed from active triage; future matching occurrence does not reopen it.

Status timestamp behavior:

- setting `resolved` writes `resolved_at`.
- setting `ignored` writes `ignored_at`.
- moving away from `resolved` clears `resolved_at`.
- moving away from `ignored` clears `ignored_at`.
- reopening a resolved group writes `last_regressed_at` and clears `resolved_at`.

## Backfill

Existing raw errors need groups.

Add an idempotent repository-level backfill that:

1. finds errors without `error_group_id`,
2. computes the same grouping fingerprint,
3. creates or updates groups,
4. writes `error_group_id` and `grouping_fingerprint` to the raw error rows,
5. recomputes counts from raw errors for affected users, affected tenants, occurrence count, first seen, last seen, and latest error.

The worker runs the backfill as a bounded startup helper before processing telemetry jobs. The helper is idempotent and safe to rerun.

## API

Add grouped error APIs alongside the current raw occurrence API.

### `GET /query/error-groups`

Filters:

```txt
project_id
environment_id
status
severity
fingerprint
tenant_id
user_id
release
from
to
limit
```

Default ordering:

1. regressed open groups,
2. critical or error severity,
3. open and investigating groups,
4. latest seen descending.

The response returns group rows with summary metrics and lifecycle fields.

### `GET /query/error-groups/:id`

Returns:

- group summary,
- lifecycle fields,
- latest occurrence,
- recent occurrence samples,
- affected users summary,
- affected tenants summary,
- release breakdown.

The route is scoped by `project_id` and `environment_id` query parameters, matching existing query route patterns.

### `GET /query/error-groups/:id/errors`

Returns raw error occurrences for a group using the existing raw error row shape.

Supports:

```txt
project_id
environment_id
from
to
limit
```

### `PATCH /query/error-groups/:id`

Body:

```json
{ "status": "open" }
```

Accepted statuses:

```txt
open
investigating
resolved
ignored
```

This route requires a logged-in user. It does not require admin privileges because the current product intentionally has simple access control and logged-in users can already investigate telemetry.

The mutation updates only group workflow fields and never rewrites raw `errors`.

### Existing Raw Error Route

Keep `GET /query/errors` as raw occurrence search.

Add optional `error_group_id` filtering so the grouped detail view can drill into matching raw occurrences without introducing a separate raw shape.

## Console UX

Use `Groups + Raw occurrences` inside `Investigate -> Errors`.

Default tab: `Groups`.

Group rows prioritize:

- severity,
- status,
- message and type,
- occurrence count,
- affected users count,
- affected tenants count,
- first seen,
- last seen,
- regression marker,
- latest release.

Selected group detail shows:

- summary metrics,
- current status,
- status control,
- lifecycle timestamps,
- latest raw occurrence,
- affected users and tenants summary,
- release breakdown,
- recent occurrences,
- drilldown into raw occurrences for the group.

Second tab: `Raw occurrences`.

The raw tab keeps the current Errors list/detail workflow and adds optional `error_group_id` filtering. Raw occurrence rows remain read-only.

Initial cross-screen drilldowns keep targeting raw Errors. Routing recent or severe error drilldowns directly to matching groups is deferred.

## Error Handling

API behavior:

- unknown group: `404`.
- invalid status: `400`.
- invalid filters: existing `invalid_query` pattern.
- repository unavailable: existing `503` query-unavailable pattern.
- missing query dependency in tests/dev harness: existing `501` pattern.

Grouping behavior:

- if stack is missing, group by explicit fingerprint or normalized `type + message`.
- if type is missing, group by explicit fingerprint or normalized `message + top stack frame`.
- if affected user or tenant is missing, counts ignore null values.
- duplicate raw error ids remain rejected by existing primary key behavior.

## Implementation Boundaries

`packages/db` owns:

- migration for `error_groups` and new `errors` columns,
- group fingerprint helpers,
- group upsert and lifecycle repository functions,
- group list/detail/status repositories,
- raw occurrence filtering by `error_group_id`,
- idempotent backfill helper.

The worker or existing telemetry write path owns:

- assigning new errors to groups during persistence,
- reopening resolved groups on recurrence,
- preserving ignored groups.

`apps/api` owns:

- grouped error query routes,
- group status update route,
- auth checks and request validation.

`apps/console` owns:

- Errors tab split into `Groups` and `Raw occurrences`,
- group list,
- group detail,
- status control,
- raw occurrence drilldown.

Documentation owns:

- architecture update for grouped errors,
- UI/UX update for grouped Errors tab,
- project summary capability update,
- decision entry explaining immutable raw telemetry plus mutable group workflow.

## Testing

Repository tests:

- explicit payload fingerprint takes precedence,
- fallback fingerprint is deterministic,
- fallback grouping uses type, message, and top stack frame,
- grouping is scoped by project and environment,
- new occurrence attaches to an existing group,
- resolved group reopens and records regression,
- ignored group stays ignored,
- counts and latest occurrence update correctly,
- backfill is idempotent.

API tests:

- list groups with filters,
- get group detail,
- list group raw occurrences,
- update group status,
- reject invalid status,
- return `404` for unknown group,
- require authentication for status update,
- preserve raw error status after group status update.

Console tests:

- Errors opens on `Groups` by default,
- raw occurrences tab still renders the existing raw list/detail workflow,
- selecting a group shows details and lifecycle fields,
- status updates call the API and refresh local state,
- group drilldown opens raw occurrences filtered by `error_group_id`,
- empty, loading, retry, and unavailable states render without layout breakage.

Verification:

```sh
pnpm test
pnpm build
docker compose config --quiet
```

## Documentation Updates

Update:

- `.claude/docs/ARCHITECTURE.md`
- `.claude/docs/PROJECT-SUMMARY.md`
- `.claude/docs/UI-UX.md`
- `.claude/docs/DECISIONS.md`
- `README.md` if grouped error APIs or operator-facing behavior need mention

The documentation should clearly state that raw errors remain immutable and group status is the operator workflow state.

# Incident View and Error UX Refactor Design

## Goal

Create a professional error-first investigation experience for SignalMonitor by adding a dedicated Incident view and refining the Errors workflow that opens it.

The main operator flow should become:

1. Open `Investigate > Errors`.
2. Select a grouped error or raw occurrence.
3. Click `Open incident`.
4. Land on a dedicated, shareable Incident view inside the console shell.
5. Understand what broke, who was affected, what happened around it, and what triage action to take.

This phase should make SignalMonitor feel less like an MVP console and more like a focused monitoring product, without redesigning every console surface.

## Product Direction

The Incident view is error-first and group-centered. It supports two entry points:

- error group: opens an aggregated incident around the group;
- raw occurrence: opens the same incident view with that occurrence selected as the primary occurrence.

The view should be progressive:

- first fold answers the fast-debug questions;
- lower sections support deeper technical investigation and triage.

Fast-debug questions:

- What happened?
- How severe is it?
- What is the impact?
- Who or which tenant was affected?
- When did it start and when was it last seen?
- Is there a trace, session, source map, release, or related context?
- What is the most likely next investigation path?

## UX Scope

The phase includes:

- a dedicated Incident view route inside the console;
- entry actions from `Errors > Groups` and `Errors > Raw`;
- an improved Errors entry experience with clearer lists, badges, actions, states, and filters;
- triage controls for group status and priority;
- a hybrid cross-signal timeline split by confidence;
- focused visual polish for Errors and Incident surfaces.

The phase does not include:

- comments or notes on incidents;
- assignees, teams, escalation, or incident ownership;
- global search;
- a full console redesign;
- a generic investigation platform for every entity type;
- a full visual session replay feature.

## Incident Layout

Use a Split Investigation layout.

The Incident view keeps the console shell and uses a dedicated route. The layout has:

- compact header with breadcrumb back to Errors;
- summary strip with severity, status, priority, impact, occurrence count, affected users/tenants, first seen, last seen, release, trace/session/source-map availability;
- left column for technical error details;
- right column for triage and operational context.

Left column:

- primary occurrence;
- stack and source-map resolution status;
- raw occurrence details;
- context JSON;
- metadata JSON;
- immutable identifiers.

Right column:

- status and priority controls;
- suggested priority and saved override;
- strongly related timeline;
- nearby context timeline;
- related trace, session, user, tenant, and release shortcuts.

Responsive behavior:

- desktop uses the split layout;
- narrower screens stack the columns vertically;
- summary stays near the top and remains readable;
- timeline rows must not overflow horizontally.

## Navigation

The Incident view uses a shareable URL inside the console.

Target routes:

- `/console/incidents/error-groups/:groupId`
- `/console/incidents/error-groups/:groupId?error_id=err_...`

The first implementation may use lightweight browser URL handling instead of introducing a full React Router migration. It should still support:

- direct load while authenticated;
- browser back/forward for entering and leaving the Incident view;
- breadcrumb back to `Investigate > Errors`;
- preserving or restoring the project/environment scope from the incident response.

Errors entry points:

- grouped error rows expose `Open incident`;
- grouped error detail exposes `Open incident` and `Show raw occurrences`;
- raw occurrence rows or detail expose `Open incident` when an `errorGroupId` exists.

## Backend Data Model

Add persisted priority override to `error_groups`.

Priority values:

- `urgent`
- `high`
- `normal`
- `low`

The stored value may be `null` when no operator override has been saved.

Suggested priority is calculated, not persisted. It should be based on factors such as:

- highest group severity;
- occurrence count;
- affected users;
- affected tenants;
- recent regression;
- recency of latest occurrence.

The suggested value gives the operator a starting point, but the saved override is the operational value when present.

## Backend API

Add an incident aggregation endpoint:

```http
GET /query/incidents/error-groups/:id?project_id=...&environment_id=...&error_id=...
```

Response shape should be UI-ready and include:

- `group`;
- `primaryOccurrence`;
- `priority`;
- `suggestedPriority`;
- `sourceMapResolution`;
- `stronglyRelated`;
- `nearbyContext`;
- `related`;
- available occurrence metadata needed for the first fold.

`primaryOccurrence` behavior:

- if `error_id` is provided, use that occurrence after validating it belongs to the group and scope;
- otherwise use the group's latest error occurrence when available.

Extend the group update route:

```http
PATCH /query/error-groups/:id
```

It should accept status and priority updates while remaining compatible with existing status-only clients.

Validation rules:

- require `project_id` and `environment_id`;
- reject invalid status values;
- reject invalid priority values;
- reject cross-project and cross-environment access;
- reject an `error_id` that does not belong to the group.

## Cross-Signal Context

The Incident timeline has two confidence bands.

### Strongly Related

Strongly related signals are directly linked to the primary occurrence or group. Eligible relationships include:

- same `sessionId`;
- same `traceId`;
- same `errorGroupId`;
- breadcrumbs in the same session;
- spans under the same trace;
- LLM calls sharing trace/session/user context where directly available.

### Nearby Context

Nearby context signals are useful but not directly linked. They should be scoped and separated visually from strongly related signals.

Initial nearby logic:

- same project and environment;
- same user or same tenant as the primary occurrence when present;
- time window around the primary occurrence, initially +/- 15 minutes;
- exclude records already shown in strongly related;
- limit result counts per signal type to keep the view usable.

The UI must not present nearby context as causally linked. It should label this section as supporting context.

## Frontend Components

Likely new components:

- `IncidentView`
- `IncidentSummary`
- `IncidentTriagePanel`
- `IncidentTechnicalPanel`
- `IncidentTimeline`
- `IncidentRelatedSignals`
- `PriorityBadge`

Likely modified components:

- `ConsoleShell`
- `ErrorGroupsPanel`
- `ErrorGroupList`
- `ErrorGroupDetail`
- `ErrorRawOccurrencesPanel`
- `ErrorList`
- `ErrorDetailDrawer`
- shared styles in `styles.css`

Client additions:

- `getErrorGroupIncident(groupId, query)`
- `updateErrorGroupTriage(groupId, input)` or extended `updateErrorGroupStatus`

Types should represent:

- incident response;
- timeline items;
- priority values;
- related signal links.

## Error UX Refactor

The Errors workflow should become a clearer entry point into incident investigation.

Groups:

- rows show message, severity, status, priority, affected users/tenants, occurrence count, first/last seen, and primary action;
- status and priority badges are visually consistent;
- selection and action affordances are easier to distinguish;
- empty/loading/error states are specific and useful.

Raw occurrences:

- rows show severity, message, group id/status/priority when available, user, tenant, trace/session, release, and timestamp;
- raw detail keeps technical detail but adds clear navigation to the incident.

Filters:

- reorganize into a denser, more readable control group;
- keep explicit `Apply` behavior;
- do not auto-query while typing.

## Visual Direction

Use a clean operational base similar to Linear or Datadog, with a more technical Sentry-like feel in the Incident view.

Guidelines:

- keep the console dense but readable;
- avoid marketing-style cards and oversized hero composition;
- use restrained color, not a one-hue palette;
- use badges for severity, status, and priority;
- keep actions aligned and predictable;
- improve visual hierarchy in panels and lists;
- make empty/loading/error states feel intentional;
- preserve compactness for repeated operator use.

This phase may introduce shared style primitives only when they directly support Errors and Incident UI. It should not redesign Setup, Overview, Alerts, Artifacts, or System beyond incidental shared style improvements.

## Testing

Backend tests:

- migration adds nullable group priority;
- repository reads and writes priority;
- group update accepts status and priority;
- invalid priority is rejected;
- incident endpoint returns group and primary occurrence;
- incident endpoint validates scope and occurrence membership;
- suggested priority is calculated deterministically for representative cases;
- strongly related and nearby context stay scoped to project/environment;
- nearby context excludes unrelated users/tenants and duplicate strongly related records.

Frontend tests:

- Errors Groups exposes `Open incident`;
- Errors Raw exposes `Open incident` when a group exists;
- direct incident URL renders the dedicated view;
- Incident view renders summary, triage controls, technical panel, strongly related timeline, and nearby context;
- priority override saves and updates UI;
- invalid or unavailable incident state renders a useful error state;
- breadcrumb/back flow returns to Errors;
- responsive layout does not overflow in the main mocked states.

Verification:

```sh
pnpm test
pnpm build
docker compose config --quiet
```

Prefer an additional Playwright visual check for desktop and mobile Incident view states with mocked or fixture data.

## Delivery Plan Shape

The implementation plan should break the work into these slices:

1. data model and priority persistence;
2. incident aggregation repository/API;
3. console client and types;
4. dedicated Incident view route and shell integration;
5. Incident view UI components;
6. Errors entry UX refactor;
7. visual polish and responsive pass;
8. docs, memory, final verification.

## Success Criteria

- Operators can open an Incident view from grouped errors and raw occurrences.
- Incident URLs are shareable and direct-load correctly for authenticated users.
- Incident view clearly separates strongly related signals from nearby context.
- Status and priority can be updated from the Incident view.
- Suggested priority appears when no override exists.
- Error groups and raw occurrences feel more polished and easier to scan.
- Existing investigation tabs keep working.
- Full verification passes.

# Console UX Refinement Design

Date: 2026-06-02
Status: Approved for spec review

## Goal

Refine the Sigmon console into a more professional, intentional operational workspace.

The redesign should make common user actions easier, make editable resources consistently manageable, clarify units and configuration semantics, and separate:

- monitored project operations;
- project/environment configuration;
- global Sigmon installation administration.

This is not only a visual polish pass. It is an information architecture and interaction model update that should give the console a durable foundation for future features.

## Current Pain Points

- `Setup` is doing two jobs: initial onboarding and recurring configuration.
- `System` is conceptually global, but it sits beside project-scoped modes in a way that can imply it belongs to the selected project.
- Some resources can be created but not edited, disabled, archived, or deleted from the UI.
- Similar resources use different interaction patterns across screens.
- Operational screens mix monitoring, investigation, and configuration without a clear mental model.
- Labels such as `Interval`, `Timeout`, `Window`, and `Threshold` do not always expose units or expected semantics.
- Icon-only actions need clearer tooltips and accessible labels.
- Empty, loading, error, and destructive-confirmation states should feel consistent across the console.

## Product Model

The console has two primary mental spaces.

### Project Workspace

The Project Workspace is scoped to the active `project + environment`.

It is for working with a monitored application:

- understanding activity and health;
- investigating telemetry;
- configuring telemetry ingestion and alerting for that project;
- managing project-specific resources.

Project Workspace pages:

- `Overview`
- `Operations`
- `Investigate`
- `Alerts`
- `Monitors`
- `Artifacts`
- `Project Settings`

### Sigmon Admin

Sigmon Admin is installation-scoped.

It is for administering the Sigmon server itself:

- API, worker, and scheduler liveness;
- Postgres and Redis readiness;
- SMTP delivery configuration;
- retention and backup health;
- environment-variable readiness;
- global security and browser CORS configuration;
- deploy/runtime diagnostics.

Sigmon Admin must never look scoped to `MicroERP`, `dissip`, or any other monitored project.

`my.sigmon.app` may be monitored as an ordinary project for dogfooding, but that is separate from Sigmon Admin. A project called `Sigmon` reports telemetry about the product as a monitored app; Sigmon Admin reports whether the self-hosted installation is functioning.

## Navigation

Use a project-first console shell.

The global header should make the active scope unmistakable:

- project selector;
- environment selector or environment pill;
- current mode label;
- search/jump control;
- refresh/notifications/user actions.

The primary rail should prioritize project work:

- Overview
- Operations
- Investigate
- Alerts
- Monitors
- Artifacts
- Project Settings

Sigmon Admin belongs in a visually separated rail section, preferably near the bottom with a distinct label, icon, and tooltip. Its pages should use installation terminology, not project terminology.

`Setup` should no longer be the permanent configuration destination. It becomes an onboarding state for when there is no project or no environment yet. Once the user has a project and environment, recurring configuration happens in `Project Settings`.

## Project Settings

Add a project/environment-scoped `Project Settings` mode.

It should provide a consistent CRUD workspace for project resources:

- Projects and project metadata where supported.
- Environments.
- API keys.
- Browser ingestion origins.
- Notification channels.
- Alert rules.
- HTTP monitors.
- Heartbeat monitors.
- Source-map artifacts and upload tokens.
- Members or users, where supported by current auth/admin APIs.
- SDK snippets and smoke-test guidance.

The layout should follow one reusable pattern:

1. A short page heading that says what the resource is for.
2. A resource list or table.
3. A selected-detail panel or drawer.
4. A primary `New ...` action.
5. Inline edit controls for safe fields.
6. Explicit enable, disable, revoke, archive, or delete actions depending on the resource.
7. Field-level help text with units, examples, and operational meaning.
8. Clear confirmation for destructive actions.

Project Settings is the canonical place for complete editing. Operational screens may expose the same creation/editing flows for convenience, but they should reuse the same forms, labels, validation, and action semantics.

## Operational Screens

Operational screens should remain action-capable, not read-only, but their job is different from Settings.

### Overview

Overview is the project/environment summary of usage and telemetry trends.

Refinements:

- Keep compact KPI groups.
- Improve drilldown affordances.
- Make time-window controls visually consistent.
- Use readable empty states when telemetry is sparse.
- Avoid hiding project setup gaps when the project has partial telemetry.

### Operations

Operations is the health cockpit for the active project/environment.

Refinements:

- Preserve the distinction from Sigmon Admin.
- Emphasize monitored-app status: monitors, alert state, p95 latency, error rate, ingestion freshness, and open incidents.
- Add clear drilldowns into Alerts, Monitors, Investigate, and Incident view.
- Use setup-gap cards that link to Project Settings when the fix is configuration.

### Investigate

Investigate remains the detailed telemetry workspace.

Refinements:

- Keep the tab model: Events, Errors, Traces, LLM, Entities, Users.
- Make selected context clearer in list/detail layouts.
- Improve filter labels, placeholders, and empty states.
- Keep detail panes dense but intentional, with consistent section headings.
- Preserve raw identifiers, JSON, stack, source-map resolution, and timeline details.

### Alerts

Alerts is for operating and managing alert behavior for the active project/environment.

Refinements:

- Show rules, channels, recent events, and delivery health with clear status.
- Add edit, enable/disable, and archive/delete actions for alert rules.
- Add edit, enable/disable, and archive/delete actions for notification channels.
- Make rule units explicit:
  - `Window (minutes)`
  - `Cooldown (minutes)`
  - `Threshold`
  - `P95 latency threshold (milliseconds)` for trace p95 rules
  - `Error rate threshold (%)` for error-rate rules
- Explain what each rule type measures.
- Explain that email channels use the server SMTP configuration and webhook secrets are write-only.

### Monitors

Monitors is for HTTP uptime and heartbeat checks for the active project/environment.

Refinements:

- Keep list, recent checks, HTTP creation, and heartbeat creation available.
- Reuse the Project Settings monitor editor.
- Make units explicit:
  - `Check interval (minutes)`
  - `Timeout (milliseconds)`
  - `Expected heartbeat interval (minutes)`
  - `Grace period (minutes)`
- Explain heartbeat semantics: a heartbeat is down when no check-in arrives inside expected interval plus grace.
- Preserve historical checks when a monitor is archived.
- Show heartbeat check-in URL and secret only immediately after creation.
- Add a copy action with feedback for generated URLs/secrets.

### Artifacts

Artifacts is for source-map management for the active project/environment.

Refinements:

- Keep single `.map` and `.zip` upload flows.
- Make release matching constraints explicit.
- Add consistent delete/archive confirmation for artifacts and token revocation.
- Show token secrets only immediately after creation.
- Use Project Settings for upload token management when the user is primarily configuring CI.

## Sigmon Admin

Add a distinct Sigmon Admin area.

Initial pages can be:

- `System health`
- `Server settings`
- `SMTP & delivery`
- `Workers`
- `Retention & backups`
- `Security & CORS`

The first implementation may map some pages to a single grouped screen if backend support is not ready, but the navigation and labels should communicate the installation-scoped model.

### System Health

System Health should show global Sigmon status:

- API uptime/readiness.
- Postgres latency/readiness.
- Redis latency/readiness.
- Queue worker heartbeat.
- Scheduler heartbeat.
- SMTP readiness if configured.
- Queue depth.
- Retention job state.
- Backup job state.
- Source-map storage readiness.

### Server Settings

Server Settings should show deployment/runtime readiness, especially configuration that today exists only as environment variables.

The first version can be read-only. If a setting is not editable yet, the UI should show its readiness state and a short note explaining that it is configured through environment variables or deployment settings. It should show:

- configured;
- missing required;
- missing optional;
- masked value preview when safe;
- where to configure it in self-hosting.

### SMTP & Delivery

SMTP should be understood as a server-level provider configuration.

Notification channels are project resources. SMTP credentials are installation resources.

Future editing in the UI is acceptable, but the first pass may show read-only readiness plus a test-delivery action if the API supports it.

### Security & CORS

Browser ingestion origins should be visible and editable where the data model supports project/environment-level origins.

If the current implementation uses global `BROWSER_CORS_ORIGINS`, Sigmon Admin should show global origin readiness. Project Settings can still show browser-origin guidance and, later, become the editable per-project source of truth.

## Editable Resource Semantics

Use consistent verbs:

- `Create` for new resources.
- `Save changes` for edits.
- `Disable` for reversible off states.
- `Enable` for reversible on states.
- `Revoke` for secrets/tokens that cannot safely be reused.
- `Archive` for resources whose history should remain queryable.
- `Delete` only when data is actually removed.

Prefer archive over hard delete for:

- monitors;
- alert rules;
- notification channels;
- API keys and upload tokens, expressed as revoke/archive;
- environments, if historical telemetry should remain meaningful.

Destructive confirmations should state the consequence, for example:

> Archive monitor "GO API"? Historical checks will be kept, but new checks will stop.

## Help, Labels, And Tooltips

Every form field should use a label that includes its unit when relevant.

Examples:

- `Check interval (minutes)`
- `Timeout (milliseconds)`
- `Window (minutes)`
- `Cooldown (minutes)`
- `P95 latency threshold (milliseconds)`
- `Error rate threshold (%)`
- `Expected heartbeat interval (minutes)`
- `Grace period (minutes)`
- `Browser origin`

Use short help text below fields for semantics that are easy to misunderstand.

Examples:

- `The scheduler checks this URL every N minutes.`
- `Timeout is the maximum time Sigmon waits for the HTTP response.`
- `Grace is added to the expected heartbeat interval before the monitor is marked down.`
- `Origins must include protocol, for example https://app.example.com.`

Icon buttons should have:

- accessible labels;
- `title` tooltips;
- predictable placement;
- consistent danger styling for destructive actions.

Avoid long explanatory prose inside the main workflow. Prefer concise help rows, tooltips, and optional secondary text.

## Visual Direction

Keep the dark operational console direction.

The UI should feel:

- compact;
- calm;
- professional;
- built for repeated use;
- clear about current scope;
- deliberate about primary vs secondary actions.

Guidelines:

- Keep the 64px rail and dense topbar.
- Use restrained green accents for healthy/active states.
- Use amber/red only for warning/failure/destructive states.
- Avoid marketing-style hero layouts.
- Avoid nested cards.
- Use full-width sections or single-layer cards.
- Keep card radius at 8px or less unless the existing system requires otherwise.
- Use lucide icons for action buttons where available.
- Ensure mobile/narrow layouts stack without text overlap.
- Avoid one-note palettes; the dark shell should be balanced with neutral, green, amber, and red accents.

## Interaction Patterns

### Lists And Detail Panels

Editable resources should use a list/detail or table/detail pattern:

- list rows expose primary status and compact actions;
- selecting a row shows details;
- editing happens in a side panel or contextual panel;
- creation uses the same form component as editing where possible.

### Empty States

Empty states should be helpful and scoped.

Examples:

- `No alert rules yet. Create a rule to notify you when errors or latency cross a threshold.`
- `No notification channel yet. Add email or webhook delivery before enabling critical alerts.`
- `No browser origins configured. Browser SDK calls require an allowed origin.`

### Errors

Errors should:

- preserve current project/environment context;
- state the failed operation;
- avoid generic "unavailable" where a more precise message is known;
- offer retry where useful.

### Loading

Loading states should preserve layout shape when practical so the workspace does not jump.

## Backend And API Needs

Some UI refinements can use existing APIs. Others need backend additions.

Existing or already implied APIs:

- list/create/update/archive monitors;
- list/create/update/archive notification channels;
- list/create alert rules;
- list alert events;
- project, environment, API key, source-map, and token management.

Likely additions:

- update/archive alert rules if not already exposed.
- update/archive environments if desired.
- edit project metadata if desired.
- project/environment browser-origin persistence, if moving beyond global env var CORS.
- admin configuration-readiness endpoint for Sigmon Admin.
- optional SMTP test-delivery endpoint.
- optional action audit trail for UI operations.

The redesign should not fake unsupported actions. If an action lacks backend support, the UI should either omit it or label it as unavailable until the API exists.

## Implementation Approach

Execute the full redesign through smaller PRs.

### PR 1: Foundation

- Create the navigation split between Project Workspace and Sigmon Admin.
- Add `Project Settings` route/mode.
- Rename or reposition `Setup` as onboarding-only where possible.
- Add shared UI primitives:
  - action toolbar;
  - resource list row;
  - detail panel;
  - field help;
  - confirm action;
  - copy-with-feedback button;
  - empty/loading/error state components.

### PR 2: Project Settings Resources

- Add Project Settings sections for environments, API keys, browser origins guidance, notification channels, alert rules, monitors, source maps/tokens, and members where supported.
- Use existing backend APIs first.
- Add missing API support only for actions in scope.

### PR 3: Alerts And Monitors CRUD Polish

- Reuse Project Settings editors inside Alerts and Monitors.
- Add edit/enable/disable/archive flows for rules and channels.
- Improve labels, units, help text, and status language.

### PR 4: Sigmon Admin

- Separate System Health from project navigation.
- Add server settings/readiness cards.
- Add SMTP, workers, retention, backups, and CORS readiness panels.
- Keep read-only where write support is not yet implemented.

### PR 5: Visual Polish Across Operational Screens

- Apply shared component language to Overview, Operations, Investigate, Alerts, Monitors, and Artifacts.
- Improve empty/loading/error states.
- Ensure responsive layout and no overlapping text.
- Verify with browser screenshots.

The exact PR grouping can change if dependencies are discovered, but foundation should come before broad visual polish.

## Testing

Automated tests should cover:

- navigation mode changes;
- project/environment scope preservation;
- Project Settings empty states;
- create/edit/enable/disable/archive flows where supported;
- destructive confirmation behavior;
- unit labels and help text presence for alert/monitor forms;
- Sigmon Admin not requiring a selected project/environment;
- project-scoped pages requiring a project/environment;
- API client coverage for new endpoints.

Manual/browser verification should cover:

- desktop console layout;
- narrow viewport stacking;
- project switching;
- environment switching;
- Alerts CRUD;
- Monitors CRUD;
- Project Settings resource editing;
- Sigmon Admin pages with configured and missing env-var states;
- no text overlap in buttons, rows, cards, and panels.

## Non-Goals

This design does not require:

- a public marketing site redesign;
- a new charting dependency;
- session replay;
- full audit log implementation;
- SSO or SAML;
- replacing the existing dark console shell;
- moving all self-host configuration into the UI immediately.

## Open Constraints

- Some global settings are currently environment variables. The UI can surface readiness before it can edit them.
- Per-project browser-origin configuration may require new storage and a CORS lookup model.
- Admin write operations should be added conservatively because they affect the Sigmon installation itself.
- Destructive actions should prefer archival semantics until data-retention behavior is explicit.

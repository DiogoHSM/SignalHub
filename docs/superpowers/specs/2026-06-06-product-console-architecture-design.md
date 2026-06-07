# Product Console Architecture Design

## Summary

SignalMonitor is moving from MVP telemetry console to a serious operations and analytics product. The next product architecture should separate global executive awareness from project-level operational work.

The console will use two primary contexts:

- **Global Home**: an executive risk dashboard for the infra/devops owner who keeps SignalMonitor open all day.
- **Project Workspace**: the real working area for a selected project and environment.

This design deliberately avoids turning the Global Home into generic business intelligence. Its job is to surface operational risk, outliers, freshness problems, regressions, and attention-worthy changes across all monitored projects.

## Goals

- Make it obvious whether the user is looking at SignalMonitor itself or a monitored project.
- Give infra/devops a global "what needs attention now?" home.
- Make project-level work faster through stable areas: Operations, Analyze, Traces, Errors, Experiments, Configure.
- Improve professional polish: layout, typography, spacing, scroll behavior, buttons, forms, charts, and dark theme consistency.
- Create a navigation model that can absorb Sentry, PostHog, Amplitude, feature flags, prompt evaluation, and APM-like functionality without becoming a pile of tabs.

## Non-Goals

- This is not a full BI suite for customer business reporting.
- This does not specify every future analytics feature in detail.
- This does not require a light theme in the first implementation.
- This does not change ingestion APIs by itself.
- This does not replace existing alert, monitor, trace, error, or analytics functionality; it reorganizes and deepens their product surface.

## Information Architecture

### Global Area

The global area is outside any single project. It answers: "Which project needs attention, and why?"

Primary destinations:

- **Home**: executive risk dashboard across all projects.
- **Sigmon Admin**: health and configuration of the SignalMonitor installation itself.

### Project Workspace

The project workspace is entered by selecting a project from the Global Home or from the project switcher. It is always scoped to a selected project and environment.

Primary destinations:

- **Operations**: operational dashboard for the project.
- **Analyze**: product usage and event analytics.
- **Traces**: APM-style route, trace, and span investigation.
- **Errors**: error groups, raw occurrences, source maps, triage, and incident detail.
- **Experiments**: feature flags, A/B tests, prompt variants, model comparisons, and evaluation surfaces.
- **Configure**: project-specific setup and configuration.

### Sigmon Admin

Sigmon Admin is separate from Project Workspace to prevent confusion between "SignalMonitor is healthy" and "this monitored project is healthy."

Admin destinations:

- **System Health**: API, worker, scheduler, Postgres, Redis, queues, retention, backups.
- **Notifications**: SMTP/Resend SMTP, global notification channels, test delivery, delivery attempts.
- **Storage**: source maps, artifacts, backup size, retention, cleanup.
- **Security**: console users, sessions, bootstrap admin, future audit log.
- **Deploy**: SignalMonitor version, build, migrations, environment variable readiness, EasyPanel deploy hooks.
- **Docs & SDK**: Scalar/OpenAPI, SDK docs, install snippets, npm package version.

Admin should include a configuration health check that makes missing or unhealthy setup explicit.

## Global Home

Global Home is the first screen after login. It is an executive dashboard, but operational risk remains the ranking principle.

### Top Bar

The top bar should include:

- Current context: Global Home.
- Global search for project, incident, route, tenant, user, trace, or monitor.
- Manual refresh.
- Auto-refresh selector: off, 30s, 1m, 2m, 5m, 15m.
- Notification indicator.
- User menu with logout.

### Summary State

Global Home should show an overall state:

- All systems normal.
- Needs attention.
- Degraded.
- Critical.

This state is derived from open incidents, down monitors, alert firings, stale ingestion, latency outliers, error-rate outliers, and system configuration health.

### Primary Cards

Global Home should prioritize:

- Projects in risk state.
- Open incidents.
- Down or degraded monitors.
- Recent alert firings.
- p95/p99 latency outliers.
- Error-rate outliers.
- Ingestion freshness issues.
- LLM cost/spend outliers.
- Configuration gaps that affect alerting, scheduler, SMTP, backups, or retention.

### Attention Queue

The center of the Home should be a prioritized queue rather than a generic table. Each row should explain why attention is needed.

Each item includes:

- Project.
- Environment.
- Signal type: error, latency, monitor, ingest, LLM cost, traffic anomaly, system config.
- Severity.
- Short explanation.
- Last seen.
- Suggested action.
- Drilldown target.

Positive outliers may appear when they are operationally meaningful, such as a sudden traffic spike with stable p95, a tenant usage surge, or a large increase in events.

### Global Trends

Charts should be few and readable:

- Operational risk over time.
- Incidents by project.
- p95 outliers by route/project.
- Error rate by project.
- Ingest volume anomaly.

Charts need dynamic axes, readable labels, subtle grid lines, dark-theme styling, stable empty states, and no hard-coded misleading scale.

## Project Workspace

The project workspace starts with **Operations** as the default page. Project and environment must remain highly visible.

### Operations

Operations is the cockpit for one project/environment.

It should show:

- Active incidents.
- Monitors and heartbeats.
- Alert rules and recent firings.
- Error rate.
- p95/p99 latency by route.
- Freshness of events, errors, traces, LLM calls, and monitor checks.
- Current release/deploy when known.
- Worker/queue health when reported by heartbeat or events.
- Recommended drilldowns.

Recommended drilldowns should be explicit, such as:

- Open the incident inbox.
- Inspect slow route.
- Inspect worker heartbeat.
- Understand traffic spike.
- Review affected tenant or user.

### Analyze

Analyze is product and usage analytics, but still oriented toward operational understanding.

It should cover:

- Event trends by name and property.
- Tenant and user timelines.
- Property filters.
- Saved dashboards.
- Funnels.
- Retention and cohorts.
- CSV/export/API access for ad hoc analysis.

### Traces

Traces is the APM-style investigation area.

It should cover:

- Route grouping.
- p50/p95/p99 by route.
- Trace list with status, latency, route, user, tenant, release.
- Waterfall view for a selected trace.
- Span attributes and timings.
- Related errors, events, users, tenants, and releases.
- Before/after comparison by release where data exists.

### Errors

Errors is the error-tracking area.

It should cover:

- Issue inbox.
- Error groups.
- Raw occurrences.
- Incident detail.
- Stack, context, metadata, breadcrumbs, source map state.
- Status, priority, resolve, ignore, and reopen behavior.
- Detail drawer or page that does not break the dark theme.

### Experiments

Experiments is a future-facing area for controlled changes and AI/prompt work.

It should cover, over time:

- Feature flags.
- A/B tests.
- Experiment assignment.
- Prompt variants.
- Model comparisons.
- Cost, latency, success, error, and quality comparison.

The first implementation may only define the shell and empty states for this area if the underlying data model is not ready.

### Configure

Configure contains behavior-changing setup for the selected project.

It should cover:

- Environments.
- API keys and key names.
- Browser origins and CORS allowlist.
- SDK setup snippets.
- Source maps and upload tokens.
- Project-specific alert rules and channels.
- Project-specific retention overrides if added later.

Configurable resources need clear create, edit, archive/delete, and test actions where applicable.

## Visual and Interaction Standards

### Layout

- The app shell should use `100vh`.
- Sidebar/rail should be fixed to viewport height.
- Main content should have its own scroll area.
- Topbar should remain stable and visible.
- Scrollbars must match the dark theme.
- Cards should not be nested inside cards.
- Dense operational pages should use tables, lists, drawers, and split panes rather than oversized cards.

### Topbar

The topbar should include:

- Context: Global Home or selected project/environment.
- Project switcher when in project context.
- Environment switcher/pill when in project context.
- Global or scoped search depending on context.
- Manual refresh button that actually refetches visible data.
- Auto-refresh selector with visible interval.
- Notifications.
- User menu with logout.

### Theme

- Dark theme is primary.
- No white buttons or white incident pages inside dark mode.
- Green means healthy/success.
- Amber means needs attention.
- Red means critical/error.
- Blue means informational.
- Theme tokens should avoid one-off hard-coded colors.
- Light theme can be added later, but mixed dark/light surfaces are not acceptable.

### Forms

- Units must be explicit in labels: minutes, seconds, milliseconds.
- Help text should explain operational meaning, not implementation trivia.
- Dangerous actions need confirmation.
- Save/create/test/delete actions should be visually consistent across pages.

### Tables and Lists

- Investigation surfaces should use dense tables with aligned columns.
- Details should open in a drawer or a full detail page depending on complexity.
- Selected rows should have clear dark-theme states.
- IDs should be copyable or visually de-emphasized unless they are the primary object.
- Empty states should explain what the absence of data means and how to create or validate data.

### Charts

- Axes must be dynamic.
- Labels must be legible.
- Empty states should not render fake flat lines that imply zero when there is no data.
- Legends should show current values.
- Charts should use available space, but not dominate operational pages unless they are the core task.

## Data Flow

Global Home reads aggregated risk signals across projects:

- Incidents.
- Alert rule state and firings.
- Monitor checks.
- Error rate.
- Trace latency.
- Ingestion freshness.
- LLM cost.
- Configuration health.

Project Workspace reads scoped data for one project/environment:

- Operations reads a summary plus recent operational signals.
- Analyze reads event/entity/user/tenant aggregates and timelines.
- Traces reads trace groups, traces, spans, and related records.
- Errors reads groups, occurrences, triage state, and related context.
- Configure reads project settings and exposes mutations.

The frontend should avoid duplicating query logic across pages by using small, named data hooks or service helpers.

## Error Handling

- API failures should show localized panel errors, not full-page collapse.
- Global refresh failures should show the last successful refresh time.
- Auto-refresh should not stack concurrent requests.
- Mutations should show optimistic state only when rollback is straightforward.
- Delete/archive actions should have confirmation and a clear success/failure message.

## Testing Strategy

Implementation should add or update tests for:

- Navigation and context transitions.
- Global Home risk queue rendering.
- Project switcher and environment state.
- Refresh and auto-refresh behavior.
- User menu logout behavior.
- Dark-theme consistency for incident/detail pages.
- Monitor/alert/config resource edit/delete actions where touched.
- Chart empty states and dynamic axis labels.

Visual verification should include desktop and narrower viewport screenshots for:

- Global Home.
- Project Operations.
- Errors/Incident detail.
- Analyze entity/user detail.
- Monitors.
- Sigmon Admin/System Health.

## Implementation Phasing

This design is larger than one PR. Recommended sequencing:

1. **Shell and IA foundation**: Global Home route, project workspace route structure, topbar, sidebar groups, scroll behavior, user menu, refresh/auto-refresh.
2. **Global Home MVP**: risk summary, attention queue, project cards, basic global trends.
3. **Project Operations refresh**: operational cockpit as the default project page, drilldown cards, monitor/alert/error/trace summaries.
4. **Investigation polish**: Errors, Traces, Analyze, and detail surfaces with dark-theme consistency and better tables/drawers.
5. **Admin separation**: Sigmon Admin grouping, configuration health, deploy/system/storage/notifications pages.
6. **Future product areas**: funnels, retention, saved dashboards, feature flags, experiments, prompt/model comparison.

## Acceptance Criteria

- A user can distinguish Global Home, Project Workspace, and Sigmon Admin without explanation.
- The first screen after login prioritizes operational risk across all projects.
- Clicking a project leads to that project's operational dashboard.
- Project pages expose Operations, Analyze, Traces, Errors, Experiments, and Configure as clear areas.
- Sigmon Admin no longer looks like a project health page.
- The app shell has dark scrollbars, stable viewport-height layout, a working refresh button, auto-refresh settings, and a clickable user menu with logout.
- Charts avoid misleading fixed axes and render empty states professionally.
- Existing core capabilities remain accessible after the navigation change.

# UI and UX

SignalMonitor includes an admin-only Integration Console.

## Console Principles

- The console is an operational workspace, not a marketing page.
- Navigation is split by scope: Project Workspace modes operate on the selected monitored project/environment, while Sigmon Admin is reserved for installation-level status and server configuration.
- `Project Settings` is the recurring configuration workspace for the active project/environment. `Onboarding` is for creating the first project, environment, and initial setup path.
- The first screen is now the environment Overview. Setup remains available from the rail for projects, environments, API keys, snippets, connection status, and simple user administration.
- API key secrets are shown only immediately after creation and are not stored in browser storage.
- API key rows expose a compact revoke action; revoked keys should leave the active key list after confirmation while historical telemetry remains intact.
- The visual style should remain compact, quiet, and optimized for repeated operational work.
- Use a dark-first console shell with a 64px icon rail, dense topbar context, restrained green signal accents, and no marketing-style hero sections.
- The active project is selectable from the global header in every console mode. Setup keeps the fuller project creation/sidebar workflow, but operators should not need to return to Setup just to switch context.
- The sigmon mark is a simple mono heartbeat SVG and should remain single-color so it can inherit the surrounding foreground/accent color.
- Overview KPIs are grouped by operational domain: Signal intake, Reliability, Latency, and AI spend. Monetary values should use compact USD formatting instead of raw decimal strings.
- Operational pages should use dark native surfaces consistently: no white form islands inside the dark console, readable secondary values, compact status pills, and grid spans chosen by workflow density rather than filling space indiscriminately.
- The console shell uses viewport-bounded scrolling: the icon rail and topbar stay anchored to the browser height while the workspace content owns its own vertical scroll.
- Console scrollbars should be dark-themed inside the shell and scoped to internal workspace/list panes so browser-default light scrollbars do not appear in project views.
- The global header includes manual refresh, configurable auto-refresh intervals, and an operator menu with sign-out. These controls should remain available from project and admin modes.
- The global command palette opens from the header or `Cmd/Ctrl+K` and should provide fast navigation across project workspace and Sigmon admin destinations before growing into record-level search.

## Investigation UX

- Keep `Onboarding`, `Overview`, and `Investigate` as separate top-level console modes.
- Keep `Operations` as a separate project/environment cockpit between `Overview` and `Investigate`.
- Keep `Alerts` as a compact operational mode for rules, generic webhook channels, recent alert history, and delivery status.
- Keep `Monitors` as a separate operational mode for HTTP uptime monitors, heartbeat monitors, recent checks, and one-time heartbeat secrets.
- Keep `Artifacts` as a compact admin mode for source-map upload, filtering, deletion, and CI upload token management for the active project/environment.
- Keep `Project Settings` as a project-scoped configuration mode for environments, API keys, browser origins, SDK snippets, source maps, and the current console user administration surface.
- Project Settings starts with a compact setup checklist for the selected project/environment so operators can see whether project scope, environment, endpoint, and one-time API key setup are ready before handing integration details to another developer.
- Keep `System Health` inside Sigmon Admin as a quiet global operational mode for Sigmon service health, queue worker and scheduler liveness, deploy config readiness, queue depth, ingestion freshness, retention status, and backup status.
- Browser origin panels should show the currently configured global `BROWSER_CORS_ORIGINS` values so operators can validate browser SDK readiness without checking server env vars.
- System Health shows source-map retention policy and deleted counts inside the existing Retention card.
- Overview is the first operational summary surface for the selected project/environment.
- Overview loads only while active and preserves its layout shape while loading.
- Overview window controls support `24h`, `7d`, and `30d`.
- Overview trend panels stay lightweight with in-app SVG/CSS, not a chart dependency. Trend charts should include grid context, metric-unit axis labels, stable empty states, color-consistent series, and legend values so sparse data does not read as broken.
- Overview top-list rows can drill into Investigate with seeded exact filters; recent signals stay read-only.
- Investigation views are operational, dense, and read-only by default.
- Events use a list/detail layout with filters above the list and a detail drawer for selected records.
- Investigation detail drawers, event rows, filters, and aggregate strips should share the dark console surface language so raw telemetry inspection feels like one professional workspace.
- Filters apply only when the operator clicks `Apply`; typing does not auto-query.
- Missing project/environment state should point operators back to Setup.
- Keep Events and Errors as peer tabs inside `Investigate`.
- Errors default to raw occurrences when opened from the top-level Investigate tab, and the error workspace also exposes grouped triage as a peer `Groups` view.
- Grouped Errors use a list/detail layout with filters above the group list, operator-editable group status, occurrence/user/tenant counts, fingerprint context, and a direct raw occurrence drilldown for the selected group.
- Grouped and raw error rows expose `Open incident` actions that navigate to a shareable incident URL for the selected error group and, when opened from a raw occurrence, preserve the raw error id as context.
- Incident view uses a split investigation layout: technical primary occurrence details, stack, source-map status, context, and metadata on the left; operational triage, related identifiers, strongly related activity, and nearby context on the right. It stacks before the console layout becomes cramped.
- Incident view uses the same dark operational surface system as the console shell; it should not introduce light cards or browser-default controls inside the dark app.
- Priority badges show saved priority when present and suggested priority otherwise. Severity, status, and priority badges should remain compact and scannable in both the error lists and Incident view.
- Nearby context is explicitly labeled as supporting activity around the primary occurrence, separate from strongly related signals, so operators do not read it as guaranteed causality.
- Error group status filters should be constrained to supported workflow statuses: open, investigating, resolved, and ignored.
- Raw Error rows should prioritize severity, status, message, error group id, and trace/session context.
- Raw Error details should show stack, source-map resolution metadata, context JSON, metadata JSON, error group id, and immutable identifiers.
- Source-map resolution UI should show status, original file/line/column, symbol name, minified frame, and unresolved frame count. It must not display original source code snippets or `sourcesContent`.
- Raw error details show `Session context` only when a selected error has `session_id`. The timeline is compact, chronological, and highlights the selected error. It displays safe summaries and never renders raw form values, request bodies, response bodies, cookies, or headers.
- Keep Traces as a peer tab with Events and Errors inside `Investigate`.
- Traces use the same filter/list/detail pattern, with spans loaded only after trace selection.
- Trace rows should prioritize name, status, duration, started time, user, tenant, and trace id.
- Span details should remain a dense ordered list before adding graphical timelines.
- Keep LLM as a peer tab with Events, Errors, and Traces inside `Investigate`.
- LLM uses the same filter/list/detail pattern, with a compact aggregate strip for calls, tokens, and total cost.
- LLM rows should prioritize provider/model, prompt, status, cost, tokens, latency, time, user, and tenant.
- LLM details should show immutable identifiers, cost and token fields, previews, error text, and metadata JSON.
- Keep Entities as a peer tab with Events, Errors, Traces, and LLM inside `Investigate`.
- Entities uses a tenant-first layout with a default `7d` window, impact-ranked tenant rows, and a selected-tenant detail panel.
- The Unassigned tenant bucket should be visible for context but disabled for drill-in.
- Entity details should show compact summary metrics, top users, and a cross-signal timeline from events, errors, traces, and LLM calls.
- Entity timeline rows should drill into the raw investigation tabs with seeded exact filters so operators can move from tenant context to source records.
- Entities surfaces should remain dark and scannable: sort buttons, selected tenant cards, metric tiles, filters, top-user tables, and timeline rows all inherit the console theme.
- Keep Users as a peer tab with Events, Errors, Traces, LLM, and Entities inside `Investigate`.
- Users uses a user-first layout with a default `7d` window, impact-ranked user rows, tenant/search filters, and a selected-user detail panel.
- The Anonymous / Unassigned user bucket should be visible for context but disabled for drill-in.
- User details should show compact summary metrics, recent sessions, and a cross-signal timeline from events, errors, traces, and LLM calls.
- User timeline rows should drill into the raw investigation tabs with seeded exact filters so operators can move from user context to source records.
- Users surfaces should follow the same dark treatment as Entities, including disabled Anonymous rows, selected user cards, metric tiles, filters, sessions, and timeline rows.

## Operations UX

- `Operations` is the project/environment cockpit for monitored application health. It is distinct from global `System` health.
- `Overview` remains the product and telemetry summary for the selected project/environment.
- `Operations` summarizes monitored health, alert state, p95 latency, error rate, ingestion freshness, and open incidents for the selected project/environment.
- `System Health` remains global Sigmon install health: API, Postgres, Redis, queue worker, scheduler, SMTP, retention, and backups.
- Operations is read-only in this slice. Drilldowns route to existing Monitors, Alerts, Investigate, and Incident views for action.
- Operations command cards should stay compact and scannable, with stable dimensions and no nested cards.

## Alerts UX

- Alerts should stay dense and operational: rules, channels, recent events, and delivery status should be visible without a marketing-style layout.
- Alerts should keep summary counters and creation forms aligned in a compact grid, with dark inputs/selects and subdued empty states.
- Alert rule controls should remain scoped to the active project and environment.
- Alert rule fields should expose units in labels or nearby help: windows and cooldowns are minutes, error-rate thresholds are percentages, trace p95 thresholds are milliseconds, critical/error count thresholds are counts, and LLM cost thresholds are USD.
- Generic webhook channel forms may accept a secret header name and value, but the saved secret value is write-only and should never be displayed after submission.
- Email notification channels are created from the same compact channel form and show recipients plus SMTP delivery status rather than webhook secret state.
- Notification channel rows expose compact destructive actions; archiving requires confirmation and removes the channel from active rule configuration lists.

## Monitors UX

- Monitors should stay separate from alert rules so uptime and heartbeat setup does not crowd threshold configuration.
- Monitors uses a full-width monitor list followed by three balanced panels for recent checks, HTTP setup, and heartbeat setup.
- Monitor list rows use explicit columns for monitor identity, target, schedule, last check, status, and row actions so the full-width list earns its space.
- HTTP monitor rows should prioritize name, target URL, schedule, status, and last check time.
- Heartbeat monitor rows should prioritize name, check-in target, expected interval, grace window, status, and last check time.
- Monitor form labels should include units: check interval and heartbeat grace values are minutes, HTTP timeout is milliseconds.
- Monitor rows expose compact edit and delete actions. Editing uses a contextual form for the selected monitor type; deleting archives the monitor after confirmation while preserving historical checks.
- Heartbeat secrets are shown only immediately after monitor creation, paired with the check-in URL, and should not be stored in browser storage.
- Recent monitor checks should stay compact and show status, response or heartbeat marker, latency, and sanitized error text.

## Artifacts UX

- Artifacts should stay operational: release filter, single-map upload, bundle upload, uploaded artifact list, and delete actions should fit the active project/environment workspace.
- Artifacts uses two balanced upload panels plus a dark token-management surface; file inputs should look native to the console, not browser-default white controls.
- Artifacts includes compact source-map upload token management for the active project/environment. Token secrets are shown once after creation.
- Source-map upload token rows expose edit and revoke actions; renaming a token never rotates or re-displays the write-only secret.
- Upload controls should support single `.map` files and `.zip` bundles.
- Operators must provide release metadata because resolution uses strict release matching and does not guess across releases.
- Artifact rows should prioritize release, minified file, original filename, size, upload time, and a short delete action.

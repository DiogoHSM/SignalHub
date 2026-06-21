# UI and UX

SignalMonitor includes an admin-only Integration Console.

## Product Console Architecture

- The console is evolving from an MVP telemetry console into a product shell with two primary contexts: a global executive risk Home and project-scoped workspaces.
- `Home` is the first screen after login and should behave like an executive risk dashboard for infra/devops: it ranks monitored projects by operational attention needed rather than acting as a generic BI dashboard.
- Global Home should surface projects in risk state, open incidents, degraded monitors, recent alert firings, p95/p99 outliers, error-rate outliers, ingestion freshness issues, LLM cost outliers, and configuration gaps.
- Clicking a project from Global Home opens that project's workspace and defaults to `Operations`.
- Project Workspace destinations are `Operations`, `Analyze`, `Traces`, `Errors`, `Experiments`, and `Configure`.
- `Operations` is the default project dashboard and should summarize active incidents, monitors, alert state, error rate, p95/p99 latency, ingestion freshness, current release/deploy, and recommended drilldowns.
- `Analyze` owns event, tenant, user, funnel, retention, cohort, dashboard, and export workflows.
- `Traces` owns route grouping, p50/p95/p99, trace waterfall, span attributes, related errors/events, and release comparison.
- `Errors` owns issue inbox, error groups, raw occurrences, Incident view, source-map state, triage, resolve/ignore, and reopen workflows.
- `Experiments` is the future home for feature flags, A/B tests, prompt variants, model comparison, and quality/cost/latency analysis.
- `Configure` owns project-specific settings: environments, API keys, browser origins/CORS allowlist, SDK setup, source maps, alert rules/channels, and future project retention overrides.
- `Sigmon Admin` remains separate from project workspaces and is reserved for the SignalMonitor installation itself: system health, notifications, storage, security, deploy readiness, docs, SDK, and configuration health.
- The approved design spec for this architecture lives at `docs/superpowers/specs/2026-06-06-product-console-architecture-design.md`.

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
- The active environment is also selectable from the global header once environments are loaded, so operators can switch monitored environments without returning to Onboarding.
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
- Browser origins are configured inside Project Settings for the selected project. Operators can add exact app origins and archive old origins; saved origins enable direct browser SDK ingestion CORS for public `/v1/*` endpoints.
- Keep `Project Settings` as a project-scoped configuration mode for the selected project, environments, API keys, browser origins, SDK snippets, source maps, and the current console user administration surface.
- Project Settings opens on the `Project` section, where operators can rename or archive the selected project. Archive is a destructive action with confirmation and should stay visually separated from routine setup fields.
- Project Settings environment rows expose compact edit and archive actions. Onboarding keeps the lighter create/select flow, while recurring configuration lives in Project Settings.
- Project Settings starts with a compact setup checklist for the selected project/environment so operators can see whether project scope, environment, endpoint, one-time API key setup, SDK installation, SDK initialization, and first telemetry ping are ready before handing integration details to another developer. Pending integration steps expose compact command/code hints inline.
- Console user rows expose edit and archive actions. Editing supports email/admin role changes and optional temporary password rotation; archived users are removed from the active console user list after confirmation.
- Keep `System Health` inside Sigmon Admin as a quiet global operational mode for Sigmon service health, queue worker and scheduler liveness, deploy config readiness, queue depth, ingestion freshness, retention status, and backup status.
- Browser origin panels should show the currently configured global `BROWSER_CORS_ORIGINS` values so operators can validate browser SDK readiness without checking server env vars.
- System Health shows source-map retention policy and deleted counts inside the existing Retention card.
- System Health surfaces a read-only "System needs attention" banner for degraded queue probes, disabled/failed retention, and stale or failed backups; the banner points operators back to logs, EasyPanel, and the doctor CLI rather than exposing secrets or local paths.
- Overview is the first operational summary surface for the selected project/environment.
- Overview loads only while active and preserves its layout shape while loading.
- Overview window controls support `24h`, `7d`, and `30d`.
- Overview trend panels stay lightweight with in-app SVG/CSS, not a chart dependency. Trend charts should include grid context, metric-unit axis labels, stable empty states, color-consistent series, and legend values so sparse data does not read as broken.
- Overview shows a critical incident banner above KPIs when the selected environment has an open severe error, with a direct drilldown into the grouped Errors incident queue.
- Overview top-list rows can drill into Investigate with seeded exact filters; recent signals stay read-only.
- Investigation views are operational, dense, and read-only by default.
- Events use a list/detail layout with filters above the list and a detail drawer for selected records.
- Events should include an analytics header for the current result set: total events, unique event names, observed tenants, known users, and top event names before the raw rows, so the tab works as an initial product analytics explorer rather than only a log table.
- Event rows should prioritize event name, immutable id, timestamp, source, user, tenant, trace/session context, and compact property chips for quick scanning.
- Investigation detail drawers, event rows, filters, and aggregate strips should share the dark console surface language so raw telemetry inspection feels like one professional workspace.
- Filters apply only when the operator clicks `Apply`; typing does not auto-query.
- Missing project/environment state should point operators back to Setup.
- Keep Events and Errors as peer tabs inside `Investigate`.
- Errors default to grouped triage when opened from the top-level Investigate tab, making the error workspace an incident-response entry point before raw log inspection.
- Grouped Errors use a dense incident queue table with filters above the group list, operator-editable group status, occurrence/user/tenant counts, fingerprint context, release context, and a direct raw occurrence drilldown for the selected group.
- Grouped and raw error rows expose `Open incident` actions that navigate to a shareable incident URL for the selected error group and, when opened from a raw occurrence, preserve the raw error id as context.
- Incident view starts with a hero triage summary containing severity/status/priority, group, release, observed duration, assignee state, impact metrics, and only backend-supported primary actions such as resolve, ignore, and copy link.
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
- Trace detail uses a dense APM layout: selected trace summary, span health/operation/status analysis, lazily loaded span timing rows, selected/error highlighting, and a selected-span detail panel for timing, parent, cost, input/output/error, and metadata JSON without adding a chart dependency.
- Keep LLM as a peer tab with Events, Errors, and Traces inside `Investigate`.
- LLM uses the same filter/list/detail pattern, with a compact aggregate strip for calls, tokens, and total cost.
- LLM includes an analytics layer above the raw call list: cost by model, top tenants by LLM cost, prompt/model comparison with cost, calls, p95 latency and error signals, and prompt ranking with calls, cost, tokens, p95 latency, error rate, and last seen.
- LLM rows should prioritize provider/model, prompt, status, cost, tokens, latency, time, user, and tenant.
- LLM details should show immutable identifiers, cost and token fields, previews, error text, and metadata JSON.
- Keep Entities as a peer tab with Events, Errors, Traces, and LLM inside `Investigate`.
- Entities uses a tenant-first layout with a default `7d` window, impact-ranked tenant rows, and a selected-tenant detail panel.
- The Unassigned tenant bucket should be visible for context but disabled for drill-in.
- Entity details should show compact summary metrics, top users, and a cross-signal timeline from events, errors, traces, and LLM calls.
- Entity details include an operational profile for impact score, open/severe errors, and failed LLM calls, plus a timeline signal mix so operators can understand the current context before drilling into rows.
- Entity timeline rows should drill into the raw investigation tabs with seeded exact filters so operators can move from tenant context to source records.
- Entities surfaces should remain dark and scannable: sort buttons, selected tenant cards, metric tiles, filters, top-user tables, and timeline rows all inherit the console theme.
- Keep Users as a peer tab with Events, Errors, Traces, LLM, and Entities inside `Investigate`.
- Users uses a user-first layout with a default `7d` window, impact-ranked user rows, tenant/search filters, and a selected-user detail panel.
- The Anonymous / Unassigned user bucket should be visible for context but disabled for drill-in.
- User details should show compact summary metrics, recent sessions, and a cross-signal timeline from events, errors, traces, and LLM calls.
- User details mirror tenant detail with the same operational profile and timeline signal mix pattern for fast comparison.
- User timeline rows should drill into the raw investigation tabs with seeded exact filters so operators can move from user context to source records.
- Users surfaces should follow the same dark treatment as Entities, including disabled Anonymous rows, selected user cards, metric tiles, filters, sessions, and timeline rows.

## Operations UX

- `Global Home` is now the default console entry point. It is installation-wide and should not show project or environment selectors.
- `Global Home` ranks monitored projects by operational risk using available Operations rollups: active incidents, monitor failures, critical alerts, p95 latency, error-rate, and setup gaps.
- The primary lateral IA is split into `Global`, `Project Workspace`, and `Sigmon Admin`.
- `Project Workspace` keeps the operator path compact: Operations, Analyze, Traces, Errors, Experiments, and Configure.
- Legacy surfaces that are still useful but no longer primary, including Overview, Alerts, Monitors, Artifacts, and Onboarding, remain reachable through command palette compatibility while later product slices decide their permanent homes.
- Opening a project from Global Home should enter `Operations`, because this is the day-to-day operational cockpit for a monitored app.
- `Operations` is the project/environment cockpit for monitored application health. It is distinct from global `System` health.
- `Overview` remains the product and telemetry summary for the selected project/environment.
- `Operations` summarizes monitored health, alert state, p95 latency, error rate, ingestion freshness, and open incidents for the selected project/environment.
- `System Health` remains global Sigmon install health: API, Postgres, Redis, queue worker, scheduler, SMTP, retention, and backups.
- `Sigmon Admin` uses explicit installation-level destinations: System Health, Deploy, Notifications, Storage, Security, and Docs & SDK. System Health starts with an installation readiness strip for public endpoint, queue worker, scheduler, SMTP, backups, and retention.
- Operations is read-only in this slice. Drilldowns route to existing Monitors, Alerts, Investigate, and Incident views for action.
- Operations opens with recommended next actions ranked from incidents, monitor gaps, alert delivery, slow traces, and error-rate outliers so the operator has an immediate response path.
- Operations command cards should stay compact and scannable, with stable dimensions and no nested cards.

## Alerts UX

- Alerts should stay dense and operational: rules, channels, recent events, and delivery status should be visible without a marketing-style layout.
- Alerts open with an operational posture strip for firing alerts, delivery issues, enabled rules without channels, recent heat-strip activity, and setup suggestions.
- Alerts should keep summary counters and creation forms aligned in a compact grid, with dark inputs/selects and subdued empty states.
- Alert rule controls should remain scoped to the active project and environment.
- Alert rule fields should expose units in labels or nearby help: windows and cooldowns are minutes, error-rate thresholds are percentages, trace p95 thresholds are milliseconds, critical/error count thresholds are counts, and LLM cost thresholds are USD.
- Alert rule rows expose compact edit actions. Editing reuses the rule form, preserves project/environment scope, and should update the row after saving without forcing a full page refresh.
- Alert rule rows expose compact destructive actions; archiving requires confirmation and removes the rule from the active rule list.
- Generic webhook channel forms may accept a secret header name and value, but the saved secret value is write-only and should never be displayed after submission.
- Email notification channels are created from the same compact channel form and show recipients plus SMTP delivery status rather than webhook secret state.
- Notification channel rows expose compact edit actions. Editing reuses the channel form, keeps saved webhook secrets write-only, and should update the channel row without forcing a full page refresh.
- Notification channel rows expose compact destructive actions; archiving requires confirmation and removes the channel from active rule configuration lists.

## Monitors UX

- Monitors should stay separate from alert rules so uptime and heartbeat setup does not crowd threshold configuration.
- Monitors open with a posture strip for total/enabled monitors, down/degraded monitors, notification coverage, and the next coverage suggestion.
- Monitors uses a full-width monitor list followed by three balanced panels for recent checks, HTTP setup, and heartbeat setup.
- Monitor list rows use explicit columns for monitor identity, target, schedule, last check, status, and row actions so the full-width list earns its space.
- HTTP monitor rows should prioritize name, target URL, schedule, status, and last check time.
- Heartbeat monitor rows should prioritize name, check-in target, expected interval, grace window, status, and last check time.
- Monitor form labels should include units: check interval and heartbeat grace values are minutes, HTTP timeout is milliseconds.
- Monitor rows expose compact edit and delete actions. Editing uses a contextual form for the selected monitor type; deleting archives the monitor after confirmation while preserving historical checks.
- Heartbeat secrets are shown only immediately after monitor creation, paired with the check-in URL, and should not be stored in browser storage.
- Recent monitor checks should stay compact and show status, response or heartbeat marker, latency, and sanitized error text.

## Project Settings UX

- API key rows expose edit actions for renaming keys without rotating secrets; one-time key secrets remain visible only immediately after creation.

## Artifacts UX

- Artifacts should stay operational: release filter, single-map upload, bundle upload, uploaded artifact list, and delete actions should fit the active project/environment workspace.
- Artifacts uses two balanced upload panels plus a dark token-management surface; file inputs should look native to the console, not browser-default white controls.
- Artifacts includes compact source-map upload token management for the active project/environment. Token secrets are shown once after creation.
- Source-map upload token rows expose edit and revoke actions; renaming a token never rotates or re-displays the write-only secret.
- Upload controls should support single `.map` files and `.zip` bundles.
- Operators must provide release metadata because resolution uses strict release matching and does not guess across releases.
- Artifact rows should prioritize release, minified file, original filename, size, upload time, and a short delete action.

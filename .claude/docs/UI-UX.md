# UI and UX

SignalMonitor includes an admin-only Integration Console.

## Console Principles

- The console is an operational workspace, not a marketing page.
- The first screen focuses on projects, environments, API keys, snippets, connection status, and simple user administration.
- API key secrets are shown only immediately after creation and are not stored in browser storage.
- The visual style should remain compact, quiet, and optimized for repeated setup work.

## Investigation UX

- Keep `Setup`, `Overview`, and `Investigate` as separate top-level console modes.
- Keep `Alerts` as a compact operational mode for rules, generic webhook channels, recent alert history, and delivery status.
- Keep `Monitors` as a separate operational mode for HTTP uptime monitors, heartbeat monitors, recent checks, and one-time heartbeat secrets.
- Keep `Artifacts` as a compact admin mode for source-map upload, filtering, deletion, and CI upload token management for the active project/environment.
- Keep `System` as a quiet operational mode for service health, queue worker and scheduler liveness, deploy config readiness, queue depth, ingestion freshness, retention status, and backup status.
- System shows source-map retention policy and deleted counts inside the existing Retention card.
- Overview is the first operational summary surface for the selected project/environment.
- Overview loads only while active and preserves its layout shape while loading.
- Overview window controls support `24h`, `7d`, and `30d`.
- Overview trend panels stay lightweight with in-app SVG/CSS, not a chart dependency.
- Overview top-list rows can drill into Investigate with seeded exact filters; recent signals stay read-only.
- Investigation views are operational, dense, and read-only by default.
- Events use a list/detail layout with filters above the list and a detail drawer for selected records.
- Filters apply only when the operator clicks `Apply`; typing does not auto-query.
- Missing project/environment state should point operators back to Setup.
- Keep Events and Errors as peer tabs inside `Investigate`.
- Errors default to raw occurrences when opened from the top-level Investigate tab, and the error workspace also exposes grouped triage as a peer `Groups` view.
- Grouped Errors use a list/detail layout with filters above the group list, operator-editable group status, occurrence/user/tenant counts, fingerprint context, and a direct raw occurrence drilldown for the selected group.
- Grouped and raw error rows expose `Open incident` actions that navigate to a shareable incident URL for the selected error group and, when opened from a raw occurrence, preserve the raw error id as context.
- Incident view uses a split investigation layout: technical primary occurrence details, stack, source-map status, context, and metadata on the left; operational triage, related identifiers, strongly related activity, and nearby context on the right. It stacks before the console layout becomes cramped.
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
- Keep Users as a peer tab with Events, Errors, Traces, LLM, and Entities inside `Investigate`.
- Users uses a user-first layout with a default `7d` window, impact-ranked user rows, tenant/search filters, and a selected-user detail panel.
- The Anonymous / Unassigned user bucket should be visible for context but disabled for drill-in.
- User details should show compact summary metrics, recent sessions, and a cross-signal timeline from events, errors, traces, and LLM calls.
- User timeline rows should drill into the raw investigation tabs with seeded exact filters so operators can move from user context to source records.

## Alerts UX

- Alerts should stay dense and operational: rules, channels, recent events, and delivery status should be visible without a marketing-style layout.
- Alert rule controls should remain scoped to the active project and environment.
- Generic webhook channel forms may accept a secret header name and value, but the saved secret value is write-only and should never be displayed after submission.
- Email notification channels are created from the same compact channel form and show recipients plus SMTP delivery status rather than webhook secret state.

## Monitors UX

- Monitors should stay separate from alert rules so uptime and heartbeat setup does not crowd threshold configuration.
- HTTP monitor rows should prioritize name, target URL, status, and last check time.
- Heartbeat monitor rows should prioritize name, expected interval, grace window, status, and last check time.
- Heartbeat secrets are shown only immediately after monitor creation, paired with the check-in URL, and should not be stored in browser storage.
- Recent monitor checks should stay compact and show status, response or heartbeat marker, latency, and sanitized error text.

## Artifacts UX

- Artifacts should stay operational: release filter, single-map upload, bundle upload, uploaded artifact list, and delete actions should fit the active project/environment workspace.
- Artifacts includes compact source-map upload token management for the active project/environment. Token secrets are shown once after creation.
- Upload controls should support single `.map` files and `.zip` bundles.
- Operators must provide release metadata because resolution uses strict release matching and does not guess across releases.
- Artifact rows should prioritize release, minified file, original filename, size, upload time, and a short delete action.

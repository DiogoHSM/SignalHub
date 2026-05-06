# UI and UX

SignalHub includes an admin-only Integration Console.

## Console Principles

- The console is an operational workspace, not a marketing page.
- The first screen focuses on projects, environments, API keys, snippets, connection status, and simple user administration.
- API key secrets are shown only immediately after creation and are not stored in browser storage.
- The visual style should remain compact, quiet, and optimized for repeated setup work.

## Investigation UX

- Keep `Setup`, `Overview`, and `Investigate` as separate top-level console modes.
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
- Errors use the same list/detail drawer pattern as Events.
- Error rows should prioritize severity, status, message, and trace/session context.
- Error details should show stack, context JSON, metadata JSON, and immutable identifiers.
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

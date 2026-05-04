# UI and UX

SignalHub includes an admin-only Integration Console.

## Console Principles

- The console is an operational workspace, not a marketing page.
- The first screen focuses on projects, environments, API keys, snippets, connection status, and simple user administration.
- API key secrets are shown only immediately after creation and are not stored in browser storage.
- The visual style should remain compact, quiet, and optimized for repeated setup work.

## Investigation UX

- Keep `Setup` and `Investigate` as separate top-level console modes.
- Investigation views are operational, dense, and read-only by default.
- Events use a list/detail layout with filters above the list and a detail drawer for selected records.
- Filters apply only when the operator clicks `Apply`; typing does not auto-query.
- Missing project/environment state should point operators back to Setup.
- Keep Events and Errors as peer tabs inside `Investigate`.
- Errors use the same list/detail drawer pattern as Events.
- Error rows should prioritize severity, status, message, and trace/session context.
- Error details should show stack, context JSON, metadata JSON, and immutable identifiers.

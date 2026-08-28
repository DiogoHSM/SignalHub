# PER-474 — Reads não excluem escopo arquivado

Linear: PER-474 (child of PER-466). Branch: `diogohsm/per-474-archived-scope-reads`.

## Problem

`apps/api/src/routes/query.ts` has ~20+ handlers that resolve `filters.projectId`/`filters.environmentId`
(via `parseFilters`/path params) and pass them through `applyPrincipalScope(filters, principal)`, then run
a DB query. None of them check whether the resolved project or environment is archived.

The **write path already enforces this**: `findApiKeyByPrefix` (packages/db/src/repositories/admin.ts:359-376)
inner-joins `projects`/`environments` and requires `archived_at is null` on both.

The **read-token path is already safe too**: `findReadTokenByPrefix`
(packages/db/src/repositories/read-tokens.ts:100-117) does the identical inner-join + `archived_at is null`
check, and it re-runs on *every request* (via `verifyReadToken` in `apps/api/src/main.ts:1056`), so a read
token stops working the moment its project/environment is archived.

**The gap is `user` (human session) principals only.** A logged-in admin who knows/bookmarks a
project_id/environment_id that has since been archived can still read all its telemetry via query routes,
even though the project has disappeared from the console switcher. Low real-world impact (they could already
read it while active), but it's a real asymmetry with the write path and cheap to close.

## Fix shape

1. Add a lightweight repository check, e.g. `isScopeActive(db, projectId, environmentId): Promise<boolean>` in
   `packages/db/src/repositories/admin.ts` (or wherever projects/environments are already queried) — a single
   query joining `projects`/`environments` on id, both `archived_at is null`. Mirror the existing
   `findApiKeyByPrefix` join style.
2. Wire it into `apps/api/src/app.ts` as a new field on `QueryDependencies` (check the existing dependency
   wiring pattern — **remember the app.ts dependency whitelist pitfall**: a route can call an option that's
   typed but never passed from `main.ts`/`app.ts`, silently 501ing. Verify the new dependency is actually
   threaded through `app.ts` → `main.ts` end to end, with a test that would catch it being missing.)
3. In `apps/api/src/routes/query.ts`, only for `principal.kind === "user"` (read-token is already covered,
   don't double-query), after `filters = applyPrincipalScope(filters, principal)` resolves the final
   `projectId`/`environmentId`, call the new check. If inactive, respond `404` with a body shaped like the
   existing error convention in this file (check `read_token_is_read_only` / `invalid_query` / `query_unavailable`
   for the exact `{ error: "..." }` shape and status-code conventions already in use — pick a name consistent
   with them, e.g. `archived_scope`).
4. This must cover **every** handler that resolves a project/environment scope from query params — not just
   `handleListRoute`/`handleAggregateRoute`. Enumerate every call site of `applyPrincipalScope` in
   `apps/api/src/routes/query.ts` (currently ~20, grep `applyPrincipalScope(filters, principal)` and any
   route that resolves scope through a different path, e.g. `handleTraceSpansRoute`, single-entity-by-id
   routes) and confirm each one is covered. A single shared choke point (e.g. folding the check into
   `applyPrincipalScope` itself, or a thin wrapper every call site already calls) is strongly preferred over
   repeating the check at each site by hand — less surface to miss.
5. Do **not** touch the write path (already correct) or the read-token path (already correct) beyond
   confirming their existing behavior in a test.

## Tests (TDD — write first, confirm red, then fix)

- A query route (pick 2-3 representative ones: a list route, an aggregate route, and one non-standard route
  like `handleTraceSpansRoute` if it also needs it) returns 404/`archived_scope` for a `user` principal when
  `project_id`/`environment_id` refers to an archived project.
- Same for an archived *environment* under an otherwise-active project.
- A `read-token` principal is unaffected (still governed entirely by `verifyReadToken`'s existing behavior —
  no regression, no double-check needed).
- An **active** project/environment still returns data normally (no false positives).
- Update `apps/api/src/openapi.ts` / `apps/api/test/openapi-coverage.test.ts` only if the new check changes
  any route's documented response shape (it likely doesn't — same routes, new status code — but verify).

## Verification before handoff

```sh
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config --quiet
```

Then report back: files touched, whether every `applyPrincipalScope` call site is covered (list them), and
full test/build results. Do not push or open a PR — leave that for the parent session.

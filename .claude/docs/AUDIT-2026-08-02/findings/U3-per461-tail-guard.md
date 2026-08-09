# U3 — PER-461 "openapi-cauda-guard" audit

Unit: `git diff diogohsm/per-459-openapi-query-routes...diogohsm/per-461-openapi-cauda-guard`
(3 files, +522/-1: `apps/api/src/openapi.ts`, `apps/api/test/openapi-coverage.test.ts`, `apps/api/test/docs.test.ts`)

Audited by building a detached worktree at `diogohsm/per-461-openapi-cauda-guard`
(`/private/tmp/audit-per461/wt`), `pnpm install --frozen-lockfile --offline` against the
existing local pnpm store, then running the real test suite and several controlled mutations.
No source in the actual repo/branches was touched; all mutations were applied and reverted
inside the disposable worktree, which was removed at the end (see Cleanup).

## Findings

None rated crit/high. Two low-severity/observational items below; everything else audited is
recorded as solid with empirical evidence.

### F1 — low — governance — `apps/api/test/openapi-coverage.test.ts:125-135` (`DOCS_INFRA_ROUTES`)

`DOCS_INFRA_ROUTES` has no automated anti-rot or anti-abuse protection, unlike
`PENDING_ADMIN_ROUTES` which has (a) a comment restricting it to admin routes, (b) a live
"stale baseline" check that fails the build when an entry becomes documented, forcing deletion.
`DOCS_INFRA_ROUTES` has only a prose comment ("legitimately is not product surface") and the
guard's error message asks contributors to add entries "with justification" — nothing in the
test enforces that the entries are actually docs/SDK/console-config infra rather than an
arbitrary product route someone adds later to make the guard pass. In this PR the 9 entries are
verified legitimate (see Solid §3), but the structural gap remains for future changes.

**Why it matters**: the whole point of this guard is that a route that should be documented
cannot silently hide. `PENDING_ADMIN_ROUTES` closes that hole with the rot check;
`DOCS_INFRA_ROUTES` does not, so it is the easier of the two lists to abuse to "reach green"
without documenting a real product route.

**Suggested fix**: constrain `DOCS_INFRA_ROUTES` membership with a lightweight assertion, e.g.
every entry's path must start with one of a small fixed set of known-infra prefixes
(`/docs`, `/sdk`, `/openapi.json`, `/console/config`), so a future non-infra addition fails loud
instead of silently passing.

**Confidence**: 0.6 (real structural gap; not exploited in this PR).

### F2 — low — test coverage / scope — `apps/api/test/openapi-coverage.test.ts:187-190`

The guard's `buildApp(...)` call passes only `readiness` and `nodeEnv`; it omits
`options.console` (in particular `console.assetsDir`). Per `apps/api/src/app.ts:208-215`,
`registerConsoleRoutes` only registers `/console`, `/console/assets/*`, and `/console/*`
(the SPA catch-all) when `assetsDir` is set — confirmed empirically: the full `printRoutes()`
dump captured from this exact test setup (see Solid §1) shows only `/console/config`, never
`/console`, `/console/assets/*`, or `/console/*`. So this guard provides zero verification for
that route family. This is not a bug — those routes serve HTML/static assets and were never
meant to be in `openapi.json` — but a future reader could assume "the guard covers every
registered route" without qualification, which is not quite true.

**Suggested fix**: none required; optionally add a one-line comment noting the guard only
exercises the DI-independent route surface (which, per `app.ts`, is everything except
console static-serving).

**Confidence**: 0.3 (arguably not a finding, included for completeness per the audit brief).

## Solid — verified with empirical evidence

### 1. `printRoutes()` parser correctly reconstructs full paths, including depth > 3

Dumped the real `app.printRoutes({ commonPrefix: false })` output from this exact branch
(written via a temporary `apps/api/test/zzz-dump-routes.test.ts`, removed after use) to
`/private/tmp/audit-per461/routes-dump.txt` (154 lines). Manually traced the ancestry-stack
algorithm (`apps/api/test/openapi-coverage.test.ts:52-88`) against the deepest real routes in
the tree, e.g.:

```
├── /admin/projects (GET, HEAD, POST)
│   └── /:id|:projectId (GET, HEAD, PATCH, DELETE)
│       ├── /code-integrations (GET, HEAD, POST)
│       │   └── /:id (DELETE)   ← depth 3
```

Marker column for the depth-3 line is at char index 12 (`(12+4)/4-1 = 3`); `ancestry.join("")`
correctly produces `/admin/projects/:id|:projectId/code-integrations/:id`. The "4 chars per
level" assumption is not content-dependent (it's the box-drawing gutter width, constant
regardless of fragment length or route name), so it holds at any depth by construction — the
depth-3 case is the deepest real example in the app and it matches exactly.

### 2. Param-shape normalization does not over-normalize / does not cause missing-route masking

- `/a/{x}` vs `/a/{x}/{y}`-style cases: traced by hand — `pathShape` only merges consecutive
  `{...}` groups joined by literal `|` (i.e., Fastify's collapsed-sibling-param syntax
  `:id|:projectId`); params in different path segments (separated by `/`) are wildcarded
  independently and never collide.
- Empirically attacked the boundary case directly: injected a genuinely undocumented **static**
  sibling route, `GET /alerts/events/summary`, next to the already-documented param route
  `GET /alerts/events/{id}` (into `apps/api/src/routes/alerts.ts` in the worktree only). Reran
  the guard:

  ```
  × OpenAPI route coverage guard > documents every registered product route (PER-461)
  Error: 1 registered route(s) have no openapi.json entry and are not in an allowlist. ...
    - GET /alerts/events/summary
  ```

  Confirms static/param collisions do not mask a genuinely undocumented sibling. File reverted
  immediately after (`diff` against the pre-injection backup shows clean).

### 3. `DOCS_INFRA_ROUTES`'s 9 entries, including the two trailing-slash ones, are real and are infra

Confirmed both `GET /docs` and `GET /docs/` and both `GET /sdk` and `GET /sdk/` are distinct,
separately-registered routes (not fabricated) directly from the `printRoutes()` dump:

```
├── /docs (GET, HEAD)
│   └── / (GET, HEAD)
│       ├── openapi.json (GET, HEAD)
│       ├── openapi.yaml (GET, HEAD)
│       └── js/scalar.js (GET, HEAD)
├── /sdk (GET, HEAD)
│   └── / (GET, HEAD)
```

Traced to source: `apps/api/src/routes/docs.ts:11-16` mounts `@scalar/fastify-api-reference` at
`routePrefix: "/docs"`, which self-registers `/docs`, `/docs/`, and its asset routes
(`openapi.json`, `openapi.yaml`, `js/scalar.js` under the prefix). `apps/api/src/routes/sdk-docs.ts:1067-1071`
shows `/sdk` is a 301 redirect to `/sdk/`, which serves the SDK guide page — both real,
separately-registered infra routes, not smuggled to reach green. `/console/config`
(`apps/api/src/routes/console.ts:15-22`) returns only frontend bootstrap config (API base
path/endpoint, CORS origins, OAuth-enabled flag) — no secrets — and is legitimately infra, not
product data surface.

### 4. `PENDING_ADMIN_ROUTES` — all 36 entries verified genuine, count exact, no non-admin smuggling

Built a throwaway variant of the guard (`apps/api/test/zzz-dump-undocumented.test.ts`, emptied
`PENDING_ADMIN_ROUTES` to `[]`, dumped the raw undocumented-route list to
`/private/tmp/audit-per461/undocumented-raw.json` instead of throwing) and ran it against the
real app. The raw, independently-computed undocumented set is **exactly** 36 entries and is a
**verbatim, same-order match** to the `PENDING_ADMIN_ROUTES` list in
`apps/api/test/openapi-coverage.test.ts:146-183`. Every entry starts with `/admin/` — no
non-admin route is present in the list (the spec's stated ban on smuggling non-admin routes into
this allowlist is respected). File removed after use.

### 5. Stale-baseline check fires correctly when a `PENDING_ADMIN_ROUTES` entry becomes documented

Confirmed `GET /admin/monitors` is documented in `apps/api/src/openapi.ts:3192`. Added
`"GET /admin/monitors"` to `PENDING_ADMIN_ROUTES` in the worktree and reran the guard:

```
× OpenAPI route coverage guard > documents every registered product route (PER-461)
Error: 1 entry in PENDING_ADMIN_ROUTES (...) is now documented in openapi.json.
DELETE this entry from PENDING_ADMIN_ROUTES — the baseline has rotted, do not add it back.
  - GET /admin/monitors
```

File reverted after use (diff against backup clean).

### 6. Guard fails and names the exact missing route when a documented path is removed

Deleted the entire `"/alerts/suggestions": { ... }` path object from `apps/api/src/openapi.ts`
in the worktree and reran the guard:

```
× OpenAPI route coverage guard > documents every registered product route (PER-461)
Error: 1 registered route(s) have no openapi.json entry and are not in an allowlist. ...
  - GET /alerts/suggestions
```

File reverted after use (diff against backup clean).

### 7. The 8 documented tail routes match their real handlers exactly

- `POST /auth/logout` (`apps/api/src/routes/auth.ts:109-117`): no session/auth check at all,
  always clears cookie and returns `{ ok: true }` (200) — matches the doc's "Always returns
  success, including when no session was active."
- `GET /auth/google` (`auth.ts:130-149`): `reply.redirect(...)` with no explicit status ⇒
  Fastify default 302 — matches documented `302` + `Location` header.
- `GET /auth/google/callback` (`auth.ts:151-187`): `reply.send({ user })` on success (200 JSON,
  not a redirect); 400 on invalid query/state, 403 `google_oauth_user_not_allowed`, 404/501 when
  disabled/unconfigured, 503 on `catch` around `googleOAuth.complete` — matches every documented
  response code one-for-one.
- `GET /alerts/events`, `GET /alerts/events/{id}`, `PATCH /alerts/events/{id}/triage`,
  `GET /alerts/suggestions` (`apps/api/src/routes/alerts.ts:82-195`): all four call
  `requireHumanUser` first (401 `unauthenticated` if absent) — matches the `sessionRoute` /
  `Unauthorized` documentation. 501 when the repository dependency is absent, 400 on Zod
  validation failure, 404 (events/triage) when not found, 503 on repository error — every one
  matches the documented response set exactly.
- `GET /system/health/history` (`apps/api/src/routes/system.ts:222-237`): `requireUser` (401),
  501 when `system.getHistory` unavailable, 503 on error, 200 `{ data }` otherwise;
  `parseHistoryLimit` (`system.ts:156-160`) clamps to `[1, 480]` with default `60` — matches the
  documented `limit` schema (`minimum: 1, maximum: 480, default: 60`) and the `SystemHealthSample`
  schema fields line up with the mapped fields in `apps/api/src/main.ts:916-923`.

All four route-group registrations (`registerAuthRoutes`, `registerAlertRoutes`,
`registerSystemRoutes`, `registerAdminRoutes`) are called **unconditionally** in
`apps/api/src/app.ts:203-247` — route existence never depends on which DI options are passed, so
the guard's minimal `buildApp()` call sees the true production route surface for every group
except console static-serving (see F2).

### 8. HEAD/OPTIONS filtering does not mask real routes

Full `printRoutes()` dump shows `HEAD` only ever co-listed alongside `GET` (Fastify's automatic
HEAD-for-GET), never standalone; `OPTIONS` appears only on the `*` CORS-preflight catch-all,
which is separately excluded by the `!fullPath.startsWith("/")` check before method filtering
even applies. No orphan HEAD-only or OPTIONS-only route exists in the tree, so filtering these
two methods (`apps/api/test/openapi-coverage.test.ts:50`) drops nothing that needed independent
documentation.

### 9. Security/disclosure — clean

Read the full diff of all three files. No real secrets, hostnames, tenant/user IDs, or internal
operational details in any new schema, description, or example (`jsonBody("AlertEventTriagePatch",
{ status: "acknowledged" })` etc. are all generic).

### 10. Test hygiene — clean

`apps/api/test/openapi-coverage.test.ts` opens its own `FastifyInstance` per test and closes it
in `afterEach` (lines 11-16); it is the only test in the file, so there is no ordering
dependency within it. Ran it standalone and combined with `apps/api/test/docs.test.ts` — both
pass, no shared-state bleed, no lingering handles. Measured wall time: 59-85ms per run
(well under any reasonable timeout budget). `docs.test.ts`'s diff (`apps/api/test/docs.test.ts:95-106`)
is a pure additive change to the expected path-list array for the 8 new routes — reran that
file too, passes (6 tests, 146ms).

## What was run (for reproducibility)

```
git worktree add --detach /private/tmp/audit-per461/wt diogohsm/per-461-openapi-cauda-guard
cd /private/tmp/audit-per461/wt && pnpm install --frozen-lockfile --offline
npx vitest run apps/api/test/openapi-coverage.test.ts          # baseline: 1 passed
npx vitest run apps/api/test/openapi-coverage.test.ts apps/api/test/docs.test.ts  # both pass together
# + temporary zzz-dump-routes.test.ts to capture printRoutes() output (removed after)
# + temporary zzz-dump-undocumented.test.ts with PENDING_ADMIN_ROUTES emptied (removed after)
# + 3 controlled mutations (remove /alerts/suggestions path; add stale PENDING_ADMIN_ROUTES
#   entry; inject undocumented static sibling route), each reverted and diffed clean afterward
```

## Cleanup

```
git worktree remove /private/tmp/audit-per461/wt --force
rm -rf /private/tmp/audit-per461
```
(executed after this report was written; no changes were made to any tracked branch)

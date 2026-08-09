# U2 — PER-459 `/query/*` OpenAPI documentation audit

Branch: `diogohsm/per-459-openapi-query-routes`, commit `b343a528`.
Diff: `apps/api/src/openapi.ts` (+1847/-75), `apps/api/test/docs.test.ts` (+92).

## Method

Diffed `main...diogohsm/per-459-openapi-query-routes` to isolate the 22 net-new
`/query/*` path entries (`comm -13` on sorted path lists extracted from
`openapi.ts` on `main` vs the branch — see below). For each, read the real
handler in `apps/api/src/routes/query.ts`, its parameter-parsing helper, and
the backing repository function under `packages/db/src/repositories/`, and
compared every documented parameter (required/optional, enum, default),
request body, and response schema against the code. Also ran the extended
`apps/api/test/docs.test.ts` in an isolated git worktree (`/private/tmp/sm-audit-u2`,
removed after use) — all 6 tests pass. No source files were modified.

## Coverage — 22/22 new routes fully verified

Net-new `/query/*` paths (branch adds exactly 22 vs `main`; zero paths were
removed — `comm -23` on the same path lists is empty, so the "0 paths lost"
claim about the 75 deletions is independently confirmed, not just trusted).
The commit message says "23 routes"; the 23rd is best explained by
`error-groups/{id}` carrying two new operations (GET *and* PATCH) under one
path — a harmless counting nuance, not a documentation lie.

All 22 were checked handler-for-handler:

`aggregates/errors`, `aggregates/events`, `aggregates/llm`, `entities/tenants`,
`entities/tenants/{tenantKey}`, `error-groups` (list), `error-groups/{id}`
(GET+PATCH), `errors/{id}/source-map-resolution`, `events/paths`,
`incidents/error-groups/{id}`, `incidents/error-groups/{id}/notes`,
`incidents/error-groups/{id}/silence`, `incidents/mttr`, `llm/by-prompt`,
`llm/by-tenant`, `llm/cost-by-model`, `llm/summary`, `operations`,
`sessions/{sessionId}/timeline`, `traces/{id}/spans`, `users` (list),
`users/{userKey}`.

Additionally spot-checked the 7 pre-existing `/query/*` entries the diff
touches (`replays`, `replays/{replayId}`, `errors`, `llm-calls`, `traces`,
`incidents/error-groups/{id}/external-issues`, `.../external-issues/draft`):
all seven are byte-identical to `main`, just relocated by the reordering —
confirmed via direct block diff, not assumed.

Nothing could not be verified; every route in scope was checked against a
concrete handler/repository implementation.

## Result: no contract-lying defects found

Every specific risk called out in the brief was checked and the documentation
matches the code exactly:

- `/query/incidents/mttr` — window enum is `["7d","30d"]`, default `"7d"`, no
  `24h` (`apps/api/src/routes/query.ts:3013-3017` `parseMttrWindow`; doc at
  `apps/api/src/openapi.ts:5055-5065` states this explicitly, including a
  callout that this route's enum is narrower than others). **Confirmed true.**
- `llm/summary`, `llm/by-tenant`, `llm/by-prompt`, `llm/cost-by-model` default
  `window=24h` (`query.ts:960-978` `parseLlmAggregateFilters`); `entities/tenants`
  and `users` default `window=7d` (`query.ts:1367-1374`, `1545-1552`). Doc
  matches at `openapi.ts:5182,5226,5274,5323` (24h) vs `4461,4622` (7d).
  **Confirmed true.**
- Session timeline `limit`: route accepts 1-500 (shared `parseLimit`,
  `query.ts:486-503`) but the repository clamps to 1-200, default 100
  (`packages/db/src/repositories/session-timeline.ts:49-58`
  `DEFAULT_LIMIT=100`, `MAX_LIMIT=200`). The doc not only gets the numbers
  right but states the clamp explicitly in prose:
  `openapi.ts:4370-4375` — `"Accepted up to 500 by the route; the timeline
  repository clamps to 1..200 (default 100)."` **Confirmed true, and unusually
  well documented.**
- `/query/users` and `/query/entities/tenants` cursors are sort-bound: decode
  the cursor's embedded `sort` and reject (400) if it doesn't match the
  request's `sort` (`query.ts:1447-1475` `parseActivityListCursor`, used by
  both `parseEntityTenantListFilters` and `parseUserListFilters`). Doc
  describes this exactly at `openapi.ts:4477-4482` and `4638-4644`. By
  contrast `/query/entities/tenants/{tenantKey}` and `/query/users/{userKey}`
  use a *different*, non-sort-bound timeline cursor
  (`{timestamp,type,id}`, `query.ts:1408-1435`/`1586-1613`), and the doc
  correctly describes that cursor differently at `openapi.ts:4538-4543`/
  `4700-4704` (no sort-binding language). **Confirmed true, correctly
  distinguished.**
- `PATCH /query/error-groups/{id}` requires at least one of
  `status`/`priority`/`assignedToUserId`
  (`errorGroupTriageBodySchema.refine`, `query.ts:415-426`). Doc models this
  with `minProperties: 1` plus explicit prose on the `ErrorGroupTriagePatch`
  schema (`openapi.ts:951-954`) and on the operation description
  (`openapi.ts:3486`). **Confirmed true.**
- `POST .../notes` requires `body` (1-5000 chars, `triageNoteBodySchema`,
  `query.ts:428-430`) — doc's `TriageNoteInput` matches exactly
  (`openapi.ts:961-967`).
- `POST .../silence` requires `minutes` (nonnegative int, nullable —
  `silenceBodySchema`, `query.ts:432-434`, note `.nullable()` without
  `.optional()`, i.e. the key must be present even though it can be `null`).
  Doc's `SilenceIncidentInput` correctly marks `minutes` as `required`
  (`openapi.ts:968-977`) rather than the easy-to-get-wrong "optional because
  nullable" mistake. **Confirmed true.**
- Response schemas: cross-checked field-for-field against repository return
  types for `EntityTenantSummary`/`TenantSummary`
  (`entities-query.ts:49-70`), `EntityUserSummary`/`UserSummary`
  (`users-query.ts:50-71`), LLM aggregate rollups (`telemetry-query.ts:3780-3955`
  `getLlmSummary`/`getLlmByTenant`/`getLlmByPrompt`/`getLlmCostByModel`),
  `getErrorAggregates`/`getLlmAggregates`
  (`telemetry-query.ts:3726-3778`), `EventPathsResponse`
  (`telemetry-query.ts:355-391`), `SourceMapResolutionResponse`
  (`apps/api/src/source-maps/resolver.ts:5-26`), `SpanRecord`
  (`telemetry-query.ts:1087-1110`), and `getErrorGroupIncident`'s composite
  object (`packages/db/src/repositories/incidents.ts:706-803`, including the
  `notes`/`codeContext`/`externalIssues` fields). All matched field-for-field;
  no invented or missing required fields found.
- Auth: every one of the 22 routes builds its operation via
  `...sessionRoute(...)`, which unconditionally sets
  `security: [{ sessionCookie: [] }]` (`openapi.ts:119-129`). None override or
  omit it. No route is accidentally documented as public.
- Disclosure: scanned the full diff for secrets/tokens/internal hostnames/real
  tenant or user IDs (`grep` for API-key-shaped strings, `.internal`, private
  IP ranges, personal emails, Coolify/deploy hostnames). All examples use
  clearly fake placeholders (`prj_example`, `env_example`,
  `admin@example.com`, `ins_example`). No disclosure risk found.

## Findings

### F1 — low — completeness — `llm/by-tenant` and `llm/by-prompt` don't document their top-N cap
- **File/line**: `apps/api/src/openapi.ts:5222-5318` (descriptions); repo caps at
  `packages/db/src/repositories/telemetry-query.ts:3842` (`limit 10`, by-tenant)
  and `:3884` (`limit 20`, by-prompt).
- **Evidence**: `getLlmByTenant` orders by cost and hard-limits to the top 10
  tenants; `getLlmByPrompt` hard-limits to the top 20 prompt/model pairs.
  Neither cap is mentioned in the operation description or response schema
  (which just says `type: "array"` with no `maxItems`/note).
- **Why it matters**: A project with >10 active tenants or >20 prompts will
  silently see a truncated list with no indication in the docs that more data
  exists — a reader could reasonably conclude the array is exhaustive. Lower
  stakes than a wrong parameter, but it's the same "spec that quietly hides
  behavior" failure mode the task is hunting for, just on the response side
  instead of the request side.
- **Suggested fix**: Add a sentence to both descriptions, e.g. "Returns at
  most the top 10 tenants by cost" / "top 20 prompt/model pairs by cost", and
  optionally `maxItems: 10`/`20` on the array schema.
- **Confidence**: 0.75

### F2 — low — completeness — inconsistent `default` annotation on the shared `limit` parameter
- **File/line**: `apps/api/src/openapi.ts:4233` (`/query/events/paths` `limit`)
  and `:3529` (`/query/error-groups/{id}/errors` `limit`) omit
  `default: 50`; sibling routes using the same underlying `parseLimit()`
  helper (e.g. `/query/error-groups` at `openapi.ts:3426`) do include it.
- **Evidence**: `parseLimit` (`apps/api/src/routes/query.ts:486-503`) always
  defaults to 50 regardless of route; the two routes above just don't say so.
- **Why it matters**: Minor, but it's the kind of small inconsistency that
  erodes trust once a reader notices the same parameter documented two
  different ways in the same spec.
- **Suggested fix**: Add `default: 50` to both parameter schemas.
- **Confidence**: 0.6

### F3 — medium — test quality — `docs.test.ts` deep-pins only a minority of the 22 new routes
- **File/line**: `apps/api/test/docs.test.ts:44-324` (the single large `it`
  block covering all path/schema assertions).
- **Evidence**: The path-existence array (`toEqual(expect.arrayContaining([...]))`,
  lines 69-98) covers all 22 new paths, which is good. But concrete,
  regression-catching assertions (parameter lists, enums, required arrays,
  security) are only added for a subset: `/query/users` (params + sort enum +
  required), `/query/entities/tenants` (params + sort enum),
  `/query/error-groups/{id}` PATCH (security + requestBody ref + patch
  schema properties), `/query/incidents/error-groups/{id}/notes` (requestBody
  ref + required), `/query/incidents/error-groups/{id}/silence` (requestBody
  ref + required), `/query/incidents/mttr` (window enum),
  `/query/traces/{id}/spans` (param list), `/query/error-groups/{id}/errors`
  (params + response shape — this one is actually a pre-existing route, not
  new), `/query/message-campaigns/{id}/results` (security only). That leaves
  `aggregates/errors|events|llm`, `llm/summary|by-tenant|by-prompt|cost-by-model`,
  `operations`, `events/paths`, `entities/tenants/{tenantKey}`,
  `users/{userKey}`, `error-groups` (list), `error-groups/{id}` GET, and
  `errors/{id}/source-map-resolution` — 12 of the 22 — with only a "path
  exists" check and no assertion on their parameters, enums, defaults, or
  response shape.
- **Why it matters**: For those 12 routes, a future edit that silently
  changes e.g. a window default, drops a required parameter, or renames a
  response field would pass CI. The test currently proves the *initial*
  commit is correct (which I independently verified by hand); it does much
  less to keep it correct going forward for most of the routes it claims to
  cover.
- **Suggested fix**: Add at minimum one pinned assertion per route in the
  gap list — e.g. the `window` enum/default for the four `llm/*` and
  `operations`/`aggregates/*` routes (this is exactly where the `24h` vs `7d`
  default distinction the commit message brags about could silently regress
  undetected), and the `required` array on `error-groups` list / `error-groups/{id}`
  GET response.
- **Confidence**: 0.75

## What's solid (worth recording, not re-litigating)

- Zero `/query/*` paths were dropped by the reindentation (`comm -23` on
  extracted path sets is empty) — independently verified, not taken on trust.
- All three mutation request bodies (`ErrorGroupTriagePatch`,
  `TriageNoteInput`, `SilenceIncidentInput`) match their zod schemas exactly,
  including the subtle "required but nullable" `minutes` field and the
  "at least one of three optional fields" refine on the PATCH body.
- The MTTR `7d|30d`-only enum, the `llm/*` 24h-vs-`entities`/`users` 7d
  default split, and the session-timeline 500→200 clamp — the three specific
  claims called out in the commit message — are all independently verified
  true against the handler/repository code, not just repeated from the
  commit message.
- The keyset cursor sort-binding on `/query/users` and `/query/entities/tenants`
  is documented accurately, and correctly distinguished from the
  non-sort-bound timeline cursor used on the two `{key}` detail routes — a
  detail an unfaithful copy-paste job would likely have gotten wrong.
- Ran the actual test suite (`apps/api/test/docs.test.ts`) against the real
  branch in an isolated worktree: 6/6 tests pass.
- No secrets, internal hostnames, or real tenant/user identifiers found
  anywhere in the added documentation or examples.
- Auth (`security: [{ sessionCookie: [] }]`) is present on every one of the 22
  new routes via the shared `sessionRoute()` helper; none are accidentally
  documented as public.

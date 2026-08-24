# Implementation plan — `@sigmon/mcp` (PER-479)

Full design: `.claude/plans/2026-08-22-mcp-sigmon-design.md`. This plan only breaks the design into ordered, testable tasks. Read the design doc first — it has the decisions and the "why"; this file has the "what, in what order".

Branch: `diogohsm/per-479-sigmon-mcp`. Test-first per task: write the failing test, then the code, then move on. Do not touch files outside your assigned task's scope.

## Ground rules for every task

- New package `packages/mcp`, mirroring `packages/cli`'s conventions: `"private": true`, `"type": "module"`, `tsconfig.json` extending `../../tsconfig.base.json`, `build`/`lint`/`test` scripts matching `packages/cli/package.json`.
- Config is two env vars: `SIGMON_URL` (Sigmon instance base URL) and `SIGMON_READ_TOKEN` (the `shread_...` secret). No other config surface.
- Auth header: `Authorization: Bearer ${SIGMON_READ_TOKEN}`.
- Do not guess route shapes. For every `/query/*` route you call, read its handler in `apps/api/src/routes/query.ts` and its OpenAPI entry in `apps/api/src/openapi.ts` for the real query params and response shape.
- Tests live in `packages/mcp/src/**/*.test.ts` (root `vitest.config.ts` already globs `packages/**/*.test.ts` — no config change needed).
- `pnpm --filter @sigmon/mcp build` and the relevant vitest file must pass before you consider a task done. Do not run the full monorepo `pnpm test` mid-task — that's the final verification step, not a per-task one.

## Task 1 — Package scaffold + typed HTTP client (`client.ts`)

Foundation. Everything else depends on this — do it alone, first.

1. Scaffold `packages/mcp/package.json`, `tsconfig.json`, `src/` per the conventions above. Dependencies: `@modelcontextprotocol/sdk` (latest, currently `^1.30.0`), `zod` (already a workspace dependency elsewhere — check `packages/telemetry/package.json` for the pinned range and match it). Bin: `sigmon-mcp` → `./dist/stdio.js`.
2. `src/client.ts`: one typed async method per `/query/*` route actually used by the nine tools (full list is in the design doc's "As nove tools" table — resolve each cell to its concrete route path). Each method takes typed params, sends the bearer header, and returns the typed response shape read from the real handler/OpenAPI entry. Centralize error mapping here (see Task 5's error contract — implement the 401/403/scope-mismatch → named-error mapping in the client so every tool gets it for free) — coordinate the exact error shape with Task 5 by reading the design doc's "Erros" section now; don't invent your own.
3. Write `client.test.ts` against a mocked `fetch` (inject via constructor option, same pattern `@sigmon/sdk`'s client uses for testability — check `packages/sdk/src/client.ts`) covering: a successful call, a 401, a 403, and one route with query params serialized correctly.

Commit: `feat(mcp): scaffold package and typed query client (PER-479)`.

## Task 1b — `GET /query/me` (principal scope introspection)

Added after Task 1 surfaced a real gap: no `/query/*` route exposes a read-token principal's own `projectId`/`environmentId` back to the caller. `requireQueryPrincipal` (`apps/api/src/routes/query.ts:1693`) already resolves this internally on every request — it just never returns it. Without this, `describe_scope` (Task 3) has nothing to call for its "projeto/environment do token" cell.

Add `GET /query/me`, guarded by the same `requireQueryPrincipal`, returning:

```ts
{ kind: "user" } | { kind: "read-token", projectId: string, environmentId: string }
```

IDs only — no project/environment name lookup (that data lives in the admin resources, out of `/query/*`'s reach by design; an ID is enough for the tool to be correct, a name is a nice-to-have that isn't worth reaching across the boundary for).

Requirements: OpenAPI entry in `apps/api/src/openapi.ts` (the coverage test fails otherwise), a test in `apps/api/test/query.test.ts` covering both principal kinds, and one new method on `packages/mcp/src/client.ts` (`getPrincipalScope()` or similar) using it. This route is read-only and adds no new constraint beyond what PER-478 already established — no `CONSTRAINTS.md` change needed unless review finds otherwise.

Commit: `feat(api): expose read-token principal scope via GET /query/me (PER-479)`.

## Task 2 — Response budget / truncation (`budget.ts`)

Depends on Task 1 only for the package scaffold (tsconfig, test runner) — no dependency on `client.ts`'s content, can start once Task 1's scaffold exists.

Implement the contract from the design doc's "Orçamento de resposta" section:

- A pruning function that caps an array field at an explicit per-section line limit (conservative default — pick one and document why in a comment, e.g. 20).
- Field-level pruning: full stack traces, raw event payloads, and full span bodies are dropped unless the caller passes an explicit opt-in parameter.
- When anything was pruned, the returned payload carries `truncated: { section, returned, total, how_to_get_more }`.

Write `budget.test.ts` proving: under-cap input passes through unpruned with no `truncated` field; over-cap input gets pruned to the cap and carries a correct `truncated` block; an opt-in flag defeats the default field pruning for stack/payload/span-body fields.

Commit: `feat(mcp): response budget and truncation contract (PER-479)`.

## Task 3 — Tools, batch A: `describe_scope`, `whats_broken`, `investigate_error`, `trace_request`

Depends on Tasks 1 and 2 being merged/committed. Runs independently of batch B.

One file per tool under `src/tools/`, each exporting the tool's MCP schema (name, description, input schema) and its handler, composing the client methods listed in the design doc's table for that tool. Route every list-shaped field in the response through `budget.ts`'s pruning. Map client errors to the tool-level error contract (401/403/scope-mismatch messages from the design doc's "Erros" section — do not write new wording).

`describe_scope` special case: it reads project/environment identity off the token's own scope (returned by the API on any authenticated call, or by a dedicated introspection route if one exists — check `apps/api/src/routes/query.ts` for how a read-token principal's scope is exposed) plus `/query/events/properties` and `/query/releases`. If there's no existing way to introspect a token's own scope from `/query/*`, say so in your final report instead of inventing an endpoint.

One test file per tool (`src/tools/<name>.test.ts`) against a fake client (not real HTTP): assert route composition (right methods called with right params) and assert `truncated` appears when a fake oversized response is fed through.

Commit: `feat(mcp): describe_scope, whats_broken, investigate_error, trace_request tools (PER-479)`.

## Task 4 — Tools, batch B: `slow_endpoints`, `user_journey`, `llm_costs`, `search_events`, `query`

Same shape and rules as Task 3, independent of it — depends only on Tasks 1 and 2.

`query` is the escape hatch: its input schema takes a `metric` enum (`events | errors | llm | traces | trends` — confirm the exact set against `/query/aggregates/*` and `/query/analytics/trends`) and composes the matching aggregate/trends route. This tool's tests should cover at least two different `metric` values to prove the dispatch, not just one.

Commit: `feat(mcp): slow_endpoints, user_journey, llm_costs, search_events, query tools (PER-479)`.

## Task 5 — Server registry + stdio entrypoint + error contract

Depends on Tasks 3 and 4 both being done — this assembles all nine tools.

1. `src/server.ts`: registers all nine tools against the `@modelcontextprotocol/sdk` server, transport-agnostic (no stdio-specific code here — that's what makes fase 3's HTTP transport a same-file addition later, not a rewrite).
2. `src/stdio.ts`: the `sigmon-mcp` bin entrypoint — reads `SIGMON_URL`/`SIGMON_READ_TOKEN` from env, fails fast with a readable message if either is missing, constructs the client and server, and connects the stdio transport.
3. Confirm the error contract end-to-end: a 401 from the API surfaces through the client, through any tool, through the server, as the exact message from the design doc ("token inválido ou revogado; gere outro em Project Settings → Read tokens") — no raw stack, no internal detail. Same for 403 and scope-mismatch. If Task 1 already centralized this in `client.ts`, this task just needs a test proving it survives the full stack unchanged.

Test: `server.test.ts` — server exposes exactly nine tools by the names in the design doc's table, and a fake-401 round-trip through the server returns the readable message, not a raw error.

Commit: `feat(mcp): server registry, stdio entrypoint, end-to-end error contract (PER-479)`.

## Task 6 — Docs (do this last, after Tasks 1-5 are all committed)

Update, each with real content from what was actually built (not aspirational):

- `.claude/docs/DECISIONS.md` — ADR: why a new package instead of folding tools into the console or API; why stdio-first.
- `.claude/docs/ARCHITECTURE.md` — `@sigmon/mcp` as a `/query/*` consumer, same trust boundary as a human session but read-token-scoped.
- `.claude/docs/SECRETS.md` — `SIGMON_URL`, `SIGMON_READ_TOKEN` (sanitized description, no real values).
- `.claude/docs/CONSTRAINTS.md` — only if Task 5 surfaced a constraint not already covered by the existing read-token constraints (PER-478 already added the read-token-is-read-only and scope-override constraints; don't duplicate them).
- `.claude/GUARDRAILS.md` — one row: touching `packages/mcp/**` → read `ARCHITECTURE.md` (the query surface it depends on) before changing tool composition.
- `.claude/docs/PROJECT-SUMMARY.md` — one line, new capability.
- `.claude/docs/STACK.md` — new package entry.

Commit: `docs: document @sigmon/mcp (PER-479)`.

## Final verification (after all six tasks, before opening a PR)

```sh
pnpm --filter @sigmon/mcp build
pnpm --filter @sigmon/mcp lint
pnpm test
pnpm build
docker compose config --quiet
```

All green before this is considered done. Do not open the PR — that step waits for explicit confirmation in the main session.

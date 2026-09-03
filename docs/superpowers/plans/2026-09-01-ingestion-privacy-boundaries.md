# Ingestion and Privacy Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict identity mutation to server keys, make recursive telemetry stack-safe and bounded, redact stored URLs, and require two explicit gates for MCP raw detail.

**Architecture:** Add a persisted key capability at the authentication boundary, an iterative JSON preflight/sanitizer in `@sigmon/telemetry`, and one URL sanitizer used by SDK, worker, DB read/backfill, and MCP. MCP raw detail is enabled only when process configuration and tool input both opt in.

**Tech Stack:** TypeScript, Zod 4, Fastify 5, Kysely/PostgreSQL, React, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-01-ingestion-privacy-boundaries-design.md`

## Global Constraints

- Existing API keys migrate to `browser`; ordinary telemetry remains accepted, while identify requires a new `server` key.
- General JSON limits are depth 8, nodes 2,048, keys 512, array length 512, with cycles rejected.
- Replay data keeps its stricter existing limits.
- URL fragments are removed and every query value becomes `[REDACTED]` at both SDK and server boundaries.
- Raw MCP detail requires `MCP_ALLOW_RAW_DETAIL=true` and `includeRawDetail=true`; redaction and response budgets always remain active.
- No raw URL, secret, rejected recursive value, or account identifier may be added to logs.

---

### Task 1: Iterative JSON bounds and sanitizer

**Files:**
- Create: `packages/telemetry/src/json-bounds.ts`
- Modify: `packages/telemetry/src/ingestion-schemas.ts`
- Modify: `packages/telemetry/src/sanitization.ts`
- Test: `packages/telemetry/test/ingestion-schemas.test.ts`
- Test: `packages/telemetry/test/sanitization.test.ts`

**Interfaces:**
- Produces: `inspectJsonBounds(value, bounds): JsonBoundsResult`, `generalTelemetryJsonBounds`, and iterative `sanitizeValue(value)`.
- Consumes: existing replay-specific validation and `SanitizedValue` public type.

- [ ] **Step 1: Write failing bound tests**

Add cases that construct objects iteratively, not with recursive test helpers:

```ts
it("rejects metadata before Zod traverses more than eight containers", () => {
  let value: Record<string, unknown> = { leaf: true };
  for (let depth = 0; depth < 9; depth += 1) value = { child: value };
  const result = eventPayloadSchema.safeParse({ name: "deep", metadata: value });
  expect(result.success).toBe(false);
  expect(result.error?.issues[0]?.message).toContain("8 container levels");
});

it("rejects arrays wider than 512 items", () => {
  const result = eventPayloadSchema.safeParse({ name: "wide", metadata: { values: Array(513).fill(1) } });
  expect(result.success).toBe(false);
});
```

Add sanitizer tests for a 20,000-level input, a cycle, sensitive nested keys, and ordinary arrays/objects.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/telemetry/test/ingestion-schemas.test.ts packages/telemetry/test/sanitization.test.ts`

Expected: FAIL because general schemas recurse without the shared preflight and `sanitizeValue` overflows or lacks cycle handling.

- [ ] **Step 3: Implement the iterative inspector**

Use this closed interface:

```ts
export type JsonBounds = { maxDepth: number; maxNodes: number; maxKeys: number; maxArrayLength: number };
export type JsonBoundsViolation = "depth" | "nodes" | "keys" | "array_length" | "cycle";
export type JsonBoundsResult = { ok: true } | { ok: false; violation: JsonBoundsViolation; path: Array<string | number> };
export const generalTelemetryJsonBounds: JsonBounds = {
  maxDepth: 8,
  maxNodes: 2_048,
  maxKeys: 512,
  maxArrayLength: 512
};
export function inspectJsonBounds(value: unknown, bounds: JsonBounds): JsonBoundsResult;
```

Traverse with an explicit enter/exit stack and `WeakSet` active/completed tracking. Add one `z.unknown().superRefine(...)` preflight intersection before every recursive JSON schema. Keep `preflightReplayPayload` after the general preflight.

Rewrite `sanitizeValue` with an explicit work stack that creates a new output graph, replaces sensitive-key values with `[REDACTED]`, and throws `unsafe_recursive_value:<violation>` for bounds/cycles rather than truncating.

- [ ] **Step 4: Verify GREEN and compatibility**

Run: `pnpm vitest run packages/telemetry/test/ingestion-schemas.test.ts packages/telemetry/test/sanitization.test.ts`

Expected: PASS, including all existing replay fixtures.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry/src/json-bounds.ts packages/telemetry/src/ingestion-schemas.ts packages/telemetry/src/sanitization.ts packages/telemetry/test/ingestion-schemas.test.ts packages/telemetry/test/sanitization.test.ts
git commit -m "fix(telemetry): bound recursive ingestion values"
```

### Task 2: Persist and expose API-key capability

**Files:**
- Create: `packages/db/migrations/0048_api_key_capabilities.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/repositories/admin.ts`
- Modify: `apps/api/src/routes/api-key-auth.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/main.ts`
- Test: `packages/db/test/repositories.test.ts`
- Test: `apps/api/test/admin.test.ts`

**Interfaces:**
- Produces: `ApiKeyCapability = "browser" | "server"`; `ApiKeyScope.capability`; admin create input requiring `capability`.
- Consumes: current prefix/hash lookup and project/environment scope enforcement.

- [ ] **Step 1: Write failing repository and admin contract tests**

```ts
it("migrates and creates keys with an explicit capability", async () => {
  const created = await createApiKeyRecord(db, {
    projectId, environmentId, name: "backend", prefix: "sh_live_ab", hash: "hash", capability: "server"
  });
  expect(created.capability).toBe("server");
});

it("requires capability when creating an API key", async () => {
  const response = await app.inject({ method: "POST", url: `/admin/projects/${projectId}/api-keys`, payload: { environmentId, name: "missing" } });
  expect(response.statusCode).toBe(400);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/db/test/repositories.test.ts apps/api/test/admin.test.ts`

Expected: FAIL because the column and request field do not exist.

- [ ] **Step 3: Add migration and types**

Migration contract:

```sql
alter table api_keys add column capability text not null default 'browser';
alter table api_keys add constraint api_keys_capability_check check (capability in ('browser', 'server'));
```

Update `ApiKeysTable`, `ApiKeyRecord`, row mapping, create input, key lookup, and `ApiKeyScope`. The API response includes capability but never hash.

- [ ] **Step 4: Update the admin create schema**

```ts
const createApiKeySchema = z.object({
  environmentId: idSchema,
  name: z.string().trim().min(1).max(120),
  capability: z.enum(["browser", "server"])
});
```

Pass the field through `main.ts` into `createApiKeyRecord`.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm vitest run packages/db/test/repositories.test.ts apps/api/test/admin.test.ts`

Expected: PASS with migrated keys represented as browser keys.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations/0048_api_key_capabilities.sql packages/db/src/schema.ts packages/db/src/repositories/admin.ts packages/db/test/repositories.test.ts apps/api/src/routes/api-key-auth.ts apps/api/src/routes/admin.ts apps/api/src/main.ts apps/api/test/admin.test.ts
git commit -m "feat(auth): add ingestion key capabilities"
```

### Task 3: Enforce server-only identify and update clients

**Files:**
- Modify: `apps/api/src/routes/identify.ts`
- Modify: `apps/api/test/identify.test.ts`
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/v2/screens/settings/ProjectSettingsSection.tsx`
- Modify: `apps/console/src/v2/screens/settings/ProjectSettingsSection.test.tsx`
- Modify: `apps/console/src/v2/screens/SetupScreen.tsx`
- Modify: `apps/console/src/v2/screens/SetupScreen.test.tsx`
- Modify: `docs/HTTP-INGESTION.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `ApiKeyScope.capability` from Task 2.
- Produces: browser/server selection in admin UI and `403 api_key_capability_forbidden` on identify.

- [ ] **Step 1: Write failing identify tests**

```ts
it("forbids a valid browser key from mutating a user profile", async () => {
  const response = await app.inject({ method: "POST", url: "/v1/identify/user", headers: bearer, payload: validUser });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: "api_key_capability_forbidden" });
  expect(identifyUser).not.toHaveBeenCalled();
});
```

Keep a sibling test proving a server key returns `202`.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/test/identify.test.ts`

Expected: FAIL because both capabilities currently reach persistence.

- [ ] **Step 3: Add the route guard**

After valid key verification and before payload parsing/persistence:

```ts
if (scope.capability !== "server") {
  return reply.status(403).send({ error: "api_key_capability_forbidden" });
}
```

- [ ] **Step 4: Update console types and forms**

Add `capability: "browser" | "server"` to `ApiKey`/`CreatedApiKey` and the client create input. Settings exposes an explicit selector with browser as the initial value and explanatory copy. Setup always requests `browser` because its generated snippet is client-side ingestion.

- [ ] **Step 5: Run focused API and console tests**

Run: `pnpm vitest run apps/api/test/identify.test.ts apps/console/src/v2/screens/settings/ProjectSettingsSection.test.tsx apps/console/src/v2/screens/SetupScreen.test.tsx apps/console/src/v2/ConsoleShellV2.test.tsx`

Expected: PASS; update existing mock expectations to include `capability: "browser"` only where the production call now sends it.

- [ ] **Step 6: Document rotation and commit**

Document that upgraded keys are browser-safe and server identify integrations must create/rotate a server key.

```bash
git add apps/api/src/routes/identify.ts apps/api/test/identify.test.ts apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/v2/screens/settings/ProjectSettingsSection.tsx apps/console/src/v2/screens/settings/ProjectSettingsSection.test.tsx apps/console/src/v2/screens/SetupScreen.tsx apps/console/src/v2/screens/SetupScreen.test.tsx apps/console/src/v2/ConsoleShellV2.test.tsx docs/HTTP-INGESTION.md README.md
git commit -m "fix(ingestion): require server keys for identify"
```

### Task 4: Redact feedback URLs at every boundary

**Files:**
- Modify: `packages/telemetry/src/sanitization.ts`
- Modify: `packages/telemetry/test/sanitization.test.ts`
- Modify: `packages/sdk/src/mapping.ts`
- Modify: `packages/sdk/test/mapping.test.ts`
- Modify: `packages/sdk/src/browser-feedback-widget.ts`
- Modify: `packages/sdk/test/browser-feedback-widget.test.ts`
- Modify: `apps/worker/src/telemetry-worker.ts`
- Modify: `apps/worker/test/telemetry-worker.test.ts`
- Create: `scripts/redact-feedback-urls.ts`
- Create: `scripts/redact-feedback-urls.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `sanitizeTelemetryUrl(value: string | undefined): string | undefined` and `pnpm privacy:redact-feedback-urls`.
- Consumes: feedback `page_url`/`path` fields and DB repository update primitives.

- [ ] **Step 1: Write failing URL sanitizer tests**

```ts
expect(sanitizeTelemetryUrl("https://app.test/reset?token=abc&next=%2Fhome#done"))
  .toBe("https://app.test/reset?token=%5BREDACTED%5D&next=%5BREDACTED%5D");
expect(sanitizeTelemetryUrl("/callback?code=secret#fragment"))
  .toBe("/callback?code=%5BREDACTED%5D");
```

Include duplicate keys, blank values, malformed absolute URLs, and URLs without query/fragment.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/telemetry/test/sanitization.test.ts`

Expected: FAIL because `sanitizeTelemetryUrl` is not exported.

- [ ] **Step 3: Implement and apply the helper**

Use `URL` with a fixed dummy base for relative inputs; fall back to delimiter removal if parsing fails. Replace each search-param value through `URLSearchParams.set`, clear `hash`, and preserve absolute versus relative shape.

Call it in `createFeedbackSignal`, widget capture, and worker `insertFeedbackItem`. Add regression assertions that the worker sanitizes a raw queued payload from an old SDK.

- [ ] **Step 4: Implement the restartable maintenance command test-first**

Define:

```ts
export async function redactFeedbackUrlBatch(input: {
  listBatch: (afterId: string | null, limit: number) => Promise<Array<{ id: string; pageUrl: string | null; path: string | null }>>;
  update: (id: string, values: { pageUrl?: string; path?: string }) => Promise<void>;
  batchSize: number;
}): Promise<{ scanned: number; updated: number }>;
```

Test two batches, restart after a last id, already-safe rows, and count-only output. Wire the command to the DB without printing row values.

- [ ] **Step 5: Verify all URL paths**

Run: `pnpm vitest run packages/telemetry/test/sanitization.test.ts packages/sdk/test/mapping.test.ts packages/sdk/test/browser-feedback-widget.test.ts apps/worker/test/telemetry-worker.test.ts scripts/redact-feedback-urls.test.ts`

Expected: PASS with no query value or fragment in assertions.

- [ ] **Step 6: Commit**

```bash
git add packages/telemetry/src/sanitization.ts packages/telemetry/test/sanitization.test.ts packages/sdk/src/mapping.ts packages/sdk/test/mapping.test.ts packages/sdk/src/browser-feedback-widget.ts packages/sdk/test/browser-feedback-widget.test.ts apps/worker/src/telemetry-worker.ts apps/worker/test/telemetry-worker.test.ts scripts/redact-feedback-urls.ts scripts/redact-feedback-urls.test.ts package.json
git commit -m "fix(privacy): redact telemetry URL values"
```

### Task 5: Gate and redact MCP raw detail

**Files:**
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/test/config.test.ts`
- Modify: `.env.example`
- Modify: `packages/mcp/src/budget.ts`
- Modify: `packages/mcp/src/budget.test.ts`
- Modify: `packages/mcp/src/server.ts`
- Modify: `packages/mcp/src/server.test.ts`
- Modify: `packages/mcp/src/tools/investigate_error.ts`
- Modify: `packages/mcp/src/tools/user_journey.ts`
- Modify: corresponding MCP tool tests
- Modify: `README.md`

**Interfaces:**
- Produces: `config.mcp.allowRawDetail`; `FieldPruneOptions.allowRawDetail`; output metadata `{ rawDetailIncluded: true }`.
- Consumes: per-tool `includeRawDetail` input and `sanitizeTelemetryUrl`.

- [ ] **Step 1: Write failing double-gate tests**

```ts
it("prunes raw fields when only the tool call opts in", () => {
  expect(pruneSensitiveFields({ stack: "secret" }, { includeRawDetail: true, allowRawDetail: false }))
    .toEqual({});
});

it("keeps redacted, budgeted raw fields when both gates opt in", () => {
  const value = pruneSensitiveFields(
    { pageUrl: "https://x.test/?token=abc", stack: "trace" },
    { includeRawDetail: true, allowRawDetail: true }
  );
  expect(value).toEqual({ pageUrl: "https://x.test/?token=%5BREDACTED%5D", stack: "trace" });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/mcp/src/budget.test.ts packages/mcp/src/server.test.ts`

Expected: FAIL because process authorization is not part of pruning.

- [ ] **Step 3: Add config and central enforcement**

Parse `MCP_ALLOW_RAW_DETAIL` with the existing boolean env pattern, default false. Construct tool handlers with a server-level `allowRawDetail`; every handler passes both flags to budget/pruning. Raw output adds `rawDetailIncluded: true` only when both gates are true. Recursively sanitize sensitive keys and URL-like fields before budget calculation.

- [ ] **Step 4: Update all affected tool tests and documentation**

For each tool with `includeRawDetail`, prove default pruning, per-call-only pruning, and double-opt-in redacted output. Document the external-AI disclosure risk beside the env flag.

- [ ] **Step 5: Verify GREEN and build**

Run: `pnpm vitest run packages/mcp/src/budget.test.ts packages/mcp/src/server.test.ts packages/mcp/src/tools/investigate_error.test.ts packages/mcp/src/tools/user_journey.test.ts packages/mcp/src/tools/search_events.test.ts packages/mcp/src/tools/trace_request.test.ts packages/config/test/config.test.ts`

Run: `pnpm --filter @sigmon/mcp build`

Expected: all PASS and build exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/config/src/index.ts packages/config/test/config.test.ts .env.example packages/mcp/src/budget.ts packages/mcp/src/budget.test.ts packages/mcp/src/server.ts packages/mcp/src/server.test.ts packages/mcp/src/tools packages/mcp/src/tools/*.test.ts README.md
git commit -m "fix(mcp): require process opt-in for raw detail"
```

### Task 6: Slice verification and decision record

**Files:**
- Modify: `.claude/docs/DECISIONS.md`
- Modify: `docs/HTTP-INGESTION.md`

**Interfaces:**
- Consumes: every contract produced by Tasks 1–5.
- Produces: documented migration/rollback procedure and verification evidence for PER-504/PER-505.

- [ ] **Step 1: Record the compatibility decision**

Add a dated decision stating that legacy keys become browser capability, identify requires server capability, and URL/MCP privacy is enforced server-side.

- [ ] **Step 2: Run the focused malicious and legitimate controls**

Run: `pnpm vitest run packages/telemetry/test packages/sdk/test apps/api/test/identify.test.ts apps/api/test/ingestion.test.ts apps/api/test/admin.test.ts apps/worker/test/telemetry-worker.test.ts packages/mcp/src packages/config/test/config.test.ts scripts/redact-feedback-urls.test.ts`

Expected: PASS. Specifically confirm browser identify `403`, server identify `202`, deep input `400`, ordinary telemetry `202`, and URL/MCP redaction assertions.

- [ ] **Step 3: Run owning-package checks**

Run: `pnpm --filter @sigmon/telemetry build`

Run: `pnpm --filter @sigmon/sdk build`

Run: `pnpm --filter @sigmon/api build`

Run: `pnpm --filter @sigmon/worker build`

Run: `pnpm --filter @sigmon/mcp build`

Expected: every command exits 0.

- [ ] **Step 4: Inspect the complete slice diff**

Run: `git diff --check HEAD~5..HEAD`

Run: `git diff --stat HEAD~5..HEAD`

Confirm the diff contains only PER-504/PER-505 scope plus required docs/migration.

- [ ] **Step 5: Commit documentation**

```bash
git add .claude/docs/DECISIONS.md docs/HTTP-INGESTION.md
git commit -m "docs(security): record ingestion privacy boundaries"
```

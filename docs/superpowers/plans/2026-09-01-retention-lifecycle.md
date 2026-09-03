# Retention and Archived-Scope Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete telemetry according to one effective scoped cutoff per category and reject heartbeat writes after any parent scope is archived.

**Architecture:** Replace global-first deletion with category-owned SQL that derives the effective retention days from governance policy or installation default. Strengthen heartbeat lookup and the locking write transaction with active project/environment joins.

**Tech Stack:** TypeScript, Kysely/PostgreSQL, Fastify, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-01-retention-lifecycle-design.md`

## Global Constraints

- A scoped value replaces the installation default for that scope and category, whether shorter or longer.
- `session_replays` belongs only to the replay category.
- Table and timestamp identifiers remain closed allowlists; only values are parameterized.
- Heartbeat monitor, environment, and project activity is rechecked inside the write transaction.
- Destructive tests assert surviving rows on both sides of cutoffs.

---

### Task 1: Effective retention policy resolver

**Files:**
- Create: `packages/db/src/repositories/effective-retention.ts`
- Create: `packages/db/src/repositories/effective-retention.test.ts`
- Modify: `packages/db/src/repositories/system.ts`

**Interfaces:**
- Produces: `RetentionCategory`, `retentionCategorySpecs`, and `effectiveRetentionDays(policy, category, defaults)`.
- Consumes: `normalizeGovernanceRetentionPolicy` and `RetentionExecutionOptions` defaults.

- [ ] **Step 1: Write failing pure tests**

```ts
it("uses a longer scoped override instead of the installation default", () => {
  expect(effectiveRetentionDays({ events: 90 }, "events", { events: 30 })).toBe(90);
});

it("uses the default when the category is absent", () => {
  expect(effectiveRetentionDays({ clicks: 7 }, "events", { events: 30 })).toBe(30);
});

it("assigns session_replays only to replays", () => {
  expect(retentionCategorySpecs.filter((item) => item.table === "session_replays").map((item) => item.category))
    .toEqual(["replays"]);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/db/src/repositories/effective-retention.test.ts`

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement closed category mappings**

Define exact table/timestamp/counter mappings in a `satisfies readonly RetentionCategorySpec[]` constant. The resolver returns `policy[category] ?? defaults[category]` and never coerces zero/invalid data; normalization handles that before resolution.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm vitest run packages/db/src/repositories/effective-retention.test.ts`

```bash
git add packages/db/src/repositories/effective-retention.ts packages/db/src/repositories/effective-retention.test.ts packages/db/src/repositories/system.ts
git commit -m "refactor(retention): define category ownership"
```

### Task 2: Scoped effective-cutoff deletion

**Files:**
- Modify: `packages/db/src/repositories/system.ts`
- Modify: `packages/db/test/repositories.test.ts`
- Modify: `apps/worker/test/event-rollups.test.ts`

**Interfaces:**
- Consumes: Task 1 category mappings.
- Produces: `deleteExpiredTelemetry` using a single owner/query path per physical table.

- [ ] **Step 1: Add failing survival fixtures**

Create three project/environment scopes and timestamped rows:

```ts
// default 30d; scoped A 90d; scoped B 7d; unconfigured C
expect(await rowExists("events", scopedA60DaysOld)).toBe(true);
expect(await rowExists("events", scopedB8DaysOld)).toBe(false);
expect(await rowExists("events", unconfigured31DaysOld)).toBe(false);
expect(await countDeleteAudit("session_replays", replay40DaysOld)).toBe(1);
```

Run retention once and assert every named survivor/deletion plus exact counters.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/db/test/repositories.test.ts -t "effective retention"`

Expected: FAIL because the global pass deletes the 60-day scoped-A row and replay ownership overlaps.

- [ ] **Step 3: Replace global-first deletion**

For each category spec, delete batches whose timestamp is older than:

```sql
now - make_interval(days => coalesce(
  nullif((data_governance_policies.retention_policy ->> $category)::int, 0),
  $defaultDays
))
```

Join policy by project/environment with a left join. Keep the existing bounded batch loop and `RetentionDeleteError` partial-count behavior. Remove `session_replays` from the events path.

- [ ] **Step 4: Verify GREEN and regression behavior**

Run: `pnpm vitest run packages/db/test/repositories.test.ts apps/worker/test/event-rollups.test.ts`

Expected: PASS; rollup retention assumptions remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/repositories/system.ts packages/db/test/repositories.test.ts apps/worker/test/event-rollups.test.ts
git commit -m "fix(retention): honor effective scoped cutoffs"
```

### Task 3: Archived-parent heartbeat enforcement

**Files:**
- Modify: `packages/db/src/repositories/monitors.ts`
- Modify: `apps/api/src/routes/monitors.ts`
- Modify: `apps/api/test/monitors.test.ts`
- Modify: `packages/db/test/repositories.test.ts`

**Interfaces:**
- Produces: active-scope heartbeat lookup and transactional `recordHeartbeatCheckIn` returning null after archival.
- Consumes: existing `404 heartbeat_monitor_not_found` and `401 invalid_heartbeat_secret` contracts.

- [ ] **Step 1: Write failing archival and race tests**

```ts
it.each(["monitor", "environment", "project"])("returns 404 after %s archival", async (scope) => {
  await archiveFixture(scope);
  const response = await heartbeat(app, monitorId, secret);
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: "heartbeat_monitor_not_found" });
});
```

At repository level, lock/read the heartbeat, archive the environment in the test-controlled transition, then prove no monitor check or timestamp is written.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/test/monitors.test.ts packages/db/test/repositories.test.ts -t "heartbeat"`

Expected: parent archival cases or the race still write.

- [ ] **Step 3: Add active joins in both boundaries**

Lookup and transactional select join `environments` and `projects`, require their ids to match the monitor scope, and require all three `archived_at` columns null. Keep `forUpdate()` on the monitor row and return null if no active row exists.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm vitest run apps/api/test/monitors.test.ts packages/db/test/repositories.test.ts`

```bash
git add packages/db/src/repositories/monitors.ts apps/api/src/routes/monitors.ts apps/api/test/monitors.test.ts packages/db/test/repositories.test.ts
git commit -m "fix(monitors): reject archived-scope heartbeats"
```

### Task 4: Documentation and slice verification

**Files:**
- Modify: `.claude/docs/DECISIONS.md`
- Modify: `README.md`
- Modify: `apps/console/src/v2/screens/settings/ProjectSettingsSection.tsx`
- Modify: `apps/console/src/v2/screens/settings/ProjectSettingsSection.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: corrected retention precedence copy and final PER-503 evidence.

- [ ] **Step 1: Add failing copy assertion**

Assert the settings UI says scoped values override installation defaults, not that installation values are a hard maximum.

- [ ] **Step 2: Update decision and UI/docs**

Supersede the 2026-07-02 hard-maximum sentence, document longer/shorter/absent examples, and warn operators to review longer policies before upgrade.

- [ ] **Step 3: Run focused and package verification**

Run: `pnpm vitest run packages/db/src/repositories/effective-retention.test.ts packages/db/test/repositories.test.ts apps/api/test/monitors.test.ts apps/worker/test apps/console/src/v2/screens/settings/ProjectSettingsSection.test.tsx`

Run: `pnpm --filter @sigmon/db build`

Run: `pnpm --filter @sigmon/api build`

Run: `pnpm --filter @sigmon/worker build`

Expected: all PASS/exit 0, with explicit survivor and archived-race assertions.

- [ ] **Step 4: Commit**

```bash
git add .claude/docs/DECISIONS.md README.md apps/console/src/v2/screens/settings/ProjectSettingsSection.tsx apps/console/src/v2/screens/settings/ProjectSettingsSection.test.tsx
git commit -m "docs(retention): define scoped override semantics"
```

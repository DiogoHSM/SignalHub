# Incident View and Error UX Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated, shareable error-first Incident view and refine the Errors workflow so operators can move from grouped/raw errors into a professional split investigation experience.

**Architecture:** Add nullable priority override to `error_groups`, then add a focused incident aggregation repository and `/query/incidents/error-groups/:id` API route. The console gets typed client methods, lightweight URL handling for incident routes, a split Incident view, and polished Errors entry points without adopting a full router or redesigning unrelated console areas.

**Tech Stack:** Fastify 5, Kysely/Postgres, React, TypeScript, Vitest, Testing Library, existing CSS, Playwright visual verification.

---

## File Structure

- Create `packages/db/migrations/0011_error_group_priority.sql`: nullable priority column and check constraint.
- Modify `packages/db/src/schema.ts`: add `ErrorGroupPriority` and nullable `priority` on `ErrorGroupsTable`.
- Modify `packages/db/src/repositories/error-groups.ts`: expose priority, support triage update, keep status-only compatibility.
- Create `packages/db/src/repositories/incidents.ts`: aggregate one error group incident with primary occurrence, suggested priority, source-map cache, strong context, and nearby context.
- Modify `packages/db/test/repositories.test.ts`: priority and incident repository coverage.
- Modify `apps/api/src/routes/query.ts`: parse incident route, priority, and triage body.
- Modify `apps/api/src/main.ts`: wire incident repository and extended triage update.
- Modify `apps/api/test/query.test.ts`: API contract tests for incident route and priority update.
- Modify `apps/console/src/api/types.ts`: incident, priority, and timeline item types.
- Modify `apps/console/src/api/client.ts`: incident route builders and triage update client.
- Modify `apps/console/src/api/client.test.ts`: route encoding tests.
- Create `apps/console/src/components/PriorityBadge.tsx`: shared priority badge.
- Create `apps/console/src/components/IncidentView.tsx`: route-level incident screen.
- Create `apps/console/src/components/IncidentSummary.tsx`: first-fold incident summary.
- Create `apps/console/src/components/IncidentTriagePanel.tsx`: status and priority controls.
- Create `apps/console/src/components/IncidentTechnicalPanel.tsx`: occurrence, stack, source-map, metadata/context.
- Create `apps/console/src/components/IncidentTimeline.tsx`: strongly related and nearby context timelines.
- Modify `apps/console/src/components/ConsoleShell.tsx`: lightweight incident URL state and navigation.
- Modify `apps/console/src/components/ErrorGroupsPanel.tsx`: pass incident opener into list and detail.
- Modify `apps/console/src/components/ErrorGroupList.tsx`: badges and `Open incident` action.
- Modify `apps/console/src/components/ErrorGroupDetail.tsx`: priority/status display and `Open incident`.
- Modify `apps/console/src/components/ErrorRawOccurrencesPanel.tsx`: pass incident opener to raw list/detail.
- Modify `apps/console/src/components/ErrorList.tsx`: `Open incident` action when `errorGroupId` exists.
- Modify `apps/console/src/components/ErrorDetailDrawer.tsx`: incident action from raw detail.
- Modify `apps/console/src/styles.css`: incident layout, badges, timeline, and Errors polish.
- Modify `.claude/docs/ARCHITECTURE.md`, `.claude/docs/UI-UX.md`, and `README.md`: document Incident view and priority triage.

## Shared Names And Types

Use these names consistently across tasks:

```ts
export type ErrorGroupPriority = "urgent" | "high" | "normal" | "low";
export type ErrorGroupPriorityValue = ErrorGroupPriority | null;

export type IncidentTimelineKind = "breadcrumb" | "event" | "error" | "trace" | "span" | "llm";
export type IncidentTimelineConfidence = "strong" | "nearby";
```

Priority ordering for display and sorting:

```ts
const priorityRank: Record<ErrorGroupPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3
};
```

Suggested priority rules for the first implementation:

- `urgent`: severity is `fatal` or `critical`, or affected tenants >= 3, or affected users >= 25.
- `high`: severity is `error`, occurrence count >= 10, or last regression exists within the last 24 hours.
- `normal`: severity is `warning` or occurrence count >= 2.
- `low`: everything else.

## Task 1: Persist Error Group Priority

**Files:**
- Create: `packages/db/migrations/0011_error_group_priority.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/repositories/error-groups.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write failing repository tests for priority**

In `packages/db/test/repositories.test.ts`, extend the error group tests near existing `updateErrorGroupStatus` coverage.

Add imports if missing:

```ts
import {
  getErrorGroup,
  listErrorGroups,
  updateErrorGroupTriage
} from "../src/repositories/error-groups.js";
```

Add these tests:

```ts
it("stores and returns error group priority overrides", async () => {
  const timestamp = new Date("2026-05-24T12:00:00.000Z");
  const group = await seedGroupedError(db, {
    id: "err_priority_1",
    projectId: "prj_priority",
    environmentId: "env_priority",
    message: "Priority smoke failure",
    severity: "critical",
    timestamp
  });

  const updated = await updateErrorGroupTriage(db, {
    id: group.id,
    projectId: "prj_priority",
    environmentId: "env_priority",
    status: "investigating",
    priority: "urgent",
    now: new Date("2026-05-24T12:05:00.000Z")
  });

  expect(updated).toMatchObject({
    id: group.id,
    status: "investigating",
    priority: "urgent"
  });

  const loaded = await getErrorGroup(db, {
    id: group.id,
    projectId: "prj_priority",
    environmentId: "env_priority"
  });
  expect(loaded?.priority).toBe("urgent");

  const [listed] = await listErrorGroups(db, {
    projectId: "prj_priority",
    environmentId: "env_priority"
  });
  expect(listed.priority).toBe("urgent");
});

it("clears an error group priority override", async () => {
  const group = await seedGroupedError(db, {
    id: "err_priority_clear_1",
    projectId: "prj_priority_clear",
    environmentId: "env_priority_clear",
    message: "Priority clear smoke failure",
    severity: "error",
    timestamp: new Date("2026-05-24T12:00:00.000Z")
  });

  await updateErrorGroupTriage(db, {
    id: group.id,
    projectId: "prj_priority_clear",
    environmentId: "env_priority_clear",
    priority: "high",
    now: new Date("2026-05-24T12:01:00.000Z")
  });

  const cleared = await updateErrorGroupTriage(db, {
    id: group.id,
    projectId: "prj_priority_clear",
    environmentId: "env_priority_clear",
    priority: null,
    now: new Date("2026-05-24T12:02:00.000Z")
  });

  expect(cleared?.priority).toBeNull();
});
```

Create this helper in the same test file near the existing grouping helpers:

```ts
async function seedGroupedError(db: Db, input: {
  id: string;
  projectId: string;
  environmentId: string;
  message: string;
  severity: string;
  timestamp: Date;
}) {
  await sql`
    insert into projects (id, name)
    values (${input.projectId}, ${input.projectId})
    on conflict (id) do nothing
  `.execute(db);
  await sql`
    insert into environments (id, project_id, name)
    values (${input.environmentId}, ${input.projectId}, 'production')
    on conflict (id) do nothing
  `.execute(db);
  await insertError(db, {
    id: input.id,
    projectId: input.projectId,
    environmentId: input.environmentId,
    message: input.message,
    severity: input.severity,
    timestamp: input.timestamp,
    receivedAt: input.timestamp
  });
  const groups = await listErrorGroups(db, {
    projectId: input.projectId,
    environmentId: input.environmentId
  });
  const group = groups[0];
  expect(group).toBeDefined();
  return group;
}
```

- [ ] **Step 2: Run failing priority tests**

Run:

```sh
pnpm test packages/db/test/repositories.test.ts -t "priority"
```

Expected: FAIL because `updateErrorGroupTriage` and `priority` are not implemented.

- [ ] **Step 3: Add migration**

Create `packages/db/migrations/0011_error_group_priority.sql`:

```sql
alter table error_groups
  add column priority text;

alter table error_groups
  add constraint error_groups_priority_check
  check (priority is null or priority in ('urgent', 'high', 'normal', 'low'));
```

- [ ] **Step 4: Update schema type**

In `packages/db/src/schema.ts`, add:

```ts
export type ErrorGroupPriority = "urgent" | "high" | "normal" | "low";
```

In `ErrorGroupsTable`, add:

```ts
priority: ErrorGroupPriority | null;
```

- [ ] **Step 5: Update error group repository**

In `packages/db/src/repositories/error-groups.ts`, add:

```ts
export type ErrorGroupPriority = "urgent" | "high" | "normal" | "low";
export type ErrorGroupPriorityInput = ErrorGroupPriority | null;
```

Add `priority` to `ErrorGroupRecord`:

```ts
priority: ErrorGroupPriority | null;
```

Add `priority: row.priority` in `toGroup`.

Replace or wrap status update with a triage update:

```ts
export async function updateErrorGroupTriage(
  db: Db,
  input: {
    id: string;
    projectId: string;
    environmentId: string;
    status?: ErrorGroupStatus;
    priority?: ErrorGroupPriorityInput;
    now?: Date;
  }
): Promise<ErrorGroupRecord | null> {
  const now = input.now ?? new Date();
  const patch: {
    status?: ErrorGroupStatus;
    priority?: ErrorGroupPriorityInput;
    resolved_at?: Date | null;
    ignored_at?: Date | null;
    updated_at: Date;
  } = { updated_at: now };

  if (input.status !== undefined) {
    patch.status = input.status;
    patch.resolved_at = input.status === "resolved" ? now : null;
    patch.ignored_at = input.status === "ignored" ? now : null;
  }

  if ("priority" in input) {
    patch.priority = input.priority ?? null;
  }

  const row = await db
    .updateTable("error_groups")
    .set(patch)
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .returningAll()
    .executeTakeFirst();

  return row ? toGroup(row) : null;
}

export async function updateErrorGroupStatus(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; status: ErrorGroupStatus; now?: Date }
): Promise<ErrorGroupRecord | null> {
  return updateErrorGroupTriage(db, input);
}
```

- [ ] **Step 6: Run priority tests**

Run:

```sh
pnpm test packages/db/test/repositories.test.ts -t "priority"
```

Expected: PASS.

- [ ] **Step 7: Commit priority persistence**

```sh
git add packages/db/migrations/0011_error_group_priority.sql packages/db/src/schema.ts packages/db/src/repositories/error-groups.ts packages/db/test/repositories.test.ts
git commit -m "feat: add error group priority"
```

## Task 2: Incident Repository

**Files:**
- Create: `packages/db/src/repositories/incidents.ts`
- Modify: `packages/db/test/repositories.test.ts`

- [ ] **Step 1: Write failing incident repository tests**

In `packages/db/test/repositories.test.ts`, import:

```ts
import {
  getErrorGroupIncident,
  suggestErrorGroupPriority
} from "../src/repositories/incidents.js";
```

Add tests:

```ts
it("calculates suggested incident priority from group impact", () => {
  expect(
    suggestErrorGroupPriority({
      severity: "critical",
      occurrenceCount: 1,
      affectedUsersCount: 1,
      affectedTenantsCount: 1,
      lastRegressedAt: null,
      now: new Date("2026-05-24T12:00:00.000Z")
    })
  ).toBe("urgent");

  expect(
    suggestErrorGroupPriority({
      severity: "error",
      occurrenceCount: 10,
      affectedUsersCount: 1,
      affectedTenantsCount: 1,
      lastRegressedAt: null,
      now: new Date("2026-05-24T12:00:00.000Z")
    })
  ).toBe("high");

  expect(
    suggestErrorGroupPriority({
      severity: "warning",
      occurrenceCount: 1,
      affectedUsersCount: 1,
      affectedTenantsCount: 1,
      lastRegressedAt: null,
      now: new Date("2026-05-24T12:00:00.000Z")
    })
  ).toBe("normal");
});

it("returns an incident with a scoped primary occurrence", async () => {
  const group = await seedGroupedError(db, {
    id: "err_incident_primary",
    projectId: "prj_incident",
    environmentId: "env_incident",
    message: "Incident primary failure",
    severity: "critical",
    timestamp: new Date("2026-05-24T12:00:00.000Z")
  });

  const incident = await getErrorGroupIncident(db, {
    groupId: group.id,
    projectId: "prj_incident",
    environmentId: "env_incident",
    errorId: "err_incident_primary",
    now: new Date("2026-05-24T12:10:00.000Z")
  });

  expect(incident).toMatchObject({
    group: { id: group.id },
    primaryOccurrence: { id: "err_incident_primary", errorGroupId: group.id },
    priority: null,
    suggestedPriority: "urgent"
  });
});

it("separates strongly related and nearby incident context", async () => {
  const timestamp = new Date("2026-05-24T12:00:00.000Z");
  const group = await seedGroupedError(db, {
    id: "err_incident_context",
    projectId: "prj_incident_context",
    environmentId: "env_incident_context",
    message: "Incident context failure",
    severity: "error",
    timestamp
  });

  await sql`
    update errors
    set user_id = 'user_1',
        tenant_id = 'tenant_1',
        session_id = 'session_1',
        trace_id = 'trace_1'
    where id = 'err_incident_context'
  `.execute(db);
  await insertEvent(db, {
    id: "evt_strong_session",
    projectId: "prj_incident_context",
    environmentId: "env_incident_context",
    name: "checkout.clicked",
    timestamp: new Date("2026-05-24T11:59:00.000Z"),
    receivedAt: new Date("2026-05-24T11:59:01.000Z"),
    userId: "user_1",
    tenantId: "tenant_1",
    sessionId: "session_1"
  });
  await insertEvent(db, {
    id: "evt_nearby_user",
    projectId: "prj_incident_context",
    environmentId: "env_incident_context",
    name: "checkout.started",
    timestamp: new Date("2026-05-24T11:58:00.000Z"),
    receivedAt: new Date("2026-05-24T11:58:01.000Z"),
    userId: "user_1",
    tenantId: "tenant_1"
  });

  const incident = await getErrorGroupIncident(db, {
    groupId: group.id,
    projectId: "prj_incident_context",
    environmentId: "env_incident_context",
    errorId: "err_incident_context",
    now: new Date("2026-05-24T12:10:00.000Z")
  });

  expect(incident?.stronglyRelated.items.map((item) => item.id)).toContain("evt_strong_session");
  expect(incident?.nearbyContext.items.map((item) => item.id)).toContain("evt_nearby_user");
  expect(incident?.nearbyContext.items.map((item) => item.id)).not.toContain("evt_strong_session");
});
```

- [ ] **Step 2: Run failing incident repository tests**

Run:

```sh
pnpm test packages/db/test/repositories.test.ts -t "incident"
```

Expected: FAIL because `repositories/incidents.ts` has not been implemented yet.

- [ ] **Step 3: Create incident repository types and priority suggestion**

Create `packages/db/src/repositories/incidents.ts`:

```ts
import { sql } from "kysely";
import type { Db } from "../client.js";
import type { ErrorGroupPriority, ErrorGroupRecord } from "./error-groups.js";
import { getErrorGroup } from "./error-groups.js";
import type { ErrorRecord } from "./telemetry-query.js";

export type IncidentTimelineKind = "breadcrumb" | "event" | "error" | "trace" | "span" | "llm";
export type IncidentTimelineConfidence = "strong" | "nearby";

export type IncidentTimelineItem = {
  id: string;
  kind: IncidentTimelineKind;
  confidence: IncidentTimelineConfidence;
  timestamp: Date;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  release: string | null;
  title: string;
  level: string | null;
  data: unknown;
};

export type IncidentContextSection = {
  items: IncidentTimelineItem[];
  truncated: boolean;
};

export type ErrorGroupIncident = {
  group: ErrorGroupRecord;
  primaryOccurrence: ErrorRecord;
  priority: ErrorGroupPriority | null;
  suggestedPriority: ErrorGroupPriority;
  sourceMapResolution: { status: "cached"; frameCount: number } | { status: "none" };
  stronglyRelated: IncidentContextSection;
  nearbyContext: IncidentContextSection;
  related: {
    traceId: string | null;
    sessionId: string | null;
    userId: string | null;
    tenantId: string | null;
    release: string | null;
  };
};
```

Add `suggestErrorGroupPriority`:

```ts
export function suggestErrorGroupPriority(input: {
  severity: string;
  occurrenceCount: number;
  affectedUsersCount: number;
  affectedTenantsCount: number;
  lastRegressedAt: Date | null;
  now?: Date;
}): ErrorGroupPriority {
  const now = input.now ?? new Date();
  const regressedRecently =
    input.lastRegressedAt !== null && now.getTime() - input.lastRegressedAt.getTime() <= 24 * 60 * 60 * 1000;

  if (
    input.severity === "fatal" ||
    input.severity === "critical" ||
    input.affectedTenantsCount >= 3 ||
    input.affectedUsersCount >= 25
  ) {
    return "urgent";
  }

  if (input.severity === "error" || input.occurrenceCount >= 10 || regressedRecently) {
    return "high";
  }

  if (input.severity === "warning" || input.occurrenceCount >= 2) {
    return "normal";
  }

  return "low";
}
```

- [ ] **Step 4: Add primary occurrence helper**

In `incidents.ts`, add:

```ts
async function getPrimaryOccurrence(
  db: Db,
  input: { group: ErrorGroupRecord; errorId?: string }
): Promise<ErrorRecord | null> {
  const targetErrorId = input.errorId ?? input.group.latestErrorId;
  if (!targetErrorId) return null;

  const row = await db
    .selectFrom("errors")
    .selectAll()
    .where("id", "=", targetErrorId)
    .where("project_id", "=", input.group.projectId)
    .where("environment_id", "=", input.group.environmentId)
    .where("error_group_id", "=", input.group.id)
    .executeTakeFirst();

  return row
    ? {
        id: row.id,
        projectId: row.project_id,
        environmentId: row.environment_id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        sessionId: row.session_id,
        traceId: row.trace_id,
        timestamp: row.timestamp,
        receivedAt: row.received_at,
        source: row.source,
        release: row.release,
        metadata: row.metadata,
        message: row.message,
        type: row.type,
        severity: row.severity,
        stack: row.stack,
        status: row.status,
        fingerprint: row.fingerprint,
        errorGroupId: row.error_group_id,
        groupingFingerprint: row.grouping_fingerprint,
        context: row.context
      }
    : null;
}
```

- [ ] **Step 5: Add context query helpers**

In `incidents.ts`, add one SQL union helper. Keep limits small and deterministic:

```ts
async function listIncidentTimelineItems(
  db: Db,
  input: {
    occurrence: ErrorRecord;
    confidence: IncidentTimelineConfidence;
    from: Date;
    to: Date;
    excludeIds?: Set<string>;
    limit?: number;
  }
): Promise<IncidentTimelineItem[]> {
  const excludeIds = [...(input.excludeIds ?? new Set<string>())];
  const sessionId = input.confidence === "strong" ? input.occurrence.sessionId : null;
  const traceId = input.confidence === "strong" ? input.occurrence.traceId : null;
  const userId = input.confidence === "nearby" ? input.occurrence.userId : null;
  const tenantId = input.confidence === "nearby" ? input.occurrence.tenantId : null;
  const limit = input.limit ?? 50;

  const rows = await sql<{
    id: string;
    kind: IncidentTimelineKind;
    timestamp: Date;
    tenantId: string | null;
    userId: string | null;
    sessionId: string | null;
    traceId: string | null;
    release: string | null;
    title: string;
    level: string | null;
    data: unknown;
  }>`
    with timeline as (
      select id, 'event'::text as kind, timestamp, tenant_id as "tenantId", user_id as "userId", session_id as "sessionId",
        trace_id as "traceId", release, name as title, null::text as level, jsonb_build_object('properties', properties) as data
      from events
      where project_id = ${input.occurrence.projectId} and environment_id = ${input.occurrence.environmentId}
      union all
      select id, 'error'::text as kind, timestamp, tenant_id as "tenantId", user_id as "userId", session_id as "sessionId",
        trace_id as "traceId", release, message as title, severity as level, jsonb_build_object('status', status, 'errorGroupId', error_group_id) as data
      from errors
      where project_id = ${input.occurrence.projectId} and environment_id = ${input.occurrence.environmentId}
      union all
      select id, 'trace'::text as kind, timestamp, tenant_id as "tenantId", user_id as "userId", session_id as "sessionId",
        trace_id as "traceId", release, name as title, status as level, jsonb_build_object('durationMs', duration_ms) as data
      from traces
      where project_id = ${input.occurrence.projectId} and environment_id = ${input.occurrence.environmentId}
      union all
      select id, 'span'::text as kind, timestamp, tenant_id as "tenantId", user_id as "userId", session_id as "sessionId",
        trace_id as "traceId", release, name as title, status as level, jsonb_build_object('durationMs', duration_ms, 'parentSpanId', parent_span_id) as data
      from spans
      where project_id = ${input.occurrence.projectId} and environment_id = ${input.occurrence.environmentId}
      union all
      select id, 'llm'::text as kind, timestamp, tenant_id as "tenantId", user_id as "userId", session_id as "sessionId",
        trace_id as "traceId", release, coalesce(prompt_name, provider || ' ' || model) as title, status as level,
        jsonb_build_object('provider', provider, 'model', model, 'costUsd', cost_usd, 'latencyMs', latency_ms) as data
      from llm_calls
      where project_id = ${input.occurrence.projectId} and environment_id = ${input.occurrence.environmentId}
      union all
      select id, 'breadcrumb'::text as kind, timestamp, tenant_id as "tenantId", user_id as "userId", session_id as "sessionId",
        trace_id as "traceId", release, message as title, level, jsonb_build_object('breadcrumbType', type, 'category', category, 'data', data) as data
      from breadcrumbs
      where project_id = ${input.occurrence.projectId} and environment_id = ${input.occurrence.environmentId}
    )
    select *
    from timeline
    where timestamp >= ${input.from}
      and timestamp <= ${input.to}
      and (${sessionId}::text is null or "sessionId" = ${sessionId})
      and (${traceId}::text is null or "traceId" = ${traceId})
      and (${userId}::text is null or "userId" = ${userId})
      and (${tenantId}::text is null or "tenantId" = ${tenantId})
      and (cardinality(${excludeIds}::text[]) = 0 or id != all(${excludeIds}::text[]))
    order by timestamp asc, id asc
    limit ${limit + 1}
  `.execute(db);

  return rows.rows.slice(0, limit).map((row) => ({
    ...row,
    confidence: input.confidence
  }));
}
```

- [ ] **Step 6: Add incident aggregation function**

In `incidents.ts`, add:

```ts
export async function getErrorGroupIncident(
  db: Db,
  input: {
    groupId: string;
    projectId: string;
    environmentId: string;
    errorId?: string;
    now?: Date;
  }
): Promise<ErrorGroupIncident | null> {
  const group = await getErrorGroup(db, {
    id: input.groupId,
    projectId: input.projectId,
    environmentId: input.environmentId
  });
  if (!group) return null;

  const primaryOccurrence = await getPrimaryOccurrence(db, { group, errorId: input.errorId });
  if (!primaryOccurrence) return null;

  const from = new Date(primaryOccurrence.timestamp.getTime() - 15 * 60 * 1000);
  const to = new Date(primaryOccurrence.timestamp.getTime() + 15 * 60 * 1000);
  const stronglyRelatedItems = await listIncidentTimelineItems(db, {
    occurrence: primaryOccurrence,
    confidence: "strong",
    from,
    to,
    limit: 75
  });
  const strongIds = new Set(stronglyRelatedItems.map((item) => item.id));
  const nearbyItems = await listIncidentTimelineItems(db, {
    occurrence: primaryOccurrence,
    confidence: "nearby",
    from,
    to,
    excludeIds: strongIds,
    limit: 50
  });
  const sourceMapFrames = await db
    .selectFrom("error_stack_resolutions")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("error_id", "=", primaryOccurrence.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .executeTakeFirst();
  const frameCount = Number(sourceMapFrames?.count ?? 0);

  return {
    group,
    primaryOccurrence,
    priority: group.priority,
    suggestedPriority: suggestErrorGroupPriority({
      severity: group.severity,
      occurrenceCount: group.occurrenceCount,
      affectedUsersCount: group.affectedUsersCount,
      affectedTenantsCount: group.affectedTenantsCount,
      lastRegressedAt: group.lastRegressedAt,
      now: input.now
    }),
    sourceMapResolution: frameCount > 0 ? { status: "cached", frameCount } : { status: "none" },
    stronglyRelated: { items: stronglyRelatedItems, truncated: stronglyRelatedItems.length > 75 },
    nearbyContext: { items: nearbyItems, truncated: nearbyItems.length > 50 },
    related: {
      traceId: primaryOccurrence.traceId,
      sessionId: primaryOccurrence.sessionId,
      userId: primaryOccurrence.userId,
      tenantId: primaryOccurrence.tenantId,
      release: primaryOccurrence.release
    }
  };
}
```

- [ ] **Step 7: Run incident repository tests**

Run:

```sh
pnpm test packages/db/test/repositories.test.ts -t "incident"
```

Expected: PASS.

- [ ] **Step 8: Commit incident repository**

```sh
git add packages/db/src/repositories/incidents.ts packages/db/test/repositories.test.ts
git commit -m "feat: add error incident repository"
```

## Task 3: API Incident Route And Triage Patch

**Files:**
- Modify: `apps/api/src/routes/query.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/test/query.test.ts`

- [ ] **Step 1: Write failing API route tests**

In `apps/api/test/query.test.ts`, add tests near error group route tests:

```ts
it("gets an error group incident by id", async () => {
  const app = await buildQueryTestApp({
    query: {
      getErrorGroupIncident: async (id, filters) => ({
        group: { id, projectId: filters.projectId, environmentId: filters.environmentId },
        primaryOccurrence: { id: filters.errorId ?? "err_latest", errorGroupId: id },
        priority: null,
        suggestedPriority: "urgent",
        sourceMapResolution: { status: "none" },
        stronglyRelated: { items: [], truncated: false },
        nearbyContext: { items: [], truncated: false },
        related: { traceId: null, sessionId: null, userId: null, tenantId: null, release: null }
      })
    }
  });

  const response = await app.inject({
    method: "GET",
    url: "/query/incidents/error-groups/egrp_1?project_id=prj_1&environment_id=env_1&error_id=err_1",
    cookies: authCookies()
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    data: {
      group: { id: "egrp_1" },
      primaryOccurrence: { id: "err_1" },
      suggestedPriority: "urgent"
    }
  });
});

it("updates error group status and priority", async () => {
  const app = await buildQueryTestApp({
    query: {
      updateErrorGroupTriage: async (id, input) => ({
        id,
        projectId: input.projectId,
        environmentId: input.environmentId,
        status: input.status,
        priority: input.priority
      })
    }
  });

  const response = await app.inject({
    method: "PATCH",
    url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
    cookies: authCookies(),
    payload: { status: "investigating", priority: "high" }
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    data: { id: "egrp_1", status: "investigating", priority: "high" }
  });
});

it("rejects invalid error group priority", async () => {
  const app = await buildQueryTestApp({
    query: {
      updateErrorGroupTriage: async () => {
        throw new Error("should not be called");
      }
    }
  });

  const response = await app.inject({
    method: "PATCH",
    url: "/query/error-groups/egrp_1?project_id=prj_1&environment_id=env_1",
    cookies: authCookies(),
    payload: { priority: "p0" }
  });

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "invalid_query" });
});
```

- [ ] **Step 2: Run failing API tests**

Run:

```sh
pnpm test apps/api/test/query.test.ts -t "incident|priority"
```

Expected: FAIL because route dependencies and parsing do not exist.

- [ ] **Step 3: Extend query route types and schemas**

In `apps/api/src/routes/query.ts`, add:

```ts
export type ErrorGroupPriority = "urgent" | "high" | "normal" | "low";
```

Extend `QueryDependencies`:

```ts
getErrorGroupIncident?: (
  id: string,
  filters: ErrorGroupScope & { errorId?: string }
) => Promise<unknown | null>;
updateErrorGroupTriage?: (
  id: string,
  input: ErrorGroupScope & { status?: ErrorGroupStatus; priority?: ErrorGroupPriority | null }
) => Promise<unknown | null>;
```

Add schemas:

```ts
const errorGroupPrioritySchema = z.enum(["urgent", "high", "normal", "low"]);
const errorGroupIncidentScopeSchema = z.object({
  project_id: z.string().trim().min(1),
  environment_id: z.string().trim().min(1),
  error_id: z.string().trim().min(1).optional()
});
const errorGroupTriageBodySchema = z
  .object({
    status: errorGroupStatusSchema.optional(),
    priority: errorGroupPrioritySchema.nullable().optional()
  })
  .refine((value) => value.status !== undefined || "priority" in value);
```

Add parser:

```ts
function parseErrorGroupIncidentScope(query: unknown): (ErrorGroupScope & { errorId?: string }) | undefined {
  const parsed = errorGroupIncidentScopeSchema.safeParse(query);
  if (!parsed.success) return undefined;
  return {
    projectId: parsed.data.project_id,
    environmentId: parsed.data.environment_id,
    errorId: parsed.data.error_id
  };
}
```

- [ ] **Step 4: Add incident route handler**

In `apps/api/src/routes/query.ts`, add:

```ts
async function handleErrorGroupIncidentRoute(request: FastifyRequest, reply: FastifyReply, options: QueryRouteOptions) {
  const user = await requireHumanUser(request, reply, options.auth);
  if (!user) {
    return reply;
  }

  if (!options.query?.getErrorGroupIncident) {
    return reply.status(501).send({ error: "query_method_unavailable" });
  }

  const params = errorGroupParamsSchema.safeParse(request.params);
  const scope = parseErrorGroupIncidentScope(request.query);
  if (!params.success || !scope) {
    return reply.status(400).send({ error: "invalid_query" });
  }

  try {
    const incident = await options.query.getErrorGroupIncident(params.data.id, scope);
    return incident ? reply.send({ data: incident }) : reply.status(404).send({ error: "incident_not_found" });
  } catch {
    return reply.status(503).send({ error: "query_unavailable" });
  }
}
```

- [ ] **Step 5: Extend triage patch handler**

Replace the status-only body in `handleErrorGroupStatusRoute` with `errorGroupTriageBodySchema`.

Use:

```ts
const body = errorGroupTriageBodySchema.safeParse(request.body);
```

Then choose dependency:

```ts
const update = options.query.updateErrorGroupTriage ?? options.query.updateErrorGroupStatus;
if (!update) {
  return reply.status(501).send({ error: "query_method_unavailable" });
}
```

Call:

```ts
const group = await update(params.data.id, {
  ...scope,
  ...body.data
});
```

Keep the existing 404 and 503 behavior.

- [ ] **Step 6: Register route**

In `registerQueryRoutes`, add before `/query/error-groups/:id`:

```ts
app.get("/query/incidents/error-groups/:id", (request, reply) =>
  handleErrorGroupIncidentRoute(request, reply, options)
);
```

- [ ] **Step 7: Wire main dependencies**

In `apps/api/src/main.ts`, import:

```ts
import { getErrorGroupIncident } from "@sigmon/db/repositories/incidents";
```

Import `updateErrorGroupTriage` from error groups.

In query dependencies, add:

```ts
getErrorGroupIncident: (id, filters) => getErrorGroupIncident(db, { groupId: id, ...filters }),
updateErrorGroupTriage: (id, input) => updateErrorGroupTriage(db, { id, ...input }),
```

Keep `updateErrorGroupStatus` for compatibility until console is migrated.

- [ ] **Step 8: Run API route tests**

Run:

```sh
pnpm test apps/api/test/query.test.ts -t "incident|priority|error group"
pnpm --filter @sigmon/api build
```

Expected: PASS.

- [ ] **Step 9: Commit API route work**

```sh
git add apps/api/src/routes/query.ts apps/api/src/main.ts apps/api/test/query.test.ts
git commit -m "feat: add error incident query route"
```

## Task 4: Console Client And Types

**Files:**
- Modify: `apps/console/src/api/types.ts`
- Modify: `apps/console/src/api/client.ts`
- Modify: `apps/console/src/api/client.test.ts`

- [ ] **Step 1: Write failing client tests**

In `apps/console/src/api/client.test.ts`, add:

```ts
it("builds error group incident query URLs", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { group: { id: "egrp/1" } } }));
  vi.stubGlobal("fetch", fetchMock);

  await createApiClient("/api").getErrorGroupIncident("egrp/1", {
    projectId: "prj/1",
    environmentId: "env 1",
    errorId: "err/1"
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/query/incidents/error-groups/egrp%2F1?project_id=prj%2F1&environment_id=env+1&error_id=err%2F1",
    expect.objectContaining({ credentials: "include" })
  );
});

it("sends error group triage updates", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "egrp/1", priority: "urgent" } }));
  vi.stubGlobal("fetch", fetchMock);

  await createApiClient("/api").updateErrorGroupTriage("egrp/1", {
    projectId: "prj/1",
    environmentId: "env 1",
    status: "investigating",
    priority: "urgent"
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/query/error-groups/egrp%2F1?project_id=prj%2F1&environment_id=env+1",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ status: "investigating", priority: "urgent" })
    })
  );
});
```

- [ ] **Step 2: Run failing client tests**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts -t "incident|triage"
```

Expected: FAIL because client methods do not exist.

- [ ] **Step 3: Add console types**

In `apps/console/src/api/types.ts`, add:

```ts
export type ErrorGroupPriority = "urgent" | "high" | "normal" | "low";

export type IncidentTimelineKind = "breadcrumb" | "event" | "error" | "trace" | "span" | "llm";
export type IncidentTimelineConfidence = "strong" | "nearby";

export type IncidentTimelineItem = {
  id: string;
  kind: IncidentTimelineKind;
  confidence: IncidentTimelineConfidence;
  timestamp: string;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  release: string | null;
  title: string;
  level: string | null;
  data: unknown;
};

export type ErrorGroupIncident = {
  group: ErrorGroupRecord;
  primaryOccurrence: ErrorRecord;
  priority: ErrorGroupPriority | null;
  suggestedPriority: ErrorGroupPriority;
  sourceMapResolution: { status: "cached"; frameCount: number } | { status: "none" };
  stronglyRelated: { items: IncidentTimelineItem[]; truncated: boolean };
  nearbyContext: { items: IncidentTimelineItem[]; truncated: boolean };
  related: {
    traceId: string | null;
    sessionId: string | null;
    userId: string | null;
    tenantId: string | null;
    release: string | null;
  };
};

export type ErrorGroupIncidentQuery = {
  projectId: string;
  environmentId: string;
  errorId?: string;
};

export type UpdateErrorGroupTriageInput = {
  projectId: string;
  environmentId: string;
  status?: ErrorGroupStatus;
  priority?: ErrorGroupPriority | null;
};
```

Add `priority: ErrorGroupPriority | null` to `ErrorGroupRecord`.

- [ ] **Step 4: Add client route builders and methods**

In `apps/console/src/api/client.ts`, import new types.

Add helper:

```ts
function errorGroupIncidentPath(id: string, query: ErrorGroupIncidentQuery): string {
  const params = errorGroupScopeParams(query);
  if (query.errorId) params.set("error_id", query.errorId);
  return `/query/incidents/error-groups/${encodePathSegment(id)}?${params.toString()}`;
}
```

Extend `ErrorGroupApiClient`:

```ts
getErrorGroupIncident: (
  id: string,
  query: ErrorGroupIncidentQuery
) => Promise<AggregateResponse<ErrorGroupIncident>>;
updateErrorGroupTriage: (
  id: string,
  input: UpdateErrorGroupTriageInput
) => Promise<AggregateResponse<ErrorGroupRecord>>;
```

Add implementation:

```ts
getErrorGroupIncident: (id, query) =>
  request<AggregateResponse<ErrorGroupIncident>>(path(apiBasePath, errorGroupIncidentPath(id, query))),
updateErrorGroupTriage: (id, input) =>
  request<AggregateResponse<ErrorGroupRecord>>(path(apiBasePath, errorGroupPath(id, input)), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...("priority" in input ? { priority: input.priority ?? null } : {})
    })
  }),
```

- [ ] **Step 5: Run client tests**

Run:

```sh
pnpm test apps/console/src/api/client.test.ts -t "incident|triage"
pnpm --filter @sigmon/console build
```

Expected: PASS.

- [ ] **Step 6: Commit console client**

```sh
git add apps/console/src/api/types.ts apps/console/src/api/client.ts apps/console/src/api/client.test.ts
git commit -m "feat: add incident console client"
```

## Task 5: Incident View Route And Shell Integration

**Files:**
- Create: `apps/console/src/components/IncidentView.tsx`
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/components/ConsoleShell.test.tsx`

- [ ] **Step 1: Write failing shell route tests**

In `apps/console/src/components/ConsoleShell.test.tsx`, add:

```tsx
it("opens an incident route from the browser URL", async () => {
  window.history.pushState({}, "", "/console/incidents/error-groups/egrp_1?project_id=prj_1&environment_id=env_1");
  const client = createMockClient({
    getErrorGroupIncident: vi.fn().mockResolvedValue({
      data: incidentFixture({ groupId: "egrp_1" })
    })
  });

  render(<ConsoleShell apiEndpoint="https://my.sigmon.app" client={client} />);

  expect(await screen.findByText("Incident")).toBeInTheDocument();
  expect(await screen.findByText("Checkout failed")).toBeInTheDocument();
  expect(client.getErrorGroupIncident).toHaveBeenCalledWith("egrp_1", {
    projectId: "prj_1",
    environmentId: "env_1"
  });
});
```

Add local fixture in the same test file:

```ts
function incidentFixture(input: { groupId: string }) {
  return {
    group: {
      id: input.groupId,
      projectId: "prj_1",
      environmentId: "env_1",
      groupingFingerprint: "fp_checkout",
      message: "Checkout failed",
      type: "Error",
      topStackFrame: "at checkout.js:10:2",
      severity: "critical",
      status: "open",
      priority: null,
      firstSeenAt: "2026-05-24T12:00:00.000Z",
      lastSeenAt: "2026-05-24T12:00:00.000Z",
      lastRegressedAt: null,
      occurrenceCount: 1,
      affectedUsersCount: 1,
      affectedTenantsCount: 1,
      latestErrorId: "err_1",
      latestRelease: "web@1",
      resolvedAt: null,
      ignoredAt: null,
      createdAt: "2026-05-24T12:00:00.000Z",
      updatedAt: "2026-05-24T12:00:00.000Z"
    },
    primaryOccurrence: {
      id: "err_1",
      projectId: "prj_1",
      environmentId: "env_1",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      traceId: "trace_1",
      timestamp: "2026-05-24T12:00:00.000Z",
      receivedAt: "2026-05-24T12:00:01.000Z",
      source: "browser",
      release: "web@1",
      metadata: {},
      message: "Checkout failed",
      type: "Error",
      severity: "critical",
      stack: "Error: Checkout failed\n    at checkout.js:10:2",
      status: "open",
      fingerprint: "fp_checkout",
      errorGroupId: input.groupId,
      groupingFingerprint: "fp_checkout",
      context: {}
    },
    priority: null,
    suggestedPriority: "urgent",
    sourceMapResolution: { status: "none" },
    stronglyRelated: { items: [], truncated: false },
    nearbyContext: { items: [], truncated: false },
    related: {
      traceId: "trace_1",
      sessionId: "session_1",
      userId: "user_1",
      tenantId: "tenant_1",
      release: "web@1"
    }
  };
}
```

- [ ] **Step 2: Run failing shell test**

Run:

```sh
pnpm test apps/console/src/components/ConsoleShell.test.tsx -t "incident route"
```

Expected: FAIL because `IncidentView` and route handling do not exist.

- [ ] **Step 3: Create the first IncidentView loading state**

Create `apps/console/src/components/IncidentView.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorGroupIncident } from "../api/types";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; incident: ErrorGroupIncident }
  | { status: "unavailable" };

type Props = {
  client: ApiClient;
  groupId: string;
  projectId: string;
  environmentId: string;
  errorId?: string;
  onBack: () => void;
};

export function IncidentView({ client, groupId, projectId, environmentId, errorId, onBack }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void client
      .getErrorGroupIncident(groupId, { projectId, environmentId, errorId })
      .then(
        ({ data }) => {
          if (!cancelled) setState({ status: "ready", incident: data });
        },
        () => {
          if (!cancelled) setState({ status: "unavailable" });
        }
      );
    return () => {
      cancelled = true;
    };
  }, [client, environmentId, errorId, groupId, projectId]);

  if (state.status === "loading") return <p className="muted-text">Loading incident</p>;
  if (state.status === "unavailable") return <p className="muted-text">Incident unavailable</p>;

  return (
    <section className="incident-view">
      <header className="incident-header">
        <button onClick={onBack} type="button">Back to errors</button>
        <div>
          <p className="eyebrow">Incident</p>
          <h2>{state.incident.group.message}</h2>
        </div>
      </header>
    </section>
  );
}
```

- [ ] **Step 4: Add URL parsing helpers in ConsoleShell**

In `ConsoleShell.tsx`, add:

```ts
type IncidentRoute =
  | { kind: "none" }
  | { kind: "error-group"; groupId: string; projectId: string; environmentId: string; errorId?: string };

function parseIncidentRoute(location: Location): IncidentRoute {
  const match = location.pathname.match(/\/console\/incidents\/error-groups\/([^/]+)$/);
  if (!match) return { kind: "none" };
  const params = new URLSearchParams(location.search);
  const projectId = params.get("project_id");
  const environmentId = params.get("environment_id");
  if (!projectId || !environmentId) return { kind: "none" };
  return {
    kind: "error-group",
    groupId: decodeURIComponent(match[1]),
    projectId,
    environmentId,
    errorId: params.get("error_id") ?? undefined
  };
}
```

Add state:

```ts
const [incidentRoute, setIncidentRoute] = useState<IncidentRoute>(() => parseIncidentRoute(window.location));
```

Add popstate effect:

```ts
useEffect(() => {
  function handlePopState() {
    setIncidentRoute(parseIncidentRoute(window.location));
  }
  window.addEventListener("popstate", handlePopState);
  return () => window.removeEventListener("popstate", handlePopState);
}, []);
```

Add open/back helpers:

```ts
function openErrorGroupIncident(groupId: string, options?: { errorId?: string }) {
  if (!activeProject || !activeEnvironment) return;
  const params = new URLSearchParams({
    project_id: activeProject.id,
    environment_id: activeEnvironment.id
  });
  if (options?.errorId) params.set("error_id", options.errorId);
  const path = `/console/incidents/error-groups/${encodeURIComponent(groupId)}?${params.toString()}`;
  window.history.pushState({}, "", path);
  setIncidentRoute({
    kind: "error-group",
    groupId,
    projectId: activeProject.id,
    environmentId: activeEnvironment.id,
    errorId: options?.errorId
  });
}

function closeIncidentView() {
  window.history.pushState({}, "", "/console");
  setIncidentRoute({ kind: "none" });
  setActiveMode("investigate");
}
```

- [ ] **Step 5: Render IncidentView above mode panels**

In `ConsoleShell.tsx`, import `IncidentView`.

Before the existing mode panels, render:

```tsx
{incidentRoute.kind === "error-group" ? (
  <IncidentView
    client={client}
    environmentId={incidentRoute.environmentId}
    errorId={incidentRoute.errorId}
    groupId={incidentRoute.groupId}
    onBack={closeIncidentView}
    projectId={incidentRoute.projectId}
  />
) : (
  <>
    {/* existing mode panel markup */}
  </>
)}
```

Move the existing mode panel markup into the fragment. Do not render setup/overview/investigate panels while incident route is active.

- [ ] **Step 6: Run shell tests**

Run:

```sh
pnpm test apps/console/src/components/ConsoleShell.test.tsx -t "incident route"
pnpm --filter @sigmon/console build
```

Expected: PASS.

- [ ] **Step 7: Commit shell route**

```sh
git add apps/console/src/components/IncidentView.tsx apps/console/src/components/ConsoleShell.tsx apps/console/src/components/ConsoleShell.test.tsx
git commit -m "feat: add incident console route"
```

## Task 6: Incident View UI Components

**Files:**
- Create: `apps/console/src/components/IncidentSummary.tsx`
- Create: `apps/console/src/components/IncidentTriagePanel.tsx`
- Create: `apps/console/src/components/IncidentTechnicalPanel.tsx`
- Create: `apps/console/src/components/IncidentTimeline.tsx`
- Create: `apps/console/src/components/PriorityBadge.tsx`
- Modify: `apps/console/src/components/IncidentView.tsx`
- Create: `apps/console/src/components/IncidentView.test.tsx`

- [ ] **Step 1: Write failing IncidentView render tests**

Create `apps/console/src/components/IncidentView.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { IncidentView } from "./IncidentView";

function clientWithIncident(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getErrorGroupIncident: vi.fn().mockResolvedValue({ data: incidentFixture() }),
    updateErrorGroupTriage: vi.fn().mockResolvedValue({ data: { ...incidentFixture().group, priority: "high" } }),
    ...overrides
  } as ApiClient;
}

function incidentFixture() {
  return {
    group: {
      id: "egrp_1",
      projectId: "prj_1",
      environmentId: "env_1",
      groupingFingerprint: "fp_checkout",
      message: "Checkout failed",
      type: "Error",
      topStackFrame: "at checkout.js:10:2",
      severity: "critical",
      status: "open",
      priority: null,
      firstSeenAt: "2026-05-24T12:00:00.000Z",
      lastSeenAt: "2026-05-24T12:05:00.000Z",
      lastRegressedAt: null,
      occurrenceCount: 5,
      affectedUsersCount: 2,
      affectedTenantsCount: 1,
      latestErrorId: "err_1",
      latestRelease: "web@1",
      resolvedAt: null,
      ignoredAt: null,
      createdAt: "2026-05-24T12:00:00.000Z",
      updatedAt: "2026-05-24T12:05:00.000Z"
    },
    primaryOccurrence: {
      id: "err_1",
      projectId: "prj_1",
      environmentId: "env_1",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      traceId: "trace_1",
      timestamp: "2026-05-24T12:05:00.000Z",
      receivedAt: "2026-05-24T12:05:01.000Z",
      source: "browser",
      release: "web@1",
      metadata: { route: "/checkout" },
      message: "Checkout failed",
      type: "Error",
      severity: "critical",
      stack: "Error: Checkout failed\n    at checkout.js:10:2",
      status: "open",
      fingerprint: "fp_checkout",
      errorGroupId: "egrp_1",
      groupingFingerprint: "fp_checkout",
      context: { cartId: "cart_1" }
    },
    priority: null,
    suggestedPriority: "urgent",
    sourceMapResolution: { status: "cached", frameCount: 2 },
    stronglyRelated: {
      truncated: false,
      items: [
        {
          id: "evt_1",
          kind: "event",
          confidence: "strong",
          timestamp: "2026-05-24T12:04:00.000Z",
          tenantId: "tenant_1",
          userId: "user_1",
          sessionId: "session_1",
          traceId: "trace_1",
          release: "web@1",
          title: "checkout.started",
          level: null,
          data: {}
        }
      ]
    },
    nearbyContext: {
      truncated: false,
      items: [
        {
          id: "llm_1",
          kind: "llm",
          confidence: "nearby",
          timestamp: "2026-05-24T12:03:00.000Z",
          tenantId: "tenant_1",
          userId: "user_1",
          sessionId: null,
          traceId: null,
          release: "web@1",
          title: "openai gpt-4.1-mini",
          level: "success",
          data: { costUsd: "0.00012" }
        }
      ]
    },
    related: {
      traceId: "trace_1",
      sessionId: "session_1",
      userId: "user_1",
      tenantId: "tenant_1",
      release: "web@1"
    }
  };
}

describe("IncidentView", () => {
  it("renders summary, technical details, and separated timelines", async () => {
    render(
      <IncidentView
        client={clientWithIncident()}
        environmentId="env_1"
        groupId="egrp_1"
        onBack={vi.fn()}
        projectId="prj_1"
      />
    );

    expect(await screen.findByRole("heading", { name: "Checkout failed" })).toBeInTheDocument();
    expect(screen.getByText("urgent suggested")).toBeInTheDocument();
    expect(screen.getByText("5 occurrences")).toBeInTheDocument();
    expect(screen.getByText("2 users")).toBeInTheDocument();
    expect(screen.getByText("Source map: 2 frames")).toBeInTheDocument();
    expect(screen.getByText("Error: Checkout failed")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Strongly related timeline")).getByText("checkout.started")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Nearby context timeline")).getByText("openai gpt-4.1-mini")).toBeInTheDocument();
  });

  it("saves priority overrides", async () => {
    const client = clientWithIncident();
    render(
      <IncidentView
        client={client}
        environmentId="env_1"
        groupId="egrp_1"
        onBack={vi.fn()}
        projectId="prj_1"
      />
    );

    await screen.findByRole("heading", { name: "Checkout failed" });
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "high");
    await userEvent.click(screen.getByRole("button", { name: "Save triage" }));

    expect(client.updateErrorGroupTriage).toHaveBeenCalledWith("egrp_1", {
      projectId: "prj_1",
      environmentId: "env_1",
      status: "open",
      priority: "high"
    });
  });
});
```

- [ ] **Step 2: Run failing IncidentView tests**

Run:

```sh
pnpm test apps/console/src/components/IncidentView.test.tsx
```

Expected: FAIL because components are not implemented.

- [ ] **Step 3: Implement PriorityBadge**

Create `apps/console/src/components/PriorityBadge.tsx`:

```tsx
import type { ErrorGroupPriority } from "../api/types";

type Props = {
  priority: ErrorGroupPriority | null;
  suggested?: ErrorGroupPriority;
};

export function PriorityBadge({ priority, suggested }: Props) {
  const value = priority ?? suggested ?? null;
  if (!value) return <span className="badge muted">no priority</span>;
  return (
    <span className={`badge priority-${value}`}>
      {value}
      {priority ? "" : " suggested"}
    </span>
  );
}
```

- [ ] **Step 4: Implement summary component**

Create `apps/console/src/components/IncidentSummary.tsx`:

```tsx
import type { ErrorGroupIncident } from "../api/types";
import { PriorityBadge } from "./PriorityBadge";

function formatTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "none";
}

export function IncidentSummary({ incident }: { incident: ErrorGroupIncident }) {
  const group = incident.group;
  return (
    <section className="incident-summary" aria-label="Incident summary">
      <div>
        <span className={`badge severity-${group.severity}`}>{group.severity}</span>
        <span className={`badge status-${group.status}`}>{group.status}</span>
        <PriorityBadge priority={group.priority} suggested={incident.suggestedPriority} />
      </div>
      <div className="incident-summary-grid">
        <span>{group.occurrenceCount} occurrences</span>
        <span>{group.affectedUsersCount} users</span>
        <span>{group.affectedTenantsCount} tenants</span>
        <span>First seen {formatTime(group.firstSeenAt)}</span>
        <span>Last seen {formatTime(group.lastSeenAt)}</span>
        <span>Release {group.latestRelease ?? "none"}</span>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Implement triage panel**

Create `apps/console/src/components/IncidentTriagePanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorGroupIncident, ErrorGroupPriority, ErrorGroupStatus } from "../api/types";

const statuses: ErrorGroupStatus[] = ["open", "investigating", "resolved", "ignored"];
const priorities: ErrorGroupPriority[] = ["urgent", "high", "normal", "low"];

export function IncidentTriagePanel({
  client,
  environmentId,
  incident,
  onUpdated,
  projectId
}: {
  client: ApiClient;
  environmentId: string;
  incident: ErrorGroupIncident;
  onUpdated: (incident: ErrorGroupIncident) => void;
  projectId: string;
}) {
  const [status, setStatus] = useState<ErrorGroupStatus>(incident.group.status);
  const [priority, setPriority] = useState<ErrorGroupPriority | "">(incident.group.priority ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "failed">("idle");

  useEffect(() => {
    setStatus(incident.group.status);
    setPriority(incident.group.priority ?? "");
    setSaveState("idle");
  }, [incident.group.id, incident.group.priority, incident.group.status]);

  async function save() {
    setSaveState("saving");
    try {
      const { data } = await client.updateErrorGroupTriage(incident.group.id, {
        projectId,
        environmentId,
        status,
        priority: priority || null
      });
      onUpdated({ ...incident, group: data, priority: data.priority });
      setSaveState("idle");
    } catch {
      setSaveState("failed");
    }
  }

  return (
    <section className="incident-card" aria-label="Incident triage">
      <h3>Triage</h3>
      <label>
        Status
        <select value={status} onChange={(event) => setStatus(event.target.value as ErrorGroupStatus)}>
          {statuses.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select value={priority} onChange={(event) => setPriority(event.target.value as ErrorGroupPriority | "")}>
          <option value="">use suggestion ({incident.suggestedPriority})</option>
          {priorities.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <button disabled={saveState === "saving"} onClick={save} type="button">
        {saveState === "saving" ? "Saving" : "Save triage"}
      </button>
      {saveState === "failed" ? <p className="muted-text">Triage update failed.</p> : null}
    </section>
  );
}
```

- [ ] **Step 6: Implement technical panel**

Create `apps/console/src/components/IncidentTechnicalPanel.tsx`:

```tsx
import type { ErrorGroupIncident } from "../api/types";

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>;
}

export function IncidentTechnicalPanel({ incident }: { incident: ErrorGroupIncident }) {
  const occurrence = incident.primaryOccurrence;
  const sourceMapText =
    incident.sourceMapResolution.status === "cached"
      ? `Source map: ${incident.sourceMapResolution.frameCount} frames`
      : "Source map: none";

  return (
    <section className="incident-column" aria-label="Technical details">
      <div className="incident-card">
        <h3>Primary occurrence</h3>
        <dl className="detail-grid">
          <dt>ID</dt>
          <dd><code>{occurrence.id}</code></dd>
          <dt>User</dt>
          <dd>{occurrence.userId ?? "none"}</dd>
          <dt>Tenant</dt>
          <dd>{occurrence.tenantId ?? "none"}</dd>
          <dt>Trace</dt>
          <dd>{occurrence.traceId ?? "none"}</dd>
          <dt>Session</dt>
          <dd>{occurrence.sessionId ?? "none"}</dd>
          <dt>Release</dt>
          <dd>{occurrence.release ?? "none"}</dd>
        </dl>
      </div>
      <div className="incident-card">
        <h3>Stack</h3>
        <p className="muted-text">{sourceMapText}</p>
        <pre className="stack-block">{occurrence.stack ?? occurrence.message}</pre>
      </div>
      <div className="incident-card">
        <h3>Context</h3>
        <JsonBlock value={occurrence.context} />
      </div>
      <div className="incident-card">
        <h3>Metadata</h3>
        <JsonBlock value={occurrence.metadata} />
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Implement timeline component**

Create `apps/console/src/components/IncidentTimeline.tsx`:

```tsx
import type { ErrorGroupIncident, IncidentTimelineItem } from "../api/types";

function TimelineRow({ item }: { item: IncidentTimelineItem }) {
  return (
    <li className={`incident-timeline-row timeline-${item.kind}`}>
      <span className="timeline-time">{new Date(item.timestamp).toLocaleTimeString()}</span>
      <span className="timeline-kind">{item.kind}</span>
      <strong>{item.title}</strong>
      {item.level ? <span className="muted-text">{item.level}</span> : null}
    </li>
  );
}

export function IncidentTimeline({ incident }: { incident: ErrorGroupIncident }) {
  return (
    <section className="incident-column" aria-label="Operational context">
      <div className="incident-card">
        <h3>Related</h3>
        <dl className="detail-grid">
          <dt>Trace</dt>
          <dd>{incident.related.traceId ?? "none"}</dd>
          <dt>Session</dt>
          <dd>{incident.related.sessionId ?? "none"}</dd>
          <dt>User</dt>
          <dd>{incident.related.userId ?? "none"}</dd>
          <dt>Tenant</dt>
          <dd>{incident.related.tenantId ?? "none"}</dd>
        </dl>
      </div>
      <div className="incident-card" aria-label="Strongly related timeline">
        <h3>Strongly related</h3>
        {incident.stronglyRelated.items.length ? (
          <ol className="incident-timeline">
            {incident.stronglyRelated.items.map((item) => <TimelineRow key={`${item.kind}:${item.id}`} item={item} />)}
          </ol>
        ) : (
          <p className="muted-text">No directly linked signals found.</p>
        )}
      </div>
      <div className="incident-card" aria-label="Nearby context timeline">
        <h3>Nearby context</h3>
        <p className="muted-text">Supporting signals from the same user or tenant near the primary occurrence.</p>
        {incident.nearbyContext.items.length ? (
          <ol className="incident-timeline">
            {incident.nearbyContext.items.map((item) => <TimelineRow key={`${item.kind}:${item.id}`} item={item} />)}
          </ol>
        ) : (
          <p className="muted-text">No nearby context found.</p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Compose IncidentView**

In `IncidentView.tsx`, replace the initial ready render with:

```tsx
<section className="incident-view">
  <header className="incident-header">
    <button onClick={onBack} type="button">Back to errors</button>
    <div>
      <p className="eyebrow">Incident</p>
      <h2>{state.incident.group.message}</h2>
    </div>
  </header>
  <IncidentSummary incident={state.incident} />
  <div className="incident-split">
    <IncidentTechnicalPanel incident={state.incident} />
    <div className="incident-column">
      <IncidentTriagePanel
        client={client}
        environmentId={environmentId}
        incident={state.incident}
        onUpdated={(incident) => setState({ status: "ready", incident })}
        projectId={projectId}
      />
      <IncidentTimeline incident={state.incident} />
    </div>
  </div>
</section>
```

Import the new components.

- [ ] **Step 9: Run IncidentView tests**

Run:

```sh
pnpm test apps/console/src/components/IncidentView.test.tsx
pnpm --filter @sigmon/console build
```

Expected: PASS.

- [ ] **Step 10: Commit Incident UI**

```sh
git add apps/console/src/components/IncidentView.tsx apps/console/src/components/IncidentView.test.tsx apps/console/src/components/IncidentSummary.tsx apps/console/src/components/IncidentTriagePanel.tsx apps/console/src/components/IncidentTechnicalPanel.tsx apps/console/src/components/IncidentTimeline.tsx apps/console/src/components/PriorityBadge.tsx
git commit -m "feat: build incident investigation view"
```

## Task 7: Errors Entry UX Refactor

**Files:**
- Modify: `apps/console/src/components/ErrorGroupsPanel.tsx`
- Modify: `apps/console/src/components/ErrorGroupList.tsx`
- Modify: `apps/console/src/components/ErrorGroupDetail.tsx`
- Modify: `apps/console/src/components/ErrorRawOccurrencesPanel.tsx`
- Modify: `apps/console/src/components/ErrorList.tsx`
- Modify: `apps/console/src/components/ErrorDetailDrawer.tsx`
- Modify: `apps/console/src/components/ErrorInvestigationPanel.test.tsx`

- [ ] **Step 1: Write failing Errors entry tests**

In `apps/console/src/components/ErrorInvestigationPanel.test.tsx`, add:

```tsx
it("opens an incident from grouped errors", async () => {
  const onOpenIncident = vi.fn();
  render(
    <ErrorInvestigationPanel
      client={clientWithGroups()}
      environmentId="env_1"
      initialTab="groups"
      onOpenIncident={onOpenIncident}
      projectId="prj_1"
    />
  );

  await screen.findByText("Checkout failed");
  await userEvent.click(screen.getByRole("button", { name: "Open incident" }));

  expect(onOpenIncident).toHaveBeenCalledWith("egrp_1", undefined);
});

it("opens an incident from raw occurrences", async () => {
  const onOpenIncident = vi.fn();
  render(
    <ErrorInvestigationPanel
      client={clientWithErrors()}
      environmentId="env_1"
      initialTab="raw"
      onOpenIncident={onOpenIncident}
      projectId="prj_1"
    />
  );

  await screen.findByText("Checkout failed");
  await userEvent.click(screen.getByRole("button", { name: "Open incident" }));

  expect(onOpenIncident).toHaveBeenCalledWith("egrp_1", { errorId: "err_1" });
});
```

Update local fixtures to include `priority`.

- [ ] **Step 2: Run failing Errors entry tests**

Run:

```sh
pnpm test apps/console/src/components/ErrorInvestigationPanel.test.tsx -t "opens an incident"
```

Expected: FAIL because `onOpenIncident` is not wired.

- [ ] **Step 3: Thread incident opener prop**

Add prop to `ErrorInvestigationPanel`:

```ts
onOpenIncident?: (groupId: string, options?: { errorId?: string }) => void;
```

Pass it into `ErrorGroupsPanel` and `ErrorRawOccurrencesPanel`.

In `ConsoleShell`, pass:

```tsx
onOpenIncident={openErrorGroupIncident}
```

- [ ] **Step 4: Add group list action and badges**

In `ErrorGroupList.tsx`, add props:

```ts
onOpenIncident?: (groupId: string) => void;
```

Render priority/status/severity:

```tsx
<span className={`badge severity-${group.severity}`}>{group.severity}</span>
<span className={`badge status-${group.status}`}>{group.status}</span>
<PriorityBadge priority={group.priority} />
<button
  onClick={(event) => {
    event.stopPropagation();
    onOpenIncident?.(group.id);
  }}
  type="button"
>
  Open incident
</button>
```

- [ ] **Step 5: Add group detail action**

In `ErrorGroupDetail.tsx`, add prop:

```ts
onOpenIncident?: (groupId: string) => void;
```

Render:

```tsx
<button onClick={() => onOpenIncident?.(group.id)} type="button">
  Open incident
</button>
```

Also display priority:

```tsx
<dt>Priority</dt>
<dd><PriorityBadge priority={group.priority} /></dd>
```

- [ ] **Step 6: Add raw occurrence action**

In `ErrorList.tsx`, add:

```ts
onOpenIncident?: (groupId: string, options: { errorId: string }) => void;
```

For each row with `error.errorGroupId`, render:

```tsx
<button
  onClick={() => error.errorGroupId && onOpenIncident?.(error.errorGroupId, { errorId: error.id })}
  type="button"
>
  Open incident
</button>
```

In `ErrorDetailDrawer.tsx`, add the same action when `error.errorGroupId` exists.

- [ ] **Step 7: Run Errors entry tests**

Run:

```sh
pnpm test apps/console/src/components/ErrorInvestigationPanel.test.tsx apps/console/src/components/ConsoleShell.test.tsx
pnpm --filter @sigmon/console build
```

Expected: PASS.

- [ ] **Step 8: Commit Errors entry refactor**

```sh
git add apps/console/src/components/ErrorInvestigationPanel.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx apps/console/src/components/ErrorGroupsPanel.tsx apps/console/src/components/ErrorGroupList.tsx apps/console/src/components/ErrorGroupDetail.tsx apps/console/src/components/ErrorRawOccurrencesPanel.tsx apps/console/src/components/ErrorList.tsx apps/console/src/components/ErrorDetailDrawer.tsx apps/console/src/components/ConsoleShell.tsx
git commit -m "feat: link errors to incident view"
```

## Task 8: Visual Polish And Responsive CSS

**Files:**
- Modify: `apps/console/src/styles.css`
- Modify: `apps/console/src/components/IncidentView.test.tsx`

- [ ] **Step 1: Add layout-oriented assertions**

In `IncidentView.test.tsx`, add:

```tsx
it("uses split investigation structure", async () => {
  render(
    <IncidentView
      client={clientWithIncident()}
      environmentId="env_1"
      groupId="egrp_1"
      onBack={vi.fn()}
      projectId="prj_1"
    />
  );

  expect(await screen.findByRole("heading", { name: "Checkout failed" })).toBeInTheDocument();
  expect(screen.getByLabelText("Technical details")).toBeInTheDocument();
  expect(screen.getByLabelText("Operational context")).toBeInTheDocument();
});
```

- [ ] **Step 2: Add CSS**

In `apps/console/src/styles.css`, add:

```css
.badge {
  align-items: center;
  border: 1px solid #d7dee8;
  border-radius: 999px;
  display: inline-flex;
  font-size: 12px;
  font-weight: 700;
  gap: 4px;
  line-height: 1;
  padding: 4px 8px;
  white-space: nowrap;
}

.priority-urgent,
.severity-fatal,
.severity-critical {
  background: #fee2e2;
  border-color: #fecaca;
  color: #991b1b;
}

.priority-high,
.severity-error {
  background: #ffedd5;
  border-color: #fed7aa;
  color: #9a3412;
}

.priority-normal,
.severity-warning,
.status-investigating {
  background: #fef9c3;
  border-color: #fde68a;
  color: #854d0e;
}

.priority-low,
.status-resolved {
  background: #dcfce7;
  border-color: #bbf7d0;
  color: #166534;
}

.status-open {
  background: #dbeafe;
  border-color: #bfdbfe;
  color: #1d4ed8;
}

.status-ignored,
.badge.muted {
  background: #f1f5f9;
  border-color: #e2e8f0;
  color: #475569;
}

.incident-view {
  display: grid;
  gap: 14px;
}

.incident-header {
  align-items: flex-start;
  display: flex;
  gap: 14px;
  justify-content: space-between;
}

.incident-summary,
.incident-card {
  background: #fff;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  padding: 12px;
}

.incident-summary-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 10px;
}

.incident-split {
  display: grid;
  gap: 14px;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 0.9fr);
}

.incident-column {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.stack-block,
.json-block {
  background: #0f172a;
  border-radius: 6px;
  color: #e2e8f0;
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.incident-timeline {
  display: grid;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.incident-timeline-row {
  align-items: center;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  display: grid;
  gap: 8px;
  grid-template-columns: 84px 72px minmax(0, 1fr) auto;
  padding: 8px;
}

.timeline-time,
.timeline-kind {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

@media (max-width: 960px) {
  .incident-split,
  .incident-summary-grid {
    grid-template-columns: 1fr;
  }

  .incident-timeline-row {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Run UI tests and build**

Run:

```sh
pnpm test apps/console/src/components/IncidentView.test.tsx apps/console/src/components/ErrorInvestigationPanel.test.tsx
pnpm --filter @sigmon/console build
```

Expected: PASS.

- [ ] **Step 4: Run visual verification**

Run a visual check against the local console after creating a seeded test project and navigating to an incident route. Use the existing login flow if the dev server requires authentication.

Start the console locally:

```sh
pnpm dev:console
```

Then use Playwright or Browser to inspect desktop `1440x1000` and mobile `390x900`.

Expected: no horizontal overflow, split layout on desktop, stacked layout on mobile, summary cards readable, timeline rows contained inside the viewport.

- [ ] **Step 5: Commit polish**

```sh
git add apps/console/src/styles.css apps/console/src/components/IncidentView.test.tsx
git commit -m "style: polish incident investigation UI"
```

## Task 9: Documentation And Final Verification

**Files:**
- Modify: `README.md`
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/UI-UX.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`

- [ ] **Step 1: Update docs**

In `README.md`, add a short section under investigation capabilities:

```md
## Incident Investigation

SignalMonitor includes an error-first Incident view for grouped errors and raw occurrences. Operators can open a shareable incident URL from `Investigate > Errors`, review severity, status, suggested and saved priority, source-map status, primary occurrence details, strongly related signals, and nearby context.
```

In `.claude/docs/ARCHITECTURE.md`, document:

- `error_groups.priority`;
- incident aggregation endpoint;
- strongly related vs nearby context.

In `.claude/docs/UI-UX.md`, document:

- Split Investigation layout;
- Errors entry points;
- priority badges;
- nearby context labeling.

In `.claude/docs/PROJECT-SUMMARY.md`, add Incident view to implemented capabilities.

- [ ] **Step 2: Run final verification**

Run:

```sh
pnpm test
pnpm build
docker compose config --quiet
git diff --check
```

Expected: all commands pass.

- [ ] **Step 3: Update implementation checklist**

Mark all completed checkboxes in this plan.

- [ ] **Step 4: Commit docs and checklist**

```sh
git add README.md .claude/docs/ARCHITECTURE.md .claude/docs/UI-UX.md .claude/docs/PROJECT-SUMMARY.md docs/superpowers/plans/2026-05-24-incident-view-error-ux-implementation.md
git commit -m "docs: record incident view implementation"
```

- [ ] **Step 5: Memory update**

Update versioned memory at:

```text
<config-repo>/projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
```

Add:

```md
- Implemented Incident View and Error UX Refactor: dedicated error-first Incident view, group priority triage, strongly related and nearby context timelines, Errors entry polish, and shareable incident URLs.
```

Commit in the config repo:

```sh
git add projects/-Users-diogo-Developer-Github-SignalHub/memory/MEMORY.md
git commit -m "memory: record incident view error ux"
```

- [ ] **Step 6: Handoff**

Report:

- branch name;
- commits created;
- verification results;
- any visual verification gaps;
- whether the branch is ready for PR.

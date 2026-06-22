# Console v2 — S4 Incidents List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Port the v2 **Incidents list** screen — priority-ordered active-incident triage cards + 4 KPI tiles — and flip the `incidents` nav section from legacy to v2, drilling into the S3 incident detail.

**Architecture:** A `useIncidents` hook (mirrors `useErrors`) fetches active error groups (open+investigating) and incident MTTR, derives KPIs + sorted card VMs; `IncidentsScreen` renders the design with reused F1 `ui/v2` primitives; `registry.tsx` flips `incidents` to the v2 screen; the existing S3 shell drill/back renders the detail. Read-only list + drill (no new mutations).

**Tech:** React 19 + Vite, TypeScript, Vitest (jsdom for renderHook/DOM tests). Design source `.claude/design-v2/app-screens-b.jsx` (`IncidentsScreen`). Spec: `docs/superpowers/specs/2026-06-22-console-v2-s4-incidents-list-design.md`.

## Global Constraints
- **English UI** (translate the design's pt-BR). Copy verbatim: History · Filters · "Priority triage for **{project} · {env}** — {n} active." · Active · P1 critical · MTTR (7d) · Resolved (7d) · Active incidents · "sorted by priority" · occurrences · users · tenants · unassigned · "opened {rel} ago" · "Open →".
- Dark-only, `.sh-v2` scoping already provided by the shell — do not add theme code.
- No literal `SignalHub` in assertions (split-needle `"Signal"+"Hub"` if a no-branding test is touched).
- Any `*.test.ts` (not `.tsx`) using `renderHook`/DOM starts with `// @vitest-environment jsdom`.
- **No fabricated data**: omit the per-group trend sparkline (no backing series); never invent assignee initials or counts.
- `getIncidentMttr` is **optional** on `ApiClient` (mirror `getOperations?`) so existing client mocks don't break; the hook is null-safe when absent.
- Repo gate: `pnpm --filter @sigmon/console test` + `pnpm --filter @sigmon/console build` + `pnpm test` + `pnpm build`.

## File Structure
```
apps/console/src/api/types.ts                    # MODIFY (T1)
apps/console/src/api/client.ts                   # MODIFY (T1)
apps/console/src/components/ui/v2/format.ts      # MODIFY (T1) + format.test.ts
apps/console/src/v2/screens/useIncidents.ts      # NEW (T2) + .test.ts
apps/console/src/v2/screens/IncidentsScreen.tsx  # NEW (T3) + .test.tsx
apps/console/src/v2/screens/registry.tsx         # MODIFY (T4) + registry.test.tsx
```

---

### Task 1: types + getIncidentMttr client method + formatDurationShort

**Files:** Modify `apps/console/src/api/types.ts`, `apps/console/src/api/client.ts`, `apps/console/src/components/ui/v2/format.ts`; Test `apps/console/src/components/ui/v2/format.test.ts`.

**Interfaces produced:**
- `IncidentMttrQuery = { projectId: string; environmentId: string; window?: "24h" | "7d" | "30d" }`
- `IncidentMttrResult = { mttrMs: number | null; resolvedCount: number; windowDays: number }`
- `ApiClient.getIncidentMttr?: (query: IncidentMttrQuery) => Promise<AggregateResponse<IncidentMttrResult>>`
- `ErrorGroupRecord` gains `assignedToUserId: string | null; incidentNumber: string | null; silencedUntil: string | null`
- `formatDurationShort(ms: number | null): string`

- [ ] **Step 1: Verify the list response carries B3 fields.** Read `packages/db/src/repositories/error-groups.ts` (the `toGroup` mapper, ~lines 134-162) and `packages/db/src/schema.ts` `ErrorGroupRecord`, plus the `GET /query/error-groups` route in `apps/api/src/routes/query.ts`. Confirm `assigned_to_user_id`/`incident_number`/`silenced_until` are mapped into the record returned by the list. If they are NOT serialized in the list response, STOP and report DONE_WITH_CONCERNS (the screen will degrade — omit INC#/assignee). If present, continue.

- [ ] **Step 2: Read the MTTR route** `GET /query/incidents/mttr` handler in `apps/api/src/routes/query.ts` and confirm the exact JSON response shape. Adjust `IncidentMttrResult` to match if it differs from `{ mttrMs, resolvedCount, windowDays }`.

- [ ] **Step 3: Write the failing format test.** Add to `apps/console/src/components/ui/v2/format.test.ts` (create if absent; if new and it uses no DOM, no jsdom pragma needed):

```ts
import { describe, expect, it } from "vitest";
import { formatDurationShort } from "./format";

describe("formatDurationShort", () => {
  it("returns em dash for null", () => {
    expect(formatDurationShort(null)).toBe("—");
  });
  it("formats sub-hour as whole minutes", () => {
    expect(formatDurationShort(42 * 60 * 1000)).toBe("42 min");
  });
  it("rounds seconds to the nearest minute", () => {
    expect(formatDurationShort(90 * 1000)).toBe("2 min");
  });
  it("formats >= 1h with one decimal", () => {
    expect(formatDurationShort(90 * 60 * 1000)).toBe("1.5 h");
  });
  it("formats zero as 0 min", () => {
    expect(formatDurationShort(0)).toBe("0 min");
  });
});
```

- [ ] **Step 4: Run → FAIL.** `pnpm --filter @sigmon/console test -- format.test` → fails (function not exported).

- [ ] **Step 5: Implement `formatDurationShort`** in `format.ts`:

```ts
export function formatDurationShort(ms: number | null): string {
  if (ms == null) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${(ms / 3600000).toFixed(1)} h`;
}
```

- [ ] **Step 6: Extend `ErrorGroupRecord`** in `api/types.ts` — add the three nullable string fields next to the existing fields (do not reorder existing ones). Add `IncidentMttrQuery` + `IncidentMttrResult` types near the other query/response types.

- [ ] **Step 7: Add `getIncidentMttr`** to the `ApiClient` type (optional `?`, beside `getOperations?`) and to the client factory in `client.ts`, with an `incidentMttrPath(query)` helper mirroring `operationsPath` (path `/query/incidents/mttr`, params `project_id`, `environment_id`, and `window` when provided). Use the existing `request<AggregateResponse<IncidentMttrResult>>(...)` pattern.

- [ ] **Step 8: Run → PASS** `pnpm --filter @sigmon/console test -- format.test` and `pnpm --filter @sigmon/console build` (tsc clean — confirm no client mock breakage; getIncidentMttr being optional avoids it).

- [ ] **Step 9: Commit** `feat(console): incident MTTR client method + error-group triage fields + formatDurationShort (PER-351)`.

---

### Task 2: useIncidents hook

**Files:** Create `apps/console/src/v2/screens/useIncidents.ts` + `apps/console/src/v2/screens/useIncidents.test.ts`.

**Interfaces:**
- Consumes: `ScreenCtx` (`client`, `project`, `environment`), `ApiClient.listErrorGroups`, `ApiClient.getIncidentMttr?`, `ApiClient.listUsers`, `ErrorGroupRecord` (T1), `PRIORITY_MAP` pattern + `relativeTime` + `formatDurationShort`.
- Produces:
```ts
type IncidentAssignee = { kind: "initials"; initials: string } | { kind: "generic" } | null;
type IncidentRowVM = {
  id: string;
  message: string;
  severity: string;
  status: "open" | "investigating" | "resolved" | "ignored";
  priority: "P1" | "P2" | "P3" | "P4" | null;
  incidentNumber: string | null;
  openedRelative: string;
  assignee: IncidentAssignee;
  occurrenceCount: number;
  affectedUsersCount: number;
  affectedTenantsCount: number;
};
type IncidentsVM = {
  kpis: { active: number; p1: number; mttrLabel: string; resolved7d: number };
  rows: IncidentRowVM[];
};
type UseIncidentsResult = { data: IncidentsVM | null; status: "loading" | "ok" | "error"; reload: () => void };
export function useIncidents(args: {
  client: Pick<ApiClient, "listErrorGroups" | "listUsers"> & { getIncidentMttr?: ApiClient["getIncidentMttr"] };
  projectId: string | undefined;
  environmentId: string | undefined;
}): UseIncidentsResult;
```

- [ ] **Step 1: Read `useErrors.ts`** in full to mirror its structure: `genRef` stale-fetch guard, `tick`/`reload`, the effect skeleton, the `PRIORITY_MAP`/`mapPriority` helper, and how it reads ids. Read the IncidentScreen avatar-initials derivation (in `IncidentScreen.tsx`) to reuse identical initials logic.

- [ ] **Step 2: Write failing tests** `useIncidents.test.ts` (starts with `// @vitest-environment jsdom`). Use a fake client. Cover:
  - merges `status:"open"` + `status:"investigating"` results into one list; passes `limit: 100` and the scope to each call.
  - sorts by priority rank (urgent→P1 first … null last), then `lastSeenAt` desc.
  - `kpis.active` = merged length; `kpis.p1` = count of `priority==="urgent"`.
  - `mttrLabel` from `getIncidentMttr(...).data.mttrMs` via `formatDurationShort` (assert a numeric ms → "X min"); `null` mttrMs → "—"; **client without `getIncidentMttr`** → `mttrLabel: "—"`, `resolved7d: 0`.
  - `resolved7d` = `getIncidentMttr(...).data.resolvedCount`; getIncidentMttr called with `window: "7d"`.
  - assignee: `assignedToUserId` matched in `listUsers` → `{kind:"initials", initials}`; `listUsers` rejects with a 403-shaped error → assigned rows become `{kind:"generic"}`; `assignedToUserId` null → `assignee: null`.
  - row VM maps `incidentNumber` (incl. null), `status`, `priority` (urgent→P1, low→P4), `openedRelative` = relativeTime(firstSeenAt).
  - stale-fetch guard: a second reload's resolution wins; an aborted first fetch does not overwrite.
  - loading → ok; a rejected `listErrorGroups` → `status: "error"`.

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement `useIncidents`.** Fetch with `Promise.all([listErrorGroups({...,status:"open",limit:100}), listErrorGroups({...,status:"investigating",limit:100})])`, plus `getIncidentMttr?.({...,window:"7d"})` (guard undefined) and `listUsers().catch(() => null)` for the id→email map. Build the assignee map; derive initials with the reused helper; sort; map rows; compute kpis. Respect the `genRef` guard and `projectId`/`environmentId` undefined (return loading/empty without calling). `listUsers` failure (any rejection) → assigned rows degrade to `{kind:"generic"}` (do not surface as screen error).

- [ ] **Step 5: Run → PASS.**

- [ ] **Step 6: Commit** `feat(console): useIncidents hook for v2 incidents list (PER-351)`.

---

### Task 3: IncidentsScreen component

**Files:** Create `apps/console/src/v2/screens/IncidentsScreen.tsx` + `apps/console/src/v2/screens/IncidentsScreen.test.tsx`.

**Interfaces:**
- Consumes: `useIncidents` (T2), `ScreenCtx`, `PageHead`/`BigKpi`/`PriorityPill`/`StatusPill`/`Icon`/`EmptyHint`, the `ErrorsScreen` severity→tone mapping (reuse for the sev tag + stripe class).
- Produces: `export function IncidentsScreen({ ctx }: { ctx: ScreenCtx })`.

- [ ] **Step 1: Read** `ErrorsScreen.tsx` (for the screen scaffold, severity mapping, loading/error/empty handling pattern) and the design `IncidentsScreen` in `.claude/design-v2/app-screens-b.jsx`. Read `BigKpi`/`PriorityPill`/`StatusPill`/`PageHead`/`EmptyHint` signatures in `components/ui/v2/`.

- [ ] **Step 2: Write failing tests** `IncidentsScreen.test.tsx` (renders with a fake ctx + mocked `useIncidents` data, or a fake client driving the real hook — match the ErrorsScreen test approach). Cover:
  - renders 4 KPI tiles (Active, P1 critical, MTTR (7d), Resolved (7d)) with the VM values.
  - renders one card per row: sev tag text (uppercased severity) + priority pill + status pill; INC# tag present when `incidentNumber` set and absent when null; "opened … ago"; assignee — avatar with initials when `{kind:"initials"}`, generic avatar (no initials text) when `{kind:"generic"}`, `unassigned` tag when null; mono message; occurrences/users/tenants counts.
  - **no sparkline** rendered (assert the fabricated trend is absent — e.g. no `<svg>` chart in a card / no Sparkline testid).
  - card click → `ctx.drill` called with `("incident", { groupId: row.id })`.
  - History button → `ctx.pushToast` with the history string; Filters → pushToast with the filtering string.
  - empty (no rows) → `EmptyHint` shown, no cards.
  - loading state and error state render (match ErrorsScreen conventions).
  - English-only: assert "Active incidents", "sorted by priority", "Priority triage for" present; assert no pt-BR ("Histórico"/"Filtros"/"ocorrências"/"Incidentes ativos") present.

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement `IncidentsScreen`** translating the design to English with real VM data: PageHead (title "Incidents", sub "Priority triage for {project.name} · {env.name} — {n} active.", actions = History/Filters stub buttons → pushToast), the 4-tile `BigKpi` grid, and the "Active incidents" card with one `<button className="sh-row sh-row--btn sh-stripe {sevClass}">` per row. **Omit the Sparkline** — let the bottom-row spacer flex. Card onClick → `ctx.drill("incident", { groupId: row.id })`. Render `EmptyHint` when `rows.length === 0`. Match `ErrorsScreen` loading/error scaffolding.

- [ ] **Step 5: Run → PASS** and `pnpm --filter @sigmon/console build` (tsc clean).

- [ ] **Step 6: Commit** `feat(console): v2 IncidentsScreen triage list (PER-351)`.

---

### Task 4: flip incidents nav section + full verification

**Files:** Modify `apps/console/src/v2/screens/registry.tsx` + `apps/console/src/v2/screens/registry.test.tsx`.

- [ ] **Step 1: Read** `registry.tsx` + `registry.test.tsx` to see how sections are asserted.

- [ ] **Step 2: Update the failing test.** In `registry.test.tsx`, change the `incidents` expectation from legacy to `kind: "v2"` and assert it renders `IncidentsScreen` (mirror how the `investigate`/`overview` v2 entries are tested).

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Flip the `incidents` entry** in `registry.tsx` to `{ kind: "v2", render: (ctx) => <IncidentsScreen ctx={ctx} /> }` and import `IncidentsScreen`. Leave `llm`/`traces` legacy entries (and the `InvestigationWorkspace` import) untouched.

- [ ] **Step 5: Run → PASS.**

- [ ] **Step 6: Full verification.** Run:
  - `pnpm --filter @sigmon/console test` → green (incl. the new + updated suites; no regression to ConsoleShellV2/ErrorsScreen/IncidentScreen tests).
  - `pnpm --filter @sigmon/console build` → tsc clean.
  - `pnpm test` (repo-wide) → green (branding/no-regression).
  - `pnpm build` → clean.

- [ ] **Step 7: Commit** `feat(console): flip incidents nav section to v2 IncidentsScreen (PER-351)`.

## Notes
- The S3 shell already clears `detail` on section nav and wires `pushToast` (ConsoleShellV2:284) — no shell edits in S4.
- Avatar is the design's `tb-avatar` CSS class on a small `<span>` — no new component.
- If Step 1 of Task 1 finds the list response omits the B3 fields, the whole assignee/INC# card treatment degrades; report it and we file a follow-up rather than expanding S4 into a backend change.

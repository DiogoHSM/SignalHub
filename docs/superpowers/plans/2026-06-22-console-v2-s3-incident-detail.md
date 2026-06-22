# Console v2 — S3 Incident Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Port the v2 Incident detail screen and make it the drill target for an error group; introduce drill/back navigation in the v2 shell. Backed by B3 (merged).

**Architecture:** `api/types.ts`+`client.ts` gain the B3 incident fields + triage mutation methods; `useIncident` composes fetch+mutations into a VM; `IncidentScreen` renders the design via F1 primitives; `ScreenCtx` gains `drill`/`back` and `ConsoleShellV2` renders `IncidentScreen` over the active section when a `detail` is set; `ErrorsScreen` row click drills.

**Tech:** React 19, TS, Vitest. Builds on F1/F2/S1/S2/B3. Design source: `.claude/design-v2/app-screens-a-incident.jsx`.

## Global Constraints
- Package `@sigmon/console`; branch `feat/console-v2-s3-incident-detail`.
- **English copy** (translate pt-BR from the design); no literal `SignalHub` in any no-branding test assertion (build the needle from parts, e.g. `"Signal"+"Hub"`); no pt-BR user strings.
- Any new `*.test.ts` (not `.tsx`) that uses DOM/`renderHook` MUST start with `// @vitest-environment jsdom` (root vitest only auto-jsdoms `.test.tsx`).
- **No fabrication / degrade gracefully:** omit the 24h occurrences bars (no per-group hourly series); stack trace shows frame **metadata only** (never original source — CLAUDE.md constraint); impact grid "Sessions" cell → "Last seen" (no session-count field); non-admin reassign degrades to disabled.
- Reuse F1 `ui/v2` primitives (`PageHead`/`StatusPill`/`PriorityPill`/`ConfirmButton`/`Icon`/`Divider`/`SummaryStat`/`EmptyHint`/`Toast`) + shared `relativeTime`/`formatCompact` (in `components/ui/v2/format.ts`). Priority map: urgent→P1, high→P2, normal→P3, low→P4, null→none.
- `{ data }` envelope on the client; B3 mutation routes require `project_id`+`environment_id` query params.

## File Structure
```
apps/console/src/
  api/types.ts                 # MODIFY
  api/client.ts                # MODIFY
  v2/screens/registry.tsx      # MODIFY (ScreenCtx += drill/back + types)
  v2/ConsoleShellV2.tsx        # MODIFY (detail state)
  v2/screens/ErrorsScreen.tsx  # MODIFY (row → drill)  + ErrorsScreen.test.tsx update
  v2/screens/useIncident.ts        + useIncident.test.ts       # NEW (.test.ts → jsdom pragma)
  v2/screens/IncidentScreen.tsx    + IncidentScreen.test.tsx   # NEW
```

---

### Task 1: API types + client methods
**Files:** Modify `apps/console/src/api/types.ts`, `apps/console/src/api/client.ts`; extend the existing client test (find `client.test.ts` / the test that exercises `getErrorGroupIncident`/`updateErrorGroupTriage` and mirror it).

**Interfaces (Produces):**
- `types.ts`: extend `ErrorGroupIncident` to add (verbatim server shape):
  ```ts
  incidentNumber: string | null;
  assignedTo: { id: string; email: string } | null;
  silencedUntil: string | null;
  notes: { id: string; authorEmail: string; body: string; createdAt: string }[];
  ```
  Add `export type TriageNoteRecord = { id: string; errorGroupId: string; authorUserId: string | null; authorEmail: string; body: string; createdAt: string };`
  Extend `UpdateErrorGroupTriageInput` with `assignedToUserId?: string | null;`.
  Add input types: `AddTriageNoteInput = { projectId: string; environmentId: string; body: string }`; `SilenceIncidentInput = { projectId: string; environmentId: string; minutes: number | null }`.
- `client.ts`: on `ErrorGroupApiClient`, add:
  ```ts
  addTriageNote: (id: string, input: AddTriageNoteInput) => Promise<AggregateResponse<TriageNoteRecord>>;
  silenceIncident: (id: string, input: SilenceIncidentInput) => Promise<AggregateResponse<ErrorGroupRecord>>;
  ```
  `updateErrorGroupTriage` already PATCHes `/query/error-groups/:id`; ensure its body now forwards `assignedToUserId` when present.

- [ ] Step 1: Read `api/client.ts` `errorGroupIncidentPath`/`errorGroupScopeParams` + how `updateErrorGroupTriage` builds its PATCH (method/body) + the existing client test setup. Read `api/types.ts` `ErrorGroupIncident`, `UpdateErrorGroupTriageInput`, `AggregateResponse`, `ErrorGroupRecord`.
- [ ] Step 2: Write failing client tests: `addTriageNote("g1",{projectId,environmentId,body:"hi"})` issues `POST /query/incidents/error-groups/g1/notes?project_id=…&environment_id=…` with JSON body `{body:"hi"}` and returns `{data}`; `silenceIncident("g1",{…,minutes:60})` POSTs `/silence` with `{minutes:60}`; `silenceIncident(…,{minutes:null})` sends `{minutes:null}`; `updateErrorGroupTriage("g1",{…,assignedToUserId:"u1"})` PATCH body includes `assignedToUserId`. (Mirror the existing request-capturing mock in the client test.)
- [ ] Step 3: Run the console test for that file → FAIL.
- [ ] Step 4: Implement: add `triageNotePath(id, scope)` + `silenceIncidentPath(id, scope)` helpers (reuse `errorGroupScopeParams`); wire the two methods with `request<…>(path(apiBasePath, helper(...)), { method: "POST", body: JSON.stringify({...}) })` matching the existing mutation pattern; thread `assignedToUserId` into the triage PATCH body. Extend types.
- [ ] Step 5: Run → PASS.
- [ ] Step 6: `pnpm --filter @sigmon/console build` (tsc) → clean. Commit `feat(console-v2): incident-triage client methods + B3 incident types (PER-350)`.

---

### Task 2: useIncident hook
**Files:** Create `apps/console/src/v2/screens/useIncident.ts` + `useIncident.test.ts` (**start the test file with `// @vitest-environment jsdom`**).

**Interfaces (Consumes Task 1):** the client methods above + `listUsers()` (`{ users: User[] }`, admin-gated).
**Produces:**
- `useIncident({ client, projectId, environmentId, groupId, errorId, onResolved }) → { data: IncidentVM | null; status: "loading"|"ready"|"error"; reload(); resolve(); reassign(userId: string|null); silence(minutes: number|null); addNote(body: string); users: User[]|null; canReassign: boolean }`.
- `IncidentVM` fields (from `ErrorGroupIncident`): `{ severity, severityColor, status, priority: "P1"|"P2"|"P3"|"P4"|null, groupId, release: string|null, incidentNumber: string|null, openedRelative: string, assigneeEmail: string|null, title: string, origin: string, occurrenceCount: number, affectedUsers: number, affectedTenants: number, firstSeenRelative: string, lastSeenRelative: string, silencedUntil: string|null, stack: string|null, sourceMapBadge: { resolved: boolean; frameCount: number }, breadcrumbs: { kind: string; timeRelative: string; title: string }[], related: RelVM[], notes: { initials: string; authorEmail: string; timeRelative: string; body: string }[] }`.
  - `RelVM`: `{ icon: string; tone: string; title: string; sub: string; target?: { kind: "section"; section: NavSection } | { kind: "drill"; groupId: string } }` (only set `target` when a destination exists).
- Compose: fetch `getErrorGroupIncident(groupId, { projectId, environmentId, errorId })`; on mount fire `listUsers()` and set `canReassign` true on success, false on 401/403 (catch → `users:null, canReassign:false`). Gen-counter guard for stale-fetch + unmount (reuse S1/S2 pattern). `reload()` re-fetches. Mutations call the client then `reload()` (or optimistic for notes); `resolve()` calls `updateErrorGroupTriage(status:"resolved")` then `onResolved()` (the screen passes `ctx.back`). `silence(minutes)` calls `silenceIncident`. `addNote(body)` calls `addTriageNote` then reload.

- [ ] Step 1: failing test (jsdom pragma) — mock client; assert VM mapping (severityColor, priority map, assignee/"unassigned"→null, incidentNumber, relative times, breadcrumbs from stronglyRelated items, notes initials from email, related rows only when ids present); resolve→updateErrorGroupTriage(resolved)+onResolved; reassign→updateErrorGroupTriage(assignedToUserId); silence(60)/silence(null); addNote→addTriageNote+reload; listUsers 403→canReassign=false,users=null; error + loading states; stale-fetch guard.
- [ ] Step 2: `pnpm --filter @sigmon/console test -- v2/screens/useIncident` → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: → PASS.
- [ ] Step 5: commit `feat(console-v2): useIncident hook (PER-350)`.

---

### Task 3: IncidentScreen component
**Files:** Create `apps/console/src/v2/screens/IncidentScreen.tsx` + `IncidentScreen.test.tsx`. Port `.claude/design-v2/app-screens-a-incident.jsx` (`IncidentScreen` + `RelItem`), English copy.

**Interfaces:** `IncidentScreen({ ctx, groupId, errorId })` where `ctx: ScreenCtx` (has `client`, `activeProject`, `activeEnvironment`, `navigate`, `drill`, `back`, `pushToast`). Calls `useIncident({ client: ctx.client, projectId, environmentId, groupId, errorId, onResolved: ctx.back })`.
- Sections (design order): **header** (severity tag, `StatusPill`, group-id tag, release tag; meta line `INC-#### · opened {openedRelative} · assigned to {email|unassigned}`; mono `<h1>` title; origin line); **action bar** (`ConfirmButton` Resolve → `resolve()`; Reassign → opens a small user `<select>`/menu from `users`, calls `reassign(id)` — disabled with hint when `!canReassign`; Silence → `silence(60)` or, when `silencedUntil` in future, show "Silenced until {time}" + Unsilence `silence(null)`; Create issue → `ctx.pushToast("GitHub issue creation is not available yet")` stub; Copy link → clipboard + toast; right-side priority/occurrence/users/tenants tags); **occurrences** — OMIT bars (render a one-line summary: "{occurrenceCount} occurrences · first {firstSeenRelative} · last {lastSeenRelative}"); **stack trace card** (read-only `<pre>` of `vm.stack` (metadata only), "source maps resolved" ok-badge when `sourceMapBadge.resolved` with frameCount; EmptyHint if no stack); **breadcrumbs accordion** (collapsible local state; rows from `vm.breadcrumbs`; EmptyHint if none); **impact grid** (Users/Tenants/First seen/Last seen); **related signals** (`RelItem` rows from `vm.related`; click routes via `ctx.navigate(section)` or `ctx.drill("incident",{groupId})` per `target`; static when no target); **triage notes** (list from `vm.notes`; add-note input → `addNote(body)`; EmptyHint "No triage notes yet").
- Loading → skeleton/`EmptyHint`; error → `EmptyHint` "Couldn't load this incident" + retry (`reload`).
- A back affordance (← in `PageHead` or a Back button) → `ctx.back()`.

- [ ] Step 1: failing test — feed a mock `ctx` (mock `client` or mock `useIncident`); assert: header (INC#, assignee, mono title, status pill); Resolve is a two-step `ConfirmButton` and calls resolve→back; Silence shows state; Create issue → stub toast (no network); Copy link; occurrences summary present and NO `<svg>`/bars fabricated; stack metadata + resolved badge when cached; breadcrumbs toggle; impact grid counts; related rows only for present data + click routes; notes list + add; reassign disabled when `canReassign` false; English-only (no pt-BR; if asserting no legacy brand, split the needle).
- [ ] Step 2: → FAIL.
- [ ] Step 3: implement (port design; English copy; F1 primitives; `RelItem` local subcomponent).
- [ ] Step 4: → PASS.
- [ ] Step 5: commit `feat(console-v2): IncidentScreen (PER-350)`.

---

### Task 4: drill/back navigation in the shell + S2 wiring
**Files:** Modify `apps/console/src/v2/screens/registry.tsx` (ScreenCtx type), `apps/console/src/v2/ConsoleShellV2.tsx` (detail state), `apps/console/src/v2/screens/ErrorsScreen.tsx` (row → drill); update `ErrorsScreen.test.tsx` + add shell tests.

**Interfaces:**
- `registry.tsx`: add `export type DrillTarget = "incident";` `export type DrillParams = { groupId: string; errorId?: string };` extend `ScreenCtx` with `drill: (target: DrillTarget, params: DrillParams) => void;` and `back: () => void;`.
- `ConsoleShellV2.tsx`: add `const [detail, setDetail] = useState<{ target: "incident"; groupId: string; errorId?: string } | null>(null);`. `drill = (target, params) => setDetail({ target, ...params })`; `back = () => setDetail(null)`. When changing nav section, call `setDetail(null)` first. Build `ctx` with `drill`/`back`. Render: `detail ? <IncidentScreen ctx={ctx} groupId={detail.groupId} errorId={detail.errorId}/> : renderSection(activeSection, ctx)`. (Keep the existing "Loading project…" guard ahead of all this.)
- `ErrorsScreen.tsx`: change row `onClick` from `navigate("incidents")` to `ctx.drill("incident", { groupId: row.id, errorId: row.latestErrorId ?? undefined })`. (Row VM already has `id`; ensure `latestErrorId` is available on the row VM — if `useErrors` row VM lacks it, thread it through, else pass only `groupId`.)

- [ ] Step 1: failing tests — (a) `ConsoleShellV2`: invoking `ctx.drill("incident",{groupId:"g1"})` renders `IncidentScreen` (assert an incident-detail marker) instead of the section; `ctx.back()` returns to the section; selecting a different NavRail section clears detail. (b) `ErrorsScreen`: clicking a row calls `drill("incident",{groupId:row.id,...})` (spy on ctx.drill) — update the old `navigate("incidents")` assertion. Mock `useIncident`/client so IncidentScreen renders without network.
- [ ] Step 2: → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: → PASS; full console suite green.
- [ ] Step 5: commit `feat(console-v2): drill/back navigation + Errors→Incident drill (PER-350)`.

---

### Task 5: Full S3 verification
- [ ] `pnpm --filter @sigmon/console test` → pass.
- [ ] `pnpm --filter @sigmon/console build` → clean (watch for any inline-mock `ApiClient` test files needing the 2 new client methods — add them to those mocks).
- [ ] `pnpm test` repo-wide → green (branding + jsdom). Fix any `.test.ts`-needs-jsdom or literal-SignalHub gotcha proactively.
- [ ] `pnpm build` repo-wide → clean.
- [ ] Manual `/?v2=1` → Investigate → click error row → v2 Incident opens; resolve/assign/silence/add-note work; back → Investigate; legacy unaffected.

## Notes
- The biggest cross-file gotcha: adding client methods means **every inline `ApiClient`/`ErrorGroupApiClient` mock in existing tests** may need the 2 new methods to satisfy tsc. Grep for mocks that construct an error-group client and add `addTriageNote`/`silenceIncident` stubs (this bit F2/S1 before — handle proactively in Task 1 or Task 5).
- Reuse S1/S2's gen-counter stale-fetch pattern verbatim in `useIncident`.
- `relativeTime`/`formatCompact` live in `apps/console/src/components/ui/v2/format.ts` — do not duplicate.
- Keep the legacy `IncidentView`/`InvestigationWorkspace` untouched (parallel, behind the flag).

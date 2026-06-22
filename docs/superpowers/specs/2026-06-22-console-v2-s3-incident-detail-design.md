# S3 · Console v2 — Incident detail screen

**Epic:** SignalMonitor Console v2 — dark redesign
**Issue:** PER-350
**Date:** 2026-06-22
**Status:** Draft for review
**Depends on:** F1, F2, S1, S2, **B3** (all merged). Branch `feat/console-v2-s3-incident-detail` off main.

## Goal

Port the v2 **Incident detail** screen (`IncidentScreen`) and make it the drill target for an error group/incident. Design source: `.claude/design-v2/app-screens-a-incident.jsx`. English copy (translate the pt-BR strings). This is the **first v2 screen with write actions** — the CLAUDE.md "read-only unless a design explicitly introduces a mutation workflow" constraint is satisfied because the incident-triage design explicitly defines resolve/assign/silence/add-note workflows (backed by B3).

## Navigation model (decided — drill/back on ScreenCtx)

The v2 shell currently exposes only `navigate(section: NavSection)`. S3 introduces **drill-to-detail**, reused later by S4→S3, S7, and S1 drills.

- Extend `ScreenCtx` (`apps/console/src/v2/screens/registry.tsx`) with:
  - `drill: (target: DrillTarget, params: DrillParams) => void` — currently `target: "incident"` with `params: { groupId: string; errorId?: string }`. The union is open for `"tenant"` later.
  - `back: () => void` — clears the active detail, returning to the section beneath.
- `ConsoleShellV2` holds `detail: { target: "incident"; groupId: string; errorId?: string } | null` state. When `detail !== null`, the shell renders the detail view (`IncidentScreen`) **in place of** the active section's screen; NavRail/TopBar/HealthRail chrome stays. Selecting any nav section (NavRail) clears `detail` first, then navigates.
- The shell passes the full `ScreenCtx` (now incl. `drill`/`back`) into both section screens and the detail screen.
- **S2 wiring:** `ErrorsScreen` row click changes from `navigate("incidents")` to `drill("incident", { groupId: row.id, errorId: row.latestErrorId ?? undefined })`. (Update S2's test accordingly.)
- The legacy `incidents` nav **section** stays legacy (`InvestigationWorkspace`) until S4 flips it. The incident **detail** is a drill target rendered by the shell, not a registry section — so `registry.tsx` `SCREENS` is unchanged except for the `ScreenCtx` type extension.

## Data wiring

`useIncident(ctx, { groupId, errorId })` composes the detail fetch + mutations:

- **`getErrorGroupIncident(groupId, { projectId, environmentId, errorId? })`** → `AggregateResponse<ErrorGroupIncident>`. **The console `ErrorGroupIncident` type in `api/types.ts` is STALE** — extend it to match the server (`packages/db/src/repositories/incidents.ts`): add `incidentNumber: string | null`, `assignedTo: { id: string; email: string } | null`, `silencedUntil: string | null`, `notes: { id: string; authorEmail: string; body: string; createdAt: string }[]`. Confirm the existing fields (`group`, `primaryOccurrence`, `priority`, `suggestedPriority`, `sourceMapResolution`, `stronglyRelated`, `nearbyContext`, `related`) already match; fix any drift.
- **Mutations (add 3 client methods + extend 1):** in `api/client.ts` + `api/types.ts`, following the existing `*Path()` + `request<T>(path(...), { method, body })` pattern:
  - Extend `UpdateErrorGroupTriageInput` with `assignedToUserId?: string | null`; the existing `updateErrorGroupTriage(id, input)` already PATCHes `/query/error-groups/:id` — assign rides along.
  - `addTriageNote(id, { projectId, environmentId, body })` → `POST /query/incidents/error-groups/:id/notes` → `AggregateResponse<TriageNoteRecord>`. Add `TriageNoteRecord` type.
  - `silenceIncident(id, { projectId, environmentId, minutes })` → `POST /query/incidents/error-groups/:id/silence` → `AggregateResponse<ErrorGroupRecord>`.
  - `getIncidentMttr({ projectId, environmentId, window })` → `GET /query/incidents/mttr` → `AggregateResponse<{ mttrMs: number | null; resolvedCount: number; windowDays: number }>`. (Not used by S3 itself; defer to S4 — **do not add unless needed**. S3 omits it.)
- **Assignee picker:** `listUsers()` exists but is **admin-gated** (`GET /admin/users`). The picker calls `listUsers()`; on 401/403 (non-admin), **degrade**: show the current assignee read-only and disable the Reassign control with a hint ("Admin access required to reassign"). Do not fabricate a user list.

### View-model (`IncidentVM`) field map
- **Header:** severity (`group.severity` → sev color), status (`group.status` → `StatusPill`), group id (`group.id`), release (`group.latestRelease` or `related.release`), `incidentNumber` (or "—"), opened = `relativeTime(group.firstSeenAt)`, assignee = `assignedTo?.email ?? "unassigned"`, title = `group.message` (mono), origin = `primaryOccurrence` file:line + `project.name / env`.
- **Action bar:** Resolve (`ConfirmButton` → `updateErrorGroupTriage(status:"resolved")` → toast → `back()`); Reassign (picker → `updateErrorGroupTriage(assignedToUserId)`); Silence 1h (`silenceIncident(minutes:60)` → toast; if already silenced, show "Silenced until {time}" + an Unsilence action calling `silenceIncident(minutes:null)`); Create issue (**stub** → toast "GitHub issue creation not yet available", per B3 out-of-scope); Copy link (clipboard `window.location` or a deep link → toast). Right-side tags: priority (`PriorityPill` mapped urgent→P1…low→P4), occurrence count, users/tenants counts.
- **Occurrences bars:** B3/incident detail does **not** return a per-hour occurrence series. **Degrade:** omit the bar chart's fabricated 24-bucket data; instead render a minimal occurrence summary (total `group.occurrenceCount`, first/last seen) OR, if a per-group hourly series is trivially available, wire it — it is **not** today, so **omit the bars** and file a follow-up (per-group occurrence trend endpoint). Do not fabricate the spike annotation.
- **Stack trace:** render frame **metadata only** (the CLAUDE.md constraint forbids showing original source content). Source: `primaryOccurrence.stack` (raw text) rendered read-only; show the "source maps resolved" badge when `sourceMapResolution.status === "cached"` (with `frameCount`), else no badge. Optionally fetch resolved frame metadata via the existing `GET /query/errors/:id/source-map-resolution` for the frame hint — **in scope only if a client method already exists**; otherwise render raw `stack` + badge and file a follow-up for resolved-frame rendering.
- **Breadcrumbs accordion:** map `stronglyRelated.items` (and/or `nearbyContext.items`) `IncidentTimelineItem[]` — filter to `kind === "breadcrumb"` (fall back to all kinds if none) — into the accordion rows (type colored mono | `relativeTime(timestamp)` | `title` | optional external link). Collapsible via local state. Show session context (`related.userId` · `related.sessionId`) when present. If no items, EmptyHint.
- **Impact grid (2×2):** Users affected (`group.affectedUsersCount`), Tenants (`group.affectedTenantsCount`), First seen (`relativeTime(group.firstSeenAt)`), Last seen (`relativeTime(group.lastSeenAt)`). (Design's "Sessions" cell has no backing field → replace with "Last seen"; do not fabricate a session count.)
- **Related signals (`RelItem` list):** from `related` — a trace row (`related.traceId` → `navigate("traces")` / drill when S6 lands), an LLM row only if applicable, a user/tenant row (`related.userId`/`tenantId`), and a correlated error-group row from `stronglyRelated` (first item with `kind==="error"` and a different group → `drill("incident", {...})`). Only render rows whose data exists; static (no `onClick`) when no destination yet.
- **Triage notes:** list `notes` (avatar initials from `authorEmail`, author, `relativeTime(createdAt)`, body); add-note input → `addTriageNote` → optimistic append or refetch → toast. Empty → "No triage notes yet".

## Module layout
```
apps/console/src/
  api/types.ts        # MODIFY: extend ErrorGroupIncident (B3 fields), add TriageNoteRecord, extend UpdateErrorGroupTriageInput
  api/client.ts       # MODIFY: addTriageNote, silenceIncident methods (+ *Path helpers); assignedToUserId in triage PATCH body
  v2/screens/registry.tsx   # MODIFY: ScreenCtx += drill/back (+ DrillTarget/DrillParams types)
  v2/ConsoleShellV2.tsx     # MODIFY: detail state; render IncidentScreen when detail set; clear on nav
  v2/screens/ErrorsScreen.tsx  # MODIFY: row click → drill("incident", {...}) (was navigate("incidents"))
  v2/screens/useIncident.ts    + useIncident.test.ts     # NEW: fetch + mutations + VM
  v2/screens/IncidentScreen.tsx + IncidentScreen.test.tsx # NEW: the screen
```
Reuse F1 `ui/v2` primitives: `PageHead`/`StatusPill`/`PriorityPill`/`ConfirmButton`/`Bars`/`Icon`/`Divider`/`SummaryStat`/`EmptyHint`/`Toast` + the shared `relativeTime`/`formatCompact` formatters. Add small local subcomponents (`RelItem`, note item, accordion) within `IncidentScreen.tsx` or a co-located file.

## Testing
- **useIncident** — composes getErrorGroupIncident with groupId+scope(+errorId); maps VM fields (severity color, priority P1–P4, assignee email/"unassigned", incidentNumber/"—", relative times); resolve calls updateErrorGroupTriage(status:resolved) then triggers back; reassign calls updateErrorGroupTriage(assignedToUserId); silence calls silenceIncident(60) / unsilence(null); addTriageNote appends; listUsers 403 → picker disabled flag; stale-fetch guard (gen counter, reuse S1/S2 pattern); error + loading states.
- **IncidentScreen** — renders header (tags, INC#, assignee, mono title); action bar (Resolve ConfirmButton two-step; Silence shows state; Create issue is a stub toast; Copy link); occurrences omitted (no fabricated bars); stack trace metadata + resolved badge when cached; breadcrumbs accordion toggle; impact grid real counts; related signals only for present data; triage notes list + add; non-admin reassign disabled; English-only; row of `back()`.
- **Shell/registry** — `ScreenCtx` carries `drill`/`back`; `ConsoleShellV2` renders `IncidentScreen` when `detail` set and clears it on section nav; ErrorsScreen row → `drill("incident", {groupId})`.
- No regression; full suite green; branding (no literal SignalHub — split-needle); any `.test.ts` using renderHook gets `// @vitest-environment jsdom`.

## Verification
`pnpm --filter @sigmon/console test` · `pnpm --filter @sigmon/console build` · `pnpm test` (repo, branding) · `pnpm build`. Manual `/?v2=1` → Investigate → click an error row → v2 Incident detail opens; resolve/assign/silence/add-note work; back returns to Investigate; legacy unaffected.

## Out of scope / follow-ups (PER-364)
- **Per-group hourly occurrence trend** (the design's 24h occurrences bars) — no endpoint; S3 omits the bars. Add a per-group trend endpoint, then render.
- **Resolved source-map frame rendering** (metadata-only) if no console client method exists yet — render raw `stack` + badge for now.
- GitHub issue creation (Create issue stays a stub/toast).
- MTTR client method + tile — lands with S4.
- Full tenant/trace drill destinations — when S6/S7 land (related-signal rows route to the section meanwhile).

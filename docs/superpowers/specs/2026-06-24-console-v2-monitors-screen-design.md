# Console v2 — Monitors screen (PER-368) — design spec

**Status:** approved (autonomous epic loop — controller decision; attached to PER-368 for user review)
**Design source:** none — Monitors has **no v2 comp**. This restyles the v1
`apps/console/src/components/MonitorsPanel.tsx` feature onto the now-mature v2 design
system (10 shipped screens of patterns).
**Linear:** PER-368 (epic "SignalMonitor Console v2 — dark redesign"), decided in PER-358 triage.
**Depends on:** F1 (design system), F2 (app shell) — done. Reuses the S8 Alerts + S10 Setup patterns.

---

## Goal

Add a native v2 **Monitors** screen — a new top-nav section — that manages HTTP uptime
checks and heartbeat monitors: a status rollup, a monitors list with per-monitor check
history, inline create (HTTP + heartbeat), inline edit, archive, and notification-channel
assignment. The heartbeat check-in secret + URL are shown once at creation.

This also **re-homes the monitor-status rollup** (HTTP/heartbeat up/down/degraded counts)
that retiring the v1 Operations dashboard would otherwise drop (PER-358 decision).

## Why a new nav section (not a fold)

PER-358 decided Monitors stays a first-class capability with its own nav item. It is a
distinct operational surface (uptime/liveness), not config (Setup) or internal health
(System). It slots into the top `NAV` group after **Alerts** (its closest sibling —
alerting + monitoring are the "is it healthy / will I be paged" pair).

## Mutation-screen justification

Like S10 Setup, this is an **explicit mutation screen** (create/edit/archive monitors,
generate heartbeat secret). The project constraint "keep Overview and investigation views
read-only unless a design explicitly introduces a mutation workflow" is satisfied: this
design explicitly introduces those flows. Monitor routes are **admin** routes
(`/admin/monitors/*`) — the console's existing admin session gates them; no new auth work.

## Architecture

Same shape as every prior v2 screen:

- **`useMonitors.ts`** — a pure VM builder `buildMonitorsVM(input, nowMs)` + a race-guarded
  data hook `useMonitors({ client, projectId, environmentId })` that loads monitors +
  notification channels in parallel and exposes mutation actions + lazy check-history
  loading. Builder is pure/deterministic (takes `nowMs`) and unit-testable. Hook mirrors
  `useAlerts`/`useSetup` byte-for-byte (genRef race guard, `tick`/`reload`, cleanup).
- **`MonitorsScreen.tsx`** — a flat `MonitorsScreen({ ctx }: { ctx: ScreenCtx })` consuming
  the hook's VM and rendering the design with existing `ui/v2` primitives and `.sh-*` CSS.
  **No new CSS, no new shared components** (recon confirmed every class/component exists).
- **nav + registry wiring** — add `"monitors"` to the `NavSection` union, a `NAV` item
  (`icon: "pulse"`, after Alerts), and a `SCREENS` entry (`kind: "v2"`). Adding to the union
  is TS-enforced across every `Record<NavSection, …>` (at least `SCREENS`).

### Optional-client guard (important)

All monitor methods are **optional** on `ApiClient` (`Partial<MonitorApiClient>`), as is
`listNotificationChannels`. The hook must guard for their absence: if `client.listMonitors`
is undefined, the screen renders an `EmptyHint` ("Monitors API unavailable") instead of
calling it. Mutation actions that need an absent method are disabled. This mirrors how
`getOperations?` was guarded in S10.

## Backend contract (verbatim from recon — types.ts / client.ts)

- `MonitorKind = "http" | "heartbeat"`; `MonitorStatus = "unknown" | "up" | "down" |
  "degraded" | "paused"`; `MonitorCheckStatus = "success" | "failed"`.
- `MonitorResponse` carries: identity (`id`, `projectId`, `environmentId`,
  `notificationChannelId`), `kind`, `name`, `enabled`, `status`; HTTP fields (`url`,
  `method`, `expectedStatus`, `bodyContains`, `timeoutMs`, `intervalMinutes`); heartbeat
  fields (`expectedIntervalMinutes`, `graceMinutes`, `lastHeartbeatAt`); thresholds/counters
  (`failureThreshold`, `recoveryThreshold`, `consecutiveFailures`, `consecutiveSuccesses`);
  last-check (`lastCheckedAt`, `lastCheckStatus`, `lastCheckLatencyMs`,
  `lastCheckResponseStatus`, `lastCheckErrorMessage`); `createdAt`, `updatedAt`, `archivedAt`.
- `MonitorCheckResponse`: `{ id, monitorId, checkedAt, status, latencyMs, responseStatus,
  errorMessage, createdAt }`.
- `MonitorListQuery = { projectId, environmentId, kind? }`.
- `CreateHttpMonitorInput`, `CreateHeartbeatMonitorInput` (see recon; HTTP needs `name`+`url`,
  heartbeat needs `name`+`expectedIntervalMinutes`).
- Client (all OPTIONAL): `listMonitors(query) → { monitors }`;
  `createHttpMonitor(input) → { monitor }`; `createHeartbeatMonitor(input) → { monitor, secret }`;
  `updateMonitor(id, Partial<Http & Heartbeat>) → { monitor }`; `archiveMonitor(id) → void`;
  `listMonitorChecks(id, limit?) → { checks }`. Also needs `listNotificationChannels` (optional).

### Status mapping (MonitorStatus → v2 `Status`)

`up → "ok"`, `degraded → "warning"`, `down → "critical"`, `paused → "idle"`,
`unknown → "idle"`. Used for `StatusDot` and rollup tags.

## Screen layout

1. **PageHead** — title `Monitors`, sub `HTTP uptime and heartbeat checks for {project} /
   {env}.`, actions: a `Segmented` kind filter `["All", "HTTP", "Heartbeat"]` + a primary
   `New monitor` button that reveals the inline create panel.
2. **Status rollup card** (re-homes the Operations gap) — compact tiles/tags: **Up**,
   **Degraded**, **Down**, **Paused** counts, plus **total**, **enabled**, and a
   **without-channel** warning count. Tones via `sh-tag` (ok/warn/critical/idle/solid).
3. **Create panel** (revealed by `New monitor`, hidden by default) — a `Segmented` HTTP /
   Heartbeat toggle, then the kind-specific fields:
   - HTTP: `name`, `url` (validated), `intervalMinutes` (default 5), `timeoutMs` (default
     5000), optional channel `<select>`.
   - Heartbeat: `name`, `expectedIntervalMinutes` (default 5), `graceMinutes` (default 2),
     optional channel `<select>`.
   - Submit calls the matching create action. On heartbeat create, the returned `secret` +
     check-in URL (`{endpoint}/v1/heartbeats/{id}`) render once in a `sh-stripe ok` banner
     with `SecretField` + a copyable URL (S10 pattern). Errors → `pushToast`, panel stays open.
4. **Monitors list** (`sh-card` flush, `sh-row`) — one row per monitor: `StatusDot(status)`
   + name + `kind` tag + target (url for HTTP / "Heartbeat check-in" for heartbeat) + cadence
   (`every Nm` / `expects Nm ± Nm`) + last-checked relative time + channel name (or a
   `without channel` warn tag) + edit + archive icon buttons. A disabled monitor shows a
   muted/`paused` treatment. Clicking a row selects it and lazy-loads its check history.
5. **Check history** (under the selected monitor) — recent checks from `listMonitorChecks`:
   each row = status dot + relative `checkedAt` + `responseStatus` + `latencyMs ms` +
   `errorMessage` (if any). Loading + empty states inline.
6. **Inline edit** — the edit icon turns the row into an inline editor (name, enabled toggle,
   channel, + kind-specific fields); commit calls `updateMonitor`.
7. **Archive** — `ConfirmButton` (2-click): "Archive" → "Confirm?". Tooltip notes historical
   checks are retained.

## States

- **API unavailable** — `client.listMonitors` absent → `EmptyHint` (`icon="server"`,
  "Monitors API unavailable").
- **Loading** — `EmptyHint` (`icon="activity"`), matching prior screens.
- **Error** — `EmptyHint` (`icon="alert"`) with the error message.
- **Empty** — no monitors → `EmptyHint` ("No monitors yet") + a CTA opening the create panel.
- **No project/environment** — the shell guards this before `renderSection`; the screen
  assumes `ctx.project`/`ctx.environment` are defined (consistent with other screens). The
  hook still guards `if (!projectId || !environmentId) return`.
- **Mutation errors** — caught, surfaced via `ctx.pushToast`; inline form stays open.

## Determinism / time

All relative-time formatting goes through a local `relativeTimeFrom(iso, nowMs)` (same as
S9/S10); only the hook reads `Date.now()`, once per load, and passes it to the pure builder.

## Testing

- `useMonitors.test.ts` (jsdom line 1) — pure `buildMonitorsVM` cases: status mapping for all
  5 `MonitorStatus` values; rollup counts (up/degraded/down/paused/total/enabled/no-channel);
  HTTP vs heartbeat row fields (target, cadence label); channel-name resolution + without-channel
  flag; relative-time determinism via fixed `nowMs`; `listMonitors`/`listNotificationChannels`
  absent → unavailable VM. Hook race-guard mirrors `useAlerts` tests.
- `MonitorsScreen.test.tsx` (jsdom line 1) — renders rollup + list; kind filter switches list;
  create-panel HTTP submit calls `createHttpMonitor`; heartbeat submit calls
  `createHeartbeatMonitor` and reveals the one-time secret; selecting a row loads + shows check
  history; edit commits `updateMonitor`; archive 2-click calls `archiveMonitor`; API-unavailable
  state. Use `getAllByText`/`within` for any duplicated copy; never rename design copy.
- `registry.test.tsx` — `monitors` is `kind: "v2"`; renders the v2 screen **not** wrapped in
  `.console-legacy-island`. Confirm nav exhaustiveness compiles (`SCREENS` covers `monitors`).
- Full gate: `pnpm test`, `pnpm build`, `pnpm --filter @sigmon/sdk build`, `docker compose
  config` — all green; no regression.

## Cross-file impact (final-review watch list)

Adding `"monitors"` to `NavSection` forces every exhaustive `Record<NavSection, …>` / switch
to handle it. Recon found `SCREENS` (TS will error until updated). The plan must grep for
`Record<NavSection`, `NavSection]` and `switch (… section` across `apps/console/src` and the
nav/badge logic, and the final whole-branch review must verify no sibling test asserts the old
nav length/shape (lesson from S10: a section flip broke `ConsoleShellV2.test.tsx`).

## Out of scope (follow-ups → PER-364)

- Per-monitor inline pause/resume toggle outside the edit form (edit covers `enabled`).
- HTTP advanced fields not surfaced by v1 (`method`, `expectedStatus`, `bodyContains`,
  thresholds) — keep parity with v1's create form (GET / 2xx / thresholds defaulted); advanced
  editing deferred.
- Removing the v1 `monitors` mount from `ConsoleShell.tsx` at epic-exit cleanup.
- A monitors mini-rollup on the v2 Overview (only the Monitors screen carries it for now).

## Constraints honored

- Dark-only, `.sh-v2`-scoped, **English UI**, maximum fidelity to the established design language.
- Heartbeat secret shown once at creation; never re-revealed.
- No new dependencies → no `pnpm-lock.yaml` change.
- Read-only-default exception satisfied (explicit mutation workflow).

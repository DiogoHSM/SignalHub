# S8 · Console v2 Alerts screen — Design Spec

**Linear:** PER-355 (S8 · Alerts screen). Epic: SignalMonitor Console v2 — dark redesign.
**Design source:** `app-screens-c.jsx` → `AlertsScreen`, `FiresTimeline`, `Suggestion` (claude.ai design project `019de713-879f-726c-9f57-2fc4220947a3`, pulled fresh 2026-06-23).
**Status:** Read-focused v2 screen with toast-stubbed mutation affordances, mirroring the design mock (which itself stubs every action as a `toast`).

---

## Goal

Port the "Alerts" screen of the SignalHub Console v2 design into `apps/console` with maximum visual fidelity, wired to the **already-complete** alerts backend (rules, events, channels). Flip the console registry `alerts` entry from the legacy `AlertsPanel` to the new v2 `AlertsScreen`.

## Architecture

- **Flat section screen** `AlertsScreen({ ctx }: { ctx: ScreenCtx })` — same shape as `LlmScreen`/`TracesScreen`. **No** shell drill target, **no** `ConsoleShellV2` change, **no** `registry` type change beyond flipping the `alerts` entry.
- **`useAlerts` hook** (race-guarded, identical generation-counter pattern to `useLlm`) fetches three sources in parallel and returns a view-model.
- **Pure `buildAlertsVM(input, nowMs)`** transforms raw API arrays into the VM. Exported and unit-tested in isolation; the hook calls it with `Date.now()`, tests pass a fixed `nowMs` for determinism.

## Data sources (backend is complete — no B-task)

All three methods are **required** on `ApiClient` (so test mocks must provide all three):

| Method | Returns | Use |
|---|---|---|
| `listAlertRules({ projectId, environmentId })` | `{ rules: AlertRuleResponse[] }` | Rules table + active-rule count |
| `listAlertEvents({ projectId, environmentId, limit: 100 })` | `QueryListResponse<AlertEventResponse>` (`.data`) | Fires timeline + per-rule 7d counts + header fires count |
| `listNotificationChannels()` | `{ channels: NotificationChannelResponse[] }` | Channels card + resolve each rule's channel name |

Relevant response shapes (verbatim from `api/types.ts`):

- `AlertRuleResponse`: `id, name, type, severity, windowMinutes, threshold (string), cooldownMinutes, notificationChannelId (string|null), enabled, lastTriggeredAt (string|null), archivedAt (string|null), …`
- `AlertRuleType` = `"critical_errors" | "error_count" | "error_rate" | "trace_p95_latency" | "llm_cost"`
- `AlertSeverity` = `"info" | "warning" | "critical"`
- `AlertEventResponse`: `id, ruleId (string|null), severity, triggeredAt (string), latestDeliveryStatus ("success"|"failed"|null), …`
- `NotificationChannelResponse` (union): `type:"webhook" → { url: string, … }` · `type:"email" → { emailRecipients: string[], url: null, … }`; both have `id, name, enabled, archivedAt`.

## View-model (`buildAlertsVM`)

```
AlertSeverity = "info" | "warning" | "critical"

AlertsVM = {
  header: { activeRuleCount: number; fires7d: number };
  rules: AlertRuleRowVM[];
  channels: ChannelRowVM[];
  timeline: TimelineDayVM[]; // exactly 7, oldest→newest (today last)
}

AlertRuleRowVM = {
  id: string;
  name: string;
  subLabel: string;        // `${type} · ${threshold} · ${windowMinutes}m`
  severity: AlertSeverity;
  severityTag: "critical" | "warn" | "";  // info → "" (neutral tag)
  enabled: boolean;        // true → "● active", false → "paused"
  channelLabel: string;    // resolved channel name, or "Unassigned"
  fires7d: number;         // count of events with ruleId === id in last 7d
}

ChannelRowVM = {
  id: string;
  name: string;
  icon: "webhook" | "mail";   // by type
  target: string;             // webhook → url ; email → emailRecipients.join(", ")
  ok: boolean;                // enabled → accent/ok ; else warning
}

TimelineDayVM = {
  label: string;              // UTC weekday + day-of-month, e.g. "Mon 18"
  fires: { hourFraction: number; tone: "critical" | "warn" }[];
}
```

### Derivation rules

- **activeRuleCount** = rules where `enabled === true && archivedAt == null`.
- **fires7d (header)** = events with `triggeredAt` within `[nowMs - 7d, nowMs]`.
- **subLabel** = `` `${type} · ${threshold} · ${windowMinutes}m` `` — raw type, raw threshold value, window minutes. No invented operators or units (honest to the data; design's pre-baked threshold strings are not reproducible from numeric backend fields).
- **severityTag**: `critical → "critical"`, `warning → "warn"`, `info → ""`. Severity **text** is the raw severity uppercased.
- **channelLabel**: look up `notificationChannelId` in the channels list → that channel's `name`; if `notificationChannelId == null` or not found → `"Unassigned"`.
- **rule.fires7d**: count of events with `ruleId === rule.id` and `triggeredAt` within the last 7 days.
- **Timeline buckets** (the one nuanced algorithm):
  - Build 7 UTC calendar-day columns ending on **today** (the UTC day of `nowMs`): index 0 = 6 days ago … index 6 = today.
  - For each event in the last 7 days: `dayIndex = 6 - floor((startOfTodayUTC - startOfEventDayUTC) / 86_400_000)`. Keep only `0 ≤ dayIndex ≤ 6`.
  - `hourFraction = (UTCHours + UTCMinutes/60) / 24` (0..1), used for horizontal position.
  - `tone`: `severity === "critical" → "critical"`, else `"warn"` (warning + info both render warn-colored, matching the design's two-color heatmap).
  - `label`: `${["Sun".."Sat"][getUTCDay]} ${getUTCDate}`.
  - Invalid `triggeredAt` (NaN) events are skipped.

## Screen layout (fidelity to design)

1. **PageHead** — title `"Alerts"`, sub `` `${activeRuleCount} active rules · ${fires7d} fires in the last 7 days` ``, actions:
   - `Channels` button (`sh-btn`, icon `webhook`) → `ctx.pushToast("Channel management is not yet available")`.
   - `New rule` button (`sh-btn primary`, icon `plus`) → `ctx.pushToast("Rule editor is not yet available")`.
2. **Recent history card** (`sh-card`) — head `"Recent history"` + faint `"last 7 days"`; body renders `<FiresTimeline timeline={vm.timeline} />`. The timeline is the 7-column heatmap; each column shows day label, a framed 60px track with 6/12/18h gridlines, and a vertical bar per fire positioned by `hourFraction`, colored by `tone`. Empty (no fires across all days) → faint `"No fires in the last 7 days"`.
3. **Two-column grid** `1.6fr 1fr`:
   - **Left — Rules card**: head `"Rules"` + `Segmented(["All","Active","Paused"])`; header row `Rule / Severity / State / Channel / 7d / Actions` (grid `1.5fr 96px 90px 1fr 70px 84px`); one `AlertRuleRow` per filtered rule. Filter: `All` = all, `Active` = `enabled`, `Paused` = `!enabled`. Each row: name (strong) + faint mono `subLabel`; severity tag (`sh-tag {severityTag}`, uppercase); state tag (active = accent "● active", paused = muted "paused"); channel label; `fires7d` (mono, critical-colored when `> 0`, else muted); action buttons edit / pause-or-resume / archive (all `pushToast` stubs). Empty → `EmptyHint "No alert rules"`.
   - **Right — Channels card**: head `"Channels"` + ghost `+` button (`pushToast` stub); body lists `ChannelRow` per channel: icon (accent if `ok`, warning if not), name, faint mono ellipsized `target`, `test` tag-button (`pushToast` stub). Empty → `EmptyHint "No channels"`.

### NOTABLE DIVERGENCES (flagged, all logged to PER-364 / tracked against PER-347)

1. **AI Suggestions card OMITTED.** The design's third card ("Sugestões") renders three hard-coded fake-AI suggestions. There is **no backend suggestions engine** — it is exactly the deliverable of **B4 (PER-347), which is still Backlog**. Rendering fabricated suggestions as if real would be dishonest (same principle applied in S7's features-used handling). The card is deferred until B4 lands; the right column ships with the Channels card only. Tracked as the S8↔B4 dependency.
2. **All mutations are toast stubs.** New rule / Channels / edit / pause-resume / archive / test-channel / add-channel are `pushToast` placeholders, matching the design mock (which stubs every action). **Real alert/channel CRUD remains fully available in the legacy console** (`ConsoleShell.tsx` renders `AlertsPanel` directly — untouched by this change), so flipping the v2 registry is lossless at the product level. Porting real CRUD into v2 is a later-phase follow-up.
3. **Threshold rendering.** Design shows pre-baked human strings ("≥ 1 in 5min"). Backend exposes a numeric `threshold` + separate `windowMinutes` + `type`; we render the faithful `type · threshold · windowMinutes m` rather than invent per-type operators/units.
4. **Channel icons limited to webhook/email.** Design shows slack/discord/pagerduty/mail icons; backend models every webhook destination as `type:"webhook"` (Slack/PagerDuty/Discord are all webhook URLs) plus `type:"email"`. Icon is derived from `type` only (`webhook`/`mail`).

## Constraints honored

- **English UI copy** (CLAUDE.md), though the design source is pt-BR.
- **`.sh-v2` scoping** + dark-only theme, via the existing v2 primitives/CSS (no new global CSS needed — all classes `sh-card`, `sh-row`, `sh-tag`, `sh-btn`, `sh-iconbtn-sm`, `alert-row` already exist from F1).
- **Read-only investigation default**: this screen reads alert config + history and stubs mutations; no write path is introduced in v2. (Alerts is a config surface, not an investigation view; the design explicitly shows mutation affordances, but we ship them stubbed.)
- No new backend, no source-map/source content, no secrets surfaced (channel secret values are never returned by `listNotificationChannels` — only `hasSecret`).

## Testing

- `useAlerts.test.ts` (**`// @vitest-environment jsdom` line 1**): pure `buildAlertsVM` cases (rule mapping incl. severity tag + channel resolution + subLabel; `fires7d` per rule; header counts; **timeline bucketing** — event today, event 6 days ago, event 7+ days ago excluded, hourFraction, critical vs warn tone, NaN skipped; empty inputs) + hook (loads ok, race-guard discards stale).
- `AlertsScreen.test.tsx` (**jsdom line 1**): guard (no project), loading, error; renders head counts; renders a rule row (name, severity tag, state, channel, 7d); Segmented filter narrows to paused; renders a channel row; New-rule / test-channel buttons call `pushToast`; empty-rules and empty-channels hints.
- `registry` test: `alerts` entry is `kind:"v2"`.
- **Duplicate-text rule**: pre-disambiguate every assertion on a string that legitimately appears 2+ times (e.g. severity text vs column header, "active" in state tag vs sub copy) with `getAllByText(...).length >= 1` or `within(card)`. Never rename design copy to dodge a collision.

## Tasks

- **T1** — `apps/console/src/v2/screens/useAlerts.ts`: VM types + pure `buildAlertsVM(input, nowMs)` + `useAlerts` hook + `useAlerts.test.ts`.
- **T2** — `apps/console/src/v2/screens/AlertsScreen.tsx`: screen + `FiresTimeline` + `AlertRuleRow` + `ChannelRow` subcomponents + `AlertsScreen.test.tsx`.
- **T3** — `apps/console/src/v2/screens/registry.tsx`: flip `alerts` legacy→v2 (`<AlertsScreen ctx={ctx} />`), drop the now-unused `AlertsPanel` import (component file + `ConsoleShell.tsx` usage untouched) + registry test asserting `kind:"v2"`.

No new formatter is needed (`relativeTime`, `formatCompact` already exist). `buildAlertsVM` owns all alert-specific derivation.

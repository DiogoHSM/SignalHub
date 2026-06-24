# PER-371 — Alerts (S8) made real + heuristic suggestions

**Status:** Approved (brainstorm 2026-06-24)
**Linear:** PER-371 (child of PER-347; sibling PER-372 = system actions, built after)
**Project:** SignalMonitor Console v2 — dark redesign

## Goal

Turn the stubbed v2 `AlertsScreen` (S8) into a working surface, backed by:
1. a **new read-only suggestions endpoint** that derives candidate alert rules from recent telemetry (deterministic heuristics, not an LLM), and
2. a **new SSRF-safe channel test-send route**.

All other AlertsScreen actions wire to the **already-existing** alert-rule and notification-channel CRUD backend.

## Background / current state

- Backend already has full CRUD: `/admin/alert-rules` (GET/POST/PATCH/DELETE) and `/admin/notification-channels` (GET/POST/PATCH/DELETE), plus `GET /alerts/events`. ApiClient already exposes `listAlertRules`, `createAlertRule`, `updateAlertRule`, `archiveAlertRule`, `listAlertEvents`, `getAlertEvent`, and notification-channel CRUD.
- `evaluateAlertRule()` in `packages/db/src/repositories/alerts.ts` already computes the aggregations the suggestions reuse: critical-error count, error count, error rate, trace p95 latency, LLM cost over a window.
- `deliverNotification({ channel, payload, ... })` in `apps/worker/src/alerts.ts` already delivers webhook + email with the SSRF guard (`assertSafeResolvedAddresses` / `assertSafeWebhookHost`) built in.
- `apps/console/src/v2/screens/AlertsScreen.tsx` renders rules, channels, and an events timeline, but **every mutating control is a `pushToast` stub** (new rule, edit, pause, archive, channel management, per-channel test). There is **no** Suggestions card.

### Contract facts (verbatim from `apps/console/src/api/types.ts`)

- `AlertRuleType = "critical_errors" | "error_count" | "error_rate" | "trace_p95_latency" | "llm_cost"`
- `AlertSeverity = "info" | "warning" | "critical"`
- `CreateAlertRuleInput = { projectId, environmentId, notificationChannelId?: string | null, name, type, severity, windowMinutes, threshold (string), cooldownMinutes, routePattern?: string | null, minimumSampleSize?, enabled? }`
- `notificationChannelId` is **nullable/optional** on rules → a rule can exist with no channel (it evaluates and records `AlertEvents`, but does not *deliver* until a channel is attached).
- `threshold` is a **decimal string**.
- `NotificationChannelResponse` is a webhook (`url`, optional `secretHeaderName`, `hasSecret`) or email (`emailRecipients`) variant; the secret header **value** is write-only (`hasSecret` flag only on read).
- **No** test-notification route exists today.

## Components

### 1. Backend — suggestions endpoint (new logic)

- **Route:** `GET /alerts/suggestions?project_id&environment_id` — human session, read-only (beside `/alerts/events`). Response: `{ suggestions: AlertSuggestion[] }`.
- **Logic:** `buildAlertSuggestions(db, { projectId, environmentId, now })` in `packages/db/src/repositories/alerts.ts`, reusing existing aggregation SQL. `now` injected for deterministic tests.
- **Suggestion shape:** `{ key: string, type: AlertRuleType, severity: AlertSeverity, title: string, sub: string, windowMinutes: number, threshold: string, routePattern?: string | null, minimumSampleSize?: number, rationale: string }` — every field needed to call `createAlertRule` with one click.
- **Four heuristics**, trailing **24h** window for observation, each **deduped** against active (enabled, non-archived) rules of the same `type` (and same `routePattern` for the route-scoped one). Floors/multipliers are named constants:

  | Heuristic | Fires when | Suggested rule |
  |---|---|---|
  | `critical_errors` | ≥1 critical/fatal error in 24h **and** no active critical_errors rule | threshold `"1"`, window 60, severity `critical` |
  | `error_count` (route-scoped) | busiest route's peak 15-min error count ≥ `ERROR_COUNT_FLOOR` (20) | threshold = `ceil(peak15 × 1.5)`, window 15, severity `warning`, `routePattern` = that route |
  | `trace_p95_latency` | observed 24h p95 ≥ `LATENCY_FLOOR_MS` (1000) | threshold = `round(p95 × 1.2)`, window 15, severity `warning` |
  | `llm_cost` | 24h LLM spend ≥ `LLM_COST_FLOOR_USD` (10) | threshold = `round(cost24h × 1.25, 2)` (daily cap), window 1440, severity `warning` |

  - Default `cooldownMinutes` for suggested rules: 60. `minimumSampleSize`: type default (no override unless stated).
  - Each heuristic emits **at most one** suggestion. Order in the response: critical_errors, error_count, trace_p95_latency, llm_cost.
  - Returns `[]` (not an error) when no scope data / nothing clears a floor.

- **Constants** live beside the builder and are exported for the tests to reference (so threshold math is asserted against the same source).

### 2. Backend — channel test-send (new route)

- **Route:** `POST /admin/notification-channels/:id/test` — admin session.
- Loads the channel (404 if missing/archived), builds a fixed sample `AlertWebhookPayload` (clearly marked as a test), calls the existing `deliverNotification`. **Stateless** — no `notification_deliveries` row written.
- Response: `{ status: "delivered" | "failed", responseStatus?: number | null, errorMessage?: string }`. SSRF-rejected webhooks surface as `status: "failed"` with the existing `"unsafe webhook target"` message — the guard is inherited, never bypassed.

### 3. Console API client

Add to `ApiClient` (optional methods, matching the existing source-map/monitor optional-method pattern) + `types.ts`:
- `listAlertSuggestions(query: { projectId; environmentId }) → Promise<{ suggestions: AlertSuggestionResponse[] }>`
- `testNotificationChannel(id: string) → Promise<{ status: "delivered" | "failed"; responseStatus?: number | null; errorMessage?: string }>`
- `AlertSuggestionResponse` type mirrors the backend suggestion shape.

### 4. Console — AlertsScreen wiring

A race-guarded hook (`useAlerts`, same pattern as `useMonitors`/`useArtifacts`: `genRef`, `nowMs` captured once per load, `tick`/`reload`, actions return `Promise<boolean>` — the **screen** toasts on `false`, the hook does not). It loads rules + channels + events + suggestions and exposes mutation actions. The screen renders:

- **Suggestions card** — violet `AI` tag (branding only). Each suggestion shows title + sub; one-click **Create** → `createAlertRule` with the suggestion fields, `notificationChannelId` omitted. A faint hint notes that attaching a channel enables delivery. On success: refetch suggestions + rules, the created suggestion drops out (deduped by the backend on next load).
- **Rule editor** (create + inline edit) — fields from `CreateAlertRuleInput`: name, type, severity, windowMinutes, threshold, cooldownMinutes, `routePattern` (shown only for `error_count`/`error_rate`/`trace_p95_latency`), minimumSampleSize, optional channel select. Numeric validation ported from the v1 alert pattern; threshold kept as string.
- **Pause/Resume** → `updateAlertRule(id, { enabled })`. **Archive** → `ConfirmButton` → `archiveAlertRule`.
- **Channels panel** — list + create (webhook/email Segmented toggle), edit, archive, and per-channel **Test** → `testNotificationChannel` (toast the delivered/failed result). Channel secret header **value** is a write-only input; reads show only `hasSecret`.

### 5. Testing

- **Backend:** heuristic unit tests — each heuristic fires / does-not-fire at floor boundaries, dedup against existing rules, threshold math against the exported constants, deterministic `now`, empty-scope → `[]`. Test-send route tests — delivered, failed, and SSRF-rejected paths via an injected `deliverNotification`.
- **Console:** hook tests (load, each action returns boolean, race-guard) + AlertsScreen tests (suggestion render→create, rule create/edit/pause/archive, channel create/edit/archive/test, unavailable/empty states). New DOM test files carry `// @vitest-environment jsdom` on line 1.

## Constraints honored

- Suggestions endpoint is read-only and returns metadata only; rule/channel mutations stay admin-guarded.
- Test-send reuses the existing SSRF guard — no new outbound path bypasses webhook target validation.
- Deterministic heuristics; no LLM dependency.
- English UI; `.sh-v2` CSS scoping; no new dependencies (→ no lockfile change).
- Human sessions for the read-only query route; admin session for all mutations and the test-send route.

## Out of scope (→ PER-364 follow-ups)

- Recording test-send attempts in `notification_deliveries`.
- Suggestion snooze/dismiss persistence (suggestions are recomputed each load; dedup handles created rules).
- Tuning heuristic floors from real production data.
- System actions (doctor / backup / retention triggers) — that is the sibling PER-372.

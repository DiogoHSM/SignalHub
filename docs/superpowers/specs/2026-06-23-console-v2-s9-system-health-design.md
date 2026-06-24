# S9 · Console v2 System health screen + health-history backend — Design Spec

**Linear:** PER-356 (S9 · System health screen) + **PER-367 (B5 · System health history)**. Epic: SignalMonitor Console v2 — dark redesign.
**Design source:** `app-screens-c.jsx` → `SystemScreen` (claude.ai design project `019de713-879f-726c-9f57-2fc4220947a3`, pulled fresh 2026-06-23).
**Status:** Read-focused v2 screen wired to the **already-complete** `getSystemHealth()` snapshot, **plus a new backend health-history time-series** (samples + pruning + read endpoint) so the design's per-service sparklines render real data instead of being omitted or fabricated.

---

## Goal

Port the "System health" screen of the SignalHub Console v2 design into `apps/console` with maximum fidelity, flipping the console registry `system` entry from the legacy `SigmonAdminWorkspace` to a new v2 `SystemScreen`. Because the design's service cards show 12-point sparklines and the existing `getSystemHealth()` endpoint only returns point-in-time values, this spec also adds a **bounded, self-pruning health-history backend** that periodically samples a few numeric health signals and exposes them through a new read endpoint — giving the sparklines real data without unbounded storage growth.

## Two shippable phases (one branch, sequenced)

This feature spans two subsystems. Each is independently testable and ships as its own plan + PR:

- **Phase A — B5 health-history backend** (`docs/superpowers/plans/2026-06-23-console-v2-s9b-health-history-backend.md`): DB migration + schema type + repository + config envs + worker sample job + API read endpoint + console client method/type. Ships a live, self-pruning time-series endpoint with no UI change.
- **Phase B — S9 System screen** (`docs/superpowers/plans/2026-06-23-console-v2-s9-system-screen.md`): `useSystemHealth` hook (consumes both `getSystemHealth()` and `getSystemHealthHistory()`), pure `buildSystemVM`, `SystemScreen` + subcomponents, registry flip, tests.

Phase A merges first (endpoint live), then Phase B consumes it.

---

## Phase A — Health-history backend (B5)

### Naming (avoid clash with existing code)

The existing full-health collector is already named `createSystemHealthSnapshot` returning `SystemHealthSnapshot` (`apps/api/src/system-health.ts`, mirrored in console as `SystemHealthResponse`). The new time-series feature therefore uses **"sample" / "history"** vocabulary throughout to avoid confusion:

- table `system_health_samples`; DB row interface `SystemHealthSamplesTable`; record `SystemHealthSampleRecord`
- repository `recordSystemHealthSample` / `pruneSystemHealthSamples` / `listSystemHealthSamples`
- worker `collectHealthSample` / `runHealthSampleOnce` / `startHealthSampleScheduler`
- API route `GET /system/health/history`; response type `SystemHealthSampleResponse`
- console client `getSystemHealthHistory`; console type `SystemHealthSampleResponse`

### What is sampled (compact, honest signal set)

Only numeric signals that are genuinely available and produce a meaningful trend are sampled. One row per sample:

| Column | Type | Source |
|---|---|---|
| `id` | `text PK default gen_random_uuid()::text` | — |
| `captured_at` | `timestamptz NOT NULL DEFAULT now()` | sample time |
| `postgres_latency_ms` | `integer` (nullable) | timed `select 1` |
| `redis_latency_ms` | `integer` (nullable) | timed `redis.ping()` |
| `queue_waiting` | `integer NOT NULL DEFAULT 0` | telemetry queue counts |
| `queue_active` | `integer NOT NULL DEFAULT 0` | telemetry queue counts |
| `queue_failed` | `integer NOT NULL DEFAULT 0` | telemetry queue counts |

Index: `system_health_samples_captured_at_idx ON system_health_samples(captured_at DESC)` (serves both the latest-N read and the prune-by-age delete).

**Why these five signals:** they cover the three service cards that have an honest numeric trend — Postgres (latency), Redis (latency), Worker (queue `active` = jobs in flight) — plus the BullMQ queue card. API and Scheduler have no honest numeric time-series (`api` is always `status:"healthy"` with monotonic uptime; scheduler exposes only a heartbeat timestamp), so they render status + meta **without** a sparkline rather than a fabricated one.

### Sampling job (worker scheduler)

Mirrors `startRetentionScheduler` exactly (`setInterval` + 1s startup jitter + async stop fn), registered in `apps/worker/src/main.ts` only when `runsScheduler && config.systemHealthHistory.enabled`:

- `collectHealthSample({ postgresPing, redisPing, getQueueCounts, now })` → measures pg/redis latency with a `performance.now()` timer (latency `null` on failure, never throws), reads queue counts (`0` on failure), returns the row input `{ capturedAt, postgresLatencyMs, redisLatencyMs, queueWaiting, queueActive, queueFailed }`.
- `runHealthSampleOnce({ collect, record, prune, retentionHours, now })` → `record(collect())`, then `prune({ cutoff: now() - retentionHours h })`. Wrapped so a failed sample logs and never crashes the scheduler (the generic scheduler already swallows + logs `runOnce` errors).
- Wire-up provides `postgresPing: () => sql\`select 1\`.execute(db)`, `redisPing: () => redis.ping()`, `getQueueCounts: () => telemetryQueue.getJobCounts("waiting","active","failed")`. Stop fn added to the ordered shutdown.

### Pruning (the user's explicit requirement)

Old samples are discarded on **every** run so OK-for-weeks signals never accumulate: `pruneSystemHealthSamples(db, { cutoff })` deletes `where captured_at < cutoff`, `cutoff = now − SYSTEM_HEALTH_HISTORY_RETENTION_HOURS`. With the defaults (5-min interval, 48-h retention) the table holds at most ~576 rows.

### Config (packages/config) — new env vars

Mirrors the existing `optionalPositiveInteger(default)` / boolean patterns:

| Env var | Schema | Default |
|---|---|---|
| `SYSTEM_HEALTH_HISTORY_ENABLED` | optional boolean | `true` |
| `SYSTEM_HEALTH_SAMPLE_INTERVAL_MINUTES` | `optionalPositiveInteger` | `5` |
| `SYSTEM_HEALTH_HISTORY_RETENTION_HOURS` | `optionalPositiveInteger` | `48` |

Exposed as `config.systemHealthHistory = { enabled, sampleIntervalMinutes, retentionHours }`. Documented (sanitized) in `.claude/docs/SECRETS.md` and `.env.example` per project convention.

### Read endpoint (apps/api)

`GET /system/health/history?limit=N`, registered next to `GET /system/health` in `apps/api/src/routes/system.ts` with the **same auth** (`findSessionUser` → 401 `{ error: "unauthenticated" }` if absent) and **same envelope** (`{ data: ... }`):

- `limit` parsed from query, default `60`, clamped to `[1, 480]`.
- Reads `options.system?.getHistory`; `501 { error: "system_health_history_unavailable" }` if absent; `503` on throw.
- Returns `{ data: SystemHealthSampleResponse[] }`, **oldest → newest** (chart-ready left-to-right).
- `SystemHealthSampleResponse = { capturedAt: string; postgresLatencyMs: number | null; redisLatencyMs: number | null; queueWaiting: number; queueActive: number; queueFailed: number }` (exported from `routes/system.ts`).
- `SystemHealthDependencies` gains `getHistory?: (input: { limit: number }) => Promise<SystemHealthSampleResponse[]>`. Wired in `apps/api/src/main.ts`: `getHistory: ({ limit }) => listSystemHealthSamples(db, { limit }).then((rows) => rows.map((r) => ({ capturedAt: r.capturedAt.toISOString(), postgresLatencyMs: r.postgresLatencyMs, redisLatencyMs: r.redisLatencyMs, queueWaiting: r.queueWaiting, queueActive: r.queueActive, queueFailed: r.queueFailed })))`.

`listSystemHealthSamples(db, { limit })` selects the latest `limit` rows `order by captured_at desc, id desc` then reverses to oldest→newest in JS.

### Console client (apps/console)

- `apps/console/src/api/types.ts`: add `SystemHealthSampleResponse` (identical shape to the API type).
- `apps/console/src/api/client.ts`: add `getSystemHealthHistory: ({ limit }?: { limit?: number }) => Promise<AggregateResponse<SystemHealthSampleResponse[]>>` → `GET /system/health/history` with optional `?limit=`. (Mirrors the existing `getSystemHealth` method shape.)

### Phase A testing

- **packages/db** `system-health-samples.test.ts`: `recordSystemHealthSample` inserts + maps row; `pruneSystemHealthSamples` deletes only rows older than cutoff (returns count); `listSystemHealthSamples` returns latest-N oldest→newest. (Uses the repo's mock-db convention.)
- **apps/worker** `system-health-samples.test.ts`: `collectHealthSample` returns `null` latency when a ping rejects and `0` counts when queue read rejects (never throws); `runHealthSampleOnce` records then prunes with the right cutoff (injected `now`); `startHealthSampleScheduler` ticks after jitter and the stop fn clears timers (mirrors retention scheduler test).
- **apps/api** `system.test.ts` (extend): `/system/health/history` requires auth (401); returns `501` when `getHistory` absent; returns `{ data: [...] }` oldest→newest for an authed user; clamps `limit`.

---

## Phase B — System screen (S9)

### Architecture

- **Flat section screen** `SystemScreen({ ctx }: { ctx: ScreenCtx })` — same shape as `LlmScreen`/`AlertsScreen`. No drill, no shell change, no `registry` type change beyond flipping the `system` entry.
- **`useSystemHealth({ client })` hook** — race-guarded (generation-counter pattern **identical** to `useAlerts`/`useLlm`). Instance-wide (NOT project-scoped): fetches `client.getSystemHealth()` and `client.getSystemHealthHistory({ limit: 48 })` in parallel, builds the VM with `Date.now()`. Deps `[tick]` only; `reload` bumps `tick`. No no-project guard (system health is global).
- **Pure `buildSystemVM(health, history, nowMs)`** transforms the snapshot + samples into the VM. Exported, unit-tested with fixed `nowMs`.

### View-model (`buildSystemVM`)

```
ServiceTone = "ok" | "warn" | "critical" | "idle"

SystemVM = {
  header: { statusLabel: string; statusTone: ServiceTone };  // overall status pill (replaces fabricated SLA)
  banner: { tone: "warn" | "critical"; title: string; detail: string } | null; // data-driven, null when all healthy
  services: ServiceCardVM[];   // API, Worker, Scheduler, Postgres, Redis (those the snapshot reports)
  queues: QueueRowVM[];        // the real queue(s) the snapshot reports
  retention: RetentionVM;
  backups: BackupsVM;
}

ServiceCardVM = {
  name: string;            // "API" | "Worker" | "Scheduler" | "Postgres" | "Redis"
  icon: IconName;          // server | cpu | clock | db | redis
  tone: ServiceTone;
  statusLabel: string;     // "healthy" | "degraded" | "unhealthy" | "idle" | "not expected"
  meta: string;            // real per-service line (uptime / latency / heartbeat)
  spark: number[] | null;  // real series from history (Postgres/Redis/Worker) or null (API/Scheduler)
}

QueueRowVM = { name: string; waiting: number; active: number; completed: string; failed: number; tone: ServiceTone };
RetentionVM = {
  enabled: boolean; subLabel: string;       // e.g. "every 60m · last run 12m ago" or "disabled"
  rows: { label: string; retentionLabel: string; deleted: number }[]; // 6 data types: days + last-run deleted count
};
BackupsVM = {
  subLabel: string;                          // "every 24h · keep 14d · S3 on/off"
  latest: { filename: string; meta: string; ok: true } | null;  // latest success
  failure: { meta: string } | null;          // latest failure (if present)
  stale: boolean;
};
```

### Derivation rules

- **header.status**: from `health.status` (`healthy → ok "Operational"`, `degraded → warn "Degraded"`, `unhealthy → critical "Unhealthy"`).
- **services** (in fixed order API, Worker, Scheduler, Postgres, Redis; include only those present — all five always present in the type):
  - tone mapping `healthy→ok`, `degraded→warn`, `unhealthy→critical`; for worker/scheduler when `expected === false` → tone `idle`, statusLabel `"not expected"`.
  - meta lines from real fields: **API** `uptime ${formatUptime(uptimeSeconds)}`; **Postgres** `latency ${latencyMs ?? "—"}ms`; **Redis** `latency ${latencyMs ?? "—"}ms`; **Worker/Scheduler** `${role ?? "—"} · heartbeat ${lastHeartbeatAt ? relativeTime(...) : "none"}`.
  - spark: **Postgres** = `history.map(postgresLatencyMs)`, **Redis** = `history.map(redisLatencyMs)`, **Worker** = `history.map(queueActive)`; **API/Scheduler** = `null`. A spark series with all-null/empty history → `null` (card renders without chart). Sparkline filters nulls (replace null with last-known or 0 — builder maps null→0 with a `hasData` guard; if every point is null the spark is `null`).
- **banner** (first matching, severity-ordered): any service `unhealthy` → critical; else queue `unhealthy`, retention `lastRun.status==="failed"`, or backup `latestFailure!=null`/`stale` → warn; else any service `degraded` → warn; else `null`. Title/detail composed from the matched condition (e.g. `"Redis unhealthy"` / `"Redis ping failed — cache unavailable."`). No runbook link (nothing to target).
- **queues**: map each present queue (currently `telemetry`) → row; tone `failed>0 ? warn : ok`; `completed` via `formatCompact`.
- **retention**: `subLabel` = enabled ? `every ${intervalMinutes}m${lastRun ? \` · last run ${relativeTime(lastRun.finishedAt ?? lastRun.startedAt)}\` : ""}` : `"disabled"`; rows for the six policy types (Events/Errors/Traces/Spans/LLM calls/Breadcrumbs) → `retentionLabel = \`${days}d\``, `deleted = lastRun?.deleted[key] ?? 0`.
- **backups**: `subLabel` from `every ${intervalHours}h · keep ${retentionDays}d · S3 ${s3Enabled ? "on" : "off"}`; `latest` from `latestSuccess` (`meta = \`${relativeTime(finishedAt ?? startedAt)} · ${formatBytes(sizeBytes)}\``); `failure` from `latestFailure` (`meta` = error + when); `stale = backups.stale === true`.

### Screen layout (fidelity to design)

1. **PageHead** — title `"System health"`, sub `"Self-monitoring for this SignalMonitor instance."`, actions:
   - overall-status pill `sh-pill` (dot + `header.statusLabel`) — **replaces** the fabricated "SLA 99.98%".
   - `Run doctor` button (`sh-btn`, icon `shield`) → `ctx.pushToast("Doctor is not yet available")` (endpoint ABSENT — B4/PER-347).
2. **Attention banner** (`sh-card sh-stripe {tone}`) rendered only when `vm.banner` — icon + title + muted detail. No "Ver runbook" button (dropped: no target). When `banner === null`, render nothing (or a subtle `sh-stripe ok` "All systems healthy" — **render nothing** to match design, which only shows the stripe on a problem).
3. **Service cards grid** (`repeat(N, 1fr)`, N = service count) — each `sh-card sh-stripe {ok|warn}` (critical also `warn` stripe class — only `ok`/`warn` stripe variants exist; tone drives the icon/tag color): icon + name, status tag (`sh-tag {ok|warn}`), meta line, and `<Sparkline>` when `spark != null` (else just the meta, no chart).
4. **3-column grid** (`1.2fr 1fr 1fr`):
   - **BullMQ queues card**: header `"Queues"`; rows (grid `1.4fr 70px 70px 80px 70px`) name (mono) / `{waiting} wait` / `{active} act` (accent when `>0`) / `{completed}` / `{failed} fail` (warn when `>0`). Empty → `EmptyHint "No queues"`.
   - **Retention card**: header `"Retention"` + faint `subLabel`; six rows (grid `1fr 56px 80px`) label + `retention {days}` / `{deleted}` (last-run deleted count, mono) / a thin bar proportional to `deleted` within the row set (`width = deleted / maxDeleted`). (Bar now encodes **real deleted counts**, not fabricated GB.)
   - **Backups card**: header `"Backups"`; `latest` row (check icon + filename mono + meta) when present; `failure` row (warn) when present; config `subLabel`; **`Run backup now`** `ConfirmButton` → `pushToast("Backups run on the configured schedule")` (manual-trigger endpoint ABSENT — B4/PER-347). No per-file download button (no download endpoint; single latest only). Empty (`latest == null && failure == null`) → `EmptyHint "No backups yet"`.

### NOTABLE DIVERGENCES (flagged; logged to PER-364 / tracked against PER-347)

1. **Sparklines now real, scoped to 3 services.** Resolved via the Phase-A history backend. Postgres/Redis/Worker spark from real samples; **API/Scheduler render without a sparkline** (no honest numeric time-series). (Design showed all four cards sparking fabricated data.)
2. **"SLA 99.98%" pill → real overall-status pill.** No SLA metric exists; replaced with the real `health.status`.
3. **Attention banner is data-driven, "Ver runbook" dropped.** Design hardcodes a Redis-degradation banner + runbook button; we surface the real most-severe condition and drop the link (no runbook target).
4. **BullMQ queues: the real queue set only.** Backend exposes one aggregate `telemetry` queue; design's six per-signal rows are fabricated. (Follow-up: per-signal queue breakdown — PER-364.)
5. **Retention bars encode real last-run deleted counts + retention days, not fabricated per-type GB disk usage** (no disk metrics in the backend).
6. **Backups: latest success/failure + config, not a 4-item history list; Run-backup-now / Run-doctor are toast stubs; no per-file download** (list/download/manual-backup/doctor endpoints ABSENT — B4/PER-347).
7. **Registry flip is lossless.** `ConsoleShell.tsx:958` still renders the full `SigmonAdminWorkspace` (Deploy/Storage/Security/Docs/Notifications tabs + deployment-config & ingestion-freshness cards) in the legacy console; the v2 `SystemScreen` follows the health-focused design, and the other admin surfaces stay in legacy / are X-triage (PER-358) follow-ups.

### Phase B testing

- `useSystemHealth.test.ts` (**`// @vitest-environment jsdom` line 1**): pure `buildSystemVM` cases (status pill mapping; service tone + meta incl. worker `expected:false`→idle and null latency→"—"; spark series Postgres/Redis/Worker present, API/Scheduler null, all-null history→null spark; banner severity ordering incl. null-when-healthy; queues mapping; retention subLabel + deleted rows; backups latest/failure/stale/empty) + hook (loads ok via both fetches, race-guard discards stale).
- `SystemScreen.test.tsx` (**jsdom line 1**): guards (loading, error); head status pill + Run-doctor stub toast; banner shown on degraded / absent when healthy; a service card with sparkline and one without; queue row; retention rows; backups latest + Run-backup-now stub toast; empty-state hints.
- `registry` test: `system` entry is `kind:"v2"`.
- **Duplicate-text rule**: pre-disambiguate every assertion on a string that legitimately appears 2+ times (`getAllByText(...).length >= 1` / `within(card)`). Never rename design copy to dodge a collision.

## Constraints honored

- **English UI copy** (CLAUDE.md), though the design source is pt-BR.
- **`.sh-v2` scoping** + dark-only theme via existing F1 primitives/CSS (`sh-card`, `sh-stripe`, `sh-row`, `sh-tag`, `sh-pill`, `sh-btn`, `sh-iconbtn-sm` already exist).
- **Read-only investigation default**: the screen reads health + history and stubs the three mutating actions; no write path is introduced in v2. The new backend endpoint is **read-only**; the sample job writes only to its own bounded table.
- New env vars documented (sanitized) in `.claude/docs/SECRETS.md`; no secrets surfaced; pruning keeps storage bounded.
- No source-map/source content; admin-session auth unchanged on the new route.

## Verification gate (both phases)

`pnpm test` && `pnpm build` && `pnpm --filter @sigmon/sdk build` && `docker compose config`. Phase A additionally exercises packages/db, apps/worker, apps/api suites; Phase B exercises the console suite.

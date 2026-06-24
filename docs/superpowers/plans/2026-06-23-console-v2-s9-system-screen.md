# Console v2 — S9 System health screen (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the design's "System health" screen into `apps/console` as a flat v2 screen wired to the live `getSystemHealth()` snapshot + `getSystemHealthHistory()` time-series (Phase A, already merged), and flip the registry `system` entry from legacy `SigmonAdminWorkspace` to the new v2 `SystemScreen`.

**Architecture:** Three files, mirroring the S8 Alerts screen exactly. `useSystemHealth.ts` = VM types + pure `buildSystemVM(health, history, nowMs)` + race-guarded `useSystemHealth({ client })` hook. `SystemScreen.tsx` = flat `SystemScreen({ ctx })` section + `ServiceCard`/`QueueRow` subcomponents. `registry.tsx` = flip `system` entry to v2.

**Tech Stack:** React 19, Vite, Vitest + @testing-library/react (jsdom), TypeScript ESM. Existing v2 primitives in `apps/console/src/components/ui/v2`.

## Global Constraints

- **English UI copy** (CLAUDE.md), even though the design source is pt-BR.
- **`.sh-v2` scoping, dark-only, NO new CSS.** Reuse existing classes only: `sh-card`, `sh-card__head`, `sh-card__body`, `sh-card__body.flush`, `sh-stripe` (variants `.ok` `.warn` `.critical` `.info`), `sh-tag` (variants `.ok` `.warn` `.critical` `.info` `.solid` `.mono`), `sh-row`, `sh-row__head`, `sh-h2`, `sh-btn`, `sh-mono`, `sh-faint`, `sh-muted`. **`sh-pill` does NOT exist — never use it.** The overall-status pill is an `sh-tag {tone}` span with a `●` dot.
- **Read-only.** The only actions are `Run doctor` (`ctx.pushToast`) and `Run backup now` (`ConfirmButton` → `ctx.pushToast`). No write path; the doctor/manual-backup endpoints are ABSENT (B4 / PER-347).
- **No fabricated data.** API & Scheduler render WITHOUT a sparkline (no honest numeric series). Queues = the real `telemetry` queue only. Retention bars encode real last-run deleted counts. Backups = latest success/failure + config, no download.
- **Pure builder takes explicit `nowMs`.** `buildSystemVM` does ALL time math via a local deterministic `relativeTimeFrom(iso, nowMs)` — it must NEVER call the shared `relativeTime` (which reads `Date.now()` internally and breaks test determinism).
- **Race-guard identical to `useAlerts`**: `genRef = useRef(0)`; `const gen = ++genRef.current`; guard `if (gen !== genRef.current) return` in both `.then` and `.catch`; cleanup `return () => { ++genRef.current; }`; `tick` state + `reload` bumps it. Deps `[tick]` only (system health is global — NO project/env guard).
- **Both new DOM test files carry `// @vitest-environment jsdom` as line 1.**
- **Duplicate-text rule:** any assertion on a string that legitimately appears 2+ times must use `getAllByText(...).length >= 1` or `within(card)`. Never rename design copy to dodge a collision.
- **Registry flip is lossless:** `ConsoleShell.tsx:958` still renders the full `SigmonAdminWorkspace` in the legacy console. Only the registry `system` entry flips; the `SigmonAdminWorkspace` import is removed from `registry.tsx` (now unused there) but the component file and its `ConsoleShell.tsx` usage are untouched.

---

## Verbatim interfaces this plan depends on (already in the codebase)

**`apps/console/src/api/types.ts`** (lines 866–979) — do NOT modify:

```typescript
export type SystemStatus = "healthy" | "degraded" | "unhealthy";

export type BackupHealthRun = {
  id: string;
  status: "success" | "failed";
  trigger: "scheduled" | "manual";
  startedAt: string;
  finishedAt: string | null;
  filename: string;
  sizeBytes: number | null;
  s3Bucket: string | null;
  s3Key: string | null;
  errorMessage: string | null;
};

export type SystemHealthResponse = {
  generatedAt: string;
  status: SystemStatus;
  services: {
    api: { status: "healthy"; uptimeSeconds: number };
    postgres: { status: "healthy" | "degraded" | "unhealthy"; latencyMs: number | null };
    redis: { status: "healthy" | "unhealthy"; latencyMs: number | null };
    worker: { status: SystemStatus; expected: boolean; role: "all" | "queue" | "scheduler" | null; lastHeartbeatAt: string | null };
    scheduler: { status: SystemStatus; expected: boolean; role: "all" | "queue" | "scheduler" | null; lastHeartbeatAt: string | null };
  };
  deployment: { /* ...not consumed by this screen... */ };
  queues: {
    telemetry: { status: SystemStatus; errorMessage: string | null; waiting: number; active: number; completed: number; failed: number; delayed: number };
  };
  ingestion: { /* ...not consumed... */ };
  retention: {
    enabled: boolean;
    intervalMinutes: number;
    lastRun: {
      id: string; status: "success" | "failed"; startedAt: string; finishedAt: string | null;
      deleted: { events: number; errors: number; traces: number; spans: number; llmCalls: number; breadcrumbs: number; sourceMapArtifacts: number; sourceMapFiles: number };
      errorMessage: string | null;
    } | null;
    policy: { eventsDays: number; errorsDays: number; tracesDays: number; spansDays: number; llmCallsDays: number; breadcrumbsDays: number; sourceMapsEnabled: boolean; sourceMapsDays: number; sourceMapsBatchSize: number };
  };
  backups: { enabled: boolean; intervalHours: number; retentionDays: number; s3Enabled: boolean; stale: boolean | null; latestSuccess: BackupHealthRun | null; latestFailure: BackupHealthRun | null };
};

export type SystemHealthSampleResponse = {
  capturedAt: string;
  postgresLatencyMs: number | null;
  redisLatencyMs: number | null;
  queueWaiting: number;
  queueActive: number;
  queueFailed: number;
};
```

**`apps/console/src/api/client.ts`** — `ApiClient` has:
```typescript
getSystemHealth: () => Promise<AggregateResponse<SystemHealthResponse>>;
getSystemHealthHistory: (params?: { limit?: number }) => Promise<AggregateResponse<SystemHealthSampleResponse[]>>;
```
where `AggregateResponse<T> = { data: T }`.

**`apps/console/src/components/ui/v2`** barrel exports (verbatim signatures):
- `Sparkline({ data: number[]; color?: string; height?: number; fill?: boolean })`
- `PageHead({ title: ReactNode; sub?: ReactNode; actions?: ReactNode })`
- `EmptyHint({ icon?: IconName; title: ReactNode; sub?: ReactNode; cta?: ReactNode })`
- `Icon({ name: IconName; size?: number; stroke?: number; style?: CSSProperties })`
- `ConfirmButton({ label; confirmLabel?; icon?: IconName; kind?: string; onConfirm: () => void })` — **first click arms (shows `confirmLabel`), second click fires `onConfirm`.**
- `formatCompact(n: number): string`
- `type IconName` — valid values include: `server`, `cpu`, `clock`, `db`, `redis`, `queue`, `shield`, `check`, `alert`, `archive`, `play`, `download`.

**`apps/console/src/v2/screens/registry.tsx`** — `ScreenCtx` type provides `client: ApiClient`, `pushToast: (message: string) => void`, plus project/env fields the System screen does NOT use. `ScreenEntry = { kind: "v2" | "legacy"; render: (ctx: ScreenCtx) => ReactNode }`.

---

## File Structure

- **Create** `apps/console/src/v2/screens/useSystemHealth.ts` — VM types, pure `buildSystemVM`, hook. (one responsibility: data → VM)
- **Create** `apps/console/src/v2/screens/useSystemHealth.test.ts` — pure builder + hook tests.
- **Create** `apps/console/src/v2/screens/SystemScreen.tsx` — screen + `ServiceCard`/`QueueRow` subcomponents. (one responsibility: VM → DOM)
- **Create** `apps/console/src/v2/screens/SystemScreen.test.tsx` — screen render tests.
- **Modify** `apps/console/src/v2/screens/registry.tsx` — flip `system` entry to v2, drop unused `SigmonAdminWorkspace` import.
- **Modify** `apps/console/src/v2/screens/registry.test.tsx` — assert `system` is `kind:"v2"`.

---

## Task 1: `useSystemHealth.ts` — VM + pure builder + hook

**Files:**
- Create: `apps/console/src/v2/screens/useSystemHealth.ts`
- Test: `apps/console/src/v2/screens/useSystemHealth.test.ts`

**Interfaces:**
- Consumes: `SystemHealthResponse`, `SystemHealthSampleResponse`, `SystemStatus` from `../../api/types`; `ApiClient` from `../../api/client`; `formatCompact` + `type IconName` from `../../components/ui/v2`.
- Produces (consumed by Task 2): `buildSystemVM(health, history, nowMs) => SystemVM`, `useSystemHealth({ client }) => UseSystemHealthResult`, and types `SystemVM`, `ServiceCardVM`, `QueueRowVM`, `RetentionVM`, `BackupsVM`, `SystemHeaderVM`, `SystemBannerVM`, `ServiceTone`, `UseSystemHealthResult`.

- [ ] **Step 1: Write the failing test** — create `apps/console/src/v2/screens/useSystemHealth.test.ts`:

```typescript
// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SystemHealthResponse, SystemHealthSampleResponse } from "../../api/types";
import { buildSystemVM, useSystemHealth } from "./useSystemHealth";

const NOW = Date.UTC(2026, 5, 23, 12, 0, 0); // 2026-06-23T12:00:00Z

function health(over: Partial<SystemHealthResponse> = {}): SystemHealthResponse {
  return {
    generatedAt: "2026-06-23T12:00:00.000Z",
    status: "healthy",
    services: {
      api: { status: "healthy", uptimeSeconds: 7530 }, // 2h 5m
      postgres: { status: "healthy", latencyMs: 12 },
      redis: { status: "healthy", latencyMs: 3 },
      worker: { status: "healthy", expected: true, role: "queue", lastHeartbeatAt: "2026-06-23T11:59:30.000Z" },
      scheduler: { status: "healthy", expected: true, role: "scheduler", lastHeartbeatAt: "2026-06-23T11:59:00.000Z" },
    },
    deployment: {} as never,
    queues: {
      telemetry: { status: "healthy", errorMessage: null, waiting: 2, active: 1, completed: 31000, failed: 0, delayed: 0 },
    },
    ingestion: {} as never,
    retention: {
      enabled: true,
      intervalMinutes: 60,
      lastRun: {
        id: "r1", status: "success", startedAt: "2026-06-23T11:48:00.000Z", finishedAt: "2026-06-23T11:48:30.000Z",
        deleted: { events: 120, errors: 4, traces: 50, spans: 200, llmCalls: 9, breadcrumbs: 300, sourceMapArtifacts: 0, sourceMapFiles: 0 },
        errorMessage: null,
      },
      policy: { eventsDays: 30, errorsDays: 90, tracesDays: 14, spansDays: 14, llmCallsDays: 60, breadcrumbsDays: 7, sourceMapsEnabled: true, sourceMapsDays: 30, sourceMapsBatchSize: 100 },
    },
    backups: {
      enabled: true, intervalHours: 24, retentionDays: 14, s3Enabled: true, stale: false,
      latestSuccess: { id: "b1", status: "success", trigger: "scheduled", startedAt: "2026-06-23T06:00:00.000Z", finishedAt: "2026-06-23T06:01:00.000Z", filename: "backup-2026-06-23.sql.gz", sizeBytes: 1572864, s3Bucket: "b", s3Key: "k", errorMessage: null },
      latestFailure: null,
    },
    ...over,
  };
}

function sample(over: Partial<SystemHealthSampleResponse> = {}): SystemHealthSampleResponse {
  return { capturedAt: "2026-06-23T11:00:00.000Z", postgresLatencyMs: 10, redisLatencyMs: 2, queueWaiting: 1, queueActive: 0, queueFailed: 0, ...over };
}

const HISTORY = [sample({ postgresLatencyMs: 10, redisLatencyMs: 2, queueActive: 0 }), sample({ postgresLatencyMs: 14, redisLatencyMs: 3, queueActive: 2 })];

describe("buildSystemVM — header", () => {
  it("maps healthy -> ok Operational", () => {
    expect(buildSystemVM(health(), HISTORY, NOW).header).toEqual({ statusTone: "ok", statusLabel: "Operational" });
  });
  it("maps degraded -> warn Degraded", () => {
    expect(buildSystemVM(health({ status: "degraded" }), HISTORY, NOW).header).toEqual({ statusTone: "warn", statusLabel: "Degraded" });
  });
  it("maps unhealthy -> critical Unhealthy", () => {
    expect(buildSystemVM(health({ status: "unhealthy" }), HISTORY, NOW).header).toEqual({ statusTone: "critical", statusLabel: "Unhealthy" });
  });
});

describe("buildSystemVM — services", () => {
  it("orders API, Worker, Scheduler, Postgres, Redis with real meta", () => {
    const s = buildSystemVM(health(), HISTORY, NOW).services;
    expect(s.map((c) => c.name)).toEqual(["API", "Worker", "Scheduler", "Postgres", "Redis"]);
    expect(s[0].meta).toBe("uptime 2h 5m");
    expect(s[3].meta).toBe("latency 12ms");
    expect(s[1].meta).toBe("queue · heartbeat 30s ago");
  });
  it("renders null latency as em dash", () => {
    const s = buildSystemVM(health({ services: { ...health().services, postgres: { status: "degraded", latencyMs: null } } }), HISTORY, NOW).services;
    expect(s[3].meta).toBe("latency —ms");
    expect(s[3].tone).toBe("warn");
  });
  it("treats expected:false worker as idle / not expected", () => {
    const s = buildSystemVM(health({ services: { ...health().services, worker: { status: "unhealthy", expected: false, role: null, lastHeartbeatAt: null } } }), HISTORY, NOW).services;
    expect(s[1].tone).toBe("idle");
    expect(s[1].statusLabel).toBe("not expected");
    expect(s[1].meta).toBe("— · heartbeat none");
  });
  it("sparks Postgres/Redis/Worker from history; API/Scheduler null", () => {
    const s = buildSystemVM(health(), HISTORY, NOW).services;
    expect(s[0].spark).toBeNull(); // API
    expect(s[2].spark).toBeNull(); // Scheduler
    expect(s[1].spark).toEqual([0, 2]); // Worker queueActive
    expect(s[3].spark).toEqual([10, 14]); // Postgres latency
    expect(s[4].spark).toEqual([2, 3]); // Redis latency
  });
  it("returns null spark when history empty", () => {
    expect(buildSystemVM(health(), [], NOW).services[3].spark).toBeNull();
  });
  it("returns null spark when every point is null", () => {
    const allNull = [sample({ postgresLatencyMs: null }), sample({ postgresLatencyMs: null })];
    expect(buildSystemVM(health(), allNull, NOW).services[3].spark).toBeNull();
  });
});

describe("buildSystemVM — banner (severity ordered)", () => {
  it("is null when everything is healthy", () => {
    expect(buildSystemVM(health(), HISTORY, NOW).banner).toBeNull();
  });
  it("flags an unhealthy service as critical", () => {
    const b = buildSystemVM(health({ services: { ...health().services, redis: { status: "unhealthy", latencyMs: null } } }), HISTORY, NOW).banner;
    expect(b).toEqual({ tone: "critical", title: "Redis unhealthy", detail: "Redis ping failed — cache and queue backing unavailable." });
  });
  it("flags a failed retention run as warn", () => {
    const r = health().retention;
    const b = buildSystemVM(health({ retention: { ...r, lastRun: { ...r.lastRun!, status: "failed", errorMessage: "disk full" } } }), HISTORY, NOW).banner;
    expect(b).toEqual({ tone: "warn", title: "Retention run failed", detail: "disk full" });
  });
  it("flags stale backups as warn", () => {
    const b = buildSystemVM(health({ backups: { ...health().backups, stale: true } }), HISTORY, NOW).banner;
    expect(b).toEqual({ tone: "warn", title: "Backups need attention", detail: "No recent successful backup." });
  });
  it("flags a degraded service as warn (after operational checks)", () => {
    const b = buildSystemVM(health({ services: { ...health().services, postgres: { status: "degraded", latencyMs: 900 } } }), HISTORY, NOW).banner;
    expect(b).toEqual({ tone: "warn", title: "Postgres degraded", detail: "Postgres is reporting degraded performance." });
  });
});

describe("buildSystemVM — queues / retention / backups", () => {
  it("maps the telemetry queue", () => {
    const q = buildSystemVM(health(), HISTORY, NOW).queues;
    expect(q).toEqual([{ name: "telemetry", waiting: 2, active: 1, completed: "31K", failed: 0, tone: "ok" }]);
  });
  it("tones a queue with failures as warn", () => {
    const q = buildSystemVM(health({ queues: { telemetry: { status: "healthy", errorMessage: null, waiting: 0, active: 0, completed: 5, failed: 3, delayed: 0 } } }), HISTORY, NOW).queues;
    expect(q[0]).toMatchObject({ failed: 3, tone: "warn" });
  });
  it("builds retention subLabel and deleted rows", () => {
    const r = buildSystemVM(health(), HISTORY, NOW).retention;
    expect(r.enabled).toBe(true);
    expect(r.subLabel).toBe("every 60m · last run 12m ago");
    expect(r.rows).toEqual([
      { label: "Events", retentionLabel: "30d", deleted: 120 },
      { label: "Errors", retentionLabel: "90d", deleted: 4 },
      { label: "Traces", retentionLabel: "14d", deleted: 50 },
      { label: "Spans", retentionLabel: "14d", deleted: 200 },
      { label: "LLM calls", retentionLabel: "60d", deleted: 9 },
      { label: "Breadcrumbs", retentionLabel: "7d", deleted: 300 },
    ]);
  });
  it("shows disabled retention", () => {
    const r = buildSystemVM(health({ retention: { ...health().retention, enabled: false, lastRun: null } }), HISTORY, NOW).retention;
    expect(r.subLabel).toBe("disabled");
    expect(r.rows.every((row) => row.deleted === 0)).toBe(true);
  });
  it("builds backups latest + config subLabel", () => {
    const b = buildSystemVM(health(), HISTORY, NOW).backups;
    expect(b.subLabel).toBe("every 24h · keep 14d · S3 on");
    expect(b.latest).toEqual({ filename: "backup-2026-06-23.sql.gz", meta: "6h ago · 1.5 MB" });
    expect(b.failure).toBeNull();
    expect(b.stale).toBe(false);
  });
  it("surfaces a backup failure", () => {
    const b = buildSystemVM(health({ backups: { ...health().backups, latestSuccess: null, latestFailure: { id: "f1", status: "failed", trigger: "scheduled", startedAt: "2026-06-23T06:00:00.000Z", finishedAt: "2026-06-23T06:00:10.000Z", filename: "x", sizeBytes: null, s3Bucket: null, s3Key: null, errorMessage: "pg_dump failed" } } }), HISTORY, NOW).backups;
    expect(b.latest).toBeNull();
    expect(b.failure).toEqual({ meta: "6h ago · pg_dump failed" });
  });
});

describe("useSystemHealth hook", () => {
  function makeClient() {
    return {
      getSystemHealth: vi.fn().mockResolvedValue({ data: health() }),
      getSystemHealthHistory: vi.fn().mockResolvedValue({ data: HISTORY }),
    };
  }
  it("loads and builds a VM from both fetches", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.services).toHaveLength(5);
    expect(client.getSystemHealthHistory).toHaveBeenCalledWith({ limit: 48 });
  });
  it("reports error when a fetch rejects", async () => {
    const client = { getSystemHealth: vi.fn().mockRejectedValue(new Error("boom")), getSystemHealthHistory: vi.fn().mockResolvedValue({ data: [] }) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useSystemHealth({ client }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console test -- useSystemHealth`
Expected: FAIL — `buildSystemVM`/`useSystemHealth` not exported (module not found).

- [ ] **Step 3: Write the implementation** — create `apps/console/src/v2/screens/useSystemHealth.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { IconName } from "../../components/ui/v2";
import { formatCompact } from "../../components/ui/v2";
import type { SystemHealthResponse, SystemHealthSampleResponse, SystemStatus } from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type ServiceTone = "ok" | "warn" | "critical" | "idle";

export type SystemHeaderVM = { statusLabel: string; statusTone: ServiceTone };
export type SystemBannerVM = { tone: "warn" | "critical"; title: string; detail: string };

export type ServiceCardVM = {
  name: string;
  icon: IconName;
  tone: ServiceTone;
  statusLabel: string;
  meta: string;
  spark: number[] | null;
};

export type QueueRowVM = { name: string; waiting: number; active: number; completed: string; failed: number; tone: ServiceTone };
export type RetentionRowVM = { label: string; retentionLabel: string; deleted: number };
export type RetentionVM = { enabled: boolean; subLabel: string; rows: RetentionRowVM[] };
export type BackupsVM = {
  subLabel: string;
  latest: { filename: string; meta: string } | null;
  failure: { meta: string } | null;
  stale: boolean;
};

export type SystemVM = {
  header: SystemHeaderVM;
  banner: SystemBannerVM | null;
  services: ServiceCardVM[];
  queues: QueueRowVM[];
  retention: RetentionVM;
  backups: BackupsVM;
};

export type UseSystemHealthResult = {
  data: SystemVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

// ---------------------------------------------------------------------------
// Local helpers (pure, deterministic — never read Date.now())
// ---------------------------------------------------------------------------

function statusToTone(s: SystemStatus): ServiceTone {
  if (s === "healthy") return "ok";
  if (s === "degraded") return "warn";
  return "critical";
}

function relativeTimeFrom(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = nowMs - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function formatBytes(value: number | null): string {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function sparkFrom(
  history: SystemHealthSampleResponse[],
  pick: (h: SystemHealthSampleResponse) => number | null,
): number[] | null {
  if (history.length === 0) return null;
  const vals = history.map(pick);
  if (vals.every((v) => v == null)) return null;
  return vals.map((v) => v ?? 0);
}

const SERVICE_DETAIL: Record<string, string> = {
  API: "The API service is unhealthy.",
  Worker: "The worker is not processing jobs.",
  Scheduler: "The scheduler is not running.",
  Postgres: "Postgres is unreachable or slow.",
  Redis: "Redis ping failed — cache and queue backing unavailable.",
};

// ---------------------------------------------------------------------------
// Pure VM builder
// ---------------------------------------------------------------------------

export function buildSystemVM(
  health: SystemHealthResponse,
  history: SystemHealthSampleResponse[],
  nowMs: number,
): SystemVM {
  const { api, worker, scheduler, postgres, redis } = health.services;

  const header: SystemHeaderVM = {
    statusTone: statusToTone(health.status),
    statusLabel: health.status === "healthy" ? "Operational" : health.status === "degraded" ? "Degraded" : "Unhealthy",
  };

  const heartbeatService = (svc: { status: SystemStatus; expected: boolean; role: string | null; lastHeartbeatAt: string | null }, name: string, icon: IconName, spark: number[] | null): ServiceCardVM => {
    const idle = svc.expected === false;
    return {
      name,
      icon,
      tone: idle ? "idle" : statusToTone(svc.status),
      statusLabel: idle ? "not expected" : svc.status,
      meta: `${svc.role ?? "—"} · heartbeat ${svc.lastHeartbeatAt ? relativeTimeFrom(svc.lastHeartbeatAt, nowMs) : "none"}`,
      spark,
    };
  };

  const services: ServiceCardVM[] = [
    { name: "API", icon: "server", tone: statusToTone(api.status), statusLabel: api.status, meta: `uptime ${formatUptime(api.uptimeSeconds)}`, spark: null },
    heartbeatService(worker, "Worker", "cpu", sparkFrom(history, (h) => h.queueActive)),
    heartbeatService(scheduler, "Scheduler", "clock", null),
    { name: "Postgres", icon: "db", tone: statusToTone(postgres.status), statusLabel: postgres.status, meta: `latency ${postgres.latencyMs ?? "—"}ms`, spark: sparkFrom(history, (h) => h.postgresLatencyMs) },
    { name: "Redis", icon: "redis", tone: statusToTone(redis.status), statusLabel: redis.status, meta: `latency ${redis.latencyMs ?? "—"}ms`, spark: sparkFrom(history, (h) => h.redisLatencyMs) },
  ];

  const queues: QueueRowVM[] = Object.entries(health.queues).map(([name, q]) => ({
    name,
    waiting: q.waiting,
    active: q.active,
    completed: formatCompact(q.completed),
    failed: q.failed,
    tone: q.failed > 0 ? "warn" : "ok",
  }));

  const r = health.retention;
  const lastRunIso = r.lastRun ? (r.lastRun.finishedAt ?? r.lastRun.startedAt) : null;
  const retention: RetentionVM = {
    enabled: r.enabled,
    subLabel: r.enabled ? `every ${r.intervalMinutes}m${lastRunIso ? ` · last run ${relativeTimeFrom(lastRunIso, nowMs)}` : ""}` : "disabled",
    rows: [
      { label: "Events", retentionLabel: `${r.policy.eventsDays}d`, deleted: r.lastRun?.deleted.events ?? 0 },
      { label: "Errors", retentionLabel: `${r.policy.errorsDays}d`, deleted: r.lastRun?.deleted.errors ?? 0 },
      { label: "Traces", retentionLabel: `${r.policy.tracesDays}d`, deleted: r.lastRun?.deleted.traces ?? 0 },
      { label: "Spans", retentionLabel: `${r.policy.spansDays}d`, deleted: r.lastRun?.deleted.spans ?? 0 },
      { label: "LLM calls", retentionLabel: `${r.policy.llmCallsDays}d`, deleted: r.lastRun?.deleted.llmCalls ?? 0 },
      { label: "Breadcrumbs", retentionLabel: `${r.policy.breadcrumbsDays}d`, deleted: r.lastRun?.deleted.breadcrumbs ?? 0 },
    ],
  };

  const b = health.backups;
  const backups: BackupsVM = {
    subLabel: `every ${b.intervalHours}h · keep ${b.retentionDays}d · S3 ${b.s3Enabled ? "on" : "off"}`,
    latest: b.latestSuccess
      ? { filename: b.latestSuccess.filename, meta: `${relativeTimeFrom(b.latestSuccess.finishedAt ?? b.latestSuccess.startedAt, nowMs)} · ${formatBytes(b.latestSuccess.sizeBytes)}` }
      : null,
    failure: b.latestFailure
      ? { meta: `${relativeTimeFrom(b.latestFailure.finishedAt ?? b.latestFailure.startedAt, nowMs)} · ${b.latestFailure.errorMessage ?? "backup failed"}` }
      : null,
    stale: b.stale === true,
  };

  // Banner — first matching condition, severity ordered.
  let banner: SystemBannerVM | null = null;
  const critical = services.find((s) => s.tone === "critical");
  const queueUnhealthy = Object.values(health.queues).some((q) => q.status === "unhealthy");
  const queueFailing = queues.find((q) => q.failed > 0);
  const degraded = services.find((s) => s.tone === "warn");
  if (critical) {
    banner = { tone: "critical", title: `${critical.name} unhealthy`, detail: SERVICE_DETAIL[critical.name] ?? `${critical.name} is unhealthy.` };
  } else if (queueUnhealthy || queueFailing) {
    const q = queueFailing ?? queues[0];
    banner = { tone: "warn", title: "Queue backlog", detail: `${q.name} queue has ${q.failed} failed job(s).` };
  } else if (r.lastRun?.status === "failed") {
    banner = { tone: "warn", title: "Retention run failed", detail: r.lastRun.errorMessage ?? "The last retention run failed." };
  } else if (backups.failure || backups.stale) {
    banner = { tone: "warn", title: "Backups need attention", detail: backups.stale ? "No recent successful backup." : (b.latestFailure?.errorMessage ?? "The last backup failed.") };
  } else if (degraded) {
    banner = { tone: "warn", title: `${degraded.name} degraded`, detail: `${degraded.name} is reporting degraded performance.` };
  }

  return { header, banner, services, queues, retention, backups };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseSystemHealthArgs = {
  client: {
    getSystemHealth: ApiClient["getSystemHealth"];
    getSystemHealthHistory: ApiClient["getSystemHealthHistory"];
  };
};

export function useSystemHealth({ client }: UseSystemHealthArgs): UseSystemHealthResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<SystemVM | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const gen = ++genRef.current;
    setStatus("loading");

    Promise.all([client.getSystemHealth(), client.getSystemHealthHistory({ limit: 48 })])
      .then(([healthRes, historyRes]) => {
        if (gen !== genRef.current) return;
        setData(buildSystemVM(healthRes.data, historyRes.data, Date.now()));
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { data, status, reload };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console test -- useSystemHealth`
Expected: PASS (all cases). Then `pnpm --filter @sigmon/console exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/v2/screens/useSystemHealth.ts apps/console/src/v2/screens/useSystemHealth.test.ts
git commit -m "feat(console): useSystemHealth hook + buildSystemVM for S9"
```

---

## Task 2: `SystemScreen.tsx` — screen + subcomponents

**Files:**
- Create: `apps/console/src/v2/screens/SystemScreen.tsx`
- Test: `apps/console/src/v2/screens/SystemScreen.test.tsx`

**Interfaces:**
- Consumes: `useSystemHealth`, `buildSystemVM`'s VM types from `./useSystemHealth`; `ScreenCtx` from `./registry`; `ConfirmButton`, `EmptyHint`, `Icon`, `PageHead`, `Sparkline` from `../../components/ui/v2`.
- Produces (consumed by Task 3): `SystemScreen({ ctx }: { ctx: ScreenCtx })`.

- [ ] **Step 1: Write the failing test** — create `apps/console/src/v2/screens/SystemScreen.test.tsx`:

```typescript
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemScreen } from "./SystemScreen";
import type { ScreenCtx } from "./registry";
import * as hookModule from "./useSystemHealth";
import type { SystemVM } from "./useSystemHealth";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: {} as never,
    project: undefined,
    environment: undefined,
    environments: [],
    onCreateEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    ...over,
  } as ScreenCtx;
}

const vm: SystemVM = {
  header: { statusLabel: "Operational", statusTone: "ok" },
  banner: null,
  services: [
    { name: "API", icon: "server", tone: "ok", statusLabel: "healthy", meta: "uptime 2h 5m", spark: null },
    { name: "Postgres", icon: "db", tone: "ok", statusLabel: "healthy", meta: "latency 12ms", spark: [10, 14, 12] },
  ],
  queues: [{ name: "telemetry", waiting: 2, active: 1, completed: "31K", failed: 0, tone: "ok" }],
  retention: {
    enabled: true,
    subLabel: "every 60m · last run 12m ago",
    rows: [{ label: "Events", retentionLabel: "30d", deleted: 120 }, { label: "Errors", retentionLabel: "90d", deleted: 4 }],
  },
  backups: { subLabel: "every 24h · keep 14d · S3 on", latest: { filename: "backup-2026-06-23.sql.gz", meta: "6h ago · 1.5 MB" }, failure: null, stale: false },
};

function mockHook(over: Partial<hookModule.UseSystemHealthResult>) {
  vi.spyOn(hookModule, "useSystemHealth").mockReturnValue({ data: null, status: "loading", reload: vi.fn(), ...over });
}

describe("SystemScreen", () => {
  it("shows a loading state", () => {
    mockHook({ status: "loading", data: null });
    render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText(/Loading/i)).toBeTruthy();
  });

  it("shows an error state", () => {
    mockHook({ status: "error", data: null });
    render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText(/Could not load/i)).toBeTruthy();
  });

  it("renders the head status pill and Run-doctor stub toast", async () => {
    mockHook({ status: "ok", data: vm });
    const ctx = makeCtx();
    render(<SystemScreen ctx={ctx} />);
    expect(screen.getByText("System health")).toBeTruthy();
    expect(screen.getAllByText(/Operational/).length).toBeGreaterThanOrEqual(1);
    await userEvent.click(screen.getByRole("button", { name: /Run doctor/i }));
    expect(ctx.pushToast).toHaveBeenCalledWith("Doctor is not yet available");
  });

  it("renders service cards — one with a sparkline, one without", () => {
    mockHook({ status: "ok", data: vm });
    const { container } = render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText("API")).toBeTruthy();
    expect(screen.getByText("Postgres")).toBeTruthy();
    // Postgres card has a sparkline svg; API does not.
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(1);
  });

  it("shows a banner only when present", () => {
    mockHook({ status: "ok", data: { ...vm, banner: { tone: "warn", title: "Postgres degraded", detail: "Postgres is reporting degraded performance." } } });
    render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText("Postgres degraded")).toBeTruthy();
  });

  it("renders queue, retention and backup data", () => {
    mockHook({ status: "ok", data: vm });
    render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText("telemetry")).toBeTruthy();
    expect(screen.getAllByText(/Events/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("backup-2026-06-23.sql.gz")).toBeTruthy();
  });

  it("stubs Run-backup-now via ConfirmButton (arm then confirm)", async () => {
    mockHook({ status: "ok", data: vm });
    const ctx = makeCtx();
    render(<SystemScreen ctx={ctx} />);
    const btn = screen.getByRole("button", { name: /Run backup now/i });
    await userEvent.click(btn); // arms
    await userEvent.click(screen.getByRole("button", { name: /Confirm/i })); // confirms
    expect(ctx.pushToast).toHaveBeenCalledWith("Backups run on the configured schedule");
  });

  it("shows an empty hint when there are no backups", () => {
    mockHook({ status: "ok", data: { ...vm, backups: { ...vm.backups, latest: null, failure: null } } });
    render(<SystemScreen ctx={makeCtx()} />);
    expect(screen.getByText(/No backups yet/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console test -- SystemScreen`
Expected: FAIL — `SystemScreen` not exported.

- [ ] **Step 3: Write the implementation** — create `apps/console/src/v2/screens/SystemScreen.tsx`:

```typescript
import { ConfirmButton, EmptyHint, Icon, PageHead, Sparkline } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useSystemHealth } from "./useSystemHealth";
import type { QueueRowVM, ServiceCardVM, ServiceTone, SystemVM } from "./useSystemHealth";

const QUEUE_GRID = "1.4fr 70px 70px 80px 70px";
const RETENTION_GRID = "1fr 56px 90px";

function toneTagClass(tone: ServiceTone): string {
  return tone === "ok" ? "ok" : tone === "critical" ? "critical" : tone === "idle" ? "solid" : "warn";
}

function toneColor(tone: ServiceTone): string {
  if (tone === "ok") return "var(--accent)";
  if (tone === "critical") return "var(--sev-critical)";
  if (tone === "idle") return "var(--fg-muted)";
  return "var(--sev-warning)";
}

function ServiceCard({ card }: { card: ServiceCardVM }) {
  const className = card.tone === "idle" ? "sh-card" : `sh-card sh-stripe ${card.tone}`;
  return (
    <div className={className} style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: toneColor(card.tone) }}>
          <Icon name={card.icon} size={16} />
        </span>
        <strong style={{ fontSize: 13 }}>{card.name}</strong>
        <span className={`sh-tag ${toneTagClass(card.tone)}`} style={{ marginLeft: "auto", fontSize: 10 }}>
          {card.statusLabel}
        </span>
      </div>
      <div className="sh-faint sh-mono" style={{ fontSize: 11, marginTop: 8 }}>
        {card.meta}
      </div>
      {card.spark ? (
        <div style={{ marginTop: 10 }}>
          <Sparkline data={card.spark} color={toneColor(card.tone)} height={28} />
        </div>
      ) : null}
    </div>
  );
}

function QueueRow({ row }: { row: QueueRowVM }) {
  return (
    <div className="sh-row" style={{ gridTemplateColumns: QUEUE_GRID }}>
      <span className="sh-mono" style={{ fontSize: 12 }}>{row.name}</span>
      <span style={{ fontSize: 12 }}>{row.waiting} wait</span>
      <span style={{ fontSize: 12, color: row.active > 0 ? "var(--accent)" : "var(--fg-muted)" }}>{row.active} act</span>
      <span className="sh-mono" style={{ fontSize: 12 }}>{row.completed}</span>
      <span style={{ fontSize: 12, color: row.failed > 0 ? "var(--sev-warning)" : "var(--fg-muted)" }}>{row.failed} fail</span>
    </div>
  );
}

function EmptyState({ icon, title, sub }: { icon: "server" | "queue" | "archive"; title: string; sub: string }) {
  return (
    <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
      <EmptyHint icon={icon} title={title} sub={sub} />
    </div>
  );
}

export function SystemScreen({ ctx }: { ctx: ScreenCtx }) {
  const { data, status } = useSystemHealth({ client: ctx.client });

  if (status === "loading" && !data) {
    return <EmptyState icon="server" title="Loading…" sub="Fetching system health." />;
  }
  if (status === "error" || !data) {
    return <EmptyState icon="server" title="Could not load system health" sub="Check your connection or try again." />;
  }

  const { header, banner, services, queues, retention, backups }: SystemVM = data;
  const maxDeleted = Math.max(...retention.rows.map((r) => r.deleted), 1);

  return (
    <>
      <PageHead
        title="System health"
        sub="Self-monitoring for this SignalMonitor instance."
        actions={
          <>
            <span className={`sh-tag ${toneTagClass(header.statusTone)}`} style={{ fontSize: 11 }}>
              ● {header.statusLabel}
            </span>
            <button className="sh-btn" onClick={() => ctx.pushToast("Doctor is not yet available")}>
              <Icon name="shield" size={13} />
              Run doctor
            </button>
          </>
        }
      />

      {banner ? (
        <div className={`sh-card sh-stripe ${banner.tone}`} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 14 }}>
          <span style={{ color: banner.tone === "critical" ? "var(--sev-critical)" : "var(--sev-warning)" }}>
            <Icon name="alert" size={16} />
          </span>
          <div>
            <strong style={{ fontSize: 13 }}>{banner.title}</strong>
            <div className="sh-muted" style={{ fontSize: 12, marginTop: 2 }}>{banner.detail}</div>
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${services.length}, 1fr)`, gap: 12 }}>
        {services.map((c) => (
          <ServiceCard key={c.name} card={c} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 16 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Queues</h2>
          </div>
          <div style={{ flex: 1 }}>
            {queues.length === 0 ? (
              <EmptyHint icon="queue" title="No queues" sub="No background queues reported." />
            ) : (
              queues.map((row) => <QueueRow key={row.name} row={row} />)
            )}
          </div>
        </div>

        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Retention</h2>
            <span className="sh-faint" style={{ fontSize: 11 }}>{retention.subLabel}</span>
          </div>
          <div style={{ flex: 1 }}>
            {retention.rows.map((r) => (
              <div className="sh-row" key={r.label} style={{ gridTemplateColumns: RETENTION_GRID, alignItems: "center" }}>
                <span style={{ fontSize: 12 }}>{r.label}</span>
                <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>{r.retentionLabel}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="sh-mono" style={{ fontSize: 11, minWidth: 30, textAlign: "right" }}>{r.deleted}</span>
                  <span style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--bg-surface-3)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${(r.deleted / maxDeleted) * 100}%`, background: "var(--accent)" }} />
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Backups</h2>
          </div>
          <div className="sh-card__body flush" style={{ flex: 1 }}>
            {backups.latest ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--accent)" }}><Icon name="check" size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="sh-mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{backups.latest.filename}</div>
                  <div className="sh-faint" style={{ fontSize: 10.5 }}>{backups.latest.meta}</div>
                </div>
              </div>
            ) : null}
            {backups.failure ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--sev-warning)" }}><Icon name="alert" size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12 }}>Last backup failed</div>
                  <div className="sh-faint" style={{ fontSize: 10.5 }}>{backups.failure.meta}</div>
                </div>
              </div>
            ) : null}
            {!backups.latest && !backups.failure ? (
              <EmptyHint icon="archive" title="No backups yet" sub="No backup runs have been recorded." />
            ) : null}
          </div>
          <div style={{ padding: "11px 16px", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="sh-faint" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{backups.subLabel}</span>
            <ConfirmButton label="Run backup now" icon="play" onConfirm={() => ctx.pushToast("Backups run on the configured schedule")} />
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console test -- SystemScreen`
Expected: PASS. Then `pnpm --filter @sigmon/console exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/v2/screens/SystemScreen.tsx apps/console/src/v2/screens/SystemScreen.test.tsx
git commit -m "feat(console): v2 SystemScreen (services, queues, retention, backups)"
```

---

## Task 3: Flip the registry `system` entry to v2

**Files:**
- Modify: `apps/console/src/v2/screens/registry.tsx` (the `system` entry ≈ line 80–84, the `SigmonAdminWorkspace` import ≈ line 5)
- Test: `apps/console/src/v2/screens/registry.test.tsx`

**Interfaces:**
- Consumes: `SystemScreen` from `./SystemScreen`.
- Produces: registry `system` entry is `{ kind: "v2", render: (ctx) => <SystemScreen ctx={ctx} /> }`.

- [ ] **Step 1: Update the registry test first** — open `apps/console/src/v2/screens/registry.test.tsx` and change the `system` assertion to expect `kind: "v2"` (mirror the existing `alerts` v2 assertion in that file). If the file asserts a list/snapshot of kinds, update the `system` entry there too.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console test -- registry`
Expected: FAIL — `system` is still `kind:"legacy"`.

- [ ] **Step 3: Flip the entry** — in `apps/console/src/v2/screens/registry.tsx`:
  1. Add the import near the other screen imports: `import { SystemScreen } from "./SystemScreen";`
  2. Replace the `system` entry:

```typescript
  system: {
    kind: "v2",
    render: (ctx) => <SystemScreen ctx={ctx} />,
  },
```

  3. Remove the now-unused import `import { SigmonAdminWorkspace } from "../../components/SigmonAdminWorkspace";` (line ~5). **Do NOT touch** `apps/console/src/components/SigmonAdminWorkspace.tsx` or its usage in `ConsoleShell.tsx` — the legacy console still renders it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console test -- registry`
Expected: PASS. Then `pnpm --filter @sigmon/console exec tsc --noEmit` → clean (confirms no dangling `SigmonAdminWorkspace` reference in registry).

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/v2/screens/registry.tsx apps/console/src/v2/screens/registry.test.tsx
git commit -m "feat(console): flip system screen registry entry to v2"
```

---

## Final verification (whole branch)

```bash
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config
```

All must be green. The console suite must show the new `useSystemHealth`, `SystemScreen`, and updated `registry` tests passing with no regression.

## Self-Review notes (author)

- **Spec coverage:** header pill (≠ SLA), data-driven banner (no runbook), 5 service cards with real meta + 3 real sparklines (API/Scheduler null), real telemetry queue, retention days+deleted bars, backups latest/failure/config + stubbed Run-backup-now/Run-doctor, lossless registry flip — all mapped to Tasks 1–3.
- **Placeholder scan:** none — full code in every step.
- **Type consistency:** VM names (`buildSystemVM`, `ServiceCardVM`, `QueueRowVM`, `RetentionVM`, `BackupsVM`, `SystemVM`, `UseSystemHealthResult`, `ServiceTone`) are identical between Task 1 (definition) and Task 2 (consumption). `queues` is read as an object via `Object.entries`/`Object.values` (matching the `{ telemetry: {...} }` API shape, not an array). `relativeTime` is NOT used (local `relativeTimeFrom` keeps the builder deterministic). `formatUptime`/`formatBytes` are local helpers (they do not exist in the shared module). `sh-pill` is never used (it does not exist) — the status pill is an `sh-tag`.
</content>
</invoke>

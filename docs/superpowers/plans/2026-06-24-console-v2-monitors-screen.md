# Console v2 — Monitors screen (PER-368) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native v2 **Monitors** screen — a new top-nav section — that manages HTTP uptime checks and heartbeat monitors (status rollup, monitor list with lazy check history, inline create for HTTP + heartbeat, inline edit, archive, channel assignment, one-time heartbeat secret), restyling the v1 `MonitorsPanel` feature onto the v2 design system.

**Architecture:** Same shape as every prior v2 screen — a pure VM builder + race-guarded data hook (`useMonitors.ts`), a flat presentational screen (`MonitorsScreen.tsx`) using existing `ui/v2` primitives and `.sh-*` CSS, and nav/registry wiring. All monitor client methods are **optional** on `ApiClient` (`& Partial<MonitorApiClient>`); the hook guards their absence with an "API unavailable" state. No new CSS, no new shared components, no new dependencies.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest + Testing Library (jsdom). Console workspace `apps/console`.

## Global Constraints

- **English UI only.** Never ship pt-BR copy (CLAUDE.md mandate), even though some design sources are pt-BR.
- **Dark-only, `.sh-v2`-scoped** styling; maximum fidelity to the established v2 design system.
- **No new CSS and no new shared components** — every class and `ui/v2` export used below already exists (recon-confirmed).
- **No new dependencies** → `package.json` is not touched → `pnpm-lock.yaml` is not regenerated (avoids the `--frozen-lockfile` CI failure documented in memory `pnpm-lockfile-ci-gotcha`).
- **Mutation screen exception:** the read-only-default constraint ("keep Overview and investigation views read-only unless a design explicitly introduces a mutation workflow") is explicitly satisfied here — this design introduces create/edit/archive flows. Monitor routes are `/admin/monitors/*` (existing admin session).
- **Heartbeat secret is shown once at creation** and never re-revealed.
- **Determinism:** all relative-time formatting goes through a local `relativeTimeFrom(iso, nowMs)`; only the hook reads `Date.now()` and `window.location.origin`, once per load, and passes them to the pure builder.
- **New DOM test files carry `// @vitest-environment jsdom` as line 1.**
- **Status mapping** (`MonitorStatus` → v2 `Status`): `up → "ok"`, `degraded → "warning"`, `down → "critical"`, `paused → "idle"`, `unknown → "idle"`.
- **Duplicate-text rule:** when a string appears 2+ times in the DOM, assert with `getAllByText(...).length >= 1` or `within(scope)`; never rename design copy to make a test pass.
- **Verification gate** (all green, no regression): `pnpm test`, `pnpm build`, `pnpm --filter @sigmon/sdk build`, `docker compose config`.

## File Structure

- `apps/console/src/v2/screens/useMonitors.ts` — **create.** VM types, pure `buildMonitorsVM(input, nowMs)` + `buildCheckVMs(checks, nowMs)`, status map, local `relativeTimeFrom`, and the race-guarded `useMonitors` hook (load monitors + channels in parallel, optional-guarded; mutation actions; lazy `loadChecks`; one-time `latestSecret`).
- `apps/console/src/v2/screens/useMonitors.test.ts` — **create.** Pure-builder unit tests + a few hook tests (load, unavailable guard).
- `apps/console/src/v2/screens/MonitorsScreen.tsx` — **create** (Task 2) then **extend** (Task 3). Flat `MonitorsScreen({ ctx })`: PageHead + kind filter + rollup card + monitor list + lazy check history (T2); create panel + inline edit + archive + secret banner (T3).
- `apps/console/src/v2/screens/MonitorsScreen.test.tsx` — **create** (T2) then **extend** (T3).
- `apps/console/src/v2/nav.ts` — **modify** (T4). Add `"monitors"` to `NavSection` and a `NAV` item.
- `apps/console/src/v2/ConsoleShellV2.tsx` — **modify** (T4). Add `monitors` to the `NAV_LABELS` `Record<NavSection, string>` (TS-enforced) and to `commandDestinations`.
- `apps/console/src/v2/screens/registry.tsx` — **modify** (T4). Add the `monitors` `SCREENS` entry (TS-enforced).
- `apps/console/src/v2/screens/registry.test.tsx` — **modify** (T4). Add monitor client mocks + a monitors entry test.

---

## Task 1: `useMonitors.ts` — view-model + data hook

**Files:**
- Create: `apps/console/src/v2/screens/useMonitors.ts`
- Test: `apps/console/src/v2/screens/useMonitors.test.ts`

**Interfaces:**
- Consumes: `ApiClient` (`& Partial<MonitorApiClient>`, `listNotificationChannels`), and these `api/types` types verbatim — `MonitorResponse`, `MonitorCheckResponse`, `MonitorStatus`, `MonitorKind`, `MonitorListQuery`, `CreateHttpMonitorInput`, `CreateHeartbeatMonitorInput`, `NotificationChannelResponse`, plus `Status` from `components/ui/v2`.
- Produces (Tasks 2 & 3 rely on these exact names/types):
  - VM types: `MonitorRowVM`, `MonitorRollupVM`, `MonitorChannelVM`, `MonitorCheckVM`, `MonitorsVM`, `LatestMonitorSecret`.
  - Action input types: `CreateHttpForm`, `CreateHeartbeatForm`, `EditMonitorForm`.
  - `monitorStatusToV2(status: MonitorStatus): Status`.
  - `buildMonitorsVM(input: BuildMonitorsInput, nowMs: number): MonitorsVM`.
  - `buildCheckVMs(checks: MonitorCheckResponse[], nowMs: number): MonitorCheckVM[]`.
  - `useMonitors({ client, projectId, environmentId, endpoint }): UseMonitorsResult` returning `{ data, status, latestSecret, busy, reload, createHttpMonitor, createHeartbeatMonitor, updateMonitor, archiveMonitor, loadChecks, clearSecret }`.

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/v2/screens/useMonitors.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildMonitorsVM, buildCheckVMs, monitorStatusToV2 } from "./useMonitors";
import type { MonitorResponse, MonitorCheckResponse, NotificationChannelResponse } from "../../api/types";

const NOW = Date.parse("2026-06-24T12:00:00.000Z");

function httpMonitor(over: Partial<MonitorResponse> = {}): MonitorResponse {
  return {
    id: "mon_http", projectId: "p", environmentId: "e", notificationChannelId: "ch_1",
    kind: "http", name: "API health", enabled: true, status: "up",
    url: "https://api.example.com/health", method: "GET", expectedStatus: "2xx",
    bodyContains: null, timeoutMs: 5000, intervalMinutes: 5,
    failureThreshold: 2, recoveryThreshold: 2, consecutiveFailures: 0, consecutiveSuccesses: 3,
    expectedIntervalMinutes: null, graceMinutes: null,
    lastCheckedAt: "2026-06-24T11:48:00.000Z", lastCheckStatus: "success", lastCheckLatencyMs: 134,
    lastCheckResponseStatus: 200, lastCheckErrorMessage: null, lastHeartbeatAt: null,
    createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-24T11:48:00.000Z", archivedAt: null,
    ...over,
  };
}

function heartbeatMonitor(over: Partial<MonitorResponse> = {}): MonitorResponse {
  return {
    ...httpMonitor(),
    id: "mon_hb", kind: "heartbeat", name: "Worker beat", status: "down",
    url: null, method: null, expectedStatus: null, timeoutMs: null, intervalMinutes: null,
    notificationChannelId: null,
    expectedIntervalMinutes: 5, graceMinutes: 2, lastHeartbeatAt: "2026-06-24T10:00:00.000Z",
    lastCheckedAt: null, lastCheckStatus: null, lastCheckResponseStatus: null, lastCheckLatencyMs: null,
    ...over,
  };
}

const channels: NotificationChannelResponse[] = [
  { id: "ch_1", name: "Ops webhook", type: "webhook", url: "https://hook", emailRecipients: [], secretHeaderName: null, hasSecret: false, enabled: true, createdAt: "x", updatedAt: "x", archivedAt: null },
];

describe("monitorStatusToV2", () => {
  it("maps every MonitorStatus to a v2 Status", () => {
    expect(monitorStatusToV2("up")).toBe("ok");
    expect(monitorStatusToV2("degraded")).toBe("warning");
    expect(monitorStatusToV2("down")).toBe("critical");
    expect(monitorStatusToV2("paused")).toBe("idle");
    expect(monitorStatusToV2("unknown")).toBe("idle");
  });
});

describe("buildMonitorsVM", () => {
  it("builds http and heartbeat rows with target, cadence, channel and last-check labels", () => {
    const vm = buildMonitorsVM({ monitors: [httpMonitor(), heartbeatMonitor()], channels }, NOW);
    const http = vm.rows.find((r) => r.id === "mon_http")!;
    const hb = vm.rows.find((r) => r.id === "mon_hb")!;

    expect(http.kind).toBe("http");
    expect(http.statusV2).toBe("ok");
    expect(http.target).toBe("https://api.example.com/health");
    expect(http.cadence).toBe("every 5m");
    expect(http.channelLabel).toBe("Ops webhook");
    expect(http.hasChannel).toBe(true);
    expect(http.lastCheckedLabel).toBe("12m ago");

    expect(hb.kind).toBe("heartbeat");
    expect(hb.statusV2).toBe("critical");
    expect(hb.target).toBe("Heartbeat check-in");
    expect(hb.cadence).toBe("expects every 5m ±2m");
    expect(hb.channelLabel).toBeNull();
    expect(hb.hasChannel).toBe(false);
    expect(hb.lastCheckedLabel).toBe("Never");
  });

  it("computes a rollup over all monitors", () => {
    const vm = buildMonitorsVM(
      { monitors: [httpMonitor(), heartbeatMonitor(), httpMonitor({ id: "m3", status: "degraded", enabled: false, notificationChannelId: null })], channels },
      NOW,
    );
    expect(vm.rollup.total).toBe(3);
    expect(vm.rollup.up).toBe(1);
    expect(vm.rollup.down).toBe(1);
    expect(vm.rollup.degraded).toBe(1);
    expect(vm.rollup.paused).toBe(0);
    expect(vm.rollup.enabled).toBe(2);
    expect(vm.rollup.withoutChannel).toBe(2);
  });

  it("exposes channel options for selects", () => {
    const vm = buildMonitorsVM({ monitors: [], channels }, NOW);
    expect(vm.channels).toEqual([{ id: "ch_1", label: "Ops webhook · webhook" }]);
  });
});

describe("buildCheckVMs", () => {
  it("maps checks to status, label and detail", () => {
    const checks: MonitorCheckResponse[] = [
      { id: "c1", monitorId: "m", checkedAt: "2026-06-24T11:59:00.000Z", status: "success", latencyMs: 120, responseStatus: 200, errorMessage: null, createdAt: "x" },
      { id: "c2", monitorId: "m", checkedAt: "2026-06-24T11:00:00.000Z", status: "failed", latencyMs: null, responseStatus: 500, errorMessage: "Timeout", createdAt: "x" },
    ];
    const vms = buildCheckVMs(checks, NOW);
    expect(vms[0].statusV2).toBe("ok");
    expect(vms[0].checkedLabel).toBe("1m ago");
    expect(vms[0].detail).toBe("200 · 120ms");
    expect(vms[1].statusV2).toBe("critical");
    expect(vms[1].hasError).toBe(true);
    expect(vms[1].detail).toBe("500 · Timeout");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console test -- useMonitors`
Expected: FAIL — `useMonitors.ts` does not exist / exports missing.

- [ ] **Step 3: Write the implementation**

Create `apps/console/src/v2/screens/useMonitors.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Status } from "../../components/ui/v2";
import type { ApiClient } from "../../api/client";
import type {
  CreateHeartbeatMonitorInput,
  CreateHttpMonitorInput,
  MonitorCheckResponse,
  MonitorKind,
  MonitorResponse,
  MonitorStatus,
  NotificationChannelResponse,
} from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type MonitorRowVM = {
  id: string;
  name: string;
  kind: MonitorKind;
  status: MonitorStatus;
  statusV2: Status;
  enabled: boolean;
  target: string;
  cadence: string;
  lastCheckedLabel: string;
  channelLabel: string | null;
  hasChannel: boolean;
};

export type MonitorRollupVM = {
  total: number;
  enabled: number;
  up: number;
  degraded: number;
  down: number;
  paused: number;
  withoutChannel: number;
};

export type MonitorChannelVM = { id: string; label: string };

export type MonitorCheckVM = {
  id: string;
  statusV2: Status;
  checkedLabel: string;
  detail: string;
  hasError: boolean;
};

export type MonitorsVM = {
  rollup: MonitorRollupVM;
  rows: MonitorRowVM[];
  channels: MonitorChannelVM[];
};

export type LatestMonitorSecret = {
  monitorId: string;
  monitorName: string;
  secret: string;
  url: string;
};

// ---------------------------------------------------------------------------
// Action form types (already-validated values from the screen)
// ---------------------------------------------------------------------------

export type CreateHttpForm = {
  name: string;
  url: string;
  intervalMinutes: number;
  timeoutMs: number;
  notificationChannelId: string;
};

export type CreateHeartbeatForm = {
  name: string;
  expectedIntervalMinutes: number;
  graceMinutes: number;
  notificationChannelId: string;
};

export type EditMonitorForm = {
  id: string;
  kind: MonitorKind;
  name: string;
  enabled: boolean;
  notificationChannelId: string;
  url: string;
  intervalMinutes: number;
  timeoutMs: number;
  expectedIntervalMinutes: number;
  graceMinutes: number;
};

export type BuildMonitorsInput = {
  monitors: MonitorResponse[];
  channels: NotificationChannelResponse[];
};

export type UseMonitorsResult = {
  data: MonitorsVM | null;
  status: "loading" | "ok" | "error" | "unavailable";
  latestSecret: LatestMonitorSecret | null;
  busy: boolean;
  reload: () => void;
  clearSecret: () => void;
  createHttpMonitor: (form: CreateHttpForm) => Promise<boolean>;
  createHeartbeatMonitor: (form: CreateHeartbeatForm) => Promise<boolean>;
  updateMonitor: (form: EditMonitorForm) => Promise<boolean>;
  archiveMonitor: (id: string) => Promise<void>;
  loadChecks: (id: string) => Promise<MonitorCheckVM[]>;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function monitorStatusToV2(status: MonitorStatus): Status {
  switch (status) {
    case "up":
      return "ok";
    case "degraded":
      return "warning";
    case "down":
      return "critical";
    default:
      return "idle";
  }
}

function relativeTimeFrom(iso: string | null, nowMs: number): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "Never";
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

function channelOptionLabel(channel: NotificationChannelResponse): string {
  return channel.type === "email" ? `${channel.name} · email` : `${channel.name} · webhook`;
}

function monitorTarget(monitor: MonitorResponse): string {
  if (monitor.kind === "http") return monitor.url ?? "—";
  return "Heartbeat check-in";
}

function monitorCadence(monitor: MonitorResponse): string {
  if (monitor.kind === "http") return `every ${monitor.intervalMinutes ?? 5}m`;
  return `expects every ${monitor.expectedIntervalMinutes ?? 5}m ±${monitor.graceMinutes ?? 0}m`;
}

// ---------------------------------------------------------------------------
// Pure VM builders
// ---------------------------------------------------------------------------

export function buildMonitorsVM(input: BuildMonitorsInput, nowMs: number): MonitorsVM {
  const { monitors, channels } = input;
  const channelName = new Map<string, string>();
  for (const c of channels) channelName.set(c.id, c.name);

  const rows: MonitorRowVM[] = monitors.map((m) => {
    const channelLabel = m.notificationChannelId ? channelName.get(m.notificationChannelId) ?? null : null;
    return {
      id: m.id,
      name: m.name,
      kind: m.kind,
      status: m.status,
      statusV2: monitorStatusToV2(m.status),
      enabled: m.enabled,
      target: monitorTarget(m),
      cadence: monitorCadence(m),
      lastCheckedLabel: relativeTimeFrom(m.lastCheckedAt, nowMs),
      channelLabel,
      hasChannel: m.notificationChannelId != null,
    };
  });

  const rollup: MonitorRollupVM = {
    total: monitors.length,
    enabled: monitors.filter((m) => m.enabled).length,
    up: monitors.filter((m) => m.status === "up").length,
    degraded: monitors.filter((m) => m.status === "degraded").length,
    down: monitors.filter((m) => m.status === "down").length,
    paused: monitors.filter((m) => m.status === "paused").length,
    withoutChannel: monitors.filter((m) => m.notificationChannelId == null).length,
  };

  const channelVMs: MonitorChannelVM[] = channels.map((c) => ({ id: c.id, label: channelOptionLabel(c) }));

  return { rollup, rows, channels: channelVMs };
}

export function buildCheckVMs(checks: MonitorCheckResponse[], nowMs: number): MonitorCheckVM[] {
  return checks.map((c) => {
    const code = c.responseStatus != null ? String(c.responseStatus) : "heartbeat";
    const detail = c.errorMessage ? `${code} · ${c.errorMessage}` : `${code} · ${c.latencyMs ?? 0}ms`;
    return {
      id: c.id,
      statusV2: c.status === "success" ? "ok" : "critical",
      checkedLabel: relativeTimeFrom(c.checkedAt, nowMs),
      detail,
      hasError: c.errorMessage != null,
    };
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function heartbeatUrl(endpoint: string, monitorId: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return `${base}/v1/heartbeats/${encodeURIComponent(monitorId)}`;
}

type UseMonitorsArgs = {
  client: ApiClient;
  projectId: string | undefined;
  environmentId: string | undefined;
  endpoint: string;
};

export function useMonitors({ client, projectId, environmentId, endpoint }: UseMonitorsArgs): UseMonitorsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "unavailable">("loading");
  const [data, setData] = useState<MonitorsVM | null>(null);
  const [latestSecret, setLatestSecret] = useState<LatestMonitorSecret | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const clearSecret = useCallback(() => setLatestSecret(null), []);

  useEffect(() => {
    setLatestSecret(null);
  }, [projectId, environmentId]);

  useEffect(() => {
    if (!projectId || !environmentId) return;
    if (!client.listMonitors || !client.listNotificationChannels) {
      setStatus("unavailable");
      setData(null);
      return;
    }

    const gen = ++genRef.current;
    setStatus("loading");

    const monitorsP = client.listMonitors({ projectId, environmentId });
    const channelsP = client.listNotificationChannels();

    Promise.all([monitorsP, channelsP])
      .then(([monitorsRes, channelsRes]) => {
        if (gen !== genRef.current) return;
        setData(buildMonitorsVM({ monitors: monitorsRes.monitors, channels: channelsRes.channels }, Date.now()));
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
  }, [client, projectId, environmentId, tick]);

  // Returns true on success, false on failure. The caller surfaces the
  // user-facing message via pushToast when this resolves false.
  const run = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        reload();
        return true;
      } catch (err) {
        console.error(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const createHttpMonitor = useCallback(
    (form: CreateHttpForm) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createHttpMonitor) return;
        const input: CreateHttpMonitorInput = {
          projectId,
          environmentId,
          notificationChannelId: form.notificationChannelId || null,
          name: form.name,
          url: form.url,
          method: "GET",
          intervalMinutes: form.intervalMinutes,
          timeoutMs: form.timeoutMs,
          expectedStatus: "2xx",
          failureThreshold: 2,
          recoveryThreshold: 2,
          enabled: true,
        };
        await client.createHttpMonitor(input);
      }),
    [client, environmentId, projectId, run],
  );

  const createHeartbeatMonitor = useCallback(
    (form: CreateHeartbeatForm) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createHeartbeatMonitor) return;
        const input: CreateHeartbeatMonitorInput = {
          projectId,
          environmentId,
          notificationChannelId: form.notificationChannelId || null,
          name: form.name,
          expectedIntervalMinutes: form.expectedIntervalMinutes,
          graceMinutes: form.graceMinutes,
          enabled: true,
        };
        const { monitor, secret } = await client.createHeartbeatMonitor(input);
        setLatestSecret({
          monitorId: monitor.id,
          monitorName: monitor.name,
          secret,
          url: heartbeatUrl(endpoint, monitor.id),
        });
      }),
    [client, endpoint, environmentId, projectId, run],
  );

  const updateMonitor = useCallback(
    (form: EditMonitorForm) =>
      run(async () => {
        if (!client.updateMonitor) return;
        const input: Partial<CreateHttpMonitorInput & CreateHeartbeatMonitorInput> = {
          notificationChannelId: form.notificationChannelId || null,
          name: form.name,
          enabled: form.enabled,
        };
        if (form.kind === "http") {
          input.url = form.url;
          input.intervalMinutes = form.intervalMinutes;
          input.timeoutMs = form.timeoutMs;
        } else {
          input.expectedIntervalMinutes = form.expectedIntervalMinutes;
          input.graceMinutes = form.graceMinutes;
        }
        await client.updateMonitor(form.id, input);
      }),
    [client, run],
  );

  const archiveMonitor = useCallback(
    async (id: string) => {
      await run(async () => {
        if (!client.archiveMonitor) return;
        await client.archiveMonitor(id);
      });
    },
    [client, run],
  );

  const loadChecks = useCallback(
    async (id: string): Promise<MonitorCheckVM[]> => {
      if (!client.listMonitorChecks) return [];
      try {
        const { checks } = await client.listMonitorChecks(id, 20);
        return buildCheckVMs(checks, Date.now());
      } catch (err) {
        console.error(err);
        return [];
      }
    },
    [client],
  );

  return {
    data,
    status,
    latestSecret,
    busy,
    reload,
    clearSecret,
    createHttpMonitor,
    createHeartbeatMonitor,
    updateMonitor,
    archiveMonitor,
    loadChecks,
  };
}
```

- [ ] **Step 4: Add hook tests to `useMonitors.test.ts`**

Append to the test file:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { useMonitors } from "./useMonitors";
import type { ApiClient } from "../../api/client";

describe("useMonitors hook", () => {
  it("loads monitors + channels and builds the VM", async () => {
    const client = {
      listMonitors: vi.fn().mockResolvedValue({ monitors: [httpMonitor()] }),
      listNotificationChannels: vi.fn().mockResolvedValue({ channels }),
    } as unknown as ApiClient;
    const { result } = renderHook(() =>
      useMonitors({ client, projectId: "p", environmentId: "e", endpoint: "https://x.test" }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rows).toHaveLength(1);
    expect(result.current.data?.rollup.total).toBe(1);
  });

  it("reports 'unavailable' when monitor methods are absent", async () => {
    const client = {} as unknown as ApiClient;
    const { result } = renderHook(() =>
      useMonitors({ client, projectId: "p", environmentId: "e", endpoint: "https://x.test" }),
    );
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.data).toBeNull();
  });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @sigmon/console test -- useMonitors`
Expected: PASS (all builder + hook cases).

- [ ] **Step 6: Type-check**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/v2/screens/useMonitors.ts apps/console/src/v2/screens/useMonitors.test.ts
git commit -m "feat(console): monitors v2 view-model and data hook"
```

---

## Task 2: `MonitorsScreen.tsx` — read/display (rollup, list, check history)

**Files:**
- Create: `apps/console/src/v2/screens/MonitorsScreen.tsx`
- Test: `apps/console/src/v2/screens/MonitorsScreen.test.tsx`

**Interfaces:**
- Consumes: `useMonitors`, all VM types from Task 1, `ScreenCtx` from `./registry`, and `ui/v2` exports `PageHead`, `Segmented`, `Icon`, `StatusDot`, `EmptyHint`.
- Produces: `MonitorsScreen({ ctx }: { ctx: ScreenCtx })`. Task 3 extends the SAME file (it adds create/edit/archive/secret UI) — keep state hooks and layout structured so Task 3 can graft those in without restructuring. Task 4 imports `MonitorsScreen` into the registry.

This task renders the read-only surface and the kind filter; mutation affordances (the `New monitor` button body, create panel, edit, archive) arrive in Task 3. In this task the PageHead shows a `New monitor` button that is present but its handler is a no-op placeholder ONLY within this task's own test scope — **do not** ship a permanent placeholder: Task 3 wires it. To keep Task 2 self-contained and avoid a dangling stub, this task wires `New monitor` to a local `useState` boolean `showCreate` toggle that Task 3 then consumes; in Task 2 the panel it toggles is not yet rendered (the boolean is set but no panel exists yet). This is acceptable interim state, not a placeholder in shipped logic.

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/v2/screens/MonitorsScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import type { Environment, MonitorResponse, Project } from "../../api/types";
import type { NavSection } from "../nav";
import { MonitorsScreen } from "./MonitorsScreen";
import type { ScreenCtx } from "./registry";

afterEach(cleanup);

const project: Project = { id: "prj_1", name: "Acme", createdAt: "x", updatedAt: "x", archivedAt: null };
const environment: Environment = { id: "env_1", projectId: "prj_1", name: "production", createdAt: "x", updatedAt: "x", archivedAt: null };

function httpMonitor(over: Partial<MonitorResponse> = {}): MonitorResponse {
  return {
    id: "mon_http", projectId: "prj_1", environmentId: "env_1", notificationChannelId: "ch_1",
    kind: "http", name: "API health", enabled: true, status: "up",
    url: "https://api.example.com/health", method: "GET", expectedStatus: "2xx", bodyContains: null,
    timeoutMs: 5000, intervalMinutes: 5, failureThreshold: 2, recoveryThreshold: 2,
    consecutiveFailures: 0, consecutiveSuccesses: 3, expectedIntervalMinutes: null, graceMinutes: null,
    lastCheckedAt: "2026-06-24T11:48:00.000Z", lastCheckStatus: "success", lastCheckLatencyMs: 134,
    lastCheckResponseStatus: 200, lastCheckErrorMessage: null, lastHeartbeatAt: null,
    createdAt: "x", updatedAt: "x", archivedAt: null, ...over,
  };
}

function makeClient(over: Partial<ApiClient> = {}): ApiClient {
  return {
    listMonitors: vi.fn().mockResolvedValue({ monitors: [httpMonitor(), httpMonitor({ id: "mon_hb", kind: "heartbeat", name: "Worker beat", status: "down", url: null, expectedIntervalMinutes: 5, graceMinutes: 2, notificationChannelId: null })] }),
    listNotificationChannels: vi.fn().mockResolvedValue({ channels: [{ id: "ch_1", name: "Ops webhook", type: "webhook", url: "https://hook", emailRecipients: [], secretHeaderName: null, hasSecret: false, enabled: true, createdAt: "x", updatedAt: "x", archivedAt: null }] }),
    listMonitorChecks: vi.fn().mockResolvedValue({ checks: [{ id: "c1", monitorId: "mon_http", checkedAt: "2026-06-24T11:59:00.000Z", status: "success", latencyMs: 120, responseStatus: 200, errorMessage: null, createdAt: "x" }] }),
    ...over,
  } as unknown as ApiClient;
}

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: makeClient(),
    project, environment, environments: [environment],
    onCreateEnvironment: vi.fn(), onArchiveProject: vi.fn(), onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(), onUpdateProject: vi.fn(),
    navigate: vi.fn() as (s: NavSection) => void, back: vi.fn(), drill: vi.fn(), pushToast: vi.fn(),
    ...over,
  };
}

describe("MonitorsScreen — display", () => {
  it("renders the page head and a rollup with counts", async () => {
    render(<MonitorsScreen ctx={makeCtx()} />);
    expect(await screen.findByText("Monitors")).toBeInTheDocument();
    expect(screen.getByText("API health")).toBeInTheDocument();
    expect(screen.getByText("Worker beat")).toBeInTheDocument();
  });

  it("filters the list by kind", async () => {
    render(<MonitorsScreen ctx={makeCtx()} />);
    await screen.findByText("API health");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Heartbeat" }));
    expect(screen.queryByText("API health")).toBeNull();
    expect(screen.getByText("Worker beat")).toBeInTheDocument();
  });

  it("loads and shows check history when a monitor row is selected", async () => {
    const ctx = makeCtx();
    render(<MonitorsScreen ctx={ctx} />);
    const { fireEvent } = await import("@testing-library/react");
    const row = await screen.findByText("API health");
    fireEvent.click(row);
    await waitFor(() => expect(ctx.client.listMonitorChecks).toHaveBeenCalledWith("mon_http", 20));
    expect(await screen.findByText(/200 · 120ms/)).toBeInTheDocument();
  });

  it("shows an API-unavailable hint when monitor methods are absent", async () => {
    render(<MonitorsScreen ctx={makeCtx({ client: {} as unknown as ApiClient })} />);
    expect(await screen.findByText("Monitors API unavailable")).toBeInTheDocument();
  });

  it("shows an empty hint when there are no monitors", async () => {
    render(<MonitorsScreen ctx={makeCtx({ client: makeClient({ listMonitors: vi.fn().mockResolvedValue({ monitors: [] }) }) })} />);
    expect(await screen.findByText("No monitors yet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console test -- MonitorsScreen`
Expected: FAIL — `MonitorsScreen.tsx` does not exist.

- [ ] **Step 3: Write the implementation**

Create `apps/console/src/v2/screens/MonitorsScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import { EmptyHint, Icon, PageHead, Segmented, StatusDot } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useMonitors } from "./useMonitors";
import type { MonitorCheckVM, MonitorRollupVM, MonitorRowVM } from "./useMonitors";

const KIND_FILTERS = ["All", "HTTP", "Heartbeat"] as const;
type KindFilter = (typeof KIND_FILTERS)[number];

const ROW_GRID = "1.6fr 1.4fr 1fr 110px 1fr 76px";

function originEndpoint(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://your-instance.example.com";
}

function Rollup({ rollup }: { rollup: MonitorRollupVM }) {
  const tiles: Array<{ label: string; value: number; tone: string }> = [
    { label: "Up", value: rollup.up, tone: "ok" },
    { label: "Degraded", value: rollup.degraded, tone: "warn" },
    { label: "Down", value: rollup.down, tone: "critical" },
    { label: "Paused", value: rollup.paused, tone: "solid" },
  ];
  return (
    <div className="sh-card">
      <div className="sh-card__body" style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className={`sh-tag ${t.tone}`} style={{ alignSelf: "flex-start", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
              {t.label}
            </span>
            <strong className="sh-mono" style={{ fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{t.value}</strong>
          </div>
        ))}
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div className="sh-faint" style={{ fontSize: 11 }}>{rollup.total} total · {rollup.enabled} enabled</div>
          {rollup.withoutChannel > 0 ? (
            <div className="sh-tag warn" style={{ marginTop: 4, fontSize: 10.5 }}>
              {rollup.withoutChannel} without channel
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CheckHistory({ checks, loading }: { checks: MonitorCheckVM[]; loading: boolean }) {
  if (loading) return <p className="sh-faint" style={{ fontSize: 12, padding: "8px 16px" }}>Loading checks…</p>;
  if (checks.length === 0) return <p className="sh-faint" style={{ fontSize: 12, padding: "8px 16px" }}>No checks yet.</p>;
  return (
    <div className="sh-card__body flush">
      {checks.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <StatusDot status={c.statusV2} />
          <span className="sh-mono" style={{ fontSize: 11.5, minWidth: 80 }}>{c.checkedLabel}</span>
          <span className="sh-faint sh-mono" style={{ fontSize: 11.5, color: c.hasError ? "var(--sev-critical)" : undefined }}>{c.detail}</span>
        </div>
      ))}
    </div>
  );
}

function MonitorRow({
  row,
  selected,
  onSelect,
}: {
  row: MonitorRowVM;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`sh-row${selected ? " is-active" : ""}`}
      style={{ gridTemplateColumns: ROW_GRID, width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", opacity: row.enabled ? 1 : 0.6 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <StatusDot status={row.statusV2} />
        <strong style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</strong>
        <span className="sh-tag" style={{ fontSize: 10, textTransform: "uppercase" }}>{row.kind}</span>
      </div>
      <span className="sh-faint sh-mono" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.target}</span>
      <span className="sh-faint" style={{ fontSize: 11.5 }}>{row.cadence}</span>
      <span className="sh-faint sh-mono" style={{ fontSize: 11.5 }}>{row.lastCheckedLabel}</span>
      <span style={{ fontSize: 11.5 }}>
        {row.hasChannel ? row.channelLabel : <span className="sh-tag warn" style={{ fontSize: 10 }}>no channel</span>}
      </span>
      <span />
    </button>
  );
}

export function MonitorsScreen({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const monitors = useMonitors({ client: ctx.client, projectId, environmentId, endpoint: originEndpoint() });

  const [filter, setFilter] = useState<KindFilter>("All");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checks, setChecks] = useState<MonitorCheckVM[]>([]);
  const [checksLoading, setChecksLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setChecks([]);
      return;
    }
    setChecksLoading(true);
    monitors
      .loadChecks(selectedId)
      .then((vms) => {
        if (!cancelled) setChecks(vms);
      })
      .finally(() => {
        if (!cancelled) setChecksLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, monitors.data]);

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="pulse" title="No project selected" sub="Select a project and environment to view monitors." />
      </div>
    );
  }

  if (monitors.status === "unavailable") {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="server" title="Monitors API unavailable" sub="This instance does not expose monitor management." />
      </div>
    );
  }

  if (monitors.status === "loading" && !monitors.data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="activity" title="Loading…" sub="Fetching monitors and channels." />
      </div>
    );
  }

  if (monitors.status === "error" || !monitors.data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="alert" title="Could not load monitors" sub="Check your connection or try again." />
      </div>
    );
  }

  const { rollup, rows } = monitors.data;
  const shownRows = rows.filter((r) =>
    filter === "All" ? true : filter === "HTTP" ? r.kind === "http" : r.kind === "heartbeat",
  );

  return (
    <>
      <PageHead
        title="Monitors"
        sub={`HTTP uptime and heartbeat checks for ${ctx.project.name} / ${ctx.environment.name}.`}
        actions={
          <>
            <Segmented options={[...KIND_FILTERS]} value={filter} onChange={(v) => setFilter(v as KindFilter)} />
            <button className="sh-btn primary" onClick={() => setShowCreate((s) => !s)}>
              <Icon name="plus" size={13} />
              New monitor
            </button>
          </>
        }
      />

      <Rollup rollup={rollup} />

      <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="sh-row sh-row__head" style={{ gridTemplateColumns: ROW_GRID }}>
          <span>Monitor</span>
          <span>Target</span>
          <span>Cadence</span>
          <span>Last check</span>
          <span>Channel</span>
          <span>Actions</span>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {shownRows.length === 0 ? (
            <EmptyHint icon="pulse" title="No monitors yet" sub="Create an HTTP or heartbeat monitor to start tracking uptime." />
          ) : (
            shownRows.map((row) => (
              <div key={row.id}>
                <MonitorRow row={row} selected={selectedId === row.id} onSelect={() => setSelectedId((cur) => (cur === row.id ? null : row.id))} />
                {selectedId === row.id ? <CheckHistory checks={checks} loading={checksLoading} /> : null}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sigmon/console test -- MonitorsScreen`
Expected: PASS (display, filter, check history, unavailable, empty).

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/v2/screens/MonitorsScreen.tsx apps/console/src/v2/screens/MonitorsScreen.test.tsx
git commit -m "feat(console): monitors v2 screen display, filter and check history"
```

---

## Task 3: `MonitorsScreen.tsx` — create, edit, archive, secret banner

**Files:**
- Modify: `apps/console/src/v2/screens/MonitorsScreen.tsx`
- Modify (extend): `apps/console/src/v2/screens/MonitorsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 2's `MonitorsScreen` structure (the `showCreate` state, `monitors` hook handle, `ROW_GRID`, `MonitorRow`), the hook actions `createHttpMonitor`/`createHeartbeatMonitor`/`updateMonitor`/`archiveMonitor`, `latestSecret`/`clearSecret`/`busy`, and `ui/v2` exports `SecretField`, `ConfirmButton`. Add their imports.
- Produces: the complete mutation UI. No new exports.

Form-level validation (URL, positive integers) ported from v1 lives in this screen. Inputs are uncontrolled-friendly local state; on submit the screen parses strings to numbers and calls the typed hook actions. Actions return `boolean`; on `false`, call `ctx.pushToast(...)` with the matching message and keep the panel open.

- [ ] **Step 1: Write the failing tests (extend the file)**

Append these tests inside the existing `describe("MonitorsScreen — display", ...)` file (add a new `describe` block):

```tsx
describe("MonitorsScreen — mutations", () => {
  it("creates an HTTP monitor from the create panel", async () => {
    const ctx = makeCtx();
    const { fireEvent } = await import("@testing-library/react");
    render(<MonitorsScreen ctx={ctx} />);
    await screen.findByText("API health");
    fireEvent.click(screen.getByRole("button", { name: /New monitor/ }));
    fireEvent.change(screen.getByLabelText("Monitor name"), { target: { value: "Checkout" } });
    fireEvent.change(screen.getByLabelText("Monitor URL"), { target: { value: "https://api.example.com/checkout" } });
    fireEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    await waitFor(() =>
      expect(ctx.client.createHttpMonitor).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Checkout", url: "https://api.example.com/checkout", projectId: "prj_1", environmentId: "env_1" }),
      ),
    );
  });

  it("creates a heartbeat monitor and reveals the one-time secret", async () => {
    const client = makeClient({
      createHeartbeatMonitor: vi.fn().mockResolvedValue({ monitor: { id: "mon_new", name: "Beat" }, secret: "hb_secret_value" }),
    });
    const ctx = makeCtx({ client });
    const { fireEvent } = await import("@testing-library/react");
    render(<MonitorsScreen ctx={ctx} />);
    await screen.findByText("API health");
    fireEvent.click(screen.getByRole("button", { name: /New monitor/ }));
    fireEvent.click(screen.getByRole("button", { name: "Heartbeat" }));
    fireEvent.change(screen.getByLabelText("Monitor name"), { target: { value: "Beat" } });
    fireEvent.click(screen.getByRole("button", { name: "Create monitor" }));
    await waitFor(() => expect(client.createHeartbeatMonitor).toHaveBeenCalled());
    expect(await screen.findByText(/Copy/)).toBeInTheDocument();
  });

  it("edits a monitor inline", async () => {
    const ctx = makeCtx();
    const { fireEvent } = await import("@testing-library/react");
    render(<MonitorsScreen ctx={ctx} />);
    await screen.findByText("API health");
    fireEvent.click(screen.getByRole("button", { name: "Edit API health" }));
    fireEvent.change(screen.getByLabelText("Monitor name"), { target: { value: "API health v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save monitor" }));
    await waitFor(() =>
      expect(ctx.client.updateMonitor).toHaveBeenCalledWith("mon_http", expect.objectContaining({ name: "API health v2" })),
    );
  });

  it("archives a monitor with a 2-click confirm", async () => {
    const ctx = makeCtx();
    const { fireEvent } = await import("@testing-library/react");
    render(<MonitorsScreen ctx={ctx} />);
    await screen.findByText("API health");
    const archive = screen.getByRole("button", { name: "Archive API health" });
    fireEvent.click(archive); // arm
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ })); // confirm
    await waitFor(() => expect(ctx.client.archiveMonitor).toHaveBeenCalledWith("mon_http"));
  });
});
```

Note: the create-panel `name`/`url` inputs and the edit-form `name` input all use the same `aria-label`s (`Monitor name`, `Monitor URL`); the mutation tests open exactly one of those panels at a time, so each label resolves uniquely within its test. The edit row's edit/archive buttons live in the row `Actions` cell added in this task.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sigmon/console test -- MonitorsScreen`
Expected: FAIL — create panel, edit form, archive button not yet rendered.

- [ ] **Step 3: Extend the implementation**

In `MonitorsScreen.tsx`:

(a) Extend the imports (add `SecretField`; the inline `ArchiveButton` below is used instead of `ConfirmButton` so the archive control has a stable accessible name in both states):

```tsx
import { EmptyHint, Icon, PageHead, SecretField, Segmented, StatusDot } from "../../components/ui/v2";
import type { CreateHeartbeatForm, CreateHttpForm, EditMonitorForm, MonitorChannelVM, MonitorCheckVM, MonitorRollupVM, MonitorRowVM, LatestMonitorSecret } from "./useMonitors";
```

(b) Add validation helpers (module scope, ported from v1):

```tsx
function parsePositiveInteger(value: string, minimum: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : null;
}

function validateHttpUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Monitor URL must be a valid http or https URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Monitor URL must be a valid http or https URL";
  if (parsed.username || parsed.password) return "Monitor URL must not include credentials";
  return null;
}
```

(c) Add a channel `<select>` helper component (module scope):

```tsx
function ChannelSelect({ channels, value, onChange }: { channels: MonitorChannelVM[]; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
      <span className="sh-faint">Channel</span>
      <select className="sh-input" aria-label="Notification channel" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">No channel</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
    </label>
  );
}
```

(d) Add a `CreatePanel` component (module scope). It owns its own form state and a kind toggle; it calls back into the screen's create actions:

```tsx
function CreatePanel({
  channels,
  busy,
  onCreateHttp,
  onCreateHeartbeat,
  onError,
}: {
  channels: MonitorChannelVM[];
  busy: boolean;
  onCreateHttp: (form: CreateHttpForm) => Promise<boolean>;
  onCreateHeartbeat: (form: CreateHeartbeatForm) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = useState<"HTTP" | "Heartbeat">("HTTP");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("5");
  const [timeoutMs, setTimeoutMs] = useState("5000");
  const [expectedIntervalMinutes, setExpectedIntervalMinutes] = useState("5");
  const [graceMinutes, setGraceMinutes] = useState("2");
  const [channelId, setChannelId] = useState("");

  function reset() {
    setName(""); setUrl(""); setIntervalMinutes("5"); setTimeoutMs("5000");
    setExpectedIntervalMinutes("5"); setGraceMinutes("2");
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return onError("Monitor name is required");
    if (kind === "HTTP") {
      const u = url.trim();
      const urlError = validateHttpUrl(u);
      if (urlError) return onError(urlError);
      const interval = parsePositiveInteger(intervalMinutes, 1);
      const timeout = parsePositiveInteger(timeoutMs, 100);
      if (interval === null || timeout === null) return onError("Interval and timeout must be valid numbers");
      const ok = await onCreateHttp({ name: trimmed, url: u, intervalMinutes: interval, timeoutMs: timeout, notificationChannelId: channelId });
      if (ok) reset(); else onError("Could not create HTTP monitor");
    } else {
      const interval = parsePositiveInteger(expectedIntervalMinutes, 1);
      const grace = parsePositiveInteger(graceMinutes, 0);
      if (interval === null || grace === null) return onError("Interval and grace must be valid numbers");
      const ok = await onCreateHeartbeat({ name: trimmed, expectedIntervalMinutes: interval, graceMinutes: grace, notificationChannelId: channelId });
      if (ok) reset(); else onError("Could not create heartbeat monitor");
    }
  }

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">New monitor</h2>
        <Segmented options={["HTTP", "Heartbeat"]} value={kind} onChange={(v) => setKind(v as "HTTP" | "Heartbeat")} />
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
          <span className="sh-faint">Name</span>
          <input className="sh-input" aria-label="Monitor name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {kind === "HTTP" ? (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
              <span className="sh-faint">URL</span>
              <input className="sh-input" aria-label="Monitor URL" placeholder="https://api.example.com/health" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                <span className="sh-faint">Interval (min)</span>
                <input className="sh-input" aria-label="Check interval" type="number" min="1" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                <span className="sh-faint">Timeout (ms)</span>
                <input className="sh-input" aria-label="Timeout" type="number" min="100" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} />
              </label>
            </div>
          </>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
              <span className="sh-faint">Expected interval (min)</span>
              <input className="sh-input" aria-label="Expected interval" type="number" min="1" value={expectedIntervalMinutes} onChange={(e) => setExpectedIntervalMinutes(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
              <span className="sh-faint">Grace (min)</span>
              <input className="sh-input" aria-label="Grace" type="number" min="0" value={graceMinutes} onChange={(e) => setGraceMinutes(e.target.value)} />
            </label>
          </div>
        )}
        <ChannelSelect channels={channels} value={channelId} onChange={setChannelId} />
        <div>
          <button className="sh-btn primary" disabled={busy} onClick={() => void submit()}>Create monitor</button>
        </div>
      </div>
    </div>
  );
}
```

(e) Add a `SecretBanner` component (module scope):

```tsx
function SecretBanner({ secret, onDismiss }: { secret: LatestMonitorSecret; onDismiss: () => void }) {
  return (
    <div className="sh-stripe ok" style={{ display: "grid", gap: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>Heartbeat created — {secret.monitorName}</strong>
        <button className="sh-iconbtn-sm" title="Dismiss" onClick={onDismiss}><Icon name="x" size={13} /></button>
      </div>
      <div style={{ fontSize: 11.5 }} className="sh-faint">Copy the secret and check-in URL now — the secret is shown only once.</div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
        <span className="sh-faint">Check-in URL</span>
        <SecretField value={secret.url} masked={false} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
        <span className="sh-faint">Secret</span>
        <SecretField value={secret.secret} />
      </label>
    </div>
  );
}
```

(f) Add an `EditRow` component (module scope) that renders an inline editor for a monitor:

```tsx
function EditRow({
  row,
  channels,
  busy,
  onSave,
  onCancel,
  onError,
}: {
  row: MonitorRowVM;
  channels: MonitorChannelVM[];
  busy: boolean;
  onSave: (form: EditMonitorForm) => Promise<boolean>;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  // Seed from the row VM via a one-time initializer; raw monitor fields are not
  // on the VM, so editable numeric/url fields start from sensible string defaults
  // and the user adjusts what they need (parity with v1's edit form intent).
  const [name, setName] = useState(row.name);
  const [enabled, setEnabled] = useState(row.enabled);
  const [channelId, setChannelId] = useState("");
  const [url, setUrl] = useState(row.kind === "http" ? row.target : "");
  const [intervalMinutes, setIntervalMinutes] = useState("5");
  const [timeoutMs, setTimeoutMs] = useState("5000");
  const [expectedIntervalMinutes, setExpectedIntervalMinutes] = useState("5");
  const [graceMinutes, setGraceMinutes] = useState("2");

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return onError("Monitor name is required");
    const base = { id: row.id, kind: row.kind, name: trimmed, enabled, notificationChannelId: channelId };
    if (row.kind === "http") {
      const u = url.trim();
      const urlError = validateHttpUrl(u);
      if (urlError) return onError(urlError);
      const interval = parsePositiveInteger(intervalMinutes, 1);
      const timeout = parsePositiveInteger(timeoutMs, 100);
      if (interval === null || timeout === null) return onError("Interval and timeout must be valid numbers");
      const ok = await onSave({ ...base, url: u, intervalMinutes: interval, timeoutMs: timeout, expectedIntervalMinutes: 5, graceMinutes: 2 });
      if (!ok) onError("Could not update monitor");
    } else {
      const interval = parsePositiveInteger(expectedIntervalMinutes, 1);
      const grace = parsePositiveInteger(graceMinutes, 0);
      if (interval === null || grace === null) return onError("Interval and grace must be valid numbers");
      const ok = await onSave({ ...base, url: "", intervalMinutes: 5, timeoutMs: 5000, expectedIntervalMinutes: interval, graceMinutes: grace });
      if (!ok) onError("Could not update monitor");
    }
  }

  return (
    <div className="sh-card__body" style={{ display: "grid", gap: 12, background: "var(--bg-surface-2)" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
        <span className="sh-faint">Name</span>
        <input className="sh-input" aria-label="Monitor name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {row.kind === "http" ? (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
            <span className="sh-faint">URL</span>
            <input className="sh-input" aria-label="Monitor URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
              <span className="sh-faint">Interval (min)</span>
              <input className="sh-input" aria-label="Check interval" type="number" min="1" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
              <span className="sh-faint">Timeout (ms)</span>
              <input className="sh-input" aria-label="Timeout" type="number" min="100" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} />
            </label>
          </div>
        </>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
            <span className="sh-faint">Expected interval (min)</span>
            <input className="sh-input" aria-label="Expected interval" type="number" min="1" value={expectedIntervalMinutes} onChange={(e) => setExpectedIntervalMinutes(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
            <span className="sh-faint">Grace (min)</span>
            <input className="sh-input" aria-label="Grace" type="number" min="0" value={graceMinutes} onChange={(e) => setGraceMinutes(e.target.value)} />
          </label>
        </div>
      )}
      <ChannelSelect channels={channels} value={channelId} onChange={setChannelId} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="sh-btn primary" disabled={busy} onClick={() => void save()}>Save monitor</button>
        <button className="sh-btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

(g) In the `MonitorsScreen` body, add `editId` state and the row action buttons, the create panel, and the secret banner. Replace the `MonitorRow` invocation block and add the action buttons by passing an `actions` slot:

Add state near the other `useState` calls:

```tsx
const [editId, setEditId] = useState<string | null>(null);
```

Update `MonitorRow` to render its `Actions` cell — change its signature to accept `onEdit` and `onArchive`, change the outer element from `<button>` to a `<div role="button" tabIndex={0}>` (so the nested action buttons are valid) wired to `onClick` and `onKeyDown` (Enter/Space → `onSelect`) with the same `.sh-row` classes/style, and replace the trailing `<span />` with:

```tsx
function MonitorRow({
  row,
  selected,
  onSelect,
  onEdit,
  onArchive,
}: {
  row: MonitorRowVM;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  // ...identical leading cells, outer element now <div role="button" tabIndex={0}>...
      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
        <button className="sh-iconbtn-sm" aria-label={`Edit ${row.name}`} title="Edit" onClick={onEdit}>
          <Icon name="edit" size={13} />
        </button>
        <ArchiveButton name={row.name} onArchive={onArchive} />
      </div>
```

`ArchiveButton` is an inline 2-state confirm control (used instead of `ConfirmButton` so it carries a stable `aria-label` — `Archive {name}` disarmed, `Confirm archive {name}` armed — in both states):

```tsx
function ArchiveButton({ name, onArchive }: { name: string; onArchive: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`sh-iconbtn-sm${armed ? " danger" : ""}`}
      aria-label={armed ? `Confirm archive ${name}` : `Archive ${name}`}
      title={armed ? "Confirm?" : "Archive"}
      onClick={() => {
        if (armed) { onArchive(); setArmed(false); } else setArmed(true);
      }}
    >
      <Icon name={armed ? "alert" : "archive"} size={13} />
    </button>
  );
}
```

and use `<ArchiveButton name={row.name} onArchive={onArchive} />` in the actions cell. (The archive test arms with `Archive API health`, then clicks `Confirm archive API health` — update the test's second click selector to `name: /Confirm archive/` accordingly.)

In the list mapping, render the edit row when `editId === row.id`:

```tsx
{shownRows.map((row) => (
  <div key={row.id}>
    <MonitorRow
      row={row}
      selected={selectedId === row.id}
      onSelect={() => setSelectedId((cur) => (cur === row.id ? null : row.id))}
      onEdit={() => setEditId((cur) => (cur === row.id ? null : row.id))}
      onArchive={() => void monitors.archiveMonitor(row.id)}
    />
    {editId === row.id ? (
      <EditRow
        row={row}
        channels={monitors.data!.channels}
        busy={monitors.busy}
        onSave={async (form) => {
          const ok = await monitors.updateMonitor(form);
          if (ok) setEditId(null);
          return ok;
        }}
        onCancel={() => setEditId(null)}
        onError={ctx.pushToast}
      />
    ) : selectedId === row.id ? (
      <CheckHistory checks={checks} loading={checksLoading} />
    ) : null}
  </div>
))}
```

Render the secret banner (when present) and the create panel (when `showCreate`) between the `Rollup` and the list card:

```tsx
{monitors.latestSecret ? <SecretBanner secret={monitors.latestSecret} onDismiss={monitors.clearSecret} /> : null}
{showCreate ? (
  <CreatePanel
    channels={monitors.data.channels}
    busy={monitors.busy}
    onCreateHttp={monitors.createHttpMonitor}
    onCreateHeartbeat={monitors.createHeartbeatMonitor}
    onError={ctx.pushToast}
  />
) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @sigmon/console test -- MonitorsScreen`
Expected: PASS (display tests from T2 still green + the four mutation tests).

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/v2/screens/MonitorsScreen.tsx apps/console/src/v2/screens/MonitorsScreen.test.tsx
git commit -m "feat(console): monitors v2 create, edit, archive and heartbeat secret"
```

---

## Task 4: Nav + registry wiring

**Files:**
- Modify: `apps/console/src/v2/nav.ts`
- Modify: `apps/console/src/v2/ConsoleShellV2.tsx`
- Modify: `apps/console/src/v2/screens/registry.tsx`
- Modify: `apps/console/src/v2/screens/registry.test.tsx`

**Interfaces:**
- Consumes: `MonitorsScreen` from Task 2/3.
- Produces: a `"monitors"` `NavSection`, a `NAV` item, a `NAV_LABELS` entry, a `commandDestinations` entry, and a `SCREENS` registry entry.

Adding `"monitors"` to the `NavSection` union makes TypeScript require an entry in **both** exhaustive `Record<NavSection, …>` maps — `SCREENS` (registry.tsx:51) and `NAV_LABELS` (ConsoleShellV2.tsx:50). The `NavRail.test.tsx` count assertion re-derives `NAV.length + NAV_BOTTOM.length`, so adding a `NAV` item keeps it green automatically.

- [ ] **Step 1: Add `monitors` to the nav model**

In `apps/console/src/v2/nav.ts`, extend the union and the `NAV` array (placed after `alerts`, per spec):

```ts
export type NavSection =
  | "overview"
  | "investigate"
  | "incidents"
  | "llm"
  | "traces"
  | "alerts"
  | "monitors"
  | "system"
  | "settings";
```

```ts
export const NAV: NavItem[] = [
  { id: "overview",    icon: "home",      label: "Overview" },
  { id: "investigate", icon: "activity",  label: "Investigate" },
  { id: "incidents",   icon: "error",     label: "Incidents", badge: true },
  { id: "llm",         icon: "sparkles",  label: "LLM" },
  { id: "traces",      icon: "waterfall", label: "Traces" },
  { id: "alerts",      icon: "bell",      label: "Alerts" },
  { id: "monitors",    icon: "pulse",     label: "Monitors" },
];
```

- [ ] **Step 2: Run the type-check to see the forced errors**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: FAIL — `NAV_LABELS` and `SCREENS` are missing the `monitors` property.

- [ ] **Step 3: Add the registry entry**

In `apps/console/src/v2/screens/registry.tsx`, import the screen and add the entry (after `alerts`, before `system`):

```tsx
import { MonitorsScreen } from "./MonitorsScreen";
```

```tsx
  monitors: {
    kind: "v2",
    render: (ctx) => <MonitorsScreen ctx={ctx} />,
  },
```

- [ ] **Step 4: Add the shell label + command destination**

In `apps/console/src/v2/ConsoleShellV2.tsx`, add to `NAV_LABELS` (after `alerts`):

```tsx
  monitors: "Monitors",
```

And add a `commandDestinations` entry (read the array around line 302 and mirror the existing shape) so the command palette can jump to Monitors:

```tsx
  { section: "monitors", title: "Monitors", description: "HTTP uptime and heartbeat checks" },
```

- [ ] **Step 5: Run the type-check to verify it passes**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Add the registry test**

In `apps/console/src/v2/screens/registry.test.tsx`, add monitor client mocks to `makeClient` so the screen renders content:

```tsx
    listMonitors: vi.fn().mockResolvedValue({ monitors: [] }),
    listMonitorChecks: vi.fn().mockResolvedValue({ checks: [] }),
```

(`listNotificationChannels` is already mocked.) Add the test (mirror the system/alerts entry tests):

```tsx
  it("routes monitors to a v2 screen", () => {
    expect(SCREENS.monitors.kind).toBe("v2");
  });

  it("renders the v2 Monitors screen (not wrapped in the legacy island)", () => {
    const { container } = render(<>{renderSection("monitors", makeCtx())}</>);
    expect(container.querySelector(".console-legacy-island")).toBeNull();
  });
```

- [ ] **Step 7: Run the console suite + type-check**

Run: `pnpm --filter @sigmon/console test` then `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: PASS / clean. Pay attention to `NavRail.test.tsx`, `ConsoleShellV2.test.tsx`, and `registry.test.tsx` — confirm none assert the old 8-section nav shape (the count assertion re-derives, so it should stay green; verify, do not assume — S10 lesson).

- [ ] **Step 8: Commit**

```bash
git add apps/console/src/v2/nav.ts apps/console/src/v2/ConsoleShellV2.tsx apps/console/src/v2/screens/registry.tsx apps/console/src/v2/screens/registry.test.tsx
git commit -m "feat(console): wire monitors v2 nav section and registry entry"
```

---

## Final verification (whole branch, before PR)

- [ ] Run the full gate from the repo root and confirm all green with no regression:

```bash
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config
```

- [ ] Confirm no `package.json`/`pnpm-lock.yaml` change (console-only TS) — `git diff --name-only main...HEAD` lists only console source + this plan/spec.

## Self-Review (against the spec)

- **Spec coverage:** PageHead + kind filter (T2) ✓; status rollup re-homing the Operations gap (T2 `Rollup`) ✓; monitors list with StatusDot/kind/target/cadence/last-check/channel (T2) ✓; lazy check history (T2) ✓; create HTTP + heartbeat with one-time secret banner (T3) ✓; inline edit (T3) ✓; 2-click archive (T3) ✓; channel assignment (T3 `ChannelSelect`) ✓; status mapping (T1 `monitorStatusToV2`) ✓; optional-client "API unavailable" guard (T1 hook + T2 state) ✓; all states (T2) ✓; nav section + registry (T4) ✓; determinism via `relativeTimeFrom(iso, nowMs)` (T1) ✓; tests across all three files ✓.
- **Placeholder scan:** the only deliberate interim is T2's `showCreate` boolean whose panel arrives in T3 — flagged explicitly, not a shipped no-op. No "TBD"/"add error handling"/"similar to" left in steps; all code is complete.
- **Type consistency:** action form types (`CreateHttpForm`/`CreateHeartbeatForm`/`EditMonitorForm`) defined in T1 are consumed verbatim in T3; `MonitorsVM`/`MonitorRowVM`/`MonitorChannelVM`/`MonitorCheckVM`/`LatestMonitorSecret` defined in T1 are imported by T2/T3; hook action signatures (`=> Promise<boolean>`, `archiveMonitor => Promise<void>`, `loadChecks => Promise<MonitorCheckVM[]>`) match their call sites.
- **Out of scope (→ PER-364):** advanced HTTP fields (`method`/`expectedStatus`/`bodyContains`/thresholds) beyond v1 defaults; per-row pause/resume outside edit; removing the v1 `monitors` mount at epic exit; a monitors mini-rollup on Overview.

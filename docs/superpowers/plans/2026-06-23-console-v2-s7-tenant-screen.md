# Console v2 S7 — Tenant detail screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a v2 dark-redesign **Tenant detail** screen, reachable as a shell drill target, consuming the merged entity backend (`getEntityTenantDetail`), and activate the tenant drill the LLM screen stubbed.

**Architecture:** A `useTenant` hook + pure `buildTenantVM` builder (mirrors S6 `buildTraceDetail`), a `TenantScreen({ ctx, tenantId })` component (mirrors `IncidentScreen`), and shell drill plumbing (extend `DrillTarget`/`DrillParams`, route `ConsoleShellV2` detail state, wire `LlmScreen` top-tenants rows).

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library (jsdom), v2 UI primitives barrel `apps/console/src/components/ui/v2`.

## Global Constraints

- **English UI copy only** (CLAUDE.md mandate; design source is pt-BR).
- **Dark-only**, `.sh-v2`-scoped CSS; import all primitives/formatters from the barrel `"../../components/ui/v2"`.
- Every **new DOM `*.test.ts(x)` file MUST carry `// @vitest-environment jsdom` as line 1** (repo-root `pnpm test` = `vitest run` defaults to node; `renderHook`/`render` fail without it). Pure-only test files (no DOM) do not need it.
- Hooks use the **`genRef` race-guard** pattern verbatim from `useLlm` (`apps/console/src/v2/screens/useLlm.ts`): `const gen = ++genRef.current` at effect start; `if (gen !== genRef.current) return` before every setState; cleanup `return () => { ++genRef.current; }`; `tick` state + `reload = useCallback(() => setTick(t => t + 1), [])`; `// eslint-disable-next-line react-hooks/exhaustive-deps`; deps `[projectId, environmentId, tenantId, window, tick]`.
- `costUsd`/`llmCostUsd` are numeric **strings** → `Number(...)` before formatting.
- **No regression to the incident drill path:** the shell render switch must still route `"incident"` to `IncidentScreen` with the same props.
- **Pre-disambiguate every test assertion on a string that legitimately appears 2+ times** (e.g. KPI label "Events"/"Errors"/"Traces" also appears as an Activity-by-type bar label) using `getAllByText(...).length >= 1` or `within(card)`. Do NOT rename design copy to dodge duplicate-text collisions — fix the TEST.

---

### Task 1: `formatClockUtc` formatter

**Files:**
- Modify: `apps/console/src/components/ui/v2/format.ts` (append a new export after `formatUtcTimestamp`)
- Test: `apps/console/src/components/ui/v2/format.test.ts` (append cases; file is pure — no jsdom pragma)

**Interfaces:**
- Produces: `formatClockUtc(isoString: string): string` — `"HH:MM:SS"` in UTC; invalid input → `"—"`.

- [ ] **Step 1: Write the failing tests** — append to `format.test.ts` (inside the existing top-level structure; add a new `describe`):

```ts
describe("formatClockUtc", () => {
  it("formats UTC clock time as HH:MM:SS", () => {
    expect(formatClockUtc("2026-06-23T12:42:08.412Z")).toBe("12:42:08");
  });
  it("zero-pads hours, minutes, and seconds", () => {
    expect(formatClockUtc("2026-06-23T03:04:05.000Z")).toBe("03:04:05");
  });
  it("returns an em-dash for invalid input", () => {
    expect(formatClockUtc("not-a-date")).toBe("—");
  });
});
```

Ensure `formatClockUtc` is added to the existing import from `"./format"` at the top of `format.test.ts`.

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @sigmon/console test -- format.test.ts`
Expected: FAIL — `formatClockUtc is not a function` (or import error).

- [ ] **Step 3: Implement** — append to `format.ts` after `formatUtcTimestamp`:

```ts
/**
 * Formats an ISO timestamp as "HH:MM:SS" (UTC fields), for dense timeline rows.
 * Invalid input returns an em-dash.
 */
export function formatClockUtc(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @sigmon/console test -- format.test.ts`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/format.ts apps/console/src/components/ui/v2/format.test.ts
git commit -m "feat(console): add formatClockUtc for tenant timeline rows"
```

---

### Task 2: `useTenant` hook + pure `buildTenantVM`

**Files:**
- Create: `apps/console/src/v2/screens/useTenant.ts`
- Test: `apps/console/src/v2/screens/useTenant.test.ts`

**Interfaces:**
- Consumes: `ApiClient["getEntityTenantDetail"]`, types `TenantDetailResponse`/`TenantSummary`/`TenantTopUser`/`TenantTimelineRow`/`EntityWindow` from `../../api/types`; `IconName` and formatters from `../../components/ui/v2`; `NavSection` from `../nav`; `formatClockUtc`, `formatCompact`, `formatUsd`, `formatLatency`, `relativeTime` from the barrel.
- Produces:
  - `export type TenantDetailVM = { header: TenantHeaderVM; kpis: TenantKpiVM[]; timeline: TimelineRowVM[]; topUsers: TopUserVM[]; signalBars: SignalBarVM[] }`
  - `export function buildTenantVM(res: TenantDetailResponse): TenantDetailVM` (pure)
  - `export function useTenant(args): UseTenantResult` with `{ data: TenantDetailResponse | null; status: "loading" | "ok" | "error"; reload: () => void }`

- [ ] **Step 1: Write the failing tests** — `useTenant.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantDetailResponse } from "../../api/types";
import { buildTenantVM, useTenant } from "./useTenant";

afterEach(() => vi.restoreAllMocks());

const RESPONSE: TenantDetailResponse = {
  window: "24h",
  generatedAt: "2026-06-23T13:00:00.000Z",
  scope: { projectId: "p", environmentId: "e" },
  range: { from: "2026-06-22T13:00:00.000Z", to: "2026-06-23T13:00:00.000Z" },
  tenant: {
    tenantId: "tenant_acme", label: "Acme Corp", traits: {},
    keyTraits: { plan: "Enterprise", status: "active" },
    isUnassigned: false, impactScore: 42, lastSeenAt: "2026-06-23T12:59:00.000Z",
    events: 482000, errors: 148, openErrors: 4, severeErrors: 2,
    traces: 1820, failedTraces: 12, llmCalls: 32014, failedLlmCalls: 8,
    llmCostUsd: "68.42", activeUsers: 142, activeSessions: 3418,
  },
  topUsers: [
    { userId: "user_8420", events: 1842, errors: 2, traces: 90, llmCalls: 120, llmCostUsd: "24.18", lastSeenAt: "2026-06-23T12:50:00.000Z" },
  ],
  timeline: [
    { type: "error", id: "er1", timestamp: "2026-06-23T12:42:32.000Z", label: "PaymentTimeoutError", userId: "user_8420", sessionId: null, traceId: null, severity: "critical", status: "open", message: "PaymentTimeoutError: provider timeout" },
    { type: "llm", id: "ll1", timestamp: "2026-06-23T12:41:50.000Z", label: "fraud_check", userId: "user_8420", sessionId: null, traceId: "tr1", provider: "anthropic", model: "claude-3.7", promptName: "fraud_check", status: "success", costUsd: "0.0042" },
    { type: "trace", id: "tc1", timestamp: "2026-06-23T12:40:18.000Z", label: "generate_dashboard", userId: "user_8420", sessionId: null, traceId: "tr2", status: "success", durationMs: 1840, name: "generate_dashboard" },
    { type: "event", id: "ev1", timestamp: "2026-06-23T12:35:14.000Z", label: "user.logged_in", userId: "user_8420", sessionId: "sess_1", traceId: null, eventName: "user.logged_in" },
  ],
};

describe("buildTenantVM", () => {
  it("derives header initials, label, id, status, and plan", () => {
    const vm = buildTenantVM(RESPONSE);
    expect(vm.header.initials).toBe("AC");
    expect(vm.header.label).toBe("Acme Corp");
    expect(vm.header.tenantId).toBe("tenant_acme");
    expect(vm.header.statusLabel).toBe("active");
    expect(vm.header.plan).toBe("Enterprise");
  });

  it("maps the six KPIs in order with formatted values", () => {
    const vm = buildTenantVM(RESPONSE);
    expect(vm.kpis.map((k) => k.label)).toEqual(["Active users", "Events", "LLM cost", "Errors", "Traces", "Sessions"]);
    expect(vm.kpis[1].value).toBe("482K"); // events compact
    expect(vm.kpis[2].value).toBe("$ 68.42"); // llm cost
    expect(vm.kpis[5].value).toBe("3,418"); // sessions
  });

  it("maps timeline rows to icon/tone/nav per type", () => {
    const vm = buildTenantVM(RESPONSE);
    const [err, llm, trace, evt] = vm.timeline;
    expect(err.icon).toBe("error");
    expect(err.tone).toBe("critical");
    expect(err.navTo).toBeNull(); // no groupId → not drillable
    expect(err.clock).toBe("12:42:32");
    expect(llm.icon).toBe("sparkles");
    expect(llm.tone).toBe("violet");
    expect(llm.navTo).toBe("llm");
    expect(trace.icon).toBe("waterfall");
    expect(trace.navTo).toBe("traces");
    expect(evt.icon).toBe("activity");
    expect(evt.navTo).toBeNull();
  });

  it("maps top users with initials, events, and cost", () => {
    const vm = buildTenantVM(RESPONSE);
    expect(vm.topUsers[0].userId).toBe("user_8420");
    expect(vm.topUsers[0].events).toBe("1,842");
    expect(vm.topUsers[0].cost).toBe("$ 24.18");
  });

  it("builds activity-by-type bars with ratios relative to the max", () => {
    const vm = buildTenantVM(RESPONSE);
    expect(vm.signalBars.map((b) => b.label)).toEqual(["Events", "LLM calls", "Traces", "Errors"]);
    const events = vm.signalBars[0];
    expect(events.ratio).toBe(1); // events is the max
    expect(events.display).toBe("482K");
  });

  it("falls back gracefully when tenant fields are missing", () => {
    const vm = buildTenantVM({
      ...RESPONSE,
      tenant: { ...RESPONSE.tenant, tenantId: null, label: "", keyTraits: {}, lastSeenAt: null },
      topUsers: [], timeline: [],
    });
    expect(vm.header.initials).toBe("?");
    expect(vm.header.tenantId).toBe("—");
    expect(vm.header.statusLabel).toBe("inactive");
    expect(vm.header.plan).toBe("—");
    expect(vm.timeline).toEqual([]);
    expect(vm.topUsers).toEqual([]);
  });
});

describe("useTenant", () => {
  it("fetches detail and resolves to ok with the raw response", async () => {
    const getEntityTenantDetail = vi.fn().mockResolvedValue({ data: RESPONSE });
    const { result } = renderHook(() =>
      useTenant({ client: { getEntityTenantDetail }, projectId: "p", environmentId: "e", tenantId: "tenant_acme", window: "24h" })
    );
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data).toEqual(RESPONSE);
    expect(getEntityTenantDetail).toHaveBeenCalledWith("tenant_acme", { projectId: "p", environmentId: "e", window: "24h" });
  });

  it("does not fetch without project/env/tenant", () => {
    const getEntityTenantDetail = vi.fn();
    renderHook(() => useTenant({ client: { getEntityTenantDetail }, projectId: undefined, environmentId: "e", tenantId: "t", window: "24h" }));
    expect(getEntityTenantDetail).not.toHaveBeenCalled();
  });

  it("resolves to error when the fetch rejects", async () => {
    const getEntityTenantDetail = vi.fn().mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useTenant({ client: { getEntityTenantDetail }, projectId: "p", environmentId: "e", tenantId: "t", window: "24h" })
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @sigmon/console test -- useTenant.test.ts`
Expected: FAIL — module `./useTenant` not found.

- [ ] **Step 3: Implement** — create `useTenant.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  EntityWindow,
  TenantDetailResponse,
  TenantSummary,
  TenantTimelineRow,
  TenantTopUser,
} from "../../api/types";
import {
  formatClockUtc,
  formatCompact,
  formatLatency,
  formatUsd,
  relativeTime,
  type IconName,
} from "../../components/ui/v2";
import type { NavSection } from "../nav";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type TimelineTone = "ok" | "critical" | "warning" | "info" | "violet";

export type TenantHeaderVM = {
  initials: string;
  label: string;
  tenantId: string;
  statusLabel: string;
  plan: string;
  lastSeen: string;
};

export type TenantKpiVM = { label: string; value: string; color?: string };

export type TimelineRowVM = {
  id: string;
  clock: string;
  icon: IconName;
  tone: TimelineTone;
  title: string;
  sub: string;
  tag: string | null;
  navTo: NavSection | null;
};

export type TopUserVM = {
  userId: string;
  initials: string;
  events: string;
  cost: string;
  lastSeen: string;
};

export type SignalBarVM = { label: string; display: string; ratio: number; color: string };

export type TenantDetailVM = {
  header: TenantHeaderVM;
  kpis: TenantKpiVM[];
  timeline: TimelineRowVM[];
  topUsers: TopUserVM[];
  signalBars: SignalBarVM[];
};

export type UseTenantResult = {
  data: TenantDetailResponse | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

type UseTenantArgs = {
  client: { getEntityTenantDetail: ApiClient["getEntityTenantDetail"] };
  projectId: string | undefined;
  environmentId: string | undefined;
  tenantId: string | undefined;
  window: EntityWindow;
};

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

function initialsOf(source: string): string {
  const cleaned = source.replace(/[^a-zA-Z0-9]/g, "");
  return cleaned ? cleaned.slice(0, 2).toUpperCase() : "?";
}

function joinParts(...parts: Array<string | null | undefined>): string {
  return parts.filter((p) => p != null && p !== "").join(" · ");
}

function toNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildHeader(t: TenantSummary): TenantHeaderVM {
  const label = t.label || t.tenantId || "Unknown tenant";
  return {
    initials: initialsOf(label),
    label,
    tenantId: t.tenantId ?? "—",
    statusLabel: t.keyTraits.status ?? (t.lastSeenAt ? "active" : "inactive"),
    plan: t.keyTraits.plan ?? "—",
    lastSeen: t.lastSeenAt ? relativeTime(t.lastSeenAt) : "—",
  };
}

function buildKpis(t: TenantSummary): TenantKpiVM[] {
  return [
    { label: "Active users", value: formatCompact(t.activeUsers) },
    { label: "Events", value: formatCompact(t.events) },
    { label: "LLM cost", value: formatUsd(toNum(t.llmCostUsd)), color: "var(--sev-violet)" },
    { label: "Errors", value: formatCompact(t.errors), color: "var(--sev-critical)" },
    { label: "Traces", value: formatCompact(t.traces), color: "var(--sev-warning)" },
    { label: "Sessions", value: formatCompact(t.activeSessions) },
  ];
}

function buildTimelineRow(row: TenantTimelineRow): TimelineRowVM {
  const base = { id: row.id, clock: formatClockUtc(row.timestamp) };
  switch (row.type) {
    case "event":
      return { ...base, icon: "activity", tone: "ok", title: row.eventName,
        sub: joinParts(row.userId, row.sessionId), tag: null, navTo: null };
    case "error":
      return { ...base, icon: "error",
        tone: /critical|fatal|error/i.test(row.severity) ? "critical" : "warning",
        title: row.message, sub: joinParts(row.userId), tag: row.severity, navTo: null };
    case "trace":
      return { ...base, icon: "waterfall", tone: "info", title: row.name,
        sub: joinParts(formatLatency(row.durationMs), row.userId), tag: null, navTo: "traces" };
    case "llm":
      return { ...base, icon: "sparkles", tone: "violet", title: row.promptName ?? row.model,
        sub: joinParts(`${row.provider}/${row.model}`, formatUsd(toNum(row.costUsd))), tag: null, navTo: "llm" };
  }
}

function buildTopUser(u: TenantTopUser): TopUserVM {
  return {
    userId: u.userId,
    initials: initialsOf(u.userId),
    events: formatCompact(u.events),
    cost: formatUsd(toNum(u.llmCostUsd)),
    lastSeen: u.lastSeenAt ? relativeTime(u.lastSeenAt) : "—",
  };
}

function buildSignalBars(t: TenantSummary): SignalBarVM[] {
  const raw = [
    { label: "Events", value: t.events, color: "var(--accent)" },
    { label: "LLM calls", value: t.llmCalls, color: "var(--sev-violet)" },
    { label: "Traces", value: t.traces, color: "var(--sev-info)" },
    { label: "Errors", value: t.errors, color: "var(--sev-critical)" },
  ];
  const max = Math.max(1, ...raw.map((r) => r.value));
  return raw.map((r) => ({ label: r.label, display: formatCompact(r.value), ratio: r.value / max, color: r.color }));
}

export function buildTenantVM(res: TenantDetailResponse): TenantDetailVM {
  return {
    header: buildHeader(res.tenant),
    kpis: buildKpis(res.tenant),
    timeline: res.timeline.map(buildTimelineRow),
    topUsers: res.topUsers.map(buildTopUser),
    signalBars: buildSignalBars(res.tenant),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTenant({ client, projectId, environmentId, tenantId, window }: UseTenantArgs): UseTenantResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<TenantDetailResponse | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId || !tenantId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    client
      .getEntityTenantDetail(tenantId, { projectId, environmentId, window })
      .then((res) => {
        if (gen !== genRef.current) return;
        setData(res.data);
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
  }, [projectId, environmentId, tenantId, window, tick]);

  return { data, status, reload };
}
```

NOTE: If TS reports `IconName` is not exported from the barrel, export it from `apps/console/src/components/ui/v2/icon.tsx` (it is already consumed by `EmptyHint`); do not invent a new type.

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @sigmon/console test -- useTenant.test.ts`
Expected: PASS (9).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: clean.

```bash
git add apps/console/src/v2/screens/useTenant.ts apps/console/src/v2/screens/useTenant.test.ts
git commit -m "feat(console): add useTenant hook and buildTenantVM"
```

---

### Task 3: `TenantScreen` component

**Files:**
- Create: `apps/console/src/v2/screens/TenantScreen.tsx`
- Test: `apps/console/src/v2/screens/TenantScreen.test.tsx`

**Interfaces:**
- Consumes: `ScreenCtx` from `./registry`; `useTenant`, `buildTenantVM`, VM types from `./useTenant`; primitives `BigKpi`, `EmptyHint`, `Icon`, `Segmented` from the barrel; `NavSection` from `../nav`; `EntityWindow` from `../../api/types`.
- Produces: `export function TenantScreen({ ctx, tenantId }: { ctx: ScreenCtx; tenantId: string })`.

- [ ] **Step 1: Write the failing tests** — `TenantScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project, TenantDetailResponse } from "../../api/types";
import { TenantScreen } from "./TenantScreen";
import type { ScreenCtx } from "./registry";
import * as useTenantModule from "./useTenant";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project = { id: "p", name: "Demo" } as Project;
const environment = { id: "e", name: "production" } as Environment;

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: {} as never,
    project, environment, environments: [environment],
    onCreateEnvironment: vi.fn(), onArchiveProject: vi.fn(), onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(), onUpdateProject: vi.fn(), navigate: vi.fn(), back: vi.fn(),
    drill: vi.fn(), pushToast: vi.fn(), ...over,
  } as ScreenCtx;
}

const RESPONSE: TenantDetailResponse = {
  window: "24h", generatedAt: "", scope: { projectId: "p", environmentId: "e" }, range: { from: "", to: "" },
  tenant: {
    tenantId: "tenant_acme", label: "Acme Corp", traits: {}, keyTraits: { plan: "Enterprise", status: "active" },
    isUnassigned: false, impactScore: 42, lastSeenAt: "2026-06-23T12:59:00.000Z",
    events: 482000, errors: 148, openErrors: 4, severeErrors: 2, traces: 1820, failedTraces: 12,
    llmCalls: 32014, failedLlmCalls: 8, llmCostUsd: "68.42", activeUsers: 142, activeSessions: 3418,
  },
  topUsers: [
    { userId: "user_8420", events: 1842, errors: 2, traces: 90, llmCalls: 120, llmCostUsd: "24.18", lastSeenAt: "2026-06-23T12:50:00.000Z" },
  ],
  timeline: [
    { type: "llm", id: "ll1", timestamp: "2026-06-23T12:41:50.000Z", label: "fraud_check", userId: "user_8420", sessionId: null, traceId: "tr1", provider: "anthropic", model: "claude-3.7", promptName: "fraud_check", status: "success", costUsd: "0.0042" },
    { type: "trace", id: "tc1", timestamp: "2026-06-23T12:40:18.000Z", label: "generate_dashboard", userId: "user_8420", sessionId: null, traceId: "tr2", status: "success", durationMs: 1840, name: "generate_dashboard" },
  ],
};

function mock(data: TenantDetailResponse | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useTenantModule, "useTenant").mockReturnValue({ data, status, reload: vi.fn() });
}

describe("TenantScreen", () => {
  it("guards missing project/env", () => {
    mock(null, "loading");
    render(<TenantScreen ctx={makeCtx({ project: undefined, environment: undefined })} tenantId="tenant_acme" />);
    expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    mock(null, "loading");
    const { rerender } = render(<TenantScreen ctx={makeCtx()} tenantId="tenant_acme" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mock(null, "error");
    rerender(<TenantScreen ctx={makeCtx()} tenantId="tenant_acme" />);
    expect(screen.getByText(/could not load tenant/i)).toBeInTheDocument();
  });

  it("renders the tenant header: label, id, status, plan", () => {
    mock(RESPONSE);
    render(<TenantScreen ctx={makeCtx()} tenantId="tenant_acme" />);
    expect(screen.getByRole("heading", { name: /Acme Corp/i })).toBeInTheDocument();
    expect(screen.getByText("tenant_acme")).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
    expect(screen.getByText(/Enterprise/)).toBeInTheDocument();
  });

  it("renders the six KPI tiles", () => {
    mock(RESPONSE);
    render(<TenantScreen ctx={makeCtx()} tenantId="tenant_acme" />);
    expect(screen.getByText("Active users")).toBeInTheDocument();
    expect(screen.getByText("LLM cost")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    // "Events"/"Errors"/"Traces" also label Activity-by-type bars → assert ≥1.
    expect(screen.getAllByText("Events").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Errors").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Traces").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the unified timeline and navigates on llm/trace rows", async () => {
    mock(RESPONSE);
    const ctx = makeCtx();
    render(<TenantScreen ctx={ctx} tenantId="tenant_acme" />);
    const timeline = screen.getByText(/unified timeline/i).closest(".sh-card") as HTMLElement;
    await userEvent.click(within(timeline).getByText("fraud_check"));
    expect(ctx.navigate).toHaveBeenCalledWith("llm");
    await userEvent.click(within(timeline).getByText("generate_dashboard"));
    expect(ctx.navigate).toHaveBeenCalledWith("traces");
  });

  it("renders top users and activity-by-type bars", () => {
    mock(RESPONSE);
    render(<TenantScreen ctx={makeCtx()} tenantId="tenant_acme" />);
    expect(screen.getByText(/top users/i)).toBeInTheDocument();
    expect(screen.getByText("user_8420")).toBeInTheDocument();
    expect(screen.getByText(/activity by type/i)).toBeInTheDocument();
    expect(screen.getByText("LLM calls")).toBeInTheDocument();
  });

  it("Watch tenant and Open in CRM push toasts; back calls ctx.back", async () => {
    mock(RESPONSE);
    const ctx = makeCtx();
    render(<TenantScreen ctx={ctx} tenantId="tenant_acme" />);
    await userEvent.click(screen.getByText(/watch tenant/i));
    expect(ctx.pushToast).toHaveBeenCalledWith("Watching Acme Corp");
    await userEvent.click(screen.getByText(/open in crm/i));
    expect(ctx.pushToast).toHaveBeenCalledWith("CRM integration is not yet available");
    await userEvent.click(screen.getByText(/^back$/i));
    expect(ctx.back).toHaveBeenCalled();
  });

  it("empty timeline and empty top users show hints", () => {
    mock({ ...RESPONSE, timeline: [], topUsers: [] });
    render(<TenantScreen ctx={makeCtx()} tenantId="tenant_acme" />);
    expect(screen.getByText(/no activity/i)).toBeInTheDocument();
    expect(screen.getByText(/no users/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @sigmon/console test -- TenantScreen.test.tsx`
Expected: FAIL — module `./TenantScreen` not found.

- [ ] **Step 3: Implement** — create `TenantScreen.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { EntityWindow } from "../../api/types";
import { BigKpi, EmptyHint, Icon, Segmented } from "../../components/ui/v2";
import type { NavSection } from "../nav";
import type { ScreenCtx } from "./registry";
import { buildTenantVM, useTenant } from "./useTenant";
import type { TimelineRowVM, TimelineTone, TopUserVM, SignalBarVM } from "./useTenant";

const WINDOW_OPTIONS: EntityWindow[] = ["24h", "7d", "30d"];

const TONE_COLOR: Record<TimelineTone, string> = {
  ok: "var(--accent)",
  critical: "var(--sev-critical)",
  warning: "var(--sev-warning)",
  info: "var(--sev-info)",
  violet: "var(--sev-violet)",
};

const AVATAR_GRADIENT = "linear-gradient(135deg, oklch(0.66 0.14 290), oklch(0.58 0.16 230))";

function TimelineRow({ row, ctx }: { row: TimelineRowVM; ctx: ScreenCtx }) {
  const clickable = row.navTo != null;
  return (
    <button
      className="sh-row--btn"
      style={{
        display: "grid", gridTemplateColumns: "70px 30px 1fr auto", gap: 10, padding: "11px 16px",
        borderBottom: "1px solid var(--border-subtle)", alignItems: "center", width: "100%",
        textAlign: "left", background: "transparent", border: "none",
        borderBottomColor: "var(--border-subtle)", borderBottomStyle: "solid", borderBottomWidth: 1,
        cursor: clickable ? "pointer" : "default",
      }}
      onClick={clickable ? () => ctx.navigate(row.navTo as NavSection) : undefined}
    >
      <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>{row.clock}</span>
      <span style={{ color: TONE_COLOR[row.tone] }}><Icon name={row.icon} size={14} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="sh-mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</div>
        <div className="sh-faint" style={{ fontSize: 11 }}>{row.sub}</div>
      </div>
      {row.tag ? <span className="sh-tag mono">{row.tag}</span> : <span />}
    </button>
  );
}

function TopUserRow({ user }: { user: TopUserVM }) {
  return (
    <div className="sh-row" style={{ gridTemplateColumns: "26px 1fr 70px 70px" }}>
      <div className="tb-avatar" style={{ width: 22, height: 22, fontSize: 9 }}>{user.initials}</div>
      <div>
        <div className="sh-mono" style={{ fontSize: 12 }}>{user.userId}</div>
        <div className="sh-faint" style={{ fontSize: 10.5 }}>last seen {user.lastSeen}</div>
      </div>
      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11.5 }}>{user.events}</span>
      <span style={{ color: "var(--sev-violet)", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>{user.cost}</span>
    </div>
  );
}

function SignalBar({ bar }: { bar: SignalBarVM }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
        <span className="sh-mono">{bar.label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{bar.display}</span>
      </div>
      <div style={{ height: 4, background: "var(--bg-canvas)", borderRadius: 2, marginTop: 4 }}>
        <div style={{ height: "100%", width: `${bar.ratio * 100}%`, background: bar.color, borderRadius: 2 }} />
      </div>
    </div>
  );
}

export function TenantScreen({ ctx, tenantId }: { ctx: ScreenCtx; tenantId: string }) {
  const [window, setWindow] = useState<EntityWindow>("24h");
  const projectId = ctx.project?.id ?? "";
  const environmentId = ctx.environment?.id ?? "";

  const { data, status } = useTenant({ client: ctx.client, projectId, environmentId, tenantId, window });
  const vm = useMemo(() => (data ? buildTenantVM(data) : null), [data]);

  const backBtn = (
    <button className="sh-btn ghost" onClick={() => ctx.back()} style={{ padding: "4px 8px", fontSize: 12 }}>
      <Icon name="arrow" size={12} style={{ transform: "rotate(180deg)" }} />Back
    </button>
  );

  if (!ctx.project || !ctx.environment) {
    return (
      <>
        <div style={{ marginBottom: 12 }}>{backBtn}</div>
        <EmptyHint icon="cube" title="No project selected" sub="Pick a project and environment to view tenant detail." />
      </>
    );
  }

  if (status === "loading" || !vm) {
    return (
      <>
        <div style={{ marginBottom: 12 }}>{backBtn}</div>
        <EmptyHint icon="activity" title="Loading tenant…" sub="Fetching tenant activity." />
      </>
    );
  }

  if (status === "error") {
    return (
      <>
        <div style={{ marginBottom: 12 }}>{backBtn}</div>
        <EmptyHint icon="error" title="Could not load tenant" sub="The tenant detail request failed. Try again." />
      </>
    );
  }

  const { header, kpis, timeline, topUsers, signalBars } = vm;

  return (
    <>
      <div style={{ marginBottom: 4 }}>{backBtn}</div>

      {/* Hero */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 13, background: AVATAR_GRADIENT, display: "grid", placeItems: "center", color: "white", fontWeight: 700, fontSize: 20 }}>{header.initials}</div>
          <div>
            <h1 className="sh-h1" style={{ fontSize: 22, marginBottom: 2 }}>{header.label}</h1>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="sh-tag mono">{header.tenantId}</span>
              <span className="sh-tag ok"><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />{header.statusLabel}</span>
              <span className="sh-faint" style={{ fontSize: 11.5 }}>plan: {header.plan} · last seen {header.lastSeen}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Segmented options={WINDOW_OPTIONS} value={window} onChange={(v) => setWindow(v as EntityWindow)} />
          <button className="sh-btn" onClick={() => ctx.pushToast("CRM integration is not yet available")}><Icon name="ext" size={13} />Open in CRM</button>
          <button className="sh-btn primary" onClick={() => ctx.pushToast(`Watching ${header.label}`)}><Icon name="bell" size={13} />Watch tenant</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
        {kpis.map((k) => <BigKpi key={k.label} label={k.label} value={k.value} color={k.color} />)}
      </div>

      {/* Timeline + side rail */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Unified timeline</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <span className="sh-tag ok">events</span>
              <span className="sh-tag critical">errors</span>
              <span className="sh-tag violet">llm</span>
              <span className="sh-tag info">traces</span>
            </div>
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {timeline.length === 0
              ? <EmptyHint icon="activity" title="No activity" sub="No timeline events in this window." />
              : timeline.map((row) => <TimelineRow key={row.id} row={row} ctx={ctx} />)}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0, overflow: "auto" }}>
          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Top users</h2></div>
            <div className="sh-card__body flush">
              {topUsers.length === 0
                ? <EmptyHint icon="users" title="No users" sub="No active users in this window." />
                : topUsers.map((u) => <TopUserRow key={u.userId} user={u} />)}
            </div>
          </div>
          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Activity by type</h2></div>
            <div className="sh-card__body" style={{ display: "grid", gap: 8 }}>
              {signalBars.map((b) => <SignalBar key={b.label} bar={b} />)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
```

NOTE on `Segmented`: its `onChange` is `(v: string) => void`; cast to `EntityWindow` as shown. If `Icon`'s `style` prop is not accepted, drop the inline `style` on the back-arrow `Icon` and rotate via a wrapping `span` instead — check the `Icon` signature before assuming.

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @sigmon/console test -- TenantScreen.test.tsx`
Expected: PASS (8).

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: clean.

```bash
git add apps/console/src/v2/screens/TenantScreen.tsx apps/console/src/v2/screens/TenantScreen.test.tsx
git commit -m "feat(console): add v2 TenantScreen detail screen"
```

---

### Task 4: Drill plumbing — shell routing + LLM wiring

**Files:**
- Modify: `apps/console/src/v2/screens/registry.tsx:17-18` (`DrillTarget`, `DrillParams`)
- Modify: `apps/console/src/v2/ConsoleShellV2.tsx` (detail state union ~line 81; `handleDrill` ~line 260; render switch ~line 333; import `TenantScreen`)
- Modify: `apps/console/src/v2/screens/LlmScreen.tsx:51` (`TenantRow` onClick)
- Test: `apps/console/src/v2/screens/LlmScreen.test.tsx` (update the existing tenant-stub test ~line 124-133)
- Test: `apps/console/src/v2/ConsoleShellV2.test.tsx` (add a tenant-drill routing test in the "drill/back navigation" describe)

**Interfaces:**
- Consumes: `TenantScreen` from `./screens/TenantScreen`.
- Produces: `DrillTarget = "incident" | "tenant"`; discriminated `DrillParams`; shell routes `detail.target === "tenant"` to `<TenantScreen ctx tenantId />`.

- [ ] **Step 1: Update the drill types** in `registry.tsx` — replace lines 17-18:

```tsx
export type DrillTarget = "incident" | "tenant";
export type DrillParams =
  | { groupId: string; errorId?: string }
  | { tenantId: string };
```

- [ ] **Step 2: Route the drill in `ConsoleShellV2.tsx`.**

(a) Add the import near the other screen imports (e.g. after the `IncidentScreen` import):
```tsx
import { TenantScreen } from "./screens/TenantScreen";
```
(If `IncidentScreen` is imported elsewhere, place `TenantScreen` beside it; match the existing import grouping.)

(b) Widen the `detail` state union (~line 81):
```tsx
const [detail, setDetail] = useState<
  | { target: "incident"; groupId: string; errorId?: string }
  | { target: "tenant"; tenantId: string }
  | null
>(null);
```

(c) Narrow in `handleDrill` (~line 260) so each branch builds a correctly-typed detail object:
```tsx
const handleDrill = useCallback((target: DrillTarget, params: DrillParams) => {
  if (target === "tenant" && "tenantId" in params) {
    setDetail({ target: "tenant", tenantId: params.tenantId });
  } else if (target === "incident" && "groupId" in params) {
    setDetail({ target: "incident", groupId: params.groupId, errorId: params.errorId });
  }
}, []);
```

(d) Replace the render ternary (~line 332-334):
```tsx
                ? detail
                  ? detail.target === "tenant"
                    ? <TenantScreen ctx={screenCtx} tenantId={detail.tenantId} />
                    : <IncidentScreen ctx={screenCtx} groupId={detail.groupId} errorId={detail.errorId} />
                  : renderSection(nav, screenCtx)
```

- [ ] **Step 3: Wire the LLM top-tenants row** in `LlmScreen.tsx` — replace the `TenantRow` `onClick` (line 51):

```tsx
      onClick={() => ctx.drill("tenant", { tenantId: row.tenantId })}
```

- [ ] **Step 4: Update the LlmScreen test** — in `LlmScreen.test.tsx`, the existing test (~line 124) titled "renders top tenants with cost, share, and a drill stub toast": rename it to "...drills into the tenant" and replace the final assertions:

```tsx
  it("renders top tenants with cost, share, and drills into the tenant", async () => {
    mockUseLlm(vm);
    const ctx = makeCtx();
    render(<LlmScreen ctx={ctx} />);
    expect(screen.getByText(/top tenants/i)).toBeInTheDocument();
    expect(screen.getByText("tenant_acme")).toBeInTheDocument();
    await userEvent.click(screen.getByText("tenant_acme"));
    expect(ctx.drill).toHaveBeenCalledWith("tenant", { tenantId: "tenant_acme" });
  });
```

(Keep the rest of the test body — share/cost assertions — as it was; only the click target's assertion changes from `pushToast` to `drill`. Use the existing `makeCtx`/`mockUseLlm` helpers and `vm` fixture from that file.)

- [ ] **Step 5: Add a shell tenant-drill routing test** — in `ConsoleShellV2.test.tsx`, inside the `describe("drill/back navigation", ...)` block, add:

```tsx
    it("drilling a tenant from the LLM screen renders TenantScreen", async () => {
      const user = userEvent.setup();
      const tenant = {
        tenantId: "tenant_acme", label: "Acme Corp", traits: {}, keyTraits: {},
        isUnassigned: false, impactScore: 0, lastSeenAt: null,
        events: 0, errors: 0, openErrors: 0, severeErrors: 0, traces: 0, failedTraces: 0,
        llmCalls: 10, failedLlmCalls: 0, llmCostUsd: "5", activeUsers: 0, activeSessions: 0,
      };
      const client = makeClient({
        getLlmSummary: vi.fn().mockResolvedValue({ data: { calls: 10, failedCalls: 0, costUsd: "5", avgTokens: null, avgLatencyMs: null, p95LatencyMs: null } }),
        getLlmByTenant: vi.fn().mockResolvedValue({ data: [{ tenantId: "tenant_acme", calls: 10, failedCalls: 0, costUsd: "5", avgTokens: null, avgLatencyMs: null, p95LatencyMs: null }] }),
        getLlmByPrompt: vi.fn().mockResolvedValue({ data: [] }),
        getLlmCostByModel: vi.fn().mockResolvedValue({ data: { buckets: [], series: [] } }),
        getEntityTenantDetail: vi.fn().mockResolvedValue({ data: { window: "24h", generatedAt: "", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: "", to: "" }, tenant, topUsers: [], timeline: [] } }),
      });
      render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);

      // Navigate to the LLM section via the nav rail.
      await waitFor(() => expect(screen.getByRole("button", { name: /^LLM$/i })).toBeInTheDocument());
      await user.click(screen.getByRole("button", { name: /^LLM$/i }));

      // The top-tenants row appears; clicking it drills into TenantScreen.
      await waitFor(() => expect(screen.getByText("tenant_acme")).toBeInTheDocument());
      await user.click(screen.getByText("tenant_acme"));

      await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /Acme Corp/i })).toBeInTheDocument());
    });
```

NOTE: the nav-rail button accessible name may not be exactly "LLM" — check how the existing "clicking a nav item changes the rendered section" test (around line 115) selects nav items and mirror that selector. Adjust the `getByRole`/name to match the actual NavRail markup.

- [ ] **Step 6: Run the affected tests, verify they pass**

Run: `pnpm --filter @sigmon/console test -- LlmScreen.test.tsx ConsoleShellV2.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit`
Expected: clean.

```bash
git add apps/console/src/v2/screens/registry.tsx apps/console/src/v2/ConsoleShellV2.tsx apps/console/src/v2/screens/LlmScreen.tsx apps/console/src/v2/screens/LlmScreen.test.tsx apps/console/src/v2/ConsoleShellV2.test.tsx
git commit -m "feat(console): wire tenant drill target into the v2 shell"
```

---

## Final verification (whole branch)

```sh
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config
```

All must pass with no regressions. The incident drill path must still render `IncidentScreen` unchanged; legacy sections unchanged.

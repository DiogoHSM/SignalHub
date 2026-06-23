# S5 · LLM observability screen (PER-352) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v2 LLM observability screen consuming the merged B2 aggregation backend, replacing the legacy LLM panel.

**Architecture:** Mirrors S4 Incidents: local `window` state → `useLlm` hook fetches 4 `/query/llm/*` endpoints in parallel → assembles `LlmVM` → `LlmScreen` renders PageHead + 5 KPIs + stacked-area cost-by-model + top-tenants list + prompts table. New `StackedArea` SVG chart. Registry flip `llm` legacy→v2.

**Tech Stack:** React 19, TypeScript ESM, Vitest + @testing-library/react (jsdom). `.sh-v2` CSS scope, existing v2 primitives.

## Global Constraints

- **English UI only** (CLAUDE.md), even though the design source is pt-BR.
- Read-only screen — no mutations.
- `costUsd` from backend is a numeric **string** — parse with `Number(...)` before math/format.
- Cost-by-model zero-fill buckets are `"0"` vs populated `"0.000000"` — parsing to number normalizes both.
- Client methods are **OPTIONAL** on `ApiClient` (`getLlmSummary?` … `getLlmCostByModel?`), matching `getOperations?`/`getIncidentMttr?`. The real client object provides them unconditionally.
- Window param values: `"24h" | "7d" | "30d"` (`OverviewWindow`), snake_case query params (`project_id`, `environment_id`, `window`) per `overviewPath` precedent.
- KPI deltas + per-KPI sparklines are out of scope (no backend series) → omit (BigKpi `delta`/`spark` optional).
- Tenant drill is degraded to a `pushToast` stub (tenant drill target lands in S7); tenant label = `tenantId` (no display name in backend).
- Money: cost values `$ X.XX` (`toFixed(2)`); run-rate `≈ $ N / mo` (rounded, thousands-grouped).
- Latency: `< 1000ms → "N ms"`, else `"N.N s"`; null → `"—"`.

---

### Task 1: Console API types + client methods

**Files:**
- Modify: `apps/console/src/api/types.ts` (add LLM aggregate types near existing `LlmAggregates`, ~line 362)
- Modify: `apps/console/src/api/client.ts` (add 4 optional methods to `ApiClient` type ~line 240; add path helper + 4 implementations ~line 757)

**Interfaces:**
- Produces (api/types.ts):
  ```ts
  export type LlmAggregateQuery = {
    projectId: string;
    environmentId: string;
    window: OverviewWindow;
  };

  export type LlmSummary = {
    calls: number;
    failedCalls: number;
    costUsd: string;
    avgTokens: number | null;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
  };

  export type LlmTenantRow = {
    tenantId: string;
    calls: number;
    failedCalls: number;
    costUsd: string;
    avgTokens: number | null;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
  };

  export type LlmPromptRow = {
    promptName: string;
    model: string;
    calls: number;
    failedCalls: number;
    costUsd: string;
    avgTokens: number | null;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
  };

  export type LlmCostByModelSeries = {
    model: string;
    costs: string[];
  };

  export type LlmCostByModel = {
    buckets: string[];
    series: LlmCostByModelSeries[];
  };
  ```
- Produces (api/client.ts, on the `ApiClient` type, immediately after the `getIncidentMttr?` line):
  ```ts
  getLlmSummary?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmSummary>>;
  getLlmByTenant?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmTenantRow[]>>;
  getLlmByPrompt?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmPromptRow[]>>;
  getLlmCostByModel?: (query: LlmAggregateQuery) => Promise<AggregateResponse<LlmCostByModel>>;
  ```

- [ ] **Step 1: Add response types to `api/types.ts`**

Insert the `LlmAggregateQuery`, `LlmSummary`, `LlmTenantRow`, `LlmPromptRow`, `LlmCostByModelSeries`, `LlmCostByModel` block (verbatim from Interfaces above) right after the existing `LlmAggregates` type (~line 362, before `OverviewWindow`). `OverviewWindow` is already defined in this file (line 363) — `LlmAggregateQuery` references it.

- [ ] **Step 2: Import the new types in `client.ts`**

Find the existing import from `./types` that brings in `OverviewQuery`, `OverviewResponse`, `IncidentMttrQuery`, etc. Add `LlmAggregateQuery`, `LlmSummary`, `LlmTenantRow`, `LlmPromptRow`, `LlmCostByModel` to that type import list.

- [ ] **Step 3: Add the 4 optional method signatures to the `ApiClient` type**

In `apps/console/src/api/client.ts`, immediately after the `getIncidentMttr?: ...` line (~240), add the 4 signatures from the Interfaces block.

- [ ] **Step 4: Add the path helper**

After `incidentMttrPath` (~line 507), add:
```ts
function llmAggregatePath(suffix: string, query: LlmAggregateQuery): string {
  const params = new URLSearchParams();
  params.set("project_id", query.projectId);
  params.set("environment_id", query.environmentId);
  params.set("window", query.window);

  return `/query/llm/${suffix}?${params.toString()}`;
}
```

- [ ] **Step 5: Add the 4 method implementations**

In the returned client object, immediately after the `getIncidentMttr: ...` implementation (~line 757), add:
```ts
    getLlmSummary: (query) =>
      request<AggregateResponse<LlmSummary>>(path(apiBasePath, llmAggregatePath("summary", query))),
    getLlmByTenant: (query) =>
      request<AggregateResponse<LlmTenantRow[]>>(path(apiBasePath, llmAggregatePath("by-tenant", query))),
    getLlmByPrompt: (query) =>
      request<AggregateResponse<LlmPromptRow[]>>(path(apiBasePath, llmAggregatePath("by-prompt", query))),
    getLlmCostByModel: (query) =>
      request<AggregateResponse<LlmCostByModel>>(path(apiBasePath, llmAggregatePath("cost-by-model", query))),
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @sigmon/console exec tsc --noEmit` (or the repo's console typecheck script — check `apps/console/package.json` for the exact `typecheck`/`build` script; use that).
Expected: PASS (no type errors). The new methods are optional so existing `as unknown as ApiClient` mocks and inline mocks are unaffected.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/api/types.ts apps/console/src/api/client.ts
git commit -m "feat(console): LLM aggregate client methods + types (PER-352 T1)"
```

---

### Task 2: format helpers + `useLlm` hook

**Files:**
- Modify: `apps/console/src/components/ui/v2/format.ts` (add `formatLatency`, `formatUsd`)
- Create: `apps/console/src/v2/screens/useLlm.ts`
- Create: `apps/console/src/v2/screens/useLlm.test.ts`

**Interfaces:**
- Consumes: `ApiClient` (`getLlmSummary?`…`getLlmCostByModel?` from T1), `OverviewWindow`, the 5 response types from T1.
- Produces:
  ```ts
  export type LlmKpis = {
    calls: number; costUsd: number; runRateUsd: number;
    avgLatencyMs: number | null; p95LatencyMs: number | null; errorRate: number;
  };
  export type LlmCostSeriesVM = { model: string; color: string; costs: number[] };
  export type LlmCostByModelVM = { buckets: string[]; series: LlmCostSeriesVM[] };
  export type LlmTenantVM = { tenantId: string; calls: number; costUsd: number; share: number };
  export type LlmPromptVM = {
    promptName: string; model: string; calls: number;
    avgTokens: number | null; avgLatencyMs: number | null; p95LatencyMs: number | null;
    errorRate: number; costUsd: number;
  };
  export type LlmVM = {
    window: OverviewWindow; kpis: LlmKpis;
    costByModel: LlmCostByModelVM; tenants: LlmTenantVM[]; prompts: LlmPromptVM[];
  };
  export type UseLlmResult = { data: LlmVM | null; status: "loading" | "ok" | "error"; reload: () => void };
  export const MODEL_COLORS: string[]; // 5-slot palette
  ```

- [ ] **Step 1: Add format helpers to `format.ts`**

Append to `apps/console/src/components/ui/v2/format.ts`:
```ts
/**
 * Latency formatter for LLM metrics.
 *   null      → "—"
 *   < 1000 ms → whole ms, e.g. "842 ms"
 *   >= 1000ms → one-decimal seconds, e.g. "2.4 s"
 */
export function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** USD formatter: "$ 48.21" (two decimals). */
export function formatUsd(n: number): string {
  return `$ ${n.toFixed(2)}`;
}
```

- [ ] **Step 2: Write the failing hook test**

Create `apps/console/src/v2/screens/useLlm.test.ts`:
```ts
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLlm } from "./useLlm";
import type {
  AggregateResponse,
  LlmCostByModel,
  LlmPromptRow,
  LlmSummary,
  LlmTenantRow,
} from "../../api/types";

afterEach(() => vi.restoreAllMocks());

const summary: LlmSummary = {
  calls: 1000,
  failedCalls: 25,
  costUsd: "48.20",
  avgTokens: 1200,
  avgLatencyMs: 842,
  p95LatencyMs: 2400,
};

const tenants: LlmTenantRow[] = [
  { tenantId: "tenant_acme", calls: 600, failedCalls: 10, costUsd: "30.00",
    avgTokens: 900, avgLatencyMs: 700, p95LatencyMs: 2000 },
  { tenantId: "tenant_globex", calls: 400, failedCalls: 5, costUsd: "18.20",
    avgTokens: 800, avgLatencyMs: 600, p95LatencyMs: 1800 },
];

const prompts: LlmPromptRow[] = [
  { promptName: "dashboard_summary", model: "gpt-5", calls: 500, failedCalls: 5,
    costUsd: "40.00", avgTokens: 1200, avgLatencyMs: 1800, p95LatencyMs: 3200 },
  { promptName: "Unspecified", model: "haiku-4", calls: 500, failedCalls: 0,
    costUsd: "8.20", avgTokens: null, avgLatencyMs: 98, p95LatencyMs: 240 },
];

const costByModel: LlmCostByModel = {
  buckets: ["2026-06-22T00:00:00.000Z", "2026-06-22T01:00:00.000Z"],
  series: [
    { model: "gpt-5", costs: ["10.000000", "12.000000"] },
    { model: "haiku-4", costs: ["0", "2.000000"] },
  ],
};

function makeClient(over: Record<string, unknown> = {}) {
  return {
    getLlmSummary: vi.fn(async (): Promise<AggregateResponse<LlmSummary>> => ({ data: summary })),
    getLlmByTenant: vi.fn(async (): Promise<AggregateResponse<LlmTenantRow[]>> => ({ data: tenants })),
    getLlmByPrompt: vi.fn(async (): Promise<AggregateResponse<LlmPromptRow[]>> => ({ data: prompts })),
    getLlmCostByModel: vi.fn(async (): Promise<AggregateResponse<LlmCostByModel>> => ({ data: costByModel })),
    ...over,
  } as never;
}

describe("useLlm", () => {
  it("assembles the VM: parses costs, derives error rate, run-rate, shares, colors", async () => {
    const { result } = renderHook(() =>
      useLlm({ client: makeClient(), projectId: "p", environmentId: "e", window: "24h" }));

    await waitFor(() => expect(result.current.status).toBe("ok"));
    const vm = result.current.data!;
    expect(vm.kpis.calls).toBe(1000);
    expect(vm.kpis.costUsd).toBeCloseTo(48.2);
    expect(vm.kpis.errorRate).toBeCloseTo(0.025);
    // 24h run-rate = cost * 30
    expect(vm.kpis.runRateUsd).toBeCloseTo(48.2 * 30);
    expect(vm.kpis.avgLatencyMs).toBe(842);

    // tenants: share = cost / summary cost; first color from palette
    expect(vm.tenants[0].costUsd).toBeCloseTo(30);
    expect(vm.tenants[0].share).toBeCloseTo(30 / 48.2);

    // prompts: numeric costs + per-row error rate; null tokens preserved
    expect(vm.prompts[0].costUsd).toBeCloseTo(40);
    expect(vm.prompts[0].errorRate).toBeCloseTo(5 / 500);
    expect(vm.prompts[1].avgTokens).toBeNull();
    expect(vm.prompts[1].errorRate).toBe(0);

    // cost-by-model: strings parsed to numbers incl. zero-fill "0"; colors assigned
    expect(vm.costByModel.series[0].costs).toEqual([10, 12]);
    expect(vm.costByModel.series[1].costs).toEqual([0, 2]);
    expect(vm.costByModel.series[0].color).toBeTruthy();
    expect(vm.costByModel.series[1].color).not.toBe(vm.costByModel.series[0].color);
  });

  it("7d run-rate normalizes to 30 days", async () => {
    const { result } = renderHook(() =>
      useLlm({ client: makeClient(), projectId: "p", environmentId: "e", window: "7d" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.kpis.runRateUsd).toBeCloseTo((48.2 / 7) * 30);
  });

  it("error rate is 0 when there are no calls", async () => {
    const client = makeClient({
      getLlmSummary: vi.fn(async () => ({ data: { ...summary, calls: 0, failedCalls: 0, costUsd: "0" } })),
    });
    const { result } = renderHook(() =>
      useLlm({ client, projectId: "p", environmentId: "e", window: "24h" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.kpis.errorRate).toBe(0);
    // share guarded against divide-by-zero summary cost
    expect(result.current.data!.tenants[0].share).toBe(0);
  });

  it("degrades secondary failures to empty but keeps status ok when summary succeeds", async () => {
    const client = makeClient({
      getLlmByTenant: vi.fn(async () => { throw new Error("boom"); }),
      getLlmCostByModel: vi.fn(async () => { throw new Error("boom"); }),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useLlm({ client, projectId: "p", environmentId: "e", window: "24h" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data!.tenants).toEqual([]);
    expect(result.current.data!.costByModel.series).toEqual([]);
    expect(result.current.data!.prompts.length).toBe(2);
    errSpy.mockRestore();
  });

  it("sets error status when the summary fetch fails", async () => {
    const client = makeClient({
      getLlmSummary: vi.fn(async () => { throw new Error("boom"); }),
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useLlm({ client, projectId: "p", environmentId: "e", window: "24h" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    errSpy.mockRestore();
  });

  it("sets error status when getLlmSummary is unavailable on the client", async () => {
    const client = makeClient({ getLlmSummary: undefined });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useLlm({ client, projectId: "p", environmentId: "e", window: "24h" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    errSpy.mockRestore();
  });

  it("does nothing without project/environment scope", () => {
    const client = makeClient();
    renderHook(() => useLlm({ client, projectId: undefined, environmentId: undefined, window: "24h" }));
    expect((client as never as { getLlmSummary: { mock: { calls: unknown[] } } }).getLlmSummary.mock.calls.length).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/useLlm.test.ts`
Expected: FAIL (`useLlm` not defined). If run from repo root, use the repo's test runner with the path glob.

- [ ] **Step 4: Implement `useLlm`**

Create `apps/console/src/v2/screens/useLlm.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  LlmCostByModel,
  LlmPromptRow,
  LlmSummary,
  LlmTenantRow,
  OverviewWindow,
} from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type LlmKpis = {
  calls: number;
  costUsd: number;
  runRateUsd: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  errorRate: number; // 0..1
};

export type LlmCostSeriesVM = { model: string; color: string; costs: number[] };
export type LlmCostByModelVM = { buckets: string[]; series: LlmCostSeriesVM[] };

export type LlmTenantVM = {
  tenantId: string;
  calls: number;
  costUsd: number;
  share: number; // 0..1
};

export type LlmPromptVM = {
  promptName: string;
  model: string;
  calls: number;
  avgTokens: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  errorRate: number; // 0..1
  costUsd: number;
};

export type LlmVM = {
  window: OverviewWindow;
  kpis: LlmKpis;
  costByModel: LlmCostByModelVM;
  tenants: LlmTenantVM[];
  prompts: LlmPromptVM[];
};

export type UseLlmResult = {
  data: LlmVM | null;
  status: "loading" | "ok" | "error";
  reload: () => void;
};

// ---------------------------------------------------------------------------
// Hook args
// ---------------------------------------------------------------------------

type UseLlmArgs = {
  client: {
    getLlmSummary?: ApiClient["getLlmSummary"];
    getLlmByTenant?: ApiClient["getLlmByTenant"];
    getLlmByPrompt?: ApiClient["getLlmByPrompt"];
    getLlmCostByModel?: ApiClient["getLlmCostByModel"];
  };
  projectId: string | undefined;
  environmentId: string | undefined;
  window: OverviewWindow;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fixed palette assigned by series index (cost-by-model + legend share this). */
export const MODEL_COLORS = [
  "var(--sev-violet)",
  "var(--accent)",
  "var(--sev-info)",
  "var(--sev-warning)",
  "var(--sev-critical)",
];

function toNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function errorRate(failed: number, calls: number): number {
  return calls > 0 ? failed / calls : 0;
}

/** Project a window's total cost to a 30-day run-rate. */
function monthlyRunRate(windowCost: number, window: OverviewWindow): number {
  if (window === "24h") return windowCost * 30;
  if (window === "7d") return (windowCost / 7) * 30;
  return windowCost; // 30d
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLlm({ client, projectId, environmentId, window }: UseLlmArgs): UseLlmResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [data, setData] = useState<LlmVM | null>(null);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId) return;

    const gen = ++genRef.current;
    setStatus("loading");

    const scope = { projectId, environmentId, window };

    const summaryFetch = client.getLlmSummary
      ? client.getLlmSummary(scope)
      : Promise.reject(new Error("getLlmSummary unavailable"));
    const tenantFetch = client.getLlmByTenant
      ? client.getLlmByTenant(scope).catch((e) => { console.error(e); return null; })
      : Promise.resolve(null);
    const promptFetch = client.getLlmByPrompt
      ? client.getLlmByPrompt(scope).catch((e) => { console.error(e); return null; })
      : Promise.resolve(null);
    const costFetch = client.getLlmCostByModel
      ? client.getLlmCostByModel(scope).catch((e) => { console.error(e); return null; })
      : Promise.resolve(null);

    Promise.all([summaryFetch, tenantFetch, promptFetch, costFetch])
      .then(([summaryRes, tenantRes, promptRes, costRes]) => {
        if (gen !== genRef.current) return;

        const summary: LlmSummary = summaryRes.data;
        const summaryCost = toNum(summary.costUsd);

        const kpis: LlmKpis = {
          calls: summary.calls,
          costUsd: summaryCost,
          runRateUsd: monthlyRunRate(summaryCost, window),
          avgLatencyMs: summary.avgLatencyMs,
          p95LatencyMs: summary.p95LatencyMs,
          errorRate: errorRate(summary.failedCalls, summary.calls),
        };

        const tenantRows: LlmTenantRow[] = tenantRes?.data ?? [];
        const tenants: LlmTenantVM[] = tenantRows.map((r) => {
          const cost = toNum(r.costUsd);
          return {
            tenantId: r.tenantId,
            calls: r.calls,
            costUsd: cost,
            share: summaryCost > 0 ? cost / summaryCost : 0,
          };
        });

        const promptRows: LlmPromptRow[] = promptRes?.data ?? [];
        const prompts: LlmPromptVM[] = promptRows.map((r) => ({
          promptName: r.promptName,
          model: r.model,
          calls: r.calls,
          avgTokens: r.avgTokens,
          avgLatencyMs: r.avgLatencyMs,
          p95LatencyMs: r.p95LatencyMs,
          errorRate: errorRate(r.failedCalls, r.calls),
          costUsd: toNum(r.costUsd),
        }));

        const cost: LlmCostByModel = costRes?.data ?? { buckets: [], series: [] };
        const costByModel: LlmCostByModelVM = {
          buckets: cost.buckets,
          series: cost.series.map((s, i) => ({
            model: s.model,
            color: MODEL_COLORS[i % MODEL_COLORS.length],
            costs: s.costs.map(toNum),
          })),
        };

        setData({ window, kpis, costByModel, tenants, prompts });
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
  }, [projectId, environmentId, window, tick]);

  return { data, status, reload };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/useLlm.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/components/ui/v2/format.ts apps/console/src/v2/screens/useLlm.ts apps/console/src/v2/screens/useLlm.test.ts
git commit -m "feat(console): useLlm hook + latency/usd formatters (PER-352 T2)"
```

---

### Task 3: `StackedArea` chart component

**Files:**
- Modify: `apps/console/src/components/ui/v2/charts.tsx` (append `StackedArea`)
- Create: `apps/console/src/components/ui/v2/charts.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function StackedArea(props: {
    buckets: string[];
    series: Array<{ model: string; color: string; costs: number[] }>;
    height?: number;
  }): JSX.Element | null;
  ```
- Returns `null` when `buckets` is empty or `series` is empty (caller renders an empty hint).

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/components/ui/v2/charts.test.tsx`:
```tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StackedArea } from "./charts";

afterEach(cleanup);

describe("StackedArea", () => {
  it("renders one filled path per series plus baseline gridlines", () => {
    const { container } = render(
      <StackedArea
        buckets={["a", "b", "c"]}
        series={[
          { model: "gpt-5", color: "var(--sev-violet)", costs: [1, 2, 3] },
          { model: "haiku-4", color: "var(--accent)", costs: [0, 1, 2] },
        ]}
      />
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelectorAll("path").length).toBe(2);
    expect(container.querySelectorAll("line").length).toBe(5);
  });

  it("returns null for empty series", () => {
    const { container } = render(<StackedArea buckets={[]} series={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("does not crash on a single bucket", () => {
    const { container } = render(
      <StackedArea buckets={["a"]} series={[{ model: "m", color: "red", costs: [5] }]} />
    );
    expect(container.querySelectorAll("path").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console exec vitest run src/components/ui/v2/charts.test.tsx`
Expected: FAIL (`StackedArea` not exported).

- [ ] **Step 3: Implement `StackedArea`**

Append to `apps/console/src/components/ui/v2/charts.tsx`:
```tsx
export function StackedArea({
  buckets,
  series,
  height = 200,
}: {
  buckets: string[];
  series: Array<{ model: string; color: string; costs: number[] }>;
  height?: number;
}) {
  const points = buckets.length;
  if (points === 0 || series.length === 0) return null;

  // cumulative stack per bucket: stacked[i][k] = sum of series[0..k].costs[i]
  const stacked: number[][] = [];
  for (let i = 0; i < points; i++) {
    let acc = 0;
    stacked.push(
      series.map((s) => {
        acc += s.costs[i] ?? 0;
        return acc;
      })
    );
  }
  const maxY = Math.max(...stacked.flat(), 0) * 1.1 || 1;
  const w = 600;
  const h = height;
  const xs = stacked.map((_, i) => (points === 1 ? w / 2 : (i / (points - 1)) * w));

  const paths = series.map((s, idx) => {
    const top = stacked.map((col, i) => [xs[i], h - (col[idx] / maxY) * h] as const);
    const bottom =
      idx === 0
        ? xs.map((x) => [x, h] as const)
        : stacked.map((col, i) => [xs[i], h - (col[idx - 1] / maxY) * h] as const);
    const d = [
      ...top.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`),
      ...bottom
        .slice()
        .reverse()
        .map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`),
      "Z",
    ].join(" ");
    return { d, color: s.color };
  });

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block" }}
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={i}
          x1={0}
          x2={w}
          y1={(h / 4) * i}
          y2={(h / 4) * i}
          stroke="var(--border-subtle)"
          strokeDasharray="2 4"
        />
      ))}
      {paths
        .slice()
        .reverse()
        .map((p, i) => (
          <path key={i} d={p.d} fill={p.color} opacity={0.85 - i * 0.05} />
        ))}
    </svg>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console exec vitest run src/components/ui/v2/charts.test.tsx`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/components/ui/v2/charts.tsx apps/console/src/components/ui/v2/charts.test.tsx
git commit -m "feat(console): StackedArea cost-by-model chart (PER-352 T3)"
```

---

### Task 4: `LlmScreen` component

**Files:**
- Create: `apps/console/src/v2/screens/LlmScreen.tsx`
- Create: `apps/console/src/v2/screens/LlmScreen.test.tsx`

**Interfaces:**
- Consumes: `ScreenCtx` (registry), `useLlm` + VM types (T2), `StackedArea` (T3), `BigKpi`/`PageHead`/`Legend`/`Segmented`/`EmptyHint`/`Icon`/`formatCompact`/`formatLatency`/`formatUsd` from `../../components/ui/v2`, `OverviewWindow`, `MODEL_COLORS` (not needed — colors live on VM series).
- Produces: `export function LlmScreen({ ctx }: { ctx: ScreenCtx }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/v2/screens/LlmScreen.test.tsx`:
```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../api/types";
import { LlmScreen } from "./LlmScreen";
import type { ScreenCtx } from "./registry";
import * as useLlmModule from "./useLlm";
import type { LlmVM } from "./useLlm";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project = { id: "p", name: "Demo" } as Project;
const environment = { id: "e", name: "production" } as Environment;

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: {} as never,
    project,
    environment,
    environments: [environment],
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

const vm: LlmVM = {
  window: "24h",
  kpis: {
    calls: 184210,
    costUsd: 142.18,
    runRateUsd: 4265.4,
    avgLatencyMs: 842,
    p95LatencyMs: 2400,
    errorRate: 0.0042,
  },
  costByModel: {
    buckets: ["2026-06-22T00:00:00.000Z", "2026-06-22T01:00:00.000Z"],
    series: [
      { model: "gpt-5", color: "var(--sev-violet)", costs: [10, 12] },
      { model: "haiku-4", color: "var(--accent)", costs: [0, 2] },
    ],
  },
  tenants: [
    { tenantId: "tenant_acme", calls: 32014, costUsd: 68.42, share: 0.48 },
    { tenantId: "tenant_globex", calls: 11248, costUsd: 18.94, share: 0.13 },
  ],
  prompts: [
    { promptName: "dashboard_summary", model: "gpt-5", calls: 12842, avgTokens: 1200,
      avgLatencyMs: 1800, p95LatencyMs: 3200, errorRate: 0.006, costUsd: 48.21 },
    { promptName: "embedding_doc", model: "text-embed-3", calls: 8104, avgTokens: null,
      avgLatencyMs: 84, p95LatencyMs: 180, errorRate: 0, costUsd: 4.21 },
  ],
};

function mockUseLlm(data: LlmVM | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useLlmModule, "useLlm").mockReturnValue({ data, status, reload: vi.fn() });
}

describe("LlmScreen", () => {
  it("shows a guard hint when project/env are missing", () => {
    mockUseLlm(null, "loading");
    render(<LlmScreen ctx={makeCtx({ project: undefined, environment: undefined })} />);
    expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    mockUseLlm(null, "loading");
    const { rerender } = render(<LlmScreen ctx={makeCtx()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mockUseLlm(null, "error");
    rerender(<LlmScreen ctx={makeCtx()} />);
    expect(screen.getByText(/could not load/i)).toBeInTheDocument();
  });

  it("renders the page head with title and window selector", () => {
    mockUseLlm(vm);
    render(<LlmScreen ctx={makeCtx()} />);
    expect(screen.getByText("LLM observability")).toBeInTheDocument();
    expect(screen.getByText("24h")).toBeInTheDocument();
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
  });

  it("renders the 5 KPI tiles with derived values", () => {
    mockUseLlm(vm);
    render(<LlmScreen ctx={makeCtx()} />);
    expect(screen.getByText("Calls")).toBeInTheDocument();
    expect(screen.getByText("184K")).toBeInTheDocument(); // formatCompact
    expect(screen.getByText("Cost (24h)")).toBeInTheDocument();
    expect(screen.getByText("$ 142.18")).toBeInTheDocument();
    expect(screen.getByText(/run-rate/i)).toBeInTheDocument();
    expect(screen.getByText("Avg latency")).toBeInTheDocument();
    expect(screen.getByText("842 ms")).toBeInTheDocument();
    expect(screen.getByText("p95 latency")).toBeInTheDocument();
    expect(screen.getByText("2.4 s")).toBeInTheDocument();
    expect(screen.getByText("Error rate")).toBeInTheDocument();
    expect(screen.getByText("0.42%")).toBeInTheDocument();
  });

  it("renders the cost-by-model card with a legend per series", () => {
    mockUseLlm(vm);
    const { container } = render(<LlmScreen ctx={makeCtx()} />);
    expect(screen.getByText(/cost by model/i)).toBeInTheDocument();
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.getByText("haiku-4")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders top tenants with cost, share, and a drill stub toast", async () => {
    mockUseLlm(vm);
    const ctx = makeCtx();
    render(<LlmScreen ctx={ctx} />);
    expect(screen.getByText(/top tenants/i)).toBeInTheDocument();
    expect(screen.getByText("tenant_acme")).toBeInTheDocument();
    expect(screen.getByText("$ 68.42")).toBeInTheDocument();
    expect(screen.getByText("48.0%")).toBeInTheDocument();
    await userEvent.click(screen.getByText("tenant_acme"));
    expect(ctx.pushToast).toHaveBeenCalledWith("Tenant detail is not yet available");
  });

  it("renders the prompts ranking table", () => {
    mockUseLlm(vm);
    render(<LlmScreen ctx={makeCtx()} />);
    expect(screen.getByText(/ranked by cost/i)).toBeInTheDocument();
    expect(screen.getByText("dashboard_summary")).toBeInTheDocument();
    expect(screen.getByText("embedding_doc")).toBeInTheDocument();
    // null tokens render as em-dash
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("Export CSV is a stub toast", async () => {
    mockUseLlm(vm);
    const ctx = makeCtx();
    render(<LlmScreen ctx={ctx} />);
    await userEvent.click(screen.getByText("Export CSV"));
    expect(ctx.pushToast).toHaveBeenCalledWith("CSV export is not yet available");
  });

  it("shows empty hints when sections have no data", () => {
    mockUseLlm({ ...vm, tenants: [], costByModel: { buckets: [], series: [] } });
    render(<LlmScreen ctx={makeCtx()} />);
    expect(screen.getByText(/no llm cost data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/LlmScreen.test.tsx`
Expected: FAIL (`LlmScreen` not defined).

- [ ] **Step 3: Implement `LlmScreen`**

Create `apps/console/src/v2/screens/LlmScreen.tsx`:
```tsx
import { useState } from "react";
import type { OverviewWindow } from "../../api/types";
import {
  BigKpi,
  EmptyHint,
  formatCompact,
  formatLatency,
  formatUsd,
  Icon,
  Legend,
  PageHead,
  Segmented,
  StackedArea,
} from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useLlm } from "./useLlm";
import type { LlmPromptVM, LlmTenantVM } from "./useLlm";

const WINDOW_OPTIONS: OverviewWindow[] = ["24h", "7d", "30d"];

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function formatRunRate(usd: number): string {
  return `≈ $ ${Math.round(usd).toLocaleString("en-US")} / mo run-rate`;
}

function promptErrorColor(rate: number): string {
  const pct = rate * 100;
  if (pct > 1) return "var(--sev-critical)";
  if (pct > 0.4) return "var(--sev-warning)";
  return "var(--fg-muted)";
}

const PROMPT_GRID = "1.6fr 100px 90px 100px 90px 90px 80px 28px";

function TenantRow({ row, ctx }: { row: LlmTenantVM; ctx: ScreenCtx }) {
  return (
    <button
      className="sh-row sh-row--btn"
      style={{
        gridTemplateColumns: "1.4fr 80px 70px 1fr",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--border-subtle)",
        cursor: "pointer",
      }}
      onClick={() => ctx.pushToast("Tenant detail is not yet available")}
    >
      <div>
        <strong style={{ fontSize: 12.5 }}>{row.tenantId}</strong>
        <div className="sh-faint sh-mono" style={{ fontSize: 11 }}>
          {formatCompact(row.calls)} calls
        </div>
      </div>
      <span style={{ fontWeight: 600, color: "var(--sev-violet)", fontVariantNumeric: "tabular-nums" }}>
        {formatUsd(row.costUsd)}
      </span>
      <span className="sh-muted" style={{ fontSize: 11 }}>
        {(row.share * 100).toFixed(1)}%
      </span>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "var(--bg-canvas)",
          overflow: "hidden",
          alignSelf: "center",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(row.share * 100, 100)}%`,
            background: "var(--sev-violet)",
            borderRadius: 3,
          }}
        />
      </div>
    </button>
  );
}

function PromptRow({ row }: { row: LlmPromptVM }) {
  return (
    <div className="sh-row" style={{ gridTemplateColumns: PROMPT_GRID }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{row.promptName}</div>
        <div className="sh-faint sh-mono" style={{ fontSize: 11 }}>
          {row.model}
        </div>
      </div>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCompact(row.calls)}</span>
      <span className="sh-mono sh-muted" style={{ fontSize: 11.5 }}>
        {row.avgTokens == null ? "—" : formatCompact(row.avgTokens)}
      </span>
      <span className="sh-mono sh-muted" style={{ fontSize: 11.5 }}>
        {formatLatency(row.avgLatencyMs)}
      </span>
      <span style={{ color: promptErrorColor(row.errorRate), fontVariantNumeric: "tabular-nums" }}>
        {(row.errorRate * 100).toFixed(1)}%
      </span>
      <span style={{ fontWeight: 600, color: "var(--sev-violet)", fontVariantNumeric: "tabular-nums" }}>
        {formatUsd(row.costUsd)}
      </span>
      <span className="sh-mono sh-muted" style={{ fontSize: 11.5 }}>
        {formatLatency(row.p95LatencyMs)}
      </span>
      <Icon name="chev" size={13} style={{ color: "var(--fg-faint)" }} />
    </div>
  );
}

export function LlmScreen({ ctx }: { ctx: ScreenCtx }) {
  const [window, setWindow] = useState<OverviewWindow>("24h");
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;

  const { data, status } = useLlm({ client: ctx.client, projectId, environmentId, window });

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="activity"
          title="No project selected"
          sub="Select a project and environment to view LLM observability."
        />
      </div>
    );
  }

  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="activity" title="Loading…" sub="Fetching LLM aggregates." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="alert"
          title="Could not load LLM observability"
          sub="Check your connection or try again."
        />
      </div>
    );
  }

  const { kpis, costByModel, tenants, prompts } = data;

  return (
    <>
      <PageHead
        title="LLM observability"
        sub="Cost, latency, quality, and attribution by tenant, prompt, and model."
        actions={
          <>
            <Segmented
              options={WINDOW_OPTIONS}
              value={window}
              onChange={(v) => setWindow(v as OverviewWindow)}
            />
            <button
              className="sh-btn primary"
              onClick={() => ctx.pushToast("CSV export is not yet available")}
            >
              <Icon name="download" size={14} />
              Export CSV
            </button>
          </>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <BigKpi label="Calls" value={formatCompact(kpis.calls)} color="var(--sev-violet)" />
        <BigKpi
          label={`Cost (${window})`}
          value={formatUsd(kpis.costUsd)}
          sub={formatRunRate(kpis.runRateUsd)}
          color="var(--accent)"
        />
        <BigKpi label="Avg latency" value={formatLatency(kpis.avgLatencyMs)} color="var(--sev-info)" />
        <BigKpi label="p95 latency" value={formatLatency(kpis.p95LatencyMs)} color="var(--sev-warning)" />
        <BigKpi label="Error rate" value={formatPct(kpis.errorRate)} color="var(--sev-critical)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">Cost by model — {window}</h2>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {costByModel.series.map((s) => (
                <Legend key={s.model} color={s.color} label={s.model} />
              ))}
            </div>
          </div>
          <div className="sh-card__body">
            {costByModel.series.length === 0 ? (
              <EmptyHint icon="activity" title="No LLM cost data" sub="No model cost in this window." />
            ) : (
              <StackedArea buckets={costByModel.buckets} series={costByModel.series} />
            )}
          </div>
        </div>

        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">Top tenants — cost</h2>
            <span className="sh-faint" style={{ fontSize: 11 }}>
              {window}
            </span>
          </div>
          <div className="sh-card__body flush">
            {tenants.length === 0 ? (
              <EmptyHint icon="activity" title="No tenant cost" sub="No attributed tenant cost in this window." />
            ) : (
              tenants.map((row) => <TenantRow key={row.tenantId} row={row} ctx={ctx} />)
            )}
          </div>
        </div>
      </div>

      <div
        className="sh-card"
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <div className="sh-card__head">
          <h2 className="sh-h2">Prompts — ranked by cost</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <span className="sh-tag">{prompts.length} prompts</span>
            <span className="sh-tag mono">sorted by cost</span>
          </div>
        </div>
        <div className="sh-row sh-row__head" style={{ gridTemplateColumns: PROMPT_GRID }}>
          <span>Prompt · model</span>
          <span>Calls</span>
          <span>Avg tokens</span>
          <span>Avg latency</span>
          <span>Error rate</span>
          <span>Cost</span>
          <span>p95</span>
          <span />
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {prompts.length === 0 ? (
            <EmptyHint icon="activity" title="No prompt data" sub="No LLM calls in this window." />
          ) : (
            prompts.map((row) => <PromptRow key={`${row.promptName}:${row.model}`} row={row} />)
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/LlmScreen.test.tsx`
Expected: PASS. If `Icon` has no `chev` name, use the closest existing chevron icon name (verify against `apps/console/src/components/ui/v2/icon.tsx` `IconName`); if absent, use `arrow`. Adjust the component and note it.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/v2/screens/LlmScreen.tsx apps/console/src/v2/screens/LlmScreen.test.tsx
git commit -m "feat(console): v2 LLM observability screen (PER-352 T4)"
```

---

### Task 5: Registry flip + verification

**Files:**
- Modify: `apps/console/src/v2/screens/registry.tsx` (flip `llm` to v2)
- Modify: `apps/console/src/v2/screens/registry.test.tsx` (assert llm is v2 + renders LlmScreen)

**Interfaces:**
- Consumes: `LlmScreen` (T4).

- [ ] **Step 1: Add the import + flip the entry**

In `apps/console/src/v2/screens/registry.tsx`:
- Add `import { LlmScreen } from "./LlmScreen";` next to the other screen imports (after `IncidentsScreen`).
- Replace the `llm:` entry (lines 62–72) with:
  ```tsx
  llm: {
    kind: "v2",
    render: (ctx) => <LlmScreen ctx={ctx} />,
  },
  ```
- Leave `traces`/`alerts`/`system`/`settings` legacy and keep the `InvestigationWorkspace` import (traces still uses it).

- [ ] **Step 2: Update `registry.test.tsx`**

Add `import * as useLlmModule from "./useLlm";` near the other hook-module imports. Add two tests mirroring the incidents ones:
```tsx
  it("llm entry has kind === 'v2'", () => {
    expect(SCREENS.llm.kind).toBe("v2");
  });

  it("renderSection('llm') renders LlmScreen NOT inside .console-legacy-island", () => {
    vi.spyOn(useLlmModule, "useLlm").mockReturnValue({
      data: null,
      status: "loading",
      reload: vi.fn(),
    });
    const ctx = makeCtx();
    const { container } = render(<>{renderSection("llm", ctx)}</>);
    expect(container.querySelector(".console-legacy-island")).toBeNull();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    vi.restoreAllMocks();
  });
```
The "wraps legacy entries" test already targets `settings`, so it stays valid.

- [ ] **Step 3: Run the registry tests**

Run: `pnpm --filter @sigmon/console exec vitest run src/v2/screens/registry.test.tsx`
Expected: PASS.

- [ ] **Step 4: Full console + repo verification**

Run, expecting all green (exit 0):
```bash
pnpm --filter @sigmon/console test
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config
```
(Use `rtk proxy` if you need to read full output.) If any pre-existing test references the legacy LLM section as a v2/legacy expectation, fix the assertion to match the flip.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/v2/screens/registry.tsx apps/console/src/v2/screens/registry.test.tsx
git commit -m "feat(console): flip llm section to v2 LlmScreen (PER-352 T5)"
```

---

## Self-Review

- **Spec coverage:** page head (window + Export CSV) ✓ T4; 5 BigKpi ✓ T4; stacked-area + legend ✓ T3/T4; top-tenants share bars + drill stub ✓ T4; prompts table ✓ T4; B2 wiring ✓ T1/T2.
- **Type consistency:** `LlmVM`/`LlmKpis`/`LlmTenantVM`/`LlmPromptVM`/`LlmCostByModelVM` defined in T2, consumed verbatim in T4. `LlmAggregateQuery` + response types defined T1, consumed T2. `MODEL_COLORS` (T2) carried onto VM series → screen reads `series[].color` (single source). `StackedArea` prop shape (T3) matches `LlmCostByModelVM.series` element shape.
- **Degrade paths:** summary fail → error; secondary fail → empty section + EmptyHint; null latency/tokens → "—"; calls 0 → 0% / 0 share.
- **Icon name risk:** flagged in T4 Step 4 (verify `chev`/`download` exist in `IconName`).

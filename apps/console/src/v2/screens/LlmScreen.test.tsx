// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
    // "24h" appears in the Segmented selector AND in the Top-tenants window badge
    expect(screen.getAllByText("24h").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
  });

  it("renders the 5 KPI tiles with derived values", () => {
    mockUseLlm(vm);
    render(<LlmScreen ctx={makeCtx()} />);
    // "Calls", "Avg latency", "Error rate" appear in both KPI tiles and prompt-table column headers
    expect(screen.getAllByText("Calls").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("184K")).toBeInTheDocument(); // formatCompact
    expect(screen.getByText("Cost (24h)")).toBeInTheDocument();
    expect(screen.getByText("$ 142.18")).toBeInTheDocument();
    expect(screen.getByText(/run-rate/i)).toBeInTheDocument();
    expect(screen.getAllByText("Avg latency").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("842 ms")).toBeInTheDocument();
    expect(screen.getByText("p95 latency")).toBeInTheDocument();
    expect(screen.getByText("2.4 s")).toBeInTheDocument();
    expect(screen.getAllByText("Error rate").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("0.42%")).toBeInTheDocument();
  });

  it("renders the cost-by-model card with a legend per series", () => {
    mockUseLlm(vm);
    const { container } = render(<LlmScreen ctx={makeCtx()} />);
    expect(screen.getByText(/cost by model/i)).toBeInTheDocument();
    // model names appear in the Legend AND in PromptRow sub-lines
    expect(screen.getAllByText("gpt-5").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("haiku-4").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders top tenants with cost, share, and drills into the tenant", async () => {
    mockUseLlm(vm);
    const ctx = makeCtx();
    render(<LlmScreen ctx={ctx} />);
    expect(screen.getByText(/top tenants/i)).toBeInTheDocument();
    expect(screen.getByText("tenant_acme")).toBeInTheDocument();
    expect(screen.getByText("$ 68.42")).toBeInTheDocument();
    expect(screen.getByText("48.0%")).toBeInTheDocument();
    await userEvent.click(screen.getByText("tenant_acme"));
    expect(ctx.drill).toHaveBeenCalledWith("tenant", { tenantId: "tenant_acme" });
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

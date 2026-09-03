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
    // "active" also appears in the "Active users" KPI label → assert ≥1 (same pattern as Events/Errors/Traces).
    expect(screen.getAllByText(/active/i).length).toBeGreaterThanOrEqual(1);
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

  it("removes unavailable tenant actions while preserving Back", async () => {
    mock(RESPONSE);
    const ctx = makeCtx();
    render(<TenantScreen ctx={ctx} tenantId="tenant_acme" />);
    expect(screen.queryByRole("button", { name: /watch tenant/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open in crm/i })).not.toBeInTheDocument();
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

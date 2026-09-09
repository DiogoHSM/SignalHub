// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../api/types";
import { TenantsScreen } from "./TenantsScreen";
import type { ScreenCtx } from "./registry";
import * as useTenantsModule from "./useTenants";
import type { TenantsVM } from "./useTenants";

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

const vm: TenantsVM = {
  window: "24h",
  hasMore: false,
  rows: [
    {
      key: "tenant_acme",
      tenantId: "tenant_acme",
      label: "Acme Inc",
      isUnassigned: false,
      keyTraits: [{ key: "plan", value: "enterprise" }],
      impactScore: 90,
      events: 32000,
      errors: 12,
      llmCalls: 500,
      llmCostUsd: 68.42,
      activeUsers: 240,
      lastSeenAt: "2026-07-24T10:00:00.000Z",
      lastSeen: "1h ago",
    },
    {
      key: "_unassigned",
      tenantId: null,
      label: "Unassigned",
      isUnassigned: true,
      keyTraits: [],
      impactScore: 5,
      events: 100,
      errors: 0,
      llmCalls: 0,
      llmCostUsd: 0,
      activeUsers: 3,
      lastSeenAt: null,
      lastSeen: "—",
    },
  ],
};

function mockUseTenants(data: TenantsVM | null, status: "loading" | "ok" | "error" = "ok", over: Partial<useTenantsModule.UseTenantsResult> = {}) {
  vi.spyOn(useTenantsModule, "useTenants").mockReturnValue({
    data,
    status,
    reload: vi.fn(),
    loadMore: vi.fn(),
    loadingMore: false,
    ...over,
  });
}

describe("TenantsScreen", () => {
  it("shows a guard hint when project/env are missing", () => {
    mockUseTenants(null, "loading");
    render(<TenantsScreen ctx={makeCtx({ project: undefined, environment: undefined })} />);
    expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    mockUseTenants(null, "loading");
    const { rerender } = render(<TenantsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mockUseTenants(null, "error");
    rerender(<TenantsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/could not load/i)).toBeInTheDocument();
  });

  it("renders the page head as the first node with a window selector", () => {
    mockUseTenants(vm);
    const { container } = render(<TenantsScreen ctx={makeCtx()} />);
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    expect(container.firstElementChild?.querySelector("h1")?.textContent).toBe("Accounts");
    expect(screen.getAllByText("24h").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
  });

  it("renders tenant rows with metrics and drills into an assigned tenant", async () => {
    mockUseTenants(vm);
    const ctx = makeCtx();
    render(<TenantsScreen ctx={ctx} />);
    expect(screen.getByText("Acme Inc")).toBeInTheDocument();
    expect(screen.getByText("$ 68.42")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Acme Inc"));
    expect(ctx.drill).toHaveBeenCalledWith("tenant", { tenantId: "tenant_acme" });
  });

  it("does not drill for the unassigned bucket row", async () => {
    mockUseTenants(vm);
    const ctx = makeCtx();
    render(<TenantsScreen ctx={ctx} />);
    const unassignedRow = screen.getByText("Unassigned").closest("button")!;
    expect(unassignedRow).toBeDisabled();
    await userEvent.click(unassignedRow);
    expect(ctx.drill).not.toHaveBeenCalled();
  });

  it("changes sort on click", async () => {
    mockUseTenants(vm);
    render(<TenantsScreen ctx={makeCtx()} />);
    const usageBtn = screen.getByText("Usage");
    expect(usageBtn).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(usageBtn);
    expect(usageBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("applies search draft on Search click", async () => {
    mockUseTenants(vm);
    render(<TenantsScreen ctx={makeCtx()} />);
    const input = screen.getByLabelText("Search tenants");
    await userEvent.type(input, "acme");
    await userEvent.click(screen.getByText("Search"));
    expect(useTenantsModule.useTenants).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "acme" })
    );
  });

  it("shows empty hint when there are no rows", () => {
    mockUseTenants({ ...vm, rows: [] });
    render(<TenantsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/no tenant activity/i)).toBeInTheDocument();
  });

  it("shows Load more when hasMore is true and wires loadMore", async () => {
    const loadMore = vi.fn();
    mockUseTenants({ ...vm, hasMore: true }, "ok", { loadMore });
    render(<TenantsScreen ctx={makeCtx()} />);
    const btn = screen.getByText("Load more");
    await userEvent.click(btn);
    expect(loadMore).toHaveBeenCalled();
  });

  it("shows Loading more… and disables the button while loadingMore", () => {
    mockUseTenants({ ...vm, hasMore: true }, "ok", { loadingMore: true });
    render(<TenantsScreen ctx={makeCtx()} />);
    expect(screen.getByText("Loading more…")).toBeDisabled();
  });
});

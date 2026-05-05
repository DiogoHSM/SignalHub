import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { InvestigationWorkspace } from "./InvestigationWorkspace";

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ data: [] }),
    listErrors: vi.fn(),
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [] } }),
    getEntityTenantDetail: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

afterEach(() => {
  cleanup();
});

describe("InvestigationWorkspace", () => {
  it("requires a project and environment", () => {
    render(<InvestigationWorkspace client={client({})} />);

    expect(screen.getByText("Select a project and environment in Setup to investigate telemetry.")).toBeInTheDocument();
  });

  it("renders the events investigation view when scope exists", async () => {
    render(<InvestigationWorkspace client={client({})} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByText("No events found")).toBeInTheDocument();
  });

  it("switches between events errors traces and llm investigation views", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] }),
      listErrors: vi.fn().mockResolvedValue({ data: [] }),
      listTraces: vi.fn().mockResolvedValue({ data: [] }),
      listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
      listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
      getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } })
    });

    render(<InvestigationWorkspace client={api} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Traces" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "LLM" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Entities" })).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByText("No events found")).toBeInTheDocument();
    expect(api.listLlmCalls).not.toHaveBeenCalled();
    expect(api.getLlmAggregates).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "LLM" }));

    expect(screen.getByRole("button", { name: "Events" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "LLM" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("No LLM calls found")).toBeInTheDocument();
    expect(api.listLlmCalls).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
    expect(api.getLlmAggregates).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("shows the entities tab and loads it lazily", async () => {
    const listEntityTenants = vi.fn().mockResolvedValue({ data: { tenants: [] } });
    const api = client({ listEntityTenants });

    render(<InvestigationWorkspace client={api} environmentId="env_1" projectId="prj_1" />);

    expect(screen.getByRole("button", { name: "Entities" })).toHaveAttribute("aria-pressed", "false");
    expect(listEntityTenants).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Entities" }));

    expect(await screen.findByText("No tenant activity in this window.")).toBeInTheDocument();
    expect(listEntityTenants).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", window: "7d", limit: 50 });
  });

  it("opens the requested investigation tab with initial filters", async () => {
    const listErrors = vi.fn().mockResolvedValue({ data: [] });
    const api = client({
      listErrors
    });

    render(
      <InvestigationWorkspace
        client={api}
        environmentId="env_1"
        initialFilters={{ errors: { severity: "critical" } }}
        initialTab="errors"
        projectId="prj_1"
      />
    );

    expect(screen.getByRole("button", { name: "Errors" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("No errors found")).toBeInTheDocument();
    expect(screen.getByLabelText("Severity")).toHaveValue("critical");
    expect(listErrors).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      severity: "critical",
      limit: 50
    });
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { ConnectionCheck } from "./ConnectionCheck";

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn().mockResolvedValue({ projects: [] }),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn().mockResolvedValue({ environments: [] }),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [] }),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ data: [] }),
    listErrors: vi.fn().mockResolvedValue({ data: [] }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    listUsers: vi.fn().mockResolvedValue({ users: [] }),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

afterEach(() => {
  cleanup();
});

describe("ConnectionCheck", () => {
  it("shows connected when listEvents returns data", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [{ id: "evt_1" }] })
    });

    render(<ConnectionCheck client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Telemetry received")).toBeInTheDocument();
    expect(api.listEvents).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
    expect(api.listErrors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
  });

  it("shows empty when listEvents and listErrors return empty arrays", async () => {
    const api = client({});

    render(<ConnectionCheck client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("No telemetry yet")).toBeInTheDocument();
  });

  it("shows unavailable when a query fails", async () => {
    const api = client({
      listEvents: vi.fn().mockRejectedValue(new Error("query failed"))
    });

    render(<ConnectionCheck client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Connection check unavailable")).toBeInTheDocument();
  });
});

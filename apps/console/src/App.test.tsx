import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api/client";
import { App } from "./App";

const { apiClient } = vi.hoisted(() => ({
  apiClient: {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn().mockResolvedValue({ user: { id: "usr_1", email: "admin@example.com", isAdmin: true } }),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn().mockResolvedValue({
      projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
    }),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn().mockResolvedValue({
      environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
    }),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn()
  } satisfies ApiClient
}));

vi.mock("./api/client", () => ({
  createApiClient: () => apiClient
}));

describe("App", () => {
  it("renders the authenticated console workspace", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Acme App" })).toBeInTheDocument();
    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
  });
});

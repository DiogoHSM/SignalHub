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
  it("renders the authenticated console scaffold", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "SignalHub Console" })).toBeInTheDocument();
    expect(screen.getByText("Authenticated console ready.")).toBeInTheDocument();
  });
});

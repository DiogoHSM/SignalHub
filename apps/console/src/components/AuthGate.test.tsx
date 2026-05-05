import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";
import { ApiError, type ApiClient } from "../api/client";

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
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
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

describe("AuthGate", () => {
  it("renders children for admin users", async () => {
    render(
      <AuthGate
        client={client({
          getMe: vi.fn().mockResolvedValue({ user: { id: "usr_1", email: "admin@example.com", isAdmin: true } })
        })}
      >
        <div>Console loaded</div>
      </AuthGate>
    );

    expect(await screen.findByText("Console loaded")).toBeInTheDocument();
  });

  it("shows login form when unauthenticated", async () => {
    render(
      <AuthGate client={client({ getMe: vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated")) })}>
        <div>Console loaded</div>
      </AuthGate>
    );

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByText("Console loaded")).not.toBeInTheDocument();
  });

  it("shows unavailable state with retry when session lookup fails for non-auth reasons", async () => {
    const api = client({
      getMe: vi
        .fn()
        .mockRejectedValueOnce(new ApiError(500, "request_failed"))
        .mockResolvedValueOnce({ user: { id: "usr_1", email: "admin@example.com", isAdmin: true } })
    });

    render(
      <AuthGate client={api}>
        <div>Console loaded</div>
      </AuthGate>
    );

    expect(await screen.findByRole("heading", { name: "Console unavailable" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(api.getMe).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Console loaded")).toBeInTheDocument();
  });

  it("logs in and renders children", async () => {
    const api = client({
      getMe: vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated")),
      login: vi.fn().mockResolvedValue({ user: { id: "usr_1", email: "admin@example.com", isAdmin: true } })
    });

    render(
      <AuthGate client={api}>
        <div>Console loaded</div>
      </AuthGate>
    );

    await userEvent.type(await screen.findByLabelText("Email"), "admin@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "very-secure-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(api.login).toHaveBeenCalledWith("admin@example.com", "very-secure-password"));
    expect(await screen.findByText("Console loaded")).toBeInTheDocument();
  });

  it("shows invalid credentials for auth login failures", async () => {
    const api = client({
      getMe: vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated")),
      login: vi.fn().mockRejectedValue(new ApiError(403, "invalid_credentials"))
    });

    render(
      <AuthGate client={api}>
        <div>Console loaded</div>
      </AuthGate>
    );

    await userEvent.type(await screen.findByLabelText("Email"), "admin@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(screen.queryByText("Console service unavailable")).not.toBeInTheDocument();
  });

  it("shows service unavailable for non-auth login failures", async () => {
    const api = client({
      getMe: vi.fn().mockRejectedValue(new ApiError(401, "unauthenticated")),
      login: vi.fn().mockRejectedValue(new ApiError(500, "request_failed"))
    });

    render(
      <AuthGate client={api}>
        <div>Console loaded</div>
      </AuthGate>
    );

    await userEvent.type(await screen.findByLabelText("Email"), "admin@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "very-secure-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Console service unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Invalid email or password")).not.toBeInTheDocument();
  });

  it("blocks authenticated non-admin users", async () => {
    render(
      <AuthGate
        client={client({
          getMe: vi.fn().mockResolvedValue({ user: { id: "usr_2", email: "user@example.com", isAdmin: false } })
        })}
      >
        <div>Console loaded</div>
      </AuthGate>
    );

    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
  });

  it("lets denied non-admin users sign out and return to the login form", async () => {
    const api = client({
      getMe: vi.fn().mockResolvedValue({ user: { id: "usr_2", email: "user@example.com", isAdmin: false } }),
      logout: vi.fn().mockRejectedValue(new ApiError(500, "request_failed"))
    });

    render(
      <AuthGate client={api}>
        <div>Console loaded</div>
      </AuthGate>
    );

    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(api.logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });
});

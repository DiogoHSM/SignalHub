import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { UserAdminPanel } from "./UserAdminPanel";

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    fetchFleet: vi.fn(),
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
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    getSystemHealth: vi.fn(),
    listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [] } }),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [] } }),
    getUserDetail: vi.fn().mockResolvedValue({ data: { window: "7d", generatedAt: "2026-05-05T12:00:00.000Z", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" }, user: { userId: "user_1", label: "user_1", isAnonymous: false, impactScore: 0, lastSeenAt: null, events: 0, errors: 0, openErrors: 0, severeErrors: 0, traces: 0, failedTraces: 0, llmCalls: 0, failedLlmCalls: 0, llmCostUsd: "0", activeTenants: 0, activeSessions: 0 }, recentSessions: [], timeline: [] } }),
    listUsers: vi.fn().mockResolvedValue({ users: [] }),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    listNotificationChannels: vi.fn().mockResolvedValue({ channels: [] }),
    createNotificationChannel: vi.fn(),
    updateNotificationChannel: vi.fn(),
    archiveNotificationChannel: vi.fn(),
    listAlertRules: vi.fn().mockResolvedValue({ rules: [] }),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    archiveAlertRule: vi.fn(),
    listAlertEvents: vi.fn().mockResolvedValue({ data: [] }),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn().mockResolvedValue({ data: [] }),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    getSessionTimeline: vi.fn().mockResolvedValue({ data: { sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } } }),
    ...overrides
  };
}

afterEach(() => {
  cleanup();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("UserAdminPanel", () => {
  it("lists users", async () => {
    const api = client({
      listUsers: vi.fn().mockResolvedValue({
        users: [
          { id: "usr_1", email: "admin@example.com", isAdmin: true },
          { id: "usr_2", email: "user@example.com", isAdmin: false }
        ]
      })
    });

    render(<UserAdminPanel client={api} />);

    expect(await screen.findByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText("User")).toBeInTheDocument();
  });

  it("creates a non-admin user with email and password", async () => {
    const api = client({
      createUser: vi.fn().mockResolvedValue({
        user: { id: "usr_3", email: "new@example.com", isAdmin: false }
      })
    });

    render(<UserAdminPanel client={api} />);

    await userEvent.type(screen.getByLabelText("New user email"), "  new@example.com  ");
    await userEvent.type(screen.getByLabelText("Temporary password"), "temporary-password");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    await waitFor(() =>
      expect(api.createUser).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "temporary-password",
        isAdmin: false
      })
    );
    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("New user email")).toHaveValue("");
    expect(screen.getByLabelText("Temporary password")).toHaveValue("");
  });

  it("updates an existing console user", async () => {
    const api = client({
      listUsers: vi.fn().mockResolvedValue({
        users: [{ id: "usr_2", email: "user@example.com", isAdmin: false }]
      }),
      updateUser: vi.fn().mockResolvedValue({
        user: { id: "usr_2", email: "operator@example.com", isAdmin: true }
      })
    });

    render(<UserAdminPanel client={api} />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit user@example.com" }));
    await userEvent.clear(screen.getByLabelText("User email"));
    await userEvent.type(screen.getByLabelText("User email"), "operator@example.com");
    await userEvent.click(screen.getByLabelText("Administrator"));
    await userEvent.type(screen.getByLabelText("Temporary password"), "new-temporary-password");
    await userEvent.click(screen.getByRole("button", { name: "Save user" }));

    await waitFor(() =>
      expect(api.updateUser).toHaveBeenCalledWith("usr_2", {
        email: "operator@example.com",
        isAdmin: true,
        password: "new-temporary-password"
      })
    );
    expect(await screen.findByText("operator@example.com")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create user" })).toBeInTheDocument();
  });

  it("archives an existing console user after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = client({
      listUsers: vi.fn().mockResolvedValue({
        users: [{ id: "usr_2", email: "user@example.com", isAdmin: false }]
      }),
      archiveUser: vi.fn().mockResolvedValue(undefined)
    });

    render(<UserAdminPanel client={api} />);

    await userEvent.click(await screen.findByRole("button", { name: "Archive user@example.com" }));

    expect(confirmSpy).toHaveBeenCalledWith("Archive user user@example.com? They will no longer be able to access the console.");
    await waitFor(() => expect(api.archiveUser).toHaveBeenCalledWith("usr_2"));
    expect(screen.queryByText("user@example.com")).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("clears the temporary password when user creation fails", async () => {
    const api = client({
      createUser: vi.fn().mockRejectedValue(new Error("create failed"))
    });

    render(<UserAdminPanel client={api} />);

    await userEvent.type(screen.getByLabelText("New user email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Temporary password"), "temporary-password");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(await screen.findByText("Could not create user.")).toBeInTheDocument();
    expect(screen.getByLabelText("Temporary password")).toHaveValue("");
  });

  it("prevents duplicate submits while creation is in flight", async () => {
    const createUser = deferred<{ user: { id: string; email: string; isAdmin: boolean } }>();
    const api = client({
      createUser: vi.fn().mockReturnValue(createUser.promise)
    });

    render(<UserAdminPanel client={api} />);

    await userEvent.type(screen.getByLabelText("New user email"), "new@example.com");
    await userEvent.type(screen.getByLabelText("Temporary password"), "temporary-password");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    const submitButton = screen.getByRole("button", { name: "Create user" });
    expect(submitButton).toBeDisabled();
    await userEvent.click(submitButton);

    expect(api.createUser).toHaveBeenCalledTimes(1);

    await act(async () => {
      createUser.resolve({ user: { id: "usr_3", email: "new@example.com", isAdmin: false } });
      await createUser.promise;
    });

    expect(submitButton).toBeEnabled();
  });
});

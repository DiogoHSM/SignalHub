import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { UserAdminPanel } from "./UserAdminPanel";

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

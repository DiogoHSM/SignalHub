import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { CreatedApiKey } from "../api/types";
import type { Environment } from "../api/types";
import { ConsoleShell } from "./ConsoleShell";

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
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    listUsers: vi.fn().mockResolvedValue({ users: [] }),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
});

describe("ConsoleShell", () => {
  it("loads projects and environments for the selected project", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByRole("button", { name: "Acme App" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Production" })).toBeInTheDocument();
    expect(api.listEnvironments).toHaveBeenCalledWith("prj_1");
  });

  it("creates a project and selects it", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn((projectId: string) =>
        Promise.resolve({
          environments:
            projectId === "prj_1"
              ? [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
              : []
        })
      ),
      createProject: vi.fn().mockResolvedValue({
        project: { id: "prj_2", name: "New Project", createdAt: "", updatedAt: "", archivedAt: null }
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("New project name"), "New Project");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith({ name: "New Project" }));
    expect(await screen.findByRole("heading", { name: "New Project" })).toBeInTheDocument();
    expect(screen.getByText("Create an environment to continue setup.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Production" })).not.toBeInTheDocument();
  });

  it("disables environment creation until the active project's environments resolve", async () => {
    const listEnvironments = deferred<{ environments: [] }>();
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockReturnValue(listEnvironments.promise)
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByRole("heading", { name: "Acme App" })).toBeInTheDocument();
    expect(screen.getByLabelText("New environment name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create environment" })).toBeDisabled();

    await act(async () => {
      listEnvironments.resolve({ environments: [] });
      await listEnvironments.promise;
    });

    expect(screen.getByLabelText("New environment name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create environment" })).toBeEnabled();
  });

  it("creates an environment under the selected project", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      createEnvironment: vi.fn().mockResolvedValue({
        environment: { id: "env_2", projectId: "prj_1", name: "Staging", createdAt: "", updatedAt: "", archivedAt: null }
      })
    });

    render(<ConsoleShell client={api} />);

    await waitFor(() => expect(screen.getByLabelText("New environment name")).toBeEnabled());
    await userEvent.type(screen.getByLabelText("New environment name"), "Staging");
    await userEvent.click(screen.getByRole("button", { name: "Create environment" }));

    await waitFor(() => expect(api.createEnvironment).toHaveBeenCalledWith("prj_1", { name: "Staging" }));
    expect(await screen.findByRole("button", { name: "Staging" })).toBeInTheDocument();
  });

  it("hides a one-time secret and uses snippet placeholders immediately after switching projects", async () => {
    const createdKey: CreatedApiKey = {
      id: "key_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Browser key",
      prefix: "sh_live_1234",
      secret: "sh_secret_value",
      createdAt: "",
      revokedAt: null
    };
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [
          { id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null },
          { id: "prj_2", name: "Beta App", createdAt: "", updatedAt: "", archivedAt: null }
        ]
      }),
      listEnvironments: vi.fn((projectId: string) =>
        Promise.resolve({
          environments:
            projectId === "prj_1"
              ? [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
              : [{ id: "env_2", projectId: "prj_2", name: "Preview", createdAt: "", updatedAt: "", archivedAt: null }]
        })
      ),
      createApiKey: vi.fn().mockResolvedValue({ apiKey: createdKey })
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      flushSync(() => {
        root.render(<ConsoleShell client={api} />);
      });

      await act(async () => {});
      expect(await screen.findByText("Environment: Production")).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText("New API key name"), "Browser key");
      await userEvent.click(screen.getByRole("button", { name: "Create key" }));

      expect(await screen.findByText("sh_secret_value")).toBeInTheDocument();

      flushSync(() => {
        screen.getByRole("button", { name: "Beta App" }).click();
      });

      expect(screen.queryByText(/sh_secret_value/)).not.toBeInTheDocument();
      expect(screen.getAllByText(/SIGNAL_HUB_API_KEY/)).toHaveLength(3);
    } finally {
      root.unmount();
      container.remove();
    }
  });

  it("does not apply a created environment after switching projects before the response resolves", async () => {
    const createEnvironment = deferred<{ environment: Environment }>();
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [
          { id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null },
          { id: "prj_2", name: "Beta App", createdAt: "", updatedAt: "", archivedAt: null }
        ]
      }),
      listEnvironments: vi.fn((projectId: string) =>
        Promise.resolve({
          environments:
            projectId === "prj_1"
              ? [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
              : [{ id: "env_2", projectId: "prj_2", name: "Preview", createdAt: "", updatedAt: "", archivedAt: null }]
        })
      ),
      createEnvironment: vi.fn().mockReturnValue(createEnvironment.promise)
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("New environment name"), "Staging");
    await userEvent.click(screen.getByRole("button", { name: "Create environment" }));
    await userEvent.click(screen.getByRole("button", { name: "Beta App" }));

    expect(await screen.findByText("Environment: Preview")).toBeInTheDocument();

    await act(async () => {
      createEnvironment.resolve({
        environment: { id: "env_3", projectId: "prj_1", name: "Staging", createdAt: "", updatedAt: "", archivedAt: null }
      });
      await createEnvironment.promise;
    });

    expect(api.createEnvironment).toHaveBeenCalledWith("prj_1", { name: "Staging" });
    expect(screen.queryByRole("button", { name: "Staging" })).not.toBeInTheDocument();
    expect(screen.getByText("Environment: Preview")).toBeInTheDocument();
  });

  it("keeps a locally created environment when a stale active-project list resolves later", async () => {
    const createEnvironment = deferred<{ environment: Environment }>();
    const secondAcmeList = deferred<{ environments: Environment[] }>();
    const production = { id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null };
    const preview = { id: "env_2", projectId: "prj_2", name: "Preview", createdAt: "", updatedAt: "", archivedAt: null };
    let acmeListCount = 0;
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [
          { id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null },
          { id: "prj_2", name: "Beta App", createdAt: "", updatedAt: "", archivedAt: null }
        ]
      }),
      listEnvironments: vi.fn((projectId: string) => {
        if (projectId === "prj_1") {
          acmeListCount += 1;
          return acmeListCount === 1
            ? Promise.resolve({ environments: [production] })
            : secondAcmeList.promise;
        }

        return Promise.resolve({ environments: [preview] });
      }),
      createEnvironment: vi.fn().mockReturnValue(createEnvironment.promise)
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("New environment name"), "Staging");
    await userEvent.click(screen.getByRole("button", { name: "Create environment" }));
    await userEvent.click(screen.getByRole("button", { name: "Beta App" }));

    expect(await screen.findByText("Environment: Preview")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Acme App" }));
    await waitFor(() => expect(api.listEnvironments).toHaveBeenCalledTimes(3));

    await act(async () => {
      createEnvironment.resolve({
        environment: { id: "env_3", projectId: "prj_1", name: "Staging", createdAt: "", updatedAt: "", archivedAt: null }
      });
      await createEnvironment.promise;
    });

    expect(screen.getByRole("button", { name: "Staging" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Environment: Staging")).toBeInTheDocument();

    await act(async () => {
      secondAcmeList.resolve({ environments: [production] });
      await secondAcmeList.promise;
    });

    expect(screen.getByRole("button", { name: "Staging" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Environment: Staging")).toBeInTheDocument();
  });

  it("disables project creation until the initial project list resolves", async () => {
    const listProjects = deferred<{ projects: [] }>();
    const api = client({
      listProjects: vi.fn().mockReturnValue(listProjects.promise)
    });

    render(<ConsoleShell client={api} />);

    expect(screen.getByLabelText("New project name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create project" })).toBeDisabled();

    await act(async () => {
      listProjects.resolve({ projects: [] });
      await listProjects.promise;
    });

    expect(screen.getByLabelText("New project name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create project" })).toBeEnabled();
  });

  it("switches between setup and investigate modes without losing active environment", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect(screen.getByRole("heading", { name: "Investigate" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(screen.getByText("Environment: Production")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Environments" })).toBeInTheDocument();
  });

  it("preserves in-progress setup form state across mode switches while hiding inactive setup controls", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "New environment name" }), "Staging");
    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));

    expect(screen.queryByRole("textbox", { name: "New environment name" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New environment name", hidden: true })).toHaveValue("Staging");

    await userEvent.click(screen.getByRole("button", { name: "Setup" }));

    expect(screen.getByRole("textbox", { name: "New environment name" })).toHaveValue("Staging");
  });

  it("does not query investigation events until investigate mode is opened", async () => {
    const listEvents = vi.fn().mockResolvedValue({ data: [] });
    const api = client({
      listEvents,
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
    await waitFor(() => expect(listEvents).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" }));
    expect(listEvents.mock.calls.some(([filters]) => filters.limit === 50)).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));

    await waitFor(() => expect(listEvents.mock.calls.some(([filters]) => filters.limit === 50)).toBe(true));
  });

  it("does not query investigation errors until the errors tab is opened", async () => {
    const listErrors = vi.fn().mockResolvedValue({ data: [] });
    const api = client({
      listErrors,
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
    await waitFor(() => expect(listErrors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" }));
    expect(listErrors.mock.calls.some(([filters]) => filters.limit === 50)).toBe(false);
    listErrors.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));

    expect(listErrors).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Errors" }));

    await waitFor(() => expect(listErrors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 }));
  });

  it("does not query investigation traces until the traces tab is opened", async () => {
    const listTraces = vi.fn().mockResolvedValue({ data: [] });
    const listTraceSpans = vi.fn().mockResolvedValue({ data: [] });
    const api = client({
      listTraces,
      listTraceSpans,
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));

    expect(listTraces).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Traces" }));

    await waitFor(() => expect(listTraces).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 }));
    expect(listTraceSpans).not.toHaveBeenCalled();
  });

  it("selects the first environment each time the active project changes", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [
          { id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null },
          { id: "prj_2", name: "Beta App", createdAt: "", updatedAt: "", archivedAt: null }
        ]
      }),
      listEnvironments: vi.fn((projectId: string) =>
        Promise.resolve({
          environments:
            projectId === "prj_1"
              ? [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
              : [{ id: "env_2", projectId: "prj_2", name: "Preview", createdAt: "", updatedAt: "", archivedAt: null }]
        })
      )
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Beta App" }));

    expect(await screen.findByText("Environment: Preview")).toBeInTheDocument();
  });
});

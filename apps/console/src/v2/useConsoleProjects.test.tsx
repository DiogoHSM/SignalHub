import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { useConsoleProjects } from "./useConsoleProjects";

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
    getSystemHealthHistory: vi.fn(),
    listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [] } }),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [] } }),
    getUserDetail: vi.fn(),
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
    updateAlertEventTriage: vi.fn(),
    listAlertEvents: vi.fn().mockResolvedValue({ data: [] }),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn().mockResolvedValue({ data: [] }),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    addTriageNote: vi.fn(),
    silenceIncident: vi.fn(),
    getSessionTimeline: vi.fn(),
    listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
    uploadSourceMap: vi.fn(),
    uploadSourceMapBundle: vi.fn(),
    deleteSourceMapArtifact: vi.fn(),
    getErrorSourceMapResolution: vi.fn(),
    ...overrides
  };
}

afterEach(() => {
  cleanup();
});

describe("useConsoleProjects", () => {
  it("reports a project load failure instead of treating it as an empty installation", async () => {
    const api = client({ listProjects: vi.fn().mockRejectedValue(new Error("offline")) });

    const { result } = renderHook(() => useConsoleProjects(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.projectError).toBe(true);
    expect(result.current.projects).toEqual([]);
  });

  it("remains loading until environments for the active project resolve", async () => {
    let resolveEnvironments!: (value: { environments: [] }) => void;
    const environmentsPending = new Promise<{ environments: [] }>((resolve) => {
      resolveEnvironments = resolve;
    });
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Alpha", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockReturnValue(environmentsPending)
    });

    const { result } = renderHook(() => useConsoleProjects(api));

    await waitFor(() => expect(result.current.activeProject?.id).toBe("prj_1"));
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveEnvironments({ environments: [] });
      await environmentsPending;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.environmentError).toBe(false);
  });

  it("retries environments after a failed load", async () => {
    const listEnvironments = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      });
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Alpha", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments
    });

    const { result } = renderHook(() => useConsoleProjects(api));

    await waitFor(() => expect(result.current.environmentError).toBe(true));

    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.activeEnvironment?.id).toBe("env_1"));
    expect(result.current.environmentError).toBe(false);
    expect(listEnvironments).toHaveBeenCalledTimes(2);
  });

  it("loads two projects and defaults activeProject to the first", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [
          { id: "prj_1", name: "Alpha", createdAt: "", updatedAt: "", archivedAt: null },
          { id: "prj_2", name: "Beta", createdAt: "", updatedAt: "", archivedAt: null }
        ]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    const { result } = renderHook(() => useConsoleProjects(api));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.projects).toHaveLength(2);
    expect(result.current.activeProject?.id).toBe("prj_1");
  });

  it("selects the next available project when the active project disappears on reload", async () => {
    const listProjects = vi.fn()
      .mockResolvedValueOnce({
        projects: [
          { id: "prj_1", name: "Alpha", createdAt: "", updatedAt: "", archivedAt: null },
          { id: "prj_2", name: "Beta", createdAt: "", updatedAt: "", archivedAt: null }
        ]
      })
      .mockResolvedValue({
        projects: [{ id: "prj_2", name: "Beta", createdAt: "", updatedAt: "", archivedAt: null }]
      });
    const api = client({ listProjects });
    const { result } = renderHook(() => useConsoleProjects(api));

    await waitFor(() => expect(result.current.activeProject?.id).toBe("prj_1"));
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.activeProject?.id).toBe("prj_2"));
    expect(result.current.projects.map((project) => project.id)).toEqual(["prj_2"]);
  });

  it("loads environments for the default active project", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Alpha", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [
          { id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null },
          { id: "env_2", projectId: "prj_1", name: "Staging", createdAt: "", updatedAt: "", archivedAt: null }
        ]
      })
    });

    const { result } = renderHook(() => useConsoleProjects(api));

    await waitFor(() => expect(result.current.environments).toHaveLength(2));
    expect(result.current.activeEnvironment?.id).toBe("env_1");
    expect(api.listEnvironments).toHaveBeenCalledWith("prj_1");
  });

  it("selectProject switches active project and loads its environments", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [
          { id: "prj_1", name: "Alpha", createdAt: "", updatedAt: "", archivedAt: null },
          { id: "prj_2", name: "Beta", createdAt: "", updatedAt: "", archivedAt: null }
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

    const { result } = renderHook(() => useConsoleProjects(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.activeEnvironment?.id).toBe("env_1"));

    act(() => {
      result.current.selectProject("prj_2");
    });

    expect(result.current.activeEnvironment).toBeUndefined();
    expect(result.current.environments).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.activeProject?.id).toBe("prj_2"));
    await waitFor(() => expect(result.current.activeEnvironment?.id).toBe("env_2"));
    expect(result.current.environments).toHaveLength(1);
    expect(result.current.environments[0].name).toBe("Preview");
  });

  it("keeps the current environment when the active project is selected again", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Alpha", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    const { result } = renderHook(() => useConsoleProjects(api));
    await waitFor(() => expect(result.current.activeEnvironment?.id).toBe("env_1"));

    act(() => {
      result.current.selectProject("prj_1");
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.activeEnvironment?.id).toBe("env_1");
    expect(api.listEnvironments).toHaveBeenCalledTimes(1);
  });

  it("selectEnvironment switches the active environment by id", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Alpha", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [
          { id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null },
          { id: "env_2", projectId: "prj_1", name: "Staging", createdAt: "", updatedAt: "", archivedAt: null }
        ]
      })
    });

    const { result } = renderHook(() => useConsoleProjects(api));

    await waitFor(() => expect(result.current.activeEnvironment?.id).toBe("env_1"));

    act(() => {
      result.current.selectEnvironment("env_2");
    });

    expect(result.current.activeEnvironment?.id).toBe("env_2");
  });

  it("opens a named environment after switching to another project", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [
          { id: "prj_1", name: "Alpha", createdAt: "", updatedAt: "", archivedAt: null },
          { id: "prj_2", name: "Beta", createdAt: "", updatedAt: "", archivedAt: null }
        ]
      }),
      listEnvironments: vi.fn((projectId: string) => Promise.resolve({
        environments: projectId === "prj_1"
          ? [{ id: "env_1", projectId, name: "production", createdAt: "", updatedAt: "", archivedAt: null }]
          : [
              { id: "env_2", projectId, name: "preview", createdAt: "", updatedAt: "", archivedAt: null },
              { id: "env_3", projectId, name: "production", createdAt: "", updatedAt: "", archivedAt: null }
            ]
      }))
    });
    const { result } = renderHook(() => useConsoleProjects(api));
    await waitFor(() => expect(result.current.activeEnvironment?.id).toBe("env_1"));

    act(() => result.current.selectProjectEnvironmentByName("prj_2", "production"));

    await waitFor(() => expect(result.current.activeProject?.id).toBe("prj_2"));
    await waitFor(() => expect(result.current.activeEnvironment?.id).toBe("env_3"));
  });

  it("starts with isLoading=true and resolves to false", async () => {
    let resolveProjects!: (value: { projects: [] }) => void;
    const pending = new Promise<{ projects: [] }>((res) => {
      resolveProjects = res;
    });
    const api = client({
      listProjects: vi.fn().mockReturnValue(pending)
    });

    const { result } = renderHook(() => useConsoleProjects(api));

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveProjects({ projects: [] });
      await pending;
    });

    expect(result.current.isLoading).toBe(false);
  });
});

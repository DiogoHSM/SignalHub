import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { Environment, Project } from "../api/types";
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
  const project: Project = { id: "project-a", name: "Alpha", createdAt: "", updatedAt: "", archivedAt: null };
  const otherProject: Project = { ...project, id: "project-b", name: "Beta" };
  const environment: Environment = { id: "env-a", projectId: project.id, name: "production", createdAt: "", updatedAt: "", archivedAt: null };
  const canary: Environment = { ...environment, id: "env-canary", name: "canary" };

  it("refreshes metadata in place without loading gaps or losing the selected environment", async () => {
    const listProjects = vi.fn().mockResolvedValue({ projects: [project] });
    const listEnvironments = vi.fn().mockResolvedValue({ environments: [environment, canary] });
    const api = client({ listProjects, listEnvironments });
    const observations: Array<{ loading: boolean; environment: string | undefined }> = [];
    const { result } = renderHook(() => { const state = useConsoleProjects(api); observations.push({ loading: state.isLoading, environment: state.activeEnvironment?.id }); return state; });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.selectEnvironment(canary.id));
    observations.length = 0;
    listProjects.mockResolvedValue({ projects: [{ ...project, name: "Renamed" }] });
    listEnvironments.mockResolvedValue({ environments: [environment, { ...canary, name: "preview" }] });
    await act(async () => result.current.refreshInBackground());
    expect(result.current.activeProject?.name).toBe("Renamed");
    expect(result.current.activeEnvironment?.name).toBe("preview");
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((value) => !value.loading && value.environment === canary.id)).toBe(true);
  });

  it("preserves usable scope and rejects a failed background refresh atomically", async () => {
    const listProjects = vi.fn().mockResolvedValue({ projects: [project] });
    const listEnvironments = vi.fn().mockResolvedValue({ environments: [environment] });
    const clientApi = client({ listProjects, listEnvironments });
    const { result } = renderHook(() => useConsoleProjects(clientApi));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    listProjects.mockResolvedValue({ projects: [{ ...project, name: "Uncommitted metadata" }] });
    listEnvironments.mockRejectedValue(new Error("refresh failed"));
    await act(async () => { await expect(result.current.refreshInBackground()).rejects.toThrow("refresh failed"); });
    expect(result.current.activeProject).toEqual(project);
    expect(result.current.activeEnvironment).toEqual(environment);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.environmentError).toBe(false);
  });

  it("ignores a background response after navigating away from its project", async () => {
    const listProjects = vi.fn().mockResolvedValue({ projects: [project, otherProject] });
    const otherEnvironment = { ...environment, id: "env-b", projectId: otherProject.id };
    const listEnvironments = vi.fn((id: string) => Promise.resolve({ environments: id === project.id ? [environment] : [otherEnvironment] }));
    const api = client({ listProjects, listEnvironments });
    const { result } = renderHook(() => useConsoleProjects(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let resolveRefresh!: (value: { projects: Project[] }) => void;
    listProjects.mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refreshInBackground(); result.current.selectProject(otherProject.id); });
    await waitFor(() => expect(result.current.activeEnvironment?.id).toBe(otherEnvironment.id));
    await act(async () => { resolveRefresh({ projects: [project] }); await refresh; });
    expect(result.current.activeProject?.id).toBe(otherProject.id);
    expect(result.current.activeEnvironment?.id).toBe(otherEnvironment.id);
  });

  it("settles on a surviving environment when a refresh confirms the selected environment was archived", async () => {
    const listEnvironments = vi.fn().mockResolvedValue({ environments: [environment, canary] });
    const api = client({ listProjects: vi.fn().mockResolvedValue({ projects: [project] }), listEnvironments });
    const { result } = renderHook(() => useConsoleProjects(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.selectEnvironment(canary.id));
    listEnvironments.mockResolvedValue({ environments: [environment] });
    await act(async () => result.current.refreshInBackground());
    expect(result.current.activeEnvironment?.id).toBe(environment.id);
    expect(result.current.isLoading).toBe(false);
  });

  it("keeps an environment selected while the background request is in flight", async () => {
    const listProjects = vi.fn().mockResolvedValue({ projects: [project] });
    const api = client({ listProjects, listEnvironments: vi.fn().mockResolvedValue({ environments: [environment, canary] }) });
    const { result } = renderHook(() => useConsoleProjects(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    let resolveRefresh!: (value: { projects: Project[] }) => void;
    listProjects.mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refreshInBackground(); result.current.selectEnvironment(canary.id); });
    await act(async () => { resolveRefresh({ projects: [project] }); await refresh; });
    expect(result.current.activeEnvironment?.id).toBe(canary.id);
  });

  it("moves to a surviving project only when refresh confirms the active project disappeared", async () => {
    const listProjects = vi.fn().mockResolvedValue({ projects: [project, otherProject] });
    const otherEnvironment = { ...environment, id: "env-b", projectId: otherProject.id };
    const api = client({ listProjects, listEnvironments: vi.fn((id: string) => Promise.resolve({ environments: id === project.id ? [environment] : [otherEnvironment] })) });
    const { result } = renderHook(() => useConsoleProjects(api));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    listProjects.mockResolvedValue({ projects: [otherProject] });
    await act(async () => result.current.refreshInBackground());
    await waitFor(() => expect(result.current.activeEnvironment?.id).toBe(otherEnvironment.id));
    expect(result.current.activeProject?.id).toBe(otherProject.id);
    expect(result.current.isLoading).toBe(false);
  });
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

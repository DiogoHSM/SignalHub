import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { Environment } from "../api/types";
import { ProjectSettingsWorkspace } from "./ProjectSettingsWorkspace";

const environment: Environment = {
  id: "env_1",
  projectId: "prj_1",
  name: "Production",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  archivedAt: null
};

function client(overrides: Partial<ApiClient> = {}): ApiClient {
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
    listBrowserOrigins: vi.fn().mockResolvedValue({ origins: [] }),
    createBrowserOrigin: vi.fn(),
    archiveBrowserOrigin: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({
      data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" }
    }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    getSystemHealth: vi.fn(),
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
    listAlertEvents: vi.fn().mockResolvedValue({ data: [] }),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn().mockResolvedValue({ data: [] }),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    getSessionTimeline: vi.fn().mockResolvedValue({
      data: {
        sessionId: "sess_1",
        scope: { projectId: "prj_1", environmentId: "env_1" },
        range: { from: null, to: null },
        items: [],
        page: { nextCursor: null, previousCursor: null }
      }
    }),
    listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
    uploadSourceMap: vi.fn(),
    uploadSourceMapBundle: vi.fn(),
    deleteSourceMapArtifact: vi.fn(),
    listSourceMapUploadTokens: vi.fn().mockResolvedValue({ tokens: [] }),
    createSourceMapUploadToken: vi.fn(),
    revokeSourceMapUploadToken: vi.fn(),
    getErrorSourceMapResolution: vi.fn(),
    ...overrides
  };
}

function renderWorkspace(overrides: Partial<ComponentProps<typeof ProjectSettingsWorkspace>> = {}) {
  return render(
    <ProjectSettingsWorkspace
      activeEnvironment={environment}
      activeProjectId="prj_1"
      apiEndpoint="https://sigmon.example.com"
      client={client()}
      environments={[environment]}
      isEnvironmentCreationDisabled={false}
      latestSecret="sh_secret_value"
      onCreateEnvironment={vi.fn()}
      onSecretCreated={vi.fn()}
      onSelectEnvironment={vi.fn()}
      {...overrides}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("ProjectSettingsWorkspace", () => {
  it("renders the project settings heading, description, section buttons, and default environments section", () => {
    renderWorkspace();

    expect(screen.getByRole("heading", { name: "Project Settings" })).toBeInTheDocument();
    expect(screen.getByText("Recurring configuration for the selected project and environment.")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Project settings sections" })).toBeInTheDocument();

    for (const label of ["Environments", "API keys", "Browser origins", "SDK snippets", "Source maps", "Console users"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Console users" })).toHaveAccessibleDescription(
      "Installation-level console access."
    );

    expect(screen.getByText("Create and select deployment environments for this project.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Environments" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Production" })).toBeInTheDocument();
  });

  it("manages browser origins for the selected project", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = client({
      listBrowserOrigins: vi.fn().mockResolvedValue({
        origins: [
          {
            id: "borg_1",
            projectId: "prj_1",
            origin: "https://app.example.com",
            createdAt: "2026-05-01T00:00:00.000Z",
            archivedAt: null
          }
        ]
      }),
      createBrowserOrigin: vi.fn().mockResolvedValue({
        origin: {
          id: "borg_2",
          projectId: "prj_1",
          origin: "https://new.example.com",
          createdAt: "2026-05-01T00:00:00.000Z",
          archivedAt: null
        }
      }),
      archiveBrowserOrigin: vi.fn().mockResolvedValue(undefined)
    });

    renderWorkspace({ client: api });

    await userEvent.click(screen.getByRole("button", { name: "Browser origins" }));

    expect(
      screen.getByText("Browser origins must include protocol, for example https://app.example.com.")
    ).toBeInTheDocument();
    expect(await screen.findByText("https://app.example.com")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Allowed browser origin"), "https://new.example.com/dashboard");
    await userEvent.click(screen.getByRole("button", { name: "Add origin" }));

    expect(api.createBrowserOrigin).toHaveBeenCalledWith("prj_1", { origin: "https://new.example.com/dashboard" });
    expect(await screen.findByText("https://new.example.com")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Archive https://app.example.com" }));

    expect(confirmSpy).toHaveBeenCalledWith("Archive browser origin https://app.example.com?");
    expect(api.archiveBrowserOrigin).toHaveBeenCalledWith("borg_1");
    expect(screen.queryByText("https://app.example.com")).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("labels console user access as installation-level, not project membership", async () => {
    renderWorkspace();

    await userEvent.click(screen.getByRole("button", { name: "Console users" }));

    expect(screen.getByText("Console users are installation-level accounts, not project-scoped members.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument();
  });

  it("shows an empty state when no project is selected", () => {
    renderWorkspace({ activeProjectId: undefined });

    expect(screen.getByText("No project selected")).toBeInTheDocument();
    expect(screen.getByText("Create or select a project before changing project settings.")).toBeInTheDocument();
  });
});

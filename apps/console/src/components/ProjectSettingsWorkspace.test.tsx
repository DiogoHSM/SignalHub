import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { Environment, Project } from "../api/types";
import { ProjectSettingsWorkspace } from "./ProjectSettingsWorkspace";

const environment: Environment = {
  id: "env_1",
  projectId: "prj_1",
  name: "Production",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  archivedAt: null
};

const project: Project = {
  id: "prj_1",
  name: "MicroERP",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  archivedAt: null
};

function client(overrides: Partial<ApiClient> = {}): ApiClient {
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
    listBrowserOrigins: vi.fn().mockResolvedValue({ origins: [] }),
    createBrowserOrigin: vi.fn(),
    archiveBrowserOrigin: vi.fn(),
    getFeedbackWidgetSettings: vi.fn().mockResolvedValue({
      settings: {
        projectId: "prj_1",
        environmentId: "env_1",
        enabled: false,
        title: "Send feedback",
        prompt: "Tell us what happened or what could be better.",
        placeholder: "Write your feedback...",
        buttonLabel: "Feedback",
        accentColor: "#66e38a",
        allowScreenshot: false,
        privacyNote: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z"
      }
    }),
    updateFeedbackWidgetSettings: vi.fn(),
    listFeedbackItems: vi.fn().mockResolvedValue({ feedback: [] }),
    updateFeedbackStatus: vi.fn(),
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
      activeProject={project}
      activeProjectId="prj_1"
      apiEndpoint="https://sigmon.example.com"
      browserCorsOrigins={["https://app.controledaempresa.com"]}
      client={client()}
      environments={[environment]}
      isEnvironmentCreationDisabled={false}
      latestSecret="sh_secret_value"
      onArchiveEnvironment={vi.fn()}
      onCreateEnvironment={vi.fn()}
      onArchiveProject={vi.fn()}
      onSecretCreated={vi.fn()}
      onSelectEnvironment={vi.fn()}
      onUpdateProject={vi.fn()}
      onUpdateEnvironment={vi.fn()}
      {...overrides}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("ProjectSettingsWorkspace", () => {
  it("renders the project settings heading, description, section buttons, and environment section", async () => {
    renderWorkspace();

    expect(screen.getByRole("heading", { name: "Project Settings" })).toBeInTheDocument();
    expect(screen.getByText("Recurring configuration for the selected project and environment.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Setup checklist" })).toBeInTheDocument();
    expect(screen.getByText("4 of 7 ready")).toBeInTheDocument();
    expect(screen.getByText("Install SDK package")).toBeInTheDocument();
    expect(screen.getByText("npm install @sigmon/sdk")).toBeInTheDocument();
    expect(screen.getByText("Send first ping")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Project settings sections" })).toBeInTheDocument();

    for (const label of [
      "Project",
      "Environments",
      "API keys",
      "Browser origins",
      "Feedback widget",
      "Data governance",
      "Warehouse sync",
      "SDK snippets",
      "Source maps",
      "Console users"
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Console users" })).toHaveAccessibleDescription(
      "Installation-level console access."
    );

    expect(screen.getByRole("heading", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByLabelText("Project name")).toHaveValue("MicroERP");

    await userEvent.click(screen.getByRole("button", { name: "Environments" }));

    expect(screen.getByText("Create and select deployment environments for this project.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Environments" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Production" })).toBeInTheDocument();
  });

  it("configures data governance retention and sensitive property rules", async () => {
    const api = client({
      getDataGovernancePolicy: vi.fn().mockResolvedValue({
        policy: {
          projectId: "prj_1",
          environmentId: "env_1",
          retentionPolicy: { events: 45, errors: 180 },
          propertyRules: [{ target: "event.properties", path: "email", action: "mask" }],
          updatedByUserId: null,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      }),
      updateDataGovernancePolicy: vi.fn().mockResolvedValue({
        policy: {
          projectId: "prj_1",
          environmentId: "env_1",
          retentionPolicy: { events: 45, errors: 180 },
          propertyRules: [
            { target: "event.properties", path: "email", action: "mask" },
            { target: "metadata", path: "headers.authorization", action: "block" }
          ],
          updatedByUserId: "usr_admin",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      })
    });

    renderWorkspace({ client: api });

    await userEvent.click(screen.getByRole("button", { name: "Data governance" }));

    expect(await screen.findByRole("heading", { name: "Data governance" })).toBeInTheDocument();
    expect(screen.getByLabelText("Events retention days")).toHaveValue(45);
    expect(await screen.findByText((_, element) => element?.textContent === "mask event.properties.email")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Target"), "metadata");
    await userEvent.type(screen.getByLabelText("Property path"), "headers.authorization");
    await userEvent.selectOptions(screen.getByLabelText("Action"), "block");
    await userEvent.click(screen.getByRole("button", { name: "Add rule" }));

    expect(api.updateDataGovernancePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        propertyRules: [
          { target: "event.properties", path: "email", action: "mask" },
          { target: "metadata", path: "headers.authorization", action: "block" }
        ]
      })
    );
  });

  it("configures warehouse sync destinations and manual runs", async () => {
    const warehouse = {
      id: "whdst_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Warehouse",
      destinationType: "postgres" as const,
      connectionUrlPreview: "postgres://writer:***@warehouse/sigmon",
      datasets: ["events", "errors"] as const,
      cursor: {},
      batchSize: 500,
      enabled: true,
      lastRunAt: "2026-05-01T00:00:00.000Z",
      lastSuccessAt: "2026-05-01T00:00:00.000Z",
      lastFailureAt: null,
      lastErrorMessage: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      archivedAt: null
    };
    const api = client({
      listWarehouseDestinations: vi.fn().mockResolvedValue({ destinations: [warehouse] }),
      listWarehouseExportRuns: vi.fn().mockResolvedValue({
        runs: [
          {
            id: "whrun_1",
            destinationId: "whdst_1",
            projectId: "prj_1",
            environmentId: "env_1",
            trigger: "manual",
            status: "success",
            startedAt: "2026-05-01T00:00:00.000Z",
            finishedAt: "2026-05-01T00:00:01.000Z",
            cursorBefore: {},
            cursorAfter: {},
            exported: { events: 2 },
            errorMessage: null,
            createdAt: "2026-05-01T00:00:01.000Z"
          }
        ]
      }),
      createWarehouseDestination: vi.fn().mockResolvedValue({ destination: { ...warehouse, id: "whdst_2", name: "Warehouse prod" } }),
      updateWarehouseDestination: vi.fn().mockResolvedValue({ destination: { ...warehouse, enabled: false } }),
      archiveWarehouseDestination: vi.fn().mockResolvedValue(undefined),
      runWarehouseExport: vi.fn().mockResolvedValue({ result: { ran: true, skipped: false, exported: 2, failed: 0 } })
    });

    renderWorkspace({ client: api });

    await userEvent.click(screen.getByRole("button", { name: "Warehouse sync" }));

    expect(await screen.findByRole("heading", { name: "Warehouse sync" })).toBeInTheDocument();
    expect(await screen.findByText("postgres://writer:***@warehouse/sigmon")).toBeInTheDocument();
    expect(screen.getByText(/Events 2/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Run now" }));
    expect(api.runWarehouseExport).toHaveBeenCalledWith("whdst_1", { projectId: "prj_1", environmentId: "env_1" });

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(api.updateWarehouseDestination).toHaveBeenCalledWith("whdst_1", {
      projectId: "prj_1",
      environmentId: "env_1",
      enabled: false
    });

    await userEvent.type(screen.getByLabelText("Name"), "Warehouse prod");
    await userEvent.type(screen.getByLabelText("Postgres connection URL"), "postgres://writer:secret@warehouse-prod/sigmon");
    await userEvent.clear(screen.getByLabelText("Batch size"));
    await userEvent.type(screen.getByLabelText("Batch size"), "250");
    await userEvent.click(screen.getByRole("button", { name: "Create destination" }));
    expect(api.createWarehouseDestination).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Warehouse prod",
        connectionUrl: "postgres://writer:secret@warehouse-prod/sigmon",
        batchSize: 250
      })
    );
  });

  it("updates and archives the selected project", async () => {
    const onUpdateProject = vi.fn().mockResolvedValue(undefined);
    const onArchiveProject = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWorkspace({ onArchiveProject, onUpdateProject });

    await userEvent.click(screen.getByRole("button", { name: "Project" }));
    await userEvent.clear(screen.getByLabelText("Project name"));
    await userEvent.type(screen.getByLabelText("Project name"), "Signal Monitor");
    await userEvent.click(screen.getByRole("button", { name: "Save project" }));

    expect(onUpdateProject).toHaveBeenCalledWith("prj_1", { name: "Signal Monitor" });

    await userEvent.click(screen.getByRole("button", { name: "Archive MicroERP" }));

    expect(confirmSpy).toHaveBeenCalledWith("Archive project MicroERP? This hides it from the project switcher.");
    expect(onArchiveProject).toHaveBeenCalledWith("prj_1");

    confirmSpy.mockRestore();
  });

  it("exposes environment management actions from the environments section", async () => {
    const onArchiveEnvironment = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWorkspace({ onArchiveEnvironment });

    await userEvent.click(screen.getByRole("button", { name: "Environments" }));

    expect(screen.getByRole("button", { name: "Edit Production" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Archive Production" }));

    expect(window.confirm).toHaveBeenCalledWith("Archive environment Production?");
    expect(onArchiveEnvironment).toHaveBeenCalledWith(environment);
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

  it("configures the feedback widget and triages recent feedback", async () => {
    const api = client({
      getFeedbackWidgetSettings: vi.fn().mockResolvedValue({
        settings: {
          projectId: "prj_1",
          environmentId: "env_1",
          enabled: true,
          title: "Send feedback",
          prompt: "Tell us what happened.",
          placeholder: "Write your feedback...",
          buttonLabel: "Feedback",
          accentColor: "#66e38a",
          allowScreenshot: false,
          privacyNote: null,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      }),
      updateFeedbackWidgetSettings: vi.fn().mockResolvedValue({
        settings: {
          projectId: "prj_1",
          environmentId: "env_1",
          enabled: true,
          title: "Report feedback",
          prompt: "Tell us what happened.",
          placeholder: "Write your feedback...",
          buttonLabel: "Feedback",
          accentColor: "#66e38a",
          allowScreenshot: false,
          privacyNote: null,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:05:00.000Z"
        }
      }),
      listFeedbackItems: vi.fn().mockResolvedValue({
        feedback: [
          {
            id: "fbk_1",
            projectId: "prj_1",
            environmentId: "env_1",
            status: "open",
            message: "The export button is unclear.",
            category: "ux",
            pageUrl: "https://app.example.com/reports",
            path: "/reports",
            userAgent: "Vitest",
            tenantId: "tenant_1",
            userId: "user_1",
            sessionId: null,
            traceId: null,
            metadata: {},
            submittedAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z"
          }
        ]
      }),
      updateFeedbackStatus: vi.fn().mockResolvedValue({
        feedback: {
          id: "fbk_1",
          projectId: "prj_1",
          environmentId: "env_1",
          status: "reviewed",
          message: "The export button is unclear.",
          category: "ux",
          pageUrl: "https://app.example.com/reports",
          path: "/reports",
          userAgent: "Vitest",
          tenantId: "tenant_1",
          userId: "user_1",
          sessionId: null,
          traceId: null,
          metadata: {},
          submittedAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:05:00.000Z"
        }
      })
    });

    renderWorkspace({ client: api });

    await userEvent.click(screen.getByRole("button", { name: "Feedback widget" }));

    expect(await screen.findByRole("heading", { name: "Feedback widget" })).toBeInTheDocument();
    expect(screen.getByLabelText("Enable widget for this environment")).toBeChecked();
    expect(await screen.findByText("The export button is unclear.")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Panel title"));
    await userEvent.type(screen.getByLabelText("Panel title"), "Report feedback");
    await userEvent.click(screen.getByRole("button", { name: "Save widget" }));

    expect(api.updateFeedbackWidgetSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        environmentId: "env_1",
        title: "Report feedback",
        allowScreenshot: false
      })
    );

    await userEvent.click(screen.getByRole("button", { name: "Mark reviewed" }));
    expect(api.updateFeedbackStatus).toHaveBeenCalledWith("fbk_1", { projectId: "prj_1", environmentId: "env_1" }, "reviewed");
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

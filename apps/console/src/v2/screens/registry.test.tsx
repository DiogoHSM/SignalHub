import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import type { Environment, Project } from "../../api/types";
import type { NavSection } from "../nav";
import { renderSection, SCREENS, type ScreenCtx } from "./registry";
import * as useOverviewModule from "./useOverview";
import * as useErrorsModule from "./useErrors";
import * as useIncidentsModule from "./useIncidents";
import * as useLlmModule from "./useLlm";
import * as useTracesModule from "./useTraces";

afterEach(cleanup);

// Minimal ApiClient stub — only the methods registry.tsx components call are needed
function makeClient(): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
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
    getOverview: vi.fn(),
    getOperations: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ events: [], total: 0 }),
    getEvent: vi.fn(),
    listErrorGroups: vi.fn().mockResolvedValue({ groups: [], total: 0 }),
    getErrorGroup: vi.fn(),
    listErrors: vi.fn().mockResolvedValue({ errors: [], total: 0 }),
    listTraces: vi.fn().mockResolvedValue({ traces: [], total: 0 }),
    getTrace: vi.fn(),
    listLlmCalls: vi.fn().mockResolvedValue({ calls: [], total: 0 }),
    listAlertRules: vi.fn().mockResolvedValue({ rules: [] }),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    deleteAlertRule: vi.fn(),
    listAlertEvents: vi.fn().mockResolvedValue({ events: [] }),
    listNotificationChannels: vi.fn().mockResolvedValue({ channels: [] }),
    createNotificationChannel: vi.fn(),
    deleteNotificationChannel: vi.fn(),
    fetchFleet: vi.fn().mockResolvedValue({ projects: [] }),
  } as unknown as ApiClient;
}

const project: Project = {
  id: "prj_1",
  name: "Demo",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

const environment: Environment = {
  id: "env_1",
  projectId: "prj_1",
  name: "production",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

function makeCtx(overrides: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: makeClient(),
    project,
    environment,
    environments: [environment],
    onCreateEnvironment: vi.fn().mockResolvedValue(undefined),
    onArchiveEnvironment: vi.fn().mockResolvedValue(undefined),
    onArchiveProject: vi.fn().mockResolvedValue(undefined),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn().mockResolvedValue(undefined),
    onUpdateEnvironment: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn() as (section: NavSection) => void,
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    ...overrides,
  };
}

describe("screen registry", () => {
  it("has an entry for every nav section", () => {
    for (const s of ["overview","investigate","incidents","llm","traces","alerts","system","settings"] as const)
      expect(SCREENS[s]).toBeDefined();
  });

  it("overview entry has kind === 'v2'", () => {
    expect(SCREENS.overview.kind).toBe("v2");
  });

  it("renderSection('overview') renders OverviewScreen NOT inside .console-legacy-island", () => {
    // Stub useOverview so OverviewScreen renders deterministically without client calls
    vi.spyOn(useOverviewModule, "useOverview").mockReturnValue({
      data: null,
      status: "loading",
      reload: vi.fn(),
    });
    const ctx = makeCtx();
    const { container } = render(<>{renderSection("overview", ctx)}</>);
    expect(container.querySelector(".console-legacy-island")).toBeNull();
    // OverviewScreen shows loading hint text when data is null and status is loading
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("investigate entry has kind === 'v2'", () => {
    expect(SCREENS.investigate.kind).toBe("v2");
  });

  it("renderSection('investigate') renders ErrorsScreen NOT inside .console-legacy-island", () => {
    // Stub useErrors so ErrorsScreen renders deterministically without client calls
    vi.spyOn(useErrorsModule, "useErrors").mockReturnValue({
      data: null,
      status: "loading",
      reload: () => {},
    });
    const ctx = makeCtx();
    const { container } = render(<>{renderSection("investigate", ctx)}</>);
    expect(container.querySelector(".console-legacy-island")).toBeNull();
    // ErrorsScreen shows loading hint text when data is null and status is loading
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("incidents entry has kind === 'v2'", () => {
    expect(SCREENS.incidents.kind).toBe("v2");
  });

  it("renderSection('incidents') renders IncidentsScreen NOT inside .console-legacy-island", () => {
    // Stub useIncidents so IncidentsScreen renders deterministically without client calls
    vi.spyOn(useIncidentsModule, "useIncidents").mockReturnValue({
      data: null,
      status: "loading",
      reload: vi.fn(),
    });
    const ctx = makeCtx();
    const { container } = render(<>{renderSection("incidents", ctx)}</>);
    expect(container.querySelector(".console-legacy-island")).toBeNull();
    // IncidentsScreen shows loading hint text when data is null and status is loading
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("llm entry has kind === 'v2'", () => {
    expect(SCREENS.llm.kind).toBe("v2");
  });

  it("renderSection('llm') renders LlmScreen NOT inside .console-legacy-island", () => {
    vi.spyOn(useLlmModule, "useLlm").mockReturnValue({
      data: null,
      status: "loading",
      reload: vi.fn(),
    });
    const ctx = makeCtx();
    const { container } = render(<>{renderSection("llm", ctx)}</>);
    expect(container.querySelector(".console-legacy-island")).toBeNull();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("routes traces to a v2 screen", () => {
    expect(SCREENS.traces.kind).toBe("v2");
  });

  it("renders the v2 Traces screen (not wrapped in the legacy island)", () => {
    vi.spyOn(useTracesModule, "useTraces").mockReturnValue({ data: null, status: "loading", reload: vi.fn() });
    const ctx = makeCtx();
    const node = renderSection("traces", ctx);
    const { container } = render(<>{node}</>);
    expect(container.querySelector(".console-legacy-island")).toBeNull();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("wraps legacy entries in the legacy island", () => {
    const { container } = render(<>{renderSection("settings", makeCtx())}</>);
    expect(container.querySelector(".console-legacy-island")).not.toBeNull();
  });

  it("settings section renders ProjectSettingsWorkspace inside the legacy island", () => {
    const { container } = render(<>{renderSection("settings", makeCtx())}</>);
    // LegacyIsland wrapper
    expect(container.querySelector(".console-legacy-island")).not.toBeNull();
    // ProjectSettingsWorkspace renders a SettingsSectionNav with aria-label="Project settings sections"
    expect(container.querySelector("[aria-label='Project settings sections']")).not.toBeNull();
  });
});

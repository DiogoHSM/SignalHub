import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { User } from "../api/types";
import { ConsoleShellV2 } from "./ConsoleShellV2";

// ─── helpers ────────────────────────────────────────────────────────────────

const ADMIN_USER: User = { id: "usr_1", email: "jane.doe@example.com", isAdmin: true };

const PROJECT_1 = { id: "prj_1", name: "Acme Prod", createdAt: "", updatedAt: "", archivedAt: null };
const PROJECT_2 = { id: "prj_2", name: "Acme Staging", createdAt: "", updatedAt: "", archivedAt: null };
const ENV_1 = { id: "env_1", projectId: "prj_1", name: "production", createdAt: "", updatedAt: "", archivedAt: null };

function makeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn().mockResolvedValue({ user: ADMIN_USER }),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn().mockResolvedValue({ projects: [PROJECT_1, PROJECT_2] }),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn().mockResolvedValue({ environments: [ENV_1] }),
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
    getOverview: vi.fn().mockResolvedValue({ data: { window: "24h", generatedAt: "", scope: {}, range: {}, kpis: { events: 0, activeUsers: 0, activeTenants: 0, errors: 0, openErrors: 0, traces: 0, failedTraces: 0, llmCalls: 0, failedLlmCalls: 0, llmInputTokens: 0, llmOutputTokens: 0, llmCostUsd: "0" }, trends: { usage: [], errors: [], latency: [], aiCost: [] }, top: { events: [], tenantsByUsage: [], tenantsByErrors: [], tenantsByLlmCalls: [], tenantsByLlmCost: [], llmProviders: [], llmModels: [], llmPrompts: [], errorSeverity: [], errorStatus: [] }, recent: { errors: [], failedTraces: [], failedLlmCalls: [] } } }),
    getOperations: vi.fn().mockResolvedValue({ data: { window: "24h", generatedAt: "", scope: {}, range: {}, status: "ok", summary: { monitors: { total: 0, http: { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 }, heartbeat: { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 } }, alerts: { rules: { total: 0, enabled: 0 }, events: { total: 0, critical: 0, warning: 0, deliveryFailed: 0, deliveryPending: 0 } }, telemetry: { events: 0, errors: 0, traces: 0, failedTraces: 0, errorRatePercent: 0, p95TraceDurationMs: 0, lastEventAt: null, lastErrorAt: null, lastTraceAt: null }, incidents: { open: 0, investigating: 0, urgent: 0, high: 0, regressed: 0 } }, recent: { monitors: [], alerts: [], incidents: [] }, topLatency: [], setupGaps: [] } }),
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
    getSessionTimeline: vi.fn(),
    fetchFleet: vi.fn().mockRejectedValue(new Error("fleet unavailable")),
    ...overrides,
  } as unknown as ApiClient;
}

// ─── setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// ─── tests ──────────────────────────────────────────────────────────────────

describe("ConsoleShellV2", () => {
  it("renders nav rail, top bar, and health rail", async () => {
    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

    // Nav rail — landmark nav element
    expect(document.querySelector("nav.nv")).toBeInTheDocument();

    // Top bar — header element
    expect(document.querySelector("header.tb")).toBeInTheDocument();

    // Health rail — aside element
    expect(document.querySelector("aside.hr, aside.hr--collapsed")).toBeInTheDocument();

    // Overall sh-v2 wrapper
    expect(document.querySelector(".sh-v2")).toBeInTheDocument();
  });

  it("shows user initials from email in top bar avatar", async () => {
    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);
    // jane.doe@example.com → "JD"
    const avatar = await screen.findByTitle("jane.doe@example.com");
    expect(avatar.textContent).toBe("JD");
  });

  it("clicking a nav item changes the rendered section", async () => {
    const user = userEvent.setup();
    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

    // Default section is overview — OverviewScreen (v2) renders an h1 heading
    await waitFor(() => {
      expect(document.querySelector("h1.sh-h1")).toBeInTheDocument();
    });

    // Click the Settings nav item
    const settingsBtn = screen.getByTitle("Settings");
    await user.click(settingsBtn);

    // After navigation, ProjectSettingsWorkspace renders a SettingsSectionNav
    await waitFor(() => {
      expect(document.querySelector("[aria-label='Project settings sections']")).toBeInTheDocument();
    });
  });

  it("persists nav to localStorage on section change", async () => {
    const user = userEvent.setup();
    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

    await user.click(screen.getByTitle("LLM"));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("sh_v2_state") ?? "{}");
      expect(stored.nav).toBe("llm");
    });
  });

  it("restores nav from localStorage on mount", async () => {
    localStorage.setItem("sh_v2_state", JSON.stringify({ nav: "settings" }));
    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

    // Should restore to settings — ProjectSettingsWorkspace renders a SettingsSectionNav immediately
    await waitFor(() => {
      expect(document.querySelector("[aria-label='Project settings sections']")).toBeInTheDocument();
    });
  });

  it("toggling the rail updates data-rail and persists railCollapsed", async () => {
    const user = userEvent.setup();
    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

    const appEl = document.querySelector(".app");
    expect(appEl?.getAttribute("data-rail")).toBe("open");

    // The collapse button is inside the health rail
    const collapseBtn = screen.getByTitle("Collapse radar");
    await user.click(collapseBtn);

    await waitFor(() => {
      expect(appEl?.getAttribute("data-rail")).toBe("collapsed");
    });

    const stored = JSON.parse(localStorage.getItem("sh_v2_state") ?? "{}");
    expect(stored.railCollapsed).toBe(true);
  });

  it("project switch updates top bar and persists projectId", async () => {
    const user = userEvent.setup();
    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

    // Wait for projects to load and first project to appear
    await waitFor(() => {
      expect(document.querySelector(".sw-pill")).toBeInTheDocument();
    });

    // Open the project switcher pill
    const pills = document.querySelectorAll(".sw-pill");
    await user.click(pills[0]);

    // Select the second project
    const opts = document.querySelectorAll(".sw-opt");
    const stagingOpt = Array.from(opts).find((o) => o.textContent?.includes("Acme Staging"));
    await user.click(stagingOpt as HTMLElement);

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem("sh_v2_state") ?? "{}");
      expect(stored.projectId).toBe("prj_2");
    });
  });

  it("⌘K opens command palette and Escape closes it", async () => {
    const user = userEvent.setup();
    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

    // Command palette should not be visible initially
    expect(document.querySelector(".command-palette")).not.toBeInTheDocument();

    // Press ⌘K
    await user.keyboard("{Meta>}k{/Meta}");

    await waitFor(() => {
      expect(document.querySelector(".command-palette")).toBeInTheDocument();
    });

    // Press Escape
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(document.querySelector(".command-palette")).not.toBeInTheDocument();
    });
  });

  it("clicking the top bar search affordance opens the command palette", async () => {
    const user = userEvent.setup();
    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

    const searchEl = document.querySelector(".tb-search");
    await user.click(searchEl as HTMLElement);

    await waitFor(() => {
      expect(document.querySelector(".command-palette")).toBeInTheDocument();
    });
  });
});

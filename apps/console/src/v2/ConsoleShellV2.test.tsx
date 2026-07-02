import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { User } from "../api/types";
import { ConsoleShellV2 } from "./ConsoleShellV2";
import * as useIncidentModule from "./screens/useIncident";
import * as useErrorsModule from "./screens/useErrors";

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

    // After navigation, the v2 SetupScreen renders its PageHead
    await waitFor(() => {
      expect(screen.getByText(/Connect your application/i)).toBeInTheDocument();
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

    // Should restore to settings — the v2 SetupScreen renders its PageHead immediately
    await waitFor(() => {
      expect(screen.getByText(/Connect your application/i)).toBeInTheDocument();
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

  it("shows loading project hint when projects have not yet loaded", () => {
    // Client that never resolves project list — simulates initial load window
    const client = makeClient({
      listProjects: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);
    // Shell guard renders EmptyHint before project/env are available
    expect(screen.getByText(/loading project/i)).toBeInTheDocument();
  });

  describe("drill/back navigation", () => {
    const ERRORS_VM_FOR_DRILL = {
      tabs: { events: 0, errors: 1, traces: 0, llm: 0, tenants: 0, users: 0 },
      summary: { errors24h: 1, openGroups: 1, crashes: 0, critical: 1, mttr: null, topRelease: null },
      volume: [],
      rows: [
        {
          id: "g1",
          message: "TestError: drill navigation test",
          severity: "critical",
          isCrash: false,
          status: "open",
          priority: null as null,
          events: 10,
          users: null as null,
          tenants: null as null,
          last: "5m ago",
        },
      ],
    };

    const INCIDENT_VM_FOR_DRILL = {
      severity: "critical",
      severityColor: "var(--sev-critical)",
      status: "investigating",
      priority: "P1" as const,
      groupId: "g1",
      release: null,
      incidentNumber: "1",
      openedRelative: "5m ago",
      assigneeEmail: null,
      title: "TestError: drill navigation test",
      origin: "src/test.ts",
      occurrenceCount: 10,
      affectedUsers: 3,
      affectedTenants: 1,
      firstSeenRelative: "10m ago",
      lastSeenRelative: "5m ago",
      silencedUntil: null,
      stack: null,
      errorTimestamp: "2026-06-01T12:00:00.000Z",
      replay: null,
      sourceMapBadge: { resolved: false, frameCount: 0 },
      sourceMapDiagnostic: {
        status: "none" as const,
        label: "No stack trace captured",
        detail: "No stack trace was captured for this occurrence.",
        release: null,
        frameCount: 0,
        unresolvedFrameCount: 0,
      },
      breadcrumbs: [],
      related: [],
      notes: [],
    };

    function setupDrillMocks() {
      vi.spyOn(useErrorsModule, "useErrors").mockReturnValue({
        data: ERRORS_VM_FOR_DRILL,
        status: "ok",
        reload: vi.fn(),
      });
      vi.spyOn(useIncidentModule, "useIncident").mockReturnValue({
        data: INCIDENT_VM_FOR_DRILL,
        status: "ready" as const,
        reload: vi.fn(),
        resolve: vi.fn().mockResolvedValue(undefined),
        reassign: vi.fn().mockResolvedValue(undefined),
        silence: vi.fn().mockResolvedValue(undefined),
        addNote: vi.fn().mockResolvedValue(undefined),
        users: [],
        canReassign: false,
      });
    }

    it("drilling into incident renders IncidentScreen instead of section", async () => {
      setupDrillMocks();
      const user = userEvent.setup();
      render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

      // Wait for project to load
      await waitFor(() => {
        expect(screen.queryByText(/loading project/i)).not.toBeInTheDocument();
      });

      // Navigate to Investigate
      await user.click(screen.getByTitle("Investigate"));

      // Error row should be visible
      await waitFor(() => {
        const rows = screen.getAllByRole("button", { name: /TestError: drill navigation test/i });
        expect(rows.length).toBeGreaterThan(0);
      });

      // Click row to drill into incident
      const rows = screen.getAllByRole("button", { name: /TestError: drill navigation test/i });
      await user.click(rows[0]);

      // IncidentScreen should render (has a "Back" button and incident h1)
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
      });
      expect(screen.getByRole("heading", { level: 1, name: /TestError: drill navigation test/i })).toBeInTheDocument();
    });

    it("ctx.back() from IncidentScreen returns to the section", async () => {
      setupDrillMocks();
      const user = userEvent.setup();
      render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

      // Wait for project to load
      await waitFor(() => {
        expect(screen.queryByText(/loading project/i)).not.toBeInTheDocument();
      });

      // Navigate to Investigate and drill into incident
      await user.click(screen.getByTitle("Investigate"));
      await waitFor(() => {
        const rows = screen.getAllByRole("button", { name: /TestError: drill navigation test/i });
        expect(rows.length).toBeGreaterThan(0);
      });
      const rows = screen.getAllByRole("button", { name: /TestError: drill navigation test/i });
      await user.click(rows[0]);

      // Wait for IncidentScreen
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
      });

      // Click back
      await user.click(screen.getByRole("button", { name: /back/i }));

      // Should return to ErrorsScreen (the error row should reappear)
      await waitFor(() => {
        const errorRows = screen.getAllByRole("button", { name: /TestError: drill navigation test/i });
        expect(errorRows.length).toBeGreaterThan(0);
      });

      // Back button (standalone "Back" on IncidentScreen) should no longer be in document
      expect(screen.queryByRole("button", { name: /^back$/i })).not.toBeInTheDocument();
    });

    it("selecting a different NavRail section clears the detail view", async () => {
      setupDrillMocks();
      const user = userEvent.setup();
      render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

      // Wait for project to load
      await waitFor(() => {
        expect(screen.queryByText(/loading project/i)).not.toBeInTheDocument();
      });

      // Navigate to Investigate and drill into incident
      await user.click(screen.getByTitle("Investigate"));
      await waitFor(() => {
        const rows = screen.getAllByRole("button", { name: /TestError: drill navigation test/i });
        expect(rows.length).toBeGreaterThan(0);
      });
      const rows = screen.getAllByRole("button", { name: /TestError: drill navigation test/i });
      await user.click(rows[0]);

      // Verify we're in IncidentScreen
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
      });

      // Click Overview in nav rail — should clear detail and go to OverviewScreen
      await user.click(screen.getByTitle("Overview"));

      // Should be on OverviewScreen (has h1.sh-h1, no incident back button)
      await waitFor(() => {
        expect(document.querySelector("h1.sh-h1")).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: /^back$/i })).not.toBeInTheDocument();
    });

    it("switching project while detail is open clears the detail view", async () => {
      setupDrillMocks();
      const user = userEvent.setup();
      render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

      // Wait for project to load
      await waitFor(() => {
        expect(screen.queryByText(/loading project/i)).not.toBeInTheDocument();
      });

      // Navigate to Investigate and drill into incident
      await user.click(screen.getByTitle("Investigate"));
      await waitFor(() => {
        const rows = screen.getAllByRole("button", { name: /TestError: drill navigation test/i });
        expect(rows.length).toBeGreaterThan(0);
      });
      const drillRows = screen.getAllByRole("button", { name: /TestError: drill navigation test/i });
      await user.click(drillRows[0]);

      // Verify IncidentScreen is mounted
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
      });

      // Switch project via TopBar project switcher
      const pills = document.querySelectorAll(".sw-pill");
      await user.click(pills[0]);
      const opts = document.querySelectorAll(".sw-opt");
      const stagingOpt = Array.from(opts).find((o) => o.textContent?.includes("Acme Staging"));
      await user.click(stagingOpt as HTMLElement);

      // Detail should be cleared — no IncidentScreen back button
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /^back$/i })).not.toBeInTheDocument();
      });
    });

    it("clicking Create issue button in IncidentScreen shows a toast in the ToastStack", async () => {
      setupDrillMocks();
      const user = userEvent.setup();
      render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

      // Wait for project to load
      await waitFor(() => {
        expect(screen.queryByText(/loading project/i)).not.toBeInTheDocument();
      });

      // Navigate to Investigate and drill into incident
      await user.click(screen.getByTitle("Investigate"));
      await waitFor(() => {
        const rows = screen.getAllByRole("button", { name: /TestError: drill navigation test/i });
        expect(rows.length).toBeGreaterThan(0);
      });
      const drillRows = screen.getAllByRole("button", { name: /TestError: drill navigation test/i });
      await user.click(drillRows[0]);

      // Verify IncidentScreen is mounted
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
      });

      // Click Create issue — this calls ctx.pushToast which should put a toast in the stack
      await user.click(screen.getByRole("button", { name: /create issue/i }));

      // Toast should appear in the DOM via ToastStack
      await waitFor(() => {
        expect(document.querySelector(".toast__title")).toBeInTheDocument();
        expect(document.querySelector(".toast__title")?.textContent).toMatch(/github issue creation is not available yet/i);
      });
    });

    it("drilling a tenant from the LLM screen renders TenantScreen", async () => {
      const user = userEvent.setup();
      const tenant = {
        tenantId: "tenant_acme", label: "Acme Corp", traits: {}, keyTraits: {},
        isUnassigned: false, impactScore: 0, lastSeenAt: null,
        events: 0, errors: 0, openErrors: 0, severeErrors: 0, traces: 0, failedTraces: 0,
        llmCalls: 10, failedLlmCalls: 0, llmCostUsd: "5", activeUsers: 0, activeSessions: 0,
      };
      const client = makeClient({
        getLlmSummary: vi.fn().mockResolvedValue({ data: { calls: 10, failedCalls: 0, costUsd: "5", avgTokens: null, avgLatencyMs: null, p95LatencyMs: null } }),
        getLlmByTenant: vi.fn().mockResolvedValue({ data: [{ tenantId: "tenant_acme", calls: 10, failedCalls: 0, costUsd: "5", avgTokens: null, avgLatencyMs: null, p95LatencyMs: null }] }),
        getLlmByPrompt: vi.fn().mockResolvedValue({ data: [] }),
        getLlmCostByModel: vi.fn().mockResolvedValue({ data: { buckets: [], series: [] } }),
        getEntityTenantDetail: vi.fn().mockResolvedValue({ data: { window: "24h", generatedAt: "", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: "", to: "" }, tenant, topUsers: [], timeline: [] } }),
      });
      render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);

      // Navigate to the LLM section via the nav rail.
      await waitFor(() => expect(screen.getByTitle("LLM")).toBeInTheDocument());
      await user.click(screen.getByTitle("LLM"));

      // The top-tenants row appears; clicking it drills into TenantScreen.
      await waitFor(() => expect(screen.getByText("tenant_acme")).toBeInTheDocument());
      await user.click(screen.getByText("tenant_acme"));

      await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /Acme Corp/i })).toBeInTheDocument());
    });
  });
});

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { User } from "../api/types";
import { ConsoleShellV2 } from "./ConsoleShellV2";
import * as registryModule from "./screens/registry";
import type { ScreenCtx } from "./screens/registry";
import * as useIncidentModule from "./screens/useIncident";
import * as useErrorsModule from "./screens/useErrors";
import * as useUsersModule from "./screens/useUsers";
import * as useUserDetailModule from "./screens/useUserDetail";
import * as useLlmModule from "./screens/useLlm";

// ─── helpers ────────────────────────────────────────────────────────────────

const ADMIN_USER: User = { id: "usr_1", email: "jane.doe@example.com", isAdmin: true };

const PROJECT_1 = { id: "prj_1", name: "Acme Prod", createdAt: "", updatedAt: "", archivedAt: null };
const PROJECT_2 = { id: "prj_2", name: "Acme Staging", createdAt: "", updatedAt: "", archivedAt: null };
const ENV_1 = { id: "env_1", projectId: "prj_1", name: "production", createdAt: "", updatedAt: "", archivedAt: null };
const ENV_1B = { id: "env_1b", projectId: "prj_1", name: "canary", createdAt: "", updatedAt: "", archivedAt: null };
const ENV_2 = { id: "env_2", projectId: "prj_2", name: "staging", createdAt: "", updatedAt: "", archivedAt: null };

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
    getOperations: vi.fn().mockResolvedValue({ data: { window: "24h", generatedAt: "", scope: {}, range: {}, status: "ok", summary: { monitors: { total: 0, http: { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 }, heartbeat: { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 } }, alerts: { rules: { total: 0, enabled: 0 }, events: { total: 0, critical: 0, warning: 0, deliveryFailed: 0, deliveryPending: 0 } }, telemetry: { events: 0, errors: 0, traces: 0, failedTraces: 0, errorRatePercent: 0, p95TraceDurationMs: 0, lastEventAt: null, lastErrorAt: null, lastTraceAt: null }, incidents: { open: 0, investigating: 0, urgent: 0, high: 0, regressed: 0 } }, recent: { monitors: [], alerts: [], incidents: [] }, topLatency: [], anomalies: [], setupGaps: [] } }),
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
  window.history.replaceState({}, "", "/console/overview");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

// ─── tests ──────────────────────────────────────────────────────────────────

describe("ConsoleShellV2", () => {
  it("shows the mobile-status handoff instead of mounting any dense shell route at 899px", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: "(max-width: 899px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

    expect(screen.getByRole("link", { name: /open mobile status/i })).toHaveAttribute("href", "/console/status");
    expect(document.querySelector(".app")).not.toBeInTheDocument();
  });

  it("opens a canonical section URL directly", async () => {
    window.history.replaceState({}, "", "/console/traces?project_id=prj_2&environment_id=env_2");
    const listTraces = vi.fn().mockResolvedValue({ data: [] });
    const client = makeClient({
      listTraces,
      listEnvironments: vi.fn((projectId: string) => Promise.resolve({
        environments: projectId === "prj_2" ? [ENV_2] : [ENV_1],
      })),
    });

    render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);

    expect(await screen.findByRole("heading", { name: "Traces" }, { timeout: 5_000 })).toBeInTheDocument();
    await waitFor(() => expect(listTraces).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "prj_2",
      environmentId: "env_2",
    })));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("sh_v2_state") ?? "{}")).toMatchObject({
      projectId: "prj_2",
      environmentId: "env_2",
    }));
  });

  it("replaces an invalid route with the scoped overview fallback", async () => {
    window.history.replaceState({}, "", "/console/not-real?project_id=prj_1&environment_id=env_1");

    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

    expect(await screen.findByRole("heading", { name: "Operations" }, { timeout: 5_000 })).toBeInTheDocument();
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/console/overview?project_id=prj_1&environment_id=env_1",
    ));
  });

  it("pushes canonical scoped section URLs and restores them with browser back and forward", async () => {
    const user = userEvent.setup();
    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);
    await screen.findByRole("heading", { name: "Operations" });

    await user.click(screen.getByTitle("Settings"));
    await waitFor(() => expect(window.location.pathname).toBe("/console/settings"));
    expect(window.location.search).toBe("?project_id=prj_1&environment_id=env_1");

    await user.click(screen.getByTitle("Traces"));
    await waitFor(() => expect(window.location.pathname).toBe("/console/traces"));

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/console/settings"));
    expect(await screen.findByRole("heading", { name: "Setup" })).toBeInTheDocument();

    window.history.forward();
    await waitFor(() => expect(window.location.pathname).toBe("/console/traces"));
    expect(await screen.findByRole("heading", { name: "Traces" })).toBeInTheDocument();
  });

  it("restores scoped project and environment from popstate", async () => {
    const listTraces = vi.fn().mockResolvedValue({ data: [] });
    const client = makeClient({
      listTraces,
      listEnvironments: vi.fn((projectId: string) => Promise.resolve({
        environments: projectId === "prj_2" ? [ENV_2] : [ENV_1],
      })),
    });
    render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);
    await screen.findByRole("heading", { name: "Operations" });

    window.history.pushState({}, "", "/console/traces?project_id=prj_2&environment_id=env_2");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(await screen.findByRole("heading", { name: "Traces" })).toBeInTheDocument();
    await waitFor(() => expect(listTraces).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "prj_2",
      environmentId: "env_2",
    })));
  });

  it("onboards an empty installation by creating its first project and environment", async () => {
    const project = { ...PROJECT_1, name: "First app" };
    const environment = { ...ENV_1, name: "production" };
    const client = makeClient({
      listProjects: vi.fn()
        .mockResolvedValueOnce({ projects: [] })
        .mockResolvedValue({ projects: [project] }),
      listEnvironments: vi.fn().mockResolvedValue({ environments: [environment] }),
      createProject: vi.fn().mockResolvedValue({ project }),
      createEnvironment: vi.fn().mockResolvedValue({ environment }),
    });
    const user = userEvent.setup();

    render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);

    expect(await screen.findByRole("heading", { name: "Create your first project" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Project name"), "First app");
    await user.clear(screen.getByLabelText("Environment name"));
    await user.type(screen.getByLabelText("Environment name"), "production");
    await user.click(screen.getByRole("button", { name: "Create project and environment" }));

    await waitFor(() => expect(client.createProject).toHaveBeenCalledWith({ name: "First app" }));
    expect(client.createEnvironment).toHaveBeenCalledWith("prj_1", { name: "production" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Create your first project" })).not.toBeInTheDocument());
    expect((await screen.findAllByText("First app")).length).toBeGreaterThan(0);
  });

  it("shows a retryable error instead of onboarding when projects fail to load", async () => {
    const listProjects = vi.fn().mockRejectedValue(new Error("offline"));

    render(<ConsoleShellV2 client={makeClient({ listProjects })} user={ADMIN_USER} />);

    expect(await screen.findByText("Could not load projects")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create your first project" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry loading projects" })).toBeInTheDocument();
  });

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

  it("mints an API key through the real shell wrapper and reveals the one-time secret (PER-467 regression)", async () => {
    // Exercises ConsoleShellV2's real onSecretCreated/createdSecret wiring
    // end to end, not a replica of it: a wrapper that drops `kind` fails
    // tsc, but one that hardcodes the wrong kind still type-checks — only a
    // test that mints a secret through the real shell can catch that.
    const secret = "sh_live_shell_secret_value";
    const user = userEvent.setup();
    const client = makeClient({
      createApiKey: vi.fn().mockResolvedValue({
        apiKey: { id: "key_1", projectId: "prj_1", environmentId: "env_1", name: "console-production", prefix: "sh_live_ab", capability: "browser", createdAt: "x", revokedAt: null, secret },
      }),
    });

    render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);
    await screen.findByRole("heading", { name: "Operations" });

    await user.click(screen.getByTitle("Settings"));
    await screen.findByRole("heading", { name: "Setup" });

    await user.click(await screen.findByRole("button", { name: /Generate API key/ }));
    await waitFor(() => expect(client.createApiKey).toHaveBeenCalled());

    await user.click(await screen.findByTitle("Reveal"));
    expect(await screen.findByText(secret)).toBeInTheDocument();
  });

  it("keeps a settings-created server key out of Setup's browser snippet", async () => {
    const secret = "sh_live_server_secret_must_not_reach_browser";
    const user = userEvent.setup();
    const client = makeClient({
      createApiKey: vi.fn().mockResolvedValue({
        apiKey: { id: "key_server", projectId: "prj_1", environmentId: "env_1", name: "backend-identify", prefix: "sh_live_server", capability: "server", createdAt: "x", revokedAt: null, secret },
      }),
    });

    render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);
    await user.click(await screen.findByTitle("Settings"));
    await screen.findByRole("heading", { name: "Setup" });
    await user.click(await screen.findByRole("button", { name: "New API key" }));
    await user.type(screen.getByLabelText("API key name"), "backend-identify");
    await user.selectOptions(screen.getByLabelText("API key capability"), "server");
    await user.click(screen.getByRole("button", { name: "Create API key" }));

    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledWith("prj_1", {
      environmentId: "env_1",
      name: "backend-identify",
      capability: "server",
    }));
    expect(await screen.findByText("Server API key created")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(secret);
    await user.click(screen.getByTitle("Reveal"));
    expect(await screen.findByText(secret)).toBeInTheDocument();
  });

  it("keeps a minted secret alive across a same-scope reload when the active environment is not first in the list", async () => {
    // useConsoleProjects settles the active environment on loaded[0] after
    // every ctx.reload() (a real, separately-filed pre-existing bug — not
    // fixed here). The secret's own lifetime must not depend on that: it
    // must survive regardless of where the active environment sits in the
    // list, or which id the reload happens to settle on afterward.
    const secret = "sh_live_shell_secret_value_2";
    const user = userEvent.setup();
    const client = makeClient({
      listEnvironments: vi.fn().mockResolvedValue({ environments: [ENV_1, ENV_1B] }),
      createApiKey: vi.fn().mockResolvedValue({
        apiKey: { id: "key_2", projectId: "prj_1", environmentId: "env_1b", name: "console-canary", prefix: "sh_live_cd", capability: "browser", createdAt: "x", revokedAt: null, secret },
      }),
    });

    const { container } = render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);
    await screen.findByRole("heading", { name: "Operations" });

    // Explicitly switch to the second (non-first) environment before minting.
    await user.click(container.querySelectorAll(".sw-pill")[1]);
    await user.click(container.querySelectorAll(".sw-opt")[1] as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll(".sw-pill")[1]?.textContent).toContain("canary"));

    await user.click(screen.getByTitle("Settings"));
    await screen.findByRole("heading", { name: "Setup" });

    await user.click(await screen.findByRole("button", { name: /Generate API key/ }));
    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledWith("prj_1", { environmentId: "env_1b", name: "console-canary", capability: "browser" }));

    await user.click(await screen.findByTitle("Reveal"));
    expect(await screen.findByText(secret)).toBeInTheDocument();
  });

  it("clears the secret on a genuine environment switch, even when the previous environment was not first in the list", async () => {
    const secret = "sh_live_shell_secret_value_3";
    const user = userEvent.setup();
    const client = makeClient({
      listEnvironments: vi.fn().mockResolvedValue({ environments: [ENV_1, ENV_1B] }),
      createApiKey: vi.fn().mockResolvedValue({
        apiKey: { id: "key_3", projectId: "prj_1", environmentId: "env_1b", name: "console-canary", prefix: "sh_live_ef", capability: "browser", createdAt: "x", revokedAt: null, secret },
      }),
    });

    const { container } = render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);
    await screen.findByRole("heading", { name: "Operations" });

    await user.click(container.querySelectorAll(".sw-pill")[1]);
    await user.click(container.querySelectorAll(".sw-opt")[1] as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll(".sw-pill")[1]?.textContent).toContain("canary"));

    await user.click(screen.getByTitle("Settings"));
    await screen.findByRole("heading", { name: "Setup" });
    await user.click(await screen.findByRole("button", { name: /Generate API key/ }));
    await waitFor(() => expect(client.createApiKey).toHaveBeenCalled());
    await screen.findByTitle("Reveal");

    // Pick whichever environment isn't currently shown as active — a
    // genuine operator-initiated switch regardless of which id the
    // reload settled the shell on in the meantime.
    await waitFor(() => expect(container.querySelectorAll(".sw-pill")[1]?.textContent).toMatch(/production|canary/));
    const currentlyActiveIndex = container.querySelectorAll(".sw-pill")[1]?.textContent?.includes("canary") ? 1 : 0;
    const targetIndex = currentlyActiveIndex === 0 ? 1 : 0;

    await user.click(container.querySelectorAll(".sw-pill")[1]);
    await user.click(container.querySelectorAll(".sw-opt")[targetIndex] as HTMLElement);

    await waitFor(() => expect(screen.queryByTitle("Reveal")).not.toBeInTheDocument());
    expect(await screen.findByRole("button", { name: /Generate API key/ })).toBeInTheDocument();
  });

  it("does not carry a minted secret across a popstate-driven scope change", async () => {
    // Browser Back moves the active project and environment without touching
    // any of the shell's selection handlers: handlePopState only writes
    // desiredScope, and the restore effects steer the scope from there. The
    // secret must be confined all the same.
    const secret = "sh_live_shell_secret_value_4";
    const user = userEvent.setup();
    const client = makeClient({
      listEnvironments: vi.fn((projectId: string) => Promise.resolve({
        environments: projectId === "prj_2" ? [ENV_2] : [ENV_1],
      })),
      createApiKey: vi.fn().mockResolvedValue({
        apiKey: { id: "key_4", projectId: "prj_2", environmentId: "env_2", name: "console-staging", prefix: "sh_live_gh", capability: "browser", createdAt: "x", revokedAt: null, secret },
      }),
    });

    const { container } = render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);
    await screen.findByRole("heading", { name: "Operations" });
    await waitFor(() => expect(window.location.search).toBe("?project_id=prj_1&environment_id=env_1"));

    // Leave a prj_1 history entry behind (nav is the shell's only pushState;
    // scope switches replaceState), then switch project and mint there.
    await user.click(screen.getByTitle("Settings"));
    await screen.findByRole("heading", { name: "Setup" });

    await user.click(container.querySelectorAll(".sw-pill")[0]);
    await user.click(Array.from(container.querySelectorAll(".sw-opt"))
      .find((option) => option.textContent?.includes("Acme Staging")) as HTMLElement);
    await waitFor(() => expect(window.location.search).toBe("?project_id=prj_2&environment_id=env_2"));

    await user.click(await screen.findByRole("button", { name: /Generate API key/ }));
    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledWith("prj_2", { environmentId: "env_2", name: "console-staging", capability: "browser" }));
    await screen.findByTitle("Reveal");

    window.history.back();

    // The Operations heading only renders once the restore has settled the
    // shell back on prj_1 (an unsettled scope renders the loading state).
    await screen.findByRole("heading", { name: "Operations" });
    await waitFor(() => expect(window.location.search).toBe("?project_id=prj_1&environment_id=env_1"));

    await user.click(screen.getByTitle("Settings"));
    await screen.findByRole("heading", { name: "Setup" });
    expect(screen.queryByTitle("Reveal")).not.toBeInTheDocument();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Generate API key/ })).toBeInTheDocument();
    expect(window.location.search).toBe("?project_id=prj_1&environment_id=env_1");
  });

  it("does not carry a minted secret onto an environment created through ctx.onCreateEnvironment", async () => {
    // handleCreateEnvironment selects the environment it just created — a
    // genuine environment switch that goes through none of the four
    // selection handlers. The created environment is already in the
    // listEnvironments fixture so that selectEnvironment(created.id) lands
    // (it only selects environments the hook has loaded).
    const secret = "sh_live_shell_secret_value_5";
    const user = userEvent.setup();
    const client = makeClient({
      listEnvironments: vi.fn().mockResolvedValue({ environments: [ENV_1, ENV_1B] }),
      createEnvironment: vi.fn().mockResolvedValue({ environment: ENV_1B }),
      createApiKey: vi.fn().mockResolvedValue({
        apiKey: { id: "key_5", projectId: "prj_1", environmentId: "env_1", name: "console-production", prefix: "sh_live_ij", capability: "browser", createdAt: "x", revokedAt: null, secret },
      }),
    });

    // No screen calls ctx.onCreateEnvironment today, so reach it through the
    // real ScreenCtx the shell hands the real screens.
    const captured: { ctx: ScreenCtx | null } = { ctx: null };
    const realRenderSection = registryModule.renderSection;
    vi.spyOn(registryModule, "renderSection").mockImplementation((section, ctx) => {
      captured.ctx = ctx;
      return realRenderSection(section, ctx);
    });

    render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);
    await screen.findByRole("heading", { name: "Operations" });

    await user.click(screen.getByTitle("Settings"));
    await screen.findByRole("heading", { name: "Setup" });
    await user.click(await screen.findByRole("button", { name: /Generate API key/ }));
    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledWith("prj_1", { environmentId: "env_1", name: "console-production", capability: "browser" }));
    await screen.findByTitle("Reveal");

    await act(async () => { await captured.ctx?.onCreateEnvironment("canary"); });

    await waitFor(() => expect(screen.queryByTitle("Reveal")).not.toBeInTheDocument());
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Generate API key/ })).toBeInTheDocument();
  });

  it("does not carry a minted secret onto the scope the shell settles on after the active environment is archived", async () => {
    // Archiving the active environment changes the scope through no handler
    // at all: the screen's own mutation calls ctx.reload(), the environment
    // list comes back without it, and useConsoleProjects settles on whatever
    // is left. Confinement has to hold there too.
    const secret = "sh_live_shell_secret_value_6";
    const user = userEvent.setup();
    let listed = [ENV_1, ENV_1B];
    const client = makeClient({
      listEnvironments: vi.fn(() => Promise.resolve({ environments: listed })),
      archiveEnvironment: vi.fn(async () => { listed = [ENV_1]; }),
      createApiKey: vi.fn().mockResolvedValue({
        apiKey: { id: "key_6", projectId: "prj_1", environmentId: "env_1b", name: "console-canary", prefix: "sh_live_kl", capability: "browser", createdAt: "x", revokedAt: null, secret },
      }),
    });

    const { container } = render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);
    await screen.findByRole("heading", { name: "Operations" });

    await user.click(container.querySelectorAll(".sw-pill")[1]);
    await user.click(container.querySelectorAll(".sw-opt")[1] as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll(".sw-pill")[1]?.textContent).toContain("canary"));

    await user.click(screen.getByTitle("Settings"));
    await screen.findByRole("heading", { name: "Setup" });
    await user.click(await screen.findByRole("button", { name: /Generate API key/ }));
    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledWith("prj_1", { environmentId: "env_1b", name: "console-canary", capability: "browser" }));
    await screen.findByTitle("Reveal");

    await user.click(await screen.findByRole("button", { name: "Archive canary" }));
    await user.click(await screen.findByRole("button", { name: "Confirm archive canary" }));
    await waitFor(() => expect(client.archiveEnvironment).toHaveBeenCalledWith("env_1b"));

    // Wait for the shell to settle on what is left before asserting: the
    // reload unmounts the screen for a moment, so "no Reveal on screen" is
    // true transiently no matter what the shell decides about the secret.
    await waitFor(() => expect(container.querySelectorAll(".sw-pill")[1]?.textContent).toContain("production"));
    await screen.findByRole("heading", { name: "Setup" });
    expect(await screen.findByRole("button", { name: /Generate API key/ })).toBeInTheDocument();
    expect(screen.queryByTitle("Reveal")).not.toBeInTheDocument();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
  });

  it("does not make a minted secret readable again when the operator returns to the scope it was minted in", async () => {
    // Moving away is a one-way door: the shell retires the value once it has
    // settled somewhere else, so coming back cannot re-reveal it.
    const secret = "sh_live_shell_secret_value_7";
    const user = userEvent.setup();
    const client = makeClient({
      listEnvironments: vi.fn().mockResolvedValue({ environments: [ENV_1, ENV_1B] }),
      createApiKey: vi.fn().mockResolvedValue({
        apiKey: { id: "key_7", projectId: "prj_1", environmentId: "env_1", name: "console-production", prefix: "sh_live_mn", capability: "browser", createdAt: "x", revokedAt: null, secret },
      }),
    });

    const { container } = render(<ConsoleShellV2 client={client} user={ADMIN_USER} />);
    await screen.findByRole("heading", { name: "Operations" });

    await user.click(screen.getByTitle("Settings"));
    await screen.findByRole("heading", { name: "Setup" });
    await user.click(await screen.findByRole("button", { name: /Generate API key/ }));
    await waitFor(() => expect(client.createApiKey).toHaveBeenCalledWith("prj_1", { environmentId: "env_1", name: "console-production", capability: "browser" }));
    await screen.findByTitle("Reveal");

    await user.click(container.querySelectorAll(".sw-pill")[1]);
    await user.click(container.querySelectorAll(".sw-opt")[1] as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll(".sw-pill")[1]?.textContent).toContain("canary"));

    await user.click(container.querySelectorAll(".sw-pill")[1]);
    await user.click(container.querySelectorAll(".sw-opt")[0] as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll(".sw-pill")[1]?.textContent).toContain("production"));

    await screen.findByRole("heading", { name: "Setup" });
    expect(await screen.findByRole("button", { name: /Generate API key/ })).toBeInTheDocument();
    expect(screen.queryByTitle("Reveal")).not.toBeInTheDocument();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
  });

  it("refreshes fleet core and every expanded project's environment health", async () => {
    const fetchFleet = vi.fn().mockResolvedValue({
      data: {
        window: "24h",
        generatedAt: "2026-07-30T00:00:00.000Z",
        projects: [{
          id: "prj_1",
          name: "Acme Prod",
          status: "ok",
          incidents: 0,
          alerts: 0,
          errorRatePercent: 0,
          errorRateDelta: null,
          errorTrend: [],
          events: 1,
          activeUsers: 0,
          activeTenants: 0,
          llmCostUsd: "0.00",
          llmCostDeltaUsd: null,
          p95TraceDurationMs: null,
          p95DeltaMs: null,
          infra: { api: "ok", db: "ok", redis: "ok", queue: "ok" },
          topIncident: null,
        }, {
          id: "prj_2",
          name: "Acme Staging",
          status: "ok",
          incidents: 0,
          alerts: 0,
          errorRatePercent: 0,
          errorRateDelta: null,
          errorTrend: [],
          events: 1,
          activeUsers: 0,
          activeTenants: 0,
          llmCostUsd: "0.00",
          llmCostDeltaUsd: null,
          p95TraceDurationMs: null,
          p95DeltaMs: null,
          infra: { api: "ok", db: "ok", redis: "ok", queue: "ok" },
          topIncident: null,
        }],
        rollup: {
          counts: { ok: 2, warning: 0, critical: 0 },
          incidents: 0,
          alerts: 0,
          llmCostUsd: "0.00",
          overall: "ok",
          total: 2,
        },
      },
    });
    const fetchFleetProjectEnvironments = vi.fn().mockImplementation((projectId: string) => Promise.resolve({
      data: {
        projectId,
        envs: [{ name: "production", status: "ok", incidents: 0, errorRatePercent: 0, events: 1, note: null }],
      },
    }));
    const user = userEvent.setup();
    render(<ConsoleShellV2 client={makeClient({ fetchFleet, fetchFleetProjectEnvironments })} user={ADMIN_USER} />);

    const expandButtons = await screen.findAllByRole("button", { name: "Expand environments" });
    await user.click(expandButtons[0]!);
    await user.click(expandButtons[1]!);
    await waitFor(() => expect(fetchFleetProjectEnvironments).toHaveBeenCalledTimes(2));
    await user.click(screen.getByTitle("Refresh now"));

    await waitFor(() => expect(fetchFleet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fetchFleetProjectEnvironments).toHaveBeenCalledTimes(4));
    expect(fetchFleetProjectEnvironments).toHaveBeenCalledWith("prj_1", { window: "24h" });
    expect(fetchFleetProjectEnvironments).toHaveBeenCalledWith("prj_2", { window: "24h" });
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
    window.history.replaceState(null, "", "/console");
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
    render(<ConsoleShellV2 client={makeClient({
      listEnvironments: vi.fn((projectId: string) => Promise.resolve({
        environments: projectId === "prj_2" ? [ENV_2] : [ENV_1],
      })),
    })} user={ADMIN_USER} />);

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
    await waitFor(() => expect(window.location.search).toBe("?project_id=prj_2&environment_id=env_2"));
  });

  it("keeps the canonical URL scope current when the environment changes", async () => {
    const preview = { ...ENV_1, id: "env_preview", name: "preview" };
    const user = userEvent.setup();
    render(<ConsoleShellV2 client={makeClient({
      listEnvironments: vi.fn().mockResolvedValue({ environments: [ENV_1, preview] }),
    })} user={ADMIN_USER} />);

    await waitFor(() => expect(document.querySelectorAll(".sw-pill")).toHaveLength(2));
    await user.click(document.querySelectorAll(".sw-pill")[1] as HTMLElement);
    const previewOption = Array.from(document.querySelectorAll(".sw-opt"))
      .find((option) => option.textContent?.includes("preview"));
    await user.click(previewOption as HTMLElement);

    await waitFor(() => expect(window.location.search).toBe("?project_id=prj_1&environment_id=env_preview"));
  });

  it("restores the persisted environment by id instead of duplicate names", async () => {
    window.history.replaceState(null, "", "/console");
    const envA = { id: "env_1", projectId: "prj_1", name: "production", createdAt: "", updatedAt: "", archivedAt: null };
    const envB = { id: "env_2", projectId: "prj_1", name: "production", createdAt: "", updatedAt: "", archivedAt: null };
    localStorage.setItem("sh_v2_state", JSON.stringify({ projectId: "prj_1", environmentId: "env_2" }));
    const getOverview = vi.fn().mockResolvedValue({
      data: {
        window: "24h",
        generatedAt: "",
        scope: {},
        range: {},
        kpis: { events: 0, activeUsers: 0, activeTenants: 0, errors: 0, openErrors: 0, traces: 0, failedTraces: 0, llmCalls: 0, failedLlmCalls: 0, llmInputTokens: 0, llmOutputTokens: 0, llmCostUsd: "0" },
        trends: { usage: [], errors: [], latency: [], aiCost: [] },
        top: { events: [], tenantsByUsage: [], tenantsByErrors: [], tenantsByLlmCalls: [], tenantsByLlmCost: [], llmProviders: [], llmModels: [], llmPrompts: [], errorSeverity: [], errorStatus: [] },
        recent: { errors: [], failedTraces: [], failedLlmCalls: [] }
      }
    });
    render(
      <ConsoleShellV2
        client={makeClient({
          getOverview,
          listEnvironments: vi.fn().mockResolvedValue({ environments: [envA, envB] })
        })}
        user={ADMIN_USER}
      />
    );

    await waitFor(() => {
      expect(getOverview).toHaveBeenCalledWith(expect.objectContaining({ environmentId: "env_2" }));
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
    expect(screen.getByRole("button", { name: "Open Operations" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Overview" })).not.toBeInTheDocument();

    // Press Escape
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(document.querySelector(".command-palette")).not.toBeInTheDocument();
    });
  });

  it("uses Operations in the default project breadcrumb", async () => {
    render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

    await waitFor(() => expect(document.querySelector(".bc")).toHaveTextContent("Operations"));
    expect(document.querySelector(".bc")).not.toHaveTextContent("Overview");
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
          trend: [],
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
      externalIssues: [],
      codeContext: {
        status: "limited" as const,
        summary: "No code context available.",
        repository: null,
        release: {
          release: null,
          commitSha: null,
          commitUrl: null,
          pullRequestNumber: null,
          pullRequestUrl: null,
          deployedBy: null,
        },
        suspectedFiles: [],
        evidence: [],
        suggestedNextSteps: [],
        privacy: {
          aiEnabled: false,
          outboundCodeSharing: false,
          reason: "Local deterministic analysis only.",
        },
      },
      primaryOccurrenceId: "err_1",
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
        setPriority: vi.fn().mockResolvedValue(undefined),
        setStatus: vi.fn().mockResolvedValue(undefined),
        reassign: vi.fn().mockResolvedValue(undefined),
        silence: vi.fn().mockResolvedValue(undefined),
        addNote: vi.fn().mockResolvedValue(undefined),
        users: [],
        canReassign: false,
        occurrences: [],
        occurrencesStatus: "ready" as const,
        occurrencesCursor: undefined,
        loadMoreOccurrences: vi.fn().mockResolvedValue(undefined),
        retryOccurrences: vi.fn(),
      });
    }

    it("opens the legacy incident URL directly and returns to Incidents safely", async () => {
      setupDrillMocks();
      const user = userEvent.setup();
      window.history.replaceState({}, "", "/console/incidents/error-groups/g1?project_id=prj_1&environment_id=env_1&error_id=err_1");

      render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

      expect(await screen.findByRole("heading", { level: 1, name: /TestError: drill navigation test/i })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^back$/i }));

      expect(await screen.findByRole("heading", { name: "Incidents" })).toBeInTheDocument();
      expect(`${window.location.pathname}${window.location.search}`).toBe(
        "/console/incidents?project_id=prj_1&environment_id=env_1",
      );
    });

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

      expect(`${window.location.pathname}${window.location.search}`).toBe(
        "/console/incidents/error-groups/g1?project_id=prj_1&environment_id=env_1",
      );

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

      window.history.back();
      await waitFor(() => expect(window.location.pathname).toBe("/console/overview"));
      expect(await screen.findByRole("heading", { name: "Operations" })).toBeInTheDocument();
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

      // Click Operations in nav rail — should clear detail and go to the operational home
      await user.click(screen.getByTitle("Operations"));

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

      // Click Create issue without code integration support — this calls ctx.pushToast.
      await user.click(screen.getByRole("button", { name: /create issue/i }));

      // Toast should appear in the DOM via ToastStack
      await waitFor(() => {
        expect(document.querySelector(".toast__title")).toBeInTheDocument();
        expect(document.querySelector(".toast__title")?.textContent).toMatch(/code integrations are not available/i);
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

    it("opens a tenant URL directly and returns to Entities safely", async () => {
      const tenant = {
        tenantId: "tenant_acme", label: "Acme Corp", traits: {}, keyTraits: {},
        isUnassigned: false, impactScore: 0, lastSeenAt: null,
        events: 0, errors: 0, openErrors: 0, severeErrors: 0, traces: 0, failedTraces: 0,
        llmCalls: 0, failedLlmCalls: 0, llmCostUsd: "0", activeUsers: 0, activeSessions: 0,
      };
      const user = userEvent.setup();
      window.history.replaceState({}, "", "/console/entities/tenants/tenant_acme?project_id=prj_1&environment_id=env_1");
      render(<ConsoleShellV2 client={makeClient({
        getEntityTenantDetail: vi.fn().mockResolvedValue({
          data: {
            window: "24h", generatedAt: "", scope: { projectId: "prj_1", environmentId: "env_1" },
            range: { from: "", to: "" }, tenant, topUsers: [], timeline: [],
          },
        }),
      })} user={ADMIN_USER} />);

      expect(await screen.findByRole("heading", { level: 1, name: "Acme Corp" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /^back$/i }));

      expect(await screen.findByRole("heading", { name: "Tenants" })).toBeInTheDocument();
      expect(`${window.location.pathname}${window.location.search}`).toBe(
        "/console/entities?project_id=prj_1&environment_id=env_1",
      );
    });
  });

  describe("pendingFilters (navigate with payload)", () => {
    function setupUsersDrillMocks() {
      vi.spyOn(useUsersModule, "useUsers").mockReturnValue({
        data: {
          hasMore: false,
          rows: [
            {
              key: "user_1", userId: "user_1", label: "User One", isAnonymous: false,
              impactScore: 10, events: 1, errors: 0, failedTraces: 0, llmCalls: 1, llmCostUsd: 0,
              activeTenants: 1, activeSessions: 1, lastSeenAt: null, lastSeenLabel: "—", keyTraits: {},
            },
          ],
        },
        status: "ok",
        reload: vi.fn(),
        loadMore: vi.fn(),
        loadingMore: false,
      });
      vi.spyOn(useUserDetailModule, "useUserDetail").mockReturnValue({
        data: {
          window: "7d", generatedAt: "", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: "", to: "" },
          user: {
            userId: "user_1", label: "User One", traits: {}, keyTraits: {}, isAnonymous: false, impactScore: 10,
            firstSeenAt: null, lastSeenAt: null, profileUpdatedAt: null, events: 1, errors: 0, openErrors: 0,
            severeErrors: 0, traces: 0, failedTraces: 0, llmCalls: 1, failedLlmCalls: 0, llmCostUsd: "0",
            activeTenants: 1, activeSessions: 1,
          },
          recentSessions: [],
          timeline: [
            {
              type: "llm", id: "ll1", timestamp: "2026-06-23T12:00:00.000Z", label: "greet_call",
              tenantId: "tenant_acme", sessionId: null, traceId: null, provider: "openai", model: "gpt-5",
              promptName: "greet", status: "success", costUsd: "0.01",
            },
          ],
        },
        status: "ok",
        loadingMore: false,
        loadMoreError: false,
        loadMore: vi.fn(),
        reload: vi.fn(),
      });
    }

    const LLM_VM = {
      window: "24h" as const,
      kpis: { calls: 0, costUsd: 0, runRateUsd: 0, avgLatencyMs: null, p95LatencyMs: null, errorRate: 0 },
      costByModel: { buckets: [], series: [] },
      tenants: [],
      prompts: [],
      recentCalls: [],
    };

    it("navigating from a Users timeline row seeds the target section's filters, and a plain nav click clears them", async () => {
      setupUsersDrillMocks();
      const useLlmSpy = vi.spyOn(useLlmModule, "useLlm").mockReturnValue({ data: LLM_VM, status: "ok", reload: vi.fn() });
      const user = userEvent.setup();
      render(<ConsoleShellV2 client={makeClient()} user={ADMIN_USER} />);

      await waitFor(() => expect(screen.queryByText(/loading project/i)).not.toBeInTheDocument());

      // Navigate to Users, select the row, and click its llm timeline entry.
      await user.click(screen.getByTitle("Users"));
      await waitFor(() => expect(screen.getByText("User One")).toBeInTheDocument());
      await user.click(screen.getByText("User One"));
      await waitFor(() => expect(screen.getByText("greet_call")).toBeInTheDocument());
      await user.click(screen.getByText("greet_call"));

      // Landed on the LLM screen with the seeded filters forwarded to useLlm.
      await waitFor(() =>
        expect(useLlmSpy).toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: "tenant_acme", userId: "user_1", provider: "openai", model: "gpt-5", promptName: "greet", status: "success" })
        )
      );

      // A plain nav-rail click (no payload) to the same section clears the seed.
      await user.click(screen.getByTitle("LLM"));
      await waitFor(() =>
        expect(useLlmSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ tenantId: undefined, userId: undefined, provider: undefined, model: undefined, promptName: undefined, status: undefined })
        )
      );
    });
  });
});

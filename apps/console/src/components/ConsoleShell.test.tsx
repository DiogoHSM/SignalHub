import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { CreatedApiKey, Environment, OverviewResponse, SystemHealthResponse } from "../api/types";
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
    getOverview: vi.fn(),
    getSystemHealth: vi.fn(),
    listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [] } }),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [] } }),
    getUserDetail: vi.fn().mockResolvedValue({ data: { window: "7d", generatedAt: "2026-05-05T12:00:00.000Z", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" }, user: { userId: "user_1", label: "user_1", isAnonymous: false, impactScore: 0, lastSeenAt: null, events: 0, errors: 0, openErrors: 0, severeErrors: 0, traces: 0, failedTraces: 0, llmCalls: 0, failedLlmCalls: 0, llmCostUsd: "0", activeTenants: 0, activeSessions: 0 }, recentSessions: [], timeline: [] } }),
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
    getSessionTimeline: vi.fn().mockResolvedValue({ data: { sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } } }),
    listSourceMapArtifacts: vi.fn().mockResolvedValue([]),
    uploadSourceMap: vi.fn(),
    uploadSourceMapBundle: vi.fn(),
    deleteSourceMapArtifact: vi.fn(),
    getErrorSourceMapResolution: vi.fn(),
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

function overviewResponse(overrides: Partial<OverviewResponse> = {}): OverviewResponse {
  return {
    window: "24h",
    generatedAt: "2026-05-05T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: {
      from: "2026-05-04T12:00:00.000Z",
      to: "2026-05-05T12:00:00.000Z",
      bucket: "hour"
    },
    kpis: {
      events: 18,
      activeUsers: 4,
      activeTenants: 2,
      errors: 3,
      openErrors: 1,
      traces: 7,
      failedTraces: 1,
      averageTraceDurationMs: 250,
      p95TraceDurationMs: 400,
      llmCalls: 5,
      failedLlmCalls: 1,
      llmInputTokens: 1200,
      llmOutputTokens: 800,
      llmCostUsd: "1.250000"
    },
    trends: {
      usage: [{ bucketStart: "2026-05-05T12:00:00.000Z", events: 18, traces: 7, llmCalls: 5 }],
      errors: [{ bucketStart: "2026-05-05T12:00:00.000Z", errors: 3, openErrors: 1, severeErrors: 1 }],
      latency: [{ bucketStart: "2026-05-05T12:00:00.000Z", averageTraceDurationMs: 250, p95TraceDurationMs: 400 }],
      aiCost: [{ bucketStart: "2026-05-05T12:00:00.000Z", llmCostUsd: "1.250000", llmCalls: 5 }]
    },
    top: {
      events: [{ name: "dashboard_created", total: 8 }],
      tenantsByUsage: [{ tenantId: "tenant_1", total: 10 }],
      tenantsByErrors: [{ tenantId: "tenant_1", total: 2 }],
      tenantsByLlmCalls: [{ tenantId: "tenant_1", total: 5 }],
      tenantsByLlmCost: [{ tenantId: "tenant_1", totalCostUsd: "1.250000" }],
      llmProviders: [{ provider: "openai", total: 5, totalCostUsd: "1.250000" }],
      llmModels: [{ model: "gpt-5", total: 5, totalCostUsd: "1.250000" }],
      llmPrompts: [{ promptName: "summarize_signal", total: 3, totalCostUsd: "0.750000" }],
      errorSeverity: [{ severity: "critical", total: 1 }],
      errorStatus: [{ status: "open", total: 1 }]
    },
    recent: {
      errors: [
        {
          id: "err_1",
          timestamp: "2026-05-05T12:00:00.000Z",
          message: "Checkout fetch failed",
          type: "TypeError",
          severity: "critical",
          status: "open",
          tenantId: "tenant_1",
          userId: "user_1",
          traceId: "trace_1"
        }
      ],
      failedTraces: [
        {
          id: "trc_1",
          timestamp: "2026-05-05T12:00:00.000Z",
          name: "checkout",
          status: "error",
          durationMs: 500,
          tenantId: "tenant_1",
          userId: "user_1"
        }
      ],
      failedLlmCalls: [
        {
          id: "llm_1",
          timestamp: "2026-05-05T12:00:00.000Z",
          provider: "openai",
          model: "gpt-5",
          promptName: "summarize_signal",
          status: "error",
          costUsd: "0.250000",
          tenantId: "tenant_1",
          userId: "user_1",
          traceId: "trace_1"
        }
      ]
    },
    ...overrides
  };
}

function systemHealthResponse(overrides: Partial<SystemHealthResponse> = {}): SystemHealthResponse {
  return {
    generatedAt: "2026-05-06T12:00:00.000Z",
    status: "healthy",
    services: {
      api: { status: "healthy", uptimeSeconds: 120 },
      postgres: { status: "healthy", latencyMs: 4 },
      redis: { status: "healthy", latencyMs: 2 },
      worker: { status: "healthy", lastHeartbeatAt: "2026-05-06T11:59:55.000Z" }
    },
    queues: { telemetry: { status: "healthy", errorMessage: null, waiting: 0, active: 0, completed: 4, failed: 0, delayed: 0 } },
    ingestion: {
      lastEventAt: null,
      lastErrorAt: null,
      lastTraceAt: null,
      lastSpanAt: null,
      lastLlmCallAt: null
    },
    retention: {
      enabled: true,
      intervalMinutes: 60,
      lastRun: null,
      policy: {
        eventsDays: 90,
        errorsDays: 180,
        tracesDays: 90,
        spansDays: 90,
        llmCallsDays: 180,
        breadcrumbsDays: 30,
        sourceMapsEnabled: true,
        sourceMapsDays: 180,
        sourceMapsBatchSize: 100
      }
    },
    backups: {
      enabled: true,
      intervalHours: 24,
      retentionDays: 14,
      s3Enabled: true,
      stale: false,
      latestSuccess: {
        id: "bkp_1",
        status: "success",
        trigger: "scheduled",
        startedAt: "2026-05-06T00:00:00.000Z",
        finishedAt: "2026-05-06T00:00:05.000Z",
        filename: "sigmon-20260506T000000Z.dump",
        sizeBytes: 1234,
        s3Bucket: "sigmon-backups",
        s3Key: "prod/sigmon/sigmon-20260506T000000Z.dump",
        errorMessage: null
      },
      latestFailure: null
    },
    ...overrides
  };
}

function incidentFixture(input: { groupId: string }) {
  return {
    group: {
      id: input.groupId,
      projectId: "prj_1",
      environmentId: "env_1",
      groupingFingerprint: "fp_checkout",
      message: "Checkout failed",
      type: "Error",
      topStackFrame: "at checkout.js:10:2",
      severity: "critical",
      status: "open",
      priority: null,
      firstSeenAt: "2026-05-24T12:00:00.000Z",
      lastSeenAt: "2026-05-24T12:00:00.000Z",
      lastRegressedAt: null,
      occurrenceCount: 1,
      affectedUsersCount: 1,
      affectedTenantsCount: 1,
      latestErrorId: "err_1",
      latestRelease: "web@1",
      resolvedAt: null,
      ignoredAt: null,
      createdAt: "2026-05-24T12:00:00.000Z",
      updatedAt: "2026-05-24T12:00:00.000Z"
    },
    primaryOccurrence: {
      id: "err_1",
      projectId: "prj_1",
      environmentId: "env_1",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      traceId: "trace_1",
      timestamp: "2026-05-24T12:00:00.000Z",
      receivedAt: "2026-05-24T12:00:01.000Z",
      source: "browser",
      release: "web@1",
      metadata: {},
      message: "Checkout failed",
      type: "Error",
      severity: "critical",
      stack: "Error: Checkout failed\n    at checkout.js:10:2",
      status: "open",
      fingerprint: "fp_checkout",
      errorGroupId: input.groupId,
      groupingFingerprint: "fp_checkout",
      context: {}
    },
    priority: null,
    suggestedPriority: "urgent",
    sourceMapResolution: { status: "none" },
    stronglyRelated: { items: [], truncated: false },
    nearbyContext: { items: [], truncated: false },
    related: {
      traceId: "trace_1",
      sessionId: "session_1",
      userId: "user_1",
      tenantId: "tenant_1",
      release: "web@1"
    }
  };
}

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("ConsoleShell", () => {
  it("opens an incident route from the browser URL", async () => {
    window.history.pushState({}, "", "/console/incidents/error-groups/egrp_1?project_id=prj_1&environment_id=env_1");
    const api = client({
      getErrorGroupIncident: vi.fn().mockResolvedValue({
        data: incidentFixture({ groupId: "egrp_1" })
      })
    });

    render(<ConsoleShell apiEndpoint="https://my.sigmon.app" client={api} />);

    expect(await screen.findByText("Incident")).toBeInTheDocument();
    expect(await screen.findByText("Checkout failed")).toBeInTheDocument();
    expect(api.getErrorGroupIncident).toHaveBeenCalledWith("egrp_1", {
      projectId: "prj_1",
      environmentId: "env_1"
    });
  });

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
      expect(screen.getAllByText(/SIGMON_API_KEY/)).toHaveLength(3);
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

  it("lazy-loads system health when System mode is opened", async () => {
    const health = deferred<{ data: SystemHealthResponse }>();
    const getSystemHealth = vi.fn().mockReturnValue(health.promise);
    const api = client({
      getSystemHealth,
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
    expect(getSystemHealth).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "System" }));

    expect(getSystemHealth).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loading system health")).toBeInTheDocument();

    await act(async () => {
      health.resolve({ data: systemHealthResponse() });
      await health.promise;
    });

    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("heading", { name: "System" })).toBeInTheDocument();
    expect(screen.getByText("Postgres")).toBeInTheDocument();
  });

  it("loads source map artifacts only after Artifacts mode is opened", async () => {
    const listSourceMapArtifacts = vi.fn().mockResolvedValue([]);
    const api = client({
      listSourceMapArtifacts,
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
    expect(listSourceMapArtifacts).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Artifacts" }));

    expect(await screen.findByText("No source maps uploaded.")).toBeInTheDocument();
    expect(listSourceMapArtifacts).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
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

  it("does not query overview until Overview mode is opened", async () => {
    const getOverview = vi.fn().mockResolvedValue({ data: overviewResponse() });
    const api = client({
      getOverview,
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
    expect(getOverview).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Overview" }));

    await waitFor(() =>
      expect(getOverview).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", window: "24h" })
    );
  });

  it("drills overview top lists into seeded investigation filters", async () => {
    const listEvents = vi.fn().mockResolvedValue({ data: [] });
    const getOverview = vi.fn().mockResolvedValue({ data: overviewResponse() });
    const api = client({
      getOverview,
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
    await userEvent.click(screen.getByRole("button", { name: "Overview" }));
    await userEvent.click(await screen.findByRole("button", { name: /dashboard_created/ }));

    expect(screen.getByRole("button", { name: "Investigate" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(listEvents).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        eventName: "dashboard_created",
        limit: 50
      })
    );
    expect(screen.getByLabelText("Event name")).toHaveValue("dashboard_created");
  });

  it("drills overview tenant rows into seeded entity investigation filters", async () => {
    const listEntityTenants = vi.fn().mockResolvedValue({ data: { tenants: [] } });
    const getOverview = vi.fn().mockResolvedValue({ data: overviewResponse() });
    const api = client({
      getOverview,
      listEntityTenants,
      getEntityTenantDetail: vi.fn().mockResolvedValue({
        data: {
          window: "7d",
          generatedAt: "2026-05-05T12:30:00.000Z",
          scope: { projectId: "prj_1", environmentId: "env_1" },
          range: { from: "2026-04-28T12:30:00.000Z", to: "2026-05-05T12:30:00.000Z" },
          tenant: {
            tenantId: "tenant_1",
            label: "tenant_1",
            isUnassigned: false,
            impactScore: 10,
            lastSeenAt: "2026-05-05T10:00:00.000Z",
            events: 5,
            errors: 1,
            openErrors: 1,
            severeErrors: 0,
            traces: 3,
            failedTraces: 1,
            llmCalls: 2,
            failedLlmCalls: 0,
            llmCostUsd: "1.25",
            activeUsers: 2,
            activeSessions: 3
          },
          topUsers: [],
          timeline: []
        }
      }),
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Overview" }));
    const tenantUsage = (await screen.findByText("Tenant usage")).closest("article");
    expect(tenantUsage).not.toBeNull();

    await userEvent.click(within(tenantUsage!).getByRole("button", { name: /tenant_1/ }));

    expect(screen.getByRole("button", { name: "Investigate" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Entities" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(listEntityTenants).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        window: "7d",
        limit: 50
      })
    );
    expect(screen.getByText("No tenant activity in this window.")).toBeInTheDocument();
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

  it("does not query investigation LLM calls until the LLM tab is opened", async () => {
    const listLlmCalls = vi.fn().mockResolvedValue({ data: [] });
    const getLlmAggregates = vi.fn().mockResolvedValue({
      data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" }
    });
    const api = client({
      listLlmCalls,
      getLlmAggregates,
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

    expect(listLlmCalls).not.toHaveBeenCalled();
    expect(getLlmAggregates).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "LLM" }));

    await waitFor(() => expect(listLlmCalls).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 }));
    expect(getLlmAggregates).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
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

  it("renders the alerts panel for the active project and environment", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listAlertRules: vi.fn().mockResolvedValue({
        rules: [
          {
            id: "rule_1",
            projectId: "prj_1",
            environmentId: "env_1",
            notificationChannelId: null,
            name: "Critical errors",
            type: "critical_errors",
            severity: "critical",
            windowMinutes: 10,
            threshold: "1",
            cooldownMinutes: 30,
            enabled: true,
            lastEvaluatedAt: null,
            lastTriggeredAt: null,
            createdAt: "",
            updatedAt: "",
            archivedAt: null
          }
        ]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByText("Environment: Production")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Alerts" }));

    expect(await screen.findByRole("heading", { name: "Alerts" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Alert rules")).getByText("Critical errors")).toBeInTheDocument();
    expect(api.listAlertRules).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1" });
  });
});

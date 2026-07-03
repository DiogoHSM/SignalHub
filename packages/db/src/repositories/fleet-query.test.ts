import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OverviewResponse } from "./telemetry-query.js";
import type { OperationsResponse } from "./operations-query.js";
import type { Project, Environment } from "./admin.js";
import type { SystemHealthSnapshot } from "../../../../apps/api/src/routes/system.js";
import { getFleetRollup, getProjectFleetEnvironments } from "./fleet-query.js";

vi.mock("./admin.js", () => ({
  listProjects: vi.fn(),
  listEnvironments: vi.fn(),
  getProject: vi.fn()
}));

vi.mock("./telemetry-query.js", () => ({
  getOverview: vi.fn()
}));

vi.mock("./operations-query.js", () => ({
  getOperations: vi.fn()
}));

vi.mock("./error-groups.js", () => ({
  getErrorGroup: vi.fn()
}));

import { listProjects, listEnvironments, getProject } from "./admin.js";
import { getOverview } from "./telemetry-query.js";
import { getOperations } from "./operations-query.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = {} as any;

const NOW = new Date("2024-01-15T12:00:00.000Z");

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Project One",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    archivedAt: null,
    ...overrides
  };
}

function makeEnv(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "env-1",
    projectId: "proj-1",
    name: "production",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    archivedAt: null,
    ...overrides
  };
}

function makeOperationsResponse(overrides: Partial<OperationsResponse> = {}): OperationsResponse {
  return {
    window: "24h",
    generatedAt: NOW.toISOString(),
    scope: { projectId: "proj-1", environmentId: "env-1" },
    range: { from: new Date(NOW.getTime() - 24 * 3600000).toISOString(), to: NOW.toISOString() },
    status: "healthy",
    summary: {
      monitors: {
        total: 0,
        http: { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 },
        heartbeat: { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 }
      },
      alerts: {
        rules: { total: 0, enabled: 0 },
        events: { total: 3, critical: 0, warning: 0, deliveryFailed: 0, deliveryPending: 0 }
      },
      telemetry: {
        events: 100,
        errors: 5,
        traces: 50,
        failedTraces: 2,
        errorRatePercent: 10,
        p95TraceDurationMs: 200,
        lastEventAt: null,
        lastErrorAt: null,
        lastTraceAt: null
      },
      incidents: { open: 2, investigating: 1, urgent: 0, high: 0, regressed: 0 }
    },
    recent: {
      monitors: [],
      alerts: [],
      incidents: [
        {
          id: "inc-1",
          message: "OutOfMemoryError",
          severity: "critical",
          status: "open",
          priority: "urgent",
          lastSeenAt: NOW.toISOString(),
          latestErrorId: "err-1"
        }
      ]
    },
    topLatency: [],
    anomalies: [],
    setupGaps: [],
    ...overrides
  } as OperationsResponse;
}

function makeOverviewResponse(overrides: Partial<OverviewResponse> = {}): OverviewResponse {
  const base: OverviewResponse = {
    window: "24h",
    generatedAt: NOW.toISOString(),
    scope: { projectId: "proj-1", environmentId: "env-1" },
    range: { from: new Date(NOW.getTime() - 24 * 3600000).toISOString(), to: NOW.toISOString(), bucket: "hour" },
    kpis: {
      events: 500,
      activeUsers: 20,
      activeTenants: 5,
      errors: 10,
      openErrors: 3,
      traces: 100,
      failedTraces: 5,
      averageTraceDurationMs: 150,
      p95TraceDurationMs: 350,
      llmCalls: 50,
      failedLlmCalls: 2,
      llmInputTokens: 10000,
      llmOutputTokens: 5000,
      llmCostUsd: "5.50"
    },
    trends: {
      usage: [],
      errors: Array.from({ length: 12 }, (_, i) => ({
        bucketStart: new Date(NOW.getTime() - (11 - i) * 3600000).toISOString(),
        errors: i,
        openErrors: 0,
        severeErrors: 0
      })),
      latency: [],
      aiCost: []
    },
    top: {
      events: [],
      tenantsByUsage: [],
      tenantsByErrors: [],
      tenantsByLlmCalls: [],
      tenantsByLlmCost: [],
      llmProviders: [],
      llmModels: [],
      llmPrompts: [],
      errorSeverity: [],
      errorStatus: []
    },
    recent: { errors: [], failedTraces: [], failedLlmCalls: [] },
    releases: { selected: null, recent: [] }
  };
  return { ...base, ...overrides } as OverviewResponse;
}

function makeHealthSnapshot(overrides: Partial<SystemHealthSnapshot["services"]> = {}): SystemHealthSnapshot {
  return {
    generatedAt: NOW.toISOString(),
    status: "healthy",
    services: {
      api: { status: "healthy", uptimeSeconds: 3600 },
      postgres: { status: "healthy", latencyMs: 5 },
      redis: { status: "healthy", latencyMs: 2 },
      worker: { status: "healthy", expected: true, role: "queue", lastHeartbeatAt: null },
      scheduler: { status: "healthy", expected: true, role: "scheduler", lastHeartbeatAt: null },
      ...overrides
    },
    deployment: {
      api: { nodeEnv: "production", consoleEnabled: true, publicEndpointConfigured: true, googleOAuthEnabled: false, smtpConfigured: false },
      background: { queueExpected: true, schedulerExpected: true, alertsEnabled: true, alertsIntervalMinutes: 5, monitorsEnabled: true, monitorsIntervalMinutes: 1, retentionEnabled: true, retentionIntervalMinutes: 60, backupsEnabled: false, backupsIntervalHours: 24 },
      storage: { backupS3Enabled: false, sourceMapRetentionEnabled: false }
    },
    queues: {
      telemetry: { status: "healthy", errorMessage: null, waiting: 0, active: 0, completed: 100, failed: 0, delayed: 0, deadLettered: 0 }
    },
    ingestion: { lastEventAt: null, lastErrorAt: null, lastTraceAt: null, lastSpanAt: null, lastLlmCallAt: null },
    retention: {
      enabled: true,
      intervalMinutes: 60,
      lastRun: null,
      policy: { eventsDays: 30, errorsDays: 30, tracesDays: 30, spansDays: 30, llmCallsDays: 30, profilesDays: 30, breadcrumbsDays: 30, deadLetterJobsDays: 30, sourceMapsEnabled: false, sourceMapsDays: 30, sourceMapsBatchSize: 1000 }
    },
    backups: { enabled: false, intervalHours: 24, retentionDays: 7, s3Enabled: false, stale: null, latestSuccess: null, latestFailure: null }
  };
}

const defaultGetHealth = () => Promise.resolve(makeHealthSnapshot());

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getFleetRollup", () => {
  it("maps getOperations status → FleetProject.status for all four values", async () => {
    const statuses: Array<{ ops: OperationsResponse["status"]; expected: "ok" | "warning" | "critical" }> = [
      { ops: "healthy", expected: "ok" },
      { ops: "degraded", expected: "warning" },
      { ops: "unhealthy", expected: "critical" },
      { ops: "not_configured", expected: "ok" }
    ];

    for (const { ops, expected } of statuses) {
      vi.mocked(listProjects).mockResolvedValue([makeProject()]);
      vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
      vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({ status: ops, recent: { monitors: [], alerts: [], incidents: [] } }));
      vi.mocked(getOverview).mockResolvedValue(makeOverviewResponse());

      const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });
      expect(result.projects[0].status, `ops=${ops}`).toBe(expected);
    }
  });

  it("computes rollup counts/overall (critical>warning>ok) and summed totals", async () => {
    const projects = [
      makeProject({ id: "proj-1", name: "Alpha" }),
      makeProject({ id: "proj-2", name: "Beta" }),
      makeProject({ id: "proj-3", name: "Gamma" })
    ];
    vi.mocked(listProjects).mockResolvedValue(projects);
    vi.mocked(listEnvironments).mockImplementation((_, projectId) => {
      return Promise.resolve([makeEnv({ id: `env-${projectId}`, projectId })]);
    });
    vi.mocked(getOperations).mockImplementation((_, filters) => {
      const statusMap: Record<string, OperationsResponse["status"]> = {
        "proj-1": "unhealthy",
        "proj-2": "degraded",
        "proj-3": "healthy"
      };
      return Promise.resolve(makeOperationsResponse({
        status: statusMap[filters.projectId] ?? "healthy",
        scope: { projectId: filters.projectId, environmentId: filters.environmentId },
        summary: { ...makeOperationsResponse().summary, incidents: { open: 1, investigating: 0, urgent: 0, high: 0, regressed: 0 }, alerts: { rules: { total: 0, enabled: 0 }, events: { total: 2, critical: 0, warning: 0, deliveryFailed: 0, deliveryPending: 0 } } },
        recent: { monitors: [], alerts: [], incidents: [] }
      }));
    });
    vi.mocked(getOverview).mockImplementation((_, filters) => {
      return Promise.resolve(makeOverviewResponse({ scope: { projectId: filters.projectId, environmentId: filters.environmentId } }));
    });

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });

    expect(result.rollup.counts.critical).toBe(1);
    expect(result.rollup.counts.warning).toBe(1);
    expect(result.rollup.counts.ok).toBe(1);
    expect(result.rollup.overall).toBe("critical");
    expect(result.rollup.total).toBe(3);
    // incidents: 3 projects × 1 open = 3; alerts: 3 × 2 = 6
    expect(result.rollup.incidents).toBe(3);
    expect(result.rollup.alerts).toBe(6);
  });

  it("overall is 'warning' when no critical but some warning", async () => {
    vi.mocked(listProjects).mockResolvedValue([makeProject({ id: "proj-1" }), makeProject({ id: "proj-2", name: "B" })]);
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
    vi.mocked(getOperations).mockImplementation((_, filters) => {
      return Promise.resolve(makeOperationsResponse({
        status: filters.projectId === "proj-1" ? "degraded" : "healthy",
        recent: { monitors: [], alerts: [], incidents: [] }
      }));
    });
    vi.mocked(getOverview).mockResolvedValue(makeOverviewResponse());

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });
    expect(result.rollup.overall).toBe("warning");
  });

  it("overall is 'ok' when all healthy", async () => {
    vi.mocked(listProjects).mockResolvedValue([makeProject()]);
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
    vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({ status: "healthy", recent: { monitors: [], alerts: [], incidents: [] } }));
    vi.mocked(getOverview).mockResolvedValue(makeOverviewResponse());

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });
    expect(result.rollup.overall).toBe("ok");
  });

  it("computes deltas as current−prior, null when prior window has no data", async () => {
    vi.mocked(listProjects).mockResolvedValue([makeProject()]);
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
    vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({ recent: { monitors: [], alerts: [], incidents: [] } }));

    // Current overview: errorRate 10% (10/100), llmCost 5.50, p95 350
    const currentOverview = makeOverviewResponse({
      kpis: { ...makeOverviewResponse().kpis, p95TraceDurationMs: 350, llmCostUsd: "5.50", traces: 100, errors: 10 }
    });
    // Prior overview: errorRate 6% (6/100), llmCost 3.00, p95 250
    const priorOverview = makeOverviewResponse({
      kpis: { ...makeOverviewResponse().kpis, p95TraceDurationMs: 250, llmCostUsd: "3.00", traces: 100, errors: 6, events: 200 }
    });

    const PRIOR_NOW = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    vi.mocked(getOverview).mockImplementation((_, filters) => {
      // The prior call receives priorNow (NOW shifted back by window); current call receives NOW
      return Promise.resolve(
        filters.now?.getTime() === PRIOR_NOW.getTime() ? priorOverview : currentOverview
      );
    });

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });
    const project = result.projects[0];

    // errorRatePercent = 10/100*100 = 10 (from currentOverview kpis)
    expect(project.errorRatePercent).toBeCloseTo(10, 2);
    // errorRateDelta = current(10%) - prior(6%) = 4
    expect(project.errorRateDelta).toBeCloseTo(4, 2);
    // llmCostDeltaUsd = 5.50 - 3.00 = 2.50
    expect(project.llmCostDeltaUsd).toBe("2.50");
    // p95DeltaMs = 350 - 250 = 100
    expect(project.p95DeltaMs).toBe(100);
  });

  it("returns null deltas when prior window has no data (zero events)", async () => {
    vi.mocked(listProjects).mockResolvedValue([makeProject()]);
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
    vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({ recent: { monitors: [], alerts: [], incidents: [] } }));

    const currentOverview = makeOverviewResponse();
    // Prior with 0 events/traces => no data, null errorRate
    const priorOverview = makeOverviewResponse({
      kpis: { ...makeOverviewResponse().kpis, events: 0, traces: 0, errors: 0, llmCostUsd: "0", p95TraceDurationMs: null }
    });

    const PRIOR_NOW = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    vi.mocked(getOverview).mockImplementation((_, filters) => {
      return Promise.resolve(
        filters.now?.getTime() === PRIOR_NOW.getTime() ? priorOverview : currentOverview
      );
    });

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });
    const project = result.projects[0];

    expect(project.errorRateDelta).toBeNull();
    expect(project.llmCostDeltaUsd).toBeNull();
    expect(project.p95DeltaMs).toBeNull();
  });

  it("populates topIncident occurrenceCount/affectedUsers from the error_groups join; falls back to 0 when no row", async () => {
    const incidents = [
      {
        id: "inc-1",
        message: "Database timeout",
        severity: "critical",
        status: "open" as const,
        priority: "urgent" as const,
        lastSeenAt: NOW.toISOString(),
        latestErrorId: "err-group-42"
      }
    ];
    vi.mocked(listProjects).mockResolvedValue([makeProject()]);
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
    vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({ recent: { monitors: [], alerts: [], incidents } }));
    vi.mocked(getOverview).mockResolvedValue(makeOverviewResponse());

    // Provide a db mock that returns error group data
    const mockDbWithEG = {
      selectFrom: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue({ occurrence_count: 42, affected_users_count: 7 })
      })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await getFleetRollup(mockDbWithEG, { window: "24h", getHealth: defaultGetHealth, now: NOW });
    const project = result.projects[0];

    expect(project.topIncident).not.toBeNull();
    expect(project.topIncident?.message).toBe("Database timeout");
    expect(project.topIncident?.severity).toBe("critical");
    expect(project.topIncident?.traceOrRouteName).toBeNull();
    expect(project.topIncident?.occurrenceCount).toBe(42);
    expect(project.topIncident?.affectedUsers).toBe(7);
  });

  it("topIncident falls back to 0 counts when no error_groups row found", async () => {
    const incidents = [
      {
        id: "inc-1",
        message: "Something failed",
        severity: "warning",
        status: "open" as const,
        priority: "high" as const,
        lastSeenAt: NOW.toISOString(),
        latestErrorId: "err-missing"
      }
    ];
    vi.mocked(listProjects).mockResolvedValue([makeProject()]);
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
    vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({ recent: { monitors: [], alerts: [], incidents } }));
    vi.mocked(getOverview).mockResolvedValue(makeOverviewResponse());

    const mockDbWithEG = {
      selectFrom: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        executeTakeFirst: vi.fn().mockResolvedValue(undefined) // no row
      })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const result = await getFleetRollup(mockDbWithEG, { window: "24h", getHealth: defaultGetHealth, now: NOW });
    const project = result.projects[0];

    expect(project.topIncident?.occurrenceCount).toBe(0);
    expect(project.topIncident?.affectedUsers).toBe(0);
  });

  it("topIncident is null when no incidents in getOperations", async () => {
    vi.mocked(listProjects).mockResolvedValue([makeProject()]);
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
    vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({ recent: { monitors: [], alerts: [], incidents: [] } }));
    vi.mocked(getOverview).mockResolvedValue(makeOverviewResponse());

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });
    expect(result.projects[0].topIncident).toBeNull();
  });

  it("attaches the SAME instance-wide infra object to every project and fetches system-health once", async () => {
    const projects = [
      makeProject({ id: "proj-1", name: "A" }),
      makeProject({ id: "proj-2", name: "B" })
    ];
    vi.mocked(listProjects).mockResolvedValue(projects);
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
    vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({ recent: { monitors: [], alerts: [], incidents: [] } }));
    vi.mocked(getOverview).mockResolvedValue(makeOverviewResponse());

    const getHealth = vi.fn().mockResolvedValue(makeHealthSnapshot());

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth, now: NOW });

    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(result.projects).toHaveLength(2);
    // Same reference for infra
    expect(result.projects[0].infra).toBe(result.projects[1].infra);
    // Correct shape
    expect(result.projects[0].infra.api).toBe("ok");
    expect(result.projects[0].infra.db).toBe("ok");
    expect(result.projects[0].infra.redis).toBe("ok");
    expect(result.projects[0].infra.queue).toBe("ok");
  });

  it("maps infra component statuses: healthy→ok, degraded→warning, unhealthy→critical", async () => {
    vi.mocked(listProjects).mockResolvedValue([makeProject()]);
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
    vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({ recent: { monitors: [], alerts: [], incidents: [] } }));
    vi.mocked(getOverview).mockResolvedValue(makeOverviewResponse());

    const getHealth = vi.fn().mockResolvedValue(makeHealthSnapshot({
      api: { status: "unhealthy", uptimeSeconds: 100 },
      postgres: { status: "degraded", latencyMs: 500 },
      redis: { status: "healthy", latencyMs: 1 },
      worker: { status: "unhealthy", expected: true, role: "queue", lastHeartbeatAt: null }
    }));

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth, now: NOW });

    expect(result.projects[0].infra.api).toBe("critical");
    expect(result.projects[0].infra.db).toBe("warning");
    expect(result.projects[0].infra.redis).toBe("ok");
    expect(result.projects[0].infra.queue).toBe("critical");
  });

  it("excludes archived projects, resolves production env (or lexically-first), sorts by severity then name", async () => {
    const projects = [
      makeProject({ id: "proj-c", name: "Charlie" }),
      makeProject({ id: "proj-a", name: "Alpha" }),
      makeProject({ id: "proj-b", name: "Beta" }),
      makeProject({ id: "proj-arch", name: "Archived", archivedAt: new Date() }) // archived — but listProjects already excludes
    ];
    // listProjects already excludes archived (archived_at IS NULL), so only return active ones
    vi.mocked(listProjects).mockResolvedValue(projects.filter((p) => p.archivedAt === null));
    vi.mocked(listEnvironments).mockImplementation((_, projectId) => {
      if (projectId === "proj-a") {
        // Has both staging and production; should pick production
        return Promise.resolve([
          makeEnv({ id: "env-staging", projectId, name: "staging" }),
          makeEnv({ id: "env-prod", projectId, name: "production" })
        ]);
      }
      if (projectId === "proj-b") {
        // No production; should pick lexically-first: "alpha-env"
        return Promise.resolve([
          makeEnv({ id: "env-z", projectId, name: "z-env" }),
          makeEnv({ id: "env-alpha", projectId, name: "alpha-env" })
        ]);
      }
      // proj-c: has production
      return Promise.resolve([makeEnv({ id: `env-${projectId}`, projectId, name: "production" })]);
    });
    vi.mocked(getOperations).mockImplementation((_, filters) => {
      const statusMap: Record<string, OperationsResponse["status"]> = {
        "proj-a": "degraded",    // warning
        "proj-b": "unhealthy",   // critical
        "proj-c": "healthy"      // ok
      };
      return Promise.resolve(makeOperationsResponse({
        status: statusMap[filters.projectId] ?? "healthy",
        scope: { projectId: filters.projectId, environmentId: filters.environmentId },
        recent: { monitors: [], alerts: [], incidents: [] }
      }));
    });
    vi.mocked(getOverview).mockResolvedValue(makeOverviewResponse());

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });

    // Should be 3 projects (archived excluded)
    expect(result.projects).toHaveLength(3);

    // Sorted by: critical first, then warning, then ok. Within same status: alphabetical
    expect(result.projects[0].name).toBe("Beta");    // critical
    expect(result.projects[0].status).toBe("critical");
    expect(result.projects[1].name).toBe("Alpha");   // warning
    expect(result.projects[1].status).toBe("warning");
    expect(result.projects[2].name).toBe("Charlie"); // ok
    expect(result.projects[2].status).toBe("ok");

    // Check that proj-a used production env
    expect(getOperations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "proj-a", environmentId: "env-prod" })
    );

    // Check that proj-b used lexically-first env
    expect(getOperations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: "proj-b", environmentId: "env-alpha" })
    );
  });

  it("excludes projects with no environments (treated as not_configured → ok with empty fields)", async () => {
    vi.mocked(listProjects).mockResolvedValue([makeProject({ id: "no-env", name: "NoEnv" })]);
    vi.mocked(listEnvironments).mockResolvedValue([]); // no envs

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });

    // Project with no env is excluded from results
    expect(result.projects).toHaveLength(0);
    expect(result.rollup.total).toBe(0);
  });

  it("errorRatePercent is null when no traces; errorTrend is a 12-point number[]", async () => {
    vi.mocked(listProjects).mockResolvedValue([makeProject()]);
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
    vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({
      summary: {
        ...makeOperationsResponse().summary,
        telemetry: { ...makeOperationsResponse().summary.telemetry, errorRatePercent: null }
      },
      recent: { monitors: [], alerts: [], incidents: [] }
    }));

    const overviewWith12Errors = makeOverviewResponse({
      kpis: { ...makeOverviewResponse().kpis, traces: 0, p95TraceDurationMs: null },
      trends: {
        ...makeOverviewResponse().trends,
        errors: Array.from({ length: 12 }, (_, i) => ({
          bucketStart: new Date(NOW.getTime() - (11 - i) * 3600000).toISOString(),
          errors: i * 2,
          openErrors: 0,
          severeErrors: 0
        }))
      }
    });
    vi.mocked(getOverview).mockResolvedValue(overviewWith12Errors);

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });
    const project = result.projects[0];

    expect(project.errorRatePercent).toBeNull();
    expect(project.errorTrend).toHaveLength(12);
    expect(project.errorTrend).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  });

  it("errorTrend pads with zeros if fewer than 12 buckets", async () => {
    vi.mocked(listProjects).mockResolvedValue([makeProject()]);
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv()]);
    vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({ recent: { monitors: [], alerts: [], incidents: [] } }));

    const overviewFewBuckets = makeOverviewResponse({
      trends: {
        ...makeOverviewResponse().trends,
        errors: [
          { bucketStart: NOW.toISOString(), errors: 5, openErrors: 0, severeErrors: 0 },
          { bucketStart: new Date(NOW.getTime() - 3600000).toISOString(), errors: 3, openErrors: 0, severeErrors: 0 }
        ]
      }
    });
    vi.mocked(getOverview).mockResolvedValue(overviewFewBuckets);

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });
    const project = result.projects[0];

    expect(project.errorTrend).toHaveLength(12);
    // Should pad with zeros to reach 12 points
    const nonZero = project.errorTrend.filter((v) => v > 0);
    expect(nonZero.length).toBeLessThanOrEqual(2);
  });

  it("empty fleet → counts all zero, overall 'ok', total 0", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);

    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: NOW });

    expect(result.projects).toHaveLength(0);
    expect(result.rollup).toEqual({
      counts: { ok: 0, warning: 0, critical: 0 },
      incidents: 0,
      alerts: 0,
      llmCostUsd: "0.00",
      overall: "ok",
      total: 0
    });
    expect(result.window).toBe("24h");
    expect(result.generatedAt).toBe(NOW.toISOString());
  });

  it("generatedAt matches injected now", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);

    const customNow = new Date("2025-03-10T08:30:00.000Z");
    const result = await getFleetRollup(mockDb, { window: "24h", getHealth: defaultGetHealth, now: customNow });

    expect(result.generatedAt).toBe(customNow.toISOString());
  });
});

// ---------------------------------------------------------------------------
// getProjectFleetEnvironments
// ---------------------------------------------------------------------------

describe("getProjectFleetEnvironments", () => {
  it("returns undefined (→ 404) for unknown or archived project", async () => {
    vi.mocked(getProject).mockResolvedValue(undefined);

    const result = await getProjectFleetEnvironments(mockDb, { projectId: "unknown-id", window: "24h" });
    expect(result).toBeUndefined();
  });

  it("returns one FleetProjectEnv per non-archived env, production first", async () => {
    vi.mocked(getProject).mockResolvedValue(makeProject({ id: "proj-1" }));
    vi.mocked(listEnvironments).mockResolvedValue([
      makeEnv({ id: "env-staging", name: "staging" }),
      makeEnv({ id: "env-prod", name: "production" }),
      makeEnv({ id: "env-dev", name: "development" })
    ]);
    vi.mocked(getOperations).mockImplementation((_, filters) => {
      return Promise.resolve(
        makeOperationsResponse({
          scope: { projectId: "proj-1", environmentId: filters.environmentId },
          status: "healthy",
          summary: {
            ...makeOperationsResponse().summary,
            incidents: { open: 1, investigating: 0, urgent: 0, high: 0, regressed: 0 },
            telemetry: { ...makeOperationsResponse().summary.telemetry, errorRatePercent: 5 }
          },
          recent: { monitors: [], alerts: [], incidents: [] }
        })
      );
    });

    const result = await getProjectFleetEnvironments(mockDb, { projectId: "proj-1", window: "24h" });

    expect(result).not.toBeUndefined();
    expect(result!.projectId).toBe("proj-1");
    expect(result!.envs).toHaveLength(3);
    // Production must be first
    expect(result!.envs[0].name).toBe("production");
  });

  it("caps at 5 environments", async () => {
    vi.mocked(getProject).mockResolvedValue(makeProject({ id: "proj-1" }));
    // 7 environments
    vi.mocked(listEnvironments).mockResolvedValue([
      makeEnv({ id: "env-1", name: "env-1" }),
      makeEnv({ id: "env-2", name: "env-2" }),
      makeEnv({ id: "env-3", name: "env-3" }),
      makeEnv({ id: "env-4", name: "env-4" }),
      makeEnv({ id: "env-5", name: "env-5" }),
      makeEnv({ id: "env-6", name: "env-6" }),
      makeEnv({ id: "env-7", name: "production" })
    ]);
    vi.mocked(getOperations).mockResolvedValue(
      makeOperationsResponse({ status: "healthy", recent: { monitors: [], alerts: [], incidents: [] } })
    );

    const result = await getProjectFleetEnvironments(mockDb, { projectId: "proj-1", window: "24h" });

    expect(result!.envs).toHaveLength(5);
  });

  it("sets note='no data' when events===0 and status==='ok', else null", async () => {
    vi.mocked(getProject).mockResolvedValue(makeProject({ id: "proj-1" }));
    vi.mocked(listEnvironments).mockResolvedValue([
      makeEnv({ id: "env-prod", name: "production" }),
      makeEnv({ id: "env-staging", name: "staging" })
    ]);
    vi.mocked(getOperations).mockImplementation((_, filters) => {
      if (filters.environmentId === "env-prod") {
        // no data: status healthy + events 0
        return Promise.resolve(makeOperationsResponse({
          scope: { projectId: "proj-1", environmentId: "env-prod" },
          status: "healthy",
          summary: { ...makeOperationsResponse().summary, telemetry: { ...makeOperationsResponse().summary.telemetry, events: 0, errorRatePercent: null } },
          recent: { monitors: [], alerts: [], incidents: [] }
        }));
      }
      // staging has data
      return Promise.resolve(makeOperationsResponse({
        scope: { projectId: "proj-1", environmentId: "env-staging" },
        status: "degraded",
        summary: { ...makeOperationsResponse().summary, telemetry: { ...makeOperationsResponse().summary.telemetry, events: 100 } },
        recent: { monitors: [], alerts: [], incidents: [] }
      }));
    });

    const result = await getProjectFleetEnvironments(mockDb, { projectId: "proj-1", window: "24h" });

    const prodEnv = result!.envs.find((e) => e.name === "production")!;
    const stagingEnv = result!.envs.find((e) => e.name === "staging")!;

    expect(prodEnv.note).toBe("no data");
    expect(stagingEnv.note).toBeNull();
  });

  it("maps getOperations status to ok/warning/critical per FleetProjectEnv", async () => {
    vi.mocked(getProject).mockResolvedValue(makeProject({ id: "proj-1" }));
    vi.mocked(listEnvironments).mockResolvedValue([
      makeEnv({ id: "env-1", name: "env-healthy" }),
      makeEnv({ id: "env-2", name: "env-degraded" }),
      makeEnv({ id: "env-3", name: "env-unhealthy" }),
      makeEnv({ id: "env-4", name: "env-not_configured" })
    ]);
    vi.mocked(getOperations).mockImplementation((_, filters) => {
      const statusMap: Record<string, OperationsResponse["status"]> = {
        "env-1": "healthy",
        "env-2": "degraded",
        "env-3": "unhealthy",
        "env-4": "not_configured"
      };
      return Promise.resolve(makeOperationsResponse({
        scope: { projectId: "proj-1", environmentId: filters.environmentId },
        status: statusMap[filters.environmentId] ?? "healthy",
        recent: { monitors: [], alerts: [], incidents: [] }
      }));
    });

    const result = await getProjectFleetEnvironments(mockDb, { projectId: "proj-1", window: "24h" });

    const byName = Object.fromEntries(result!.envs.map((e) => [e.name, e]));
    expect(byName["env-healthy"].status).toBe("ok");
    expect(byName["env-degraded"].status).toBe("warning");
    expect(byName["env-unhealthy"].status).toBe("critical");
    expect(byName["env-not_configured"].status).toBe("ok");
  });

  it("returns correct incidents count and errorRatePercent per env", async () => {
    vi.mocked(getProject).mockResolvedValue(makeProject({ id: "proj-1" }));
    vi.mocked(listEnvironments).mockResolvedValue([makeEnv({ id: "env-prod", name: "production" })]);
    vi.mocked(getOperations).mockResolvedValue(makeOperationsResponse({
      scope: { projectId: "proj-1", environmentId: "env-prod" },
      status: "healthy",
      summary: {
        ...makeOperationsResponse().summary,
        incidents: { open: 3, investigating: 2, urgent: 0, high: 0, regressed: 0 },
        telemetry: { ...makeOperationsResponse().summary.telemetry, events: 500, errorRatePercent: 12.5 }
      },
      recent: { monitors: [], alerts: [], incidents: [] }
    }));

    const result = await getProjectFleetEnvironments(mockDb, { projectId: "proj-1", window: "24h" });

    const env = result!.envs[0];
    expect(env.incidents).toBe(5); // open(3) + investigating(2)
    expect(env.errorRatePercent).toBe(12.5);
    expect(env.events).toBe(500);
    expect(env.note).toBeNull(); // events > 0
  });
});

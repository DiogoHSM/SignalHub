import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { SystemHealthResponse } from "../api/types";
import { SystemHealthPanel } from "./SystemHealthPanel";

function client(getSystemHealth: ApiClient["getSystemHealth"]): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    listTraces: vi.fn(),
    listTraceSpans: vi.fn(),
    listLlmCalls: vi.fn(),
    getLlmAggregates: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    getSystemHealth,
    listEntityTenants: vi.fn(),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn(),
    getUserDetail: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    listNotificationChannels: vi.fn(),
    createNotificationChannel: vi.fn(),
    updateNotificationChannel: vi.fn(),
    archiveNotificationChannel: vi.fn(),
    listAlertRules: vi.fn(),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    archiveAlertRule: vi.fn(),
    listAlertEvents: vi.fn(),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn().mockResolvedValue({ data: [] }),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    getSessionTimeline: vi.fn().mockResolvedValue({ data: { sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } } })
  } satisfies ApiClient;
}

function healthyResponse(overrides: Partial<SystemHealthResponse> = {}): SystemHealthResponse {
  return {
    generatedAt: "2026-05-06T12:00:00.000Z",
    status: "healthy",
    services: {
      api: { status: "healthy", uptimeSeconds: 120 },
      postgres: { status: "healthy", latencyMs: 4 },
      redis: { status: "healthy", latencyMs: 2 },
      worker: { status: "healthy", expected: true, role: "queue", lastHeartbeatAt: "2026-05-06T11:59:55.000Z" },
      scheduler: { status: "healthy", expected: true, role: "scheduler", lastHeartbeatAt: "2026-05-06T11:59:50.000Z" }
    },
    queues: {
      telemetry: { status: "healthy", errorMessage: null, waiting: 1, active: 2, completed: 30, failed: 0, delayed: 3 }
    },
    ingestion: {
      lastEventAt: "2026-05-06T11:58:00.000Z",
      lastErrorAt: null,
      lastTraceAt: "2026-05-06T11:57:00.000Z",
      lastSpanAt: "2026-05-06T11:57:10.000Z",
      lastLlmCallAt: null
    },
    retention: {
      enabled: true,
      intervalMinutes: 60,
      lastRun: {
        id: "ret_1",
        status: "success",
        startedAt: "2026-05-06T10:00:00.000Z",
        finishedAt: "2026-05-06T10:00:05.000Z",
        deleted: {
          events: 10,
          errors: 1,
          traces: 3,
          spans: 8,
          llmCalls: 2,
          breadcrumbs: 4,
          sourceMapArtifacts: 2,
          sourceMapFiles: 2
        },
        errorMessage: null
      },
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
    deployment: {
      api: {
        nodeEnv: "production",
        consoleEnabled: true,
        publicEndpointConfigured: true,
        googleOAuthEnabled: true,
        smtpConfigured: true
      },
      background: {
        queueExpected: true,
        schedulerExpected: true,
        alertsEnabled: true,
        alertsIntervalMinutes: 1,
        monitorsEnabled: true,
        monitorsIntervalMinutes: 1,
        retentionEnabled: true,
        retentionIntervalMinutes: 60,
        backupsEnabled: true,
        backupsIntervalHours: 24
      },
      storage: {
        backupS3Enabled: true,
        sourceMapRetentionEnabled: true
      }
    },
    ...overrides
  };
}

afterEach(() => {
  cleanup();
});

describe("SystemHealthPanel", () => {
  it("renders a healthy system snapshot with services queues ingestion and retention", async () => {
    const api = client(vi.fn().mockResolvedValue({ data: healthyResponse() }));

    render(<SystemHealthPanel client={api} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading system health");
    expect(await screen.findByRole("heading", { name: "System health" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "System health summary" })).getByText("healthy")).toBeInTheDocument();
    expect(screen.getByText("Postgres")).toBeInTheDocument();
    expect(screen.getByText("Redis")).toBeInTheDocument();
    expect(screen.getByText("Queue worker")).toBeInTheDocument();
    expect(screen.getByText("Scheduler")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deploy config" })).toBeInTheDocument();
    const readiness = screen.getByRole("region", { name: "Installation readiness" });
    expect(readiness).toBeInTheDocument();
    expect(within(readiness).getByText("Public endpoint ready")).toBeInTheDocument();
    expect(within(readiness).getByText("Queue worker running")).toBeInTheDocument();
    expect(within(readiness).getByText("Scheduler running")).toBeInTheDocument();
    expect(within(readiness).getByText("SMTP configured")).toBeInTheDocument();
    const queueWorkerCard = screen.getByRole("heading", { name: "Queue worker" }).closest("article");
    expect(queueWorkerCard).not.toBeNull();
    expect(within(queueWorkerCard as HTMLElement).getByText("WORKER_ROLE=queue")).toBeInTheDocument();
    const schedulerCard = screen.getByRole("heading", { name: "Scheduler" }).closest("article");
    expect(schedulerCard).not.toBeNull();
    expect(within(schedulerCard as HTMLElement).getByText("WORKER_ROLE=scheduler")).toBeInTheDocument();
    const deployCard = screen.getByRole("heading", { name: "Deploy config" }).closest("article");
    expect(deployCard).not.toBeNull();
    expect(within(deployCard as HTMLElement).getByText("SMTP configured")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Retention" })).toBeInTheDocument();
    expect(screen.getByText(/^Generated /)).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getAllByText("No data")).toHaveLength(2);
    const retentionCard = screen.getByRole("heading", { name: "Retention" }).closest("article");
    expect(retentionCard).not.toBeNull();
    expect(within(retentionCard as HTMLElement).getByText("Enabled")).toBeInTheDocument();
    expect(within(retentionCard as HTMLElement).getByText("events 90d")).toBeInTheDocument();
    expect(within(retentionCard as HTMLElement).getByText("breadcrumbs 30d")).toBeInTheDocument();
    expect(within(retentionCard as HTMLElement).getByText("source maps 180d")).toBeInTheDocument();
    expect(within(retentionCard as HTMLElement).getByText("source maps enabled")).toBeInTheDocument();
    expect(within(retentionCard as HTMLElement).getByText("source maps batch 100")).toBeInTheDocument();
    expect(within(retentionCard as HTMLElement).getByText("success")).toBeInTheDocument();
    expect(within(retentionCard as HTMLElement).getByText(/breadcrumbs 4/)).toBeInTheDocument();
    expect(within(retentionCard as HTMLElement).getByText(/source maps 2 artifacts, 2 files/i)).toBeInTheDocument();
  });

  it("surfaces missing installation configuration without exposing secrets", async () => {
    const api = client(
      vi.fn().mockResolvedValue({
        data: healthyResponse({
          status: "degraded",
          services: {
            api: { status: "healthy", uptimeSeconds: 120 },
            postgres: { status: "healthy", latencyMs: 4 },
            redis: { status: "healthy", latencyMs: 2 },
            worker: { status: "degraded", expected: true, role: "queue", lastHeartbeatAt: null },
            scheduler: { status: "degraded", expected: true, role: "scheduler", lastHeartbeatAt: null }
          },
          deployment: {
            api: {
              nodeEnv: "production",
              consoleEnabled: true,
              publicEndpointConfigured: false,
              googleOAuthEnabled: true,
              smtpConfigured: false
            },
            background: {
              queueExpected: true,
              schedulerExpected: true,
              alertsEnabled: true,
              alertsIntervalMinutes: 1,
              monitorsEnabled: true,
              monitorsIntervalMinutes: 1,
              retentionEnabled: false,
              retentionIntervalMinutes: 60,
              backupsEnabled: false,
              backupsIntervalHours: 24
            },
            storage: {
              backupS3Enabled: false,
              sourceMapRetentionEnabled: false
            }
          }
        })
      })
    );

    render(<SystemHealthPanel client={api} />);

    const readiness = await screen.findByRole("region", { name: "Installation readiness" });
    expect(within(readiness).getByText("Public endpoint missing")).toBeInTheDocument();
    expect(within(readiness).getByText("Queue worker stale")).toBeInTheDocument();
    expect(within(readiness).getByText("Scheduler stale")).toBeInTheDocument();
    expect(within(readiness).getByText("SMTP missing")).toBeInTheDocument();
    expect(within(readiness).getByText("Backups disabled")).toBeInTheDocument();
    expect(within(readiness).getByText("Retention disabled")).toBeInTheDocument();
    expect(screen.queryByText(/password|secret|token/i)).not.toBeInTheDocument();
  });

  it("renders disabled source-map retention policy clearly", async () => {
    const health = healthyResponse();
    health.retention.policy.sourceMapsEnabled = false;
    const api = client(vi.fn().mockResolvedValue({ data: health }));

    render(<SystemHealthPanel client={api} />);

    const retentionCard = (await screen.findByRole("heading", { name: "Retention" })).closest("article");
    expect(retentionCard).not.toBeNull();
    expect(within(retentionCard as HTMLElement).getByText("source maps disabled")).toBeInTheDocument();
    expect(within(retentionCard as HTMLElement).getByText("source maps 180d")).toBeInTheDocument();
    expect(within(retentionCard as HTMLElement).getByText("source maps batch 100")).toBeInTheDocument();
  });

  it("renders backup status without local paths or credentials", async () => {
    const api = client(async () => ({ data: healthyResponse() }));
    render(<SystemHealthPanel client={api} />);

    const backupsHeading = await screen.findByRole("heading", { name: "Backups" });
    const backupsCard = backupsHeading.closest("article");
    expect(backupsCard).not.toBeNull();
    expect(within(backupsCard as HTMLElement).getByText("Enabled")).toBeInTheDocument();
    expect(within(backupsCard as HTMLElement).getByText("S3 enabled")).toBeInTheDocument();
    expect(within(backupsCard as HTMLElement).getByText("sigmon-20260506T000000Z.dump")).toBeInTheDocument();
    expect(within(backupsCard as HTMLElement).getByText("1234 bytes")).toBeInTheDocument();
    expect(screen.queryByText(/var\/lib\/sigmon/)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
  });

  it("renders unknown backup metadata as degraded when backups are enabled", async () => {
    const api = client(
      vi.fn().mockResolvedValue({
        data: healthyResponse({
          status: "degraded",
          backups: {
            enabled: true,
            intervalHours: 24,
            retentionDays: 14,
            s3Enabled: false,
            stale: null,
            latestSuccess: null,
            latestFailure: {
              id: "bkp_failure",
              status: "failed",
              trigger: "scheduled",
              startedAt: "2026-05-06T11:00:00.000Z",
              finishedAt: null,
              filename: "sigmon-20260506T110000Z.dump",
              sizeBytes: null,
              s3Bucket: null,
              s3Key: null,
              errorMessage: null
            }
          }
        })
      })
    );

    render(<SystemHealthPanel client={api} />);

    const backupsCard = (await screen.findByRole("heading", { name: "Backups" })).closest("article");
    expect(backupsCard).not.toBeNull();
    expect(within(backupsCard as HTMLElement).getAllByText("Unknown")).toHaveLength(2);
    expect(within(backupsCard as HTMLElement).getByText("S3 disabled")).toBeInTheDocument();
    expect(within(backupsCard as HTMLElement).getByText("No data")).toBeInTheDocument();
    expect(within(backupsCard as HTMLElement).getByText(/2026/)).toBeInTheDocument();
  });

  it("renders disabled backups as not applicable", async () => {
    const api = client(
      vi.fn().mockResolvedValue({
        data: healthyResponse({
          backups: {
            enabled: false,
            intervalHours: 24,
            retentionDays: 14,
            s3Enabled: false,
            stale: null,
            latestSuccess: null,
            latestFailure: null
          }
        })
      })
    );

    render(<SystemHealthPanel client={api} />);

    const backupsCard = (await screen.findByRole("heading", { name: "Backups" })).closest("article");
    expect(backupsCard).not.toBeNull();
    expect(within(backupsCard as HTMLElement).getByText("Disabled")).toBeInTheDocument();
    expect(within(backupsCard as HTMLElement).getByText("Not applicable")).toBeInTheDocument();
    expect(within(backupsCard as HTMLElement).getByText("No data")).toBeInTheDocument();
  });

  it("retries after the system health request fails", async () => {
    const getSystemHealth = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce({ data: healthyResponse({ status: "degraded" }) });
    const api = client(getSystemHealth);

    render(<SystemHealthPanel client={api} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("System health unavailable");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(getSystemHealth).toHaveBeenCalledTimes(2));
    const header = await screen.findByRole("group", { name: "System health summary" });
    expect(within(header).getByText("degraded")).toBeInTheDocument();
  });

  it("formats malformed timestamps as no data", async () => {
    const api = client(
      vi.fn().mockResolvedValue({
        data: healthyResponse({
          generatedAt: "not-a-date",
          services: {
            api: { status: "healthy", uptimeSeconds: 120 },
            postgres: { status: "healthy", latencyMs: 4 },
            redis: { status: "healthy", latencyMs: 2 },
            worker: { status: "healthy", expected: true, role: "queue", lastHeartbeatAt: "not-a-date" },
            scheduler: { status: "healthy", expected: true, role: "scheduler", lastHeartbeatAt: "not-a-date" }
          },
          ingestion: {
            lastEventAt: "not-a-date",
            lastErrorAt: null,
            lastTraceAt: "2026-05-06T11:57:00.000Z",
            lastSpanAt: "2026-05-06T11:57:10.000Z",
            lastLlmCallAt: null
          }
        })
      })
    );

    render(<SystemHealthPanel client={api} />);

    expect(await screen.findByRole("heading", { name: "System health" })).toBeInTheDocument();
    expect(screen.queryByText("Invalid Date")).not.toBeInTheDocument();
    expect(screen.getByText("Generated No data")).toBeInTheDocument();
    expect(screen.getAllByText("No data").length).toBeGreaterThanOrEqual(4);
  });

  it("renders queue probe failures without showing fallback counts", async () => {
    const api = client(
      vi.fn().mockResolvedValue({
        data: healthyResponse({
          status: "unhealthy",
          queues: {
            telemetry: {
              status: "unhealthy",
              errorMessage: "Queue counts unavailable",
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
              delayed: 0
            }
          }
        })
      })
    );

    render(<SystemHealthPanel client={api} />);

    expect(await screen.findByText("Queue counts unavailable")).toBeInTheDocument();
    const queuesCard = screen.getByRole("heading", { name: "Queues" }).closest("article");
    expect(queuesCard).not.toBeNull();
    expect(within(queuesCard as HTMLElement).getByText("unhealthy")).toBeInTheDocument();
    expect(within(queuesCard as HTMLElement).queryByText("Waiting")).not.toBeInTheDocument();
  });
});

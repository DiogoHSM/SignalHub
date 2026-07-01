import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ApiClient } from "../api/client";
import type { SystemHealthResponse } from "../api/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SigmonAdminWorkspace } from "./SigmonAdminWorkspace";

function client(getSystemHealth: ApiClient["getSystemHealth"]): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    fetchFleet: vi.fn(),
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
    getSystemHealthHistory: vi.fn(),
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
    updateAlertEventTriage: vi.fn(),
    listAlertEvents: vi.fn(),
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
    })
  } satisfies ApiClient;
}

function healthyResponse(): SystemHealthResponse {
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
      telemetry: { status: "healthy", errorMessage: null, waiting: 1, active: 0, completed: 30, failed: 0, delayed: 0, deadLettered: 0 }
    },
    ingestion: {
      lastEventAt: "2026-05-06T11:58:00.000Z",
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
        deadLetterJobsDays: 30,
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
      latestSuccess: null,
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
    }
  };
}

afterEach(() => {
  cleanup();
});

describe("SigmonAdminWorkspace", () => {
  it("renders the admin heading, description, section buttons, and default system health panel", async () => {
    const getSystemHealth = vi.fn().mockResolvedValue({ data: healthyResponse() });

    render(
      <SigmonAdminWorkspace
        browserCorsOrigins={["https://app.controledaempresa.com", "https://microerp.example.com"]}
        client={client(getSystemHealth)}
      />
    );

    expect(screen.getByRole("heading", { name: "Sigmon Admin" })).toBeInTheDocument();
    expect(screen.getByText("Installation-level status and server configuration.")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Sigmon admin sections" })).toBeInTheDocument();

    for (const label of ["System health", "Deploy", "Notifications", "Storage", "Security", "Docs & SDK"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    await waitFor(() => expect(getSystemHealth).toHaveBeenCalledTimes(1));
    const summary = await screen.findByRole("group", { name: "System health summary" });
    expect(within(summary).getByRole("heading", { name: "System health" })).toBeInTheDocument();
    expect(within(summary).getByText("healthy")).toBeInTheDocument();
  });

  it("renders read-only installation guidance for non-health sections", async () => {
    const getSystemHealth = vi.fn().mockResolvedValue({ data: healthyResponse() });

    render(
      <SigmonAdminWorkspace
        browserCorsOrigins={["https://app.controledaempresa.com", "https://microerp.example.com"]}
        client={client(getSystemHealth)}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Deploy" }));
    expect(screen.getByText("Deployment readiness is installation-scoped and read-only here while Sigmon admin editing is still being built.")).toBeInTheDocument();
    expect(screen.getByText(/configured through EasyPanel, Docker, and environment variables/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("SMTP is installation-level configuration for outbound console and alert delivery.")).toBeInTheDocument();
    expect(screen.getByText("Notification channels belong to projects and are managed from project workflows.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Storage" }));
    expect(screen.getByText("Retention, source-map storage, and backup status are summarized in System health.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Security" }));
    expect(screen.getByText("Global browser ingestion origins are currently configured by BROWSER_CORS_ORIGINS.")).toBeInTheDocument();
    expect(screen.getByText("https://app.controledaempresa.com")).toBeInTheDocument();
    expect(screen.getByText("https://microerp.example.com")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Docs & SDK" }));
    expect(screen.getByText("Public API and SDK documentation are installation-level resources for integrators.")).toBeInTheDocument();
    expect(screen.getByText("OpenAPI, Scalar, and SDK docs stay available without requiring an active monitored project.")).toBeInTheDocument();
  });
});

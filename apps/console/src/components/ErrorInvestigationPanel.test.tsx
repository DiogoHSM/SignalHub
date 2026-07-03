import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type { ErrorGroupRecord, ErrorRecord, SourceMapResolution } from "../api/types";
import type { ErrorFilterValues } from "./ErrorFilters";
import { ErrorInvestigationPanel } from "./ErrorInvestigationPanel";

const unavailableResolution = {
  errorId: "err_1",
  release: null,
  status: "unavailable" as const,
  frames: [],
  unresolvedFrameCount: 0
};

function error(overrides: Partial<ErrorRecord>): ErrorRecord {
  return {
    id: "err_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-04T12:00:00.000Z",
    receivedAt: "2026-05-04T12:00:01.000Z",
    source: "web",
    release: "1.0.0",
    metadata: {},
    message: "Checkout fetch failed",
    type: "TypeError",
    severity: "critical",
    stack: "TypeError: Checkout fetch failed\n    at checkout.ts:12:3",
    status: "open",
    fingerprint: "fp_checkout_fetch",
    errorGroupId: "egrp_checkout",
    groupingFingerprint: "fp_checkout_fetch",
    context: {},
    ...overrides
  };
}

function errorGroup(overrides: Partial<ErrorGroupRecord>): ErrorGroupRecord {
  return {
    id: "egrp_checkout",
    projectId: "prj_1",
    environmentId: "env_1",
    groupingFingerprint: "fp_checkout_fetch",
    message: "Checkout fetch failed",
    type: "TypeError",
    topStackFrame: "checkout.ts:12:3",
    severity: "critical",
    status: "open",
    priority: null,
    firstSeenAt: "2026-05-04T11:00:00.000Z",
    lastSeenAt: "2026-05-04T12:00:00.000Z",
    lastRegressedAt: null,
    occurrenceCount: 12,
    affectedUsersCount: 4,
    affectedTenantsCount: 2,
    latestErrorId: "err_1",
    latestRelease: "1.0.0",
    resolvedAt: null,
    ignoredAt: null,
    assignedToUserId: null,
    assignedTo: null,
    incidentNumber: null,
    silencedUntil: null,
    createdAt: "2026-05-04T11:00:00.000Z",
    updatedAt: "2026-05-04T12:00:00.000Z",
    ...overrides
  };
}

function client(overrides: Partial<ApiClient>): ApiClient {
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
    listErrors: vi.fn().mockResolvedValue({ data: [] }),
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    getSystemHealth: vi.fn(),
    getSystemHealthHistory: vi.fn(),
    listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [] } }),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [] } }),
    getUserDetail: vi.fn().mockResolvedValue({ data: { window: "7d", generatedAt: "2026-05-05T12:00:00.000Z", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" }, user: { userId: "user_1", label: "user_1", isAnonymous: false, impactScore: 0, lastSeenAt: null, events: 0, errors: 0, openErrors: 0, severeErrors: 0, traces: 0, failedTraces: 0, llmCalls: 0, failedLlmCalls: 0, llmCostUsd: "0", activeTenants: 0, activeSessions: 0 }, recentSessions: [], timeline: [] } }),
    listUsers: vi.fn(),
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
    getSessionTimeline: vi.fn().mockResolvedValue({ data: { sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } } }),
    getErrorSourceMapResolution: vi.fn().mockResolvedValue(unavailableResolution),
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

afterEach(() => {
  cleanup();
});

async function renderRawPanel(
  api: ApiClient,
  options: { environmentId?: string; initialFilters?: Partial<ErrorFilterValues>; projectId?: string } = {}
) {
  const result = render(
    <ErrorInvestigationPanel
      client={api}
      environmentId={options.environmentId ?? "env_1"}
      initialFilters={options.initialFilters}
      projectId={options.projectId ?? "prj_1"}
    />
  );
  await userEvent.click(screen.getByRole("tab", { name: "Raw occurrences" }));
  return result;
}

describe("ErrorInvestigationPanel", () => {
  it("opens on grouped errors by default", async () => {
    const api = client({
      listErrorGroups: vi.fn().mockResolvedValue({
        data: [errorGroup({ id: "egrp_checkout", message: "Checkout fetch failed" })]
      })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByRole("button", { name: /Checkout fetch failed/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Groups" })).toHaveAttribute("aria-selected", "true");
    expect(api.listErrorGroups).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
    expect(api.listErrors).not.toHaveBeenCalled();
  });

  it("renders grouped errors as a dense incident queue table", async () => {
    const onOpenIncident = vi.fn();
    const api = client({
      listErrorGroups: vi.fn().mockResolvedValue({
        data: [
          errorGroup({
            id: "egrp_checkout",
            message: "Checkout fetch failed",
            occurrenceCount: 12,
            affectedUsersCount: 4,
            affectedTenantsCount: 2,
            latestRelease: "web@1.0.0",
            priority: "high"
          })
        ]
      })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" onOpenIncident={onOpenIncident} projectId="prj_1" />);

    const queue = await screen.findByRole("table", { name: "Grouped error incident queue" });

    for (const heading of ["Issue", "Severity", "Status", "Priority", "Events", "Users", "Tenants", "Release", "Last seen", "Action"]) {
      expect(within(queue).getByRole("columnheader", { name: heading })).toBeInTheDocument();
    }

    const row = within(queue).getByRole("row", { name: /Checkout fetch failed/ });
    expect(row).toHaveTextContent("egrp_checkout");
    expect(row).toHaveTextContent("critical");
    expect(row).toHaveTextContent("open");
    expect(row).toHaveTextContent("high");
    expect(row).toHaveTextContent("12");
    expect(row).toHaveTextContent("4");
    expect(row).toHaveTextContent("2");
    expect(row).toHaveTextContent("web@1.0.0");
    expect(within(row).getByRole("button", { name: "Open incident" })).toBeInTheDocument();
  });

  it("opens an incident from a grouped error", async () => {
    const onOpenIncident = vi.fn();
    const api = client({
      listErrorGroups: vi.fn().mockResolvedValue({
        data: [errorGroup({ id: "egrp_checkout", message: "Checkout fetch failed" })]
      })
    });

    render(
      <ErrorInvestigationPanel
        client={api}
        environmentId="env_1"
        initialTab="groups"
        onOpenIncident={onOpenIncident}
        projectId="prj_1"
      />
    );

    await userEvent.click(await screen.findByRole("button", { name: "Open incident" }));

    expect(onOpenIncident).toHaveBeenCalledWith("egrp_checkout");
  });

  it("makes raw occurrences available as a peer tab", async () => {
    const api = client({
      listErrorGroups: vi.fn().mockResolvedValue({ data: [] }),
      listErrors: vi.fn().mockResolvedValue({ data: [error({ id: "err_1", message: "Checkout fetch failed" })] })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No error groups found");
    await userEvent.click(screen.getByRole("tab", { name: "Raw occurrences" }));

    expect(await screen.findByRole("button", { name: /Checkout fetch failed/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Raw occurrences" })).toHaveAttribute("aria-selected", "true");
    expect(api.listErrors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("updates group status with the active scope", async () => {
    const updatedGroup = errorGroup({ status: "investigating" });
    const updateErrorGroupStatus = vi.fn().mockResolvedValue({ data: updatedGroup });
    const api = client({
      listErrorGroups: vi.fn().mockResolvedValue({
        data: [errorGroup({ id: "egrp_checkout", status: "open" })]
      }),
      updateErrorGroupStatus
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /Checkout fetch failed/ }));
    await userEvent.selectOptions(screen.getByLabelText("Group status"), "investigating");
    await userEvent.click(screen.getByRole("button", { name: "Save status" }));

    await waitFor(() =>
      expect(updateErrorGroupStatus).toHaveBeenCalledWith("egrp_checkout", {
        projectId: "prj_1",
        environmentId: "env_1",
        status: "investigating"
      })
    );
  });

  it("opens raw occurrences filtered to the selected group", async () => {
    const api = client({
      listErrorGroups: vi.fn().mockResolvedValue({
        data: [errorGroup({ id: "egrp_checkout", message: "Checkout fetch failed" })]
      }),
      listErrors: vi.fn().mockResolvedValue({
        data: [error({ id: "err_1", message: "Checkout fetch failed", errorGroupId: "egrp_checkout" })]
      })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /Checkout fetch failed/ }));
    await userEvent.click(screen.getByRole("button", { name: "Show raw occurrences" }));

    expect(screen.getByRole("tab", { name: "Raw occurrences" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("button", { name: /Checkout fetch failed/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Error group")).toHaveValue("egrp_checkout");
    expect(api.listErrors).toHaveBeenLastCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      errorGroupId: "egrp_checkout",
      limit: 50
    });
  });

  it("ignores stale status updates after another group is selected", async () => {
    const save = deferred<{ data: ErrorGroupRecord }>();
    const api = client({
      listErrorGroups: vi.fn().mockResolvedValue({
        data: [
          errorGroup({ id: "egrp_a", message: "Checkout failed A" }),
          errorGroup({ id: "egrp_b", message: "Checkout failed B" })
        ]
      }),
      updateErrorGroupStatus: vi.fn().mockReturnValue(save.promise)
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /Checkout failed A/ }));
    await userEvent.selectOptions(screen.getByLabelText("Group status"), "investigating");
    await userEvent.click(screen.getByRole("button", { name: "Save status" }));
    await userEvent.click(screen.getByRole("button", { name: /Checkout failed B/ }));

    await act(async () => {
      save.resolve({ data: errorGroup({ id: "egrp_a", message: "Checkout failed A", status: "investigating" }) });
      await save.promise;
    });

    expect(screen.getByRole("heading", { name: "Checkout failed B" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Checkout failed A" })).not.toBeInTheDocument();
  });

  it("removes updated groups that no longer match the active status filter", async () => {
    const api = client({
      listErrorGroups: vi.fn().mockResolvedValue({
        data: [errorGroup({ id: "egrp_checkout", message: "Checkout fetch failed", status: "open" })]
      }),
      updateErrorGroupStatus: vi.fn().mockResolvedValue({
        data: errorGroup({ id: "egrp_checkout", message: "Checkout fetch failed", status: "resolved" })
      })
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByRole("button", { name: /Checkout fetch failed/ });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "open");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: /Checkout fetch failed/ }));
    await userEvent.selectOptions(screen.getByLabelText("Group status"), "resolved");
    await userEvent.click(screen.getByRole("button", { name: "Save status" }));

    expect(await screen.findByText("No error groups found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Checkout fetch failed/ })).not.toBeInTheDocument();
  });

  it("shows loading state while latest errors are unresolved", async () => {
    const pending = deferred<{ data: ErrorRecord[] }>();
    const api = client({
      listErrors: vi.fn().mockReturnValue(pending.promise)
    });

    await renderRawPanel(api);

    expect(screen.getByText("Loading errors")).toBeInTheDocument();
    expect(api.listErrors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("loads latest errors for the active project and environment", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [error({ id: "err_1", message: "Checkout fetch failed" })] })
    });

    await renderRawPanel(api);

    expect(await screen.findByText("Checkout fetch failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Checkout fetch failed/ })).toHaveTextContent("trace_1");
    expect(api.listErrors).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("applies initial filters and updates them when they change", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [] })
    });

    const { rerender } = await renderRawPanel(api, { initialFilters: { severity: "critical", status: "open" } });

    expect(await screen.findByText("No errors found")).toBeInTheDocument();
    expect(screen.getByLabelText("Severity")).toHaveValue("critical");
    expect(screen.getByLabelText("Status")).toHaveValue("open");
    expect(api.listErrors).toHaveBeenLastCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      severity: "critical",
      status: "open",
      limit: 50
    });

    rerender(<ErrorInvestigationPanel client={api} environmentId="env_1" initialFilters={{ tenantId: "tenant_1" }} projectId="prj_1" />);

    await waitFor(() =>
      expect(api.listErrors).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        tenantId: "tenant_1",
        limit: 50
      })
    );
    expect(screen.getByLabelText("Severity")).toHaveValue("");
    expect(screen.getByLabelText("Tenant")).toHaveValue("tenant_1");
  });

  it("applies exact filters only after Apply", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [] })
    });

    await renderRawPanel(api);

    await screen.findByText("No errors found");
    await userEvent.type(screen.getByLabelText("Severity"), "critical");
    await userEvent.type(screen.getByLabelText("Status"), "open");
    await userEvent.type(screen.getByLabelText("Fingerprint"), "fp_checkout_fetch");

    expect(api.listErrors).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listErrors).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        severity: "critical",
        status: "open",
        fingerprint: "fp_checkout_fetch",
        limit: 50
      })
    );
  });

  it("resets optional filters and reloads latest errors", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [] })
    });

    await renderRawPanel(api);

    await screen.findByText("No errors found");
    await userEvent.type(screen.getByLabelText("Severity"), "critical");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByLabelText("Severity")).toHaveValue("");
    await waitFor(() =>
      expect(api.listErrors).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 })
    );
  });

  it("defaults empty limits to 50", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [] })
    });

    await renderRawPanel(api);

    await screen.findByText("No errors found");

    await userEvent.clear(screen.getByLabelText("Limit"));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listErrors).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 })
    );
  });

  it("opens the detail drawer when an error is selected", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [error({ id: "err_1", message: "Checkout fetch failed" })] })
    });

    await renderRawPanel(api);

    await userEvent.click(await screen.findByRole("button", { name: /Checkout fetch failed/ }));

    expect(screen.getByRole("heading", { name: "Checkout fetch failed" })).toBeInTheDocument();
    expect(screen.getAllByText("trace_1")).toHaveLength(2);
    expect(screen.getByText(/at checkout\.ts:12:3/)).toBeInTheDocument();
  });

  it("loads source map resolution for the selected raw error", async () => {
    const resolution = deferred<SourceMapResolution>();
    const getErrorSourceMapResolution = vi.fn().mockReturnValue(resolution.promise);
    const api = client({
      listErrors: vi.fn().mockResolvedValue({ data: [error({ id: "err_1", message: "Checkout fetch failed" })] }),
      getErrorSourceMapResolution
    });

    await renderRawPanel(api);
    await userEvent.click(await screen.findByRole("button", { name: /Checkout fetch failed/ }));

    expect(screen.getByText("Resolving source map frames")).toBeInTheDocument();
    expect(getErrorSourceMapResolution).toHaveBeenCalledWith("err_1", { projectId: "prj_1", environmentId: "env_1" });

    await act(async () => {
      resolution.resolve({
        errorId: "err_1",
        release: "1.0.0",
        status: "resolved",
        frames: [
          {
            frameIndex: 0,
            minifiedFile: "assets/app.min.js",
            minifiedLine: 1,
            minifiedColumn: 881,
            originalSource: "src/app.ts",
            originalLine: 42,
            originalColumn: 4,
            originalName: "checkout",
            sourceMapArtifactId: "smap_1"
          }
        ],
        unresolvedFrameCount: 0
      });
      await resolution.promise;
    });

    expect(await screen.findByText("src/app.ts:42:4")).toBeInTheDocument();
    expect(screen.getByText("checkout")).toBeInTheDocument();
  });

  it("loads session context for a selected raw error with a session id", async () => {
    const getSessionTimeline = vi.fn().mockResolvedValue({
      data: {
        sessionId: "sess_1",
        scope: { projectId: "prj_1", environmentId: "env_1" },
        range: { from: null, to: null },
        items: [
          {
            id: "brd_1",
            type: "breadcrumb",
            timestamp: "2026-05-11T11:59:00.000Z",
            receivedAt: "2026-05-11T11:59:01.000Z",
            tenantId: null,
            userId: "user_1",
            sessionId: "sess_1",
            traceId: null,
            source: "web",
            release: "web@1.0.0",
            title: "Clicked Pay",
            level: "info",
            data: {}
          }
        ],
        page: { nextCursor: null, previousCursor: null }
      }
    });
    const api = client({
      listErrors: vi.fn().mockResolvedValue({
        data: [error({ id: "err_1", sessionId: "sess_1", timestamp: "2026-05-11T12:00:00.000Z" })]
      }),
      getSessionTimeline
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" initialTab="raw" projectId="prj_1" />);
    await userEvent.click(await screen.findByRole("button", { name: /Checkout fetch failed/ }));

    expect(await screen.findByText("Session context")).toBeInTheDocument();
    expect(await screen.findByText("Clicked Pay")).toBeInTheDocument();
    expect(getSessionTimeline).toHaveBeenCalledWith("sess_1", {
      projectId: "prj_1",
      environmentId: "env_1",
      center: "2026-05-11T12:00:00.000Z",
      beforeSeconds: 600,
      afterSeconds: 120,
      limit: 100
    });
  });

  it("does not show the previous session timeline immediately after selecting another raw error", async () => {
    const firstTimeline = deferred<{ data: Awaited<ReturnType<ApiClient["getSessionTimeline"]>>["data"] }>();
    const secondTimeline = deferred<{ data: Awaited<ReturnType<ApiClient["getSessionTimeline"]>>["data"] }>();
    const getSessionTimeline = vi.fn().mockReturnValueOnce(firstTimeline.promise).mockReturnValueOnce(secondTimeline.promise);
    const api = client({
      listErrors: vi.fn().mockResolvedValue({
        data: [
          error({ id: "err_1", message: "First payment failed", sessionId: "sess_1", timestamp: "2026-05-11T12:00:00.000Z" }),
          error({ id: "err_2", message: "Second payment failed", sessionId: "sess_2", timestamp: "2026-05-11T12:01:00.000Z" })
        ]
      }),
      getSessionTimeline
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" initialTab="raw" projectId="prj_1" />);
    await userEvent.click(await screen.findByRole("button", { name: /First payment failed/ }));
    await waitFor(() => expect(getSessionTimeline).toHaveBeenCalledWith("sess_1", expect.any(Object)));

    flushSync(() => {
      fireEvent.click(screen.getByRole("button", { name: /Second payment failed/ }));
    });

    await act(async () => {
      firstTimeline.resolve({
        data: {
          sessionId: "sess_1",
          scope: { projectId: "prj_1", environmentId: "env_1" },
          range: { from: null, to: null },
          items: [
            {
              id: "brd_1",
              type: "breadcrumb",
              timestamp: "2026-05-11T11:59:00.000Z",
              receivedAt: "2026-05-11T11:59:01.000Z",
              tenantId: null,
              userId: "user_1",
              sessionId: "sess_1",
              traceId: null,
              source: "web",
              release: "web@1.0.0",
              title: "Old checkout step",
              level: "info",
              data: {}
            }
          ],
          page: { nextCursor: null, previousCursor: null }
        }
      });
      await firstTimeline.promise;
    });

    expect(screen.queryByText("Old checkout step")).not.toBeInTheDocument();
    expect(screen.getByText("Loading session context")).toBeInTheDocument();
  });

  it("shows session context unavailable when the selected raw error timeline request fails", async () => {
    const api = client({
      listErrors: vi.fn().mockResolvedValue({
        data: [error({ id: "err_1", sessionId: "sess_1", timestamp: "2026-05-11T12:00:00.000Z" })]
      }),
      getSessionTimeline: vi.fn().mockRejectedValue(new Error("timeline failed"))
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" initialTab="raw" projectId="prj_1" />);
    await userEvent.click(await screen.findByRole("button", { name: /Checkout fetch failed/ }));

    expect(await screen.findByText("Session context unavailable.")).toBeInTheDocument();
  });

  it("does not load session context for selected raw errors without a session id", async () => {
    const getSessionTimeline = vi.fn();
    const api = client({
      listErrors: vi.fn().mockResolvedValue({
        data: [error({ id: "err_1", sessionId: null, timestamp: "2026-05-11T12:00:00.000Z" })]
      }),
      getSessionTimeline
    });

    render(<ErrorInvestigationPanel client={api} environmentId="env_1" initialTab="raw" projectId="prj_1" />);
    await userEvent.click(await screen.findByRole("button", { name: /Checkout fetch failed/ }));

    expect(screen.queryByText("Session context")).not.toBeInTheDocument();
    expect(getSessionTimeline).not.toHaveBeenCalled();
  });

  it("shows unavailable state and retries after query failure", async () => {
    const api = client({
      listErrors: vi.fn().mockRejectedValueOnce(new Error("query failed")).mockResolvedValueOnce({ data: [] })
    });

    await renderRawPanel(api);

    expect(await screen.findByText("Errors unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No errors found")).toBeInTheDocument();
  });

  it("ignores stale error responses after scope changes", async () => {
    const first = deferred<{ data: ErrorRecord[] }>();
    const api = client({
      listErrors: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ data: [error({ id: "err_2", environmentId: "env_2", message: "New scope failed" })] })
    });

    const { rerender } = await renderRawPanel(api);

    rerender(<ErrorInvestigationPanel client={api} environmentId="env_2" projectId="prj_1" />);

    expect(await screen.findByText("New scope failed")).toBeInTheDocument();

    await act(async () => {
      first.resolve({ data: [error({ id: "err_1", message: "Old scope failed" })] });
      await first.promise;
    });

    expect(screen.queryByText("Old scope failed")).not.toBeInTheDocument();
    expect(screen.getByText("New scope failed")).toBeInTheDocument();
  });

  it("opens an incident from a raw error occurrence", async () => {
    const onOpenIncident = vi.fn();
    const api = client({
      listErrors: vi.fn().mockResolvedValue({
        data: [error({ id: "err_1", message: "Checkout fetch failed", errorGroupId: "egrp_checkout" })]
      })
    });

    render(
      <ErrorInvestigationPanel
        client={api}
        environmentId="env_1"
        initialTab="raw"
        onOpenIncident={onOpenIncident}
        projectId="prj_1"
      />
    );

    await userEvent.click(await screen.findByRole("button", { name: "Open incident" }));

    expect(onOpenIncident).toHaveBeenCalledWith("egrp_checkout", { errorId: "err_1" });
  });
});

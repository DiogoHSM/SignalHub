import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import type {
  EventClickMapResponse,
  EventFunnelResponse,
  EventPathsResponse,
  EventPropertyCatalogResponse,
  EventRecord,
  EventRetentionResponse
} from "../api/types";
import { EventInvestigationPanel } from "./EventInvestigationPanel";

function event(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: "evt_1",
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
    name: "checkout.started",
    properties: {},
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
    listEvents: vi.fn().mockResolvedValue({ data: [] }),
    listErrors: vi.fn(),
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
    getEventAggregates: vi.fn(),
    getEventPropertyCatalog: vi.fn().mockResolvedValue({
      data: emptyPropertyCatalog()
    }),
    getEventClickMap: vi.fn().mockResolvedValue({
      data: emptyClickMap()
    }),
    getEventFunnel: vi.fn().mockResolvedValue({
      data: emptyFunnel()
    }),
    getEventRetention: vi.fn().mockResolvedValue({
      data: emptyRetention()
    }),
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
    ...overrides
  };
}

function emptyFunnel(): EventFunnelResponse {
  return {
    window: "7d",
    generatedAt: "2026-05-05T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
    totals: { entrants: 0, completed: 0, conversionPercent: 0 },
    steps: [],
    sampleActors: []
  };
}

function emptyPaths(): EventPathsResponse {
  return {
    window: "7d",
    generatedAt: "2026-05-05T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
    filters: {
      startEvent: "signup.started",
      endEvent: "key.created",
      tenantId: null,
      userId: null,
      sessionId: null,
      traceId: null,
      segmentId: null,
      actorType: "auto",
      pathLength: 5
    },
    totals: { actors: 0, paths: 0, events: 0 },
    paths: []
  };
}

function emptyPropertyCatalog(): EventPropertyCatalogResponse {
  return {
    window: "7d",
    generatedAt: "2026-05-05T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
    totals: { events: 0, properties: 0, conflictProperties: 0, similarNameGroups: 0 },
    properties: [],
    similarNameGroups: []
  };
}

function emptyRetention(): EventRetentionResponse {
  return {
    window: "30d",
    generatedAt: "2026-05-05T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-04-05T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
    entryEvent: "signup.started",
    returnEvent: "app.opened",
    period: "weekly",
    intervals: 6,
    totals: { cohorts: 0, entrants: 0 },
    cohorts: []
  };
}

function emptyClickMap(): EventClickMapResponse {
  return {
    window: "7d",
    generatedAt: "2026-05-05T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" },
    filters: { route: "/", selector: null, tenantId: null, userId: null, sessionId: null, gridSize: 20 },
    totals: { clicks: 0, routes: 0, selectors: 0 },
    routes: [],
    selectors: [],
    points: []
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

describe("EventInvestigationPanel", () => {
  it("loads latest events for the active project and environment", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [event({ id: "evt_1", name: "checkout.started" })] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByRole("button", { name: /checkout.started/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /checkout.started/ })).toHaveTextContent("trace_1");
    expect(api.listEvents).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 });
  });

  it("summarizes event analytics and highlights top event names from the current result set", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({
        data: [
          event({
            id: "evt_1",
            name: "checkout.started",
            tenantId: "tenant_a",
            userId: "user_1",
            source: "browser",
            properties: { plan: "team", amount: 1200 }
          }),
          event({
            id: "evt_2",
            name: "checkout.started",
            tenantId: "tenant_a",
            userId: "user_2",
            source: "server",
            properties: { plan: "team" }
          }),
          event({
            id: "evt_3",
            name: "invoice.paid",
            tenantId: "tenant_b",
            userId: null,
            source: null,
            properties: { channel: "pix" }
          })
        ]
      })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByRole("region", { name: "Event analytics summary" })).toBeInTheDocument();
    expect(screen.getByLabelText("Total events")).toHaveTextContent("3");
    expect(screen.getByLabelText("Unique event names")).toHaveTextContent("2");
    expect(screen.getByLabelText("Tenants observed")).toHaveTextContent("2");
    expect(screen.getByLabelText("Known users")).toHaveTextContent("2");
    expect(screen.getByRole("region", { name: "Top event names" })).toHaveTextContent("checkout.started");
    expect(screen.getByRole("region", { name: "Top event names" })).toHaveTextContent("2 events");
    const checkoutRows = screen.getAllByRole("button", { name: /checkout.started/ });
    expect(checkoutRows[0]).toHaveTextContent("browser");
    expect(checkoutRows[0]).toHaveTextContent("plan: team");
    expect(screen.getByRole("button", { name: /invoice.paid/ })).toHaveTextContent("anonymous");
    expect(screen.getByRole("button", { name: /invoice.paid/ })).toHaveTextContent("channel: pix");
  });

  it("shows event property governance with type conflicts and similar property names", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [event({ id: "evt_1", name: "checkout.started" })] }),
      getEventPropertyCatalog: vi.fn().mockResolvedValue({
        data: {
          ...emptyPropertyCatalog(),
          totals: { events: 3, properties: 2, conflictProperties: 1, similarNameGroups: 1 },
          properties: [
            {
              eventName: "checkout.started",
              propertyName: "amount",
              totalOccurrences: 2,
              eventCount: 2,
              coveragePercent: 100,
              dominantType: "number",
              typeCounts: { number: 1, string: 1 },
              hasTypeConflict: true,
              sampleValues: ["1200"],
              similarPropertyNames: [],
              lastSeenAt: "2026-05-04T12:00:00.000Z"
            },
            {
              eventName: "checkout.started",
              propertyName: "plan",
              totalOccurrences: 1,
              eventCount: 2,
              coveragePercent: 50,
              dominantType: "string",
              typeCounts: { string: 1 },
              hasTypeConflict: false,
              sampleValues: ["team"],
              similarPropertyNames: ["Plan"],
              lastSeenAt: "2026-05-04T12:00:00.000Z"
            }
          ],
          similarNameGroups: [{ normalizedName: "plan", propertyNames: ["Plan", "plan"], eventNames: ["checkout.started"] }]
        }
      })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByRole("region", { name: "Event property governance" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Event property governance" })).toHaveTextContent("Type conflicts1");
    expect(screen.getByRole("region", { name: "Event property governance" })).toHaveTextContent("amount");
    expect(screen.getByRole("region", { name: "Event property governance" })).toHaveTextContent("number 1 / string 1");
    expect(screen.getByRole("region", { name: "Event property governance" })).toHaveTextContent("Similar: Plan");
    expect(api.getEventPropertyCatalog).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      limit: 50
    });
  });

  it("loads click map density and selector drilldowns", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [event({ id: "evt_1", name: "checkout.started" })] }),
      getEventClickMap: vi.fn().mockResolvedValue({
        data: {
          ...emptyClickMap(),
          filters: { route: "/checkout", selector: null, tenantId: null, userId: null, sessionId: null, gridSize: 20 },
          totals: { clicks: 3, routes: 1, selectors: 1 },
          routes: [{ route: "/checkout", clicks: 3, selectors: 1, lastSeenAt: "2026-05-05T12:00:00.000Z" }],
          selectors: [
            {
              selector: '[data-sigmon-id="submit"]',
              clicks: 3,
              route: "/checkout",
              elementTag: "button",
              elementRole: "button",
              lastSeenAt: "2026-05-05T12:00:00.000Z"
            }
          ],
          points: [{ xBucket: 10, yBucket: 8, clicks: 3, selectors: 1, lastSeenAt: "2026-05-05T12:00:00.000Z" }]
        }
      })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.clear(await screen.findByLabelText("Route"));
    await userEvent.type(screen.getByLabelText("Route"), "/checkout");
    await userEvent.click(screen.getByRole("button", { name: "Load click map" }));

    expect(await screen.findByRole("region", { name: "Click map" })).toHaveTextContent("Clicks3");
    expect(screen.getByRole("img", { name: "Click density for /checkout" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Click map" })).toHaveTextContent('[data-sigmon-id="submit"]');
    expect(api.getEventClickMap).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      route: "/checkout",
      tenantId: undefined,
      userId: undefined,
      sessionId: undefined,
      gridSize: 20,
      limit: 80
    });
  });

  it("runs user journey paths and drills into sample events", async () => {
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce({ data: [event({ id: "evt_1", name: "signup.started", tenantId: "tenant_1" })] })
      .mockResolvedValue({ data: [event({ id: "evt_path_2", name: "project.created" })] });
    const api = client({
      listEvents,
      getEventPaths: vi.fn().mockResolvedValue({
        data: {
          ...emptyPaths(),
          totals: { actors: 2, paths: 1, events: 6 },
          paths: [
            {
              path: ["signup.started", "project.created", "key.created"],
              actors: 2,
              occurrences: 2,
              firstSeenAt: "2026-05-04T12:00:00.000Z",
              lastSeenAt: "2026-05-04T12:02:00.000Z",
              sampleEvents: [
                {
                  id: "evt_path_1",
                  name: "signup.started",
                  timestamp: "2026-05-04T12:00:00.000Z",
                  actorId: "user_1",
                  actorType: "user"
                },
                {
                  id: "evt_path_2",
                  name: "project.created",
                  timestamp: "2026-05-04T12:01:00.000Z",
                  actorId: "user_1",
                  actorType: "user"
                }
              ]
            }
          ]
        }
      })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.clear(await screen.findByLabelText("End event"));
    await userEvent.type(screen.getByLabelText("End event"), "key.created");
    await userEvent.click(screen.getByRole("button", { name: "Find paths" }));

    expect(await screen.findByRole("region", { name: "User journey paths" })).toHaveTextContent(
      "signup.started -> project.created -> key.created"
    );
    expect(api.getEventPaths).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      startEvent: "signup.started",
      endEvent: "key.created",
      tenantId: undefined,
      userId: undefined,
      sessionId: undefined,
      traceId: undefined,
      from: undefined,
      to: undefined,
      segmentId: undefined,
      actorType: "auto",
      pathLength: 5,
      limit: 20
    });

    await userEvent.click(screen.getByRole("button", { name: "project.created" }));
    await waitFor(() => {
      expect(listEvents).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        eventId: "evt_path_2",
        limit: 1
      });
    });
  });

  it("runs a conversion funnel from two or more event steps", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [event({ id: "evt_1", name: "signup.started" })] }),
      getEventFunnel: vi.fn().mockResolvedValue({
        data: {
          ...emptyFunnel(),
          totals: { entrants: 4, completed: 1, conversionPercent: 25 },
          steps: [
            { index: 0, name: "signup.started", actors: 4, conversionPercent: 100, dropOffFromPreviousPercent: 0 },
            { index: 1, name: "project.created", actors: 2, conversionPercent: 50, dropOffFromPreviousPercent: 50 },
            { index: 2, name: "key.created", actors: 1, conversionPercent: 25, dropOffFromPreviousPercent: 50 }
          ],
          sampleActors: [
            {
              actorId: "user_1",
              actorType: "user",
              reachedStepIndex: 2,
              reachedStepName: "key.created",
              lastSeenAt: "2026-05-04T12:02:00.000Z"
            }
          ]
        }
      })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.clear(await screen.findByLabelText("Funnel steps"));
    await userEvent.type(screen.getByLabelText("Funnel steps"), "signup.started\nproject.created\nkey.created");
    await userEvent.click(screen.getByRole("button", { name: "Run funnel" }));

    expect(await screen.findByRole("region", { name: "Conversion funnel" })).toHaveTextContent("25%");
    expect(screen.getByRole("region", { name: "Conversion funnel" })).toHaveTextContent("signup.started");
    expect(screen.getByRole("region", { name: "Conversion funnel" })).toHaveTextContent("project.created");
    expect(screen.getByRole("region", { name: "Conversion funnel" })).toHaveTextContent("Drop-off 50%");
    expect(api.getEventFunnel).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      steps: ["signup.started", "project.created", "key.created"],
      limit: 20
    });
  });

  it("creates a saved segment and applies it as an event filter", async () => {
    const savedSegments = [
      {
        id: "seg_1",
        projectId: "prj_1",
        environmentId: "env_1",
        name: "Team creators",
        description: null,
        actorType: "user" as const,
        definition: { window: "30d" as const, eventName: "project.created", propertyName: "plan", propertyValue: "team" },
        createdAt: "2026-05-04T12:00:00.000Z",
        updatedAt: "2026-05-04T12:00:00.000Z",
        archivedAt: null
      }
    ];
    const listAnalyticsSegments = vi
      .fn()
      .mockResolvedValueOnce({ segments: [] })
      .mockResolvedValue({ segments: savedSegments });
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [event({ id: "evt_1", name: "project.created" })] }),
      listAnalyticsSegments,
      createAnalyticsSegment: vi.fn().mockResolvedValue({ segment: { id: "seg_1" } }),
      previewAnalyticsSegment: vi.fn().mockResolvedValue({
        preview: {
          segmentId: "seg_1",
          actorType: "user",
          window: "30d",
          actors: 1,
          samples: [{ actorId: "user_1", lastSeenAt: "2026-05-04T12:00:00.000Z" }]
        }
      })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    const segmentRegion = await screen.findByRole("region", { name: "Saved segments" });
    await userEvent.type(within(segmentRegion).getByLabelText("Segment name"), "Team creators");
    await userEvent.type(within(segmentRegion).getByLabelText("Event name"), "project.created");
    await userEvent.type(within(segmentRegion).getByLabelText("Property name"), "plan");
    await userEvent.type(within(segmentRegion).getByLabelText("Property value"), "team");
    await userEvent.click(within(segmentRegion).getByRole("button", { name: "Create segment" }));

    expect(api.createAnalyticsSegment).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Team creators",
      actorType: "user",
      definition: { window: "30d", eventName: "project.created", propertyName: "plan", propertyValue: "team" }
    });
    expect(await screen.findByText("Team creators")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Use as filter" }));
    expect(api.listEvents).toHaveBeenLastCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      limit: 50,
      segmentId: "seg_1"
    });
  });

  it("runs retention curves for entry and return events", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [event({ id: "evt_1", name: "signup.started" })] }),
      getEventRetention: vi.fn().mockResolvedValue({
        data: {
          ...emptyRetention(),
          totals: { cohorts: 1, entrants: 4 },
          cohorts: [
            {
              cohortStart: "2026-05-04T00:00:00.000Z",
              cohortLabel: "2026-05-04",
              entrants: 4,
              intervals: [
                { index: 0, label: "W0", retainedActors: 3, retentionPercent: 75 },
                { index: 1, label: "W1", retainedActors: 2, retentionPercent: 50 },
                { index: 2, label: "W2", retainedActors: 1, retentionPercent: 25 },
                { index: 3, label: "W3", retainedActors: 0, retentionPercent: 0 },
                { index: 4, label: "W4", retainedActors: 0, retentionPercent: 0 },
                { index: 5, label: "W5", retainedActors: 0, retentionPercent: 0 }
              ]
            }
          ]
        }
      })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.clear(await screen.findByLabelText("Entry event"));
    await userEvent.type(screen.getByLabelText("Entry event"), "signup.started");
    await userEvent.clear(screen.getByLabelText("Return event"));
    await userEvent.type(screen.getByLabelText("Return event"), "app.opened");
    await userEvent.click(screen.getByRole("button", { name: "Run retention" }));

    expect(await screen.findByRole("region", { name: "Retention curves" })).toHaveTextContent("2026-05-04");
    expect(screen.getByRole("region", { name: "Retention curves" })).toHaveTextContent("75%");
    expect(screen.getByRole("region", { name: "Retention curves" })).toHaveTextContent("W1");
    expect(api.getEventRetention).toHaveBeenCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "30d",
      entryEvent: "signup.started",
      returnEvent: "app.opened",
      period: "weekly",
      intervals: 6
    });
  });

  it("applies initial filters and updates them when they change", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] })
    });

    const { rerender } = render(
      <EventInvestigationPanel client={api} environmentId="env_1" initialFilters={{ eventName: "dashboard_created" }} projectId="prj_1" />
    );

    expect(await screen.findByText("No events found")).toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveValue("dashboard_created");
    expect(api.listEvents).toHaveBeenLastCalledWith({
      projectId: "prj_1",
      environmentId: "env_1",
      eventName: "dashboard_created",
      limit: 50
    });

    rerender(<EventInvestigationPanel client={api} environmentId="env_1" initialFilters={{ tenantId: "tenant_1" }} projectId="prj_1" />);

    await waitFor(() =>
      expect(api.listEvents).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        tenantId: "tenant_1",
        limit: 50
      })
    );
    expect(screen.getByLabelText("Event name")).toHaveValue("");
    expect(screen.getByLabelText("Tenant")).toHaveValue("tenant_1");
  });

  it("applies event name filters only after Apply", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No events found");
    await userEvent.type(screen.getByLabelText("Event name"), "checkout.started");

    expect(api.listEvents).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(api.listEvents).toHaveBeenLastCalledWith({
        projectId: "prj_1",
        environmentId: "env_1",
        eventName: "checkout.started",
        limit: 50
      })
    );
  });

  it("resets optional filters and reloads latest events", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await screen.findByText("No events found");
    await userEvent.type(screen.getByLabelText("Event name"), "checkout.started");
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByLabelText("Event name")).toHaveValue("");
    await waitFor(() =>
      expect(api.listEvents).toHaveBeenLastCalledWith({ projectId: "prj_1", environmentId: "env_1", limit: 50 })
    );
  });

  it("opens the detail drawer when an event is selected", async () => {
    const api = client({
      listEvents: vi.fn().mockResolvedValue({ data: [event({ id: "evt_1", name: "checkout.started" })] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    await userEvent.click(await screen.findByRole("button", { name: /checkout.started/ }));

    expect(screen.getByRole("heading", { name: "checkout.started" })).toBeInTheDocument();
    expect(screen.getAllByText("trace_1")).toHaveLength(2);
  });

  it("shows unavailable state and retries after query failure", async () => {
    const api = client({
      listEvents: vi.fn().mockRejectedValueOnce(new Error("query failed")).mockResolvedValueOnce({ data: [] })
    });

    render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    expect(await screen.findByText("Events unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No events found")).toBeInTheDocument();
  });

  it("ignores stale event responses after scope changes", async () => {
    const first = deferred<{ data: EventRecord[] }>();
    const api = client({
      listEvents: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ data: [event({ id: "evt_2", environmentId: "env_2", name: "new.scope" })] })
    });

    const { rerender } = render(<EventInvestigationPanel client={api} environmentId="env_1" projectId="prj_1" />);

    rerender(<EventInvestigationPanel client={api} environmentId="env_2" projectId="prj_1" />);

    expect(await screen.findByRole("button", { name: /new.scope/ })).toBeInTheDocument();

    await act(async () => {
      first.resolve({ data: [event({ id: "evt_1", name: "old.scope" })] });
      await first.promise;
    });

    expect(screen.queryByText("old.scope")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new.scope/ })).toBeInTheDocument();
  });
});

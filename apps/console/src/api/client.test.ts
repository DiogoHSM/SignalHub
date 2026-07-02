import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./client";
import type { CreatedSourceMapUploadToken, NotificationChannelResponse, OverviewQuery, SourceMapUploadToken } from "./types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function overviewResponse() {
  return {
    window: "24h",
    generatedAt: "2026-05-05T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-05-04T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z", bucket: "hour" },
    kpis: {
      events: 0,
      activeUsers: 0,
      activeTenants: 0,
      errors: 0,
      openErrors: 0,
      traces: 0,
      failedTraces: 0,
      averageTraceDurationMs: 0,
      p95TraceDurationMs: null,
      llmCalls: 0,
      failedLlmCalls: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      llmCostUsd: "0"
    },
    trends: { usage: [], errors: [], latency: [], aiCost: [] },
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
    recent: { errors: [], failedTraces: [], failedLlmCalls: [] }
  };
}

function operationsResponse() {
  return {
    window: "24h",
    generatedAt: "2026-05-25T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "2026-05-24T12:00:00.000Z", to: "2026-05-25T12:00:00.000Z" },
    status: "healthy",
    summary: {
      monitors: {
        total: 0,
        http: { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 },
        heartbeat: { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 }
      },
      alerts: {
        rules: { total: 0, enabled: 0 },
        events: { total: 0, critical: 0, warning: 0, deliveryFailed: 0, deliveryPending: 0 }
      },
      telemetry: {
        events: 0,
        errors: 0,
        traces: 0,
        failedTraces: 0,
        errorRatePercent: null,
        p95TraceDurationMs: null,
        lastEventAt: null,
        lastErrorAt: null,
        lastTraceAt: null
      },
      incidents: { open: 0, investigating: 0, urgent: 0, high: 0, regressed: 0 }
    },
    recent: { monitors: [], alerts: [], incidents: [] },
    topLatency: [],
    setupGaps: []
  };
}

describe("createApiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("login sends credentials, JSON headers, and POST body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { user: { id: "usr_1", email: "admin@example.com", isAdmin: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().login("admin@example.com", "very-secure-password");

    expect(fetchMock).toHaveBeenCalledWith("/auth/login", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email: "admin@example.com", password: "very-secure-password" })
    });
  });

  it("throws ApiError with status and code for non-OK JSON errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { error: "admin_required" })));

    const request = createApiClient().listUsers();
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      code: "admin_required"
    });
  });

  it("falls back to request_failed for non-OK invalid JSON errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 500 })));

    const request = createApiClient().listUsers();
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      status: 500,
      code: "request_failed"
    });
  });

  it("falls back to request_failed for non-OK missing JSON errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emptyResponse(500)));

    const request = createApiClient().listUsers();
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      status: 500,
      code: "request_failed"
    });
  });

  it("returns undefined for 204 delete/archive responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emptyResponse(204)));

    await expect(createApiClient().archiveProject("prj_1")).resolves.toBeUndefined();
  });

  it("encodes path IDs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project: { id: "prj/1", name: "Name" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().updateProject("prj/1", { name: "Name" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/projects/prj%2F1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Name" })
      })
    );
  });

  it("encodes query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listEvents({ projectId: "prj/1", environmentId: "env 1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes trace query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listTraces({
      projectId: "prj_1",
      environmentId: "env_1",
      traceId: "trace_1",
      traceName: "GET /api/orders",
      status: "success",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      from: "2026-05-04T12:00:00.000Z",
      to: "2026-05-04T13:00:00.000Z",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/traces?project_id=prj_1&environment_id=env_1&tenant_id=tenant_1&user_id=user_1&session_id=session_1&trace_id=trace_1&trace_name=GET+%2Fapi%2Forders&status=success&from=2026-05-04T12%3A00%3A00.000Z&to=2026-05-04T13%3A00%3A00.000Z&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes trace span query path and scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listTraceSpans("trace/1", {
      projectId: "prj_1",
      environmentId: "env_1"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/traces/trace%2F1/spans?project_id=prj_1&environment_id=env_1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("gets a session timeline with scoped filters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { data: { sessionId: "sess_1", items: [], page: { nextCursor: null, previousCursor: null } } })
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = createApiClient("/api");

    await client.getSessionTimeline("sess/1", {
      projectId: "prj/1",
      environmentId: "env 1",
      center: "2026-05-11T12:00:00.000Z",
      beforeSeconds: 600,
      afterSeconds: 120,
      types: ["breadcrumb", "error"],
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/sessions/sess%2F1/timeline?project_id=prj%2F1&environment_id=env+1&center=2026-05-11T12%3A00%3A00.000Z&before=600&after=120&types=breadcrumb%2Cerror&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("gets session replay detail with scoped product event markers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          replayId: "rpl_1",
          events: [],
          productEvents: [{ id: "evt_1", name: "checkout.clicked", offsetMs: 2500 }]
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createApiClient("/api");
    expect(client.getSessionReplayDetail).toBeDefined();

    await client.getSessionReplayDetail!("rpl/1", {
      projectId: "prj/1",
      environmentId: "env 1"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/replays/rpl%2F1?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("lists session replay samples with segment and event filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient("/api");
    expect(client.listSessionReplays).toBeDefined();

    await client.listSessionReplays!({
      projectId: "prj/1",
      environmentId: "env 1",
      segmentId: "seg_1",
      eventName: "checkout.started",
      tenantId: "tenant_1",
      limit: 10
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/replays?project_id=prj%2F1&environment_id=env+1&tenant_id=tenant_1&event_name=checkout.started&segment_id=seg_1&limit=10",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("gets a session timeline with optional filters and serialized Date values", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { data: { sessionId: "sess_1", items: [], page: { nextCursor: null, previousCursor: null } } })
      );
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").getSessionTimeline("sess_1", {
      projectId: "prj_1",
      environmentId: "env_1",
      tenantId: "tenant/1",
      userId: "user 1",
      from: new Date("2026-05-11T11:50:00.000Z"),
      to: new Date("2026-05-11T12:10:00.000Z"),
      center: new Date("2026-05-11T12:00:00.000Z")
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1&tenant_id=tenant%2F1&user_id=user+1&from=2026-05-11T11%3A50%3A00.000Z&to=2026-05-11T12%3A10%3A00.000Z&center=2026-05-11T12%3A00%3A00.000Z",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not encode unsupported session timeline cursors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { data: { sessionId: "sess_1", items: [], page: { nextCursor: null, previousCursor: null } } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const queryWithUnsupportedCursor = {
      projectId: "prj_1",
      environmentId: "env_1",
      cursor: "cursor_1"
    };

    await createApiClient("/api").getSessionTimeline("sess_1", queryWithUnsupportedCursor);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/sessions/sess_1/timeline?project_id=prj_1&environment_id=env_1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes LLM call query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listLlmCalls({
      projectId: "prj_1",
      environmentId: "env_1",
      provider: "openai",
      model: "gpt-5",
      promptName: "generate_sql",
      status: "success",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      traceId: "trace_1",
      from: "2026-05-05T12:00:00.000Z",
      to: "2026-05-05T13:00:00.000Z",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/llm-calls?project_id=prj_1&environment_id=env_1&tenant_id=tenant_1&user_id=user_1&session_id=session_1&trace_id=trace_1&provider=openai&model=gpt-5&prompt_name=generate_sql&status=success&from=2026-05-05T12%3A00%3A00.000Z&to=2026-05-05T13%3A00%3A00.000Z&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes LLM aggregate filters without list-only limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } })
      );
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getLlmAggregates({
      projectId: "prj_1",
      environmentId: "env_1",
      provider: "openai",
      model: "gpt-5",
      promptName: "generate_sql",
      status: "success",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/aggregates/llm?project_id=prj_1&environment_id=env_1&provider=openai&model=gpt-5&prompt_name=generate_sql&status=success",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes overview query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: overviewResponse() }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getOverview({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/overview?project_id=prj_1&environment_id=env_1&window=7d",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes overview release filters and release list query params", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: overviewResponse() }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { releases: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient();
    await client.getOverview({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      release: "web@1.2.3"
    });
    await client.listReleases!({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      limit: 8
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/query/overview?project_id=prj_1&environment_id=env_1&window=7d&release=web%401.2.3",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/query/releases?project_id=prj_1&environment_id=env_1&window=7d&limit=8",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes operations query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: operationsResponse() }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getOperations?.({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/operations?project_id=prj_1&environment_id=env_1&window=7d",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes APM endpoint query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { endpoints: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getApmEndpoints?.({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "24h",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/apm/endpoints?project_id=prj_1&environment_id=env_1&window=24h&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes service map query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { edges: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getServiceMap?.({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      limit: 10
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/apm/service-map?project_id=prj_1&environment_id=env_1&window=7d&limit=10",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes web vitals query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { metrics: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getWebVitals?.({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "30d",
      limit: 15
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/apm/web-vitals?project_id=prj_1&environment_id=env_1&window=30d&limit=15",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes event property catalog query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { properties: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getEventPropertyCatalog?.({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events/properties?project_id=prj_1&environment_id=env_1&window=7d&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes event click map query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { points: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getEventClickMap?.({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      route: "/checkout",
      selector: '[data-sigmon-id="submit"]',
      tenantId: "tenant_1",
      gridSize: 20,
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events/click-map?project_id=prj_1&environment_id=env_1&window=7d&route=%2Fcheckout&selector=%5Bdata-sigmon-id%3D%22submit%22%5D&tenant_id=tenant_1&grid_size=20&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes event funnel query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { steps: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getEventFunnel?.({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "30d",
      steps: ["signup.started", "project.created"],
      limit: 20
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events/funnel?project_id=prj_1&environment_id=env_1&window=30d&limit=20&steps=signup.started%2Cproject.created",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes event pathfinder query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { paths: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getEventPaths?.({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "30d",
      startEvent: "signup.started",
      endEvent: "key.created",
      tenantId: "tenant_1",
      segmentId: "seg_1",
      actorType: "user",
      pathLength: 4,
      limit: 20,
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-08T00:00:00.000Z"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events/paths?project_id=prj_1&environment_id=env_1&window=30d&limit=20&start_event=signup.started&end_event=key.created&tenant_id=tenant_1&segment_id=seg_1&actor=user&from=2026-05-01T00%3A00%3A00.000Z&to=2026-05-08T00%3A00%3A00.000Z&max_depth=4",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes event retention query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { cohorts: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getEventRetention?.({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "30d",
      entryEvent: "signup.started",
      returnEvent: "app.opened",
      period: "daily",
      intervals: 7
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events/retention?project_id=prj_1&environment_id=env_1&window=30d&entry_event=signup.started&return_event=app.opened&period=daily&intervals=7",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes event segment filters in event queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listEvents({
      projectId: "prj_1",
      environmentId: "env_1",
      segmentId: "seg_1",
      limit: 50
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events?project_id=prj_1&environment_id=env_1&segment_id=seg_1&limit=50",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes event id filters in event queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listEvents({
      projectId: "prj_1",
      environmentId: "env_1",
      eventId: "evt_1",
      limit: 1
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events?project_id=prj_1&environment_id=env_1&event_id=evt_1&limit=1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("manages analytics segments through admin endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { segments: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").listAnalyticsSegments?.({ projectId: "prj_1", environmentId: "env_1" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/analytics-segments?project_id=prj_1&environment_id=env_1",
      expect.objectContaining({ method: "GET" })
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(201, { segment: { id: "seg_1" } }));
    await createApiClient("/api").createAnalyticsSegment?.({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Team creators",
      actorType: "user",
      definition: { window: "30d", eventName: "project.created" }
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/analytics-segments",
      expect.objectContaining({ method: "POST" })
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { preview: { actors: 1 } }));
    await createApiClient("/api").previewAnalyticsSegment?.("seg/1", {
      projectId: "prj_1",
      environmentId: "env_1",
      limit: 3
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/analytics-segments/seg%2F1/preview?project_id=prj_1&environment_id=env_1&limit=3",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("manages analytics dashboards and fetches reports", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { dashboards: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").listAnalyticsDashboards?.({ projectId: "prj_1", environmentId: "env_1" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/analytics-dashboards?project_id=prj_1&environment_id=env_1",
      expect.objectContaining({ method: "GET" })
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(201, { dashboard: { id: "dash_1" } }));
    await createApiClient("/api").createAnalyticsDashboard?.({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Operations report",
      widgets: [
        { type: "metric.events", title: "Events", width: "half", options: {} },
        { type: "metric.errors", title: "Errors", width: "half", options: {} },
        { type: "top.events", title: "Top events", width: "full", options: {} }
      ]
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/analytics-dashboards",
      expect.objectContaining({ method: "POST" })
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { dashboard: { id: "dash_1" } }));
    await createApiClient("/api").updateAnalyticsDashboard?.(
      "dash/1",
      { projectId: "prj_1", environmentId: "env_1" },
      { name: "Executive report" }
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/analytics-dashboards/dash%2F1?project_id=prj_1&environment_id=env_1",
      expect.objectContaining({ method: "PATCH" })
    );

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { widgets: [] } }));
    await createApiClient("/api").getDashboardReport?.("dash/1", {
      projectId: "prj_1",
      environmentId: "env_1",
      window: "30d"
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/query/reports/dashboards/dash%2F1?project_id=prj_1&environment_id=env_1&window=30d",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("fetches system health", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            generatedAt: "2026-05-06T12:00:00.000Z",
            status: "healthy",
            services: {
              api: { status: "healthy", uptimeSeconds: 10 },
              postgres: { status: "healthy", latencyMs: 1 },
              redis: { status: "healthy", latencyMs: 1 },
              worker: { status: "healthy", expected: true, role: "queue", lastHeartbeatAt: "2026-05-06T11:59:30.000Z" },
              scheduler: {
                status: "healthy",
                expected: true,
                role: "scheduler",
                lastHeartbeatAt: "2026-05-06T11:59:30.000Z"
              }
            },
            deployment: {
              api: {
                nodeEnv: "production",
                consoleEnabled: true,
                publicEndpointConfigured: true,
                googleOAuthEnabled: false,
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
            queues: {
              telemetry: { status: "healthy", errorMessage: null, waiting: 0, active: 0, completed: 1, failed: 0, delayed: 0, deadLettered: 0 }
            },
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
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient("/api");
    await expect(client.getSystemHealth()).resolves.toMatchObject({ data: { status: "healthy" } });
    expect(fetchMock).toHaveBeenCalledWith("/api/system/health", expect.objectContaining({ method: "GET" }));
  });

  it("runs system actions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, action: "doctor", status: "success", message: "ok", generatedAt: "2026-06-30T00:00:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, action: "backup", status: "skipped", message: "busy", ran: false, skipped: true, generatedAt: "2026-06-30T00:00:01.000Z" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, action: "retention", status: "success", message: "done", ran: true, skipped: false, generatedAt: "2026-06-30T00:00:02.000Z" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiClient("/api");
    await expect(client.runSystemDoctor?.()).resolves.toMatchObject({ action: "doctor", status: "success" });
    await expect(client.runSystemBackup?.()).resolves.toMatchObject({ action: "backup", status: "skipped" });
    await expect(client.runSystemRetention?.()).resolves.toMatchObject({ action: "retention", ran: true });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/system/actions/doctor", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/system/actions/backup", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/system/actions/retention", expect.objectContaining({ method: "POST" }));
  });

  it("encodes entity tenant list queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { tenants: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listEntityTenants({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "7d",
      search: "tenant_1",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/entities/tenants?project_id=prj_1&environment_id=env_1&window=7d&search=tenant_1&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes entity tenant detail queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { timeline: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").getEntityTenantDetail("tenant/one", {
      projectId: "prj_1",
      environmentId: "env_1",
      window: "24h",
      userId: "user_1",
      signalType: "llm",
      limit: 10,
      cursor: "cursor_1"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/entities/tenants/tenant%2Fone?project_id=prj_1&environment_id=env_1&window=24h&user_id=user_1&signal_type=llm&limit=10&cursor=cursor_1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes user list queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { users: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").listUsersActivity({
      projectId: "prj_1",
      environmentId: "env_1",
      window: "30d",
      search: "user_1",
      tenantId: "tenant_1",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/users?project_id=prj_1&environment_id=env_1&window=30d&search=user_1&tenant_id=tenant_1&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes user detail queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { timeline: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").getUserDetail("user/one", {
      projectId: "prj_1",
      environmentId: "env_1",
      window: "24h",
      tenantId: "tenant_1",
      signalType: "llm",
      limit: 10,
      cursor: "cursor_1"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/users/user%2Fone?project_id=prj_1&environment_id=env_1&window=24h&tenant_id=tenant_1&signal_type=llm&limit=10&cursor=cursor_1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not encode investigation filters for overview queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: overviewResponse() }));
    vi.stubGlobal("fetch", fetchMock);

    const queryWithUnsupportedFilters: OverviewQuery & { tenantId: string; status: string; eventName: string } = {
      projectId: "prj_1",
      environmentId: "env_1",
      window: "24h",
      tenantId: "tenant_1",
      status: "open",
      eventName: "checkout.started"
    };

    await createApiClient().getOverview(queryWithUnsupportedFilters);

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/overview?project_id=prj_1&environment_id=env_1&window=24h",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not encode LLM-specific filters for trace queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listTraces({
      projectId: "prj_1",
      environmentId: "env_1",
      provider: "openai",
      model: "gpt-5",
      promptName: "generate_sql",
      status: "success"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/traces?project_id=prj_1&environment_id=env_1&status=success",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes event name query filter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listEvents({
      projectId: "prj_1",
      environmentId: "env_1",
      eventName: "checkout.started"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events?project_id=prj_1&environment_id=env_1&event_name=checkout.started",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not encode error-only filters for event queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listEvents({
      projectId: "prj_1",
      environmentId: "env_1",
      eventName: "checkout.started",
      severity: "critical",
      status: "open",
      fingerprint: "fp_1"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events?project_id=prj_1&environment_id=env_1&event_name=checkout.started",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes error query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listErrors({
      projectId: "prj_1",
      environmentId: "env_1",
      severity: "critical",
      status: "open",
      fingerprint: "fp_checkout_fetch",
      errorGroupId: "egrp_checkout"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/errors?project_id=prj_1&environment_id=env_1&severity=critical&status=open&fingerprint=fp_checkout_fetch&error_group_id=egrp_checkout",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes error group query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").listErrorGroups({
      projectId: "prj/1",
      environmentId: "env 1",
      tenantId: "tenant/1",
      userId: "user 1",
      status: "investigating",
      severity: "fatal",
      fingerprint: "fp/checkout",
      release: "web@1.2.3",
      from: "2026-05-05T12:00:00.000Z",
      to: "2026-05-05T13:00:00.000Z",
      limit: 25,
      cursor: "cursor/next"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/error-groups?project_id=prj%2F1&environment_id=env+1&tenant_id=tenant%2F1&user_id=user+1&status=investigating&severity=fatal&fingerprint=fp%2Fcheckout&release=web%401.2.3&from=2026-05-05T12%3A00%3A00.000Z&to=2026-05-05T13%3A00%3A00.000Z&limit=25&cursor=cursor%2Fnext",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("gets error group detail with encoded path and scoped query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "egrp/1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").getErrorGroup("egrp/1", {
      projectId: "prj/1",
      environmentId: "env 1"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/error-groups/egrp%2F1?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("updates error group status with scoped query and status body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "egrp/1", status: "resolved" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").updateErrorGroupStatus("egrp/1", {
      projectId: "prj/1",
      environmentId: "env 1",
      status: "resolved"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/error-groups/egrp%2F1?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "resolved" })
      })
    );
  });

  it("builds error group incident query URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { group: { id: "egrp/1" } } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").getErrorGroupIncident("egrp/1", {
      projectId: "prj/1",
      environmentId: "env 1",
      errorId: "err/1"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/incidents/error-groups/egrp%2F1?project_id=prj%2F1&environment_id=env+1&error_id=err%2F1",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("sends error group triage updates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "egrp/1", priority: "urgent" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").updateErrorGroupTriage("egrp/1", {
      projectId: "prj/1",
      environmentId: "env 1",
      status: "investigating",
      priority: "urgent"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/error-groups/egrp%2F1?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "investigating", priority: "urgent" })
      })
    );
  });

  it("sends nullable error group priority updates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "egrp/1", priority: null } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").updateErrorGroupTriage("egrp/1", {
      projectId: "prj/1",
      environmentId: "env 1",
      priority: null
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/error-groups/egrp%2F1?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ priority: null })
      })
    );
  });

  it("sends assignedToUserId in triage PATCH body when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "egrp/1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").updateErrorGroupTriage("egrp/1", {
      projectId: "prj/1",
      environmentId: "env 1",
      status: "investigating",
      assignedToUserId: "usr_1"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/error-groups/egrp%2F1?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "investigating", assignedToUserId: "usr_1" })
      })
    );
  });

  it("POSTs addTriageNote to the notes sub-resource with scoped query and body", async () => {
    const noteRecord = {
      id: "note_1",
      errorGroupId: "egrp/1",
      authorUserId: "usr_1",
      authorEmail: "admin@example.com",
      body: "Looking into this now",
      createdAt: "2026-06-22T10:00:00.000Z"
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { data: noteRecord }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").addTriageNote("egrp/1", {
      projectId: "prj/1",
      environmentId: "env 1",
      body: "Looking into this now"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/incidents/error-groups/egrp%2F1/notes?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "Looking into this now" })
      })
    );
  });

  it("POSTs silenceIncident to the silence sub-resource with scoped query and minutes body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "egrp/1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").silenceIncident("egrp/1", {
      projectId: "prj/1",
      environmentId: "env 1",
      minutes: 60
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/incidents/error-groups/egrp%2F1/silence?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ minutes: 60 })
      })
    );
  });

  it("POSTs silenceIncident with null minutes to unsilence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "egrp/1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").silenceIncident("egrp/1", {
      projectId: "prj/1",
      environmentId: "env 1",
      minutes: null
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/query/incidents/error-groups/egrp%2F1/silence?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ minutes: null })
      })
    );
  });

  it("does not encode event name for error queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listErrors({
      projectId: "prj_1",
      environmentId: "env_1",
      eventName: "checkout.started",
      severity: "critical"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/errors?project_id=prj_1&environment_id=env_1&severity=critical",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not encode event name for event aggregate queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { total: 0 } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().getEventAggregates({
      projectId: "prj_1",
      environmentId: "env_1",
      eventName: "checkout.started"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/aggregates/events?project_id=prj_1&environment_id=env_1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("lists notification channels", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { channels: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").listNotificationChannels();

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/notification-channels", expect.objectContaining({ method: "GET" }));
  });

  it("creates notification channels without expecting secretHeaderValue in the response", async () => {
    const channel = {
      id: "chn_1",
      name: "Ops webhook",
      type: "webhook",
      url: "https://hooks.example.com/sigmon",
      emailRecipients: [],
      secretHeaderName: "x-sigmon-secret",
      hasSecret: true,
      enabled: true,
      createdAt: "2026-05-06T12:00:00.000Z",
      updatedAt: "2026-05-06T12:00:00.000Z",
      archivedAt: null
    } satisfies NotificationChannelResponse;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { channel }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await createApiClient().createNotificationChannel({
      name: "Ops webhook",
      type: "webhook",
      url: "https://hooks.example.com/sigmon",
      secretHeaderName: "x-sigmon-secret",
      secretHeaderValue: "super-secret",
      enabled: true
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/notification-channels",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Ops webhook",
          type: "webhook",
          url: "https://hooks.example.com/sigmon",
          secretHeaderName: "x-sigmon-secret",
          secretHeaderValue: "super-secret",
          enabled: true
        })
      })
    );
    expect(response.channel.hasSecret).toBe(true);
    expect(response.channel).not.toHaveProperty("secretHeaderValue");
  });

  it("creates email notification channels", async () => {
    const channel = {
      id: "chn_email",
      name: "Ops email",
      type: "email",
      url: null,
      emailRecipients: ["diogo@example.com"],
      secretHeaderName: null,
      hasSecret: false,
      enabled: true,
      createdAt: "2026-05-06T12:00:00.000Z",
      updatedAt: "2026-05-06T12:00:00.000Z",
      archivedAt: null
    } satisfies NotificationChannelResponse;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { channel }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().createNotificationChannel({
      name: "Ops email",
      type: "email",
      emailRecipients: ["diogo@example.com"],
      enabled: true
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/notification-channels",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Ops email",
          type: "email",
          emailRecipients: ["diogo@example.com"],
          enabled: true
        })
      })
    );
  });

  it("updates and archives notification channels", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { channel: { id: "chn_1", name: "Ops webhook" } }))
      .mockResolvedValueOnce(emptyResponse(204));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").updateNotificationChannel("chn/1", { enabled: false });
    await expect(createApiClient("/api").archiveNotificationChannel("chn/1")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/notification-channels/chn%2F1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/notification-channels/chn%2F1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("lists alert rules with optional scope filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { rules: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").listAlertRules({ projectId: "prj/1", environmentId: "env 1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/alert-rules?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("lists alert rules without dangling query string when no filters are provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { rules: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").listAlertRules();

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/alert-rules", expect.objectContaining({ method: "GET" }));
  });

  it("creates updates and archives alert rules", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, { rule: { id: "rule_1" } }))
      .mockResolvedValueOnce(jsonResponse(200, { rule: { id: "rule_1", enabled: false } }))
      .mockResolvedValueOnce(emptyResponse(204));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").createAlertRule({
      projectId: "prj_1",
      environmentId: "env_1",
      notificationChannelId: "chn_1",
      name: "Critical errors",
      type: "critical_errors",
      severity: "critical",
      windowMinutes: 5,
      threshold: "1",
      cooldownMinutes: 15,
      enabled: true
    });
    await createApiClient("/api").updateAlertRule("rule/1", { enabled: false });
    await expect(createApiClient("/api").archiveAlertRule("rule/1")).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/alert-rules",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          projectId: "prj_1",
          environmentId: "env_1",
          notificationChannelId: "chn_1",
          name: "Critical errors",
          type: "critical_errors",
          severity: "critical",
          windowMinutes: 5,
          threshold: "1",
          cooldownMinutes: 15,
          enabled: true
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/alert-rules/rule%2F1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/admin/alert-rules/rule%2F1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("listAlertEvents builds the scoped alert events query path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listAlertEvents({ projectId: "prj_1", environmentId: "env_1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/alerts/events?project_id=prj_1&environment_id=env_1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("updates alert event triage state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "ale_1", status: "acknowledged" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").updateAlertEventTriage("ale/1", {
      status: "acknowledged",
      note: "Looking now"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/alerts/events/ale%2F1/triage",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "acknowledged", note: "Looking now" })
      })
    );
  });

  it("lists alert events with optional limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listAlertEvents({ projectId: "prj_1", environmentId: "env_1", limit: 25 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/alerts/events?project_id=prj_1&environment_id=env_1&limit=25",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("creates and lists monitor resources", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { monitors: [] }))
      .mockResolvedValueOnce(jsonResponse(201, { monitor: { id: "mon_http" } }))
      .mockResolvedValueOnce(jsonResponse(201, { monitor: { id: "mon_hb" }, secret: "shhb_secret" }))
      .mockResolvedValueOnce(jsonResponse(200, { checks: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").listMonitors?.({ projectId: "prj/1", environmentId: "env 1", kind: "http" });
    await createApiClient("/api").createHttpMonitor?.({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "API",
      url: "https://api.example.com/health"
    });
    await createApiClient("/api").createHeartbeatMonitor?.({
      projectId: "prj_1",
      environmentId: "env_1",
      name: "Worker",
      expectedIntervalMinutes: 5
    });
    await createApiClient("/api").listMonitorChecks?.("mon/1", { projectId: "prj/1", environmentId: "env 1", limit: 10 });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/monitors?project_id=prj%2F1&environment_id=env+1&kind=http",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/monitors/http",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/admin/monitors/heartbeat",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/admin/monitors/mon%2F1/checks?project_id=prj%2F1&environment_id=env+1&limit=10",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not send json content-type for bodyless delete requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204, undefined));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").archiveMonitor?.("mon/1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/monitors/mon%2F1",
      expect.objectContaining({
        method: "DELETE",
        body: undefined,
        headers: expect.not.objectContaining({ "Content-Type": "application/json" })
      })
    );
  });

  it("gets alert events by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "evt_1" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("/api").getAlertEvent("evt/1");

    expect(fetchMock).toHaveBeenCalledWith("/api/alerts/events/evt%2F1", expect.objectContaining({ method: "GET" }));
  });

  it("lists source map artifacts with scoped query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { artifacts: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiClient("/api").listSourceMapArtifacts({
        projectId: "prj/1",
        environmentId: "env 1",
        release: "web@1.0.0",
        limit: 25,
        cursor: "cursor/next"
      })
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/source-maps?project_id=prj%2F1&environment_id=env+1&release=web%401.0.0&limit=25&cursor=cursor%2Fnext",
      {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json"
        },
        body: undefined
      }
    );
  });

  it("gets source map resolution for an error with scoped query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          errorId: "err/1",
          release: null,
          status: "unavailable",
          frames: [],
          unresolvedFrameCount: 0
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiClient("/api").getErrorSourceMapResolution("err/1", {
        projectId: "prj/1",
        environmentId: "env 1"
      })
    ).resolves.toMatchObject({ errorId: "err/1", status: "unavailable" });

    expect(fetchMock).toHaveBeenCalledWith("/api/query/errors/err%2F1/source-map-resolution?project_id=prj%2F1&environment_id=env+1", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json"
      },
      body: undefined
    });
  });

  it("uploads a source map without setting multipart content type", async () => {
    const sourceMap = new File(["{}"], "app.js.map", { type: "application/json" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { artifacts: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiClient("/api").uploadSourceMap({
        projectId: "prj/1",
        environmentId: "env 1",
        release: "web@1.0.0",
        minifiedFile: "app.js",
        file: sourceMap
      })
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/source-maps", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json"
      },
      body: expect.any(FormData)
    });

    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get("project_id")).toBe("prj/1");
    expect(form.get("environment_id")).toBe("env 1");
    expect(form.get("release")).toBe("web@1.0.0");
    expect(form.get("minified_file")).toBe("app.js");
    expect(form.get("file")).toBe(sourceMap);
  });

  it("uploads a source map bundle without setting multipart content type", async () => {
    const bundle = new File(["bundle"], "source-maps.zip", { type: "application/zip" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { artifacts: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiClient("/api").uploadSourceMapBundle({
        projectId: "prj/1",
        environmentId: "env 1",
        release: "web@1.0.0",
        bundle
      })
    ).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/source-maps", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json"
      },
      body: expect.any(FormData)
    });

    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get("project_id")).toBe("prj/1");
    expect(form.get("environment_id")).toBe("env 1");
    expect(form.get("release")).toBe("web@1.0.0");
    expect(form.get("bundle")).toBe(bundle);
  });

  it("deletes source map artifacts with scoped query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResponse(204));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiClient("/api").deleteSourceMapArtifact("art/1", {
        projectId: "prj/1",
        environmentId: "env 1"
      })
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/source-maps/art%2F1?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("lists source map upload tokens", async () => {
    const token = {
      id: "smtok_1",
      projectId: "prj/1",
      environmentId: "env 1",
      name: "GitHub Actions",
      prefix: "shsmap_test",
      createdAt: "2026-05-11T12:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null
    } satisfies SourceMapUploadToken;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { tokens: [token] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiClient("/api").listSourceMapUploadTokens({
        projectId: "prj/1",
        environmentId: "env 1"
      })
    ).resolves.toEqual({ tokens: [token] });

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/source-map-upload-tokens?project_id=prj%2F1&environment_id=env+1", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json"
      },
      body: undefined
    });
  });

  it("creates source map upload tokens", async () => {
    const token = {
      id: "smtok_1",
      projectId: "prj_1",
      environmentId: "env_1",
      name: "GitHub Actions",
      prefix: "shsmap_test",
      secret: "shsmap_secret",
      createdAt: "2026-05-11T12:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null
    } satisfies CreatedSourceMapUploadToken;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { token }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiClient("/api").createSourceMapUploadToken({
        projectId: "prj_1",
        environmentId: "env_1",
        name: "GitHub Actions"
      })
    ).resolves.toEqual({ token });

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/source-map-upload-tokens", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ projectId: "prj_1", environmentId: "env_1", name: "GitHub Actions" })
    });
  });

  it("renames source map upload tokens with scoped query filters", async () => {
    const token = {
      id: "smtok_1",
      projectId: "prj/1",
      environmentId: "env 1",
      name: "Production sourcemaps",
      prefix: "shsmap_test",
      createdAt: "2026-05-11T12:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null
    } satisfies SourceMapUploadToken;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { token }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiClient("/api").updateSourceMapUploadToken(
        "smtok/1",
        { projectId: "prj/1", environmentId: "env 1" },
        { name: "Production sourcemaps" }
      )
    ).resolves.toEqual({ token });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/source-map-upload-tokens/smtok%2F1?project_id=prj%2F1&environment_id=env+1",
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: "Production sourcemaps" })
      }
    );
  });

  it("revokes source map upload tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResponse(204));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiClient("/api").revokeSourceMapUploadToken("smtok/1", {
        projectId: "prj/1",
        environmentId: "env 1"
      })
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/source-map-upload-tokens/smtok%2F1?project_id=prj%2F1&environment_id=env+1",
      {
        method: "DELETE",
        credentials: "include",
        headers: {
          Accept: "application/json"
        },
        body: undefined
      }
    );
  });
});

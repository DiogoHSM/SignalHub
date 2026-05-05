import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./client";
import type { OverviewQuery } from "./types";

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
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      from: "2026-05-04T12:00:00.000Z",
      to: "2026-05-04T13:00:00.000Z",
      limit: 25
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/traces?project_id=prj_1&environment_id=env_1&tenant_id=tenant_1&user_id=user_1&session_id=session_1&trace_id=trace_1&from=2026-05-04T12%3A00%3A00.000Z&to=2026-05-04T13%3A00%3A00.000Z&limit=25",
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
      "/query/traces?project_id=prj_1&environment_id=env_1",
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
      fingerprint: "fp_checkout_fetch"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/errors?project_id=prj_1&environment_id=env_1&severity=critical&status=open&fingerprint=fp_checkout_fetch",
      expect.objectContaining({ method: "GET" })
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
});

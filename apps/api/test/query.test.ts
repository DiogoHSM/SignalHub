import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

const humanAuth = {
  login: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false }),
  findSessionUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false })
};

const readiness = async () => ({ postgres: true, redis: true });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("query routes", () => {
  it("lists events for an authenticated human user", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async (filters) => {
          receivedFilters.push(filters);
          return {
            data: [{ id: "evt_1", name: "account.created" }],
            cursor: "next_cursor"
          };
        },
        getEventAggregates: async () => ({ total: 1 })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [{ id: "evt_1", name: "account.created" }],
      cursor: "next_cursor"
    });
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        limit: 50
      }
    ]);
  });

  it("returns 401 when query routes are unauthenticated", async () => {
    app = await buildApp({
      readiness,
      auth: {
        login: async () => null,
        findSessionUser: async () => null
      },
      query: {
        listEvents: async () => []
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("requires project_id and environment_id for list routes", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async () => []
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("defaults invalid limits and caps high limits", async () => {
    const limits: number[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async (filters) => {
          limits.push(filters.limit);
          return [];
        }
      }
    });

    await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1&limit=not-a-number"
    });
    await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1&limit=0"
    });
    await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1&limit=900"
    });

    expect(limits).toEqual([50, 1, 500]);
  });

  it("converts optional filter query params to camelCase values", async () => {
    const receivedFilters: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listErrors: async (filters) => {
          receivedFilters.push(filters);
          return [];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url:
        "/query/errors?project_id=prj_1&environment_id=env_1&tenant_id=ten_1&user_id=user_1" +
        "&session_id=sess_1&trace_id=trc_1&from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z" +
        "&limit=25&cursor=cur_1"
    });

    expect(response.statusCode).toBe(200);
    expect(receivedFilters).toEqual([
      {
        projectId: "prj_1",
        environmentId: "env_1",
        tenantId: "ten_1",
        userId: "user_1",
        sessionId: "sess_1",
        traceId: "trc_1",
        from: new Date("2026-01-01T00:00:00.000Z"),
        to: new Date("2026-01-02T00:00:00.000Z"),
        limit: 25,
        cursor: "cur_1"
      }
    ]);
  });

  it("rejects invalid date filters", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listEvents: async () => []
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/events?project_id=prj_1&environment_id=env_1&from=yesterday"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("lists trace spans for a valid trace id", async () => {
    const received: unknown[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        listTraceSpans: async (traceId, filters) => {
          received.push({ traceId, filters });
          return [{ id: "spn_1", traceId }];
        }
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/traces/trc_1/spans?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [{ id: "spn_1", traceId: "trc_1" }] });
    expect(received).toEqual([
      {
        traceId: "trc_1",
        filters: {
          projectId: "prj_1",
          environmentId: "env_1",
          limit: 50
        }
      }
    ]);
  });

  it("returns aggregates under data", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getEventAggregates: async () => ({ total: 2, byName: { "account.created": 2 } })
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/aggregates/events?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { total: 2, byName: { "account.created": 2 } } });
  });

  it("returns 501 when a query dependency method is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({
      method: "GET",
      url: "/query/llm-calls?project_id=prj_1&environment_id=env_1"
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });
});

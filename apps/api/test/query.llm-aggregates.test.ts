import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { LlmAggregateFilters } from "../src/routes/query.js";

let app: FastifyInstance | undefined;

const humanAuth = {
  login: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false }),
  findSessionUser: async () => ({ id: "usr_1", email: "user@example.com", isAdmin: false })
};

const unauthenticatedAuth = {
  login: async () => null,
  findSessionUser: async () => null
};

const readiness = async () => ({ postgres: true, redis: true });

const mockSummaryData = {
  calls: 100,
  failedCalls: 2,
  costUsd: "1.23",
  avgDurationMs: 500,
  p95DurationMs: 1200
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /query/llm/summary", () => {
  it("returns 401 when unauthenticated", async () => {
    app = await buildApp({
      readiness,
      auth: unauthenticatedAuth,
      query: {
        getLlmSummary: async () => mockSummaryData
      }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/summary?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 501 when getLlmSummary is absent from deps", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/summary?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });

  it("returns 400 when project_id is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmSummary: async () => mockSummaryData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/summary?environment_id=env_1" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 400 when environment_id is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmSummary: async () => mockSummaryData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/summary?project_id=prj_1" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 400 when window is invalid", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmSummary: async () => mockSummaryData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/summary?project_id=prj_1&environment_id=env_1&window=bogus" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 200 with data", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmSummary: async () => mockSummaryData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/summary?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: mockSummaryData });
  });

  it("defaults window to 24h", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmSummary: async (filters) => {
          receivedFilters.push(filters);
          return mockSummaryData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/summary?project_id=prj_1&environment_id=env_1" });

    expect(receivedFilters[0]?.window).toBe("24h");
  });

  it("passes window=7d to mock", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmSummary: async (filters) => {
          receivedFilters.push(filters);
          return mockSummaryData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/summary?project_id=prj_1&environment_id=env_1&window=7d" });

    expect(receivedFilters[0]?.window).toBe("7d");
  });

  it("passes window=30d to mock", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmSummary: async (filters) => {
          receivedFilters.push(filters);
          return mockSummaryData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/summary?project_id=prj_1&environment_id=env_1&window=30d" });

    expect(receivedFilters[0]?.window).toBe("30d");
  });

  it("returns 503 when getLlmSummary throws", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmSummary: async () => {
          throw new Error("db error");
        }
      }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/summary?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "query_unavailable" });
  });
});

describe("GET /query/llm/by-tenant", () => {
  const mockData = [{ tenantId: "t_1", calls: 10, costUsd: "0.50" }];

  it("returns 401 when unauthenticated", async () => {
    app = await buildApp({
      readiness,
      auth: unauthenticatedAuth,
      query: { getLlmByTenant: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-tenant?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 501 when getLlmByTenant is absent from deps", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-tenant?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });

  it("returns 400 when project_id is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmByTenant: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-tenant?environment_id=env_1" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 400 when environment_id is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmByTenant: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-tenant?project_id=prj_1" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 400 when window is invalid", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmByTenant: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-tenant?project_id=prj_1&environment_id=env_1&window=bogus" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 200 with data", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmByTenant: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-tenant?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: mockData });
  });

  it("defaults window to 24h", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmByTenant: async (filters) => {
          receivedFilters.push(filters);
          return mockData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/by-tenant?project_id=prj_1&environment_id=env_1" });

    expect(receivedFilters[0]?.window).toBe("24h");
  });

  it("passes window=7d to mock", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmByTenant: async (filters) => {
          receivedFilters.push(filters);
          return mockData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/by-tenant?project_id=prj_1&environment_id=env_1&window=7d" });

    expect(receivedFilters[0]?.window).toBe("7d");
  });

  it("passes window=30d to mock", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmByTenant: async (filters) => {
          receivedFilters.push(filters);
          return mockData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/by-tenant?project_id=prj_1&environment_id=env_1&window=30d" });

    expect(receivedFilters[0]?.window).toBe("30d");
  });

  it("returns 503 when getLlmByTenant throws", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmByTenant: async () => {
          throw new Error("db error");
        }
      }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-tenant?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "query_unavailable" });
  });
});

describe("GET /query/llm/by-prompt", () => {
  const mockData = [{ promptName: "chat", calls: 50, costUsd: "0.75" }];

  it("returns 401 when unauthenticated", async () => {
    app = await buildApp({
      readiness,
      auth: unauthenticatedAuth,
      query: { getLlmByPrompt: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-prompt?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 501 when getLlmByPrompt is absent from deps", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-prompt?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });

  it("returns 400 when project_id is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmByPrompt: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-prompt?environment_id=env_1" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 400 when environment_id is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmByPrompt: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-prompt?project_id=prj_1" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 400 when window is invalid", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmByPrompt: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-prompt?project_id=prj_1&environment_id=env_1&window=bogus" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 200 with data", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmByPrompt: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-prompt?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: mockData });
  });

  it("defaults window to 24h", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmByPrompt: async (filters) => {
          receivedFilters.push(filters);
          return mockData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/by-prompt?project_id=prj_1&environment_id=env_1" });

    expect(receivedFilters[0]?.window).toBe("24h");
  });

  it("passes window=7d to mock", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmByPrompt: async (filters) => {
          receivedFilters.push(filters);
          return mockData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/by-prompt?project_id=prj_1&environment_id=env_1&window=7d" });

    expect(receivedFilters[0]?.window).toBe("7d");
  });

  it("passes window=30d to mock", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmByPrompt: async (filters) => {
          receivedFilters.push(filters);
          return mockData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/by-prompt?project_id=prj_1&environment_id=env_1&window=30d" });

    expect(receivedFilters[0]?.window).toBe("30d");
  });

  it("returns 503 when getLlmByPrompt throws", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmByPrompt: async () => {
          throw new Error("db error");
        }
      }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/by-prompt?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "query_unavailable" });
  });
});

describe("GET /query/llm/cost-by-model", () => {
  const mockData = { models: [{ model: "gpt-4o", costUsd: "2.00" }] };

  it("returns 401 when unauthenticated", async () => {
    app = await buildApp({
      readiness,
      auth: unauthenticatedAuth,
      query: { getLlmCostByModel: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/cost-by-model?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns 501 when getLlmCostByModel is absent from deps", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {}
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/cost-by-model?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({ error: "query_method_unavailable" });
  });

  it("returns 400 when project_id is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmCostByModel: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/cost-by-model?environment_id=env_1" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 400 when environment_id is missing", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmCostByModel: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/cost-by-model?project_id=prj_1" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 400 when window is invalid", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmCostByModel: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/cost-by-model?project_id=prj_1&environment_id=env_1&window=bogus" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_query" });
  });

  it("returns 200 with data", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: { getLlmCostByModel: async () => mockData }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/cost-by-model?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: mockData });
  });

  it("defaults window to 24h", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmCostByModel: async (filters) => {
          receivedFilters.push(filters);
          return mockData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/cost-by-model?project_id=prj_1&environment_id=env_1" });

    expect(receivedFilters[0]?.window).toBe("24h");
  });

  it("passes window=7d to mock", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmCostByModel: async (filters) => {
          receivedFilters.push(filters);
          return mockData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/cost-by-model?project_id=prj_1&environment_id=env_1&window=7d" });

    expect(receivedFilters[0]?.window).toBe("7d");
  });

  it("passes window=30d to mock", async () => {
    const receivedFilters: LlmAggregateFilters[] = [];

    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmCostByModel: async (filters) => {
          receivedFilters.push(filters);
          return mockData;
        }
      }
    });

    await app.inject({ method: "GET", url: "/query/llm/cost-by-model?project_id=prj_1&environment_id=env_1&window=30d" });

    expect(receivedFilters[0]?.window).toBe("30d");
  });

  it("returns 503 when getLlmCostByModel throws", async () => {
    app = await buildApp({
      readiness,
      auth: humanAuth,
      query: {
        getLlmCostByModel: async () => {
          throw new Error("db error");
        }
      }
    });

    const response = await app.inject({ method: "GET", url: "/query/llm/cost-by-model?project_id=prj_1&environment_id=env_1" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "query_unavailable" });
  });
});

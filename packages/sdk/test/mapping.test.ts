import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBreadcrumbSignal,
  createErrorSignal,
  createEventSignal,
  createIdentifyTenantSignal,
  createIdentifyUserSignal,
  createLlmSignal,
  createSpanSignal,
  createTraceSignal,
  mergeContext,
  serializeDate
} from "../src/mapping.js";

describe("payload mapping", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges default and per-call context with shallow metadata override", () => {
    expect(
      mergeContext(
        {
          tenantId: "tenant_default",
          userId: "user_default",
          sessionId: "session_default",
          traceId: "trace_default",
          source: "node",
          release: "1.0.0",
          metadata: { plan: "free", region: "us", retained: true }
        },
        {
          userId: "user_call",
          traceId: "trace_call",
          timestamp: "2026-05-02T12:00:00.000Z",
          metadata: { plan: "pro", request_id: "req_1" }
        }
      )
    ).toEqual({
      tenant_id: "tenant_default",
      user_id: "user_call",
      session_id: "session_default",
      trace_id: "trace_call",
      source: "node",
      release: "1.0.0",
      timestamp: "2026-05-02T12:00:00.000Z",
      metadata: { plan: "pro", region: "us", retained: true, request_id: "req_1" }
    });
  });

  it("serializes Date and ISO string inputs", () => {
    const iso = "2026-05-02T12:00:00.000Z";

    expect(serializeDate(new Date(iso))).toBe(iso);
    expect(serializeDate(iso)).toBe(iso);
    expect(serializeDate(undefined)).toBeUndefined();
  });

  it("maps events to /v1/events with snake_case context", () => {
    expect(
      createEventSignal(
        "dashboard_created",
        { charts_count: 6 },
        {
          tenantId: "tenant_1",
          userId: "user_1",
          sessionId: "session_1",
          traceId: "trace_1",
          timestamp: new Date("2026-05-02T12:00:00.000Z")
        }
      )
    ).toEqual({
      kind: "event",
      endpointPath: "/v1/events",
      payload: {
        name: "dashboard_created",
        properties: { charts_count: 6 },
        timestamp: "2026-05-02T12:00:00.000Z",
        tenant_id: "tenant_1",
        user_id: "user_1",
        session_id: "session_1",
        trace_id: "trace_1",
        metadata: {}
      }
    });
  });

  it("maps user identify signals without default context identity", () => {
    expect(
      createIdentifyUserSignal(
        "user_1",
        { name: "Ana", role: "admin" },
        { tenantId: "tenant_1", timestamp: new Date("2026-05-02T12:00:00.000Z") }
      )
    ).toEqual({
      kind: "identify_user",
      endpointPath: "/v1/identify/user",
      payload: {
        timestamp: "2026-05-02T12:00:00.000Z",
        user_id: "user_1",
        tenant_id: "tenant_1",
        traits: { name: "Ana", role: "admin" },
        metadata: {}
      }
    });
  });

  it("maps tenant identify signals", () => {
    expect(
      createIdentifyTenantSignal(
        "tenant_1",
        { name: "MicroERP", plan: "pro" },
        { timestamp: "2026-05-02T12:00:00.000Z" }
      )
    ).toEqual({
      kind: "identify_tenant",
      endpointPath: "/v1/identify/tenant",
      payload: {
        timestamp: "2026-05-02T12:00:00.000Z",
        tenant_id: "tenant_1",
        traits: { name: "MicroERP", plan: "pro" },
        metadata: {}
      }
    });
  });

  it("creates breadcrumb signals with merged context", () => {
    expect(
      createBreadcrumbSignal(
        {
          type: "custom",
          category: "checkout",
          message: "Selected shipping",
          data: { method: "standard" }
        },
        { sessionId: "sess_1" },
        { tenantId: "tenant_1", source: "web" }
      )
    ).toEqual({
      kind: "breadcrumb",
      endpointPath: "/v1/breadcrumbs",
      payload: {
        metadata: {},
        tenant_id: "tenant_1",
        session_id: "sess_1",
        source: "web",
        type: "custom",
        category: "checkout",
        message: "Selected shipping",
        data: { method: "standard" }
      }
    });
  });

  it("extracts Error instances into error payload fields", () => {
    const error = new TypeError("Database connection failed");
    error.stack = "TypeError: Database connection failed\n    at test";

    expect(
      createErrorSignal(error, {
        severity: "critical",
        fingerprint: "db-connection",
        context: { pool: "primary" },
        tenantId: "tenant_1",
        metadata: { component: "db" }
      })
    ).toEqual({
      kind: "error",
      endpointPath: "/v1/errors",
      payload: {
        message: "Database connection failed",
        type: "TypeError",
        stack: "TypeError: Database connection failed\n    at test",
        severity: "critical",
        fingerprint: "db-connection",
        context: { pool: "primary" },
        tenant_id: "tenant_1",
        metadata: { component: "db" }
      }
    });
  });

  it("converts unknown thrown values to string messages", () => {
    expect(createErrorSignal("plain failure").payload).toMatchObject({
      message: "plain failure",
      severity: "error",
      context: {},
      metadata: {}
    });

    expect(createErrorSignal({ reason: "bad" }).payload).toMatchObject({
      message: "{\"reason\":\"bad\"}",
      severity: "error",
      context: {},
      metadata: {}
    });
  });

  it("uses a stable fallback for thrown values that cannot be serialized or stringified", () => {
    const thrownValue: Record<PropertyKey, unknown> = {};
    thrownValue.self = thrownValue;
    thrownValue[Symbol.toPrimitive] = () => {
      throw new Error("Cannot convert to primitive");
    };

    expect(() => createErrorSignal(thrownValue)).not.toThrow();
    expect(createErrorSignal(thrownValue).payload).toMatchObject({
      message: "[Unserializable thrown value]",
      severity: "error",
      context: {},
      metadata: {}
    });
  });

  it("converts camelCase LLM fields to Phase 1 snake_case payload fields", () => {
    expect(
      createLlmSignal(
        {
          provider: "openai",
          model: "gpt-5.5",
          promptName: "generate_sql",
          inputTokens: 1200,
          outputTokens: 300,
          costUsd: 0.03,
          latencyMs: 8400,
          status: "success",
          error: "model warning",
          inputPreview: "build a report",
          outputPreview: "select * from reports",
          timestamp: "2026-05-02T12:00:00.000Z"
        },
        { userId: "user_1" }
      )
    ).toEqual({
      kind: "llm",
      endpointPath: "/v1/llm",
      payload: {
        provider: "openai",
        model: "gpt-5.5",
        prompt_name: "generate_sql",
        input_tokens: 1200,
        output_tokens: 300,
        cost_usd: 0.03,
        latency_ms: 8400,
        status: "success",
        error: "model warning",
        input_preview: "build a report",
        output_preview: "select * from reports",
        timestamp: "2026-05-02T12:00:00.000Z",
        user_id: "user_1",
        metadata: {}
      }
    });
  });

  it("maps traces and computes duration when endedAt is present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T12:00:10.000Z"));

    expect(
      createTraceSignal({
        name: "ai.generate_sql",
        startedAt: "2026-05-02T12:00:00.000Z",
        endedAt: "2026-05-02T12:00:02.500Z"
      })
    ).toEqual({
      kind: "trace",
      endpointPath: "/v1/traces",
      payload: {
        name: "ai.generate_sql",
        status: "pending",
        started_at: "2026-05-02T12:00:00.000Z",
        ended_at: "2026-05-02T12:00:02.500Z",
        duration_ms: 2500,
        metadata: {}
      }
    });

    expect(createTraceSignal({ name: "uses current time" }).payload).toMatchObject({
      started_at: "2026-05-02T12:00:10.000Z",
      status: "pending"
    });
  });

  it("maps spans with parent span and IO fields", () => {
    expect(
      createSpanSignal({
        traceId: "trace_1",
        parentSpanId: "span_parent",
        name: "ai.generate_sql",
        status: "success",
        startedAt: "2026-05-02T12:00:00.000Z",
        endedAt: "2026-05-02T12:00:01.000Z",
        input: { prompt: "build a report" },
        output: { sql: "select * from reports" },
        error: { retry: false },
        costUsd: 0.02
      })
    ).toEqual({
      kind: "span",
      endpointPath: "/v1/spans",
      payload: {
        trace_id: "trace_1",
        parent_span_id: "span_parent",
        name: "ai.generate_sql",
        status: "success",
        started_at: "2026-05-02T12:00:00.000Z",
        ended_at: "2026-05-02T12:00:01.000Z",
        duration_ms: 1000,
        input: { prompt: "build a report" },
        output: { sql: "select * from reports" },
        error: { retry: false },
        cost_usd: 0.02,
        metadata: {}
      }
    });
  });
});

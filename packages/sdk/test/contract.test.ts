import {
  errorPayloadSchema,
  eventPayloadSchema,
  llmCallPayloadSchema,
  spanPayloadSchema,
  tracePayloadSchema
} from "@signal-hub/telemetry/ingestion-schemas";
import { describe, expect, it } from "vitest";
import {
  createErrorSignal,
  createEventSignal,
  createLlmSignal,
  createSpanSignal,
  createTraceSignal
} from "../src/mapping.js";

describe("SDK ingestion schema contracts", () => {
  it("creates event payloads accepted by the ingestion schema", () => {
    expect(() =>
      eventPayloadSchema.parse(
        createEventSignal(
          "dashboard_created",
          { charts_count: 6 },
          {
            timestamp: "2026-05-02T12:00:00.000Z",
            tenantId: "tenant_1",
            userId: "user_1",
            metadata: { plan: "pro" }
          }
        ).payload
      )
    ).not.toThrow();
  });

  it("creates error payloads accepted by the ingestion schema", () => {
    const error = new TypeError("Database connection failed");
    error.stack = "TypeError: Database connection failed\n    at contract.test.ts";

    expect(() =>
      errorPayloadSchema.parse(
        createErrorSignal(error, {
          severity: "critical",
          fingerprint: "db-connection",
          context: { pool: "primary" },
          timestamp: "2026-05-02T12:00:01.000Z",
          tenantId: "tenant_1",
          userId: "user_1",
          metadata: { component: "db" }
        }).payload
      )
    ).not.toThrow();
  });

  it("creates LLM payloads accepted by the ingestion schema", () => {
    expect(() =>
      llmCallPayloadSchema.parse(
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
            inputPreview: "build a report",
            outputPreview: "select * from reports",
            timestamp: "2026-05-02T12:00:02.000Z"
          },
          {
            tenantId: "tenant_1",
            userId: "user_1",
            metadata: { feature: "analytics" }
          }
        ).payload
      )
    ).not.toThrow();
  });

  it("creates trace payloads accepted by the ingestion schema", () => {
    expect(() =>
      tracePayloadSchema.parse(
        createTraceSignal(
          {
            name: "ai.generate_sql",
            status: "success",
            startedAt: "2026-05-02T12:00:00.000Z",
            endedAt: "2026-05-02T12:00:03.250Z",
            timestamp: "2026-05-02T12:00:00.000Z"
          },
          {
            tenantId: "tenant_1",
            userId: "user_1",
            traceId: "trace_1",
            metadata: { workflow: "dashboard" }
          }
        ).payload
      )
    ).not.toThrow();
  });

  it("creates span payloads accepted by the ingestion schema", () => {
    expect(() =>
      spanPayloadSchema.parse(
        createSpanSignal(
          {
            traceId: "trace_1",
            parentSpanId: "span_parent",
            name: "ai.generate_sql.execute",
            status: "success",
            startedAt: "2026-05-02T12:00:01.000Z",
            endedAt: "2026-05-02T12:00:02.000Z",
            input: { prompt: "build a report" },
            output: { sql: "select * from reports" },
            costUsd: 0.02,
            timestamp: "2026-05-02T12:00:01.000Z"
          },
          {
            tenantId: "tenant_1",
            userId: "user_1",
            metadata: { step: "query" }
          }
        ).payload
      )
    ).not.toThrow();
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LlmCallRecord } from "../api/types";
import { LlmCallDetailDrawer } from "./LlmCallDetailDrawer";

const call: LlmCallRecord = {
  id: "llm_1",
  projectId: "prj_1",
  environmentId: "env_1",
  tenantId: "tenant_1",
  userId: "user_1",
  sessionId: "session_1",
  traceId: "trace_1",
  timestamp: "2026-05-05T12:00:00.000Z",
  receivedAt: "2026-05-05T12:00:01.000Z",
  source: "api",
  release: "1.0.0",
  metadata: { workflow: "checkout" },
  provider: "openai",
  model: "gpt-5",
  promptName: "generate_sql",
  inputTokens: 120,
  outputTokens: 80,
  costUsd: "0.250000",
  latencyMs: 1800,
  status: "success",
  error: null,
  inputPreview: "Generate SQL for checkout revenue",
  outputPreview: "select sum(total) from orders"
};

afterEach(() => cleanup());

describe("LlmCallDetailDrawer", () => {
  it("renders selected LLM call details", () => {
    render(<LlmCallDetailDrawer call={call} />);

    expect(screen.getByRole("heading", { name: "openai / gpt-5" })).toBeInTheDocument();
    expect(screen.getByText("generate_sql")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("0.250000")).toBeInTheDocument();
    expect(screen.getByText("1800 ms")).toBeInTheDocument();
    expect(screen.getByText("trace_1")).toBeInTheDocument();
    expect(screen.getByText("Generate SQL for checkout revenue")).toBeInTheDocument();
    expect(screen.getByText("select sum(total) from orders")).toBeInTheDocument();
    expect(screen.getByText(/"workflow": "checkout"/)).toBeInTheDocument();
  });

  it("renders empty selection state", () => {
    render(<LlmCallDetailDrawer />);

    expect(screen.getByText("Select an LLM call to inspect its details.")).toBeInTheDocument();
  });
});

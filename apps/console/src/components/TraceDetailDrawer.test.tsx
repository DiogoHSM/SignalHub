import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SpanRecord, TraceRecord } from "../api/types";
import { TraceDetailDrawer } from "./TraceDetailDrawer";

const trace: TraceRecord = {
  id: "trc_row_1",
  projectId: "prj_1",
  environmentId: "env_1",
  tenantId: "tenant_1",
  userId: "user_1",
  sessionId: "session_1",
  traceId: "trace_1",
  timestamp: "2026-05-04T12:00:00.000Z",
  receivedAt: "2026-05-04T12:00:01.000Z",
  source: "api",
  release: "1.0.0",
  metadata: { workflow: "checkout" },
  name: "checkout flow",
  status: "success",
  startedAt: "2026-05-04T12:00:00.000Z",
  endedAt: "2026-05-04T12:00:02.000Z",
  durationMs: 2000
};

const spans: SpanRecord[] = [
  {
    id: "spn_2",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-04T12:00:01.000Z",
    receivedAt: "2026-05-04T12:00:02.000Z",
    source: "api",
    release: "1.0.0",
    metadata: { cache: "miss" },
    parentSpanId: "spn_1",
    name: "charge card",
    status: "success",
    startedAt: "2026-05-04T12:00:01.000Z",
    endedAt: "2026-05-04T12:00:02.000Z",
    durationMs: 1000,
    input: { amount: 25 },
    output: { approved: true },
    error: null,
    costUsd: "0.0100"
  },
  {
    id: "spn_1",
    projectId: "prj_1",
    environmentId: "env_1",
    tenantId: "tenant_1",
    userId: "user_1",
    sessionId: "session_1",
    traceId: "trace_1",
    timestamp: "2026-05-04T12:00:00.000Z",
    receivedAt: "2026-05-04T12:00:01.000Z",
    source: "api",
    release: "1.0.0",
    metadata: {},
    parentSpanId: null,
    name: "load cart",
    status: "success",
    startedAt: "2026-05-04T12:00:00.000Z",
    endedAt: "2026-05-04T12:00:01.000Z",
    durationMs: 1000,
    input: null,
    output: { items: 2 },
    error: null,
    costUsd: null
  }
];

afterEach(() => cleanup());

describe("TraceDetailDrawer", () => {
  it("renders selected trace details and ordered spans", () => {
    render(<TraceDetailDrawer spanState="ready" spans={spans} trace={trace} onRetrySpans={() => undefined} />);

    expect(screen.getByRole("heading", { name: "checkout flow" })).toBeInTheDocument();
    expect(screen.getByText("trace_1")).toBeInTheDocument();
    expect(screen.getAllByText("success").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2000 ms")).toBeInTheDocument();
    expect(screen.getByText(/"workflow": "checkout"/)).toBeInTheDocument();
    expect(screen.getAllByText(/load cart|charge card/).map((node) => node.textContent)).toEqual(["load cart", "charge card"]);
    expect(screen.getByText("spn_1")).toBeInTheDocument();
    expect(screen.getByText(/"approved": true/)).toBeInTheDocument();
    expect(screen.getByText("0.0100")).toBeInTheDocument();
  });

  it("renders empty selection state", () => {
    render(<TraceDetailDrawer spanState="idle" spans={[]} onRetrySpans={() => undefined} />);

    expect(screen.getByText("Select a trace to inspect its spans.")).toBeInTheDocument();
  });
});

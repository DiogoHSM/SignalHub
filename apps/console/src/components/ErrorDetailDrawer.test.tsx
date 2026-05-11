import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ErrorRecord, SessionTimelineResponse } from "../api/types";
import { ErrorDetailDrawer } from "./ErrorDetailDrawer";

const error: ErrorRecord = {
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
  metadata: { region: "us-east-1" },
  message: "Checkout fetch failed",
  type: "TypeError",
  severity: "critical",
  stack: "TypeError: Checkout fetch failed\n    at checkout.ts:12:3",
  status: "open",
  fingerprint: "fp_checkout_fetch",
  errorGroupId: "egrp_checkout",
  groupingFingerprint: "fp_checkout_fetch",
  context: { route: "/checkout" }
};

const sessionTimeline: SessionTimelineResponse = {
  sessionId: "session_1",
  scope: { projectId: "prj_1", environmentId: "env_1" },
  range: { from: null, to: null },
  items: [
    {
      id: "err_1",
      type: "error",
      timestamp: "2026-05-04T12:00:00.000Z",
      receivedAt: "2026-05-04T12:00:01.000Z",
      tenantId: "tenant_1",
      userId: "user_1",
      sessionId: "session_1",
      traceId: "trace_1",
      source: "web",
      release: "1.0.0",
      title: "Checkout fetch failed",
      level: "critical",
      data: {}
    }
  ],
  page: { nextCursor: null, previousCursor: null }
};

afterEach(() => {
  cleanup();
});

describe("ErrorDetailDrawer", () => {
  it("renders selected error details and formatted diagnostics", () => {
    render(<ErrorDetailDrawer error={error} />);

    expect(screen.getByRole("heading", { name: "Checkout fetch failed" })).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.getByText("prj_1")).toBeInTheDocument();
    expect(screen.getByText("env_1")).toBeInTheDocument();
    expect(screen.getByText("trace_1")).toBeInTheDocument();
    expect(screen.getAllByText("fp_checkout_fetch")).toHaveLength(2);
    expect(screen.getByText("egrp_checkout")).toBeInTheDocument();
    expect(screen.getByText(/at checkout\.ts:12:3/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Context JSON" })).toBeInTheDocument();
    expect(screen.getByText(/"route": "\/checkout"/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Metadata JSON" })).toBeInTheDocument();
    expect(screen.getByText(/"region": "us-east-1"/)).toBeInTheDocument();
  });

  it("renders an empty selection state", () => {
    render(<ErrorDetailDrawer />);

    expect(screen.getByText("Select an error to inspect its details.")).toBeInTheDocument();
  });

  it("renders session context when the selected error belongs to a session", () => {
    render(<ErrorDetailDrawer error={error} isLoadingSessionTimeline={false} sessionTimeline={sessionTimeline} />);

    expect(screen.getByText("Session context")).toBeInTheDocument();
    expect(screen.getByLabelText("Selected error timeline item")).toHaveTextContent("Checkout fetch failed");
  });

  it("does not render session context for errors without a session", () => {
    render(<ErrorDetailDrawer error={{ ...error, sessionId: null }} sessionTimeline={sessionTimeline} />);

    expect(screen.queryByText("Session context")).not.toBeInTheDocument();
  });

  it("renders unresolved source map state without source content", () => {
    render(
      <ErrorDetailDrawer
        error={error}
        sourceMapResolution={{
          errorId: error.id,
          release: error.release,
          status: "unresolved",
          frames: [],
          unresolvedFrameCount: 2
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "Source map resolution" })).toBeInTheDocument();
    expect(screen.getByText("Unresolved")).toBeInTheDocument();
    expect(screen.queryByText(/function checkout\(\)/)).not.toBeInTheDocument();
  });

  it("renders resolved source map frame metadata", () => {
    render(
      <ErrorDetailDrawer
        error={error}
        sourceMapResolution={{
          errorId: error.id,
          release: error.release,
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
        }}
      />
    );

    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("src/app.ts:42:4")).toBeInTheDocument();
    expect(screen.getByText("checkout")).toBeInTheDocument();
  });
});

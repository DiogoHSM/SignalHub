import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ErrorRecord } from "../api/types";
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
    expect(screen.getByText("fp_checkout_fetch")).toBeInTheDocument();
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
});

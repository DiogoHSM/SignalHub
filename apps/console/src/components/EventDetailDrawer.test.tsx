import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EventRecord } from "../api/types";
import { EventDetailDrawer } from "./EventDetailDrawer";

const event: EventRecord = {
  id: "evt_1",
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
  metadata: { plan: "pro" },
  name: "checkout.started",
  properties: { cart_value: 120 }
};

afterEach(() => {
  cleanup();
});

describe("EventDetailDrawer", () => {
  it("renders selected event details and formatted JSON", () => {
    render(<EventDetailDrawer event={event} />);

    expect(screen.getByRole("heading", { name: "checkout.started" })).toBeInTheDocument();
    expect(screen.getByText("prj_1")).toBeInTheDocument();
    expect(screen.getByText("env_1")).toBeInTheDocument();
    expect(screen.getByText("tenant_1")).toBeInTheDocument();
    expect(screen.getByText("trace_1")).toBeInTheDocument();
    expect(screen.getByText(/"cart_value": 120/)).toBeInTheDocument();
    expect(screen.getByText(/"plan": "pro"/)).toBeInTheDocument();
  });

  it("renders an empty selection state", () => {
    render(<EventDetailDrawer />);

    expect(screen.getByText("Select an event to inspect its details.")).toBeInTheDocument();
  });
});

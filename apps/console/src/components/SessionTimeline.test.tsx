import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionTimelineItem, SessionTimelineResponse } from "../api/types";
import { SessionTimeline } from "./SessionTimeline";

const item = (overrides: Partial<SessionTimelineItem>): SessionTimelineItem => ({
  id: "brd_1",
  type: "breadcrumb",
  timestamp: "2026-05-11T12:00:00.000Z",
  receivedAt: "2026-05-11T12:00:01.000Z",
  tenantId: "tenant_1",
  userId: "user_1",
  sessionId: "sess_1",
  traceId: null,
  source: "web",
  release: "web@1.0.0",
  title: "Clicked Pay",
  level: "info",
  data: { breadcrumbType: "click", category: "button" },
  ...overrides
});

const timeline = (items: SessionTimelineItem[]): SessionTimelineResponse => ({
  sessionId: "sess_1",
  scope: { projectId: "prj_1", environmentId: "env_1" },
  range: { from: null, to: null },
  items,
  page: { nextCursor: null, previousCursor: null }
});

afterEach(() => {
  cleanup();
});

describe("SessionTimeline", () => {
  it("renders timeline items and highlights the selected error", () => {
    render(
      <SessionTimeline
        highlightedErrorId="err_1"
        isLoading={false}
        timeline={timeline([
          item({ id: "brd_1", type: "breadcrumb", title: "Clicked Pay" }),
          item({ id: "err_1", type: "error", title: "Payment failed", level: "error" })
        ])}
      />
    );

    expect(screen.getByText("Session context")).toBeInTheDocument();
    expect(screen.getByText("Clicked Pay")).toBeInTheDocument();
    expect(screen.getByText("Payment failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Selected error timeline item")).toHaveTextContent("Payment failed");
  });

  it("renders loading, error, and empty states", () => {
    const { rerender } = render(<SessionTimeline isLoading={true} />);

    expect(screen.getByText("Session context")).toBeInTheDocument();
    expect(screen.getByText("Loading session context")).toBeInTheDocument();

    rerender(<SessionTimeline error="Session context unavailable." isLoading={false} />);
    expect(screen.getByText("Session context unavailable.")).toBeInTheDocument();

    rerender(<SessionTimeline isLoading={false} timeline={timeline([])} />);
    expect(screen.getByText("No session context found.")).toBeInTheDocument();
  });
});

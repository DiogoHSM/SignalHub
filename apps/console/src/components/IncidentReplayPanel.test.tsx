import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { IncidentReplay } from "../api/types";
import { IncidentReplayPanel } from "./IncidentReplayPanel";

afterEach(() => {
  cleanup();
});

describe("IncidentReplayPanel", () => {
  it("renders a privacy-safe replay timeline", () => {
    const replay: IncidentReplay = {
      id: "row_1",
      replayId: "rpl_checkout",
      route: "/checkout",
      startedAt: "2026-06-01T12:00:00.000Z",
      endedAt: "2026-06-01T12:00:02.000Z",
      durationMs: 2000,
      eventCount: 2,
      masked: true,
      events: [
        { offsetMs: 0, type: "navigation", route: "/checkout", data: {} },
        { offsetMs: 750, type: "click", selector: '[data-sigmon-id="pay"]', x: 0.5, y: 0.6, data: {} }
      ]
    };

    render(<IncidentReplayPanel replay={replay} />);

    const panel = screen.getByRole("region", { name: /session replay/i });
    expect(within(panel).getByText("Replay")).toBeInTheDocument();
    expect(within(panel).getAllByText("/checkout")).toHaveLength(2);
    expect(within(panel).getByText("Masked")).toBeInTheDocument();
    expect(within(panel).getByText("ID rpl_checkout")).toBeInTheDocument();
    expect(within(panel).getByText("2 events")).toBeInTheDocument();
    expect(within(panel).getByText("2.0 s")).toBeInTheDocument();
    expect(within(panel).getByText("+750 ms")).toBeInTheDocument();
    expect(within(panel).getByText('[data-sigmon-id="pay"]')).toBeInTheDocument();
  });

  it("renders an empty state when no replay is linked", () => {
    render(<IncidentReplayPanel replay={null} />);

    expect(screen.getByRole("region", { name: /session replay/i })).toHaveTextContent("No replay linked to this error.");
  });
});

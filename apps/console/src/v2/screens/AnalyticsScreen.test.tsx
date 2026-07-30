// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../api/types";
import { AnalyticsScreen } from "./AnalyticsScreen";
import type { ScreenCtx } from "./registry";
import type { UseAnalyticsPanelsResult } from "./useAnalyticsPanels";
import * as useAnalyticsPanelsModule from "./useAnalyticsPanels";
import * as useSegmentsModule from "./useSegments";
import * as useEventsModule from "./useEvents";
import type { EventsVM } from "./useEvents";
import type { PropertyCatalogItemVM } from "./useEvents";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const project = { id: "p", name: "Demo" } as Project;
const environment = { id: "e", name: "production" } as Environment;

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: {} as never,
    project,
    environment,
    environments: [environment],
    onCreateEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    ...over,
  } as ScreenCtx;
}

function idlePanels(over: Partial<UseAnalyticsPanelsResult> = {}): UseAnalyticsPanelsResult {
  return {
    funnel: { state: "idle", data: null, run: vi.fn() },
    retention: { state: "idle", data: null, run: vi.fn() },
    paths: { state: "idle", data: null, run: vi.fn() },
    clickMap: { state: "idle", data: null, run: vi.fn() },
    ...over,
  };
}

function mockPanels(over: Partial<UseAnalyticsPanelsResult> = {}) {
  const panels = idlePanels(over);
  vi.spyOn(useAnalyticsPanelsModule, "useAnalyticsPanels").mockReturnValue(panels);
  return panels;
}

function mockSegments(rows: Array<{ id: string; name: string }> = []) {
  vi.spyOn(useSegmentsModule, "useSegments").mockReturnValue({
    data: { rows: rows.map((r) => ({ ...r, actorType: "user", summary: "", definition: {}, previewActors: null })) },
    status: "ok",
    busy: false,
    reload: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    archive: vi.fn().mockResolvedValue(true),
  });
}

function mockEvents(propertyCatalog: EventsVM["propertyCatalog"] = null, propertyCatalogStatus: EventsVM["propertyCatalogStatus"] = "ok") {
  vi.spyOn(useEventsModule, "useEvents").mockReturnValue({
    data: {
      rows: [],
      summary: { total: 0, uniqueNames: 0, tenants: 0, users: 0, top: [] },
      replaySamples: [],
      replaySamplesStatus: "ok",
      propertyCatalog,
      propertyCatalogStatus,
    },
    status: "ok",
    reload: vi.fn(),
  });
}

function property(over: Partial<PropertyCatalogItemVM> = {}): PropertyCatalogItemVM {
  return {
    eventName: "signup.started",
    propertyName: "plan",
    dominantType: "string",
    typeCountsLabel: "string 10",
    hasTypeConflict: false,
    coveragePercent: 100,
    totalOccurrences: 10,
    eventCount: 10,
    sampleValues: ["team"],
    similarPropertyNames: [],
    ...over,
  };
}

describe("AnalyticsScreen", () => {
  it("guards missing project/env", () => {
    mockPanels();
    mockSegments();
    mockEvents();
    render(<AnalyticsScreen ctx={makeCtx({ project: undefined, environment: undefined })} />);
    expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
  });

  it("renders the tab bar and defaults to the Trends workspace without auto-running funnels", () => {
    const panels = mockPanels();
    mockSegments();
    mockEvents();
    render(<AnalyticsScreen ctx={makeCtx()} />);
    expect(screen.getByRole("heading", { name: /analytics/i })).toBeInTheDocument();
    expect(screen.getByText("Saved trends unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trends" })).toHaveAttribute("aria-pressed", "true");
    expect(panels.funnel.run).not.toHaveBeenCalled();
  });

  it("opens the dashboard workspace from the analytics tabs", async () => {
    mockPanels();
    mockSegments();
    mockEvents();
    render(<AnalyticsScreen ctx={makeCtx()} />);

    await userEvent.click(screen.getByText("Dashboards"));
    expect(screen.getByText(/dashboards unavailable/i)).toBeInTheDocument();
  });

  it("Run funnel calls panels.funnel.run with the textarea contents", async () => {
    const panels = mockPanels();
    mockSegments();
    mockEvents();
    render(<AnalyticsScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByText("Funnel"));
    await userEvent.click(screen.getByText("Run funnel"));
    expect(panels.funnel.run).toHaveBeenCalledWith("signup.started\nproject.created");
  });

  it("shows the invalid vs error distinction for the funnel panel", async () => {
    mockPanels({ funnel: { state: "invalid", data: null, run: vi.fn() } });
    mockSegments();
    mockEvents();
    const { rerender } = render(<AnalyticsScreen ctx={makeCtx()} />);
    await userEvent.click(screen.getByText("Funnel"));
    expect(screen.getByText(/at least two event steps/i)).toBeInTheDocument();

    mockPanels({ funnel: { state: "error", data: null, run: vi.fn() } });
    rerender(<AnalyticsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/funnel unavailable/i)).toBeInTheDocument();
  });

  it("switches to the Paths tab and navigates to Events when a sample event is clicked", async () => {
    mockPanels({
      paths: {
        state: "ok",
        data: {
          totals: { actors: 1, paths: 1, events: 2 },
          paths: [
            {
              path: ["signup.started", "project.created"],
              actors: 1,
              occurrences: 1,
              lastSeenAt: "2026-06-23T00:00:00.000Z",
              sampleEvents: [{ id: "ev1", name: "project.created" }],
            },
          ],
        },
        run: vi.fn(),
      },
    });
    mockSegments([{ id: "seg1", name: "Activated users" }]);
    mockEvents();
    const ctx = makeCtx();
    render(<AnalyticsScreen ctx={ctx} />);

    await userEvent.click(screen.getByText("Paths"));
    expect(screen.getByText("signup.started → project.created")).toBeInTheDocument();
    await userEvent.click(screen.getByText("project.created"));
    expect(ctx.navigate).toHaveBeenCalledWith("events");
  });

  it("switches to the Segments tab and creates a segment via the form", async () => {
    mockPanels();
    const saveSpy = vi.fn().mockResolvedValue(true);
    vi.spyOn(useSegmentsModule, "useSegments").mockReturnValue({
      data: { rows: [] },
      status: "ok",
      busy: false,
      reload: vi.fn(),
      save: saveSpy,
      archive: vi.fn().mockResolvedValue(true),
    });
    mockEvents();
    render(<AnalyticsScreen ctx={makeCtx()} />);

    await userEvent.click(screen.getByText("Segments"));
    await userEvent.type(screen.getByPlaceholderText("Segment name"), "Activated");
    await userEvent.type(screen.getByPlaceholderText("Event name"), "project.created");
    await userEvent.click(screen.getByText("Create segment"));
    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "Activated", eventName: "project.created" }));
  });

  it("pushes a toast and does not throw when archiving a segment rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockPanels();
    vi.spyOn(useSegmentsModule, "useSegments").mockReturnValue({
      data: { rows: [{ id: "seg1", name: "Activated users", actorType: "user", summary: "", definition: {}, previewActors: null }] },
      status: "ok",
      busy: false,
      reload: vi.fn(),
      save: vi.fn().mockResolvedValue(true),
      archive: vi.fn().mockRejectedValue(new Error("network error")),
    });
    mockEvents();
    const ctx = makeCtx();
    render(<AnalyticsScreen ctx={ctx} />);

    await userEvent.click(screen.getByText("Segments"));
    const row = screen.getByText("Activated users").closest(".sh-row") as HTMLElement;
    const archiveBtn = within(row).getAllByRole("button").at(-1)!;
    await userEvent.click(archiveBtn); // arm
    await userEvent.click(within(row).getByRole("button", { name: /confirm/i })); // confirm
    await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Could not archive segment"));
  });

  it("Properties tab renders the full property list (no slice to 8) with type-conflict and similar-name highlights", async () => {
    mockPanels();
    mockSegments();
    const properties = Array.from({ length: 10 }, (_, i) =>
      property({ propertyName: `prop_${i}`, hasTypeConflict: i === 0, similarPropertyNames: i === 1 ? ["prop_alt"] : [] })
    );
    mockEvents({ window: "7d", totals: { events: 100, properties: 10, conflictProperties: 1, similarNameGroups: 1 }, properties });
    render(<AnalyticsScreen ctx={makeCtx()} />);

    await userEvent.click(screen.getByText("Properties"));
    for (const prop of properties) {
      expect(screen.getByText(prop.propertyName)).toBeInTheDocument();
    }
    expect(screen.getByText("Type conflict")).toBeInTheDocument();
    expect(screen.getByText(/Similar: prop_alt/)).toBeInTheDocument();
  });
});

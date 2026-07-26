// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../api/types";
import { EventsScreen } from "./EventsScreen";
import type { ScreenCtx } from "./registry";
import type { EventsVM } from "./useEvents";
import * as useEventsModule from "./useEvents";
import * as useSegmentsModule from "./useSegments";
import * as useEventDetailModule from "./useEventDetail";

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

const EVENTS_VM: EventsVM = {
  rows: [
    {
      id: "ev1",
      name: "signup.started",
      timestamp: "2026-06-23T12:00:00.000Z",
      source: "browser",
      release: "1.0.0",
      tenantId: "tenant_a",
      userId: "user_a",
      sessionId: "sess_a",
      traceId: null,
      replayId: "replay_1",
      properties: { plan: "team" },
      metadata: null,
    },
    {
      id: "ev2",
      name: "project.created",
      timestamp: "2026-06-23T12:05:00.000Z",
      source: "server",
      release: "1.0.0",
      tenantId: "tenant_b",
      userId: null,
      sessionId: null,
      traceId: null,
      replayId: null,
      properties: null,
      metadata: null,
    },
  ],
  summary: { total: 2, uniqueNames: 2, tenants: 2, users: 1, top: [{ name: "signup.started", count: 1, percent: 50 }] },
  replaySamples: [
    {
      id: "s1",
      replayId: "replay_1",
      route: "/checkout",
      durationMs: 4200,
      startedAt: "2026-06-23T12:00:00.000Z",
      userId: "user_a",
      tenantId: "tenant_a",
      linkedEventName: "signup.started",
      linkedErrorMessage: null,
    },
  ],
  replaySamplesStatus: "ok",
  propertyCatalog: null,
  propertyCatalogStatus: "ok",
};

function mockEvents(data: EventsVM | null, status: "loading" | "ok" | "error" = "ok") {
  vi.spyOn(useEventsModule, "useEvents").mockReturnValue({ data, status, reload: vi.fn() });
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

function mockEventDetail() {
  vi.spyOn(useEventDetailModule, "useEventDetail").mockReturnValue({
    replay: null,
    replayStatus: "idle",
    timeline: [],
    timelineStatus: "idle",
  });
}

describe("EventsScreen", () => {
  it("guards missing project/env", () => {
    mockEvents(null, "loading");
    mockSegments();
    mockEventDetail();
    render(<EventsScreen ctx={makeCtx({ project: undefined, environment: undefined })} />);
    expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    mockEvents(null, "loading");
    mockSegments();
    mockEventDetail();
    const { rerender } = render(<EventsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    mockEvents(null, "error");
    rerender(<EventsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/could not load events/i)).toBeInTheDocument();
  });

  it("renders the summary strip and the event rows", () => {
    mockEvents(EVENTS_VM);
    mockSegments();
    mockEventDetail();
    render(<EventsScreen ctx={makeCtx()} />);
    expect(screen.getByText("Total events")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1); // total/uniqueNames/tenants all resolve to 2
    expect(screen.getByRole("button", { name: /signup\.started/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /project\.created/i })).toBeInTheDocument();
  });

  it("draft filters apply only after clicking Apply, and Reset clears both draft and applied state plus the segment", async () => {
    mockEvents(EVENTS_VM);
    mockSegments([{ id: "seg1", name: "Activated users" }]);
    mockEventDetail();
    render(<EventsScreen ctx={makeCtx()} />);

    const eventNameInput = screen.getByPlaceholderText("Event name");
    await userEvent.type(eventNameInput, "signup.started");
    // Not applied yet: useEvents should not have been called with the new filter value.
    expect(useEventsModule.useEvents).toHaveBeenLastCalledWith(expect.objectContaining({ filters: expect.objectContaining({ eventName: "" }) }));

    await userEvent.click(screen.getByText("Apply"));
    expect(useEventsModule.useEvents).toHaveBeenLastCalledWith(expect.objectContaining({ filters: expect.objectContaining({ eventName: "signup.started" }) }));

    await userEvent.click(screen.getByText("Reset"));
    expect(useEventsModule.useEvents).toHaveBeenLastCalledWith(expect.objectContaining({ filters: expect.objectContaining({ eventName: "" }), segmentId: undefined }));
  });

  it("selecting a segment passes segmentId to useEvents", async () => {
    mockEvents(EVENTS_VM);
    mockSegments([{ id: "seg1", name: "Activated users" }]);
    mockEventDetail();
    render(<EventsScreen ctx={makeCtx()} />);

    await userEvent.selectOptions(screen.getByLabelText("Segment"), "seg1");
    expect(useEventsModule.useEvents).toHaveBeenLastCalledWith(expect.objectContaining({ segmentId: "seg1" }));
  });

  it("clicking a row selects it and shows the event detail drawer", async () => {
    mockEvents(EVENTS_VM);
    mockSegments();
    mockEventDetail();
    render(<EventsScreen ctx={makeCtx()} />);

    await userEvent.click(screen.getByRole("button", { name: /signup\.started/i }));
    const drawer = screen.getByText(/event detail/i).closest(".sh-card") as HTMLElement;
    expect(within(drawer).getByText("1.0.0")).toBeInTheDocument();
  });

  it("shows replay samples with the linked event name", () => {
    mockEvents(EVENTS_VM);
    mockSegments();
    mockEventDetail();
    render(<EventsScreen ctx={makeCtx()} />);
    expect(screen.getByText(/replay samples/i)).toBeInTheDocument();
    expect(screen.getByText("replay_1")).toBeInTheDocument();
  });

  it("shows an empty hint when there are no replay samples", () => {
    mockEvents({ ...EVENTS_VM, replaySamples: [] });
    mockSegments();
    mockEventDetail();
    render(<EventsScreen ctx={makeCtx()} />);
    expect(screen.getByText("No replay samples")).toBeInTheDocument();
  });
});

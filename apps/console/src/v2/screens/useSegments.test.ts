// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSegmentsVM, useSegments, validateSegmentForm } from "./useSegments";
import type { AnalyticsSegment, AnalyticsSegmentPreview } from "../../api/types";

afterEach(() => vi.restoreAllMocks());

function segment(over: Partial<AnalyticsSegment> = {}): AnalyticsSegment {
  return {
    id: "s1",
    projectId: "p",
    environmentId: "e",
    name: "Activated users",
    description: null,
    actorType: "user",
    definition: { window: "30d", eventName: "project.created" },
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function makeClient(over: Record<string, unknown> = {}) {
  return {
    listAnalyticsSegments: vi.fn(async () => ({ segments: [] as AnalyticsSegment[] })),
    createAnalyticsSegment: vi.fn(async () => ({ segment: segment() })),
    updateAnalyticsSegment: vi.fn(async () => ({ segment: segment() })),
    archiveAnalyticsSegment: vi.fn(async () => undefined),
    previewAnalyticsSegment: vi.fn(
      async (): Promise<{ preview: AnalyticsSegmentPreview }> => ({
        preview: { segmentId: "s1", actorType: "user", window: "30d", actors: 12, samples: [] },
      })
    ),
    ...over,
  } as never;
}

describe("validateSegmentForm", () => {
  const base = { editingId: null, name: "", actorType: "user" as const, window: "30d" as const, eventName: "", propertyName: "", propertyValue: "" };

  it("requires a name", () => {
    expect(validateSegmentForm({ ...base, name: "", eventName: "signup" })).toMatch(/name/i);
  });

  it("requires at least one of eventName/propertyName", () => {
    expect(validateSegmentForm({ ...base, name: "X" })).toMatch(/event or property/i);
  });

  it("passes with name + eventName", () => {
    expect(validateSegmentForm({ ...base, name: "X", eventName: "signup" })).toBeNull();
  });

  it("passes with name + propertyName", () => {
    expect(validateSegmentForm({ ...base, name: "X", propertyName: "plan" })).toBeNull();
  });
});

describe("buildSegmentsVM", () => {
  it("summarizes actor type, window, event, and property condition", () => {
    const vm = buildSegmentsVM(
      [segment({ definition: { window: "7d", eventName: "signup.started", propertyName: "plan", propertyValue: "team" } })],
      {}
    );
    expect(vm.rows[0].summary).toBe("users · 7d · signup.started · plan = team");
    expect(vm.rows[0].previewActors).toBeNull();
  });

  it("reads preview actor counts by segment id", () => {
    const vm = buildSegmentsVM([segment()], { s1: { segmentId: "s1", actorType: "user", window: "30d", actors: 9, samples: [] } });
    expect(vm.rows[0].previewActors).toBe(9);
  });
});

describe("useSegments", () => {
  it("loads segments with previews", async () => {
    const client = makeClient({ listAnalyticsSegments: vi.fn(async () => ({ segments: [segment()] })) });
    const { result } = renderHook(() => useSegments({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rows).toHaveLength(1);
    expect(result.current.data?.rows[0].previewActors).toBe(12);
  });

  it("tolerates a missing listAnalyticsSegments method without throwing", async () => {
    const client = makeClient({ listAnalyticsSegments: undefined });
    const { result } = renderHook(() => useSegments({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  it("does nothing without project/environment scope", () => {
    const client = makeClient();
    renderHook(() => useSegments({ client, projectId: undefined, environmentId: undefined }));
    expect((client as never as { listAnalyticsSegments: { mock: { calls: unknown[] } } }).listAnalyticsSegments.mock.calls.length).toBe(0);
  });

  it("save() creates a segment, reloads, and returns true", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSegments({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    let ok = false;
    await act(async () => {
      ok = await result.current.save({
        editingId: null,
        name: "Activated",
        actorType: "user",
        window: "30d",
        eventName: "project.created",
        propertyName: "",
        propertyValue: "",
      });
    });
    expect(ok).toBe(true);
    expect((client as never as { createAnalyticsSegment: { mock: { calls: unknown[][] } } }).createAnalyticsSegment.mock.calls[0][0])
      .toMatchObject({ projectId: "p", environmentId: "e", name: "Activated", actorType: "user", definition: { eventName: "project.created" } });
  });

  it("save() rejects an invalid form without calling the client", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSegments({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    let ok = true;
    await act(async () => {
      ok = await result.current.save({ editingId: null, name: "", actorType: "user", window: "30d", eventName: "", propertyName: "", propertyValue: "" });
    });
    expect(ok).toBe(false);
    expect((client as never as { createAnalyticsSegment: { mock: { calls: unknown[] } } }).createAnalyticsSegment.mock.calls.length).toBe(0);
  });

  it("archive() archives and reloads", async () => {
    const client = makeClient({ listAnalyticsSegments: vi.fn(async () => ({ segments: [segment()] })) });
    const { result } = renderHook(() => useSegments({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    let ok = false;
    await act(async () => {
      ok = await result.current.archive("s1");
    });
    expect(ok).toBe(true);
    expect((client as never as { archiveAnalyticsSegment: { mock: { calls: unknown[][] } } }).archiveAnalyticsSegment.mock.calls[0][0]).toBe("s1");
  });
});

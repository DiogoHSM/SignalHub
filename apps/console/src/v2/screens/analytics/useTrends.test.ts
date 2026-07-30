// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsInsight, AnalyticsTrendResult, PromotedEventProperty } from "../../../api/types";
import { EMPTY_TREND_FORM, insightToForm, useTrends, validateTrendForm } from "./useTrends";

afterEach(() => vi.restoreAllMocks());

function insight(over: Partial<AnalyticsInsight> = {}): AnalyticsInsight {
  return {
    id: "ins_1",
    projectId: "p1",
    environmentId: "e1",
    name: "Checkout starts",
    description: "Product demand",
    definition: { bucket: "hour", metric: "count", eventName: "checkout.started" },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function promotedProperty(over: Partial<PromotedEventProperty> = {}): PromotedEventProperty {
  return {
    id: "prop_1",
    projectId: "p1",
    environmentId: "e1",
    property: "plan",
    displayName: "Plan",
    indexName: "analytics_event_property_plan",
    indexStatus: "ready",
    indexError: null,
    indexedAt: "2026-07-01T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeClient(over: Record<string, unknown> = {}) {
  const saved = insight();
  const trend: AnalyticsTrendResult = { buckets: ["2026-07-01T00:00:00.000Z"], series: [{ key: "all", label: "All events", values: [4] }] };
  return {
    listAnalyticsInsights: vi.fn(async () => ({ insights: [saved] })),
    listPromotedEventProperties: vi.fn(async () => ({ properties: [promotedProperty()] })),
    createAnalyticsInsight: vi.fn(async () => ({ insight: saved })),
    updateAnalyticsInsight: vi.fn(async () => ({ insight: saved })),
    archiveAnalyticsInsight: vi.fn(async () => undefined),
    promoteEventProperty: vi.fn(async () => ({ property: promotedProperty() })),
    archivePromotedEventProperty: vi.fn(async () => undefined),
    queryAnalyticsTrend: vi.fn(async () => ({ data: trend })),
    ...over,
  } as never;
}

describe("trend form helpers", () => {
  it("maps saved definitions into editable forms", () => {
    expect(insightToForm(insight({ definition: { bucket: "day", metric: "unique_actors", filters: [{ property: "plan", operator: "eq", value: "team" }] } })))
      .toMatchObject({ metric: "unique_actors", bucket: "day", window: "30d", filters: [{ property: "plan", operator: "eq", value: "team" }] });
  });

  it("validates names and complete property filters", () => {
    expect(validateTrendForm(EMPTY_TREND_FORM)).toMatch(/name/i);
    expect(validateTrendForm({ ...EMPTY_TREND_FORM, name: "Trend", filters: [{ property: "plan", operator: "eq", value: "" }] })).toMatch(/need a value/i);
    expect(validateTrendForm({ ...EMPTY_TREND_FORM, name: "Trend", filters: [{ property: "plan", operator: "exists" }] })).toBeNull();
    expect(validateTrendForm({ ...EMPTY_TREND_FORM, name: "Trend" })).toBeNull();
  });
});

describe("useTrends", () => {
  it("loads saved insights and promoted properties for the active scope", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useTrends({ client, projectId: "p1", environmentId: "e1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.insights.map((row) => row.name)).toEqual(["Checkout starts"]);
    expect(result.current.properties.map((row) => row.property)).toEqual(["plan"]);
  });

  it("reports unavailable clients without throwing", async () => {
    const client = makeClient({ listAnalyticsInsights: undefined });
    const { result } = renderHook(() => useTrends({ client, projectId: "p1", environmentId: "e1" }));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.insights).toEqual([]);
  });

  it("does not expose list data resolved for a previous scope", async () => {
    const oldInsights = deferred<{ insights: AnalyticsInsight[] }>();
    const client = makeClient({
      listAnalyticsInsights: vi.fn(({ projectId }: { projectId: string }) =>
        projectId === "p1" ? oldInsights.promise : Promise.resolve({ insights: [insight({ id: "ins_2", projectId: "p2", environmentId: "e2", name: "New scope" })] })
      ),
      listPromotedEventProperties: vi.fn(async () => ({ properties: [] })),
    });
    const { result, rerender } = renderHook(
      ({ projectId, environmentId }) => useTrends({ client, projectId, environmentId }),
      { initialProps: { projectId: "p1", environmentId: "e1" } }
    );
    rerender({ projectId: "p2", environmentId: "e2" });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.insights[0]?.name).toBe("New scope");
    await act(async () => oldInsights.resolve({ insights: [insight({ name: "Stale secret insight" })] }));
    expect(result.current.insights.map((row) => row.name)).not.toContain("Stale secret insight");
  });

  it("discards a preview that resolves after the scope changes", async () => {
    const oldPreview = deferred<{ data: AnalyticsTrendResult }>();
    const client = makeClient({ queryAnalyticsTrend: vi.fn(() => oldPreview.promise) });
    const { result, rerender } = renderHook(
      ({ projectId, environmentId }) => useTrends({ client, projectId, environmentId }),
      { initialProps: { projectId: "p1", environmentId: "e1" } }
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    let previewPromise!: Promise<boolean>;
    act(() => { previewPromise = result.current.runPreview({ ...EMPTY_TREND_FORM, name: "Trend" }); });
    rerender({ projectId: "p2", environmentId: "e2" });
    await act(async () => oldPreview.resolve({ data: { buckets: ["old"], series: [{ key: "private", label: "Private", values: [99] }] } }));
    expect(await previewPromise).toBe(false);
    expect(result.current.preview).toBeNull();
  });

  it("creates, updates, archives, and queries insights with the scoped definition", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useTrends({ client, projectId: "p1", environmentId: "e1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const form = {
      ...EMPTY_TREND_FORM,
      name: "Paid checkouts",
      eventName: "checkout.completed",
      breakdownProperty: "plan",
      filters: [{ property: "country", operator: "eq" as const, value: "BR" }],
    };
    await act(async () => { await result.current.runPreview(form); });
    expect((client as any).queryAnalyticsTrend).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1", environmentId: "e1", eventName: "checkout.completed", breakdownProperty: "plan", filters: [{ property: "country", operator: "eq", value: "BR" }],
    }));
    await act(async () => { await result.current.save(form); });
    expect((client as any).createAnalyticsInsight).toHaveBeenCalledWith(expect.objectContaining({ name: "Paid checkouts" }));
    await act(async () => { await result.current.save({ ...form, name: "Updated" }, "ins_1"); });
    expect((client as any).updateAnalyticsInsight).toHaveBeenCalledWith("ins_1", { projectId: "p1", environmentId: "e1" }, expect.objectContaining({ name: "Updated" }));
    await act(async () => { await result.current.archive("ins_1"); });
    expect((client as any).archiveAnalyticsInsight).toHaveBeenCalledWith("ins_1", { projectId: "p1", environmentId: "e1" });
  });

  it("keeps mutations single-flight", async () => {
    const pending = deferred<{ insight: AnalyticsInsight }>();
    const client = makeClient({ createAnalyticsInsight: vi.fn(() => pending.promise) });
    const { result } = renderHook(() => useTrends({ client, projectId: "p1", environmentId: "e1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const form = { ...EMPTY_TREND_FORM, name: "Only once" };
    let first!: Promise<AnalyticsInsight | null>;
    let second!: Promise<AnalyticsInsight | null>;
    act(() => {
      first = result.current.save(form);
      second = result.current.save(form);
    });
    expect((client as any).createAnalyticsInsight).toHaveBeenCalledTimes(1);
    expect(await second).toBeNull();
    await act(async () => pending.resolve({ insight: insight() }));
    expect(await first).not.toBeNull();
  });

  it("promotes and archives indexed properties in the active scope", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useTrends({ client, projectId: "p1", environmentId: "e1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await act(async () => { await result.current.promoteProperty(" plan ", " Pricing plan "); });
    expect((client as any).promoteEventProperty).toHaveBeenCalledWith({
      projectId: "p1", environmentId: "e1", property: "plan", displayName: "Pricing plan",
    });
    await act(async () => { await result.current.archiveProperty("prop_1"); });
    expect((client as any).archivePromotedEventProperty).toHaveBeenCalledWith("prop_1", { projectId: "p1", environmentId: "e1" });
  });

  it("reloads property state after an index promotion fails", async () => {
    const listPromotedEventProperties = vi.fn(async () => ({ properties: [] }));
    const client = makeClient({
      listPromotedEventProperties,
      promoteEventProperty: vi.fn(async () => { throw new Error("index failed"); })
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useTrends({ client, projectId: "p1", environmentId: "e1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    await act(async () => { await result.current.promoteProperty("plan", "Plan"); });

    await waitFor(() => expect(listPromotedEventProperties).toHaveBeenCalledTimes(2));
  });
});

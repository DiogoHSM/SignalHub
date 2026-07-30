// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnalyticsDashboard, AnalyticsInsight, DashboardReportResponse } from "../../../api/types";
import { dashboardToForm, EMPTY_DASHBOARD_FORM, newInsightWidget, useAnalyticsDashboards, validateDashboardForm } from "./useAnalyticsDashboards";

function insight(over: Partial<AnalyticsInsight> = {}): AnalyticsInsight {
  return { id: "ins_1", projectId: "p1", environmentId: "e1", name: "Activation", description: null, definition: { bucket: "hour", metric: "count" }, createdAt: "now", updatedAt: "now", archivedAt: null, ...over };
}

function dashboard(over: Partial<AnalyticsDashboard> = {}): AnalyticsDashboard {
  return { id: "dash_1", projectId: "p1", environmentId: "e1", name: "Operations", description: null, category: "operational", filters: { window: "24h" }, widgets: [{ id: "wid_1", type: "metric.events", title: "Events", width: "half", options: {} }], createdAt: "now", updatedAt: "now", archivedAt: null, ...over };
}

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

function client(over: Record<string, unknown> = {}) {
  const saved = dashboard();
  return {
    listAnalyticsDashboards: vi.fn(async () => ({ dashboards: [saved] })),
    listAnalyticsInsights: vi.fn(async () => ({ insights: [insight()] })),
    createAnalyticsDashboard: vi.fn(async () => ({ dashboard: saved })),
    updateAnalyticsDashboard: vi.fn(async () => ({ dashboard: saved })),
    archiveAnalyticsDashboard: vi.fn(async () => undefined),
    getDashboardReport: vi.fn(async () => ({ data: { dashboard: saved, generatedAt: "now", scope: { projectId: "p1", environmentId: "e1" }, window: "24h", widgets: [] } as DashboardReportResponse })),
    ...over,
  } as never;
}

describe("dashboard form helpers", () => {
  it("maps legacy widgets and creates insight widgets", () => {
    expect(dashboardToForm(dashboard()).widgets[0]?.type).toBe("metric.events");
    expect(newInsightWidget(insight()).options).toEqual({ insightId: "ins_1" });
  });

  it("requires a name, widget, and widget titles", () => {
    expect(validateDashboardForm(EMPTY_DASHBOARD_FORM)).toMatch(/name/i);
    expect(validateDashboardForm({ ...EMPTY_DASHBOARD_FORM, name: "A" })).toMatch(/at least one/i);
    expect(validateDashboardForm({ ...EMPTY_DASHBOARD_FORM, name: "A", widgets: [{ ...newInsightWidget(insight()), title: "" }] })).toMatch(/title/i);
  });
});

describe("useAnalyticsDashboards", () => {
  it("loads dashboards and insights for the active scope", async () => {
    const api = client();
    const { result } = renderHook(() => useAnalyticsDashboards({ client: api, projectId: "p1", environmentId: "e1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.dashboards[0]?.name).toBe("Operations");
    expect(result.current.insights[0]?.name).toBe("Activation");
  });

  it("does not expose stale scope data or preview results", async () => {
    const oldList = deferred<{ dashboards: AnalyticsDashboard[] }>();
    const oldPreview = deferred<{ data: DashboardReportResponse }>();
    const api = client({
      listAnalyticsDashboards: vi.fn(({ projectId }: { projectId: string }) => projectId === "p1" ? oldList.promise : Promise.resolve({ dashboards: [dashboard({ id: "dash_2", projectId: "p2", environmentId: "e2", name: "New" })] })),
      getDashboardReport: vi.fn(() => oldPreview.promise),
    });
    const { result, rerender } = renderHook(({ p, e }) => useAnalyticsDashboards({ client: api, projectId: p, environmentId: e }), { initialProps: { p: "p1", e: "e1" } });
    rerender({ p: "p2", e: "e2" });
    await waitFor(() => expect(result.current.dashboards[0]?.name).toBe("New"));
    await act(async () => oldList.resolve({ dashboards: [dashboard({ name: "Secret" })] }));
    expect(result.current.dashboards[0]?.name).toBe("New");
    let pending!: Promise<boolean>;
    act(() => { pending = result.current.previewDashboard("dash_2", "24h"); });
    rerender({ p: "p3", e: "e3" });
    await act(async () => oldPreview.resolve({ data: { dashboard: dashboard(), generatedAt: "now", scope: { projectId: "p2", environmentId: "e2" }, window: "24h", widgets: [] } }));
    expect(await pending).toBe(false);
    expect(result.current.preview).toBeNull();
  });

  it("creates, updates, duplicates, archives, previews, and keeps mutations single-flight", async () => {
    const pending = deferred<{ dashboard: AnalyticsDashboard }>();
    const api = client({ createAnalyticsDashboard: vi.fn(() => pending.promise) });
    const { result } = renderHook(() => useAnalyticsDashboards({ client: api, projectId: "p1", environmentId: "e1" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const form = { ...EMPTY_DASHBOARD_FORM, name: "New", widgets: [newInsightWidget(insight())] };
    let first!: Promise<AnalyticsDashboard | null>; let second!: Promise<AnalyticsDashboard | null>;
    act(() => { first = result.current.save(form); second = result.current.save(form); });
    expect((api as any).createAnalyticsDashboard).toHaveBeenCalledTimes(1);
    expect(await second).toBeNull();
    await act(async () => pending.resolve({ dashboard: dashboard() }));
    expect(await first).not.toBeNull();
    await act(async () => { await result.current.save(form, "dash_1"); await result.current.previewDashboard("dash_1", "7d"); await result.current.archive("dash_1"); });
    expect((api as any).updateAnalyticsDashboard).toHaveBeenCalled();
    expect((api as any).getDashboardReport).toHaveBeenCalledWith("dash_1", expect.objectContaining({ window: "7d" }));
    expect((api as any).archiveAnalyticsDashboard).toHaveBeenCalled();
  });
});

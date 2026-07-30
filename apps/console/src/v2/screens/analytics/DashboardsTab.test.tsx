// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsDashboard, AnalyticsInsight } from "../../../api/types";
import { DashboardsTab } from "./DashboardsTab";

const save = vi.fn(); const archive = vi.fn(); const duplicate = vi.fn(); const previewDashboard = vi.fn();
const insight: AnalyticsInsight = { id: "ins_1", projectId: "p1", environmentId: "e1", name: "Activation", description: null, definition: { bucket: "hour", metric: "count" }, createdAt: "now", updatedAt: "now", archivedAt: null };
const dashboard: AnalyticsDashboard = { id: "dash_1", projectId: "p1", environmentId: "e1", name: "Operations", description: "Daily command view", category: "operational", filters: { window: "24h" }, widgets: [{ id: "wid_old", type: "metric.events", title: "Events", width: "half", options: {} }], createdAt: "now", updatedAt: "now", archivedAt: null };

vi.mock("./useAnalyticsDashboards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useAnalyticsDashboards")>();
  return { ...actual, useAnalyticsDashboards: () => ({ dashboards: [dashboard], insights: [insight], status: "ok", busy: false, preview: { dashboard, generatedAt: "now", scope: { projectId: "p1", environmentId: "e1" }, window: "24h", widgets: [{ widgetId: "wid_old", type: "metric.events", title: "Events", width: "half", status: "ok", data: { value: 42, label: "Events" } }] }, previewStatus: "ok", reload: vi.fn(), previewDashboard, save, duplicate, archive }) };
});

function ctx() { return { client: {}, project: { id: "p1" }, environment: { id: "e1" }, pushToast: vi.fn() } as never; }

beforeEach(() => { vi.clearAllMocks(); save.mockResolvedValue(dashboard); archive.mockResolvedValue(true); duplicate.mockResolvedValue({ ...dashboard, id: "dash_2", name: "Operations copy" }); previewDashboard.mockResolvedValue(true); });
afterEach(cleanup);

describe("DashboardsTab", () => {
  it("renders the dashboard library, legacy widgets, and report values", () => {
    render(<DashboardsTab ctx={ctx()} />);
    expect(screen.getByRole("button", { name: /Operations/ })).toBeInTheDocument();
    expect(screen.getByText(/Legacy widget/)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("adds a saved insight and saves the composed dashboard", async () => {
    render(<DashboardsTab ctx={ctx()} />);
    fireEvent.change(screen.getByLabelText("Saved insight"), { target: { value: "ins_1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByDisplayValue("Activation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ widgets: expect.arrayContaining([expect.objectContaining({ title: "Activation" })]) }), "dash_1"));
  });

  it("reorders widgets, duplicates, refreshes, and confirms archive", async () => {
    render(<DashboardsTab ctx={ctx()} />);
    fireEvent.change(screen.getByLabelText("Saved insight"), { target: { value: "ins_1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    fireEvent.click(screen.getByLabelText("Move widget 2 up"));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(screen.getByLabelText("Refresh dashboard preview"));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    await waitFor(() => expect(duplicate).toHaveBeenCalled());
    expect(previewDashboard).toHaveBeenCalledWith("dash_1", "24h");
    expect(archive).toHaveBeenCalledWith("dash_1");
  });
});

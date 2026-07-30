// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsInsight, Environment, Project } from "../../../api/types";
import type { ScreenCtx } from "../registry";
import { TrendsTab } from "./TrendsTab";
import * as useTrendsModule from "./useTrends";
import type { TrendForm, UseTrendsResult } from "./useTrends";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function insight(over: Partial<AnalyticsInsight> = {}): AnalyticsInsight {
  return {
    id: "ins_1",
    projectId: "p1",
    environmentId: "e1",
    name: "Checkout starts",
    description: "Demand signal",
    definition: { bucket: "hour", metric: "count", eventName: "checkout.started" },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function makeCtx(): ScreenCtx {
  const project = { id: "p1", name: "Demo" } as Project;
  const environment = { id: "e1", name: "production" } as Environment;
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
    pendingFilters: null,
    clearPendingFilters: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
  } as ScreenCtx;
}

function mockTrends(over: Partial<UseTrendsResult> = {}): UseTrendsResult {
  const result: UseTrendsResult = {
    insights: [],
    properties: [{
      id: "prop_1",
      projectId: "p1",
      environmentId: "e1",
      property: "plan",
      displayName: "Subscription plan",
      indexName: "analytics_event_property_plan",
      indexStatus: "ready",
      indexError: null,
      indexedAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      archivedAt: null,
    }],
    status: "ok",
    busy: false,
    preview: null,
    previewStatus: "idle",
    reload: vi.fn(),
    runPreview: vi.fn().mockResolvedValue(true),
    save: vi.fn(async (form: TrendForm, id?: string) => insight({ id: id ?? "ins_new", name: form.name, description: form.description || null, definition: {
      bucket: form.bucket,
      metric: form.metric,
      ...(form.eventName ? { eventName: form.eventName } : {}),
      ...(form.breakdownProperty ? { breakdownProperty: form.breakdownProperty } : {}),
      ...(form.filters.length > 0 ? { filters: form.filters } : {}),
    } })),
    archive: vi.fn().mockResolvedValue(true),
    promoteProperty: vi.fn().mockResolvedValue({}),
    archiveProperty: vi.fn().mockResolvedValue(true),
    ...over,
  };
  vi.spyOn(useTrendsModule, "useTrends").mockReturnValue(result);
  return result;
}

describe("TrendsTab", () => {
  it("renders the saved library and selects an insight for editing", async () => {
    mockTrends({ insights: [insight()] });
    render(<TrendsTab ctx={makeCtx()} />);
    await waitFor(() => expect(screen.getByLabelText("Insight name")).toHaveValue("Checkout starts"));
    expect(screen.getByRole("button", { name: /checkout starts/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Breakdown property")).toContainHTML("Subscription plan");
  });

  it("creates and previews a new insight", async () => {
    const trends = mockTrends();
    const ctx = makeCtx();
    render(<TrendsTab ctx={ctx} />);
    await userEvent.type(screen.getByLabelText("Insight name"), "Weekly activation");
    await userEvent.type(screen.getByLabelText("Event name"), "project.created");
    await userEvent.click(screen.getAllByRole("button", { name: "Preview" }).at(-1)!);
    expect(trends.runPreview).toHaveBeenCalledWith(expect.objectContaining({ name: "Weekly activation", eventName: "project.created" }));
    await userEvent.click(screen.getByRole("button", { name: "Save insight" }));
    expect(trends.save).toHaveBeenCalledWith(expect.objectContaining({ name: "Weekly activation" }), undefined);
    await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Insight created"));
  });

  it("edits and duplicates a saved insight as a new definition", async () => {
    const trends = mockTrends({ insights: [insight()] });
    render(<TrendsTab ctx={makeCtx()} />);
    await waitFor(() => expect(screen.getByLabelText("Insight name")).toHaveValue("Checkout starts"));
    await userEvent.clear(screen.getByLabelText("Insight name"));
    await userEvent.type(screen.getByLabelText("Insight name"), "Checkout demand");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(trends.save).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Checkout demand" }), "ins_1");

    await userEvent.click(screen.getByRole("button", { name: /duplicate/i }));
    expect(screen.getByLabelText("Insight name")).toHaveValue("Copy of Checkout demand");
    await userEvent.click(screen.getByRole("button", { name: "Save insight" }));
    expect(trends.save).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Copy of Checkout demand" }), undefined);
  });

  it("requires confirmation before archiving", async () => {
    const trends = mockTrends({ insights: [insight()] });
    render(<TrendsTab ctx={makeCtx()} />);
    await waitFor(() => expect(screen.getByLabelText("Archive insight")).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText("Archive insight"));
    expect(trends.archive).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText("Confirm archive insight"));
    expect(trends.archive).toHaveBeenCalledWith("ins_1");
  });

  it("supports existence filters without requiring a value", async () => {
    mockTrends();
    render(<TrendsTab ctx={makeCtx()} />);
    await userEvent.type(screen.getByLabelText("Insight name"), "Known plans");
    await userEvent.click(screen.getByRole("button", { name: /add filter/i }));
    await userEvent.type(screen.getByLabelText("Filter 1 property"), "plan");
    await userEvent.selectOptions(screen.getByLabelText("Filter 1 operator"), "exists");
    expect(screen.getByLabelText("Filter 1 value")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Save insight" }));
    const trendsHook = vi.mocked(useTrendsModule.useTrends).mock.results.at(-1)?.value;
    expect(trendsHook?.save).toHaveBeenCalledWith(expect.objectContaining({ filters: [{ property: "plan", operator: "exists" }] }), undefined);
  });

  it("presents labelled multi-series preview data", () => {
    const labelledSeries = { key: "team", label: "Team plan", values: [2, 4] };
    mockTrends({
      previewStatus: "ok",
      preview: {
        buckets: ["2026-07-01T00:00:00.000Z", "2026-07-01T01:00:00.000Z"],
        series: [labelledSeries],
      },
    });
    render(<TrendsTab ctx={makeCtx()} />);
    const preview = screen.getByRole("region", { name: "Trend preview" });
    expect(within(preview).getByText("Team plan")).toBeInTheDocument();
    expect(within(preview).getByText("6")).toBeInTheDocument();
  });

  it("shows an explicit unavailable state", () => {
    mockTrends({ status: "unavailable" });
    render(<TrendsTab ctx={makeCtx()} />);
    expect(screen.getByText("Saved trends unavailable")).toBeInTheDocument();
  });

  it("creates and removes promoted property indexes", async () => {
    const trends = mockTrends();
    render(<TrendsTab ctx={makeCtx()} />);
    await userEvent.type(screen.getByLabelText("Promoted property key"), "country");
    await userEvent.type(screen.getByLabelText("Promoted property display name"), "Country");
    await userEvent.click(screen.getByRole("button", { name: "Create index" }));
    expect(trends.promoteProperty).toHaveBeenCalledWith("country", "Country");
    await userEvent.click(screen.getByLabelText("Remove Subscription plan index"));
    await userEvent.click(screen.getByLabelText("Confirm remove Subscription plan index"));
    expect(trends.archiveProperty).toHaveBeenCalledWith("prop_1");
  });

  it("resets the selected insight when the project scope changes", async () => {
    const first = mockTrends({ insights: [insight({ id: "ins_p1", name: "Project one" })] });
    const second: UseTrendsResult = {
      ...first,
      insights: [insight({ id: "ins_p2", projectId: "p2", environmentId: "e2", name: "Project two" })],
    };
    vi.mocked(useTrendsModule.useTrends).mockImplementation(({ projectId }) => projectId === "p2" ? second : first);
    const firstCtx = makeCtx();
    const { rerender } = render(<TrendsTab ctx={firstCtx} />);
    await waitFor(() => expect(screen.getByLabelText("Insight name")).toHaveValue("Project one"));

    const secondCtx = {
      ...firstCtx,
      project: { id: "p2", name: "Second" } as Project,
      environment: { id: "e2", name: "production" } as Environment,
    };
    rerender(<TrendsTab ctx={secondCtx} />);
    await waitFor(() => expect(screen.getByLabelText("Insight name")).toHaveValue("Project two"));
  });
});

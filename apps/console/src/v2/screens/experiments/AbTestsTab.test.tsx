// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../../api/types";
import { AbTestsTab } from "./AbTestsTab";
import type { ScreenCtx } from "../registry";
import * as useAbTestsModule from "./useAbTests";
import type { AbTestsVM } from "./useAbTests";

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

const vm: AbTestsVM = {
  rows: [
    { id: "x1", key: "checkout_copy", name: "Checkout copy", status: "running", variantsLabel: "control:50, treatment:50", conversionEvent: "checkout.completed" },
  ],
  selected: {
    id: "x1",
    totals: { exposures: 200, conversions: 24, variants: 2 },
    variants: [
      { key: "control", weight: 50, exposures: 100, conversions: 10, conversionRateLabel: "10.0%", liftLabel: "Baseline", interpretationLabel: "Baseline" },
      { key: "treatment", weight: 50, exposures: 100, conversions: 14, conversionRateLabel: "14.0%", liftLabel: "+4.0 pp", interpretationLabel: "Directional lead" },
    ],
  },
};

function mockHook(over: Partial<useAbTestsModule.UseAbTestsResult> = {}) {
  vi.spyOn(useAbTestsModule, "useAbTests").mockReturnValue({
    data: vm,
    status: "ok",
    busy: false,
    reload: vi.fn(),
    createExperiment: vi.fn().mockResolvedValue(true),
    updateExperimentStatus: vi.fn().mockResolvedValue(true),
    archiveExperiment: vi.fn().mockResolvedValue(true),
    ...over,
  });
}

describe("AbTestsTab", () => {
  it("shows a loading hint", () => {
    mockHook({ data: null, status: "loading" });
    render(<AbTestsTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/loading a\/b tests/i)).toBeInTheDocument();
  });

  it("shows an unavailable hint on error, without throwing", () => {
    mockHook({ data: null, status: "error" });
    render(<AbTestsTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/a\/b tests unavailable/i)).toBeInTheDocument();
  });

  it("shows an empty hint when there are no experiments", () => {
    mockHook({ data: { rows: [], selected: null } });
    render(<AbTestsTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/no experiments yet/i)).toBeInTheDocument();
  });

  it("renders the experiment row and the variant readout", () => {
    mockHook();
    render(<AbTestsTab ctx={makeCtx()} enabled />);
    expect(screen.getByText("Checkout copy")).toBeInTheDocument();
    expect(screen.getByText("control:50, treatment:50")).toBeInTheDocument();
    expect(screen.getByText("Directional lead")).toBeInTheDocument();
    expect(screen.getByText("+4.0 pp")).toBeInTheDocument();
  });

  it("opens the create form and calls createExperiment with parsed form fields", async () => {
    const createExperiment = vi.fn().mockResolvedValue(true);
    mockHook({ createExperiment });
    const ctx = makeCtx();
    render(<AbTestsTab ctx={ctx} enabled />);
    await userEvent.click(screen.getByText(/new experiment/i));
    await userEvent.click(screen.getByText(/^create experiment$/i));
    expect(createExperiment).toHaveBeenCalledWith(
      expect.objectContaining({ key: "checkout_copy", name: "Checkout copy", variants: "control:50,treatment:50" }),
    );
    expect(ctx.pushToast).toHaveBeenCalledWith("Experiment created");
  });

  it("toggles running/paused status via the icon button", async () => {
    const updateExperimentStatus = vi.fn().mockResolvedValue(true);
    mockHook({ updateExperimentStatus });
    render(<AbTestsTab ctx={makeCtx()} enabled />);
    await userEvent.click(screen.getByTitle("Pause"));
    expect(updateExperimentStatus).toHaveBeenCalledWith("x1", "paused");
  });

  it("archives an experiment only after two ConfirmButton clicks", async () => {
    const archiveExperiment = vi.fn().mockResolvedValue(true);
    mockHook({ archiveExperiment });
    render(<AbTestsTab ctx={makeCtx()} enabled />);
    const archiveBtn = screen.getByTitle("Pause").parentElement?.querySelector("button:last-child") as HTMLElement;
    await userEvent.click(archiveBtn);
    expect(archiveExperiment).not.toHaveBeenCalled();
    await userEvent.click(archiveBtn);
    expect(archiveExperiment).toHaveBeenCalledWith("x1");
  });

  it("shows a select-an-experiment hint when nothing is selected", () => {
    mockHook({ data: { rows: [], selected: null } });
    render(<AbTestsTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/no experiments yet/i)).toBeInTheDocument();
  });
});

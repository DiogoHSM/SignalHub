// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../../api/types";
import { FeatureFlagsTab } from "./FeatureFlagsTab";
import type { ScreenCtx } from "../registry";
import type { FlagsVM, UseFeatureFlagsResult } from "./useFeatureFlags";

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

const vm: FlagsVM = {
  rows: [
    { id: "f1", key: "new_checkout", name: "New checkout", status: "active", defaultVariant: "off", variantsLabel: "off, on", rulesCount: 1, rolloutLabel: "25% user" },
  ],
};

function makeFlags(over: Partial<UseFeatureFlagsResult> = {}): UseFeatureFlagsResult {
  return {
    data: vm,
    status: "ok",
    busy: false,
    reload: vi.fn(),
    createFlag: vi.fn().mockResolvedValue(true),
    updateFlagStatus: vi.fn().mockResolvedValue(true),
    archiveFlag: vi.fn().mockResolvedValue(true),
    evaluateFlag: vi.fn().mockResolvedValue({ key: "new_checkout", variant: "on", value: true, matched: true, reason: "rule_match", ruleId: "r1" }),
    loadAudit: vi.fn().mockResolvedValue([{ id: "a1", featureFlagId: "f1", projectId: "p", environmentId: "e", action: "created", actorId: "u1", changes: null, createdAt: "2026-06-01T00:00:00.000Z" }]),
    ...over,
  };
}

describe("FeatureFlagsTab", () => {
  it("shows a loading hint", () => {
    render(<FeatureFlagsTab ctx={makeCtx()} flags={makeFlags({ data: null, status: "loading" })} />);
    expect(screen.getByText(/loading feature flags/i)).toBeInTheDocument();
  });

  it("shows an unavailable hint on error", () => {
    render(<FeatureFlagsTab ctx={makeCtx()} flags={makeFlags({ data: null, status: "error" })} />);
    expect(screen.getByText(/feature flags unavailable/i)).toBeInTheDocument();
  });

  it("shows an empty hint with no flags", () => {
    render(<FeatureFlagsTab ctx={makeCtx()} flags={makeFlags({ data: { rows: [] } })} />);
    expect(screen.getByText(/no feature flags yet/i)).toBeInTheDocument();
  });

  it("renders the flag row with rollout and rule count", () => {
    render(<FeatureFlagsTab ctx={makeCtx()} flags={makeFlags()} />);
    expect(screen.getAllByText("new_checkout").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("25% user")).toBeInTheDocument();
  });

  it("runs the evaluate dry-run and renders variant, value, matched, reason, ruleId", async () => {
    const evaluateFlag = vi.fn().mockResolvedValue({ key: "new_checkout", variant: "on", value: true, matched: true, reason: "rule_match", ruleId: "r1" });
    render(<FeatureFlagsTab ctx={makeCtx()} flags={makeFlags({ evaluateFlag })} />);
    await userEvent.click(screen.getByRole("button", { name: /^evaluate$/i }));
    expect(evaluateFlag).toHaveBeenCalledWith("f1", expect.objectContaining({ subject: {} }));
    expect(await screen.findByText("on")).toBeInTheDocument();
    expect(screen.getByText("rule_match")).toBeInTheDocument();
    expect(screen.getByText("r1")).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("loads audit entries on-demand when the panel is opened", async () => {
    const loadAudit = vi.fn().mockResolvedValue([
      { id: "a1", featureFlagId: "f1", projectId: "p", environmentId: "e", action: "created", actorId: "u1", changes: null, createdAt: "2026-06-01T00:00:00.000Z" },
    ]);
    render(<FeatureFlagsTab ctx={makeCtx()} flags={makeFlags({ loadAudit })} />);
    expect(loadAudit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText(/^show$/i));
    expect(loadAudit).toHaveBeenCalledWith("f1");
    expect(await screen.findByText("created")).toBeInTheDocument();
  });

  it("toggles status via the icon button", async () => {
    const updateFlagStatus = vi.fn().mockResolvedValue(true);
    render(<FeatureFlagsTab ctx={makeCtx()} flags={makeFlags({ updateFlagStatus })} />);
    await userEvent.click(screen.getByTitle("Pause"));
    expect(updateFlagStatus).toHaveBeenCalledWith("f1", "paused");
  });

  it("archives a flag only after two ConfirmButton clicks", async () => {
    const archiveFlag = vi.fn().mockResolvedValue(true);
    render(<FeatureFlagsTab ctx={makeCtx()} flags={makeFlags({ archiveFlag })} />);
    const archiveBtn = screen.getByTitle("Pause").parentElement?.querySelector("button:last-child") as HTMLElement;
    await userEvent.click(archiveBtn);
    expect(archiveFlag).not.toHaveBeenCalled();
    await userEvent.click(archiveBtn);
    expect(archiveFlag).toHaveBeenCalledWith("f1");
  });
});

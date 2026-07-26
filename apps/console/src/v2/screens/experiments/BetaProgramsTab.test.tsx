// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../../api/types";
import { BetaProgramsTab } from "./BetaProgramsTab";
import type { ScreenCtx } from "../registry";
import * as useBetaProgramsModule from "./useBetaPrograms";
import type { BetaProgramsVM } from "./useBetaPrograms";
import type { UseFeatureFlagsResult } from "./useFeatureFlags";

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

const vm: BetaProgramsVM = {
  rows: [{ id: "b1", key: "checkout_beta", name: "Checkout beta", status: "active", actorType: "user", featureFlagId: "f1" }],
  selected: {
    id: "b1",
    status: "active",
    actorType: "user",
    participants: [{ id: "pt1", actorId: "u1", status: "active", notes: "none" }],
    participantsCount: 12,
    activeParticipants: 9,
    adoptionRateLabel: "77.7%",
  },
};

function mockHook(over: Partial<useBetaProgramsModule.UseBetaProgramsResult> = {}) {
  vi.spyOn(useBetaProgramsModule, "useBetaPrograms").mockReturnValue({
    data: vm,
    status: "ok",
    busy: false,
    reload: vi.fn(),
    createProgram: vi.fn().mockResolvedValue(true),
    updateProgramStatus: vi.fn().mockResolvedValue(true),
    archiveProgram: vi.fn().mockResolvedValue(true),
    addParticipant: vi.fn().mockResolvedValue(true),
    removeParticipant: vi.fn().mockResolvedValue(true),
    ...over,
  });
}

function makeFlags(): UseFeatureFlagsResult {
  return {
    data: { rows: [{ id: "f1", key: "new_checkout", name: "New checkout", status: "active", defaultVariant: "off", variantsLabel: "off, on", rulesCount: 0, rolloutLabel: "none" }] },
    status: "ok",
    busy: false,
    reload: vi.fn(),
    createFlag: vi.fn(),
    updateFlagStatus: vi.fn(),
    archiveFlag: vi.fn(),
    evaluateFlag: vi.fn(),
    loadAudit: vi.fn(),
  };
}

describe("BetaProgramsTab", () => {
  it("shows a loading hint", () => {
    mockHook({ data: null, status: "loading" });
    render(<BetaProgramsTab ctx={makeCtx()} flags={makeFlags()} enabled />);
    expect(screen.getByText(/loading beta programs/i)).toBeInTheDocument();
  });

  it("shows an unavailable hint on error", () => {
    mockHook({ data: null, status: "error" });
    render(<BetaProgramsTab ctx={makeCtx()} flags={makeFlags()} enabled />);
    expect(screen.getByText(/beta programs unavailable/i)).toBeInTheDocument();
  });

  it("shows an empty hint with no programs", () => {
    mockHook({ data: { rows: [], selected: null } });
    render(<BetaProgramsTab ctx={makeCtx()} flags={makeFlags()} enabled />);
    expect(screen.getByText(/no beta programs yet/i)).toBeInTheDocument();
  });

  it("renders participants and adoption", () => {
    mockHook();
    render(<BetaProgramsTab ctx={makeCtx()} flags={makeFlags()} enabled />);
    expect(screen.getByText("u1")).toBeInTheDocument();
    expect(screen.getByText("77.7%")).toBeInTheDocument();
  });

  it("populates the controlled-flag select from the passed-in flags list when creating a program", async () => {
    mockHook();
    render(<BetaProgramsTab ctx={makeCtx()} flags={makeFlags()} enabled />);
    await userEvent.click(screen.getByText(/new beta program/i));
    expect(screen.getByText("new_checkout")).toBeInTheDocument();
  });

  it("adds a participant using the input field", async () => {
    const addParticipant = vi.fn().mockResolvedValue(true);
    mockHook({ addParticipant });
    render(<BetaProgramsTab ctx={makeCtx()} flags={makeFlags()} enabled />);
    await userEvent.type(screen.getByPlaceholderText(/participant id/i), "u2");
    await userEvent.click(screen.getByText(/^add participant$/i));
    expect(addParticipant).toHaveBeenCalledWith("u2");
  });

  it("removes a participant only after two ConfirmButton clicks", async () => {
    const removeParticipant = vi.fn().mockResolvedValue(true);
    mockHook({ removeParticipant });
    render(<BetaProgramsTab ctx={makeCtx()} flags={makeFlags()} enabled />);
    const removeBtn = screen.getByText("u1").parentElement?.querySelector("button:last-child") as HTMLElement;
    await userEvent.click(removeBtn);
    expect(removeParticipant).not.toHaveBeenCalled();
    await userEvent.click(removeBtn);
    expect(removeParticipant).toHaveBeenCalledWith("pt1");
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment, Project } from "../../../api/types";
import { CampaignsTab } from "./CampaignsTab";
import type { ScreenCtx } from "../registry";
import * as useCampaignsModule from "./useCampaigns";
import type { CampaignsVM } from "./useCampaigns";

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

const vm: CampaignsVM = {
  rows: [{ id: "c1", key: "invoice_activation", name: "Invoice activation", status: "active", channelType: "in_app", conversionEvent: "invoice.paid" }],
  selected: {
    id: "c1",
    status: "active",
    channelType: "in_app",
    conversionEvent: "invoice.paid",
    consentCategory: "product",
    privacyNote: "Respects opt-outs.",
    totals: { queued: 100, sent: 95, delivered: 90, opened: 40, clicked: 20, converted: 10, failed: 5, optedOut: 2, uniqueActors: 80 },
    rates: { deliveryRatePct: "94.7%", openRatePct: "44.4%", clickRatePct: "22.2%", conversionRatePct: "11.1%", optOutRatePct: "2.1%" },
    recentEvents: [{ id: "e1", occurredAtLabel: "6/23/2026", type: "delivered", actorLabel: "user u1", tenantLabel: "t1" }],
    optOutsCount: 1,
  },
};

function mockHook(over: Partial<useCampaignsModule.UseCampaignsResult> = {}) {
  vi.spyOn(useCampaignsModule, "useCampaigns").mockReturnValue({
    data: vm,
    status: "ok",
    busy: false,
    reload: vi.fn(),
    createCampaign: vi.fn().mockResolvedValue(true),
    updateCampaignStatus: vi.fn().mockResolvedValue(true),
    archiveCampaign: vi.fn().mockResolvedValue(true),
    ...over,
  });
}

describe("CampaignsTab", () => {
  it("shows a loading hint", () => {
    mockHook({ data: null, status: "loading" });
    render(<CampaignsTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/loading message campaigns/i)).toBeInTheDocument();
  });

  it("shows an unavailable hint on error", () => {
    mockHook({ data: null, status: "error" });
    render(<CampaignsTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/message campaigns unavailable/i)).toBeInTheDocument();
  });

  it("shows an empty hint with no campaigns", () => {
    mockHook({ data: { rows: [], selected: null } });
    render(<CampaignsTab ctx={makeCtx()} enabled />);
    expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument();
  });

  it("renders delivery funnel rates and the privacy note", () => {
    mockHook();
    render(<CampaignsTab ctx={makeCtx()} enabled />);
    expect(screen.getByText("Respects opt-outs.")).toBeInTheDocument();
    expect(screen.getByText("94.7%")).toBeInTheDocument();
    expect(screen.getByText(/1 opt-out records/i)).toBeInTheDocument();
  });

  it("disables create when an email/webhook channel is missing a notification channel id", async () => {
    mockHook();
    render(<CampaignsTab ctx={makeCtx()} enabled />);
    await userEvent.click(screen.getByText(/new campaign/i));
    await userEvent.selectOptions(screen.getByDisplayValue("In-app"), "email");
    const createBtn = screen.getByRole("button", { name: /^create campaign$/i });
    expect(createBtn).toBeDisabled();
  });

  it("archives a campaign only after two ConfirmButton clicks", async () => {
    const archiveCampaign = vi.fn().mockResolvedValue(true);
    mockHook({ archiveCampaign });
    render(<CampaignsTab ctx={makeCtx()} enabled />);
    const archiveBtn = screen.getByTitle("Pause").parentElement?.querySelector("button:last-child") as HTMLElement;
    await userEvent.click(archiveBtn);
    expect(archiveCampaign).not.toHaveBeenCalled();
    await userEvent.click(archiveBtn);
    expect(archiveCampaign).toHaveBeenCalledWith("c1");
  });
});

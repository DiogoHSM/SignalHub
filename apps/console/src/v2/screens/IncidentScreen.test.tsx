// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IncidentVM } from "./useIncident";
import * as useIncidentModule from "./useIncident";
import { IncidentScreen } from "./IncidentScreen";
import type { ScreenCtx } from "./registry";

// ---------------------------------------------------------------------------
// Canned VM
// ---------------------------------------------------------------------------

const MOCK_VM: IncidentVM = {
  severity: "critical",
  severityColor: "var(--sev-critical)",
  status: "investigating",
  priority: "P1",
  groupId: "err_grp_8a2f91d0",
  primaryOccurrenceId: "err_primary",
  release: "v2026.05.14",
  incidentNumber: "4821",
  openedRelative: "18 min ago",
  assigneeEmail: "ana@acme.dev",
  title: "PaymentTimeoutError: provider timeout after 12000ms",
  origin: "apps/api/src/routes/checkout.ts:142",
  occurrenceCount: 412,
  affectedUsers: 38,
  affectedTenants: 2,
  firstSeenRelative: "32m ago",
  lastSeenRelative: "8s ago",
  silencedUntil: null,
  stack: "PaymentTimeoutError: provider timeout after 12000ms\n    at chargeCustomer (src/services/payment/charge.ts:84:12)",
  errorTimestamp: "2026-06-01T12:00:03.400Z",
  replay: null,
  sourceMapBadge: { resolved: true, frameCount: 3 },
  sourceMapDiagnostic: {
    status: "resolved",
    label: "Source maps resolved",
    detail: "3 stack frames resolved for release v2026.05.14.",
    release: "v2026.05.14",
    frameCount: 3,
    unresolvedFrameCount: 0,
  },
  breadcrumbs: [
    { kind: "navigation", timeRelative: "2m ago", title: "/cart" },
    { kind: "click", timeRelative: "2m ago", title: "button[data-cta='checkout']" },
    { kind: "error", timeRelative: "just now", title: "PaymentTimeoutError" },
  ],
  related: [
    { icon: "waterfall", tone: "neutral", title: "Trace", sub: "trace_b14", target: { kind: "section", section: "traces" } },
    { icon: "activity", tone: "neutral", title: "Session", sub: "sess_b91", target: { kind: "section", section: "investigate" } },
    { icon: "users", tone: "neutral", title: "User", sub: "—" },
    { icon: "cube", tone: "neutral", title: "Tenant", sub: "—" },
  ],
  notes: [
    { initials: "A", authorEmail: "ana@acme.dev", timeRelative: "8 min ago", body: "Provider degradation confirmed" },
    { initials: "M", authorEmail: "marco@acme.dev", timeRelative: "2 min ago", body: "Reduced timeout to 8s" },
  ],
  externalIssues: [],
  codeContext: {
    status: "ready",
    summary: "Start with src/services/payment/charge.ts:84.",
    repository: {
      provider: "github",
      name: "api",
      owner: "acme",
      repo: "commerce",
      url: "https://github.com/acme/commerce"
    },
    release: {
      release: "v2026.05.14",
      commitSha: "abcdef123456",
      commitUrl: "https://github.com/acme/commerce/commit/abcdef123456",
      pullRequestNumber: 74,
      pullRequestUrl: "https://github.com/acme/commerce/pull/74",
      deployedBy: "ci"
    },
    suspectedFiles: [
      {
        path: "src/services/payment/charge.ts",
        functionName: "chargeCustomer",
        line: 84,
        column: 12,
        confidence: "high",
        evidence: ["source-map frame 0"]
      }
    ],
    evidence: [{ type: "source_map", label: "Source maps applied", value: "3 resolved frames", confidence: "high" }],
    suggestedNextSteps: ["Open src/services/payment/charge.ts around line 84."],
    privacy: {
      aiEnabled: false,
      outboundCodeSharing: false,
      reason: "Local deterministic analysis only."
    }
  },
};

const SILENCED_VM: IncidentVM = {
  ...MOCK_VM,
  silencedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h in the future
};

const CRASH_VM: IncidentVM = {
  ...MOCK_VM,
  severity: "fatal",
  severityColor: "var(--sev-critical)",
  title: "RuntimeCrash: worker process exited unexpectedly",
  occurrenceCount: 3,
  affectedUsers: 1,
  affectedTenants: 1,
};

const REPLAY_VM = {
  ...MOCK_VM,
  errorTimestamp: "2026-06-01T12:00:03.400Z",
  replay: {
    id: "row_1",
    replayId: "rpl_checkout",
    route: "/checkout",
    startedAt: "2026-06-01T12:00:00.000Z",
    endedAt: "2026-06-01T12:00:05.000Z",
    durationMs: 5000,
    eventCount: 2,
    masked: true,
    events: [
      { offsetMs: 0, type: "navigation", route: "/checkout", data: {} },
      { offsetMs: 3200, type: "click", selector: '[data-sigmon-id="pay"]', x: 0.5, y: 0.6, data: {} },
    ],
  },
} as IncidentVM;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockCtx(): ScreenCtx & { back: ReturnType<typeof vi.fn>; drill: ReturnType<typeof vi.fn> } {
  return {
    client: {} as ScreenCtx["client"],
    project: { id: "prj_1", name: "Acme Prod", createdAt: "", updatedAt: "", archivedAt: null },
    environment: {
      id: "env_1",
      projectId: "prj_1",
      name: "production",
      createdAt: "",
      updatedAt: "",
      archivedAt: null,
    },
    environments: [],
    onCreateEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    navigate: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
  } as unknown as ScreenCtx & { back: ReturnType<typeof vi.fn>; drill: ReturnType<typeof vi.fn> };
}

function mockUseIncident(
  vm: IncidentVM | null,
  overrides: Partial<ReturnType<typeof useIncidentModule.useIncident>> = {}
) {
  vi.spyOn(useIncidentModule, "useIncident").mockReturnValue({
    data: vm,
    status: vm ? "ready" : "loading",
    reload: vi.fn(),
    resolve: vi.fn().mockResolvedValue(undefined),
    setPriority: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
    reassign: vi.fn().mockResolvedValue(undefined),
    silence: vi.fn().mockResolvedValue(undefined),
    addNote: vi.fn().mockResolvedValue(undefined),
    occurrences: [],
    occurrencesStatus: "ready",
    occurrencesCursor: undefined,
    loadMoreOccurrences: vi.fn().mockResolvedValue(undefined),
    retryOccurrences: vi.fn(),
    users: [
      { id: "usr_1", email: "ana@acme.dev", isAdmin: false },
      { id: "usr_2", email: "marco@acme.dev", isAdmin: false },
    ],
    canReassign: true,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("IncidentScreen", () => {
  it("keeps all incident detail sections in the page scroll flow", () => {
    mockUseIncident(MOCK_VM);

    render(<IncidentScreen ctx={makeMockCtx()} groupId={MOCK_VM.groupId} errorId={undefined} />);

    const details = screen.getByRole("region", { name: "Incident details" });
    const primary = within(details).getByRole("region", { name: "Primary incident details" });
    const supporting = within(details).getByRole("region", { name: "Incident context and triage" });

    expect(details).not.toHaveStyle({ overflow: "hidden" });
    expect(primary).not.toHaveStyle({ overflow: "auto" });
    expect(supporting).not.toHaveStyle({ overflow: "auto" });
  });

  it("shows paginated occurrence history without repeating the primary error", async () => {
    const loadMoreOccurrences = vi.fn().mockResolvedValue(undefined);
    mockUseIncident(MOCK_VM, {
      occurrences: [
        {
          id: "err_secondary",
          projectId: "prj_1",
          environmentId: "env_1",
          tenantId: "tenant_1",
          userId: "user_1",
          sessionId: null,
          traceId: null,
          timestamp: "2026-06-01T11:50:00.000Z",
          receivedAt: "2026-06-01T11:50:01.000Z",
          source: "browser",
          release: "v2026.05.14",
          metadata: {},
          message: "PaymentTimeoutError: provider timeout after 12000ms",
          type: "PaymentTimeoutError",
          severity: "error",
          stack: null,
          status: "open",
          fingerprint: null,
          errorGroupId: MOCK_VM.groupId,
          groupingFingerprint: "fp_1",
          context: {}
        }
      ],
      occurrencesStatus: "ready",
      occurrencesCursor: "page_2",
      loadMoreOccurrences
    });

    render(<IncidentScreen ctx={makeMockCtx()} groupId={MOCK_VM.groupId} errorId={undefined} />);
    expect(screen.getByText("Occurrence history")).toBeInTheDocument();
    expect(screen.getByText("err_secondary")).toBeInTheDocument();
    expect(screen.queryByText("err_primary")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more occurrences" }));
    await waitFor(() => expect(loadMoreOccurrences).toHaveBeenCalled());
  });

  describe("loading state", () => {
    it("shows loading hint while data is loading", () => {
      mockUseIncident(null, { status: "loading" });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("offers a local retry when initial occurrence history loading fails", () => {
      const retryOccurrences = vi.fn();
      mockUseIncident(MOCK_VM, {
        status: "ready",
        occurrences: [],
        occurrencesStatus: "error",
        retryOccurrences,
      });

      render(<IncidentScreen ctx={makeMockCtx()} groupId={MOCK_VM.groupId} errorId={undefined} />);

      fireEvent.click(screen.getByRole("button", { name: "Retry occurrence history" }));
      expect(retryOccurrences).toHaveBeenCalledOnce();
    });

    it("shows 'Couldn't load this incident' on error", () => {
      mockUseIncident(null, { status: "error", data: null });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/couldn't load this incident/i)).toBeInTheDocument();
    });

    it("shows retry button on error", () => {
      const reload = vi.fn();
      mockUseIncident(null, { status: "error", data: null, reload });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
  });

  describe("header", () => {
    it("renders INC number in meta line", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/INC-4821/)).toBeInTheDocument();
    });

    it("renders assignee email in meta line", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getAllByText(/ana@acme\.dev/).length).toBeGreaterThanOrEqual(1);
    });

    it("renders 'unassigned' when no assignee", () => {
      mockUseIncident({ ...MOCK_VM, assigneeEmail: null });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/unassigned/i)).toBeInTheDocument();
    });

    it("renders mono title (h1)", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("heading", { level: 1, name: /PaymentTimeoutError/i })).toBeInTheDocument();
    });

    it("renders StatusPill for the incident status", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText("Investigating")).toBeInTheDocument();
    });

    it("renders severity tag", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/critical/i)).toBeInTheDocument();
    });

    it("renders crash impact banner for fatal incidents", () => {
      mockUseIncident(CRASH_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("region", { name: /crash reporting/i })).toBeInTheDocument();
      expect(screen.getByText(/fatal runtime crash detected/i)).toBeInTheDocument();
      expect(screen.getByText(/prioritize this before lower-severity error groups/i)).toBeInTheDocument();
    });

    it("does not render crash impact banner for non-fatal incidents", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.queryByRole("region", { name: /crash reporting/i })).not.toBeInTheDocument();
    });

    it("warning incident severity tag has 'warn' class, not 'critical'", () => {
      mockUseIncident({ ...MOCK_VM, severity: "warning", severityColor: "var(--sev-warning)", priority: null });
      const { container } = render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const allTags = Array.from(container.querySelectorAll(".sh-tag"));
      const sevTag = allTags.find((el) => el.textContent?.includes("warning"));
      expect(sevTag).toBeTruthy();
      expect(sevTag!.classList.contains("warn")).toBe(true);
      expect(sevTag!.classList.contains("critical")).toBe(false);
    });

    it("error incident severity tag has 'error' class, not 'critical'", () => {
      mockUseIncident({ ...MOCK_VM, severity: "error", severityColor: "var(--sev-error)", priority: null });
      const { container } = render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const allTags = Array.from(container.querySelectorAll(".sh-tag"));
      const sevTag = allTags.find((el) => el.textContent?.includes("error"));
      expect(sevTag).toBeTruthy();
      expect(sevTag!.classList.contains("error")).toBe(true);
      expect(sevTag!.classList.contains("critical")).toBe(false);
    });

    it("renders group ID tag", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText("err_grp_8a2f91d0")).toBeInTheDocument();
    });

    it("renders release tag", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getAllByText(/v2026\.05\.14/).length).toBeGreaterThanOrEqual(1);
    });

    it("renders a back affordance", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
    });

    it("back button calls ctx.back", async () => {
      mockUseIncident(MOCK_VM);
      const ctx = makeMockCtx();
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /back/i }));
      expect(ctx.back).toHaveBeenCalled();
    });
  });

  describe("action bar — Resolve", () => {
    it("renders Resolve button (two-step ConfirmButton)", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("button", { name: /resolve/i })).toBeInTheDocument();
    });

    it("shows confirm label after first click (two-step)", async () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const resolveBtn = screen.getByRole("button", { name: /^resolve$/i });
      await userEvent.click(resolveBtn);
      expect(screen.getByRole("button", { name: /confirm resolution/i })).toBeInTheDocument();
    });

    it("calls resolve on second confirm click", async () => {
      const resolve = vi.fn().mockResolvedValue(undefined);
      mockUseIncident(MOCK_VM, { resolve });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const resolveBtn = screen.getByRole("button", { name: /^resolve$/i });
      await userEvent.click(resolveBtn);
      const confirmBtn = screen.getByRole("button", { name: /confirm resolution/i });
      await userEvent.click(confirmBtn);
      expect(resolve).toHaveBeenCalled();
    });

    it("pushes a toast and does not throw when resolve rejects", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const resolve = vi.fn().mockRejectedValue(new Error("network error"));
      const ctx = makeMockCtx();
      mockUseIncident(MOCK_VM, { resolve });
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /^resolve$/i }));
      await userEvent.click(screen.getByRole("button", { name: /confirm resolution/i }));
      await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Could not resolve incident"));
    });
  });

  describe("action bar — Silence", () => {
    it("renders Silence button when not silenced", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("button", { name: /^silence$/i })).toBeInTheDocument();
    });

    it("does not show the duration menu until Silence is clicked", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.queryByRole("button", { name: /^30 minutes$/i })).not.toBeInTheDocument();
    });

    it("opens a duration menu with 30m/1h/4h/24h/custom options when Silence clicked", async () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /^silence$/i }));
      expect(screen.getByRole("button", { name: /^30 minutes$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^1 hour$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^4 hours$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^24 hours$/i })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/custom.*min/i)).toBeInTheDocument();
    });

    it.each([
      ["30 minutes", 30],
      ["1 hour", 60],
      ["4 hours", 240],
      ["24 hours", 1440]
    ] as const)("calls silence(%2i) when %s clicked", async (label, minutes) => {
      const silence = vi.fn().mockResolvedValue(undefined);
      mockUseIncident(MOCK_VM, { silence });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /^silence$/i }));
      await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") }));
      expect(silence).toHaveBeenCalledWith(minutes);
    });

    it("calls silence(custom minutes) when a custom duration is entered and applied", async () => {
      const silence = vi.fn().mockResolvedValue(undefined);
      mockUseIncident(MOCK_VM, { silence });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /^silence$/i }));
      const customInput = screen.getByPlaceholderText(/custom.*min/i);
      await userEvent.type(customInput, "90");
      await userEvent.click(screen.getByRole("button", { name: /^apply$/i }));
      expect(silence).toHaveBeenCalledWith(90);
    });

    it("shows 'Silenced until' text when silencedUntil is in the future", () => {
      mockUseIncident(SILENCED_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/silenced until/i)).toBeInTheDocument();
    });

    it("shows Unsilence button when silenced", () => {
      mockUseIncident(SILENCED_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("button", { name: /unsilence/i })).toBeInTheDocument();
    });

    it("calls silence(null) when Unsilence clicked", async () => {
      const silence = vi.fn().mockResolvedValue(undefined);
      mockUseIncident(SILENCED_VM, { silence });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /unsilence/i }));
      expect(silence).toHaveBeenCalledWith(null);
    });

    it("pushes a toast and does not throw when silence rejects", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const silence = vi.fn().mockRejectedValue(new Error("network error"));
      const ctx = makeMockCtx();
      mockUseIncident(MOCK_VM, { silence });
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /^silence$/i }));
      await userEvent.click(screen.getByRole("button", { name: /^30 minutes$/i }));
      await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Could not update silence"));
    });
  });

  describe("action bar — Create issue", () => {
    it("renders Create issue button", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("button", { name: /create issue/i })).toBeInTheDocument();
    });

    it("Create issue calls pushToast stub (no network)", async () => {
      mockUseIncident(MOCK_VM);
      const ctx = makeMockCtx();
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /create issue/i }));
      expect(ctx.pushToast).toHaveBeenCalled();
    });
  });

  describe("action bar — Link issue", () => {
    it("renders Link issue button", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("button", { name: /link issue/i })).toBeInTheDocument();
    });

    it("opens a modal with title pre-filled", async () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /link issue/i }));
      expect(screen.getByRole("dialog", { name: /link external issue/i })).toBeInTheDocument();
      expect(screen.getByDisplayValue(MOCK_VM.title)).toBeInTheDocument();
    });

    it("validates the issue URL and enables submit only for valid URLs", async () => {
      const linkIncidentExternalIssue = vi.fn().mockResolvedValue(undefined);
      const client = { linkIncidentExternalIssue } as unknown as ScreenCtx["client"];
      const ctx = makeMockCtx();
      ctx.client = client;
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);

      await userEvent.click(screen.getByRole("button", { name: /link issue/i }));
      const dialog = screen.getByRole("dialog", { name: /link external issue/i });
      const urlInput = within(dialog).getByPlaceholderText(/github.com\/org\/repo\/issues\/123/i);
      const submitBtn = within(dialog).getByRole("button", { name: /^link issue$/i });
      expect(submitBtn).toBeDisabled();

      await userEvent.type(urlInput, "not-a-url");
      expect(within(dialog).getByText(/enter a valid github or gitlab issue url/i)).toBeInTheDocument();
      expect(submitBtn).toBeDisabled();

      await userEvent.clear(urlInput);
      await userEvent.type(urlInput, "https://github.com/acme/commerce/issues/123");
      expect(
        within(dialog).getByText((_, node) => node?.textContent === "Detected GitHub issue #123"),
      ).toBeInTheDocument();
      expect(submitBtn).not.toBeDisabled();
    });

    it("calls linkIncidentExternalIssue when a valid issue is submitted", async () => {
      const linkIncidentExternalIssue = vi.fn().mockResolvedValue(undefined);
      const client = { linkIncidentExternalIssue } as unknown as ScreenCtx["client"];
      const ctx = makeMockCtx();
      ctx.client = client;
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);

      await userEvent.click(screen.getByRole("button", { name: /link issue/i }));
      const dialog = screen.getByRole("dialog", { name: /link external issue/i });
      const urlInput = within(dialog).getByPlaceholderText(/github.com\/org\/repo\/issues\/123/i);
      await userEvent.type(urlInput, "https://github.com/acme/commerce/issues/123");
      await userEvent.click(within(dialog).getByRole("button", { name: /^link issue$/i }));
      await waitFor(() =>
        expect(linkIncidentExternalIssue).toHaveBeenCalledWith(
          MOCK_VM.groupId,
          { projectId: ctx.project!.id, environmentId: ctx.environment!.id },
          expect.objectContaining({ provider: "github", externalKey: "123", title: MOCK_VM.title })
        )
      );
    });
  });

  describe("action bar — Copy link", () => {
    it("renders Copy link button", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
    });

    it("Copy link writes to clipboard and calls pushToast", async () => {
      mockUseIncident(MOCK_VM);
      const ctx = makeMockCtx();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /copy link/i }));
      expect(ctx.pushToast).toHaveBeenCalled();
    });
  });

  describe("action bar — Reassign", () => {
    it("renders Reassign button when canReassign is true", () => {
      mockUseIncident(MOCK_VM, { canReassign: true });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("button", { name: /reassign/i })).toBeInTheDocument();
    });

    it("Reassign button is disabled when canReassign is false", () => {
      mockUseIncident(MOCK_VM, { canReassign: false, users: null });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const reassignBtn = screen.getByRole("button", { name: /reassign/i });
      expect(reassignBtn).toBeDisabled();
    });

    it("pushes a toast and does not throw when reassign rejects", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const reassign = vi.fn().mockRejectedValue(new Error("network error"));
      const ctx = makeMockCtx();
      mockUseIncident(MOCK_VM, { reassign });
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /^reassign$/i }));
      await userEvent.click(screen.getByRole("button", { name: /ana@acme\.dev/i }));
      await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Could not reassign incident"));
    });
  });

  describe("action bar — priority / occurrence tags", () => {
    it("renders priority tag", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText("P1")).toBeInTheDocument();
    });

    it("renders occurrence count in tag", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getAllByText(/412/).length).toBeGreaterThanOrEqual(1);
    });

    it("renders 'No priority' when priority is null", () => {
      mockUseIncident({ ...MOCK_VM, priority: null });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/no priority/i)).toBeInTheDocument();
    });

    it("names the priority control's accessible name after the current selection", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("button", { name: "Priority: P1" })).toBeInTheDocument();
    });

    it("names the priority control 'Priority: none' when no priority is set", () => {
      mockUseIncident({ ...MOCK_VM, priority: null });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByRole("button", { name: "Priority: none" })).toBeInTheDocument();
    });

    it("opens a priority menu with P1-P4 and 'No priority' options when the priority control is clicked", async () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /^priority: p1$/i }));
      expect(screen.getByRole("button", { name: /^P1$/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^P2$/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^P3$/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^P4$/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /no priority/i })).toBeInTheDocument();
    });

    it.each(["P1", "P2", "P3", "P4"] as const)(
      "calls setPriority(%s) when %s is chosen from the priority menu",
      async (p) => {
        const setPriority = vi.fn().mockResolvedValue(undefined);
        mockUseIncident(MOCK_VM, { setPriority });
        render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
        await userEvent.click(screen.getByRole("button", { name: /^priority: p1$/i }));
        await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${p}$`) }));
        expect(setPriority).toHaveBeenCalledWith(p);
      }
    );

    it("calls setPriority(null) when 'No priority' is chosen from the priority menu", async () => {
      const setPriority = vi.fn().mockResolvedValue(undefined);
      mockUseIncident(MOCK_VM, { setPriority });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /^priority: p1$/i }));
      await userEvent.click(screen.getByRole("button", { name: /no priority/i }));
      expect(setPriority).toHaveBeenCalledWith(null);
    });

    it("pushes a toast and does not throw when setPriority rejects", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const setPriority = vi.fn().mockRejectedValue(new Error("network error"));
      const ctx = makeMockCtx();
      mockUseIncident(MOCK_VM, { setPriority });
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /^priority(:|$)/i }));
      await userEvent.click(screen.getByRole("button", { name: /^P2$/ }));
      await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Could not update priority"));
    });
  });

  describe("header — editable status", () => {
    it("opens a status menu with open/investigating/resolved/ignored options when the status control is clicked", async () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /^status$/i }));
      expect(screen.getByRole("button", { name: /^open$/i })).toBeInTheDocument();
      expect(screen.getAllByText(/investigating/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole("button", { name: /^resolved$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^ignored$/i })).toBeInTheDocument();
    });

    it.each(["open", "investigating", "resolved", "ignored"] as const)(
      "calls setStatus(%s) when %s is chosen from the status menu",
      async (s) => {
        const setStatus = vi.fn().mockResolvedValue(undefined);
        mockUseIncident(MOCK_VM, { setStatus });
        render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
        await userEvent.click(screen.getByRole("button", { name: /^status$/i }));
        await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${s}$`, "i") }));
        expect(setStatus).toHaveBeenCalledWith(s);
      }
    );

    it("pushes a toast and does not throw when setStatus rejects", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const setStatus = vi.fn().mockRejectedValue(new Error("network error"));
      const ctx = makeMockCtx();
      mockUseIncident(MOCK_VM, { setStatus });
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: /^status$/i }));
      await userEvent.click(screen.getByRole("button", { name: /^resolved$/i }));
      await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Could not update status"));
    });
  });

  describe("occurrences summary", () => {
    it("renders occurrence summary text with counts", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getAllByText(/412 occurrences/i).length).toBeGreaterThanOrEqual(1);
    });

    it("renders first and last seen in occurrence summary card", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const summary = screen.getByRole("region", { name: /occurrence summary/i });
      expect(within(summary).getByText(/412 occurrences/i)).toBeInTheDocument();
      expect(within(summary).getByText(/first 32m ago/i)).toBeInTheDocument();
      expect(within(summary).getByText(/last 8s ago/i)).toBeInTheDocument();
    });
  });

  describe("stack trace card", () => {
    it("renders stack trace text in pre element", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const pre = document.querySelector("pre");
      expect(pre).toBeInTheDocument();
      expect(pre?.textContent).toContain("PaymentTimeoutError");
    });

    it("renders 'source maps resolved' badge when resolved", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getAllByText(/source maps resolved/i).length).toBeGreaterThanOrEqual(1);
    });

    it("renders source-map diagnostic detail", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/3 stack frames resolved for release/i)).toBeInTheDocument();
    });

    it("renders actionable unresolved source-map guidance", () => {
      mockUseIncident({
        ...MOCK_VM,
        sourceMapBadge: { resolved: false, frameCount: 0 },
        sourceMapDiagnostic: {
          status: "unresolved",
          label: "Source maps not applied",
          detail: "This error has a stack trace but no release. Configure the SDK release and upload matching maps from CI.",
          release: null,
          frameCount: 0,
          unresolvedFrameCount: 0,
        },
      });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getAllByText(/source maps not applied/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/configure the sdk release/i)).toBeInTheDocument();
    });

    it("shows frame count when source maps resolved", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/3 frames/i)).toBeInTheDocument();
    });

    it("does not show resolved badge when source maps not resolved", () => {
      mockUseIncident({
        ...MOCK_VM,
        sourceMapBadge: { resolved: false, frameCount: 0 },
        sourceMapDiagnostic: {
          status: "unresolved",
          label: "Source maps not applied",
          detail: "No matching source map resolved for release v2026.05.14.",
          release: "v2026.05.14",
          frameCount: 0,
          unresolvedFrameCount: 0,
        },
      });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.queryByText(/source maps resolved/i)).not.toBeInTheDocument();
    });

    it("shows EmptyHint when no stack", () => {
      mockUseIncident({ ...MOCK_VM, stack: null });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getAllByText(/no stack trace/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("session replay context", () => {
    it("shows replay, error moment, stack, and breadcrumbs in the incident workspace", () => {
      mockUseIncident(REPLAY_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);

      const replay = screen.getByRole("region", { name: /session replay/i });
      expect(within(replay).getAllByText(/error moment/i).length).toBeGreaterThanOrEqual(1);
      expect(within(replay).getByText("+3.4 s")).toBeInTheDocument();
      expect(within(replay).getAllByText(/PaymentTimeoutError/).length).toBeGreaterThanOrEqual(1);
      expect(within(replay).getByText("button[data-cta='checkout']")).toBeInTheDocument();
    });
  });

  describe("breadcrumbs accordion", () => {
    it("renders breadcrumb section", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/breadcrumbs/i)).toBeInTheDocument();
    });

    it("renders breadcrumb rows when open", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText("navigation")).toBeInTheDocument();
      expect(screen.getByText("/cart")).toBeInTheDocument();
    });

    it("toggles breadcrumbs open/closed on click", async () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const toggleBtn = screen.getByRole("button", { name: /breadcrumbs/i });
      expect(screen.getByText("/cart")).toBeInTheDocument();
      await userEvent.click(toggleBtn);
      expect(screen.queryByText("/cart")).not.toBeInTheDocument();
      await userEvent.click(toggleBtn);
      expect(screen.getByText("/cart")).toBeInTheDocument();
    });

    it("shows EmptyHint when no breadcrumbs", () => {
      mockUseIncident({ ...MOCK_VM, breadcrumbs: [] });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getAllByText(/no breadcrumbs/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("impact grid", () => {
    it("renders Users affected count", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/users affected/i)).toBeInTheDocument();
      expect(screen.getByText("38")).toBeInTheDocument();
    });

    it("renders Tenants count", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getAllByText(/tenants/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
    });

    it("renders First seen", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/first seen/i)).toBeInTheDocument();
      expect(screen.getByText("32m ago")).toBeInTheDocument();
    });

    it("renders Last seen", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/last seen/i)).toBeInTheDocument();
      expect(screen.getByText("8s ago")).toBeInTheDocument();
    });
  });

  describe("related signals", () => {
    it("renders related rows with targets (Trace, Session)", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText("Trace")).toBeInTheDocument();
      expect(screen.getByText("Session")).toBeInTheDocument();
    });

    it("does not render rows without data (sub === '—' and no target)", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.queryByRole("button", { name: "User" })).not.toBeInTheDocument();
    });

    it("clicking a section-target related row calls ctx.navigate", async () => {
      mockUseIncident(MOCK_VM);
      const ctx = makeMockCtx();
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: "Trace" }));
      expect(ctx.navigate).toHaveBeenCalledWith("traces");
    });

    it("clicking a drill-target related row calls ctx.drill", async () => {
      const drillVM: IncidentVM = {
        ...MOCK_VM,
        related: [
          { icon: "error", tone: "critical", title: "StripeAPIError", sub: "rate ↑ 4.2x", target: { kind: "drill", groupId: "err_grp_4c1d" } },
        ],
      };
      mockUseIncident(drillVM);
      const ctx = makeMockCtx();
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      await userEvent.click(screen.getByRole("button", { name: "StripeAPIError" }));
      expect(ctx.drill).toHaveBeenCalledWith("incident", { groupId: "err_grp_4c1d" });
    });
  });

  describe("external issues", () => {
    it("renders empty state when no issues linked", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/no github or gitlab issue linked yet/i)).toBeInTheDocument();
    });

    it("renders linked issues", () => {
      mockUseIncident({
        ...MOCK_VM,
        externalIssues: [
          { id: "iss_1", provider: "github", externalKey: "123", title: "Fix timeout", url: "https://github.com/acme/commerce/issues/123", state: "open" },
        ] as IncidentVM["externalIssues"],
      });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText("Fix timeout")).toBeInTheDocument();
      expect(screen.getByText(/github · #123/i)).toBeInTheDocument();
    });
  });

  describe("triage notes", () => {
    it("renders existing notes", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/Provider degradation confirmed/)).toBeInTheDocument();
      expect(screen.getByText(/Reduced timeout to 8s/)).toBeInTheDocument();
    });

    it("renders note author initials", () => {
      mockUseIncident(MOCK_VM);
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText("A")).toBeInTheDocument();
      expect(screen.getByText("M")).toBeInTheDocument();
    });

    it("shows EmptyHint when no notes", () => {
      mockUseIncident({ ...MOCK_VM, notes: [] });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      expect(screen.getByText(/no triage notes yet/i)).toBeInTheDocument();
    });

    it("submits a new note when form submitted", async () => {
      const addNote = vi.fn().mockResolvedValue(undefined);
      mockUseIncident(MOCK_VM, { addNote });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const input = screen.getByPlaceholderText(/add a note/i);
      await userEvent.type(input, "New triage observation");
      await userEvent.click(screen.getByRole("button", { name: /submit note/i }));
      expect(addNote).toHaveBeenCalledWith("New triage observation");
    });

    it("clears input after note submitted", async () => {
      const addNote = vi.fn().mockResolvedValue(undefined);
      mockUseIncident(MOCK_VM, { addNote });
      render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const input = screen.getByPlaceholderText(/add a note/i) as HTMLInputElement;
      await userEvent.type(input, "hello");
      await userEvent.click(screen.getByRole("button", { name: /submit note/i }));
      await waitFor(() => {
        expect(input.value).toBe("");
      });
    });

    it("pushes a toast and does not throw when addNote rejects", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const addNote = vi.fn().mockRejectedValue(new Error("network error"));
      const ctx = makeMockCtx();
      mockUseIncident(MOCK_VM, { addNote });
      render(<IncidentScreen ctx={ctx} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const input = screen.getByPlaceholderText(/add a note/i);
      await userEvent.type(input, "New triage observation");
      await userEvent.click(screen.getByRole("button", { name: /submit note/i }));
      await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Could not add note"));
    });
  });

  describe("English copy / no legacy branding", () => {
    it("renders no Portuguese text in visible labels", () => {
      mockUseIncident(MOCK_VM);
      const { container } = render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/notas da triagem/i);
      expect(text).not.toMatch(/sinais relacionados/i);
      expect(text).not.toMatch(/silenciar/i);
      expect(screen.getByRole("heading", { name: /triage notes/i })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /related signals/i })).toBeInTheDocument();
    });

    it("does not render legacy brand string", () => {
      mockUseIncident(MOCK_VM);
      const { container } = render(<IncidentScreen ctx={makeMockCtx()} groupId="err_grp_8a2f91d0" errorId={undefined} />);
      const text = container.textContent ?? "";
      const needle = "Signal" + "Hub";
      expect(text).not.toContain(needle);
    });
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IncidentsVM } from "./useIncidents";
import * as useIncidentsModule from "./useIncidents";
import { IncidentsScreen } from "./IncidentsScreen";
import type { ScreenCtx } from "./registry";

// ---------------------------------------------------------------------------
// Canned VM
// ---------------------------------------------------------------------------

const INCIDENTS_VM: IncidentsVM = {
  kpis: { active: 2, p1: 2, mttrLabel: "42 min", resolved7d: 18 },
  rows: [
    {
      id: "err_grp_8a2f",
      message: "PaymentTimeoutError: provider timeout after 12000ms",
      severity: "critical",
      status: "investigating",
      priority: "P1",
      incidentNumber: "INC-4821",
      openedRelative: "18 min ago",
      assignee: { kind: "initials", initials: "AM" },
      occurrenceCount: 412,
      affectedUsersCount: 38,
      affectedTenantsCount: 2,
      trend: [0, 2, 6, 9, 12, 18, 24, 35, 52, 74, 96, 84],
    },
    {
      id: "err_grp_4c1d",
      message: "StripeAPIError: rate_limited",
      severity: "warning",
      status: "open",
      priority: "P2",
      incidentNumber: null,
      openedRelative: "31 min ago",
      assignee: null,
      occurrenceCount: 184,
      affectedUsersCount: 22,
      affectedTenantsCount: 1,
      trend: [0, 1, 1, 2, 5, 8, 13, 21, 18, 10, 6, 2],
    },
    {
      id: "err_grp_2a8c",
      message: "Worker job dlq_telemetry timed out (max_attempts reached)",
      severity: "error",
      status: "open",
      priority: "P3",
      incidentNumber: "INC-4819",
      openedRelative: "2 h ago",
      assignee: { kind: "generic" },
      occurrenceCount: 28,
      affectedUsersCount: 4,
      affectedTenantsCount: 1,
      trend: [0, 0, 0, 1, 2, 2, 4, 6, 5, 4, 3, 1],
    },
  ],
};

const EMPTY_VM: IncidentsVM = {
  kpis: { active: 0, p1: 0, mttrLabel: "—", resolved7d: 0 },
  rows: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockCtx(): ScreenCtx {
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
    pendingFilters: null,
    clearPendingFilters: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
  };
}

function mockUseIncidents(vm: IncidentsVM | null, status: "loading" | "ok" | "error" = "ok") {
  return vi.spyOn(useIncidentsModule, "useIncidents").mockReturnValue({
    data: vm,
    status,
    reload: vi.fn(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("IncidentsScreen", () => {
  describe("no project guard", () => {
    it("shows a guard hint when project is undefined", () => {
      mockUseIncidents(null, "loading");
      const ctx = { ...makeMockCtx(), project: undefined };
      render(<IncidentsScreen ctx={ctx} />);
      expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
    });

    it("shows a guard hint when environment is undefined", () => {
      mockUseIncidents(null, "loading");
      const ctx = { ...makeMockCtx(), environment: undefined };
      render(<IncidentsScreen ctx={ctx} />);
      expect(screen.getByText(/no project selected/i)).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("shows loading hint while data is loading", () => {
      mockUseIncidents(null, "loading");
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("shows error hint on error", () => {
      mockUseIncidents(null, "error");
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getByText(/could not load incidents/i)).toBeInTheDocument();
    });
  });

  describe("page head", () => {
    it("renders title, English subtitle with active count, and History/Filters actions", () => {
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getByRole("heading", { name: "Incidents" })).toBeInTheDocument();
      expect(screen.getByText(/Priority triage for/i)).toBeInTheDocument();
      expect(screen.getByText(/Acme Prod · production/)).toBeInTheDocument();
      expect(screen.getByText(/2 active\./)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /history/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /filters/i })).toBeInTheDocument();
    });
  });

  describe("KPI tiles", () => {
    it("renders 4 KPI tiles with VM values", () => {
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getByText("Active")).toBeInTheDocument();
      expect(screen.getByText("P1 critical")).toBeInTheDocument();
      expect(screen.getByText("MTTR (7d)")).toBeInTheDocument();
      expect(screen.getByText("Resolved (7d)")).toBeInTheDocument();
      // values
      expect(screen.getByText("42 min")).toBeInTheDocument();
      expect(screen.getByText("18")).toBeInTheDocument();
    });
  });

  describe("card section", () => {
    it("renders the section header with the sorted-by-priority tag", () => {
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getByText("Active incidents")).toBeInTheDocument();
      expect(screen.getByText("sorted by priority")).toBeInTheDocument();
    });

    it("renders one card per row", () => {
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      const cards = screen.getAllByRole("button", { name: /opened .* ago/i });
      expect(cards).toHaveLength(3);
    });
  });

  describe("row content", () => {
    it("renders the severity tag (uppercased) with stripe tone class", () => {
      mockUseIncidents(INCIDENTS_VM);
      const { container } = render(<IncidentsScreen ctx={makeMockCtx()} />);
      // severity tag text uppercased via CSS textTransform; raw text is the VM value
      const sevTag = screen.getAllByText("critical").find((el) =>
        el.classList.contains("sh-tag"),
      );
      expect(sevTag).toBeTruthy();
      // stripe class on the row
      const stripeRow = container.querySelector(".sh-row.sh-stripe.critical");
      expect(stripeRow).toBeTruthy();
    });

    it("renders PriorityPill and StatusPill", () => {
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getByText("P1")).toBeInTheDocument();
      expect(screen.getByText("Investigating")).toBeInTheDocument();
      // Two rows are "open" → StatusPill renders "Open" twice.
      const openPills = screen
        .getAllByText("Open")
        .filter((el) => el.classList.contains("sh-tag"));
      expect(openPills.length).toBe(2);
    });

    it("renders INC# tag when incidentNumber set", () => {
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getByText("INC-4821")).toBeInTheDocument();
      expect(screen.getByText("INC-4819")).toBeInTheDocument();
    });

    it("omits INC# tag when incidentNumber is null", () => {
      mockUseIncidents({
        kpis: INCIDENTS_VM.kpis,
        rows: [{ ...INCIDENTS_VM.rows[1] }],
      });
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.queryByText(/^INC-/)).not.toBeInTheDocument();
    });

    it("renders the opened-relative label", () => {
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getByText("opened 18 min ago")).toBeInTheDocument();
      expect(screen.getByText("opened 31 min ago")).toBeInTheDocument();
    });

    it("does not duplicate the 'ago' suffix — openedRelative already comes from relativeTime()", () => {
      // Regression: useIncidents.openedRelative is built from the shared
      // relativeTime() formatter, which already appends " ago". The row used
      // to append a second literal " ago", rendering "opened 2 h ago ago".
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.queryByText(/ago ago/i)).not.toBeInTheDocument();
      expect(screen.getByText("opened 2 h ago")).toBeInTheDocument();
    });

    it("renders an avatar with initials for {kind:initials}", () => {
      mockUseIncidents(INCIDENTS_VM);
      const { container } = render(<IncidentsScreen ctx={makeMockCtx()} />);
      const avatar = screen.getByText("AM");
      expect(avatar).toHaveClass("tb-avatar");
      expect(container.querySelectorAll(".tb-avatar").length).toBeGreaterThanOrEqual(2);
    });

    it("renders a generic avatar (no initials text) for {kind:generic}", () => {
      mockUseIncidents({
        kpis: INCIDENTS_VM.kpis,
        rows: [{ ...INCIDENTS_VM.rows[2] }],
      });
      const { container } = render(<IncidentsScreen ctx={makeMockCtx()} />);
      const avatar = container.querySelector(".tb-avatar");
      expect(avatar).toBeTruthy();
      // generic avatar contains an svg icon, not initials text
      expect(avatar?.querySelector("svg")).toBeTruthy();
      expect(avatar?.textContent?.trim()).toBe("");
    });

    it("renders the 'unassigned' tag when assignee is null", () => {
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getByText("unassigned")).toBeInTheDocument();
    });

    it("renders the message in a mono element", () => {
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      const msg = screen.getByText("PaymentTimeoutError: provider timeout after 12000ms");
      expect(msg).toHaveClass("sh-mono");
    });

    it("renders occurrences/users/tenants counts with English labels", () => {
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getAllByText("occurrences").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("users").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("tenants").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("412")).toBeInTheDocument();
      expect(screen.getByText("38")).toBeInTheDocument();
    });

    it("renders an 'Open →' affordance per row (distinct from the status pill)", () => {
      mockUseIncidents(INCIDENTS_VM);
      const { container } = render(<IncidentsScreen ctx={makeMockCtx()} />);
      const affordances = container.querySelectorAll("span.sh-btn.ghost");
      expect(affordances.length).toBe(INCIDENTS_VM.rows.length);
      affordances.forEach((el) => expect(el.textContent).toContain("Open"));
    });
  });

  describe("trend sparkline", () => {
    it("renders a compact 12-bucket trend inside each incident row", () => {
      mockUseIncidents(INCIDENTS_VM);
      const { container } = render(<IncidentsScreen ctx={makeMockCtx()} />);
      const rows = container.querySelectorAll(".sh-row.sh-stripe");
      rows.forEach((r) => {
        expect(r.querySelector('[data-testid="incident-trend-sparkline"]')).not.toBeNull();
      });
      expect(screen.getAllByTestId("incident-trend-sparkline")).toHaveLength(INCIDENTS_VM.rows.length);
    });
  });

  describe("interactions", () => {
    it("drills into the incident on card click", async () => {
      mockUseIncidents(INCIDENTS_VM);
      const ctx = makeMockCtx();
      render(<IncidentsScreen ctx={ctx} />);
      const cards = screen.getAllByRole("button", { name: /opened .* ago/i });
      await userEvent.click(cards[0]);
      expect(ctx.drill).toHaveBeenCalledWith("incident", { groupId: "err_grp_8a2f" });
    });

    it("toggles between active incidents and history", async () => {
      const spy = mockUseIncidents(INCIDENTS_VM);
      const ctx = makeMockCtx();
      render(<IncidentsScreen ctx={ctx} />);
      await userEvent.click(screen.getByRole("button", { name: /history/i }));
      expect(ctx.pushToast).not.toHaveBeenCalled();
      expect(spy).toHaveBeenLastCalledWith(
        expect.objectContaining({ view: "history", statusFilter: "all" })
      );
      expect(screen.getByRole("button", { name: /active/i })).toBeInTheDocument();
    });

    it("opens real filters and passes priority/status/assignee to the hook", async () => {
      const spy = mockUseIncidents(INCIDENTS_VM);
      const ctx = makeMockCtx();
      render(<IncidentsScreen ctx={ctx} />);
      await userEvent.click(screen.getByRole("button", { name: /filters/i }));
      expect(ctx.pushToast).not.toHaveBeenCalled();
      expect(screen.getByText("Incident filters")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "P1" }));
      await userEvent.click(screen.getByRole("button", { name: "investigating" }));
      await userEvent.click(screen.getByRole("button", { name: "assigned" }));

      expect(spy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          priorityFilter: "P1",
          statusFilter: "investigating",
          assigneeFilter: "assigned"
        })
      );
    });
  });

  describe("empty state", () => {
    it("shows EmptyHint and no cards when rows are empty", () => {
      mockUseIncidents(EMPTY_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getByText(/no active incidents/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /opened .* ago/i })).not.toBeInTheDocument();
    });
  });

  describe("English-only copy", () => {
    it("renders English strings and no pt-BR", () => {
      mockUseIncidents(INCIDENTS_VM);
      render(<IncidentsScreen ctx={makeMockCtx()} />);
      expect(screen.getByText("Active incidents")).toBeInTheDocument();
      expect(screen.getByText("sorted by priority")).toBeInTheDocument();
      expect(screen.getByText(/Priority triage for/)).toBeInTheDocument();
      // pt-BR absent
      expect(screen.queryByText(/Histórico/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Filtros/)).not.toBeInTheDocument();
      expect(screen.queryByText(/ocorrências/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Incidentes ativos/)).not.toBeInTheDocument();
    });
  });
});

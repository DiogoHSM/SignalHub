import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthRail } from "./HealthRail";
import type { FleetProject, FleetRollup } from "../../api/client";

const makeProject = (id: string, name: string, overrides: Partial<FleetProject> = {}): FleetProject => ({
  id,
  name,
  status: "ok",
  incidents: 0,
  alerts: 0,
  errorRatePercent: 1.2,
  errorRateDelta: null,
  errorTrend: [0, 1, 2, 1, 0, 0, 1, 3, 2, 1, 0, 1],
  events: 500,
  activeUsers: 5,
  activeTenants: 2,
  llmCostUsd: "10.00",
  llmCostDeltaUsd: null,
  p95TraceDurationMs: 200,
  p95DeltaMs: null,
  infra: { api: "ok", db: "ok", redis: "ok", queue: "ok" },
  topIncident: null,
  ...overrides
});

const rollup: FleetRollup = {
  counts: { ok: 2, warning: 0, critical: 0 },
  incidents: 0,
  alerts: 0,
  llmCostUsd: "20.00",
  overall: "ok",
  total: 2
};

const criticalRollup: FleetRollup = {
  counts: { ok: 0, warning: 0, critical: 2 },
  incidents: 3,
  alerts: 1,
  llmCostUsd: "5.00",
  overall: "critical",
  total: 2
};

const projects = [makeProject("prj_1", "Alpha"), makeProject("prj_2", "Beta")];

const defaultFleet = { projects, rollup, lastUpdated: 10 };

afterEach(() => {
  cleanup();
});

describe("HealthRail", () => {
  it("renders the rollup card with project count and overall status", () => {
    render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId="prj_1"
        onSelectProject={() => {}}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        fleet={defaultFleet}
      />
    );

    const rollupEl = document.querySelector(".hr-rollup");
    expect(rollupEl).toBeInTheDocument();
    expect(rollupEl?.getAttribute("data-status")).toBe("ok");
  });

  it("renders a ProjectCard for each project", () => {
    render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId="prj_1"
        onSelectProject={() => {}}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        fleet={defaultFleet}
      />
    );

    const cards = document.querySelectorAll(".hr-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("marks the selected project card with is-selected", () => {
    render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId="prj_1"
        onSelectProject={() => {}}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        fleet={defaultFleet}
      />
    );

    const cards = document.querySelectorAll(".hr-card");
    const selected = Array.from(cards).find(c => c.classList.contains("is-selected"));
    expect(selected).toBeInTheDocument();
  });

  it("expand button toggles aria-expanded and calls onToggleExpand", async () => {
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();

    render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId="prj_1"
        onSelectProject={() => {}}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={onToggleExpand}
        fleet={defaultFleet}
      />
    );

    const expandButtons = document.querySelectorAll(".hr-expand");
    expect(expandButtons.length).toBeGreaterThan(0);

    const firstExpand = expandButtons[0] as HTMLElement;
    expect(firstExpand.getAttribute("aria-expanded")).toBe("false");
    expect(firstExpand).toHaveClass("sh-hit-target");

    await user.click(firstExpand);
    expect(onToggleExpand).toHaveBeenCalledWith("prj_1");
  });

  it("keeps keyboard activation of expand from selecting the project", async () => {
    const onSelectProject = vi.fn();
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();
    render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId={undefined}
        onSelectProject={onSelectProject}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={onToggleExpand}
        fleet={defaultFleet}
      />
    );

    const expand = screen.getAllByRole("button", { name: "Expand environments" })[0];
    expand.focus();
    await user.keyboard("{Enter}");
    expect(onToggleExpand).toHaveBeenCalledWith("prj_1");
    expect(onSelectProject).not.toHaveBeenCalled();
  });

  it("expanded card shows aria-expanded=true on the expand button", () => {
    render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId="prj_1"
        onSelectProject={() => {}}
        onOpenEnv={() => {}}
        expandedIds={new Set(["prj_1"])}
        onToggleExpand={() => {}}
        fleet={defaultFleet}
      />
    );

    const expandButtons = document.querySelectorAll(".hr-expand");
    const firstButton = expandButtons[0] as HTMLElement;
    expect(firstButton.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders lazy-loaded environment health inside an expanded project", () => {
    render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId="prj_1"
        onSelectProject={() => {}}
        onOpenEnv={() => {}}
        expandedIds={new Set(["prj_1"])}
        onToggleExpand={() => {}}
        fleet={{
          ...defaultFleet,
          environments: {
            prj_1: {
              status: "ready",
              data: [{ name: "production", status: "warning", incidents: 2, errorRatePercent: 3.4, events: 88, note: null }]
            }
          }
        }}
      />
    );

    expect(screen.getByRole("button", { name: /production.*warning/i })).toBeInTheDocument();
    expect(screen.getByText("2 incidents")).toBeInTheDocument();
    expect(screen.queryByText("Load environments…")).not.toBeInTheDocument();
  });

  it("renders collapsed mode as aside with hr--collapsed class", () => {
    render(
      <HealthRail
        collapsed={true}
        onToggleCollapse={() => {}}
        selectedProjectId="prj_1"
        onSelectProject={() => {}}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        fleet={defaultFleet}
      />
    );

    const aside = document.querySelector(".hr.hr--collapsed");
    expect(aside).toBeInTheDocument();
    // Full cards not rendered in collapsed mode
    expect(document.querySelector(".hr-card")).not.toBeInTheDocument();
  });

  it("collapsed mode renders one status dot per project", () => {
    render(
      <HealthRail
        collapsed={true}
        onToggleCollapse={() => {}}
        selectedProjectId="prj_1"
        onSelectProject={() => {}}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        fleet={defaultFleet}
      />
    );

    const items = document.querySelectorAll(".hr-collapsed-item");
    expect(items).toHaveLength(2);
    expect(Array.from(items).every((item) => item.classList.contains("sh-hit-target"))).toBe(true);
    expect(document.querySelector(".hr-collapsebtn")).toHaveClass("sh-hit-target");
  });

  it("renders infra dots (api, db, redis, queue) inside each project card", () => {
    const project = makeProject("prj_1", "Alpha", {
      infra: { api: "ok", db: "warning", redis: "ok", queue: "critical" }
    });

    render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId="prj_1"
        onSelectProject={() => {}}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        fleet={{ projects: [project], rollup, lastUpdated: 0 }}
      />
    );

    // Each infra key renders a span with a title containing its name or label
    const infraSpans = document.querySelectorAll(".hr-card [title]");
    // Filter to infra-related titles (api/API, db/DB, redis/Redis, queue/Queue)
    const infraTitles = Array.from(infraSpans).filter(el => {
      const t = el.getAttribute("title")?.toLowerCase() ?? "";
      return t.includes("api") || t.includes("db") || t.includes("redis") || t.includes("queue");
    });
    expect(infraTitles.length).toBeGreaterThanOrEqual(4);
  });

  it("calls onSelectProject when a card main area is clicked", async () => {
    const onSelectProject = vi.fn();
    const user = userEvent.setup();

    render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId={undefined}
        onSelectProject={onSelectProject}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        fleet={defaultFleet}
      />
    );

    const cardMains = document.querySelectorAll(".hr-card__main");
    await user.click(cardMains[0] as HTMLElement);
    expect(onSelectProject).toHaveBeenCalledWith("prj_1");
  });

  it.each(["{Enter}", " "])("selects a project card with %s", async (key) => {
    const onSelectProject = vi.fn();
    const user = userEvent.setup();
    render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId={undefined}
        onSelectProject={onSelectProject}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        fleet={defaultFleet}
      />
    );

    const project = screen.getByRole("button", { name: /Alpha/ });
    expect(project).toHaveAttribute("tabindex", "0");
    project.focus();
    await user.keyboard(key);
    expect(onSelectProject).toHaveBeenCalledWith("prj_1");
  });

  it("renders critical rollup state correctly", () => {
    const critProjects = [
      makeProject("prj_1", "Alpha", { status: "critical", incidents: 2 }),
      makeProject("prj_2", "Beta", { status: "critical", incidents: 1 })
    ];

    render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId={undefined}
        onSelectProject={() => {}}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        fleet={{ projects: critProjects, rollup: criticalRollup, lastUpdated: 5 }}
      />
    );

    const rollupEl = document.querySelector(".hr-rollup");
    expect(rollupEl?.getAttribute("data-status")).toBe("critical");
  });

  it("does not render the legacy brand name anywhere in the output", () => {
    const { container } = render(
      <HealthRail
        collapsed={false}
        onToggleCollapse={() => {}}
        selectedProjectId="prj_1"
        onSelectProject={() => {}}
        onOpenEnv={() => {}}
        expandedIds={new Set()}
        onToggleExpand={() => {}}
        fleet={defaultFleet}
      />
    );

    const legacyBrand = "Signal" + "Hub";
    expect(container.innerHTML).not.toContain(legacyBrand);
  });
});

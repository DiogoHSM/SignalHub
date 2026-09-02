import { Icon } from "../../components/ui/v2/icon";
import { MicroSpark } from "../../components/ui/v2/charts";
import { StatusDot } from "../../components/ui/v2/status-dot";
import { sev } from "../../components/ui/v2/status";
import type { FleetProject, FleetRollup } from "../../api/client";
import type { FleetEnvironmentState } from "../useFleet";

// ─── Infra helpers ───────────────────────────────────────────────────────────

const INFRA_LABELS: Record<string, string> = {
  api: "API",
  db: "DB",
  redis: "Redis",
  queue: "Queue"
};

const INFRA_ICONS: Record<string, Parameters<typeof Icon>[0]["name"]> = {
  api: "server",
  db: "db",
  redis: "redis",
  queue: "queue"
};

// ─── FleetBar ────────────────────────────────────────────────────────────────

type FleetBarProps = {
  counts: FleetRollup["counts"];
  total: number;
};

export function FleetBar({ counts, total }: FleetBarProps) {
  const segs = (
    [
      ["critical", counts.critical],
      ["warning", counts.warning],
      ["ok", counts.ok]
    ] as [string, number][]
  ).filter(([, n]) => n > 0);

  if (total === 0) {
    return <div style={{ height: 6, borderRadius: 3, background: "var(--border-subtle)" }} />;
  }

  return (
    <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 2 }}>
      {segs.map(([s, n]) => (
        <div
          key={s}
          style={{ flex: n, background: sev(s).color, opacity: 0.9 }}
          title={`${n} ${sev(s).label}`}
        />
      ))}
    </div>
  );
}

// ─── InfraDots ───────────────────────────────────────────────────────────────

type InfraDotsProps = {
  infra: FleetProject["infra"];
};

export function InfraDots({ infra }: InfraDotsProps) {
  const keys = ["api", "db", "redis", "queue"] as const;
  return (
    <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
      {keys.map((k) => (
        <span
          key={k}
          title={`${INFRA_LABELS[k]} · ${sev(infra[k]).label}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--fg-faint)" }}
        >
          <Icon name={INFRA_ICONS[k]} size={11} />
          <StatusDot status={infra[k]} size={5} />
        </span>
      ))}
    </div>
  );
}

// ─── ProjectCard ─────────────────────────────────────────────────────────────

type ProjectCardProps = {
  p: FleetProject;
  selected: boolean;
  expanded: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onOpenEnv: (projectId: string, envName: string) => void;
  environments?: FleetEnvironmentState;
};

export function ProjectCard({ p, selected, expanded, onSelect, onToggle, onOpenEnv, environments }: ProjectCardProps) {
  const s = sev(p.status);
  const errorRateDisplay =
    p.errorRatePercent !== null ? `${p.errorRatePercent.toFixed(1)}%` : "—";

  return (
    <div className={`hr-card status-card ${selected ? "is-selected" : ""}`} data-status={p.status}>
      <div
        className="hr-card__main sh-hit-target"
        role="button"
        tabIndex={0}
        onClick={() => onSelect(p.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(p.id);
          }
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <StatusDot status={p.status} size={9} pulse={p.status === "critical"} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <strong
                style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {p.name}
              </strong>
              {selected ? <span className="hr-current">current</span> : null}
            </div>
            <div className="hr-mono" style={{ fontSize: 10.5, color: "var(--fg-faint)" }}>
              {p.events} ev/24h
            </div>
          </div>
          <button
            className="hr-expand sh-hit-target"
            type="button"
            aria-label={expanded ? "Collapse environments" : "Expand environments"}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(p.id);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Icon
              name="chevd"
              size={14}
              style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .25s ease" }}
            />
          </button>
        </div>

        <div className="hr-metrics">
          <div className="hr-metric">
            <span className="hr-metric__label">incidents</span>
            <span
              className="hr-metric__val"
              style={{ color: p.incidents > 0 ? "var(--sev-critical)" : "var(--fg-muted)" }}
            >
              {p.incidents}
            </span>
          </div>
          <div className="hr-metric">
            <span className="hr-metric__label">error rate</span>
            <span
              className="hr-metric__val"
              style={{
                color:
                  (p.errorRateDelta ?? 0) > 0.1 ? "var(--sev-warning)" : "var(--fg-secondary)"
              }}
            >
              {errorRateDisplay}
            </span>
          </div>
          <div className="hr-metric hr-metric--spark">
            <span className="hr-metric__label">trend</span>
            <MicroSpark data={p.errorTrend.length > 0 ? p.errorTrend : [0]} color={s.color} width={52} height={16} />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 9
          }}
        >
          <InfraDots infra={p.infra} />
          {p.alerts > 0 ? (
            <span className="hr-alert">
              <Icon name="bell" size={10} />
              {p.alerts}
            </span>
          ) : (
            <span style={{ width: 1 }} />
          )}
        </div>
      </div>

      {/* accordion: environments — lazy loaded on expand */}
      <div className="hr-acc" data-open={expanded}>
        <div className="hr-acc__inner">
          {expanded && environments?.status === "loading" ? (
            <div className="hr-env hr-env--load"><span className="hr-env__name">Loading environments…</span></div>
          ) : null}
          {expanded && environments?.status === "error" ? (
            <div className="hr-env hr-env--load"><span className="hr-env__name">Environment health unavailable</span></div>
          ) : null}
          {expanded && environments?.status === "ready" && environments.data.length === 0 ? (
            <div className="hr-env hr-env--load"><span className="hr-env__name">No environments</span></div>
          ) : null}
          {expanded && environments?.status === "ready" ? environments.data.map((environment) => (
            <button
              className="hr-env sh-hit-target"
              type="button"
              key={environment.name}
              aria-label={`${environment.name} · ${environment.status}`}
              onClick={() => onOpenEnv(p.id, environment.name)}
            >
              <StatusDot status={environment.status} size={6} />
              <span className="hr-env__name">{environment.name}</span>
              <span className="hr-mono" style={{ color: "var(--fg-faint)", marginLeft: "auto" }}>
                {environment.incidents} incidents
              </span>
            </button>
          )) : null}
        </div>
      </div>
    </div>
  );
}

// ─── HealthRail ──────────────────────────────────────────────────────────────

export type HealthRailFleet = {
  projects: FleetProject[];
  rollup: FleetRollup;
  lastUpdated: number;
  environments?: Record<string, FleetEnvironmentState>;
};

export type HealthRailProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
  selectedProjectId: string | undefined;
  onSelectProject: (id: string) => void;
  onOpenEnv: (projectId: string, envName: string) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  fleet: HealthRailFleet;
};

export function HealthRail({
  collapsed,
  onToggleCollapse,
  selectedProjectId,
  onSelectProject,
  onOpenEnv,
  expandedIds,
  onToggleExpand,
  fleet
}: HealthRailProps) {
  const { projects, rollup, lastUpdated } = fleet;

  if (collapsed) {
    return (
      <aside className="hr hr--collapsed">
        <button
          className="hr-collapsebtn sh-hit-target"
          type="button"
          title="Expand project radar"
          onClick={onToggleCollapse}
          aria-label="Expand project radar"
        >
          <Icon name="panelExpand" size={16} />
        </button>
        <div className="hr-collapsed-overall" title={`Fleet: ${sev(rollup.overall).label}`}>
          <StatusDot status={rollup.overall} size={10} pulse={rollup.overall === "critical"} />
        </div>
        <div className="hr-collapsed-list">
          {projects.map((p) => (
            <button
              key={p.id}
              className={`hr-collapsed-item sh-hit-target ${p.id === selectedProjectId ? "is-selected" : ""}`}
              type="button"
              title={`${p.name} · ${sev(p.status).label}${p.incidents ? ` · ${p.incidents} incidents` : ""}`}
              onClick={() => {
                onToggleCollapse();
                onSelectProject(p.id);
              }}
            >
              <StatusDot status={p.status} size={8} pulse={p.status === "critical"} />
            </button>
          ))}
        </div>
        <div className="hr-spacer" />
        {rollup.incidents > 0 ? (
          <div className="hr-collapsed-badge" title={`${rollup.incidents} active fleet incidents`}>
            {rollup.incidents}
          </div>
        ) : null}
      </aside>
    );
  }

  const overallLabel =
    rollup.overall === "critical"
      ? "Attention required"
      : rollup.overall === "warning"
      ? "Some alerts"
      : "All operational";

  return (
    <aside className="hr">
      <div className="hr-head">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="grid" size={15} style={{ color: "var(--fg-muted)" }} />
          <strong style={{ fontSize: 13 }}>All projects</strong>
        </div>
        <button
          className="hr-collapsebtn sh-hit-target"
          type="button"
          title="Collapse radar"
          onClick={onToggleCollapse}
          aria-label="Collapse radar"
        >
          <Icon name="panelRight" size={16} />
        </button>
      </div>

      {/* Fleet rollup */}
      <div className="hr-rollup" data-status={rollup.overall}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 9
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StatusDot status={rollup.overall} size={9} pulse={rollup.overall === "critical"} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: sev(rollup.overall).color }}>
              {overallLabel}
            </span>
          </div>
          <span className="hr-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
            {rollup.total} projects
          </span>
        </div>
        <FleetBar counts={rollup.counts} total={rollup.total} />
        <div className="hr-rollup__legend">
          <span>
            <i style={{ background: "var(--sev-critical)" }} />
            {rollup.counts.critical} critical
          </span>
          <span>
            <i style={{ background: "var(--sev-warning)" }} />
            {rollup.counts.warning} warning
          </span>
          <span>
            <i style={{ background: "var(--accent)" }} />
            {rollup.counts.ok} ok
          </span>
        </div>
        <div className="hr-rollup__stats">
          <div>
            <span className="hr-mono">{rollup.incidents}</span> incidents
          </div>
          <div>
            <span className="hr-mono">{rollup.alerts}</span> alerts 30min
          </div>
          <div>
            <span className="hr-mono">${parseFloat(rollup.llmCostUsd).toFixed(0)}</span> AI today
          </div>
        </div>
      </div>

      <div className="hr-list">
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            p={p}
            selected={p.id === selectedProjectId}
            expanded={expandedIds.has(p.id)}
            onSelect={onSelectProject}
            onToggle={onToggleExpand}
            onOpenEnv={onOpenEnv}
            environments={fleet.environments?.[p.id]}
          />
        ))}
      </div>

      <div className="hr-foot">
        <span className="hr-live">
          <span className="hr-live__dot" />
          live
        </span>
        <span className="hr-mono" style={{ color: "var(--fg-faint)" }}>
          updated {lastUpdated}s ago
        </span>
      </div>
    </aside>
  );
}

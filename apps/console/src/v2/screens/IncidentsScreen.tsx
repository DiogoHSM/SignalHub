import type { ScreenCtx } from "./registry";
import { useIncidents } from "./useIncidents";
import type { IncidentAssignee, IncidentRowVM } from "./useIncidents";
import {
  BigKpi,
  EmptyHint,
  formatCompact,
  Icon,
  PageHead,
  PriorityPill,
  StatusPill,
} from "../../components/ui/v2";

// ---------------------------------------------------------------------------
// Severity → tone/class mapping
//
// Reuses the ErrorsScreen severity color keys (critical/fatal/error/warning) so
// the severity tag matches the Errors list, and maps each severity to the tone
// class used by `.sh-stripe` / `.sh-tag` (critical/warn/info/ok).
// ---------------------------------------------------------------------------

const SEV_COLOR: Record<string, string> = {
  critical: "var(--sev-critical)",
  fatal: "var(--sev-critical)",
  error: "var(--sev-error, var(--sev-warning))",
  warning: "var(--sev-warning)",
};

const SEV_BG: Record<string, string> = {
  critical: "var(--sev-critical-bg)",
  fatal: "var(--sev-critical-bg)",
  error: "var(--sev-error-bg, var(--sev-warning-bg))",
  warning: "var(--sev-warning-bg)",
};

const SEV_CLASS: Record<string, string> = {
  critical: "critical",
  fatal: "critical",
  error: "warn",
  warning: "warn",
};

// ---------------------------------------------------------------------------
// Assignee
// ---------------------------------------------------------------------------

function Assignee({ assignee }: { assignee: IncidentAssignee }) {
  if (assignee == null) {
    return <span className="sh-tag warn">unassigned</span>;
  }
  if (assignee.kind === "initials") {
    return (
      <span className="tb-avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
        {assignee.initials}
      </span>
    );
  }
  // generic
  return (
    <span
      className="tb-avatar"
      style={{ width: 24, height: 24 }}
      aria-label="Assigned"
    >
      <Icon name="user" size={12} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// IncidentRow
// ---------------------------------------------------------------------------

function IncidentRow({ row, ctx }: { row: IncidentRowVM; ctx: ScreenCtx }) {
  const sevColor = SEV_COLOR[row.severity] ?? "var(--fg-muted)";
  const sevBg = SEV_BG[row.severity] ?? "var(--bg-surface-2)";
  const sevClass = SEV_CLASS[row.severity] ?? "info";

  return (
    <button
      className={`sh-row sh-row--btn sh-stripe ${sevClass}`}
      aria-label={`opened ${row.openedRelative} ago`}
      style={{
        gridTemplateColumns: "1fr",
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "16px 18px 16px 22px",
        cursor: "pointer",
      }}
      onClick={() => ctx.drill("incident", { groupId: row.id })}
    >
      {/* meta row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          className="sh-tag"
          style={{
            background: sevBg,
            color: sevColor,
            borderColor: "transparent",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          {row.severity}
        </span>
        {row.priority != null ? <PriorityPill p={row.priority} /> : null}
        <StatusPill status={row.status} />
        {row.incidentNumber != null ? (
          <span className="sh-tag mono">{row.incidentNumber}</span>
        ) : null}
        <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>
          opened {row.openedRelative} ago
        </span>
        <div style={{ flex: 1 }} />
        <Assignee assignee={row.assignee} />
      </div>

      {/* message */}
      <div className="sh-mono" style={{ fontSize: 14, color: "var(--fg)", marginBottom: 8 }}>
        {row.message}
      </div>

      {/* counts + open affordance */}
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <span className="sh-muted" style={{ fontSize: 12 }}>
          <strong style={{ color: "var(--fg)" }}>{formatCompact(row.occurrenceCount)}</strong>{" "}
          occurrences
        </span>
        <span className="sh-muted" style={{ fontSize: 12 }}>
          <strong style={{ color: "var(--fg)" }}>{formatCompact(row.affectedUsersCount)}</strong>{" "}
          users
        </span>
        <span className="sh-muted" style={{ fontSize: 12 }}>
          <strong style={{ color: "var(--fg)" }}>{formatCompact(row.affectedTenantsCount)}</strong>{" "}
          tenants
        </span>
        {/* The design renders a trend Sparkline here; the VM has no trend series,
            so the spacer flexes to fill the gap instead. */}
        <div style={{ flex: 1 }} />
        <span className="sh-btn ghost" style={{ pointerEvents: "none" }}>
          Open <Icon name="arrow" size={12} />
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// IncidentsScreen
// ---------------------------------------------------------------------------

export function IncidentsScreen({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;

  const { data, status } = useIncidents({
    client: ctx.client,
    projectId,
    environmentId,
  });

  // Defensive guard: shell should prevent renders without project/env, but
  // protect against the initial project-load window.
  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="activity"
          title="No project selected"
          sub="Select a project and environment to view incidents."
        />
      </div>
    );
  }

  // Loading state
  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="activity" title="Loading…" sub="Fetching active incidents." />
      </div>
    );
  }

  // Error state
  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="alert"
          title="Could not load incidents"
          sub="Check your connection or try again."
        />
      </div>
    );
  }

  const { kpis, rows } = data;

  return (
    <>
      <PageHead
        title="Incidents"
        sub={
          <>
            Priority triage for{" "}
            <strong style={{ color: "var(--fg)" }}>
              {ctx.project.name} · {ctx.environment.name}
            </strong>{" "}
            — {kpis.active} active.
          </>
        }
        actions={
          <>
            <button
              className="sh-btn"
              onClick={() => ctx.pushToast("Incident history is not yet available")}
            >
              <Icon name="history" size={14} />
              History
            </button>
            <button
              className="sh-btn"
              onClick={() => ctx.pushToast("Incident filtering is not yet available")}
            >
              <Icon name="filter" size={14} />
              Filters
            </button>
          </>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <BigKpi label="Active" value={String(kpis.active)} color="var(--sev-critical)" />
        <BigKpi label="P1 critical" value={String(kpis.p1)} color="var(--sev-critical)" />
        <BigKpi label="MTTR (7d)" value={kpis.mttrLabel} />
        <BigKpi label="Resolved (7d)" value={String(kpis.resolved7d)} />
      </div>

      <div
        className="sh-card"
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <div className="sh-card__head">
          <h2 className="sh-h2">Active incidents</h2>
          <span className="sh-tag">sorted by priority</span>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {rows.length === 0 ? (
            <EmptyHint
              icon="check"
              title="No active incidents"
              sub="No open or investigating incidents right now."
            />
          ) : (
            rows.map((row) => <IncidentRow key={row.id} row={row} ctx={ctx} />)
          )}
        </div>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import type { NavSection } from "../nav";
import type { ScreenCtx } from "./registry";
import { useErrors } from "./useErrors";
import type { ErrorRowVM } from "./useErrors";
import type { ErrorGroupStatus, OverviewWindow } from "../../api/types";
import {
  Bars,
  Divider,
  EmptyHint,
  Icon,
  PageHead,
  PriorityPill,
  Segmented,
  Sparkline,
  StatusPill,
  SummaryStat,
} from "../../components/ui/v2";
import { formatCompact, formatDurationShort } from "../../components/ui/v2/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NavigateFn = (section: NavSection) => void;

type SeverityFilter = "all" | "fatal" | "critical" | "error" | "warning";

const STATUS_FILTER_OPTIONS: { value: ErrorGroupStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
];
const SEV_OPTIONS = ["all", "fatal", "critical", "error", "warning"] as const;
const GROUP_STATUSES = ["open", "investigating", "resolved", "ignored"] as const;

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// InvestigateTabs
// ---------------------------------------------------------------------------

type TabDef = {
  label: string;
  icon: "activity" | "error" | "waterfall" | "sparkles" | "cube" | "users";
  count: string;
  dest?: NavSection;
  active?: boolean;
};

function InvestigateTabs({
  tabs,
  navigate,
}: {
  tabs: TabDef[];
  navigate: NavigateFn;
}) {
  return (
    <div className="inv-tabs">
      {tabs.map((t) => (
        <button
          key={t.label}
          className={`inv-tab${t.active ? " is-active" : ""}`}
          aria-label={t.label}
          onClick={t.dest ? () => navigate(t.dest!) : undefined}
        >
          <Icon name={t.icon} size={14} />
          {t.label}
          <span
            className="sh-tag mono"
            style={{
              fontSize: 10,
              padding: "1px 6px",
              background: t.active ? "var(--bg-surface-3)" : "var(--bg-surface)",
            }}
          >
            {t.count}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorRow
// ---------------------------------------------------------------------------

function ErrorRow({ row, ctx }: { row: ErrorRowVM; ctx: ScreenCtx }) {
  const sevColor = SEV_COLOR[row.severity] ?? "var(--fg-muted)";
  const sevBg = SEV_BG[row.severity] ?? "var(--bg-surface-2)";
  const rowBg = row.isCrash
    ? "linear-gradient(90deg, var(--sev-critical-bg), transparent 72%)"
    : "transparent";

  return (
    <button
      className="sh-row sh-row--btn"
      aria-label={row.message}
      style={{
        gridTemplateColumns: "minmax(320px,2.2fr) 116px 100px 80px 64px 64px 120px 84px 28px",
        width: "100%",
        textAlign: "left",
        background: rowBg,
        border: row.isCrash ? "1px solid var(--sev-critical-border)" : "none",
        borderBottom: "1px solid var(--border-subtle)",
        borderRadius: row.isCrash ? 10 : 0,
        margin: row.isCrash ? "6px 8px" : 0,
        cursor: "pointer",
      }}
      onClick={() => ctx.drill("incident", { groupId: row.id })}
    >
      {/* severity + message */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
        <span
          style={{
            width: 3,
            alignSelf: "stretch",
            borderRadius: 1,
            background: sevColor,
            flex: "0 0 auto",
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            className="sh-mono"
            style={{
              fontSize: 12.5,
              color: "var(--fg)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.message}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
            <span className="sh-tag mono">{row.id}</span>
            {row.isCrash ? (
              <span
                className="sh-tag critical"
                style={{ textTransform: "uppercase", fontSize: 10, fontWeight: 800 }}
              >
                Crash
              </span>
            ) : null}
            <span
              className="sh-tag"
              style={{
                background: sevBg,
                color: sevColor,
                borderColor: "transparent",
                textTransform: "uppercase",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {row.severity}
            </span>
          </div>
        </div>
      </div>

      {/* status */}
      <span>
        <StatusPill status={row.status as "open" | "investigating" | "resolved" | "ignored"} />
      </span>

      {/* priority */}
      <span>
        {row.priority != null ? <PriorityPill p={row.priority} /> : null}
      </span>

      {/* events */}
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
        {row.events.toLocaleString()}
      </span>

      {/* users */}
      <span className="sh-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
        {row.users ?? "—"}
      </span>

      {/* tenants */}
      <span className="sh-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
        {row.tenants ?? "—"}
      </span>

      {/* trend */}
      <span data-testid="error-group-trend-sparkline" aria-label="12 bucket error group trend">
        <Sparkline data={row.trend.length > 0 ? row.trend : [0]} color={sevColor} height={24} fill={false} />
      </span>

      {/* last */}
      <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>
        {row.last}
      </span>

      <Icon name="chev" size={13} style={{ color: "var(--fg-faint)" }} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// ErrorsScreen
// ---------------------------------------------------------------------------

const WINDOW_OPTIONS: OverviewWindow[] = ["24h", "7d"];

const SEED = (ctx: ScreenCtx) => (ctx.pendingFilters?.section === "investigate" ? ctx.pendingFilters.filters : null);

export function ErrorsScreen({
  ctx,
  navigate,
}: {
  ctx: ScreenCtx;
  navigate: NavigateFn;
}) {
  const [window, setWindow] = useState<OverviewWindow>("24h");
  const [severity, setSeverity] = useState<SeverityFilter>(() => {
    const seed = SEED(ctx)?.severity;
    return (SEV_OPTIONS as readonly string[]).includes(seed ?? "") ? (seed as SeverityFilter) : "all";
  });
  const [statusFilter, setStatusFilter] = useState<ErrorGroupStatus | "all">("all");
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [releaseText, setReleaseText] = useState("");
  const [releaseFilter, setReleaseFilter] = useState<string | undefined>(undefined);
  const [tenantId, setTenantId] = useState<string | undefined>(() => SEED(ctx)?.tenantId);
  const [userId, setUserId] = useState<string | undefined>(() => SEED(ctx)?.userId);
  const [groupStatus, setGroupStatus] = useState<ErrorGroupStatus | undefined>(() => {
    const seed = SEED(ctx)?.status;
    return (GROUP_STATUSES as readonly string[]).includes(seed ?? "") ? (seed as ErrorGroupStatus) : undefined;
  });

  // The seed is one-shot: consume it once on mount (the shell remounts this
  // screen — via the `page` div's `key={seq}` — on every `navigate` call).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { ctx.clearPendingFilters?.(); }, []);

  const projectId = ctx.project?.id ?? "";
  const environmentId = ctx.environment?.id ?? "";

  const { data, status, reload } = useErrors({
    client: ctx.client,
    projectId,
    environmentId,
    window,
    severity: severity === "all" ? undefined : severity,
    status: statusFilter === "all" ? groupStatus : statusFilter,
    release: releaseFilter,
    tenantId,
    userId,
  });

  function applyReleaseFilter() {
    const trimmed = releaseText.trim();
    setReleaseFilter(trimmed === "" ? undefined : trimmed);
  }

  // Defensive guard: shell should prevent renders without project/env, but
  // protect against the initial project-load window to avoid spurious 400s.
  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="activity"
          title="No project selected"
          sub="Select a project and environment to view errors."
        />
      </div>
    );
  }

  // Loading state
  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="activity" title="Loading…" sub="Fetching error groups." />
      </div>
    );
  }

  // Error state
  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="alert"
          title="Could not load errors"
          sub="Retry this request. Your filters are preserved." cta={<button className="sh-btn" onClick={reload}>Retry errors</button>}
        />
      </div>
    );
  }

  const { tabs, summary, volume, rows } = data;

  const tabDefs: TabDef[] = [
    { label: "Events", icon: "activity", count: formatCompact(tabs.events), dest: "events" },
    { label: "Errors", icon: "error", count: formatCompact(tabs.errors), active: true },
    { label: "Traces", icon: "waterfall", count: formatCompact(tabs.traces), dest: "traces" },
    { label: "AI calls", icon: "sparkles", count: formatCompact(tabs.llm), dest: "llm" },
    { label: "Accounts", icon: "cube", count: formatCompact(tabs.tenants), dest: "entities" },
    { label: "Users", icon: "users", count: formatCompact(tabs.users), dest: "users" },
  ];

  const sevLabel = (s: string) => {
    if (s === "all") return "severity: all";
    if (s === "fatal") return "crashes";
    return s;
  };

  return (
    <>
      <PageHead title="Errors" sub={`${ctx.project.name} · ${ctx.environment.name} — grouped failures in the last ${window}. Open a group to assess affected users and inspect the evidence.`} />
      {/* Tab bar */}
      <InvestigateTabs tabs={tabDefs} navigate={navigate} />

      {/* Filter row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div className="sh-segmented">
          {SEV_OPTIONS.map((s) => (
            <button
              key={s}
              aria-pressed={s === severity}
              onClick={() => setSeverity(s)}
            >
              {sevLabel(s)}
            </button>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button className="sh-btn" onClick={() => setStatusMenuOpen((o) => !o)}>
            <Icon name="filter" size={13} />
            status: {statusFilter === "all" ? "all" : statusFilter}
          </button>
          {statusMenuOpen ? (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                zIndex: 100,
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                minWidth: 160,
                boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                marginTop: 4,
              }}
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 14px",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                  onClick={() => {
                    setStatusFilter(opt.value);
                    setStatusMenuOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <input
          className="sh-input"
          aria-label="Filter by release"
          placeholder="Filter by release"
          value={releaseText}
          onChange={(e) => setReleaseText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyReleaseFilter();
          }}
          style={{ width: 160 }}
        />
        <button className="sh-btn" onClick={applyReleaseFilter}>
          Apply
        </button>
        {tenantId ? (
          <button className="sh-btn" onClick={() => setTenantId(undefined)}>
            <Icon name="x" size={13} />
            tenant: {tenantId}
          </button>
        ) : null}
        {userId ? (
          <button className="sh-btn" onClick={() => setUserId(undefined)}>
            <Icon name="x" size={13} />
            user: {userId}
          </button>
        ) : null}
        {groupStatus ? (
          <button className="sh-btn" onClick={() => setGroupStatus(undefined)}>
            <Icon name="x" size={13} />
            status: {groupStatus}
          </button>
        ) : null}
        <div style={{ flex: 1 }} />
        <Segmented options={["Grouped", "Raw"]} value="Grouped" />
        <Segmented
          options={WINDOW_OPTIONS}
          value={window}
          onChange={(v) => setWindow(v as OverviewWindow)}
        />
      </div>

      {/* Summary strip */}
      <div className="sh-card">
        <div
          className="sh-card__body"
          style={{
            display: "flex",
            gap: 28,
            padding: "14px 18px",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <SummaryStat
            label="Errors (24h)"
            value={summary.errors24h.toLocaleString()}
            tone="danger"
          />
          <Divider />
          <SummaryStat label="Open groups" value={String(summary.openGroups)} />
          <Divider />
          <SummaryStat label="Crashes" value={String(summary.crashes)} tone="danger" />
          <Divider />
          <SummaryStat label="Critical" value={String(summary.critical)} tone="danger" />
          <Divider />
          <SummaryStat label="MTTR" value={formatDurationShort(summary.mttr)} />
          <Divider />
          <SummaryStat
            label="Top release"
            value={summary.topRelease ?? "—"}
            mono
          />
          <div style={{ flex: 1 }} />
          {volume.length > 0 && (
            <div style={{ width: 240 }}>
              <div
                className="sh-eyebrow"
                style={{ marginBottom: 4, fontSize: 11, color: "var(--fg-muted)" }}
              >
                Volume / hour
              </div>
              <Bars data={volume} color="var(--sev-critical)" height={32} />
            </div>
          )}
        </div>
      </div>

      {/* Error group table */}
      <div
        className="sh-card"
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        {/* Table header */}
        <div
          className="sh-row sh-row__head"
          style={{
            gridTemplateColumns: "minmax(320px,2.2fr) 116px 100px 80px 64px 64px 120px 84px 28px",
          }}
        >
          <span>Error</span>
          <span>Status</span>
          <span>Priority</span>
          <span>Events</span>
          <span>Users</span>
          <span>Tenants</span>
          <span>Trend</span>
          <span>Last</span>
          <span />
        </div>

        {/* Rows */}
        <div style={{ overflow: "auto", flex: 1 }}>
          {rows.length === 0 ? (
            <EmptyHint
              icon="error"
              title="No error groups"
              sub="Nothing matches this window and filter selection. Widen the window or clear a filter to inspect other failures."
            />
          ) : (
            rows.map((row) => (
              <ErrorRow key={row.id} row={row} ctx={ctx} />
            ))
          )}
        </div>
      </div>
    </>
  );
}

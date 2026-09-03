import { useMemo, useState } from "react";
import type { EntityWindow } from "../../api/types";
import { BigKpi, EmptyHint, Icon, Segmented } from "../../components/ui/v2";
import type { NavSection } from "../nav";
import type { ScreenCtx } from "./registry";
import { buildTenantVM, useTenant } from "./useTenant";
import type { TimelineRowVM, TimelineTone, TopUserVM, SignalBarVM } from "./useTenant";

const WINDOW_OPTIONS: EntityWindow[] = ["24h", "7d", "30d"];

const TONE_COLOR: Record<TimelineTone, string> = {
  ok: "var(--accent)",
  critical: "var(--sev-critical)",
  warning: "var(--sev-warning)",
  info: "var(--sev-info)",
  violet: "var(--sev-violet)",
};

function TimelineRow({ row, ctx }: { row: TimelineRowVM; ctx: ScreenCtx }) {
  const clickable = row.navTo != null;
  return (
    <button
      className={`tenant-timeline-row${clickable ? " sh-interactive-row" : ""}`}
      onClick={clickable ? () => ctx.navigate(row.navTo as NavSection) : undefined}
    >
      <span className="sh-mono sh-faint sh-copy-11">{row.clock}</span>
      <span style={{ color: TONE_COLOR[row.tone] }}><Icon name={row.icon} size={14} /></span>
      <div className="sh-min-w-0">
        <div className="sh-mono sh-copy-12 sh-truncate">{row.title}</div>
        <div className="sh-faint sh-copy-11">{row.sub}</div>
      </div>
      {row.tag ? <span className="sh-tag mono">{row.tag}</span> : <span />}
    </button>
  );
}

function TopUserRow({ user }: { user: TopUserVM }) {
  return (
    <div className="sh-row tenant-user-row">
      <div className="tb-avatar tenant-user-avatar">{user.initials}</div>
      <div>
        <div className="sh-mono sh-copy-12">{user.userId}</div>
        <div className="sh-faint" style={{ fontSize: 10.5 }}>last seen {user.lastSeen}</div>
      </div>
      <span className="sh-numeric sh-copy-11-5">{user.events}</span>
      <span className="sh-numeric sh-copy-11-5" style={{ color: "var(--sev-violet)" }}>{user.cost}</span>
    </div>
  );
}

function SignalBar({ bar }: { bar: SignalBarVM }) {
  return (
    <div>
      <div className="tenant-signal-head">
        <span className="sh-mono">{bar.label}</span>
        <span className="sh-numeric">{bar.display}</span>
      </div>
      <div className="tenant-signal-track">
        <div className="tenant-signal-fill" style={{ width: `${bar.ratio * 100}%`, background: bar.color }} />
      </div>
    </div>
  );
}

export function TenantScreen({ ctx, tenantId }: { ctx: ScreenCtx; tenantId: string }) {
  const [window, setWindow] = useState<EntityWindow>("24h");
  const projectId = ctx.project?.id ?? "";
  const environmentId = ctx.environment?.id ?? "";

  const { data, status } = useTenant({ client: ctx.client, projectId, environmentId, tenantId, window });
  const vm = useMemo(() => (data ? buildTenantVM(data) : null), [data]);

  const backBtn = (
    <button className="sh-btn ghost tenant-back" onClick={() => ctx.back()}>
      <Icon name="arrow" size={12} style={{ transform: "rotate(180deg)" }} />Back
    </button>
  );

  if (!ctx.project || !ctx.environment) {
    return (
      <>
        <div className="tenant-back-wrap">{backBtn}</div>
        <EmptyHint icon="cube" title="No project selected" sub="Pick a project and environment to view tenant detail." />
      </>
    );
  }

  if (status === "error") {
    return (
      <>
        <div className="tenant-back-wrap">{backBtn}</div>
        <EmptyHint icon="error" title="Could not load tenant" sub="The tenant detail request failed. Try again." />
      </>
    );
  }

  if (status === "loading" || !vm) {
    return (
      <>
        <div className="tenant-back-wrap">{backBtn}</div>
        <EmptyHint icon="activity" title="Loading tenant…" sub="Fetching tenant activity." />
      </>
    );
  }

  const { header, kpis, timeline, topUsers, signalBars } = vm;

  return (
    <>
      <div className="tenant-back-wrap--compact">{backBtn}</div>

      {/* Hero */}
      <div className="tenant-header">
        <div className="sh-cluster-14">
          <div className="tenant-avatar">{header.initials}</div>
          <div>
            <h1 className="sh-h1 tenant-title">{header.label}</h1>
            <div className="sh-cluster-8">
              <span className="sh-tag mono">{header.tenantId}</span>
              <span className="sh-tag ok"><span className="tenant-status-dot" />{header.statusLabel}</span>
              <span className="sh-faint sh-copy-11-5">plan: {header.plan} · last seen {header.lastSeen}</span>
            </div>
          </div>
        </div>
        <div className="sh-cluster-8">
          <Segmented options={WINDOW_OPTIONS} value={window} onChange={(v) => setWindow(v as EntityWindow)} />
        </div>
      </div>

      {/* KPIs */}
      <div className="tenant-kpi-grid sh-investigation-grid sh-grid-12">
        {kpis.map((k) => <BigKpi key={k.label} label={k.label} value={k.value} color={k.color} />)}
      </div>

      {/* Timeline + side rail */}
      <div className="tenant-panels sh-investigation-grid sh-grid-16 sh-grow sh-min-w-0 sh-min-h-0">
        <div className="sh-card sh-card-fill">
          <div className="sh-card__head">
            <h2 className="sh-h2">Unified timeline</h2>
            <div className="sh-cluster-6">
              <span className="sh-tag ok">events</span>
              <span className="sh-tag critical">errors</span>
              <span className="sh-tag violet">llm</span>
              <span className="sh-tag info">traces</span>
            </div>
          </div>
          <div className="sh-table-scroll sh-scroll-fill">
            {timeline.length === 0
              ? <EmptyHint icon="activity" title="No activity" sub="No timeline events in this window." />
              : timeline.map((row) => <TimelineRow key={row.id} row={row} ctx={ctx} />)}
          </div>
        </div>

        <div className="sh-panel-rail">
          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Top users</h2></div>
            <div className="sh-card__body flush">
              {topUsers.length === 0
                ? <EmptyHint icon="users" title="No users" sub="No active users in this window." />
                : topUsers.map((u) => <TopUserRow key={u.userId} user={u} />)}
            </div>
          </div>
          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Activity by type</h2></div>
            <div className="sh-card__body sh-grid-8">
              {signalBars.map((b) => <SignalBar key={b.label} bar={b} />)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

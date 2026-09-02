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

const AVATAR_GRADIENT = "linear-gradient(135deg, oklch(0.66 0.14 290), oklch(0.58 0.16 230))";

function TimelineRow({ row, ctx }: { row: TimelineRowVM; ctx: ScreenCtx }) {
  const clickable = row.navTo != null;
  return (
    <button
      className="sh-row--btn"
      style={{
        display: "grid", gridTemplateColumns: "70px 30px 1fr auto", gap: 10, padding: "11px 16px",
        borderBottom: "1px solid var(--border-subtle)", alignItems: "center", width: "100%",
        textAlign: "left", background: "transparent", border: "none",
        borderBottomColor: "var(--border-subtle)", borderBottomStyle: "solid", borderBottomWidth: 1,
        cursor: clickable ? "pointer" : "default",
      }}
      onClick={clickable ? () => ctx.navigate(row.navTo as NavSection) : undefined}
    >
      <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>{row.clock}</span>
      <span style={{ color: TONE_COLOR[row.tone] }}><Icon name={row.icon} size={14} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="sh-mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</div>
        <div className="sh-faint" style={{ fontSize: 11 }}>{row.sub}</div>
      </div>
      {row.tag ? <span className="sh-tag mono">{row.tag}</span> : <span />}
    </button>
  );
}

function TopUserRow({ user }: { user: TopUserVM }) {
  return (
    <div className="sh-row" style={{ gridTemplateColumns: "26px 1fr 70px 70px" }}>
      <div className="tb-avatar" style={{ width: 22, height: 22, fontSize: 9 }}>{user.initials}</div>
      <div>
        <div className="sh-mono" style={{ fontSize: 12 }}>{user.userId}</div>
        <div className="sh-faint" style={{ fontSize: 10.5 }}>last seen {user.lastSeen}</div>
      </div>
      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11.5 }}>{user.events}</span>
      <span style={{ color: "var(--sev-violet)", fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>{user.cost}</span>
    </div>
  );
}

function SignalBar({ bar }: { bar: SignalBarVM }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
        <span className="sh-mono">{bar.label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{bar.display}</span>
      </div>
      <div style={{ height: 4, background: "var(--bg-canvas)", borderRadius: 2, marginTop: 4 }}>
        <div style={{ height: "100%", width: `${bar.ratio * 100}%`, background: bar.color, borderRadius: 2 }} />
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
    <button className="sh-btn ghost" onClick={() => ctx.back()} style={{ padding: "4px 8px", fontSize: 12 }}>
      <Icon name="arrow" size={12} style={{ transform: "rotate(180deg)" }} />Back
    </button>
  );

  if (!ctx.project || !ctx.environment) {
    return (
      <>
        <div style={{ marginBottom: 12 }}>{backBtn}</div>
        <EmptyHint icon="cube" title="No project selected" sub="Pick a project and environment to view tenant detail." />
      </>
    );
  }

  if (status === "error") {
    return (
      <>
        <div style={{ marginBottom: 12 }}>{backBtn}</div>
        <EmptyHint icon="error" title="Could not load tenant" sub="The tenant detail request failed. Try again." />
      </>
    );
  }

  if (status === "loading" || !vm) {
    return (
      <>
        <div style={{ marginBottom: 12 }}>{backBtn}</div>
        <EmptyHint icon="activity" title="Loading tenant…" sub="Fetching tenant activity." />
      </>
    );
  }

  const { header, kpis, timeline, topUsers, signalBars } = vm;

  return (
    <>
      <div style={{ marginBottom: 4 }}>{backBtn}</div>

      {/* Hero */}
      <div className="tenant-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 13, background: AVATAR_GRADIENT, display: "grid", placeItems: "center", color: "white", fontWeight: 700, fontSize: 20 }}>{header.initials}</div>
          <div>
            <h1 className="sh-h1" style={{ fontSize: 22, marginBottom: 2 }}>{header.label}</h1>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="sh-tag mono">{header.tenantId}</span>
              <span className="sh-tag ok"><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />{header.statusLabel}</span>
              <span className="sh-faint" style={{ fontSize: 11.5 }}>plan: {header.plan} · last seen {header.lastSeen}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Segmented options={WINDOW_OPTIONS} value={window} onChange={(v) => setWindow(v as EntityWindow)} />
        </div>
      </div>

      {/* KPIs */}
      <div className="tenant-kpi-grid" style={{ display: "grid", gap: 12 }}>
        {kpis.map((k) => <BigKpi key={k.label} label={k.label} value={k.value} color={k.color} />)}
      </div>

      {/* Timeline + side rail */}
      <div className="tenant-panels" style={{ display: "grid", gap: 16, flex: 1, minHeight: 0 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Unified timeline</h2>
            <div style={{ display: "flex", gap: 6 }}>
              <span className="sh-tag ok">events</span>
              <span className="sh-tag critical">errors</span>
              <span className="sh-tag violet">llm</span>
              <span className="sh-tag info">traces</span>
            </div>
          </div>
          <div className="sh-table-scroll" style={{ overflow: "auto", flex: 1 }}>
            {timeline.length === 0
              ? <EmptyHint icon="activity" title="No activity" sub="No timeline events in this window." />
              : timeline.map((row) => <TimelineRow key={row.id} row={row} ctx={ctx} />)}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0, overflow: "auto" }}>
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
            <div className="sh-card__body" style={{ display: "grid", gap: 8 }}>
              {signalBars.map((b) => <SignalBar key={b.label} bar={b} />)}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

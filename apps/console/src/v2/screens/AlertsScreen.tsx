import { useState } from "react";
import { EmptyHint, Icon, PageHead, Segmented } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useAlerts } from "./useAlerts";
import type { AlertRuleRowVM, ChannelRowVM, TimelineDayVM } from "./useAlerts";

const RULE_GRID = "1.5fr 96px 90px 1fr 70px 84px";
const FILTERS = ["All", "Active", "Paused"] as const;
type RuleFilter = (typeof FILTERS)[number];

function FiresTimeline({ timeline }: { timeline: TimelineDayVM[] }) {
  const total = timeline.reduce((n, d) => n + d.fires.length, 0);
  if (total === 0) {
    return (
      <p className="sh-faint" style={{ fontSize: 12, margin: 0 }}>
        No fires in the last 7 days
      </p>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
      {timeline.map((day) => (
        <div key={day.label}>
          <div className="sh-faint sh-mono" style={{ fontSize: 10, marginBottom: 6 }}>
            {day.label}
          </div>
          <div
            style={{
              position: "relative",
              height: 60,
              background: "var(--bg-canvas)",
              borderRadius: 5,
              border: "1px solid var(--border-subtle)",
              overflow: "hidden",
            }}
          >
            {[6, 12, 18].map((h) => (
              <span
                key={h}
                style={{
                  position: "absolute",
                  left: `${(h / 24) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: "var(--border-subtle)",
                }}
              />
            ))}
            {day.fires.map((f, j) => (
              <span
                key={j}
                style={{
                  position: "absolute",
                  left: `${f.hourFraction * 100}%`,
                  top: 4,
                  bottom: 4,
                  width: 3,
                  borderRadius: 1,
                  background: f.tone === "critical" ? "var(--sev-critical)" : "var(--sev-warning)",
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AlertRuleRow({ row, ctx }: { row: AlertRuleRowVM; ctx: ScreenCtx }) {
  return (
    <div className="sh-row alert-row" style={{ gridTemplateColumns: RULE_GRID }}>
      <div>
        <strong style={{ fontSize: 12.5 }}>{row.name}</strong>
        <div className="sh-faint sh-mono" style={{ fontSize: 11 }}>
          {row.subLabel}
        </div>
      </div>
      <span
        className={`sh-tag ${row.severityTag}`}
        style={{ textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}
      >
        {row.severity}
      </span>
      <span>
        <span
          className="sh-tag"
          style={{
            background: row.enabled ? "var(--accent-bg-subtle)" : "var(--bg-surface-3)",
            color: row.enabled ? "var(--accent)" : "var(--fg-muted)",
            borderColor: "transparent",
          }}
        >
          {row.enabled ? "● active" : "paused"}
        </span>
      </span>
      <span style={{ fontSize: 12 }}>{row.channelLabel}</span>
      <span
        className="sh-mono"
        style={{
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          color: row.fires7d > 0 ? "var(--sev-critical)" : "var(--fg-muted)",
        }}
      >
        {row.fires7d}
      </span>
      <div className="alert-row__actions" style={{ display: "flex", gap: 4 }}>
        <button
          className="sh-iconbtn-sm"
          title="Edit rule"
          onClick={() => ctx.pushToast("Rule editor is not yet available")}
        >
          <Icon name="edit" size={13} />
        </button>
        <button
          className="sh-iconbtn-sm"
          title={row.enabled ? "Pause" : "Resume"}
          onClick={() => ctx.pushToast(row.enabled ? `Pausing ${row.name}` : `Resuming ${row.name}`)}
        >
          <Icon name={row.enabled ? "clock" : "play"} size={13} />
        </button>
        <button
          className="sh-iconbtn-sm"
          title="Archive rule"
          onClick={() => ctx.pushToast(`Archiving ${row.name}`)}
        >
          <Icon name="archive" size={13} />
        </button>
      </div>
    </div>
  );
}

function ChannelRow({ row, ctx }: { row: ChannelRowVM; ctx: ScreenCtx }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 16px",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <span style={{ color: row.ok ? "var(--accent)" : "var(--sev-warning)" }}>
        <Icon name={row.icon} size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5 }}>{row.name}</div>
        <div
          className="sh-faint sh-mono"
          style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {row.target}
        </div>
      </div>
      <button
        className="sh-tag mono"
        style={{ cursor: "pointer" }}
        onClick={() => ctx.pushToast(`Test notification sent to ${row.name}`)}
      >
        test
      </button>
    </div>
  );
}

export function AlertsScreen({ ctx }: { ctx: ScreenCtx }) {
  const [filter, setFilter] = useState<RuleFilter>("All");
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;

  const { data, status } = useAlerts({ client: ctx.client, projectId, environmentId });

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="bell"
          title="No project selected"
          sub="Select a project and environment to view alerts."
        />
      </div>
    );
  }

  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="bell" title="Loading…" sub="Fetching alert rules and history." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="alert" title="Could not load alerts" sub="Check your connection or try again." />
      </div>
    );
  }

  const { header, rules, channels, timeline } = data;
  const shownRules = rules.filter((r) =>
    filter === "All" ? true : filter === "Active" ? r.enabled : !r.enabled,
  );

  return (
    <>
      <PageHead
        title="Alerts"
        sub={`${header.activeRuleCount} active rules · ${header.fires7d} fires in the last 7 days`}
        actions={
          <>
            <button
              className="sh-btn"
              onClick={() => ctx.pushToast("Channel management is not yet available")}
            >
              <Icon name="webhook" size={13} />
              Channels
            </button>
            <button
              className="sh-btn primary"
              onClick={() => ctx.pushToast("Rule editor is not yet available")}
            >
              <Icon name="plus" size={13} />
              New rule
            </button>
          </>
        }
      />

      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Recent history</h2>
          <span className="sh-faint" style={{ fontSize: 11 }}>
            last 7 days
          </span>
        </div>
        <div className="sh-card__body">
          <FiresTimeline timeline={timeline} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Rules</h2>
            <Segmented options={[...FILTERS]} value={filter} onChange={(v) => setFilter(v as RuleFilter)} />
          </div>
          <div className="sh-row sh-row__head" style={{ gridTemplateColumns: RULE_GRID }}>
            <span>Rule</span>
            <span>Severity</span>
            <span>State</span>
            <span>Channel</span>
            <span>7d</span>
            <span>Actions</span>
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {shownRules.length === 0 ? (
              <EmptyHint icon="bell" title="No alert rules" sub="No rules match this filter." />
            ) : (
              shownRules.map((row) => <AlertRuleRow key={row.id} row={row} ctx={ctx} />)
            )}
          </div>
        </div>

        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Channels</h2>
            <button
              className="sh-btn ghost"
              style={{ padding: "4px 8px" }}
              onClick={() => ctx.pushToast("Channel management is not yet available")}
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
          <div className="sh-card__body flush">
            {channels.length === 0 ? (
              <EmptyHint icon="webhook" title="No channels" sub="No notification channels configured." />
            ) : (
              channels.map((row) => <ChannelRow key={row.id} row={row} ctx={ctx} />)
            )}
          </div>
        </div>
      </div>
    </>
  );
}

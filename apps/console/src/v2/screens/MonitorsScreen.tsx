import { useEffect, useState } from "react";
import { EmptyHint, Icon, PageHead, Segmented, StatusDot } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useMonitors } from "./useMonitors";
import type { MonitorCheckVM, MonitorRollupVM, MonitorRowVM } from "./useMonitors";

const KIND_FILTERS = ["All", "HTTP", "Heartbeat"] as const;
type KindFilter = (typeof KIND_FILTERS)[number];

const ROW_GRID = "1.6fr 1.4fr 1fr 110px 1fr 76px";

function originEndpoint(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://your-instance.example.com";
}

function Rollup({ rollup }: { rollup: MonitorRollupVM }) {
  const tiles: Array<{ label: string; value: number; tone: string }> = [
    { label: "Up", value: rollup.up, tone: "ok" },
    { label: "Degraded", value: rollup.degraded, tone: "warn" },
    { label: "Down", value: rollup.down, tone: "critical" },
    { label: "Paused", value: rollup.paused, tone: "solid" },
  ];
  return (
    <div className="sh-card">
      <div className="sh-card__body" style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span className={`sh-tag ${t.tone}`} style={{ alignSelf: "flex-start", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
              {t.label}
            </span>
            <strong className="sh-mono" style={{ fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{t.value}</strong>
          </div>
        ))}
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div className="sh-faint" style={{ fontSize: 11 }}>{rollup.total} total · {rollup.enabled} enabled</div>
          {rollup.withoutChannel > 0 ? (
            <div className="sh-tag warn" style={{ marginTop: 4, fontSize: 10.5 }}>
              {rollup.withoutChannel} without channel
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CheckHistory({ checks, loading }: { checks: MonitorCheckVM[]; loading: boolean }) {
  if (loading) return <p className="sh-faint" style={{ fontSize: 12, padding: "8px 16px" }}>Loading checks…</p>;
  if (checks.length === 0) return <p className="sh-faint" style={{ fontSize: 12, padding: "8px 16px" }}>No checks yet.</p>;
  return (
    <div className="sh-card__body flush">
      {checks.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <StatusDot status={c.statusV2} />
          <span className="sh-mono" style={{ fontSize: 11.5, minWidth: 80 }}>{c.checkedLabel}</span>
          <span className="sh-faint sh-mono" style={{ fontSize: 11.5, color: c.hasError ? "var(--sev-critical)" : undefined }}>{c.detail}</span>
        </div>
      ))}
    </div>
  );
}

function MonitorRow({
  row,
  selected,
  onSelect,
}: {
  row: MonitorRowVM;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`sh-row${selected ? " is-active" : ""}`}
      style={{ gridTemplateColumns: ROW_GRID, width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", opacity: row.enabled ? 1 : 0.6 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <StatusDot status={row.statusV2} />
        <strong style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</strong>
        <span className="sh-tag" style={{ fontSize: 10, textTransform: "uppercase" }}>{row.kind}</span>
      </div>
      <span className="sh-faint sh-mono" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.target}</span>
      <span className="sh-faint" style={{ fontSize: 11.5 }}>{row.cadence}</span>
      <span className="sh-faint sh-mono" style={{ fontSize: 11.5 }}>{row.lastCheckedLabel}</span>
      <span style={{ fontSize: 11.5 }}>
        {row.hasChannel ? row.channelLabel : <span className="sh-tag warn" style={{ fontSize: 10 }}>no channel</span>}
      </span>
      <span />
    </button>
  );
}

export function MonitorsScreen({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const monitors = useMonitors({ client: ctx.client, projectId, environmentId, endpoint: originEndpoint() });

  const [filter, setFilter] = useState<KindFilter>("All");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checks, setChecks] = useState<MonitorCheckVM[]>([]);
  const [checksLoading, setChecksLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setChecks([]);
      return;
    }
    setChecksLoading(true);
    monitors
      .loadChecks(selectedId)
      .then((vms) => {
        if (!cancelled) setChecks(vms);
      })
      .finally(() => {
        if (!cancelled) setChecksLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, monitors.data]);

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="pulse" title="No project selected" sub="Select a project and environment to view monitors." />
      </div>
    );
  }

  if (monitors.status === "unavailable") {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="server" title="Monitors API unavailable" sub="This instance does not expose monitor management." />
      </div>
    );
  }

  if (monitors.status === "loading" && !monitors.data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="activity" title="Loading…" sub="Fetching monitors and channels." />
      </div>
    );
  }

  if (monitors.status === "error" || !monitors.data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="alert" title="Could not load monitors" sub="Check your connection or try again." />
      </div>
    );
  }

  const { rollup, rows } = monitors.data;
  const shownRows = rows.filter((r) =>
    filter === "All" ? true : filter === "HTTP" ? r.kind === "http" : r.kind === "heartbeat",
  );

  return (
    <>
      <PageHead
        title="Monitors"
        sub={`HTTP uptime and heartbeat checks for ${ctx.project.name} / ${ctx.environment.name}.`}
        actions={
          <>
            <Segmented options={[...KIND_FILTERS]} value={filter} onChange={(v) => setFilter(v as KindFilter)} />
            <button className="sh-btn primary" onClick={() => setShowCreate((s) => !s)}>
              <Icon name="plus" size={13} />
              New monitor
            </button>
          </>
        }
      />

      <Rollup rollup={rollup} />

      <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="sh-row sh-row__head" style={{ gridTemplateColumns: ROW_GRID }}>
          <span>Monitor</span>
          <span>Target</span>
          <span>Cadence</span>
          <span>Last check</span>
          <span>Channel</span>
          <span>Actions</span>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {shownRows.length === 0 ? (
            <EmptyHint icon="pulse" title="No monitors yet" sub="Create an HTTP or heartbeat monitor to start tracking uptime." />
          ) : (
            shownRows.map((row) => (
              <div key={row.id}>
                <MonitorRow row={row} selected={selectedId === row.id} onSelect={() => setSelectedId((cur) => (cur === row.id ? null : row.id))} />
                {selectedId === row.id ? <CheckHistory checks={checks} loading={checksLoading} /> : null}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

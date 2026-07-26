import { useEffect, useState } from "react";
import { EmptyHint, Icon, PageHead, SecretField, Segmented, StatusDot } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useMonitors } from "./useMonitors";
import { runMutation } from "../lib/run-mutation";
import type { CreateHeartbeatForm, CreateHttpForm, EditMonitorForm, LatestMonitorSecret, MonitorChannelVM, MonitorCheckVM, MonitorRollupVM, MonitorRowVM } from "./useMonitors";

const KIND_FILTERS = ["All", "HTTP", "Heartbeat"] as const;
type KindFilter = (typeof KIND_FILTERS)[number];

const ROW_GRID = "1.6fr 1.4fr 1fr 110px 1fr 76px";

function originEndpoint(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://your-instance.example.com";
}

function parsePositiveInteger(value: string, minimum: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : null;
}

function validateHttpUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Monitor URL must be a valid http or https URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Monitor URL must be a valid http or https URL";
  if (parsed.username || parsed.password) return "Monitor URL must not include credentials";
  return null;
}

function ChannelSelect({ channels, value, onChange }: { channels: MonitorChannelVM[]; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
      <span className="sh-faint">Channel</span>
      <select className="sh-input" aria-label="Notification channel" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">No channel</option>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
    </label>
  );
}

function CreatePanel({
  channels,
  busy,
  onCreateHttp,
  onCreateHeartbeat,
  onError,
}: {
  channels: MonitorChannelVM[];
  busy: boolean;
  onCreateHttp: (form: CreateHttpForm) => Promise<boolean>;
  onCreateHeartbeat: (form: CreateHeartbeatForm) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = useState<"HTTP" | "Heartbeat">("HTTP");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState("5");
  const [timeoutMs, setTimeoutMs] = useState("5000");
  const [expectedIntervalMinutes, setExpectedIntervalMinutes] = useState("5");
  const [graceMinutes, setGraceMinutes] = useState("2");
  const [channelId, setChannelId] = useState("");

  function reset() {
    setName(""); setUrl(""); setIntervalMinutes("5"); setTimeoutMs("5000");
    setExpectedIntervalMinutes("5"); setGraceMinutes("2");
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return onError("Monitor name is required");
    if (kind === "HTTP") {
      const u = url.trim();
      const urlError = validateHttpUrl(u);
      if (urlError) return onError(urlError);
      const interval = parsePositiveInteger(intervalMinutes, 1);
      const timeout = parsePositiveInteger(timeoutMs, 100);
      if (interval === null || timeout === null) return onError("Interval and timeout must be valid numbers");
      const ok = await onCreateHttp({ name: trimmed, url: u, intervalMinutes: interval, timeoutMs: timeout, notificationChannelId: channelId });
      if (ok) reset(); else onError("Could not create HTTP monitor");
    } else {
      const interval = parsePositiveInteger(expectedIntervalMinutes, 1);
      const grace = parsePositiveInteger(graceMinutes, 0);
      if (interval === null || grace === null) return onError("Interval and grace must be valid numbers");
      const ok = await onCreateHeartbeat({ name: trimmed, expectedIntervalMinutes: interval, graceMinutes: grace, notificationChannelId: channelId });
      if (ok) reset(); else onError("Could not create heartbeat monitor");
    }
  }

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">New monitor</h2>
        <Segmented options={["HTTP", "Heartbeat"]} value={kind} onChange={(v) => setKind(v as "HTTP" | "Heartbeat")} />
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
          <span className="sh-faint">Name</span>
          <input className="sh-input" aria-label="Monitor name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {kind === "HTTP" ? (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
              <span className="sh-faint">URL</span>
              <input className="sh-input" aria-label="Monitor URL" placeholder="https://api.example.com/health" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                <span className="sh-faint">Interval (min)</span>
                <input className="sh-input" aria-label="Check interval" type="number" min="1" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                <span className="sh-faint">Timeout (ms)</span>
                <input className="sh-input" aria-label="Timeout" type="number" min="100" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} />
              </label>
            </div>
          </>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
              <span className="sh-faint">Expected interval (min)</span>
              <input className="sh-input" aria-label="Expected interval" type="number" min="1" value={expectedIntervalMinutes} onChange={(e) => setExpectedIntervalMinutes(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
              <span className="sh-faint">Grace (min)</span>
              <input className="sh-input" aria-label="Grace" type="number" min="0" value={graceMinutes} onChange={(e) => setGraceMinutes(e.target.value)} />
            </label>
          </div>
        )}
        <ChannelSelect channels={channels} value={channelId} onChange={setChannelId} />
        <div>
          <button className="sh-btn primary" disabled={busy} onClick={() => void submit()}>Create monitor</button>
        </div>
      </div>
    </div>
  );
}

function SecretBanner({ secret, onDismiss }: { secret: LatestMonitorSecret; onDismiss: () => void }) {
  return (
    <div className="sh-stripe ok" style={{ display: "grid", gap: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>Heartbeat created — {secret.monitorName}</strong>
        <button className="sh-iconbtn-sm" title="Dismiss" onClick={onDismiss}><Icon name="x" size={13} /></button>
      </div>
      <div style={{ fontSize: 11.5 }} className="sh-faint">Copy the secret and check-in URL now — the secret is shown only once.</div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
        <span className="sh-faint">Check-in URL</span>
        <SecretField value={secret.url} masked={false} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
        <span className="sh-faint">Secret</span>
        <SecretField value={secret.secret} />
      </label>
    </div>
  );
}

function EditRow({
  row,
  channels,
  busy,
  onSave,
  onCancel,
  onError,
}: {
  row: MonitorRowVM;
  channels: MonitorChannelVM[];
  busy: boolean;
  onSave: (form: EditMonitorForm) => Promise<boolean>;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(row.name);
  const [enabled, setEnabled] = useState(row.enabled);
  const [channelId, setChannelId] = useState(row.notificationChannelId ?? "");
  const [url, setUrl] = useState(row.url ?? "");
  const [intervalMinutes, setIntervalMinutes] = useState(String(row.intervalMinutes ?? 5));
  const [timeoutMs, setTimeoutMs] = useState(String(row.timeoutMs ?? 5000));
  const [expectedIntervalMinutes, setExpectedIntervalMinutes] = useState(String(row.expectedIntervalMinutes ?? 5));
  const [graceMinutes, setGraceMinutes] = useState(String(row.graceMinutes ?? 2));

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return onError("Monitor name is required");
    const base = { id: row.id, kind: row.kind, name: trimmed, enabled, notificationChannelId: channelId };
    if (row.kind === "http") {
      const u = url.trim();
      const urlError = validateHttpUrl(u);
      if (urlError) return onError(urlError);
      const interval = parsePositiveInteger(intervalMinutes, 1);
      const timeout = parsePositiveInteger(timeoutMs, 100);
      if (interval === null || timeout === null) return onError("Interval and timeout must be valid numbers");
      const ok = await onSave({ ...base, url: u, intervalMinutes: interval, timeoutMs: timeout, expectedIntervalMinutes: 5, graceMinutes: 2 });
      if (!ok) onError("Could not update monitor");
    } else {
      const interval = parsePositiveInteger(expectedIntervalMinutes, 1);
      const grace = parsePositiveInteger(graceMinutes, 0);
      if (interval === null || grace === null) return onError("Interval and grace must be valid numbers");
      const ok = await onSave({ ...base, url: "", intervalMinutes: 5, timeoutMs: 5000, expectedIntervalMinutes: interval, graceMinutes: grace });
      if (!ok) onError("Could not update monitor");
    }
  }

  return (
    <div className="sh-card__body" style={{ display: "grid", gap: 12, background: "var(--bg-surface-2)" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
        <span className="sh-faint">Name</span>
        <input className="sh-input" aria-label="Monitor name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {row.kind === "http" ? (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
            <span className="sh-faint">URL</span>
            <input className="sh-input" aria-label="Monitor URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
              <span className="sh-faint">Interval (min)</span>
              <input className="sh-input" aria-label="Check interval" type="number" min="1" value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
              <span className="sh-faint">Timeout (ms)</span>
              <input className="sh-input" aria-label="Timeout" type="number" min="100" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} />
            </label>
          </div>
        </>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
            <span className="sh-faint">Expected interval (min)</span>
            <input className="sh-input" aria-label="Expected interval" type="number" min="1" value={expectedIntervalMinutes} onChange={(e) => setExpectedIntervalMinutes(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
            <span className="sh-faint">Grace (min)</span>
            <input className="sh-input" aria-label="Grace" type="number" min="0" value={graceMinutes} onChange={(e) => setGraceMinutes(e.target.value)} />
          </label>
        </div>
      )}
      <ChannelSelect channels={channels} value={channelId} onChange={setChannelId} />
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="sh-btn primary" disabled={busy} onClick={() => void save()}>Save monitor</button>
        <button className="sh-btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ArchiveButton({ name, onArchive }: { name: string; onArchive: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`sh-iconbtn-sm${armed ? " danger" : ""}`}
      aria-label={armed ? `Confirm archive ${name}` : `Archive ${name}`}
      title={armed ? "Confirm?" : "Archive"}
      onClick={() => {
        if (armed) { onArchive(); setArmed(false); } else setArmed(true);
      }}
    >
      <Icon name={armed ? "alert" : "archive"} size={13} />
    </button>
  );
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
  onEdit,
  onArchive,
}: {
  row: MonitorRowVM;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className={`sh-row${selected ? " is-active" : ""}`}
      style={{ gridTemplateColumns: ROW_GRID, width: "100%", borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", opacity: row.enabled ? 1 : 0.6 }}
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
      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
        <button className="sh-iconbtn-sm" aria-label={`Edit ${row.name}`} title="Edit" onClick={onEdit}>
          <Icon name="edit" size={13} />
        </button>
        <ArchiveButton name={row.name} onArchive={onArchive} />
      </div>
    </div>
  );
}

export function MonitorsScreen({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const monitors = useMonitors({ client: ctx.client, projectId, environmentId, endpoint: originEndpoint() });

  const [filter, setFilter] = useState<KindFilter>("All");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
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
            <button type="button" className="sh-btn primary" onClick={() => setShowCreate((s) => !s)}>
              <Icon name="plus" size={13} />
              New monitor
            </button>
          </>
        }
      />

      <Rollup rollup={rollup} />

      {monitors.latestSecret ? <SecretBanner secret={monitors.latestSecret} onDismiss={monitors.clearSecret} /> : null}
      {showCreate ? (
        <CreatePanel
          channels={monitors.data.channels}
          busy={monitors.busy}
          onCreateHttp={monitors.createHttpMonitor}
          onCreateHeartbeat={monitors.createHeartbeatMonitor}
          onError={ctx.pushToast}
        />
      ) : null}

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
                <MonitorRow
                  row={row}
                  selected={selectedId === row.id}
                  onSelect={() => setSelectedId((cur) => (cur === row.id ? null : row.id))}
                  onEdit={() => setEditId((cur) => (cur === row.id ? null : row.id))}
                  onArchive={() =>
                    void runMutation(() => monitors.archiveMonitor(row.id), {
                      pushToast: ctx.pushToast,
                      message: "Could not archive monitor",
                    })
                  }
                />
                {editId === row.id ? (
                  <EditRow
                    row={row}
                    channels={monitors.data!.channels}
                    busy={monitors.busy}
                    onSave={async (form) => {
                      const ok = await monitors.updateMonitor(form);
                      if (ok) setEditId(null);
                      return ok;
                    }}
                    onCancel={() => setEditId(null)}
                    onError={ctx.pushToast}
                  />
                ) : selectedId === row.id ? (
                  <CheckHistory checks={checks} loading={checksLoading} />
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

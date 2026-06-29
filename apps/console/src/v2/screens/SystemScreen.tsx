import { ConfirmButton, EmptyHint, Icon, PageHead, Sparkline } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useSystemHealth } from "./useSystemHealth";
import type { QueueRowVM, ServiceCardVM, ServiceTone, SystemVM } from "./useSystemHealth";

const QUEUE_GRID = "1.4fr 70px 70px 80px 70px 70px";
const RETENTION_GRID = "1fr 56px 90px";

function toneTagClass(tone: ServiceTone): string {
  return tone === "ok" ? "ok" : tone === "critical" ? "critical" : tone === "idle" ? "solid" : "warn";
}

function toneColor(tone: ServiceTone): string {
  if (tone === "ok") return "var(--accent)";
  if (tone === "critical") return "var(--sev-critical)";
  if (tone === "idle") return "var(--fg-muted)";
  return "var(--sev-warning)";
}

function ServiceCard({ card }: { card: ServiceCardVM }) {
  const className = card.tone === "idle" ? "sh-card" : `sh-card sh-stripe ${card.tone}`;
  return (
    <div className={className} style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: toneColor(card.tone) }}>
          <Icon name={card.icon} size={16} />
        </span>
        <strong style={{ fontSize: 13 }}>{card.name}</strong>
        <span className={`sh-tag ${toneTagClass(card.tone)}`} style={{ marginLeft: "auto", fontSize: 10 }}>
          {card.statusLabel}
        </span>
      </div>
      <div className="sh-faint sh-mono" style={{ fontSize: 11, marginTop: 8 }}>
        {card.meta}
      </div>
      {card.spark ? (
        <div style={{ marginTop: 10 }}>
          <Sparkline data={card.spark} color={toneColor(card.tone)} height={28} />
        </div>
      ) : null}
    </div>
  );
}

function QueueRow({ row }: { row: QueueRowVM }) {
  return (
    <div className="sh-row" style={{ gridTemplateColumns: QUEUE_GRID }}>
      <span className="sh-mono" style={{ fontSize: 12 }}>{row.name}</span>
      <span style={{ fontSize: 12 }}>{row.waiting} wait</span>
      <span style={{ fontSize: 12, color: row.active > 0 ? "var(--accent)" : "var(--fg-muted)" }}>{row.active} act</span>
      <span className="sh-mono" style={{ fontSize: 12 }}>{row.completed}</span>
      <span style={{ fontSize: 12, color: row.failed > 0 ? "var(--sev-warning)" : "var(--fg-muted)" }}>{row.failed} fail</span>
      <span style={{ fontSize: 12, color: row.deadLettered > 0 ? "var(--sev-warning)" : "var(--fg-muted)" }}>{row.deadLettered} DLQ</span>
    </div>
  );
}

function EmptyState({ icon, title, sub }: { icon: "server" | "queue" | "archive"; title: string; sub: string }) {
  return (
    <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
      <EmptyHint icon={icon} title={title} sub={sub} />
    </div>
  );
}

export function SystemScreen({ ctx }: { ctx: ScreenCtx }) {
  const { data, status } = useSystemHealth({ client: ctx.client });

  if (status === "loading" && !data) {
    return <EmptyState icon="server" title="Loading…" sub="Fetching system health." />;
  }
  if (status === "error" || !data) {
    return <EmptyState icon="server" title="Could not load system health" sub="Check your connection or try again." />;
  }

  const { header, banner, services, queues, retention, backups }: SystemVM = data;
  const maxDeleted = Math.max(...retention.rows.map((r) => r.deleted), 1);

  return (
    <>
      <PageHead
        title="System health"
        sub="Self-monitoring for this SignalMonitor instance."
        actions={
          <>
            <span className={`sh-tag ${toneTagClass(header.statusTone)}`} style={{ fontSize: 11 }}>
              ● {header.statusLabel}
            </span>
            <button className="sh-btn" onClick={() => ctx.pushToast("Doctor is not yet available")}>
              <Icon name="shield" size={13} />
              Run doctor
            </button>
          </>
        }
      />

      {banner ? (
        <div className={`sh-card sh-stripe ${banner.tone}`} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 14 }}>
          <span style={{ color: banner.tone === "critical" ? "var(--sev-critical)" : "var(--sev-warning)" }}>
            <Icon name="alert" size={16} />
          </span>
          <div>
            <strong style={{ fontSize: 13 }}>{banner.title}</strong>
            <div className="sh-muted" style={{ fontSize: 12, marginTop: 2 }}>{banner.detail}</div>
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${services.length}, 1fr)`, gap: 12 }}>
        {services.map((c) => (
          <ServiceCard key={c.name} card={c} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 16 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Queues</h2>
          </div>
          <div style={{ flex: 1 }}>
            {queues.length === 0 ? (
              <EmptyHint icon="queue" title="No queues" sub="No background queues reported." />
            ) : (
              queues.map((row) => <QueueRow key={row.name} row={row} />)
            )}
          </div>
        </div>

        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Retention</h2>
            <span className="sh-faint" style={{ fontSize: 11 }}>{retention.subLabel}</span>
          </div>
          <div style={{ flex: 1 }}>
            {retention.rows.map((r) => (
              <div className="sh-row" key={r.label} style={{ gridTemplateColumns: RETENTION_GRID, alignItems: "center" }}>
                <span style={{ fontSize: 12 }}>{r.label}</span>
                <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>{r.retentionLabel}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="sh-mono" style={{ fontSize: 11, minWidth: 30, textAlign: "right" }}>{r.deleted}</span>
                  <span style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--bg-surface-3)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${(r.deleted / maxDeleted) * 100}%`, background: "var(--accent)" }} />
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Backups</h2>
          </div>
          <div className="sh-card__body flush" style={{ flex: 1 }}>
            {backups.latest ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--accent)" }}><Icon name="check" size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="sh-mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{backups.latest.filename}</div>
                  <div className="sh-faint" style={{ fontSize: 10.5 }}>{backups.latest.meta}</div>
                </div>
              </div>
            ) : null}
            {backups.failure ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--sev-warning)" }}><Icon name="alert" size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12 }}>Last backup failed</div>
                  <div className="sh-faint" style={{ fontSize: 10.5 }}>{backups.failure.meta}</div>
                </div>
              </div>
            ) : null}
            {!backups.latest && !backups.failure ? (
              <EmptyHint icon="archive" title="No backups yet" sub="No backup runs have been recorded." />
            ) : null}
          </div>
          <div style={{ padding: "11px 16px", borderTop: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span className="sh-faint" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{backups.subLabel}</span>
            <ConfirmButton label="Run backup now" icon="play" onConfirm={() => ctx.pushToast("Backups run on the configured schedule")} />
          </div>
        </div>
      </div>
    </>
  );
}

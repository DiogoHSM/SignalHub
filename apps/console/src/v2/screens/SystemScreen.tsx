import { useState } from "react";
import { ConfirmButton, EmptyHint, Icon, PageHead, Sparkline } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useSystemHealth } from "./useSystemHealth";
import type {
  DeadLetterDetailVM,
  DeadLetterJobVM,
  DlqVM,
  QueueRowVM,
  ServiceCardVM,
  ServiceTone,
  SystemVM,
} from "./useSystemHealth";

const QUEUE_GRID = "1.4fr 70px 70px 80px 70px 70px";
const RETENTION_GRID = "1fr 56px 90px";
const DLQ_GRID = "1fr 1fr 1.6fr 70px 190px";
const DLQ_PAYLOAD_TRUNCATE = 600;

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

function formatPayload(payload: unknown, full: boolean): { text: string; truncated: boolean } {
  const text = JSON.stringify(payload, null, 2) ?? "null";
  if (full || text.length <= DLQ_PAYLOAD_TRUNCATE) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, DLQ_PAYLOAD_TRUNCATE)}…`, truncated: true };
}

function DeadLetterRow({
  row,
  expanded,
  pending,
  detail,
  detailStatus,
  payloadFull,
  onToggle,
  onTogglePayload,
  onReplay,
  onDelete,
}: {
  row: DeadLetterJobVM;
  expanded: boolean;
  pending: boolean;
  detail: DeadLetterDetailVM | null;
  detailStatus: "loading" | "ok" | "error" | null;
  payloadFull: boolean;
  onToggle: () => void;
  onTogglePayload: () => void;
  onReplay: () => void;
  onDelete: () => void;
}) {
  const rendered = detail ? formatPayload(detail.payload, payloadFull) : null;
  return (
    <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${expanded ? "Collapse" : "Expand"} dead-letter job ${row.jobName} in ${row.queueName} (${row.ageLabel})`}
        aria-expanded={expanded}
        className="sh-row"
        style={{ gridTemplateColumns: DLQ_GRID, alignItems: "center", cursor: "pointer" }}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className="sh-mono" style={{ fontSize: 12 }}>{row.queueName}</span>
        <span className="sh-mono" style={{ fontSize: 12 }}>{row.jobName}</span>
        <span
          style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={row.errorMessage}
        >
          {row.errorMessage}
        </span>
        <span className="sh-faint" style={{ fontSize: 11 }}>{row.ageLabel}</span>
        <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
          <ConfirmButton
            label={pending ? "Replaying…" : "Replay"}
            icon="refresh"
            onConfirm={() => {
              if (!pending) onReplay();
            }}
          />
          <ConfirmButton
            label={pending ? "Deleting…" : "Delete"}
            icon="x"
            kind="ghost"
            onConfirm={() => {
              if (!pending) onDelete();
            }}
          />
        </span>
      </div>
      {expanded ? (
        <div style={{ padding: "10px 16px", background: "var(--bg-surface-2)" }}>
          {detailStatus === "loading" ? (
            <span className="sh-faint" style={{ fontSize: 12 }}>Loading job details…</span>
          ) : null}
          {detailStatus === "error" ? (
            <span className="sh-faint" style={{ fontSize: 12 }}>Could not load job details.</span>
          ) : null}
          {rendered ? (
            <>
              <pre className="sh-mono" style={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                {rendered.text}
              </pre>
              {rendered.truncated || payloadFull ? (
                <button className="sh-btn ghost" type="button" onClick={onTogglePayload} style={{ marginTop: 6 }}>
                  {payloadFull ? "Show less" : "Show full payload"}
                </button>
              ) : null}
              {detail && detail.actions.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div className="sh-faint" style={{ fontSize: 11, marginBottom: 4 }}>History</div>
                  {detail.actions.map((a) => (
                    <div key={a.id} className="sh-mono" style={{ fontSize: 11 }}>
                      {a.action} by {a.actorEmail} · {a.ageLabel}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DeadLetterQueueSection({
  dlq,
  pendingIds,
  expandedId,
  detailById,
  detailStatusById,
  payloadFullId,
  onToggle,
  onTogglePayload,
  onReplay,
  onDelete,
}: {
  dlq: DlqVM;
  pendingIds: Set<string>;
  expandedId: string | null;
  detailById: Record<string, DeadLetterDetailVM | null>;
  detailStatusById: Record<string, "loading" | "ok" | "error">;
  payloadFullId: string | null;
  onToggle: (id: string) => void;
  onTogglePayload: (id: string) => void;
  onReplay: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="sh-card__head">
        <h2 className="sh-h2">Dead-letter queue</h2>
        <span className="sh-faint" style={{ fontSize: 11 }}>{dlq.jobs.length} job(s)</span>
      </div>
      <div style={{ flex: 1 }}>
        {dlq.status === "loading" && dlq.jobs.length === 0 ? (
          <EmptyHint icon="queue" title="Loading…" sub="Fetching dead-letter jobs." />
        ) : dlq.status === "error" ? (
          <EmptyHint icon="alert" title="Could not load dead-letter jobs" sub="Check your connection or try again." />
        ) : dlq.jobs.length === 0 ? (
          <EmptyHint icon="check" title="Queue is clean" sub="No dead-letter jobs are waiting for review." />
        ) : (
          dlq.jobs.map((row) => (
            <DeadLetterRow
              key={row.id}
              row={row}
              expanded={expandedId === row.id}
              pending={pendingIds.has(row.id)}
              detail={detailById[row.id] ?? null}
              detailStatus={detailStatusById[row.id] ?? null}
              payloadFull={payloadFullId === row.id}
              onToggle={() => onToggle(row.id)}
              onTogglePayload={() => onTogglePayload(row.id)}
              onReplay={() => onReplay(row.id)}
              onDelete={() => onDelete(row.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function SystemScreen({ ctx }: { ctx: ScreenCtx }) {
  const { data, status, reload, replayDeadLetterJob, deleteDeadLetterJob, loadDeadLetterJobDetail } = useSystemHealth({
    client: ctx.client,
  });
  const [runningAction, setRunningAction] = useState<"doctor" | "backup" | "retention" | null>(null);

  const [dlqExpandedId, setDlqExpandedId] = useState<string | null>(null);
  const [dlqPendingIds, setDlqPendingIds] = useState<Set<string>>(new Set());
  const [dlqDetailById, setDlqDetailById] = useState<Record<string, DeadLetterDetailVM | null>>({});
  const [dlqDetailStatusById, setDlqDetailStatusById] = useState<Record<string, "loading" | "ok" | "error">>({});
  const [dlqPayloadFullId, setDlqPayloadFullId] = useState<string | null>(null);

  const runSystemAction = async (
    action: "doctor" | "backup" | "retention",
    run: (() => Promise<{ message: string }>) | undefined
  ) => {
    if (runningAction) return;
    if (!run) {
      ctx.pushToast("System action is not available in this deployment.");
      return;
    }
    setRunningAction(action);
    try {
      const result = await run();
      ctx.pushToast(result.message);
      reload();
    } catch {
      ctx.pushToast("System action failed. Check server logs and try again.");
    } finally {
      setRunningAction(null);
    }
  };

  const toggleDlqExpand = (id: string) => {
    if (dlqExpandedId === id) {
      setDlqExpandedId(null);
      return;
    }
    setDlqExpandedId(id);
    if (dlqDetailById[id] === undefined && dlqDetailStatusById[id] !== "loading") {
      setDlqDetailStatusById((s) => ({ ...s, [id]: "loading" }));
      void loadDeadLetterJobDetail(id).then((detail) => {
        setDlqDetailById((s) => ({ ...s, [id]: detail }));
        setDlqDetailStatusById((s) => ({ ...s, [id]: detail ? "ok" : "error" }));
      });
    }
  };

  const toggleDlqPayload = (id: string) => {
    setDlqPayloadFullId((current) => (current === id ? null : id));
  };

  const runDlqMutation = async (id: string, kind: "replay" | "delete") => {
    if (dlqPendingIds.has(id)) return;
    setDlqPendingIds((s) => new Set(s).add(id));
    const outcome = kind === "replay" ? await replayDeadLetterJob(id) : await deleteDeadLetterJob(id);
    setDlqPendingIds((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    if (outcome.ok) {
      ctx.pushToast(kind === "replay" ? "Dead-letter job re-enqueued for replay." : "Dead-letter job deleted.");
      if (kind === "delete" && dlqExpandedId === id) setDlqExpandedId(null);
    } else {
      ctx.pushToast(outcome.error);
    }
  };

  if (status === "loading" && !data) {
    return <EmptyState icon="server" title="Loading…" sub="Fetching system health." />;
  }
  if (status === "error" || !data) {
    return <EmptyState icon="server" title="Could not load system health" sub="Check your connection or try again." />;
  }

  const { header, banner, services, queues, retention, backups, dlq }: SystemVM = data;
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
            <button
              className="sh-btn"
              type="button"
              onClick={() => void runSystemAction("doctor", ctx.client.runSystemDoctor)}
            >
              <Icon name="shield" size={13} />
              {runningAction === "doctor" ? "Running…" : "Run doctor"}
            </button>
            <ConfirmButton
              label={runningAction === "retention" ? "Running…" : "Run retention"}
              icon="archive"
              kind="solid"
              onConfirm={() => void runSystemAction("retention", ctx.client.runSystemRetention)}
            />
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

      <DeadLetterQueueSection
        dlq={dlq}
        pendingIds={dlqPendingIds}
        expandedId={dlqExpandedId}
        detailById={dlqDetailById}
        detailStatusById={dlqDetailStatusById}
        payloadFullId={dlqPayloadFullId}
        onToggle={toggleDlqExpand}
        onTogglePayload={toggleDlqPayload}
        onReplay={(id) => void runDlqMutation(id, "replay")}
        onDelete={(id) => void runDlqMutation(id, "delete")}
      />

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
            <ConfirmButton
              label={runningAction === "backup" ? "Running…" : "Run backup now"}
              icon="play"
              onConfirm={() => void runSystemAction("backup", ctx.client.runSystemBackup)}
            />
          </div>
        </div>
      </div>
    </>
  );
}

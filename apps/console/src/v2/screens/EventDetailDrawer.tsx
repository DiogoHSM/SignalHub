import { Card, EmptyHint, Icon, Kv } from "../../components/ui/v2";
import { sev } from "../../components/ui/v2/status";
import { formatUtcTimestamp } from "../../components/ui/v2/format";
import type { EventRowVM } from "./useEvents";
import type { SessionTimelineRowVM, UseEventDetailResult } from "./useEventDetail";

function safeJson(value: unknown): string {
  if (value == null) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatMs(value: number | null): string {
  if (value === null) return "unknown duration";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function TimelineRow({ item }: { item: SessionTimelineRowVM }) {
  const entry = sev(item.level ?? "idle");
  return (
    <div
      className="sh-row"
      style={{ gridTemplateColumns: "90px 90px 1fr", alignItems: "start" }}
    >
      <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>
        {formatUtcTimestamp(item.timestamp).slice(11, 19)}
      </span>
      <span
        className="sh-tag"
        style={{ background: entry.bg, color: entry.color, borderColor: entry.border, textTransform: "uppercase", fontSize: 10 }}
      >
        {item.type}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="sh-mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.title}
        </div>
        {item.traceId ? (
          <div className="sh-faint" style={{ fontSize: 10.5 }}>trace {item.traceId}</div>
        ) : null}
      </div>
    </div>
  );
}

export function EventDetailDrawer({
  event,
  detail,
  onClose,
}: {
  event: EventRowVM | undefined;
  detail: UseEventDetailResult;
  onClose: () => void;
}) {
  if (!event) {
    return (
      <Card title="Event detail">
        <EmptyHint icon="activity" title="No event selected" sub="Select an event from the list to inspect it." />
      </Card>
    );
  }

  const { replay, replayStatus, timeline, timelineStatus } = detail;

  return (
    <Card
      title="Event detail"
      actions={
        <button className="sh-btn ghost" onClick={onClose} style={{ padding: "4px 8px", fontSize: 12 }}>
          <Icon name="x" size={12} />
          Close
        </button>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Kv k="Name" v={event.name} mono />
        <Kv k="Timestamp" v={formatUtcTimestamp(event.timestamp)} mono />
        <Kv k="Tenant" v={event.tenantId ?? "—"} mono />
        <Kv k="User" v={event.userId ?? "—"} mono />
        <Kv k="Session" v={event.sessionId ?? "—"} mono />
        <Kv k="Trace" v={event.traceId ?? "—"} mono />
        <Kv k="Source" v={event.source ?? "—"} />
        <Kv k="Release" v={event.release ?? "—"} mono />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="sh-eyebrow" style={{ marginBottom: 8 }}>Replay</div>
        {!event.replayId ? <p className="sh-muted" style={{ fontSize: 12 }}>No replay linked to this event.</p> : null}
        {event.replayId && replayStatus === "loading" ? (
          <p className="sh-muted" style={{ fontSize: 12 }}>Loading replay…</p>
        ) : null}
        {event.replayId && replayStatus === "error" ? (
          <p className="sh-muted" style={{ fontSize: 12 }}>Replay unavailable.</p>
        ) : null}
        {event.replayId && replayStatus === "ok" && replay ? (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
            <span>Route <strong>{replay.route ?? "unknown"}</strong></span>
            <span>Duration <strong>{formatMs(replay.durationMs)}</strong></span>
            <span>Events <strong>{replay.eventCount}</strong></span>
            <span>{replay.masked ? "Masked" : "Not masked"}</span>
          </div>
        ) : null}
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="sh-eyebrow" style={{ marginBottom: 8 }}>Session timeline</div>
        {!event.sessionId ? <p className="sh-muted" style={{ fontSize: 12 }}>No session linked to this event.</p> : null}
        {event.sessionId && timelineStatus === "loading" ? (
          <p className="sh-muted" style={{ fontSize: 12 }}>Loading session context…</p>
        ) : null}
        {event.sessionId && timelineStatus === "error" ? (
          <p className="sh-muted" style={{ fontSize: 12 }}>Session timeline unavailable.</p>
        ) : null}
        {event.sessionId && timelineStatus === "ok" && timeline.length === 0 ? (
          <p className="sh-muted" style={{ fontSize: 12 }}>No session context around this event.</p>
        ) : null}
        {event.sessionId && timelineStatus === "ok" && timeline.length > 0 ? (
          <div style={{ maxHeight: 220, overflow: "auto" }}>
            {timeline.map((item) => (
              <TimelineRow key={`${item.type}:${item.id}`} item={item} />
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div className="sh-eyebrow" style={{ marginBottom: 8 }}>Properties</div>
          <pre className="sh-code" style={{ maxHeight: 200 }}>{safeJson(event.properties)}</pre>
        </div>
        <div>
          <div className="sh-eyebrow" style={{ marginBottom: 8 }}>Metadata</div>
          <pre className="sh-code" style={{ maxHeight: 200 }}>{safeJson(event.metadata)}</pre>
        </div>
      </div>
    </Card>
  );
}

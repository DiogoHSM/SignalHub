import { useMemo, useState } from "react";
import type { ScreenCtx } from "./registry";
import { DEFAULT_EVENT_FILTERS, useEvents } from "./useEvents";
import type { EventFilterValues, EventRowVM } from "./useEvents";
import { useEventDetail } from "./useEventDetail";
import { useSegments } from "./useSegments";
import { Bars, EmptyHint, Icon, PageHead, SummaryStat } from "../../components/ui/v2";
import { formatUtcTimestamp } from "../../components/ui/v2/format";
import { EventDetailDrawer } from "./EventDetailDrawer";

const ROW_COLUMNS = "1.4fr 110px 110px 110px 110px 90px";

function EventRow({ row, isActive, onSelect }: { row: EventRowVM; isActive: boolean; onSelect: () => void }) {
  return (
    <button
      className={`sh-row sh-row--btn${isActive ? " is-active" : ""}`}
      style={{
        gridTemplateColumns: ROW_COLUMNS,
        width: "100%",
        textAlign: "left",
        background: isActive ? "var(--bg-surface-2)" : "transparent",
        border: "none",
        borderBottom: "1px solid var(--border-subtle)",
        cursor: "pointer",
      }}
      onClick={onSelect}
    >
      <div className="sh-mono" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {row.name}
      </div>
      <span className="sh-faint" style={{ fontSize: 11 }}>{row.tenantId ?? "—"}</span>
      <span className="sh-faint" style={{ fontSize: 11 }}>{row.userId ?? "—"}</span>
      <span className="sh-faint" style={{ fontSize: 11 }}>{row.sessionId ? "yes" : "—"}</span>
      <span className="sh-faint" style={{ fontSize: 11 }}>{row.replayId ? "yes" : "—"}</span>
      <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>{formatUtcTimestamp(row.timestamp).slice(11, 19)}</span>
    </button>
  );
}

export function EventsScreen({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;

  // PER-434: once navigate(section, filters) and ctx.pendingFilters("events")
  // land, seed draftFilters/appliedFilters from the pending filters here
  // instead of the static default.
  const [draftFilters, setDraftFilters] = useState<EventFilterValues>(DEFAULT_EVENT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<EventFilterValues>(DEFAULT_EVENT_FILTERS);
  const [segmentId, setSegmentId] = useState<string | undefined>(undefined);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(undefined);

  const { data, status, reload } = useEvents({
    client: ctx.client,
    projectId,
    environmentId,
    filters: appliedFilters,
    segmentId,
  });

  const segments = useSegments({ client: ctx.client, projectId, environmentId });

  const selectedEvent = useMemo(
    () => data?.rows.find((row) => row.id === selectedEventId),
    [data, selectedEventId]
  );

  const detail = useEventDetail({
    client: ctx.client,
    projectId,
    environmentId,
    event: selectedEvent,
  });

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="activity" title="No project selected" sub="Select a project and environment to explore events." />
      </div>
    );
  }

  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="activity" title="Loading…" sub="Fetching recent events." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="alert" title="Could not load events" sub="Retry this request. Your filters are preserved." cta={<button className="sh-btn" onClick={reload}>Retry events</button>} />
      </div>
    );
  }

  function updateDraft<K extends keyof EventFilterValues>(key: K, value: EventFilterValues[K]) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
  }

  function resetFilters() {
    setDraftFilters(DEFAULT_EVENT_FILTERS);
    setAppliedFilters({ ...DEFAULT_EVENT_FILTERS });
    setSegmentId(undefined);
  }

  const { summary, rows, replaySamples, replaySamplesStatus } = data;

  return (
    <>
      <PageHead
        title="Events"
        sub={
          <>
            Follow recorded activity for{" "}
            <strong style={{ color: "var(--fg)" }}>
              {ctx.project.name} · {ctx.environment.name}
            </strong>. Open an event to inspect its properties and related session or trace.
          </>
        }
        actions={
          <button className="sh-btn" onClick={reload}>
            <Icon name="refresh" size={13} />
            Refresh
          </button>
        }
      />

      {/* Toolbar */}
      <div className="sh-card">
        <div className="sh-card__body" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          <input
            className="sh-input"
            placeholder="Event name"
            value={draftFilters.eventName}
            onChange={(e) => updateDraft("eventName", e.target.value)}
          />
          <input
            className="sh-input"
            placeholder="Tenant"
            value={draftFilters.tenantId}
            onChange={(e) => updateDraft("tenantId", e.target.value)}
          />
          <input
            className="sh-input"
            placeholder="User"
            value={draftFilters.userId}
            onChange={(e) => updateDraft("userId", e.target.value)}
          />
          <input
            className="sh-input"
            placeholder="Session"
            value={draftFilters.sessionId}
            onChange={(e) => updateDraft("sessionId", e.target.value)}
          />
          <input
            className="sh-input"
            placeholder="Trace"
            value={draftFilters.traceId}
            onChange={(e) => updateDraft("traceId", e.target.value)}
          />
          <input
            className="sh-input"
            max={500}
            min={1}
            type="number"
            value={draftFilters.limit}
            onChange={(e) => updateDraft("limit", e.target.value)}
          />
          <input
            className="sh-input"
            type="datetime-local"
            value={draftFilters.from}
            onChange={(e) => updateDraft("from", e.target.value)}
          />
          <input
            className="sh-input"
            type="datetime-local"
            value={draftFilters.to}
            onChange={(e) => updateDraft("to", e.target.value)}
          />
          <select
            aria-label="Segment"
            className="sh-input"
            value={segmentId ?? ""}
            onChange={(e) => setSegmentId(e.target.value || undefined)}
          >
            <option value="">No segment</option>
            {(segments.data?.rows ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="sh-btn primary" onClick={applyFilters}>Apply</button>
            <button className="sh-btn ghost" onClick={resetFilters}>Reset</button>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="sh-card">
        <div className="sh-card__body" style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
          <SummaryStat label="Total events" value={summary.total.toLocaleString()} />
          <SummaryStat label="Event names" value={String(summary.uniqueNames)} />
          <SummaryStat label="Tenants" value={String(summary.tenants)} />
          <SummaryStat label="Known users" value={String(summary.users)} />
          <div style={{ flex: 1 }} />
          {summary.top.length > 0 ? (
            <div style={{ width: 240 }}>
              <div className="sh-eyebrow" style={{ marginBottom: 4, fontSize: 11 }}>Top event names</div>
              <Bars data={summary.top.map((t) => t.count)} height={32} />
            </div>
          ) : null}
        </div>
      </div>

      {/* List + drawer */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-row sh-row__head" style={{ gridTemplateColumns: ROW_COLUMNS }}>
            <span>Event</span>
            <span>Tenant</span>
            <span>User</span>
            <span>Session</span>
            <span>Replay</span>
            <span>Time</span>
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {rows.length === 0 ? (
              <EmptyHint icon="activity" title="No events" sub="No events match this window and filter selection. Widen the window or clear a filter; if you expected traffic, check SDK ingestion." />
            ) : (
              rows.map((row) => (
                <EventRow
                  key={row.id}
                  row={row}
                  isActive={row.id === selectedEventId}
                  onSelect={() => setSelectedEventId(row.id)}
                />
              ))
            )}
          </div>
        </div>

        <EventDetailDrawer event={selectedEvent} detail={detail} onClose={() => setSelectedEventId(undefined)} />
      </div>

      {/* Replay samples */}
      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Replay samples</h2>
          <span className="sh-tag">{replaySamples.length}</span>
        </div>
        <div className="sh-card__body flush">
          {replaySamplesStatus === "error" ? (
            <EmptyHint icon="eye" title="Replay samples unavailable" sub="This client cannot load replay samples." />
          ) : replaySamples.length === 0 ? (
            <EmptyHint
              icon="eye"
              title="No replay samples"
              sub={segmentId ? "No replays for the active segment and current filters." : "No replay samples for the current filters."}
            />
          ) : (
            replaySamples.map((sample) => (
              <div key={sample.id} className="sh-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
                <span className="sh-mono" style={{ fontSize: 12 }}>{sample.replayId}</span>
                <span className="sh-faint" style={{ fontSize: 11.5 }}>{sample.route ?? "unknown route"}</span>
                <span className="sh-faint" style={{ fontSize: 11.5 }}>{sample.userId ?? "anonymous"}</span>
                <span className="sh-faint" style={{ fontSize: 11.5 }}>{sample.linkedEventName ?? sample.linkedErrorMessage ?? "—"}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

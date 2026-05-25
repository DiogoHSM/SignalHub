import type { EntitySignalType, TenantDetailResponse, TenantSummary, TenantTimelineRow } from "../api/types";

type Props = {
  tenant?: TenantSummary;
  detail?: TenantDetailResponse;
  draftUserId: string;
  appliedUserId: string;
  signalType: EntitySignalType | "";
  loading: boolean;
  error: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  onDraftUserIdChange: (value: string) => void;
  onApplyUser: () => void;
  onSignalTypeChange: (value: EntitySignalType | "") => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onTimelineDrilldown: (row: TenantTimelineRow) => void;
};

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "none";
}

function formatCurrency(value: string): string {
  return `$${value}`;
}

function timelineMeta(row: TenantTimelineRow): string {
  const context = [row.userId, row.sessionId, row.traceId].filter(Boolean).join(" / ");
  if (row.type === "event") return `${row.eventName}${context ? ` - ${context}` : ""}`;
  if (row.type === "error") return `${row.severity} ${row.status}${context ? ` - ${context}` : ""}`;
  if (row.type === "trace") return `${row.status}${row.durationMs === null ? "" : ` - ${row.durationMs}ms`}${context ? ` - ${context}` : ""}`;
  return `${row.provider} ${row.model} ${row.status} ${formatCurrency(row.costUsd)}${context ? ` - ${context}` : ""}`;
}

export function EntitiesTenantDetail({
  tenant,
  detail,
  draftUserId,
  appliedUserId,
  signalType,
  loading,
  error,
  loadingMore,
  loadMoreError,
  onDraftUserIdChange,
  onApplyUser,
  onSignalTypeChange,
  onRetry,
  onLoadMore,
  onTimelineDrilldown
}: Props) {
  const summary = detail?.tenant ?? tenant;
  const keyTraits = summary?.keyTraits ?? {};

  return (
    <div className="panel entity-detail">
      <div className="panel-header">
        <h2>{summary ? summary.label : "Tenant detail"}</h2>
        {summary?.tenantId ? <code>{summary.tenantId}</code> : null}
      </div>
      {!summary ? <p className="muted-text">Select a tenant to inspect recent activity.</p> : null}
      {summary ? (
        <>
          {Object.keys(keyTraits).length > 0 ? (
            <div className="trait-chips">
              {Object.entries(keyTraits).map(([key, value]) => (
                <span className="trait-chip" key={key}>
                  {key}: {value}
                </span>
              ))}
            </div>
          ) : null}
          <div className="entity-detail-filters">
            <label>
              User
              <input value={draftUserId} onChange={(event) => onDraftUserIdChange(event.target.value)} />
            </label>
            <div className="filter-actions">
              <button onClick={onApplyUser} type="button">
                Apply
              </button>
            </div>
            <label>
              Signal
              <select value={signalType} onChange={(event) => onSignalTypeChange(event.target.value as EntitySignalType | "")}>
                <option value="">All signals</option>
                <option value="event">Events</option>
                <option value="error">Errors</option>
                <option value="trace">Traces</option>
                <option value="llm">LLM</option>
              </select>
            </label>
          </div>
          {appliedUserId ? <p className="muted-text">Filtered to user {appliedUserId}</p> : null}
          <div className="entity-summary-grid">
            <div>
              <span>Events</span>
              <strong>{summary.events}</strong>
            </div>
            <div>
              <span>Errors</span>
              <strong>{summary.errors}</strong>
            </div>
            <div>
              <span>Failed traces</span>
              <strong>{summary.failedTraces}</strong>
            </div>
            <div>
              <span>LLM calls</span>
              <strong>{summary.llmCalls}</strong>
            </div>
            <div>
              <span>LLM cost</span>
              <strong>{formatCurrency(summary.llmCostUsd)}</strong>
            </div>
            <div>
              <span>Active users</span>
              <strong>{summary.activeUsers}</strong>
            </div>
            <div>
              <span>Active sessions</span>
              <strong>{summary.activeSessions}</strong>
            </div>
            <div>
              <span>Last seen</span>
              <strong>{formatTimestamp(summary.lastSeenAt)}</strong>
            </div>
          </div>
        </>
      ) : null}
      {loading ? <p className="muted-text">Loading tenant detail</p> : null}
      {error ? (
        <div className="status-box unavailable">
          <strong>Tenant detail is unavailable.</strong>
          <button onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {detail && !loading && !error ? (
        <>
          <div className="entity-table-wrap">
            <table className="entity-top-users">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Events</th>
                  <th>Errors</th>
                  <th>Traces</th>
                  <th>LLM</th>
                  <th>Cost</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {detail.topUsers.map((user) => (
                  <tr key={user.userId}>
                    <td>{user.userId}</td>
                    <td>{user.events}</td>
                    <td>{user.errors}</td>
                    <td>{user.traces}</td>
                    <td>{user.llmCalls}</td>
                    <td>{formatCurrency(user.llmCostUsd)}</td>
                    <td>{formatTimestamp(user.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="entity-timeline" aria-label="Tenant timeline">
            {detail.timeline.length === 0 ? <p className="muted-text">No timeline rows match the current filters.</p> : null}
            {detail.timeline.map((row) => (
              <button className="entity-timeline-row" key={`${row.type}:${row.id}`} onClick={() => onTimelineDrilldown(row)} type="button">
                <span>
                  <strong>{row.label}</strong>
                  <code>{row.type}</code>
                </span>
                <span>{formatTimestamp(row.timestamp)}</span>
                <span>{timelineMeta(row)}</span>
              </button>
            ))}
            {loadMoreError ? <p className="muted-text">More timeline rows are unavailable.</p> : null}
            {detail.cursor ? (
              <div className="filter-actions">
                <button disabled={loadingMore} onClick={onLoadMore} type="button">
                  {loadingMore ? "Loading more" : "Load more"}
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

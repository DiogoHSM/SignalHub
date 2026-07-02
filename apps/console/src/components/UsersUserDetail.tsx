import type { UserDetailResponse, UserSignalType, UserSummary, UserTimelineRow } from "../api/types";
import { EntityOperationalProfile, TimelineSignalMix } from "./EntityOperationalSummary";
import { IdentityProfilePanel } from "./IdentityProfilePanel";

type Props = {
  user?: UserSummary;
  detail?: UserDetailResponse;
  draftTenantId: string;
  appliedTenantId: string;
  signalType: UserSignalType | "";
  loading: boolean;
  error: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  onDraftTenantIdChange: (value: string) => void;
  onApplyTenant: () => void;
  onSignalTypeChange: (value: UserSignalType | "") => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onTimelineDrilldown: (row: UserTimelineRow) => void;
};

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "none";
}

function formatCurrency(value: string): string {
  return `$${value}`;
}

function timelineMeta(row: UserTimelineRow): string {
  const context = [row.tenantId, row.sessionId, row.traceId].filter(Boolean).join(" / ");
  if (row.type === "event") return `${row.eventName}${context ? ` - ${context}` : ""}`;
  if (row.type === "error") return `${row.severity} ${row.status}${context ? ` - ${context}` : ""}`;
  if (row.type === "trace") return `${row.status}${row.durationMs === null ? "" : ` - ${row.durationMs}ms`}${context ? ` - ${context}` : ""}`;
  return `${row.provider} ${row.model} ${row.status} ${formatCurrency(row.costUsd)}${context ? ` - ${context}` : ""}`;
}

export function UsersUserDetail({
  user,
  detail,
  draftTenantId,
  appliedTenantId,
  signalType,
  loading,
  error,
  loadingMore,
  loadMoreError,
  onDraftTenantIdChange,
  onApplyTenant,
  onSignalTypeChange,
  onRetry,
  onLoadMore,
  onTimelineDrilldown
}: Props) {
  const summary = detail?.user ?? user;

  return (
    <div className="panel user-detail">
      <div className="panel-header">
        <h2>{summary ? summary.label : "User detail"}</h2>
        {summary?.userId ? <code>{summary.userId}</code> : null}
      </div>
      {!summary ? <p className="muted-text">Select a user to inspect recent activity.</p> : null}
      {summary ? (
        <>
          {Object.keys(summary.keyTraits).length > 0 ? (
            <div className="trait-chips">
              {Object.entries(summary.keyTraits).map(([key, value]) => (
                <span className="trait-chip" key={key}>
                  {key}: {value}
                </span>
              ))}
            </div>
          ) : null}
          <div className="entity-detail-filters">
            <label>
              Tenant
              <input value={draftTenantId} onChange={(event) => onDraftTenantIdChange(event.target.value)} />
            </label>
            <div className="filter-actions">
              <button onClick={onApplyTenant} type="button">
                Apply
              </button>
            </div>
            <label>
              Signal
              <select value={signalType} onChange={(event) => onSignalTypeChange(event.target.value as UserSignalType | "")}>
                <option value="">All signals</option>
                <option value="event">Events</option>
                <option value="error">Errors</option>
                <option value="trace">Traces</option>
                <option value="llm">LLM</option>
              </select>
            </label>
          </div>
          {appliedTenantId ? <p className="muted-text">Filtered to tenant {appliedTenantId}</p> : null}
          <IdentityProfilePanel
            firstSeenAt={summary.firstSeenAt}
            kind="user"
            lastSeenAt={summary.lastSeenAt}
            profileUpdatedAt={summary.profileUpdatedAt}
            traits={summary.traits}
          />
          <EntityOperationalProfile label="User operational profile" summary={summary} />
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
              <span>Active tenants</span>
              <strong>{summary.activeTenants}</strong>
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
      {loading ? <p className="muted-text">Loading user detail</p> : null}
      {error ? (
        <div className="status-box unavailable">
          <strong>User detail is unavailable.</strong>
          <button onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {detail && !loading && !error ? (
        <>
          <div className="entity-table-wrap">
            <table className="user-recent-sessions">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Tenant</th>
                  <th>Events</th>
                  <th>Errors</th>
                  <th>Traces</th>
                  <th>LLM</th>
                  <th>Cost</th>
                  <th>First seen</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {detail.recentSessions.map((session) => (
                  <tr key={session.sessionId}>
                    <td>{session.sessionId}</td>
                    <td>{session.tenantId ?? "Unassigned"}</td>
                    <td>{session.events}</td>
                    <td>{session.errors}</td>
                    <td>{session.traces}</td>
                    <td>{session.llmCalls}</td>
                    <td>{formatCurrency(session.llmCostUsd)}</td>
                    <td>{formatTimestamp(session.firstSeenAt)}</td>
                    <td>{formatTimestamp(session.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="user-timeline" aria-label="User timeline">
            <TimelineSignalMix label="User timeline signal mix" rows={detail.timeline} />
            {detail.timeline.length === 0 ? <p className="muted-text">No timeline rows match the current filters.</p> : null}
            {detail.timeline.map((row) => (
              <button className="user-timeline-row" key={`${row.type}:${row.id}`} onClick={() => onTimelineDrilldown(row)} type="button">
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

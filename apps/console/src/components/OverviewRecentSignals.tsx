import type { OverviewResponse, RecentActivityItem } from "../api/types";

type Props = {
  recent: OverviewResponse["recent"];
};

function formatMeta(parts: Array<string | number | null | undefined>): string {
  return parts.filter((part) => part !== null && part !== undefined && part !== "").join(" / ");
}

function currency(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 2, style: "currency" }).format(parsed);
}

function legacyActivity(recent: OverviewResponse["recent"]): RecentActivityItem[] {
  if (recent.activity) {
    return recent.activity;
  }

  return [
    ...recent.errors.map((error): RecentActivityItem => ({
      id: error.id,
      type: "error",
      timestamp: error.timestamp,
      title: error.message,
      status: error.status,
      severity: error.severity,
      tenantId: error.tenantId,
      userId: error.userId,
      sessionId: null,
      traceId: error.traceId,
      durationMs: null,
      costUsd: null
    })),
    ...recent.failedTraces.map((trace): RecentActivityItem => ({
      id: trace.id,
      type: "trace",
      timestamp: trace.timestamp,
      title: trace.name,
      status: trace.status,
      severity: null,
      tenantId: trace.tenantId,
      userId: trace.userId,
      sessionId: null,
      traceId: trace.id,
      durationMs: trace.durationMs,
      costUsd: null
    })),
    ...recent.failedLlmCalls.map((call): RecentActivityItem => ({
      id: call.id,
      type: "llm",
      timestamp: call.timestamp,
      title: formatMeta([call.provider, call.model]),
      status: call.status,
      severity: null,
      tenantId: call.tenantId,
      userId: call.userId,
      sessionId: null,
      traceId: call.traceId,
      durationMs: null,
      costUsd: call.costUsd
    }))
  ].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function activityMeta(item: RecentActivityItem): string {
  return formatMeta([
    item.status,
    item.severity,
    item.durationMs === null ? null : `${item.durationMs} ms`,
    item.costUsd === null ? null : currency(item.costUsd),
    item.tenantId,
    item.userId,
    item.traceId
  ]);
}

export function OverviewRecentSignals({ recent }: Props) {
  const activity = legacyActivity(recent);

  return (
    <section className="overview-recent" aria-label="Overview recent signals">
      <article className="overview-recent-list overview-recent-list--wide">
        <h3>Recent activity</h3>
        {activity.length === 0 ? <p className="muted-text">No recent activity in this window.</p> : null}
        {activity.map((item) => (
          <div className={`overview-recent-row overview-recent-row--${item.type}`} key={`${item.type}:${item.id}`}>
            <span className="overview-recent-row__type">{item.type}</span>
            <strong>{item.title}</strong>
            <span>{activityMeta(item)}</span>
          </div>
        ))}
      </article>
    </section>
  );
}

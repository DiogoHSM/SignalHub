import type { OverviewResponse } from "../api/types";

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

export function OverviewRecentSignals({ recent }: Props) {
  return (
    <section className="overview-recent" aria-label="Overview recent signals">
      <article className="overview-recent-list">
        <h3>Recent errors</h3>
        {recent.errors.length === 0 ? <p className="muted-text">No recent errors.</p> : null}
        {recent.errors.map((error) => (
          <div className="overview-recent-row" key={error.id}>
            <strong>{error.message}</strong>
            <span>{formatMeta([error.severity, error.status, error.tenantId, error.traceId])}</span>
          </div>
        ))}
      </article>
      <article className="overview-recent-list">
        <h3>Failed traces</h3>
        {recent.failedTraces.length === 0 ? <p className="muted-text">No failed traces.</p> : null}
        {recent.failedTraces.map((trace) => (
          <div className="overview-recent-row" key={trace.id}>
            <strong>{trace.name}</strong>
            <span>{formatMeta([trace.status, trace.durationMs === null ? null : `${trace.durationMs} ms`, trace.tenantId, trace.userId])}</span>
          </div>
        ))}
      </article>
      <article className="overview-recent-list">
        <h3>Failed LLM calls</h3>
        {recent.failedLlmCalls.length === 0 ? <p className="muted-text">No failed LLM calls.</p> : null}
        {recent.failedLlmCalls.map((call) => (
          <div className="overview-recent-row" key={call.id}>
            <strong>{formatMeta([call.provider, call.model])}</strong>
            <span>{formatMeta([call.promptName, call.status, currency(call.costUsd), call.tenantId])}</span>
          </div>
        ))}
      </article>
    </section>
  );
}

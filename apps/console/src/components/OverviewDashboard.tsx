import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { OverviewRecentError, OverviewResponse, OverviewWindow } from "../api/types";
import { OverviewKpiGrid } from "./OverviewKpiGrid";
import { OverviewMiniTrends } from "./OverviewMiniTrends";
import { OverviewRecentSignals } from "./OverviewRecentSignals";
import { OverviewTopLists } from "./OverviewTopLists";

export type OverviewDrilldown =
  | { tab: "events"; filters: { eventName?: string; tenantId?: string } }
  | { tab: "errors"; filters: { severity?: string; status?: string; tenantId?: string } }
  | { tab: "llm"; filters: { provider?: string; model?: string; promptName?: string; tenantId?: string } }
  | { tab: "entities"; filters: { tenantId: string } };

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
  onDrilldown: (drilldown: OverviewDrilldown) => void;
};

type LoadState = "loading" | "ready" | "unavailable";

const windows: OverviewWindow[] = ["24h", "7d", "30d"];
const kpiPlaceholderCount = 11;
const topListPlaceholderCount = 10;
const recentPlaceholderCount = 3;
const severeErrorRank = new Map([
  ["fatal", 5],
  ["critical", 4],
  ["error", 3],
  ["warning", 2],
  ["warn", 2],
  ["info", 1],
  ["debug", 0]
]);

function isEmptyish(data: OverviewResponse): boolean {
  return data.kpis.events === 0 && data.kpis.errors === 0 && data.kpis.traces === 0 && data.kpis.llmCalls === 0;
}

function severityRank(severity: string): number {
  return severeErrorRank.get(severity.toLowerCase()) ?? 0;
}

function findCriticalIncident(data: OverviewResponse): OverviewRecentError | undefined {
  return data.recent.errors
    .filter((error) => error.status !== "resolved" && error.status !== "ignored" && severityRank(error.severity) >= severityRank("error"))
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity))[0];
}

function OverviewLoadingLayout() {
  return (
    <>
      <section className="overview-kpis overview-loading-grid" aria-label="Overview KPIs">
        {Array.from({ length: kpiPlaceholderCount }, (_, index) => (
          <article className="overview-kpi overview-placeholder" key={index}>
            <span />
            <strong />
          </article>
        ))}
      </section>
      <section className="overview-trends overview-loading-grid" aria-label="Overview trends">
        {Array.from({ length: 4 }, (_, index) => (
          <article className="overview-trend overview-placeholder" key={index}>
            <span />
            <svg aria-hidden="true" focusable="false" viewBox="0 0 100 40" preserveAspectRatio="none">
              <polyline fill="none" points="0,34 50,20 100,28" stroke="currentColor" strokeWidth="2" />
            </svg>
          </article>
        ))}
      </section>
      <section className="overview-lists overview-loading-grid" aria-label="Overview top lists">
        {Array.from({ length: topListPlaceholderCount }, (_, index) => (
          <article className="overview-list overview-placeholder" key={index}>
            <span />
            <span />
            <span />
          </article>
        ))}
      </section>
      <section className="overview-recent overview-loading-grid" aria-label="Overview recent signals">
        {Array.from({ length: recentPlaceholderCount }, (_, index) => (
          <article className="overview-recent-list overview-placeholder" key={index}>
            <span />
            <span />
            <span />
          </article>
        ))}
      </section>
    </>
  );
}

function OverviewIncidentBanner({
  error,
  onDrilldown
}: {
  error: OverviewRecentError;
  onDrilldown: (drilldown: OverviewDrilldown) => void;
}) {
  return (
    <section aria-label="Critical incident" className="overview-incident-banner">
      <div>
        <span className="section-label">Critical incident active</span>
        <strong>{error.message}</strong>
        <p>
          Latest severe open error in this environment. Review the grouped incident queue before it becomes background
          noise.
        </p>
      </div>
      <div className="overview-incident-banner__meta">
        <span className="pill active">{error.severity}</span>
        <span className="pill">{error.status}</span>
        {error.tenantId ? <span className="pill">Tenant {error.tenantId}</span> : null}
        <button
          onClick={() => onDrilldown({ tab: "errors", filters: { severity: error.severity, status: error.status } })}
          type="button"
        >
          Open incident queue
        </button>
      </div>
    </section>
  );
}

export function OverviewDashboard({ client, projectId, environmentId, onDrilldown }: Props) {
  const [window, setWindow] = useState<OverviewWindow>("24h");
  const [reloadToken, setReloadToken] = useState(0);
  const [data, setData] = useState<OverviewResponse | undefined>();
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    if (!projectId || !environmentId) return;

    let cancelled = false;
    setState("loading");

    void Promise.resolve(client.getOverview({ projectId, environmentId, window })).then(
      (result) => {
        if (cancelled) return;
        if (!result) {
          setData(undefined);
          setState("unavailable");
          return;
        }
        setData(result.data);
        setState("ready");
      },
      () => {
        if (cancelled) return;
        setData(undefined);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, reloadToken, window]);

  function retry() {
    setReloadToken((current) => current + 1);
  }

  if (!projectId || !environmentId) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Overview</h2>
        </div>
        <p className="muted-text">Select a project and environment in Setup to view the overview.</p>
      </section>
    );
  }

  const criticalIncident = data ? findCriticalIncident(data) : undefined;

  return (
    <section className="overview-dashboard">
      <div className="overview-controls">
        <div>
          <h2>Overview</h2>
          <p className="muted-text">Read-only operational summary for the selected environment.</p>
        </div>
        <div className="overview-window-tabs" aria-label="Overview window">
          {windows.map((item) => (
            <button aria-pressed={window === item} key={item} onClick={() => setWindow(item)} type="button">
              {item}
            </button>
          ))}
        </div>
      </div>

      {state === "loading" ? (
        <>
          <p className="muted-text">Loading overview</p>
          <OverviewLoadingLayout />
        </>
      ) : null}
      {state === "unavailable" ? (
        <div className="status-box unavailable">
          <strong>Overview unavailable</strong>
          <button onClick={retry} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {state === "ready" && data ? (
        <>
          {isEmptyish(data) ? (
            <div className="status-box empty">
              <strong>No overview activity in this window</strong>
            </div>
          ) : null}
          {criticalIncident ? <OverviewIncidentBanner error={criticalIncident} onDrilldown={onDrilldown} /> : null}
          <OverviewKpiGrid kpis={data.kpis} />
          <OverviewMiniTrends trends={data.trends} />
          <OverviewTopLists onDrilldown={onDrilldown} top={data.top} />
          <OverviewRecentSignals recent={data.recent} />
        </>
      ) : null}
    </section>
  );
}

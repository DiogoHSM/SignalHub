import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { OverviewResponse, OverviewWindow } from "../api/types";
import { OverviewKpiGrid } from "./OverviewKpiGrid";
import { OverviewMiniTrends } from "./OverviewMiniTrends";
import { OverviewRecentSignals } from "./OverviewRecentSignals";
import { OverviewTopLists } from "./OverviewTopLists";

export type OverviewDrilldown =
  | { tab: "events"; filters: { eventName?: string; tenantId?: string } }
  | { tab: "errors"; filters: { severity?: string; status?: string; tenantId?: string } }
  | { tab: "llm"; filters: { provider?: string; model?: string; promptName?: string; tenantId?: string } };

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
  onDrilldown: (drilldown: OverviewDrilldown) => void;
};

type LoadState = "loading" | "ready" | "unavailable";

const windows: OverviewWindow[] = ["24h", "7d", "30d"];

function isEmptyish(data: OverviewResponse): boolean {
  return data.kpis.events === 0 && data.kpis.errors === 0 && data.kpis.traces === 0 && data.kpis.llmCalls === 0;
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

    void client.getOverview({ projectId, environmentId, window }).then(
      ({ data: response }) => {
        if (cancelled) return;
        setData(response);
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

      {state === "loading" ? <p className="muted-text">Loading overview</p> : null}
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
          <OverviewKpiGrid kpis={data.kpis} />
          <OverviewMiniTrends trends={data.trends} />
          <OverviewTopLists onDrilldown={onDrilldown} top={data.top} />
          <OverviewRecentSignals recent={data.recent} />
        </>
      ) : null}
    </section>
  );
}

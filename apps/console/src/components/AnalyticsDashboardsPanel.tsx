import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { AnalyticsDashboard, AnalyticsDashboardCategory, ApmWindow, DashboardReportResponse } from "../api/types";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";

const starterWidgets = [
  { type: "metric.events" as const, title: "Events", width: "half" as const, options: {} },
  { type: "metric.errors" as const, title: "Errors", width: "half" as const, options: {} },
  { type: "trend.events" as const, title: "Event trend", width: "full" as const, options: {} },
  { type: "trend.errors" as const, title: "Error trend", width: "full" as const, options: {} },
  { type: "top.events" as const, title: "Top events", width: "full" as const, options: {} }
];

function metricValue(data: unknown, key: "value" | "open" = "value"): string {
  if (!data || typeof data !== "object" || !(key in data)) return "0";
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "number" ? value.toLocaleString() : String(value ?? "0");
}

function rowsValue(data: unknown): Array<{ name: string; total: number }> {
  if (!data || typeof data !== "object" || !Array.isArray((data as { rows?: unknown }).rows)) return [];
  return (data as { rows: Array<{ name: string; total: number }> }).rows;
}

function trendTotal(data: unknown): number {
  if (!data || typeof data !== "object" || !Array.isArray((data as { series?: unknown }).series)) return 0;
  return (data as { series: Array<{ values: number[] }> }).series.reduce(
    (total, series) => total + series.values.reduce((sum, value) => sum + value, 0),
    0
  );
}

export function AnalyticsDashboardsPanel({ client, projectId, environmentId }: Props) {
  const [dashboards, setDashboards] = useState<AnalyticsDashboard[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [report, setReport] = useState<DashboardReportResponse | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [reportState, setReportState] = useState<LoadState>("loading");
  const [name, setName] = useState("Operations report");
  const [category, setCategory] = useState<AnalyticsDashboardCategory>("operational");
  const [window, setWindow] = useState<ApmWindow>("7d");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!client.listAnalyticsDashboards) {
      setState("unavailable");
      return;
    }
    setState("loading");
    void client.listAnalyticsDashboards({ projectId, environmentId }).then(
      ({ dashboards: rows }) => {
        if (cancelled) return;
        setDashboards(rows);
        setSelectedId((current) => current ?? rows[0]?.id);
        setState(rows.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setState("unavailable");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedId || !client.getDashboardReport) {
      setReport(null);
      setReportState(selectedId ? "unavailable" : "empty");
      return;
    }
    setReportState("loading");
    void client.getDashboardReport(selectedId, { projectId, environmentId, window }).then(
      ({ data }) => {
        if (cancelled) return;
        setReport(data);
        setReportState("ready");
      },
      () => {
        if (cancelled) return;
        setReport(null);
        setReportState("unavailable");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId, selectedId, window]);

  async function createDashboard() {
    if (!client.createAnalyticsDashboard) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Dashboard name is required.");
      return;
    }
    setError(null);
    try {
      const { dashboard } = await client.createAnalyticsDashboard({
        projectId,
        environmentId,
        name: trimmed,
        category,
        filters: { window },
        widgets: starterWidgets
      });
      setDashboards((current) => [dashboard, ...current]);
      setSelectedId(dashboard.id);
      setState("ready");
    } catch {
      setError("Could not create dashboard.");
    }
  }

  async function archiveSelected() {
    if (!selectedId || !client.archiveAnalyticsDashboard) return;
    try {
      await client.archiveAnalyticsDashboard(selectedId, { projectId, environmentId });
      const nextDashboards = dashboards.filter((dashboard) => dashboard.id !== selectedId);
      setDashboards(nextDashboards);
      setSelectedId(nextDashboards[0]?.id);
      setState(nextDashboards.length > 0 ? "ready" : "empty");
    } catch {
      setError("Could not archive dashboard.");
    }
  }

  if (state === "unavailable") {
    return <p className="muted-text">Custom dashboards unavailable.</p>;
  }

  return (
    <section className="analytics-dashboards" aria-label="Custom dashboards">
      <div className="analytics-dashboards__sidebar">
        <div className="analytics-dashboards__header">
          <h3>Dashboards</h3>
          <span>{dashboards.length}</span>
        </div>
        {state === "loading" ? <p className="muted-text">Loading dashboards</p> : null}
        {state === "empty" ? <p className="muted-text">No saved dashboards yet.</p> : null}
        {dashboards.map((dashboard) => (
          <button
            aria-pressed={dashboard.id === selectedId}
            className="analytics-dashboard-row"
            key={dashboard.id}
            onClick={() => {
              setSelectedId(dashboard.id);
              setWindow(dashboard.filters.window ?? "7d");
            }}
            type="button"
          >
            <strong>{dashboard.name}</strong>
            <small>{dashboard.category} · {dashboard.widgets.length} widgets</small>
          </button>
        ))}
        <div className="analytics-dashboard-form">
          <label>
            Dashboard name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value as AnalyticsDashboardCategory)}>
              <option value="operational">Operational</option>
              <option value="executive">Executive</option>
              <option value="product">Product</option>
            </select>
          </label>
          <button onClick={() => void createDashboard()} type="button">Create dashboard</button>
          {error ? <p className="analytics-dashboard-error">{error}</p> : null}
        </div>
      </div>
      <div className="analytics-dashboard-report">
        <div className="analytics-dashboards__header">
          <div>
            <h3>{report?.dashboard.name ?? "Report"}</h3>
            <p>{report ? `${report.dashboard.category} · generated ${new Date(report.generatedAt).toLocaleString()}` : "Select a dashboard to render report data."}</p>
          </div>
          <div className="analytics-dashboard-actions">
            <select aria-label="Dashboard window" value={window} onChange={(event) => setWindow(event.target.value as ApmWindow)}>
              <option value="24h">24h</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
            </select>
            {selectedId ? <button onClick={() => void archiveSelected()} type="button">Archive</button> : null}
          </div>
        </div>
        {reportState === "loading" ? <p className="muted-text">Rendering report</p> : null}
        {reportState === "empty" ? <p className="muted-text">Create or select a dashboard.</p> : null}
        {reportState === "unavailable" ? <p className="analytics-dashboard-error">Could not render this dashboard.</p> : null}
        {report ? (
          <div className="analytics-dashboard-widget-grid">
            {report.widgets.map((widget) => (
              <article className={`analytics-dashboard-widget is-${widget.width}`} key={widget.widgetId}>
                <h4>{widget.title}</h4>
                {widget.type === "metric.events" ? <strong>{metricValue(widget.data)}</strong> : null}
                {widget.type === "metric.errors" ? (
                  <strong>{metricValue(widget.data)} <small>{metricValue(widget.data, "open")} open</small></strong>
                ) : null}
                {widget.type === "top.events" ? (
                  <ol>
                    {rowsValue(widget.data).slice(0, 5).map((row) => (
                      <li key={row.name}><span>{row.name}</span><strong>{row.total}</strong></li>
                    ))}
                  </ol>
                ) : null}
                {widget.type.startsWith("trend.") ? <strong>{trendTotal(widget.data).toLocaleString()} total</strong> : null}
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { AnalyticsDashboard, AnalyticsDashboardWidget, DashboardReportWidget } from "../../../api/types";
import { ConfirmButton, EmptyHint, Icon, Sparkline } from "../../../components/ui/v2";
import type { ScreenCtx } from "../registry";
import {
  dashboardToForm,
  EMPTY_DASHBOARD_FORM,
  newInsightWidget,
  useAnalyticsDashboards,
  validateDashboardForm,
  type DashboardForm,
  type DashboardWidgetDraft,
} from "./useAnalyticsDashboards";

const LEGACY_TYPES = new Set(["metric.events", "metric.errors", "top.events", "trend.events", "trend.errors"]);
const SERIES_COLORS = [
  "var(--accent)",
  "var(--viz-series-blue)",
  "var(--viz-series-violet)",
  "var(--viz-series-orange)"
];

function insightId(widget: DashboardWidgetDraft): string | null {
  return typeof widget.options.insightId === "string" ? widget.options.insightId : null;
}

function move<T>(rows: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ReportWidget({ widget }: { widget: DashboardReportWidget }) {
  if (widget.status === "error") {
    return <EmptyHint icon="alert" title={widget.title} sub={widget.error || "This widget could not be calculated."} />;
  }
  const data = widget.data && typeof widget.data === "object" ? widget.data as Record<string, unknown> : {};
  const value = numeric(data.value);
  const rows = Array.isArray(data.rows) ? data.rows as Array<Record<string, unknown>> : [];
  const buckets = Array.isArray(data.buckets) ? data.buckets : [];
  const series = Array.isArray(data.series) ? data.series as Array<Record<string, unknown>> : [];
  if (value !== null) {
    return <div><div className="sh-faint sh-copy-11">{String(data.label ?? widget.title)}</div><strong className="sh-copy-28-strong">{value.toLocaleString()}</strong>{numeric(data.open) !== null ? <div className="sh-muted sh-copy-11">{numeric(data.open)} open</div> : null}</div>;
  }
  if (series.length > 0) {
    return <div className="dashboard-report-stack">{series.map((item, index) => {
      const values = Array.isArray(item.values) ? item.values.filter((entry): entry is number => typeof entry === "number") : [];
      return <div key={`${String(item.key ?? item.label ?? index)}`}><div className="dashboard-report-head"><span>{String(item.label ?? item.key ?? "Series")}</span><strong>{values.reduce((sum, entry) => sum + entry, 0).toLocaleString()}</strong></div><Sparkline data={values.length ? values : [0]} color={SERIES_COLORS[index % SERIES_COLORS.length]} height={52} /></div>;
    })}<span className="sh-faint sh-copy-10">{buckets.length} buckets</span></div>;
  }
  if (rows.length > 0) {
    return <div className="dashboard-report-rows">{rows.slice(0, 6).map((row, index) => <div key={index} className="dashboard-report-row"><span>{String(row.name ?? row.label ?? "Item")}</span><strong>{String(row.total ?? row.value ?? "")}</strong></div>)}</div>;
  }
  return <EmptyHint icon="pulse" title={widget.title} sub="No activity in this window." />;
}

function WidgetEditor({ widget, index, count, insightName, onChange, onMove, onRemove }: {
  widget: DashboardWidgetDraft; index: number; count: number; insightName: string | null;
  onChange: (next: DashboardWidgetDraft) => void; onMove: (delta: -1 | 1) => void; onRemove: () => void;
}) {
  const legacy = LEGACY_TYPES.has(widget.type);
  return <div className="sh-row dashboard-widget-editor">
    <div className="sh-min-w-0">
      {legacy ? <><strong className="sh-copy-12">{widget.title}</strong><div className="sh-faint sh-copy-10">Legacy widget · {widget.type} · preserved read-only</div></> : <><input aria-label={`Widget ${index + 1} title`} className="sh-input" value={widget.title} onChange={(event) => onChange({ ...widget, title: event.target.value })} /><div className="sh-faint sh-copy-10 sh-mt-3">Saved insight: {insightName ?? "Unavailable insight"}</div></>}
    </div>
    {legacy ? <span className="sh-tag">{widget.width}</span> : <select aria-label={`Widget ${index + 1} width`} className="sh-input" value={widget.width} onChange={(event) => onChange({ ...widget, width: event.target.value as "half" | "full" })}><option value="half">Half width</option><option value="full">Full width</option></select>}
    <div className="dashboard-widget-actions">
      <button aria-label={`Move widget ${index + 1} up`} className="sh-btn ghost icon" disabled={index === 0} type="button" onClick={() => onMove(-1)}><Icon name="chevu" size={13} /></button>
      <button aria-label={`Move widget ${index + 1} down`} className="sh-btn ghost icon" disabled={index === count - 1} type="button" onClick={() => onMove(1)}><Icon name="chevd" size={13} /></button>
      {!legacy ? <button aria-label={`Remove widget ${index + 1}`} className="sh-btn ghost icon" type="button" onClick={onRemove}><Icon name="x" size={13} /></button> : null}
    </div>
  </div>;
}

export function DashboardsTab({ ctx }: { ctx: ScreenCtx }) {
  const state = useAnalyticsDashboards({ client: ctx.client, projectId: ctx.project?.id, environmentId: ctx.environment?.id });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<DashboardForm>(EMPTY_DASHBOARD_FORM);
  const [insightToAdd, setInsightToAdd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const insightNames = useMemo(() => new Map(state.insights.map((row) => [row.id, row.name])), [state.insights]);

  useEffect(() => {
    if (state.status !== "ok") return;
    if (selectedId && state.dashboards.some((row) => row.id === selectedId)) return;
    const first = state.dashboards[0];
    if (first) { setSelectedId(first.id); setForm(dashboardToForm(first)); }
    else { setSelectedId(null); setForm(EMPTY_DASHBOARD_FORM); }
  }, [selectedId, state.dashboards, state.status]);

  const choose = (dashboard: AnalyticsDashboard) => { setSelectedId(dashboard.id); setForm(dashboardToForm(dashboard)); setError(null); void state.previewDashboard(dashboard.id, dashboard.filters.window ?? "24h"); };
  const startNew = () => { setSelectedId(null); setForm(EMPTY_DASHBOARD_FORM); setError(null); };
  const save = async () => {
    const validation = validateDashboardForm(form); setError(validation); if (validation) return;
    const saved = await state.save(form, selectedId ?? undefined);
    if (!saved) { setError("Could not save this dashboard."); return; }
    setSelectedId(saved.id); setForm(dashboardToForm(saved)); ctx.pushToast(selectedId ? "Dashboard updated" : "Dashboard created");
  };
  const duplicate = async () => { const row = state.dashboards.find((item) => item.id === selectedId); if (!row) return; const copy = await state.duplicate(row); if (!copy) { setError("Could not duplicate this dashboard."); return; } setSelectedId(copy.id); setForm(dashboardToForm(copy)); ctx.pushToast("Dashboard duplicated"); };
  const archive = async () => { if (!selectedId) return; if (!await state.archive(selectedId)) { setError("Could not archive this dashboard."); return; } startNew(); ctx.pushToast("Dashboard archived"); };

  if (state.status === "unavailable") return <div className="sh-card"><EmptyHint icon="pulse" title="Dashboards unavailable" sub="Deploy an API version with analytics dashboards and saved insights." /></div>;

  return <div className="dashboards-layout dashboard-layout sh-investigation-grid">
    <section className="sh-card" aria-label="Dashboard library">
      <div className="sh-card__head"><div><h2 className="sh-h2">Dashboards</h2><div className="sh-faint sh-copy-11">{state.dashboards.length} saved views</div></div><button aria-label="Create dashboard" className="sh-btn ghost icon sh-icon-target sh-hit-target" type="button" onClick={startNew}><Icon name="plus" size={14} /></button></div>
      <div className="sh-card__body flush">
        {state.status === "loading" ? <p role="status" className="sh-muted sh-inset-14">Loading dashboards…</p> : null}
        {state.status === "error" ? <EmptyHint icon="alert" title="Could not load dashboards" sub="Retry after checking the API connection." /> : null}
        {state.status === "ok" && state.dashboards.length === 0 ? <EmptyHint icon="pulse" title="No dashboards yet" sub="Create a view from reusable saved insights." /> : null}
        {state.dashboards.map((row) => <button key={row.id} type="button" onClick={() => choose(row)} aria-pressed={row.id === selectedId} className={`sh-listrow dashboard-library-row sh-focus-ring ${row.id === selectedId ? "active" : ""}`}><div className="sh-between-8"><strong>{row.name}</strong><span className="sh-tag">{row.category}</span></div><div className="sh-faint" style={{ fontSize: 10.5 }}>{row.widgets.length} widgets · {row.filters.window ?? "24h"}</div></button>)}
      </div>
    </section>

    <section className="sh-card" aria-label="Dashboard editor">
      <div className="sh-card__head"><div><h2 className="sh-h2">{selectedId ? "Edit dashboard" : "New dashboard"}</h2><div className="sh-faint sh-copy-11">Compose reusable operational views</div></div></div>
      <div className="sh-card__body dashboard-editor">
        {error ? <div className="sh-alert danger" role="alert">{error}</div> : null}
        <label><span className="sh-label">Name</span><input aria-label="Dashboard name" className="sh-input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label><span className="sh-label">Description</span><textarea aria-label="Dashboard description" className="sh-input" rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <div className="dashboard-form-pair"><label><span className="sh-label">Category</span><select aria-label="Dashboard category" className="sh-input" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as DashboardForm["category"] })}><option value="operational">Operational</option><option value="executive">Executive</option><option value="product">Product</option></select></label><label><span className="sh-label">Default window</span><select aria-label="Dashboard window" className="sh-input" value={form.window} onChange={(event) => setForm({ ...form, window: event.target.value as DashboardForm["window"] })}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label></div>
        <div><div className="sh-label" style={{ marginBottom: 5 }}>Add saved insight</div><div className="dashboard-add-insight"><select aria-label="Saved insight" className="sh-input" value={insightToAdd} onChange={(event) => setInsightToAdd(event.target.value)}><option value="">Select an insight…</option>{state.insights.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button className="sh-btn secondary" type="button" disabled={!insightToAdd} onClick={() => { const insight = state.insights.find((row) => row.id === insightToAdd); if (insight) setForm({ ...form, widgets: [...form.widgets, newInsightWidget(insight)] }); setInsightToAdd(""); }}><Icon name="plus" size={13} />Add</button></div>{state.insights.length === 0 ? <div className="sh-faint" style={{ marginTop: 5, fontSize: 10.5 }}>Create a saved trend before composing insight widgets.</div> : null}</div>
        <div className="sh-grid-6">{form.widgets.length === 0 ? <EmptyHint icon="pulse" title="No widgets" sub="Add saved insights to compose this dashboard." /> : form.widgets.map((widget, index) => <WidgetEditor key={widget.id} widget={widget} index={index} count={form.widgets.length} insightName={insightId(widget) ? insightNames.get(insightId(widget)!) ?? null : null} onChange={(next) => setForm({ ...form, widgets: form.widgets.map((row, rowIndex) => rowIndex === index ? next : row) })} onMove={(delta) => setForm({ ...form, widgets: move(form.widgets, index, delta) })} onRemove={() => setForm({ ...form, widgets: form.widgets.filter((_, rowIndex) => rowIndex !== index) })} />)}</div>
        <div className="dashboard-actions"><button className="sh-btn primary" type="button" disabled={state.busy} onClick={() => void save()}><Icon name="check" size={13} />{selectedId ? "Save changes" : "Create dashboard"}</button>{selectedId ? <><button className="sh-btn secondary" type="button" disabled={state.busy} onClick={() => void duplicate()}><Icon name="copy" size={13} />Duplicate</button><ConfirmButton label="Archive" confirmLabel="Confirm archive" icon="archive" kind="ghost" onConfirm={() => void archive()} /></> : null}</div>
      </div>
    </section>

    <section className="sh-card" aria-label="Dashboard preview">
      <div className="sh-card__head"><div><h2 className="sh-h2">Preview</h2><div className="sh-faint sh-copy-11">{selectedId ? `${form.window} report` : "Save before previewing"}</div></div>{selectedId ? <button aria-label="Refresh dashboard preview" className="sh-btn ghost icon sh-icon-target sh-hit-target" type="button" onClick={() => void state.previewDashboard(selectedId, form.window)}><Icon name="refresh" size={14} /></button> : null}</div>
      <div className="sh-card__body dashboard-preview">
        {state.previewStatus === "idle" ? <div className="sh-full-span"><EmptyHint icon="pulse" title="No preview loaded" sub={selectedId ? "Refresh to calculate every widget." : "Save the dashboard to generate a report."} /></div> : null}
        {state.previewStatus === "loading" ? <p role="status" className="sh-muted sh-full-span">Calculating dashboard…</p> : null}
        {state.previewStatus === "error" ? <div className="sh-full-span"><EmptyHint icon="alert" title="Preview failed" sub="The saved dashboard report could not be generated." /></div> : null}
        {state.previewStatus === "unavailable" ? <div className="sh-full-span"><EmptyHint icon="alert" title="Reports unavailable" sub="This API does not expose dashboard reports." /></div> : null}
        {state.previewStatus === "ok" && state.preview?.widgets.length === 0 ? <div className="sh-full-span"><EmptyHint icon="pulse" title="Empty report" sub="No widget results were returned." /></div> : null}
        {state.preview?.widgets.map((widget) => <article key={widget.widgetId} className="sh-row" style={{ padding: 10, gridColumn: widget.width === "full" ? "1/-1" : undefined, minWidth: 0 }}><div className="sh-label" style={{ marginBottom: 8 }}>{widget.title}</div><ReportWidget widget={widget} /></article>)}
      </div>
    </section>
  </div>;
}

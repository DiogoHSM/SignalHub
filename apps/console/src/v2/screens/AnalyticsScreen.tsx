import { useState } from "react";
import type { EventPathActorType } from "../../api/types";
import type { ScreenCtx } from "./registry";
import { useAnalyticsPanels } from "./useAnalyticsPanels";
import type { ClickMapVM, FunnelVM, PathsVM, RetentionVM } from "./useAnalyticsPanels";
import { DEFAULT_EVENT_FILTERS, useEvents } from "./useEvents";
import { useSegments } from "./useSegments";
import type { SaveSegmentForm } from "./useSegments";
import { ConfirmButton, EmptyHint, Icon, PageHead, Segmented } from "../../components/ui/v2";
import { runMutation } from "../lib/run-mutation";
import { FeedbackSection } from "./FeedbackSection";
import { TrendsTab } from "./analytics/TrendsTab";
import { DashboardsTab } from "./analytics/DashboardsTab";

type Tab = "trends" | "dashboards" | "funnel" | "retention" | "paths" | "clickMap" | "segments" | "properties" | "feedback";
const TABS: Tab[] = ["trends", "dashboards", "funnel", "retention", "paths", "clickMap", "segments", "properties", "feedback"];
const TAB_LABEL: Record<Tab, string> = {
  trends: "Trends",
  dashboards: "Dashboards",
  funnel: "Funnel",
  retention: "Retention",
  paths: "Paths",
  clickMap: "Click map",
  segments: "Segments",
  properties: "Properties",
  feedback: "Feedback",
};

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

function FunnelPanel({ state, data, run }: { state: string; data: FunnelVM | null; run: (v: string) => void }) {
  const [value, setValue] = useState("signup.started\nproject.created");
  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Conversion funnel</h2>
        {data ? (
          <span className="sh-tag ok">{data.totals.conversionPercent}% conversion</span>
        ) : null}
      </div>
      <div className="sh-card__body">
        <p className="sh-muted" style={{ fontSize: 12, marginTop: 0 }}>
          Enter 2+ event names, one per line. Sigmon counts actors who reached each step.
          {/* PER-439: conversion window control goes here once the funnel endpoint accepts it. */}
        </p>
        <textarea
          className="sh-input"
          rows={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ marginTop: 8 }}>
          <button className="sh-btn primary" disabled={state === "loading"} onClick={() => run(value)}>
            {state === "loading" ? "Running…" : "Run funnel"}
          </button>
        </div>
        {state === "invalid" ? <p className="sh-muted" style={{ fontSize: 12 }}>Add at least two event steps.</p> : null}
        {state === "error" ? <p className="sh-muted" style={{ fontSize: 12 }}>Conversion funnel unavailable.</p> : null}
        {state === "ok" && data ? (
          <div style={{ marginTop: 12 }}>
            {data.steps.map((step) => (
              <div className="sh-funnel-step" key={`${step.index}:${step.name}`}>
                <span className="sh-tag mono">Step {step.index + 1}</span>
                <strong style={{ flex: 1 }}>{step.name}</strong>
                <span className="sh-mono" style={{ fontSize: 12 }}>{step.actors} actors</span>
                <span className="sh-mono" style={{ fontSize: 12 }}>{step.conversionPercent}% conversion</span>
                <span className="sh-faint" style={{ fontSize: 11 }}>drop-off {step.dropOffFromPreviousPercent}%</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

function RetentionPanel({ state, data, run }: { state: string; data: RetentionVM | null; run: (entry: string, ret: string) => void }) {
  const [entryEvent, setEntryEvent] = useState("signup.started");
  const [returnEvent, setReturnEvent] = useState("app.opened");
  const intervalLabels = data?.cohorts[0]?.intervals.map((interval) => interval.label) ?? [];

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Retention curves</h2>
        {data ? <span className="sh-tag">{data.totals.cohorts} cohorts</span> : null}
      </div>
      <div className="sh-card__body">
        <p className="sh-muted" style={{ fontSize: 12, marginTop: 0 }}>
          Measure actors who enter on one event and return on another over time.
          {/* PER-440: range_days control goes here once retention accepts it. */}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="sh-input" style={{ maxWidth: 220 }} value={entryEvent} onChange={(e) => setEntryEvent(e.target.value)} placeholder="Entry event" />
          <input className="sh-input" style={{ maxWidth: 220 }} value={returnEvent} onChange={(e) => setReturnEvent(e.target.value)} placeholder="Return event" />
          <button className="sh-btn primary" disabled={state === "loading"} onClick={() => run(entryEvent, returnEvent)}>
            {state === "loading" ? "Running…" : "Run retention"}
          </button>
        </div>
        {state === "invalid" ? <p className="sh-muted" style={{ fontSize: 12 }}>Add entry and return event names.</p> : null}
        {state === "error" ? <p className="sh-muted" style={{ fontSize: 12 }}>Retention curves unavailable.</p> : null}
        {state === "ok" && data ? (
          <div style={{ marginTop: 12, overflow: "auto" }}>
            <div className="sh-row sh-row__head" style={{ gridTemplateColumns: `160px 90px repeat(${intervalLabels.length}, 70px)` }}>
              <span>Cohort</span>
              <span>Entrants</span>
              {intervalLabels.map((label) => <span key={label}>{label}</span>)}
            </div>
            {data.cohorts.length === 0 ? (
              <EmptyHint icon="grid" title="No cohorts" sub="No cohorts found for this window." />
            ) : (
              data.cohorts.map((cohort) => (
                <div
                  key={cohort.cohortStart}
                  className="sh-row"
                  style={{ gridTemplateColumns: `160px 90px repeat(${cohort.intervals.length}, 70px)` }}
                >
                  <strong style={{ fontSize: 12 }}>{cohort.cohortLabel}</strong>
                  <span style={{ fontSize: 12 }}>{cohort.entrants}</span>
                  {cohort.intervals.map((interval) => (
                    <span
                      key={`${cohort.cohortStart}:${interval.index}`}
                      className="sh-heat"
                      style={{
                        background: `color-mix(in srgb, var(--accent) ${Math.max(8, interval.retentionPercent)}%, transparent)`,
                        color: interval.retentionPercent >= 50 ? "var(--accent-fg)" : "var(--fg)"
                      }}
                    >
                      <strong style={{ fontSize: 11 }}>{interval.retentionPercent}%</strong>
                    </span>
                  ))}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ACTOR_OPTIONS: EventPathActorType[] = ["auto", "user", "tenant", "session", "trace"];

function PathsPanel({
  state,
  data,
  run,
  ctx,
  segmentOptions,
}: {
  state: string;
  data: PathsVM | null;
  run: (args: {
    startEvent: string;
    endEvent: string;
    actorType: EventPathActorType;
    pathLength: number;
    segmentId?: string;
  }) => void;
  ctx: ScreenCtx;
  segmentOptions: Array<{ id: string; name: string }>;
}) {
  const [startEvent, setStartEvent] = useState("signup.started");
  const [endEvent, setEndEvent] = useState("");
  const [actorType, setActorType] = useState<EventPathActorType>("auto");
  const [pathLength, setPathLength] = useState("5");
  const [segmentId, setSegmentId] = useState<string | undefined>(undefined);

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">User journey paths</h2>
        {data ? <span className="sh-tag">{data.totals.paths} paths · {data.totals.actors} actors</span> : null}
      </div>
      <div className="sh-card__body">
        <p className="sh-muted" style={{ fontSize: 12, marginTop: 0 }}>
          Find the most common event sequences. Click a sample event to inspect it in Events.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="sh-input" style={{ maxWidth: 200 }} value={startEvent} onChange={(e) => setStartEvent(e.target.value)} placeholder="Start event" />
          <input className="sh-input" style={{ maxWidth: 200 }} value={endEvent} onChange={(e) => setEndEvent(e.target.value)} placeholder="End event" />
          <select className="sh-input" style={{ maxWidth: 140 }} value={actorType} onChange={(e) => setActorType(e.target.value as EventPathActorType)}>
            {ACTOR_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <input
            className="sh-input"
            style={{ maxWidth: 100 }}
            min={2}
            max={8}
            type="number"
            value={pathLength}
            onChange={(e) => setPathLength(e.target.value)}
          />
          <select aria-label="Segment" className="sh-input" style={{ maxWidth: 180 }} value={segmentId ?? ""} onChange={(e) => setSegmentId(e.target.value || undefined)}>
            <option value="">No segment</option>
            {segmentOptions.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <button
            className="sh-btn primary"
            disabled={state === "loading"}
            onClick={() => {
              const parsed = Number(pathLength);
              run({
                startEvent,
                endEvent,
                actorType,
                pathLength: Number.isFinite(parsed) ? Math.trunc(parsed) : 5,
                segmentId,
              });
            }}
          >
            {state === "loading" ? "Running…" : "Find paths"}
          </button>
        </div>
        {state === "invalid" ? <p className="sh-muted" style={{ fontSize: 12 }}>Add a start event or an end event.</p> : null}
        {state === "error" ? <p className="sh-muted" style={{ fontSize: 12 }}>Pathfinder unavailable.</p> : null}
        {state === "ok" && data && data.paths.length === 0 ? (
          <EmptyHint icon="waterfall" title="No paths" sub="No paths matched the current filters." />
        ) : null}
        {state === "ok" && data && data.paths.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            {data.paths.map((path, index) => (
              <div key={`${index}:${path.path.join(">")}`} style={{ padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <strong style={{ fontSize: 13 }}>{path.path.join(" → ")}</strong>
                <div className="sh-faint" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {path.actors} actors · {path.occurrences} occurrences · last {new Date(path.lastSeenAt).toLocaleString()}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {path.sampleEvents.map((event) => (
                    <button
                      key={event.id}
                      className="sh-tag mono"
                      onClick={() => {
                        // PER-434: pass { eventId: event.id } once navigate(section, filters) lands.
                        ctx.navigate("events");
                      }}
                    >
                      {event.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Click map
// ---------------------------------------------------------------------------

function ClickMapPanel({ state, data, run }: { state: string; data: ClickMapVM | null; run: (args: { route: string; selector?: string }) => void }) {
  const [route, setRoute] = useState("/");
  const [selector, setSelector] = useState("");
  const maxClicks = Math.max(1, ...(data?.points.map((p) => p.clicks) ?? []));

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Click map</h2>
        {data ? <span className="sh-tag">{data.totals.clicks} clicks</span> : null}
      </div>
      <div className="sh-card__body">
        <p className="sh-muted" style={{ fontSize: 12, marginTop: 0 }}>
          Opt-in browser clicks by route. Sigmon stores normalized coordinates and safe selectors, not text, values, DOM, or screenshots.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="sh-input" style={{ maxWidth: 200 }} value={route} onChange={(e) => setRoute(e.target.value)} placeholder="/checkout" />
          <input className="sh-input" style={{ maxWidth: 200 }} value={selector} onChange={(e) => setSelector(e.target.value)} placeholder="Optional selector" />
          <button className="sh-btn primary" disabled={state === "loading"} onClick={() => run({ route, selector: selector || undefined })}>
            {state === "loading" ? "Loading…" : "Load click map"}
          </button>
        </div>
        {state === "invalid" ? <p className="sh-muted" style={{ fontSize: 12 }}>Add a route to load the click map.</p> : null}
        {state === "error" ? <p className="sh-muted" style={{ fontSize: 12 }}>Click map unavailable.</p> : null}
        {state === "ok" && data ? (
          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
            <svg viewBox="0 0 100 100" style={{ width: 240, height: 240, border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
              {data.points.map((point) => {
                const size = 100 / data.gridSize;
                const opacity = Math.max(0.18, point.clicks / maxClicks);
                return (
                  <rect
                    key={`${point.xBucket}:${point.yBucket}`}
                    x={point.xBucket * size}
                    y={point.yBucket * size}
                    width={size}
                    height={size}
                    fill="var(--accent)"
                    opacity={opacity}
                  />
                );
              })}
            </svg>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="sh-eyebrow" style={{ marginBottom: 6 }}>Top selectors</div>
              {data.selectors.length === 0 ? <p className="sh-muted" style={{ fontSize: 12 }}>No selectors in this route.</p> : null}
              {data.selectors.slice(0, 8).map((item) => (
                <button key={item.selector} className="sh-tag mono" style={{ marginRight: 6, marginBottom: 6 }} onClick={() => setSelector(item.selector)}>
                  {item.selector} · {item.clicks}
                </button>
              ))}
              <div className="sh-eyebrow" style={{ margin: "10px 0 6px" }}>Routes</div>
              {data.routes.slice(0, 8).map((item) => (
                <button key={item.route} className="sh-tag mono" style={{ marginRight: 6, marginBottom: 6 }} onClick={() => setRoute(item.route)}>
                  {item.route} · {item.clicks}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

const EMPTY_SEGMENT_FORM: SaveSegmentForm = {
  editingId: null,
  name: "",
  actorType: "user",
  window: "30d",
  eventName: "",
  propertyName: "",
  propertyValue: "",
};

function SegmentsPanel({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const { data, status, busy, save, archive } = useSegments({ client: ctx.client, projectId, environmentId });
  const [form, setForm] = useState<SaveSegmentForm>(EMPTY_SEGMENT_FORM);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const ok = await save(form);
    if (ok) {
      setForm(EMPTY_SEGMENT_FORM);
    } else {
      setError("Could not save segment.");
    }
  }

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Saved segments</h2>
        <span className="sh-tag">{data?.rows.length ?? 0}</span>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <div>
          {status === "loading" ? <p className="sh-muted" style={{ fontSize: 12 }}>Loading saved segments…</p> : null}
          {status === "error" ? <EmptyHint icon="cube" title="Saved segments unavailable" sub="This client cannot manage segments." /> : null}
          {status === "ok" && data && data.rows.length === 0 ? (
            <EmptyHint icon="cube" title="No saved segments" sub="Create a segment to reuse it across Events and Paths." />
          ) : null}
          {status === "ok" && data
            ? data.rows.map((row) => (
                <div key={row.id} className="sh-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <div>
                    <strong style={{ fontSize: 12.5 }}>{row.name}</strong>
                    <div className="sh-faint sh-mono" style={{ fontSize: 11 }}>{row.summary}</div>
                    <div className="sh-faint" style={{ fontSize: 11 }}>
                      {row.previewActors == null ? "Preview pending" : `${row.previewActors} actors`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="sh-iconbtn-sm"
                      title="Edit"
                      disabled={busy}
                      onClick={() =>
                        setForm({
                          editingId: row.id,
                          name: row.name,
                          actorType: row.actorType,
                          window: row.definition.window ?? "30d",
                          eventName: row.definition.eventName ?? "",
                          propertyName: row.definition.propertyName ?? "",
                          propertyValue: row.definition.propertyValue ?? "",
                        })
                      }
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <ConfirmButton
                      label={<Icon name="archive" size={13} />}
                      confirmLabel="Confirm"
                      onConfirm={() =>
                        void runMutation(() => archive(row.id), {
                          pushToast: ctx.pushToast,
                          message: "Could not archive segment",
                        })
                      }
                    />
                  </div>
                </div>
              ))
            : null}
        </div>
        <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
          <input className="sh-input" placeholder="Segment name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="sh-input" value={form.actorType} onChange={(e) => setForm({ ...form, actorType: e.target.value as SaveSegmentForm["actorType"] })}>
            <option value="user">Users</option>
            <option value="tenant">Tenants</option>
          </select>
          <select className="sh-input" value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value as SaveSegmentForm["window"] })}>
            <option value="24h">24h</option>
            <option value="7d">7d</option>
            <option value="30d">30d</option>
          </select>
          <input className="sh-input" placeholder="Event name" value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} />
          <input className="sh-input" placeholder="Property name" value={form.propertyName} onChange={(e) => setForm({ ...form, propertyName: e.target.value })} />
          <input className="sh-input" placeholder="Property value" value={form.propertyValue} onChange={(e) => setForm({ ...form, propertyValue: e.target.value })} />
          {error ? <p className="sh-muted" style={{ fontSize: 12, color: "var(--sev-critical)" }}>{error}</p> : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="sh-btn primary" disabled={busy} onClick={() => void handleSave()}>
              {form.editingId ? "Save segment" : "Create segment"}
            </button>
            {form.editingId ? (
              <button className="sh-btn ghost" onClick={() => setForm(EMPTY_SEGMENT_FORM)}>Cancel</button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

function PropertiesPanel({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  // The property catalog is fetched by useEvents (shared with the Events explorer);
  // this tab reads it with no applied filters to show governance for the whole environment.
  const { data, status } = useEvents({ client: ctx.client, projectId, environmentId, filters: DEFAULT_EVENT_FILTERS });
  const catalog = data?.propertyCatalog ?? null;
  const catalogStatus = data?.propertyCatalogStatus ?? "loading";

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Property governance</h2>
        {catalog ? (
          <span className="sh-tag">
            {catalog.totals.properties} properties · {catalog.totals.conflictProperties} conflicts · {catalog.totals.similarNameGroups} similar
          </span>
        ) : null}
      </div>
      <div className="sh-card__body flush">
        {status === "loading" || catalogStatus === "loading" ? (
          <p className="sh-muted" style={{ fontSize: 12, padding: 16 }}>Loading event property governance…</p>
        ) : null}
        {catalogStatus === "error" ? (
          <EmptyHint icon="grid" title="Property governance unavailable" sub="This client cannot load the property catalog." />
        ) : null}
        {catalogStatus === "ok" && catalog && catalog.properties.length === 0 ? (
          <EmptyHint icon="grid" title="No properties observed" sub="No event properties observed in this window." />
        ) : null}
        {catalogStatus === "ok" && catalog && catalog.properties.length > 0
          ? catalog.properties.map((property) => (
              <div
                key={`${property.eventName}:${property.propertyName}`}
                className="sh-row"
                style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}
              >
                <div>
                  <strong style={{ fontSize: 12.5 }}>{property.propertyName}</strong>
                  <div className="sh-faint" style={{ fontSize: 11 }}>{property.eventName}</div>
                </div>
                <div>
                  <span style={{ fontSize: 12 }}>{property.typeCountsLabel}</span>
                  {property.hasTypeConflict ? <div><span className="sh-tag critical">Type conflict</span></div> : null}
                </div>
                <div>
                  <span style={{ fontSize: 12 }}>{property.coveragePercent}% coverage</span>
                  <div className="sh-faint" style={{ fontSize: 11 }}>{property.totalOccurrences}/{property.eventCount} events</div>
                </div>
                <div>
                  {property.sampleValues.length > 0 ? (
                    <code className="sh-mono" style={{ fontSize: 11 }}>{property.sampleValues.join(", ")}</code>
                  ) : (
                    <span className="sh-faint" style={{ fontSize: 11 }}>No samples</span>
                  )}
                  {property.similarPropertyNames.length > 0 ? (
                    <div className="sh-faint" style={{ fontSize: 10.5 }}>Similar: {property.similarPropertyNames.join(", ")}</div>
                  ) : null}
                </div>
              </div>
            ))
          : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnalyticsScreen
// ---------------------------------------------------------------------------

export function AnalyticsScreen({ ctx }: { ctx: ScreenCtx }) {
  const [tab, setTab] = useState<Tab>("trends");
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;

  const panels = useAnalyticsPanels({ client: ctx.client, projectId, environmentId });
  const segments = useSegments({ client: ctx.client, projectId, environmentId });

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="grid" title="No project selected" sub="Select a project and environment to explore analytics." />
      </div>
    );
  }

  return (
    <>
      <PageHead
        title="Analytics"
        sub={
          <>
            Understand behavior and conversion for{" "}
            <strong style={{ color: "var(--fg)" }}>{ctx.project.name} · {ctx.environment.name}</strong>. Start with a saved trend or dashboard, then explore where users progress or drop off.
          </>
        }
      />

      <Segmented options={TABS.map((t) => TAB_LABEL[t])} value={TAB_LABEL[tab]} onChange={(label) => {
        const next = TABS.find((t) => TAB_LABEL[t] === label);
        if (next) setTab(next);
      }} />

      {tab === "trends" ? <TrendsTab key={`${projectId}:${environmentId}`} ctx={ctx} /> : null}
      {tab === "dashboards" ? <DashboardsTab key={`${projectId}:${environmentId}`} ctx={ctx} /> : null}
      {tab === "funnel" ? <FunnelPanel state={panels.funnel.state} data={panels.funnel.data} run={panels.funnel.run} /> : null}
      {tab === "retention" ? <RetentionPanel state={panels.retention.state} data={panels.retention.data} run={panels.retention.run} /> : null}
      {tab === "paths" ? (
        <PathsPanel
          state={panels.paths.state}
          data={panels.paths.data}
          run={panels.paths.run}
          ctx={ctx}
          segmentOptions={segments.data?.rows.map((row) => ({ id: row.id, name: row.name })) ?? []}
        />
      ) : null}
      {tab === "clickMap" ? <ClickMapPanel state={panels.clickMap.state} data={panels.clickMap.data} run={panels.clickMap.run} /> : null}
      {tab === "segments" ? <SegmentsPanel ctx={ctx} /> : null}
      {tab === "properties" ? <PropertiesPanel ctx={ctx} /> : null}
      {tab === "feedback" ? <FeedbackSection key={`${projectId}:${environmentId}`} ctx={ctx} view="recent" /> : null}
    </>
  );
}

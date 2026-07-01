import { useEffect, useState } from "react";
import type { ScreenCtx } from "./registry";
import { useTraces } from "./useTraces";
import type { ApmEndpointVM, ServiceMapEdgeVM, TraceListItemVM, UseTracesResult, WebVitalMetricVM } from "./useTraces";
import { SPAN_KIND_COLOR, useTraceSpans } from "./useTraceSpans";
import type { SpanNodeVM } from "./useTraceSpans";
import {
  Divider,
  EmptyHint,
  formatLatency,
  formatUsd,
  formatUtcTimestamp,
  Icon,
  Kv,
  Legend,
  PageHead,
  relativeTime,
  Segmented,
  SummaryStat,
} from "../../components/ui/v2";

type WaterfallFilter = "All" | "Slow" | "Errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function boundText(s: string, max = 2000): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function stringifyUnknown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function spanAttributes(span: SpanNodeVM): string {
  const attrs: Record<string, unknown> = {
    service: span.service ?? null,
    kind: span.kind,
    status: span.status,
    duration_ms: span.durMs,
    started_ms: span.offsetMs,
    cost_usd: span.costUsd ?? null,
  };
  if (span.metadata != null && typeof span.metadata === "object") {
    attrs.metadata = span.metadata;
  }
  return boundText(JSON.stringify(attrs, null, 2));
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatApdex(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function formatBytes(value: number | null): string {
  if (value === null) return "—";
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB"];
  let n = value / 1024;
  for (const unit of units) {
    if (n < 1024 || unit === "GB") return `${n >= 10 ? n.toFixed(0) : n.toFixed(1)} ${unit}`;
    n /= 1024;
  }
  return `${Math.round(value)} B`;
}

function formatWebVitalValue(metric: WebVitalMetricVM["name"], value: number | null): string {
  if (value === null) return "—";
  if (metric === "CLS") return value.toFixed(3);
  return formatLatency(value);
}

function webVitalTone(metric: WebVitalMetricVM): "ok" | "warn" | "critical" {
  if (metric.poor > 0) return "critical";
  if (metric.needsImprovement > 0 || (metric.regressionPercent ?? 0) > 20) return "warn";
  return "ok";
}

// Build the ruler tick labels (0 … totalMs) for the waterfall header.
function rulerLabels(totalMs: number): string[] {
  const t = Math.round(totalMs);
  return [
    "0",
    String(Math.round(totalMs * 0.25)),
    String(Math.round(totalMs * 0.5)),
    String(Math.round(totalMs * 0.75)),
    `${t}ms`,
  ];
}

// ---------------------------------------------------------------------------
// Index (recent traces)
// ---------------------------------------------------------------------------

function TraceListRow({ trace, onOpen }: { trace: TraceListItemVM; onOpen: () => void }) {
  return (
    <button
      className="sh-row sh-row--btn"
      style={{
        gridTemplateColumns: "1fr",
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "14px 18px",
        cursor: "pointer",
      }}
      onClick={onOpen}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        {trace.hasError ? (
          <span className="sh-tag critical">● Has error</span>
        ) : (
          <span className="sh-tag ok">{trace.status}</span>
        )}
        <span className="sh-tag mono">{trace.traceId}</span>
        <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>
          {(trace.userId ?? "—")} · {(trace.tenantId ?? "—")}
        </span>
        <div style={{ flex: 1 }} />
        <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>{relativeTime(trace.startedAt)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span className="sh-mono" style={{ fontSize: 13, color: "var(--fg)" }}>{trace.name}</span>
        <div style={{ flex: 1 }} />
        <span className="sh-mono sh-muted" style={{ fontSize: 12 }}>{formatLatency(trace.durationMs)}</span>
        <Icon name="arrow" size={12} style={{ color: "var(--fg-faint)" }} />
      </div>
    </button>
  );
}

function EndpointRow({
  endpoint,
  active,
  onSelect
}: {
  endpoint: ApmEndpointVM;
  active: boolean;
  onSelect: () => void;
}) {
  const tone = endpoint.errors > 0 ? "critical" : endpoint.p95DurationMs != null && endpoint.p95DurationMs > 1000 ? "warn" : "ok";
  return (
    <button
      className={`sh-row sh-row--btn ${active ? "is-active" : ""}`}
      style={{
        gridTemplateColumns: "minmax(220px, 1.4fr) repeat(7, minmax(82px, .55fr))",
        alignItems: "center",
        width: "100%",
        textAlign: "left",
        border: "none",
        borderBottom: "1px solid var(--border-subtle)",
        background: active ? "rgba(87, 242, 135, 0.12)" : "transparent",
        cursor: "pointer",
      }}
      onClick={onSelect}
    >
      <span className="sh-mono" style={{ color: "var(--fg)", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {endpoint.name}
      </span>
      <span className="sh-mono">{endpoint.requests}</span>
      <span className={`sh-tag ${tone}`}>{endpoint.errors}</span>
      <span className="sh-mono">{formatPercent(endpoint.errorRatePercent)}</span>
      <span className="sh-mono">{formatLatency(endpoint.p50DurationMs)}</span>
      <span className="sh-mono">{formatLatency(endpoint.p95DurationMs)}</span>
      <span className="sh-mono">{formatLatency(endpoint.p99DurationMs)}</span>
      <span className="sh-mono">{formatApdex(endpoint.apdex)}</span>
    </button>
  );
}

function EndpointTable({
  endpoints,
  activeEndpoint,
  onSelect
}: {
  endpoints: ApmEndpointVM[];
  activeEndpoint: string | null;
  onSelect: (name: string) => void;
}) {
  return (
    <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="sh-card__head">
        <h2 className="sh-h2">APM endpoints</h2>
        <span className="sh-tag">slowest by p95</span>
      </div>
      <div
        className="sh-row"
        style={{
          gridTemplateColumns: "minmax(220px, 1.4fr) repeat(7, minmax(82px, .55fr))",
          padding: "8px 18px",
          borderBottom: "1px solid var(--border-subtle)",
          color: "var(--fg-faint)",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        <span>Endpoint</span>
        <span>Req</span>
        <span>Errors</span>
        <span>Error rate</span>
        <span>p50</span>
        <span>p95</span>
        <span>p99</span>
        <span>Apdex</span>
      </div>
      <div style={{ overflow: "auto", maxHeight: 260 }}>
        {endpoints.length === 0 ? (
          <EmptyHint icon="waterfall" title="No APM data yet" sub="Trace endpoints will appear here as traffic arrives." />
        ) : (
          endpoints.map((endpoint) => (
            <EndpointRow
              key={endpoint.name}
              endpoint={endpoint}
              active={endpoint.name === activeEndpoint}
              onSelect={() => onSelect(endpoint.name)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ServiceMapPanel({ serviceMap }: { serviceMap: UseTracesResult["serviceMap"] }) {
  const edges = serviceMap.edges.slice(0, 8);
  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <div>
          <h2 className="sh-h2">Service map</h2>
          <p className="sh-muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            Span dependencies inferred from service, peer, target and operation metadata.
          </p>
        </div>
        <span className="sh-tag">
          {serviceMap.totals?.services ?? 0} services · {serviceMap.totals?.edges ?? edges.length} edges
        </span>
      </div>
      {edges.length === 0 ? (
        <EmptyHint icon="waterfall" title="No service dependencies yet" sub="Add span metadata such as service and target_service to build the map." />
      ) : (
        <div style={{ display: "grid", gap: 8, padding: "0 18px 18px" }}>
          {edges.map((edge) => (
            <ServiceMapEdgeRow edge={edge} key={`${edge.source}:${edge.target}:${edge.dependencyType}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceMapEdgeRow({ edge }: { edge: ServiceMapEdgeVM }) {
  const tone = edge.errors > 0 ? "critical" : edge.p95DurationMs != null && edge.p95DurationMs > 1000 ? "warn" : "ok";
  return (
    <div
      className="sh-row"
      style={{
        gridTemplateColumns: "minmax(180px, 1fr) 28px minmax(180px, 1fr) repeat(5, minmax(72px, .45fr))",
        alignItems: "center",
        padding: "10px 12px",
        border: "1px solid var(--border-subtle)",
        borderRadius: 10,
        background: "rgba(255,255,255,0.015)",
      }}
    >
      <span className="sh-mono" style={{ color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis" }}>
        {edge.source}
      </span>
      <Icon name="arrow" size={13} style={{ color: "var(--fg-faint)" }} />
      <span className="sh-mono" style={{ color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis" }}>
        {edge.target}
      </span>
      <span className="sh-tag mono">{edge.dependencyType}</span>
      <span className="sh-mono">{edge.spans} spans</span>
      <span className="sh-mono">{edge.traces} traces</span>
      <span className={`sh-tag ${tone}`}>{edge.errors} err</span>
      <span className="sh-mono">p95 {formatLatency(edge.p95DurationMs)}</span>
    </div>
  );
}

function WebVitalsPanel({ webVitals }: { webVitals: UseTracesResult["webVitals"] }) {
  const totals = webVitals.totals;
  const metrics = webVitals.metrics.slice(0, 8);
  return (
    <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="sh-card__head">
        <div>
          <h2 className="sh-h2">Web vitals</h2>
          <p className="sh-muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            Browser experience p75 by route, metric and release.
          </p>
        </div>
        <span className="sh-tag">
          {totals?.samples ?? 0} samples · {totals?.routes ?? 0} routes
        </span>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          <SummaryStat label="LCP p75" value={formatWebVitalValue("LCP", totals?.p75LcpMs ?? null)} />
          <SummaryStat label="INP p75" value={formatWebVitalValue("INP", totals?.p75InpMs ?? null)} />
          <SummaryStat label="CLS p75" value={formatWebVitalValue("CLS", totals?.p75Cls ?? null)} mono />
          <SummaryStat
            label="Poor samples"
            value={String(totals?.poorSamples ?? 0)}
            tone={(totals?.poorSamples ?? 0) > 0 ? "danger" : undefined}
          />
        </div>
        {metrics.length === 0 ? (
          <EmptyHint icon="activity" title="No Web Vitals yet" sub="Install browser Web Vitals capture to see route-level UX regressions." />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {metrics.map((metric) => {
              const tone = webVitalTone(metric);
              return (
                <div
                  key={`${metric.name}:${metric.route}`}
                  className="sh-row"
                  style={{
                    gridTemplateColumns: "76px minmax(180px, 1.2fr) repeat(5, minmax(78px, .5fr))",
                    alignItems: "center",
                    padding: "10px 12px",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.015)",
                  }}
                >
                  <span className={`sh-tag ${tone}`}>{metric.name}</span>
                  <span className="sh-mono" style={{ color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {metric.route}
                  </span>
                  <span className="sh-mono">p75 {formatWebVitalValue(metric.name, metric.p75Value)}</span>
                  <span className="sh-mono">{metric.samples} samples</span>
                  <span className="sh-mono">{metric.poor} poor</span>
                  <span className="sh-mono">{metric.latestRelease ?? "no release"}</span>
                  <span className={`sh-tag ${(metric.regressionPercent ?? 0) > 20 ? "warn" : "mono"}`}>
                    {metric.regressionPercent === null ? "no baseline" : `${formatPercent(metric.regressionPercent)} vs prev`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RuntimeProfilesPanel({ runtimeProfiles }: { runtimeProfiles: UseTracesResult["runtimeProfiles"] }) {
  const totals = runtimeProfiles.totals;
  const hotFunctions = runtimeProfiles.hotFunctions.slice(0, 8);
  const profiles = runtimeProfiles.profiles.slice(0, 6);

  return (
    <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="sh-card__head">
        <div>
          <h2 className="sh-h2">Runtime profiles</h2>
          <p className="sh-muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
            Opt-in CPU and memory snapshots from Node.js workers, jobs and route handlers.
          </p>
        </div>
        <span className="sh-tag">
          {totals?.profiles ?? 0} profiles · {totals?.samples ?? 0} samples
        </span>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          <SummaryStat label="CPU profiles" value={String(totals?.cpuProfiles ?? 0)} />
          <SummaryStat label="Memory snapshots" value={String(totals?.memoryProfiles ?? 0)} />
          <SummaryStat label="Avg CPU" value={formatPercent(totals?.avgCpuUsagePercent ?? null)} />
          <SummaryStat label="Max heap" value={formatBytes(totals?.maxHeapUsedBytes ?? null)} mono />
        </div>
        {hotFunctions.length === 0 && profiles.length === 0 ? (
          <EmptyHint icon="activity" title="No runtime profiles yet" sub="Use @sigmon/sdk/node to capture targeted CPU windows or memory snapshots." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, .9fr)", gap: 12 }}>
            <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
              <h3 className="sh-h3">Hot functions</h3>
              {hotFunctions.length === 0 ? (
                <EmptyHint icon="activity" title="No CPU hotspots" sub="CPU profiles will show aggregated self time here." />
              ) : (
                hotFunctions.map((frame) => (
                  <div
                    key={`${frame.functionName}:${frame.url ?? ""}:${frame.selfTimeMs}`}
                    className="sh-row"
                    style={{
                      gridTemplateColumns: "minmax(160px, 1fr) 86px 72px 72px",
                      alignItems: "center",
                      padding: "10px 12px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.015)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="sh-mono" style={{ color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {frame.functionName}
                      </div>
                      <div className="sh-muted sh-mono" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {frame.url ?? "runtime"} · {frame.lastSeenAt ? relativeTime(frame.lastSeenAt) : "never"}
                      </div>
                    </div>
                    <span className="sh-mono">{formatLatency(frame.selfTimeMs)}</span>
                    <span className="sh-mono">{frame.sampleCount} smp</span>
                    <span className="sh-mono">{frame.profileCount} prof</span>
                  </div>
                ))
              )}
            </div>
            <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
              <h3 className="sh-h3">Recent profiles</h3>
              {profiles.length === 0 ? (
                <EmptyHint icon="waterfall" title="No recent snapshots" sub="Captured profiles will appear here with route and trace context." />
              ) : (
                profiles.map((profile) => (
                  <div
                    key={profile.id}
                    style={{
                      padding: "10px 12px",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.015)",
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <span className={`sh-tag ${profile.kind === "cpu" ? "warn" : "mono"}`}>{profile.kind}</span>
                      <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {profile.name}
                      </strong>
                    </div>
                    <div className="sh-muted sh-mono" style={{ fontSize: 11 }}>
                      {profile.route ?? profile.service ?? profile.runtime} · {relativeTime(profile.startedAt)}
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                      <span className="sh-mono">{formatLatency(profile.durationMs)}</span>
                      <span className="sh-mono">{profile.sampleCount} samples</span>
                      <span className="sh-mono">heap {formatBytes(profile.heapUsedBytes)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TraceListView({
  ctx,
  traces,
  endpoints,
  totals,
  serviceMap,
  webVitals,
  runtimeProfiles,
  activeEndpoint,
  onSelectEndpoint,
  onClearEndpoint,
  onOpen
}: {
  ctx: ScreenCtx;
  traces: TraceListItemVM[];
  endpoints: ApmEndpointVM[];
  totals: UseTracesResult["totals"];
  serviceMap: UseTracesResult["serviceMap"];
  webVitals: UseTracesResult["webVitals"];
  runtimeProfiles: UseTracesResult["runtimeProfiles"];
  activeEndpoint: string | null;
  onSelectEndpoint: (name: string) => void;
  onClearEndpoint: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <PageHead
        title="Traces"
        sub={
          <>
            APM endpoint performance and recent traces for{" "}
            <strong style={{ color: "var(--fg)" }}>
              {ctx.project?.name} · {ctx.environment?.name}
            </strong>{" "}
            — {traces.length} traces shown.
          </>
        }
        actions={
          <>
            {activeEndpoint ? (
              <button className="sh-btn" onClick={onClearEndpoint}>
                <Icon name="x" size={14} />
                Clear endpoint
              </button>
            ) : null}
          </>
        }
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        <div className="sh-card"><div className="sh-card__body"><SummaryStat label="Endpoints" value={String(totals?.endpoints ?? endpoints.length)} /></div></div>
        <div className="sh-card"><div className="sh-card__body"><SummaryStat label="Requests" value={String(totals?.requests ?? 0)} /></div></div>
        <div className="sh-card"><div className="sh-card__body"><SummaryStat label="Errors" value={String(totals?.errors ?? 0)} tone={(totals?.errors ?? 0) > 0 ? "danger" : undefined} /></div></div>
        <div className="sh-card"><div className="sh-card__body"><SummaryStat label="Apdex" value={formatApdex(totals?.apdex ?? null)} /></div></div>
      </div>
      <EndpointTable endpoints={endpoints} activeEndpoint={activeEndpoint} onSelect={onSelectEndpoint} />
      <WebVitalsPanel webVitals={webVitals} />
      <RuntimeProfilesPanel runtimeProfiles={runtimeProfiles} />
      <ServiceMapPanel serviceMap={serviceMap} />
      <div className="sh-card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="sh-card__head">
          <h2 className="sh-h2">{activeEndpoint ? `Recent traces · ${activeEndpoint}` : "Recent traces"}</h2>
          <span className="sh-tag">latest 25</span>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {traces.length === 0 ? (
            <EmptyHint icon="waterfall" title="No traces in this project" sub="Traces will appear here as they are ingested." />
          ) : (
            traces.map((t) => <TraceListRow key={t.id} trace={t} onOpen={() => onOpen(t.id)} />)
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail (waterfall + span detail)
// ---------------------------------------------------------------------------

function computeVisible(spans: SpanNodeVM[], filter: WaterfallFilter, collapsed: Set<string>, totalMs: number): SpanNodeVM[] {
  if (filter === "Errors") return spans.filter((s) => s.errored);
  if (filter === "Slow") {
    const threshold = totalMs * 0.05;
    return spans.filter((s) => s.durMs >= threshold).slice().sort((a, b) => b.durMs - a.durMs);
  }
  // All → collapsible tree
  const visible: SpanNodeVM[] = [];
  let hideBelow = Infinity;
  for (const s of spans) {
    if (s.level > hideBelow) continue;
    hideBelow = Infinity;
    visible.push(s);
    if (collapsed.has(s.id) && s.hasChildren) hideBelow = s.level;
  }
  return visible;
}

function WaterfallRow({ span, totalMs, treeMode, isCollapsed, isActive, onSelect, onToggle }: {
  span: SpanNodeVM;
  totalMs: number;
  treeMode: boolean;
  isCollapsed: boolean;
  isActive: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const left = (span.offsetMs / totalMs) * 100;
  const width = Math.max((span.durMs / totalMs) * 100, 0.4);
  const showToggle = treeMode && span.hasChildren;
  return (
    <div
      className={`sh-row span-row ${isActive ? "is-active" : ""}`}
      style={{ gridTemplateColumns: "280px 60px 1fr", padding: "9px 16px", cursor: "pointer" }}
      onClick={onSelect}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5, paddingLeft: span.level * 16, minWidth: 0 }}>
        {showToggle ? (
          <button
            className="span-toggle"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
          >
            <Icon name="chevd" size={12} style={{ transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform .2s" }} />
          </button>
        ) : (
          <span style={{ width: 16, display: "inline-block", textAlign: "center", color: "var(--fg-faint)" }}>·</span>
        )}
        <span style={{ width: 8, height: 8, borderRadius: 2, background: SPAN_KIND_COLOR[span.kind], flex: "0 0 auto" }} />
        <span className="sh-mono" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {span.name}
        </span>
        {treeMode && isCollapsed && span.hasChildren ? (
          <span className="sh-tag mono" style={{ padding: "0 5px", fontSize: 9 }}>+</span>
        ) : null}
        {span.errored ? <span className="sh-tag critical" style={{ padding: "1px 5px", fontSize: 9 }}>ERR</span> : null}
      </div>
      <span className="sh-mono sh-muted" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{Math.round(span.durMs)}ms</span>
      <div style={{ position: "relative", height: 16, background: "var(--bg-canvas)", borderRadius: 2 }}>
        {[20, 40, 60, 80].map((p) => (
          <span key={p} style={{ position: "absolute", left: `${p}%`, top: 0, bottom: 0, width: 1, background: "var(--border-subtle)" }} />
        ))}
        <div
          style={{
            position: "absolute",
            left: `${left}%`,
            width: `${width}%`,
            top: 2,
            bottom: 2,
            borderRadius: 2,
            background: span.errored ? "var(--sev-critical)" : SPAN_KIND_COLOR[span.kind],
          }}
        />
      </div>
    </div>
  );
}

function SpanDetailPanel({ span, traceIdLabel, ctx }: { span: SpanNodeVM; traceIdLabel: string; ctx: ScreenCtx }) {
  const copyId = () => {
    try {
      navigator.clipboard?.writeText(traceIdLabel);
    } catch {
      /* clipboard unavailable — toast still confirms intent */
    }
    ctx.pushToast("Trace ID copied");
  };
  return (
    <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="sh-card__head">
        <h2 className="sh-h2">Span detail</h2>
        {span.errored ? <span className="sh-tag critical">error</span> : <span className="sh-tag ok">{span.kind}</span>}
      </div>
      <div className="sh-card__body" style={{ overflow: "auto", flex: 1, display: "grid", gap: 16, alignContent: "start" }}>
        <div>
          <div className="sh-eyebrow" style={{ marginBottom: 6 }}>Name</div>
          <div className="sh-mono" style={{ fontSize: 13, color: "var(--fg)" }}>{span.name}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Kv k="Started" v={`+${Math.round(span.offsetMs)} ms`} mono />
          <Kv k="Duration" v={`${Math.round(span.durMs)} ms`} mono />
          <Kv k="Service" v={span.service ?? "—"} mono />
          <Kv k="Kind" v={span.kind} mono />
          <Kv k="Status" v={span.status} mono tone={span.errored ? "danger" : null} />
          <Kv k="Cost" v={span.costUsd != null ? formatUsd(Number(span.costUsd)) : "—"} mono />
        </div>
        {span.errored ? (
          <div>
            <div className="sh-eyebrow" style={{ marginBottom: 6 }}>Error</div>
            <div className="sh-code" style={{ whiteSpace: "pre-wrap" }}>{boundText(stringifyUnknown(span.error)) || "—"}</div>
          </div>
        ) : null}
        <div>
          <div className="sh-eyebrow" style={{ marginBottom: 6 }}>Attributes</div>
          <div className="sh-code" style={{ maxHeight: 130, overflow: "auto", whiteSpace: "pre-wrap" }}>{spanAttributes(span)}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sh-btn primary" onClick={() => ctx.pushToast("Linking spans to incidents is not yet available")}>
            <Icon name="error" size={13} />
            Open incident
          </button>
          <button className="sh-btn" onClick={copyId}>
            <Icon name="copy" size={13} />
            Copy ID
          </button>
        </div>
      </div>
    </div>
  );
}

function TraceDetailView({ ctx, trace, onBack }: { ctx: ScreenCtx; trace: TraceListItemVM; onBack: () => void }) {
  const { data: detail, status } = useTraceSpans({
    client: ctx.client,
    projectId: ctx.project?.id,
    environmentId: ctx.environment?.id,
    traceId: trace.id,
  });

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<WaterfallFilter>("All");
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  // Default-select the first errored span (else the root) once spans load.
  useEffect(() => {
    if (!detail || detail.spans.length === 0) return;
    setSelectedSpanId((cur) => cur ?? (detail.spans.find((s) => s.errored)?.id ?? detail.spans[0].id));
  }, [detail]);

  const back = (
    <button className="sh-btn ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={onBack}>
      <Icon name="arrow" size={12} style={{ transform: "rotate(180deg)" }} />
      Recent traces
    </button>
  );

  const summary = detail?.summary;
  const hasError = trace.hasError || (summary ? summary.errorCount > 0 : false);
  const spanCount = summary?.spanCount ?? 0;
  const totalMs = summary?.totalMs ?? 0;
  const errorCount = summary?.errorCount ?? 0;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const spans = detail?.spans ?? [];
  const visible = computeVisible(spans, filter, collapsed, Math.max(totalMs, 1));
  const selectedSpan = spans.find((s) => s.id === selectedSpanId) ?? null;

  return (
    <>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          {back}
          {hasError ? <span className="sh-tag warn">● Has error</span> : <span className="sh-tag ok">{trace.status}</span>}
          <span className="sh-tag mono">{trace.traceId}</span>
          <span className="sh-tag mono">{(trace.userId ?? "—")} · {(trace.tenantId ?? "—")}</span>
          <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>started {formatUtcTimestamp(trace.startedAt)}</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "6px 0", fontFamily: "var(--font-mono)" }}>{trace.name}</h1>
        <p className="sh-muted" style={{ margin: 0, fontSize: 13 }}>
          {spanCount} spans · {formatLatency(totalMs)} total · {errorCount} {errorCount === 1 ? "error" : "errors"}
        </p>
      </div>

      <div className="sh-card">
        <div className="sh-card__body" style={{ display: "flex", gap: 32, padding: "12px 18px", alignItems: "center", flexWrap: "wrap" }}>
          <SummaryStat label="Duration" value={formatLatency(totalMs)} />
          <Divider />
          <SummaryStat label="Spans" value={String(spanCount)} />
          <Divider />
          <SummaryStat label="LLM cost" value={formatUsd(summary?.llmCostUsd ?? 0)} mono />
          <Divider />
          <SummaryStat label="LLM time" value={formatLatency(summary?.llmTimeMs ?? 0)} />
          <Divider />
          <SummaryStat label="DB time" value={formatLatency(summary?.dbTimeMs ?? 0)} />
          <Divider />
          <SummaryStat label="Errors" value={String(errorCount)} tone={errorCount > 0 ? "danger" : undefined} />
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
            {(Object.entries(SPAN_KIND_COLOR) as [string, string][]).map(([k, c]) => (
              <Legend key={k} color={c} label={k} />
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Waterfall</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="sh-btn ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setCollapsed(new Set())}>
                Expand all
              </button>
              <Segmented options={["All", "Slow", "Errors"]} value={filter} onChange={(v) => setFilter(v as WaterfallFilter)} />
            </div>
          </div>

          {status === "loading" && !detail ? (
            <EmptyHint icon="waterfall" title="Loading…" sub="Fetching spans." />
          ) : status === "error" ? (
            <EmptyHint icon="alert" title="Could not load spans" sub="Check your connection or try again." />
          ) : spans.length === 0 ? (
            <EmptyHint icon="waterfall" title="No spans for this trace" />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "280px 60px 1fr",
                  borderBottom: "1px solid var(--border-subtle)",
                  padding: "8px 16px",
                  fontSize: 10.5,
                  color: "var(--fg-faint)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <span>Span</span>
                <span>Dur</span>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  {rulerLabels(Math.max(totalMs, 1)).map((label, i) => (
                    <span key={i}>{label}</span>
                  ))}
                </div>
              </div>
              <div style={{ overflow: "auto", flex: 1 }}>
                {visible.map((s) => (
                  <WaterfallRow
                    key={s.id}
                    span={s}
                    totalMs={Math.max(totalMs, 1)}
                    treeMode={filter === "All"}
                    isCollapsed={collapsed.has(s.id)}
                    isActive={s.id === selectedSpanId}
                    onSelect={() => setSelectedSpanId(s.id)}
                    onToggle={() => toggle(s.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {selectedSpan ? (
          <SpanDetailPanel span={selectedSpan} traceIdLabel={trace.traceId} ctx={ctx} />
        ) : (
          <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="sh-card__head"><h2 className="sh-h2">Span detail</h2></div>
            <EmptyHint icon="waterfall" title="Select a span" sub="Pick a span in the waterfall to inspect it." />
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function TracesScreen({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const [selectedTraceId, setSelectedTraceId] = useState<string | undefined>(undefined);
  const [selectedEndpointName, setSelectedEndpointName] = useState<string | null>(null);

  const { data, endpoints, serviceMap, webVitals, runtimeProfiles, totals, status } = useTraces({
    client: ctx.client,
    projectId,
    environmentId,
    endpointName: selectedEndpointName,
  });

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="waterfall" title="No project selected" sub="Select a project and environment to view traces." />
      </div>
    );
  }

  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="waterfall" title="Loading…" sub="Fetching recent traces." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="alert" title="Could not load traces" sub="Check your connection or try again." />
      </div>
    );
  }

  const selectedTrace = selectedTraceId ? data.find((t) => t.id === selectedTraceId) : undefined;

  if (selectedTrace) {
    return (
      <TraceDetailView
        key={selectedTrace.id}
        ctx={ctx}
        trace={selectedTrace}
        onBack={() => setSelectedTraceId(undefined)}
      />
    );
  }

  return (
    <TraceListView
      ctx={ctx}
      traces={data}
      endpoints={endpoints}
      totals={totals}
      serviceMap={serviceMap}
      webVitals={webVitals}
      runtimeProfiles={runtimeProfiles}
      activeEndpoint={selectedEndpointName}
      onSelectEndpoint={(name) => {
        setSelectedTraceId(undefined);
        setSelectedEndpointName(name);
      }}
      onClearEndpoint={() => setSelectedEndpointName(null)}
      onOpen={setSelectedTraceId}
    />
  );
}

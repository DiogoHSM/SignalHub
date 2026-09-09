import { useRef, useState } from "react";
import type { NavSection } from "../nav";
import type { ScreenCtx } from "./registry";
import { useOverview } from "./useOverview";
import type {
  ActivityItemVM,
  AnomalyVM,
  KpisVM,
  LlmByModelVM,
  OperationsDestination,
  OperationsVM,
  PredictionVM,
  RecommendedActionVM,
  TenantVM,
  TelemetryCoverageVM,
} from "./useOverview";
import type { OverviewWindow, ReleaseSummary } from "../../api/types";
import {
  Card,
  EmptyHint,
  Icon,
  PageHead,
  Segmented,
  Sparkline,
} from "../../components/ui/v2";
import { formatCompactNumber } from "../../components/ui/v2/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NavigateFn = (section: NavSection) => void;

type TabId = "tenants" | "ai" | "releases" | "activity" | "latency";

// ---------------------------------------------------------------------------
// Attention — incident card
// ---------------------------------------------------------------------------

function IncidentAttentionCard({
  incidents,
  alerts,
  topMessage,
  topSeverity,
  topGroupId,
  topErrorId,
  errorsSparkline,
  onOpenIncident,
  onViewIncidents,
}: {
  incidents: number;
  alerts: number;
  topMessage: string | null;
  topSeverity: string | null;
  topGroupId: string | null;
  topErrorId: string | null;
  errorsSparkline: number[];
  onOpenIncident: () => void;
  onViewIncidents: () => void;
}) {
  const isCritical = topSeverity === "critical" || topSeverity === "fatal";
  const sevKey = isCritical ? "critical" : "warning";
  const sevColor = `var(--sev-${sevKey})`;
  return (
    <section
      aria-label="Top active incident"
      className="sh-card sh-stripe critical sh-stack"
    >
      <div style={{ padding: "16px 16px 12px", flex: 1 }}>
        <div className="sh-cluster-8 sh-cluster-wrap">
          <span className={`sh-tag ${sevKey}`}>{topSeverity ?? "critical"}</span>
          {topErrorId ? <span className="sh-tag mono">{topErrorId}</span> : null}
          <span className="sh-faint sh-copy-11-5">
            {incidents} active incident{incidents !== 1 ? "s" : ""}
            {alerts > 0 ? ` · ${alerts} alert${alerts !== 1 ? "s" : ""} fired` : ""}
          </span>
        </div>
        {topMessage ? (
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.35,
              color: "var(--fg)",
            }}
          >
            {topMessage}
          </p>
        ) : null}
        {errorsSparkline.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <Sparkline data={errorsSparkline} color={sevColor} height={44} />
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderTop: "1px solid var(--border-subtle)",
          flexWrap: "wrap",
        }}
      >
        <button className="sh-btn primary" onClick={onOpenIncident}>
          Open incident <Icon name="arrow" size={12} />
        </button>
        <button className="sh-btn ghost" onClick={onViewIncidents}>
          All incidents ({incidents})
        </button>
      </div>
    </section>
  );
}

const COVERAGE_COPY: Record<TelemetryCoverageVM["state"], [string, string]> = {
  missing: ["No telemetry in this window", "Send a test event and confirm the project and environment in your SDK configuration."],
  insufficient: ["Insufficient baseline", "Telemetry is arriving, but the comparison does not yet support a reliable baseline. Review the collected signals."],
  stale: ["Telemetry is outside this window", "The latest reported signal predates this window. Check ingestion or choose a wider window."],
  healthy: ["No active incidents reported", "Available operational checks report healthy. Review coverage before treating this as complete service health."],
  incidents: ["Active incidents need attention", "Review the affected signals and open the incident below to investigate impact."],
  attention: ["Operational checks need attention", "Review the findings below and inspect the affected monitors or signals."],
  unknown: ["Telemetry status unavailable", "Freshness or operational evidence is unavailable. Refresh the overview to try again."],
};

function CoveragePanel({ coverage, onSetup, onReload }: { coverage: TelemetryCoverageVM; onSetup: () => void; onReload: () => void }) {
  const [title, description] = COVERAGE_COPY[coverage.state];
  return <section className="sh-card" aria-label="Telemetry coverage">
    <div className="sh-card__body">
      <h2 className="sh-h2">{title}</h2>
      <p className="sh-muted sh-copy-12">{coverage.signalCount} signals in the selected scope and window · Latest reported event, error or trace: {coverage.lastSignalAt ? new Date(coverage.lastSignalAt).toLocaleString() : "unavailable"}</p>
      <p className="sh-muted sh-copy-12">{description}</p>
      <div className="sh-cluster-8 sh-cluster-wrap">
        <span className="sh-faint sh-copy-11">Snapshot: {new Date(coverage.generatedAt).toLocaleString()}</span>
        {coverage.state === "missing" || coverage.state === "stale" ? <button className="sh-btn" onClick={onSetup}>Check SDK installation</button> : null}
        <button className="sh-btn" onClick={onReload}>Refresh overview</button>
      </div>
    </div>
  </section>;
}

function AllClearBanner({
  projectName,
  envName,
  window: timeWindow,
  onViewRules,
}: {
  projectName: string;
  envName: string;
  window: OverviewWindow;
  onViewRules: () => void;
}) {
  return (
    <section aria-label="No active incidents" className="sh-card">
      <div
        className="sh-card__body"
        style={{ display: "flex", alignItems: "center", gap: 16, paddingLeft: 24 }}
      >
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--accent-bg-subtle)",
            color: "var(--accent)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon name="check" size={18} stroke={2.4} />
        </span>
        <div className="sh-grow">
          <div className="sh-copy-14-strong">No active incidents</div>
          <div className="sh-muted sh-copy-12" style={{ marginTop: 2 }}>
            {projectName} · {envName}: no active incidents reported over the last {timeWindow}. Check telemetry coverage above.
          </div>
        </div>
        <button className="sh-btn" onClick={onViewRules}>
          <Icon name="bell" size={13} /> View rules
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Attention — Up next
// ---------------------------------------------------------------------------

function toneColor(tone: RecommendedActionVM["tone"]): string {
  if (tone === "critical") return "var(--sev-critical)";
  if (tone === "warning") return "var(--sev-warning)";
  return "var(--accent)";
}

function UpNextPanel({ actions, onOpen }: { actions: RecommendedActionVM[]; onOpen: (action: RecommendedActionVM) => void }) {
  return (
    <section aria-label="Recommended next actions" className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Up next</h2>
        <span className="sh-tag">priority order</span>
      </div>
      {actions.length === 0 ? (
        <EmptyHint icon="activity" title="No urgent actions" sub="No recommended actions were returned. Review telemetry coverage before drawing conclusions." />
      ) : (
        <div className="sh-stack">
          {actions.slice(0, 4).map((action, i) => (
            <button
              aria-label={action.title}
              key={action.key}
              onClick={() => onOpen(action)}
              style={{
                display: "grid",
                gridTemplateColumns: "34px 1fr auto",
                alignItems: "start",
                gap: 12,
                padding: "12px 14px",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-subtle)",
                cursor: "pointer",
              }}
            >
              <span
                className="sh-mono sh-faint"
                style={{ fontSize: 12, paddingTop: 2 }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="sh-min-w-0">
                <strong className="sh-copy-12-5" style={{ display: "block" }}>{action.title}</strong>
                <span
                  className="sh-muted"
                  style={{ display: "block", fontSize: 11.5, lineHeight: 1.45, marginTop: 3 }}
                >
                  {action.description}
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    color: toneColor(action.tone),
                    fontSize: 11.5,
                    fontWeight: 600,
                    marginTop: 7,
                  }}
                >
                  {action.action} <Icon name="arrow" size={11} />
                </span>
              </span>
              <Icon name="chev" size={13} style={{ color: "var(--fg-faint)", marginTop: 2 }} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Metrics strip
// ---------------------------------------------------------------------------

const WINDOW_LABEL: Record<OverviewWindow, string> = {
  "24h": "last 24h",
  "7d": "last 7 days",
  "30d": "last 30 days",
};

type MetricItem = {
  label: string;
  value: string;
  spark?: number[];
  color?: string;
};

function buildMetrics(kpis: KpisVM): MetricItem[] {
  return [
    {
      label: "Errors",
      value: formatCompactNumber(kpis.errors),
      spark: kpis.errorsSparkline.length > 0 ? kpis.errorsSparkline : undefined,
      color: "var(--sev-critical)",
    },
    {
      label: "Error rate",
      value:
        kpis.errorRate != null ? `${Math.min(kpis.errorRate, 100).toFixed(1)}%` : "—",
    },
    {
      label: "Events",
      value: formatCompactNumber(kpis.events),
      spark: kpis.usageSparkline.length > 0 ? kpis.usageSparkline : undefined,
      color: "var(--accent)",
    },
    {
      label: "p95 trace",
      value: kpis.p95TraceDurationMs != null ? `${kpis.p95TraceDurationMs} ms` : "—",
      spark: kpis.latencySparkline.length > 0 ? kpis.latencySparkline : undefined,
      color: "var(--sev-warning)",
    },
    {
      label: "LLM cost",
      value: `$ ${parseFloat(kpis.llmCostUsd).toFixed(2)}`,
      spark: kpis.aiCostSparkline.length > 0 ? kpis.aiCostSparkline : undefined,
      color: "var(--sev-violet)",
    },
    {
      label: "Active users",
      value: String(kpis.activeUsers),
    },
  ];
}

function MetricsStrip({ kpis, window: timeWindow }: { kpis: KpisVM; window: OverviewWindow }) {
  const [collapsed, setCollapsed] = useState(false);
  const metrics = buildMetrics(kpis);
  return (
    <section aria-label="Key metrics" className="sh-card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 14px",
          borderBottom: collapsed ? "none" : "1px solid var(--border-subtle)",
        }}
      >
        <button
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "none",
            color: "var(--fg-secondary)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            padding: 0,
          }}
        >
          <Icon
            name="chevd"
            size={12}
            style={{
              transform: collapsed ? "rotate(-90deg)" : "none",
              transition: "transform .2s",
            }}
          />
          Metrics · {WINDOW_LABEL[timeWindow]}
        </button>
      </div>
      {!collapsed ? (
        <div
          className="overview-kpi-grid"
          style={{
            display: "grid",
            gap: 10,
            padding: 12,
          }}
        >
          {metrics.map((m) => (
            <div
              key={m.label}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "12px 14px",
                background: "var(--bg-canvas)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 10,
                minWidth: 0,
              }}
            >
              <span className="sh-kpi__label" title={m.label}>
                {m.label}
              </span>
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--fg)",
                }}
              >
                {m.value}
              </span>
              {m.spark ? (
                <div style={{ marginTop: "auto" }}>
                  <Sparkline data={m.spark} color={m.color} height={24} />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

function severityColor(severity: PredictionVM["severity"] | AnomalyVM["severity"]): string {
  if (severity === "critical") return "var(--sev-critical)";
  if (severity === "high" || severity === "warning" || severity === "medium") return "var(--sev-warning)";
  return "var(--accent)";
}

function SignalCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">{title}</h2>
        {badge}
      </div>
      <div className="sh-card__body sh-stack" style={{ gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

function PredictiveRiskPanel({
  predictions,
  onOpen,
}: {
  predictions: PredictionVM[];
  onOpen: (destination: OperationsDestination) => void;
}) {
  const hasCritical = predictions.some((p) => p.severity === "critical");
  return (
    <SignalCard
      title="Predictive risk"
      badge={
        <span className={`sh-tag ${predictions.length ? (hasCritical ? "critical" : "warn") : "solid"}`}>
          {predictions.length ? `${predictions.length} projected` : "no estimate"}
        </span>
      }
    >
      {predictions.length === 0 ? (
        <EmptyHint
          icon="sparkles"
          title="No predictive risk estimate"
          sub="No supported prediction is available for this window. This does not establish a healthy baseline."
        />
      ) : (
        predictions.map((prediction) => (
          <div
            key={prediction.id}
            style={{
              borderLeft: `3px solid ${severityColor(prediction.severity)}`,
              paddingLeft: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "start",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div className="sh-min-w-0">
                <strong className="sh-copy-13">{prediction.label}</strong>
                <p className="sh-muted sh-copy-12">{prediction.sampleSize} current samples contribute to this finding. Review the affected signals before acting.</p>
                <details><summary>Prediction model details</summary>
                <div className="sh-muted sh-meta-line-md">
                  {Math.round(prediction.probabilityPercent)}% probability · {prediction.confidence} confidence · score{" "}
                  {prediction.score.toFixed(2)} vs {prediction.baselineRiskScore.toFixed(2)} baseline
                </div>
                <div className="sh-faint sh-meta-line">
                  {prediction.sampleSize} / {prediction.baselineSampleSize} samples · delta{" "}
                  {prediction.delta >= 0 ? "+" : ""}
                  {prediction.delta.toFixed(2)} · {prediction.method}
                </div>
                {prediction.factors.length > 0 ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${Math.min(prediction.factors.length, 3)}, minmax(0, 1fr))`,
                      gap: 8,
                      marginTop: 10,
                    }}
                  >
                    {prediction.factors.map((factor) => (
                      <div
                        key={factor.key}
                        style={{
                          padding: 8,
                          background: "var(--bg-canvas)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 6,
                        }}
                      >
                        <strong style={{ fontSize: 11 }}>
                          {factor.label} · {factor.weight.toFixed(2)}
                        </strong>
                        <div className="sh-muted" style={{ fontSize: 11, marginTop: 3 }}>
                          {factor.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                </details>
              </div>
              <button className="sh-btn compact" onClick={() => onOpen(prediction.destination)}>
                Open <Icon name="arrow" size={11} />
              </button>
            </div>
          </div>
        ))
      )}
    </SignalCard>
  );
}

function AnomaliesPanel({
  anomalies,
  onOpen,
}: {
  anomalies: AnomalyVM[];
  onOpen: (destination: OperationsDestination) => void;
}) {
  const hasCritical = anomalies.some((a) => a.severity === "critical");
  return (
    <SignalCard
      title="Detected anomalies"
      badge={
        <span className={`sh-tag ${anomalies.length ? (hasCritical ? "critical" : "warn") : "solid"}`}>
          {anomalies.length ? `${anomalies.length} detected` : "none reported"}
        </span>
      }
    >
      {anomalies.length === 0 ? (
        <EmptyHint
          icon="check"
          title="No anomalies detected"
          sub="No anomalies were returned for this scope. Coverage and baseline availability determine what can be detected."
        />
      ) : (
        anomalies.map((anomaly) => (
          <div
            key={anomaly.id}
            style={{
              borderLeft: `3px solid ${severityColor(anomaly.severity)}`,
              paddingLeft: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div className="sh-min-w-0">
                <strong className="sh-copy-13">{anomaly.label}</strong>
                <div className="sh-muted sh-meta-line-md">
                  {anomaly.reason}
                </div>
              </div>
              <button className="sh-btn compact" onClick={() => onOpen(anomaly.destination)}>
                Drill down <Icon name="arrow" size={11} />
              </button>
            </div>
            <details><summary>Anomaly comparison details</summary>
            <div className="sh-faint" style={{ fontSize: 11, marginTop: 7 }}>
              Observed {anomaly.observedValue} · Baseline {anomaly.baselineValue} ·{" "}
              {anomaly.changePercent == null
                ? "change unavailable"
                : `${anomaly.changePercent >= 0 ? "+" : ""}${anomaly.changePercent.toFixed(1)}%`}
              {" · "}
              {anomaly.sampleSize} / {anomaly.baselineSampleSize} samples
            </div>
            <div className="sh-faint sh-meta-line">
              Threshold: {anomaly.threshold}
              {anomaly.suggestedAlertRuleType ? ` · Suggested rule: ${anomaly.suggestedAlertRuleType}` : ""}
            </div>
            </details>
          </div>
        ))
      )}
    </SignalCard>
  );
}

// ---------------------------------------------------------------------------
// Explore tabs
// ---------------------------------------------------------------------------

const TAB_ORDER: TabId[] = ["tenants", "ai", "releases", "activity", "latency"];

const TAB_LABEL: Record<TabId, string> = {
  tenants: "Top tenants",
  ai: "AI cost",
  releases: "Releases",
  activity: "Activity",
  latency: "Top latency",
};

const TAB_HINT: Record<TabId, string> = {
  tenants: "ranked by events",
  ai: "cost share · today",
  releases: "latest deploys",
  activity: "live tail",
  latency: "slowest routes by p95",
};

const MODEL_COLORS = [
  "var(--sev-violet)",
  "var(--accent)",
  "var(--sev-info)",
  "var(--sev-warning)",
  "var(--fg-muted)",
];

function ExploreTabs({
  tenants,
  models,
  releases,
  selectedRelease,
  onSelectRelease,
  activity,
  latency,
  window: timeWindow,
  onOpenTenant,
  onOpenIncident,
  navigate,
}: {
  tenants: TenantVM[];
  models: LlmByModelVM[];
  releases: ReleaseSummary[];
  selectedRelease: string | null;
  onSelectRelease: (release: string | null) => void;
  activity: ActivityItemVM[];
  latency: OperationsVM["topLatency"];
  window: OverviewWindow;
  onOpenTenant: (tenantId: string) => void;
  onOpenIncident: (groupId: string, errorId?: string) => void;
  navigate: NavigateFn;
}) {
  const [tab, setTab] = useState<TabId>("tenants");
  const tablistId = "explore-tabs";
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusTab(idx: number) {
    tabRefs.current[idx]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const idx = TAB_ORDER.indexOf(tab);
    let next = -1;
    if (event.key === "ArrowRight") next = (idx + 1) % TAB_ORDER.length;
    if (event.key === "ArrowLeft") next = (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = TAB_ORDER.length - 1;
    if (next >= 0) {
      event.preventDefault();
      setTab(TAB_ORDER[next]);
      focusTab(next);
    }
  }

  return (
    <section aria-label="Explore data" className="sh-card">
      <div className="sh-card__head" style={{ paddingTop: 9, paddingBottom: 9 }}>
        <div
          role="tablist"
          aria-label="Explore sections"
          id={tablistId}
          style={{ display: "flex", alignItems: "center", gap: 2 }}
        >
          {TAB_ORDER.map((t, i) => {
            const selected = t === tab;
            return (
              <button
                key={t}
                id={`${tablistId}-${t}`}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                aria-selected={selected}
                aria-controls="explore-body"
                aria-labelledby={`${tablistId}-${t}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(t)}
                onKeyDown={onKeyDown}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "none",
                  background: selected ? "var(--bg-surface-2)" : "transparent",
                  color: selected ? "var(--fg)" : "var(--fg-muted)",
                  fontSize: 12.5,
                  fontWeight: selected ? 600 : 500,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {TAB_LABEL[t]}
                {t === "activity" ? <span className="sh-live-dot" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
        <span className="sh-tag">{TAB_HINT[tab]}</span>
      </div>
      <div id="explore-body" role="tabpanel" aria-labelledby={`${tablistId}-${tab}`}>
        {tab === "tenants" && (
          <TopTenantsPanel tenants={tenants} onOpenTenant={onOpenTenant} />
        )}
        {tab === "ai" && <LlmByModelPanel models={models} window={timeWindow} />}
        {tab === "releases" && (
          <ReleasesPanel
            releases={releases}
            selectedRelease={selectedRelease}
            onSelectRelease={onSelectRelease}
          />
        )}
        {tab === "activity" && (
          <RecentActivityPanel
            items={activity}
            navigate={navigate}
            onOpenIncident={onOpenIncident}
          />
        )}
        {tab === "latency" && <TopLatencyPanel rows={latency} onOpen={() => navigate("traces")} />}
      </div>
    </section>
  );
}

function TopTenantsPanel({ tenants, onOpenTenant }: { tenants: TenantVM[]; onOpenTenant: (tenantId: string) => void }) {
  return (
    <div className="sh-table-scroll">
      {tenants.length === 0 ? (
        <div className="sh-empty-inset">
          <EmptyHint icon="users" title="No tenant data" sub="Events will appear here once tenants start sending data." />
        </div>
      ) : (
        tenants.map((t, i) => {
          const errColor =
            t.errors > 3 ? "var(--sev-critical)" : t.errors > 0 ? "var(--sev-warning)" : "var(--accent)";
          const errBg =
            t.errors > 3
              ? "var(--sev-critical-bg)"
              : t.errors > 0
              ? "var(--sev-warning-bg)"
              : "var(--accent-bg-subtle)";
          return (
            <button
              key={t.id}
              aria-label={t.name}
              onClick={() => onOpenTenant(t.id)}
              style={{
                display: "grid",
                gridTemplateColumns: "24px minmax(0, 1fr) 72px 84px 64px",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-subtle)",
                cursor: "pointer",
              }}
            >
              <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="sh-min-w-0">
                <strong className="sh-copy-12-5">{t.name}</strong>
                <div className="sh-mono sh-faint sh-copy-11">
                  {t.id}
                </div>
              </div>
              <span className="sh-muted" style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
                {formatCompactNumber(t.events)}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--sev-violet)", fontSize: 12 }}>
                $ {parseFloat(t.costUsd).toFixed(2)}
              </span>
              <span
                className="sh-tag"
                style={{
                  background: errBg,
                  color: errColor,
                  borderColor: "transparent",
                }}
              >
                {t.errors} err
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function LlmByModelPanel({ models, window: timeWindow }: { models: LlmByModelVM[]; window: string }) {
  const total = models.reduce((s, m) => s + (Number(m.costUsd) || 0), 0) || 1;
  return (
    <div className="sh-empty-inset" style={{ padding: 14 }}>
      {models.length === 0 ? (
        <EmptyHint icon="sparkles" title="No model data" sub="LLM call data will appear here." />
      ) : (
        <div className="sh-investigation-grid" style={{ gap: 13 }}>
          {models.map((m, i) => {
            const cost = Number(m.costUsd) || 0;
            const pct = Math.round((cost / total) * 100);
            const color = MODEL_COLORS[i % MODEL_COLORS.length];
            return (
              <div key={m.model}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    marginBottom: 5,
                  }}
                >
                  <span className="sh-mono">{m.model}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    $ {cost.toFixed(2)} <span className="sh-faint">· {pct}%</span>
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: "var(--bg-canvas)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      background: color,
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReleasesPanel({
  releases,
  selectedRelease,
  onSelectRelease,
}: {
  releases: ReleaseSummary[];
  selectedRelease: string | null;
  onSelectRelease: (release: string | null) => void;
}) {
  return (
    <div>
      {releases.length === 0 ? (
        <div className="sh-empty-inset">
          <EmptyHint icon="flag" title="No releases yet" sub="Send a release value from the SDK to compare deploys." />
        </div>
      ) : (
        releases.map((release) => {
          const selected = release.release === selectedRelease;
          const shortCommit = release.code?.commitSha ? release.code.commitSha.slice(0, 7) : null;
          return (
            <button
              key={release.release}
              aria-label={`${release.release} release`}
              onClick={() => onSelectRelease(selected ? null : release.release)}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                background: selected ? "var(--accent-bg-subtle)" : "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-subtle)",
                padding: "10px 14px",
                cursor: "pointer",
              }}
            >
              <div className="sh-min-w-0">
                <strong className="sh-mono sh-copy-12">
                  {release.release}
                </strong>
                <div className="sh-faint sh-meta-line">
                  {release.events} events · {release.errors} errors · {release.traces} traces
                </div>
                {shortCommit ? (
                  <span className="sh-tag mono" style={{ marginTop: 4, display: "inline-block" }}>
                    commit {shortCommit}
                  </span>
                ) : null}
              </div>
              <span
                className={
                  release.failedTraces > 0 || release.errors > 0 ? "sh-tag warn" : "sh-tag ok"
                }
              >
                {release.failedTraces} failed
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

const ACTIVITY_NAV: Record<ActivityItemVM["kind"], NavSection> = {
  error: "incidents",
  llm: "llm",
  trace: "traces",
};

const ACTIVITY_ICON: Record<ActivityItemVM["kind"], "error" | "sparkles" | "waterfall"> = {
  error: "error",
  llm: "sparkles",
  trace: "waterfall",
};

const ACTIVITY_COLOR: Record<ActivityItemVM["kind"], string> = {
  error: "var(--sev-critical)",
  llm: "var(--sev-violet)",
  trace: "var(--sev-info)",
};

function RecentActivityPanel({
  items,
  onOpenIncident,
  navigate,
}: {
  items: ActivityItemVM[];
  onOpenIncident: (groupId: string, errorId?: string) => void;
  navigate: NavigateFn;
}) {
  return (
    <div>
      {items.length === 0 ? (
        <div className="sh-empty-inset">
          <EmptyHint icon="activity" title="No recent activity" sub="Events will appear here in real time." />
        </div>
      ) : (
        items.map((item, i) => {
          const dest = ACTIVITY_NAV[item.kind];
          const color = ACTIVITY_COLOR[item.kind];
          const iconName = ACTIVITY_ICON[item.kind];
          return (
            <button
              key={i}
              aria-label={item.title}
              onClick={() => {
                if (item.kind === "error" && item.groupId) {
                  onOpenIncident(item.groupId, item.errorId);
                  return;
                }
                navigate(dest);
              }}
              style={{
                display: "flex",
                gap: 10,
                padding: "10px 14px",
                borderBottom: "1px solid var(--border-subtle)",
                alignItems: "center",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderBottomColor: "var(--border-subtle)",
                borderBottomStyle: "solid",
                borderBottomWidth: 1,
                cursor: "pointer",
              }}
            >
              <span style={{ color }}>
                <Icon name={iconName} size={14} />
              </span>
              <div className="sh-grow sh-min-w-0">
                <div className="sh-mono sh-copy-12">
                  {item.title}
                </div>
                {item.sub ? (
                  <div className="sh-faint sh-copy-11">
                    {item.sub}
                  </div>
                ) : null}
              </div>
              <Icon name="chev" size={12} style={{ color: "var(--fg-faint)" }} />
            </button>
          );
        })
      )}
    </div>
  );
}

function TopLatencyPanel({ rows, onOpen }: { rows: OperationsVM["topLatency"]; onOpen: () => void }) {
  return (
    <div className="sh-table-scroll">
      {rows.length === 0 ? (
        <div className="sh-empty-inset">
          <EmptyHint icon="waterfall" title="No trace latency in this window" sub="Trace routes will appear after telemetry arrives." />
        </div>
      ) : (
        rows.map((row) => (
          <button
            key={row.name}
            onClick={onOpen}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 96px 76px 72px",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid var(--border-subtle)",
              cursor: "pointer",
            }}
          >
            <strong className="sh-mono sh-copy-12">
              {row.name}
            </strong>
            <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
              {row.p95TraceDurationMs} ms <span className="sh-faint">p95</span>
            </span>
            <span className="sh-muted" style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
              {row.traces} traces
            </span>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontSize: 12,
                color: row.failedTraces > 0 ? "var(--sev-warning)" : "var(--fg-faint)",
              }}
            >
              {row.failedTraces} failed
            </span>
          </button>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

const WINDOW_OPTIONS: OverviewWindow[] = ["24h", "7d", "30d"];

export function OverviewScreen({
  ctx,
  navigate,
}: {
  ctx: ScreenCtx;
  navigate: NavigateFn;
}) {
  const [window, setWindow] = useState<OverviewWindow>("24h");

  const projectId = ctx.project?.id ?? "";
  const environmentId = ctx.environment?.id ?? "";
  const projectName = ctx.project?.name ?? "—";
  const envName = ctx.environment?.name ?? "—";

  const { data, status, reload } = useOverview({
    client: ctx.client,
    projectId,
    environmentId,
    window,
  });

  const pageHead = (
      <PageHead
        title="Overview"
        sub={
          <>
            Signals, incidents and coverage for{" "}
            <strong style={{ color: "var(--fg)" }}>
              {projectName} · {envName}
            </strong>
          </>
        }
        actions={
          <Segmented
            options={WINDOW_OPTIONS}
            value={window}
            onChange={(v) => setWindow(v as OverviewWindow)}
          />
        }
      />
  );

  if (status === "loading") {
    return (
      <>{pageHead}<div className="sh-empty-region">
        <EmptyHint icon="activity" title="Loading…" sub="Fetching overview data." />
      </div></>
    );
  }

  if (status === "error" || !data) {
    return (
      <>{pageHead}<div className="sh-empty-region">
        <EmptyHint icon="alert" title="Could not load overview" sub="Check your connection or try again." />
        <button className="sh-btn" onClick={reload}>Retry overview</button>
      </div></>
    );
  }

  const {
    banner,
    operations,
    kpis,
    topTenants,
    llmByModel,
    releases,
    selectedRelease,
    selectRelease,
    activity,
  } = data;

  const openDestination = (destination: OperationsDestination) => {
    if (destination === "investigate") {
      ctx.navigate("investigate", { status: "open" });
      return;
    }
    if (destination === "incident") return;
    navigate(destination);
  };

  const openRecommendedAction = (action: RecommendedActionVM) => {
    if (action.destination === "incident" && action.groupId) {
      ctx.drill("incident", { groupId: action.groupId, errorId: action.errorId });
      return;
    }
    openDestination(action.destination);
  };

  return (
    <>
      {pageHead}

      {data.coverage ? <CoveragePanel coverage={data.coverage} onSetup={() => navigate("installation")} onReload={reload} /> : null}

      {/* Attention zone */}
      <div
        className="overview-attention"
        style={{
          display: "grid",
          gap: 16,
        }}
      >
        {banner.incidents > 0 ? (
          <IncidentAttentionCard
            incidents={banner.incidents}
            alerts={banner.alerts}
            topMessage={banner.top?.message ?? null}
            topSeverity={banner.top?.severity ?? null}
            topGroupId={banner.top?.groupId ?? null}
            topErrorId={banner.top?.errorId ?? null}
            errorsSparkline={kpis.errorsSparkline}
            onOpenIncident={() =>
              banner.top && ctx.drill("incident", { groupId: banner.top.groupId, errorId: banner.top.errorId ?? undefined })
            }
            onViewIncidents={() => navigate("incidents")}
          />
        ) : data.coverage && ["missing", "stale", "unknown"].includes(data.coverage.state) ? null : (
          <AllClearBanner
            projectName={projectName}
            envName={envName}
            window={window}
            onViewRules={() => navigate("alerts")}
          />
        )}
        <UpNextPanel actions={operations.recommendedActions} onOpen={openRecommendedAction} />
      </div>

      {/* Metrics strip */}
      <MetricsStrip kpis={kpis} window={window} />

      {/* Signals zone */}
      <div className="overview-signals sh-investigation-grid sh-grid-16">
        <PredictiveRiskPanel predictions={operations.predictions} onOpen={openDestination} />
        <AnomaliesPanel anomalies={operations.anomalies} onOpen={openDestination} />
      </div>

      {/* Explore tabs */}
      <ExploreTabs
        tenants={topTenants}
        models={llmByModel}
        releases={releases}
        selectedRelease={selectedRelease}
        onSelectRelease={selectRelease}
        activity={activity}
        latency={operations.topLatency}
        window={window}
        onOpenTenant={(tenantId) => ctx.drill("tenant", { tenantId })}
        onOpenIncident={(groupId, errorId) => ctx.drill("incident", { groupId, errorId })}
        navigate={navigate}
      />
    </>
  );
}

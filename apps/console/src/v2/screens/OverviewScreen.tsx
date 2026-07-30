import { useState } from "react";
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

// ---------------------------------------------------------------------------
// KpiGroup (co-located, Overview-specific)
// ---------------------------------------------------------------------------

type KpiItem = {
  label: string;
  value: string | number;
  /** Optional tooltip — used to surface an un-clamped raw value alongside a clamped display value. */
  title?: string;
  delta?: string;
  deltaDir?: "up" | "down";
  spark?: number[];
  color?: string;
  small?: boolean;
};

function KpiGroup({ title, icon, items }: {
  title: string;
  icon: "pulse" | "activity" | "sparkles";
  items: KpiItem[];
}) {
  const cols = items.length > 3 ? "1fr 1fr" : "1fr";
  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name={icon} size={15} /> {title}
        </h2>
      </div>
      <div
        className="sh-card__body"
        style={{ display: "grid", gridTemplateColumns: cols, gap: 14 }}
      >
        {items.map((it, i) => (
          <div key={i}>
            <div className="sh-kpi__label">{it.label}</div>
            <div
              className="sh-kpi__value"
              title={it.title}
              style={{
                fontSize: it.small ? 14 : 22,
                fontFamily: it.small ? "var(--font-mono)" : "var(--font-sans)",
                marginTop: 4,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {it.value}
            </div>
            {it.spark ? (
              <div style={{ marginTop: 6 }}>
                <Sparkline data={it.spark} color={it.color} height={26} />
              </div>
            ) : it.delta ? (
              <div className="sh-kpi__meta" style={{ marginTop: 4 }}>
                <span className={`sh-delta ${it.deltaDir ?? "up"}`}>{it.delta}</span>{" "}
                vs. yesterday
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function IncidentBanner({
  incidents,
  alerts,
  topMessage,
  topSeverity,
  onOpenIncident,
  onViewIncidents,
}: {
  incidents: number;
  alerts: number;
  topMessage: string | null;
  topSeverity: string | null;
  onOpenIncident?: () => void;
  onViewIncidents: () => void;
}) {
  const isCritical = topSeverity === "critical";
  const stripeClass = isCritical ? "critical" : "warn";
  const sevKey = isCritical ? "critical" : "warning";
  const iconName = isCritical ? "error" : "bolt";
  return (
    <div className={`sh-card sh-stripe ${stripeClass}`}>
      <div
        className="sh-card__body"
        style={{ display: "flex", alignItems: "center", gap: 20, paddingLeft: 24 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `var(--sev-${sevKey}-bg)`,
              color: `var(--sev-${sevKey})`,
              display: "grid",
              placeItems: "center",
            }}
          >
            <Icon name={iconName} size={18} />
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {incidents} incident{incidents !== 1 ? "s" : ""} active · {alerts} alert
              {alerts !== 1 ? "s" : ""} fired (30 min)
            </div>
            {topMessage ? (
              <div className="sh-muted" style={{ fontSize: 12, marginTop: 2 }}>
                {topMessage}
              </div>
            ) : null}
          </div>
        </div>
        <button className="sh-btn primary" onClick={onOpenIncident ?? onViewIncidents}>
          {onOpenIncident ? "Open incident" : "View incidents"} <Icon name="arrow" size={12} />
        </button>
      </div>
    </div>
  );
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
    <div className="sh-card sh-stripe ok">
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
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>No active incidents</div>
          <div className="sh-muted" style={{ fontSize: 12, marginTop: 2 }}>
            {projectName} · {envName} operating within expected range over the last {timeWindow}.
          </div>
        </div>
        <button className="sh-btn" onClick={onViewRules}>
          <Icon name="bell" size={13} /> View rules
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI helpers
// ---------------------------------------------------------------------------

function buildHealthItems(kpis: KpisVM, openIncidents: number): KpiItem[] {
  return [
    {
      label: "Errors (24h)",
      value: formatCompactNumber(kpis.errors),
      spark: kpis.errorsSparkline.length > 0 ? kpis.errorsSparkline : undefined,
      color: "var(--sev-critical)",
    },
    {
      label: "Open incidents",
      value: String(openIncidents),
    },
    {
      label: "Error rate",
      // Metric definition: errors / traces * 100 (see useOverview.ts). This is
      // a ratio of two independently-counted signals, not a bounded fraction —
      // a route can log several errors per completed trace (retries, nested
      // failures), so the raw value can exceed 100%. Clamp the *display* at
      // 100% so the KPI reads as a rate instead of an alarming outlier, while
      // keeping the exact raw value available on hover for triage.
      value: kpis.errorRate != null ? `${Math.min(kpis.errorRate, 100).toFixed(1)}%` : "—",
      title: kpis.errorRate != null && kpis.errorRate > 100 ? `Raw: ${kpis.errorRate.toFixed(1)}% (errors can exceed traces)` : undefined,
    },
  ];
}

function buildUsageItems(kpis: KpisVM): KpiItem[] {
  return [
    {
      label: "Events",
      value: formatCompactNumber(kpis.events),
      spark: kpis.usageSparkline.length > 0 ? kpis.usageSparkline : undefined,
      color: "var(--accent)",
    },
    { label: "Active users", value: String(kpis.activeUsers) },
    { label: "Active tenants", value: String(kpis.activeTenants) },
    { label: "Traces", value: formatCompactNumber(kpis.traces) },
    {
      label: "p95 trace",
      value: kpis.p95TraceDurationMs != null ? `${kpis.p95TraceDurationMs} ms` : "—",
      spark: kpis.latencySparkline.length > 0 ? kpis.latencySparkline : undefined,
      color: "var(--sev-warning)",
    },
    {
      label: "Avg trace",
      value: kpis.averageTraceDurationMs != null ? `${Math.round(kpis.averageTraceDurationMs)} ms` : "—",
    },
  ];
}

function buildAiItems(kpis: KpisVM): KpiItem[] {
  return [
    {
      label: "LLM calls",
      value: formatCompactNumber(kpis.llmCalls),
      spark: kpis.aiCostSparkline.length > 0 ? kpis.aiCostSparkline : undefined,
      color: "var(--sev-violet)",
    },
    {
      label: "Cost today",
      value: `$ ${parseFloat(kpis.llmCostUsd).toFixed(2)}`,
    },
    { label: "Tokens", value: "—" },
    {
      label: "Top model",
      value: kpis.topModel ?? "—",
      small: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Operations panels
// ---------------------------------------------------------------------------

function toneColor(tone: RecommendedActionVM["tone"] | PredictionVM["severity"] | AnomalyVM["severity"]): string {
  if (tone === "critical") return "var(--sev-critical)";
  if (tone === "high" || tone === "medium" || tone === "warning") return "var(--sev-warning)";
  return "var(--accent)";
}

function OperationalPosture({ operations, navigate }: { operations: OperationsVM; navigate: NavigateFn }) {
  const { posture } = operations;
  return (
    <section aria-label="Operational posture" className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Operational posture</h2>
        <span className={`sh-tag ${posture.status === "healthy" ? "ok" : posture.status === "unhealthy" ? "critical" : "warn"}`}>
          {posture.status.replace("_", " ")}
        </span>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.35fr", gap: 16 }}>
        <div>
          <div className="sh-kpi__label">Monitors</div>
          <div className="sh-kpi__value" style={{ fontSize: 22, marginTop: 4 }}>{posture.monitors.total}</div>
          <div className="sh-muted" style={{ fontSize: 12, marginTop: 4 }}>
            {posture.monitors.up} up, {posture.monitors.down} down, {posture.monitors.degraded} degraded
          </div>
          <div className="sh-faint" style={{ fontSize: 11, marginTop: 3 }}>
            {posture.monitors.paused} paused, {posture.monitors.unknown} unknown
          </div>
          <button className="sh-btn compact" style={{ marginTop: 10 }} onClick={() => navigate("monitors")}>
            <Icon name="pulse" size={13} /> Open monitors
          </button>
        </div>
        <div>
          <div className="sh-kpi__label">Alerts</div>
          <div className="sh-kpi__value" style={{ fontSize: 22, marginTop: 4 }}>{posture.alerts.events}</div>
          <div className="sh-muted" style={{ fontSize: 12, marginTop: 4 }}>
            {posture.alerts.enabledRules} enabled rules, {posture.alerts.critical} critical, {posture.alerts.deliveryFailed} delivery failures
          </div>
          <button className="sh-btn compact" style={{ marginTop: 10 }} onClick={() => navigate("alerts")}>
            <Icon name="bell" size={13} /> Open alerts
          </button>
        </div>
        <div>
          <div className="sh-kpi__label">Setup</div>
          {posture.setupGaps.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
              <span style={{ color: "var(--accent)" }}><Icon name="check" size={15} /></span>
              <strong style={{ fontSize: 13 }}>Setup complete</strong>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6, marginTop: 7 }}>
              {posture.setupGaps.map((gap) => (
                <button
                  aria-label={gap.label}
                  className="sh-row sh-row--btn"
                  key={gap.key}
                  onClick={() => navigate(gap.destination as NavSection)}
                  style={{ gridTemplateColumns: "auto 1fr auto", minHeight: 34, width: "100%", border: "1px solid var(--border-subtle)", background: "transparent", textAlign: "left" }}
                >
                  <span className={`sh-tag ${gap.severity === "warning" ? "warn" : ""}`}>{gap.severity}</span>
                  <span style={{ fontSize: 12 }}>{gap.label}</span>
                  <Icon name="chev" size={12} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function RecommendedActions({ actions, onOpen }: { actions: RecommendedActionVM[]; onOpen: (action: RecommendedActionVM) => void }) {
  return (
    <section aria-label="Recommended next actions" className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Recommended next actions</h2>
        <span className="sh-tag">priority order</span>
      </div>
      {actions.length === 0 ? (
        <EmptyHint icon="check" title="No urgent actions" sub="Operational signals are stable for this window." />
      ) : (
        <div className="sh-card__body" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          {actions.slice(0, 4).map((action) => (
            <button
              aria-label={action.title}
              className="sh-row sh-row--btn"
              data-testid="recommended-action"
              key={action.key}
              onClick={() => onOpen(action)}
              style={{ display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "start", minHeight: 118, padding: 12, border: "1px solid var(--border-subtle)", background: "transparent", textAlign: "left" }}
            >
              <span style={{ color: toneColor(action.tone), paddingTop: 2 }}><Icon name={action.tone === "critical" ? "error" : "alert"} size={15} /></span>
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: "block", fontSize: 12 }}>{action.title}</strong>
                <span className="sh-muted" style={{ display: "block", fontSize: 11, lineHeight: 1.45, marginTop: 4 }}>{action.description}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5, color: toneColor(action.tone), fontSize: 11, marginTop: 8 }}>
                  {action.action} <Icon name="arrow" size={11} />
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function PredictiveRiskPanel({ predictions, onOpen }: { predictions: PredictionVM[]; onOpen: (destination: OperationsDestination) => void }) {
  return (
    <section aria-label="Predictive risk" className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Predictive risk</h2>
        <span className={`sh-tag ${predictions.some((item) => item.severity === "critical") ? "critical" : predictions.length ? "warn" : "ok"}`}>
          {predictions.length ? `${predictions.length} projected` : "stable"}
        </span>
      </div>
      {predictions.length === 0 ? (
        <EmptyHint icon="sparkles" title="No predictive risk" sub="The current window is tracking close to the learned baseline." />
      ) : (
        <div className="sh-card__body" style={{ display: "grid", gap: 12 }}>
          {predictions.map((prediction) => (
            <div key={prediction.id} style={{ borderLeft: `3px solid ${toneColor(prediction.severity)}`, paddingLeft: 12 }}>
              <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <strong style={{ fontSize: 13 }}>{prediction.label}</strong>
                  <div className="sh-muted" style={{ fontSize: 11, marginTop: 3 }}>
                    {Math.round(prediction.probabilityPercent)}% probability · {prediction.confidence} confidence · score {prediction.score.toFixed(2)} vs {prediction.baselineRiskScore.toFixed(2)} baseline
                  </div>
                  <div className="sh-faint" style={{ fontSize: 11, marginTop: 3 }}>
                    {prediction.sampleSize} / {prediction.baselineSampleSize} samples · delta {prediction.delta >= 0 ? "+" : ""}{prediction.delta.toFixed(2)} · {prediction.method}
                  </div>
                </div>
                <button className="sh-btn compact" onClick={() => onOpen(prediction.destination)}>
                  Open <Icon name="arrow" size={11} />
                </button>
              </div>
              {prediction.factors.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(prediction.factors.length, 3)}, minmax(0, 1fr))`, gap: 8, marginTop: 10 }}>
                  {prediction.factors.map((factor) => (
                    <div key={factor.key} style={{ padding: 8, background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 6 }}>
                      <strong style={{ fontSize: 11 }}>{factor.label} · {factor.weight.toFixed(2)}</strong>
                      <div className="sh-muted" style={{ fontSize: 11, marginTop: 3 }}>{factor.reason}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AnomaliesPanel({ anomalies, onOpen }: { anomalies: AnomalyVM[]; onOpen: (destination: OperationsDestination) => void }) {
  return (
    <section aria-label="Detected anomalies" className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Detected anomalies</h2>
        <span className={`sh-tag ${anomalies.some((item) => item.severity === "critical") ? "critical" : anomalies.length ? "warn" : "ok"}`}>
          {anomalies.length ? `${anomalies.length} detected` : "stable"}
        </span>
      </div>
      {anomalies.length === 0 ? (
        <EmptyHint icon="check" title="No anomalies detected" sub="Volume, errors, latency, and cost are within baseline." />
      ) : (
        <div className="sh-card__body" style={{ display: "grid", gap: 10 }}>
          {anomalies.map((anomaly) => (
            <div key={anomaly.id} style={{ borderLeft: `3px solid ${toneColor(anomaly.severity)}`, paddingLeft: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <strong style={{ fontSize: 13 }}>{anomaly.label}</strong>
                  <div className="sh-muted" style={{ fontSize: 11, marginTop: 3 }}>{anomaly.reason}</div>
                </div>
                <button className="sh-btn compact" onClick={() => onOpen(anomaly.destination)}>Drill down <Icon name="arrow" size={11} /></button>
              </div>
              <div className="sh-faint" style={{ fontSize: 11, marginTop: 7 }}>
                Observed {anomaly.observedValue} · Baseline {anomaly.baselineValue} · {anomaly.changePercent == null ? "change unavailable" : `${anomaly.changePercent >= 0 ? "+" : ""}${anomaly.changePercent.toFixed(1)}%`} · {anomaly.sampleSize} / {anomaly.baselineSampleSize} samples
              </div>
              <div className="sh-faint" style={{ fontSize: 11, marginTop: 3 }}>
                Threshold: {anomaly.threshold}{anomaly.suggestedAlertRuleType ? ` · Suggested rule: ${anomaly.suggestedAlertRuleType}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TopLatencyPanel({ rows, onOpen }: { rows: OperationsVM["topLatency"]; onOpen: () => void }) {
  return (
    <section aria-label="Top latency" className="sh-card">
      <div className="sh-card__head"><h2 className="sh-h2">Top latency</h2></div>
      {rows.length === 0 ? (
        <EmptyHint icon="waterfall" title="No trace latency in this window" sub="Trace routes will appear after telemetry arrives." />
      ) : (
        <div>
          {rows.map((row) => (
            <div className="sh-row" key={row.name} style={{ gridTemplateColumns: "minmax(0, 1fr) 90px 70px 70px auto" }}>
              <strong className="sh-mono" style={{ fontSize: 12 }}>{row.name}</strong>
              <span>{row.p95TraceDurationMs} ms p95</span>
              <span>{row.traces} traces</span>
              <span>{row.failedTraces} failed</span>
              <button aria-label="Open traces" className="sh-btn compact" onClick={onOpen}>Open traces</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Top tenants panel
// ---------------------------------------------------------------------------

function TopTenantsPanel({ tenants, onOpenTenant }: { tenants: TenantVM[]; onOpenTenant: (tenantId: string) => void }) {
  return (
    <Card
      title="Top tenants — activity"
      actions={<span className="sh-tag">ranked by events</span>}
      flush
    >
      {tenants.length === 0 ? (
        <EmptyHint icon="users" title="No tenant data" sub="Events will appear here once tenants start sending data." />
      ) : (
        tenants.map((t, i) => {
          const errColor =
            t.errors > 3
              ? "var(--sev-critical)"
              : t.errors > 0
              ? "var(--sev-warning)"
              : "var(--accent)";
          const errBg =
            t.errors > 3
              ? "var(--sev-critical-bg)"
              : t.errors > 0
              ? "var(--sev-warning-bg)"
              : "var(--accent-bg-subtle)";
          return (
            <button
              key={t.id}
              className="sh-row sh-row--btn"
              aria-label={t.name}
              style={{
                gridTemplateColumns: "20px 2.5fr 88px 70px",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-subtle)",
              }}
              onClick={() => onOpenTenant(t.id)}
            >
              <span className="sh-muted sh-mono">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <strong style={{ fontSize: 13 }}>{t.name}</strong>
                <div className="sh-mono sh-faint" style={{ fontSize: 11 }}>
                  {t.id}
                </div>
              </div>
              <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--sev-violet)" }}>
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
    </Card>
  );
}

// ---------------------------------------------------------------------------
// LLM cost by model panel
// ---------------------------------------------------------------------------

const MODEL_COLORS = [
  "var(--sev-violet)",
  "var(--accent)",
  "var(--sev-info)",
  "var(--sev-warning)",
  "var(--fg-muted)",
];

function LlmByModelPanel({ models, window: timeWindow }: { models: LlmByModelVM[]; window: string }) {
  const total = models.reduce((s, m) => s + (Number(m.costUsd) || 0), 0) || 1;
  return (
    <Card title="LLM cost by model" actions={<span className="sh-tag">{timeWindow}</span>}>
      {models.length === 0 ? (
        <EmptyHint icon="sparkles" title="No model data" sub="LLM call data will appear here." />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {models.map((m, i) => {
            const cost = Number(m.costUsd) || 0;
            const frac = cost / total;
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
                    $ {cost.toFixed(2)}
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
                      width: `${Math.round(frac * 100)}%`,
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
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Releases panel
// ---------------------------------------------------------------------------

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
    <Card
      title="Releases"
      actions={
        selectedRelease ? (
          <button className="sh-btn compact" onClick={() => onSelectRelease(null)}>
            Clear filter
          </button>
        ) : (
          <span className="sh-tag">latest deploys</span>
        )
      }
      flush
    >
      {releases.length === 0 ? (
        <EmptyHint icon="flag" title="No releases yet" sub="Send a release value from the SDK to compare deploys." />
      ) : (
        releases.map((release) => {
          const selected = release.release === selectedRelease;
          const shortCommit = release.code?.commitSha ? release.code.commitSha.slice(0, 7) : null;
          return (
            <div
              key={release.release}
              className="sh-row sh-row--btn"
              role="button"
              tabIndex={0}
              aria-label={`${release.release} release`}
              style={{
                gridTemplateColumns: "minmax(0, 1fr) auto",
                width: "100%",
                textAlign: "left",
                background: selected ? "var(--accent-bg-subtle)" : "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-subtle)",
                cursor: "pointer",
              }}
              onClick={() => onSelectRelease(release.release)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectRelease(release.release);
              }}
            >
              <div style={{ minWidth: 0 }}>
                <strong className="sh-mono" style={{ fontSize: 12 }}>
                  {release.release}
                </strong>
                <div className="sh-faint" style={{ fontSize: 11, marginTop: 3 }}>
                  {release.events} events · {release.errors} errors · {release.traces} traces
                </div>
                {release.code ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 5 }}>
                    {release.code.commitUrl && shortCommit ? (
                      <a className="sh-tag mono" href={release.code.commitUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                        commit {shortCommit}
                      </a>
                    ) : shortCommit ? (
                      <span className="sh-tag mono">commit {shortCommit}</span>
                    ) : null}
                    {release.code.pullRequestUrl ? (
                      <a className="sh-tag mono" href={release.code.pullRequestUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                        PR {release.code.pullRequestNumber ? `#${release.code.pullRequestNumber}` : ""}
                      </a>
                    ) : null}
                    {release.code.deployedBy ? <span className="sh-tag">by {release.code.deployedBy}</span> : null}
                  </div>
                ) : null}
              </div>
              <span className={release.failedTraces > 0 || release.errors > 0 ? "sh-tag warn" : "sh-tag ok"}>
                {release.failedTraces} failed
              </span>
            </div>
          );
        })
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recent activity panel
// ---------------------------------------------------------------------------

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
    <Card
      title="Recent activity"
      actions={
        <span className="sh-tag ok">
          <span className="sh-live-dot" /> live
        </span>
      }
      flush
    >
      {items.length === 0 ? (
        <EmptyHint icon="activity" title="No recent activity" sub="Events will appear here in real time." />
      ) : (
        items.map((item, i) => {
          const dest = ACTIVITY_NAV[item.kind];
          const color = ACTIVITY_COLOR[item.kind];
          const iconName = ACTIVITY_ICON[item.kind];
          return (
            <button
              key={i}
              aria-label={item.title}
              style={{
                display: "flex",
                gap: 10,
                padding: "10px 16px",
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
              onClick={() => {
                if (item.kind === "error" && item.groupId) {
                  onOpenIncident(item.groupId, item.errorId);
                  return;
                }
                navigate(dest);
              }}
            >
              <span style={{ color }}>
                <Icon name={iconName} size={14} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sh-mono" style={{ fontSize: 12 }}>
                  {item.title}
                </div>
                {item.sub ? (
                  <div className="sh-faint" style={{ fontSize: 11 }}>
                    {item.sub}
                  </div>
                ) : null}
              </div>
              <Icon name="chev" size={12} style={{ color: "var(--fg-faint)" }} />
            </button>
          );
        })
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// OverviewScreen
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

  const { data, status } = useOverview({
    client: ctx.client,
    projectId,
    environmentId,
    window,
  });

  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="activity" title="Loading…" sub="Fetching overview data." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="alert"
          title="Could not load overview"
          sub="Check your connection or try again."
        />
      </div>
    );
  }

  const { banner, operations, kpis, topTenants, llmByModel, releases, selectedRelease, selectRelease, activity } = data;

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
      <PageHead
        title="Operations"
        sub={
          <>
            Pulse of{" "}
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

      {/* Health banner */}
      {banner.incidents > 0 ? (
        <IncidentBanner
          incidents={banner.incidents}
          alerts={banner.alerts}
          topMessage={banner.top?.message ?? null}
          topSeverity={banner.top?.severity ?? null}
          onOpenIncident={
            banner.top
              ? () => ctx.drill("incident", { groupId: banner.top!.groupId, errorId: banner.top!.errorId ?? undefined })
              : undefined
          }
          onViewIncidents={() => navigate("incidents")}
        />
      ) : (
        <AllClearBanner
          projectName={projectName}
          envName={envName}
          window={window}
          onViewRules={() => navigate("alerts")}
        />
      )}

      {/* KPI groups */}
      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1.5fr 1.4fr", gap: 16 }}>
        <KpiGroup title="Health" icon="pulse" items={buildHealthItems(kpis, banner.incidents)} />
        <KpiGroup title="Usage" icon="activity" items={buildUsageItems(kpis)} />
        <KpiGroup title="AI cost" icon="sparkles" items={buildAiItems(kpis)} />
      </div>

      <RecommendedActions actions={operations.recommendedActions} onOpen={openRecommendedAction} />

      <OperationalPosture operations={operations} navigate={navigate} />

      {/* Bottom row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr 1fr 1.1fr",
          gap: 16,
          flex: 1,
          minHeight: 0,
        }}
      >
        <TopTenantsPanel tenants={topTenants} onOpenTenant={(tenantId) => ctx.drill("tenant", { tenantId })} />
        <LlmByModelPanel models={llmByModel} window={window} />
        <ReleasesPanel releases={releases} selectedRelease={selectedRelease} onSelectRelease={selectRelease} />
        <RecentActivityPanel
          items={activity}
          navigate={navigate}
          onOpenIncident={(groupId, errorId) => ctx.drill("incident", { groupId, errorId })}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <PredictiveRiskPanel predictions={operations.predictions} onOpen={openDestination} />
        <AnomaliesPanel anomalies={operations.anomalies} onOpen={openDestination} />
      </div>

      <TopLatencyPanel rows={operations.topLatency} onOpen={() => navigate("traces")} />
    </>
  );
}

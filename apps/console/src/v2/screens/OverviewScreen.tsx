import { useState } from "react";
import type { NavSection } from "../nav";
import type { ScreenCtx } from "./registry";
import { useOverview } from "./useOverview";
import type { ActivityItemVM, KpisVM, LlmByModelVM, TenantVM } from "./useOverview";
import type { OverviewWindow } from "../../api/types";
import {
  Card,
  EmptyHint,
  Icon,
  PageHead,
  Segmented,
  Sparkline,
} from "../../components/ui/v2";

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
  onViewIncidents,
}: {
  incidents: number;
  alerts: number;
  topMessage: string | null;
  topSeverity: string | null;
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
        <button className="sh-btn primary" onClick={onViewIncidents}>
          View incidents <Icon name="arrow" size={12} />
        </button>
      </div>
    </div>
  );
}

function AllClearBanner({
  projectName,
  envName,
  onViewRules,
}: {
  projectName: string;
  envName: string;
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
            {projectName} · {envName} operating within expected range over the last 24h.
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

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function buildHealthItems(kpis: KpisVM, openIncidents: number): KpiItem[] {
  return [
    {
      label: "Errors (24h)",
      value: fmtNum(kpis.errors),
      spark: kpis.errorsSparkline.length > 0 ? kpis.errorsSparkline : undefined,
      color: "var(--sev-critical)",
    },
    {
      label: "Open incidents",
      value: String(openIncidents),
    },
    {
      label: "Error rate",
      value: kpis.errorRate != null ? `${kpis.errorRate.toFixed(1)}%` : "—",
    },
  ];
}

function buildUsageItems(kpis: KpisVM): KpiItem[] {
  return [
    {
      label: "Events",
      value: fmtNum(kpis.events),
      spark: kpis.usageSparkline.length > 0 ? kpis.usageSparkline : undefined,
      color: "var(--accent)",
    },
    { label: "Active users", value: String(kpis.activeUsers) },
    { label: "Active tenants", value: String(kpis.activeTenants) },
    { label: "Traces", value: fmtNum(kpis.traces) },
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
      value: fmtNum(kpis.llmCalls),
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
// Top tenants panel
// ---------------------------------------------------------------------------

function TopTenantsPanel({ tenants, navigate }: { tenants: TenantVM[]; navigate: NavigateFn }) {
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
              onClick={() => navigate("investigate")}
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
  const total = models.reduce((s, m) => s + parseFloat(m.costUsd), 0) || 1;
  return (
    <Card title="LLM cost by model" actions={<span className="sh-tag">{timeWindow}</span>}>
      {models.length === 0 ? (
        <EmptyHint icon="sparkles" title="No model data" sub="LLM call data will appear here." />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {models.map((m, i) => {
            const cost = parseFloat(m.costUsd);
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

// Need the type to not cause circular imports
type ActivityItemVMLocal = {
  kind: "error" | "trace" | "llm";
  title: string;
  sub: string | null;
  timestamp: string;
};

function RecentActivityPanel({
  items,
  navigate,
}: {
  items: ActivityItemVMLocal[];
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
              onClick={() => navigate(dest)}
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

  const { banner, kpis, topTenants, llmByModel, activity } = data;

  return (
    <>
      <PageHead
        title="Overview"
        sub={
          <>
            Pulse of{" "}
            <strong style={{ color: "var(--fg)" }}>
              {projectName} · {envName}
            </strong>
          </>
        }
        actions={
          <>
            <Segmented
              options={WINDOW_OPTIONS}
              value={window}
              onChange={(v) => setWindow(v as OverviewWindow)}
            />
            <button className="sh-btn">
              <Icon name="download" size={14} /> Export
            </button>
          </>
        }
      />

      {/* Health banner */}
      {banner.incidents > 0 ? (
        <IncidentBanner
          incidents={banner.incidents}
          alerts={banner.alerts}
          topMessage={banner.top?.message ?? null}
          topSeverity={banner.top?.severity ?? null}
          onViewIncidents={() => navigate("incidents")}
        />
      ) : (
        <AllClearBanner
          projectName={projectName}
          envName={envName}
          onViewRules={() => navigate("alerts")}
        />
      )}

      {/* KPI groups */}
      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1.5fr 1.4fr", gap: 16 }}>
        <KpiGroup title="Health" icon="pulse" items={buildHealthItems(kpis, banner.incidents)} />
        <KpiGroup title="Usage" icon="activity" items={buildUsageItems(kpis)} />
        <KpiGroup title="AI cost" icon="sparkles" items={buildAiItems(kpis)} />
      </div>

      {/* Bottom row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr 1fr",
          gap: 16,
          flex: 1,
          minHeight: 0,
        }}
      >
        <TopTenantsPanel tenants={topTenants} navigate={navigate} />
        <LlmByModelPanel models={llmByModel} window={window} />
        <RecentActivityPanel items={activity} navigate={navigate} />
      </div>
    </>
  );
}

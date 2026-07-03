import type { OverviewResponse } from "../api/types";
import { formatNumber } from "./ui/v2/format";

type Props = {
  kpis: OverviewResponse["kpis"];
  deltas?: OverviewResponse["deltas"];
};

type OverviewDelta = NonNullable<OverviewResponse["deltas"]>[keyof NonNullable<OverviewResponse["deltas"]>];

function formatDuration(value: number | null): string {
  if (value === null) return "0 ms";
  return `${formatNumber(value)} ms`;
}

function formatCurrency(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 2, style: "currency" }).format(parsed);
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatDelta(delta: OverviewDelta | undefined, unit = "") {
  if (!delta || delta.absolute === null) return null;
  const absolute = typeof delta.absolute === "string" ? Number(delta.absolute) : delta.absolute;
  if (!Number.isFinite(absolute)) return null;
  const percent = delta.percent === null ? "" : ` (${delta.percent > 0 ? "+" : ""}${delta.percent}%)`;
  return `${formatSigned(absolute)}${unit}${percent} vs prior window`;
}

export function OverviewKpiGrid({ kpis, deltas }: Props) {
  const totalTokens = kpis.llmInputTokens + kpis.llmOutputTokens;
  const groups = [
    {
      title: "Signal intake",
      items: [
        { delta: formatDelta(deltas?.events), label: "Events", value: formatNumber(kpis.events) },
        { delta: formatDelta(deltas?.activeUsers), label: "Active users", value: formatNumber(kpis.activeUsers) },
        { delta: formatDelta(deltas?.activeTenants), label: "Active tenants", value: formatNumber(kpis.activeTenants) }
      ]
    },
    {
      title: "Reliability",
      items: [
        { delta: formatDelta(deltas?.errors), label: "Errors", value: formatNumber(kpis.errors) },
        { delta: formatDelta(deltas?.openErrors), label: "Open errors", value: formatNumber(kpis.openErrors) },
        { delta: formatDelta(deltas?.failedTraces), label: "Failed traces", value: formatNumber(kpis.failedTraces) }
      ]
    },
    {
      title: "Latency",
      items: [
        { delta: formatDelta(deltas?.traces), label: "Traces", value: formatNumber(kpis.traces) },
        { delta: formatDelta(deltas?.averageTraceDurationMs, " ms"), label: "Avg latency", value: formatDuration(kpis.averageTraceDurationMs) },
        { delta: formatDelta(deltas?.p95TraceDurationMs, " ms"), label: "P95 latency", value: formatDuration(kpis.p95TraceDurationMs) }
      ]
    },
    {
      title: "AI spend",
      items: [
        { delta: formatDelta(deltas?.llmCalls), label: "LLM calls", value: formatNumber(kpis.llmCalls) },
        { label: "LLM tokens", value: formatNumber(totalTokens) },
        { delta: formatDelta(deltas?.llmCostUsd), label: "LLM cost", value: formatCurrency(kpis.llmCostUsd) }
      ]
    }
  ];

  return (
    <section className="overview-kpis" aria-label="Overview KPIs">
      {groups.map((group) => (
        <article className="overview-kpi-group" key={group.title}>
          <h3>{group.title}</h3>
          <div className="overview-kpi-group__items">
            {group.items.map((item) => (
              <div className="overview-kpi" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                {item.delta ? <small>{item.delta}</small> : null}
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

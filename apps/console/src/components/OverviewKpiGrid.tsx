import type { OverviewResponse } from "../api/types";

type Props = {
  kpis: OverviewResponse["kpis"];
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(value: number | null): string {
  if (value === null) return "0 ms";
  return `${formatNumber(value)} ms`;
}

function formatCurrency(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 2, style: "currency" }).format(parsed);
}

export function OverviewKpiGrid({ kpis }: Props) {
  const totalTokens = kpis.llmInputTokens + kpis.llmOutputTokens;
  const groups = [
    {
      title: "Signal intake",
      items: [
        { label: "Events", value: formatNumber(kpis.events) },
        { label: "Active users", value: formatNumber(kpis.activeUsers) },
        { label: "Active tenants", value: formatNumber(kpis.activeTenants) }
      ]
    },
    {
      title: "Reliability",
      items: [
        { label: "Errors", value: formatNumber(kpis.errors) },
        { label: "Open errors", value: formatNumber(kpis.openErrors) },
        { label: "Failed traces", value: formatNumber(kpis.failedTraces) }
      ]
    },
    {
      title: "Latency",
      items: [
        { label: "Traces", value: formatNumber(kpis.traces) },
        { label: "Avg latency", value: formatDuration(kpis.averageTraceDurationMs) },
        { label: "P95 latency", value: formatDuration(kpis.p95TraceDurationMs) }
      ]
    },
    {
      title: "AI spend",
      items: [
        { label: "LLM calls", value: formatNumber(kpis.llmCalls) },
        { label: "LLM tokens", value: formatNumber(totalTokens) },
        { label: "LLM cost", value: formatCurrency(kpis.llmCostUsd) }
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
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

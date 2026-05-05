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

export function OverviewKpiGrid({ kpis }: Props) {
  const totalTokens = kpis.llmInputTokens + kpis.llmOutputTokens;
  const items = [
    { label: "Events", value: formatNumber(kpis.events) },
    { label: "Active users", value: formatNumber(kpis.activeUsers) },
    { label: "Active tenants", value: formatNumber(kpis.activeTenants) },
    { label: "Errors", value: formatNumber(kpis.errors) },
    { label: "Open errors", value: formatNumber(kpis.openErrors) },
    { label: "Traces", value: formatNumber(kpis.traces) },
    { label: "Avg latency", value: formatDuration(kpis.averageTraceDurationMs) },
    { label: "P95 latency", value: formatDuration(kpis.p95TraceDurationMs) },
    { label: "LLM calls", value: formatNumber(kpis.llmCalls) },
    { label: "LLM tokens", value: formatNumber(totalTokens) },
    { label: "LLM cost", value: kpis.llmCostUsd }
  ];

  return (
    <section className="overview-kpis" aria-label="Overview KPIs">
      {items.map((item) => (
        <article className="overview-kpi" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </section>
  );
}

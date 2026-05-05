import type { OverviewResponse } from "../api/types";

type Props = {
  trends: OverviewResponse["trends"];
};

type Trend = {
  title: string;
  valueLabel: string;
  series: Array<{ label: string; values: number[] }>;
};

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function points(values: number[], max: number): string {
  if (values.length === 0) return "0,36 100,36";

  const finiteValues = values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  return finiteValues
    .map((value, index) => {
      const x = finiteValues.length === 1 ? 50 : (index / (finiteValues.length - 1)) * 100;
      const y = 36 - (value / max) * 32;
      return `${x},${y}`;
    })
    .join(" ");
}

function total(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function chartMax(series: Trend["series"]): number {
  return Math.max(1, ...series.flatMap((item) => item.values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0))));
}

export function OverviewMiniTrends({ trends }: Props) {
  const trendItems: Trend[] = [
    {
      title: "Usage trend",
      valueLabel: `${total(trends.usage.map((bucket) => bucket.events))} events`,
      series: [
        { label: "Events", values: trends.usage.map((bucket) => bucket.events) },
        { label: "Traces", values: trends.usage.map((bucket) => bucket.traces) },
        { label: "LLM calls", values: trends.usage.map((bucket) => bucket.llmCalls) }
      ]
    },
    {
      title: "Error trend",
      valueLabel: `${total(trends.errors.map((bucket) => bucket.errors))} errors`,
      series: [
        { label: "Errors", values: trends.errors.map((bucket) => bucket.errors) },
        { label: "Open", values: trends.errors.map((bucket) => bucket.openErrors) },
        { label: "Severe", values: trends.errors.map((bucket) => bucket.severeErrors) }
      ]
    },
    {
      title: "Latency trend",
      valueLabel: `${Math.round(total(trends.latency.map((bucket) => bucket.averageTraceDurationMs)) / Math.max(1, trends.latency.length))} ms avg`,
      series: [
        { label: "Average", values: trends.latency.map((bucket) => bucket.averageTraceDurationMs) },
        { label: "P95", values: trends.latency.map((bucket) => bucket.p95TraceDurationMs ?? 0) }
      ]
    },
    {
      title: "AI cost trend",
      valueLabel: `${total(trends.aiCost.map((bucket) => toNumber(bucket.llmCostUsd))).toFixed(6)} USD`,
      series: [
        { label: "Cost", values: trends.aiCost.map((bucket) => toNumber(bucket.llmCostUsd)) },
        { label: "Calls", values: trends.aiCost.map((bucket) => bucket.llmCalls) }
      ]
    }
  ];

  return (
    <section className="overview-trends" aria-label="Overview trends">
      {trendItems.map((trend) => {
        const max = chartMax(trend.series);
        return (
          <article className="overview-trend" key={trend.title}>
            <div>
            <h3>{trend.title}</h3>
            <p>{trend.valueLabel}</p>
            </div>
            <svg aria-hidden="true" focusable="false" viewBox="0 0 100 40" preserveAspectRatio="none">
              {trend.series.map((series, index) => (
                <polyline
                  className={`overview-trend-line series-${index + 1}`}
                  fill="none"
                  key={series.label}
                  points={points(series.values, max)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              ))}
            </svg>
            <div className="overview-trend-legend">
              {trend.series.map((series, index) => (
                <span className={`series-${index + 1}`} key={series.label}>
                  {series.label}
                </span>
              ))}
            </div>
          </article>
        );
      })}
    </section>
  );
}

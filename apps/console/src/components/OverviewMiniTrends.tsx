import type { OverviewResponse } from "../api/types";

type Props = {
  trends: OverviewResponse["trends"];
};

type Trend = {
  title: string;
  valueLabel: string;
  values: number[];
};

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function points(values: number[]): string {
  if (values.length === 0) return "0,36 100,36";

  const finiteValues = values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const max = Math.max(1, ...finiteValues);
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

export function OverviewMiniTrends({ trends }: Props) {
  const trendItems: Trend[] = [
    {
      title: "Usage trend",
      valueLabel: `${total(trends.usage.map((bucket) => bucket.events))} events`,
      values: trends.usage.map((bucket) => bucket.events)
    },
    {
      title: "Error trend",
      valueLabel: `${total(trends.errors.map((bucket) => bucket.errors))} errors`,
      values: trends.errors.map((bucket) => bucket.errors)
    },
    {
      title: "Latency trend",
      valueLabel: `${Math.round(total(trends.latency.map((bucket) => bucket.averageTraceDurationMs)) / Math.max(1, trends.latency.length))} ms avg`,
      values: trends.latency.map((bucket) => bucket.averageTraceDurationMs)
    },
    {
      title: "AI cost trend",
      valueLabel: `${total(trends.aiCost.map((bucket) => toNumber(bucket.llmCostUsd))).toFixed(6)} USD`,
      values: trends.aiCost.map((bucket) => toNumber(bucket.llmCostUsd))
    }
  ];

  return (
    <section className="overview-trends" aria-label="Overview trends">
      {trendItems.map((trend) => (
        <article className="overview-trend" key={trend.title}>
          <div>
            <h3>{trend.title}</h3>
            <p>{trend.valueLabel}</p>
          </div>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 100 40" preserveAspectRatio="none">
            <polyline fill="none" points={points(trend.values)} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
        </article>
      ))}
    </section>
  );
}

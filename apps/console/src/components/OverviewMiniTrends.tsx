import type { OverviewResponse } from "../api/types";

type Props = {
  trends: OverviewResponse["trends"];
};

type Trend = {
  title: string;
  valueLabel: string;
  series: Array<{ label: string; values: number[]; formatValue?: (value: number) => string }>;
};

const chartFrame = {
  width: 720,
  height: 190,
  top: 18,
  right: 18,
  bottom: 34,
  left: 46
};

const plotWidth = chartFrame.width - chartFrame.left - chartFrame.right;
const plotHeight = chartFrame.height - chartFrame.top - chartFrame.bottom;

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 2, style: "currency" }).format(value);
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 10 ? 0 : 1, notation: value >= 1000 ? "compact" : "standard" }).format(value);
}

function integer(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function cleanValues(values: number[]): number[] {
  return values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
}

function pointFor(value: number, index: number, length: number, max: number): [number, number] {
  const x = chartFrame.left + (length <= 1 ? plotWidth / 2 : (index / (length - 1)) * plotWidth);
  const y = chartFrame.top + plotHeight - (value / max) * plotHeight;
  return [x, y];
}

function linePath(values: number[], max: number): string {
  const finiteValues = cleanValues(values);
  if (finiteValues.length === 0) return "";

  const coordinates = finiteValues.map((value, index) => pointFor(value, index, finiteValues.length, max));
  return coordinates
    .map(([x, y], index) => {
      if (index === 0) return `M ${x.toFixed(2)} ${y.toFixed(2)}`;
      const [previousX, previousY] = coordinates[index - 1];
      const controlX = (previousX + x) / 2;
      return `C ${controlX.toFixed(2)} ${previousY.toFixed(2)} ${controlX.toFixed(2)} ${y.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function areaPath(values: number[], max: number): string {
  const finiteValues = cleanValues(values);
  if (finiteValues.length === 0) return "";
  const line = linePath(finiteValues, max);
  const first = pointFor(finiteValues[0] ?? 0, 0, finiteValues.length, max);
  const last = pointFor(finiteValues[finiteValues.length - 1] ?? 0, finiteValues.length - 1, finiteValues.length, max);
  const baseline = chartFrame.top + plotHeight;
  return `${line} L ${last[0].toFixed(2)} ${baseline.toFixed(2)} L ${first[0].toFixed(2)} ${baseline.toFixed(2)} Z`;
}

function total(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function chartMax(series: Trend["series"]): number {
  const max = Math.max(0, ...series.flatMap((item) => cleanValues(item.values)));
  if (max <= 0) return 1;
  return niceCeil(max * 1.08);
}

function axisTicks(max: number): number[] {
  const steps = max <= 5 ? max : 4;
  const tickCount = Math.max(2, Math.min(5, Math.round(steps) + 1));
  return Array.from({ length: tickCount }, (_, index) => {
    const value = max - (max / (tickCount - 1)) * index;
    return value < 1 ? value : Math.round(value);
  });
}

function latest(values: number[]): number {
  const finiteValues = cleanValues(values);
  return finiteValues[finiteValues.length - 1] ?? 0;
}

function hasActivity(series: Trend["series"]): boolean {
  return series.some((item) => cleanValues(item.values).some((value) => value > 0));
}

function tickLabel(value: number): string {
  if (value >= 1000) return compactNumber(value);
  if (value < 1 && value > 0) return value.toFixed(2);
  return String(Math.round(value));
}

export function OverviewMiniTrends({ trends }: Props) {
  const trendItems: Trend[] = [
    {
      title: "Usage trend",
      valueLabel: `${integer(total(trends.usage.map((bucket) => bucket.events)))} events · ${integer(total(trends.usage.map((bucket) => bucket.traces)))} traces · ${integer(total(trends.usage.map((bucket) => bucket.llmCalls)))} LLM calls`,
      series: [
        { label: "Events", values: trends.usage.map((bucket) => bucket.events) },
        { label: "Traces", values: trends.usage.map((bucket) => bucket.traces) },
        { label: "LLM calls", values: trends.usage.map((bucket) => bucket.llmCalls) }
      ]
    },
    {
      title: "Error trend",
      valueLabel: `${integer(total(trends.errors.map((bucket) => bucket.errors)))} errors · ${integer(total(trends.errors.map((bucket) => bucket.openErrors)))} open · ${integer(total(trends.errors.map((bucket) => bucket.severeErrors)))} severe`,
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
      valueLabel: currency(total(trends.aiCost.map((bucket) => toNumber(bucket.llmCostUsd)))),
      series: [
        { label: "Cost", values: trends.aiCost.map((bucket) => toNumber(bucket.llmCostUsd)), formatValue: currency },
        { label: "Calls", values: trends.aiCost.map((bucket) => bucket.llmCalls) }
      ]
    }
  ];

  return (
    <section className="overview-trends" aria-label="Overview trends">
      {trendItems.map((trend) => {
        const max = chartMax(trend.series);
        const active = hasActivity(trend.series);
        const ticks = axisTicks(max);
        return (
          <article className="overview-trend" key={trend.title}>
            <div className="overview-trend__header">
              <div>
                <h3>{trend.title}</h3>
                <p>{trend.valueLabel}</p>
              </div>
            </div>
            <svg
              aria-label={`${trend.title} chart`}
              className="overview-trend-chart"
              focusable="false"
              preserveAspectRatio="none"
              role="img"
              viewBox={`0 0 ${chartFrame.width} ${chartFrame.height}`}
            >
              {ticks.map((tick, index) => {
                const y = chartFrame.top + (index / (ticks.length - 1)) * plotHeight;
                return (
                  <g className="overview-trend-grid" key={tick}>
                    <line x1={chartFrame.left} x2={chartFrame.width - chartFrame.right} y1={y} y2={y} />
                    <text x={chartFrame.left - 10} y={y + 4}>
                      {tickLabel(tick)}
                    </text>
                  </g>
                );
              })}
              <line className="overview-trend-axis" x1={chartFrame.left} x2={chartFrame.width - chartFrame.right} y1={chartFrame.top + plotHeight} y2={chartFrame.top + plotHeight} />
              {active ? (
                trend.series.map((series, index) => {
                  const path = linePath(series.values, max);
                  if (!path) return null;
                  return (
                    <g className={`overview-trend-series series-${index + 1}`} key={series.label}>
                      {index === 0 ? <path className="overview-trend-area" d={areaPath(series.values, max)} /> : null}
                      <path className="overview-trend-line" d={path} />
                    </g>
                  );
                })
              ) : (
                <text className="overview-trend-empty" x={chartFrame.left + plotWidth / 2} y={chartFrame.top + plotHeight / 2}>
                  No activity in this window
                </text>
              )}
            </svg>
            <div className="overview-trend-legend">
              {trend.series.map((series, index) => (
                <span className={`series-${index + 1}`} key={series.label}>
                  <span>{series.label}</span>
                  <strong>{(series.formatValue ?? compactNumber)(latest(series.values))}</strong>
                </span>
              ))}
            </div>
          </article>
        );
      })}
    </section>
  );
}

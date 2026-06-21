import { useId } from "react";

export function Sparkline({
  data,
  color = "var(--accent)",
  height = 36,
  fill = true,
}: {
  data: number[];
  color?: string;
  height?: number;
  fill?: boolean;
}) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100,
    h = 100;
  const stepX = w / Math.max(data.length - 1, 1);
  const points = data.map((v, i) => [
    i * stepX,
    h - ((v - min) / range) * (h * 0.92) - 4,
  ]);
  const d = points
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const dArea = `${d} L${w},${h} L0,${h} Z`;
  const rawId = useId();
  const gradId = `g${rawId.replace(/[:]/g, "")}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block" }}
      aria-hidden="true"
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={dArea} fill={`url(#${gradId})`} />
        </>
      ) : null}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Bars({
  data,
  color = "var(--accent)",
  height = 60,
  highlight = null,
}: {
  data: number[];
  color?: string;
  height?: number;
  highlight?: number | null;
}) {
  const max = Math.max(...data, 1);
  return (
    <>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${(v / max) * height}px`,
            background: highlight === i ? "var(--sev-critical)" : color,
            opacity: highlight === i ? 1 : 0.85,
            borderRadius: 2,
            minHeight: 2,
          }}
        />
      ))}
    </>
  );
}

export function MicroSpark({
  data,
  color = "var(--accent)",
  width = 56,
  height = 18,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = 100 / Math.max(data.length - 1, 1);
  const d = data
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${(i * stepX).toFixed(1)},${(100 - ((v - min) / range) * 84 - 8).toFixed(1)}`
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width, height, display: "block" }}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

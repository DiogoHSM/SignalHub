import { ReactNode } from "react";
import { Sparkline } from "./charts";

export function StatusPill({ status }: { status: "open" | "investigating" | "resolved" | "ignored" }) {
  const map = {
    open: { tone: "critical", label: "Open" },
    investigating: { tone: "warn", label: "Investigating" },
    resolved: { tone: "ok", label: "Resolved" },
    ignored: { tone: "solid", label: "Ignored" },
  };
  const m = map[status] || map.open;
  return <span className={`sh-tag ${m.tone}`}>{m.label}</span>;
}

export function PriorityPill({ p }: { p: "P1" | "P2" | "P3" | "P4" }) {
  const map = { P1: "critical", P2: "warn", P3: "info", P4: "solid" };
  return (
    <span className={`sh-tag ${map[p]}`} style={{ fontFamily: "var(--font-mono)" }}>
      {p}
    </span>
  );
}

export function BigKpi({
  label,
  value,
  sub,
  delta,
  deltaDir,
  spark,
  color,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
  deltaDir?: "up" | "down";
  spark?: number[];
  color?: string;
}) {
  return (
    <div className="sh-card" style={{ padding: 16 }}>
      <div className="sh-kpi__label">{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" }}>
          {value}
        </div>
        {delta ? (
          <span className={`sh-delta ${deltaDir}`} style={{ fontSize: 11.5 }}>
            {delta}
          </span>
        ) : null}
      </div>
      {sub ? (
        <div className="sh-faint" style={{ fontSize: 11, marginTop: 2 }}>
          {sub}
        </div>
      ) : null}
      {spark ? (
        <div style={{ marginTop: 10 }}>
          <Sparkline data={spark} color={color} height={32} />
        </div>
      ) : null}
    </div>
  );
}

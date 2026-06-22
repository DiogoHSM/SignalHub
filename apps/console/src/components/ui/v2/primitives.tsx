import type { CSSProperties, ReactNode } from "react";

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
      <div>
        <h1 className="sh-h1">{title}</h1>
        {sub ? <p className="sh-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{sub}</p> : null}
      </div>
      {actions ? <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>{actions}</div> : null}
    </div>
  );
}

export function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange?: (v: string) => void }) {
  return (
    <div className="sh-segmented">
      {options.map(o => (
        <button key={o} aria-pressed={o === value} onClick={() => onChange && onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

export function SummaryStat({ label, value, delta, tone, mono }: { label: ReactNode; value: ReactNode; delta?: ReactNode; tone?: "danger" | "ok"; mono?: boolean }) {
  return (
    <div>
      <div className="sh-kpi__label">{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
        <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums", fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)" }}>{value}</div>
        {delta ? <div className={`sh-delta ${
          // Intentional 1:1 port of the design quirk: a delta with no tone renders as "up" (positive/green).
          tone === "danger" ? "down" : "up"
        }`} style={{ fontSize: 11.5 }}>{delta}</div> : null}
      </div>
    </div>
  );
}

export function Divider() {
  return <div style={{ height: 36, width: 1, background: "var(--border-subtle)" }} />;
}

export function Legend({ color, label }: { color: string; label: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--fg-muted)" }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />{label}
    </span>
  );
}

export function Kv({ k, v, mono, tone }: { k: ReactNode; v: ReactNode; mono?: boolean; tone?: "danger" | null }) {
  const color = tone === "danger" ? "var(--sev-critical)" : "var(--fg)";
  return (
    <div>
      <div className="sh-eyebrow" style={{ marginBottom: 4, textTransform: "none", letterSpacing: 0, fontWeight: 500, fontSize: 11.5, color: "var(--fg-muted)" }}>{k}</div>
      <div style={{ fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)", fontSize: 12.5, color }}>{v}</div>
    </div>
  );
}

export function Card({ title, actions, flush, className, style, children }: { title?: ReactNode; actions?: ReactNode; flush?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={`sh-card${className ? ` ${className}` : ""}`} style={style}>
      {title != null || actions != null ? (
        <div className="sh-card__head">
          {title != null ? <h2 className="sh-h2">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      <div className={`sh-card__body${flush ? " flush" : ""}`}>{children}</div>
    </div>
  );
}

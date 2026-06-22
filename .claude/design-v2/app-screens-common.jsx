/* SignalHub v2 — shared screen primitives used across all content screens. */

function PageHead({ title, sub, actions }) {
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

function Segmented({ options, value, onChange }) {
  return (
    <div className="sh-segmented">
      {options.map(o => (
        <button key={o} aria-pressed={o === value} onClick={() => onChange && onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

function SummaryStat({ label, value, delta, tone, mono }) {
  return (
    <div>
      <div className="sh-kpi__label">{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
        <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums", fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)" }}>{value}</div>
        {delta ? <div className={`sh-delta ${tone === 'danger' ? 'down' : 'up'}`} style={{ fontSize: 11.5 }}>{delta}</div> : null}
      </div>
    </div>
  );
}
function Divider() { return <div style={{ height: 36, width: 1, background: "var(--border-subtle)" }}/>; }

function StatusPill({ status }) {
  const map = {
    open: { tone: "critical", label: "Open" },
    investigating: { tone: "warn", label: "Investigating" },
    resolved: { tone: "ok", label: "Resolved" },
    ignored: { tone: "solid", label: "Ignored" }
  };
  const m = map[status] || map.open;
  return <span className={`sh-tag ${m.tone}`}>{m.label}</span>;
}
function PriorityPill({ p }) {
  const map = { P1: "critical", P2: "warn", P3: "info", P4: "solid" };
  return <span className={`sh-tag ${map[p]}`} style={{ fontFamily: "var(--font-mono)" }}>{p}</span>;
}

function BigKpi({ label, value, sub, delta, deltaDir, spark, color }) {
  return (
    <div className="sh-card" style={{ padding: 16 }}>
      <div className="sh-kpi__label">{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
        <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" }}>{value}</div>
        {delta ? <span className={`sh-delta ${deltaDir}`} style={{ fontSize: 11.5 }}>{delta}</span> : null}
      </div>
      {sub ? <div className="sh-faint" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div> : null}
      {spark ? <div style={{ marginTop: 10 }}><Sparkline data={spark} color={color} height={32}/></div> : null}
    </div>
  );
}
function Legend({ color, label }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--fg-muted)" }}>
    <span style={{ width: 8, height: 8, borderRadius: 2, background: color }}/>{label}
  </span>;
}
function Kv({ k, v, mono, tone }) {
  const color = tone === "danger" ? "var(--sev-critical)" : "var(--fg)";
  return (
    <div>
      <div className="sh-eyebrow" style={{marginBottom:4, textTransform:"none", letterSpacing:0, fontWeight:500, fontSize:11.5, color:"var(--fg-muted)"}}>{k}</div>
      <div style={{ fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)", fontSize: 12.5, color }}>{v}</div>
    </div>
  );
}

// Reveal + copy field — addresses F-14/F-25 (secret shown plain, no copy/mask)
function SecretField({ value, masked = true }) {
  const [reveal, setReveal] = React.useState(!masked);
  const [copied, setCopied] = React.useState(false);
  const shown = reveal ? value : value.replace(/.(?=.{4})/g, "•");
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <div className="sh-code" style={{ flex: 1, padding: "9px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", minWidth: 0 }}>
        <span className="tok-str" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shown}</span>
      </div>
      <button className="sh-btn" onClick={() => setReveal(r => !r)} title={reveal ? "Ocultar" : "Revelar"}>
        <Icon name={reveal ? "eyeoff" : "eye"} size={13}/>
      </button>
      <button className="sh-btn" onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }}>
        <Icon name={copied ? "check" : "copy"} size={13}/>{copied ? "Copiado" : "Copy"}
      </button>
    </div>
  );
}

// Inline confirm for destructive actions — addresses F-30/F-52 (no confirmation)
function ConfirmButton({ label, confirmLabel = "Confirmar?", icon = "check", kind = "primary", onConfirm }) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={`sh-btn ${armed ? "danger" : kind}`} onClick={() => { if (armed) { onConfirm(); setArmed(false); } else setArmed(true); }}>
      <Icon name={armed ? "alert" : icon} size={14}/>{armed ? confirmLabel : label}
    </button>
  );
}

function EmptyHint({ icon = "check", title, sub, cta }) {
  return (
    <div style={{ display: "grid", placeItems: "center", textAlign: "center", padding: "48px 24px", gap: 10 }}>
      <span style={{ width: 44, height: 44, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--bg-surface-2)", color: "var(--fg-muted)" }}><Icon name={icon} size={20}/></span>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
      {sub ? <div className="sh-muted" style={{ fontSize: 12.5, maxWidth: 320 }}>{sub}</div> : null}
      {cta ? <div style={{ marginTop: 6 }}>{cta}</div> : null}
    </div>
  );
}

Object.assign(window, { PageHead, Segmented, SummaryStat, Divider, StatusPill, PriorityPill, BigKpi, Legend, Kv, SecretField, ConfirmButton, EmptyHint });

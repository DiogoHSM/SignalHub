/* SignalHub v2 — shared primitives: icons, charts, status helpers. */

const Icon = ({ name, size = 16, stroke = 1.6, style }) => {
  const common = {
    width: size, height: size, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor",
    strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round",
    style
  };
  const paths = {
    home: <><path d="M3 11l9-7 9 7"/><path d="M5 10v9h14v-9"/></>,
    activity: <><path d="M3 12h4l2-6 4 12 2-6h6"/></>,
    error: <><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.5"/></>,
    bolt: <><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z"/></>,
    waterfall: <><path d="M3 5h10M3 10h7M3 15h13M3 20h9"/></>,
    bell: <><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z"/><path d="M10 21a2 2 0 004 0"/></>,
    cube: <><path d="M12 3 3 8v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></>,
    server: <><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 8h.01M7 17h.01"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    chev: <><path d="m9 6 6 6-6 6"/></>,
    chevd: <><path d="m6 9 6 6 6-6"/></>,
    chevl: <><path d="m15 6-6 6 6 6"/></>,
    chevu: <><path d="m6 15 6-6 6 6"/></>,
    check: <><path d="M5 13l4 4L19 7"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    ext: <><path d="M14 4h6v6"/><path d="M10 14 20 4M20 14v6H4V4h6"/></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></>,
    users: <><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><circle cx="17" cy="9" r="3"/><path d="M22 19c0-3-2-5-5-5"/></>,
    sparkles: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></>,
    cpu: <><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></>,
    db: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    redis: <><path d="M4 7l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4M4 17l8 4 8-4"/></>,
    queue: <><rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="m10.5 12.5 9-9M16 6l3 3M14 8l3 3"/></>,
    filter: <><path d="M3 5h18l-7 9v6l-4-2v-4z"/></>,
    refresh: <><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></>,
    play: <><path d="m7 4 13 8L7 20z"/></>,
    file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></>,
    book: <><path d="M3 4h7a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H3z"/><path d="M21 4h-7a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h8z"/></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
    eyeoff: <><path d="M2 12s4-7 10-7c2 0 3.8.6 5.3 1.5M22 12s-4 7-10 7c-2 0-3.8-.6-5.3-1.5"/><path d="m4 4 16 16"/><path d="M9.5 9.5a3 3 0 0 0 4.2 4.2"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5M3 18l9 5 9-5"/></>,
    money: <><circle cx="12" cy="12" r="9"/><path d="M9 9c0-1 1-2 3-2s3 1 3 2-1 2-3 2-3 1-3 2 1 2 3 2 3-1 3-2M12 6v12"/></>,
    flag: <><path d="M5 21V4h13l-2 4 2 4H5"/></>,
    git: <><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M6 8.5v3a3 3 0 0 0 3 3h3M18 8.5v0a3 3 0 0 1-3 3h-3"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    download: <><path d="M12 4v12M6 12l6 6 6-6M4 20h16"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    pulse: <><path d="M3 12h4l3-7 4 14 3-7h4"/></>,
    box: <><rect x="3" y="3" width="18" height="18" rx="3"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/></>,
    discord: <><path d="M5 6c2-1 5-2 7-2s5 1 7 2c2 4 2 8 1 12-2 1-4 2-6 2l-1-2c-2 0-3 0-5-1-1 1-3 2-5 2-1-4-1-8 1-12z"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/></>,
    slack: <><rect x="3" y="11" width="8" height="3" rx="1.5"/><rect x="13" y="11" width="8" height="3" rx="1.5"/><rect x="10" y="3" width="3" height="8" rx="1.5"/><rect x="10" y="13" width="3" height="8" rx="1.5"/></>,
    webhook: <><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="12" cy="6" r="3"/><path d="m13.5 8.5 4 8.5M10.5 8.5l-4 8.5M9 18h6"/></>,
    x: <><path d="M6 6l12 12M18 6 6 18"/></>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>,
    panelRight: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="M18 9l-2 3 2 3"/></>,
    panelExpand: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="M17 9l2 3-2 3"/></>,
    alert: <><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/></>,
    shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></>,
    zap: <><path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z"/></>,
    dot: <><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/></>,
    maximize: <><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/><path d="M12 7v5l3 2"/></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></>,
    archive: <><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/></>,
    edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></>
  };
  return <svg {...common}>{paths[name]}</svg>;
};

// ============ STATUS HELPERS ============
const STATUS = {
  ok:       { color: "var(--accent)",        bg: "var(--accent-bg-subtle)",   border: "var(--accent-border)",        label: "Operacional" },
  warning:  { color: "var(--sev-warning)",   bg: "var(--sev-warning-bg)",     border: "var(--sev-warning-border)",   label: "Atenção" },
  critical: { color: "var(--sev-critical)",  bg: "var(--sev-critical-bg)",    border: "var(--sev-critical-border)",  label: "Crítico" },
  idle:     { color: "var(--fg-muted)",      bg: "var(--bg-surface-3)",       border: "var(--border-subtle)",        label: "Inativo" }
};
const sev = s => STATUS[s] || STATUS.idle;

function StatusDot({ status, size = 8, pulse = false }) {
  const c = sev(status).color;
  return (
    <span style={{ position: "relative", display: "inline-flex", width: size, height: size, flex: "0 0 auto" }}>
      {pulse && status !== "ok" ? (
        <span style={{
          position: "absolute", inset: -2, borderRadius: "50%",
          background: c, opacity: 0.35, animation: "sh-ping 1.8s cubic-bezier(0,0,.2,1) infinite"
        }}/>
      ) : null}
      <span style={{ width: size, height: size, borderRadius: "50%", background: c, position: "relative" }}/>
    </span>
  );
}

// ============ SPARKLINE ============
function Sparkline({ data, color = "var(--accent)", height = 36, fill = true }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100, h = 100;
  const stepX = w / Math.max(data.length - 1, 1);
  const points = data.map((v, i) => [i * stepX, h - ((v - min) / range) * (h * 0.92) - 4]);
  const d = points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const dArea = `${d} L${w},${h} L0,${h} Z`;
  const gradId = "g" + Math.random().toString(36).slice(2, 8);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }} aria-hidden="true">
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28"/>
              <stop offset="100%" stopColor={color} stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d={dArea} fill={`url(#${gradId})`}/>
        </>
      ) : null}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
    </svg>
  );
}

function Bars({ data, color = "var(--accent)", height = 60, highlight = null }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height, width: "100%" }} aria-hidden="true">
      {data.map((v, i) => (
        <div key={i} style={{
          flex: 1,
          height: `${(v / max) * 100}%`,
          background: highlight === i ? "var(--sev-critical)" : color,
          opacity: highlight === i ? 1 : 0.85,
          borderRadius: 2,
          minHeight: 2
        }}/>
      ))}
    </div>
  );
}

// micro sparkline for tight spaces (health rail)
function MicroSpark({ data, color = "var(--accent)", width = 56, height = 18 }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = 100 / Math.max(data.length - 1, 1);
  const d = data.map((v, i) => `${i ? "L" : "M"}${(i * stepX).toFixed(1)},${(100 - ((v - min) / range) * 84 - 8).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width, height, display: "block" }} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
    </svg>
  );
}

Object.assign(window, { Icon, STATUS, sev, StatusDot, Sparkline, Bars, MicroSpark });

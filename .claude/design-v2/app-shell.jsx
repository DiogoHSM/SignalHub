/* SignalHub v2 — app shell: left nav rail, top bar, breadcrumb, project switcher, toasts. */

const NAV = [
  { id: "overview",    icon: "home",      label: "Overview" },
  { id: "investigate", icon: "activity",  label: "Investigate" },
  { id: "incidents",   icon: "error",     label: "Incidents", badge: true },
  { id: "llm",         icon: "sparkles",  label: "LLM" },
  { id: "traces",      icon: "waterfall", label: "Traces" },
  { id: "alerts",      icon: "bell",      label: "Alerts" }
];
const NAV_BOTTOM = [
  { id: "system",   icon: "server",   label: "System" },
  { id: "settings", icon: "settings", label: "Settings" }
];

function NavRail({ active, onNavigate, fleetCritical }) {
  const item = (it) => (
    <button key={it.id} className={`nv-item ${active === it.id ? "is-active" : ""}`} title={it.label}
      onClick={() => onNavigate(it.id)}>
      <Icon name={it.icon} size={19}/>
      {it.badge && fleetCritical > 0 ? <span className="nv-dot"/> : null}
      <span className="nv-tip">{it.label}</span>
    </button>
  );
  return (
    <nav className="nv">
      <div className="nv-logo" title="SignalHub">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
          <path d="M3 13l5-3 4 4 5-6 4 3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="20" cy="11" r="2" fill="currentColor"/>
        </svg>
      </div>
      {NAV.map(item)}
      <div className="nv-spacer"/>
      {NAV_BOTTOM.map(item)}
    </nav>
  );
}

function ProjectSwitcher({ project, env, onSelectProject, onSelectEnv }) {
  const [open, setOpen] = React.useState(null); // 'project' | 'env' | null
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={e => e.stopPropagation()}>
      <div style={{ position: "relative" }}>
        <button className="sw-pill" onClick={() => setOpen(open === "project" ? null : "project")} aria-expanded={open === "project"}>
          <StatusDot status={project.status} size={7} pulse={project.status === "critical"}/>
          <span style={{ fontWeight: 600 }}>{project.name}</span>
          <Icon name="chevd" size={13} style={{ color: "var(--fg-muted)" }}/>
        </button>
        {open === "project" ? (
          <div className="sw-menu">
            <div className="sw-menu__head">Trocar projeto</div>
            {PROJECTS.map(p => (
              <button key={p.id} className={`sw-opt ${p.id === project.id ? "is-active" : ""}`}
                onClick={() => { onSelectProject(p.id); setOpen(null); }}>
                <StatusDot status={p.status} size={7}/>
                <span style={{ flex: 1, textAlign: "left" }}>{p.name}</span>
                {p.incidents > 0 ? <span className="sw-badge">{p.incidents}</span> : null}
                {p.id === project.id ? <Icon name="check" size={13} stroke={2.4} style={{ color: "var(--accent)" }}/> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ position: "relative" }}>
        <button className="sw-pill" onClick={() => setOpen(open === "env" ? null : "env")} aria-expanded={open === "env"}>
          <span>{env}</span>
          <Icon name="chevd" size={13} style={{ color: "var(--fg-muted)" }}/>
        </button>
        {open === "env" ? (
          <div className="sw-menu">
            <div className="sw-menu__head">Environment</div>
            {project.envs.map(e => (
              <button key={e.name} className={`sw-opt ${e.name === env ? "is-active" : ""}`}
                onClick={() => { onSelectEnv(e.name); setOpen(null); }}>
                <StatusDot status={e.status} size={7}/>
                <span style={{ flex: 1, textAlign: "left" }}>{e.name}</span>
                {e.name === env ? <Icon name="check" size={13} stroke={2.4} style={{ color: "var(--accent)" }}/> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Breadcrumb({ items }) {
  return (
    <div className="bc">
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={i}>
            {i > 0 ? <Icon name="chev" size={12} style={{ color: "var(--fg-faint)" }}/> : null}
            {it.onClick && !last ? (
              <button className="bc-seg bc-seg--link" onClick={it.onClick}>{it.label}</button>
            ) : (
              <span className={`bc-seg ${last ? "bc-seg--current" : ""}`}>{it.label}</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function TopBar({ project, env, onSelectProject, onSelectEnv, crumb, railCollapsed, onToggleRail, onRefresh }) {
  return (
    <header className="tb">
      <ProjectSwitcher project={project} env={env} onSelectProject={onSelectProject} onSelectEnv={onSelectEnv}/>
      <Icon name="chev" size={13} style={{ color: "var(--fg-faint)", margin: "0 2px" }}/>
      <Breadcrumb items={crumb}/>
      <div className="tb-search">
        <Icon name="search" size={14}/>
        <span>Buscar evento, erro, tenant, trace…</span>
        <kbd>⌘K</kbd>
      </div>
      <div className="tb-actions">
        <button className="tb-icon" title="Atualizar agora" onClick={onRefresh}><Icon name="refresh" size={15}/></button>
        <button className="tb-icon" title="Notificações"><Icon name="bell" size={15}/><span className="tb-icon__dot"/></button>
        {railCollapsed ? (
          <button className="tb-icon" title="Mostrar radar de projetos" onClick={onToggleRail}><Icon name="panelExpand" size={15}/></button>
        ) : null}
        <div className="tb-avatar" title="ana@acme.dev">AM</div>
      </div>
    </header>
  );
}

// ============ TOASTS ============
function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className="toast" data-tone={t.tone}>
          <span className="toast__icon"><Icon name={t.icon || "check"} size={15}/></span>
          <div style={{ flex: 1 }}>
            <div className="toast__title">{t.title}</div>
            {t.sub ? <div className="toast__sub">{t.sub}</div> : null}
          </div>
          <button className="toast__x" onClick={() => onDismiss(t.id)} aria-label="Dispensar"><Icon name="x" size={13}/></button>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { NavRail, TopBar, Breadcrumb, ProjectSwitcher, ToastStack });

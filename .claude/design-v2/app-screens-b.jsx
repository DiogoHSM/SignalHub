/* SignalHub v2 — screens B: Incidents list, LLM, Traces (collapsible tree), Tenant. */

// ============ INCIDENTS (triage list) ============
function IncidentsScreen({ project, env, nav, drill, toast }) {
  const incidents = [
    { msg: "PaymentTimeoutError: provider timeout after 12000ms", id: "INC-4821", grp: "err_grp_8a2f", sev: "critical", status: "investigating", priority: "P1", count: 412, users: 38, tenants: 2, assignee: "AM", opened: "18 min", trend: [3,4,5,6,8,12,28,42,38,30,18,12] },
    { msg: "StripeAPIError: rate_limited", id: "INC-4820", grp: "err_grp_4c1d", sev: "critical", status: "open", priority: "P1", count: 184, users: 22, tenants: 1, assignee: null, opened: "31 min", trend: [2,3,4,3,5,6,8,14,18,22,20,18] }
  ];
  const sevColor = { critical: "var(--sev-critical)", warning: "var(--sev-warning)" };

  return (
    <>
      <PageHead title="Incidents" sub={<>Triagem prioritária de <strong style={{color:"var(--fg)"}}>{project.name} · {env}</strong> — {incidents.length} ativos.</>}
        actions={<><button className="sh-btn"><Icon name="history" size={14}/>Histórico</button><button className="sh-btn"><Icon name="filter" size={14}/>Filtros</button></>}/>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <BigKpi label="Ativos" value={String(project.incidents)} color="var(--sev-critical)"/>
        <BigKpi label="P1 críticos" value="2" color="var(--sev-critical)"/>
        <BigKpi label="MTTR (7d)" value="42 min"/>
        <BigKpi label="Resolvidos (7d)" value="18" delta="+4" deltaDir="up"/>
      </div>

      <div className="sh-card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="sh-card__head"><h2 className="sh-h2">Incidentes ativos</h2><span className="sh-tag">ordenado por prioridade</span></div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {incidents.map(i => (
            <button key={i.id} className="sh-row sh-row--btn sh-stripe critical" style={{ gridTemplateColumns: "1fr", display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid var(--border-subtle)", padding: "16px 18px 16px 22px" }}
              onClick={() => drill("incident", { msg: i.msg, id: i.grp, priority: i.priority, count: i.count, users: i.users, tenants: i.tenants })}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <span className="sh-tag critical" style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>{i.sev}</span>
                <PriorityPill p={i.priority}/>
                <StatusPill status={i.status}/>
                <span className="sh-tag mono">{i.id}</span>
                <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>opened {i.opened} ago</span>
                <div style={{ flex: 1 }}/>
                {i.assignee ? <span className="tb-avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{i.assignee}</span> : <span className="sh-tag warn">unassigned</span>}
              </div>
              <div className="sh-mono" style={{ fontSize: 14, color: "var(--fg)", marginBottom: 8 }}>{i.msg}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <span className="sh-muted" style={{ fontSize: 12 }}><strong style={{ color: "var(--fg)" }}>{i.count}</strong> ocorrências</span>
                <span className="sh-muted" style={{ fontSize: 12 }}><strong style={{ color: "var(--fg)" }}>{i.users}</strong> users</span>
                <span className="sh-muted" style={{ fontSize: 12 }}><strong style={{ color: "var(--fg)" }}>{i.tenants}</strong> tenants</span>
                <div style={{ flex: 1, maxWidth: 220 }}><Sparkline data={i.trend} color={sevColor[i.sev]} height={28} fill={false}/></div>
                <span className="sh-btn ghost" style={{ pointerEvents: "none" }}>Abrir <Icon name="arrow" size={12}/></span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

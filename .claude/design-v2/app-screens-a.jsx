/* SignalHub v2 — screens A: Overview, Errors (investigate), Incident.
   Full design source (pt-BR) for S1/S2/S3. Port to TSX with English copy + F1 ui/v2 primitives. */

// ============ OVERVIEW (S1 — shipped) ============
function OverviewScreen({ project, env, nav, drill, toast }) {
  const errorSpark = project.errorTrend;
  const eventsSpark = [320, 340, 360, 380, 410, 425, 440, 450, 470, 480, 495, 510];
  const llmSpark = [12, 14, 16, 14, 18, 22, 28, 24, 26, 30, 34, 38];
  const latencySpark = [820, 790, 810, 850, 880, 920, 940, 910, 880, 860, 830, 820];
  const inc = project.topIncident;
  return (
    <>
      <PageHead title="Overview"
        sub={<>Pulso de <strong style={{color:"var(--fg)"}}>{project.name} · {env}</strong> — atualizado há 4s.</>}
        actions={<><Segmented options={["1h","24h","7d","30d"]} value="24h"/><button className="sh-btn"><Icon name="download" size={14}/>Export</button></>}/>
      {/* banner + KPI groups + top tenants + llm-by-model + recent activity — see S1 implementation */}
    </>
  );
}
function KpiGroup({ title, icon, items }) { /* S1 — shipped */ }

// ============ ERRORS (investigate) — S2 ============
function ErrorsScreen({ project, env, nav, drill, toast }) {
  const [filterSev, setFilterSev] = React.useState("all");
  const errors = [
    { msg: "PaymentTimeoutError: provider timeout after 12000ms", id: "err_grp_8a2f", sev: "critical", status: "investigating", priority: "P1", count: 412, users: 38, tenants: 2, last: "8s", trend: [3,4,5,6,8,12,28,42,38,30,18,12] },
    { msg: "StripeAPIError: rate_limited", id: "err_grp_4c1d", sev: "critical", status: "open", priority: "P1", count: 184, users: 22, tenants: 1, last: "32s", trend: [2,3,4,3,5,6,8,14,18,22,20,18] },
    { msg: "TypeError: Cannot read properties of undefined (reading 'plan')", id: "err_grp_9f81", sev: "error", status: "open", priority: "P2", count: 89, users: 41, tenants: 4, last: "1m", trend: [4,5,4,6,5,7,6,8,9,8,9,8] },
    { msg: "ValidationError: webhook_url must not target private network", id: "err_grp_7b32", sev: "warning", status: "open", priority: "P3", count: 47, users: 12, tenants: 3, last: "4m", trend: [2,1,3,2,4,3,2,4,5,4,3,4] },
    { msg: "Worker job dlq_telemetry timed out (max_attempts reached)", id: "err_grp_2a8c", sev: "error", status: "investigating", priority: "P2", count: 28, users: null, tenants: null, last: "12m", trend: [1,1,2,1,2,3,2,3,2,3,3,4] },
    { msg: "DatabaseConnectionError: ECONNRESET in pg pool", id: "err_grp_6d42", sev: "warning", status: "resolved", priority: "P3", count: 18, users: null, tenants: null, last: "2h", trend: [3,4,2,5,4,2,3,1,1,0,0,0] },
    { msg: "AbortError: signal timeout in /llm/generate", id: "err_grp_0e91", sev: "warning", status: "ignored", priority: "P4", count: 12, users: 8, tenants: 2, last: "4h", trend: [1,0,1,2,1,1,2,1,1,1,1,1] }
  ];
  const sevColor = { critical: "var(--sev-critical)", error: "var(--sev-error)", warning: "var(--sev-warning)" };
  const filtered = filterSev === "all" ? errors : errors.filter(e => e.sev === filterSev);
  const tabs = [
    ["Events", "activity", "4.82M", () => nav("overview")],
    ["Errors", "error", "2,481", null, true],
    ["Traces", "waterfall", "31K", () => nav("traces")],
    ["LLM", "sparkles", "184K", () => nav("llm")],
    ["Tenants", "cube", "287", () => drill("tenant", { name: "Acme Corp", id: "tenant_acme_prod" })],
    ["Users", "users", "14K", null]
  ];
  return (
    <>
      <div className="inv-tabs">
        {tabs.map(([name, icon, count, onClick, active]) => (
          <button key={name} className={`inv-tab ${active ? "is-active" : ""}`} onClick={onClick || undefined}>
            <Icon name={icon} size={14}/>{name}
            <span className="sh-tag mono" style={{ fontSize: 10, padding: "1px 6px", background: active ? "var(--bg-surface-3)" : "var(--bg-surface)" }}>{count}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div className="sh-segmented">
          {["all","critical","error","warning"].map(s => <button key={s} aria-pressed={s === filterSev} onClick={() => setFilterSev(s)}>{s === "all" ? "severity: all" : s}</button>)}
        </div>
        <button className="sh-btn"><Icon name="filter" size={13}/>status: open, investigating</button>
        <button className="sh-btn"><Icon name="filter" size={13}/>release: any</button>
        <button className="sh-btn ghost"><Icon name="plus" size={13}/>add filter</button>
        <div style={{ flex: 1 }}/>
        <Segmented options={["Grouped","Raw"]} value="Grouped"/>
        <Segmented options={["1h","24h","7d"]} value="24h"/>
      </div>
      <div className="sh-card">
        <div className="sh-card__body" style={{ display: "flex", gap: 28, padding: "14px 18px", alignItems: "center", flexWrap: "wrap" }}>
          <SummaryStat label="Erros (24h)" value="2,481" delta="+34%" tone="danger"/><Divider/>
          <SummaryStat label="Grupos abertos" value="14"/><Divider/>
          <SummaryStat label="Critical" value="2" tone="danger"/><Divider/>
          <SummaryStat label="MTTR (7d)" value="42 min" tone="ok"/><Divider/>
          <SummaryStat label="Top release" value="v2026.05.14" mono/>
          <div style={{ flex: 1 }}/>
          <div style={{ width: 240 }}>
            <div className="sh-eyebrow" style={{ marginBottom: 4 }}>volume / hora</div>
            <Bars data={[12,18,22,28,32,38,46,52,68,82,124,168,142,98,72,58,42,32,28,24,22,18,16,18]} color="var(--sev-critical)" height={32}/>
          </div>
        </div>
      </div>
      <div className="sh-card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="sh-row sh-row__head" style={{ gridTemplateColumns: "minmax(360px,2.2fr) 116px 100px 80px 80px 64px 64px 84px 28px" }}>
          <span>Error</span><span>Status</span><span>Trend (24h)</span><span>Priority</span><span>Events</span><span>Users</span><span>Tenants</span><span>Last</span><span/>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {filtered.map(e => (
            <button key={e.id} className={`sh-row sh-row--btn ${e.sev === 'critical' && e.status !== 'resolved' ? 'is-active' : ''}`} style={{ gridTemplateColumns: "minmax(360px,2.2fr) 116px 100px 80px 80px 64px 64px 84px 28px", width: "100%", textAlign: "left", background: "transparent", borderTop: "none", borderLeft: "none", borderRight: "none" }}
              onClick={() => drill("incident", e)}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                <span style={{ width: 3, alignSelf: "stretch", borderRadius: 1, background: sevColor[e.sev], flex: "0 0 auto" }}/>
                <div style={{ minWidth: 0 }}>
                  <div className="sh-mono" style={{ fontSize: 12.5, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.msg}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                    <span className="sh-tag mono">{e.id}</span>
                    <span className="sh-tag" style={{ background: e.sev === 'critical' ? "var(--sev-critical-bg)" : e.sev === 'warning' ? "var(--sev-warning-bg)" : "var(--sev-error-bg)", color: sevColor[e.sev], borderColor: "transparent", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>{e.sev}</span>
                  </div>
                </div>
              </div>
              <span><StatusPill status={e.status}/></span>
              <div style={{ width: 90 }}><Sparkline data={e.trend} color={sevColor[e.sev]} height={26} fill={false}/></div>
              <PriorityPill p={e.priority}/>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>{e.count.toLocaleString()}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }} className="sh-muted">{e.users ?? "—"}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }} className="sh-muted">{e.tenants ?? "—"}</span>
              <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>{e.last}</span>
              <Icon name="chev" size={13} style={{ color: "var(--fg-faint)" }}/>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ============ INCIDENT (drill target) — S3 ============
// IncidentScreen: header (severity/status/group-id/release tags, INC#, opened, assignee, mono title, origin);
// action bar (Resolve w/ ConfirmButton, Reassign, Silence 1h, Create issue [stub], Copy link);
// occurrences Bars(24h, highlight spike); stack trace w/ source-map resolved badge + frame hint;
// collapsible breadcrumbs accordion; impact grid; related signals (RelItem list); triage notes (list + add input).
// Full source in the DesignSync project file "app-screens-a.jsx" (IncidentScreen + RelItem) — pull fresh when speccing S3.

Object.assign(window, { OverviewScreen, ErrorsScreen, KpiGroup });

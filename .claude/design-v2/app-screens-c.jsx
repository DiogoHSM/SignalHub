/* SignalHub v2 — screens C: Alerts, System health, Settings/Setup. */

// ============ ALERTS ============
function AlertsScreen({ project, env, nav, drill, toast }) {
  const [filter, setFilter] = React.useState("All");
  const rules = [
    { name: "Critical errors em produção", type: "critical_errors", sev: "critical", channel: "Slack · #incidents", state: "active", lastFired: "8m ago", fires7d: 4, threshold: "≥ 1 in 5min" },
    { name: "Error rate spike", type: "error_rate", sev: "critical", channel: "Slack · #incidents", state: "active", lastFired: "never", fires7d: 0, threshold: "> 5% in 10min" },
    { name: "p95 latency degradation", type: "trace_p95_latency", sev: "warning", channel: "Webhook · pagerduty", state: "active", lastFired: "2h ago", fires7d: 2, threshold: "> 15s in 15min" },
    { name: "LLM cost daily cap", type: "llm_cost", sev: "warning", channel: "Email · finance", state: "active", lastFired: "yesterday", fires7d: 1, threshold: "> $ 200 / day" },
    { name: "Worker failures dlq", type: "error_count", sev: "warning", channel: "Discord · #ops", state: "paused", lastFired: "4d ago", fires7d: 0, threshold: "≥ 5 in 30min" }
  ];
  const shown = filter === "All" ? rules : rules.filter(r => filter === "Active" ? r.state === "active" : r.state === "paused");

  return (
    <>
      <PageHead title="Alerts" sub="5 regras ativas · 7 disparos nos últimos 7 dias"
        actions={<><button className="sh-btn"><Icon name="webhook" size={13}/>Channels</button><button className="sh-btn primary" onClick={() => toast({ title: "Nova regra", sub: "Editor de regra aberto", icon: "plus" })}><Icon name="plus" size={13}/>Nova regra</button></>}/>

      <div className="sh-card">
        <div className="sh-card__head"><h2 className="sh-h2">Histórico recente</h2><span className="sh-faint" style={{ fontSize: 11 }}>últimos 7 dias</span></div>
        <div className="sh-card__body"><FiresTimeline/></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head"><h2 className="sh-h2">Regras</h2><Segmented options={["All", "Active", "Paused"]} value={filter} onChange={setFilter}/></div>
          <div className="sh-row sh-row__head" style={{ gridTemplateColumns: "1.5fr 96px 90px 1fr 70px 84px" }}>
            <span>Rule</span><span>Severity</span><span>State</span><span>Channel</span><span>7d</span><span>Ações</span>
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {shown.map(r => (
              <div key={r.name} className="sh-row alert-row" style={{ gridTemplateColumns: "1.5fr 96px 90px 1fr 70px 84px" }}>
                <div><strong style={{ fontSize: 12.5 }}>{r.name}</strong><div className="sh-faint sh-mono" style={{ fontSize: 11 }}>{r.type} · {r.threshold}</div></div>
                <span className={`sh-tag ${r.sev === "critical" ? "critical" : "warn"}`} style={{ textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>{r.sev}</span>
                <span><span className="sh-tag" style={{ background: r.state === "active" ? "var(--accent-bg-subtle)" : "var(--bg-surface-3)", color: r.state === "active" ? "var(--accent)" : "var(--fg-muted)", borderColor: "transparent" }}>{r.state === "active" ? "● active" : "paused"}</span></span>
                <span style={{ fontSize: 12 }}>{r.channel}</span>
                <span className="sh-mono" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: r.fires7d > 0 ? "var(--sev-critical)" : "var(--fg-muted)" }}>{r.fires7d}</span>
                <div className="alert-row__actions" style={{ display: "flex", gap: 4 }}>
                  <button className="sh-iconbtn-sm" title="Editar regra" onClick={() => toast({ title: "Editar regra", sub: r.name, icon: "edit" })}><Icon name="edit" size={13}/></button>
                  <button className="sh-iconbtn-sm" title={r.state === "active" ? "Pausar" : "Ativar"} onClick={() => toast({ title: r.state === "active" ? "Regra pausada" : "Regra ativada", sub: r.name, icon: "bell" })}><Icon name={r.state === "active" ? "clock" : "play"} size={13}/></button>
                  <button className="sh-iconbtn-sm" title="Arquivar" onClick={() => toast({ title: "Regra arquivada", sub: r.name, icon: "archive", tone: "warn" })}><Icon name="archive" size={13}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0, overflow: "auto" }}>
          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Canais</h2><button className="sh-btn ghost" style={{ padding: "4px 8px" }}><Icon name="plus" size={13}/></button></div>
            <div className="sh-card__body flush">
              {[["slack", "Slack · #incidents", "https://hooks.slack.com/services/T0···", "ok"],["webhook", "PagerDuty webhook", "https://events.pagerduty.com/v2/···", "ok"],["discord", "Discord · #ops", "https://discord.com/api/webhooks/···", "ok"],["mail", "Email · finance@acme.dev", "internal mailer", "warn"]].map(([icon, name, url, state]) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span style={{ color: state === "ok" ? "var(--accent)" : "var(--sev-warning)" }}><Icon name={icon} size={16}/></span>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5 }}>{name}</div><div className="sh-faint sh-mono" style={{ fontSize: 10.5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{url}</div></div>
                  <button className="sh-tag mono" style={{ cursor: "pointer" }} onClick={() => toast({ title: "Teste enviado", sub: name, icon: "check" })}>test</button>
                </div>
              ))}
            </div>
          </div>

          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Sugestões</h2><span className="sh-tag violet">AI</span></div>
            <div className="sh-card__body" style={{ display: "grid", gap: 10 }}>
              <Suggestion icon="bolt" title="412 erros em /checkout — alertar P1?" sub="Threshold: > 50 errors / 15min" toast={toast}/>
              <Suggestion icon="sparkles" title="gpt-5 está 32% mais lento" sub="Threshold p95 > 3s · Slack" toast={toast}/>
              <Suggestion icon="money" title="Custo de IA +22% — limite diário?" sub="Threshold: > $ 200 / day · Email" toast={toast}/>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function FiresTimeline() {
  const days = ["Seg 18", "Ter 19", "Qua 20", "Qui 21", "Sex 22", "Sáb 23", "Dom 24"];
  const fires = [{ day: 0, hour: 9, sev: "warn" },{ day: 1, hour: 14, sev: "critical" },{ day: 2, hour: 11, sev: "warn" },{ day: 3, hour: 16, sev: "warn" },{ day: 5, hour: 22, sev: "warn" },{ day: 6, hour: 12, sev: "critical" },{ day: 6, hour: 14, sev: "critical" }];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
      {days.map((d, i) => {
        const dayFires = fires.filter(f => f.day === i);
        return (
          <div key={d}>
            <div className="sh-faint sh-mono" style={{ fontSize: 10, marginBottom: 6 }}>{d}</div>
            <div style={{ position: "relative", height: 60, background: "var(--bg-canvas)", borderRadius: 5, border: "1px solid var(--border-subtle)", overflow: "hidden" }}>
              {[6,12,18].map(h => <span key={h} style={{ position:"absolute", left: `${(h/24)*100}%`, top: 0, bottom: 0, width: 1, background: "var(--border-subtle)" }}/>)}
              {dayFires.map((f, j) => <span key={j} style={{ position: "absolute", left: `${(f.hour/24)*100}%`, top: 4, bottom: 4, width: 3, borderRadius: 1, background: f.sev === "critical" ? "var(--sev-critical)" : "var(--sev-warning)" }}/>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function Suggestion({ icon, title, sub, toast }) {
  const [created, setCreated] = React.useState(false);
  return (
    <div style={{ padding: 12, border: "1px solid var(--border-subtle)", borderRadius: 8, display: "flex", gap: 10 }}>
      <span style={{ width: 28, height: 28, borderRadius: 7, background: "var(--sev-violet-bg)", color: "var(--sev-violet)", display: "grid", placeItems: "center", flex: "0 0 auto" }}><Icon name={icon} size={14}/></span>
      <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, color: "var(--fg)" }}>{title}</div><div className="sh-faint" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div></div>
      <button className="sh-btn ghost" style={{ padding: "4px 8px", fontSize: 11 }} disabled={created} onClick={() => { setCreated(true); toast({ title: "Regra criada", sub: title, icon: "check" }); }}>{created ? <Icon name="check" size={13}/> : "Criar"}</button>
    </div>
  );
}

// ============ SYSTEM HEALTH ============
function SystemScreen({ project, env, nav, drill, toast }) {
  const services = [
    { name: "API", icon: "server", state: "ok", meta: "p95 32ms · 0 errors", spark: [32,30,34,31,28,30,33,32,30,29,32,33] },
    { name: "Worker", icon: "cpu", state: "ok", meta: "uptime 14d · 1.8K jobs/min", spark: [180,182,184,178,176,180,184,188,186,182,180,184] },
    { name: "Postgres", icon: "db", state: "ok", meta: "conn 12/64 · disk 42%", spark: [12,14,12,14,11,12,13,14,12,13,11,12] },
    { name: "Redis", icon: "redis", state: "warning", meta: "evictions ↑ 142/min", spark: [12,18,28,42,58,68,82,98,118,142,128,142] }
  ];
  return (
    <>
      <PageHead title="System health" sub="Saúde da própria instância SignalHub · self-monitoring."
        actions={<><span className="sh-pill"><span className="sh-pill__dot"/>SLA 99.98%</span><button className="sh-btn" onClick={() => toast({ title: "Doctor executado", sub: "Sem problemas críticos", icon: "shield" })}><Icon name="shield" size={13}/>Run doctor</button></>}/>

      <div className="sh-card sh-stripe warn">
        <div className="sh-card__body" style={{ paddingLeft: 24, display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: "var(--sev-warning-bg)", color: "var(--sev-warning)", display: "grid", placeItems: "center" }}><Icon name="bolt" size={18}/></span>
          <div style={{ flex: 1 }}><strong style={{ fontSize: 14 }}>Redis em degradação — evictions ↑ 142/min</strong><div className="sh-muted" style={{ fontSize: 12, marginTop: 2 }}>Cache hit rate caiu para 78%. Sugerido: aumentar maxmemory 512MB → 1GB no Compose.</div></div>
          <button className="sh-btn">Ver runbook</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {services.map(s => (
          <div key={s.name} className={`sh-card sh-stripe ${s.state === "ok" ? "ok" : "warn"}`}>
            <div className="sh-card__body" style={{ paddingLeft: 22 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: s.state === "ok" ? "var(--accent)" : "var(--sev-warning)" }}><Icon name={s.icon} size={16}/></span><strong style={{ fontSize: 14 }}>{s.name}</strong></div>
                <span className={`sh-tag ${s.state === "ok" ? "ok" : "warn"}`}>{s.state === "ok" ? "healthy" : "degraded"}</span>
              </div>
              <div className="sh-muted" style={{ fontSize: 11.5, marginTop: 6 }}>{s.meta}</div>
              <div style={{ marginTop: 10 }}><Sparkline data={s.spark} color={s.state === "ok" ? "var(--accent)" : "var(--sev-warning)"} height={36}/></div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        <div className="sh-card">
          <div className="sh-card__head"><h2 className="sh-h2">Filas BullMQ</h2></div>
          <div className="sh-card__body flush" style={{ overflow: "auto" }}>
            {[{ name: "telemetry:events", waiting: 12, active: 4, completed: "1.2M", failed: 18 },{ name: "telemetry:errors", waiting: 2, active: 1, completed: "184K", failed: 4 },{ name: "telemetry:llm", waiting: 0, active: 2, completed: "182K", failed: 1 },{ name: "telemetry:traces", waiting: 8, active: 3, completed: "31K", failed: 0 },{ name: "alerts:eval", waiting: 0, active: 0, completed: "8,420", failed: 0 },{ name: "backups:create", waiting: 0, active: 0, completed: "14", failed: 0 }].map(q => (
              <div key={q.name} className="sh-row" style={{ gridTemplateColumns: "1.4fr 70px 70px 80px 70px" }}>
                <span className="sh-mono" style={{ fontSize: 12 }}>{q.name}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11.5 }} className="sh-muted">{q.waiting} wait</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11.5, color: q.active > 0 ? "var(--accent)" : "var(--fg-muted)" }}>{q.active} act</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11.5 }}>{q.completed}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11.5, color: q.failed > 0 ? "var(--sev-warning)" : "var(--fg-muted)" }}>{q.failed} fail</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sh-card">
          <div className="sh-card__head"><h2 className="sh-h2">Retenção</h2><span className="sh-faint" style={{ fontSize: 11 }}>limpeza em 38min</span></div>
          <div className="sh-card__body" style={{ display: "grid", gap: 12 }}>
            {[["Events", "90d", 142, "var(--accent)"],["Errors", "180d", 18, "var(--sev-critical)"],["Traces", "90d", 31, "var(--sev-info)"],["Spans", "90d", 84, "var(--sev-info)"],["LLM calls", "180d", 12, "var(--sev-violet)"],["Breadcrumbs", "30d", 248, "var(--sev-warning)"]].map(([t, win, gb, c]) => (
              <div key={t} style={{ display: "grid", gridTemplateColumns: "1fr 56px 80px", alignItems: "center", gap: 10 }}>
                <div><div style={{fontSize: 12.5}}>{t}</div><div className="sh-faint" style={{fontSize: 11}}>retention {win}</div></div>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 11.5 }}>{gb} GB</span>
                <div style={{height: 6, background: "var(--bg-canvas)", borderRadius: 3, overflow: "hidden"}}><div style={{height: "100%", width: `${Math.min(gb/3,100)}%`, background: c}}/></div>
              </div>
            ))}
          </div>
        </div>

        <div className="sh-card">
          <div className="sh-card__head"><h2 className="sh-h2">Backups</h2></div>
          <div className="sh-card__body" style={{ display: "grid", gap: 8 }}>
            {[["sigmon-20260524T040000Z.dump", "418 MB", "today 04:00"],["sigmon-20260523T040000Z.dump", "412 MB", "yesterday"],["sigmon-20260522T040000Z.dump", "411 MB", "2d ago"],["sigmon-20260521T040000Z.dump", "410 MB", "3d ago"]].map(([file, size, when]) => (
              <div key={file} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                <span style={{ color: "var(--accent)" }}><Icon name="check" size={13} stroke={2.4}/></span>
                <div style={{ flex: 1, minWidth: 0 }}><div className="sh-mono" style={{ fontSize: 11.5, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{file}</div><div className="sh-faint" style={{ fontSize: 10.5 }}>{when} · {size} · SHA-256 ✓</div></div>
                <button className="sh-iconbtn-sm" title="Download"><Icon name="download" size={12}/></button>
              </div>
            ))}
            <ConfirmButton label="Run backup now" confirmLabel="Confirmar backup?" icon="download" kind="" onConfirm={() => toast({ title: "Backup iniciado", sub: "pg_dump em andamento", icon: "download" })}/>
          </div>
        </div>
      </div>
    </>
  );
}

// ============ SETTINGS / SETUP ============
function SetupScreen({ project, env, nav, drill, toast }) {
  const [tab, setTab] = React.useState("Browser");
  const snippets = {
    Browser: <><span className="tok-key">import</span> {`{ createSignalMonitorClient }`} <span className="tok-key">from</span> <span className="tok-str">"@sigmon/sdk/browser"</span>;<br/><br/><span className="tok-key">const</span> <span className="tok-fn">signal</span> = <span className="tok-fn">createSignalMonitorClient</span>({"{"}<br/>{"  "}<span className="tok-key">endpoint</span>: <span className="tok-str">"https://sigmon.acme.dev"</span>,<br/>{"  "}<span className="tok-key">apiKey</span>: <span className="tok-str">"sh_live_browser_..."</span><br/>{"}"});<br/><br/><span className="tok-fn">signal</span>.<span className="tok-fn">track</span>(<span className="tok-str">"checkout.started"</span>, {"{"} <span className="tok-key">plan</span>: <span className="tok-str">"pro"</span> {"}"});</>,
    Node: <><span className="tok-key">import</span> {`{ createSignalMonitorClient }`} <span className="tok-key">from</span> <span className="tok-str">"@sigmon/sdk/node"</span>;<br/><br/><span className="tok-key">const</span> <span className="tok-fn">signal</span> = <span className="tok-fn">createSignalMonitorClient</span>({"{"} <span className="tok-key">apiKey</span>: process.env.<span className="tok-num">SIGMON_KEY</span> {"}"});<br/><span className="tok-fn">signal</span>.<span className="tok-fn">captureError</span>(err, {"{"} <span className="tok-key">tenant</span>: <span className="tok-str">"acme"</span> {"}"});</>,
    Python: <><span className="tok-com"># pip install sigmon-sdk</span><br/><span className="tok-key">from</span> sigmon <span className="tok-key">import</span> Client<br/>signal = Client(api_key=<span className="tok-str">"sh_live_server_..."</span>)<br/>signal.track(<span className="tok-str">"checkout.started"</span>, plan=<span className="tok-str">"pro"</span>)</>,
    HTTP: <><span className="tok-com">$</span> curl -X POST https://sigmon.acme.dev<span className="tok-str">/v1/events</span> \<br/>{"  "}-H <span className="tok-str">"authorization: Bearer sh_live_..."</span> \<br/>{"  "}-d <span className="tok-str">{`'{"name":"checkout.started"}'`}</span></>
  };
  return (
    <>
      <PageHead title="Setup" sub="Conecte sua aplicação em ~2 minutos. Cada projeto + environment tem chaves isoladas."/>

      <div className="sh-card">
        <div className="sh-card__body" style={{ display: "flex", alignItems: "center", gap: 4, padding: "14px 18px", overflowX: "auto" }}>
          {[["Create project", true],["Create environment", true],["Generate API key", true],["Install SDK", false],["Send first signal", false]].map(([label, done], i, arr) => (
            <React.Fragment key={label}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: done ? "var(--accent)" : "var(--bg-surface-2)", color: done ? "var(--accent-fg)" : "var(--fg-muted)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, border: done ? "none" : `1px solid var(--border)` }}>{done ? <Icon name="check" size={11} stroke={3}/> : i+1}</span>
                <span style={{ fontSize: 12.5, color: done ? "var(--fg)" : "var(--fg-muted)", whiteSpace: "nowrap" }}>{label}</span>
              </div>
              {i < arr.length-1 ? <div style={{ flex: 1, minWidth: 20, height: 1, background: done && arr[i+1][1] ? "var(--accent)" : "var(--border-subtle)", margin: "0 12px" }}/> : null}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0, overflow: "auto" }}>
          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Projects</h2><button className="sh-btn ghost" style={{ padding: "4px 8px" }}><Icon name="plus" size={13}/></button></div>
            <div className="sh-card__body flush">
              {PROJECTS.map(p => (
                <div key={p.id} className={`sh-row ${p.id === project.id ? "is-active" : ""}`} style={{ gridTemplateColumns: "1fr auto auto" }}>
                  <div><strong style={{fontSize: 12.5}}>{p.name}</strong><div className="sh-faint sh-mono" style={{fontSize: 10.5}}>{p.id}</div></div>
                  {p.id === project.id ? <span className="sh-tag ok">selected</span> : <span/>}
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="sh-iconbtn-sm" title="Renomear" onClick={() => toast({ title: "Renomear projeto", sub: p.name, icon: "edit" })}><Icon name="edit" size={12}/></button>
                    <button className="sh-iconbtn-sm" title="Arquivar" onClick={() => toast({ title: "Arquivar projeto", sub: p.name, icon: "archive", tone: "warn" })}><Icon name="archive" size={12}/></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Environments</h2></div>
            <div className="sh-card__body flush">
              {project.envs.map(e => (
                <div key={e.name} className={`sh-row ${e.name === env ? "is-active" : ""}`} style={{ gridTemplateColumns: "1fr auto" }}>
                  <div><strong style={{fontSize: 12.5}}>{e.name}</strong><div className="sh-faint" style={{fontSize: 11}}>{e.name === env ? "2 API keys · receiving" : "ativo"}</div></div>
                  <StatusDot status={e.status} size={7}/>
                </div>
              ))}
            </div>
          </div>

          <div className="sh-card sh-stripe ok" style={{padding:0}}>
            <div className="sh-card__body" style={{paddingLeft: 22, display:"flex", alignItems:"center", gap: 12}}>
              <span style={{color:"var(--accent)"}}><Icon name="check" size={18} stroke={2.4}/></span>
              <div><strong style={{fontSize: 13}}>SDK conectado</strong><div className="sh-muted" style={{fontSize: 11.5}}>Último sinal há 4s · 184 eventos / 60s</div></div>
            </div>
          </div>
        </div>

        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head"><h2 className="sh-h2">Install SDK</h2><Segmented options={["Browser", "Node", "Python", "HTTP"]} value={tab} onChange={setTab}/></div>
          <div className="sh-card__body" style={{ overflow: "auto", flex: 1, display: "grid", gap: 16, alignContent: "start" }}>
            <div>
              <div className="sh-eyebrow" style={{marginBottom: 6}}>1 · Sua chave (escopada a {project.name} / {env})</div>
              <SecretField value="sh_live_browser_4f2a8b1c9e0d7e3a6b8c2f1d4e7a9b3c"/>
              <div className="sh-faint" style={{fontSize: 11, marginTop: 6, display: "flex", gap: 6, alignItems: "center"}}><Icon name="shield" size={11}/> Trate como senha. Chave browser é pública; use server-side key para Node/Python.</div>
            </div>
            <div><div className="sh-eyebrow" style={{marginBottom: 6}}>2 · Instalar</div><div className="sh-code"><span className="tok-com">$</span> pnpm add <span className="tok-str">@sigmon/sdk</span></div></div>
            <div><div className="sh-eyebrow" style={{marginBottom: 6}}>3 · Inicializar ({tab})</div><div className="sh-code">{snippets[tab]}</div></div>
            <div style={{ padding: 12, border: "1px dashed var(--border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--accent-bg-subtle)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon name="play" size={16}/></div>
              <div style={{ flex: 1 }}><strong style={{ fontSize: 13 }}>Enviar evento de teste</strong><div className="sh-muted" style={{ fontSize: 11.5 }}>Dispara um <code style={{color:"var(--fg)"}}>setup.ping</code> para validar.</div></div>
              <button className="sh-btn primary" onClick={() => toast({ title: "Ping enviado", sub: "setup.ping recebido em 32ms", icon: "check", tone: "ok" })}>Enviar ping</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { AlertsScreen, SystemScreen, SetupScreen, FiresTimeline, Suggestion });

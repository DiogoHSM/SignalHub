/* SignalHub v2 — screens A: Overview, Errors (investigate), Incident. */

// ============ OVERVIEW ============
function OverviewScreen({ project, env, nav, drill, toast }) {
  const errorSpark = project.errorTrend;
  const eventsSpark = [320, 340, 360, 380, 410, 425, 440, 450, 470, 480, 495, 510];
  const llmSpark = [12, 14, 16, 14, 18, 22, 28, 24, 26, 30, 34, 38];
  const latencySpark = [820, 790, 810, 850, 880, 920, 940, 910, 880, 860, 830, 820];
  const inc = project.topIncident;

  return (
    <>
      <PageHead
        title="Overview"
        sub={<>Pulso de <strong style={{color:"var(--fg)"}}>{project.name} · {env}</strong> — atualizado há 4s.</>}
        actions={<>
          <Segmented options={["1h", "24h", "7d", "30d"]} value="24h"/>
          <button className="sh-btn"><Icon name="download" size={14}/>Export</button>
        </>}
      />

      {/* Health banner — reflects selected project, or all-clear */}
      {inc ? (
        <div className={`sh-card sh-stripe ${inc.sev === "critical" ? "critical" : "warn"}`}>
          <div className="sh-card__body" style={{ display: "flex", alignItems: "center", gap: 20, paddingLeft: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: `var(--sev-${inc.sev === "critical" ? "critical" : "warning"}-bg)`, color: `var(--sev-${inc.sev === "critical" ? "critical" : "warning"})`, display: "grid", placeItems: "center" }}>
                <Icon name={inc.sev === "critical" ? "error" : "bolt"} size={18}/>
              </span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{project.incidents} incidente(s) ativo(s) · {project.alerts} alerta disparado (30 min)</div>
                <div className="sh-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  <code style={{color:`var(--sev-${inc.sev === "critical" ? "critical" : "warning"})`}}>{inc.code}</code> em {inc.path}{inc.count ? ` · ${inc.count} ocorrências · ${inc.users} users afetados` : ""}
                </div>
              </div>
            </div>
            <button className="sh-btn primary" onClick={() => nav("incidents")}>Ver incidentes <Icon name="arrow" size={12}/></button>
          </div>
        </div>
      ) : (
        <div className="sh-card sh-stripe ok">
          <div className="sh-card__body" style={{ display: "flex", alignItems: "center", gap: 16, paddingLeft: 24 }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-bg-subtle)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon name="check" size={18} stroke={2.4}/></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Nenhum incidente ativo</div>
              <div className="sh-muted" style={{ fontSize: 12, marginTop: 2 }}>{project.name} · {env} operando dentro do esperado nas últimas 24h.</div>
            </div>
            <button className="sh-btn" onClick={() => nav("alerts")}><Icon name="bell" size={13}/>Ver regras</button>
          </div>
        </div>
      )}

      {/* Grouped KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1.5fr 1.4fr", gap: 16 }}>
        <KpiGroup title="Saúde" icon="pulse" items={[
          { label: "Erros (24h)", value: project.eventsRaw > 1e6 ? `${(project.errorRate * project.eventsRaw / 100 / 1000).toFixed(1)}K` : "—", delta: `${project.errorRateDelta > 0 ? "+" : ""}${(project.errorRateDelta * 100).toFixed(0)}%`, deltaDir: project.errorRateDelta > 0 ? "down" : "up", spark: errorSpark, color: "var(--sev-critical)" },
          { label: "Open incidents", value: String(project.incidents) },
          { label: "Error rate", value: `${project.errorRate}%`, delta: `${project.errorRateDelta > 0 ? "+" : ""}${(project.errorRateDelta).toFixed(2)}pp`, deltaDir: project.errorRateDelta > 0 ? "down" : "up" }
        ]}/>
        <KpiGroup title="Uso" icon="activity" items={[
          { label: "Events", value: project.events, delta: "+8%", deltaDir: "up", spark: eventsSpark, color: "var(--accent)" },
          { label: "Active users", value: project.users },
          { label: "Active tenants", value: String(project.tenants) },
          { label: "Traces", value: "31.2K", delta: "+12%", deltaDir: "up" },
          { label: "p95 trace", value: `${project.p95} ms`, spark: latencySpark, color: "var(--sev-warning)" },
          { label: "Avg trace", value: "248 ms" }
        ]}/>
        <KpiGroup title="Custo de IA" icon="sparkles" items={[
          { label: "LLM calls", value: "184.2K", delta: "+22%", deltaDir: "down", spark: llmSpark, color: "var(--sev-violet)" },
          { label: "Cost today", value: `$ ${project.llmCost.toFixed(2)}`, delta: `+$${project.llmDelta}` },
          { label: "Tokens", value: "82.4M" },
          { label: "Top model", value: "gpt-5-mini", small: true }
        ]}/>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        <div className="sh-card">
          <div className="sh-card__head"><h2 className="sh-h2">Top tenants — atividade</h2><span className="sh-tag">ranked by events</span></div>
          <div className="sh-card__body flush" style={{ overflow: "auto" }}>
            {[
              ["Acme Corp", "tenant_acme_prod", 482010, 18.2, 4],
              ["Northwind", "tenant_nw_main", 318204, 12.4, 2],
              ["Globex", "tenant_globex", 241102, 8.9, 1],
              ["Initech", "tenant_initech", 198820, 7.4, 7],
              ["Stark Industries", "tenant_stark", 142018, 5.2, 0]
            ].map(([name, id, events, cost, errors], i) => (
              <button key={id} className="sh-row sh-row--btn" style={{ gridTemplateColumns: "20px 1.5fr 1fr 88px 70px", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid var(--border-subtle)" }}
                onClick={() => drill("tenant", { name, id })}>
                <span className="sh-muted sh-mono">{String(i+1).padStart(2, '0')}</span>
                <div><strong style={{ fontSize: 13 }}>{name}</strong><div className="sh-mono sh-faint" style={{ fontSize: 11 }}>{id}</div></div>
                <Bars data={[3,5,4,6,7,5,8,9,7,8,6,9]} height={24}/>
                <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--sev-violet)" }}>$ {cost.toFixed(2)}</span>
                <span className="sh-tag" style={{ background: errors > 3 ? "var(--sev-critical-bg)" : errors > 0 ? "var(--sev-warning-bg)" : "var(--accent-bg-subtle)", color: errors > 3 ? "var(--sev-critical)" : errors > 0 ? "var(--sev-warning)" : "var(--accent)", borderColor: "transparent" }}>{errors} err</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sh-card">
          <div className="sh-card__head"><h2 className="sh-h2">Custo LLM por modelo</h2><span className="sh-tag">24h</span></div>
          <div className="sh-card__body" style={{ display: "grid", gap: 12 }}>
            {[["gpt-5", 68.42, 0.62, "var(--sev-violet)"],["gpt-5-mini", 31.18, 0.28, "var(--accent)"],["claude-3.7-sonnet", 28.94, 0.26, "var(--sev-info)"],["claude-haiku-4", 9.18, 0.08, "var(--sev-warning)"],["llama-3-70b", 4.46, 0.04, "var(--fg-muted)"]].map(([m, cost, frac, c]) => (
              <div key={m}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}><span className="sh-mono">{m}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>$ {cost.toFixed(2)}</span></div>
                <div style={{ height: 6, borderRadius: 3, background: "var(--bg-canvas)", overflow: "hidden" }}><div style={{ height: "100%", width: `${frac*100}%`, background: c, borderRadius: 3 }}/></div>
              </div>
            ))}
          </div>
        </div>

        <div className="sh-card">
          <div className="sh-card__head"><h2 className="sh-h2">Atividade recente</h2><span className="sh-tag ok"><span className="sh-live-dot"/>live</span></div>
          <div className="sh-card__body flush" style={{ overflow: "auto" }}>
            {[
              ["error", "PaymentTimeoutError", "tenant_acme_prod · 8s atrás", "var(--sev-critical)", () => drill("incident", null)],
              ["activity", "dashboard.created", "user_8420 · 14s atrás", "var(--accent)", null],
              ["sparkles", "llm.call gpt-5", "$0.012 · 22s atrás", "var(--sev-violet)", () => nav("llm")],
              ["activity", "checkout.completed", "tenant_nw_main · 41s atrás", "var(--accent)", null],
              ["waterfall", "trace generate_report", "1.84s · 1m atrás", "var(--sev-info)", () => nav("traces")],
              ["error", "ValidationError", "user_2014 · 1m atrás", "var(--sev-warning)", () => drill("incident", null)]
            ].map(([icon, title, sub, color, onClick], i) => (
              <button key={i} className="sh-row--btn" style={{ display: "flex", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--border-subtle)", alignItems: "center", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottomColor: "var(--border-subtle)", borderBottomStyle: "solid", borderBottomWidth: 1, cursor: onClick ? "pointer" : "default" }}
                onClick={onClick || undefined}>
                <span style={{ color }}><Icon name={icon} size={14}/></span>
                <div style={{ flex: 1, minWidth: 0 }}><div className="sh-mono" style={{ fontSize: 12 }}>{title}</div><div className="sh-faint" style={{ fontSize: 11 }}>{sub}</div></div>
                {onClick ? <Icon name="chev" size={12} style={{ color: "var(--fg-faint)" }}/> : null}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function KpiGroup({ title, icon, items }) {
  return (
    <div className="sh-card">
      <div className="sh-card__head"><h2 className="sh-h2" style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon name={icon} size={15}/> {title}</h2></div>
      <div className="sh-card__body" style={{ display: "grid", gridTemplateColumns: items.length > 3 ? "1fr 1fr" : "1fr", gap: 14 }}>
        {items.map((it, i) => (
          <div key={i}>
            <div className="sh-kpi__label">{it.label}</div>
            <div className="sh-kpi__value" style={{ fontSize: it.small ? 14 : 22, fontFamily: it.small ? "var(--font-mono)" : "var(--font-sans)", marginTop: 4 }}>{it.value}</div>
            {it.spark ? <div style={{ marginTop: 6 }}><Sparkline data={it.spark} color={it.color} height={26}/></div>
              : it.delta ? <div className="sh-kpi__meta" style={{ marginTop: 4 }}><span className={`sh-delta ${it.deltaDir || "up"}`}>{it.delta}</span> vs. ontem</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* NOTE: ErrorsScreen (S2) and IncidentScreen (S3) also live in this file in the
   design project; pull them from DesignSync when speccing S2/S3. This local copy
   carries OverviewScreen (S1) + KpiGroup for the S1 spec/plan. */

Object.assign(window, { OverviewScreen, KpiGroup });

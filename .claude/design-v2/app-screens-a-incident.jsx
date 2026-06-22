/* SignalHub v2 — IncidentScreen (S3) design source, pulled from DesignSync project 019de713. Port to TSX, English copy, F1 ui/v2 primitives. */

// ============ INCIDENT (drill target) ============
function IncidentScreen({ project, env, error, nav, drill, back, toast }) {
  const e = error || { msg: "PaymentTimeoutError: provider timeout after 12000ms", id: "err_grp_8a2f91d0", priority: "P1" };
  const occ = [4,2,3,5,8,6,4,5,3,2,8,14,28,42,38,30,18,9,6,4,3,5,4,8].map(v => v*2 + (v%3));
  const [bcOpen, setBcOpen] = React.useState(true);

  return (
    <>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
          <span className="sh-tag critical" style={{ fontSize: 11 }}>● CRITICAL</span>
          <span className="sh-tag warn">Investigating</span>
          <span className="sh-tag mono">{e.id}</span>
          <span className="sh-tag mono">release v2026.05.14</span>
          <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>INC-4821 · opened 18 min ago · assigned to ana@acme.dev</span>
        </div>
        <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.01em", margin: "8px 0", fontFamily: "var(--font-mono)" }}>{e.msg}</h1>
        <p className="sh-muted" style={{ margin: 0, fontSize: 13 }}>
          Originada em <code style={{color:"var(--fg)"}}>apps/api/src/routes/checkout.ts:142</code> · charge_customer span · {project.name} / {env}
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <ConfirmButton label="Resolver" confirmLabel="Confirmar resolução?" icon="check" kind="primary"
          onConfirm={() => { toast({ title: "Incidente resolvido", sub: `${e.id} marcado como resolved`, icon: "check", tone: "ok" }); back(); }}/>
        <button className="sh-btn" onClick={() => toast({ title: "Reatribuído a marco@acme.dev", icon: "user" })}><Icon name="user" size={14}/>Reassign</button>
        <button className="sh-btn" onClick={() => toast({ title: "Silenciado por 1h", icon: "bell" })}><Icon name="bell" size={14}/>Silenciar 1h</button>
        <button className="sh-btn" onClick={() => toast({ title: "Issue criada no GitHub", sub: "acme/platform#4821", icon: "git" })}><Icon name="git" size={14}/>Criar issue</button>
        <button className="sh-btn ghost" onClick={() => toast({ title: "Link copiado", icon: "link" })}><Icon name="copy" size={14}/>Copiar link</button>
        <div style={{ flex: 1 }}/>
        <span className="sh-tag">priority <strong style={{color:"var(--sev-critical)", marginLeft: 4}}>{e.priority || "P1"}</strong></span>
        <span className="sh-tag">{e.count || 412} ocorrências</span>
        <span className="sh-tag">{e.users || 38} users · {e.tenants || 2} tenants</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Ocorrências (24h)</h2><span className="sh-faint" style={{ fontSize: 11 }}>spike em 14h · 42 erros/h</span></div>
            <div className="sh-card__body" style={{ paddingBottom: 12 }}>
              <Bars data={occ} color="var(--sev-critical)" height={64} highlight={13}/>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 10, color: "var(--fg-faint)", fontFamily: "var(--font-mono)" }}>
                <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
              </div>
            </div>
          </div>

          <div className="sh-card" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div className="sh-card__head">
              <h2 className="sh-h2">Stack trace</h2>
              <div style={{ display: "flex", gap: 6 }}>
                <span className="sh-tag ok"><Icon name="check" size={11} stroke={2.4}/>source maps resolved</span>
                <span className="sh-tag mono">v2026.05.14</span>
              </div>
            </div>
            <div className="sh-card__body flush" style={{ overflow: "auto", flex: 1 }}>
              <pre style={{ margin: 0, padding: 16, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.7, color: "var(--fg-secondary)" }}>
{`PaymentTimeoutError: provider timeout after 12000ms\n    at `}<span style={{color: "var(--sev-violet)"}}>chargeCustomer</span>{` (`}<span style={{color: "var(--accent))"}}>src/services/payment/charge.ts:84:12</span>{`)\n    at `}<span style={{color: "var(--sev-violet)"}}>processCheckout</span>{` (`}<span style={{color: "var(--accent))"}}>src/routes/checkout.ts:142:8</span>{`)\n    at `}<span style={{color: "var(--sev-violet)"}}>middleware.tracedHandler</span>{` (`}<span style={{color: "var(--accent))"}}>src/lib/tracing.ts:38:5</span>{`)`}
              </pre>
              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-canvas)", display: "flex", gap: 12, alignItems: "center", fontSize: 11.5, color: "var(--fg-muted)" }}>
                <Icon name="bolt" size={12}/>Frame 1: <code style={{color:"var(--fg)"}}>charge.ts:84</code> usa <code style={{color:"var(--fg)"}}>AbortSignal.timeout(12000)</code> — provider parou de responder.
              </div>
            </div>
          </div>

          {/* Collapsible breadcrumbs (accordion) */}
          <div className="sh-card">
            <button className="sh-card__head" style={{ width: "100%", background: "transparent", border: "none", borderBottom: bcOpen ? "1px solid var(--border-subtle)" : "none", cursor: "pointer" }}
              onClick={() => setBcOpen(o => !o)} aria-expanded={bcOpen}>
              <h2 className="sh-h2" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="chevd" size={14} style={{ transform: bcOpen ? "none" : "rotate(-90deg)", transition: "transform .25s" }}/>
                Breadcrumbs — sessão antes do erro
              </h2>
              <span className="sh-tag">user_8420 · sess_b91</span>
            </button>
            <div className="hr-acc" data-open={bcOpen}>
              <div className="hr-acc__inner">
                {[["navigation", "/cart", "12:42:08", "var(--sev-info)"],["click", "button[data-cta='checkout']", "12:42:14", "var(--fg-muted)"],["network", "POST /api/checkout · pending", "12:42:14", "var(--sev-warning)"],["span", "stripe.charge.create started", "12:42:14", "var(--sev-violet)"],["error", "PaymentTimeoutError", "12:42:26", "var(--sev-critical)"]].map(([type, msg, time, color], i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 70px 1fr 30px", gap: 12, alignItems: "center", padding: "8px 16px", borderBottom: "1px solid var(--border-subtle)", fontSize: 12 }}>
                    <span className="sh-mono" style={{ color, fontSize: 11 }}>{type}</span>
                    <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>{time}</span>
                    <span style={{ color: "var(--fg-secondary)" }} className="sh-mono">{msg}</span>
                    <Icon name="ext" size={12} style={{ color: "var(--fg-faint)" }}/>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0, overflow: "auto" }}>
          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Impacto</h2></div>
            <div className="sh-card__body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[["Users affected", String(e.users || 38), "var(--sev-critical)"],["Tenants", String(e.tenants || 2), "var(--sev-warning)"],["Sessions", "47", "var(--fg)"],["First seen", "32m ago", "var(--fg-secondary)"]].map(([k, v, c]) => (
                <div key={k}><div className="sh-kpi__label">{k}</div><div className="sh-kpi__value" style={{ color: c, fontSize: 20, marginTop: 3 }}>{v}</div></div>
              ))}
            </div>
          </div>

          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Sinais relacionados</h2></div>
            <div className="sh-card__body flush">
              <RelItem icon="waterfall" tone="info" title="trace_checkout_b14" sub="duration 12.4s · failed at stripe.charge" onClick={() => nav("traces")}/>
              <RelItem icon="sparkles" tone="violet" title="llm fraud_check" sub="gpt-5 · 842ms · success" onClick={() => nav("llm")}/>
              <RelItem icon="activity" tone="ok" title="checkout.started" sub="412 events em janela 24h"/>
              <RelItem icon="error" tone="critical" title="StripeAPIError" sub="rate ↑ 4.2x · grupo correlato" onClick={() => drill("incident", { msg: "StripeAPIError: rate_limited", id: "err_grp_4c1d", priority: "P1", count: 184, users: 22, tenants: 1 })}/>
            </div>
          </div>

          <div className="sh-card">
            <div className="sh-card__head"><h2 className="sh-h2">Notas da triagem</h2></div>
            <div className="sh-card__body" style={{ display: "grid", gap: 10 }}>
              {[["Ana M.", "Provider com degradação confirmada via status.stripe.com", "8 min atrás"],["Marco S.", "Reduzi timeout para 8s no /checkout · monitorando", "2 min atrás"]].map(([who, what, when]) => (
                <div key={who} style={{ display: "flex", gap: 10 }}>
                  <div className="tb-avatar" style={{ width: 26, height: 26, fontSize: 10 }}>{who.split(' ').map(x => x[0]).join('')}</div>
                  <div style={{ flex: 1 }}><div style={{ fontSize: 12 }}><strong>{who}</strong> <span className="sh-faint">· {when}</span></div><div className="sh-muted" style={{ fontSize: 12, marginTop: 2 }}>{what}</div></div>
                </div>
              ))}
              <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                <input className="sh-input" placeholder="Adicionar nota…"/>
                <button className="sh-btn primary" style={{ padding: "8px 10px" }} onClick={() => toast({ title: "Nota adicionada", icon: "check" })}><Icon name="arrow" size={13}/></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function RelItem({ icon, tone, title, sub, onClick }) {
  const colorMap = { critical: "var(--sev-critical)", warn: "var(--sev-warning)", info: "var(--sev-info)", ok: "var(--accent)", violet: "var(--sev-violet)" };
  const bgMap = { critical: "var(--sev-critical-bg)", warn: "var(--sev-warning-bg)", info: "var(--sev-info-bg)", ok: "var(--accent-bg-subtle)", violet: "var(--sev-violet-bg)" };
  return (
    <button className="sh-row--btn" style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderBottom: "1px solid var(--border-subtle)", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottomColor: "var(--border-subtle)", borderBottomStyle: "solid", borderBottomWidth: 1, cursor: onClick ? "pointer" : "default" }} onClick={onClick || undefined}>
      <span style={{ width: 28, height: 28, borderRadius: 7, display: "grid", placeItems: "center", color: colorMap[tone], background: bgMap[tone], flex: "0 0 auto" }}><Icon name={icon} size={14}/></span>
      <div style={{ flex: 1, minWidth: 0 }}><div className="sh-mono" style={{ fontSize: 12 }}>{title}</div><div className="sh-faint" style={{ fontSize: 11, marginTop: 1 }}>{sub}</div></div>
      {onClick ? <Icon name="chev" size={12} style={{ color: "var(--fg-faint)" }}/> : null}
    </button>
  );
}

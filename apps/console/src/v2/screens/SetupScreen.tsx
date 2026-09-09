import { useState, type ReactNode } from "react";
import { EmptyHint, Icon, PageHead, SecretField, Segmented } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useSetup } from "./useSetup";

const SNIPPET_TABS = ["Browser", "Node", "Python", "HTTP"] as const;
type SnippetTab = (typeof SNIPPET_TABS)[number];

const KEY_PLACEHOLDER = "sh_live_browser_…";

function snippet(tab: SnippetTab, endpoint: string, key: string): ReactNode {
  if (tab === "Node") {
    return (
      <>
        <span className="tok-key">import</span> {"{ createSignalMonitorClient }"} <span className="tok-key">from</span> <span className="tok-str">"@sigmon/sdk/node"</span>;<br /><br />
        <span className="tok-key">const</span> <span className="tok-fn">signal</span> = <span className="tok-fn">createSignalMonitorClient</span>({"{"}<br />
        {"  "}<span className="tok-key">endpoint</span>: <span className="tok-str">"{endpoint}"</span>,<br />
        {"  "}<span className="tok-key">apiKey</span>: process.env.<span className="tok-num">SIGMON_KEY</span><br />
        {"}"});<br />
        <span className="tok-fn">signal</span>.<span className="tok-fn">track</span>(<span className="tok-str">"checkout.started"</span>);<br />
        <span className="tok-key">await</span>{" "}<span className="tok-fn">signal</span>.<span className="tok-fn">flush</span>();
      </>
    );
  }
  if (tab === "Python") {
    return (
      <>
        <span className="tok-com"># No Python SDK yet — post straight to the ingestion API.</span><br />
        <span className="tok-key">import</span> os, requests<br /><br />
        requests.post(<br />
        {"  "}<span className="tok-str">"{endpoint}/v1/events"</span>,<br />
        {"  "}headers={"{"}<span className="tok-str">"authorization"</span>: <span className="tok-str">"Bearer "</span> + os.environ[<span className="tok-str">"SIGMON_KEY"</span>]{"}"},<br />
        {"  "}json={"{"}<span className="tok-str">"name"</span>: <span className="tok-str">"checkout.started"</span>{"}"},<br />
        )
      </>
    );
  }
  if (tab === "HTTP") {
    return (
      <>
        <span className="tok-com">$</span> curl -X POST <span className="tok-str">{endpoint}/v1/events</span> \<br />
        {"  "}-H <span className="tok-str">"authorization: Bearer $SIGMON_KEY"</span> \<br />
        {"  "}-H <span className="tok-str">"content-type: application/json"</span> \<br />
        {"  "}-d <span className="tok-str">{`'{"name":"checkout.started"}'`}</span>
      </>
    );
  }
  return (
    <>
      <span className="tok-key">import</span> {"{ createSignalMonitorClient }"} <span className="tok-key">from</span> <span className="tok-str">"@sigmon/sdk/browser"</span>;<br /><br />
      <span className="tok-key">const</span> <span className="tok-fn">signal</span> = <span className="tok-fn">createSignalMonitorClient</span>({"{"}<br />
      {"  "}<span className="tok-key">endpoint</span>: <span className="tok-str">"{endpoint}"</span>,<br />
      {"  "}<span className="tok-key">apiKey</span>: <span className="tok-str">"{key}"</span><br />
      {"}"});<br /><br />
      <span className="tok-fn">signal</span>.<span className="tok-fn">track</span>(<span className="tok-str">"checkout.started"</span>, {"{"} <span className="tok-key">plan</span>: <span className="tok-str">"pro"</span> {"}"});<br />
      <span className="tok-key">await</span>{" "}<span className="tok-fn">signal</span>.<span className="tok-fn">flush</span>();
    </>
  );
}

export function SetupScreen({ ctx }: { ctx: ScreenCtx }) {
  const setup = useSetup({ ctx });
  const [tab, setTab] = useState<SnippetTab>("Browser");

  if (setup.status === "loading" && !setup.data) {
    return (
      <>
        <PageHead title="Installation & SDK" sub="Connect your application in ~2 minutes. Each project + environment has isolated keys." />
        <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
          <EmptyHint icon="activity" title="Loading setup…" sub="Fetching projects, keys and ingestion status." />
        </div>
      </>
    );
  }
  if (!setup.data) {
    return (
      <>
        <PageHead title="Installation & SDK" sub="Connect your application in ~2 minutes. Each project + environment has isolated keys." />
        <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
          <EmptyHint icon="alert" title="Could not load setup" sub="Check your connection and retry." /><button className="sh-btn" type="button" onClick={setup.reload}>Retry installation</button>
        </div>
      </>
    );
  }

  const vm = setup.data;

  if (!ctx.project || !ctx.environment) return <><PageHead title="Installation & SDK" sub="Choose a project and environment to connect your application." /><button className="sh-btn primary" type="button" onClick={() => ctx.navigate(ctx.project ? "settings" : "administration")}>{ctx.project ? "Create an environment" : "Create a project"}</button></>;

  const keyValue = tab === "Browser" ? setup.latestSecret : null;

  return (
    <>
      <PageHead title="Installation & SDK" sub="Connect your application in ~2 minutes. Each project + environment has isolated keys." />

      {/* Onboarding stepper */}
      <div className="sh-card">
        <div className="sh-card__body" style={{ display: "flex", alignItems: "center", gap: 4, padding: "14px 18px", overflowX: "auto" }}>
          {vm.steps.map((step, i) => (
            <div key={step.label} style={{ display: "contents" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: step.done ? "var(--accent)" : "var(--bg-surface-2)", color: step.done ? "var(--accent-fg)" : "var(--fg-muted)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, border: step.done ? "none" : "1px solid var(--border)" }}>
                  {step.done ? <Icon name="check" size={11} stroke={3} /> : i + 1}
                </span>
                <span style={{ fontSize: 12.5, color: step.done ? "var(--fg)" : "var(--fg-muted)", whiteSpace: "nowrap" }}>{step.label}</span>
              </div>
              {i < vm.steps.length - 1 ? (
                <div style={{ flex: 1, minWidth: 20, height: 1, background: step.done && vm.steps[i + 1].done ? "var(--accent)" : "var(--border-subtle)", margin: "0 12px" }} />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 16 }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* SDK connected banner */}
          {vm.banner.connected ? (
            <div className="sh-card sh-stripe ok" style={{ padding: 0 }}>
              <div className="sh-card__body" style={{ paddingLeft: 22, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: "var(--accent)" }}><Icon name="check" size={18} stroke={2.4} /></span>
                <div><strong style={{ fontSize: 13 }}>{vm.banner.title}</strong><div className="sh-muted" style={{ fontSize: 11.5 }}>{vm.banner.detail}</div></div>
              </div>
            </div>
          ) : (
            <div className="sh-card">
              <div className="sh-card__body" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: "var(--fg-muted)" }}><Icon name="clock" size={18} /></span>
                <div><strong style={{ fontSize: 13 }}>{vm.banner.title}</strong><div className="sh-muted" style={{ fontSize: 11.5 }}>{vm.banner.detail}</div></div>
              </div>
            </div>
          )}

          <button className="sh-btn" type="button" onClick={() => ctx.navigate("settings")}>Manage credentials, origins and environments</button>
        </div>

        {/* Right column — Install SDK */}
        <div className="sh-card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Install SDK</h2>
            <Segmented options={[...SNIPPET_TABS]} value={tab} onChange={(v) => setTab(v as SnippetTab)} />
          </div>
          <div className="sh-card__body" style={{ overflow: "auto", flex: 1, display: "grid", gap: 16, alignContent: "start" }}>
            <div>
              <div className="sh-eyebrow" style={{ marginBottom: 6 }}>1 · Your key (scoped to {vm.keyScopeLabel})</div>
              {tab !== "Browser" ? (
                <button className="sh-btn primary" type="button" onClick={() => ctx.navigate("settings")}>Manage server credentials</button>
              ) : keyValue ? (
                <SecretField value={keyValue} />
              ) : (
                <button className="sh-btn primary" type="button" disabled={setup.busy} onClick={() => void setup.generateApiKey()}>
                  <Icon name="key" size={13} />Generate API key
                </button>
              )}
              <div className="sh-faint" style={{ fontSize: 11, marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
                <Icon name="shield" size={11} /> {tab === "Browser" ? "Browser keys are public. Allow your application origin in Project settings before sending browser telemetry." : "Create a server API key in Project settings → Credentials & origins. Store it in the SIGMON_KEY environment variable on your server; keep it secret."}
              </div>
            </div>
            <div>
              <div className="sh-eyebrow" style={{ marginBottom: 6 }}>2 · Install</div>
              {tab === "HTTP" ? <p className="sh-muted">Use curl from your server terminal. No SDK installation is required.</p> : <div className="sh-code">{tab === "Python" ? "python -m pip install requests" : "pnpm add @sigmon/sdk"}</div>}
            </div>
            <div>
              <div className="sh-eyebrow" style={{ marginBottom: 6 }}>3 · Initialize ({tab})</div>
              <div className="sh-code">{snippet(tab, vm.endpoint, keyValue ?? KEY_PLACEHOLDER)}</div>
            </div>
            <div style={{ padding: 12, border: "1px dashed var(--border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--accent-bg-subtle)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon name="play" size={16} /></div>
              <div style={{ flex: 1 }}><strong style={{ fontSize: 13 }}>Run the example in your application</strong><div className="sh-muted" style={{ fontSize: 11.5 }}>Then check whether telemetry has reached this project and environment.</div></div>
              <button className="sh-btn primary" type="button" disabled={setup.status === "loading"} onClick={setup.reload}>Check for telemetry</button>
            </div>
          </div>
        </div>
      </div>

    </>
  );
}

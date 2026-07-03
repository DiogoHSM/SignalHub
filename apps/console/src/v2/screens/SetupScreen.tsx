import { useEffect, useState, type ReactNode } from "react";
import { EmptyHint, Icon, PageHead, SecretField, Segmented, StatusDot } from "../../components/ui/v2";
import type { CodeIntegration, CodeIntegrationProvider } from "../../api/types";
import type { ScreenCtx } from "./registry";
import { useSetup } from "./useSetup";
import { ArtifactsSection } from "./ArtifactsSection";

const SNIPPET_TABS = ["Browser", "Node", "Python", "HTTP"] as const;
type SnippetTab = (typeof SNIPPET_TABS)[number];

const KEY_PLACEHOLDER = "sh_live_browser_…";

function CodeHostingSection({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id ?? "";
  const [integrations, setIntegrations] = useState<CodeIntegration[]>([]);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<CodeIntegrationProvider>("github");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");

  async function reload() {
    if (!projectId || !ctx.client.listCodeIntegrations) return;
    setLoading(true);
    try {
      const response = await ctx.client.listCodeIntegrations(projectId);
      setIntegrations(response.integrations);
    } catch (err) {
      console.error(err);
      ctx.pushToast("Could not load code integrations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function createIntegration() {
    if (!projectId || !ctx.client.createCodeIntegration) return;
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim();
    if (!cleanOwner || !cleanRepo) {
      ctx.pushToast("Owner and repository are required");
      return;
    }
    try {
      const response = await ctx.client.createCodeIntegration(projectId, {
        provider,
        name: name.trim() || `${cleanOwner}/${cleanRepo}`,
        owner: cleanOwner,
        repo: cleanRepo
      });
      setIntegrations((items) => [response.integration, ...items.filter((item) => item.id !== response.integration.id)]);
      setName("");
      setOwner("");
      setRepo("");
      ctx.pushToast("Code integration connected");
    } catch (err) {
      console.error(err);
      ctx.pushToast("Could not connect repository");
    }
  }

  async function revokeIntegration(id: string) {
    if (!projectId || !ctx.client.revokeCodeIntegration) return;
    try {
      await ctx.client.revokeCodeIntegration(projectId, id);
      setIntegrations((items) => items.filter((item) => item.id !== id));
      ctx.pushToast("Repository disconnected");
    } catch (err) {
      console.error(err);
      ctx.pushToast("Could not disconnect repository");
    }
  }

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <div>
          <h2 className="sh-h2">Code hosting</h2>
          <div className="sh-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
            Link releases and incident drafts to GitHub or GitLab without storing tokens.
          </div>
        </div>
        {loading ? <span className="sh-tag">loading</span> : <span className="sh-tag">{integrations.length}</span>}
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 12 }}>
        {integrations.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {integrations.map((integration) => (
              <div key={integration.id} className="sh-row" style={{ gridTemplateColumns: "1fr auto auto" }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 12.5 }}>{integration.name}</strong>
                  <div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>
                    {integration.provider} · {integration.owner}/{integration.repo}
                  </div>
                </div>
                <a className="sh-btn ghost" href={integration.webBaseUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
                <button
                  className="sh-iconbtn-sm"
                  type="button"
                  title="Disconnect repository"
                  aria-label={`Disconnect ${integration.name}`}
                  onClick={() => void revokeIntegration(integration.id)}
                >
                  <Icon name="archive" size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="sh-muted" style={{ fontSize: 12 }}>
            No repository connected yet. Incident pages can still be copied manually.
          </div>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          <Segmented options={["github", "gitlab"]} value={provider} onChange={(value) => setProvider(value as CodeIntegrationProvider)} />
          <input className="sh-input" value={name} placeholder="Display name, e.g. Web app" onChange={(event) => setName(event.target.value)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input className="sh-input" value={owner} placeholder="Owner or group" onChange={(event) => setOwner(event.target.value)} />
            <input className="sh-input" value={repo} placeholder="Repository" onChange={(event) => setRepo(event.target.value)} />
          </div>
          <button className="sh-btn primary" type="button" disabled={!ctx.client.createCodeIntegration} onClick={() => void createIntegration()}>
            <Icon name="git" size={13} /> Connect repository
          </button>
        </div>
      </div>
    </div>
  );
}

function snippet(tab: SnippetTab, endpoint: string, key: string): ReactNode {
  if (tab === "Node") {
    return (
      <>
        <span className="tok-key">import</span> {"{ createSignalMonitorClient }"} <span className="tok-key">from</span> <span className="tok-str">"@sigmon/sdk/node"</span>;<br /><br />
        <span className="tok-key">const</span> <span className="tok-fn">signal</span> = <span className="tok-fn">createSignalMonitorClient</span>({"{"} <span className="tok-key">apiKey</span>: process.env.<span className="tok-num">SIGMON_KEY</span> {"}"});<br />
        <span className="tok-fn">signal</span>.<span className="tok-fn">captureError</span>(err);
      </>
    );
  }
  if (tab === "Python") {
    return (
      <>
        <span className="tok-com"># pip install sigmon-sdk</span><br />
        <span className="tok-key">from</span> sigmon <span className="tok-key">import</span> Client<br />
        signal = Client(api_key=<span className="tok-str">"{key}"</span>)<br />
        signal.track(<span className="tok-str">"checkout.started"</span>, plan=<span className="tok-str">"pro"</span>)
      </>
    );
  }
  if (tab === "HTTP") {
    return (
      <>
        <span className="tok-com">$</span> curl -X POST <span className="tok-str">{endpoint}/v1/events</span> \<br />
        {"  "}-H <span className="tok-str">"authorization: Bearer {key}"</span> \<br />
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
      <span className="tok-fn">signal</span>.<span className="tok-fn">track</span>(<span className="tok-str">"checkout.started"</span>, {"{"} <span className="tok-key">plan</span>: <span className="tok-str">"pro"</span> {"}"});
    </>
  );
}

export function SetupScreen({ ctx }: { ctx: ScreenCtx }) {
  const setup = useSetup({ ctx });
  const [tab, setTab] = useState<SnippetTab>("Browser");
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creatingEnv, setCreatingEnv] = useState(false);
  const [newEnvName, setNewEnvName] = useState("");

  if (setup.status === "loading" && !setup.data) {
    return (
      <>
        <PageHead title="Setup" sub="Connect your application in ~2 minutes. Each project + environment has isolated keys." />
        <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
          <EmptyHint icon="activity" title="Loading setup…" sub="Fetching projects, keys and ingestion status." />
        </div>
      </>
    );
  }
  if (!setup.data) {
    return (
      <>
        <PageHead title="Setup" sub="Connect your application in ~2 minutes. Each project + environment has isolated keys." />
        <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
          <EmptyHint icon="alert" title="Could not load setup" sub="Try refreshing the page." />
        </div>
      </>
    );
  }

  const vm = setup.data;

  async function submitNewProject() {
    const name = newProjectName.trim();
    if (!name) return;
    await setup.createProject(name);
    setNewProjectName("");
    setCreatingProject(false);
  }
  async function submitRename(id: string) {
    const name = renameValue.trim();
    if (!name) { setRenamingId(null); return; }
    await setup.renameProject(id, name);
    setRenamingId(null);
  }
  async function submitNewEnv() {
    const name = newEnvName.trim();
    if (!name) return;
    await setup.createEnvironment(name);
    setNewEnvName("");
    setCreatingEnv(false);
  }

  const keyValue = setup.latestSecret;

  return (
    <>
      <PageHead title="Setup" sub="Connect your application in ~2 minutes. Each project + environment has isolated keys." />

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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16, flex: 1, minHeight: 0 }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0, overflow: "auto" }}>
          {/* Projects */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2">Projects</h2>
              <button className="sh-btn ghost" style={{ padding: "4px 8px" }} type="button" aria-label="New project" onClick={() => setCreatingProject((v) => !v)}>
                <Icon name="plus" size={13} />
              </button>
            </div>
            <div className="sh-card__body flush">
              {creatingProject ? (
                <div className="sh-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <input autoFocus className="sh-input" aria-label="New project name" value={newProjectName} placeholder="Project name" onChange={(e) => setNewProjectName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitNewProject(); if (e.key === "Escape") setCreatingProject(false); }} />
                  <button className="sh-btn primary" type="button" disabled={setup.busy} onClick={() => void submitNewProject()}>Create</button>
                </div>
              ) : null}
              {vm.projects.map((p) => (
                <div key={p.id} className={`sh-row ${p.isActive ? "is-active" : ""}`} style={{ gridTemplateColumns: "1fr auto auto" }}>
                  {renamingId === p.id ? (
                    <input autoFocus className="sh-input" aria-label="Rename project" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitRename(p.id); if (e.key === "Escape") setRenamingId(null); }} onBlur={() => setRenamingId(null)} />
                  ) : (
                    <div><strong style={{ fontSize: 12.5 }}>{p.name}</strong><div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>{p.id}</div></div>
                  )}
                  {p.isActive ? <span className="sh-tag ok">selected</span> : <span />}
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="sh-iconbtn-sm" type="button" title="Rename" aria-label={`Rename ${p.name}`} onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}><Icon name="edit" size={12} /></button>
                    <button className="sh-iconbtn-sm" type="button" title="Archive" aria-label={`Archive ${p.name}`} onClick={() => void setup.archiveProject(p.id)}><Icon name="archive" size={12} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Environments */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2">Environments</h2>
              <button className="sh-btn ghost" style={{ padding: "4px 8px" }} type="button" aria-label="New environment" onClick={() => setCreatingEnv((v) => !v)}>
                <Icon name="plus" size={13} />
              </button>
            </div>
            <div className="sh-card__body flush">
              {creatingEnv ? (
                <div className="sh-row" style={{ gridTemplateColumns: "1fr auto" }}>
                  <input autoFocus className="sh-input" aria-label="New environment name" value={newEnvName} placeholder="Environment name" onChange={(e) => setNewEnvName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submitNewEnv(); if (e.key === "Escape") setCreatingEnv(false); }} />
                  <button className="sh-btn primary" type="button" disabled={setup.busy} onClick={() => void submitNewEnv()}>Create</button>
                </div>
              ) : null}
              {vm.environments.map((e) => (
                <div key={e.id} className={`sh-row ${e.isActive ? "is-active" : ""}`} style={{ gridTemplateColumns: "1fr auto" }}>
                  <div><strong style={{ fontSize: 12.5 }}>{e.name}</strong><div className="sh-faint" style={{ fontSize: 11 }}>{e.detail}</div></div>
                  <StatusDot status={e.status} size={7} />
                </div>
              ))}
            </div>
          </div>

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

          <CodeHostingSection ctx={ctx} />
        </div>

        {/* Right column — Install SDK */}
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Install SDK</h2>
            <Segmented options={[...SNIPPET_TABS]} value={tab} onChange={(v) => setTab(v as SnippetTab)} />
          </div>
          <div className="sh-card__body" style={{ overflow: "auto", flex: 1, display: "grid", gap: 16, alignContent: "start" }}>
            <div>
              <div className="sh-eyebrow" style={{ marginBottom: 6 }}>1 · Your key (scoped to {vm.keyScopeLabel})</div>
              {keyValue ? (
                <SecretField value={keyValue} />
              ) : (
                <button className="sh-btn primary" type="button" disabled={setup.busy} onClick={() => void setup.generateApiKey()}>
                  <Icon name="key" size={13} />Generate API key
                </button>
              )}
              <div className="sh-faint" style={{ fontSize: 11, marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
                <Icon name="shield" size={11} /> Treat like a password. The browser key is public; use a server-side key for Node/Python.
              </div>
            </div>
            <div>
              <div className="sh-eyebrow" style={{ marginBottom: 6 }}>2 · Install</div>
              <div className="sh-code"><span className="tok-com">$</span> pnpm add <span className="tok-str">@sigmon/sdk</span></div>
            </div>
            <div>
              <div className="sh-eyebrow" style={{ marginBottom: 6 }}>3 · Initialize ({tab})</div>
              <div className="sh-code">{snippet(tab, vm.endpoint, keyValue ?? KEY_PLACEHOLDER)}</div>
            </div>
            <div style={{ padding: 12, border: "1px dashed var(--border)", borderRadius: 8, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--accent-bg-subtle)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icon name="play" size={16} /></div>
              <div style={{ flex: 1 }}><strong style={{ fontSize: 13 }}>Send a test event</strong><div className="sh-muted" style={{ fontSize: 11.5 }}>Fires a <code style={{ color: "var(--fg)" }}>setup.ping</code> to validate.</div></div>
              <button className="sh-btn primary" type="button" onClick={() => ctx.pushToast("Test ping is not yet available")}>Send ping</button>
            </div>
          </div>
        </div>
      </div>

      <ArtifactsSection ctx={ctx} />
    </>
  );
}

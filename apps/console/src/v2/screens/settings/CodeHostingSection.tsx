import { useEffect, useState } from "react";
import { Icon, Segmented } from "../../../components/ui/v2";
import type { CodeIntegration, CodeIntegrationProvider } from "../../../api/types";
import type { ScreenCtx } from "../registry";

export function CodeHostingSection({ ctx }: { ctx: ScreenCtx }) {
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


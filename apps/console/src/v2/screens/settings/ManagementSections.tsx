import { useEffect, useState } from "react";
import type { Project } from "../../../api/types";
import { ConfirmButton, EmptyHint } from "../../../components/ui/v2";
import type { ScreenCtx } from "../registry";

export function ManagementSection({ ctx, kind }: { ctx: ScreenCtx; kind: "projects" | "environments" | "general" }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(kind === "projects");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (kind !== "projects") return;
    let active = true;
    setLoading(true);
    setError(null);
    ctx.client.listProjects().then((result) => { if (active) setProjects(result.projects); }).catch(() => { if (active) setError("Could not load projects."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ctx.client, kind, tick]);
  const isEnv = kind === "environments";
  const label = isEnv ? "environment" : "project";
  const rows = isEnv ? ctx.environments : kind === "general" ? (ctx.project ? [ctx.project] : []) : projects;
  async function mutate(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditing(null);
      setName("");
      setTick((value) => value + 1);
      ctx.refreshProjects?.();
    } catch {
      setError(`Could not save ${label}. Your draft is preserved; try again.`);
    } finally { setBusy(false); }
  }
  function save() {
    if (!name.trim() || !editing) return;
    void mutate(() => editing === "new"
      ? isEnv ? ctx.onCreateEnvironment(name.trim()) : ctx.client.createProject({ name: name.trim() })
      : isEnv ? ctx.client.updateEnvironment(editing, { name: name.trim() }) : ctx.onUpdateProject(editing, { name: name.trim() }));
  }
  return <section className="sh-card">
    <div className="sh-card__head"><h2 className="sh-h2">{kind === "general" ? "General" : isEnv ? "Environments" : "Projects"}</h2>
      {kind !== "general" && <button className="sh-btn" type="button" disabled={busy} onClick={() => { setEditing("new"); setName(""); }}>New {label}</button>}
    </div>
    <div className="sh-card__body" style={{ display: "grid", gap: 12 }}>
      <p className="sh-muted" style={{ margin: 0 }}>{isEnv ? "Isolate credentials and telemetry by environment. Use the header to change active scope." : kind === "general" ? "Name and identity of the selected project. Manage project creation and archival in Administration." : "Create, rename and archive projects across this instance."}</p>
      {loading ? <EmptyHint icon="activity" title="Loading projects…" sub="Reading this instance." /> : rows.map((row) => <div className="sh-row" key={row.id} style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto" }}>
        <div><strong>{row.name}</strong><div className="sh-faint sh-mono" style={{ fontSize: 11, overflowWrap: "anywhere" }}>{row.id}</div></div>
        <button className="sh-btn ghost" type="button" disabled={busy} aria-label={`Rename ${row.name}`} onClick={() => { setEditing(row.id); setName(row.name); }}>Rename</button>
        {kind !== "general" && <ConfirmButton label="Archive" confirmLabel="Confirm" ariaLabel={`Archive ${row.name}`} confirmAriaLabel={`Confirm archive ${row.name}`} onConfirm={() => void mutate(() => isEnv ? ctx.client.archiveEnvironment(row.id) : ctx.onArchiveProject(row.id))} />}
      </div>)}
      {!loading && !error && rows.length === 0 && <p className="sh-muted">No {isEnv ? "environments" : "projects"} yet. Create one to start collecting telemetry.</p>}
      {error && <div role="alert">{error}{kind === "projects" && !editing && <button className="sh-btn" type="button" onClick={() => setTick((value) => value + 1)}>Retry projects</button>}</div>}
      {editing && <form style={{ display: "flex", gap: 8, flexWrap: "wrap" }} onSubmit={(event) => { event.preventDefault(); save(); }}>
        <input autoFocus className="sh-input" aria-label={editing === "new" ? `New ${label} name` : `Rename ${label}`} value={name} onChange={(event) => setName(event.target.value)} />
        <button className="sh-btn primary" type="submit" disabled={busy || !name.trim()}>{editing === "new" ? "Create" : "Save name"}</button>
        <button className="sh-btn ghost" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
      </form>}
    </div>
  </section>;
}

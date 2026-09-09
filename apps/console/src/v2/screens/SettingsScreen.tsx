import { useState } from "react";
import { Icon, PageHead } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { ProjectSettingsSection } from "./settings/ProjectSettingsSection";
import { ManagementSection } from "./settings/ManagementSections";
import { CodeHostingSection } from "./settings/CodeHostingSection";
import { ArtifactsSection } from "./ArtifactsSection";
import { FeedbackSection } from "./FeedbackSection";
import { ReadTokensSection } from "./ReadTokensSection";
import "./settings/settings-screen.css";

const TASKS = ["General", "Environments", "Credentials & origins", "Integrations", "Data & retention"] as const;
type Task = typeof TASKS[number];
export function SettingsScreen({ ctx }: { ctx: ScreenCtx }) {
  const [task, setTask] = useState<Task>("General");
  const [visited, setVisited] = useState<Task[]>(["General"]);
  function selectTask(next: Task) {
    setVisited((current) => current.includes(next) ? current : [...current, next]);
    setTask(next);
  }
  return <>
    <PageHead title="Project settings" sub={ctx.project ? `Ongoing configuration for ${ctx.project.name}.` : "Select or create a project to configure it."} />
    {!ctx.project ? <button className="sh-btn primary" type="button" onClick={() => ctx.navigate("administration")}>Manage projects</button> : <div className="sh-settings-layout">
      <nav className="sh-settings-tasks" aria-label="Project configuration">
        {TASKS.map((item) => <button key={item} className={`sh-btn ${task === item ? "primary" : "ghost"}`} type="button" aria-current={task === item ? "page" : undefined} onClick={() => selectTask(item)}>{item}</button>)}
        <button className="sh-btn ghost" type="button" onClick={() => ctx.navigate("installation")}>Installation & SDK <Icon name="arrow" size={13} /></button>
      </nav>
      <div className="sh-settings-content">
        {/* Lazily mount task forms once; preserve their drafts while changing tasks. */}
        {visited.map((panel) => <div key={panel} hidden={task !== panel}>
        <div style={{ display: "grid", gap: 16 }}>
        {panel === "General" && <ManagementSection ctx={ctx} kind="general" />}
        {panel === "Environments" && <ManagementSection ctx={ctx} kind="environments" />}
        {panel !== "General" && panel !== "Environments" && !ctx.environment ? <div className="sh-card sh-card__body">Create or select an environment to configure {panel.toLowerCase()}.</div> : null}
        {ctx.environment && panel === "Credentials & origins" && <><ProjectSettingsSection ctx={ctx} tabs={["API keys", "Browser origins"]} /><ReadTokensSection ctx={ctx} /></>}
        {ctx.environment && panel === "Integrations" && <><CodeHostingSection ctx={ctx} /><ProjectSettingsSection ctx={ctx} tabs={["Releases & code"]} /><ArtifactsSection ctx={ctx} /><FeedbackSection ctx={ctx} view="configuration" /></>}
        {ctx.environment && panel === "Data & retention" && <ProjectSettingsSection ctx={ctx} tabs={["Data governance", "Warehouse sync"]} />}
        </div>
        </div>)}
      </div>
    </div>}
  </>;
}

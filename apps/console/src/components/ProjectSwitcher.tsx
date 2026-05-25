import { type FormEvent, useState } from "react";
import type { Project } from "../api/types";

type Props = {
  projects: Project[];
  activeProjectId?: string;
  disabled: boolean;
  onSelect: (project: Project) => void;
  onCreate: (name: string) => Promise<void>;
};

export function ProjectSwitcher({ projects, activeProjectId, disabled, onSelect, onCreate }: Props) {
  const [name, setName] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || disabled) return;

    await onCreate(trimmed);
    setName("");
  }

  return (
    <section className="project-sidebar" aria-label="Projects">
      <div className="section-label">Projects</div>
      <div className="project-list">
        {projects.map((project) => (
          <button
            aria-current={project.id === activeProjectId ? "page" : undefined}
            className={project.id === activeProjectId ? "nav-item active" : "nav-item"}
            key={project.id}
            onClick={() => onSelect(project)}
            type="button"
          >
            {project.name}
          </button>
        ))}
      </div>
      <form className="compact-form" onSubmit={submit}>
        <label>
          New project name
          <input disabled={disabled} onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <button disabled={disabled} type="submit">
          Create project
        </button>
      </form>
    </section>
  );
}

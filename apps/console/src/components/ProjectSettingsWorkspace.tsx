import { type FormEvent, useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Environment, Project } from "../api/types";
import { ApiKeyPanel } from "./ApiKeyPanel";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { ProjectOnboardingChecklist } from "./ProjectOnboardingChecklist";
import { SettingsSectionNav, type SettingsSection } from "./SettingsSectionNav";
import { SnippetPanel } from "./SnippetPanel";
import { EmptyState } from "./ui/EmptyState";
import { UserAdminPanel } from "./UserAdminPanel";

type Props = {
  client: ApiClient;
  activeEnvironment?: Environment;
  activeProject?: Project;
  activeProjectId?: string;
  apiEndpoint?: string;
  browserCorsOrigins?: string[];
  environments: Environment[];
  isEnvironmentCreationDisabled: boolean;
  latestSecret?: string;
  onArchiveEnvironment?: (environment: Environment) => Promise<void>;
  onCreateEnvironment: (name: string) => Promise<void>;
  onArchiveProject: (projectId: string) => Promise<void>;
  onSecretCreated: (secret: string) => void;
  onSelectEnvironment: (environment: Environment) => void;
  onUpdateProject: (projectId: string, input: { name?: string }) => Promise<void>;
  onUpdateEnvironment?: (environment: Environment, name: string) => Promise<void>;
};

const sections = [
  {
    id: "project",
    label: "Project",
    description: "Rename or archive the selected monitored product."
  },
  {
    id: "environments",
    label: "Environments",
    description: "Create and select deployment environments for this project."
  },
  {
    id: "api-keys",
    label: "API keys",
    description: "Issue scoped ingest keys for server and browser clients."
  },
  {
    id: "browser-origins",
    label: "Browser origins",
    description: "Review allowed browser origins for client-side ingestion."
  },
  {
    id: "sdk-snippets",
    label: "SDK snippets",
    description: "Copy install snippets for the active project and environment."
  },
  {
    id: "source-maps",
    label: "Source maps",
    description: "Upload source maps and manage upload tokens."
  },
  {
    id: "console-users",
    label: "Console users",
    description: "Installation-level console access."
  }
] satisfies SettingsSection[];

type SectionId = (typeof sections)[number]["id"];

export function ProjectSettingsWorkspace({
  activeEnvironment,
  activeProject,
  activeProjectId,
  apiEndpoint,
  browserCorsOrigins = [],
  client,
  environments,
  isEnvironmentCreationDisabled,
  latestSecret,
  onArchiveEnvironment,
  onCreateEnvironment,
  onArchiveProject,
  onSecretCreated,
  onSelectEnvironment,
  onUpdateProject,
  onUpdateEnvironment
}: Props) {
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("project");
  const activeEnvironmentId = activeEnvironment?.id;

  function renderSection() {
    if (!activeProjectId) {
      return (
        <EmptyState
          description="Create or select a project before changing project settings."
          title="No project selected"
        />
      );
    }

    switch (activeSectionId) {
      case "project":
        return activeProject ? (
          <ProjectManagementPanel
            onArchiveProject={onArchiveProject}
            onUpdateProject={onUpdateProject}
            project={activeProject}
          />
        ) : (
          <EmptyState
            description="Select a project before changing project settings."
            title="No project selected"
          />
        );
      case "api-keys":
        return (
          <ApiKeyPanel
            client={client}
            environmentId={activeEnvironmentId}
            onSecretCreated={onSecretCreated}
            projectId={activeProjectId}
          />
        );
      case "browser-origins":
        return (
          <section className="panel browser-origins-panel">
            <div className="panel-header">
              <h2>Browser origins</h2>
            </div>
            <p>Browser origins must include protocol, for example https://app.example.com.</p>
            {browserCorsOrigins.length > 0 ? (
              <ul className="origin-list" aria-label="Configured browser origins">
                {browserCorsOrigins.map((origin) => (
                  <li key={origin}>
                    <code>{origin}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-text">No browser origins are configured for cross-origin browser ingestion.</p>
            )}
            <p className="muted-text">
              BROWSER_CORS_ORIGINS is currently configured globally, so browser origin changes apply across the console instead of this
              selected project or environment. Per-project origin CRUD will be added later.
            </p>
          </section>
        );
      case "sdk-snippets":
        return (
          <SnippetPanel
            apiEndpoint={apiEndpoint}
            environmentId={activeEnvironmentId}
            latestSecret={latestSecret}
            projectId={activeProjectId}
          />
        );
      case "source-maps":
        return <ArtifactsPanel client={client} environmentId={activeEnvironmentId} projectId={activeProjectId} />;
      case "console-users":
        return (
          <>
            <p className="muted-text">Console users are installation-level accounts, not project-scoped members.</p>
            <UserAdminPanel client={client} />
          </>
        );
      case "environments":
      default:
        return (
          <EnvironmentSelector
            activeEnvironmentId={activeEnvironmentId}
            disabled={isEnvironmentCreationDisabled}
            environments={environments}
            onArchive={onArchiveEnvironment}
            onCreate={onCreateEnvironment}
            onSelect={onSelectEnvironment}
            onUpdate={onUpdateEnvironment}
          />
        );
    }
  }

  return (
    <section className="settings-workspace project-settings-workspace">
      <header className="settings-workspace__header">
        <h1>Project Settings</h1>
        <p>Recurring configuration for the selected project and environment.</p>
      </header>
      {activeProjectId ? (
        <ProjectOnboardingChecklist
          activeEnvironment={activeEnvironment}
          activeProjectId={activeProjectId}
          apiEndpoint={apiEndpoint}
          latestSecret={latestSecret}
        />
      ) : null}
      <div className="settings-workspace__body">
        <SettingsSectionNav
          activeSectionId={activeSectionId}
          ariaLabel="Project settings sections"
          onSelectSection={(sectionId) => setActiveSectionId(sectionId as SectionId)}
          sections={sections}
        />
        <div className="settings-workspace__content">{renderSection()}</div>
      </div>
    </section>
  );
}

function ProjectManagementPanel({
  onArchiveProject,
  onUpdateProject,
  project
}: {
  onArchiveProject: (projectId: string) => Promise<void>;
  onUpdateProject: (projectId: string, input: { name?: string }) => Promise<void>;
  project: Project;
}) {
  const [name, setName] = useState(project.name);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  useEffect(() => {
    setName(project.name);
  }, [project.name]);

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name || isSaving) return;

    setIsSaving(true);
    try {
      await onUpdateProject(project.id, { name: trimmed });
    } finally {
      setIsSaving(false);
    }
  }

  async function archiveProject() {
    if (isArchiving) return;
    if (!window.confirm(`Archive project ${project.name}? This hides it from the project switcher.`)) return;

    setIsArchiving(true);
    try {
      await onArchiveProject(project.id);
    } finally {
      setIsArchiving(false);
    }
  }

  return (
    <section className="panel project-management-panel">
      <div className="panel-header">
        <div>
          <h2>Project</h2>
          <p className="muted-text">Project settings apply to every environment, key, monitor, and artifact inside this project.</p>
        </div>
      </div>
      <form className="inline-form" onSubmit={saveProject}>
        <label>
          Project name
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <button disabled={!name.trim() || name.trim() === project.name || isSaving} type="submit">
          {isSaving ? "Saving" : "Save project"}
        </button>
      </form>
      <div className="danger-zone">
        <div>
          <h3>Archive project</h3>
          <p className="muted-text">Archived projects are hidden from the switcher. Existing telemetry remains stored until retention removes it.</p>
        </div>
        <button aria-label={`Archive ${project.name}`} disabled={isArchiving} onClick={() => void archiveProject()} type="button">
          {isArchiving ? "Archiving" : "Archive project"}
        </button>
      </div>
    </section>
  );
}

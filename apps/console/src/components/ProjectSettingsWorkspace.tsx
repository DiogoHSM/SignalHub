import { useState } from "react";
import type { ApiClient } from "../api/client";
import type { Environment } from "../api/types";
import { ApiKeyPanel } from "./ApiKeyPanel";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { SettingsSectionNav, type SettingsSection } from "./SettingsSectionNav";
import { SnippetPanel } from "./SnippetPanel";
import { EmptyState } from "./ui/EmptyState";
import { UserAdminPanel } from "./UserAdminPanel";

type Props = {
  client: ApiClient;
  activeEnvironment?: Environment;
  activeProjectId?: string;
  apiEndpoint?: string;
  environments: Environment[];
  isEnvironmentCreationDisabled: boolean;
  latestSecret?: string;
  onCreateEnvironment: (name: string) => Promise<void>;
  onSecretCreated: (secret: string) => void;
  onSelectEnvironment: (environment: Environment) => void;
};

const sections = [
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
  activeProjectId,
  apiEndpoint,
  client,
  environments,
  isEnvironmentCreationDisabled,
  latestSecret,
  onCreateEnvironment,
  onSecretCreated,
  onSelectEnvironment
}: Props) {
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("environments");
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
            onCreate={onCreateEnvironment}
            onSelect={onSelectEnvironment}
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

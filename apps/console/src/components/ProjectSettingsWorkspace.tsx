import { type FormEvent, useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { BrowserOrigin, Environment } from "../api/types";
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

function BrowserOriginsPanel({ client, projectId }: { client: ApiClient; projectId: string }) {
  const [origins, setOrigins] = useState<BrowserOrigin[]>([]);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [archivingId, setArchivingId] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    if (!client.listBrowserOrigins) {
      setError("Browser origin management is unavailable.");
      return () => {
        cancelled = true;
      };
    }

    void client
      .listBrowserOrigins(projectId)
      .then(({ origins }) => {
        if (cancelled) return;
        setOrigins(origins);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load browser origins.");
      });

    return () => {
      cancelled = true;
    };
  }, [client, projectId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedOrigin = origin.trim();
    if (!trimmedOrigin || isSubmitting) return;
    if (!client.createBrowserOrigin) {
      setError("Browser origin management is unavailable.");
      return;
    }

    setError(undefined);
    setIsSubmitting(true);

    try {
      const response = await client.createBrowserOrigin(projectId, { origin: trimmedOrigin });
      setOrigins((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== response.origin.id && item.origin !== response.origin.origin);
        return [...withoutDuplicate, response.origin];
      });
      setOrigin("");
    } catch {
      setError("Could not add browser origin.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function archiveOrigin(item: BrowserOrigin) {
    const confirmed = window.confirm(`Archive browser origin ${item.origin}?`);
    if (!confirmed) return;
    if (!client.archiveBrowserOrigin) {
      setError("Browser origin management is unavailable.");
      return;
    }

    setError(undefined);
    setArchivingId(item.id);

    try {
      await client.archiveBrowserOrigin(item.id);
      setOrigins((current) => current.filter((originItem) => originItem.id !== item.id));
    } catch {
      setError("Could not archive browser origin.");
    } finally {
      setArchivingId(undefined);
    }
  }

  return (
    <section className="panel browser-origins-panel">
      <div className="panel-header">
        <h2>Browser origins</h2>
      </div>
      <p>Browser origins must include protocol, for example https://app.example.com.</p>
      <p className="muted-text">
        These origins are allowed to send browser SDK telemetry directly to Sigmon ingestion endpoints for this project.
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      {origins.length === 0 ? (
        <p className="muted-text">No browser origins configured for this project.</p>
      ) : (
        <ul className="key-list">
          {origins.map((item) => (
            <li className="key-list-item" key={item.id}>
              <div>
                <strong>{item.origin}</strong>
                <span>Created {new Date(item.createdAt).toLocaleString()}</span>
              </div>
              <div className="key-list-item__actions">
                <button
                  aria-label={`Archive ${item.origin}`}
                  className="button-danger"
                  disabled={archivingId === item.id}
                  onClick={() => void archiveOrigin(item)}
                  type="button"
                >
                  Archive
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="compact-form" onSubmit={submit}>
        <label>
          Allowed browser origin
          <input
            onChange={(event) => setOrigin(event.target.value)}
            placeholder="https://app.example.com"
            type="url"
            value={origin}
          />
        </label>
        <button disabled={isSubmitting} type="submit">
          Add origin
        </button>
      </form>
    </section>
  );
}

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
        return <BrowserOriginsPanel client={client} projectId={activeProjectId} />;
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

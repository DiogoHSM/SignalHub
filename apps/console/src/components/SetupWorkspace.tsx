import type { ApiClient } from "../api/client";
import type { Environment } from "../api/types";
import { ApiKeyPanel } from "./ApiKeyPanel";
import { ConnectionCheck } from "./ConnectionCheck";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { SnippetPanel } from "./SnippetPanel";
import { UserAdminPanel } from "./UserAdminPanel";

type Props = {
  client: ApiClient;
  activeEnvironment?: Environment;
  environments: Environment[];
  isEnvironmentCreationDisabled: boolean;
  onCreateEnvironment: (name: string) => Promise<void>;
  onSelectEnvironment: (environment: Environment) => void;
  onSecretCreated: (secret: string) => void;
  activeProjectId?: string;
  apiEndpoint?: string;
  latestSecret?: string;
};

export function SetupWorkspace({
  client,
  activeEnvironment,
  environments,
  isEnvironmentCreationDisabled,
  onCreateEnvironment,
  onSelectEnvironment,
  onSecretCreated,
  activeProjectId,
  apiEndpoint,
  latestSecret
}: Props) {
  return (
    <>
      <div className="workspace-grid">
        <EnvironmentSelector
          activeEnvironmentId={activeEnvironment?.id}
          disabled={isEnvironmentCreationDisabled}
          environments={environments}
          onCreate={onCreateEnvironment}
          onSelect={onSelectEnvironment}
        />
        <ApiKeyPanel
          client={client}
          environmentId={activeEnvironment?.id}
          onSecretCreated={onSecretCreated}
          projectId={activeProjectId}
        />
        <SnippetPanel
          apiEndpoint={apiEndpoint}
          environmentId={activeEnvironment?.id}
          latestSecret={latestSecret}
          projectId={activeProjectId}
        />
      </div>
      <div className="workspace-grid">
        <ConnectionCheck client={client} environmentId={activeEnvironment?.id} projectId={activeProjectId} />
        <UserAdminPanel client={client} />
      </div>
    </>
  );
}

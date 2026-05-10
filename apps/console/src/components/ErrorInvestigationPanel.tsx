import { useState } from "react";
import type { ApiClient } from "../api/client";
import { ErrorGroupsPanel } from "./ErrorGroupsPanel";
import type { ErrorFilterValues } from "./ErrorFilters";
import { ErrorRawOccurrencesPanel } from "./ErrorRawOccurrencesPanel";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
  initialFilters?: Partial<ErrorFilterValues>;
};

type ErrorTab = "groups" | "raw";

export function ErrorInvestigationPanel({ client, projectId, environmentId, initialFilters }: Props) {
  const [activeTab, setActiveTab] = useState<ErrorTab>("groups");

  return (
    <div className="error-investigation-shell">
      <div className="investigation-tabs" role="group" aria-label="Error investigation views">
        <button aria-pressed={activeTab === "groups"} onClick={() => setActiveTab("groups")} type="button">
          Groups
        </button>
        <button aria-pressed={activeTab === "raw"} onClick={() => setActiveTab("raw")} type="button">
          Raw occurrences
        </button>
      </div>
      {activeTab === "groups" ? (
        <ErrorGroupsPanel client={client} environmentId={environmentId} initialFilters={initialFilters} projectId={projectId} />
      ) : (
        <ErrorRawOccurrencesPanel
          client={client}
          environmentId={environmentId}
          initialFilters={initialFilters}
          projectId={projectId}
        />
      )}
    </div>
  );
}

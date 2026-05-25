import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import { ErrorGroupsPanel } from "./ErrorGroupsPanel";
import type { ErrorFilterValues } from "./ErrorFilters";
import { ErrorRawOccurrencesPanel } from "./ErrorRawOccurrencesPanel";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
  initialTab?: ErrorTab;
  initialFilters?: Partial<ErrorFilterValues>;
  onOpenIncident?: (groupId: string, options?: { errorId?: string }) => void;
};

type ErrorTab = "groups" | "raw";

export function ErrorInvestigationPanel({ client, projectId, environmentId, initialTab, initialFilters, onOpenIncident }: Props) {
  const initialFilterKey = JSON.stringify(initialFilters ?? {});
  const [activeTab, setActiveTab] = useState<ErrorTab>(initialTab ?? "groups");
  const [rawInitialFilters, setRawInitialFilters] = useState<Partial<ErrorFilterValues>>(initialFilters ?? {});

  useEffect(() => {
    setRawInitialFilters(initialFilters ?? {});
  }, [initialFilterKey]);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  function showRawOccurrences(errorGroupId: string) {
    setRawInitialFilters({ errorGroupId });
    setActiveTab("raw");
  }

  return (
    <div className="error-investigation-shell">
      <div className="investigation-tabs" role="tablist" aria-label="Error investigation views">
        <button
          aria-controls="error-groups-panel"
          aria-selected={activeTab === "groups"}
          id="error-groups-tab"
          onClick={() => setActiveTab("groups")}
          role="tab"
          type="button"
        >
          Groups
        </button>
        <button
          aria-controls="error-raw-panel"
          aria-selected={activeTab === "raw"}
          id="error-raw-tab"
          onClick={() => setActiveTab("raw")}
          role="tab"
          type="button"
        >
          Raw occurrences
        </button>
      </div>
      {activeTab === "groups" ? (
        <div aria-labelledby="error-groups-tab" id="error-groups-panel" role="tabpanel">
          <ErrorGroupsPanel
            client={client}
            environmentId={environmentId}
            initialFilters={initialFilters}
            onOpenIncident={onOpenIncident}
            onShowOccurrences={showRawOccurrences}
            projectId={projectId}
          />
        </div>
      ) : (
        <div aria-labelledby="error-raw-tab" id="error-raw-panel" role="tabpanel">
          <ErrorRawOccurrencesPanel
            client={client}
            environmentId={environmentId}
            initialFilters={rawInitialFilters}
            onOpenIncident={onOpenIncident}
            projectId={projectId}
          />
        </div>
      )}
    </div>
  );
}

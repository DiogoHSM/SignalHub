import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorGroupIncident, ErrorGroupStatus } from "../api/types";
import { IncidentSummary } from "./IncidentSummary";
import { IncidentTechnicalPanel } from "./IncidentTechnicalPanel";
import { IncidentTimeline } from "./IncidentTimeline";
import { IncidentTriagePanel } from "./IncidentTriagePanel";

type LoadState =
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; incident: ErrorGroupIncident }
  | { status: "unavailable"; key: string };

type Props = {
  client: ApiClient;
  groupId: string;
  projectId: string;
  environmentId: string;
  errorId?: string;
  onBack: () => void;
};

export function IncidentView({ client, groupId, projectId, environmentId, errorId, onBack }: Props) {
  const incidentKey = `${projectId}:${environmentId}:${groupId}:${errorId ?? ""}`;
  const [state, setState] = useState<LoadState>({ status: "loading", key: incidentKey });
  const [quickActionState, setQuickActionState] = useState<{ isSaving: boolean; error: string | null }>({
    isSaving: false,
    error: null
  });
  const isCurrentState = state.key === incidentKey;
  const readyIncident = state.status === "ready" && isCurrentState ? state.incident : null;
  const incidentPath = `/console/incidents/error-groups/${encodeURIComponent(groupId)}?project_id=${encodeURIComponent(projectId)}&environment_id=${encodeURIComponent(environmentId)}${errorId ? `&error_id=${encodeURIComponent(errorId)}` : ""}`;
  const shareUrl =
    typeof window === "undefined" ? incidentPath : new URL(incidentPath, window.location.origin).toString();

  useEffect(() => {
    let cancelled = false;
    const requestKey = `${projectId}:${environmentId}:${groupId}:${errorId ?? ""}`;
    setState({ status: "loading", key: requestKey });
    setQuickActionState({ isSaving: false, error: null });
    void client
      .getErrorGroupIncident(groupId, { projectId, environmentId, errorId })
      .then(
        ({ data }) => {
          if (!cancelled) setState({ status: "ready", key: requestKey, incident: data });
        },
        () => {
          if (!cancelled) setState({ status: "unavailable", key: requestKey });
        }
      );
    return () => {
      cancelled = true;
    };
  }, [client, environmentId, errorId, groupId, projectId]);

  function updateReadyIncident(incident: ErrorGroupIncident) {
    setState((current) => (current.key === incidentKey ? { status: "ready", key: incidentKey, incident } : current));
  }

  async function quickUpdateStatus(status: ErrorGroupStatus) {
    if (!readyIncident) return;
    setQuickActionState({ isSaving: true, error: null });
    try {
      const { data } = await client.updateErrorGroupTriage(readyIncident.group.id, {
        projectId,
        environmentId,
        status,
        priority: readyIncident.group.priority ?? null
      });
      updateReadyIncident({ ...readyIncident, group: data, priority: data.priority });
      setQuickActionState({ isSaving: false, error: null });
    } catch {
      setQuickActionState({ isSaving: false, error: "Incident action failed." });
    }
  }

  return (
    <section className="incident-view">
      <header className="incident-header">
        <button onClick={onBack} type="button">
          Back to errors
        </button>
        {state.status === "loading" || !isCurrentState || (state.status === "unavailable" && isCurrentState) ? (
          <div>
            {state.status === "loading" || !isCurrentState ? <p className="muted-text">Loading incident</p> : null}
            {state.status === "unavailable" && isCurrentState ? <p className="muted-text">Incident unavailable</p> : null}
          </div>
        ) : null}
      </header>
      {readyIncident ? (
        <>
          <IncidentSummary
            incident={readyIncident}
            isQuickActionSaving={quickActionState.isSaving}
            onIgnore={() => void quickUpdateStatus("ignored")}
            onResolve={() => void quickUpdateStatus("resolved")}
            quickActionError={quickActionState.error}
            shareUrl={shareUrl}
          />
          <div className="incident-split">
            <IncidentTechnicalPanel incident={readyIncident} />
            <div className="incident-column" role="region" aria-label="Operational context">
              <IncidentTriagePanel
                client={client}
                environmentId={environmentId}
                incident={readyIncident}
                onUpdated={updateReadyIncident}
                projectId={projectId}
              />
              <IncidentTimeline incident={readyIncident} />
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorGroupIncident } from "../api/types";
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
  const isCurrentState = state.key === incidentKey;
  const readyIncident = state.status === "ready" && isCurrentState ? state.incident : null;

  useEffect(() => {
    let cancelled = false;
    const requestKey = `${projectId}:${environmentId}:${groupId}:${errorId ?? ""}`;
    setState({ status: "loading", key: requestKey });
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

  return (
    <section className="incident-view">
      <header className="incident-header">
        <button onClick={onBack} type="button">
          Back to errors
        </button>
        <div>
          <p className="eyebrow">Incident</p>
          {readyIncident ? <h2>{readyIncident.group.message}</h2> : null}
          {state.status === "loading" || !isCurrentState ? <p className="muted-text">Loading incident</p> : null}
          {state.status === "unavailable" && isCurrentState ? <p className="muted-text">Incident unavailable</p> : null}
        </div>
      </header>
      {readyIncident ? (
        <>
          <IncidentSummary incident={readyIncident} />
          <div className="incident-split">
            <IncidentTechnicalPanel incident={readyIncident} />
            <div className="incident-column" role="region" aria-label="Operational context">
              <IncidentTriagePanel
                client={client}
                environmentId={environmentId}
                incident={readyIncident}
                onUpdated={(incident) =>
                  setState((current) =>
                    current.key === incidentKey ? { status: "ready", key: incidentKey, incident } : current
                  )
                }
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

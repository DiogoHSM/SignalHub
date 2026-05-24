import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorGroupIncident } from "../api/types";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; incident: ErrorGroupIncident }
  | { status: "unavailable" };

type Props = {
  client: ApiClient;
  groupId: string;
  projectId: string;
  environmentId: string;
  errorId?: string;
  onBack: () => void;
};

export function IncidentView({ client, groupId, projectId, environmentId, errorId, onBack }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void client
      .getErrorGroupIncident(groupId, { projectId, environmentId, errorId })
      .then(
        ({ data }) => {
          if (!cancelled) setState({ status: "ready", incident: data });
        },
        () => {
          if (!cancelled) setState({ status: "unavailable" });
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
          {state.status === "ready" ? <h2>{state.incident.group.message}</h2> : null}
          {state.status === "loading" ? <p className="muted-text">Loading incident</p> : null}
          {state.status === "unavailable" ? <p className="muted-text">Incident unavailable</p> : null}
        </div>
      </header>
    </section>
  );
}

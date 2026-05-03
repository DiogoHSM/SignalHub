import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};

type ConnectionState = "idle" | "loading" | "received" | "empty" | "unavailable";

const labels: Record<ConnectionState, string> = {
  idle: "Select an environment",
  loading: "Checking connection",
  received: "Telemetry received",
  empty: "No telemetry yet",
  unavailable: "Connection check unavailable"
};

export function ConnectionCheck({ client, projectId, environmentId }: Props) {
  const [state, setState] = useState<ConnectionState>("idle");

  useEffect(() => {
    let cancelled = false;

    if (!projectId || !environmentId) {
      setState("idle");
      return () => {
        cancelled = true;
      };
    }

    setState("loading");

    void Promise.all([
      client.listEvents({ projectId, environmentId }),
      client.listErrors({ projectId, environmentId })
    ])
      .then(([events, errors]) => {
        if (cancelled) return;
        setState(events.data.length > 0 || errors.data.length > 0 ? "received" : "empty");
      })
      .catch(() => {
        if (cancelled) return;
        setState("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [client, projectId, environmentId]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Connection check</h2>
      </div>
      <div className={`status-box ${state}`} role="status">
        <strong>{labels[state]}</strong>
      </div>
    </section>
  );
}

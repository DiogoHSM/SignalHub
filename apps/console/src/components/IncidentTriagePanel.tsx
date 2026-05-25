import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorGroupIncident, ErrorGroupPriority, ErrorGroupStatus } from "../api/types";

type Props = {
  client: ApiClient;
  environmentId: string;
  incident: ErrorGroupIncident;
  onUpdated: (incident: ErrorGroupIncident) => void;
  projectId: string;
};

const statuses: ErrorGroupStatus[] = ["open", "investigating", "resolved", "ignored"];
const priorities: ErrorGroupPriority[] = ["urgent", "high", "normal", "low"];

export function IncidentTriagePanel({ client, environmentId, incident, onUpdated, projectId }: Props) {
  const [status, setStatus] = useState<ErrorGroupStatus>(incident.group.status);
  const [priority, setPriority] = useState<ErrorGroupPriority | "">(incident.group.priority ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus(incident.group.status);
    setPriority(incident.group.priority ?? "");
    setError(null);
    setIsSaving(false);
  }, [incident.group.id, incident.group.priority, incident.group.status]);

  async function saveTriage() {
    setIsSaving(true);
    setError(null);
    try {
      const { data } = await client.updateErrorGroupTriage(incident.group.id, {
        projectId,
        environmentId,
        status,
        priority: priority || null
      });
      onUpdated({ ...incident, group: data, priority: data.priority });
    } catch {
      setError("Triage update failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="incident-triage-panel" aria-label="Incident triage">
      <h3>Triage</h3>
      <label>
        Status
        <select value={status} onChange={(event) => setStatus(event.target.value as ErrorGroupStatus)}>
          {statuses.map((statusOption) => (
            <option key={statusOption} value={statusOption}>
              {statusOption}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select value={priority} onChange={(event) => setPriority(event.target.value as ErrorGroupPriority | "")}>
          <option value="">No priority</option>
          {priorities.map((priorityOption) => (
            <option key={priorityOption} value={priorityOption}>
              {priorityOption}
            </option>
          ))}
        </select>
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={isSaving} onClick={saveTriage} type="button">
        {isSaving ? "Saving triage" : "Save triage"}
      </button>
    </section>
  );
}

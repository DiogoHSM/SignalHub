import type { ErrorGroupIncident } from "../api/types";
import { PriorityBadge } from "./PriorityBadge";

function formatTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "none";
}

export function IncidentSummary({ incident }: { incident: ErrorGroupIncident }) {
  const group = incident.group;
  return (
    <section className="incident-summary" aria-label="Incident summary">
      <div>
        <span className={`badge severity-${group.severity}`}>{group.severity}</span>
        <span className={`badge status-${group.status}`}>{group.status}</span>
        <PriorityBadge priority={group.priority} suggested={incident.suggestedPriority} />
      </div>
      <div className="incident-summary-grid">
        <span>{group.occurrenceCount} occurrences</span>
        <span>{group.affectedUsersCount} users</span>
        <span>{group.affectedTenantsCount} tenants</span>
        <span>First seen {formatTime(group.firstSeenAt)}</span>
        <span>Last seen {formatTime(group.lastSeenAt)}</span>
        <span>Release {group.latestRelease ?? "none"}</span>
      </div>
    </section>
  );
}

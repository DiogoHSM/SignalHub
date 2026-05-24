import type { ErrorGroupRecord } from "../api/types";
import { PriorityBadge } from "./PriorityBadge";

type Props = {
  groups: ErrorGroupRecord[];
  selectedGroupId?: string;
  onSelect: (group: ErrorGroupRecord) => void;
  onOpenIncident?: (groupId: string, options?: { errorId?: string }) => void;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function label(value: string | null | undefined): string {
  return value ?? "none";
}

export function ErrorGroupList({ groups, selectedGroupId, onOpenIncident, onSelect }: Props) {
  return (
    <div className="event-list" aria-label="Error groups">
      {groups.map((group) => (
        <div
          className="event-row error-group-row"
          data-selected={group.id === selectedGroupId ? "true" : undefined}
          key={group.id}
        >
          <button
            aria-pressed={group.id === selectedGroupId}
            className="event-row-select"
            onClick={() => onSelect(group)}
            type="button"
          >
            <strong>{group.message}</strong>
            <code>{group.id}</code>
            <span className={`badge severity-${group.severity}`}>{group.severity}</span>
            <span className={`badge status-${group.status}`}>{group.status}</span>
            <PriorityBadge priority={group.priority} />
            <span>{group.occurrenceCount} occurrences</span>
            <span>{group.affectedUsersCount} users</span>
            <span>{group.affectedTenantsCount} tenants</span>
            <span>{formatTimestamp(group.lastSeenAt)}</span>
            <span>{label(group.latestRelease)}</span>
          </button>
          {onOpenIncident ? (
            <button className="event-row-action" onClick={() => onOpenIncident(group.id)} type="button">
              Open incident
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  );
}

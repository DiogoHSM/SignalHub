import type { ErrorGroupRecord } from "../api/types";

type Props = {
  groups: ErrorGroupRecord[];
  selectedGroupId?: string;
  onSelect: (group: ErrorGroupRecord) => void;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function label(value: string | null | undefined): string {
  return value ?? "none";
}

export function ErrorGroupList({ groups, selectedGroupId, onSelect }: Props) {
  return (
    <div className="event-list" aria-label="Error groups">
      {groups.map((group) => (
        <button
          aria-pressed={group.id === selectedGroupId}
          className="event-row error-group-row"
          key={group.id}
          onClick={() => onSelect(group)}
          type="button"
        >
          <span>
            <strong>{group.message}</strong>
            <code>{group.id}</code>
          </span>
          <span>{group.severity}</span>
          <span>{group.status}</span>
          <span>{group.occurrenceCount} occurrences</span>
          <span>{group.affectedUsersCount} users</span>
          <span>{group.affectedTenantsCount} tenants</span>
          <span>{formatTimestamp(group.lastSeenAt)}</span>
          <span>{label(group.latestRelease)}</span>
        </button>
      ))}
    </div>
  );
}

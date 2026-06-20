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
    <div className="incident-queue-table-shell">
      <table className="incident-queue-table" aria-label="Grouped error incident queue">
        <thead>
          <tr>
            <th scope="col">Issue</th>
            <th scope="col">Severity</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Events</th>
            <th scope="col">Users</th>
            <th scope="col">Tenants</th>
            <th scope="col">Release</th>
            <th scope="col">Last seen</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr
              className="incident-queue-table__row"
              data-selected={group.id === selectedGroupId ? "true" : undefined}
              key={group.id}
            >
              <th scope="row">
                <button
                  aria-pressed={group.id === selectedGroupId}
                  className="incident-queue-table__issue"
                  onClick={() => onSelect(group)}
                  type="button"
                >
                  <strong>{group.message}</strong>
                  <code>{group.id}</code>
                </button>
              </th>
              <td>
                <span className={`badge severity-${group.severity}`}>{group.severity}</span>
              </td>
              <td>
                <span className={`badge status-${group.status}`}>{group.status}</span>
              </td>
              <td>
                <PriorityBadge priority={group.priority} />
              </td>
              <td className="numeric-cell">{group.occurrenceCount}</td>
              <td className="numeric-cell">{group.affectedUsersCount}</td>
              <td className="numeric-cell">{group.affectedTenantsCount}</td>
              <td>{label(group.latestRelease)}</td>
              <td>{formatTimestamp(group.lastSeenAt)}</td>
              <td>
                {onOpenIncident ? (
                  <button className="event-row-action" onClick={() => onOpenIncident(group.id)} type="button">
                    Open incident
                  </button>
                ) : (
                  <span className="muted-text">none</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { useMemo } from "react";
import type { UserSummary } from "../api/types";

export type UserSort = "impact" | "usage" | "errors" | "llmCost" | "recent";

type Props = {
  users: UserSummary[];
  selectedUserId?: string;
  sort: UserSort;
  onSortChange: (sort: UserSort) => void;
  onSelectUser: (user: UserSummary) => void;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

const sortOptions: Array<{ value: UserSort; label: string }> = [
  { value: "impact", label: "Impact" },
  { value: "usage", label: "Usage" },
  { value: "errors", label: "Errors" },
  { value: "llmCost", label: "LLM cost" },
  { value: "recent", label: "Recent" }
];

function userKey(user: UserSummary): string {
  return user.isAnonymous ? "_anonymous" : user.userId ?? "_anonymous";
}

function sortValue(user: UserSummary, sort: UserSort): number {
  if (sort === "impact") return user.impactScore;
  if (sort === "usage") return user.events;
  if (sort === "errors") return user.errors;
  if (sort === "llmCost") return Number(user.llmCostUsd);
  return user.lastSeenAt ? new Date(user.lastSeenAt).getTime() : 0;
}

function recentValue(user: UserSummary): number {
  return user.lastSeenAt ? new Date(user.lastSeenAt).getTime() : 0;
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "none";
}

export function UsersUserList({ users, selectedUserId, sort, onSortChange, onSelectUser, loading, error, onRetry }: Props) {
  const sortedUsers = useMemo(
    () =>
      [...users].sort((left, right) => {
        const byMetric = sortValue(right, sort) - sortValue(left, sort);
        if (byMetric !== 0) return byMetric;
        if (sort === "impact") {
          const byRecent = recentValue(right) - recentValue(left);
          if (byRecent !== 0) return byRecent;
          const byEvents = right.events - left.events;
          if (byEvents !== 0) return byEvents;
        }
        return left.label.localeCompare(right.label);
      }),
    [users, sort]
  );

  return (
    <div className="panel users-user-list">
      <div className="panel-header">
        <h2>Users</h2>
      </div>
      <div className="entity-sort-controls" aria-label="Sort users">
        {sortOptions.map((option) => (
          <button
            aria-pressed={sort === option.value}
            key={option.value}
            onClick={() => onSortChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      {loading ? <p className="muted-text">Loading user activity</p> : null}
      {error ? (
        <div className="status-box unavailable">
          <strong>User activity is unavailable.</strong>
          <button onClick={onRetry} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {!loading && !error && sortedUsers.length === 0 ? <p className="muted-text">No user activity in this window.</p> : null}
      {!loading && !error && sortedUsers.length > 0 ? (
        <div className="users-user-rows" aria-label="User activity">
          {sortedUsers.map((user) => {
            const key = userKey(user);
            const disabled = user.isAnonymous || !user.userId;
            return (
              <button
                aria-disabled={disabled ? "true" : undefined}
                aria-pressed={selectedUserId === key}
                className="user-row"
                disabled={disabled}
                key={key}
                onClick={() => {
                  if (!disabled) onSelectUser(user);
                }}
                type="button"
              >
                <span>
                  <strong>{user.label}</strong>
                  <code>{key}</code>
                </span>
                {Object.keys(user.keyTraits).length > 0 ? (
                  <span className="trait-chips">
                    {Object.entries(user.keyTraits).map(([key, value]) => (
                      <span className="trait-chip" key={key}>
                        {key}: {value}
                      </span>
                    ))}
                  </span>
                ) : null}
                <span>Impact {user.impactScore}</span>
                <span>Events {user.events}</span>
                <span>Errors {user.errors}</span>
                <span>Failed traces {user.failedTraces}</span>
                <span>LLM calls {user.llmCalls}</span>
                <span>LLM ${user.llmCostUsd}</span>
                <span>Active tenants {user.activeTenants}</span>
                <span>Active sessions {user.activeSessions}</span>
                <span>Last {formatTimestamp(user.lastSeenAt)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

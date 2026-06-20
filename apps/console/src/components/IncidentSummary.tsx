import type { ErrorGroupIncident } from "../api/types";
import { PriorityBadge } from "./PriorityBadge";
import { CopyButton } from "./ui/CopyButton";

function formatTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "none";
}

function formatObservedDuration(firstSeenAt: string | null | undefined, lastSeenAt: string | null | undefined): string {
  if (!firstSeenAt || !lastSeenAt) return "unknown";
  const elapsedMs = Math.max(0, new Date(lastSeenAt).getTime() - new Date(firstSeenAt).getTime());
  const minutes = Math.round(elapsedMs / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

type Props = {
  incident: ErrorGroupIncident;
  isQuickActionSaving?: boolean;
  quickActionError?: string | null;
  onIgnore?: () => void;
  onResolve?: () => void;
  shareUrl?: string;
};

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="incident-hero-metric">
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

export function IncidentSummary({ incident, isQuickActionSaving, quickActionError, onIgnore, onResolve, shareUrl }: Props) {
  const group = incident.group;
  return (
    <section className="incident-summary incident-hero" aria-label="Incident hero">
      <div className="incident-hero-main">
        <div>
          <p className="eyebrow">Incident</p>
          <h2>{group.message}</h2>
          <div className="incident-hero-tags">
            <span className={`badge severity-${group.severity}`}>{group.severity}</span>
            <span className={`badge status-${group.status}`}>{group.status}</span>
            <PriorityBadge priority={group.priority} suggested={incident.suggestedPriority} />
            <span className="badge">Group {group.id}</span>
            <span className="badge">Release {group.latestRelease ?? "none"}</span>
            <span className="badge">Observed {formatObservedDuration(group.firstSeenAt, group.lastSeenAt)}</span>
            <span className="badge">Assignee unassigned</span>
          </div>
        </div>
        <div className="incident-hero-actions" aria-label="Incident actions">
          {onResolve ? (
            <button disabled={isQuickActionSaving} onClick={onResolve} type="button">
              Resolve incident
            </button>
          ) : null}
          {onIgnore ? (
            <button disabled={isQuickActionSaving} onClick={onIgnore} type="button">
              Ignore incident
            </button>
          ) : null}
          {shareUrl ? <CopyButton label="Copy link" value={shareUrl} /> : null}
        </div>
      </div>
      {quickActionError ? <p role="alert">{quickActionError}</p> : null}
      <div className="incident-summary-grid">
        <MetricTile label="Occurrences" value={group.occurrenceCount} />
        <MetricTile label="Users" value={group.affectedUsersCount} />
        <MetricTile label="Tenants" value={group.affectedTenantsCount} />
        <span>First seen {formatTime(group.firstSeenAt)}</span>
        <span>Last seen {formatTime(group.lastSeenAt)}</span>
        <span>Last regression {formatTime(group.lastRegressedAt)}</span>
      </div>
    </section>
  );
}

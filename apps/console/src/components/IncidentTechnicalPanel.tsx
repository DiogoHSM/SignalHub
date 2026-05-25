import type { ErrorGroupIncident } from "../api/types";

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function formatValue(value: string | null | undefined): string {
  return value ?? "none";
}

export function IncidentTechnicalPanel({ incident }: { incident: ErrorGroupIncident }) {
  const occurrence = incident.primaryOccurrence;
  const sourceMapText =
    incident.sourceMapResolution.status === "cached"
      ? `Source map: ${incident.sourceMapResolution.frameCount} frames`
      : "Source map: none";

  return (
    <section className="incident-technical-panel" aria-label="Technical details">
      <h3>Primary occurrence</h3>
      <div className="incident-detail-grid">
        <span>ID {occurrence.id}</span>
        <span>User {formatValue(occurrence.userId)}</span>
        <span>Tenant {formatValue(occurrence.tenantId)}</span>
        <span>Trace {formatValue(occurrence.traceId)}</span>
        <span>Session {formatValue(occurrence.sessionId)}</span>
        <span>Release {formatValue(occurrence.release)}</span>
      </div>
      <h3>Stack</h3>
      <p>{sourceMapText}</p>
      <pre>{occurrence.stack ?? occurrence.message}</pre>
      <h3>Context</h3>
      <pre>{formatJson(occurrence.context)}</pre>
      <h3>Metadata</h3>
      <pre>{formatJson(occurrence.metadata)}</pre>
    </section>
  );
}

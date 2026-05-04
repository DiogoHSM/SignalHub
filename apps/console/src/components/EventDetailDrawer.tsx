import type { EventRecord } from "../api/types";

type Props = {
  event?: EventRecord;
};

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function detailValue(value: string | null | undefined): string {
  return value ?? "none";
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function EventDetailDrawer({ event }: Props) {
  if (!event) {
    return (
      <aside className="detail-drawer">
        <p className="muted-text">Select an event to inspect its details.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-drawer">
      <div className="panel-header">
        <h2>{event.name}</h2>
      </div>
      <dl className="detail-grid">
        <dt>ID</dt>
        <dd>
          <code>{event.id}</code>
        </dd>
        <dt>Project</dt>
        <dd>{event.projectId}</dd>
        <dt>Environment</dt>
        <dd>{event.environmentId}</dd>
        <dt>Timestamp</dt>
        <dd>{formatTimestamp(event.timestamp)}</dd>
        <dt>Received</dt>
        <dd>{formatTimestamp(event.receivedAt)}</dd>
        <dt>Tenant</dt>
        <dd>{detailValue(event.tenantId)}</dd>
        <dt>User</dt>
        <dd>{detailValue(event.userId)}</dd>
        <dt>Session</dt>
        <dd>{detailValue(event.sessionId)}</dd>
        <dt>Trace</dt>
        <dd>{detailValue(event.traceId)}</dd>
        <dt>Source</dt>
        <dd>{detailValue(event.source)}</dd>
        <dt>Release</dt>
        <dd>{detailValue(event.release)}</dd>
      </dl>
      <section className="json-section">
        <h3>Properties</h3>
        <pre>
          <code>{formatJson(event.properties)}</code>
        </pre>
      </section>
      <section className="json-section">
        <h3>Metadata</h3>
        <pre>
          <code>{formatJson(event.metadata)}</code>
        </pre>
      </section>
    </aside>
  );
}

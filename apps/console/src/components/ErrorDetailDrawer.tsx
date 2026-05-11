import type { ErrorRecord, SourceMapResolution } from "../api/types";
import { ErrorSourceMapResolution } from "./ErrorSourceMapResolution";

type Props = {
  error?: ErrorRecord;
  sourceMapResolution?: SourceMapResolution;
  isResolvingSourceMap?: boolean;
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

export function ErrorDetailDrawer({ error, sourceMapResolution, isResolvingSourceMap }: Props) {
  if (!error) {
    return (
      <aside className="detail-drawer">
        <p className="muted-text">Select an error to inspect its details.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-drawer">
      <div className="panel-header">
        <h2>{error.message}</h2>
      </div>
      <dl className="detail-grid">
        <dt>ID</dt>
        <dd>
          <code>{error.id}</code>
        </dd>
        <dt>Project</dt>
        <dd>{error.projectId}</dd>
        <dt>Environment</dt>
        <dd>{error.environmentId}</dd>
        <dt>Type</dt>
        <dd>{detailValue(error.type)}</dd>
        <dt>Severity</dt>
        <dd>{error.severity}</dd>
        <dt>Status</dt>
        <dd>{error.status}</dd>
        <dt>Timestamp</dt>
        <dd>{formatTimestamp(error.timestamp)}</dd>
        <dt>Received</dt>
        <dd>{formatTimestamp(error.receivedAt)}</dd>
        <dt>Tenant</dt>
        <dd>{detailValue(error.tenantId)}</dd>
        <dt>User</dt>
        <dd>{detailValue(error.userId)}</dd>
        <dt>Session</dt>
        <dd>{detailValue(error.sessionId)}</dd>
        <dt>Trace</dt>
        <dd>{detailValue(error.traceId)}</dd>
        <dt>Source</dt>
        <dd>{detailValue(error.source)}</dd>
        <dt>Release</dt>
        <dd>{detailValue(error.release)}</dd>
        <dt>Fingerprint</dt>
        <dd>{detailValue(error.fingerprint)}</dd>
        <dt>Group ID</dt>
        <dd>{detailValue(error.errorGroupId)}</dd>
        <dt>Group fingerprint</dt>
        <dd>{detailValue(error.groupingFingerprint)}</dd>
      </dl>
      <section className="json-section">
        <h3>Stack</h3>
        <pre>
          <code>{error.stack ?? "none"}</code>
        </pre>
      </section>
      <ErrorSourceMapResolution resolution={sourceMapResolution} isLoading={isResolvingSourceMap} />
      <section className="json-section">
        <h3>Context JSON</h3>
        <pre>
          <code>{formatJson(error.context)}</code>
        </pre>
      </section>
      <section className="json-section">
        <h3>Metadata JSON</h3>
        <pre>
          <code>{formatJson(error.metadata)}</code>
        </pre>
      </section>
    </aside>
  );
}

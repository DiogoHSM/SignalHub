import type { LlmCallRecord } from "../api/types";

type Props = {
  call?: LlmCallRecord;
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

function duration(value: number | null): string {
  return value === null ? "none" : `${value} ms`;
}

export function LlmCallDetailDrawer({ call }: Props) {
  if (!call) {
    return (
      <aside className="detail-drawer">
        <p className="muted-text">Select an LLM call to inspect its details.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-drawer">
      <div className="panel-header">
        <h2>{call.provider} / {call.model}</h2>
      </div>
      <dl className="detail-grid">
        <dt>ID</dt>
        <dd>
          <code>{call.id}</code>
        </dd>
        <dt>Prompt</dt>
        <dd>{detailValue(call.promptName)}</dd>
        <dt>Status</dt>
        <dd>{call.status}</dd>
        <dt>Input tokens</dt>
        <dd>{call.inputTokens}</dd>
        <dt>Output tokens</dt>
        <dd>{call.outputTokens}</dd>
        <dt>Cost</dt>
        <dd>{call.costUsd}</dd>
        <dt>Latency</dt>
        <dd>{duration(call.latencyMs)}</dd>
        <dt>Project</dt>
        <dd>{call.projectId}</dd>
        <dt>Environment</dt>
        <dd>{call.environmentId}</dd>
        <dt>Timestamp</dt>
        <dd>{formatTimestamp(call.timestamp)}</dd>
        <dt>Received</dt>
        <dd>{formatTimestamp(call.receivedAt)}</dd>
        <dt>Tenant</dt>
        <dd>{detailValue(call.tenantId)}</dd>
        <dt>User</dt>
        <dd>{detailValue(call.userId)}</dd>
        <dt>Session</dt>
        <dd>{detailValue(call.sessionId)}</dd>
        <dt>Trace</dt>
        <dd>{detailValue(call.traceId)}</dd>
        <dt>Source</dt>
        <dd>{detailValue(call.source)}</dd>
        <dt>Release</dt>
        <dd>{detailValue(call.release)}</dd>
      </dl>
      <section className="json-section">
        <h3>Error</h3>
        <pre>
          <code>{call.error ?? "none"}</code>
        </pre>
      </section>
      <section className="json-section">
        <h3>Input preview</h3>
        <pre>
          <code>{call.inputPreview ?? "none"}</code>
        </pre>
      </section>
      <section className="json-section">
        <h3>Output preview</h3>
        <pre>
          <code>{call.outputPreview ?? "none"}</code>
        </pre>
      </section>
      <section className="json-section">
        <h3>Metadata JSON</h3>
        <pre>
          <code>{formatJson(call.metadata)}</code>
        </pre>
      </section>
    </aside>
  );
}

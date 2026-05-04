import type { SpanRecord } from "../api/types";

type Props = {
  spans: SpanRecord[];
};

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function detailValue(value: string | null | undefined): string {
  return value ?? "none";
}

function duration(value: number | null): string {
  return value === null ? "none" : `${value} ms`;
}

function ordered(spans: SpanRecord[]): SpanRecord[] {
  return [...spans].sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
}

export function SpanTimeline({ spans }: Props) {
  return (
    <section className="json-section">
      <h3>Spans</h3>
      <div className="span-timeline">
        {ordered(spans).map((span) => (
          <article className="span-row" key={span.id}>
            <header>
              <strong>{span.name}</strong>
              <code>ID {span.id}</code>
            </header>
            <dl className="detail-grid">
              <dt>Status</dt>
              <dd>{span.status}</dd>
              <dt>Parent</dt>
              <dd>{detailValue(span.parentSpanId)}</dd>
              <dt>Started</dt>
              <dd>{formatTimestamp(span.startedAt)}</dd>
              <dt>Duration</dt>
              <dd>{duration(span.durationMs)}</dd>
              <dt>Cost</dt>
              <dd>{detailValue(span.costUsd)}</dd>
            </dl>
            <section className="json-section">
              <h4>Input JSON</h4>
              <pre>
                <code>{formatJson(span.input)}</code>
              </pre>
            </section>
            <section className="json-section">
              <h4>Output JSON</h4>
              <pre>
                <code>{formatJson(span.output)}</code>
              </pre>
            </section>
            <section className="json-section">
              <h4>Error JSON</h4>
              <pre>
                <code>{formatJson(span.error)}</code>
              </pre>
            </section>
            <section className="json-section">
              <h4>Metadata JSON</h4>
              <pre>
                <code>{formatJson(span.metadata)}</code>
              </pre>
            </section>
          </article>
        ))}
      </div>
    </section>
  );
}

type OperationalSummary = {
  impactScore: number;
  openErrors: number;
  severeErrors: number;
  failedLlmCalls: number;
};

type TimelineRow = {
  type: "event" | "error" | "trace" | "llm";
};

type OperationalProfileProps = {
  label: string;
  summary: OperationalSummary;
};

type TimelineSignalMixProps = {
  label: string;
  rows: TimelineRow[];
};

const signalLabels: Array<{ type: TimelineRow["type"]; label: string }> = [
  { type: "event", label: "Events" },
  { type: "error", label: "Errors" },
  { type: "trace", label: "Traces" },
  { type: "llm", label: "LLM" }
];

export function EntityOperationalProfile({ label, summary }: OperationalProfileProps) {
  const metrics = [
    { label: "Impact score", value: summary.impactScore },
    { label: "Open errors", value: summary.openErrors },
    { label: "Severe errors", value: summary.severeErrors },
    { label: "Failed LLM calls", value: summary.failedLlmCalls }
  ];

  return (
    <section aria-label={label} className="entity-operational-profile">
      {metrics.map((metric) => (
        <div key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </section>
  );
}

export function TimelineSignalMix({ label, rows }: TimelineSignalMixProps) {
  const counts = signalLabels.map((signal) => ({
    ...signal,
    count: rows.filter((row) => row.type === signal.type).length
  }));

  return (
    <div aria-label={label} className="timeline-signal-mix">
      <span>Timeline mix</span>
      {counts.map((signal) => (
        <strong key={signal.type}>{`${signal.label} ${signal.count}`}</strong>
      ))}
    </div>
  );
}

import type { LlmCallRecord } from "../api/types";

type Props = {
  calls: LlmCallRecord[];
  selectedCallId?: string;
  onSelect: (call: LlmCallRecord) => void;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function duration(value: number | null): string {
  return value === null ? "none" : `${value} ms`;
}

function label(value: string | null): string {
  return value ?? "none";
}

function tokenTotal(call: LlmCallRecord): string {
  return String(call.inputTokens + call.outputTokens);
}

export function LlmCallList({ calls, selectedCallId, onSelect }: Props) {
  return (
    <div className="event-list" aria-label="LLM calls">
      {calls.map((call) => (
        <button
          aria-pressed={call.id === selectedCallId}
          className="event-row llm-row"
          key={call.id}
          onClick={() => onSelect(call)}
          type="button"
        >
          <span>
            <strong>
              {call.provider} / {call.model}
            </strong>
            <code>{call.id}</code>
          </span>
          <span>{label(call.promptName)}</span>
          <span>{call.status}</span>
          <span>{call.costUsd}</span>
          <span>{tokenTotal(call)}</span>
          <span>{duration(call.latencyMs)}</span>
          <span>{formatTimestamp(call.timestamp)}</span>
          <span>{label(call.userId)}</span>
          <span>{label(call.tenantId)}</span>
        </button>
      ))}
    </div>
  );
}

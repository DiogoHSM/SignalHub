import type { LlmAggregates } from "../api/types";

type State = "loading" | "ready" | "unavailable";

type Props = {
  state: State;
  totals?: LlmAggregates;
  onRetry: () => void;
};

function value(value: number | string | undefined): string {
  return value === undefined ? "none" : String(value);
}

export function LlmAggregateStrip({ state, totals, onRetry }: Props) {
  if (state === "unavailable") {
    return (
      <div className="status-box unavailable">
        <strong>LLM totals unavailable</strong>
        <button onClick={onRetry} type="button">
          Retry totals
        </button>
      </div>
    );
  }

  return (
    <div className="aggregate-strip" aria-label="LLM totals">
      <div>
        <span>Total calls</span>
        <strong>{state === "loading" ? "Loading" : value(totals?.totalCalls)}</strong>
      </div>
      <div>
        <span>Input tokens</span>
        <strong>{state === "loading" ? "Loading" : value(totals?.totalInputTokens)}</strong>
      </div>
      <div>
        <span>Output tokens</span>
        <strong>{state === "loading" ? "Loading" : value(totals?.totalOutputTokens)}</strong>
      </div>
      <div>
        <span>Total cost</span>
        <strong>{state === "loading" ? "Loading" : value(totals?.totalCostUsd)}</strong>
      </div>
    </div>
  );
}

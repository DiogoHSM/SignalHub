import type { FormEvent } from "react";

export type LlmFilterValues = {
  provider: string;
  model: string;
  promptName: string;
  status: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  traceId: string;
  from: string;
  to: string;
  limit: string;
};

type Props = {
  values: LlmFilterValues;
  onChange: (values: LlmFilterValues) => void;
  onApply: () => void;
  onReset: () => void;
};

function update(values: LlmFilterValues, key: keyof LlmFilterValues, value: string): LlmFilterValues {
  return { ...values, [key]: value };
}

export function LlmFilters({ values, onChange, onApply, onReset }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply();
  }

  return (
    <form className="event-filters llm-filters" onSubmit={submit}>
      <label>
        Provider
        <input value={values.provider} onChange={(event) => onChange(update(values, "provider", event.target.value))} />
      </label>
      <label>
        Model
        <input value={values.model} onChange={(event) => onChange(update(values, "model", event.target.value))} />
      </label>
      <label>
        Prompt
        <input value={values.promptName} onChange={(event) => onChange(update(values, "promptName", event.target.value))} />
      </label>
      <label>
        Status
        <input value={values.status} onChange={(event) => onChange(update(values, "status", event.target.value))} />
      </label>
      <label>
        Tenant
        <input value={values.tenantId} onChange={(event) => onChange(update(values, "tenantId", event.target.value))} />
      </label>
      <label>
        User
        <input value={values.userId} onChange={(event) => onChange(update(values, "userId", event.target.value))} />
      </label>
      <label>
        Session
        <input value={values.sessionId} onChange={(event) => onChange(update(values, "sessionId", event.target.value))} />
      </label>
      <label>
        Trace
        <input value={values.traceId} onChange={(event) => onChange(update(values, "traceId", event.target.value))} />
      </label>
      <label>
        From
        <input type="datetime-local" value={values.from} onChange={(event) => onChange(update(values, "from", event.target.value))} />
      </label>
      <label>
        To
        <input type="datetime-local" value={values.to} onChange={(event) => onChange(update(values, "to", event.target.value))} />
      </label>
      <label>
        Limit
        <input min="1" max="500" type="number" value={values.limit} onChange={(event) => onChange(update(values, "limit", event.target.value))} />
      </label>
      <div className="filter-actions">
        <button type="submit">Apply</button>
        <button onClick={onReset} type="button">
          Reset
        </button>
      </div>
    </form>
  );
}

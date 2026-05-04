import type { FormEvent } from "react";

export type ErrorFilterValues = {
  severity: string;
  status: string;
  fingerprint: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  traceId: string;
  from: string;
  to: string;
  limit: string;
};

type Props = {
  values: ErrorFilterValues;
  onChange: (values: ErrorFilterValues) => void;
  onApply: () => void;
  onReset: () => void;
};

function update(values: ErrorFilterValues, key: keyof ErrorFilterValues, value: string): ErrorFilterValues {
  return { ...values, [key]: value };
}

export function ErrorFilters({ values, onChange, onApply, onReset }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply();
  }

  return (
    <form className="event-filters" onSubmit={submit}>
      <label>
        Severity
        <input value={values.severity} onChange={(event) => onChange(update(values, "severity", event.target.value))} />
      </label>
      <label>
        Status
        <input value={values.status} onChange={(event) => onChange(update(values, "status", event.target.value))} />
      </label>
      <label>
        Fingerprint
        <input value={values.fingerprint} onChange={(event) => onChange(update(values, "fingerprint", event.target.value))} />
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
        <input
          max="500"
          min="1"
          type="number"
          value={values.limit}
          onChange={(event) => onChange(update(values, "limit", event.target.value))}
        />
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

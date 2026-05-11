import type { FormEvent } from "react";
import type { ErrorGroupStatus } from "../api/types";

export type ErrorGroupFilterValues = {
  severity: string;
  status: "" | ErrorGroupStatus;
  fingerprint: string;
  tenantId: string;
  userId: string;
  release: string;
  from: string;
  to: string;
  limit: string;
};

type Props = {
  values: ErrorGroupFilterValues;
  onChange: (values: ErrorGroupFilterValues) => void;
  onApply: () => void;
  onReset: () => void;
};

const statusOptions: ErrorGroupStatus[] = ["open", "investigating", "resolved", "ignored"];

function update<K extends keyof ErrorGroupFilterValues>(
  values: ErrorGroupFilterValues,
  key: K,
  value: ErrorGroupFilterValues[K]
): ErrorGroupFilterValues {
  return { ...values, [key]: value };
}

export function ErrorGroupFilters({ values, onChange, onApply, onReset }: Props) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply();
  }

  return (
    <form className="event-filters error-group-filters" onSubmit={submit}>
      <label>
        Severity
        <input value={values.severity} onChange={(event) => onChange(update(values, "severity", event.target.value))} />
      </label>
      <label>
        Status
        <select
          value={values.status}
          onChange={(event) => onChange(update(values, "status", event.target.value as ErrorGroupFilterValues["status"]))}
        >
          <option value="">Any</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
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
        Release
        <input value={values.release} onChange={(event) => onChange(update(values, "release", event.target.value))} />
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

import { type FormEvent, useState } from "react";
import type { Environment } from "../api/types";

type Props = {
  environments: Environment[];
  activeEnvironmentId?: string;
  disabled: boolean;
  onSelect: (environment: Environment) => void;
  onCreate: (name: string) => Promise<void>;
};

export function EnvironmentSelector({ environments, activeEnvironmentId, disabled, onSelect, onCreate }: Props) {
  const [name, setName] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || disabled) return;

    await onCreate(trimmed);
    setName("");
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Environments</h2>
      </div>
      <div className="button-row">
        {environments.map((environment) => (
          <button
            aria-pressed={environment.id === activeEnvironmentId}
            className={environment.id === activeEnvironmentId ? "pill active" : "pill"}
            key={environment.id}
            onClick={() => onSelect(environment)}
            type="button"
          >
            {environment.name}
          </button>
        ))}
      </div>
      <form className="inline-form" onSubmit={submit}>
        <label>
          New environment name
          <input disabled={disabled} onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <button disabled={disabled} type="submit">
          Create environment
        </button>
      </form>
    </section>
  );
}

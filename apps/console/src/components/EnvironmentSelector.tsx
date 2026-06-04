import { type FormEvent, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import type { Environment } from "../api/types";

type Props = {
  environments: Environment[];
  activeEnvironmentId?: string;
  disabled: boolean;
  onSelect: (environment: Environment) => void;
  onCreate: (name: string) => Promise<void>;
  onUpdate?: (environment: Environment, name: string) => Promise<void>;
  onArchive?: (environment: Environment) => Promise<void>;
};

export function EnvironmentSelector({
  environments,
  activeEnvironmentId,
  disabled,
  onSelect,
  onCreate,
  onUpdate,
  onArchive
}: Props) {
  const [name, setName] = useState("");
  const [editingEnvironmentId, setEditingEnvironmentId] = useState<string | undefined>();
  const [editingName, setEditingName] = useState("");
  const canManage = Boolean(onUpdate || onArchive);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || disabled) return;

    await onCreate(trimmed);
    setName("");
  }

  function startEditing(environment: Environment) {
    setEditingEnvironmentId(environment.id);
    setEditingName(environment.name);
  }

  function cancelEditing() {
    setEditingEnvironmentId(undefined);
    setEditingName("");
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>, environment: Environment) {
    event.preventDefault();
    const trimmed = editingName.trim();
    if (!onUpdate || !trimmed || trimmed === environment.name) {
      cancelEditing();
      return;
    }

    await onUpdate(environment, trimmed);
    cancelEditing();
  }

  async function archive(environment: Environment) {
    if (!onArchive) return;
    if (!window.confirm(`Archive environment ${environment.name}?`)) return;
    await onArchive(environment);
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Environments</h2>
      </div>
      <div className={canManage ? "environment-list" : "button-row"}>
        {environments.map((environment) => (
          <div
            className={canManage ? (environment.id === activeEnvironmentId ? "environment-row active" : "environment-row") : undefined}
            key={environment.id}
          >
            {editingEnvironmentId === environment.id ? (
              <form className="environment-row__edit" onSubmit={(event) => void submitEdit(event, environment)}>
                <label>
                  Environment name
                  <input autoFocus onChange={(event) => setEditingName(event.target.value)} value={editingName} />
                </label>
                <button aria-label="Save environment" disabled={!onUpdate} type="submit">
                  <Check aria-hidden="true" size={15} />
                </button>
                <button aria-label="Cancel environment edit" onClick={cancelEditing} type="button">
                  <X aria-hidden="true" size={15} />
                </button>
              </form>
            ) : (
              <>
                <button
                  aria-pressed={environment.id === activeEnvironmentId}
                  className={canManage ? "environment-row__select" : environment.id === activeEnvironmentId ? "pill active" : "pill"}
                  onClick={() => onSelect(environment)}
                  type="button"
                >
                  <strong>{environment.name}</strong>
                  {canManage ? <span aria-hidden="true">{environment.id}</span> : null}
                </button>
                {canManage ? (
                  <div className="environment-row__actions">
                    {onUpdate ? (
                      <button aria-label={`Edit ${environment.name}`} onClick={() => startEditing(environment)} type="button">
                        <Pencil aria-hidden="true" size={15} />
                      </button>
                    ) : null}
                    {onArchive ? (
                      <button aria-label={`Archive ${environment.name}`} onClick={() => void archive(environment)} type="button">
                        <Trash2 aria-hidden="true" size={15} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
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

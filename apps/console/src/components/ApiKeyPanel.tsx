import { type FormEvent, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ApiClient } from "../api/client";
import type { ApiKey } from "../api/types";

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
  onSecretCreated: (secret: string) => void;
};

type LatestSecret = {
  secret: string;
  projectId: string;
  environmentId: string;
};

export function ApiKeyPanel({ client, projectId, environmentId, onSecretCreated }: Props) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [editingKey, setEditingKey] = useState<ApiKey | undefined>();
  const [latestSecret, setLatestSecret] = useState<LatestSecret | undefined>();
  const projectIdRef = useRef<string | undefined>(projectId);
  const environmentIdRef = useRef<string | undefined>(environmentId);
  const isEditing = editingKey !== undefined;
  const isSubmitDisabled = isEditing ? !editingKey || !client.updateApiKey : !projectId || !environmentId;
  const scopedLatestSecret =
    latestSecret && latestSecret.projectId === projectId && latestSecret.environmentId === environmentId
      ? latestSecret.secret
      : undefined;

  projectIdRef.current = projectId;
  environmentIdRef.current = environmentId;

  useEffect(() => {
    let cancelled = false;
    setLatestSecret(undefined);

    if (!projectId) {
      setApiKeys([]);
      return () => {
        cancelled = true;
      };
    }

    void Promise.resolve(client.listApiKeys(projectId)).then((response) => {
      if (cancelled || projectIdRef.current !== projectId) return;
      setApiKeys(response?.apiKeys ?? []);
    });

    return () => {
      cancelled = true;
    };
  }, [client, projectId]);

  useEffect(() => {
    setLatestSecret(undefined);
    setEditingKey(undefined);
    setName("");
  }, [environmentId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    if (editingKey) {
      if (!client.updateApiKey) return;

      const editingId = editingKey.id;
      const { apiKey } = await client.updateApiKey(editingId, { name: trimmed });
      setApiKeys((current) => current.map((currentKey) => (currentKey.id === editingId ? apiKey : currentKey)));
      setEditingKey(undefined);
      setName("");
      return;
    }

    if (!projectId || !environmentId) return;

    const createProjectId = projectId;
    const createEnvironmentId = environmentId;
    const { apiKey } = await client.createApiKey(projectId, { environmentId, name: trimmed });
    if (projectIdRef.current !== createProjectId || environmentIdRef.current !== createEnvironmentId) return;

    const { secret, ...safeApiKey } = apiKey;
    setApiKeys((current) => [...current, safeApiKey]);
    setLatestSecret({
      secret,
      projectId: createProjectId,
      environmentId: createEnvironmentId
    });
    onSecretCreated(secret);
    setName("");
  }

  function startEditing(apiKey: ApiKey) {
    setLatestSecret(undefined);
    setEditingKey(apiKey);
    setName(apiKey.name);
  }

  function cancelEditing() {
    setEditingKey(undefined);
    setName("");
  }

  async function revoke(apiKey: ApiKey) {
    if (!window.confirm(`Revoke API key ${apiKey.name}?`)) return;

    const revokeProjectId = projectId;
    await client.revokeApiKey(apiKey.id);
    if (projectIdRef.current !== revokeProjectId) return;

    setApiKeys((current) => current.filter((currentApiKey) => currentApiKey.id !== apiKey.id));
  }

  return (
    <section className="panel api-key-panel">
      <div className="panel-header">
        <h2>API keys</h2>
      </div>
      {apiKeys.length === 0 ? (
        <p className="muted-text">No API keys yet.</p>
      ) : (
        <ul className="key-list">
          {apiKeys.map((apiKey) => (
            <li className="key-list-item" key={apiKey.id}>
              <div>
                <strong>{apiKey.name}</strong>
                {apiKey.revokedAt ? <span>Revoked</span> : null}
              </div>
              <div className="key-list-item__actions">
                <code>{apiKey.prefix}</code>
                {apiKey.revokedAt ? null : (
                  <>
                    <button onClick={() => startEditing(apiKey)} type="button">
                      Edit {apiKey.name}
                    </button>
                    <button
                      aria-label={`Revoke ${apiKey.name}`}
                      className="icon-button icon-button--danger"
                      onClick={() => void revoke(apiKey)}
                      title="Revoke API key"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {scopedLatestSecret ? (
        <div className="secret-callout" role="status">
          <strong>One-time secret</strong>
          <code>{scopedLatestSecret}</code>
        </div>
      ) : null}
      <form className="inline-form" onSubmit={submit}>
        <label>
          {isEditing ? "API key name" : "New API key name"}
          <input disabled={isSubmitDisabled} onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <button disabled={isSubmitDisabled} type="submit">
          {isEditing ? "Save key" : "Create key"}
        </button>
        {isEditing ? (
          <button onClick={cancelEditing} type="button">
            Cancel
          </button>
        ) : null}
      </form>
    </section>
  );
}

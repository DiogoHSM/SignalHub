import { type FormEvent, useEffect, useRef, useState } from "react";
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
  const [latestSecret, setLatestSecret] = useState<LatestSecret | undefined>();
  const projectIdRef = useRef<string | undefined>(projectId);
  const environmentIdRef = useRef<string | undefined>(environmentId);
  const isCreateDisabled = !projectId || !environmentId;
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
  }, [environmentId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!projectId || !environmentId || !trimmed) return;

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
              </div>
              <code>{apiKey.prefix}</code>
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
          New API key name
          <input disabled={isCreateDisabled} onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <button disabled={isCreateDisabled} type="submit">
          Create key
        </button>
      </form>
    </section>
  );
}

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { ApiClient } from "../api/client";
import type { MonitorCheckResponse, MonitorResponse, NotificationChannelResponse } from "../api/types";

type Props = {
  apiEndpoint: string;
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};

type HttpForm = {
  name: string;
  url: string;
  intervalMinutes: string;
  timeoutMs: string;
  notificationChannelId: string;
};

type HeartbeatForm = {
  name: string;
  expectedIntervalMinutes: string;
  graceMinutes: string;
  notificationChannelId: string;
};

type EditForm = {
  id: string;
  kind: MonitorResponse["kind"];
  name: string;
  enabled: boolean;
  notificationChannelId: string;
  url: string;
  intervalMinutes: string;
  timeoutMs: string;
  expectedIntervalMinutes: string;
  graceMinutes: string;
};

type LatestSecret = {
  monitorId: string;
  monitorName: string;
  secret: string;
  url: string;
};

const defaultHttpForm: HttpForm = {
  name: "",
  url: "",
  intervalMinutes: "5",
  timeoutMs: "5000",
  notificationChannelId: ""
};

const defaultHeartbeatForm: HeartbeatForm = {
  name: "",
  expectedIntervalMinutes: "5",
  graceMinutes: "2",
  notificationChannelId: ""
};

function statusClass(status: string | null | undefined): string {
  if (status === "up" || status === "success") return "status-pill status-pill--success";
  if (status === "down" || status === "failed") return "status-pill status-pill--failed";
  if (status === "degraded") return "status-pill status-pill--warning";
  return "status-pill status-pill--neutral";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "No data";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "No data" : timestamp.toLocaleString();
}

function parsePositiveInteger(value: string, minimum: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : null;
}

function validateHttpUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Monitor URL must be a valid http or https URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Monitor URL must be a valid http or https URL";
  }
  if (parsed.username || parsed.password) {
    return "Monitor URL must not include credentials";
  }
  return null;
}

function heartbeatUrl(apiEndpoint: string, monitorId: string): string {
  const base = apiEndpoint.replace(/\/+$/, "");
  return `${base || window.location.origin}/v1/heartbeats/${encodeURIComponent(monitorId)}`;
}

function channelLabel(channel: NotificationChannelResponse): string {
  return channel.type === "email" ? `${channel.name} · email` : `${channel.name} · webhook`;
}

function editFormFromMonitor(monitor: MonitorResponse): EditForm {
  return {
    id: monitor.id,
    kind: monitor.kind,
    name: monitor.name,
    enabled: monitor.enabled,
    notificationChannelId: monitor.notificationChannelId ?? "",
    url: monitor.url ?? "",
    intervalMinutes: String(monitor.intervalMinutes ?? 5),
    timeoutMs: String(monitor.timeoutMs ?? 5000),
    expectedIntervalMinutes: String(monitor.expectedIntervalMinutes ?? 5),
    graceMinutes: String(monitor.graceMinutes ?? 0)
  };
}

export function MonitorsPanel({ apiEndpoint, client, projectId, environmentId }: Props) {
  const scopeRef = useRef({ projectId, environmentId });
  const [monitors, setMonitors] = useState<MonitorResponse[]>([]);
  const [channels, setChannels] = useState<NotificationChannelResponse[]>([]);
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);
  const [checks, setChecks] = useState<MonitorCheckResponse[]>([]);
  const [httpForm, setHttpForm] = useState<HttpForm>(defaultHttpForm);
  const [heartbeatForm, setHeartbeatForm] = useState<HeartbeatForm>(defaultHeartbeatForm);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [latestSecret, setLatestSecret] = useState<LatestSecret | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingHttp, setIsCreatingHttp] = useState(false);
  const [isCreatingHeartbeat, setIsCreatingHeartbeat] = useState(false);
  const [isSavingMonitor, setIsSavingMonitor] = useState(false);
  const [deletingMonitorId, setDeletingMonitorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  scopeRef.current = { projectId, environmentId };

  const selectedMonitor = useMemo(
    () => monitors.find((monitor) => monitor.id === selectedMonitorId) ?? monitors[0] ?? null,
    [monitors, selectedMonitorId]
  );

  useEffect(() => {
    setHttpForm(defaultHttpForm);
    setHeartbeatForm(defaultHeartbeatForm);
    setEditForm(null);
    setLatestSecret(null);
  }, [projectId, environmentId]);

  useEffect(() => {
    if (!projectId || !environmentId) {
      setMonitors([]);
      setChannels([]);
      setChecks([]);
      setSelectedMonitorId(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    if (!client.listMonitors || !client.listNotificationChannels) {
      setError("Monitors unavailable");
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void Promise.all([
      client.listMonitors({ projectId, environmentId }),
      client.listNotificationChannels()
    ])
      .then(([monitorResult, channelResult]) => {
        if (cancelled) return;
        setMonitors(monitorResult.monitors);
        setChannels(channelResult.channels);
        setSelectedMonitorId((current) => current ?? monitorResult.monitors[0]?.id ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setMonitors([]);
        setChannels([]);
        setChecks([]);
        setError("Monitors unavailable");
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, projectId, environmentId]);

  useEffect(() => {
    if (!selectedMonitor || !client.listMonitorChecks) {
      setChecks([]);
      return;
    }
    let cancelled = false;
    void client
      .listMonitorChecks(selectedMonitor.id, 20)
      .then((result) => {
        if (!cancelled) setChecks(result.checks);
      })
      .catch(() => {
        if (!cancelled) setChecks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client, selectedMonitor]);

  async function createHttpMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !environmentId || !client.createHttpMonitor || isCreatingHttp) return;
    const submittedProjectId = projectId;
    const submittedEnvironmentId = environmentId;
    const name = httpForm.name.trim();
    const url = httpForm.url.trim();
    if (!name || !url) {
      setError("HTTP monitor name and URL are required");
      return;
    }
    const urlError = validateHttpUrl(url);
    if (urlError) {
      setError(urlError);
      return;
    }
    const intervalMinutes = parsePositiveInteger(httpForm.intervalMinutes, 1);
    const timeoutMs = parsePositiveInteger(httpForm.timeoutMs, 100);
    if (intervalMinutes === null || timeoutMs === null) {
      setError("HTTP monitor interval and timeout must be valid numbers");
      return;
    }

    setIsCreatingHttp(true);
    setError(null);
    try {
      const { monitor } = await client.createHttpMonitor({
        projectId: submittedProjectId,
        environmentId: submittedEnvironmentId,
        notificationChannelId: httpForm.notificationChannelId || null,
        name,
        url,
        intervalMinutes,
        timeoutMs,
        method: "GET",
        expectedStatus: "2xx",
        failureThreshold: 2,
        recoveryThreshold: 2,
        enabled: true
      });
      if (scopeRef.current.projectId !== submittedProjectId || scopeRef.current.environmentId !== submittedEnvironmentId) return;
      setMonitors((current) => [...current, monitor]);
      setSelectedMonitorId(monitor.id);
      setHttpForm((current) => ({ ...defaultHttpForm, notificationChannelId: current.notificationChannelId }));
    } catch {
      setError("Could not create HTTP monitor");
    } finally {
      setIsCreatingHttp(false);
    }
  }

  async function createHeartbeatMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !environmentId || !client.createHeartbeatMonitor || isCreatingHeartbeat) return;
    const submittedProjectId = projectId;
    const submittedEnvironmentId = environmentId;
    const name = heartbeatForm.name.trim();
    if (!name) {
      setError("Heartbeat monitor name is required");
      return;
    }
    const expectedIntervalMinutes = parsePositiveInteger(heartbeatForm.expectedIntervalMinutes, 1);
    const graceMinutes = parsePositiveInteger(heartbeatForm.graceMinutes, 0);
    if (expectedIntervalMinutes === null || graceMinutes === null) {
      setError("Heartbeat interval and grace must be valid numbers");
      return;
    }

    setIsCreatingHeartbeat(true);
    setError(null);
    try {
      const { monitor, secret } = await client.createHeartbeatMonitor({
        projectId: submittedProjectId,
        environmentId: submittedEnvironmentId,
        notificationChannelId: heartbeatForm.notificationChannelId || null,
        name,
        expectedIntervalMinutes,
        graceMinutes,
        enabled: true
      });
      if (scopeRef.current.projectId !== submittedProjectId || scopeRef.current.environmentId !== submittedEnvironmentId) return;
      setMonitors((current) => [...current, monitor]);
      setSelectedMonitorId(monitor.id);
      setLatestSecret({ monitorId: monitor.id, monitorName: monitor.name, secret, url: heartbeatUrl(apiEndpoint, monitor.id) });
      setHeartbeatForm((current) => ({ ...defaultHeartbeatForm, notificationChannelId: current.notificationChannelId }));
    } catch {
      setError("Could not create heartbeat monitor");
    } finally {
      setIsCreatingHeartbeat(false);
    }
  }

  function startEditingMonitor(monitor: MonitorResponse) {
    setSelectedMonitorId(monitor.id);
    setEditForm(editFormFromMonitor(monitor));
    setError(null);
  }

  async function saveMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editForm || !client.updateMonitor || isSavingMonitor) return;

    const name = editForm.name.trim();
    if (!name) {
      setError("Monitor name is required");
      return;
    }

    const input: Parameters<NonNullable<ApiClient["updateMonitor"]>>[1] = {
      notificationChannelId: editForm.notificationChannelId || null,
      name,
      enabled: editForm.enabled
    };

    if (editForm.kind === "http") {
      const url = editForm.url.trim();
      if (!url) {
        setError("HTTP monitor URL is required");
        return;
      }
      const urlError = validateHttpUrl(url);
      if (urlError) {
        setError(urlError);
        return;
      }
      const intervalMinutes = parsePositiveInteger(editForm.intervalMinutes, 1);
      const timeoutMs = parsePositiveInteger(editForm.timeoutMs, 100);
      if (intervalMinutes === null || timeoutMs === null) {
        setError("HTTP monitor interval and timeout must be valid numbers");
        return;
      }
      input.url = url;
      input.intervalMinutes = intervalMinutes;
      input.timeoutMs = timeoutMs;
    } else {
      const expectedIntervalMinutes = parsePositiveInteger(editForm.expectedIntervalMinutes, 1);
      const graceMinutes = parsePositiveInteger(editForm.graceMinutes, 0);
      if (expectedIntervalMinutes === null || graceMinutes === null) {
        setError("Heartbeat interval and grace must be valid numbers");
        return;
      }
      input.expectedIntervalMinutes = expectedIntervalMinutes;
      input.graceMinutes = graceMinutes;
    }

    setIsSavingMonitor(true);
    setError(null);
    try {
      const { monitor } = await client.updateMonitor(editForm.id, input);
      setMonitors((current) => current.map((item) => (item.id === monitor.id ? monitor : item)));
      setSelectedMonitorId(monitor.id);
      setEditForm(editFormFromMonitor(monitor));
    } catch {
      setError("Could not update monitor");
    } finally {
      setIsSavingMonitor(false);
    }
  }

  async function archiveMonitor(monitor: MonitorResponse) {
    if (!client.archiveMonitor || deletingMonitorId) return;
    const confirmed = window.confirm(`Delete monitor "${monitor.name}"? Historical checks will be kept.`);
    if (!confirmed) return;

    setDeletingMonitorId(monitor.id);
    setError(null);
    try {
      await client.archiveMonitor(monitor.id);
      const remaining = monitors.filter((item) => item.id !== monitor.id);
      setMonitors(remaining);
      setSelectedMonitorId((current) => (current === monitor.id ? remaining[0]?.id ?? null : current));
      if (selectedMonitor?.id === monitor.id) {
        setChecks([]);
      }
      setEditForm((current) => (current?.id === monitor.id ? null : current));
    } catch {
      setError("Could not delete monitor");
    } finally {
      setDeletingMonitorId(null);
    }
  }

  function copyText(value: string) {
    void navigator.clipboard?.writeText(value);
  }

  if (!projectId || !environmentId) {
    return (
      <section className="monitors-panel">
        <header className="alerts-panel__header">
          <div>
            <h2>Monitors</h2>
            <p className="muted-text">Select a project and environment to manage monitors.</p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section className="monitors-panel">
      <header className="alerts-panel__header">
        <div>
          <h2>Monitors</h2>
          <p className="muted-text">HTTP uptime and heartbeat checks for this environment.</p>
        </div>
      </header>

      {isLoading ? <p className="muted-text" role="status">Loading monitors</p> : null}
      {error ? (
        <div className="status-box unavailable" role="alert">
          <strong>{error}</strong>
        </div>
      ) : null}
      {latestSecret ? (
        <section aria-label="New heartbeat secret" className="status-box success monitors-secret">
          <div>
            <strong>{latestSecret.monitorName}</strong>
            <span>{latestSecret.monitorId}</span>
          </div>
          <label>
            Check-in URL
            <input readOnly value={latestSecret.url} />
          </label>
          <button onClick={() => copyText(latestSecret.url)} type="button">Copy URL</button>
          <label>
            Secret
            <input readOnly value={latestSecret.secret} />
          </label>
          <button onClick={() => copyText(latestSecret.secret)} type="button">Copy secret</button>
        </section>
      ) : null}

      <div className="alerts-grid">
        <section aria-label="Monitor list" className="alerts-card alerts-card--wide">
          <div className="alerts-card__header">
            <h3>Monitor list</h3>
            <span className="status-pill status-pill--neutral">{monitors.length}</span>
          </div>
          {monitors.length === 0 ? (
            <p className="muted-text">No monitors.</p>
          ) : (
            <div className="alerts-list">
              {monitors.map((monitor) => (
                <article
                  className="monitors-row"
                  key={monitor.id}
                  data-selected={selectedMonitor?.id === monitor.id ? "true" : "false"}
                >
                  <button className="monitors-row__select" onClick={() => setSelectedMonitorId(monitor.id)} type="button">
                    <div>
                      <strong>{monitor.name}</strong>
                      <span>{monitor.kind === "http" ? monitor.url : `every ${monitor.expectedIntervalMinutes}m + ${monitor.graceMinutes}m grace`}</span>
                      <span>Last check {formatTimestamp(monitor.lastCheckedAt)}</span>
                    </div>
                    <span className={statusClass(monitor.status)}>{monitor.status}</span>
                  </button>
                  <div className="monitor-row-actions">
                    <button aria-label={`Edit ${monitor.name}`} className="icon-button" onClick={() => startEditingMonitor(monitor)} title="Edit monitor" type="button">
                      <Pencil aria-hidden="true" size={16} />
                    </button>
                    <button
                      aria-label={`Delete ${monitor.name}`}
                      className="icon-button icon-button--danger"
                      disabled={deletingMonitorId === monitor.id}
                      onClick={() => void archiveMonitor(monitor)}
                      title="Delete monitor"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section aria-label="Recent monitor checks" className="alerts-card">
          <div className="alerts-card__header">
            <h3>Recent checks</h3>
            <span className="status-pill status-pill--neutral">{checks.length}</span>
          </div>
          {!selectedMonitor ? <p className="muted-text">No monitor selected.</p> : null}
          {selectedMonitor && checks.length === 0 ? <p className="muted-text">No checks yet.</p> : null}
          {checks.length > 0 ? (
            <div className="alerts-list">
              {checks.map((check) => (
                <article className="alerts-row" key={check.id}>
                  <div>
                    <strong>{formatTimestamp(check.checkedAt)}</strong>
                    <span>
                      {check.responseStatus ?? "heartbeat"} · {check.latencyMs ?? 0} ms
                    </span>
                    {check.errorMessage ? <span>{check.errorMessage}</span> : null}
                  </div>
                  <span className={statusClass(check.status)}>{check.status}</span>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <section aria-label="Create HTTP monitor" className="alerts-card">
          <h3>Create HTTP monitor</h3>
          <form className="alerts-form" noValidate onSubmit={createHttpMonitor}>
            <label>
              Name
              <input onChange={(event) => setHttpForm((current) => ({ ...current, name: event.target.value }))} required value={httpForm.name} />
            </label>
            <label>
              URL
              <input
                onChange={(event) => setHttpForm((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://api.example.com/health"
                required
                type="url"
                value={httpForm.url}
              />
            </label>
            <div className="alerts-form__columns alerts-form__columns--two">
              <label>
                Check interval (minutes)
                <input min="1" onChange={(event) => setHttpForm((current) => ({ ...current, intervalMinutes: event.target.value }))} required type="number" value={httpForm.intervalMinutes} />
              </label>
              <label>
                Timeout (milliseconds)
                <input min="100" onChange={(event) => setHttpForm((current) => ({ ...current, timeoutMs: event.target.value }))} required type="number" value={httpForm.timeoutMs} />
              </label>
            </div>
            <label>
              Channel
              <select onChange={(event) => setHttpForm((current) => ({ ...current, notificationChannelId: event.target.value }))} value={httpForm.notificationChannelId}>
                <option value="">No channel</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channelLabel(channel)}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={isLoading || isCreatingHttp} type="submit">Create HTTP monitor</button>
          </form>
        </section>

        {editForm ? (
          <section aria-label="Edit monitor" className="alerts-card">
            <div className="alerts-card__header">
              <h3>Edit monitor</h3>
              <span className="status-pill status-pill--neutral">{editForm.kind}</span>
            </div>
            <form className="alerts-form" noValidate onSubmit={saveMonitor}>
              <label>
                Name
                <input onChange={(event) => setEditForm((current) => current ? { ...current, name: event.target.value } : current)} required value={editForm.name} />
              </label>
              {editForm.kind === "http" ? (
                <>
                  <label>
                    URL
                    <input
                      onChange={(event) => setEditForm((current) => current ? { ...current, url: event.target.value } : current)}
                      required
                      type="url"
                      value={editForm.url}
                    />
                  </label>
                  <div className="alerts-form__columns alerts-form__columns--two">
                    <label>
                      Check interval (minutes)
                      <input min="1" onChange={(event) => setEditForm((current) => current ? { ...current, intervalMinutes: event.target.value } : current)} required type="number" value={editForm.intervalMinutes} />
                    </label>
                    <label>
                      Timeout (milliseconds)
                      <input min="100" onChange={(event) => setEditForm((current) => current ? { ...current, timeoutMs: event.target.value } : current)} required type="number" value={editForm.timeoutMs} />
                    </label>
                  </div>
                </>
              ) : (
                <div className="alerts-form__columns alerts-form__columns--two">
                  <label>
                    Expected heartbeat interval (minutes)
                    <input min="1" onChange={(event) => setEditForm((current) => current ? { ...current, expectedIntervalMinutes: event.target.value } : current)} required type="number" value={editForm.expectedIntervalMinutes} />
                  </label>
                  <label>
                    Grace period (minutes)
                    <input min="0" onChange={(event) => setEditForm((current) => current ? { ...current, graceMinutes: event.target.value } : current)} required type="number" value={editForm.graceMinutes} />
                  </label>
                </div>
              )}
              <label>
                Channel
                <select onChange={(event) => setEditForm((current) => current ? { ...current, notificationChannelId: event.target.value } : current)} value={editForm.notificationChannelId}>
                  <option value="">No channel</option>
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channelLabel(channel)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-row">
                <input checked={editForm.enabled} onChange={(event) => setEditForm((current) => current ? { ...current, enabled: event.target.checked } : current)} type="checkbox" />
                Enabled
              </label>
              <div className="form-actions">
                <button disabled={isSavingMonitor} type="submit">Save monitor</button>
                <button className="secondary-button" onClick={() => setEditForm(null)} type="button">Cancel</button>
              </div>
            </form>
          </section>
        ) : null}

        <section aria-label="Create heartbeat monitor" className="alerts-card">
          <h3>Create heartbeat monitor</h3>
          <form className="alerts-form" noValidate onSubmit={createHeartbeatMonitor}>
            <label>
              Name
              <input onChange={(event) => setHeartbeatForm((current) => ({ ...current, name: event.target.value }))} required value={heartbeatForm.name} />
            </label>
            <p className="muted-text">A heartbeat is down when no check-in arrives inside the expected interval plus grace period.</p>
            <div className="alerts-form__columns alerts-form__columns--two">
              <label>
                Expected heartbeat interval (minutes)
                <input min="1" onChange={(event) => setHeartbeatForm((current) => ({ ...current, expectedIntervalMinutes: event.target.value }))} required type="number" value={heartbeatForm.expectedIntervalMinutes} />
              </label>
              <label>
                Grace period (minutes)
                <input min="0" onChange={(event) => setHeartbeatForm((current) => ({ ...current, graceMinutes: event.target.value }))} required type="number" value={heartbeatForm.graceMinutes} />
              </label>
            </div>
            <label>
              Channel
              <select onChange={(event) => setHeartbeatForm((current) => ({ ...current, notificationChannelId: event.target.value }))} value={heartbeatForm.notificationChannelId}>
                <option value="">No channel</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channelLabel(channel)}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={isLoading || isCreatingHeartbeat} type="submit">Create heartbeat monitor</button>
          </form>
        </section>
      </div>
    </section>
  );
}

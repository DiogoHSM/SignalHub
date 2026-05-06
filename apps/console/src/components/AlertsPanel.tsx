import { type FormEvent, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type {
  AlertEventResponse,
  AlertRuleResponse,
  AlertRuleType,
  AlertSeverity,
  NotificationChannelResponse
} from "../api/types";

type AlertsPanelProps = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};

type ChannelForm = {
  name: string;
  url: string;
  secretHeaderName: string;
  secretHeaderValue: string;
};

type RuleForm = {
  name: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  threshold: string;
  windowMinutes: string;
  cooldownMinutes: string;
  notificationChannelId: string;
};

const defaultRuleForm: RuleForm = {
  name: "",
  type: "critical_errors",
  severity: "critical",
  threshold: "1",
  windowMinutes: "10",
  cooldownMinutes: "30",
  notificationChannelId: ""
};

const defaultChannelForm: ChannelForm = {
  name: "",
  url: "",
  secretHeaderName: "",
  secretHeaderValue: ""
};

const ruleTypeLabels: Record<AlertRuleType, string> = {
  critical_errors: "Critical errors",
  error_count: "Error count",
  trace_p95_latency: "Trace p95 latency",
  llm_cost: "LLM cost"
};

function statusClass(status: string | null | undefined): string {
  if (status === "success" || status === "failed") {
    return `status-pill status-pill--${status}`;
  }
  return "status-pill status-pill--neutral";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "No data";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "No data" : timestamp.toLocaleString();
}

function displayDeliveryStatus(status: AlertEventResponse["latestDeliveryStatus"]): string {
  return status ?? "pending";
}

function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isValidThreshold(value: string): boolean {
  const trimmed = value.trim();
  return /^\d+(\.\d{1,6})?$/.test(trimmed) && Number(trimmed) > 0;
}

function validateWebhookUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Webhook URL must be a valid http or https URL";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Webhook URL must be a valid http or https URL";
  }

  if (parsed.username || parsed.password) {
    return "Webhook URL must not include credentials";
  }

  return null;
}

function validateSecretHeaderName(value: string): string | null {
  if (!/^[A-Za-z0-9-]+$/.test(value)) {
    return "Secret header name may only contain letters, numbers, and hyphens";
  }
  if (!/^(x-|signalhub-)/i.test(value)) {
    return "Secret header name must begin with X- or SignalHub-";
  }
  return null;
}

export function AlertsPanel({ client, projectId, environmentId }: AlertsPanelProps) {
  const currentScopeRef = useRef({ projectId, environmentId });
  const [rules, setRules] = useState<AlertRuleResponse[]>([]);
  const [channels, setChannels] = useState<NotificationChannelResponse[]>([]);
  const [events, setEvents] = useState<AlertEventResponse[]>([]);
  const [channelForm, setChannelForm] = useState<ChannelForm>(defaultChannelForm);
  const [ruleForm, setRuleForm] = useState<RuleForm>(defaultRuleForm);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const [error, setError] = useState<string | null>(null);

  currentScopeRef.current = { projectId, environmentId };

  useEffect(() => {
    setChannelForm(defaultChannelForm);
    setRuleForm(defaultRuleForm);
  }, [projectId, environmentId]);

  useEffect(() => {
    if (!projectId || !environmentId) {
      setRules([]);
      setChannels([]);
      setEvents([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void Promise.all([
      client.listAlertRules({ projectId, environmentId }),
      client.listNotificationChannels(),
      client.listAlertEvents({ projectId, environmentId, limit: 20 })
    ])
      .then(([ruleResult, channelResult, eventResult]) => {
        if (cancelled) return;
        setRules(ruleResult.rules);
        setChannels(channelResult.channels);
        setEvents(eventResult.data);
      })
      .catch(() => {
        if (cancelled) return;
        setRules([]);
        setChannels([]);
        setEvents([]);
        setError("Alerts unavailable");
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, projectId, environmentId]);

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLoading) return;
    const name = channelForm.name.trim();
    const url = channelForm.url.trim();
    const secretHeaderName = channelForm.secretHeaderName.trim();
    const secretHeaderValue = channelForm.secretHeaderValue.trim();
    if (!name || !url) {
      setError("Channel name and webhook URL are required");
      return;
    }
    const webhookUrlError = validateWebhookUrl(url);
    if (webhookUrlError) {
      setError(webhookUrlError);
      return;
    }
    if (secretHeaderValue && !secretHeaderName) {
      setError("Secret header name is required when a secret value is set");
      return;
    }
    if (secretHeaderName) {
      const secretHeaderNameError = validateSecretHeaderName(secretHeaderName);
      if (secretHeaderNameError) {
        setError(secretHeaderNameError);
        return;
      }
    }

    setIsCreatingChannel(true);
    setError(null);
    try {
      const { channel } = await client.createNotificationChannel({
        name,
        type: "webhook",
        url,
        secretHeaderName: secretHeaderName || null,
        secretHeaderValue: secretHeaderValue || null,
        enabled: true
      });
      setChannels((current) => [...current, channel]);
      setChannelForm(defaultChannelForm);
    } catch {
      setError("Could not create notification channel");
    } finally {
      setIsCreatingChannel(false);
    }
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !environmentId || isLoading) return;
    const submittedProjectId = projectId;
    const submittedEnvironmentId = environmentId;
    const name = ruleForm.name.trim();
    if (!name) {
      setError("Rule name is required");
      return;
    }
    const windowMinutes = parsePositiveInteger(ruleForm.windowMinutes);
    if (windowMinutes === null) {
      setError("Window must be a whole number of at least 1 minute");
      return;
    }
    if (!isValidThreshold(ruleForm.threshold)) {
      setError("Threshold must be a positive number with up to 6 decimal places");
      return;
    }
    const cooldownMinutes = parsePositiveInteger(ruleForm.cooldownMinutes);
    if (cooldownMinutes === null) {
      setError("Cooldown must be a whole number of at least 1 minute");
      return;
    }

    setIsCreatingRule(true);
    setError(null);
    try {
      const { rule } = await client.createAlertRule({
        projectId: submittedProjectId,
        environmentId: submittedEnvironmentId,
        notificationChannelId: ruleForm.notificationChannelId || null,
        name,
        type: ruleForm.type,
        severity: ruleForm.severity,
        windowMinutes,
        threshold: ruleForm.threshold.trim(),
        cooldownMinutes,
        enabled: true
      });
      if (
        currentScopeRef.current.projectId !== submittedProjectId ||
        currentScopeRef.current.environmentId !== submittedEnvironmentId
      ) {
        return;
      }
      setRules((current) => [...current, rule]);
      setRuleForm((current) => ({ ...defaultRuleForm, notificationChannelId: current.notificationChannelId }));
    } catch {
      if (
        currentScopeRef.current.projectId !== submittedProjectId ||
        currentScopeRef.current.environmentId !== submittedEnvironmentId
      ) {
        return;
      }
      setError("Could not create alert rule");
    } finally {
      setIsCreatingRule(false);
    }
  }

  if (!projectId || !environmentId) {
    return (
      <section className="alerts-panel">
        <header className="alerts-panel__header">
          <div>
            <h2>Alerts</h2>
            <p className="muted-text">Select a project and environment to manage alerts.</p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section className="alerts-panel">
      <header className="alerts-panel__header">
        <div>
          <h2>Alerts</h2>
          <p className="muted-text">Rules, webhooks, and recent delivery state for this environment.</p>
        </div>
      </header>

      {isLoading ? (
        <p className="muted-text" role="status">
          Loading alerts
        </p>
      ) : null}
      {error ? (
        <div className="status-box unavailable" role="alert">
          <strong>{error}</strong>
        </div>
      ) : null}

      <div className="alerts-grid">
        <section aria-label="Alert rules" className="alerts-card">
          <div className="alerts-card__header">
            <h3>Rules</h3>
            <span className="status-pill status-pill--neutral">{rules.length}</span>
          </div>
          {rules.length === 0 ? (
            <p className="muted-text">No alert rules.</p>
          ) : (
            <div className="alerts-list">
              {rules.map((rule) => (
                <article className="alerts-row" key={rule.id}>
                  <div>
                    <strong>{rule.name}</strong>
                    <span>
                      {ruleTypeLabels[rule.type]} · window {rule.windowMinutes}m · threshold {rule.threshold}
                    </span>
                    <span>Last trigger {formatTimestamp(rule.lastTriggeredAt)}</span>
                  </div>
                  <span className={statusClass(rule.enabled ? "success" : "neutral")}>{rule.enabled ? "enabled" : "disabled"}</span>
                </article>
              ))}
            </div>
          )}
        </section>

        <section aria-label="Notification channels" className="alerts-card">
          <div className="alerts-card__header">
            <h3>Channels</h3>
            <span className="status-pill status-pill--neutral">{channels.length}</span>
          </div>
          {channels.length === 0 ? (
            <p className="muted-text">No notification channels.</p>
          ) : (
            <div className="alerts-list">
              {channels.map((channel) => (
                <article className="alerts-row" key={channel.id}>
                  <div>
                    <strong>{channel.name}</strong>
                    <span>{channel.url}</span>
                    <span>{channel.hasSecret ? "Secret saved" : "No secret"}</span>
                  </div>
                  <span className={statusClass(channel.enabled ? "success" : "neutral")}>{channel.enabled ? "enabled" : "disabled"}</span>
                </article>
              ))}
            </div>
          )}
        </section>

        <section aria-label="Recent alert history" className="alerts-card alerts-card--wide">
          <div className="alerts-card__header">
            <h3>Recent alerts</h3>
            <span className="status-pill status-pill--neutral">{events.length}</span>
          </div>
          {events.length === 0 ? (
            <p className="muted-text">No alert events.</p>
          ) : (
            <div className="alerts-list">
              {events.map((alertEvent) => {
                const deliveryStatus = displayDeliveryStatus(alertEvent.latestDeliveryStatus);
                return (
                  <article className="alerts-row alerts-row--history" key={alertEvent.id}>
                    <div>
                      <strong>{alertEvent.message}</strong>
                      <span>
                        Observed {alertEvent.observedValue} over threshold {alertEvent.threshold} · {formatTimestamp(alertEvent.triggeredAt)}
                      </span>
                    </div>
                    <span className={statusClass(alertEvent.latestDeliveryStatus)}>{deliveryStatus}</span>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section aria-label="Create notification channel" className="alerts-card">
          <h3>Create webhook channel</h3>
          <form className="alerts-form" noValidate onSubmit={createChannel}>
            <label>
              Channel name
              <input
                onChange={(event) => setChannelForm((current) => ({ ...current, name: event.target.value }))}
                required
                value={channelForm.name}
              />
            </label>
            <label>
              Webhook URL
              <input
                onChange={(event) => setChannelForm((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://hooks.example.com"
                required
                type="url"
                value={channelForm.url}
              />
            </label>
            <label>
              Secret header name
              <input
                onChange={(event) => setChannelForm((current) => ({ ...current, secretHeaderName: event.target.value }))}
                required={Boolean(channelForm.secretHeaderValue.trim())}
                value={channelForm.secretHeaderName}
              />
            </label>
            <label>
              Secret header value
              <input
                onChange={(event) => setChannelForm((current) => ({ ...current, secretHeaderValue: event.target.value }))}
                type="password"
                value={channelForm.secretHeaderValue}
              />
            </label>
            <button disabled={isLoading || isCreatingChannel} type="submit">
              Create channel
            </button>
          </form>
        </section>

        <section aria-label="Create alert rule" className="alerts-card">
          <h3>Create alert rule</h3>
          <form className="alerts-form" noValidate onSubmit={createRule}>
            <label>
              Rule name
              <input
                onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))}
                required
                value={ruleForm.name}
              />
            </label>
            <label>
              Rule type
              <select
                onChange={(event) => setRuleForm((current) => ({ ...current, type: event.target.value as AlertRuleType }))}
                value={ruleForm.type}
              >
                {Object.entries(ruleTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Severity
              <select
                onChange={(event) => setRuleForm((current) => ({ ...current, severity: event.target.value as AlertSeverity }))}
                value={ruleForm.severity}
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <div className="alerts-form__columns">
              <label>
                Window
                <input
                  min="1"
                  onChange={(event) => setRuleForm((current) => ({ ...current, windowMinutes: event.target.value }))}
                  required
                  step="1"
                  type="number"
                  value={ruleForm.windowMinutes}
                />
              </label>
              <label>
                Threshold
                <input
                  inputMode="decimal"
                  min="0.000001"
                  onChange={(event) => setRuleForm((current) => ({ ...current, threshold: event.target.value }))}
                  pattern="\d+(\.\d{1,6})?"
                  required
                  step="0.000001"
                  type="number"
                  value={ruleForm.threshold}
                />
              </label>
              <label>
                Cooldown
                <input
                  min="1"
                  onChange={(event) => setRuleForm((current) => ({ ...current, cooldownMinutes: event.target.value }))}
                  required
                  step="1"
                  type="number"
                  value={ruleForm.cooldownMinutes}
                />
              </label>
            </div>
            <label>
              Notification channel
              <select
                onChange={(event) => setRuleForm((current) => ({ ...current, notificationChannelId: event.target.value }))}
                value={ruleForm.notificationChannelId}
              >
                <option value="">No channel</option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={isLoading || isCreatingRule} type="submit">
              Create rule
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
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
  type: "webhook" | "email";
  name: string;
  url: string;
  emailRecipients: string;
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
  type: "webhook",
  name: "",
  url: "",
  emailRecipients: "",
  secretHeaderName: "",
  secretHeaderValue: ""
};

const ruleTypeLabels: Record<AlertRuleType, string> = {
  critical_errors: "Critical errors",
  error_count: "Error count",
  error_rate: "Error rate",
  trace_p95_latency: "Trace p95 latency",
  llm_cost: "LLM cost"
};

const thresholdHelpText: Record<AlertRuleType, string> = {
  critical_errors: "Threshold is a count of critical or fatal errors in the window.",
  error_count: "Threshold is a count of errors in the window.",
  error_rate: "Threshold is an error-rate percentage, for example 5 for 5%.",
  trace_p95_latency: "Threshold is trace p95 latency in milliseconds.",
  llm_cost: "Threshold is LLM cost in USD."
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

function channelTarget(channel: NotificationChannelResponse): string {
  return channel.type === "email" ? channel.emailRecipients.join(", ") : channel.url;
}

function channelSecretLabel(channel: NotificationChannelResponse): string {
  return channel.type === "email" ? "SMTP delivery" : channel.hasSecret ? "Secret saved" : "No secret";
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
  if (!/^(x-|sigmon-)/i.test(value)) {
    return "Secret header name must begin with X- or Sigmon-";
  }
  return null;
}

export function AlertsPanel({ client, projectId, environmentId }: AlertsPanelProps) {
  const currentScopeRef = useRef({ projectId, environmentId });
  const channelCreateRequestRef = useRef(0);
  const ruleCreateRequestRef = useRef(0);
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
    channelCreateRequestRef.current += 1;
    ruleCreateRequestRef.current += 1;
    setChannelForm(defaultChannelForm);
    setRuleForm(defaultRuleForm);
    setIsCreatingChannel(false);
    setIsCreatingRule(false);
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
    setRules([]);
    setChannels([]);
    setEvents([]);

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
    const emailRecipients = channelForm.emailRecipients
      .split(",")
      .map((recipient) => recipient.trim())
      .filter(Boolean);
    const secretHeaderName = channelForm.secretHeaderName.trim();
    const secretHeaderValue = channelForm.secretHeaderValue.trim();
    if (!name) {
      setError("Channel name is required");
      return;
    }
    if (channelForm.type === "email") {
      if (emailRecipients.length === 0) {
        setError("At least one email recipient is required");
        return;
      }
    } else {
      if (!url) {
        setError("Webhook URL is required");
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
    }

    const requestId = channelCreateRequestRef.current + 1;
    channelCreateRequestRef.current = requestId;
    setIsCreatingChannel(true);
    setError(null);
    try {
      const { channel } =
        channelForm.type === "email"
          ? await client.createNotificationChannel({
              name,
              type: "email",
              emailRecipients,
              enabled: true
            })
          : await client.createNotificationChannel({
              name,
              type: "webhook",
              url,
              secretHeaderName: secretHeaderName || null,
              secretHeaderValue: secretHeaderValue || null,
              enabled: true
            });
      if (channelCreateRequestRef.current !== requestId) {
        return;
      }
      setChannels((current) => [...current, channel]);
      setChannelForm(defaultChannelForm);
    } catch {
      if (channelCreateRequestRef.current !== requestId) {
        return;
      }
      setError("Could not create notification channel");
    } finally {
      if (channelCreateRequestRef.current === requestId) {
        setIsCreatingChannel(false);
      }
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

    const requestId = ruleCreateRequestRef.current + 1;
    ruleCreateRequestRef.current = requestId;
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
        ruleCreateRequestRef.current !== requestId ||
        currentScopeRef.current.projectId !== submittedProjectId ||
        currentScopeRef.current.environmentId !== submittedEnvironmentId
      ) {
        return;
      }
      setRules((current) => [...current, rule]);
      setRuleForm((current) => ({ ...defaultRuleForm, notificationChannelId: current.notificationChannelId }));
    } catch {
      if (
        ruleCreateRequestRef.current !== requestId ||
        currentScopeRef.current.projectId !== submittedProjectId ||
        currentScopeRef.current.environmentId !== submittedEnvironmentId
      ) {
        return;
      }
      setError("Could not create alert rule");
    } finally {
      if (ruleCreateRequestRef.current === requestId) {
        setIsCreatingRule(false);
      }
    }
  }

  async function archiveRule(rule: AlertRuleResponse) {
    if (!window.confirm(`Archive alert rule ${rule.name}?`)) return;

    setError(null);
    try {
      await client.archiveAlertRule(rule.id);
      setRules((current) => current.filter((currentRule) => currentRule.id !== rule.id));
    } catch {
      setError("Could not archive alert rule");
    }
  }

  async function archiveChannel(channel: NotificationChannelResponse) {
    if (!window.confirm(`Archive notification channel ${channel.name}?`)) return;

    setError(null);
    try {
      await client.archiveNotificationChannel(channel.id);
      setChannels((current) => current.filter((currentChannel) => currentChannel.id !== channel.id));
      setRuleForm((current) =>
        current.notificationChannelId === channel.id ? { ...current, notificationChannelId: "" } : current
      );
    } catch {
      setError("Could not archive notification channel");
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
                  <div className="alerts-row__actions">
                    <span className={statusClass(rule.enabled ? "success" : "neutral")}>{rule.enabled ? "enabled" : "disabled"}</span>
                    <button
                      aria-label={`Archive ${rule.name}`}
                      className="icon-button icon-button--danger"
                      onClick={() => void archiveRule(rule)}
                      title="Archive alert rule"
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
                    <span>{channelTarget(channel)}</span>
                    <span>{channelSecretLabel(channel)}</span>
                  </div>
                  <div className="alerts-row__actions">
                    <span className={statusClass(channel.enabled ? "success" : "neutral")}>{channel.enabled ? "enabled" : "disabled"}</span>
                    <button
                      aria-label={`Archive ${channel.name}`}
                      className="icon-button icon-button--danger"
                      onClick={() => void archiveChannel(channel)}
                      title="Archive notification channel"
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
          <h3>Create notification channel</h3>
          <form className="alerts-form" noValidate onSubmit={createChannel}>
            <label>
              Channel type
              <select
                onChange={(event) =>
                  setChannelForm((current) => ({ ...current, type: event.target.value as ChannelForm["type"] }))
                }
                value={channelForm.type}
              >
                <option value="webhook">Webhook</option>
                <option value="email">Email</option>
              </select>
            </label>
            <label>
              Channel name
              <input
                onChange={(event) => setChannelForm((current) => ({ ...current, name: event.target.value }))}
                required
                value={channelForm.name}
              />
            </label>
            {channelForm.type === "email" ? (
              <label>
                Email recipients
                <input
                  onChange={(event) => setChannelForm((current) => ({ ...current, emailRecipients: event.target.value }))}
                  placeholder="ops@example.com"
                  required
                  value={channelForm.emailRecipients}
                />
              </label>
            ) : (
              <>
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
              </>
            )}
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
            <p className="muted-text">Error-rate thresholds are percentages. Trace p95 latency thresholds are milliseconds.</p>
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
                Window (minutes)
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
                Cooldown (minutes)
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
            <p className="muted-text">{thresholdHelpText[ruleForm.type]}</p>
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

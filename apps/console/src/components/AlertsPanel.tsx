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
  type: "webhook" | "slack" | "discord" | "email";
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
  llm_cost: "LLM cost",
  dead_letter_count: "Dead-letter jobs"
};

const thresholdHelpText: Record<AlertRuleType, string> = {
  critical_errors: "Threshold is a count of critical or fatal errors in the window.",
  error_count: "Threshold is a count of errors in the window.",
  error_rate: "Threshold is an error-rate percentage, for example 5 for 5%.",
  trace_p95_latency: "Threshold is trace p95 latency in milliseconds.",
  llm_cost: "Threshold is LLM cost in USD.",
  dead_letter_count: "Threshold is the current count of pending dead-letter jobs for the environment."
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

function alertToneClass(value: "healthy" | "warning" | "failed" | "neutral"): string {
  return `alert-posture-card alert-posture-card--${value}`;
}

function summarizeAlertPosture(
  rules: AlertRuleResponse[],
  channels: NotificationChannelResponse[],
  events: AlertEventResponse[]
) {
  const enabledRules = rules.filter((rule) => rule.enabled);
  const rulesWithoutChannels = enabledRules.filter((rule) => !rule.notificationChannelId).length;
  const disabledChannels = channels.filter((channel) => !channel.enabled).length;
  const firingNow = events.filter((event) => event.status === "triggered").length;
  const deliveryIssues = events.filter((event) => event.latestDeliveryStatus === "failed").length;
  const criticalEvents = events.filter((event) => event.severity === "critical").length;

  return {
    criticalEvents,
    disabledChannels,
    deliveryIssues,
    enabledRules: enabledRules.length,
    firingNow,
    rulesWithoutChannels
  };
}

function buildAlertSuggestions(summary: ReturnType<typeof summarizeAlertPosture>): Array<{ title: string; body: string }> {
  const suggestions: Array<{ title: string; body: string }> = [];

  if (summary.rulesWithoutChannels > 0) {
    suggestions.push({
      title: "Attach channels to enabled rules",
      body: `${summary.rulesWithoutChannels} enabled ${summary.rulesWithoutChannels === 1 ? "rule has" : "rules have"} no notification channel.`
    });
  }

  if (summary.deliveryIssues > 0) {
    suggestions.push({
      title: "Review failed deliveries",
      body: `${summary.deliveryIssues} recent ${summary.deliveryIssues === 1 ? "alert delivery failed" : "alert deliveries failed"}.`
    });
  }

  if (summary.enabledRules === 0) {
    suggestions.push({
      title: "Create the first alert rule",
      body: "Start with error rate or trace p95 so production regressions page you before users do."
    });
  }

  if (summary.disabledChannels > 0) {
    suggestions.push({
      title: "Re-enable paused channels",
      body: `${summary.disabledChannels} notification ${summary.disabledChannels === 1 ? "channel is" : "channels are"} disabled.`
    });
  }

  return suggestions;
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
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [isUpdatingChannel, setIsUpdatingChannel] = useState(false);
  const [isCreatingRule, setIsCreatingRule] = useState(false);
  const [isUpdatingRule, setIsUpdatingRule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alertSummary = summarizeAlertPosture(rules, channels, events);
  const alertSuggestions = buildAlertSuggestions(alertSummary);
  const heatEvents = events.slice(0, 16);

  currentScopeRef.current = { projectId, environmentId };

  useEffect(() => {
    channelCreateRequestRef.current += 1;
    ruleCreateRequestRef.current += 1;
    setChannelForm(defaultChannelForm);
    setRuleForm(defaultRuleForm);
    setEditingRuleId(null);
    setEditingChannelId(null);
    setIsCreatingChannel(false);
    setIsUpdatingChannel(false);
    setIsCreatingRule(false);
    setIsUpdatingRule(false);
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

  async function saveChannel(event: FormEvent<HTMLFormElement>) {
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
    if (editingChannelId) {
      setIsUpdatingChannel(true);
    } else {
      setIsCreatingChannel(true);
    }
    setError(null);
    try {
      const { channel } = editingChannelId
        ? channelForm.type === "email"
          ? await client.updateNotificationChannel(editingChannelId, {
              name,
              type: "email",
              emailRecipients,
              enabled: true
            })
          : await client.updateNotificationChannel(editingChannelId, {
              name,
              type: channelForm.type,
              url,
              secretHeaderName: secretHeaderName || null,
              ...(secretHeaderValue ? { secretHeaderValue } : {}),
              enabled: true
            })
        : channelForm.type === "email"
          ? await client.createNotificationChannel({
              name,
              type: "email",
              emailRecipients,
              enabled: true
            })
          : await client.createNotificationChannel({
              name,
              type: channelForm.type,
              url,
              secretHeaderName: secretHeaderName || null,
              secretHeaderValue: secretHeaderValue || null,
              enabled: true
            });
      if (channelCreateRequestRef.current !== requestId) {
        return;
      }
      setChannels((current) =>
        editingChannelId
          ? current.map((currentChannel) => (currentChannel.id === channel.id ? channel : currentChannel))
          : [...current, channel]
      );
      setEditingChannelId(null);
      setChannelForm(defaultChannelForm);
    } catch {
      if (channelCreateRequestRef.current !== requestId) {
        return;
      }
      setError(editingChannelId ? "Could not update notification channel" : "Could not create notification channel");
    } finally {
      if (channelCreateRequestRef.current === requestId) {
        setIsCreatingChannel(false);
        setIsUpdatingChannel(false);
      }
    }
  }

  function editChannel(channel: NotificationChannelResponse) {
    setEditingChannelId(channel.id);
    setError(null);
    setChannelForm({
      type: channel.type,
      name: channel.name,
      url: channel.type === "email" ? "" : channel.url,
      emailRecipients: channel.type === "email" ? channel.emailRecipients.join(", ") : "",
      secretHeaderName: channel.type === "email" ? "" : (channel.secretHeaderName ?? ""),
      secretHeaderValue: ""
    });
  }

  function cancelChannelEdit() {
    setEditingChannelId(null);
    setChannelForm(defaultChannelForm);
    setError(null);
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
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
    if (editingRuleId) {
      setIsUpdatingRule(true);
    } else {
      setIsCreatingRule(true);
    }
    setError(null);
    try {
      const input = {
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
      };
      const { rule } = editingRuleId
        ? await client.updateAlertRule(editingRuleId, input)
        : await client.createAlertRule(input);
      if (
        ruleCreateRequestRef.current !== requestId ||
        currentScopeRef.current.projectId !== submittedProjectId ||
        currentScopeRef.current.environmentId !== submittedEnvironmentId
      ) {
        return;
      }
      setRules((current) =>
        editingRuleId ? current.map((currentRule) => (currentRule.id === rule.id ? rule : currentRule)) : [...current, rule]
      );
      setEditingRuleId(null);
      setRuleForm((current) => ({ ...defaultRuleForm, notificationChannelId: current.notificationChannelId }));
    } catch {
      if (
        ruleCreateRequestRef.current !== requestId ||
        currentScopeRef.current.projectId !== submittedProjectId ||
        currentScopeRef.current.environmentId !== submittedEnvironmentId
      ) {
        return;
      }
      setError(editingRuleId ? "Could not update alert rule" : "Could not create alert rule");
    } finally {
      if (ruleCreateRequestRef.current === requestId) {
        setIsCreatingRule(false);
        setIsUpdatingRule(false);
      }
    }
  }

  function editRule(rule: AlertRuleResponse) {
    setEditingRuleId(rule.id);
    setError(null);
    setRuleForm({
      name: rule.name,
      type: rule.type,
      severity: rule.severity,
      threshold: rule.threshold,
      windowMinutes: String(rule.windowMinutes),
      cooldownMinutes: String(rule.cooldownMinutes),
      notificationChannelId: rule.notificationChannelId ?? ""
    });
  }

  function cancelRuleEdit() {
    setEditingRuleId(null);
    setRuleForm(defaultRuleForm);
    setError(null);
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

      <section aria-label="Alert posture" className="alert-posture">
        <div className="alert-posture__metrics">
          <div className={alertToneClass(alertSummary.firingNow > 0 ? "failed" : "healthy")}>
            <span>Firing now</span>
            <strong>{alertSummary.firingNow}</strong>
            <small>{alertSummary.criticalEvents} critical</small>
          </div>
          <div className={alertToneClass(alertSummary.deliveryIssues > 0 ? "warning" : "healthy")}>
            <span>Delivery issues</span>
            <strong>{alertSummary.deliveryIssues}</strong>
            <small>recent failures</small>
          </div>
          <div className={alertToneClass(alertSummary.rulesWithoutChannels > 0 ? "warning" : "healthy")}>
            <span>Rules without channels</span>
            <strong>{alertSummary.rulesWithoutChannels}</strong>
            <small>{alertSummary.enabledRules} enabled rules</small>
          </div>
          <div className={alertToneClass(alertSuggestions.length > 0 ? "neutral" : "healthy")}>
            <span>Suggested fixes</span>
            <strong>{alertSuggestions.length}</strong>
            <small>{channels.length} channels configured</small>
          </div>
        </div>
        <div className="alert-posture__side">
          <section aria-label="Alert history heat strip" className="alert-heat-strip">
            {heatEvents.length === 0 ? (
              <span className="alert-heat-strip__empty">No recent alert activity</span>
            ) : (
              heatEvents.map((event) => (
                <span
                  aria-label={`${event.severity} alert ${displayDeliveryStatus(event.latestDeliveryStatus)} at ${formatTimestamp(event.triggeredAt)}`}
                  className={`alert-heat-strip__cell alert-heat-strip__cell--${event.latestDeliveryStatus === "failed" ? "failed" : event.severity}`}
                  key={event.id}
                  title={`${event.message} - ${formatTimestamp(event.triggeredAt)}`}
                />
              ))
            )}
          </section>
          <section aria-label="Alert suggestions" className="alert-suggestions">
            {alertSuggestions.length === 0 ? (
              <p>No alert configuration gaps detected.</p>
            ) : (
              alertSuggestions.map((suggestion) => (
                <article key={suggestion.title}>
                  <strong>{suggestion.title}</strong>
                  <span>{suggestion.body}</span>
                </article>
              ))
            )}
          </section>
        </div>
      </section>

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
                    <button className="secondary-button" aria-label={`Edit ${rule.name}`} onClick={() => editRule(rule)} type="button">
                      Edit
                    </button>
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
                    <button className="secondary-button" aria-label={`Edit ${channel.name}`} onClick={() => editChannel(channel)} type="button">
                      Edit
                    </button>
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

        <section aria-label={editingChannelId ? "Edit notification channel" : "Create notification channel"} className="alerts-card">
          <div className="alerts-card__header">
            <h3>{editingChannelId ? "Edit notification channel" : "Create notification channel"}</h3>
            {editingChannelId ? (
              <button className="secondary-button" onClick={cancelChannelEdit} type="button">
                Cancel
              </button>
            ) : null}
          </div>
          <form className="alerts-form" noValidate onSubmit={saveChannel}>
            <label>
              Channel type
              <select
                onChange={(event) =>
                  setChannelForm((current) => ({ ...current, type: event.target.value as ChannelForm["type"] }))
                }
                value={channelForm.type}
              >
                <option value="webhook">Webhook</option>
                <option value="slack">Slack</option>
                <option value="discord">Discord</option>
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
                  {channelForm.type === "slack"
                    ? "Slack Incoming Webhook URL"
                    : channelForm.type === "discord"
                      ? "Discord Webhook URL"
                      : "Webhook URL"}
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
            <button disabled={isLoading || isCreatingChannel || isUpdatingChannel} type="submit">
              {editingChannelId ? (isUpdatingChannel ? "Saving channel" : "Save channel") : "Create channel"}
            </button>
          </form>
        </section>

        <section aria-label={editingRuleId ? "Edit alert rule" : "Create alert rule"} className="alerts-card">
          <div className="alerts-card__header">
            <h3>{editingRuleId ? "Edit alert rule" : "Create alert rule"}</h3>
            {editingRuleId ? (
              <button className="secondary-button" onClick={cancelRuleEdit} type="button">
                Cancel
              </button>
            ) : null}
          </div>
          <form className="alerts-form" noValidate onSubmit={saveRule}>
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
            <p className="muted-text">
              Error-rate thresholds are percentages, trace p95 thresholds are milliseconds, and dead-letter thresholds are pending job counts.
            </p>
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
            <button disabled={isLoading || isCreatingRule || isUpdatingRule} type="submit">
              {editingRuleId ? (isUpdatingRule ? "Saving rule" : "Save rule") : "Create rule"}
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}

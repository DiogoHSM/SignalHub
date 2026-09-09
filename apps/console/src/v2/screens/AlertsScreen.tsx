import { useState } from "react";
import { ConfirmButton, EmptyHint, Icon, PageHead, Segmented } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useAlerts } from "./useAlerts";
import type {
  AlertEventRowVM,
  AlertRuleRowVM,
  ChannelRowVM,
  CreateRuleForm,
  SuggestionRowVM,
  TimelineDayVM,
} from "./useAlerts";
import type {
  AlertRuleResponse,
  CreateNotificationChannelInput,
  UpdateNotificationChannelInput,
} from "../../api/types";

const RULE_GRID = "1.4fr 90px 84px 1fr 1fr 70px 84px";
const FILTERS = ["All", "Active", "Paused"] as const;
type RuleFilter = (typeof FILTERS)[number];

// ---------------------------------------------------------------------------
// FiresTimeline
// ---------------------------------------------------------------------------

function FiresTimeline({ timeline }: { timeline: TimelineDayVM[] }) {
  const total = timeline.reduce((n, d) => n + d.fires.length, 0);
  if (total === 0) {
    return (
      <p className="sh-faint" style={{ fontSize: 12, margin: 0 }}>
        No fires in the last 7 days
      </p>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
      {timeline.map((day) => (
        <div key={day.label}>
          <div className="sh-faint sh-mono" style={{ fontSize: 10, marginBottom: 6 }}>
            {day.label}
          </div>
          <div
            style={{
              position: "relative",
              height: 60,
              background: "var(--bg-canvas)",
              borderRadius: 5,
              border: "1px solid var(--border-subtle)",
              overflow: "hidden",
            }}
          >
            {[6, 12, 18].map((h) => (
              <span
                key={h}
                style={{
                  position: "absolute",
                  left: `${(h / 24) * 100}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: "var(--border-subtle)",
                }}
              />
            ))}
            {day.fires.map((f, j) => (
              <span
                key={j}
                style={{
                  position: "absolute",
                  left: `${f.hourFraction * 100}%`,
                  top: 4,
                  bottom: 4,
                  width: 3,
                  borderRadius: 1,
                  background: f.tone === "critical" ? "var(--sev-critical)" : "var(--sev-warning)",
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestions card
// ---------------------------------------------------------------------------

function SuggestionRow({
  row,
  onCreateFromSuggestion,
}: {
  row: SuggestionRowVM;
  onCreateFromSuggestion: (row: SuggestionRowVM) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{row.title}</div>
        <div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>{row.sub}</div>
      </div>
      <button
        className="sh-btn primary"
        style={{ fontSize: 11, padding: "3px 10px" }}
        onClick={() => onCreateFromSuggestion(row)}
      >
        Create
      </button>
    </div>
  );
}

function SuggestionsCard({
  suggestions,
  onCreateFromSuggestion,
}: {
  suggestions: SuggestionRowVM[];
  onCreateFromSuggestion: (row: SuggestionRowVM) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">
          Suggestions
          <span
            className="sh-tag"
            style={{
              marginLeft: 8,
              background: "var(--violet-bg-subtle, #3b2f6e)",
              color: "var(--violet, #a78bfa)",
              borderColor: "transparent",
              fontSize: 9,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              verticalAlign: "middle",
            }}
          >
            AI
          </span>
        </h2>
      </div>
      <div className="sh-card__body flush">
        {suggestions.map((s) => (
          <SuggestionRow key={s.key} row={s} onCreateFromSuggestion={onCreateFromSuggestion} />
        ))}
        <p
          className="sh-faint"
          style={{ fontSize: 10.5, margin: "8px 16px 10px", lineHeight: 1.4 }}
        >
          Rules created without a channel still evaluate and record events. Attach a channel to
          enable delivery.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule editor panel (create + inline edit)
// ---------------------------------------------------------------------------

type RuleEditorMode = "create" | { id: string; initial: CreateRuleForm };

type RuleEditorProps = {
  mode: RuleEditorMode;
  channels: ChannelRowVM[];
  onSave: (form: CreateRuleForm) => void;
  onCancel: () => void;
  busy: boolean;
};

const RULE_TYPE_OPTIONS: AlertRuleResponse["type"][] = [
  "critical_errors",
  "error_count",
  "error_rate",
  "trace_p95_latency",
  "llm_cost",
  "dead_letter_count",
];

const ROUTE_PATTERN_TYPES = new Set<AlertRuleResponse["type"]>(["error_count", "error_rate", "trace_p95_latency"]);

function RuleEditor({ mode, channels, onSave, onCancel, busy }: RuleEditorProps) {
  const initial: CreateRuleForm =
    mode === "create"
      ? {
          name: "",
          type: "critical_errors",
          severity: "warning",
          windowMinutes: 15,
          threshold: "1",
          cooldownMinutes: 60,
          escalationMinutes: null,
          routePattern: null,
          minimumSampleSize: undefined,
          notificationChannelId: null,
          escalationChannelId: null,
        }
      : mode.initial;

  const [form, setForm] = useState<CreateRuleForm>(initial);

  function set<K extends keyof CreateRuleForm>(key: K, value: CreateRuleForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const thresholdValid = /^\d+(\.\d{1,6})?$/.test(form.threshold) && Number(form.threshold) > 0;
  const escalationValid =
    form.escalationMinutes == null ||
    (Number.isInteger(form.escalationMinutes) &&
      form.escalationMinutes > 0 &&
      Boolean(form.escalationChannelId || form.notificationChannelId));

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">{mode === "create" ? "New rule" : "Edit rule"}</h2>
        <button className="sh-btn ghost" style={{ padding: "4px 8px" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 12, padding: 16 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Name</span>
          <input
            className="sh-input"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Rule name"
          />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Type</span>
            <select
              className="sh-select"
              value={form.type}
              onChange={(e) => set("type", e.target.value as AlertRuleResponse["type"])}
            >
              {RULE_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Severity</span>
            <select
              className="sh-select"
              value={form.severity}
              onChange={(e) => set("severity", e.target.value as CreateRuleForm["severity"])}
            >
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </select>
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Window (min)</span>
            <input
              className="sh-input sh-mono"
              type="number"
              min={1}
              value={form.windowMinutes}
              onChange={(e) => set("windowMinutes", Number(e.target.value))}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Threshold</span>
            <input
              className="sh-input sh-mono"
              value={form.threshold}
              onChange={(e) => set("threshold", e.target.value)}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Cooldown (min)</span>
            <input
              className="sh-input sh-mono"
              type="number"
              min={1}
              value={form.cooldownMinutes}
              onChange={(e) => set("cooldownMinutes", Number(e.target.value))}
            />
          </label>
        </div>
        {ROUTE_PATTERN_TYPES.has(form.type) && (
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Route pattern</span>
            <input
              className="sh-input sh-mono"
              value={form.routePattern ?? ""}
              onChange={(e) => set("routePattern", e.target.value || null)}
              placeholder="GET /api/v1/endpoint (optional)"
            />
          </label>
        )}
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Primary notification channel</span>
          <select
            className="sh-select"
            value={form.notificationChannelId ?? ""}
            onChange={(e) => set("notificationChannelId", e.target.value || null)}
          >
            <option value="">None</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Escalate after (min)</span>
            <input
              className="sh-input sh-mono"
              type="number"
              min={1}
              value={form.escalationMinutes ?? ""}
              onChange={(e) => set("escalationMinutes", e.target.value ? Number(e.target.value) : null)}
              placeholder="off"
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Escalation channel</span>
            <select
              className="sh-select"
              value={form.escalationChannelId ?? ""}
              onChange={(e) => set("escalationChannelId", e.target.value || null)}
            >
              <option value="">Use primary channel</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="sh-faint" style={{ fontSize: 11, lineHeight: 1.4, margin: 0 }}>
          Escalation sends one additional notification if the alert is still triggered after the delay.
          Acknowledged, resolved, and snoozed alerts do not escalate.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="sh-btn primary"
            disabled={!form.name.trim() || !thresholdValid || !escalationValid || busy}
            onClick={() => onSave(form)}
          >
            {mode === "create" ? "Create rule" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AlertRuleRow
// ---------------------------------------------------------------------------

type AlertRuleRowProps = {
  row: AlertRuleRowVM;
  channels: ChannelRowVM[];
  onPauseResume: (id: string, enabled: boolean) => void;
  onArchive: (id: string) => void;
  onEditOpen: (row: AlertRuleRowVM) => void;
  busy: boolean;
};

function AlertRuleRow({ row, onPauseResume, onArchive, onEditOpen, busy }: AlertRuleRowProps) {
  return (
    <div className="sh-row alert-row" style={{ gridTemplateColumns: RULE_GRID }}>
      <div>
        <strong style={{ fontSize: 12.5 }}>{row.name}</strong>
        <div className="sh-faint sh-mono" style={{ fontSize: 11 }}>
          {row.subLabel}
        </div>
      </div>
      <span
        className={`sh-tag ${row.severityTag}`}
        style={{ textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}
      >
        {row.severity}
      </span>
      <span>
        <span
          className="sh-tag"
          style={{
            background: row.enabled ? "var(--accent-bg-subtle)" : "var(--bg-surface-3)",
            color: row.enabled ? "var(--accent)" : "var(--fg-muted)",
            borderColor: "transparent",
          }}
        >
          {row.enabled ? "● active" : "paused"}
        </span>
      </span>
      <span style={{ fontSize: 12 }}>{row.channelLabel}</span>
      <span style={{ fontSize: 12, color: row.escalationLabel === "No escalation" ? "var(--fg-muted)" : "var(--fg)" }}>
        {row.escalationLabel}
      </span>
      <span
        className="sh-mono"
        style={{
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          color: row.fires7d > 0 ? "var(--sev-critical)" : "var(--fg-muted)",
        }}
      >
        {row.fires7d}
      </span>
      <div className="alert-row__actions" style={{ display: "flex", gap: 4 }}>
        <button
          className="sh-iconbtn-sm"
          title="Edit rule"
          disabled={busy}
          onClick={() => onEditOpen(row)}
        >
          <Icon name="edit" size={13} />
        </button>
        <button
          className="sh-iconbtn-sm"
          title={row.enabled ? "Pause" : "Resume"}
          disabled={busy}
          onClick={() => onPauseResume(row.id, !row.enabled)}
        >
          <Icon name={row.enabled ? "clock" : "play"} size={13} />
        </button>
        <ConfirmButton
          label={<Icon name="archive" size={13} />}
          confirmLabel="Confirm"
          onConfirm={() => onArchive(row.id)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChannelRow — Test button is a disabled affordance (test-send deferred to PER-364)
// ---------------------------------------------------------------------------

type ChannelRowProps = {
  row: ChannelRowVM;
  onEdit: (row: ChannelRowVM) => void;
  onArchive: (id: string) => void;
  busy: boolean;
};

function ChannelRow({ row, onEdit, onArchive, busy }: ChannelRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 16px",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <span style={{ color: row.ok ? "var(--accent)" : "var(--sev-warning)" }}>
        <Icon name={row.icon} size={16} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5 }}>{row.name}</div>
        <div
          className="sh-faint sh-mono"
          style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {row.target}
        </div>
      </div>
      <button
        className="sh-tag mono"
        disabled
        title="Test send coming soon"
      >
        test
      </button>
      <button
        className="sh-btn ghost"
        style={{ padding: "4px 8px" }}
        aria-label="Edit channel"
        disabled={busy}
        onClick={() => onEdit(row)}
      >
        <Icon name="edit" size={12} />
      </button>
      <ConfirmButton
        label={<Icon name="archive" size={12} />}
        confirmLabel="Archive"
        onConfirm={() => onArchive(row.id)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channel editor panel (create + edit)
// ---------------------------------------------------------------------------

type ChannelEditorProps = {
  // When set, the form edits this existing channel instead of creating a new one.
  editing?: ChannelRowVM | null;
  onCreate: (input: CreateNotificationChannelInput) => void;
  onUpdate: (id: string, input: UpdateNotificationChannelInput) => void;
  onCancel: () => void;
  busy: boolean;
};

type ChannelType = "webhook" | "slack" | "discord" | "email";

const WEBHOOK_LIKE_CHANNEL_TYPES: Array<Exclude<ChannelType, "email">> = ["webhook", "slack", "discord"];

const CHANNEL_URL_HELP: Record<Exclude<ChannelType, "email">, { label: string; placeholder: string; help: string }> = {
  webhook: {
    label: "Webhook URL",
    placeholder: "https://example.com/hooks/sigmon",
    help: "Generic HTTP endpoint that receives a POST with the alert JSON payload.",
  },
  slack: {
    label: "Slack Incoming Webhook URL",
    placeholder: "https://hooks.slack.com/services/...",
    help: "Create an Incoming Webhook in your Slack app settings and paste its URL here.",
  },
  discord: {
    label: "Discord Webhook URL",
    placeholder: "https://discord.com/api/webhooks/...",
    help: "Create a webhook under the target channel's Integrations settings and paste its URL here.",
  },
};

const CHANNEL_NAME_PLACEHOLDER: Record<ChannelType, string> = {
  webhook: "Ops webhook",
  slack: "Slack #incidents",
  discord: "Discord #alerts",
  email: "Ops email",
};

function ChannelEditor({ editing, onCreate, onUpdate, onCancel, busy }: ChannelEditorProps) {
  const isEditing = editing != null;
  const [channelType, setChannelType] = useState<ChannelType>(editing?.type ?? "webhook");
  const [name, setName] = useState(editing?.name ?? "");
  // The full url is only ever known here for a generic webhook channel being
  // edited (it's the only type the API returns unredacted). For slack/discord
  // this always starts blank — the saved url is write-only, mirroring secretHeaderValue.
  const [url, setUrl] = useState(editing?.type === "webhook" ? (editing.url ?? "") : "");
  const [secretHeaderName, setSecretHeaderName] = useState(editing?.secretHeaderName ?? "");
  const [secretHeaderValue, setSecretHeaderValue] = useState("");
  const [emailRecipients, setEmailRecipients] = useState(
    editing?.type === "email" ? editing.emailRecipients.join(", ") : "",
  );

  const isMaskedUrlChannel = channelType === "slack" || channelType === "discord";
  const maskedUrlPlaceholder =
    isEditing && isMaskedUrlChannel
      ? `${editing.urlPreview ?? "••••"} — leave blank to keep`
      : undefined;

  function handleSave() {
    if (channelType === "email") {
      const recipients = emailRecipients.split(",").map((e) => e.trim()).filter(Boolean);
      if (isEditing) {
        onUpdate(editing.id, { name, emailRecipients: recipients });
      } else {
        onCreate({ type: "email", name, emailRecipients: recipients });
      }
      return;
    }

    if (isEditing) {
      const input: UpdateNotificationChannelInput = { name };
      if (url.trim()) input.url = url.trim();
      if (secretHeaderValue.trim()) {
        input.secretHeaderName = secretHeaderName.trim() || null;
        input.secretHeaderValue = secretHeaderValue.trim();
      }
      onUpdate(editing.id, input);
      return;
    }

    onCreate({
      type: channelType,
      name,
      url,
      secretHeaderName: secretHeaderName || null,
      secretHeaderValue: secretHeaderValue || null,
    });
  }

  const valid =
    name.trim().length > 0 &&
    (channelType === "email"
      ? emailRecipients.trim().length > 0
      : isEditing
        ? true // an existing channel already has a url; a blank field means "keep it"
        : url.trim().length > 0);

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">{isEditing ? "Edit channel" : "New channel"}</h2>
        <button className="sh-btn ghost" style={{ padding: "4px 8px" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 12, padding: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Segmented
            options={[...WEBHOOK_LIKE_CHANNEL_TYPES, "email"]}
            value={channelType}
            onChange={isEditing ? undefined : (v) => setChannelType(v as ChannelType)}
          />
        </div>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Name</span>
          <input
            className="sh-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={CHANNEL_NAME_PLACEHOLDER[channelType]}
          />
        </label>
        {channelType === "email" ? (
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Recipients (comma-separated)</span>
            <input className="sh-input sh-mono" value={emailRecipients} onChange={(e) => setEmailRecipients(e.target.value)} placeholder="ops@example.com, sre@example.com" />
          </label>
        ) : (
          <>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="sh-eyebrow">{CHANNEL_URL_HELP[channelType].label}</span>
              <input
                className="sh-input sh-mono"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={maskedUrlPlaceholder ?? CHANNEL_URL_HELP[channelType].placeholder}
              />
              <span className="sh-faint" style={{ fontSize: 10.5, lineHeight: 1.4 }}>
                {isEditing && isMaskedUrlChannel
                  ? "The saved webhook URL is write-only and never shown again. Leave this blank to keep the current one."
                  : CHANNEL_URL_HELP[channelType].help}
              </span>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="sh-eyebrow">Secret header name (optional)</span>
              <input className="sh-input sh-mono" value={secretHeaderName} onChange={(e) => setSecretHeaderName(e.target.value)} placeholder="X-Sigmon-Secret" />
            </label>
            {(secretHeaderName || (isEditing && editing.hasSecret)) && (
              <label style={{ display: "grid", gap: 4 }}>
                <span className="sh-eyebrow">Secret header value</span>
                <input
                  className="sh-input sh-mono"
                  type="password"
                  value={secretHeaderValue}
                  onChange={(e) => setSecretHeaderValue(e.target.value)}
                  placeholder={isEditing && editing.hasSecret ? "•••• configured — leave blank to keep" : undefined}
                />
              </label>
            )}
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="sh-btn primary" disabled={!valid || busy} onClick={handleSave}>
            {isEditing ? "Save channel" : "Create channel"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// On-call queue
// ---------------------------------------------------------------------------

type OnCallQueueProps = {
  events: AlertEventRowVM[];
  busy: boolean;
  onTriage: (
    id: string,
    input: { status: AlertEventRowVM["status"]; snoozedUntil?: string | null; note?: string | null }
  ) => void;
};

function statusTone(status: AlertEventRowVM["status"]): "critical" | "warn" | "" {
  if (status === "triggered") return "critical";
  if (status === "snoozed") return "warn";
  return "";
}

function QueueRow({
  event,
  busy,
  onTriage,
}: {
  event: AlertEventRowVM;
  busy: boolean;
  onTriage: OnCallQueueProps["onTriage"];
}) {
  const [note, setNote] = useState("");
  const done = event.status === "resolved";

  function triage(input: { status: AlertEventRowVM["status"]; snoozedUntil?: string | null }) {
    const trimmed = note.trim();
    setNote("");
    onTriage(event.id, { ...input, note: trimmed ? trimmed : undefined });
  }

  return (
    <div
      className="sh-row"
      style={{
        gridTemplateColumns: "1.4fr 92px 110px 1fr 150px 280px",
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <strong style={{ fontSize: 12.5 }}>{event.message}</strong>
        <div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>
          {event.sourceLabel} · {event.triggeredAtLabel}
        </div>
      </div>
      <span className={`sh-tag ${statusTone(event.status)}`}>{event.status}</span>
      <span className={`sh-tag ${event.severity === "critical" ? "critical" : event.severity === "warning" ? "warn" : ""}`}>
        {event.severity}
      </span>
      <span className="sh-faint" style={{ fontSize: 12 }}>
        {event.deliveryLabel} · {event.escalationLabel}
      </span>
      <span className="sh-mono" style={{ fontSize: 12 }}>
        {event.observedLabel}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        <input
          className="sh-input"
          aria-label={`Note for ${event.message}`}
          placeholder="Note (optional)"
          value={note}
          disabled={busy || done}
          onChange={(e) => setNote(e.target.value)}
          style={{ fontSize: 11.5, padding: "4px 8px", width: "100%" }}
        />
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button
            className="sh-btn ghost"
            style={{ padding: "5px 9px", fontSize: 12 }}
            disabled={busy || done}
            onClick={() => triage({ status: "acknowledged" })}
          >
            Ack
          </button>
          <button
            className="sh-btn ghost"
            style={{ padding: "5px 9px", fontSize: 12 }}
            disabled={busy || done}
            onClick={() =>
              triage({ status: "snoozed", snoozedUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString() })
            }
          >
            Snooze 30m
          </button>
          <button
            className="sh-btn primary"
            style={{ padding: "5px 9px", fontSize: 12 }}
            disabled={busy || done}
            onClick={() => triage({ status: "resolved" })}
          >
            Resolve
          </button>
        </div>
      </div>
    </div>
  );
}

function OnCallQueue({ events, busy, onTriage }: OnCallQueueProps) {
  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">On-call queue</h2>
        <span className="sh-faint" style={{ fontSize: 11 }}>
          ack, snooze, resolve
        </span>
      </div>
      <div className="sh-card__body flush">
        {events.length === 0 ? (
          <EmptyHint icon="bell" title="No alert events" sub="No alert activity in the selected window." />
        ) : (
          events.map((event) => (
            <QueueRow key={event.id} event={event} busy={busy} onTriage={onTriage} />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AlertsScreen
// ---------------------------------------------------------------------------

export function AlertsScreen({ ctx }: { ctx: ScreenCtx }) {
  const [filter, setFilter] = useState<RuleFilter>("All");
  const [ruleEditor, setRuleEditor] = useState<"closed" | "create" | { id: string; initial: CreateRuleForm }>("closed");
  const [channelEditor, setChannelEditor] = useState<"closed" | "create" | { channel: ChannelRowVM }>("closed");

  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;

  const {
    data,
    status,
    reload,
    busy,
    createRule,
    updateRule,
    archiveRule,
    updateAlertEventTriage,
    createChannel,
    updateChannel,
    archiveChannel,
    createFromSuggestion,
  } = useAlerts({ client: ctx.client, projectId, environmentId });

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="bell"
          title="No project selected"
          sub="Select a project and environment to view alerts."
        />
      </div>
    );
  }

  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="bell" title="Loading…" sub="Fetching alert rules and history." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="alert" title="Could not load alerts" sub="Retry to load rules, notification channels, and recent alerts." cta={<button className="sh-btn" onClick={reload}>Retry alert rules</button>} />
      </div>
    );
  }

  const { header, rules, events, channels, timeline, suggestions } = data;
  const shownRules = rules.filter((r) =>
    filter === "All" ? true : filter === "Active" ? r.enabled : !r.enabled,
  );

  async function handleCreateRule(form: CreateRuleForm) {
    const ok = await createRule(form);
    if (ok) {
      setRuleEditor("closed");
      ctx.pushToast("Rule created");
    } else {
      ctx.pushToast("Failed to create rule");
    }
  }

  async function handleUpdateRule(id: string, form: CreateRuleForm) {
    const ok = await updateRule(id, {
      name: form.name,
      type: form.type,
      severity: form.severity,
      windowMinutes: form.windowMinutes,
      threshold: form.threshold,
      cooldownMinutes: form.cooldownMinutes,
      escalationMinutes: form.escalationMinutes,
      routePattern: form.routePattern,
      minimumSampleSize: form.minimumSampleSize,
      notificationChannelId: form.notificationChannelId,
      escalationChannelId: form.escalationChannelId,
    });
    if (ok) {
      setRuleEditor("closed");
      ctx.pushToast("Rule saved");
    } else {
      ctx.pushToast("Failed to save rule");
    }
  }

  async function handlePauseResume(id: string, enabled: boolean) {
    const ok = await updateRule(id, { enabled });
    if (!ok) ctx.pushToast(`Failed to ${enabled ? "resume" : "pause"} rule`);
  }

  async function handleArchiveRule(id: string) {
    const ok = await archiveRule(id);
    if (!ok) ctx.pushToast("Failed to archive rule");
  }

  async function handleAlertTriage(
    id: string,
    input: { status: AlertEventRowVM["status"]; snoozedUntil?: string | null; note?: string | null }
  ) {
    const ok = await updateAlertEventTriage(id, input);
    if (ok) {
      ctx.pushToast(`Alert ${input.status}`);
    } else {
      ctx.pushToast("Failed to update alert");
    }
  }

  async function handleCreateChannel(input: Parameters<typeof createChannel>[0]) {
    const ok = await createChannel(input);
    if (ok) {
      setChannelEditor("closed");
      ctx.pushToast("Channel created");
    } else {
      ctx.pushToast("Failed to create channel");
    }
  }

  async function handleUpdateChannel(id: string, input: Parameters<typeof updateChannel>[1]) {
    const ok = await updateChannel(id, input);
    if (ok) {
      setChannelEditor("closed");
      ctx.pushToast("Channel saved");
    } else {
      ctx.pushToast("Failed to save channel");
    }
  }

  async function handleArchiveChannel(id: string) {
    const ok = await archiveChannel(id);
    if (!ok) ctx.pushToast("Failed to archive channel");
  }

  function openEditChannel(channel: ChannelRowVM) {
    setChannelEditor({ channel });
  }

  async function handleCreateFromSuggestion(row: SuggestionRowVM) {
    const ok = await createFromSuggestion({
      key: row.key,
      type: row.type,
      severity: row.severity,
      title: row.title,
      sub: row.sub,
      windowMinutes: row.windowMinutes,
      threshold: row.threshold,
      routePattern: row.routePattern,
      minimumSampleSize: row.minimumSampleSize,
      cooldownMinutes: row.cooldownMinutes,
      rationale: row.rationale,
    });
    ctx.pushToast(ok ? "Rule created from suggestion" : "Failed to create rule");
  }

  function openEditRule(row: AlertRuleRowVM) {
    setRuleEditor({
      id: row.id,
      initial: {
        name: row.name,
        type: row.type,
        severity: row.severity,
        windowMinutes: row.windowMinutes,
        threshold: row.threshold,
        cooldownMinutes: row.cooldownMinutes,
        escalationMinutes: row.escalationMinutes,
        routePattern: row.routePattern,
        minimumSampleSize: row.minimumSampleSize,
        notificationChannelId: row.notificationChannelId,
        escalationChannelId: row.escalationChannelId,
      },
    });
  }

  return (
    <>
      <PageHead
        title="Alert rules"
        sub={`${ctx.project.name} · ${ctx.environment.name} — ${header.activeRuleCount} active rules · ${header.fires7d} alerts fired in the last 7 days. Review thresholds and where notifications are delivered.`}
        actions={
          <>
            <button
              className="sh-btn"
              disabled={busy}
              onClick={() => setChannelEditor("create")}
            >
              <Icon name="webhook" size={13} />
              Channels
            </button>
            <button
              className="sh-btn primary"
              disabled={busy}
              onClick={() => setRuleEditor("create")}
            >
              <Icon name="plus" size={13} />
              New rule
            </button>
          </>
        }
      />

      {suggestions.length > 0 && (
        <SuggestionsCard suggestions={suggestions} onCreateFromSuggestion={handleCreateFromSuggestion} />
      )}

      {ruleEditor !== "closed" && (
        <RuleEditor
          mode={ruleEditor === "create" ? "create" : ruleEditor}
          channels={channels}
          busy={busy}
          onCancel={() => setRuleEditor("closed")}
          onSave={(form) => {
            if (ruleEditor === "create") {
              handleCreateRule(form);
            } else {
              handleUpdateRule(ruleEditor.id, form);
            }
          }}
        />
      )}

      {channelEditor !== "closed" && (
        <ChannelEditor
          editing={channelEditor === "create" ? null : channelEditor.channel}
          busy={busy}
          onCancel={() => setChannelEditor("closed")}
          onCreate={handleCreateChannel}
          onUpdate={handleUpdateChannel}
        />
      )}

      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Recent history</h2>
          <span className="sh-faint" style={{ fontSize: 11 }}>
            last 7 days
          </span>
        </div>
        <div className="sh-card__body">
          <FiresTimeline timeline={timeline} />
        </div>
      </div>

      <OnCallQueue events={events} busy={busy} onTriage={handleAlertTriage} />

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Rules</h2>
            <Segmented options={[...FILTERS]} value={filter} onChange={(v) => setFilter(v as RuleFilter)} />
          </div>
          <div className="sh-row sh-row__head" style={{ gridTemplateColumns: RULE_GRID }}>
            <span>Rule</span>
            <span>Severity</span>
            <span>State</span>
            <span>Channel</span>
            <span>Escalation</span>
            <span>7d</span>
            <span>Actions</span>
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {shownRules.length === 0 ? (
              <EmptyHint icon="bell" title="No alert rules" sub="No rules match this filter." />
            ) : (
              shownRules.map((row) => (
                <AlertRuleRow
                  key={row.id}
                  row={row}
                  channels={channels}
                  busy={busy}
                  onPauseResume={handlePauseResume}
                  onArchive={handleArchiveRule}
                  onEditOpen={openEditRule}
                />
              ))
            )}
          </div>
        </div>

        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-card__head">
            <h2 className="sh-h2">Channels</h2>
            <button
              className="sh-btn ghost"
              style={{ padding: "4px 8px" }}
              disabled={busy}
              onClick={() => setChannelEditor("create")}
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
          <div className="sh-card__body flush">
            {channels.length === 0 ? (
              <EmptyHint icon="webhook" title="No channels" sub="Add a notification channel, then connect it to a rule so alerts reach the right responder." />
            ) : (
              channels.map((row) => (
                <ChannelRow
                  key={row.id}
                  row={row}
                  busy={busy}
                  onEdit={openEditChannel}
                  onArchive={handleArchiveChannel}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

import { useState, type FormEvent } from "react";
import { EmptyHint, Icon, SecretField, Segmented, StatusDot } from "../../../components/ui/v2";
import type {
  ApiKey,
  DataGovernancePolicy,
  DataGovernancePropertyRule,
  DataGovernancePropertyRuleTarget,
  DataGovernanceRetentionCategory,
  WarehouseDataset,
  WarehouseDestination,
} from "../../../api/types";
import type { ScreenCtx } from "../registry";
import { useProjectSettings } from "./useProjectSettings";
import "./project-settings.css";

const TABS = ["API keys", "Browser origins", "Releases & code", "Data governance", "Warehouse sync"] as const;
type SettingsTab = (typeof TABS)[number];

const RETENTION_CATEGORIES: Array<{
  key: DataGovernanceRetentionCategory;
  label: string;
  fallback: number;
}> = [
  { key: "events", label: "Events", fallback: 90 },
  { key: "errors", label: "Errors", fallback: 180 },
  { key: "traces", label: "Traces", fallback: 90 },
  { key: "spans", label: "Spans", fallback: 90 },
  { key: "llmCalls", label: "LLM calls", fallback: 180 },
  { key: "profiles", label: "Profiles", fallback: 30 },
  { key: "breadcrumbs", label: "Breadcrumbs", fallback: 30 },
  { key: "webVitals", label: "Web vitals", fallback: 90 },
  { key: "clicks", label: "Click maps", fallback: 90 },
  { key: "replays", label: "Session replays", fallback: 90 },
];

const RULE_TARGETS: DataGovernancePropertyRuleTarget[] = [
  "metadata",
  "event.properties",
  "error.context",
  "span.input",
  "span.output",
  "span.error",
  "breadcrumb.data",
  "replay.event.data",
  "identity.traits",
];

const DATASETS: Array<{ key: WarehouseDataset; label: string }> = [
  { key: "events", label: "Events" },
  { key: "errors", label: "Errors" },
  { key: "traces", label: "Traces" },
  { key: "llmCalls", label: "LLM calls" },
  { key: "userProfiles", label: "User profiles" },
  { key: "tenantProfiles", label: "Tenant profiles" },
];

type SettingsModel = ReturnType<typeof useProjectSettings>;

function ApiKeysPanel({
  model,
  environmentId,
  serverSecret,
  onClearServerSecret,
}: {
  model: SettingsModel;
  environmentId: string;
  serverSecret: string | null;
  onClearServerSecret: () => void;
}) {
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [capability, setCapability] = useState<ApiKey["capability"]>("browser");
  const keys = model.apiKeys.filter((key) => key.environmentId === environmentId && key.revokedAt == null);

  function resetCreateForm() {
    setCreating(false);
    setName("");
    setCapability("browser");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!editing || !cleanName) return;
    if (await model.renameApiKey(editing.id, cleanName)) {
      setEditing(null);
      setName("");
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;
    if (await model.createApiKey({ name: cleanName, capability })) {
      resetCreateForm();
    }
  }

  return (
    <div className="sh-card__body" style={{ display: "grid", gap: 12 }}>
      <div className="sh-settings-intro">
        <div>
          <h3 className="sh-h2">Ingest API keys</h3>
          <p className="sh-muted">Keys are scoped to this project and environment. Renaming does not rotate the secret.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="sh-tag">{keys.length} active</span>
          <button className="sh-btn ghost" type="button" disabled={model.busy} onClick={() => {
            if (creating) resetCreateForm();
            else setCreating(true);
          }}>
            New API key
          </button>
        </div>
      </div>
      {!model.capabilities.renameApiKeys ? <div className="sh-alert warning">Key rename is unavailable in this deployment. Revocation remains available.</div> : null}
      {model.errors.apiKeys ? <div className="sh-alert bad" role="alert">{model.errors.apiKeys}</div> : null}
      {serverSecret ? (
        <div className="sh-alert warning" style={{ display: "grid", gap: 8 }}>
          <strong>Server API key created</strong>
          <span>Copy this key now and store it only in server-side secret storage. It is required for identify requests.</span>
          <SecretField value={serverSecret} />
          <button className="sh-btn ghost" type="button" onClick={onClearServerSecret}>Dismiss server key</button>
        </div>
      ) : null}
      {keys.length === 0 ? (
        <EmptyHint icon="key" title="No active keys" sub="Generate the first key in the SDK installation panel above." />
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {keys.map((key) => (
            <div className="sh-row" key={key.id} style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto" }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 12.5 }}>{key.name}</strong>
                <div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>
                  {key.prefix} · created {new Date(key.createdAt).toLocaleDateString()}
                  {" · "}{key.capability}
                </div>
              </div>
              <button
                className="sh-iconbtn-sm"
                type="button"
                aria-label={`Rename ${key.name}`}
                title="Rename key"
                disabled={model.busy}
                onClick={() => {
                  setEditing(key);
                  setName(key.name);
                }}
              >
                <Icon name="edit" size={12} />
              </button>
              <button
                className="sh-iconbtn-sm danger"
                type="button"
                aria-label={`Revoke ${key.name}`}
                title="Revoke key"
                disabled={model.busy}
                onClick={() => void model.revokeApiKey(key)}
              >
                <Icon name="archive" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {creating ? (
        <form onSubmit={(event) => void create(event)} style={{ display: "grid", gap: 8 }}>
          <label className="sh-settings-field">
            <span>API key name</span>
            <input className="sh-input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="sh-settings-field">
            <span>API key capability</span>
            <select className="sh-input" value={capability} onChange={(event) => setCapability(event.target.value as ApiKey["capability"])}>
              <option value="browser">Browser</option>
              <option value="server">Server</option>
            </select>
          </label>
          <p className="sh-muted" style={{ margin: 0 }}>
            Browser keys are public by design for client-side telemetry. Server keys must remain secret and are required for identify requests.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="sh-btn primary" type="submit" disabled={model.busy || !name.trim()}>Create API key</button>
            <button className="sh-btn ghost" type="button" disabled={model.busy} onClick={resetCreateForm}>Cancel</button>
          </div>
        </form>
      ) : null}
      {editing ? (
        <form onSubmit={(event) => void save(event)} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8 }}>
          <label className="sh-settings-field">
            <span>API key name</span>
            <input className="sh-input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <button className="sh-btn primary" type="submit" disabled={model.busy || !name.trim()}>
            Save key name
          </button>
          <button className="sh-btn ghost" type="button" disabled={model.busy} onClick={() => setEditing(null)}>
            Cancel
          </button>
        </form>
      ) : null}
    </div>
  );
}

function BrowserOriginsPanel({ model }: { model: SettingsModel }) {
  const [origin, setOrigin] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = origin.trim();
    if (!value) return;
    if (await model.createOrigin(value)) setOrigin("");
  }

  return (
    <div className="sh-card__body" style={{ display: "grid", gap: 12 }}>
      <div className="sh-settings-intro">
        <div>
          <h3 className="sh-h2">Allowed browser origins</h3>
          <p className="sh-muted">
            Permit browser SDK preflight and ingestion. Include protocol; paths are normalized by the API.
          </p>
        </div>
        <span className="sh-tag">project scope</span>
      </div>
      {!model.capabilities.browserOrigins ? <div className="sh-alert warning">Browser origin management is unavailable in this deployment.</div> : null}
      {model.errors.browserOrigins ? <div className="sh-alert bad" role="alert">{model.errors.browserOrigins}</div> : null}
      {model.origins.length === 0 ? (
        <EmptyHint icon="link" title="No allowed origins" sub="Browser requests remain blocked until an application origin is added." />
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {model.origins.map((item) => (
            <div className="sh-row" key={item.id} style={{ gridTemplateColumns: "1fr auto" }}>
              <div>
                <strong className="sh-mono" style={{ fontSize: 12 }}>{item.origin}</strong>
                <div className="sh-faint" style={{ fontSize: 10.5 }}>Allowed {new Date(item.createdAt).toLocaleDateString()}</div>
              </div>
              <button
                className="sh-iconbtn-sm danger"
                type="button"
                aria-label={`Archive ${item.origin}`}
                title="Archive origin"
                disabled={model.busy}
                onClick={() => void model.archiveOrigin(item)}
              >
                <Icon name="archive" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={(event) => void submit(event)} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "end" }}>
        <label className="sh-settings-field">
          <span>Allowed browser origin</span>
          <input
            className="sh-input"
            type="url"
            placeholder="https://app.example.com"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
          />
        </label>
        <button className="sh-btn primary" type="submit" disabled={model.busy || !origin.trim()}>
          <Icon name="plus" size={12} /> Add origin
        </button>
      </form>
    </div>
  );
}

function optional(value: string): string | null {
  const clean = value.trim();
  return clean ? clean : null;
}

function ReleasesPanel({ model }: { model: SettingsModel }) {
  const [release, setRelease] = useState("");
  const [integrationId, setIntegrationId] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const [commitUrl, setCommitUrl] = useState("");
  const [pullRequestNumber, setPullRequestNumber] = useState("");
  const [pullRequestUrl, setPullRequestUrl] = useState("");
  const [deployedBy, setDeployedBy] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanRelease = release.trim();
    if (!cleanRelease) return;
    const saved = await model.saveReleaseMetadata({
      release: cleanRelease,
      integrationId: optional(integrationId),
      commitSha: optional(commitSha),
      commitUrl: optional(commitUrl),
      pullRequestNumber: pullRequestNumber.trim() ? Number(pullRequestNumber) : null,
      pullRequestUrl: optional(pullRequestUrl),
      deployedBy: optional(deployedBy),
    });
    if (saved) {
      setRelease("");
      setIntegrationId("");
      setCommitSha("");
      setCommitUrl("");
      setPullRequestNumber("");
      setPullRequestUrl("");
      setDeployedBy("");
    }
  }

  return (
    <form className="sh-card__body" onSubmit={(event) => void submit(event)} style={{ display: "grid", gap: 14 }}>
      <div className="sh-settings-intro">
        <div>
          <h3 className="sh-h2">Release metadata</h3>
          <p className="sh-muted">Connect production errors to the commit, pull request, and deployment that introduced them.</p>
        </div>
        <span className="sh-tag">environment scope</span>
      </div>
      {!model.capabilities.releases ? <div className="sh-alert warning">Release metadata is unavailable in this deployment.</div> : null}
      {model.errors.releases ? <div className="sh-alert bad" role="alert">{model.errors.releases}</div> : null}
      <div className="sh-settings-grid">
        <section className="sh-settings-subpanel">
          <div className="sh-card__head"><h4 className="sh-h2">Release identity</h4></div>
          <div className="sh-card__body" style={{ display: "grid", gap: 8 }}>
            <label className="sh-settings-field">
              <span>Release identifier</span>
              <input className="sh-input" required placeholder="web@1.2.3" value={release} onChange={(event) => setRelease(event.target.value)} />
            </label>
            <label className="sh-settings-field">
              <span>Repository</span>
              <select className="sh-select" value={integrationId} onChange={(event) => setIntegrationId(event.target.value)}>
                <option value="">No repository</option>
                {model.integrations.map((integration) => (
                  <option key={integration.id} value={integration.id}>
                    {integration.name} · {integration.owner}/{integration.repo}
                  </option>
                ))}
              </select>
            </label>
            <label className="sh-settings-field">
              <span>Commit SHA</span>
              <input className="sh-input sh-mono" placeholder="abcdef123456" value={commitSha} onChange={(event) => setCommitSha(event.target.value)} />
            </label>
            <label className="sh-settings-field">
              <span>Commit URL</span>
              <input className="sh-input" type="url" placeholder="https://github.com/acme/app/commit/abcdef" value={commitUrl} onChange={(event) => setCommitUrl(event.target.value)} />
            </label>
          </div>
        </section>
        <section className="sh-settings-subpanel">
          <div className="sh-card__head"><h4 className="sh-h2">Delivery context</h4></div>
          <div className="sh-card__body" style={{ display: "grid", gap: 8 }}>
            <label className="sh-settings-field">
              <span>Pull request number</span>
              <input className="sh-input" type="number" min={1} value={pullRequestNumber} onChange={(event) => setPullRequestNumber(event.target.value)} />
            </label>
            <label className="sh-settings-field">
              <span>Pull request URL</span>
              <input className="sh-input" type="url" placeholder="https://github.com/acme/app/pull/42" value={pullRequestUrl} onChange={(event) => setPullRequestUrl(event.target.value)} />
            </label>
            <label className="sh-settings-field">
              <span>Deployed by</span>
              <input className="sh-input" placeholder="github-actions" value={deployedBy} onChange={(event) => setDeployedBy(event.target.value)} />
            </label>
          </div>
        </section>
      </div>
      <button className="sh-btn primary" type="submit" disabled={model.busy || !model.capabilities.releases || !release.trim()}>
        Save release metadata
      </button>
    </form>
  );
}

function GovernancePanel({ model }: { model: SettingsModel }) {
  const [retention, setRetention] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      RETENTION_CATEGORIES.map((category) => [
        category.key,
        String(model.policy?.retentionPolicy[category.key] ?? category.fallback),
      ]),
    ),
  );
  const [target, setTarget] = useState<DataGovernancePropertyRuleTarget>("event.properties");
  const [path, setPath] = useState("");
  const [action, setAction] = useState<DataGovernancePropertyRule["action"]>("mask");
  const [validationError, setValidationError] = useState<string | null>(null);
  const persistedRetention = model.policy?.retentionPolicy ?? {};
  function parseRetention(): DataGovernancePolicy["retentionPolicy"] | null {
    const entries: Array<[DataGovernanceRetentionCategory, number]> = [];
    for (const category of RETENTION_CATEGORIES) {
      const value = Number(retention[category.key]);
      if (!Number.isInteger(value) || value < 1 || value > 3650) {
        setValidationError("Retention must be a whole number from 1 to 3650 days.");
        return null;
      }
      entries.push([category.key, value]);
    }
    setValidationError(null);
    return Object.fromEntries(entries) as DataGovernancePolicy["retentionPolicy"];
  }

  function saveRetention() {
    const retentionPolicy = parseRetention();
    if (!retentionPolicy) return;
    void model.saveGovernance({ retentionPolicy, propertyRules: model.policy?.propertyRules ?? [] });
  }

  async function addRule(event: FormEvent) {
    event.preventDefault();
    const cleanPath = path.trim();
    if (!cleanPath) return;
    const saved = await model.saveGovernance({
      retentionPolicy: persistedRetention,
      propertyRules: [...(model.policy?.propertyRules ?? []), { target, path: cleanPath, action }],
    });
    if (saved) setPath("");
  }

  return (
    <div className="sh-card__body" style={{ display: "grid", gap: 16 }}>
      <div className="sh-settings-intro">
        <div>
          <h3 className="sh-h2">Data governance</h3>
          <p className="sh-muted">Retention and redaction apply to the selected environment before analytics and exports.</p>
        </div>
        <span className="sh-tag">environment scope</span>
      </div>
      {!model.capabilities.governance ? <div className="sh-alert warning">Data governance is unavailable in this deployment.</div> : null}
      {model.errors.governance ? <div className="sh-alert bad" role="alert">{model.errors.governance}</div> : null}
      <div className="sh-settings-grid">
        <section className="sh-settings-subpanel">
          <div className="sh-card__head"><h4 className="sh-h2">Retention windows</h4><span className="sh-faint">days</span></div>
          <div className="sh-card__body" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            <p className="sh-muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
              Values saved here override installation defaults for this environment, whether shorter or longer.
            </p>
            {RETENTION_CATEGORIES.map((category) => (
              <label className="sh-settings-field" key={category.key}>
                <span>{category.label} retention days</span>
                <input
                  className="sh-input"
                  type="number"
                  min={1}
                  max={3650}
                  value={retention[category.key] ?? category.fallback}
                  onChange={(event) => setRetention((current) => ({ ...current, [category.key]: event.target.value }))}
                />
              </label>
            ))}
            <button
              className="sh-btn primary"
              type="button"
              disabled={model.busy || !model.policy}
              onClick={saveRetention}
            >
              Save retention
            </button>
            {validationError ? <div className="sh-alert bad" role="alert" style={{ gridColumn: "1 / -1" }}>{validationError}</div> : null}
          </div>
        </section>
        <section className="sh-settings-subpanel">
          <div className="sh-card__head"><h4 className="sh-h2">Sensitive properties</h4><span className="sh-tag">mask or block</span></div>
          <div className="sh-card__body" style={{ display: "grid", gap: 10 }}>
            {(model.policy?.propertyRules ?? []).map((rule, index) => (
              <div className="sh-row" key={`${rule.target}:${rule.path}:${index}`} style={{ gridTemplateColumns: "1fr auto" }}>
                <code style={{ fontSize: 11 }}>{rule.target}.{rule.path}</code>
                <button
                  className="sh-btn ghost"
                  type="button"
                  aria-label={`Remove ${rule.target}.${rule.path}`}
                  disabled={model.busy}
                  onClick={() => {
                    if (!window.confirm(`Remove the sensitive-property rule ${rule.target}.${rule.path}?`)) return;
                    void model.saveGovernance({
                      retentionPolicy: persistedRetention,
                      propertyRules: (model.policy?.propertyRules ?? []).filter((_, ruleIndex) => ruleIndex !== index),
                    });
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <form onSubmit={(event) => void addRule(event)} style={{ display: "grid", gap: 8 }}>
              <label className="sh-settings-field">
                <span>Target</span>
                <select className="sh-input" value={target} onChange={(event) => setTarget(event.target.value as DataGovernancePropertyRuleTarget)}>
                  {RULE_TARGETS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="sh-settings-field">
                <span>Property path</span>
                <input className="sh-input" placeholder="user.email" value={path} onChange={(event) => setPath(event.target.value)} />
              </label>
              <label className="sh-settings-field">
                <span>Action</span>
                <select className="sh-input" value={action} onChange={(event) => setAction(event.target.value as DataGovernancePropertyRule["action"])}>
                  <option value="mask">Mask value</option>
                  <option value="block">Block property</option>
                </select>
              </label>
              <button className="sh-btn primary" type="submit" disabled={model.busy || !path.trim()}>
                Add {action === "mask" ? "masking" : "blocking"} rule
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

type DestinationDraft = {
  name: string;
  connectionUrl: string;
  batchSize: string;
  datasets: WarehouseDataset[];
  enabled: boolean;
};

const EMPTY_DESTINATION: DestinationDraft = {
  name: "",
  connectionUrl: "",
  batchSize: "500",
  datasets: ["events", "errors"],
  enabled: true,
};

function exportedRows(run: SettingsModel["runs"][number]): number {
  return Object.values(run.exported).reduce((total, value) => total + (value ?? 0), 0);
}

function WarehousePanel({ model }: { model: SettingsModel }) {
  const [editor, setEditor] = useState<"closed" | "new" | "edit">("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DestinationDraft>(EMPTY_DESTINATION);
  const selected = model.destinations.find((item) => item.id === model.selectedDestinationId) ?? model.destinations[0];

  function edit(destination: WarehouseDestination) {
    model.setSelectedDestinationId(destination.id);
    setEditingId(destination.id);
    setEditor("edit");
    setDraft({
      name: destination.name,
      connectionUrl: "",
      batchSize: String(destination.batchSize),
      datasets: destination.datasets,
      enabled: destination.enabled,
    });
  }

  function toggleDataset(dataset: WarehouseDataset) {
    setDraft((current) => {
      if (current.datasets.includes(dataset)) {
        const next = current.datasets.filter((item) => item !== dataset);
        return { ...current, datasets: next.length > 0 ? next : current.datasets };
      }
      return { ...current, datasets: [...current.datasets, dataset] };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const common = {
      name: draft.name.trim(),
      datasets: draft.datasets,
      batchSize: Math.max(1, Math.min(5000, Number(draft.batchSize) || 500)),
      enabled: draft.enabled,
    };
    if (editor === "edit" && editingId) {
      const saved = await model.updateDestination(editingId, {
        ...common,
        ...(draft.connectionUrl.trim() ? { connectionUrl: draft.connectionUrl.trim() } : {}),
      });
      if (!saved) return;
    } else {
      const saved = await model.createDestination({ ...common, connectionUrl: draft.connectionUrl.trim(), destinationType: "postgres" });
      if (!saved) return;
    }
    setEditor("closed");
    setEditingId(null);
    setDraft(EMPTY_DESTINATION);
  }

  return (
    <div className="sh-card__body" style={{ display: "grid", gap: 14 }}>
      <div className="sh-settings-intro">
        <div>
          <h3 className="sh-h2">Warehouse sync</h3>
          <p className="sh-muted">Incrementally export selected telemetry datasets to a Postgres analytical store.</p>
        </div>
        <button
          className="sh-btn primary"
          type="button"
          disabled={model.busy || !model.capabilities.warehouse}
          onClick={() => {
            setEditor("new");
            setEditingId(null);
            setDraft(EMPTY_DESTINATION);
          }}
        >
          <Icon name="plus" size={12} /> New destination
        </button>
      </div>
      {!model.capabilities.warehouse ? <div className="sh-alert warning">Warehouse sync is unavailable in this deployment.</div> : null}
      {model.errors.warehouse ? <div className="sh-alert bad" role="alert">{model.errors.warehouse}</div> : null}
      <div className="sh-settings-grid warehouse">
        <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
          {model.destinations.length === 0 ? (
            <EmptyHint icon="db" title="No destinations" sub="Create a Postgres destination to start incremental exports." />
          ) : model.destinations.map((item) => (
            <button
              className={`sh-row ${selected?.id === item.id ? "is-active" : ""}`}
              key={item.id}
              type="button"
              onClick={() => model.setSelectedDestinationId(item.id)}
              style={{ width: "100%", textAlign: "left", gridTemplateColumns: "1fr auto" }}
            >
              <span>
                <strong style={{ fontSize: 12.5 }}>{item.name}</strong>
                <span className="sh-faint sh-mono" style={{ display: "block", fontSize: 10.5 }}>{item.connectionUrlPreview}</span>
              </span>
              <StatusDot status={item.enabled ? "ok" : "idle"} size={7} />
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          {selected ? (
            <>
              <div className="sh-settings-subpanel">
                <div className="sh-card__head">
                  <div>
                    <h4 className="sh-h2">{selected.name}</h4>
                    <div className="sh-faint" style={{ fontSize: 10.5 }}>
                      {selected.datasets.join(", ")} · batch {selected.batchSize} rows · {selected.enabled ? "scheduled" : "paused"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="sh-btn ghost" type="button" aria-label={`Run ${selected.name} now`} disabled={model.busy} onClick={() => void model.runDestination(selected)}>
                      <Icon name="play" size={12} /> Run now
                    </button>
                    <button className="sh-iconbtn-sm" type="button" aria-label={`Edit ${selected.name}`} title="Edit destination" disabled={model.busy} onClick={() => edit(selected)}>
                      <Icon name="edit" size={12} />
                    </button>
                    <button className="sh-iconbtn-sm danger" type="button" aria-label={`Archive ${selected.name}`} title="Archive destination" disabled={model.busy} onClick={() => void model.archiveDestination(selected)}>
                      <Icon name="archive" size={12} />
                    </button>
                  </div>
                </div>
                <div className="sh-card__body" style={{ display: "grid", gap: 6 }}>
                  {model.errors.warehouseRuns ? <div className="sh-alert bad" role="alert">{model.errors.warehouseRuns}</div> : null}
                  {model.runs.length === 0 ? <span className="sh-muted">No export runs recorded.</span> : model.runs.map((item) => (
                    <div className="sh-row" key={item.id} style={{ gridTemplateColumns: "auto minmax(0, 1fr) auto" }}>
                      <StatusDot status={item.status === "success" ? "ok" : item.status === "failed" ? "critical" : "warning"} size={7} />
                      <span style={{ fontSize: 11.5 }}>
                        <strong>{item.status === "success" ? "Succeeded" : item.status === "failed" ? "Failed" : "Running"}</strong>
                        <span className="sh-faint" style={{ display: "block", fontSize: 10.5 }}>
                          {item.errorMessage ?? `${exportedRows(item)} rows exported`}
                        </span>
                      </span>
                      <span className="sh-faint" style={{ fontSize: 10.5 }}>{new Date(item.startedAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
          {editor !== "closed" ? (
            <form className="sh-settings-subpanel" onSubmit={(event) => void submit(event)}>
              <div className="sh-card__head"><h4 className="sh-h2">{editor === "edit" ? "Edit destination" : "Create Postgres destination"}</h4></div>
              <div className="sh-card__body" style={{ display: "grid", gap: 8 }}>
                <label className="sh-settings-field">
                  <span>Destination name</span>
                  <input className="sh-input" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label className="sh-settings-field">
                  <span>Postgres connection URL</span>
                  <input
                    className="sh-input"
                    type="password"
                    required={editor === "new"}
                    placeholder={editor === "edit" ? "Leave blank to keep current secret" : "postgres://writer:password@host:5432/analytics"}
                    value={draft.connectionUrl}
                    onChange={(event) => setDraft((current) => ({ ...current, connectionUrl: event.target.value }))}
                  />
                </label>
                <label className="sh-settings-field">
                  <span>Batch size (rows per run)</span>
                  <input className="sh-input" type="number" min={1} max={5000} value={draft.batchSize} onChange={(event) => setDraft((current) => ({ ...current, batchSize: event.target.value }))} />
                </label>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="sh-eyebrow" style={{ marginBottom: 6 }}>Datasets</legend>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {DATASETS.map((dataset) => (
                      <label className="sh-tag" key={dataset.key}>
                        <input type="checkbox" checked={draft.datasets.includes(dataset.key)} onChange={() => toggleDataset(dataset.key)} /> {dataset.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                  <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />
                  Enable scheduled exports
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="sh-btn primary" type="submit" disabled={model.busy || !draft.name.trim() || (editor === "new" && !draft.connectionUrl.trim())}>
                    {editor === "edit" ? "Save destination" : "Create destination"}
                  </button>
                  <button className="sh-btn ghost" type="button" onClick={() => setEditor("closed")}>Cancel</button>
                </div>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ProjectSettingsSection({ ctx }: { ctx: ScreenCtx }) {
  const [tab, setTab] = useState<SettingsTab>("API keys");
  const model = useProjectSettings(ctx);

  if (!ctx.project || !ctx.environment) return null;

  return (
    <section className="sh-card" aria-labelledby="project-settings-heading">
      <div className="sh-card__head" style={{ alignItems: "flex-start" }}>
        <div>
          <h2 className="sh-h2" id="project-settings-heading">Project settings</h2>
          <div className="sh-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
            {ctx.project.name} / {ctx.environment.name} · ingestion, privacy, and data delivery
          </div>
        </div>
        <Segmented options={[...TABS]} value={tab} onChange={(value) => setTab(value as SettingsTab)} />
      </div>
      {model.error ? <div className="sh-alert bad" role="alert">{model.error}</div> : null}
      {model.loading ? (
        <div className="sh-card__body"><EmptyHint icon="activity" title="Loading settings…" sub="Reading the selected project and environment configuration." /></div>
      ) : tab === "API keys" ? (
        <ApiKeysPanel
          key={model.scopeKey}
          model={model}
          environmentId={ctx.environment.id}
          serverSecret={ctx.createdSecret?.kind === "serverApiKey" ? ctx.createdSecret.value : null}
          onClearServerSecret={() => ctx.onSecretCreated(null, "serverApiKey")}
        />
      ) : tab === "Browser origins" ? (
        <BrowserOriginsPanel key={model.scopeKey} model={model} />
      ) : tab === "Releases & code" ? (
        <ReleasesPanel key={model.scopeKey} model={model} />
      ) : tab === "Data governance" ? (
        <GovernancePanel key={model.scopeKey} model={model} />
      ) : (
        <WarehousePanel key={model.scopeKey} model={model} />
      )}
    </section>
  );
}

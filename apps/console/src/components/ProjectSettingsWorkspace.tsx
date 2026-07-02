import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type {
  BrowserOrigin,
  DataGovernancePolicy,
  DataGovernancePropertyRule,
  DataGovernancePropertyRuleTarget,
  DataGovernanceRetentionCategory,
  Environment,
  Project,
  WarehouseDataset,
  WarehouseDestination,
  WarehouseExportRun
} from "../api/types";
import { ApiKeyPanel } from "./ApiKeyPanel";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { ProjectOnboardingChecklist } from "./ProjectOnboardingChecklist";
import { SettingsSectionNav, type SettingsSection } from "./SettingsSectionNav";
import { SnippetPanel } from "./SnippetPanel";
import { EmptyState } from "./ui/EmptyState";
import { UserAdminPanel } from "./UserAdminPanel";

type Props = {
  client: ApiClient;
  activeEnvironment?: Environment;
  activeProject?: Project;
  activeProjectId?: string;
  apiEndpoint?: string;
  browserCorsOrigins?: string[];
  environments: Environment[];
  isEnvironmentCreationDisabled: boolean;
  latestSecret?: string;
  onArchiveEnvironment?: (environment: Environment) => Promise<void>;
  onCreateEnvironment: (name: string) => Promise<void>;
  onArchiveProject: (projectId: string) => Promise<void>;
  onSecretCreated: (secret: string) => void;
  onSelectEnvironment: (environment: Environment) => void;
  onUpdateProject: (projectId: string, input: { name?: string }) => Promise<void>;
  onUpdateEnvironment?: (environment: Environment, name: string) => Promise<void>;
};

const sections = [
  {
    id: "project",
    label: "Project",
    description: "Rename or archive the selected monitored product."
  },
  {
    id: "environments",
    label: "Environments",
    description: "Create and select deployment environments for this project."
  },
  {
    id: "api-keys",
    label: "API keys",
    description: "Issue scoped ingest keys for server and browser clients."
  },
  {
    id: "browser-origins",
    label: "Browser origins",
    description: "Review allowed browser origins for client-side ingestion."
  },
  {
    id: "data-governance",
    label: "Data governance",
    description: "Control retention windows and sensitive telemetry properties."
  },
  {
    id: "warehouse-sync",
    label: "Warehouse sync",
    description: "Export telemetry incrementally to an external analytical store."
  },
  {
    id: "sdk-snippets",
    label: "SDK snippets",
    description: "Copy install snippets for the active project and environment."
  },
  {
    id: "source-maps",
    label: "Source maps",
    description: "Upload source maps and manage upload tokens."
  },
  {
    id: "console-users",
    label: "Console users",
    description: "Installation-level console access."
  }
] satisfies SettingsSection[];

type SectionId = (typeof sections)[number]["id"];

function BrowserOriginsPanel({ client, projectId }: { client: ApiClient; projectId: string }) {
  const [origins, setOrigins] = useState<BrowserOrigin[]>([]);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [archivingId, setArchivingId] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    if (!client.listBrowserOrigins) {
      setError("Browser origin management is unavailable.");
      return () => {
        cancelled = true;
      };
    }

    void client
      .listBrowserOrigins(projectId)
      .then(({ origins }) => {
        if (cancelled) return;
        setOrigins(origins);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load browser origins.");
      });

    return () => {
      cancelled = true;
    };
  }, [client, projectId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedOrigin = origin.trim();
    if (!trimmedOrigin || isSubmitting) return;
    if (!client.createBrowserOrigin) {
      setError("Browser origin management is unavailable.");
      return;
    }

    setError(undefined);
    setIsSubmitting(true);

    try {
      const response = await client.createBrowserOrigin(projectId, { origin: trimmedOrigin });
      setOrigins((current) => {
        const withoutDuplicate = current.filter((item) => item.id !== response.origin.id && item.origin !== response.origin.origin);
        return [...withoutDuplicate, response.origin];
      });
      setOrigin("");
    } catch {
      setError("Could not add browser origin.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function archiveOrigin(item: BrowserOrigin) {
    const confirmed = window.confirm(`Archive browser origin ${item.origin}?`);
    if (!confirmed) return;
    if (!client.archiveBrowserOrigin) {
      setError("Browser origin management is unavailable.");
      return;
    }

    setError(undefined);
    setArchivingId(item.id);

    try {
      await client.archiveBrowserOrigin(item.id);
      setOrigins((current) => current.filter((originItem) => originItem.id !== item.id));
    } catch {
      setError("Could not archive browser origin.");
    } finally {
      setArchivingId(undefined);
    }
  }

  return (
    <section className="panel browser-origins-panel">
      <div className="panel-header">
        <h2>Browser origins</h2>
      </div>
      <p>Browser origins must include protocol, for example https://app.example.com.</p>
      <p className="muted-text">
        These origins are allowed to send browser SDK telemetry directly to Sigmon ingestion endpoints for this project.
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      {origins.length === 0 ? (
        <p className="muted-text">No browser origins configured for this project.</p>
      ) : (
        <ul className="key-list">
          {origins.map((item) => (
            <li className="key-list-item" key={item.id}>
              <div>
                <strong>{item.origin}</strong>
                <span>Created {new Date(item.createdAt).toLocaleString()}</span>
              </div>
              <div className="key-list-item__actions">
                <button
                  aria-label={`Archive ${item.origin}`}
                  className="button-danger"
                  disabled={archivingId === item.id}
                  onClick={() => void archiveOrigin(item)}
                  type="button"
                >
                  Archive
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="compact-form" onSubmit={submit}>
        <label>
          Allowed browser origin
          <input
            onChange={(event) => setOrigin(event.target.value)}
            placeholder="https://app.example.com"
            type="url"
            value={origin}
          />
        </label>
        <button disabled={isSubmitting} type="submit">
          Add origin
        </button>
      </form>
    </section>
  );
}

const retentionCategories: Array<{ key: DataGovernanceRetentionCategory; label: string; description: string; fallbackDays: number }> = [
  { key: "events", label: "Events", description: "Custom product analytics events.", fallbackDays: 90 },
  { key: "errors", label: "Errors", description: "Error occurrences and grouped incidents.", fallbackDays: 180 },
  { key: "traces", label: "Traces", description: "Request traces and route latency records.", fallbackDays: 90 },
  { key: "spans", label: "Spans", description: "Trace child spans and dependency timings.", fallbackDays: 90 },
  { key: "llmCalls", label: "LLM calls", description: "AI provider, token, latency, and cost telemetry.", fallbackDays: 180 },
  { key: "profiles", label: "Profiles", description: "CPU and memory profiling samples.", fallbackDays: 30 },
  { key: "breadcrumbs", label: "Breadcrumbs", description: "Context events captured before an error.", fallbackDays: 30 },
  { key: "webVitals", label: "Web vitals", description: "Browser performance metrics.", fallbackDays: 90 },
  { key: "clicks", label: "Click maps", description: "Masked click analytics samples.", fallbackDays: 90 },
  { key: "replays", label: "Session replays", description: "Masked replay timelines.", fallbackDays: 90 }
];

const propertyRuleTargets: DataGovernancePropertyRuleTarget[] = [
  "metadata",
  "event.properties",
  "error.context",
  "span.input",
  "span.output",
  "span.error",
  "breadcrumb.data",
  "replay.event.data",
  "identity.traits"
];

const warehouseDatasets: Array<{ key: WarehouseDataset; label: string }> = [
  { key: "events", label: "Events" },
  { key: "errors", label: "Errors" },
  { key: "traces", label: "Traces" },
  { key: "llmCalls", label: "LLM calls" }
];

function DataGovernancePanel({
  activeEnvironmentId,
  client,
  projectId
}: {
  activeEnvironmentId?: string;
  client: ApiClient;
  projectId: string;
}) {
  const [policy, setPolicy] = useState<DataGovernancePolicy | undefined>();
  const [retentionDraft, setRetentionDraft] = useState<Record<DataGovernanceRetentionCategory, string>>(
    () =>
      Object.fromEntries(retentionCategories.map((category) => [category.key, String(category.fallbackDays)])) as Record<
        DataGovernanceRetentionCategory,
        string
      >
  );
  const [ruleTarget, setRuleTarget] = useState<DataGovernancePropertyRuleTarget>("event.properties");
  const [rulePath, setRulePath] = useState("");
  const [ruleAction, setRuleAction] = useState<DataGovernancePropertyRule["action"]>("mask");
  const [error, setError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  const environmentId = activeEnvironmentId;
  const canUseApi = Boolean(environmentId && client.getDataGovernancePolicy && client.updateDataGovernancePolicy);

  useEffect(() => {
    let cancelled = false;
    if (!environmentId || !client.getDataGovernancePolicy) return;

    void client
      .getDataGovernancePolicy({ projectId, environmentId })
      .then(({ policy: loadedPolicy }) => {
        if (cancelled) return;
        setPolicy(loadedPolicy);
        setRetentionDraft(
          Object.fromEntries(
            retentionCategories.map((category) => [
              category.key,
              String(loadedPolicy.retentionPolicy[category.key] ?? category.fallbackDays)
            ])
          ) as Record<DataGovernanceRetentionCategory, string>
        );
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load data governance policy.");
      });

    return () => {
      cancelled = true;
    };
  }, [client, environmentId, projectId]);

  const propertyRules = policy?.propertyRules ?? [];
  const retentionRows = useMemo(
    () =>
      retentionCategories.map((category) => ({
        ...category,
        value: retentionDraft[category.key] ?? String(category.fallbackDays)
      })),
    [retentionDraft]
  );

  async function savePolicy(nextRules = propertyRules) {
    if (!environmentId || !client.updateDataGovernancePolicy || isSaving) return;

    const retentionPolicy = Object.fromEntries(
      retentionCategories.map((category) => [category.key, Number(retentionDraft[category.key] || category.fallbackDays)])
    ) as DataGovernancePolicy["retentionPolicy"];

    setError(undefined);
    setIsSaving(true);
    try {
      const response = await client.updateDataGovernancePolicy({
        projectId,
        environmentId,
        retentionPolicy,
        propertyRules: nextRules
      });
      setPolicy(response.policy);
    } catch {
      setError("Could not save data governance policy.");
    } finally {
      setIsSaving(false);
    }
  }

  async function addRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPath = rulePath.trim();
    if (!trimmedPath) return;
    const nextRules = [...propertyRules, { target: ruleTarget, path: trimmedPath, action: ruleAction }];
    await savePolicy(nextRules);
    setRulePath("");
  }

  async function removeRule(index: number) {
    await savePolicy(propertyRules.filter((_, ruleIndex) => ruleIndex !== index));
  }

  if (!environmentId) {
    return <EmptyState description="Select an environment before configuring data governance." title="No environment selected" />;
  }

  return (
    <section className="panel data-governance-panel">
      <div className="panel-header">
        <div>
          <h2>Data governance</h2>
          <p>Define how long telemetry is retained and which sensitive property paths are masked or dropped at ingestion.</p>
        </div>
      </div>
      {!canUseApi ? <p className="form-error">Data governance management is unavailable in this deployment.</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <div className="settings-grid settings-grid--two">
        <section className="subpanel">
          <h3>Retention by category</h3>
          <p className="muted-text">
            Values are stored per project environment and can shorten installation-level retention when the worker runs cleanup.
          </p>
          <div className="governance-retention-list">
            {retentionRows.map((category) => (
              <label className="governance-retention-row" key={category.key}>
                <span>
                  <strong>{category.label}</strong>
                  <small>{category.description}</small>
                </span>
                <input
                  aria-label={`${category.label} retention days`}
                  min={1}
                  max={3650}
                  onChange={(event) =>
                    setRetentionDraft((current) => ({ ...current, [category.key]: event.target.value }))
                  }
                  type="number"
                  value={category.value}
                />
                <span className="muted-text">days</span>
              </label>
            ))}
          </div>
          <button disabled={isSaving || !canUseApi} onClick={() => void savePolicy()} type="button">
            Save retention policy
          </button>
        </section>

        <section className="subpanel">
          <h3>Sensitive property rules</h3>
          <p className="muted-text">
            Use dot paths such as <code>user.email</code> or <code>headers.authorization</code>. Mask keeps the key and replaces
            the value; block removes the key.
          </p>
          {propertyRules.length === 0 ? (
            <p className="muted-text">No project-specific property rules yet. Built-in secret redaction still applies.</p>
          ) : (
            <ul className="governance-rule-list">
              {propertyRules.map((rule, index) => (
                <li key={`${rule.target}:${rule.path}:${index}`}>
                  <span>
                    <strong>{rule.action}</strong> {rule.target}.{rule.path}
                  </span>
                  <button disabled={isSaving} onClick={() => void removeRule(index)} type="button">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="compact-form" onSubmit={addRule}>
            <label>
              Target
              <select onChange={(event) => setRuleTarget(event.target.value as DataGovernancePropertyRuleTarget)} value={ruleTarget}>
                {propertyRuleTargets.map((target) => (
                  <option key={target} value={target}>
                    {target}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Property path
              <input onChange={(event) => setRulePath(event.target.value)} placeholder="user.email" value={rulePath} />
            </label>
            <label>
              Action
              <select onChange={(event) => setRuleAction(event.target.value as DataGovernancePropertyRule["action"])} value={ruleAction}>
                <option value="mask">Mask value</option>
                <option value="block">Block property</option>
              </select>
            </label>
            <button disabled={isSaving || !canUseApi} type="submit">
              Add rule
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}

function formatOptionalDate(value: string | null | undefined): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function datasetSummary(datasets: WarehouseDataset[]): string {
  return warehouseDatasets
    .filter((dataset) => datasets.includes(dataset.key))
    .map((dataset) => dataset.label)
    .join(", ");
}

function WarehouseSyncPanel({
  activeEnvironmentId,
  client,
  projectId
}: {
  activeEnvironmentId?: string;
  client: ApiClient;
  projectId: string;
}) {
  const [destinations, setDestinations] = useState<WarehouseDestination[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [runs, setRuns] = useState<WarehouseExportRun[]>([]);
  const [name, setName] = useState("");
  const [connectionUrl, setConnectionUrl] = useState("");
  const [batchSize, setBatchSize] = useState("500");
  const [datasets, setDatasets] = useState<WarehouseDataset[]>(["events", "errors"]);
  const [error, setError] = useState<string | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const canUseApi = Boolean(
    client.listWarehouseDestinations &&
      client.createWarehouseDestination &&
      client.updateWarehouseDestination &&
      client.archiveWarehouseDestination &&
      client.listWarehouseExportRuns &&
      client.runWarehouseExport
  );
  const selected = destinations.find((destination) => destination.id === selectedId) ?? destinations[0];

  useEffect(() => {
    let cancelled = false;
    setRuns([]);
    if (!activeEnvironmentId || !canUseApi || !client.listWarehouseDestinations) return () => {
      cancelled = true;
    };

    void client
      .listWarehouseDestinations({ projectId, environmentId: activeEnvironmentId })
      .then(({ destinations: loaded }) => {
        if (cancelled) return;
        setDestinations(loaded);
        setSelectedId((current) => current ?? loaded[0]?.id);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load warehouse destinations.");
      });

    return () => {
      cancelled = true;
    };
  }, [activeEnvironmentId, canUseApi, client, projectId]);

  useEffect(() => {
    let cancelled = false;
    if (!activeEnvironmentId || !selected || !client.listWarehouseExportRuns) return () => {
      cancelled = true;
    };
    void client
      .listWarehouseExportRuns(selected.id, { projectId, environmentId: activeEnvironmentId, limit: 8 })
      .then(({ runs: loaded }) => {
        if (!cancelled) setRuns(loaded);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeEnvironmentId, client, projectId, selected]);

  function toggleDataset(dataset: WarehouseDataset) {
    setDatasets((current) => {
      if (current.includes(dataset)) {
        const next = current.filter((item) => item !== dataset);
        return next.length > 0 ? next : current;
      }
      return [...current, dataset];
    });
  }

  async function reloadRuns(destination: WarehouseDestination) {
    if (!activeEnvironmentId || !client.listWarehouseExportRuns) return;
    const response = await client.listWarehouseExportRuns(destination.id, {
      projectId,
      environmentId: activeEnvironmentId,
      limit: 8
    });
    setRuns(response.runs);
  }

  async function createDestination(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeEnvironmentId || !client.createWarehouseDestination) return;
    setError(undefined);
    setIsBusy(true);
    try {
      const response = await client.createWarehouseDestination({
        projectId,
        environmentId: activeEnvironmentId,
        name: name.trim(),
        destinationType: "postgres",
        connectionUrl: connectionUrl.trim(),
        datasets,
        batchSize: Number(batchSize),
        enabled: true
      });
      setDestinations((current) => [...current, response.destination]);
      setSelectedId(response.destination.id);
      setName("");
      setConnectionUrl("");
      setBatchSize("500");
    } catch {
      setError("Could not create warehouse destination.");
    } finally {
      setIsBusy(false);
    }
  }

  async function toggleEnabled(destination: WarehouseDestination) {
    if (!activeEnvironmentId || !client.updateWarehouseDestination) return;
    setError(undefined);
    setIsBusy(true);
    try {
      const response = await client.updateWarehouseDestination(destination.id, {
        projectId,
        environmentId: activeEnvironmentId,
        enabled: !destination.enabled
      });
      setDestinations((current) => current.map((item) => (item.id === destination.id ? response.destination : item)));
    } catch {
      setError("Could not update warehouse destination.");
    } finally {
      setIsBusy(false);
    }
  }

  async function runNow(destination: WarehouseDestination) {
    if (!activeEnvironmentId || !client.runWarehouseExport) return;
    setError(undefined);
    setIsBusy(true);
    try {
      await client.runWarehouseExport(destination.id, { projectId, environmentId: activeEnvironmentId });
      await reloadRuns(destination);
    } catch {
      setError("Could not start warehouse export.");
    } finally {
      setIsBusy(false);
    }
  }

  async function archive(destination: WarehouseDestination) {
    if (!activeEnvironmentId || !client.archiveWarehouseDestination) return;
    if (!window.confirm(`Archive warehouse destination ${destination.name}?`)) return;
    setError(undefined);
    setIsBusy(true);
    try {
      await client.archiveWarehouseDestination(destination.id, { projectId, environmentId: activeEnvironmentId });
      setDestinations((current) => current.filter((item) => item.id !== destination.id));
      setSelectedId(undefined);
      setRuns([]);
    } catch {
      setError("Could not archive warehouse destination.");
    } finally {
      setIsBusy(false);
    }
  }

  if (!activeEnvironmentId) {
    return <EmptyState description="Select an environment before configuring warehouse exports." title="No environment selected" />;
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Warehouse sync</h2>
          <p>Export selected telemetry datasets to a Postgres analytical landing table with incremental cursors.</p>
        </div>
      </div>
      {!canUseApi ? <p className="form-error">Warehouse sync management is unavailable in this deployment.</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <div className="settings-grid settings-grid--two">
        <section className="subpanel">
          <h3>Destinations</h3>
          {destinations.length === 0 ? <p className="muted-text">No warehouse destinations configured yet.</p> : null}
          <ul className="governance-rule-list">
            {destinations.map((destination) => (
              <li key={destination.id}>
                <button onClick={() => setSelectedId(destination.id)} type="button">
                  <span>
                    <strong>{destination.name}</strong>
                    {destination.enabled ? " enabled" : " paused"} · {datasetSummary(destination.datasets)}
                    <br />
                    <small>{destination.connectionUrlPreview}</small>
                  </span>
                </button>
                <button disabled={isBusy} onClick={() => void runNow(destination)} type="button">
                  Run now
                </button>
                <button disabled={isBusy} onClick={() => void toggleEnabled(destination)} type="button">
                  {destination.enabled ? "Pause" : "Resume"}
                </button>
                <button disabled={isBusy} onClick={() => void archive(destination)} type="button">
                  Archive
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="subpanel">
          <h3>Create Postgres destination</h3>
          <p className="muted-text">
            Sigmon writes into <code>sigmon_telemetry_export</code> using idempotent upserts by dataset and source id.
          </p>
          <form className="compact-form" onSubmit={createDestination}>
            <label>
              Name
              <input onChange={(event) => setName(event.target.value)} placeholder="Warehouse prod" value={name} />
            </label>
            <label>
              Postgres connection URL
              <input
                onChange={(event) => setConnectionUrl(event.target.value)}
                placeholder="postgres://writer:password@host:5432/analytics"
                type="password"
                value={connectionUrl}
              />
            </label>
            <label>
              Batch size
              <input min={1} max={5000} onChange={(event) => setBatchSize(event.target.value)} type="number" value={batchSize} />
            </label>
            <div>
              <strong>Datasets</strong>
              <div className="segmented-control">
                {warehouseDatasets.map((dataset) => (
                  <button
                    className={datasets.includes(dataset.key) ? "is-active" : ""}
                    key={dataset.key}
                    onClick={() => toggleDataset(dataset.key)}
                    type="button"
                  >
                    {dataset.label}
                  </button>
                ))}
              </div>
            </div>
            <button disabled={isBusy || !canUseApi || !name.trim() || !connectionUrl.trim()} type="submit">
              Create destination
            </button>
          </form>
        </section>
      </div>

      <section className="subpanel">
        <h3>Selected destination status</h3>
        {selected ? (
          <>
            <div className="settings-grid settings-grid--two">
              <p>
                <strong>Last success</strong>
                <br />
                {formatOptionalDate(selected.lastSuccessAt)}
              </p>
              <p>
                <strong>Last failure</strong>
                <br />
                {formatOptionalDate(selected.lastFailureAt)}
              </p>
            </div>
            {selected.lastErrorMessage ? <p className="form-error">{selected.lastErrorMessage}</p> : null}
            {runs.length === 0 ? <p className="muted-text">No export runs recorded yet.</p> : null}
            <ul className="governance-rule-list">
              {runs.map((run) => (
                <li key={run.id}>
                  <span>
                    <strong>{run.status}</strong> · {run.trigger} · {formatOptionalDate(run.startedAt)}
                    <br />
                    <small>
                      Events {run.exported.events ?? 0}, errors {run.exported.errors ?? 0}, traces {run.exported.traces ?? 0}, LLM{" "}
                      {run.exported.llmCalls ?? 0}
                    </small>
                  </span>
                  {run.errorMessage ? <span className="form-error">{run.errorMessage}</span> : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted-text">Select or create a destination to inspect export runs.</p>
        )}
      </section>
    </section>
  );
}

export function ProjectSettingsWorkspace({
  activeEnvironment,
  activeProject,
  activeProjectId,
  apiEndpoint,
  client,
  environments,
  isEnvironmentCreationDisabled,
  latestSecret,
  onArchiveEnvironment,
  onCreateEnvironment,
  onArchiveProject,
  onSecretCreated,
  onSelectEnvironment,
  onUpdateProject,
  onUpdateEnvironment
}: Props) {
  const [activeSectionId, setActiveSectionId] = useState<SectionId>("project");
  const activeEnvironmentId = activeEnvironment?.id;

  function renderSection() {
    if (!activeProjectId) {
      return (
        <EmptyState
          description="Create or select a project before changing project settings."
          title="No project selected"
        />
      );
    }

    switch (activeSectionId) {
      case "project":
        return activeProject ? (
          <ProjectManagementPanel
            onArchiveProject={onArchiveProject}
            onUpdateProject={onUpdateProject}
            project={activeProject}
          />
        ) : (
          <EmptyState
            description="Select a project before changing project settings."
            title="No project selected"
          />
        );
      case "api-keys":
        return (
          <ApiKeyPanel
            client={client}
            environmentId={activeEnvironmentId}
            onSecretCreated={onSecretCreated}
            projectId={activeProjectId}
          />
        );
      case "browser-origins":
        return <BrowserOriginsPanel client={client} projectId={activeProjectId} />;
      case "data-governance":
        return (
          <DataGovernancePanel
            activeEnvironmentId={activeEnvironmentId}
            client={client}
            projectId={activeProjectId}
          />
        );
      case "warehouse-sync":
        return (
          <WarehouseSyncPanel
            activeEnvironmentId={activeEnvironmentId}
            client={client}
            projectId={activeProjectId}
          />
        );
      case "sdk-snippets":
        return (
          <SnippetPanel
            apiEndpoint={apiEndpoint}
            environmentId={activeEnvironmentId}
            latestSecret={latestSecret}
            projectId={activeProjectId}
          />
        );
      case "source-maps":
        return <ArtifactsPanel client={client} environmentId={activeEnvironmentId} projectId={activeProjectId} />;
      case "console-users":
        return (
          <>
            <p className="muted-text">Console users are installation-level accounts, not project-scoped members.</p>
            <UserAdminPanel client={client} />
          </>
        );
      case "environments":
      default:
        return (
          <EnvironmentSelector
            activeEnvironmentId={activeEnvironmentId}
            disabled={isEnvironmentCreationDisabled}
            environments={environments}
            onArchive={onArchiveEnvironment}
            onCreate={onCreateEnvironment}
            onSelect={onSelectEnvironment}
            onUpdate={onUpdateEnvironment}
          />
        );
    }
  }

  return (
    <section className="settings-workspace project-settings-workspace">
      <header className="settings-workspace__header">
        <h1>Project Settings</h1>
        <p>Recurring configuration for the selected project and environment.</p>
      </header>
      {activeProjectId ? (
        <ProjectOnboardingChecklist
          activeEnvironment={activeEnvironment}
          activeProjectId={activeProjectId}
          apiEndpoint={apiEndpoint}
          latestSecret={latestSecret}
        />
      ) : null}
      <div className="settings-workspace__body">
        <SettingsSectionNav
          activeSectionId={activeSectionId}
          ariaLabel="Project settings sections"
          onSelectSection={(sectionId) => setActiveSectionId(sectionId as SectionId)}
          sections={sections}
        />
        <div className="settings-workspace__content">{renderSection()}</div>
      </div>
    </section>
  );
}

function ProjectManagementPanel({
  onArchiveProject,
  onUpdateProject,
  project
}: {
  onArchiveProject: (projectId: string) => Promise<void>;
  onUpdateProject: (projectId: string, input: { name?: string }) => Promise<void>;
  project: Project;
}) {
  const [name, setName] = useState(project.name);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  useEffect(() => {
    setName(project.name);
  }, [project.name]);

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name || isSaving) return;

    setIsSaving(true);
    try {
      await onUpdateProject(project.id, { name: trimmed });
    } finally {
      setIsSaving(false);
    }
  }

  async function archiveProject() {
    if (isArchiving) return;
    if (!window.confirm(`Archive project ${project.name}? This hides it from the project switcher.`)) return;

    setIsArchiving(true);
    try {
      await onArchiveProject(project.id);
    } finally {
      setIsArchiving(false);
    }
  }

  return (
    <section className="panel project-management-panel">
      <div className="panel-header">
        <div>
          <h2>Project</h2>
          <p className="muted-text">Project settings apply to every environment, key, monitor, and artifact inside this project.</p>
        </div>
      </div>
      <form className="inline-form" onSubmit={saveProject}>
        <label>
          Project name
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <button disabled={!name.trim() || name.trim() === project.name || isSaving} type="submit">
          {isSaving ? "Saving" : "Save project"}
        </button>
      </form>
      <div className="danger-zone">
        <div>
          <h3>Archive project</h3>
          <p className="muted-text">Archived projects are hidden from the switcher. Existing telemetry remains stored until retention removes it.</p>
        </div>
        <button aria-label={`Archive ${project.name}`} disabled={isArchiving} onClick={() => void archiveProject()} type="button">
          {isArchiving ? "Archiving" : "Archive project"}
        </button>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { ScreenCtx } from "../registry";
import { ConfirmButton, EmptyHint, Icon, Sparkline } from "../../../components/ui/v2";
import {
  EMPTY_TREND_FORM,
  insightToForm,
  useTrends,
  validateTrendForm,
  type TrendFilter,
  type TrendForm,
} from "./useTrends";

const SERIES_COLORS = ["var(--accent)", "#58a6ff", "#d2a8ff", "#ffa657", "#ff7b72"];

function total(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function formatBucket(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
      <span className="sh-label">{label}</span>
      {children}
      {hint ? <span className="sh-faint" style={{ fontSize: 10.5 }}>{hint}</span> : null}
    </label>
  );
}

function FilterRow({
  filter,
  index,
  properties,
  onChange,
  onRemove,
}: {
  filter: TrendFilter;
  index: number;
  properties: string[];
  onChange: (next: TrendFilter) => void;
  onRemove: () => void;
}) {
  const needsValue = filter.operator === "eq" || filter.operator === "neq";
  return (
    <div className="sh-trend-filter-row">
      <input
        aria-label={`Filter ${index + 1} property`}
        className="sh-input"
        list="trend-promoted-properties"
        placeholder="Property"
        value={filter.property}
        onChange={(event) => onChange({ ...filter, property: event.target.value })}
      />
      <select
        aria-label={`Filter ${index + 1} operator`}
        className="sh-input"
        value={filter.operator}
        onChange={(event) => {
          const operator = event.target.value as TrendFilter["operator"];
          onChange(operator === "eq" || operator === "neq"
            ? { property: filter.property, operator, value: filter.value ?? "" }
            : { property: filter.property, operator });
        }}
      >
        <option value="eq">Equals</option>
        <option value="neq">Does not equal</option>
        <option value="exists">Exists</option>
        <option value="not_exists">Does not exist</option>
      </select>
      <input
        aria-label={`Filter ${index + 1} value`}
        className="sh-input"
        disabled={!needsValue}
        placeholder="Exact value"
        value={filter.value ?? ""}
        onChange={(event) => {
          if (filter.operator === "eq" || filter.operator === "neq") {
            onChange({ ...filter, value: event.target.value });
          }
        }}
      />
      <button aria-label={`Remove filter ${index + 1}`} className="sh-btn ghost icon" type="button" onClick={onRemove}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

function Preview({ state, data }: { state: ReturnType<typeof useTrends>["previewStatus"]; data: ReturnType<typeof useTrends>["preview"] }) {
  if (state === "idle") {
    return <EmptyHint icon="pulse" title="Ready to preview" sub="Run the current definition to inspect its time series before saving." />;
  }
  if (state === "loading") {
    return <p className="sh-muted" role="status" style={{ fontSize: 12, padding: 16 }}>Querying trend…</p>;
  }
  if (state === "unavailable") {
    return <EmptyHint icon="alert" title="Trend queries unavailable" sub="This Sigmon API does not expose analytics trend queries yet." />;
  }
  if (state === "error") {
    return <EmptyHint icon="alert" title="Preview failed" sub="Check the definition or try the query again." />;
  }
  if (!data || data.buckets.length === 0 || data.series.length === 0) {
    return <EmptyHint icon="pulse" title="No activity" sub="No events matched this definition and analysis window." />;
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div>
          <div className="sh-label">Series preview</div>
          <div className="sh-faint" style={{ fontSize: 11 }}>{formatBucket(data.buckets[0])} – {formatBucket(data.buckets.at(-1) ?? "")}</div>
        </div>
        <span className="sh-tag">{data.buckets.length} buckets</span>
      </div>
      {data.series.map((series, index) => {
        const label = "label" in series && typeof series.label === "string" ? series.label : series.key;
        return (
        <div key={series.key} style={{ display: "grid", gap: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</strong>
            <span className="sh-mono" style={{ fontSize: 12 }}>{total(series.values).toLocaleString()}</span>
          </div>
          <Sparkline data={series.values.length > 0 ? series.values : [0]} color={SERIES_COLORS[index % SERIES_COLORS.length]} height={54} />
        </div>
      );})}
    </div>
  );
}

export function TrendsTab({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const trends = useTrends({ client: ctx.client, projectId, environmentId });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<TrendForm>(EMPTY_TREND_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [propertyName, setPropertyName] = useState("");
  const [propertyLabel, setPropertyLabel] = useState("");
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const initializedLibrary = useRef(false);
  const scopeKey = `${projectId ?? ""}:${environmentId ?? ""}`;
  const readyProperties = useMemo(
    () => trends.properties.filter((row) => row.indexStatus === "ready"),
    [trends.properties]
  );
  const promotedNames = useMemo(() => readyProperties.map((row) => row.property), [readyProperties]);

  useEffect(() => {
    initializedLibrary.current = false;
    setSelectedId(null);
    setForm(EMPTY_TREND_FORM);
    setFormError(null);
  }, [scopeKey]);

  useEffect(() => {
    if (trends.status !== "ok" || initializedLibrary.current) return;
    initializedLibrary.current = true;
    const first = trends.insights[0];
    if (first) {
      setSelectedId(first.id);
      setForm(insightToForm(first));
    } else {
      setSelectedId(null);
      setForm(EMPTY_TREND_FORM);
    }
  }, [scopeKey, trends.insights, trends.status]);

  const selectInsight = (id: string) => {
    const insight = trends.insights.find((row) => row.id === id);
    if (!insight) return;
    setSelectedId(id);
    setForm(insightToForm(insight));
    setFormError(null);
  };

  const startNew = () => {
    setSelectedId(null);
    setForm(EMPTY_TREND_FORM);
    setFormError(null);
  };

  const save = async () => {
    const error = validateTrendForm(form);
    setFormError(error);
    if (error) return;
    const saved = await trends.save(form, selectedId ?? undefined);
    if (!saved) {
      setFormError("Could not save this insight.");
      return;
    }
    setSelectedId(saved.id);
    setForm(insightToForm(saved));
    ctx.pushToast(selectedId ? "Insight updated" : "Insight created");
  };

  const archive = async () => {
    if (!selectedId) return;
    const archived = await trends.archive(selectedId);
    if (!archived) {
      setFormError("Could not archive this insight.");
      return;
    }
    startNew();
    ctx.pushToast("Insight archived");
  };

  const promoteProperty = async () => {
    if (!propertyName.trim()) {
      setPropertyError("Property name is required.");
      return;
    }
    setPropertyError(null);
    const promoted = await trends.promoteProperty(propertyName, propertyLabel);
    if (!promoted) {
      setPropertyError("Could not create the property index.");
      return;
    }
    setPropertyName("");
    setPropertyLabel("");
    ctx.pushToast(promoted.indexStatus === "ready" ? "Property indexed" : "Property promotion saved");
  };

  const archiveProperty = async (id: string) => {
    if (!await trends.archiveProperty(id)) {
      setPropertyError("Could not remove the property index.");
      return;
    }
    ctx.pushToast("Property index removed");
  };

  if (trends.status === "unavailable") {
    return (
      <div className="sh-card">
        <EmptyHint icon="pulse" title="Saved trends unavailable" sub="Deploy an API version with analytics insights to use this workspace." />
      </div>
    );
  }

  return (
    <div className="sh-trends-workspace">
      <section className="sh-card" aria-label="Saved insight library">
        <div className="sh-card__head">
          <div>
            <h2 className="sh-h2">Saved insights</h2>
            <div className="sh-faint" style={{ fontSize: 11 }}>{trends.insights.length} reusable trends</div>
          </div>
          <button aria-label="Create new insight" className="sh-btn ghost icon" type="button" onClick={startNew}>
            <Icon name="plus" size={15} />
          </button>
        </div>
        <div className="sh-card__body flush">
          {trends.status === "loading" ? <p className="sh-muted" role="status" style={{ fontSize: 12, padding: 14 }}>Loading insights…</p> : null}
          {trends.status === "error" ? (
            <EmptyHint icon="alert" title="Library unavailable" sub="Saved insights could not be loaded." />
          ) : null}
          {trends.status === "ok" && trends.insights.length === 0 ? (
            <EmptyHint icon="pulse" title="No saved insights" sub="Create a trend definition to make this library useful." />
          ) : null}
          {trends.insights.map((insight) => (
            <button
              aria-pressed={selectedId === insight.id}
              className={`sh-row ${selectedId === insight.id ? "selected" : ""}`}
              key={insight.id}
              onClick={() => selectInsight(insight.id)}
              style={{ border: 0, borderBottom: "1px solid var(--border-subtle)", width: "100%", textAlign: "left", display: "block", cursor: "pointer" }}
              type="button"
            >
              <strong style={{ display: "block", fontSize: 12.5 }}>{insight.name}</strong>
              <span className="sh-faint" style={{ display: "block", fontSize: 10.5, marginTop: 3 }}>
                {insight.definition.eventName ?? "All events"} · {insight.definition.metric === "count" ? "Count" : "Unique actors"}
              </span>
            </button>
          ))}
        </div>
        <div className="sh-card__head" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <div>
            <h2 className="sh-h2">Indexed properties</h2>
            <div className="sh-faint" style={{ fontSize: 11 }}>Required for fast breakdowns.</div>
          </div>
          <span className="sh-tag">{trends.properties.length}</span>
        </div>
        <div className="sh-card__body" style={{ display: "grid", gap: 8 }}>
          {trends.properties.length === 0 ? (
            <p className="sh-faint" style={{ fontSize: 11, margin: 0 }}>No indexed event properties yet.</p>
          ) : null}
          {trends.properties.map((property) => (
            <div key={property.id} style={{ display: "grid", gap: 4, paddingBottom: 8, borderBottom: "1px solid var(--border-subtle)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: 12 }}>{property.displayName}</strong>
                  <span className="sh-mono sh-faint" style={{ display: "block", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis" }}>{property.property}</span>
                </div>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  <span className={`sh-tag ${property.indexStatus === "ready" ? "ok" : property.indexStatus === "failed" ? "bad" : ""}`}>
                    {property.indexStatus}
                  </span>
                  <ConfirmButton
                    ariaLabel={`Remove ${property.displayName} index`}
                    confirmAriaLabel={`Confirm remove ${property.displayName} index`}
                    confirmLabel="Remove?"
                    icon="x"
                    kind="ghost"
                    label=""
                    onConfirm={() => void archiveProperty(property.id)}
                  />
                </div>
              </div>
              {property.indexStatus === "failed" && property.indexError ? (
                <span className="sh-faint" title={property.indexError} style={{ color: "var(--sev-critical)", fontSize: 10.5 }}>Index creation failed. Submit the property again to retry.</span>
              ) : null}
            </div>
          ))}
          <Field label="Property key" hint="Exact key stored in event properties, for example plan or country.">
            <input aria-label="Promoted property key" className="sh-input" placeholder="plan" value={propertyName} onChange={(event) => setPropertyName(event.target.value)} />
          </Field>
          <Field label="Display name">
            <input aria-label="Promoted property display name" className="sh-input" placeholder="Subscription plan" value={propertyLabel} onChange={(event) => setPropertyLabel(event.target.value)} />
          </Field>
          {propertyError ? <p role="alert" style={{ color: "var(--sev-critical)", fontSize: 11, margin: 0 }}>{propertyError}</p> : null}
          <button className="sh-btn ghost" disabled={trends.busy} type="button" onClick={() => void promoteProperty()}>
            <Icon name="plus" size={13} /> Create index
          </button>
        </div>
      </section>

      <section className="sh-card" aria-label="Trend builder">
        <div className="sh-card__head">
          <div>
            <h2 className="sh-h2">{selectedId ? "Edit insight" : "New insight"}</h2>
            <div className="sh-faint" style={{ fontSize: 11 }}>Define a reusable product signal and preview it live.</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {selectedId ? (
              <button className="sh-btn ghost" type="button" onClick={() => {
                setSelectedId(null);
                setForm({ ...form, name: `Copy of ${form.name}` });
                setFormError(null);
              }}>
                <Icon name="copy" size={13} /> Duplicate
              </button>
            ) : null}
            <button className="sh-btn ghost" disabled={trends.previewStatus === "loading"} type="button" onClick={() => void trends.runPreview(form)}>
              <Icon name="play" size={13} /> Preview
            </button>
          </div>
        </div>
        <div className="sh-card__body" style={{ display: "grid", gap: 12 }}>
          <div className="sh-trends-fields-2">
            <Field label="Insight name">
              <input aria-label="Insight name" className="sh-input" placeholder="e.g. Checkout conversion starts" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label="Event name" hint="Leave empty to count every event in the environment.">
              <input aria-label="Event name" className="sh-input" placeholder="checkout.started" value={form.eventName} onChange={(event) => setForm({ ...form, eventName: event.target.value })} />
            </Field>
          </div>
          <Field label="Description">
            <textarea aria-label="Description" className="sh-input" placeholder="What decision does this insight support?" rows={2} style={{ resize: "vertical" }} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <div className="sh-trends-fields-4">
            <Field label="Metric">
              <select aria-label="Metric" className="sh-input" value={form.metric} onChange={(event) => setForm({ ...form, metric: event.target.value as TrendForm["metric"] })}>
                <option value="count">Event count</option>
                <option value="unique_actors">Unique actors</option>
              </select>
            </Field>
            <Field label="Window">
              <select aria-label="Analysis window" className="sh-input" value={form.window} onChange={(event) => setForm({ ...form, window: event.target.value as TrendForm["window"] })}>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </Field>
            <Field label="Time bucket">
              <select aria-label="Time bucket" className="sh-input" value={form.bucket} onChange={(event) => setForm({ ...form, bucket: event.target.value as TrendForm["bucket"] })}>
                <option value="hour">Hourly</option>
                <option value="day">Daily</option>
              </select>
            </Field>
            <Field label="Break down by" hint={promotedNames.length === 0 ? "Promote properties in governance first." : undefined}>
              <select aria-label="Breakdown property" className="sh-input" value={form.breakdownProperty} onChange={(event) => setForm({ ...form, breakdownProperty: event.target.value })}>
                <option value="">No breakdown</option>
                {readyProperties.map((property) => <option key={property.id} value={property.property}>{property.displayName}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: "grid", gap: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div className="sh-label">Property filters</div>
                <div className="sh-faint" style={{ fontSize: 10.5 }}>Exact-match filters are combined with AND.</div>
              </div>
              <button className="sh-btn ghost" type="button" onClick={() => setForm({ ...form, filters: [...form.filters, { property: "", operator: "eq", value: "" }] })}>
                <Icon name="plus" size={13} /> Add filter
              </button>
            </div>
            {form.filters.map((filter, index) => (
              <FilterRow
                filter={filter}
                index={index}
                key={index}
                properties={promotedNames}
                onChange={(next) => setForm({ ...form, filters: form.filters.map((row, rowIndex) => rowIndex === index ? next : row) })}
                onRemove={() => setForm({ ...form, filters: form.filters.filter((_, rowIndex) => rowIndex !== index) })}
              />
            ))}
            <datalist id="trend-promoted-properties">
              {promotedNames.map((property) => <option key={property} value={property} />)}
            </datalist>
          </div>
          {formError ? <p role="alert" style={{ color: "var(--sev-critical)", fontSize: 12, margin: 0 }}>{formError}</p> : null}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div>
              {selectedId ? (
                <ConfirmButton
                  ariaLabel="Archive insight"
                  confirmAriaLabel="Confirm archive insight"
                  confirmLabel="Archive?"
                  icon="archive"
                  kind="ghost"
                  label="Archive"
                  onConfirm={() => void archive()}
                />
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="sh-btn ghost" disabled={trends.previewStatus === "loading"} type="button" onClick={() => void trends.runPreview(form)}>Preview</button>
              <button className="sh-btn primary" disabled={trends.busy} type="button" onClick={() => void save()}>
                {trends.busy ? "Saving…" : selectedId ? "Save changes" : "Save insight"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="sh-card" aria-label="Trend preview">
        <div className="sh-card__head">
          <div>
            <h2 className="sh-h2">Preview</h2>
            <div className="sh-faint" style={{ fontSize: 11 }}>{form.window} · {form.bucket} buckets</div>
          </div>
          {trends.preview?.series.length ? <span className="sh-tag ok">Live query</span> : null}
        </div>
        <div className="sh-card__body">
          <Preview state={trends.previewStatus} data={trends.preview} />
        </div>
      </section>
    </div>
  );
}

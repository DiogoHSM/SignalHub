import { useEffect, useState } from "react";
import { ConfirmButton, EmptyHint, Icon, SummaryStat } from "../../../components/ui/v2";
import type { ScreenCtx } from "../registry";
import { useCampaigns } from "./useCampaigns";
import type { CampaignRowVM, CreateCampaignForm } from "./useCampaigns";
import type { MessageCampaignChannelType, MessageCampaignStatus } from "../../../api/types";

const ROW_GRID = "1.2fr 90px 100px 1fr 90px";

const DEFAULT_FORM: CreateCampaignForm = {
  key: "invoice_activation",
  name: "Invoice activation",
  channelType: "in_app",
  notificationChannelId: "",
  segmentId: "",
  conversionEvent: "invoice.paid",
  subject: "",
  body: "Create your first invoice to finish onboarding.",
  ctaUrl: "",
  consentCategory: "product",
};

function CreateCampaignCard({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (form: CreateCampaignForm) => void;
}) {
  const [form, setForm] = useState<CreateCampaignForm>(DEFAULT_FORM);

  function set<K extends keyof CreateCampaignForm>(key: K, value: CreateCampaignForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const needsChannel = form.channelType === "email" || form.channelType === "webhook";
  const valid =
    form.key.trim().length > 0 &&
    form.name.trim().length > 0 &&
    form.body.trim().length > 0 &&
    (!needsChannel || form.notificationChannelId.trim().length > 0);

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">New message campaign</h2>
        <button className="sh-btn ghost" style={{ padding: "4px 8px" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 12, padding: 16 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Campaign key</span>
          <input className="sh-input sh-mono" value={form.key} onChange={(e) => set("key", e.target.value)} />
          <span className="sh-faint">Stable key used when emitting campaign events.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Campaign name</span>
          <input className="sh-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <span className="sh-faint">Operator-facing name for this message.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Channel</span>
          <select
            className="sh-select"
            value={form.channelType}
            onChange={(e) => set("channelType", e.target.value as MessageCampaignChannelType)}
          >
            <option value="in_app">In-app</option>
            <option value="email">Email</option>
            <option value="webhook">Webhook</option>
          </select>
          <span className="sh-faint">In-app is definition-only; email/webhook require an existing notification channel id.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Notification channel id</span>
          <input
            className="sh-input sh-mono"
            value={form.notificationChannelId}
            onChange={(e) => set("notificationChannelId", e.target.value)}
          />
          <span className="sh-faint">Required for email or webhook delivery.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Segment id</span>
          <input className="sh-input sh-mono" value={form.segmentId} onChange={(e) => set("segmentId", e.target.value)} />
          <span className="sh-faint">Optional analytics segment that defines the target audience.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Conversion event</span>
          <input className="sh-input sh-mono" value={form.conversionEvent} onChange={(e) => set("conversionEvent", e.target.value)} />
          <span className="sh-faint">Event counted as business impact for this campaign.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Subject</span>
          <input className="sh-input" value={form.subject} onChange={(e) => set("subject", e.target.value)} />
          <span className="sh-faint">Optional email or in-app heading.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">CTA URL</span>
          <input className="sh-input sh-mono" value={form.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} />
          <span className="sh-faint">Optional destination used by click tracking.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Consent category</span>
          <input className="sh-input sh-mono" value={form.consentCategory} onChange={(e) => set("consentCategory", e.target.value)} />
          <span className="sh-faint">Opt-out bucket, for example product or marketing.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Message body</span>
          <textarea className="sh-input" value={form.body} onChange={(e) => set("body", e.target.value)} />
          <span className="sh-faint">Short copy shown or sent by the integration layer.</span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="sh-btn primary" disabled={!valid || busy} onClick={() => onCreate(form)}>
            Create campaign
          </button>
        </div>
      </div>
    </div>
  );
}

export function CampaignsTab({ ctx, enabled }: { ctx: ScreenCtx; enabled: boolean }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);

  const { data, status, busy, createCampaign, updateCampaignStatus, archiveCampaign } = useCampaigns({
    client: ctx.client,
    projectId,
    environmentId,
    selectedId,
    enabled,
  });

  useEffect(() => {
    if (!data) return;
    if (!data.rows.some((r) => r.id === selectedId)) {
      setSelectedId(data.rows[0]?.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (status === "loading" && !data) {
    return <EmptyHint icon="flag" title="Loading message campaigns…" sub="Fetching campaigns for this environment." />;
  }

  if (status === "error" || !data) {
    return (
      <EmptyHint
        icon="flag"
        title="Message campaigns unavailable"
        sub="This installation may not support message campaigns, or the request failed."
      />
    );
  }

  async function handleCreate(form: CreateCampaignForm) {
    const ok = await createCampaign(form);
    if (ok) {
      setShowCreate(false);
      ctx.pushToast("Campaign created");
    } else {
      ctx.pushToast("Failed to create campaign");
    }
  }

  async function handleToggle(row: CampaignRowVM) {
    const next: MessageCampaignStatus = row.status === "active" ? "paused" : "active";
    const ok = await updateCampaignStatus(row.id, next);
    if (!ok) ctx.pushToast("Failed to update campaign");
  }

  async function handleArchive(id: string) {
    const ok = await archiveCampaign(id);
    if (!ok) ctx.pushToast("Failed to archive campaign");
  }

  const selectedRow = data.rows.find((r) => r.id === selectedId);
  const selected = data.selected;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="sh-btn primary" disabled={busy} onClick={() => setShowCreate((v) => !v)}>
          <Icon name="plus" size={13} />
          New campaign
        </button>
      </div>

      {showCreate ? <CreateCampaignCard busy={busy} onCancel={() => setShowCreate(false)} onCreate={handleCreate} /> : null}

      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Message campaigns</h2>
          <span className="sh-faint" style={{ fontSize: 11 }}>{data.rows.length} definitions</span>
        </div>
        <div className="sh-card__body flush">
          {data.rows.length === 0 ? (
            <EmptyHint
              icon="flag"
              title="No campaigns yet"
              sub="Create one, then emit campaign events to measure delivery and impact."
            />
          ) : (
            <>
              <div className="sh-row sh-row__head" style={{ gridTemplateColumns: ROW_GRID }}>
                <span>Campaign</span>
                <span>Status</span>
                <span>Channel</span>
                <span>Conversion</span>
                <span>Actions</span>
              </div>
              {data.rows.map((row) => (
                <div
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className={`sh-row sh-row--btn${row.id === selectedId ? " is-active" : ""}`}
                  style={{ gridTemplateColumns: ROW_GRID, width: "100%", textAlign: "left", cursor: "pointer" }}
                  onClick={() => setSelectedId(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(row.id);
                    }
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 12.5 }}>{row.name}</strong>
                    <div className="sh-faint sh-mono" style={{ fontSize: 11 }}>{row.key}</div>
                  </div>
                  <span className="sh-tag">{row.status}</span>
                  <span className="sh-tag">{row.channelType}</span>
                  <span className="sh-faint sh-mono" style={{ fontSize: 11.5 }}>{row.conversionEvent}</span>
                  <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      className="sh-iconbtn-sm"
                      title={row.status === "active" ? "Pause" : "Activate"}
                      disabled={busy}
                      onClick={() => handleToggle(row)}
                    >
                      <Icon name={row.status === "active" ? "clock" : "play"} size={13} />
                    </button>
                    <ConfirmButton
                      label={<Icon name="archive" size={13} />}
                      confirmLabel="Confirm"
                      onConfirm={() => handleArchive(row.id)}
                    />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Campaign results</h2>
        </div>
        <div className="sh-card__body">
          {!selectedRow ? (
            <EmptyHint icon="flag" title="Select a campaign" sub="Pick a campaign above to inspect delivery, engagement, and opt-outs." />
          ) : !selected ? (
            <EmptyHint icon="activity" title="No report yet" sub="This campaign has no recorded events in the last 30 days." />
          ) : (
            <>
              <p className="sh-faint" style={{ fontSize: 12, margin: "0 0 12px" }}>{selected.privacyNote}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 12 }}>
                <SummaryStat label="Delivered" value={selected.totals.delivered} />
                <SummaryStat label="Opened" value={selected.totals.opened} />
                <SummaryStat label="Clicked" value={selected.totals.clicked} />
                <SummaryStat label="Converted" value={selected.totals.converted} />
                <SummaryStat label="Opt-outs" value={selected.totals.optedOut} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
                <SummaryStat label="Delivery" value={selected.rates.deliveryRatePct} />
                <SummaryStat label="Open" value={selected.rates.openRatePct} />
                <SummaryStat label="Click" value={selected.rates.clickRatePct} />
                <SummaryStat label="Conversion" value={selected.rates.conversionRatePct} />
                <SummaryStat label="Opt-out" value={selected.rates.optOutRatePct} />
              </div>
              {selected.recentEvents.length === 0 ? (
                <p className="sh-faint" style={{ fontSize: 12 }}>No campaign events in this window yet.</p>
              ) : (
                <div>
                  <div className="sh-row sh-row__head" style={{ gridTemplateColumns: "1fr 90px 1fr 1fr" }}>
                    <span>Occurred</span>
                    <span>Type</span>
                    <span>Actor</span>
                    <span>Tenant</span>
                  </div>
                  {selected.recentEvents.map((e) => (
                    <div key={e.id} className="sh-row" style={{ gridTemplateColumns: "1fr 90px 1fr 1fr" }}>
                      <span className="sh-faint sh-mono">{e.occurredAtLabel}</span>
                      <span className="sh-tag">{e.type}</span>
                      <span>{e.actorLabel}</span>
                      <span className="sh-faint">{e.tenantLabel}</span>
                    </div>
                  ))}
                </div>
              )}
              {selected.optOutsCount > 0 ? (
                <p className="sh-faint" style={{ fontSize: 12, marginTop: 8 }}>
                  {selected.optOutsCount} opt-out records apply to this campaign or category.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../../api/client";
import type {
  MessageCampaign,
  MessageCampaignChannelType,
  MessageCampaignEvent,
  MessageCampaignResultsResponse,
  MessageCampaignStatus,
} from "../../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type CampaignRowVM = {
  id: string;
  key: string;
  name: string;
  status: MessageCampaignStatus;
  channelType: MessageCampaignChannelType;
  conversionEvent: string;
};

export type CampaignEventRowVM = {
  id: string;
  occurredAtLabel: string;
  type: MessageCampaignEvent["type"];
  actorLabel: string;
  tenantLabel: string;
};

export type SelectedCampaignVM = {
  id: string;
  status: MessageCampaignStatus;
  channelType: MessageCampaignChannelType;
  conversionEvent: string;
  consentCategory: string;
  privacyNote: string;
  totals: {
    queued: number;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    converted: number;
    failed: number;
    optedOut: number;
    uniqueActors: number;
  };
  rates: {
    deliveryRatePct: string;
    openRatePct: string;
    clickRatePct: string;
    conversionRatePct: string;
    optOutRatePct: string;
  };
  recentEvents: CampaignEventRowVM[];
  optOutsCount: number;
};

export type CampaignsVM = {
  rows: CampaignRowVM[];
  selected: SelectedCampaignVM | null;
};

export type CreateCampaignForm = {
  key: string;
  name: string;
  channelType: MessageCampaignChannelType;
  notificationChannelId: string;
  segmentId: string;
  conversionEvent: string;
  subject: string;
  body: string;
  ctaUrl: string;
  consentCategory: string;
};

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function toRowVM(c: MessageCampaign): CampaignRowVM {
  return {
    id: c.id,
    key: c.key,
    name: c.name,
    status: c.status,
    channelType: c.channelType,
    conversionEvent: c.conversionEvent ?? "not set",
  };
}

export function buildCampaignsVM(rows: MessageCampaign[], results: MessageCampaignResultsResponse | null): CampaignsVM {
  const selected: SelectedCampaignVM | null = results
    ? {
        id: results.campaign.id,
        status: results.campaign.status,
        channelType: results.campaign.channelType,
        conversionEvent: results.campaign.conversionEvent ?? "not set",
        consentCategory: results.campaign.consentCategory,
        privacyNote: results.campaign.privacyNote ?? "Campaign results respect stored opt-outs and data-governance rules.",
        totals: results.totals,
        rates: {
          deliveryRatePct: pct(results.rates.deliveryRate),
          openRatePct: pct(results.rates.openRate),
          clickRatePct: pct(results.rates.clickRate),
          conversionRatePct: pct(results.rates.conversionRate),
          optOutRatePct: pct(results.rates.optOutRate),
        },
        recentEvents: results.recentEvents.map((e) => ({
          id: e.id,
          occurredAtLabel: new Date(e.occurredAt).toLocaleString(),
          type: e.type,
          actorLabel: `${e.actorType} ${e.actorId ?? "anonymous"}`,
          tenantLabel: e.tenantId ?? "none",
        })),
        optOutsCount: results.optOuts.length,
      }
    : null;

  return { rows: rows.map(toRowVM), selected };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseCampaignsResult = {
  data: CampaignsVM | null;
  status: "loading" | "ok" | "error";
  busy: boolean;
  reload: () => void;
  createCampaign: (form: CreateCampaignForm) => Promise<boolean>;
  updateCampaignStatus: (id: string, status: MessageCampaignStatus) => Promise<boolean>;
  archiveCampaign: (id: string) => Promise<boolean>;
};

type UseCampaignsArgs = {
  client: Partial<
    Pick<ApiClient, "listMessageCampaigns" | "createMessageCampaign" | "updateMessageCampaign" | "archiveMessageCampaign" | "getMessageCampaignResults">
  >;
  projectId: string | undefined;
  environmentId: string | undefined;
  selectedId: string | undefined;
  enabled: boolean;
};

export function useCampaigns({ client, projectId, environmentId, selectedId, enabled }: UseCampaignsArgs): UseCampaignsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [rows, setRows] = useState<MessageCampaign[]>([]);
  const [results, setResults] = useState<MessageCampaignResultsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId || !enabled) return;

    if (!client.listMessageCampaigns) {
      setStatus("error");
      setRows([]);
      return;
    }

    const gen = ++genRef.current;
    setStatus("loading");

    client
      .listMessageCampaigns({ projectId, environmentId })
      .then(({ campaigns }) => {
        if (gen !== genRef.current) return;
        setRows(campaigns);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setRows([]);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, environmentId, enabled, tick]);

  useEffect(() => {
    if (!projectId || !environmentId || !selectedId || !client.getMessageCampaignResults) {
      setResults(null);
      return;
    }
    let cancelled = false;
    client
      .getMessageCampaignResults({ projectId, environmentId, campaignId: selectedId, window: "30d", limit: 25 })
      .then(({ data }) => {
        if (!cancelled) setResults(data);
      })
      .catch(() => {
        if (!cancelled) setResults(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectId, environmentId, selectedId]);

  const data = useMemo<CampaignsVM | null>(() => {
    if (status !== "ok") return null;
    return buildCampaignsVM(rows, results);
  }, [status, rows, results]);

  const run = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        reload();
        return true;
      } catch (err) {
        console.error(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const createCampaign = useCallback(
    (form: CreateCampaignForm) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createMessageCampaign) return;
        await client.createMessageCampaign({
          projectId,
          environmentId,
          key: form.key,
          name: form.name,
          status: "active",
          channelType: form.channelType,
          notificationChannelId: form.channelType === "in_app" ? null : form.notificationChannelId.trim(),
          segmentId: form.segmentId.trim() || null,
          conversionEvent: form.conversionEvent.trim() || null,
          subject: form.subject.trim() || null,
          body: form.body,
          ctaUrl: form.ctaUrl.trim() || null,
          consentCategory: form.consentCategory.trim() || "product",
          privacyNote: "Respects Sigmon campaign opt-outs and project data-governance rules.",
        });
      }),
    [client, environmentId, projectId, run],
  );

  const updateCampaignStatus = useCallback(
    (id: string, nextStatus: MessageCampaignStatus) =>
      run(async () => {
        if (!projectId || !environmentId || !client.updateMessageCampaign) return;
        await client.updateMessageCampaign(id, { projectId, environmentId }, { status: nextStatus });
      }),
    [client, environmentId, projectId, run],
  );

  const archiveCampaign = useCallback(
    (id: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.archiveMessageCampaign) return;
        await client.archiveMessageCampaign(id, { projectId, environmentId });
      }),
    [client, environmentId, projectId, run],
  );

  return { data, status, busy, reload, createCampaign, updateCampaignStatus, archiveCampaign };
}

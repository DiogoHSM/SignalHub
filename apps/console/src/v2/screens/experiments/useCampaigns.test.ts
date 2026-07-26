// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageCampaign, MessageCampaignResultsResponse } from "../../../api/types";
import { buildCampaignsVM, useCampaigns } from "./useCampaigns";

afterEach(() => vi.restoreAllMocks());

function campaign(over: Partial<MessageCampaign> = {}): MessageCampaign {
  return {
    id: "c1",
    projectId: "p",
    environmentId: "e",
    key: "invoice_activation",
    name: "Invoice activation",
    description: null,
    status: "active",
    channelType: "in_app",
    notificationChannelId: null,
    segmentId: null,
    conversionEvent: "invoice.paid",
    subject: null,
    body: "Create your first invoice to finish onboarding.",
    ctaUrl: null,
    consentCategory: "product",
    privacyNote: "Respects opt-outs.",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function results(over: Partial<MessageCampaignResultsResponse> = {}): MessageCampaignResultsResponse {
  return {
    campaign: campaign(),
    window: "30d",
    totals: { queued: 100, sent: 95, delivered: 90, opened: 40, clicked: 20, converted: 10, failed: 5, optedOut: 2, uniqueActors: 80 },
    rates: { deliveryRate: 94.7, openRate: 44.4, clickRate: 22.2, conversionRate: 11.1, optOutRate: 2.1 },
    recentEvents: [
      { id: "e1", campaignId: "c1", type: "delivered", actorType: "user", actorId: "u1", tenantId: "t1", userId: "u1", occurredAt: "2026-06-23T12:00:00.000Z" },
    ],
    optOuts: [{ id: "o1", actorType: "user", actorId: "u2", category: "product", reason: null, createdAt: "2026-06-01T00:00:00.000Z" }],
    ...over,
  };
}

describe("buildCampaignsVM", () => {
  it("maps rows and null selected without results", () => {
    const vm = buildCampaignsVM([campaign()], null);
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0].conversionEvent).toBe("invoice.paid");
    expect(vm.selected).toBeNull();
  });

  it("builds selected totals, formatted rates, events, and opt-out count", () => {
    const vm = buildCampaignsVM([campaign()], results());
    expect(vm.selected?.totals.delivered).toBe(90);
    expect(vm.selected?.rates.deliveryRatePct).toBe("94.7%");
    expect(vm.selected?.recentEvents[0].actorLabel).toBe("user u1");
    expect(vm.selected?.optOutsCount).toBe(1);
  });

  it("falls back conversionEvent and privacyNote when null", () => {
    const vm = buildCampaignsVM([campaign({ conversionEvent: null })], results({ campaign: campaign({ conversionEvent: null, privacyNote: null }) }));
    expect(vm.rows[0].conversionEvent).toBe("not set");
    expect(vm.selected?.privacyNote).toMatch(/opt-outs/i);
  });
});

describe("useCampaigns", () => {
  function makeClient() {
    return {
      listMessageCampaigns: vi.fn().mockResolvedValue({ campaigns: [campaign()] }),
      createMessageCampaign: vi.fn().mockResolvedValue({ campaign: campaign() }),
      updateMessageCampaign: vi.fn().mockResolvedValue({ campaign: campaign() }),
      archiveMessageCampaign: vi.fn().mockResolvedValue(undefined),
      getMessageCampaignResults: vi.fn().mockResolvedValue({ data: results() }),
    };
  }

  it("loads and builds a VM", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useCampaigns({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rows).toHaveLength(1);
  });

  it("goes to error status without throwing when listMessageCampaigns is missing", async () => {
    const client = {};
    const { result } = renderHook(() =>
      useCampaigns({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  it("requires a notification channel guard is left to the UI; hook forwards whatever form gives it", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useCampaigns({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok = false;
    await act(async () => {
      ok = await result.current.createCampaign({
        key: "k",
        name: "n",
        channelType: "email",
        notificationChannelId: "nc1",
        segmentId: "",
        conversionEvent: "",
        subject: "",
        body: "hello",
        ctaUrl: "",
        consentCategory: "",
      });
    });
    expect(ok).toBe(true);
    expect(client.createMessageCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ channelType: "email", notificationChannelId: "nc1", consentCategory: "product" }),
    );
  });

  it("archiveCampaign returns false without throwing when it rejects", async () => {
    const client = makeClient();
    client.archiveMessageCampaign.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() =>
      useCampaigns({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok = true;
    await act(async () => {
      ok = await result.current.archiveCampaign("c1");
    });
    expect(ok).toBe(false);
  });
});

// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildFeedbackVM, useFeedback } from "./useFeedback";
import type { ApiClient } from "../../api/client";
import type { FeedbackItem, FeedbackWidgetSettings } from "../../api/types";

const NOW = Date.parse("2026-06-24T12:00:00.000Z");

function settings(over: Partial<FeedbackWidgetSettings> = {}): FeedbackWidgetSettings {
  return {
    projectId: "p", environmentId: "e", enabled: true, title: "Send feedback",
    prompt: "Tell us what happened.", placeholder: "Write your feedback...", buttonLabel: "Feedback",
    accentColor: "#66e38a", allowScreenshot: false, privacyNote: null,
    createdAt: "2026-06-24T09:00:00.000Z", updatedAt: "2026-06-24T09:00:00.000Z",
    ...over,
  };
}

function item(over: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "fb_1", projectId: "p", environmentId: "e", status: "open", message: "Broke on save",
    category: null, pageUrl: "https://app.example.com/settings", path: "/settings",
    tenantId: "tenant_1", userId: "user_1", sessionId: "sess_1", traceId: "trace_1",
    release: "1.4.0", source: "widget", userAgent: null, metadata: {},
    submittedAt: "2026-06-24T11:48:00.000Z", receivedAt: "2026-06-24T11:48:01.000Z", updatedAt: "2026-06-24T11:48:01.000Z",
    ...over,
  };
}

describe("buildFeedbackVM", () => {
  it("builds settings and item rows with relative submitted labels", () => {
    const vm = buildFeedbackVM({ settings: settings(), items: [item()] }, NOW);
    expect(vm.settings.enabled).toBe(true);
    expect(vm.settings.privacyNote).toBe("");
    expect(vm.itemCount).toBe(1);
    const row = vm.items[0];
    expect(row.message).toBe("Broke on save");
    expect(row.pageLabel).toBe("/settings");
    expect(row.submittedLabel).toBe("12m ago");
    expect(row.tenantId).toBe("tenant_1");
    expect(row.traceId).toBe("trace_1");
  });

  it("falls back to pageUrl when path is absent, and preserves privacyNote text", () => {
    const vm = buildFeedbackVM(
      { settings: settings({ privacyNote: "We store this for 30 days." }), items: [item({ path: null })] },
      NOW,
    );
    expect(vm.items[0].pageLabel).toBe("https://app.example.com/settings");
    expect(vm.settings.privacyNote).toBe("We store this for 30 days.");
  });

  it("falls back to 'unknown page' when neither path nor pageUrl is set", () => {
    const vm = buildFeedbackVM({ settings: settings(), items: [item({ path: null, pageUrl: null })] }, NOW);
    expect(vm.items[0].pageLabel).toBe("unknown page");
  });
});

describe("useFeedback hook", () => {
  function makeClient(over: Partial<ApiClient> = {}): ApiClient {
    return {
      getFeedbackWidgetSettings: vi.fn().mockResolvedValue({ settings: settings() }),
      updateFeedbackWidgetSettings: vi.fn().mockResolvedValue({ settings: settings() }),
      listFeedbackItems: vi.fn().mockResolvedValue({ feedback: [item()] }),
      updateFeedbackStatus: vi.fn().mockResolvedValue({ feedback: item({ status: "reviewed" }) }),
      ...over,
    } as unknown as ApiClient;
  }

  it("loads settings + feedback and builds the VM", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useFeedback({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.itemCount).toBe(1);
    expect(result.current.data?.settings.buttonLabel).toBe("Feedback");
    expect(client.listFeedbackItems).toHaveBeenCalledWith({ projectId: "p", environmentId: "e", limit: 25 });
  });

  it("reports 'unavailable' when the optional client methods are absent", async () => {
    const client = {} as unknown as ApiClient;
    const { result } = renderHook(() => useFeedback({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.data).toBeNull();
  });

  it("reports 'unavailable' when only some of the four methods are present", async () => {
    const client = makeClient({ updateFeedbackStatus: undefined });
    const { result } = renderHook(() => useFeedback({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  it("saves settings via updateFeedbackWidgetSettings and reloads", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useFeedback({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    let ok = false;
    await act(async () => {
      ok = await result.current.saveSettings({
        enabled: false, title: "New title", prompt: "New prompt", placeholder: "New placeholder",
        buttonLabel: "Send", accentColor: "#123456", privacyNote: "",
      });
    });
    expect(ok).toBe(true);
    expect(client.updateFeedbackWidgetSettings).toHaveBeenCalledWith({
      projectId: "p", environmentId: "e", enabled: false, title: "New title", prompt: "New prompt",
      placeholder: "New placeholder", buttonLabel: "Send", accentColor: "#123456", allowScreenshot: false, privacyNote: null,
    });
  });

  it("updates a feedback item's status via updateFeedbackStatus", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useFeedback({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await act(async () => { await result.current.setStatus("fb_1", "reviewed"); });
    expect(client.updateFeedbackStatus).toHaveBeenCalledWith("fb_1", { projectId: "p", environmentId: "e" }, "reviewed");
  });

  it("returns false from run helpers when the underlying call rejects", async () => {
    const client = makeClient({ updateFeedbackStatus: vi.fn().mockRejectedValue(new Error("boom")) });
    const { result } = renderHook(() => useFeedback({ client, projectId: "p", environmentId: "e" }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    let ok = true;
    await act(async () => { ok = await result.current.setStatus("fb_1", "reviewed"); });
    expect(ok).toBe(false);
  });
});

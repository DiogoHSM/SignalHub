// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFeedbackWidget } from "../src/browser-feedback-widget.js";

describe("installFeedbackWidget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    history.replaceState({}, "", "/");
  });

  it("submits feedback with browser context and flushes when requested", () => {
    history.replaceState({}, "", "/reports?tab=exports#details");
    const feedback = vi.fn();
    const flush = vi.fn(async () => ({ sent: 1, failed: 0, retained: 0, dropped: 0 }));
    const stop = installFeedbackWidget(
      { feedback, flush },
      {
        buttonLabel: "Send feedback",
        category: "ux",
        context: { tenantId: "tenant_1" },
        metadata: () => ({ surface: "reports" }),
        flush: true
      }
    );

    document.querySelector<HTMLButtonElement>("[data-sigmon-feedback-widget='trigger']")?.click();
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea[name='feedback']");
    expect(textarea).not.toBeNull();
    textarea!.value = "Export wording is unclear";
    textarea!.form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    stop();

    expect(feedback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Export wording is unclear",
        category: "ux",
        pageUrl: "http://localhost/reports?tab=%5BREDACTED%5D",
        path: "/reports?tab=%5BREDACTED%5D",
        metadata: { surface: "reports" }
      }),
      { tenantId: "tenant_1" }
    );
    expect(flush).toHaveBeenCalled();
  });

  it("does not render when disabled", () => {
    const stop = installFeedbackWidget({ feedback: vi.fn(), flush: vi.fn() }, { enabled: false });
    stop();
    expect(document.querySelector("[data-sigmon-feedback-widget]")).toBeNull();
  });
});

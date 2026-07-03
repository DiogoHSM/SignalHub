// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installBrowserClickCapture } from "../src/browser-clicks.js";

describe("installBrowserClickCapture", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    history.replaceState({}, "", "/");
  });

  it("captures opt-in clicks with normalized coordinates and safe selectors", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    history.replaceState({}, "", "/checkout?token=secret");
    const click = vi.fn();
    const flush = vi.fn(async () => ({ sent: 0, failed: 0, retained: 0, dropped: 0 }));
    const stop = installBrowserClickCapture(
      { click, flush },
      { enabled: true, flush: true, context: { tenantId: "tenant_1" } }
    );
    const button = document.createElement("button");
    button.setAttribute("data-sigmon-id", "checkout-submit");
    document.body.appendChild(button);

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 250, clientY: 125 }));
    stop();

    expect(click).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "/checkout?token=%5BREDACTED%5D",
        selector: '[data-sigmon-id="checkout-submit"]',
        elementTag: "button",
        x: 0.25,
        y: 0.25,
        viewportWidth: 1000,
        viewportHeight: 500,
        masked: true
      }),
      { tenantId: "tenant_1" }
    );
    expect(flush).toHaveBeenCalled();
  });

  it("does not capture form controls or ignored regions", () => {
    const click = vi.fn();
    const stop = installBrowserClickCapture({ click, flush: vi.fn() }, { enabled: true });
    const input = document.createElement("input");
    input.value = "person@example.com";
    document.body.appendChild(input);
    const ignored = document.createElement("button");
    ignored.setAttribute("data-sigmon-ignore", "");
    document.body.appendChild(ignored);

    input.click();
    ignored.click();
    stop();

    expect(click).not.toHaveBeenCalled();
  });

  it("stays disabled until explicitly enabled", () => {
    const click = vi.fn();
    const stop = installBrowserClickCapture({ click, flush: vi.fn() });
    const button = document.createElement("button");
    document.body.appendChild(button);

    button.click();
    stop();

    expect(click).not.toHaveBeenCalled();
  });
});

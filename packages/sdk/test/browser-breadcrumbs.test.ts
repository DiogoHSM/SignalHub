// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserBreadcrumbs,
  sanitizeBreadcrumbUrl,
  summarizeClickedElement
} from "../src/browser-breadcrumbs.js";

describe("browser breadcrumbs", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("redacts query values from URLs", () => {
    expect(
      sanitizeBreadcrumbUrl("https://app.example.com/checkout?token=secret&page=2#card")
    ).toBe("/checkout?token=%5BREDACTED%5D&page=%5BREDACTED%5D");
  });

  it("summarizes clicks without input values", () => {
    const input = document.createElement("input");
    input.type = "email";
    input.value = "person@example.com";
    input.setAttribute("aria-label", "Email address");

    expect(summarizeClickedElement(input)).toEqual({
      tag: "input",
      role: null,
      label: "Email address",
      text: null
    });
  });

  it("does not capture clicks, console, or network by default while navigation remains enabled", async () => {
    const breadcrumb = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const stop = createBrowserBreadcrumbs({ breadcrumb } as never);
    const button = document.createElement("button");
    button.textContent = "Pay now";
    document.body.appendChild(button);

    button.click();
    console.warn("Ignored by default");
    await fetch("/ignored-by-default");
    history.pushState({}, "", "/checkout?token=secret");
    stop();

    expect(warnSpy).toHaveBeenCalledWith("Ignored by default");
    expect(fetchSpy).toHaveBeenCalledWith("/ignored-by-default");
    expect(breadcrumb).toHaveBeenCalledTimes(1);
    expect(breadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "navigation",
        message: "Navigated to /checkout?token=%5BREDACTED%5D"
      })
    );
  });

  it("captures enabled console errors and restores console on stop", () => {
    const breadcrumb = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const helperOriginalError = console.error;
    const stop = createBrowserBreadcrumbs(
      { breadcrumb } as never,
      { console: true, navigation: false, clicks: false, network: false }
    );

    console.error("Checkout failed password=secret");
    stop();
    console.error("Ignored after stop");

    expect(breadcrumb).toHaveBeenCalledTimes(1);
    expect(breadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "console",
        level: "error",
        message: expect.stringContaining("Checkout failed")
      })
    );
    expect(breadcrumb.mock.calls[0][0].message).not.toContain("password=secret");
    expect(errorSpy).toHaveBeenCalledWith("Checkout failed password=secret");
    expect(console.error).toBe(helperOriginalError);
  });

  it("rate limits browser breadcrumbs", () => {
    const breadcrumb = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stop = createBrowserBreadcrumbs(
      { breadcrumb } as never,
      { console: true, navigation: false, clicks: false, network: false, maxBreadcrumbsPerMinute: 1 }
    );

    console.warn("first");
    console.error("second");
    stop();

    expect(breadcrumb).toHaveBeenCalledTimes(1);
    expect(breadcrumb).toHaveBeenCalledWith(expect.objectContaining({ message: "first" }));
  });

  it("captures failed fetch summaries without body or header data when network is enabled", async () => {
    const breadcrumb = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
    const stop = createBrowserBreadcrumbs(
      { breadcrumb } as never,
      { navigation: false, clicks: false, console: false, network: true }
    );

    await expect(
      fetch("/checkout?token=secret", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: "password=secret"
      })
    ).rejects.toThrow("network down");
    stop();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(breadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "network",
        category: "fetch",
        level: "error",
        data: expect.objectContaining({
          method: "POST",
          url: "/checkout?token=%5BREDACTED%5D",
          failureClass: "fetch_error",
          reason: "TypeError"
        })
      })
    );
    expect(JSON.stringify(breadcrumb.mock.calls[0][0])).not.toContain("Bearer secret");
    expect(JSON.stringify(breadcrumb.mock.calls[0][0])).not.toContain("password=secret");
  });

  it("captures slow successful fetches above the configured threshold", async () => {
    vi.useFakeTimers();
    const breadcrumb = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response(null, { status: 204 })), 25);
        })
    );
    const stop = createBrowserBreadcrumbs(
      { breadcrumb } as never,
      {
        navigation: false,
        clicks: false,
        console: false,
        network: true,
        slowNetworkThresholdMs: 20
      }
    );

    const fetchPromise = fetch("/slow?api_key=secret");
    await vi.advanceTimersByTimeAsync(25);
    await expect(fetchPromise).resolves.toMatchObject({ status: 204 });
    stop();
    vi.useRealTimers();

    expect(breadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "network",
        category: "fetch",
        level: "warning",
        data: expect.objectContaining({
          method: "GET",
          url: "/slow?api_key=%5BREDACTED%5D",
          status: 204,
          failureClass: "slow",
          durationMs: expect.any(Number)
        })
      })
    );
  });

  it("restores fetch on stop and stops network capture", async () => {
    const breadcrumb = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const helperOriginalFetch = globalThis.fetch;
    const stop = createBrowserBreadcrumbs(
      { breadcrumb } as never,
      { navigation: false, clicks: false, console: false, network: true }
    );

    await fetch("/before-stop");
    stop();
    expect(globalThis.fetch).toBe(helperOriginalFetch);
    await fetch("/after-stop");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(breadcrumb).toHaveBeenCalledTimes(1);
    expect(breadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ url: "/before-stop", status: 500 })
      })
    );
  });
});

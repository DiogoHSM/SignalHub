// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserBreadcrumbs,
  sanitizeBreadcrumbUrl,
  summarizeClickedElement
} from "../src/browser-breadcrumbs.js";

describe("browser breadcrumbs", () => {
  afterEach(() => {
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
});

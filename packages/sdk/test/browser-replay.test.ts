// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserReplayRecorder } from "../src/browser-replay.js";

describe("createBrowserReplayRecorder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    history.replaceState({}, "", "/");
  });

  it("records masked navigation and click events and flushes a replay linked to an error", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T12:00:00.000Z"));
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    history.replaceState({}, "", "/checkout?token=secret");
    const replay = vi.fn();
    const recorder = createBrowserReplayRecorder(
      { replay },
      { enabled: true, replayId: "rpl_1", context: { sessionId: "sess_1" } }
    );
    const button = document.createElement("button");
    button.setAttribute("data-sigmon-id", "pay");
    document.body.appendChild(button);

    vi.setSystemTime(new Date("2026-05-02T12:00:01.250Z"));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 250, clientY: 125 }));
    recorder.flush({ errorId: "err_1" });
    recorder.stop();

    expect(replay).toHaveBeenCalledWith(
      expect.objectContaining({
        replayId: "rpl_1",
        route: "/checkout?token=%5BREDACTED%5D",
        errorId: "err_1",
        masked: true,
        events: [
          expect.objectContaining({ type: "navigation" }),
          expect.objectContaining({
            type: "click",
            selector: '[data-sigmon-id="pay"]',
            x: 0.25,
            y: 0.25,
            data: { masked: true }
          })
        ]
      }),
      { sessionId: "sess_1" }
    );
  });

  it("does not record raw form control interactions", () => {
    const replay = vi.fn();
    const recorder = createBrowserReplayRecorder({ replay }, { enabled: true });
    const input = document.createElement("input");
    input.value = "person@example.com";
    document.body.appendChild(input);

    input.click();
    recorder.flush({ errorId: "err_1" });
    recorder.stop();

    expect(replay).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [expect.objectContaining({ type: "navigation" })]
      }),
      undefined
    );
    expect(JSON.stringify(replay.mock.calls[0]?.[0])).not.toContain("person@example.com");
  });

  it("caps configured replay buffers at the API limit of 300 events", () => {
    const replay = vi.fn();
    const recorder = createBrowserReplayRecorder(
      { replay },
      { enabled: true, maxEvents: 500, document: undefined, window: undefined }
    );

    for (let index = 0; index < 350; index += 1) {
      recorder.record({ offsetMs: index, type: "custom", data: { index } });
    }
    recorder.flush();

    const payload = replay.mock.calls[0]?.[0];
    expect(payload.events).toHaveLength(300);
    expect(payload.events[0]?.data).toEqual({ index: 50 });
    expect(payload.events[299]?.data).toEqual({ index: 349 });
  });

  it("redacts arbitrary replay messages before handing them to the client", () => {
    const replay = vi.fn();
    const recorder = createBrowserReplayRecorder({ replay }, { enabled: true });
    const messages = [
      "person@example.com",
      "Cookie: session=raw-cookie-value",
      "Authorization: Bearer raw-access-token",
      "private free-form text"
    ];

    messages.forEach((message, index) => {
      recorder.record({ offsetMs: index, type: "console", message });
    });
    recorder.flush();

    const serialized = JSON.stringify(replay.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("raw-cookie-value");
    expect(serialized).not.toContain("raw-access-token");
    expect(serialized).not.toContain("private free-form text");
    expect(replay.mock.calls[0]?.[0].events.slice(-4)).toEqual(
      messages.map((_, index) =>
        expect.objectContaining({ offsetMs: index, type: "console", message: "[REDACTED]" })
      )
    );
  });
});

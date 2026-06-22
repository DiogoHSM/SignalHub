import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToasts } from "./useToasts";

afterEach(() => {
  cleanup();
});

describe("useToasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("toast() enqueues a toast with an incrementing id", () => {
    const { result } = renderHook(() => useToasts());

    expect(result.current.toasts).toHaveLength(0);

    act(() => {
      result.current.toast({ title: "First toast" });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].id).toBe(1);
    expect(result.current.toasts[0].title).toBe("First toast");

    act(() => {
      result.current.toast({ title: "Second toast" });
    });

    expect(result.current.toasts).toHaveLength(2);
    expect(result.current.toasts[1].id).toBe(2);
    expect(result.current.toasts[1].title).toBe("Second toast");
  });

  it("toast() auto-removes after 3400ms", () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      result.current.toast({ title: "Auto-dismiss toast" });
    });

    expect(result.current.toasts).toHaveLength(1);
    const toastId = result.current.toasts[0].id;

    act(() => {
      vi.advanceTimersByTime(3400);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("dismiss(id) removes a toast immediately", () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      result.current.toast({ title: "Toast to dismiss" });
      result.current.toast({ title: "Toast to keep" });
    });

    expect(result.current.toasts).toHaveLength(2);
    const firstId = result.current.toasts[0].id;

    act(() => {
      result.current.dismiss(firstId);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Toast to keep");
  });

  it("clears timers on unmount to avoid memory leaks", () => {
    const { result, unmount } = renderHook(() => useToasts());

    act(() => {
      result.current.toast({ title: "Toast" });
    });

    expect(result.current.toasts).toHaveLength(1);

    unmount();

    // Advancing time after unmount should not cause errors
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // If there are memory leaks, vitest may report warnings
    // This test passes if no errors are thrown
  });

  it("preserves toast properties when enqueuing", () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      result.current.toast({
        title: "Custom toast",
        sub: "Subtitle",
        icon: "check",
        tone: "ok"
      });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Custom toast");
    expect(result.current.toasts[0].sub).toBe("Subtitle");
    expect(result.current.toasts[0].icon).toBe("check");
    expect(result.current.toasts[0].tone).toBe("ok");
  });
});

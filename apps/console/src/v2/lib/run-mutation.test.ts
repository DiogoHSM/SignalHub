import { describe, expect, it, vi } from "vitest";
import { runMutation } from "./run-mutation";

describe("runMutation", () => {
  it("returns true and does not push a toast when fn resolves void", async () => {
    const pushToast = vi.fn();
    const fn = vi.fn().mockResolvedValue(undefined);

    const ok = await runMutation(fn, { pushToast, message: "Could not do the thing" });

    expect(ok).toBe(true);
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("returns true and does not push a toast when fn resolves true", async () => {
    const pushToast = vi.fn();
    const fn = vi.fn().mockResolvedValue(true);

    const ok = await runMutation(fn, { pushToast, message: "Could not do the thing" });

    expect(ok).toBe(true);
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("returns false and pushes the toast message when fn rejects", async () => {
    const pushToast = vi.fn();
    const err = new Error("network error");
    const fn = vi.fn().mockRejectedValue(err);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const ok = await runMutation(fn, { pushToast, message: "Could not save priority" });

    expect(ok).toBe(false);
    expect(pushToast).toHaveBeenCalledWith("Could not save priority");
    expect(consoleErrorSpy).toHaveBeenCalledWith(err);
    consoleErrorSpy.mockRestore();
  });

  it("returns false and pushes the toast message when fn resolves false", async () => {
    const pushToast = vi.fn();
    const fn = vi.fn().mockResolvedValue(false);

    const ok = await runMutation(fn, { pushToast, message: "Could not archive segment" });

    expect(ok).toBe(false);
    expect(pushToast).toHaveBeenCalledWith("Could not archive segment");
  });

  it("does not call the toast twice, even when the message is reused across calls", async () => {
    const pushToast = vi.fn();
    const okFn = vi.fn().mockResolvedValue(undefined);
    const failFn = vi.fn().mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runMutation(okFn, { pushToast, message: "Could not update status" });
    await runMutation(failFn, { pushToast, message: "Could not update status" });

    expect(pushToast).toHaveBeenCalledTimes(1);
  });
});

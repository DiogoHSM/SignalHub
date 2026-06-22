import { afterEach, describe, expect, it } from "vitest";
import { resolveV2ShellFlag } from "./flag";

afterEach(() => localStorage.clear());

describe("resolveV2ShellFlag", () => {
  it("defaults to false", () => { expect(resolveV2ShellFlag("")).toBe(false); });
  it("?v2=1 opts in and persists", () => {
    expect(resolveV2ShellFlag("?v2=1")).toBe(true);
    expect(localStorage.getItem("sh_v2_shell")).toBe("1");
    expect(resolveV2ShellFlag("")).toBe(true); // sticky
  });
  it("?v2=0 opts out and persists", () => {
    localStorage.setItem("sh_v2_shell", "1");
    expect(resolveV2ShellFlag("?v2=0")).toBe(false);
    expect(localStorage.getItem("sh_v2_shell")).toBe("0");
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("SDK exports", () => {
  it("publishes explicit browser and node entrypoints", async () => {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    expect(manifest.exports["./browser"]).toEqual({
      types: "./dist/browser.d.ts",
      default: "./dist/browser.js"
    });
    expect(manifest.exports["./node"]).toEqual({
      types: "./dist/node.d.ts",
      default: "./dist/node.js"
    });
    expect(manifest.exports["./next"]).toEqual({
      types: "./dist/next.d.ts",
      default: "./dist/next.js"
    });
  });

  it("keeps browser entrypoint free of node imports", async () => {
    const source = await readFile(new URL("../src/browser.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/node:/);
    expect(source).not.toMatch(/from ["']fs/);
    expect(source).not.toMatch(/from ["']crypto/);
  });

  it("exposes a Next.js wrapper entrypoint", async () => {
    const next = await import("../src/next.js");

    expect(next.createSignalMonitorNextClient).toBeTypeOf("function");
    expect(next.withSignalMonitorRoute).toBeTypeOf("function");
    expect(next.withSignalMonitorAction).toBeTypeOf("function");
  });
});

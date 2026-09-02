import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

function expectAll(content: string, required: string[]): void {
  for (const value of required) {
    expect(content, `missing operational-storage documentation contract: ${value}`).toContain(value);
  }
}

describe("operational storage documentation contract", () => {
  it("defines backup execution, correlation, and split-role ownership", () => {
    const content = read("docs/SELF-HOSTING.md");

    expectAll(content, [
      "202 Accepted",
      "one-minute",
      "jobId",
      "/system/health",
      "WORKER_ROLE=scheduler",
      "WORKER_ROLE=queue",
      "pnpm backup:create",
      "same advisory lock"
    ]);
  });

  it("defines source-map authority, reconciliation, platform, and recovery boundaries", () => {
    const content = read("docs/SELF-HOSTING.md");

    expectAll(content, [
      "source_map_data:/var/lib/sigmon/source-maps",
      ".sigmon-source-map-storage",
      "source_map_storage_unavailable",
      "/proc/self/fd",
      "non-Linux",
      "pnpm source-maps:reconcile",
      "--apply",
      "one-hour",
      "100",
      "advisory lock",
      "docker compose down -v"
    ]);
  });

  it("keeps the README explicit about the deploy-critical ownership model", () => {
    const content = read("README.md");

    expectAll(content, [
      "202 Accepted",
      "one-minute",
      "/system/health",
      "source_map_data:/var/lib/sigmon/source-maps",
      ".sigmon-source-map-storage",
      "source_map_storage_unavailable",
      "pnpm source-maps:reconcile",
      "--apply",
      "one-hour",
      "never runs automatically"
    ]);
  });
});

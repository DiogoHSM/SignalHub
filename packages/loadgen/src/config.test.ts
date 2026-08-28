import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

describe("parseConfig", () => {
  it("parses a minimal valid config", () => {
    const config = parseConfig({
      endpoint: "https://my.sigmon.app",
      projects: [{ name: "demo-ecommerce", apiKey: "shsk_abc" }]
    });

    expect(config).toEqual({
      endpoint: "https://my.sigmon.app",
      projects: [{ name: "demo-ecommerce", apiKey: "shsk_abc" }],
      monitors: { heartbeat: [], http: [] }
    });
  });

  it("parses monitors when provided", () => {
    const config = parseConfig({
      endpoint: "https://my.sigmon.app",
      projects: [{ name: "demo-fintech", apiKey: "shsk_abc" }],
      monitors: {
        heartbeat: [{ projectIndex: 0, serviceName: "fraud-check", monitorId: "mon_1", secret: "sec_1" }],
        http: [{ projectIndex: 0, serviceName: "checkout", controlUrl: "https://target.example.com", controlToken: "tok_1" }]
      }
    });

    expect(config.monitors.heartbeat).toHaveLength(1);
    expect(config.monitors.http).toHaveLength(1);
  });

  it("throws a descriptive error when projects is empty", () => {
    expect(() => parseConfig({ endpoint: "https://my.sigmon.app", projects: [] })).toThrow(/projects/);
  });

  it("throws a descriptive error when endpoint is missing", () => {
    expect(() => parseConfig({ projects: [{ name: "x", apiKey: "y" }] })).toThrow(/endpoint/);
  });
});

import { describe, expect, it } from "vitest";
import type { NavSection } from "./nav";
import { buildConsoleUrl, parseConsoleRoute } from "./console-route";

const SECTIONS: NavSection[] = [
  "overview", "investigate", "incidents", "llm", "traces", "entities", "users",
  "events", "analytics", "alerts", "monitors", "experiments", "settings", "installation",
];

describe("console routes", () => {
  it.each(["system", "administration"] as const)("keeps %s at instance scope", (section) => {
    const url = buildConsoleUrl(section, null, { projectId: "p1", environmentId: "e1" });
    expect(url).toBe(`/console/${section}`);
    expect(parseConsoleRoute(new URL(url, "https://sigmon.example.com"))).toMatchObject({ nav: section, projectId: undefined, environmentId: undefined, valid: true });
  });
  it.each(SECTIONS)("round-trips the %s section URL", (section) => {
    const url = buildConsoleUrl(section, null, { projectId: "prj/1", environmentId: "env 1" });
    const parsed = parseConsoleRoute(new URL(url, "https://sigmon.example.com"));

    expect(parsed).toMatchObject({
      nav: section,
      detail: null,
      projectId: "prj/1",
      environmentId: "env 1",
      valid: true,
    });
  });

  it("preserves the legacy incident route and optional occurrence", () => {
    const url = buildConsoleUrl("investigate", {
      target: "incident",
      groupId: "group/one",
      errorId: "error one",
    }, { projectId: "prj_1", environmentId: "env_1" });

    expect(url).toBe("/console/incidents/error-groups/group%2Fone?project_id=prj_1&environment_id=env_1&error_id=error+one");
    expect(parseConsoleRoute(new URL(url, "https://sigmon.example.com"))).toMatchObject({
      nav: "incidents",
      detail: { target: "incident", groupId: "group/one", errorId: "error one" },
      valid: true,
    });
  });

  it("round-trips a tenant detail URL", () => {
    const url = buildConsoleUrl("entities", { target: "tenant", tenantId: "tenant/acme" });

    expect(url).toBe("/console/entities/tenants/tenant%2Facme");
    expect(parseConsoleRoute(new URL(url, "https://sigmon.example.com"))).toMatchObject({
      nav: "entities",
      detail: { target: "tenant", tenantId: "tenant/acme" },
      valid: true,
    });
  });

  it("falls back from malformed or unknown routes", () => {
    expect(parseConsoleRoute(new URL("/console/not-a-section", "https://sigmon.example.com"))).toMatchObject({
      nav: "overview",
      detail: null,
      valid: false,
      root: false,
    });
    expect(parseConsoleRoute(new URL("/console/incidents/error-groups/%E0%A4%A", "https://sigmon.example.com"))).toMatchObject({
      nav: "overview",
      detail: null,
      valid: false,
    });
  });
});

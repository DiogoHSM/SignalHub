import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const readiness = async () => ({ postgres: true, redis: true });

async function buildConsoleAssetsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sigmon-landing-"));
  await writeFile(join(dir, "index.html"), '<!doctype html><div id="root"></div>');
  await mkdir(join(dir, "assets"));
  return dir;
}

describe("root route", () => {
  it("redirects the app host straight to the console", async () => {
    app = await buildApp({
      readiness,
      googleOAuthEnabled: false,
      console: { enabled: true, apiBasePath: "/", apiEndpoint: "", assetsDir: await buildConsoleAssetsDir() },
      landing: { landingHosts: ["sigmon.app", "www.sigmon.app"] }
    });

    const response = await app.inject({ method: "GET", url: "/", headers: { host: "my.sigmon.app" } });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/console");
  });

  it("serves the landing page for landing hosts, case-insensitively and ignoring the port", async () => {
    app = await buildApp({
      readiness,
      googleOAuthEnabled: false,
      console: { enabled: true, apiBasePath: "/", apiEndpoint: "", assetsDir: await buildConsoleAssetsDir() },
      landing: { landingHosts: ["sigmon.app", "www.sigmon.app"] }
    });

    for (const host of ["sigmon.app", "WWW.Sigmon.App", "sigmon.app:443"]) {
      const response = await app.inject({ method: "GET", url: "/", headers: { host } });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.body).toContain("SignalMonitor");
      expect(response.body).toContain('href="/agents.md"');
    }
  });

  it("serves the landing page instead of a dead redirect when the console is disabled", async () => {
    app = await buildApp({
      readiness,
      googleOAuthEnabled: false,
      console: { enabled: false, apiBasePath: "/", apiEndpoint: "" },
      landing: { landingHosts: ["sigmon.app"] }
    });

    const response = await app.inject({ method: "GET", url: "/", headers: { host: "localhost" } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("SignalMonitor");
  });
});

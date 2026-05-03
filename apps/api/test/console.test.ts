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

describe("console routes", () => {
  it("returns non-secret console runtime config", async () => {
    app = await buildApp({
      readiness,
      googleOAuthEnabled: true,
      console: {
        enabled: false,
        apiBasePath: "/"
      }
    });

    const response = await app.inject({ method: "GET", url: "/console/config" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      apiBasePath: "/",
      googleOAuthEnabled: true
    });
  });

  it("serves built console index when console assets are configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "signalhub-console-"));
    await writeFile(join(dir, "index.html"), '<!doctype html><div id="root"></div>');
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets", "app.js"), "console.log('signalhub');");

    app = await buildApp({
      readiness,
      googleOAuthEnabled: false,
      console: {
        enabled: true,
        apiBasePath: "/",
        assetsDir: dir
      }
    });

    const response = await app.inject({ method: "GET", url: "/console" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain('<div id="root"></div>');

    const assetResponse = await app.inject({ method: "GET", url: "/console/assets/app.js" });
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.body).toBe("console.log('signalhub');");

    const clientRouteResponse = await app.inject({ method: "GET", url: "/console/some/client/route" });
    expect(clientRouteResponse.statusCode).toBe(200);
    expect(clientRouteResponse.headers["content-type"]).toContain("text/html");
    expect(clientRouteResponse.body).toContain('<div id="root"></div>');

    const missingAssetResponse = await app.inject({ method: "GET", url: "/console/assets/missing.js" });
    expect(missingAssetResponse.statusCode).toBe(404);
    expect(missingAssetResponse.body).not.toContain('<div id="root"></div>');
  });

  it("returns 404 for console assets when static serving is disabled", async () => {
    app = await buildApp({
      readiness,
      googleOAuthEnabled: false,
      console: {
        enabled: false,
        apiBasePath: "/"
      }
    });

    const response = await app.inject({ method: "GET", url: "/console" });

    expect(response.statusCode).toBe(404);
  });
});

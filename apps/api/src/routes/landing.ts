import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type LandingRouteOptions = {
  landingHosts: string[];
  consoleEnabled: boolean;
};

const landingPagePath = fileURLToPath(new URL("../landing/index.html", import.meta.url));

let cachedLandingHtml: string | undefined;

async function loadLandingHtml(): Promise<string> {
  cachedLandingHtml ??= await readFile(landingPagePath, "utf8");
  return cachedLandingHtml;
}

export function registerLandingRoutes(app: FastifyInstance, options: LandingRouteOptions): void {
  const landingHosts = new Set(options.landingHosts.map((host) => host.toLowerCase()));

  app.get("/", async (request, reply) => {
    const hostname = request.hostname?.toLowerCase() ?? "";
    if (options.consoleEnabled && !landingHosts.has(hostname)) {
      return reply.redirect("/console", 302);
    }

    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "public, max-age=300")
      .send(await loadLandingHtml());
  });
}

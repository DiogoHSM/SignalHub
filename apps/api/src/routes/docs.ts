import scalarApiReference from "@scalar/fastify-api-reference";
import type { FastifyInstance } from "fastify";
import { openApiDocument } from "../openapi.js";

const docsContentSecurityPolicy =
  "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";

export async function registerDocsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/openapi.json", async (_request, reply) => reply.type("application/json").send(openApiDocument));

  await app.register(scalarApiReference, {
    routePrefix: "/docs",
    configuration: {
      title: "SignalMonitor API Reference",
      url: "/openapi.json"
    },
    hooks: {
      preHandler: async (_request, reply) => {
        reply.header("Content-Security-Policy", docsContentSecurityPolicy);
      }
    },
    logLevel: "silent"
  });
}

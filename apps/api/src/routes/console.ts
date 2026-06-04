import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply } from "fastify";
import { join } from "node:path";

export type ConsoleRouteOptions = {
  enabled: boolean;
  apiBasePath: string;
  apiEndpoint: string;
  assetsDir?: string;
  browserCorsOrigins: string[];
  googleOAuthEnabled: boolean;
};

export async function registerConsoleRoutes(app: FastifyInstance, options: ConsoleRouteOptions): Promise<void> {
  app.get("/console/config", async (_request, reply) =>
    reply.send({
      apiBasePath: options.apiBasePath,
      apiEndpoint: options.apiEndpoint,
      browserCorsOrigins: options.browserCorsOrigins,
      googleOAuthEnabled: options.googleOAuthEnabled
    })
  );

  if (!options.enabled || !options.assetsDir) {
    return;
  }

  const assetsDir = options.assetsDir;

  await app.register(fastifyStatic, {
    root: join(assetsDir, "assets"),
    prefix: "/console/assets/"
  });

  app.get("/console", async (_request, reply) => sendConsoleIndex(reply, assetsDir));
  app.get("/console/*", async (request, reply) => {
    const url = request.url;
    if (url.startsWith("/console/assets/")) {
      return reply.callNotFound();
    }

    return sendConsoleIndex(reply, assetsDir);
  });
}

type StaticReply = FastifyReply & {
  sendFile(filename: string, rootPath?: string): FastifyReply;
};

function sendConsoleIndex(reply: FastifyReply, assetsDir: string): FastifyReply {
  return (reply as StaticReply).sendFile("index.html", assetsDir);
}

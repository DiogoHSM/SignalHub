import { loadConfig } from "@signal-hub/config";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = await buildApp({
  readiness: async () => ({ postgres: true, redis: true })
});

await app.listen({ port: config.port, host: "0.0.0.0" });

#!/usr/bin/env node
import { createFakeTargetServer } from "./fake-target-server.js";

const controlToken = process.env.LOADGEN_CONTROL_TOKEN;
if (!controlToken) {
  console.error("LOADGEN_CONTROL_TOKEN environment variable is required");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8090);
const app = createFakeTargetServer({ controlToken });

app
  .listen({ host: "0.0.0.0", port })
  .then(() => {
    console.log(`sigmon-loadgen fake target listening on :${port}`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });

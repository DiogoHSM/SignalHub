import { createSignalMonitorClient } from "../src/index.js";
import type { SignalMonitorClientOptions } from "../src/index.js";

const options: SignalMonitorClientOptions = {
  endpoint: "https://sigmon.example.com",
  apiKey: "sh_test",
  fetch: async () => new Response(null, { status: 202 })
};

const client = createSignalMonitorClient(options);
void client;

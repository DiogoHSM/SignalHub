import { createSignalHubClient } from "../src/index.js";
import type { SignalHubClientOptions } from "../src/index.js";

const options: SignalHubClientOptions = {
  endpoint: "https://signalhub.example.com",
  apiKey: "sh_test",
  fetch: async () => new Response(null, { status: 202 })
};

const client = createSignalHubClient(options);
void client;

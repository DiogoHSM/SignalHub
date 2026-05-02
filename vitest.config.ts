import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 30_000
  },
  resolve: {
    alias: {
      "@signal-hub/config": "/packages/config/src/index.ts",
      "@signal-hub/db": "/packages/db/src/client.ts",
      "@signal-hub/db/": "/packages/db/src/",
      "@signal-hub/queues": "/packages/queues/src/telemetry-queue.ts",
      "@signal-hub/telemetry": "/packages/telemetry/src/types.ts",
      "@signal-hub/telemetry/": "/packages/telemetry/src/"
    }
  }
});

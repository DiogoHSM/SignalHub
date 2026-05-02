import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 30_000
  },
  resolve: {
    alias: {
      "@signal-hub/telemetry/api-keys": resolve(root, "packages/telemetry/src/api-keys.ts"),
      "@signal-hub/telemetry/auth": resolve(root, "packages/telemetry/src/auth.ts"),
      "@signal-hub/telemetry/ids": resolve(root, "packages/telemetry/src/ids.ts"),
      "@signal-hub/telemetry/ingestion-schemas": resolve(root, "packages/telemetry/src/ingestion-schemas.ts"),
      "@signal-hub/telemetry/sanitization": resolve(root, "packages/telemetry/src/sanitization.ts"),
      "@signal-hub/config": "/packages/config/src/index.ts",
      "@signal-hub/db": "/packages/db/src/client.ts",
      "@signal-hub/db/": "/packages/db/src/",
      "@signal-hub/queues": "/packages/queues/src/telemetry-queue.ts",
      "@signal-hub/telemetry": "/packages/telemetry/src/types.ts",
      "@signal-hub/telemetry/": "/packages/telemetry/src/"
    }
  }
});

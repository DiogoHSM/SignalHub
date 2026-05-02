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
      "@signal-hub/db/migrate.js": resolve(root, "packages/db/src/migrate.ts"),
      "@signal-hub/db/repositories/admin.js": resolve(root, "packages/db/src/repositories/admin.ts"),
      "@signal-hub/db/repositories/telemetry-query.js": resolve(root, "packages/db/src/repositories/telemetry-query.ts"),
      "@signal-hub/db/repositories/telemetry-writes.js": resolve(
        root,
        "packages/db/src/repositories/telemetry-writes.ts"
      ),
      "@signal-hub/config": resolve(root, "packages/config/src/index.ts"),
      "@signal-hub/db": resolve(root, "packages/db/src/client.ts"),
      "@signal-hub/db/": resolve(root, "packages/db/src/"),
      "@signal-hub/queues": resolve(root, "packages/queues/src/telemetry-queue.ts"),
      "@signal-hub/sdk": resolve(root, "packages/sdk/src/index.ts"),
      "@signal-hub/sdk/": resolve(root, "packages/sdk/src/"),
      "@signal-hub/telemetry": resolve(root, "packages/telemetry/src/types.ts"),
      "@signal-hub/telemetry/": resolve(root, "packages/telemetry/src/"),
      "@signal-hub/worker": resolve(root, "apps/worker/src/telemetry-worker.ts")
    }
  }
});

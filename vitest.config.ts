import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    environmentMatchGlobs: [["apps/console/**/*.test.tsx", "jsdom"]],
    include: ["apps/**/*.test.ts", "apps/**/*.test.tsx", "packages/**/*.test.ts", "scripts/**/*.test.ts"],
    setupFiles: ["apps/console/src/test/setup.ts"],
    testTimeout: 30_000
  },
  resolve: {
    alias: {
      "@sigmon/telemetry/api-keys": resolve(root, "packages/telemetry/src/api-keys.ts"),
      "@sigmon/telemetry/auth": resolve(root, "packages/telemetry/src/auth.ts"),
      "@sigmon/telemetry/ids": resolve(root, "packages/telemetry/src/ids.ts"),
      "@sigmon/telemetry/ingestion-schemas": resolve(root, "packages/telemetry/src/ingestion-schemas.ts"),
      "@sigmon/telemetry/sanitization": resolve(root, "packages/telemetry/src/sanitization.ts"),
      "@sigmon/db/migrate.js": resolve(root, "packages/db/src/migrate.ts"),
      "@sigmon/db/repositories/admin.js": resolve(root, "packages/db/src/repositories/admin.ts"),
      "@sigmon/db/repositories/entities-query.js": resolve(root, "packages/db/src/repositories/entities-query.ts"),
      "@sigmon/db/repositories/users-query.js": resolve(root, "packages/db/src/repositories/users-query.ts"),
      "@sigmon/db/repositories/telemetry-query.js": resolve(root, "packages/db/src/repositories/telemetry-query.ts"),
      "@sigmon/db/repositories/telemetry-writes.js": resolve(
        root,
        "packages/db/src/repositories/telemetry-writes.ts"
      ),
      "@sigmon/config": resolve(root, "packages/config/src/index.ts"),
      "@sigmon/db": resolve(root, "packages/db/src/client.ts"),
      "@sigmon/db/": resolve(root, "packages/db/src/"),
      "@sigmon/queues": resolve(root, "packages/queues/src/telemetry-queue.ts"),
      "@sigmon/sdk": resolve(root, "packages/sdk/src/index.ts"),
      "@sigmon/sdk/": resolve(root, "packages/sdk/src/"),
      "@sigmon/telemetry": resolve(root, "packages/telemetry/src/types.ts"),
      "@sigmon/telemetry/": resolve(root, "packages/telemetry/src/"),
      "@sigmon/worker": resolve(root, "apps/worker/src/telemetry-worker.ts")
    }
  }
});

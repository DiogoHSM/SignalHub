import { pathToFileURL } from "node:url";
import { loadConfig } from "../packages/config/src/index.js";
import { createDb } from "../packages/db/src/client.js";
import {
  listFeedbackItemsForUrlRedaction,
  updateFeedbackItemUrlsForRedaction
} from "../packages/db/src/repositories/feedback-widget.js";
import { sanitizeTelemetryUrl } from "../packages/telemetry/src/sanitization.js";

export async function redactFeedbackUrlBatch(input: {
  listBatch: (afterId: string | null, limit: number) => Promise<Array<{ id: string; pageUrl: string | null; path: string | null }>>;
  update: (id: string, values: { pageUrl?: string; path?: string }) => Promise<void>;
  batchSize: number;
}): Promise<{ scanned: number; updated: number }> {
  const batchSize = Math.max(1, Math.min(500, Math.trunc(input.batchSize)));
  let afterId: string | null = null;
  let scanned = 0;
  let updated = 0;

  while (true) {
    const rows = await input.listBatch(afterId, batchSize);
    scanned += rows.length;

    for (const row of rows) {
      const pageUrl = row.pageUrl === null ? undefined : sanitizeTelemetryUrl(row.pageUrl);
      const path = row.path === null ? undefined : sanitizeTelemetryUrl(row.path);
      const values = {
        ...(pageUrl === undefined || pageUrl === row.pageUrl ? {} : { pageUrl }),
        ...(path === undefined || path === row.path ? {} : { path })
      };

      if (Object.keys(values).length > 0) {
        await input.update(row.id, values);
        updated += 1;
      }
    }

    if (rows.length < batchSize) {
      return { scanned, updated };
    }

    afterId = rows.at(-1)?.id ?? afterId;
  }
}

export function logRedactFeedbackUrlResult(
  result: { scanned: number; updated: number },
  log: (message: string) => void = console.log
): void {
  log(`Feedback URL redaction complete: scanned=${result.scanned} updated=${result.updated}`);
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);

  try {
    const result = await redactFeedbackUrlBatch({
      listBatch: (afterId, limit) => listFeedbackItemsForUrlRedaction(db, { afterId, limit }),
      update: (id, values) => updateFeedbackItemUrlsForRedaction(db, { id, ...values }),
      batchSize: 500
    });
    logRedactFeedbackUrlResult(result);
  } finally {
    await db.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

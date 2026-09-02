import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const canonicalRetentionSources = [
  ".claude/docs/ARCHITECTURE.md",
  ".claude/docs/DECISIONS.md",
  ".claude/docs/DEPLOYMENT.md",
  ".claude/docs/INFRASTRUCTURE.md",
  ".claude/docs/SECRETS.md",
  "docs/HTTP-INGESTION.md",
  "packages/db/src/repositories/telemetry-query.ts",
  "packages/db/test/repositories.test.ts"
];

const stalePatterns = [
  /click_events` expires with the events retention window/i,
  /session_replays` expires with the events retention window/i,
  /configured raw event retention window/i,
  /RETENTION_EVENTS_DAYS`\) purges/i,
  /raw retention purges it/i,
  /raw events for it are purged/i,
  /same retentionEventsDays horizon/i
];

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("retention documentation contract", () => {
  it("keeps superseded ownership and raw-purge-horizon wording out of canonical sources", () => {
    const failures: string[] = [];

    for (const path of canonicalRetentionSources) {
      const content = read(path);
      for (const pattern of stalePatterns) {
        if (pattern.test(content)) failures.push(`${path} matches ${pattern.source}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("names independent click and replay policy ownership", () => {
    const architecture = read(".claude/docs/ARCHITECTURE.md");

    expect(architecture).toMatch(/click_events` is owned by the scoped `clicks` category/i);
    expect(architecture).toMatch(/session_replays` is owned by the scoped `replays` category/i);
  });
});

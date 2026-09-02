import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const canonicalRetentionSources = [
  "README.md",
  "docs/SELF-HOSTING.md",
  ".claude/docs/ARCHITECTURE.md",
  ".claude/docs/DECISIONS.md",
  ".claude/docs/DEPLOYMENT.md",
  ".claude/docs/INFRASTRUCTURE.md",
  ".claude/docs/SECRETS.md",
  "docs/HTTP-INGESTION.md",
  "apps/api/src/openapi.ts",
  "packages/db/src/repositories/telemetry-query.ts",
  "packages/db/test/repositories.test.ts"
];

const ownershipGuides = [
  "README.md",
  "docs/SELF-HOSTING.md",
  ".claude/docs/ARCHITECTURE.md",
  ".claude/docs/DECISIONS.md"
];

const routingGuides = [
  ".claude/docs/ARCHITECTURE.md",
  ".claude/docs/DECISIONS.md",
  ".claude/docs/DEPLOYMENT.md",
  ".claude/docs/INFRASTRUCTURE.md",
  ".claude/docs/SECRETS.md",
  "docs/HTTP-INGESTION.md",
  "apps/api/src/openapi.ts"
];

const contradictionPatterns = [
  /hard\s+maximum|maximum\s+retention\s+boundary/i,
  /scoped[^.\n]{0,100}(?:can\s+only|only\s+shorten|cannot\s+extend|capped\s+by)[^.\n]{0,80}(?:retention|installation)/i,
  /installation\s+defaults?[^.\n]{0,80}(?:always\s+win|take\s+precedence|cap\s+scoped)/i,
  /(?:click_events|click\s+events?)[^.\n]{0,100}(?:expire|use|follow)[^.\n]{0,60}events?\s+retention/i,
  /session_replays[^.\n]{0,100}(?:expire|use|follow)[^.\n]{0,60}events?\s+retention/i,
  /RETENTION_EVENTS_DAYS[^.\n]{0,80}(?:is|defines|sets)[^.\n]{0,60}(?:raw-event\s+purge|raw\s+event\s+retention\s+window)/i
];

function read(path: string) {
  return readFileSync(path, "utf8");
}

function hasClickOwner(content: string): boolean {
  return /click_events[^.\n]{0,120}(?:owned\s+by|belongs\s+to|deleted\s+by|by|(?:only\s+)?to)\s+(?:the\s+)?(?:scoped\s+)?`?clicks`?/i.test(content)
    || /`events`[^.\n]{0,80}`click_events`[^.\n]{0,80}`session_replays`[^.\n]{0,100}(?:owned|deleted)[^.\n]{0,100}events[^.\n]{0,40}clicks[^.\n]{0,40}replays[^.\n]{0,30}respectively/i.test(content);
}

function hasReplayOwner(content: string): boolean {
  return /session_replays[^.\n]{0,120}(?:owned\s+by|belongs\s+to|deleted\s+by|by|(?:only\s+)?to)\s+(?:the\s+)?(?:scoped\s+)?`?replays`?/i.test(content)
    || /`events`[^.\n]{0,80}`click_events`[^.\n]{0,80}`session_replays`[^.\n]{0,100}(?:owned|deleted)[^.\n]{0,100}events[^.\n]{0,40}clicks[^.\n]{0,40}replays[^.\n]{0,30}respectively/i.test(content);
}

describe("retention documentation contract", () => {
  it("keeps hard-maximum, global-first, and category-owner contradictions out of current sources", () => {
    const failures: string[] = [];

    for (const path of canonicalRetentionSources) {
      const content = read(path);
      for (const pattern of contradictionPatterns) {
        if (pattern.test(content)) failures.push(`${path} matches ${pattern.source}`);
      }

      for (const match of content.matchAll(/(?:global-first|hard-boundary)/gi)) {
        const context = content.slice(Math.max(0, match.index - 120), match.index + 160);
        if (!/(?:supersed|former|previous)/i.test(context)) {
          failures.push(`${path} presents ${match[0]} without supersession context`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("states independent click and replay ownership in every ownership guide", () => {
    for (const path of ownershipGuides) {
      const content = read(path);
      expect(hasClickOwner(content), `${path} must assign click_events only to clicks`).toBe(true);
      expect(hasReplayOwner(content), `${path} must assign session_replays only to replays`).toBe(true);
    }
  });

  it("distinguishes fixed installation routing from independently scoped raw deletion", () => {
    for (const path of routingGuides) {
      const content = read(path);
      expect(
        /RETENTION_EVENTS_DAYS[\s\S]{0,320}(?:routing|raw-versus-rollup|raw versus rollup)/i.test(content),
        `${path} must identify the installation routing threshold`
      ).toBe(true);
      expect(
        /scoped\s+(?:events?|category)[^.\n]{0,220}(?:delete|deletion|fallback|raw-row|sooner|longer|shorter|replaces)/i.test(content),
        `${path} must distinguish scoped raw-event deletion`
      ).toBe(true);
    }
  });
});

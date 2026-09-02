import { describe, expect, it } from "vitest";

import {
  effectiveRetentionDays,
  retentionCategorySpecs,
  type RetentionCategory
} from "./effective-retention.js";
import { normalizeGovernanceRetentionPolicy } from "./system.js";

describe("effective retention", () => {
  it("uses a longer scoped override instead of the installation default", () => {
    expect(effectiveRetentionDays({ events: 90 }, "events", { events: 30 })).toBe(90);
  });

  it("uses a shorter scoped override instead of the installation default", () => {
    expect(effectiveRetentionDays({ events: 7 }, "events", { events: 30 })).toBe(7);
  });

  it("uses the default when the category is absent", () => {
    expect(effectiveRetentionDays({ clicks: 7 }, "events", { events: 30 })).toBe(30);
  });

  it("falls back after normalization rejects zero and invalid policy values", () => {
    const policy = normalizeGovernanceRetentionPolicy({
      events: 0,
      clicks: "invalid",
      traces: 14,
      unknown: 90
    });

    expect(policy).toEqual({ traces: 14 });
    expect(effectiveRetentionDays(policy, "events", { events: 30 })).toBe(30);
    expect(effectiveRetentionDays(policy, "clicks", { clicks: 30 })).toBe(30);
  });

  it("accepts only integer numbers and canonical numeric strings", () => {
    const policy = normalizeGovernanceRetentionPolicy({
      events: "90",
      errors: 180,
      traces: true,
      spans: false,
      llmCalls: [1],
      profiles: ["90"],
      breadcrumbs: {},
      webVitals: null,
      clicks: " 90",
      replays: "90.0",
      unknown: "45"
    });

    expect(policy).toEqual({ events: 90, errors: 180 });
  });

  it.each(["+90", "-90", "9e1", "090", "90 ", "", "1.0"])(
    "rejects noncanonical numeric retention string %j",
    (value) => {
      expect(normalizeGovernanceRetentionPolicy({ events: value })).toEqual({});
    }
  );

  it("accepts canonical numeric strings only within the supported range", () => {
    expect(normalizeGovernanceRetentionPolicy({ events: "1", errors: "3650", traces: "3651" }))
      .toEqual({ events: 1, errors: 3650 });
  });

  it("assigns every physical table to exactly one category", () => {
    const tables = retentionCategorySpecs.map((item) => item.table);

    expect(tables).toEqual([
      "events",
      "click_events",
      "session_replays",
      "errors",
      "traces",
      "spans",
      "llm_calls",
      "web_vitals",
      "profiles",
      "breadcrumbs"
    ]);
    expect(new Set(tables).size).toBe(tables.length);
    expect(retentionCategorySpecs.filter((item) => item.table === "session_replays").map((item) => item.category))
      .toEqual(["replays"]);
  });

  it("covers every governance retention category", () => {
    const categories = retentionCategorySpecs.map((item) => item.category);
    const expectedCategories: RetentionCategory[] = [
      "events",
      "clicks",
      "replays",
      "errors",
      "traces",
      "spans",
      "llmCalls",
      "webVitals",
      "profiles",
      "breadcrumbs"
    ];

    expect(categories).toEqual(expectedCategories);
    expect(new Set(categories).size).toBe(expectedCategories.length);
  });

  it("maps categories to their timestamp identifiers, installation defaults, and persisted counters", () => {
    expect(retentionCategorySpecs).toEqual([
      { category: "events", table: "events", timestamp: "timestamp", defaultKey: "eventsDays", counter: "events" },
      { category: "clicks", table: "click_events", timestamp: "timestamp", defaultKey: "eventsDays", counter: "events" },
      { category: "replays", table: "session_replays", timestamp: "timestamp", defaultKey: "eventsDays", counter: "events" },
      { category: "errors", table: "errors", timestamp: "timestamp", defaultKey: "errorsDays", counter: "errors" },
      { category: "traces", table: "traces", timestamp: "timestamp", defaultKey: "tracesDays", counter: "traces" },
      { category: "spans", table: "spans", timestamp: "timestamp", defaultKey: "spansDays", counter: "spans" },
      { category: "llmCalls", table: "llm_calls", timestamp: "timestamp", defaultKey: "llmCallsDays", counter: "llmCalls" },
      { category: "webVitals", table: "web_vitals", timestamp: "timestamp", defaultKey: "eventsDays", counter: "webVitals" },
      { category: "profiles", table: "profiles", timestamp: "timestamp", defaultKey: "profilesDays", counter: "profiles" },
      { category: "breadcrumbs", table: "breadcrumbs", timestamp: "timestamp", defaultKey: "breadcrumbsDays", counter: "breadcrumbs" }
    ]);
  });
});

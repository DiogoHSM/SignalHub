import type { DataGovernanceRetentionCategory, DataGovernanceRetentionPolicy } from "./data-governance.js";
import type { RetentionDeletedCounts, RetentionExecutionOptions } from "./system.js";

export const retentionCategories = [
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
] as const satisfies readonly DataGovernanceRetentionCategory[];

export type RetentionCategory = (typeof retentionCategories)[number];
export type RetentionTable =
  | "events"
  | "click_events"
  | "session_replays"
  | "errors"
  | "traces"
  | "spans"
  | "llm_calls"
  | "web_vitals"
  | "profiles"
  | "breadcrumbs";
export type RetentionTimestamp = "timestamp";
export type RetentionDefaultKey = keyof Pick<
  RetentionExecutionOptions,
  | "eventsDays"
  | "errorsDays"
  | "tracesDays"
  | "spansDays"
  | "llmCallsDays"
  | "profilesDays"
  | "breadcrumbsDays"
>;
export type RetentionCounter = keyof Pick<
  RetentionDeletedCounts,
  "events" | "errors" | "traces" | "spans" | "llmCalls" | "webVitals" | "profiles" | "breadcrumbs"
>;

export type RetentionCategorySpec = {
  category: RetentionCategory;
  table: RetentionTable;
  timestamp: RetentionTimestamp;
  defaultKey: RetentionDefaultKey;
  counter: RetentionCounter;
};

export const retentionCategorySpecs = [
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
] as const satisfies readonly RetentionCategorySpec[];

export function effectiveRetentionDays<Category extends RetentionCategory>(
  policy: Readonly<DataGovernanceRetentionPolicy>,
  category: Category,
  defaults: Readonly<Record<Category, number>>
): number {
  return policy[category] ?? defaults[category];
}

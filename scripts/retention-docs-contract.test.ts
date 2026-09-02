import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type SemanticRequirement = {
  label: string;
  pattern: RegExp;
  allowNegation?: boolean;
};

type SourceContract = {
  path: string;
  requirements: SemanticRequirement[];
};

const overrideBothDirections: SemanticRequirement = {
  label: "scoped values replace installation defaults in both directions",
  pattern: /(?:scoped|project environment|saved)[a-z0-9 ]{0,180}(?:override|overrides|replace|replaces)[a-z0-9 ]{0,120}installation defaults?[a-z0-9 ]{0,120}(?:shorter[a-z0-9 ]{0,60}longer|longer[a-z0-9 ]{0,60}shorter)/
};
const absentCategoryFallback: SemanticRequirement = {
  label: "absent categories use installation defaults",
  pattern: /(?:absent|omitted|missing)[a-z0-9 ]{0,100}(?:category|categories|policy)[a-z0-9 ]{0,140}(?:use|uses|inherit|inherits|fall back|falls back|continue to use)[a-z0-9 ]{0,100}(?:installation )?defaults?/
};
const clickOwner: SemanticRequirement = {
  label: "click_events belongs to clicks",
  pattern: /click events[a-z0-9 ]{0,120}(?:owned by|belongs to|deleted by|by|(?:only )?to)[a-z0-9 ]{0,40}clicks/
};
const replayOwner: SemanticRequirement = {
  label: "session_replays belongs to replays",
  pattern: /session replays[a-z0-9 ]{0,140}(?:owned by|belongs to|deleted by|by|(?:only )?to)[a-z0-9 ]{0,60}replays/
};
const fixedRoutingThreshold: SemanticRequirement = {
  label: "RETENTION_EVENTS_DAYS is the installation routing threshold",
  pattern: /retention events days[a-z0-9 ]{0,280}(?:routing threshold|raw versus rollup)/
};
const scopedRawDeletion: SemanticRequirement = {
  label: "scoped events policy independently controls raw deletion",
  pattern: /scoped (?:events|category|retention value)[a-z0-9 ]{0,240}(?:controls|determines|delete|deletes|deletion|raw row|sooner|longer|shorter|replaces)/
};
const noEventsOverrideFallback: SemanticRequirement = {
  label: "a scope without an events override uses its installation cutoff",
  pattern: /scope with no events override[a-z0-9 ]{0,140}installation default cutoff/,
  allowNegation: true
};

const sourceContracts: SourceContract[] = [
  {
    path: "README.md",
    requirements: [overrideBothDirections, absentCategoryFallback, clickOwner, replayOwner]
  },
  {
    path: "docs/SELF-HOSTING.md",
    requirements: [overrideBothDirections, absentCategoryFallback, clickOwner, replayOwner]
  },
  {
    path: ".claude/docs/UI-UX.md",
    requirements: [overrideBothDirections, absentCategoryFallback]
  },
  {
    path: ".claude/docs/ARCHITECTURE.md",
    requirements: [
      overrideBothDirections,
      absentCategoryFallback,
      clickOwner,
      replayOwner,
      fixedRoutingThreshold,
      scopedRawDeletion
    ]
  },
  {
    path: ".claude/docs/DECISIONS.md",
    requirements: [
      overrideBothDirections,
      absentCategoryFallback,
      clickOwner,
      replayOwner,
      fixedRoutingThreshold,
      scopedRawDeletion
    ]
  },
  {
    path: ".claude/docs/DEPLOYMENT.md",
    requirements: [fixedRoutingThreshold, scopedRawDeletion]
  },
  {
    path: ".claude/docs/INFRASTRUCTURE.md",
    requirements: [fixedRoutingThreshold, scopedRawDeletion]
  },
  {
    path: ".claude/docs/SECRETS.md",
    requirements: [fixedRoutingThreshold, scopedRawDeletion]
  },
  {
    path: "docs/HTTP-INGESTION.md",
    requirements: [fixedRoutingThreshold, scopedRawDeletion]
  },
  {
    path: "apps/api/src/openapi.ts",
    requirements: [overrideBothDirections, absentCategoryFallback, fixedRoutingThreshold, scopedRawDeletion]
  },
  {
    path: "packages/db/src/repositories/telemetry-query.ts",
    requirements: [scopedRawDeletion]
  },
  {
    path: "packages/db/test/repositories.test.ts",
    requirements: [noEventsOverrideFallback]
  }
];

const staleStatementPatterns = [
  /\bhard maximum\b/,
  /\bmaximum retention boundary\b/,
  /\bhard boundary\b/,
  /\bglobal first\b/,
  /\b(?:can )?only shorten\b/,
  /\bcannot extend\b/,
  /\bcapped by (?:the )?installation\b/,
  /installation defaults?[a-z0-9 ]{0,80}(?:always win|take precedence|cap scoped)/,
  /click events[a-z0-9 ]{0,100}(?:owned by|belongs to|uses|follows|expires with)[a-z0-9 ]{0,60}events (?:category|retention)/,
  /session replays[a-z0-9 ]{0,100}(?:owned by|belongs to|uses|follows|expires with)[a-z0-9 ]{0,60}events (?:category|retention)/,
  /retention events days[a-z0-9 ]{0,100}(?:raw event retention window|raw event purge|purge horizon)/
];

const negation = /\b(?:not|never|no longer|no(?!\s+\d)|cannot|cant|does not|do not|isnt|arent)\b/;
const historicalContext = /\b(?:supersed(?:e|es|ed|ing)|former|previous|earlier|historical|old model)\b/;

function read(path: string) {
  return readFileSync(path, "utf8");
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticSegments(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const clauses = content.split(/[.,;\r\n]+/);
  const lineWindows = lines.flatMap((line, index) => [
    line,
    [line, lines[index + 1] ?? ""].join(" "),
    [line, lines[index + 1] ?? "", lines[index + 2] ?? ""].join(" ")
  ]);
  return [...new Set([...lineWindows, ...clauses].map(normalize).filter(Boolean))];
}

function hasAffirmativeRequirement(segments: string[], requirement: SemanticRequirement): boolean {
  return segments.some((segment) => {
    const match = requirement.pattern.exec(segment);
    if (!match || match.index === undefined) return false;
    const context = segment.slice(Math.max(0, match.index - 12), match.index + match[0].length);
    return requirement.allowNegation === true || !negation.test(context);
  });
}

function findStaleStatements(content: string): string[] {
  const failures: string[] = [];
  const statements = content.split(/[.;\r\n]+/).map(normalize).filter(Boolean);
  for (const statement of statements) {
    if (historicalContext.test(statement)) continue;
    if (staleStatementPatterns.some((pattern) => pattern.test(statement))) {
      failures.push(statement);
    }
  }
  return failures;
}

function validateSource(contract: SourceContract, content: string): string[] {
  const segments = semanticSegments(content);
  const failures = findStaleStatements(content).map((statement) => `${contract.path} has stale statement: ${statement}`);

  for (const requirement of contract.requirements) {
    if (!hasAffirmativeRequirement(segments, requirement)) {
      failures.push(`${contract.path} is missing: ${requirement.label}`);
    }
  }
  return failures;
}

describe("retention documentation contract", () => {
  it("rejects negated positive clauses and direct stale-statement mutations", () => {
    expect(validateSource(
      { path: "fixture", requirements: [clickOwner] },
      "click_events is not owned by clicks."
    )).toContain("fixture is missing: click_events belongs to clicks");
    expect(validateSource(
      { path: "fixture", requirements: [clickOwner] },
      "No: click_events is owned by clicks."
    )).toContain("fixture is missing: click_events belongs to clicks");
    expect(validateSource(
      { path: "fixture", requirements: [replayOwner] },
      "session_replays is not owned by replays."
    )).toContain("fixture is missing: session_replays belongs to replays");
    expect(validateSource(
      { path: "fixture", requirements: [fixedRoutingThreshold] },
      "RETENTION_EVENTS_DAYS is not the raw-versus-rollup routing threshold."
    )).toContain("fixture is missing: RETENTION_EVENTS_DAYS is the installation routing threshold");
    expect(validateSource(
      { path: "fixture", requirements: [scopedRawDeletion] },
      "Scoped events do not control raw-row deletion."
    )).toContain("fixture is missing: scoped events policy independently controls raw deletion");

    const staleFailures = validateSource(
      { path: "fixture", requirements: [] },
      "Scoped retention is not a hard maximum. Installation defaults always win and scoped values can only shorten retention."
    );
    expect(staleFailures.some((failure) => failure.includes("hard maximum"))).toBe(true);
    expect(staleFailures.some((failure) => failure.includes("only shorten"))).toBe(true);
  });

  it("allows stale terminology only inside explicit supersession context", () => {
    expect(findStaleStatements(
      "This supersedes the former global-first, hard-boundary model where installation defaults always win."
    )).toEqual([]);
    expect(findStaleStatements(
      "The former rule said \"scoped values can only shorten retention\"; that rule is superseded."
    )).toEqual([]);
  });

  it("meets every current source's positive semantics without stale active statements", () => {
    const failures = sourceContracts.flatMap((contract) => validateSource(contract, read(contract.path)));
    expect(failures).toEqual([]);
  });
});

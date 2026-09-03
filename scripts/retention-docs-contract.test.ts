import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type SemanticRequirement = {
  label: string;
  matches: (text: string) => boolean;
  allowedNegation?: RegExp;
};

type SemanticSegment = {
  text: string;
  historical: boolean;
};

type SourceContract = {
  path: string;
  requirements: SemanticRequirement[];
};

const overrideBothDirections: SemanticRequirement = {
  label: "scoped values replace installation defaults in both directions",
  matches: (text) => hasAllTermGroups(text, [
    ["scoped", "project environment", "saved", "category value", "scoped policy"],
    ["installation default", "installation defaults"],
    ["override", "overrides", "replace", "replaces", "yield to", "yields to", "give way to"],
    ["shorter"],
    ["longer"]
  ])
};
const absentCategoryFallback: SemanticRequirement = {
  label: "absent categories use installation defaults",
  matches: (text) => hasAllTermGroups(text, [
    ["absent", "omitted", "missing", "lacking", "without"],
    ["category", "categories", "policy", "override", "value"],
    ["use", "uses", "inherit", "inherits", "fall back", "falls back", "default cutoff"],
    ["installation default", "installation defaults", "installation cutoff", "default cutoff", "the default"]
  ])
};
const clickOwner: SemanticRequirement = {
  label: "click_events belongs to clicks",
  matches: (text) => hasAllTermGroups(text, [
    ["click events"],
    ["clicks"],
    ["own", "owns", "owned", "belong", "belongs", "delete", "deletes", "deleted", "govern", "governs", "governed"]
  ])
};
const replayOwner: SemanticRequirement = {
  label: "session_replays belongs to replays",
  matches: (text) => hasAllTermGroups(text, [
    ["session replays"],
    ["replays"],
    ["own", "owns", "owned", "belong", "belongs", "delete", "deletes", "deleted", "govern", "governs", "governed"]
  ])
};
const fixedRoutingThreshold: SemanticRequirement = {
  label: "RETENTION_EVENTS_DAYS is the installation routing threshold",
  matches: (text) => hasTerm(text, "retention events days")
    && (hasTerm(text, "routing threshold")
      || hasTerm(text, "raw versus rollup")
      || (hasAnyTerm(text, ["raw row", "raw rows", "raw event", "raw events"])
        && hasAnyTerm(text, ["rollup", "rollups"])
        && hasAnyTerm(text, ["route", "routes", "routing", "select", "selects", "serve", "serves", "served", "read", "reads", "determine", "determines", "whether"])))
};
const scopedRawDeletion: SemanticRequirement = {
  label: "scoped events policy independently controls raw deletion",
  matches: (text) => hasTerm(text, "scoped")
    && hasAnyTerm(text, ["events", "category", "retention value", "retention policy"])
    && hasAnyTerm(text, ["raw row", "raw rows", "raw event", "raw events", "events row", "events rows", "deletion fallback"])
    && hasAnyTerm(text, ["control", "controls", "determine", "determines", "delete", "deletes", "deleted", "deletion", "purge", "purges", "replace", "replaces"])
};
const noEventsOverrideFallback: SemanticRequirement = {
  label: "a scope without an events override uses its installation cutoff",
  matches: (text) => hasAnyTerm(text, ["scope", "environment"])
    && hasAnyTerm(text, ["no events override", "without an events override", "lacking an events override", "lacking an events specific override"])
    && hasAnyTerm(text, ["installation default cutoff", "installation cutoff", "installation default"]),
  allowedNegation: /\bno events override\b/
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

const negation = /\b(?:not|never|no longer|cannot|cant|does not|do not|is not|are not)\b/;
const historicalIntroduction = [
  /\b(?:former|previous|old|historical)\s+(?:rule|model|behavior|policy|statement)\b.*\b(?:said|stated|held|defined|treated|was|where)\b/,
  /\bsupersed(?:e|es|ed|ing)\b.*\b(?:former|previous|old|rule|model|behavior|policy|\d{4})\b/
];

function read(path: string) {
  return readFileSync(path, "utf8");
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bisn't\b/g, "is not")
    .replace(/\bdoesn't\b/g, "does not")
    .replace(/\bdon't\b/g, "do not")
    .replace(/\baren't\b/g, "are not")
    .replace(/\bcan't\b/g, "cannot")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTerm(text: string, term: string): boolean {
  return ` ${text} `.includes(` ${term} `);
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => hasTerm(text, term));
}

function hasAllTermGroups(text: string, groups: string[][]): boolean {
  return groups.every((group) => hasAnyTerm(text, group));
}

function isHistoricalIntroduction(text: string): boolean {
  return historicalIntroduction.some((pattern) => pattern.test(text));
}

function classifyClauses(value: string): SemanticSegment[] {
  const segments: SemanticSegment[] = [];
  let inheritedHistory = false;

  for (const part of value.replace(/\bno\s*:/gi, "no ").split(/([,;:])/)) {
    if (part === ",") continue;
    if (part === ";" || part === ":") {
      inheritedHistory = false;
      continue;
    }

    const text = normalize(part);
    if (!text) continue;
    const introducesHistory = isHistoricalIntroduction(text);
    segments.push({ text, historical: inheritedHistory || introducesHistory });
    if (introducesHistory) inheritedHistory = true;
  }

  return segments;
}

function semanticSegments(content: string): SemanticSegment[] {
  const lines = content.split(/\r?\n/);
  const lineWindows = lines.flatMap((line, index) => [
    line,
    [line, lines[index + 1] ?? ""].join(" "),
    [line, lines[index + 1] ?? "", lines[index + 2] ?? ""].join(" ")
  ]);
  const completeWindows = lineWindows
    .map((window) => normalize(window))
    .filter(Boolean)
    .map((text) => ({ text, historical: isHistoricalIntroduction(text) }));
  const statements = lineWindows.flatMap((window) => window.split(/[.!?]+/));
  const segments = [...completeWindows, ...statements.flatMap((statement) => {
    const normalizedQualifiers = statement.replace(/\bno\s*:/gi, "no ");
    const text = normalize(normalizedQualifiers);
    const majorClauses = normalizedQualifiers.split(/[;:]/).map((clause) => normalize(clause)).filter(Boolean);
    return text
      ? [
          { text, historical: isHistoricalIntroduction(text) },
          ...majorClauses.map((clause) => ({ text: clause, historical: isHistoricalIntroduction(clause) })),
          ...classifyClauses(statement)
        ]
      : [];
  })];
  return [...new Map(segments.map((segment) => [`${segment.historical}:${segment.text}`, segment])).values()];
}

function hasAffirmativeRequirement(segments: SemanticSegment[], requirement: SemanticRequirement): boolean {
  return segments.some((segment) => {
    if (segment.historical || !requirement.matches(segment.text)) return false;
    const negationContext = requirement.allowedNegation
      ? segment.text.replace(requirement.allowedNegation, "")
      : segment.text;
    return !negation.test(negationContext) && !/^no\b/.test(negationContext);
  });
}

function findStaleStatements(content: string): string[] {
  const failures = new Set<string>();
  const statements = content.split(/[.!?\r\n]+/);
  for (const statement of statements) {
    for (const clause of classifyClauses(statement)) {
      if (!clause.historical && staleStatementPatterns.some((pattern) => pattern.test(clause.text))) {
        failures.add(clause.text);
      }
    }
  }
  return [...failures];
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
  it.each([
    [clickOwner, "click_events isn't owned by clicks."],
    [replayOwner, "session_replays doesn’t belong to replays."],
    [fixedRoutingThreshold, "RETENTION_EVENTS_DAYS isn't the raw-versus-rollup routing threshold."],
    [scopedRawDeletion, "Scoped events don’t control raw-row deletion."]
  ])("rejects contracted positive clauses with normalized contractions", (requirement, content) => {
    expect(validateSource(
      { path: "fixture", requirements: [requirement] },
      content
    )).toContain(`fixture is missing: ${requirement.label}`);
  });

  it.each([
    "Unlike the former rule, installation defaults always win now.",
    "As noted earlier, RETENTION_EVENTS_DAYS is the raw-event purge horizon.",
    "This supersedes nothing: installation defaults always win."
  ])("rejects an active stale clause even when its sentence mentions history", (content) => {
    expect(findStaleStatements(content)).not.toEqual([]);
  });

  it("does not let a historical-only clause satisfy a current positive requirement", () => {
    expect(validateSource(
      { path: "fixture", requirements: [overrideBothDirections] },
      "The former rule said scoped values replace installation defaults whether shorter or longer."
    )).toContain("fixture is missing: scoped values replace installation defaults in both directions");
  });

  it.each([
    [overrideBothDirections, "Installation defaults yield to a scoped policy, whether the value is longer or shorter."],
    [clickOwner, "The clicks policy exclusively governs click_events."],
    [fixedRoutingThreshold, "RETENTION_EVENTS_DAYS determines whether cohort queries read raw rows or rollups."],
    [fixedRoutingThreshold, "RETENTION_EVENTS_DAYS is the fixed cohort raw-versus-rollup routing threshold."],
    [absentCategoryFallback, "An environment lacking an events-specific override inherits the installation cutoff."]
  ])("accepts a valid semantic paraphrase without fixed word order", (requirement, content) => {
    expect(validateSource(
      { path: "fixture", requirements: [requirement] },
      content
    )).toEqual([]);
  });

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

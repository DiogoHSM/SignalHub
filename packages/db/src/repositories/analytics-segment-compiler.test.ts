import { describe, expect, it } from "vitest";
import { createDb } from "../client.js";
import {
  compileSegmentDefinition,
  SegmentDefinitionError,
  validateSegmentDefinition,
  type AnalyticsSegmentDefinitionV2,
  type SegmentCompileScope,
  type SegmentEventLeaf,
  type SegmentNode,
  type SegmentTraitLeaf
} from "./analytics-segment-compiler.js";
import { upgradeDefinition } from "./analytics-segments.js";

const db = createDb("postgres://compile-only:compile-only@localhost:5432/compile-only");

const baseScope: SegmentCompileScope = {
  projectId: "prj_1",
  environmentId: "env_1",
  actorType: "user",
  from: new Date("2026-05-01T00:00:00.000Z"),
  to: new Date("2026-05-31T00:00:00.000Z"),
  userRef: "events.user_id",
  tenantRef: "events.tenant_id"
};

function compile(root: SegmentNode, scope: SegmentCompileScope = baseScope) {
  const definition: AnalyticsSegmentDefinitionV2 = { version: 2, root };
  return compileSegmentDefinition(definition, scope).compile(db);
}

describe("upgradeDefinition (v1 -> v2 retrocompat)", () => {
  it("upgrades an event-only v1 definition", () => {
    const upgraded = upgradeDefinition({ window: "7d", eventName: "project.created" });
    expect(upgraded).toEqual({
      version: 2,
      window: "7d",
      root: { kind: "event", eventName: "project.created" }
    });
  });

  it("upgrades eventName + propertyName + propertyValue to an eq condition", () => {
    const upgraded = upgradeDefinition({
      window: "30d",
      eventName: "project.created",
      propertyName: "plan",
      propertyValue: "team"
    });
    expect(upgraded).toEqual({
      version: 2,
      window: "30d",
      root: {
        kind: "event",
        eventName: "project.created",
        property: { name: "plan", operator: "eq", value: "team" }
      }
    });
  });

  it("maps propertyName without propertyValue to an exists condition, not eq with an empty string", () => {
    const upgraded = upgradeDefinition({ propertyName: "plan" });
    expect(upgraded.root).toEqual({
      kind: "event",
      property: { name: "plan", operator: "exists" }
    });
    expect(upgraded.root).not.toMatchObject({ property: { operator: "eq" } });
  });

  it("upgrades an empty v1 definition to a bare event leaf", () => {
    const upgraded = upgradeDefinition({});
    expect(upgraded).toEqual({ version: 2, window: undefined, root: { kind: "event" } });
  });

  it("passes through an already-v2 definition unchanged", () => {
    const v2: AnalyticsSegmentDefinitionV2 = { version: 2, root: { kind: "event", eventName: "x" } };
    expect(upgradeDefinition(v2)).toBe(v2);
  });
});

describe("compileSegmentDefinition operators", () => {
  it("compiles eq, neq, gt, gte, lt, lte, contains, in and exists for event properties", () => {
    const cases: Array<{ leaf: SegmentEventLeaf; expectSql: RegExp }> = [
      { leaf: { kind: "event", property: { name: "plan", operator: "eq", value: "team" } }, expectSql: /"properties" ->> \$\d+\) = \$\d+/ },
      { leaf: { kind: "event", property: { name: "plan", operator: "neq", value: "team" } }, expectSql: /"properties" ->> \$\d+\) <> \$\d+/ },
      { leaf: { kind: "event", property: { name: "score", operator: "gt", value: 1 } }, expectSql: /::numeric > \$\d+/ },
      { leaf: { kind: "event", property: { name: "score", operator: "gte", value: 1 } }, expectSql: /::numeric >= \$\d+/ },
      { leaf: { kind: "event", property: { name: "score", operator: "lt", value: 1 } }, expectSql: /::numeric < \$\d+/ },
      { leaf: { kind: "event", property: { name: "score", operator: "lte", value: 1 } }, expectSql: /::numeric <= \$\d+/ },
      { leaf: { kind: "event", property: { name: "plan", operator: "contains", value: "tea" } }, expectSql: /ILIKE '%' \|\| \$\d+ \|\| '%'/ },
      { leaf: { kind: "event", property: { name: "plan", operator: "in", value: ["team", "enterprise"] } }, expectSql: /= ANY\(\$\d+::text\[\]\)/ },
      { leaf: { kind: "event", property: { name: "plan", operator: "exists" } }, expectSql: /is not null/ }
    ];

    for (const { leaf, expectSql } of cases) {
      const compiled = compile(leaf);
      expect(compiled.sql).toMatch(expectSql);
    }
  });

  it("compiles trait eq using jsonb containment for GIN usage", () => {
    const leaf: SegmentTraitLeaf = { kind: "trait", source: "user", name: "plan", operator: "eq", value: "enterprise" };
    const compiled = compile(leaf);
    expect(compiled.sql).toMatch(/"traits" @> jsonb_build_object\(\$\d+::text, \$\d+::text\)/);
    expect(compiled.sql).toContain("user_profiles");
  });

  it("compiles tenant trait leaves against tenant_profiles", () => {
    const leaf: SegmentTraitLeaf = { kind: "trait", source: "tenant", name: "plan", operator: "eq", value: "enterprise" };
    const compiled = compile(leaf);
    expect(compiled.sql).toContain("tenant_profiles");
  });

  it("compiles trait eq with a number value using a numeric jsonb cast, never a text cast (PER-450)", () => {
    const leaf: SegmentTraitLeaf = { kind: "trait", source: "user", name: "score", operator: "eq", value: 30 };
    const compiled = compile(leaf);
    expect(compiled.sql).toMatch(/"traits" @> jsonb_build_object\(\$\d+::text, \$\d+::numeric\)/);
    expect(compiled.parameters).toContain(30);
  });

  it("compiles trait eq with a boolean value using a boolean jsonb cast, never a text cast (PER-450)", () => {
    const leaf: SegmentTraitLeaf = { kind: "trait", source: "user", name: "is_paid", operator: "eq", value: true };
    const compiled = compile(leaf);
    expect(compiled.sql).toMatch(/"traits" @> jsonb_build_object\(\$\d+::text, \$\d+::boolean\)/);
    expect(compiled.parameters).toContain(true);
  });

  it("still compiles trait eq with a string value using a text jsonb cast", () => {
    const leaf: SegmentTraitLeaf = { kind: "trait", source: "user", name: "plan", operator: "eq", value: "enterprise" };
    const compiled = compile(leaf);
    expect(compiled.sql).toMatch(/"traits" @> jsonb_build_object\(\$\d+::text, \$\d+::text\)/);
    expect(compiled.parameters).toContain("enterprise");
  });

  it("compiles trait neq with a number value via text extraction, unaffected by the containment typing fix", () => {
    const leaf: SegmentTraitLeaf = { kind: "trait", source: "user", name: "score", operator: "neq", value: 30 };
    const compiled = compile(leaf);
    expect(compiled.sql).toMatch(/"traits" ->> \$\d+\) <> \$\d+/);
    expect(compiled.parameters).toContain("30");
  });

  it("compiles trait neq with a boolean value via text extraction, unaffected by the containment typing fix", () => {
    const leaf: SegmentTraitLeaf = { kind: "trait", source: "user", name: "is_paid", operator: "neq", value: false };
    const compiled = compile(leaf);
    expect(compiled.sql).toMatch(/"traits" ->> \$\d+\) <> \$\d+/);
    expect(compiled.parameters).toContain("false");
  });

  it("never inlines a malicious numeric-looking trait value into the compiled sql text", () => {
    const maliciousValue = "30; DROP TABLE user_profiles; --";
    const leaf: SegmentTraitLeaf = { kind: "trait", source: "user", name: "plan", operator: "eq", value: maliciousValue };
    const compiled = compile(leaf);
    expect(compiled.sql).not.toContain("DROP TABLE");
    expect(compiled.parameters).toContain(maliciousValue);
  });

  it("throws segment_invalid_operator for an operator outside the whitelist", () => {
    const leaf = { kind: "event", property: { name: "plan", operator: "nope", value: "team" } } as unknown as SegmentEventLeaf;
    expect(() => compile(leaf)).toThrow(SegmentDefinitionError);
    try {
      compile(leaf);
      expect.unreachable();
    } catch (error) {
      expect((error as SegmentDefinitionError).code).toBe("segment_invalid_operator");
    }
  });

  it("compiles frequency thresholds as a scalar count comparison", () => {
    const leaf: SegmentEventLeaf = { kind: "event", eventName: "checkout.completed", frequency: { operator: "gte", count: 3 } };
    const compiled = compile(leaf);
    expect(compiled.sql).toMatch(/select count\(\*\) from events e where/i);
    expect(compiled.sql).toMatch(/\) >= \$\d+/);
    expect(compiled.parameters).toContain(3);
  });

  it("narrows the window for recency using a numeric bind, never an interval string", () => {
    const leaf: SegmentEventLeaf = { kind: "event", recency: { withinDays: 2 } };
    const compiled = compile(leaf);
    expect(compiled.sql).toMatch(/make_interval\(days => \$\d+\)/);
    expect(compiled.parameters).toContain(2);
    expect(compiled.sql).not.toMatch(/'\d+ days?'/);
  });
});

describe("compileSegmentDefinition injection resistance", () => {
  it("rejects a property name containing SQL metacharacters via charset validation (defense in depth)", () => {
    const leaf: SegmentEventLeaf = {
      kind: "event",
      property: { name: "x'; DROP TABLE events; --", operator: "eq", value: "team" }
    };
    expect(() => compile(leaf)).toThrow(SegmentDefinitionError);
    try {
      compile(leaf);
      expect.unreachable();
    } catch (error) {
      expect((error as SegmentDefinitionError).code).toBe("segment_invalid_name");
    }
  });

  it("never inlines a malicious property value into the compiled sql text, even with a valid name", () => {
    const maliciousValue = "team'; DROP TABLE analytics_segments; --";
    const leaf: SegmentEventLeaf = { kind: "event", property: { name: "plan", operator: "eq", value: maliciousValue } };
    const compiled = compile(leaf);
    expect(compiled.sql).not.toContain("DROP TABLE");
    expect(compiled.sql).not.toContain(maliciousValue);
    expect(compiled.parameters).toContain(maliciousValue);
  });

  it("never inlines a malicious trait value into the compiled sql text, even with a valid name", () => {
    const maliciousValue = "'); DROP TABLE user_profiles; --";
    const leaf: SegmentTraitLeaf = { kind: "trait", source: "user", name: "plan", operator: "eq", value: maliciousValue };
    const compiled = compile(leaf);
    expect(compiled.sql).not.toContain("DROP TABLE");
    expect(compiled.parameters).toContain(maliciousValue);
  });

  it("never inlines malicious values from an in-operator array", () => {
    const maliciousValue = "x'); DROP TABLE events; --";
    const leaf: SegmentEventLeaf = {
      kind: "event",
      property: { name: "plan", operator: "in", value: ["team", maliciousValue] }
    };
    const compiled = compile(leaf);
    expect(compiled.sql).not.toContain("DROP TABLE");
    expect(compiled.parameters.some((param) => Array.isArray(param) && param.includes(maliciousValue))).toBe(true);
  });

  it("never inlines a fixed-operator lookup value supplied by an attacker-controlled operator string", () => {
    const leaf = { kind: "event", property: { name: "plan", operator: "1=1); --", value: "x" } } as unknown as SegmentEventLeaf;
    expect(() => compile(leaf)).toThrow(SegmentDefinitionError);
  });
});

describe("compileSegmentDefinition structural limits", () => {
  it("throws segment_definition_too_complex when depth exceeds 5", () => {
    let node: SegmentNode = { kind: "event", eventName: "leaf" };
    for (let i = 0; i < 5; i += 1) {
      node = { kind: "group", op: "not", children: [node] };
    }
    expect(() => validateSegmentDefinition({ version: 2, root: node })).toThrow(SegmentDefinitionError);
    try {
      validateSegmentDefinition({ version: 2, root: node });
      expect.unreachable();
    } catch (error) {
      expect((error as SegmentDefinitionError).code).toBe("segment_definition_too_complex");
    }
  });

  it("allows exactly 5 levels of depth", () => {
    let node: SegmentNode = { kind: "event", eventName: "leaf" };
    for (let i = 0; i < 4; i += 1) {
      node = { kind: "group", op: "not", children: [node] };
    }
    expect(() => validateSegmentDefinition({ version: 2, root: node })).not.toThrow();
  });

  it("throws segment_definition_too_complex when the tree has more than 32 nodes", () => {
    const level3Leaves = (): SegmentNode[] => Array.from({ length: 8 }, (_, i) => ({ kind: "event", eventName: `leaf_${i}` }));
    const level2Groups: SegmentNode[] = Array.from({ length: 8 }, () => ({ kind: "group", op: "or", children: level3Leaves() }));
    const root: SegmentNode = { kind: "group", op: "or", children: level2Groups };
    expect(() => validateSegmentDefinition({ version: 2, root })).toThrow(SegmentDefinitionError);
    try {
      validateSegmentDefinition({ version: 2, root });
      expect.unreachable();
    } catch (error) {
      expect((error as SegmentDefinitionError).code).toBe("segment_definition_too_complex");
    }
  });

  it("throws segment_invalid_group_children when not has zero or more than one child", () => {
    const twoChildren: SegmentNode = {
      kind: "group",
      op: "not",
      children: [
        { kind: "event", eventName: "a" },
        { kind: "event", eventName: "b" }
      ]
    };
    expect(() => validateSegmentDefinition({ version: 2, root: twoChildren })).toThrow(SegmentDefinitionError);

    const zeroChildren: SegmentNode = { kind: "group", op: "not", children: [] };
    expect(() => validateSegmentDefinition({ version: 2, root: zeroChildren })).toThrow(SegmentDefinitionError);
  });

  it("throws segment_invalid_group_children when and/or has zero children", () => {
    const node: SegmentNode = { kind: "group", op: "and", children: [] };
    expect(() => validateSegmentDefinition({ version: 2, root: node })).toThrow(SegmentDefinitionError);
  });

  it("throws segment_definition_too_complex when a group has more than 8 children", () => {
    const node: SegmentNode = {
      kind: "group",
      op: "or",
      children: Array.from({ length: 9 }, (_, i) => ({ kind: "event", eventName: `leaf_${i}` }))
    };
    expect(() => validateSegmentDefinition({ version: 2, root: node })).toThrow(SegmentDefinitionError);
  });
});

describe("compileSegmentDefinition boolean composition", () => {
  it("joins and/or/not children with correct parentheses", () => {
    const root: SegmentNode = {
      kind: "group",
      op: "and",
      children: [
        { kind: "event", eventName: "signup" },
        {
          kind: "group",
          op: "or",
          children: [
            { kind: "event", eventName: "checkout" },
            { kind: "group", op: "not", children: [{ kind: "event", eventName: "churned" }] }
          ]
        }
      ]
    };
    const compiled = compile(root);
    expect(compiled.sql.match(/EXISTS/g)).toHaveLength(3);
    expect(compiled.sql).toContain(" AND ");
    expect(compiled.sql).toContain(" OR ");
    expect(compiled.sql).toContain("NOT EXISTS");
  });
});

import type { RawBuilder } from "kysely";
import { sql } from "kysely";
import type { ApmWindow } from "./telemetry-query.js";

export type SegmentOperator = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte" | "in" | "exists";
export type SegmentActorType = "user" | "tenant";
export type SegmentLeafValue = string | number | string[];

export interface SegmentPropertyCondition {
  name: string;
  operator: SegmentOperator;
  value?: SegmentLeafValue;
}

export interface SegmentEventLeaf {
  kind: "event";
  eventName?: string;
  property?: SegmentPropertyCondition;
  frequency?: { operator: "gte" | "lte" | "eq"; count: number };
  recency?: { withinDays: number };
}

export interface SegmentTraitLeaf {
  kind: "trait";
  source: SegmentActorType;
  name: string;
  operator: SegmentOperator;
  value?: SegmentLeafValue;
}

export interface SegmentGroupNode {
  kind: "group";
  op: "and" | "or" | "not";
  children: SegmentNode[];
}

export type SegmentNode = SegmentGroupNode | SegmentEventLeaf | SegmentTraitLeaf;

export interface AnalyticsSegmentDefinitionV2 {
  version: 2;
  window?: ApmWindow;
  root: SegmentNode;
}

export interface SegmentCompileScope {
  projectId: string;
  environmentId: string;
  actorType: SegmentActorType;
  from: Date;
  to: Date;
  userRef: string;
  tenantRef: string;
}

export class SegmentDefinitionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "SegmentDefinitionError";
    this.code = code;
  }
}

const MAX_DEPTH = 5;
const MAX_NODES = 32;
const MAX_GROUP_CHILDREN = 8;
const NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const OPERATORS = new Set<SegmentOperator>(["eq", "neq", "contains", "gt", "gte", "lt", "lte", "in", "exists"]);
const FREQUENCY_OPERATORS = new Set(["gte", "lte", "eq"]);

const COMPARISON_SQL: Record<"eq" | "neq" | "gt" | "gte" | "lt" | "lte", string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<="
};

const FREQUENCY_SQL: Record<"gte" | "lte" | "eq", string> = {
  gte: ">=",
  lte: "<=",
  eq: "="
};

function assertValidName(name: string): void {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    throw new SegmentDefinitionError("segment_invalid_name");
  }
}

function assertValidOperator(operator: string): asserts operator is SegmentOperator {
  if (!OPERATORS.has(operator as SegmentOperator)) {
    throw new SegmentDefinitionError("segment_invalid_operator");
  }
}

function validateLeafShape(node: SegmentEventLeaf | SegmentTraitLeaf): void {
  if (node.kind === "trait") {
    assertValidName(node.name);
    assertValidOperator(node.operator);
    return;
  }

  if (node.property) {
    assertValidName(node.property.name);
    assertValidOperator(node.property.operator);
  }
  if (node.frequency) {
    if (!FREQUENCY_OPERATORS.has(node.frequency.operator)) {
      throw new SegmentDefinitionError("segment_invalid_operator");
    }
    if (!Number.isInteger(node.frequency.count) || node.frequency.count < 0) {
      throw new SegmentDefinitionError("segment_invalid_definition");
    }
  }
  if (node.recency) {
    if (!Number.isInteger(node.recency.withinDays) || node.recency.withinDays < 1 || node.recency.withinDays > 3650) {
      throw new SegmentDefinitionError("segment_invalid_definition");
    }
  }
}

function walkNode(node: SegmentNode, depth: number, counter: { count: number }): void {
  counter.count += 1;
  if (counter.count > MAX_NODES) {
    throw new SegmentDefinitionError("segment_definition_too_complex");
  }
  if (depth > MAX_DEPTH) {
    throw new SegmentDefinitionError("segment_definition_too_complex");
  }

  if (node.kind === "group") {
    if (node.op === "not" && node.children.length !== 1) {
      throw new SegmentDefinitionError("segment_invalid_group_children");
    }
    if (node.op !== "not" && node.children.length < 1) {
      throw new SegmentDefinitionError("segment_invalid_group_children");
    }
    if (node.children.length > MAX_GROUP_CHILDREN) {
      throw new SegmentDefinitionError("segment_definition_too_complex");
    }
    for (const child of node.children) {
      walkNode(child, depth + 1, counter);
    }
    return;
  }

  validateLeafShape(node);
}

export function validateSegmentDefinition(definition: AnalyticsSegmentDefinitionV2): void {
  walkNode(definition.root, 1, { count: 0 });
}

function compileJsonScalarCondition(
  column: RawBuilder<unknown>,
  name: string,
  operator: SegmentOperator,
  value: SegmentLeafValue | undefined,
  options: { containmentEq: boolean }
): RawBuilder<boolean> {
  assertValidName(name);
  assertValidOperator(operator);

  if (operator === "exists") {
    return sql<boolean>`(${column} ->> ${name}) is not null`;
  }

  if (operator === "in") {
    const values = Array.isArray(value) ? value.map((entry) => String(entry)) : [];
    if (values.length === 0 || values.length > 64) {
      throw new SegmentDefinitionError("segment_invalid_definition");
    }
    return sql<boolean>`(${column} ->> ${name}) = ANY(${values}::text[])`;
  }

  if (operator === "contains") {
    const text = typeof value === "string" ? value : String(value ?? "");
    return sql<boolean>`(${column} ->> ${name}) ILIKE '%' || ${text} || '%'`;
  }

  if (operator === "gt" || operator === "gte" || operator === "lt" || operator === "lte") {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) {
      throw new SegmentDefinitionError("segment_invalid_definition");
    }
    const opSql = COMPARISON_SQL[operator];
    return sql<boolean>`(${column} ->> ${name})::numeric ${sql.raw(opSql)} ${num}`;
  }

  if (operator === "eq" && options.containmentEq) {
    const text = typeof value === "string" ? value : String(value ?? "");
    return sql<boolean>`${column} @> jsonb_build_object(${name}::text, ${text}::text)`;
  }

  if (operator === "eq" || operator === "neq") {
    const text = typeof value === "string" ? value : String(value ?? "");
    const opSql = COMPARISON_SQL[operator];
    return sql<boolean>`(${column} ->> ${name}) ${sql.raw(opSql)} ${text}`;
  }

  throw new SegmentDefinitionError("segment_invalid_operator");
}

function eventTimestampFrom(node: SegmentEventLeaf, scope: SegmentCompileScope): Date | RawBuilder<Date> {
  if (!node.recency) {
    return scope.from;
  }
  const withinDays = node.recency.withinDays;
  return sql<Date>`greatest(${scope.from}::timestamptz, ${scope.to}::timestamptz - make_interval(days => ${withinDays}))`;
}

function compileEventScopeConditions(node: SegmentEventLeaf, scope: SegmentCompileScope): RawBuilder<boolean>[] {
  const actorColumn = scope.actorType === "tenant" ? "tenant_id" : "user_id";
  const outerRef = scope.actorType === "tenant" ? scope.tenantRef : scope.userRef;

  const conditions: RawBuilder<boolean>[] = [
    sql<boolean>`e.${sql.ref(actorColumn)} = ${sql.ref(outerRef)}`,
    sql<boolean>`e.project_id = ${scope.projectId}`,
    sql<boolean>`e.environment_id = ${scope.environmentId}`,
    sql<boolean>`e.timestamp >= ${eventTimestampFrom(node, scope)}`,
    sql<boolean>`e.timestamp < ${scope.to}`
  ];

  if (node.eventName) {
    conditions.push(sql<boolean>`e.name = ${node.eventName}`);
  }
  if (node.property) {
    conditions.push(
      compileJsonScalarCondition(sql.ref("e.properties"), node.property.name, node.property.operator, node.property.value, {
        containmentEq: false
      })
    );
  }

  return conditions;
}

function compileEventLeaf(node: SegmentEventLeaf, scope: SegmentCompileScope): RawBuilder<boolean> {
  const conditions = compileEventScopeConditions(node, scope);
  const whereClause = sql.join(conditions, sql` AND `);

  if (node.frequency) {
    const opSql = FREQUENCY_SQL[node.frequency.operator];
    return sql<boolean>`(SELECT count(*) FROM events e WHERE ${whereClause}) ${sql.raw(opSql)} ${node.frequency.count}`;
  }

  return sql<boolean>`EXISTS (SELECT 1 FROM events e WHERE ${whereClause})`;
}

function compileTraitLeaf(node: SegmentTraitLeaf, scope: SegmentCompileScope): RawBuilder<boolean> {
  const table = node.source === "tenant" ? "tenant_profiles" : "user_profiles";
  const actorColumn = node.source === "tenant" ? "tenant_id" : "user_id";
  const outerRef = node.source === "tenant" ? scope.tenantRef : scope.userRef;

  const condition = compileJsonScalarCondition(sql.ref("p.traits"), node.name, node.operator, node.value, {
    containmentEq: node.operator === "eq"
  });

  return sql<boolean>`EXISTS (
    SELECT 1 FROM ${sql.table(table)} p
    WHERE p.${sql.ref(actorColumn)} = ${sql.ref(outerRef)}
      AND p.project_id = ${scope.projectId}
      AND p.environment_id = ${scope.environmentId}
      AND ${condition}
  )`;
}

function compileNode(node: SegmentNode, scope: SegmentCompileScope): RawBuilder<boolean> {
  if (node.kind === "group") {
    if (node.op === "not") {
      const child = compileNode(node.children[0]!, scope);
      return sql<boolean>`(NOT ${child})`;
    }
    const joiner = node.op === "and" ? sql` AND ` : sql` OR `;
    const compiledChildren = node.children.map((child) => compileNode(child, scope));
    return sql<boolean>`(${sql.join(compiledChildren, joiner)})`;
  }

  if (node.kind === "event") {
    return compileEventLeaf(node, scope);
  }

  return compileTraitLeaf(node, scope);
}

export function compileSegmentDefinition(definition: AnalyticsSegmentDefinitionV2, scope: SegmentCompileScope): RawBuilder<boolean> {
  validateSegmentDefinition(definition);
  return compileNode(definition.root, scope);
}

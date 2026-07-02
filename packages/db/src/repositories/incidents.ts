import { sql } from "kysely";
import type { Db } from "../client.js";
import type { ErrorGroupPriority, ErrorGroupRecord } from "./error-groups.js";
import { getErrorGroup } from "./error-groups.js";
import { listTriageNotes } from "./incident-triage.js";
import type { ErrorRecord } from "./telemetry-query.js";

export type IncidentTimelineKind = "breadcrumb" | "event" | "error" | "trace" | "span" | "llm";
export type IncidentTimelineConfidence = "strong" | "nearby";

export type IncidentTimelineItem = {
  id: string;
  kind: IncidentTimelineKind;
  confidence: IncidentTimelineConfidence;
  timestamp: Date;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  release: string | null;
  title: string;
  level: string | null;
  data: unknown;
};

export type IncidentContextSection = {
  items: IncidentTimelineItem[];
  truncated: boolean;
};

export type IncidentReplayEvent = {
  offsetMs: number;
  type: string;
  route?: string;
  selector?: string;
  message?: string;
  x?: number;
  y?: number;
  data: unknown;
};

export type IncidentReplay = {
  id: string;
  replayId: string;
  route: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  eventCount: number;
  masked: boolean;
  events: IncidentReplayEvent[];
};

export type ErrorGroupIncident = {
  group: ErrorGroupRecord;
  primaryOccurrence: ErrorRecord;
  priority: ErrorGroupPriority | null;
  suggestedPriority: ErrorGroupPriority;
  sourceMapResolution: { status: "cached"; frameCount: number } | { status: "none" };
  stronglyRelated: IncidentContextSection;
  nearbyContext: IncidentContextSection;
  replay: IncidentReplay | null;
  related: {
    traceId: string | null;
    sessionId: string | null;
    userId: string | null;
    tenantId: string | null;
    release: string | null;
  };
  incidentNumber: string | null;
  assignedTo: { id: string; email: string } | null;
  silencedUntil: string | null;
  notes: { id: string; authorEmail: string; body: string; createdAt: string }[];
};

type IncidentTimelineRow = {
  id: string;
  kind: IncidentTimelineKind;
  error_group_id: string | null;
  timestamp: Date;
  tenant_id: string | null;
  user_id: string | null;
  session_id: string | null;
  trace_id: string | null;
  release: string | null;
  title: string;
  level: string | null;
  data: unknown;
};

export function suggestErrorGroupPriority(input: {
  severity: string;
  occurrenceCount: number;
  affectedUsersCount: number;
  affectedTenantsCount: number;
  lastRegressedAt: Date | null;
  now?: Date;
}): ErrorGroupPriority {
  const now = input.now ?? new Date();
  const regressedRecently =
    input.lastRegressedAt !== null && now.getTime() - input.lastRegressedAt.getTime() <= 24 * 60 * 60 * 1000;

  if (
    input.severity === "fatal" ||
    input.severity === "critical" ||
    input.affectedTenantsCount >= 3 ||
    input.affectedUsersCount >= 25
  ) {
    return "urgent";
  }

  if (input.severity === "error" || input.occurrenceCount >= 10 || regressedRecently) {
    return "high";
  }

  if (input.severity === "warning" || input.occurrenceCount >= 2) {
    return "normal";
  }

  return "low";
}

async function getPrimaryOccurrence(
  db: Db,
  input: { group: ErrorGroupRecord; errorId?: string }
): Promise<ErrorRecord | null> {
  const targetErrorId = input.errorId ?? input.group.latestErrorId;
  if (!targetErrorId) return null;

  const row = await db
    .selectFrom("errors")
    .selectAll()
    .where("id", "=", targetErrorId)
    .where("project_id", "=", input.group.projectId)
    .where("environment_id", "=", input.group.environmentId)
    .where("error_group_id", "=", input.group.id)
    .executeTakeFirst();

  return row
    ? {
        id: row.id,
        projectId: row.project_id,
        environmentId: row.environment_id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        sessionId: row.session_id,
        traceId: row.trace_id,
        timestamp: row.timestamp,
        receivedAt: row.received_at,
        source: row.source,
        release: row.release,
        metadata: row.metadata,
        message: row.message,
        type: row.type,
        severity: row.severity,
        stack: row.stack,
        status: row.status,
        fingerprint: row.fingerprint,
        replayId: row.replay_id,
        errorGroupId: row.error_group_id,
        groupingFingerprint: row.grouping_fingerprint,
        context: row.context
      }
    : null;
}

async function getIncidentReplay(db: Db, primaryOccurrence: ErrorRecord): Promise<IncidentReplay | null> {
  if (!primaryOccurrence.replayId) return null;

  const row = await db
    .selectFrom("session_replays")
    .select(["id", "replay_id", "route", "started_at", "ended_at", "duration_ms", "event_count", "masked", "events"])
    .where("project_id", "=", primaryOccurrence.projectId)
    .where("environment_id", "=", primaryOccurrence.environmentId)
    .where("replay_id", "=", primaryOccurrence.replayId)
    .executeTakeFirst();

  if (!row) return null;

  return {
    id: row.id,
    replayId: row.replay_id,
    route: row.route,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    eventCount: row.event_count,
    masked: row.masked,
    events: Array.isArray(row.events) ? (row.events as IncidentReplayEvent[]) : []
  };
}

function toTimelineItem(row: IncidentTimelineRow, confidence: IncidentTimelineConfidence): IncidentTimelineItem {
  return {
    id: row.id,
    kind: row.kind,
    confidence,
    timestamp: row.timestamp,
    tenantId: row.tenant_id,
    userId: row.user_id,
    sessionId: row.session_id,
    traceId: row.trace_id,
    release: row.release,
    title: row.title,
    level: row.level,
    data: row.data
  };
}

function strongRelationPredicate(error: ErrorRecord, input: { includeErrorGroup: boolean }): ReturnType<typeof sql> {
  const errorGroupRelation = input.includeErrorGroup
    ? sql`(${error.errorGroupId}::text is not null and coalesce(error_group_id = ${error.errorGroupId}, false)) or`
    : sql``;
  return sql`
    (
      ${errorGroupRelation}
      (${error.sessionId}::text is not null and coalesce(session_id = ${error.sessionId}, false))
      or (${error.traceId}::text is not null and coalesce(trace_id = ${error.traceId}, false))
    )
  `;
}

function nearbyRelationPredicate(error: ErrorRecord): ReturnType<typeof sql> {
  return sql`
    (
      (${error.userId}::text is not null and coalesce(user_id = ${error.userId}, false))
      or (${error.tenantId}::text is not null and coalesce(tenant_id = ${error.tenantId}, false))
    )
  `;
}

function branchRelationPredicate(input: {
  confidence: IncidentTimelineConfidence;
  primaryOccurrence: ErrorRecord;
  includeErrorGroup: boolean;
}): ReturnType<typeof sql> {
  const strongRelation = strongRelationPredicate(input.primaryOccurrence, {
    includeErrorGroup: input.includeErrorGroup
  });
  if (input.confidence === "strong") return strongRelation;

  return sql`
    ${nearbyRelationPredicate(input.primaryOccurrence)}
    and not ${strongRelation}
  `;
}

async function getIncidentTimeline(
  db: Db,
  input: {
    primaryOccurrence: ErrorRecord;
    confidence: IncidentTimelineConfidence;
    from: Date;
    to: Date;
    limit: number;
  }
): Promise<IncidentContextSection> {
  const error = input.primaryOccurrence;
  const nonErrorRelation = branchRelationPredicate({
    confidence: input.confidence,
    primaryOccurrence: error,
    includeErrorGroup: false
  });
  const errorRelation = branchRelationPredicate({
    confidence: input.confidence,
    primaryOccurrence: error,
    includeErrorGroup: true
  });
  const rowLimit = input.limit + 1;
  const result = await sql<IncidentTimelineRow>`
    with incident_timeline as (
      select
        id,
        'breadcrumb'::text as kind,
        null::text as error_group_id,
        timestamp,
        tenant_id,
        user_id,
        session_id,
        trace_id,
        release,
        message as title,
        level::text as level,
        jsonb_build_object('type', type, 'category', category, 'data', data, 'metadata', metadata) as data
      from breadcrumbs
      where project_id = ${error.projectId}
        and environment_id = ${error.environmentId}
        and timestamp >= ${input.from}
        and timestamp <= ${input.to}
        and ${nonErrorRelation}
      union all
      select
        id,
        'event'::text as kind,
        null::text as error_group_id,
        timestamp,
        tenant_id,
        user_id,
        session_id,
        trace_id,
        release,
        name as title,
        null::text as level,
        jsonb_build_object('properties', properties, 'metadata', metadata) as data
      from events
      where project_id = ${error.projectId}
        and environment_id = ${error.environmentId}
        and timestamp >= ${input.from}
        and timestamp <= ${input.to}
        and ${nonErrorRelation}
      union all
      select
        id,
        'error'::text as kind,
        error_group_id,
        timestamp,
        tenant_id,
        user_id,
        session_id,
        trace_id,
        release,
        message as title,
        severity as level,
        jsonb_build_object(
          'type', type,
          'status', status,
          'fingerprint', fingerprint,
          'errorGroupId', error_group_id,
          'context', context,
          'metadata', metadata
        ) as data
      from errors
      where project_id = ${error.projectId}
        and environment_id = ${error.environmentId}
        and timestamp >= ${input.from}
        and timestamp <= ${input.to}
        and ${errorRelation}
      union all
      select
        id,
        'trace'::text as kind,
        null::text as error_group_id,
        timestamp,
        tenant_id,
        user_id,
        session_id,
        trace_id,
        release,
        name as title,
        status as level,
        jsonb_build_object(
          'startedAt', started_at,
          'endedAt', ended_at,
          'durationMs', duration_ms,
          'metadata', metadata
        ) as data
      from traces
      where project_id = ${error.projectId}
        and environment_id = ${error.environmentId}
        and timestamp >= ${input.from}
        and timestamp <= ${input.to}
        and ${nonErrorRelation}
      union all
      select
        id,
        'span'::text as kind,
        null::text as error_group_id,
        timestamp,
        tenant_id,
        user_id,
        session_id,
        trace_id,
        release,
        name as title,
        status as level,
        jsonb_build_object(
          'parentSpanId', parent_span_id,
          'startedAt', started_at,
          'endedAt', ended_at,
          'durationMs', duration_ms,
          'input', input,
          'output', output,
          'error', error,
          'costUsd', cost_usd,
          'metadata', metadata
        ) as data
      from spans
      where project_id = ${error.projectId}
        and environment_id = ${error.environmentId}
        and timestamp >= ${input.from}
        and timestamp <= ${input.to}
        and ${nonErrorRelation}
      union all
      select
        id,
        'llm'::text as kind,
        null::text as error_group_id,
        timestamp,
        tenant_id,
        user_id,
        session_id,
        trace_id,
        release,
        coalesce(prompt_name, provider || '/' || model) as title,
        status as level,
        jsonb_build_object(
          'provider', provider,
          'model', model,
          'inputTokens', input_tokens,
          'outputTokens', output_tokens,
          'costUsd', cost_usd,
          'latencyMs', latency_ms,
          'error', error,
          'inputPreview', input_preview,
          'outputPreview', output_preview,
          'metadata', metadata
        ) as data
      from llm_calls
      where project_id = ${error.projectId}
        and environment_id = ${error.environmentId}
        and timestamp >= ${input.from}
        and timestamp <= ${input.to}
        and ${nonErrorRelation}
    )
    select *
    from incident_timeline
    order by timestamp asc, id asc
    limit ${rowLimit}
  `.execute(db);

  const rows = result.rows;
  return {
    items: rows.slice(0, input.limit).map((row) => toTimelineItem(row, input.confidence)),
    truncated: rows.length > input.limit
  };
}

async function getSourceMapResolution(
  db: Db,
  input: { errorId: string; projectId: string; environmentId: string }
): Promise<ErrorGroupIncident["sourceMapResolution"]> {
  const row = await db
    .selectFrom("error_stack_resolutions")
    .select(sql<unknown>`count(*)`.as("frame_count"))
    .where("error_id", "=", input.errorId)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .executeTakeFirstOrThrow();
  const frameCount = Number(row.frame_count);

  return frameCount > 0 ? { status: "cached", frameCount } : { status: "none" };
}

export async function getErrorGroupIncident(
  db: Db,
  input: {
    groupId: string;
    projectId: string;
    environmentId: string;
    errorId?: string;
    now?: Date;
  }
): Promise<ErrorGroupIncident | null> {
  const group = await getErrorGroup(db, {
    id: input.groupId,
    projectId: input.projectId,
    environmentId: input.environmentId
  });
  if (!group) return null;

  const primaryOccurrence = await getPrimaryOccurrence(db, { group, errorId: input.errorId });
  if (!primaryOccurrence) return null;

  const windowMs = 15 * 60 * 1000;
  const from = new Date(primaryOccurrence.timestamp.getTime() - windowMs);
  const to = new Date(primaryOccurrence.timestamp.getTime() + windowMs);
  const stronglyRelated = await getIncidentTimeline(db, {
    primaryOccurrence,
    confidence: "strong",
    from,
    to,
    limit: 75
  });
  const nearbyContext = await getIncidentTimeline(db, {
    primaryOccurrence,
    confidence: "nearby",
    from,
    to,
    limit: 50
  });

  let assignedTo: { id: string; email: string } | null = null;
  if (group.assignedToUserId) {
    const userRow = await db
      .selectFrom("users")
      .select(["id", "email"])
      .where("id", "=", group.assignedToUserId)
      .executeTakeFirst();
    if (userRow) {
      assignedTo = { id: userRow.id, email: userRow.email };
    }
  }

  const triageNotes = await listTriageNotes(db, group.id);

  return {
    group,
    primaryOccurrence,
    priority: group.priority,
    suggestedPriority: suggestErrorGroupPriority({
      severity: group.severity,
      occurrenceCount: group.occurrenceCount,
      affectedUsersCount: group.affectedUsersCount,
      affectedTenantsCount: group.affectedTenantsCount,
      lastRegressedAt: group.lastRegressedAt,
      now: input.now
    }),
    sourceMapResolution: await getSourceMapResolution(db, {
      errorId: primaryOccurrence.id,
      projectId: primaryOccurrence.projectId,
      environmentId: primaryOccurrence.environmentId
    }),
    stronglyRelated,
    nearbyContext,
    replay: await getIncidentReplay(db, primaryOccurrence),
    related: {
      traceId: primaryOccurrence.traceId,
      sessionId: primaryOccurrence.sessionId,
      userId: primaryOccurrence.userId,
      tenantId: primaryOccurrence.tenantId,
      release: primaryOccurrence.release
    },
    incidentNumber: group.incidentNumber,
    assignedTo,
    silencedUntil: group.silencedUntil ? group.silencedUntil.toISOString() : null,
    notes: triageNotes.map((note) => ({
      id: note.id,
      authorEmail: note.authorEmail,
      body: note.body,
      createdAt: note.createdAt.toISOString()
    }))
  };
}

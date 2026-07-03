import type { Selectable } from "kysely";
import { sql } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type { SurveyResponsesTable, SurveysTable } from "../schema.js";
import type { ApmWindow } from "./telemetry-query.js";

type SurveyRow = Selectable<SurveysTable>;
type SurveyResponseRow = Selectable<SurveyResponsesTable>;

export type SurveyStatus = "draft" | "active" | "paused" | "archived";
export type SurveyActorType = "user" | "tenant" | "session";
export type SurveyResponseActorType = SurveyActorType | "anonymous";
export type SurveyQuestionType = "rating" | "choice" | "text";

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  label: string;
  required: boolean;
  scale?: { min: number; max: number; minLabel?: string; maxLabel?: string };
  options?: string[];
}

export interface SurveyTargeting {
  segmentId?: string;
  userId?: string;
  tenantId?: string;
  eventName?: string;
  sampleRate?: number;
}

export interface SurveyRecord {
  id: string;
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description: string | null;
  status: SurveyStatus;
  actorType: SurveyActorType;
  triggerEvent: string | null;
  questions: SurveyQuestion[];
  targeting: SurveyTargeting;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface SurveyResponseRecord {
  id: string;
  surveyId: string;
  projectId: string;
  environmentId: string;
  actorType: SurveyResponseActorType;
  actorId: string | null;
  tenantId: string | null;
  userId: string | null;
  sessionId: string | null;
  traceId: string | null;
  release: string | null;
  source: string | null;
  answers: Record<string, unknown>;
  metadata: Record<string, unknown>;
  submittedAt: Date;
  receivedAt: Date;
}

export interface CreateSurveyInput {
  projectId: string;
  environmentId: string;
  key: string;
  name: string;
  description?: string | null;
  status?: SurveyStatus;
  actorType?: SurveyActorType;
  triggerEvent?: string | null;
  questions: SurveyQuestion[];
  targeting?: SurveyTargeting;
}

export type UpdateSurveyInput = Partial<
  Pick<CreateSurveyInput, "name" | "description" | "status" | "actorType" | "triggerEvent" | "questions" | "targeting">
>;

export interface RecordSurveyResponseInput {
  id?: string;
  surveyId: string;
  projectId: string;
  environmentId: string;
  actorType?: SurveyResponseActorType;
  actorId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  traceId?: string | null;
  release?: string | null;
  source?: string | null;
  answers: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  submittedAt?: Date;
  receivedAt?: Date;
}

export interface SurveyQuestionSummary {
  id: string;
  label: string;
  type: SurveyQuestionType;
  responses: number;
  average?: number;
  choices?: Array<{ value: string; count: number }>;
}

export interface SurveyResults {
  survey: SurveyRecord;
  window: ApmWindow;
  totals: {
    responses: number;
    users: number;
    tenants: number;
    sessions: number;
  };
  questions: SurveyQuestionSummary[];
  recentResponses: SurveyResponseRecord[];
}

function normalizeText(value: string | undefined | null, fallback: string, max = 160): string {
  const trimmed = value?.trim() ?? "";
  return (trimmed || fallback).slice(0, max);
}

function normalizeKey(value: string, fallback = "survey"): string {
  return normalizeText(value, fallback, 80).replace(/\s+/g, "_").toLowerCase();
}

function normalizeStatus(value: SurveyStatus | undefined): SurveyStatus {
  return value === "active" || value === "paused" || value === "archived" ? value : "draft";
}

function normalizeActorType(value: SurveyActorType | undefined): SurveyActorType {
  return value === "tenant" || value === "session" ? value : "user";
}

function normalizeResponseActorType(value: SurveyResponseActorType | undefined): SurveyResponseActorType {
  return value === "tenant" || value === "session" || value === "anonymous" ? value : "user";
}

function normalizeQuestionType(value: SurveyQuestionType | undefined): SurveyQuestionType {
  return value === "choice" || value === "text" ? value : "rating";
}

function normalizeQuestions(questions: SurveyQuestion[]): SurveyQuestion[] {
  const seen = new Set<string>();
  return questions
    .slice(0, 20)
    .map((question, index) => {
      const id = normalizeKey(question.id, `q_${index + 1}`).slice(0, 80);
      const type = normalizeQuestionType(question.type);
      const options = type === "choice" ? (question.options ?? []).map((option) => normalizeText(option, "Option", 80)).filter(Boolean).slice(0, 20) : undefined;
      const rawScale = question.scale ?? { min: 1, max: 5 };
      const min = Math.trunc(Number(rawScale.min));
      const max = Math.trunc(Number(rawScale.max));
      return {
        id,
        type,
        label: normalizeText(question.label, `Question ${index + 1}`, 240),
        required: question.required !== false,
        ...(type === "rating"
          ? {
              scale: {
                min: Number.isFinite(min) ? Math.max(0, Math.min(10, min)) : 1,
                max: Number.isFinite(max) ? Math.max(1, Math.min(10, max)) : 5,
                ...(rawScale.minLabel ? { minLabel: normalizeText(rawScale.minLabel, "", 80) } : {}),
                ...(rawScale.maxLabel ? { maxLabel: normalizeText(rawScale.maxLabel, "", 80) } : {})
              }
            }
          : {}),
        ...(options && options.length > 0 ? { options } : {})
      };
    })
    .filter((question) => {
      if (seen.has(question.id)) return false;
      seen.add(question.id);
      return true;
    });
}

function normalizeTargeting(targeting: SurveyTargeting | undefined): SurveyTargeting {
  const next: SurveyTargeting = {};
  if (targeting?.segmentId?.trim()) next.segmentId = normalizeText(targeting.segmentId, "", 120);
  if (targeting?.userId?.trim()) next.userId = normalizeText(targeting.userId, "", 256);
  if (targeting?.tenantId?.trim()) next.tenantId = normalizeText(targeting.tenantId, "", 256);
  if (targeting?.eventName?.trim()) next.eventName = normalizeText(targeting.eventName, "", 256);
  if (targeting?.sampleRate !== undefined && Number.isFinite(targeting.sampleRate)) {
    next.sampleRate = Math.max(0, Math.min(1, Number(targeting.sampleRate)));
  }
  return next;
}

function parseQuestions(value: unknown): SurveyQuestion[] {
  return Array.isArray(value) ? normalizeQuestions(value as SurveyQuestion[]) : [];
}

function parseTargeting(value: unknown): SurveyTargeting {
  return value && typeof value === "object" && !Array.isArray(value) ? normalizeTargeting(value as SurveyTargeting) : {};
}

function toSurvey(row: SurveyRow): SurveyRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    actorType: row.actor_type,
    triggerEvent: row.trigger_event,
    questions: parseQuestions(row.questions),
    targeting: parseTargeting(row.targeting),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function toResponse(row: SurveyResponseRow): SurveyResponseRecord {
  return {
    id: row.id,
    surveyId: row.survey_id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    sessionId: row.session_id,
    traceId: row.trace_id,
    release: row.release,
    source: row.source,
    answers: asObject(row.answers),
    metadata: asObject(row.metadata),
    submittedAt: row.submitted_at,
    receivedAt: row.received_at
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function resolveWindow(window: ApmWindow | undefined, now: Date): { window: ApmWindow; from: Date; to: Date } {
  const selected = window ?? "30d";
  const to = now;
  const from = new Date(to);
  if (selected === "24h") from.setUTCHours(from.getUTCHours() - 24);
  if (selected === "7d") from.setUTCDate(from.getUTCDate() - 7);
  if (selected === "30d") from.setUTCDate(from.getUTCDate() - 30);
  return { window: selected, from, to };
}

export async function createSurvey(db: Db, input: CreateSurveyInput): Promise<SurveyRecord> {
  const questions = normalizeQuestions(input.questions);
  if (questions.length === 0) {
    throw new Error("survey_requires_questions");
  }

  const row = await db
    .insertInto("surveys")
    .values({
      id: createId("srv"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      key: normalizeKey(input.key),
      name: normalizeText(input.name, input.key),
      description: input.description?.trim() || null,
      status: normalizeStatus(input.status),
      actor_type: normalizeActorType(input.actorType),
      trigger_event: input.triggerEvent?.trim() || null,
      questions: sql`${JSON.stringify(questions)}::jsonb`,
      targeting: sql`${JSON.stringify(normalizeTargeting(input.targeting))}::jsonb`
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toSurvey(row);
}

export async function listSurveys(db: Db, input: { projectId: string; environmentId: string }): Promise<SurveyRecord[]> {
  const rows = await db
    .selectFrom("surveys")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .orderBy("updated_at", "desc")
    .execute();

  return rows.map(toSurvey);
}

export async function getSurvey(db: Db, input: { id: string; projectId: string; environmentId: string }): Promise<SurveyRecord | undefined> {
  const row = await db
    .selectFrom("surveys")
    .selectAll()
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .executeTakeFirst();

  return row ? toSurvey(row) : undefined;
}

export async function updateSurvey(
  db: Db,
  input: { id: string; projectId: string; environmentId: string; patch: UpdateSurveyInput }
): Promise<SurveyRecord | undefined> {
  const patch = input.patch;
  const row = await db
    .updateTable("surveys")
    .set({
      ...(patch.name !== undefined ? { name: normalizeText(patch.name, "Untitled survey") } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
      ...(patch.status !== undefined ? { status: normalizeStatus(patch.status) } : {}),
      ...(patch.actorType !== undefined ? { actor_type: normalizeActorType(patch.actorType) } : {}),
      ...(patch.triggerEvent !== undefined ? { trigger_event: patch.triggerEvent?.trim() || null } : {}),
      ...(patch.questions !== undefined ? { questions: sql`${JSON.stringify(normalizeQuestions(patch.questions))}::jsonb` } : {}),
      ...(patch.targeting !== undefined ? { targeting: sql`${JSON.stringify(normalizeTargeting(patch.targeting))}::jsonb` } : {}),
      updated_at: new Date()
    })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toSurvey(row) : undefined;
}

export async function archiveSurvey(db: Db, input: { id: string; projectId: string; environmentId: string }): Promise<void> {
  await db
    .updateTable("surveys")
    .set({ status: "archived", archived_at: new Date(), updated_at: new Date() })
    .where("id", "=", input.id)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("archived_at", "is", null)
    .execute();
}

export async function recordSurveyResponse(db: Db, input: RecordSurveyResponseInput): Promise<SurveyResponseRecord> {
  const actorType = normalizeResponseActorType(input.actorType);
  const actorId = input.actorId ?? (actorType === "tenant" ? input.tenantId : actorType === "session" ? input.sessionId : input.userId) ?? null;
  const now = new Date();
  const row = await db
    .insertInto("survey_responses")
    .values({
      id: input.id ?? createId("srs"),
      survey_id: input.surveyId,
      project_id: input.projectId,
      environment_id: input.environmentId,
      actor_type: actorType,
      actor_id: actorId,
      tenant_id: input.tenantId ?? null,
      user_id: input.userId ?? null,
      session_id: input.sessionId ?? null,
      trace_id: input.traceId ?? null,
      release: input.release ?? null,
      source: input.source ?? null,
      answers: sql`${JSON.stringify(input.answers)}::jsonb`,
      metadata: sql`${JSON.stringify(input.metadata ?? {})}::jsonb`,
      submitted_at: input.submittedAt ?? now,
      received_at: input.receivedAt ?? now
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .returningAll()
    .executeTakeFirst();

  if (row) {
    return toResponse(row);
  }

  const existing = await db.selectFrom("survey_responses").selectAll().where("id", "=", input.id ?? "").executeTakeFirstOrThrow();
  return toResponse(existing);
}

export async function getSurveyResults(
  db: Db,
  input: { surveyId: string; projectId: string; environmentId: string; window?: ApmWindow; limit?: number; now?: Date }
): Promise<SurveyResults | undefined> {
  const survey = await getSurvey(db, { id: input.surveyId, projectId: input.projectId, environmentId: input.environmentId });
  if (!survey) return undefined;

  const { window, from, to } = resolveWindow(input.window, input.now ?? new Date());
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 25)));
  const base = db
    .selectFrom("survey_responses")
    .where("survey_id", "=", input.surveyId)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("submitted_at", ">=", from)
    .where("submitted_at", "<", to);

  const [totalRow, recentRows] = await Promise.all([
    base
      .select([
        sql<number>`count(*)::int`.as("responses"),
        sql<number>`count(distinct user_id) filter (where user_id is not null)::int`.as("users"),
        sql<number>`count(distinct tenant_id) filter (where tenant_id is not null)::int`.as("tenants"),
        sql<number>`count(distinct session_id) filter (where session_id is not null)::int`.as("sessions")
      ])
      .executeTakeFirstOrThrow(),
    base.selectAll().orderBy("submitted_at", "desc").limit(limit).execute()
  ]);

  const recentResponses = recentRows.map(toResponse);
  const allRows = await base.select(["answers"]).execute();
  const questions = survey.questions.map((question) => summarizeQuestion(question, allRows.map((row) => asObject(row.answers))));

  return {
    survey,
    window,
    totals: {
      responses: Number(totalRow.responses),
      users: Number(totalRow.users),
      tenants: Number(totalRow.tenants),
      sessions: Number(totalRow.sessions)
    },
    questions,
    recentResponses
  };
}

function summarizeQuestion(question: SurveyQuestion, answers: Record<string, unknown>[]): SurveyQuestionSummary {
  const values = answers.map((answer) => answer[question.id]).filter((value) => value !== undefined && value !== null);
  const summary: SurveyQuestionSummary = {
    id: question.id,
    label: question.label,
    type: question.type,
    responses: values.length
  };

  if (question.type === "rating") {
    const numbers = values.map(Number).filter((value) => Number.isFinite(value));
    if (numbers.length > 0) {
      summary.average = Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 10) / 10;
    }
    return summary;
  }

  if (question.type === "choice") {
    const counts = new Map<string, number>();
    for (const value of values) {
      const key = String(value).slice(0, 120);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    summary.choices = Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 20);
  }

  return summary;
}

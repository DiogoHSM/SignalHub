import type { Selectable } from "kysely";
import { createId } from "../../../telemetry/src/ids.js";
import type { Db } from "../client.js";
import type {
  CodeIntegrationProvider,
  IncidentExternalLinksTable,
  ProjectCodeIntegrationsTable,
  ReleaseMetadataTable
} from "../schema.js";

export type { CodeIntegrationProvider } from "../schema.js";

type CodeIntegrationRow = Selectable<ProjectCodeIntegrationsTable>;
type IncidentExternalLinkRow = Selectable<IncidentExternalLinksTable>;
type ReleaseMetadataRow = Selectable<ReleaseMetadataTable>;

export type CodeIntegrationRecord = {
  id: string;
  projectId: string;
  provider: CodeIntegrationProvider;
  name: string;
  owner: string;
  repo: string;
  webBaseUrl: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

export type IncidentExternalLinkRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  errorGroupId: string;
  integrationId: string | null;
  provider: CodeIntegrationProvider;
  externalKey: string;
  title: string;
  url: string;
  state: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ReleaseMetadataRecord = {
  id: string;
  projectId: string;
  environmentId: string;
  release: string;
  integrationId: string | null;
  commitSha: string | null;
  commitUrl: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  deployedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type IssueDraft = {
  provider: CodeIntegrationProvider;
  integrationId: string;
  title: string;
  body: string;
  url: string;
};

export type CreateCodeIntegrationInput = {
  projectId: string;
  provider: CodeIntegrationProvider;
  name: string;
  owner: string;
  repo: string;
};

export type UpsertReleaseMetadataInput = {
  projectId: string;
  environmentId: string;
  release: string;
  integrationId?: string | null;
  commitSha?: string | null;
  commitUrl?: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  deployedBy?: string | null;
};

function providerBase(provider: CodeIntegrationProvider): string {
  return provider === "github" ? "https://github.com" : "https://gitlab.com";
}

function normalizeSlug(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function encodeRepositoryPath(value: string): string {
  return normalizeSlug(value).split("/").map(encodeURIComponent).join("/");
}

function toIntegration(row: CodeIntegrationRow): CodeIntegrationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: row.provider,
    name: row.name,
    owner: row.owner,
    repo: row.repo,
    webBaseUrl: row.web_base_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at
  };
}

function toExternalLink(row: IncidentExternalLinkRow): IncidentExternalLinkRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    errorGroupId: row.error_group_id,
    integrationId: row.integration_id,
    provider: row.provider,
    externalKey: row.external_key,
    title: row.title,
    url: row.url,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toReleaseMetadata(row: ReleaseMetadataRow): ReleaseMetadataRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    release: row.release,
    integrationId: row.integration_id,
    commitSha: row.commit_sha,
    commitUrl: row.commit_url,
    pullRequestNumber: row.pull_request_number,
    pullRequestUrl: row.pull_request_url,
    deployedBy: row.deployed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listCodeIntegrations(db: Db, projectId: string): Promise<CodeIntegrationRecord[]> {
  const rows = await db
    .selectFrom("project_code_integrations")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("revoked_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();

  return rows.map(toIntegration);
}

export async function createCodeIntegration(
  db: Db,
  input: CreateCodeIntegrationInput
): Promise<CodeIntegrationRecord> {
  const owner = normalizeSlug(input.owner);
  const repo = normalizeSlug(input.repo);
  const base = providerBase(input.provider);
  const row = await db
    .insertInto("project_code_integrations")
    .values({
      id: createId("cint"),
      project_id: input.projectId,
      provider: input.provider,
      name: input.name.trim(),
      owner,
      repo,
      web_base_url: `${base}/${encodeRepositoryPath(owner)}/${encodeRepositoryPath(repo)}`
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "provider", "owner", "repo"]).doUpdateSet({
        name: input.name.trim(),
        revoked_at: null,
        updated_at: new Date()
      })
    )
    .returningAll()
    .executeTakeFirstOrThrow();

  return toIntegration(row);
}

export async function revokeCodeIntegration(
  db: Db,
  input: { projectId: string; integrationId: string }
): Promise<CodeIntegrationRecord | undefined> {
  const row = await db
    .updateTable("project_code_integrations")
    .set({ revoked_at: new Date(), updated_at: new Date() })
    .where("project_id", "=", input.projectId)
    .where("id", "=", input.integrationId)
    .where("revoked_at", "is", null)
    .returningAll()
    .executeTakeFirst();

  return row ? toIntegration(row) : undefined;
}

export async function linkIncidentExternalIssue(
  db: Db,
  input: {
    projectId: string;
    environmentId: string;
    errorGroupId: string;
    integrationId?: string | null;
    provider: CodeIntegrationProvider;
    externalKey: string;
    title: string;
    url: string;
    state?: string;
  }
): Promise<IncidentExternalLinkRecord> {
  const row = await db
    .insertInto("incident_external_links")
    .values({
      id: createId("iext"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      error_group_id: input.errorGroupId,
      integration_id: input.integrationId ?? null,
      provider: input.provider,
      external_key: input.externalKey.trim(),
      title: input.title.trim(),
      url: input.url.trim(),
      state: input.state?.trim() || "open"
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toExternalLink(row);
}

export async function listIncidentExternalIssues(
  db: Db,
  input: { projectId: string; environmentId: string; errorGroupId: string }
): Promise<IncidentExternalLinkRecord[]> {
  const rows = await db
    .selectFrom("incident_external_links")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .where("error_group_id", "=", input.errorGroupId)
    .orderBy("created_at", "desc")
    .execute();

  return rows.map(toExternalLink);
}

export async function buildIncidentIssueDraft(
  db: Db,
  input: { projectId: string; environmentId: string; errorGroupId: string; integrationId: string; incidentUrl?: string }
): Promise<IssueDraft | null> {
  const integration = await db
    .selectFrom("project_code_integrations")
    .selectAll()
    .where("project_id", "=", input.projectId)
    .where("id", "=", input.integrationId)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  if (!integration) return null;

  const group = await db
    .selectFrom("error_groups")
    .select(["id", "message", "severity", "status", "occurrence_count", "affected_users_count", "affected_tenants_count", "latest_release"])
    .where("id", "=", input.errorGroupId)
    .where("project_id", "=", input.projectId)
    .where("environment_id", "=", input.environmentId)
    .executeTakeFirst();
  if (!group) return null;

  const title = `[Sigmon] ${group.severity}: ${group.message}`.slice(0, 180);
  const body = [
    `SignalMonitor incident: ${group.message}`,
    "",
    `Severity: ${group.severity}`,
    `Status: ${group.status}`,
    `Occurrences: ${group.occurrence_count}`,
    `Affected users: ${group.affected_users_count}`,
    `Affected tenants: ${group.affected_tenants_count}`,
    `Latest release: ${group.latest_release ?? "none"}`,
    input.incidentUrl ? `Sigmon URL: ${input.incidentUrl}` : null
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const params = new URLSearchParams();
  params.set("title", title);
  params.set("body", body);
  const base = toIntegration(integration).webBaseUrl;
  const url =
    integration.provider === "github"
      ? `${base}/issues/new?${params.toString()}`
      : `${base}/-/issues/new?${params.toString()}`;

  return { provider: integration.provider, integrationId: integration.id, title, body, url };
}

export async function upsertReleaseMetadata(
  db: Db,
  input: UpsertReleaseMetadataInput
): Promise<ReleaseMetadataRecord> {
  const row = await db
    .insertInto("release_metadata")
    .values({
      id: createId("relm"),
      project_id: input.projectId,
      environment_id: input.environmentId,
      release: input.release,
      integration_id: input.integrationId ?? null,
      commit_sha: input.commitSha ?? null,
      commit_url: input.commitUrl ?? null,
      pull_request_number: input.pullRequestNumber ?? null,
      pull_request_url: input.pullRequestUrl ?? null,
      deployed_by: input.deployedBy ?? null
    })
    .onConflict((oc) =>
      oc.columns(["project_id", "environment_id", "release"]).doUpdateSet({
        integration_id: input.integrationId ?? null,
        commit_sha: input.commitSha ?? null,
        commit_url: input.commitUrl ?? null,
        pull_request_number: input.pullRequestNumber ?? null,
        pull_request_url: input.pullRequestUrl ?? null,
        deployed_by: input.deployedBy ?? null,
        updated_at: new Date()
      })
    )
    .returningAll()
    .executeTakeFirstOrThrow();

  return toReleaseMetadata(row);
}

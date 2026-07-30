import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { createTestDb } from "./test-db.js";
import { createEnvironment, createProject } from "../src/repositories/admin.js";
import { insertError } from "../src/repositories/telemetry-writes.js";
import {
  buildIncidentIssueDraft,
  createCodeIntegration,
  linkIncidentExternalIssue,
  listCodeIntegrations,
  listIncidentExternalIssues,
  revokeCodeIntegration,
  upsertReleaseMetadata
} from "../src/repositories/code-integrations.js";

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
let db: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("sigmon")
    .withUsername("sigmon")
    .withPassword("sigmon")
    .start();
  db = createTestDb(container.getConnectionUri());
  await migrate(db);
}, 60_000);

afterAll(async () => {
  await db?.destroy();
  await container?.stop();
}, 30_000);

async function createScope() {
  const project = await createProject(db, { name: `Code integrations ${Date.now()}` });
  const environment = await createEnvironment(db, { projectId: project.id, name: "production" });
  return { project, environment };
}

describe("code integration repositories", () => {
  it("creates, restores, lists, and revokes repository connections", async () => {
    const { project } = await createScope();

    const integration = await createCodeIntegration(db, {
      projectId: project.id,
      provider: "gitlab",
      name: "Backend",
      owner: "platform/team",
      repo: "api"
    });
    expect(integration.webBaseUrl).toBe("https://gitlab.com/platform/team/api");

    await revokeCodeIntegration(db, { projectId: project.id, integrationId: integration.id });
    await expect(listCodeIntegrations(db, project.id)).resolves.toEqual([]);

    const restored = await createCodeIntegration(db, {
      projectId: project.id,
      provider: "gitlab",
      name: "Backend prod",
      owner: "platform/team",
      repo: "api"
    });
    expect(restored.id).toBe(integration.id);
    expect(restored.name).toBe("Backend prod");
    await expect(listCodeIntegrations(db, project.id)).resolves.toHaveLength(1);
  });

  it("builds issue drafts, links external issues, and stores release metadata", async () => {
    const { project, environment } = await createScope();
    const now = new Date("2026-01-01T00:00:00.000Z");
    await insertError(db, {
      id: "err_code_1",
      projectId: project.id,
      environmentId: environment.id,
      timestamp: now,
      receivedAt: now,
      message: "Checkout exploded",
      severity: "error",
      release: "web@1.2.3"
    });

    const group = await db
      .selectFrom("error_groups")
      .selectAll()
      .where("project_id", "=", project.id)
      .where("environment_id", "=", environment.id)
      .executeTakeFirstOrThrow();

    const integration = await createCodeIntegration(db, {
      projectId: project.id,
      provider: "github",
      name: "Web",
      owner: "acme",
      repo: "web"
    });

    const draft = await buildIncidentIssueDraft(db, {
      projectId: project.id,
      environmentId: environment.id,
      errorGroupId: group.id,
      integrationId: integration.id,
      incidentUrl: "https://my.sigmon.app/console/incidents/1"
    });
    expect(draft?.url).toContain("https://github.com/acme/web/issues/new?");
    expect(draft?.body).toContain("Checkout exploded");

    const link = await linkIncidentExternalIssue(db, {
      projectId: project.id,
      environmentId: environment.id,
      errorGroupId: group.id,
      integrationId: integration.id,
      provider: "github",
      externalKey: "42",
      title: "Fix checkout",
      url: "https://github.com/acme/web/issues/42"
    });
    expect(link.state).toBe("open");
    await expect(listIncidentExternalIssues(db, {
      projectId: project.id,
      environmentId: environment.id,
      errorGroupId: group.id
    })).resolves.toHaveLength(1);

    const metadata = await upsertReleaseMetadata(db, {
      projectId: project.id,
      environmentId: environment.id,
      release: "web@1.2.3",
      integrationId: integration.id,
      commitSha: "abcdef123456",
      commitUrl: "https://github.com/acme/web/commit/abcdef123456",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/acme/web/pull/42",
      deployedBy: "github-actions"
    });
    expect(metadata.commitSha).toBe("abcdef123456");
  });

  it("rejects release metadata linked to a repository from another project", async () => {
    const { project, environment } = await createScope();
    const other = await createScope();
    const integration = await createCodeIntegration(db, {
      projectId: other.project.id,
      provider: "github",
      name: "Other repository",
      owner: "acme",
      repo: "other"
    });

    await expect(upsertReleaseMetadata(db, {
      projectId: project.id,
      environmentId: environment.id,
      release: "web@2.0.0",
      integrationId: integration.id
    })).rejects.toThrow("code_integration_not_found");
  });
});

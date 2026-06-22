import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ApiClient } from "../api/client";
import type { ApiKey, CreatedApiKey } from "../api/types";
import { ApiKeyPanel } from "./ApiKeyPanel";

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    fetchFleet: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn().mockResolvedValue({ projects: [] }),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn().mockResolvedValue({ environments: [] }),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [] }),
    createApiKey: vi.fn(),
    updateApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    listTraces: vi.fn().mockResolvedValue({ data: [] }),
    listTraceSpans: vi.fn().mockResolvedValue({ data: [] }),
    listLlmCalls: vi.fn().mockResolvedValue({ data: [] }),
    getLlmAggregates: vi.fn().mockResolvedValue({ data: { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: "0" } }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    getOverview: vi.fn(),
    getSystemHealth: vi.fn(),
    listEntityTenants: vi.fn().mockResolvedValue({ data: { tenants: [] } }),
    getEntityTenantDetail: vi.fn(),
    listUsersActivity: vi.fn().mockResolvedValue({ data: { users: [] } }),
    getUserDetail: vi.fn().mockResolvedValue({ data: { window: "7d", generatedAt: "2026-05-05T12:00:00.000Z", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: "2026-04-28T12:00:00.000Z", to: "2026-05-05T12:00:00.000Z" }, user: { userId: "user_1", label: "user_1", isAnonymous: false, impactScore: 0, lastSeenAt: null, events: 0, errors: 0, openErrors: 0, severeErrors: 0, traces: 0, failedTraces: 0, llmCalls: 0, failedLlmCalls: 0, llmCostUsd: "0", activeTenants: 0, activeSessions: 0 }, recentSessions: [], timeline: [] } }),
    listUsers: vi.fn().mockResolvedValue({ users: [] }),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    listNotificationChannels: vi.fn().mockResolvedValue({ channels: [] }),
    createNotificationChannel: vi.fn(),
    updateNotificationChannel: vi.fn(),
    archiveNotificationChannel: vi.fn(),
    listAlertRules: vi.fn().mockResolvedValue({ rules: [] }),
    createAlertRule: vi.fn(),
    updateAlertRule: vi.fn(),
    archiveAlertRule: vi.fn(),
    listAlertEvents: vi.fn().mockResolvedValue({ data: [] }),
    getAlertEvent: vi.fn(),
    listErrorGroups: vi.fn().mockResolvedValue({ data: [] }),
    getErrorGroup: vi.fn(),
    getErrorGroupIncident: vi.fn(),
    updateErrorGroupStatus: vi.fn(),
    updateErrorGroupTriage: vi.fn(),
    addTriageNote: vi.fn(),
    silenceIncident: vi.fn(),
    getSessionTimeline: vi.fn().mockResolvedValue({ data: { sessionId: "sess_1", scope: { projectId: "prj_1", environmentId: "env_1" }, range: { from: null, to: null }, items: [], page: { nextCursor: null, previousCursor: null } } }),
    ...overrides
  };
}

const existingKey: ApiKey = {
  id: "key_1",
  projectId: "prj_1",
  environmentId: "env_1",
  name: "Production ingest",
  prefix: "sh_live_1234",
  createdAt: "",
  revokedAt: null
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
});

describe("ApiKeyPanel", () => {
  it("lists existing key names and prefixes without showing a secret", async () => {
    const api = client({
      listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [existingKey] })
    });

    render(
      <ApiKeyPanel
        client={api}
        environmentId="env_1"
        onSecretCreated={vi.fn()}
        projectId="prj_1"
      />
    );

    expect(await screen.findByText("Production ingest")).toBeInTheDocument();
    expect(screen.getByText("sh_live_1234")).toBeInTheDocument();
    expect(screen.queryByText("env_1")).not.toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
    expect(screen.queryByText("sh_secret_value")).not.toBeInTheDocument();
  });

  it("creates a key for the active project and environment, shows the one-time secret, and reports it", async () => {
    const createdKey: CreatedApiKey = {
      ...existingKey,
      id: "key_2",
      name: "Browser key",
      prefix: "sh_live_9876",
      secret: "sh_secret_value"
    };
    const onSecretCreated = vi.fn();
    const api = client({
      createApiKey: vi.fn().mockResolvedValue({ apiKey: createdKey })
    });

    render(
      <ApiKeyPanel
        client={api}
        environmentId="env_1"
        onSecretCreated={onSecretCreated}
        projectId="prj_1"
      />
    );

    await userEvent.type(screen.getByLabelText("New API key name"), "Browser key");
    await userEvent.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() =>
      expect(api.createApiKey).toHaveBeenCalledWith("prj_1", {
        environmentId: "env_1",
        name: "Browser key"
      })
    );
    expect(await screen.findByText("sh_secret_value")).toBeInTheDocument();
    expect(screen.getByText("Browser key")).toBeInTheDocument();
    expect(onSecretCreated).toHaveBeenCalledWith("sh_secret_value");
    expect(screen.getByLabelText("New API key name")).toHaveValue("");
  });

  it("renames an existing key", async () => {
    const api = client({
      listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [existingKey] }),
      updateApiKey: vi.fn().mockResolvedValue({
        apiKey: {
          ...existingKey,
          name: "Browser production"
        }
      })
    });

    render(
      <ApiKeyPanel
        client={api}
        environmentId="env_1"
        onSecretCreated={vi.fn()}
        projectId="prj_1"
      />
    );

    await userEvent.click(await screen.findByRole("button", { name: "Edit Production ingest" }));
    await userEvent.clear(screen.getByLabelText("API key name"));
    await userEvent.type(screen.getByLabelText("API key name"), "Browser production");
    await userEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() =>
      expect(api.updateApiKey).toHaveBeenCalledWith("key_1", {
        name: "Browser production"
      })
    );
    expect(await screen.findByText("Browser production")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create key" })).toBeInTheDocument();
  });

  it("hides an already displayed one-time secret immediately when the environment changes", async () => {
    const createdKey: CreatedApiKey = {
      ...existingKey,
      id: "key_2",
      name: "Browser key",
      prefix: "sh_live_9876",
      secret: "sh_secret_value"
    };
    const onSecretCreated = vi.fn();
    const api = client({
      createApiKey: vi.fn().mockResolvedValue({ apiKey: createdKey })
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      flushSync(() => {
        root.render(
          <ApiKeyPanel
            client={api}
            environmentId="env_1"
            onSecretCreated={onSecretCreated}
            projectId="prj_1"
          />
        );
      });

      await act(async () => {});
      await userEvent.type(screen.getByLabelText("New API key name"), "Browser key");
      await userEvent.click(screen.getByRole("button", { name: "Create key" }));

      expect(await screen.findByText("sh_secret_value")).toBeInTheDocument();

      flushSync(() => {
        root.render(
          <ApiKeyPanel
            client={api}
            environmentId="env_2"
            onSecretCreated={onSecretCreated}
            projectId="prj_1"
          />
        );
      });

      expect(screen.queryByText("sh_secret_value")).not.toBeInTheDocument();
    } finally {
      root.unmount();
      container.remove();
    }
  });

  it("disables Create key when no environment is selected", () => {
    const api = client({});

    render(<ApiKeyPanel client={api} onSecretCreated={vi.fn()} projectId="prj_1" />);

    expect(screen.getByLabelText("New API key name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create key" })).toBeDisabled();
  });

  it("revokes an existing key after confirmation and removes it from the active list", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = client({
      listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [existingKey] }),
      revokeApiKey: vi.fn().mockResolvedValue({})
    });

    render(
      <ApiKeyPanel
        client={api}
        environmentId="env_1"
        onSecretCreated={vi.fn()}
        projectId="prj_1"
      />
    );

    expect(await screen.findByText("Production ingest")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Revoke Production ingest" }));

    expect(confirm).toHaveBeenCalledWith("Revoke API key Production ingest?");
    expect(api.revokeApiKey).toHaveBeenCalledWith("key_1");
    await waitFor(() => expect(screen.queryByText("Production ingest")).not.toBeInTheDocument());
    expect(screen.getByText("No API keys yet.")).toBeInTheDocument();

    confirm.mockRestore();
  });

  it("does not apply a created key after the environment changes before the response resolves", async () => {
    const createApiKey = deferred<{ apiKey: CreatedApiKey }>();
    const onSecretCreated = vi.fn();
    const api = client({
      createApiKey: vi.fn().mockReturnValue(createApiKey.promise)
    });
    const { rerender } = render(
      <ApiKeyPanel
        client={api}
        environmentId="env_1"
        onSecretCreated={onSecretCreated}
        projectId="prj_1"
      />
    );

    await userEvent.type(screen.getByLabelText("New API key name"), "Browser key");
    await userEvent.click(screen.getByRole("button", { name: "Create key" }));

    rerender(
      <ApiKeyPanel
        client={api}
        environmentId="env_2"
        onSecretCreated={onSecretCreated}
        projectId="prj_1"
      />
    );

    await act(async () => {
      createApiKey.resolve({
        apiKey: {
          ...existingKey,
          id: "key_2",
          name: "Browser key",
          secret: "sh_secret_value"
        }
      });
      await createApiKey.promise;
    });

    expect(onSecretCreated).not.toHaveBeenCalled();
    expect(screen.queryByText("sh_secret_value")).not.toBeInTheDocument();
    expect(screen.queryByText("Browser key")).not.toBeInTheDocument();
  });

  it("does not apply a created key when the environment changes before passive effects run", async () => {
    const createApiKey = deferred<{ apiKey: CreatedApiKey }>();
    const onSecretCreated = vi.fn();
    const api = client({
      createApiKey: vi.fn().mockReturnValue(createApiKey.promise)
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      flushSync(() => {
        root.render(
          <ApiKeyPanel
            client={api}
            environmentId="env_1"
            onSecretCreated={onSecretCreated}
            projectId="prj_1"
          />
        );
      });

      await act(async () => {});
      await userEvent.type(screen.getByLabelText("New API key name"), "Browser key");
      await userEvent.click(screen.getByRole("button", { name: "Create key" }));

      flushSync(() => {
        root.render(
          <ApiKeyPanel
            client={api}
            environmentId="env_2"
            onSecretCreated={onSecretCreated}
            projectId="prj_1"
          />
        );
      });
      createApiKey.resolve({
        apiKey: {
          ...existingKey,
          id: "key_2",
          name: "Browser key",
          secret: "sh_secret_value"
        }
      });

      await act(async () => {
        await createApiKey.promise;
      });

      expect(onSecretCreated).not.toHaveBeenCalled();
      expect(screen.queryByText("sh_secret_value")).not.toBeInTheDocument();
      expect(screen.queryByText("Browser key")).not.toBeInTheDocument();
    } finally {
      root.unmount();
      container.remove();
    }
  });
});

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
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    listUsers: vi.fn().mockResolvedValue({ users: [] }),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
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

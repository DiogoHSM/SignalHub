// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../../api/client";
import type { Environment, Project, ReadToken } from "../../api/types";
import type { NavSection } from "../nav";
import { ReadTokensSection } from "./ReadTokensSection";
import type { ScreenCtx, SecretKind } from "./registry";

afterEach(cleanup);

const project: Project = { id: "prj_1", name: "Acme", createdAt: "x", updatedAt: "x", archivedAt: null };
const environment: Environment = { id: "env_1", projectId: "prj_1", name: "production", createdAt: "x", updatedAt: "x", archivedAt: null };

const tokenRow: ReadToken = {
  id: "rt_1", projectId: "prj_1", environmentId: "env_1", name: "mcp server", prefix: "shread_ab",
  createdAt: "2026-06-24T10:00:00.000Z", lastUsedAt: "2026-06-24T11:00:00.000Z", revokedAt: null,
};
const revokedRow: ReadToken = {
  id: "rt_2", projectId: "prj_1", environmentId: "env_1", name: "old dashboard", prefix: "shread_zz",
  createdAt: "2026-06-20T10:00:00.000Z", lastUsedAt: null, revokedAt: "2026-06-21T10:00:00.000Z",
};

function makeClient(over: Partial<ApiClient> = {}): ApiClient {
  return {
    listReadTokens: vi.fn().mockResolvedValue({ tokens: [tokenRow, revokedRow] }),
    createReadToken: vi.fn().mockResolvedValue({ token: { ...tokenRow, id: "rt_new", name: "new token", secret: "shread_secret_value" } }),
    renameReadToken: vi.fn().mockResolvedValue({ token: { ...tokenRow, name: "renamed" } }),
    revokeReadToken: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as ApiClient;
}

function makeCtx(over: Partial<ScreenCtx> = {}): ScreenCtx {
  return {
    client: makeClient(),
    project,
    environment,
    environments: [environment],
    onCreateEnvironment: vi.fn(),
    onArchiveEnvironment: vi.fn(),
    onArchiveProject: vi.fn(),
    onSecretCreated: vi.fn(),
    createdSecret: null,
    onSelectEnvironment: vi.fn(),
    onUpdateProject: vi.fn(),
    onUpdateEnvironment: vi.fn(),
    navigate: vi.fn() as (s: NavSection) => void,
    pendingFilters: null,
    clearPendingFilters: vi.fn(),
    back: vi.fn(),
    drill: vi.fn(),
    pushToast: vi.fn(),
    ...over,
  };
}

describe("ReadTokensSection", () => {
  it("renders the token list with prefix, name, timestamps, and a revoked badge", async () => {
    render(<ReadTokensSection ctx={makeCtx()} />);
    expect(await screen.findByText("mcp server")).toBeInTheDocument();
    expect(screen.getByText(/shread_ab.*created.*used/)).toBeInTheDocument();
    expect(screen.getByText("old dashboard")).toBeInTheDocument();
    expect(screen.getByText("revoked")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("creates a token and reveals the one-time secret via ctx.onSecretCreated", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });
    render(<ReadTokensSection ctx={ctx} />);
    fireEvent.click(await screen.findByRole("button", { name: "New token" }));
    const input = screen.getByLabelText("New token name");
    fireEvent.change(input, { target: { value: "new token" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.createReadToken).toHaveBeenCalledWith({ projectId: "prj_1", environmentId: "env_1", name: "new token" }));
    await waitFor(() => expect(ctx.onSecretCreated).toHaveBeenCalledWith("shread_secret_value", "readToken"));
  });

  it("reports a failed create through runMutation's toast contract", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeClient({ createReadToken: vi.fn().mockRejectedValue(new Error("offline")) });
    const ctx = makeCtx({ client });
    render(<ReadTokensSection ctx={ctx} />);
    fireEvent.click(await screen.findByRole("button", { name: "New token" }));
    const input = screen.getByLabelText("New token name");
    fireEvent.change(input, { target: { value: "new token" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Could not create read token"));
    expect(ctx.onSecretCreated).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reports a failed rename and revoke through runMutation's toast contract", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeClient({
      renameReadToken: vi.fn().mockRejectedValue(new Error("offline")),
      revokeReadToken: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const ctx = makeCtx({ client });
    render(<ReadTokensSection ctx={ctx} />);

    fireEvent.click(await screen.findByRole("button", { name: "Rename mcp server" }));
    const renameInput = screen.getByLabelText("Rename token");
    fireEvent.change(renameInput, { target: { value: "renamed" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Could not rename read token"));

    fireEvent.click(screen.getByRole("button", { name: "Revoke mcp server" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() => expect(ctx.pushToast).toHaveBeenCalledWith("Could not revoke read token"));
    consoleError.mockRestore();
  });

  it("shows the secret panel when ctx.createdSecret is set and hides it once cleared", async () => {
    const ctx = makeCtx({ createdSecret: { value: "shread_secret_value", kind: "readToken" } });
    const { rerender } = render(<ReadTokensSection ctx={ctx} />);
    expect(await screen.findByText(/shown once/i)).toBeInTheDocument();
    expect(screen.getByText(/read-only.*this project and environment only/i)).toBeInTheDocument();

    rerender(<ReadTokensSection ctx={makeCtx({ createdSecret: null })} />);
    await waitFor(() => expect(screen.queryByText(/shown once/i)).not.toBeInTheDocument());
  });

  it("ignores a secret created by another credential surface (e.g. the Setup API key)", async () => {
    const ctx = makeCtx({ createdSecret: { value: "sh_live_browser_secret", kind: "browserApiKey" } });
    render(<ReadTokensSection ctx={ctx} />);
    await screen.findByText("mcp server");
    expect(screen.queryByText(/shown once/i)).not.toBeInTheDocument();
    expect(screen.queryByText("sh_live_browser_secret")).not.toBeInTheDocument();
  });

  it("dismissing the secret panel calls ctx.onSecretCreated(null, \"readToken\")", async () => {
    const ctx = makeCtx({ createdSecret: { value: "shread_secret_value", kind: "readToken" } });
    render(<ReadTokensSection ctx={ctx} />);
    fireEvent.click(await screen.findByRole("button", { name: /done/i }));
    expect(ctx.onSecretCreated).toHaveBeenCalledWith(null, "readToken");
  });

  it("renames a token from the inline editor", async () => {
    const client = makeClient();
    render(<ReadTokensSection ctx={makeCtx({ client })} />);
    const rename = await screen.findByRole("button", { name: "Rename mcp server" });
    fireEvent.click(rename);
    const input = screen.getByLabelText("Rename token");
    fireEvent.change(input, { target: { value: "renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.renameReadToken).toHaveBeenCalledWith("rt_1", { projectId: "prj_1", environmentId: "env_1" }, { name: "renamed" }));
  });

  it("revokes a token after confirm", async () => {
    const client = makeClient();
    render(<ReadTokensSection ctx={makeCtx({ client })} />);
    const revoke = await screen.findByRole("button", { name: "Revoke mcp server" });
    fireEvent.click(revoke); // arm
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ })); // confirm
    await waitFor(() => expect(client.revokeReadToken).toHaveBeenCalledWith("rt_1", { projectId: "prj_1", environmentId: "env_1" }));
  });

  it("disables the create form while a mutation is busy", async () => {
    let finish!: (value: { token: ReadToken & { secret: string } }) => void;
    const pending = new Promise<{ token: ReadToken & { secret: string } }>((resolve) => { finish = resolve; });
    const client = makeClient({ createReadToken: vi.fn().mockReturnValue(pending) });
    render(<ReadTokensSection ctx={makeCtx({ client })} />);
    fireEvent.click(await screen.findByRole("button", { name: "New token" }));
    const input = screen.getByLabelText("New token name");
    fireEvent.change(input, { target: { value: "new token" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByRole("button", { name: "Create" })).toBeDisabled());
    finish({ token: { ...tokenRow, id: "rt_new", secret: "shread_secret_value" } });
    await waitFor(() => expect(client.createReadToken).toHaveBeenCalled());
  });

  it("shows an unavailable hint when the read-token API is absent", async () => {
    render(<ReadTokensSection ctx={makeCtx({ client: {} as unknown as ApiClient })} />);
    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
  });

  it("shows an unavailable hint, not a blank card, when the server 501s with read_tokens_repository_unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeClient({ listReadTokens: vi.fn().mockRejectedValue(new ApiError(501, "read_tokens_repository_unavailable")) });
    render(<ReadTokensSection ctx={makeCtx({ client })} />);
    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("shows an actionable retry hint, not a blank card, on a generic load failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = makeClient({ listReadTokens: vi.fn().mockRejectedValue(new Error("network down")) });
    render(<ReadTokensSection ctx={makeCtx({ client })} />);
    expect(await screen.findByText(/could not load read tokens/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("keeps the secret panel visible when a list refetch fails right after a successful create", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let listCalls = 0;
    const client = makeClient({
      listReadTokens: vi.fn().mockImplementation(() => {
        listCalls += 1;
        return listCalls === 1
          ? Promise.resolve({ tokens: [tokenRow] })
          : Promise.reject(new Error("network blip"));
      }),
      createReadToken: vi.fn().mockResolvedValue({ token: { ...tokenRow, id: "rt_new", name: "new token", secret: "shread_secret_value" } }),
    });

    function Host() {
      const [createdSecret, setCreatedSecret] = useState<{ value: string; kind: SecretKind } | null>(null);
      const ctx = makeCtx({
        client,
        createdSecret,
        onSecretCreated: (secret: string | null, kind: SecretKind) =>
          setCreatedSecret(secret ? { value: secret, kind } : null),
      });
      return <ReadTokensSection ctx={ctx} />;
    }

    render(<Host />);
    fireEvent.click(await screen.findByRole("button", { name: "New token" }));
    const input = screen.getByLabelText("New token name");
    fireEvent.change(input, { target: { value: "new token" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The refetch triggered by the successful create fails — the list card
    // shows the retry state, but the secret the operator just minted must
    // still be on screen; it lives above this hook's own status.
    await waitFor(() => expect(screen.getByText(/could not load read tokens/i)).toBeInTheDocument());
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("shows an empty hint when there are no tokens", async () => {
    const client = makeClient({ listReadTokens: vi.fn().mockResolvedValue({ tokens: [] }) });
    render(<ReadTokensSection ctx={makeCtx({ client })} />);
    expect(await screen.findByText(/no read tokens/i)).toBeInTheDocument();
  });
});

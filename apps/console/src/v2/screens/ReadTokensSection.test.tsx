// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ApiClient } from "../../api/client";
import type { Environment, Project, ReadToken } from "../../api/types";
import type { NavSection } from "../nav";
import { ReadTokensSection } from "./ReadTokensSection";
import type { ScreenCtx } from "./registry";

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
    await waitFor(() => expect(ctx.onSecretCreated).toHaveBeenCalledWith("shread_secret_value"));
  });

  it("shows the secret panel when ctx.createdSecret is set and hides it once cleared", async () => {
    const ctx = makeCtx({ createdSecret: "shread_secret_value" });
    const { rerender } = render(<ReadTokensSection ctx={ctx} />);
    expect(await screen.findByText(/shown once/i)).toBeInTheDocument();
    expect(screen.getByText(/read-only.*this project and environment only/i)).toBeInTheDocument();

    rerender(<ReadTokensSection ctx={makeCtx({ createdSecret: null })} />);
    await waitFor(() => expect(screen.queryByText(/shown once/i)).not.toBeInTheDocument());
  });

  it("dismissing the secret panel calls ctx.onSecretCreated(null)", async () => {
    const ctx = makeCtx({ createdSecret: "shread_secret_value" });
    render(<ReadTokensSection ctx={ctx} />);
    fireEvent.click(await screen.findByRole("button", { name: /done/i }));
    expect(ctx.onSecretCreated).toHaveBeenCalledWith(null);
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

  it("shows an empty hint when there are no tokens", async () => {
    const client = makeClient({ listReadTokens: vi.fn().mockResolvedValue({ tokens: [] }) });
    render(<ReadTokensSection ctx={makeCtx({ client })} />);
    expect(await screen.findByText(/no read tokens/i)).toBeInTheDocument();
  });
});

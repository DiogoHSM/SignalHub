import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

describe("createApiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("login sends credentials, JSON headers, and POST body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { user: { id: "usr_1", email: "admin@example.com", isAdmin: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().login("admin@example.com", "very-secure-password");

    expect(fetchMock).toHaveBeenCalledWith("/auth/login", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email: "admin@example.com", password: "very-secure-password" })
    });
  });

  it("throws ApiError with status and code for non-OK JSON errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { error: "admin_required" })));

    const request = createApiClient().listUsers();
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      code: "admin_required"
    });
  });

  it("falls back to request_failed for non-OK invalid JSON errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 500 })));

    const request = createApiClient().listUsers();
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      status: 500,
      code: "request_failed"
    });
  });

  it("falls back to request_failed for non-OK missing JSON errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emptyResponse(500)));

    const request = createApiClient().listUsers();
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      status: 500,
      code: "request_failed"
    });
  });

  it("returns undefined for 204 delete/archive responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emptyResponse(204)));

    await expect(createApiClient().archiveProject("prj_1")).resolves.toBeUndefined();
  });

  it("encodes path IDs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { project: { id: "prj/1", name: "Name" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().updateProject("prj/1", { name: "Name" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/projects/prj%2F1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "Name" })
      })
    );
  });

  it("encodes query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listEvents({ projectId: "prj/1", environmentId: "env 1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events?project_id=prj%2F1&environment_id=env+1",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes event name query filter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listEvents({
      projectId: "prj_1",
      environmentId: "env_1",
      eventName: "checkout.started"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events?project_id=prj_1&environment_id=env_1&event_name=checkout.started",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not encode error-only filters for event queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listEvents({
      projectId: "prj_1",
      environmentId: "env_1",
      eventName: "checkout.started",
      severity: "critical",
      status: "open",
      fingerprint: "fp_1"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/events?project_id=prj_1&environment_id=env_1&event_name=checkout.started",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("encodes error query filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient().listErrors({
      projectId: "prj_1",
      environmentId: "env_1",
      severity: "critical",
      status: "open",
      fingerprint: "fp_checkout_fetch"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/query/errors?project_id=prj_1&environment_id=env_1&severity=critical&status=open&fingerprint=fp_checkout_fetch",
      expect.objectContaining({ method: "GET" })
    );
  });
});

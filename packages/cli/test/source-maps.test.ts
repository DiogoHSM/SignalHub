import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSourceMapUploadCommand } from "../src/source-maps.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function tempFile(name: string, content = "{}"): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sigmon-cli-"));
  const file = path.join(dir, name);
  await writeFile(file, content);
  return file;
}

function requiredEnv() {
  return {
    SIGMON_ENDPOINT: "https://sigmon.example.com",
    SIGMON_SOURCE_MAP_TOKEN: "shsmap_secret",
    SIGMON_PROJECT_ID: "prj_1",
    SIGMON_ENVIRONMENT_ID: "env_1",
    SIGMON_RELEASE: "web@1.2.3"
  };
}

describe("source map upload command", () => {
  it("uploads a single source map with flags", async () => {
    const file = await tempFile("app.js.map", '{"version":3,"sources":[],"names":[],"mappings":"","file":"assets/app.js"}');
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ artifacts: [{ minifiedFile: "assets/app.js" }] })
    });
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const stdout: string[] = [];

    const exitCode = await runSourceMapUploadCommand(
      [
        "--endpoint",
        "https://sigmon.example.com",
        "--token",
        "shsmap_secret",
        "--project-id",
        "prj_1",
        "--environment-id",
        "env_1",
        "--release",
        "web@1.2.3",
        "--file",
        file,
        "--minified-file",
        "assets/app.js"
      ],
      { env: {}, stdout: (line) => stdout.push(line), stderr: () => undefined }
    );

    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const body = init.body as FormData;

    expect(exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledWith(
      "https://sigmon.example.com/v1/source-maps",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer shsmap_secret" },
        signal: expect.any(AbortSignal)
      })
    );
    expect(body.get("project_id")).toBe("prj_1");
    expect(body.get("environment_id")).toBe("env_1");
    expect(body.get("release")).toBe("web@1.2.3");
    expect(body.get("minified_file")).toBe("assets/app.js");
    expect(body.get("file")).toBeInstanceOf(Blob);
    expect(body.get("bundle")).toBeNull();
    expect(stdout.join("\n")).toContain("Uploaded 1 source map artifact(s)");
    expect(stdout.join("\n")).toContain("assets/app.js");
  });

  it("uses environment fallbacks and uploads a bundle", async () => {
    const bundle = await tempFile("source-maps.zip", "zip");
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ artifacts: [{ minifiedFile: "assets/app.js" }, { minifiedFile: "assets/vendor.js" }] })
    });
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const stdout: string[] = [];

    const exitCode = await runSourceMapUploadCommand(["--bundle", bundle], {
      env: { ...requiredEnv(), SIGMON_ENDPOINT: "https://sigmon.example.com/" },
      stdout: (line) => stdout.push(line),
      stderr: () => undefined
    });

    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const body = init.body as FormData;

    expect(exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledWith(
      "https://sigmon.example.com/v1/source-maps",
      expect.objectContaining({ method: "POST" })
    );
    expect(body.get("bundle")).toBeInstanceOf(Blob);
    expect(body.get("file")).toBeNull();
    expect(stdout.join("\n")).toContain("Uploaded 2 source map artifact(s)");
    expect(stdout.join("\n")).toContain("assets/vendor.js");
  });

  it("rejects missing required inputs without leaking token values", async () => {
    const stderr: string[] = [];
    const exitCode = await runSourceMapUploadCommand(["--token", "shsmap_super_secret"], {
      env: {},
      stdout: () => undefined,
      stderr: (line) => stderr.push(line)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Missing required option");
    expect(stderr.join("\n")).not.toContain("shsmap_super_secret");
  });

  it("does not leak token-like positional arguments in parse errors", async () => {
    const stderr: string[] = [];

    const exitCode = await runSourceMapUploadCommand(["--token", "shsmap_super_secret", "shsmap_super_secret"], {
      env: {},
      stdout: () => undefined,
      stderr: (line) => stderr.push(line)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Unknown argument");
    expect(stderr.join("\n")).not.toContain("shsmap_super_secret");
  });

  it("rejects both file and bundle", async () => {
    const file = await tempFile("app.js.map");
    const bundle = await tempFile("source-maps.zip");
    const stderr: string[] = [];

    const exitCode = await runSourceMapUploadCommand(["--file", file, "--bundle", bundle], {
      env: requiredEnv(),
      stdout: () => undefined,
      stderr: (line) => stderr.push(line)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Provide exactly one of --file or --bundle");
  });

  it("rejects minified file with bundle", async () => {
    const bundle = await tempFile("source-maps.zip");
    const stderr: string[] = [];

    const exitCode = await runSourceMapUploadCommand(["--bundle", bundle, "--minified-file", "assets/app.js"], {
      env: requiredEnv(),
      stdout: () => undefined,
      stderr: (line) => stderr.push(line)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("--minified-file can only be used with --file");
  });

  it("returns failure for HTTP errors without leaking token values", async () => {
    const file = await tempFile("app.js.map");
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "invalid shsmap_super_secret"
    });
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const stderr: string[] = [];

    const exitCode = await runSourceMapUploadCommand(["--file", file], {
      env: { ...requiredEnv(), SIGMON_SOURCE_MAP_TOKEN: "shsmap_super_secret" },
      stdout: () => undefined,
      stderr: (line) => stderr.push(line)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Source map upload failed with HTTP 401");
    expect(stderr.join("\n")).not.toContain("shsmap_super_secret");
  });

  it("aborts source map uploads that exceed the configured timeout", async () => {
    const file = await tempFile("app.js.map");
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const stderr: string[] = [];

    const exitCode = await runSourceMapUploadCommand(["--file", file, "--timeout-ms", "1"], {
      env: { ...requiredEnv(), SIGMON_SOURCE_MAP_TOKEN: "shsmap_super_secret" },
      stdout: () => undefined,
      stderr: (line) => stderr.push(line)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Source map upload timed out after 1ms");
    expect(stderr.join("\n")).not.toContain("shsmap_super_secret");
  });

  it("rejects invalid source map upload timeout values", async () => {
    const file = await tempFile("app.js.map");

    for (const timeoutMs of ["0", "0.5"]) {
      const stderr: string[] = [];

      const exitCode = await runSourceMapUploadCommand(["--file", file, "--timeout-ms", timeoutMs], {
        env: requiredEnv(),
        stdout: () => undefined,
        stderr: (line) => stderr.push(line)
      });

      expect(exitCode).toBe(1);
      expect(stderr.join("\n")).toContain("must be a positive integer");
    }
  });

  it("returns failure for missing upload files", async () => {
    const stderr: string[] = [];
    const missingFile = path.join(os.tmpdir(), "sigmon-cli-missing.map");

    const exitCode = await runSourceMapUploadCommand(["--file", missingFile], {
      env: requiredEnv(),
      stdout: () => undefined,
      stderr: (line) => stderr.push(line)
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("\n")).toContain("Upload file is not readable");
  });
});

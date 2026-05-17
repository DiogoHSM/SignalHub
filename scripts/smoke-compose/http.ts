import { basename } from "node:path";

export class SmokeHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = "SmokeHttpError";
  }
}

export interface CookieJar {
  addFromResponse(headers: Headers): void;
  header(): string;
}

export interface HttpOptions {
  fetchImpl?: typeof fetch;
  cookieJar?: CookieJar;
  redact?: (value: string) => string;
  bearerToken?: string;
}

export function createCookieJar(): CookieJar {
  const cookies = new Map<string, string>();

  return {
    addFromResponse(headers) {
      const setCookie = headers.get("set-cookie");
      if (!setCookie) return;

      const cookie = setCookie.split(";")[0]?.trim();
      if (!cookie) return;

      const separatorIndex = cookie.indexOf("=");
      if (separatorIndex <= 0) return;

      cookies.set(cookie.slice(0, separatorIndex), cookie.slice(separatorIndex + 1));
    },
    header() {
      return Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ");
    }
  };
}

async function parseBody(response: Response, redact?: (value: string) => string): Promise<string> {
  try {
    const body = await response.text();
    return redact ? redact(body) : body;
  } catch {
    return "";
  }
}

async function requestJson<T>(url: string, init: RequestInit, options: HttpOptions = {}): Promise<T> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("fetch is unavailable");

  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");

  const cookieHeader = options.cookieJar?.header();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  if (options.bearerToken) headers.set("authorization", `Bearer ${options.bearerToken}`);

  const method = init.method ?? "GET";
  const response = await fetchImpl(url, {
    ...init,
    method,
    headers
  });
  options.cookieJar?.addFromResponse(response.headers);

  if (!response.ok) {
    const body = await parseBody(response, options.redact);
    throw new SmokeHttpError(`${method} ${url} returned HTTP ${response.status}`, response.status, body);
  }

  return (await response.json()) as T;
}

export function getJson<T>(url: string, options?: HttpOptions): Promise<T> {
  return requestJson<T>(url, { method: "GET" }, options);
}

export function postJson<T>(url: string, body: unknown, options?: HttpOptions): Promise<T> {
  return requestJson<T>(url, { method: "POST", body: JSON.stringify(body) }, options);
}

export function postBearerJson<T>(url: string, body: unknown, bearerToken: string, options: HttpOptions = {}): Promise<T> {
  return postJson<T>(url, body, { ...options, bearerToken });
}

export async function uploadSourceMapFile(
  apiUrl: string,
  input: {
    token: string;
    projectId: string;
    environmentId: string;
    release: string;
    filePath: string;
    minifiedFile: string;
    fileContent: string;
    fetchImpl?: typeof fetch;
  }
): Promise<{ artifacts: Array<{ minifiedFile: string }> }> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("fetch is unavailable");

  const form = new FormData();
  form.set("project_id", input.projectId);
  form.set("environment_id", input.environmentId);
  form.set("release", input.release);
  form.set("minified_file", input.minifiedFile);
  form.set("file", new Blob([input.fileContent], { type: "application/json" }), basename(input.filePath) || "app.min.js.map");

  const response = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}/v1/source-maps`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`
    },
    body: form
  });

  if (!response.ok) {
    throw new SmokeHttpError("source map upload failed", response.status, await response.text());
  }

  return (await response.json()) as { artifacts: Array<{ minifiedFile: string }> };
}

export async function pollUntil<T>(
  label: string,
  callback: () => Promise<T | null | undefined>,
  options: { attempts: number; delayMs: number }
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const value = await callback();
      if (value != null) return value;
    } catch (error) {
      lastError = error;
    }

    if (attempt < options.attempts) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
  }

  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`${label} did not become ready${suffix}`);
}

export function expectArrayContains<T>(items: T[], predicate: (item: T) => boolean, label: string): T {
  for (const item of items) {
    if (predicate(item)) return item;
  }

  throw new Error(`Expected ${label}`);
}

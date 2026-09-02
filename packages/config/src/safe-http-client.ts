import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import type { OutboundPolicy } from "./network-security.js";
import { createSafeLookup } from "./safe-lookup.js";

export type SafeHttpMethod = "GET" | "HEAD" | "POST";

export type SafeHttpRequestInput = {
  url: string | URL;
  method: SafeHttpMethod;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs: number;
  maxResponseBytes?: number;
  redirectLimit?: number;
  policy: OutboundPolicy;
  lookup?: LookupFunction;
};

export type SafeHttpResponse = {
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
  latencyMs: number;
};

const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function safeHttpRequest(input: SafeHttpRequestInput): Promise<SafeHttpResponse> {
  validateOptions(input);
  const startedAt = Date.now();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), input.timeoutMs);
  const visited = new Set<string>();

  try {
    let url = validateTarget(input.url, input.policy);
    let headers = { ...(input.headers ?? {}) };
    const redirectLimit = input.redirectLimit ?? 0;

    for (let redirects = 0; ; redirects += 1) {
      if (visited.has(url.href)) {
        throw safeHttpError("outbound_http_redirect_loop");
      }
      visited.add(url.href);

      const response = await requestOnce({
        url,
        method: input.method,
        headers,
        body: input.body,
        maxResponseBytes: input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
        signal: controller.signal,
        lookup: createSafeLookup(input.policy, input.lookup ?? dnsLookup),
        startedAt
      });

      if (!REDIRECT_STATUSES.has(response.status) || redirectLimit === 0) {
        return response;
      }
      if (input.method !== "GET" && input.method !== "HEAD") {
        throw safeHttpError("outbound_http_redirect_forbidden");
      }
      if (redirects >= redirectLimit) {
        throw safeHttpError("outbound_http_redirect_limit");
      }

      const location = readLocation(response.headers);
      if (!location) {
        throw safeHttpError("outbound_http_redirect_invalid");
      }

      let nextUrl: URL;
      try {
        nextUrl = validateTarget(new URL(location, url), input.policy);
      } catch (error) {
        throw normalizeSafeHttpError(error);
      }
      if (url.protocol === "https:" && nextUrl.protocol !== "https:") {
        throw safeHttpError("outbound_http_redirect_forbidden");
      }
      if (url.origin !== nextUrl.origin) {
        headers = {};
      }
      url = nextUrl;
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw safeHttpError("outbound_http_timeout");
    }
    throw normalizeSafeHttpError(error);
  } finally {
    clearTimeout(deadline);
  }
}

function validateOptions(input: SafeHttpRequestInput): void {
  if (input.method !== "GET" && input.method !== "HEAD" && input.method !== "POST") {
    throw safeHttpError("outbound_http_method_forbidden");
  }
  if ((input.method === "GET" || input.method === "HEAD") && input.body !== undefined) {
    throw safeHttpError("outbound_http_body_forbidden");
  }
  if (!isPositiveInteger(input.timeoutMs)) {
    throw safeHttpError("outbound_http_options_invalid");
  }
  if (input.maxResponseBytes !== undefined && !isPositiveInteger(input.maxResponseBytes)) {
    throw safeHttpError("outbound_http_options_invalid");
  }
  if (
    input.redirectLimit !== undefined &&
    (!Number.isInteger(input.redirectLimit) || input.redirectLimit < 0 || input.redirectLimit > MAX_REDIRECTS)
  ) {
    throw safeHttpError("outbound_http_options_invalid");
  }
  if ((input.redirectLimit ?? 0) > 0 && input.method === "POST") {
    throw safeHttpError("outbound_http_redirect_forbidden");
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validateTarget(rawUrl: string | URL, policy: OutboundPolicy): URL {
  try {
    return policy.validateOutboundUrl(rawUrl.toString());
  } catch {
    throw safeHttpError("outbound_http_target_forbidden");
  }
}

function requestOnce(input: {
  url: URL;
  method: SafeHttpMethod;
  headers: Record<string, string>;
  body?: string | Uint8Array;
  maxResponseBytes: number;
  signal: AbortSignal;
  lookup: LookupFunction;
  startedAt: number;
}): Promise<SafeHttpResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseStream: import("node:http").IncomingMessage | undefined;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      responseStream?.destroy();
      reject(normalizeSafeHttpError(error));
    };

    const options: RequestOptions = {
      method: input.method,
      headers: input.headers,
      lookup: input.lookup,
      signal: input.signal,
      agent: false
    };
    const request = (input.url.protocol === "https:" ? httpsRequest : httpRequest)(
      input.url,
      options,
      (response) => {
        responseStream = response;
        const chunks: Buffer[] = [];
        let bytes = 0;

        response.on("data", (chunk: Buffer | string) => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > input.maxResponseBytes) {
            const error = safeHttpError("outbound_http_response_too_large");
            fail(error);
            request.destroy();
            return;
          }
          chunks.push(buffer);
        });
        response.once("aborted", () => fail(safeHttpError("outbound_http_request_failed")));
        response.once("error", fail);
        response.once("end", () => {
          if (settled) return;
          settled = true;
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            latencyMs: Date.now() - input.startedAt
          });
        });
      }
    );

    request.once("error", fail);
    if (input.signal.aborted) {
      request.destroy(safeHttpError("outbound_http_timeout"));
      fail(safeHttpError("outbound_http_timeout"));
      return;
    }
    if (input.body === undefined) {
      request.end();
    } else {
      request.end(input.body);
    }
  });
}

function readLocation(headers: IncomingHttpHeaders): string | undefined {
  const location = headers.location;
  return Array.isArray(location) ? location[0] : location;
}

function safeHttpError(code: string): Error {
  return new Error(code);
}

function normalizeSafeHttpError(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith("outbound_http_")) {
    return error;
  }
  const code = errorCode(error);
  if (code === "EACCES") return safeHttpError("outbound_http_target_forbidden");
  if (code === "EAI_FAIL" || code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") {
    return safeHttpError("outbound_http_lookup_failed");
  }
  if (code === "ABORT_ERR") return safeHttpError("outbound_http_timeout");
  return safeHttpError("outbound_http_request_failed");
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

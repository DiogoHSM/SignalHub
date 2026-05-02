import type { QueuedSignal } from "./types.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRY_DELAY_MS = 30_000;

export type StatusClassification = "success" | "retryable" | "permanent";

export type SendSignalInput = {
  endpoint: string;
  apiKey: string;
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  signal: QueuedSignal;
};

export type SendSignalResult =
  | { ok: true; status: number }
  | { ok: false; retryable: boolean; status?: number; error?: unknown };

export function classifyStatus(status: number): StatusClassification {
  if (status >= 200 && status < 300) {
    return "success";
  }

  if (status === 408 || status === 429 || status >= 500) {
    return "retryable";
  }

  return "permanent";
}

export function createRetryDelay(attempt: number, baseDelayMs: number): number {
  const normalizedAttempt = normalizeNonNegativeInteger(attempt);
  const normalizedBaseDelayMs = normalizeNonNegativeNumber(baseDelayMs);

  return Math.min(MAX_RETRY_DELAY_MS, normalizedBaseDelayMs * 2 ** normalizedAttempt);
}

export async function sendSignal(input: SendSignalInput): Promise<SendSignalResult> {
  const url = `${input.endpoint.replace(/\/+$/, "")}${input.signal.endpointPath}`;
  const maxRetries = normalizeNonNegativeInteger(input.maxRetries);
  const requestTimeoutMs = normalizePositiveTimeout(input.requestTimeoutMs);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await input.fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(input.signal.payload),
        signal: controller.signal
      });

      const classification = classifyStatus(response.status);

      if (classification === "success") {
        return { ok: true, status: response.status };
      }

      if (classification === "permanent") {
        return { ok: false, retryable: false, status: response.status };
      }

      if (attempt === maxRetries) {
        return { ok: false, retryable: true, status: response.status };
      }
    } catch (error) {
      if (attempt === maxRetries) {
        return { ok: false, retryable: true, error };
      }
    } finally {
      clearTimeout(timeout);
    }

    await sleep(createRetryDelay(attempt, input.retryBaseDelayMs));
  }

  return { ok: false, retryable: true };
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
}

function normalizeNonNegativeNumber(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return value;
}

function normalizePositiveTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return value;
}

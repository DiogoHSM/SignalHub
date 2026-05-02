import type { QueuedSignal } from "./types.js";

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
  return baseDelayMs * 2 ** attempt;
}

export async function sendSignal(input: SendSignalInput): Promise<SendSignalResult> {
  const url = `${input.endpoint.replace(/\/+$/, "")}${input.signal.endpointPath}`;

  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.requestTimeoutMs);

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

      if (attempt === input.maxRetries) {
        return { ok: false, retryable: true, status: response.status };
      }
    } catch (error) {
      if (attempt === input.maxRetries) {
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

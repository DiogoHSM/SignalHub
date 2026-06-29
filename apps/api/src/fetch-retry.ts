type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type FetchWithTimeoutAndRetryOptions = RequestInit & {
  attempts?: number;
  fetchFn?: FetchLike;
  retryDelayMs?: number;
  timeoutMs?: number;
};

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function boundedAttempts(attempts: number | undefined): number {
  if (typeof attempts !== "number" || !Number.isFinite(attempts)) return 2;
  return Math.max(1, Math.min(Math.trunc(attempts), 5));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithTimeoutAndRetry(
  input: string | URL | Request,
  options: FetchWithTimeoutAndRetryOptions = {}
): Promise<Response> {
  const {
    attempts,
    fetchFn = fetch,
    retryDelayMs = 100,
    timeoutMs = 5000,
    signal: _signal,
    ...init
  } = options;
  const maxAttempts = boundedAttempts(attempts);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const timer =
      controller && timeoutMs > 0
        ? setTimeout(() => {
            controller.abort();
          }, timeoutMs)
        : undefined;

    try {
      const response = await fetchFn(input, {
        ...init,
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        throw error;
      }
    } finally {
      if (timer) clearTimeout(timer);
    }

    await sleep(retryDelayMs);
  }

  throw lastError instanceof Error ? lastError : new Error("fetch_failed");
}

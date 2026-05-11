import type { BreadcrumbInput, SignalHubClient, SignalMetadata } from "./types.js";

export type BrowserBreadcrumbOptions = {
  navigation?: boolean;
  clicks?: boolean;
  console?: boolean;
  network?: boolean;
  /**
   * Successful fetch calls at or above this duration are captured as slow network breadcrumbs.
   * Defaults to 5000ms. Request/response bodies, headers, cookies, and raw query values are never captured.
   */
  slowNetworkThresholdMs?: number;
  maxBreadcrumbsPerMinute?: number;
};

export type StopBrowserBreadcrumbs = () => void;

type ClickSummary = {
  tag: string;
  role: string | null;
  label: string | null;
  text: string | null;
};

const DEFAULT_MAX_BREADCRUMBS_PER_MINUTE = 120;
const DEFAULT_SLOW_NETWORK_THRESHOLD_MS = 5_000;
const MAX_CONSOLE_MESSAGE_LENGTH = 2_000;
const SECRET_VALUE_PATTERN =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|auth|cookie|session)\s*[:=]\s*([^\s,;&]+)/gi;

export function sanitizeBreadcrumbUrl(value: string): string {
  try {
    const fallbackBase =
      typeof globalThis.location === "object" && globalThis.location !== null
        ? globalThis.location.href
        : "http://localhost";
    const url = new URL(value, fallbackBase);
    const params = new URLSearchParams();

    url.searchParams.forEach((_paramValue, key) => {
      params.append(key, "[REDACTED]");
    });

    const query = params.toString();
    return `${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return "[invalid-url]";
  }
}

export function summarizeClickedElement(element: Element): ClickSummary {
  const tag = element.tagName.toLowerCase();
  const role = compactText(element.getAttribute("role"));
  const label = compactText(
    element.getAttribute("aria-label") ?? element.getAttribute("title") ?? associatedLabelText(element)
  );
  const text = isValueBearingElement(element) ? null : compactText(element.textContent);

  return { tag, role, label, text };
}

export function createBrowserBreadcrumbs(
  client: Pick<SignalHubClient, "breadcrumb">,
  options: BrowserBreadcrumbOptions = {}
): StopBrowserBreadcrumbs {
  if (!hasBrowserGlobals()) {
    return () => undefined;
  }

  const resolvedOptions = {
    navigation: options.navigation ?? true,
    clicks: options.clicks ?? false,
    console: options.console ?? false,
    network: options.network ?? false
  };
  const disposers: Array<() => void> = [];
  const maxPerMinute = resolveMaxPerMinute(options.maxBreadcrumbsPerMinute);
  const slowNetworkThresholdMs = resolveSlowNetworkThresholdMs(options.slowNetworkThresholdMs);
  let windowStartedAt = Date.now();
  let emitted = 0;
  let stopped = false;

  const emit = (input: BreadcrumbInput): void => {
    if (stopped) {
      return;
    }

    const now = Date.now();
    if (now - windowStartedAt >= 60_000) {
      windowStartedAt = now;
      emitted = 0;
    }

    if (emitted >= maxPerMinute) {
      return;
    }

    emitted += 1;
    client.breadcrumb(input);
  };

  if (resolvedOptions.clicks) {
    const onClick = (event: MouseEvent): void => {
      if (event.target instanceof Element) {
        emit({
          type: "click",
          category: "dom",
          message: "Clicked element",
          data: summarizeClickedElement(event.target) as SignalMetadata
        });
      }
    };

    document.addEventListener("click", onClick, true);
    disposers.push(() => document.removeEventListener("click", onClick, true));
  }

  if (resolvedOptions.navigation) {
    const emitNavigation = (from: string, to: string): void => {
      emit({
        type: "navigation",
        category: "browser",
        message: `Navigated to ${sanitizeBreadcrumbUrl(to)}`,
        data: {
          from: sanitizeBreadcrumbUrl(from),
          to: sanitizeBreadcrumbUrl(to)
        }
      });
    };
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function pushState(
      data: unknown,
      unused: string,
      url?: string | URL | null
    ): void {
      const from = location.href;
      originalPushState.apply(history, [data, unused, url]);
      emitNavigation(from, location.href);
    };

    history.replaceState = function replaceState(
      data: unknown,
      unused: string,
      url?: string | URL | null
    ): void {
      const from = location.href;
      originalReplaceState.apply(history, [data, unused, url]);
      emitNavigation(from, location.href);
    };

    const onPopState = (): void => {
      emit({
        type: "navigation",
        category: "browser",
        message: `Navigated to ${sanitizeBreadcrumbUrl(location.href)}`,
        data: { to: sanitizeBreadcrumbUrl(location.href) }
      });
    };

    window.addEventListener("popstate", onPopState);
    disposers.push(() => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener("popstate", onPopState);
    });
  }

  if (resolvedOptions.network && typeof globalThis.fetch === "function") {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const method = getFetchMethod(input, init);
      const url = getFetchUrl(input);
      const startedAt = Date.now();

      try {
        const response = await originalFetch(input, init);
        const durationMs = elapsedMs(startedAt);

        if (!response.ok) {
          emit({
            type: "network",
            category: "fetch",
            level: "error",
            message: `Fetch ${method} ${url} failed with ${response.status}`,
            data: {
              method,
              url,
              status: response.status,
              durationMs,
              failureClass: "http_error",
              reason: `HTTP ${response.status}`
            }
          });
        } else if (durationMs >= slowNetworkThresholdMs) {
          emit({
            type: "network",
            category: "fetch",
            level: "warning",
            message: `Slow fetch ${method} ${url}`,
            data: {
              method,
              url,
              status: response.status,
              durationMs,
              failureClass: "slow",
              reason: `>=${slowNetworkThresholdMs}ms`
            }
          });
        }

        return response;
      } catch (error) {
        emit({
          type: "network",
          category: "fetch",
          level: "error",
          message: `Fetch ${method} ${url} failed`,
          data: {
            method,
            url,
            durationMs: elapsedMs(startedAt),
            failureClass: "fetch_error",
            reason: getFailureReason(error)
          }
        });
        throw error;
      }
    };

    disposers.push(() => {
      globalThis.fetch = originalFetch;
    });
  }

  if (resolvedOptions.console) {
    const originalWarn = console.warn;
    const originalError = console.error;

    console.warn = (...args: unknown[]): void => {
      emit({
        type: "console",
        category: "browser",
        level: "warning",
        message: sanitizeConsoleMessage(args)
      });
      originalWarn.apply(console, args);
    };

    console.error = (...args: unknown[]): void => {
      emit({
        type: "console",
        category: "browser",
        level: "error",
        message: sanitizeConsoleMessage(args)
      });
      originalError.apply(console, args);
    };

    disposers.push(() => {
      console.warn = originalWarn;
      console.error = originalError;
    });
  }

  return () => {
    if (stopped) {
      return;
    }

    stopped = true;
    for (const dispose of disposers.splice(0).reverse()) {
      dispose();
    }
  };
}

function hasBrowserGlobals(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    typeof history !== "undefined" &&
    typeof location !== "undefined"
  );
}

function compactText(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 120) : null;
}

function associatedLabelText(element: Element): string | null {
  if (typeof HTMLLabelElement === "undefined" || !(element instanceof HTMLElement)) {
    return null;
  }

  if (element.id) {
    const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);

    if (label instanceof HTMLLabelElement) {
      return label.textContent;
    }
  }

  const closestLabel = element.closest("label");
  return closestLabel instanceof HTMLLabelElement ? closestLabel.textContent : null;
}

function isValueBearingElement(element: Element): boolean {
  return (
    (typeof HTMLInputElement !== "undefined" && element instanceof HTMLInputElement) ||
    (typeof HTMLTextAreaElement !== "undefined" && element instanceof HTMLTextAreaElement) ||
    (typeof HTMLSelectElement !== "undefined" && element instanceof HTMLSelectElement)
  );
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function sanitizeConsoleMessage(args: unknown[]): string {
  return args
    .map((arg) => String(arg))
    .join(" ")
    .replace(SECRET_VALUE_PATTERN, "$1=[REDACTED]")
    .slice(0, MAX_CONSOLE_MESSAGE_LENGTH);
}

function getFetchMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }

  return "GET";
}

function getFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return sanitizeBreadcrumbUrl(input);
  }

  if (input instanceof URL) {
    return sanitizeBreadcrumbUrl(input.href);
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return sanitizeBreadcrumbUrl(input.url);
  }

  return "[unknown-url]";
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(Date.now() - startedAt));
}

function getFailureReason(error: unknown): string {
  if (error instanceof Error) {
    return compactText(error.name) ?? "Error";
  }

  return compactText(typeof error) ?? "unknown";
}

function resolveMaxPerMinute(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_BREADCRUMBS_PER_MINUTE;
  }

  return Math.max(0, Math.trunc(value));
}

function resolveSlowNetworkThresholdMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_SLOW_NETWORK_THRESHOLD_MS;
  }

  return Math.max(0, Math.trunc(value));
}

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

type ElementLike = {
  tagName: string;
  getAttribute: (name: string) => string | null;
  textContent?: string | null;
  id?: string;
  closest?: (selector: string) => unknown;
};

type DocumentLike = {
  addEventListener: (type: string, listener: (event: unknown) => void, options?: unknown) => void;
  removeEventListener: (type: string, listener: (event: unknown) => void, options?: unknown) => void;
  querySelector?: (selector: string) => unknown;
};

type WindowLike = {
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: (type: string, listener: (event: unknown) => void) => void;
};

type HistoryLike = {
  pushState: (data: unknown, unused: string, url?: string | URL | null) => void;
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
};

type LocationLike = { href: string };
type ConsoleLevel = "warning" | "error";
type ConsoleListener = (level: ConsoleLevel, args: unknown[]) => void;
type NavigationListener = (from: string, to: string) => void;
type FetchFn = typeof globalThis.fetch;
type FetchInput = Parameters<FetchFn>[0];
type FetchInit = Parameters<FetchFn>[1];
type FetchResponse = Awaited<ReturnType<FetchFn>>;
type NetworkSuccess = {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  ok: boolean;
};
type NetworkFailure = {
  method: string;
  url: string;
  durationMs: number;
  error: unknown;
};
type NetworkListener = (result: NetworkSuccess | NetworkFailure) => void;

type ConsolePatch = {
  originalWarn: typeof console.warn;
  originalError: typeof console.error;
  warnWrapper: typeof console.warn;
  errorWrapper: typeof console.error;
  listeners: Set<ConsoleListener>;
};

type FetchPatch = {
  originalFetch: FetchFn;
  wrapper: FetchFn;
  listeners: Set<NetworkListener>;
};

type HistoryPatch = {
  history: HistoryLike;
  window: WindowLike;
  location: LocationLike;
  originalPushState: HistoryLike["pushState"];
  originalReplaceState: HistoryLike["replaceState"];
  pushStateWrapper: HistoryLike["pushState"];
  replaceStateWrapper: HistoryLike["replaceState"];
  popStateWrapper: (event: unknown) => void;
  listeners: Set<NavigationListener>;
};

const DEFAULT_MAX_BREADCRUMBS_PER_MINUTE = 120;
const DEFAULT_SLOW_NETWORK_THRESHOLD_MS = 5_000;
const MAX_CLICK_TEXT_LENGTH = 120;
const MAX_CONSOLE_MESSAGE_LENGTH = 2_000;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const AUTH_BEARER_PATTERN = /\b(authorization|auth)\s*:\s*Bearer\s+[^\s,;&]+/gi;
const BEARER_PATTERN = /\bBearer\s+[^\s,;&]+/gi;
const SECRET_KEY_VALUE_PATTERN =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|auth|cookie|session)\b\s*[:=](?!\s*Bearer\b)\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;

let consolePatch: ConsolePatch | undefined;
let fetchPatch: FetchPatch | undefined;
let historyPatch: HistoryPatch | undefined;

export function sanitizeBreadcrumbUrl(value: string): string {
  try {
    const fallbackBase = getLocation()?.href ?? "http://localhost";
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

export function summarizeClickedElement(element: unknown): ClickSummary {
  if (!isElementLike(element)) {
    return { tag: "unknown", role: null, label: null, text: null };
  }

  const tag = element.tagName.toLowerCase();
  const role = compactText(element.getAttribute("role"));
  const label = compactText(
    element.getAttribute("aria-label") ?? element.getAttribute("title") ?? associatedLabelText(element)
  );
  const text = isValueBearingElement(element) ? null : compactText(element.textContent ?? null);

  return { tag, role, label, text };
}

export function createBrowserBreadcrumbs(
  client: Pick<SignalHubClient, "breadcrumb">,
  options: BrowserBreadcrumbOptions = {}
): StopBrowserBreadcrumbs {
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
    const documentRef = getDocument();

    if (documentRef) {
      const onClick = (event: unknown): void => {
        const target = getEventTarget(event);

        if (isElementLike(target)) {
          emit({
            type: "click",
            category: "dom",
            message: "Clicked element",
            data: summarizeClickedElement(target) as SignalMetadata
          });
        }
      };

      documentRef.addEventListener("click", onClick, true);
      disposers.push(() => documentRef.removeEventListener("click", onClick, true));
    }
  }

  if (resolvedOptions.navigation) {
    const listener: NavigationListener = (from, to) => {
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
    const disposeNavigation = addNavigationListener(listener);

    if (disposeNavigation) {
      disposers.push(disposeNavigation);
    }
  }

  if (resolvedOptions.network && typeof globalThis.fetch === "function") {
    const listener: NetworkListener = (result) => {
      if ("error" in result) {
        emit({
          type: "network",
          category: "fetch",
          level: "error",
          message: `Fetch ${result.method} ${result.url} failed`,
          data: {
            method: result.method,
            url: result.url,
            durationMs: result.durationMs,
            failureClass: "fetch_error",
            reason: getFailureReason(result.error)
          }
        });
        return;
      }

      if (!result.ok) {
        emit({
          type: "network",
          category: "fetch",
          level: "error",
          message: `Fetch ${result.method} ${result.url} failed with ${result.status}`,
          data: {
            method: result.method,
            url: result.url,
            status: result.status,
            durationMs: result.durationMs,
            failureClass: "http_error",
            reason: `HTTP ${result.status}`
          }
        });
        return;
      }

      if (result.durationMs >= slowNetworkThresholdMs) {
        emit({
          type: "network",
          category: "fetch",
          level: "warning",
          message: `Slow fetch ${result.method} ${result.url}`,
          data: {
            method: result.method,
            url: result.url,
            status: result.status,
            durationMs: result.durationMs,
            failureClass: "slow",
            reason: `>=${slowNetworkThresholdMs}ms`
          }
        });
      }
    };

    disposers.push(addFetchListener(listener));
  }

  if (resolvedOptions.console) {
    const listener: ConsoleListener = (level, args) => {
      emit({
        type: "console",
        category: "browser",
        level,
        message: sanitizeBreadcrumbText(args.map((arg) => String(arg)).join(" "), MAX_CONSOLE_MESSAGE_LENGTH)
      });
    };

    disposers.push(addConsoleListener(listener));
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

function addConsoleListener(listener: ConsoleListener): () => void {
  if (!consolePatch) {
    const originalWarn = console.warn;
    const originalError = console.error;
    const listeners = new Set<ConsoleListener>();
    const warnWrapper = (...args: unknown[]): void => {
      notifyConsoleListeners("warning", args);
      originalWarn.apply(console, args);
    };
    const errorWrapper = (...args: unknown[]): void => {
      notifyConsoleListeners("error", args);
      originalError.apply(console, args);
    };

    consolePatch = { originalWarn, originalError, warnWrapper, errorWrapper, listeners };
    console.warn = warnWrapper;
    console.error = errorWrapper;
  }

  consolePatch.listeners.add(listener);

  return () => {
    const patch = consolePatch;

    if (!patch) {
      return;
    }

    patch.listeners.delete(listener);

    if (patch.listeners.size > 0) {
      return;
    }

    if (console.warn === patch.warnWrapper) {
      console.warn = patch.originalWarn;
    }
    if (console.error === patch.errorWrapper) {
      console.error = patch.originalError;
    }
    if (consolePatch === patch) {
      consolePatch = undefined;
    }
  };
}

function notifyConsoleListeners(level: ConsoleLevel, args: unknown[]): void {
  const listeners = [...(consolePatch?.listeners ?? [])];

  for (const listener of listeners) {
    listener(level, args);
  }
}

function addFetchListener(listener: NetworkListener): () => void {
  if (!fetchPatch) {
    const originalFetch = globalThis.fetch;
    const listeners = new Set<NetworkListener>();
    const wrapper = (async (...args: Parameters<FetchFn>): Promise<FetchResponse> => {
      const method = getFetchMethod(args[0], args[1]);
      const url = getFetchUrl(args[0]);
      const startedAt = Date.now();

      try {
        const response = await originalFetch.apply(globalThis, args);
        const result: NetworkSuccess = {
          method,
          url,
          status: response.status,
          durationMs: elapsedMs(startedAt),
          ok: response.ok
        };
        notifyNetworkListeners(result);
        return response;
      } catch (error) {
        notifyNetworkListeners({ method, url, durationMs: elapsedMs(startedAt), error });
        throw error;
      }
    }) as FetchFn;

    fetchPatch = { originalFetch, wrapper, listeners };
    globalThis.fetch = wrapper;
  }

  fetchPatch.listeners.add(listener);

  return () => {
    const patch = fetchPatch;

    if (!patch) {
      return;
    }

    patch.listeners.delete(listener);

    if (patch.listeners.size > 0) {
      return;
    }

    if (globalThis.fetch === patch.wrapper) {
      globalThis.fetch = patch.originalFetch;
    }
    if (fetchPatch === patch) {
      fetchPatch = undefined;
    }
  };
}

function notifyNetworkListeners(result: NetworkSuccess | NetworkFailure): void {
  const listeners = [...(fetchPatch?.listeners ?? [])];

  for (const listener of listeners) {
    listener(result);
  }
}

function addNavigationListener(listener: NavigationListener): (() => void) | undefined {
  if (!historyPatch) {
    const historyRef = getHistory();
    const windowRef = getWindow();
    const locationRef = getLocation();

    if (!historyRef || !windowRef || !locationRef) {
      return undefined;
    }

    const originalPushState = historyRef.pushState;
    const originalReplaceState = historyRef.replaceState;
    const listeners = new Set<NavigationListener>();
    const pushStateWrapper = function pushState(
      this: unknown,
      data: unknown,
      unused: string,
      url?: string | URL | null
    ): void {
      const from = locationRef.href;
      originalPushState.apply(this, [data, unused, url]);
      notifyNavigationListeners(from, locationRef.href);
    };
    const replaceStateWrapper = function replaceState(
      this: unknown,
      data: unknown,
      unused: string,
      url?: string | URL | null
    ): void {
      const from = locationRef.href;
      originalReplaceState.apply(this, [data, unused, url]);
      notifyNavigationListeners(from, locationRef.href);
    };
    const popStateWrapper = (): void => {
      notifyNavigationListeners(locationRef.href, locationRef.href);
    };

    historyPatch = {
      history: historyRef,
      window: windowRef,
      location: locationRef,
      originalPushState,
      originalReplaceState,
      pushStateWrapper,
      replaceStateWrapper,
      popStateWrapper,
      listeners
    };
    historyRef.pushState = pushStateWrapper;
    historyRef.replaceState = replaceStateWrapper;
    windowRef.addEventListener("popstate", popStateWrapper);
  }

  historyPatch.listeners.add(listener);

  return () => {
    const patch = historyPatch;

    if (!patch) {
      return;
    }

    patch.listeners.delete(listener);

    if (patch.listeners.size > 0) {
      return;
    }

    if (patch.history.pushState === patch.pushStateWrapper) {
      patch.history.pushState = patch.originalPushState;
    }
    if (patch.history.replaceState === patch.replaceStateWrapper) {
      patch.history.replaceState = patch.originalReplaceState;
    }
    patch.window.removeEventListener("popstate", patch.popStateWrapper);
    if (historyPatch === patch) {
      historyPatch = undefined;
    }
  };
}

function notifyNavigationListeners(from: string, to: string): void {
  const listeners = [...(historyPatch?.listeners ?? [])];

  for (const listener of listeners) {
    listener(from, to);
  }
}

function getDocument(): DocumentLike | undefined {
  const value = (globalThis as { document?: unknown }).document;
  return isDocumentLike(value) ? value : undefined;
}

function getWindow(): WindowLike | undefined {
  const value = (globalThis as { window?: unknown }).window;
  return isWindowLike(value) ? value : undefined;
}

function getHistory(): HistoryLike | undefined {
  const value = (globalThis as { history?: unknown }).history;
  return isHistoryLike(value) ? value : undefined;
}

function getLocation(): LocationLike | undefined {
  const value = (globalThis as { location?: unknown }).location;
  return isLocationLike(value) ? value : undefined;
}

function getEventTarget(event: unknown): unknown {
  return typeof event === "object" && event !== null && "target" in event
    ? (event as { target?: unknown }).target
    : undefined;
}

function compactText(value: string | null | undefined): string | null {
  const text = sanitizeBreadcrumbText(value ?? "", MAX_CLICK_TEXT_LENGTH);
  return text || null;
}

function sanitizeBreadcrumbText(value: string, maxLength: number): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(AUTH_BEARER_PATTERN, "$1: Bearer [REDACTED]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(SECRET_KEY_VALUE_PATTERN, "$1=[REDACTED]")
    .slice(0, maxLength);
}

function associatedLabelText(element: ElementLike): string | null {
  const documentRef = getDocument();

  if (element.id && documentRef?.querySelector) {
    const label = documentRef.querySelector(`label[for="${cssEscape(element.id)}"]`);
    const labelText = getTextContent(label);

    if (labelText !== null) {
      return labelText;
    }
  }

  if (typeof element.closest === "function") {
    return getTextContent(element.closest("label"));
  }

  return null;
}

function isValueBearingElement(element: ElementLike): boolean {
  return ["input", "textarea", "select"].includes(element.tagName.toLowerCase());
}

function cssEscape(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;

  if (typeof css?.escape === "function") {
    return css.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function getTextContent(value: unknown): string | null {
  return typeof value === "object" && value !== null && typeof (value as { textContent?: unknown }).textContent === "string"
    ? (value as { textContent: string }).textContent
    : null;
}

function getFetchMethod(input: FetchInput, init: FetchInit): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }

  if (isRequestLike(input)) {
    return input.method.toUpperCase();
  }

  return "GET";
}

function getFetchUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return sanitizeBreadcrumbUrl(input);
  }

  if (input instanceof URL) {
    return sanitizeBreadcrumbUrl(input.href);
  }

  if (isRequestLike(input)) {
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

function isDocumentLike(value: unknown): value is DocumentLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as DocumentLike).addEventListener === "function" &&
    typeof (value as DocumentLike).removeEventListener === "function"
  );
}

function isWindowLike(value: unknown): value is WindowLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as WindowLike).addEventListener === "function" &&
    typeof (value as WindowLike).removeEventListener === "function"
  );
}

function isHistoryLike(value: unknown): value is HistoryLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as HistoryLike).pushState === "function" &&
    typeof (value as HistoryLike).replaceState === "function"
  );
}

function isLocationLike(value: unknown): value is LocationLike {
  return typeof value === "object" && value !== null && typeof (value as LocationLike).href === "string";
}

function isElementLike(value: unknown): value is ElementLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ElementLike).tagName === "string" &&
    typeof (value as ElementLike).getAttribute === "function"
  );
}

function isRequestLike(value: unknown): value is { method: string; url: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { method?: unknown }).method === "string" &&
    typeof (value as { url?: unknown }).url === "string"
  );
}

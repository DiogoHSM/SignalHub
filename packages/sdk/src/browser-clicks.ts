import type { ClickInput, SignalContext, SignalMonitorClient } from "./types.js";
import { sanitizeBreadcrumbUrl } from "./browser-breadcrumbs.js";

export type BrowserClickCaptureOptions = {
  enabled?: boolean;
  route?: () => string;
  selectorAttribute?: string;
  maskSelectors?: string[];
  ignoreSelectors?: string[];
  respectDoNotTrack?: boolean;
  maxClicksPerMinute?: number;
  flush?: boolean;
  context?: SignalContext;
};

export type StopBrowserClickCapture = () => void;

type ElementLike = Element & {
  tagName: string;
  getAttribute: (name: string) => string | null;
  closest: (selector: string) => Element | null;
};

const DEFAULT_MAX_CLICKS_PER_MINUTE = 60;
const VALUE_BEARING_SELECTOR = "input, textarea, select, option, [contenteditable='true'], [contenteditable='']";
const DEFAULT_MASK_SELECTORS = ["[data-sigmon-mask]"];
const DEFAULT_IGNORE_SELECTORS = ["[data-sigmon-ignore]"];

export function installBrowserClickCapture(
  client: Pick<SignalMonitorClient, "click" | "flush">,
  options: BrowserClickCaptureOptions = {}
): StopBrowserClickCapture {
  if (!options.enabled) {
    return () => undefined;
  }
  if (options.respectDoNotTrack !== false && doNotTrackEnabled()) {
    return () => undefined;
  }

  const documentRef = globalThis.document;
  const windowRef = globalThis.window;
  if (!documentRef || !windowRef) {
    return () => undefined;
  }

  const selectorAttribute = normalizeAttribute(options.selectorAttribute ?? "data-sigmon-id");
  const maskSelectors = [...DEFAULT_MASK_SELECTORS, ...(options.maskSelectors ?? [])];
  const ignoreSelectors = [...DEFAULT_IGNORE_SELECTORS, ...(options.ignoreSelectors ?? [])];
  const maxPerMinute = Math.max(1, Math.trunc(options.maxClicksPerMinute ?? DEFAULT_MAX_CLICKS_PER_MINUTE));
  let windowStartedAt = Date.now();
  let emitted = 0;
  let stopped = false;

  const onClick = (event: MouseEvent): void => {
    if (stopped || !isElementLike(event.target)) {
      return;
    }
    if (!shouldCapture(event.target, ignoreSelectors, maskSelectors)) {
      return;
    }
    if (!canEmit(maxPerMinute)) {
      return;
    }

    const selector = safeSelector(event.target, selectorAttribute);
    if (!selector) {
      return;
    }

    const viewportWidth = Math.max(1, Math.round(windowRef.innerWidth || documentRef.documentElement.clientWidth || 1));
    const viewportHeight = Math.max(1, Math.round(windowRef.innerHeight || documentRef.documentElement.clientHeight || 1));
    const input: ClickInput = {
      route: sanitizeBreadcrumbUrl(options.route?.() ?? windowRef.location.href),
      selector,
      elementTag: event.target.tagName.toLowerCase(),
      elementRole: event.target.getAttribute("role") ?? undefined,
      x: clamp01(event.clientX / viewportWidth),
      y: clamp01(event.clientY / viewportHeight),
      viewportWidth,
      viewportHeight,
      scrollX: Math.max(0, Math.round(windowRef.scrollX || 0)),
      scrollY: Math.max(0, Math.round(windowRef.scrollY || 0)),
      masked: true
    };

    client.click(input, options.context);
    if (options.flush) {
      void client.flush().catch(() => undefined);
    }
  };

  function canEmit(max: number): boolean {
    const now = Date.now();
    if (now - windowStartedAt >= 60_000) {
      windowStartedAt = now;
      emitted = 0;
    }
    if (emitted >= max) {
      return false;
    }
    emitted += 1;
    return true;
  }

  documentRef.addEventListener("click", onClick, true);

  return () => {
    stopped = true;
    documentRef.removeEventListener("click", onClick, true);
  };
}

function shouldCapture(element: ElementLike, ignoreSelectors: string[], maskSelectors: string[]): boolean {
  if (matchesAny(element, ignoreSelectors)) {
    return false;
  }
  if (element.closest(VALUE_BEARING_SELECTOR)) {
    return false;
  }
  if (matchesAny(element, maskSelectors)) {
    return false;
  }
  return true;
}

function matchesAny(element: ElementLike, selectors: string[]): boolean {
  return selectors.some((selector) => {
    try {
      return Boolean(selector && element.closest(selector));
    } catch {
      return false;
    }
  });
}

function safeSelector(element: ElementLike, attribute: string): string | undefined {
  const explicit = element.getAttribute(attribute)?.trim();
  if (explicit) {
    return `[${attribute}="${escapeAttributeValue(explicit)}"]`;
  }
  const role = element.getAttribute("role")?.trim();
  const tag = element.tagName.toLowerCase();
  if (role) {
    return `${tag}[role="${escapeAttributeValue(role)}"]`;
  }
  return tag;
}

function normalizeAttribute(value: string): string {
  const normalized = value.trim();
  return /^[a-zA-Z_:-][a-zA-Z0-9_:.:-]*$/.test(normalized) ? normalized : "data-sigmon-id";
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function isElementLike(value: unknown): value is ElementLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      "tagName" in value &&
      typeof (value as ElementLike).getAttribute === "function" &&
      typeof (value as ElementLike).closest === "function"
  );
}

function doNotTrackEnabled(): boolean {
  const navigatorDnt = globalThis.navigator?.doNotTrack;
  const windowDnt = (globalThis.window as (Window & { doNotTrack?: string }) | undefined)?.doNotTrack;
  return navigatorDnt === "1" || navigatorDnt === "yes" || windowDnt === "1";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}

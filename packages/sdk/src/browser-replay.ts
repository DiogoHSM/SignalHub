import { sanitizeBreadcrumbUrl } from "./browser-breadcrumbs.js";
import type { SignalContext, SignalMonitorClient, SessionReplayEventInput } from "./types.js";

export type BrowserReplayRecorderOptions = {
  enabled?: boolean;
  replayId?: string;
  maxEvents?: number;
  route?: () => string;
  context?: SignalContext;
  document?: Document;
  window?: Window;
};

export type BrowserReplayRecorder = {
  replayId: string;
  record: (event: SessionReplayEventInput) => void;
  flush: (input?: { errorId?: string }) => void;
  stop: () => void;
};

const DEFAULT_MAX_EVENTS = 200;
const MAX_REPLAY_EVENTS = 300;

export function createBrowserReplayRecorder(
  client: Pick<SignalMonitorClient, "replay">,
  options: BrowserReplayRecorderOptions = {}
): BrowserReplayRecorder {
  const win = options.window ?? globalThis.window;
  const documentRef = options.document ?? win?.document;
  const enabled = options.enabled ?? false;
  const replayId = options.replayId ?? `rpl_${randomId()}`;
  const maxEvents = Math.max(1, Math.min(options.maxEvents ?? DEFAULT_MAX_EVENTS, MAX_REPLAY_EVENTS));
  const startedAt = new Date();
  const events: SessionReplayEventInput[] = [];
  const disposers: Array<() => void> = [];
  const route = () => sanitizeBreadcrumbUrl(options.route?.() ?? win?.location?.href ?? "unknown");

  const record = (event: SessionReplayEventInput): void => {
    if (!enabled) return;
    events.push({
      ...event,
      offsetMs: Math.max(0, Math.round(event.offsetMs)),
      message: event.message === undefined ? undefined : "[REDACTED]",
      data: event.data ?? {}
    });
    if (events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
    }
  };

  if (enabled && documentRef) {
    record({ offsetMs: 0, type: "navigation", route: route(), data: {} });

    const onClick = (event: Event): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || shouldIgnore(target)) return;
      const mouseEvent = event instanceof MouseEvent ? event : null;
      record({
        offsetMs: Date.now() - startedAt.getTime(),
        type: "click",
        route: route(),
        selector: safeSelector(target),
        x: mouseEvent && win ? clamp(mouseEvent.clientX / Math.max(1, win.innerWidth)) : undefined,
        y: mouseEvent && win ? clamp(mouseEvent.clientY / Math.max(1, win.innerHeight)) : undefined,
        data: { masked: true }
      });
    };

    documentRef.addEventListener("click", onClick, true);
    disposers.push(() => documentRef.removeEventListener("click", onClick, true));
  }

  return {
    replayId,
    record,
    flush(input): void {
      if (!enabled || events.length === 0) return;
      const endedAt = new Date();
      client.replay(
        {
          replayId,
          startedAt,
          endedAt,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          route: route(),
          errorId: input?.errorId,
          masked: true,
          events: [...events]
        },
        options.context
      );
    },
    stop(): void {
      for (const dispose of disposers.splice(0)) {
        dispose();
      }
    }
  };
}

function safeSelector(element: Element): string {
  const sigmonId = element.getAttribute("data-sigmon-id");
  if (sigmonId) return `[data-sigmon-id="${cssEscape(sigmonId)}"]`;
  const role = element.getAttribute("role");
  if (role) return `${element.tagName.toLowerCase()}[role="${cssEscape(role)}"]`;
  return element.tagName.toLowerCase();
}

function shouldIgnore(element: Element): boolean {
  if (element.closest("[data-sigmon-ignore], [data-sigmon-mask]")) return true;
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.hasAttribute("contenteditable");
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, Number(value.toFixed(4))));
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID().replace(/-/g, "").slice(0, 24);
  }
  return Math.random().toString(36).slice(2, 18);
}

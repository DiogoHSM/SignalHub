import type {
  ErrorInput,
  SignalMetadata,
  SignalMonitorClient
} from "./types.js";

export type BrowserErrorCaptureOptions = {
  captureErrors?: boolean;
  captureUnhandledRejections?: boolean;
  flush?: boolean;
  context?: ErrorInput;
};

type ErrorEventLike = {
  error?: unknown;
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
};

type PromiseRejectionEventLike = {
  reason?: unknown;
};

export function installBrowserErrorCapture(
  client: SignalMonitorClient,
  options: BrowserErrorCaptureOptions = {}
): () => void {
  const captureErrors = options.captureErrors ?? true;
  const captureUnhandledRejections = options.captureUnhandledRejections ?? true;
  let stopped = false;

  const capture = (error: unknown, eventContext?: SignalMetadata): void => {
    client.captureError(error, mergeBrowserErrorInput(options.context, eventContext));

    if (options.flush === true) {
      void client.flush().catch(() => undefined);
    }
  };

  const onError = (event: ErrorEventLike): void => {
    capture(event.error ?? event.message ?? "Unknown browser error", {
      mechanism: "browser.error",
      handled: false,
      ...browserErrorEventContext(event)
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEventLike): void => {
    capture(event.reason ?? "Unhandled promise rejection", {
      mechanism: "browser.unhandledrejection",
      handled: false,
      type: "unhandledrejection"
    });
  };

  if (captureErrors) {
    globalThis.addEventListener?.("error", onError);
  }

  if (captureUnhandledRejections) {
    globalThis.addEventListener?.("unhandledrejection", onUnhandledRejection);
  }

  return () => {
    if (stopped) {
      return;
    }

    stopped = true;

    if (captureErrors) {
      globalThis.removeEventListener?.("error", onError);
    }

    if (captureUnhandledRejections) {
      globalThis.removeEventListener?.("unhandledrejection", onUnhandledRejection);
    }
  };
}

function mergeBrowserErrorInput(
  base: ErrorInput | undefined,
  context: SignalMetadata | undefined
): ErrorInput {
  return {
    ...(base ?? {}),
    source: base?.source ?? "browser",
    context: {
      ...(base?.metadata ?? {}),
      ...(base?.context ?? {}),
      ...(context ?? {})
    }
  };
}

function browserErrorEventContext(event: ErrorEventLike): SignalMetadata {
  const context: SignalMetadata = {};

  assignEventContext(context, "message", event.message);
  assignEventContext(context, "filename", event.filename);
  assignEventContext(context, "lineno", event.lineno);
  assignEventContext(context, "colno", event.colno);

  return context;
}

function assignEventContext(
  context: SignalMetadata,
  key: string,
  value: string | number | undefined
): void {
  if (value !== undefined) {
    context[key] = value;
  }
}

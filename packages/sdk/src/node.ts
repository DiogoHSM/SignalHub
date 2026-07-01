import type {
  ErrorInput,
  SignalMetadata,
  SignalMonitorClient
} from "./types.js";

export type {
  SignalContext,
  SignalMetadata,
  SignalMonitorClient,
  SignalMonitorClientOptions
} from "./index.js";

export { createSignalMonitorClient } from "./client.js";

type NodeProcessLike = {
  on: (event: "uncaughtException" | "unhandledRejection", listener: (...args: unknown[]) => void) => unknown;
  off?: (event: "uncaughtException" | "unhandledRejection", listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (event: "uncaughtException" | "unhandledRejection", listener: (...args: unknown[]) => void) => unknown;
};

export type NodeErrorCaptureOptions = {
  captureUncaughtExceptions?: boolean;
  captureUnhandledRejections?: boolean;
  flush?: boolean;
  context?: ErrorInput;
  process?: NodeProcessLike;
};

export function installNodeErrorCapture(
  client: SignalMonitorClient,
  options: NodeErrorCaptureOptions = {}
): () => void {
  const runtimeProcess = options.process ?? getRuntimeProcess();

  if (!runtimeProcess) {
    return () => undefined;
  }

  const captureUncaughtExceptions = options.captureUncaughtExceptions ?? true;
  const captureUnhandledRejections = options.captureUnhandledRejections ?? true;
  let stopped = false;

  const capture = (error: unknown, eventContext: SignalMetadata): void => {
    client.captureError(error, mergeNodeErrorInput(options.context, eventContext));

    if (options.flush === true) {
      void client.flush().catch(() => undefined);
    }
  };

  const onUncaughtException = (error: unknown): void => {
    capture(error, {
      mechanism: "node.uncaughtException",
      handled: false
    });
  };

  const onUnhandledRejection = (reason: unknown): void => {
    capture(reason ?? "Unhandled promise rejection", {
      mechanism: "node.unhandledRejection",
      handled: false
    });
  };

  if (captureUncaughtExceptions) {
    runtimeProcess.on("uncaughtException", onUncaughtException);
  }

  if (captureUnhandledRejections) {
    runtimeProcess.on("unhandledRejection", onUnhandledRejection);
  }

  return () => {
    if (stopped) {
      return;
    }

    stopped = true;

    if (captureUncaughtExceptions) {
      removeProcessListener(runtimeProcess, "uncaughtException", onUncaughtException);
    }

    if (captureUnhandledRejections) {
      removeProcessListener(runtimeProcess, "unhandledRejection", onUnhandledRejection);
    }
  };
}

function mergeNodeErrorInput(
  base: ErrorInput | undefined,
  context: SignalMetadata
): ErrorInput {
  return {
    ...(base ?? {}),
    severity: base?.severity ?? "fatal",
    source: base?.source ?? "node",
    context: {
      ...(base?.metadata ?? {}),
      ...(base?.context ?? {}),
      ...context
    }
  };
}

function getRuntimeProcess(): NodeProcessLike | undefined {
  const runtime = globalThis as typeof globalThis & { process?: NodeProcessLike };
  return runtime.process;
}

function removeProcessListener(
  runtimeProcess: NodeProcessLike,
  event: "uncaughtException" | "unhandledRejection",
  listener: (...args: unknown[]) => void
): void {
  if (runtimeProcess.off) {
    runtimeProcess.off(event, listener);
    return;
  }

  runtimeProcess.removeListener?.(event, listener);
}

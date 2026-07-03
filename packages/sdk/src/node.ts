import type {
  ErrorInput,
  FlushResult,
  RuntimeProfileFunction,
  RuntimeProfileInput,
  SignalContext,
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
export { createTraceContext, parseTraceparent, traceContextHeaders } from "./trace-context.js";
export type { TraceContext } from "./trace-context.js";

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

export type NodeCpuProfileOptions = {
  name: string;
  context?: SignalContext;
  service?: string;
  route?: string;
  maxDurationMs?: number;
  topFunctionsLimit?: number;
  flush?: boolean;
};

export type ActiveNodeCpuProfile = {
  stop: () => Promise<FlushResult | undefined>;
};

export type NodeMemoryProfileOptions = Omit<RuntimeProfileInput, "kind" | "runtime" | "startedAt"> & {
  context?: SignalContext;
  flush?: boolean;
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

export async function startNodeCpuProfile(
  client: SignalMonitorClient,
  options: NodeCpuProfileOptions
): Promise<ActiveNodeCpuProfile> {
  const inspector = await import("node:inspector");
  const session = new inspector.Session();
  const startedAt = new Date();
  const startUsage = readCpuUsage();
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  session.connect();
  await inspectorPost(session, "Profiler.enable");
  await inspectorPost(session, "Profiler.start");

  if (options.maxDurationMs !== undefined) {
    timeout = setTimeout(() => {
      void stop().catch(() => undefined);
    }, options.maxDurationMs);
  }

  const stop = async (): Promise<FlushResult | undefined> => {
    if (stopped) {
      return undefined;
    }
    stopped = true;
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }

    const endedAt = new Date();
    const stopResult = await inspectorPost<{ profile: InspectorCpuProfile }>(session, "Profiler.stop");
    await inspectorPost(session, "Profiler.disable").catch(() => undefined);
    session.disconnect();

    const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
    const endUsage = readCpuUsage();
    const cpuUserMs = endUsage && startUsage ? Math.max(0, Math.round((endUsage.user - startUsage.user) / 1000)) : undefined;
    const cpuSystemMs =
      endUsage && startUsage ? Math.max(0, Math.round((endUsage.system - startUsage.system) / 1000)) : undefined;
    const topFunctions = summarizeCpuProfile(stopResult.profile, options.topFunctionsLimit ?? 25);
    const sampleCount = topFunctions.reduce((total, frame) => total + (frame.sampleCount ?? 0), 0);

    client.profile(
      {
        name: options.name,
        kind: "cpu",
        runtime: "node",
        service: options.service,
        route: options.route,
        startedAt,
        endedAt,
        durationMs,
        sampleCount,
        cpuUserMs,
        cpuSystemMs,
        topFunctions,
        summary: runtimeSummary()
      },
      options.context
    );

    return options.flush === true ? client.flush() : undefined;
  };

  return { stop };
}

export async function captureNodeMemoryProfile(
  client: SignalMonitorClient,
  options: NodeMemoryProfileOptions
): Promise<FlushResult | undefined> {
  const startedAt = options.timestamp ?? new Date();
  const memoryUsage = readMemoryUsage();

  client.profile(
    {
      ...options,
      kind: "memory",
      runtime: "node",
      startedAt,
      rssBytes: memoryUsage?.rss,
      heapUsedBytes: memoryUsage?.heapUsed,
      heapTotalBytes: memoryUsage?.heapTotal,
      externalBytes: memoryUsage?.external,
      arrayBuffersBytes: memoryUsage?.arrayBuffers,
      summary: {
        ...(options.summary ?? {}),
        ...runtimeSummary()
      }
    },
    options.context
  );

  return options.flush === true ? client.flush() : undefined;
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

type InspectorSession = {
  post: (method: string, callback: (error: Error | null, result?: object) => void) => void;
};

type InspectorCpuProfile = {
  nodes?: Array<{
    id: number;
    callFrame?: {
      functionName?: string;
      url?: string;
      lineNumber?: number;
      columnNumber?: number;
    };
    hitCount?: number;
  }>;
  samples?: number[];
  timeDeltas?: number[];
};

function inspectorPost<T = unknown>(session: InspectorSession, method: string): Promise<T> {
  return new Promise((resolve, reject) => {
    session.post(method, (error: Error | null, result?: object) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result as T);
    });
  });
}

function summarizeCpuProfile(profile: InspectorCpuProfile, limit: number): RuntimeProfileFunction[] {
  const nodes = new Map<number, NonNullable<InspectorCpuProfile["nodes"]>[number]>();
  for (const node of profile.nodes ?? []) {
    nodes.set(node.id, node);
  }

  const aggregate = new Map<string, RuntimeProfileFunction>();
  for (const sampleId of profile.samples ?? []) {
    const node = nodes.get(sampleId);
    const callFrame = node?.callFrame;
    const functionName = callFrame?.functionName?.trim() || "(anonymous)";
    const url = callFrame?.url || undefined;
    const lineNumber = callFrame?.lineNumber;
    const columnNumber = callFrame?.columnNumber;
    const key = `${functionName}\n${url ?? ""}\n${lineNumber ?? ""}\n${columnNumber ?? ""}`;
    const existing = aggregate.get(key);
    if (existing) {
      existing.sampleCount = (existing.sampleCount ?? 0) + 1;
    } else {
      aggregate.set(key, {
        functionName,
        url,
        lineNumber,
        columnNumber,
        sampleCount: 1,
        selfTimeMs: 0
      });
    }
  }

  const totalDeltaUs = (profile.timeDeltas ?? []).reduce((total, delta) => total + delta, 0);
  const sampleTotal = Math.max(1, (profile.samples ?? []).length);
  const msPerSample = totalDeltaUs > 0 ? totalDeltaUs / 1000 / sampleTotal : 0;

  return [...aggregate.values()]
    .map((frame) => ({
      ...frame,
      selfTimeMs: Math.round((frame.sampleCount ?? 0) * msPerSample),
      totalTimeMs: Math.round((frame.sampleCount ?? 0) * msPerSample)
    }))
    .sort((a, b) => (b.selfTimeMs ?? 0) - (a.selfTimeMs ?? 0) || (b.sampleCount ?? 0) - (a.sampleCount ?? 0))
    .slice(0, Math.max(1, limit));
}

function readCpuUsage(): { user: number; system: number } | undefined {
  const runtime = globalThis as typeof globalThis & { process?: { cpuUsage?: () => { user: number; system: number } } };
  return runtime.process?.cpuUsage?.();
}

function readMemoryUsage():
  | {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers?: number;
    }
  | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      memoryUsage?: () => {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
        arrayBuffers?: number;
      };
    };
  };
  return runtime.process?.memoryUsage?.();
}

function readNodeVersion(): string | undefined {
  const runtime = globalThis as typeof globalThis & { process?: { version?: string } };
  return runtime.process?.version;
}

function runtimeSummary(): SignalMetadata {
  const nodeVersion = readNodeVersion();
  return nodeVersion ? { nodeVersion } : {};
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

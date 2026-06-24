type SystemHealthSampleInput = {
  capturedAt: Date;
  postgresLatencyMs: number | null;
  redisLatencyMs: number | null;
  queueWaiting: number;
  queueActive: number;
  queueFailed: number;
};

type QueueCounts = { waiting?: number; active?: number; failed?: number };

async function measureLatency(fn: () => Promise<unknown>): Promise<number | null> {
  const started = performance.now();
  try {
    await fn();
    return Math.round(performance.now() - started);
  } catch {
    return null;
  }
}

export async function collectHealthSample(input: {
  now: () => Date;
  postgresPing: () => Promise<unknown>;
  redisPing: () => Promise<string>;
  getQueueCounts: () => Promise<QueueCounts>;
}): Promise<SystemHealthSampleInput> {
  const [postgresLatencyMs, redisLatencyMs, queueCounts] = await Promise.all([
    measureLatency(input.postgresPing),
    measureLatency(input.redisPing),
    input.getQueueCounts().catch(() => ({}) as QueueCounts)
  ]);

  return {
    capturedAt: input.now(),
    postgresLatencyMs,
    redisLatencyMs,
    queueWaiting: queueCounts.waiting ?? 0,
    queueActive: queueCounts.active ?? 0,
    queueFailed: queueCounts.failed ?? 0
  };
}

export async function runHealthSampleOnce(input: {
  collect: () => Promise<SystemHealthSampleInput>;
  record: (sample: SystemHealthSampleInput) => Promise<unknown>;
  prune: (input: { cutoff: Date }) => Promise<unknown>;
  retentionHours: number;
  now: () => Date;
}): Promise<void> {
  const sample = await input.collect();
  await input.record(sample);
  const cutoff = new Date(input.now().getTime() - input.retentionHours * 60 * 60 * 1000);
  await input.prune({ cutoff });
}

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

export function startHealthSampleScheduler(input: {
  intervalMinutes: number;
  runOnce: () => Promise<unknown>;
  setIntervalFn?: (callback: () => void, delay: number) => IntervalHandle;
  setTimeoutFn?: (callback: () => void, delay: number) => TimeoutHandle;
  clearIntervalFn?: (handle: IntervalHandle) => void;
  clearTimeoutFn?: (handle: TimeoutHandle) => void;
}): () => Promise<void> {
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const setTimeoutFn = input.setTimeoutFn ?? setTimeout;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
  const clearTimeoutFn = input.clearTimeoutFn ?? clearTimeout;
  let stopped = false;
  let activeRun: Promise<void> | null = null;

  const tick = () => {
    if (stopped || activeRun) return;
    activeRun = (async () => {
      try {
        await input.runOnce();
      } catch (error) {
        console.error("Health sample scheduler run failed", error);
      } finally {
        activeRun = null;
      }
    })();
  };

  const startupTimer = setTimeoutFn(tick, 1000);
  const interval = setIntervalFn(tick, input.intervalMinutes * 60 * 1000);

  return async () => {
    stopped = true;
    clearTimeoutFn(startupTimer);
    clearIntervalFn(interval);
    await activeRun;
  };
}

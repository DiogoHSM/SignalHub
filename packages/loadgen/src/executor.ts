import type { SignalMonitorClient } from "@sigmon/sdk";
import type { Beat, IncidentWindow, Timeline } from "./types.js";

export function dispatchBeat(client: SignalMonitorClient, beat: Beat): void {
  const timestamp = new Date(beat.timestampMs);

  switch (beat.kind) {
    case "event":
      client.track(beat.name, beat.properties, { timestamp });
      return;
    case "error":
      client.captureError(new Error(beat.message), { severity: beat.severity, traceId: beat.traceId, timestamp });
      return;
    case "trace":
      client.trace({ name: beat.name, status: beat.status, durationMs: beat.durationMs, timestamp }, { traceId: beat.traceId });
      return;
    case "span":
      client.span({ traceId: beat.traceId, name: beat.name, status: beat.status, durationMs: beat.durationMs, timestamp });
      return;
    case "llmCall":
      client.llm({
        provider: beat.provider,
        model: beat.model,
        inputTokens: beat.inputTokens,
        outputTokens: beat.outputTokens,
        costUsd: beat.costUsd,
        latencyMs: beat.latencyMs,
        status: beat.status,
        timestamp
      });
      return;
    case "identifyUser":
      client.identifyUser(beat.userId, beat.traits, { tenantId: beat.tenantId, timestamp });
      return;
    case "identifyTenant":
      client.identifyTenant(beat.tenantId, beat.traits, { timestamp });
      return;
    case "breadcrumb":
      client.breadcrumb({ type: "custom", message: beat.message, timestamp });
      return;
  }
}

export type ExecutorOptions = {
  timeline: Timeline;
  projectClients: SignalMonitorClient[];
  nowMs: number;
  backfillBatchSize?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  onProgress?: (sent: number, total: number) => void;
  onOutageStart?: (window: IncidentWindow) => Promise<void> | void;
  onOutageEnd?: (window: IncidentWindow) => Promise<void> | void;
};

export type ExecutorResult = {
  sent: number;
  failed: number;
  skippedOutageWindows: number;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function runBeatLoop(options: ExecutorOptions, sleepImpl: (ms: number) => Promise<void>, nowImpl: () => number) {
  const backfillBatchSize = options.backfillBatchSize ?? 200;
  let sent = 0;
  let failed = 0;
  let sinceFlush = 0;
  const total = options.timeline.beats.length;

  const flushAll = async () => {
    const results = await Promise.all(options.projectClients.map((client) => client.flush()));
    for (const result of results) {
      sent += result.sent;
      failed += result.failed;
    }
  };

  for (const beat of options.timeline.beats) {
    const client = options.projectClients[beat.projectIndex];

    if (beat.timestampMs < options.nowMs) {
      dispatchBeat(client, beat);
      sinceFlush += 1;
      if (sinceFlush >= backfillBatchSize) {
        await flushAll();
        sinceFlush = 0;
      }
    } else {
      const waitMs = beat.timestampMs - nowImpl();
      if (waitMs > 0) {
        await sleepImpl(waitMs);
      }
      dispatchBeat(client, beat);
      await flushAll();
    }

    options.onProgress?.(sent, total);
  }

  await flushAll();

  return { sent, failed };
}

async function runOutageLoop(options: ExecutorOptions, sleepImpl: (ms: number) => Promise<void>, nowImpl: () => number) {
  let skipped = 0;

  for (const window of options.timeline.incidentWindows) {
    if (!window.monitorKind) {
      continue;
    }

    if (window.endMs <= options.nowMs) {
      skipped += 1;
      continue;
    }

    const startWaitMs = window.startMs - nowImpl();
    if (startWaitMs > 0) {
      await sleepImpl(startWaitMs);
    }
    await options.onOutageStart?.(window);

    const endWaitMs = window.endMs - nowImpl();
    if (endWaitMs > 0) {
      await sleepImpl(endWaitMs);
    }
    await options.onOutageEnd?.(window);
  }

  return { skipped };
}

export async function runExecutor(options: ExecutorOptions): Promise<ExecutorResult> {
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  const nowImpl = options.nowImpl ?? Date.now;

  const [beatsResult, outageResult] = await Promise.all([
    runBeatLoop(options, sleepImpl, nowImpl),
    runOutageLoop(options, sleepImpl, nowImpl)
  ]);

  return { sent: beatsResult.sent, failed: beatsResult.failed, skippedOutageWindows: outageResult.skipped };
}

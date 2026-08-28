import type { LlmCallBeat, ServiceDefinition } from "../types.js";

export function generateLlmCallBeats(
  service: ServiceDefinition,
  projectIndex: number,
  windowStartMs: number,
  windowEndMs: number,
  rng: () => number,
  llmCallMultiplierAt: (timestampMs: number) => number
): LlmCallBeat[] {
  if (!service.hasLlmCalls || service.llmCallsPerHour <= 0) {
    return [];
  }

  const intervalMs = 3_600_000 / service.llmCallsPerHour;
  const beats: LlmCallBeat[] = [];

  for (let t = windowStartMs; t < windowEndMs; t += intervalMs) {
    const count = Math.max(1, Math.round(Math.max(0, llmCallMultiplierAt(t))));
    for (let i = 0; i < count; i += 1) {
      const jitterMs = rng() * intervalMs * 0.5;
      const timestampMs = Math.min(windowEndMs - 1, Math.max(windowStartMs, Math.round(t + jitterMs)));
      const inputTokens = 200 + Math.round(rng() * 800);
      const outputTokens = 100 + Math.round(rng() * 400);

      beats.push({
        kind: "llmCall",
        timestampMs,
        projectIndex,
        serviceName: service.name,
        provider: "openai",
        model: "gpt-5",
        inputTokens,
        outputTokens,
        costUsd: Number((inputTokens * 0.000003 + outputTokens * 0.000015).toFixed(6)),
        latencyMs: 300 + Math.round(rng() * 1200),
        status: "success"
      });
    }
  }

  return beats.sort((a, b) => a.timestampMs - b.timestampMs);
}

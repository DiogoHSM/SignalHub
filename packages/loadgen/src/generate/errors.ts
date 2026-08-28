import type { ErrorBeat, ServiceDefinition } from "../types.js";

export function generateErrorBeats(
  service: ServiceDefinition,
  projectIndex: number,
  windowStartMs: number,
  windowEndMs: number,
  rng: () => number,
  errorMultiplierAt: (timestampMs: number) => number
): ErrorBeat[] {
  if (service.eventsPerHour <= 0 || service.errorRatePercent <= 0) {
    return [];
  }

  const baseErrorsPerHour = service.eventsPerHour * (service.errorRatePercent / 100);
  if (baseErrorsPerHour <= 0) {
    return [];
  }

  const intervalMs = 3_600_000 / baseErrorsPerHour;
  const beats: ErrorBeat[] = [];

  for (let t = windowStartMs; t < windowEndMs; t += intervalMs) {
    const count = Math.max(0, Math.round(errorMultiplierAt(t)));
    for (let i = 0; i < count; i += 1) {
      const jitterMs = rng() * intervalMs * 0.5;
      const timestampMs = Math.min(windowEndMs - 1, Math.max(windowStartMs, Math.round(t + jitterMs)));
      beats.push({
        kind: "error",
        timestampMs,
        projectIndex,
        serviceName: service.name,
        message: `${service.name} request failed`,
        severity: "error"
      });
    }
  }

  return beats.sort((a, b) => a.timestampMs - b.timestampMs);
}

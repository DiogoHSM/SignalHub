import type { EventBeat, ServiceDefinition } from "../types.js";

export function generateEventBeats(
  service: ServiceDefinition,
  projectIndex: number,
  windowStartMs: number,
  windowEndMs: number,
  rng: () => number
): EventBeat[] {
  if (service.eventsPerHour <= 0) {
    return [];
  }

  const intervalMs = 3_600_000 / service.eventsPerHour;
  const beats: EventBeat[] = [];

  for (let t = windowStartMs; t < windowEndMs; t += intervalMs) {
    const jitterMs = (rng() - 0.5) * intervalMs * 0.2;
    const timestampMs = Math.min(windowEndMs - 1, Math.max(windowStartMs, Math.round(t + jitterMs)));
    beats.push({
      kind: "event",
      timestampMs,
      projectIndex,
      serviceName: service.name,
      name: `${service.name}.request`,
      properties: { role: service.role }
    });
  }

  return beats;
}

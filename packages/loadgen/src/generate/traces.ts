import type { ServiceDefinition, SpanBeat, TraceBeat } from "../types.js";

export function generateTraceBeats(
  service: ServiceDefinition,
  projectIndex: number,
  windowStartMs: number,
  windowEndMs: number,
  rng: () => number
): (TraceBeat | SpanBeat)[] {
  if (service.tracesPerHour <= 0) {
    return [];
  }

  const intervalMs = 3_600_000 / service.tracesPerHour;
  const beats: (TraceBeat | SpanBeat)[] = [];
  let counter = 0;

  for (let t = windowStartMs; t < windowEndMs; t += intervalMs) {
    counter += 1;
    const jitterMs = (rng() - 0.5) * intervalMs * 0.2;
    const timestampMs = Math.min(windowEndMs - 1, Math.max(windowStartMs, Math.round(t + jitterMs)));
    const traceId = `trc_${service.name}_${projectIndex}_${counter}`;
    const rootDurationMs = 40 + Math.round(rng() * 200);

    beats.push({
      kind: "trace",
      timestampMs,
      projectIndex,
      serviceName: service.name,
      traceId,
      name: `${service.name}.handle`,
      status: "success",
      durationMs: rootDurationMs
    });

    for (const calleeName of service.callsServices) {
      const spanDurationMs = 10 + Math.round(rng() * 80);
      beats.push({
        kind: "span",
        timestampMs: Math.min(windowEndMs - 1, timestampMs + 1),
        projectIndex,
        serviceName: calleeName,
        callerServiceName: service.name,
        traceId,
        name: `${calleeName}.call`,
        status: "success",
        durationMs: spanDurationMs
      });
    }
  }

  return beats;
}

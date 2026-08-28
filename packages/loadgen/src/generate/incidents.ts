import type { IncidentWindow, Profile } from "../types.js";

export function placeIncidentWindows(
  profile: Profile,
  projectCount: number,
  windowStartMs: number,
  windowEndMs: number,
  nowMs: number
): IncidentWindow[] {
  const liveStartMs = Math.max(windowStartMs, nowMs);
  const midpointMs = liveStartMs + Math.floor((windowEndMs - liveStartMs) / 2);
  const windows: IncidentWindow[] = [];

  for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
    for (const incident of profile.incidents) {
      const startMs = midpointMs;
      const endMs = startMs + incident.durationMinutes * 60_000;
      windows.push({
        startMs,
        endMs,
        projectIndex,
        serviceName: incident.serviceName,
        incidentKey: incident.key,
        errorRateMultiplier: incident.errorRateMultiplier,
        llmCallMultiplier: incident.llmCallMultiplier,
        monitorKind: incident.monitorKind
      });
    }
  }

  return windows;
}

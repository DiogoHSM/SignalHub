import { createRng } from "./rng.js";
import { generateBreadcrumbBeats } from "./generate/breadcrumbs.js";
import { generateErrorBeats } from "./generate/errors.js";
import { generateEventBeats } from "./generate/events.js";
import { generateIdentityBeats } from "./generate/identity.js";
import { placeIncidentWindows } from "./generate/incidents.js";
import { generateLlmCallBeats } from "./generate/llm.js";
import { generateTraceBeats } from "./generate/traces.js";
import type { Beat, Profile, Timeline } from "./types.js";

export type GenerateTimelineOptions = {
  profile: Profile;
  projectCount: number;
  backfillMs: number;
  liveMs: number;
  nowMs: number;
  seed: number;
};

export function generateTimeline(options: GenerateTimelineOptions): Timeline {
  const { profile, projectCount, backfillMs, liveMs, nowMs, seed } = options;
  const windowStartMs = nowMs - backfillMs;
  const windowEndMs = nowMs + liveMs;
  const rng = createRng(seed);
  const incidentWindows = placeIncidentWindows(profile, projectCount, windowStartMs, windowEndMs, nowMs);

  const beats: Beat[] = [];

  for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
    const projectWindows = incidentWindows.filter((window) => window.projectIndex === projectIndex);

    for (const service of profile.services) {
      const serviceWindows = projectWindows.filter((window) => window.serviceName === service.name);
      const errorMultiplierAt = (t: number): number => {
        const active = serviceWindows.find((window) => t >= window.startMs && t < window.endMs);
        return active ? active.errorRateMultiplier : 1;
      };
      const llmCallMultiplierAt = (t: number): number => {
        const active = serviceWindows.find((window) => t >= window.startMs && t < window.endMs);
        return active ? active.llmCallMultiplier : 1;
      };

      const errorBeats = generateErrorBeats(service, projectIndex, windowStartMs, windowEndMs, rng, errorMultiplierAt);

      beats.push(...generateEventBeats(service, projectIndex, windowStartMs, windowEndMs, rng));
      beats.push(...errorBeats);
      beats.push(...generateTraceBeats(service, projectIndex, windowStartMs, windowEndMs, rng));
      beats.push(...generateLlmCallBeats(service, projectIndex, windowStartMs, windowEndMs, rng, llmCallMultiplierAt));
      beats.push(...generateBreadcrumbBeats(errorBeats));
    }

    beats.push(...generateIdentityBeats(profile, projectIndex, windowStartMs));
  }

  beats.sort((a, b) => a.timestampMs - b.timestampMs);

  return { beats, incidentWindows };
}

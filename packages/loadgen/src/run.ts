#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createSignalMonitorClient } from "@sigmon/sdk";
import { parseRunArgs } from "./args.js";
import { parseConfig } from "./config.js";
import { runExecutor } from "./executor.js";
import { startHeartbeatDriver } from "./heartbeat-driver.js";
import { PROFILES } from "./profiles/index.js";
import { generateTimeline } from "./timeline.js";
import type { IncidentWindow } from "./types.js";

async function main(): Promise<void> {
  const args = parseRunArgs(process.argv.slice(2));
  const profile = PROFILES[args.profile];
  if (!profile) {
    throw new Error(`unknown profile "${args.profile}" — available: ${Object.keys(PROFILES).join(", ")}`);
  }

  const config = parseConfig(JSON.parse(readFileSync(args.config, "utf8")));
  if (config.projects.length < args.projects) {
    throw new Error(`config has ${config.projects.length} project(s) but --projects ${args.projects} was requested`);
  }

  const nowMs = Date.now();
  const timeline = generateTimeline({
    profile,
    projectCount: args.projects,
    backfillMs: args.backfillMs,
    liveMs: args.liveMs,
    nowMs,
    seed: nowMs
  });

  const projectClients = config.projects.slice(0, args.projects).map((project) =>
    createSignalMonitorClient({ endpoint: config.endpoint, apiKey: project.apiKey, flushIntervalMs: 2_000 })
  );

  const activeHeartbeatDrivers: { stop: () => void }[] = [];
  const outageState = new Map<string, boolean>();

  const windowKey = (window: IncidentWindow) => `${window.projectIndex}:${window.serviceName}:${window.incidentKey}`;

  for (const heartbeatMonitor of config.monitors.heartbeat) {
    const relevantWindows = timeline.incidentWindows.filter(
      (window) => window.monitorKind === "heartbeat" && window.projectIndex === heartbeatMonitor.projectIndex && window.serviceName === heartbeatMonitor.serviceName
    );
    const driver = startHeartbeatDriver({
      endpoint: config.endpoint,
      monitorId: heartbeatMonitor.monitorId,
      monitorSecret: heartbeatMonitor.secret,
      intervalMs: 60_000,
      isInOutageWindow: (nowMsAtTick) => relevantWindows.some((window) => nowMsAtTick >= window.startMs && nowMsAtTick < window.endMs)
    });
    activeHeartbeatDrivers.push(driver);
  }

  const onOutageStart = async (window: IncidentWindow): Promise<void> => {
    outageState.set(windowKey(window), true);
    console.log(`[loadgen] incident "${window.incidentKey}" started on ${window.serviceName} (project ${window.projectIndex})`);

    if (window.monitorKind === "http") {
      const httpMonitor = config.monitors.http.find(
        (monitor) => monitor.projectIndex === window.projectIndex && monitor.serviceName === window.serviceName
      );
      if (httpMonitor) {
        await fetch(`${httpMonitor.controlUrl.replace(/\/+$/, "")}/control/${window.serviceName}`, {
          method: "POST",
          headers: { authorization: `Bearer ${httpMonitor.controlToken}`, "content-type": "application/json" },
          body: JSON.stringify({ state: "down" })
        }).catch((error: unknown) => console.warn(`[loadgen] could not flip fake target down: ${String(error)}`));
      }
    }
  };

  const onOutageEnd = async (window: IncidentWindow): Promise<void> => {
    outageState.set(windowKey(window), false);
    console.log(`[loadgen] incident "${window.incidentKey}" ended on ${window.serviceName} (project ${window.projectIndex})`);

    if (window.monitorKind === "http") {
      const httpMonitor = config.monitors.http.find(
        (monitor) => monitor.projectIndex === window.projectIndex && monitor.serviceName === window.serviceName
      );
      if (httpMonitor) {
        await fetch(`${httpMonitor.controlUrl.replace(/\/+$/, "")}/control/${window.serviceName}`, {
          method: "POST",
          headers: { authorization: `Bearer ${httpMonitor.controlToken}`, "content-type": "application/json" },
          body: JSON.stringify({ state: "up" })
        }).catch((error: unknown) => console.warn(`[loadgen] could not flip fake target up: ${String(error)}`));
      }
    }
  };

  const result = await runExecutor({
    timeline,
    projectClients,
    nowMs,
    onOutageStart,
    onOutageEnd,
    onProgress: (sent, total) => {
      if (sent % 50 === 0 || sent === total) {
        console.log(`[loadgen] ${sent}/${total} signals sent`);
      }
    }
  });

  for (const driver of activeHeartbeatDrivers) {
    driver.stop();
  }

  console.log(`[loadgen] done — sent ${result.sent}, failed ${result.failed}, skipped ${result.skippedOutageWindows} backfilled outage window(s)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

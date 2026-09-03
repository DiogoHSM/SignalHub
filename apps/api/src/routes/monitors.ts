import type { FastifyInstance } from "fastify";
import type { MonitorRecord } from "@sigmon/db/repositories/monitors.js";
import { z } from "zod";

export type MonitorRouteDependencies = {
  getActiveHeartbeatMonitor?: (id: string) => Promise<MonitorRecord | null | undefined>;
  verifyHeartbeatSecret?: (hash: string, secret: string) => Promise<boolean>;
  recordHeartbeatCheckIn?: (input: { monitorId: string; checkedInAt: Date }) => Promise<MonitorRecord | null | undefined>;
};

const heartbeatParamsSchema = z.object({
  id: z.string().trim().min(1)
});

function parseBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

export function registerMonitorRoutes(app: FastifyInstance, options?: MonitorRouteDependencies): void {
  app.post("/v1/heartbeats/:id", async (request, reply) => {
    if (!options?.getActiveHeartbeatMonitor || !options.verifyHeartbeatSecret || !options.recordHeartbeatCheckIn) {
      return reply.status(501).send({ error: "monitors_repository_unavailable" });
    }

    const params = heartbeatParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_heartbeat_request" });
    }

    const secret = parseBearerToken(request.headers.authorization);
    if (!secret) {
      return reply.status(401).send({ error: "invalid_heartbeat_secret" });
    }

    let monitor: MonitorRecord | null | undefined;
    try {
      monitor = await options.getActiveHeartbeatMonitor(params.data.id);
    } catch {
      return reply.status(503).send({ error: "monitors_unavailable" });
    }

    if (!monitor || monitor.kind !== "heartbeat" || monitor.archivedAt !== null || !monitor.secretHash) {
      return reply.status(404).send({ error: "heartbeat_monitor_not_found" });
    }

    let valid: boolean;
    try {
      valid = await options.verifyHeartbeatSecret(monitor.secretHash, secret);
    } catch {
      return reply.status(503).send({ error: "monitors_unavailable" });
    }

    if (!valid) {
      return reply.status(401).send({ error: "invalid_heartbeat_secret" });
    }

    try {
      const updated = await options.recordHeartbeatCheckIn({
        monitorId: monitor.id,
        checkedInAt: new Date()
      });
      if (!updated) {
        return reply.status(404).send({ error: "heartbeat_monitor_not_found" });
      }
    } catch {
      return reply.status(503).send({ error: "monitors_unavailable" });
    }

    return reply.status(202).send({ accepted: true });
  });
}

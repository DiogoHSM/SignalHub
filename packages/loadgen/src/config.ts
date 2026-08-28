import { z } from "zod";

const projectConfigSchema = z.object({
  name: z.string().trim().min(1),
  apiKey: z.string().trim().min(1)
});

const heartbeatMonitorConfigSchema = z.object({
  projectIndex: z.number().int().nonnegative(),
  serviceName: z.string().trim().min(1),
  monitorId: z.string().trim().min(1),
  secret: z.string().trim().min(1)
});

const httpMonitorConfigSchema = z.object({
  projectIndex: z.number().int().nonnegative(),
  serviceName: z.string().trim().min(1),
  controlUrl: z.string().trim().url(),
  controlToken: z.string().trim().min(1)
});

const loadgenConfigSchema = z.object({
  endpoint: z.string().trim().min(1, "endpoint is required"),
  projects: z.array(projectConfigSchema).min(1, "projects must contain at least one entry"),
  monitors: z
    .object({
      heartbeat: z.array(heartbeatMonitorConfigSchema).default([]),
      http: z.array(httpMonitorConfigSchema).default([])
    })
    .default({ heartbeat: [], http: [] })
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type HeartbeatMonitorConfig = z.infer<typeof heartbeatMonitorConfigSchema>;
export type HttpMonitorConfig = z.infer<typeof httpMonitorConfigSchema>;
export type LoadgenConfig = z.infer<typeof loadgenConfigSchema>;

export function parseConfig(raw: unknown): LoadgenConfig {
  const result = loadgenConfigSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`invalid loadgen config: ${message}`);
  }

  return result.data;
}

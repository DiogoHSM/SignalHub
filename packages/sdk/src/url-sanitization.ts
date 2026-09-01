import { sanitizeTelemetryUrl as sanitizeSharedTelemetryUrl } from "@sigmon/telemetry/sanitization";

// The SDK build replaces this workspace adapter with compiled output from the
// authoritative telemetry URL-only module before the public package is packed.
export const sanitizeTelemetryUrl: (value: string | undefined) => string | undefined =
  sanitizeSharedTelemetryUrl;

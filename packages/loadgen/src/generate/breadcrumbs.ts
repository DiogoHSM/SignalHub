import type { BreadcrumbBeat, ErrorBeat } from "../types.js";

export function generateBreadcrumbBeats(errorBeats: ErrorBeat[]): BreadcrumbBeat[] {
  return errorBeats.map((error) => ({
    kind: "breadcrumb",
    timestampMs: error.timestampMs - 2_000,
    projectIndex: error.projectIndex,
    serviceName: error.serviceName,
    message: `navigating to ${error.serviceName}`
  }));
}

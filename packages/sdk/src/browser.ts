export type {
  BrowserBreadcrumbOptions,
  StopBrowserBreadcrumbs,
  SignalMonitorClient,
  SignalMonitorClientOptions
} from "./index.js";
export type { BrowserErrorCaptureOptions } from "./browser-errors.js";
export type { BrowserWebVitalsOptions, StopBrowserWebVitals } from "./browser-web-vitals.js";
export type { BrowserClickCaptureOptions, StopBrowserClickCapture } from "./browser-clicks.js";
export type { BrowserReplayRecorder, BrowserReplayRecorderOptions } from "./browser-replay.js";
export type { FeedbackWidgetOptions, FeedbackWidgetPosition, StopFeedbackWidget } from "./browser-feedback-widget.js";

export { createBrowserBreadcrumbs, sanitizeBreadcrumbUrl } from "./browser-breadcrumbs.js";
export { installBrowserClickCapture } from "./browser-clicks.js";
export { installBrowserErrorCapture } from "./browser-errors.js";
export { installFeedbackWidget } from "./browser-feedback-widget.js";
export { createBrowserReplayRecorder } from "./browser-replay.js";
export { installBrowserWebVitals } from "./browser-web-vitals.js";
export { createSignalMonitorClient } from "./client.js";
export { createTraceContext, parseTraceparent, traceContextHeaders } from "./trace-context.js";
export type { TraceContext } from "./trace-context.js";

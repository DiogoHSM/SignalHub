# Changelog

All notable changes to `@sigmon/sdk` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this package follows semantic versioning.

## Unreleased

### Fixed

- Bind the default fetch transport to the global object so browser signal delivery does not fail with `Illegal invocation` and retain signals in the queue.

## 0.2.1

### Fixed

- Apply URL privacy sanitization consistently to captured browser context.
- Rebuild packages from clean staged output and reject stale or private-workspace runtime artifacts.
- Update vulnerable runtime dependencies without changing public exports.

## 0.2.0

No exports were removed or changed shape from 0.1.0 — this release is additive.

### Added

- Browser click-map capture (`installBrowserClickCapture`).
- Feedback widget (`installFeedbackWidget`) for browser-origin text and context feedback.
- Privacy-safe session replay recorder (`createBrowserReplayRecorder`).
- Browser Web Vitals capture (`installBrowserWebVitals`).
- Node uncaught exception and unhandled rejection capture (`installNodeErrorCapture`).
- Node CPU and memory profiling (`startNodeCpuProfile`, `captureNodeMemoryProfile`).
- README and `/sdk` docs for manual trace propagation (`createTraceContext`, `parseTraceparent`, `traceContextHeaders`) outside Next.js — these were already exported from every entrypoint but undocumented.

### Changed

- `package.json` `description` now reflects the full signal surface (Web Vitals, replay, click maps, feedback, profiling), not just the 0.1.0-era event/error/trace/LLM/identify list.

## 0.1.0

Initial release: events, errors, breadcrumbs, traces, spans, LLM calls, identify, and Next.js instrumentation, with Node, browser, and Next.js entrypoints.

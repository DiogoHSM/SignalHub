# PER-386 Error Monitoring Parity Implementation Plan

**Goal:** Evolve Sigmon error monitoring toward Sentry-style parity while keeping the self-hosted product simple: easier first-error setup, stronger full-stack SDK capture, clearer crash/fatal workflow, source-map lifecycle diagnostics, and on-call routing.

**First slice:** Harden full-stack/basic error setup for PER-407 and PER-408.

## Tasks

- [x] Browser error capture has a first-class `@sigmon/sdk/browser` export, not only a Next.js export.
- [x] Browser and wrapper-captured errors include consistent mechanism/source context for debugging.
- [x] Ingestion authentication, payload, and queue errors return actionable hints for common setup failures.
- [x] Console snippets and public SDK docs show browser error capture using the browser entrypoint.
- [x] Focused SDK/API/console docs tests pass.
- [x] Commit the first slice locally.

## Later PER-386 Slices

- [ ] Crash/fatal reporting workflow with dedicated filters and operational impact.
- [ ] Source-map release validation and unresolved-stack guidance.
- [ ] On-call routing with ack, mute/snooze, notification history, and escalation.

# Notification-channel Update Test Regression Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development`, `superpowers:systematic-debugging`, and `superpowers:test-driven-development` for this plan.

**Goal:** Resolve PER-519 by repairing stale API test fixtures without changing production behavior.

**File:** `apps/api/test/alerts.test.ts`

1. Preserve the reproduced RED baseline: four PATCH success tests return 404 because their fixtures omit `getNotificationChannel`.
2. Add a dedicated preflight-missing test whose getter returns `null`; assert 404 and that the update spy is not called.
3. Change the existing update-returns-null test so its getter returns an existing channel, proving the post-preflight race branch remains covered.
4. Add scenario-correct getter stubs to the four successful update fixtures:
   - existing Slack channel with HTTPS URL for URL preservation and replacement;
   - existing webhook channel for rename/redaction and secret-clear behavior.
5. Assert each successful scenario looks up the target id and retain all existing update-input, URL, redaction, and secret assertions.
6. Run the focused file with one worker, then the API suite and full repository suite.
7. Commit only the test repair and obtain an independent review with an exact `Ruling: APPROVED`.

No production route, validation, dependency wiring, API response, or persistence behavior changes are in scope.

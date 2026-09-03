# Notification-channel Update Test Regression Design

**Linear:** PER-519

## Goal

Restore the four notification-channel update tests that began returning 404 after final-state outbound validation was added, while preserving the production security behavior and distinguishing preflight absence from a post-preflight update race.

## Root cause

`PATCH /admin/notification-channels/:id` now loads the existing channel through `getNotificationChannel` before merging and validating the final outbound destination. Production supplies that dependency. Four successful test fixtures supply only `updateNotificationChannel`, so the optional lookup resolves to `undefined` and correctly follows the preflight `notification_channel_not_found` path.

## Contract

- Successful update fixtures provide the existing channel state needed by final-state validation.
- The getter receives the requested channel id before the update runs.
- A missing preflight channel returns 404 and never calls the update dependency.
- A channel that disappears after preflight still returns 404 when the update dependency returns `null`.
- Slack URL preservation/replacement, response redaction, and secret clearing retain their existing assertions.
- Production route logic and outbound URL validation are unchanged.

## Acceptance criteria

- The four formerly failing tests pass with scenario-accurate dependencies.
- Separate tests cover both preflight absence and post-preflight disappearance.
- The focused alerts suite and the full repository suite pass.
- An independent review confirms the fixtures do not weaken or bypass final-state validation.

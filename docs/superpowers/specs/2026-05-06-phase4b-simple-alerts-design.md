# Phase 4B Simple Alerts Design

## Source

This design extends `PRD.md` v0.2 and the completed Phase 4A operational safety work:

- Worker-owned scheduled jobs.
- Postgres operational metadata.
- Authenticated system health.
- Read-only operational console surfaces.
- Environment-first self-hosted configuration.

The approved direction is simple alert rules with internal alert history and one generic webhook notification channel. Provider-specific channels such as email, Telegram, Discord, and WhatsApp are deferred.

## Product Boundary

In scope:

- Store alert rules in Postgres.
- Store notification channels in Postgres.
- Store alert events and notification delivery attempts in Postgres.
- Evaluate alert rules from the worker process on a configured interval.
- Support a small set of telemetry-derived rule types:
  - critical or fatal errors in a rolling window
  - error count above a threshold in a rolling window
  - trace p95 latency above a threshold in a rolling window
  - LLM cost above a threshold in a rolling window
- Scope each rule to one project and one environment.
- Add a cooldown window so one noisy condition does not emit repeated events every evaluation.
- Add generic outbound webhook delivery.
- Add authenticated admin API endpoints for rule and channel management.
- Add authenticated read-only API endpoints for alert history.
- Add a console `Alerts` area for rules, channel status, recent alert events, and delivery status.

Out of scope:

- Email, Telegram, Discord, WhatsApp, Slack, or provider-native channels.
- Alert routing by user, team, role, tenant ownership, or escalation policy.
- SaaS workspaces, organizations, invites, billing, or enterprise permissions.
- Anomaly detection, trend comparison, or ML-based alerting.
- Alert silencing, maintenance windows, incident management, or acknowledgement workflow.
- Per-tenant or per-user alert rules.
- Custom SQL or arbitrary expression builder.
- Batch notification digests.
- Webhook signing with rotating secrets.
- Retention policies for alert metadata.

## Recommended Approach

Use the worker as the alert evaluator, Postgres as the source of truth, and the API as the authenticated management surface.

The worker already owns scheduled operational work after Phase 4A. Keeping alert evaluation there avoids running background work inside request-serving code and keeps Docker Compose easy to operate. Postgres is sufficient for MVP alert metadata, rule state, and delivery attempts. Redis/BullMQ remains focused on telemetry ingestion.

Alternatives considered:

- API-owned evaluation: simpler to discover, but it mixes user requests with background polling and external webhook calls.
- A separate alert worker service: cleaner separation long term, but it adds another process before the self-hosted install needs that complexity.
- Notification-only alerts without internal history: easier to build, but weaker operationally because operators lose the audit trail when a webhook fails.

## Data Model

Add a migration for four operational tables:

```txt
notification_channels
alert_rules
alert_events
notification_deliveries
```

`notification_channels`:

- `id`
- `name`
- `type`: initially `webhook`
- `url`
- `secret_header_name`
- `secret_header_value`
- `enabled`
- `created_at`
- `updated_at`
- `archived_at`

`alert_rules`:

- `id`
- `project_id`
- `environment_id`
- `notification_channel_id`
- `name`
- `type`
- `severity`
- `window_minutes`
- `threshold`
- `cooldown_minutes`
- `enabled`
- `last_evaluated_at`
- `last_triggered_at`
- `created_at`
- `updated_at`
- `archived_at`

`alert_events`:

- `id`
- `rule_id`
- `project_id`
- `environment_id`
- `status`: `triggered`
- `severity`
- `triggered_at`
- `window_start`
- `window_end`
- `observed_value`
- `threshold`
- `message`
- `metadata`
- `created_at`

`notification_deliveries`:

- `id`
- `alert_event_id`
- `notification_channel_id`
- `status`: `success` or `failed`
- `attempted_at`
- `response_status`
- `error_message`
- `created_at`

Secrets are write-only through the API. The API may return whether a secret exists, but it must never return the full `secret_header_value`.

## Rule Types

Use fixed rule types instead of a generic expression language.

```ts
type AlertRuleType =
  | "critical_errors"
  | "error_count"
  | "trace_p95_latency"
  | "llm_cost";
```

`critical_errors`:

- Counts errors where severity is `critical` or `fatal`.
- Fires when count is greater than or equal to `threshold`.
- Recommended default threshold: `1`.

`error_count`:

- Counts all error rows.
- Fires when count is greater than or equal to `threshold`.

`trace_p95_latency`:

- Computes p95 from non-null trace durations.
- Fires when p95 milliseconds is greater than or equal to `threshold`.
- Does not fire when no trace durations exist in the window.

`llm_cost`:

- Sums LLM call cost in USD.
- Fires when cost is greater than or equal to `threshold`.
- Uses decimal-safe aggregation and stores observed values as strings or fixed decimal-compatible values.

All rules are scoped to:

- `project_id`
- `environment_id`
- rolling `window_minutes`

## Evaluation Semantics

Add alert configuration:

```txt
ALERTS_ENABLED=true
ALERTS_INTERVAL_MINUTES=1
ALERTS_WEBHOOK_TIMEOUT_MS=5000
```

Worker scheduling:

- Start alert evaluation only when `ALERTS_ENABLED=true`.
- Run once shortly after worker startup.
- Then run every `ALERTS_INTERVAL_MINUTES`.
- Do not overlap alert evaluations in the same process.
- Use a Postgres advisory lock for the evaluation pass so multiple workers do not duplicate alerts.

Evaluation flow:

1. Load enabled, non-archived alert rules.
2. For each rule, calculate the rolling window from worker clock time.
3. Skip the rule when it is inside cooldown.
4. Query the observed value for the rule type and scope.
5. If the observed value does not meet the threshold, update `last_evaluated_at` only.
6. If it fires, create one `alert_event`, update `last_triggered_at`, and attempt webhook delivery if a channel is attached and enabled.
7. Record one `notification_deliveries` row for every delivery attempt.
8. Continue evaluating other rules when one rule or webhook fails.

Cooldown semantics:

- Cooldown is rule-local.
- Cooldown starts at `last_triggered_at`.
- A firing condition inside cooldown does not create another `alert_event`.
- The rule still records `last_evaluated_at`.

## Webhook Delivery

Webhook payload:

```ts
type AlertWebhookPayload = {
  alertEventId: string;
  ruleId: string;
  ruleName: string;
  ruleType: AlertRuleType;
  severity: "info" | "warning" | "critical";
  projectId: string;
  environmentId: string;
  triggeredAt: string;
  window: {
    from: string;
    to: string;
    minutes: number;
  };
  observedValue: string;
  threshold: string;
  message: string;
  signalhub: {
    source: "signalhub";
  };
};
```

Delivery rules:

- Send `POST` with `Content-Type: application/json`.
- Treat HTTP 2xx as success.
- Treat timeout, network failure, and non-2xx status as failed.
- Store only a sanitized error message.
- Do not retry in the first slice.
- Do not block the whole evaluation pass when delivery fails.

Optional channel secret:

- If `secret_header_name` and `secret_header_value` are set, include that header in the webhook request.
- Reject unsafe header names.
- Never log or return the secret value.

## API Surface

Admin-only endpoints:

```txt
GET /admin/notification-channels
POST /admin/notification-channels
PATCH /admin/notification-channels/:id
DELETE /admin/notification-channels/:id

GET /admin/alert-rules
POST /admin/alert-rules
PATCH /admin/alert-rules/:id
DELETE /admin/alert-rules/:id
```

Human-session read endpoints:

```txt
GET /alerts/events
GET /alerts/events/:id
```

Validation:

- Rule name and channel name are required.
- Rule `project_id` and `environment_id` must refer to active records.
- Rule `window_minutes`, `threshold`, and `cooldown_minutes` must be positive.
- Webhook URL must be `http` or `https`.
- In production, webhook URLs should reject localhost and private network targets. An explicit private-network override is deferred to a later phase.

Response behavior:

- Missing session: `401 unauthenticated`.
- Non-admin mutation: `403 admin_required`.
- Invalid body/query: `400 invalid_*_request`.
- Missing record: `404 *_not_found`.
- Repository unavailable in tests: `501 *_repository_unavailable`.
- Unexpected persistence failure: `503 alerts_unavailable`.

## Console UX

Add `Alerts` as an operational console area near `System`:

```txt
Setup | Overview | Investigate | Alerts | System
```

Initial console capabilities:

- List alert rules for the selected project/environment.
- Show enabled/disabled state, type, severity, threshold, window, cooldown, and last triggered time.
- Create and edit simple rules with constrained controls.
- List webhook notification channels.
- Create and edit webhook channels without displaying saved secret values.
- Show recent alert events with severity, rule name, message, observed value, threshold, and delivery status.
- Show clear empty, loading, and error states.

The UI should remain operational and compact. Alerts are not a dashboard builder. Avoid custom expression UI, charting, or visual noise.

## Security And Safety

- Alert management requires admin access.
- Alert event history requires a logged-in human session.
- Webhook secrets are write-only.
- Webhook payloads must not include raw telemetry payloads, stack traces, prompts, or outputs.
- Alert messages and metadata should be sanitized before persistence.
- Webhook failures should not crash the worker.
- Advisory locking should prevent duplicate alert events across scaled worker processes.
- The first webhook implementation should reduce server-side request forgery risk by validating URL protocol and rejecting localhost/private-network targets in production.

## Testing Strategy

Repository tests:

- Migration creates alert tables.
- Rule and channel CRUD works.
- Deleted or disabled rules do not evaluate.
- Evaluation queries calculate each supported rule type correctly.
- Cooldown suppresses repeated alert events.

Worker tests:

- Scheduler does not overlap evaluations.
- Advisory-lock skip records no duplicate events.
- One failing rule does not stop other rules.
- Webhook success records a successful delivery.
- Webhook non-2xx, timeout, and thrown network error record failed deliveries.
- Webhook secrets are sent when configured but not logged or returned.

API tests:

- Admin endpoints require admin session.
- Read endpoints require human session.
- Invalid rule/channel requests return `400`.
- Responses redact webhook secrets.
- Alert history filters by project/environment.

Console tests:

- `Alerts` mode appears in navigation.
- Rule list, channel list, and recent event history render.
- Rule create/edit form validates required fields.
- Saved webhook secrets are not displayed.
- Delivery failure state renders clearly.

Final verification:

```txt
pnpm test
pnpm build
docker compose config --quiet
browser visual check for Alerts at desktop and mobile widths
```

## Documentation Updates

Update:

- `.env.example`: alert scheduler and webhook timeout settings.
- `README.md`: simple alerts and webhook setup.
- `.claude/docs/ARCHITECTURE.md`: alert evaluator, metadata tables, webhook delivery.
- `.claude/docs/DEPLOYMENT.md`: alert environment variables and operational behavior.
- `.claude/docs/SECRETS.md`: webhook secret storage and redaction.
- `.claude/docs/UI-UX.md`: Alerts console mode.
- `.claude/docs/PROJECT-SUMMARY.md`: Phase 4B capabilities after implementation.

## Open Decisions Resolved

- Start with internal alert history plus generic webhook delivery.
- Keep alerts self-hosted and provider-neutral.
- Use worker-owned evaluation instead of API-owned evaluation.
- Use fixed rule types instead of custom expressions.
- Scope rules to project and environment only.
- Defer native notification providers, silencing, escalation, acknowledgement, and incident workflows.

# Retention and Archived-Scope Lifecycle Design

**Linear:** PER-503

## Goal

Make the configured effective retention window authoritative for every project/environment scope, give each record type one deletion owner, and prevent heartbeat writes after a parent scope is archived.

## Non-goals

- A retention-policy redesign in the console.
- Legal-hold workflows.
- Restoring rows already deleted by earlier behavior.
- Changing analytical cohort-retention semantics.

## Effective retention

Installation environment values become defaults for scopes without an explicit governance value. A project/environment policy value replaces the default for that category, whether shorter or longer. This supersedes the 2026-07-02 statement that installation retention is a hard maximum; the old behavior contradicted the editable scoped-policy contract and made longer scoped values ineffective.

Deletion no longer runs an unscoped global pass followed by scoped passes. For each table/category, one query selects rows whose timestamp is older than the effective cutoff:

- rows in a scope with an explicit category value use that value;
- rows in a scope with no value or no governance row use the installation default.

Queries remain allowlisted, parameterized, and batched. They must not interpolate a table or timestamp column outside the existing closed mappings.

## Single deletion ownership

Each physical table belongs to exactly one category:

- `events` → events;
- `click_events` → clicks;
- `session_replays` → replays;
- `errors`, `traces`, `spans`, `llm_calls`, `web_vitals`, `profiles`, and `breadcrumbs` → their corresponding category.

The events policy no longer deletes `session_replays`. Counters report the physical category that performed the deletion. Existing policy JSON without a category falls back to the installation default.

## Archived heartbeat scopes

Heartbeat lookup joins monitors to environments and projects and requires all three `archived_at` values to be null. `recordHeartbeatCheckIn` repeats those conditions inside its locking transaction and updates only the locked active monitor. This closes the race where a parent is archived after route lookup but before persistence.

The external contract remains `404 heartbeat_monitor_not_found` for an archived monitor, environment, or project so callers cannot distinguish lifecycle state. A bad secret against an otherwise active heartbeat remains `401`.

## Migration and rollout

No schema migration is required for effective-cutoff queries. Update the governance decision record, self-hosting documentation, admin API descriptions, and current console copy to state that scoped values override defaults. Before deployment, operators should review policies whose values exceed installation defaults because those rows will now live longer than before.

## Safety constraints

- Fixtures assert survivors on both sides of every cutoff boundary.
- A failed category batch aborts that retention run and records the partial counts already produced.
- Archived-scope validation occurs in the same transaction as heartbeat mutation.
- Replay rows are never selected by more than one category.

## Acceptance criteria

- A scoped 90-day value preserves a 60-day row when the installation default is 30 days.
- A scoped 7-day value deletes an 8-day row when the installation default is 30 days.
- An unconfigured scope continues to use the installation default.
- Replay deletion and counters occur exactly once.
- Heartbeats fail after monitor, environment, or project archival, including an archive/write race.

## Verification

Add repository integration fixtures for longer, shorter, absent, and partially populated policies; category-ownership tests; retention worker failure accounting; route tests for all archival states; and a transaction-race test. Run the DB, API, worker, and full repository suites.

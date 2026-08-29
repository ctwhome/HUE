# Architecture Decision Record: HUE-owned schedules and dedicated projectless Sessions

- **Status:** Implemented
- **Date:** 2026-08-28
- **Owners:** Curi / HUE
- **Extends:** ADR-0003 and ADR-0005

## Context

Scheduled prompts need HUE's durable complete-envelope delivery semantics and visible conversational continuity without being attached to an arbitrary Project or mixed into an unrelated interactive Session. Treating Hermes cron state as authoritative would bypass MessageDispatcher acceptance and make ACP Session correlation unreliable.

## Decision

HUE SQLite is authoritative for schedule identity, name, prompt, five-field cron expression, enabled state, next occurrence, and dedicated Session association. Each schedule owns one projectless ACP Session under HUE's unprojected Session root. Every scheduled and manual run is a durable MessageDispatcher envelope; existing messages and Session events are the run history.

Due acceptance and next-occurrence advancement are one SQLite transaction. After downtime HUE coalesces missed occurrences into one run, then advances to the next future occurrence. Manual runs use a client-supplied run ID and do not move the scheduled occurrence. Session execution and mutation remain ACP-backed, and complete-envelope, idempotency, serialization, replay, permission, and unknown-delivery rules remain unchanged. HUE never auto-approves interactions.

Existing external Hermes cron jobs are not silently imported, mutated, or deleted. They remain external until a user explicitly recreates them in HUE.

## Consequences

- Schedules remain a supporting surface, not a fourth user-facing HUE object.
- HUE owns scheduling state while Hermes ACP owns each Session's execution and transcript persistence.
- Dedicated projectless Sessions provide a stable review surface without weakening Project trust boundaries.

## Revisit triggers

- Product requirements need time zones or cron syntax beyond the implemented five-field form.
- Catch-up must preserve every missed occurrence instead of coalescing them.

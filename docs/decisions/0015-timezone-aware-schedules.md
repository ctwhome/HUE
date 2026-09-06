# Architecture Decision Record: Timezone-aware HUE schedules

- **Status:** Accepted
- **Date:** 2026-09-06
- **Owners:** Curi / HUE
- **Amends:** ADR-0010

## Context

Server-local cron expressions change meaning when HUE moves between machines or the operator travels, and daylight-saving transitions make that implicit behavior unreliable. ADR-0010 identified explicit timezone support as a revisit trigger.

## Decision

Each HUE-owned schedule stores an IANA timezone alongside its five-field cron expression. Cron fields describe civil time in that zone, while `next_run_at` remains an absolute UTC instant. Creating, editing, or resuming a schedule calculates its next occurrence from the persisted timezone. The schedule form offers Daily, Weekdays, and Weekends with a native time input, plus the existing five-field expression as an advanced option.

Nonexistent spring-forward wall times are skipped. Repeated fall-back wall times run once at their earlier occurrence. Existing downtime coalescing, durable envelope acceptance, per-Session serialization, and unknown-delivery behavior remain unchanged.

Schema version 11 adds the timezone column after a validated backup. Existing schedules are pinned to the server's current IANA timezone at migration time without changing their stored `next_run_at`; their original implicit timezone cannot be recovered. External Hermes cron jobs remain Hermes-owned and are not assigned a HUE timezone.

## Consequences

- Schedule meaning survives server timezone changes and daylight-saving transitions.
- Existing schedules retain their already-selected next instant through migration.
- Operators should review migrated schedule timezones if the database moved between zones before upgrading.
- HUE still supports five-field cron only and still coalesces missed occurrences into one run.

## Revisit triggers

- A real requirement needs per-occurrence overlap behavior, seconds, calendars, or syntax beyond five fields.
- Catch-up must preserve every missed occurrence instead of coalescing them.

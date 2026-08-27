# Deployment and operations

> **Product status:** `TBI`
> **Open choices:** `TBD-001` application shell, `TBD-002` control plane, `TBD-011` sandbox, `TBD-013` notification transport, `TBD-014` mobile, `TBD-017` sync.

## Deployment goals

- One-person local installation is the first-class path.
- Application and worker processes survive normal restarts with truthful recovery.
- Remote/mobile access is optional and secure.
- Runtime adapters may be installed independently.
- Users can back up, export, migrate and uninstall without losing opaque cloud-only state.

## Target topology — `TBI`

```text
User device
├── HUE client
├── HUE local control-plane service
├── transactional database + event journal
├── artifact/index storage
├── runtime adapter supervisor
│   ├── native HUE worker
│   ├── Hermes (optional)
│   ├── Codex / Claude Code / OpenCode (optional)
│   └── browser/computer-use services (optional)
├── OS keychain integration
└── optional authenticated remote-access endpoint

External
├── configured model providers
├── configured MCP/APIs
├── Git hosting / productivity services
└── optional encrypted relay/notification service
```

## Process supervision — `TBI`

The local service must:

- start at login only with user consent;
- expose health/readiness;
- own child process lifecycles;
- persist native handles and reconcile after restart;
- terminate orphaned processes safely;
- rotate bounded logs;
- support update drain mode;
- never duplicate scheduler/worker ownership after split brain.

Implementation mechanism depends on packaging and OS (`TBD-001`, `TBD-002`).

## Installation modes

### Desktop local — first target (`TBI`)

Bundled client and local service, user-selected data directory, OS credential vault, optional runtime adapters.

### Browser + local daemon (`TBI`)

Browser UI connects to loopback or authenticated tailnet/local-network service. Must protect against hostile origins, CSRF and accidental public exposure.

The implemented P0 path preserves unauthenticated loopback use and enables non-loopback requests only when `HUE_ACCESS_SECRET` is configured and the browser holds a valid signed session. Deploy it behind Tailscale Serve or another trusted HTTPS reverse proxy, keep the HUE listener on loopback, and set `ORIGIN` to the exact public HTTPS origin. Remote sessions use HttpOnly, Secure, SameSite cookies and expire after seven days; rotating the access secret invalidates them all.

This is a single-user access gate, not an internet-facing identity system. Use a unique high-entropy secret, keep it out of command history and logs, restrict network reachability to the trusted LAN or tailnet, and do not terminate remote access over plain HTTP. Per-device revocation, accounts, audit trails and brute-force rate limiting remain deferred.

### Headless/home server (`DEFERRED`)

Control plane on a trusted server with desktop/mobile clients. Requires mature auth, device management and remote computer-use boundaries.

### Team/hosted (`DEFERRED`)

Not a prerequisite for local alpha.

## Configuration layers — `TBI`

1. Product safe defaults.
2. Device/global user settings.
3. Project manifest and policy.
4. Conversation/task/run overrides.
5. Ephemeral worker manifest.

Secrets are never stored in normal config. Configuration is schema-versioned, validated and exportable with secret references redacted.

## Backup and restore

The current P0 slice creates a consistent SQLite snapshot of the HUE control-plane database in a
`backups` directory beside `HUE_DATABASE_PATH`. The artifact is written with mode `0600` and is not
reported as successful until SQLite integrity and the required HUE schema have been validated.
Hermes databases, transcripts, memory, credentials and other Hermes-owned state are never included.

HUE records its control-plane schema in SQLite `PRAGMA user_version`; the current version is `3`.
Opening a database already at that version performs no schema writes and creates no migration backup.
Version `1` databases migrate transactionally by adding nullable Workflow folder metadata without a
backup because the change is additive and does not rewrite user data.
Version `2` databases similarly add a non-destructive Workflow favorite flag.
Before the version `0` cancelled-message status migration reconstructs `messages` and
`message_attachments`, HUE automatically creates and validates a private snapshot in the same
`backups` directory. In-memory databases migrate transactionally without a backup artifact.

Schema changes and the `user_version` update commit in one transaction. If migration fails, startup
stops with either the complete old schema or the complete new schema; it does not expose partially
reconstructed tables. The local startup error reports the current and target versions, the backup
filename, and the offline recovery action without putting an absolute private path in remote
diagnostics.

Live restore is intentionally unavailable because HUE does not yet have a lifecycle seam that can
drain delivery, close every database user and restart safely. To restore manually:

1. Stop HUE completely.
2. Preserve the current HUE database and its `-wal`/`-shm` files instead of overwriting them in place.
3. Copy a validated backup to a fresh `HUE_DATABASE_PATH` ending in `hue.db`.
4. Start HUE with that path and inspect Runtime diagnostics before resuming work.

For migration rollback, use the backup filename reported by the startup error and follow the same
offline procedure. Keep the failed database and any `-wal`/`-shm` files for diagnosis; restore the
validated snapshot to a fresh HUE path rather than copying it over the failed path. A failed migration
does not modify Hermes data, and a HUE migration backup must never be placed in a Hermes data path.

Do not restore a HUE backup into a Hermes data path. Broader export/import and conflict-aware restore
remain `TBI`.

Backup includes:

- transactional database;
- event journal/checkpoints;
- project manifests;
- memory records;
- artifact metadata and optionally content;
- settings and adapter manifests;
- credential references, not secret values.

Restore must:

- validate integrity and schema;
- preview conflicts/paths;
- support restore to a new device/data directory;
- rebuild indexes from canonical records;
- mark unrecoverable external runtime handles as interrupted/unknown;
- verify a sample of artifacts/checksums.

## Updates — `TBI`

- Signed release artifacts.
- Release notes including schema/runtime contract changes.
- Database backup before migration.
- Drain or checkpoint active runs.
- Adapter compatibility check.
- Rollback when schema permits; explicit warning when not.
- No silent installation of new broad permissions.

## Health and diagnostics — `TBI`

```text
HUE control plane          healthy
Database                   healthy · last backup 2h
Event journal              healthy · lag 0
Artifact store             healthy
Search index               rebuilding 64%
Coding route               healthy
Local route                unavailable · model stopped
Browser                    healthy
Computer use               permission required
Notifications              degraded · last delivery failed
```

Diagnostics distinguish configured, enabled, authorized, available and healthy.

## Offline behavior — `TBI`

Without network:

- project/conversation/task browsing works;
- local files/artifacts/memory/search remain available;
- local models/tools continue when configured;
- cloud-dependent steps wait with clear reason;
- messages/tasks may be queued but no external side effect is claimed;
- reconnect triggers reconciliation, not blind replay.

## Notification operations — `TBI`

The full product, channel, privacy, sound and delivery-history contract is in [Notifications, attention and delivery](16-notifications-attention-delivery.md).

The operational minimum is:

- persist canonical in-app attention before attempting a channel;
- notify for explicit subscriptions, blocking approvals/decisions, meaningful terminal outcomes, security/budget boundaries and time-sensitive monitors;
- keep routine progress in-app unless the user subscribes;
- group/deduplicate by task and resume durable queues after restart;
- respect OS authorization, Focus/Do Not Disturb, configured sounds, quiet hours and per-Space local-only policy;
- send redacted external summaries with authenticated deep links;
- distinguish suppressed, queued, attempting, accepted, displayed/delivered, failed, expired, read and acted;
- expose configured/authorized/available/healthy state plus last successful delivery;
- use bounded retry with expiry and never generate recursive alert storms for a failed gateway.

External delivery failure does not change a task’s completion status. Offline reconnect reconciles relevance before replay, so stale approvals and obsolete progress notices expire rather than arriving late.

## Data directories and portability

Exact paths are `TBD` by platform. The contract requires:

- documented location;
- project/profile safe resolution;
- no hidden dependency on one username/path;
- export format independent of internal indexes;
- content-addressed artifact option;
- human-readable project manifest.

## Operational acceptance gates

- clean install and first project on macOS reference environment;
- restart during active run with correct reconciliation;
- backup/restore to a fresh data directory;
- offline start and cloud-step wait/resume;
- provider credential expiration and recovery;
- disk-full handling without database corruption;
- safe update with active paused run;
- complete uninstall/export documentation.

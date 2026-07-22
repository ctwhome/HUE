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

## Backup and restore — `TBI`

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

## Notification policy — `TBI`

Notify only for:

- explicit user-requested updates;
- approvals/decisions blocking work;
- task completion when requested;
- failure or unknown outcome needing attention;
- security or budget boundary;
- deadline/time-sensitive event.

Routine tool progress remains in-app. External channels receive redacted summaries and deep links.

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

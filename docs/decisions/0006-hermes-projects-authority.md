# Architecture Decision Record: Hermes Projects are authoritative

- **Status:** Accepted
- **Date:** 2026-08-22
- **Owners:** Curi / HUE
- **Supersedes:** ADR-0002's HUE-owned Project identity/root metadata; ADR-0003 and ADR-0004's single Project-directory assumption

## Context

Hermes Agent v0.20.5 exposes first-class, per-profile, multi-folder Projects through authenticated `hermes serve` JSON-RPC methods under `projects.*`. Keeping a second authoritative Project identity or folder list in HUE would create conflicting names, roots, archive state, and lifecycle behavior.

HUE still owns Workflows, Project/Session associations, delivery state, reconnect events, and other UI metadata that Hermes does not own. Existing HUE databases may contain single-root Project rows referenced by that state.

## Decision

Hermes Projects are authoritative for Project id, name, icon, archive state, ordered folders, and exactly one primary folder.

HUE:

- connects to authenticated `hermes serve /api/ws` and uses profile-scoped `projects.*` JSON-RPC only;
- never writes Hermes `projects.db` directly;
- reads a Project after every mutation and renders that readback;
- uses the primary folder for new Sessions and Project tools;
- recognizes existing Sessions whose actual cwd is inside any Project folder;
- keeps HUE-owned metadata keyed by Hermes Project ids;
- capability-gates Projects when the installed runtime lacks `projects.*`, without falling back to legacy HUE rows.

Legacy single-root rows reconcile by canonical folder equality. One unambiguous match adopts the Hermes id while remapping every HUE-owned foreign key transactionally. No match creates one Hermes Project, then adopts its id. Multiple Hermes matches, or multiple legacy rows resolving to one Hermes Project/canonical folder, remain untouched and surface an explicit reconciliation issue.

## Consequences

- Project identity and folder lifecycle have one source of truth.
- HUE's SQLite `projects` table remains only as a foreign-key anchor and migration ledger; sentinel name/root fields are not user-facing authority.
- Project availability depends on both Hermes administration transport and local folder availability.
- Older Hermes runtimes cannot use Project-scoped HUE features until upgraded; projectless Sessions remain available.
- Archive is blocked while HUE owns queued, running, or unknown delivery state.

## Revisit triggers

- Hermes removes or incompatibly changes `projects.*`.
- Hermes exposes a transactional multi-operation folder mutation that can replace HUE's verified mutation/readback sequence.
- HUE-owned metadata can reference Hermes Project ids without a local foreign-key anchor.

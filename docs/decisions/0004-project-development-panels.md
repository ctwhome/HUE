# Architecture Decision Record: project development panels

- **Status:** Accepted
- **Date:** 2026-08-21
- **Supersedes:** ADR-0002's terminal, source-control, and Project file-management UI non-goals only

## Context

Projects need a compact local development workbench alongside Hermes Sessions: an interactive terminal, repository status and mutations, linked worktrees, browser previews, and bounded access to files under each trusted Project root. These are Project-scoped panels, not new product objects or alternate agent runtimes.

## Decision

HUE may expose development panels inside a trusted Project boundary:

- ephemeral native Bun PTYs rooted at the Project directory;
- bounded cursor-based terminal output and sequenced input over same-origin HTTP;
- Git status, stage, unstage, commit, and push through argument-array processes;
- linked-worktree inspection and repository links;
- sandboxed browser previews with an external-browser fallback.
- a bounded file tree, path search, safe previews, explicit file mutations, and honest artifact/evidence classification rooted inside the trusted Project directory.

Terminal access uses the same request-access boundary as the workspace. Loopback remains zero-configuration; remote terminal access requires an authenticated session through the configured HTTPS origin, and terminal mutations additionally require a same-origin browser request. The browser cannot supply a terminal working directory. PTYs are process-local, inherit an allowlisted environment, expire when idle, and are not persisted across server restarts. Git mutations require direct user actions and never run commands through a shell.

Project file paths are untrusted input even when emitted by a tool. Server-side descriptor and no-follow validation must precede access or link activation. Mutations require loopback same-origin access, bounded payloads, atomic writes, optimistic concurrency, and exact recursive-delete impact confirmation. Filename heuristics may classify evidence but must never claim independent verification.

## Consequences

- HUE remains a Projects, Workflows, and Hermes Sessions product; panels are tools attached to a Project.
- Running HUE grants local shell capability to authenticated remote clients, so the production default remains `127.0.0.1` behind a trusted HTTPS proxy and remote access requires a high-entropy secret.
- Terminal sessions disappear on restart and are unsuitable for multi-replica hosting.
- Push authentication remains owned by the user's existing Git credential configuration.

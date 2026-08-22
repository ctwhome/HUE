# Architecture Decision Record: project development panels

- **Status:** Accepted
- **Date:** 2026-08-21
- **Supersedes:** ADR-0002's terminal and source-control UI non-goals only

## Context

Projects need a compact local development workbench alongside Hermes Sessions: an interactive terminal, repository status and mutations, linked worktrees, and browser previews. These are Project-scoped panels, not new product objects or alternate agent runtimes.

## Decision

HUE may expose development panels inside a trusted Project boundary:

- ephemeral native Bun PTYs rooted at the Project directory;
- bounded cursor-based terminal output and sequenced input over same-origin HTTP;
- Git status, stage, unstage, commit, and push through argument-array processes;
- linked-worktree inspection and repository links;
- sandboxed browser previews with an external-browser fallback.

Terminal access is loopback-only. The browser cannot supply a terminal working directory. PTYs are process-local, inherit an allowlisted environment, expire when idle, and are not persisted across server restarts. Git mutations require direct user actions and never run commands through a shell.

## Consequences

- HUE remains a Projects, Workflows, and Hermes Sessions product; panels are tools attached to a Project.
- Running HUE grants local shell capability to anyone who can access its terminal endpoint, so the production default remains `127.0.0.1`.
- Terminal sessions disappear on restart and are unsuitable for multi-replica hosting.
- Push authentication remains owned by the user's existing Git credential configuration.

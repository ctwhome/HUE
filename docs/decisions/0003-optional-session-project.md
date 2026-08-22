# Architecture Decision Record: optional Session project

- **Status:** Accepted
- **Date:** 2026-08-21
- **Owners:** Curi / HUE
- **Amends:** ADR-0002 Session ownership and composite route requirements

## Context

Hermes Sessions are useful for standalone discussions as well as project work. Requiring a Project before every Session adds organization work when no working-directory context is needed.

## Decision

A Session may belong to one Project or to no Project. This remains the same Session product object; “topic” is descriptive language, not a fourth object.

Projectless Sessions:

- start without a project-selection step;
- use HUE's private `~/.hue/sessions` directory as their Hermes working directory;
- use projectless Session routes and nullable delivery scope in HUE's database;
- retain the same complete-envelope, idempotency, serialization, replay, and unknown-delivery guarantees as project Sessions.

Project-scoped creation continues to use the selected Project directory and composite Project/Session routes. HUE still does not write Hermes persistence directly or grant ACP permissions silently.

## Consequences

- Starting a general Session no longer requires creating or choosing a Project.
- Projects remain useful, explicit organization and trust boundaries rather than mandatory folders.
- Workflows and project workbench tools remain Project-scoped.

# Focused implementation sequence

> **Status:** `ACTIVE`
> **Scope:** Projects, Workflows, Sessions, and accepted supporting surfaces

The former broad JSON issue roadmap has been removed because it described a superseded product. GitHub issues and accepted ADRs now track current work; this page records only the stable delivery order.

## Current sequence

1. Preserve Session delivery truth and Hermes ACP compatibility.
2. Harden Hermes-authoritative Projects and Projectless Session behavior.
3. Complete focused supporting surfaces already accepted by ADR: notifications, Excalidraw, and custom skill management. HUE-owned scheduled prompts are implemented.
4. Keep Project workbench tools bounded to trusted Project roots.
5. Verify accessibility, responsive behavior, backups/migrations, local authentication, and restart recovery before release.

## Scope discipline

Generic multi-agent orchestration, Areas, a global knowledge system, hosted sync, and additional execution runtimes are not implicit backlog. Adding a fourth product object or changing an authority boundary requires a new accepted ADR backed by a current need.

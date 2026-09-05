# Status and review protocol

> **Repository status:** `ACTIVE`
> **Product status:** `IMPLEMENTED IN PART`
> **Active boundary:** Projects, Workflows, and Sessions

HUE is an active SvelteKit/Bun implementation. The canonical product boundary is [ADR-0002](decisions/0002-bun-hermes-acp-workspace.md), as amended by later accepted decisions. Historical plans for a universal personal-agent operating system are not an implementation backlog.

## Current status

- Projects are Hermes-authoritative, profile-scoped, and may contain multiple folders.
- Workflows are HUE-owned reusable Project prompts and launch settings.
- Sessions are harness-owned conversations associated with a Project or explicitly projectless; Hermes is default and OpenCode is selectable at creation.
- HUE owns local organization, workbench state, and reliable message-delivery state.
- The selected ACP harness owns Session execution, mutation, and transcript persistence.
- Supporting panels may expose bounded Project tools and Hermes administration without becoming new product objects.
- Notifications, HUE-owned scheduled prompts, Project Excalidraw canvases, and the custom-skill filesystem exception are governed by focused ADRs.

## Evidence labels

| Label         | Meaning                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `TBD`         | A material choice is unresolved and must not be selected silently in code. |
| `SPEC`        | A reviewable behavior or boundary is documented.                           |
| `POC`         | A disposable experiment has produced evidence but is not production.       |
| `IMPLEMENTED` | Production code and focused automated checks exist.                        |
| `VERIFIED`    | The relevant canonical gates pass in a representative environment.         |
| `DEFERRED`    | Work is intentionally postponed with a stated revisit trigger.             |

## Review protocol

Review changes in this order:

1. Confirm they stay within Projects, Workflows, Sessions, or an accepted supporting-panel ADR.
2. Preserve complete-envelope submission, idempotency, per-Session serialization, cursor replay, and explicit unknown delivery.
3. Preserve the ownership boundary: no direct Hermes database writes and no silent ACP permission grants.
4. Require validation at browser/API trust boundaries and explicit confirmation for destructive operations.
5. Run the narrowest focused tests, then the applicable canonical Bun checks.

An implementation detail that changes ownership, product objects, persistence, permissions, or external delivery requires an accepted ADR before merge.

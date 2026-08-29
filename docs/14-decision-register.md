# Decision register

> **Status:** `CURRENT`
> This register lists every accepted architecture decision in `docs/decisions` and the remaining concrete open boundaries.

## Accepted decisions

| ADR | Decision | Effect |
| --- | --- | --- |
| [ADR-0001](decisions/0001-sveltekit-shadcn-svelte.md) | SvelteKit 5, Svelte 5, and HUE-owned component conventions | Canonical production frontend; static prototype retired. |
| [ADR-0002](decisions/0002-bun-hermes-acp-workspace.md) | Focused Bun/Hermes ACP workspace | Baseline Projects, Workflows, Sessions boundary and reliable delivery contract. |
| [ADR-0003](decisions/0003-optional-session-project.md) | Optional Session Project | Sessions may be explicitly projectless. |
| [ADR-0004](decisions/0004-project-development-panels.md) | Project development panels | Bounded terminal, Git, file, browser, and evidence tools are supporting surfaces. |
| [ADR-0005](decisions/0005-hermes-administration.md) | Hermes administration | Authenticated loopback `hermes serve` may support bounded administration. |
| [ADR-0006](decisions/0006-hermes-projects-authority.md) | Hermes Projects authority | Hermes owns Project identity and folders. |
| [ADR-0007](decisions/0007-portable-pwa-cache-and-share-boundary.md) | Portable PWA boundary | Defines installation, cache, launch, and share behavior. |
| [ADR-0008](decisions/0008-capacitor-android-native-shell.md) | Bounded Android shell proof | Retains the proven Android transport boundary without selecting production distribution. |
| [ADR-0009](decisions/0009-focused-notifications.md) | Focused notifications | Retains durable local attention and optional privacy-minimized Web Push. |
| [ADR-0010](decisions/0010-hermes-schedules-and-dedicated-sessions.md) | HUE-owned schedules and dedicated Sessions | Implemented: HUE owns cron state and dispatches every run through one dedicated projectless Session. |
| [ADR-0011](decisions/0011-retain-project-excalidraw.md) | Retain Project Excalidraw | Keeps the proven Project-scoped canvas as a workbench surface. |
| [ADR-0012](decisions/0012-custom-skill-filesystem-exception.md) | Custom skill filesystem exception | Permits narrowly hardened direct `SKILL.md` mutation where Hermes lacks an API. |

## Open boundaries

| Decision | Current constraint | Revisit trigger |
| --- | --- | --- |
| Production Android distribution and remote access | ADR-0008 is a proof boundary only. | A release channel and threat model are selected. |
| Clarify over Hermes ACP | Unsupported until Hermes exposes and proves ACP elicitation. | An installed Hermes version advertises and passes the required bridge tests. |
| Additional runtimes or product objects | Outside the focused product. | Repeated real use justifies a focused ADR. |

## ADR workflow

Create `docs/decisions/NNNN-title.md` from the template. Record context, evidence, decision, ownership, consequences, hardening requirements, and revisit triggers. The docs site derives ADR pages and routes from that directory; no second navigation list is required in the site generator.

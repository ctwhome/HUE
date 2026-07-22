# Architecture Decision Record: SvelteKit frontend and shadcn-svelte component foundation

- **Status:** Accepted
- **Decision ID:** TBD-020
- **Date:** 2026-07-22
- **Owners:** Curi / HUE
- **Related issues:** HUE-002, HUE-054
- **Supersedes:** React-versus-Svelte frontend choice in the original TBD-020 option set

## Context

HUE needs a dense, reactive workspace UI for Spaces, Sessions, tasks, approvals, notifications, artifacts and live execution. The frontend must support desktop and responsive surfaces, remain understandable to contributors, and avoid coupling product identity to a component vendor.

The current interactive prototype is intentionally plain HTML, CSS and JavaScript. It is useful for rapidly validating information architecture and functional flows, but it must establish a visual and component contract that can be migrated without redesigning every screen.

## Decision question

Which frontend framework and accessible component foundation should HUE standardize on, and how should the static prototype relate to that future implementation?

## Constraints and decision criteria

- HUE owns the product model, screen composition, tokens and component APIs.
- The UI must handle frequent local state changes without excessive framework ceremony.
- Keyboard, focus, screen-reader and touch behavior are release requirements.
- Desktop packaging, native integration and control-plane implementation remain separate decisions.
- The prototype must remain fast to change while product flows are still being validated.
- A later framework conversion must not require a second visual redesign.

## Options considered

### React + shadcn/ui/Radix

Large ecosystem, mature primitives and broad contributor familiarity. The cost is more state and composition ceremony for HUE's highly reactive workspace, plus no decisive benefit for Tauri or local-system integration.

### SvelteKit + shadcn-svelte

Concise reactive components, strong fit for a local application and a clean path to a responsive web/PWA companion. shadcn-svelte provides source-owned accessible primitives while allowing HUE to own wrappers and styling.

### Fully custom primitives

Maximum control but unnecessarily repeats difficult dialog, menu, focus, sheet, command and accessibility work. This option creates avoidable maintenance risk.

## Experiments/evidence

- The existing static prototype covers eleven representative HUE screens and exposes the component vocabulary needed by the product.
- HUE development already has working SvelteKit/Svelte 5/Bun quality-gate experience.
- The prototype's design layer can express shadcn-compatible CSS variables and component anatomy without introducing a temporary React or Svelte runtime.
- Tauri supports either frontend; React provides no unique native-integration advantage for this product.

## Decision

Use **SvelteKit with Svelte 5** for HUE's product frontend and **shadcn-svelte** as the source-owned accessible primitive foundation.

HUE owns:

- semantic design tokens;
- component wrapper APIs;
- typography, density, spacing, motion and state language;
- screen composition and product-specific patterns.

Product screens must import HUE components rather than low-level shadcn-svelte primitives directly.

Keep the current prototype as dependency-free HTML/CSS/JavaScript until its functional flows stabilize. Its visual layer uses the same token names, variants and component anatomy intended for the Svelte implementation. Conversion happens later, screen by screen, without changing the product contract.

This ADR resolves **TBD-020** and the frontend-framework portion of **TBD-001**. It does **not** decide whether the application is packaged with Tauri, delivered as browser/PWA plus daemon, or uses another shell; that packaging decision remains TBD-001.

## Consequences

### Positive

- One frontend direction replaces parallel React/Svelte possibilities.
- Less boilerplate for live task, notification and inspection state.
- Accessible source-owned primitives avoid a bespoke widget toolkit.
- Static prototype work remains fast and directly informs future components.
- HUE's identity stays independent of stock shadcn styling.

### Negative/trade-offs

- React-only libraries require adapters or alternatives.
- The static prototype cannot literally import shadcn-svelte; it can only implement the agreed token and anatomy contract.
- The later migration still requires real Svelte components, interaction tests and accessibility verification.

### Risks and mitigations

- **Risk:** prototype CSS drifts from future components. **Mitigation:** maintain a component mapping and token contract beside the prototype.
- **Risk:** screens import primitives directly. **Mitigation:** enforce a HUE component boundary and lint/review imports.
- **Risk:** stock shadcn aesthetics become the product identity. **Mitigation:** preserve HUE tokens, restrained composition and domain-specific states.

## Implementation contract

The target stack is:

- SvelteKit + Svelte 5;
- TypeScript;
- shadcn-svelte accessible primitives;
- HUE-owned components and CSS-variable tokens;
- Bun-based development and verification.

The static prototype must:

- remain dependency-free and functional;
- use shadcn-compatible semantic token names;
- document each prototype pattern's future HUE/Svelte component;
- preserve visible `TBI`/`TBD` honesty;
- pass desktop and mobile browser checks.

## Migration and rollback

Create the SvelteKit application only after the functional prototype has sufficient product coverage. Port tokens first, then shell/navigation, then primitive components, then one screen at a time. Keep the static prototype as a visual/behavior fixture until parity is proven.

Reversing the framework decision before persistent UI state exists requires replacing the component layer but no user-data migration. After production components exist, reversal requires an explicit superseding ADR and parity plan.

## Revisit triggers

- A required platform capability cannot be delivered reliably through SvelteKit/Tauri or the selected browser shell.
- shadcn-svelte loses accessibility or maintenance viability.
- A concrete React-only dependency provides critical product value with no practical adapter.
- Measured performance on representative HUE execution streams fails agreed budgets.

## Documentation/status updates

- `docs/04-ui-specification.md`
- `docs/14-decision-register.md`
- `prototype/README.md`
- `roadmap/issues.json` (`HUE-002`, `HUE-054`)

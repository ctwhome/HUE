# HUE interactive prototype

The prototype is deliberately dependency-free HTML, CSS and JavaScript while HUE's product flows are still changing. It is not the production frontend.

The accepted frontend target is **SvelteKit + Svelte 5 + shadcn-svelte**, documented in [`decisions/0001-sveltekit-shadcn-svelte.md`](../decisions/0001-sveltekit-shadcn-svelte.md). The static prototype now mirrors that target's semantic tokens, variants and component anatomy so conversion can happen later without another visual redesign.

## Files

- `index.html` — screen fixtures and semantic component anatomy
- `styles.css` — legacy screen layout and responsive geometry
- `shadcn.css` — HUE's shadcn-compatible token/visual layer
- `workspace-shell.css` — persistent Space rail → Session sidebar → main-window composition
- `app.js` — dependency-free prototype interactions and Space-scoped Session fixtures

`shadcn.css` is not the stock shadcn theme and does not claim to run shadcn-svelte. It is the static expression of the accepted HUE component contract.

## Component migration map

| Static prototype pattern | Future HUE component | shadcn-svelte foundation |
|---|---|---|
| `.primary-button`, `.quiet-button`, `.danger-quiet`, `.icon-button`, `.text-button` | `HueButton` variants | Button |
| `.state-chip`, `.label-tbi`, `.risk-badge`, `.route-pill`, `.running-pill` | `StatusBadge`, `RiskBadge` | Badge |
| `.project-rail`, `.space-nav-item` | `SpaceRail`, `SpaceRailItem` | Sidebar / Tooltip |
| `.session-sidebar`, `.session-item`, `.session-search` | `SessionSidebar`, `SessionListItem` | Scroll Area / Input / Tooltip |
| `.pane-backdrop`, `.mobile-bottom-nav` | `ResponsiveWorkspaceNavigation` | Sheet |
| `.inbox-tabs`, `.memory-tabs`, `.segmented` | `HueTabs` | Tabs |
| `.plain-section`, `.wide-block`, `.context-block`, `.delivery-card` | domain section components | Card only where object boundaries are real |
| `.filter-row input`, `.command-input`, `.composer-box` | `HueInput`, `SessionComposer` | Input / Textarea |
| `dialog`, `.command-results` | `WorkerDialog`, `CommandPalette` | Dialog / Command |
| `.toast` | `HueToast` | Sonner |
| mobile Space/Session drawers and future inspectors | `ResponsiveWorkspaceNavigation`, `InspectorSheet` | Sheet |
| `.outcome-table`, `.delivery-list`, `.file-tree` | domain data views | Table / Scroll Area where appropriate |
| `.approval-scope` | `ApprovalScopePicker` | Radio Group |

## Token contract

The static layer and future Svelte implementation share these semantic groups:

- surfaces: `--background`, `--card`, `--popover`, `--muted`;
- text: `--foreground`, `--muted-foreground`;
- action: `--primary`, `--primary-foreground`, `--secondary`, `--accent`;
- structure: `--border`, `--input`, `--ring`, `--radius`;
- product state: `--success`, `--warning`, `--destructive`, `--decision`, `--info`;
- shell geometry: `--project-rail-width`, `--project-rail-collapsed-width`, `--session-sidebar-width`, `--content-max`, `--topbar-height`.

Screens may use product-semantic tokens; they must not bind themselves to low-level library internals.

## Projection and link contract

Canonical Markdown and prototype files use repository-relative source links. `scripts/prepare_site.py` rewrites those links to their generated Starlight routes when it copies the prototype and documentation into the public site. Source files must not embed deployment-only `/HUE` routes, and generated content must not become a second source of truth.

## Conversion sequence

1. Create the SvelteKit/Svelte 5 shell and install shadcn-svelte.
2. Port the tokens and typography unchanged.
3. Implement HUE wrapper primitives and interaction tests.
4. Port the persistent `SpaceRail` → `SessionSidebar` → main-window shell, responsive drawers and command palette.
5. Port one representative vertical slice: Home → task → approval → notification → artifact.
6. Compare static and Svelte fixtures at desktop and 390px mobile.
7. Retire static screens only after behavioral and accessibility parity.

## Local preview

From the repository root:

```bash
bun run dev
```

Alternatively, serve the **repository root** with a static server and open `/prototype/`; this preserves the prototype's repository-relative documentation links. All interactions remain mock-only and must not perform external side effects.

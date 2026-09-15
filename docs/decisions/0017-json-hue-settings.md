# ADR-0017: HUE settings in one editable JSON file

- **Status:** Accepted
- **Date:** 2026-09-15
- **Owners:** Curi / HUE

## Decision

HUE preferences and saved workspace layouts use `~/.hue/settings.json` as their authoritative store. When an installation overrides `HUE_DATABASE_PATH` with a filesystem path, settings live beside that database so isolated installations and tests do not share preferences.

Existing controls edit the file through HUE's authenticated settings API. App Settings and the Project file explorer both expose **Edit settings.json**, including when no Project is selected through App Settings. The editor targets this one file; it does not widen Project filesystem access.

JSON contains native values and two-space indentation, grouped by preferences, notification behavior, shell, Project tools, ordering, Session panes, chat backgrounds, and remembered Session/commit choices. Valid external edits are picked up by visible clients within the next two-second poll and on window focus. Changes apply without reloading the workspace or discarding drafts.

## Ownership and safety

- Hermes and OpenCode retain their own configuration and execution authority.
- Project/Workflow/Session records, transcripts, schedules, notification records, and delivery state remain in their existing authoritative stores. They are product data, not preferences.
- Browser permission grants, notification device/subscription identity, unsent drafts, capture drafts, and navigation history stay device-local. JSON cannot grant browser or ACP permissions.
- Settings mutations require authenticated access and a same-origin request. No caller supplies a filesystem path.
- Saves validate preferences and JSON shape, write a private temporary file, then atomically rename it. Whole-file editor saves require the original content revision; control updates compare the edited setting's original value before merging into the latest file.
- Invalid external JSON is left untouched and reported. The JSON editor can read the raw file and repair it. Conflicting saves preserve the user's editor text for review and retry.
- Browser-local preference storage is replaced directly; there is no silent import from an arbitrary browser into the shared settings file.

## Consequences

Users can inspect, edit, copy, and back up their HUE customization with a normal file editor. Controls remain convenient editors of the same configuration. Layout preferences are shared across devices, with each viewport retaining its existing size limits. System theme selection still follows each device's system appearance.

## Verification

`app/src/lib/server/settings.test.ts` covers disk persistence, validation, external edits, and stale-save protection. `app/src/routes/settings.e2e.ts` exercises controls, the JSON editor, invalid JSON, external edits, and synchronization to another browser.

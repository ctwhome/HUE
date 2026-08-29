# Architecture Decision Record: custom skill filesystem ownership exception

- **Status:** Accepted
- **Date:** 2026-08-28
- **Owners:** Curi / HUE
- **Exception to:** ADR-0005 API-only Hermes administration

## Context

Hermes exposes skill inventory and some mutations through authenticated APIs but does not expose a complete custom-skill content and deletion API. HUE's skill editor therefore cannot remain functional without a direct filesystem seam. This exception must not become permission to edit arbitrary Hermes internals.

## Decision

HUE may directly read, replace, and delete only a custom skill's `SKILL.md` beneath the selected profile's canonical Hermes skills root.

The boundary must:

- accept only a bounded simple skill name and locate the declared matching skill beneath the canonical root;
- skip hidden entries and symlinks and reject any canonical path outside the root;
- classify hub and bundled ownership from Hermes manifests and keep those skills read-only;
- bound content to 1 MB, reject NUL bytes, and require the declared name to remain unchanged;
- replace content atomically with a temporary sibling while preserving file mode;
- limit mutation routes to same-device access and redact returned errors;
- require the exact skill name before recursive deletion and delete only the containing custom-skill directory.

This exception does not permit editing linked files, manifests, profile configuration, credentials, Hermes databases, hub/bundled skills, or any path outside the skill directory. HUE must prefer a Hermes authenticated API when one provides equivalent validated behavior.

## Consequences

- Custom skill editing remains available without pretending Hermes currently owns the mutation API.
- HUE owns the path-containment, provenance, atomicity, and destructive-confirmation risk for this seam.
- Filesystem layout changes can disable the feature rather than trigger a permissive fallback.

## Revisit triggers

- Hermes provides authenticated custom-skill content and deletion APIs with equivalent validation.
- Hermes changes profile skill roots or ownership manifests.

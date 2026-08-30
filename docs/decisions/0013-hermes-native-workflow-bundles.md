# Architecture Decision Record: Hermes-native Workflow bundles

- **Status:** Accepted
- **Date:** 2026-08-30
- **Owners:** Curi / HUE
- **Amends:** ADR-0002 and ADR-0005

## Context

HUE Workflows previously stored a HUE `work_mode` default even though reusable capability composition belongs to Hermes. Hermes skill bundles already model a named set of skills plus optional instructions, while HUE needs only Project organization, a starting prompt, and reliable delivery.

Hermes v0.20.6 does not ship authenticated bundle CRUD or ACP bundle activation. HUE cannot expand skill files into prompts without duplicating Hermes-owned content and exposing implementation scaffolding in transcripts.

## Decision

Workflow definitions store only the selected profile-scoped Hermes bundle slug. Hermes owns bundle names, descriptions, instructions, skill membership, skill content, and activation. HUE may feature and organize Workflows, but it does not persist bundle definitions or skill content.

HUE uses authenticated, profile-scoped `bundles.list`, `bundles.get`, `bundles.create`, `bundles.update`, and `bundles.delete` RPC methods. Workflow execution submits one complete `/<bundle-slug> <prompt>` envelope through the existing dispatcher. Hermes expands the bundle only for model input while persisting and replaying the original user-visible command.

The editor may reference every enabled Hermes skill and read its bounded content. Existing provenance rules remain authoritative: custom skills are editable and deletable, while Hermes-bundled and hub-installed skills are read-only. Removing a skill from a bundle never deletes the skill.

Schema version 6 additively migrates legacy Workflow `work_mode` values to stable bundle slugs (`autonomous` or `live`) and retains the old column as inert migration history. Session-level cadence state is unchanged by this decision. Missing or externally deleted bundles block Workflow execution before Session creation.

Until upstream Hermes provides equivalent behavior, HUE depends on the narrow local Hermes patch recorded in `AGENTS.md`. HUE must not parse bundle YAML, invoke a broad CLI executor, or inject copied skill content as a fallback.

## Consequences

- Users edit one Hermes-authoritative bundle and its underlying permitted skills from the Workflow editor.
- Bundle rename and deletion can leave HUE references unavailable; stable slugs and run-time validation make this explicit.
- Existing `live` and `autonomous` Workflow defaults require matching Hermes bundles before they can run.
- Hermes updates require capability verification until the local patch lands upstream.

## Revisit triggers

- Upstream Hermes exposes compatible authenticated bundle CRUD and ACP activation.
- Hermes defines a stable ACP bundle field that replaces slash-command invocation.
- Session-level cadence controls are removed or replaced separately.

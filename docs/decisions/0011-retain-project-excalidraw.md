# Architecture Decision Record: retain Project Excalidraw

- **Status:** Accepted and implemented
- **Date:** 2026-08-28
- **Owners:** Curi / HUE
- **Extends:** ADR-0004

## Context

The production workbench includes a Project-scoped Excalidraw canvas alongside browser previews. It is useful retained functionality with API, migration, UI-contract, and browser coverage; deleting it solely because it is not one of the three product objects would discard proven work.

## Decision

Retain Excalidraw as a Project workbench surface, not a product object. HUE stores the Project canvas scene and related workbench state in HUE SQLite. The canvas is lazy-loaded through its bounded React adapter so the main workspace does not eagerly load the Excalidraw bundle.

Embeddable browser previews remain untrusted and subject to normal framing restrictions. Excalidraw does not expand filesystem, network, Hermes, or Project authority.

## Evidence

- API tests cover canonical Project scene reads and partial updates.
- Migration tests cover valid legacy browser state moving to SQLite.
- UI-contract and Playwright coverage exercise lazy loading, Project isolation, persistence, responsive controls, and browser/Excalidraw tab behavior.

## Consequences

- React and `@excalidraw/excalidraw` remain justified production dependencies behind one adapter.
- Canvas persistence follows HUE backup and migration requirements.

## Revisit triggers

- The dependency becomes unmaintained, unsafe, or measurably harms startup despite lazy loading.
- Real usage no longer justifies its maintenance cost.

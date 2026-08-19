# ADR-0002: Implementation language is TypeScript

- **Status:** Accepted
- **Date:** 2026-06-20

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **TypeScript** (Node, pnpm workspaces) for everything: control plane, workers, scheduler, connectors, UI.
- The runtime is pure TS/JS — no shell-out engines remain (ADR-0019 update); esbuild bundles the appliance.

> **Update 2026-08-02:** the "engines are invoked via shell-out" half of this
> decision is dead — the wrappers were deleted 2026-07-30 and all four domains
> run in pure TypeScript (see ADR-0019's update note). The language decision
> itself came out STRONGER: TypeScript now covers the transfer path too, and
> "no single static binary" stopped being a consequence (esbuild bundles the
> appliance; ADR-0027/0028).

## Context
The project is built with a coding agent (OpenHands) and must integrate Trigger.dev, Microsoft Graph, and WebDAV/CalDAV/CardDAV libraries. Heavy data movement is delegated to external engine binaries.

## Decision
Use **TypeScript (Node, pnpm workspaces)** for the control plane, workers, scheduler, connectors, and UI. Engines (imapsync/rclone/vdirsyncer) are invoked via shell-out.

## Consequences
- First-class SDKs: Trigger.dev, `@microsoft/microsoft-graph-client` + MSAL, `webdav`/`tsdav`.
- Strong agent ergonomics and typing.
- No single static binary, but self-host ships as a container, so this is moot.

## Alternatives considered
- Go: better single-binary self-host, weaker fit for the chosen orchestrator/SDKs and agent workflow.
- Python: rich libs, but TS preferred for the unified stack + UI.

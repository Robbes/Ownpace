# ADR-0007: Reuse proven engines + a Graph rich extractor; no commercial SharePoint tools

- **Status:** Accepted
- **Date:** 2026-06-20

## Context
We want high-fidelity, idempotent transfer without reinventing sync, and "as complete as possible" extraction from OneDrive/SharePoint — but the destination (Nextcloud) is not a SharePoint clone.

## Decision
Shell out to **imapsync** (mail), **vdirsyncer** (cal/contacts), **rclone** (files). Build a custom **Microsoft Graph extractor** for the rich layer (versions, permissions, metadata, lists, pages); optionally use **PnP** (MIT) for deep SharePoint structure and **libpst** for PST archives. **Do not** use Metalogix/ShareGate/AvePoint/MetaVis (closed, costly, SharePoint->SharePoint oriented, wrong fit). See solution-architecture.md section 13.1.

## Consequences
- Less code, proven idempotency; open-source throughout.
- "Complete" = extract everything of value and land it sensibly; inventory + flag what cannot map.

## Alternatives considered
- Commercial SP migration suites: rejected (closed, costly, wrong destination).
- Reimplementing sync engines: rejected (cost/risk).

## Update 2026-08-02 — the rich extractor is retracted for now

Both halves of this ADR have since moved:

- **The shell-out engines are gone** — ADR-0019's update note records that
  the runtime is pure JavaScript; imapsync/vdirsyncer/rclone were replaced
  by our own JS-native connectors. The "reuse proven engines" half is
  history, not guidance.
- **The rich extractor was never built** (0026 T3 row 3, owner decision
  2026-08-02: retract for now). Zero code exists for `/versions`,
  `/permissions`, lists or pages, and the targets cannot cleanly receive
  most of that layer — a built extractor would mostly produce reports, not
  migrated data. The scope manifest now lists SharePoint extras under
  *does not migrate* (files and folders migrate; the rich layer does not),
  instead of a "best-effort" promise with no effort behind it. SAD §13.1
  carries the same dated note and keeps the design sketch for if SMB
  demand reopens this. The **"no commercial SharePoint tools"** decision
  stands unchanged.

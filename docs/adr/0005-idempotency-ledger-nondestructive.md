# ADR-0005: Idempotency via a ledger; non-destructive by default

- **Status:** Accepted
- **Date:** 2026-06-20

> **Update 2026-08-02:** "deletions are never auto-propagated" still holds —
> and [ADR-0024](./0024-explicit-owner-deletion-apply.md) records the ONE
> deliberate, gated exception built since: `apply`, an explicit per-item owner
> decision behind seven gates. Nothing automatic changed; read 0024 before
> touching anything on that path.

## Context
Migrations must be safely re-runnable and able to shadow-run indefinitely without duplicates or data loss.

## Decision
Maintain a **ledger** keyed on stable natural keys (mail: Message-ID; cal/tasks: iCal UID + RECURRENCE-ID; contacts: vCard UID; files: path + checksum) plus content hashes. Reconcile loop decides create/update/skip/delete. **Deletions are never auto-propagated** to the target; they surface as user decisions. Mailbox identity tracked by immutable Graph GUID so renames are updates, not delete+create. See solution-architecture.md sections 9-11.

## Consequences
- Re-runs converge; shadow-run is cheap via deltas.
- Target may become a fuller archive than the shrinking source (a feature).
- Requires idempotency property tests.

## Alternatives considered
- Stateless copy: rejected — not idempotent, risks duplicates.

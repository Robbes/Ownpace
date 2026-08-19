# ADR-0015: Backup scope — stack DR vs end-user data vs optional extra backup

- **Status:** Accepted; the **"optional user-controlled extra backup" bullet is RETRACTED 2026-08-02** (owner decision, workplan 0021 T5) — the other two bullets stand
- **Date:** 2026-06-20

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **Stack DR is ours** (control plane + ledger); **end-user data durability is the target's** — never duplicated by default.
- The opt-in extra-backup feature is **retracted** (2026-08-02): a second instance/mapping achieves the same through tested machinery. `backup_target` stays as reserved schema.

> **Retraction note (2026-08-02).** The opt-in extra-backup feature was never
> built — `backup_target` sat in the schema with nothing reading or writing
> it. The owner's rationale for retracting rather than parking: **a second
> open-migrate instance (or a second mapping) pointed at a destination of
> your choice achieves exactly the same result** through the existing,
> tested, idempotent machinery — a dedicated backup feature would be a
> second UI over the same engine, not a new capability. The `backup_target`
> table stays as reserved schema (dropping it would be a destructive
> migration for nothing; the Atlas `migration-lint` job guards any future
> drop). The first two bullets — stack DR is ours, end-user data durability
> is the target's — are unchanged and remain documented practice
> (runbook/quickstart backup sections, ADR-0020's reindex recovery).

## Context
"Backup" is ambiguous. Targets are mature services that handle their own durability; we must not duplicate that by default, but some users may want an extra copy.

## Decision
- **Stack DR (our responsibility):** back up the managed control plane + ledger so the service can be restored. Self-host users back up their own (small) ledger/config; we document how.
- **End-user data durability:** the **target's** responsibility (mature EU/CH providers). Not duplicated by default.
- **Optional user-controlled extra backup:** because the copy engine is idempotent, users may opt in to push a copy to a **destination of their choice** (own object storage, another EU provider, or local), independent of the primary target. Off by default.

## Consequences
- Clear separation; no redundant data handling by default.
- The optional backup reuses the export/portability engine (a §15 benefit).

## Alternatives considered
- Always back up user data ourselves: rejected — duplicates the target, raises cost and data exposure.

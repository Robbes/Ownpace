# ADR-0020: The ledger is a rebuildable cache — recovery via target reindex (natural-key adoption)

- **Status:** Accepted — **amended 2026-09-27**: the operative rules say what is built. The reindex is the worker's command in both editions, run by hand; the appliance warns at start-up; nothing runs it automatically (workplan 0134 T3). See the amendment at the end.
- **Date:** 2026-06-21
- **Relates to:** ADR-0005 (idempotency via ledger, non-destructive), ADR-0015 (backup scope), ADR-0016 (ledger schema), ADR-0018 (JMAP/DAV targets).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- The ledger is a **rebuildable cache + audit log**, never the source of truth for existence — that fact lives on the target via natural keys.
- Writes are **create-if-absent by natural key** (target existence check beside the ledger fast-path); an empty ledger can never duplicate.
- **Reindex/adopt** rehydrates the ledger from the target. It is the worker's command in both editions (`reindex --tenant <t> --mapping <m> --yes`), run by hand, and nothing runs it automatically: the appliance warns at start-up when an active migration's ledger is empty, and the managed edition does not. Content-hash fallback for Message-ID-less items; cursors are non-authoritative; backups are the fast path, not the safety net.

## Context
A self-host user can lose their install (disk failure, no backup) and **reinstall fresh with an empty ledger**, pointing at the same O365 source and the same target. If migration relied solely on the local ledger to know what was already migrated, a fresh install would re-copy everything and risk **duplicating** it on the target. Correctness must survive ledger loss.

## Key insight
The idempotency anchor — the **natural key** — is intrinsic to each item and is **preserved on the target**: Message-ID (mail), iCal `UID` + `RECURRENCE-ID` (calendar), vCard `UID` (contacts), file path + content hash (files). So "what already exists" is a fact stored on the **target**, not only in the local ledger. The ledger is therefore a **cache + audit log**, not the source of truth for existence.

## Decision
1. **Anchor idempotency on the natural key carried by both source and target**, not on local-ledger survival (reinforces ADR-0005).
2. **Writes are create-if-absent by natural key.** Each `TargetWriter` checks the target for the natural key before creating — JMAP `Email/query` on header `Message-ID`; IMAP `SEARCH HEADER Message-ID`; CalDAV/CardDAV by `UID`; WebDAV by path — **in addition to** the ledger fast-path. An empty ledger can then never cause duplicates; at worst it costs extra existence lookups.
3. **Reindex / adopt command** ("rehydrate the ledger from the target"): enumerate the target's existing items, harvest natural keys → target ids (+ content hashes), and repopulate the ledger as already-present. **Auto-run when the ledger is empty but the target is non-empty** (detected on startup); also expose it on demand. Subsequent passes are then fast and local state matches reality.
4. **Content-hash fallback.** For items lacking a Message-ID (or targets that rewrite it), match on `content_hash` (normalized RFC822 / item bytes), which the ledger already stores. This also defines the natural key for Message-ID-less mail: synthesize from `content_hash` + `Date` + `From`.
5. **Cursors are non-authoritative.** A lost incremental cursor (IMAP `UIDVALIDITY`/`UIDNEXT`, JMAP state) merely forces a full re-scan on the next pass — still idempotent, just slower once.
6. **Backups are the fast path, not the safety net.** Backing up the small ledger (self-host state, ADR-0015) makes recovery instant; the reindex makes loss *survivable* when no backup exists. Correctness never depends on the backup.

## Optional enhancement
Mark items we wrote with a **non-destructive, client-invisible target-side marker** — a custom JMAP/IMAP keyword (e.g. `$openmig`) or a per-mapping keyword — so reindex can unambiguously distinguish "migrated by us" from "natively created on the target" without parsing headers. Metadata-only (a keyword), so it stays within the non-destructive rule. **Off by default / opt-in**, since it mutates target metadata.

## Consequences
- Losing the ledger means "rebuild the index from the target," not "duplicate everything."
- The `TargetWriter` contract gains a natural-key existence check — cheap on JMAP; a one-time bulk header fetch on IMAP. Reindex is O(N) over target items (headers/UIDs/paths only) — page it for large accounts; it is a recovery/maintenance op, not the hot path.
- Pre-existing duplicates on the target (from an earlier botched run) collapse to one mapping per natural key in the rebuilt ledger and are surfaced as **drift**; non-destructive means we never auto-delete them — they remain a user decision (§11.1).
- Requires verifying, **per target**, that import preserves the Message-ID/`UID` (JMAP import and IMAP `APPEND` do) — a per-provider check.

## Alternatives considered
- **Ledger-only (rely on local state / backups):** rejected — a lost ledger would duplicate everything; backups alone are not a correctness guarantee.
- **Always full re-copy and let the target dedupe:** rejected — most targets do not dedupe by Message-ID on `APPEND`/import, so this produces duplicates.
- **Marker-only (no natural-key match):** rejected as the primary mechanism — fails for items migrated before the marker existed or by other tools; kept only as an optional optimization.

## Amendment, 2026-09-27: what is built, not what was planned (workplan 0134 T3)

Decision 3 said the reindex *"auto-runs when the ledger is empty but the target is non-empty
(detected on startup)"*, and the operative rule repeated it. It was never built that way: 0026 T1
item 5 built the command and a warning, not an automatic run.

- The reindex is the worker's command-line tool, `reindex --tenant <t> --mapping <m> --yes` in
  `apps/worker/src/cli/index.ts`, run on the host with the database URL and the key, in both
  editions. No API route or screen offers it.
- The appliance warns at start-up when an active migration has an empty ledger, and names the
  command (`lostLedgerWarning` in `apps/selfhost/src/index.ts`).
- The managed edition neither warns nor runs it.

A lost ledger still duplicates nothing, because a pass adopts what the target already holds
(decision 2). The operative rule above now says what is built. Decision 3 stays as written: an
automatic run would be a later decision's to build.

**The ledger is a rebuildable cache; the database it lives in is not.** On the managed edition the
same database holds the organisations, their connections and stored credentials, the migrations
and the audit log, and no target rebuilds those. The migration runner's downgrade refusal said
*"nothing irreplaceable lives here"*. It now says that a database holding real data is restored
from a backup, never dropped (`packages/ledger/src/migrate.ts`).

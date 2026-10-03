# ADR-0020: The ledger is a rebuildable cache — recovery via target reindex (natural-key adoption)

- **Status:** Accepted — amended twice: 2026-09-27 (the reindex is run by hand, workplan 0134
  T3) and 2026-10-03 (the key of mail without a Message-ID is a hash of the message normalised,
  with a lookup by its old key). See the amendments at the end.
- **Date:** 2026-06-21
- **Relates to:** ADR-0005 (idempotency via ledger, non-destructive), ADR-0015 (backup scope), ADR-0016 (ledger schema), ADR-0018 (JMAP/DAV targets).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- The ledger is a **rebuildable cache + audit log**, never the source of truth for existence:
  that fact lives on the target, by natural key (*Key insight* below).
- Writes are **create-if-absent by natural key** (a target existence check beside the ledger
  fast-path), so an empty ledger can never duplicate: `packages/core/src/reconcile.unit.test.ts`.
- **Reindex/adopt** rehydrates the ledger from the target. It is the worker's command in both
  editions (`reindex --tenant <t> --mapping <m> --yes`, `apps/worker/src/cli/index.ts`), run by
  hand, and nothing runs it automatically: the appliance warns at start-up when an active
  migration's ledger is empty (`apps/selfhost/src/lost-ledger-warning.unit.test.ts`), and the
  managed edition does not.
- **Mail without a Message-ID is keyed by a hash of the message normalised** (owner,
  2026-10-03), written into the copy as a generated `Message-ID`; a copy made under the old
  raw-bytes key is found by it, never copied again
  (`a-key-that-changed-how-it-is-made.unit.test.ts`). Graph leaves such mail unmigrated.
- **Cursors are non-authoritative**; **backups are the fast path, not the safety net** (decisions
  5–6 below).

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

## Amendment, 2026-10-03: the key of mail without a Message-ID, as built, and what still has to be checked

Decision 4 said the natural key of mail without a Message-ID is *"synthesize[d] from
`content_hash` + `Date` + `From`"*, where `content_hash` is *"normalized RFC822 / item bytes"*. It
was built otherwise, and the architecture document described a third version (*"hash of
normalised headers+body"*, §10). The owner chose to record what is built: *"A. But we have to
validate the behaviour of Microsoft 365 or we should go with C."*

**What holds** (`packages/shared/src/generated-message-id.ts`, `packages/core/src/reconcile.ts`):

- A message without a `Message-ID` is keyed by the **SHA-256 of its raw bytes as the source
  returns them**, headers and body, nothing left out. `Date` and `From` count because they are
  part of those bytes. The key is written into the copy as a generated
  `Message-ID: <hex@generated.openmigrate.invalid>`, so the target's own existence check
  (decision 2) and a reindex (decision 3) find it again.
- `content_hash` hashes the bytes as written, and no matching of mail uses it.
- The same bytes give the same key on every pass and on every machine, and a message in two
  folders is one copy. Two different messages with identical bytes are one copy too, losing
  nothing.
- **IMAP sources do this, Gmail's included. The Graph source does not:** it counts a message
  without an `internetMessageId`, logs it, and leaves it unmigrated (`graph-mail-source.ts`). The
  preflight says so before *Start*: such a message is counted as left behind (`unlisted`, shown
  as *will not be migrated*), apart from the generated-id count, where it had been counted until
  this amendment.

**What has to be checked: Microsoft 365.** A server that keeps a message's original bytes (Gmail,
Dovecot) returns the same bytes on every fetch. Exchange builds the MIME of a message when it is
asked for it, so after an upgrade or a restore it may return other bytes: other boundaries, header
order or line endings. If it does, the key changes and the message is copied a second time. The
check is to fetch the same messages from a Microsoft 365 mailbox over IMAP more than once, over
time, and compare their hashes.

**If they differ, the key becomes a normalised hash** (the owner's *C*): headers that servers add
or rewrite are left out and line endings unified before hashing, with a lookup by the old key so
that nothing already copied is copied again, because every copy carries the old key in its
`Message-ID`. Normalising too far would make two different messages one, which is what `Date` and
`From` were in decision 4 to prevent. Re-keying to decision 4's own formula was not chosen: it
copies every such message again for no gain.

**Built the same day, without waiting for the check** (the owner: *"go with C, we can test with
some imap access to microsoft i will arrange"*). `generateMessageId` hashes `keyMaterial`:

- the sender's own headers only (`Date`, `From`, `Sender`, `Reply-To`, `To`, `Cc`, `Subject`,
  `In-Reply-To`, `References`), unfolded, in a fixed order, their whitespace collapsed;
- the body with line endings unified, every MIME boundary replaced by its order of appearance,
  and trailing whitespace dropped;
- read as latin1, so the key stays a function of the bytes whatever their charset.

Nothing is decoded: a server that re-encodes a part (quoted-printable for 8-bit, say) still changes
the key, and the Microsoft 365 check is what says whether that happens.

**The old key is asked before anything is written.** When the normalised key finds no row, the
pass looks up the raw-bytes key (`legacyNaturalKeysFromRaw`, from the bytes the source served with
the id it prepended taken off), and a hit is that row, handled under its own key. Without it, the
switch itself would have copied every such message again: the target's copy carries the old id, so
its own existence check cannot see it either. One case stays open: a copy made before the switch
whose source then serves other bytes matches neither key, and is copied once more. After that it
carries the normalised key.

`a-key-that-changed-how-it-is-made.unit.test.ts` pins all three: a pass served other bytes finds its
copy; a message copied under the old key is not copied again; and without the lookup it would be.
`generated-message-id.unit.test.ts` pins what the key ignores and what still tells two messages
apart.

## Amendment log

- **2026-09-27** — The operative rules say what is built: the reindex is the worker's command in
  both editions, run by hand; the appliance warns at start-up; nothing runs it automatically
  (workplan 0134 T3). Record: *Amendment, 2026-09-27: what is built, not what was planned*.
- **2026-10-03** — Operative rules cut to the [ADR-0051](./0051-an-adr-reads-as-it-stands.md) budget; nothing was
  decided. Their earlier wording, with the reasons and examples the budget left out, is in the
  record: [history/0020-ledger-rebuildable-cache-recovery.md](./history/0020-ledger-rebuildable-cache-recovery.md).
- **2026-10-03, later** — Decision 4's key for mail without a Message-ID says what is built, a
  SHA-256 of the raw bytes; to be checked on Microsoft 365, and normalised if its bytes change
  (owner: *"A. But we have to validate the behaviour of Microsoft 365 or we should go with C."*).
  Record: *Amendment, 2026-10-03: the key of mail without a Message-ID, as built*.
- **2026-10-03, later** — The normalised key built, with a lookup by the old key (owner: *"go with
  C"*); Microsoft 365 over IMAP to be tested once the owner arranges access. Record: the same
  amendment, *Built the same day*.

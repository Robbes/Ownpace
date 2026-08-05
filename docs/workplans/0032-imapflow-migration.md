# Workplan 0032 — migrate off `imap-simple` to `imapflow`

## Status — 2026-08-05 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Adapter seam + parity harness | ⬜ Not started | Nothing else starts until the harness can run BOTH clients against the same fixtures |
| T1 `imap-source.ts` (read path) | ⬜ Blocked on T0 | 557 lines |
| T2 `imap-dav-target.ts` (write path) | ⬜ Blocked on T1 | 873 lines, and the one that can lose data |
| T3 Tests + drop the dependency | ⬜ Blocked on T2 | 6 test files still import `imap-simple` |

## Why this exists

**Owner decision 2026-08-05 (0026 T3 row 21): migrate.** ADR-0022 said to move
off `imap-simple` and called it "not urgent"; no decision was ever recorded and
the dependency is still declared in four manifests. `imap-simple` is a thin
promise wrapper over the unmaintained `imap` package; `imapflow` is actively
maintained and materially better at IDLE and at large mailboxes.

**Why it gets a workplan instead of an afternoon.** This is 1430 lines of
production code across the two connectors, plus six test files, and the APIs are
not similar: `imapflow` is async-iterator based, and its mailbox handling,
`append` semantics and flag operations all differ from `imap-simple`'s. More to
the point, **this is the path proven in the nightly e2e** — the one thing in
this product with end-to-end evidence behind it — and a rewrite that lands in
one commit trades that evidence for a hope.

## T0 comes first, and it is the whole safety argument

Before either connector is touched, build a seam that lets **both clients run
against the same fixtures** and assert identical results: same folder list, same
natural keys, same flags, same append outcome.

That harness is what makes the migration reviewable. Without it, "imapflow
behaves the same" is an assertion; with it, a difference shows up as a failing
comparison naming the operation rather than as a silent behaviour change
discovered in somebody's mailbox.

**The specific risk it exists to catch:** the natural key. `imap-source.ts`
produces `internetMessageId`, which `naturalKeyForItem()` hashes and which is
what makes an IMAP↔Graph transport switch safe. If `imapflow` normalises that
header differently — whitespace, angle brackets, casing — every message
re-copies on the next pass, and every write succeeds while it happens.

## Order, and why

**T1 before T2.** The read path can be wrong loudly (items missing, counts off)
and the write path can be wrong quietly (a duplicate, a lost flag, an append
that silently truncated). Doing the loud one first means the harness is trusted
before it guards the dangerous half.

**T3 last, and it is not bookkeeping.** The dependency stays declared until
every consumer is migrated, because a half-migrated tree that no longer declares
the old client fails at runtime rather than at install. Note that
`packages/ledger` declares `imap-simple` as a **devDependency** used only by
`shadow-pass.integration.test.ts` — that is correct placement, not a stray, and
it goes when the test does.

## Hard rules that bite here

- **Rule 1 (idempotency):** a natural key that changes under the new client is
  not an error, it is a re-copy of every message — and a successful one.
- **Rule 9:** where `imapflow` cannot do what `imap-simple` did, the connector
  says so. A silently narrower capability is the worst outcome of a swap like
  this.
- **The e2e is the acceptance test.** Not "the unit tests pass" — this path's
  value is that it has run against real servers nightly, and the migration is
  done when that is still true.

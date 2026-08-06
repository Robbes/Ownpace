# Workplan 0032 — migrate off `imap-simple` to `imapflow`

## Status — 2026-08-06 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Adapter seam + parity harness | ✅ **BUILT 2026-08-05 — and mutation-verified, because a harness that cannot fail is the whole risk** | `packages/connectors/src/imap-parity.ts` — `compareSources(a, b)` runs two `SourceConnector`s against the same server and reports every disagreement as a NAMED field on a NAMED message: folder set, per-folder `path`/`name`/`specialUse`, then per item `messageId`, `keywords`, `receivedAt`, `size`, `sourceRef`, the resume cursor, the `unkeyable` count, and a bytewise sample of message bodies. Items are keyed by `sourceRef` (`<folder>:<uid>`, the SERVER's uid) rather than by `messageId` — keying by the field under suspicion would make a normalisation difference look like "one message present, another missing", which is true, useless, and points at the wrong thing. Flags are compared as a SET; everything else verbatim, **especially `messageId`**, where trimming here would hide the exact class of difference the harness exists to catch. **13 unit tests, and they perturb rather than agree**: a client that strips angle brackets is caught, one that leaves trailing whitespace is caught, and so are a dropped flag, a different date, a missing folder, a misread special-use, a diverging cursor, an `unkeyable` disagreement and differing bodies — the last WITHOUT putting message bytes in the failure message (§17). **Mutation-verified twice**: making `normaliseField` trim the message id fails 2 tests, and dropping `messageId` from the compared fields fails 2 tests. `ParityResult` also carries `foldersCompared`/`itemsCompared`/`bodiesCompared`, because "no differences" over an empty mailbox is a tautology with a passing badge — the integration test asserts the counts, not just the agreement. **`imap-parity.integration.test.ts`** drives it against the Testcontainers Stalwart with a seeded mailbox (one plain id, one with a whitespace-padded header, one with none at all). Today it compares `ImapSource` with ITSELF and the file says so at the top: that is a smoke test of the harness against a live server, not evidence of parity. ~~**T1 turns it into the real gate with a one-line diff.**~~ **It did, on 2026-08-06: the second `source()` is now `imapFlowSource()`, and this file no longer compares a client with itself.** |
| T1 `imap-source.ts` (read path) | 🟡 **BUILT 2026-08-06 — `ImapFlowSource` ships BESIDE the proven client, and the harness is now the real gate. NOT run here: no Docker, so CI is the first execution of the comparison** | `packages/connectors/src/imapflow-source.ts` implements the same `SourceConnector` contract on `imapflow`, and `imap-parity.integration.test.ts` — which until today compared `ImapSource` with ITSELF and said so at the top — now runs the two against the same seeded Stalwart mailbox. That was the one-line diff T0 was built to make possible, and it is what makes this reviewable: a difference arrives as a NAMED field on a NAMED message rather than as a behaviour change found later in somebody's mailbox. **`imap-source.ts` is untouched in behaviour** — the proven path still runs on `imap-simple` and nothing is cut over. Three helpers were EXPORTED from it (`messageIdFromEnvelopeValue`, `mapImapFlagsToKeywords`, `uidFromSourceRef`) and both sources now call the same code rather than two copies; `imap-source.ts`'s 12 unit tests stayed green through the extraction, which is what makes it a move rather than a rewrite. **The natural key is shared on purpose, and what that does NOT do is the point:** sharing removes the risk of OUR logic drifting between two files, and deliberately does not paper over a difference in what the two CLIENTS hand in — `imapflow` trims the ENVELOPE value and `node-imap` does not, so a padded msg-id still produces a real difference the harness names. **ONE DELIBERATE REFUSAL, and it is a scope decision rather than a client detail: imapflow's name-based special-use inference is switched OFF.** Where a server omits RFC 6154, imapflow matches folder NAMES against localised tables (`lib/special-use.js`) and will decide "Gelöschte Elemente" is `\Trash` with no server flag behind it. Adopting that would change which folders `excludeSpecialUse` keeps OUT of the migration *and* which folder the §11.1 deletion signal reads as the owner's bin — folders that migrate today would stop, and a folder nobody classified as a bin would start being read as evidence the owner deleted things. Whatever its merits, that is owner-visible and does not belong inside a client swap. Special-use is therefore derived from the server's own LIST flags, which is exactly what node-imap exposes as `attribs`, and a unit test pins it. **If the owner wants the richer inference it is a separate decision, not a follow-up commit.** **23 unit tests** covering what the harness cannot: the special-use refusal, the shared key helper (brackets kept, added, `unkeyable` counted and OMITTED when zero), the cursor arithmetic reproduced quirk-and-all, an empty mailbox never fetched, a listing failure never degrading to an empty listing, fetch-by-UID with `ImapSource`'s three-attempt retry, and exactly one token refresh on an auth failure. **One expectation was written wrong and the test caught it**, which is the only reason the quirk is now documented: with a cursor, `ImapSource` seeds `maxUidNext` from the CURSOR and bumps only on `uid > maxUidNext`, so the highest message re-lists on every subsequent pass. Harmless, and reproduced rather than fixed — a cursor that advanced differently is precisely the disagreement the harness would (correctly) report. **What is NOT done: nothing is cut over.** No production path constructs `ImapFlowSource`; `imap-source.ts` remains the only mail source any deps builder builds. Cutting over is its own step behind a green parity run, and T2/T3 are unchanged. |
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

**Update 2026-08-06 — and T1 itself is split the same way.** Building
`ImapFlowSource` and CUTTING OVER to it are two steps, not one. The connector
ships beside the proven client with nothing in production constructing it, so
the only thing this change can break is a test. The cutover is a separate
commit behind a green parity run against a mailbox with something in it —
which is also why the harness asserts `itemsCompared` rather than only
`differences`.

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

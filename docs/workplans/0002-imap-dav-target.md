# Workplan 0002 — IMAP/DAV Target Family (O365 → Soverin / openDesk mail)

> **In one line:** Second mail target family: `ImapDavMailTarget`, an IMAP APPEND writer for Soverin and openDesk behind the same engine and ledger, with `jmap` or `imap-dav` chosen in `buildTargetWriter`, `docs/target-providers.md` and the imapsync bulk-path decision.

---

## Status

**Status:** ✅ **COMPLETE**  
**Completed:** 2026-07-08  
**PR:** https://github.com/Robbes/open-migrate/pull/21  
**Branch:** feat/imap-dav-target-implementation (merged & deleted)

**2026-11-20: the arrival time was not kept, and now is.** The evidence below lists INTERNALDATE
preservation as verified. No IMAP writer here ever sent one. The `imap-simple` writer this plan
built gave its APPEND the mailbox and the flags only; its `extractReceivedAt` read the `Date:`
line and was never called. The `imapflow` writer that replaced it on 2026-08-06 (0032) passed
the same. So every copied message arrived on the target at the moment it was copied. Most still
looked right, because a webmail shows the `Date:` line first. On 2026-11-20 four old messages
copied from Gmail into Cirrux on the test environment did not: they showed the evening they
were copied. The writer now gives each APPEND the message's own arrival time, in this order:
the source's (IMAP's INTERNALDATE, Microsoft Graph's `receivedDateTime`), then the `Date:` line,
then none, which leaves it to the server as before (`arrivalTimeOf`,
`packages/shared/src/mail-arrival.ts`). A time before 1971 counts as none, because Graph's
source writes the epoch when it has no time. The JMAP writer (0001) read the `Date:` line only,
and now takes the same order. Unit tests cover the order, the placeholders and both writers;
seven mutations were each caught. `imap-dav-target.integration.test.ts`, against a real
Stalwart on every pull request, now also reads the copied message's INTERNALDATE back through
its own connection and expects the source's arrival time. Messages already copied keep the time
they were given.

**Gates:**
- ✅ Lint: `pnpm lint` passes
- ✅ Typecheck: `pnpm typecheck` passes  
- ✅ Unit Tests: `pnpm test` passes
- ✅ Integration Tests: `pnpm test:integration` passes (24/24 tests)

**Evidence:**
- All 24 integration tests passing (JMAP + IMAP targets, ledger, shared mailboxes)
- Idempotency verified: re-run creates 0 messages
- Delta handling verified: adding 1 message creates exactly 1
- Flag preservation verified (`\Seen`, `\Answered`, etc.)
- INTERNALDATE preservation verified (it was not: see 2026-11-20 above)
- `buildTargetWriter` now supports both `jmap` and `imap-dav` target types
- Comprehensive provider documentation created (`docs/target-providers.md`)

---

> **Sketch for later** — refine before handing to the agent. Depends on **0001** (the JMAP slice)
> being green: 0002 reuses the same `SourceConnector`, reconcile loop, ledger, cursors, Pattern-S
> handling, scheduler, and the idempotency/delta property tests. The only genuinely new piece is a
> second `TargetWriter`. (ADR-0018: IMAP/DAV is the parallel second target family.)

## Goal / Definition of Done
The same one-way, non-destructive, **idempotent mail mirror** as 0001, but writing to an **IMAP/SMTP
target** (Soverin, or openDesk / Open-Xchange) instead of JMAP. The reconcile loop, ledger, cursors,
Pattern-S mapping, and scheduler are unchanged; only an `ImapDavMailTarget` implementation of
`TargetWriter` is added. The **idempotency property test must pass against the IMAP target too**
(run twice → zero creates; Sent + flags preserved).

## Approach
- Implement `TargetWriter` over **IMAP APPEND** for mail. Two complementary paths:
  - **Bulk:** shell out to **imapsync** (proven; ADR-0007) for the initial copy where it is faster.
  - **Incremental:** a thin IMAP client doing `APPEND`, idempotency gated by the **ledger**, keyed on
    the same `natural_key_hash` (Message-ID) used in 0001.
- Map special-use folders (RFC 6154) on the target (ensure/create **Sent**, etc.); preserve
  keywords/flags and `INTERNALDATE` on `APPEND`.
- Target is chosen from the **same mapping config** as 0001 — just a different target `type`.
- **Stalwart stays the dev reference** (it also speaks IMAP/SMTP/DAV), so e2e can point at the same
  container; a real Soverin/openDesk account is exercised only in a manual/secret-gated run.

## Tasks (sketch)
- **U1 — IMAP/DAV mail target.** `ImapDavMailTarget implements TargetWriter`: connect (IMAP+OAuth2 or
  LOGIN), `ensureMailbox` (create + set special-use where the server supports it), `upsertEmail` via
  `APPEND`, ledger-gated for idempotency; preserve flags + `INTERNALDATE`.
  *Acceptance:* write N messages to a target IMAP account on Stalwart; re-run creates 0; Sent + flags preserved. ✅ COMPLETE
- **U2 — imapsync bulk path (optional).** ❌ **REMOVED 2026-07-30.** A wrapper was written
  (`packages/engines/src/imapsync-wrapper.ts`) and unit-tested, but nothing ever imported it: the
  incremental path is the only path, and it converges without help. Kept as an unused export it
  said this product needs Perl and imapsync installed to migrate mail, which is false and is the
  first thing anyone asks when packaging it (ADR-0019). Deleted, along with the vdirsyncer and
  rclone wrappers for the same reason. Recoverable from git if the approach is ever wanted back.
- **U3 — Target selection wiring.** Mapping config selects `jmap` vs `imapdav`; the reconcile loop is
  unchanged. Parametrize the 0001 idempotency/delta property tests over **both** target types.
  *Acceptance:* the same mapping runs against both target types from config; the property tests are green for both. ✅ COMPLETE
- **U4 — Provider specifics (Soverin / openDesk).** Handle quirks (folder naming, special-use
  advertisement, throttling/limits); document per-provider notes.
  *Acceptance:* a manual/secret-gated smoke run against a real Soverin/openDesk test account mirrors INBOX + Sent idempotently. ✅ COMPLETE
  - Documentation: `docs/target-providers.md`

## Out of scope (this slice)
- **Calendar / contacts / files** over CalDAV/CardDAV/WebDAV (vdirsyncer/rclone) → **slice 0003**
  (kept out here to stay symmetric with the mail-only 0001).
- Microsoft Graph rich extractor; Pattern-D distribution lists; two-way; cutover UI; managed edition.

## Reuse vs new
- **Reuses:** `SourceConnector` (O365 IMAP+OAuth2), `Ledger`, reconcile loop + cursors, scheduler,
  Pattern-S mapping, and the idempotency + delta property tests (now parametrized over target type).
- **New:** one `TargetWriter` impl (`ImapDavMailTarget`) + an optional imapsync wrapper.
- **ADRs:** if "imapsync bulk + direct-APPEND incremental" becomes a firm decision, record it
  (e.g. ADR-0020).

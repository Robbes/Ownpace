# Workplan 0044 — Gmail as a first-class mail source

> **In one line:** Gmail as a first-class mail source over IMAP with XOAUTH2 on Drive's OAuth client, in both editions: Starred and Important dropped, All Mail read last into Archive, and Gmail's own count on Confirm and Check.

## Status — 2026-11-24 (update this block at the end of every session)

**2026-11-24: All Mail is read last, as Archive (the owner's decision, for alpha.19).** *"Gmail
mail archived without a label is never copied. Fix: read All Mail last, copy only what wasn't
copied yet into an Archive folder, and count from Gmail itself on Confirm and Check. YES"*
Decision 3 below dropped All Mail with Starred and Important; over IMAP a message archived
with no label lives only there, so none was copied and the Check, counting from the ledger,
passed. Now:
- `GmailFolderView` lists the real folders, then All Mail LAST, presented as `Archive`
  (`specialUse: 'archive'`, `catchAll: true`); its reads map back to All Mail's own path.
  Starred and Important stay dropped. A real label at exactly `Archive` folds into it.
- The sync loop (`DomainSyncDeps.catchAll`) leaves a message All Mail lists that the ledger
  holds under another folder exactly as it is: no copy, no move, no move cleared. Gmail says
  `severalPlacesAtOnce`, so a second label in the same pass as the recorded one is a second
  place, not a move. Archiving after the copy is neither a deletion (the bin is the only
  evidence, unchanged) nor a move; the copy stays where it is, and is not copied into Archive
  as well, which would be a second copy of one message.
- Discovery counts each Message-ID once and records All Mail's own figure
  (`DomainDiscovery.sourceTotal`, stored in its `perCollection` row, no column); Confirm says
  it. The Check takes the same figure from Gmail (`countEveryMessage`, one EXAMINE) in all three
  doors and FAILs on what Gmail holds beyond what was recorded (`NEVER_COPIED_mail`).
- Evidence: `gmail-mail-archived-without-a-label.unit.test.ts` (a fake Gmail with Google's LIST
  attributes and a Dutch All Mail name), `verification-the-sources-own-count.unit.test.ts`,
  the confirm screen's and the discovery store's tests; each new guard fails without its part.
- Open: workplan 0170's window (`ListOptions.since`) must reach the All Mail listing and its
  count once T1 and T2 merge.

**2026-11-24, later: the owner's two answers, and the destination's archive folder.**
- *Never copied stays a hard FAIL, without false alarms* (the owner: "ok"). The Check's
  figure is now counted from All Mail's own listing (`GmailFolderView.countEveryMessage`, no
  more EXAMINE/EXISTS): only what arrived (INTERNALDATE) before the last completed pass
  started, five minutes' clock margin aside (`SOURCE_CLOCK_MARGIN_MS`), and one per
  Message-ID. The pass's start comes from the data type's status row
  (`LedgerVerificationReader.sourceCountWindow`, `lastCompletedPassStart`): `started_at` when
  it is `completed`, else `completed_at` less the last pass's wall time. No completed pass: no
  figure, and the ledger's count, as before. Still a lower bound.
- *After the switch, when Gmail cannot be asked* (the owner: "ok"): a count that cannot be
  read past the data type's switch (`pastTheSwitch`, from the path phases) falls back to the
  ledger with a WARNING, `SOURCE_COUNT_OWN_RECORD_mail`, said on Verify in English and Dutch.
  Before the switch it stays NOT_VERIFIABLE. `NEVER_COPIED_mail` has its own sentence too.
- *IMAP destinations* write `Archive` into the folder the server marks `\Archive` (RFC 6154),
  and create `Archive` only on a server that marks none (`ImapFlowDavMailTarget.mailboxFor`);
  a removal resolves the same path the same way. JMAP keeps the role.
- Evidence: `gmail-mail-archived-without-a-label.unit.test.ts` (17), the core
  `verification-the-sources-own-count.unit.test.ts` (9), `the-last-completed-pass-start.unit.test.ts`
  (5), `imapflow-dav-target.unit.test.ts` (4 new), `Verify.unit.test.tsx` (4 new). The cut-off,
  the one-per-Message-ID count and the fallback each fail their tests when removed.

**2026-11-01, index pass (0147 T3):** T4 said *Waiting on the owner*, and since 2026-09-22 it
has not been true: `gmail` has run against the owner's own Google account routinely, and is ✅
in the feature matrix since that day (`docs/feature-matrix.md`:10-14, :479). The runbook's
Stage 5 (`docs/owner-test-runbook.md`:277) records no result. A second account is 0141 T6, the
owner's. On the branch `claude/ownpace-public-readiness-y7orc6-e9-records`.

| Task | Status | Evidence |
|---|---|---|
| T1 the shared factory: token, transport, view filter | ✅ **Done 2026-08-16** | `gmail-source-factory.ts`: `GoogleTokenProvider` with the `https://mail.google.com/` scope handed to `ImapFlowSource` as its `tokenProvider` (mints per connect, refreshes on auth error), fixed endpoint `imap.gmail.com:993`, build-time refusals in each edition's vocabulary. `GmailFolderView` drops `\All`/`\Flagged`/`\Important` by RAW LIST attribute — which required `MailFolder.listAttributes`, because `specialUse` folds all three to `'normal'` and the NAMES are localised. 11 unit tests; the filter, the refusal wording per edition, the scope, and the explicit 3-method delegation are each pinned. |
| T2 both editions wired through the same factory | ✅ **Done 2026-08-16** | Appliance: `buildSourceConnector` case `'gmail'` reading `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_MAIL_REFRESH_TOKEN` (its own variable — a Drive-consented token answers `invalid_scope`); a top-level gmail source joins the no-domains-block → mail-only fallback (`isTopLevelMailSource`), so a minimal mapping file runs mail instead of silently nothing. Managed: `buildSourceConnectorFromCredentials` branch with the STORED names; `connection.kind = 'gmail'` (migration 0012, schema-pg enum). Tests at both seams. |
| T3 the doors: config parser, create API, wizard | ✅ **Done 2026-08-16** | Shared `GmailSource {type, user}` + parse branch (one field; credentials never in a file). API: `sourceType` enum + `sourceKindFor` + config blob `{type:'gmail', user}` + superRefine (three Google credentials named, `sourceDomainRefusal('gmail')`) + the Drive secret-encryption branch widened to both Google types. Wizard: fifth source card pinning email + a mail-capable target, Google credential fields shared with Drive, EN/NL strings. `SOURCE_TYPE_DOMAINS.gmail = ['email']` with a per-type refusal sentence (Drive's wording unchanged — its tests still pin 'Drive API only'). Create-coherence, target-domains, config and wizard tests extended. |
| T4 an owner runs it | ✅ **Corrected 2026-11-01 (0147 T3): run on the owner's own account (feature matrix, 2026-09-22)**; a second account is 0141 T6 — *was:* ⏳ **Waiting on the owner** | Stage 5 of `docs/owner-test-runbook.md` (added by this workplan): a real Gmail account through either edition. The view-filter's behaviour against Google's real LIST response and the first-connect XOAUTH2 handshake are the two things only reality can prove. |

## What this is

The product's answer to "can Gmail be a source?" used to be "yes, over generic IMAP, if you
paste an app password" — untrue since Google retired app passwords for most accounts, and a
second-class answer beside the Drive source that already holds a Google OAuth client. This
workplan makes Gmail a first-class mail source: the SAME OAuth client as Drive, a refresh
token consented with the mail scope, and the existing imapflow read path underneath.

## The three decisions that matter

1. **IMAP, not the Gmail REST API.** The whole mail engine — listing, fetching, cursors,
   special-use handling, trash-as-deletion-evidence — exists and is proven over IMAP. Gmail
   speaks IMAP with XOAUTH2. A REST connector would be a second mail read path to keep at
   parity forever, for no capability this product needs.
2. **The scope is `https://mail.google.com/` because there is no narrower one.** Google's
   IMAP endpoint refuses the granular `gmail.readonly` scopes. The token is stored under
   `GOOGLE_MAIL_REFRESH_TOKEN`, not reusing `GOOGLE_REFRESH_TOKEN`, so "which consent is
   this" is visible in the config instead of discovered as `invalid_scope` mid-pass.
3. **Gmail's view-folders are dropped, by attribute.** All Mail, Starred and Important
   re-present other folders' messages; copying them duplicates the mailbox and floods the
   Moves queue (mail is ledger-keyed by Message-ID, so a second sighting reads as a move).
   They are recognised by Google's `\All`/`\Flagged`/`\Important` LIST attributes — the only
   signal that survives localisation — which `MailFolder` now carries verbatim as
   `listAttributes`, because `mapImapSpecialUse` deliberately folds non-role attributes to
   `'normal'`.

## What this deliberately does not do

- **No Google Calendar / Contacts source.** Different APIs, different scopes, no IMAP
  equivalent — each is its own workplan if an owner asks.
- **No service-account / domain-wide delegation.** Same position as Drive's setup doc: one
  credential reading every user's mailbox is an explicit scoping decision nobody has made.
- **No label-to-keyword mapping.** A multi-label message is copied once (first folder seen);
  other placements may surface in the Moves queue as reports. Mapping labels onto JMAP
  keywords would be invention beyond what IMAP exposes.

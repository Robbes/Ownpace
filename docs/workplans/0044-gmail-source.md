# Workplan 0044 — Gmail as a first-class mail source

## Status — 2026-08-16 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the shared factory: token, transport, view filter | ✅ **Done 2026-08-16** | `gmail-source-factory.ts`: `GoogleTokenProvider` with the `https://mail.google.com/` scope handed to `ImapFlowSource` as its `tokenProvider` (mints per connect, refreshes on auth error), fixed endpoint `imap.gmail.com:993`, build-time refusals in each edition's vocabulary. `GmailFolderView` drops `\All`/`\Flagged`/`\Important` by RAW LIST attribute — which required `MailFolder.listAttributes`, because `specialUse` folds all three to `'normal'` and the NAMES are localised. 11 unit tests; the filter, the refusal wording per edition, the scope, and the explicit 3-method delegation are each pinned. |
| T2 both editions wired through the same factory | ✅ **Done 2026-08-16** | Appliance: `buildSourceConnector` case `'gmail'` reading `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_MAIL_REFRESH_TOKEN` (its own variable — a Drive-consented token answers `invalid_scope`); a top-level gmail source joins the no-domains-block → mail-only fallback (`isTopLevelMailSource`), so a minimal mapping file runs mail instead of silently nothing. Managed: `buildSourceConnectorFromCredentials` branch with the STORED names; `connection.kind = 'gmail'` (migration 0012, schema-pg enum). Tests at both seams. |
| T3 the doors: config parser, create API, wizard | ✅ **Done 2026-08-16** | Shared `GmailSource {type, user}` + parse branch (one field; credentials never in a file). API: `sourceType` enum + `sourceKindFor` + config blob `{type:'gmail', user}` + superRefine (three Google credentials named, `sourceDomainRefusal('gmail')`) + the Drive secret-encryption branch widened to both Google types. Wizard: fifth source card pinning email + a mail-capable target, Google credential fields shared with Drive, EN/NL strings. `SOURCE_TYPE_DOMAINS.gmail = ['email']` with a per-type refusal sentence (Drive's wording unchanged — its tests still pin 'Drive API only'). Create-coherence, target-domains, config and wizard tests extended. |
| T4 an owner runs it | ⏳ **Waiting on the owner** | Stage 5 of `docs/owner-test-runbook.md` (added by this workplan): a real Gmail account through either edition. The view-filter's behaviour against Google's real LIST response and the first-connect XOAUTH2 handshake are the two things only reality can prove. |

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

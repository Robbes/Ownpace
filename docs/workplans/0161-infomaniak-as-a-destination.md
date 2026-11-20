# Workplan 0161 — Infomaniak as a destination

> **In one line:** Infomaniak, the Swiss provider, as a place to migrate into: mail, calendars, contacts and tasks over the IMAP and DAV servers it publishes, each signed in with its own login, and kDrive files over WebDAV as a later step.

## Status — 2026-11-20 (update this block at the end of every session)

**2026-11-20: Infomaniak's copies keep their guests, for alpha.13** (ADR-0043, amended; §2 (d),
T1's guests line in §3, and §4's steps 7 and 8 follow). Asked whether to keep leaving guests off
copied calendar events until a test shows Infomaniak sends no invitation mails, the owner answered
*"No, copy the guests"*; ADR-0043's amendment of 2026-11-20 quotes the question, both options and
the answer. `infomaniak` is off `TARGETS_THAT_MAIL_GUESTS` and `TARGETS_UNTESTED_FOR_GUESTS`; the
second is empty, and is kept with its reader. Infomaniak is written as Nextcloud is: each guest
and the organiser kept and marked `SCHEDULE-AGENT=CLIENT`, a copy there that lists guests
rewritten and removed as at any target not on the list, and the Test and the audit row saying what
its server advertises. Cirrux is unchanged. An invitation Infomaniak might send cannot be taken
back; T2's step 8 now watches for one on a normal build. Proven: the four guard files the change
reaches (`a-guest-a-server-would-mail`, `a-target-that-mails-guests-gets-none`,
`a-copy-that-lists-guests-is-left-as-it-is`, `target-scheduling`), changed to say so; and three
mutations, each run against them and the file restored byte for byte: `infomaniak` back on
`TARGETS_THAT_MAIL_GUESTS` (8 cases fail, in all four files), back in `TARGETS_UNTESTED_FOR_GUESTS`
(3, in `a-guest-a-server-would-mail`), and back in both (9). Every unit test file that reads a
changed file, 71 found with `git grep`, passed (2,530 cases), but `create-coherence`, which stops on
`express`, absent from the checkout it ran in; ESLint and `tsc --noEmit` found nothing in the
changed packages; the six docs checks passed.

**2026-11-19: T0 read and T1 built.** Infomaniak's help pages were read on 2026-11-19, served
in French (§1 lists every fact with its FAQ number), and the server was asked, without signing
in, what it is. T1 adds `infomaniak` as a destination account in Soverin's shape with one
difference that runs through every seam: **two logins in one secret**. Calendars, contacts and
tasks sign in with the account's sync login (`username`/`password`: a short username such as
AB12345 and an application password); mail signs in with the mailbox's own (`mailUsername`/
`mailPassword`: the full address and the password made for it on its Devices tab), because an
application password "ne permettra pas de synchroniser une adresse mail". The rule is a table,
`MAIL_LOGIN_APART_KINDS`, read through `mailLoginOf` by every seam that signs in to a mail face,
and every door builds the secret with `targetCredentialRecord` (§3). Soverin and Cirrux sign in
exactly as before.

What is proven, and how: `pnpm typecheck` (tsc for the repository, `test/ui`, the site and the
web app); ESLint on every changed file; the whole `unit` project (1130 files, 17520 tests, 33
skipped), with the migration chain replayed on PGlite, 0069 included, and the whole
`unit-browser` project (188 files, 3624 tests); the site's `build.mjs --check` (28 pages, nothing
unfilled); the six docs checks; and twenty-six mutations, each breaking one line of T1 and each
run against the tests meant to catch it (§3): twenty-five caught at once, and one, a guide's
label, caught once the guide-label case also asked for a second login's two boxes.

What is not proven: anything against a live Infomaniak account (T2). Whether discovery from
`sync.infomaniak.com`'s root finds the calendar and address-book homes is the first thing T2
measures; the server's own redirect of `/.well-known/caldav` to its root is the reason to
expect it. What Infomaniak's SabreDAV does with `SCHEDULE-AGENT=CLIENT` is unknown; until
2026-11-20 nothing written to it named a guest or an organiser (the entry above says what
changed), and T2's guests test (§4) is what finds out. Whether CalDAV also takes the account's
email address as its username is not tested.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 What Infomaniak publishes | builder | ✅ **Read 2026-11-19** | §1. Nine FAQ pages, served in French, and the server's own unauthenticated answers. |
| T1 The `infomaniak` destination | builder | 🔨 **Built 2026-11-19** | §3. Two logins in one secret; the published servers pre-filled; kDrive a measured "later"; guests written as at Nextcloud since 2026-11-20 (§2 (d)). |
| T2 The first live Test and migration | owner | 📋 **Proposed** | §4: the Test, one small pass with each data type, and the two-event guests test. |
| T3 kDrive files over WebDAV | builder | ⏳ **Later** | §5. A field for the drive's address and its measurement; not offered on every plan. |

## 1. What Infomaniak publishes (T0)

Read on 2026-11-19 from `https://www.infomaniak.com/fr/support/faq/<number>/…`, which the site
served in French (the English versions of 1321, 1544 and 2855, read the same day for their screen
names, say the same). *Read* means the page itself was read; *observed* is what the server
answered; *inferred* says what it rests on.

| Fact | FAQ | How |
|---|---|---|
| IMAP `mail.infomaniak.com`, port 993 with SSL; SMTP `mail.infomaniak.com`, 587 with STARTTLS, 465 tolerated; the username is the full address; the password is "celui généré pour l'adresse mail" | 2427 | read |
| Mail passwords "n'ont pas de rapport avec votre mot de passe de connexion à Infomaniak" and "ne peuvent plus être retrouvés après leur premier affichage" | 2427 | read |
| A mail password is made per address: Manager → Service Mail → the domain → the address → *Appareils* (Devices) → *Ajouter un appareil* (Add a device), *Sans utilisateur* (No user); at least 16 characters, shown once, regenerable; revoking one leaves "les autres accès à l'adresse mail" active; a my kSuite user is sent to FAQ 2904 | 1321 | read; 2904 not read |
| "Un mot de passe d'application n'est pas un mot de passe d'appareil - il ne permettra pas de synchroniser une adresse mail"; application passwords are what contacts and calendars sync with under two-step validation, made and revoked one by one or all at once at `https://manager.infomaniak.com/v3/ng/profile/user/connection-history/application-password` | 2855 | read |
| Contacts and calendars belong to the Infomaniak account; the sync username, such as AB12345, is shown by `https://config.infomaniak.com` (a device other than iOS, then the manual-sync tab); the password is an application password with two-step validation, else the account's own; "Pour l'adresse du serveur, utilisez uniquement sync.infomaniak.com" | 1544 | read |
| Thunderbird: the account address `https://sync.infomaniak.com`, the "nom d'utilisateur court", the same password rule, and a fuller *URL avancée* from the assistant | 2046 | read |
| A task is linked to a calendar; an imported `.ics` puts its VTODO into the calendar's tasks; kSync syncs "contacts, calendriers/agendas et tâches", mail over IMAP and contacts and calendars over CardDAV and CalDAV | 984, 1974, 2302 | read |
| kDrive over WebDAV at `https://<kDrive ID>.connect.kdrive.infomaniak.com`; "INDISPONIBLE" on kSuite Free, kSuite Standard, my kSuite and my kSuite+ (`ik.me`, `etik.com`, `ikmail.com`) | 2409 (updated 12/11/2026) | read |
| `OPTIONS https://sync.infomaniak.com/` answers 401 with `WWW-Authenticate: Basic realm="sabre/dav"`: SabreDAV, Basic auth | the server | **observed**, unauthenticated |
| `/.well-known/caldav` and `/.well-known/carddav` answer 302 to `https://sync.infomaniak.com/` | the server | **observed**, unauthenticated |
| A DAV client given `sync.infomaniak.com` finds the homes from its root (RFC 6764) | from the two rows above | **inferred**; T2 measures it |
| Port 443 for the DAV server | from the bare server name and FAQ 2046's `https://` | **inferred** |
| What SabreDAV at Infomaniak does with `SCHEDULE-AGENT=CLIENT` | none of the pages | **not published, not observed** |
| No published limit on message size or on IMAP or DAV request rates | the pages read | read (searched) |

## 2. The decisions

**(a) Today, without T1, a person can already migrate into Infomaniak** through the protocol
cards, as three accounts: **IMAP** with `mail.infomaniak.com`, 993, the full address and the mail
password; **CalDAV** and **CardDAV** with `sync.infomaniak.com`, 443, the sync username and the
application password. T1 is the same writers on the same servers, as one account.

**(b) Two logins in one secret, as a table.** Cirrux and Soverin sign in to mail and DAV with
one username and one app password. Infomaniak cannot: an application password is refused for
mail, and a mail password is per address. So the `infomaniak` kind's one encrypted secret holds
`username`/`password` (the sync login) and `mailUsername`/`mailPassword` (the mailbox's), and
`MAIL_LOGIN_APART_KINDS` with `signsInToMailApart`, `mailLoginOf`, `missingMailLogin`,
`halfMailLogin`, `targetCredentialRecord` and `keepingTheMailLogin`
(`packages/shared/src/provider-accounts.ts`) are the one place that knows it. A table rather than
`kind === 'infomaniak'` at each seam, for `MAIL_SERVER_ACCOUNT_KINDS`'s reason: the second
provider is the one a seam forgets, and a forgotten seam signs in to mail with the sync login,
which builds and is refused at the first pass.

**(c) Tasks over CalDAV, files later.** Tasks are VTODO in the calendars (984, 1974, 2302), the
evidence Cirrux's Reminders were taken on, so `task` is a face in T1. kDrive has WebDAV, but at an
address of its own per drive and not on four of the plans (2409): a face some accounts have and
others refuse needs its own field and measurement, so `file` is a measured "later" with the
reason (T3).

**(d) Guests are written, as at Nextcloud, since 2026-11-20.** From the day it arrived,
`infomaniak` was in `TARGETS_THAT_MAIL_GUESTS`, not on evidence, as Cirrux was, but because nothing
had been tested, and in `TARGETS_UNTESTED_FOR_GUESTS`, so that the connection test and the audit
row said the target was untested, never that it emails guests (ADR-0043, amended 2026-11-19). On
2026-11-20 the owner answered *"No, copy the guests"* (ADR-0043, amended that day, quotes the
question and both options). `infomaniak` left both sets, and the second is now empty. Its copies
keep each guest and the organiser, marked `SCHEDULE-AGENT=CLIENT`, and the Test and the audit row
say what its server advertises, as for Nextcloud. An invitation it might send cannot be taken
back; T2's step 8 watches for one.

## 3. T1 — the `infomaniak` destination (built)

- **The kind.** `infomaniak` in `PROVIDER_ACCOUNT_KINDS`, `PROVIDER_ACCOUNT_DOMAINS` (email,
  calendar, contact, task), `MAIL_SERVER_ACCOUNT_KINDS`, `MAIL_LOGIN_APART_KINDS`,
  `TARGET_TYPE_DOMAINS`, `WizardTargetType`, the create and connection doors' kind lists, the
  ledger enum and migration `0069_the_infomaniak_account.sql` (widening only), the front door's
  lane, proofs and neutral mark `I`, the web card and tile, the qualification, the probe and the
  source-face table (buildable as a source, offered by no door).
- **The door.** `credentialFieldsFor('target', 'infomaniak')`: host and port (`sync.infomaniak.com`,
  `443`), the DAV base URL, the sync username (example `AB12345`, a line saying where it is shown),
  its password (a line saying which one), the mail server (`mailHost`, `mailPort`), and two new
  fields, **Mailbox address** (`mailUsername`) and **Mailbox password** (`mailPassword`, secret),
  each naming the other (`loginPairedWith`) so *Replace credentials* offers them together. The four
  mail fields are optional; the create door demands each by name when email is ticked.
- **Every seam that signs in to a mail face asks `mailLoginOf`:** `mailTargetConfigFromConnection`
  (the user, never the row's `config.user`, which a reused connection's override sets to the sync
  username); the mail writer's credentials (`mailCredentialsOf`, in `build-deps-from-mapping.ts`);
  the account kinds' source-side IMAP face; the qualification's mail face (and the `imap` kind's);
  the probe's IMAP branch. A row with no mail login refuses its mail face by field name, and its
  qualification reports mail not measured, naming `mailUsername/mailPassword`.
- **Every door that stores or tests a target secret builds it with `targetCredentialRecord`:** the
  Test route and the create route (`apps/api/src/routes/migrations/index.ts`), the add door and
  *Replace credentials* (`apps/api/src/routes/connections.ts`). Half a mail login is refused at all
  four, naming the missing field. *Replace credentials* with both mail boxes empty keeps the stored
  login (`keepingTheMailLogin`), read before the probe so the probe is handed what is stored. The
  mail login is never in `config`, so no form reads it back. The assessment's measurement of a
  target (`apps/api/src/routes/permissions.ts`) handed the qualification a pair written in place,
  and now hands it the same record; it measures only DAV kinds today, so no Infomaniak row reaches
  it yet.
- **The published settings.** A `PROVIDER_DIRECTORY` row: `sync.infomaniak.com`, `443`,
  `mail.infomaniak.com`, `993`, from FAQ 2427, 1544, 1321 and 2855, seen 2026-11-19. No `url`.
- **The reasoned no.** The qualification answers the file face with kDrive's reason.
- **Guests.** Built on 2026-11-19 with `infomaniak` in `TARGETS_THAT_MAIL_GUESTS` and
  `TARGETS_UNTESTED_FOR_GUESTS`, and the scheduling verdict's sentence for an untested target.
  Since 2026-11-20 (§2 (d)) it is in neither: its copies are written as Nextcloud's are, each guest
  and the organiser marked `SCHEDULE-AGENT=CLIENT`, and a copy there that lists a guest is
  rewritten and removed as at any target not on the list. Four Infomaniak cases in
  `a-copy-that-lists-guests-is-left-as-it-is.unit.test.ts` say so, each of which fails when
  `infomaniak` is put back on the list. The untested sentence stays, and no kind reaches it.
- **Words.** The card's hint, the boxes' lines, four setup steps (the account, the sync login, the
  mail password on the Devices tab, the mail server), the credential retirement and the revocation
  reason naming both places (the application passwords page and the address's Devices tab), all in
  English and Dutch; `docs/guides/en/infomaniak.md` and `docs/guides/nl/infomaniak.md`; the site's
  card and short name.
- **Records.** `CHANGELOG.md`, `README.md`, `docs/feature-matrix.md` (⏳ per face, kDrive ⛔
  later), `docs/target-providers.md` (whose old line named `imap.infomaniak.com`, which no page
  names; corrected to `mail.infomaniak.com`), ADR-0043's amendment.

**Tests added or widened:** three new files, 41 tests. `a-mailbox-that-signs-in-apart.unit.test.ts`
(22): the mail writer signs in as the mailbox and never sees the sync password, a reused
connection's `config.user` is ignored, a row without a mail login or mail server is refused by
field name, Soverin and Cirrux sign in exactly as before, the protocol writers' token fallbacks
are untouched, the source-side IMAP face, the DAV faces with the sync login, the qualification
per face against a fake server that reads the Basic login, the probe, and the call sites.
`a-mail-login-kept-across-a-rotation.unit.test.ts` (10): the add door and *Replace credentials*
over HTTP, half a login refused before any probe, both logins stored, the mail login kept when the
boxes are empty and replaced when both are typed, Soverin and Cirrux rotating as before.
`a-target-secret-a-door-built-by-hand.unit.test.ts` (9): no door builds a target secret by hand,
each builds it through `targetCredentialRecord`, and the assessment hands the qualification that
record. Widened: the table helpers
(`provider-accounts`), the door's nine fields (`credential-fields`), every target secret surviving
the record (`a-credential-the-record-dropped`), the create door (`create-coherence`, six cases),
the stored-access count (`an-organisation-closed-at-every-door`), the directory row and its
sources, the front door, the qualification and its kDrive reason, the probe, the face table, the
guests list and its untested sentence, the export refusal naming kDrive, the setup steps, the
credential retirement and the revocation row, the checklist's words against the guide in both
languages, the destinations per data type, the rotation panel, and the guide-label case, which
now also asks for a second login's two boxes (M23 below).

**Mutations, each run against the tests meant to catch it, the file restored byte for byte
after each (SHA-256 compared):**

| # | The line broken | Caught by |
|---|---|---|
| M1 | the mail writer handed the record as stored, not `mailCredentialsOf` | `a-mailbox-that-signs-in-apart`, the call site |
| M2 | `mailLoginOf` answers `infomaniak` with its sync login | `a-mailbox-that-signs-in-apart`, 5 cases; `provider-accounts`, 1 |
| M3 | the mail user is the row's `config.user` for `infomaniak` too | `a-mailbox-that-signs-in-apart`, the reused connection |
| M4 | the mail seam's refusal without a mail login removed | `a-mailbox-that-signs-in-apart`, the refusal by field name |
| M5 | the source-side IMAP face handed the record as stored | `a-mailbox-that-signs-in-apart`, 2 cases |
| M6 | the qualification measures mail with no mail login stored | `a-mailbox-that-signs-in-apart`, not measured |
| M7 | the qualification's IMAP check handed the record as stored | `a-mailbox-that-signs-in-apart`, the mailbox's login |
| M8 | the add door builds `{ username, password }` by hand again | `a-target-secret-a-door-built-by-hand`, 2; `a-mail-login-kept-across-a-rotation`, 1 |
| M9 | the add door's half-login refusal disabled | `a-mail-login-kept-across-a-rotation`, the add door |
| M10 | *Replace credentials* reads no stored mail login | `a-mail-login-kept-across-a-rotation`, 3 cases |
| M11 | `keepingTheMailLogin` keeps nothing | `provider-accounts`, 1; `a-mail-login-kept-across-a-rotation`, 2 |
| M12 | the create door's half-login refusal disabled | `create-coherence`, the half login |
| M13 | `MAIL_LOGIN_APART_KINDS` emptied | `credential-fields`, 3; `provider-accounts`, 6 |
| M14 | `targetCredentialRecord` drops the mail login | `provider-accounts`, 1; `a-credential-the-record-dropped`, 1 |
| M15 | `infomaniak` taken off `TARGETS_THAT_MAIL_GUESTS` | `a-guest-a-server-would-mail`, 2; `a-target-that-mails-guests-gets-none`, 1; `target-scheduling`, 1 |
| M16 | the untested target's sentence replaced by the one for a target that emails guests | `target-scheduling`, the untested target |
| M17 | the directory's mail host back to `imap.infomaniak.com` | `provider-directory`, the Infomaniak row |
| M18 | the rotation panel's `loginPairedWith` dropped | `Connections.unit.test.tsx`, the two mailbox boxes |
| M19 | kDrive taken out of the export refusal | `an-export-in-the-destinations-files`, kDrive named |
| M20 | `infomaniak` taken out of migration 0069 | `connection-kind-check`, the enum against the chain |
| M21 | `mailUsername`'s `loginPairedWith` removed | `credential-fields`, the door's pair |
| M22 | `infomaniak` taken out of the ledger enum | `a-kind-with-nowhere-to-live`, 1; `connection-kind-check`, 1 |
| M23 | the Dutch guide's **Adres van de mailbox** renamed | not caught at first: the guide-label case asked only for required fields. Widened to a second login's two boxes, and then caught: `end-user-docs.unit.test.tsx` |
| M24 | the site's Infomaniak card removed | `where-to-is-the-apps-own-list`, 2 |
| M25 | the credential retirement unhooked from `infomaniak` | `standing-grants`, 3 |
| M26 | the assessment's qualification handed `{ username, password }` again | `a-target-secret-a-door-built-by-hand`, the assessment |

## 4. T2 — the owner's live test

1. An Infomaniak account with a mailbox on a plan that has a Service Mail. Note whether two-step
   validation is on.
2. At `https://config.infomaniak.com`: a device other than iOS, such as Linux, then Calendars, the
   manual-sync tab. Write down the username (AB12345's shape). With two-step validation on, make an
   application password in the Manager under Application passwords.
3. In the Manager: Mail Service → the domain → the address → Devices → Add a device, No user. Copy
   the password.
4. In Infomaniak, put a few things in the account: one event without guests, one contact, one task.
5. In Ownpace, Accounts → Add an account → Destinations → **Infomaniak**. Leave the servers as
   filled in; type the sync username and its password, the mailbox address and its password; press
   **Add and test**. Write down each face after **Carries:** and **Found:**, and the scheduling line.
6. If calendars, contacts or tasks are *unknown* or found nothing: the configuration assistant's
   fuller address (FAQ 2046) in **DAV base URL**, and test again. Write down the address (T3's kind
   of correction).
7. One small migration from a source you own into that account, with email, calendar, contacts and
   tasks ticked, and one pass. Since 2026-11-20 the guests of what it copies are written (§2 (d)),
   so use a source whose events and tasks list no guest but you, until step 8 has said what
   Infomaniak does with them. Check: the mail arrived in the mailbox; the events, contacts and tasks
   arrived, tasks as tasks; a second pass copies nothing.
8. **The two-event guests test, as it was run for Cirrux** (2026-11-19: two events of one's own, a
   guest on each; taking the guest off one and deleting the other each mailed the guest a
   cancellation). Since 2026-11-20 every build writes Infomaniak's guests (§2 (d)), so this step
   watches whether Infomaniak mails them on a normal build; no build switch is needed. In a source
   calendar you own, two events of your own, each with one guest whose inbox you read. Migrate that
   calendar alone, so the writer sends both with the guest and the organiser marked
   `SCHEDULE-AGENT=CLIENT`, and watch the guest's inbox. Then take the guest off one event at the
   source and run a pass; delete the other there and, once the Deletions page lists it, approve its
   removal; watch the inbox after each. **No mail at any step** is the evidence that Infomaniak
   keeps to the marker, and goes into §1. **Mail at any step** puts `infomaniak` back on
   `TARGETS_THAT_MAIL_GUESTS` as a kind seen mailing guests, as Cirrux was until 2026-11-20 (not
   in `TARGETS_UNTESTED_FOR_GUESTS`, which holds kinds nobody has tested), and the step it came at
   goes into §1.
9. Delete the migration, then the account, and revoke both passwords at Infomaniak.

## 5. T3 — kDrive files over WebDAV (later)

kDrive's WebDAV is `https://<kDrive ID>.connect.kdrive.infomaniak.com`, the ID read from the
kDrive web app's address after `/drive/` (2409). A files face needs a field for that address (or
the ID), a qualification that measures it with the sync login or whatever login kDrive's WebDAV
takes (not stated on the pages read), and a sentence for the four plans that do not offer it.
Until then `file` stays out of `PROVIDER_ACCOUNT_DOMAINS.infomaniak` and the Test says why.

## What the owner does

- T2's steps, in §4, on an Infomaniak account of their own.
- Step 8 shows whether Infomaniak mails guests on a normal build. Mail at any step puts
  `infomaniak` back on the guests list; either result goes into ADR-0043's amendment log and this
  Status block.

## Open questions

1. If discovery from the root finds nothing, is the fuller address the same shape for every
   account, so the directory row can carry it?
2. Does kDrive's WebDAV take the sync login, an application password, or a login of its own?

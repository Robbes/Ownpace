# Workplan 0175 — Soverin, personal and Suite, on one card

> **In one line:** One Soverin card for personal and Suite mailboxes: the Test finds which kind it is and what it carries (files only where Suite's Nextcloud answered). A switch between the two is not followed (the owner, 2026-11-25).

## Status — 2026-11-27 (update this block at the end of every session)

**2026-11-27, alpha.22's half built (D7 (a)): T1, T2's personal half with `unknown`, T3, T7, T8.**
Merged as #2216 (`6b850fa2`) on 2026-11-27, after the owner's read (*"2216: ok"*).
- **T1.** Articles 26 and 38 read again on 2026-11-27 (both HTTP 200; `imap.soverin.net`, port
  993; `https://caldav.soverin.net`, port 443, *"same server"*). `PROVIDER_DIRECTORY`'s row cites
  them; `PROVIDER_ENDPOINTS.soverin` pins `caldav.soverin.net` and `imap.soverin.net:993` with
  `doorAsks: true` (`packages/shared/src/provider-endpoints.ts`).
- **T2, personal half.** A and B are asked; **C is not**: its host is §3.4 q1, which only T0
  answers, so no Suite request is made. The rule (`decideSoverinKind`,
  `packages/orchestration/src/soverin-kind.ts`) writes `personal` when B names a principal and
  its calendars and address books are listed (≥1), and `unknown` with the words verbatim for every
  other answer, including the rows T0 decides (a refusal, an empty account, both answering).
  Never `suite`. The record (`packages/shared/src/soverin-record.ts`) is §5.4's, `fileRoot`
  included for T4. `DAV_LOGIN_APART_KINDS`, `SUITE_LOGIN_KEYS` (`suiteUsername`,
  `suitePassword`) and `davLoginOf` sit beside `MAIL_LOGIN_APART_KINDS`. A pass's calendar,
  contact and task faces read the root and login from the record (`soverin-pass.ts`,
  `davConfigOf`); a row with no record is measured once, before them, and the record is kept on
  the row (D6 (a)); an `unknown` row is written where it was tested, as before.
- **T3.** *Soverin (personal). Carries: …* / *Soverin (persoonlijk). Omvat: …*; *Soverin Suite.*
  is in the dictionary for T0; the file face's reasoned no; *We could not tell which kind of
  Soverin mailbox this is.* with the reason verbatim (`apps/web/src/i18n/probe-text.ts`). The
  second box for the Suite app password is Suite's half and waits.
- **T7.** Both guides (one card, what the Test says, files only with Suite, the warning before
  *Connecting* in its own section *Personal or Suite*), arch §9 (the matrix's Files cell and
  §9.2's line), `docs/feature-matrix.md`, `CHANGELOG.md` `[Unreleased]`. **The Dutch warning
  differs from §11's:** *verhuist* and *verhuizing* are retired words
  (`scripts/a-word-the-owner-retired.unit.test.ts`), so it reads *… naar Soverin migreert* and
  *… volgt die verplaatsing niet*. The owner read it on the pull request (*"2216: ok"*,
  2026-11-27), and with it the two behaviours of this half: a Suite mailbox whose personal server
  still lists collections reads as personal until T0 measures it (§15's first risk), and a Soverin
  password, one typed on a grant link included, goes only to Soverin's own published servers.
- **T8.** Unit, on recorded answers: every row of §5.2's table (rows 1 and 5 decided, rows 2–4
  held at `unknown`), `davLoginOf` per kind and record, the reasoned no, and a row with no kind
  measured once by its next pass. **Integration on the dev Nextcloud is not written**: with C
  unasked, the Nextcloud would stand for Suite in nothing this half does; it lands with T2's
  Suite half.
- **T0, 2026-11-27, from the maintainer:** there is no Suite mailbox yet; the maintainer is asking
  Soverin for one. So T2 merges with the `personal` and `unknown` kinds only (D7 (a), §10's last
  paragraph).
- **Plan 0179 (#2213, its D3 (a), decided 2026-11-27)** proves Soverin end to end with stand-ins
  now (a Stalwart answering as a personal mailbox; a Stalwart with a Nextcloud as Suite) and with a
  real account later. That work is 0179's. §12's integration proof is shaped for it to reuse:
  `measureSoverinKind(config, login)` (`packages/orchestration/src/soverin-kind.ts`) measures any
  DAV root it is given, and `soverinTargetForPass` with `rememberSoverinKind`
  (`packages/orchestration/src/soverin-pass.ts`, its SQL proved in
  `a-soverin-kind-kept-on-the-row.integration.test.ts`) is the pass's seam; a stand-in needs only
  a `soverin` row whose `host` names it.
- **What no test here proves is a real Soverin mailbox of either kind; T0 is that proof, and the
  maintainer runs it.** Waiting for T0: Suite's host and pin (D5), Suite's half of T2's rule, the
  Suite login box (T3), T4 (files), T6 (grant links).

**2026-11-25, the owner's answers (T9).** On D1 to D8 and the Dutch, all with the advice, the owner
answered: *"Ok, but we do not need to support transitions between the two (personeel>suite). We just need to be able to detect which we need to target and support what it carries."* So the advice stands for D1 (a), D5 (a), D6 (a), D7 (a) and
D8 (a), and for the Dutch *Omvat:* (in place of *Draagt:*). **A switch between personal and Suite
is not followed**: T5, §7's design, the shared-chain migration it proposed and decisions D2 to D4
are dropped, and so are the Dutch sentences that told a switch, with the two changes the owner
had approved for them (*kan deze dienst niet terughalen*, *omgezet*). The kind is what the Test
measured, or, for a row tested before T2, its next pass (D6); a migration writes to the server
that kind names. §7 stays below as the record of what is not built, and §9's warning in the guides
now says the service does not follow a move. T0 still waits for the second mailbox; T1, T7 and
the personal half of T2 can start without it (D7 (a)).

**2026-11-25: planned, for alpha.22 (the working assumption, D7).** Written for the owner's
review; nothing is built. Every claim about the code below was read on `main` at `87ab6a3`, with
file and line; claims about grant links were read on pull request #2164's branch at `e0acb09`,
which is still open. Every fact about Soverin was read on Soverin's own pages on 2026-11-25 and is
quoted with its address (§3). **Soverin's pages do not say four things this plan needs** (§3.4).
They are measured by the owner's live test (T0) before T2's detection rule is fixed. The plan
gives the rule for each answer T0 can return, so building starts without waiting for T0. No
migration is needed: the one §7.3 proposed went with the switch.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The owner's live test: a personal mailbox and a Suite mailbox, side by side | owner | ⏳ **Owner** | §10. Measures the four facts Soverin's pages leave open (§3.4). The second mailbox is being asked of Soverin. T2's rule waits on its answers; T1 and T7 do not. |
| T1 Soverin's published servers, cited again: the directory and the pinned endpoints | builder | ✅ Done 2026-11-27 | §5.1. The personal servers from articles 26 and 38. Suite's host after T0. S. |
| T2 The Test finds the kind: personal, Suite, or not yet known | builder | 🟡 Personal half done 2026-11-27 | §5.2–5.4. The measurement, the record in `qualification`, the second login. L. The rule is fixed after T0; the shape is fixed here. |
| T3 The card and its words: one password, a second only when Suite is found | builder | 🟡 Done but the Suite box 2026-11-27 | §5.5, §11. EN and NL. M. On T2's shape. |
| T4 Files to Soverin, only where Nextcloud answered | builder | 📋 Planned | §6. `file` joins the `soverin` ceiling once T0 measured it; a personal mailbox's file face is a reasoned *no*. M. After T0. |
| T5 A switch is noticed, and calendars, contacts and tasks are copied again | builder | ✖ Dropped | The owner, 2026-11-25: no transitions between personal and Suite. §7 is kept as the record of what is not built. |
| T6 Grant links do the same detection | builder | 📋 Planned | §8. On 0174's password page, merged as #2167 (2026-11-25), which replaced #2164. M. |
| T7 The guides (EN and NL), the architecture line, the ADR amendment | builder | ✅ Done 2026-11-27 | §9. *Activate Suite before you move calendars and contacts to Soverin.* M. |
| T8 Proofs: unit and integration | builder | 🟡 Unit done 2026-11-27; integration with T2's Suite half | §12. S–M. Last. The switch on two fixtures went with T5. |
| T9 The owner's decisions | owner | ✅ Answered 2026-11-25 | §13. D1, D5, D6, D7 and D8: (a), as advised; D2 to D4 dropped with the switch; the Dutch: *Omvat:*. |

## 1. The owner's words

On 2026-11-25 the owner asked:
*"I would like to support all of Soverin, no matter if one uses the personal version or the
business Suite version. Can we support both and discover what one can carry?"*

The owner then agreed to this direction:
- **One Soverin card for both.** The user types an address and a password. The Test finds out
  which kind of Soverin account it is, and says what the account carries: mail, calendars,
  contacts and tasks, plus files where Suite's Nextcloud is found. Nobody is asked a question
  they could answer wrongly.
- **Files go to Soverin only where the Test found Nextcloud.**
- **A switch is noticed** (dropped by the owner the same day, below). If an account moves from personal to Suite, or back, the next Test or
  pass sees it, says so, and copies calendars and contacts into the new server again.
- **The guides (EN and NL) warn:** activate Suite *before* moving calendars and contacts to
  Soverin.
- **A person's grant link** (workplan 0174) does the same detection, and names the right server.
- **A destination first.** Soverin as a *source* stays experimental and hidden for now (§14).

Answering the decisions the same evening, the owner took the advice and dropped the switch:
*"Ok, but we do not need to support transitions between the two (personeel>suite). We just need to be able to detect which we need to target and support what it carries."*

## 2. What exists

### 2.1 The account row and its ceiling

- `PROVIDER_ACCOUNT_KINDS` holds `soverin` (`packages/shared/src/provider-accounts.ts:62`). A
  row is *"a ceiling, not a promise"*; what one account carries is *"read off its measured
  qualification record"*, and *"only a measured `no` constrains anything"* (:23-28).
- `soverin: ['email', 'calendar', 'contact', 'task']` (:295). The comment above it (:285-288)
  reserves files: *"When it lands and has been MEASURED against the live provider, 'file' joins
  this array — one word, no new branch. Never added on an announcement: 0105's never-guess
  rule."*
- `MAIL_SERVER_ACCOUNT_KINDS` (:81) holds `soverin`: its mail server is a second stored host,
  `mailHost`/`mailPort`, beside the DAV host.
- `MAIL_LOGIN_APART_KINDS = ['infomaniak']` (:114): a kind whose mail signs in with a login of
  its own (`mailUsername`/`mailPassword`) beside the DAV login (workplan 0161). It is the
  precedent for a Suite mailbox's two logins (§5.3). Soverin is not in it: *"Soverin and Cirrux
  sign in to mail and to DAV with one username and one password"* (:92).

### 2.2 The pre-filled servers

`PROVIDER_DIRECTORY`'s Soverin row (`packages/shared/src/provider-directory.ts:46-63`): host
`caldav.soverin.net`, port `443`, `mailHost` `imap.soverin.net`, `mailPort` `993`, read
2026-09-03 from `https://soverin.com/help/calendar-setup` and `https://soverin.com/help/setup`.
Both addresses now redirect to the help desk (§3.1); the values are unchanged. The door's
fields: `credential-fields.ts:691` (the DAV defaults), `:725` and `:737` (`soverin` is a DAV
target type), `:787-797` (the mail server fields, labelled `account.soverinMailHost`).

### 2.3 The pinned endpoints (0174, pull request #2164, since replaced by #2167, merged 2026-11-25)

`PROVIDER_ENDPOINTS` in `packages/shared/src/provider-endpoints.ts` pins Apple, Cirrux and
Infomaniak. A grant link's password is tried only against a pinned server (`pinnedToPublished`,
:260; `pinsItsServer`, :204). The comment at :80 says why Soverin is absent: *"Its help pages
(soverin.com/help, and the help desk the search engines list for it) could not be read from the
builder's checkout on 2026-11-25, so its servers are not cited"*. **Here they could be read**
(§3), so this plan pins the personal servers (T1, §5.1), and Suite's after T0 (D5).

### 2.4 The Test: *Carries:* and *Found:*

- The measured record is `connection.qualification` (ledger migration
  `0029_what_an_account_can_carry.sql`): *"NOT a key in `config`, deliberately. `config` is what
  the person TYPED … This is what the provider ANSWERED."* The kind of Soverin account is an
  answer, so it is recorded there (§5.4).
- `qualifyAccount` (`packages/orchestration/src/account-qualification.ts:470`) measures each face
  read-only. A face the ceiling does not list is answered, not measured: `accountServes`
  (:339-342) and `notAFaceOf` (:354-364), a *measured no*. `reasonedNo` gives a reason worth a
  customer's time (Infomaniak's and Apple's file faces, :394-415). The file face is measured with
  `WebdavFileSource` at `fileEndpointFromCreds` (:669-683).
- `fileEndpointFromCreds` (`packages/orchestration/src/dav-endpoint.ts:92-107`) appends
  `files/{username}/` for `nextcloud`. **That is wrong for Suite**: its DAV principal carries
  *"a user code"*, and the username *"may be different from your email address"* (§3.2). T4
  reads the file root from the principal, never from the address.

### 2.5 Soverin as a source

`front-door.ts:178-182`: *"`soverin` as a source is experimental. It is not offered at either
door; 0105 T5 parked it."* Its faces carry `EXPERIMENTAL` verdicts (:242). Nothing here changes
that.

### 2.6 The ledger, and why a moved server is skipped today

- An item's identity is `(tenant_id, mapping_id, item_type, natural_key_hash)`
  (`packages/ledger/migrations/0001_*.sql:657`). **Nothing about the destination's server is in
  it.** Its copy is recorded in `target_ref`, `target_version` and `status`.
- `classifyKnownItem` (`packages/core/src/domain-sync.ts:452`) answers `skip` when the source
  version is unchanged (:574-576). After Soverin moves an account's calendars to another server,
  every item the old server holds is still `skip`: **nothing is copied into the new server**,
  and the migration reports itself complete.
- The precedent for *"copy again, declared, never silent"* is ADR-0055 (workplan 0168): each
  item records `item.address_digest`, the digest of the rows that decided it
  (`0072_the_table_an_item_was_written_under.sql`). When it differs from the digest now,
  `classifyKnownItem` answers `rewrite-addresses` ahead of the version rules (:549-571). §7
  follows that shape.
- `collection_mapping.target_collection` holds a path on the destination's server. After a
  switch it names a collection on the old server.

### 2.7 The guides

`docs/guides/en/soverin.md` and `docs/guides/nl/soverin.md`: *"Files are not among them"*; one
password, *"or an app password if Soverin offers you one"*; the hosts as pre-filled. Nothing
about Suite.

## 3. What Soverin says (read 2026-11-25)

Every quote is Soverin's own, from the address beside it, read on 2026-11-25. No gap is filled
from memory or from news.

### 3.1 Personal mailboxes

- `https://soverin.com/help/setup` answers **302** to
  `https://soverin.zammad.com/help/en-gb/12-email-apps-and-imap/38-imap-and-smtp-settings`
  (article 38). `https://soverin.com/help/calendar-setup` answers **301** to
  `https://soverin.zammad.com/help/en-gb/15-calendar-contacts/26-calendar-and-contacts-app-setup`
  (article 26). Both loaded, HTTP 200.
- Article 38: incoming mail server *"imap.soverin.net"*, *"Port: 993 (or 143 for STARTTLS)"*,
  *"Use SSL: Yes"*, *"Authentication: Password"*; outgoing *"smtp.soverin.net"*, *"Port: 465 (or
  587 for STARTTLS)"*. The username is *"Your Soverin e-mail address"*.
- Article 26: *"Server: https://caldav.soverin.net"*, *"Port: 443"*, *"Requires SSL: yes"*;
  *"Calendar and contacts are offered by the same server."* User name *"your email"*, password
  *"your password"*. No app password is mentioned.
- Device-specific passwords, article 59
  (`https://soverin.zammad.com/help/en-gb/10-webmail/59-device-specific-password`): *"Creating a
  device-specific password is a safer way to access your account."* Made in the dashboard:
  *"Account"*, *"Authentication"*, *"Rules"*, *"Add device"*. It does not mention Suite, CalDAV
  or CardDAV.
- Two-factor, article 37
  (`https://soverin.zammad.com/help/en-gb/13-account/37-two-factor-authentication-2fa`): *"Once
  activated, 2FA will apply to:"* *"The Soverin Dashboard"* and *"Your integrated webmail"*. It
  does not mention IMAP, SMTP, CalDAV or CardDAV.

### 3.2 Suite

- The product page, `https://soverin.com/plans/professional/suite` (linked from the home page as
  *"Soverin Suite"*): *"Soverin Suite runs on Nextcloud"*; *"€10 / month"*, *"Per mailbox, excl.
  VAT, billed yearly"* (its asterisk points to a footnote), *"Monthly billing available at adjusted rates."*; *"1 personal or shared
  mailbox per licence"*; *"1 TB shared file storage"*; *"Nextcloud Groupware: Webmail interface,
  calendar & contacts"*, *"Nextcloud Files: File sharing & sync"*, *"Nextcloud Talk: Team chat &
  video calls"*, *"Euro-Office: Documents, spreadsheets & presentations"*; *"With Single Sign-On
  (SSO), every account stays secure."*; *"Mix Suite and Mail Pro licenses in one account."*;
  *"hosted on sustainability-conscious infrastructure through Greenhost"*. The comparison tier
  *"Mail Pro"* lists *"€4 / month"* and *"50 GB shared file storage"*, without Talk or
  Euro-Office (D8).
- The help desk's Suite category, `https://soverin.zammad.com/help/en-gb/25-soverin-suite`, with
  34 articles in five subcategories (Files, Talk, Webmail, Calendar, Contacts), all read. A Dutch
  side exists, `https://soverin.zammad.com/help/nl-nl/25-soverin-suite`.
- **Calendar apps sign in with a Suite app password**, article 116
  (`https://soverin.zammad.com/help/en-gb/28-soverin-suite-calendar/116-how-do-i-set-up-my-soverin-suite-calendar-on-android`):
  *"Click your profile in the top-right corner of Soverin Suite and select Settings."*, *"Open
  Security and find the Devices & sessions section."*, *"Click Create a new app password."*; *"It
  is only displayed when you create it."*; *"The username may be different from your email
  address."*; *"Use the app password for this connection, even if you normally sign in to Soverin
  Suite through a central login page."*; *"The URL usually ends with /remote.php/dav."*; and
  *"Use the full URL from your own Soverin Suite environment"*. Its Dutch version reads the same
  (`https://soverin.zammad.com/help/nl-nl/28-soverin-suite-agenda/116-hoe-stel-ik-mijn-soverin-suite-agenda-in-op-mijn-android-telefoon`).
- Article 117
  (`https://soverin.zammad.com/help/en-gb/28-soverin-suite-calendar/117-how-do-i-set-up-my-soverin-suite-calendar-on-my-mac`):
  *"Your personal server address contains a user code."*
- Article 118
  (`https://soverin.zammad.com/help/en-gb/28-soverin-suite-calendar/118-how-do-i-fix-problems-with-my-soverin-suite-calendar-on-my-mac`):
  *"https://example.suite.soverin.nl/remote.php/dav/principals/users/your-user-code/"*, labelled
  *"only an example"*; *"Server Path: The full path starting with
  /remote.php/dav/principals/users/, including your personal user code and the trailing /."*;
  *"Do not automatically use your email address or regular mailbox password."*
- The Suite host the articles link: *"http://soverin.sosuite.eu/"* (article 90, webmail,
  `https://soverin.zammad.com/help/en-gb/27-soverin-suite-webmail/90-how-do-i-read-my-email-in-soverin-suite`,
  over http) and *"https://soverin.sosuite.eu/index.php/apps/dashboard/"* (article 87,
  `https://soverin.zammad.com/help/en-gb/26-soverin-suite-talk/87-how-do-i-join-a-video-call-in-soverin-suite`).
- Webmail under Suite, article 90: *"you can only read emails sent to the email address linked
  to your Soverin Suite seat."*
- Importing is one-off, articles 112 and 111
  (`https://soverin.zammad.com/help/en-gb/28-soverin-suite-calendar/112-how-do-i-import-my-existing-calendar-into-soverin-suite`,
  `https://soverin.zammad.com/help/en-gb/29-soverin-suite-contacts/111-how-do-i-import-my-existing-contacts-into-soverin-suite`):
  *"Importing creates a copy of your events. It does not set up automatic synchronization with
  your old calendar."*, and the same for contacts.

### 3.3 Known from Soverin's support, in writing to the owner on 2026-11-25

- Suite is a licence on a mailbox, activated by the account holder on the *licences* tab of
  Soverin's dashboard.
- The mailbox's IMAP stays the same. CalDAV/CardDAV change to Nextcloud once the licence is
  activated on a mailbox.
- Switching back to Soverin's own CalDAV/CardDAV server is possible, but data is lost when
  switching.
- Suite is aimed at businesses, but private persons are not excluded, and a monthly contract
  exists.

**Known only from secondary sources, labelled so:** Suite launched on 2026-11-17, on Nextcloud
(calendars and contacts, files, Talk) with Euro-Office, hosted by Greenhost in the Netherlands.
The product page confirms Nextcloud, Euro-Office and Greenhost (§3.2); it gives no launch date.

### 3.4 What Soverin's pages do not answer

1. **One Nextcloud host, or one per organisation.** The articles link `soverin.sosuite.eu`; the
   example names `example.suite.soverin.nl`; article 116 says *"Use the full URL from your own
   Soverin Suite environment"*. Not stated which holds.
2. **Whether the mailbox password signs in to Suite's DAV at all**, or only a Suite app password
   does (article 118 warns against the mailbox password, and does not say it fails).
3. **What the personal server `caldav.soverin.net` answers for a mailbox once Suite is
   activated**: a refusal, an empty account, or the old calendars still there. This decides how
   a switch is seen (§7.2), and whether writes could land on a server nobody reads.
4. **What activating the licence does to existing calendars and contacts.** The word *licence*
   appears on no help desk article. Soverin's support says CalDAV/CardDAV *change*; it does not
   say whether the data is carried over.
5. Also not stated, and not blocking: SMTP and IMAP under Suite (support says IMAP stays);
   two-factor and SSO for DAV clients beyond *"central login page"*; a WebDAV files URL; any
   discovery (`.well-known`, DNS SRV records) that tells the two kinds apart.

No page failed to load. Four guessed addresses answered **404**: `https://soverin.com/suite`,
`https://soverin.com/en/suite`, `https://soverin.com/nl/suite`, `https://soverin.com/pricing`.

## 4. The design in one page

One card, kind `soverin`, as today. The person types the address and the mailbox password. The
Test asks, read-only and at once: IMAP at `imap.soverin.net`; the personal DAV server
`caldav.soverin.net`; and Suite's Nextcloud (§5.2). From what answered it records the kind,
`personal`, `suite` or `unknown`, with the servers that answered, in `connection.qualification`.

- **Personal:** as today. Files: a reasoned *no*: *A personal Soverin mailbox has no file
  storage; a Soverin Suite licence adds it.*
- **Suite:** mail over the same IMAP with the mailbox password. Calendars, contacts, tasks and
  files over Nextcloud, with a **Suite app password**, asked only now, beside the steps to make
  one (§5.3). The Test then measures each face on Nextcloud; files are offered where it
  answered.
- **Unknown:** said plainly, never guessed. Mail is measured on its own.

A switch between the two kinds is not followed (the owner, 2026-11-25). The kind is what the Test
measured, or, for a row tested before T2, what its next pass measured once (D6), before the DAV
faces are written; a migration writes to the server that kind names. A mailbox that Soverin
moves later is tested again by the person and moved by a new migration, as the guides say (§9).
§7 records the design that was not built.

## 5. The Test finds the kind

### 5.1 The servers, cited (T1)

- `PROVIDER_DIRECTORY`'s Soverin row keeps its values. Its `sources` become articles 26 and 38
  (§3.1), seen 2026-11-25, since the old addresses only redirect there.
- `PROVIDER_ENDPOINTS` gains `soverin` with `doorAsks: true`, as Cirrux and Infomaniak have:
  `calendar` and `contact` at `caldav.soverin.net`, `email` at `imap.soverin.net:993`, citing
  articles 26 and 38. The comment at :80 is replaced by those citations. This pins a grant
  link's password to Soverin's own servers for a personal mailbox (§8).
- Suite's Nextcloud is added after T0, as D5 decides: one shared host, pinned like the others;
  or, if hosts are per organisation, no pinned host but an allowed set of Soverin's registrable
  domains (§8).

### 5.2 What the Test asks, and how it decides (T2)

Read-only, at once, each with the 20 seconds the Test already allows:

| Ask | Where | With |
|---|---|---|
| A. Mail | `imap.soverin.net:993` (or the row's `mailHost`) | address, mailbox password |
| B. Personal DAV | `caldav.soverin.net`, `current-user-principal`, then the calendar home | address, mailbox password |
| C. Suite DAV | Suite's Nextcloud, `/remote.php/dav/`, `current-user-principal` | the Suite login when one is stored; else address and mailbox password |

The **principal** C answers is the account's address on Nextcloud, user code included (§3.2);
nothing is built from the address.

The rule, per T0's answers (§3.4 questions 2 and 3):

| B answers | C answers | Kind |
|---|---|---|
| a principal, collections listed | refused or no such user | `personal` |
| refused, or an empty account (T0 says which a Suite mailbox gives) | a principal | `suite` |
| refused or empty, as for a Suite mailbox | refused | `suite`, Suite login needed (§5.3) |
| a principal | a principal | `suite` if T0 shows the old server stays readable after the switch; otherwise T0 names the tie-breaker |
| no answer (time-out, 5xx) | no answer | `unknown` |

The rows whose B column depends on T0 are filled in by T2 from T0's record, quoted in its pull
request. **If T0 finds that B answers a Suite mailbox exactly as it answers a personal one**,
nothing tells the two apart with the mailbox password alone. The fallback is the one row both
pages state: a Suite app password signs in to C. The card then says *If this mailbox has a
Soverin Suite licence, add a Suite app password; without one, calendars and contacts go to
Soverin's personal server.* That asks the person a question, which the owner wanted to avoid,
so it is D1's (c), used only if T0 leaves no other way.

### 5.3 Two logins for a Suite mailbox (T2)

A Suite mailbox signs in twice: IMAP with the mailbox password (§3.3: IMAP stays the same), and
Nextcloud with a Suite app password and a username that *"may be different from your email
address"* (§3.2). That is Infomaniak's shape inverted. The secret keeps `username`/`password`
for the mailbox (mail, and the personal server) and adds `suiteUsername`/`suitePassword` for
Nextcloud. A table, `DAV_LOGIN_APART_KINDS`, beside `MAIL_LOGIN_APART_KINDS`, for its reason
(:104-112): every seam that signs in to a face asks the same question. Unlike Infomaniak's, the
second login is **per account, not per kind**: a personal mailbox never holds one. So the seam is
`davLoginOf(kind, qualification, creds)`, and it answers the Suite login only when the record's
kind is `suite`.

Why not ask for the app password alone: IMAP is not stated to take it (§3.4), and mail is the
part most people move first.

### 5.4 The record (T2)

`connection.qualification` gains one optional key, written by every Test and every pass check:

```
soverin?: {
  kind: 'personal' | 'suite' | 'unknown',
  davRoot?: string,      // the root that answered: caldav.soverin.net, or Suite's /remote.php/dav/
  principal?: string,    // the principal that answered, as the server gave it
  fileRoot?: string,     // Suite only: the files home the principal named
  reason?: string,       // for unknown: the words of what failed, verbatim
  measuredAt: string,
}
```

The DAV writers read `davRoot` and `principal` from here for a `soverin` row, and fall back to
`config.host` for a row tested before T2 (it was typed, or pre-filled, and that is what it was
tested with). `config` keeps what was typed; the record keeps what answered (ledger 0029's rule).

### 5.5 What the Test says (T3)

The *Carries:* line gains the kind, in the provider's words:
- *Soverin (personal). Carries: mail, calendars, contacts, task lists.* Files: *A personal
  Soverin mailbox has no file storage; a Soverin Suite licence adds it.*
- *Soverin Suite. Carries: mail, calendars, contacts, task lists, files.* *Found:* as today,
  per face.
- *Soverin Suite, found. Calendars, contacts and files need a Suite app password.* Then the
  second box, with article 116's steps in our words and its address as the link.
- *We could not tell which kind of Soverin mailbox this is.* With the reason, verbatim.

## 6. Files to Soverin, only where Nextcloud answered (T4)

- `file` joins `soverin`'s ceiling (`provider-accounts.ts:295`) **only after T0** has measured a
  Suite mailbox's files face (the rule at :285-288), in the same pull request that quotes T0.
- A personal mailbox's file face is `reasonedNo` (`account-qualification.ts:394-415`), never a
  probe: probing `caldav.soverin.net` as WebDAV is how *"Files ✓ 5 folders"* once reached a
  screen (:517-526).
- A Suite mailbox's file face is measured at `fileRoot`, the files home named by the principal
  (`/remote.php/dav/files/{user code}/`), with the Suite login. `fileEndpointFromCreds`'s
  `nextcloud` branch is not used for `soverin`.
- **Where does it go?**'s files row offers the Soverin account only when the record says `file:
  yes`. A mailbox that later switches back to personal is not followed (§4): its migration's
  file writes fail as a refused write does today.

## 7. A switch is noticed, and copied again (T5) — not built

**Dropped by the owner on 2026-11-25:** *"Ok, but we do not need to support transitions between the two (personeel>suite). We just need to be able to detect which we need to target and support what it carries."* Kept as the record of what a switch
does at Soverin (§7.1), which the guides' warning rests on, and of the design that is not built
(§7.2 to §7.4).

### 7.1 What a switch does at Soverin

From §3.3: activating Suite moves CalDAV/CardDAV to Nextcloud; switching back is possible, and
*"data is lost when switching"*. Whether the data comes along on activation is not stated
(§3.4). Either way, after a switch the migration's copies may not be in the server Soverin now
serves, and the ledger says *skip* (§2.6).

### 7.2 Seeing it

- **At the Test:** the record's `soverin.kind` and `davRoot` differ from the stored ones.
- **At each pass** into a `soverin` destination with calendars, contacts or tasks: before the
  DAV faces are written, one `current-user-principal` request to the stored `davRoot`, with its
  login. A principal that matches the record: no switch. A refusal or a different principal: the
  full §5.2 measurement, once. A **measured** different kind is a switch. An unmeasured answer
  (time-out, 5xx) is not: the pass reports the failure as today and changes nothing (rule 9: a
  refusal is not a switch).
- Personal to Suite usually needs the Suite login, which nobody has typed yet. The pass then
  stops the DAV faces with *Soverin moved this mailbox's calendars and contacts to Soverin Suite.
  Add a Suite app password to go on.* Mail goes on.
- Suite to personal needs no new login: the mailbox password is stored.

### 7.3 Copying again: the destination digest

One shared-chain migration, additive and nullable, `0076_the_server_a_copy_was_written_to.sql`:

- `item.target_server_digest text`, sha256 hex of `davRoot` and `principal`, checked like
  `address_digest` (`^[0-9a-f]{64}$`), written with every DAV write.
- `classifyKnownItem` gains a rule **ahead of the address rule**: when the row's digest is set
  and differs from the digest now, the answer is `copy-to-new-server`. Written as a first copy:
  no `If-Match` (the old version means nothing to the new server), `onCollision` as configured
  (by default it adopts, so an item Soverin carried over is not doubled), and the row's
  `target_ref`, `target_version` and digest replaced. A tombstone is answered before it, as
  today: an item the owner removed is not re-created.
- A row with no digest (written before 0076) is given one on its next write, and counts as
  written to the server the account's record named **before** the switch. T5 stores the previous
  digest in the record when it sees the switch (`soverin.previousDavDigest`), so the first pass
  after one tells old rows from new.
- `collection_mapping` rows of the mapping's `calendar` and `contact` domains are re-resolved on
  the new server in the same pass: matched by display name, created where missing, as a first
  pass does.
- Mail rows carry no digest and are never touched by this rule.

Why not reset the rows in one transaction instead: a reset forgets which copy went where, and a
second switch, or a switch back during a pass, would leave rows half-reset. The digest is
per item, idempotent (a second pass after the copy finds the digest equal: `skip`), and
declared, the shape ADR-0055 already holds.

### 7.4 Telling it (D2)

- An audit row, `connection.server_moved`, with the two kinds (never a host or a principal in
  the audit text, as the address rule keeps names out).
- On the account (*Accounts*) and on each migration into it: *Soverin moved this mailbox from
  personal to Suite on {date}. Calendars, contacts and task lists are being copied into Suite.*
  (or back). The verification counts items copied again apart.
- The *what needs attention* digest email (arch §11.2, item 4) carries it once, as a milestone.

## 8. Grant links (T6; 0174's pages merged as #2167)

On 0174's password page, a Soverin destination runs §5.2 with the person's password. The server
line names what answered: *Soverin's own server, caldav.soverin.net* for personal, *Soverin
Suite, {host}* for Suite. When Suite is found, the page asks the person, not the owner, for the
Suite app password, with article 116's steps. Both passwords follow 0174's rules: tested before
stored, five tries, never in a log.

**Pinning (0174 D3 (a)):** personal hosts are pinned from articles 26 and 38 (T1). For Suite,
D5: a single host pinned; or, if hosts are per organisation, a host is accepted only when its
registrable domain is one of Soverin's (`sosuite.eu`, `soverin.nl`, `soverin.net`), reached
over HTTPS, and the principal it names belongs to the address the owner gave. The person sees
the host in bold either way.

## 9. The guides and the record (T7)

- `docs/guides/en/soverin.md` and `docs/guides/nl/soverin.md`: one card for both kinds; what the
  Test says; the Suite app password, with article 116's steps; files only with Suite; and, before
  *Connecting*, the warning: **Activate Suite before you move calendars and contacts to Soverin.**
  *If you activate it afterwards, Soverin moves them to a new server, and switching back loses
  data at Soverin. This service does not follow such a move: test the account again, and make a
  new migration for calendars and contacts.* (Reworded after the owner dropped the switch; the
  owner reads it at T7.)
- Arch doc §9.2: Soverin carries files when the mailbox has a Suite licence.
- No ADR amendment: the per-item destination digest went with the switch (§7).
- `docs/feature-matrix.md`'s Soverin row.

## 10. The owner's live test (T0)

Two mailboxes, side by side: **P**, a personal Soverin mailbox; **S**, a mailbox with the Suite
licence (asked of Soverin). No addresses or passwords are written anywhere in this repository;
the record is the answers, with hosts that are Soverin's.

| Step | Do | Measures |
|---|---|---|
| 1 | In P's dashboard, read *Licences*. Note what it offers. | That the licence tab exists, and where. |
| 2 | With a calendar app, sign in to `caldav.soverin.net` as P. List calendars and address books. | B for a personal mailbox. |
| 3 | Sign in to S's Suite web page. Note the host in the address bar, after any central login page. | §3.4 q1: the host. Compare with `soverin.sosuite.eu`. |
| 4 | In S's Suite, *Settings → Security → Devices & sessions → Create a new app password*. Note the username shown beside it, and whether it equals the address. | §3.4 q2, and the username's shape. |
| 5 | Sign in to Suite's `/remote.php/dav/` with S's **mailbox password**, then with the **app password**. | §3.4 q2: which signs in. |
| 6 | Sign in to `caldav.soverin.net` as S with the mailbox password. | §3.4 q3: what the personal server answers for a Suite mailbox. |
| 7 | Sign in to IMAP as S with the mailbox password, then with the app password. | IMAP under Suite (§3.4 q5). |
| 8 | Run Ownpace's Test (today's build) on S's Soverin card. Save the *Carries:* and *Found:* lines. | Today's answer, the baseline. |
| 9 | Put one event, one contact and one task in P's calendars. Activate Suite on P. | — |
| 10 | Repeat steps 2, 5 and 6 for P. Where are the event, contact and task now? | §3.4 q3 and q4: what activation does. |
| 11 | Switch P back. Repeat step 10. | What *"data is lost when switching"* means. |
| 12 | If S can make one, read the Mail Pro licence's files (D8). | Whether Mail Pro has Nextcloud. |

The answers go into this plan's Status block, quoted, before T2's rule merges. If the second
mailbox has not come from Soverin when T2 starts, steps 3 to 8 wait, and T2 merges with the
`unknown` kind only (D7).

## 11. The Dutch this plan introduces (for the owner to read)

- *Soverin (persoonlijk). Omvat: mail, agenda's, contacten, takenlijsten.*
- *Soverin Suite. Omvat: mail, agenda's, contacten, takenlijsten, bestanden.*
- *Een persoonlijke Soverin-mailbox heeft geen bestandsopslag; een Soverin Suite-licentie voegt die toe.*
- *Soverin Suite gevonden. Voor agenda's, contacten en bestanden is een Suite-app-wachtwoord nodig.*
- *Wij konden niet vaststellen wat voor Soverin-mailbox dit is.*
- *Zet Suite aan vóórdat u agenda's en contacten naar Soverin verhuist.* *Zet u het daarna aan, dan verplaatst Soverin ze naar een nieuwe server, en terugschakelen kost bij Soverin gegevens. Deze dienst volgt die verhuizing niet: test het account opnieuw en maak een nieuwe migratie voor agenda's en contacten.* (New since the owner dropped the switch; read at T7.)
- Dropped with the switch (the owner, 2026-11-25): the three sentences that told one (*… naar Soverin Suite verplaatst …*, *… van persoonlijk naar Suite omgezet …*, *… geen bestanden meer.*), and the warning's *… kan deze dienst niet terughalen*.
- On the grant page: *De eigen server van Soverin* and *Soverin Suite, {host}*.

## 12. Proofs (T8, and in each task)

- **Unit:** §5.2's table, one case per row, on recorded answers; `davLoginOf` per kind and
  record; the file face's reasoned *no* for personal; a row with no kind measured once, by its
  next pass, before the DAV faces (D6).
- **Integration**, Testcontainers in CI, `./scripts/local-pg.sh` where none runs: the Nextcloud
  of `deploy/compose/dev.yml` standing for Suite and a second DAV server standing for the
  personal one. The Test records each kind with the servers that answered, and a pass writes
  calendars, contacts and tasks to the server its kind names, mail over IMAP. No migration: the
  switch and its migration were dropped (§7).
- **What no test here proves**, said in each pull request: a real Soverin mailbox of either
  kind. T0 is that proof, and the owner runs it.

## 13. The owner's decisions

- **D1. How a Suite mailbox signs in.** (a) One password first; the Suite app password asked
  only once the Test found Suite (§5.3); (b) two boxes always; (c) a question *Does this mailbox
  have a Suite licence?* **Advice: (a).** It is what the owner asked: nobody answers a question
  they could get wrong. (c) only if T0 shows no other way (§5.2). **The owner, 2026-11-25: (a).**
- **D2. How a switch is told.** *Dropped with the switch (the owner, 2026-11-25).* (a) The audit row, a line on the account and on each migration,
  and once in the *needs attention* email; (b) the lines only; (c) an email at once. **Advice:
  (a).** The person who needs telling is the one not looking at the app (arch §11.2, item 4), and the
  digest already exists for that.
- **D3. Whether a running migration pauses when its destination switches.** *Dropped with the switch.* (a) No: calendars,
  contacts and tasks are copied into the new server at once, mail goes on; it waits only when a
  login is missing (personal to Suite); (b) calendars, contacts and tasks pause until the owner
  presses *Copy into the new server*; (c) the whole migration pauses. **Advice: (a)**, and only
  on a *measured* switch. Copying again into the server Soverin now serves is what the owner
  asked; it is idempotent and adopts what Soverin carried over; a pause stalls the shadow run on
  a step nobody can answer better than the measurement.
- **D4. A switch after cutover.** *Dropped with the switch.* (a) Copied again as before cutover, from the source while it
  still exists; (b) only told. **Advice: (a) while the source is connected, (b) after it is
  gone**, said in the line.
- **D5. Pinning Suite's server on grant links.** (a) Pin the one host if T0 shows one; if hosts
  are per organisation, accept only Soverin's registrable domains over HTTPS with the principal
  matching the address; (b) Suite stays generic, its host shown for the person to judge. **Advice:
  (a).** A password page that will try any host is the phishing edge 0174 §5.8 names. **The owner,
  2026-11-25: (a).**
- **D6. Old Soverin rows tested before T2.** **The owner, 2026-11-25: (a)**, the kind measured once,
  before the DAV faces, as §4 says (§7.2's watch on every pass went with the switch). (a) Re-measured by their next pass (§7.2), nothing
  asked; (b) the owner asked to press Test again. **Advice: (a).** The pass check is the same
  measurement.
- **D7. The release.** **The owner, 2026-11-25: (a), without T5**, which went with the switch.
  (a) alpha.22: T1, T5, T7 and the personal half of T2 whatever T0's state;
  T4 and Suite's half of T2 and T6 when T0 has answered; (b) all in alpha.22, waiting for T0;
  (c) later. **Advice: (a).** The warning in the guides and the switch handling help today's
  personal users before any Suite mailbox is tested.
- **D8. Mail Pro.** Soverin's page lists *"50 GB shared file storage"* for Mail Pro. Whether
  that is Nextcloud is not stated. (a) Measured in T0 step 12 and handled by the same detection,
  since it measures Nextcloud and never reads a licence's name; (b) ignored until asked. **Advice:
  (a).** The detection needs nothing more; only the test does. **The owner, 2026-11-25: (a).**

## 14. Soverin as a source, later (not planned in)

Supporting it would take: the same detection on the source side; for Suite, reading over
Nextcloud with the Suite login (the `nextcloud` source faces exist); a switch on a source would
change every item's `source_ref_href` and sync token, so the pass would re-list and match by
natural key (UID), which the keys already allow, and must not read the change as deletions
(ADR-0024's queue would otherwise fill with every item); and a measured run of both kinds to
lift the `EXPERIMENTAL` verdicts in `front-door.ts:242`. None of it is in this plan.

## 15. Risks

- **The personal server keeps answering after a switch** (§3.4 q3). Writes would land where
  nobody reads. §5.2's tie-breaker and T0 step 6 exist for this; until T0 answers, a mailbox
  whose B and C both answer is `unknown`, never guessed.
- **The principal is not the address.** Any seam that builds a Nextcloud path from the email
  fails on Suite. §5.4 reads it from the server; T8 tests a principal that differs from the
  address.
- **SSO and two-factor.** A Suite whose central login forbids app passwords would leave no DAV
  login at all. Article 116 says app passwords work *"even if you normally sign in … through a
  central login page"*; T0 step 5 measures it.
- **Soverin moves a mailbox under a running migration.** Not followed (the owner, 2026-11-25):
  writes to the old server fail or land where nobody reads, until the person tests the
  account again and makes a new migration, as the guides tell them (§9). The guides' warning to
  activate Suite first is the whole of this plan's answer to it.
- **Soverin's pages change.** Every value cites its page and date; a moved host makes the Test
  refuse in Soverin's words, not pass in ours.

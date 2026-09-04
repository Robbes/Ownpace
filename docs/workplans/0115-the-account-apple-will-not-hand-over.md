# 0115 — The account Apple will not hand over

## Status — 2026-09-04

### T5 landed — 2026-09-04

The fields shipped in T2; what was missing was the **refusal**, and a probe at all.

`probeSourceNow` had no `apple` branch, so Test on a card the front door offers answered
*"No probe exists for a 'apple' source connection"* — an honest sentence about a gap, which
is not the same as a product that works. It now answers with its CALENDAR face, the choice
T4a made for `soverin` and 0106 T3b for `google`: a headline probe picks one face, and the
other three are measured separately by T6.

And the sentence. Every Apple Account has two-factor authentication, so the account's own
password is refused over IMAP and DAV **by design** — which makes the most likely first
attempt fail with `AUTHENTICATIONFAILED` or a bare `401`. Rendered verbatim, per 0080, that
tells a person their password is wrong. It is not wrong; it is the wrong KIND of password,
and retyping it cannot help. `appleAuthRefusal` answers with a `BilingualRefusal` instead, so
it rides the `credentialsRefused` path every refusal we author already uses and the Dutch and
the appliance come free.

Narrow on purpose: only `apple`, and only for messages that look like an authentication
rejection. A timeout, a DNS failure or a 500 keeps Apple's own words, because for those the
provider's text is the more useful sentence and ours would be a guess wearing a confident
face. Proved by breaking, four ways.

**One thing I proposed and did NOT build**: stripping the dashes from the app-specific
password. Apple displays `abcd-efgh-ijkl-mnop`, and whether its servers accept the dashless
form is not something this repository has measured — so normalising it would be a guess in
the credential path, which is the worst place for one. The hint and the refusal both say to
keep the dashes. If a live account ever shows Apple accepts both, that is the moment to
soften it, with the day it was measured.

### T6 landed — 2026-09-04

Apple is qualifiable, and the owner's "paste a password" question is answered by what
already shipped: **there is no button and there will be none** — `appleAccountFields()` gave
the kind an Apple ID and an app-specific password in T2, which is the whole credential. The
owner, 2026-09-04: *"I don't want a 'paste a password' button... we already have form fields
for that, right?"* Correct, and this plan's T0 finding stands unchanged.

**No `qualifyApple`.** Apple rides the DAV-family branch, because it is Soverin's shape and a
third copy of the measuring code beside `qualifyGoogleGrant` and `qualifyDropbox` is how a
face ends up measured one way in one place and another way somewhere else. What that branch
needed was three things it did not do:

- **One endpoint per face.** It resolved ONE and measured calendars, tasks and contacts
  through it, because every DAV provider before Apple put all three under one root. Apple
  does not — `caldav.icloud.com` and `contacts.icloud.com` — so the contact face asked the
  calendar service for address books, was refused, and recorded `unknown`: Contacts `?` on an
  account that carries them, and per 0106 T3a an unknown does not constrain, so the wizard
  would offer the tick anyway. The #597 family, exactly as T1's was.
- **A file endpoint nobody needs must not be resolved.** It was built eagerly, before
  `davFace` decided whether to ask — and Apple, having no file face, has no published file
  root, so it threw and took the whole qualification with it. Every one of the four real
  faces would have read `?` because of the one face that does not exist.
- **The file face's own sentence.** `notAFaceOf` says "not a face of this connection", which
  is true and reads as if we had not bothered. `reasonedNo` names what is actually true:
  Apple publishes no iCloud Drive API to anyone, and the Data & Privacy export is the only
  route. Workplan 0116 is that route, undecided.

Mail is measured from the published host rather than a typed one, and **deliberately not**
through `accountMailEndpoint` — the rule the passes use ends `?? stored.host`, and a soverin
connection stores its CalDAV host there, so borrowing it would point an IMAP probe at a
calendar server. #133's mistake in a new place.

Proved by breaking, five ways, each restored. Still **not measured against a live iCloud
account** — the fixtures are iCloud-shaped, not iCloud-captured.

Drafted. The owner asked (2026-09-04) for "the apple-id social button for login. and then
add apple as source to migrate away from … add the one-click button and so forth, just like
we have for Google and Microsoft now."

**Half of that already exists, and the other half cannot.** Both halves are findings, not
opinions, and this document is mostly about the second.

- **The login button is built.** `deploy/compose/setup-zitadel.sh` has configured Apple as
  an identity provider since the social-login work: four values (`IDP_APPLE_CLIENT_ID`,
  `_TEAM_ID`, `_KEY_ID`, `_PRIVATE_KEY`), the `.p8` base64-encoded because the provider's
  field is protobuf `bytes`, and a callback URL ending `/externalidp/callback/form` because
  **Apple POSTs its answer back** rather than redirecting with query parameters.
  `docs/managed-bring-up.md` §"Offering Google, Microsoft, GitHub or Apple as a second way
  in" already says which value comes from where. Nothing in T1–T8 below touches it.
- **There is no Apple consent screen for iCloud data, so the one-click button cannot be
  built.** Not "we have not built it yet" — Apple publishes no OAuth scope for Mail,
  Calendar, Contacts, Reminders or iCloud Drive to anybody outside Apple. Sign in with
  Apple grants `name` and `email`, which is an identity and not a mailbox.

### T1 landed — 2026-09-04

`normalizeDavHref` and `davPathOf` now live in `dav-http.types.ts`, and both DAV
sources' private `normalizePath` delegates to the first, so **every one of its five
call sites became host-preserving at once**: the redirect `Location`, the home-set
href, the collection hrefs in a multistatus, and both branches of
`buildCollectionPath`. CardDAV's "skip the home set itself" check compares
`davPathOf` on each side, because once the home set may carry a host and the hrefs
beside it may not, a string comparison says "different" about the same collection
and offers the home set as an address book to migrate.

Proved by breaking, four ways, each restored: host preservation removed (3 red),
`davPathOf` comparing raw strings (2 red), CardDAV keeping its own copy of the slash
logic (1 red), and the home-set skip back to string comparison (1 red).

**Not measured against a live iCloud account** — nobody here has one. The behaviour
is read from Apple's documented partitioning and from the code path; the fixture is
iCloud-shaped rather than iCloud-captured. T4's Test against a real account is what
would turn this from reasoned to measured, and until then this is a defect fixed on
reasoning, which is worth saying out loud.

### T2 and T3 landed — 2026-09-04, and the guards did NOT catch it

`apple` went into `PROVIDER_ACCOUNT_KINDS` and **the entire 6,048-test suite stayed
green.** Nineteen files named `microsoft` as a kind; `apple` was in two of them. The
database would have refused the row.

**Why 0114's guards were silent, correctly.** Every one of them pairs the kind
against the CONSENT machinery — `GRANT_PROVIDERS`, the deployment-client probes,
the `consent:` descriptors, the web's zod schema. Apple has no consent screen, so
it is rightly absent from all of them, and each guard rightly said nothing. **The
tables a kind must be in are the ones with nothing to do with consent**, and no
guard paired against those, because for `google`, `soverin` and `microsoft` the two
sets happened to overlap. `soverin` proves they need not: it has no consent either
and was added by hand, correctly, by somebody who remembered.

`scripts/a-kind-with-nowhere-to-live.unit.test.ts` closes it — the ledger enum, the
credential descriptors, the front door. Three tables, three different failures,
none of them a compile error.

**Writing the guard caught two of my own errors**, both worth recording because
both are the shape that weakens a guard until somebody deletes it:

1. A **false positive on `soverin`**, twice: the front-door and credential matchers
   searched for a quoted `'soverin'` while both maps key a kind bare when the name
   is a valid identifier. Fixed by reading the maps' KEYS rather than the file's
   text.
2. A **fourth check that demanded a `SourceConfig` union member** — which `soverin`
   failed, correctly. A kind needs `<Kind>AccountSource` only when its faces resolve
   to PROVIDER-API builders; a kind whose faces are PROTOCOL builders stores a
   protocol-shaped config and needs no member. Apple is the second of those. The
   check was removed rather than satisfied: a guard demanding a type that should not
   exist is worse than no guard, because somebody will write the type to make it
   quiet.

**The sharpest single find** was one an existing guard did catch:
`a-source-type-the-validator-never-names` requires every accepted source type to be
named in the create validator, or written down as a deliberate member of the
Azure-credentials set. Without its branch, an `apple` row would have been refused
for **a missing tenant ID and client secret** — three values that do not exist for
this provider — asked of somebody whose entire credential is an address and an
app-specific password.

Proved by breaking, four ways, each restored: apple out of the ledger enum (1 red),
out of the credential descriptors (1 red), off the front door (1 red), and the
validator branch removed (2 red).

Still open: T4 the provider-directory row, T5's refusal wording beyond the field
hint, T6 files as a measured no, T7 `docs/apple-setup.md`, T8 the wizard/Connections
surfaces beyond the card, T9 the managed gate.

### T4 landed — 2026-09-04, and T2/T3 shipped a card that could not build

Probing an `apple` row after opening its PR:

```
calendar / contact   DAV connection config is missing url/baseUrl/host
mail                 buildDepsFromMapping only supports imap-oauth2, graph-mail,
                     gmail and google mail sources, got: apple
```

That mail sentence is **verbatim 0114 T5a's**, one provider later. Every table
agreed, every guard was green, the card was on the front door and the database
would have taken the row — and not one face could be built.

**Not a `PROVIDER_DIRECTORY` row.** That table pre-fills FORM BOXES, and its own
guard holds that a row may only name boxes its door asks for; an Apple row naming
`host` would fail it, correctly, because the Apple door asks for no host. The two
tables answer different questions — *what to put in the box* versus *where to go
when there is no box* — so `PROVIDER_ENDPOINTS` is its own file, carrying the same
provenance (the page, the day) that 0105's never-guess rule requires. Nothing in
it is trusted: Test measures it like any typed value.

`davUrl` gained an optional kind and face, so a row with no endpoint of its own
reads the published root; **the stored config still wins wherever it says
anything**, so this is a fallback and never an override. The mail face needed no
new connector — `buildImapSourceFromCredentials` already accepts a plain password
and only insists on the config SHAPE, so the arm synthesises it from the published
host and the row's address.

**Two defects of my own, one caught by an existing test and one it could not
see.** The first arm matched `sourceFaceBuilder(type,'email') === 'imap'`, which
is true of `caldav` too — the face table's DEFAULT is not a CLAIMED face — so a
`caldav` source lost its honest refusal. `build-deps-from-mapping.unit.test.ts`
caught that. Narrowing to `isProviderAccountKind` exposed the second: the arm read
`stored.host`, and an account kind holds one row for several faces, so `soverin`'s
`host` is `caldav.soverin.net` while its mail lives at `mailHost`. **That builds
perfectly and fails at connect, against a calendar server.** No "did not throw"
test can see it, so the rule is now a pure exported `accountMailEndpoint` with its
own assertions.

The guard is per KIND rather than per provider, which is the lesson:
`the-microsoft-account-row-builds-its-faces` existed because Microsoft needed it
that night, so Apple was born uncovered. Adding a kind now adds its cases
automatically.

Proved by breaking, three ways, each restored: `davUrl` ignoring the published
root (3 red — apple's calendar, contact, task), the mail arm removed (2 red —
apple AND soverin), and the mail face reading `host` before `mailHost` (2 red).

## The shape Apple actually has

Apple's account is **Soverin's shape, not Google's**: protocols and a password, discovered
rather than granted.

| Face | How it is read | Credential |
|---|---|---|
| Mail | IMAP, `imap.mail.me.com:993`, TLS | app-specific password |
| Calendar | CalDAV, from `caldav.icloud.com` | app-specific password |
| Contacts | CardDAV, from `contacts.icloud.com` | app-specific password |
| Tasks | CalDAV `VTODO` — Reminders live in the calendar account | app-specific password |
| Files | **nothing** — see below | — |

That table is the whole design. `soverin` already resolves `imap` for mail and `dav` for
the other three (`source-face-builders.ts`), 0113 already reads `VTODO` out of a CalDAV
collection that declares it, and 0114's fourteen-table enumeration says exactly where a new
provider account kind has to appear. **Apple is the cheapest provider account this product
has ever added, and the least like the two before it.**

### The app-specific password is not a workaround

Apple requires two-factor authentication on every Apple Account, and a two-factor account's
own password is refused by IMAP, CalDAV and CardDAV **by design**. The app-specific password
(account.apple.com → Sign-In and Security → App-Specific Passwords) is Apple's supported
answer for third-party clients, it is scoped to the one client it was made for, and the
person can revoke it without changing their Apple Account password or disturbing anything
else. It is a worse credential than an OAuth grant in one respect — it is bearer-equivalent
and we hold it — and a better one in another: revoking it is one click on Apple's own page,
which is more than Microsoft offers (0114 found Microsoft publishes no revocation endpoint
at all).

### Tasks: the one place Apple is ahead

Apple Reminders are `VTODO` components in the same CalDAV account, so the task domain built
in 0113 reads them with no new connector. **Neither Google nor Microsoft gives us this** —
Google Tasks needs its own API and Microsoft To Do needs `graph-todo-source` (0114 T9,
deliberately out of that plan's v1). Apple will be the first provider account whose task
face works on the day it ships.

## What Apple will not give, and the two dead ends checked

### iCloud Drive: no third-party API exists

There is no API — public, partner or paid — that reads a person's iCloud Drive. CloudKit
Web Services reaches an **application's own container**, never the user's Drive, so it is
not a route for a migration tool. The `file` face is a **measured no** with a reason, in the
0106 T3a sense: an answer, not an absence of measurement, so the wizard may constrain on it
and the card shows no `?`. The only route for those bytes is the person's own Data & Privacy
export (privacy.apple.com), which is 0112's Takeout treatment for a different provider — out
of scope here and worth its own plan if anybody asks for it.

### The DMA route is real, and it is not for us

Apple, as a designated gatekeeper, must provide effective portability under **Article 6(9)
of the Digital Markets Act**, and has: an **Account Data Transfer API** that third parties
in the Apple Developer Program can apply for
(<https://developer.apple.com/support/account-data-transfer-api-eu>).

**It covers App Store data — previous transactions and downloads — and nothing else.** No
Mail, no Calendar, no Contacts, no Drive, no Photos. This was worth checking properly rather
than assuming, because a portability API from the one gatekeeper with no data API would have
changed this entire plan; it does not. Recorded here so the next person does not spend the
afternoon finding out again.

## The defect that blocks the calendar face

`CalDAVSource.parseCalendarHomeSetResponse` ends:

```ts
const value = CalDAVSource.extractHrefProperty(body, 'calendar-home-set');
return value ? this.normalizePath(value) : null;
```

`normalizePath` takes a **path** and guarantees leading and trailing slashes. iCloud answers
`calendar-home-set` with an **absolute URL on a different host**, because iCloud accounts are
partitioned across hundreds of hosts (`p34-caldav.icloud.com` and siblings). So the home set
becomes:

```
/https://p34-caldav.icloud.com/1234567890/calendars/
```

— a path, on `caldav.icloud.com`, that does not exist. Every request after discovery goes to
the wrong place.

Two things make this worth its own task rather than a line in another one:

1. **No existing provider triggers it.** Soverin and Nextcloud return same-host, path-only
   hrefs, so every DAV test in this repository passes and will keep passing. This is the
   #597 family again — a two-way assumption meeting a third provider — and the assumption
   here is not even written down: it is the *type* of `normalizePath`'s argument.
2. `resolveHref` on the line above already handles absolute URLs correctly (`if
   (href.startsWith('http://') || href.startsWith('https://')) return href`). The home-set
   parse is the one place that forgot. `carddav-source.ts` must be read for the same shape.

## Tasks

| # | Task | Notes |
|---|---|---|
| T0 | This document | The finding: no button is possible, and why |
| T1 | The home set may change host | **Done 2026-09-04.** `normalizeDavHref` and `davPathOf` in `dav-http.types.ts`; both sources delegate. Proved by breaking, four ways |
| T2 | The `apple` provider account kind | **Done 2026-09-04.** The kind, migration 0038, the credential descriptors, the front door, the validator branch, revocation and erasure, both languages. New guard `a-kind-with-nowhere-to-live` |
| T3 | The face table | **Done 2026-09-04.** Soverin's row, different provider — no new connector |
| T4 | Apple's endpoints, and a guard that builds | **Done 2026-09-04.** `PROVIDER_ENDPOINTS` (not a directory row — see below), the DAV and mail seams, `buildTaskSourceFromConnection`, `accountMailEndpoint`, and `a-face-no-account-can-actually-build` across every kind |
| T5 | The credential is an app-specific password | **Done 2026-09-04.** Fields in T2; `appleAuthRefusal` and the source probe here. New guard `a-refusal-that-blames-the-password` |
| T6 | Files: a measured no | **Done 2026-09-04.** No `qualifyApple` — the DAV family branch, given per-face endpoints, a lazy file endpoint and `reasonedNo`. New guard `a-face-measured-at-the-wrong-host` |
| T7 | `docs/apple-setup.md` | **Done 2026-09-04.** The walk-through, the no-button finding beside Sign in with Apple, Reminders, revocation at Apple. Plus **Apple's export in Apple's own words** — the owner walked `privacy.apple.com` the same day |
| T8 | Front door, icons, feature matrix, i18n | **Done 2026-09-04.** Feature-matrix rows in four domains + three gap rows. The icon half needed nothing: `apple` already carries a mark and the front-door guard already asserts every placed id wears one. Corrected the stale "Tasks (VTODO) not built" line while there |
| T9 | The managed gate | **Redirected 2026-09-04, and it found a defect instead.** No gate: the create door probes, so a sentinel Apple row would fire a bogus password at Apple nightly. The fourteenth table (`sourceConnectionConfig`) was missing `microsoft` AND `apple` — both stored as `imap-oauth2`. Fixed for every account kind, new guard `an-account-stored-as-a-product-it-is-not` |

### T5 through T9 landed — 2026-09-04

**T7's page is the first thing in this plan that is measured about Apple rather
than reasoned.** The owner opened `privacy.apple.com` and read the request
flow, which this environment's egress proxy blocks. Seven days is Apple's own
figure; the part size is a CHOICE (1, 2, 5, 10, 25 GB) and 25 GB is its maximum
rather than its unit; the export carries documents, photos and videos in
original format and contacts, calendars, bookmarks and mail as `.vcf`, `.ics`,
`.html`, `.eml`. The link's fourteen-day life is **still** unmeasured and stays
`unknown` rather than being filled in from the forums.

Two things that were written here from secondary sources are now corrected:

- *"No scheduling"* was very nearly right. Apple offers a **recurring**
  download — for App Store information and app-install activity, and for
  nothing in iCloud.
- **There are two routes.** Beside the download, `privacy.apple.com` offers a
  direct transfer to another service: **iCloud Photos → Google Photos** and
  **Apple Music playlists → YouTube Music**, and nowhere else. It is Apple's
  own service and it is better than anything this product can offer for that
  one journey, so the guide says so.

And the correction that matters most is about scope rather than fact: **the
export is not a file archive.** It carries contacts, calendars and mail in the
same interchange formats this product already reads. The live connection stays
the right route for those — incremental, no week of waiting — but 0116's reader
is reading a whole account, not a folder of documents.

**T9 did not produce the gate it asked for**, and the reason is worth keeping.
A sentinel Apple row cannot be created without reaching Apple: `POST
/api/connections` probes before it stores, and the source config schema carries
no `mailHost`, so the mail face cannot be pointed anywhere unroutable either.
Widening the product schema to make a test possible is the wrong reason to
widen it, and "never reaches Apple" has to mean provably rather than *the
runner happens to have no egress*. So the tables are asserted at unit level and
the live row is made once, by hand, in the supervised sitting.

Reading the fourteenth table to write that gate is what found the defect —
which is the wrong way round, and is exactly what T2's guard exists to prevent
happening again.

### Deliberately not in this plan

- **iCloud Drive**, for the reason above. It has no API.
- **iCloud Photos.** Same absence; Apple's own transfer service targets Google Photos, not us.
- **Any consent button for Apple data.** It would have to lie about what it does.
- **Anything touching the login IdP**, which already works.

## The rule this plan is built on

0105's never-guess rule applies to every value in T4: the hosts and ports below are Apple's
published settings, and they are **pre-filled, not trusted** — Test measures them against
the live provider exactly as it measures anything typed by hand, and a host Apple moves makes
the pre-filled Test refuse in Apple's own words.

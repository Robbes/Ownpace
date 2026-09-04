# 0115 — The account Apple will not hand over

## Status — 2026-09-04

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
| T2 | The `apple` provider account kind | `PROVIDER_ACCOUNT_KINDS`, `PROVIDER_ACCOUNT_DOMAINS` = email, calendar, contact, task; the fourteen tables 0114 enumerated |
| T3 | The face table | `ACCOUNT_FACE_BUILDERS.apple` = `{ email: 'imap', calendar: 'dav', contact: 'dav', task: 'dav' }` — Soverin's row, different provider |
| T4 | The provider directory row | `imap.mail.me.com` 993, the DAV hosts, and the username quirk: Apple's IMAP wants the local part (`johnappleseed`), falling back to the full address |
| T5 | The credential is an app-specific password | Field label and help that name it; a refusal that says an Apple Account password will not work and where to make the right one — never a bare "authentication failed" |
| T6 | Files: a measured no | `qualifyApple` answers `file: no` with the reason, and names the Data & Privacy export as the only route |
| T7 | `docs/apple-setup.md` | The app-specific password walk-through, why there is no button, what Reminders bring, and that revocation is at account.apple.com and not here |
| T8 | Front door, icons, feature matrix, i18n | The `apple` card beside the Google and Microsoft ones, en + nl |
| T9 | The managed gate | A sentinel Apple row that never reaches Apple, asserting the kind's fourteen tables agree |

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

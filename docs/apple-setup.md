# Apple (iCloud) setup — one password, four faces, and no button

An Apple migration authenticates with **one app-specific password**. There is no
consent screen to click, and that is a fact about Apple rather than a gap in
this product — the reason is below, because it is the first question everybody
asks.

What one Apple connection carries:

| Face | Carried | Over |
|---|---|---|
| **Mail** | ✅ | IMAP at `imap.mail.me.com:993` |
| **Calendars** | ✅ | CalDAV at `caldav.icloud.com` |
| **Contacts** | ✅ | CardDAV at `contacts.icloud.com` — a **different host** |
| **Reminders** | ✅ | CalDAV, as `VTODO`s — see *What Reminders bring* |
| **iCloud Drive** | 🚫 **No** | Nothing. There is no API. See *Files* |

You do not type any of those hosts. They are Apple's published values, carried
in `PROVIDER_ENDPOINTS` with the URL and the day they were read, and the card
fills them in.

## 1. Make an app-specific password

**Do not use your Apple Account password.** Every Apple Account has two-factor
authentication, and a two-factor account's own password is **refused by IMAP,
CalDAV and CardDAV by design**. It is not the wrong password; it is the right
password of a kind that cannot be used here, and retyping it more carefully
will never work.

1. Sign in at [`account.apple.com`](https://account.apple.com).
2. **Sign-In and Security** → **App-Specific Passwords**.
3. Generate one and label it something you will recognise later — `Ownpace`.
4. Apple shows it **once**, in the form `abcd-efgh-ijkl-mnop`. Copy it now;
   there is no way to see it again, and the remedy for a lost one is to revoke
   it and make another.

If you type your account password by mistake, the connection test says so in
these words rather than passing Apple's rejection through: it names this page
and explains that the password is the wrong *kind*, not wrong. That sentence
exists because Apple's own error (`AUTHENTICATIONFAILED`) tells you something
true and useless.

## 2. Add the connection

Connections → **Add** → **Apple**. Two boxes:

- **Address** — your iCloud address, `you@icloud.com`.
- **App-specific password** — paste what Apple showed you.

**Save & test.** The test asks each face at its own host — calendars at
`caldav.icloud.com`, contacts at `contacts.icloud.com`, mail at
`imap.mail.me.com` — and reports what it found, per face, with counts. A face
it could not measure says **why**, on the card, rather than showing a bare `?`.

## Why there is no *Connect with Apple* button

Google, Microsoft and Dropbox connections offer a one-click consent button. The
Apple card does not, and the difference is not effort.

**Apple publishes no OAuth scope for Mail, Calendar, Contacts, Reminders or
iCloud Drive to anybody outside Apple.** There is no consent screen to send you
to, no token to receive, and nothing for a button to do. This is not a
permission we have yet to request or a verification we have yet to buy — the
scope does not exist for third parties at all.

**Sign in with Apple is a different thing, and it does exist here.** If your
deployment offers it, you can *sign in to this product* with your Apple Account.
That grants a name and an email address: an identity, not a mailbox. It reaches
none of your data, and it is not a substitute for the connection above. Both can
be true at once and often confuse people: the button on the sign-in screen is
about **who you are**; the password on this page is about **what may be read**.

## What Reminders bring

Apple's Reminders are `VTODO` objects living on the same CalDAV host as your
calendars, so one credential reaches both — but they are **not** events, and
this product does not pretend otherwise. Tasks are their own domain, with their
own natural key and their own ledger. Filing a reminder as a calendar event
would produce something that looks migrated and is wrong.

That means the target must also carry tasks. A CalDAV target that advertises
only `VEVENT` in its `supported-calendar-component-set` cannot take them, and
the wizard says so when you pick the domains rather than failing halfway
through a run.

## Files: iCloud Drive, and why it is a *no* rather than a `?`

The Apple card shows **Files: no**, with a sentence — never a `?` and never an
empty tick box. The distinction matters: a `?` means *we could not find out*, a
**no** means *we found out, and the answer is no*.

**Apple publishes no API for iCloud Drive — to anyone, not just to us.** There
is no endpoint, no scope and no documented protocol a third party could
implement. Unlike Google Drive, OneDrive, Dropbox and Box, all of which this
product reads, iCloud Drive's contents cannot be reached from the account.

The only route to those files is **your own Data & Privacy export** at
[`privacy.apple.com`](https://privacy.apple.com), which Apple hands to *you* as
a download link. Teaching this product to take such an export and deliver it to
a target is being built, and it is a different shape of thing entirely: an
archive with a date on it, not a live account.

### What Apple's export actually gives you

From Apple's own request flow and its support page
[HT102208](https://support.apple.com/102208) (published 24 April 2026), read on
4 September 2026 — so this is measured rather than repeated. There are **two
different routes**, and people confuse them:

**Request a copy of your data** — the download. You tick categories, Apple
verifies the request came from you, and then puts the files on your Data &
Privacy page. Two clocks:

- **up to seven days** to prepare, which is the verification period;
- **fourteen days** to download once it is ready. After that Apple deletes it
  from that page and you request it again from scratch.

The maximum file size is your choice — **1, 2, 5, 10 or 25 GB** — and Apple
splits the data into parts no larger than that.

What comes back, in Apple's own description:

- **photos, videos and documents in their original formats** — the part that
  matters, and why the export is the answer for iCloud Drive;
- **contacts, calendars, bookmarks and mail as `.vcf`, `.ics`, `.html` and
  `.eml`** — ordinary interchange formats, not an Apple-only container;
- notes and reminders, which live in iCloud alongside them;
- app usage and activity as spreadsheets or `.json`, `.csv`, `.pdf`.

Timestamps throughout are **UTC**, so nothing has to be guessed from a local
offset.

Apple is unusually direct about what this is for: asked whether you can move
the data to another provider, its answer is *"Yes. We provide your data in
industry-standard formats designed to be easy to import into other services."*

### What the export does not contain, and one thing to check

- **Messages.** iMessage and SMS are encrypted on your device and cannot be
  read by anyone without your passcode. They are not in the export, and no
  migration can carry them.
- **Purchased apps, books, films, TV or music.** You get the *list* of what you
  bought; the content itself is re-downloadable from the store instead.
- **Some fields are masked.** Apple masks certain information in the files it
  hands over — card and bank details, device identifiers and **email
  addresses** — as fraud protection. Whether that masking reaches the contact
  cards themselves is **not something to assume in either direction**: it would
  make the `.vcf` files useless for the portability Apple describes above, so
  it most likely applies to the activity and transaction data. Check your own
  export before planning a contacts move around it.

### Two limits worth knowing before you start

- **It is not available everywhere.** Apple says access to this feature varies
  by country and region. If the option is not on your Data & Privacy page, it
  is not offered where you are.
- **You cannot re-request a category while one is in flight.** To ask again for
  something you already requested, wait until the current request finishes
  *and* has been removed from the page. That matters if you want a second,
  later export to catch what changed.
- If your Apple Account is **managed by a school**, the administrator has to
  permit you to sign in to the Data & Privacy page before any of this works.

A **recurring** schedule does exist, and it is narrow: in the European Union,
the United Kingdom and Japan you can schedule a repeating download — daily for
30 days, or weekly for 180 days — for **App Store information and app-install
and push-notification activity**. Nothing in iCloud can be scheduled, so an
export of your Drive or Photos is a one-off you request again by hand.

**Transfer a copy of your data** — the second route: a direct hand-off to
another service with no download in between. Apple currently offers it for
**iCloud Photos → Google Photos** and **Apple Music playlists → YouTube
Music**, and nowhere else. If your photos are going to Google, that route is
simpler than anything this product can offer; if they are going anywhere else,
it does not apply. Transfers run in both directions and their status shows on
the same Data & Privacy page.

### Which route you actually want

If you are moving **mail, calendars, contacts or reminders**, use the
connection above — it is live, it is incremental, and nothing waits a week.
The export's unique value is exactly the two faces the connection cannot
reach: **iCloud Drive and Photos**.

If somebody tells you iCloud Drive can be migrated automatically, ask which API
they used.

**One thing that is easy to misread.** Apple *does* publish a data-portability
API for people in the European Union, built for the Digital Markets Act and
open to services you authorise. It would be reasonable to assume that is the
answer here. It is not: as of 4 September 2026 that API carries **App Store
data** — your purchase history and app downloads — and no iCloud content at
all. Apple built the mechanism and pointed it somewhere else. Whether it is
ever widened to iCloud is a regulatory question rather than a technical one,
and nothing here waits on it.

## Revoking it, at Apple and not here

An app-specific password is **revoked at `account.apple.com` → Sign-In and
Security → App-Specific Passwords**, and nowhere else. Apple publishes no
revocation endpoint, so this product cannot revoke one for you and does not
claim to — deleting the connection here removes our stored copy and leaves the
password valid at Apple until you revoke it there.

The good news is that revoking one is **surgical**. It affects that password
alone: your Apple Account password is untouched, every other app keeps working,
and nothing else needs re-authenticating. That is the opposite of the usual
advice to change your account password, which is the most disruptive thing you
could do and the one action that would *not* revoke this.

Revoke it as soon as the migration is finished. Nothing here depends on it
outliving the move.

## What is measured, and what is reasoned

This product does not guess a server address or a provider's behaviour — it
measures them, or says it has not. So it is worth being plain about which
sentences above are which.

- The **hosts and ports** are Apple's published values, cited in
  `PROVIDER_ENDPOINTS` with the day they were read.
- The **absence of an iCloud Drive API** and the **absence of a data OAuth
  scope** are read from Apple's developer documentation: they are absences,
  which is exactly the sort of claim that must be re-checked rather than
  assumed to stay true.
- The **behaviour of a live iCloud account** — whether the app-specific
  password is accepted with the dashes Apple displays, whether Apple wants the
  local part or the whole address as the username, and what the face counts
  come back as — is **not yet measured**. See
  [`apple-supervised-run.md`](apple-supervised-run.md), which is the sitting
  that turns those from reasoned into measured. Until it is walked, treat this
  page as accurate about Apple's design and unproven about Apple's servers.

# The Apple account, measured — a walk-through for the owner

Workplans 0115 (the live account) and 0116 T3b (the Data & Privacy export).
The owner has an Apple Account with real data in it; this is what to do with
it. `support.apple.com` is still blocked by the agent's egress proxy, so
nothing here is read by the agent directly — the owner reads it and it is
written down with the URL and the day.

**Two of the three parts are now done.** Part 0 was walked on 2026-09-04 and
HT102208 with it; **Part 2's export arrived on 2026-09-13 and has been read**,
and what was in it is in 0116 §"What one real export answered". Part 1 — the
live account — is the one still open, and Part 3 is now a designed second
export rather than an optional one.

Findings land as dated rows in the two workplans the same day, with the URL and
the day read, exactly as `PROVIDER_ENDPOINTS` does. **An answer that is not
written down did not happen**, and an unmeasured value stays `unknown` with
words rather than becoming a confident sentence (0105).

## Part 0 is done — the owner walked it 2026-09-04

**Folded away rather than deleted**, because what it asked for is now answered
and the answers are the point. The owner opened `privacy.apple.com` and read
the request flow; everything in this section is measured, from Apple's own
screens, on 4 September 2026.

| Asked | Apple's answer |
|---|---|
| How long to prepare | *"Dit proces kan tot zeven dagen duren"* — up to seven days, used to verify the request came from you |
| Part sizes offered | **1, 2, 5, 10, 25 GB** — a choice, and 25 GB is the maximum rather than the unit |
| Link life | **Fourteen days** once the export is ready, then Apple deletes it and the request starts over (HT102208). Two clocks, not one |
| What is inside | documents, photos and videos **in original format**; contacts, calendars, bookmarks and mail as **`.vcf`, `.ics`, `.html`, `.eml`**; app usage as json/csv/pdf. No purchases of apps, books, films, TV or music |
| Can it be scheduled | **Recurring exists, and not for iCloud.** Only App Store information and app-install activity offer a repeating download |

Two corrections this forces on what was written from secondary sources:

- *"no incremental, no scheduling"* was very nearly right and not exactly
  right. Apple does offer a recurring schedule — for two App Store categories,
  neither of which is content anybody migrates.
- **There are two routes, not one.** Beside *Request a copy of your data* there
  is *Transfer a copy of your data*, a direct hand-off with no download in
  between — and it goes to **Google Photos** (from iCloud Photos) and
  **YouTube Music** (from Apple Music playlists), and nowhere else. That is
  Apple's own service, it is better than anything this product can offer for
  that one journey, and a customer moving photos to Google should be told to
  use it.

The third correction is the largest, and it is about scope rather than fact:
**the export is not a file archive.** It carries contacts, calendars and mail
in the same interchange formats this product already reads. That does not make
it the right route for them — the live connection is incremental and does not
wait a week — but it does mean an archive reader is reading a whole account,
not a folder of documents.

### The request is in flight

Fired 2026-09-04 with **iCloud Photos** and **iCloud Drive files and
documents** selected. Apple confirmed it is preparing them and will mail when
ready; status is on `privacy.apple.com/account`. Nothing more to do here for
about a week.

### What HT102208 adds, beyond the request screens

The support page (published 24 April 2026) carries three things the flow does
not, and each changes a plan:

- **The link lives fourteen days.** The last figure carried on faith is now
  Apple's own.
- **A category cannot be re-requested while a request for it is in flight.**
  You wait for the current one to finish *and* be removed from the page. That
  is a hard constraint on Part 3 below, and it means the two-export experiment
  is at least a fortnight, not a week.
- **Apple masks email addresses** in what it hands over, alongside card details
  and device identifiers, as fraud protection. **This is now a sixth question
  and possibly the most important one** — see Part 2.

<details>
<summary>The original Part 0, as written before any of this was known</summary>

## Part 0 — fire the export request FIRST, today

Everything else here takes minutes. This takes **about a week**, so it goes
first or the week is lost.

1. Sign in at **`privacy.apple.com`** → *Request a copy of your data*.
2. Tick **iCloud Drive files and documents**. Tick **iCloud Photos** as well if
   you are willing — 0112 wants the photo shape too, and one request covering
   both answers a question this repository cannot otherwise settle: *do Photos
   and Drive arrive in one archive or as separate ones?*
3. **Choose the SMALLEST part size Apple offers** (1 GB, if that is still one
   of the choices). This is deliberate and it is the one instruction here that
   matters most: a small part size forces the archive to be **split**, and how
   the parts relate is one of the five unknowns. A single unsplit zip answers
   nothing about splitting.
4. Write down, from Apple's own page and in Apple's own words:
   - the part sizes actually offered;
   - what it says about how long preparing takes;
   - what it says about how long the download link lives;
   - the exact URL you read it on, and today's date.

   The repository currently carries **7 days**, **14 days** and **≤25 GB**
   from MacRumors and community forums. They are consistent enough to plan on
   and **not good enough to say to a customer**. Your reading of Apple's page
   is what makes them sayable — or corrects them.

Then close the tab and forget it for a week. Parts 1 and 2 do not wait on it.

</details>

### On what is actually in that archive

It is your real personal iCloud. **I never need the files, and I do not want
them.** Everything 0116 T3b asks is *structural* — the shape of the tree, not
what is in it. A directory listing with the leaf names replaced by
`file-01.jpg`, `file-02.pdf` answers every question in Part 2 exactly as well
as the real names would. Keep the archive on your own machine.

## Part 1 — the live account (thirty minutes, any time)

This one does not wait for anything. It is what turns 0115 from reasoned into
measured, and it is the only way to settle four questions this repository has
been guessing at.

### 1a — mint an app-specific password

`account.apple.com` → **Sign-In and Security** → **App-Specific Passwords** →
generate one, label it `Ownpace`. Apple shows it **once**, with dashes:
`abcd-efgh-ijkl-mnop`.

Keep it in a password manager, never in this repository. You can revoke it from
the same page the moment this sitting ends, and revoking is the clean way to
undo everything below.

### 1b — the deliberate first failure

**Before** using the app-specific password, add the Apple connection with your
**ordinary Apple Account password** and press Test. It will fail — that is the
point, and it is the single most likely thing a real customer will do first.

Write down **the exact sentence the screen shows you.** It should be ours, not
Apple's: it should say the account password cannot work here because the
account has two-factor authentication, and it should name
`account.apple.com → Sign-In and Security → App-Specific Passwords`. If it
instead shows `AUTHENTICATIONFAILED` or *"invalid credentials"*, the T5 refusal
is not reaching that path and I need the raw text to find out why.

### 1c — the dash question, which nobody has answered

Now type the app-specific password **exactly as Apple displayed it, dashes and
all**, and press Test.

- **If it connects:** the dashes are fine, and the product should never touch
  them. Write down *"dashed form accepted, YYYY-MM-DD"* and we are done.
- **If it is refused:** retype it with **the dashes removed** and press Test
  again. If that connects, we have measured something real, and the product
  should strip them for people so this failure never reaches anyone else.

I was asked earlier whether to strip the dashes and said it would be a
usability win. I have **not** implemented it, because whether Apple's servers
accept the dashless form is exactly this — unmeasured. Two presses of a button
settle it.

### 1d — the username question

`provider-endpoints.ts` records that Apple sometimes wants the **local part**
(`someone`) and sometimes the **whole address** (`someone@icloud.com`), and
that it differs per account. Whichever you used above, note which one worked.
If the first is refused, try the other before concluding the password is wrong.

### 1e — what Test should then say

With a working credential, the Apple card should show four faces. Write down
**what each one actually says**, including the `?`s:

| Face | What we expect, and why it is not a certainty |
|---|---|
| **Calendars** | ✓ with a count. This is the one that exercises 0115 T1 — Apple answers the home set with an absolute URL naming *your* partition host (`p34-caldav.icloud.com`), and before T1 that became a path that does not exist. **A calendar count of 0 with no error is the old defect**, not an empty account. |
| **Contacts** | ✓ with a count, from `contacts.icloud.com` — a *different host* to calendars, which is why 0115 T6 measures each face at its own endpoint. |
| **Reminders** | ✓ with a count. Apple's Reminders are `VTODO`s on the calendar host, and the task domain (0113) is what makes them carryable. |
| **Mail** | ✓ with a folder count over `imap.mail.me.com:993`. |
| **Files** | **A reasoned "no" with a sentence**, never a `?`. It should say Apple publishes no API for iCloud Drive — to anyone, not just to us — and point at `privacy.apple.com`. That sentence is the whole reason Part 0 exists. |

If any face reads `?`, the card carries the sentence saying why (0106 T3a: an
unknown never constrains a tick). Copy that sentence down too — a `?` with a
good reason is a finding, not a failure.

### 1f — do not migrate anything yet

Stop at Test. Reading is safe; a first real run against a personal Apple
account is a separate, deliberate sitting with a scratch target, not a
by-the-way at the end of a measurement.

## Part 2 — done 2026-09-17, and three of five answered

The export was requested 8 September, arrived 13 September, and was read on the
17th. **The answers are in `docs/workplans/0116-the-data-they-give-the-person-not-us.md`,
§"What one real export answered"** — that is the record, not this file.

The short version, because it changes Part 3:

| | |
|---|---|
| **Q1 layout** | Answered. Two wrapper levels (`iCloud Drive/` → `Drive/`), then the person's own tree **intact**, Dutch folder names and all |
| **Q2 sidecars** | Answered. None. One flat `Drive Details.csv` for the whole service, **inside** the data, with **no path column** |
| **Q3 one archive or two** | Provisionally separate — the download was `iCloud Drive.zip`, named for the service. Only one service was requested, so this is not settled |
| **Q4 how the parts relate** | **Not answered.** 51 MiB against a 1 GB part size: one part, nothing to relate |
| **Q5 the export's own date** | **Not answered.** No date file was found; the only dates are the per-file ones in the CSV, and those are the upload day |
| **Q0 masked addresses** | Not answered — no `.vcf` in a Drive-only export |

**Q4 is the instruction in this document that failed**, and it is worth saying
why rather than just repeating it: picking the smallest part size does nothing
unless there is **more data than that size**. Part 3 fixes it by naming both.

The original five questions, kept because Part 3 still has to answer two:

0. **Are email addresses masked in the `.vcf` files?** Apple says it masks
   email addresses in the data it provides, as fraud protection. If that
   reaches the contact cards, **the archive route cannot carry contacts at
   all** — and a reader that imported them would produce address books full of
   blanks that look migrated. It most likely applies to the activity and
   transaction data, because masking them would contradict the portability
   Apple describes on the same page. **Guessing either way is the expensive
   mistake here.** One `grep` for `@` in one `.vcf` answers it.

1. **The layout.** What is the top-level directory tree? Do iCloud Drive files
   keep their original folder structure, or are they flattened?
2. **Sidecars.** Is there any per-file metadata beside the bytes — a JSON,
   XML, CSV or plist per file, or one index for the whole archive? Google's
   Takeout puts a `.json` beside each item; if Apple gives only bytes, then
   **created/modified dates, album membership and descriptions are simply
   gone**, and 0116 has to say so out loud rather than pretend to carry them.
3. **One archive or two.** Did Photos and Drive arrive together or separately?
4. **How the parts relate.** With the small part size from Part 0: are the
   parts *independent zips* each with their own tree, or one logical archive
   split across files that must be recombined before anything can be read?
   These need completely different readers.
5. **Dates.** Does anything in the archive say **when the export was taken**?
   0116 T7 wants to tell people an archive is a snapshot with a date, and it
   can only do that if the date is in there.

A `find . -type f | head -200` with the leaf names redacted, plus one sidecar
file if any exists (contents redacted, keys intact), answers 1–4. Question 5
usually needs a look at the top-level files.

## Part 3 — the second export (no longer optional, and now specified)

Part 2 showed the archive IS readable, which was the condition. The owner has
offered the second one: *"i uploaded the files right before i asked icloud for
my datadownload, so we might need to do more research with a second test. I
also need to add larger files to reach above the 1GB. Ill also add the other
test-files you asked for, like comma and diacritics."*

**The full contents list, with what each item settles, is in 0116 §"What export
#2 must contain".** It is kept in the workplan rather than here so it survives
this runbook. The four that are easy to get wrong:

1. **More than 1 GB of data, AND the part size set below it.** Either alone
   answers nothing. This is Q4, unanswered from export #1 for exactly this
   reason.
2. **A file with a deliberately old modified time**, put into iCloud Drive by a
   route that preserves it (a Finder drag on macOS, not the web uploader) —
   and **write down the local modified time before you upload it**. This is the
   only thing that separates "iCloud never held the date" from "the export
   drops it", and export #1 cannot.
3. **Tick two services in the one request** (iCloud Drive and iCloud Photos).
   That settles Q3 for a checkbox.
4. **An iWork document** — `.pages`, `.numbers` or `.key`. `Package Signature`
   is a column in the CSV that was empty on all seven rows, and a package that
   arrives as a DIRECTORY rather than a file is the single worst surprise a
   file reader can meet.

**And it cannot be started early:** HT102208 is explicit that a category cannot
be re-requested while a request for it is in flight, so the second request
begins only after the first is collected and off the page. The first export
expires **26 September 2026**.

Keeping the `voor-upload.csv` — name, size and locally computed SHA-256 for
every file, recorded before upload — is what turns `Base Hash` from
"SHA-256-sized" into "is or is not a SHA-256", and that one line decides
whether 0116 T6's idempotency can run off the manifest instead of unpacking
25 GB.

**And it cannot be started early.** HT102208 is explicit: a second request for
a category already requested waits until the first is complete *and* removed
from the Data & Privacy page. So the second export begins after the first is
collected — the two-export experiment is a fortnight of wall-clock, and there
is no way to run the two weeks concurrently.

## What lands where

| Measured | Written into |
|---|---|
| Apple's own wording on timings, sizes, link life | `PROVIDER_ENDPOINTS.apple.sources` + 0116, with URL and day read |
| The refusal's exact sentence (1b) | 0115 T5 status row |
| Dashed vs dashless (1c) | 0115 status row; if dashless wins, a T5 follow-up that strips them |
| Local part vs full address (1d) | `provider-endpoints.ts` comment, promoted from "not known" to measured |
| The five face readings (1e) | 0115 T6 status row — the first real qualification |
| The five archive answers (Part 2) | ✅ **2026-09-17** — 0116 §"What one real export answered", which replaced §"What is not known". Three of five; Part 3 owes the other two |

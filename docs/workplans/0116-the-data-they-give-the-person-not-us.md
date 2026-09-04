# Workplan 0116 — The data they give the person, not us

## Status — 2026-09-04 (update this block at the end of every session)

**2026-09-04: drafted for the owner's decision, nothing built.** The owner asked, after
0115 established that iCloud Drive has no third-party API at all: *"for the files part,
draft a workplan for Google Photos and iCloud Drive (possibly others later on) that helps
people through the takeout/Data&privacy export, and there exported files into Ownpace to
deliver to the target. This is a seperate large workplan."*

**This plan GENERALISES [0112](./0112-google-photos-through-takeout.md); it does not
replace it.** 0112 is a complete, still-undecided plan for Google Photos through Takeout.
Everything it says about Takeout's layout, sidecars, album duplication and the two-monthly
pickup stands unchanged and becomes the **first reader** under this frame. What 0116 adds
is the shape around it — because writing a second, Apple-shaped copy of 0112 would be this
repository's most familiar mistake in document form.

If the owner decides only one thing here, decide **D1**.

| Task | Status | Notes |
|---|---|---|
| T0 | 📋 Owner decision | §"The owner's decisions" D1–D6. Nothing below starts without D1. |
| T1 The archive, as a kind of connection | 📋 Planned | `ArchiveSource`: a source whose credential is an archive's LOCATION, not an account. Front door, wizard, connection card, probe, three-state record. Provider-agnostic. |
| T2 The reader seam | 📋 Planned (needs T1) | `ArchiveReader` — one interface, one implementation per export. Opens an archive, yields one record per distinct item: content hash, canonical path, the provider's own metadata, the folders it belonged to. No network, no target. |
| T3a The Takeout reader (Google Photos) | 📋 Planned (needs T2) | 0112 T1's reader, unchanged, behind the T2 interface. |
| T3b The Data & Privacy reader (Apple) | 📋 **Blocked on a real export** | Nobody here has opened one. T3b starts by opening one and writing down what is inside — see §"What is not known". |
| T4 Getting the archive to us | 📋 Planned (needs T1, D3) | The hard part, and it differs per provider. Google delivers into Drive/Dropbox and we already read those. **Apple hands the person a download link and nothing else.** |
| T5 Placement and the manifest | 📋 Planned (needs T2) | Where items land on the target, albums/folders as folders, and one manifest row per item so nothing the provider knew is lost. 0112 §3 is this task's design for photos. |
| T6 Idempotency by content hash | 📋 Planned (needs T2) | A second import of the same archive writes nothing; an overlapping archive writes only what is new. The file domain's existing ledger rule, applied to archives. |
| T7 Measure before the move | 📋 Planned (needs T2) | Items, bytes, folders, the export's date range on the Measured line, with the sentence that an archive is a SNAPSHOT WITH A DATE. |
| T8 The walkthrough | 📋 Planned (needs D1) | `docs/archive-import.md`: how to request each export, what to expect, how long the links live, and what the product does with it. Per provider, one page. |
| T9 The pickup (Google only) | 📋 Planned (needs T4) | 0112 T4's two-monthly incremental. **Not applicable to Apple** — see §"The two providers are not the same shape". |
| T10 The gate | 📋 Planned | A tiny fixture archive of each shape in the E2E, imported end to end, asserting item count, hashes and a second import writing nothing. |

## Why this exists

This product migrates what a provider will hand to **us**, on the person's behalf, through an
API. Two bodies of data are not on that list, for the same reason and with the same remedy:

- **Google Photos.** The full-library scopes were removed on 31 March 2025. 0112 has the
  detail.
- **iCloud Drive.** There is no public, partner or paid API for a person's Drive at all.
  CloudKit Web Services reaches an *application's own container*, never the user's files.
  0115 established this and recorded `file` as a measured `no` on the Apple account kind.

In both cases the provider **will** hand the data over — to the person, as an archive, under
the portability laws. That archive is a real, complete copy. What is missing is not the data;
it is a route from the person's download folder into a migration.

**That route is this plan.** It is worth building because it converts two flat `no`s into a
"yes, with a step you take yourself", and because the second one matters more than it looks:
macOS's Desktop & Documents sync puts a Mac's entire working life into iCloud Drive by
default, so the Apple customers most likely to want their files are exactly the ones we
currently cannot serve at all.

## The law was checked, and it does not remove this plan

The obvious objection to building an archive reader is that European law is closing this gap
and the work will be obsolete. The owner asked it directly (2026-09-04), so it was measured
rather than argued.

**Both gatekeepers already ship a DMA Article 6(9) portability API. Neither carries a single
byte of what this product migrates.**

| | The API | What it actually carries |
|---|---|---|
| **Apple** | Account Data Transfer API, EU-only, for third parties a user authorises | **App Store data** — purchase history, app downloads. No iCloud content of any kind |
| **Google** | Data Portability API, EEA-only, OAuth-scoped per resource group | Activity logs, Chrome, Maps contributions, Play, YouTube, Search UGC |

Google's scope list was read in full on 2026-09-04. Of the six domains this product carries —
mail, calendar, contacts, files, tasks, photos — **not one appears**. The two scopes that look
like photos are not: `maps.photos_videos` is what a person posted *on Maps*, and
`streetview.imagery` is Street View uploads. There is no Gmail scope, no Drive scope, no
Contacts scope, no Calendar scope, and **no Google Photos scope**.

That last absence is the load-bearing one. Google Photos now has **two independent reasons**
to be unreachable: the Library API's full-library scopes were removed on 31 March 2025, and
the portability API built specifically to satisfy the DMA does not include it either. Takeout
is not the route of last resort while we wait for something better — as of today it is the
only route there is.

Apple is the same shape with less openness around it. Google at least reaches mail, Drive,
calendars and contacts through long-standing product APIs, which this product already uses;
Apple reaches mail, calendars, contacts and reminders over IMAP and DAV and iCloud Drive not
at all. In both cases the DMA API is beside the point rather than the answer.

### What this means for the plan

- **Do not wait.** The obligation exists; the implementations point elsewhere, and widening
  them is a regulatory question with a multi-year clock, not a technical one.
- **The archive route is not a stopgap.** For Google Photos and iCloud Drive it is *the*
  route, and the law has not changed that.
- **It stays necessary even if that changes.** Both APIs are EU/EEA-only; a customer outside
  that perimeter has the archive or has nothing.

### Where the pressure actually is, for the record

Italy's competition authority opened the first national DMA proceeding against Apple on
9 June 2026, and it must conclude by 31 March 2027. It is about **Article 6(7)** — rival
consumer clouds being denied the iOS backup features iCloud enjoys — rather than Article 6(9)
portability. Adjacent problem, different article: it is about competing *with* iCloud on the
device, not reading iCloud from outside it. Worth watching, not worth planning around.

**Sources, per the never-guess rule:** `developer.apple.com/support/account-data-transfer-api-eu`
and `developers.google.com/data-portability/user-guide/scopes`, both read 2026-09-04; the
Italian proceeding from AGCM's own press release of 2026-06-16. This section states what those
pages say on that day and nothing about what they will say later.

### One claim not checked, and it would matter

It is reported — by secondary sources, not read in Google's own terms — that the Google Photos
API terms **forbid using it to build a directly competing photo service**. This product is a
migration tool rather than a photo service, so on the face of it the restriction does not
reach us; but "on the face of it" is not a reading of the terms, and a licence restriction
discovered late is expensive in a way a missing endpoint is not.

It does not block anything today, because the API route is closed to us anyway and this plan
does not use it. **It becomes a gating question the moment anybody proposes reaching Photos
through the Picker API instead of an archive** — and at that point somebody reads the actual
terms rather than a summary of them.

## The two providers are not the same shape

This is the finding that makes 0116 more than "0112 again with Apple in it". The two exports
differ in the one dimension that decides the product shape.

| | Google Takeout (Photos) | Apple Data & Privacy |
|---|---|---|
| What it covers | The chosen products | iCloud Drive documents, photos, videos, contacts, calendars, notes, bookmarks, reminders, mail |
| Preparation | Hours to days | Apple states requests are fulfilled **within 7 days**; large ones may take longer |
| Delivery | A link, **or straight into Drive, Dropbox, Box or OneDrive** | **A download link only.** No delivery into any cloud |
| Part size | Chosen | Chosen, largest part **25 GB** |
| Link lifetime | Days | **14 days** |
| Repeatable on a schedule | **Yes** — since June 2026, one export every two months for a year, each later one carrying only what changed | **No.** Every request is a fresh full snapshot |

Two consequences, and they are the whole design:

1. **For Google, the archive route can be a slow sync.** Takeout delivers into a Drive we
   already read — or a Dropbox, a OneDrive or a Box, all three of which we also read — on a
   schedule, incrementally. 0112 T4 is real.
2. **For Apple, the archive route is a CUTOVER ASSIST, not a sync.** No schedule, no
   incremental, no delivery into anything we can read. One snapshot, taken once, moved once.
   Saying otherwise would be selling a sync that cannot exist.

The product must therefore never use one word for both. An archive connection carries
**which provider's export it is**, and the surfaces say what that provider actually offers.

## What is not known, and must be measured before T3b

Per the 0105 never-guess rule, everything above about Apple's export comes from **secondary
sources** — `support.apple.com` is blocked by this environment's egress proxy, so Apple's own
wording has not been read directly. The figures (7 days, 14 days, 25 GB) are consistent across
MacRumors, iDownloadBlog and Apple's community forums and are good enough to plan on; they are
**not** good enough to put in a customer-facing sentence. T8 re-checks each against Apple's own
page, with the URL and the day read, exactly as `PROVIDER_ENDPOINTS` does.

And one thing is not known at all: **what an Apple export looks like inside.** Google's layout
is documented down to the sidecar spelling in 0112 because somebody opened one. Nobody here has
opened an Apple export. Unknown, and needed before T3b:

- the directory layout, and whether iCloud Drive files keep their original tree;
- whether there is any per-file metadata sidecar, or only the bytes;
- whether Photos and Drive arrive in one archive or as separate ones;
- how the ≤25 GB parts relate — one logical archive split, or independent zips;
- what a re-request produces for a file that has not changed.

**T3b starts by answering those five questions from a real export**, and writes the answers
into this document before any reader is built. That needs an Apple Account with real data in
it — the same thing 0115 has been waiting on.

## The design

### 1. An archive is a connection whose credential is a location

The product's existing model is *connection → credentials → faces*. An archive fits it with
one substitution: the credential is not an account but **where the archive is**. Everything
downstream — the connection card, the three-state qualification, the Measured line, the
mapping, the ledger — works unchanged.

```
kind:   'archive'
config: { provider: 'google-photos' | 'apple-icloud', placement: … }
```

`provider` is not decoration: it selects the reader, and it decides which sentences the
surfaces show. It is the field that stops Apple's card promising Google's schedule.

The probe opens the archive far enough to count and answers in the same three states as every
other connection: an archive that cannot be opened is **unknown with the reason**, never a
`no`. A password-protected or truncated download is the common case here and must read as
"we could not open this", not as "you have no photos".

### 2. One reader interface, one implementation per export

```ts
interface ArchiveReader {
  open(location): Promise<ArchiveHandle>;
  items(handle): AsyncIterable<ArchiveItem>;   // one per DISTINCT item
  summary(handle): Promise<ArchiveSummary>;    // items, bytes, folders, date range
}
```

`ArchiveItem` carries the content hash, the canonical path, the folders it belonged to, and a
provider-specific metadata bag preserved verbatim. **De-duplication is the reader's job**, not
the caller's: Takeout ships a photo once per album folder plus once per year folder, and a
caller that did not know would write it four times.

The interface is the point. A third export — Meta, Dropbox, Microsoft — is a new reader and
nothing else. Adding one must never touch placement, idempotency, the measure or the wizard.

### 3. Getting the archive to us (T4) — and why Apple is the hard one

Three placements, in order of how well they work:

| Placement | Google | Apple |
|---|---|---|
| **In a cloud we already read** | Native: Takeout delivers there. **Recommended** | Only if the person re-uploads it themselves |
| **Uploaded through the product** | Works, worst for multi-GB | **The only direct route** |
| **A local path** (self-host) | Fine on an appliance | Fine on an appliance, and probably the best Apple answer |

**And the first row is better than it looks.** Takeout's delivery choices are an emailed link,
**Google Drive, Dropbox, Microsoft OneDrive and Box** (verified 2026-09-04) — and *every one of
those four is a file source this product already reads*: `google-drive`, `dropbox`,
`graph-drive` and `box`. So for Google there is no transport to build at all. The person picks
a destination inside Takeout, connects that account here through a door that already works,
and the archive is in reach with nothing new written. Takeout can even do it on a schedule,
which is what makes 0112 T4's two-monthly pickup real rather than aspirational.

That is the asymmetry stated exactly: **Google has four zero-work delivery routes and a
scheduler; Apple has none.** Apple hands the person a link, and everything after it is ours to
build or the appliance's to sidestep. T4's difficulty is entirely Apple's half, which is worth
knowing before anybody estimates it as one task.

0112 ranked "upload through the product" last, correctly, for Google. **For Apple it may be
the only option**, which changes its priority — and raises a real engineering question this
plan does not pretend to have solved: a resumable, chunked upload of a 25 GB part through the
managed edition is its own piece of work, and on a metered egress plan it is not free.

The self-host edition has an easier answer that is worth stating plainly: the appliance runs
on the person's own machine, so the archive is already there. **A local path is the cheapest
correct Apple route and should probably be T4's first slice**, with the managed upload behind
D3.

The 14-day link window is a product constraint, not just a fact: whatever we build has to be
usable inside two weeks of the mail arriving, by somebody who is mid-migration. T8's
walkthrough should tell them to start the request *before* they need it.

### 4. What is carried, and what is honestly lost

Non-destructive toward the archive, always: its bytes are never opened for writing (hard
rule 2). Metadata travels two ways, as 0112 §3 designed for photos:

- **into the copy** where a target field exists (EXIF taken-time and GPS for photos that lack
  them; mtime for files), never into the archive;
- **into a manifest** beside the tree, one row per item, carrying everything the provider knew
  — so nothing is lost even where no target field exists.

Deliberately not attempted, for either provider: reproducing sharing state, face/people
tagging, or any provider-side "recently deleted" notion.

### 5. Idempotency, and what an archive can never tell us

Content hash in the ledger, exactly as the file domain already keys its copies. A second
import of the same archive writes nothing. Two archives that overlap write the union once.

**Deletions never propagate, for either provider.** An export says what exists; it says
nothing about what was removed. A target keeps what the source no longer has. This is stated
here, in the guide, and on the connection card — never left for a customer to discover.

## The owner's decisions

- **D1 — Build it, and in which order.** Everything is gated on this. Recommendation:
  T1+T2+T3a+T7 first (the frame, the seam, Google's reader, the measure), because that slice
  makes 0112's undecided T0 decidable by letting a customer *see* what an archive holds.
  Apple's reader (T3b) follows once an export has been opened.
- **D2 — Does this supersede 0112, or sit over it?** Recommendation: 0112 stays as the Google
  Photos instance and keeps its own decisions 2–6; 0116 owns the frame. 0112's T0 becomes D1
  here. Two plans, one build.
- **D3 — Which placement is built first, and does the managed edition accept uploads at all?**
  Recommendation: local path (self-host) and cloud-we-already-read (Google) first; the managed
  multi-GB upload is its own slice with its own egress cost, and may reasonably never be built.
- **D4 — Does an archive import become a mapping domain, or a one-shot job?** It has no
  schedule for Apple and a two-month one for Google, which fits neither the domain model nor
  the job model cleanly. Recommendation: a mapping domain for Google (the pickup is a
  schedule), a one-shot for Apple, and the `provider` field is what decides.
- **D5 — Is Apple's export offered for FILES only, or for everything in it?** Apple's archive
  also contains mail, contacts, calendars and reminders — which the Apple account kind already
  migrates live, far better. Recommendation: **files and photos only**, and the wizard says
  why: the live account is the better route for everything else, and importing both would
  duplicate a person's mail.
- **D6 — What is this called on screen?** Not "sync", for Apple. Recommendation: *"Import an
  export"* as the family, and per provider *"Google Takeout archive"* / *"Apple Data & Privacy
  export"* — the provider's own words, so a search engine and a support conversation match.

## Not in this plan

- Google Photos as a live face. Closed 31 March 2025; 0112 says so.
- iCloud Drive as a live face. No API exists; 0115 says so, as a measured `no`.
- Deletions, for either provider.
- Immich as a photo target (0112 decision 2's runner-up; its own plan when chosen).
- Any provider beyond these two. The reader seam exists so a third is cheap; naming one here
  would be planning work nobody has asked for.

## Definition of done, per task

The repo's rules apply unchanged: gates green; the guide updated in the same PR as the code;
no secrets; idempotency proved (a second import writes nothing); non-destructive proved (the
archive is never opened for writing); self-host intact (readers and the source kind belong in
`packages/`, never `packages/managed`); the three-state record and Measured line on the
connection like every other kind; and every published figure about a provider's export
carrying its source URL and the day it was read, per 0105.

## Sources

- Workplan [0112](./0112-google-photos-through-takeout.md) — Takeout's layout, sidecars, album
  duplication, the two-monthly incremental schedule, and its own sources.
- Workplan [0115](./0115-the-account-apple-will-not-hand-over.md) §"iCloud Drive: no
  third-party API exists".
- Apple's Data & Privacy export, **secondary sources only** (`support.apple.com` is blocked by
  this environment's egress proxy — T8 must re-check against Apple's own page, with the URL
  and the day read):
  - MacRumors, *Get a Copy of Your Apple Account Data — Here's How*
    <https://www.macrumors.com/how-to/get-a-copy-of-your-apple-account-data/> (read 2026-09-04)
  - iDownloadBlog, *How to download all your personal data from Apple*
    <https://www.idownloadblog.com/2024/03/21/get-personal-data-from-apple/> (read 2026-09-04)
  - Apple Support, *Get a copy of the data associated with your Apple Account*
    (`support.apple.com/en-us/HT208502`) and *Archive or make copies of the information you
    store in iCloud* (`support.apple.com/en-us/108306`) — **cited, not read**, for the reason
    above.

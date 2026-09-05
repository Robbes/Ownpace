# Workplan 0116 — The data they give the person, not us

## Status — 2026-09-04 (update this block at the end of every session)

**2026-09-04, the first slice is BUILT.** T1+T2+T3a+T7 all landed. An export archive is a
connection kind whose credential is a location; the reader seam takes one implementation per
export; Google's Takeout reader is behind it; and the measure reads items, bytes, folders and
the export's date span off the same `summary()` an import would iterate.

Two properties hold from the first commit and both are proved by breaking them: **an archive
that could not be opened is `unknown` with the reason, never an empty archive** — a truncated
25 GB download must never read as *you have no photos* — and **the provider is checked by
name at every door**, because the wrong reader does not fail, it finds none of its own
landmarks and reports nothing.

What is deliberately NOT built is migrating FROM one (T5, T6). The create door refuses an
archive source by name saying NOT BUILT rather than *not supported*; the file seam has an
`archive` arm that throws rather than falling through to `dav`; and the wizard does not offer
the card at all, enforced by the compiler rather than by a filter. The Connections page does
offer it, where every answer it gives is true.

T7 carries §4's price out loud: the item count legitimately EXCEEDS what Google Photos tells
the person they have, so the Measured line breaks it down — originals, edited versions,
motion clips — and says why in the same breath, before they can be surprised by it.

**2026-09-04, later again: two more owner answers folded in.** Edited versions and motion
clips are **distinct items carrying a link to their original**, not attributes of one record —
because Google Photos shows the edited version by default, so a single-record design discards
the very version the person means to keep. And the unzip question is answered per edition:
appliance unzips (there is no upload), managed keeps it zipped (a 25 GB stream beats tens of
thousands of small files, and the zip's per-entry CRCs are an integrity check a loose tree
throws away). Both converge on one open decision — **whether to take an archive dependency so
a zip can be read without extracting** — which gates the managed edition and nothing else.

**2026-09-04, later still: §5 rewritten as T6's design** after the owner asked whether the
content hash could carry the delta across a series of exports. It can, it is the only thing
that could, and the ledger already remembers what is needed — but absence between two archives
is weaker evidence than this product's weakest deletion class, so the delta **may only add**.
Two ways it can be wrong are recorded, one of them measurable against the export now in
flight.

**2026-09-04, later: all six decisions answered, still nothing built.** The owner took every
recommendation, D5 confirmed explicitly as *files and photos only*. **The first slice is
T1+T2+T3a+T7** — the frame, the reader seam, Google's Takeout reader, and the measure —
because that slice is what makes 0112's own long-undecided T0 decidable: a customer can
finally *see* what an archive holds before anyone commits to importing it. T3b stays blocked
until an Apple export has actually been opened; the owner's was requested the same day.

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
| T0 | ✅ **Answered 2026-09-04** | All six decided — see §"The owner's decisions". The first slice is **T1+T2+T3a+T7**. |
| T1 The archive, as a kind of connection | ✅ **Built 2026-09-04** | `ArchiveSource`: a source whose credential is an archive's LOCATION, not an account. Front door, wizard, connection card, probe, three-state record. Provider-agnostic. |
| T2 The reader seam | ✅ **Built 2026-09-04** | `ArchiveReader` — one interface, one implementation per export. Opens an archive, yields one record per distinct item: content hash, canonical path, the provider's own metadata, the folders it belonged to. No network, no target. |
| T3a The Takeout reader (Google Photos) | ✅ **Built 2026-09-04** | 0112 T1's reader, unchanged, behind the T2 interface. |
| T3b The Data & Privacy reader (Apple) | 📋 **Blocked on a real export** | Nobody here has opened one. T3b starts by opening one and writing down what is inside — see §"What is not known". |
| T4 Getting the archive to us | 📋 Planned (needs T1) — **D3 decided: local path + cloud-we-already-read first** | Difficulty is entirely Apple's half. Takeout delivers to Drive, Dropbox, OneDrive **and Box** — every one already a source we read — so Google needs no transport built. **Apple hands the person a download link and nothing else.** The managed multi-GB upload is its own slice and may never be built. |
| T5 Placement and the manifest | 📋 Planned (needs T2) | Where items land, albums/folders as folders, one manifest row per item. 0112 §3 is the photo design. **Decided 2026-09-04:** edited versions and motion clips are distinct items linked to their original, never attributes of one record — §4 says why. |
| T6 Idempotency by content hash | 📋 Planned (needs T2) | A second import writes nothing; an overlapping archive writes only what is new. The file domain's existing ledger rule, applied to archives — **and the delta across a series of archives**, which needs no new store. §5 carries the design, including the rule that an archive delta may only ADD. |
| T7 Measure before the move | ✅ **Built 2026-09-04** | Items, bytes, folders, the export's date range, and the sentence that an archive is a SNAPSHOT WITH A DATE. **Breaks the count down** — originals, edited versions, motion clips — because the total legitimately exceeds what Google Photos tells the person they have (§4). |
| T8 The walkthrough | 📋 Planned | `docs/archive-import.md`: how to request each export, what to expect, how long the links live, and what the product does with it. Per provider, one page. |
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

#### Should the person unzip it first? Appliance yes, managed no

**Asked by the owner 2026-09-04, and the answer differs by edition — which is why it is worth
writing down rather than deciding twice.**

**On the appliance: unzip, and it costs nothing.** There is no upload at all; the archive is
already on the person's disk. They extract it, point the appliance at the folder, and the
reader (T3a) takes exactly that today. This is the natural path and the reason D3 put the
local path first.

**On the managed edition: keep it zipped, and the reason is not the one people expect.** A
Takeout archive holds JPEGs, HEICs and MP4s, which are *already compressed* — the zip is a
container rather than a compressor, and unzipping saves almost no bytes. What it does is turn
**one 25 GB stream into tens of thousands of small files**: one connection becomes tens of
thousands of round trips, and a byte-offset resume becomes per-file bookkeeping. Over a slow
or lossy link that is dramatically worse, and the multi-gigabyte upload is already the hardest
part of T4.

There is a second reason, and it is about honesty rather than speed: **a zip carries a CRC per
entry.** A truncated or corrupted transfer is detectable. Extracted to a loose tree, that check
is thrown away — and this plan's whole posture is that a part-finished download must be
distinguishable from an empty library.

**For Google, the better answer is not to upload at all**: Takeout delivers into Drive,
Dropbox, OneDrive or Box, every one of which is already a source this product reads. Nothing
is uploaded and nothing is unzipped by hand.

#### The one piece of work all of this converges on

Every managed route — the zip sitting in someone's Drive, and the zip they uploaded — needs
the same capability: **reading inside a zip without extracting it.** T3a deliberately does not
have it; it takes an extracted directory, because adding an archive dependency is a
supply-chain decision and not one to take inside a first slice.

That decision is **open and belongs to the owner.** It is a small, well-understood category of
library, and the appliance route works without it — so it gates the managed edition of this
feature and nothing else.

**Apple stays the hard case whatever is decided.** Its export is a download link and nothing
else: no delivery into a cloud we read, so for Apple-on-managed it really is upload-or-nothing.

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

#### Edited versions and motion clips: everything is written, and linked

**Decided by the owner 2026-09-04, and it is a data-loss question rather than a tidiness
one.** Takeout ships an edited photo as `<name>-edited.<ext>` beside the original, and a
motion photo as a JPEG plus an MP4 with the same stem.

The tempting design — 0112's phrasing — is **one record with `hasEdited: true`**. It has a
trap: **Google Photos shows the EDITED version by default.** It is the one the person has
been looking at for years and thinks of as their photo. A single record that writes the
original's bytes therefore discards exactly the version they meant to keep, and nothing
anywhere reports it. A motion clip is a different case again: an MP4 is not a duplicate of a
JPEG by any reading.

So each is **a distinct item with its own hash and its own bytes**, carrying a `relatedTo` in
its metadata naming the original it belongs to. Nothing is lost, placement gets to decide
what to do with the relationship (side by side, or edits in a subfolder), and the worst case
is a slightly noisier folder — **visible, and something a person can undo.** The alternative's
worst case is silent data loss, which is neither.

The consequence has to be priced in rather than discovered: **the item count will exceed what
Google Photos tells the person they have.** A three-thousand-photo library may measure as four
thousand items. T7's Measured line breaks that down — originals, edited versions, motion clips
— instead of showing one number that reads as an error.

Deliberately not attempted, for either provider: reproducing sharing state, face/people
tagging, or any provider-side "recently deleted" notion.

### 5. Idempotency, the delta across archives, and what an archive can never tell us

Content hash in the ledger, exactly as the file domain already keys its copies. A second
import of the same archive writes nothing. Two archives that overlap write the union once.

#### The delta needs no new machinery, and could use nothing else

Takeout ships **no manifest, no cursor and no change feed**. Between two archives the content
hash is the only identity they share, so it is not merely *a* way to find what is new — it is
the only one available.

And the memory already exists. The delta is **not** archive N diffed against archive N+1 —
that is impossible anyway, because N's download link expired. It is:

> read archive N+1, ask the **ledger** whether each hash is known, import the unknown.

Which is T6 as already written, and it makes T9's pickup nearly free: no second store, no
retained archives, no bookkeeping the file domain does not already do.

#### The rule that makes it safe: an archive delta may only ADD

**Absence between two archives is not evidence of deletion, and it is weaker than this
product's weakest class.** `DeletionEvidence` ranks `reported` > `trashed` > `inferred`, and
`ports.ts` is explicit that *only the first two may ever gate a destructive action*. An archive
supplies neither: nothing reports a removal, and there is no bin to look in.

It does not even reach `inferred`, which means `DELETION_CONFIRMATIONS` consecutive **complete
scans of the source**. An archive is not a scan. It is a snapshot whose scope the person chose,
whose parts may have failed to download, and whose categories they may have deselected between
requests. Deleted, deselected and truncated present identically.

So the rule is absolute and belongs in the code rather than in a reviewer's memory: **an
archive import adds and updates; it never removes, and it does not report a removal as a
suspicion either.** A target keeps what an archive no longer mentions. Stated here, in the
guide, and on the connection card — never left for a customer to discover.

#### Two ways the delta can be wrong, and only one is cheap

**A re-encoded item reads as a new one.** If Takeout re-compresses, or rewrites EXIF, or
changes a container between exports, the bytes change and so does the hash — and the delta
reports as new an item already held. This is the shape of a lesson this repository has already
paid for once: `contentHashFor` was **withdrawn** for calendar and contacts (#143) because
CalDAV servers re-serialize what they store, so a hash computed on the source can never equal
one computed off the target. Files are *usually* carried byte-for-byte through Takeout.
**"Usually" is exactly the word that has to be measured before T6 leans on it** — two archives
of an unchanged library, and every hash equal, or this section is wrong.

**A metadata-only change is invisible.** Rename an album, edit a description, move a photo
between albums: the bytes are identical, the hash is identical, and the delta says nothing
happened. That is the correct answer for *content* and the wrong one for *organisation*.
Whether album membership should follow a later archive is a real question and not answered
here; the seam preserves `metadata` verbatim precisely so it stays answerable.

#### The cadence is the provider's, not ours

Google's scheduled export is **every two months for a year**, so the natural pickup is
bi-monthly rather than monthly — the schedule is Takeout's and this product only reads what
lands. **Apple has no cadence at all**: every request is a fresh full snapshot, nothing can be
scheduled, and a category cannot be re-requested while a request for it is in flight, so two
Apple exports are a fortnight apart at best. That asymmetry is D4's whole reason for a mapping
domain on one side and a one-shot on the other.

## The owner's decisions

> **All six answered by the owner on 2026-09-04, each taking the recommendation.**
> They are kept in full below — a decision is worth less without the reasoning it
> was made against, and the recommendations are what was actually agreed to.

- **D1 — ✅ DECIDED: build it, recommended order.** Everything is gated on this. Recommendation:
  T1+T2+T3a+T7 first (the frame, the seam, Google's reader, the measure), because that slice
  makes 0112's undecided T0 decidable by letting a customer *see* what an archive holds.
  Apple's reader (T3b) follows once an export has been opened.
- **D2 — ✅ DECIDED: sits over 0112.**  Recommendation as agreed: 0112 stays as the Google
  Photos instance and keeps its own decisions 2–6; 0116 owns the frame. 0112's T0 becomes D1
  here. Two plans, one build.
- **D3 — ✅ DECIDED: local path and cloud-we-already-read first.**  Recommendation as agreed: local path (self-host) and cloud-we-already-read (Google) first; the managed
  multi-GB upload is its own slice with its own egress cost, and may reasonably never be built.
- **D4 — ✅ DECIDED: mapping domain for Google, one-shot for Apple, `provider` decides.** It has no
  schedule for Apple and a two-month one for Google, which fits neither the domain model nor
  the job model cleanly. Recommendation: a mapping domain for Google (the pickup is a
  schedule), a one-shot for Apple, and the `provider` field is what decides.
- **D5 — ✅ DECIDED: files and photos only.** Apple's archive
  also contains mail, contacts, calendars and reminders — which the Apple account kind already
  migrates live, far better. Recommendation: **files and photos only**, and the wizard says
  why: the live account is the better route for everything else, and importing both would
  duplicate a person's mail.
- **D7 — ⏳ OPEN: do we take an archive dependency, so a zip can be read without extracting
  it?** Created by the 2026-09-04 answers rather than present from the start. **It gates the
  managed edition of this feature and nothing else** — the appliance route works without it,
  because there the person extracts the archive themselves and T3a reads a directory today.
  Every managed route needs it and needs the same thing: the zip in someone's Drive, and the
  zip they uploaded, are both zips. It is a small, well-understood category of library; it is
  still a supply-chain decision and so it is yours. Recommendation: **defer it** until the
  appliance route has carried a real archive, because the measurement may change what is
  wanted, and nothing before T4 is blocked.
- **D6 — ✅ DECIDED: "Import an export", with the provider's own words beneath.** Not "sync", for Apple. Recommendation: *"Import an
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

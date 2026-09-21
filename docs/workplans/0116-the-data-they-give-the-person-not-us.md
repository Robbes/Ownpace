# Workplan 0116 — The data they give the person, not us

## Status — 2026-09-20 (update this block at the end of every session)

**2026-09-20: D7 decided — C, our own reader — and its first slice built.** The owner, asked
to choose between the reader and a library: *"C or D, because I don't want to keep someone
depending on other US cloud SaaS."* C over D because a custody product should not add a
dependency to read what it already understands, this repository already held two in-memory
zip readers (the export-members script and the container hash) that only lacked random
access and zip64, and we only ever READ — a parser that is wrong fails to produce a member,
loudly. The first slice is `packages/connectors/src/zip-archive.ts`: a zip read **where it
lies**, through a random-access source (a file today; whatever answers a byte range on the
managed edition), end record from the tail, central directory from where it points, one
member at a time inflated as a stream and checked against the CRC-32 and size the directory
recorded; zip64 records read; **a spanned set refused with a sentence from the end record's
own disk fields**, so the parts question below is answered by the product on the first real
export rather than by a guess. Proved against archives a test-side writer builds shape by
shape, and by breaking it four ways. Not yet in this slice: the Takeout reader over a zip
(it still reads an extracted tree), and the managed transport — where a customer's archive
sits — which waits on the owner's answer to *two-step* (they upload it into their own
target, we read it there by byte range), *relay* (a resumable upload through Ownpace
straight into the target, nothing stored) or *store* (an upload we hold, against the
custody promise).

**2026-09-20, later the same evening: the second slice — the Takeout reader reads the `.zip`
where it lies.** A tree seam (`packages/connectors/src/archive-tree.ts`: five questions — is
this a folder, what is in it, a whole small file, a stream, close) now sits between the reader
and the bytes, with a folder tree (what the reader did before) and a zip tree over the D7
reader. The location decides: a folder is read as before; a `.zip` is opened in place; and a
multi-part download is ONE tree from any one of its parts — Google's `-001`, `-002`, … after
one stamp, each part a complete zip, the photo tree split across them by file, so the collapse
by content hash meets an album's copy in part 1 and the year copy with its sidecar in part 3
exactly as it does on disk. **A gap in the numbering is refused with the missing part named**,
because an import that carried most of a library and said nothing would be the silent kind of
wrong §1 exists to prevent; a last part that never arrived leaves no gap, and the guide says
to count. Hashing streams now rather than `readFile`, on both trees, so a video over two
gigabytes no longer trips Node's read cap; and the file source holds no descriptor between
reads, because a pass never closes its `FileSource`. Proved by one fixture laid out four ways
(folder, one zip, two parts pointed at either part) answering identically, item for item —
which found that the order of `folders` and `metadata.albums` followed the container's
listing order, now sorted — and by the refusals: a zip with no Takeout inside, a download cut
short, a member whose bytes fail their CRC-32, a `.tgz`, a part missing from the middle. The
wizard's hint and the guide say "the folder or the .zip". The self-host gate imports the
extracted fixture and, since later that night, **the same Takeout as a two-part `.zip` written
by Info-ZIP** (checked in, under two kilobytes): read in place on the appliance, imported into a
subfolder of the same account, and compared file for file and manifest for manifest with the
folder route — the same two parts being the one zip in the unit tests that our own writer did
not make. The managed transport is unchanged and still waits on the owner's word.

**2026-09-20, late: T4's managed half decided — relay.** Put the three doors to the owner
(*two-step*: the person uploads the export into their own target and we read it there by byte
range; *relay*: a resumable upload through Ownpace streamed straight into the target, nothing
stored; *store*: an object store on our stack). The owner: *"They might not have a Nextcloud!
So we can not offer that just so easy. I pick Relay."* And asked how to do it efficiently —
complete zip files, or read from them and carry only the files. The answer, and the design, are
in §3 "The relay, as decided": complete parts, relayed through us into whatever file target the
migration writes to, never to our disk, and read there in place by the reader that merged
tonight; 1 GB parts; the parts left where the relay put them until the person deletes them.
Three slices, the first of which needs no upload at all. **Slice 1's reading half followed the
same night:** the store seam under the reader, the appliance's disk on one side and a WebDAV
file target on the other (PROPFIND, a folder tree, a `Range`-reading source in 8 MiB windows),
proved against a fake Nextcloud with the two Info-ZIP parts and the extracted folder inside
it. **The owner answered the same night** how a managed archive connection's Test should
behave when no migration has named a target yet — *"Ok, this is correct"* — and added the
constraint the rest of the relay is built under: *"We do however have to anticipate people
might have other targets then nextcloud for files or photo's."* So the Test says what it can
without a target and the counts come at the preflight, and nothing in the store may assume
Nextcloud; see §3 "They might not have a Nextcloud.". **Both were built the same night**, which
finishes slice 1: `ArchiveSource.where` says which store a location is in (`disk`, the default
that leaves every existing mapping meaning what it meant, or `target`), both pass builders hand
an archive the migration's own file endpoint, a JMAP target is refused by sentence because it
cannot serve a byte range, and a Test with no migration in hand answers
`countedAtPreflight` — unknown, never a measured no.

**2026-09-17: an Apple export exists and has been read (T3b unblocked).** The owner requested
one on 8 September and it arrived on the 13th; §"What one real export answered" is what was in
it, provisional and labelled so. The headlines: the person's tree survives intact under two
wrapper levels; there are no sidecars, only one flat `Drive Details.csv` **inside** the data
with no path column at all, so the tree comes from the walk and the CSV is joined onto it;
`Base Hash` is 32 bytes, SHA-256-sized and unverified. Two of T3b's five questions could not be
exercised — 51 MiB against a 1 GB part size means no multi-part split, and one request means no
re-request — and the section now carries the contents export #2 must have to close them, which
matters because **this download expires 26 September 2026**. One finding written earlier that
day, that modified times cannot be carried, was over-stated and is corrected in place: the
export did not stamp those rows, so whatever was lost was lost at upload, and only a file with
a deliberately old mtime can separate the two live explanations. Unprompted, and the reason a
reader is not being written yet: the timestamps are consistent with **US Pacific, not the
person's timezone**, which would put a naive parse nine hours out.

**2026-09-05, the second slice is BUILT: an archive mapping actually imports (T5 + T6).**
`ArchiveFileSource` makes whatever a reader answers look like any other file source, so the
file domain's loop, ledger and targets copy out of an export exactly as they do out of a Drive.
The reader seam grew the two members the import needed and nothing else: `placeIn` (which of
an item's folders are the PERSON's — placement's whole input) and `content()` (the bytes, by
item, so placement never has to know an archive's layout). A third export is still a new
reader and nothing else; this file has no `switch` on `provider`.

**Placement, as built.** Every album is a folder under the import root and a photo in several
albums is written under each (0112 decision 5). A photo in an album is NOT written under its
year as well; a photo in NO album lands under its year — the only home the export gave it, and
the alternative is thousands of files flat at the root where two cameras' `IMG_0001.jpg`
collide. **That second half is a reading of 0112 §3 the owner confirmed on 2026-09-20** ("confirmed"): §3 says the
year folder is not reproduced, and this build takes that to be about a photo that has an
album. Edited versions and motion clips are placed like any item, beside their originals. One
manifest at the root — `export-archive-manifest-<fingerprint>.json`, fingerprinted by the
archive's hashes so the same archive is the same file — carries everything the export knew
about every item: sidecar verbatim, every folder, kind, `relatedTo`. EXIF into the copy is
still 0112 T3 and not touched.

**Idempotency and the delta needed nothing new (T6, §5)**, which was the claim and is now the
proof: the ledger's existing path-plus-hash rule skips a second import entirely (0 created, all
skipped, nothing fetched) and writes only what is new in a later export. **The rule that an
archive delta may only ADD found the one place it could have broken**: the loop's
absence-counting runs on every cursor-less pass — the exact shape of an archive import — and a
source that merely declined `listKeys` would still have been counted there. So `FileSource`
grew `snapshot`, `ArchiveFileSource` sets it, and `runDomainSync` starts a snapshot's pass with
absence-counting off. Proved through the real loop and the real Takeout reader: Y missing from
the later export across more passes than a live account needs to call an absence a deletion —
drift 0, deletions none, Y still on the target; and the control with the flag stripped counts
it at once.

**The doors opened.** The create door's NOT-BUILT refusal is gone (its guard is renamed and
now holds the door open, including a reused connection being asked for the path and not the
provider); the wizard offers the card, pins the file domain and a file-capable target, asks
which export as a choice and where it is as a path, and demands no username of a kind that has
none. `docs/archive-setup.md` gained *Moving it* — where things land, doing it twice, and the
sentence that nothing is ever removed because an export no longer mentions it.

**Found on the way, fixed in #787 (stacked under this):** E2E (managed) #154 — the first run
ever to post an honest archive body to `POST /api/connections` — was refused for a `username`
the kind does not have. The connections door now follows the descriptor, refuses an unknown
export by name, and the add-form renders "Which export" as a choice.

**2026-09-05, later: T10's import half, and the hole it found on its first read.** The
import is gated in the SELF-HOST E2E, not the managed one, and the reason is a measurement
worth keeping: the managed edition's run containers get a network and nothing else, so a
folder the API can read is not a folder a pass can read — a local path is the appliance's
route alone (T4). The gate mounts a five-file Takeout read-only into the appliance, loads a
second mapping PAUSED beside the main one, green-lights it in the LAST gate so nothing it
writes is on the target while the other gates measure it, and asserts against the real
Nextcloud: the album copy is there, the year duplicate is not, the manifest reads back with
the sidecar in it, and a second pass writes nothing. Writing it found that the APPLIANCE's file
arm had no `archive` case — T5/T6 wired the managed seam only, so an archive mapping on the
appliance would have been handed to the DAV resolver and refused for a URL it never had. Fixed
in the same change; the gate is what would have said so.

**2026-09-05, the gate's first run: the second mapping was the first.** The import itself
landed every file where the gate expects it — and the gate read back 27 items for a five-file
archive, then a 409 saying the mapping was already `done`. The main mapping's count and the
main mapping's finish. The appliance's `uuidFromString` kept only the first sixteen bytes of
its seed, and every seed begins with the 36-character tenant id, so every id it derived for a
tenant was the same value: the source connection, the target connection, both mailboxes, and
the mapping — a second mapping in a tenant shared the first's row, status, ledger and finish.
Nobody saw it because every appliance had exactly one mapping. Fixed by hashing the whole
seed, with a claim at boot so an appliance upgraded in place keeps the row it already has
(the quickstart promises the in-place upgrade; the mapping's config id is recorded on the row
as `name`, and a mapping added later cannot walk off with another's history). Pinned against
the real appliance on PGlite: two mappings in one tenant have two rows, and an upgraded
appliance boots into its old row active rather than a fresh one paused.

**What is left.** T3b still waits on an Apple export; T4's managed half is decided (relay, 2026-09-20 — §3 "The relay, as decided") and not built; T9 on T4.

### Earlier — 2026-09-04

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

T8 landed with it, and closed a hole T1 had opened: the create door's refusal already told
people to read `docs/archive-import.md`, **which did not exist**. It is `archive-setup.md`
now, because that suffix is what the app actually serves at `/docs`, and the end-user guard
was widened so a guide that never says WHICH export or WHERE it is fails there rather than in
front of somebody at step four.

**T10's connect-and-measure half is in the managed gate**, and it earned its keep before it
ever ran: writing it found that `qualifyArchive` had been wired into the dispatch chain while
a guard one function earlier returned before the chain ran, so the Measured line was dead code
and nothing was red. The archive is the one source this gate can drive COMPLETELY — a fixture
export tree needs no account, no consent and no network — which is why it is net-positive
where the Apple block can only be net-zero. The IMPORT half of T10 still waits on T5/T6.

**What is left, and what it waits on.** T3b needs an Apple export somebody has opened. T4's
managed half is gated by D7 below, the one decision still open; its appliance half is what T1
already does, since a local path is the whole of it. T5 and T6 are the next SLICE rather than
the next task — they turn "connect and measure" into "actually imports", and the create door's
refusal comes out when they land.

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
| T3a The Takeout reader (Google Photos) | ✅ **Built 2026-09-04; reads the `.zip` in place since 2026-09-20** | 0112 T1's reader behind the T2 interface. Since D7's second slice it reads the download itself — one `.zip`, or every part of a multi-part download from any one of them — or the extracted folder, through the tree seam in `archive-tree.ts`, and answers identically over both. |
| T3b The Data & Privacy reader (Apple) | 📋 **Unblocked 2026-09-17 — designed on one export** | An export has been opened and what is in it is written down: see §"What one real export answered". Two of its five questions were not exercised (the multi-part split, the re-request) and the date parsing is an inference, so the reader waits on export #2 — whose contents are specified in that section. |
| T4 Getting the archive to us | 📋 Planned (needs T1) — **D3 decided: local path + cloud-we-already-read first.** **Measured 2026-09-05:** the managed edition's run containers get a network (`DOCKER_RUNNER_NETWORKS`) and nothing else — no volume shared with the API — so a local path can never reach a managed pass. The local path is the appliance's route alone; on managed the archive has to arrive through a cloud this product reads, or an upload (D7). **2026-09-20:** on the appliance the download itself is the route — the person points at the `.zip`, or at any part of a multi-part set, and nothing is extracted. **Managed half decided the same night: relay** — the parts uploaded through Ownpace straight into the customer's file target, read there in place; §3 "The relay, as decided" has the design and the three slices. **Slice 1's reading half built 2026-09-20:** an archive store seam under the reader (`archive-store.ts`: the appliance's disk, or a WebDAV file target in `webdav-archive-store.ts` — PROPFIND for what is where, a folder tree for an export extracted into the target, and a `Range`-reading source with 8 MiB read-ahead windows for the zip; a target that answers a range request with the whole file is refused by sentence). Proved with a fake Nextcloud: the two Info-ZIP parts and the extracted folder inside the target answer exactly what they answer on disk. **Wired the same night, on the owner's answer:** `where` on the archive source (`disk` by default, `target` for an archive inside the migration's own file target), both pass builders resolving the target's own file endpoint — `fileBaseUrl`, Nextcloud's `files/{user}/` and all — into `webdavStore`, a JMAP target refused by sentence since it cannot serve a byte range, and the Test answering `countedAtPreflight` where no migration names a target yet. **Gated on the real stack the same night:** a fourth self-host gate (`selfhost-archive-in-target-import.e2e.test.ts`) puts the two Info-ZIP parts into the e2e Nextcloud itself — nothing mounted, no local path — and imports them from there by byte range, then compares the four placements and the manifest with what the extracted-folder route wrote, and checks the parts are byte-identical afterwards (hard rule 2: the moment the relay lands a part in the customer's storage, that part IS the source). What is NOT built: a control in the wizard that says *it is in my target* — that arrives with the relay page (slice 2), which is what will set `where` for the people the relay is for. **Owner, 2026-09-20:** *"Ok, this is correct"*, and *"we do however have to anticipate people might have other targets then nextcloud for files or photo's"* — so every rung of the relay is written against the target the migration names, whatever kind it is. | Difficulty is entirely Apple's half. Takeout delivers to Drive, Dropbox, OneDrive **and Box** — every one already a source we read — so Google needs no transport built. **Apple hands the person a download link and nothing else.** The managed multi-GB upload is its own slice and may never be built. |
| T5 Placement and the manifest | ✅ **Built 2026-09-05** | `ArchiveFileSource` over the seam's new `placeIn` and `content()`: albums as folders, a photo written once per album (0112 decision 5), a photo in no album under its year, one fingerprinted manifest at the root with everything the export knew. Edited versions and motion clips are distinct items linked to their original (decided 2026-09-04, §4). EXIF into the copy stays 0112 T3. |
| T6 Idempotency by content hash | ✅ **Built 2026-09-05** | Nothing new: the ledger's path-plus-hash rule, proved through the real loop — a second import writes nothing, a later export writes only what is new. **An archive delta may only ADD** is enforced by `FileSource.snapshot`, which switches the loop's absence-counting off; proved with the flag on and, as the control, stripped. |
| T7 Measure before the move | ✅ **Built 2026-09-04** | Items, bytes, folders, the export's date range, and the sentence that an archive is a SNAPSHOT WITH A DATE. **Breaks the count down** — originals, edited versions, motion clips — because the total legitimately exceeds what Google Photos tells the person they have (§4). |
| T8 The walkthrough | ✅ **Built 2026-09-04** | `docs/archive-setup.md` (the `-setup` suffix is what the app serves at `/docs`): how to request each export, what to expect, how long the links live, and what the product does with it. Per provider, one page. |
| T9 The pickup (Google only) | 📋 Planned (needs T4) | 0112 T4's two-monthly incremental. **Not applicable to Apple** — see §"The two providers are not the same shape". |
| T10 The gate | ✅ **Built 2026-09-05** (in two gates) | Connect + measure in the MANAGED E2E (2026-09-04). The IMPORT in the SELF-HOST E2E (2026-09-05): a fixture Takeout mounted read-only into the appliance, a second paused mapping green-lit by the last gate, imported into the e2e-target Nextcloud — placement asserted against the real server (album copy, no year duplicate), the manifest read back, a second pass writing nothing. The managed gate cannot carry the import at all: its run containers share no filesystem with the API (T4). Its first run found the appliance keyed every mapping of a tenant by ONE id (`uuidFromString`) — fixed, with the in-place upgrade kept. **2026-09-20, the zip route:** a third mapping over the same Takeout as a two-part `.zip` written by Info-ZIP (`test/e2e/fixtures/takeout-zip`), mounted read-only, pointed at part 1, imported into a `from-zip/` subfolder of the same account and compared with the folder route: the same four things written, byte for byte, and the manifest with the same name and the same bytes. |

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
| Preparation | Hours to days | Claimed **within 7 days**; **measured once: 5 d 6 h** (8→13 Sept 2026) |
| Delivery | A link, **or straight into Drive, Dropbox, Box or OneDrive** | **A download link only.** No delivery into any cloud |
| Part size | Chosen | Chosen — the chooser is real; largest part **25 GB** is still secondary |
| Link lifetime | Days | **14 days** (HT102208, read 2026-09-04) — but **measured once**, the window ended 12 d 18 h after the "ready" mail, so the clock does not start when the person is told |
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

## What one real export answered, and what it did not

**2026-09-17: an Apple export has been opened.** The owner requested one on 8 September 2026,
it arrived on the 13th, and this section is what was in it. Everything here is **PROVISIONAL**,
and the word is doing real work: one export, one account, one region, one request. Two of the
five questions below were not exercised at all, and one finding written here on the morning of
the 17th was over-stated and is corrected further down.

It is written down anyway, for a reason with a date on it: **the download expires on
26 September 2026**, and after that nothing in it survives except what is in this file.

### The five questions, as far as one export can answer them

| Question (asked 2026-09-04) | Export #1 |
|---|---|
| The directory layout, and whether files keep their tree | **Answered.** Two wrapper levels, then the person's own tree unchanged — see below |
| A per-file metadata sidecar, or only the bytes | **Answered.** No sidecars. ONE CSV for the whole service, flat, at the data root |
| Photos and Drive in one archive or separate | **Provisionally separate.** The download was `iCloud Drive.zip` — named for the service, not the request. A request covering two services has not been made |
| How the ≤25 GB parts relate | **Not exercised.** The owner chose a 1 GB part size and the data was 51 MiB, so there was one part and nothing to relate |
| What a re-request produces for an unchanged file | **Not exercised.** One request has been made |

### The layout, exactly

```
iCloud Drive.zip
└── iCloud Drive/            ← wrapper 1, named for the service
    └── Drive/               ← wrapper 2
        ├── Drive Details.csv
        └── testmap/         ← the person's own tree starts here
            ├── <an image>
            └── submap/
                └── <a .docx, named for a 2019 project>
```

(Leaf names redacted, as `docs/apple-supervised-run.md` promises: every question here is
structural, and the real names answer none of them. `testmap` and `submap` are the owner's own
folder names and are kept, because a Dutch name surviving the round trip IS one of the answers.)

Three things follow, and each is a line of reader code:

1. **The person's tree is preserved verbatim**, including a Dutch folder name with no
   transliteration. iCloud Drive files DO keep their original tree — the first question's
   answer, and the good one.
2. **Two wrapper levels have to be descended before anything is a user path**, and the second
   is not the same word as the first. A reader that treats the zip root as the import root
   would place every file under `iCloud Drive/Drive/…`.
3. **The manifest lives INSIDE the data**, beside the user's own folders rather than above
   them. A walk that does not exclude `Drive Details.csv` by name will import the manifest as
   a user file — and a person who genuinely has a file of that name at that spot collides with
   it. `ArchiveReader` must exclude it structurally, at the known path, not by matching the
   name anywhere in the tree.

### `Drive Details.csv`, column by column

1249 bytes. One header row, seven data rows, one row per file **across the whole tree**.

```
Title, Base Hash, Type, Size, Created On, Modified On, Last Opened On, Favourite, Executable, Package Signature
```

| Column | What export #1 showed | What it means for T3b |
|---|---|---|
| `Title` | A bare file name and nothing else | **No path, anywhere in the file.** The `.docx` two folders deep is a row like any other |
| `Base Hash` | 44 base64 characters on every row → exactly 32 bytes | SHA-256-**sized**. NOT verified to be a SHA-256 of the bytes — see export #2 |
| `Type` | `File` on all seven rows | A column with one observed value. Whatever a folder or a package reads as, we have not seen it |
| `Size` | Bytes. Sums to 53,819,035 (51.33 MiB) | The rows are ordered **strictly descending by this column** — not by name, not by tree, not by time |
| `Created On` / `Modified On` | Identical on all seven rows | `MM-DD-YYYY HH:MM:SS`, no timezone — see below, twice |
| `Last Opened On` | Equal to the other two, or one second earlier | Distinct values do occur, so the three columns are genuinely three |
| `Favourite`, `Executable` | `no` on every row | Real iCloud Drive flags with nowhere to go on a Nextcloud target. §4's "honestly lost" list |
| `Package Signature` | Empty on every row | The interesting one, and empty because nothing in this export was a package |

**The CSV cannot rebuild the tree, and the tree is in the zip.** There is no path column and no
folder row, so `Title` is ambiguous the moment two folders hold the same name — which this
export, with seven distinct names, does not test. The consequence for T3b is settled anyway:
**the canonical path comes from the filesystem walk and the CSV is joined onto it**, never the
other way round. What the join is keyed on is the open question, because `Title` alone is not a
key.

### The timings, measured rather than quoted

**A correction to this plan's own framing first.** The paragraph that stood here said Apple's
wording had never been read directly, because `support.apple.com` is blocked by this
environment's egress proxy. It still is — but the page was read from outside it on
**2026-09-04** and written into `docs/apple-setup.md`: **HT102208, published 24 April 2026.** So
the 7-day and 14-day figures have been Apple's own for a fortnight, and this section was two
weeks out of date before the export arrived.

| | Apple's own page (HT102208, read 2026-09-04) | Export #1 |
|---|---|---|
| Preparation | "up to seven days", the verification period | **5 d 6 h 36 m** — requested 8 Sept 14:17, ready mail 13 Sept 20:53 |
| Link lifetime | "fourteen days to download **once it is ready**" | Available until 26 Sept 14:47 — **12 d 18 h after the ready mail**, 18 d after the request |
| Part size | 1, 2, 5, 10 or 25 GB | The chooser is real; 1 GB was chosen. The ceiling was not tested |

Preparation came in comfortably inside Apple's ceiling. **The link lifetime is the interesting
one, and the reading that fits is not "Apple is wrong".** Fourteen days before the 26 Sept 14:47
expiry is 12 Sept 14:47 — about thirty hours BEFORE the owner was told his copy was ready. The
figure is consistent with fourteen days counted from the moment the copy landed on the Data &
Privacy page, and inconsistent with fourteen days counted from the mail that says so.

That distinction is worth more than the number: **a customer who sets a reminder from the mail
is up to a day and a half optimistic.** `docs/archive-setup.md` therefore no longer prints a
count of days at all — it tells the person to read the "Available until" date off their own
page, which is the only figure certainly right for their own request.

### The timestamps, and a claim that was over-stated

Every row carries `09-08-2026` — the day the files were uploaded, not the day they were
authored. The files are a 2019 video, a 2019 document and a 2023 photo.

**On the morning of 2026-09-17 this was written up as "modified-time cannot be carried from
this export". That was over-stated, and the owner said so:** *"i uploaded the files right
before i asked icloud for my datadownload, so we might need to do more research with a second
test."* He is right. Two explanations survive this export and it cannot separate them:

- **(a)** iCloud Drive never held the original modified time — the upload route dropped it —
  and the export faithfully reported what iCloud had.
- **(b)** iCloud Drive holds it and the export discards it.

What this export DOES rule out is the strong form of (b): **the export did not stamp these
rows.** The seven timestamps are not identical — they run 05:06:55 → 05:08:35, a 100-second
spread consistent with seven sequential uploads — and they sit five days BEFORE the archive was
produced. So whatever was lost was lost at upload, not at export.

**And a second, unprompted finding: the timestamps are not in the owner's timezone.** Read as
US Pacific (UTC−7, which is PDT on that date) the seven stamps land at 14:06:55–14:08:35 in the
owner's clock — ending eight and a half minutes before the 14:17 request he describes as
happening "right before". No other offset comes close: UTC puts them at 07:07, his own CEST at
05:07, US Eastern at 11:07. One export is not proof, but **a reader that parses these as local
time would be nine hours out**, and that is a defect worth designing against rather than
discovering. `Created On` has no timezone in it and never will; the offset has to come from
somewhere else or be treated as unknown.

### What export #2 must contain

The owner has offered a second export with better test data. The download expires 26 September,
so this is the list, and each line says which question it settles:

| In the export | Settles |
|---|---|
| **A file with a deliberately old local modified time**, uploaded by a route that preserves it (Finder drag on macOS), with the local mtime written down first | (a) vs (b) above — the only thing that does |
| **An iWork document** (`.pages`, `.numbers` or `.key`) | Whether `Package Signature` fills, and whether a package arrives as ONE file or as a directory a naive walk explodes into dozens of items |
| **More than 1 GB of data, with the part size set below it** | How the parts relate: one logical archive split across zips, or independent zips each with their own CSV |
| **The same file name in two different folders** | Whether `Title` is disambiguated, and therefore whether the CSV can be joined on it at all |
| **A name with a comma and a double quote in it** | Whether the CSV quotes and escapes, or corrupts. Export #1's seven names contain neither |
| **A name with diacritics** (`é`, `ü`) **and one with an emoji** | The encoding, and whether macOS's NFD normalisation survives into the zip and into the CSV |
| **An empty folder** | Whether it appears at all — it has no CSV row by definition, so the zip is the only place it could be |
| **Nesting three or more levels deep** | That the tree is preserved past the two levels export #1 showed |
| **A file whose date has a day number above 12** | `MM-DD-YYYY` is currently an inference. `09-08-2026` is the same string under either reading; a day of 13 or more pins it |
| **A second export with NOTHING changed**, requested after the first | The fifth question: what a re-request produces for an unchanged file, and whether `Base Hash` is stable across requests |
| **`voor-upload.csv`** — name, size and locally computed SHA-256 for every file, recorded BEFORE upload | Whether `Base Hash` is a plain SHA-256 of the bytes. If it is, the manifest alone can drive T6's idempotency without reading 25 GB of zip |

**Two services in one request** would settle the third question — whether Photos and Drive
arrive as one archive or several — and costs nothing but a checkbox.

### What is still unknown after export #1

Not fixed by better test data, and still blocking parts of T3b:

- **When the fourteen days actually start.** HT102208 says "once it is ready" and one export
  says that is not the mail. Which moment it is cannot be seen from outside, so the product
  must never compute the deadline; it reads the date Apple shows. That is now what
  `docs/archive-setup.md` says.
- **What `Base Hash` is a hash OF.** 32 bytes is SHA-256's size and also nothing more than
  that. Export #2's `voor-upload.csv` answers it for a plain file; a package may well hash
  differently.
- **Whether the layout is stable.** Two wrapper levels named `iCloud Drive/` and `Drive/` is
  what one export did on one day. A reader that hard-codes both is one Apple rename from
  importing nothing, so T3b finds the data root by looking for the CSV rather than by path.

**T3b can now start.** It was blocked on opening an export and an export has been opened; what
remains is confirmation, not discovery. A reader written against this section would be wrong in
its date parsing and silent about packages, which is why neither is built until export #2 lands.

## The owner's own Takeout, measured (2026-09-21)

A real Google export, requested by the owner on 20 September 2026 and delivered as **46 parts,
8517 files, 45.03 GB**. Part 001 carries `archive_browser.html`, the report, and that is what
was read here; the data parts were described by the owner from his own disk. It is the first
Takeout this plan has measured rather than reasoned about, and it broke the reader outright.

### The folder names are translated, and the reader named them

The reader looked for the constant `Takeout/Google Photos`, and for `Photos from <year>` inside
it. **Google translates both.** The owner's export is:

```
Takeout/
  Google Foto_s/              <- Dutch, and `'` is written as `_`
    Foto_s van 2024/            10 media + 10 sidecars
    Foto_s van 2025/          2378 media
    Foto_s van 2026/          1954 media
    Prullenbak/                 25 media   <- Trash, translated like the rest
```

So the 45 GB export was refused entirely, with a sentence that blamed his download — after he
had clicked forty-six download buttons to get it.

**Fixed (2026-09-21): the root is FOUND, not named.** One level under `Takeout`, the product
folder whose own subfolders hold photos — asked as two questions, strongest first. First, in
every product: a media file with its sidecar beside it. That pair is what a photo tree IS in any
language, and a Drive or Mail export under the same `Takeout` has no such pairs. Only if no
product answers that, a second question: a still or a motion clip by extension. When nothing
qualifies, the refusal names the products it did see rather than sending the person back to
their download.

**Both questions are needed, and the order is the point** — found the hard way, when the first
version asked only the pair and turned five other suites red. "A missing sidecar is not an
error" is the reader's own rule, so a library whose sidecars are all absent is still a library,
and demanding the pair refused it outright: the same class of defect as naming the root, one
layer down. Asking the weaker question per product instead would let a Drive export holding one
holiday snap win on sort order, since `Drive` sorts before `Google Foto_s`.

**What made it hard to see, recorded because it fooled me first.** Takeout's own album picker
lists these folders in ENGLISH (`Photos from 2011`, `Trash`) even for a Dutch account. I read
the picker, saw English, and nearly concluded there was no defect — a display name is not a
path. The owner settled it by looking inside a data part.

### The half that is NOT closed, and the three rules that are not it

`Photos from <year>` is still a constant, so under a translated root every folder reads as an
ALBUM, year folders included. For an export with no albums — the owner's — that is invisible:
each photo sits in one folder and lands in one place. Add an album and it is not: the photo is
placed under the album AND under its year folder, which §"What is carried" says must not happen.
Pinned as a failing-on-purpose expectation in
`a-takeout-that-is-not-in-english.unit.test.ts`; the test fails when the rule lands.

Three candidate rules this export **rules out**, which is the value of having measured it:

| Candidate | What the export says |
|---|---|
| The folder's own `metadata.json` — albums carry one, year folders do not | **No folder in the export has one**, year folders included. So the rule is untested, not confirmed. It remains the best candidate; it needs an export WITH albums |
| The filename — Trash items are marked | Trash is `Prullenbak`, translated like everything else, and **only 1 of its 25 media** carries Android's `.trashed-` prefix. The other 24 are ordinary names |
| `archive_browser.html` — the report as a Rosetta stone | It carries exactly one English key, `data-english-name="PHOTOS"`, and that is for the **service**. The folders under it appear only in Dutch. It is also in part 001 only, which a person may not have downloaded |

### What this means for the owner's Trash decision

The owner decided on 2026-09-21: *"we should leave out Trash, the user should unselect it, and
we should not move it to target."* The first half is guidance and can be written today. **The
second half has no rule yet** — from inside the data parts, `Prullenbak` is indistinguishable
from an album called `Prullenbak`. It lands with the album rule, not before, and until then
Trash is carried like any other folder.

### Larger parts: safe, with room to spare

The owner asked whether Takeout's larger part sizes would be a problem, having clicked a button
per gigabyte for 45 GB. **They would not.** The reader holds no part in memory: `openZip` reads
the central directory through a seekable source, and the relay reads by `Range` in 8 MiB
windows. The bound that matters is `MAX_CENTRAL_DIRECTORY_BYTES` (256 MiB), and the arithmetic
is not close: his whole 45.03 GB export is 8517 files, and a central directory entry for a path
of his length is roughly 170 bytes, so even as ONE part the directory would be about 1.5 MB —
**a factor of ~170 under the ceiling**. ZIP64 is implemented (`EOCD64`, the locator, the
per-member extra field), so a part above 4 GiB is read like any other. The cost of larger parts lands on
the relay upload — fewer, larger PUTs — not on the reader. **Tell people to pick the largest
part size their connection will carry.**

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

#### The relay, as decided (2026-09-20)

**Owner, 2026-09-20, on the three doors for a managed customer's archive:** *"They might not
have a Nextcloud! So we can not offer that just so easy. I pick Relay."* And, in the same
breath: do it efficiently — relay the complete zip files, or read from them and carry only the
files inside?

**What relay means.** The person's browser uploads each part with a resumable upload through
Ownpace, and Ownpace streams it — never to its own disk — straight into the customer's own file
target, under an import folder. The pass then reads the zip from there **by byte range**, with
the same reader that reads it on the appliance's disk (D7's reader behind the tree seam), and
writes the photos beside it. Nothing of the archive is ever ours to hold, which keeps the
custody promise; and the person needs no account with any other cloud, which is what the
owner's word on D7 ruled out.

**Complete parts, not the files inside them.** Three reasons. Photos and videos are already
compressed, so the zip weighs what its contents weigh and extracting first saves no bytes. The
reader needs every part before it can decide anything: a photo's album copy sits in part 1 and
its year copy with the sidecar in part 3, and placement, the collapse by content hash and the
manifest all depend on seeing both — a stream that extracted members as they passed would have
to write duplicates first and sort them out later, which is staging, which is *store*. And a
part is one resumable upload with one integrity check at the end: the reader refuses a corrupt
member by sentence, from the CRC-32 the zip carries. ("Should the person unzip it first" above
reached the same answer for the managed edition from the first two reasons.)

**"They might not have a Nextcloud."** A photo import always has a file target — the migration
writes files somewhere — and the relay lands the parts in whatever that is. What differs is how
an upload resumes: on Nextcloud and ownCloud, through their chunked upload API, so a dropped
connection resumes per chunk; on a plain WebDAV target, which cannot take a file in pieces, a
part goes in one request and a drop resumes per part. **1 GB parts** (Takeout offers 1, 2, 4,
10 and 50 GB; Apple 1, 2, 5, 10 and 25) are the right size for a browser upload for exactly that
reason, and the walkthrough should say so. From the person's side this is not "two-step done for
them" — they never learn a WebDAV path — but on the wire it is, and the earlier recommendation of
two-step is honoured in the half that mattered: nothing on our side.

**And not only a Nextcloud.** The owner, reading slice 1 the same night: *"We do however have
to anticipate people might have other targets then nextcloud for files or photo's."* The store
seam is written that way already — `webdavStore` speaks PROPFIND, GET and `Range`, which is
WebDAV and not Nextcloud, and the one Nextcloud-specific thing in the relay is the *chunked
upload* of slice 2, which is an optimisation with a documented fallback (one request per part)
rather than a requirement. What this rules out, for every slice: an OCS call on the read path,
a Nextcloud-shaped path convention, a capability probe that refuses a target it does not
recognise. A file target the migration can write to is a target the relay can land parts in;
where it cannot resume per chunk it resumes per part, and where it cannot do that either the
wizard says so before the person starts. The same holds for a photo target: the archive's
photos land wherever the migration's file target is, and nothing in the reader or the store
asks which product is behind it.

**What the target holds, and for how long.** During the import, the parts and the photos: twice
the archive's size, in the customer's own storage, said up front. After it, the parts stay where
the relay put them until the person deletes them — hard rule 2 says we never write the source,
and the uploaded part *is* the source. A "delete the parts" button the person presses is the
most this product should do; the wizard says where they are.

**The delivery route the table above recommended** — Takeout straight into Drive, Dropbox,
OneDrive or Box — stays possible for a person who already has one of those, and stops being
what we tell people to do: the owner's word on D7 (no dependence on another US cloud) applies
to T4 too. The table's ranking of the upload as "worst for multi-GB" was written before a
resumable relay was the design; it stays as history.

**Slices, in order — slice 1 built 2026-09-20 (`archive-store.ts`,
`webdav-archive-store.ts`, and `where` on the archive source wiring both pass builders,
the probe and the qualification to it); slices 2 and 3 still to come:**

1. **A random-access source over a file in the target.** ✅ **Built 2026-09-20.** `size` from a PROPFIND, `read` by a
   `Range` GET, reading ahead in windows large enough that a 25 GB library is not twenty-five
   thousand requests (the zip reader asks in 1 MiB steps; the source may fetch more). An
   archive location that names a path *inside the target* rather than on a disk —
   `ArchiveLocation.path` already allows "a path inside a file source we already read". With
   this alone the managed edition imports an archive somebody put in their target by any
   means, and its gate needs no upload at all — **built and gated 2026-09-20**, on the
   self-host stack rather than the managed one because the claim is about the READER and the
   self-host gate already has a real Nextcloud and runs on every PR: the gate puts the two
   Info-ZIP parts in the e2e Nextcloud and imports them from there.
2. **The relay endpoint and page.** A resumable upload in the tus protocol's shape (create,
   offset, patch, a checksum per chunk) without adopting anyone's client library unless the
   owner wants one; each chunk streamed into the target's chunked upload on Nextcloud and
   ownCloud, or whole parts per request on a target without chunking; progress and resume on
   the page; the parts named as Google named them, so the multi-part rule finds the set;
   memory bounded per chunk and nothing on disk. Egress is metered on the managed stack and
   the price should say so.
3. **The managed gate through the door:** relay the two parts through the API into the e2e
   Nextcloud, import, and make the same comparison the self-host zip-route gate makes.

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
  wanted, and nothing before T4 is blocked. §"What D7 is actually choosing between" below
  lays out the three options and the one measurement that should precede the decision.
  **✅ DECIDED 2026-09-20: option 3, our own reader** (owner: "C or D, because I don't want to
  keep someone depending on other US cloud SaaS"; C chosen over D for the reasons in the status
  block). Built as `packages/connectors/src/zip-archive.ts` the same day: random access, zip64,
  streaming inflate, CRC-checked members, a spanned set refused with a sentence — so the
  measurement this section asked for (independent parts or one archive split across files)
  is taken by the product on the first real multi-part export, not guessed. The two in-memory
  readers already in the repository stay as they are: the container hash is a pinned scheme,
  and the export-members script reads an index. What the decision did NOT settle is where a
  managed customer's archive sits, which is T4's managed half: *two-step* (the person uploads
  the export into their own target, and Ownpace reads it there by byte range — no storage on
  our side, no US cloud), *relay* (a resumable upload through Ownpace streamed straight into
  the target, nothing stored) or *store* (an object store on our stack, against the custody
  promise). Put to the owner on 2026-09-20; recommendation two-step first, relay when asked.
  **Second slice, the same evening:** the Takeout reader reads the zip in place through a
  tree seam — folder or zip, a multi-part download as one tree, a gap in the parts refused —
  so the appliance route needs no extraction; the status block has it in full. **And the
  transport question closed the same night: relay** (owner: *"They might not have a Nextcloud!
  … I pick Relay"*); §3 "The relay, as decided" has the design.
- **D6 — ✅ DECIDED: "Import an export", with the provider's own words beneath.** Not "sync", for Apple. Recommendation: *"Import an
  export"* as the family, and per provider *"Google Takeout archive"* / *"Apple Data & Privacy
  export"* — the provider's own words, so a search engine and a support conversation match.

### What D7 is actually choosing between

Written 2026-09-04 so the decision can be taken in a minute rather than researched again.
**Nothing here is a recommendation to build anything** — it is what the options cost.

**The starting fact, measured rather than assumed:** Node ships no ZIP reader. `node:zlib`
gives DEFLATE and gzip — the *compression*, not the *container* — and there is no `node:zip`
in any release line (checked on this repository's own Node, 22.22.2, on 2026-09-04; the repo
targets ≥24, where the same is true). So reading a `.zip` without extracting it is either a
dependency or code of ours. There is no third door where the platform already does it.

| | What it costs | What it buys |
|---|---|---|
| **1. Extract first** — today's answer, and what T3a does | Transiently **twice the disk**, and a step the person has to perform | Nothing to decide, nothing to audit, nothing to keep patched |
| **2. A ZIP library** | One runtime dependency in `packages/connectors`, which today has four non-workspace ones. On a product whose pitch is custody of other people's data, that is a real cost and not a formality | Random access into a multi-gigabyte archive with no extraction, and somebody else's edge cases already handled |
| **3. Read the central directory ourselves** | Perhaps 250–350 lines, and the ZIP64 extensions a >4 GB part needs. Hand-rolled parsers of somebody else's format age badly | No dependency at all. And the read path is genuinely narrow: locate the end-of-central-directory record, walk the entries, seek to each local header, inflate with `createInflateRaw` |

Option 3 is more defensible here than it would usually be, for one reason worth stating: **we
only ever READ.** A parser that gets something wrong fails to produce an item, loudly, on an
archive nothing is being written to — which is a very different blast radius from a
hand-rolled *writer*. It is still more code to own than a dependency is to audit once.

#### The measurement that should come first, and it is already in flight

**Are the parts independent zips, or one archive split across several files?** This is the
question that decides how hard options 2 and 3 are, and neither has been checked:

- **Independent zips** — each part carries its own central directory and is openable alone.
  Option 3 becomes tractable, option 2 becomes a small library rather than a large one, and
  even option 1 is unremarkable.
- **A split (spanned) archive** — the central directory lives in the last part and entries
  run across part boundaries. Hand-rolling that is a different order of difficulty, and a
  good many libraries decline to support it at all.

The owner's own exports settle it: a Takeout was to be requested shortly and an Apple export
was requested on 2026-09-04. **When they land, record three things before D7 is answered:**

1. does each part open on its own, or only as a set;
2. does any single part exceed 4 GB (which is what makes ZIP64 mandatory rather than
   incidental);
3. is the layout the same for both providers, or does each need its own answer.

Until then D7 is not merely deferrable, it is **premature**: the option costs above are known
and the thing that would tip between them is not. And §3 already notes that the managed
multi-gigabyte upload "is its own slice and may never be built" — so this may be a decision
that never has to be taken at all.

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
- **A real export**, requested by the owner 2026-09-08, delivered 2026-09-13, read 2026-09-17.
  Its structure is §"What one real export answered"; the files themselves are the owner's
  personal iCloud and stay on his machine, and the leaf names in this document are redacted
  for that reason.
- **Apple Support, HT102208** — *Get a copy of the data associated with your Apple Account*,
  published 24 April 2026, **read by the owner 2026-09-04** and written up in
  `docs/apple-setup.md`. This is where the seven-day and fourteen-day figures come from, and
  it is a primary source; the agent still cannot reach it (`support.apple.com` is blocked by
  this environment's egress proxy), so it is quoted from that reading rather than re-fetched.
- The secondary sources the plan was first written from, kept for provenance and now
  superseded by the two above:
  - MacRumors, *Get a Copy of Your Apple Account Data — Here's How*
    <https://www.macrumors.com/how-to/get-a-copy-of-your-apple-account-data/> (read 2026-09-04)
  - iDownloadBlog, *How to download all your personal data from Apple*
    <https://www.idownloadblog.com/2024/03/21/get-personal-data-from-apple/> (read 2026-09-04)
  - Apple Support, *Archive or make copies of the information you store in iCloud*
    (`support.apple.com/en-us/108306`) — **cited, not read**, for the reason above.

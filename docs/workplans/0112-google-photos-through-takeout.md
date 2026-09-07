# Workplan 0112 — Google Photos, through Takeout

## Status — 2026-09-05 (update this block at the end of every session)

**2026-09-05: superseded in practice by [0116](./0116-the-data-they-give-the-person-not-us.md),
row by row.** The owner's decisions were taken there (0116 T0, 2026-09-04: the archive route, an
archive as a kind of connection whose credential is a location, albums as folders with the year
folder for a photo in no album). T1's reader is `takeout-archive-reader.ts` behind 0116 T2's
seam (0116 T3a). T2's source kind is 0116 T1 plus the doors (0116 T8 and the create door). T3
landed as 0116 T5 with one difference worth knowing: the sidecar's taken time and location go
into the MANIFEST verbatim, not into the copy's EXIF — the original bytes are never touched and
the manifest is what carries what Google knew (0116 T2, rule 3). T4 is 0116 T9 and waits on
0116 T4. T6 is 0116 T7. T5 (the Picker) stays optional and unplanned. The rows below are left
as written on 2026-09-03; this paragraph is where each one went.

**2026-09-03: drafted for the owner's decision, nothing built.** The owner asked on
2026-09-02, after the measured Drive figure matched Google's own to the megabyte and the
Photos line beside it stayed empty: *"reason in how to fit in the Google Photos, through what
API, like takeout, can it be used to reach the similar level we need: migration of
photos+data, and possibly sync with a frequency."* This plan is the reasoning, written down
with the facts checked, and a build shape behind it. §"The owner's decisions" lists what has
to be decided before T1 starts; T0 is that decision.

| Task | Status | Evidence |
|---|---|---|
| T0 Decide: build the archive route, and where photos land | 📋 Owner decision | §"The owner's decisions" 1–3. Nothing below starts without 1. |
| T1 The Takeout reader | 📋 Planned | A pure library: open an archive (zip, tgz), pair every media file with its JSON sidecar, de-duplicate across album folders, name each item's albums. No network, no target. |
| T2 The `google-photos-archive` source kind | 📋 Planned (needs T1) | A source whose credential is an archive's location, not an account: a file uploaded, or a file in a Drive or Dropbox the product already reaches. Front door, wizard, connection card, probe (opens the archive, counts), Measured line (items, bytes). |
| T3 Metadata into the copy, albums as folders | 📋 Planned (needs T2, decision 4) | On write to the file target: taken time and location from the sidecar into the copy's EXIF where the original lacks them; albums as folders; the original bytes in the archive never touched. |
| T4 The two-monthly pickup | 📋 Planned (needs T2) | The person schedules Takeout's incremental export into Drive or Dropbox once; the product notices each new archive on its existing schedule and imports only what is new, idempotent by content hash. The guide walks the schedule. |
| T5 Hand over a selection (Picker API) | 📋 Optional (needs T2) | A button for the gap between exports: the person picks in Google's picker, the product downloads the originals. Capped by Google at 2,000 items a session; never a sync. |
| T6 Measure before the move | 📋 Planned (needs T1) | The archive's own numbers on the Measured line: items, bytes, albums, the export's date range — and the note that a Takeout archive is a snapshot with a date. |

## Why this exists

The account faces this product migrates — mail, calendar, contacts, files — are read live from
Google through APIs Google keeps open for that purpose. Photos are not one of those faces, and
`docs/google-workspace-setup.md` §"Google Photos, and the device backups" says so to the
customer: *"If you need your photos moved, say so; it decides whether an archive-import route
is worth building."* The owner said so. This plan is what that sentence promised.

The bar the owner set is *"the similar level we need"*: a migration of the photos **and their
data** (when taken, where, which album, the description), and if possible a **sync with a
frequency**. Both are reachable, with two hard limits that are Google's and not ours.

## The facts, checked 2026-09-02

| route | what it gives | what it cannot do | source |
|---|---|---|---|
| **Photos Library API** | Only items an app uploaded itself. The full-library scopes (`photoslibrary.readonly`, `photoslibrary.sharing`, `photoslibrary`) were removed on 31 March 2025; `mediaItems.search`/`list` answer app-created content only. | Read a person's existing library at all. | Google's API updates page and the developer blog announcing the Picker API and the Library API changes. |
| **Picker API** | The person picks items in Google's own picker UI; the app gets base URLs to download originals (`=d`), valid for 60 minutes. | A full migration: one session is capped at 2,000 picked items, nothing runs unattended, there is no "everything since". | Picker API guides; the limits page. |
| **Data Portability API** | Chrome, Maps, Play, Search, Shopping, YouTube. | Google Photos is not among its scopes. | The Data Portability API scopes page. |
| **Takeout** | The whole library at original resolution, albums as folders, a JSON sidecar per item with taken time, description, location, people, favourite flag. Since June 2026: a schedule of one export every two months for a year, each later export **only what was added or edited since the last**, delivered into Drive, Dropbox, Box or OneDrive. | Anything more frequent than two months; it never reports deletions; the schedule expires after a year and must be renewed; Photos must be the only product selected for the incremental schedule. | Google's June 2026 announcement as reported by gHacks, WinBuzzer and Android Authority; the Takeout help page. |

The two limits that no design below can remove: **deletions do not propagate** (Takeout
exports what exists; it says nothing about what was removed), and **the floor is two
months** (Takeout's schedule; the Picker fills the gap by hand, not by schedule).

## The decision this plan recommends

**Build on Takeout, as an archive source, with the two-monthly pickup as the sync.** It is the
only route that reaches the whole library with its data, and its incremental schedule is a real
sync with a frequency — a slow one. The Picker API is worth a button for a recent trip; it is
not a migration and must never be sold as one.

What "similar level" honestly means under this design:

- **Migration of photos plus data: yes.** Originals at full resolution; taken time, location,
  description and album membership carried; edited versions beside originals where Takeout
  ships both.
- **Sync: yes, one-way and slow.** Additions and edits every two months, for the year the
  schedule runs, renewed by the person. Deletions never. Nothing faster than the floor.

## The design

### 1. What a Takeout archive is, precisely

One or more `takeout-<date>-<n>.zip` (or `.tgz`) files. Inside, `Takeout/Google Photos/`
holds one folder per album plus one `Photos from <year>` folder per year. Each media file
sits beside a sidecar named `<file>.supplemental-metadata.json` (older exports: `<file>.json`;
truncated names past 51 characters; a `(1)` suffix on the sidecar rather than the file for
duplicates — the reader has to try the known spellings). The sidecar carries `title`,
`description`, `photoTakenTime.timestamp`, `geoData` (latitude, longitude, altitude),
`people[].name`, `favorited`, and for shared albums the sharer. **A photo in three albums
appears three times**, once per album folder, byte-identical; the year folder holds it too.
Edited photos ship as `<name>-edited.<ext>` beside the original. Motion photos ship as the
JPEG plus an MP4 with the same stem. Google-side metadata that the file lacks (a taken time
set by hand in Photos, a location added in Photos) lives only in the sidecar; the file's
EXIF is the camera's.

The reader (T1) turns this into one record per distinct item: the bytes' content hash, the
canonical file, its sidecar fields, the set of album names it belongs to, and whether an
edited version and a motion clip exist. Everything after T1 works on that record, never on
the folder layout.

### 2. The source kind: an archive is the credential

A `google-photos-archive` source carries no account. Its "credential" is **where the archive
is**: uploaded through the product, or a path in a Drive or Dropbox connection the product
already holds (the person's own, consented the way every other connection is). The probe
opens the archive far enough to count (T2), and the Measured line says items, bytes, albums
and the export's date range (T6) — the same three-state honesty as every other face: an
archive that cannot be opened is *unknown* with the reason, never a *no*.

Uploading multi-gigabyte archives through the product is the worst of the three placements
and is offered last; Drive is the natural one because Takeout can deliver straight into it
and the product reads Drive already. Dropbox is the same one step over.

### 3. Where photos land, and how the data travels

The target is a **file target** the product already has: a folder tree on WebDAV/Nextcloud
(decision 2 names it). Albums become folders under a root the person names; an item in three
albums is written once and linked or copied per decision 5; the year folder is not
reproduced (it is Takeout's index, not the person's structure).

The data travels two ways, both non-destructive toward the source (rule 2):

- **Into the copy's EXIF** (T3): where the file lacks `DateTimeOriginal` or GPS and the
  sidecar has them, the *copy written to the target* gets them; the archive's bytes are never
  modified. Nextcloud Memories, Photos and Immich read EXIF for their timelines and maps,
  which is why this matters more than a sidecar.
- **As a manifest beside the tree**: one JSON (or the ledger row) per item with the full
  sidecar — description, people, favourite, albums — so nothing Google knew is lost even
  where no target field exists for it.

What is deliberately not attempted: mapping `people[].name` onto a target's face recognition
(no target has an API for "this face is Anna"), and reproducing Google's "shared with" state.

### 4. Idempotency and the pickup

Every written item is keyed by content hash in the ledger, the way the file domain's copies
already are: a second import of the same archive writes nothing; an incremental archive
writes only what its hashes have not seen. An edited version whose bytes changed is a new
item beside the old, named as Takeout names it; a description changed in Google without a
byte change updates the manifest and, if decision 4 allows, the copy's EXIF description.

The pickup (T4) is the existing scheduler asking the Drive or Dropbox source for new
archives under the folder Takeout delivers into, on the product's own cadence; when one
appears, the import runs. Nothing is polled at Google itself.

### 5. The Picker, for the gap

T5 is a button on a photos connection: it opens Google's picker, the person selects, and the
product downloads each picked original into the same tree through the same ledger. It exists
because two months is long; it is capped at 2,000 items a press by Google and requires a
person present. The guide calls it what it is.

## The owner's decisions

1. **Build it, and when.** Everything below is gated on this. The plan is written so that T1
   and T6 (the reader and the measure) are worth building even if T3–T5 wait: a customer
   could then *see* what an archive holds before deciding on a move.
2. **Where photos land.** Nextcloud (a folder tree the Memories/Photos apps index) is the
   target the product already writes; Immich is the better photo home and has an upload API,
   but is a new target kind. Recommendation: Nextcloud first, Immich as its own workplan.
3. **Which placement first.** Drive (Takeout delivers into it, the product reads it) is the
   recommendation; Dropbox second; upload last.
4. **Whether the copy's EXIF may be written.** Recommendation: yes, only fields the original
   lacks, only into the target copy, never the archive — and recorded in the manifest so it
   can be told apart from camera data.
5. **One item in several albums.** Write once and link (WebDAV has no links; Nextcloud does,
   through its own API) or copy per album (simple, costs bytes). Recommendation: copy per
   album for the first slice, bytes being cheap next to the risk of a target-specific link.
6. **Whether the two-month sync is offered as "sync" at all.** Recommendation: call it what
   Google makes it — *a scheduled export the product picks up* — and never the word the
   other faces use, so nobody expects deletions to follow.

## Not in this plan

- Google Photos as a live face on the Google account kind. Google closed that route on
  31 March 2025; the guide already says so.
- Deletions. No route reports them; a person's target keeps what Google no longer has.
- Anything faster than the Takeout floor, beyond the Picker button.
- Device backups (Android's own; the guide already says they stay where they are).
- Immich as a target kind (decision 2's runner-up; its own plan when chosen).

## Definition of done, per task

The repo's rules apply unchanged: gates green, the guide updated in the same PR as the code,
no secrets, idempotency proved (a second import writes nothing), non-destructive proved (the
archive's bytes are never opened for writing), self-host intact (the reader and the source
kind belong to `packages/`, never to `packages/managed`), Measured line and three-state
record on the connection like every other kind.

## Sources

- Google Developers Blog, *Updates to the Google Photos APIs: Picker API launch and Library API
  changes*; Google's *Updates to the Google Photos APIs* page (the 31 March 2025 scope removals).
- Google Photos Picker API guides: media items and base URLs; the limits page (2,000 items a
  session; 60-minute base URLs).
- Google Data Portability API, *Available OAuth Scopes*.
- gHacks (2 June 2026), WinBuzzer (7 June 2026), Android Authority: Google Photos' incremental,
  scheduled Takeout exports — every two months for up to a year, later exports carrying only
  what was added or edited, delivered to Drive, Dropbox, Box or OneDrive.
- `docs/google-workspace-setup.md` §"Google Photos, and the device backups" (this repo).

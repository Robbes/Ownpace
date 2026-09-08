# Workplan 0120 — A file bigger than the machine

## Status — 2026-09-08 (update this block at the end of every session)

**2026-09-08: the seam, and the DAV path through it.** The owner asked for
"the memory optimized streaming of larger files" after the pass-deadline work
found the ceiling underneath it: a pass can now end on its own clock and a run
row always closes, and NEITHER helps a file that cannot fit in the runner at
all. T1–T4 are done and are one PR; T5 (the other five connectors) is not, and
until it lands those paths refuse above a stated ceiling rather than dying.

**2026-09-08, later: the Graph half of T5, and a defect found underneath it.**
Moving OneDrive onto the seam meant reading `GraphDriveSource.fetchFileContent`,
which turned out to be doing the UTF-8 round trip that had already been found
and fixed on the DAV path — `new TextEncoder().encode(await res.text())`. Every
OneDrive file that was not valid UTF-8 was destroyed on read, and the ledger
hash was taken from the corrupted bytes, so the copy agreed with its own record
and both sides of the verification gate agreed with each other. That fix ships
with the streaming half, because they are the same three lines. Dropbox, Google
Drive, Box and the archive source still buffer.

## Why this exists

A file crossed this system as a `Uint8Array`. The source read it whole, the
loop carried it, and the target hashed it and built a request body from it —
three copies of one file alive at once, per item in flight, `concurrency` items
at a time.

So the largest file a migration could move was decided by the RUNNER'S RAM: not
by the file, not by the customer, not by the provider. On managed no machine
preset is set at all, which means Trigger.dev's smallest default.

And crossing it did not fail the item. The process was killed, mid-pass, with
no run event and no failure-queue row — which from the customer's side is a
migration that stops on one file and never says which. It is the same class of
silence as workplan 0090's byte ceiling and 0022 T2's killed pass, one layer
down, and the reason it went unnoticed for so long is that every fixture in
this repository is small.

It is also the one thing in the pass that assumes local resources. Everything
else is stateless apart from Postgres, so it is what stands between this
architecture and a container-per-run deployment on a k8s-shaped platform — the
owner's stated direction of travel (2026-09-08).

## Tasks

| # | Task | Status | Notes |
| --- | --- | --- | --- |
| T1 | The vocabulary: a body, a ceiling, a refusal | ✅ **Done 2026-09-08** | `FileBody` in `@openmig/shared` — a size and a RE-OPENABLE read, because a retry after a half-written upload starts from the beginning and a consumed stream cannot (a source that hands back an exhausted one writes an empty file and records it as a copy, the worst outcome available to this code). `MAX_BUFFERED_FILE_BYTES` = 256 MB: a stated, uniform ceiling rather than a guess at the machine, because a per-deployment limit produces "it worked on my appliance", which is not something a customer can act on. `tooLargeToBuffer` names the file, its size, the limit, which END cannot carry it and a way forward — a failure-queue row, with the rest of the folder continuing, instead of an OOM that takes the pass. 10 unit tests. |
| T2 | A hash that does not hold the file | ✅ **Done 2026-09-08** | `streamingFileContentHash` — a `TransformStream` that folds chunk by chunk and answers the same 64 hex characters as `fileContentHash`. Hashing was one of the three places a large file HAD to be buffered. It rides ALONG the bytes going to the target rather than taking a read of its own: a second read would double the transfer, and on a metered source (0090's daily ceiling) would double what the customer spends against their own provider's limit for one file. `digest()` before the stream ends throws rather than answering a hash of a prefix, which would compare equal to nothing and unequal to everything and be written to the ledger as though it were the file. |
| T3 | The HTTP seam carries a stream, both ways | ✅ **Done 2026-09-08** | `HttpRequestOptions.body` may be a `ReadableStream`; `stream: true` hands the response back as `bodyStream` instead of reading it into `bodyBytes`. `duplex: 'half'` on every streamed request — Node's fetch refuses one without it, with a TypeError about the RequestInit rather than about the file, so it reads as a bug in the connector. And the two XML clients (CalDAV, CardDAV) now REFUSE a body they cannot send: they read `typeof body === 'string' ? body : undefined`, which turns an unsendable body into a request that goes out empty — a PUT that blanks a resource and answers 204. Nothing hands them bytes today; the point is that the day something does, it says so. |
| T4 | The DAV path, end to end | ✅ **Done 2026-09-08** | `WebdavFileSource.fetch` returns a `FileBody` above `STREAM_FILES_LARGER_THAN_BYTES` (8 MB — far below the ceiling on purpose, so the streaming path is exercised by ordinary files in ordinary runs rather than only by the rare enormous one, where a defect would be found by a customer). `open()` re-issues the GET. `WebDAVTargetWriter` PUTs the stream with the promised `Content-Length` (without it the request is chunked transfer-encoded, which some DAV servers refuse and others accept while reporting a size of zero), hashing as the bytes pass, and takes its ledger `contentHash` from that digest. The content hash became LAZY: it used to be computed from the whole buffer at the top of `upsertFile`, which is itself a reason the file had to exist. 9 unit tests over both halves, the write path proved by breaking (buffer the body instead of streaming it → red). |
| T5 | The other five connectors | 🟡 **Graph done 2026-09-08; four to go** | Dropbox, Google Drive, Box and the archive source still buffer, and `MAX_BUFFERED_FILE_BYTES` is what turns "the container died" into a sentence for them. The seam is what makes them independent: a connector moves to `FileBody` on its own and nothing above it changes. **A correction to this row as written:** these four and Graph are SOURCES — nothing in this system writes files to OneDrive, Dropbox, Drive or Box — so the work per connector is `fetch` returning a body above `STREAM_FILES_LARGER_THAN_BYTES`, not a resumable upload protocol. Upload sessions become the subject only if one of them is ever a target. **Graph, done:** `fetch` returns a `FileBody` above the threshold, `open()` re-issues the GET so a retry starts from the beginning, and a 200 with no body is refused rather than written as an empty file. `makeRequest` was split so the caller owns the decode — it was two identical closures reading `text()` for every response alike, which is how the next thing was true. **And the next thing:** `fetchFileContent` read the body as text and re-encoded it, destroying every OneDrive file that was not valid UTF-8 — the same defect fixed on DAV weeks earlier, invisible because the ledger hash comes from whatever the source returned. Guards: `a-onedrive-file-that-was-not-text.unit.test.ts` (9 tests, payloads that are deliberately not valid UTF-8, proved by five breaks) and `scripts/the-decode-that-was-waiting-in-the-next-connector.unit.test.ts`, which holds the property across every `FileSource` in the repository from a DERIVED list, because the connector with the defect is by definition the one nobody is looking at. |
| T6 | The gate carries a file bigger than a chunk | ⬜ **Not started** | Every fixture in this repository is small, which is exactly why this went unnoticed. A single large file in the managed gate's seed — larger than the streaming threshold, not larger than the runner — is what would have caught it, and is what stops T5 regressing it one connector at a time. |

## Decisions

- **A threshold, not a switch.** Below 8 MB a file is still buffered. Most
  files are small, a buffer is simpler, and one round trip beats the
  machinery. The threshold sits far below the 256 MB ceiling so the streaming
  path runs constantly rather than only in the rare case.
- **Re-openable, not restartable.** `open()` starts a fresh read from the
  beginning; there is no resume-from-offset. Resuming is the T5 protocols'
  business, and pretending to have it here would be a promise the DAV path
  cannot keep.
- **The refusal is not a fallback.** A path that cannot stream a file above
  the ceiling fails the ITEM, verbatim, and the folder carries on. It does not
  try and die, and it does not skip quietly.

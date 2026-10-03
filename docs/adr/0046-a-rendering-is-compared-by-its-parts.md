# ADR-0046: A rendering is compared by its parts, not by its bytes

- **Status:** Accepted 2026-09-16; amended 5 times (latest 2026-09-28); consolidated 2026-10-03
  (ADR-0051). Built (0042 T7); the per-part hash does not yet reach the ledger (0042 T8 (e)).
- **Date:** 2026-09-16; consolidated 2026-10-03
- **Deciders:** owner
- **Relates to:** [ADR-0030](./0030-relocation-is-positive-evidence.md) (correlating by content
  hash, and pairing a renamed export by its source id), [ADR-0024](./0024-explicit-owner-deletion-apply.md)
  (what counts as evidence before the migration acts), [ADR-0037](./0037-keys-credentials-and-transport-floors.md)
  (the hash is stored beside credentials, under the same floors), [ADR-0041](./0041-who-owns-the-oauth-client.md)
  (whose client reaches the Drive this was measured on); workplans
  [0042](../workplans/0042-google-drive-source.md) (T3 measured it, T7 built it) and
  [0150](../workplans/0150-dropbox-native-formats-and-the-downloads-that-will-not-hand-themselves-over.md) (D8)
- **History:** the record as it read before consolidation, word for word —
  [history/0046-a-rendering-is-compared-by-its-parts.md](./history/0046-a-rendering-is-compared-by-its-parts.md)

## Operative rules

<!-- What holds NOW, within the ADR-0051 budget: 8 bullets, 60 words a bullet, 250 words in
     all. Amend in place when a later decision changes it, then regenerate OPERATIVE.md:
     node scripts/adr-operative.mjs --write -->

- **A rendering in a zip is compared by its parts** (rule 1): member names sorted, each with the
  **sha256 of its inflated bytes, never the stored CRC-32** (rule 2, cited as (b)).
  [container-hash.ts](../../packages/shared/src/container-hash.ts); guard
  `a-content-hash-built-from-thirty-two-bits`.
- **Only a rendering this product asked for** (rule 3): bytes marked `RawFileItem.rendering` by
  Drive's `files.export` or Dropbox's `files/export`; a customer's own `.zip` is compared by its
  bytes.
- **A stored hash carries its scheme; schemes are never compared across** (rule 4, cited as
  (d)): another scheme is **not evidence of change** — recompute and store, never re-copy.
  `sameFingerprintVersion`; guard `a-hash-compared-against-a-different-scheme`.
- **Verification says what it compared** (rule 5): the claim `container-parts`, the target re-read
  in the row's scheme. **No part is declared "not the document"** (rule 6): the hash settles a
  `.docx` and an `.xlsx`, not a `.pptx` or an `.odt`.
- **Built, not reaching the ledger** (0042 T8 (e)): the file pass's `fetchRaw` drops the marker,
  so every export is stored with a whole-file hash; passing it through is still open.
- **A rewrite follows the source's version, never an export's bytes; a renamed export is paired
  by its source id** ([ADR-0030](./0030-relocation-is-positive-evidence.md)). So **nothing is
  refused for what it measured**. Tests: `a-deck-copied-once-not-nightly`,
  `a-paper-doc-exported-once` (Dropbox Paper, since 2026-09-28).
- **`nativeFilePolicy` defaults to `refuse`**; the owner chooses per migration and per kind
  (0042 T9), and every format carries every kind. `EXPORT_STABILITY` records the measurements,
  taken through the connector like any caller, and decides nothing. The confirm screen names a
  kind left behind.

## Context

A Google Doc has no bytes of its own. Migrating one means asking Drive to **export a rendering**
— `.docx`, `.odt`, `.pdf` — and what `files.export` returns is what is written to the target. A
Dropbox Paper doc is the same case: Dropbox hands it over only through `files/export`.

This product hashes the bytes it writes and stores the hash as `contentHash`. That value is the
**verification basis** (source is compared against target by it) and what relocation correlates
by ([ADR-0030](./0030-relocation-is-positive-evidence.md)). Until #1083 (2026-09-22) it was also
the change signal. Every one of those uses assumes that an unchanged document produces unchanged
bytes.

**For Google's exports that is false.** Measured on the owner's tenant, 2026-09-16, one Doc
untouched throughout, exports three seconds apart, five draws per policy:

| policy | bytes | what actually moved |
| --- | --- | --- |
| `export-office` | 17644 **every time**, five hashes | **nothing inside the document**: all 9 members byte-identical every draw; only the zip's own modification stamps changed |
| `export-odf` | four sizes in a four-byte window | `settings.xml` genuinely changes content; the other 24 members only restamped |
| `export-pdf` | 195869 and one hash, five times | nothing detectable |

`export-office`'s instability is entirely outside the document, and it is the strongest of the
three: **lossless and editable** (a `.pdf` is a picture of a document, and for a Sheet it
discards every formula), and **11× smaller than the PDF**, 17644 against 195869 bytes. This
product meters first-copy bytes (0109 T3), sums them onto an invoice and prices tiers off them,
so the format is also a choice about what a customer is billed. But changing what `contentHash`
means for one class of file changes what verification *is* for those rows, so it is a decision,
not a patch.

## Decision

For a file this product obtained by asking a provider to render a document that has no bytes of
its own, **when the rendering is a zip, `contentHash` is computed over a canonical form of the
container** rather than over its raw bytes. The rules keep the numbers they were accepted with.
Code also cites four of them by the letter of the workplan 0042 T7 item that built each, so the
letter stands beside the number: rule (a) is rule 1, rule (b) is rule 2, rule (c) is rule 5, and
rule (d) is rule 4.

1. **(a) The canonical form is the parts, not the packaging.** Member names sorted, and for
   each, the sha256 of its **uncompressed** bytes. Excluded: member modification timestamps,
   member order, compression method and level, extra fields, and the archive comment — every
   field that describes the zip rather than the document. Bytes that will not canonicalise (not
   a zip, an unimplemented compression method, zip64, a malformed index, a failed inflate) make
   `containerContentHash` answer `null`, and the whole file is hashed: that can cause a rewrite,
   never a missed change.
2. **(b) sha256 of inflated bytes, never the zip's stored CRC-32.** `scripts/drive-export-members.ts`
   fingerprints members by the CRC-32 the index already carries, because that is free and
   answers "what moved". A `contentHash` decides whether a customer's file is rewritten or left
   alone, and CRC-32 is 32 bits and not collision-resistant. Swapping one for the other passes
   every behavioural test, so `scripts/a-content-hash-built-from-thirty-two-bits.unit.test.ts`
   guards the source.
3. **It applies ONLY to a rendering this product asked a provider to produce**: bytes marked
   `RawFileItem.rendering` by the code that asked — Drive's `files.export` branch and Dropbox's
   `files/export` — never inferred from a file extension. A `.zip` a customer stored is compared
   by its bytes like any other file, because for that file the container *is* the content: its
   member order and timestamps are data the customer owns. The narrow trigger is the whole
   safety argument: the blast radius is files that did not exist until we asked for them.
4. **(d) A stored hash records the scheme that produced it, and schemes are never compared
   across.** The scheme is a tag on the value's front (`zip1:` for parts, none for a whole-file
   sha256), with no column beside it. A row whose stored scheme differs from the current one is
   **not evidence of change**: recompute, store, and do not re-copy on that basis alone.
   Without this, adopting the scheme re-labels every already-migrated native file and rewrites
   the lot once — the disease arriving through the cure. `sameFingerprintVersion` in
   [fingerprint-scheme.ts](../../packages/shared/src/fingerprint-scheme.ts) is the one
   implementation; `scripts/a-hash-compared-against-a-different-scheme.unit.test.ts` holds that
   §20's content sample, the confirmed list and the relocation gate all reach it.
5. **(c) Verification says what it compared.** A row hashed structurally is reported as
   compared over the container's parts — on the confirmed list, the claim `container-parts`,
   *"by the document's parts"* — and the target is re-read in the scheme the row was stored in.
   A reader must never have to guess which of two meanings a green row carries.
6. **This ADR does not rescue `export-odf`, and declares no part "not the document".** A
   `.odt`'s `settings.xml` really changes, so no container normalisation helps, and the same
   holds for a deck's `.pptx` (below). Making either comparable means declaring named parts to be
   "not the document" — a claim about a format's semantics, not about packaging, and a separate
   decision with a separate risk. No ADR has made it.

**Not decided here:** whether `export-office` becomes the default. That stays the owner's
per-migration choice.

### What the hash settles, measured

Measured on the same tenant on 2026-09-16, five draws each, 3000 ms apart. The facts hold
whatever is decided, and `EXPORT_STABILITY` (`packages/connectors/src/google-drive-source.types.ts`)
records them:

| file | export | verdict |
| --- | --- | --- |
| Doc | `.docx` | **agree** once the container is normalised: 9 members byte-identical, only stamps moved |
| Sheet | `.xlsx`, 5659 bytes every draw | **agree**: 10 members byte-identical, only stamps moved |
| Slide | `.pptx` | **still differ**: 5 members change content (`ppt/_rels/presentation.xml.rels`, two more `.rels`, `ppt/theme/theme1.xml`, `ppt/theme/theme2.xml`), and the length oscillates by one byte |
| Doc | `.odt` | **still differ**: `settings.xml` |
| Doc, Sheet, Slide | `.pdf` | **stable**: 195869, 54591 and 2017 bytes, one hash ×5 each |

So the parts hash settles a Doc and a Sheet under `export-office`, not every `export-office`
file. What varies in the deck is plumbing — relationship files and themes, no
`ppt/slides/slideN.xml` — an observation about *which* members, since `drive-export-members.ts`
reads the zip index and never inflates one. A PDF is not a zip, so its greens are the whole-file
hash's, with no PDF-specific branch. They are narrow: the deck measured is thin (2017 bytes as
PDF, 34833 as `.pptx`), and images, embedded fonts and charts are where a PDF renderer is known
to vary, so a content-rich deck is unmeasured; 0042 T3 names that measurement. One red draw
disproves a rule; five green ones on one document never proved one. The hypothesis these facts
replaced (`docProps/core.xml` timestamps, `w:rsid` values) was wrong, and 0042 T3 records it.

### A rewrite follows the version, so nothing is refused for what it measured

A file is rewritten when the **source's version** moves, never because an export's bytes differ
(#1083): `FileItem.etag`, through `fileVersion`, is the provider's content hash where it keeps
one, else the last modification, which for a Google document is its `modifiedTime`. A renamed
Google document is paired by its Drive id ([ADR-0030](./0030-relocation-is-positive-evidence.md),
amended 2026-09-23), so nothing depends on a fresh export's bytes. An export that differs on
every draw is copied once, and again only after an edit.

So **no combination is refused for what it measured.** The connector does not read
`EXPORT_STABILITY`; `NATIVE_POLICY_COVERAGE` has every kind under every format, and each kind
has its own select offering all three (0042 T9). `nativeFilePolicy` unset means `refuse`, the
owner's per-migration choice; `export-office` is a supported one. The preflight counts what a
choice leaves behind, a kind set not to export, and the confirm screen names it before the run.
The measurement script exports through the connector like any caller. The owner's aim, on
2026-09-23: *"My goal would however be that we have working fileformats that suite the user."*
Refusals recorded earlier on a live migration are parked, as every refusal is, and leave the
Failures screen when somebody presses Try again (per row or per group).

`packages/core/src/a-deck-copied-once-not-nightly.unit.test.ts` holds this through the real Drive
connector and the real file pass, with an export that differs on every fetch: a deck and a Doc
are copied once, not again while Drive's modified time holds (not even exported), and once more
when it moves. `scripts/a-deck-that-would-be-rewritten-nightly.unit.test.ts` and
`scripts/an-instrument-that-cannot-take-its-own-reading.unit.test.ts` hold that nothing refuses
on the measurements.

### A Dropbox Paper doc follows the same two rules (0150 D8)

Dropbox hands a Paper doc over only through `files/export`, in the format the migration chose,
Markdown or HTML (0150 T3, T4), so its bytes are a rendering this product asked for, and the
source marks them as one. It is rewritten when the listing's version moves (`content_hash`, else
`server_modified`), never on the export's bytes, and a renamed one is paired by its Dropbox id
(ADR-0030, amended 2026-09-28). Neither format is a zip, so its stored hash is the whole file's.
`packages/core/src/a-paper-doc-exported-once.unit.test.ts` holds it the same way: copied once,
not again while the listing's version holds, again when an edit moves it, and reported as moved,
by its id, when renamed. Whether an edit in Paper moves `content_hash` or only `server_modified`
is 0150 open question 3 (b), which the owner's listing answers.

### Built, and not yet reaching the ledger (0042 T8 (e))

Rules 1–5 are built (0042 T7): `containerContentHash`, the `zip1:` tag, `sameFingerprintVersion`
at every comparison site, the `container-parts` claim, and the target re-read by scheme. None of
it is reached. The file pass's `fetchRaw` (`packages/core/src/dav-sync.ts`) rebuilds the raw item
from `item`, `content` and `body` only, so the `rendering` marker never arrives where
`contentHash` branches on it: every export is stored with a whole-file hash, no row carries
`zip1:`, and the confirmed list has never had cause to say `container-parts`. The guard for the
wiring reads source text, which is why it stayed green. No rewrite depends on this, because a
version decides. What still reads the stored hash is relocation (ADR-0030) and verification;
whether the marker should be passed through, and what that changes for those two, is 0042 T8
(e)'s open question.

## Consequences

- `export-office` is the smallest and the only lossless way to carry a Google Doc or Sheet, and
  an owner may choose it for any kind.
- A code path inflates each member of an exported container and hashes it. Its cost is
  proportional to the export's size, which rule 3 bounds to documents we asked for — the 3 MB
  ODT is the large end, not a 2 GB archive — and it does not touch the streaming path that 0120
  T6 built for genuinely large files.
- Two hash schemes can exist in the ledger at once, forever; rule 4 and its guard are what keep
  that from being a bug.
- **The contract is renderer-specific, and Google can break it.** If an export starts varying a
  member's content (a generated id inside `document.xml`, say), the parts hash moves again.
  `scripts/drive-export-stability.ts` is the detector, and running it is the habit that keeps
  this honest (0042 T6).
- §20's content sample asks the target for whole-file bytes, so a `zip1:` row would count there
  as unavailable: never a mismatch (rule 4), and not yet a parts comparison (rule 5). Moot while
  no such row is written.
- Open: 0042 T8 (e); 0150 open question 3 (b); a content-rich deck under `export-pdf`; and the
  ADR, unwritten, that would declare a format's parts "not the document".

## Alternatives considered

**Drive's own `version` as the change signal, in place of the hash** (route 1 in 0042 T3).
Cheaper than anything here, and rejected as the primary route because it stops comparing content
for a whole class of file: §20's report would assert "Google says it did not change", a
different claim from "the bytes we carried match", and its reader could not tell which.
Container normalisation keeps the comparison about content. A version stayed open as a
corroborating signal, and since #1083 a version decides *rewrites*: not Drive's `version`, which
moves on metadata alone, but a native Doc's `modifiedTime` (0042 T8 (d)). Verification still
compares content.

**Re-export and compare semantically**: parse both renderings and compare documents. It needs a
parser per format, makes the migration's correctness depend on that parser, and costs a full
export per verification. Rejected as far more machinery for the same answer.

**Normalise content, not just the container**: strip `dcterms:modified` and friends from inside
the parts, or declare a deck's relationship files and themes "not the document". It is what
`export-odf` and a `.pptx` would need. Rejected *for now* on scope: it requires knowing which
fields of which formats may be discarded, a standing claim about every future version of those
formats, where container normalisation needs to know only that a zip is a zip (rule 6).

**Do nothing**: `refuse` stands, and a Google Doc migrates only under `export-pdf`, losing
editability and costing 11× the metered bytes. A coherent position, trading a feature for a
guarantee, and the baseline until this was decided; recorded as not chosen rather than
defaulted into.

**Refuse a combination measured unstable**: a deck under `export-office` and a Doc under
`export-odf`, from 2026-09-16 to 2026-09-23, because an export that differs between two draws
looked like an edit on every pass and was copied again, nightly. Removed once a rewrite followed
the version and a rename was paired by id: it then protected nothing, parked the owner's decks on
the Failures screen, and needed a private way past it for the instrument to keep measuring.

**A refusal sentence written out by hand**, while the refusal stood. Rejected on 2026-09-16 for
one derived from the measurement table, because the written one went stale within the day: it
named a Doc to every customer whose deck had been refused, and sent a Doc refused under
`export-odf` to PDF, losing editability, where `export-office` was measured stable for it. A gate
that names no alternative is a wall. The refusal and its sentence went on 2026-09-23.

**A separate ADR for Dropbox exports** (0150 D8's other option). Not taken: on 2026-09-26 the
owner chose to amend this one, and the two rules carry over to a Paper doc unchanged.

## Amendment log

- **2026-09-16** — A Sheet and a Slide measured after acceptance: the hash settles a Doc and a
  Sheet, not a deck. The same day the connector began refusing a deck under `export-office` and
  a Doc under `export-odf` (lifted 2026-09-23). Record: *Measured after acceptance — 2026-09-16,
  the same day*.
- **2026-09-16** — `export-pdf` measured stable on a Sheet and a Slide; the refusal named a
  format measured to carry the refused file, derived from the table (`stablePoliciesFor`).
  Superseded 2026-09-23. Record: *2026-09-16, later still: the deck has a way out, and the
  refusal names it*.
- **2026-09-23** — Correction (0042 T8 (e)): built, but the marker does not reach the ledger. The
  status had said "not yet built" and the first rule "built, and live"; neither was true.
  Record: *2026-09-23: built, and not reaching the ledger*.
- **2026-09-23** — Amended (0042 T10 (c), and T9 for the per-kind choice): no combination is
  refused for what it measured, and every format carries every kind. Record: *2026-09-23,
  later: no combination is refused for what it measured*.
- **2026-09-28** — Amended (workplan 0150 D8, the owner's choice of 2026-09-26): a Dropbox Paper
  doc follows the same two rules. Record: *2026-09-28: a Dropbox Paper doc follows the same two
  rules (workplan 0150 D8)*.
- **2026-10-03** — Consolidated in place (ADR-0051). Rules 1–6 keep their numbers, and the 0042
  T7 letters that code cites stand beside them.

The full record, word for word as it read before this consolidation:
[history/0046-a-rendering-is-compared-by-its-parts.md](./history/0046-a-rendering-is-compared-by-its-parts.md).

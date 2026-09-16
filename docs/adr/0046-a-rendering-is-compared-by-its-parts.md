# ADR-0046: A rendering is compared by its parts, not by its bytes

- **Status:** **Accepted 2026-09-16** — by the owner, as proposed, the same day it was written
  and the same day the measurement landed. **Decided but NOT YET BUILT**: the tree still hashes
  every file whole, and 0042 T7 is where the build is tracked. That gap is deliberate and
  recorded rather than discovered, so nobody reads this register entry as a description of the
  code.
- **Date:** 2026-09-16; accepted 2026-09-16
- **Deciders:** owner
- **Relates to:** [ADR-0024](./0024-deletion-needs-corroborated-evidence.md) (what counts as
  evidence before the migration acts), [ADR-0030](./0030-relocation-is-positive-evidence.md)
  (the precedent for correlating by content hash, and therefore for caring what a content hash
  means), [ADR-0037](./0037-keys-credentials-and-transport-floors.md) (the hash is stored
  beside credentials under the same floors), [ADR-0041](./0041-who-owns-the-oauth-client.md)
  (whose client reaches the Drive this was measured on).
- **Relates to workplan:** [0042 T0 Q3 and T3](../workplans/0042-google-drive-source.md) — the
  measurement this decision rests on, with the numbers.
- **Enables:** [0042 T7](../workplans/0042-google-drive-source.md) — the build, and with it
  `export-office` becoming a policy an owner can choose, which no export policy is today.

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **DECIDED, NOT YET BUILT — and the code is the older rule until it is.** Today
  `contentHash` is still a sha256 over the whole file for every file without exception, and
  `nativeFilePolicy` still defaults to `refuse` with all three export policies refused. The
  build is [0042 T7](../workplans/0042-google-drive-source.md). Read the bullets below as what
  the code MUST do when that lands, not as what it does now.
- **A rendering this product asked Drive to export into a zip is compared by its PARTS.**
  `contentHash` over a canonical form: member names sorted, and for each, the sha256 of its
  uncompressed bytes. Excluded — member timestamps, member order, compression method and level,
  extra fields, archive comment. Every field that describes the zip rather than the document.
- **sha256 of inflated bytes, NEVER the zip's stored CRC-32.** `drive-export-members.ts`
  fingerprints members by the stored CRC-32 because it is free and it answers "what moved".
  CRC-32 is 32 bits and not collision-resistant, and `contentHash` decides whether a customer's
  file is rewritten. That value must never be derived from it.
- **ONLY a rendering we asked for.** A `.zip` a customer stored is compared by its bytes like
  any other file, because for that file the container IS the content. The narrow trigger is the
  safety argument, not an implementation detail.
- **A stored hash records its scheme, and schemes are never compared across.** A row whose
  stored scheme differs from the current one is NOT evidence of change: recompute, store, and
  do not re-copy on that basis. Without this rule, adopting the scheme rewrites every
  already-migrated native file once.
- **Verification says what it compared.** For structurally hashed rows, §20's report states
  that the comparison was over the container's parts.
- **`export-odf` is NOT rescued by this**, and enabling `export-office` remains a separate
  per-migration choice that still wants a Sheet and a Slide measured.
- **The measured facts hold independently of the decision**: a `.docx` from `files.export` is
  byte-unstable ONLY in its zip container — all nine members byte-identical across five draws
  while the member timestamps moved. A `.odt` additionally varies `settings.xml`. A `.pdf` was
  byte-identical over five draws.

## Context

A Google Doc has no bytes of its own. Migrating one means asking Drive to EXPORT a rendering —
`.docx`, `.odt`, `.pdf` — and whatever `files.export` returns is what gets written to the
target.

This product hashes the bytes it writes and stores that hash as `contentHash`. That one value
does two jobs: it is the **change signal** (a differing hash on the next pass means re-copy)
and it is the **verification basis** (§20's report compares source against target by it). Both
jobs assume the same thing — that an unchanged document produces unchanged bytes.

**For Google's exports that assumption is false, and 0042 T3 now says exactly how false.**
Measured on the owner's tenant, 2026-09-16, one Doc untouched throughout, exports three seconds
apart, five draws per policy:

| policy | bytes | what actually moved |
| --- | --- | --- |
| `export-office` | 17644 **every time**, five hashes | **nothing inside the document.** All 9 members byte-identical every draw; only the zip's own modification stamps changed |
| `export-odf` | four sizes in a four-byte window | `settings.xml` genuinely changes content; the other 24 members only restamped |
| `export-pdf` | 195869 and one hash, five times | nothing detectable |

So `export-office` is refused today for a defect that is **entirely outside the document**.
Google rebuilds the zip; the document inside it is bit-for-bit the same one. Hash the whole
file and every pass sees a change and rewrites every document, nightly, forever, with every
write succeeding and nothing looking broken. That is the failure 0042 exists to prevent, and it
is currently preventing it by refusing the best policy available.

**Why this is worth a decision rather than a patch.** `export-office` is the strongest of the
three on three independent counts:

1. **It is lossless and editable.** A `.docx` is a document somebody can open and change. A
   `.pdf` is a picture of one — migrating a Doc as PDF trades the editable original for a fixed
   rendering, and for a Sheet it silently discards every formula.
2. **It is 11× smaller than the PDF** — 17644 against 195869 bytes for the same content. This
   product meters first-copy bytes (0109 T3), sums them onto an invoice and prices tiers off
   them, so the policy choice is also a choice about what a customer is billed.
3. **Its instability is now understood**, not merely observed.

And yet changing what `contentHash` means for one class of file is not a refactor. It changes
what verification *is* for those rows, and §20's report would be asserting something different
about them than about everything else. That belongs in the register.

## Decision

**Accepted 2026-09-16.** For a file this product obtained by exporting a Google-native document
into a zip container, `contentHash` is computed over a **canonical form of the container** rather than
over its raw bytes.

1. **The canonical form is the parts, not the packaging.** Member names sorted, and for each,
   the sha256 of its **uncompressed** bytes. Excluded: member modification timestamps, member
   order, compression method and level, extra fields, and the archive comment — every field
   that describes the zip rather than the document.

2. **sha256 of inflated bytes, never the zip's stored CRC-32.** The diagnostic in
   `scripts/drive-export-members.ts` fingerprints members by the CRC-32 the index already
   carries, because that is free and it is answering "what moved". A `contentHash` must not be
   built that way: CRC-32 is 32 bits, is not collision-resistant, and this value decides whether
   a customer's file is rewritten or left alone. The cheap read is the right instrument for the
   diagnosis and the wrong primitive for the comparison.

3. **It applies ONLY to a rendering this product asked Drive to produce.** A `.zip` a customer
   stored in their Drive is compared by its bytes like any other file, because for that file the
   container *is* the content — its member order and timestamps are data the customer owns.
   The narrow trigger is the whole safety argument: the blast radius is files that did not exist
   until we asked for them.

4. **A stored hash records the scheme that produced it, and schemes are never compared across.**
   Without this, accepting the ADR silently re-labels every already-migrated native file: the
   next pass reads a hash computed one way, computes another, sees a difference, and rewrites
   the lot once — the exact disease, arriving through the cure. A row whose stored scheme
   differs from the current one is **not evidence of change**: recompute, store, and do not
   re-copy on that basis alone.

5. **Verification says what it compared.** For rows hashed structurally, §20's report states
   that the comparison was over the container's parts. A reader must never have to guess which
   of two meanings a green row carries.

6. **`export-odf` stays refused, and this ADR does not rescue it.** Its `settings.xml` really
   changes, so no amount of container normalisation helps. Making it usable means declaring a
   named part to be "not the document" — a claim about ODF's semantics, not about packaging, and
   a separate decision with a separate risk.

**What this deliberately does NOT decide:** whether `export-office` becomes the default, or is
offered at all. That stays the owner's per-migration choice, and it still wants a **Sheet** and
a **Slide** measured — different renderers, both unmeasured under every policy.

## Consequences

**Now that it is accepted:**

- `export-office` becomes defensible for the first time, and with it the smallest and only
  lossless way to carry a Google Doc.
- A new code path inflates each member of an exported container and hashes it. Cost is
  proportional to the export's size, which rule 3 bounds to documents we asked for — the 3 MB
  ODT is the large end, not a 2 GB archive. It does not touch the streaming path that 0120 T6
  built for genuinely large files.
- Two hash schemes exist in the ledger at once, forever, and rule 4 is the only thing keeping
  that from being a bug. It wants a guard, proved by breaking it.
- **The contract is renderer-specific and Google can break it.** If a future export starts
  varying a member's content — a generated id inside `document.xml`, say — the policy silently
  becomes unstable again. The measurement script is the detector, and running it is the habit
  that keeps this honest; 0042 T6 is where that lives.

**Had it been rejected:** `refuse` would stand, Google Docs do not migrate at all unless the owner enables
`export-pdf` and accepts the loss of editability and the 11× metered bytes. That is a coherent
position — it trades a feature for a guarantee — and it should be recorded as chosen rather than
defaulted into.

**Either way, the measurement stands.** The facts in 0042 T3 are not contingent on this
decision, and the hypothesis they replaced (`docProps/core.xml` timestamps, `w:rsid` values) was
wrong — recorded there in full, because a workplan that quietly swaps a guess for a fact teaches
nobody anything.

## Alternatives considered

**Drive's own `version` as the change signal** (route 1 in 0042 T3). `files.get` returns a
counter Drive increments on change, so an unchanged document re-exports to different bytes and
still reports no change. Cheaper than anything here, and rejected as the primary route for a
specific reason: it stops comparing content at all for a whole class of file. §20's report would
be asserting "Google says it did not change", which is a different claim from "the bytes we
carried match", and a reader of that report has no way to tell. Container normalisation keeps the
comparison about content. `version` remains a reasonable *corroborating* signal and is not
foreclosed.

**Re-export and compare semantically** — parse both renderings and compare documents rather than
bytes. Needs a parser per format, makes the migration's correctness depend on that parser, and
costs a full export per verification. Rejected as far more machinery for the same answer.

**Normalise content, not just the container** — strip `dcterms:modified` and friends from inside
the parts. This is what `export-odf` would need. Rejected *for now* on scope: it requires knowing
which fields of which formats may be discarded, which is a standing claim about every future
version of those formats. Container normalisation needs to know only that a zip is a zip.

**Do nothing.** The honest baseline, and the one that was in force until this was decided.

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

- **BUILT, and live.** A rendering a source marks as such (`RawFileItem.rendering`, set only by
  Drive's `files.export` branch) is hashed by `containerContentHash`; the target re-read is asked
  for the same scheme the row was stored in; the confirmed list says `container-parts` rather
  than "by hash". `nativeFilePolicy` still defaults to `refuse` — that is the owner's per-migration
  choice and always was — but choosing `export-office` is now a supported thing to do.
- **AND IT RESCUES A DOC AND A SHEET, NOT A DECK.** The connector refuses a Google Slides file
  under `export-office` for measured instability, per item, inside the sync loop's boundary. The
  preflight counts what a policy will refuse and the confirm screen names it before the run
  (owner's decision, 2026-09-16). An **unmeasured** combination is recorded and NOT refused: a
  blank is not a red, and refusing on one would turn off paths that work today. **The refused
  deck has somewhere to go** — `export-pdf` was measured stable on a Slide the same day (see the
  2026-09-16 addendum below), and the refusal names it, derived from the measurement table.
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
- **WHAT THIS RESCUES IS A DOC AND A SHEET, NOT EVERY `export-office` FILE.** Measured
  2026-09-16, after this was accepted: a **Sheet** fails container-only exactly as a Doc does
  (5659 bytes every draw, all 10 members byte-identical, only stamps moved) and the structural
  hash settles it. A **Slide does not**: five members genuinely change content
  (`ppt/_rels/presentation.xml.rels`, two more `.rels`, `ppt/theme/theme1.xml`,
  `ppt/theme/theme2.xml`), and two draws still differ once the container is normalised. So a
  migration carrying Google Slides would still rewrite every deck on every pass. Enabling
  `export-office` remains a separate per-migration choice AND now depends on what the Drive
  holds.
- **`export-odf` is NOT rescued by this either**, for the same reason one step earlier: its
  `settings.xml` genuinely changes.
- **The measured facts hold independently of the decision**, and there are now five of them.
  A **`.docx` from a Doc** is byte-unstable ONLY in its zip container — all nine members
  byte-identical across five draws while the member timestamps moved. An **`.xlsx` from a
  Sheet**: the same, all ten members. A **`.pptx` from a Slide**: NOT only the container —
  five members change content and the length oscillates by one byte. A **`.odt`** varies
  `settings.xml`. A **`.pdf`** was byte-identical over five draws.

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

## Measured after acceptance — 2026-09-16, the same day

This section is appended rather than folded into the text above, because what the decision
rested on and what was learned afterwards are different things and a reader needs to see both.
The **Consequences** section says `export-office` "becomes defensible for the first time". That
is now true for a Doc and a Sheet and **false for a Slide**, and the operative bullets have been
amended to say so.

The ADR was accepted on **one Doc**, and it said so: *"it still wants a **Sheet** and a
**Slide** measured — different renderers, both unmeasured under every policy."* Both were
measured hours later, on the same tenant, same 3000 ms gap, five draws each.

| editor type | export | draws | verdict once the container is normalised |
| --- | --- | --- | --- |
| Doc | `.docx` | 5 | **agree** — 9 members byte-identical, only stamps moved |
| Sheet | `.xlsx` | 5 | **agree** — 10 members byte-identical, only stamps moved |
| Slide | `.pptx` | 5 | **still differ** — 5 members change content |

The Sheet confirms the decision. The Slide refutes the general claim behind it: a container
hash computes perfectly well for a `.pptx` and **still moves on every pass**, because what
varies is inside the members rather than around them. A migration carrying Google Slides under
`export-office` would rewrite every deck nightly — the exact failure this ADR exists to
prevent, arriving through the fix for it.

**This is the measurement asymmetry doing its work.** Five green draws on a Doc were never
proof of a rule about `export-office`; one red draw on a Slide is a disproof of it. The cost of
finding out was one command, and the cost of not finding out would have been an owner enabling
`export-office` on the strength of an accepted ADR.

**What varies is plumbing, and that is said narrowly.** The five members are three `.rels`
relationship files and two themes; no `ppt/slides/slideN.xml` is among them, and the one-byte
length oscillation is what a relationship id changing width looks like. That is an observation
about **which members**, not a reading of what is inside them — `drive-export-members.ts`
compares the zip index and never inflates a member, on purpose. Whether those five could be
declared "not the document" is precisely the question rule 6 above declined to answer for
`settings.xml`: a claim about a format's semantics rather than about packaging. It would be its
own ADR, and it has not been written.

**What this does not change.** The decision itself stands unaltered: a rendering this product
asked Drive to export is compared by its parts, by sha256 of inflated bytes, never across
schemes, only for renderings we asked for. Those rules were never contingent on which editor
type produced the file. What narrowed is the SET OF FILES the rules rescue, and therefore what
an owner may be told `export-office` is good for.

---

## 2026-09-16, later still: the deck has a way out, and the refusal names it

The section above ends on *"what an owner may be told `export-office` is good for"*. This is the
other half of that sentence: what an owner may be told to do **instead**.

`export-pdf` was measured the same day on the same tenant, on the same Sheet and the same Slide,
five draws each, three seconds apart:

| type | bytes | verdict |
| --- | --- | --- |
| Doc | 195869, one hash ×5 | **stable** (measured earlier) |
| Sheet | 54591, one hash ×5 | **stable** |
| Slide | 2017, one hash ×5 | **stable** |

A PDF is not a zip, so **this ADR's hash is not involved in any of those greens**. They are
byte-identical draws, settled by the ordinary whole-file sha256, and `containerContentHash`
returning `null` on a non-zip is exactly what makes that work with no PDF-specific branch
anywhere. The decision is untouched again; what changes is the shape of the refusal it produces.

**A gate that names no alternative is a wall.** Until this run, `export-office` refusing a deck
told a customer their decks could not be carried and offered nothing. Now the refusal names a
format measured to carry the same file. The sentence is **derived** from the measurement table
(`stablePoliciesFor`) rather than written out, because the written-out version had already gone
stale: it read *"export-pdf is stable for a Doc"*, composed when a Doc was the only measurement
in existence, and it said **Doc** to every customer whose **deck** had just been refused — the
wrong file type, in the one sentence whose whole job is saying what to do next. Deriving it also
corrected a second defect nobody had reported: a Doc refused under `export-odf` is now sent to
`export-office`, measured stable for it and **still editable**, where the fixed clause sent it
to PDF and lost that for no reason.

**The evidence, stated at its real width.** The deck measured renders to 2017 bytes — a thin
one. Its `.pptx` is 34833 bytes and the five members that moved there are `.rels` files and
themes: packaging around not much content. Images, embedded fonts and charts are the surface a
PDF renderer is known to vary on (font subset tags, image recompression), so a content-rich deck
is a different question and an unmeasured one. The green is real, the asymmetry still holds, and
the next measurement worth taking is named in workplan 0042 T3.

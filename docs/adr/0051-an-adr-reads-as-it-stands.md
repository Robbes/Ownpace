# ADR-0051: An ADR reads as it stands — a budget for the operative layer, and consolidation in place

- **Status:** Accepted 2026-10-03 (owner, on the recommendation recorded below: *"Do step 1 and
  2."*)
- **Date:** 2026-10-03
- **Deciders:** owner
- **Amends:** [ADR-0038](./0038-operative-rules-and-the-growing-record.md) — its operative rules
  are amended in place to match; AGENTS.md hard rule 7

## Operative rules

<!-- What holds NOW, within this ADR's own budget. Amend in place when a later decision changes
     it, then regenerate OPERATIVE.md: node scripts/adr-operative.mjs --write -->

- **An operative section has at most 8 bullets, 60 words a bullet and 300 words in all, and no
  sub-headings** (table rows are not counted). `scripts/adr-operative.mjs` refuses to assemble
  `OPERATIVE.md` otherwise, naming every file and limit at once.
- **A bullet states the rule and points at what holds it** — a guard, a file, a section below.
  Reasons and examples go in the body; earlier wording goes to `history/`; neither goes in it.
- **An ADR's `**Status:**` entry is at most 400 characters**: where it stands and how many
  amendments. The dated story is its `## Amendment log`.
- **A change decided but not in force is a `**Pending`** bullet in the operative rules and a
  `## Pending` section holding its text** — both, or neither.
- **An ADR that can no longer be read without reconciling its amendments is consolidated in
  place**: same number, file name and title, rewritten as it stands. Its old text moves word for
  word to `docs/adr/history/`, linked from the amendment log; labels cited elsewhere keep their
  meaning.
- **A record is never edited or deleted.** Hard rule 7 reads *append-only, or moved word for word
  to `docs/adr/history/`*. A cluster of several ADRs is still consolidated by a new ADR
  (ADR-0038).
- The guards: `scripts/adr-operative.unit.test.ts`.

## Context

ADR-0038 (2026-08-19) split the record from the rules: every ADR states what holds now in its
own `## Operative rules` section, and `OPERATIVE.md` assembles those sections so a reader loads
a few thousand words instead of the corpus. Drift between the two was guarded. **Size was only
asked for**, in a template comment ("3–8 terse bullets"), and nothing read the comment.

| | 2026-08-20 | 2026-10-03, before this change |
|---|---|---|
| ADRs | 41 | 50 |
| ADR files, in words | 58,426 | 84,007 |
| `OPERATIVE.md`, in words | 6,510 | 12,136 |

Measured with `wc -w` over the files at each date. Six weeks after the layer existed it had
doubled while nine ADRs were added, because operative sections filled with reasons, examples
and *"this bullet originally named…"* notes: ADR-0014's had 27 bullets and 2,024 words,
ADR-0041's 23 and 1,832, and the nine ADRs written since averaged about 440 operative words
against about 60 for the first twenty-nine. Status lines became paragraphs (ADR-0035's ran to
1,308 characters). ADR-0042 carried an amendment, heading and all, inside its operative section,
so `OPERATIVE.md` printed narrative as a rule.

Worse than the size: **the layer had stopped saying what holds.** Three of ADR-0014's later
amendments — the `continuous` lane that holds a slot (2026-09-10), the stop per data type
(2026-09-24) and the cutover per data type (2026-09-26) — never reached its operative section,
so `OPERATIVE.md` still described four path states and a cutover that ends everything. ADR-0014's
proposed new price list (2026-09-29) sat at line 982 of 1,102, invisible in the layer. And the
amendment chains at the bottom of ADR-0014, 0027, 0030, 0034, 0046 and 0048 could only be read
by reconciling them in order — the failure ADR-0038 named, *"a reader who found ADR-0034's
original decision 4 and missed the amendment would act on repealed machinery"*, at the scale of
whole files.

The owner asked whether every ADR should simply be rewritten to its latest state, with history
left to git. The recommendation was to keep the goal and change the means: tighten the layer that
already exists, then rewrite only the ADRs that had become amendment chains, keeping their record.

## Decision

### 1. The operative section has a budget, refused at assembly

At most **8 bullets**, **60 words a bullet**, **300 words in all**, and **no `###` heading**
inside the section. List markers are not words; **table rows are not counted**, because a table
there is data — ADR-0014's tier table is what two price guards parse. The generator checks every
ADR before it writes anything and reports every problem at once, so the limit meets the author
at `--write` rather than in review. The numbers are `BUDGET` in `scripts/adr-operative.mjs`; the
template states the same numbers and a test holds the two together.

300 rather than 250 words: 250 was tried first, and ADR-0014 — a pricing model with some twenty
live constraints — could only be fitted into it with bullets too terse to act on. The cap exists
to keep the assembled layer loadable, not to make rules cryptic.

### 2. A bullet states the rule and points at what holds it

The pointer is, in order of preference, the guard that enforces the rule, the file that
implements it, or a section of the same ADR. Reasons, worked examples, quotes and earlier wording
belong in the body. Where a whole family of rules lives in the body — ADR-0014's wording rules
for the page, the gauge and the invoice — the bullet names the family and points at its section.

### 3. The header says where an ADR stands; the amendment log says how it got there

The `**Status:**` entry is at most 400 characters (the register's row cap, for the same reason):
the status, its date, and how many amendments — never their story. Every change after acceptance
is one dated line in `## Amendment log` at the end of the file: what changed, who decided it,
where it is written.

### 4. A pending change is visible in the rules, or it is not pending

A change the owner has decided on but that is not in force yet — usually because code and a guard
change with it — is one `- **Pending (proposed YYYY-MM-DD, not in force):** …` bullet in the
operative section **and** a `## Pending — …` section holding its text in the same file. The test
holds the two together in both directions: no proposal hidden in the body, no stale bullet after
acceptance. On acceptance the text is folded into the decision and the rules, the section and the
bullet go, and the acceptance gets a line in the amendment log.

### 5. Consolidation in place

When an ADR can no longer be read without reconciling its amendments — in practice, around its
third amendment that changed what was decided (build records and measurements do not count) — it
is consolidated **in place**:

- **Same number, same file name, same title.** About 1,300 references in code and 1,450 in
  documents cite ADRs by number and path (84 files cite ADR-0014 alone, 71 ADR-0041), so a new
  number would leave every one of them pointing at a banner.
- **The top is rewritten as the decision stands today**: Context, Decision, Consequences and
  Alternatives considered, every accepted amendment folded in, written as if decided now. Every
  rule in force survives, and so does **every rejected alternative with its reason** — the *why
  not* is what stops a decision being argued again.
- **Labels cited elsewhere keep their meaning**: ADR-0046's rules (a)–(d), ADR-0035's numbered
  decisions, ADR-0014's schema consequences 1–5.
- **A pending proposal stays in the file**, under its `## Pending` section: it is live, not
  history.
- **The old file moves word for word to `docs/adr/history/<same file name>`**, with a frozen
  banner and its relative links re-based for the folder (the only change), and the amendment log
  links it. The generator never reads `history/`, so a record is never assembled as a rule.

ADR-0038's consolidation ADR remains the tool for a **cluster** of several ADRs that conflict or
supersede one another; a single over-amended ADR is consolidated in place.

### 6. Compression without consolidation

An ADR whose only problem is an oversized operative section keeps its body as it is. The section
is rewritten to the budget, and the file as it read before moves word for word to
`docs/adr/history/`, exactly as a consolidated ADR's does, linked from a dated line in its
amendment log — so no reason the old bullets carried is lost, and none of it is carried in the
file a reader opens. (Appending the old bullets to the file was tried first, the same day: it
kept the reasons and grew the files it was meant to shrink.)

### 7. What this change did

- **Consolidated in place**: ADR-0014, 0027, 0030, 0034, 0035, 0041, 0042, 0046 and 0048 — the six
  the recommendation named; 0046 and 0048, whose five and eight dated changes after acceptance made
  them the longest chains after 0014; and 0042, whose four amendments had lived inside its
  operative section, so that compressing it left their reasons out of the file a reader opens.
- **Compressed**: the operative sections of ADR-0020, 0024, 0038, 0039, 0040, 0043, 0044, 0047,
  0049 and 0050; the status entries of 0032, 0036, 0047 and 0050.
- **Every rewrite was checked by a reader who had not written it**, against its record and the
  code; what the checks found — rules dropped or weakened, claims the code contradicts, labels that
  no longer resolved — was corrected before this change was finished.
- **Result**: `OPERATIVE.md` from 12,136 to 7,679 words; the ADR files a reader
  opens from 84,007 to 69,699 words, with 60,957 words of
  record in `history/`. Every ADR is within every limit, so the budget is a hard limit from its
  first day, not a ratchet.

## Consequences

- An author over the budget finds out at `node scripts/adr-operative.mjs --write`, with every
  problem listed; CI's docs job runs the same generator with `--check`, so a docs-only change
  cannot merge over budget either.
- `scripts/adr-operative.unit.test.ts` holds the rest: the status cap and the Pending pairing per
  ADR, and for `history/` that every record keeps its ADR's file name, carries the frozen banner,
  is linked from an ADR with an amendment log, and that every relative link under `docs/adr`
  resolves. The count of records only rises.
- `scripts/a-sixth-state-added-to-only-one-list.unit.test.ts` read ADR-0014's 2026-09-10
  amendment paragraph; it now reads the operative rules, which is where a rule in force belongs.
- AGENTS.md hard rule 7, CONTRIBUTING.md, the template and the register say the same.
- A consolidation is a rewrite of a decision's wording, so it can be wrong. Each one in this
  change was checked against its record and the code by a reader who had not written it; the
  record in `history/` is what a future reader appeals to.

## Alternatives considered

- **Rewrite every ADR to its latest state and leave history to git** (the question as first
  asked). Rejected: agents work from shallow clones — the session that made this change started
  with one — so git history is not where a reader finds why an option was rejected; about sixty
  references cite a specific amendment ("ADR-0035's amendment of 2026-09-29"), and a test read an
  amendment's text; and it would buy little, since agents already load `OPERATIVE.md` and never
  the narratives. Most ADRs were already short.
- **A ratchet with an allowlist of today's offenders.** Unnecessary: every ADR was brought within
  the budget in this change.
- **A new ADR number for each consolidation** (ADR-0038's escape valve). Kept for clusters;
  rejected for a single ADR, whose citations would all land on a banner.
- **Archive to a subdirectory**, which ADR-0038 rejected because it broke citations. This is
  different: the cited file stays where it is; only its record moves.
- **Keep the old operative wording only in git** for compressed ADRs, as in-place amendment always
  allowed. Rejected for this change because some of those bullets carried the only statement of
  a reason. **Appending them to the ADR** loses nothing either, but it is history kept in the file
  a reader opens — the thing this decision exists to stop; `history/` holds it instead.
- **A per-section budget of 250 words.** Tried; see decision 1.

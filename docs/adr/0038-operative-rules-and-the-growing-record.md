# ADR-0038: Operative rules — keeping a growing decision record loadable

- **Status:** Accepted 2026-08-19 (owner decision: "do the advised path… don't hesitate to
  make a Consolidation ADR when things get too complicated to follow between several
  superseded and conflicting ADRs"); amended once (2026-10-03, by ADR-0051)
- **Date:** 2026-08-19
- **Deciders:** owner

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- Every ADR carries an **`## Operative rules`** section stating what holds NOW, amended **in
  place** when a later decision changes it, within ADR-0051's budget. Everything below it stays
  append-only, or moves word for word to `docs/adr/history/` (ADR-0051).
- **`OPERATIVE.md` is generated, never edited**: `node scripts/adr-operative.mjs --write`
  assembles it from the sections; the unit test fails any drift. It is build output of the
  ADRs, not a second source.
- **Reading protocol** (AGENTS.md carries it): load `OPERATIVE.md` for constraints; open a full
  ADR only to challenge or amend that decision; never bulk-read `docs/adr/`.
- **Register rows are one sentence** — status, date, one qualifier. The register is the
  status index; the operative sections carry the substance; a row over ~400 characters
  fails the guard.
- Where a rule is mechanically checkable, **the guard is the rule** (the ADR points at the
  test); prose that a test enforces cannot drift.
- **Consolidation is used without hesitation** once a decision stops being followable: a single
  ADR in place (ADR-0051), a cluster by one new ADR restating its live rules. A **conflict
  between Accepted ADRs is never resolved by consolidation** — it goes to the owner.
- Workplans follow the same interface rule going forward: the **Status block is the
  workplan's interface**; nobody should need the narrative to learn what was proved.

## Context

Thirty-seven ADRs and ~38,600 words accumulated in two months, and the corpus serves two
functions with opposite requirements. The **historical record** — provenance, corrections,
"what this said first and why it changed" — is append-only, valuable, and rarely needed in
full. The **operative constraints** are needed on every task, by people and by agents whose
context they eat, and extracting them meant reading whole files and reconciling their
amendment history: a reader who found ADR-0034's original decision 4 and missed the
amendment would act on repealed machinery. The register was compensating by growing
paragraph-length rows — a second corpus in the making, and its own header names that exact
failure ("if you find yourself writing a second list of ADRs…").

## Decision

Separate the two functions without splitting the files: the operative section lives at the
top of each ADR (single source, next to its history), and the assembled `OPERATIVE.md` is
derived from it mechanically. The drift risk that killed SAD §24's prose list is answered
the way this repo answers everything — a regenerate-and-diff guard, so the summary cannot
disagree with its source and stay green.

Numbers, so the trade is visible: the full corpus is ~50k tokens to load; the assembled
operative layer is a few thousand. Growth now scales with **decisions** (bullets), not with
**narrative** (which keeps its full length and its full honesty — nothing is deleted).

## Consequences

- Backfilled across ADR-0001–0037 in this change; the template carries the section so new
  ADRs start with it; `pnpm adr:operative` regenerates.
- The backfill surfaced one standing conflict (0009 vs 0036, open-core) — flagged in both,
  deliberately not resolved here.
- The register was slimmed in the same change; its long rows migrated into the operative
  sections they were compensating for.
- Not done here: rewriting existing workplans to the Status-block rule — the convention
  applies forward, and 0084-scale narratives stay as they are.

## Alternatives considered

- **Discipline only** (write shorter): slows growth, does not fix live-rule extraction.
- **Consolidation-first** (case-law restatements on a schedule): real recurring writing
  cost and its own drift; kept as the escape valve, not the mechanism.
- **Archive retracted ADRs to a subdirectory**: breaks the 141 in-code citations for the
  smallest gain; the growth is in the live files, not the retracted ones.

## Amendment log

- **2026-10-03** — Amended by [ADR-0051](./0051-an-adr-reads-as-it-stands.md): the operative
  section's budget is refused by the generator, a single over-amended ADR is consolidated in
  place with its record in `docs/adr/history/`, and the consolidation bullet loses its "current
  instance" (ADR-0009 vs ADR-0036), which [ADR-0039](./0039-no-open-core-and-what-ops-privacy-means.md)
  resolved on 2026-08-19. Record: *Operative rules at length*, below.

## Operative rules at length (as they read until 2026-10-03)

The operative section above was cut to the ADR-0051 budget on 2026-10-03. Below are its
bullets as they read before, word for word: the same rules, with the reasons and examples
that no longer fit there. This is a record; the section above is what holds.

- Every ADR carries an **`## Operative rules`** section: 3–8 terse bullets stating what
  holds NOW, amended **in place** when a later decision changes them. Everything below that
  section stays append-only (hard rule 7 unchanged).
- **`OPERATIVE.md` is generated, never edited**: `node scripts/adr-operative.mjs --write`
  assembles it from the sections; the unit test fails any drift. It is build output of the
  ADRs, not a second source.
- **Reading protocol** (AGENTS.md carries it): load `OPERATIVE.md` for constraints; open a
  full ADR only to challenge or amend that decision; never bulk-read `docs/adr/`.
- **Register rows are one sentence** — status, date, one qualifier. The register is the
  status index; the operative sections carry the substance; a row over ~400 characters
  fails the guard.
- Where a rule is mechanically checkable, **the guard is the rule** (the ADR points at the
  test); prose that a test enforces cannot drift.
- **Consolidation ADRs are the escape valve, used without hesitation** when a cluster stops
  being followable across supersessions/conflicts: one new ADR restates the cluster's live
  rules; the old files stay, gain a "superseded by" banner, and their operative sections
  shrink to a pointer. A **conflict between Accepted ADRs is never resolved by
  consolidation** — it is flagged in both operative sections and goes to the owner
  (current instance: ADR-0009 vs ADR-0036 on open-core).
- Workplans follow the same interface rule going forward: the **Status block is the
  workplan's interface**; nobody should need the narrative to learn what was proved.

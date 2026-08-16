# ADR-0031: Auto-applying relocations — what unattended would require

- **Status:** Proposed (awaiting owner decision — **no code until accepted**)
- **Date:** 2026-08-16
- **Deciders:** owner
- **Relates to:** ADR-0030 (relocation is positive evidence, and its amendments — every gate
  named there is assumed here), ADR-0024 (`apply` — the one destructive path), ADR-0005
  (non-destructive by default). Arch doc §11.1.

## Context

ADR-0030 made a correlated relocation applicable, and its amendments hardened the gates until
the claim and the code matched: the arrival must be ours (`copied`/`updated`, never
`adopted`), same content hash, re-checked inside the removal's own SQL statement, pairing
refused when a third item shares the hash, the two-halves mass breaker, `keep` enforced
server-side, and — the owner's own addition — the target is ASKED (`hasItem`) as the last
thing before anything is removed.

All of that assumes a human pressed the button. The owner's stated requirement for the first
Drive customer, though, is a target that **follows the source, including moves** — and a
migration that turns every drag into a queue entry a human must answer is following the
source only as fast as somebody keeps pressing `apply`. The request "just apply them
automatically" is coming; this document is the decision about what that requires, made
before the request rather than under it.

**Why this is not simply "run the existing gates on a timer."** ADR-0030's own amendment
records the lesson: the shipped gates were weaker than the document's argument three separate
ways, and each gap was found by someone *looking*. Manual apply has a human in front of it who
sees the queue entry, the from/to paths, and the refusal wording — an implicit gate this
product has leaned on every time a sentence was written "so the owner can act on it".
Unattended apply deletes that gate. Everything below is the replacement.

## Decision (proposed)

A per-mapping setting, **`autoApplyRelocations`, default `false`** — off is not a
recommendation, it is the shipped behaviour; turning it on is a written owner decision per
mapping, like `allowApplyDeletions`. When on, the end of each pass applies open relocations
that clear EVERY manual gate **plus four gates specific to nobody looking**:

**1. The pairing must be UNIQUE, not merely unambiguous.** Manual apply refuses when the
pairing is ambiguous — a third item sharing the content hash. Auto-apply requires that **no
other live item in the corpus shares the hash at all**, even when the pairing happens to
resolve. A human shown "moved `a/report.pdf` → `b/report.pdf`" can notice the pairing is
nonsense; unattended, the pairing IS the decision. Empty files alone make hash collisions
ordinary (every empty file matches every other), so under auto-apply they are simply never
eligible — reported, left in the queue, a human decides.

**2. The relocation must have SURVIVED a pass.** A correlation born of a flaky listing — a
folder that answered one pass empty and the next pass full — looks exactly like a real move
for one pass, and self-corrects on the next. Manual apply is protected by human latency;
nobody presses the button in the seconds the illusion lasts. Auto-apply arrives at exactly
that moment, so it must wait: a relocation is eligible only after it has stayed open,
unchanged, through at least **one further completed pass** of its domain.
**Required schema work, named now:** the `item` row does not record *when* its move was
recorded (`moved_to_natural_key_hash` has no timestamp beside it), so this gate cannot be
built without a `moved_recorded_at` column (or a recorded-at-pass marker) and its migration.
That column earns its place regardless — today an operator reading the queue cannot tell a
fresh report from one that has sat for a month.

**3. The mass breaker decides for the PASS, not per item.** The two-halves breaker
(ADR-0030) stands unchanged in front of every removal. Under auto-apply it is additionally
evaluated ONCE, against the full open set, before the batch starts: if the share of open
relocations would trip it, auto-apply does nothing this pass — it does not apply a polite
number below the threshold and try again tomorrow. A per-pass cap must not become a
mechanism for slowly nibbling through a mass event that a human was supposed to look at.

**4. A per-pass cap, and attribution that names the machine.** At most **50 auto-applies per
mapping per pass** (a number for the owner to move, not a law): the worst wrong batch is
bounded, and a runaway is visible across several passes rather than complete in one. Every
auto-apply is recorded as performed by **`system:auto-apply`** — in the audit log, and on the
apply receipt in the managed edition — never attributable to a human who did not act, and the
run summary states the count in words ("relocation apply: N old copies removed
automatically, M left for review"). Silent tidying is how trust in a destructive feature
dies; the feature narrates itself or it should not run.

**What never auto-applies, stated as scope rather than discovered as absence:** deletions
(either evidence class — `reported` deletion is a claim about the source, and ADR-0024's
whole argument for a human stands); anything the manual gates refuse; anything `keep` has
answered; ambiguous or non-unique pairings (gate 1); relocations younger than a pass
(gate 2). Refused items stay in the queue with the refusal — auto-apply narrows the queue,
it never empties it by force.

## Consequences

If accepted, the build is: the `moved_recorded_at` column + migration; an
`autoApplyRelocations` flag on `mailbox_mapping` (surfaced in the wizard beside
`allowApplyDeletions`, refused in the same sentence structure); an `evaluateAutoApply` pass
over the open set implementing gates 1–4 in front of the EXISTING `applyRelocation` (no
second destructive path — the same function, the same gates, one more caller); both editions
through the shared evaluator (rule 5); tests at every gate with mutation checks, including
one proving the breaker stops the whole pass and one proving the cap cannot nibble a mass
event; and the operator-runbook section saying what turning it on means.

If declined, the manual path is complete as built, and this document records why the button
stays: **safe to press once, having looked, is not the same as safe unattended** — and the
four gates above are the measured difference between those two sentences.

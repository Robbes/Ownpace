# Workplan 0124 — What we changed, and what we left alone

## Status — 2026-09-18 (update this block at the end of every session)

**2026-09-18, later: T1 built.** The owner chose to repair on the way out rather than only after a
refusal, and gave the reason: *"i pick a, since we already now it needs repairing, because else it
will not land in the target. So we can do that already when recognizing in transit."* Three things
the plan did not have:

- **Byte-identity is the hard rail, and it decided the shape.** §2 said a card with nothing
  matching goes through byte-identical, and the reader works on UNFOLDED lines — so rebuilding from
  those would re-fold, normalise line endings and drop a trailing newline on every card in an
  account. The repair instead edits the individual CHARACTERS that are wrong: the unfolder now
  carries a per-character offset map, and a fault becomes one `,`→`;` at one offset in the original
  body. Nothing else moves.
- **It has to run before the content hash.** Not stated anywhere, and the quiet one: hashing the
  unrepaired bytes stores the hash of something we never sent, so every later pass sees a change
  nobody made and rewrites the card — nightly, silently.
- **Two of the four mutations passed first time**, which means two guards were asserting nothing. A
  CRLF-only fixture cannot tell a rebuilt body from an untouched one (`toBe` on strings is equality,
  not identity), and the mutation aimed at the quoting rule hit a branch that returns earlier. Both
  tests were replaced, and both now go red.

T2 is untouched.

**2026-09-18: opened, both halves decided by the owner.** Two findings from his live run, with
one principle between them: **a pass must never quietly do something to a customer's data, and
never quietly decline to.** A repair nobody records is a silent rewrite; an item left alone
that nothing reports is a silent skip. Both are the same failure wearing opposite signs.

| Task | Status | Notes |
|---|---|---|
| T1 The comma where a semicolon belongs, repaired | ✅ Done — §2 | `repairPayload` beside the reader that diagnoses the same shape; one `,`→`;` per fault, at an offset in the original body. Migration 0052 records it on the item. |
| T2 Left alone is not copied | ⬜ | Owner chose **option (a)**: say it on the migration page. The per-item surface exists; the per-domain count does not. §3 |

## 1. The two findings

**The card.** Two of the owner's 1,400 contacts have been refused by a live Nextcloud, five
attempts each, since his first real run. [#994](https://github.com/Robbes/Ownpace/pull/994)
found the cause in the destination's own log — `VALUE` was holding a whole second parameter,
folded into its value list by a `,` standing where a `;` belongs — and deliberately stopped at
a **reader**, because repairing somebody's card needed the owner's word:

> *Still a reader and not a repair. `carddav-source.ts` hands the PUT exactly what the source
> served, so the comma is in the customer's card and restoring the semicolon would rewrite
> their content on our reading of it. That needs the owner's word, not a bug fix.*

He gave it, and gave the reason this is not a one-account problem:

> *"the contact just is in my Google contact-list. Other people will also have such data. Can
> you fix it in transit, would you recommend me that?"*

An Apple-written contact synced into Google is an extremely ordinary shape. "Ask every customer
to hand-edit their own cards" is not a product.

**The item we left alone.** Hard rule 2 means a target item we did not write is never
overwritten — `domain-sync.ts:333` returns `'leave-adopted'` and the row is stored
`status: 'adopted'`. `confirmed-list.ts:308` already renders that per item, honestly, as
`state: 'yours'`. What no surface carries is the *count*: the migration page cannot say "eleven
items were already there and were left as they were", so on every screen above the item list,
an adopted item is indistinguishable from one we copied.

## 2. T1 — the repair, and why it is not a content change

`;` separates vCard **parameters**. `,` separates **values inside one parameter**. The property
Sabre choked on:

```
BDAY;VALUE=DATE,X-APPLE-OMIT-YEAR=1604:...
args: [["DATE","X-APPLE-OMIT-YEAR=1604"]]
```

`VALUE` is not holding two value types. It is holding `DATE` and an entire second parameter,
and the array Sabre built is the proof. This is malformed by the grammar, not a stylistic
choice — which is what makes repairing it different in kind from rewriting a customer's data.
**The date itself is never touched.** The repair restores the separator that makes the same two
parameters parse as two parameters.

Three guard rails, each pinned by a test proved by breaking it:

1. **It fires on one shape only.** A parameter's value list contains an entry shaped
   `NAME=value`. That is never a legal value of `VALUE`, `TYPE` or `PID` — the reader in
   `dav-payload-defects.ts` already establishes this, and the repair reuses its judgement
   rather than inventing a second opinion.
2. **It splits, and does nothing else.** The entry becomes its own parameter. No reordering, no
   case changes, no quoting changes, no other property touched. A card with nothing matching
   goes through byte-identical — and that is the test that matters most, run over the whole
   fixture corpus.
3. **It is recorded, never silent.** The item carries that a malformed parameter separator was
   corrected, so the change is visible on the row rather than a quiet rewrite. This is the rail
   that makes the other two safe to have: if the rule ever fires somewhere it should not, the
   evidence is on the item, not in a log nobody reads.

Quoted values are the trap. A parameter value may be double-quoted, and a `,` **inside quotes**
separates nothing — the splitter must respect that or it will shatter a legitimate value. #994
already built quote-aware splitting for the reader; the repair uses the same code, which is the
point of putting it there.

**Where it sits.** In the payload path, not in the connector: `carddav-source.ts` handing over
what the source served is correct and stays correct. The repair belongs beside the reader that
diagnoses the same defect, so the sentence a failure produces and the correction a pass applies
can never drift into describing different shapes — and it is in the SAME FILE, which is the
strongest form of that. A test asserts the two agree about which cards are wrong.

### What building it added to this section

**Byte-identity decided the implementation.** Rail 2 cannot be kept by rebuilding: the reader works
on unfolded lines, and a body re-emitted from those has been re-folded, its line endings
normalised, and its trailing newline decided by us — on every card in somebody's account, including
the ones with nothing wrong. So `logicalLines` now carries a per-character offset map, and the
repair replaces individual characters in the ORIGINAL body. A card with nothing matching is
returned as the same value it came in as.

**It runs first, before the content hash** — the rail nobody wrote down. `contactContentHash` of
the unrepaired bytes is the hash of something we never sent, so every later pass would compare the
source against a description of a card that is not on the target, find a change nobody made, and
rewrite it nightly with nothing in any report saying so. The repaired body is what goes out, what
is hashed and what is measured, or the three disagree. A guard asserts the order.

**Recorded on the SUCCESS path only, and that is a stated boundary.** `item.repaired` (migration
0052) is written by both `recordIfAbsent` calls in the writer — including the adopted one, where
nothing was written but the repair still happened to the bytes we hashed. `recordFailure` does not
carry it: a card repaired and then still refused would be worth saying, but the repair happens
inside the writer and the failure is recorded by the sync loop from a thrown message, so plumbing
it there means carrying it on the throw for a case no refusal has yet produced. It arrives as a
refusal first.

## 3. T2 — left alone is not copied

`DomainStatusReport` (`operating-contract.ts:211`) carries `itemsSynced`, `itemsFailed`,
`itemsRetrying` and `itemsNeedingDecision`. There is no count of items we deliberately did not
write, so the migration page has nothing to render and the sentence cannot be said.

The count is added to the report, filled from the ledger's `status = 'adopted'` rows, and shown
per domain on the migration page, next to what was copied.

**Two rows wear that status**, and `confirmed-list.ts:246` is emphatic that they are different:

- *adopted at first sight* — the target already held an item under our natural key; we never
  wrote it.
- *adopted by conflict* — we wrote it once, the customer has since edited our copy, and hard
  rule 2 leaves their edit standing.

The ledger cannot tell them apart after the fact, and **this task must not pretend otherwise**.
One count, and a sentence that covers both truthfully: these were already on the new system, or
have been changed there since, so they were left as they are. Inventing a split the data cannot
support would be a worse lie than the silence it replaces.

**One contract decision this forces.** 0122 T1 made the progress-link page's fields a deliberate
choice — `viewRowFor` over a `Required<DomainStatusReport>` fixture, so a new field is a
**typecheck failure** until somebody decides whether a stranger may see it. A new count trips
that on purpose. The answer here is yes: it is a count, not content, it carries no name and no
key, and a reader watching their own migration has more right to "eleven were already there"
than almost anything else on that page.

**Not an overwrite press.** The owner chose option (a) and explicitly not (b). Writing over data
we did not write is what hard rule 2 exists to forbid, and the asymmetry decided it: (b) can be
built on top of (a) later, but it cannot be taken back once somebody has pressed it.

## 4. Gates

Standard: `pnpm lint`, `SKIP_STALWART=true SKIP_NEXTCLOUD=true pnpm test`, then `pnpm typecheck`
**last** — vitest strips types, so a typecheck that ran before the final file was written has
not run.

T1's corpus test is the one to write first and keep: every card in the fixtures that does *not*
match the rule must come out byte-identical. A repair that fires where it should not is worse
than the refusal it replaced, because the refusal was at least visible.

## 5. Not in this plan

- **Backfilling names onto rows written before migration 0050.** Adopted rows and named rows
  are both written at copy time; healing the back catalogue needs a re-read pass, which is its
  own decision and its own cost.
- **The overwrite press** (option (b)) — declined for now, see §3.
- **Other malformed-vCard shapes.** The rule in §2 fires on one shape because one shape is what
  the evidence shows. A second shape needs a second piece of evidence, not a generalisation.

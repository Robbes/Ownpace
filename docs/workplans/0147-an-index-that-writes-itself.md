# Workplan 0147 — An index that writes itself

> **In one line:** Generating the workplan table in `docs/workplans/README.md` with `scripts/workplan-index.mjs` and a CI drift check, keeping the old hand-written sections as history, correcting stale plan Status blocks, explaining 0048 to 0050, and a numbering rule.

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24, evening: T1, T2, T3 (a), T4 and T5 built, with one line per plan added (D5).** The
owner: *"also, i see that the "Workplans — index & sequencing" is outdated and doenst contain the
small summaries of recent workplans, while it was supose to speed up the agents."* So T1 was
built now instead of after the first invitation, and the index gained what the owner asked for:
every plan opens with `> **In one line:** …`, one sentence on what it is about, and the table
shows it (D5). On branch `claude/ownpace-public-readiness-y7orc6-an-index-that-writes-itself`:

- `scripts/workplan-index.mjs` (`--write` / `--check`), its guard
  `scripts/workplan-index.unit.test.ts` (20 fixture cases, 19 of them failing without the
  script), the check in `docs-hygiene`, `pnpm workplans:index`, and AGENTS.md's session
  protocol;
- the README: the generated region under `## Index`, `## Numbering` (T4 and T5), and the old
  sections kept under `## History` (T2);
- a one-line summary in each of the 146 plans, written from the plan and checked against it by a
  second reader;
- T3 (a): the dated notes on 0008 T7 and 0026 row 14, and 0009's row T13;
- T4: a search of the full history (3,379 commits) found no commit that ever added a plan file
  numbered 0048, 0049 or 0050.

T3 (b) is still to do, when the other session is idle.

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that
the workplan index, `docs/workplans/README.md`, was last verified on 2026-08-03. On `main` it has
rows for 0001 to 0039 and none for the 88 plans after them, and eight of its rows contradict the
plan they describe. The index warns about this itself, three times (§1). The review also found
Status blocks in the plans that contradict themselves or the code, and three plan numbers that
code cites but no file carries. The owner chose to have this plan written: *"W11 write, W12
write, W13 write, W14 write, W15 explaoin, W16 write, W17 write, W18 explain, W19 write"*. 0131 §5
calls this work W19.

The repository already writes two of its indexes from their sources and fails CI when either
drifts: `docs/LESSONS.md` (`scripts/lessons.mjs`) and `docs/adr/OPERATIVE.md`
(`scripts/adr-operative.mjs`, ADR-0038). This plan does the same for the workplan table (T1),
keeps the hand-written sections as history (T2), corrects the Status blocks the review found
wrong (T3), explains the missing numbers (T4) and writes down how numbers are taken (T5).

Nothing in this plan is built. One of T3's items is already fixed in code: the consistency PR
#1137, merged on 2026-09-24, gave the manual sync its `concurrencyKey` (`f9d3d1d`), so 0022's
note only records it. Every fact in §1 was checked at this checkout on 2026-09-24: `main` at
`987cb06`, plus the commits that carry 0131 to 0147. The GitHub facts in §1 were read from
GitHub's API the same day.

T3 edits other plans' Status blocks. The alpha's plans (0131 to 0147) are being written and
revised in another session today, and several were still being edited when this plan was
written. T3 is therefore one pull request, made when that session is idle. Every correction is
a dated note in the plan's own Status block, apart from two SUPERSEDED banners that go under a
title (§3). Nothing already written is reworded or removed.

**2026-09-24, cross-plan sync: 0009's section headed T9 is decided, and W15 and W18 are 0148 and
0149.** Later the same day the owner answered W18: *"write as a plan. But we do offer 'apply
deletions'. And do hold the cutover-gate when nothing was compared."* The last sentence decides
0009's section headed T9 (0149 D2, read as 0009's option 1), and 0149 T4 carries it. The note on
0009 that T3 (a) planned was written the same day, at the top of 0009's Status block, by the
session that synced 0148 and 0149. It records the decision, the answer of 2026-09-21 it replaces,
and 0149 T4. What T3 (a) still does for 0009 is the table row. The 0009 line numbers this plan
cites are re-taken after that note. W15, which D1 and *Not in this plan* called not planned, is
0148.

**Before the first invitation.** This is the minimum, and it is kept small:

- T3 (a): three dated notes, on 0009, on 0008 T7 and on 0026 row 14. The owner reads these plans
  when deciding go or no-go. Each of them said that something is settled when it was not (0008 and
  0026 still do), and each bears on a tester's data or credentials (§3). 0009's note was written on
  2026-09-24 (above), and its table row remains. They touch only 0008, 0009 and 0026. If the other
  session is not idle before the first invitation, they go ahead as their own small pull request.

**After the first invitation**, during or after the alpha: T1, T2, T3 (b), T4 and T5. A tester
never reads `docs/workplans/`. 0026 row 24 is in T3 (b), not (a): since 0132 D7 the testers use
`ownpace-live`, which never had the demo's values, and row 24 stays parked for the OTA stack only
(0132 T5).

| Task | Status | Notes |
|---|---|---|
| T1 The index table is generated from each plan's own first line, Status heading and task table | 🔨 **Built 2026-09-24**, with the one-line summaries (D5); not merged — *was:* 📋 Proposed | §3. `scripts/workplan-index.mjs --write` / `--check`, a generated region in `docs/workplans/README.md`, and the check in CI's `docs-hygiene` job. A plan the rules cannot read is listed as such, never guessed. **After.** |
| T2 The hand-written sections stay, under a heading that says they are history | 🔨 **Built 2026-09-24**, with T1; not merged — *was:* 📋 Proposed | §3. Text unchanged. One dated note names the rows known to be wrong and says where the current order is kept (0131 T5). **After.** |
| T3 The stale Status blocks, corrected as dated notes, in one pull request | (a) 🔨 **Built 2026-09-24**, with T1; not merged. (b) 📋 **Proposed** | §3. (a) 0009, 0008 T7 and 0026 row 14: **before the first invitation**. (b) 0026 row 24 and 19 more plans: **after**, when the session writing the alpha's plans is idle. |
| T4 The numbers 0048, 0049 and 0050, explained in the index | 🔨 **Built 2026-09-24**, with T1: the full history confirms no file was ever added; not merged — *was:* 📋 Proposed | §3. They were used in PR #416's description and in code comments, and no file was written, as far as GitHub's API shows. A full-history `git log` confirms it first, because both local clones are shallow. **After.** |
| T5 How a plan gets its number, written down | 🔨 **Built 2026-09-24**, with T1 (the README's `## Numbering`); the owner still confirms the rule (open question 5) — *was:* 📋 Proposed | §3. The next free number when the file is created, in creation order. T1's check refuses a duplicate number. **After.** |

## 1. What there is today

### The index

`docs/workplans/README.md` is the same file on `main` (`987cb06`) and at this checkout. What
follows is read from it.

- **It is dated 2026-08-03.** Its table heading is *"## State of the stack (verified against
  code, 2026-08-03, `main` post-#271)"* (:12).
- **It stops at 0039.** The table has 39 rows, for 0001 to 0039 (:24-62). The highest plan
  number anywhere in the file is 0039. `main` holds 128 plan files, so 0040 to 0047 and 0051 to
  0130, 88 plans, have no row and no mention. The alpha's plans, 0131 onward, have none either.
- **Its rows are out of number order.** 0024 comes before 0023 (:45-46), and 0025, 0026 and 0022
  come after 0039 (:60-62).
- **Eight rows contradict the plan they describe.** The review listed them, and each was
  re-checked here against the plan:
  - 0008 (:31) calls the harness *"all present"* and the soak *"not verifiable from the repo"*.
    The O365 workflow has never completed a run (T3, 0008).
  - 0009 (:32) says *"**Nothing open in this plan.**"* and lists T1 to T6, while 0009 has T7 to
    T12 and an owner decision in its section headed T9, open until 2026-09-24 (T3, 0009).
  - 0013 (:36) says *"T1–T8 all done"*. 0013 has a T9 row, *"✅ **Done 2026-09-22**"* (0013:15).
  - 0025 (:60) says *"The one open item in this plan is **T6**"*. 0025:11 has T5 at 🟡.
  - 0026 (:61) says *"COMPLETE 2026-08-09 — all 25 T3 rows decided"*, and later in the same cell
    *"**Rows 7–8 … and 10–25 await the owner.**"*
  - 0029 (:49) leaves out T5, the Google half (0029:8, *"✅ **Done 2026-08-16**"*).
  - 0030 (:50) says the fourth event was wired on 2026-08-04, and also that *"**`decision_raised`
    stays unwired**"*.
  - 0031 (:51) says *"only the per-domain picker is open"*. 0031:9-10 have T2 and T3 at 🟡.
- **Its order section is over.** Under *"## Recommended order (from here)"* (:127), the list
  *"What is left, in the order it matters"* (:139) has every item struck through and marked done
  except item 1, *"Run the consent runbook"* (:141). That item is 0027 T0's consent run, which
  now sits in 0141 T10, with the owner, after the first invitation. The older list under
  *"### Earlier the same day"* (:169) is not struck through, and several of its items have been
  overtaken since. It numbers two items "5." (:195 and :207).

**The index says what goes wrong with it.** Item 2 of its own order says: *"This line outlived
the event by five days and on 2026-08-09 cost the owner a "didn't we already do this?" — the
exact failure mode this index warns about in its own header."* It ends: *"The index is the
summary, not the source; read the plan's own status block before acting on a row here."*
(:146-152). Item 4 says: *"Third time this list has outlived its subject — the same failure
mode items 2 and 3 above record"* (:162-163). The first of the earlier list's two items numbered
"5." says: *"stale action items in this file are not free."* (:201).

The root `README.md` sends readers here for known gaps: *"**Known gaps** (tracked in
[`docs/workplans/README.md`]…)"* (:124).

### Two indexes that already write themselves

- **`docs/LESSONS.md`**, from the guards in `scripts/`. `scripts/lessons.mjs` has `--write` and
  `--check`. Its header says why: *"a hand-written second list of what the guards cover is the
  thing it exists to replace."* `scripts/lessons.unit.test.ts` runs the real generator in
  `--check` mode, *"rather than a reimplementation here: a reimplementation could drift from
  the generator, which would guard nothing."*
- **`docs/adr/OPERATIVE.md`**, from each ADR's `## Operative rules` section.
  `scripts/adr-operative.mjs` works the same way. It is *"Deliberately dumb: number order,
  verbatim section content (comments stripped), no summarising, no filtering."* It throws
  rather than leave an ADR out: *"a missing or empty section is exactly the drift this tool
  exists to make loud."*
- **ADR-0038** made the second one. Its operative rules already cover workplans: *"Workplans
  follow the same interface rule going forward: the **Status block is the workplan's
  interface**; nobody should need the narrative to learn what was proved."*
- **CI runs both checks on every pull request.** The `docs-hygiene` job in
  `.github/workflows/ci.yml` has a step, *"Generated docs match the tree that generates them"*,
  that runs `node scripts/lessons.mjs --check` and `node scripts/adr-operative.mjs --check`
  (:379-382). Its comment says why they are here and not only in the unit tests: the
  `unit-tests` job is skipped for a docs-only change, and *"A PR that FIXES one of these files is
  docs-only by nature"* (:357-378). It also says: *"Neither is ever hand-merged or
  hand-edited."* (:376).

### A constraint: a test that reads workplans costs every prose commit

`detect-changes` in `ci.yml` skips the test suite when a change touches only documents it does
not select. `scripts/a-doc-a-test-reads-that-ci-skipped.unit.test.ts` finds every document a test
reads and requires the filter to select it. Its control assertion requires the opposite for
workplans: *"the filter now selects workplans, so every prose commit runs the whole suite for no
assertion. The rule is meant to be narrow: a doc a TEST reads, and nothing else."* It checks this
on `0115`. So a unit test that read the real plans would either break that control or be the
hole the guard exists to close. T1 therefore puts the drift check in `docs-hygiene`, and its unit
test reads only fixtures (§3).

### What a generator can read in the plans

This was surveyed with a throwaway script that is not part of the repository. The counts are
for the 128 plan files on `main`, which are the same at this checkout. The alpha's plans, 0131
to 0147, were still being revised on 2026-09-24, so their counts are not fixed yet. All
seventeen use the standard first line, a dated Status heading and a task table in their Status
block.

- **The first line.** 113 of the 128 open with `# Workplan NNNN — Title`. Ten open with `# NNNN
  — Title` (0094 to 0102, and 0115). Three use a colon (`# Workplan 0003: …`, and the same in 0004
  and 0012). 0005 has neither (`# Workplan 0005 Implementation Summary`). `0001-start-prompt.md`
  is the historical start prompt, not a plan. In every file whose first line starts with a plan
  number, it is the number in the file name. Three first lines also name an ADR by its
  four-digit number (0023, 0024 and 0053, for example *"(ADR-0013, kept and being built)"*), so
  only the leading number can be compared with the file name.
- **The title can change after the file is named.** For example,
  `0119-what-runs-and-what-moves-it.md` is titled *"What runs, what is current, and what moves
  it"*. The index should show the first line, not the file name.
- **The Status heading.** 121 files have `## Status — YYYY-MM-DD`, and all but three of those
  (0018, 0022 and 0115) add *"(update this block at the end of every session)"*. Five have
  another form: `## Status` (0002),
  `## Status: SUPERSEDED …` (0003, 0005), `## Status: COMPLETED` (0012), and `## Status — all
  done (rows corrected 2026-08-01; …` (0006), whose date is a correction date, not the block's.
  Two have no Status heading: `0001-start-prompt.md`, and 0004, which has `**Status**:` in bold.
- **The task table.** 120 files have a table between the Status heading and the next `## `
  heading whose header names a task and a status: `| Task | Status | Evidence |`,
  `| Task | Status | Notes |`, `| Task | State | Notes |` (0114) or `| Item | Status | … |` (0006).
  The other eight do not. Six are the early files above other than 0006: `0001-start-prompt.md`,
  0002, 0003, 0004, 0005 and 0012. 0115 and 0120 have their task tables under a later `## Tasks`
  heading, outside the Status block, and 0115's has no status column.
- **The markers.** The 120 tables have 697 rows. Counted by the first marker in the status cell:
  ✅ 579, 📋 31, 🟡 25, ⚠️ 11, 🟢 10, ⛔ 10, ⬜ 9, ⏸️ 5, ⏳ 3, 🔨 3, and 📝, 🚧, 🕓 and 🔎 once
  each. Seven rows have no marker. All seven are in 0001, whose cells say *"**Done**"* in words.
  The alpha's plans add about 150 rows, most of them 📋 and ⏳, and one marker `main` does not
  use yet: 🅿️. Several cells mark parts, for example 0108 T8 *"(a) ✅ **Built 2026-09-23** …"*,
  so the marker is not always the cell's first character.
- **⚠️ in a plan's task cell never means superseded.** It means part done or recorded: 0066 T3 *"⚠️
  **Half right, and corrected 2026-08-17**"*, 0078 T2 *"⚠️ **Recorded, because it is the case
  that …**"*, and 0054, 0061 to 0065, 0068 and 0069, which read *"⚠️ **(a) done since; (b)
  stands**"* and similar. A superseded plan is marked by the banner the README's policy names
  (:8-10), a line `> ⚠️ **SUPERSEDED by [workplan NNNN](…)**` under the title, before the first
  `## ` heading. 0003, 0004 and 0005 carry it. 0112 says it is superseded only in its Status
  paragraph (0112:5-14).

### The numbers 0048, 0049 and 0050

- **No file has these numbers.** `docs/workplans/` goes from `0047-completion-report.md` to
  `0051-shared-folder-roots.md`, at this checkout and in GitHub's listing of the directory at
  `e9e14fc1` (2026-08-17).
- **Code cites them.** For example, *"(workplan 0048), one writer for both editions"*
  (`apps/worker/src/jobs/run-delta-sync.ts`:90), *"The shared drives a Google credential can see
  (workplan 0049)"* (`apps/api/src/routes/migrations/index.ts`:1617), and *"Since workplan 0050"*
  (`packages/shared/src/config.ts`:594). `docs/feature-matrix.md`:319 says *"(browsable since
  workplan 0049)"*, and `packages/ledger/migrations/0017_mapping_throttle_config.sql`:1 names
  *"workplan 0050's noted gap"*.
- **Where they come from.** PR #416, merged 2026-08-16, is titled *"Digest narrates auto-apply;
  completion report on Finish; shared-drive browse; DAV throttle caps"*. Its description numbers
  four follow-ups: *"(workplan 0048)"* for the digest, *"(workplan 0047)"* for the completion
  report, *"(workplan 0049)"* for the shared-drive browse and *"(workplan 0050)"* for the
  throttle caps. The PR changed 38 files and none of them is under `docs/workplans/`. GitHub
  lists 94 commits that touched `docs/workplans/` from 2026-08-14 to 2026-08-18. None of their
  subjects names 0048, 0049 or 0050. Three name 0049 or 0050 in the message body, as the PR's
  numbers (`824badf6`, `12024934` and `f95e9917`), and none of those three adds or removes a file
  with one of these numbers.
- **What could not be checked here.** Both local clones are shallow
  (`git rev-parse --is-shallow-repository` answers `true`), so `git log` cannot show whether a
  file with one of these numbers was ever added and then removed. The review took the same view:
  *"no deletion can be shown"*. So the likely story is that the numbers were given in the PR's
  text and no file was ever written. T4 confirms that before the index says it.
- **The README's policy** is *"**Policy: workplans are never deleted.**"* (:8). Nothing found here
  contradicts it.

### Status blocks that say something is settled when it is not

The review's findings `wp-self-contradicting-status-blocks`, `wp-0009-pass-without-hash`,
`wp-0008-o365-e2e-never-run`, `wp-0026-row24-demo-secrets`, `wp-0026-row14-superseded-by-0114`
and a few smaller ones name 22 plans between them. Each was re-read at this checkout. T3 lists
every one, with the evidence and the note to add. Three facts are worth having here:

- 0009's Status block says *"**Nothing open in this plan.**"* (0009:17), under a Status
  heading dated 2026-09-20. A section added on 2026-09-21, *"## T9: a PASS that hashed nothing —
  the owner's call"* (0009:81), was an open decision until the owner answered it on 2026-09-24
  (0149 D2); a dated note at the top of 0009's Status block now says so. It reuses the number of
  the table's T9, *"A second press that failed a ready cutover"*, which is done (0009:32).
- 0008 T7 is *"✅ Done"* (0008:13). Its acceptance is *"documented green run linked in this Status
  block"* (0008:114). GitHub lists two runs of `e2e-o365.yml`. Both were dispatched on 2026-09-06
  and both ended `cancelled`.
- 0022 T2 says *"tick/manual races serialize instead of overlapping"* (0022:9). It was not true
  for a manual sync until #1137 (merged 2026-09-24). The route now sets
  `concurrencyKey: mappingId` (`apps/api/src/routes/migrations/index.ts`:2857).

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words and the answer as given, typos included.

**D1 — which further plans are written.** *The review found more than the alpha's ten plans
cover, listed as W11 to W19: which should be written up as plans, and which only explained?* —
*"W11 write, W12 write, W13 write, W14 write, W15 explaoin, W16 write, W17 write, W18 explain,
W19 write"*. ("explaoin" is read as "explain".) W19 is this plan. W15 and W18 were explained.
Later the same day the owner answered both, and they became 0148 and 0149 (0131 §5).

**D2 — the repository is what a developer works from.** *If the current stack is reused, its
demo secrets must be rotated* — *"Who would need/het credentials? I aupporrthe test. No one will
be added to NetBird network. Devs need to setup own private test/dev environments. GitHub PRs and
git is the bridge."* ("het" is read as "get", and "aupporrthe" as "support the".) The answer is
about credentials. It bears on this plan through its last two sentences. A developer does not
get the owner's machine. They get the repository, and the plans in it are how they learn what
is done and what is open. An index that is wrong about that is wrong on the bridge.

**D3 — how the alpha's plans took their numbers.** The plans opened on 2026-09-24 took the next
free number each, in the order they were created. 0131 §5 records it this way: *"The seven the
owner said "write" to were opened the same day, each under the next free number. The two the
owner asked to have explained were explained and are not planned yet; each gets the next free
number when the owner chooses it."* No answer of the owner's about numbering is on record in
the owner's own words, so this is how it was done, not a rule the owner stated. That sentence of
0131 §5 is quoted as it read then. W15 and W18 took the next free numbers, 0148 and 0149, when the
owner answered them later the same day. T5 proposes the same rule for every plan, and open
question 5 asks the owner to confirm it.

**D4 — who reads these plans before the alpha starts.** *What may a member and a viewer do, and
should only owners and admins invite?* — *"I am the gate for letting people in the test."* On the
test itself: *"Free and invite only. 10 to 20 people max. Dutch."* So the owner, and no tester,
reads these Status blocks when deciding whether the first invitation goes out (0131 T5). That is
why T3 (a) is the only minimum. It corrects the three blocks that now tell the owner something is
settled when it is not.

**D5 — the index says what each plan is about, and is built now.** *The index is out of date:
build it now, and should it say more than the counts?* — *"also, i see that the "Workplans — index
& sequencing" is outdated and doenst contain the small summaries of recent workplans, while it
was supose to speed up the agents."* So T1 is built before the first invitation, and each plan
carries one sentence under its title that the table shows. The sentence says what the plan is
about, never how far it is, so it does not go stale when the work moves; the markers and the
date say how far. `--check` fails a plan without one, so a new plan cannot arrive without it.

## 3. What each task does

### T1 — the index table is generated (proposed; after)

**The script.** `scripts/workplan-index.mjs` follows `adr-operative.mjs`: `--write` rewrites the
generated region of `docs/workplans/README.md`, `--check` exits 1 and names the regenerate command
when the region differs from a fresh assembly, and the pure functions are exported for the test
(`planFiles`, `readPlan`, `assemble`). It is plain Node with no dependencies, so `docs-hygiene`
can run it without an install, as it runs the other two.

**Why a region in the README and not a file of its own.** GitHub shows `README.md` under the
directory listing, and the root `README.md` and `docs/design/0011a-ground-truth-report.md` link to
it. A second file would be one more thing a reader has to find. The region is marked:

```
<!-- BEGIN GENERATED by scripts/workplan-index.mjs — DO NOT EDIT BY HAND. -->
<!-- Edit the plan's own first line or Status block, then run: -->
<!--   node scripts/workplan-index.mjs --write -->
…
<!-- END GENERATED by scripts/workplan-index.mjs -->
```

`--write` replaces only what is between the two lines. `--check` compares only that, and fails
if either line is missing. Open question 1 asks whether a separate file is preferred.

**What it reads.** Each rule below is a fixture case in the test.

1. **The files.** Every `NNNN-*.md` in `docs/workplans/`, not `README.md`. The number comes from
   the file name. Rows are in number order, then file-name order.
2. **The title.** The first line without `# `, and without a leading `Workplan NNNN` or `NNNN`
   and the `—` or `:` after it. A first line of another shape is shown as written (after `# `).
   A `|` is escaped.
3. **A heading that names another plan.** If the first line's leading plan number (after
   `# Workplan ` or `# `) is not the file's own, the script throws and names the file: that is a
   sibling's heading copied and not changed. None does today. A four-digit number later in the
   line is not read, because three first lines name an ADR that way (0023, 0024, 0053; §1).
4. **The Status date.** From the first line that starts `## Status`. Only `## Status —
   YYYY-MM-DD` gives a date. Any other form is shown as *"undated Status heading"*, and no
   heading at all as *"no Status block"*. A date found elsewhere in the line is never used
   (0006's is a correction date).
5. **Superseded.** A line `> ⚠️ **SUPERSEDED by [workplan NNNN]` before the first `## ` heading
   gives *"superseded by NNNN"*. A ⚠️ inside a task cell is never read as superseded (§1).
6. **The task table.** The first table between the Status heading and the next `## ` heading
   whose header row has a cell `Task` or `Item` and a cell `Status` or `State`. If there is
   none, the row says *"no task table in the Status block"* and has no counts. A table under a
   later heading is not read, because ADR-0038 makes the Status block the interface. 0115 and
   0120 show up this way (open question 4).
7. **The marker of a row.** The first symbol in the status cell that is in the vocabulary: ✅ 🟢 🟡
   📋 ⏳ ⬜ 🔨 🚧 ⛔ ⚠️ ⏸️ 🅿️ 🕓 📝 🔎, the set in use today (§1). A cell with none counts as
   *unmarked*, and the row says how many. The words in a cell are never read. A new marker is one
   entry added to the vocabulary, in the pull request that first uses it.
8. **Numbers.** Two files with the same number make the script throw, unless the number is in
   `SHARED_NUMBERS` with its reason. That holds only `0001` today: *"`0001-start-prompt.md` is
   the historical start prompt, not a plan"*. A number below the highest that has no file gets a
   row of its own, *"no file"*, with the reason from `KNOWN_GAPS` when the number is listed there
   (T4). An unlisted gap is *"no file on this branch"*, and **it is not a failure**. Plans are
   numbered when their file is created and merged in any order. 0141 to 0147 were written in
   parallel on 2026-09-24; any one of them merged on its own would have left a gap until the
   others landed.

**What it writes.** One line above the table, with counts only: how many plans, and how many rows
under each marker. Then a table:

| Plan | Title | Status as of | Rows | Markers | Note |
|---|---|---|---|---|---|
| [0003](./0003-caldav-carddav-webdav.md) | Calendar, Contacts & Files (CalDAV, CardDAV, WebDAV) | — | — | — | undated Status heading · superseded by 0007 · no task table in the Status block |
| [0009](./0009-cutover-integration.md) | Cutover made real: verification gate, DNS, rollback — integrated & tested | 2026-09-20 | 12 | ✅ 11 · ⏸️ 1 | |

(These two rows are what the rules above give today. After T3, 0009 has a thirteenth row, 📋,
decided on 2026-09-24 and carried by 0149 T4.)

**Deliberately dumb, as `adr-operative.mjs` is.** The index does not say what a marker means for a
given plan, and it does not decide whether a plan is open or done, what depends on what, or what
comes next. The plans mostly use ✅ for done, 🟡 for partly done, ⏳ for waiting on the owner,
and 📋 or ⬜ for decided, proposed or planned; the alpha's plans add 🅿️ for parked with a
trigger. The legend above the table says that, and says that the plan's own row wins.

**The files T1 changes.**

- `scripts/workplan-index.mjs` (new).
- `docs/workplans/README.md`: the region, and T2's headings.
- `.github/workflows/ci.yml`: `node scripts/workplan-index.mjs --check` joins the two lines in the
  *"Generated docs match the tree that generates them"* step of `docs-hygiene`, and the comment's
  regenerate list gains its `--write`.
- `package.json`: `"workplans:index": "node scripts/workplan-index.mjs --write"`, beside
  `adr:operative`.
- `AGENTS.md`: *"Regenerating the two indexes"* becomes three. Session protocol step 5, *"End:
  update the workplan Status block …"*, gains *"then `node scripts/workplan-index.mjs
  --write`"*.
- `docs/README.md`: the `workplans/` entry says that the README's table is generated from the
  Status blocks.
- `docs/LESSONS.md`, regenerated with `node scripts/lessons.mjs --write` for the new guard.

**Two pull requests that each regenerate the table can conflict**, because rows for neighbouring
plans sit on neighbouring lines. The conflict is resolved by regenerating on the merged tree,
never by hand, as `ci.yml` already says of the other two.

**Guard.** `scripts/workplan-index.unit.test.ts`. It fails today, because the script does not
exist. It works on fixture directories under the system's temporary directory, never on
`docs/workplans/`, for the reason in §1:

- a plan with the standard first line, Status heading and table gives its number, title, date,
  row count and markers;
- `# NNNN — Title`, `# Workplan NNNN: Title` and `# Workplan NNNN Title` give the same title as
  the standard form;
- a first line whose leading plan number is not the file's throws, and names the file; a first
  line that also names an ADR's number, as 0023's does, does not;
- `## Status` with no date gives *"undated Status heading"*, and no Status heading gives *"no
  Status block"*, with no counts in either;
- a task table under a later `## Tasks` heading gives *"no task table in the Status block"*;
- a cell *"(a) ✅ … (b) 📋 …"* counts as ✅, a cell *"**Done**"* counts as unmarked, and a cell
  *"⚠️ **Half right**"* counts as ⚠️ and does not make the plan superseded;
- the SUPERSEDED banner under the title gives *"superseded by NNNN"*, also in a file with no
  Status heading (as 0004 is);
- two files with the same number throw, unless the number is in `SHARED_NUMBERS`;
- a missing number gives a *"no file"* row, with the `KNOWN_GAPS` reason when it has one, and
  does not throw;
- `--check` on a README whose region was edited by hand exits 1, and so does a README with no
  region;
- `.github/workflows/ci.yml`'s `docs-hygiene` job runs `workplan-index.mjs --check`. It reads a
  workflow file, not a document.

Its header opens with the sentence `lessons.mjs` needs: by 2026-09-24, seven weeks after the
index was last verified, 88 plans had no row in it, and it had warned three times that this
would happen.

### T2 — the hand-written sections stay, as history (proposed; with T1)

`docs/workplans/README.md` after T1 and T2, from the top:

1. The title, the ground rules and the policy paragraph, as they are (:1-10).
2. A short paragraph written by hand. It says the table below is generated from each plan's own
   first line, Status heading and task table, and counts what the plans say without judging it.
   It names the command. It says the index holds no order of work, and that for the alpha the
   order is 0131 T5, *"go/no-go before the first invitation"*, and the minimum list at the top of
   each alpha plan.
3. `## Index`, with T1's region.
4. `## Numbering`, from T4 and T5. Written by hand; it changes only when a rule does.
5. `## History: the hand-written index, last verified 2026-08-03`. It opens with one dated note:

   > **2026-MM-DD (0147 T2): kept as written.** From here on the table above is the index. The
   > sections below were written by hand between 2026-07-27 and 2026-08-13. On 2026-09-24 eight of
   > their rows contradicted the plans they describe: 0008, 0009, 0013, 0025, 0026, 0029, 0030
   > and 0031 (0147 §1). Their *"Recommended order (from here)"* is not the current order. The
   > one item of its *"What is left"* list that is not struck through, the consent runbook, is
   > 0027 T0's consent run, now in 0141 T10.

   Below the note come today's sections, *"State of the stack …"*, *"What landed this cycle"*,
   *"Recommended order (from here)"* and *"Earlier note (2026-07-27)"*. Each heading goes down one
   level so that they sit under the history heading. Not a word of their text changes. That
   includes the two items numbered "5.", which is how they were written.

**The pointer in the root README.** `README.md`:124 says known gaps are *"tracked in
`docs/workplans/README.md`"*. After T1 the index counts markers and lists no gaps. The pointer
goes to where gaps are listed, *"## The open gaps, in one place"* in `docs/feature-matrix.md`
(:390), and to 0144 T2's known-limitations page once that exists.

**No guard of its own.** The history is prose, and the drift check covers only the generated
region. The test that checks the region is still there (T1) fails if T2's move takes the markers
out.

### T3 — the stale Status blocks, corrected as dated notes (proposed; one pull request)

**How a correction is written.** Nothing already written is reworded or removed. Each correction
is added to the plan's Status block, directly under its first paragraph, in this form:

> **2026-MM-DD, index pass (0147 T3):** what the block says, and since when it has not been true,
> with evidence at `file:line`. Where the open work is carried now.

Where a task row's marker is wrong, the correct marker goes at the front of its status cell and
the old text stays after it, for example `🟡 **Corrected 2026-MM-DD (0147 T3): …** — *was:* ✅
Done`. T1 reads the first marker, so the index follows the correction. There is one exception to
"add to the Status block": the policy's SUPERSEDED banner goes directly under the title (0012,
0112), because that is where 0003 to 0005 carry it and where T1 reads it.

**Before the pull request.** Each item is re-read on the day it lands, and line numbers are
re-taken. An item the other session has already corrected is dropped. The line numbers below are
those of 2026-09-24. If T1 has landed, the same pull request runs `--write`.

**(a) Before the first invitation.**

| Plan | What the plan says | What is true (checked 2026-09-24) | The note |
|---|---|---|---|
| 0009 | *"**Nothing open in this plan.**"* (:17). The table's T9 is *"A second press that failed a ready cutover"*, ✅ (:32). | The section *"## T9: a PASS that hashed nothing — the owner's call"* (:81) was open until 2026-09-24, when the owner decided it (0149 D2). It says the gate *"returns **PASS**"* when nothing could be hashed. The code is as it describes: `checksumComparable > 0 ? … : 1` (`packages/core/src/verification.ts`:432), and a test pins it, *"opens the cutover gate on count parity alone when NOTHING could be hashed — the owner's call"* (`packages/core/src/verification-bytes-and-checksums.unit.test.ts`:194). | *"Nothing open"* stopped being true on 2026-09-21. **The note is written** (2026-09-24, the top of 0009's Status block): the section headed T9, which is not the table's T9, was answered on 2026-09-21 in the code only and on 2026-09-24 by the owner, and 0149 T4 carries the second answer. What remains is a new row, `T13 A PASS that hashed nothing (the section headed "T9")`, at 📋 **Decided 2026-09-24**, pointing at 0149 T4. 0149 T4's PR also records both decisions in 0009; whichever lands first adds the row, not both. |
| 0008 T7 | *"✅ Done"* (:13). | The acceptance is *"documented green run linked in this Status block (timestamps showing >1 token lifetime)"* (:114), and the DoD asks for *"≥24 h unattended"* (:29). No run is linked. GitHub lists two runs of `e2e-o365.yml`: 34019235750 and 34019786577, both dispatched on 2026-09-06, both `cancelled`. Without its secrets the suite skips (`e2e-o365.yml`:12). | `🟡 **Corrected: harness built, acceptance not met** — *was:* ✅ Done`. The lane is 0141 T13, and the Microsoft 365 account's live pass is 0141 T2. 0141 T13 (b) leaves this correction to this note. |
| 0026 row 14 | *"per-customer app registration is the model (owner), and that makes publisher verification MOOT … under this model no tenant ever is"* (:106). | Since 0114 the managed stack carries *"The deployment's own MICROSOFT app registration (workplan 0114)"* (`deploy/compose/managed.env.example`:729), and an empty `MICROSOFT_OAUTH_TENANT=` (:751) means `common`. | The premise changed with 0114. The ADR is 0140 T4, and publisher verification is 0140 T5 (⏳ **Owner**). 0140 T4 lists row 14 among the places that must say the same thing. Whichever lands first writes this note, not both. |

**(b) After the first invitation.**

| Plan | What the plan says | What is true (checked 2026-09-24) | The note |
|---|---|---|---|
| 0026 row 24 | *"rotated by re-running `ensure-env-secrets.sh` and restarting the stack"* (:120). | The script says of itself *"values already set in .env are never touched, so re-running it never rotates anything"* (`deploy/compose/ensure-env-secrets.sh`:9-10). Since 0132 D7 the testers use `ownpace-live`, which never had the demo's values, and row 24 stays parked for the OTA stack only (0132 T5). | The procedure written in row 24 does not rotate. The note points at 0132 T5 and the routes 0132 §3 keeps for the day row 24's trigger fires. The row's decision is not touched. |
| 0022 T2 | *"`run-delta-sync` gains a concurrency-1 `delta-sync` queue, so tick/manual races serialize instead of overlapping"* (:9). | The tick and `/start` set `concurrencyKey`. The manual route did not until #1137 (`f9d3d1d`, merged 2026-09-24), which sets it (`apps/api/src/routes/migrations/index.ts`:2857) and adds a route test. | Before #1137 the sentence held for the tick and `/start`, not for the manual sync. It holds for the manual sync since #1137. The row stays ✅. |
| 0086 | *"**Nothing here is built.**"* (:5). T1 to T4, T6 and T7 are ⬜ **Planned**. | T1's public pages became the separate `site/` (0091 T2, *"✅ **Done 2026-08-20**"*). T4, request access, is 0093 T1 to T7 (✅ 2026-08-22, apart from T2c, which the owner deferred). T2's price list is `site/prices.mjs`, which 0088's Status says is *"guarded against ADR-0014's own table by `site/site.unit.test.ts`"*. T5 is 0139's. T6 (Mollie) is not needed for a free alpha (0131 D1). T3's page exists (`site/pages/en/how-it-works.md`). Whether it states the refusals T3 asked for was not read here. | The dated note, and per row: T1 becomes `✅ **in 0091 T2**` and T4 `✅ **in 0093** (its T2c deferred)`, each followed by *was:* and the old cell. T5 stays 🟡 and points at 0139. T6 and T7 stay ⬜. T2 and T3 are read on the day and marked then: T2's price list exists in another shape, and T3's page exists. |
| 0044 T4, 0045 T4 | *"⏳ **Waiting on the owner**"* (:10 in each). Both blocks are dated 2026-08-16. | `docs/feature-matrix.md`:10-14: `gmail`, `google-calendar` and `google-contacts` *"have been run against the owner's real Google account routinely for weeks"*, and are ✅ since 2026-09-22, *"What that evidence does NOT cover is a SECOND account"*. `docs/owner-test-runbook.md` Stages 5 and 6 (:260, :288) record no result. | `✅ **Corrected: run on the owner's own account (feature matrix, 2026-09-22)**`, the old cell kept. The second account is 0141 T6. The runbook stages have no result written in them. |
| 0088 | The header says T4 *"cannot be built as written"* and T6 *"is the owner's to set"* (:12-16). T4's row is 🚧 (:24). | 0109 T4 is *"✅ **Built 2026-08-30**"* (0109:71). T4's own row says *"This work now lives in [0109] T4"* (:24). T6 is *"✅ **Decided 2026-09-20, twice**"* (:26). | Nothing in this plan is open. T4 is `✅ in 0109 T4`, with the old cell kept after it. |
| 0092 T4, T5; 0093 T2 | 0092 T4: *"The build is 0086 T1/T4, owner-gated"*, citing *"`site/build.mjs:412` — the site's only CTA is `mailto:`"* (:13). 0092 T5: *"✅ **Written 2026-08-22, not yet run**"* (:11). 0093 T2: *"(5 cases, **not run** — no docker here)"* (:9). | Request access was built as 0093 T1 to T7, and the sign-in as 0093 T5 to T5c and 0102 T1. `site/build.mjs`:528 says *"It was `mailto:`"*. CI's integration job runs every `*.integration.test.ts` (`vitest.config.ts`:60, `ci.yml`:690). 0093's own T2b records *"CI's first run of `access-requests.integration.test.ts`"* (0093:12). | 0092 T4 was answered and built by 0093 and 0102 T1. "Not yet run" and "not run" were true where they were written, and CI runs these files. The result of a given run is read from CI, not claimed here. |
| 0113 T6 | *"📋 Optional (needs T0 decision 3)"* (:431). | Google Tasks was built in 0126 (T1, *"🟢 **Built 2026-09-23; reachable since T2**"*, 0126:64). `packages/connectors/src/google-tasks-source.ts` exists. | `🟢 **in 0126 T1** — *was:* 📋 Optional`. |
| 0112 | Its Status paragraph says *"superseded in practice by [0116] … row by row"* (:5-14). The rows are left 📋 (:26-32). There is no banner. | As the paragraph says. | The policy's banner, directly under the title: `> ⚠️ **SUPERSEDED by [workplan 0116](./0116-the-data-they-give-the-person-not-us.md)** (2026-09-05)`. Rows untouched. |
| 0082 | *"What is still missing"* (:53) lists *"the tick logging its own duration"* (:56) and *"an integration-tier test for `PgRateBudget` under genuine multi-connection contention"* (:57-59). | The tick logs `ms: Date.now() - startedAt` and warns at 30 s (`apps/worker/src/jobs/managed-sync-tick.ts`:405, :412). The contention test exists: `packages/ledger/src/pg-rate-budget.integration.test.ts`, *"PgRateBudget under real concurrency"*, from 0083 T6 (*"✅ **Fixed 2026-08-18**"*, 0083:12). `pg_stat_statements` is still missing: `managed.yml` loads no `shared_preload_libraries`. | The tick item and the contention test are done (0083 T6). `pg_stat_statements` is 0143 T8, which says the same of the other two. |
| 0119 | §4: *"Whether Dependabot reads `${TRIGGER_IMAGE_TAG:-v4.5.12}`"* (:327). | The default is `v4.5.16` (`deploy/compose/managed.yml`:148, :374). | The question stands with the tag as it is now. The lines about the 4.5.12 → 4.5.16 upgrade (:128, :180) are history and stay. |
| 0085 T6 | *"There is no close UI to put it in yet — 0086 T1 is that front door"* (:35). | 0086 T1 became the public site (above). No page in `apps/web` calls the close route. | The close screen is 0144 T8. |
| 0001 T7 | *"**dependency bundle (ledger/IMAP/JMAP wiring) pending**"* (:14). | The worker CLI runs `runAllDomains` (`apps/worker/src/index.ts`:25, :156). | Wired since 0007 and 0021 T6. |
| 0007 | *"### Remaining Work"* lists *"**Integration Tests (T4)**"* and *"**Documentation Updates (T8)**"* (:77-89). | Both are ✅ in the table (:10, :14). | That list predates the rows, which are ✅. |
| 0012 | *"## Status: COMPLETED"* (:7). The file also says *"Approximately 80+ TypeScript errors remain"* (:69) and *"Not yet committed/pushed to remote"* (:78). There is no banner. | The old index called it *"History doc for the 0009 cutover work (not a forward plan)"* (README:35). | The banner, directly under the title: `> ⚠️ **SUPERSEDED by [workplan 0009](./0009-cutover-integration.md)**`. A summary written before its work merged, kept as history. |
| 0017 | *"## Follow-ups this plan now owns"*: retiring the appliance's `GET /verify`, and deploying the Trigger.dev tasks (:68-100). | Both are closed: *"There is deliberately no synchronous `GET /verify` any more (0019 T6)"* (`apps/selfhost/src/index.ts`:1635), and `apps/worker/trigger.config.ts` exists (0018). | Both follow-ups are closed by 0019 T6 and 0018. |
| 0029 T1 | One cell says *"the wiring that produces a report is the next slice"* and *"**The wiring landed the same day.**"* (:7). | The second is the later fact. | The first sentence is superseded by the second. |
| 0041 | *"**Found while collapsing, deliberately not fixed here.**"* (:49). | Fixed the same day: `STORED_CREDENTIAL_NAMES` (`packages/orchestration/src/mail-source-factory.ts`:96), whose comment says *"Added 2026-08-14"*. | Fixed on 2026-08-14. |
| 0038 | *"## Owner decisions queued by this plan"*: *"T7's hint rewrite (shared-contract wording; owner approves the new sentences)"* (:186-188). | The old index row says *"T7's hint rewording rides the PR — merge is the queued owner approval"* (README:58). Whether the owner regards the merge as the approval is not written anywhere. | The owner answers open question 3, and the note records the answer. |

**What T3 leaves alone.** Plans whose Status is dated long ago but not wrong, for example 0105's
Status of 2026-08-26 while its rows wait on the owner. The index shows the date, and a reader can
see it. Also left alone: 0026's T3 cell, whose *"Rows 10–25 remain parked"* is dated narrative
after the cell's own *"✅ **ALL 25 ROWS DECIDED**"*. And unfinished work the review found that
no Status block misstates (0042, 0103, 0105, 0116 and others). That work is carried by 0141 to
0146, or by the plan itself.

**No guard of its own.** These are prose corrections. T1's index shows the markers they change,
and the review's evidence is cited in each note.

### T4 — the numbers 0048, 0049 and 0050 (proposed; after)

**First, the check that could not be run here.** On a clone with full history:

```
git log --all --full-history --format='%h %ad %s' --date=short -- \
  'docs/workplans/0048-*' 'docs/workplans/0049-*' 'docs/workplans/0050-*'
```

If this prints nothing, no such file ever existed, and the `## Numbering` section of the README
says:

> **0048, 0049 and 0050 have no file.** PR #416 (merged 2026-08-16) used them as workplan numbers
> in its description for three of its four follow-ups: 0048, the digest narrating auto-applied
> relocations; 0049, the shared-drive browse; 0050, the mapping's throttle caps reaching the DAV
> and file sources. (The fourth was 0047's.) No plan file was written, and the PR's description
> is their record. Code comments cite them, for example `apps/worker/src/jobs/run-delta-sync.ts`
> and `packages/shared/src/config.ts`.

If it prints a commit, the section says what that commit did instead. If a file was removed,
this plan does not restore it: that becomes a question for the owner under the README's policy.

**In the script.** `KNOWN_GAPS` holds the three numbers, each with the reason *"PR #416; no file
was written (0147 T4)"*. The index then shows each of them as a *"no file"* row with that reason.

**Not proposed: stub files.** A file created now under 0048 would put a plan created in September
in August's place, which is exactly what T5's rule says a number must not do. Open question 2
asks whether the owner prefers stubs anyway.

**Guard.** Part of T1's test: a missing number that is listed in `KNOWN_GAPS` gets its reason.

### T5 — how a plan gets its number (proposed; after)

The `## Numbering` section of the README says, written by hand:

- **A plan takes the next free number when its file is created** (D3). Numbers follow creation
  order. They do not say a plan's priority, its topic or when it merged. The order of work is
  in the plans (for the alpha, 0131 T5). 0141 to 0147 were numbered this way on 2026-09-24:
  W11, W12, W13, W14, W16, W17 and W19, in the order the owner's answer lists them.
- **A number is taken by a file.** A number given in a pull request's description or a commit
  message, with no file, is not a plan (T4).
- **Two plans opened at the same time can take the same number.** The one that merges second
  renumbers before it merges: its file name, its first line, and every reference in its own
  pull request. T1's check refuses a duplicate number, so this cannot land unnoticed. A gap left
  while another plan is still unmerged is not refused (T1 rule 8).
- **A number is never used twice.** A plan that is abandoned or replaced stays, with the banner
  the policy already names.
- **Proposed: the file name does not change once merged, and the title may.** Links from code and
  other plans use the file name. The index shows the first line.
- **`0001` is shared** by the first plan and the historical start prompt. That is the only shared
  number (T1's `SHARED_NUMBERS`).

**Guard.** Part of T1's test: two files with the same number throw, unless the number is in
`SHARED_NUMBERS`.

## 4. Order

1. **T3 (a)**, before the first invitation. On its own if the session writing the alpha's plans
   is not idle by then; it touches only 0008, 0009 and 0026.
2. **T1, T2, T4 and T5 together**, one pull request, because all four change
   `docs/workplans/README.md`. They can land while that session is still working. From then on
   every pull request that changes a plan's first line or Status block runs `--write`, and
   `docs-hygiene` fails any that does not.
3. **T3 (b)**, one pull request when that session is idle, with `--write` run on it.

## Not in this plan

- **The decision in 0009's section headed T9.** T3 only makes 0009's Status say where it stands.
  The decision belongs to W18, *"removal fails closed"*, which the owner answered on 2026-09-24
  and which is now 0149 (its D2 and T4). W15, *"help a tester can use"*, is now 0148.
- **The ADR register's rows** (`docs/adr/README.md`). The review found drift there as well. The
  register has its own rules (ADR-0038), and this plan does not touch it.
- **Unfinished work that no Status block misstates.** It is carried by 0141 to 0146, or by the
  plan itself.

## Open questions

1. **Where the table lives.** (a) A generated region in `docs/workplans/README.md`, as proposed,
   because GitHub shows the README under the directory listing and two files already link to it.
   (b) A generated file of its own, for example `docs/workplans/INDEX.md`, with the README
   linking to it, which is how `LESSONS.md` and `OPERATIVE.md` are built. (a) is recommended.
2. **0048 to 0050.** (a) A note in the index's `## Numbering` section (T4), as recommended. (b)
   Stub files that point at PR #416. (b) keeps the "every number has a file" shape, at the cost
   of a September file in an August place.
3. **0038's queued hint rewrite.** The old index says the merge of the pull request was the
   owner's approval of the new sentences. Is that how the owner sees it? T3 records the answer.
4. **0115 and 0120.** Their task tables sit outside the Status block, so the index lists them
   with no counts. (a) Leave them as they are, as recommended; the row says why. (b) The next
   session that touches either adds a table to its Status block.
5. **The numbering rule.** 0141 to 0147 took the next free number each, in creation order
   (D3). Is that the rule for every plan from now on, as T5 proposes? If it is, T5's section
   says so as the owner's decision, with the date.

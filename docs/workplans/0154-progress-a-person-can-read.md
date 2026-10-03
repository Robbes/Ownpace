# Workplan 0154 — Progress a person can read, and the proof at the end

> **In one line:** Each move and migration says where it is in one line: a stage in words, how much of what was found has arrived, time left as a range with its reason, and what needs the person. The cutover steps show counts and state, and the report of what arrived becomes a page.

## Status — 2026-10-03 (update this block at the end of every session)

**2026-10-03, night: T3 (b) is built: how long, during the copy, from the last passes.** On a
migration's page, once a pass has reported, in place of the count's estimate: *How long: About 4 to
8 days more, from the last 3 passes.*

- **The rule** (`packages/shared/src/time-while-copying.ts`):
  - **What is left** is the copying data types' totals less what arrived or was left as it was
    (T2). A data type with no total leaves it unknown, and nothing is said, rather than a range of
    part of it.
  - **How fast** is the last five passes' own: the items each copied, and how far apart they
    started, the median gap. Measured that way, the schedule is in the answer without being read.
    A daily migration's passes are a day apart, an hourly one's an hour, on either edition.
  - **The range** is what is left at the best pass's pace to the worst's, so its width is their
    spread, as planned. Under a day it is said in hours, and a range that starts at nothing is
    *up to*.
  - **Three passes first.** Before them it says how many it has: *We will know after three passes;
    1 so far.* A pass that failed, copied nothing or is still running is not a pace.
  - **Slowed down.** Where a copying data type's last error says the provider asked us to slow down
    (`rate_limited`), the sentence names it first: *Slowed by Microsoft 365.* The slowing is
    honoured and already in the pace (hard rule 4).
- **Kept in step has no time left** and says nothing; its line on a person's card says the last
  pass (T1 (b)).
- **Where:** a migration's page, sharing the run history's own read with the panel under it. The
  person's progress page gains it with T8.
- **Proved by:**
  - `a-range-from-the-passes` (shared, 13);
  - the migration page (+5), the first pass's boundary included;
  - the sentence in Dutch (4).

  **Mutations: eight of eight caught.** One slipped through at first: the page's line drawn while
  the first pass was still running, until a case held that boundary.

**2026-10-03, night: T3 (a) is built: how long, before Start, as a range with its reason.**
Under each migration's count on the review screens, and on a migration's page until its first pass
reports: *How long: About 4 to 5 days, because Google lets a mailbox download 2.5 GB a day.*

- **The rule** (`packages/shared/src/time-before-start.ts`):
  - Mail from Gmail that the count measured takes the days Gmail's ceiling takes. The `gmail`
    card reads it, and so does a Google account, whose mail face is that card. So does a plain
    IMAP account pointed at `imap.gmail.com`, where the host is known.
  - A download that needs n days' worth of the ceiling ends on the n-th day, n − 1 days after it
    starts. So the range is *n − 1 to n days*, and one day's worth or less is *within a day*.
  - Anything else says *Depends on the provider; we will know after the first hour* (the owner,
    2026-09-29: *"You, say it."*). No rate is invented, and nothing unmeasured is counted.
  - Files beside Gmail's mail are said apart: *The files: we will know after the first hour.*
- **One ceiling.** The sentence reads the constant the rule divides by,
  `GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY`, in the reader's decimals (*2,5 GB*). The site's calculator
  states its own copy, since its script cannot import the workspace;
  `site/calculator.unit.test.ts` now fails the day the two differ.
- **Where:**
  - Review & confirm and *Start a migration*'s last screen, which draw the same count section.
    It says nothing while the count is still out, when a Gmail mailbox's size is not in yet.
  - The appliance's review page, for a paused migration, from its own count.
  - A migration's page, until a pass has completed. Once one has, the count is not even read:
    the pass's own rate is T3 (b)'s.
- **On the default daily schedule** a pass copies at most 50 minutes a day. Gmail's ceiling still
  binds whenever the mailbox downloads faster than about 0.83 MB/s (2.5 GB in 50 minutes), so the
  range holds there. A slower one ends later than it says, and T3 (b) measures that.
- **Proved by:**
  - `a-range-with-its-reason` (shared, 8);
  - `a-time-before-start` (5, English and Dutch);
  - the migration page (+4, the appliance's included);
  - the appliance's review page (+2);
  - the calculator's guard (+1).

  **Mutations: eight of eight caught.** One slipped through at first: the page drew a count
  cached from before the first pass, until the case seeded one.

**2026-10-03, night: T6 is built: internals out of the way.**

- **The migration's ID** left the spot under its title for a *Details* fold (*Migration ID:*), for a
  support ticket.
- **An item's hash** on the Deletions, Moves and Failures rows folds under *ID*, closed. Its title
  keeps the whole value to copy.
- **The connections line** says the card's name where the account's name was made from it: *From
  Gmail (anna@gmail.com)*, where it read *From gmail · anna@gmail.com (anna@gmail.com)*. A name
  somebody chose stays (*Anna's Soverin*), and a side with no name is its card's, never the kind
  (*Nextcloud*, not *nextcloud*).
- **The run history** says *912 items this pass* and *3 errors*, where it said *Items: 912*.
  *Pass* is the glossary's English, as the panel's own line and a person's lines say it; the
  plan's *round* is its Dutch, *912 items in deze ronde*.
- *Left as they are* got its words in T2.
- **Proved by:** the migration page (+2), the run history (+1) and Deletions (+1). **Mutations: seven
  of seven caught.** Walked in Chromium, English and Dutch, at 900 and 390 pixels. No page or
  console errors, and no sideways scroll.

**2026-10-03, night: T4 is built: a migration's page lists its steps as a person's page does.**
The seven cards on a migration's page are one numbered list. It is the list a person's page
draws, now one component (`CutoverSteps`), so the two cannot order, name or count a step two
ways. Each row has its count, its state in words and the step's own line, and its name opens the
step's page.

- **The check says what it last did** (`cutover-steps.ts`, from the progress read of T1 (b)):
  *Not run yet*, *Running now*, *Could not run yesterday*, *Did not pass yesterday*, *Passed 2
  days ago*. Until now the person's page could only say *Not passed yet*: its read said *ready to
  finish* only for a migration already in its cutover, so a passed check, a failed one and none
  at all read alike.
  - Of a person's several: how many passed, and *Not run yet* only when none of them ran.
  - A migration in or past its cutover has passed it, with its day where the read still has it.
    The appliance holds no report after a restart.
  - A migration the progress read does not list is unread, never *not run* (hard rule 9).
- **Each row rests on its own read.** The queues rest on `GET /api/attention`. The check and
  *Confirmed* rest on the progress read. *Finish* and *Sharing*'s state rest on the migration's
  lifecycle, which on the migration's page is its detail, or the appliance's `/status`.
  - A read that failed says *Could not be read* on the rows that rest on it, and nowhere else.
  - A read still on its way says nothing. The person's page used to say *Could not be read*
    while it loaded.
- **On a phone** the row is two columns, the number and the rest, so a count or a state that
  wraps stays under the step's name.
- *Work them from the top, in this order.* replaces *The screens below are in cutover order*.
  The steps' glossary row now lists the check's words.
- **Proved by:**
  - `cutover-steps.unit.test.ts` (15);
  - the migration page (+8, and the navigation case rewritten);
  - the person page (+4).

  **Mutations: eight of eight caught.** Walked in Chromium, English and Dutch, at 900 and 390
  pixels: the migration page, with failures and a check that did not pass, and with a check that
  passed; and Anna's page. No page or console errors, and no sideways scroll.

**2026-10-03, night: *of about* is *~* (the owner).** *"change the 'of about' into '~'"*, and of
the three forms put to them, *"18,234 of ~19,000"*. The row reads *18,234 of ~19,000* and *3.1 of
~3.4 GB*, in Dutch *18.234 van ~19.000* and *3,1 van ~3,4 GB*: the word *of* stays, so the tilde
reads as *about* and never as a range. The glossary's row says so first.

**2026-10-03, evening: T1 (b) and (d) are built for a person's card and page, and merged in #1422.** Each data type's
line has its own stage and one sentence under it: *18,234 of ~19,000 · last pass 2 minutes
ago*, or *The check passed yesterday*.

- **The progress read** (`GET /api/migrations/progress`; `packages/shared/src/progress.ts`). The
  list carries a lifecycle word and a last sync, and nothing per data type, so every line on a
  card said the migration's stage, and none could say *Ready to switch*. The read gives each data
  type:
  - its pass state, phase and stop, the facts `stageOf` reads;
  - its counts against what discovery found (T2).

  It gives each migration its check: not run, running, could not run, passed or not passed, and
  when. *Passed* is what the Finish page means by it (`canProceedToCutover`).
  - Managed reads them per migration in one tenant transaction, by the readers the migration's own
    page uses, and shares one reading of a verification run with the report route (`runReportOf`).
  - The appliance builds the same rows from its `/status` and its last report
    (`progressFromStatus`). After a restart it holds no report, and says the check was not run.
- **The line's rules** (`apps/web/src/services/stage-line.ts`):
  - *Copying*: how far;
  - *Kept in step* and *Paused*: how far and the last pass;
  - *Ready to switch*: when the check passed;
  - *Switching* and *Done*: how far;
  - *Not started*: nothing, since the stage says it.

  Files lead with their bytes when both sides were measured (*12.4 of ~38.0 GB*), as the
  drawing has them. What the count leaves out is said after it: contacts kept in step read *210
  of ~612 · 402 left as they are*, not a third done. At most twelve words: the least
  important part goes first, the last pass before what was left.
- ***Ready to switch* is never guessed.** It needs the check passed and the failures that block
  Finish counted (`failuresWaiting`, the count the Finish button refuses on). Where they could
  not be counted, the line stays *Kept in step* (hard rule 9).
- **A person's stage is the least advanced of their lines'**, so a data type its owner stopped
  makes the person *Paused*.
- **While the read loads, or where it failed**, the lines say what the list carries, as before.
  Both pages refresh it at the migration page's own rate (`progress-poll.ts`).
- ***Checked 2 minutes ago*, the drawing's words, is not used.** *Pass* (*ronde*) is the
  glossary's word for a round of copying, and *the check* (*de verificatie*) is the menu's.
  The two are kept apart, in the glossary first.
- **(c) was built by 0153 T3 (c)**: *Needs you: 3* on the card counts failures, deletions,
  moves and grace periods nobody chose. The organisation's own drift decisions belong to no card
  and are counted beside *Needs you* in the menu.
- **Not yet:**
  - the migration's own page still shows its lifecycle word over T2's strip ((d)'s last place);
  - the person's steps can now tell a check not run from one not passed. The progress read
    carries it, and T4 reads it next.
- **Proved by:**
  - `a-line-for-each-data-type` (shared, 10);
  - `a-line-under-each-stage`, the managed route over a real ledger (7), with its response held to
    the spec;
  - `stage-line.unit.test.ts` (21);
  - the Migrations page (+5) and the person page (+3), managed through the parsed route and the
    appliance through its status and last check;
  - the lines in Dutch (2);
  - the browser UI tests, with the read's fixture.

  **Mutations: eight of eight caught.** One first slipped through: taking every data type's phase
  from its migration passed until a migration in its cutover, with its calendars kept in step,
  joined the route test.

**2026-10-03: T2 is built, and merged in #1420.** Each data type's progress row reads *"18,234 of ~19,000"*,
with a bar and *"3.1 of ~3.4 GB"*, on Review & confirm and on a migration's page, in both
editions.

- **The routes join discovery's counts.** Each `DomainStatusReport` row carries `itemsFound`,
  and `bytesFound` when the source has cheap sizes, through `buildDomainStatusReports`' fourth
  argument:
  - managed's `GET /api/migrations/:id` reads them in the same transaction as the counts, for
    the migration's own data types only, by `/discovery`'s rule (`discoveryForSelection`);
  - the appliance's `/status` reads them as `/discovery` does.

  `foundByDomain` (`packages/shared/src/discovery.ts`) takes discovery's latest count that
  succeeded. A count kept through a later error stands. A first attempt that failed, which
  leaves zeros and an error, is no count. Both fields are absent, never 0, when there is no
  count (hard rule 9). The link's view leaves them out until T8.
- **The row's rules** (`apps/web/src/services/progress-totals.ts`):
  - the total is what discovery found, or more when more arrived since, so the bar never passes
    100% and never says *"101%"*;
  - the bar has two parts: what was copied, then what was left as it was, in the destination's
    colour, because those are in the new system too. A screen reader hears the line, and its
    value in whole percent rounded down;
  - no count from discovery shows *"412 copied · total not known"*, with no bar. A counted zero
    shows *"none found to copy"*;
  - the bytes are one quantity in the total's unit, with Dutch decimals in Dutch (*"3,1 van
    ongeveer 3,4 GB"*). They are left out when either side was not measured, so a row never
    says *"0 of ~3.4 GB"* while mail arrives.
- **What happened to the rest is one line:** *failed*, *retrying* and *left as they are*. *Left
  as they are* says what it means on screen: *"already on the new system, or changed there
  since"*. That is not the plan's *"changed by you in the new system"*: the ledger cannot tell
  the two kinds apart (0124 T2), so the words stay true of both, and the longer reassurance
  stays in the title.
- ***Synced* left the row.** The count is *copied* (*gekopieerd*), as the stage *Copying* says
  it. The words are in the glossary first.
- **Not yet, and next (T1 (b) to (d)):** the line under each stage on a person's card and page,
  *Ready to switch* on the list, and a check not yet run in a person's count. 0153 T3 and T5, and
  this block's entry of 2026-09-29, said those waited on T2; they read T2's totals, and are T1's.
- **Proved by:**
  - `a-count-with-no-total` (shared, 10 cases);
  - `progress-totals.unit.test.ts` (15 cases);
  - `LiveProgress.unit.test.tsx` (+9, English and Dutch);
  - `a-count-of-about-how-many`, the managed route over a real ledger (5 cases);
  - `a-count-of-about-how-many-on-the-appliance`, the real appliance on PGlite;
  - `status.unit.test.ts` (+1).

**2026-09-29, morning: open question 2 is answered.** For a provider with no published ceiling,
the review screen says *"we will know after the first hour"* (T3 (a)), in the owner's words
*"You, say it."*

**2026-09-29, night: T4's person half is built, on 0153 T5's page (#1353).** A
person's page lists the hub's seven steps as one ordered list, each summed across the person's
migrations, with its count and its state in words (*Done*, *Needs you*, *Not yet*). On a
queue's step each migration's link carries that migration's own count (*Anna mail (2)*), so the
person sees which one the work is in. A count that could not be read says so and claims no
state. The rules are `apps/web/src/services/cutover-steps.ts`,
tested case by case. **Not yet:** a migration's own page still shows the seven as cards, and
the Check row cannot tell *not run* from *not passed* until the list carries the check (T2).

**2026-09-28, night: two of the owner's answers (asked by the writing session).**

- **Open question 3, T1 (d): *"One stage per person"*.** A person's card shows one stage: the
  least advanced of their migrations, by `leastAdvancedStage`, as proposed and drawn. Each data
  type's row keeps its own.
- **Open question 1, T7: *"One per person"*.** The first-copy email is a kind in 0030's channel,
  sent once per person when their last migration finishes its first complete pass, naming each
  data type. T7 is decided, and waits for the person's page (0153 T5) like the rest.

**2026-09-28, night: T1 (a), the stages in words, built beside R (0131 §6, R8's split)**,
merged in #1326. Nothing renders them yet: T1 (b) to (d) and the pages that show them (0153
T3, T5) are R's.

- **`stageOf`** (`packages/shared/src/stage.ts`) reads one data type's facts:
  - its phase, from `path-phase.ts` or the migration's status;
  - whether its owner stopped it;
  - its pass state;
  - whether a pass has completed once (`lastSyncedAt`);
  - the check, and the failures that block Finish.

  It answers with §3's seven stages. *Ready to switch* asks `finishTransition`, the Finish
  button's own decision, rather than restating what blocks it. A data type the migration does
  not copy (`skipped`) has no stage, and neither has a phase the table does not know: hard rule
  9, never a guess.
- **`leastAdvancedStage`** gives a person's stage, and a migration's from its data types. A data
  type that has not started does not pull the rest back to *Not started* unless nothing has
  started. That is the drawing's reading (`wf-person-page.svg`): Anna is *Copying* while the
  photos wait for a Takeout export. *Paused* ranks below *Copying*, because a person's line says
  what holds them back. Open question 3 still asks whether a person's card shows a stage at all.
- **The words** are in the glossary's States table first, then `strings.ts` in both languages,
  as the `stage` entity of `StateChip`, with no new colour.
- **Proved by:**
  - `a-stage-for-every-state` (25 cases): every lifecycle word and every pass state is decided,
    each row of §3's table holds, and Finish's refusal keeps a data type at *Kept in step*;
  - the ledger's `every-path-state-has-a-stage` (6 cases), where `PATH_STATES` lives;
  - `a-stage-with-no-word` (3 cases), which holds the chip's stages equal to `STAGES`.

  Four mutations were each caught: no stage for `continuous`, none for a `ready` path, *Ready
  to switch* over a failure that blocks Finish, and a not-started data type pulling a person
  back.

**2026-09-28, evening: all of it before the alpha.** The owner: *"before we start Alpha i want
this fixed/completed."* So T3 (b), T5 and T8 join the minimum, and 0131 T5's row for this plan is
the whole plan.

- **T7 stays the owner's choice.** If the answer is yes, it is built before the alpha too.
- **The words follow 0153 D6.** On screen a person's grouping has no noun: their card and their
  page carry their name. *Move* in this plan is the internal name (ADR-0050).
- **The drawing is `docs/design/0152-0154/wf-person-page.svg`.** Session R builds from it (0153
  §5, 0131 §6 group R8).

Nothing is built.

**2026-09-28: opened with 0152 and 0153 from the owner's request.** The owner
asked for the app to become more intuitive. The audit of `main` at `83eb73e` found the migration
page shows counts without totals, no time left, and seven cutover steps that all look the same
(§1). The owner's four answers of 2026-09-28 are in 0152 §2 and 0153 §2. The one that sets this
plan's order is D2, *"Before the first invitation"*.

It first put what a tester watches in the first week before the first invitation, and the end
of a move after it. The evening's answer puts everything before.

| Task | Status | Notes |
|---|---|---|
| T1 One line that says where a person's migrations are | 🟡 **(a) merged in #1326; (b) and (d) merged in #1422 for a person's card and page; (c) built by 0153 T3 (c); the migration's own page next; before the first invitation** | §3. A stage in plain words, derived from the states the server already reports. One sentence, and what needs the person. On the person's card, their page and each migration. Drawing: `wf-person-page.svg`. |
| T2 Totals: *of about how many* | ✅ **Merged in #1420: *"18,234 of ~19,000"*, a bar and the bytes, on each data type's row in both editions** | §3. Synced counts set against what discovery found, as a share and in bytes. *About*, because the source keeps changing. |
| T3 Time left, as a range with its reason | ✅ **Built: before Start, a range with its reason from Gmail's ceiling, and *we will know after the first hour* for the rest (a); during the copy, a range from the last passes' pace (b)** | §3. (a) Before Start, from the counts and the limits the product already knows (Gmail's 2.5 GB a day). (b) During the copy, from the rate of recent passes. Never a single number, and nothing when it cannot know. |
| T4 The cutover steps with counts and state | ✅ **Built: one list on a migration's page and a person's, each step with its count and state in words, and the check as it last ran** | §3. The seven cards become one ordered list. Each has its count and *done*, *needs you* or *not yet*, summed for the move across its migrations. |
| T5 The report of what arrived, as a page | 📋 **Proposed; before the first invitation** | §3. The completion report is rendered in the app, per migration and per move, and downloadable. The word *Markdown* leaves the button. |
| T6 Internals out of the way | ✅ **Built: the ID and the hashes fold away, the connections line says the card, and the run history says its counts in words** | §3. The UUID, the kinds, the doubled address and the item hashes fold away. *Left as they are* says what it means. |
| T7 An email when the first copy is in | 📋 **Decided by the owner 2026-09-28: one per person; before the first invitation** | §3. A milestone mail, *"Your mail is in your new system and is kept in step until you switch."* It is a new kind for 0030's email-only channel, so the owner decides. |
| T8 The person's own progress page says the same | 📋 **Proposed; before the first invitation** | §3. `/view/:link` shows T1's line, T2's totals and T3's range, in the person's language (0145 T6). |

## 1. What there is today

Read on `main` at `83eb73e` on 2026-09-28.

### Progress

`apps/web/src/components/LiveProgress.tsx` renders, per data type:

- **synced, failed and retrying counts** (`:111-120`);
- ***left as they are*** (`:136-137`, the adopted items). What that means is said only in a
  tooltip;
- **last active** (`:148-159`).

Each count stands alone:

- **No total.** The source totals discovery counted on Review & confirm are not joined in.
- **No share and no time estimate.**
- **No bytes.** They are served (`bytesTransferred`) but not shown to the owner. The migrated
  person's own page does show them (`pages/View.tsx`:288, :341, *"{bytes} moved so far"*).
- **The Dashboard's *Recent Activity*** says *"Running · 912 items"*, which is the current pass
  only.

### The cutover steps

`pages/MappingDetail.tsx`:273-291 shows seven numbered cards:

1. Deletions
2. Moves
3. Failures
4. Sharing
5. Check
6. Confirmed
7. Finish

None carries a count, or whether it is done, waiting or not yet due. The Failures card says
*"These block finishing"*, but not how many there are.

### The report

*"Download the completion report (Markdown)"* (`strings.ts`:514; *"… opleveringsrapport
(Markdown)"* in Dutch, :3076) downloads a `.md` file. `/confirmed` (*"What is confirmed in your
new home"*) lists the verified items and offers the full list.

### Email

The email channel (0030) has these kinds (`packages/shared/src/notifications.ts`:1073-1115):

- `decision_raised`
- `runs_failing`
- `verification_finished`
- `migration_finished`
- `access_requested`, `access_granted`, `access_declined`
- `rollback_finished`

There is none for the moment the first copy is complete and the migration starts keeping in
step.

### What must stay true

- **Hard rule 9.** A number that could not be read says so. It is never a zero or an empty bar.
- **Hard rule 10.** A stage belongs to the state the server reported. No state is made up for the
  screen, and the state table stays `StateChip`'s.
- **The server's words stay verbatim.** Verification findings (`PASS`, `WARN`, `FAIL`) and
  refusals are rendered as given (ADR-0013). The words around them are translated.
- **Progress refreshes without F5.** `scripts/a-live-progress-that-needed-f5` holds this.
- **Email only** (0030). Counts on cards are not a notification centre.
- **Word budgets** (0118).

## 2. The owner's decisions (2026-09-28)

This plan follows 0153's D1: a move is a person's migrations, so its progress is theirs summed.
D2 sets the minimum. No answer was given about progress itself. T7 is the one choice that is the
owner's.

## 3. What each task does

### T1 — one line that says where a person's migrations are (before the first invitation)

(a) **Stages in words.** Each maps to the states the server already reports. None is new:

| Stage (EN / NL) | When |
|---|---|
| *Not started* / *Nog niet gestart* | created, before Start (paused, never run) |
| *Copying* / *Wordt gekopieerd* | the first complete pass has not finished |
| *Kept in step* / *Wordt bijgehouden* | a first complete pass has finished, and passes continue |
| *Paused* / *Gepauzeerd* | paused after starting |
| *Ready to switch* / *Klaar om over te stappen* | the check passed and nothing blocks Finish |
| *Switching* / *Bezig met overstappen* | in cutover, in the grace period (0128) |
| *Done* / *Afgerond* | finished |

**Built** as `stageOf` and `leastAdvancedStage` in `packages/shared/src/stage.ts` (Status,
2026-09-28, night).

The table is a function in `packages/shared`, next to the lifecycle it reads. A test fails when a
lifecycle or phase value has no stage. That is `a-sixth-state-added-to-only-one-list`'s pattern:
the state list and this table cannot drift.

(b) **One sentence under the stage.** It is built from T2 and T3, for example *"18,234 of
~19,000 messages · about 3 hours left · checked 2 minutes ago"*. It stays within 0118's budget of
12 words by dropping parts in a fixed order.

(c) ***Needs you: 3*** when there is anything. The count sums failures that block finishing,
deletions and moves waiting for a decision, and open drift decisions. It links the first one.
A queue that could not be read says *"could not be read"* rather than 0 (hard rule 9, the same
rule as the digest's, SAD §11.2 #4).

(d) **Where it shows:**

- the move's card and page (0153 T3, T5), where a move's stage is its least-advanced
  migration's, with the rows per data type showing each one;
- each migration's page;
- the one line at the top of Migrations that replaces the Dashboard, which goes (0153 D7).

### T2 — totals: *of about how many* (before the first invitation)

- **The progress route joins discovery's counts** with the ledger's synced counts, per data type.
  Discovery's counts are the ones kept for Review & confirm: collections, items and bytes.
- **The row reads *"18,234 of ~19,000"*,** with a bar and bytes: *"3.1 of ~3.4 GB"*.
- ***About*** is literal, and is said with a tilde: *of ~* (*van ~*), the owner's choice of
  2026-10-03. Discovery is a snapshot, and the source keeps changing. When synced
  passes the total, the total grows with it. The bar is never above 100%, and never *"101%"*.
- **When discovery never ran or could not count a type,** the row shows the synced count alone,
  with *"total not known"* (hard rule 9). It never shows *"of 0"*.
- **What happened to the rest, on one line:** *failed*, *retrying* and *left as they are*.
  *Left as they are* gets its meaning in words: *"changed by you in the new system, so we leave
  them"* (0118 folds the longer reason).

### T3 — time left, as a range with its reason (before the first invitation)

(a) **Before Start, on the review screen** (0153 T4's last screen), and on the migration until
its first pass reports:

- **A range from the counts and the limits the product states.**
  - Gmail's IMAP download ceiling of 2.5 GB a day (`site/calculator.mjs` names it, and the
    calculator already turns it into days). The API reads the same constant from
    `packages/shared`, and a guard keeps the two equal.
  - Other providers have no published ceiling. They get *"depends on the provider; we will know
    after the first hour"*. There is no invented rate.
- **The reason is part of the sentence:** *"About 4 to 5 days, because Google lets a mailbox
  download 2.5 GB a day."*

(b) **During the copy, from the recent passes:**

- **The range comes from the bytes and items per hour** of the last passes, taken from the run
  history the migration already keeps. Its width is the spread of those rates. It is shown once
  three passes have reported.
- **When the source is throttling** (a `Retry-After` in the pass), the sentence says so: *"slowed
  by Microsoft; about 1 to 2 days"*. Throttling is honoured (hard rule 4), never worked around.
- ***Kept in step*** has no *time left*. It shows *"checked 2 minutes ago"* instead.

### T4 — the cutover steps with counts and state (before the first invitation)

The seven cards become **one ordered list**, in cutover order. The order is 0034's, and the
numbers stay. Each row shows three things:

- **its count:** *"12 failures"*, *"3 deletions to decide"*, *"check not run yet"*, *"passed
  2 days ago"*;
- **its state:** *Done*, *Needs you* or *Not yet*. It says it in words as well as colour, which
  meets 0145 T2's rule;
- **one line on what the step is,** folded after 0118's budget.

On a move's page (0153 T5) each row sums the move's migrations and opens a list of them. On a
migration's page it is that migration's. The counts come from the same routes the queue pages
read. A count that could not be read shows *"could not be read"*.

### T5 — the report of what arrived, as a page (before the first invitation)

- **A page, `/mappings/:id/report`.** It renders the completion report per migration: what was
  found, what arrived, what could not come and why, and what the check compared. It is written in
  the person's language around the server's findings, which stay verbatim.
- **The move's page links a combined report** for the person, with each migration's section.
- **Download stays available.** The button reads *"Download the report"*. The format is named in
  the file name, not in the label, and the word *Markdown* leaves the button in both languages.
- ***Confirmed*** (`/confirmed`) and the report link each other. One says what is verified, and
  the other what happened.

### T6 — internals out of the way (before the first invitation)

This is the progress half of 0153 T6:

- The UUID under the title (`MappingDetail.tsx`:221) moves to *Details*.
- The raw *"left as they are"* gets its words (T2).
- Item hashes on queue rows fold away.
- *"From gmail · anna@gmail.com (anna@gmail.com)"* becomes *"From Gmail (anna@gmail.com)"*.
- The run history's *Items: 912* reads *"912 items this round"*, with *round* (*ronde*) from the
  glossary's *pass*.

### T7 — an email when the first copy is in (owner's choice)

**Proposed:** a `first_copy_complete` kind in 0030's channel. It is sent once per migration, when
its first complete pass finishes. Proposed wording: *"Your mail is in your new system, and is
kept in step until you switch. Nothing is needed from you."* Both languages, by the same rules
as every template: key parity, and the prose boundary.

**It is the owner's choice because:**

- It adds a kind to a channel whose two rules are:
  - an empty digest is not sent;
  - an announcement is only for something that happened.

  This one passes both.
- It is the moment a family most wants to hear about. It is also one more email per migration, so
  a move of five migrations sends five unless T7 groups them per move. The proposal is one email
  per move, sent when its last first-copy finishes, naming each data type.

### T8 — the person's own progress page says the same (before the first invitation)

`/view/:link` (`pages/View.tsx`) already shows *"{bytes} moved so far"*. It gains:

- T1's stage and line;
- T2's totals;
- T3's range.

It uses the same components, in the person's language (0145 T6). It shows nothing that page does
not show today about the other migrations of the tenant: the link grants one migration's view
(0122).

## 4. Order

**Before the first invitation, in this order:**

1. T1 (a) and the stage table, in `packages/shared`.
2. T2, the route and the row.
3. T1 (b) to (d).
4. T4.
5. T6.
6. T3 (a).

T1 and T4 are built after 0153 T3 and T5, or against today's migration page if those are not yet
merged. Their components take a migration or a move, so they move with 0153 without a rewrite.

7. T3 (b).
8. T5.
9. T8.
10. T7, if the owner says yes.

All of it comes before the first invitation. Session R builds it with 0153, as group R8
(0131 §6).

## Lessons that apply

- **Hard rule 9, the digest's own rule.** *"I found nothing"* and *"I could not look"* never arrive
  as the same count.
- **Hard rule 10.** A stage is read from a state, never computed into one.
- **`a-live-progress-that-needed-f5`.** Totals and ranges refresh with the progress they belong
  to.

## Not in this plan

- **An in-app notification centre, or a push notification.** 0030 decided against both.
- **A throughput benchmark per provider** to make T3 (a) precise for providers with no published
  ceiling. T3 (b) measures instead of guessing.
- **The structure of moves and the flow that creates them.** That is 0153's.

## Open questions

1. **T7.** Does a first-copy email join the channel? If so, once per move, as proposed, or once
   per migration? **Answered 2026-09-28: once per person** (*"One per person"*).
2. **T3 (a).** Should the review screen show the range for providers with no published ceiling as
   *"we will know after the first hour"*, as proposed, or show nothing until then? **Answered
   2026-09-29: say it** (*"You, say it."*).
3. **T1 (d).** A move's stage is its least-advanced migration's, as proposed. Or should the card
   show one stage per data type and no stage for the move? **Answered 2026-09-28: one stage per
   person, the least advanced** (*"One stage per person"*).

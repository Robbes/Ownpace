# Workplan 0113 — A task is not an event

## Status — 2026-09-04 (update this block at the end of every session)

**2026-09-04 (latest): the NINTH fan-out — one writer, two domains, one hard-coded
filing.** Found by the very next run, once the eighth fix let the task lane run at all.
E2E #178's restart-resume gate reported:

```
calendar: itemsSynced 17, bytesTransferred 4913
task:     itemsSynced  8, bytesTransferred 1952
```

against a source holding **nine** events. The appliance's own pass log was right all
along — `calendar sync complete: created=6` then `created=3` — so nothing had been
copied twice. The extra 8 were LEDGER ROWS: on the wire a task is a calendar object, so
`buildCalendarTarget` and `buildTaskTarget` return the same `CalDAVTargetWriter`, and
that class recorded `itemType: 'calendar'` for every object it touched. The sync loop
recorded the same task under `task`. Two rows per task; the calendar domain's count and
bytes carrying the whole task corpus on top of its own; and the writer's
already-migrated fast path looking for a `todo:`-prefixed key in the `calendar` domain,
where it can never be — so it missed every task on every pass and paid a target probe
for each.

T4 made the writer follow the component it is GIVEN. Its ledger bookkeeping still said
calendar, and no test could see it while the task domain never ran. The writer is now
told which domain it files for, as a REQUIRED constructor field — the compiler named all
fifteen construction sites — because an optional key nobody assigns is exactly how the
eighth fan-out happened, one commit earlier. Guard:
`packages/engines/src/a-task-filed-under-the-calendar.unit.test.ts`, proved by breaking
four ways.

Telling the writer its domain moved the double count rather than removing it: the next
run reported `task: itemsSynced 16` for eight tasks. Both rows were now under `task`,
under two different HASHES — the loop's `naturalKeyForTask` (`todo:`) and this writer's
hard-coded `calendarNaturalKeyHash` (`cal:`). `recordIfAbsent` collapses a duplicate only
when the key matches, and it did not. The writer now derives its key through the same
`naturalKeyForCalendar`/`naturalKeyForTask` the two passes hand in as their `naturalKey`,
on the same `item` object, so the pair cannot drift again — RECURRENCE-ID included, which
neither side populates today and both would pick up together on the day one does.

**The domain and the key are one decision.** Whichever of the two a writer gets wrong,
the result is the same: two ledger rows for one object, and a domain reporting twice what
it moved. They are pinned in one file for that reason.

### The TENTH fan-out — the read side, which had it backwards

With the ledger finally right, the verification gate (step 21, its first execution since
run #174) declared all eight tasks lost:

```
tasks: sourceCount 8, targetCount 0, matched 0, missingOnTarget 8, bytes source=1952 target=0
```

on a target that provably held
`calendars/e2e-target/restart-resume-seed-tasks/dav-seed-task-1..8@dev.local.ics`, in a
collection whose `supported-calendar-component-set` says `VTODO` — written there by our
own writer, exactly as T4 intended. **`canProceedToCutover: false` on a migration that had
copied everything.**

`CalDAVTargetWriter.listEventsIn` built its `calendar-query` naming VEVENT, VTODO and
VJOURNAL as SIBLING comp-filters, on the reading that this asks for any of them. RFC 4791
§9.7.1 makes a comp-filter's children a **conjunction**: it asks for a VCALENDAR
containing all three, which is no object anybody has. Sabre's PDO backend — Nextcloud's —
is more forgiving and indexes on the FIRST child, which was VEVENT. So the query worked
for four domains and one entire workplan, and could never have worked for the fifth.

The reindexer now asks for the one component its domain owns. Scoped rather than unioned,
because that is also the right answer for the other half of verification: a calendar
reindexer that listed VTODOs would report every migrated task as "extra on target", and no
domain owns VJOURNAL at all.

**This one was found by diagnostics rather than by inference,** and the difference is
worth recording. Two earlier defects in this list were diagnosed by subtracting byte
totals — 4913 minus 1952 is nine events — which is not a method. The gate's diagnostics
now dump the `item` table by domain and status, and ask the target what it holds the way
the reindexer asks it. One run named a cause that two rounds of arithmetic could not.

**All of these were invisible for the same reason**, and it is worth saying once: a
domain that never runs cannot be wrong in a way anything notices. Every list, type and
branch 0113 added was correct; what was missing was one run.

**2026-09-04: the EIGHTH fan-out — the parser between the config and the reader.**
E2E (self-hosted) #176 was the first run to reach the restart-resume gate since #765
unbroke the workflow, and it failed at exactly one domain:

```
task: state=skipped, itemsSynced=0, itemsFailed=0, lastSyncedAt=never
[Worker] running 2 domain lanes in parallel: email | calendar+contact+file
```

`DomainsConfig` had `tasks`. `runAllDomains` read `config.domains?.tasks?.enabled`. The
fixture ticked it. `parseDomainsConfig` in `packages/shared/src/config.ts` — the parser
*between* them — still had exactly four hand-written `if` blocks, so the parsed config had
no `tasks` at all and the appliance skipped a domain the mapping had asked for.

**Nothing could have gone red.** T5 added `task` to five lists and this was not one of them,
because it is not a list: it is four near-identical blocks, and an optional key nobody
assigns is legal TypeScript. So the type said five, the reader asked for five, the parser
produced four, and the word for the difference was `skipped` — which on the status endpoint
means "your call, nobody checked". Every file-configured migration that ticked Tasks between
2026-09-03 and 2026-09-04 copied nothing and reported no error.

Fixed by making it a list: `DOMAIN_CONFIG_KEY` (`Record<DiscoveryDomain, keyof
DomainsConfig>`) is now the single place the two vocabularies meet, the parser loops over it,
and `runAllDomains`/`planDomainLanes` read it — so a sixth domain is a compile error in one
map. A key under `domains` that names no domain is now **refused at start-up** naming the
keys that exist, because `"task"` for `"tasks"` is the same silence by another route. Guard:
`packages/orchestration/src/a-domain-the-mapping-ticked-that-never-ran.unit.test.ts`,
generated over `DISCOVERY_DOMAINS` and proved by breaking six ways.

**2026-09-03: the SEVENTH fan-out — the task domain ran a FILE sync and was
marked completed.** The one the whole workplan was written to prevent, found on the owner's
Spark by T7's task-lane assertion — the only thing in the system that asked the question.

There was **no task sync pass at all**. T3a/T3b built the source, T4 made the CalDAV writer
follow its component, T2 gave the ledger a `todo:` natural key, T5 added `task` to five lists
and even gave `buildDomainDepsFromMapping` a `'task'` overload. Nothing called any of it.
Both dispatchers — `runOneDomain` in `orchestration.ts` and the domain loop in
`run-delta-sync.ts`, separate code with identical shape — ended in a bare `else` that built
FILE deps and ran `runFileSync`. So a selected task domain ran a file pass, copied nothing
(that pass is idempotent), and was handed to `markCompleted`.

**Not a skip — a wrong pass reporting success.** #750's own note says an array literal is
never a compile error; a bare `else` is worse, because an absent branch omits work visibly
while a catch-all does the wrong work and says it went fine.

**Measured on a real Nextcloud, three facts no unit test could produce:** the seeder reported
`tasks:2` in the source, `scope_selection` carried `task|t` for the mapping, and the ledger
held `calendar|copied|2  contact|copied|2  file|copied|2` and not one task row.

The fix is `runTaskSync` — the calendar pass with exactly two differences, the VTODO source
and `naturalKeyForTask` — plus a named branch in both dispatchers and a trailing `else` that
THROWS. Seven breaks; the guard caught a half-fix of my own (task branch added, trailing
`else` left unconditional, so `file` still had no test of its own). Its first draft also
tripped over the comments that explain the defect, which necessarily name `runFileSync` —
#749's guard hit the mirror image of that, and both now strip comments before matching.

**#750 would not have caught this.** Zero recorded task rows resolves to SKIPPED, not
NOT_VERIFIABLE, so the cutover gate would still have passed. The gates and the engine failed
in the same direction; only the smoke's by-name assertion did not.

**2026-09-03 (latest): the SIXTH fan-out, and a gate that would not say what it found.**
The owner ran `SMOKE_PREPARE_APPLY=1 smoke-managed.sh` on the Spark and got
`verify: done   apply: applied` followed by a bare `SMOKE FAIL`. Both halves he could name had
succeeded, so the cause was one of the other hundred and forty-five assertions — and the only
way to find it was to read a several-hundred-line log on a phone. **The gate knew which
assertion had fired and threw the answer away one line later.** `fail_at` replaces every
`fail=1`; `BASH_LINENO[0]` is the caller's line, so a bare call already records "section, line
N" at no cost to the call site, and the verdict lists them under "what failed:".

The sixth fan-out was found while looking for that. `verify_mapping`'s tenant-B call named its
domains by hand — `dav calendar contacts files` — so the managed gate would have gone on never
asking about the task domain against a report that, after the fifth fan-out was fixed, finally
had the answer in it. Worse, the loop read "no `SKIPPED_<domain>` issue" as a pass: **absent is
not unskipped.** Before that fix the report had four keys and no `tasks` at all, so the grep
found nothing and nothing was a PASS — the gate would have reported a domain the engine had
never heard of as checked. An absent domain is now its own failure, and louder than a skip.

Proved by breaking, seven ways. One of the seven found a defect in this session's own work:
Break D (dropping `tasks` from the verify call) passed, because nothing paired the domains the
gate VERIFIES against the domains the seed SELECTS — the same shape as T7's Break E. That
pairing now exists in `smoke-managed-verdict.unit.test.ts`, with the `DiscoveryDomain` →
`VerificationDomain` spelling shift written down at the seam. An eighth break also passed at
first for the wrong reason: the loose-probe fixture escaped its quotes, so the substring the
loose probe looks for was never in it. Corrected to the realistic case — the domain name
appearing as a *value* in a nested issue.

**2026-09-03 (after T8): the fifth fan-out — the §20 report had no task domain at
all.** T5 found four fan-outs in `orchestration.ts` that no compile error could name. There
was a fifth, one layer down: `runVerification` called `verifyDomain` for `mail`, `calendar`,
`contacts` and `files` by hand, and never for `tasks`. `VerificationResult` had four literal
keys and no `tasks` field. `allVerifications` held four, so `overallStatus`, `score`, the
recommendations, every total and **`canProceedToCutover`** were computed over four fifths of
the migration. `Verify.tsx` listed four (the `tasks` label T5 added was present and unused).
Both self-hosted gates defaulted `E2E_DOMAINS` to four, and nothing anywhere sets it.

`run-cutover.ts` passes `verifyTasks: true`. So **a cutover carrying a task list reached
`canProceedToCutover: true` having never once looked at the task domain** — hard rule 9, on
the one destructive path. `verifyTasks`' own comment, written in T5, predicted exactly this:
*"a domain that copies and is never verified is the green run that checked nothing, and this
gate is the last thing standing between that and a cutover."*

**Measured, not deduced.** The owner ran `smoke-managed.sh` on the Spark at 13:40 UTC; the DAV
verify report it printed carries `mail`, `files`, `calendar` and `contacts` and no `tasks` key
of any kind.

**Why the type did not catch it.** T5 widened the `dataType` UNION everywhere — thirteen
hand-written copies — and gave the web screen a total label map whose comment says why. What
it could not widen was the ITERATION, because an array literal is never a compile error. So
`VERIFICATION_DOMAINS` is now the one list, `VerificationDomain` derives from it, and
`VerificationResult` extends `Record<VerificationDomain, DataTypeVerification>` — a missing
domain is a compile error at every construction site (which is how the web unit test's fixture
was caught). The engine's own loop is held by a guard rather than a type: it collects into
`{} as Record<...>`, and a cast does not check.

The e2e gates cannot import the list at all — `test/` declares no `@openmig/*` dependency and
`no-workspace-imports.unit.test.ts` keeps it that way — so they restate it and
`scripts/a-report-domain-the-gate-never-reads.unit.test.ts` pairs the restatement against the
source as text. `tasks` also moved into the restart-resume fixture beside the other four: T8
had switched it on inside `e2e.yml` with an `|| { enabled: true }` fallback, so the file a
person opens to answer "what does this gate migrate?" said four while the run did five.

Proved by breaking, nine ways. Two of the nine found defects in this session's own work: the
guard file had strict-index-access errors, and the first version of the engine assertion did
not exist, so narrowing the loop compiled green.

**2026-09-03: T8 built — the self-hosted gate seeds a task list too.** `e2e.yml` is
the only place the appliance is driven end to end against real servers — two Nextcloud
accounts, a restart-resume idempotency pass per domain, a real apply-deletion per domain — and
it knew about four domains. `test/e2e/seed-dav-source.mjs` now MKCALENDARs a VTODO-only
collection and seeds N VTODOs into it, the workflow's mapping patch points `cfg.domains.tasks`
at the same DAV root, and `mapping.json.example` says how an operator writes the same thing.

**Nothing made the two halves agree, which is the defect the new guard is really about.** The
seeder is Node and the workflow is YAML wrapping a `node -e` script; no compiler reads across
them. A domain configured but never seeded passes VACUOUSLY — zero items, nothing to copy,
nothing to verify, green — and a domain seeded but never configured piles fixtures into the
source that nothing ever reads.
`scripts/a-domain-the-self-hosted-gate-never-sees.unit.test.ts` pairs them: every DAV domain
in the workflow's patch must have fixtures in the seeder, and the task fixture must be a VTODO
in a collection declaring VTODO alone.

**The collection is named `e2e-tasks`, and the appliance is not told that.** The task domain
points at the DAV root and finds the collection through
`supported-calendar-component-set` — naming it in the config would be the gate asserting what
the source is supposed to discover.

**2026-09-03 (latest): T7 built — the machine seeds a task list and refuses to pass without it.**
`seed-demo-dav-content.sh` makes a collection declaring **VTODO and nothing else** (MKCALENDAR
with a `supported-calendar-component-set`, RFC 4791 §5.2.3), seeds two VTODOs into it, counts
them in its own verification, and takes them back under `--remove`. The demo tenant B mapping
selects `task`, and the managed smoke asserts by name that VTODO rows copied under this run's
tag — failing loudly, naming the four things a zero could mean.

**The separate collection is the point.** Nextcloud's default `personal` calendar declares
`VEVENT,VTODO`, so a VTODO dropped there is carried by both faces and proves almost nothing: a
mixed collection is the easy case and the unit tests already cover it. The collection that
declares VTODO alone is what this product read as a calendar for years, and it exercises T3a,
T3b, T4 and T5's fan-outs against a real Nextcloud in one pass.

**Asserted by name, because the inventory would not have caught it.** The diagnosis block
already groups the ledger by `domain`, so a task row shows there — and a run with **no** task
rows shows nothing there and stays green, because the apply half takes whichever eligible item
it finds and one calendar row satisfies it. That is the shape that has fooled this gate twice
(run #6's skipped apply, run #20's spent fixture). A domain nobody asserts is a domain nobody
is testing.

**Two of the five breaks did not discriminate on the first try**, which is the round earning its
keep: the smoke guard sliced from the task block to the next section header, so an unrelated
`fail=1` in between kept it green with the task-lane one deleted; and nothing anywhere asserted
that the demo mapping SELECTS `task` — the bash seeder and the TypeScript tenant list do not
import each other, so dropping the tick left the whole repository green. Both are now pinned,
and the second is pinned in both directions (what the mapping selects, and what the source is
given).

**2026-09-03 (latest): T5 built — the domain surfaces, and the four fan-outs that would have
made the tick a lie.** `DISCOVERY_DOMAINS` names five, and the tick now reaches the whole
product: the matrices (`caldav` carries `calendar` and `task`; `PROVIDER_ACCOUNT_DOMAINS.soverin`
gains `task` — the owner's own account has a Tasks list, over the CalDAV face that row already
claimed), the qualification's fifth face, the wizard's fifth tick, the confirm screen's counts,
the verification gate's fifth row, EN/NL strings, and an icon.

**The qualification measures tasks at the same endpoint as calendars, one property apart.** A
task list is a calendar collection declaring VTODO, so there is no second address to resolve —
`davFace('task', …)` builds the same `CalDAVSource` with `component: 'VTODO'` and counts in its
own unit (`taskList`). Two calendars and one task list on one account now read *Calendar ✓ 2
calendars · Tasks ✓ 1 task list*, where before both were "3 calendars". Google's face is a
MEASURED no at every tier, because Google's CalDAV carries no VTODO at all and no scope buys
one; JMAP's is a no in this product's own name, like its calendar.

**The four fan-outs are what a compile error could not find.** `orchestration.ts` asks "is this
domain switched on?" in five hand-written places — sync, discovery, the delta pass, the
verification reindexers, and the gate's own switches — and `config.domains.tasks` is an optional
field, so a chain that never mentions it compiles perfectly and silently does nothing. A person
could have ticked Tasks, watched the mapping activate, and got a migration that copied nothing,
discovered nothing, and passed its verification gate having never looked (hard rule 9). All five
now name it, and `scripts/a-domain-the-fan-outs-forgot.unit.test.ts` counts them so the sixth
domain cannot repeat it.

**One list became four fewer copies.** The record's face vocabulary (`mail` where the product
says `email`) is now `QUALIFICATION_KEYS` in shared, derived from `DISCOVERY_DOMAINS`; the
browser's four `domain.*` label maps became one `i18n/domain-words.ts`; and the zod enums at the
three doors (web validators, discovery job, create/discover routes) read `DISCOVERY_DOMAINS`
rather than restating it — their T1 exception said "not until the ledger widens", and T2 widened
it. The guard's exception map shrank by three entries accordingly.

**A record written before today has four faces, and the browser reads those rows.** Walking five
keys over four-key JSON would have thrown on the first existing connection card — the
fifth-domain failure this plan exists to stop, landing in the one layer with no compiler to catch
it, since the record arrives as JSON over the wire. An absent face is `?`, which is the rule
`qualifiedAnswerFor` already states in shared: unmeasured, never a no, with the Test button as
the remedy. Proved by breaking, eight ways.

**2026-09-03 — OWNER DECISION, the last one this plan was waiting on.** Asked whether a
customer mid-migration should keep having their VTODOs carried by the Calendar tick through a
transition period, the owner: *"yes, correct that tasks move with task tick."*

So there is no transition. **The component decides the domain**, from the moment the tick
exists: ticking Calendar carries events, ticking Tasks carries tasks, and a mixed collection
gives each domain its own. A person migrating today who ticked only Calendar will see their
to-dos stop arriving until they tick Tasks — and the tick will be on the same screen, beside
the one they already ticked, which is what makes that acceptable rather than a silent loss.

This confirms what T3b already built rather than changing it, and it closes T0: every decision
this plan needed is now made.

**2026-09-03 (latest): T3b finished — one source, two domains.** `CalDAVSource` takes a
`component` (default `VEVENT`, which is what every existing caller meant). It decides two
things: which collections the source lists — so a task list stops appearing under Calendar and
appears under Tasks, and a MIXED collection appears under both — and which objects it yields,
because `sync-collection` (RFC 6578) is component-agnostic and hands the parser everything in
the collection. Without that second filter, ticking Calendar would quietly copy the person's
to-do list as well. **The component decides the domain; the collection never does.**

One class rather than two: on the wire they are the same thing, read over the same protocol
with the same credential, and only `supported-calendar-component-set` tells them apart. A
second class would have been a copy of every parse and every discovery hop, differing in one
string.

Inert until T5: nothing constructs a source with `component: 'VTODO'` yet, because
`DISCOVERY_DOMAINS` still names four. T5 is what makes it reachable, and the two must land
together or the wizard offers a tick that enumerates nothing.

**T5, measured rather than guessed:** adding `'task'` to `DISCOVERY_DOMAINS` produces exactly
**16 compile errors across 6 files** — the qualification and Google-grant vocabulary maps (and
Google has no task scope, so that map becomes partial: the asymmetry made concrete), the lane
planner's per-domain record and two switches, the two apply jobs' `openDeps` switches, and one
narrower array in the tick. That list IS T1's thesis: a fifth domain is a finite compile error
rather than a hunt.

**2026-09-03: T4 built — the writer asks about the component it is writing.**
Both read-back queries in `caldav-target-writer.ts` filtered `comp-filter name="VEVENT"`, so
a task already on the target came back as "not there" and was re-PUT on every pass. Nothing
duplicated (same href, same UID) and nothing was lost — the idempotency CHECK was blind, not
the write, which is why a green suite never noticed. Reachable with no task feature at all: a
mixed collection already carries tasks through this writer today.

Three changes, one rule. The per-item REPORT filters on the component being written, read
from the object's own bytes; a caller that does not know asks for all three, which is
strictly more likely to find what is there (RFC 4791 §9.7.1: sibling comp-filters are an OR).
The collection snapshot — which also feeds verification — covers every component, keeping its
partial retrieval so a mailbox-sized calendar is still not downloaded to be counted.
`MKCALENDAR` carries the source collection's declared component set, and a source that
declared nothing creates a collection that declares nothing rather than being narrowed to
whatever this pass happened to see.

And a refusal names the component: writing a VTODO into a VEVENT-only collection is a 403
whose body is a stack of XML, so on the failure path only (one PROPFIND, never on a write
that worked) the collection is asked what it accepts and the sentence says which component
was written and which the target takes. When the component does not explain the refusal, the
server's own words are passed through unchanged — a guess dressed as a diagnosis is worse
than the raw refusal.

**2026-09-03: T3b, first half — an object is labelled what it is.** `parseCalendarObject`
stamped `type: 'event'` on every object it saw. That was wrong for two of RFC 5545's three
components and reachable today rather than hypothetically: `sync-collection` (RFC 6578) is
component-agnostic, so a MIXED collection — Nextcloud's default calendar declares
`VEVENT,VTODO` — hands the parser its tasks along with its events. The bytes were always
right (the raw iCalendar is carried through and PUT verbatim); the label on the record lied.

Nothing reads `type` today, so this changes no behaviour — it makes the record honest and
gives T4's read-back the field it needs. **It also turned T4 up as a live defect**, which the
entry above closes: both read-back queries filtered `comp-filter name="VEVENT"`, so a task
written into a mixed collection was invisible to the check that decides whether it is already
there, and was re-PUT on every pass.

**2026-09-03: T3a built — a task list stops being counted as a calendar.** `listCollections`
asks for `supported-calendar-component-set` and skips a collection that does not carry
`VEVENT`. The property is the ONLY thing that separates a task list from a calendar on the
wire — both are calendar collections — which is why this went unnoticed: nothing was asking.
`CalendarFolder.components` carries what the server declared, as data, so T3b reads the same
field for VTODO rather than asking twice.

Silence is not a no: a collection that declares nothing "MAY contain any calendar component
type" (RFC 4791 §5.2.3), and so does a collection whose declaration this parse does not
recognise. Both are kept. Reading silence as VTODO would hide a real calendar from somebody
who has one, which is a worse failure than the one being fixed.

**2026-09-03 (later still): T2 built — the ledger accepts `task` before anything sends it.**
Migration `0036_a_task_is_not_an_event.sql` widens **nine** CHECK constraints: eight `domain`
columns (seven from the baseline, one from 0035's `path_lifecycle`) and `item.item_type`,
whose vocabulary says 'mail' where the others say 'email' and whose column the code has never
written. The plan said "nine plus `item_item_type_check`"; measured, it is eight plus that
one. Additive only — every existing value stays valid, no row is read or written, and a second
application is a no-op.

`DISCOVERY_DOMAINS` still names four, deliberately: the database accepts a value nobody sends,
which is inert, rather than code sending a value the database refuses, which is a pass that
dies half-copied. The Drizzle mirror in `schema-pg.ts` now names `DISCOVERY_DOMAINS` instead
of listing the values, so it can only ever be narrower than what Postgres accepts — and
`scripts/a-fifth-domain-the-database-would-refuse.unit.test.ts` fails the build if a domain
reaches the shared list without a migration behind it. **`journal` is asserted absent**: the
third component in the same iCalendar enum, deliberately out of scope, and now out of the
database too.

Verified against a real Postgres (`scripts/local-pg.sh`), not reasoned about: all nine
constraints read back as accepting `task`, one row inserted into each of the eight domain
tables plus `item`, and `journal` still refused by name.

**2026-09-03 (later): T1 built — the domain has one name.** The owner, in the same
message that queued this work: *"add the task-objectkind (one of the latest workplans). Work
on this autonomously."* That is decision 1, yes. Decisions 2 and 3 are taken as this plan's
own recommendations — **its own tick**, and **Google Tasks out of v1** (T6 stays visible and
unstarted). Decision 4 waits for the owner's Soverin account to answer.

T1 measured **80** hand-written copies of the union across **18** files, not 73 — the count in
the table below was taken before #734–#738 landed. All 80 are gone: the list lives once, in
`DISCOVERY_DOMAINS`, with the type derived from it, and
`scripts/a-domain-union-typed-out-by-hand.unit.test.ts` fails the build on a new copy of
either. Three local aliases for the same concept (`SyncDomain` — declared twice in one
package — `PathDomain`, and two web-local `Domain`s) are gone with them. No behaviour changed;
the guard's exception list is now the checklist T2 and T5 work through.

**2026-09-03: drafted for the owner's decision, nothing built.** The owner, walking his own
Soverin account: *"i found 'Tasks', is that a Dav to? Perhaps we need to add it as
objecttype?"* Yes to the first half — tasks are CalDAV, `VTODO` components, and every DAV
provider this product targets carries them. The second half is this plan. What made it worth
writing rather than answering in a sentence is what the code says today: **a task list is
already being read as a calendar, and its tasks are already being labelled events.** That is
not a missing feature, it is a wrong answer, and §"What happens today" measures it.

| Task | Status | Evidence |
|---|---|---|
| T0 Decide: its own tick, and how far v1 reaches | ✅ Decided 2026-09-03 | 1: **build it** (the owner queued the work). 2: **its own tick**. 3: **Google Tasks out of v1**. 2 and 3 were this plan's recommendations, taken in the owner's absence; he then confirmed the consequence that matters — *"yes, correct that tasks move with task tick"* — so the ticks are separate and there is no transition period. |
| T1 The domain has ONE name | ✅ Done | Was **80 inline copies across 18 files** (73 when this was written; #734–#738 added seven). Now one `DISCOVERY_DOMAINS` in `packages/shared/src/discovery.ts` with `DiscoveryDomain` derived from it, three redundant aliases removed, and `scripts/a-domain-union-typed-out-by-hand.unit.test.ts` failing the build on a new copy of the type OR of the value list — with every legitimate exception named and two-way, so it cannot go stale. Proved by breaking. No behaviour changed. |
| T2 The ledger widens | ✅ Done | `0036_a_task_is_not_an_event.sql`: nine CHECKs widened (eight `domain` columns — seven baseline, one from 0035 — plus the legacy `item.item_type`). Additive, re-runnable, verified against a real Postgres: nine constraints accept `task`, a row lands in each of the eight tables, and `journal` is still refused. The Drizzle mirror names `DISCOVERY_DOMAINS` rather than listing values, and a guard fails the build on a domain that reaches the code without a migration. Proved by breaking. |
| T3 The source tells a task list from a calendar | ✅ Done | **(a)** `listCollections` now PROPFINDs `supported-calendar-component-set` (RFC 4791 §5.2.3) and drops a collection that does not carry `VEVENT`, so a VTODO-only list stops being counted among "5 calendars visible". The declared set rides on `CalendarFolder.components` as data; an UNDECLARED set is a yes for every component, per the RFC and 0105's never-guess rule. Proved by breaking. **(b)** each object's `type` is read from its own `BEGIN:` line instead of stamped `'event'`, and `CalDAVSource` now takes a **component**: it lists only collections carrying it and yields only objects of it, so one class serves two domains and a MIXED collection gives each domain its own. Default `VEVENT` — every caller before this meant that. Proved by breaking. |
| T4 The writer writes a task | ✅ Done | Both read-backs follow the component: the per-item REPORT filters on what is being written (read from the object's own bytes), the collection snapshot covers all three while keeping partial retrieval, `MKCALENDAR` carries the source's declared component set (and declares nothing when the source did), and a refusal names the component instead of returning a bare 403 — passing the server's own words through unchanged when the component is not the reason. Proved by breaking, five ways. |
| T5 The domain surfaces | ✅ Done | The matrices (`caldav` → calendar+task, `soverin` gains task, Google gains nothing at any scope tier), the qualification's fifth face measured through the same CalDAV endpoint with `component: 'VTODO'` and counted in its own `taskList` unit, the wizard's fifth tick, the discovery counts, the confirm screen, the verification gate's fifth row, EN/NL strings and an icon. Plus the four per-domain fan-outs in `orchestration.ts` that no compile error could have named — sync, discovery, delta, verification — with a counting guard so the sixth domain cannot slip past them. Four vocabularies collapsed into one on the way (`QUALIFICATION_KEYS`, `domain-words.ts`, three zod enums). A pre-T5 record's missing face reads as `?`, never as a crash. Proved by breaking, eight ways. |
| T6 Google Tasks | 📋 Optional (needs T0 decision 3) | Google's CalDAV carries no VTODO at all: tasks live behind the separate Tasks REST API, whose model is thinner than VTODO. A face of its own, or out of scope for v1. |
| T7 The gate (managed) | ✅ Done | The demo Nextcloud source carries a VTODO-only collection, made by MKCALENDAR with a `supported-calendar-component-set` and seeded with two VTODOs; demo tenant B selects `task`; and `smoke-managed.sh` asserts BY NAME that VTODO rows copied under the run's own tag, failing with the four causes a zero can have. `--remove` takes the tasks back with the rest, so the gate stays net zero. Proved by breaking, five ways — two of which did not discriminate at first and were rewritten. |
| T8 The gate (self-hosted) | ✅ Done (and it caught one) | `seed-dav-source.mjs` MKCALENDARs a VTODO-only collection (405 read as "already there", so a `SEED_OFFSET` re-seed converges) and fills it with VTODOs; `e2e.yml` enables `cfg.domains.tasks` against the same DAV root, leaving the collection for discovery to find; `mapping.json.example` documents the shape for operators. A new guard pairs the seeder with the workflow, because nothing else could: one is Node, the other YAML, and a domain configured-but-unseeded passes vacuously. Proved by breaking, three ways. **Followed up the same day:** enabling a domain is not asserting one — both gates in that workflow defaulted `E2E_DOMAINS` to four, so the task lane ran every night and nothing asked about it. **And on 2026-09-04 the gate earned its place**: the first run that reached it reported `task: state=skipped`, which is how the parser's missing fifth branch was found. See the latest status entry. |

## Why this exists

The four faces this product carries — mail, calendar, contacts, files — were chosen because
each is a thing a person would notice missing after a migration. A task list is that too. It
is also, unlike photos ([0112](./0112-google-photos-through-takeout.md)), **already reachable
over a protocol we already speak, with a credential we already hold**: it is the same CalDAV
account, on the same connection, behind the same password. There is no new grant, no new API
tier, and no provider to negotiate with.

What there is instead is a modelling mistake that has been shipping quietly.

## What happens today — measured in the code, 2026-09-03

| where | what it does | consequence |
|---|---|---|
| `packages/shared/src/discovery.ts:85` | `DiscoveryDomain = 'email' \| 'calendar' \| 'contact' \| 'file'` | There is no task domain to tick, count, or refuse. |
| `packages/shared/src/calendar.ts:5` | `CalendarEventType = 'event' \| 'todo' \| 'journal'` | The vocabulary exists. **Nothing in the repository produces or consumes the last two.** |
| `packages/connectors/src/caldav-source.ts:249` | `listCollections` PROPFINDs `resourcetype`, `calendar-description` and `calendar-timezone` — never `supported-calendar-component-set` | A task list is returned as a **calendar** and counted as one. The owner's "5 calendars visible" may include one. |
| `packages/connectors/src/caldav-source.ts` `listSince` | `sync-collection` REPORT (RFC 6578), which is component-agnostic | Tasks in a mixed collection are pulled in whether or not anybody asked for them. |
| `packages/connectors/src/caldav-source.ts:613` | Every parsed object is stamped `type: 'event'` | A task is carried as an event. The raw iCalendar survives; the label lies. |
| `packages/engines/src/caldav-target-writer.ts:334, :455` | Both read-back queries filter `comp-filter name="VEVENT"` | A written task is invisible to the check that decides whether it is already there — and a target collection whose component set is VEVENT-only refuses the write outright. |
| `packages/ledger/migrations/0001_baseline.sql` | Nine `CHECK (domain = ANY (ARRAY['email','calendar','contact','file']))` plus `item_item_type_check` | The database would refuse a task row today. |

So the honest summary for a customer, right now, is: *tasks are neither carried nor
refused; they are miscounted, mislabelled, and may fail to land with the provider's own
403 as the only clue.* Fixing the label is not optional work that waits for a feature — T3a
alone makes the counts true, and it is small.

## The facts, checked 2026-09-03

| route | what it gives | what it cannot do | source |
|---|---|---|---|
| **CalDAV `VTODO`** (RFC 4791, RFC 5545 §3.6.2) | Tasks as first-class calendar objects, in a calendar collection. A collection declares `supported-calendar-component-set`; `MKCALENDAR` may set it at creation. Same `UID` natural key, same `getetag`, same `sync-collection` as events. | Nothing beyond that property distinguishes a "task list" — it is a calendar collection whose component set says VTODO. | RFC 4791 §5.2.3 |
| **Nextcloud** | Stores the component set per calendar (`VEVENT` and/or `VTODO`); the Tasks app reads the VTODO ones. | Create a VTODO-**only** list from the web UI: it offers calendar, or calendar-plus-tasks. Administrators change the type in the database. | nextcloud/server issues [#41014](https://github.com/nextcloud/server/issues/41014), [#8625](https://github.com/nextcloud/server/issues/8625) |
| **Apple Reminders** | Older versions created task lists over CalDAV with `MKCALENDAR`. | Be a CalDAV peer at all on current macOS/iOS — Reminders dropped CalDAV from iOS 13 / Catalina. | nextcloud/server issue [#17190](https://github.com/nextcloud/server/issues/17190) |
| **Google Calendar's CalDAV** | Events. | Tasks: Google's own CalDAV guide states the implementation **does not support `VTODO` or `VJOURNAL`**. | [Google CalDAV API guide](https://developers.google.com/workspace/calendar/caldav/v2/guide) |
| **Google Tasks API** | Google's tasks, over a separate REST API and its own scopes. | Match VTODO: no recurrence rules and no precise times in Google's model, so a round trip loses shape rather than bytes. | Google Tasks API reference; the limitation is reported consistently by CalDAV clients |
| **Google Takeout** | `Tasks.json` per account. | Be live: it is an export, on 0112's two-monthly floor. | Third-party importers read exactly this file |

**The asymmetry that shapes v1.** A DAV account (Soverin, Nextcloud, a generic CalDAV
target) carries tasks over the protocol we already speak. Google does not, at all, over
CalDAV. So "tasks" is a face that a **target** can offer and a **Google source** cannot — the
first face where the two sides differ for a reason that is neither a scope nor a
qualification, but the protocol itself. The three-state record already handles this
correctly (0106 T0): a Google account measures a task face and gets a **measured no**, with
the evidence sentence naming Google's own documentation. Nothing new is needed to say so.

## The design

### One name before a fifth value

`DiscoveryDomain` exists, and almost nothing uses it. The union `'email' | 'calendar' |
'contact' | 'file'` is written out **29 times in `packages/shared/src/ports.ts` alone** and
44 more times across 16 other files — the ledger stores, the orchestration seams, the core
engines, the managed metering, the web services. Adding `'task'` to a type nobody references
would change nothing; adding it to 73 sites by hand would work until the day one of them was
missed, and the shape of that bug is #597's, which this repository has paid for twice.

So T1 is a refactor with no behaviour: every inline copy becomes `DiscoveryDomain`, and a
guard test fails the build on a new one. The rule it pins is the same one
`PROVIDER_ACCOUNT_DOMAINS` already carries: **a capability list belongs in one table, and a
second copy disagrees with the first exactly once.**

### A collection kind, not a flag on a calendar

A task list is a calendar collection whose component set says VTODO. Two ways to model that:

- **(a) A flag on `CalendarFolder`.** Cheap; leaves every consumer to remember to read it.
- **(b) Its own collection kind** — the source lists task collections separately, and the
  task domain enumerates those, exactly as the contact domain enumerates address books.

**(b), and the reason is the count.** The owner's screen said "Calendar ✓ 5 calendars". If a
task list is one of those five, that line is wrong, and a flag nobody reads keeps it wrong.
A collection kind makes the miscount impossible to express: a collection is enumerated by
the domain that can carry it, and one that declares both components is enumerated by both,
with each domain reading only its own components out of it.

That mixed case is the one to get right, and it is common: Nextcloud's default calendar
declares `VEVENT,VTODO`. The rule: **the component decides the domain, the collection never
does.** A mixed collection appears under Calendar for its events and under Tasks for its
tasks; the item's own `BEGIN:` line is what routes it; and a person who ticks only Calendar
gets the events out of that collection and no tasks — which is what ticking one box should
mean.

### The natural key, and what idempotency costs

Nothing new. A VTODO carries a `UID` like a VEVENT, `getetag` changes when it changes, and
`sync-collection` reports it. The existing ledger row shape fits with one added domain value.
Rule 1 holds by the same mechanism it already holds for events.

The one place to be careful is **completion**. A task has `STATUS:COMPLETED`,
`PERCENT-COMPLETE` and `COMPLETED`, and a re-run must not resurrect a task the person
finished on the source after the first copy. That is the same ordinary "changed since" the
etag already answers — but it is worth an explicit test, because a resurrected to-do list is
the kind of wrong that a customer notices immediately and trusts you less for.

### What this plan deliberately leaves out

- **`VJOURNAL`.** The third component in the same enum. Nobody has asked, no provider this
  product targets exposes it in a UI, and 0105's never-guess rule says an unmeasured face
  stays out. It becomes a row in the same tables the day a real account carries one.
- **Reminders and alarms (`VALARM`).** They ride inside the copied object as bytes; whether
  a target re-arms them is the target's business. Naming this is the honest position, and
  it belongs in the feature matrix rather than in code.
- **Google Tasks**, unless decision 3 says otherwise — see T6.

## The owner's decisions

1. **Build it?** The alternative is T3a alone: stop miscounting task lists as calendars, say
   in the matrix that tasks are not carried, and stop there. That is a few hours and leaves
   the product honest. The full plan is the feature.
2. **Its own tick, or under Calendar?** My recommendation: **its own tick.** A target can
   carry one and refuse the other — Google's CalDAV is the proof — and a tick that cannot be
   refused separately cannot be honest about that. It also fits the existing machinery
   exactly: a fifth domain, a fifth face, a fifth badge.
3. **Google Tasks in v1?** My recommendation: **no.** It is a different API with a thinner
   model, and shipping it inside this plan would mix "carry tasks between DAV accounts" with
   "translate Google's task model into VTODO". T6 keeps it visible without holding v1.
4. **Which provider is the first proof?** The owner's own Soverin account, if it publishes a
   task collection — which his newly-added test data can now answer.

## Sources

- RFC 4791 (CalDAV) §5.2.3 `supported-calendar-component-set`; RFC 5545 §3.6.2 `VTODO`; RFC 6578 (sync-collection)
- [Google CalDAV API Developer's Guide](https://developers.google.com/workspace/calendar/caldav/v2/guide) — no VTODO, no VJOURNAL
- nextcloud/server [#41014](https://github.com/nextcloud/server/issues/41014), [#8625](https://github.com/nextcloud/server/issues/8625), [#17190](https://github.com/nextcloud/server/issues/17190)
- This repository, read 2026-09-03: `packages/shared/src/discovery.ts`, `packages/shared/src/calendar.ts`, `packages/connectors/src/caldav-source.ts`, `packages/engines/src/caldav-target-writer.ts`, `packages/ledger/migrations/0001_baseline.sql`

# Workplan 0157 — Each tier at its own pace, and a tier a person picks

> **In one line:** Free runs each migration at one pass a day, the first right after the preflight, small kinds first and files last; paid tiers look hourly by default, at most every 15 minutes; and a person may pick a higher tier, which the month then bills at least.

## Status — 2026-10-04 (update this block at the end of every session)

**2026-10-04, evening: opened** from the owner's three messages of that day, which ADR-0014's
*Amendment 2026-10-04, evening* quotes. T1 is built in the pull request that opens this plan,
with T4's hourly default: *Start a migration* stores every hour where it stored daily at 02:00.
The rest of T2 to T6 is proposed, each one pull request. T7 is a proposal the owner asked to be reasoned
out (*"Reason on that, also in terms of load for our service and customer demand"*): §7 does,
and it waits for the owner.

| Task | Status | Notes |
|---|---|---|
| T1 The tier table | ✅ **Built 2026-10-04** | §1. Free 6 and 150 GB, Small 6 and 500 GB, Medium 12 and 1.5 TB, Large 24 and 6 TB, Extra large 50 and 15 TB: ADR-0014's table, `site/prices.mjs`, `MANAGED_TIERS`, the site's tier texts in both languages, and terms §6. |
| T2 Free at one pass a day | 📋 **Proposed** | §2. The managed tick makes a Free migration due 24 hours after its last pass started, its first copy included; a paid one keeps 0156 T5's first copy back to back. |
| T3 Small kinds first, files last, across a Free organisation's migrations | 📋 **Proposed** | §3. Within a pass `PASS_ORDER` already does it; between migrations due the same day, one that carries only files, or an export, goes last. |
| T4 The doors know the pace, and paid looks every hour | 🟡 **Hourly default built 2026-10-04; the doors proposed** | §4. A migration *Start* makes looks every hour (`StartMigration.tsx`'s `HOURLY`, *How often to look for changes*'s first preset). The API refusing a schedule faster than a tier allows, and the chooser offering what the tier allows, wait for T2's tier fact. |
| T5 The app says the pace | 📋 **Proposed** | §5. *"One pass a day, up to 50 minutes. Next pass at 07:12."*, with how many days the first copy needs, on the migration's and the person's pages. |
| T6 Picking a tier | 📋 **Proposed** | §6. The Billing page offers every tier above the derived one; a pick is the person's yes, the month bills at least the picked tier, and the downgrade stops there. |
| T7 The default slows once everything is in step | ⏳ **Waits for the owner** (proposed, not decided) | §7. Hourly for 14 days after the first copy, then every 6 hours, then daily after 30 days; a schedule the person chose is never changed. |

## The facts this plan stands on

Read from the code on 2026-10-04 (main at `5bb89a4`):

- **A migration is one old account to one new home, carrying every data type between them**
  (`migrationsFor` in `apps/web/src/services/start-plan.ts`). Google's mail, contacts, calendar
  and tasks into Soverin is one migration; its Drive into Nextcloud another; a Takeout's photos a
  third. **A path is one data type of one migration** (`packages/managed/src/path-ceiling.ts`), so
  that move is six paths.
- **One pass covers all of a migration's data types**, in `PASS_ORDER`: contacts, calendars,
  tasks, mail, files (`packages/shared/src/pass-deadline.ts`). Each type gets a fair share of what
  is left of the pass (`domainDeadline`). A pass stops taking work at 50 minutes.
- **The managed tick** (`apps/worker/src/jobs/managed-sync-tick.ts`) runs every minute. It reads
  every active migration, asks `isSyncDue` (`packages/orchestration/src/sync-due.ts`), and starts
  one pass per due migration. It runs the longest-waiting first (`longestWaitingFirst`), at most
  2 passes per organisation and 3 per stack (6 on live). Nothing in it knows a tier.
- **The schedule** is `mailbox_mapping.schedule`, a cron string. No schedule means every 15
  minutes, offset per migration (`defaultScheduleFor`). 15 minutes is the floor
  (`SCHEDULE_FLOOR_MINUTES`; `refuseUnreadableSchedule` in `apps/api/src/routes/migrations/index.ts`),
  and there is no ceiling. *Start a migration* stores `0 2 * * *`, daily at 02:00
  (`apps/web/src/pages/StartMigration.tsx`).
- **A first copy runs back to back** (0156 T5): while some data type has never finished, the tick
  makes the migration due 15 minutes after its last pass started, whatever its schedule.
- **A start runs at once**: *Start* and *Sync now* start a pass without the tick and its caps.
- **The agreed tier** is in `data_allowance`, one row per yes (`allowanceOf`,
  `packages/managed/src/data-ceiling.ts`).

## 1. T1 — the tier table

Built with this plan. ADR-0014's operative table; `site/prices.mjs` and `MANAGED_TIERS`, which
their guards hold to that table; the site's tier texts in both languages (Free *"one pass a
day"*, Small *"at full pace"*, Medium *"two people"*, Large *"a household"*); the Free card and
the estimate say that more data leads to Small and more than six migrations to Medium; the
estimate says Free's pace where it lands on Free; and terms §6 with question 28 for the lawyer.
The words *never picked* are gone from the site: the estimate still offers no choice, and says
it works out the least tier the answers need.

## 2. T2 — Free at one pass a day

- **The rule:** a migration of an organisation on Free is due 24 hours after its last pass
  started, its first copy included. A migration that never ran is due at once, as now, so the
  first pass follows the preflight. A paid organisation keeps the first copy back to back, then
  its schedule.
- **Where:** the tick computes a fact per migration, the least minutes between passes (1,440 on
  Free), from the organisation's tier, and `isSyncDue` takes it beside its other facts.
  `orchestration` must not learn what a tier is (AGENTS.md hard rule 5).
- **The tier it reads:** the tier the month bills (T6), so a pick takes effect at once. The
  tick runs as `ownpace_system`, which reads only `tenant_id` from `data_allowance` (managed
  0037): its tier needs a grant, in a managed migration.
- ***Sync now* on Free:** it starts a pass without the tick, as now. Proposed: on Free it is
  refused while a pass ran in the last 24 hours, with the time of the next one, so the pace holds.
- **Not during the alpha** (the owner, 2026-10-04: *"No, alpha is free for everything that
  testers want to do. So also the higher tiers are free for them."*): while the stage is `alpha`,
  a Free migration runs at a paid tier's pace, as the data ceiling is not held then either
  (ADR-0014, the owner's *"A"* of 2026-10-03). The stage is read as `holdsAtCeiling` reads it.
- **Guards:** a unit test of `isSyncDue` with the fact, and a tick test: a Free migration that
  ran 23 hours ago is not due, at 24 hours it is, and a paid one is due at 15 minutes while its
  first copy is unfinished; in the alpha, a Free one is due as a paid one is.

## 3. T3 — small kinds first, files last

- **Within a pass** it holds already (`PASS_ORDER`).
- **Between migrations due the same day:** the tick's order ranks a migration whose data types
  are only files, or whose source is an export, after the others, then the longest waiting. It
  matters when more than two of one organisation's migrations are due at once.
- **On the first day** *Start* runs every migration at once; the order holds from the second
  pass on.
- **The appliance** is not tiered and keeps its own lanes (`planDomainLanes`).

## 4. T4 — the doors know the pace, and paid looks every hour

- **The API** refuses a schedule more often than daily on Free, saying why and what changes it
  (picking a tier, T6).
- ***How often to look for changes*** (`ScheduleChooser`) offers only *once a day* on Free, with
  one line on why; on a paid tier every preset from 15 minutes.
- **Paid looks every hour by default** (the owner, 2026-10-04): built with T1. A migration
  *Start* makes stores `0 * * * *`, *How often to look for changes*'s first preset, where it
  stored `0 2 * * *`. A schedule somebody chose is kept as written, and the appliance keeps its
  own. Later, if the tick's minute :00 grows crowded, an offset per migration as
  `defaultScheduleFor` gives the 15-minute default.
- **A tier that falls** (a paid organisation back on Free): a chosen schedule faster than daily
  runs daily, and the page says so. Nothing is rewritten.

## 5. T5 — the app says the pace

- **On Free**, the migration's page and the person's page: *"Free: one pass a day, up to 50
  minutes. Next pass at 07:12."*, and while the first copy runs, how many days it needs at that
  pace, from the time-left estimate (0154 T3 (b)), with *"Small copies pass after pass"* and a
  link to the Billing page.
- **On a paid tier**, while the first copy runs: *"Copying pass after pass until everything is
  here; then every hour."*
- **The first-copy email** (0154 T7) says the same on Free.

## 6. T6 — picking a tier

- **The Billing page** offers every tier above the derived one, each with its price and pace. A
  pick is the person's yes (ADR-0014, *Amendment 2026-10-03*), recorded as the agreed tier.
- **The bill:** a month bills the higher of the picked tier and its derived peak. The automatic
  downgrade stops at the picked tier; lowering the pick is the person's own action, from the
  next month.
- **The pace** follows the billed tier at once (T2).
- **Outside the alpha** a pick of a paid tier passes the order button that says it carries an
  obligation to pay (terms precondition C, question 28). During the alpha every tier is free
  (the owner, 2026-10-04), so a pick costs nothing and needs no order button.

## 7. T7 — the default slows once everything is in step (proposed, not decided)

The owner: *"Perhaps we need to later think of lowering the default given frequency when all was
moved, but someone want to keep the snyc. Reason on that, also in terms of load for our service
and customer demand."*

**Load on our service.** A pass slot is the scarce resource: live runs 6 passes at a time per
stack, and an idle check takes a slot that a first copy, which customers do notice, could use.
Every hour is 24 passes a day per migration, so a thousand migrations kept in step at hourly are
24,000 passes a day, most of them finding nothing. Google's and Microsoft's quotas are per
application as well as per account, so idle checks also spend quota that first copies need.

**What customers need.** Freshness matters at two moments: the first days, while somebody checks
that new mail arrives, and the switch, which runs its own final sync on demand. Somebody who keeps
the sync for weeks without switching needs *"it is there today"*, not *"within the hour"*.

**Proposal:**
- hourly for the first 14 days after the first copy finishes;
- then every 6 hours, and daily after 30 days;
- each step said in the app and by email: *"Everything is in step. We now look every 6 hours;
  choose more often any time."*;
- opening the migration, or pressing *Sync now*, brings it back to hourly for 14 days;
- a schedule the person chose is never changed.

**What it saves:** about 400 passes in a migration's first month instead of 720, and 30 a month
from then on instead of 720, about 96% fewer.

**What it needs:** the time the first copy finished (`migration_status.completed_at`, already
kept) and the person's last visit, which the app does not record yet.

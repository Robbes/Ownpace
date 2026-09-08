# Workplan 0121 — A month billed as one pass

## Status — 2026-09-08 (update this block at the end of every session)

**2026-09-08, second session: T3 built. Compute is DERIVED and `usage_metric` has no
writer left at all.** T1/T2 shipped as #865 (per-pass rows, correct and expensive). The owner
then asked why the rows existed, and the answer was that they did not need to — so this
replaces them. See §4a. T4 remains the owner's.

**2026-09-08: T1 and T2 built and merged-ready; T3 and T4 are the owner's, and both are
about money rather than code.** The defect and the fix are described below and are real:
compute and sync operations were metered with a row key that had no pass in it, and an
upsert that replaces, so a billing period recorded the LAST pass rather than all of them.
The fix is one narrower key.

The owner chose it explicitly over the alternatives, on 2026-09-08:

> *"I go with C. But do note that the actual measures of compute are for me to understand if
> the pricing is somewhat balanced and fair. i might for example look at a free tier up to x
> GB of traffic, just to get people onboard and having the smaller / lighter migrations for
> free."*

That second sentence is why C and not the cheaper B: a corrected monthly TOTAL would price
an invoice correctly, and would tell the owner nothing about what a pass actually costs.
Per-pass rows do.

| Task | Status | Notes |
|---|---|---|
| T1 The key names the pass | ✅ Done | `perPassResource(kind, domain, runId)`; both meters and the managed dispatcher. Per-pass cost stored exact, not rounded to the cent. |
| T2 The guard | ✅ Done | `scripts/a-month-billed-as-one-pass.unit.test.ts` (15) + four integration cases against a real Postgres, every one proved by breaking. |
| T3 The rows this costs | ✅ **Done** — §4a | Owner chose the zero-row alternative. Compute and sync operations derive from the `run` ledger; `usage_metric` has no writer; the measured quantities are frozen onto the invoice, which is what keeps `run` prunable. |
| T4 What compute is FOR | 📋 **Owner's call** — §5 | The invoice speaks tiers (0109). Partly answered by the scraper PR: trends belong in Grafana, which is already instrumented and not yet scraped. The free-tier idea lands here. |
| T5 Run retention | 📋 Planned, own PR | Owner 2026-09-08: two months, `DELETE`, configurable — and the log window comes down to match, because `run_event.run_id` is `ON DELETE CASCADE`. Depends on T3's freeze, which is what makes deleting safe. |

## 1. The defect

`recordComputeForRun` and `recordApiCallForRun` write into `usage_metric`, whose unique key
is `(tenant_id, period_start, metric_type, resource)`. `resource` was `domain-<domain>` and
`sync-<domain>` — a value with no pass in it — and the write is
`onConflictDoUpdate … set { quantity }`, which REPLACES.

That replace is not a mistake. It is what makes a Trigger.dev retry safe: a run that is
retried rewrites the row it already wrote instead of adding a second one, and no amount of
at-least-once delivery can inflate a bill. Every version of this code has been right about
that.

It was wrong about the grain. One row per domain per PERIOD, overwritten by each pass,
means:

- **compute** held the duration of the last pass metered in the month. The default cadence
  is `*/15 * * * *` — 96 passes a day, 2 976 in a 31-day month. A mapping copying
  continuously for a month recorded ONE pass. At €0.05/hour and a 20-second delta pass,
  that is €0.0003, which the invoice rounds to **€0.00**.
- **api_calls** wrote `quantity: '1'` per domain. So the "number of sync operations" in a
  month was the number of DOMAINS that had ever run in it. Never more than five, whether
  the mapping synced twice or 2 976 times.

`getUsageMetricsForPeriod` already SUMS the rows it finds, and so does the operator's usage
history. Neither was wrong. Both were summing a set that could not have more than one member
per domain, which is why nothing about the read revealed it and no test could: with a
per-period key, "record two passes and read" and "record one pass twice and read" are the
same query.

## 2. The fix

The run id joins the key: `domain-<domain>#<runId>`, `sync-<domain>#<runId>`. Each pass owns
a row; the period's compute is their sum; the read is unchanged.

**The upsert is untouched.** A retry of the same run rewrites its own row rather than adding
a second, so retry-safety is kept rather than traded for correctness. That was the whole
objection to the obvious alternative of making the write accumulate — see §3.

One function builds both keys (`perPassResource`), because the property that matters is that
BOTH metrics are per-pass. A metric keyed per period behaves perfectly reasonably on its own
and is simply wrong when summed beside one that is not, and two spellings of the key is how
one of them silently stops being per-pass.

### The rounding that came with it

`total_cost` was `Math.round(durationHours × price)` — whole cents, computed per row. Keyed
per period that rounding happened once a month. Keyed per pass it happens 2 976 times, and
at €0.05/hour a 20-second pass costs 0.028 cents, which rounds to zero. A month of them
would have summed to nothing.

The column is `numeric`, so the exact value fits and is now stored. **The invoice never read
this column** — `calculateCost` prices the SUMMED hours and rounds once, at the end, where
rounding belongs — but the usage history does, and it would have shown a month of work
costing €0.00 beside a cost line saying otherwise.

## 3. The four options, and why C

Put to the owner on 2026-09-08:

| | | |
|---|---|---|
| **A** | Leave it | The number is wrong in the customer's favour and the invoice is tier-based anyway (0109). Costs nothing, learns nothing, and leaves a column called "compute hours" that is not compute hours. |
| **B** | Make the write accumulate (`quantity = quantity + excluded.quantity`) | One line. Gives a correct monthly total — and **breaks retry-safety**: an at-least-once retry of one run adds its hours a second time, so every Trigger.dev redelivery inflates the bill. Also collapses the month to a single number, which is the thing the owner said he needs the detail for. |
| **C** | **Key the row by the run** | ✅ Chosen. Same upsert, narrower key. Correct total, retry-safe, and the per-pass grain the owner asked for. Costs rows — §4. |
| **D** | Drop the compute line entirely | Defensible if tiers are the billing basis forever. It is a pricing decision, not an engineering one — §5. |

C and D are not exclusive: C is what makes D answerable, because you cannot decide whether
compute is worth billing for until you can see what it costs.

## 4. T3 — the rows this costs, measured

**Measured, not estimated.** 100 000 rows of the exact shape this code writes (per-pass
resource string, the six-key metadata object, a fractional cost) inserted into
`usage_metric` on a real Postgres with its three indexes:

```
heap 41 MB + indexes 19 MB = 60 MB / 100 000 rows = 628 bytes per row
```

Per mapping, on the default cadence, with all five domains enabled:

| | rows | on disk |
|---|---|---|
| Per day | 96 passes × 5 domains × 2 metrics = **960** | 0.6 MB |
| Per 31-day month | 29 760 | **18.7 MB** |
| Before this change | 10 | 6.3 KB |

So **2 976×**, which is exactly the number of passes — the growth is not incidental, it IS
the fix. At a hundred concurrent migrations that is **1.9 GB a month**; at a thousand,
**19 GB a month**.

**There is no time-based retention on `usage_metric`.** The only thing that removes a row is
the offboarding purge, which runs when a tenant leaves (`packages/managed/src/offboarding.ts`
lists the table). So the figures above accumulate for as long as the tenant exists, and
0117's continuous lane — a mapping that keeps syncing indefinitely after cutover — would
make them permanent rather than bounded by a migration's length.

### The alternative that costs zero rows

**Derive compute at read from the `run` table**, the way storage and egress are already
derived from `item` (`deriveStorageAndEgressForPeriod` — the "hybrid approach" this module's
own header describes). A `run` row is written per pass regardless of this workplan; it
carries `started_at` and `finished_at`; since #860 it always closes.
`SUM(finished_at - started_at)` over a period is the compute hours, with no `usage_metric`
row written at all.

It is **not a stored monthly aggregate.** Nothing is written and nothing is summarised: it
is a `SUM` at read time over rows that exist for another reason, exactly as storage and
egress already work.

The `run` table is the right thing to lean on, and `packages/ledger/src/retention.ts` has
already said so in as many words:

> **`run` is NOT pruned.** It is the answer to "when did this last work" […] and one small
> row per pass is storage rather than load.

Measured on the same cluster and the same way as the figures above:

| | rows/day/mapping | bytes/row | per month |
|---|---|---|---|
| `run` — exists today either way | 96 | 300 | **0.9 MB** |
| `usage_metric` at per-pass grain | 960 | 628 | **18.7 MB** |

So the derivation does not trade one table's growth for another's. It removes 18.7 MB and
keeps 0.9 MB that is already there and already kept for ever by decision.

#### What is genuinely for it, beyond storage

- **The metering write is in the hot path and can fail a customer's pass.**
  `recordComputeForRun` and `recordApiCallForRun` sit inside the per-domain `try` in
  `run-delta-sync.ts`, and the very next line is the `catch` that logs
  `Domain <domain> sync failed` and calls `markFailed`. A billing write that throws — a
  constraint, a pool exhaustion, a lock — is reported to the customer as a failed
  migration of their mail. Deriving at read removes that class of failure completely,
  because there is no write.
- **`api_calls` stops needing a table at all.** The count of sync operations in a period IS
  `COUNT(*)` over the run rows in it.
- **One record of one fact.** `run` is already the record of what happened. Two records of
  the same fact can disagree; one cannot.
- **It finishes the shape the module already chose.** Its header calls the current design a
  hybrid — derive-at-read for storage/egress because that gives "perfect idempotency",
  upsert for compute because that is retry-safe. Derive-at-read is idempotent by
  construction rather than by care.

#### What it actually costs

- **The per-domain split, unless it rides in `stats`.** A run covers every domain of a
  mapping, so its duration is one number. But `RunStats` is an open jsonb
  (`[key: string]: unknown`) already written once at `finishRun` — per-domain seconds can
  go there for **zero extra rows**. The grain is not lost, it moves out of ten rows and
  into one field of a row that exists anyway.
- **Wall clock includes the gaps.** A run's duration covers the time between domains and
  the run-ledger bookkeeping; today's per-domain sum does not. The derived number will be
  slightly larger. For *"is my pricing balanced and fair"* the time the machine was
  actually occupied is the better number, not the worse one — but it is a different number
  and that has to be said out loud once.
- **What counts as compute becomes a decision.** `run.kind` is
  `initial_copy | incremental | cutover | verify | discovery | backup`. Only delta passes
  are metered today; a verification or a discovery run is real compute that has never been
  counted. Deriving forces the question of which kinds count. That is a pricing answer, not
  a bug.
- **The switch itself.** Existing `usage_metric` compute rows stay as history for the
  periods they cover, or are deleted once the derivation covers those periods. Work, not
  loss.

#### Corrected, 2026-09-08

An earlier draft of this section listed **"a repriced past"** as a cost — that a derived
number is recomputed from today's code while a stored one is what was measured then. That
overstates it, and the overstatement matters because it argued against the cheaper option.
**An issued invoice cannot be repriced**: ADR-0044 and
`packages/managed/migrations/0014_an_update_the_invoice_refuses.sql` make it immutable at
the `draft → sent` line, enforced by a database trigger and column grants. What re-derives
is the usage *screen*, which is an indication and always has been — the operator's usage
history already recomputes `cost` from summed quantities and shows it beside the stored
`total_cost`.

**Not built, and deliberately not chosen unilaterally**: it changes what the compute line
means, which is the owner's decision and not a refactor.

## 5. T4 — what the compute line is for

The invoice speaks tiers ([0109](./0109-the-invoice-speaks-tiers.md)). The compute line is
already not the billing basis, and the owner's own framing was measurement rather than
revenue:

> *"the actual measures of compute are for me to understand if the pricing is somewhat
> balanced and fair"*

Two questions follow, neither of them answerable by code:

1. **Does compute ever bill?** If the answer is no — tiers, permanently — then this is
   instrumentation, and instrumentation does not need to live in a billing table under RLS
   with an invoice reading it. Somewhere cheaper, with retention, would do.
2. **The free tier.** The owner raised *"a free tier up to x GB of traffic, just to get
   people onboard and having the smaller / lighter migrations for free."* That is a pricing
   decision about the **egress/storage** figures, which are derived from `item` and cost no
   rows at all — it is unblocked by this workplan and does not depend on it. It is recorded
   here so it is not lost, but it belongs with 0109's tier work.

Until 1 is answered, the compute rows are kept: they are the measurement that answers it.

## 6. What was built

**Source**

- `packages/managed/src/usage-metering.ts` — `perPassResource(kind, domain, runId)` exported;
  `runId: string` required on `ComputeUsageInput` and `ApiCallUsageInput`; both writes keyed
  through it; `runId` in both metadata objects; per-pass cost stored exact.
- `apps/worker/src/jobs/run-delta-sync.ts` — `runId` passed to both meters.

**Tests, each proved by breaking it**

- `scripts/a-month-billed-as-one-pass.unit.test.ts` (15) — the key names the pass, both
  meters build it through the one function and neither spells its own, both inputs require a
  run id, the upsert still targets the same four columns, the read sums, the cost is not
  rounded, and the dispatcher hands each meter the run it just ran on the pass's own clock.
- `packages/managed/src/usage-metering.integration.test.ts` — four new cases against a real
  Postgres: two passes in one period sum; two passes are two sync operations while a retry of
  one is still one; twelve 20-second passes keep their cost instead of rounding each to
  nothing; each pass of each domain stays separate.

Break-proof, per hard rule 8: reverting the key to `${kind}-${domain}` fails 2 unit and 4
integration cases; restoring `Math.round` on the cost fails 1 of each; making the read take
the last row instead of summing fails 1 unit and 2 integration; and dropping `runId` from
either dispatcher call, or metering the status row's window again, each fails 1.

## 7. Merge order

This branch is cut from **#863's** (`claude/mailbox-sync-errors-c2xsw2-paused-and-why`), not
from `main`, because the three lines it edits in `run-delta-sync.ts` are the three lines
#863 rewrites. **#863 must merge first.**


## 4a. T3 as built — nothing is written

**`deriveComputeForPeriod`** sums the `run` ledger: `SUM(finished_at - started_at)` over
`initial_copy` and `incremental` — the only two kinds anything writes. `COUNT(*)` is the
number of sync operations. `usage_metric` is neither read nor written by any code path; it
is left in place holding what #865 put there.

**Four things fell out of doing it.**

1. **The initial copy starts being billed.** `run-full-sync.ts` opens `initial_copy` runs and
   contains no metering call at all — so the largest compute of any migration has been
   charged at zero since 0011 T4. Deriving from `run` bills it because the row was always
   there. This is a change in what gets billed, not a cleanup.
2. **A billing write left the path that can fail a migration.** Both upserts sat inside the
   per-domain `try` in `run-delta-sync.ts`, one line above the `catch` that logs
   `Domain <domain> sync failed` and calls `markFailed`. A constraint violation or an
   exhausted pool was reported to the customer as their mail failing to migrate.
3. **The window is half-open.** `periodEnd` is a DATE, so `<= periodEnd` is midnight and
   drops the whole last day of the month. `deriveComputeForPeriod` asks for
   `< periodEnd + 1 day`. **`deriveStorageAndEgressForPeriod` still uses `lte` and therefore
   still under-counts the last day of every period** — same class of error, different figure,
   deliberately not fixed here because it changes a billed number.
4. **`/api/billing/usage/history` had to be rewritten.** It summed `usage_metric` directly,
   so with no writer it would have answered zero for every month — indistinguishable from a
   customer who never synced. It now derives per month, taking the months from the run
   ledger.

**The grain survives at zero rows.** Per-domain seconds ride in `run.stats.domainSeconds`, a
jsonb on a row written regardless, folded in the database with `jsonb_each_text` rather than
by reading a month of runs into a process.

**The freeze is load-bearing.** `invoice-generation.ts` writes the measured quantities into
the invoice's metadata beside `costByDriver`. Without it, deriving would give the historical
body of `run` its first consumer and make the table unprunable for ever — every other reader
touches only the newest 21 rows of a mapping or the rows still `running`/`queued`. With it,
those rows are audit trail and T5 is possible. The code says so, at length, so nobody deletes
it as redundant.

### Evidence

Against a real Postgres (`./scripts/local-pg.sh`), 38 tests over three files: the metering
suite (13) and both billing suites (25). Break-proof on the derivation:

| Break | result |
|---|---|
| window closed (`lte`) — drops the last day | 1 failed |
| bill passes that never closed | 1 failed |
| drop `initial_copy` from the billable kinds | 1 failed |
| count domains instead of passes | 1 failed |

`scripts/a-month-billed-as-one-pass.unit.test.ts` (10) holds the seam the three files must
agree on: the kinds, the predicate, the absent write, the dispatcher's `domainSeconds`, and
the invoice freeze.

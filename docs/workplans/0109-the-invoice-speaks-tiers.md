# Workplan 0109 — the invoice speaks tiers

## Status — 2026-08-27 (update this block at the end of every session)

**T0 is decided and built; T1–T7 are still a plan for review.** Written after 0088's
calculator shipped, when the gap between what the site publishes and what the code would
charge stopped being theoretical.

The owner chose **(a) refuse** on 2026-08-27, and it shipped the same day: the invoice route
now answers 409 rather than minting a bill for a model we no longer sell. That closes the
only thing that was actually reachable by a customer. Everything below T0 remains unbuilt
and **T1 is still the blocking one** — the billing unit is per PATH and the only lifecycle is
per mapping, so nothing above it can be right until that moves.

| Task | Status | Evidence |
|---|---|---|
| T0 What the invoice route does until tiers exist (owner decision) | ✅ **Decided (a) refuse, and built, 2026-08-27** | `POST /api/billing/invoices/generate` answers **409 `billing_model_retired`** for every well-formed request, in one sentence that names what it *would* have billed — a retired model, every byte counted twice, items that moved nothing — and says plainly that nothing is wrong with the account and a figure comes from a person until the tiers ship. **409 rather than 501**: the request is well-formed and the caller entitled to make it; the deployment cannot honour it. The refusal is FIRST in the handler and touches no database, so a refused call leaves not even a draft — a test asserts that by making `getDbPool` throw. **The old body is deleted rather than left unreachable behind the refusal**: dead code under a `return` is code nobody maintains and everybody assumes still works, and git has it. Nothing else in billing changes — usage, listing, payment methods and the webhook all behave normally, because what is refused is *minting a bill*, the one operation that turns a wrong model into a number somebody could be asked to pay. **The guard cannot outlive its reason**: one test re-reads `packages/managed/src/pricing.ts` and fails the moment it mentions tiers, so removing this refusal becomes something CI insists on when T4/T5 land rather than something they must remember. Proofs by breaking: the route billing again → 3 red; the reason reduced to "disabled" → 1; tier code appearing in `pricing.ts` → 1 (the trip-wire firing as designed). |
| T1 A lifecycle per PATH, not per mapping | 📋 Planned (**blocking**) | The unit ADR-0014 bills is `(mapping, domain)`; the only lifecycle is per mapping. Nothing above this can be right until it is. |
| T2 The peak, recorded rather than recomputed | 📋 Planned (needs T1) | "Six at the same time on 12 August" has to come from somewhere. |
| T3 The first-copy byte meter, append-only | 📋 Planned (needs T1) | Never the same query as 0090's byte budget, and never a live-row SUM. |
| T4 The tier calculator, and its drift guard | 📋 Planned (needs T1–T3) | The third copy of the numbers. It gets the same guard the first two have. |
| T5 The invoice says the tier and its evidence | 📋 Planned (needs T2–T4) | One line, a tier name, a peak and a date — and the per-driver breakdown gone. |
| T6 Top-ups, step-ups and the floor | 📋 Planned (needs T4) | The mechanics ADR-0014 published and nothing implements. |
| T7 Extend the leakage guard before, not after | 📋 Planned (small, do it with T1) | A billing table in the appliance's own schema keeps the guard green today. |

## Why this exists

ADR-0014 was amended on 2026-08-20 into a **five-tier model on two axes** — migrations running
at the same time, and cumulative data moved, higher axis wins. `site/prices.mjs` publishes it,
guarded tier-for-tier against the ADR's own table by `site/site.unit.test.ts`, and 0088's
calculator now derives a tier from a visitor's answers.

**`packages/managed/src/pricing.ts` implements the model the amendment retired.** Its entire
configuration surface is four scalars — `baseFee`, `storagePricePerGB`, `egressPricePerGB`,
`computePricePerHour` (`packages/managed/src/pricing.ts:34-43`) — and `calculateCost`
(`apps/api/src/services/billing-service.ts:52-84`) multiplies three of them by metered
quantities and adds the fourth. There is **no tier code anywhere in `packages/` or `apps/`**:
the only `tier` in server code is `access_request.tier`
(`packages/managed/src/schema-managed.ts:212`), a free-text field the schema itself marks
indicative.

So the published model and the billing code share nothing but a Markdown file. That is
survivable only because nobody is invoiced yet — and it stops being survivable the day somebody
is.

### Three things found while checking, which change what "first" means

**1. The metered path double-counts every byte.** `deriveStorageAndEgressForPeriod`
(`packages/managed/src/usage-metering.ts:61-89`) sets `egressBytes = storageBytes` with the
comment *"every synced byte is both read AND retained"* (`:84-88`). The same byte is then
priced twice — once at €0.10/GB storage and once at €0.20/GB egress. Whatever replaces this,
that is not a rounding question.

**2. Both byte queries bill items that moved nothing.** `'skipped'` is included in the invoice's
own sum (`usage-metering.ts:70`) and in the display sum ADR-0014 already named
(`packages/ledger/src/migration-status-store.ts:182`), and both also count `'updated'` — which
are re-copies, which the amendment says must never count (`docs/adr/0014-cost-recovery-billing.md:452-456`).

**3. Nothing issues invoices on a schedule.** `generateInvoiceForPeriod`
(`apps/api/src/services/invoice-generation.ts:57-199`) has exactly one caller: an authenticated
owner/admin `POST` (`apps/api/src/routes/billing/index.ts:278`). Its own doc-comment says it is
"intended to be called by a managed-mode scheduled job at period close" — **that job does not
exist.** Invoicing today is a button, and the button is reachable.

Those three together are why T0 is a decision rather than a task.

## T0 — what the button does until tiers exist (owner decision)

An owner/admin can press `POST /api/billing/invoices/generate` today and get a draft invoice
computed from a model ADR-0014 retired, with bytes counted twice and skipped items billed. No
customer can be harmed by that this week. The question is what it should do in the meantime.

**Three options, and a recommendation.**

- **(a) Refuse, naming why.** The route answers 409 with the reason: the published model is
  tiers, this code still meters bytes, and issuing the invoice would bill something we do not
  sell. One guard, deleted when T5 lands. **Recommended** — it is the cheapest of the three,
  it cannot mislead, and it is exactly the shape this codebase uses everywhere else: refuse
  where the refusal can name its remedy rather than produce a confident wrong answer.
- **(b) Fix the arithmetic first** — drop the double count, exclude `'skipped'` and `'updated'`.
  Honest, and roughly a day's work on code T5 deletes. Worth it only if the metered model has
  to keep working for some months yet, which is a question only the owner can answer.
- **(c) Leave it.** Defensible while there are no customers, and the risk is precisely that the
  first customer arrives before T5 does. If this is the choice, it belongs in the ADR as a
  recorded decision rather than as a silence.

## T1 — a lifecycle per PATH, not per mapping (blocking)

ADR-0014's operative rule: *"A PATH is one kind of thing, from one account, to one account…
In the schema it is one `scope_selection` row."* Its four billing states are `ready` (free, and
the intended default) → `active` (holds a slot) → `paused` (still holds one) → `cutover`/`done`
(released).

**`scope_selection` has no state at all.** The table is `packages/ledger/src/schema-pg.ts:210-224`:
`id`, `tenantId`, `mappingId`, `domain`, `included` (a boolean the sync job reads as scope),
`filters`, `createdAt`. No status, no `activated_at`, no `ended_at`, nothing.

The lifecycle lives one level up, on the mapping, and is single: `mailbox_mapping.status`
(`schema-pg.ts:153-157`, `DEFAULT 'active'`, CHECK over `active|paused|cutover|done` — **no
`ready`**, `packages/ledger/migrations/0001_baseline.sql:346,353`). And `cutover_state` is
unique per mapping (`schema-pg.ts:790`), so one cutover machine serves all four domains.

**Three independent things therefore block per-path billing**, and all three must go:

1. `cutover_state`'s unique index is per mapping.
2. `POST /:mappingId/start` refuses at the mapping grain
   (`apps/api/src/routes/migrations/index.ts:2086`).
3. The workaround — a second mapping for the same pair — is closed by
   `uk_mapping_source_target_prefix` (`schema-pg.ts:200-204`, migration 0022, and rightly: two
   mappings writing the same items into the same place would double everything).

**Two findings sharpen the ADR's own text.** Its consequence 2 flagged `audit_log` coverage as
unverified: **verified, and it does not cover mapping status transitions** — the only writer is
`PgLedger.recordAuditEvent` (`packages/ledger/src/ledger.ts:449-464`) and none of its five call
sites fires on one. And the `→ done` transition
(`apps/api/src/routes/migrations/operating-routes.ts:878`) **does not even set `updatedAt`**, so
a path that just released a slot leaves no timestamp anywhere saying when. "Has this ever run"
and "when did it end" are both unanswerable from any table today.

**The `updatedAt` half is FIXED (2026-08-27), and it was worse than this paragraph said.**
Reading every writer rather than the one this finding named: of five writers of
`mailbox_mapping`, only start and the grant ending stamped the column. The **PATCH route** —
which is how a mapping reaches `paused`, `cutover` **and** `done`, three of the four lifecycle
transitions — never did, nor did the apply-flags update. Two writers stamping and three ignoring
is worse than none stamping, because the column looks maintained. There is no database trigger
to fall back on either; every ledger migration was checked. All three now stamp it, and a
source-level guard (`mapping-updated-at.unit.test.ts`) fails on a sixth writer that forgets —
source-level because the bug is an OMISSION, and an omission has no behaviour to assert against:
a route that forgets returns exactly what a route that remembers returns. The guard also asserts
the absence of a trigger, so that if one ever arrives the guard is deleted rather than kept as
folklore. **The other finding — `audit_log` not covering status transitions — still stands**, as
does the whole of T1: a timestamp says *when* something changed, never *what* it changed from.

What this task must decide — and the plan deliberately does not decide it here — is **where the
per-path lifecycle lives**: columns on `scope_selection`, or a `path_lifecycle` table beside it.
The first is smaller; the second keeps a billing concern out of a table the sync job reads on
every pass. Whichever is chosen, T7 applies.

## T2 — the peak, recorded rather than recomputed

ADR-0014 bills the month's **peak** occupancy and wants the invoice to say so in words
(*"Medium — 6 paths at the same time on 12 August"*, `0014:79-80`). A peak cannot be recovered
after the fact from current state, so it has to be written as it happens: a per-tenant,
per-month high-water row, updated with max-semantics when a path activates.

Nothing like it exists. `usage_metric` is the closest shape
(`packages/managed/src/schema-managed.ts:45-69`) and is the wrong one twice: its writers
**replace** rather than accumulate (`usage-metering.ts:139-143`, `:186-189`), and its
`metric_type` enum has no member for occupancy.

## T3 — the first-copy byte meter, append-only

The data axis counts each item's **first successful copy**, never falls, and ignores re-copies.
Today's number is a `SUM` over live rows including `'skipped'` and `'updated'`
(`migration-status-store.ts:182`), so it moves both ways: tombstone an item and the bytes leave
the total.

**0090's `byte_budget` is not this meter and must never be joined to it.** Its own migration
says so — *"the two must never share a query"* (`packages/ledger/migrations/0030_the_cap_we_now_count.sql:20-23`)
— and it is mechanically unusable besides: it **resets** every 24 hours
(`packages/ledger/src/pg-rate-budget.ts:165-176`), it is keyed `(tenant, provider)` rather than
by path or period, it deliberately has no RLS, and it is wiped at erasure. It is a good
*precedent* for writing a monotonic counter in one statement, and nothing more.

Two quantities are needed and only one exists as an idea: bytes **moved** (monotonic) and the
**allowance** the tier grants, which top-ups raise. Neither has a home.

## T4 — the tier calculator, and the third copy of the numbers

The numbers now exist twice: ADR-0014's table, and `site/prices.mjs` — guarded against each
other by `site/site.unit.test.ts:50-93`, which parses the ADR's own Markdown. A managed-side
calculator makes **three**, and it gets the same guard, structurally identical, or the drift
this project has already caught twice arrives in the one place that costs money.

`site/calculator.mjs:43-55` already implements the derivation correctly, including which axis
decided. It cannot be imported (`site/` depends on nothing in the workspace, deliberately —
0086 T7), so the managed one is a re-implementation whose agreement is proved by test rather
than by sharing.

## T5 — the invoice says the tier, and its evidence

One line: the tier, the peak that set it, and the date the peak happened. `invoice`
(`schema-managed.ts:73-110`) has nowhere to put any of the three; `metadata` could carry them,
and today it carries `costByDriver` (`invoice-generation.ts:126`) — **the per-driver breakdown
the amendment forbids from appearing on an invoice at all**. That field goes.

## T6 — top-ups, step-ups and the floor

Published in ADR-0014, implemented nowhere: a top-up buys another data band for the tier's own
setup fee; a step-up charges only the **difference** in setup; the data axis never falls, so it
sets a floor; the path axis falls by itself. `tenant_pricing`
(`schema-managed.ts:279-285`) is the natural home for the agreement — untyped `jsonb`, already
pinned per tenant on first use (`packages/managed/src/tenant-pricing.ts:42-82`) — but it is one
row, overwritten, with no place for *setup already paid*, which a step-up-charges-the-difference
rule needs to be monotonic about.

## T7 — extend the leakage guard before the table exists, not after

`apps/selfhost/src/no-managed-leakage.unit.test.ts` forbids the appliance's import graph from
reaching anything matching `pricing|tenant-pricing|usage-metering|invoice|invoice-generation`
(`:55`) — by **specifier name**, so even `packages/shared/src/pricing.ts` would fail, which is
the documented lesson at `:48-54`.

**But its table half is a fixed list of five** (`MANAGED_ONLY_TABLES`, `:198-207`). A tier,
peak or byte-meter table declared in `packages/ledger/src/schema-pg.ts` — which is exactly where
`scope_selection` lives, and where T1's lifecycle columns naturally want to go — would leave the
guard **green** while putting a billing table in the appliance's own type surface. The list must
grow with the tables, and the test's own comment (`:209-223`) says that is where the reason gets
written down.

## Where the cost is

**Schema, mostly, and it is the expensive kind**: a lifecycle grain change touches the sync
job's reads, the cutover machine, and the start/stop routes. T1 is the whole plan's weather.

**Not money.** Nothing here needs a purchase, a provider, or a decision about VAT.

**In doing nothing:** the site quotes a model the code cannot bill, and the first customer is
the one who finds out. That is a reputational cost in the one place this product sells honesty.

## Not in this plan

- **Any change to what a byte is worth.** The prices are ADR-0014's; this makes the code able
  to speak them.
- **The scheduled invoicing job** that `invoice-generation.ts` believes exists. It should exist,
  and it should exist *after* the invoice says something true.
- **0090's byte budget.** Different meter, different question, never the same query.
- **The appliance.** It is never invoiced (ADR-0036), which is why none of this belongs in it.

## Corrections made while writing this

Every citation this plan leans on was re-read at HEAD, and the stale ones are **fixed in the
same commit** rather than left for the next reader to re-discover:

- ADR-0014 cited `apps/api/src/routes/migrations/index.ts:1122` for the `scope_selection`
  creation (twice — `0014:21` and `:364`), `:1329` for new mappings landing paused (`:657`),
  and `:2009` for the cutover refusal (`:320`). Now `:1421`, `:1395` and `:2086`.
  `docs/adr/OPERATIVE.md` is generated from the ADR's own operative section
  (`scripts/adr-operative.mjs`), so it was regenerated rather than edited.
- Workplan 0088 repeated all three of its own: `:1329` → `:1395`, `:1770` → `:1829` (the
  paused-mapping refusal), `:1942–1990` → `:2004–2054` (the discovery pair).
- `site/prices.mjs:11` named its guard as `site/prices.unit.test.ts`. That file does not
  exist; the guard is `site/site.unit.test.ts`.

A line number is a claim like any other, and a wrong one costs the next reader more than no
citation would — they follow it, land somewhere unrelated, and have to decide whether the
document or the code moved.

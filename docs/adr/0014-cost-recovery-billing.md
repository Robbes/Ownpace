# ADR-0014: Cost-recovery billing for the managed edition

- **Status:** Accepted 2026-06-20; amended five times and retitled once (latest 2026-09-26); one
  amendment proposed 2026-09-29, not in force; consolidated 2026-10-03 (ADR-0051)
- **Date:** 2026-06-20; consolidated 2026-10-03
- **Deciders:** owner
- **Relates to:** [ADR-0029](./0029-public-site-is-server-rendered-and-legible.md) (the public
  page), [ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md) (where
  the machinery lives), [ADR-0039](./0039-no-open-core-and-what-ops-privacy-means.md) (the
  mission outranks the subgoal); workplans 0088, 0109, 0117, 0128 and 0152
- **History:** the record as it read before consolidation, word for word —
  [history/0014-cost-recovery-billing.md](./history/0014-cost-recovery-billing.md)

## Operative rules

<!-- What holds NOW, within the ADR-0051 budget: 8 bullets, 60 words a bullet, 300 words in
     all. Amend in place when a later decision changes it, then regenerate OPERATIVE.md:
     node scripts/adr-operative.mjs --write -->

- **A path is one data type, from one account to one account**: mail, contacts, calendar and
  files are four paths, and every price says so. Only a data type the migration carries is a
  path (`scope_selection.included`).
- **A tier has two axes, and you are on the higher**: paths at the same time, and data moved —
  cumulative, each item's first successful copy only. Past Extra large: *talk to us*.
  `site/site.unit.test.ts` and `packages/managed/src/tier-calculator.unit.test.ts` parse this
  table: prices change here.

  | tier | paths at the same time | data moved | setup | monthly |
  |---|---|---|---|---|
  | **Tiny** | 1 | 250 GB | free | free |
  | **Small** | 4 | 750 GB | €8 | €4 |
  | **Medium** | 20 | 2 TB | €15 | €8 |
  | **Large** | 50 | 7.5 TB | €50 | €39 |
  | **Extra large** | 200 | 15 TB | €150 | €99 |

- **Tiny is free, and free means no billing**: no payment method, no invoice, no top-up. Leaving
  Tiny is consented; a month that did not consent bills as Tiny.
- **`holdsASlot` in `@openmig/ledger` is the slot rule**: `active`, `paused` and `continuous`
  each hold a slot, and a stop releases it only in the continuous lane. Before the lane, the
  customer is told the bill does not stop at cutover.
- **The month bills its peak, and the tier is derived, never picked.** Downgrade is automatic
  and announced, never retroactive, never blocking a path: under-bill, never halt. Upgrade is
  consented at the crossing.
- **Setup is paid on the highest tier ever reached, in steps; a top-up buys another data band
  for the tier's setup fee again** — the ceiling rises, the meter is never rewound. At 80%,
  offer both and show the break-even.
- **The page, the gauge and the invoice follow the wording rules below**: every price
  published, no per-GB or per-path figure, *at the same time* never *concurrent*, no billing
  past 12 months unconfirmed. *"No profit" STANDS*.
- **Pending (proposed 2026-09-29, not in force):** Free replaces Tiny, no setup fees, a year
  costs six months, and the price pays for the work (0152 D9–D12). The table above holds until
  the owner accepts.

## Context

The managed edition has to pay for itself without becoming the thing its customers are
leaving. The 2026-06-20 decision priced it at cost recovery with a metered pass-through for
storage and egress. That turned out to mis-describe the cost: the egress line was €0.20/GB
against a transit price near €0.001/GB, a ~200× markup recovering labour (about 90% of the
real cost) under a bandwidth name, on a project whose differentiator is that it tells the
truth. Bytes were also the wrong proxy: mail is the largest support surface and small,
photos are large and mechanical, so a byte price over-charged a photo-heavy family and
under-charged the mail-only business that costs most to run.

The market sells something else. BitTitan's MigrationWiz sells a one-off licence per user
(~$14 a mailbox, ~$17.50 for a bundle), which expires after 12 months and allows *"up to 10
successful passes per mailbox"* and *"up to 50GB"*. CloudFuze's published plan is $9.99 a month
capped at 50 GB of traffic a month, and its business plan is quote-only. Both are US companies,
and migrating off US cloud through a US SaaS is self-defeating for exactly the customer who
cares. **They sell a copy, metered in passes and capped per user; this product sells a period
of shadow sync that ends when the customer says so.** Nobody serves households. (The figures
came from search results, not the vendors' own sites, which were unreachable: re-check them
before quoting any.)

## Decision

### What a path is

A path is one data type — mail, contacts, calendar or files — from one account to one account.
One person moving everything is four paths. In the schema a path is one `scope_selection` row,
`(mapping_id, domain)`, with its lifecycle in `path_lifecycle` at the same grain. Only a data
type the migration carries is a path: a row left with `scope_selection.included = false` holds
nothing. The public page shows the four things, named, before it shows a price, because every
number on it is counted in paths.

### The tiers: two axes, and you are on the higher

A tier has two axes: **how many paths run at the same time**, and **how much data has been
moved**. You are on the higher of the two, never the sum. One path and 400 GB is **Small**,
because size says so. The table in the operative rules is the price list; past Extra large on
either axis the answer is *talk to us* — the only number not published, because past the end of
the scale the case has to be looked at. Sizes are decimal (1 TB = 1,000 GB), as the site
publishes them (`scripts/a-screen-that-quoted-a-retired-price.unit.test.ts`).

**The data axis is cumulative and counts each item's first successful copy.** The cost it
stands for, the initial copy, is spent once, so a monthly allowance would be blown in month one
and idle ever after. Re-copies, retries, updates and delta passes do not count: nobody pays
twice for one item, our own retries never eat an allowance, and a long-lived sync path stops
accumulating once it has caught up. The meter reads *"how much of your stuff we have moved"*,
the same number the pre-preflight estimates before anyone connects.

**Flat within a band; no per-path price inside a tier.** Labour per path is sublinear — one
household is one relationship, one set of credentials, one cutover conversation — so a per-path
monthly would assert that the sixteenth path costs what the first did. The linear component is
the setup fee, and it is already handled by the step-up rule below. Medium is 20 paths rather
than the arithmetic 16 so that a household of four keeps headroom: Medium → Large (€8 → €39) is
the one steep step, and it should be crossed by an SME buying engagement, not by a family that
added a Dropbox.

**The tier boundary is a service boundary.** Tiny, Small and Medium are self-service — a manual
and a ticket queue, no phone. Large and Extra large include real engagement. The price gap
follows support, not size.

### Tiny is free, and free means no billing

The owner, 2026-09-24: *"make the Tiny tier Free, no billing needed."* Tiny — one migration at a
time, up to 250 GB, ever — has no setup fee, no monthly and no invoice. Not a €0 invoice, which
would still cost a payment instrument, a VAT treatment and a bookkeeping row: an organisation on
Tiny registers no payment method and is not asked for billing details. **Leaving Tiny is where
billing starts, so it is consented**, as every step up is: a second migration at the same time,
or data past 250 GB, moves it to Small once it has said yes. A month it did not consent to leave
Tiny is billed as Tiny, which is nothing. Tiny has no top-up — its setup fee is nothing, so a
top-up would make the data axis mean nothing; past 250 GB the tier is Small. What still makes an
unattended, credentialed byte-mover cost something to start is the invite-only access grant.

### A tier is a capacity, not a tally

A path takes a slot when it is first activated and gives it back when it ends. `holdsASlot(state,
stopped)` in `@openmig/ledger` (`packages/ledger/src/path-lifecycle-store.ts`) is the one rule;
the count, a move into the lane and the operator's usage view all derive from it.

| state | meaning | holds a slot |
|---|---|---|
| `ready` | configured, connection-tested, never run — the column default | no |
| `active` | running | yes |
| `paused` | ran, then stopped by the owner — it resumes in a second | **yes**: reserved capacity |
| `cutover` / `done` | ended, having run | no — released from that instant |
| `continuous` | keeps copying after cutover and deletes nothing | **yes**, until the customer ends the lane |

**Therefore pausing does not reduce a bill; finishing does**, and the pricing page says so
rather than an invoice. The `continuous` lane (owner, 2026-09-10, 0117 D6: *"a. yes it holds a
slot"*) is the one state that does not end by itself, so **before somebody enters the lane they
are told that their bill does not stop at cutover** (0117 T5).

**A stop per data type** (owner, 2026-09-24, 0128 D2 (c)): an owner may stop one data type and
resume it later; the stop is kept beside the state (`path_lifecycle.stopped_at`). Before its
cutover, a stopped data type **keeps** its slot — a stop then is usually short, which is what a
pause is for. In the continuous lane it **releases** it — a stop there is usually for good, and
billing it would charge for nothing; its `ended_at` says when. The peak still rules, so a stop
and a resume within one month cannot lower a bill.

**Each data type is cut over on its own** (0128 T5): mail's path moves to `cutover` and releases
its slot while calendars keep theirs and keep copying. The migration's status is its paths'
roll-up, and a press on the whole migration moves only the paths in the phase it leaves.

### The bill: the peak, derived, and paid in steps

**The month's bill is set by the peak**: the most paths running at the same time in that calendar
month — simultaneous, so eight that finish and one that starts afterwards is a peak of eight. A
reading taken on the invoice date would make two identical households pay different tiers for
finishing on the 30th or the 2nd. The invoice names the peak with its date: *"Medium — 6 paths at
the same time on 12 August."*

**The tier is derived from measurement, never picked.** Nobody selects a plan; activating a path
that crosses a boundary states the new price at that moment and asks. The tier chooser on the
public page is a calculator, not a plan selector, and must read as one.

**Downgrade is automatic; upgrade is consented.** A month whose peak fits strictly inside a lower
tier bills at that tier — announced in advance in the summary mail, never applied
retroactively, never a reason to stop, pause or block a path. If the arithmetic is ever wrong it
must under-bill, never halt a migration. Upgrade is the opposite: immediate, on the customer's
own action, priced at the moment they activate the path that crosses the line.

**The setup fee is on the HIGHEST tier ever reached, and it is paid in steps.** Each tier is a
one-off setup plus a monthly. Stepping up later costs the difference in setup, once; a tier
reached on the data axis charges its step the same way. Stepping down refunds nothing, because
the onboarding was consumed. So the total depends only on the highest tier reached, not on when:
Tiny then Small then Medium costs €0 + €8 + €7 = €15 in setup, exactly what starting on Medium
costs. Understating gains nothing and guessing wrong costs nothing.

**Tiers buy lanes; top-ups buy room.** Running out of room does not have to mean moving up: pay
your tier's setup fee again and the allowance grows by another whole band, on the same tier, at
the same monthly — €8 buys another 750 GB on Small. Repeatable, never expiring, never refunded.
**Implement it as a higher ceiling, never as a reset meter**: the counter stays monotonic so a
past invoice stays reconstructible (consequence 5). A top-up is a purchase, opt-in and priced in
advance, not a meter: €0.0067 to €0.0107 per GB, against ~€0.001/GB of transit and the €0.20/GB
line it replaced.

**At 80%, offer both and show the break-even.** *"You are at 80% of 750 GB. Another 750 GB is €8
once and you stay at €4 a month; Medium is €7 now and €8 a month, and gives you 20 paths instead
of 4."* Topping up costs €1 more up front and saves €4 a month, so it pays back in **about a
week** — say that, and say plainly when the tier is the better buy. On data alone it almost never
is, so the published guidance is *cross when you need more paths*, not *when you run out of room*.

**Paths fall; data does not.** The path axis is elastic and downgrades by itself; the data axis
only rises, so it sets a floor under the tier unless the customer buys room instead. That is
cost-honest — a large account is expensive on every pass — and bounded: published in advance,
announced before it happens, and ended when the last path ends.

### What the page, the gauge and the invoice say

- **Every price is published in full** — no contact-sales, no quote-gating (the one exception is
  off the end of the scale). The page follows [ADR-0029](./0029-public-site-is-server-rendered-and-legible.md),
  leads with the free preflight, and in this order: what it does and for whom; the free
  preflight; *at your own pace* in three lines; what a path is; both axes in one table with the
  word *higher* and the floor sentence (*"finishing paths lowers your bill; the size of what you
  moved sets a floor — or top up and stay where you are"*); *tiers buy lanes, top-ups buy room*
  with the break-even; the prices; what we do not do; self-host, prominently.
- **No per-GB line and no compute line on any invoice, and no "per path per month" figure
  anywhere.** The monthly is rent on an envelope with two dimensions, which is why a one-path
  700 GB account costs more than a one-path 5 GB one; a published division (€2.00 · €1.00 · €0.40
  · €0.78 · €0.50 at full fill, not monotonic) would invite a question it answers wrongly.
- **The words:** *at the same time*, never *concurrent*; *free*, never *€0*; the fill gauge lists
  the paths by name with their state and finished ones dated, and the count summarises the list —
  never *used*, which is what one says about something spent.
- **Start everything, or go one at a time: say both, and steer toward neither.** Everything at
  once is faster and its bill falls as each path cuts over; one at a time is Tiny, which is free.
- **Tone: numbers, not adjectives.** No "seamless", no "effortless", no "enterprise-grade".

### What it will not do

- **We do not take money from inattention.** A path billing with nothing to show gets a periodic,
  one-click *"keep it or finish it"* in the existing summary mail, and **billing never runs past
  12 months without an explicit re-confirmation.** A product promising "it ends when you say"
  cannot fund itself on people forgetting.
- **There is no separate backup product or price.** A path that keeps copying after cutover is the
  continuous lane, billed by the same slot rule as every other path.
- **The data ceiling is a price, not a policy.** Crossing it moves the tier, automatically and
  announced, with a warning at 80% naming what the next band costs — never a silent throttle,
  never a surprise invoice (from Tiny, only after the organisation's yes). A residual fair-use
  clause remains for what a number cannot express — reselling, pathological churn — and nothing
  else.
- **Metering stays internal.** Bytes and compute are still measured, to check the tiers against
  reality; they never reach an invoice.

### The principle

**"No profit" STANDS.** Large and Extra large are priced above their own cost precisely to fund
Tiny, Small and Medium — cross-subsidy inside one cost-recovery envelope, not margin (owner,
2026-08-20). Small is deliberately near cost: individuals are the mission's core, and
[ADR-0039](./0039-no-open-core-and-what-ops-privacy-means.md) ruled that the mission outranks the
subgoal. The self-host edition is free. The payment provider is an EU PSP (Mollie), and the
machinery lives in `@openmig/managed` ([ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md)).

## Consequences

**Schema consequences 1–5.** The 2026-08-20 record named five; all are now settled.

1. **The billing key's default must be the free state.** Done: `path_lifecycle.state` defaults to
   `ready` (ledger migration 0035).
2. **Something must record that a path ever ran.** Done: `path_lifecycle.first_activated_at`, set
   on the first activation and never cleared (ledger 0035); mapping status changes reach
   `audit_log` (`packages/ledger/src/mapping-status-audit.ts`).
3. **The peak must be written as it happens.** Done: one raise-only row per tenant per month
   (managed migration 0015, *the month remembers its peak*), lowering refused by a trigger.
4. **The billing unit and the lifecycle must share a grain.** Done: the lifecycle is per path
   (ledger 0035), each data type has its own cutover ledger (ledger 0067) and is cut over on its
   own, and the Finish page ends or keeps each data type (0128 T5).
5. **The byte meter must be an append-only counter, beside an allowance.** The counter is built:
   `bytes_moved` (managed migration 0016) counts first-copy bytes and only rises, erring towards
   under-counting. The allowance — a sum of granted bands, so a top-up adds a row and nothing is
   rewound — is not built yet: the site's calculator shows the top-up, the managed service does
   not sell one.

**Other consequences.**

- The terms follow this ADR: `site/legal/README.md` says *"If ADR-0014 changes, terms §6 and §8
  change with it"*. Terms §10 caps liability at what was paid in the previous twelve months,
  which reads as zero on Tiny; that sentence is the owner's to decide and stands until they do.
- The prices assume Small and Medium really are self-service. If a household needs a phone call
  the arithmetic collapses — family onboarding was ~71% of all hours under the old model — so the
  manual, the preflight and the error messages are part of this decision, not a separate project.
- The model is cheaper than BitTitan at every tier while selling more. Right for households; for
  a business buyer a price an order of magnitude under the consultancy alternative can read as
  unserious. Watched, not pre-emptively inflated.
- The long tail is a continuous path on Small at €4. The number that decides whether the business
  works is what fraction of customers keep a path running after cutover (ADR-0039); measure it
  early.

## Alternatives considered

- **Metered pricing (the 2026-06-20 model)**: a flat baseline plus per-GB storage/egress and
  compute. Replaced 2026-08-20: it recovered labour under a bandwidth name, priced the wrong
  proxy, and made bills unpredictable.
- **For-profit pricing**: out of scope per project intent; the cross-subsidy is not margin.
- **Per-seat or per-user pricing**, the market's default: pretends 25 seats are 25× the work, when
  labour per path is sublinear.
- **A start fee plus a monthly metered on the number or size of objects, capped**: reintroduces the
  per-unit line this decision removes, and the cap becomes the number everyone reads anyway — a
  tier wearing a meter's clothes. An object count is also not countable by the person paying.
- **A per-path price inside each tier**: a flat one asserts something false (labour is sublinear),
  a decreasing one inverts so adding a path lowers the bill. The cliff it was meant to fix is
  fixed by putting Medium's ceiling at 20.
- **Counting paths cumulatively over the month**, so a slot never returns: bills the cutover month
  higher than the months of migrating, and buys only protection against slot churn, which the
  data axis already bounds.
- **Reading the count on the invoice date instead of the peak**: makes the bill a lottery on an
  arbitrary instant.
- **A monthly data allowance**: the cost is the initial copy, spent once; a monthly allowance
  matches no cost and cannot be predicted from the account's size.
- **Counting every byte moved, including re-copies and deltas**: charges twice for one item, lets
  our retries eat the allowance, and turns a sync path into a slow ratchet.
- **Resetting the meter on a top-up**: identical to the customer, but a rewound counter cannot
  reconstruct a past invoice. The ceiling rises instead.
- **A single flat setup fee across tiers**: an Extra large onboarding is about twenty times a Small
  one, so Small would subsidise Extra large — backwards. **A per-path activation fee**:
  reintroduces the per-unit meter and makes the price unpredictable before connecting.
- **A separate, cheaper backup price after cutover**: priced the steady state and hid the
  front-loaded copy. Deleted; a path that keeps copying is billed as a path.
- **Automatic cancellation of an idle path**: idle is not useless — a path that copies nothing
  because nothing changed is working, and the ledger cannot tell finished from quiet. Ask instead.
- **A free band as a sixth row below Tiny**, or **a €0 invoice for Tiny**: the free band is Tiny
  itself, and a €0 invoice still costs a payment instrument, a VAT treatment and a bookkeeping row.

## Pending — Free, a year at the price of six months, no setup fees, and the price pays for the work (proposed 2026-09-29, 0152 D9–D12; not in force)

**Status: proposed, for the owner's acceptance.** Nothing in the operative rules above changes
until the owner accepts it. The price guards (`site/site.unit.test.ts`,
`packages/managed/src/tier-calculator.unit.test.ts`) read the operative table, so the table
changes together with `site/prices.mjs` and the managed code, in 0152 T6 (d)'s pull request.
Nothing is charged during the Alpha (0131 T3 (a)), so no customer has paid a setup fee or a price
this changes.

**The owner's decisions (2026-09-28, workplan 0152 §2):**

- **D9, the list:** *"Free · Small €5/€30 · Medium €12/€72 · Large €40/€240 · Extra large
  €80/€480."* Free replaces Tiny. *"Drop setup fees."* VAT is included. The limits (paths at the
  same time, data moved) stay as they are.
- **D10, the page:** *"Yearly preselected, with montly/yearly switch that opens on yearly. It
  shows the monthly price (yearly divided by 12) and discount against the monthly price."*
- **D11, the year:** *"Auto-renew a year, refund."*
- **D12, the principle:** on *"not to make a margin"*: *"yes, but i do need a pricing model that
  supports the efforts"*, and on how to say it: *"Costs include our work"*.

**What the operative rules say once accepted:**

1. **The table:**

   | tier | paths at the same time | data moved | monthly | a year |
   |---|---|---|---|---|
   | **Free** | 1 | 250 GB | free | free |
   | **Small** | 4 | 750 GB | €5 | €30 |
   | **Medium** | 20 | 2 TB | €12 | €72 |
   | **Large** | 50 | 7.5 TB | €40 | €240 |
   | **Extra large** | 200 | 15 TB | €80 | €480 |

   Every price includes VAT. The id `tiny` becomes `free`. A year costs six months, in every
   paid tier, and the guards hold that too.
2. **Free is free, and free means no billing:** the 2026-09-24 rule, renamed. No payment method,
   no billing details and no invoice. Leaving Free is where billing starts, so it is consented.
3. **No setup fee.** Three rules go with it:
   - *"The setup fee is on the HIGHEST tier ever reached, and it is paid in steps"*;
   - the step-up arithmetic that made a ramp cost the same as starting big;
   - *"The linear component is the setup fee"* in *Flat within a band*, which keeps its first
     two sentences.

   With nothing paid up front, the total is independent of the ramp by construction.
4. **A month or a year.** A month is paid monthly, at the monthly price. A year is paid ahead,
   at six months' price, and:
   - renews by itself;
   - can be stopped at any time;
   - refunds what was not used (question 2 below says how that is counted).

   A reminder goes out 30 days before each renewal, naming what renews, the amount and how to
   stop. After the first year, stopping takes at most one month's notice (art. 6:236 sub j BW).
   A contract made online carries a withdrawal button during the withdrawal period (Directive
   (EU) 2023/2673, art. 11a of the Consumer Rights Directive), on the Billing page. Refunds are
   credit notes (0111).
5. **The page's wording rules stand:**
   - *free*, never *€0*;
   - *at the same time*, never *concurrent*;
   - no struck-through price and no *was* price;
   - the yearly total is always shown beside a price per month;
   - there is no countdown.
6. **The price pays for the work.** *"No profit" STANDS* goes, and its cross-subsidy sentence
   with it. In its place: **the price pays for what it takes to run and build the service**
   (the servers, the support, and the time spent building and improving the software), with no
   investors to answer to. Running it yourself is free, and always will be. What stays, and
   why:
   - **no steering:** a tier is derived, never picked, and the page says both ways to go (all
     at once, or one at a time on Free). Steering was wrong because it takes money from people
     who did not need to pay it, not because there was no margin;
   - **we do not take money from inattention;**
   - **metering stays internal.**

   The business case behind the numbers is not in this repository.

**Two questions for the owner.** Each has a recommendation, and neither can be settled by the
list alone:

1. **Top-ups.** The rule was *"pay your setup fee again and your allowance grows by another
   whole band"*, and *"at 80%, offer both and show the break-even"*. With no setup fee, there is
   nothing to pay again.
   - **(a), recommended: no top-ups.** Past a band's data, the tier moves up, consented and
     announced, as it already does from Free. One mechanism, and at €5 to €12 a month the step
     up is small. The 80% warning names the next tier's price, and the break-even sentence
     goes.
   - **(b)** A top-up costs the tier's monthly price, once. This keeps *tiers buy lanes;
     top-ups buy room*, and needs its own line on the page and on the invoice.
2. **A year, when the tier is derived each month.** A tier follows the month's peak, and
   finishing paths lowers the bill. A year is bought ahead.
   - **(a), recommended: a year is credit at six months' price.** Buying a year of the tier you
     are on pays for it ahead. Each month then takes that month's own tier at half its monthly
     price: €2.50 for Small, €6 for Medium, €20 for Large, €40 for Extra large, nothing for
     Free. So finishing paths still lowers what a month costs, and a month on Free costs
     nothing. What is left is refunded when you stop. It is carried into the next year when the
     year renews. A credit that runs out before the year does asks you to add another year, or
     to go monthly. This keeps *the tier is derived* and *downgrade is automatic* true for
     someone paying yearly, and it is what *a year costs six months* and *refund* say taken
     literally.
   - **(b) A year buys one tier for twelve months.** Stopping refunds the whole months not
     used, and a step up during the year is consented and paid for the months left. It is
     simpler to invoice. But a year paid on Medium stays Medium when its paths finish, which
     is the opposite of *finishing lowers your bill*.

**What follows once accepted:**

- **The operative rules**, amended in place, and `OPERATIVE.md` regenerated
  (`node scripts/adr-operative.mjs --write`).
- **The code and the site,** in 0152 T6 (d)'s pull request, with the table:
  - `site/prices.mjs` in integer cents, with a yearly price;
  - `site/calculator.mjs` and `packages/managed/src/tier-calculator.ts`, which its own test holds
    equal to the calculator;
  - every sentence that names Tiny.
- **The page:** the monthly/yearly switch opening on yearly (T6 (e)); renewal, refund and the
  withdrawal button (T6 (f)); *Why it is priced this way* (T6 (g)).
- **The terms,** by `site/legal/README.md`'s rule (*"If ADR-0014 changes, terms §6 and §8
  change with it"*): the prices, no setup fee, the year, its renewal, the refund, and the
  withdrawal button. For the lawyer's pass (0139).
- **Invoices (0111):** no setup line, a yearly line, and credit notes for refunds. Which
  question 2 answer is taken decides how a year is invoiced.
- **The architecture document's §16:** its line *"Billing is cost-recovery, not for profit"*
  gets a dated note: *"2026-09-29: amended by ADR-0014 (0152 D12). The price pays for what it
  takes to run and build the service (servers, support, and the time spent building and
  improving the software); running it yourself stays free."*

**When it is accepted** (ADR-0051): fold it into the Decision and the operative rules, remove the
*Pending* bullet and this section, and give its acceptance a line in the amendment log below.

## Amendment log

- **2026-06-20** — Accepted: cost recovery, with a flat baseline and a metered pass-through for
  storage and egress. Record: *Context*, *Decision* (the first sections).
- **2026-08-20** — Metered billing replaced by five tiers on two axes, a setup fee paid in steps,
  top-ups, capacity, the peak, the derived tier and automatic downgrade; *"no profit"* kept as
  cross-subsidy (owner; workplan 0088 T1). Record: *The 2026-08-20 amendment*.
- **2026-09-10** — A sixth path state, `continuous`, which holds a slot, and the customer is told
  the bill does not stop at cutover (owner, 0117 D6; 0117 T5). Record: *A tier is a capacity, not
  a tally* ("Amended 2026-09-10").
- **2026-09-20** — Retitled by the owner: *"(no profit)"* dropped from the title, since the tiers
  cross-subsidise by design. Record: the Status line.
- **2026-09-24** — Tiny is free, and free means no billing (owner; settles workplan 0109 T8).
  Record: *Amendment, 2026-09-24: Tiny is free, and free means no billing*.
- **2026-09-24, later** — A stop per data type keeps its slot before cutover and releases it in
  the lane; only a data type the migration carries is a path (owner, 0128 D2 (c)). Record:
  *Amendment 2026-09-24, later — a stop per data type, and what it holds*.
- **2026-09-26** — A data type is cut over on its own and releases its slot then; consequence 4
  closed for the cutover (0128 T5 slice 5b, the owner's D8). Record: *Amendment 2026-09-26 — a
  data type cut over on its own*.
- **2026-09-29** — Proposed, not accepted: Free, a year at the price of six months, no setup fees,
  and the price pays for the work (0152 D9–D12). Its text: *Pending*, above.
- **2026-10-03** — Consolidated in place (ADR-0051): the decision as it stands, written once.
  Nothing was decided by the consolidation.

The full record, word for word as it read before this consolidation:
[history/0014-cost-recovery-billing.md](./history/0014-cost-recovery-billing.md).

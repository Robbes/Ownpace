# ADR-0014: Cost-recovery billing for the managed edition

- **Status:** Accepted 2026-06-20; amended seven times and retitled once (latest 2026-10-03,
  when the price list of 2026-09-29 came into force with 0152 T6 (d)); consolidated 2026-10-03
  (ADR-0051)
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

- **A path is one kind of thing, from one account, to one account**: mail, contacts, calendar,
  files and tasks are separate paths. Only a data type the migration carries is a path
  (`scope_selection.included`).
- **A tier has two axes, and you are on the higher of them**: paths at the same time, and data
  moved — cumulative first copies, never the alpha's. Past Extra large: *talk to us*.
  `site/site.unit.test.ts` and `packages/managed/src/tier-calculator.unit.test.ts` parse this
  table: prices change here.

  | tier | paths at the same time | data moved | monthly | a year |
  |---|---|---|---|---|
  | **Free** | 1 | 250 GB | free | free |
  | **Small** | 4 | 750 GB | €5 | €30 |
  | **Medium** | 20 | 2 TB | €12 | €72 |
  | **Large** | 50 | 7.5 TB | €40 | €240 |
  | **Extra large** | 200 | 15 TB | €80 | €480 |

- **Free is free, and free means no billing**: no payment method, no invoice, no top-up. Guard:
  `site/site.unit.test.ts` (*free*, never *€0*).
- **`holdsASlot` (`@openmig/ledger`) is the slot rule**: `active`, `paused` and `continuous`
  hold a slot; `ready`, `cutover` and `done` hold none; a stop releases one only in the lane,
  whose customer is first told the bill does not stop at cutover.
- **The month bills its peak; the tier is derived, never picked.** Downgrade is automatic,
  announced, never blocking a path. No setup fee. Not built yet (0109 T5–T6).
- **Every step up is consented and paid for.** A path waits for the yes at activation; at the
  data ceiling, outside the alpha, new first copies wait for a move up or a one-off top-up
  (another band for the tier's monthly, once; the meter never rewinds). Without that yes, a
  month bills the tier it was on.
- **A year is credit at six months' price**: each month takes its own tier at half its monthly
  price; what is left is refunded on stopping, or carried into the renewal. Not built yet
  (0111).
- **What we tell, and will not do, are rules** (*Decision*): every price published, VAT
  included; *Start* warns when the preflight will not fit; no per-GB, compute or per-path
  figure; no billing past 12 months unconfirmed. **The price pays for the work**;
  self-hosting stays free.

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

**A path is one kind of thing, from one account, to one account.** Mail, contacts, calendar and
files are separate paths — and tasks, since the ledger learned them as a fifth kind (workplan
0113) — so one person moving mail, contacts, calendar and photos is four paths, which is how a
customer describes their own situation. In the schema a path is one `scope_selection` row,
`(mapping_id, domain)`, with its lifecycle in `path_lifecycle` at the same grain. Only a data
type the migration carries is a path: a row left with `scope_selection.included = false` holds
nothing. The public page shows the things, named, before it shows a price, because every number
on it is counted in paths.

### The tiers: two axes, and you are on the higher of them

A tier has two axes: **how many paths run at the same time**, and **how much data has been
moved**. **You are on the higher of them** — never the sum, never the average. One path and 400 GB is **Small**,
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

**Flat within a band; no per-path price inside a tier.** Labour per path is **sublinear** —
one household is one relationship, one set of credentials, one cutover conversation — so a
per-path monthly would contradict the reason paths were chosen as the unit at all. The linear
component is the setup fee, and it is already handled by the step-up rule below.

Medium is 20 paths rather than the arithmetic 16 so that a household of four keeps headroom:
Medium → Large (€8 → €39) is the one steep step, and it should be crossed by an SME buying
engagement, not by a family that added a Dropbox. Small is 750 GB because a single person on a
2 TB consumer plan a third full is still a single-person migration.

**The tier boundary is a service boundary.** Tiny, Small and Medium are self-service — a manual
and a ticket queue, no phone. Large and Extra large include real engagement. The price gap
follows support, not size.

### Tiny is free, and free means no billing

The owner, 2026-09-24: *"make the Tiny tier Free, no billing needed."* Tiny — one migration at a
time, up to 250 GB, ever — has no setup fee, no monthly and no invoice. Not a €0 invoice, which
would still cost a payment instrument, a VAT treatment and a bookkeeping row: an organisation on
Tiny registers no payment method and is not asked for billing details. **Leaving Tiny is where
billing starts, so it is consented, on either axis**: a second migration at the same time, or
data past 250 GB, moves it to Small once it has said yes. A month it did not consent to leave
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
| `cutover` / `done` | ended, having run | no — released from that instant; it still counts in the month's peak if it ran during it |
| `continuous` | keeps copying after cutover and deletes nothing | **yes**, until the customer ends the lane |

**Therefore pausing does not reduce a bill; finishing does** — deliberate, since a paused path
holds state and resumes in a second, and said on the pricing page rather than discovered on an
invoice. The `continuous` lane (owner, 2026-09-10, 0117 D6: *"a. yes it holds a
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
the same time on 12 August."* One case stays awkward whatever the copy says: finish everything on
the 3rd and that month's invoice is still Medium. That is unavoidable under any period-based
scheme; the honest handling is the invoice line, and the lower bill the month after.

**The tier is derived from measurement, never picked.** Nobody selects a plan; activating a path
that crosses a boundary states the new price at that moment and asks. The tier chooser on the
public page is a calculator, not a plan selector, and must read as one.

**Downgrade is automatic; upgrade is consented.** A month whose peak fits strictly inside a lower
tier bills at that tier — announced in advance in the summary mail, never applied
retroactively, never a reason to stop, pause or block a path. If the arithmetic is ever wrong it
must under-bill, never halt a migration. An upgrade on the **path** axis is the opposite:
immediate, on the customer's own action, priced at the moment they activate the path that
crosses the line. On the **data** axis the tier moves automatically and announced, with a warning
at 80% (*What it will not do*, below) — except from Tiny, where it waits for the organisation's
yes.

**The setup fee is on the HIGHEST tier ever reached, and it is paid in steps.** Each tier is a
one-off setup plus a monthly. Stepping up later costs the difference in setup, once; a tier
reached on the data axis charges its step the same way. Stepping down refunds nothing, because
the onboarding was consumed. So the total depends only on the highest tier reached, not on when:
Tiny then Small then Medium costs €0 + €8 + €7 = €15 in setup, exactly what starting on Medium
costs. Understating gains nothing and guessing wrong costs nothing.

**Tiers buy lanes; top-ups buy room.** **Running out of room does not have to mean moving up.
Pay your setup fee again and your allowance grows by another whole band**, on the same tier, at
the same monthly — €8 buys another 750 GB on Small. Buyable repeatedly, never expiring, never
refunded, and it is the customer's own tier's fee, so the page gains a mechanism without gaining
a price.
**Implement it as a higher ceiling, never as a reset meter**: the counter stays monotonic so a
past invoice stays reconstructible (consequence 5). A top-up is a purchase, opt-in and priced in
advance, not a meter: €0.0067 to €0.0107 per GB, against ~€0.001/GB of transit and the €0.20/GB
line it replaced.

**At 80%, offer both and show the break-even.** *"You are at 80% of 750 GB. Another 750 GB is €8
once and you stay at €4 a month; Medium is €7 now and €8 a month, and gives you 20 paths instead
of 4."* Topping up costs €1 more up front and saves €4 a month, so it pays back in **about a
week** — say that, and say plainly when the tier is the better buy. On data alone it almost never
is, so the published guidance is *cross when you need more paths*, not *when you run out of room*.
Taking no profit means having no reason to steer, so we do not.

**Paths fall; data does not.** The path axis is elastic and downgrades by itself; the data axis
only rises, so it sets a floor under the tier unless the customer buys room instead. That is
cost-honest — a large account is expensive on every pass — and bounded: published in advance,
announced before it happens, and ended when the last path ends.

### What the page, the gauge and the invoice say

- **Prices are published in full on the public page** — no contact-sales, no quote-gating (the one
  exception is off the end of the scale): a deliberate contrast with the incumbents, and part of
  the same honesty claim as `SKIPPED`. The page follows
  [ADR-0029](./0029-public-site-is-server-rendered-and-legible.md), and its order is an argument:
  1. one sentence saying what it does and for whom;
  2. **the free preflight as the first action** — no account, no email gate — showing what the
     visitor actually has and what it would cost;
  3. *at your own pace* in three lines;
  4. what a path is, as the things named, before any price;
  5. **both axes in one table, never two** (two tables read as two bills), with the word
     *higher* and the floor sentence: *"finishing paths lowers your bill; the size of what you
     moved sets a floor — or top up and stay where you are"*;
  6. *tiers buy lanes; top-ups buy room*, the two prices side by side and the break-even said;
  7. the prices in full — setup and monthly shown separately, the step-up rule stated, and the
     sentence that finishing paths lowers the bill by itself;
  8. **what we do not do**: `SKIPPED` means nobody checked; adopted files are not ours to delete;
     some things cannot be moved, and we name them before you pay;
  9. **self-host, prominently**: Apache-2.0, run it yourself, we would rather you moved than that
     you paid us (ADR-0039's mission test).
- **Advertise the total, not the monthly.** *"€39 to move your household, over three months"* is a
  decision made in a minute; *"€8/month"* is a slower, subscription question. Same money. Every
  typical total is `setup + monthly × months`, counting the first month as month one, and the
  preflight knows the size, so it can show the total.
- **No per-GB line and no compute line appears on any invoice, and no "per path per month" figure
  is published either.** The monthly is rent on an envelope with two dimensions, which is why a
  one-path 700 GB account costs more than a one-path 5 GB one; a published division (free · €1.00
  · €0.40 · €0.78 · €0.50 at full fill, not monotonic) would invite a question it answers wrongly.
- **The words:** *at the same time*, never *concurrent*; *free*, never *€0*. The fill gauge shows
  **paths, not a number** — each path named, with its state, finished ones dated, the count
  summarising the list — and never *used*, which is what one says about something spent. **Say
  what frees a slot at the moment it frees**: when a path reaches `done`, the row says so and the
  count visibly drops, or people build the tally model in their heads.
- **Start everything, or go one at a time: say both, and steer toward neither.** Everything at
  once is faster and its bill falls as each path cuts over; one at a time is Tiny, which is free.
- **Tone: numbers, not adjectives.** No "seamless", no "effortless", no "enterprise-grade".

### What it will not do

- **We do not take money from inattention.** A path billing with nothing to show gets a periodic,
  one-click *"keep it or finish it"* in the existing summary mail, and **billing never runs past
  12 months without an explicit re-confirmation.** A product promising "it ends when you say"
  cannot fund itself on people forgetting.
- **There is no separate backup product or price.** A path kept copying after cutover is the
  continuous lane, and a copy to a third destination is a new path with its own initial copy;
  both are billed as paths, by the same slot rule.
- **The data ceiling is a price, not a policy.** Crossing it moves the tier, automatically and
  announced, with a warning at 80% naming what the next band costs — never a silent throttle,
  never a surprise invoice (from Tiny, only after the organisation's yes). A residual fair-use
  clause remains for what a number cannot express — reselling, pathological churn — and nothing
  else.
- **Metering stays internal.** Bytes and compute are still measured, to check the tiers against
  reality; they never reach an invoice. Tiers do not self-correct the way metering does, so this is
  what keeps them honest.

### The principle

**"No profit" STANDS.** Large and Extra large are priced above their own cost precisely to fund
Small and Medium — cross-subsidy inside one cost-recovery envelope, not margin (owner,
2026-08-20) — and, since Tiny became free (2026-09-24), Tiny as well; workplan 0109 T8 recorded
that cost before the decision: a free entry band anchors the published price at zero for the
lightest case. Small is deliberately near cost: individuals are the mission's core, and
[ADR-0039](./0039-no-open-core-and-what-ops-privacy-means.md) ruled that the mission outranks the
subgoal. The self-host edition is free. The payment provider is an EU PSP (Mollie), and the
machinery lives in `@openmig/managed` ([ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md)).

## Consequences

**Billing a tier is not built yet.** `POST /api/billing/invoices/generate` refuses with a 409
(`billing_model_retired`, `apps/api/src/routes/billing/no-bill-we-do-not-sell.ts`) rather than mint
an invoice from the retired metered model; the tier invoice is workplan 0109 T5, and top-ups,
step-ups and the floor are 0109 T6, *"published in ADR-0014, implemented nowhere"*. Nothing is
charged during the Alpha (0131 T3 (a)). What is built is the measurement the bill will read.

**Schema consequences 1–5.** The 2026-08-20 record named five, none solved then.

1. **The billing key's default must be the free state.** Done: `path_lifecycle.state` defaults to
   `ready` (ledger migration 0035).
2. **Something must record that a path ever ran.** Done: `path_lifecycle.first_activated_at`, set
   on the first activation and never cleared (ledger 0035); mapping status changes reach
   `audit_log` (`packages/ledger/src/mapping-status-audit.ts`).
3. **A past month's invoice must be reconstructible in one read** — the month, the peak, when it
   occurred, and the tier it implied. **Partly done**: the peak is written as it happens, one
   raise-only row per tenant per month (managed migration 0015, a trigger refusing any lowering).
   The data axis is not kept per month (`bytes_moved` is one lifetime total per tenant), and no
   tier is stored, so a past month's tier cannot yet be re-derived from what is stored —
   `scripts/half-the-array-was-a-recomputation.unit.test.ts` pins that asymmetry.
4. **The billing unit and the lifecycle must share a grain.** Done: the lifecycle is per path
   (ledger 0035), each data type has its own cutover ledger (ledger 0067) and is cut over on its
   own, and the Finish page ends or keeps each data type (0128 T5).
5. **The byte meter must be an append-only counter, beside an allowance.** The counter is built:
   `bytes_moved` (managed migration 0016) counts first-copy bytes and only rises. The allowance — a
   sum of granted bands, so a top-up adds a row and nothing is rewound — is not built (0109 T6).
   **Still open: coverage.** `size_bytes` is nullable, and an item whose source offered no size
   counts as 0. Under-counting is the safe direction but still a lie, so coverage is to be asserted
   per domain before the number reaches an invoice: an unmeasured thing is stated, not assumed to
   be zero.

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
- The long tail is a path kept running after cutover — free on Tiny while the account is under
  250 GB, otherwise usually Small at €4. The number that decides whether the business works is
  what fraction of customers keep one running (ADR-0039); measure it early.

## Alternatives considered

- **Metered pricing (the 2026-06-20 model)**: a flat baseline plus per-GB storage/egress and
  compute. Replaced 2026-08-20: it recovered labour under a bandwidth name, priced the wrong
  proxy, and made bills unpredictable.
- **For-profit pricing**: out of scope per project intent; the cross-subsidy is not margin.
- **Per-seat or per-user pricing**, the market's default: pretends 25 seats are 25× the work, when
  labour per path is sublinear.
- **An account pair as the unit** (the 2026-08-20 draft's): nobody says "two source accounts";
  they say *"my mail, my contacts, my calendar and my photos"*, and `scope_selection` already stores
  one row per domain. The ceilings doubled when the unit got smaller; the prices did not move.
- **A start fee plus a monthly metered on the number or size of objects, capped**: reintroduces the
  per-unit line this decision removes, and the cap becomes the number everyone reads anyway — a
  tier wearing a meter's clothes. An object count is also not countable by the person paying.
- **A per-path price inside each tier**: a flat one asserts something false (labour is sublinear),
  a decreasing one inverts so adding a path lowers the bill. The cliff it was meant to fix is
  fixed by putting Medium's ceiling at 20.
- **Medium at €12 a month**: Google One 2 TB is €9.99, and the customer is leaving it while paying
  their new provider too; at or above €10 a month the service costs more than the thing it
  replaces, for something that is supposed to end. (The pending proposal below revisits the
  list.)
- **Small at 500 GB**: a single person on a 2 TB consumer plan a third full would be pushed to
  Medium at twice the monthly for a single-person migration; the extra 250 GB costs ~€0.25 of
  transit.
- **The data ceiling as fair use** — *"we talk to you and move you a tier"*: a number that moves a
  bill is a price, not a policy, and calling it fair use made it softer and less predictable.
- **Counting paths cumulatively over the month**, so a slot never returns: bills the cutover month
  higher than the months of migrating, and buys only protection against slot churn, which the
  data axis (once called fair use) already bounds.
- **Reading the count on the invoice date instead of the peak**: makes the bill a lottery on an
  arbitrary instant.
- **No automatic downgrade**: a customer sitting on Medium while running one path *is* inattention,
  and charging for it would make that rule decorative.
- **A head fee charged on each tier entered**: it rewards staggering activations for billing
  reasons; the setup fee paid in steps costs the same however the customer ramps.
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

## Amendment 2026-10-03 — every step up is consented and paid for, and the ceiling holds until it is

The record said two things. *"Downgrade is automatic; upgrade is consented"*, and leaving Tiny
was *"consented, as every step up is"*; yet the data ceiling moved the tier *"automatically and
announced, the same way crossing a path ceiling does"*, which a path crossing never did. The
consolidation kept the narrower reading (automatic on data, consented from Tiny) and asked the
owner, who answered on 2026-10-03: *"yes, but it needs consent (and payment) of moving up or
buying a one-off top-on"*. Asked next what a migration does at the ceiling while the yes is
awaited — keep copying, billed at the tier it was on, or hold — the owner answered *"Hold"*.

- **Every step up is consented and paid for, on either axis.** A path crossing is consented when
  the path is activated, as before. A data crossing is the customer's choice between the two
  ways out this ADR already prices — **move up a tier, or buy a one-off top-up** (*Tiers buy
  lanes; top-ups buy room*), both offered from the warning at 80% — and nothing moves the tier
  without that yes.
- **From Tiny, the only way out is moving up**: Tiny has no top-up, because its fee is nothing.
- **At the data ceiling, new first copies hold until the yes.** Only what the meter counts
  waits: an item's first copy. Updates to items already copied, and the moves and deletions a
  pass notices, carry on, so what has been copied stays in sync. The hold is announced with both
  prices, as the warning at 80% was — never a silent throttle — and the yes lifts it where it
  stopped. This is the path axis's rule on the data axis: a path past the line waits for its yes
  too.
- **Without that yes, a month bills the tier it was on.** That is what *"a month it did not
  consent to leave Tiny is billed as Tiny"* said for Tiny, now said for every tier: under-billing,
  never a surprise invoice.
- **The preflight says it first** (owner, 2026-10-03: *"ok, you have a go"*, to the
  recommendation that follows). At *Start*, the data already moved and what the preflight
  measured for the migrations being started are added up; if the total passes the ceiling, the
  step says so with both prices, move up or top up, and the customer may choose then or start
  anyway and choose at the ceiling, where new first copies hold. It does not block *Start*: the
  hold is the safety net, and the forecast is an estimate (data types without a size count as
  nothing, and items the destination already holds count although the meter will not). A
  crossing on the **path** axis is different: *Start* asks before it starts, as *The tier is
  derived* says. The public calculator, when data decides the tier, shows the top-up beside the
  bigger tier with the break-even, so it no longer quotes the dearer way alone. Managed only:
  the self-hosted edition has no tiers.

**Not during the alpha** (the owner, 2026-10-03: *"A"*, asked what the hold does while the alpha
is free and nothing is charged). While the deployment's stage is `alpha` the ceiling warns and
nothing holds, and no yes is taken: a tester's migration is never stopped by a price they would
not pay. The hold and the yes go live when the alpha ends.

**Built so far (0109 T6, first slice):** the yes, as ADR consequence 5 shaped it. `data_allowance`
(managed migration 0037) holds one append-only row per yes, with the price shown; the ceiling is
the highest tier moved up to plus every band bought (`data-ceiling.ts`); `GET
/api/billing/ceiling` says where the data stands and the two ways on, and `POST
/api/billing/ceiling/yes` takes a yes only to the offer shown, and none during the alpha. The
Billing page shows where the data stands and, from 80%, both ways on with the break-even, and
sends a yes only after the money is said once more. The hold: before each new first copy the
pass asks whether the meter, with what it has copied, is still below the ceiling
(`PassClock.firstCopyAllowed`); a held item is not fetched and gets no row, an update carries on,
the collection keeps its cursor, and the status names what waits with both prices. The tasks learn
the stage from `OWNPACE_STAGE`, which `set-task-env.sh` uploads. At *Start*, a note adds what the
preflight measured to what has moved and, past the ceiling, names both prices; it never blocks.
**The path axis (the owner, 2026-10-04).** Asked how a step up on the path axis is recorded,
what *Start* offers, and who enforces it:

- **One agreed tier for both axes** (*"A"*): a path yes is a row in the same append-only table
  as a data yes (`data_allowance`, with `axis` saying which limit asked, managed 0039), and the
  highest tier said yes to is the organisation's agreed tier on both axes. Each month still bills
  what it used, never above the agreed tier. The data allowance stays cumulative, never per
  month (*"Cumulative, as now"*).
- **Side by side at *Start***: move up and start everything, or start what fits now.
- **Enforced by the server**: a start that takes slots past the agreed tier's paths at the same
  time is refused, at every door that takes one (Start, a migration created running, a status
  change, a kind added to a running migration, a resume or a keep in the lane, a migration that
  starts when its person connects), and nothing of it is kept. A start that takes no new slot is
  never refused, so an organisation past its tier from the alpha can pause and resume. The
  operator's cutover CLI and the rollback job are not asked: a recovery is not a step up. Not
  during the alpha.

Built (0109 T6): the server's check (`path-ceiling.ts`, refused in `path-lifecycle-wiring.ts` as
409 `paths_need_a_yes`), the `axis` column, and the question at *Start* (`GET /api/billing/paths`,
`POST /api/billing/paths/yes`, `PathsAtStart.tsx`): what *Start* would take, by the server's own
rule, and side by side, moving up at the new tier's monthly (asked once more with the money said,
then everything starts) or starting what fits now. The plain *Start* gives way while the question
stands; during the alpha it is a note.

**The data, in total, and the alpha's (the owner, 2026-10-04).** Asked whether data counts per
year: *"In total for ever, and the alpha's data doesn't count"*. The meter stays the record of
everything moved; what a ceiling, a hold and a tier count is that total less what moved while the
stage was `alpha` (`bytes_moved.alpha_bytes`, managed 0040, which rises with the total during the
alpha and never after; every byte before 0040 was the alpha's). So nothing moved during the alpha
is ever charged, and Start's note at the ceiling says nothing during it. The Billing page's tier
panel names, once the alpha is over, **what this month bills**: what it used, never above the
agreed tier, so a band bought keeps the tier (`billedTierOf`); what was used stays under it, data
in total against its ceiling, and what the alpha moved on its own line.

This replaces two passages of the Decision above: in *Downgrade is automatic; upgrade is
consented*, the sentence beginning *"On the **data** axis the tier moves automatically"*; and in
*What it will not do*, *"Crossing it moves the tier, automatically and announced"*, with its
Tiny parenthesis. The data ceiling stays a price, not a policy: crossing it costs a top-up or a
step up, priced in advance and chosen by the customer.

**The hold is not the halt that *Downgrade is automatic* rules out.** *"If the arithmetic is ever
wrong it must under-bill, never halt a migration"* is about a wrong number; the hold is the
published ceiling, reached, said in advance, and lifted by a yes. The number must still err low.
The meter that decides the hold is the one consequence 5 describes, in which an item whose
source gave no size counts as nothing, so an unmeasured item never brings a migration to the
ceiling.

The terms already say that a step up waits for a yes (§6: *"We move you to a paid tier only after
you confirm it"*). Neither they nor the pricing page say what waits at the ceiling, and the terms
do not mention top-ups; both join when workplan 0109 T6 builds the hold and the top-up. Nothing
is billed or held today (*Billing a tier is not built yet*), but one screen still follows the old
rule. The Billing page's *What this puts you on* (`apps/web/src/pages/Billing.tsx`, from
`observedTier`) names the tier the data has reached, with no yes. 0109 T6 builds the yes and the
hold, and with them that screen says when the ceiling is reached, what waits, and the two ways on.
None of the preflight's warning is built either: neither the Start step nor the start door reads
the tier, the meter or the preflight today, and the calculator quotes only the bigger tier.

## Amendment 2026-09-29, in force 2026-10-03 — Free, a year at the price of six months, no setup fees, and the price pays for the work (0152 D9–D12)

<!-- The record's text, word for word, then the owner's answers. It was this ADR's Pending
     section until 0152 T6 (d)'s pull request brought it into force; the operative rules above
     now carry it (ADR-0051). -->

**In force 2026-10-03**, with 0152 T6 (d): the operative table, `site/prices.mjs` and
`packages/managed/src/tier-calculator.ts` changed together. Where this amendment and the
*Decision* above disagree (Tiny, the setup fee paid in steps, the top-up at the setup fee, the
break-even against a setup difference, *"No profit" STANDS*), this amendment holds. The text
below is the record as it was accepted, and its *"Status: proposed"* line is part of that record.

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

**Question 1, answered 2026-10-03: (b).** The owner: *"Take b"*. A top-up costs the tier's
monthly price, once. *Tiers buy lanes; top-ups buy room* stays, with its own line on the page and
on the invoice, and the warning at 80% and the hold at the ceiling (*Amendment 2026-10-03*,
above) still offer it beside the step up. Question 2 is still open.

**Accepted 2026-10-03, with question 2 answered (a).** The owner had said *"the pricing model
doesn't have setup costs anymore"*; asked whether that accepts this list, and which answer to
question 2, the owner answered *"a"*. So a year is credit at six months' price: each month takes
its own tier at half its monthly price, finishing paths still lowers what a month costs, and what
is left is refunded on stopping or carried into the next year. **It is not in force yet.** As the
status above says, the operative table changes together with `site/prices.mjs` and the managed
code in 0152 T6 (d)'s pull request, because the price guards read it; until then the operative
rules above are the prices the site quotes, and nothing is charged during the Alpha either way.

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
- **2026-10-03, later** — Every step up is consented and paid for: a data crossing too, by moving
  up or buying a one-off top-up; at the ceiling, new first copies hold until the yes; without
  it, a month bills the tier it was on; and *Start* warns when the preflight will not fit (owner,
  three answers). Record: *Amendment 2026-10-03 —
  every step up is consented and paid for, and the ceiling holds until it is*.
- **2026-10-03, later still** — The pending proposal's question 1 answered: (b), a top-up costs the
  tier's monthly price, once (owner). The proposal is still not in force, and its question 2 is
  open. Its text: *Pending*.
- **2026-10-03, last** — The price list of 2026-09-29 accepted, with its question 2 answered (a): a
  year is credit at six months' price (owner: *"a"*). In force once 0152 T6 (d) builds it. Its
  text: *Pending*.
- **2026-10-03, last** — Not during the alpha (owner: *"A"*): the ceiling warns and nothing holds
  while the stage is `alpha`, and no yes is taken. The yes is built (managed 0037, 0109 T6's first
  slice), the Billing page that asks for it, with the break-even, the hold in the copy loop, and
  the note at *Start*. Record: *Amendment 2026-10-03*.
- **2026-10-03, in force** — The price list of 2026-09-29 comes into force with 0152 T6 (d):
  Free replaces Tiny, no setup fees, a year at six months' price as credit, a top-up at the
  tier's monthly price once, and the price pays for the work. The operative rules carry it; the
  *Pending* bullet and section go, and the section's text stays as *Amendment 2026-09-29, in
  force 2026-10-03*.
- **2026-10-04** — The path axis: one agreed tier for both axes, both ways side by side at
  *Start*, enforced by the server (owner: *"A"*, *"side by side"*, *"Enforced by the server"*); the
  data allowance stays cumulative. The server's check and the question at *Start* are built.
  Data counts in total, for ever, and the alpha's never counts (owner: *"In total for ever, and
  the alpha's data doesn't count"*); the Billing page names what the month bills. Built. Record:
  *Amendment 2026-10-03*.

The full record, word for word as it read before this consolidation:
[history/0014-cost-recovery-billing.md](./history/0014-cost-recovery-billing.md).

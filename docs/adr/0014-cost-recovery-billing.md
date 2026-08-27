# ADR-0014: Cost-recovery billing (no profit) for the managed edition

- **Status:** Accepted 2026-06-20; **amended 2026-08-20** — the model changed from metered
  resources to five tiers on paths running at the same time, and "no profit" no longer
  describes it. Owner decision in conversation; workplan 0088's blocking T1.
- **Date:** 2026-06-20
- **Amends:** the operative rules below, in place (ADR-0038). The 2026-06-20 narrative is kept
  verbatim underneath; everything from "The 2026-08-20 amendment" onward is the new record.
- **Unblocks:** [workplan 0088](../workplans/0088-a-price-you-can-see-before-you-connect.md) T2–T5.

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **A PATH is one kind of thing, from one account, to one account.** Mail, contacts, calendar
  and files are **separate paths** — that is the customer-facing unit and it must be said
  plainly wherever a price appears, because it is the number every tier is counted in. In the
  schema it is one **`scope_selection` row**: `(mapping_id, domain)`, one per domain, created
  with the mapping (`apps/api/src/routes/migrations/index.ts:1421`).
- **A tier has TWO axes, and you are on the higher of them.** How many paths run at the same
  time — Tiny 1 · Small 4 · Medium 20 · Large 50 · XL 200 — and how much data you have moved:
  Tiny 250 GB · Small 750 GB · Medium 2 TB · Large 7.5 TB · XL 15 TB. One path and 400 GB is
  **Small**, because size says so. Past XL on either axis, **talk to us** — that is the one
  place a number is not published, because past the end of the scale we have to actually look.
- **The data axis is CUMULATIVE and it counts each item's FIRST successful copy.** Not a monthly
  allowance: the cost it stands for — the initial copy — is one-off, so a monthly allowance
  would be blown in month one and idle ever after. Re-copies, retries, updates and delta passes
  **do not count**; nobody pays twice for the same item, and a failed pass that runs again does
  not eat the allowance. The meter therefore reads as *"how much of your stuff we have moved"*,
  which is a number the customer can predict before starting — the same number the
  pre-preflight estimates.
- **Running out of room does not have to mean moving up. Pay your setup fee again and your
  allowance grows by another whole band.** Small: €8 buys another 750 GB, on Small, at €4 a
  month. **Tiers buy lanes; top-ups buy room** — and which one someone needs is a question they
  can answer about themselves. Buyable repeatedly, never expiring, never refunded, and it is the
  customer's own tier's fee, so the page gains a mechanism without gaining a price.
- **Implement it as a higher ceiling, never as a reset meter.** Same thing to the customer —
  *"another 750 GB"* — but the counter must stay monotonic or a past invoice stops being
  reconstructible (schema consequence 5). Allowance goes up; the meter is never rewound.
- **At 80%, offer BOTH and show the break-even.** *"You are at 80% of 750 GB. Another 750 GB is
  €8 once and you stay at €4 a month; Medium is €7 now and €8 a month, and gives you 20 paths
  instead of 4."* Topping up costs €1 more up front and saves €4 a month, so it pays back in
  **about a week** — **say that**, and say plainly when the tier is the better buy, which on
  data alone it now almost never is. Taking no profit means having no reason to steer, so we
  do not.
- **Paths fall; data does not — but room is purchasable.** The path axis is elastic and
  downgrades automatically as paths end. The data axis only ever rises, so it sets a **floor**
  under the tier unless the customer buys room instead. Say it on the page in those words:
  *finishing paths lowers your bill; the size of what you moved sets a floor — or top up and
  stay where you are.*
  It is cost-honest — a big account is expensive on every later pass too, not only on the first
  — and it is the reason a ratchet here is not the ratchet this project exists to be the
  opposite of: it is bounded by the tier table, published in advance, and it stops when the last
  path ends.
- **No per-GB line and no compute line appears on any invoice**, and **no "per path per month"
  figure is published either.** The monthly is not rent on a path; it is rent on an envelope
  with two dimensions, which is why a one-path 700 GB account costs more than a one-path 5 GB
  account. Publishing a division invites a question the model does not answer. Self-host stays
  free.
- **Flat within a band; no per-path price inside a tier.** Labour per path is **sublinear** —
  one household is one relationship, one set of credentials, one cutover conversation — so a
  per-path monthly would contradict the reason paths were chosen as the unit at all. The
  linear component is the setup fee, and it is already handled by the step-up rule below.
- **A tier is a CAPACITY — how many paths may run at the same time — not a tally of everything
  ever touched.** A path takes a slot when it is first activated and gives it back when it ends.
  Four states: **`ready`** (configured, connection-tested, proven working, never run — **free,
  and the column default**) → **`active`** (running, holds a slot) → **`paused`** (ran, stopped
  by the owner — **still holds a slot**; it is reserved capacity) → **`cutover`/`done`** (ended;
  the slot is free from that instant). **Never write *concurrent* on a customer surface** —
  write **"at the same time"**.
- **Therefore pausing does not reduce a bill; finishing does.** That is deliberate — a paused
  path holds state and can resume in a second — and it must be said on the pricing page, not
  discovered on an invoice.
- **The month's bill is set by the PEAK: the most paths running at the same time in that
  calendar month.** Simultaneous, not cumulative — eight paths that finish and one that starts
  afterwards is a peak of eight, not nine. Peak rather than a reading taken on the invoice date,
  because a single sample makes the bill turn on an arbitrary instant. The invoice names the
  peak with its date: *"Medium — 6 paths at the same time on 12 August."*
- **The tier is DERIVED from measurement, never picked.** Nobody selects a plan; activating a
  path that crosses a boundary states the new price at that moment and asks. The tier chooser on
  the public page is therefore a **calculator, not a plan selector**, and must read as one.
- **Downgrade is automatic; upgrade is consented.** A calendar month whose peak fits inside a
  lower tier bills at that lower tier — announced in advance through the summary mail, never
  applied retroactively, and never taken as a reason to stop, pause or block a path. If the
  arithmetic is ever wrong it must **under-bill, never halt a migration**.
- **The setup fee is on the HIGHEST tier ever reached, and it is paid in steps.** Each tier
  splits into a one-off setup plus a monthly — Tiny €4 + €2 · Small €8 + €4 · Medium €15 + €8 ·
  Large €50 + €39 · XL €150 + €99. A tier reached on the **data** axis charges its step the same
  way a tier reached on the path axis does. Stepping up later costs the **difference** in setup, once; stepping down
  refunds nothing, because the onboarding was consumed. This makes the total independent of
  whether a customer ramped up or started at full size, so understating gains nothing and
  guessing wrong costs nothing.
- **The fill gauge shows PATHS, not a number.** Each path named, with its state, and finished
  ones carrying the date they ended; the count summarises that list rather than replacing it.
  The words are *"running at the same time"* — **never "used"**, which is what one says about
  something spent and is exactly the cumulative misreading to avoid.
- **The tier boundary is a SERVICE boundary.** Tiny/Small/Medium are self-service — a manual
  and a ticket queue, no phone. Large/XL include real engagement. The price gap follows support, not
  size; that is what makes it explicable.
- **Prices are published in full on the public page.** No "contact sales", no quote-gating.
  Deliberate contrast with the incumbents, and part of the same honesty claim as `SKIPPED`.
- **The data ceiling is a PRICE, not a policy.** Crossing it moves the tier automatically and
  announced, the same way crossing a path ceiling does — never a silent throttle, never a
  surprise invoice — with a warning at 80% that names what the next band costs. Calling that
  "fair use" was a hedge; a number that changes a bill is a price, and saying so is the more
  explicit position, not the harsher one. **A residual fair-use clause remains** for what a
  number cannot express — reselling, pathological churn — and for nothing else.
- **There is no separate "backup" product or price.** Cutover is terminal, so keeping a copy in
  sync is a NEW path with its own initial copy — and it is billed as one. A household that
  finishes eight paths and keeps one running falls to Small the following month, by the
  capacity rule and the automatic downgrade above rather than by a special case. A special case
  would only have hidden the front-loaded cost.
- **Start everything; it falls by itself.** The published advice is to activate all the paths
  at once and let automatic downgrade do the rest as each one cuts over — **not** to ration
  paths to stay inside a band. Tiny exists for people who would rather go one at a time, and it
  is cheaper for them; nobody should be nudged into it by fear of the next tier up.
- **We do not take money from inattention.** A path billing with nothing to show gets a
  periodic, one-click *"keep it or finish it"* through the existing summary mail — and billing
  never runs past **12 months without an explicit re-confirmation**. A product promising "it
  ends when you say" cannot fund itself on people forgetting, which is the pattern its
  customers are leaving.
- **Metering stays INTERNAL.** Bytes and compute are still measured, to check the tiers against
  reality; they simply never reach an invoice. Tiers do not self-correct the way metering does,
  so this is what keeps them honest.
- **"No profit" STANDS.** Large/XL are priced above their own cost precisely to fund
  Small/Medium — that is cross-subsidy inside one cost-recovery envelope, not margin. Owner's
  ruling, 2026-08-20; the title is unchanged.
- EU PSP (Mollie); the machinery lives in `@openmig/managed` (ADR-0036). Public page follows
  [ADR-0029](./0029-public-site-is-server-rendered-and-legible.md) and leads with the free
  preflight.

## Context
The managed service should be sustainable, not profit-seeking.

## Decision
Price the managed edition at **cost recovery**: allocated infrastructure + operations split across tenants. Suggested model: a low flat monthly per tenant for the shared baseline + marginal pass-through for storage/egress, reviewed to stay break-even. The **self-host edition is free** (user runs their own infra). Cost drivers: Trigger.dev (self-host/cloud), managed Postgres, object storage, egress (mostly initial copy), reseller target licensing if any. EU PSP (e.g., Mollie).

## Consequences
- Predictable, fair pricing; no profit margin to defend.
- Metering derived from the ledger; periodic review to stay break-even.

## Alternatives considered
- For-profit pricing: out of scope per project intent.

---

# The 2026-08-20 amendment

## What the competition actually sells

Checked rather than assumed, because the pricing shape below is partly a reaction to it.
Both incumbents' own sites are blocked from this sandbox's egress proxy; the figures come from
search results and third-party listings, so **treat them as indicative and re-check before
quoting them at a customer.**

| | model | price | notes |
|---|---|---|---|
| **BitTitan MigrationWiz** | one-off licence **per user** | ~**$14**/user mailbox; ~**$17.50**/user "User Migration Bundle" (mail + OneDrive/Drive/Dropbox + archives) | licences **expire 12 months** after purchase; volume deals exist |
| **CloudFuze** | subscription | Lite **$9.99/mo** (or $99.99/yr) capped at **50 GB traffic per month**; Business is **custom-quoted**, no published price | 30-day trial, no free tier |

**Three findings matter more than the numbers.**

**1. They sell a copy. We sell a move at your own pace.** A MigrationWiz licence buys a
transfer. Ours runs alongside the old provider for as long as the customer wants, syncing, until
*they* say cut over — and then it is designed to end. That is a different product, and it is why
per-user-one-off is the wrong shape for us even though it is the market's default.

**2. Nobody serves households.** Searching for how a family moves off Gmail and Google Photos to
Europe returns **destinations** — Proton, Tuta, Infomaniak, Mailbox.org, Nextcloud — and lists
comparing them. It does not return a service that *moves you there*. Both incumbents are
admin-facing tools sold to MSPs and IT departments. The segment this project exists for has
somewhere to go and no way to get there.

**3. Migrating off US cloud through a US SaaS is self-defeating**, and the customer who cares
about sovereignty is precisely the one who will notice. BitTitan and CloudFuze are both US
companies, and a migration tool sees everything. That is not a marketing angle; it is the
reason the managed edition can exist at all.

Two smaller ones worth keeping: **licences that expire in 12 months** are a real irritant we
simply do not have, and **CloudFuze's 50 GB/month cap on its published plan** is below what a
single person's photo library needs — our Small ceiling is 750 GB, and cumulative rather than
monthly, so it is a description of the customer's own footprint rather than a monthly gate.

### The limit that decides it: they meter PASSES

Found in BitTitan's own Help Center while trying to answer "how many paths does a licence run
concurrently", and it turns out to be the wrong question — concurrency is a performance setting
(default 100, adjustable down to 1), not a licence limit. The licence limits something else
entirely:

> *"Mailbox migration licenses allow up to **10 successful passes** per mailbox."*
> *"each license will migrate up to **50GB**"*
> *"one license per user being migrated and cannot be applied to multiple users"*

**Ten passes is the finding.** Shadow sync running for three months at a fifteen-minute delta is
thousands of passes. **MigrationWiz is structurally incapable of the thing this product exists
to do** — not because it is badly built, but because it is a different product with a licence
metered on the assumption that a migration is an event. Ours is a period.

That reframes the competitive claim entirely, and it is worth stating in exactly these terms
rather than as a feature list:

- **They sell a copy, metered in passes and capped in gigabytes per user.**
- **We sell a period, priced on two axes we publish: paths at the same time, and total data
  moved.**

It also settles the owner's suspicion that "all other offers seem to have a form of data
limits" — **they do**, and the plain mailbox licence names it at 50 GB. Any "unlimited data"
claim on a regional bundle page therefore needs checking against *which* licence it covers
before it is quoted in a comparison.

**Still unverified, and flagged rather than guessed:** the EU regional pricing at
`get.bittitan.de` (reported by the owner as ~€38/user for 12 months, mail + documents +
archives, "unlimited data"). That domain is blocked by this environment's egress proxy at the
policy level, so it could not be read here. Before any of it appears on our public page,
someone with a browser should confirm: the exact bundle name, whether "unlimited" survives into
the terms, and whether the 10-pass limit applies to it too.

**And the price comparison lands well.** At ~$17.50/user, eight users cost about €128 at
BitTitan for a one-shot copy. Medium here is €63 for six months, up to twenty paths — eight
users with mail, contacts and calendar, plus headroom — with continuous sync throughout. We are cheaper at every tier while selling more, which is a
comfortable place to be — with one caveat recorded in the last section.

## The model, and why it is shaped this way

**Metered bytes were mis-describing the cost.** The old model's egress line was €0.20/GB against
a Hetzner-class transit price near €0.001/GB — roughly a **200× markup**. Not wrong as
economics, since labour is ~90% of the true cost and has to be recovered somewhere. Wrong as
*description*: a labour cost wearing a bandwidth label, on a project whose stated differentiator
is that it tells the truth. A tier price makes no claim about what any component costs, so
there is nothing left to mis-describe. **The problem is dissolved, not patched.**

**And bytes were the wrong proxy anyway.** Mail is item-bound and throttle-bound and is the
largest support surface; calendar is tiny and expensive in edge cases; photos are large and
mechanical. Pricing bytes over-charged a photo-heavy family and under-charged the mail-only
business that costs the most to run. **Paths track labour far better than bytes do** — and
labour per path is *sublinear*, because one business with 25 seats is one relationship, one set
of credentials, one cutover conversation. A tier captures that for free; per-seat pricing
pretends it is 25× the work.

**Compute never belonged on a customer invoice.** It means nothing to a person. What they have
means everything, and the preflight already measures it.

### The tiers

| tier | who | paths at the same time | data moved | setup | monthly | first month | typical total |
|---|---|---|---|---|---|---|---|
| **Tiny** | one person, one thing at a time | 1 | 250 GB | €4 | €2 | €6 | €12 for all four, over four months |
| **Small** | one person, everything at once | 4 | 750 GB | €8 | €4 | €12 | €20 over 3 months |
| **Medium** | a household, a team, or a small business | 20 | 2 TB | €15 | €8 | €23 | €39 (3 mo) · €63 (6 mo) |
| **Large** | an SME | 50 | 7.5 TB | €50 | €39 | €89 | €284 over 6 months |
| **Extra large** | an organisation, or an MSP's first customers | 200 | 15 TB | €150 | €99 | €249 | €744 over 6 months |
| *beyond* | — | >200 | >15 TB | — | — | — | **talk to us** |

**You are on the higher of the two middle columns.** Not the sum, not the average — the higher.

**And the data column is the one you can buy more of.** Paying a tier's setup fee again adds
another whole band of allowance without moving the tier: €8 buys another 750 GB on Small, €15
another 2 TB on Medium. Repeatable, never expiring. *Tiers buy lanes; top-ups buy room.*

The setup column is not a new charge — it is the first-month price named, so that stepping up a
tier later can cost the *difference* rather than the whole thing again. See *"Nobody picks a
tier, so nobody can pick wrong"* below. **Every "typical total" is `setup + monthly × months`,
counting the first month as month one**; that is now checkable against the two columns beside
it, which the earlier draft's totals were not.

**The counts doubled without the prices moving, because the unit got smaller.** The earlier
draft counted an *account pair* and read "one person is typically two source accounts — a mail
account and a file account". Counting the way customers actually think — and the way
`scope_selection` already stores it — that same person is **four** paths: mail, contacts,
calendar, files. So every ceiling is the old one doubled, describing exactly the same customer
at exactly the same price. Small is still one person; Medium is still a household — and now
also a team or a small business, because at twenty paths and 2 TB it fits one as well as the
other, and self-service is what both actually want. **Large is where an SME starts**, which is
the honest reading of a €39 monthly that buys engagement rather than capacity.

Medium is 20 rather than the arithmetic 16, and that is the one deliberate deviation. Four
people with everything is 16, which leaves a household of four with *no* headroom for a fifth
person or a second provider — and Medium → Large is the expensive step, the only steep one on
the page. That step should be crossed by an SME taking on real support, not by a family who
added a Dropbox or a five-person team that outgrew a spreadsheet.

**Tiny is one path, and it is the patient offer.** One person moving mail, then contacts, then
calendar, then files, one at a time, pays €4 once and €2 a month: **€12 for the whole
migration** against €20 for the same person doing all four at once on Small. Patience is
cheaper, impatience costs eight euro, and neither is punished. Its 250 GB ceiling is the one
real constraint — a single 400 GB photo library does not fit, and the data axis then does what
it always does: Small, one step of setup, carry on.

**Why Medium is €8 and not €12.** Google One 2 TB is €9.99/month, and the customer is *leaving*
it while also paying their new European provider. Our fee stacks on top of both. Anything at or
above €10/month makes us more expensive than the thing we are replacing, for a service that is
supposed to end. €8 sits clearly below that line, and it is the binding constraint on this tier.

**Advertise the total, not the monthly.** *"€39 to move your household, over three months"* is a
decision someone makes in a minute. *"€8/month"* is a subscription decision, which is a
different and slower question. Same money. The preflight knows the size, so it can show the
total.

**Small is deliberately near-cost** — €24 barely clears infrastructure. That is correct rather
than regrettable: individuals are the mission's core and its volume, and ADR-0039 already ruled
that the mission outranks the subgoal. Small is funded by Large and XL, not by itself.

**The long tail is Small, and it is thin on purpose.** ADR-0039 named the number that decides
whether this business works: **what fraction of customers keep a path running after cutover.**
That is still the number to measure early — it just lands as a Small subscription at €4 rather
than as a special rate, since the backup row was deleted. Near-zero marginal cost, indefinite
duration; but at €4 it is a contribution to Small's own floor, not the thing that funds it.

### After cutover there is no "continuing" path — so there is no backup price

A first draft of this amendment carried a fifth row, *"keep in sync after cutover"*, priced low
on the reasoning that its marginal cost is near zero. The owner caught the contradiction, and
the code agrees with the owner.

**Cutover is terminal.** `cutover_event` runs its own machine — `PREPARING → READY_FOR_CUTOVER
→ APPROVED → CUTOVER_IN_PROGRESS → GRACE_PERIOD → COMPLETED` — and operations are refused once
a mapping reaches `cutover` or `done` (`apps/api/src/routes/migrations/index.ts:2086`). Once MX
moves, the old provider stops receiving and the old→new path has nothing left to carry. It is
finished, not quiet.

So a backup is **not a continuation**. It is a *new* path — the new provider as source, a third
destination as target — with **its own initial copy**. The bulk is at the front again, exactly
like any other migration. The low price was describing the steady state of a path that had
already done its initial copy, and quietly omitting the copy.

**The fix is a deletion.** A backup path is just a path, billed by the same rule as every other.
A household that finishes eight paths and keeps one running falls from Medium to Small — €4 a
month, *derived* rather than declared, and the question "why is that cheaper?" answers itself:
because there is one path instead of eight. One less concept on the page, one less special case
in the code, and the front-loaded cost stops being hidden.

### Not taking money from inattention

The owner raised the other half honestly: *"a part of the clients will leave it running, forget,
whatever."* That is real revenue, and for this product it is the wrong revenue. A service whose
promise is **"it ends when you say"** cannot fund itself on people failing to say — that is
precisely the pattern its customers are leaving.

**Not auto-cancellation**, though, and the reason matters: **idle is not the same as useless.** A
backup path that copies nothing because nothing changed is working correctly. Cancelling it
would destroy the thing the customer is paying for, and the ledger cannot distinguish "dormant
because finished" from "dormant because nothing happened this month".

So: **ask, don't guess.** Periodically — and through the summary mail that already exists in
`packages/shared/src/notifications.ts` — show the customer their own money: *"This path has
moved nothing since March. You are paying €4 a month for it. Keep it, or finish it?"*, with both
answers one click away. And a firmer commitment worth making because it is cheap and it is the
whole brand: **billing does not continue past twelve months without an explicit
re-confirmation.**

This costs some revenue on purpose. ADR-0039 already settled which way that trade goes.

### What one path is, and why saying so is a marketing requirement

The owner's instruction: *"in the marketing we need to be clear that contact, email, calendar
all are separate migration paths."* That is right, and it turned out to also be a **correction
to this ADR**, which until now counted an account pair.

**The machinery already agrees with the owner, at one grain and not the other.** Creating a
migration writes "one `scope_selection` row per domain"
(`apps/api/src/routes/migrations/index.ts:1421`), and `migration_status` is keyed
`(mapping_id, domain)` with its own `completed_at`. Discovery reports per domain. So *progress*
is already per path in the owner's sense. What is **not** per domain is the billing lifecycle:
`mailbox_mapping.status` and `cutover_state` are per **mapping**, and
`uk_mapping_source_target_prefix` (migration 0022) forbids a second mapping between the same two
accounts, so "one path per object type" cannot be faked with extra mappings either. That gap is
recorded as a schema consequence below, and it is the largest one in this ADR.

Counting this way is also simply how a customer describes their own situation. Nobody says "two
source accounts". They say *"my mail, my contacts, my calendar and my photos"* — four things,
which is four paths, which is what the price should be counted in.

### Should a tier be a band with a per-path price inside it?

Asked by the owner, on the reasonable observation that the step-up rule already prices movement
*between* tiers continuously, so why not price movement *within* one the same way. **No, and the
reason is in this ADR two sections up.**

Labour per path is **sublinear**. That is the argument that chose paths over bytes and over
seats in the first place: one household is one relationship, one set of credentials, one cutover
conversation, whether it is six paths or sixteen. A per-path monthly asserts the opposite — that
the sixteenth path costs what the first did — which is the same false claim per-GB was making,
just wearing a better unit. And a *decreasing* per-path price, the honest version of a staffel,
produces inversions where adding a path lowers the bill.

The linear cost is real, though, and it is the **setup**: each path is its own initial copy, its
own verify, its own cutover. That is exactly what the step-up fee already charges, and it is why
setup is the component that moves and the monthly is the component that is flat.

**What the question does expose is a genuine defect: the cliffs.** Under flat bands, crossing a
ceiling multiplies the bill. Tiny → Small doubles €2 to €4, Small → Medium doubles €4 to €8 —
both gentle. **Medium → Large is €8 to €39, five times**, and that one is only defensible because
it is the *service* boundary this ADR already names: Large buys engagement, not just capacity.
The fix is therefore not a staffel but a ceiling in the right place — hence Medium at 20 rather
than 16, so that a household growing a little does not fall off a service cliff it did not ask
to cross.

### The data ceiling was never fair use. It is the second axis of the price

The owner's question — *"so the number of GB does bump the tier?"* — has one answer, **yes**, and
finding that out exposed a hedge in this ADR. The ceilings were described as *"a data ceiling
that exists as fair use"*, with the remedy *"we talk to you and move you a tier"*. But a number
that moves a tier moves a bill, and a thing that moves a bill is a **price**, not a policy.
Calling it fair use made it sound softer while making it less predictable, which is the wrong
trade in both directions.

So: **a tier has two axes and you are on the higher of them.** Paths running at the same time,
and data moved. The owner's own example is the clean case — one path, 400 GB: the path axis says
Tiny, the data axis says Small, and Small wins. They pay the €4 step-up in setup once and carry
on with their one large files path.

**A residual fair-use clause still earns its place**, but a much smaller one: reselling,
pathological churn, the things a number cannot express. Everything a number *can* express is now
a published price.

### Per path per month is the wrong division

Follow-up from the owner, and it is the question a customer will ask next: if that 400 GB
customer is on Small with one path, what did their path cost per month? €4, where a Tiny
customer's path costs €2. Double, for the same one path.

**The division is the mistake, not the answer.** The monthly is not rent on a path. It is rent
on an envelope with two dimensions, and the data dimension is exactly what separates those two
customers: a 700 GB account is more expensive than a 5 GB account on every pass, not only on the
first — more items to enumerate, more to verify, more ledger to carry. The one-path 700 GB
customer is not being charged for a second path they do not have; they are being charged for
size, which they do have.

Arithmetic makes the point badly if published. At full fill the monthly per path runs €2.00 ·
€1.00 · €0.40 · €0.78 · €0.50 — **not monotonic**, because Medium → Large is a service boundary
rather than a capacity one, and Large buys engagement. A published per-path figure would invite
exactly that question and then answer it wrongly. **So no per-path figure is published**, which
is now an operative rule.

### Cumulative, not monthly — and only the first copy

The owner's instinct, and it is right for a reason worth writing down: **the cost the ceiling
stands for is one-off.** This service does not warehouse anyone's data; it reads from a source
and writes to a target. The dominant real cost is bytes moved — transit and the compute that
moves them — and that is spent once, on the initial copy. A monthly allowance would be blown in
month one and idle in every month after, which describes no cost anyone has.

Cumulative also produces a number the customer can *predict*. "You have moved 380 GB of 750 GB"
is a fact about their own footprint, not a usage bill — and it is the same number the
pre-preflight already estimates from their own provider's storage page. A monthly meter would
match nothing the calculator can show them before they connect.

**And it counts each item's first successful copy only.** Re-copies, retries, updates and delta
passes do not count. Three things follow, all of them good: nobody pays twice for the same item;
a failed pass that runs again does not eat the allowance, so the meter never punishes our own
bugs; and a long-lived sync path stops accumulating once it has caught up, which removes the
ratchet that would otherwise creep up on a customer whose actual monthly usage is a few
megabytes of deltas.

**The asymmetry this creates has to be said out loud.** Paths fall; data does not. Automatic
downgrade can lower a bill only as far as the data axis allows, so the size of what someone moved
sets a **floor** under their tier — unless they buy room instead, which is what the next section
is for. That is defensible — the account stays expensive — but it is
the kind of thing that must appear on the pricing page rather than on the seventh invoice:
*finishing paths lowers your bill; the size of what you moved sets a floor.* It is bounded by
the published table, it is announced before it happens, and it stops entirely when the last path
ends, because cutover is terminal and billing ends with it.

### Tiers buy lanes; top-ups buy room

The owner's proposal: let a customer pay a tier's one-off fee again and get the data allowance
back, or another band's worth on top. **Adopted**, and it repairs the weakest joint in the model.

The ratchet was justified two sections up on the grounds that a large account stays expensive on
every later pass. That is true **while its paths are still running** and false once they have cut
over — and the ratchet does not know the difference. A customer who moved 700 GB, finished, and
now wants to move another 400 GB would cross to Medium and pay double the monthly **forever**,
for work that is one-off. The top-up is the honest answer to that, and it is honest precisely
because bytes are a one-off cost: **a one-off cost should be buyable with a one-off payment.**

**The choice it creates is a real one, not a trick.** Crossing to Medium costs €7 now and €8 a
month, and gives 20 paths. Topping up Small costs €8 now, keeps €4 a month, and gives no extra
paths. So: €1 more up front, €4 a month less — **break-even at about a week.**

Which has a consequence worth stating rather than discovering: **at these prices the top-up
almost always wins on data alone.** The same holds one rung up — topping up Medium is both
cheaper on the day and €31 a month cheaper than crossing to Large. So in practice the data axis
stops moving anyone's tier and becomes a prompt to buy room, while **the tier moves for lanes.**
That is a simplification rather than a defect: work is priced as work, capacity as capacity, and
the two stop interfering. But it means the published guidance is *"cross when you need more
paths"*, not *"cross when you run out of room"*, and the page should say so in those words.

**Raise the ceiling; never reset the meter.** To the customer these are the same sentence —
*"another 750 GB"* — but schema consequence 5 requires the byte counter to be append-only, and a
counter that gets rewound on payment cannot reconstruct a past invoice. So the allowance is a sum
of granted bands and the meter is monotonic. Identical experience, one of them auditable.

**A sanity check on the price, since a top-up is the closest thing left to a byte price.** Per
gigabyte the bands come to €0.0160 (Tiny) · €0.0107 (Small) · €0.0075 (Medium) · €0.0067 (Large)
· €0.0100 (XL). Against a Hetzner-class transit price of about €0.001/GB that is **6.7× to 16×**
— the right order for cost recovery that also has to carry compute and a share of support, and
**twelve to thirty times cheaper** than the €0.20/GB egress line this ADR replaced, whose ~200×
markup was finding 1 of the amendment.

The shape is now the right one: **the block gets cheaper per gigabyte the bigger it is**, from
€0.0160 down to €0.0067, which is what a volume ladder should do. **XL is the exception**,
stepping back up to €0.0100, and the reason is the same one that makes any of this wobble at all
— setup fees carry onboarding labour, not only bytes, and XL doubles Large's data for three times
Large's setup because an organisation costs more to onboard than a business does. The whole
spread is a factor of 2.4. Small enough to accept; recorded to re-check when there is real usage
to check it against.

**This does not reintroduce metered pricing.** The banned thing was a per-GB line item appearing
on every invoice, recovering labour under a bandwidth name, making bills unpredictable. A top-up
is opt-in, priced in advance, bought in one chunk, and appears on an invoice only when someone
chose to buy one. It is a purchase, not a meter.

### Why Small moved to 750 GB, and why the top of the scale is a conversation

Small is *one person, everything at once*, and workplan 0088's own profile table puts that person
at roughly 100 GB. 500 GB was already five times that. The reason to go to 750 is the shape of
the ladder rather than the typical case: 250 → 500 → 1500 steps ×2 then ×3, and the ×3 lands
exactly where consumer storage plans cluster. Somebody on a 2 TB Google One that is a third full
is a **single person doing a single-person migration**, and pushing them to Medium at twice the
monthly for that is the wrong answer. At 750 the ladder reads 250 → 750 → 2 TB → 7.5 TB → 15 TB,
and the marginal cost of the extra 250 GB is around €0.25 of transit — cheap enough that
generosity here is not a subsidy worth defending.

**Past XL, talk to us.** This is the single exception to *"prices are published in full, no
contact sales"*, and it does not contradict it: everything **on** the scale is published, and the
exception is for what is off the end of it. Beyond 200 paths or 15 TB the honest position is that
we have to look at the actual case before quoting, and saying that is more truthful than
publishing a number we would not stand behind.

### A tier is a capacity, not a tally

The first draft of this amendment carried a contradiction the owner caught. Deleting the backup
row rests on *"finish eight, keep one, fall to Small"* — which only works if a finished path
gives its slot back. But the lifecycle rule as first written said a path *"counts in the period
it ended, then stops"*, and the preflight gauge said *"4 of 8 used"*. Those describe a tally of
everything ever touched. **A tally and a capacity produce different bills, and only one of them
can be the rule.**

**It is a capacity**, and not merely because the backup argument needs it. It is what the tier is
*for*. Path count is not a cost proxy — bytes and compute are, and the fair-use ceiling already
bounds those. Path count is a proxy for how much of the system is occupied at once and how much
support surface that implies, which is inherently a simultaneity quantity. Under capacity,
*"pausing does not reduce a bill"* stops being an assertion and acquires a reason: **a paused
path is reserved capacity; a finished path is released capacity.**

Capacity also disposes of a worry a tally would have forced us to defend against, and disposes of
it better than a tally would. Somebody running two paths at a time, forty over a month, stays on
Small — and crosses the 750 GB data axis long before that becomes interesting, which moves the
tier by itself. **The data axis is what bounds volume. The path count does not need to be, and
should not try**, because the moment it does the cutover month goes absurd: eight finished paths plus one new sync path bills
Large in the month the customer *stopped migrating*.

**Peak, not a sample.** Within a calendar month the billed number is the most paths running at
the same time — simultaneous, so eight-then-one is a peak of eight. The alternative, reading the
count on the invoice date, makes the bill turn on an arbitrary instant: two identical households,
one finishes on the 30th and pays Small, the other finishes on the 2nd and pays Medium. That
reads as a lottery, and it reads as unfair in both directions. Peak costs one extra sentence of
explanation and removes the arbitrariness entirely.

**Will anyone understand it?** The concept, yes — the vocabulary, no, so the vocabulary is
forbidden. Never *"concurrent"*; always *"at the same time"*, which needs no definition. Three
things carry the understanding, and the gauge as first imagined carried none of them:

- **Show paths, not a number.** *"2 of 8 used"* is precisely the phrasing that creates the
  misreading, because *used* is what one says about something spent. A list — each path named,
  with its state, finished ones dated — makes the model self-evident with no explanation at all.
  The number summarises the list; it does not replace it.
- **Say what frees a slot at the moment it frees.** When a path reaches `done`, the row says so
  and the count visibly drops. If the drop happens silently at some later reconciliation, people
  build the tally model in their heads and the explanation has already lost.
- **Put the peak on the invoice with its date.** *"Medium — 6 paths at the same time on
  12 August"* answers the only question the peak rule provokes, before it is asked.

One case stays genuinely awkward whatever the copy says: finish everything on the 3rd and the
invoice for that month is still Medium. That is unavoidable under any period-based scheme. The
honest handling is the invoice line above, plus the fact that next month is €4.

### Automatic downgrade, because the alternative contradicts a rule we already wrote

Downgrade is automatic. It is barely a decision, because *"we do not take money from
inattention"* is already an operative rule one section up — and a customer sitting on Medium
while running one path **is** inattention. Charging for it would make that rule decorative. The
supporting reasons are shorter: under "no profit" there is no revenue interest in the higher
tier; the backup-price deletion is unsound without it; and it is the cheapest thing here to
build, since occupancy is already computed for the gauge and the comparison is one line.

Three guardrails, each load-bearing:

- **Announced before it happens, never after.** The summary mail already carries the *"keep it
  or finish it"* prompt; *"next month you are on Small, €4"* belongs in the same mail. A bill
  going down is never a complaint, but capacity quietly shrinking can be — somebody planning to
  start three paths next week deserves the warning.
- **A downgrade never stops, pauses or blocks a path.** Downgrade only when the peak fits
  strictly inside the lower tier, and if the arithmetic is ever wrong the failure mode must be
  *"we billed too little"*, never *"we halted a migration"*.
- **Upgrade is the opposite: immediate, on the customer's own action, with the price stated at
  the moment they activate the path that crosses the line.** Downgrade automatic, upgrade
  consented. That asymmetry is the same one as *"no billing past twelve months without explicit
  re-confirmation"*, and it is the whole ethic of this section.

### Nobody picks a tier, so nobody can pick wrong

The owner asked the sharp question about the first-month fee: if a customer does not yet know how
many paths they need, one who guesses high pays a bigger head fee and is then downgraded, while
another with identical usage who guesses precisely pays less. Should the head fee be flat across
tiers instead?

**The premise dissolves under the capacity model: there is no guess, because there is no pick.**
The tier is derived from what was measured. Set up eight paths, run two at a time, and the peak
is two — month one bills Small. The tier chooser on the public page is a **calculator, not a plan
selector**, and that must be obvious from how it reads, because every other SaaS trains people to
expect the opposite.

That kills the mis-pick penalty. It does not kill the **ramp** penalty, which is the same
unfairness in different clothes: activate two in month one (Small's €12 head), six in month two
(Medium's €8 monthly, no head) — €12 of head fee, against €23 for somebody who honestly started
all eight at once. Identical work, different price, and the difference **rewards staggering your
activations for billing reasons**. This project should not ship that.

**So the head fee becomes a setup fee on the highest tier ever reached, paid in steps.** Each
tier splits into its two real components — Tiny €4 + €2/mo, Small €8 + €4, Medium €15 + €8,
Large €50 + €39, XL €150 + €99 — and stepping up costs the *difference* in setup, once. Small →
Medium later is €7.

Check it against the ramp: staggered pays €8 then €7 = **€15**. Direct-to-Medium pays **€15**.
Identical. The setup total depends only on the highest tier ever reached and not at all on when
it was reached, so understating gains nothing, and the downgrade-then-upgrade trap cannot exist
because the high-water is already paid. Stepping down refunds nothing, which is correct rather
than mean: eight initial copies happened, and the onboarding was consumed.

**Not a flat fee across tiers**, the owner's other option: an XL onboarding is genuinely around
twenty times a Small one, so a flat fee would have Small subsidising XL — backwards from the
cross-subsidy ruling. **Not a per-path activation fee** either, though it is the most precise: it
reintroduces the per-unit meter this amendment exists to remove, and makes the price
unpredictable before you connect, which is the one thing workplan 0088 is named after.

### The path lifecycle, and why the schema cannot express it yet

A path is only ever billed for having **run**, and it occupies a slot only while it is unfinished.
Four states, decided by the owner 2026-08-20:

| state | meaning | holds a slot |
|---|---|---|
| **`ready`** | configured, connection-tested, proven working — **never run** | **no** — and this is the column default |
| **`active`** | running | yes |
| **`paused`** | ran, then stopped by the owner | **yes** — it holds state and resumes in a second; it is reserved capacity |
| **`cutover` / `done`** | ended, having run | **no** — released from that instant; it still contributes to the month's peak if it was running during it |

So **pausing does not reduce a bill; finishing does.** Deliberate, and it belongs on the
pricing page rather than on an invoice.

The reason `ready` has to exist as its own state is exactly the billing rule: today `paused`
means *both* "never started" (new mappings land paused so the owner can review discovery counts
first — `apps/api/src/routes/migrations/index.ts:1395`) *and* would mean "was running, stopped".
Those two must be told apart, because one is free and one is not. **A billing key cannot be
built on a status that conflates the free case with the charged one.**

**Five schema consequences follow. None is solved here.**

**1. The column default is the wrong way round for a billing key.** The definition is

```sql
status text DEFAULT 'active'::text NOT NULL
```

The API is careful and sets `paused` explicitly, so nothing is wrong today. But the *column*
defaults to the charged state, which means any insert that omits it — a future code path, a
data import, a test fixture, a backfill in a migration — starts billing that customer
immediately, silently, and correctly as far as the database is concerned. **A billing key's
default must be the free state, so that forgetting it costs nothing.** Default becomes `ready`,
which also requires adding `ready` to `item_status`-style CHECK on `mailbox_mapping.status`
(today: `active`, `paused`, `cutover`, `done`).

**2. Nothing records that a path ever ran.** There is no `activated_at` on the mapping, and no
status-change history for it; `audit_log` exists but whether it captures mapping transitions is
**unverified**. Without it the rule above cannot be evaluated at all — "has this ever been
active" is unanswerable from a row that currently says `paused` — and an invoice cannot be
reconstructed or defended afterwards. The minimal fix is one column, **`first_activated_at
timestamptz`, set on the first `ready → active` transition and never cleared**: it answers "did
this ever run" permanently, survives any number of pause/resume cycles, and is auditable.

**3. Peak occupancy cannot be reconstructed from current state.** `first_activated_at` answers
*"did this ever run"*; the peak rule additionally needs *"when did it stop"* — an `ended_at`
set on the transition into `cutover`/`done` — and, because a peak is a property of an interval
rather than of a row, **a per-tenant per-month high-water record**: the month, the peak count,
the timestamp at which it occurred, and the tier it implied. Recomputing a past month by
replaying history is fragile and gets less reliable the longer the account lives; an invoice
this project stands behind has to be reconstructible in one read. That is one small table, and
it is the same data the automatic downgrade compares against and the honesty surface wants to
display.

**4. The billing unit and the lifecycle are at different grains — and this one blocks the
pricing model, not just the invoice.** A path is `(mapping_id, domain)`; `scope_selection` and
`migration_status` are already keyed that way. But `mailbox_mapping.status` — the column
carrying `active`/`paused`/`cutover`/`done` — is per **mapping**, and so is `cutover_state` with
its `PREPARING → … → COMPLETED` machine. **So a customer cannot today cut over mail while
calendar keeps running**, which is precisely the behaviour the tier model is built on: paths end
one at a time, slots free one at a time, the tier falls by itself. Nor can it be worked around
with one mapping per domain, because `uk_mapping_source_target_prefix` (migration 0022) refuses a
second mapping between the same two accounts.

Making the lifecycle per-path is therefore a **prerequisite for the pricing model**, not a
refinement of it: `active`/`paused`/`cutover`/`done` (plus `ready`, and `first_activated_at` /
`ended_at`) belong on the `scope_selection` row or on a sibling table at that grain, with
`cutover_state` following. Until it exists, the honest position is that the tiers describe what
the service will do, and Tiny — one path at a time — is the tier that depends on it most.

**5. The byte meter needs a counter, and what exists is a sum over live rows.** `item.size_bytes`
is populated by the sync path (`packages/core/src/domain-sync.ts`, `dav-sync.ts`), and
`packages/ledger/src/migration-status-store.ts:182` already sums it. That sum cannot be the
billing meter, for two reasons and one caveat:

- It sums **current** rows, so it is not monotonic. An item that was copied and later
  `tombstoned` leaves the sum, and a cumulative ceiling that can go *down* is not cumulative.
  The meter has to be an append-only counter written at the transition into `copied` — one row
  per period, or a single running total per tenant — not a `SUM` recomputed from state.
- It includes `'skipped'`, which by definition transferred nothing. Correct for a
  "how far along are we" display, wrong for a byte meter, and the two must not share a query.
- The **allowance** is a second quantity beside the counter: a sum of granted bands (the tier's
  own, plus each top-up bought), append-only like the counter, so that "you have moved 380 GB of
  1,500 GB" is two auditable numbers rather than one derived from a mutable tier. A top-up adds
  a row; nothing is ever rewound.
- `size_bytes` is **nullable**, and whether every domain populates it is unverified. A ceiling
  measured with silent nulls under-counts, which is the safe direction but still a lie. The
  coverage should be asserted per domain before the number reaches an invoice — the same
  discipline as ADR-0029's `SKIPPED`: an unmeasured thing is stated, not assumed to be zero.

### Fair use, written the way this project writes things

*(Superseded in part by "The data ceiling was never fair use" below — the ceilings became a
price axis. What survives is the tone, and the small clause that remains.)*

The ceiling replaces the per-GB pass-through, so it has to exist. What it must not be is the
usual *"we reserve the right to limit excessive use"* — that sentence is the opposite of this
product's entire posture. Written honestly it says the real number per tier, warns at 80%
because the ledger can see it coming, and says plainly what it is for — *"so that one unusual
customer does not set the price for everyone else."*

What changed in the later round is the **remedy**. "We talk to you and move you a tier" is a
conversation where a price belongs: crossing a published number moves the tier automatically and
announced, exactly as crossing a path ceiling does. The residual clause — for reselling and
pathological churn, the things a number cannot express — keeps this section's tone and none of
its vagueness.

## The public page

Extends [ADR-0029](./0029-public-site-is-server-rendered-and-legible.md), which already settled
the mechanics: server-rendered semantic HTML, content readable without JavaScript, `llms.txt`,
`robots.txt` welcoming assistants on marketing pages and excluding the app. This adds what the
page should *say*.

**The order, which is an argument rather than a layout:**

1. **One sentence** naming what it does and for whom — *"Move your mail, calendar, contacts,
   files and photos from Google, Microsoft or Dropbox to a European provider. At your own pace."*
2. **The free preflight, as the first action.** No account, no email gate. It connects your
   source read-only and shows what you actually have — counts, size, and what it would cost.
   This is the differentiator made operable: everyone else asks you to book a demo.
3. **"At your own pace" explained in three lines**, because it is the product and it is unusual:
   it runs alongside your old provider for as long as you want; you decide when to switch; then
   it stops — or keeps one copy in sync if you'd rather.
4. **What a path is, before any price is shown.** *"Your mail, your contacts, your calendar and
   your files are four separate paths."* The tiers are counted in paths, so a visitor who has
   not understood this has not understood any number underneath it. Show it as the four things,
   named, with the count adding up in front of them — not as a definition in prose.
5. **Both axes, side by side, and the word "higher".** *"How many at the same time, and how much
   in total — you are on the higher of the two."* Two columns in one table, never two tables,
   because two tables read as two bills. And the floor sentence with it: *finishing paths lowers
   your bill; the size of what you moved sets a floor — or top up and stay where you are.* No
   per-path-per-month figure anywhere.
6. **Tiers buy lanes; top-ups buy room.** One line, with the two prices beside each other and
   the break-even said out loud, because this is the only place on the page a visitor has a
   genuine choice to make and the only place we could profit from making it badly.
7. **The prices, in full, on the page.** All five tiers, with the setup and the monthly shown
   separately and the step-up rule stated, plus the sentence that finishing paths lowers the
   bill by itself. And the advice stated outright, because the natural fear is of the tier
   above: **start everything at once — as each thing finishes, the bill falls on its own.**
   Tiny is offered as the patient alternative for someone who would rather go one at a time,
   never as the way to avoid a tier. CloudFuze
   quote-gates its business plan; publishing is both a real contrast and the same honesty claim
   the product makes about its own reports.
8. **What we do not do** — the honest limits, on the page rather than discovered later:
   `SKIPPED` means nobody checked; adopted files are not ours to delete; some things cannot be
   moved and we will name them before you pay.
9. **Self-host**, prominent, not hidden: Apache-2.0, run it yourself, we would rather you moved
   than that you paid us (ADR-0039's mission test, stated where customers can see it).

**Tone: numbers, not adjectives.** No "seamless", no "effortless", no "enterprise-grade". The
page that matches this product says *"66 of 66 files matched, 10 checksums verified"* where
another would say *"trusted by thousands"*. An assistant summarising us as "one-click, migrates
everything automatically" has misdescribed the exact property that makes us trustworthy —
ADR-0029 made that point about crawlers, and it applies just as much to the human reader.

## Alternatives considered in this amendment

**A start fee plus a monthly metered on the number or size of objects, capped at a maximum.**
Raised by the owner and rejected, for two reasons. It **reintroduces the per-unit line this
amendment exists to remove** — a meter is a claim about what something costs, and that claim was
the original candour problem. And the cap becomes the number everyone reads anyway, so the model
is a tier wearing a meter's clothes: all of the explanation cost, none of the simplicity.

There is also a plainer objection. **A path is countable by the person paying** — "four
mailboxes and a Dropbox" — and an object count is not. The tier ceilings already carry the size
dimension, so the model has both axes; a third meter would be a step backwards, not a
refinement.

**Counting paths cumulatively over the billing period, so a slot never returns.** Rejected: it
makes the cutover month bill *higher* than the months of actual migrating (eight finished plus
one sync path = nine), it contradicts the backup-row deletion, and the only thing it buys is
protection against slot churn — which fair use already provides, better and more honestly.

**A monthly data allowance instead of a cumulative one.** Rejected: the cost the ceiling stands
for is the initial copy, which is spent once. A monthly allowance is blown in month one and idle
in every month after, it matches no cost anyone has, and it cannot be predicted from the one
number a visitor can look up before connecting — the size of their own account.

**Counting every byte moved, including re-copies and deltas.** Rejected: it charges twice for the
same item, it makes our own retries eat a customer's allowance, and it turns a long-lived sync
path into a slow ratchet on somebody whose real usage is megabytes of deltas a month.

**A per-path price inside each tier — a band plus a rate.** Rejected in its own section above:
labour per path is sublinear, so a flat per-path monthly asserts something false, and a
decreasing one inverts. The cliff it was meant to solve is real and is solved by putting the
ceiling in the right place instead.

**A single flat setup fee across all tiers.** Rejected: an XL onboarding is roughly twenty times
a Small one, so a flat fee has Small subsidising XL, which is backwards from the cross-subsidy
this ADR rests on. The high-water step fee gets the same
guess-proofness without inverting who funds whom.

**Automatic cancellation of an idle path, instead of automatic downgrade.** Rejected in the
section above and repeated here because it is the tempting one: **idle is not useless.** A backup
path that copies nothing because nothing changed is working correctly, and the ledger cannot tell
"dormant because finished" from "dormant because nothing happened".

## What this amendment does NOT decide

- **The wording change is flagged, not slipped through.** This ADR's title still says "no
  profit". The tier prices mean Large/XL earn more than they cost, funding Small/Medium and the
  operator's time. That is cross-subsidy rather than profit-seeking, but it is not what the
  original sentence meant, and the owner should confirm the retitling rather than have it
  arrive as a side effect.
- **Whether being cheaper than BitTitan at every tier is a problem.** For households it is
  simply right. For a business buyer, a price an order of magnitude under the consultancy
  alternative can read as *unserious* rather than *good value*. Worth watching; not worth
  pre-emptively inflating.
- **The competitor figures are indicative.** Both vendors' sites were unreachable from here.
  Re-check before either is quoted publicly or used in a comparison table on the page.
- **The prices assume Small and Medium really are self-service.** If a household needs a phone
  call, the arithmetic collapses — that is what made the *old* model unsustainable, where family
  onboarding was ~71% of all hours. Which means this decision and workplan 0088's calculator are
  not two projects but one: the manual, the preflight and the error messages have to be good
  enough that nobody needs you.

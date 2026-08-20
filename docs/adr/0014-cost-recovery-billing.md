# ADR-0014: Cost-recovery billing (no profit) for the managed edition

- **Status:** Accepted 2026-06-20; **amended 2026-08-20** — the model changed from metered
  resources to four tiers on active paths, and "no profit" no longer describes it. Owner
  decision in conversation; workplan 0088's blocking T1.
- **Date:** 2026-06-20
- **Amends:** the operative rules below, in place (ADR-0038). The 2026-06-20 narrative is kept
  verbatim underneath; everything from "The 2026-08-20 amendment" onward is the new record.
- **Unblocks:** [workplan 0088](../workplans/0088-a-price-you-can-see-before-you-connect.md) T2–T5.

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **Four tiers on PATHS RUNNING AT THE SAME TIME, not metered bytes.** Small ≤2 · Medium ≤8 ·
  Large ≤25 · Extra large ≤100, each with a data ceiling that exists as fair use. **No per-GB line and no
  compute line appears on any invoice.** Self-host stays free.
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
  splits into a one-off setup plus a monthly — Small €8 + €4 · Medium €11 + €8 · Large €60 + €39
  · XL €150 + €99. Stepping up later costs the **difference** in setup, once; stepping down
  refunds nothing, because the onboarding was consumed. This makes the total independent of
  whether a customer ramped up or started at full size, so understating gains nothing and
  guessing wrong costs nothing.
- **The fill gauge shows PATHS, not a number.** Each path named, with its state, and finished
  ones carrying the date they ended; the count summarises that list rather than replacing it.
  The words are *"running at the same time"* — **never "used"**, which is what one says about
  something spent and is exactly the cumulative misreading to avoid.
- **The tier boundary is a SERVICE boundary.** Small/Medium are self-service — a manual and a
  ticket queue, no phone. Large/XL include real engagement. The price gap follows support, not
  size; that is what makes it explicable.
- **Prices are published in full on the public page.** No "contact sales", no quote-gating.
  Deliberate contrast with the incumbents, and part of the same honesty claim as `SKIPPED`.
- **Fair use states numbers and a named remedy**: pass the ceiling and we talk to you and move
  you a tier — never a silent throttle, never a surprise invoice — with a warning at 80%, which
  the ledger can see coming.
- **There is no separate "backup" product or price.** Cutover is terminal, so keeping a copy in
  sync is a NEW path with its own initial copy — and it is billed as one. A household that
  finishes eight paths and keeps one running falls to Small the following month, by the
  capacity rule and the automatic downgrade above rather than by a special case. A special case
  would only have hidden the front-loaded cost.
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
single person's photo library needs — our Small ceiling is 500 GB.

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
- **We sell a period, metered in paths and bounded only by fair use.**

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
BitTitan for a one-shot copy. Medium here is €67 for six months, up to eight paths, with
continuous sync throughout. We are cheaper at every tier while selling more, which is a
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

| tier | who | paths at the same time | ceiling | setup | monthly | first month | typical total |
|---|---|---|---|---|---|---|---|
| **Small** | one person | 2 | 500 GB | €8 | €4 | €12 | €24 over 3 months |
| **Medium** | a household | 8 | 1.5 TB | €11 | €8 | €19 | €43 (3 mo) · €67 (6 mo) |
| **Large** | a small business | 25 | 4 TB | €60 | €39 | €99 | €294 over 6 months |
| **Extra large** | an organisation, or an MSP's first customers | 100 | 15 TB | €150 | €99 | €249 | €744 over 6 months |

The setup column is not a new charge — it is the first-month price named, so that stepping up a
tier later can cost the *difference* rather than the whole thing again. See *"Nobody picks a
tier, so nobody can pick wrong"* below.

Small at two paths because one person is typically two source accounts — a mail account and a
file account. Medium at eight because that is four people with two each.

**Why Medium is €8 and not €12.** Google One 2 TB is €9.99/month, and the customer is *leaving*
it while also paying their new European provider. Our fee stacks on top of both. Anything at or
above €10/month makes us more expensive than the thing we are replacing, for a service that is
supposed to end. €8 sits clearly below that line, and it is the binding constraint on this tier.

**Advertise the total, not the monthly.** *"€43 to move your household, over three months"* is a
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
a mapping reaches `cutover` or `done` (`apps/api/src/routes/migrations/index.ts:2009`). Once MX
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
Small — and hits the 500 GB ceiling long before that becomes interesting. **Fair use is the
anti-abuse mechanism. The path count does not need to be one, and should not try**, because the
moment it does the cutover month goes absurd: eight finished paths plus one new sync path bills
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
(Medium's €8 monthly, no head) — €12 of head fee, against €19 for somebody who honestly started
all eight at once. Identical work, different price, and the difference **rewards staggering your
activations for billing reasons**. This project should not ship that.

**So the head fee becomes a setup fee on the highest tier ever reached, paid in steps.** Each
tier splits into its two real components — Small €8 + €4/mo, Medium €11 + €8, Large €60 + €39, XL
€150 + €99 — and stepping up costs the *difference* in setup, once. Small → Medium later is €3.

Check it against the ramp: staggered pays €8 then €3 = **€11**. Direct-to-Medium pays **€11**.
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
first — `apps/api/src/routes/migrations/index.ts:1329`) *and* would mean "was running, stopped".
Those two must be told apart, because one is free and one is not. **A billing key cannot be
built on a status that conflates the free case with the charged one.**

**Three schema consequences follow. None is solved here.**

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

### Fair use, written the way this project writes things

The ceiling replaces the per-GB pass-through, so it has to exist. What it must not be is the
usual *"we reserve the right to limit excessive use"* — that sentence is the opposite of this
product's entire posture. Written honestly it says: the real number per tier; that passing it
means **we talk to you and move you a tier**, never a silent throttle and never a surprise
invoice; that we warn at 80%, because the ledger can see it coming; and plainly what it is for —
*"so that one unusual customer does not set the price for everyone else."* That last sentence is
true, and saying it is cheaper than pretending the limit is technical.

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
4. **The prices, in full, on the page.** All four tiers, with the setup and the monthly shown
   separately and the step-up rule stated, plus the sentence that finishing paths lowers the
   bill by itself. CloudFuze
   quote-gates its business plan; publishing is both a real contrast and the same honesty claim
   the product makes about its own reports.
5. **What we do not do** — the honest limits, on the page rather than discovered later:
   `SKIPPED` means nobody checked; adopted files are not ours to delete; some things cannot be
   moved and we will name them before you pay.
6. **Self-host**, prominent, not hidden: Apache-2.0, run it yourself, we would rather you moved
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

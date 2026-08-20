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

- **Four tiers on ACTIVE PATHS, not metered bytes.** Small ≤2 · Medium ≤8 · Large ≤25 ·
  Extra large ≤100, each with a data ceiling that exists as fair use. **No per-GB line and no
  compute line appears on any invoice.** Self-host stays free.
- **A path bills once it has RUN, and keeps counting until it ends.** Four states, and the
  distinction between the first two is the whole billing rule: **`ready`** (configured,
  connection-tested, proven working, never run — **free, and the column default**) → **`active`**
  (running) → **`paused`** (ran, stopped by the owner — **still counts**; it is reserved
  capacity) → **`cutover`/`done`** (counts in the period it ended, then stops). The preflight
  shows the count against the ceiling ("4 of 8") so nobody crosses a boundary blind.
- **Therefore pausing does not reduce a bill; finishing does.** That is deliberate — a paused
  path holds state and can resume in a second — and it must be said on the pricing page, not
  discovered on an invoice.
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
  finishes eight paths and keeps one running simply falls to Small. The tier rule already
  produces the right answer; a special case would only have hidden the front-loaded cost.
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

| tier | who | active paths | ceiling | first month | then | typical total |
|---|---|---|---|---|---|---|
| **Small** | one person | 2 | 500 GB | €12 | €4/mo | €24 over 3 months |
| **Medium** | a household | 8 | 1.5 TB | €19 | €8/mo | €43 (3 mo) · €67 (6 mo) |
| **Large** | a small business | 25 | 4 TB | €99 | €39/mo | €294 over 6 months |
| **Extra large** | an organisation, or an MSP's first customers | 100 | 15 TB | €249 | €99/mo | €744 over 6 months |

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
that the mission outranks the subgoal. Small is funded by Large/XL and by the keep-in-sync line,
not by itself.

**The margin is the keep-in-sync tier.** Near-zero marginal cost, indefinite duration, almost
pure contribution. ADR-0039 named the number that decides whether this business works: **what
fraction of customers keep a mapping running after cutover.** Measure it early.

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

### The path lifecycle, and why the schema cannot express it yet

A path is only ever billed for having **run**. Four states, decided by the owner 2026-08-20:

| state | meaning | billed |
|---|---|---|
| **`ready`** | configured, connection-tested, proven working — **never run** | **no** — and this is the column default |
| **`active`** | running | yes |
| **`paused`** | ran, then stopped by the owner | **yes** — it holds state and resumes in a second; it is reserved capacity |
| **`cutover` / `done`** | ended, having run | yes for the period it ended in; nothing after |

So **pausing does not reduce a bill; finishing does.** Deliberate, and it belongs on the
pricing page rather than on an invoice.

The reason `ready` has to exist as its own state is exactly the billing rule: today `paused`
means *both* "never started" (new mappings land paused so the owner can review discovery counts
first — `apps/api/src/routes/migrations/index.ts:1329`) *and* would mean "was running, stopped".
Those two must be told apart, because one is free and one is not. **A billing key cannot be
built on a status that conflates the free case with the charged one.**

**Two schema consequences follow. Neither is solved here.**

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
4. **The prices, in full, on the page.** All four tiers and the keep-in-sync rates. CloudFuze
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

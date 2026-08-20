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
- **A path bills from the moment its mapping is `active`** — never from configured-or-paused.
  Tier = the high-water mark of simultaneously active paths in the period, and the preflight
  shows the count against the ceiling ("4 of 8") so nobody crosses a boundary blind.
- **The tier boundary is a SERVICE boundary.** Small/Medium are self-service — a manual and a
  ticket queue, no phone. Large/XL include real engagement. The price gap follows support, not
  size; that is what makes it explicable.
- **Prices are published in full on the public page.** No "contact sales", no quote-gating.
  Deliberate contrast with the incumbents, and part of the same honesty claim as `SKIPPED`.
- **Fair use states numbers and a named remedy**: pass the ceiling and we talk to you and move
  you a tier — never a silent throttle, never a surprise invoice — with a warning at 80%, which
  the ledger can see coming.
- **Metering stays INTERNAL.** Bytes and compute are still measured, to check the tiers against
  reality; they simply never reach an invoice. Tiers do not self-correct the way metering does,
  so this is what keeps them honest.
- **"No profit" is retired as a description.** Large/XL carry a margin that funds Small/Medium
  and the operator's hours. Still not profit-seeking — cross-subsidy in service of the mission
  (ADR-0039: the mission outranks the subgoal).
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
| **Keep in sync** *(after cutover)* | a second target, indefinitely | — | as above | — | €2 / €3 / €15 / €40 | ongoing |

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

### Counting on activation

A path bills from the moment its mapping goes `active`. Configured-and-paused is free, which
matters because new mappings land PAUSED by design so the owner can review discovery counts
first (`apps/api/src/routes/migrations/index.ts:1329`) — the product's own caution should not
start a meter.

Tier is the **high-water mark of simultaneously active paths** during the period. That is the
honest measure — you had them running — and it must be *stated*, not discovered on an invoice.

**Two implementation consequences, both found in the schema and neither solved here:**

1. ⚠️ **`mailbox_mapping.status` has `DEFAULT 'active'`.** The API creates mappings paused, but
   the *column* defaults the other way, so any insert that omits the status would begin billing
   immediately. Billing-on-activation needs that default flipped to `'paused'`, or the billing
   query keyed on something that cannot default wrong.
2. **There is no `activated_at`, and no status-change history on the mapping.** `audit_log`
   exists; whether it records mapping status transitions is **unverified**. Billing needs *when*
   it went active, not merely that it is.

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

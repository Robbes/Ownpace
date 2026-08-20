# Workplan 0088 — a price you can see before you connect

## Status — 2026-08-19 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Decide the pricing shape this quotes (owner) | ✅ **Done 2026-08-20** — T2–T5 unblocked | [ADR-0014 amended](../adr/0014-cost-recovery-billing.md): five tiers on **paths running at the same time** (Tiny 1 / Small ≤4 / Medium ≤20 / Large ≤50 / XL ≤200), where a **path is one object type from one account to one account**, billed on the **month's peak**; no per-GB or compute line on any invoice; fair-use ceilings; metering kept internal. The tier is **derived, never picked** — downgrade automatic, upgrade consented — and each tier's price splits into a one-off setup and a monthly, with step-ups charging only the difference. Both findings recorded — the ~200× egress markup and bytes-priced-where-cost-is-hours. **Four** schema consequences named there and not solved: `mailbox_mapping.status` defaults to `'active'` when billing needs `'ready'`; there is no `activated_at`; peak occupancy needs `ended_at` plus a per-tenant per-month high-water record; and — the blocking one — **the lifecycle is per-mapping while the billing unit is per-`(mapping, domain)`**, so a path cannot be cut over on its own today. |
| T2 `INDICATIVE_PROFILES` — the assumptions, versioned | 📋 Planned | Customer type × object type → item counts and GB, every number carrying a provenance comment; covered by a unit test that refuses a silent gap. |
| T3 The static page | 📋 Planned (needs T1, T2) | One self-contained file under `site/pricing/`, no workspace imports, no account, no server state, five inputs. |
| T4 The drift guard, on the managed side | 📋 Planned (needs T3) | The page's numbers vs `packages/managed/src/pricing.ts`, plus an assertion that the appliance graph never reaches the calculator. |
| T5 The honesty surface | 📋 Planned (needs T3) | Bands not numbers, stated accuracy per rung, visible version and date, editable assumptions, no email gate, the target-unverified line. |
| T6 Name the three rungs, and what a free preflight may keep | 📋 Planned (docs; one gap named, not closed here) | The discovery flow already exists; this documents it as rung 2 and states the retention rule for non-customers. |

## Why this exists

The owner asked for a *pre-preflight*: something a visitor can use before connecting
anything, to see indicatively what they have and what it would cost. Two facts found
while scoping it changed the shape of the work.

**The preflight itself is already built.** `POST /api/migrations/:mappingId/discovery`
enqueues a read-only `run-discovery` job, per-domain counts land in `migration_discovery`,
and `GET …/discovery` serves them. New mappings deliberately land **PAUSED (draft)** so
the owner reviews those counts before anything starts
(`apps/api/src/routes/migrations/index.ts:1329`, `:1770`, `:1942–1990`). So the free
"see what you have before you pay" step is mostly **positioning an existing flow**. What
does not exist is the rung in front of it, for someone who has not connected anything and
may never.

**And the calculator cannot import the invoice.** The obvious honesty rule — one cost
function, so the quote and the invoice cannot disagree — collides with hard rule 5:
`apps/selfhost/src/no-managed-leakage.unit.test.ts` walks the appliance's real transitive
import graph and forbids `@openmig/managed`, Mollie, and **any module path matching
`/(^|\/)billing(\/|$)/`**. `calculateCost` lives in
`apps/api/src/services/billing-service.ts` and re-exports from `@openmig/managed`.

The resolution is ADR-0036's own reasoning rather than a guard exception: *an appliance is
never invoiced*, which is why pricing moved out of `@openmig/shared` in the first place. A
price calculator therefore has no business in the appliance at all. It is a managed-side
artifact, standalone, and the thing shared with the invoice is **the numbers, not the
function** — with a drift test on the managed side proving they agree.

## The three rungs

The design rule the rest of this plan serves: each rung replaces a guess with a
measurement, **and says which it is**.

| rung | input | output | accuracy | costs whom |
|---|---|---|---|---|
| 1 — pre-preflight (this plan) | self-declared, no account | a band | ±50% | nothing |
| 2 — preflight (exists) | measured `run-discovery` counts | firm price, time as a range | ±10% | a source connection |
| 3 — invoice (exists) | metered ledger | actual | — | the migration |

## T1 — decide the pricing shape this quotes (owner decision; blocks T2–T5)

`packages/managed/src/pricing.ts` holds today's model: base €9.99/month, storage
€0.10/GB/month, egress €0.20/GB, compute €0.05/hour — integer cents, env-overridable,
pinned per tenant so an operator's price change never re-prices an existing customer.
ADR-0014 calls this *cost recovery, no profit*. Two findings should be settled before any
of it is published on a page a stranger will screenshot.

**Finding 1 — the egress line already carries a margin, without saying so.** Egress at
€0.20/GB against a Hetzner-class transit price of about €1.00/TB (≈ €0.001/GB) is roughly
a **200× markup**. That is not wrong as economics — labour is ~90% of the true cost of
running this service, and it has to be recovered somewhere. It is wrong as *description*:
a project whose stated differentiator is that it tells the truth should not recover labour
through a line item named after bandwidth. Either name the labour, or lower the byte price
and charge for the service.

**Finding 2 — the model prices bytes; the cost is hours.** Mail is item-bound and
throttle-bound and is the single largest support surface (app passwords, 2FA, legacy IMAP
hosts). Calendar is small in every dimension and expensive in support, because recurrence
and timezones are where the edge cases live. Photos are large in both bytes and items but
comparatively mechanical. So today's model over-charges a photo-heavy family and
under-charges a mail-only SME — the customer that costs the most to run.

The shape proposed for the amendment, matching the machinery rather than fighting it: the
billable unit is **one source account → one target account, all object types included** —
which is the *mapping*, already the unit the ledger, the bookkeeping and verify key on.
A household or organisation cap keeps a family of four from paying four times. A
post-cutover second target is a second path at a reduced rate, which is what ADR-0015
already implies by retiring the extra-backup feature: *a second mapping pointed anywhere
achieves the same through tested machinery*.

**Deliverable:** an ADR-0014 amendment carrying whichever shape the owner picks, plus both
findings recorded whichever way it goes. **Nothing below is built until this lands** —
building first would publish an unratified model at the moment of first contact.

## T2 — `INDICATIVE_PROFILES`, versioned and tested

One table, `site/pricing/profiles.js`, mapping customer type × object type to typical item
counts and GB. Starting assumptions, to be argued with rather than trusted:

| | Individual | Family (4) | SME (10 seats) |
|---|---|---|---|
| Mail | 20k items / 8 GB | 80k / 30 GB | 400k / 160 GB |
| Contacts | 300 / <0.1 GB | 1.2k / <0.1 GB | 5k / 0.2 GB |
| Calendar | 2k / 0.2 GB | 8k / 0.5 GB | 40k / 2 GB |
| Files | 10k / 30 GB | 40k / 120 GB | 250k / 600 GB |
| Photos | 15k / 60 GB | 60k / 250 GB | rare |
| paths | 4–5 | 16–20 | 40–56 |

The `paths` row counts the ADR-0014 unit — **one object type, one account to one account** — so
an individual with mail, contacts, calendar and files is four, not one. It is derived from the
rows above it rather than declared, and the unit test should assert that: a paths count that
does not follow from the object types ticked is the single easiest way for this table to start
lying.

Every cell carries a provenance comment saying where the number came from, and the table
carries a version and a date. The unit test refuses a silent gap: every customer type
covers every object type, every profile has a provenance note, the version is present.
A missing cell must be an error rather than an omitted row — the same reason
`adr-operative.mjs` throws on an empty section instead of dropping it.

Replace these with measured medians from `migration_discovery` as soon as there are enough
real preflights to have a median, and say in the table that they were.

## T3 — the static page

`site/pricing/index.html` — one self-contained page. New top-level `site/` because this is
neither app code, nor docs, nor deploy, and because being outside every workspace package
is exactly what T4 needs to stay true.

Constraints, all load-bearing:

- **No workspace imports.** Its own copy of the numbers, checked by T4.
- **No account, no email gate, no server state.** A calculator that withholds its answer
  until you hand over an address is the posture this product exists to be the opposite of.
- **Five inputs:** who (individual / family of n / business of n seats); from (Google,
  Microsoft, Dropbox, Apple, other); what (object types); how much ("your provider already
  shows this number" + a link per provider, plus an honest *I don't know* → the T2 median);
  **until when** (1 / 3 / 6 months / *when I'm ready*).
- **The path count, visible and adding up as they tick object types.** *"Mail, contacts,
  calendar, files — that is four paths."* Nothing else on the page means anything until this
  has landed, and it is the one place the page can teach the unit without a paragraph.
- **A calculator, not a plan selector.** The visitor never chooses a tier — the page derives it
  from the inputs and says so. Nothing on the page may read as "pick your plan"; ADR-0014's
  whole guess-proofness argument rests on the tier being a consequence rather than a choice.
- **Setup and monthly shown separately**, with the step-up rule in one sentence, because a
  single "first month" number is what made the earlier draft look like a mis-pick penalty.
- **The word is "at the same time", never "concurrent" and never "used"** — an ADR-0014
  operative rule, and worth a grep guard alongside T5's.
- Duration is a **choice, not a prediction**. That is the product's promise stated in the
  pricing UI, and it makes the recurring line visibly the customer's to control — which is
  the fear a monthly price provokes.

## T4 — the drift guard, on the managed side

Two assertions, both on the managed side so nothing crosses into the appliance graph:

1. The page's price constants agree with `packages/managed/src/pricing.ts` over a fixture
   set of inputs, failing with the fix named. Without this, the page is a second copy of
   the prices — precisely the bug `billing-service.ts`'s header records escaping (*"they
   used to be two literals in two packages"*), reintroduced in the one copy customers read.
2. `site/` is unreachable from the selfhost entrypoint. The existing walk would already
   catch an import, but the assertion is worth stating explicitly rather than resting on
   the absence of a mistake.

## T5 — the honesty surface

The page's numbers are cheap; its credibility is not. Required, and grep-guarded so a
later edit cannot quietly drop them:

- **Bands, never single numbers**, each labelled with its rung's accuracy (±50% here).
- **A visible version and date**, because a quoted price gets screenshotted.
- **Assumptions shown and editable** — *"we assumed 20,000 messages for one person —
  change it"* — so the visitor can correct us instead of distrusting us.
- **The line about what it cannot know:** *"this assumes your target accepts your data. We
  verify that in the preflight, which is free."* Same discipline as ADR-0029's `SKIPPED`:
  the absence of a check is stated, never implied away.
- **The bill-goes-down sentence, stated up front rather than discovered:** finishing paths
  lowers the tier by itself, automatically and without asking — the counterpart to the
  pausing-does-not sentence, and the reason the page does not need a "cancel" story.

## T6 — name the three rungs, and what a free preflight may keep

Docs, no product code. Write the ladder above into the customer-facing docs and name where
each number comes from.

One gap is **named here and not closed here**: a free preflight means holding an inventory
of a non-customer's mailbox. The rule should be that rung 2 stores **counts, sizes and
aggregates only** — natural keys land in the ledger at first real sync, not at discovery —
with one active free preflight per address, a 30-day expiry, cascade delete, and the grant
revoked on expiry. Whether today's `run-discovery` already satisfies the aggregates-only
half is **unverified** and is the first thing to check when this task starts. For a
sovereignty product this is a property to state publicly, not a cleanup job.

## Not in this plan

- Building rung 2 as a *product* step (sign-up flow, quote presentation, payment before
  first byte). This plan stops at the page and the ladder's documentation.
- The retention machinery in T6 — the rule is stated, the expiry job is not built.
- Any change to `calculateCost` or to the invoice path.
- ~~The service name~~ — decided: **Ownpace** (ADR-0040).
- The public page's copy and layout: sketched in ADR-0014's amendment (order, tone, what the
  page must not claim), built here only as far as `site/pricing/` goes.

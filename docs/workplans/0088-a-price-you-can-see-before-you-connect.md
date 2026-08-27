# Workplan 0088 — a price you can see before you connect

## Status — 2026-08-26 (update this block at the end of every session)

> Since 2026-08-19 the site grew a build (`site/build.mjs`, bilingual `site/pages/en+nl`),
> a published tier table (`site/prices.mjs`, guarded against ADR-0014's own table by
> `site/site.unit.test.ts`), and pricing pages — so parts of what T3–T5 planned already
> exist under other workplans' hands. The rows below say what is genuinely still missing:
> the CALCULATOR (T2's assumptions + T3's inputs-to-tier derivation) and the honesty
> surface around it.
>
> **T1–T3 and T5 are done. What is left is not startable here** (2026-08-27): **T4** cannot
> be built as written — there is no tier code on the managed side to guard the page
> against — and it has moved to [0109](./0109-the-invoice-speaks-tiers.md) T4/T7 behind an
> owner decision. **T6** is a docs task whose substance is a retention rule for people who
> are not customers, which is the owner's to set, not ours to write down and call settled.
> So this plan is finished as far as engineering can take it alone.

| Task | Status | Evidence |
|---|---|---|
| T1 Decide the pricing shape this quotes (owner) | ✅ **Done 2026-08-20** — T2–T5 unblocked | [ADR-0014 amended](../adr/0014-cost-recovery-billing.md): five tiers on **two axes, higher wins** — paths running at the same time (Tiny 1 / Small 4 / Medium 20 / Large 50 / XL 200), billed on the **month's peak**, and **cumulative data moved** (250 GB / 750 GB / 2 TB / 7.5 TB / 15 TB), counting each item's first copy only and never falling — though a **top-up** buys another band of room for that tier's setup fee, without moving the tier. A **path is one object type from one account to one account**; no per-GB or compute line on any invoice; fair-use ceilings; metering kept internal. The tier is **derived, never picked** — downgrade automatic, upgrade consented — and each tier's price splits into a one-off setup and a monthly, with step-ups charging only the difference. Both findings recorded — the ~200× egress markup and bytes-priced-where-cost-is-hours. **Five** schema consequences named there and not solved: `mailbox_mapping.status` defaults to `'active'` when billing needs `'ready'`; there is no `activated_at`; peak occupancy needs `ended_at` plus a per-tenant per-month high-water record; — the blocking one — **the lifecycle is per-mapping while the billing unit is per-`(mapping, domain)`**, so a path cannot be cut over on its own today; and the byte meter needs an append-only counter, since `migration-status-store.ts:182` sums live rows and counts `'skipped'`. |
| T2 `INDICATIVE_PROFILES` — the assumptions, versioned | ✅ **Done 2026-08-26** | `site/profiles.mjs` beside `prices.mjs` (the plan's `site/pricing/profiles.js` path predates the site build; same no-workspace-imports property). The plan's table transcribed cell for cell, every cell carrying provenance ("<0.1 GB" carried as 0.1 so the size axis never reads zero; the SME photos cell — the plan says "rare", no number — carries 10× the individual library as the stated least-wrong stand-in, never an invented zero); `PROFILES_VERSION` with version, date, and an honest `measured: false` that flips only when `migration_discovery` medians replace judgement. **Paths derived, never declared**: `pathsFor(who, ticked) = accounts × ticked` is the one place the ADR-0014 arithmetic lives, pinned to the plan's own worked examples (individual 4–5, family 16–20; deliberately blind to shared mailboxes — those are accounts the page must ask about, not pad in). `indicativeGb` sums the ticked cells for the data axis. `site/profiles.unit.test.ts` (10 tests) refuses every silent gap — missing cell, empty provenance, absent version, unknown type in either direction — and pins the v1 numbers so an edit must touch test and version together (a quoted estimate gets screenshotted exactly like a quoted price). Proofs by breaking: a declared-constant `pathsFor` → 3 red; a dropped cell → 3 red. |
| T3 The static page | ✅ **Done 2026-08-26** — shape **(a)**, the owner's pick of the CSP fork | `estimate.html` / `nl/schatting.html`, rendered by the site build like every other page. Five inputs (who / from / what / how much — every GB field editable, items shown — / until when), the path count adding up in the customer vocabulary (*"Mail, Contacts, Calendar, Files, for four people — that is sixteen migrations at the same time"*), **both axes shown with the deciding one highlighted** (`deriveTier` pins ADR-0014's own worked example: one migration and 400 GB is Small, because size says so), the tier **derived and said to be** — no tier is offered as a choice anywhere — setup and monthly separate with the step-up rule in one sentence, and past the table "talk to us" rather than a guessed number. **The one script is hash-pinned** (owner decision 2026-08-26): the arithmetic lives in `site/calculator.mjs`, unit-tested directly and inlined byte-for-byte (exports stripped); one locale-blind script + per-page JSON config = one sha256, pinned in `deploy/compose/www-nginx.conf`'s `$csp_calc` for exactly the two calculator locations; `site/calculator.unit.test.ts` fails when script and pin drift (a stale hash serves a perfectly rendered, perfectly dead calculator). `form-action 'none'` stays everywhere — the calculator submits nothing, and the page wrapper is a `div`, so the site's no-forms guard still holds. **Found and fixed while wiring**: nginx `add_header` inheritance meant every location's own Cache-Control silently dropped the server-level CSP — no served page carried it at all; the headers now repeat per location and a test refuses a location that sets headers without restating the CSP. Deferred per never-guess: per-provider deep links to storage pages (the hint names where to look; URLs land when verified in a browser). Proofs by breaking: a stale pinned hash → 1 red; a derivation that ignores the data axis → 2 red (the worked example AND the hash — any logic edit forces a re-pin). |
| T4 The drift guard, on the managed side | 🚧 **Blocked — cannot be built as written** (found 2026-08-27) | It asks for a guard between the page's numbers and `packages/managed/src/pricing.ts`. **There is nothing to compare against.** `pricing.ts`'s whole configuration surface is four scalars — `baseFee`, `storagePricePerGB`, `egressPricePerGB`, `computePricePerHour` (`packages/managed/src/pricing.ts:34-43`) — the metered model ADR-0014's 2026-08-20 amendment retired, and there is **no tier code anywhere in `packages/` or `apps/`**: the only `tier` in server code is `access_request.tier`, a free-text field the schema itself marks indicative. A guard cannot be written between a table of five tiers and a file that has none. The second half fares no better today: the appliance's import graph never reaches `site/` at all (`site/` depends on nothing in the workspace, deliberately — 0086 T7), so that assertion would pass vacuously and prove nothing. **This work now lives in [0109](./0109-the-invoice-speaks-tiers.md) T4**, where it is a guard on a managed-side calculator that has to exist first, and 0109 T7 covers the leakage half — extending the guard *before* the module exists rather than after. Both sit behind 0109's T0 (an owner decision) and T1. Left here rather than deleted so the next reader finds the reason instead of re-discovering it. |
| T5 The honesty surface | ✅ **Done 2026-08-26** — built into T3 from birth, grep-guarded | The data axis is a **band** (`band()`: ±50%, rounded outward — a band that excludes the truth defeats itself) with the rung's accuracy stated beside it; **`Assumptions v1, 2026-08-26`** visible on the page (a quoted estimate gets screenshotted like a quoted price), with the judgement-not-measured status and the medians-will-replace-this promise in the same breath; **every assumption editable** (the GB fields are the assumptions, prefilled per who); **no email gate, no account, nothing stored** — the page says so in its own description; the **cannot-know line** (*"whether your target accepts your data — the preflight verifies exactly that, and it is free"*); the **bill-goes-down sentence with its floor named in the same breath**, and the **top-up against the step-up with the break-even shown** (`topUpAgainstStepUp` pins ADR-0014's own example: €1 more up front, €4 a month saved, back in about eight days — no profit means no reason to steer). All grep-guarded on the RENDERED pages by `site/calculator.unit.test.ts`, along with the vocabulary rules: never *concurrent* (either language), never a per-migration-per-month figure. |
| T6 Name the three rungs, and what a free preflight may keep | 📋 **Awaiting an owner decision** (was: Planned) | Naming the three rungs is documentation and could be written today. **Stating the retention rule for non-customers is not.** A free preflight reads somebody's mailbox to count it, and how long we keep those counts for a person who never becomes a customer is a privacy commitment, not a description of current behaviour: whatever gets written down becomes the promise, and it is the owner's to make. Writing a plausible one and calling it documented would be the worst outcome — a retention policy nobody decided, cited later as though somebody had. So this stays open with the question named rather than half-done: **how long may a free preflight's discovery counts survive for somebody who does not sign up, and what deletes them?** |

## Why this exists

The owner asked for a *pre-preflight*: something a visitor can use before connecting
anything, to see indicatively what they have and what it would cost. Two facts found
while scoping it changed the shape of the work.

**The preflight itself is already built.** `POST /api/migrations/:mappingId/discovery`
enqueues a read-only `run-discovery` job, per-domain counts land in `migration_discovery`,
and `GET …/discovery` serves them. New mappings deliberately land **PAUSED (draft)** so
the owner reviews those counts before anything starts
(`apps/api/src/routes/migrations/index.ts:1395`, `:1829`, `:2004–2054`). So the free
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
- **Both axes shown, with the higher one highlighted as it changes.** The tier is
  `max(paths, data)`, so a page that shows only the path count will quote the wrong tier for
  every photo-heavy visitor — the single most likely way this calculator lies.
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
- **And its limit, in the same breath:** the data axis never falls, so the size of what was
  moved sets a floor — or a top-up keeps them where they are. A page that promises the fall
  without naming the floor is the version of this that generates the complaint.
- **The top-up choice, with its break-even shown**, since it is the one decision on the page a
  visitor can get wrong and the one place a no-profit service could quietly profit from steering.
  T4's drift guard covers the top-up prices too: they are the setup fees, so a page that lets
  the two drift apart is offering a block at a price the invoice will not honour.

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

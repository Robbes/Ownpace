# Workplan 0086 — a front door for the managed service

## Status — 2026-08-18 (update this block at the end of every session)

**Nothing here is built.** This is a plan, written 2026-08-18 at the owner's
request, with two decisions already taken (recorded below).

| Task | Status | Notes |
|---|---|---|
| T1 public routes in `apps/web`, behind a seam | ⬜ **Planned** (owner decision) | One app, one deploy, one design system — **and built so that splitting it out later is cheap**, which is what the owner asked for: the separate-site option "might be more secure in the long run". So: public routes in their own directory with **no imports from the authenticated console**, no auth context, no API client. The seam is a rule about dependency direction, and it is worth a lint rule rather than a comment, because the drift here is somebody importing one shared component and quietly welding the two together. |
| T2 the price list comes from `@openmig/shared` | ⬜ **Planned** | `pricing.ts` already owns `DEFAULT_PRICING`, `pricingFromEnv` and `VAT_RATE = 0.21`, and invoices are generated from it. **A public page that quotes its own numbers will eventually quote a price we do not charge** — and unlike most drift, that one is visible to a customer and arguably actionable. One source. If T7's split ever happens, the prices are generated from `shared` at build time rather than re-typed. |
| T3 what it does, and what it refuses to do | ⬜ **Planned** | The features page. The interesting half is the refusals, because they are the product's actual position: **nothing is ever deleted at the source** (hard rule 2); **reverse sync does not exist and will not** (§20, retracted 2026-08-03 — the source IS the fallback); the apply path is off by default and gated per item. A migration product that is candid about what it will not do is making a claim its competitors cannot copy cheaply. |
| T4 request access — no public write path | ⬜ **Planned** (owner decision) | `POST /api/tenants` is **501 Not Implemented** today, deliberately: *"provision tenants via the onboarding/seed flow (a privileged, non-tenant-scoped path)"*. That stays true. The public form captures a request; it does not create a tenant. So there is no public write path into tenancy, no fraud surface, and no abuse story to build before launch. Needs: spam protection on the form, a place for requests to land, and an honest response time on the page. |
| T5 the legal surface, which gates taking money | ⬜ **Planned** | Terms, privacy statement, **DPA and a sub-processor list** — §17 already states the operator is a processor and the tenant admin the controller, so the DPA is not optional once a real customer's mail is involved. Also: the legal entity, VAT registration, and the address that goes on the invoice `pricing.ts` already knows how to raise. **This is the real critical path**, not the pages. |
| T6 pay: wire the Mollie path that exists | ⬜ **Planned** | `services/mollie/` (payments, customers, methods), `routes/billing/` and `webhooks.ts` already exist, as do invoice generation and `usage_metric`. The gap is not payment — it is the **journey**: request → approved → first invoice → mandate → active. Nobody has walked it end to end, and 0082's finding that a whole edition can be untested applies here too. |
| T7 the split, kept cheap rather than done | ⬜ **Planned** | Not built now. Written down so T1's seam has a stated purpose: if the public pages ever move to their own deploy, what must be true is that they import nothing from the console and that prices are generated from `shared` at build time. **Both are properties of the code as first written, or they are a migration later.** |

## What this is

The owner's requirement: *"someone publicly needs to be able to see an overview
of the Open-Migrate managed service, have insight in features and costs,
register for it / buy it / pay, and then use it."*

Most of the machinery for the second half already exists — Mollie, invoices,
pricing, usage metering, tenants, RBAC. What does not exist is a way in: there
is no unauthenticated surface at all, and tenant creation through the API is a
deliberate 501. So this workplan is mostly **a front door and a legal
envelope**, not a billing system.

## Decisions already taken (owner, 2026-08-18)

| Question | Answer |
|---|---|
| How does someone become a customer? | **Request access, the owner provisions.** Self-serve is a later workplan once demand is real |
| Where do the public pages live? | **Inside `apps/web`** — built so a later split to a separate site with build-time prices stays cheap, because that may be the more secure long-run shape |

## The ordering that matters

The instinct is to build the pages first, because they are the visible part.
The correct order is close to the reverse:

1. **T5 (legal)** — it is the longest lead time and the only item that can stop
   a launch outright. A DPA is not something written the evening before.
2. **T4 (request → provision)** — because until a request can become a working
   tenant, the pages advertise something that cannot be delivered.
3. **T6 (the journey, walked)** — end to end, with a real Mollie test mandate.
4. **T2, T3, T1** — the pages themselves, which are the least risky part.

Building 1–3 first also means the pages get written by somebody who has just
watched the whole thing work, which is when the copy is honest.

## Two things worth flagging now

**Cost-recovery pricing is a promise, and a public page makes it a public one.**
ADR-0014 says price ≈ allocated infrastructure + operations, reviewed
periodically to stay break-even. Once that is on a public page it is a statement
customers can hold the operator to — including "why did it go up?". Worth
deciding whether the page states the *principle* (cost-recovery, reviewed, not
for profit) or the *numbers*, or both. Stating the principle without the numbers
is a legitimate answer and probably the durable one.

**The console assumes a tenant exists.** Every page in `apps/web` today is
behind auth and inside a tenant context. A public visitor has neither, so the
router change in T1 is not cosmetic — it is the first time this app has two
kinds of visitor, and getting the seam wrong shows up as an authenticated
component rendering for somebody who is not logged in.

## What is NOT in scope

- **Self-serve signup**, per the owner's decision. It becomes a workplan when
  request-access volume justifies it — and it will need email verification,
  rate limiting, VAT-number validation and an abuse story, none of which are
  needed now.
- **A designer's marketing site.** These pages should be honest, fast and
  accessible; making them beautiful is worth doing later and by somebody else.
- **Trials, discounts, self-serve plan changes.** No pricing tiers exist; the
  model is cost-recovery, and inventing tiers to fill a pricing table would be
  designing the product from the marketing page backwards.

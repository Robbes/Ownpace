# Workplan 0039 — Billing tells the truth about money

## Status — 2026-08-11 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Role guards on the billing writes | ✅ Done 2026-08-09; reads tightened 2026-08-10 | `requireBillingWrite` (owner/admin) on pay/generate/payment-methods POST+PATCH. **The 2026-08-09 member-visible reads line was OVERTURNED by the owner on 2026-08-10: reads are owner/admin too.** `requireBillingRead` (same role set, separate name — the seam for a future divergence) guards usage, usage/history, invoices, invoice detail, payment-methods GET and the estimate calculator. Client: the Billing screen renders a clean admin-only sentence for lesser roles instead of three 403 error cards (queries disabled), and the nav entry hides for viewer/member. Integration: viewer AND member 403 on every read + estimate, admin 200; writes as before. UI pins: Billing.unit (viewer → sentence, zero fetches), Layout.unit (nav gating). `billing.readOnly` (now false) replaced by `billing.adminOnly`, both locales. |
| T2 The numbers are the right numbers | ✅ Done 2026-08-09 | `calculateCost` serves `baseFee` + `taxRate` (one `VAT_RATE` constant); Base Fee line renders baseFee (was the entire subtotal); VAT label derives from the served rate; "Syncs"→"API calls"; period + lastUpdated render. Sum pinned with a non-trivial fixture (0036's AsOf may later restyle the as-of line). |
| T3 The invoice contract, reconciled | ✅ Done 2026-08-09 | Client zod-parses literal route responses; DB enum (`sent`/`overdue`) with Stripe's words pinned as must-throw; periodStart/periodEnd render; money strings coerced explicitly; overdue red / sent blue. Dead surface deleted: client `recordUsage`+`estimateCost`, API-side Stripe-vocabulary types+schemas. Estimate's hardcoded 999 → `cost.baseFee`. |
| T4 Dead chrome: wire it or remove it | ✅ Done 2026-08-09 | Pay button (draft/sent/overdue, canManage) → `createPayment` → checkout URL; failures verbatim at the row; Mollie redirectUrl → `/billing` (was a route the SPA doesn't define — blank page after paying); payment-methods card performs its read; View + Add Payment Method REMOVED rather than dormant. |
| T5 Tenants keeps: duplicate invites, self-demotion | ✅ Done 2026-08-09 | Duplicate invite refused 409 naming the live row (invited vs active variants); exactly-one-live-row pinned. Self-demotion armed (Deletions pattern); other-row changes single-click; the last-owner test now goes through the confirm. |
| T6 A currency formatter for two locales | ✅ Done 2026-08-09 | `useFormatters().currency(cents, code)`; en "€12.34" / nl "€ 12,34" pinned; `invoice.currency` feeds it; all hand-rolled `€{(x/100).toFixed(2)}` gone. |
| T7 What the meter measures, and what it costs | ✅ Done 2026-08-11 — **found by the owner reading the live billing screen, not by any gate here** | The screen said **24.3 compute hours** for a demo that had done seconds of work, and it was right about the arithmetic: `usage-metering` prices `completedAt - startedAt` from `migration_status`, and `started_at` was written ONCE by `initDomainStatus` and never again (`markInProgress` set state + updated_at only). The billable quantity was the AGE OF THE ROW — a number that grows with the calendar whether or not anything runs. `markInProgress` now stamps `started_at`. **Entangled with a second defect that had to be fixed in the same commit:** the managed delta-sync's email branch never wrote `migration_status` at all (a comment claimed `buildDepsFromMapping` did; nothing in `@openmig/core` or the ledger touches that table), so the mapping list's "last sync" — which reads that row — showed **9 days ago** for a mapping syncing cleanly every 15 minutes. Giving email its status row is what starts metering it, so fixing that alone would have booked a 24-hour pass every quarter hour. Every domain now init/in_progress/completed/failed uniformly; the loop no longer branches on email. The appliance path (`runAllDomains`) already did this and was never affected — checked rather than assumed. **Prices were two constants and VAT was three:** the API invoiced from `defaultPricing`, the worker metered against its own `PRICING` literal (under a "should come from config/env in production" comment), and `invoice-generation` carried a third `VAT_RATE` — the one actually STAMPED ON THE INVOICE ROW, so a rate change elsewhere would have issued invoices claiming a rate the arithmetic never used. One copy in `@openmig/shared`, template-configurable via `PRICING_*` (integer cents; a euros-shaped typo REFUSES TO BOOT naming the variable, because the alternative is billing a hundredth of the intended amount on every invoice until the bank says so). **The template/agreement split (owner requirement 2026-08-11):** configurable prices create a hazard frozen ones did not — editing the list would retroactively re-price every open invoice. `tenant.pricing` (migration 0007) holds the snapshot a tenant was signed up at; `resolveTenantPricing` pins the template there on first billing touch and never follows it again, and it is what the usage, history, estimate, invoice AND metering paths all price from (`generateInvoiceForPeriod`'s pricing parameter no longer DEFAULTS to the template — a caller that forgets now gets the customer's own rates, which is the direction that cannot overcharge). The migration backfills existing tenants with the exact built-in numbers literally, not from config, since the deploying host may already have a different template set. VAT stays global: a tax rate is set by a government, and pinning it per tenant would be a tax error, not a discount. No screen — `PRICING_*` in `managed.env.example` plus an operator-runbook **Prices** section (read one tenant's agreed prices; re-price one deliberately, all four keys, because a partial object reads as *no agreement* rather than half-merging into a price nobody quoted). 12 unit tests on template/agreement parsing, both mutation-verified (a lenient partial parse and a swallowed bad env value each fail them); 5 integration cases on the pinning, including that a template change leaves an existing tenant alone — CI only, no Docker in the agent environment. |

**Owner decisions: both answered.** T1's read-visibility question was
answered 2026-08-10 — reads are owner/admin, overturning the recorded
member-visible line; "is Billing a real surface" was answered in the
affirmative by wiring the existing server loop rather than adding new scope.

## Why this exists

The 2026-08-09 review fleet swept the managed admin surfaces nobody had
walked — Tenants and Billing — and found them opposite in maturity.
**Tenants is disciplined**: refusals verbatim per-row, the destructive
remove is armed, client gating exactly matches the server guards, no
cross-tenant leak (verified against the routes). **Billing is the mirror
image**, and it is the screen where numbers become money:

- **The API has no role guards at all**: every billing route runs on
  `authenticate` alone — `POST /invoices/generate`, `POST /invoices/:id/pay`
  (creates a real Mollie payment and flips the invoice to `sent`),
  `POST /payment-methods`, `PATCH /payment-methods/:id/default` — while the
  same codebase's Tenants routes all add `requireRole('owner','admin')`. A
  viewer can move money.
- **"Base Fee" renders the entire subtotal** (`Billing.tsx:96-98`):
  `calculateCost` returns no `baseFee` field, so the line shows
  base+storage+egress+compute — the itemized lines sum to roughly double the
  printed Subtotal. Wrong arithmetic, on screen, about money. ("VAT (21%)"
  is also hardcoded prose duplicating the server's 0.21 constant.)
- **The client invoice types are Stripe vocabulary against a Mollie enum**:
  client says `period: string` + `draft|open|paid|uncollectible|void`; the
  server sends `periodStart`/`periodEnd` + `draft|sent|paid|overdue|void`.
  Every row renders "Period:" followed by nothing; `overdue` — the one
  status demanding action — wears neutral gray; money columns are TEXT
  serving strings into `number` types that work by coercion.
- **The Payment Methods card hardcodes its empty state** — the read is never
  performed; a tenant WITH stored methods is told they have none. Worse than
  a failed-read-as-empty: no read even fails.
- **Every control is dead**: "View" and "Add Payment Method" have no
  `onClick`; the fully-built Mollie pay loop has no UI path — and its
  `redirectUrl` points at `/billing/invoices/:id`, a route the SPA does not
  define (blank page immediately after paying).

## Guardrails

- **Hard rule 9** for every read; refusals verbatim.
- 0033 T2 audits Billing's failed-read rendering and 0035 T2 localizes its
  strings — this plan is the rest: authorization, arithmetic, contract,
  interactivity. Coordinate so each file is touched once where practical.
- 0036's as-of species applies to Billing (`period` and `lastUpdated` are
  served and discarded; the "Syncs" tile renders `apiCallCount`) — that
  labeling belongs to 0036's charter; this plan's T2 records it as scope
  0036 must include, and whichever lands second picks it up.

## Tasks

### T1 — role guards on the billing writes

`requireRole('owner','admin')` on all billing write routes (pay, generate,
payment-methods POST/PATCH), mirroring the Tenants routes' own pattern.
Decide (and record) whether usage/invoice READS stay member-visible. Client:
mirror Tenants' `canManage` gating on the Billing screen once its buttons do
anything (T4).

**Acceptance:** route tests: a viewer's pay/generate/payment-method calls are
refused; owner/admin succeed; the recorded read-visibility decision has a
matching test.

### T2 — the numbers are the right numbers

`GET /billing/usage` includes `baseFee` in `currentCost` (the client type
already expects it); the Base Fee line renders it; the VAT label derives from
the served `taxRate` instead of hardcoding 21%. The "Syncs" tile either
renders a real sync count or is renamed to what `apiCallCount` counts. The
served `period` and `lastUpdated` render (0036's AsOf component once it
exists — "Usage for 2026-08", as-of time).

**Acceptance:** the itemized lines sum to the subtotal (test with a seeded
usage fixture); no tile's label disagrees with its data source; the period
renders.

### T3 — the invoice contract, reconciled

Zod-parse billing responses in `billing-service.ts` the way
`mapping-service.ts` does (its header comment documents exactly this drift
failure mode): status enum aligned to the server's
(`draft|sent|paid|overdue|void`), `periodStart`/`periodEnd` rendered as the
period, money strings coerced explicitly, `overdue` styled as the
action-demanding state and `sent` styled at all. Delete the phantom client
surface while in the file: `recordUsage` POSTs an endpoint that does not
exist, `estimateCost` types a shape the server does not send, and nothing
calls either (the 0026 T2 dead-surface precedent applies); server-side, the
estimate breakdown's hardcoded `999` becomes `pricing.baseFee`.

**Acceptance:** a fixture of the route's literal invoice rows parses and
renders period + correctly-styled statuses; grep finds no `recordUsage` /
`estimateCost` in the client (or they are aligned and called); the estimate
breakdown tracks `PricingConfig`.

### T4 — dead chrome: wire it or remove it

The pay loop exists server-side; give it its UI or stop promising it:
- "View" opens an invoice detail (or is dropped).
- A Pay affordance calls `createPayment` and follows `paymentUrl` — AFTER
  T1's guards land.
- Fix the Mollie `redirectUrl` to a route that exists (`/billing` until an
  invoice-detail route is real — landing on a blank page immediately after
  paying reads as "my payment vanished").
- The Payment Methods card fetches its list (rule-9 error handling) or the
  card is removed until the feature is real.

**Acceptance:** no button on Billing does nothing; the payment redirect
lands on a rendering route; the payment-methods card shows served rows or is
absent (tests per branch shipped).

### T5 — Tenants keeps: duplicate invites, self-demotion

- Inviting an email that already has an active or invited row silently
  creates a duplicate (`pending:${randomUUID()}` defeats the unique
  constraint; which row's role wins on acceptance is undefined). Server-side
  refusal in plain words — it renders verbatim through the existing
  `inviteError` plumbing, no UI change.
- Self-demotion is one un-armed click while removing others is armed: apply
  the same arming to a role change on your own row that lowers your role
  (the file's own Deletions-pattern comment names the convention).

**Acceptance:** a duplicate invite is refused with the reason rendered; a
self-demotion requires the second click; other-row changes stay single-click.

### T6 — a currency formatter for two locales

`useFormatters` gains `currency(cents, code)` (Intl.NumberFormat,
`style: 'currency'`) — today every amount is a hardcoded
`€{(x / 100).toFixed(2)}`, which will render EN-style in the NL screen once
0035 T2 localizes Billing, and `invoice.currency` is dead data. One helper,
both locales; extends the existing 0024-T3 formatter mechanism, no
framework.

**Acceptance:** amounts render "€ 12,34" under NL and "€12.34" under EN
(formatter unit test); `invoice.currency` feeds the formatter.

### T7 — what the meter measures, and what it costs

Added after the plan's other tasks were closed, from the owner reading the live billing
screen rather than from any gate here: it showed **24.3 compute hours** for a demo that had
done seconds of work. The arithmetic was right and the input was not — the billable quantity
was the age of the `migration_status` row, because `started_at` was written once at init and
never re-stamped. Fixing it surfaced a second defect entangled with the first (the managed
delta-sync's email branch never wrote that table at all) and a third of a different kind
(prices existed as two constants and VAT as three, one of which was the rate actually stamped
on the invoice).

Full evidence, including the template/agreement pricing split the owner required on
2026-08-11, is in this file's Status block. This heading exists because T7 had a row in that
table and no section here.

## Owner decisions queued by this plan

- ~~T1's read-visibility question (do viewers see usage and invoices?).~~
  **Answered 2026-08-10 (owner): no — billing reads are owner/admin, like
  the writes.** The 2026-08-09 recorded member-visible decision is
  overturned; see the T1 status row for what enforces it.
- ~~Whether Billing is a real product surface yet at all — if not, T4's
  honest alternative is saying so on-screen instead of wiring the loop.~~
  **Answered 2026-08-09 by T4 wiring the real loop** (and reaffirmed
  2026-08-10 alongside the reads decision).

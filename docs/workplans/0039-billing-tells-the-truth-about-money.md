# Workplan 0039 — Billing tells the truth about money

## Status — 2026-08-09 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Role guards on the billing writes | ✅ Done 2026-08-09 | `requireBillingWrite` (owner/admin) on pay/generate/payment-methods POST+PATCH. **Recorded decision: reads (and the estimate calculator) stay member-visible** — seeing money is not moving money; pinned by test. Integration: viewer 403 at all four writes, member 403, admin 201, viewer reads 200. |
| T2 The numbers are the right numbers | ✅ Done 2026-08-09 | `calculateCost` serves `baseFee` + `taxRate` (one `VAT_RATE` constant); Base Fee line renders baseFee (was the entire subtotal); VAT label derives from the served rate; "Syncs"→"API calls"; period + lastUpdated render. Sum pinned with a non-trivial fixture (0036's AsOf may later restyle the as-of line). |
| T3 The invoice contract, reconciled | ✅ Done 2026-08-09 | Client zod-parses literal route responses; DB enum (`sent`/`overdue`) with Stripe's words pinned as must-throw; periodStart/periodEnd render; money strings coerced explicitly; overdue red / sent blue. Dead surface deleted: client `recordUsage`+`estimateCost`, API-side Stripe-vocabulary types+schemas. Estimate's hardcoded 999 → `cost.baseFee`. |
| T4 Dead chrome: wire it or remove it | ✅ Done 2026-08-09 | Pay button (draft/sent/overdue, canManage) → `createPayment` → checkout URL; failures verbatim at the row; Mollie redirectUrl → `/billing` (was a route the SPA doesn't define — blank page after paying); payment-methods card performs its read; View + Add Payment Method REMOVED rather than dormant. |
| T5 Tenants keeps: duplicate invites, self-demotion | ✅ Done 2026-08-09 | Duplicate invite refused 409 naming the live row (invited vs active variants); exactly-one-live-row pinned. Self-demotion armed (Deletions pattern); other-row changes single-click; the last-owner test now goes through the confirm. |
| T6 A currency formatter for two locales | ✅ Done 2026-08-09 | `useFormatters().currency(cents, code)`; en "€12.34" / nl "€ 12,34" pinned; `invoice.currency` feeds it; all hand-rolled `€{(x/100).toFixed(2)}` gone. |

**Owner decisions queued below remain open** — T1's read-visibility line is
recorded (member-visible) and reversible; "is Billing a real surface" was
answered in the affirmative by wiring the existing server loop rather than
adding new scope.

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

## Owner decisions queued by this plan

- T1's read-visibility question (do viewers see usage and invoices?).
- Whether Billing is a real product surface yet at all — if not, T4's
  honest alternative is saying so on-screen instead of wiring the loop.

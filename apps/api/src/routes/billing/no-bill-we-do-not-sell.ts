// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The invoice route refuses, and says exactly what it would otherwise bill
 * (workplan 0109 T0 — the owner chose (a) refuse, 2026-08-27).
 *
 * ## What this guards against
 *
 * ADR-0014 was amended on 2026-08-20 from a metered model to **five tiers on
 * two axes**. `site/prices.mjs` publishes those tiers, 0088's calculator
 * derives one from a visitor's answers — and `packages/managed/src/pricing.ts`
 * still implements the model the amendment retired. Its whole configuration
 * surface is four scalars (`baseFee`, `storagePricePerGB`, `egressPricePerGB`,
 * `computePricePerHour`), and there is no tier code anywhere in `packages/` or
 * `apps/`.
 *
 * So `POST /api/billing/invoices/generate` produces a draft invoice for a
 * model we no longer sell. Three things make that worse than merely stale, and
 * all three were found by reading the code rather than inferred:
 *
 *  1. **Every byte is priced twice.** `deriveStorageAndEgressForPeriod` sets
 *     `egressBytes = storageBytes` — the same byte at €0.10/GB as storage and
 *     €0.20/GB as egress.
 *  2. **Items that moved nothing are billed.** Both byte queries count
 *     `'skipped'` and `'updated'`; the amendment says re-copies must never
 *     count.
 *  3. **The per-driver breakdown is on the invoice.** `metadata.costByDriver`
 *     is exactly what the amendment forbids an invoice from showing.
 *
 * ## Why a refusal rather than a fix
 *
 * Fixing the arithmetic is roughly a day of work on code that 0109 T5 deletes,
 * and it would leave the deeper problem untouched: the number would be
 * arithmetically clean and still be a price for something nobody was sold. A
 * refusal cannot mislead, costs one guard, and is the shape this codebase uses
 * everywhere else — refuse where the refusal can name its remedy rather than
 * produce a confident wrong answer.
 *
 * ## When this goes
 *
 * 0109 T5 — "the invoice says the tier and its evidence". Deleting this file is
 * part of that task, and `no-bill-we-do-not-sell.unit.test.ts` fails the moment
 * a tier calculator exists, so the guard cannot outlive its reason by being
 * forgotten.
 *
 * Nothing else in billing changes. Reading usage, listing invoices, the
 * payment-method routes and the webhook all still work: what is refused is
 * MINTING A NEW BILL, which is the one operation that turns a wrong model into
 * a number somebody could be asked to pay.
 */

/** The machine code, so a client can tell this from an ordinary conflict. */
export const NO_TIER_BILLING_CODE = 'billing_model_retired';

/**
 * One sentence, for an owner or admin who pressed a button in their own
 * organisation. It says what would have been billed and what to do instead —
 * not "this endpoint is disabled", which tells somebody nothing.
 */
export const NO_TIER_BILLING_REASON =
  'This would issue an invoice for a pricing model Ownpace no longer sells. The published ' +
  'model is five tiers on two axes — migrations running at the same time, and data moved — ' +
  'and the invoice code still meters bytes and hours from the model that was retired on ' +
  '20 August 2026. It would also count every byte twice, once as storage and once as ' +
  'egress, and charge for items that moved nothing. Refusing is deliberate: a bill nobody ' +
  'can reconcile is worse than no bill. Nothing is wrong with your account, and no other ' +
  'billing screen is affected — usage and past invoices still read normally. Ask us for a ' +
  'figure and you will get one from a person until the tiers ship.';

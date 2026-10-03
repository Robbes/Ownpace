# ADR-0044: The books are not ours — an external bookkeeping system is the record for invoices

- **Status:** Accepted; one change decided and not in force (2026-08-29, confirmed by the owner
  2026-10-03): on erasure the mirror is purged and the Moneybird invoice numbers kept (*Pending*)
- **Date:** 2026-08-28
- **Deciders:** Owner, 2026-08-28 — three answers in conversation: *"an external
  bookkeeping system is the legal system of record"*, then *"ok, I stay the
  seller, we go with Moneybird"*, with credit notes in scope from the start and
  delivery as a PDF by email and in-app. The plan built on this is
  [workplan 0111](../workplans/0111-an-invoice-that-is-a-document.md).
- **Relates to:** [ADR-0014](./0014-cost-recovery-billing.md) (what is billed —
  untouched here; this ADR is about the *document*),
  [ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md)
  (the invoice mirror is managed-chain data; the appliance never bills),
  [ADR-0024](./0024-explicit-owner-deletion-apply.md) (immutability posture),
  [ADR-0009](./0009-repo-strategy-public-monorepo.md) (why the comparative
  vendor analysis and commercial rationale are recorded outside this
  repository, as business records — this ADR records only what the *product*
  must uphold).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **The legal system of record for invoices is Moneybird, not this product.** Moneybird assigns
  the number, applies the tax rate, renders the document and files it for the retention period. Ownpace is UPSTREAM of the
  record (it pushes the billable period) and a MIRROR of it (number, issue date, PDF, status
  pulled back): `packages/managed/src/moneybird-sales-invoices.ts`.
- **Ownpace never assigns an invoice number.** No code path may mint, alter or reuse one; the
  sequence is Moneybird's `invoice_sequence_id`:
  `packages/managed/src/moneybird-sales-invoices.unit.test.ts`.
- **Ownpace never renders an invoice document.** The customer, on the billing page, by email or
  via an operator (workplan 0110), is served Moneybird's PDF: one document per sale
  (*Consequences* below).
- **Creation is idempotent by `reference`**: a period-derived `reference` is set on create and
  looked up (`find_by_reference`) first, so a retried push cannot double-invoice (hard rule 1):
  `packages/managed/src/moneybird-sales-invoices.unit.test.ts`.
- **No VAT percentage lives in product code.** The treatment is a Moneybird `tax_rate_id` per
  invoice (`packages/managed/src/moneybird-tax-rates.ts`); the legacy display logic's `VAT_RATE` in
  `pricing.ts` must not spread: `scripts/a-rate-that-must-not-spread.unit.test.ts`.
- **An issued invoice is immutable in the mirror; a correction is a credit note** issued by
  Moneybird and mirrored, never an UPDATE to an issued row:
  `packages/managed/src/invoice-refusal-under-rls.unit.test.ts` (managed migration 0014).
- **The mirror is managed-chain data** (ADR-0036): the appliance carries no invoice tables'
  behaviour and no Moneybird credential (`apps/selfhost/src/no-managed-leakage.unit.test.ts`).
  Credentials ride `.env` (hard rule 3), never git, never the appliance image.
- **Pending (decided 2026-08-29, confirmed 2026-10-03, not in force):** on erasure the mirror is
  purged and only the Moneybird invoice numbers are kept (workplan 0111 T10). Until it is built,
  erasure detaches the invoices and keeps them (`offboarding.ts`; *Pending* below).

## Context

Migration 0001's own comments admitted the invoice rows were "amounts and no
identity" — no number, no seller, no buyer, no line items — and `tenant`
carries no address, country or VAT number, so the buyer did not exist as data.
0109 T0 had already stopped the minting of bills (`409 billing_model_retired`),
so nothing was wrong in production; but nothing could be charged either, and
making the rows legally complete meant choosing who owns numbering, rendering,
retention and correction.

Owning them in-product means building and *proving* gapless numbering under
concurrency and retries, per-country tax tables that change without notice,
long-horizon retention, and a credit-note chain — none of which is this
product's job, all of which is a bookkeeping system's entire job. The owner
chose to delegate the record and keep what cannot be delegated: **knowing the
customer** (who they are, where they are, and the evidence for it), which is
workplan 0111 T1–T3.

## Consequences

- Workplan 0111 T4–T7 build against Moneybird's published API surface (create,
  send, PDF download, credit note, tax rates, synchronization endpoints; UBL
  download available when structured e-invoicing becomes mandatory).
- The retained-invoice surface merged in #652 (migration 0011,
  `/support/retained-invoices`) was justified by "Ownpace keeps invoices for
  tax retention". With Moneybird as the record, that justification weakens to
  a convenience mirror — whether the mirror survives erasure or is purged with
  a pointer into Moneybird is an **open owner decision**, tracked as 0111's
  open question 2, deliberately not decided by this ADR.
- A second document generator (any PDF templating of invoices in this repo) is
  a violation of these rules, not a feature.

## Alternatives considered

- **Own the record in-product**: rejected — the compliance surface (numbering,
  rates, retention, corrections) is a bookkeeping product's core competence
  and this product's liability.
- **The payment provider's own invoicing product as the record**: rejected for
  now — invoicing is not bookkeeping (no ledger, no returns), and the product
  is months old; revisit only if the books and the documents can live in one
  system without giving up the ledger.
- **A Merchant of Record as the seller**: a commercial decision, recorded as
  business records outside this repository (ADR-0009's boundary); the product
  consequence is simply that Ownpace remains the seller and this ADR applies.

## Pending — on erasure, the mirror goes and the invoice numbers stay (decided 2026-08-29, confirmed 2026-10-03; not in force)

<!-- On build (ADR-0051): fold this into the operative rules and Consequences, remove the
     Pending bullet and this section, and log the change. -->

The *Consequences* above left open whether the mirror survives an organisation's erasure or is
purged with a pointer into Moneybird. Workplan 0111 recorded it as decided on 2026-08-29
(T10: *"purge the mirror on erasure, keep the pointer"*) without the owner's words; on
2026-10-03 the owner confirmed it: *"delete the copy, keep the numbers"*.

- **On erasure the mirror's rows go.** Moneybird holds every invoice for the full retention
  period, so keeping our copy after erasure is no longer what the retention obligation requires;
  it would be personal data kept for convenience (0111, *What this changes about erasure*).
- **`erasure_record` keeps only the Moneybird invoice numbers**, so the operator's answer to
  *"what about my invoices?"* is *"these numbers, held in Moneybird"*. That retires most of the
  retained-invoice screen (#652, `/support/retained-invoices`).

**Not built** (0111 T10, after the Moneybird adapter, T4). Today erasure detaches each invoice
from its organisation and keeps it (`RETAINED_TABLES.invoice` in
`packages/managed/src/offboarding.ts`, pinned by `offboarding.unit.test.ts`); no column holds a
Moneybird number yet; and the privacy policy says invoices are kept for seven years
(`site/legal/privacy.md`). The build changes all three together, with
`docs/operator-runbook.md`. Nothing is affected meanwhile: the Alpha issues no invoices.

## Amendment log

- **2026-10-03** — Operative rules cut to the [ADR-0051](./0051-an-adr-reads-as-it-stands.md) budget; nothing was
  decided. Two statements now say what holds: credentials ride `.env`, since there is no vault
  (hard rule 3), and `VAT_RATE` is no longer "pending" its task (workplan 0111 T3, built
  2026-08-29). Their earlier wording, with the reasons and examples the budget left out, is in the
  record: [history/0044-the-books-are-not-ours.md](./history/0044-the-books-are-not-ours.md).
- **2026-10-03, later** — The *Consequences*' open question is answered: on erasure the mirror is
  purged and the Moneybird invoice numbers kept (decided 2026-08-29 in workplan 0111 T10; the
  owner: *"delete the copy, keep the numbers"*). Not built, so it is *Pending*. Record: *Pending*.

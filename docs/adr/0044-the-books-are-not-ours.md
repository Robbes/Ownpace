# ADR-0044: The books are not ours — an external bookkeeping system is the record for invoices

- **Status:** Accepted
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
  [ADR-0024](./0024-non-destructive-by-default.md) (immutability posture),
  [ADR-0009](./0009-repo-strategy-public-monorepo.md) (why the comparative
  vendor analysis and commercial rationale are recorded outside this
  repository, as business records — this ADR records only what the *product*
  must uphold).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **The legal system of record for invoices is Moneybird, not this product.**
  Moneybird assigns the number, applies the tax rate, renders the document and
  files it for the retention period. Ownpace is UPSTREAM of the record (it
  pushes the billable period) and a MIRROR of it (number, issue date, PDF,
  status pulled back).
- **Ownpace never assigns an invoice number.** Gapless sequential numbering is
  the artefact auditors check; it belongs to the system that owns it
  (Moneybird's `invoice_sequence_id`). No code path may mint, alter or reuse a
  number.
- **Ownpace never renders an invoice document.** The customer — on the billing
  page, by email, or via an operator (workplan 0110) — is served Moneybird's
  PDF. Exactly one document may exist per sale; a second, self-rendered
  artefact is the failure mode this rule exists to prevent.
- **Creation is idempotent by `reference`.** Ownpace sets a period-derived
  `reference` on create and looks it up (`find_by_reference`) before creating,
  so a retried push cannot double-invoice — hard rule 1, satisfied at the seam.
- **No VAT percentage lives in product code.** The treatment is selected as a
  Moneybird `tax_rate_id` per invoice (workplan 0111 T3). `pricing.ts`'s
  `VAT_RATE` constant is legacy display logic pending that task and must not
  spread.
- **An issued invoice is immutable in the mirror; a correction is a credit
  note** issued by Moneybird and mirrored like any other document — never an
  UPDATE to an issued row.
- **The mirror is managed-chain data** (ADR-0036): the appliance carries no
  invoice tables' behaviour and no Moneybird credential. Credentials ride the
  vault/`.env`, never git, never the appliance image.

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

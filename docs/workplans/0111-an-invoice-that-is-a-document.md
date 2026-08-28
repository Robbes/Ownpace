# Workplan 0111 — an invoice that is a document

## Status — 2026-08-28 (update this block at the end of every session)

**Drafted for review. Nothing built.** Written after the owner answered four shaping
questions on 2026-08-28; those answers are §"The decided ground" and they change what this
is from "add some fields" into "wire a bookkeeping system in and stop pretending we are one".

**The one-line summary of the finding:** the `invoice` table has amounts and no identity.
There is no invoice number, no seller, no buyer, no address, no VAT number and no line
items — and `tenant` carries only `name`, `status` and `settings`, so **the buyer does not
exist as data anywhere in this product**. Migration 0001 already says the first half of this
in a comment; the second half is new and is the harder one, because a VAT treatment cannot be
decided without knowing who and where the customer is.

**Not legal advice, and this plan should not be the last word.** It is written from the EU
VAT Directive (2006/112/EC art. 226 — what an invoice must contain), the Dutch
implementation (Wet OB 1968 art. 35a) and the place-of-supply rules for digital services.
The accountant signs off before the first invoice leaves, and **T0 exists partly so somebody
qualified reads this.**

| Task | Status | Evidence |
|---|---|---|
| T0 Pick the bookkeeping system, and write the ADR | 📋 **Owner-gated — blocks everything below** | The owner chose "external bookkeeping issues them" on 2026-08-28 but not *which*. Moneybird, e-Boekhouden and Exact differ enough in API shape, OSS support and credit-note model that picking one is a design decision, not a config value. Also the moment to ask the accountant to read this plan. |
| T1 The buyer, as data | 📋 Planned (needs T0) | `tenant` has no address, no country and no VAT number. Nothing below can be right until it does. Includes the B2B/B2C distinction, which is not cosmetic — it selects an entirely different VAT rule. |
| T2 A VAT number that was actually checked | 📋 Planned (needs T1) | VIES validation with the consultation number stored. An unvalidated VAT number is not a defence; the consultation number is. |
| T3 VAT treatment: decided, recorded, never a constant | 📋 Planned (needs T1–T2) | `pricing.ts` hard-codes `VAT_RATE = 0.21`. With consumers in scope that is now **a stated correctness bug**, not a simplification. |
| T4 The bookkeeping adapter | 📋 Planned (needs T0–T3) | Push the billable period; get back a number, a PDF and a status. One seam, provider-shaped, like every other connector here. |
| T5 The mirror, and the number that is not ours | 📋 Planned (needs T4) | `invoice` becomes a MIRROR with the legal number on it. The distinction has to be in the schema, or somebody will renumber a document they do not own. |
| T6 Delivery: the email and the download | 📋 Planned (needs T5) | Serves **their** PDF, never one we render. Two documents for one sale is the failure this task exists to prevent. |
| T7 Credit notes | 📋 Planned (needs T5) | An issued invoice is immutable. A correction is a new document that references it. |
| T8 The price page stops promising 21% | 📋 Planned (needs T3) | 0088's calculator shows a VAT-inclusive figure computed from one rate. For a German consumer it is wrong. |
| T9 Retention, revisited now that we are not the record | 📋 Planned (needs T4) | **This partly undoes 0110's retained-invoice work, and that is the honest outcome.** See §"What this changes about erasure". |

## Why this exists

`POST /api/billing/invoices/generate` has answered `409 billing_model_retired` since
2026-08-27 (0109 T0). Nothing mints a bill today, which means **there is no compliance
problem in production right now** — and also no way to charge anybody. 0109 is rebuilding
*what the invoice says about usage*. This plan is about everything else on the page.

The split is worth stating because the two plans will land near each other:

- **0109 owns the LINE.** Which tier, what peak, on what date, with what evidence.
- **0111 owns the DOCUMENT.** Who issued it, to whom, under which number, with which VAT
  treatment, in what format, kept for how long, and how it is corrected.

An invoice can be perfectly right about usage and still not be an invoice.

## The decided ground (owner, 2026-08-28)

Four answers, each of which closed a fork:

1. **Customers are EU B2B *and* consumers.** So both regimes are in scope: reverse charge
   for VAT-registered businesses elsewhere in the EU, and destination-country VAT for
   consumers, which means OSS.
2. **An external bookkeeping system is the legal system of record.** It issues, numbers,
   renders and files. Ownpace feeds it and mirrors the result.
3. **The customer gets a PDF, by email and in the app.**
4. **Credit notes are in scope now**, not later.

Answer 2 is the one that shapes the architecture, and answers 1 and 3 interact with it in a
way worth being explicit about below.

## The design

### Ownpace is upstream of the record, and a mirror of it

```
  Ownpace                          Bookkeeping system
  ───────                          ──────────────────
  billable period  ──── push ───▶  assigns the NUMBER
  (who, where, what,               applies the VAT treatment
   which tier, amount)             renders the PDF
                                   files it for 7 years
  mirror  ◀──── pull ────────────  number, issue date, PDF, status
    │
    ├── shows it on the billing page
    ├── emails it
    └── shows it to an operator (0110)
```

**Ownpace must never render its own PDF.** With an external system of record, a
self-rendered document is a second artefact for one sale — a different layout, possibly a
different number, certainly a different total the moment a rounding rule differs. When a
customer forwards "the invoice" to their bookkeeper, exactly one document must exist. T6 is
written to make that structural rather than a habit.

**Ownpace must never assign a number.** Sequential, gapless numbering is the thing auditors
check and the thing that is hard to get right under concurrency, retries and rollbacks. We
chose not to own it; the schema should make it impossible to drift into owning it (T5).

What Ownpace *does* own, and cannot delegate, is **knowing the customer**. The bookkeeping
system can apply a VAT treatment but cannot decide one: it does not know whether the buyer is
a business, where they are, or what evidence we hold for that. That is T1–T3, and it is the
substance of this plan.

### The buyer, and why B2B/B2C is not a checkbox

For a digital service supplied electronically:

- **Business customer in another EU state, with a valid VAT number** → place of supply is
  the customer's country, VAT reverse-charged. Invoice shows 0%, the customer's VAT number,
  and the words *"btw verlegd / VAT reverse charged"*. Also goes on the quarterly **opgaaf
  ICP**.
- **Business or consumer in the Netherlands** → 21%, ordinary domestic invoice.
- **Consumer in another EU state** → VAT at **their** country's rate, declared through
  **OSS**. There is a **€10,000/year EU-wide threshold** below which a small supplier may
  keep charging domestic VAT instead; above it, OSS is not optional.
- **Outside the EU** → outside the scope of EU VAT, with wording to say so.

Two consequences that are easy to miss:

**A consumer's country has to be evidenced, not asked.** The VAT Implementing Regulation
(282/2011 art. 24b) wants **two non-contradictory pieces of evidence** for a consumer's
location — typically billing address plus IP country, or the bank/card country. One
self-declared dropdown is not enough, and a customer who declares one country while
everything else says another is a case the code has to have an answer for rather than
silently trusting the form.

**The threshold is a cliff with a date on it.** Crossing €10,000 changes the treatment
mid-year. Whatever T3 does must be able to say *which rule was applied to this invoice and
why*, at the time, rather than recomputing it later from a rule that has since changed —
the same reason `erasure_record` stores `backup_retention_days` as a number beside the date
it produced.

### The party snapshot, which 0110 already started

Migration 0001 added `billed_to_name` for a narrow reason: an erased tenant's invoice had to
be able to say who it was for. That instinct generalises, and this plan should finish it
rather than invent a parallel mechanism.

Everything the document asserts about either party is **captured at issue time and never
re-read**: seller name, address, KvK, VAT number; buyer name, address, country, VAT number,
and the treatment that was applied. A customer who moves office or renames their company
must not silently rewrite invoices already issued — and after an erasure there is nothing
left to read it from anyway.

The seller half comes from the `«PLACEHOLDER»` tokens 0086 T5 already tracks
(`«LEGAL_ENTITY»`, `«REGISTERED_ADDRESS»`, `«COMPANY_NUMBER»`, `«VAT_NUMBER»`). This plan
should consume that mechanism, not duplicate it: the same four facts, one source, and the
existing guard that fails on an unfilled one.

### Credit notes

An issued invoice is immutable. That is not a convention, it is the reason numbering means
anything. A correction is a **creditfactuur**: its own number from the same sequence, a
reference to the document it corrects, and the correction stated rather than the original
edited.

Because the bookkeeping system owns numbering, it owns credit notes too — Ownpace requests
one and mirrors it. What Ownpace must add is the **refusal**: no code path may update an
invoice that has been issued. Today `invoice.status` is mutable and nothing stops an
`UPDATE`. T7 should close that at the database, the way the rest of this repo does it,
rather than by everyone remembering.

### What this changes about erasure

**This is the part that partly undoes work merged this morning, and it should be decided
deliberately rather than discovered.**

0110's retained-invoice screen (and migration 0011) exists because Ownpace keeps invoices
after erasing a tenant, under the GDPR art. 17(3)(b) carve-out, for tax retention. That
justification assumed **Ownpace is the record**.

If the bookkeeping system is the record, it holds the invoice for seven years and Ownpace's
copy is a convenience mirror. Then keeping detached invoices in Ownpace after erasure is
**no longer required by the retention obligation** — and personal data kept without a
current justification is exactly what an erasure is supposed to remove. The cleaner posture
may be: purge the mirror on erasure, and let the operator's answer to *"what were we
obliged to keep"* be a link into the bookkeeping system.

Both are defensible. The choice is the owner's and it is listed in §"Still open". What
should **not** happen is the two coexisting by accident, with Ownpace holding erased
customers' billing details because a screen was built before the record moved.

## Where the cost is

| | |
|---|---|
| **T1–T3 (the buyer and the VAT treatment)** | The bulk. Not because the fields are hard but because the rules have branches, thresholds and evidence requirements, and each branch needs a test that fails when it is got wrong. |
| **T4 (the adapter)** | Moderate, and mostly shaped by T0's answer. The repo already has a provider-adapter pattern to follow. |
| **T9 (retention)** | Small in code, but it revisits a decision and may retire a screen. Cheap to do, expensive to leave ambiguous. |
| **T8 (the price page)** | Small, and easy to forget. A public page quoting one VAT rate to every visitor is a promise. |

## Not in this plan

- **Payment.** Mollie already exists; 0086 T6 owns the journey.
- **What the line says about usage.** 0109 T5.
- **Dunning, reminders, collections.** A separate concern and a separate tone of voice.
- **Peppol/UBL structured e-invoicing.** The owner chose PDF. EU ViDA will make structured
  intra-EU B2B e-invoicing mandatory later this decade, so this will come back — the adapter
  seam in T4 is the place it lands, and that is the only reason it is mentioned here.
- **Filing the VAT return.** The bookkeeping system's job, and the accountant's.

## Still open — owner decisions this plan cannot make

1. **Which bookkeeping system?** (T0, blocks everything.) Moneybird, e-Boekhouden, Exact,
   or the accountant's own. Worth asking the accountant which they would rather receive.
2. **Is OSS already registered, or under the €10,000 threshold today?** These are different
   code paths and the answer decides which ships first. Under the threshold with no
   consumers yet, T3 can start narrow and honest.
3. **Are consumer sales real or theoretical right now?** Invite-only and B2B in practice
   would let T1–T3 land B2B-first, with the consumer path built before the first consumer
   rather than before the first invoice.
4. **After erasure: purge the invoice mirror, or keep it?** See §"What this changes about
   erasure". This one has a merged screen riding on it.
5. **The four seller facts** — `«LEGAL_ENTITY»`, `«REGISTERED_ADDRESS»`, `«COMPANY_NUMBER»`,
   `«VAT_NUMBER»`. Already tracked by 0086 T5; nothing here can be tested end to end without
   them.
6. **Who signs this off?** The accountant reading this plan before T1 starts is cheaper than
   the accountant reading the first invoice after it has gone out.

# Workplan 0111 — an invoice that is a document

## Status — 2026-08-29 (update this block at the end of every session)

**T1–T3 are built (2026-08-29): the buyer exists as data, their VAT number can be
actually checked, and the treatment is a decision, not a constant.** Managed migration
0012 creates `billing_party` (consumer-shaped first); migration 0013 adds the
append-only `vat_consultation` log with the VIES client and check surface
(`VIES_REQUESTER_*` waiting on the entity decision); `vat-treatment.ts` +
`moneybird-tax-rates.ts` decide what an invoice carries and resolve it to the books'
own `tax_rate_id` — the legacy constant is contained by a repo-scan guard and survives
only for the usage estimate until T4/T8 rewire it. T4 (the adapter) is next and needs
the Moneybird trial + the foreign-VAT gating test. Earlier the same day: three more
owner decisions landed. T9 (billing shape),
the erasure-mirror question and the OSS timing are now decided — rows and §"What this
changes about erasure" updated; ADR-0044 records T0's operative rules. Still open: the
seller-entity facts (the operating entity is an accountant conversation) and the
sign-off (open decisions 4–5). Earlier: revised 2026-08-28 after the owner's second round —
**T0 decided (Moneybird)**, the market **consumer-primary, not B2B-primary**, and one claim
in the first draft corrected — see §"Who is the controller".

**The one-line summary of the finding:** the `invoice` table has amounts and no identity.
There is no invoice number, no seller, no buyer, no address, no VAT number and no line
items — and `tenant` carries only `name`, `status` and `settings`, so **the buyer does not
exist as data anywhere in this product**. Migration 0001 already says the first half of this
in a comment; the second half is new and is the harder one, because a VAT treatment cannot be
decided without knowing who and where the customer is.

**Not legal advice, and this plan should not be the last word.** It is written from the EU
VAT Directive (2006/112/EC art. 226 — what an invoice must contain), the Dutch
implementation (Wet OB 1968 art. 35a), the place-of-supply rules for digital services, and
GDPR art. 2(2)(c) with recital 18. **Consumers being the primary market pulls consumer
contract law and a GDPR question into scope that an invoicing plan should not be deciding
alone** — see §"Who is the controller" and the cross-reference to 0086 T5.

| Task | Status | Evidence |
|---|---|---|
| T0 Pick the bookkeeping system | ✅ **Decided 2026-08-28: Moneybird** | Dutch, EU-hosted. **API on every tier including Compact**, ICP-aangifte on every tier, Peppol sending on every tier. Its OpenAPI spec (`github.com/moneybird/openapi`, read 2026-08-28) covers everything T4–T7 need. Runner-up e-Boekhouden (€7.95/mo) on cost alone. ADR: [ADR-0044](../adr/0044-the-books-are-not-ours.md) (2026-08-29) — the operative rules the build must uphold; the comparative analysis is a business record per ADR-0009. Still needs the accountant's read. |
| T1 The buyer, as data | ✅ **Built 2026-08-29** | Managed migration 0012: `billing_party`, one row per tenant, **`kind` defaults to `consumer` and the business case is the variant** — the database itself refuses a consumer carrying a VAT number (`billing_party_vat_number_check`), and a business without one stays legal. `GET/PUT /api/billing/party` (owner/admin; the PUT is an upsert a retry converges on), the billing page's "Invoice details" card in both languages, and erasure updated: the purge stamps the **buyer's** name onto detached invoices, then purges the row (`PURGED_TABLES` — a consumer's row is a person's name and home address). Deliberately absent, per the plan: VAT-number validation (T2) and the country *decision* (T3 — what is stored is the customer's statement). |
| T2 A VAT number that was actually checked | ✅ **Built 2026-08-29** | Managed migration 0013: `vat_consultation`, an **append-only** evidence log — `app_user` holds INSERT and SELECT only (UPDATE/DELETE revoked; evidence that can be edited proves nothing). `POST /api/billing/party/check-vat` consults VIES's REST API and stores the answer; **a row is always an answer** — an unreachable VIES (MS_UNAVAILABLE and friends, tested against a fault that carries `valid:false` beside its error code) answers 503 and stores nothing. The check is **qualified** — consultation number issued — once `VIES_REQUESTER_MEMBER_STATE`/`VIES_REQUESTER_VAT_NUMBER` carry the seller's own number (blocked on the entity decision; until then checks run unqualified and the screen says so). VIES geography handled: EL not GR, XI exists, GB refused as never-checkable. The GET join speaks only for the number as currently stored; the billing card shows the verdict, auto-checks a newly saved business number, and renders VIES's own refusal sentences. Still open here: whether the consultation should also ride onto the Moneybird document — noted for T4. |
| T3 VAT treatment: decided, recorded, never a constant | ✅ **Built 2026-08-29** | `vat-treatment.ts`: the decision as a pure, total function — domestic buyers domestic; EU B2B **reverse charge only with a valid VIES consultation** (without one, charged like a consumer *on purpose*: over-charging is the buyer's money and a credit note fixes it, under-charging is the seller's liability); EU consumers at the seller rate until `VAT_OSS_ACTIVE` flips (owner's threshold decision); non-EU an export — GB stays outside even with an XI number (services, not goods). `moneybird-tax-rates.ts`: treatment → the administration's own `tax_rate_id`, **operator-configured and validated against the real list** (a deleted/archived/purchase rate refuses by name) — no percentage is ever consulted for selection. `GET /api/billing/party` serves the decision; the billing card says it in both languages. The legacy constant survives ONLY for the usage-screen estimate, pinned by `scripts/a-rate-that-must-not-spread.unit.test.ts` (a new caller fails CI). Remaining for T4/T8: point the resolver at the real administration and rewire the estimate/price page. |
| T4 The Moneybird adapter | ✅ **Core seam built 2026-08-29** — wiring + live proof gated on the trial | `moneybird-sales-invoices.ts`: `ensureContact` (found by OUR `customer_id` key, matched exactly against the fuzzy search), `ensureSalesInvoiceByReference` (look-then-create; an existing invoice is returned **as it stands, never patched** — the correction instrument is T7's credit note), and `sendSalesInvoice` (the moment Moneybird assigns the legal number). The sharpest pin: **an uncertain lookup never falls through to create** — a 500 on `find_by_reference` is `unavailable` with zero POSTs, because "could not look" read as "not found" is how a flaky afternoon double-invoices a customer. Lines carry `tax_rate_id` and nothing else (a test asserts the wire body never contains "percentage"). Injectable fetch throughout; config is parameters, no env reads. **Still gated on the owner**: the trial administration + tax-rate ids, the German-19% gating test (business repo), stamping the T2 consultation number onto the document, and the route/worker wiring against 0109's tiers. |
| T5 The mirror, and the number that is not ours | 📋 Planned (needs T4) | `invoice` becomes a MIRROR carrying the legal number. Moneybird owns `invoice_sequence_id`; the schema must make it impossible to drift into numbering a document we do not own. |
| T6 Delivery: the email and the download | 📋 Planned (needs T5) | `GET /sales_invoices/{id}/download_pdf`. Serves **their** PDF, never one we render. Two documents for one sale is the failure this task exists to prevent. |
| T7 Credit notes | 📋 Planned (needs T5) | `PATCH /sales_invoices/{id}/duplicate_creditinvoice`. An issued invoice is immutable; `invoice.status` is mutable today and nothing stops an `UPDATE`. Close that at the database. |
| T8 The price page stops promising 21% | 📋 Planned (needs T3) | 0088's calculator computes one VAT-inclusive figure. For consumers this is not cosmetic: **consumers must be shown a price including VAT**, so the field is legally required and currently wrong for anyone outside NL. |
| T9 Billing frequency, decided rather than defaulted | ✅ **Decided 2026-08-29: monthly AND annual, annual discounted** | The owner's framing decides it: the service is not a one-shot move but *"an operational exit strategy waiting for the cutover"*, sometimes used serially to move a family one person at a time — so a subscription is honest, and the discounted annual is the fee-efficient path (one charge ≈0.3% vs ≈3.4% monthly, §below) offered rather than imposed. T4's invoice shape: recurring, both cadences. |
| T10 Retention, revisited now that we are not the record | ✅ **Decided 2026-08-29: purge the mirror on erasure, keep the pointer** — build remains (needs T4) | On erasure the mirror rows go; `erasure_record` keeps only the Moneybird invoice numbers, and the operator's answer becomes "these numbers, held in Moneybird". Retires most of #652's screen — the honest outcome §"What this changes about erasure" predicted. |

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

1. **Customers are EU consumers first, businesses second.** The owner's words: families —
   *"a dad or mom that migrates themselves and kids along the way"* — rationalising onto EU
   services. The first draft assumed B2B-primary and was rewritten.
2. **An external bookkeeping system is the legal system of record.** It issues, numbers,
   renders and files. Ownpace feeds it and mirrors the result.
3. **That system is Moneybird** (T0).
4. **The customer gets a PDF, by email and in the app.**
5. **Credit notes are in scope now**, not later.
6. **Mollie stays** for payment. It is already built (0086 T6) and at these amounts is the
   cheapest option available — see §"Billing frequency".

Three more, 2026-08-29:

7. **Billing shape: monthly and annual, annual discounted** (T9 — the reasoning is in that
   row: a standing exit posture, not a one-shot move).
8. **On erasure the invoice mirror is purged; only the Moneybird numbers remain** (T10).
9. **OSS waits for the threshold**: Dutch 21% to every EU consumer until a quarter's
   forecast crosses €10k cross-border; T3 is built so the switch is a config change and a
   date.

## Three vocabularies, and why they keep colliding

The owner asked, correctly: *"do you see them as operator, or are we mixing up with the
managed overall operator and 'Owner' of accounts?"* Three independent vocabularies use
overlapping words, and this plan touches all three:

| Vocabulary | Terms | What it governs |
|---|---|---|
| **Product roles** | `platform_operator`; tenant `owner` / `admin` / `member` / `viewer` | what a signed-in person can *do in the app* |
| **Commercial** | seller ↔ customer | who pays, and whose name is on the invoice |
| **Data protection** | controller / processor / data subject | who is legally accountable for personal data |

**"Operator" in this repo means the platform operator** — the support role of workplan 0110,
cross-tenant, and nothing to do with GDPR. **A tenant `owner` is a product role and does not
make somebody a GDPR controller.** A parent can hold `owner`, control everything in the
product and pay every invoice, and still not be a controller in law. Nothing below should
reuse "operator" or "owner" when it means "controller".

## Who is the controller — a correction

The first draft of this plan said Ownpace *"becomes the controller"* for consumer customers.
**That was too broad and is corrected here.** `site/legal/privacy.md` §3 already splits it,
and the split is right:

- **Account data** — sign-in, billing, support correspondence: **Ownpace is controller.**
  Already true for every customer. Consumers change nothing here.
- **Migration content**: the customer is controller, Ownpace the processor.

The narrower thing that genuinely does not hold for families is the **processor** half. It
assumes a controller on the other side who is subject to the GDPR. For a household customer
there is not one:

- **Art. 2(2)(c)** exempts processing *"by a natural person in the course of a purely
  personal or household activity"*. A parent moving the family's mail is outside the
  Regulation and carries no controller obligations.
- **Recital 18** confirms the exemption does **not** reach the provider: the Regulation still
  applies to those who provide the means for such processing.

So Ownpace cannot describe itself as acting *"on the controller's instructions"* when the
instructing person has no controllership to give — and in practice Ownpace determines the
purposes and means anyway: it designs the service, sets retention, chooses sub-processors
and decides the security posture. The likely correct reading is **controller for content
too, in the household case**, on Art. 6(1)(b) contract.

**This is 0086 T5's territory, not this plan's, and it is on that plan's critical path.**
Specifically it needs:

- `site/legal/privacy.md` §3 gains a **third branch** — a private individual migrating their
  own or their family's mail. The current parenthetical *"(or, for an organisation, your
  administrator)"* cannot carry that case.
- `site/legal/README.md`'s summary line — *"We are a processor for migration content, a
  controller for the account"* — becomes true-for-business and incomplete-for-consumers.
- The **DPA stays a business instrument.** A family neither gets nor needs one, which means
  the privacy policy has to carry what the DPA would have said.
- **Third parties in the mailbox.** A child's mail contains messages from teachers, friends
  and other families who never contracted with anybody. The parent's household exemption
  covers the parent; it covers nothing for Ownpace. This is the sharpest reason the
  provider-side analysis matters, and it wants a lawyer's eye rather than this plan's.

## What consumers change beyond VAT

Also 0086 T5's, listed here because they were found while writing this and would otherwise
be found after launch:

- **Prices must be shown including VAT to consumers.** That makes 0088's calculator a
  legally-required field rather than a courtesy, and under OSS the inclusive figure differs
  per country.
- **Right of withdrawal.** Consumers get 14 days. For a digital service that starts
  immediately, the customer must explicitly consent to begin *and* acknowledge losing the
  right. Without that captured, somebody can have their mail migrated and then withdraw.
- **Consumer terms are not business terms.** Unfair-terms rules apply, and the current terms
  are written business-shaped.

## The design

### Ownpace is upstream of the record, and a mirror of it

```
  Ownpace                          Moneybird
  ───────                          ─────────
  billable period  ──── push ───▶  assigns the NUMBER (invoice_sequence_id)
  (who, where, what,               applies the tax rate we selected
   which tier, amount)             renders the PDF
                                   files it (7 yr NL / 10 yr OSS)
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

What Ownpace *does* own, and cannot delegate, is **knowing the customer**. Moneybird can
apply a tax rate but cannot decide one: it does not know whether the buyer is a business,
where they are, or what evidence we hold for that. That is T1–T3, and it is the substance of
this plan.

### What the Moneybird API actually gives us

Read from `github.com/moneybird/openapi` on 2026-08-28 rather than from documentation prose,
so T4–T7 are designed against the real surface:

| Need | Endpoint |
|---|---|
| Create the invoice | `POST /{administration_id}/sales_invoices` |
| **Idempotency** | set `reference` on create; `GET /sales_invoices/find_by_reference/{reference}` |
| Send it | `PATCH /sales_invoices/{id}/send_invoice` |
| The PDF (T6) | `GET /sales_invoices/{id}/download_pdf` |
| Credit note (T7) | `PATCH /sales_invoices/{id}/duplicate_creditinvoice` |
| Tax rates (T3) | `GET /tax_rates` |
| Mirror efficiently (T5) | `GET /sales_invoices/synchronization` |
| Payment state | `PATCH /sales_invoices/{id}/register_payment` |
| ViDA later | `GET /sales_invoices/{id}/download_ubl` |

Two things worth carrying into the tasks. **`reference` plus `find_by_reference` is the
idempotency key** — a period key we choose, looked up before creating, so a retried push
cannot mint a second invoice. And **the spec never mentions reverse charge or OSS**, because
those live in tax rates configured in the administration. That is the right seam: T3 selects
a `tax_rate_id` and no percentage is ever written in our code.

**Known risk, recorded now.** Moneybird's support for *foreign* VAT rates is reported as
weak — extra rates are described as a hidden feature, and it is called out as not
necessarily the best answer when you owe VAT in several EU states. Irrelevant below the
threshold, and precisely the axis that matters above it for a consumer-primary business.
**T3 should begin by testing it**: create a German consumer invoice at 19% in a trial
administration and see whether the OSS overview picks it up. If that is painful, the switch
to e-Boekhouden or Exact is cheap while there are few invoices — and expensive later.

### The buyer, consumer-first

For a digital service supplied electronically:

- **Consumer or business in the Netherlands** → 21%, ordinary domestic invoice.
- **Consumer in another EU state** → VAT at **their** country's rate, declared through
  **OSS**. Below a **€10,000/year EU-wide threshold** — counting cross-border B2C only, not
  Dutch sales — a small supplier may keep charging Dutch VAT instead. Above it, OSS is not
  optional.
- **Business in another EU state, with a valid VAT number** → reverse charge. Invoice shows
  0%, the customer's VAT number, and *"btw verlegd / VAT reverse charged"*. Also on the
  quarterly **opgaaf ICP**, which applies at any turnover.
- **Outside the EU** → outside the scope of EU VAT, with wording to say so.

**At €9.99/month the threshold is roughly 85 non-Dutch consumers billed for a year.** If the
first families are Dutch there is real runway; if they are spread across the EU, OSS arrives
early. T3 must therefore be built so that crossing the threshold is a configuration change
and a date, not a rewrite.

**A consumer's country has to be evidenced, not asked.** The VAT Implementing Regulation
(282/2011 art. 24b) wants **two non-contradictory pieces of evidence** — typically billing
address plus IP country, or the bank/card country. One self-declared dropdown is not enough,
and a customer whose declared country contradicts everything else is a case the code must
have an answer for rather than silently trusting the form.

**Retention is seven years, except where it is ten.** The Dutch general obligation
(`fiscale bewaarplicht`) is seven. **OSS records are ten**, counted from 31 December of the
transaction year, and the obligation survives deregistration — so the retention promise
changes length at the same threshold that changes the VAT treatment. Verified 2026-08-28; it
was written as seven throughout the first draft, which was wrong.

### The party snapshot, which 0110 already started

Migration 0001 added `billed_to_name` for a narrow reason: an erased tenant's invoice had to
be able to say who it was for. That instinct generalises, and this plan should finish it
rather than invent a parallel mechanism.

Everything the document asserts about either party is **captured at issue time and never
re-read**: seller name, address, KvK, VAT number; buyer name, address, country, VAT number
where there is one, and the treatment applied with the evidence behind it. A customer who
moves house must not silently rewrite invoices already issued — and after an erasure there is
nothing left to read it from anyway.

The seller half comes from the `«PLACEHOLDER»` tokens 0086 T5 already tracks
(`«LEGAL_ENTITY»`, `«REGISTERED_ADDRESS»`, `«COMPANY_NUMBER»`, `«VAT_NUMBER»`). This plan
consumes that mechanism rather than duplicating it: the same facts, one source, and the
existing guard that fails on an unfilled one.

### Billing frequency is the biggest number in this plan

At a €9.99 base fee, **fixed per-transaction costs dominate and the payment provider barely
matters**:

| Method | Fee | On €9.99 |
|---|---|---|
| Mollie iDEAL | €0.32 | 3.2% |
| Mollie SEPA Direct Debit | €0.35 | 3.5% |
| Mollie EU consumer card | 1.80% + €0.25 | 4.3% |
| Stripe SEPA Direct Debit | 0.8% + €0.30 | 3.8% |

Mollie is cheapest at this size, is Dutch, is iDEAL-native — which is what NL consumers
actually use — and is already built. **Keep it.**

The lever is not the provider. **One annual charge of €119.88 costs €0.35 — about 0.3%
instead of 3.4%,** and removes eleven failed-payment and dunning opportunities per customer
per year. And the model itself deserves the question: a family rationalising onto EU services
migrates **once**. If the engagement is finite, charging once or a few times collapses
payment fees, dunning, churn admin and bank-transaction count at the same time. **T9 decides
this before T4 is built**, because the invoice shape follows from it.

One operational note: Mollie settles in **batched payouts**, so Moneybird sees one bank
transaction per payout rather than per customer payment. With weekly payouts that is four or
five a month plus Ownpace's own costs — comfortably inside Start's twenty, for a long time.
Worth setting deliberately rather than leaving on the default.

### Credit notes

An issued invoice is immutable. That is not a convention, it is the reason numbering means
anything. A correction is a **creditfactuur**: its own number from the same sequence, a
reference to the document it corrects, and the correction stated rather than the original
edited. Moneybird owns that too, via `duplicate_creditinvoice`.

What Ownpace must add is the **refusal**: no code path may update an invoice that has been
issued. Today `invoice.status` is mutable and nothing stops an `UPDATE`. T7 should close that
at the database, the way the rest of this repo does it, rather than by everyone remembering.

### What this changes about erasure

**This partly undoes work merged on 2026-08-28, and it should be decided deliberately rather
than discovered.**

0110's retained-invoice screen (and managed migration 0011) exists because Ownpace keeps
invoices after erasing a tenant, under the GDPR art. 17(3)(b) carve-out, for tax retention.
That justification assumed **Ownpace is the record**.

Moneybird is the record. It holds the invoice for the full retention period, and Ownpace's
copy is a convenience mirror. Keeping detached invoices here after erasure is then **no
longer required by the retention obligation** — and personal data kept without a current
justification is exactly what an erasure is supposed to remove. The cleaner posture may be:
purge the mirror on erasure, and let the operator's answer to *"what were we obliged to
keep"* be a link into Moneybird.

**Decided 2026-08-29: purge the mirror, keep the pointer.** On erasure the mirror rows go
and `erasure_record` retains only the Moneybird invoice numbers — a number identifies a
document without identifying a person, so the erasure stays an erasure and the
administrative answer stays answerable. T10 reshapes #652's screen accordingly.

## Where the cost is

| | |
|---|---|
| **T1–T3 (the buyer and the VAT treatment)** | The bulk, and more than the first draft assumed: consumer-primary means OSS, per-country rates and the evidence rule are load-bearing rather than edge cases. |
| **T4–T7 (the adapter)** | Smaller than expected. The API covers every need directly, and idempotency comes free with `reference`. |
| **T9 (billing frequency)** | Nearly no code, and the largest financial effect in the plan. |
| **T10 (retention)** | Small in code, but it revisits a decision and may retire a screen. Cheap to do, expensive to leave ambiguous. |
| **T8 (the price page)** | Small, easy to forget, and now legally required rather than cosmetic. |

## Not in this plan

- **Payment.** Mollie exists and stays; 0086 T6 owns the journey.
- **What the line says about usage.** 0109 T5.
- **The consumer-law and controller items.** Named here because they were found here; they
  belong to **0086 T5**, which is already the critical path.
- **Dunning, reminders, collections.** A separate concern and a separate tone of voice.
- **Peppol/UBL structured e-invoicing.** The owner chose PDF, and Moneybird sends via Peppol
  on every tier with `download_ubl` available — so when EU ViDA makes intra-EU B2B
  e-invoicing mandatory around July 2030 this is a call, not a migration.
- **Filing the VAT return.** Moneybird's job, and the accountant's.

## Still open — owner decisions this plan cannot make

1. ~~Billing frequency~~ **Decided 2026-08-29** — T9 row.
2. ~~Erasure mirror~~ **Decided 2026-08-29: purge, keep pointer** — T10 row.
3. ~~OSS~~ **Decided 2026-08-29: under the threshold, register when a quarter's forecast
   crosses** — T3 ships the under-threshold path first, switch-ready.
4. **The four seller facts** — `«LEGAL_ENTITY»`, `«REGISTERED_ADDRESS»`, `«COMPANY_NUMBER»`,
   `«VAT_NUMBER»`. Already tracked by 0086 T5; nothing here can be tested end to end without
   them.
5. **Who signs this off?** The accountant on the VAT and the retention; a lawyer on the
   controller question and the consumer terms. Both cheaper before T1 than after the first
   invoice.

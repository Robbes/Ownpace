<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!--
  DRAFT FOR LEGAL REVIEW — v1.1, 2026-08-30. This comment never renders (the
  site generator strips HTML comments); it is the briefing for the reviewing
  lawyer. terms.nl.md mirrors this file section for section.

  What changed from v1.0, and the questions we want answered:

  1. §6 — prices are now stated VAT-inclusive, matching the pricing pages
     ("All prices include VAT.", consumer price-display rules). Invoices to
     business customers state their own VAT treatment (Dutch VAT, intra-EU
     reverse charge on a validated VAT number, or supply outside the EU).
     QUESTION: does one sentence cover both audiences, and for reverse-charge
     customers should the charged amount be the inclusive headline figure or
     that figure net of Dutch VAT?
  2. §7 — NEW: the consumer right of withdrawal (Directive 2011/83/EU;
     art. 6:230o BW ff.). We start performing during the withdrawal period at
     the customer's express request, and on withdrawal charge the
     proportionate amount (art. 6:230s lid 4 BW). QUESTIONS: is the
     express-request-plus-acknowledgment wording strong enough as consent
     collected at first-migration creation; how should the one-off setup fee
     sit inside "proportionate"; and §15 adapts Annex I(B)'s (*)-markers into
     I/we-slashes for rendering reasons — acceptable, or must the form be
     reproduced with the markers?
  3. §8 — renewal rewritten for the Wet Van Dam: after an initial term the
     subscription continues month to month, cancellable at any time effective
     end of month (better than the one-month statutory ceiling). We apply the
     consumer rule to every customer. QUESTION: confirm the wording, and
     whether a discounted prepaid term (mid-term cancellation runs to the end
     of the paid period, no pro-rata refund) is compatible with it, with §7,
     and with art. 6:236/6:237 BW.
  4. §10 — liability: the cap at twelve months' fees with the consumer
     carve-out. QUESTION: does this survive the grey/black lists
     (art. 6:236/6:237 BW) for consumers as written, or does it need a
     consumer-specific clause?
  5. §13 — the EU ODR platform this section used to reference was
     discontinued in July 2025; it now points to our own complaints handling
     and to the European Consumer Centres network. QUESTION: is anything else
     mandatory to name here (e.g. a recognised NL disputes committee)?
  6. §13 — language: English prevails, Dutch is a courtesy translation,
     except where mandatory consumer law provides otherwise. Tenable toward
     Dutch consumers buying on a Dutch-language page?
  7. §4 — the data-processing agreement is "available on request" until
     published. Acceptable as a transitional state toward business customers
     (art. 28 GDPR)?
  8. §8 — the promise never to bill past twelve months without express
     reconfirmation now says a prepaid term counts as that confirmation for
     the period it covers. Sound?
  9. Entity facts filled 2026-08-30 from the owner's decision: the trader is
     **Archico B.V.** (KvK 73922706, seat Wijhe), and §13 names the competent
     court in **Overijssel** (derived from the seat — confirm the forum
     wording). Still tokens: «REGISTERED_ADDRESS» (the owner decides the
     printed form) and «VAT_NUMBER» (the btw-id, from the accountant).
     QUESTION: does "Ownpace" need registering as a handelsnaam of
     Archico B.V. before these terms publish under that brand?
  10. The privacy policy is incorporated by reference (§4); its own revision
      (roles per ADR-0035: processor for migrated content, controller for
      account data) is a separate pass, not in this draft.
-->

# Terms of service

**Applies to:** the Ownpace **managed service** at `ownpace.eu`.
**Version:** 1.1 (draft for legal review — not yet published; see `site/legal/README.md`)
**Last updated:** 2026-08-30

> **These terms do not govern the software.** Ownpace is open source under the Apache
> License 2.0, and running it yourself is governed by that licence and nothing here. These
> terms govern the *service* we operate for you. The distinction is real: the licence gives you
> the right to run, modify and distribute the software; these terms are a contract about a
> service we run. Neither one limits the other.

---

## 1. Who you are contracting with

Archico B.V., «REGISTERED_ADDRESS», registered under KvK number 73922706, VAT «VAT_NUMBER».
Contact: **support@ownpace.eu**.

By creating an account or using the service you accept these terms. If you are accepting on
behalf of an organisation, you confirm you may bind it.

## 2. What the service does

Ownpace copies your mail, contacts, calendars and files from a source account you control to a
target account you control, keeps the copy in step until you decide to switch over, and gives
you a record of what moved.

**What it will not do, stated here rather than discovered:**

- **It never deletes anything at your source.** Deletion at the target only ever happens
  through a path you switch on and approve item by item.
- **It does not sync back.** Data flows source → target. Your source remains your fallback for
  as long as you keep it.
- **It cannot promise a perfect copy of everything.** Formats differ between providers, and
  some things do not survive the crossing. What we cannot move is **reported to you, item by
  item, with the reason** — never silently dropped.
- **It is not a backup service.** Once you cut a migration over, it is finished. Keeping a
  copy in step afterwards is a new migration you configure, and it is priced as one.

## 3. Your account

You are responsible for your credentials and for what happens under your account. Tell us at
support@ownpace.eu if you think it has been compromised.

You must have the right to access the accounts you connect. **Do not connect an account that
is not yours or that you are not authorised to migrate.** For an organisation's accounts, that
means authorisation from the organisation. For another person's private account — a family
member's, say — it means that person's permission.

## 4. Your data, and what we may do with it

Your data stays yours. We process it only to run the migrations you configure, as set out in
the [privacy policy](./privacy.html), which forms part of these terms. Business customers are
additionally covered by our data-processing agreement — until it is published here, it is
**available on request** at support@ownpace.eu.

**We do not read your mail, files, contacts or calendars**, other than in the narrow cases the
privacy policy lists — your own request for specific items, security or legal necessity, and
aggregated figures identifying nobody. We do not use your data to train any AI model.

## 5. Acceptable use

Do not use the service to infringe anyone's rights, to break the law, to migrate data you have
no right to, or to attack the service or the providers it connects to. Do not resell the
service as your own without a written agreement — an MSP tier exists for that and we would
rather talk.

We may suspend an account that is doing one of those things. Except where the law or an
ongoing attack makes it impossible, **we will tell you why first and give you a chance to
respond.**

## 6. Prices, and what you are paying for

Prices are published in full on [the pricing page](./pricing.html). There is no quote-gating
and no price you only learn after speaking to somebody.

- Your tier is **derived from what you use** — how many migrations run at the same time, and
  how much data you have moved — not chosen from a menu.
- **Finishing migrations lowers your bill automatically**, without you asking. The amount of
  data you have moved sets a floor.
- The setup fee is charged **once**, on the highest tier you reach. Moving up later costs only
  the difference; moving back down never re-charges it.
- **Prices include VAT.** What you see is what you pay. Invoices to business customers state
  the VAT treatment that applies to them — Dutch VAT, intra-EU reverse charge on a validated
  VAT number, or supply outside the EU.

**Cost recovery, not profit**: the service is priced to cover what it costs to run. That is a
statement of intent about how prices are set, not a promise that any particular price will
never change.

## 7. Your right of withdrawal

If you are a **consumer**, you may withdraw from this contract within **14 days** of
concluding it, without giving a reason.

The service starts during those 14 days — that is the point of it. By creating your first
migration you **expressly request** that we begin before the withdrawal period ends, and you
acknowledge what that means: if you then withdraw, you pay for the part of the service already
provided, **in proportion to the agreed price**, and no more. Setup work already done counts
as part of what was provided. Withdrawing does not touch your data at your source or your
target; the promises of §2 hold throughout.

To withdraw, send an unambiguous statement to **support@ownpace.eu** within the 14 days. You
may use the model form in §15, but you do not have to. We confirm receipt by email without
delay. If you have already paid, we refund everything above the proportionate amount within 14
days, by the means of payment you used; if nothing has been paid yet — billing is in arrears —
we invoice the proportionate amount and nothing else.

If you are a business customer, this section does not apply to you.

## 8. Billing, renewal, and not billing you for forgetting

Billing is **monthly in arrears**, by the payment method you registered, through our payment
provider Mollie. If we offer a discounted term paid up front — a year, say — and you choose
it, that term is billed at its start; the discount is the price of the commitment.

**You can cancel a monthly subscription at any time**, effective at the end of the current
month. There is no minimum term, no notice period and no cancellation fee. Setup fees already
paid are not refunded — the work they paid for was done.

**A prepaid term runs to its end** if you cancel during it; it is not refunded pro rata,
because the discount was already the price of the commitment. After an initial term, a
subscription **continues month to month**, and you cancel it like any monthly subscription: at
any time, effective at the end of the current month — for consumers that is the law, and we
apply it to everyone. A prepaid term never renews as another prepaid term without you choosing
it again.

Two commitments that constrain us rather than you:

- **We do not bill you for inattention.** If a migration is running with nothing to do, we ask
  you periodically whether to keep it or finish it, in one click.
- **We do not bill beyond twelve months without your explicit confirmation.** A migration that
  has been running a year needs you to say so again — a prepaid term counts as that
  confirmation for the period it covers.

If a payment fails we will tell you and try again before anything is suspended. We will not
delete your migration data because of a failed payment without warning you first.

## 9. Availability

We aim to keep the service running and will tell you about planned maintenance in advance. **We
do not offer a contractual uptime guarantee at these prices**, and saying so plainly is better
than a number nobody intends to honour.

A migration is designed to survive interruption: it resumes rather than restarting, and a
re-run converges instead of duplicating. Outage costs you time, not correctness.

**How fast a migration runs is not entirely ours to promise.** The providers on either side set
the pace — their rate limits and throttling are a ceiling we work under, not around — so we
promise convergence, not a completion date. Duration is a choice you make when you cut over,
not a prediction we sell.

## 10. If we get it wrong

We will fix it. Tell us at support@ownpace.eu.

To the extent the law allows, our total liability to you for any claim is limited to **the
amount you paid us in the twelve months before the claim**. We are not liable for indirect or
consequential loss, or for loss of data at your source or target where it was not caused by us.

**Nothing here limits liability that cannot lawfully be limited** — including death or personal
injury caused by negligence, fraud, or, if you are a consumer, your statutory rights. If you are
a consumer in the EU, you keep every right your national law gives you, and the paragraph above
applies only so far as that law permits.

**Keep your source account until you have checked your target.** The product is built so you
can — that is what cutting over on your own schedule means — and it is the single best
protection against anything in this section mattering.

## 11. Ending it

**You** may close your account at any time. On closure we delete your credentials and your
migration ledger as set out in the privacy policy; invoices are kept as long as tax law
requires.

**We** may end these terms with 30 days' notice, or immediately for a serious breach of §5. If
we discontinue the service, **you get at least 90 days' notice and an export of everything the
service holds about your migrations** — and the software is Apache-2.0, so you can keep running
it yourself.

## 12. Changes to these terms

Material changes are notified by email at least **30 days** in advance. If you do not accept
them, cancel before they take effect. Continuing to use the service after that is acceptance.

## 13. Law and disputes

These terms are governed by **Dutch law**, and disputes go to the competent court in
Overijssel. If you are a consumer, this does not deprive you of the protection of the
mandatory law of your country of residence, nor of your right to bring proceedings before the
courts of your own country.

**Complaints first.** Tell us what went wrong at support@ownpace.eu — we respond within 14
days. If you are a consumer and we cannot resolve it together, the **European Consumer Centres
network (ECC-Net)** advises and mediates free of charge in cross-border disputes.

**Language.** The Dutch text of these terms is a courtesy translation. Where the two versions
differ, the **English version** governs, except where mandatory consumer law provides
otherwise.

## 14. The rest

If a provision is unenforceable, the rest stands. Not enforcing something once does not waive
it. You may not transfer these terms without our consent; we may transfer them to a successor
of the business, and will tell you if we do.

## 15. Annex — model withdrawal form

Complete and return this form only if you wish to withdraw from the contract.

- To: Archico B.V., «REGISTERED_ADDRESS», email: support@ownpace.eu
- I/we hereby give notice that I/we withdraw from my/our contract for the provision of the
  following service: the Ownpace managed service, for the account on this email address: …
- Ordered on: …
- Name of consumer(s): …
- Address of consumer(s): …
- Signature of consumer(s) (only if this form is notified on paper): …
- Date: …

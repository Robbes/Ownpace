<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!--
  DRAFT — v1.3, 2026-09-28, for the owner's review first (this briefing began
  with v1.1, 2026-08-30). This comment never renders (the site generator strips
  HTML comments); it is the briefing for the reviewing lawyer. terms.nl.md
  mirrors this file section for section.

  Where things stand on 2026-09-28:

  - The lawyer's pass (workplan 0139 T1) is deferred by the owner: "legal:
    keep as is for now" (2026-09-27). The owner took the Alpha conditions
    (alpha.md) as version 1.0 without it.
  - The Alpha conditions are an addendum to these terms. Their §2 sets aside
    §6, §7, §8, §15, and the notice periods in §11's second paragraph, during
    the Alpha, and says the conditions prevail where they differ. They cite
    §6 to §11 and §15 by number, and "§11, second paragraph"; their briefing
    also discusses §12 and §13. So no section
    and no paragraph of §11 moves.
  - The Alpha is free, invite-only, and for households only: "tester:
    households only for now." (0139 open question 6, 2026-09-28). Every tester
    takes part as a consumer, and the Alpha is in Dutch (0139 D2); where
    testers live is not recorded, and questions 14 and 15 turn on it. The
    data-processing agreement is part of no Alpha contract.

  Before the draft marker comes off the Version line, these must be true, or
  the sentence that relies on them must change:

  A. §1: before the first connection we give the tester these texts with
     their version numbers and ask them to accept, we keep a record of which
     versions and when, and they can be saved or printed from this site. The
     wording names no screen, so it holds for 0139 T3 (a screen and a table;
     proposed, not built) and for a route the owner runs by hand, such as the
     texts sent by mail and accepted in a reply the owner keeps. One of the
     two must exist before the first invitation (question 12), and the texts
     must be served: live's WWW_LIVE is false, and T10 does not yet render the
     Alpha conditions. Today neither exists.
  B. §11: "From the moment your account is closed, nothing uses the access you
     gave us." The Alpha conditions §10 promise the same. On main at 683525c8,
     closing an organisation does not stop new sync passes: ACTIVE_MAPPINGS_SQL
     (apps/worker/src/jobs/managed-sync-tick.ts) never reads the
     organisation's status, and closeAccount cancels only the runs in flight.
     The fix is the closed-organisation task, not yet merged. A comment beside
     §11 says so in both languages; the sentence stays, because it is the
     owner's decision (0139 open question 3 (a)) and the fix makes it true.
  C. §6 and §7 name product steps that do not exist yet: the button to a paid
     tier that says the order carries an obligation to pay; the confirmation
     before the first migration, the confirming email, and "Withdraw from
     contract" in the app. Both sections are set aside during the Alpha, but
     they are rendered during it, so a tester can read of an order button, a
     confirmation and a withdrawal function that are not there. OWNER: build
     them before any tier is paid, or keep these sentences out of the
     published text until then.
  D. Resolved in this revision: §13's language rule is v1.2's again ("the
     English version governs, except where mandatory consumer law provides
     otherwise"), which is what the note above the Dutch privacy and terms
     pages says (translationNote in site/copy.mjs). The first draft of 1.3
     made both texts count and applied the reading more favourable to the
     customer, which contradicted that note on the rendered Dutch page. That
     rule is now a proposal, in question 15.
  E. Done: privacy 1.2 §4.5's last paragraph states the three reading
     exceptions for every provider, not only Google's.
  F. Done: the README's "What must stay true" bullet names both switches.

  What changed in v1.3 (2026-09-28), in both languages:

  1. §1: the second paragraph was "By creating an account or using the
     service you accept these terms". It now says the contract is these
     terms, the privacy policy and any additional conditions shown with them;
     that during the Alpha the Alpha conditions also apply and prevail; that
     we give the texts, with their versions, before the first connection, ask
     for acceptance and keep a record of it, by whatever route (precondition
     A); and that a person who
     only follows a progress link, or grants access through a link a customer
     sent, does not become a party. Why: our reviewer reads standard terms as
     binding a consumer only if they could read them before or when the
     contract was made; "using the service" also reached people who never
     contract with us.
  2. §2, first bullet: names both switches, applying deletions (per item) and
     auto-applying relocations (ADR-0031: opt-in, off by default, unattended,
     files only, deletions never). It said deletion at the target happens only
     "item by item". Last bullet: copying is meant to end; a migration that
     keeps copying after the switch-over (the continuous lane, ADR-0014's
     amendment of 2026-09-10) still counts as a running migration. It said
     keeping a copy in step afterwards "is a new migration you configure".
     The English says "switch over" throughout, as the Dutch "overstappen".
  3. §3: the customer answers for what they do under the account, and for
     sign-in details they shared or did not protect with reasonable care;
     what goes wrong on our side, including the sign-in service we run
     ourselves, is ours. It said the customer is responsible "for what
     happens under your account". New: 16 or older, and a parent's or
     guardian's permission under 18, which matches privacy §12's 16 (question
     20).
  4. §4: the reading exceptions point at privacy §4.5 and §6, and name a
     screenshot or text sent with a problem report (precondition E).
  5. §6: a price change for an existing subscription is a §12 change, with
     the right to cancel before it applies; a paid tier only after a button
     that says the order carries an obligation to pay (precondition C). "No
     quote-gating" is now plain words.
  6. §7: the express request is a confirmation in the app, confirmed by
     email, not something creating a migration counts as; the app gets a
     withdrawal function beside the email route (precondition C). "Setup work
     already done counts as part of what was provided" is removed until
     question 17 is answered. Dutch "direct" is now "onverwijld".
  7. §8: the Dutch restores "periodically" ("geregeld") and puts the click
     with the customer. The English is only rewrapped.
  8. §9: the maintenance promise is for planned maintenance that interrupts
     migrations; the lack of an uptime guarantee does not limit statutory
     rights when the service does not conform.
  9. §10: split into consumers and business customers. Consumers: liable as
     the law provides, no cap. Business customers: the twelve-month cap and
     no indirect loss, as before. No limit covers intent or deliberate
     recklessness by us or our management, death or personal injury, GDPR
     compensation, or anything else the law does not let us limit. The last
     sentence now says the source account is the way never to need §10.
  10. §11, first paragraph: was "On closure we delete your credentials and
      your migration ledger". That contradicted the owner's decision, "stored
      access after finished migration: keep until deleted or closes." (0139
      open question 3 (a), 2026-09-28), the Alpha conditions §10 and the code,
      which erases at the end of the window the customer chose. It now says:
      close by writing to support@; choose erasure at once or after 7, 30 or
      90 days (the code's windows); we confirm the closing and the erasure
      date; nothing uses the access from closing (precondition B); at
      erasure, credentials destroyed, access revoked where the provider
      allows it, ledger deleted, as privacy §9 describes. Second paragraph:
      its notice periods and export stay where the Alpha conditions §2 cite
      them; added that we say why before ending for a serious breach, as §5
      does, and refund a prepaid part if we end the terms.
  11. §12: changes only for a stated kind of reason; the customer may end the
      contract at no cost before a change takes effect; a consumer may also
      end it within 30 days after a change that makes the service clearly
      worse; where we ask for explicit acceptance, carrying on is not
      acceptance (as the Alpha conditions §11 ask for the new conditions).
  12. §13: consumers go to the court the law makes competent; only business
      customers go to the court in Overijssel. Complaints: if we cannot solve
      it together, we say by email which dispute body could deal with it and
      whether we take part; ConsuWijzer is named for Dutch consumers. Language:
      unchanged from v1.2 (precondition D; question 15).
  13. §14: a transfer to a successor does not reduce the customer's rights,
      is told in advance, and a consumer may end the contract at no cost
      before it takes effect.
  14. Dutch only: the header box ("niet onder deze voorwaarden"), §6's word
      choices ("afgeleid van", "voor het hoogste pakket"), "via" in §3 and
      §10, and §15 "onze overeenkomst", as the statutory Dutch model form
      reads (please confirm).
  15. The Version line keeps its draft marker and drops the repository path
      public readers could see.

  Decisions for the owner, not corrections. These v1.3 changes rest on our
  reviewer's reading of consumer law, which nobody has verified here. Each
  widens the owner's exposure, and each is kept in the draft only for the
  owner to accept or send back; the old wording is beside it:

  - §3: the customer answers for what they do, and for sign-in details they
    shared or did not protect; what goes wrong on our side, the sign-in
    service included, is ours. Was: "You are responsible for your
    credentials and for what happens under your account."
  - §10: consumers, liable as the law provides, with no cap; the twelve-month
    cap and no indirect loss for business customers only; no limit for
    intent, deliberate recklessness, death or injury, or GDPR compensation.
    Was: one cap for everyone, "the amount you paid us in the twelve months
    before the claim", with the consumer carve-out of v1.1 (question 13).
  - §11, second paragraph: we say why before ending for a serious breach, and
    refund a prepaid part if we end the terms. Was: neither.
  - §12: a consumer may also end the contract within 30 days after a change
    that makes the service clearly worse; where we ask for explicit
    acceptance, carrying on is not acceptance. Was: notice, and carrying on
    is acceptance (question 16).
  - §13: consumers go to the court the law makes competent, not to
    Overijssel; we name a dispute body when a complaint is not solved. Was:
    Overijssel for everyone, with the consumer's own courts kept (questions
    14 and 24).
  - §14: a transfer to a successor is told in advance and a consumer may end
    the contract first. Was: "We may transfer them to a successor of the
    business." (question 21).

  Questions for the lawyer (and the owner where marked), new in v1.3. Where
  our reviewer cited a rule, it is given as their reading, not verified here:

  12. OWNER: how is acceptance recorded for the Alpha? Build 0139 T3 before
      the first invitation, or pick another route and rewrite §1 to it
      (precondition A)? And will you take these terms as final for the Alpha
      without the lawyer's pass, as you did the Alpha conditions? Until one
      of the two, the first invitation waits.
  13. §10: is the consumer clause right with no cap at all? The reviewer's
      alternative is a consumer cap with a floor (the greater of what was paid
      in twelve months and a fixed sum, which would be a new placeholder; not
      added here, because it needs an owner's number and a README row).
      Does a free trial of a few weeks justify any cap for ordinary negligence
      towards a consumer? The reviewer reads a zero cap as a total exclusion,
      on the grey list, and a rescue clause ("to the extent the law allows")
      as not saving it. And does the Alpha conditions' "No obligations, on
      either side" (their §4) hold beside this §10?
  14. §13: the forum. The reviewer reads the old clause as void against
      consumers (black list, forum clauses). Confirm the wording for business
      customers (was question 9).
  15. §13: language. The text keeps v1.2's rule: the English governs, except
      where mandatory consumer law provides otherwise, which is also what the
      note above the Dutch privacy and terms pages says. Can that stand for a
      Dutch-first Alpha whose testers read Dutch? The alternatives: the Dutch
      governs for Dutch consumers, or for the Alpha; or, as the first draft of
      1.3 proposed, "These terms are published in Dutch and English, and both
      texts count. If they differ, the reading more favourable to you applies.
      For business customers, the English text governs." / "Deze voorwaarden
      verschijnen in het Nederlands en het Engels, en beide teksten gelden.
      Verschillen ze, dan geldt de uitleg die voor u het gunstigst is. Voor
      zakelijke klanten is de Engelse tekst beslissend." Any of these changes
      translationNote in site/copy.mjs in the same change: the note is shared
      by the privacy and terms pages, so it becomes a note per page, or
      neutral words. The Alpha conditions have no language clause of their
      own.
  16. §12: are the reasons and the right to end enough? One of the listed
      "good reasons", "a change to the service or its prices", is the change
      itself rather than a reason for it. As we read the unfair-terms rules
      (Directive 93/13/EEC, annex point 1(j)), a unilateral change needs a
      valid reason specified in the contract; please confirm. A narrower list
      could be "a change in what a provider we connect to allows or requires,
      a new feature, or a change in our costs". Deemed acceptance by carrying
      on rests on this. Is the Alpha conditions' 7 days' notice valid for the
      step to the new conditions, given that it needs explicit acceptance and
      non-acceptance ends in closure, not in a paid continuation (the Alpha
      briefing asks the same)?
  17. §7, before any paid tier: is the confirmation step strong enough as the
      express request? The reviewer reports that since 19 June 2026 a distance
      contract made online needs a withdrawal function on the interface
      (Directive (EU) 2023/2673); confirm. How does a one-off setup fee sit
      inside "proportionate" (the reviewer cites CJEU C-641/19)? When a Tiny
      customer moves to a paid tier, do the 14 days start when they agree to
      pay? The consumer-safe sentence would be "If you move from Tiny to a
      paid tier, the 14 days start when you agree to it"; not added.
  18. §6, before any paid tier: the route for a price change, and the order
      button. Right as written?
  19. §9: is "does not limit your statutory rights" enough? After the Alpha,
      must connecting an Experimental source (Alpha conditions §7) carry a
      separate confirmation, if the service is paid?
  20. §3: 16 or older, and a parent's or guardian's permission under 18. The
      first draft of 1.3 allowed any age with permission, which privacy §12
      ("not directed at children under 16 and we do not knowingly create
      accounts for them") refused. Is this the right line, for a contract with
      a minor (art. 1:234 BW) and beside privacy §12?
  21. §14: may a consumer contract say in advance that we may transfer it to
      a successor?
  22. §1: must a telephone number be given before paid tiers? Must
      "Ownpace" be registered as a handelsnaam of Archico B.V. first (was
      question 9)? A telephone number would need a new placeholder and a
      README row; neither is added.
  23. §4: keep the privacy policy "part of these terms", or incorporate only
      the commitments it makes? The reviewer's alternative: "The privacy
      policy explains how; the commitments it makes to you are part of this
      contract."
  24. §13: when a complaint is not solved, which dispute body do we name,
      and does that duty reach a free contract?
  25. OWNER: are updates of the service during the Alpha announced in
      advance? §9 promises notice of planned maintenance that interrupts
      migrations, and the Alpha conditions §2 do not set §9 aside; their §5
      allows a pause "without warning" but says nothing about updates. If
      not, the Alpha conditions need a sentence, or §9 does.
  26. OWNER: §11's second paragraph promises "an export of everything the
      service holds about your migrations" if we discontinue the service, and
      the Alpha conditions §2 keep it. No export route exists in apps/api; the
      only export is the operator's pseudonymised audit download. Does the
      export stay for the Alpha (0139 T1 point 1), made by hand, or is it
      defined as what the owner can produce? Not new in v1.3.

  The questions of v1.1 and v1.2, with where each stands now:

  1. §6: prices VAT-inclusive; invoices to business customers state their own
     VAT treatment (Dutch VAT, intra-EU reverse charge on a validated VAT
     number, or supply outside the EU). QUESTION: does one sentence cover
     both audiences, and for reverse-charge customers should the charged
     amount be the inclusive headline figure or that figure net of Dutch VAT?
     NOW: set aside during the Alpha (Alpha conditions §2); open for later.
  2. §7: the consumer right of withdrawal (Directive 2011/83/EU; art. 6:230o
     BW ff.), with the proportionate amount on withdrawal (art. 6:230s lid 4
     BW). QUESTIONS: is the express request strong enough; how does the setup
     fee sit inside "proportionate"; and §15 adapts Annex I(B)'s (*)-markers
     into I/we-slashes for rendering reasons — acceptable? NOW: set aside
     during the Alpha; v1.3 rewrote the express request (question 17).
  3. §8: renewal for the Wet Van Dam: after an initial term, month to month,
     cancellable at any time, effective at the end of the month, for every
     customer. QUESTION: confirm the wording, and whether a discounted prepaid
     term fits it, §7 and art. 6:236/6:237 BW. NOW: set aside during the
     Alpha; open for later.
  4. §10: the twelve-month cap with a consumer carve-out. NOW: replaced by
     v1.3's split; see question 13.
  5. §13: the EU ODR platform. The text does not name it. Our reviewer
     reports (web research, 2026-09-28; not verified here) that Regulation
     (EU) 2024/3228 repealed the ODR Regulation with effect from 20 July 2025,
     so that traders must no longer link to it. Please confirm. The remaining
     part, whether a dispute body must be named, is question 24.
  6. §13: English prevailing over the Dutch. NOW: kept, as v1.2 worded it;
     the alternatives are question 15.
  7. §4: the data-processing agreement "available on request" until
     published. NOW: answered for the Alpha, which admits households only;
     open for business customers later.
  8. §8: a prepaid term counts as the twelve-month reconfirmation for the
     period it covers. NOW: set aside during the Alpha; open for later.
  9. Entity facts: Archico B.V. (KvK 73922706, seat Wijhe), court in
     Overijssel. Still tokens: «REGISTERED_ADDRESS» (the owner decides the
     printed form) and «VAT_NUMBER» (the btw-id, from the accountant). NOW:
     the forum wording is question 14, the handelsnaam question 22.
  10. The privacy policy's own revision into processor and controller roles.
      NOW: done, in privacy v1.1 (2026-08-30).
  11. v1.2 (2026-09-24): Tiny is free, with no billing at all (ADR-0014).
      QUESTIONS: does a zero cap under §10 survive towards consumers, and does
      §7's proportionate amount need a word for a service that costs nothing?
      NOW: v1.3's §10 has no cap for consumers (question 13); §7's amount is
      moot while nothing is charged.
-->

# Terms of service

**Applies to:** the Ownpace **managed service** at `ownpace.eu`.
**Version:** 1.3 (draft — not yet published)
**Last updated:** 2026-09-28

> **These terms do not govern the software.** Ownpace is open source under the Apache
> License 2.0, and running it yourself is governed by that licence and nothing here. These
> terms govern the *service* we operate for you. The distinction is real: the licence gives you
> the right to run, modify and distribute the software; these terms are a contract about a
> service we run. Neither one limits the other.

---

## 1. Who you are contracting with

Archico B.V., «REGISTERED_ADDRESS», registered under KvK number 73922706, VAT «VAT_NUMBER».
Contact: **support@ownpace.eu**.

These terms, together with the privacy policy and any additional conditions we show you with
them, are the contract between you and us for the service. During the Alpha, the Alpha
conditions also apply; where they differ from these terms, they prevail.

Before you connect your first account, we give you these texts, each with its version number,
and ask you to accept them. We keep a record of which versions you accepted, and when. You can
save or print them from this site at any time.

Someone who only follows a progress link, or who grants access through a link a customer sent
them, does not become a party to these terms. If you accept on behalf of an organisation, you
confirm you may bind it.

## 2. What the service does

Ownpace copies your mail, contacts, calendars and files from a source account you control to a
target account you control, keeps the copy in step until you decide to switch over, and gives
you a record of what moved.

**What it will not do, stated here rather than discovered:**

- **It never deletes anything at your source.** At your target, nothing is deleted unless you
  switch on *applying deletions* and approve each deletion. If you also switch on
  *auto-applying relocations*, the old copy of a file that moved at your source is removed at
  your target after strict checks, without asking you each time. Both are off until you turn
  them on.
- **It does not sync back.** Data flows source → target. Your source remains your fallback for
  as long as you keep it.
- **It cannot promise a perfect copy of everything.** Formats differ between providers, and
  some things do not survive the crossing. What we cannot move is **reported to you, item by
  item, with the reason** — never silently dropped.
- **It is not a backup service.** Copying is meant to end: once you have switched over, you
  finish the migration, and it stops copying. If you let a migration keep copying after the
  switch-over, it still counts as a running migration.

## 3. Your account

Keep your sign-in details to yourself. You are responsible for what you do under your account,
and for what someone else does with sign-in details you shared or did not protect with
reasonable care. Tell us at support@ownpace.eu if you think someone else has gained access to
your account. What goes wrong on our side, including in the sign-in service we run, is our
responsibility.

You must have the right to access the accounts you connect. **Do not connect an account that
is not yours or that you are not authorised to migrate.** For an organisation's accounts, that
means authorisation from the organisation. For another person's private account — a family
member's, say — it means that person's permission.

You must be 16 or older to open an account, and if you are under 18, you need the permission of a
parent or guardian.

## 4. Your data, and what we may do with it

Your data stays yours. We process it only to run the migrations you configure, as set out in
the [privacy policy](./privacy.html), which forms part of these terms. Business customers are
additionally covered by our data-processing agreement — until it is published here, it is
**available on request** at support@ownpace.eu.

**We do not read your mail, files, contacts or calendars**, other than in the narrow cases §4.5
and §6 of the privacy policy describe: your own request for specific items (for example a
screenshot or text you send us with a problem report), what security or the law requires, and
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

Prices are published in full on [the pricing page](./pricing.html). You never need to ask for a
quote, and there is no price you only learn after speaking to somebody.

- Your tier is **derived from what you use** — how many migrations run at the same time, and
  how much data you have moved — not chosen from a menu.
- **Finishing migrations lowers your bill automatically**, without you asking. The amount of
  data you have moved sets a floor.
- **Tiny is free**: one migration at a time, up to 250 GB, with no setup fee, no monthly
  charge and no invoice. You register no payment method for it. Growing past it — a second
  migration at the same time, or more data — moves you to a paid tier, and we ask you before
  it does; nothing is billed for a month you did not agree to leave Tiny.
- The setup fee is charged **once**, on the highest tier you reach. Moving up later costs only
  the difference; moving back down never re-charges it.
- **Prices include VAT.** What you see is what you pay. Invoices to business customers state
  the VAT treatment that applies to them — Dutch VAT, intra-EU reverse charge on a validated
  VAT number, or supply outside the EU.

**Cost recovery, not profit**: the service is priced to cover what it costs to run. That is a
statement of intent about how prices are set, not a promise that any particular price will
never change. A change of price for a subscription you already have is a change under §12: we
tell you at least 30 days ahead, and you may cancel before it applies. We move you to a paid
tier only after you confirm it, with a button that says plainly that you are ordering with an
obligation to pay.

## 7. Your right of withdrawal

If you are a **consumer**, you may withdraw from this contract within **14 days** of
concluding it, without giving a reason.

The service starts during those 14 days — that is the point of it. Before your first migration
starts, the app asks you to confirm that you want us to begin before the 14 days are over, and
that if you then withdraw, you pay for the part of the service already provided, **in
proportion to the agreed price**, and no more. We confirm that choice to you by email.
Withdrawing does not touch your data at your source or your target; the promises of §2 hold
throughout.

To withdraw, use *Withdraw from contract* in the app, or send an unambiguous statement to
**support@ownpace.eu**, within the 14 days. You may use the model form in §15, but you do not
have to. We confirm receipt by email without delay. If you have already paid, we refund
everything above the proportionate amount within 14 days, by the means of payment you used; if
nothing has been paid yet — billing is in arrears — we invoice the proportionate amount and
nothing else.

If you are a business customer, this section does not apply to you.

## 8. Billing, renewal, and not billing you for forgetting

Billing is **monthly in arrears**, by the payment method you registered, through our payment
provider Mollie. On Tiny nothing is billed, so there is nothing to register. If we offer a
discounted term paid up front — a year, say — and you choose it, that term is billed at its
start; the discount is the price of the commitment.

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

We aim to keep the service running, and we tell you in advance about planned maintenance that
interrupts your migrations. **We do not offer a contractual uptime guarantee at these prices**,
and saying so plainly is better than a number nobody intends to honour. This does not limit
your statutory rights if the service does not conform to the contract.

A migration is designed to survive interruption: it resumes rather than restarting, and a
re-run converges instead of duplicating. Outage costs you time, not correctness.

**How fast a migration runs is not entirely ours to promise.** The providers on either side set
the pace — their rate limits and throttling are a ceiling we work under, not around — so we
promise convergence, not a completion date. Duration is a choice you make when you switch over,
not a prediction we sell.

## 10. If we get it wrong

We will fix it. Tell us at support@ownpace.eu.

**If you are a consumer**, we are liable to you as the law provides. If the service does not do
what these terms and the law say it should, you have the remedies the law gives you: to have it
put right and, where the law allows, a lower price, ending the contract, or compensation for
loss we caused. We are not liable for loss of data at your source or target that we did not
cause.

**If you are a business customer**, our total liability to you for any claim is limited to
**the amount you paid us in the twelve months before the claim**. We are then not liable for
indirect or consequential loss, or for loss of data at your source or target that we did not
cause.

**No limit in this section applies** to loss caused by intent or deliberate recklessness on our
part or our management's, to death or personal injury, to your right to compensation under the
GDPR, or to any other liability the law does not allow us to limit.

**Keep your source account until you have checked your target.** The product is built so you
can — that is what switching over on your own schedule means — and it is the best way to make
sure you never need this section.

## 11. Ending it

<!-- NOT YET TRUE ON main: "From the moment your account is closed, nothing uses the access you
     gave us." The sync tick (ACTIVE_MAPPINGS_SQL in apps/worker/src/jobs/managed-sync-tick.ts)
     never reads the organisation's status, so a closed organisation still gets new passes until
     the purge. The draft marker stays until the closed-organisation fix is merged (briefing,
     precondition B). -->

**You** may close your account at any time: write to support@ownpace.eu. You choose when its
data is erased: at once, or after 7, 30 or 90 days. We confirm the closing, and the date on
which your data will be erased. From the moment your account is closed, nothing uses the access
you gave us. When your data is erased, we destroy your credentials, revoke the access where the
provider allows it, and delete your migration ledger, as §9 of the privacy policy describes.
Invoices are kept as long as tax law requires.

**We** may end these terms with 30 days' notice, or immediately for a serious breach of §5,
after telling you why as §5 describes. If we end them during a period you have already paid
for, we refund the part you have not had. If we discontinue the service, **you get at least 90
days' notice and an export of everything the service holds about your migrations** — and the
software is Apache-2.0, so you can keep running it yourself.

## 12. Changes to these terms

We change these terms only for a good reason: a change in the law or in what a provider
requires of us, a change to the service or its prices, security, or to make them clearer. We
tell you by email at least **30 days** before a material change takes effect. We say what
changes and why, and link the new text.

If you do not accept the change, you may end the contract before it takes effect, without
paying anything for ending it; your data is then erased as the privacy policy describes. If you
are a consumer and a change makes the service clearly worse for you, you may also end the
contract free of charge within 30 days after the change. Where we ask you to accept a change
explicitly, continuing to use the service does not count as acceptance. Otherwise, continuing to
use the service after the change takes effect is acceptance.

A change that is only to your benefit, or that the law requires at shorter notice, may take
effect sooner.

## 13. Law and disputes

These terms are governed by **Dutch law**. If you are a consumer, this does not deprive you of
the protection of the mandatory law of your country of residence. Disputes then go to the court
the law makes competent, and you keep your right to bring proceedings before the courts of your
own country. If you are a business customer, disputes go to the competent court in Overijssel.

**Complaints first.** Tell us what went wrong at support@ownpace.eu — we respond within 14
days. If we cannot resolve it together, we tell you by email which dispute-resolution body could
deal with it, and whether we will take part. If you are a consumer, ConsuWijzer
(consuwijzer.nl) explains your options in the Netherlands, and the **European Consumer Centres
network (ECC-Net)** advises and mediates free of charge in cross-border disputes. You can always
go to court (see above).

**Language.** The Dutch text of these terms is a courtesy translation. Where the two versions
differ, the **English version** governs, except where mandatory consumer law provides
otherwise.

## 14. The rest

If a provision is unenforceable, the rest stands. Not enforcing something once does not waive
it. You may not transfer these terms without our consent. We may transfer them to a successor
of the business. A transfer does not reduce your rights under these terms, we tell you in
advance, and if you are a consumer you may end the contract free of charge before it takes
effect.

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

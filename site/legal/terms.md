<!-- Copyright 2026 The Ownpace authors (Apache-2.0) -->
<!--
  DRAFT — v1.3, 2026-09-28, for the owner's review first (this briefing began
  with v1.1, 2026-08-30). This comment never renders (the site generator strips
  HTML comments); it is the briefing for the reviewing lawyer. terms.nl.md
  mirrors this file section for section.

  Where things stand on 2026-09-28:

  - The lawyer's pass (workplan 0139 T1) is deferred by the owner: "legal:
    keep as is for now" (2026-09-27). The owner took the Alpha conditions
    (alpha.md) as version 1.0 without it. They stay 1.0 while they are edited,
    until the first tester accepts them (alpha-version-number (a)).
  - The Alpha conditions are an addendum to these terms. Their §2 sets aside
    §6, §7, §8, §15, and the notice periods in §11's second paragraph, during
    the Alpha, and says the conditions prevail where they differ. It keeps
    §11's export. For the new conditions after the Alpha, their 7 days
    replace §12's 30 days, and their §2 says so (alpha-s11-notice (a)). Their
    §4 says that §10 still applies (alpha-s4-liability (a)). They cite §6 to
    §12 and §15 by number, and "§11, second paragraph". So no section and no
    paragraph of §11 moves.
  - The Alpha is free, invite-only, and for households only: "tester:
    households only for now." (0139 open question 6, 2026-09-28). Every tester
    takes part as a consumer, and the Alpha is in Dutch (0139 D2); where
    testers live is not recorded, and questions 14 and 15 turn on it. The
    data-processing agreement is part of no Alpha contract.
  - On 2026-09-28 the owner answered all 71 questions on the answer page. This
    revision applies every answer that names the terms. Each question below
    says which answer settled it: its id on the answer page and the option
    chosen, for example rec-address (c). Final or the lawyer: "park them in
    PR that i will review." So these terms stay a draft, in the pull request,
    for the owner's own review; the lawyer's pass stays deferred, and the
    Version line changes only when the owner approves the text. Nothing was
    published, so the version stays 1.3, edited in place.

  Before the draft marker comes off the Version line, these must be true, or
  the sentence that relies on them must change:

  A. §1: when a tester creates their account, the app shows these texts with
     their version numbers and asks them to accept. It records which version
     of each text they accepted, and when. The texts can be saved or printed
     from this site. The owner chose this route (terms-acceptance-route (b)):
     "People that are accepted in the Alpha do need to create a login for the
     app, accepting fits in there and should record what time/version the
     accepted of what document." The screen is 0139 T3: proposed, not built.
     Connecting an account is refused until the tester has accepted. The
     first invitation waits for that code and its tests. The texts must also
     be served: live's WWW_LIVE is false, and the site build does not yet
     render the Alpha conditions (T10). Today neither exists.
  B. §11: "From the moment your account is closed, nothing uses the access you
     gave us." The Alpha conditions §10 promise the same. True on main since
     #1320 (d7868276, 0085 T2, 2026-09-28): the sync tick skips a closed
     organisation, and a pass already queued halts before it builds any
     credentials. This branch has not merged main since that commit; the
     comment beside §11 says so in both languages.
  C. Settled (terms-unbuilt-paid-steps (a)): §6 and §7 keep the order button,
     the confirmation before the first migration, the confirming email and
     "Withdraw from contract" in the app, though none of them is built. They
     are built before the first paid tier. Both sections are set aside during
     the Alpha, but they are rendered, so a tester can read of steps that are
     not there. This is a condition for the first paid tier, no longer for
     the draft marker.
  D, E, F. Done: §13's language rule is v1.2's again (question 15 keeps the
     alternatives); privacy 1.2 §4.5 states the three reading exceptions for
     every provider; the README's "What must stay true" names both switches.

  What changed in v1.3 (2026-09-28), in both languages. The owner's answers
  of 2026-09-28 are folded in, each named by its id:

  1. §1: the first paragraph names Archico B.V., trading as Ownpace
     (fact-trademark (b)), its KvK number and its VAT number (fact-vat (a)).
     It gives no address during the Alpha (rec-address (c)), and says we
     correspond by email; a comment beside it says the address returns. The
     second paragraph was "By creating an account or using the service you
     accept these terms". It now says the contract is these terms, the
     commitments the privacy policy makes (terms-s4-privacy-part-of-contract
     (b)) and any additional conditions shown with them; that during the
     Alpha the Alpha conditions also apply and prevail; that the app shows
     the texts, with their versions, when the account is created, asks for
     acceptance, and records the version of each text and the time
     (terms-acceptance-route (b); precondition A); and that a person who only
     follows a progress link, or grants access through a link a customer
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
     ourselves, is ours (kept: terms-s3-responsibility (a)). It said the
     customer is responsible "for what happens under your account". New: 18
     or older (terms-s3-minimum-age (b)).
  4. §4: the privacy policy "explains how; the commitments it makes to you
     are part of this contract" (terms-s4-privacy-part-of-contract (b)). It
     said the policy "forms part of these terms". The reading exceptions
     point at privacy §4.5 and §6, and name a screenshot or text sent with a
     problem report.
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
     no indirect loss, as before; the cap also covers claims about data
     protection between us and the business customer (dpa-q6-liability-cap
     (a)). No limit covers intent or deliberate recklessness by us or our
     management, death or personal injury, the rights the GDPR gives the
     people whose personal data it is, or anything else the law does not let
     us limit. That clause said "your right to compensation under the GDPR",
     which left a business customer's data-protection claims without a cap.
     The last sentence now says the source account is the way never to need
     §10.
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
      does, and refund a prepaid part if we end the terms (kept:
      terms-s11-ending-reasons-refund (a)). The export is of the migration
      records (what was copied, what could not be, and why), made on request
      (terms-s11-export (a)). It was "everything the service holds about your
      migrations".
  11. §12: changes only for a stated kind of reason, and "a change to the
      service or its prices" is now "a new feature, a change in our costs"
      (terms-s12-reasons (b)); the customer may end the contract at no cost
      before a change takes effect; a consumer may also end it within 30 days
      after a change that makes the service clearly worse; where we ask for
      explicit acceptance, carrying on is not acceptance, as the Alpha
      conditions §11 ask for the new conditions (kept: terms-s12-consumer-exit
      (a)).
  12. §13: consumers go to the court the law makes competent; only business
      customers go to the court in Overijssel (kept: terms-s13-forum (a)).
      Complaints: if we cannot solve it together, we say by email which
      dispute body could deal with it and whether we take part (kept:
      terms-s13-dispute-body (a)); ConsuWijzer is named for Dutch consumers.
      Language: unchanged from v1.2 (question 15).
  13. §14: a transfer to a successor does not reduce the customer's rights,
      is told in advance, and a consumer may end the contract at no cost
      before it takes effect (kept: terms-s14-transfer (a)).
  14. Dutch only: the header box ("niet onder deze voorwaarden"), §6's word
      choices ("afgeleid van", "voor het hoogste pakket"), "via" in §3 and
      §10, and §15 "onze overeenkomst", as the statutory Dutch model form
      reads (please confirm).
  15. The Version line keeps its draft marker and drops the repository path
      public readers could see.
  16. §15: the model form is addressed to Archico B.V. by email only during
      the Alpha (rec-address (c)); a comment says the address returns there.

  The v1.3 changes that widen the owner's exposure rest on our reviewer's
  reading of consumer law, which nobody has verified here. On 2026-09-28 the
  owner kept each of them; the lawyer confirms. The old wording is beside
  each:

  - §3 (terms-s3-responsibility (a)). Was: "You are responsible for your
    credentials and for what happens under your account."
  - §10. Consumers: no cap (the owner's "yes", question 13). Business
    customers: one cap, data-protection claims between us included
    (dpa-q6-liability-cap (a)). Was: one cap for everyone, "the amount you
    paid us in the twelve months before the claim", with the consumer
    carve-out of v1.1.
  - §11, second paragraph (terms-s11-ending-reasons-refund (a)). Was: no
    reasons before ending for a serious breach, and no refund.
  - §12 (terms-s12-consumer-exit (a)). Was: notice, and carrying on is
    acceptance (question 16).
  - §13 (terms-s13-forum (a); terms-s13-dispute-body (a)). Was: Overijssel
    for everyone, with the consumer's own courts kept (questions 14 and 24).
  - §14 (terms-s14-transfer (a)). Was: "We may transfer them to a successor
    of the business." (question 21).

  Questions for the lawyer (and the owner where marked), new in v1.3. Where
  our reviewer cited a rule, it is given as their reading, not verified here.
  ANSWERED marks the owner's answer of 2026-09-28. What follows "Left for the
  lawyer" is still open:

  12. OWNER: how is acceptance recorded for the Alpha? ANSWERED:
      terms-acceptance-route (b), a screen in the app when the account is
      created (precondition A). Whether these terms are final without the
      lawyer's pass: "park them in PR that i will review." Left for the
      lawyer: is a screen in the app that shows each text, with the texts
      saved or printed from this site, the reasonable opportunity to read
      them that standard terms need (art. 6:233(b) and 6:234 BW)?
  13. §10: is the consumer clause right with no cap at all? The reviewer's
      alternative is a consumer cap with a floor (the greater of what was paid
      in twelve months and a fixed sum, which would be a new placeholder; not
      added here, because it needs an owner's number and a README row).
      Does a free trial of a few weeks justify any cap for ordinary negligence
      towards a consumer? The reviewer reads a zero cap as a total exclusion,
      on the grey list, and a rescue clause ("to the extent the law allows")
      as not saving it. ANSWERED: asked whether §10 keeps no cap towards
      consumers, as drafted, and whether the English governs or both
      languages count, the owner answered "yes". We read that as keeping §10
      as drafted: towards consumers no cap, liable as the law provides. This
      is our reading of a one-word answer to a two-part question; the owner
      may correct it in the pull request. The Alpha conditions §4 now say
      that §10 still applies (alpha-s4-liability (a)). A business customer's
      data-protection claims fall under their cap (dpa-q6-liability-cap (a)).
      Left for the lawyer: the questions above; and whether "the rights the
      GDPR gives the people whose personal data it is" keeps a data subject's
      own claim (GDPR art. 82(1)) free of any cap, while the cap covers a
      business customer's claims against us, a recourse claim under art.
      82(5) included.
  14. §13: the forum. ANSWERED: v1.3 kept (terms-s13-forum (a)). Left for the
      lawyer: the reviewer reads the old clause as void against consumers
      (black list, forum clauses); confirm that, and the wording for business
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
      own. The owner's "yes" (question 13) is read as keeping §13 as drafted:
      the English governs, except where mandatory consumer law provides
      otherwise. It is our reading, which the owner may correct in the pull
      request; whether the rule can stand for a Dutch-first Alpha is still
      this question. One mismatch to fix whichever way it goes: the note
      above the Dutch privacy and terms pages says only "Bij verschillen is
      de Engelse versie de tekst die geldt." It does not carry §13's
      exception; adding ", behalve waar dwingend consumentenrecht anders
      bepaalt" to translationNote in site/copy.mjs would make the two agree.
  16. §12: are the reasons and the right to end enough? ANSWERED: the list is
      narrower (terms-s12-reasons (b)). "A change to the service or its
      prices", the change itself rather than a reason for it, is now "a new
      feature, a change in our costs". The consumer's extra right to end, and
      "carrying on is not acceptance" where we ask for acceptance, stay
      (terms-s12-consumer-exit (a)). For the new conditions after the Alpha,
      the Alpha conditions §2 now say that their 7 days replace §12's 30
      (alpha-s11-notice (a)). Left for the lawyer: as we read the
      unfair-terms rules (Directive 93/13/EEC, annex point 1(j)), a
      unilateral change needs a valid reason specified in the contract. Is
      the list now specific enough, and can deemed acceptance by carrying on
      rest on it? Is 7 days' notice valid for the step to the new conditions,
      given that it needs explicit acceptance and non-acceptance ends in
      closure, not in a paid continuation (the Alpha briefing asks the same)?
  17. §7, before any paid tier: is the confirmation step strong enough as the
      express request? The reviewer reports that since 19 June 2026 a distance
      contract made online needs a withdrawal function on the interface
      (Directive (EU) 2023/2673); confirm. How does a one-off setup fee sit
      inside "proportionate" (the reviewer cites CJEU C-641/19)? When a Tiny
      customer moves to a paid tier, do the 14 days start when they agree to
      pay? The consumer-safe sentence would be "If you move from Tiny to a
      paid tier, the 14 days start when you agree to it"; not added. ANSWERED:
      left for the lawyer's pass before the first paid tier
      (terms-paid-tier-lawyer-checks (a)).
  18. §6, before any paid tier: the route for a price change, and the order
      button. Right as written? ANSWERED: left for the lawyer's pass before
      the first paid tier (terms-paid-tier-lawyer-checks (a)).
  19. §9: is "does not limit your statutory rights" enough? After the Alpha,
      must connecting an Experimental source (Alpha conditions §7) carry a
      separate confirmation, if the service is paid? ANSWERED: left for the
      lawyer's pass before the first paid tier (terms-paid-tier-lawyer-checks
      (a)).
  20. §3: the minimum age. ANSWERED: 18 or older (terms-s3-minimum-age (b)).
      The permission route for 16 and 17 is gone, and with it the question of
      a contract with a minor (art. 1:234 BW). A younger family member takes
      part through a parent's account and a grant link; privacy §12 stays as
      it is. Left for the lawyer: confirm.
  21. §14: may a consumer contract say in advance that we may transfer it to
      a successor? The owner kept v1.3's protections (terms-s14-transfer
      (a)); the question stands.
  22. §1: the entity line.
      - The name. ANSWERED: fact-trademark (b), "Add it now; the KvK already
        shows it". §1 says "Archico B.V., trading as Ownpace" / "Archico
        B.V., handelend onder de naam Ownpace". No KvK extract was seen here.
        TRADEMARK.md records a Benelux trademark application (1556706, filed
        2026-08-30, registration pending), so the texts may use ™ but not ®
        or "registered trademark" until the Benelux office registers it.
      - The VAT number. ANSWERED: fact-vat (a). §1 prints it as the owner
        wrote it. The owner: "VIES might validate it only without dots/spaces,
        but in legal document that doesnt mater."
      - The address. ANSWERED: rec-address (c), "Leave the address out during
        the Alpha". §1 names Archico B.V., its KvK number, its VAT number and
        support@ownpace.eu, and says we correspond by email; §15's form names
        Archico B.V. and the email address. The address returns in §1 and in
        the §15 form before the first paid tier, or sooner if the lawyer's
        pass asks for it. Left for the lawyer (our reading, not verified
        here): BW 3:15d (the e-Commerce Directive's art. 5) asks a provider of
        an information society service for its geographic address of
        establishment, and a free service offered as part of an economic
        activity is one (CJEU C-291/13 Papasavvas, C-484/14 Mc Fadden). So
        leaving it out probably breaks 3:15d, even for an invite-only Alpha,
        and it hides nothing: the KvK register publishes a B.V.'s
        vestigingsadres. For paid consumer tiers, BW 6:230m asks for the
        geographic address, a telephone number and an email address before
        the contract, and §15's model form asks for the trader's geographic
        address. A postbus alone is probably not a geographic address. Does
        "We correspond by email" read as making email the only valid channel
        for a consumer's notices, which may be an unreasonably onerous term
        (BW 6:233, 6:236-237)? A letter that arrives still counts.
      - The telephone number. ANSWERED: terms-s1-telephone (a), email only
        for now. Left for the lawyer, before the first paid tier: must a
        number be given (BW 6:230m)? A number would need a new placeholder
        and a README row.
  23. §4: the privacy policy in the contract. ANSWERED: only its commitments
      (terms-s4-privacy-part-of-contract (b)). §4 takes the reviewer's
      sentence, and §1 names "the commitments the privacy policy makes to
      you". Left for the lawyer: confirm. The policy does not mark which of
      its sentences are commitments, so an update under privacy §13 alone
      may still change one.
  24. §13: complaints. ANSWERED: a dispute body is named case by case, and
      the owner joins none now (terms-s13-dispute-body (a)). Left for the
      lawyer: does the duty to name one reach a free contract? And old
      question 5.
  25. ANSWERED: updates during the Alpha are not announced one by one, and
      the Alpha conditions §5 say so (alpha-s5-updates (a)). §9 is unchanged.
  26. ANSWERED: §11's export is of the migration records (what was copied,
      what could not be, and why), made on request (terms-s11-export (a)).
      The Alpha conditions §2 keep it. The owner: "draft the export function
      in a workplan". Workplan 0155 builds it; until then the export is
      made by hand.

  The questions of v1.1 and v1.2, with where each stands now:

  1. §6: prices VAT-inclusive; invoices to business customers state their own
     VAT treatment (Dutch VAT, intra-EU reverse charge on a validated VAT
     number, or supply outside the EU). ANSWERED: terms-s6-reverse-charge
     (a), a reverse-charge customer pays the published price minus the Dutch
     VAT in it, so every customer pays the same price before tax. §6 says so
     in one sentence when business customers are admitted, not before; the
     Alpha admits none. A sentence for then: "A business in another EU
     country with a validated VAT number pays the price without the Dutch VAT
     in it, and accounts for the VAT itself." / "Een bedrijf in een ander
     EU-land met een gevalideerd btw-nummer betaalt de prijs zonder de
     Nederlandse btw erin, en draagt de btw zelf af." §6's "What you see is
     what you pay" then needs the same care. The pricing page's last
     paragraph, which said VAT is added where it applies, now matches §6
     and the price table in both languages: "All prices include VAT." /
     "Alle prijzen zijn inclusief btw." (site/pages/en/pricing.md,
     site/pages/nl/prijzen.md). Left for the lawyer: does one sentence cover
     both audiences?
  2. §7: the consumer right of withdrawal (Directive 2011/83/EU; art. 6:230o
     BW ff.), with the proportionate amount on withdrawal (art. 6:230s lid 4
     BW). QUESTIONS: is the express request strong enough; how does the setup
     fee sit inside "proportionate"; and §15 adapts Annex I(B)'s (*)-markers
     into I/we-slashes for rendering reasons — acceptable? NOW: set aside
     during the Alpha; v1.3 rewrote the express request (question 17). Left
     for the lawyer's pass before the first paid tier
     (terms-paid-tier-lawyer-checks (a)). Whether the Alpha may set §7 and
     §15 aside for a service that costs nothing is also left for the lawyer
     (alpha-withdrawal-right (a)).
  3. §8: renewal for the Wet Van Dam: after an initial term, month to month,
     cancellable at any time, effective at the end of the month, for every
     customer. QUESTION: confirm the wording, and whether a discounted prepaid
     term fits it, §7 and art. 6:236/6:237 BW. NOW: set aside during the
     Alpha; left for the lawyer's pass before the first paid tier
     (terms-paid-tier-lawyer-checks (a)).
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
     published. NOW: answered for the Alpha, which admits households only.
     The agreement stays an unpublished draft until the first business
     customer (dpa-unpublished-until-business (a)); §4's sentence speaks for
     that time.
  8. §8: a prepaid term counts as the twelve-month reconfirmation for the
     period it covers. NOW: set aside during the Alpha; left for the lawyer's
     pass before the first paid tier (terms-paid-tier-lawyer-checks (a)).
  9. Entity facts: Archico B.V. (KvK 73922706, seat Wijhe), court in
     Overijssel. NOW: the name, the VAT number and the address are question
     22; the forum wording is question 14.
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

<!-- No address during the Alpha: the owner, 2026-09-28 (rec-address (c)). The address of
     establishment returns here, and in the §15 form, before the first paid tier, or sooner if
     the lawyer's pass asks for it (briefing, question 22). -->

Archico B.V., trading as Ownpace, registered under KvK number 73922706, VAT number
NL8597.110.06.B01. We correspond by email: **support@ownpace.eu**.

These terms, together with the commitments the privacy policy makes to you and any additional
conditions we show you with them, are the contract between you and us for the service. During
the Alpha, the Alpha conditions also apply; where they differ from these terms, they prevail.

When you create your account, the app shows you these texts, each with its version number, and
asks you to accept them. The app records which version of each text you accepted, and when. You
can save or print them from this site at any time.

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

You must be 18 or older to open an account.

## 4. Your data, and what we may do with it

Your data stays yours. We process it only to run the migrations you configure. The
[privacy policy](./privacy.html) explains how; the commitments it makes to you are part of this
contract. Business customers are additionally covered by our data-processing agreement — until
it is published here, it is **available on request** at support@ownpace.eu.

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
**the amount you paid us in the twelve months before the claim**. This limit also applies to
claims about data protection between you and us. We are then not liable for indirect or
consequential loss, or for loss of data at your source or target that we did not cause.

**No limit in this section applies** to loss caused by intent or deliberate recklessness on our
part or our management's, to death or personal injury, to the rights the GDPR gives the people
whose personal data it is, or to any other liability the law does not allow us to limit.

**Keep your source account until you have checked your target.** The product is built so you
can — that is what switching over on your own schedule means — and it is the best way to make
sure you never need this section.

## 11. Ending it

<!-- "From the moment your account is closed, nothing uses the access you gave us." True on main
     since #1320 (d7868276, 0085 T2, 2026-09-28): the sync tick (ACTIVE_MAPPINGS_SQL in
     apps/worker/src/jobs/managed-sync-tick.ts) skips a closed organisation, and a pass already
     queued halts before it builds any credentials. This branch has not merged main since that
     commit; merging it brings the fix (briefing, precondition B). -->

**You** may close your account at any time: write to support@ownpace.eu. You choose when its
data is erased: at once, or after 7, 30 or 90 days. We confirm the closing, and the date on
which your data will be erased. From the moment your account is closed, nothing uses the access
you gave us. When your data is erased, we destroy your credentials, revoke the access where the
provider allows it, and delete your migration ledger, as §9 of the privacy policy describes.
Invoices are kept as long as tax law requires.

**We** may end these terms with 30 days' notice, or immediately for a serious breach of §5,
after telling you why as §5 describes. If we end them during a period you have already paid
for, we refund the part you have not had. If we discontinue the service, **you get at least 90
days' notice and, if you ask for it, an export of your migration records**: what was copied,
what could not be, and why. The software is Apache-2.0, so you can keep running it yourself.

## 12. Changes to these terms

We change these terms only for a good reason: a change in the law or in what a provider
requires of us, a new feature, a change in our costs, security, or to make them clearer. We
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

<!-- No address during the Alpha (rec-address (c); §1's comment). The model form asks for the
     trader's geographic address, and it returns here before the first paid tier. During the
     Alpha this section does not apply (Alpha conditions §2). -->

- To: Archico B.V., email: support@ownpace.eu
- I/we hereby give notice that I/we withdraw from my/our contract for the provision of the
  following service: the Ownpace managed service, for the account on this email address: …
- Ordered on: …
- Name of consumer(s): …
- Address of consumer(s): …
- Signature of consumer(s) (only if this form is notified on paper): …
- Date: …

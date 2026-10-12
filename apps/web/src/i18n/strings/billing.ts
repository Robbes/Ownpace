// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Billing: the package, the bill, invoices and the data ceiling.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  'billing.title': 'Billing',
  'billing.subtitle': 'Manage your subscription, usage, and payments',
  'billing.currentUsage': 'Current usage',
  // What has moved (the owner, 2026-10-05: "show the usages that counts"),
  // in place of Storage, Data Transfer, Compute Time and API calls.
  'billing.moved': 'What has moved',
  'billing.moved.where': 'In total, across all your migrations.',
  'billing.moved.data': 'All data',
  'billing.moved.none': 'Nothing has moved yet.',
  'billing.moved.failed': 'Could not count the items moved.',
  // ADR-0014's tier, on the customer's own usage screen (0121 T4).
  'billing.yourTier': 'What this puts you on',
  // Once the alpha is over (the owner, 2026-10-04): the tier the month bills,
  // what it used and never above the agreed tier, with what was used under it.
  'billing.monthBills': 'What this month bills',
  'billing.tierDataOf': '{moved} of {ceiling}',
  'billing.tierAlphaMoved': 'Moved during the Alpha, not counted',
  'billing.tierBeyond.bands': 'That includes {count} extra band(s) bought, so {tier} still covers it.',
  'billing.tierBeyond.paths':
    'More migrations ran at the same time than {tier} runs, so this month bills {tier}. Nothing more starts until fewer run or you move up.',
  'billing.tierBeyond.data':
    'More was moved than {tier} covers, so this month bills {tier}. New items wait until you choose.',
  'billing.tierPerYear': 'for a year',
  'billing.tierPerMonth': 'per month',
  'billing.tierFree': 'Free: nothing is invoiced on this tier',
  'billing.tierDecidedByPaths': 'Set by how many migrations ran at the same time.',
  'billing.tierDecidedByData': 'Set by how much data has been moved.',
  'billing.tierDecidedByBoth': 'Set by both what ran at once and how much was moved.',
  'billing.tierPeakPaths': 'Most migrations at once',
  'billing.tierDataMoved': 'Data moved, in total',
  'billing.tierBeyondTable':
    'Past the highest tier — contact us.',
  'billing.noUsage': 'No usage data available yet',
  // The data ceiling and the yes that moves it (workplan 0109 T6, ADR-0014's
  // amendment of 2026-10-03): both ways on from 80%, with the break-even.
  'billing.ceiling.title': 'Your data ceiling',
  'billing.ceiling.moved': '{moved} of {ceiling} moved, on {tier}.',
  'billing.ceiling.bands': 'That includes {count} extra band(s) bought.',
  'billing.ceiling.alphaMoved': 'Another {moved} was moved during the Alpha, which never counts toward your ceiling.',
  'billing.ceiling.under':
    'From 80% of the ceiling, this card offers you a choice: moving up a tier, or another band once.',
  'billing.ceiling.near':
    'You have moved {share} of your data ceiling. At the ceiling, new items wait until you choose; changes to what is already copied carry on.',
  'billing.ceiling.reached':
    'Your data ceiling is reached. New items wait until you choose; changes to what is already copied carry on.',
  'billing.ceiling.alpha':
    'During the Alpha nothing waits at the ceiling and nothing is charged, so there is nothing to agree to yet. The prices below are an indication of pricing after the Alpha.',
  'billing.ceiling.moveUp':
    'Move up to {tier}: {monthly} a month. Your ceiling becomes {ceiling}, and {paths} migrations can run at once.',
  'billing.ceiling.moveUp.button': 'Move up to {tier}',
  'billing.ceiling.talkToUs': 'There is no tier past {tier}. Contact us.',
  'billing.ceiling.topUp':
    'Or buy another {band} once, for {price}. Your ceiling becomes {ceiling}, and your monthly price stays the same.',
  'billing.ceiling.topUp.button': 'Buy another {band}',
  'billing.ceiling.noTopUp': '{tier} has no top-up: move up a tier.',
  'billing.ceiling.breakEven':
    'Topping up costs {extra} more once and saves {saved} a month, so it pays back in about {days} day(s).',
  'billing.ceiling.breakEven.cheaper': 'Topping up costs no more once, and saves {saved} a month.',
  'billing.ceiling.betterBuy':
    'Moving up is the better buy when you need more migrations at once: {next} runs {nextPaths} at the same time, {tier} {paths}.',
  'billing.ceiling.confirm.moveUp': 'You agree to pay {monthly} a month for {tier}.',
  'billing.ceiling.confirm.topUp': 'You agree to pay {price} once for another {band}.',
  'billing.ceiling.confirm.no': 'Not now',
  'billing.ceiling.done': 'Done: your data ceiling is now {ceiling}.',
  'billing.ceiling.offerChanged':
    'What is offered changed since this page was shown, so nothing was agreed. This is the offer now.',
  'billing.ceiling.loadFailed': 'Your data ceiling could not be read',
  'billing.ceiling.yesFailed': 'Your yes was not recorded:',
  // A tier the person picks (workplan 0157 T6; ADR-0014, Amendment 2026-10-04,
  // evening): each month bills at least it; a raise counts at once and a lower
  // pick from the next month. A paid pick is ordered with the button terms §6
  // promises, which says plainly that it carries an obligation to pay.
  'billing.tierPicked': 'Picked by you: each month bills at least {tier}.',
  'billing.pick.title': 'Pick a tier',
  'billing.pick.lead':
    'Your tier follows what you use. You may pick a higher one for a faster sync (up to every 15 minutes) or more data room: each month then bills at least that tier, until you lower it.',
  'billing.pick.standing': 'You picked {tier}. Each month bills at least {tier}, until you lower it.',
  'billing.pick.standingThisMonth': 'You picked {tier}: this month bills at least {tier}.',
  'billing.pick.lowered': 'From {date}, each month bills at least {tier}.',
  'billing.pick.loweredToNone': 'From {date}, what you use decides your tier again.',
  'billing.pick.alpha':
    'During the Alpha every tier is free, whatever its pace, concurrency or data, so there is nothing to pick now.',
  'billing.pick.monthly': '{monthly} a month',
  'billing.pick.room': '{paths} migrations at the same time, up to {data}.',
  'billing.pick.pace':
    'Every tier here copies pass after pass until the first migration is done, then looks for changes every hour, or as often as every 15 minutes if you choose.',
  'billing.pick.button': 'Pick {tier}',
  'billing.pick.keep': 'Keep {tier}',
  'billing.pick.top': '{tier} is the highest tier. For more, talk to us.',
  'billing.pick.confirm':
    'From today each month bills at least {tier}, {monthly} a month, until you lower it. Lowering counts from the next month.',
  'billing.pick.confirm.keep': 'Each month keeps billing at least {tier}, {monthly} a month, until you lower it.',
  // The order button, wherever a yes is given (the data ceiling, Start, a
  // pick): the words of article 8(2) of the Consumer Rights Directive (terms §6).
  'billing.order.button': 'Order with obligation to pay',
  // Beside it while a yes begins within a consumer's withdrawal window: the
  // request to begin, which is not a tick box (0111 slice 7e; terms §7).
  'billing.order.beginNow':
    'By ordering, you ask us to begin at once, within your 14 days to withdraw. If you then withdraw, you pay for the part already provided, in proportion to the agreed price, and no more.',
  'billing.pick.notNow': 'Not now',
  'billing.pick.done': "Done: {tier}'s pace and data room are yours now, and each month bills at least {tier}.",
  'billing.pick.lowerTo': 'Lower to {tier}',
  'billing.pick.drop': 'Drop the pick',
  'billing.pick.lower.confirm': 'From {date}, each month bills at least {tier}. Until then, at least {now}.',
  'billing.pick.lower.confirmNone':
    'From {date}, what you use decides your tier again. Until then, each month bills at least {now}.',
  'billing.pick.lower.yes': 'Lower the pick',
  'billing.pick.lowerDone': 'Done: your pick changes on {date}.',
  'billing.pick.offerChanged':
    'What may be picked has changed since this page was shown. Look at the tiers again before picking.',
  'billing.pick.failed': 'Your pick was not recorded:',
  'billing.pick.loadFailed': 'The tiers you may pick could not be read',
  // A year paid ahead (0111 T11; ADR-0014, Amendment 2026-10-04; terms §8): credit
  // at six months' price, each month of the year at half its tier's monthly price.
  'billing.year.title': 'A year ahead',
  'billing.year.lead':
    "Pay a year ahead at six months' price. It is credit: each month of the year pays half the monthly price of the tier it used, and a month on Free pays nothing. What is left after the year pays the months after it, at the full price. Apart from the 14 days the law gives you to change your mind, it is not refunded; close your account and what is left ends with it. A year never renews by itself.",
  'billing.year.alpha': 'During the Alpha nothing is charged, so there is no year to buy yet.',
  'billing.year.credit': 'Credit left: {left}.',
  'billing.year.halfMonths': 'Half price from {from} to {to}.',
  'billing.year.thisMonthHalf': "This month is one of your year's: half price, from your credit.",
  'billing.year.price': '{year} for the year ({half} a month, half the monthly price)',
  'billing.year.starts': 'It would start in {from}, at half price to {to}.',
  'billing.year.startsAfter':
    'Its credit would pay from {credit}; its twelve months at half price follow your current year, {from} to {to}.',
  'billing.year.button': 'A year of {tier}',
  'billing.year.confirm':
    'A year of {tier} for {year}, invoiced now. It is credit: each month pays half the monthly price of the tier it used, and it is not refunded.',
  'billing.year.confirm.pick': 'From today each month bills at least {tier}, until you lower it.',
  'billing.year.done': 'Ordered: a year of {tier}, from {from}. Its invoice follows within the hour, under Invoices.',
  'billing.year.offerChanged':
    'What a year would be has changed since this page was shown. Look at it again before ordering.',
  'billing.year.failed': 'Your year was not ordered:',
  'billing.year.loadFailed': 'What a year would be could not be read',
  'billing.invoices': 'Invoices',
  'billing.noInvoices': 'No invoices yet',
  'billing.invoice': 'Invoice',
  'billing.creditNote': 'Credit note',
  'billing.creditedInFull': 'Credited in full: nothing left to pay.',
  'billing.creditedPart': '{credited} credited; {left} left to pay.',
  'billing.period': 'Period:',
  // Moneybird's dates, once it numbered the invoice (0111 slice 5).
  'billing.invoiceDate': 'Invoice date: {date}',
  'billing.invoiceDue': 'due date: {date}',
  // Moneybird's PDF of a numbered invoice (0111 T6); the format is in the file's name.
  'billing.invoice.download': 'Download the invoice',
  'billing.invoice.downloadFailed': 'The invoice could not be downloaded.',
  // The withdrawal function (0111 T7, terms §7). The button and the
  // confirmation are article 11a's own words, decided 2026-10-05 (0152 T6 (f)).
  'billing.withdrawal.title': 'Withdraw from your contract',
  'billing.withdrawal.lead':
    'You may withdraw from your contract for Ownpace {tier} until the end of {lastDay}, without giving a reason.',
  'billing.withdrawal.button': 'Withdraw from contract here',
  'billing.withdrawal.check':
    "Check these, then confirm. From that moment your organisation is on Free: your account and your migrations stay, at Free's pace, and what was invoiced is credited.",
  'billing.withdrawal.name': 'Your name',
  'billing.withdrawal.contract': 'The contract',
  'billing.withdrawal.contractValue': 'Ownpace {tier}, concluded on {since}',
  'billing.withdrawal.confirmTo': 'Confirmation to',
  'billing.withdrawal.confirm': 'Confirm withdrawal',
  'billing.withdrawal.notNow': 'Not now',
  'billing.withdrawal.done': 'Withdrawn on {date}. Your organisation is on Free. A confirmation is on its way to {email}.',
  'billing.withdrawal.doneNotSent':
    'Withdrawn on {date}. Your organisation is on Free. The confirmation could not be sent just now: we send it to {email} by hand.',
  'billing.withdrawal.failed': 'Your withdrawal was not recorded:',
  'billing.paymentMethods': 'Payment Methods',
  'billing.usageLoadFailed': 'Could not load the usage numbers.',
  'billing.pay': 'Pay',
  // A yes or a pick refused for want of invoice details (0111 decision 14).
  'billing.detailsFirst': 'Your invoice details come first: the name and address an invoice is made out to.',
  'billing.detailsFirst.link': 'Add your invoice details',
  'billing.payFailed': 'The payment could not be started.',
  'billing.usagePeriod': 'Usage for',
  'billing.asOf': 'as of',
  'billing.noPaymentMethods': 'No payment methods stored.',
  'billing.paymentMethodsLoadFailed': 'Could not load the payment methods.',
  'billing.default': 'Default',
  'billing.adminOnly':
    'Billing is available to owners and admins only; ask one for usage or invoice details.',
  'billing.invoicesLoadFailed': 'Could not load the invoices.',
  'billing.party.title': 'Invoice details',
  'billing.party.intro': 'Who invoices are addressed to.',
  'billing.party.missing':
    'Not provided yet. Invoices cannot be issued until this is filled in.',
  'billing.party.notNeeded': 'Not needed while your tier is free: nothing is invoiced.',
  'billing.party.kindConsumer': 'Private person',
  'billing.party.kindBusiness': 'Business',
  'billing.party.name': 'Name on the invoice',
  'billing.party.addressLine1': 'Address',
  'billing.party.addressLine2': 'Address line 2 (optional)',
  'billing.party.postalCode': 'Postal code',
  'billing.party.city': 'City',
  'billing.party.country': 'Country',
  // Where Moneybird e-mails the invoice (0111 decision 11).
  'billing.party.invoiceEmail': 'Invoice e-mail address',
  'billing.party.invoiceEmailHint': 'The invoice is sent here. It may be your bookkeeping’s address.',
  'billing.party.vatNumber': 'VAT number (optional)',
  'billing.party.save': 'Save',
  'billing.party.saved': 'Saved.',
  'billing.party.saveFailed': 'Saving failed.',
  'billing.party.loadFailed': 'Could not load the invoice details.',
  'billing.party.vat.notChecked': 'This VAT number has not been checked against VIES.',
  'billing.party.vat.checkNow': 'Check with VIES',
  'billing.party.vat.checking': 'Asking VIES…',
  'billing.party.vat.valid': 'VIES confirmed this number on {date}.',
  'billing.party.vat.invalid': 'VIES says this number is not valid (checked {date}).',
  'billing.party.vat.registeredTo': 'Registered to: {name}',
  'billing.party.vat.consultationNumber': 'Consultation number: {number}',
  'billing.party.vat.unqualified':
    'No consultation number — the check ran without the seller’s own VAT number configured.',
  'billing.party.vat.checkFailed': 'The check did not run.',
  'billing.party.vat.treatmentLabel': 'VAT on your invoices:',
  'billing.party.vat.treatment.domestic': 'Invoices will include VAT at the standard rate.',
  'billing.party.vat.treatment.reverseCharge':
    'Reverse charge: invoices carry no VAT; your business accounts for it in its own country.',
  'billing.party.vat.treatment.oss':
    'Invoices will include your own country’s VAT rate (One Stop Shop).',
  'billing.party.vat.treatment.outsideEu':
    'Outside the EU VAT area; how invoices are taxed is settled before the first invoice.',
  // The data ceiling (workplan 0109 T6): new first copies wait for the
  // customer's yes; updates carry on. Said with both prices (ADR-0014).
  // The ceiling said at Start (workplan 0109 T6): the preflight's measure and
  // the data already moved, against the ceiling. A note; it never blocks.
  'ceiling.atStart':
    'What these migrations hold, about {size}, and the {moved} already moved pass your data ceiling of {ceiling}.',
  'ceiling.atStart.holds':
    'At the ceiling, new items wait until you choose; changes to what is already migrated continue to sync.',
  'ceiling.atStart.choose': 'Choose now, or start anyway and choose when they wait:',
  'ceiling.atStart.billing': 'your data ceiling on the Billing page',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'billing.title': 'Facturering',
  'billing.subtitle': 'Beheer uw abonnement, verbruik en betalingen',
  'billing.currentUsage': 'Huidig verbruik',
  'billing.moved': 'Wat er is gemigreerd',
  'billing.moved.where': 'In totaal, over al uw migraties.',
  'billing.moved.data': 'Alle gegevens',
  'billing.moved.none': 'Er is nog niets gemigreerd.',
  'billing.moved.failed': 'De gemigreerde items konden niet worden geteld.',
  // ADR-0014's tier, on the customer's own usage screen (0121 T4).
  'billing.yourTier': 'Waar u hiermee op uitkomt',
  'billing.monthBills': 'Wat deze maand kost',
  'billing.tierDataOf': '{moved} van {ceiling}',
  'billing.tierAlphaMoved': 'Verplaatst tijdens de Alpha, telt niet mee',
  'billing.tierBeyond.bands': 'Daar zit(ten) {count} bijgekocht(e) blok(ken) bij, dus valt binnen {tier}.',
  'billing.tierBeyond.paths':
    'Er liepen meer migraties tegelijk dan past binnen {tier}, dus deze maand kost {tier}. Er kunnen geen nieuwe aanvangen tot er migraties worden gestopt of u naar een groter pakket gaat.',
  'billing.tierBeyond.data':
    'Er is meer verplaatst dan past binnen {tier}, dus deze maand kost {tier}. Nieuwe items wachten op uw keuze: verhoging van het pakket of aanvullende data.',
  'billing.tierPerYear': 'voor een jaar',
  'billing.tierPerMonth': 'per maand',
  'billing.tierFree': 'Gratis: op dit pakket wordt niets gefactureerd',
  'billing.tierDecidedByPaths': 'Bepaald door aantal gelijktijdige migraties.',
  'billing.tierDecidedByData': 'Bepaald door hoeveelheid verplaatste gegevens.',
  'billing.tierDecidedByBoth':
    'Bepaald door zowel wat er gelijktijdig migreerde als de hoeveelheid verplaatste data.',
  'billing.tierPeakPaths': 'Hoogste aantal gelijktijdige migraties',
  'billing.tierDataMoved': 'Data verplaatst, in totaal',
  'billing.tierBeyondTable': 'Voorbij het hoogste pakket — neem contact op met ons.',
  'billing.noUsage': 'Nog geen verbruiksgegevens beschikbaar',
  'billing.ceiling.title': 'Uw datalimiet',
  'billing.ceiling.moved': '{moved} van {ceiling} verplaatst, op {tier}.',
  'billing.ceiling.bands': 'Inclusief {count} extra blok(ken) data bijgekocht.',
  'billing.ceiling.alphaMoved': 'Daarnaast is {moved} verplaatst tijdens de Alpha; dit telt niet mee voor uw limiet.',
  'billing.ceiling.under':
    'Vanaf 80% van de limiet kunt u hier kiezen: naar een groter pakket, of eenmalig extra data.',
  'billing.ceiling.near':
    'U hebt {share} van uw datalimiet verbruikt. Bij de limiet stopt migratie van nieuwe items, totdat u een keuze maakt; synchronisatie van wijzigingen gaat wel door.',
  'billing.ceiling.reached':
    'Uw datalimiet is bereikt. Nieuwe items worden niet gemigreerd, totdat u een keuze maakt; synchronisatie van wijzigingen gaat wel door.',
  'billing.ceiling.alpha':
    'Tijdens de Alpha loopt alles gewoon door en wordt er niets in rekening gebracht. De prijzen hieronder zijn indicatief voor de fase daarna.',
  'billing.ceiling.moveUp':
    'Ga naar {tier}: {monthly} per maand. Uw limiet wordt {ceiling}, en er kunnen {paths} migraties tegelijk lopen.',
  'billing.ceiling.moveUp.button': 'Ga naar {tier}',
  'billing.ceiling.talkToUs': 'Er is geen pakket boven {tier}. Neem contact op als u meer wenst.',
  'billing.ceiling.topUp':
    'Of koop eenmalig nog {band} data erbij, voor {price}. Uw limiet wordt {ceiling}, en uw maandprijs blijft gelijk.',
  'billing.ceiling.topUp.button': 'Koop {band} erbij',
  'billing.ceiling.noTopUp': '{tier} biedt geen optie tot extra data: stap over naar een groter pakket.',
  'billing.ceiling.breakEven':
    'Bijkopen kost eenmalig {extra} meer en bespaart {saved} per maand, dus u hebt dat in ongeveer {days} dag(en) terugverdiend.',
  'billing.ceiling.breakEven.cheaper': 'Bijkopen kost eenmalig niet meer, en bespaart {saved} per maand.',
  'billing.ceiling.betterBuy':
    'Een groter pakket wordt aangeraden als u meer migraties gelijktijdig wenst te draaien: {next} draait er {nextPaths} tegelijk, {tier} {paths}.',
  'billing.ceiling.confirm.moveUp': 'U gaat akkoord met {monthly} per maand voor {tier}.',
  'billing.ceiling.confirm.topUp': 'U gaat akkoord met eenmalig {price} voor nog {band} data erbij.',
  'billing.ceiling.confirm.no': 'Nu niet',
  'billing.ceiling.done': 'Gedaan: uw datalimiet is nu {ceiling}.',
  'billing.ceiling.offerChanged':
    'Het aanbod is veranderd sinds deze pagina werd getoond, u heeft nog nergens mee ingestemd. Hieronder staat het aanbod zoals het nu is.',
  'billing.ceiling.loadFailed': 'Uw datalimiet kon niet worden gelezen',
  'billing.ceiling.yesFailed': 'Uw akkoord is niet vastgelegd:',
  'billing.tierPicked': 'Door u gekozen: als basis betaalt u elke maand {tier}.',
  'billing.pick.title': 'Kies een pakket',
  'billing.pick.lead':
    'Uw pakket volgt uw gebruik. U mag een hoger pakket kiezen, zoals voor een hogere synchronisatiefrequentie (tot iedere 15 minuten) of voor meer te migreren data: dat betaalt u dan als basis elke maand, tot u het verlaagt.',
  'billing.pick.standing':
    'U koos {tier}. Als basis betaalt u elke maand {tier}, tot u het verlaagt; gebruikt u meer, dan betaalt u het pakket dat daarbij hoort.',
  'billing.pick.standingThisMonth': 'U koos {tier}: deze maand betaalt u als basis {tier}.',
  'billing.pick.lowered': 'Vanaf {date} betaalt u als basis elke maand {tier}.',
  'billing.pick.loweredToNone': 'Vanaf {date} bepaalt uw gebruik weer uw pakket.',
  'billing.pick.alpha':
    'Tijdens de Alpha is elk pakket gratis, ongeacht frequentie, gelijktijdigheid en data, er valt dus nu niets te kiezen.',
  'billing.pick.monthly': '{monthly} per maand',
  'billing.pick.room': '{paths} migraties gelijktijdig, tot {data}.',
  'billing.pick.pace':
    'Elk pakket hier migreert ronde na ronde, tot de eerste migratie klaar is. Daarna wordt elk uur (tot iedere 15 minuten mogelijk) gecontroleerd of er nieuwe of gewijzigde items zijn.',
  'billing.pick.button': 'Kies {tier}',
  'billing.pick.keep': '{tier} houden',
  'billing.pick.top': '{tier} is het hoogste pakket. Wilt u meer, neem dan contact op.',
  'billing.pick.confirm':
    'Vanaf vandaag betaalt u als basis elke maand {tier}, {monthly} per maand, tot u het verlaagt. Verlagen telt vanaf de volgende maand.',
  'billing.pick.confirm.keep':
    'U blijft als basis elke maand {tier} betalen, {monthly} per maand, tot u het verlaagt.',
  // De woorden van artikel 6:230v lid 3 BW.
  'billing.order.button': 'Bestelling met betalingsverplichting',
  'billing.order.beginNow':
    'Met uw bestelling vraagt u ons direct te beginnen, binnen uw bedenktijd van 14 dagen. Herroept u daarna, dan betaalt u voor het deel dat al geleverd is, naar verhouding van de afgesproken prijs, en niet meer.',
  'billing.pick.notNow': 'Nu niet',
  'billing.pick.done':
    'Klaar: uw migraties hebben nu de frequentie en datalimiet van {tier}; u betaalt als basis elke maand {tier}.',
  'billing.pick.lowerTo': 'Verlagen naar {tier}',
  'billing.pick.drop': 'Keuze laten vervallen',
  'billing.pick.lower.confirm':
    'Vanaf {date} betaalt u als basis elke maand {tier}. Tot die datum betaalt u als basis {now}.',
  'billing.pick.lower.confirmNone':
    'Vanaf {date} bepaalt uw gebruik weer uw pakket. Tot die datum betaalt u als basis elke maand {now}.',
  'billing.pick.lower.yes': 'Keuze verlagen',
  'billing.pick.lowerDone': 'Klaar: uw keuze verandert op {date}.',
  'billing.pick.offerChanged':
    'Wat u kon kiezen is veranderd sinds deze pagina werd getoond. Bekijk de pakketten opnieuw voordat u kiest.',
  'billing.pick.failed': 'Uw keuze is niet vastgelegd:',
  'billing.pick.loadFailed': 'De pakketten die u kunt kiezen konden niet worden opgehaald',
  'billing.year.title': 'Een jaar vooruit',
  'billing.year.lead':
    'Betaal een jaar vooruit, voor de prijs van zes maanden. Het is een tegoed: elke maand van het jaar betaalt de helft van de maandprijs van het pakket dat ze gebruikte, en een maand op Free betaalt niets. Wat na het jaar over is, betaalt de maanden daarna tegen de volle prijs. Op de 14 dagen bedenktijd na die de wet u geeft, wordt het niet terugbetaald; sluit u uw account, dan vervalt wat er over is. Een jaar wordt nooit vanzelf verlengd.',
  'billing.year.alpha': 'Tijdens de Alpha wordt niets in rekening gebracht, er valt dus nog geen jaar te kopen.',
  'billing.year.credit': 'Tegoed over: {left}.',
  'billing.year.halfMonths': 'Halve prijs van {from} tot en met {to}.',
  'billing.year.thisMonthHalf': 'Deze maand hoort bij uw jaar: halve prijs, uit uw tegoed.',
  'billing.year.price': '{year} voor het jaar ({half} per maand, de helft van de maandprijs)',
  'billing.year.starts': 'Het zou beginnen in {from}, tegen halve prijs tot en met {to}.',
  'billing.year.startsAfter':
    'Het tegoed zou betalen vanaf {credit}; de twaalf maanden tegen halve prijs volgen op uw huidige jaar, {from} tot en met {to}.',
  'billing.year.button': 'Een jaar {tier}',
  'billing.year.confirm':
    'Een jaar {tier} voor {year}, nu gefactureerd. Het is een tegoed: elke maand betaalt de helft van de maandprijs van het pakket dat ze gebruikte, en het wordt niet terugbetaald.',
  'billing.year.confirm.pick': 'Vanaf vandaag betaalt u als basis elke maand {tier}, tot u het verlaagt.',
  'billing.year.done': 'Besteld: een jaar {tier}, vanaf {from}. De factuur volgt binnen het uur, onder Facturen.',
  'billing.year.offerChanged':
    'Wat een jaar zou zijn is veranderd sinds deze pagina werd getoond. Bekijk het opnieuw voordat u bestelt.',
  'billing.year.failed': 'Uw jaar is niet besteld:',
  'billing.year.loadFailed': 'Wat een jaar zou zijn kon niet worden opgehaald',
  'billing.invoices': 'Facturen',
  'billing.noInvoices': 'Nog geen facturen',
  'billing.invoice': 'Factuur',
  'billing.creditNote': 'Creditnota',
  'billing.creditedInFull': 'Volledig gecrediteerd: er is niets meer te betalen.',
  'billing.creditedPart': '{credited} gecrediteerd; nog {left} te betalen.',
  'billing.period': 'Periode:',
  'billing.invoiceDate': 'Factuurdatum: {date}',
  'billing.invoiceDue': 'vervaldatum: {date}',
  'billing.invoice.download': 'Factuur downloaden',
  'billing.invoice.downloadFailed': 'De factuur kon niet worden gedownload.',
  'billing.withdrawal.title': 'Uw overeenkomst herroepen',
  'billing.withdrawal.lead':
    'U kunt uw overeenkomst voor Ownpace {tier} tot en met {lastDay} herroepen, zonder een reden te geven.',
  'billing.withdrawal.button': 'Hier de overeenkomst herroepen',
  'billing.withdrawal.check':
    'Controleer dit en bevestig. Vanaf dat moment staat uw organisatie op Free: uw account en uw migraties blijven, in het tempo van Free, en wat gefactureerd is, crediteren we.',
  'billing.withdrawal.name': 'Uw naam',
  'billing.withdrawal.contract': 'De overeenkomst',
  'billing.withdrawal.contractValue': 'Ownpace {tier}, gesloten op {since}',
  'billing.withdrawal.confirmTo': 'Bevestiging naar',
  'billing.withdrawal.confirm': 'Herroeping bevestigen',
  'billing.withdrawal.notNow': 'Nu niet',
  'billing.withdrawal.done': 'Herroepen op {date}. Uw organisatie staat op Free. Er is een bevestiging onderweg naar {email}.',
  'billing.withdrawal.doneNotSent':
    'Herroepen op {date}. Uw organisatie staat op Free. De bevestiging kon nu niet worden verstuurd: we sturen die zelf naar {email}.',
  'billing.withdrawal.failed': 'Uw herroeping is niet vastgelegd:',
  'billing.paymentMethods': 'Betaalmethoden',
  'billing.usageLoadFailed': 'De verbruikscijfers konden niet worden geladen.',
  'billing.pay': 'Betalen',
  'billing.detailsFirst': 'Eerst uw factuurgegevens: de naam en het adres waarop een factuur komt te staan.',
  'billing.detailsFirst.link': 'Vul uw factuurgegevens in',
  'billing.payFailed': 'De betaling kon niet worden gestart.',
  'billing.usagePeriod': 'Verbruik voor',
  'billing.asOf': 'per',
  'billing.noPaymentMethods': 'Geen betaalmethoden opgeslagen.',
  'billing.paymentMethodsLoadFailed': 'De betaalmethoden konden niet worden geladen.',
  'billing.default': 'Standaard',
  'billing.adminOnly':
    'Facturering is alleen voor eigenaren en beheerders; vraag hen naar gebruiks- of factuurgegevens.',
  'billing.invoicesLoadFailed': 'De facturen konden niet worden geladen.',
  'billing.party.title': 'Factuurgegevens',
  'billing.party.intro': 'Aan wie facturen worden gericht.',
  'billing.party.missing':
    'Nog niet ingevuld. Er kunnen geen facturen worden uitgereikt totdat dit is ingevuld.',
  'billing.party.notNeeded': 'Niet nodig zolang uw pakket gratis is: er wordt niets gefactureerd.',
  'billing.party.kindConsumer': 'Particulier',
  'billing.party.kindBusiness': 'Zakelijk',
  'billing.party.name': 'Naam op de factuur',
  'billing.party.addressLine1': 'Adres',
  'billing.party.addressLine2': 'Adresregel 2 (optioneel)',
  'billing.party.postalCode': 'Postcode',
  'billing.party.city': 'Plaats',
  'billing.party.country': 'Land',
  'billing.party.invoiceEmail': 'E-mailadres voor facturen',
  'billing.party.invoiceEmailHint': 'Hierheen wordt de factuur gestuurd. Dat mag het adres van uw boekhouding zijn.',
  'billing.party.vatNumber': 'Btw-nummer (optioneel)',
  'billing.party.save': 'Opslaan',
  'billing.party.saved': 'Opgeslagen.',
  'billing.party.saveFailed': 'Opslaan is mislukt.',
  'billing.party.loadFailed': 'De factuurgegevens konden niet worden geladen.',
  'billing.party.vat.notChecked': 'Dit btw-nummer is nog niet gecontroleerd bij VIES.',
  'billing.party.vat.checkNow': 'Controleren bij VIES',
  'billing.party.vat.checking': 'VIES wordt geraadpleegd…',
  'billing.party.vat.valid': 'VIES heeft dit nummer bevestigd op {date}.',
  'billing.party.vat.invalid': 'Volgens VIES is dit nummer niet geldig (gecontroleerd op {date}).',
  'billing.party.vat.registeredTo': 'Geregistreerd op naam van: {name}',
  'billing.party.vat.consultationNumber': 'Consultatienummer: {number}',
  'billing.party.vat.unqualified':
    'Geen consultatienummer — de controle werd gedaan zonder geconfigureerd btw-nummer van de verkoper.',
  'billing.party.vat.checkFailed': 'De controle is niet uitgevoerd.',
  'billing.party.vat.treatmentLabel': 'Btw op uw facturen:',
  'billing.party.vat.treatment.domestic': 'Facturen bevatten btw tegen het standaardtarief.',
  'billing.party.vat.treatment.reverseCharge':
    'Btw verlegd: facturen bevatten geen btw; uw bedrijf draagt de btw in eigen land af.',
  'billing.party.vat.treatment.oss':
    'Facturen bevatten het btw-tarief van uw eigen land (One Stop Shop).',
  'billing.party.vat.treatment.outsideEu':
    'Buiten het btw-gebied van de EU; de belasting van facturen wordt vóór de eerste factuur bepaald.',
  'ceiling.atStart':
    'Wat deze migraties bevatten, ongeveer {size}, en de {moved} die al verplaatst is, gaan samen over uw datalimiet van {ceiling}.',
  'ceiling.atStart.holds':
    'Bij de limiet wachten nieuwe items op uw keuze; wijzigingen aan wat al gemigreerd is gaan door.',
  'ceiling.atStart.choose': 'Kies nu, of start toch en kies wanneer u tegen de limiet loopt:',
  'ceiling.atStart.billing': 'uw datalimiet op de pagina Facturering',
};

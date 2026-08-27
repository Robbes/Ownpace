// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Per-locale copy for the parts of the site that are STRUCTURE rather than
 * prose — navigation, the footer, and the landing page's cards.
 *
 * Long prose lives in `site/pages/<locale>/*.md` and `site/legal/`, because a
 * paragraph is easier to translate and review as a document than as a string
 * in an object. This file holds the bits that have a shape.
 *
 * ADR-0013 makes the end-user surface bilingual EN+NL, and the public site is
 * the most end-user surface there is: it is where somebody who has never heard
 * of this lands. `site/site.unit.test.ts` fails if a key exists in one locale
 * and not the other — a half-translated page is worse than an untranslated
 * one, because the reader cannot tell which half they are missing.
 *
 * The prose boundary from ADR-0013 applies here too: **translate the frame,
 * never the finding.** Nothing on this site quotes a server refusal, so the
 * rule costs nothing today; it will matter the moment the pricing calculator
 * lands.
 */

export const LOCALES = ['en', 'nl'];
export const DEFAULT_LOCALE = 'en';

/** Where each locale's pages are served from. English is at the root. */
export const localeRoot = (locale) => (locale === DEFAULT_LOCALE ? '' : `/${locale}`);

export const COPY = {
  en: {
    htmlLang: 'en',
    langName: 'English',
    otherLangName: 'Nederlands',
    nav: {
      home: 'Home',
      how: 'How it works',
      pricing: 'Pricing',
      calculator: 'Estimate',
      privacy: 'Privacy',
      terms: 'Terms',
    },
    files: { home: 'index.html', how: 'how-it-works.html', pricing: 'pricing.html', calculator: 'estimate.html', privacy: 'privacy.html', terms: 'terms.html' },
    skip: 'Skip to content',
    footerTag: 'move your own data, at your own pace.',
    footerOss: 'Open source under the Apache License 2.0. Run it yourself, or let us run it.',
    footerStatus: 'Status',
    // A 404 on a site about moving data should reassure before it jokes: the
    // first thing a visitor wonders is whether something of theirs went
    // missing. It did not — nothing here is their data.
    notFound: {
      title: 'Page not found',
      // The number is not decoration: a visitor who has been redirected, or
      // served the wrong page, cannot tell a real 404 from a site that simply
      // lost its way. Saying it removes the doubt.
      heading: '404 \u2014 Nothing here. Not even a copy!',
      lede:
        'We move data at your own pace, but this page never made the trip. It may have been renamed, or it may never have existed \u2014 either way, nothing of yours was lost.',
      back: 'Back to the home page',
      status: 'Checking whether something is broken?',
    },
    heroTitle: 'Move off Google or Microsoft. At your own pace.',
    heroLede:
      'Ownpace copies your mail, contacts, calendar and files to a European provider you choose — and keeps the copy in step until <em>you</em> decide to switch over. No weekend deadline. No big-bang cutover. Your old account stays exactly where it is until you say otherwise.',
    ctaOrder: 'Request access',
    ctaPricing: 'See what it costs',
    ctaAllTiers: 'All five tiers, in full',
    ctaHow: 'How a migration works',
    heroFine: (from) =>
      `From ${from} for the first month. Prices published in full — no quote, no sales call.`,
    diffTitle: 'What makes this different',
    diff: [
      ['It is a move, not a copy',
       'Most migration tools run a copy job and hand you the result. Ownpace keeps running: every change on your old account arrives on the new one, for as long as you want, until you cut over.'],
      ['Nothing is deleted at the source',
       'Ever. Your old account is your fallback, and it stays intact whatever happens. That is not a promise about our intentions — the software has no way to delete from a source.'],
      ['European, all the way down',
       'Migrating off US cloud through a US service defeats the point. Ownpace runs in the EU, and the software is open source, so you can check that rather than trust it.'],
      ['Or run it yourself',
       'The whole thing is Apache-2.0. Run it on your own machine and we never see your data, receive no telemetry, and have nothing to be trusted with.'],
    ],
    wontTitle: 'What it will not do',
    wontLede: 'The honest list, in front of the price rather than behind it.',
    wont: [
      ['It does not sync backwards',
       'Data flows old → new. Your old account never changes, which is what keeps it a safe place to fall back to.'],
      ['It cannot move everything perfectly',
       'Providers differ, and some things do not survive the crossing. Whatever cannot be moved is reported to you item by item, with the reason — never dropped quietly.'],
      ['It is not a backup service',
       'Once you cut over, the migration is finished. Keeping a copy in step afterwards is a new migration you set up, and it is priced as one.'],
    ],
    costTitle: 'What it costs',
    costLede:
      'Two numbers decide your price: how many things you are moving <strong>at the same time</strong>, and how much data you have moved in total. You are on whichever is higher, and finishing a migration lowers your bill by itself.',
    costPick: (name, first, monthly, paths, data) =>
      `Most people want <strong>${name}</strong> — ${first} for the first month, then ${monthly} a month, for ${paths} migrations at once and ${data}.`,
    tierFirstMonth: 'first month',
    tierThen: 'a month after that',
    tierPaths: (n) => `<strong>${n}</strong> migration${n === 1 ? '' : 's'} at the same time`,
    tierData: (s) => `<strong>${s}</strong> of data moved`,
    tierSetup: (m) => `${m} of that first month is one-off setup`,
    tierThree: (m) => `${m} for a three-month migration`,
    tierStart: (name) => `Start with ${name}`,
    tierBadge: 'Most people',
    beyond: (paths, data, what) =>
      `Past ${paths} migrations at once or ${data}, <a href="{MAILTO}">${what.toLowerCase()}</a> — that is the one thing not published, because past the end of the scale we have to look at the actual case.`,
    draftBanner:
      'This is a draft. Passages marked like «THIS» are not filled in yet.',
    translationNote: null,
    /**
     * The pre-preflight calculator (workplan 0088 T3). A CALCULATOR, not a
     * plan selector: the visitor never chooses a tier, the page derives it
     * and says so. Rung 1 of the ladder — self-declared, a band at ±50%,
     * costing nothing — and every sentence that keeps it honest lives here.
     */
    calc: {
      title: 'What would yours cost?',
      lede:
        'Answer five questions and this page derives the tier — you never pick one. Everything is indicative: these are our assumptions until the free preflight measures your real accounts, and you can change every number below.',
      whoLegend: 'Who is moving?',
      who: { individual: 'Just me', family: 'My household (4 people)', sme: 'My business (10 seats)' },
      fromLegend: 'Moving away from?',
      from: { google: 'Google', microsoft: 'Microsoft', dropbox: 'Dropbox', apple: 'Apple', other: 'Somewhere else' },
      whatLegend: 'What is moving?',
      what: { mail: 'Mail', contacts: 'Contacts', calendar: 'Calendar', files: 'Files', photos: 'Photos' },
      howMuchLegend: 'How much is it?',
      howMuchHint:
        'Your current provider already shows these numbers on its storage page — check there, or keep our assumptions. Every field is editable; correcting us beats distrusting us.',
      itemsAssumed: '{0} items assumed',
      gbLabel: 'GB',
      untilLegend: 'Until when?',
      until: { m1: '1 month', m3: '3 months', m6: '6 months', ready: 'When I am ready' },
      untilHint:
        'Duration is a choice, not a prediction: the migration keeps your copy in step until you cut over, and the recurring part of the price is yours to end.',
      pathsNone: 'Tick what is moving and the count appears here.',
      pathsOne: '{0} — that is one migration.',
      pathsMany: '{0}, for {1} — that is {2} migrations at the same time.',
      forWho: { individual: 'one person', family: 'four people', sme: 'ten seats' },
      axisPaths: 'Migrations at the same time',
      axisData: 'Data to move',
      axisDecides: 'this one decides',
      bandLine: 'roughly {0}–{1} GB — a ±50% band, because these are self-declared numbers, not measured ones',
      tierLine: 'That lands on {0}.',
      tierDerived:
        'Derived from your answers, never picked — and it keeps deriving: finish migrations and the tier falls by itself.',
      tierSetup: '{0} one-off setup',
      tierMonthly: '{0} a month',
      tierFirstMonth: '{0} for the first month, setup included',
      tierThree: '{0} for a three-month move in total',
      stepUpRule: 'Step up later and you pay only the difference in setup.',
      beyondLine:
        'Past the published scale. Here we look at your actual case before quoting — talk to us.',
      billDown:
        'Finishing migrations lowers your bill by itself, automatically. The data axis never falls, so the size of what you moved sets a floor under the tier — or a top-up buys another whole band of room and you stay where you are.',
      topUpLine:
        'On {0}: {1} once buys another {2} of data room at the same monthly. Moving up to {3} instead costs {4} now and {5} more a month.',
      topUpBreakEven:
        'The top-up costs {0} more up front and saves {1} a month — it pays for itself in about {2} days.',
      topUpCheaper: 'The top-up is the cheaper choice from the first euro.',
      gmailCeiling:
        'Google caps Gmail IMAP downloads at 2.5 GB per account per day, so {0} GB of mail needs at least {1} days. That minimum comes from Google’s published ceiling, not from a bandwidth guess — and it is exactly why Ownpace syncs continuously and cuts over when you are ready.',
      gmailLonger: 'Note: that is longer than the {0} you picked — the mail sets the pace here.',
      cannotKnow:
        'One thing this page cannot know: whether your target accepts your data. The preflight verifies exactly that, and it is free.',
      assumptionsTitle: 'Where these numbers come from',
      assumptionsVersion:
        'Assumptions v{0}, {1} — judgement, not yet measured. They will be replaced by medians from real preflights, and this line will say so. Until then: argue with them above, every field is yours.',
      noscript:
        'This estimator runs one small script, on this page and nowhere else on the site. Without it, nothing is lost: the five tiers are published in full on the pricing page.',
      seeAllTiers: 'All five tiers, in full',
    },
  },

  nl: {
    htmlLang: 'nl',
    langName: 'Nederlands',
    otherLangName: 'English',
    nav: {
      home: 'Home',
      how: 'Hoe het werkt',
      pricing: 'Prijzen',
      calculator: 'Schatting',
      privacy: 'Privacy',
      terms: 'Voorwaarden',
    },
    files: { home: 'index.html', how: 'hoe-het-werkt.html', pricing: 'prijzen.html', calculator: 'schatting.html', privacy: 'privacy.html', terms: 'voorwaarden.html' },
    skip: 'Naar de inhoud',
    footerTag: 'verhuis uw eigen gegevens, in uw eigen tempo.',
    footerOss:
      'Open source onder de Apache License 2.0. Draai het zelf, of laat ons het draaien.',
    footerStatus: 'Status',
    notFound: {
      title: 'Pagina niet gevonden',
      heading: '404 \u2014 Hier staat niets. Zelfs geen kopie!',
      lede:
        'Wij verhuizen gegevens in uw eigen tempo, maar deze pagina is nooit meegegaan. Misschien is hij hernoemd, misschien heeft hij nooit bestaan \u2014 hoe dan ook, er is niets van u verloren gegaan.',
      back: 'Terug naar de startpagina',
      status: 'Wilt u weten of er iets stuk is?',
    },
    heroTitle: 'Weg bij Google of Microsoft. In uw eigen tempo.',
    heroLede:
      'Ownpace kopieert uw e-mail, contacten, agenda en bestanden naar een Europese aanbieder die u zelf kiest — en houdt die kopie bij tot <em>u</em> besluit over te stappen. Geen deadline in het weekend. Geen big bang. Uw oude account blijft precies waar het is, tot u iets anders zegt.',
    ctaOrder: 'Toegang aanvragen',
    ctaPricing: 'Bekijk wat het kost',
    ctaAllTiers: 'Alle vijf de pakketten, volledig',
    ctaHow: 'Hoe een verhuizing verloopt',
    heroFine: (from) =>
      `Vanaf ${from} voor de eerste maand. Prijzen staan er volledig op — geen offerte, geen verkoopgesprek.`,
    diffTitle: 'Wat dit anders maakt',
    diff: [
      ['Het is een verhuizing, geen kopie',
       'De meeste migratietools draaien één kopieerklus en geven u het resultaat. Ownpace blijft draaien: elke wijziging in uw oude account komt aan in het nieuwe, zolang u wilt, tot u overstapt.'],
      ['Aan de bron wordt nooit iets verwijderd',
       'Nooit. Uw oude account is uw vangnet en blijft intact, wat er ook gebeurt. Dat is geen belofte over onze bedoelingen — de software heeft simpelweg geen manier om iets bij een bron te verwijderen.'],
      ['Europees, tot op de bodem',
       'Weggaan bij Amerikaanse cloud via een Amerikaanse dienst mist het punt. Ownpace draait in de EU, en de software is open source, dus u kunt het nakijken in plaats van ons te geloven.'],
      ['Of draai het zelf',
       'Alles is Apache-2.0. Draai het op uw eigen machine en wij zien uw gegevens nooit, ontvangen geen telemetrie en hebben niets waarin u ons hoeft te vertrouwen.'],
    ],
    wontTitle: 'Wat het niet doet',
    wontLede: 'De eerlijke lijst, vóór de prijs in plaats van erachter.',
    wont: [
      ['Het synchroniseert niet terug',
       'Gegevens gaan van oud naar nieuw. Uw oude account verandert nooit, en juist daarom blijft het een veilige plek om op terug te vallen.'],
      ['Het kan niet alles perfect verhuizen',
       'Aanbieders verschillen, en sommige dingen overleven de oversteek niet. Wat niet mee kan, krijgt u stuk voor stuk te horen, met de reden — het verdwijnt nooit stilletjes.'],
      ['Het is geen back-updienst',
       'Zodra u overstapt, is de verhuizing klaar. Daarna een kopie bijhouden is een nieuwe verhuizing die u zelf instelt, en die wordt ook zo geprijsd.'],
    ],
    costTitle: 'Wat het kost',
    costLede:
      'Twee getallen bepalen uw prijs: hoeveel dingen u <strong>tegelijk</strong> verhuist, en hoeveel gegevens u in totaal hebt verhuisd. U zit op het hoogste van die twee, en een verhuizing afronden verlaagt uw rekening vanzelf.',
    costPick: (name, first, monthly, paths, data) =>
      `De meeste mensen willen <strong>${name}</strong> — ${first} voor de eerste maand, daarna ${monthly} per maand, voor ${paths} verhuizingen tegelijk en ${data}.`,
    tierFirstMonth: 'eerste maand',
    tierThen: 'per maand daarna',
    tierPaths: (n) => `<strong>${n}</strong> verhuizing${n === 1 ? '' : 'en'} tegelijk`,
    tierData: (s) => `<strong>${s}</strong> aan verhuisde gegevens`,
    tierSetup: (m) => `${m} van die eerste maand is eenmalige inrichting`,
    tierThree: (m) => `${m} voor een verhuizing van drie maanden`,
    tierStart: (name) => `Begin met ${name}`,
    tierBadge: 'Meest gekozen',
    beyond: (paths, data, what) =>
      `Boven ${paths} verhuizingen tegelijk of ${data} geldt: <a href="{MAILTO}">${what.toLowerCase()}</a> — dat is het enige dat niet gepubliceerd staat, omdat we voorbij het einde van de schaal echt naar uw situatie moeten kijken.`,
    draftBanner:
      'Dit is een concept. Stukken die er zo «UITZIEN» zijn nog niet ingevuld.',
    translationNote:
      'Deze vertaling is er voor uw gemak. Bij verschillen is de Engelse versie de tekst die geldt.',
    calc: {
      title: 'Wat zou het bij u kosten?',
      lede:
        'Beantwoord vijf vragen en deze pagina leidt het pakket af — u kiest er nooit zelf een. Alles is indicatief: dit zijn onze aannames totdat de gratis voorcontrole uw echte accounts meet, en elk getal hieronder kunt u aanpassen.',
      whoLegend: 'Wie verhuist er?',
      who: { individual: 'Alleen ik', family: 'Mijn huishouden (4 personen)', sme: 'Mijn bedrijf (10 werkplekken)' },
      fromLegend: 'Weg bij?',
      from: { google: 'Google', microsoft: 'Microsoft', dropbox: 'Dropbox', apple: 'Apple', other: 'Ergens anders' },
      whatLegend: 'Wat verhuist er?',
      what: { mail: 'E-mail', contacts: 'Contacten', calendar: 'Agenda', files: 'Bestanden', photos: 'Foto’s' },
      howMuchLegend: 'Hoeveel is het?',
      howMuchHint:
        'Uw huidige aanbieder toont deze getallen al op zijn opslagpagina — kijk daar, of houd onze aannames aan. Elk veld is aanpasbaar; ons verbeteren is beter dan ons wantrouwen.',
      itemsAssumed: '{0} items aangenomen',
      gbLabel: 'GB',
      untilLegend: 'Tot wanneer?',
      until: { m1: '1 maand', m3: '3 maanden', m6: '6 maanden', ready: 'Wanneer ik er klaar voor ben' },
      untilHint:
        'De duur is een keuze, geen voorspelling: de verhuizing houdt uw kopie bij tot u overstapt, en het terugkerende deel van de prijs beëindigt u zelf.',
      pathsNone: 'Vink aan wat er verhuist en de telling verschijnt hier.',
      pathsOne: '{0} — dat is één verhuizing.',
      pathsMany: '{0}, voor {1} — dat zijn {2} verhuizingen tegelijk.',
      forWho: { individual: 'één persoon', family: 'vier personen', sme: 'tien werkplekken' },
      axisPaths: 'Verhuizingen tegelijk',
      axisData: 'Te verhuizen gegevens',
      axisDecides: 'deze bepaalt',
      bandLine: 'ruwweg {0}–{1} GB — een band van ±50%, want dit zijn zelf opgegeven getallen, geen gemeten',
      tierLine: 'Dat komt uit op {0}.',
      tierDerived:
        'Afgeleid uit uw antwoorden, nooit gekozen — en het blijft afleiden: rond verhuizingen af en het pakket zakt vanzelf.',
      tierSetup: '{0} eenmalige inrichting',
      tierMonthly: '{0} per maand',
      tierFirstMonth: '{0} voor de eerste maand, inrichting inbegrepen',
      tierThree: '{0} voor een verhuizing van drie maanden in totaal',
      stepUpRule: 'Later een pakket omhoog? Dan betaalt u alleen het verschil in inrichting.',
      beyondLine:
        'Voorbij de gepubliceerde schaal. Hier kijken we eerst naar uw werkelijke situatie — neem contact op.',
      billDown:
        'Verhuizingen afronden verlaagt uw rekening vanzelf, automatisch. De gegevens-as zakt nooit, dus de omvang van wat u verhuisde legt een bodem onder het pakket — óf een bijkoop geeft u een hele extra band aan ruimte en u blijft waar u zit.',
      topUpLine:
        'Op {0}: {1} eenmalig koopt nog eens {2} aan gegevensruimte, tegen hetzelfde maandbedrag. In plaats daarvan omhoog naar {3} kost nu {4} en {5} per maand extra.',
      topUpBreakEven:
        'De bijkoop kost vooraf {0} meer en bespaart {1} per maand — dat is in ongeveer {2} dagen terugverdiend.',
      topUpCheaper: 'De bijkoop is vanaf de eerste euro de goedkopere keuze.',
      gmailCeiling:
        'Google begrenst Gmail-IMAP-downloads op 2,5 GB per account per dag, dus {0} GB e-mail heeft minstens {1} dagen nodig. Dat minimum volgt uit Googles gepubliceerde plafond, niet uit een bandbreedtegok — en het is precies waarom Ownpace doorlopend synchroniseert en pas overstapt wanneer u er klaar voor bent.',
      gmailLonger: 'Let op: dat is langer dan de {0} die u koos — de e-mail bepaalt hier het tempo.',
      cannotKnow:
        'Eén ding kan deze pagina niet weten: of uw doel uw gegevens accepteert. De voorcontrole verifieert precies dat, en die is gratis.',
      assumptionsTitle: 'Waar deze getallen vandaan komen',
      assumptionsVersion:
        'Aannames v{0}, {1} — inschatting, nog niet gemeten. Ze worden vervangen door medianen uit echte voorcontroles, en deze regel zal dat dan zeggen. Tot die tijd: wees het er gerust mee oneens, elk veld is van u.',
      noscript:
        'Deze rekenhulp draait één klein script, op deze pagina en nergens anders op de site. Zonder dat script mist u niets: de vijf pakketten staan volledig op de prijzenpagina.',
      seeAllTiers: 'Alle vijf de pakketten, volledig',
    },
  },
};

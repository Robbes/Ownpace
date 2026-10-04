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
      signIn: 'Sign in',
    },
    // The header's name for screen readers, and the button that opens it on a
    // phone (workplan 0152 T2).
    navName: 'Main',
    menu: 'Menu',
    files: { home: 'index.html', how: 'how-it-works.html', pricing: 'pricing.html', calculator: 'estimate.html', privacy: 'privacy.html', terms: 'terms.html', alpha: 'alpha.html', guide: 'alpha-guide.html' },
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
    // The calculator's button, under the tier cards and in the home page's
    // What it costs (workplan 0152 T6 (c)): the header no longer lists it.
    ctaEstimate: 'Work out what yours costs',
    // The first tier is free (ADR-0014, 2026-09-24): "From €0" would read as a
    // price that could be billed, so the line says what free covers instead.
    heroFree: (name, data) =>
      `${name}: one migration at a time, up to ${data}. Every price is published in full — no quote, no sales call.`,
    // Where to (workplan 0152 T4): what the app moves data into, from the
    // guarded copy in destinations.mjs. The data types are named as the app
    // names them (its 'domain.*' strings), and a guard holds them equal.
    whereTitle: 'Where to',
    whereLede:
      'Your new home is an account you open with a European provider, paid to them. Ownpace moves your data into it and keeps it in step.',
    destinations: {
      soverin: { name: 'Soverin', sub: '' },
      nextcloud: { name: 'Nextcloud', sub: '' },
      jmap: { name: 'A JMAP server', sub: 'such as Stalwart' },
      protocols: { name: 'Any other provider', sub: 'that speaks IMAP, CalDAV, CardDAV or WebDAV' },
    },
    dataTypes: { email: 'Email', calendar: 'Calendar', contact: 'Contacts', file: 'Files', task: 'Tasks' },
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
    costPick: (name, monthly, annual, paths, data) =>
      `<strong>${name}</strong>, for one person moving everything at once: ${monthly} a month, or ${annual} for a year, for ${paths} migrations at once and ${data}. There is no setup fee.`,
    tierMonth: 'a month',
    tierYear: 'for a year, half the monthly price',
    // Toward consumers a displayed price IS the final price (workplan 0111
    // T8): this says so out loud, with no rate in the copy — which country's
    // VAT sits inside it is the seller's problem, decided per invoice by the
    // treatment machinery, and a number here would drift the day OSS lands.
    vatIncluded: 'All prices include VAT.',
    tierPaths: (n) => `<strong>${n}</strong> migration${n === 1 ? '' : 's'} at the same time`,
    tierData: (s) => `<strong>${s}</strong> of data moved`,
    tierNoSetup: 'No setup fee',
    tierThree: (m) => `${m} for a three-month migration, paying monthly`,
    tierStart: (name) => `Start with ${name}`,
    // Each tier's subtitle and note, in the page's language (workplan 0152 T1
    // (b)): they lived in prices.mjs in English only, so the Dutch pricing page
    // printed them in English. No tier says "most people" any more: nothing
    // counts who picks what, so it is said as a fact about the tier.
    tierText: {
      free: {
        who: 'One person, one thing at a time',
        note: 'Move your mail, then your contacts, then your calendar, then your files — one after another. The patient option, and free.',
      },
      small: { who: 'One person, everything at once', note: 'Everything you own, moving at the same time.' },
      medium: {
        who: 'A household, a team, or a small business',
        note: 'Five people with everything, or four with room to spare. Self-service, with a manual and somewhere to ask questions.',
      },
      large: {
        who: 'An SME',
        note: 'Where a real person gets involved: planning, the cutover, and someone to call when a provider does something strange.',
      },
      xl: { who: 'An organisation, or an MSP', note: 'Many accounts, one migration, one relationship.' },
    },
    tierFree: 'Free',
    tierFreeFor: 'for as long as it runs',
    tierNoInvoice: 'No invoice',
    tierNoInvoiceWhy: 'no card, no billing details',
    tierFreeEdge: (next) =>
      `A second migration at the same time, or more data, moves you to ${next} — and we ask you first.`,
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
      kept:
        'The free preflight that follows keeps counts, sizes and per-folder totals — never an inventory of your items — and keeps them with your migration, never longer than your account.',
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
      tierMonthly: '{0} a month',
      tierYear: '{0} for a year, paid ahead: half the monthly price',
      tierFree: 'Free: nothing a month, and no invoice.',
      tierFreeEdge: 'A second migration at the same time, or more than {0}, moves you to {1} — and we ask you first.',
      tierThree: '{0} for a three-month move in total, paying monthly',
      stepUpRule: 'There is no setup fee: moving up later costs only the higher monthly, from then on.',
      beyondLine:
        'Past the published scale. Here we look at your actual case before quoting — talk to us.',
      billDown:
        'Finishing migrations lowers your bill by itself, automatically. The data axis never falls, so the size of what you moved sets a floor under the tier — or a top-up buys another whole band of room and you stay where you are.',
      topUpLine:
        'On {0}: {1} once buys another {2} of data room at the same monthly. Moving up to {3} instead costs {4} more a month.',
      topUpBreakEven:
        'If you will keep going for longer than about {0} days, the top-up is the cheaper choice; if you will stop sooner, moving up is.',
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
      // The app's own word on its sign-in page.
      signIn: 'Aanmelden',
    },
    navName: 'Hoofdmenu',
    menu: 'Menu',
    files: { home: 'index.html', how: 'hoe-het-werkt.html', pricing: 'prijzen.html', calculator: 'schatting.html', privacy: 'privacy.html', terms: 'voorwaarden.html', alpha: 'alpha.html', guide: 'alpha-handleiding.html' },
    skip: 'Naar de inhoud',
    footerTag: 'neem uw gegevens mee, in uw eigen tempo.',
    footerOss:
      'Open source onder de Apache License 2.0. Draai het zelf, of laat ons het draaien.',
    footerStatus: 'Status',
    notFound: {
      title: 'Pagina niet gevonden',
      heading: '404 \u2014 Hier staat niets. Zelfs geen kopie!',
      lede:
        'Wij migreren gegevens in uw eigen tempo, maar deze pagina is nooit meegegaan. Misschien is hij hernoemd, misschien heeft hij nooit bestaan \u2014 hoe dan ook, er is niets van u verloren gegaan.',
      back: 'Terug naar de startpagina',
      status: 'Wilt u weten of er iets stuk is?',
    },
    heroTitle: 'Weg bij Google of Microsoft. In uw eigen tempo.',
    heroLede:
      'Ownpace kopieert uw e-mail, contacten, agenda en bestanden naar een Europese aanbieder die u zelf kiest — en houdt die kopie bij tot <em>u</em> besluit over te stappen. Geen deadline in het weekend. Geen big bang. Uw oude account blijft precies waar het is, tot u iets anders zegt.',
    ctaOrder: 'Toegang aanvragen',
    ctaPricing: 'Bekijk wat het kost',
    ctaAllTiers: 'Alle vijf de pakketten, volledig',
    ctaEstimate: 'Reken uit wat het u kost',
    heroFree: (name, data) =>
      `${name}: één migratie tegelijk, tot ${data}. Alle prijzen staan er volledig op — geen offerte, geen verkoopgesprek.`,
    whereTitle: 'Waar naartoe',
    whereLede:
      'Uw nieuwe thuis is een account dat u opent bij een Europese aanbieder, en dat u aan hen betaalt. Ownpace migreert uw gegevens daarheen en houdt ze bij.',
    destinations: {
      soverin: { name: 'Soverin', sub: '' },
      nextcloud: { name: 'Nextcloud', sub: '' },
      jmap: { name: 'Een JMAP-server', sub: 'zoals Stalwart' },
      protocols: { name: 'Elke andere aanbieder', sub: 'die IMAP, CalDAV, CardDAV of WebDAV spreekt' },
    },
    dataTypes: { email: 'E-mail', calendar: 'Agenda', contact: 'Contacten', file: 'Bestanden', task: 'Taken' },
    diffTitle: 'Wat dit anders maakt',
    diff: [
      ['Het is een migratie, geen kopie',
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
      ['Het kan niet alles perfect migreren',
       'Aanbieders verschillen, en sommige dingen overleven de oversteek niet. Wat niet mee kan, krijgt u stuk voor stuk te horen, met de reden — het verdwijnt nooit stilletjes.'],
      ['Het is geen back-updienst',
       'Zodra u overstapt, is de migratie klaar. Daarna een kopie bijhouden is een nieuwe migratie die u zelf instelt, en die wordt ook zo geprijsd.'],
    ],
    costTitle: 'Wat het kost',
    costLede:
      'Twee getallen bepalen uw prijs: hoeveel migraties er <strong>tegelijk</strong> lopen, en hoeveel gegevens u in totaal hebt gemigreerd. U zit op het hoogste van die twee, en een migratie afronden verlaagt uw rekening vanzelf.',
    costPick: (name, monthly, annual, paths, data) =>
      `<strong>${name}</strong>, voor één persoon die alles tegelijk migreert: ${monthly} per maand, of ${annual} voor een jaar, voor ${paths} migraties tegelijk en ${data}. Er zijn geen inrichtingskosten.`,
    tierMonth: 'per maand',
    tierYear: 'voor een jaar, de helft van de maandprijs',
    vatIncluded: 'Alle prijzen zijn inclusief btw.',
    tierPaths: (n) => `<strong>${n}</strong> migratie${n === 1 ? '' : 's'} tegelijk`,
    tierData: (s) => `<strong>${s}</strong> aan gemigreerde gegevens`,
    tierNoSetup: 'Geen inrichtingskosten',
    tierThree: (m) => `${m} voor een migratie van drie maanden, per maand betaald`,
    tierStart: (name) => `Begin met ${name}`,
    tierText: {
      free: {
        who: 'Eén persoon, één ding tegelijk',
        note: 'Migreer uw e-mail, dan uw contacten, dan uw agenda, dan uw bestanden — de een na de ander. De geduldige keuze, en gratis.',
      },
      small: { who: 'Eén persoon, alles tegelijk', note: 'Al uw gegevens, tegelijk gemigreerd.' },
      medium: {
        who: 'Een huishouden, een team of een klein bedrijf',
        note: 'Vijf mensen met alles, of vier met ruimte over. Zelfbediening, met een handleiding en een plek om vragen te stellen.',
      },
      large: {
        who: 'Een mkb-bedrijf',
        note: 'Hier komt een echt mens bij: de planning, de overstap, en iemand bij wie u terechtkunt als een aanbieder iets vreemds doet.',
      },
      xl: { who: 'Een organisatie, of een MSP', note: 'Veel accounts, één migratie, één aanspreekpunt.' },
    },
    tierFree: 'Gratis',
    tierFreeFor: 'zolang het loopt',
    tierNoInvoice: 'Geen factuur',
    tierNoInvoiceWhy: 'geen kaart, geen factuurgegevens',
    tierFreeEdge: (next) =>
      `Een tweede migratie tegelijk, of meer gegevens, brengt u naar ${next} — en we vragen het u eerst.`,
    beyond: (paths, data, what) =>
      `Boven ${paths} migraties tegelijk of ${data} geldt: <a href="{MAILTO}">${what.toLowerCase()}</a> — dat is het enige dat niet gepubliceerd staat, omdat we voorbij het einde van de schaal echt naar uw situatie moeten kijken.`,
    draftBanner:
      'Dit is een concept. Stukken die er zo «UITZIEN» zijn nog niet ingevuld.',
    translationNote:
      'Deze vertaling is er voor uw gemak. Bij verschillen is de Engelse versie de tekst die geldt.',
    calc: {
      title: 'Wat zou het bij u kosten?',
      lede:
        'Beantwoord vijf vragen en deze pagina leidt het pakket af — u kiest er nooit zelf een. Alles is indicatief: dit zijn onze aannames totdat de gratis voorcontrole uw echte accounts meet, en elk getal hieronder kunt u aanpassen.',
      whoLegend: 'Voor wie is het?',
      who: { individual: 'Alleen ik', family: 'Mijn huishouden (4 personen)', sme: 'Mijn bedrijf (10 werkplekken)' },
      fromLegend: 'Weg bij?',
      from: { google: 'Google', microsoft: 'Microsoft', dropbox: 'Dropbox', apple: 'Apple', other: 'Ergens anders' },
      whatLegend: 'Wat wilt u migreren?',
      what: { mail: 'E-mail', contacts: 'Contacten', calendar: 'Agenda', files: 'Bestanden', photos: 'Foto’s' },
      howMuchLegend: 'Hoeveel is het?',
      howMuchHint:
        'Uw huidige aanbieder toont deze getallen al op zijn opslagpagina — kijk daar, of houd onze aannames aan. Elk veld is aanpasbaar; ons verbeteren is beter dan ons wantrouwen.',
      itemsAssumed: '{0} items aangenomen',
      gbLabel: 'GB',
      untilLegend: 'Tot wanneer?',
      until: { m1: '1 maand', m3: '3 maanden', m6: '6 maanden', ready: 'Wanneer ik er klaar voor ben' },
      untilHint:
        'De duur is een keuze, geen voorspelling: de migratie houdt uw kopie bij tot u overstapt, en het terugkerende deel van de prijs beëindigt u zelf.',
      kept:
        'De gratis preflight die volgt bewaart aantallen, omvang en totalen per map — nooit een inventaris van uw items — en bewaart ze bij uw migratie, nooit langer dan uw account.',
      pathsNone: 'Vink aan wat u wilt migreren en de telling verschijnt hier.',
      pathsOne: '{0} — dat is één migratie.',
      pathsMany: '{0}, voor {1} — dat zijn {2} migraties tegelijk.',
      forWho: { individual: 'één persoon', family: 'vier personen', sme: 'tien werkplekken' },
      axisPaths: 'Migraties tegelijk',
      axisData: 'Te migreren gegevens',
      axisDecides: 'deze bepaalt',
      bandLine: 'ruwweg {0}–{1} GB — een band van ±50%, want dit zijn zelf opgegeven getallen, geen gemeten',
      tierLine: 'Dat komt uit op {0}.',
      tierDerived:
        'Afgeleid uit uw antwoorden, nooit gekozen — en het blijft afleiden: rond migraties af en het pakket zakt vanzelf.',
      tierFree: 'Gratis: niets per maand en geen factuur.',
      tierFreeEdge: 'Een tweede migratie tegelijk, of meer dan {0}, brengt u naar {1} — en we vragen het u eerst.',
      tierMonthly: '{0} per maand',
      tierYear: '{0} voor een jaar, vooruitbetaald: de helft van de maandprijs',
      tierThree: '{0} voor een migratie van drie maanden in totaal, per maand betaald',
      stepUpRule: 'Er zijn geen inrichtingskosten: later een pakket omhoog kost alleen het hogere maandbedrag, vanaf dat moment.',
      beyondLine:
        'Voorbij de gepubliceerde schaal. Hier kijken we eerst naar uw werkelijke situatie — neem contact op.',
      billDown:
        'Migraties afronden verlaagt uw rekening vanzelf, automatisch. De gegevens-as zakt nooit, dus de omvang van wat u migreerde legt een bodem onder het pakket — óf een bijkoop geeft u een hele extra band aan ruimte en u blijft waar u zit.',
      topUpLine:
        'Op {0}: {1} eenmalig koopt nog eens {2} aan gegevensruimte, tegen hetzelfde maandbedrag. In plaats daarvan omhoog naar {3} kost {4} per maand extra.',
      topUpBreakEven:
        'Gaat u langer door dan ongeveer {0} dagen, dan is de bijkoop goedkoper; stopt u eerder, dan is omhoog gaan goedkoper.',
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

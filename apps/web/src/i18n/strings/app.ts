// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The frame every screen shares: the menu, common buttons, the not-found page and the alpha line.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  // The word on a fold (workplan 0118): one line stays on screen, the rest opens under it.
  'fold.why': 'Why?',
  'fold.how': 'How?',
  'fold.more': 'More',
  'status.link': 'Service status',
  'notFound.heading': 'Nothing here... we carry on migrating quietly.',
  'notFound.lede':
    'No screen has that address; renamed or never there, your migrations are untouched.',
  'notFound.back': 'Back to the start',
  'nav.mappings': 'Migrations',
  'nav.back': 'Back',
  'nav.menu': 'Menu',
  'nav.review': 'Review',
  'nav.deletions': 'Deletions',
  'nav.moves': 'Moves',
  'nav.failures': 'Failures',
  'nav.check': 'Check',
  'nav.finish': 'Finish',
  'nav.log': 'Log',
  'nav.tenants': 'Team',
  'nav.billing': 'Billing',
  'nav.signOut': 'Sign out',
  // The first thing the frame draws, seen only with focus: a way past the
  // menu to the page (0145 T1). The site's words for the same link.
  'nav.skipToContent': 'Skip to content',
  // "Report a problem" (workplan 0130): what the person writes, and what goes
  // with it, said before anything is sent.
  'nav.reportProblem': 'Report a problem',
  'language.label': 'Language',
  'common.requestFailed': 'The request did not complete.',
  // Said after a link that opens a new tab, to a screen reader only: the
  // legal texts, the tester guide, a guide's outside links and a refusal's
  // guide (it was the acceptance screen's own until the UX sweep).
  'common.newTab': '(opens in a new tab)',
  'asof.updated': 'Updated',
  'asof.refresh': 'Refresh',
  // The tag on a source that has not yet met a real account (workplan 0131
  // T2, the owner's D6). Text inside the card's button, so a screen reader
  // reads it as part of the card's name (0145 T2); the why folds beside it.
  'frontDoor.experimental': 'Experimental',
  'frontDoor.experimental.why':
    'Built, but needs more testing against a real account of this kind. Keep your old account and check what arrives.',
  'frontDoor.experimental.wholeDomain.why':
    'Domain-wide delegation is built and has not yet run against a real Workspace. Keep your old account and check what arrives.',
  // WHAT THE STAR MEANS, said once (2026-09-07). Eight labels used to carry
  // "(optional)" and the rest carried nothing, which read as "these eight are
  // the optional ones" — and it was wrong the moment a deployment carried no
  // OAuth client, because then the unmarked client pair was mandatory too.
  // The asterisk answers that question per field and per deployment, so it is
  // the only place the answer lives, and this line says how to read it.
  'form.requiredLegend': 'Fields marked * are required.',
  // A failure on the grant or progress page that the server wrote no sentence
  // for (workplan 0145 T6, review): the page's own words, in its language,
  // rather than the transport's English or a parser's JSON. The server's own
  // refusals come in pairs from `@openmig/shared` and are not these.
  'link.unreachable': 'This page could not reach the server. Check your connection and try again.',
  'link.unreadable':
    'Something went wrong on this page. Try again later; if it keeps happening, please tell the person who sent you the link to contact support.',
  // The site serves a newer build than the page on screen (workplan 0145):
  // most likely a deploy while the tab stayed open. The page never reloads by
  // itself, so the sentence says what a reload costs.
  'reload.newer':
    'A newer version of this page is available: reload the page to continue; anything you have not saved yet is lost.',
  'reload.button': 'Reload the page',
  'common.loading': 'Loading…',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  // A read that failed, once more (the Migrations list and a person's page).
  'common.tryAgain': 'Try again',
  // The appliance's own log page (0129 D5): the same page, for its owner, and
  // nothing recorded about reading it.
  'log.lead.why':
    'What an audit event changed is not shown here: it stays in the database, for an investigation to query. The text of an error stays in the appliance\u2019s output, on the line with the same reference.',
  // The alpha note (workplan 0131 T1): the owner's welcome (0131 D4's
  // amendment, 2026-10-04), and then its two links. The owner wrote it in
  // Dutch; this is its translation. It says "move", not "switch": the welcome's
  // "overstappen" is not the cutover. Two keys, because the first sentence is
  // the bold lead. Until then the note said what the Alpha
  // means; those facts are now in both mails (`grantedAlpha` in
  // @openmig/shared's notifications.ts), after the mails' own welcome (the
  // owner's text review, 2026-10-10), and in the Alpha conditions and the
  // tester guide. `an-alpha-said-out-loud.unit.test.tsx` holds that split: the
  // note is the welcome and its links, and the facts are the mails'.
  'alpha.note.lead': 'Welcome to the Alpha!',
  'alpha.note.welcome':
    'Try Ownpace at your own pace, and move to European alternatives step by step.',
  // After the note's words, its two links (0131 T1 (b)): the Alpha conditions,
  // by `acceptance.doc.alpha`, and the tester guide (0144 T1), by this, the
  // guide page's own title (site/build.mjs, without " — Ownpace").
  'alpha.note.guide': 'Guide to the Alpha',
  // The Alpha, said to a visitor who was not invited (workplan 0152 T1 (a);
  // the owner, 2026-10-05: "Do suggestions for non alpha viewers"). The
  // welcome above is written for the people invited, and stays theirs. A
  // visitor reads this fact instead, then `alpha.nothingCharged`, then a link
  // to the request page by its own title, `access.title`: on every page of
  // the public site while it is built for the Alpha, and in the guides for a
  // visitor without a session (`AlphaVisitorLine` in AlphaNote.tsx). The site
  // cannot import this file, so `site/copy.mjs` copies the three, and
  // `scripts/the-alpha-said-to-a-visitor.unit.test.ts` holds them equal.
  'alpha.visitor.line': 'Ownpace is in its Alpha, by invitation.',
  // Nothing charged (workplan 0131 T3): the first sentence of the Billing
  // line that takes the subtitle's place, the last sentence of the request
  // form's package hint, and the second of the visitor's line above. One key,
  // so they cannot drift apart. "Charged", as both mails' Alpha paragraph
  // says it, and not "invoiced", which is what a tier says (0109 T8). The
  // note no longer says it.
  'alpha.nothingCharged': 'Nothing is charged during the Alpha.',
  // A person to write to (workplan 0144 T6 (a)), in §3's words. `{address}` is
  // the deployment's VITE_SUPPORT_EMAIL, drawn as a mailto: link where it
  // stands (`SupportLine.tsx`); without it neither is shown. `help.line` goes
  // on the pages before sign-in. `help.sidebar` goes in the sidebar, where
  // *Report a problem* would be, while the report form is off.
  'help.line':
    'Stuck? Mail {address} and name the page you are on. Never send a password or other sensitive data.',
  'help.sidebar': 'Help: {address}',
  'role.owner': 'Owner',
  'role.admin': 'Admin',
  'role.member': 'Member',
  'role.viewer': 'Viewer',
  'memberStatus.active': 'Active',
  'memberStatus.invited': 'Invited',
  'memberStatus.declined': 'Declined',
  'memberStatus.suspended': 'Suspended',
  'memberStatus.removed': 'Removed',
  'nav.decisions': 'Needs you',
  'nav.connections': 'Accounts',
  'nav.setup': 'Setup checklist',
  'nav.docs': 'Setup guides',
  'nav.help': 'Help',
  'nav.needsYou.count.one': '1 waiting on you',
  'nav.needsYou.count.many': '{n} waiting on you',
} as const;

export const nl: Record<keyof typeof en, string> = {
  // Het woord op een uitklapbaar deel (workplan 0118) — zie het Engelse blok.
  'fold.why': 'Waarom?',
  // Het woord op een uitklapbaar deel (workplan 0118) — zie het Engelse blok.
  'fold.how': 'Hoe?',
  // Het woord op een uitklapbaar deel (workplan 0118) — zie het Engelse blok.
  'fold.more': 'Meer',
  'status.link': 'Service status',
  'notFound.heading': 'Hier staat niets... we migreren rustig aan verder.',
  'notFound.lede':
    'Geen pagina heeft dit adres (meer), uw migraties zijn ongemoeid.',
  'notFound.back': 'Terug naar het begin',
  'nav.mappings': 'Migraties',
  'nav.back': 'Terug',
  'nav.menu': 'Menu',
  'nav.review': 'Controleren en bevestigen',
  'nav.deletions': 'Verwijderingen',
  'nav.moves': 'Verplaatsingen',
  'nav.failures': 'Mislukkingen',
  'nav.check': 'Verificatie',
  'nav.finish': 'Afronden',
  'nav.log': 'Logboek',
  'nav.tenants': 'Team',
  'nav.billing': 'Facturering',
  'nav.signOut': 'Uitloggen',
  'nav.skipToContent': 'Naar de inhoud',
  'nav.reportProblem': 'Een probleem melden',
  'language.label': 'Taal',
  'common.requestFailed': 'Het verzoek is niet voltooid.',
  'common.newTab': '(opent in een nieuw tabblad)',
  'asof.updated': 'Bijgewerkt',
  'asof.refresh': 'Vernieuwen',
  'frontDoor.experimental': 'Experimenteel',
  'frontDoor.experimental.why':
    'Gebouwd, maar moet nog meer vlieguren maken qua tests. Houd uw oude account aan en controleer wat er aankomt.',
  'frontDoor.experimental.wholeDomain.why':
    'Domeinbrede delegatie is gebouwd, maar nog niet gebruikt met een echte Workspace. Houd uw oude account aan en controleer wat er aankomt.',
  'form.requiredLegend': 'Velden met * zijn verplicht.',
  'link.unreachable': 'Deze pagina kon de server niet bereiken. Controleer uw verbinding en probeer het opnieuw.',
  'link.unreadable':
    'Er ging iets mis op deze pagina. Probeer het later opnieuw; blijft het misgaan, vraag dan de persoon die u de link stuurde om contact op te nemen met support.',
  'reload.newer':
    'Er is een nieuwere versie van deze pagina. Laad de pagina opnieuw; wat u niet had opgeslagen, gaat daarbij verloren.',
  'reload.button': 'Pagina opnieuw laden',
  'common.loading': 'Laden…',
  'common.cancel': 'Annuleren',
  'common.close': 'Sluiten',
  'common.tryAgain': 'Opnieuw proberen',
  'log.lead.why':
    'Wat een auditgebeurtenis veranderde staat hier niet: dat blijft in de database, opvraagbaar. De tekst van een fout blijft in de uitvoer van de appliance, op de regel met dezelfde referentie.',
  'alpha.note.lead': 'Welkom bij de Alpha!',
  'alpha.note.welcome':
    'Probeer Ownpace rustig uit, op uw eigen tempo en stap geleidelijk aan over op Europese alternatieven.',
  'alpha.note.guide': 'Handleiding voor de Alpha',
  // Engelse blok.
  'alpha.visitor.line': 'Ownpace is gedurende de Alpha-fase enkel op uitnodiging.',
  'alpha.nothingCharged': 'Tijdens de Alpha-fase wordt niets in rekening gebracht.',
  // 0144 §3 T6's woorden; zie het Engelse blok.
  'help.line':
    'Komt u er niet uit? Mail naar {address} en noem de pagina waarop u bent. Stuur nooit een wachtwoord of andere gevoelige gegevens mee.',
  'help.sidebar': 'Hulp: {address}',
  'role.owner': 'Eigenaar',
  'role.admin': 'Beheerder',
  'role.member': 'Lid',
  'role.viewer': 'Kijker',
  'memberStatus.active': 'Actief',
  'memberStatus.invited': 'Uitgenodigd',
  'memberStatus.declined': 'Afgewezen',
  'memberStatus.suspended': 'Geschorst',
  'memberStatus.removed': 'Verwijderd',
  'nav.decisions': 'Wacht op u',
  'nav.connections': 'Accounts',
  'nav.setup': 'Instelchecklist',
  'nav.docs': 'Handleidingen',
  'nav.help': 'Hulp',
  'nav.needsYou.count.one': '1 wacht op u',
  'nav.needsYou.count.many': '{n} wachten op u',
};

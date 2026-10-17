// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The people migrated for, their pages and their links.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  'personLink.title': 'One grant link for everything',
  'personLink.blurb':
    'One link for all of this person’s Google accounts: they sign in to each once, and every migration that reads it is connected.',
  'personLink.empty': 'No link yet for this person.',
  'personLink.asksAgain':
    'Every Google account of theirs is connected, so this link asks them to connect each one again. Send it when a connection has stopped working.',
  'personLink.view.title': 'One progress link for everything',
  'personLink.view.blurb':
    'One page where this person can follow all of their migrations and take back the access they gave.',
  'personLink.view.empty': 'No progress link yet for this person.',
  // The link's OTHER lifetime (workplan 0122). Same panel, same revoke, and
  // its own words — the credential list's ("this link is spent") would be
  // wrong about a link that grants nothing and is never spent.
  'viewLink.title': 'Progress links',
  'viewLink.blurb': 'A page where they can watch their own migration; no account needed.',
  'viewLink.why':
    'It carries counts and states only — never a folder or file name or a subject line — which is what makes a longer expiry safe. You send it yourself, and you can revoke it at any moment. A source that is not Google can have one too: it shows progress, it does not ask for credentials.',
  'viewLink.issue': 'Create progress link',
  'viewLink.issued.urlLabel': 'The progress link',
  'viewLink.empty': 'No progress links yet for this migration.',
  'viewLink.expiredNudge': 'Their page has stopped working. Create another if they still need it.',
  // A migration's page, now that a link is the person's (ADR-0035, amended
  // 2026-09-29; the owner, 2026-10-03: "yes, replace the per-migration links").
  'migrationLinks.title': 'Links',
  'migrationLinks.perPerson': 'Grant and progress links are made per person: one for all of {name}’s migrations.',
  'migrationLinks.openPerson': 'Open {name}’s page',
  'migrationLinks.whoFor': 'Who is this for?',
  'migrationLinks.whoFor.why': 'Links are made per person, so first say who this migration is for.',
  'migrationLinks.whoFor.save': 'Save',
  'migrationLinks.peopleFailed': 'Could not read who this migration is for.',
  'migrationLinks.sent.grant': 'Grant links sent before',
  'migrationLinks.sent.view': 'Progress links sent before',
  'migrationLinks.sent.blurb': 'They work until they expire. Revoke one here if it should stop sooner.',
  'migrationLinks.sent.why':
    'Links are made per person.',
  // The people being moved (ADR-0050, 0153 T3). A person on screen is their
  // name; the grouping has no noun (D6). "Needs you" is the approved family
  // (0153 T6 (b)).
  'people.count.one': '1 person',
  'people.count.many': '{n} people',
  'people.needYou.one': '1 needs you',
  'people.needYou.many': '{n} need you',
  'people.fromTo': 'From {from} to {to}',
  'people.needsYou': 'Needs you: {n}',
  'people.needsUnknown': 'Could not count what needs you.',
  'people.implicit': 'Your migrations',
  'people.addMigration': 'Add a migration',
  'people.noneYet': 'Nothing for this person yet.',
  'people.lastPass': 'Last pass {when}',
  'people.noPassYet': 'No pass yet',
  // THE SENTENCE UNDER A DATA TYPE'S STAGE (0154 T1 (b)), after its count:
  // *18,234 of ~19,000 · last pass 2 minutes ago*. *Pass* is the
  // glossary's word for a round of copying; *the check* is the verification,
  // as the menu's *Check* names it, and the two are kept apart.
  // An export's line before it starts (0153 open question 5, item 2).
  'people.line.waitsForExport': 'Waiting for the Takeout export',
  'people.line.howToExport': 'how to make one',
  'people.line.lastPass': 'last pass {when}',
  // What the count leaves out, short: its meaning is on the migration's page.
  'people.line.leftAsIs': '{count} left as they are',
  'people.line.checkPassed': 'The check passed {when}',
  // Between the two providers' tiles, for a screen reader: the arrow is
  // drawn, and the tiles' letters are hidden, so without it the line was
  // heard as *Gmail Soverin*, with no way to tell which is the source.
  'people.line.to': 'to',
  'people.loadFailed': 'Could not load who each migration is for.',
  'people.unassigned.title': 'Not with a person yet',
  'people.unassigned.hint': 'Add each to the person it is for; it joins their card.',
  'people.addTo': 'Add to',
  'people.addTo.submit': 'Add',
  'people.addTo.failed': 'The migration was not added.',
  'people.notAdded': 'The migration was made, but not added to the person.',
  'people.notAdded.where': 'Migrations lists it under Not with a person yet, press to add.',
  'people.new.title': 'Add a person',
  'people.new.name': 'Name',
  'people.new.email': 'Email address, for a grant link (optional)',
  'people.new.submit': 'Add person',
  'people.new.failed': 'The person was not added.',
  // A person's page (0153 T5): their migrations, and the steps before they
  // switch as one list (0154 T4). The steps keep the hub's names (hub.*).
  'person.back': '← Migrations',
  'person.notFound': 'There is no such person here.',
  'person.loadFailed': 'Could not load this person.',
  'person.details': 'Details',
  // An appliance migration whose file gives it no name (0153 T8), called by where it goes.
  'person.rowName': '{from} to {to}',
  // A migration that waits for their grant, and what the grant does to it
  // when it lands (start when granted, per person; the owner, 2026-10-03).
  'person.awaiting.startsByItself':
    'Waits for {name} to connect, then starts by itself: another migration of theirs has been started.',
  'person.awaiting.reviewAndStart': 'Waits for {name} to connect. Once they have, open Details to review and start it.',
  'person.awaiting.ranBefore': 'Waits for {name} to connect again.',
  'person.awaiting.unread': 'Which of these wait for {name} to connect could not be read.',
  'person.links.title': 'For {name}',
  // In place of the grant link, for a person none of whose migrations reads
  // Google: the server would only refuse one (`nothing_to_grant`).
  'person.links.noGoogle':
    "A grant link is only for Google accounts, and none of {name}'s migrations reads one. Their other accounts are connected on the Accounts page.",
  'person.steps.title': 'Before you switch',
  'person.steps.hint': 'Each step, summed across this person’s migrations.',
  'person.state.done': 'Done',
  'person.state.needsYou': 'Needs you',
  'person.state.notYet': 'Not yet',
  'person.step.none': 'None',
  'person.step.unread': 'Could not be read',
  // A migration's own link under a queue's step, when its count could not be read.
  'person.step.linkUnread': '{name} (could not be read)',
  'person.step.deletions': '{n} to decide',
  'person.step.moves': '{n} reported',
  'person.step.failures.one': '1 could not be copied',
  'person.step.failures.many': '{n} could not be copied',
  'person.step.sharing': '{n} to go through',
  'person.step.check.passed': 'Passed',
  'person.step.check.partly': 'Passed for {n} of {total}',
  'person.step.check.notYet': 'Not passed yet',
  'person.step.check.notRun': 'Not run yet',
  'person.step.check.running': 'Running now',
  'person.step.check.couldNotRun': 'Could not run {when}',
  'person.step.check.notPassedWhen': 'Did not pass {when}',
  'person.step.check.passedWhen': 'Passed {when}',
  'person.step.confirmed.notYet': 'After the check',
  'person.step.confirmed.done': 'Ready to read',
  'person.step.finish.notYet': 'Switch mail delivery, then end',
  'person.step.finish.done': 'Finished',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'personLink.title': 'Eén toegangslink voor alles',
  'personLink.blurb':
    'Eén link voor alle Google-accounts van deze persoon: bij elk account één keer aanmelden, en de migratie kan verder.',
  'personLink.empty': 'Nog geen link voor deze persoon.',
  'personLink.asksAgain':
    'Elk Google-account van deze persoon is verbonden; deze link vraagt om elk account opnieuw te verbinden. Stuur hem als een verbinding niet meer werkt.',
  'personLink.view.title': 'Eén voortgangslink voor alles',
  'personLink.view.blurb':
    'Eén pagina waarop deze persoon alle eigen migraties kan volgen en toegang kan intrekken.',
  'personLink.view.empty': 'Nog geen voortgangslink voor deze persoon.',
  'viewLink.title': 'Voortgangslinks',
  'viewLink.blurb':
    'Een pagina waarop deze persoon de eigen migratie kan volgen, zonder in te loggen.',
  'viewLink.why':
    'Hier heeft men zicht op enkel aantallen en status — nooit gevoelige of inhoudelijke informatie — daardoor is een langere geldigheid veilig. U stuurt de link zelf, en u kunt hem op elk moment intrekken. Ook een bron die geen Google is kan er een hebben: deze toont enkel voortgang.',
  'viewLink.issue': 'Voortgangslink maken',
  'viewLink.issued.urlLabel': 'De voortgangslink',
  'viewLink.empty': 'Nog geen voortgangslinks voor deze migratie.',
  'viewLink.expiredNudge': 'Hun pagina werkt niet meer. Maak een nieuwe als zij hem nog nodig hebben.',
  // De pagina van een migratie, nu een link van de persoon is (ADR-0035,
  // gewijzigd 2026-09-29; de eigenaar, 2026-10-03).
  'migrationLinks.title': 'Links',
  'migrationLinks.perPerson': 'Toegangs- en voortgangslinks worden per persoon gemaakt: één voor alle migraties van {name}.',
  'migrationLinks.openPerson': 'Pagina van {name} openen',
  'migrationLinks.whoFor': 'Voor wie is dit?',
  'migrationLinks.whoFor.why': 'Links worden per persoon gemaakt, dus kies eerst voor wie deze migratie is.',
  'migrationLinks.whoFor.save': 'Opslaan',
  'migrationLinks.peopleFailed': 'Kon niet lezen voor wie deze migratie is.',
  'migrationLinks.sent.grant': 'Eerder verstuurde toegangslinks',
  'migrationLinks.sent.view': 'Eerder verstuurde voortgangslinks',
  'migrationLinks.sent.blurb': 'Werken tot deze verlopen. Trek een link in als die eerder moet stoppen.',
  'migrationLinks.sent.why':
    'Links worden per persoon gemaakt.',
  'people.count.one': '1 persoon',
  'people.count.many': '{n} personen',
  'people.needYou.one': '1 wacht op u',
  'people.needYou.many': '{n} wachten op u',
  'people.fromTo': 'Van {from} naar {to}',
  'people.needsYou': 'Wacht op u: {n}',
  'people.needsUnknown': 'Kon niet bepalen wat op u wacht.',
  'people.implicit': 'Uw migraties',
  'people.addMigration': 'Migratie toevoegen',
  'people.noneYet': 'Nog niets voor deze persoon.',
  'people.lastPass': 'Laatste ronde {when}',
  'people.noPassYet': 'Nog geen ronde',
  'people.line.waitsForExport': 'Wacht op de Takeout-export',
  'people.line.howToExport': 'zo maakt u er een',
  'people.line.lastPass': 'laatste ronde {when}',
  'people.line.leftAsIs': '{count} ongemoeid gelaten',
  'people.line.checkPassed': 'De verificatie is {when} geslaagd',
  'people.line.to': 'naar',
  'people.loadFailed': 'Kon niet laden bij wie elke migratie hoort.',
  'people.unassigned.title': 'Nog niet bij een persoon',
  'people.unassigned.hint': 'Voeg elke migratie toe aan de persoon voor wie ze is.',
  'people.addTo': 'Toevoegen aan',
  'people.addTo.submit': 'Toevoegen',
  'people.addTo.failed': 'De migratie is niet toegevoegd.',
  'people.notAdded': 'De migratie is gemaakt, maar niet aan een persoon toegevoegd.',
  'people.notAdded.where':
    'Migraties toont deze onder Nog niet bij een persoon; voeg toe aan een persoon.',
  'people.new.title': 'Persoon toevoegen',
  'people.new.name': 'Naam',
  'people.new.email': 'E-mailadres, voor een toegangslink (optioneel)',
  'people.new.submit': 'Persoon toevoegen',
  'people.new.failed': 'De persoon is niet toegevoegd.',
  'person.back': '← Migraties',
  'person.notFound': 'Deze persoon bestaat hier niet.',
  'person.loadFailed': 'Kon deze persoon niet laden.',
  'person.details': 'Details',
  'person.rowName': '{from} naar {to}',
  'person.awaiting.startsByItself':
    'Wacht tot {name} verbindt en start dan vanzelf: een andere migratie van {name} is al gestart.',
  'person.awaiting.reviewAndStart': 'Wacht tot {name} verbindt. Open daarna Details om deze te controleren en te starten.',
  'person.awaiting.ranBefore': 'Wacht tot {name} opnieuw verbindt.',
  'person.awaiting.unread': 'Welke hiervan wachten tot {name} verbindt, kon niet worden gelezen.',
  'person.links.title': 'Voor {name}',
  'person.links.noGoogle':
    'Een toegangslink is alleen voor Google-accounts, en geen van de migraties van {name} leest er een. Andere accounts verbindt u op de pagina Accounts.',
  'person.steps.title': 'Voordat u overstapt',
  'person.steps.hint': 'Elke stap, opgeteld over de migraties van deze persoon.',
  'person.state.done': 'Klaar',
  'person.state.needsYou': 'Wacht op u',
  'person.state.notYet': 'Nog niet',
  'person.step.none': 'Geen',
  'person.step.unread': 'Kon niet worden gelezen',
  'person.step.linkUnread': '{name} (kon niet worden gelezen)',
  'person.step.deletions': '{n} om te beslissen',
  'person.step.moves': '{n} gemeld',
  'person.step.failures.one': '1 kon niet worden gemigreerd',
  'person.step.failures.many': '{n} konden niet worden gemigreerd',
  'person.step.sharing': '{n} om door te lopen',
  'person.step.check.passed': 'Geslaagd',
  'person.step.check.partly': 'Geslaagd voor {n} van {total}',
  'person.step.check.notYet': 'Nog niet geslaagd',
  'person.step.check.notRun': 'Nog niet uitgevoerd',
  'person.step.check.running': 'Nu bezig',
  'person.step.check.couldNotRun': 'Kon {when} niet worden uitgevoerd',
  'person.step.check.notPassedWhen': 'Niet geslaagd {when}',
  'person.step.check.passedWhen': 'Geslaagd {when}',
  'person.step.confirmed.notYet': 'Na de verificatie',
  'person.step.confirmed.done': 'Klaar om te lezen',
  'person.step.finish.notYet': 'Zet de e-mailbezorging om, en rond dan af',
  'person.step.finish.done': 'Afgerond',
};

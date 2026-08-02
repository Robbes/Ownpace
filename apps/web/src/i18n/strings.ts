/**
 * The bilingual dictionary (workplan 0024 T1, ADR-0013).
 *
 * Hand-rolled on purpose: two locales and compile-time key parity do not need
 * an i18n framework (see the workplan's decision notes). `en` defines the key
 * set; `nl` is TYPED against it, so a missing or extra Dutch key is a
 * typecheck failure, not a runtime English leak.
 *
 * Server prose is NOT here: refusals render verbatim (rule 2/ADR-0024), and
 * shared operator prose lives in @openmig/shared next to its English source
 * (e.g. APPLY_FLAG_WARNING / APPLY_FLAG_WARNING_NL) so editions and languages
 * cannot drift apart separately.
 */

const en = {
  'nav.dashboard': 'Dashboard',
  'nav.mappings': 'Mappings',
  'nav.review': 'Review',
  'nav.deletions': 'Deletions',
  'nav.moves': 'Moves',
  'nav.failures': 'Failures',
  'nav.check': 'Check',
  'nav.finish': 'Finish',
  'nav.tenants': 'Tenants',
  'nav.billing': 'Billing',
  'nav.operator': 'Operator',
  'nav.settings': 'Settings',
  'nav.signOut': 'Sign out',
  'language.label': 'Language',
  'domain.email': 'Email',
  'domain.calendar': 'Calendar',
  'domain.contact': 'Contacts',
  'domain.file': 'Files',
  'evidence.reported.title': 'The source itself told us the object was gone.',
  'evidence.trashed.title':
    "We found it in the owner's Deleted Items — the old system's own record that they deleted it.",
  'evidence.inferred.title':
    'It stopped appearing in consecutive complete scans. A suspicion, not a fact — this can never be applied.',
  'guidance.summary': 'What this means and what you can do',
  'receipt.queued': 'Removal queued — the job re-checks every gate before touching anything.',
  'receipt.applied.binned':
    "Removed — moved to the target's own bin; a copy may still be recoverable there.",
  'receipt.applied.deleted': 'Removed — gone, with no recovery path from here.',
  'receipt.applied.unknown': 'Removed. How final the removal was is not recorded on the receipt.',
  'receipt.failedPrefix': 'The removal job failed:',
  'lifecycle.paused':
    'This migration has not started, so nothing has been copied and nothing can have diverged.',
  'hub.fallbackTitle': 'Migration',
  'hub.noId': 'No mapping id in the address.',
  'hub.detailError': "Could not read this migration's details — the screens below still work.",
  'hub.deletions.name': 'Deletions',
  'hub.deletions.blurb':
    'Items deleted on the old system that the new one still has. Your call, per item.',
  'hub.moves.name': 'Moves',
  'hub.moves.blurb':
    'Items the old system reorganised since they were copied. Reported, never acted on.',
  'hub.failures.name': 'Failures',
  'hub.failures.blurb':
    'Items that could not be copied and now wait on a person. These block finishing.',
  'hub.check.name': 'Check',
  'hub.check.blurb':
    'Compare the two systems and sample the contents — the §20 gate, behind a button.',
  'hub.finish.name': 'Finish',
  'hub.finish.blurb':
    'The cutover checklist. Ends the migration — in order, with the one attested step.',
  'queue.waitingOnYou': 'Waiting on you',
  'queue.alreadyDecided': 'Already decided',
  'moves.title': 'Moved on the old system',
  'moves.intro':
    'Items the owner has filed somewhere else where they came from. The new system still has them where we put them, and nothing has been changed on either side.',
  'moves.empty.open': 'Nothing has moved.',
  'moves.empty.acknowledged': 'Nothing has been decided yet.',
  'moves.keep': 'Leave it where it is',
  'failures.title': 'Could not be copied',
  'failures.intro':
    'Items that did not make it across, what went wrong, and how many times we tried.',
  'failures.empty.needsDecision': 'Nothing is waiting on a decision.',
  'failures.stillTrying': 'Still trying',
  'failures.empty.retrying': 'Nothing is being retried.',
  'failures.retry': 'Try again',
  'failures.accept': 'Migrate without it',
  'failures.try.one': 'try',
  'failures.try.many': 'tries',
} as const;

const nl: Record<keyof typeof en, string> = {
  'nav.dashboard': 'Overzicht',
  'nav.mappings': 'Koppelingen',
  'nav.review': 'Controleren',
  'nav.deletions': 'Verwijderingen',
  'nav.moves': 'Verplaatsingen',
  'nav.failures': 'Mislukkingen',
  'nav.check': 'Verificatie',
  'nav.finish': 'Afronden',
  'nav.tenants': 'Organisaties',
  'nav.billing': 'Facturering',
  'nav.operator': 'Beheerder',
  'nav.settings': 'Instellingen',
  'nav.signOut': 'Uitloggen',
  'language.label': 'Taal',
  'domain.email': 'E-mail',
  'domain.calendar': 'Agenda',
  'domain.contact': 'Contacten',
  'domain.file': 'Bestanden',
  'evidence.reported.title': 'Het bronsysteem heeft zelf gemeld dat het object weg is.',
  'evidence.trashed.title':
    'We vonden het in de map Verwijderde items van de eigenaar — het eigen bewijs van het oude systeem dat het is verwijderd.',
  'evidence.inferred.title':
    'Het verscheen niet meer in opeenvolgende volledige scans. Een vermoeden, geen feit — dit kan nooit worden toegepast.',
  'guidance.summary': 'Wat dit betekent en wat u kunt doen',
  'receipt.queued':
    'Verwijdering in de wachtrij — de taak controleert elke poort opnieuw voordat er iets wordt aangeraakt.',
  'receipt.applied.binned':
    'Verwijderd — verplaatst naar de prullenbak van het doelsysteem; daar is mogelijk nog een kopie terug te halen.',
  'receipt.applied.deleted': 'Verwijderd — weg, zonder herstelmogelijkheid vanaf hier.',
  'receipt.applied.unknown':
    'Verwijderd. Hoe definitief de verwijdering was, staat niet op het ontvangstbewijs.',
  'receipt.failedPrefix': 'De verwijdertaak is mislukt:',
  'lifecycle.paused':
    'Deze migratie is nog niet gestart, dus er is niets gekopieerd en er kan niets zijn afgeweken.',
  'hub.fallbackTitle': 'Migratie',
  'hub.noId': 'Geen koppelings-id in het adres.',
  'hub.detailError':
    'De details van deze migratie konden niet worden gelezen — de schermen hieronder werken nog.',
  'hub.deletions.name': 'Verwijderingen',
  'hub.deletions.blurb':
    'Items die op het oude systeem zijn verwijderd maar op het nieuwe nog bestaan. Uw beslissing, per item.',
  'hub.moves.name': 'Verplaatsingen',
  'hub.moves.blurb':
    'Items die het oude systeem heeft herschikt sinds ze zijn gekopieerd. Gemeld, nooit uitgevoerd.',
  'hub.failures.name': 'Mislukkingen',
  'hub.failures.blurb':
    'Items die niet konden worden gekopieerd en nu op een persoon wachten. Deze blokkeren het afronden.',
  'hub.check.name': 'Verificatie',
  'hub.check.blurb':
    'Vergelijk de twee systemen en controleer steekproeven van de inhoud — de §20-poort, achter één knop.',
  'hub.finish.name': 'Afronden',
  'hub.finish.blurb':
    'De cutover-checklist. Beëindigt de migratie — in volgorde, met de ene bevestigde stap.',
  'queue.waitingOnYou': 'Wacht op u',
  'queue.alreadyDecided': 'Al besloten',
  'moves.title': 'Verplaatst op het oude systeem',
  'moves.intro':
    'Items die de eigenaar ergens anders heeft ondergebracht dan waar ze vandaan kwamen. Het nieuwe systeem heeft ze nog waar wij ze plaatsten; aan geen van beide kanten is iets veranderd.',
  'moves.empty.open': 'Er is niets verplaatst.',
  'moves.empty.acknowledged': 'Er is nog niets besloten.',
  'moves.keep': 'Laat het waar het staat',
  'failures.title': 'Kon niet worden gekopieerd',
  'failures.intro':
    'Items die niet zijn overgekomen, wat er misging, en hoe vaak we het hebben geprobeerd.',
  'failures.empty.needsDecision': 'Er wacht niets op een beslissing.',
  'failures.stillTrying': 'Wordt nog geprobeerd',
  'failures.empty.retrying': 'Er wordt niets opnieuw geprobeerd.',
  'failures.retry': 'Probeer opnieuw',
  'failures.accept': 'Migreer zonder dit item',
  'failures.try.one': 'poging',
  'failures.try.many': 'pogingen',
};

export type Locale = 'en' | 'nl';
export type StringKey = keyof typeof en;

export const STRINGS: Record<Locale, Record<StringKey, string>> = { en, nl };

export const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

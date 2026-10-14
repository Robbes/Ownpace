// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * What a migration did, confirmed item by item.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  'confirmed.toReport': 'What happened: the report',
  'receipt.queued': 'Removal requested. We check again that it is safe before anything is removed.',
  'receipt.applied.binned':
    "Removed — moved to the target's own bin; a copy may still be recoverable there.",
  'receipt.applied.deleted': 'Removed — gone, with no recovery path from here.',
  'receipt.applied.unknown': 'Removed. How final the removal was is not recorded on the receipt.',
  'receipt.failedPrefix': 'The removal failed:',
  // The confirmed list (workplan 0117 T2, D10) — the page somebody deletes
  // their originals on the strength of. The state words are deliberately not
  // a scale: see `confirmed-list.ts`, which argues they are different
  // questions, and a list that renders any two of them alike is a list
  // somebody empties the wrong folder on.
  'confirmed.title': 'What can your destination confirm?',
  'confirmed.intro':
    'Re-reads each item on the destination and says what the check actually compared.',
  'confirmed.check': 'Check the destination',
  'confirmed.export': 'Download the full list',
  'confirmed.durationHint':
    'Reads the destination item by item — on a large account this takes minutes.',
  'confirmed.applianceScope': 'On this appliance a check covers every configured migration.',
  'confirmed.joined': 'A check was already running; this joined it.',
  'confirmed.loading': 'Reading the list…',
  'confirmed.couldNotRead': 'The list could not be read.',
  'confirmed.neverRun': 'No check has run yet, so nothing is confirmed.',
  'confirmed.running': 'Checking since',
  'confirmed.checkedAt': 'Checked',
  'confirmed.passFailed': 'The check stopped at',
  'confirmed.passStopped.closed': 'This organisation was closed, so the check stopped at',
  'confirmed.paused': 'Only part of the account was checked:',
  'confirmed.nothingYet': 'This migration has no items yet.',
  'confirmed.allVerified': 'Every item was re-read and matched. Nothing needs your attention.',
  'confirmed.headline.of': 'of',
  // WHAT THE NUMBER COUNTS, not where the items are (owner, 2026-09-17). It
  // read "items are in your new home, verified by hash" — two claims in one
  // sentence, and the first was wrong whenever the second was: six thousand of
  // the owner's items WERE in his new home, as copies he already had, and the
  // page led with a nought. The headline is the hash claim now, and
  // `confirmed.breakdown` below says where everything else stands.
  'confirmed.headline.rest': 'items in your new home are verified by hash.',
  'confirmed.breakdown': 'The rest of the account:',
  // CHECKED, not verified: the pass has walked this many items, of which the
  // headline above claims only the ones the target confirmed. Two numbers
  // that differ on purpose, and a reader who is told which is which.
  'confirmed.checked.of': 'of',
  'confirmed.checked.rest': 'checked so far',
  'confirmed.truncated.a': 'Showing the first',
  'confirmed.truncated.b': 'rows. The download has every one of them.',
  'confirmed.noKey': 'name not recorded',
  'confirmed.noKey.hover': 'Not recorded yet; a later pass fills this in.',
  'confirmed.col.domain': 'Type',
  'confirmed.col.collection': 'Where',
  'confirmed.col.item': 'Item',
  'confirmed.col.state': 'Result',
  'confirmed.col.claim': 'Compared',
  'confirmed.col.when': 'Checked',
  'confirmed.state.verified': 'Verified',
  'confirmed.state.differs': 'Differs',
  'confirmed.state.present': 'Present',
  'confirmed.state.yours': 'Yours already',
  'confirmed.state.missing': 'Missing',
  'confirmed.state.neverPlaced': 'Never placed',
  'confirmed.state.removed': 'Removed',
  'confirmed.state.unchecked': 'Not checked',
  'confirmed.help.verified': 'Re-read from the destination and it matched what we wrote.',
  'confirmed.help.differs':
    'Re-read from the destination and it did not match. Worth looking at.',
  'confirmed.help.present':
    'It is there, but nothing comparable could be computed. Not a failure.',
  'confirmed.help.yours': 'Your own copy was already there, so we never wrote these bytes.',
  'confirmed.help.missing':
    'We placed it and the re-read cannot find it. Keep your original.',
  'confirmed.help.neverPlaced':
    'It was never copied — skipped, failed, or left behind by choice.',
  'confirmed.help.removed':
    'We removed our own copy, on a decision recorded at the time.',
  'confirmed.help.unchecked':
    'The destination could not be asked. Nothing is known either way.',
  'confirmed.claim.byteHash': 'by hash',
  'confirmed.claim.fingerprint': 'by fingerprint',
  'confirmed.claim.containerParts': "by the document's parts",
  'confirmed.claim.none': 'not compared',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'confirmed.toReport': 'Wat er is gebeurd: het rapport',
  'receipt.queued':
    'Verwijderen aangevraagd. We controleren nog een keer of het veilig is voordat er iets wordt verwijderd.',
  'receipt.applied.binned':
    'Verwijderd; nu in de prullenbak van het doel, mogelijk daar nog terug te halen.',
  'receipt.applied.deleted': 'Verwijderd — weg, zonder herstelmogelijkheid vanaf hier.',
  'receipt.applied.unknown':
    'Verwijderd. Hoe definitief de verwijdering was, is (hier) onbekend.',
  'receipt.failedPrefix': 'Het verwijderen is mislukt:',
  // Zie de Engelse blok-opmerking: de toestandswoorden zijn geen schaal.
  'confirmed.title': 'Wat kan uw bestemming bevestigen?',
  'confirmed.intro':
    'Leest elk item terug op de bestemming en zegt wat er precies is vergeleken.',
  'confirmed.check': 'Controleer de bestemming',
  'confirmed.export': 'Download de volledige lijst',
  'confirmed.durationHint':
    'Leest de bestemming item voor item — bij een groot account duurt dit minuten.',
  'confirmed.applianceScope':
    'Op deze appliance omvat een controle elke geconfigureerde migratie.',
  'confirmed.joined': 'Er liep al een controle; deze is daarin opgenomen.',
  'confirmed.loading': 'Bezig met lezen…',
  'confirmed.couldNotRead': 'De lijst kon niet worden gelezen.',
  'confirmed.neverRun': 'Er is nog geen controle uitgevoerd, dus niets is bevestigd.',
  'confirmed.running': 'Bezig sinds',
  'confirmed.checkedAt': 'Gecontroleerd',
  'confirmed.passFailed': 'De controle stopte om',
  'confirmed.passStopped.closed': 'Deze organisatie is gesloten, dus de controle stopte om',
  'confirmed.paused': 'Slechts een deel van het account is gecontroleerd:',
  'confirmed.nothingYet': 'Deze migratie heeft nog geen items.',
  'confirmed.allVerified': 'Elk item is teruggelezen en kwam overeen. Niets vraagt uw aandacht.',
  'confirmed.headline.of': 'van de',
  'confirmed.headline.rest': 'items in uw bestemming zijn met een hash geverifieerd.',
  'confirmed.breakdown': 'De rest van het overzicht:',
  'confirmed.checked.of': 'van de',
  'confirmed.checked.rest': 'tot nu toe gecontroleerd',
  'confirmed.truncated.a': 'De eerste',
  'confirmed.truncated.b': 'rijen worden getoond. De download bevat ze allemaal.',
  'confirmed.noKey': 'naam niet vastgelegd',
  'confirmed.noKey.hover': 'Nog niet vastgelegd; een volgende ronde vult dit aan.',
  'confirmed.col.domain': 'Type',
  'confirmed.col.collection': 'Waar',
  'confirmed.col.item': 'Item',
  'confirmed.col.state': 'Resultaat',
  'confirmed.col.claim': 'Vergeleken',
  'confirmed.col.when': 'Gecontroleerd',
  'confirmed.state.verified': 'Geverifieerd',
  'confirmed.state.differs': 'Wijkt af',
  'confirmed.state.present': 'Aanwezig',
  'confirmed.state.yours': 'Al van u',
  'confirmed.state.missing': 'Ontbreekt',
  'confirmed.state.neverPlaced': 'Nooit geplaatst',
  'confirmed.state.removed': 'Verwijderd',
  'confirmed.state.unchecked': 'Niet gecontroleerd',
  'confirmed.help.verified':
    'Teruggelezen van de bestemming en kwam overeen met wat wij al opgeslagen hadden.',
  'confirmed.help.differs':
    'Teruggelezen van de bestemming en kwam niet overeen. Bekijk dit.',
  'confirmed.help.present':
    'Aangetroffen, maar er viel niets vergelijkbaars te berekenen. Geen fout.',
  'confirmed.help.yours': 'Uw eigen kopie was aangetroffen, niet door Ownpace via deze migratie geplaatst.',
  'confirmed.help.missing':
    'Wat wij gemigreerd hadden, blijkt bij teruglezen niet aangetroffen te zijn / is weg. Bewaar uw origineel!',
  'confirmed.help.neverPlaced':
    'Het is nooit gemigreerd — overgeslagen, mislukt, of bewust achtergelaten.',
  'confirmed.help.removed':
    'Wij verwijderden onze eigen kopie, op een destijds vastgelegd besluit.',
  'confirmed.help.unchecked':
    'De bestemming kon niet worden bevraagd. Er is niets over bekend.',
  'confirmed.claim.byteHash': 'via hash',
  'confirmed.claim.fingerprint': 'via digitale vingerafdruk',
  'confirmed.claim.containerParts': 'via stukjes van het document',
  'confirmed.claim.none': 'niet vergeleken',
};

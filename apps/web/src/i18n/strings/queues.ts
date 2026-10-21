// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The queues a person works through: deletions, moves and failures.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  'queue.itemId': 'ID',
  'queue.loadFailed': 'Could not load this list.',
  'queue.noMappings': 'No migrations configured.',
  'failures.withheld':
    "Item names and the provider's messages are not shown: the person connected this account themselves, and they can name their files. Each failure still says what kind it is and what to do.",
  'queue.waitingOnYou': 'Waiting on you',
  'queue.alreadyDecided': 'Already decided',
  // A data type past its cutover offers no remove button (2026-10-05; the
  // owner's "Refuse after cutover (Recommended)"): the server refuses it, and
  // this says why once, above the rows, naming the data types whose rows lost
  // it. Undoing the cutover is a rollback (ADR-0047).
  'queue.afterCutover':
    'Past the cutover of {dataTypes}, the old system no longer decides what exists, so nothing is removed from the new system because of what happened there. Those rows have no remove button. Undoing the cutover brings it back.',
  'moves.title': 'Moved on the old system',
  // Not "the owner": on the managed app the owner is a Team role, held by
  // whoever is signed in, and these were moved on the old system. "filed
  // elsewhere" is the comparator 0035 T5 restored (i18n.unit.test.tsx).
  'moves.intro': 'These were filed elsewhere after we copied them. We changed nothing on either side.',
  'moves.intro.more': 'The new system still has them where we put them; each row is your call.',
  'moves.empty.open': 'Nothing has moved.',
  'moves.empty.acknowledged': 'Nothing has been decided yet.',
  'moves.keep': 'Leave it where it is',
  'moves.apply': 'Remove the old copy',
  'moves.applyArmed': 'Confirm removal',
  'moves.renamedTo': 'renamed',
  // What a row under *Already decided* says was decided (0159 §6 item 6),
  // from the server's `decided`: the ledger closes a move the same way for
  // both buttons, so the heading cannot say which and stays *Already decided*.
  'moves.decided.kept': 'Left where it is on the new system',
  'moves.decided.applied': 'Old copy removed on the new system',
  'failures.title': 'Could not be copied',
  // The frame for the provider's own message, which stays word for word.
  'failures.technical': 'Technical message:',
  'failures.intro': 'Items that did not make it across, what went wrong, and how often we tried.',
  'failures.empty.needsDecision': 'Nothing is waiting on a decision.',
  'failures.acceptedLeave':
    'When you choose Migrate without it, the item leaves this list. The migration goes on without it, and it no longer counts as failed.',
  'failures.seeRuns': "See every pass under Run history, on the migration's page",
  'failures.stillTrying': 'Still trying',
  'failures.empty.retrying': 'Nothing is being retried.',
  'failures.retry': 'Try again',
  'failures.retryCost':
    'Retrying re-lists everything to reach this item again, so the next pass takes longer.',
  'failures.retryCost.why':
    'To reach this item, the next pass looks through everything on the old system again; nothing already copied is copied twice.',
  'failures.accept': 'Migrate without it',
  'failures.acceptAll': 'Migrate without all of these ({count})',
  'failures.group.title': 'Decide a whole group at once',
  'failures.group.hint': 'These wait for your decision, even after we fix the cause.',
  'failures.group.hint.why':
    'We count the attempts on each item, and a fix on our side does not reset that count, so the items stay here while the migration says it is complete. Pick a kind, or type part of the error the items share, to decide on all of them at once. Trying them again makes the next pass look through everything once more, which is how it reaches them. What you type is matched exactly as you type it.',
  // THE GROUPS, READ OFF THE ROWS (the owner, 2026-09-17: *"why now detail
  // groups that share sumilarities and offer those to pick from to do bulk
  // actions?"*). Typing a substring describes a group somebody has already
  // worked out; these are the ones the queue announces about itself.
  'failures.group.found': 'Groups in this list',
  'failures.group.items.one': '1 item',
  'failures.group.items.many': '{count} items',
  'failures.group.stillTrying.one': '1 still trying',
  'failures.group.stillTrying.many': '{count} still trying',
  'failures.group.noCategory': 'No kind of failure recorded',
  'failures.group.noCategory.why':
    'These items failed before Ownpace supported this type of failure. The next attempt on them records it, and makes them join a group. Until then they can be decided one at a time, or by the error text below.',
  'failures.group.manual': 'Match on the error text instead',
  'failures.group.domain': 'Kind',
  'failures.group.domain.any': 'Any kind',
  'failures.group.error': 'Error contains',
  'failures.group.error.placeholder': 'a word from the error',
  'failures.group.matches': 'Matches {count} of the {total} here.',
  'failures.group.needsNarrowing': 'Pick a kind, or type part of the error, first.',
  'failures.group.retry': 'Try all of these again',
  'failures.group.accept': 'Migrate without all of these',
  'failures.try.one': 'try',
  'failures.try.many': 'tries',
  // A parked item was tried ONCE and then set aside for a person, so printing
  // its attempt count as a try total claims attempts that never happened —
  // which is what an owner read on 2026-09-14 as "5 tries" against their
  // Google account for a setting they had chosen. Said instead of the count,
  // never beside it: two numbers where one is meaningless is worse.
  'failures.parked': 'waiting on you',
  'deletions.title': 'Deleted on the old system',
  'deletions.intro': 'Someone deleted these after we copied them. The new system still has its copy.',
  // What the chips say (`evidence.*`), said where a phone can read it, above
  // the rows (the UX sweep, 2026-10-17). Each line only above a list with a
  // row it is about. The chips said the server's tokens until the owner chose
  // these words (2026-10-18); the token stays in the chip's title.
  'deletions.evidence.lead':
    "Reported by the source: the old system said it was deleted. In the source's bin: it is in the old system's bin.",
  'deletions.evidence.lead.inferred':
    'Assumed: it is missing from full scans, but the old system never said it was deleted. Ownpace does not delete it on the new system.',
  'deletions.watching.lead':
    'These are missing from the old system, but it never said they were deleted. Ownpace does not delete them on the new system.',
  'deletions.empty.confirmed': 'Nothing is waiting on a decision.',
  'deletions.watching': 'Watching',
  'deletions.empty.watching': 'Nothing is being watched.',
  'deletions.empty.acknowledged': 'Nothing has been decided yet.',
  'deletions.keep': 'Keep our copy',
  'deletions.apply': 'Delete it here too',
  'deletions.applyArmed': 'Confirm delete',
  // What a row under *Already decided* says was decided (0159 §6 item 6), as
  // the moves' pair above. *Moved* is a renamed item's old copy, removed from
  // the new system: never *deleted*, as the item is still there.
  'deletions.decided.kept': 'Kept on the new system',
  'deletions.decided.applied': 'Deleted on the new system too',
  'deletions.decided.relocated': 'Moved: the old copy was removed on the new system',
  // Copies an earlier export policy left (workplan 0042 T8 (b), second half):
  // on this screen, and never called a deletion.
  'deletions.earlierExports': 'Earlier exports',
  'deletions.earlierExports.intro':
    'Copies an earlier export format left behind. The documents were not deleted in Google.',
  'deletions.earlierExport.badge': 'earlier export',
  'deletions.earlierExport.badgeTitle': 'Exported again under its new name; this is the old copy.',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'queue.itemId': 'ID',
  'queue.loadFailed': 'Deze lijst kon niet worden geladen.',
  'queue.noMappings': 'Geen migraties geconfigureerd.',
  'failures.withheld':
    'Namen van items en de meldingen van de aanbieder worden niet getoond: de persoon heeft dit account zelf gekoppeld, en deze kunnen hun bestanden vermelden. Elke fout zegt nog steeds welke fout het is en wat u zelf kunt doen.',
  'queue.waitingOnYou': 'Wacht op u',
  'queue.alreadyDecided': 'Al besloten',
  'queue.afterCutover':
    'Na de overstap van {dataTypes} bepaalt het oude systeem niet meer wat er bestaat, dus wordt er op het nieuwe systeem niets verwijderd vanwege wat daar is gebeurd. Die regels hebben geen verwijderknop. Wordt de overstap teruggedraaid, dan komt die terug.',
  'moves.title': 'Verplaatst op het oude systeem',
  'moves.intro':
    'Iemand verplaatste deze nadat wij ze migreerden. Wij veranderden aan geen van beide kanten iets.',
  'moves.intro.more':
    'Het nieuwe systeem heeft deze nog, waar wij ze hadden geplaatst; beslis over elke regel.',
  'moves.empty.open': 'Er is niets verplaatst.',
  'moves.empty.acknowledged': 'Er is nog niets besloten.',
  'moves.keep': 'Laat staan',
  'moves.apply': 'Verwijder de oude kopie',
  'moves.applyArmed': 'Bevestig verwijdering',
  'moves.renamedTo': 'hernoemd',
  'moves.decided.kept': 'Blijft staan op het nieuwe systeem',
  'moves.decided.applied': 'Oude kopie verwijderd op het nieuwe systeem',
  'failures.title': 'Kon niet worden gemigreerd',
  'failures.technical': 'Technische melding:',
  'failures.intro':
    'Items die niet zijn overgekomen, wat er misging, en hoe vaak is geprobeerd.',
  'failures.empty.needsDecision': 'Er wacht niets op een beslissing.',
  'failures.acceptedLeave':
    'Kiest u Migreer zonder dit item, dan verdwijnt het uit deze lijst. De migratie gaat zonder het item verder, en het telt niet meer als mislukt.',
  'failures.seeRuns': 'Bekijk elke ronde onder Uitvoeringsgeschiedenis, op de pagina van de migratie',
  'failures.stillTrying': 'Wordt nog geprobeerd',
  'failures.empty.retrying': 'Er wordt niets opnieuw geprobeerd.',
  'failures.retry': 'Probeer opnieuw',
  'failures.retryCost':
    'Opnieuw proberen doorloopt alles opnieuw tot dit item, dus de volgende ronde duurt langer.',
  'failures.retryCost.why':
    'Om dit item te bereiken, doorloopt de volgende ronde alles op het oude systeem opnieuw; wat al gemigreerd is, wordt niet nog eens gemigreerd.',
  'failures.accept': 'Migreer zonder dit item',
  'failures.acceptAll': 'Migreer zonder deze items ({count})',
  'failures.group.title': 'Beslis over een hele groep',
  'failures.group.hint': 'Deze wachten op uw beslissing, ook als wij de oorzaak hebben verholpen.',
  'failures.group.hint.why':
    'We tellen de pogingen per item, en een oplossing aan onze kant zet die telling niet terug. Daarom blijven de items hier staan, terwijl de migratie zich voltooid noemt. Kies een soort, of typ een deel van de fout die de items delen, om in één keer over allemaal te beslissen. Opnieuw proberen laat de volgende ronde nog één keer alles doorlopen; zo bereikt die de items weer. Wat u typt, wordt precies zo vergeleken als u het typt.',
  'failures.group.found': 'Groepen in deze lijst',
  'failures.group.items.one': '1 item',
  'failures.group.items.many': '{count} items',
  'failures.group.stillTrying.one': '1 wordt nog geprobeerd',
  'failures.group.stillTrying.many': '{count} worden nog geprobeerd',
  'failures.group.noCategory': 'Geen soort fout vastgelegd',
  'failures.group.noCategory.why':
    'Deze items mislukten voordat Ownpace dit als type fout kon herkennen. De volgende poging kan wat fout ging anders interpreteren en behandelen, zodat ze bij een groep gaan behoren. Tot dan kunt u ze \u00E9\u00E9n voor \u00E9\u00E9n beslissen, of via de fouttekst hieronder.',
  'failures.group.manual': 'Zoek in plaats daarvan op de fouttekst',
  'failures.group.domain': 'Soort',
  'failures.group.domain.any': 'Elke soort',
  'failures.group.error': 'Fout bevat',
  'failures.group.error.placeholder': 'een woord uit de foutmelding',
  'failures.group.matches': 'Past op {count} van de {total} hier.',
  'failures.group.needsNarrowing': 'Kies eerst een soort, of typ een deel van de fout.',
  'failures.group.retry': 'Probeer deze allemaal opnieuw',
  'failures.group.accept': 'Migreer zonder al deze items',
  'failures.try.one': 'poging',
  'failures.try.many': 'pogingen',
  'failures.parked': 'wacht op u',
  'deletions.title': 'Verwijderd op het oude systeem',
  'deletions.intro':
    'Iemand verwijderde deze nadat wij ze migreerden. Het nieuwe systeem heeft de kopie nog.',
  'deletions.evidence.lead':
    'Gemeld door de bron: het oude systeem meldde dat het verwijderd is. In de prullenbak van de bron: het staat in de prullenbak van het oude systeem.',
  'deletions.evidence.lead.inferred':
    'Vermoeden: het ontbreekt in volledige scans, maar het oude systeem heeft niet gemeld dat het verwijderd is. Ownpace verwijdert het niet op het nieuwe systeem.',
  'deletions.watching.lead':
    'Deze ontbreken op het oude systeem, maar dat heeft niet gemeld dat ze verwijderd zijn. Ownpace verwijdert ze niet op het nieuwe systeem.',
  'deletions.empty.confirmed': 'Er wacht niets op een beslissing.',
  'deletions.watching': 'Wordt in de gaten gehouden',
  'deletions.empty.watching': 'Er wordt niets in de gaten gehouden.',
  'deletions.empty.acknowledged': 'Er is nog niets besloten.',
  'deletions.keep': 'Behoud de kopie',
  'deletions.apply': 'Verwijder het hier ook',
  'deletions.applyArmed': 'Bevestig verwijderen',
  'deletions.decided.kept': 'Behouden op het nieuwe systeem',
  'deletions.decided.applied': 'Ook verwijderd op het nieuwe systeem',
  'deletions.decided.relocated': 'Verplaatst: de oude kopie is verwijderd op het nieuwe systeem',
  'deletions.earlierExports': 'Eerdere exports',
  'deletions.earlierExports.intro':
    'Kopieën die een eerder exportformaat achterliet. De documenten zijn niet verwijderd in Google.',
  'deletions.earlierExport.badge': 'eerdere export',
  'deletions.earlierExport.badgeTitle': 'Opnieuw geëxporteerd onder de nieuwe naam; dit is de oude kopie.',
};

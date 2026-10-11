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
  'queue.loadFailed': 'Could not load this queue.',
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
  'moves.intro':
    'Items the owner filed elsewhere since the migration; nothing has changed on either side.',
  'moves.intro.more': 'The new system still has them where we put them; each row is your call.',
  'moves.empty.open': 'Nothing has moved.',
  'moves.empty.acknowledged': 'Nothing has been decided yet.',
  'moves.keep': 'Leave it where it is',
  'moves.apply': 'Remove the old copy',
  'moves.applyArmed': 'Confirm removal',
  'moves.renamedTo': 'renamed',
  'failures.title': 'Could not be copied',
  'failures.intro': 'Items that did not make it across, what went wrong, and how often we tried.',
  'failures.empty.needsDecision': 'Nothing is waiting on a decision.',
  'failures.acceptedLeave':
    'Accepted items no longer appear here; migration continues without them, no longer counted as failed.',
  'failures.seeRuns': 'See the pass that failed (run history)',
  'failures.stillTrying': 'Still trying',
  'failures.empty.retrying': 'Nothing is being retried.',
  'failures.retry': 'Try again',
  'failures.retryCost':
    'Retrying re-lists everything to reach this item again, so the next pass takes longer.',
  'failures.retryCost.why':
    'It clears this migration’s sync cursors, so the whole source is listed again; nothing already copied is copied twice.',
  'failures.accept': 'Migrate without it',
  'failures.acceptAll': 'Migrate without all of these ({count})',
  'failures.group.title': 'Decide a whole group at once',
  'failures.group.hint': 'A connector fixed since these parked will not unpark them by itself.',
  'failures.group.hint.why':
    'Being parked is a stored count of attempts, so deploying a fix does not lower it — the items sit there while the migration reports itself complete. Pick a kind, or type part of the error the items share, and this allows you to decide on all of them in one go: a retry also clears this migration’s sync cursors once, which is what puts the items back in front of the next pass. The wording is matched literally, so a % or an _ in what you type means a % or an _.',
  // THE GROUPS, READ OFF THE ROWS (the owner, 2026-09-17: *"why now detail
  // groups that share sumilarities and offer those to pick from to do bulk
  // actions?"*). Typing a substring describes a group somebody has already
  // worked out; these are the ones the queue announces about itself.
  'failures.group.found': 'Groups in this queue',
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
  'failures.group.error.placeholder': 'MKCOL',
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
  'deletions.intro':
    'Items the owner deleted at the source; the new system still has them, untouched.',
  'deletions.empty.confirmed': 'Nothing is waiting on a decision.',
  'deletions.watching': 'Watching',
  'deletions.empty.watching': 'Nothing is being watched.',
  'deletions.empty.acknowledged': 'Nothing has been decided yet.',
  'deletions.keep': 'Keep our copy',
  'deletions.apply': 'Delete it here too',
  'deletions.applyArmed': 'Confirm delete',
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
  'queue.loadFailed': 'Deze wachtrij kon niet worden geladen.',
  'queue.noMappings': 'Geen migraties geconfigureerd.',
  'failures.withheld':
    'Namen van items en de meldingen van de aanbieder worden niet getoond: de persoon heeft dit account zelf gekoppeld, en deze kunnen hun bestanden vermelden. Elke fout zegt nog steeds welke fout het is en wat u zelf kunt doen.',
  'queue.waitingOnYou': 'Wacht op u',
  'queue.alreadyDecided': 'Al besloten',
  'queue.afterCutover':
    'Na de overstap van {dataTypes} bepaalt het oude systeem niet meer wat er bestaat, dus wordt er op het nieuwe systeem niets verwijderd vanwege wat daar is gebeurd. Die regels hebben geen verwijderknop. Wordt de overstap teruggedraaid, dan komt die terug.',
  'moves.title': 'Verplaatst op het oude systeem',
  'moves.intro':
    'Items die de eigenaar had verplaatst; aan geen van beide kanten is iets veranderd.',
  'moves.intro.more':
    'Het nieuwe systeem heeft deze nog, waar wij ze hadden geplaatst; beslis over elke regel.',
  'moves.empty.open': 'Er is niets verplaatst.',
  'moves.empty.acknowledged': 'Er is nog niets besloten.',
  'moves.keep': 'Laat staan',
  'moves.apply': 'Verwijder de oude kopie',
  'moves.applyArmed': 'Bevestig verwijdering',
  'moves.renamedTo': 'hernoemd',
  'failures.title': 'Kon niet worden gemigreerd',
  'failures.intro':
    'Items die niet zijn overgekomen, wat er misging, en hoe vaak is geprobeerd.',
  'failures.empty.needsDecision': 'Er wacht niets op een beslissing.',
  'failures.acceptedLeave':
    'Geaccepteerde items verdwijnen uit deze lijst; de migratie gaat zonder ze verder, en ze worden niet als mislukt geteld.',
  'failures.seeRuns': 'Bekijk de mislukte ronde (uitvoeringsgeschiedenis)',
  'failures.stillTrying': 'Wordt nog geprobeerd',
  'failures.empty.retrying': 'Er wordt niets opnieuw geprobeerd.',
  'failures.retry': 'Probeer opnieuw',
  'failures.retryCost':
    'Opnieuw proberen doorloopt alles opnieuw tot dit item, dus de volgende ronde duurt langer.',
  'failures.retryCost.why':
    'Het wist de synchronisatiecursors (waar we waren gebleven) van deze migratie, zodat de hele bron opnieuw wordt doorlopen; er wordt niets dubbel gemigreerd.',
  'failures.accept': 'Migreer zonder dit item',
  'failures.acceptAll': 'Migreer zonder deze items ({count})',
  'failures.group.title': 'Beslis over een hele groep',
  'failures.group.hint':
    'Een sindsdien opgeloste storing haalt deze items er niet zelf weer uit.',
  'failures.group.hint.why':
    'Deze items staan geparkeerd nadat een paar keer opnieuw was geprobeerd. Systeemaanpassingen hebben hier geen effect op — items blijven wachten op uw beslissing, terwijl de migratie zich voltooid noemt. Kies een soort, of typ een deel van de fout om ze als groep te behandelen: opnieuw proberen wist ook eenmalig de synchronisatiecursors van deze migratie, om te zorgen dat de items weer opnieuw geprobeerd worden. De tekst wordt letterlijk vergeleken, dus wildcards werken niet als wildcards.',
  'failures.group.found': 'Groepen in deze wachtrij',
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
  'failures.group.error.placeholder': 'MKCOL',
  'failures.group.matches': 'Past op {count} van de {total} hier.',
  'failures.group.needsNarrowing': 'Kies eerst een soort, of typ een deel van de fout.',
  'failures.group.retry': 'Probeer deze allemaal opnieuw',
  'failures.group.accept': 'Migreer zonder al deze items',
  'failures.try.one': 'poging',
  'failures.try.many': 'pogingen',
  'failures.parked': 'wacht op u',
  'deletions.title': 'Verwijderd op het oude systeem',
  'deletions.intro':
    'Items die de eigenaar bij de bron verwijderde; het nieuwe systeem heeft deze nog.',
  'deletions.empty.confirmed': 'Er wacht niets op een beslissing.',
  'deletions.watching': 'Wordt in de gaten gehouden',
  'deletions.empty.watching': 'Er wordt niets in de gaten gehouden.',
  'deletions.empty.acknowledged': 'Er is nog niets besloten.',
  'deletions.keep': 'Behoud de kopie',
  'deletions.apply': 'Verwijder het hier ook',
  'deletions.applyArmed': 'Bevestig verwijderen',
  'deletions.earlierExports': 'Eerdere exports',
  'deletions.earlierExports.intro':
    'Kopieën die een eerder exportformaat achterliet. De documenten zijn niet verwijderd in Google.',
  'deletions.earlierExport.badge': 'eerdere export',
  'deletions.earlierExport.badgeTitle': 'Opnieuw geëxporteerd onder de nieuwe naam; dit is de oude kopie.',
};

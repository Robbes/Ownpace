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
  // ONE PRESS FOR THE ROWS WITH A DELETE BUTTON (workplan 0164 T3; ADR-0024,
  // amended 2026-11-21). Each row is still decided by itself, by the same
  // checks as its own button, the next only once the one before has
  // answered. Offered only while deleting by hand is on, and never for a row
  // without a delete button of its own. Its confirmation is a control of its
  // own, which names how many, over the rows as they were when it opened.
  'deletions.all': 'Delete all of these here too',
  'deletions.all.lead':
    'Deletes the copy of each of these {count} on the new system, one after another. Each is checked by itself first, as a single delete is, and the next is pressed only once it has answered. One that is refused stays here, with the reason. A refusal that speaks for all of them, or a delete that did not answer, stops the rest.',
  'deletions.all.confirm.question': 'Delete these {count} on the new system?',
  'deletions.all.confirm.yes': 'Delete {count}',
  'deletions.all.confirm.no': 'Cancel',
  // Only when some of them came from the bin, counted from the rows the
  // press acts on, in the words of the rows' own chips.
  'deletions.all.confirm.split': "Reported by the source: {reported}. In the source's bin: {bin}.",
  'deletions.all.confirm.bin':
    'A message can be in the bin and in a live folder at once, so a copy here may be one still in use, and once deleted it is never copied again.',
  'deletions.all.waiting': 'Waiting its turn',
  'deletions.all.reading': 'Reading the list again before anything is deleted…',
  // Said when the list moved while the confirmation was open, and when the
  // list read again at the press was not the one confirmed.
  'deletions.all.changed':
    'The list has changed: {count} can be deleted now. Nothing was deleted. Look at the list again, then confirm once more.',
  // A list with one row or none offers no press for all of them.
  'deletions.all.changed.few': 'The list has changed. Nothing was deleted. Look at the list again.',
  'deletions.all.unreadable': 'The list could not be read again, so nothing was deleted:',
  'deletions.all.running': 'Deleting on the new system, one at a time: {done} of {count} done.',
  'deletions.all.pollTrouble': 'Its answer could not be read, {count} times in a row: {error}. Still asking.',
  'deletions.all.stop': 'Stop',
  'deletions.all.stopping': 'Stopping: nothing more is deleted after the one under way.',
  'deletions.all.stoppingBeforeStart': 'Stopping: nothing will be deleted.',
  'deletions.all.done':
    'Done: {deleted} deleted on the new system, {alreadyRemoved} already removed there, {notDeleted} not deleted, {unknown} not known.',
  'deletions.all.stoppedBy.breaker':
    'Stopped: the safeguard against mass deletion refused one, so nothing after it was asked.',
  'deletions.all.stoppedBy.notEnabled': 'Stopped: deleting by hand was turned off, so nothing after it was asked.',
  'deletions.all.stoppedBy.failure': 'Stopped: one did not answer, so nothing after it was asked.',
  'deletions.all.stoppedBy.notRecorded':
    'Stopped: one was deleted, but Ownpace could not record it, because the list changed while it was being deleted. So nothing after it was asked.',
  'deletions.all.stoppedBy.notStarted': 'Stopped: nothing could be started for one, so nothing after it was asked.',
  'deletions.all.stoppedBy.evidenceWithdrawn':
    'Stopped: the old system no longer says one of them was deleted, so the list changed during the run. Nothing after it was asked.',
  'deletions.all.stoppedBy.stop': 'Stopped: you pressed Stop.',
  'deletions.all.removed': 'Deleted on the new system',
  // A copy an earlier removal took, a move's included: never counted as deleted.
  'deletions.all.alreadyRemoved': 'Copy already removed on the new system',
  'deletions.all.notRemoved': 'Not deleted',
  'deletions.all.unknown': 'Not known',
  // The server's own words and code, verbatim, folded under each line that
  // says it in the reader's language (docs/i18n-prose-boundary.md, class 2).
  'deletions.all.technical': 'Technical details',
  'deletions.all.notTried.breaker': 'Not tried: the safeguard against mass deletion refused an earlier one in this run.',
  'deletions.all.notTried.notEnabled': 'Not tried: deleting by hand was turned off earlier in this run.',
  'deletions.all.notTried.failure': 'Not tried: an earlier one did not answer.',
  'deletions.all.notTried.notRecorded': 'Not tried: the list changed while an earlier one was being deleted.',
  'deletions.all.notTried.notStarted': 'Not tried: nothing could be started for an earlier one.',
  'deletions.all.notTried.evidenceWithdrawn':
    'Not tried: the old system stopped saying an earlier one was deleted, so the list changed during the run.',
  'deletions.all.notTried.stop': 'Not tried: you pressed Stop before its turn.',
  'deletions.all.failed':
    'This did not answer, so whether it was deleted is not known. Look at it on the new system before you press again.',
  'deletions.all.late':
    'No answer came within {minutes} minutes. It may still be deleted: look at it on the new system before you press again.',
  'deletions.all.unknownRow': 'Not known whether it was deleted:',
  // Why one was not deleted, keyed on the refusal's stable code: the
  // server's sentence stays beside it, under Technical details.
  'deletions.refused.notEnabled': 'Deleting by hand is off for this migration, so it was not deleted.',
  // What a person can do about it, after the sentence above on one press
  // (workplan 0160, T2b): the switch on this page on managed, by its label
  // (`applyFlag.turnOn`), the mapping's file on the appliance.
  'deletions.refused.notEnabled.turnOn': 'To delete it, first press Turn on deleting by hand above.',
  'deletions.refused.notEnabled.config':
    'To delete it, set allowApplyDeletions in the migration’s config file and restart.',
  'deletions.refused.targetCannotRemove': 'The new system did not delete it for Ownpace, so nothing changed there.',
  // Also said when none of the kinds this migration copies holds the item.
  'deletions.refused.notFound':
    'Ownpace found no record of this item among the kinds this migration copies, so it did not delete anything.',
  'deletions.refused.notConfirmed':
    'Nothing says any more that it was deleted on the old system, so it was not deleted.',
  // True of a single press and of a run, where the old system did say so
  // when the list was read again, and no longer does.
  'deletions.refused.weakEvidence':
    'The old system does not say it was deleted, so it is only assumed to be. Ownpace does not delete it on the new system.',
  // Also said when there is no copy on the new system at all.
  'deletions.refused.notOurs': 'Ownpace did not delete it: there is no copy on the new system that Ownpace made.',
  // Also the answer after a move removed the old copy (`applyRelocation`):
  // said of the copy, never *deleted*, which would say the item is gone.
  'deletions.refused.alreadyApplied': 'The copy on the new system had already been removed.',
  'deletions.refused.alreadyKept':
    'Somebody chose to keep this copy, so it was not deleted. If that was a mistake, delete it on the new system yourself.',
  'deletions.refused.afterCutover':
    'Past the cutover of this kind, the old system no longer decides what exists, so it was not deleted.',
  'deletions.refused.editedOnTarget':
    'Somebody changed it on the new system after Ownpace copied it, so it is theirs now and was not deleted.',
  'deletions.refused.versionUnknown':
    'Ownpace kept no version of this copy, so it cannot tell whether somebody changed it, and did not delete it.',
  'deletions.refused.keptForGuests':
    'The event still lists guests, and the new system would email each of them a cancellation, so it was not deleted.',
  'deletions.refused.massDeletionSuspected':
    'So much of this kind is waiting to be deleted at once that it looks like a problem at the old system. The safeguard against mass deletion refuses every deletion of this kind in this migration while that many are waiting.',
  // Two causes: a pass saw the item back while it was deleted, or another
  // delete recorded it first, in which case nothing is missing.
  'deletions.refused.removedNotRecorded':
    'It was deleted on the new system, but this delete could not be recorded: the item changed while it ran. If another delete recorded it first, nothing more is needed; if not, Check reports it as missing until that is put right by hand.',
  'deletions.refused.other': 'It was refused, for the reason under Technical details.',
  // A press the server started nothing for (a hold, a closed account, a
  // removal that could not be queued): not deleted, and the run stops.
  'deletions.refused.held': 'Ownpace has paused copying for an update, so nothing was started for it and it was not deleted.',
  'deletions.refused.accountClosed': 'This account is closed, so nothing was started for it and it was not deleted.',
  'deletions.refused.notQueued': 'The removal could not be queued, so nothing was started for it and it was not deleted.',
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
  'deletions.all': 'Verwijder deze allemaal hier ook',
  'deletions.all.lead':
    'Verwijdert de kopie van elk van deze {count} op het nieuwe systeem, de een na de ander. Elk wordt eerst afzonderlijk gecontroleerd, net als bij één verwijdering, en op de knop van de volgende wordt pas gedrukt als de vorige antwoord heeft gegeven. Wat wordt geweigerd, blijft hier staan, met de reden. Een weigering die voor allemaal geldt, of een verwijdering die geen antwoord gaf, stopt de rest.',
  'deletions.all.confirm.question': 'Deze {count} verwijderen op het nieuwe systeem?',
  'deletions.all.confirm.yes': 'Verwijder {count}',
  'deletions.all.confirm.no': 'Annuleren',
  'deletions.all.confirm.split': 'Gemeld door de bron: {reported}. In de prullenbak van de bron: {bin}.',
  'deletions.all.confirm.bin':
    'Een bericht kan tegelijk in de prullenbak en in een gewone map staan, dus een kopie hier kan er een zijn die nog in gebruik is, en eenmaal verwijderd wordt die nooit meer gekopieerd.',
  'deletions.all.waiting': 'Wacht op zijn beurt',
  'deletions.all.reading': 'De lijst wordt opnieuw gelezen voordat er iets wordt verwijderd…',
  'deletions.all.changed':
    'De lijst is veranderd: nu kunnen er {count} worden verwijderd. Er is niets verwijderd. Bekijk de lijst opnieuw en bevestig dan nog een keer.',
  'deletions.all.changed.few': 'De lijst is veranderd. Er is niets verwijderd. Bekijk de lijst opnieuw.',
  'deletions.all.unreadable': 'De lijst kon niet opnieuw worden gelezen, dus er is niets verwijderd:',
  'deletions.all.running': 'Verwijderen op het nieuwe systeem, één voor één: {done} van {count} klaar.',
  'deletions.all.pollTrouble': 'Het antwoord kon {count} keer achter elkaar niet worden gelezen: {error}. Er wordt nog gevraagd.',
  'deletions.all.stop': 'Stoppen',
  'deletions.all.stopping': 'Bezig met stoppen: na de lopende verwijdering wordt er niets meer verwijderd.',
  'deletions.all.stoppingBeforeStart': 'Bezig met stoppen: er wordt niets verwijderd.',
  'deletions.all.done':
    'Klaar: {deleted} verwijderd op het nieuwe systeem, {alreadyRemoved} daar al verwijderd, {notDeleted} niet verwijderd, {unknown} onbekend.',
  'deletions.all.stoppedBy.breaker':
    'Gestopt: de beveiliging tegen massaal verwijderen weigerde er een, dus daarna is er niets meer gevraagd.',
  'deletions.all.stoppedBy.notEnabled':
    'Gestopt: handmatig verwijderen werd uitgeschakeld, dus daarna is er niets meer gevraagd.',
  'deletions.all.stoppedBy.failure': 'Gestopt: er gaf er een geen antwoord, dus daarna is er niets meer gevraagd.',
  'deletions.all.stoppedBy.notRecorded':
    'Gestopt: er is er een verwijderd, maar Ownpace kon dat niet vastleggen, omdat de lijst veranderde terwijl die werd verwijderd. Daarom is er daarna niets meer gevraagd.',
  'deletions.all.stoppedBy.notStarted':
    'Gestopt: voor een ervan kon niets in gang worden gezet, dus daarna is er niets meer gevraagd.',
  'deletions.all.stoppedBy.evidenceWithdrawn':
    'Gestopt: het oude systeem meldt niet meer dat er een is verwijderd, dus de lijst veranderde tijdens de reeks. Daarna is er niets meer gevraagd.',
  'deletions.all.stoppedBy.stop': 'Gestopt: u drukte op Stoppen.',
  'deletions.all.removed': 'Verwijderd op het nieuwe systeem',
  'deletions.all.alreadyRemoved': 'Kopie al verwijderd op het nieuwe systeem',
  'deletions.all.notRemoved': 'Niet verwijderd',
  'deletions.all.unknown': 'Onbekend',
  'deletions.all.technical': 'Technische details',
  'deletions.all.notTried.breaker':
    'Niet geprobeerd: eerder in deze reeks weigerde de beveiliging tegen massaal verwijderen er een.',
  'deletions.all.notTried.notEnabled': 'Niet geprobeerd: handmatig verwijderen werd eerder in deze reeks uitgeschakeld.',
  'deletions.all.notTried.failure': 'Niet geprobeerd: een eerdere gaf geen antwoord.',
  'deletions.all.notTried.notRecorded': 'Niet geprobeerd: de lijst veranderde terwijl een eerdere werd verwijderd.',
  'deletions.all.notTried.notStarted': 'Niet geprobeerd: voor een eerdere kon niets in gang worden gezet.',
  'deletions.all.notTried.evidenceWithdrawn':
    'Niet geprobeerd: het oude systeem meldde niet meer dat een eerdere was verwijderd, dus de lijst veranderde tijdens de reeks.',
  'deletions.all.notTried.stop': 'Niet geprobeerd: u drukte op Stoppen voordat het aan de beurt was.',
  'deletions.all.failed':
    'Dit gaf geen antwoord, dus of het is verwijderd, is niet bekend. Kijk op het nieuwe systeem voordat u nog een keer drukt.',
  'deletions.all.late':
    'Er kwam binnen {minutes} minuten geen antwoord. Het kan alsnog worden verwijderd: kijk op het nieuwe systeem voordat u nog een keer drukt.',
  'deletions.all.unknownRow': 'Niet bekend of het is verwijderd:',
  'deletions.refused.notEnabled': 'Handmatig verwijderen staat uit voor deze migratie, dus het is niet verwijderd.',
  'deletions.refused.notEnabled.turnOn':
    'Om het te verwijderen, drukt u eerst hierboven op Handmatig verwijderen inschakelen.',
  'deletions.refused.notEnabled.config':
    'Om het te verwijderen, zet u allowApplyDeletions aan in het configuratiebestand van de migratie en herstart u.',
  'deletions.refused.targetCannotRemove':
    'Het nieuwe systeem heeft het niet voor Ownpace verwijderd, dus daar is niets veranderd.',
  'deletions.refused.notFound':
    'Ownpace vond geen gegevens over dit item bij de soorten die deze migratie kopieert, dus het heeft niets verwijderd.',
  'deletions.refused.notConfirmed':
    'Niets meldt nog dat het op het oude systeem is verwijderd, dus het is niet verwijderd.',
  'deletions.refused.weakEvidence':
    'Het oude systeem meldt niet dat het verwijderd is, dus het is alleen een vermoeden. Ownpace verwijdert het niet op het nieuwe systeem.',
  'deletions.refused.notOurs':
    'Ownpace heeft het niet verwijderd: op het nieuwe systeem staat geen kopie die Ownpace heeft gemaakt.',
  'deletions.refused.alreadyApplied': 'De kopie op het nieuwe systeem was al verwijderd.',
  'deletions.refused.alreadyKept':
    'Iemand heeft ervoor gekozen deze kopie te behouden, dus die is niet verwijderd. Was dat een vergissing, verwijder die dan zelf op het nieuwe systeem.',
  'deletions.refused.afterCutover':
    'Na de overstap van deze soort bepaalt het oude systeem niet meer wat er bestaat, dus het is niet verwijderd.',
  'deletions.refused.editedOnTarget':
    'Iemand heeft het op het nieuwe systeem gewijzigd nadat Ownpace het migreerde, dus het is nu van hen en is niet verwijderd.',
  'deletions.refused.versionUnknown':
    'Ownpace bewaarde geen versie van deze kopie en kan dus niet zien of iemand die heeft gewijzigd; daarom is die niet verwijderd.',
  'deletions.refused.keptForGuests':
    'De afspraak heeft nog gasten, en het nieuwe systeem zou elk van hen een annulering mailen, dus die is niet verwijderd.',
  'deletions.refused.massDeletionSuspected':
    'Er wacht zoveel van deze soort tegelijk op verwijderen dat het op een probleem bij het oude systeem lijkt. De beveiliging tegen massaal verwijderen weigert elke verwijdering van deze soort in deze migratie zolang er zoveel wachten.',
  'deletions.refused.removedNotRecorded':
    'Het is op het nieuwe systeem verwijderd, maar deze verwijdering kon niet worden vastgelegd: het item veranderde terwijl die liep. Heeft een andere verwijdering het al vastgelegd, dan hoeft er niets meer; zo niet, dan meldt de verificatie het als ontbrekend totdat dat met de hand is rechtgezet.',
  'deletions.refused.other': 'Het is geweigerd, om de reden onder Technische details.',
  'deletions.refused.held':
    'Ownpace heeft het migreren gepauzeerd voor een update, dus er is niets in gang gezet en het is niet verwijderd.',
  'deletions.refused.accountClosed': 'Dit account is gesloten, dus er is niets in gang gezet en het is niet verwijderd.',
  'deletions.refused.notQueued':
    'De verwijdering kon niet in de wachtrij worden gezet, dus er is niets in gang gezet en het is niet verwijderd.',
  'deletions.decided.kept': 'Behouden op het nieuwe systeem',
  'deletions.decided.applied': 'Ook verwijderd op het nieuwe systeem',
  'deletions.decided.relocated': 'Verplaatst: de oude kopie is verwijderd op het nieuwe systeem',
  'deletions.earlierExports': 'Eerdere exports',
  'deletions.earlierExports.intro':
    'Kopieën die een eerder exportformaat achterliet. De documenten zijn niet verwijderd in Google.',
  'deletions.earlierExport.badge': 'eerdere export',
  'deletions.earlierExport.badgeTitle': 'Opnieuw geëxporteerd onder de nieuwe naam; dit is de oude kopie.',
};

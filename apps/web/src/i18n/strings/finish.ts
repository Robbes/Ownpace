// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Finishing a migration.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  'finish.title': 'Finish a migration',
  'finish.intro': 'Finishing stops the migration and the reporting; work the steps in order.',
  'finish.unknown.pre': 'No migration with id',
  'finish.unknown.post':
    'answered. Check the address; this is not a migration, nothing to finish.',
  'finish.readError.one': 'Could not read the migration.',
  'finish.readError.many': 'Could not read the migrations.',
  'finish.note.paused':
    'Never started, so there is nothing to finish. Remove the migration to retire it.',
  'finish.note.active':
    'Syncing on a schedule. Items still arriving on the old system are being migrated across.',
  'finish.note.cutover': 'In cutover. If it was running, it migrates until the grace period ends.',
  'finish.note.done':
    'Finished. This mapping no longer syncs and nothing is being reported for it.',
  'finish.note.continuous':
    'Continuous. It keeps syncing after cutover. Ending each data type stops it; copies already made stay.',
  'finish.step1.title': 'Check the copy is complete',
  'finish.step1.pre': 'Compare the two systems and sample the contents.',
  'finish.step1.link': 'Run the check',
  'finish.step1.post': '. Reads the whole destination, so it takes minutes on a large mailbox.',
  'finish.step2.title': 'Clear the decision queues',
  'finish.step1.passed': 'The check passed.',
  'finish.step1.notPassed': 'The check did not pass:',
  'finish.step1.noRun': 'No check has run yet.',
  'finish.step1.running': 'A check is running now.',
  'finish.step1.readFailed': 'Could not read the check status:',
  'finish.step2.readFailed': 'Could not read a queue:',
  'finish.step2.notSameAsClear': '— not the same as clear.',
  'finish.step3.failedFramed':
    'The request failed; a pass may still be running, so re-check the queues shortly.',
  'finish.aftermath.title': 'What remains available',
  'finish.aftermath.verify': 'Verification report',
  'finish.aftermath.runs': 'Run history (on the migration page)',
  'finish.step2.reading': 'Reading…',
  'finish.step2.clear': 'Nothing is waiting on you.',
  'finish.step2.failures.one': 'could not be copied',
  'finish.step2.failures.many': 'could not be copied',
  'finish.step2.deletions': 'deleted on the old system',
  'finish.step2.moves': 'moved',
  'finish.step2.onlyFirstBlocks':
    '. Only the first blocks finishing; the new system’s copy answers the other two.',
  'finish.step3.title': 'Run one final pass',
  'finish.step3.body': 'So the new system reflects the old one as of right now.',
  'finish.step3.run': 'Run a pass now',
  'finish.step3.runAgain': 'Run another',
  'finish.step3.finished': 'The pass has run and finished.',
  'finish.step3.queued':
    'Queued as a job; it lands in the run history, so re-check the queues shortly.',
  // A stopped data type is the one this step's promise leaves out (0125 T7):
  // nobody may finish believing its copies are current.
  'finish.step3.stopped.one': '{kind} is stopped and not in this pass: its one copy stays as it was.',
  'finish.step3.stopped.many': '{kind} is stopped and not in this pass: its {count} copies stay as they were.',
  'finish.step3.stopped.why':
    'It was switched off after copying. Its copies stay on the new system, but what changed on the old one since then has not reached them. If they must be current, switch it back on and let a pass run before you finish.',
  'finish.step3.stoppedByYou.why':
    'You stopped it. Its copies stay on the new system, but what changed on the old one since then has not reached them. If they must be current, resume it on the migration\'s page and let a pass run before you finish.',
  'finish.step3.stoppedUnread': 'Could not read whether a data type is stopped:',
  'finish.step4.title': 'Move delivery to the new system',
  'finish.step4.body':
    'Change MX/DNS and reconfigure clients so new email arrives on your new system.',
  'finish.step4.more':
    'This happens outside Ownpace\'s reach, so it is the one step here nobody can check for you.',
  'finish.step4.warn.pre': 'If you finish before this is done',
  'finish.step4.warn.post':
    ', anything that arrives on the old system afterwards will not be migrated, and nothing will report it — Ownpace stopped watching.',
  'finish.step4.checkbox': 'Delivery now goes to the new system.',
  'finish.step5.title': 'End or keep copying each data type',
  'finish.step5.nothingChanges.pre': 'Nothing is added to or removed from either system.',
  'finish.step5.nothingChanges.post':
    ' What is on the new system stays exactly as it is — this only stops Ownpace watching the old one.',
  'finish.button.disabledTitle':
    'Confirm step 4 first — finishing before delivery has moved loses anything that arrives afterwards.',
  // Each data type ended or kept copying on its own (workplan 0128 T3, T5
  // slice 7b; the owner's D3 and D8). The phase is the data type's own, as
  // the ending door believes it.
  'finish.each.title': 'Each data type',
  'finish.ending.phase.active': 'Migrating; not cut over yet',
  'finish.ending.phase.cutover': 'In its cutover',
  'finish.ending.phase.done': 'Ended',
  'finish.ending.phase.continuous': 'Keeps migrating after its cutover',
  'finish.ending.end': 'End {kind}',
  'finish.ending.keep': 'Keep migrating {kind}',
  'finish.ending.forceButton': 'End {kind} anyway, leaving them behind',
  'finish.ending.stopped':
    'You stopped {kind}. End it, or resume it on the migration\'s page to keep migrating it.',
  'finish.ending.failed': 'That did not go through:',
  // The grace period's end, when nobody chose (0128 D7, slice 7c).
  'finish.ending.graceEnded':
    'The grace period of {kind} ended on {date}, and nobody chose, so it no longer migrates. End it, or keep migrating.',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'finish.title': 'Rond een migratie af',
  'finish.intro':
    'Afronden stopt het migreren en het rapporteren; doorloop de stappen in volgorde.',
  'finish.unknown.pre': 'Geen migratie met id',
  'finish.unknown.post':
    'gaf antwoord. Controleer het adres; dit is geen migratie, er valt niets af te ronden.',
  'finish.readError.one': 'De migratie kon niet worden gelezen.',
  'finish.readError.many': 'De migraties konden niet worden gelezen.',
  'finish.note.paused':
    'Nooit gestart, dus niets af te ronden. Verwijder de migratie om op te ruimen.',
  'finish.note.active':
    'Synchroniseert volgens schema. Items die nog op het oude systeem binnenkomen, worden gemigreerd naar het nieuwe.',
  'finish.note.cutover':
    'In overstap. Liep de migratie, dan migreert die door tot de overgangsperiode afloopt.',
  'finish.note.done':
    'Afgerond. Deze migratie synchroniseert niet meer en er wordt niets meer over gerapporteerd.',
  'finish.note.continuous':
    'Doorlopend. Blijft migreren na de overstap. Elke beëindiging van een gegevenstype stopt dat; kopieën blijven staan.',
  'finish.step1.title': 'Controleer of de kopie volledig is',
  'finish.step1.pre': 'Vergelijk de twee systemen en controleer steekproefsgewijs de inhoud.',
  'finish.step1.link': 'Voer de controle uit',
  'finish.step1.post':
    '. Leest de volledige bestemming; bij grote hoeveelheden duurt dit minuten.',
  'finish.step2.title': 'Werk de beslissingswachtrijen weg',
  'finish.step1.passed': 'De verificatie is geslaagd.',
  'finish.step1.notPassed': 'De verificatie is niet geslaagd:',
  'finish.step1.noRun': 'Er is nog geen verificatie uitgevoerd.',
  'finish.step1.running': 'Er loopt nu een verificatie.',
  'finish.step1.readFailed': 'De verificatiestatus kon niet worden gelezen:',
  'finish.step2.readFailed': 'Een wachtrij kon niet worden gelezen:',
  'finish.step2.notSameAsClear': '— niet hetzelfde als leeg.',
  'finish.step3.failedFramed':
    'Het verzoek is mislukt; mogelijk loopt er nog een migratieronde, controleer de wachtrijen straks opnieuw.',
  'finish.aftermath.title': 'Wat beschikbaar blijft',
  'finish.aftermath.verify': 'Verificatierapport',
  'finish.aftermath.runs': 'Uitvoeringsgeschiedenis (op de migratiepagina)',
  'finish.step2.reading': 'Lezen…',
  'finish.step2.clear': 'Er wacht niets op u.',
  'finish.step2.failures.one': 'kon niet worden gemigreerd',
  'finish.step2.failures.many': 'konden niet worden gemigreerd',
  'finish.step2.deletions': 'verwijderd op het oude systeem',
  'finish.step2.moves': 'verplaatst',
  'finish.step2.onlyFirstBlocks':
    '. Alleen de eerste blokkeert; de kopie op het nieuwe systeem beantwoordt de andere twee.',
  'finish.step3.title': 'Voer één laatste ronde uit',
  'finish.step3.body': 'Zodat het nieuwe systeem het oude weerspiegelt zoals het nu is.',
  'finish.step3.run': 'Voer nu een ronde uit',
  'finish.step3.runAgain': 'Voer er nog een uit',
  'finish.step3.finished': 'De ronde is uitgevoerd en voltooid.',
  'finish.step3.queued':
    'In de wachtrij als taak; het komt in de uitvoeringsgeschiedenis, controleer de wachtrijen straks opnieuw.',
  'finish.step3.stopped.one': '{kind} is gestopt, en is geen onderdeel van deze ronde: de ene kopie blijft zoals die was.',
  'finish.step3.stopped.many': '{kind} is gestopt en is geen onderdeel van deze ronde: de {count} kopieën blijven zoals ze waren.',
  'finish.step3.stopped.why':
    'Het is uitgeschakeld nadat er gemigreerd was. De gemigreerde bestanden blijven op het nieuwe systeem, maar wat sindsdien op het oude veranderde, is nog niet gemigreerd naar het nieuwe. Moeten ze actueel blijven, schakel dan de migratie weer in en laat een ronde lopen voordat u afrondt.',
  'finish.step3.stoppedByYou.why':
    'U hebt deze migratie gestopt. Wat al gemigreerd was blijft in het nieuwe systeem, maar wat sindsdien op het oude veranderde, is nog niet gemigreerd. Moeten ze actueel blijven, hervat dan de migratie en laat een ronde lopen voordat u afrondt.',
  'finish.step3.stoppedUnread': 'Kon niet lezen of een gegevenstype gestopt is:',
  'finish.step4.title': 'Zet de e-mailbezorging om naar het nieuwe systeem',
  'finish.step4.body':
    'Wijzig MX/DNS en configureer de clients opnieuw, zodat nieuwe e-mail op het nieuwe systeem aankomt.',
  'finish.step4.more':
    'Dit gebeurt buiten Ownpace; Ownpace kan dit niet controleren.',
  'finish.step4.warn.pre': 'Als u afrondt voordat dit is gedaan',
  'finish.step4.warn.post':
    ', stopt de migratie: wat daarna nog op het oude systeem binnenkomt, zet Ownpace niet meer over naar het nieuwe, en niets meldt het — Ownpace kijkt niet meer mee.',
  'finish.step4.checkbox': 'Nieuwe e-mail komt nu aan op het nieuwe systeem.',
  'finish.step5.title': 'Beëindig of blijf migreren per gegevenstype',
  'finish.step5.nothingChanges.pre':
    'Er wordt aan geen van beide systemen iets toegevoegd of verwijderd.',
  'finish.step5.nothingChanges.post':
    ' Wat op het nieuwe systeem staat, blijft precies zoals het is — dit stopt alleen het meekijken met het oude.',
  'finish.button.disabledTitle':
    'Bevestig eerst stap 4; wie afrondt voordat de bezorging is omgezet, verliest alles wat daarna nog op het oude systeem binnenkomt.',
  'finish.each.title': 'Per gegevenstype',
  'finish.ending.phase.active': 'Migreert; nog niet overgestapt',
  'finish.ending.phase.cutover': 'Bezig met overstap',
  'finish.ending.phase.done': 'Beëindigd',
  'finish.ending.phase.continuous': 'Blijft migreren na de overstap',
  'finish.ending.end': '{kind} beëindigen',
  'finish.ending.keep': '{kind} blijven migreren',
  'finish.ending.forceButton': '{kind} toch beëindigen en achterlaten',
  'finish.ending.stopped':
    'U hebt {kind} gestopt. Beëindig deze, of hervat het op de pagina van de migratie om het te blijven migreren.',
  'finish.ending.failed': 'Niet gelukt:',
  'finish.ending.graceEnded':
    'De overgangsperiode van {kind} liep af op {date} en er is niets gekozen, dus er wordt niet langer gemigreerd. Beëindig, of hervat de migratie.',
};

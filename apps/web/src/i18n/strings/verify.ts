// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The check of what arrived.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  'verify.checkedAt': 'Checked',
  'verify.title': 'Check the migration',
  'verify.intro':
    'Compares old against new and samples contents; read-only, it never writes to either side.',
  'verify.run': 'Run the check',
  'verify.runAgain': 'Check again',
  'verify.durationHint': 'Reads the whole destination — on large content this takes minutes.',
  'verify.applianceScope':
    'On this appliance the check always covers every configured migration.',
  'verify.runningSince': 'Running since',
  'verify.didNotComplete': 'The check did not complete.',
  'verify.notAResult':
    'Nothing is known about the migration’s completeness either way; this is not a result.',
  'verify.restarted': 'The appliance restarted while the check ran. Run it again.',
  'verify.ready': 'This migration is ready to switch.',
  'verify.notReady': 'Not ready to switch yet. See below.',
  'verify.countsOnly': 'No content was compared. This rests on counts and sizes alone.',
  'verify.score': 'score',
  'verify.evidence.checked': 'content checked',
  'verify.evidence.partial': 'content partly checked',
  'verify.evidence.none': 'counts only',
  'verify.evidence.help.checked': 'Every sampled item was compared with the original.',
  'verify.evidence.help.partial': 'Some sampled items were compared; others could not be read.',
  'verify.evidence.help.none': 'No item’s content was compared. Counts and sizes only.',
  'verify.th.type': 'Type',
  'verify.th.result': 'Result',
  'verify.th.source': 'On the old system',
  'verify.th.target': 'On the new system',
  'verify.th.missing': 'Missing',
  'verify.th.sample': 'Content sample',
  'verify.th.bytes': 'Size on the new system',
  'verify.matched': 'matched',
  'verify.differed': 'differed',
  'verify.notComparable': 'not comparable',
  'verify.notMeasured': 'not measured',
  'verify.notMeasured.title': 'Not compared: the new system gives no size.',
  'verify.issues': 'Issues',
  'verify.whatToDo': 'What to do',
  // What the check found, in the reader's words (the owner, 2026-10-18). The
  // server's own text, and its recommendations, stay under this fold, closed:
  // a support thread can still quote them.
  'verify.technical': 'Technical details',
  // A finding's severity, and below each verdict, in words; the server's
  // token stays in the title (`verdict-words.ts`).
  'verify.severity.ERROR': 'Problem',
  'verify.severity.WARNING': 'Warning',
  // The four findings the client knows by their id. {type} is the data type's
  // word in lower case, {n} a count in the reader's digits. Any other id says
  // the server's text.
  'verify.issue.folderMissing':
    'The {type} folder is gone from the new system, so the copies in it are missing. Restore it (on Nextcloud: Deleted files), then check again.',
  'verify.issue.targetUnread':
    'The new system did not answer for {type}, so it could not be checked. Look at the account on the Accounts page, then check again.',
  'verify.issue.missing':
    '{n} {type} items are on the old system but not on the new one. Let another pass run, then check again.',
  'verify.issue.checksum': '{n} sampled {type} items differ from the original. Confirmed shows which.',
  'verify.verdict.PASS': 'Passed',
  'verify.verdict.WARN': 'Passed, with warnings',
  'verify.verdict.FAIL': 'Did not pass',
  'verify.verdict.SKIPPED': 'Not checked',
  'verify.verdict.NOT_VERIFIABLE': 'Could not be checked',
  'verify.help.PASS': 'Counts matched and the sampled content compared clean.',
  'verify.help.WARN': 'Discrepancies within tolerance. Read the issues before proceeding.',
  'verify.help.FAIL': 'Items are missing on the target, or sampled content did not match.',
  // Three causes answer SKIPPED (`verifyDomain` in core): the data type is
  // switched off, you stopped it, or nothing of it was recorded. The server's
  // own reason stands beside this; the help covers all three.
  'verify.help.SKIPPED':
    'Not checked: switched off or stopped, or there was nothing to check. It does not block switching over.',
  'verify.help.NOT_VERIFIABLE':
    'Enabled, but the target cannot be read for it; unchecked, so it blocks cutover.',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'verify.checkedAt': 'Geverifieerd',
  'verify.title': 'Verifieer de migratie',
  'verify.intro':
    'Vergelijkt oud met nieuw en controleert via steekproeven; alleen-lezen, er wordt aan geen kant geschreven.',
  'verify.run': 'Voer de verificatie uit',
  'verify.runAgain': 'Verifieer opnieuw',
  'verify.durationHint':
    'Leest de volledige bestemming — bij grote hoeveelheden duurt dit minuten.',
  'verify.applianceScope':
    'Op deze appliance omvat de verificatie altijd elke geconfigureerde migratie.',
  'verify.runningSince': 'Bezig sinds',
  'verify.didNotComplete': 'De verificatie is niet voltooid.',
  'verify.notAResult':
    'De verificatie is niet afgerond: dit zegt niets over de volledigheid, en is geen resultaat.',
  'verify.restarted': 'De appliance is herstart terwijl de verificatie liep. Voer hem opnieuw uit.',
  'verify.ready': 'Deze migratie is klaar voor overstap.',
  'verify.notReady': 'Nog niet klaar voor overstap. Zie hieronder.',
  'verify.countsOnly': 'Er is geen inhoud vergeleken. Dit rust alleen op aantallen en groottes.',
  'verify.score': 'score',
  'verify.evidence.checked': 'inhoud gecontroleerd',
  'verify.evidence.partial': 'inhoud deels gecontroleerd',
  'verify.evidence.none': 'alleen aantallen',
  'verify.evidence.help.checked':
    'Van elk item in de steekproef is de inhoud met het origineel vergeleken.',
  'verify.evidence.help.partial':
    'Sommige items uit de steekproef zijn vergeleken; andere konden niet gelezen worden.',
  'verify.evidence.help.none': 'Van geen enkel item is de inhoud vergeleken. Alleen aantallen en omvang.',
  'verify.th.type': 'Type',
  'verify.th.result': 'Resultaat',
  'verify.th.source': 'Op het oude systeem',
  'verify.th.target': 'Op het nieuwe systeem',
  'verify.th.missing': 'Ontbrekend',
  'verify.th.sample': 'Inhoudssteekproef',
  'verify.th.bytes': 'Grootte op het nieuwe systeem',
  'verify.matched': 'overeenkomend',
  'verify.differed': 'afwijkend',
  'verify.notComparable': 'niet vergelijkbaar',
  'verify.notMeasured': 'niet gemeten',
  'verify.notMeasured.title': 'Niet vergeleken: het nieuwe systeem geeft geen grootte.',
  'verify.issues': 'Problemen',
  'verify.whatToDo': 'Wat te doen',
  'verify.technical': 'Technische details',
  'verify.severity.ERROR': 'Probleem',
  'verify.severity.WARNING': 'Waarschuwing',
  'verify.issue.folderMissing':
    'De map voor {type} staat niet meer op het nieuwe systeem, dus de kopieën daarin ontbreken. Zet de map terug (in Nextcloud: Verwijderde bestanden) en verifieer opnieuw.',
  'verify.issue.targetUnread':
    'Het nieuwe systeem gaf geen antwoord voor {type}, dus dit kon niet worden geverifieerd. Bekijk het account op de pagina Accounts en verifieer daarna opnieuw.',
  'verify.issue.missing':
    '{n} items ({type}) staan op het oude systeem maar niet op het nieuwe. Laat nog een ronde lopen en verifieer daarna opnieuw.',
  'verify.issue.checksum':
    '{n} items ({type}) uit de steekproef wijken af van het origineel. Bevestigd laat zien welke.',
  'verify.verdict.PASS': 'Geslaagd',
  'verify.verdict.WARN': 'Geslaagd, met waarschuwingen',
  'verify.verdict.FAIL': 'Niet geslaagd',
  'verify.verdict.SKIPPED': 'Niet geverifieerd',
  'verify.verdict.NOT_VERIFIABLE': 'Kon niet worden geverifieerd',
  'verify.help.PASS': 'De aantallen kwamen overeen en de gecontroleerde inhoud was gelijk.',
  'verify.help.WARN':
    'Afwijkingen binnen de tolerantie. Beoordeel de problemen voordat u verdergaat.',
  'verify.help.FAIL':
    'Er ontbreken items op het doelsysteem, of gecontroleerde inhoud kwam niet overeen.',
  'verify.help.SKIPPED':
    'Niet gecontroleerd: uitgeschakeld of gestopt, of er was niets te controleren. Het blokkeert de overstap niet.',
  'verify.help.NOT_VERIFIABLE':
    'Ingeschakeld, maar de controle kon niet worden uitgevoerd (kon niet lezen); blokkeert de overstap.',
};

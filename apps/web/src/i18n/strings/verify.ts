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
  'verify.didNotStart': 'The check did not start.',
  'verify.ready': 'This migration is ready to cut over.',
  'verify.notReady': 'Not ready to cut over. See the domains and issues below.',
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
  'verify.th.target': 'On the new one',
  'verify.th.missing': 'Missing',
  'verify.th.sample': 'Content sample',
  'verify.th.bytes': 'Bytes (target)',
  'verify.matched': 'matched',
  'verify.differed': 'differed',
  'verify.notComparable': 'not comparable',
  'verify.notMeasured': 'not measured',
  'verify.notMeasured.title': 'Target gives no per-item size; not a match.',
  'verify.issues': 'Issues',
  'verify.whatToDo': 'What to do',
  'verify.help.PASS': 'Counts matched and the sampled content compared clean.',
  'verify.help.WARN': 'Discrepancies within tolerance. Read the issues before proceeding.',
  'verify.help.FAIL': 'Items are missing on the target, or sampled content did not match.',
  'verify.help.SKIPPED':
    'Turned off in the config; it does not block cutover, but nobody checked it.',
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
  'verify.didNotStart': 'De verificatie is niet gestart.',
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
  'verify.th.target': 'Op het nieuwe',
  'verify.th.missing': 'Ontbrekend',
  'verify.th.sample': 'Inhoudssteekproef',
  'verify.th.bytes': 'Bytes (doel)',
  'verify.matched': 'overeenkomend',
  'verify.differed': 'afwijkend',
  'verify.notComparable': 'niet vergelijkbaar',
  'verify.notMeasured': 'niet gemeten',
  'verify.notMeasured.title': 'Doel geeft geen grootte per item; geen overeenkomst.',
  'verify.issues': 'Problemen',
  'verify.whatToDo': 'Wat te doen',
  'verify.help.PASS': 'De aantallen kwamen overeen en de gecontroleerde inhoud was gelijk.',
  'verify.help.WARN':
    'Afwijkingen binnen de tolerantie. Beoordeel de problemen voordat u verdergaat.',
  'verify.help.FAIL':
    'Er ontbreken items op het doelsysteem, of gecontroleerde inhoud kwam niet overeen.',
  'verify.help.SKIPPED':
    'Uitgeschakeld in de configuratie (keuze: overgeslagen); blokkeert de overstap niet, maar niemand heeft het gecontroleerd.',
  'verify.help.NOT_VERIFIABLE':
    'Ingeschakeld, maar de controle kon niet worden uitgevoerd (kon niet lezen); blokkeert de overstap.',
};

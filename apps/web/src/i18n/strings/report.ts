// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Reporting a problem, and the report of what arrived.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  'report.title': 'Report a problem',
  'report.lead': 'Tell us what happened, we read every report and will contact you by email.',
  'report.description': 'What happened?',
  'report.descriptionHint': 'What you were doing, what you expected, and what you saw instead.',
  'report.screenshot': 'Screenshot (optional)',
  'report.screenshotChoose': 'Choose a screenshot',
  'report.screenshotHint':
    'PNG or JPEG, up to 5 MB: choose one, drop it here, or paste it anywhere on this page. ' +
    'It shows your screen: check it first.',
  'report.screenshotTooBig': 'Picture is larger than 5 MB.',
  'report.screenshotType': 'Choose a PNG or a JPEG.',
  // How to make one, a closed fold under the field (the owner, 2026-09-28):
  // one line for each kind of device, from each vendor's own help page, and
  // what to look at before sending it. Print Screen copies the whole screen on
  // Windows 10; on Windows 11 it opens the same snipping bar as Windows+Shift+S,
  // unless its keyboard setting is turned off.
  'report.screenshotHelp': 'How do I make a screenshot?',
  'report.screenshotHelp.windows':
    'Windows: press Windows+Shift+S, choose the part of the screen, then paste it here with Ctrl+V. ' +
    'Or press Print Screen (on Windows 11 you get the same choice), then paste.',
  'report.screenshotHelp.mac':
    'Mac: press Shift+Command+4, drag over the part you want, then choose the picture from your desktop. ' +
    'Or press Control+Shift+Command+4 to copy it instead, and paste it here with Command+V.',
  'report.screenshotHelp.iphone':
    'iPhone or iPad: press the side or top button and volume up at the same time (on a model with a ' +
    'Home button: the side or top button and the Home button). Then choose the picture from Photos.',
  'report.screenshotHelp.android':
    'Android: press power and volume down at the same time, on most phones; on some, swipe with two or three fingers instead. Then choose the picture from your photos.',
  'report.screenshotHelp.chromebook': 'Chromebook: press Ctrl+Show windows, then paste it here with Ctrl+V.',
  'report.screenshotHelp.check':
    'Please check the picture before sending it over, so it does not contain anything you would rather not send.',
  // What is attached, however it came: chosen, pasted or dropped.
  'report.screenshotAttached': 'Attached: {name} ({size}).',
  'report.screenshotRemove': 'Remove the screenshot',
  // Only where the browser can read a picture from the clipboard.
  'report.screenshotPaste': 'Paste screenshot',
  'report.screenshotPasteEmpty':
    'There is no picture on the clipboard. Make a screenshot first, then press Paste screenshot again.',
  'report.screenshotPasteFailed':
    'This browser could not read the clipboard. Paste with Ctrl+V instead, or with Command+V on a Mac.',
  'report.tooLarge': 'The screenshot file is too large: choose a smaller one or resize and send the report again.',
  'report.timedOut':
    'No answer came within {minutes} minutes, so this page cannot tell whether your report arrived. ' +
    'What you wrote is still here. You could send it again.',
  // Where a report goes and what goes with it (workplan 0130 T6). The lines in
  // the fold are the server's own, shown as they are sent, in English; these
  // are the words around them. `report.facts.more` stands above those lines
  // only; when they cannot be had, `report.facts.known` stands above what the
  // form itself knows, in the reader's language.
  'report.goesTo': 'Goes to the Ownpace support team.',
  'report.goesTo.mail': 'Goes to the Ownpace support team, by email to {address}.',
  'report.goesTo.helpdesk': "Goes to the Ownpace support team's helpdesk.",
  'report.facts': 'What we send with this',
  'report.facts.more':
    'What you write, and your screenshot if you add one. With them go these lines, exactly as our support team reads them:',
  'report.facts.known': 'What you write, and your screenshot if you add one. With them go:',
  'report.facts.reading': 'Looking up the rest…',
  'report.facts.unshown':
    'The rest could not be shown just now. When you send the report, we look it up again, and it goes with the report.',
  'report.page': 'the page you were on: {page}',
  'report.reference': 'the reference on your screen: {reference}',
  'report.category': 'the kind of error: {category}',
  'report.replyTo': 'Replies go to {email}.',
  // The policy beside what the form says it sends (0139 T4): privacy §4.5
  // says why a report is kept, and §9 for how long. The link follows, named
  // as the text names itself (`acceptance.doc.privacy`).
  'report.privacy': 'Why we keep your report, and for how long:',
  // What the browser says of itself (workplan 0130 T6, Part B), as the form
  // lists it when the service's lines cannot be had. The server writes each
  // as a line of its own, in English, when they can.
  'report.browser.language': 'the language of this screen: English',
  'report.browser.timeZone': 'your time zone: {timeZone}',
  'report.browser.width': 'the width of this window: {width} pixels',
  'report.browser.appBuild': "this page's/app version, {build}, if the service runs another",
  'report.browser.dataType': 'the data type of the failure you came from: {dataType}',
  'report.browser.side.source': 'that it happened on the source side',
  'report.browser.side.target': 'that it happened on the destination side',
  'report.browser.migration': 'the migration it belongs to: {migration}',
  'report.browser.recentError': 'the reference of an error from the last {minutes} minutes: {reference} ({code})',
  'report.send': 'Send the report',
  'report.sendNeeds': 'First write what happened.',
  'report.sending': 'Sending…',
  'report.sent': 'Sent. Your report is number {ticket}, and we will reply to {email}.',
  // Where the service has no helpdesk, a report goes to the support mailbox by
  // mail (the owner, for the alpha, 2026-09-28): no ticket, so no number, and
  // the report's own reference instead, which the mail carries too as `Report
  // reference:`. Named apart from the error's reference the form listed above
  // (`report.reference`), which the Log page finds and this one it does not.
  'report.sent.mail': 'Sent to our support team, with report reference {reference}. We will reply by email to {email}.',
  'report.back': 'Back to the page you were on',
  'report.unavailable': 'Reporting a problem is not set up on this service.',
  'migrationReport.title': 'Report',
  'migrationReport.person.title': 'Report: {name}',
  'migrationReport.lead': 'What was found, what arrived, what could not come and why, and what the check compared.',
  'migrationReport.loadFailed': 'Could not read this report.',
  'migrationReport.verdict.complete': 'Complete: everything has arrived, and nothing waits on a decision.',
  'migrationReport.verdict.decisionsPending': 'Everything has arrived, but some items still wait on your decision.',
  'migrationReport.verdict.inProgress': 'Still under way: this is where it stands, not a closing report.',
  'migrationReport.arrived.heading': 'What arrived',
  'migrationReport.col.type': 'Type',
  'migrationReport.col.found': 'Found',
  'migrationReport.col.arrived': 'Arrived',
  'migrationReport.col.leftAsIs': 'Left as it was',
  'migrationReport.col.couldNotCome': 'Could not migrate',
  'migrationReport.notCounted': 'not counted',
  'migrationReport.why': 'Why:',
  'migrationReport.seeWhich': 'See which, and why',
  'migrationReport.notPart': 'Not part of this migration: {types}.',
  'migrationReport.decisions.heading': 'What waits on a decision',
  'migrationReport.decisions.none': 'Nothing waits on a decision.',
  'migrationReport.removed.heading': 'What was removed, and on whose decision',
  'migrationReport.removed.counts':
    '{deletions} removed on a decision, {relocations} old copies of moved items removed, {refused} refused by a safeguard.',
  'migrationReport.removed.inTheLog': 'Each removal is in the log, and was made only on a decision.',
  'migrationReport.sharing.heading': 'Shares carried over',
  'migrationReport.sharing.counts': '{applied} re-created, {manual} done by hand, {skipped} not carried over, {open} still open.',
  'migrationReport.check.heading': 'What the check compared',
  'migrationReport.check.col.old': 'On the old system',
  'migrationReport.check.col.new': 'On the new system',
  'migrationReport.check.col.contents': 'Contents compared',
  'migrationReport.check.compared': '{matched} of {sampled} the same',
  'migrationReport.access.heading': 'Access you granted, which only you can withdraw',
  'migrationReport.access.lead': 'It still works after this migration, until you withdraw it.',
  'migrationReport.asOf': 'As it stood on {when}.',
  'migrationReport.download': 'Download the report',
  // What a saved file is called: this word, the migration's name and the
  // day (download-name.ts), where it was `completion-report-<id>.md`.
  'download.report': 'Ownpace report',
  'download.permissions': 'Ownpace permissions',
  'download.confirmed': 'Ownpace confirmed items',
  'migrationReport.toConfirmed': 'What is confirmed, item by item',
  'migrationReport.open': 'The report',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'report.title': 'Een probleem melden',
  'report.lead': 'Wat is aan de hand? U krijgt zsm. antwoord per e-mail.',
  'report.description': 'Wat gebeurde er?',
  'report.descriptionHint': 'Wat u deed, wat u verwachtte, en wat u in plaats daarvan zag.',
  'report.screenshot': 'Schermafbeelding (optioneel)',
  'report.screenshotChoose': 'Schermafbeelding kiezen',
  'report.screenshotHint':
    'PNG of JPEG, tot 5 MB: kies er een, sleep hem hierheen of plak hem ergens op deze pagina. ' +
    'Hij toont uw scherm, dus controleer even of wat u opstuurt klopt.',
  'report.screenshotTooBig': 'Afbeelding is groter dan 5 MB.',
  'report.screenshotType': 'Kies een PNG of een JPEG.',
  'report.screenshotHelp': 'Hoe maak ik een schermafbeelding?',
  'report.screenshotHelp.windows':
    'Windows: druk op Windows+Shift+S, kies het deel van het scherm en plak hier met Ctrl+V. ' +
    'Of druk op Print Screen (in Windows 11 krijgt u dan dezelfde keuze) en plak hier.',
  'report.screenshotHelp.mac':
    'Mac: druk op Shift+Command+4, selecteer het deel dat u wilt en kies de afbeelding daarna via uw bureaublad. ' +
    'Of druk op Control+Shift+Command+4 om hem te kopiëren, en plak hem hier met Command+V.',
  'report.screenshotHelp.iphone':
    'iPhone of iPad: druk tegelijk op de zij- of bovenknop en volume omhoog (op een model met een ' +
    "thuisknop: de zij- of bovenknop en de thuisknop). Kies de afbeelding daarna in Foto's.",
  'report.screenshotHelp.android':
    "Android: druk tegelijk op de aan/uit-knop en volume omlaag, op de meeste telefoons. Sommige andere door te swipen met 2 of 3 vingers. Kies de afbeelding daarna uit uw foto's.",
  'report.screenshotHelp.chromebook': 'Chromebook: druk op Ctrl+Vensters weergeven en plak hem hier met Ctrl+V.',
  'report.screenshotHelp.check':
    'Controleer de afbeelding voordat u deze verstuurt.',
  'report.screenshotAttached': 'Bijgevoegd: {name} ({size}).',
  'report.screenshotRemove': 'Schermafbeelding verwijderen',
  'report.screenshotPaste': 'Schermafbeelding plakken',
  'report.screenshotPasteEmpty':
    'Er staat geen afbeelding op het klembord. Maak eerst een schermafbeelding en druk dan opnieuw op Schermafbeelding plakken.',
  'report.screenshotPasteFailed':
    'Deze browser kon het klembord niet lezen. Plak dan met Ctrl+V, of met Command+V op een Mac.',
  'report.tooLarge':
    'De schermafbeelding is te groot: kies een kleinere of verklein hem, en verstuur de melding opnieuw.',
  'report.timedOut':
    'Binnen {minutes} minuten kwam er geen antwoord, dus deze pagina weet niet of uw melding is aangekomen. ' +
    'Wat u schreef staat er nog. Verstuur de melding opnieuw.',
  'report.goesTo': 'Aan het Ownpace-supportteam.',
  'report.goesTo.mail': 'Gaat naar het Ownpace-supportteam: {address}.',
  'report.goesTo.helpdesk': 'Gaat naar de helpdesk van het Ownpace-supportteam.',
  'report.facts': 'Wat we meesturen',
  'report.facts.more':
    'Wat u schrijft, en uw schermafbeelding als u die toevoegt. Daarbij gaan deze regels mee, precies zoals ons supportteam ze leest, in het Engels:',
  'report.facts.known': 'Wat u schrijft, en uw schermafbeelding als u die toevoegt. Daarbij gaan mee:',
  'report.facts.reading': 'De rest zoeken we op…',
  'report.facts.unshown':
    'De rest kon nu niet worden getoond. Als u de melding verstuurt, zoeken we die opnieuw op, en die gaat met de melding mee.',
  'report.page': 'de pagina waarop u was: {page}',
  'report.reference': 'de referentie op uw scherm: {reference}',
  'report.category': 'het soort fout: {category}',
  'report.replyTo': 'Antwoorden gaan naar {email}.',
  'report.privacy': 'Waarom we uw melding bewaren, en hoelang:',
  'report.browser.language': 'de taal van dit scherm: Nederlands',
  'report.browser.timeZone': 'uw tijdzone: {timeZone}',
  'report.browser.width': 'de breedte van dit venster: {width} pixels',
  'report.browser.appBuild': 'de versie van deze pagina, {build}, als de dienst een andere draait',
  'report.browser.dataType': 'het gegevenstype van de fout waar u vandaan kwam: {dataType}',
  'report.browser.side.source': 'dat het aan de bronkant gebeurde',
  'report.browser.side.target': 'dat het aan de doelkant gebeurde',
  'report.browser.migration': 'de migratie waar die bij hoort: {migration}',
  'report.browser.recentError': 'de referentie van een fout uit de afgelopen {minutes} minuten: {reference} ({code})',
  'report.send': 'Melding versturen',
  'report.sendNeeds': 'Schrijf eerst wat er gebeurde.',
  'report.sending': 'Versturen…',
  'report.sent': 'Verstuurd. Uw melding heeft nummer {ticket}, en we antwoorden naar {email}.',
  'report.sent.mail': 'Verstuurd naar ons supportteam met meldingskenmerk {reference}. We antwoorden naar {email}.',
  'report.back': 'Terug naar de pagina waar u was',
  'report.unavailable': 'Een probleem melden is op deze dienst niet ingesteld.',
  'migrationReport.title': 'Rapport',
  'migrationReport.person.title': 'Rapport: {name}',
  'migrationReport.lead': 'Wat is aangetroffen, gemigreerd en gecontroleerd? Wat kwam niet mee en waarom?',
  'migrationReport.loadFailed': 'Dit rapport kon niet worden gelezen.',
  'migrationReport.verdict.complete': 'Compleet: alles is aangekomen en niets wacht op uw beslissing.',
  'migrationReport.verdict.decisionsPending': 'Alles is aangekomen, maar sommige items wachten nog op uw beslissing.',
  'migrationReport.verdict.inProgress': 'Nog bezig: dit is de tussenstand.',
  'migrationReport.arrived.heading': 'Wat er is aangekomen',
  'migrationReport.col.type': 'Type',
  'migrationReport.col.found': 'Aangetroffen',
  'migrationReport.col.arrived': 'Aangekomen',
  'migrationReport.col.leftAsIs': 'Ongemoeid gelaten',
  'migrationReport.col.couldNotCome': 'Kon niet mee',
  'migrationReport.notCounted': 'niet geteld',
  'migrationReport.why': 'Waarom:',
  'migrationReport.seeWhich': 'Bekijk welke, en waarom',
  'migrationReport.notPart': 'Geen onderdeel van deze migratie: {types}.',
  'migrationReport.decisions.heading': 'Wat op uw beslissing wacht',
  'migrationReport.decisions.none': 'Niets wacht op uw beslissing.',
  'migrationReport.removed.heading': 'Wat er is verwijderd, en na wiens beslissing',
  'migrationReport.removed.counts':
    '{deletions} verwijderd na een beslissing, {relocations} oude kopieën van verplaatste items verwijderd, {refused} geweigerd door een beveiligingsregel.',
  'migrationReport.removed.inTheLog': 'Elke verwijdering staat in het logboek, en werd genomen vanuit een beslissing.',
  'migrationReport.sharing.heading': 'Meegenomen deelrechten',
  'migrationReport.sharing.counts': '{applied} opnieuw gemaakt, {manual} met de hand gedaan, {skipped} niet meegenomen, {open} nog open.',
  'migrationReport.check.heading': 'Wat de verificatie heeft vergeleken',
  'migrationReport.check.col.old': 'Op het oude systeem',
  'migrationReport.check.col.new': 'Op het nieuwe systeem',
  'migrationReport.check.col.contents': 'Inhoud vergeleken',
  'migrationReport.check.compared': '{matched} van {sampled} gelijk',
  'migrationReport.access.heading': 'Toegang die u gaf en die alleen u kunt intrekken',
  'migrationReport.access.lead': 'Deze toegang werkt na de migratie nog, tot u hem intrekt.',
  'migrationReport.asOf': 'Stand van {when}.',
  'migrationReport.download': 'Download het rapport',
  'download.report': 'Ownpace-rapport',
  'download.permissions': 'Ownpace-rechtenlijst',
  'download.confirmed': 'Ownpace bevestigde items',
  'migrationReport.toConfirmed': 'Wat is bevestigd, item voor item',
  'migrationReport.open': 'Het rapport',
};

// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * What a migration will do, confirmed before it runs: discovery, decisions and the destructive flags.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  'confirm.progress.lastSynced': 'last synced',
  'discovery.scanning': 'Scanning your source (read-only)…',
  // Named rather than counted, and present tense: the reader is watching this
  // happen. See DiscoveryCounts for the three-row table that read as finished.
  'discovery.stillCounting': 'Still counting: {domains}. This page updates on its own.',
  // The ceiling, not an error: the rows above are real, and the one that has
  // not answered may still. Never "something went wrong" — nothing is known to
  // have gone wrong, and saying so would be a claim we cannot support (rule 9).
  'discovery.stillCounting.slow':
    'Still counting: {domains}. Taking longer than usual; reload to check again.',
  // A count and an error in one row say nothing about which of the two is
  // current. This names the rows where they disagree — the numbers are real,
  // they are just older than the error beside them. See DiscoveryCounts.
  'discovery.countedEarlier':
    'Numbers for {domains} are from an earlier check; the latest one failed.',
  'discovery.th.type': 'Type',
  'discovery.th.collections': 'Collections',
  'discovery.th.items': 'Items',
  'discovery.th.size': 'Size',
  'discovery.th.existing': 'Already on the destination',
  'discovery.keptAsIs': 'kept as-is',
  'discovery.generatedId.pre.one':
    'message arrived without a Message-ID; we generate one and add it to',
  'discovery.generatedId.pre.many':
    'messages arrived without a Message-ID; we generate one and add it to',
  'discovery.generatedId.strong': 'the copy on your new server',
  'discovery.generatedId.post':
    '— the original on your old server is not changed; they migrate with the rest.',
  // The other half of the same absence (ADR-0020's amendment of 2026-10-03):
  // a source that cannot give a message an id, Microsoft 365 through Graph,
  // leaves it behind. Said here, before Start, and never as a generated id.
  'discovery.unlisted.pre.one': 'message has no Message-ID, and this connection cannot give it one, so it',
  'discovery.unlisted.pre.many': 'messages have no Message-ID, and this connection cannot give them one, so they',
  'discovery.unlisted.strong.one': 'will not be migrated',
  'discovery.unlisted.strong.many': 'will not be migrated',
  'discovery.unlisted.post': '— nothing on your old server changes.',
  'discovery.errorWithheld.cell': 'Stopped on an error',
  'discovery.errorWithheld':
    "The provider's message for a count that stopped is not shown: the person connected this account themselves, and it can name their files.",
  'discovery.colliding.pre.one': 'item already on your destination matches something in your source. We will',
  'discovery.colliding.pre.many': 'items already on your destination match something in your source. We will',
  'discovery.colliding.strong': "keep the destination's copy",
  'discovery.colliding.post': 'and not overwrite it. Anything else already there is left untouched.',
  'discovery.refusedNative.kind.document': 'Google Docs',
  'discovery.refusedNative.kind.spreadsheet': 'Google Sheets',
  'discovery.refusedNative.kind.presentation': 'Google Slides',
  'discovery.refusedNative.kind.drawing': 'Google Drawings',
  // A Dropbox migration's one kind (workplan 0150 T3 (d)): Paper docs and
  // templates alike, which the same setting decides.
  'discovery.refusedNative.kind.paper': 'Dropbox Paper docs',
  'discovery.refusedNative.kind.other': 'Google files',
  'discovery.refusedNative.strong': 'will not be copied',
  // Fifteen words, like every `discovery.*.post` beside it (0118). The whole
  // reasoning — the measurement, or that this policy exports nothing for the
  // kind — is in the connector's refusal, which the failures queue prints
  // verbatim. This line is the one an owner reads while the choice is open.
  //
  // REASON-NEUTRAL since the count stopped being instability-only: the same
  // sentence now covers a format that renders the kind unstably and a policy
  // that renders it not at all, and naming one of those would be wrong about
  // the other. What both readers need is identical — pick a format that
  // carries these, or decide to leave them.
  'discovery.refusedNative.post':
    "with this migration's export format. Choose one that covers them, or accept leaving them behind.",
  // The tick-box beside that sentence. Named counts, never "some files": a
  // person who reads "3 items" goes hunting through their Drive.
  'confirm.refusedAck': 'I understand that {kinds} ({n} files) will not be copied.',
  // The Deletions page's two switches (workplan 0156 T6). They shared a verb,
  // "applying", and the owner read "Applying deletions is ON" as deletions
  // happening by themselves. The first only lets the delete buttons work, one
  // item at a time; the second removes moved files' old copies unattended.
  // So the first says BY HAND and the second AUTOMATIC, and neither borrows
  // the other's words.
  'applyFlag.readFailed': 'Could not read whether deleting by hand is on:',
  'applyFlag.on': 'Deleting by hand is ON for this migration.',
  'applyFlag.off': 'Deleting by hand is OFF for this migration (the default).',
  'applyFlag.onMeans': 'Nothing is removed until you press a delete button on an item.',
  'applyFlag.turnOff': 'Turn off',
  'applyFlag.refusesUntilOn':
    'The server refuses every delete button on this screen until it is turned on.',
  'applyFlag.config.pre': "On this appliance the value lives in the mapping's config file",
  'applyFlag.config.post': '; edit the file and restart to change it.',
  'applyFlag.turnOn': 'Turn on deleting by hand',
  'applyFlag.turnOnArmed': 'Confirm: turn on deleting by hand',
  'autoApply.on': "Automatic removal of moved files' old copies is ON for this migration.",
  'autoApply.off': "Automatic removal of moved files' old copies is OFF for this migration (the default).",
  // Stored ON while deleting by hand is off, which only the appliance's file
  // can say (the managed switch turns both off): it waits, and does nothing.
  'autoApply.onButWaiting':
    "Automatic removal of moved files' old copies is set ON, and does nothing while deleting by hand is off.",
  'autoApply.hint': 'It runs without you: old copies of moved files only, never deletions.',
  'autoApply.why':
    'Only where the same bytes are confirmed present under the new name, the pairing is unique, the report survived a full pass, and no mass event is suspected. Everything it refuses stays on the Moves screen for you. Deletions are never removed automatically.',
  'autoApply.turnOn': 'Turn on automatic removal',
  'autoApply.turnOnArmed': 'Confirm: remove old copies unattended',
  'autoApply.turnOff': 'Turn off automatic removal',
  'confirm.nextSteps': 'Next, in cutover order:',
  'confirm.title': 'Review & confirm your migration',
  'confirm.intro': 'Nothing has been copied yet. Review what will migrate, then start it.',
  'confirm.readError': 'Could not read the migrations.',
  'confirm.noMappings': 'No mappings configured.',
  'confirm.noMappings.how': 'The appliance reads mappings from JSON files in its config directory.',
  'confirm.noMappings.more':
    'On Docker that is the mounted config folder; on Windows C:\\ProgramData\\Ownpace\\config. Copy mapping.json.example, fill in your source and target, reference secrets by environment-variable name, and restart the appliance: it reads the directory once at start. The full walkthrough is docs/selfhost-quickstart.md, step 3.',
  'confirm.start': 'Start migration',
  'confirm.startError': 'Could not start it:',
  'confirm.startErrorFallback': 'the request failed',
  // The count this screen starts by itself, refused (0132 T6 (b)): the
  // server's sentence follows, verbatim. While the hold that refused it is
  // still on, the second line says the screen asks again when it lifts, which
  // it does (`ConfirmMigration.tsx`); nothing else here is there to press.
  'confirm.countError': 'Counting did not start:',
  'confirm.countAgain': 'This screen counts again by itself once copying resumes.',
  // Start waits for the count it would be pressed on, fifteen minutes at most
  // (the owner, 2026-09-28), and then opens without it, saying so
  // (`ConfirmMigration.tsx`, `stillCounting`).
  'confirm.startWaits': 'You can start once the count is in, or after 15 minutes at most.',
  'confirm.countUnfinished':
    'The count did not finish within 15 minutes. You can start anyway: anything that cannot be copied is listed on the migration’s page once it is found.',
  // The manifest that could not be read (0153 T1 (a)): the reason follows,
  // verbatim, so this is the frame and not the finding.
  'confirm.manifestError': 'The list of what migrates could not be read:',
  'confirm.openConsole': 'Open the migration console',
  'confirm.whatMigrates': 'What migrates',
  'confirm.note.active': 'Active. It syncs on its schedule and reports anything that needs you.',
  'confirm.note.cutover': 'In cutover.',
  'confirm.note.done': 'Finished. This migration no longer syncs.',
  'confirm.note.continuous': 'Continuous. Cutover has happened; this keeps copying instead of ending.',
  'confirm.introStarted':
    'Migrations have started. Live progress is per migration; the scan stays as a snapshot.',
  'confirm.progress.heading': 'Live progress',
  // OF ABOUT HOW MANY (0154 T2): what arrived, set against what discovery
  // found. *About* is literal: discovery is a snapshot, and the source keeps
  // changing. One sentence for the items and for the bytes (*"3.1 of
  // ~3.4 GB"*).
  'confirm.progress.ofAbout': '{done} of ~{total}',
  // Discovery has no count of this data type: the copies stand alone, and the
  // row says so rather than *"of 0"* (hard rule 9).
  'confirm.progress.totalNotKnown': '{done} copied · total not known',
  // Discovery counted none, and none arrived: a real answer, not a gap.
  'confirm.progress.noneFound': 'none found to copy',
  'confirm.progress.failed': 'failed',
  'confirm.progress.retrying': 'retrying',
  // LEFT ALONE IS NOT COPIED (0124 T2). Two different rows wear the ledger's
  // `adopted` status — an item the target already held, and one we wrote that
  // the customer has since edited — and the ledger cannot tell them apart after
  // the fact. One sentence true of both; inventing the split would be a worse
  // lie than the silence this replaces. Its meaning is on screen since 0154 T2,
  // where it lived only in a tooltip; the longer reassurance stays there.
  'confirm.progress.leftAsIs': '{count} left as they are: already on the new system, or changed there since',
  'confirm.progress.leftAsIs.why':
    'These were already on the new system, or have been changed there since, so they were left as they are. Nothing was copied over them and nothing was lost: this tool never overwrites what it did not write. They are counted here rather than among the copies because nothing happened to them.',
  // When a pass last touched this data type — NOT when it last finished.
  // A first copy that runs for two days used to show no time at all, because
  // every time on these screens came from a completion. A migration that is
  // working must never look like one that has died.
  'confirm.progress.lastActive': 'last active',
  // A data type switched off after copying (0125 T7). Said, because silence
  // is what was wrong: its copies stopped following the source without a word.
  'confirm.progress.stopped': 'Switched off: these copies stay, but no longer follow the source.',
  'confirm.progress.stopped.why':
    'Nothing was removed. What was migrated and their records stay where they are, as they were when it stopped. Switching it back on continues where it stopped: new items are copied, edits are picked up, and deletions at the source are reported.',
  // One its owner stopped (0128 T4): the same state, and Resume is the way back.
  'confirm.progress.stoppedByYou': 'Stopped by you: these copies stay, but no longer follow the source until resumed.',
  'confirm.progress.stoppedByYou.why':
    'Nothing was removed. The copies and their record stay as they were when you stopped it. Resuming it, on the migration\'s page, continues where it stopped: new items are copied, edits are picked up, and deletions at the source are reported.',
  'confirm.snapshot.heading': 'Pre-start scan (snapshot)',
  'confirm.snapshot.more':
    'Counted once before the start, to show what would migrate. The source keeps changing afterwards and these numbers do not update; live progress above is the ledger speaking.',
  'confirm.state.pending': 'Pending',
  'confirm.state.in_progress': 'Syncing',
  'confirm.state.completed': 'Completed',
  'confirm.state.failed': 'Failed',
  'confirm.state.skipped': 'Skipped',
  'confirm.state.stopped': 'Stopped',
  'confirm.foundInSource': 'What we found in your source',
  'confirm.starting': 'Starting…',
  'decisions.presets.heading': 'Standing answers',
  'decisions.presets.intro':
    'Categories set to answer themselves are still recorded here, but need nothing from you.',
  'decisions.presets.intro.more': 'You can see what was noticed and what closed it.',
  'decisions.presets.newMailbox': 'When a mailbox appears that nothing migrates',
  'decisions.presets.ask': 'Ask me',
  'decisions.presets.auto': 'Answer automatically',
  'decisions.presets.saved': 'Saved.',
  'decisions.presets.readError':
    'Could not read the standing answers; some categories may be answered without showing which.',
  'decisions.presets.readOnly': 'An owner or admin sets these.',
  // The permission handover, on Finish (workplan 0029 T4, SAD §14.2).
  'permissions.heading': 'Carry the permissions across before you move delivery',
  'permissions.body':
    'Sharing rights do not move with the mail; work the list before delivery moves.',
  'permissions.body.more':
    'Who could see whose calendar, who had access to which shared files: none of that migrated. Get the list, work through it on the new system, and do it before delivery moves; rights added afterwards were missing for however long that took. The list starts with naming what it could not read.',
  // In step with the managed report's own sentence for the second blind spot
  // (`DRIVE_SHARING_NOT_INVENTORIED_FOR_A_TESTER` in connectors, the owner,
  // 2026-10-14): a permission that reaches every file in the organisation,
  // not asked for, so note the sharing by hand. Said for both editions, since
  // the appliance's owner may grant it: "only if".
  'permissions.blindSpot':
    "Two blind spots: who could open or send from someone else's mailbox, and sharing on OneDrive and SharePoint.",
  'permissions.blindSpot.more':
    "Who had full access to someone else's mailbox or could send as it: Microsoft does not give us that to migrate, so you set it up again yourself on the new system. Sharing on OneDrive and SharePoint is read only if Ownpace was given an extra permission that reaches every file in your organisation, and Ownpace does not ask for it. Where it was not read, note your file and folder sharing by hand before you switch over. The document says which of the two it actually read, and how to cover the rest.",
  // A Microsoft account connected with one person's own sign-in (the `microsoft`
  // kind, as an Outlook.com account is connected; the owner, 2026-10-16). The
  // two lines above are an organisation's: someone else's mailbox, and every
  // file in the organisation. This one is true of a personal and a work or
  // school account alike, in step with the report's `microsoftAccount…NotRead`.
  'permissions.blindSpot.microsoftAccount':
    'Three blind spots: who else could open or send from this mailbox, calendar sharing, and OneDrive sharing.',
  'permissions.blindSpot.microsoftAccount.more':
    "Ownpace does not read who you gave access to in a Microsoft account connected with your own sign-in. Note who could open your mailbox or send from it, and who you shared calendars, files and folders with, from Outlook's and OneDrive's settings before you switch over. The document lists the same three.",
  // The same line for a Google source: Drive sharing IS read, so the two
  // blind spots are the mailbox's and the calendar's.
  'permissions.blindSpot.google':
    'Two blind spots: Gmail delegation and send-as, and Google Calendar sharing.',
  'permissions.blindSpot.google.more':
    'Who could read or send from someone’s Gmail, and who could see whose calendar: this tool does not read either from Google yet, so note them yourself in the Gmail and Google Calendar settings. Sharing on Google Drive is read, and is in the list.',
  'permissions.download': 'Get the permission list',
  'permissions.failed': 'The permission list could not be fetched.',
  // Shared addresses, on Review & confirm (workplan 0027 T4).
  'sharedAddresses.heading': 'Shared addresses found',
  'sharedAddresses.pattern.shared_s': 'Shared mailbox — the store is copied',
  'sharedAddresses.pattern.distribution_d': 'Distribution list — the members are recreated',
  'sharedAddresses.pattern.unknown': 'Which kind? Waiting on you',
  'sharedAddresses.members': 'members',
  // Not "0 members": the list could not be read, and recreating a group from
  // an unread list would produce an empty one on the target.
  'sharedAddresses.membersUnknown': 'members could not be read',
  'sharedAddresses.empty': 'Nothing listed; this source may not be able to list groups at all.',
  'sharedAddresses.empty.why':
    'An IMAP source cannot list groups at all, and a Microsoft 365 source needs application permissions before it can. Shared addresses can also be added by hand.',
  'sharedAddresses.readError': 'Could not read the discovered shared addresses.',
  // Pattern D recreation is entirely manual: no target platform this tool
  // supports exposes an interface for creating a mail group.
  'sharedAddresses.runbook.intro':
    'Distribution lists are recreated on the target by hand; no target offers a way.',
  'sharedAddresses.runbook.download': 'Get the step-by-step list',
  'sharedAddresses.runbook.failed': 'The steps could not be fetched.',
  'decisions.title': 'Needs you',
  'decisions.waiting': 'Needs a decision',
  'decisions.intro':
    'Changes the sync noticed that only you can decide about. Nothing happens until you answer.',
  'decisions.readError': 'Could not read what is waiting on you.',
  'decisions.dismiss': 'Dismiss',
  // The two named answers to §14.1's question. This category has no proposed
  // default on purpose — not knowing which of the two it is is the whole
  // reason it is being asked — so the answers are buttons rather than an
  // accept. Kept short: the question itself is in the summary above them.
  'decisions.sharedAddress.shared_s': 'One shared mailbox',
  'decisions.sharedAddress.distribution_d': 'A distribution list',
  'decisions.empty.noDetectors':
    'Nothing waiting; watchers run once a day, reporting an unreadable source as a blind spot.',
  'decisions.empty.answered': 'Nothing has been decided yet.',
  'decisionCategory.new_mailbox': 'New mailbox',
  'decisionCategory.deleted_mailbox': 'Deleted mailbox',
  'decisionCategory.quota': 'Quota',
  'decisionCategory.shared_address_pattern': 'Shared address',
  'decisionCategory.offboarding': 'Offboarding',
  'decisionCategory.alias_removed': 'Alias removed',
  'decisionCategory.new_domain': 'New domain',
  'decisionCategory.rules_detected': 'Rules detected',
  'decisionCategory.target_drift': 'Target drift',
  'decisionCategory.other': 'Other',
  'decisions.answeredBy': 'by',
  'decisions.answer': 'Answer:',
  'decisions.detailToggle': 'Details',
  'decisionStatus.resolved': 'Decided',
  'decisionStatus.auto_resolved': 'Decided by preset',
  'decisionStatus.dismissed': 'Dismissed',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'confirm.progress.lastSynced': 'laatst gesynchroniseerd',
  'discovery.scanning': 'Uw bron wordt gescand (alleen-lezen)…',
  'discovery.stillCounting': 'Nog aan het inventariseren: {domains}. Deze pagina werkt zichzelf bij.',
  'discovery.stillCounting.slow':
    'Nog aan het inventariseren: {domains}. Dit duurt langer dan normaal; herlaad de pagina om bij te werken.',
  'discovery.countedEarlier':
    'Cijfers voor {domains} komen van een eerdere inventarisatie, de laatste poging mislukte.',
  'discovery.th.type': 'Type',
  'discovery.th.collections': 'Collecties',
  'discovery.th.items': 'Items',
  'discovery.th.size': 'Grootte',
  'discovery.th.existing': 'Al op de bestemming',
  'discovery.keptAsIs': 'blijven ongewijzigd',
  'discovery.generatedId.pre.one':
    'bericht kwam aan zonder Message-ID; we genereren er een en voegen die toe aan',
  'discovery.generatedId.pre.many':
    'berichten kwamen aan zonder Message-ID; we genereren er een en voegen die toe aan',
  'discovery.generatedId.strong': 'de kopie op uw nieuwe server',
  'discovery.generatedId.post':
    '— het origineel op uw oude server verandert niet; ze migreren met de rest mee.',
  'discovery.unlisted.pre.one': 'bericht heeft geen Message-ID, en deze verbinding kan het er geen geven, dus het',
  'discovery.unlisted.pre.many': 'berichten hebben geen Message-ID, en deze verbinding kan ze er geen geven, dus ze',
  'discovery.unlisted.strong.one': 'wordt niet gemigreerd',
  'discovery.unlisted.strong.many': 'worden niet gemigreerd',
  'discovery.unlisted.post': '— er verandert niets op uw oude server.',
  'discovery.errorWithheld.cell': 'Gestopt op een fout',
  'discovery.errorWithheld':
    'De melding van de aanbieder bij een inventarisatie die stopte, wordt niet getoond: de persoon heeft dit account zelf gekoppeld, en de melding kan hun bestanden vermelden.',
  'discovery.colliding.pre.one': 'item dat al op uw bestemming staat, komt overeen met iets in uw bron. We',
  'discovery.colliding.pre.many': 'items die al op uw bestemming staan, komen overeen met iets in uw bron. We',
  'discovery.colliding.strong': 'behouden de kopie op de bestemming',
  'discovery.colliding.post': 'en overschrijven die niet. Al het andere dat er al staat, blijft ongemoeid.',
  'discovery.refusedNative.kind.document': 'Google Documenten',
  'discovery.refusedNative.kind.spreadsheet': 'Google Spreadsheets',
  'discovery.refusedNative.kind.presentation': 'Google Presentaties',
  'discovery.refusedNative.kind.drawing': 'Google Tekeningen',
  'discovery.refusedNative.kind.paper': 'Dropbox Paper-documenten',
  'discovery.refusedNative.kind.other': 'Google-bestanden',
  'discovery.refusedNative.strong': 'worden niet gemigreerd',
  'discovery.refusedNative.post':
    'met dit exportformaat. Kies er een die wel zou passen, of laat ze achter.',
  'confirm.refusedAck': 'Ik begrijp dat {kinds} ({n} bestanden) niet worden gemigreerd.',
  'applyFlag.readFailed': 'Kon niet lezen of Handmatig verwijderen aan staat:',
  'applyFlag.on': 'Handmatig verwijderen staat AAN voor deze migratie.',
  'applyFlag.off': 'Handmatig verwijderen staat UIT voor deze migratie (de standaard).',
  'applyFlag.onMeans': 'Er wordt niets verwijderd totdat u bij een item op een verwijderknop drukt.',
  'applyFlag.turnOff': 'Uitschakelen',
  'applyFlag.refusesUntilOn':
    'De server weigert verwijderingen op dit scherm, totdat dit is ingeschakeld.',
  'applyFlag.config.pre': 'Op deze appliance staat de waarde in het configuratiebestand van de mapping',
  'applyFlag.config.post': '; bewerk het bestand en herstart om dit te wijzigen.',
  'applyFlag.turnOn': 'Handmatig verwijderen inschakelen',
  'applyFlag.turnOnArmed': 'Bevestig: handmatig verwijderen inschakelen',
  'autoApply.on':
    'Automatisch verwijderen van oude kopieën van inmiddels verplaatste bestanden staat AAN voor deze migratie.',
  'autoApply.off':
    'Automatisch verwijderen van oude kopieën van inmiddels verplaatste bestanden staat UIT voor deze migratie (de standaard).',
  'autoApply.onButWaiting':
    'Automatisch verwijderen van oude kopieën van inmiddels verplaatste bestanden staat AAN, en doet niets zolang handmatig verwijderen uit staat.',
  'autoApply.hint':
    'Werkt automatisch: alleen oude kopieën van inmiddels verplaatste bestanden, nooit verwijderingen.',
  'autoApply.why':
    'Alleen wanneer dezelfde bytes aantoonbaar onder de nieuwe naam aanwezig zijn, de koppeling uniek is, de melding een volledige ronde heeft doorstaan en er geen onevenredige bulkgebeurtenis optreedt. Alles wat wordt geweigerd, blijft op het scherm Verplaatsingen staan, voor u om te beoordelen. Verwijderingen in de bron, worden nooit automatisch verwijderd in waar u heen gaat.',
  'autoApply.turnOn': 'Automatisch verwijderen inschakelen',
  'autoApply.turnOnArmed': 'Bevestig: oude kopieën onbeheerd verwijderen',
  'autoApply.turnOff': 'Automatisch verwijderen uitschakelen',
  'confirm.nextSteps': 'Hierna, in volgorde nodig voor de overstap:',
  'confirm.title': 'Controleer en bevestig uw migratie',
  'confirm.intro': 'Er is nog niets gemigreerd. Controleer wat er migreert en start het daarna.',
  'confirm.readError': 'De migraties konden niet worden gelezen.',
  'confirm.noMappings': 'Geen migraties geconfigureerd.',
  'confirm.noMappings.how':
    'De appliance leest migraties als JSON-bestanden uit de configuratiemap.',
  'confirm.noMappings.more':
    'Op Docker is dat de gekoppelde config-map; op Windows C:\\ProgramData\\Ownpace\\config. Kopieer mapping.json.example, vul uw bron en doel in, verwijs naar geheimen via de naam van een omgevingsvariabele en herstart de appliance: de map wordt eenmalig bij het starten gelezen. De volledige uitleg staat in docs/selfhost-quickstart.md, stap 3.',
  'confirm.start': 'Start migratie',
  'confirm.startError': 'Kon niet starten:',
  'confirm.startErrorFallback': 'het verzoek is mislukt',
  'confirm.countError': 'Het inventariseren is niet gestart:',
  'confirm.countAgain': 'Dit scherm gaat vanzelf verder zodra een migratie weer begint.',
  'confirm.startWaits': 'U kunt starten zodra de inventarisatie binnen is, of uiterlijk na 15 minuten.',
  'confirm.countUnfinished':
    'De inventarisatie was na 15 minuten niet klaar. U kunt toch starten: wat niet gemigreerd kan worden, staat op de pagina van de migratie zodra het gevonden is.',
  'confirm.manifestError': 'De lijst van wat er migreert kon niet worden gelezen:',
  'confirm.openConsole': 'Open de migratieconsole',
  'confirm.whatMigrates': 'Wat migreert er',
  'confirm.note.active': 'Actief. Er wordt gesynchroniseerd volgens schema en wat uw aandacht nodig heeft wordt gemeld.',
  'confirm.note.cutover': 'In overstap.',
  'confirm.note.done': 'Afgerond. Deze migratie synchroniseert niet meer.',
  'confirm.note.continuous':
    'Doorlopend. De overstap is gemaakt, maar we blijven synchroniseren.',
  'confirm.introStarted':
    'Migraties hier zijn gestart. Live voortgang staat per migratie; de telling blijft als momentopname.',
  'confirm.progress.heading': 'Live voortgang',
  'confirm.progress.ofAbout': '{done} van ~{total}',
  'confirm.progress.totalNotKnown': '{done} gemigreerd · totaal niet bekend',
  'confirm.progress.noneFound': 'niets gevonden om te migreren',
  'confirm.progress.failed': 'mislukt',
  'confirm.progress.retrying': 'in nieuwe poging',
  'confirm.progress.leftAsIs': '{count} ongemoeid gelaten: deze stonden al op het nieuwe systeem, of waren sindsdien gewijzigd',
  'confirm.progress.leftAsIs.why':
    'Deze stonden al op het nieuwe systeem, of waren sindsdien gewijzigd, en zijn daarom met rust gelaten. Ze zijn niet overschreven en er is niets verloren gegaan.',
  'confirm.progress.lastActive': 'laatst actief',
  'confirm.progress.stopped': 'Uitgeschakeld: deze kopieën blijven, maar blijven niet langer in sync met de bron.',
  'confirm.progress.stopped.why':
    'Er is niets verwijderd. De kopieën en hun migratie-administratie blijven zoals toen het stopte. Bij inschakelen worden nieuwe items weer gemigreerd, wijzigingen opgepakt en verwijderingen in de bron gemeld.',
  'confirm.progress.stoppedByYou': 'Door u gestopt: deze kopieën blijven, maar volgen de bron pas weer na hervatten.',
  'confirm.progress.stoppedByYou.why':
    'Er is niets verwijderd. De kopieën en hun migratie-administratie blijven zoals ze waren toen u het stopte. Hervatten, op de pagina van de migratie, gaat verder waar het stopte: nieuwe items worden gemigreerd, wijzigingen opgepakt en verwijderingen in de bron gemeld.',
  'confirm.snapshot.heading': 'Scan van voor de start (momentopname)',
  'confirm.snapshot.more':
    'Een eenmalige inventarisatie, vóór u start, zodat helder is wat we gaan migreren. U kunt gewoon blijven werken in de bron. Deze aantallen wijzigen verder niet en de echte live voortgang hierboven komt uit de migratie-administratie.',
  'confirm.state.pending': 'In afwachting',
  'confirm.state.in_progress': 'Synchroniseert',
  'confirm.state.completed': 'Voltooid',
  'confirm.state.failed': 'Mislukt',
  'confirm.state.skipped': 'Overgeslagen',
  'confirm.state.stopped': 'Gestopt',
  'confirm.foundInSource': 'Wat we in uw bron hebben gevonden',
  'confirm.starting': 'Bezig met starten…',
  'decisions.presets.heading': 'Vaste antwoorden',
  'decisions.presets.intro':
    'Categorieën die vanzelf worden opgelost via uw eerdere beslissingen, worden hier nog vastgelegd.',
  'decisions.presets.intro.more': 'U ziet wat is opgemerkt en waardoor het is afgesloten.',
  'decisions.presets.newMailbox': 'Als er een postvak verschijnt waarvoor niets migreert',
  'decisions.presets.ask': 'Vraag het mij',
  'decisions.presets.auto': 'Automatisch beantwoorden',
  'decisions.presets.saved': 'Opgeslagen.',
  'decisions.presets.readError':
    'De vaste antwoorden zijn niet gelezen; sommige categorieën worden mogelijk beantwoord zonder te tonen welke.',
  'decisions.presets.readOnly': 'Een eigenaar of beheerder stelt dit in.',
  'permissions.heading': 'Zet de rechten over voordat u de e-mailbezorging omzet',
  'permissions.body':
    'Deelrechten worden niet gemigreerd met e-mail; werk de lijst door vóór het omzetten.',
  'permissions.body.more':
    'Wie wiens agenda kon zien, wie toegang had tot welke gedeelde bestanden: dat gaat niet mee. Haal de lijst op, werk hem door op het nieuwe systeem, en doe dat vóór het omzetten van de bezorging; rechten die daarna worden toegevoegd ontbreken. De lijst heeft bovenaan staan wat niet kon worden geraadpleegd.',
  'permissions.blindSpot':
    'Twee blinde vlekken: wie het postvak van een ander kon openen of eruit kon verzenden, en delen op OneDrive en SharePoint.',
  'permissions.blindSpot.more':
    'Wie volledige toegang tot een (ander) postvak had of uit die naam kon verzenden: Microsoft geeft deze info niet aan Ownpace, dat moet u zelf overzetten. Delen op OneDrive en SharePoint wordt alleen gelezen als Ownpace een extra toestemming kreeg die bij elk bestand in uw organisatie kan, en Ownpace vraagt daar niet om. Is het niet gelezen, noteer dan zelf hoe uw bestanden en mappen gedeeld zijn voordat u overstapt. Het document zegt welke wel te lezen waren, en hoe u de rest overzet.',
  'permissions.blindSpot.microsoftAccount':
    'Drie blinde vlekken: wie dit postvak nog meer kon openen of eruit kon verzenden, delen van agenda’s, en delen op OneDrive.',
  'permissions.blindSpot.microsoftAccount.more':
    'Bij een Microsoft-account dat met uw eigen aanmelding is gekoppeld, leest Ownpace niet aan wie u toegang gaf. Noteer vanuit de instellingen van Outlook en OneDrive wie uw postvak kon openen of eruit kon verzenden, en met wie u agenda’s, bestanden en mappen deelde, voordat u overstapt. Het document noemt dezelfde drie.',
  'permissions.blindSpot.google':
    'Twee blinde vlekken: Gmail-gemachtigden en verzenden-als, en delen in Google Agenda.',
  'permissions.blindSpot.google.more':
    'Wie iemand anders Gmail kon lezen of uit die mailbox kon verzenden, en wie wiens agenda kon zien: dit hulpmiddel leest geen van beide uit bij Google, dus noteer zelf deze instellingen en zet die over. Delen op Google Drive wordt wel gelezen en staan in de lijst.',
  'permissions.download': 'Haal de rechtenlijst op',
  'permissions.failed': 'De rechtenlijst kon niet worden opgehaald.',
  'sharedAddresses.heading': 'Gevonden gedeelde adressen',
  'sharedAddresses.pattern.shared_s': 'Gedeeld postvak — het postvak wordt gemigreerd',
  'sharedAddresses.pattern.distribution_d': 'Distributielijst — de leden worden opnieuw aangemaakt',
  'sharedAddresses.pattern.unknown': 'Welke soort? Wacht op u',
  'sharedAddresses.members': 'leden',
  'sharedAddresses.membersUnknown': 'leden konden niet worden gelezen',
  'sharedAddresses.empty':
    'Niets gevonden; deze bron kan groepen misschien helemaal niet opsommen.',
  'sharedAddresses.empty.why':
    'Een IMAP-bron kan groepen helemaal niet opsommen, en een Microsoft 365-bron heeft daarvoor toepassingsmachtigingen nodig. Gedeelde adressen kunnen ook met de hand worden toegevoegd.',
  'sharedAddresses.readError': 'De gevonden gedeelde adressen konden niet worden gelezen.',
  'sharedAddresses.runbook.intro':
    'Distributielijsten maakt u met de hand opnieuw aan; geen bestemming doet dat voor u.',
  'sharedAddresses.runbook.download': 'Haal de stappenlijst op',
  'sharedAddresses.runbook.failed': 'De stappen konden niet worden opgehaald.',
  'decisions.title': 'Wacht op u',
  'decisions.waiting': 'Vraagt om een beslissing',
  'decisions.intro':
    'Veranderingen die de synchronisatie opmerkte en waarover alleen u beslist; niets gebeurt tot u antwoordt.',
  'decisions.readError': 'Kon niet lezen wat op u wacht.',
  'decisions.dismiss': 'Terzijde leggen',
  'decisions.sharedAddress.shared_s': 'Eén gedeeld postvak',
  'decisions.sharedAddress.distribution_d': 'Een distributielijst',
  'decisions.empty.noDetectors':
    'Niets wacht; detectie wordt eenmaal per dag uitgevoerd en meldt een onleesbare bron als blinde vlek.',
  'decisions.empty.answered': 'Er is nog niets besloten.',
  'decisionCategory.new_mailbox': 'Nieuw postvak',
  'decisionCategory.deleted_mailbox': 'Verwijderd postvak',
  'decisionCategory.quota': 'Quotum',
  'decisionCategory.shared_address_pattern': 'Gedeeld adres',
  'decisionCategory.offboarding': 'Vertrek',
  'decisionCategory.alias_removed': 'Alias verwijderd',
  'decisionCategory.new_domain': 'Nieuw domein',
  'decisionCategory.rules_detected': 'Regels gedetecteerd',
  'decisionCategory.target_drift': 'Afwijking op het doel',
  'decisionCategory.other': 'Overig',
  'decisions.answeredBy': 'door',
  'decisions.answer': 'Antwoord:',
  'decisions.detailToggle': 'Details',
  'decisionStatus.resolved': 'Besloten',
  'decisionStatus.auto_resolved': 'Besloten via vast antwoord',
  'decisionStatus.dismissed': 'Terzijde gelegd',
};

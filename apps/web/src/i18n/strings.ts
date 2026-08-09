// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
  'runs.title': 'Run history',
  'runs.blurb':
    'Every sync pass this migration has made, newest first, with what each one said.',
  'runs.empty': 'No passes have run yet. History appears after the first sync.',
  'runs.error': "Could not read this migration's run history.",
  'runs.items': 'Items',
  'runs.errors': 'Errors',
  'runs.events': 'Log',
  'runs.status.pending': 'Pending',
  'runs.status.running': 'Running',
  'runs.status.success': 'Succeeded',
  'runs.status.failed': 'Failed',
  'runs.status.cancelled': 'Cancelled',
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
  'deletions.title': 'Deleted on the old system',
  'deletions.intro':
    'Items the owner has deleted where they came from, which the new system still has. Nothing has been removed from either side.',
  'deletions.empty.confirmed': 'Nothing is waiting on a decision.',
  'deletions.watching': 'Watching',
  'deletions.empty.watching': 'Nothing is being watched.',
  'deletions.empty.acknowledged': 'Nothing has been decided yet.',
  'deletions.keep': 'Keep our copy',
  'deletions.apply': 'Delete it here too',
  'deletions.applyArmed': 'Confirm delete',
  'deletions.requestFailed': 'The request did not complete.',
  'common.loading': 'Loading…',
  'mappings.lastSync': 'Last sync:',
  'mappings.never': 'Never',
  'confirm.title': 'Review & confirm your migration',
  'confirm.intro': 'Nothing has been copied yet. Review what will migrate, then start it.',
  'confirm.readError': 'Could not read the migrations.',
  'confirm.noMappings': 'No mappings configured.',
  'confirm.start': 'Start migration',
  'confirm.startError': 'Could not start it:',
  'confirm.startErrorFallback': 'the request failed',
  'confirm.openConsole': 'Open the migration console',
  'confirm.whatMigrates': 'What migrates',
  'confirm.note.active': 'Running. It syncs on its schedule and reports anything that needs you.',
  'confirm.note.cutover': 'In cutover.',
  'confirm.note.done': 'Finished. This migration no longer syncs.',
  'verify.title': 'Check the migration',
  'verify.intro':
    'Compares what the old system has against what the new one has, and samples the contents to confirm they match. Read-only — it never writes to either side.',
  'verify.run': 'Run the check',
  'verify.runAgain': 'Check again',
  'verify.durationHint': 'Reads the whole destination — on a large mailbox this takes minutes.',
  'verify.runningSince': 'Running since',
  'verify.didNotComplete': 'The check did not complete.',
  'verify.notAResult':
    "Nothing is known about the migration's completeness either way — this is not a result.",
  'verify.restarted': 'The appliance restarted while the check ran. Run it again.',
  'verify.didNotStart': 'The check did not start.',
  'verify.ready': 'This migration is ready to cut over.',
  'verify.notReady': 'Not ready to cut over. See the domains and issues below.',
  'verify.score': 'score',
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
  'verify.notMeasured.title':
    'The target exposes no per-item size, so nothing was measured on that side. Not the same as a match.',
  'verify.issues': 'Issues',
  'verify.whatToDo': 'What to do',
  'verify.help.PASS': 'Counts matched and the sampled content compared clean.',
  'verify.help.WARN': 'Discrepancies within tolerance. Read the issues before proceeding.',
  'verify.help.FAIL': 'Items are missing on the target, or sampled content did not match.',
  'verify.help.SKIPPED':
    'You turned this domain off in the config. Your call, so it does not block cutover — but nobody checked it.',
  'verify.help.NOT_VERIFIABLE':
    'This domain IS enabled, but there is no way to read the target for it, so nothing could be checked. This blocks cutover — an unchecked domain has not passed.',
  'finish.title': 'Finish a migration',
  'finish.intro':
    'Finishing stops the copying and the reporting. Work through the steps in order — the last one is the only one that cannot be undone by simply carrying on.',
  'finish.unknown.pre': 'No migration with id',
  'finish.unknown.post':
    'answered. Check the address — this is not the same as a migration with nothing to finish.',
  'finish.readError.one': 'Could not read the migration.',
  'finish.readError.many': 'Could not read the migrations.',
  'finish.note.paused':
    'Never started, so there is nothing to finish. Remove it from the config directory to retire it.',
  'finish.note.active':
    'Syncing on a schedule. Items still arriving on the old system are being copied across.',
  'finish.note.cutover': 'In cutover. Still syncing until you finish it.',
  'finish.note.done':
    'Finished. This mapping no longer syncs and nothing is being reported for it.',
  'finish.left.one': 'item left unmigrated.',
  'finish.left.many': 'items left unmigrated.',
  'finish.step1.title': 'Check the copy is complete',
  'finish.step1.pre': 'Compare the two systems and sample the contents.',
  'finish.step1.link': 'Run the check',
  'finish.step1.post': '. Reads the whole destination, so it takes minutes on a large mailbox.',
  'finish.step2.title': 'Clear the decision queues',
  'finish.step2.reading': 'Reading…',
  'finish.step2.clear': 'Nothing is waiting on you.',
  'finish.step2.failures': 'could not be copied',
  'finish.step2.deletions': 'deleted on the old system',
  'finish.step2.moves': 'moved',
  'finish.step2.onlyFirstBlocks':
    '. Only the first of these blocks finishing — the other two are already answered by the new system keeping its copy.',
  'finish.step3.title': 'Run one final pass',
  'finish.step3.body': 'So the new system reflects the old one as of right now.',
  'finish.step3.run': 'Run a pass now',
  'finish.step3.runAgain': 'Run another',
  'finish.step3.finished': 'The pass has run and finished.',
  'finish.step3.queued':
    'Queued. The pass runs as a job and lands in the run history — give it a moment, then re-check the queues above.',
  'finish.step3.failed': 'The pass request failed — nothing ran. Try again.',
  'finish.step4.title': 'Move delivery to the new system',
  'finish.step4.body':
    'Change MX/DNS and reconfigure clients so new mail arrives on the new system. This happens outside this tool, so it is the one step here nobody can check for you.',
  'finish.step4.warn.pre': 'If you finish before this is done',
  'finish.step4.warn.post':
    ', anything that arrives on the old system afterwards will not be copied, and nothing will report it — the tool has stopped watching.',
  'finish.step4.checkbox': 'Delivery now goes to the new system.',
  'finish.step5.title': 'Finish',
  'finish.step5.nothingChanges.pre': 'Nothing is added to or removed from either system.',
  'finish.step5.nothingChanges.post':
    ' What is on the new system stays exactly as it is — this only stops the tool watching the old one.',
  'finish.forceButton': 'Finish anyway, leaving them behind',
  'finish.button': 'Finish this migration',
  'finish.button.disabledTitle':
    'Confirm step 4 first — finishing before delivery has moved loses anything that arrives afterwards.',
  'createMapping.target.userOperated':
    'The destination server is yours to run. We migrate your data into it — we do not ' +
    'operate, monitor or back it up, and it carries no service level from us (ADR-0011). ' +
    'If it is a managed European platform, its own provider is responsible for it.',
  'tenants.title': 'Team & organization',
  'tenants.intro':
    'Who can sign in to this organization, and what they are allowed to do. Changes apply immediately.',
  'tenants.noTenant': 'No organization in this session.',
  'tenants.requestFailed': 'The request did not complete.',
  'tenants.org.heading': 'Organization',
  'tenants.org.readError':
    "Could not read the organization's details — the member list below still works.",
  'tenants.org.rename': 'Rename',
  'tenants.org.renameSave': 'Save name',
  'tenants.org.renameCancel': 'Cancel',
  'tenants.members.heading': 'Members',
  'tenants.members.readError': 'Could not read the member list.',
  'tenants.members.empty': 'No members.',
  'tenants.members.you': 'you',
  'tenants.members.emailHeader': 'Email',
  'tenants.members.roleHeader': 'Role',
  'tenants.members.statusHeader': 'Status',
  'tenants.members.invitedHeader': 'Invited',
  'tenants.members.joinedHeader': 'Joined',
  'tenants.members.remove': 'Remove',
  'tenants.members.removeArmed': 'Confirm remove',
  'tenants.readOnly': 'Your role here is read-only. An owner or admin manages members.',
  'tenants.invite.heading': 'Invite someone',
  'tenants.invite.hint':
    'No email is sent yet — tell them yourself. The invitation appears below as "invited".',
  'tenants.invite.email': 'Email address',
  'tenants.invite.role': 'Role',
  'tenants.notify.heading': 'Email summaries',
  'tenants.notify.intro':
    'How often this organization is emailed a summary of what is waiting for a decision. ' +
    'A summary with nothing in it is never sent — silence means nothing is waiting.',
  'tenants.notify.cadence': 'Summary',
  'tenants.notify.daily': 'Daily',
  'tenants.notify.weekly': 'Weekly (Monday)',
  'tenants.notify.off': 'No summary',
  'tenants.notify.locale': 'Language',
  'tenants.notify.recipients':
    'Sent to every owner and admin below. Urgent events are emailed as they happen, whichever ' +
    'summary you choose here.',
  'tenants.notify.save': 'Save',
  'tenants.notify.saved': 'Saved.',
  'tenants.notify.readError':
    'Could not read the current setting — saving would overwrite something unknown, so the ' +
    'controls are disabled.',
  'tenants.invite.submit': 'Invite',
  'role.owner': 'Owner',
  'role.admin': 'Admin',
  'role.member': 'Member',
  'role.viewer': 'Viewer',
  'memberStatus.active': 'Active',
  'memberStatus.invited': 'Invited',
  'memberStatus.suspended': 'Suspended',
  'memberStatus.removed': 'Removed',
  'nav.decisions': 'Attention',
  'decisions.presets.heading': 'Standing answers',
  'decisions.presets.intro':
    'Categories set to answer themselves are still recorded here — you can see what was ' +
    'noticed and what closed it — but nobody is interrupted about them.',
  'decisions.presets.newMailbox': 'When a mailbox appears that nothing migrates',
  'decisions.presets.ask': 'Ask me',
  'decisions.presets.auto': 'Answer automatically',
  'decisions.presets.saved': 'Saved.',
  'decisions.presets.readError':
    'Could not read the standing answers, so this queue may be answering some categories ' +
    'without showing you which.',
  'decisions.presets.readOnly': 'An owner or admin sets these.',
  // The permission handover, on Finish (workplan 0029 T4, SAD §14.2).
  'permissions.heading': 'Carry the permissions across before you move delivery',
  'permissions.body':
    'Who could see whose calendar, who had access to which shared files — none of that moves ' +
    'with the mail. Get the list, work through it on the new system, and do it before delivery ' +
    'moves: rights added afterwards were missing for however long that took. The list names ' +
    'what it could not read, at the top.',
  'permissions.blindSpot':
    'Two things the list may not tell you. Who had FullAccess or Send-As on a mailbox: ' +
    'Microsoft does not expose that to us at all, so you have to read it out of Exchange ' +
    'yourself. And sharing on OneDrive and SharePoint, which is only included when this ' +
    'installation was given that extra permission. The document says which of the two it ' +
    'actually read, and how to cover the rest.',
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
  'sharedAddresses.empty':
    'Nothing found. This is not "your organisation has none" — an IMAP source cannot list groups ' +
    'at all, and a Microsoft 365 source needs application permissions before it can. Shared ' +
    'addresses can also be migrated by adding them by hand.',
  'sharedAddresses.readError': 'Could not read the discovered shared addresses.',
  // Pattern D recreation is entirely manual: no target platform this tool
  // supports exposes an interface for creating a mail group.
  'sharedAddresses.runbook.intro':
    'Distribution lists have to be recreated on the target by hand — no target platform here ' +
    'offers a way to do it for you.',
  'sharedAddresses.runbook.download': 'Get the step-by-step list',
  'sharedAddresses.runbook.failed': 'The steps could not be fetched.',
  'decisions.title': 'Needs a decision',
  'decisions.intro':
    'Changes the sync noticed that only you can decide about. Nothing happens until you answer.',
  'decisions.readError': 'Could not read the decision queue.',
  'decisions.requestFailed': 'The request did not complete.',
  'decisions.dismiss': 'Dismiss',
  // The two named answers to §14.1's question. This category has no proposed
  // default on purpose — not knowing which of the two it is is the whole
  // reason it is being asked — so the answers are buttons rather than an
  // accept. Kept short: the question itself is in the summary above them.
  'decisions.sharedAddress.shared_s': 'One shared mailbox',
  'decisions.sharedAddress.distribution_d': 'A distribution list',
  'decisions.empty.noDetectors':
    'Nothing is waiting. The watchers for new mailboxes and shared addresses run once a day; a ' +
    'source they could not read is reported as a blind spot rather than counted as "no changes".',
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
  'decisionStatus.resolved': 'Decided',
  'decisionStatus.auto_resolved': 'Decided by preset',
  'decisionStatus.dismissed': 'Dismissed',
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
  'runs.title': 'Uitvoeringsgeschiedenis',
  'runs.blurb':
    'Elke synchronisatieronde van deze migratie, nieuwste eerst, met wat elke ronde meldde.',
  'runs.empty': 'Er zijn nog geen rondes uitgevoerd. Geschiedenis verschijnt na de eerste synchronisatie.',
  'runs.error': 'Kon de uitvoeringsgeschiedenis van deze migratie niet lezen.',
  'runs.items': 'Items',
  'runs.errors': 'Fouten',
  'runs.events': 'Logboek',
  'runs.status.pending': 'In wachtrij',
  'runs.status.running': 'Wordt uitgevoerd',
  'runs.status.success': 'Geslaagd',
  'runs.status.failed': 'Mislukt',
  'runs.status.cancelled': 'Geannuleerd',
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
  'deletions.title': 'Verwijderd op het oude systeem',
  'deletions.intro':
    'Items die de eigenaar heeft verwijderd waar ze vandaan kwamen, maar die het nieuwe systeem nog heeft. Er is aan geen van beide kanten iets verwijderd.',
  'deletions.empty.confirmed': 'Er wacht niets op een beslissing.',
  'deletions.watching': 'Onder observatie',
  'deletions.empty.watching': 'Er wordt niets geobserveerd.',
  'deletions.empty.acknowledged': 'Er is nog niets besloten.',
  'deletions.keep': 'Behoud onze kopie',
  'deletions.apply': 'Verwijder het hier ook',
  'deletions.applyArmed': 'Bevestig verwijderen',
  'deletions.requestFailed': 'Het verzoek is niet voltooid.',
  'common.loading': 'Laden…',
  'mappings.lastSync': 'Laatste synchronisatie:',
  'mappings.never': 'Nooit',
  'confirm.title': 'Controleer en bevestig uw migratie',
  'confirm.intro': 'Er is nog niets gekopieerd. Controleer wat er migreert en start het daarna.',
  'confirm.readError': 'De migraties konden niet worden gelezen.',
  'confirm.noMappings': 'Geen koppelingen geconfigureerd.',
  'confirm.start': 'Start migratie',
  'confirm.startError': 'Kon niet starten:',
  'confirm.startErrorFallback': 'het verzoek is mislukt',
  'confirm.openConsole': 'Open de migratieconsole',
  'confirm.whatMigrates': 'Wat migreert er',
  'confirm.note.active': 'Actief. Het synchroniseert volgens schema en meldt alles wat uw aandacht nodig heeft.',
  'confirm.note.cutover': 'In cutover.',
  'confirm.note.done': 'Afgerond. Deze migratie synchroniseert niet meer.',
  'verify.title': 'Controleer de migratie',
  'verify.intro':
    'Vergelijkt wat het oude systeem heeft met wat het nieuwe heeft, en controleert steekproeven van de inhoud. Alleen-lezen — er wordt aan geen van beide kanten iets geschreven.',
  'verify.run': 'Voer de controle uit',
  'verify.runAgain': 'Controleer opnieuw',
  'verify.durationHint':
    'Leest de volledige bestemming — bij een grote mailbox duurt dit minuten.',
  'verify.runningSince': 'Bezig sinds',
  'verify.didNotComplete': 'De controle is niet voltooid.',
  'verify.notAResult':
    'Er is in geen van beide richtingen iets bekend over de volledigheid van de migratie — dit is geen resultaat.',
  'verify.restarted': 'De appliance is herstart terwijl de controle liep. Voer hem opnieuw uit.',
  'verify.didNotStart': 'De controle is niet gestart.',
  'verify.ready': 'Deze migratie is klaar voor cutover.',
  'verify.notReady': 'Nog niet klaar voor cutover. Zie de domeinen en problemen hieronder.',
  'verify.score': 'score',
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
  'verify.notMeasured.title':
    'Het doelsysteem geeft geen grootte per item, dus aan die kant is niets gemeten. Niet hetzelfde als een overeenkomst.',
  'verify.issues': 'Problemen',
  'verify.whatToDo': 'Wat te doen',
  'verify.help.PASS': 'De aantallen kwamen overeen en de gecontroleerde inhoud was gelijk.',
  'verify.help.WARN':
    'Afwijkingen binnen de tolerantie. Lees de problemen voordat u verdergaat.',
  'verify.help.FAIL':
    'Er ontbreken items op het doelsysteem, of gecontroleerde inhoud kwam niet overeen.',
  'verify.help.SKIPPED':
    'U heeft dit domein uitgeschakeld in de configuratie. Uw keuze, dus het blokkeert de cutover niet — maar niemand heeft het gecontroleerd.',
  'verify.help.NOT_VERIFIABLE':
    'Dit domein staat WEL aan, maar het doelsysteem kan er niet voor worden gelezen, dus er kon niets worden gecontroleerd. Dit blokkeert de cutover — een ongecontroleerd domein is niet geslaagd.',
  'finish.title': 'Rond een migratie af',
  'finish.intro':
    'Afronden stopt het kopiëren en het rapporteren. Doorloop de stappen in volgorde — alleen de laatste kan niet ongedaan worden gemaakt door gewoon door te gaan.',
  'finish.unknown.pre': 'Geen migratie met id',
  'finish.unknown.post':
    'gaf antwoord. Controleer het adres — dit is niet hetzelfde als een migratie zonder iets af te ronden.',
  'finish.readError.one': 'De migratie kon niet worden gelezen.',
  'finish.readError.many': 'De migraties konden niet worden gelezen.',
  'finish.note.paused':
    'Nooit gestart, dus er is niets af te ronden. Verwijder het uit de configuratiemap om het op te ruimen.',
  'finish.note.active':
    'Synchroniseert volgens schema. Items die nog op het oude systeem binnenkomen, worden gekopieerd.',
  'finish.note.cutover': 'In cutover. Synchroniseert nog totdat u afrondt.',
  'finish.note.done':
    'Afgerond. Deze koppeling synchroniseert niet meer en er wordt niets meer voor gerapporteerd.',
  'finish.left.one': 'item niet gemigreerd achtergelaten.',
  'finish.left.many': 'items niet gemigreerd achtergelaten.',
  'finish.step1.title': 'Controleer of de kopie volledig is',
  'finish.step1.pre': 'Vergelijk de twee systemen en controleer steekproeven van de inhoud.',
  'finish.step1.link': 'Voer de controle uit',
  'finish.step1.post':
    '. Leest de volledige bestemming, dus bij een grote mailbox duurt dit minuten.',
  'finish.step2.title': 'Werk de beslissingswachtrijen weg',
  'finish.step2.reading': 'Lezen…',
  'finish.step2.clear': 'Er wacht niets op u.',
  'finish.step2.failures': 'konden niet worden gekopieerd',
  'finish.step2.deletions': 'verwijderd op het oude systeem',
  'finish.step2.moves': 'verplaatst',
  'finish.step2.onlyFirstBlocks':
    '. Alleen de eerste hiervan blokkeert het afronden — de andere twee zijn al beantwoord doordat het nieuwe systeem zijn kopie behoudt.',
  'finish.step3.title': 'Voer één laatste doorloop uit',
  'finish.step3.body': 'Zodat het nieuwe systeem het oude weerspiegelt zoals het nu is.',
  'finish.step3.run': 'Voer nu een doorloop uit',
  'finish.step3.runAgain': 'Voer er nog een uit',
  'finish.step3.finished': 'De doorloop is uitgevoerd en voltooid.',
  'finish.step3.queued':
    'In de wachtrij. De doorloop draait als taak en verschijnt in de uitvoeringsgeschiedenis — geef het even, en controleer daarna de wachtrijen hierboven opnieuw.',
  'finish.step3.failed': 'Het doorloopverzoek is mislukt — er is niets uitgevoerd. Probeer opnieuw.',
  'finish.step4.title': 'Verplaats de bezorging naar het nieuwe systeem',
  'finish.step4.body':
    'Wijzig MX/DNS en configureer de clients opnieuw zodat nieuwe e-mail op het nieuwe systeem aankomt. Dit gebeurt buiten dit programma, dus dit is de ene stap die niemand hier voor u kan controleren.',
  'finish.step4.warn.pre': 'Als u afrondt voordat dit is gedaan',
  'finish.step4.warn.post':
    ', wordt alles wat daarna op het oude systeem binnenkomt niet gekopieerd, en niets zal het melden — het programma kijkt niet meer mee.',
  'finish.step4.checkbox': 'De bezorging gaat nu naar het nieuwe systeem.',
  'finish.step5.title': 'Afronden',
  'finish.step5.nothingChanges.pre':
    'Er wordt aan geen van beide systemen iets toegevoegd of verwijderd.',
  'finish.step5.nothingChanges.post':
    ' Wat op het nieuwe systeem staat, blijft precies zoals het is — dit stopt alleen het meekijken met het oude.',
  'finish.forceButton': 'Rond toch af en laat ze achter',
  'finish.button': 'Rond deze migratie af',
  'finish.button.disabledTitle':
    'Bevestig eerst stap 4 — afronden voordat de bezorging is verplaatst, verliest alles wat daarna binnenkomt.',
  'createMapping.target.userOperated':
    'De doelserver beheert u zelf. Wij zetten uw gegevens erin over — wij beheren, ' +
    'bewaken of back-uppen hem niet, en er geldt van onze kant geen serviceniveau voor ' +
    '(ADR-0011). Is het een beheerd Europees platform, dan is de aanbieder ervan ' +
    'verantwoordelijk.',
  'tenants.title': 'Team & organisatie',
  'tenants.intro':
    'Wie zich bij deze organisatie kan aanmelden, en wat ze mogen doen. Wijzigingen gelden direct.',
  'tenants.noTenant': 'Geen organisatie in deze sessie.',
  'tenants.requestFailed': 'Het verzoek is niet voltooid.',
  'tenants.org.heading': 'Organisatie',
  'tenants.org.readError':
    'De gegevens van de organisatie konden niet worden gelezen — de ledenlijst hieronder werkt nog.',
  'tenants.org.rename': 'Naam wijzigen',
  'tenants.org.renameSave': 'Naam opslaan',
  'tenants.org.renameCancel': 'Annuleren',
  'tenants.members.heading': 'Leden',
  'tenants.members.readError': 'De ledenlijst kon niet worden gelezen.',
  'tenants.members.empty': 'Geen leden.',
  'tenants.members.you': 'u',
  'tenants.members.emailHeader': 'E-mailadres',
  'tenants.members.roleHeader': 'Rol',
  'tenants.members.statusHeader': 'Status',
  'tenants.members.invitedHeader': 'Uitgenodigd',
  'tenants.members.joinedHeader': 'Toegetreden',
  'tenants.members.remove': 'Verwijderen',
  'tenants.members.removeArmed': 'Bevestig verwijderen',
  'tenants.readOnly': 'Uw rol hier is alleen-lezen. Een eigenaar of beheerder beheert de leden.',
  'tenants.invite.heading': 'Iemand uitnodigen',
  'tenants.invite.hint':
    'Er wordt nog geen e-mail verstuurd — vertel het diegene zelf. De uitnodiging verschijnt hieronder als "uitgenodigd".',
  'tenants.invite.email': 'E-mailadres',
  'tenants.invite.role': 'Rol',
  'tenants.notify.heading': 'E-mailsamenvattingen',
  'tenants.notify.intro':
    'Hoe vaak deze organisatie een samenvatting krijgt van wat op een beslissing wacht. ' +
    'Een lege samenvatting wordt nooit verstuurd — stilte betekent dat er niets wacht.',
  'tenants.notify.cadence': 'Samenvatting',
  'tenants.notify.daily': 'Dagelijks',
  'tenants.notify.weekly': 'Wekelijks (maandag)',
  'tenants.notify.off': 'Geen samenvatting',
  'tenants.notify.locale': 'Taal',
  'tenants.notify.recipients':
    'Gaat naar elke eigenaar en beheerder hieronder. Dringende gebeurtenissen worden direct ' +
    'gemaild, welke samenvatting u hier ook kiest.',
  'tenants.notify.save': 'Opslaan',
  'tenants.notify.saved': 'Opgeslagen.',
  'tenants.notify.readError':
    'De huidige instelling kon niet worden gelezen — opslaan zou iets onbekends overschrijven, ' +
    'dus de knoppen zijn uitgeschakeld.',
  'tenants.invite.submit': 'Uitnodigen',
  'role.owner': 'Eigenaar',
  'role.admin': 'Beheerder',
  'role.member': 'Lid',
  'role.viewer': 'Kijker',
  'memberStatus.active': 'Actief',
  'memberStatus.invited': 'Uitgenodigd',
  'memberStatus.suspended': 'Geschorst',
  'memberStatus.removed': 'Verwijderd',
  'nav.decisions': 'Aandacht',
  'decisions.presets.heading': 'Vaste antwoorden',
  'decisions.presets.intro':
    'Categorieën die zichzelf beantwoorden worden hier nog steeds vastgelegd — u ziet wat ' +
    'is opgemerkt en waardoor het is afgesloten — maar niemand wordt erover gestoord.',
  'decisions.presets.newMailbox': 'Als er een postvak verschijnt dat niets migreert',
  'decisions.presets.ask': 'Vraag het mij',
  'decisions.presets.auto': 'Automatisch beantwoorden',
  'decisions.presets.saved': 'Opgeslagen.',
  'decisions.presets.readError':
    'De vaste antwoorden konden niet worden gelezen; deze wachtrij beantwoordt mogelijk ' +
    'categorieën zonder te tonen welke.',
  'decisions.presets.readOnly': 'Een eigenaar of beheerder stelt dit in.',
  'permissions.heading': 'Zet de rechten over voordat u de bezorging verplaatst',
  'permissions.body':
    'Wie wiens agenda kon zien, wie toegang had tot welke gedeelde bestanden — dat verhuist ' +
    'niet mee met de post. Haal de lijst op, werk hem door op het nieuwe systeem, en doe dat ' +
    'vóór de bezorging verhuist: rechten die daarna worden toegevoegd, ontbraken zolang dat ' +
    'duurde. Bovenaan de lijst staat wat er niet gelezen kon worden.',
  'permissions.blindSpot':
    'Twee dingen kan de lijst u mogelijk niet vertellen. Wie FullAccess of Send-As op een ' +
    'postvak had: Microsoft geeft ons dat helemaal niet, dat moet u zelf uit Exchange halen. ' +
    'En het delen op OneDrive en SharePoint, dat alleen meekomt als deze installatie die ' +
    'extra machtiging heeft gekregen. Het document zegt welke van de twee het werkelijk ' +
    'gelezen heeft, en hoe u de rest afdekt.',
  'permissions.download': 'Haal de rechtenlijst op',
  'permissions.failed': 'De rechtenlijst kon niet worden opgehaald.',
  'sharedAddresses.heading': 'Gevonden gedeelde adressen',
  'sharedAddresses.pattern.shared_s': 'Gedeeld postvak — het postvak wordt gekopieerd',
  'sharedAddresses.pattern.distribution_d': 'Distributielijst — de leden worden opnieuw aangemaakt',
  'sharedAddresses.pattern.unknown': 'Welke soort? Wacht op u',
  'sharedAddresses.members': 'leden',
  'sharedAddresses.membersUnknown': 'leden konden niet worden gelezen',
  'sharedAddresses.empty':
    'Niets gevonden. Dit betekent niet "uw organisatie heeft er geen": een IMAP-bron kan groepen ' +
    'helemaal niet opsommen, en een Microsoft 365-bron heeft daarvoor toepassingsmachtigingen ' +
    'nodig. Gedeelde adressen kunnen ook met de hand worden toegevoegd.',
  'sharedAddresses.readError': 'De gevonden gedeelde adressen konden niet worden gelezen.',
  'sharedAddresses.runbook.intro':
    'Distributielijsten moeten met de hand op de bestemming opnieuw worden aangemaakt — geen ' +
    'van de bestemmingen hier biedt een manier om dat voor u te doen.',
  'sharedAddresses.runbook.download': 'Haal de stappenlijst op',
  'sharedAddresses.runbook.failed': 'De stappen konden niet worden opgehaald.',
  'decisions.title': 'Vraagt om een beslissing',
  'decisions.intro':
    'Veranderingen die de synchronisatie opmerkte en waarover alleen u kunt beslissen. Er gebeurt niets totdat u antwoordt.',
  'decisions.readError': 'De beslissingswachtrij kon niet worden gelezen.',
  'decisions.requestFailed': 'Het verzoek is niet voltooid.',
  'decisions.dismiss': 'Afwijzen',
  'decisions.sharedAddress.shared_s': 'Eén gedeeld postvak',
  'decisions.sharedAddress.distribution_d': 'Een distributielijst',
  'decisions.empty.noDetectors':
    'Er wacht niets. De wachters voor nieuwe postvakken en gedeelde adressen draaien eenmaal per ' +
    'dag; een bron die zij niet konden lezen wordt gemeld als blinde vlek en niet geteld als ' +
    '"geen veranderingen".',
  'decisions.empty.answered': 'Er is nog niets beslist.',
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
  'decisionStatus.resolved': 'Beslist',
  'decisionStatus.auto_resolved': 'Beslist door voorkeuze',
  'decisionStatus.dismissed': 'Afgewezen',
};

export type Locale = 'en' | 'nl';
export type StringKey = keyof typeof en;

export const STRINGS: Record<Locale, Record<StringKey, string>> = { en, nl };

export const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

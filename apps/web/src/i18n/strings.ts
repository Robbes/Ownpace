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
  'tenants.invite.submit': 'Invite',
  'role.owner': 'Owner',
  'role.admin': 'Admin',
  'role.member': 'Member',
  'role.viewer': 'Viewer',
  'memberStatus.active': 'Active',
  'memberStatus.invited': 'Invited',
  'memberStatus.suspended': 'Suspended',
  'memberStatus.removed': 'Removed',
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
  'tenants.invite.submit': 'Uitnodigen',
  'role.owner': 'Eigenaar',
  'role.admin': 'Beheerder',
  'role.member': 'Lid',
  'role.viewer': 'Kijker',
  'memberStatus.active': 'Actief',
  'memberStatus.invited': 'Uitgenodigd',
  'memberStatus.suspended': 'Geschorst',
  'memberStatus.removed': 'Verwijderd',
};

export type Locale = 'en' | 'nl';
export type StringKey = keyof typeof en;

export const STRINGS: Record<Locale, Record<StringKey, string>> = { en, nl };

export const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

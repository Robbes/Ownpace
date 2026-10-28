// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The organisation: its members, settings, sharing and notifications.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  // THE SETTINGS PANEL ON A RUNNING MIGRATION (0125 T3) — the screen behind the
  // remedy `policy_refused` prints per item: *"set an export policy on the
  // mapping"*. It named an action the product did not have; these are the words
  // of the one it has now. The chooser's own labels are the wizard's, above,
  // because it is the same control asked in a second place.
  'settings.exportPolicy': 'Export format for Google files',
  'settings.exportPolicy.save': 'Save this format',
  'settings.exportPolicy.saving': 'Saving…',
  'settings.exportPolicy.saved': 'Saved. The next pass uses it.',
  // What changing it does NOT do, before the press rather than after. Items
  // already copied keep the format they arrived in: this tool never overwrites
  // what is on the new system (hard rule 2), so the new format applies from
  // here on.
  // Since 0042 T8 (b)'s second half: what the new names mean for the copies
  // already there (the owner, 2026-09-23: "The export-format setting says this
  // before you save").
  'settings.exportPolicy.consequence':
    'Changed kinds are copied under their new names. Old copies stay, listed as earlier exports.',
  'settings.exportPolicy.consequence.why':
    'A Google document has no file name of its own: its format gives it one (Report.docx, Report.odt), and the name is how a migration recognises a file. So under a new format the next pass copies each document under its new name. Nothing on the new system is rewritten or removed: a copy made in the old format stays where it is, and the Deletions screen lists it as an earlier export, never as deleted in Google. Keep it, or remove it yourself on the new system. Where a new format gives a document the same name, each copy records which format it was made under, so a later pass reads the change as a format change and never as an edit.',
  // WHAT HAPPENS TO THE FILES THE OLD FORMAT REFUSED (0125 T5, and since 0042
  // T8 (b) the pass does it). A Google file's name comes from its format, so
  // under a new one it is a new name: the next pass tries it, and closes the
  // refusal it left under the old name. The save itself changes no row.
  'settings.exportPolicy.refusedBefore':
    'The next pass tries Google files again and will close a previous refusal of old format.',
  // The same sentence with the count, used only when the count is KNOWN and
  // above zero: a queue we could not read must not read as a queue of none.
  'settings.exportPolicy.refusedBefore.count':
    'The next pass tries {count} Google file(s) with the new format that were refused under the old format.',
  'settings.exportPolicy.refusedBefore.why':
    'A Google file’s name comes from its format (Report.docx, Report.odt), and the name is how a migration recognises a file, so under a new format each one is new to it. The next pass tries each under its new name. The refusal recorded under the old name closes by itself, because the file is no longer listed by it. If the new format cannot carry a file either, it stays on the Failures screen, under its new name. Saving changes nothing by itself: the pass does. A file you chose to leave behind stays left behind.',
  'settings.exportPolicy.toFailures': 'See them on the Failures screen',
  'settings.exportPolicy.refused': 'This could not be changed:',
  'settings.exportPolicy.failed': 'That did not save:',
  // THE SAME PANEL ON A DROPBOX MIGRATION (workplan 0150 T3 (d); D7: one key,
  // one panel, one rule). Its title is the words the Paper refusal names, on
  // the row and in `failure.policyRefused.dropbox`.
  'settings.exportPolicy.paper': 'Export format for Paper docs',
  'settings.exportPolicy.paper.consequence':
    'Paper docs are copied again under their new names. Old copies stay, listed as earlier exports.',
  'settings.exportPolicy.paper.consequence.why':
    'A Paper doc has no file name of its own: its format adds one to its name (Notes.paper.md, Notes.paper.html), and the name is how a migration recognises a file. So under a new format, the next pass copies each Paper doc under its new name. Nothing on the new system is rewritten or removed: a copy in the old format stays where it is, and the Deletions screen lists it as an earlier export, never as deleted in Dropbox. Keep it, or remove it yourself on the new system.',
  'settings.exportPolicy.paper.refusedBefore':
    'The next pass tries the Paper docs again that were left behind.',
  // With the count, only when it is KNOWN and above zero, as Drive's.
  'settings.exportPolicy.paper.refusedBefore.count':
    'The next pass tries {count} Paper doc(s) in this format again that were left behind.',
  'settings.exportPolicy.paper.refusedBefore.why':
    'Under a format a Paper doc arrives under a new name (Notes.paper.md), so it is new to the migration. The next pass copies each one, and the line recorded under its old name closes by itself, because the doc is no longer listed by it. A doc Dropbox does not offer in this format stays on the Failures screen. Saving changes nothing by itself: the pass does. Other documents Dropbox keeps in a format of its own stay behind.',
  // HOW OFTEN A MIGRATION SYNCS, changed on its own page (the owner,
  // 2026-09-28). The four cadences are the wizard's own words.
  'settings.schedule': 'How often to look for changes',
  'settings.schedule.own': 'Now: {schedule}, set outside this page.',
  // The first copy runs pass after pass whatever the schedule, and the
  // schedule applies once every data type has been copied once (workplan
  // 0156 T5; the owner, 2026-10-03). Until then this said a daily schedule
  // copied for 50 minutes a day, which was true and was the defect.
  'settings.schedule.hint': 'Passes run back to back until the first copy is done.',
  'settings.schedule.hint.why':
    'A pass runs at most 50 minutes. Until every data type has been copied once in full, the next pass starts as soon as the last one ends, and no sooner than 15 minutes after it started, whatever this schedule says. A daily download limit at the source is waited out first. After that, passes follow this schedule and migrate only what is new or has changed. Items that could not be migrated wait for you on the Failures screen. On Automatic the days count from when everything was migrated, or from the last time someone opened this migration or pressed Sync now, whichever is later.',
  // Free's pace (workplan 0157 T4): one pass a day outside the alpha, whatever
  // the schedule; the faster cadences are not offered, and this says why, with
  // the link after it as the way to a higher tier. Also what a schedule the
  // route refused at the pace says (`free_pace_schedule`).
  'settings.schedule.freePace':
    'On Free a migration looks for changes once a day. A higher tier syncs as often as every 15 minutes.',
  'settings.schedule.freePace.link': 'See the tiers on the Billing page.',
  'settings.schedule.save': 'Save this schedule',
  'settings.schedule.saving': 'Saving…',
  'settings.schedule.saved': 'Saved. The next pass follows it.',
  'settings.schedule.refused': 'This could not be changed:',
  'settings.schedule.failed': 'That did not save:',
  // WHAT THIS MIGRATION COPIES, and what it may still gain (workplan 0125 T6).
  // Adding only: the page never offers to take a data type off.
  'settings.kinds': 'Data types this migration copies',
  'settings.kinds.add': 'Add {kindWord}',
  'settings.kinds.adding': 'Adding…',
  'settings.kinds.added': '{kind} added. The next pass copies it.',
  // Before the press, like the export format's: what adding does and does not do.
  'settings.kinds.consequence':
    'An added data type is copied from the next pass. Nothing already copied changes.',
  'settings.kinds.consequence.why':
    'The new data type is copied in full from the next pass on, the way every data type is copied the first time: pass after pass, whatever the schedule, until it has been copied once. The ones this migration already migrated carry on where they were. A data type cannot be taken off again here: what it had migrated would stay on the new system with nothing keeping it up to date.',
  'settings.kinds.failed': 'That was not added:',
  // STOP AND RESUME ONE DATA TYPE (workplan 0128 T4, slice 3c). Offered where
  // the stop door accepts the press; what a stop does is said before it.
  // Sentence case: the data type mid-label is lower-cased ({kindWord}).
  'settings.kinds.stop': 'Stop {kindWord}',
  'settings.kinds.resume': 'Resume {kindWord}',
  'settings.kinds.stopping': 'Stopping…',
  'settings.kinds.resuming': 'Resuming…',
  'settings.kinds.stoppedByYou': 'stopped by you',
  'settings.kinds.stopped': '{kind} is stopped. What was migrated stays; resume to continue.',
  'settings.kinds.resumed': '{kind} is resumed. The next pass continues where we left off.',
  'settings.kinds.stop.consequence':
    'A stopped data type keeps what it migrated, but no longer follows the source. Resuming it continues where it stopped.',
  'settings.kinds.stop.consequence.why':
    'For an account that closes before the others: stop the mail on the day the old mailbox closes, while such as calendars, contacts, files keep migrating. Nothing is removed on either side. The last data type still migrating cannot be stopped; to stop everything, end the migration.',
  'settings.kinds.held.lastOne':
    'The last data type is still active. To stop it, end the migration instead.',
  'settings.kinds.held.notRunning': 'This can be resumed once the migration runs again.',
  'settings.kinds.stop.failed': 'That did not change:',
  // A data type the rule refuses, by its `code` (UX sweep, 2026-10-17): the
  // rule's own `reason` is English for the API and its logs. 'Test' is the
  // Accounts row's button (connections.test).
  'settings.kinds.refused.afterCutover':
    'Can no longer be added once the switch has started. Start a new migration for it.',
  'settings.kinds.refused.measured':
    'One of the two accounts said it cannot hold this. If that has changed, press Test on the Accounts page.',
  // The channel's state, shown only when it is OFF (0043 T3). "On" is not worth
  // a banner; "off" is the state somebody has to act on, and until now it was
  // visible only in a container log line written once at boot.
  'notifications.off': 'Email notifications are off',
  'notifications.offHint':
    'Nobody is emailed when this migration needs a decision; configure SMTP to turn that on.',
  'notifications.offReason': 'Reason given by the server:',
  'sharing.title': 'Sharing checklist',
  'sharing.intro': 'Everything someone else could reach on the old system, one row per share.',
  'sharing.intro.more':
    'Settle each row: apply the share on the new system, tick it as done by hand, or skip on purpose. Done and Skip both settle a row, and they record different things: Done means this access was re-established by hand, Skip means it is deliberately not carried across. After a cutover those are different answers to "why can this person no longer open what was shared?". Every settled row keeps who decided, and when.',
  'sharing.progressSettled': 'settled',
  'sharing.openManualNote.one':
    '1 row needs a step from you on the new system; mark it done here afterwards.',
  'sharing.openManualNote.many':
    '{count} rows need a step from you on the new system; mark them done here afterwards.',
  'sharing.rescan': 'Refresh from the source…',
  'sharing.blindSpots': 'Not read — note these by hand before you switch over:',
  'sharing.empty': 'No shares on the list yet. Refresh from the source to scan.',
  'sharing.apply': 'Share on the new system',
  'sharing.applyArmed': 'Press again: this shares and sends an invitation',
  'sharing.done': 'Mark done',
  'sharing.done.why': 'This access was re-established by hand on the new system.',
  'sharing.skip': 'Skip',
  'sharing.skip.why': 'This access is deliberately not carried across.',
  'sharing.linkShare': 'link share',
  'sharing.manualBadge': 'manual',
  'sharing.granteeLabel': 'share with',
  'sharing.inviteNote':
    'The new system sends this address an invitation. Check the address first.',
  'sharing.state.applied': 'shared on the new system',
  'sharing.state.doneManual': 'done by hand',
  'sharing.state.skipped': 'skipped',
  'sharing.loadFailed': 'The sharing checklist could not be read.',
  // 0123 T4 — a folder is one row, not two hundred. The fold is a lid, never a
  // replacement: opening a folder shows the very same rows with the very same
  // presses, and anything that differs from its folder never goes under a lid
  // at all.
  'sharing.group.items': 'items',
  'sharing.group.unnamedFolder': 'One folder (not itself shared)',
  // A folder we have no name for is identified by something inside it, and the
  // grant set is said in WORDS: `grantee:role` is the comparison key, and the
  // owner read one of those glued to a folder called `2017 Q2` and asked why an
  // email address had grown a month on the end of it.
  'sharing.group.holds': 'holds',
  'sharing.group.sharedWith': 'Shared with',
  'sharing.grant.link': 'anyone with the link',
  'sharing.group.doneAll': 'Mark all done',
  'sharing.group.skipAll': 'Skip all',
  'sharing.group.applyInside': 'Open the folder to share items on the new system.',
  // ONE PRESS OVER ONE FOLDER (2026-09-19), confirm-first. `done` and `skip`
  // record a decision and reach nobody; this one invites every person in the
  // folder the moment it lands, so every address is shown, editable and
  // confirmed before it is offered at all (ADR-0032 §6, at folder scale).
  'sharing.group.applyFolder': 'Share this folder on the new system',
  'sharing.group.applyFolderArmed': 'Press again to invite them all',
  'sharing.group.confirmFirst': 'First check each address: one press invites them all.',
  'sharing.group.confirmFirst.why':
    'The new system sends the invitation itself, the moment the share is created — so a press over whole folders is a wave of real mail, and it cannot be unsent. That is why each address is shown here and each one is confirmed on its own. Ownpace proposes the address the old system recorded, and you decide whether that is still the correct address / person to share with. If the other person is also moving to a new address, change the proposed one. An address you confirm here is remembered for that person\u2019s other rows in this migration, to make it easier.',
  'sharing.group.addressLabel': 'send to',
  'sharing.group.confirmOne': 'Confirm',
  'sharing.group.confirmed': 'confirmed',
  'sharing.group.stillToConfirm.one': '1 address still to check.',
  'sharing.group.stillToConfirm.many': '{count} addresses still to check.',
  // What a folder press could not share (workplan 0136 T3's row-level half):
  // the heading over the server's own sentences, one per person and reason.
  // Not *refused*: a gate of ours (no share API) is in the same list.
  'sharing.group.refused.one':
    'Sharing on the new system did not work for 1 share in this folder. Its row stays open.',
  'sharing.group.refused.many':
    'Sharing on the new system did not work for {count} shares in this folder. Their rows stay open.',
  // What a folder press stopped before at the new system's limit on new
  // shares (workplan 0104): not refused, not tried, waiting. The server's
  // sentence under it says when to apply again.
  'sharing.group.waitingForLimit.one':
    '1 share in this folder waits for the new system\u2019s limit on new shares. Its row stays open; it was not refused.',
  'sharing.group.waitingForLimit.many':
    '{count} shares in this folder wait for the new system\u2019s limit on new shares. Their rows stay open; none was refused.',
  // When the answer came, in the reader's own clock, since the line stays on
  // the page until this folder is pressed again: the moment to apply again
  // when the new system named a wait, and the moment it answered otherwise,
  // for the server's sentence under it to count from.
  'sharing.group.waitingForLimit.after': 'Apply again after {time}.',
  'sharing.group.waitingForLimit.answeredAt': 'The new system gave this answer at {time}.',
  'sharing.alone.unplaced': 'The old system did not say where this sits, so it is on its own.',
  'sharing.alone.vsFolder': 'Shared differently from its folder',
  'sharing.alone.vsSiblings': 'Shared differently from the other items here',
  'sharing.alone.extra': 'extra:',
  'sharing.alone.missing': 'missing:',
  'sharing.notPlacedYet':
    'Not grouped by folder: your old system did not say which folder each item is in.',
  'tenants.title': 'Team & organisation',
  'tenants.intro':
    'Who can sign in to this organisation and what they may do.',
  'tenants.noTenant': 'No organisation in this session.',
  'tenants.selfDemotionArmed':
    'This lowers your own role; you may not be able to change it back yourself.',
  'tenants.selfDemotionConfirm': 'Confirm role change',
  'tenants.org.heading': 'Organisation',
  // The organisation's phone number (workplan 0108 T8a): optional, and shown
  // on the grant page to the people the organisation asks.
  'tenants.org.phone': 'Phone number',
  'tenants.org.phone.hint': 'Optional; shown to people you send a grant link to.',
  'tenants.org.phone.save': 'Save',
  'tenants.org.phone.saved': 'Saved.',
  'tenants.org.phone.none': 'None given.',
  'tenants.org.readError': "Could not read the organisation's details.",
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
  // The buttons' column, named for a screen reader only: its buttons say what they do.
  'tenants.members.actionsHeader': 'Actions',
  'tenants.members.remove': 'Remove',
  'tenants.members.removeArmed': 'Confirm remove',
  // An open invitation's mail, again (0156 T3).
  'tenants.members.resend': 'Send again',
  'tenants.readOnly': 'Your role here is read-only. An owner or admin manages members.',
  'tenants.invite.heading': 'Invite someone',
  // The invitation is mailed since 0156 T3 (the owner, 2026-10-03). The
  // line said "No email yet; tell them yourself" until then, which was true.
  'tenants.invite.hint':
    'We email them where to sign in; they appear above as invited.',
  // What became of the mail, after Invite or Send again. Each leaves the
  // inviter a different thing to do, so each says it.
  'tenants.invite.mail.sent': 'Invitation emailed to {email}.',
  'tenants.invite.mail.off':
    'Invitation saved for {email}, but this deployment sends no email: tell them yourself.',
  'tenants.invite.mail.failed':
    'Invitation saved for {email}, but its email could not be sent. Send it again, or tell them yourself.',
  'tenants.invite.mail.limited':
    "Invitation saved for {email}, but today's invitation emails are used up. Send it again tomorrow, or tell them yourself.",
  'tenants.invite.email': 'Email address',
  'tenants.invite.role': 'Role',
  // Workplan 0137 T7: the two roles the alpha offers, and what the second one
  // may do. Checked against the API's owner-only routes: close and reopen
  // (tenants/index.ts), the deleting-by-hand and automatic-removal switches
  // (`allowApplyDeletions`, `autoApplyRelocations`), owner-only in both
  // directions (operating-routes.ts), and granting owner (members.ts).
  // `a-role-that-promises-less-than-it-allows.unit.test.ts` in apps/api pins
  // that set and fails when it changes. The switches are named as the
  // Deletions panel names them (0156 T6).
  'tenants.invite.adminCan':
    "An admin can do everything an owner can, except close or reopen the organisation, turn deleting by hand or the automatic removal of moved files' old copies on or off, make somebody an owner, and change or remove an owner.",
  'tenants.ownerOrAdminOnly': 'During the Alpha, a person can only be an owner or an admin.',
  'tenants.notify.heading': 'Email summaries',
  'tenants.notify.intro':
    'How often a summary is emailed; an empty one is never sent.',
  'tenants.notify.intro.more': 'Silence means nothing is waiting.',
  'tenants.notify.cadence': 'Summary',
  'tenants.notify.daily': 'Daily',
  'tenants.notify.weekly': 'Weekly',
  'tenants.notify.off': 'No summary',
  'tenants.notify.locale': 'Language',
  'tenants.notify.recipients':
    'Sent to every owner and admin below; urgent events are emailed as they happen.',
  'tenants.notify.saved': 'Saved.',
  'tenants.notify.readError': 'Could not read the setting; try again later.',
  'tenants.invite.submit': 'Invite',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'settings.exportPolicy': 'Exportformaat voor Google-bestanden',
  'settings.exportPolicy.save': 'Dit formaat opslaan',
  'settings.exportPolicy.saving': 'Opslaan…',
  'settings.exportPolicy.saved': 'Opgeslagen. De volgende ronde gebruikt het.',
  'settings.exportPolicy.consequence':
    'Gewijzigde soorten worden onder hun nieuwe namen gemigreerd. Oude kopieën blijven, vermeld als eerdere exports.',
  'settings.exportPolicy.consequence.why':
    'Een Google-document heeft geen eigen bestandsformaat: het gekozen exportformaat geeft het er een (Rapport.docx, Rapport.odt), en aan de naam herkent een migratie een bestand. Onder een nieuw formaat migreert de volgende ronde dus elk document onder die nieuwe naam. Op het nieuwe systeem wordt niets overschreven of verwijderd: een kopie in het oude formaat blijft staan, en het scherm Verwijderingen vermeldt die als eerder geëxporteerd, nooit als verwijderd in Google. Behoud, of verwijder hem zelf op het nieuwe systeem. Geeft een nieuw formaat een document dezelfde naam, dan staat bij elke kopie onder welk formaat die was gemaakt, dus een latere ronde leest de wijziging als een formaatwijziging en niet als een bewerking.',
  'settings.exportPolicy.refusedBefore':
    'De volgende ronde probeert Google-bestanden die het oude formaat weigerde opnieuw, maar dan in dit formaat.',
  'settings.exportPolicy.refusedBefore.count':
    'De volgende ronde probeert {count} Google-bestand(en) opnieuw die met het oude formaat werden geweigerd.',
  'settings.exportPolicy.refusedBefore.why':
    'De naam van een Google-bestand komt van het bestandsformaat (Rapport.docx, Rapport.odt), en aan de naam herkent een migratie een bestand, dus onder een nieuw formaat is elk bestand nieuw voor de migratie. De volgende ronde probeert elk bestand onder de nieuwe naam, en de weigering die onder de oude naam is vastgelegd, wordt daarmee vanzelf opgelost. Past het nieuwe formaat ook niet, dan komt dat opnieuw te staan bij Mislukkingen, onder de nieuwe naam. Opslaan verandert zelf niets: de ronde moet dit tegenkomen. Een bestand dat u hebt laten achterblijven, blijft achter.',
  'settings.exportPolicy.toFailures': 'Bekijk ze bij Mislukkingen',
  'settings.exportPolicy.refused': 'Dit kon niet worden gewijzigd:',
  'settings.exportPolicy.failed': 'Dat is niet opgeslagen:',
  'settings.exportPolicy.paper': 'Exportformaat voor Paper-documenten',
  'settings.exportPolicy.paper.consequence':
    'Paper-documenten worden opnieuw gemigreerd onder hun nieuwe namen. Oude kopieën blijven, vermeld als eerdere exports.',
  'settings.exportPolicy.paper.consequence.why':
    'Een Paper-document heeft geen eigen bestandsformaat: het formaat voegt een extensie toe aan de naam (Notities.paper.md, Notities.paper.html), en aan de naam herkent een migratie een bestand. Onder een nieuw formaat migreert de volgende ronde dus elk Paper-document onder de nieuwe naam. Op het nieuwe systeem wordt niets overschreven of verwijderd: een kopie in het oude formaat blijft staan, en het scherm Verwijderingen vermeldt deze als eerdere export, nooit als verwijderd in Dropbox. Behoud, of verwijder zelf op het nieuwe systeem.',
  'settings.exportPolicy.paper.refusedBefore':
    'De volgende ronde probeert de Paper-documenten die tot nu toe bleven staan opnieuw, in dit formaat.',
  'settings.exportPolicy.paper.refusedBefore.count':
    'De volgende ronde probeert {count} Paper-document(en) die tot nu toe bleven staan opnieuw, in dit formaat.',
  'settings.exportPolicy.paper.refusedBefore.why':
    'Onder een bestandsformaat komt een Paper-document aan met een nieuwe naam (Notities.paper.md), dus het is nieuw voor de migratie. De volgende ronde migreert elk document, en de regel die onder de oude naam is vastgelegd, sluit vanzelf, omdat het document niet meer onder die naam voorkomt. Een document dat Dropbox niet in dit formaat aanbiedt, komt bij Mislukkingen te staan met die reden. Opslaan verandert zelf niets: de migratieronde moet dit tegenkomen. Andere documenten die Dropbox in een eigen formaat bewaart, blijven achter.',
  'settings.schedule': 'Frequentie om naar wijzigingen te kijken',
  'settings.schedule.own': 'Nu: {schedule}, buiten deze pagina ingesteld.',
  'settings.schedule.hint': 'Rondes lopen direct na elkaar tot de eerste volledige migratie klaar is.',
  'settings.schedule.hint.why':
    'Een ronde duurt maximaal 50 minuten. Totdat elk gegevenstype één keer volledig is gemigreerd, start de volgende ronde na de vorige, en niet eerder dan 15 minuten na de start, wat dit schema ook zegt. Er wordt rekening gehouden met (dag)limieten, zoals voor downloaden bij een bron. Daarna volgen de rondes dit schema en migreren alleen wat nieuw of gewijzigd is. Items die niet gemigreerd konden worden, worden geparkeerd bij Mislukkingen. Bij Automatisch tellen de dagen vanaf het moment dat alles was gemigreerd, of vanaf de laatste keer dat iemand deze migratie opende of op Synchroniseer nu drukte, wat het laatst was.',
  'settings.schedule.freePace':
    'Bij Free wordt er eenmaal per dag naar wijzigingen gekeken. Een hoger pakket kijkt tot maximaal elke 15 minuten.',
  'settings.schedule.freePace.link': 'Bekijk de pakketten op de pagina Facturering.',
  'settings.schedule.save': 'Dit schema opslaan',
  'settings.schedule.saving': 'Opslaan…',
  'settings.schedule.saved': 'Opgeslagen. De volgende ronde volgt het.',
  'settings.schedule.refused': 'Dit kon niet worden gewijzigd:',
  'settings.schedule.failed': 'Dat is niet opgeslagen:',
  'settings.kinds': 'Gegevenstypen in deze migratie',
  'settings.kinds.add': '{kind} toevoegen',
  'settings.kinds.adding': 'Toevoegen…',
  'settings.kinds.added': '{kind} toegevoegd. De volgende ronde start migreren.',
  'settings.kinds.consequence':
    'Een toegevoegd gegevenstype wordt vanaf de volgende ronde gemigreerd. Wat al gemigreerd was, verandert niet.',
  'settings.kinds.consequence.why':
    'Het nieuwe gegevenstype wordt vanaf de volgende ronde volledig gemigreerd, zoals elk gegevenstype de eerste keer: ronde na ronde, wat het schema ook zegt, tot het één keer volledig is gemigreerd. De gegevenstypen die deze migratie al bevat, gaan verder waar zij waren. Een gegevenstype kan hier niet meer worden weggehaald: wat het al had gemigreerd, zou op het nieuwe systeem blijven staan zonder dat iets het nog bijwerkt.',
  'settings.kinds.failed': 'Dat is niet toegevoegd:',
  'settings.kinds.stop': '{kind} stoppen',
  'settings.kinds.resume': '{kind} hervatten',
  'settings.kinds.stopping': 'Stoppen…',
  'settings.kinds.resuming': 'Hervatten…',
  'settings.kinds.stoppedByYou': 'door u gestopt',
  'settings.kinds.stopped':
    '{kind} is gestopt. Wat al gemigreerd is, blijft staan; hervat het om verder te gaan.',
  'settings.kinds.resumed': '{kind} is hervat. De volgende ronde gaat straks verder.',
  'settings.kinds.stop.consequence':
    'Een gestopt gegevenstype onthoudt wat al was gemigreerd, maar volgt de bron niet meer. Hervatten gaat verder waar het stopte.',
  'settings.kinds.stop.consequence.why':
    'Voor een account dat eerder moet stoppen met migreren: stop de e-mailmigratie op de dag dat het oude postvak sluit, terwijl bijvoorbeeld agenda, contacten en bestanden blijven migreren. Aan geen van beide kanten wordt iets verwijderd. Het laatste gegevenstype waarvoor nog een migratie actief is kan niet worden gestopt: wilt u alles stoppen, beëindig dan de migratie.',
  'settings.kinds.held.lastOne':
    'Het laatste gegevenstype dat nog wordt gemigreerd. Wilt u het stoppen, beëindig dan de migratie.',
  'settings.kinds.held.notRunning': 'Dit kan worden hervat zodra de migratie weer actief is.',
  'settings.kinds.stop.failed': 'Dat is niet gewijzigd:',
  'settings.kinds.refused.afterCutover':
    'Kan niet meer worden toegevoegd nu de overstap is begonnen. Start hiervoor een nieuwe migratie.',
  'settings.kinds.refused.measured':
    'Een van de twee accounts gaf aan dit niet te kunnen bewaren. Is dat veranderd? Druk dan op Testen op de pagina Accounts.',
  'notifications.off': 'E-mailmeldingen staan uit',
  'notifications.offHint':
    'Niemand wordt gemaild als deze migratie een beslissing nodig heeft; stel SMTP in.',
  'notifications.offReason': 'Reden van de server:',
  'sharing.title': 'Deel-checklist',
  'sharing.intro': 'Alles wat met iemand was gedeeld op uw oude systeem, één regel per deelrecht.',
  'sharing.intro.more':
    'Werk elke regel af: pas het delen toe op het nieuwe systeem, vink af als handmatig gedaan, of sla bewust over. Afvinken betekent dat dit deelrecht handmatig opnieuw is ingericht, Overslaan dat het bewust niet meegaat. Van elke beslissing wordt onthouden wie deze wanneer nam.',
  'sharing.progressSettled': 'afgewerkt',
  'sharing.openManualNote.one':
    '1 regel vraagt een stap van u op het nieuwe systeem; vink die hier daarna af.',
  'sharing.openManualNote.many':
    '{count} regels vragen een stap van u op het nieuwe systeem; vink ze hier daarna af.',
  'sharing.rescan': 'Opnieuw inlezen van de bron…',
  'sharing.blindSpots': 'Niet gelezen — noteer deze zelf voordat u overstapt:',
  'sharing.empty': 'Nog geen gedeelde rechten. Lees opnieuw in van de bron om te scannen.',
  'sharing.apply': 'Delen op het nieuwe systeem',
  'sharing.applyArmed': 'Druk nogmaals: dit deelt en stuurt een uitnodiging',
  'sharing.done': 'Afvinken',
  'sharing.done.why': 'Dit recht is handmatig opnieuw ingericht op het nieuwe systeem.',
  'sharing.skip': 'Overslaan',
  'sharing.skip.why': 'Dit recht gaat bewust niet mee.',
  'sharing.linkShare': 'deellink',
  'sharing.manualBadge': 'handmatig',
  'sharing.granteeLabel': 'delen met',
  'sharing.inviteNote':
    'Het nieuwe systeem stuurt dit adres een uitnodiging. Controleer het adres eerst.',
  'sharing.state.applied': 'gedeeld op het nieuwe systeem',
  'sharing.state.doneManual': 'handmatig gedaan',
  'sharing.state.skipped': 'overgeslagen',
  'sharing.loadFailed': 'De deel-checklist kon niet worden gelezen.',
  'sharing.group.items': 'items',
  'sharing.group.unnamedFolder': 'Eén map (zelf niet gedeeld)',
  'sharing.group.holds': 'bevat',
  'sharing.group.sharedWith': 'Gedeeld met',
  'sharing.grant.link': 'iedereen met de link',
  'sharing.group.doneAll': 'Alles afvinken',
  'sharing.group.skipAll': 'Alles overslaan',
  'sharing.group.applyInside': 'Open de map om items op het nieuwe systeem te delen.',
  'sharing.group.applyFolder': 'Deze map delen op het nieuwe systeem',
  'sharing.group.applyFolderArmed': 'Bevestig nogmaals om iedereen uit te nodigen',
  'sharing.group.confirmFirst': 'Controleer elk adres voordat u ze allemaal uitnodigt.',
  'sharing.group.confirmFirst.why':
    'Het nieuwe systeem stuurt de uitnodigingsmails zelf, zodra het delen is aangemaakt \u2014 een muisklik voor een gehele map is dus een golf aan mails naar mensen. Daarom staat elk adres hier apart en bevestigt u deze stuk voor stuk: de tool stelt het adres voor dat het oude systeem vastlegde, en u beslist of deze persoon nog uitgenodigd moet worden. Migreert de andere persoon ook naar een nieuw mailadres? Pas dan het voorgestelde e-mailadres aan. Een adres dat u hier bevestigt, onthouden we voor de andere regels van die persoon in deze migratie, zodat u niet dezelfde correctie twee keer hoeft te doen.',
  'sharing.group.addressLabel': 'sturen naar',
  'sharing.group.confirmOne': 'Bevestigen',
  'sharing.group.confirmed': 'bevestigd',
  'sharing.group.stillToConfirm.one': 'Nog 1 adres te controleren.',
  'sharing.group.stillToConfirm.many': 'Nog {count} adressen te controleren.',
  'sharing.group.refused.one':
    'Delen op het nieuwe systeem lukte niet voor 1 deelrecht in deze map. De regel blijft open.',
  'sharing.group.refused.many':
    'Delen op het nieuwe systeem lukte niet voor {count} deelrechten in deze map. De regels blijven open.',
  'sharing.group.waitingForLimit.one':
    '1 deelrecht in deze map wacht op de limiet die het nieuwe systeem stelt aan nieuwe deelrechten. De regel blijft open; het is niet geweigerd.',
  'sharing.group.waitingForLimit.many':
    '{count} deelrechten in deze map wachten op de limiet die het nieuwe systeem stelt aan nieuwe deelrechten. De regels blijven open; geen ervan is geweigerd.',
  'sharing.group.waitingForLimit.after': 'Pas het na {time} opnieuw toe.',
  'sharing.group.waitingForLimit.answeredAt': 'Het nieuwe systeem gaf dit antwoord om {time}.',
  'sharing.alone.unplaced': 'Het oude systeem gaf niet aan waar dit staat, dus het staat apart.',
  'sharing.alone.vsFolder': 'Anders gedeeld dan de map zelf',
  'sharing.alone.vsSiblings': 'Anders gedeeld dan de andere items hier',
  'sharing.alone.extra': 'extra:',
  'sharing.alone.missing': 'ontbreekt:',
  'sharing.notPlacedYet':
    'Niet per map gegroepeerd: uw oude systeem gaf niet aan in welke map elk item staat.',
  'tenants.title': 'Team & organisatie',
  'tenants.intro':
    'Wie zich bij deze organisatie kan aanmelden en wat zij mogen.',
  'tenants.noTenant': 'Geen organisatie in deze sessie.',
  'tenants.selfDemotionArmed':
    'Hiermee verlaagt u uw eigen rol; u kunt dit mogelijk niet zelf terugdraaien.',
  'tenants.selfDemotionConfirm': 'Bevestig rolwijziging',
  'tenants.org.heading': 'Organisatie',
  'tenants.org.phone': 'Telefoonnummer',
  'tenants.org.phone.hint': 'Optioneel; getoond aan wie u een toegangslink stuurt.',
  'tenants.org.phone.save': 'Opslaan',
  'tenants.org.phone.saved': 'Opgeslagen.',
  'tenants.org.phone.none': 'Niet opgegeven.',
  'tenants.org.readError':
    'De gegevens van de organisatie konden niet worden gelezen.',
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
  'tenants.members.actionsHeader': 'Acties',
  'tenants.members.remove': 'Verwijderen',
  'tenants.members.removeArmed': 'Bevestig verwijderen',
  'tenants.members.resend': 'Opnieuw sturen',
  'tenants.readOnly': 'Uw rol hier is alleen-lezen. Een eigenaar of beheerder beheert de leden.',
  'tenants.invite.heading': 'Iemand uitnodigen',
  'tenants.invite.hint': 'We mailen hoe zij zich aanmelden; hierboven staan ze als uitgenodigd.',
  'tenants.invite.mail.sent': 'Uitnodiging gemaild naar {email}.',
  'tenants.invite.mail.off':
    'Uitnodiging voor {email} opgeslagen, maar deze installatie verstuurt geen e-mail: vertel het hun zelf.',
  'tenants.invite.mail.failed':
    'Uitnodiging voor {email} opgeslagen, maar de e-mail kon niet worden verstuurd. Stuur opnieuw, of vertel het hun zelf.',
  'tenants.invite.mail.limited':
    'Uitnodiging voor {email} opgeslagen, maar de uitnodigingsmails van vandaag zijn op. Stuur morgen opnieuw, of vertel het hun zelf.',
  'tenants.invite.email': 'E-mailadres',
  'tenants.invite.role': 'Rol',
  'tenants.invite.adminCan':
    'Een beheerder kan alles wat een eigenaar kan, behalve de organisatie sluiten of heropenen, handmatig verwijderen of het automatisch verwijderen van oude kopieën van inmiddels verplaatste bestanden aan- of uitzetten, iemand eigenaar maken en een eigenaar een andere rol geven of verwijderen.',
  'tenants.ownerOrAdminOnly': 'Tijdens de Alpha kan iemand alleen eigenaar of beheerder zijn.',
  'tenants.notify.heading': 'E-mailsamenvattingen',
  'tenants.notify.intro':
    'Hoe vaak u een samenvatting krijgt toegestuurd.',
  'tenants.notify.intro.more': 'Stilte betekent dat er geen beslissingen op u wachten.',
  'tenants.notify.cadence': 'Samenvatting',
  'tenants.notify.daily': 'Dagelijks',
  'tenants.notify.weekly': 'Wekelijks',
  'tenants.notify.off': 'Geen samenvatting',
  'tenants.notify.locale': 'Taal',
  'tenants.notify.recipients':
    'Gaat naar elke eigenaar en beheerder hieronder; dringende gebeurtenissen worden direct gemaild.',
  'tenants.notify.saved': 'Opgeslagen.',
  'tenants.notify.readError':
    'De instelling kon niet worden gelezen, probeer het later opnieuw.',
  'tenants.invite.submit': 'Uitnodigen',
};

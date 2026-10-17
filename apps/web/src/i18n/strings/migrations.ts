// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The migrations list and a migration's own page: its steps, state, runs, pace and what needs attention.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  // ADR-0035 decision 5, the owner's option C (2026-10-03): for an account the
  // person connected through their own grant, the provider's words and the
  // items' names stay off the owner's pages.
  'failure.withheld':
    "The provider's own message is not shown: the person connected this account themselves, and it can name their files. Support can read it by the reference.",
  // The pace, said where a migration is read (workplan 0157 T5): on Free,
  // outside the alpha, one pass a day of at most 50 minutes, the next pass's
  // time on the migration's own page, and the way to more.
  'pace.free.label': 'Free:',
  'pace.free.oneMigration': 'one pass a day, up to 50 minutes.',
  'pace.free.eachMigration': 'one pass a day for each migration, up to 50 minutes.',
  'pace.free.next': 'Next pass: {time}.',
  'pace.free.higher': 'A higher tier migrates pass after pass.',
  // A slower step a visit ended (workplan 0157 T7): the morning mail said
  // *"Everything is in step, so we now look for changes less often"*, and
  // opening the migration brought back the hour. Said once, on that visit.
  'cadence.broughtBack.sixHourly':
    'Everything was in step, so we switched to sync every 6 hours. Opening this migration brought back every hour, for the next 14 days.',
  'cadence.broughtBack.daily':
    'Everything was in step, so we switched to sync once a day. Opening this migration brought back every hour, for 14 days.',
  'cadence.broughtBack.keep': 'To keep it hourly, choose Hourly under How often to look for changes.',
  'mappings.title': 'Migrations',
  'mappings.new': 'Start a migration',
  'mappings.empty.title': 'No migrations yet',
  'mappings.empty.hint': 'Start one: who it is for, where from, what, and where to.',
  'mappings.empty.cta': 'Start a migration',
  'mappings.action.triggerSync': 'Sync now',
  // Free's pace held a press (workplan 0157 T2, `free_pace`): one pass a day,
  // and when the next one starts. The server's `message` is the English.
  'mappings.sync.freePace':
    'On Free a migration runs one pass a day. Its next pass starts at {time}. A higher tier looks for changes as often as every 15 minutes.',
  'mappings.action.pause': 'Pause',
  'hub.connections': 'From {source} to {target}',
  // Where the copies land (0153 open question 5, item 4).
  'hub.lands.folder': 'The copies land in the folder {folder} of the destination.',
  'hub.lands.merged': "The copies land in the destination's own folders.",
  // WHERE ITS FILES START (0153 open question 5, item 4), said beside where
  // the copies land.
  'hub.filesFrom.all': 'Its files are read from {place}.',
  'hub.filesFrom.path': 'Its files are read from {folder} only.',
  'hub.filesFrom.id': 'Its files are read from one folder only: {folder}.',
  'hub.details': 'Details',
  'hub.migrationId': 'Migration ID:',
  'timeLeft.label': 'How long:',
  'timeLeft.gmailDays': 'About {low} to {high} days, because Google lets a mailbox download {ceiling} GB a day.',
  'timeLeft.gmailWithinADay':
    'Within a day, because this mailbox holds less than the {ceiling} GB Google lets one download a day.',
  'timeLeft.notKnownYet': 'Depends on the provider; we will know after the first hour.',
  'timeLeft.filesLater': 'The files: we will know after the first hour.',
  'timeLeft.copying.days': 'About {low} to {high} days more, from the last {n} passes.',
  'timeLeft.copying.hours': 'About {low} to {high} hours more, from the last {n} passes.',
  'timeLeft.copying.upToDays': 'Up to {high} days more, from the last {n} passes.',
  'timeLeft.copying.upToHours': 'Up to {high} hours more, from the last {n} passes.',
  'timeLeft.slowedBy': 'Slowed by {provider}.',
  'timeLeft.afterThreePasses': 'We will know after three passes; {n} so far.',
  'mappings.action.pause.why':
    'No new passes are started. A pass already running stops migrating new items within about fifteen seconds, and finishes the ones it has begun; a very large file can take longer. Nothing is lost: Review and start continues from where it stopped.',
  'mappings.action.startSync': 'Sync now',
  // 0037 T2: a paused mapping's row leads to the confirm screen — the Play
  // button it used to render could only earn a 409.
  'mappings.action.reviewAndStart': 'Review and start',
  'mappings.action.delete': 'Delete',
  // 0037 T5: mapping deletion destroys config and ledger linkage, so the
  // button arms with the mapping's own name (hard rule 2's posture).
  // WHAT GOES, AND WHAT IS NOT TOUCHED (owner, 2026-09-03). The old sentence
  // asked for the migration's name to be typed, which is the gate you build
  // for something unrecoverable. This removes rows in our own database; the
  // mail, calendars and files at either provider are not reached at all.
  // Saying which is which is the part that makes one press enough.
  // WHAT SETTING IT UP AGAIN DOES (owner, 2026-09-23). The fold ended "copies
  // nothing twice", the half that sounds safe. A new migration does recognise
  // what is already there (ADR-0020: the writers match by Message-ID, UID or
  // path), but a match is ADOPTED, and an adopted item never follows its
  // source again (`classifyKnownItem` answers 'leave-adopted'). A copy that
  // was deleted or moved on the new side matches nothing, so it is copied
  // back. Pausing keeps the record, and with it the updates.
  'mappings.delete.explain':
    'Removes the migration’s settings and record; nothing at your source or destination is touched.',
  'mappings.delete.more':
    'No mail, calendars, tasks, contacts or files are deleted anywhere. Set the same migration up again later and it recognises what is already there and migrates only what is new. What it finds already there is no longer updated when it changes at the source, and anything you deleted or moved on the new side comes back. To keep changes flowing, pause the migration instead.',
  'mappings.delete.confirm': 'Delete migration',
  'mappings.delete.cancel': 'Cancel',
  'mappings.delete.failed': 'The migration was not deleted.',
  'evidence.reported.title': 'The source itself reported the object gone.',
  'evidence.trashed.title': 'Found in the owner’s Deleted Items.',
  'evidence.inferred.title': 'Missing from complete scans: a suspicion, never applied.',
  'guidance.summary': 'What this means and what you can do',
  'lifecycle.paused': 'This migration has not started (paused).',
  // *Rename* beside a migration's title (0153 open question 5, item 4).
  'hub.rename': 'Rename',
  'hub.rename.label': 'Name of this migration',
  'hub.rename.save': 'Save',
  'hub.rename.saving': 'Saving…',
  'hub.rename.failed': 'Not renamed:',
  'hub.fallbackTitle': 'Migration',
  'hub.orderIntro': 'Work them from the top, in this order.',
  'hub.noId': 'No mapping id in the address.',
  'hub.detailError': "Could not read this migration's details.",
  'hub.detailError.retry': 'Try again',
  'hub.grantWithdrawn':
    'On {date} the person being migrated withdrew their access. Nothing reads or migrates their account now.',
  'hub.grantWithdrawn.next': 'If they agree to continue, send them a new grant link. Links are made per person: see Links below.',
  'hub.deletions.name': 'Deletions',
  'hub.deletions.blurb': 'Deleted on the old system, still on the new; your call, per item.',
  'hub.moves.name': 'Moves',
  'hub.moves.blurb':
    'Items the old system reorganised since they were copied. An old copy goes only when you remove it, or by automatic removal (if you turned that on).',
  'hub.failures.name': 'Failures',
  'hub.failures.blurb':
    'Items that could not be migrated and now wait for you to decide. These block finishing.',
  'hub.sharing.name': 'Sharing',
  'hub.sharing.blurb':
    'Who could reach shared content on the old system; a checklist worked after finishing.',
  'hub.check.name': 'Check',
  'hub.check.blurb':
    'Compare the two systems and sample the content.',
  'hub.confirmed.name': 'Confirmed',
  'hub.confirmed.blurb':
    'What is in the new home, item by item, and what was compared.',
  'hub.finish.name': 'Finish',
  // Under each step page of a migration, the way on to the next (NextStepLink).
  'hub.nextStep': 'Next step: {step} →',
  'hub.finish.blurb':
    'The cutover checklist, to end the migration.',
  'runs.title': 'Run history',
  'runs.blurb':
    'Every sync pass this migration has made, newest first, with what each one said.',
  'runs.empty': 'No passes have run yet. History appears after the first sync.',
  'runs.truncated': 'Showing the newest passes only — older ones exist but are not listed.',
  'runs.eventsTruncated': 'Newest log entries only — earlier ones are not shown.',
  'runs.error': "Could not read this migration's run history.",
  'runs.items.one': '1 item this pass',
  'runs.items.many': '{n} items this pass',
  'runs.errors.one': '1 error',
  'runs.errors.many': '{n} errors',
  'runs.events': 'Log',
  // An answer the page's schema refused, on a signed-in page (reported
  // 2026-09-29): `serverMessage` says this where it used to show zod's JSON,
  // most likely after the API and the web app were updated apart. {reference}
  // is the one the server keeps the report under, with where the answer did
  // not fit (`unreadable-answer.ts`). The owner's wording, both languages
  // (2026-09-29), and the owner's "Log it" for the reference.
  'answer.unreadable':
    'The server answered in a form this page does not know. Reload the page; if it stays like this, report it to support, and mention: reference {reference}.',
  // A fault on our side (a 500 whose sentence carries `Reference 0a1b2c3d`,
  // `serverFault`): the server's sentence is English only, so `serverMessage`
  // says this in the reader's language and keeps the reference, in the same
  // capitalised form, so it can be quoted to us.
  'answer.fault':
    'Something went wrong on our side, not something your input caused. Try again in a moment. Reference {reference}: mention it when you contact us.',
  // A request that got no answer, or a gateway's (502, 503, 504) with no
  // sentence of ours in it (the owner, 2026-10-14): axios's English
  // ("Network Error", "Request failed with status code 502") reached the
  // screen in either language. `serverMessage` says this instead, in the
  // words `acceptance.unreachable` already used, and keeps axios's own words
  // in the browser console.
  'answer.unreachable': 'The service could not be reached. Check your connection and try again.',
  // The progress page (workplan 0122). The SAME reader as the grant page above
  // — no account, no jargon, second person — asking a different question:
  // has my mail arrived yet. So the states are sentences rather than the
  // operator's chips, and every count says what it counts.
  'view.title': 'Your migration',
  'view.loading': 'One moment…',
  'view.who': '{organisation} is migrating your account / content to a new provider.',
  'view.state.active': 'Your things are being migrated across now.',
  'view.state.paused': 'Copying is on hold at the moment.',
  'view.state.cutover': 'Your new account is now the one in use.',
  'view.state.done': 'Your migration is finished.',
  'view.state.continuous': 'Anything new is still kept in sync for you.',
  'view.notStarted': 'Nothing has been copied yet.',
  'view.notStarted.why':
    'Migration has not started, so there is nothing to count here yet. That is normal for the first day or two: a migration begins once everything it needs is connected, and this page fills in on its own. Nothing is missing and nothing has gone wrong.',
  'view.copied.one': '{count} migrated',
  'view.copied.many': '{count} migrated',
  'view.upToDate': 'Up to date as of {date}.',
  'view.lastWorked': 'Still migrating; last worked on {date}.',
  'view.notYet': 'Not started yet.',
  'view.attention.one': '{count} item needs someone to look at it.',
  'view.attention.many': '{count} items need someone to look at them.',
  'view.retrying.one': '{count} item is being tried again.',
  'view.retrying.many': '{count} items are being tried again.',
  'view.moved': '{bytes} moved so far.',
  // Every failure category, re-voiced for a reader who cannot act on them
  // — see i18n/view-failure-key.ts. Never the provider's own prose: that
  // names files, and it does not cross (workplan 0122 §3).
  'view.failure.authExpired': 'The connection to your account needs renewing. Whoever set this up can do it.',
  'view.failure.rateLimited': 'Your provider automatically asked us to slow down. This carries on by itself.',
  'view.failure.quotaExceeded': 'A daily limit was reached. Migration resumes tomorrow on its own.',
  'view.failure.policyRefused':
    'Some items were left out by this migration\u2019s own settings, not by either account.',
  'view.failure.tooLarge':
    'Some files were left out: they are larger than this service migrates during the Alpha.',
  'view.failure.sourceRefused':
    'Your old account would not release some items. Nothing was sent to your new account.',
  'view.failure.targetRefused': 'Your new account would not accept some items.',
  'view.failure.formatRefused':
    'Your new account refuses some file types. Whoever set this up can change that.',
  'view.failure.network': 'A server could not be reached. This is usually brief and retries itself.',
  'view.failure.unknown':
    'Something went wrong that the system does not know yet. Whoever runs this migration may be able to see more.',
  'view.failure.side.source': 'It was your old account.',
  'view.failure.side.target': 'It was your new account.',
  'view.until': 'This page works until {date}.',
  'view.readOnly': 'This page only shows numbers; it holds nothing from your account.',
  // Taking the access back (workplan 0108 T8 (c)). The same reader and the same
  // words as the grant page: "access", given and withdrawn, second person.
  'view.state.withdrawn': 'Migrating stopped: on {date} you withdrew the access you gave.',
  'view.grant.title': 'The access you gave',
  'view.grant.body': '{organisation} reads your Google account for this migration because you allowed it.',
  'view.grant.whatHappens': 'Withdrawing stops the migrating. What was already copied over stays where it was copied to.',
  'view.grant.wholeApp': 'Google withdraws it for the whole app, so any other migration you allowed stops too.',
  'view.grant.withdraw': 'Withdraw access',
  'view.grant.confirm': 'Withdraw it now? Continuing later needs a new link from whoever sent this one.',
  'view.grant.confirmYes': 'Yes, withdraw it',
  'view.grant.keep': 'Keep it',
  'view.grant.withdrawing': 'Withdrawing…',
  'view.withdrawn.revoked': 'Done. Google confirmed the access is withdrawn, and it is deleted here as well.',
  'view.withdrawn.notConfirmed': 'Deleted here, so this migration cannot use it. Google did not confirm withdrawing it.',
  'view.withdrawn.removeYourself': 'To be sure, remove the app yourself from the apps with access:',
  'view.withdrawn.since': 'Nothing more is read from your account. To resume later, ask for a new link.',
  'view.withdrawn.check': 'Your Google account lists the apps that still have access:',
  // A PERSON'S progress page (ADR-0035, amended 2026-09-29; 0153 T5 (b), slice 3).
  'view.person.title': 'Your migrations',
  'view.person.who': '{organisation} is moving your accounts to new providers. Here is where each migration stands.',
  'view.person.none': 'There are no migrations here yet.',
  'view.person.account.only': 'Your Google account',
  'view.person.account': 'Google account {n}',
  'view.person.others': 'Your other migrations',
  'view.person.route': '{from} to {to}',
  'view.person.routeWhat': '{route}: {what}',
  'view.person.grant.body': '{organisation} reads this Google account for the migrations above because you allowed it.',
  'view.person.withdrawn.notConfirmed':
    'Deleted here, so these migrations cannot use it. Google did not confirm withdrawing it.',
  'state.lifecycle.active': 'Active',
  'state.lifecycle.paused': 'Paused',
  'state.lifecycle.cutover': 'In cutover',
  'state.lifecycle.done': 'Done',
  'state.lifecycle.continuous': 'Continuous',
  // Workplan 0154 T1 (a): where a migration is, in a person's words
  // (`stageOf`, shared). The glossary's Stage row is the decision.
  'state.stage.not_started': 'Not started',
  'state.stage.paused': 'Paused',
  'state.stage.copying': 'Copying',
  'state.stage.kept_in_step': 'Kept in step',
  'state.stage.ready_to_switch': 'Ready to switch',
  'state.stage.switching': 'Switching',
  'state.stage.done': 'Done',
  'state.invoice.draft': 'Being prepared',
  'state.invoice.sent': 'Sent',
  'state.invoice.paid': 'Paid',
  'state.invoice.overdue': 'Overdue',
  'state.invoice.void': 'Void',
  'state.link.live': 'Live',
  'state.link.used': 'Granted',
  'state.link.revoked': 'Revoked',
  'state.link.expired': 'Expired unused',
  'runs.status.pending': 'Pending',
  'runs.status.running': 'Running',
  'runs.status.success': 'Succeeded',
  'runs.status.failed': 'Failed',
  'runs.status.cancelled': 'Cancelled',
  'mappings.filtered.lead': 'Showing only:',
  'mappings.filtered.clear': 'Show all migrations',
  'mappings.loadFailed': 'Could not load the migrations list.',
  'mappings.syncFailed': 'The sync request did not complete.',
  // Every failure category (workplan 0110 T3). Each is a SENTENCE with a
  // remedy, not a label: the owner's reframing made the customer the primary
  // reader, and nobody can act on the words "auth expired". The raw provider
  // message still renders verbatim beside these — this is the actionable
  // half, not a replacement for the precise one.
  // Names the Connections page's own buttons, verbatim (workplan 0140 T2 (b)):
  // Reconnect on a row whose kind has a consent button, Replace credentials on
  // every other, since this category covers a refused password too. It said
  // "Reconnect" before any button did. Which button a row shows follows its
  // KIND, not what it stores (a Gmail row with an app password says
  // Reconnect), so the sentence leaves the choice to the row and says nothing
  // about passwords.
  'failure.authExpired':
    'The connection to this account has expired. On the Accounts page, press Reconnect or Replace credentials, whichever its row shows, and this will carry on from where it stopped \u2014 nothing is lost.',
  // The link after that sentence, to the Accounts page it names.
  'failure.openAccounts': 'Open Accounts',
  'failure.rateLimited':
    'The provider asked us to slow down. Nothing is wrong: this pauses and resumes on its own.',
  'failure.quotaExceeded':
    'This account has reached what its provider allows for one day. It resumes tomorrow on its own \u2014 no action needed.',
  // The ninth category (0125 T4). The ONLY remedy on this screen that names
  // something the reader owns: their own migration's settings. It says which
  // setting, because "change the policy" without naming the field is the
  // remedy the owner already could not carry out.
  //
  // REWORDED BY THE OWNER, 2026-09-22 — "the text is way too long". It names
  // the setting by the words on its own screen (`settings.exportPolicy`) and
  // the button by its own label (`failures.retry`), so a reader can find both.
  'failure.policyRefused':
    'Not migrated yet: Google files in a format the new account cannot receive. Choose one both sides can handle under Export format for Google files, then press Try again \u2014 or leave these items behind.',
  // The same category on a DROPBOX migration (workplan 0150 D9, the owner's
  // choice of 2026-09-26): a Paper doc, which Dropbox hands over only as an
  // export. Since 0150 T3 (d) it names the setting that exports one, by the
  // words on its screen (`settings.exportPolicy.paper`), and the button by its
  // label, as Drive's sentence above does; Drive's stays as the owner worded
  // it. The other kinds of Dropbox's own are exported by no setting, so the
  // second sentence keeps their remedy. `remedyKey` chooses by source.
  'failure.policyRefused.dropbox':
    'Not migrated yet: Dropbox Paper docs, which Dropbox hands over only as an export. Choose a format under Export format for Paper docs, then press Try again \u2014 or leave these items behind. Other documents Dropbox keeps in a format of its own are not exported here: export them from Dropbox yourself, or leave them behind.',
  // The tenth category (0143 T4), the owner's choice of 2026-09-27: a file
  // larger than this service copies, refused before a byte was read. No
  // setting changes the answer, so the remedy names none.
  'failure.tooLarge':
    'Not migrated: larger than this service copies during the Alpha. Copy these files by hand, or leave them behind.',
  // Also shortened on 2026-09-22 from the owner's draft, but kept GENERAL: this
  // category is not Drive's alone — a mail or calendar source that refuses an
  // item lands here too — so the owner's "like maps" belongs in the per-item
  // reason Drive writes, not in a sentence every domain shares.
  //
  // "Nothing to check there" SURVIVES the cut, and is not decoration. It is
  // why this category exists apart from `target_refused` (migration 0048):
  // the two read alike, and the wrong one sent people to audit a destination
  // that was never sent the file. The first shortening dropped it and the
  // Failures page test caught it.
  'failure.sourceRefused':
    'Not migrated: the old account would not hand this over, so nothing was migrated to the new one \u2014 there is nothing to check there. Try again if that has changed, or leave these items behind.',
  // The last clause was added on 2026-09-17, when two contacts were refused
  // with a bare `TypeError` five times over and the only readable account of
  // WHY was in the customer's own Nextcloud log. Nothing on this screen pointed
  // there, so the reader had a remedy naming three things that were all fine.
  //
  // "No space left" was "a full mailbox" until 2026-09-23, when the owner read
  // it under a file: "the text talking about 'full mailbox' is weird to read at
  // the Files-kind." Every remedy is shown under every kind, so none may name
  // one kind's storage.
  //
  // "A limit on the size of one upload" was added on 2026-10-03 (workplan
  // 0156). The owner's four largest files were refused with 413 by a
  // Nextcloud whose web server takes one request of at most 1 GiB, and the
  // three causes this named were all fine. The item's own reason names the
  // file's size and the setting; this is the line a whole group shares.
  'failure.targetRefused':
    'The destination refused to accept this. Common causes are no space left, a limit on the size of one upload, a read-only folder or missing permission on the target account. If it answered with an internal error, the reason is in the destination\u2019s own log rather than in what it sent back.',
  // "Rename it in the old account" was added on 2026-09-23. The export format
  // is a remedy only for a Google file, and a name the destination will never
  // store (Nextcloud refuses `.htaccess`) can come from any source.
  'failure.formatRefused':
    'The destination will not accept this KIND of file. The account itself is fine \u2014 it is this file\u2019s format or name that is not allowed there. Rename it in the old account, change the export format on the mapping, or leave these items behind.',
  'failure.network':
    'We could not reach the server. This is usually brief, and it retries by itself.',
  // The one whose text must carry the way OUT of self-service.
  'failure.unknown':
    'We could not classify this one. The provider\u2019s own message is below \u2014 if it does not help, send it to us and we will look.',
  // The link that sentence's last clause promises (0130 T3): the report form,
  // with the failure's category and reference filled in.
  'failure.sendItToUs': 'Send it to us',
  // Which SIDE it happened on, when the pass could tell (0094 T5): said after
  // the remedy, so "reconnect it" points at the right account.
  // The reference the failure was recorded under (0129 T1), what a person
  // quotes when they report it.
  'failure.reference': 'Reference: {reference}',
  'failure.side.source': 'It happened on the source side.',
  'failure.side.target': 'It happened on the destination side.',
  // One state, three reasons (see pause-reason.ts); the sentence says which.
  'pause.ceiling':
    '{provider} reached its daily download limit. Migration continues after {resets}.',
  // Same fact, no window to name: the meter reported no running window, and
  // inventing a time would be worse than saying "when it resets".
  'pause.ceiling.unknown':
    '{provider} reached its daily download limit. Migration continues when that resets.',
  'pause.ceiling.why':
    'The limit belongs to your old provider, not ours. Moving past it can lock you out of your own live mailbox for about a day, so copying stops before that happens. Nothing has failed and nothing is lost — the next pass carries on where this one stopped.',
  'pause.dataCeiling':
    'New items wait at your data ceiling of {ceiling}: {held} not copied yet. Changes to what is already copied carry on.',
  'pause.dataCeiling.moveUp': 'Move up to {tier}: €{monthly} a month.',
  'pause.dataCeiling.topUp': 'Or buy another {band} once, for €{price}.',
  'pause.dataCeiling.why':
    'Every step up is your choice: nothing moves your tier or adds data room without your yes. Choose on the Billing page, and copying carries on from where it stopped.',
  'pause.hold.heading': 'Copying is paused',
  // The DEFAULT sentence: always present, so a hold is never wordless when
  // nobody typed one. An operator's own words replace it, verbatim.
  'pause.hold.default': 'We have paused copying while we update the platform.',
  'pause.hold.since': 'Paused since',
  // "By itself" is said of the SCHEDULED passes only (0132 T6 (b)): a button
  // pressed during the hold is refused with the operator's sentence and not
  // remembered, so nothing restarts it.
  'pause.hold.why':
    'Nothing is wrong with your migration and nothing is lost. Migrations already running finish normally, and scheduled copying picks up again by itself once the update is done. Any migrations you tried to start during the pause did not start: start them again after the update.',
  // THE DOOR INTO THE CONTINUOUS LANE (workplan 0117 T1 slice 3), and the
  // sentence that had to exist before it (T5, owner's words 2026-09-10).
  //
  // `holdsASlot` returns true for `continuous` (D6): a path that keeps copying
  // keeps its capacity slot, so the tier does NOT fall the way finishing makes
  // it fall. The pricing page says the same thing in the same breath as
  // "finishing lowers your bill", because somebody who believes the price ends
  // when the migration ends and finds a tier still charging has a fair
  // complaint. `.why` is unbudgeted (0118) and carries the whole of it.
  'lane.intro': 'The old account keeps feeding the new one, and nothing is deleted.',
  'lane.why':
    'Your tier will not fall while this runs: the path keeps its slot until you end it, ' +
    'the same as a migration that has not finished. Deletions at the old provider stop ' +
    'being mirrored — anything you remove there stays in your new home. Changes you make ' +
    'there no longer overwrite the copies in your new home. We will not bill past twelve ' +
    'months without asking you again.',
  'lane.confirm': 'Keep syncing, and keep the tier',
  'lane.cancel': 'Not now',
  // The lane on the appliance (0128 D4): the same choice, and no tier to keep.
  'lane.selfhost.why':
    'Deletions at the old provider stop being mirrored — anything you remove there stays in your new home. People often clean out or close an old account, and mirroring that would risk deleting from your new system. Syncing runs on this appliance until you end it.',
  'lane.selfhost.confirm': 'Keep copying',
  'attention.title': 'Per migration',
  'attention.intro': 'One line per migration, and a link to each thing waiting.',
  'attention.empty': 'Nothing is waiting. Every migration is running by itself.',
  'attention.emptyNoneRunning': 'Nothing is waiting, and no migration is running.',
  'attention.organisation': 'Your organisation',
  'attention.quiet': '{count} running by themselves, with nothing waiting.',
  'attention.decisions': 'changes needing a decision',
  'attention.deletions': 'deletions to confirm',
  'attention.moves': 'moves to acknowledge',
  'attention.failures': 'items that could not be copied',
  'attention.readyForCutover': 'checked and ready to finish',
  // A grace period that ended while nobody chose (0128 D7, T5 slice 7c).
  'attention.graceEnded': 'grace period over and nobody chose, so no longer copying: {kinds}',
  'attention.sharingOpen': 'rows open on the sharing checklist',
  'attention.couldNotRead': 'One queue could not be read, so these numbers may be low.',
  'attention.couldNotRead.why':
    'The count shown is what we were able to read, not what is there — a queue system we could not read is reported as unreadable rather than as empty. The reason one gave is listed beneath it, in the words the server used.',
  'attention.failed': 'This list could not be loaded... try refreshing the page.',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'failure.withheld':
    'De eigen melding van de aanbieder wordt niet getoond: de persoon heeft dit account zelf gekoppeld, en die melding kan hun bestanden vermelden. Support kan de melding lezen via de referentie.',
  'pace.free.label': 'Free:',
  'pace.free.oneMigration': 'één ronde per dag, van maximaal 50 minuten.',
  'pace.free.eachMigration': 'één ronde per dag voor elke migratie, van maximaal 50 minuten.',
  'pace.free.next': 'Volgende ronde: {time}.',
  'pace.free.higher': 'Een hoger pakket migreert ronde na ronde.',
  'cadence.broughtBack.sixHourly':
    'Alles was bijgewerkt, dus we gingen het iets rustiger aan doen en keken nog slechts iedere 6 uur naar nieuwe items en wijzigingen. Nu u deze migratie hebt geopend, kijken we 14 dagen lang weer elk uur.',
  'cadence.broughtBack.daily':
    'Alles was bijgewerkt, dus we gingen het iets rustiger aan doen en keken nog eenmaal per dag naar nieuwe items en wijzigingen. Nu u deze migratie hebt geopend, kijken we 14 dagen lang weer elk uur.',
  'cadence.broughtBack.keep': 'Wilt u dat het elk uur blijft, kies dan Elk uur onder Frequentie om naar wijzigingen te kijken.',
  'mappings.title': 'Migraties',
  'mappings.new': 'Migratie starten',
  'mappings.empty.title': 'Nog geen migraties',
  'mappings.empty.hint': 'Start er een: voor wie gaan we wat migreren?',
  'mappings.empty.cta': 'Migratie starten',
  'mappings.action.triggerSync': 'Synchroniseer nu',
  'mappings.sync.freePace':
    'Free omvat één migratieronde per dag. De volgende ronde begint op {time}. Een hoger pakket kijkt zo vaak als tot elke 15 minuten naar wijzigingen en migreert deze.',
  'mappings.action.pause': 'Pauzeren',
  'hub.connections': 'Van {source} naar {target}',
  'hub.lands.folder': 'De bestanden komen in de map {folder} van de bestemming.',
  'hub.lands.merged': 'De bestanden komen in de eigen mappen van de bestemming.',
  'hub.filesFrom.all': 'De bestanden worden uit {place} gelezen.',
  'hub.filesFrom.path': 'De bestanden worden alleen uit {folder} gelezen.',
  'hub.filesFrom.id': 'De bestanden worden alleen uit één map gelezen: {folder}.',
  'hub.details': 'Details',
  'hub.migrationId': 'Migratie-ID:',
  'timeLeft.label': 'Hoe lang:',
  'timeLeft.gmailDays': 'Ongeveer {low} tot {high} dagen, omdat Google een limiet hanteert per mailbox van {ceiling} GB per dag.',
  'timeLeft.gmailWithinADay':
    'Binnen een dag, omdat deze mailbox minder bevat dan de limiet van {ceiling} GB per dag die Google hanteert.',
  'timeLeft.notKnownYet': 'Hangt af van de aanbieder; na het eerste uur weten we het.',
  'timeLeft.filesLater': 'Bestanden: na het eerste uur weten we het.',
  'timeLeft.copying.days': 'Ongeveer nog {low} tot {high} dagen, volgens de laatste {n} rondes.',
  'timeLeft.copying.hours': 'Ongeveer nog {low} tot {high} uur, volgens de laatste {n} rondes.',
  'timeLeft.copying.upToDays': 'Hoogstens nog {high} dagen, volgens de laatste {n} rondes.',
  'timeLeft.copying.upToHours': 'Hoogstens nog {high} uur, volgens de laatste {n} rondes.',
  'timeLeft.slowedBy': 'Vertraagd door {provider}.',
  'timeLeft.afterThreePasses': 'Na drie rondes weten we meer; {n} tot nu toe.',
  'mappings.action.pause.why':
    'Er worden geen nieuwe rondes gestart. Een ronde die nog loopt gaat niets nieuws aanvangen en rondt af wat nog liep; een heel groot bestand dat al onderweg was, kan nog even duren. Er gaat niets verloren: Controleer en start gaat verder waar het gebleven was.',
  'mappings.action.startSync': 'Synchroniseer nu',
  'mappings.action.reviewAndStart': 'Controleer en start',
  'mappings.action.delete': 'Verwijderen',
  'mappings.delete.explain':
    'Verwijdert enkel instellingen en registratie van uw migratie in Ownpace, niets bij uw bron of bestemming.',
  'mappings.delete.more':
    'Er worden nergens e-mail, agenda, taken, contacten of bestanden verwijderd. Stelt u later dezelfde migratie opnieuw in, dan wordt herkend wat u al in uw doelsysteem had staan, en migreert alleen wat nieuw is. Let op: wat er al stond, wordt niet meer bijgewerkt vanuit wijzigingen in uw bron, en wat u aan de nieuwe kant hebt verwijderd of verplaatst, komt terug. Wilt u wijzigingen blijven meenemen, pauzeer dan de migratie in plaats van die te verwijderen.',
  'mappings.delete.confirm': 'Migratie verwijderen',
  'mappings.delete.cancel': 'Annuleren',
  'mappings.delete.failed': 'De migratie is niet verwijderd.',
  'evidence.reported.title': 'De bron zelf meldde het object als verwijderd.',
  'evidence.trashed.title': 'Gevonden in Verwijderde items van de bron.',
  'evidence.inferred.title': 'Ontbreekt in volledige scans: een vermoeden, nooit toegepast.',
  'guidance.summary': 'Wat dit betekent en wat u kunt doen',
  'lifecycle.paused':
    'Deze migratie is niet gestart (pauze).',
  'hub.rename': 'Naam wijzigen',
  'hub.rename.label': 'Naam van deze migratie',
  'hub.rename.save': 'Opslaan',
  'hub.rename.saving': 'Opslaan…',
  'hub.rename.failed': 'Niet hernoemd:',
  'hub.fallbackTitle': 'Migratie',
  'hub.orderIntro': 'Vul stap voor stap in.',
  'hub.noId': 'Geen mapping-id in het adres.',
  'hub.detailError':
    'De details van deze migratie konden niet worden gelezen.',
  'hub.detailError.retry': 'Opnieuw proberen',
  'hub.grantWithdrawn': 'Op {date} trok degene die gemigreerd wordt de toegang in. Er wordt niets meer gelezen of gemigreerd.',
  'hub.grantWithdrawn.next':
    'Is die persoon akkoord om verder te gaan, stuur dan een nieuwe toegangslink. Links worden per persoon gemaakt: zie Links hieronder.',
  'hub.deletions.name': 'Verwijderingen',
  'hub.deletions.blurb':
    'Verwijderd op het oude systeem, nog op het nieuwe; beslis per item.',
  'hub.moves.name': 'Verplaatsingen',
  'hub.moves.blurb':
    'Items die het oude systeem heeft herschikt sinds de migratie. Een bestand in uw doelsysteem dat had moeten meeverplaatsen, kunt u handmatig verwijderen, of automatisch als u dat hebt aangezet.',
  'hub.failures.name': 'Mislukkingen',
  'hub.failures.blurb':
    'Items die niet gemigreerd konden worden en op uw beslissing wachten; ze blokkeren het afronden.',
  'hub.sharing.name': 'Delen',
  'hub.sharing.blurb':
    'Wie wat kon bereiken op het oude systeem; een checklist voor na het afronden.',
  'hub.check.name': 'Verificatie',
  'hub.check.blurb':
    'Vergelijk de twee systemen en controleer steekproeven van de inhoud.',
  'hub.confirmed.name': 'Bevestigd',
  'hub.confirmed.blurb':
    'Wat er in het nieuwe systeem staat, item voor item, en wat is vergeleken.',
  'hub.finish.name': 'Afronden',
  'hub.nextStep': 'Volgende stap: {step} →',
  'hub.finish.blurb':
    'De cutover-checklist; beëindigt de migratie in enkele stappen.',
  'runs.title': 'Uitvoeringsgeschiedenis',
  'runs.blurb':
    'Iedere synchronisatieronde van deze migratie, nieuwste eerst, met wat elke ronde meldde.',
  'runs.empty': 'Er zijn nog geen rondes uitgevoerd. Geschiedenis verschijnt na de eerste synchronisatie.',
  'runs.truncated': 'Alleen de nieuwste rondes worden getoond — oudere bestaan, maar staan niet in de lijst.',
  'runs.eventsTruncated': 'Alleen de nieuwste logregels — eerdere worden niet getoond.',
  'runs.error': 'Kon de uitvoeringsgeschiedenis van deze migratie niet lezen.',
  'runs.items.one': '1 item in deze ronde',
  'runs.items.many': '{n} items in deze ronde',
  'runs.errors.one': '1 fout',
  'runs.errors.many': '{n} fouten',
  'runs.events': 'Logboek',
  'answer.unreadable':
    'De server antwoordde in een vorm die deze pagina niet kent. Laad de pagina opnieuw; blijft het zo, meld dit en geef daarbij het volgende door: referentie {reference}.',
  'answer.fault':
    'Er ging bij ons iets mis, niet door iets wat u invoerde. Probeer het zo opnieuw. Referentie {reference}: noem die als u contact met ons opneemt.',
  'answer.unreachable': 'De dienst was niet bereikbaar. Controleer uw verbinding en probeer het opnieuw.',
  'view.title': 'Uw migratie',
  'view.loading': 'Een moment…',
  'view.who': '{organisation} migreert uw account naar een nieuwe provider.',
  'view.state.active': 'De migratie is actief.',
  'view.state.paused': 'Het migreren ligt op dit moment stil.',
  'view.state.cutover': 'U bent overgestapt naar uw nieuwe omgeving.',
  'view.state.done': 'Uw migratie is klaar.',
  'view.state.continuous': 'Wat nieuw binnenkomt op uw oude omgeving, wordt nog steeds in sync gehouden.',
  'view.notStarted': 'Er is nog niets gemigreerd.',
  'view.notStarted.why':
    'Het migreren is nog niet aangevangen, dus er valt nog niets te tellen. Dat is normaal in de eerste dag of twee: een migratie start zodra alles wat daarvoor nodig is, binnen is. Deze pagina vult zich verder vanzelf. Er ontbreekt niets en er is niets misgegaan.',
  'view.copied.one': '{count} gemigreerd',
  'view.copied.many': '{count} gemigreerd',
  'view.upToDate': 'Bijgewerkt tot {date}.',
  'view.lastWorked': 'Nog bezig; laatst gewerkt op {date}.',
  'view.notYet': 'Nog niet begonnen.',
  'view.attention.one': 'Bij {count} item moet iemand even kijken.',
  'view.attention.many': 'Bij {count} items moet iemand even kijken.',
  'view.retrying.one': '{count} item wordt opnieuw geprobeerd.',
  'view.retrying.many': '{count} items worden opnieuw geprobeerd.',
  'view.moved': 'Tot nu toe {bytes} overgezet.',
  'view.failure.authExpired': 'De koppeling met uw account moet worden vernieuwd. Wie dit heeft ingesteld kan dat.',
  'view.failure.rateLimited': 'Uw provider vroeg ons (geautomatiseerd) rustiger aan te doen. Dit gaat vanzelf verder.',
  'view.failure.quotaExceeded': 'Een daglimiet is bereikt. Morgen gaat het migreren vanzelf verder.',
  'view.failure.policyRefused':
    'Sommige items konden niet worden gemigreerd door de instellingen van deze migratie, niet door uw accounts.',
  'view.failure.tooLarge':
    'Sommige bestanden konden niet worden gemigreerd: ze zijn groter dan deze dienst tijdens de Alpha aankan.',
  'view.failure.sourceRefused':
    'Uw oude omgeving gaf sommige items niet vrij. Deze gingen niet naar uw nieuwe omgeving.',
  'view.failure.targetRefused': 'Uw nieuwe account kon sommige items niet in ontvangst nemen.',
  'view.failure.formatRefused':
    'Uw nieuwe omgeving accepteert bepaalde bestandstypen niet. Wie dit uitvoert kan de indeling mogelijk aanpassen.',
  'view.failure.network': 'Een server was niet bereikbaar. Dat is meestal van korte duur, er wordt opnieuw geprobeerd.',
  'view.failure.unknown': 'Iets ging mis wat het systeem nog niet kent. Wie dit uitvoert kan er mogelijk meer over zien.',
  'view.failure.side.source': 'Het ging om uw oude account.',
  'view.failure.side.target': 'Het ging om uw nieuwe account.',
  'view.until': 'Deze pagina werkt tot {date}.',
  'view.readOnly': 'Deze pagina toont alleen aantallen; er staat niets uit uw account op.',
  'view.state.withdrawn': 'Het migreren is gestopt: op {date} trok u de gegeven toegang in.',
  'view.grant.title': 'De toegang die u gaf',
  'view.grant.body': '{organisation} leest voor deze migratie uw Google-account, omdat u dat toestond.',
  'view.grant.whatHappens': 'Intrekken stopt de migratie. Wat al gemigreerd was, blijft waar het nu staat.',
  'view.grant.wholeApp': 'Google trekt de gehele toestemming in; andere migraties die u toestond, stoppen ook.',
  'view.grant.withdraw': 'Toegang intrekken',
  'view.grant.confirm': 'Nu intrekken? Later verder gaan kan alleen met een nieuwe link van de afzender.',
  'view.grant.confirmYes': 'Ja, intrekken',
  'view.grant.keep': 'Niet intrekken',
  'view.grant.withdrawing': 'Bezig met intrekken…',
  'view.withdrawn.revoked':
    'Klaar. Google bevestigde dat de toegang is ingetrokken, en hier is die ook verwijderd.',
  'view.withdrawn.notConfirmed': 'Hier verwijderd, dus deze migratie kan die niet gebruiken. Google bevestigde het intrekken niet.',
  'view.withdrawn.removeYourself': 'Verwijder voor de zekerheid zelf de Ownpace-oauth-app in de lijst van apps met toegang bij Google:',
  'view.withdrawn.since': 'Er wordt niets meer uit uw account gelezen. Later verder? Vraag om een nieuwe link.',
  'view.withdrawn.check': 'Uw Google-account toont welke apps nog toegang hebben:',
  // De voortgangspagina van een PERSOON (ADR-0035, gewijzigd 2026-09-29; 0153 T5 (b), deel 3).
  'view.person.title': 'Uw migraties',
  'view.person.who': '{organisation} migreert uw accounts naar nieuwe providers. Hier ziet u hoe elke migratie ervoor staat.',
  'view.person.none': 'Er zijn hier nog geen migraties.',
  'view.person.account.only': 'Uw Google-account',
  'view.person.account': 'Google-account {n}',
  'view.person.others': 'Uw andere migraties',
  'view.person.route': '{from} naar {to}',
  'view.person.routeWhat': '{route}: {what}',
  'view.person.grant.body': '{organisation} leest dit Google-account voor de migraties hierboven, omdat u dat toestond.',
  'view.person.withdrawn.notConfirmed':
    'Hier verwijderd, dus deze migraties kunnen die niet gebruiken. Google bevestigde het intrekken niet.',
  'state.lifecycle.active': 'Actief',
  'state.lifecycle.paused': 'Gepauzeerd',
  'state.lifecycle.cutover': 'Overgestapt',
  'state.lifecycle.done': 'Afgerond',
  'state.lifecycle.continuous': 'Doorlopend',
  'state.stage.not_started': 'Nog niet gestart',
  'state.stage.paused': 'Gepauzeerd',
  'state.stage.copying': 'Wordt gemigreerd',
  'state.stage.kept_in_step': 'Wordt bijgehouden',
  'state.stage.ready_to_switch': 'Klaar om over te stappen',
  'state.stage.switching': 'Bezig met overstappen',
  'state.stage.done': 'Afgerond',
  'state.invoice.draft': 'Wordt opgemaakt',
  'state.invoice.sent': 'Verzonden',
  'state.invoice.paid': 'Betaald',
  'state.invoice.overdue': 'Achterstallig',
  'state.invoice.void': 'Vervallen',
  'state.link.live': 'Actief',
  'state.link.used': 'Toegang gegeven',
  'state.link.revoked': 'Ingetrokken',
  'state.link.expired': 'Ongebruikt verlopen',
  'runs.status.pending': 'In afwachting',
  'runs.status.running': 'Wordt uitgevoerd',
  'runs.status.success': 'Geslaagd',
  'runs.status.failed': 'Mislukt',
  'runs.status.cancelled': 'Geannuleerd',
  'mappings.filtered.lead': 'Alleen zichtbaar:',
  'mappings.filtered.clear': 'Toon alle migraties',
  'mappings.loadFailed': 'De migratielijst kon niet worden geladen.',
  'mappings.syncFailed': 'Het synchronisatieverzoek is niet voltooid.',
  'failure.authExpired':
    'De verbinding met dit account is verlopen. Druk op de pagina Accounts op Opnieuw verbinden of Inloggegevens vervangen, welke van de twee er bij dit account staat; daarna wordt verdergegaan waar gestopt was \u2014 er gaat niets verloren.',
  'failure.openAccounts': 'Naar Accounts',
  'failure.rateLimited':
    'De provider vroeg ons (geautomatiseerd) om rustiger aan te doen. Er is niets mis: dit pauzeert en hervat vanzelf.',
  'failure.quotaExceeded':
    'Dit account heeft de limiet bereikt die de provider per dag toestaat. Het hervat morgen vanzelf \u2014 u hoeft niets te doen.',
  'failure.policyRefused':
    'Nog niet gemigreerd: Google-bestanden in een formaat dat het nieuwe account niet kan ontvangen. Kies een formaat dat beide kanten aankan onder Exportformaat voor Google-bestanden, en klik op Probeer opnieuw \u2014 of laat deze items achter.',
  'failure.policyRefused.dropbox':
    'Nog niet gemigreerd: Dropbox Paper-documenten, die Dropbox alleen als export kan laten ophalen. Kies een bestandsformaat onder Exportformaat voor Paper-documenten, en klik op Probeer opnieuw \u2014 of laat deze items achter. Andere documenten die Dropbox in een eigen (intern)formaat bewaart, worden niet geëxporteerd: exporteer ze zelf vanuit Dropbox, of laat ze achter.',
  'failure.tooLarge':
    'Niet gemigreerd: bestandsomvang groter dan Ownpace tijdens de Alpha aankan. Kopieer deze bestanden met de hand, of laat ze achter.',
  'failure.sourceRefused':
    'Niet gemigreerd: het oude account wilde dit niet laten lezen, dus er is niets naar het nieuwe gestuurd \u2014 daar valt niets te controleren. Probeer opnieuw als dat veranderd is, of laat deze items achter.',
  'failure.targetRefused':
    'De bestemming weigerde dit te accepteren. Veelvoorkomende oorzaken: geen vrije ruimte meer, een grens aan de grootte van één geüpload bestand, een alleen-lezen map, of ontbrekende rechten op het doelaccount. Als de doelserver antwoord gaf met een interne fout, dan kan die terug worden gelezen in het logboek van de bestemming zelf, niet in het antwoord dat wij terugkregen.',
  'failure.formatRefused':
    'De bestemming accepteert dit SOORT bestand niet. Met het account zelf is niets mis \u2014 het is de indeling of de naam van dit bestand die daar niet is toegestaan. Geef het in het oude account een andere naam, wijzig het exportformaat op de koppeling, of laat deze items achter.',
  'failure.network':
    'We konden de server niet bereiken. Dit is meestal tijdelijk, en er wordt vanzelf opnieuw geprobeerd.',
  'failure.unknown':
    'We konden dit niet classificeren. De melding van de provider zelf staat hieronder \u2014 biedt dat geen duidelijkheid, stuur hem ons dan en we kijken mee.',
  'failure.sendItToUs': 'Stuur naar ons',
  'failure.reference': 'Referentie: {reference}',
  'failure.side.source': 'Trad op aan de bronkant.',
  'failure.side.target': 'Trad op aan de doelkant.',
  'pause.ceiling':
    '{provider} heeft de daglimiet voor downloaden bereikt. Migreren gaat verder na {resets}.',
  'pause.ceiling.unknown':
    '{provider} heeft de daglimiet voor downloaden bereikt. Migreren gaat verder zodra die reset.',
  'pause.ceiling.why':
    'Deze limiet is van uw bron / oude provider, niet van ons. Als wij daar overheen gaan, kan dat u ongeveer een dag buitensluiten uit uw eigen live mailbox, dus is de migratie voordien al gestopt. Er is niets misgegaan en er gaat niets verloren — de volgende ronde gaan we weer rustig verder.',
  'pause.dataCeiling':
    'Nieuwe items wachten bij uw datalimiet van {ceiling}: {held} nog niet gemigreerd. Wijzigingen in items die al gemigreerd waren worden nog wel gemigreerd.',
  'pause.dataCeiling.moveUp': 'Ga naar {tier}: €{monthly} per maand.',
  'pause.dataCeiling.topUp': 'Of koop eenmalig nog {band} erbij, voor €{price}.',
  'pause.dataCeiling.why':
    'Elke stap omhoog is uw keuze: niets verhoogt uw pakket of uw datalimiet zonder uw ja. Kies zo nodig voor een stap omhoog via de pagina Facturering, en het migreren gaat verder waar het stopte.',
  'pause.hold.heading': 'Migreren is gepauzeerd',
  'pause.hold.default': 'We hebben het migreren gepauzeerd terwijl we het platform bijwerken.',
  'pause.hold.since': 'Gepauzeerd sinds',
  'pause.hold.why':
    'Er is niets mis met uw migratie, niets gaat verloren. Een migratierun die al liep wordt normaal afgerond, en geplande migratieruns starten vanzelf weer zodra de update klaar is. Migraties die u tijdens de pauze probeerde te starten, zijn niet gestart: probeer het na de update opnieuw.',
  'lane.intro': 'Het oude account blijft het nieuwe voeden en er wordt niets verwijderd.',
  'lane.why':
    'Uw pakket daalt niet zolang dit loopt: het pad houdt zijn plek tot u het beëindigt, net als een migratie die nog niet klaar is. Verwijderingen in uw oude bron worden niet meer gesynchroniseerd — wat u daar weghaalt, blijft op uw nieuwe bestemming staan. Wat u daar wijzigt, overschrijft de kopieën op uw nieuwe bestemming niet meer. We factureren niet langer dan twaalf maanden zonder het u opnieuw te vragen.',
  'lane.confirm': 'Blijven synchroniseren, uw pakket blijft gelijk',
  'lane.cancel': 'Nu niet',
  'lane.selfhost.why':
    'Verwijderen in uw oude bron worden niet meer gesynchroniseerd — wat u daar weghaalt ' +
    'blijft in uw nieuwe bestemming staan. Dat komt omdat veelal mensen oude omgevingen opschonen/verwijderen, en het risico te groot is dat dit leidt tot verwijdering in uw nieuwe systeem. Synchronisatie loopt op dit apparaat door tot u het beëindigt.',
  'lane.selfhost.confirm': 'Blijven migreren',
  'attention.title': 'Per migratie',
  'attention.intro': 'Eén regel per migratie, met een link naar alles wat wacht.',
  'attention.empty': 'Er wacht niets. Elke migratie loopt rustig door.',
  'attention.emptyNoneRunning': 'Er wacht niets op u en er loopt geen migratie.',
  'attention.organisation': 'Uw organisatie',
  'attention.quiet': '{count} lopen rustig door, er wacht niets op u.',
  'attention.decisions': 'wijzigingen die een beslissing vragen',
  'attention.deletions': 'verwijderingen om te bevestigen',
  'attention.moves': 'verplaatsingen om te bevestigen',
  'attention.failures': 'items die niet gemigreerd konden worden',
  'attention.readyForCutover': 'gecontroleerd en klaar om af te ronden',
  'attention.graceEnded': 'overgangsperiode voorbij en niets gekozen, migraties die uit staan: {kinds}',
  'attention.sharingOpen': 'regels open op de deel-checklist',
  'attention.couldNotRead': 'Eén wachtrij kon niet gelezen worden; deze aantallen kunnen te laag zijn.',
  'attention.couldNotRead.why':
    'Het getoonde aantal is wat we konden lezen, en niet per se compleet — wat niet te raadplegen was, wordt als onleesbaar geregistreerd, niet als afwezig. We weten nog niet of u klaar bent met migreren. De redenen voor het niet kunnen lezen staan per item aangegeven, met daarbij wat de server aangaf.',
  'attention.failed': 'Deze lijst kon niet geladen worden.',
};

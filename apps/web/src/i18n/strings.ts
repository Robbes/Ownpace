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
  'nav.mappings': 'Migrations',
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
  'common.requestFailed': 'The request did not complete.',
  'asof.updated': 'Updated',
  'asof.refresh': 'Refresh',
  'confirm.progress.lastSynced': 'last synced',
  'verify.checkedAt': 'Checked',
  'queue.loadFailed': 'Could not load this queue.',
  'queue.loadFailedNotEmpty':
    'This is not the same as an empty queue — items may be waiting that we could not read.',
  'queue.noMappings': 'No migrations configured.',
  'discovery.scanning': 'Scanning your source (read-only)…',
  'discovery.th.type': 'Type',
  'discovery.th.collections': 'Collections',
  'discovery.th.items': 'Items',
  'discovery.th.size': 'Size',
  'discovery.th.needsId': 'Needs an ID',
  'discovery.th.existing': 'Already on the destination',
  'discovery.keptAsIs': 'kept as-is',
  'discovery.generatedId.pre.one':
    'message arrived without a Message-ID, which is what we use to copy each message exactly once. We will generate one and add it to',
  'discovery.generatedId.pre.many':
    'messages arrived without a Message-ID, which is what we use to copy each message exactly once. We will generate one and add it to',
  'discovery.generatedId.strong': 'the copy on your new server',
  'discovery.generatedId.post':
    '— the original on your old server is not changed. These messages are included in the counts above and will be migrated.',
  'discovery.colliding.pre.one': 'item already on your destination matches something in your source. We will',
  'discovery.colliding.pre.many': 'items already on your destination match something in your source. We will',
  'discovery.colliding.strong': "keep the destination's copy",
  'discovery.colliding.post': 'and not overwrite it. Anything else already there is left untouched.',
  'applyFlag.readFailed': 'Could not read whether applying deletions is enabled:',
  'applyFlag.on': 'Applying deletions is ON for this migration.',
  'applyFlag.off': 'Applying deletions is OFF for this migration (the default).',
  'applyFlag.turnOff': 'Turn off',
  'applyFlag.refusesUntilOn':
    'The server refuses every delete button on this screen until it is turned on.',
  'applyFlag.config.pre': "On this appliance the value lives in the mapping's config file",
  'applyFlag.config.post': '; edit the file and restart to change it. No API changes it.',
  'applyFlag.turnOn': 'Turn on applying deletions',
  'applyFlag.turnOnArmed': 'Confirm: enable deletions',
  'autoApply.on': 'Auto-applying relocations is ON for this migration.',
  'autoApply.off': 'Auto-applying relocations is OFF for this migration (the default).',
  'autoApply.hint':
    'When on, each file pass removes the OLD copies of moved or renamed files by itself — ' +
    'only where the same bytes are confirmed present under the new name, the pairing is ' +
    'unique, the report survived a full pass, and no mass event is suspected. Everything it ' +
    'refuses stays in this queue for you. Deletions are never applied automatically.',
  'autoApply.turnOn': 'Enable auto-apply for relocations',
  'autoApply.turnOnArmed': 'Confirm: auto-apply relocations unattended',
  'scope.migrates': 'Migrates',
  'scope.partial': 'Partial',
  'scope.doesNotMigrate': 'Does not migrate',
  'login.title': 'Sign in to Open Migrate',
  'login.tagline': 'Sovereign data migration for families and SMBs',
  'login.tokenLabel': 'Access token',
  'login.invalidToken':
    'That does not look like a valid access token (need sub, email, tenantId, role).',
  'login.expiredToken':
    'This token has expired. Mint a fresh one (seed script or your identity provider) and paste that instead.',
  'login.submit': 'Sign in',
  'login.help.pre': 'Paste the access token from the seed script',
  'login.help.post': 'or your identity provider.',
  'wizard.proto.imap.hint': 'Standard email protocol',
  'wizard.proto.oauth2.hint': 'Office 365 over IMAP (app registration)',
  'wizard.proto.graph.hint': 'Office 365 over the Graph API (app registration)',
  'wizard.proto.googleDrive.hint': 'Files from a Google Drive (read-only OAuth)',
  'wizard.proto.dropbox.hint': 'Files from a Dropbox (read-only OAuth app)',
  'wizard.proto.box.hint': 'Files from a Box account (read-only platform app)',
  'wizard.boxUserId': 'Box user id (numeric)',
  'wizard.boxUserId.placeholder': 'e.g. 1234567890 — Admin Console → Users & Groups',
  'wizard.boxRootFolderId': 'Root folder id (optional)',
  'wizard.boxRootFolderId.placeholder': 'Empty = All Files; a folder id scopes the migration',
  'wizard.review.boxUser': 'Box user',
  'wizard.source.boxSetup':
    'A Box migration authenticates with your own Box platform app via the Client Credentials Grant — no refresh token, because Box rotates refresh tokens on every use. The Client ID goes here with the numeric user id being migrated; the Client secret rides the credentials step. A Box admin must authorize the app once (Admin Console → Apps → Custom Apps Manager). docs/box-setup.md walks through each step.',
  'wizard.dropboxAppKey': 'App key (from the Dropbox App Console)',
  'wizard.dropboxRootPath': 'Root folder path (optional)',
  'wizard.dropboxRootPath.placeholder': 'Empty = the whole Dropbox; e.g. /Team Docs',
  'wizard.browseDropboxFolders': 'Browse shared folders…',
  'wizard.noDropboxSharedFolders': 'This account sees no shared folders.',
  'wizard.dropboxUnmounted': 'not mounted — add it to your Dropbox first',
  'wizard.review.wholeDropbox': 'the whole Dropbox',
  'wizard.source.dropboxSetup':
    'A Dropbox migration authenticates with your own Dropbox app: create it read-only (files.metadata.read + files.content.read; add sharing.read if you want the shared-folder browse). The App key goes here; on the credentials step, the App secret goes in the client-secret field and the refresh token beside it. docs/dropbox-setup.md walks through each.',
  'wizard.proto.gmail.hint': 'Email from a Gmail mailbox (OAuth over IMAP)',
  'wizard.proto.googleCalendar.hint': 'Calendars from a Google account (OAuth over CalDAV)',
  'wizard.proto.googleContacts.hint': 'Contacts from a Google account (OAuth over CardDAV)',
  'wizard.refreshToken': 'Refresh token',
  'wizard.refreshToken.hint':
    'The delegated token for the account being migrated. Treat it as a password.',
  'wizard.rootFolderId': 'Root folder ID (optional)',
  'wizard.rootFolderId.placeholder': 'Empty = all of My Drive; a shared drive by its own ID',
  'wizard.review.myDrive': 'My Drive',
  'wizard.targetPrefix': 'Target folder (optional)',
  'wizard.targetPrefix.placeholder': 'Empty = merge into the account itself',
  'wizard.targetPrefix.hint':
    'Everything this migration writes lands under this folder — useful when several sources ' +
    'share one target and you want a subfolder per source (e.g. "Gmail"). Leave it empty to ' +
    'merge, which is the default: one account, one place to work.',
  'wizard.source.driveSetup':
    'A Google Drive source uses your own Google Cloud OAuth client and a delegated, read-only ' +
    'refresh token — docs/google-workspace-setup.md walks through all three values and ends ' +
    'with one read-only command that proves them. The token cannot write to the Drive. Google ' +
    'Docs, Sheets and Slides are reported as un-migratable, one by one, with the reason: they ' +
    'have no file to copy, and rendering them is not enabled until export stability is measured.',
  'wizard.source.gmailSetup':
    'A Gmail source uses your own Google Cloud OAuth client — the same one a Google Drive ' +
    'source uses — but its refresh token must be consented with the https://mail.google.com/ ' +
    'scope, the only one Google accepts for IMAP. A token consented for Drive will not work ' +
    'here. docs/google-workspace-setup.md walks through obtaining it.',
  'wizard.source.googleDavSetup':
    'This source uses your own Google Cloud OAuth client \u2014 the same one the other Google ' +
    'sources use \u2014 but the refresh token must be consented with this product\u2019s own scope: ' +
    'https://www.googleapis.com/auth/calendar for Calendar, ' +
    'https://www.googleapis.com/auth/carddav for Contacts. A token consented for another ' +
    'Google product will not work here. docs/google-workspace-setup.md walks through it.',
  'hub.completionReport': 'Download the completion report (Markdown)',
  'wizard.serviceAccountKey': 'Service account key (domain-wide delegation, optional)',
  'wizard.serviceAccountKey.placeholder': 'Paste the whole JSON key file Google generated',
  'wizard.serviceAccountKey.width':
    'This key can read every user in the Workspace domain. Each migration still names one account. Authorise only the scopes you need in the Admin console, and revoke the delegation at cutover.',
  'wizard.browseSharedDrives': 'Browse shared drives & folders…',
  'wizard.noSharedDrives': 'This credential sees no shared drives or shared folders — leaving the root empty migrates My Drive.',
  'wizard.sharedDrivesGroup': 'Shared drives',
  'wizard.sharedFoldersGroup': 'Folders shared with me',
  'wizard.testConnections': 'Test and save connections',
  'wizard.testing': 'Testing…',
  'wizard.testConnections.hint':
    'Signs in to both sides with what you typed and lists what it can see — nothing is ' +
    'written to either system. A side that works is SAVED as a connection, so if you leave ' +
    'this wizard you will not have to fetch those credentials again.',
  'wizard.proto.jmap.hint': 'Modern email protocol',
  'wizard.proto.caldav.hint': 'Calendar protocol',
  'wizard.proto.carddav.hint': 'Contact protocol',
  'wizard.proto.webdav.hint': 'File storage',
  'wizard.title': 'Create Migration',
  'wizard.subtitle': 'Set up a new data migration between systems',
  'wizard.step.source': 'Source',
  'wizard.step.target': 'Target',
  // "Name & credentials", because the step LEADS with — and gates on — the
  // migration name (0037 T5): a label saying only "Credentials" promised a
  // different step than the one that renders.
  'wizard.step.credentials': 'Name & credentials',
  'wizard.step.dataTypes': 'Data Types',
  'wizard.step.schedule': 'Schedule',
  'wizard.step.review': 'Review',
  'wizard.selectSource': 'Select Source System',
  'wizard.selectTarget': 'Select Target System',
  'wizard.host': 'Host',
  'wizard.port': 'Port',
  'wizard.useSsl': 'Use SSL/TLS',
  'wizard.migrationName': 'Migration Name',
  'wizard.migrationNameHint': 'A friendly name to identify this migration',
  'wizard.credentials': 'Credentials',
  'wizard.sourceUsername': 'Source Username',
  'wizard.sourcePassword': 'Source Password',
  'wizard.targetUsername': 'Target Username',
  'wizard.targetPassword': 'Target Password',
  'wizard.selectDataTypes': 'Select Data Types to Migrate',
  'wizard.selectDataTypesHint': 'Choose which types of data you want to migrate',
  'wizard.domain.email.hint': 'Email messages and folders',
  'wizard.domain.calendar.hint': 'Events and appointments',
  'wizard.domain.contact.hint': 'Address book entries',
  'wizard.domain.file.hint': 'Attachments and documents',
  'wizard.schedule': 'Sync Schedule',
  'wizard.scheduleHint': 'Choose how often to sync data between source and target',
  'wizard.schedule.hourly': 'Hourly',
  'wizard.schedule.hourly.hint': 'Every hour',
  'wizard.schedule.daily': 'Daily',
  'wizard.schedule.daily.hint': 'Every day at 2 AM',
  'wizard.schedule.sixHourly': 'Every 6 hours',
  'wizard.schedule.sixHourly.hint': 'Six times per day',
  'wizard.schedule.quarterHourly': 'Every 15 minutes',
  'wizard.schedule.quarterHourly.hint': 'Frequent sync',
  'wizard.customCron': 'Custom Cron Expression (optional)',
  'wizard.customCronHint': 'Leave empty for default daily sync at 2 AM',
  'wizard.readyToCreate': 'Ready to create migration',
  'wizard.reviewDetails': 'Migration Details',
  'wizard.review.name': 'Name',
  'wizard.review.source': 'Source',
  'wizard.review.target': 'Target',
  'wizard.review.schedule': 'Schedule',
  'wizard.review.scheduleDefault': 'Daily at 2 AM',
  'wizard.review.dataTypes': 'Data Types',
  // The truth of 0013 T5/T6 (0037 T3): creating starts NOTHING. The old note
  // said "the initial sync may take some time" — an admin who navigated away
  // believing migration was underway left it paused forever.
  'wizard.review.note':
    'Creating stores this configuration and starts nothing: the migration is created paused. ' +
    'Next you review what a read-only scan finds in your source and give the explicit start — ' +
    'nothing is copied until then.',
  'wizard.review.noteLead': 'Note:',
  'wizard.back': 'Back',
  'wizard.cancel': 'Cancel',
  'wizard.next': 'Next',
  'wizard.create': 'Create Migration',
  'wizard.creating': 'Creating…',
  // Field-level honesty (0037 T3): the line beside a disabled Next names what
  // is missing instead of leaving a silently dead button.
  'wizard.missing.lead': 'To continue, fill in:',
  'wizard.missing.dataTypes': 'select at least one data type',
  'wizard.showPassword': 'Show password',
  'wizard.hidePassword': 'Hide password',
  'wizard.credentials.storage':
    'These sign-in details are encrypted at rest, used only to connect to your source and ' +
    'target, and never shown again after this step.',
  // 0037 T6, answered 2026-08-10: oauth2/graph collect the per-customer
  // Entra app registration (ADR-0006's row-14 model).
  'wizard.source.appRegistration':
    'OAuth2 and Microsoft Graph sources use an Entra app registration in your own tenant: ' +
    'enter its tenant ID and client ID here, and its client secret together with the mailbox ' +
    'address on the credentials step. Register the app and grant admin consent in your own ' +
    'tenant first — see the O365 setup guide (docs/o365-setup.md).',
  'wizard.tenantId': 'Tenant ID',
  'wizard.clientId': 'Client ID (application ID)',
  'wizard.sourceClientSecret': 'Source client secret',
  // 0037 T4: the coherence hint on an unselectable data type; the full
  // refusal sentence comes from shared and renders verbatim.
  'wizard.domain.notForTarget': 'Not available over the selected target protocol.',
  'wizard.cron.invalidLead': 'Not a valid schedule —',
  'wizard.cron.nextRuns': 'With this schedule, the next syncs would run:',
  // 0037 T5: leaving a dirty wizard is a question, not a silent discard.
  'wizard.leaveConfirm': 'Leave this wizard? Everything you typed here will be discarded.',
  'billing.title': 'Billing',
  'billing.subtitle': 'Manage your subscription, usage, and payments',
  'billing.currentUsage': 'Current Usage',
  'billing.storage': 'Storage',
  'billing.dataTransfer': 'Data Transfer',
  'billing.computeTime': 'Compute Time',
  'billing.hours': 'hours',
  'billing.apiCalls': 'API calls',
  'billing.costBreakdown': 'Cost Breakdown',
  'billing.baseFee': 'Base Fee',
  'billing.storageCost': 'Storage Cost',
  'billing.compute': 'Compute',
  'billing.subtotal': 'Subtotal',
  'billing.vat': 'VAT',
  'billing.total': 'Total',
  'billing.noUsage': 'No usage data available yet',
  'billing.invoices': 'Invoices',
  'billing.noInvoices': 'No invoices yet',
  'billing.invoice': 'Invoice',
  'billing.period': 'Period:',
  'billing.paymentMethods': 'Payment Methods',
  'dashboard.total': 'Total Migrations',
  'dashboard.errorLoading': 'Error loading dashboard',
  // The channel's state, shown only when it is OFF (0043 T3). "On" is not worth
  // a banner; "off" is the state somebody has to act on, and until now it was
  // visible only in a container log line written once at boot.
  'notifications.off': 'Email notifications are off',
  'notifications.offHint':
    'Nobody will be emailed when this migration needs a decision. Configure SMTP to turn them on.',
  'notifications.offReason': 'Reason given by the server:',
  'dashboard.recentActivity': 'Recent Activity',
  'dashboard.noActivity': 'No activity yet',
  'dashboard.noActivityHint': 'Create your first migration to start syncing data',
  'dashboard.createMigration': 'Create Migration',
  'dashboard.view': 'View →',
  'dashboard.quickActions': 'Quick Actions',
  'dashboard.newMigration': 'New Migration',
  'dashboard.newMigrationHint': 'Create a new data migration',
  'dashboard.viewAll': 'View All Migrations',
  'dashboard.viewAllHint': 'Manage your migrations',
  'dashboard.team': 'Team',
  'dashboard.teamHint': 'Manage who has access',
  'mappings.title': 'Migrations',
  'mappings.subtitle': 'Manage your data migration configurations',
  'mappings.new': 'New Migration',
  'mappings.empty.title': 'No migrations yet',
  'mappings.empty.hint': 'Create your first migration to start syncing data between systems',
  'mappings.empty.cta': 'Create Your First Migration',
  'mappings.th.name': 'Name',
  'mappings.th.sourceTarget': 'Source → Target',
  'mappings.th.status': 'Status',
  'mappings.th.lastSync': 'Last Sync',
  'mappings.th.actions': 'Actions',
  'mappings.action.triggerSync': 'Trigger sync',
  'mappings.action.startSync': 'Start sync',
  // 0037 T2: a paused mapping's row leads to the confirm screen — the Play
  // button it used to render could only earn a 409.
  'mappings.action.reviewAndStart': 'Review and start',
  'mappings.action.delete': 'Delete',
  // 0037 T5: mapping deletion destroys config and ledger linkage, so the
  // button arms with the mapping's own name (hard rule 2's posture).
  'mappings.delete.explain':
    'Deleting this migration removes its configuration and its history linkage. ' +
    'Type the migration name to confirm.',
  'mappings.delete.confirm': 'Delete migration',
  'mappings.delete.cancel': 'Cancel',
  'mappings.delete.failed': 'The migration was not deleted.',
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
  'hub.orderIntro':
    'The five screens below are in the order a cutover runs — work the list top to bottom.',
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
  'hub.sharing.name': 'Sharing',
  'hub.sharing.blurb':
    'Who could reach what on the old system — carried over, done by hand, or deliberately not. A checklist, worked after finishing.',
  'sharing.title': 'Sharing checklist',
  'sharing.intro':
    'Everything somebody else could reach on the old system, one row per grant. Settle each row: create the share on the new system, tick it off as done by hand, or skip it on purpose — every settled row keeps who decided, and when.',
  'sharing.progressSettled': 'settled',
  'sharing.openManualNote':
    'row(s) are marked manual — steps for you on the new system; tick them off here when done.',
  'sharing.rescan': 'Refresh from the source…',
  'sharing.blindSpots': 'Could not be inventoried — capture these by hand:',
  'sharing.empty': 'No shares on the list yet. Refresh from the source to scan.',
  'sharing.apply': 'Create share on new system',
  'sharing.applyArmed': 'Click again — this shares AND invites',
  'sharing.done': 'Mark done',
  'sharing.skip': 'Skip',
  'sharing.linkShare': 'link share',
  'sharing.manualBadge': 'manual',
  'sharing.granteeLabel': 'share with',
  'sharing.inviteNote':
    'Applying creates the share on the new system, which then sends its own invitation to this address — check the address first.',
  'sharing.state.applied': 'shared on the new system',
  'sharing.state.doneManual': 'done by hand',
  'sharing.state.skipped': 'skipped',
  'sharing.loadFailed': 'The sharing checklist could not be read.',
  'hub.check.name': 'Check',
  'hub.check.blurb':
    'Compare the two systems and sample the contents, behind one button.',
  'hub.finish.name': 'Finish',
  'hub.finish.blurb':
    'The cutover checklist. Ends the migration — in order, with the one attested step.',
  'runs.title': 'Run history',
  'runs.blurb':
    'Every sync pass this migration has made, newest first, with what each one said.',
  'runs.empty': 'No passes have run yet. History appears after the first sync.',
  'runs.truncated': 'Showing the newest passes only — older ones exist but are not listed.',
  'runs.eventsTruncated': 'Newest log entries only — earlier ones are not shown.',
  'runs.error': "Could not read this migration's run history.",
  'runs.items': 'Items',
  'runs.errors': 'Errors',
  'runs.events': 'Log',
  'state.lifecycle.active': 'Active',
  'state.lifecycle.paused': 'Paused',
  'state.lifecycle.cutover': 'In cutover',
  'state.lifecycle.done': 'Done',
  'state.invoice.draft': 'Draft',
  'state.invoice.sent': 'Sent',
  'state.invoice.paid': 'Paid',
  'state.invoice.overdue': 'Overdue',
  'state.invoice.void': 'Void',
  'runs.status.pending': 'Pending',
  'runs.status.running': 'Running',
  'runs.status.success': 'Succeeded',
  'runs.status.failed': 'Failed',
  'runs.status.cancelled': 'Cancelled',
  'queue.waitingOnYou': 'Waiting on you',
  'queue.alreadyDecided': 'Already decided',
  'moves.title': 'Moved on the old system',
  'moves.intro':
    'Items the owner has filed somewhere other than where they came from. The new system still has them where we put them, and nothing has been changed on either side.',
  'moves.empty.open': 'Nothing has moved.',
  'moves.empty.acknowledged': 'Nothing has been decided yet.',
  'moves.keep': 'Leave it where it is',
  'moves.apply': 'Remove the old copy',
  'moves.applyArmed': 'Confirm removal',
  'moves.renamedTo': 'renamed',
  'failures.title': 'Could not be copied',
  'failures.intro':
    'Items that did not make it across, what went wrong, and how many times we tried.',
  'failures.empty.needsDecision': 'Nothing is waiting on a decision.',
  'failures.acceptedLeave':
    'Accepted items no longer appear here — accepting migrates without the item, and the ledger stops counting it as failed.',
  'failures.seeRuns': 'See the pass that failed (run history)',
  'failures.stillTrying': 'Still trying',
  'failures.empty.retrying': 'Nothing is being retried.',
  'failures.retry': 'Try again',
  'failures.retryCost':
    // Sourced from domain-sync.ts's own cursor comment (~line 1158): an
    // operator retry clears the mapping's cursors, forcing the full re-list
    // that puts the item back in front of the loop. If the engine changes,
    // change this sentence WITH it — the two must not disagree.
    'Retrying clears this migration\u2019s sync cursors, so the next pass re-lists everything to reach this item again. That pass takes longer; nothing already copied is copied twice.',
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
  'common.loading': 'Loading…',
  'common.cancel': 'Cancel',
  'docs.title': 'Setup guides',
  'docs.all': '← All setup guides',
  'docs.notFound': 'There is no guide by that name. These are the ones that ship with this version:',
  'mappings.lastSync': 'Last sync:',
  'mappings.never': 'Never',
  'mappings.loadFailed': 'Could not load the migrations list.',
  'mappings.loadFailedNotEmpty':
    'This is not the same as having no migrations — mappings may exist that could not be read.',
  'mappings.syncFailed': 'The sync request did not complete.',
  'createMapping.createFailed':
    'The migration was not created. Your entries are still here — fix what the message names and try again.',
  'dashboard.runsReadFailed': 'Could not read the run history:',
  'dashboard.noRunsYet': 'No passes yet',
  'dashboard.runItems': 'items',
  'dashboard.runErrors': 'errors',
  'billing.usageLoadFailed': 'Could not load the usage numbers.',
  'billing.pay': 'Pay',
  'billing.payFailed': 'The payment could not be started.',
  'billing.usagePeriod': 'Usage for',
  'billing.asOf': 'as of',
  'billing.noPaymentMethods': 'No payment methods stored.',
  'billing.paymentMethodsLoadFailed': 'Could not load the payment methods.',
  'billing.default': 'Default',
  'billing.adminOnly': 'Billing is available to owners and admins only. Ask an owner or admin of this organization for usage or invoice details.',
  'billing.invoicesLoadFailed': 'Could not load the invoices.',
  'billing.loadFailedNotEmpty':
    'This is not the same as having none — data may exist that could not be read.',
  'confirm.nextSteps': 'Next, in cutover order:',
  'confirm.title': 'Review & confirm your migration',
  'confirm.intro': 'Nothing has been copied yet. Review what will migrate, then start it.',
  'confirm.readError': 'Could not read the migrations.',
  'confirm.noMappings': 'No mappings configured.',
  'confirm.noMappings.how':
    'The appliance reads mappings as JSON files from its config directory (on Docker the mounted config folder; on Windows C:\\ProgramData\\OpenMigrate\\config). Copy mapping.json.example, fill in your source and target, reference secrets by environment-variable name, and restart the appliance — it reads the directory once at start. The full walkthrough is docs/selfhost-quickstart.md, step 3.',
  'confirm.start': 'Start migration',
  'confirm.startError': 'Could not start it:',
  'confirm.startErrorFallback': 'the request failed',
  'confirm.openConsole': 'Open the migration console',
  'confirm.whatMigrates': 'What migrates',
  'confirm.note.active': 'Active. It syncs on its schedule and reports anything that needs you.',
  'confirm.note.cutover': 'In cutover.',
  'confirm.note.done': 'Finished. This migration no longer syncs.',
  'confirm.introStarted':
    'Migrations here have started. Live progress is shown per migration; the pre-start scan is kept as a snapshot.',
  'confirm.progress.heading': 'Live progress',
  'confirm.progress.synced': 'synced',
  'confirm.progress.failed': 'failed',
  'confirm.progress.retrying': 'retrying',
  'confirm.snapshot.heading': 'Pre-start scan (snapshot)',
  'confirm.snapshot.note':
    'Counted once, before the start, to show what would migrate. The source keeps changing afterwards and these numbers do not update — live progress above is the ledger speaking.',
  'confirm.state.pending': 'Pending',
  'confirm.state.in_progress': 'Syncing',
  'confirm.state.completed': 'Completed',
  'confirm.state.failed': 'Failed',
  'confirm.state.skipped': 'Skipped',
  'confirm.foundInSource': 'What we found in your source',
  'confirm.starting': 'Starting…',
  'verify.title': 'Check the migration',
  'verify.intro':
    'Compares what the old system has against what the new one has, and samples the contents to confirm they match. Read-only — it never writes to either side.',
  'verify.run': 'Run the check',
  'verify.runAgain': 'Check again',
  'verify.durationHint': 'Reads the whole destination — on a large mailbox this takes minutes.',
  'verify.applianceScope':
    'On this appliance the check always covers every configured migration.',
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
    'Never started, so there is nothing to finish. Remove the migration to retire it.',
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
  'finish.step1.passed': 'The check passed.',
  'finish.step1.notPassed': 'The check did not pass:',
  'finish.step1.noRun': 'No check has run yet.',
  'finish.step1.running': 'A check is running now.',
  'finish.step1.readFailed': 'Could not read the check status:',
  'finish.step2.readFailed': 'Could not read a queue:',
  'finish.step2.notSameAsClear': '— not the same as clear.',
  'finish.step3.failedFramed':
    'The request failed — a pass may still be running. Give it a moment, then re-check the queues above.',
  'finish.retryButton': 'Try finishing again',
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
    '. Only the first of these blocks finishing — the other two are already answered by the new system keeping its copy.',
  'finish.step3.title': 'Run one final pass',
  'finish.step3.body': 'So the new system reflects the old one as of right now.',
  'finish.step3.run': 'Run a pass now',
  'finish.step3.runAgain': 'Run another',
  'finish.step3.finished': 'The pass has run and finished.',
  'finish.step3.queued':
    'Queued. The pass runs as a job and lands in the run history — give it a moment, then re-check the queues above.',
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
    'operate, monitor or back it up, and it carries no service level from us. ' +
    'If it is a managed European platform, its own provider is responsible for it.',
  'tenants.title': 'Team & organization',
  'tenants.intro':
    'Who can sign in to this organization, and what they are allowed to do. Changes apply immediately.',
  'tenants.noTenant': 'No organization in this session.',
  'tenants.selfDemotionArmed':
    'This lowers your own role — you may not be able to change it back yourself.',
  'tenants.selfDemotionConfirm': 'Confirm role change',
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
  'decisions.answeredBy': 'by',
  'decisions.answer': 'Answer:',
  'decisions.detailToggle': 'Details',
  'decisionStatus.resolved': 'Decided',
  'decisionStatus.auto_resolved': 'Decided by preset',
  'decisionStatus.dismissed': 'Dismissed',
  'nav.connections': 'Connections',
  'nav.setup': 'Setup checklist',
  'nav.docs': 'Setup guides',
  'wizard.reuseSource': 'Use a source connection you already have',
  'wizard.reuseTarget': 'Use a target connection you already have',
  'wizard.reuseNone': 'No — enter new credentials below',
  'wizard.reuse.hint':
    'Picking one reuses its saved credentials, so you do not paste the same secret twice. The credential fields below disappear when you do.',
  'connections.delete': 'Delete',
  'connections.rotate': 'Replace credentials',
  'connections.rotate.hint':
    'Paste the new values. They are checked before they replace the old ones — if the check fails, nothing changes and your migrations keep whatever was working.',
  'connections.rotate.save': 'Check and replace',
  'connections.add': 'Add a connection',
  'connections.addAndTest': 'Add and test',
  'connections.role': 'Is this a source or a target?',
  'connections.type': 'Provider',
  'connections.name': 'Name it (so you recognise it later)',
  'connections.title': 'Connections',
  'connections.intro':
    'The source and target accounts your migrations sign in with. Test one to check its credentials are still good — that runs the same read-only check a migration would, and shows exactly what the provider says.',
  'connections.none': 'No connections yet. Creating your first migration adds them.',
  'connections.sources': 'Sources',
  'connections.targets': 'Targets',
  'connections.test': 'Test',
  'connections.testing': 'Testing…',
  'connections.usedBy': 'mailbox(es) use this',
  'connections.setupSteps': 'Setup steps',
  'connections.ok': 'Reached it. The credentials still work.',
  'connections.failed': 'Could not reach it.',
  // ---- Provider setup checklist (workplan 0061) ----
  'setup.title': 'What to set up in the provider',
  'setup.intro':
    'These steps happen in the provider\u2019s own console, not here. Tick each one off as you go — this list is saved for your whole organisation, so you can stop and come back, and a colleague can pick up where you left off.',
  'setup.backToWizard': '← Back to the migration wizard',
  'setup.fullGuide': 'Read the full setup guide',
  'setup.settled': 'settled',
  'setup.stillOpen': 'still to do',
  'setup.waitingOnOthers': 'waiting on an administrator',
  'setup.allDone': 'Everything here is settled — you can complete the wizard.',
  'setup.nothingToDo': 'This provider needs nothing set up in advance. Go straight to the wizard.',
  // ---- Choosing a provider, and narrowing by who you are (workplan 0068) ----
  'setup.choose.title': 'What are you setting up?',
  'setup.choose.intro':
    'Pick the system you are migrating from or to. Each one has its own short list of things to arrange before a migration can read anything.',
  'setup.choose.sources': 'Migrating from',
  'setup.choose.targets': 'Migrating to',
  'setup.admin.question': 'Do you administer this system for your organisation?',
  'setup.admin.yes': 'Yes, I am an administrator',
  'setup.admin.no': 'No, someone else is',
  'setup.admin.unsure': 'Show me everything',
  'setup.admin.hint':
    'This only changes how the list below is arranged. It is remembered on this device, for you — a colleague answering differently still sees their own view.',
  'setup.yours': 'What you can do yourself',
  'setup.forYourAdmin': 'What your administrator has to do',
  'setup.forYourAdmin.hint':
    'These need rights you have said you do not have. Send them to whoever administers this system; you can tick them off here once they confirm.',
  'setup.yields': 'You get:',
  'setup.tick': 'Mark this step done',
  'setup.untick': 'Mark this step not done',
  'setup.skip': 'Skip',
  'setup.unskip': 'Un-skip',
  'setup.state.done': 'Done',
  'setup.state.skipped': 'Skipped — deliberately not needed',
  'setup.needsAnotherPerson': 'needs an administrator',
  'setup.needsAnotherPerson.hint':
    'Somebody with admin rights has to do this, so it is the step most likely to make you wait.',
  'setup.openChecklist': 'Open the setup checklist for this provider',
  'setup.box.create_app.title': 'Create a Box platform app',
  'setup.box.create_app.detail':
    'Box Developer Console → Create Platform App → Custom App, and choose Client Credentials Grant (Server Authentication).',
  'setup.box.create_app.yields': 'a Client ID and a Client Secret.',
  'setup.box.configure_access.title': 'Give it read-only access',
  'setup.box.configure_access.detail':
    'On the app\u2019s Configuration tab set App Access Level to "App + Enterprise Access", tick only the read scope for files and folders, and enable "Generate user access tokens".',
  'setup.box.admin_authorize.title': 'Have a Box admin authorise the app',
  'setup.box.admin_authorize.detail':
    'Admin Console → Apps → Custom Apps Manager → Add app by Client ID, then authorise it. Until this is done Box refuses every token with "unauthorized_client".',
  'setup.box.subject_user_id.title': 'Find the numeric user id being migrated',
  'setup.box.subject_user_id.detail':
    'Admin Console → Users & Groups → the account you are migrating. Box wants the number, not the email address.',
  'setup.box.subject_user_id.yields': 'the Box user id (a number).',
  'setup.dropbox.create_app.title': 'Create a Dropbox app',
  'setup.dropbox.create_app.detail':
    'Dropbox App Console → Create app → Scoped access → Full Dropbox (or App folder if the migration should only ever see one folder).',
  'setup.dropbox.create_app.yields': 'an App key and an App secret.',
  'setup.dropbox.scopes.title': 'Give it read-only permissions',
  'setup.dropbox.scopes.detail':
    'On the Permissions tab enable files.metadata.read and files.content.read, and nothing that writes. Add sharing.read as well if you want to browse shared folders here.',
  'setup.dropbox.consent.title': 'Have the account owner consent once',
  'setup.dropbox.consent.detail':
    'Send the person whose Dropbox is being migrated through the authorisation URL for this app, with token_access_type=offline so Dropbox returns a refresh token.',
  'setup.dropbox.exchange_code.title': 'Exchange the code for a refresh token',
  'setup.dropbox.exchange_code.detail':
    'Swap the code from the previous step at Dropbox\u2019s token endpoint, once. Access tokens are minted from the result per run; nothing else long-lived is stored.',
  'setup.dropbox.exchange_code.yields': 'a refresh token.',
  'setup.google.create_oauth_client.title': 'Create a Google OAuth client',
  'setup.google.create_oauth_client.detail':
    'Google Cloud console → APIs & Services → Credentials → Create credentials → OAuth client ID, as a Desktop or Web application.',
  'setup.google.create_oauth_client.yields': 'a Client ID and a Client Secret.',
  'setup.google.enable_api.title': 'Enable the API for the product you are migrating',
  'setup.google.enable_api.detail':
    'In the same project, enable the API that matches the source you picked — Drive, Gmail, Calendar or People. A client without it fails on the first call.',
  'setup.google.consent_scope.title': 'Consent a read-only refresh token',
  'setup.google.consent_scope.detail':
    'Have the account owner consent with the scope for THAT product; a token consented for one Google product does not work for another. Alternatively use a service account with domain-wide delegation, which an admin authorises once for the whole domain.',
  'setup.google.consent_scope.yields': 'a refresh token (or a service-account key file).',
  'setup.graph.app_registration.title': 'Register an app in Microsoft Entra',
  'setup.graph.app_registration.detail':
    'Entra admin centre → App registrations → New registration, in the tenant whose mailboxes you are migrating.',
  'setup.graph.app_registration.yields': 'a Tenant ID and a Client ID.',
  'setup.graph.api_permissions.title': 'Add the read permissions and get admin consent',
  'setup.graph.api_permissions.detail':
    'Add the Graph permissions for what you are migrating (mail, calendar, contacts or files), then have a tenant administrator grant consent. Reading another user\u2019s mailbox or drive needs application permissions, which always require consent.',
  'setup.graph.client_secret.title': 'Create a client secret',
  'setup.graph.client_secret.detail':
    'Certificates & secrets → New client secret. Copy it immediately — Entra shows the value once.',
  'setup.graph.client_secret.yields': 'a Client Secret.',
  'setup.imap.server_address.title': 'Find the IMAP server address',
  'setup.imap.server_address.detail':
    'The host and port your mail provider documents for IMAP, and whether it uses SSL. Usually port 993 with SSL.',
  'setup.imap.server_address.yields': 'a host, a port and the SSL setting.',
  'setup.imap.app_password.title': 'Create an app password',
  'setup.imap.app_password.detail':
    'Most providers refuse a normal account password for IMAP when two-factor authentication is on, and want an app-specific password instead. Create one for the account being migrated.',
  'setup.imap.app_password.yields': 'a username and an app password.',
  'setup.webdav.account_exists.title': 'Make sure the destination account exists',
  'setup.webdav.account_exists.detail':
    'Create the account on the target server first, with enough quota for what is coming. Nothing here creates accounts.',
  'setup.webdav.app_password.title': 'Create an app password for it',
  'setup.webdav.app_password.detail':
    'In Nextcloud: Settings → Security → Devices & sessions → Create new app password. Use that rather than the account\u2019s own password.',
  'setup.webdav.app_password.yields': 'a username and an app password.',
  'setup.webdav.base_url.title': 'Note the WebDAV address',
  'setup.webdav.base_url.detail':
    'The server\u2019s WebDAV base URL for that account — Nextcloud shows it at the bottom of the Files settings page.',
  'setup.webdav.base_url.yields': 'the host, port and path to put in the wizard.',
  'setup.jmap.account_exists.title': 'Make sure the destination account exists',
  'setup.jmap.account_exists.detail':
    'Create the mailbox on the JMAP server first, with enough quota. Nothing here creates accounts.',
  'setup.jmap.api_token.title': 'Create an API token',
  'setup.jmap.api_token.detail':
    'Generate a token for that account in the server\u2019s own settings, with permission to write mail and files.',
  'setup.jmap.api_token.yields': 'a username and an API token.',
  'setup.davbasic.account_exists.title': 'Make sure the destination account exists',
  'setup.davbasic.account_exists.detail':
    'Create the account on the target server first, with enough quota for what is coming. Nothing here creates accounts.',
  'setup.davbasic.app_password.title': 'Create an app password for it',
  'setup.davbasic.app_password.detail':
    'Use an app-specific password rather than the account\u2019s own login where the server offers one — it can be revoked without changing the person\u2019s password.',
  'setup.davbasic.app_password.yields': 'a username and an app password.',
} as const;

const nl: Record<keyof typeof en, string> = {
  'nav.dashboard': 'Overzicht',
  'nav.mappings': 'Migraties',
  'nav.review': 'Controleren en bevestigen',
  'nav.deletions': 'Verwijderingen',
  'nav.moves': 'Verplaatsingen',
  'nav.failures': 'Mislukkingen',
  'nav.check': 'Verificatie',
  'nav.finish': 'Afronden',
  'nav.tenants': 'Organisaties',
  'nav.billing': 'Facturering',
  'nav.signOut': 'Uitloggen',
  'language.label': 'Taal',
  'common.requestFailed': 'Het verzoek is niet voltooid.',
  'asof.updated': 'Bijgewerkt',
  'asof.refresh': 'Vernieuwen',
  'confirm.progress.lastSynced': 'laatst gesynchroniseerd',
  'verify.checkedAt': 'Geverifieerd',
  'queue.loadFailed': 'Deze wachtrij kon niet worden geladen.',
  'queue.loadFailedNotEmpty':
    'Dit is niet hetzelfde als een lege wachtrij — er kunnen items wachten die niet gelezen konden worden.',
  'queue.noMappings': 'Geen migraties geconfigureerd.',
  'discovery.scanning': 'Uw bron wordt gescand (alleen-lezen)…',
  'discovery.th.type': 'Type',
  'discovery.th.collections': 'Collecties',
  'discovery.th.items': 'Items',
  'discovery.th.size': 'Grootte',
  'discovery.th.needsId': 'Heeft een ID nodig',
  'discovery.th.existing': 'Al op de bestemming',
  'discovery.keptAsIs': 'blijven ongewijzigd',
  'discovery.generatedId.pre.one':
    'bericht is aangekomen zonder Message-ID — daarmee kopiëren we elk bericht precies één keer. We genereren er een en voegen die toe aan',
  'discovery.generatedId.pre.many':
    'berichten zijn aangekomen zonder Message-ID — daarmee kopiëren we elk bericht precies één keer. We genereren er een en voegen die toe aan',
  'discovery.generatedId.strong': 'de kopie op uw nieuwe server',
  'discovery.generatedId.post':
    '— het origineel op uw oude server verandert niet. Deze berichten tellen mee in de aantallen hierboven en worden gemigreerd.',
  'discovery.colliding.pre.one': 'item dat al op uw bestemming staat, komt overeen met iets in uw bron. We',
  'discovery.colliding.pre.many': 'items die al op uw bestemming staan, komen overeen met iets in uw bron. We',
  'discovery.colliding.strong': 'behouden de kopie op de bestemming',
  'discovery.colliding.post': 'en overschrijven die niet. Al het andere dat er al staat, blijft onaangeroerd.',
  'applyFlag.readFailed': 'Kon niet lezen of het toepassen van verwijderingen is ingeschakeld:',
  'applyFlag.on': 'Het toepassen van verwijderingen staat AAN voor deze migratie.',
  'applyFlag.off': 'Het toepassen van verwijderingen staat UIT voor deze migratie (de standaard).',
  'applyFlag.turnOff': 'Uitschakelen',
  'applyFlag.refusesUntilOn':
    'De server weigert elke verwijderknop op dit scherm totdat dit is ingeschakeld.',
  'applyFlag.config.pre': 'Op deze appliance staat de waarde in het configuratiebestand van de mapping',
  'applyFlag.config.post': '; bewerk het bestand en herstart om dit te wijzigen. Geen enkele API past dit aan.',
  'applyFlag.turnOn': 'Toepassen van verwijderingen inschakelen',
  'applyFlag.turnOnArmed': 'Bevestig: verwijderingen inschakelen',
  'autoApply.on': 'Automatisch toepassen van verplaatsingen staat AAN voor deze migratie.',
  'autoApply.off': 'Automatisch toepassen van verplaatsingen staat UIT voor deze migratie (de standaard).',
  'autoApply.hint':
    'Indien ingeschakeld verwijdert elke bestandsronde zelf de OUDE kopieën van verplaatste of ' +
    'hernoemde bestanden — alleen wanneer dezelfde bytes aantoonbaar onder de nieuwe naam ' +
    'aanwezig zijn, de koppeling uniek is, de melding een volledige ronde heeft doorstaan en ' +
    'er geen massale gebeurtenis wordt vermoed. Alles wat wordt geweigerd blijft in deze ' +
    'wachtrij voor u staan. Verwijderingen worden nooit automatisch toegepast.',
  'autoApply.turnOn': 'Automatisch toepassen van verplaatsingen inschakelen',
  'autoApply.turnOnArmed': 'Bevestig: verplaatsingen onbeheerd automatisch toepassen',
  'scope.migrates': 'Migreert',
  'scope.partial': 'Gedeeltelijk',
  'scope.doesNotMigrate': 'Migreert niet',
  'login.title': 'Aanmelden bij Open Migrate',
  'login.tagline': 'Soevereine datamigratie voor gezinnen en mkb',
  'login.tokenLabel': 'Toegangstoken',
  'login.invalidToken':
    'Dit lijkt geen geldig toegangstoken (sub, e-mail, tenantId en rol zijn vereist).',
  'login.expiredToken':
    'Dit token is verlopen. Maak een nieuw token aan (seedscript of uw identityprovider) en plak dat in plaats hiervan.',
  'login.submit': 'Aanmelden',
  'login.help.pre': 'Plak het toegangstoken uit het seedscript',
  'login.help.post': 'of van uw identiteitsprovider.',
  'wizard.proto.imap.hint': 'Standaard e-mailprotocol',
  'wizard.proto.oauth2.hint': 'Office 365 via IMAP (appregistratie)',
  'wizard.proto.graph.hint': 'Office 365 via de Graph-API (appregistratie)',
  'wizard.proto.googleDrive.hint': 'Bestanden uit een Google Drive (alleen-lezen OAuth)',
  'wizard.proto.dropbox.hint': 'Bestanden uit een Dropbox (alleen-lezen OAuth-app)',
  'wizard.proto.box.hint': 'Bestanden uit een Box-account (alleen-lezen platform-app)',
  'wizard.boxUserId': 'Box-gebruikers-id (numeriek)',
  'wizard.boxUserId.placeholder': 'bijv. 1234567890 — Admin Console → Users & Groups',
  'wizard.boxRootFolderId': 'Id van de hoofdmap (optioneel)',
  'wizard.boxRootFolderId.placeholder': 'Leeg = All Files; een map-id beperkt de migratie',
  'wizard.review.boxUser': 'Box-gebruiker',
  'wizard.source.boxSetup':
    'Een Box-migratie authenticeert met uw eigen Box-platform-app via de Client Credentials Grant — geen refresh-token, want Box vernieuwt refresh-tokens bij elk gebruik. De Client-ID komt hier samen met het numerieke gebruikers-id dat gemigreerd wordt; het Client-geheim komt op de inloggegevens-stap. Een Box-beheerder moet de app eenmalig autoriseren (Admin Console → Apps → Custom Apps Manager). docs/box-setup.md doorloopt elke stap.',
  'wizard.dropboxAppKey': 'App-sleutel (uit de Dropbox App Console)',
  'wizard.dropboxRootPath': 'Pad van de hoofdmap (optioneel)',
  'wizard.dropboxRootPath.placeholder': 'Leeg = de hele Dropbox; bijv. /Team Docs',
  'wizard.browseDropboxFolders': 'Gedeelde mappen bekijken…',
  'wizard.noDropboxSharedFolders': 'Dit account ziet geen gedeelde mappen.',
  'wizard.dropboxUnmounted': 'niet gekoppeld — voeg deze eerst toe aan uw Dropbox',
  'wizard.review.wholeDropbox': 'de hele Dropbox',
  'wizard.source.dropboxSetup':
    'Een Dropbox-migratie authenticeert met uw eigen Dropbox-app: maak deze alleen-lezen aan (files.metadata.read + files.content.read; voeg sharing.read toe voor het bekijken van gedeelde mappen). De App-sleutel komt hier; op de inloggegevens-stap komt het App-geheim in het client-geheim-veld en de refresh-token ernaast. docs/dropbox-setup.md doorloopt elke stap.',
  'wizard.proto.gmail.hint': 'E-mail uit een Gmail-postvak (OAuth via IMAP)',
  'wizard.proto.googleCalendar.hint': "Agenda's uit een Google-account (OAuth via CalDAV)",
  'wizard.proto.googleContacts.hint': 'Contacten uit een Google-account (OAuth via CardDAV)',
  'wizard.refreshToken': 'Refresh-token',
  'wizard.refreshToken.hint':
    'Het gedelegeerde token voor het account dat wordt gemigreerd. Behandel het als een wachtwoord.',
  'wizard.rootFolderId': 'Hoofdmap-ID (optioneel)',
  'wizard.rootFolderId.placeholder': 'Leeg = heel Mijn Drive; een gedeelde Drive via het eigen ID',
  'wizard.review.myDrive': 'Mijn Drive',
  'wizard.targetPrefix': 'Doelmap (optioneel)',
  'wizard.targetPrefix.placeholder': 'Leeg = samenvoegen in het account zelf',
  'wizard.targetPrefix.hint':
    'Alles wat deze migratie schrijft komt onder deze map terecht — handig wanneer meerdere ' +
    'bronnen één doel delen en u per bron een submap wilt (bijv. "Gmail"). Laat leeg om samen ' +
    'te voegen; dat is de standaard: één account, één plek om te werken.',
  'wizard.source.driveSetup':
    'Een Google Drive-bron gebruikt uw eigen Google Cloud OAuth-client en een gedelegeerd, ' +
    'alleen-lezen refresh-token — docs/google-workspace-setup.md behandelt alle drie de waarden ' +
    'en eindigt met één alleen-lezen commando dat ze bewijst. Het token kan niet naar de Drive ' +
    'schrijven. Google Documenten, Spreadsheets en Presentaties worden één voor één als ' +
    'niet-migreerbaar gemeld, met de reden: er is geen bestand om te kopiëren, en renderen ' +
    'staat uit totdat de exportstabiliteit is gemeten.',
  'wizard.source.gmailSetup':
    'Een Gmail-bron gebruikt uw eigen Google Cloud OAuth-client — dezelfde als een Google ' +
    'Drive-bron — maar het refresh-token moet zijn toegestemd met de scope ' +
    'https://mail.google.com/, de enige die Google voor IMAP accepteert. Een token dat voor ' +
    'Drive is toegestemd werkt hier niet. docs/google-workspace-setup.md behandelt het verkrijgen ervan.',
  'wizard.source.googleDavSetup':
    'Deze bron gebruikt uw eigen Google Cloud OAuth-client \u2014 dezelfde als de andere ' +
    'Google-bronnen \u2014 maar het refresh-token moet zijn toegestemd met de eigen scope van dit ' +
    'product: https://www.googleapis.com/auth/calendar voor Agenda, ' +
    'https://www.googleapis.com/auth/carddav voor Contacten. Een token dat voor een ander ' +
    'Google-product is toegestemd werkt hier niet. docs/google-workspace-setup.md behandelt dit.',
  'hub.completionReport': 'Download het opleveringsrapport (Markdown)',
  'wizard.serviceAccountKey': 'Serviceaccount-sleutel (domeinbrede delegatie, optioneel)',
  'wizard.serviceAccountKey.placeholder': 'Plak het volledige JSON-sleutelbestand dat Google genereerde',
  'wizard.serviceAccountKey.width':
    'Deze sleutel kan elke gebruiker in het Workspace-domein lezen. Elke migratie benoemt nog steeds één account. Autoriseer alleen de benodigde scopes in de Admin-console, en trek de delegatie bij de overstap weer in.',
  'wizard.browseSharedDrives': 'Gedeelde Drives en mappen bekijken…',
  'wizard.noSharedDrives': 'Deze inloggegevens zien geen gedeelde Drives of gedeelde mappen — een lege hoofdmap migreert Mijn Drive.',
  'wizard.sharedDrivesGroup': 'Gedeelde Drives',
  'wizard.sharedFoldersGroup': 'Met mij gedeelde mappen',
  'wizard.testConnections': 'Verbindingen testen en bewaren',
  'wizard.testing': 'Testen…',
  'wizard.testConnections.hint':
    'Meldt zich aan beide kanten aan met wat u hebt ingevuld en toont wat zichtbaar is — ' +
    'er wordt niets naar beide systemen geschreven. Een kant die werkt, wordt BEWAARD als ' +
    'verbinding, zodat u die inloggegevens niet opnieuw hoeft op te halen als u de wizard ' +
    'verlaat.',
  'wizard.proto.jmap.hint': 'Modern e-mailprotocol',
  'wizard.proto.caldav.hint': 'Agendaprotocol',
  'wizard.proto.carddav.hint': 'Contactenprotocol',
  'wizard.proto.webdav.hint': 'Bestandsopslag',
  'wizard.title': 'Migratie aanmaken',
  'wizard.subtitle': 'Stel een nieuwe datamigratie tussen systemen in',
  'wizard.step.source': 'Bron',
  'wizard.step.target': 'Doel',
  'wizard.step.credentials': 'Naam & inloggegevens',
  'wizard.step.dataTypes': 'Gegevenstypen',
  'wizard.step.schedule': 'Schema',
  'wizard.step.review': 'Controleren',
  'wizard.selectSource': 'Kies het bronsysteem',
  'wizard.selectTarget': 'Kies het doelsysteem',
  'wizard.host': 'Host',
  'wizard.port': 'Poort',
  'wizard.useSsl': 'SSL/TLS gebruiken',
  'wizard.migrationName': 'Naam van de migratie',
  'wizard.migrationNameHint': 'Een herkenbare naam voor deze migratie',
  'wizard.credentials': 'Inloggegevens',
  'wizard.sourceUsername': 'Gebruikersnaam bron',
  'wizard.sourcePassword': 'Wachtwoord bron',
  'wizard.targetUsername': 'Gebruikersnaam doel',
  'wizard.targetPassword': 'Wachtwoord doel',
  'wizard.selectDataTypes': 'Kies de te migreren gegevenstypen',
  'wizard.selectDataTypesHint': 'Kies welke soorten gegevens u wilt migreren',
  'wizard.domain.email.hint': 'E-mailberichten en mappen',
  'wizard.domain.calendar.hint': 'Afspraken en agenda-items',
  'wizard.domain.contact.hint': 'Adresboekvermeldingen',
  'wizard.domain.file.hint': 'Bijlagen en documenten',
  'wizard.schedule': 'Synchronisatieschema',
  'wizard.scheduleHint': 'Kies hoe vaak gegevens tussen bron en doel synchroniseren',
  'wizard.schedule.hourly': 'Elk uur',
  'wizard.schedule.hourly.hint': 'Ieder uur',
  'wizard.schedule.daily': 'Dagelijks',
  'wizard.schedule.daily.hint': 'Elke dag om 02:00',
  'wizard.schedule.sixHourly': 'Elke 6 uur',
  'wizard.schedule.sixHourly.hint': 'Zes keer per dag',
  'wizard.schedule.quarterHourly': 'Elk kwartier',
  'wizard.schedule.quarterHourly.hint': 'Frequente synchronisatie',
  'wizard.customCron': 'Eigen cron-expressie (optioneel)',
  'wizard.customCronHint': 'Laat leeg voor de standaard dagelijkse synchronisatie om 02:00',
  'wizard.readyToCreate': 'Klaar om de migratie aan te maken',
  'wizard.reviewDetails': 'Migratiegegevens',
  'wizard.review.name': 'Naam',
  'wizard.review.source': 'Bron',
  'wizard.review.target': 'Doel',
  'wizard.review.schedule': 'Schema',
  'wizard.review.scheduleDefault': 'Dagelijks om 02:00',
  'wizard.review.dataTypes': 'Gegevenstypen',
  'wizard.review.note':
    'Aanmaken slaat deze configuratie op en start niets: de migratie wordt gepauzeerd ' +
    'aangemaakt. Daarna beoordeelt u wat een alleen-lezen scan in uw bron vindt en geeft u ' +
    'expliciet het startsein — tot die tijd wordt er niets gekopieerd.',
  'wizard.review.noteLead': 'Let op:',
  'wizard.back': 'Terug',
  'wizard.cancel': 'Annuleren',
  'wizard.next': 'Volgende',
  'wizard.create': 'Migratie aanmaken',
  'wizard.creating': 'Aanmaken…',
  'wizard.missing.lead': 'Nog invullen om verder te gaan:',
  'wizard.missing.dataTypes': 'kies minstens één gegevenstype',
  'wizard.showPassword': 'Toon wachtwoord',
  'wizard.hidePassword': 'Verberg wachtwoord',
  'wizard.credentials.storage':
    'Deze inloggegevens worden versleuteld opgeslagen, alleen gebruikt om verbinding te maken ' +
    'met uw bron en doel, en na deze stap nooit meer getoond.',
  'wizard.source.appRegistration':
    'OAuth2- en Microsoft Graph-bronnen gebruiken een Entra-appregistratie in uw eigen tenant: ' +
    'vul hier de tenant-ID en client-ID in, en op de stap met inloggegevens het clientgeheim ' +
    'samen met het mailboxadres. Registreer de app en verleen eerst beheerderstoestemming in ' +
    'uw eigen tenant — zie de O365-handleiding (docs/o365-setup.md).',
  'wizard.tenantId': 'Tenant-ID',
  'wizard.clientId': 'Client-ID (applicatie-ID)',
  'wizard.sourceClientSecret': 'Clientgeheim van de bron',
  'wizard.domain.notForTarget': 'Niet beschikbaar via het gekozen doelprotocol.',
  'wizard.cron.invalidLead': 'Geen geldig schema —',
  'wizard.cron.nextRuns': 'Met dit schema draaien de volgende synchronisaties op:',
  'wizard.leaveConfirm': 'Deze wizard verlaten? Alles wat u hier hebt ingevuld gaat verloren.',
  'billing.title': 'Facturatie',
  'billing.subtitle': 'Beheer uw abonnement, verbruik en betalingen',
  'billing.currentUsage': 'Huidig verbruik',
  'billing.storage': 'Opslag',
  'billing.dataTransfer': 'Dataverkeer',
  'billing.computeTime': 'Rekentijd',
  'billing.hours': 'uur',
  'billing.apiCalls': 'API-aanroepen',
  'billing.costBreakdown': 'Kostenoverzicht',
  'billing.baseFee': 'Basistarief',
  'billing.storageCost': 'Opslagkosten',
  'billing.compute': 'Rekenkosten',
  'billing.subtotal': 'Subtotaal',
  'billing.vat': 'btw',
  'billing.total': 'Totaal',
  'billing.noUsage': 'Nog geen verbruiksgegevens beschikbaar',
  'billing.invoices': 'Facturen',
  'billing.noInvoices': 'Nog geen facturen',
  'billing.invoice': 'Factuur',
  'billing.period': 'Periode:',
  'billing.paymentMethods': 'Betaalmethoden',
  'dashboard.total': 'Totaal migraties',
  'dashboard.errorLoading': 'Het dashboard kon niet worden geladen',
  'notifications.off': 'E-mailmeldingen staan uit',
  'notifications.offHint':
    'Niemand krijgt een e-mail wanneer deze migratie een beslissing nodig heeft. Stel SMTP in om ze aan te zetten.',
  'notifications.offReason': 'Reden van de server:',
  'dashboard.recentActivity': 'Recente activiteit',
  'dashboard.noActivity': 'Nog geen activiteit',
  'dashboard.noActivityHint': 'Maak uw eerste migratie aan om gegevens te synchroniseren',
  'dashboard.createMigration': 'Migratie aanmaken',
  'dashboard.view': 'Bekijken →',
  'dashboard.quickActions': 'Snelle acties',
  'dashboard.newMigration': 'Nieuwe migratie',
  'dashboard.newMigrationHint': 'Maak een nieuwe datamigratie aan',
  'dashboard.viewAll': 'Alle migraties bekijken',
  'dashboard.viewAllHint': 'Beheer uw migraties',
  'dashboard.team': 'Team',
  'dashboard.teamHint': 'Beheer wie toegang heeft',
  'mappings.title': 'Migraties',
  'mappings.subtitle': 'Beheer uw datamigratieconfiguraties',
  'mappings.new': 'Nieuwe migratie',
  'mappings.empty.title': 'Nog geen migraties',
  'mappings.empty.hint': 'Maak uw eerste migratie aan om gegevens tussen systemen te synchroniseren',
  'mappings.empty.cta': 'Maak uw eerste migratie aan',
  'mappings.th.name': 'Naam',
  'mappings.th.sourceTarget': 'Bron → Doel',
  'mappings.th.status': 'Status',
  'mappings.th.lastSync': 'Laatste synchronisatie',
  'mappings.th.actions': 'Acties',
  'mappings.action.triggerSync': 'Synchroniseer nu',
  'mappings.action.startSync': 'Start synchronisatie',
  'mappings.action.reviewAndStart': 'Controleren en starten',
  'mappings.action.delete': 'Verwijderen',
  'mappings.delete.explain':
    'Het verwijderen van deze migratie verwijdert de configuratie en de koppeling met de ' +
    'historie. Typ de naam van de migratie om te bevestigen.',
  'mappings.delete.confirm': 'Migratie verwijderen',
  'mappings.delete.cancel': 'Annuleren',
  'mappings.delete.failed': 'De migratie is niet verwijderd.',
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
    'Verwijdering in de wachtrij — de taak controleert elk controlepunt opnieuw voordat er iets wordt aangeraakt.',
  'receipt.applied.binned':
    'Verwijderd — verplaatst naar de prullenbak van het doelsysteem; daar is mogelijk nog een kopie terug te halen.',
  'receipt.applied.deleted': 'Verwijderd — weg, zonder herstelmogelijkheid vanaf hier.',
  'receipt.applied.unknown':
    'Verwijderd. Hoe definitief de verwijdering was, staat niet op het ontvangstbewijs.',
  'receipt.failedPrefix': 'De verwijdertaak is mislukt:',
  'lifecycle.paused':
    'Deze migratie is nog niet gestart, dus er is niets gekopieerd en er kan niets zijn afgeweken.',
  'hub.fallbackTitle': 'Migratie',
  'hub.orderIntro':
    'De vijf schermen hieronder staan in de volgorde waarin een cutover verloopt — werk de lijst van boven naar beneden af.',
  'hub.noId': 'Geen mapping-id in het adres.',
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
  'hub.sharing.name': 'Delen',
  'hub.sharing.blurb':
    'Wie wat kon bereiken op het oude systeem — overgezet, handmatig gedaan, of bewust niet. Een checklist, af te werken na het afronden.',
  'sharing.title': 'Deel-checklist',
  'sharing.intro':
    'Alles wat iemand anders kon bereiken op het oude systeem, één regel per recht. Werk elke regel af: maak het delen aan op het nieuwe systeem, vink af als handmatig gedaan, of sla bewust over — elke afgewerkte regel onthoudt wie besliste, en wanneer.',
  'sharing.progressSettled': 'afgewerkt',
  'sharing.openManualNote':
    'regel(s) staan op handmatig — stappen voor u op het nieuwe systeem; vink ze hier af zodra gedaan.',
  'sharing.rescan': 'Opnieuw inlezen van de bron…',
  'sharing.blindSpots': 'Kon niet worden geïnventariseerd — leg deze handmatig vast:',
  'sharing.empty': 'Nog geen gedeelde rechten op de lijst. Lees opnieuw in van de bron om te scannen.',
  'sharing.apply': 'Delen aanmaken op nieuw systeem',
  'sharing.applyArmed': 'Klik nogmaals — dit deelt ÉN nodigt uit',
  'sharing.done': 'Afvinken',
  'sharing.skip': 'Overslaan',
  'sharing.linkShare': 'deel-link',
  'sharing.manualBadge': 'handmatig',
  'sharing.granteeLabel': 'delen met',
  'sharing.inviteNote':
    'Toepassen maakt het delen aan op het nieuwe systeem, dat vervolgens zelf de uitnodiging naar dit adres stuurt — controleer eerst het adres.',
  'sharing.state.applied': 'gedeeld op het nieuwe systeem',
  'sharing.state.doneManual': 'handmatig gedaan',
  'sharing.state.skipped': 'overgeslagen',
  'sharing.loadFailed': 'De deel-checklist kon niet worden gelezen.',
  'hub.check.name': 'Verificatie',
  'hub.check.blurb':
    'Vergelijk de twee systemen en controleer steekproeven van de inhoud, achter één knop.',
  'hub.finish.name': 'Afronden',
  'hub.finish.blurb':
    'De cutover-checklist. Beëindigt de migratie — in volgorde, met de ene stap die u zelf moet bevestigen.',
  'runs.title': 'Uitvoeringsgeschiedenis',
  'runs.blurb':
    'Elke synchronisatieronde van deze migratie, nieuwste eerst, met wat elke ronde meldde.',
  'runs.empty': 'Er zijn nog geen rondes uitgevoerd. Geschiedenis verschijnt na de eerste synchronisatie.',
  'runs.truncated': 'Alleen de nieuwste rondes worden getoond — oudere bestaan, maar staan niet in de lijst.',
  'runs.eventsTruncated': 'Alleen de nieuwste logregels — eerdere worden niet getoond.',
  'runs.error': 'Kon de uitvoeringsgeschiedenis van deze migratie niet lezen.',
  'runs.items': 'Items',
  'runs.errors': 'Fouten',
  'runs.events': 'Logboek',
  'state.lifecycle.active': 'Actief',
  'state.lifecycle.paused': 'Gepauzeerd',
  'state.lifecycle.cutover': 'In cutover',
  'state.lifecycle.done': 'Afgerond',
  'state.invoice.draft': 'Concept',
  'state.invoice.sent': 'Verzonden',
  'state.invoice.paid': 'Betaald',
  'state.invoice.overdue': 'Achterstallig',
  'state.invoice.void': 'Vervallen',
  'runs.status.pending': 'In afwachting',
  'runs.status.running': 'Wordt uitgevoerd',
  'runs.status.success': 'Geslaagd',
  'runs.status.failed': 'Mislukt',
  'runs.status.cancelled': 'Geannuleerd',
  'queue.waitingOnYou': 'Wacht op u',
  'queue.alreadyDecided': 'Al beslist',
  'moves.title': 'Verplaatst op het oude systeem',
  'moves.intro':
    'Items die de eigenaar ergens anders heeft ondergebracht dan waar ze vandaan kwamen. Het nieuwe systeem heeft ze nog waar wij ze plaatsten; aan geen van beide kanten is iets veranderd.',
  'moves.empty.open': 'Er is niets verplaatst.',
  'moves.empty.acknowledged': 'Er is nog niets beslist.',
  'moves.keep': 'Laat het waar het staat',
  'moves.apply': 'Verwijder de oude kopie',
  'moves.applyArmed': 'Bevestig verwijdering',
  'moves.renamedTo': 'hernoemd',
  'failures.title': 'Kon niet worden gekopieerd',
  'failures.intro':
    'Items die niet zijn overgekomen, wat er misging, en hoe vaak we het hebben geprobeerd.',
  'failures.empty.needsDecision': 'Er wacht niets op een beslissing.',
  'failures.acceptedLeave':
    'Geaccepteerde items verschijnen hier niet meer — accepteren migreert zonder het item, en het grootboek telt het niet langer als mislukt.',
  'failures.seeRuns': 'Bekijk de mislukte ronde (uitvoeringsgeschiedenis)',
  'failures.stillTrying': 'Wordt nog geprobeerd',
  'failures.empty.retrying': 'Er wordt niets opnieuw geprobeerd.',
  'failures.retry': 'Probeer opnieuw',
  'failures.retryCost':
    'Opnieuw proberen wist de synchronisatiecursors van deze migratie, zodat de volgende ronde alles opnieuw doorloopt om dit item weer te bereiken. Die ronde duurt langer; er wordt niets dubbel gekopieerd.',
  'failures.accept': 'Migreer zonder dit item',
  'failures.try.one': 'poging',
  'failures.try.many': 'pogingen',
  'deletions.title': 'Verwijderd op het oude systeem',
  'deletions.intro':
    'Items die de eigenaar heeft verwijderd waar ze vandaan kwamen, maar die het nieuwe systeem nog heeft. Er is aan geen van beide kanten iets verwijderd.',
  'deletions.empty.confirmed': 'Er wacht niets op een beslissing.',
  'deletions.watching': 'Wordt in de gaten gehouden',
  'deletions.empty.watching': 'Er wordt niets in de gaten gehouden.',
  'deletions.empty.acknowledged': 'Er is nog niets beslist.',
  'deletions.keep': 'Behoud onze kopie',
  'deletions.apply': 'Verwijder het hier ook',
  'deletions.applyArmed': 'Bevestig verwijderen',
  'common.loading': 'Laden…',
  'common.cancel': 'Annuleren',
  'docs.title': 'Instelhandleidingen',
  'docs.all': '← Alle instelhandleidingen',
  'docs.notFound': 'Er is geen handleiding met die naam. Dit zijn de handleidingen die bij deze versie horen:',
  'mappings.lastSync': 'Laatste synchronisatie:',
  'mappings.never': 'Nooit',
  'mappings.loadFailed': 'De migratielijst kon niet worden geladen.',
  'mappings.loadFailedNotEmpty':
    'Dit is niet hetzelfde als geen migraties — er kunnen migraties bestaan die niet gelezen konden worden.',
  'mappings.syncFailed': 'Het synchronisatieverzoek is niet voltooid.',
  'createMapping.createFailed':
    'De migratie is niet aangemaakt. Uw invoer staat er nog — herstel wat de melding noemt en probeer het opnieuw.',
  'dashboard.runsReadFailed': 'De uitvoeringsgeschiedenis kon niet worden gelezen:',
  'dashboard.noRunsYet': 'Nog geen rondes',
  'dashboard.runItems': 'items',
  'dashboard.runErrors': 'fouten',
  'billing.usageLoadFailed': 'De verbruikscijfers konden niet worden geladen.',
  'billing.pay': 'Betalen',
  'billing.payFailed': 'De betaling kon niet worden gestart.',
  'billing.usagePeriod': 'Verbruik voor',
  'billing.asOf': 'per',
  'billing.noPaymentMethods': 'Geen betaalmethoden opgeslagen.',
  'billing.paymentMethodsLoadFailed': 'De betaalmethoden konden niet worden geladen.',
  'billing.default': 'Standaard',
  'billing.adminOnly': 'Facturatie is alleen beschikbaar voor eigenaren en beheerders. Vraag een eigenaar of beheerder van deze organisatie naar gebruiks- of factuurgegevens.',
  'billing.invoicesLoadFailed': 'De facturen konden niet worden geladen.',
  'billing.loadFailedNotEmpty':
    'Dit is niet hetzelfde als geen gegevens — er kunnen gegevens bestaan die niet gelezen konden worden.',
  'confirm.nextSteps': 'Hierna, in cutover-volgorde:',
  'confirm.title': 'Controleer en bevestig uw migratie',
  'confirm.intro': 'Er is nog niets gekopieerd. Controleer wat er migreert en start het daarna.',
  'confirm.readError': 'De migraties konden niet worden gelezen.',
  'confirm.noMappings': 'Geen migraties geconfigureerd.',
  'confirm.noMappings.how':
    'De appliance leest migraties als JSON-bestanden uit de configuratiemap (op Docker de gekoppelde config-map; op Windows C:\\ProgramData\\OpenMigrate\\config). Kopieer mapping.json.example, vul uw bron en doel in, verwijs naar geheimen via de naam van een omgevingsvariabele en herstart de appliance — de map wordt eenmalig bij het starten gelezen. De volledige uitleg staat in docs/selfhost-quickstart.md, stap 3.',
  'confirm.start': 'Start migratie',
  'confirm.startError': 'Kon niet starten:',
  'confirm.startErrorFallback': 'het verzoek is mislukt',
  'confirm.openConsole': 'Open de migratieconsole',
  'confirm.whatMigrates': 'Wat migreert er',
  'confirm.note.active': 'Actief. Het synchroniseert volgens schema en meldt alles wat uw aandacht nodig heeft.',
  'confirm.note.cutover': 'In cutover.',
  'confirm.note.done': 'Afgerond. Deze migratie synchroniseert niet meer.',
  'confirm.introStarted':
    'Migraties hier zijn gestart. De live voortgang staat per migratie; de scan van voor de start blijft bewaard als momentopname.',
  'confirm.progress.heading': 'Live voortgang',
  'confirm.progress.synced': 'gesynchroniseerd',
  'confirm.progress.failed': 'mislukt',
  'confirm.progress.retrying': 'in nieuwe poging',
  'confirm.snapshot.heading': 'Scan van voor de start (momentopname)',
  'confirm.snapshot.note':
    'Eenmalig geteld, voor de start, om te tonen wat er zou migreren. De bron verandert daarna gewoon door en deze aantallen niet — de live voortgang hierboven komt uit het grootboek.',
  'confirm.state.pending': 'In afwachting',
  'confirm.state.in_progress': 'Synchroniseert',
  'confirm.state.completed': 'Voltooid',
  'confirm.state.failed': 'Mislukt',
  'confirm.state.skipped': 'Overgeslagen',
  'confirm.foundInSource': 'Wat we in uw bron hebben gevonden',
  'confirm.starting': 'Bezig met starten…',
  'verify.title': 'Verifieer de migratie',
  'verify.intro':
    'Vergelijkt wat het oude systeem heeft met wat het nieuwe heeft, en controleert steekproeven van de inhoud. Alleen-lezen — er wordt aan geen van beide kanten iets geschreven.',
  'verify.run': 'Voer de verificatie uit',
  'verify.runAgain': 'Verifieer opnieuw',
  'verify.durationHint':
    'Leest de volledige bestemming — bij een grote mailbox duurt dit minuten.',
  'verify.applianceScope':
    'Op deze appliance omvat de verificatie altijd elke geconfigureerde migratie.',
  'verify.runningSince': 'Bezig sinds',
  'verify.didNotComplete': 'De verificatie is niet voltooid.',
  'verify.notAResult':
    'Er is in geen van beide richtingen iets bekend over de volledigheid van de migratie — dit is geen resultaat.',
  'verify.restarted': 'De appliance is herstart terwijl de verificatie liep. Voer hem opnieuw uit.',
  'verify.didNotStart': 'De verificatie is niet gestart.',
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
    'Nooit gestart, dus er is niets af te ronden. Verwijder de migratie om deze op te ruimen.',
  'finish.note.active':
    'Synchroniseert volgens schema. Items die nog op het oude systeem binnenkomen, worden gekopieerd.',
  'finish.note.cutover': 'In cutover. Synchroniseert nog totdat u afrondt.',
  'finish.note.done':
    'Afgerond. Deze migratie synchroniseert niet meer en er wordt niets meer voor gerapporteerd.',
  'finish.left.one': 'item niet gemigreerd achtergelaten.',
  'finish.left.many': 'items niet gemigreerd achtergelaten.',
  'finish.step1.title': 'Controleer of de kopie volledig is',
  'finish.step1.pre': 'Vergelijk de twee systemen en controleer steekproeven van de inhoud.',
  'finish.step1.link': 'Voer de controle uit',
  'finish.step1.post':
    '. Leest de volledige bestemming, dus bij een grote mailbox duurt dit minuten.',
  'finish.step2.title': 'Werk de beslissingswachtrijen weg',
  'finish.step1.passed': 'De verificatie is geslaagd.',
  'finish.step1.notPassed': 'De verificatie is niet geslaagd:',
  'finish.step1.noRun': 'Er is nog geen verificatie uitgevoerd.',
  'finish.step1.running': 'Er loopt nu een verificatie.',
  'finish.step1.readFailed': 'De verificatiestatus kon niet worden gelezen:',
  'finish.step2.readFailed': 'Een wachtrij kon niet worden gelezen:',
  'finish.step2.notSameAsClear': '— niet hetzelfde als leeg.',
  'finish.step3.failedFramed':
    'Het verzoek is mislukt — mogelijk loopt er nog een ronde. Wacht even en controleer daarna de wachtrijen hierboven opnieuw.',
  'finish.retryButton': 'Probeer opnieuw af te ronden',
  'finish.aftermath.title': 'Wat beschikbaar blijft',
  'finish.aftermath.verify': 'Verificatierapport',
  'finish.aftermath.runs': 'Uitvoeringsgeschiedenis (op de migratiepagina)',
  'finish.step2.reading': 'Lezen…',
  'finish.step2.clear': 'Er wacht niets op u.',
  'finish.step2.failures.one': 'kon niet worden gekopieerd',
  'finish.step2.failures.many': 'konden niet worden gekopieerd',
  'finish.step2.deletions': 'verwijderd op het oude systeem',
  'finish.step2.moves': 'verplaatst',
  'finish.step2.onlyFirstBlocks':
    '. Alleen de eerste hiervan blokkeert het afronden — de andere twee zijn al beantwoord doordat het nieuwe systeem zijn kopie behoudt.',
  'finish.step3.title': 'Voer één laatste ronde uit',
  'finish.step3.body': 'Zodat het nieuwe systeem het oude weerspiegelt zoals het nu is.',
  'finish.step3.run': 'Voer nu een ronde uit',
  'finish.step3.runAgain': 'Voer er nog een uit',
  'finish.step3.finished': 'De ronde is uitgevoerd en voltooid.',
  'finish.step3.queued':
    'In de wachtrij. De ronde draait als taak en verschijnt in de uitvoeringsgeschiedenis — geef het even, en controleer daarna de wachtrijen hierboven opnieuw.',
  'finish.step4.title': 'Zet de e-mailbezorging om naar het nieuwe systeem',
  'finish.step4.body':
    'Wijzig MX/DNS en configureer de clients opnieuw zodat nieuwe e-mail op het nieuwe systeem aankomt. Dit gebeurt buiten dit programma, dus dit is de ene stap die niemand hier voor u kan controleren.',
  'finish.step4.warn.pre': 'Als u afrondt voordat dit is gedaan',
  'finish.step4.warn.post':
    ', wordt alles wat daarna op het oude systeem binnenkomt niet gekopieerd, en niets zal het melden — het programma kijkt niet meer mee.',
  'finish.step4.checkbox': 'Nieuwe e-mail komt nu aan op het nieuwe systeem.',
  'finish.step5.title': 'Afronden',
  'finish.step5.nothingChanges.pre':
    'Er wordt aan geen van beide systemen iets toegevoegd of verwijderd.',
  'finish.step5.nothingChanges.post':
    ' Wat op het nieuwe systeem staat, blijft precies zoals het is — dit stopt alleen het meekijken met het oude.',
  'finish.forceButton': 'Rond toch af en laat ze achter',
  'finish.button': 'Rond deze migratie af',
  'finish.button.disabledTitle':
    'Bevestig eerst stap 4 — afronden voordat de e-mailbezorging is omgezet, verliest alles wat daarna binnenkomt.',
  'createMapping.target.userOperated':
    'De doelserver beheert u zelf. Wij zetten uw gegevens erin over — wij beheren, ' +
    'bewaken of back-uppen hem niet, en er geldt van onze kant geen serviceniveau voor. ' +
    'Is het een beheerd Europees platform, dan is de aanbieder ervan ' +
    'verantwoordelijk.',
  'tenants.title': 'Team & organisatie',
  'tenants.intro':
    'Wie zich bij deze organisatie kan aanmelden, en wat ze mogen doen. Wijzigingen gelden direct.',
  'tenants.noTenant': 'Geen organisatie in deze sessie.',
  'tenants.selfDemotionArmed':
    'Hiermee verlaagt u uw eigen rol — u kunt dit mogelijk niet zelf terugdraaien.',
  'tenants.selfDemotionConfirm': 'Bevestig rolwijziging',
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
  'decisions.presets.newMailbox': 'Als er een postvak verschijnt waarvoor niets migreert',
  'decisions.presets.ask': 'Vraag het mij',
  'decisions.presets.auto': 'Automatisch beantwoorden',
  'decisions.presets.saved': 'Opgeslagen.',
  'decisions.presets.readError':
    'De vaste antwoorden konden niet worden gelezen; deze wachtrij beantwoordt mogelijk ' +
    'categorieën zonder te tonen welke.',
  'decisions.presets.readOnly': 'Een eigenaar of beheerder stelt dit in.',
  'permissions.heading': 'Zet de rechten over voordat u de e-mailbezorging omzet',
  'permissions.body':
    'Wie wiens agenda kon zien, wie toegang had tot welke gedeelde bestanden — dat verhuist ' +
    'niet mee met de mail. Haal de lijst op, werk hem door op het nieuwe systeem, en doe dat ' +
    'vóórdat u de e-mailbezorging omzet: rechten die daarna worden toegevoegd, ontbraken zolang dat ' +
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
  'decisions.dismiss': 'Terzijde leggen',
  'decisions.sharedAddress.shared_s': 'Eén gedeeld postvak',
  'decisions.sharedAddress.distribution_d': 'Een distributielijst',
  'decisions.empty.noDetectors':
    'Er wacht niets. De detectoren voor nieuwe postvakken en gedeelde adressen draaien eenmaal per ' +
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
  'decisions.answeredBy': 'door',
  'decisions.answer': 'Antwoord:',
  'decisions.detailToggle': 'Details',
  'decisionStatus.resolved': 'Beslist',
  'decisionStatus.auto_resolved': 'Beslist door vast antwoord',
  'decisionStatus.dismissed': 'Terzijde gelegd',
  'nav.connections': 'Verbindingen',
  'nav.setup': 'Instelchecklist',
  'nav.docs': 'Handleidingen',
  'wizard.reuseSource': 'Gebruik een bronverbinding die u al heeft',
  'wizard.reuseTarget': 'Gebruik een doelverbinding die u al heeft',
  'wizard.reuseNone': 'Nee — hieronder nieuwe inloggegevens invoeren',
  'wizard.reuse.hint':
    'Als u er een kiest worden de opgeslagen inloggegevens hergebruikt, zodat u hetzelfde geheim niet twee keer plakt. De velden hieronder verdwijnen dan.',
  'connections.delete': 'Verwijderen',
  'connections.rotate': 'Inloggegevens vervangen',
  'connections.rotate.hint':
    'Plak de nieuwe waarden. Ze worden gecontroleerd vóór ze de oude vervangen — mislukt de controle, dan verandert er niets en houden uw migraties wat werkte.',
  'connections.rotate.save': 'Controleren en vervangen',
  'connections.add': 'Verbinding toevoegen',
  'connections.addAndTest': 'Toevoegen en testen',
  'connections.role': 'Is dit een bron of een doel?',
  'connections.type': 'Aanbieder',
  'connections.name': 'Geef het een naam (zodat u het later herkent)',
  'connections.title': 'Verbindingen',
  'connections.intro':
    'De bron- en doelaccounts waarmee uw migraties inloggen. Test er een om te controleren of de inloggegevens nog werken — dat voert dezelfde alleen-lezen controle uit als een migratie en toont precies wat de aanbieder zegt.',
  'connections.none': 'Nog geen verbindingen. Bij het aanmaken van uw eerste migratie worden ze toegevoegd.',
  'connections.sources': 'Bronnen',
  'connections.targets': 'Doelen',
  'connections.test': 'Testen',
  'connections.testing': 'Bezig met testen…',
  'connections.usedBy': 'postbus(sen) gebruiken dit',
  'connections.setupSteps': 'Instelstappen',
  'connections.ok': 'Bereikt. De inloggegevens werken nog.',
  'connections.failed': 'Kon deze niet bereiken.',
  // ---- Provider setup checklist (workplan 0061) ----
  'setup.title': 'Wat u instelt bij de aanbieder',
  'setup.intro':
    'Deze stappen doet u in de console van de aanbieder zelf, niet hier. Vink ze af terwijl u bezig bent — deze lijst wordt bewaard voor uw hele organisatie, dus u kunt stoppen en later verdergaan, en een collega kan het overnemen.',
  'setup.backToWizard': '← Terug naar de migratiewizard',
  'setup.fullGuide': 'Lees de volledige handleiding',
  'setup.settled': 'afgehandeld',
  'setup.stillOpen': 'nog te doen',
  'setup.waitingOnOthers': 'wacht op een beheerder',
  'setup.allDone': 'Alles hier is afgehandeld — u kunt de wizard afronden.',
  'setup.nothingToDo': 'Voor deze aanbieder hoeft u vooraf niets in te stellen. Ga direct naar de wizard.',
  // ---- Aanbieder kiezen en de lijst afstemmen op wie u bent (workplan 0068) ----
  'setup.choose.title': 'Wat wilt u instellen?',
  'setup.choose.intro':
    'Kies het systeem waarvandaan of waarnaartoe u migreert. Elk systeem heeft een eigen korte lijst met zaken die u vooraf regelt.',
  'setup.choose.sources': 'Migreren vanaf',
  'setup.choose.targets': 'Migreren naar',
  'setup.admin.question': 'Beheert u dit systeem voor uw organisatie?',
  'setup.admin.yes': 'Ja, ik ben beheerder',
  'setup.admin.no': 'Nee, iemand anders',
  'setup.admin.unsure': 'Laat alles zien',
  'setup.admin.hint':
    'Dit verandert alleen de indeling van de lijst hieronder. Het wordt op dit apparaat onthouden, voor u — een collega die anders antwoordt, ziet zijn eigen indeling.',
  'setup.yours': 'Wat u zelf kunt doen',
  'setup.forYourAdmin': 'Wat uw beheerder moet doen',
  'setup.forYourAdmin.hint':
    'Hiervoor zijn rechten nodig die u naar eigen zeggen niet heeft. Stuur ze door naar de beheerder van dit systeem; u kunt ze hier afvinken zodra die het bevestigt.',
  'setup.yields': 'Dit levert op:',
  'setup.tick': 'Deze stap afvinken',
  'setup.untick': 'Vinkje weghalen',
  'setup.skip': 'Overslaan',
  'setup.unskip': 'Niet overslaan',
  'setup.state.done': 'Gedaan',
  'setup.state.skipped': 'Overgeslagen — bewust niet nodig',
  'setup.needsAnotherPerson': 'beheerder nodig',
  'setup.needsAnotherPerson.hint':
    'Iemand met beheerdersrechten moet dit doen, dus dit is de stap waarop u het vaakst moet wachten.',
  'setup.openChecklist': 'Open de instelchecklist voor deze aanbieder',
  'setup.box.create_app.title': 'Maak een Box-platform-app',
  'setup.box.create_app.detail':
    'Box Developer Console → Create Platform App → Custom App, en kies Client Credentials Grant (Server Authentication).',
  'setup.box.create_app.yields': 'een Client-ID en een Client-geheim.',
  'setup.box.configure_access.title': 'Geef de app alleen-leestoegang',
  'setup.box.configure_access.detail':
    'Op het tabblad Configuration: zet App Access Level op "App + Enterprise Access", vink alleen de leesrechten voor bestanden en mappen aan en zet "Generate user access tokens" aan.',
  'setup.box.admin_authorize.title': 'Laat een Box-beheerder de app autoriseren',
  'setup.box.admin_authorize.detail':
    'Admin Console → Apps → Custom Apps Manager → voeg de app toe op Client-ID en autoriseer deze. Tot dat gebeurd is weigert Box elk token met "unauthorized_client".',
  'setup.box.subject_user_id.title': 'Zoek het numerieke gebruikers-id op',
  'setup.box.subject_user_id.detail':
    'Admin Console → Users & Groups → het account dat u migreert. Box wil het nummer, niet het e-mailadres.',
  'setup.box.subject_user_id.yields': 'het Box-gebruikers-id (een nummer).',
  'setup.dropbox.create_app.title': 'Maak een Dropbox-app',
  'setup.dropbox.create_app.detail':
    'Dropbox App Console → Create app → Scoped access → Full Dropbox (of App folder als de migratie maar één map mag zien).',
  'setup.dropbox.create_app.yields': 'een App-sleutel en een App-geheim.',
  'setup.dropbox.scopes.title': 'Geef de app alleen-leesrechten',
  'setup.dropbox.scopes.detail':
    'Zet op het tabblad Permissions files.metadata.read en files.content.read aan, en niets dat schrijft. Voeg sharing.read toe als u hier gedeelde mappen wilt kunnen bekijken.',
  'setup.dropbox.consent.title': 'Laat de accounthouder eenmalig toestemming geven',
  'setup.dropbox.consent.detail':
    'Stuur de persoon van wie de Dropbox gemigreerd wordt door de autorisatie-URL van deze app, met token_access_type=offline zodat Dropbox een refresh-token teruggeeft.',
  'setup.dropbox.exchange_code.title': 'Wissel de code in voor een refresh-token',
  'setup.dropbox.exchange_code.detail':
    'Wissel de code uit de vorige stap eenmalig in bij het token-eindpunt van Dropbox. Toegangstokens worden per run aangemaakt; verder wordt niets langlevends bewaard.',
  'setup.dropbox.exchange_code.yields': 'een refresh-token.',
  'setup.google.create_oauth_client.title': 'Maak een Google OAuth-client',
  'setup.google.create_oauth_client.detail':
    'Google Cloud console → APIs & Services → Credentials → Create credentials → OAuth client ID, als Desktop- of Web-toepassing.',
  'setup.google.create_oauth_client.yields': 'een Client-ID en een Client-geheim.',
  'setup.google.enable_api.title': 'Zet de API aan voor het product dat u migreert',
  'setup.google.enable_api.detail':
    'Zet in hetzelfde project de API aan die past bij de gekozen bron — Drive, Gmail, Calendar of People. Zonder dat mislukt de eerste aanroep.',
  'setup.google.consent_scope.title': 'Laat een alleen-lezen refresh-token toestemmen',
  'setup.google.consent_scope.detail':
    'Laat de accounthouder toestemmen met de scope van DAT product; een token dat voor het ene Google-product is toegestemd werkt niet voor het andere. U kunt ook een service-account met domain-wide delegation gebruiken, dat een beheerder eenmalig voor het hele domein autoriseert.',
  'setup.google.consent_scope.yields': 'een refresh-token (of een service-account-sleutelbestand).',
  'setup.graph.app_registration.title': 'Registreer een app in Microsoft Entra',
  'setup.graph.app_registration.detail':
    'Entra-beheercentrum → App registrations → New registration, in de tenant waarvan u de postbussen migreert.',
  'setup.graph.app_registration.yields': 'een Tenant-ID en een Client-ID.',
  'setup.graph.api_permissions.title': 'Voeg de leesrechten toe en laat een beheerder toestemmen',
  'setup.graph.api_permissions.detail':
    'Voeg de Graph-rechten toe voor wat u migreert (mail, agenda, contacten of bestanden) en laat een tenantbeheerder toestemming geven. De postbus of drive van een ander lezen vereist application permissions, en die vragen altijd om toestemming.',
  'setup.graph.client_secret.title': 'Maak een clientgeheim',
  'setup.graph.client_secret.detail':
    'Certificates & secrets → New client secret. Kopieer de waarde meteen — Entra toont deze één keer.',
  'setup.graph.client_secret.yields': 'een Client-geheim.',
  'setup.imap.server_address.title': 'Zoek het IMAP-serveradres op',
  'setup.imap.server_address.detail':
    'De host en poort die uw mailaanbieder voor IMAP documenteert, en of er SSL gebruikt wordt. Meestal poort 993 met SSL.',
  'setup.imap.server_address.yields': 'een host, een poort en de SSL-instelling.',
  'setup.imap.app_password.title': 'Maak een app-wachtwoord',
  'setup.imap.app_password.detail':
    'De meeste aanbieders weigeren een gewoon accountwachtwoord voor IMAP zodra tweestapsverificatie aanstaat en willen een app-specifiek wachtwoord. Maak er één voor het account dat gemigreerd wordt.',
  'setup.imap.app_password.yields': 'een gebruikersnaam en een app-wachtwoord.',
  'setup.webdav.account_exists.title': 'Zorg dat het doelaccount bestaat',
  'setup.webdav.account_exists.detail':
    'Maak het account eerst aan op de doelserver, met genoeg quota voor wat eraan komt. Dit product maakt zelf geen accounts aan.',
  'setup.webdav.app_password.title': 'Maak er een app-wachtwoord voor',
  'setup.webdav.app_password.detail':
    'In Nextcloud: Instellingen → Beveiliging → Apparaten & sessies → Nieuw app-wachtwoord. Gebruik dat in plaats van het accountwachtwoord zelf.',
  'setup.webdav.app_password.yields': 'een gebruikersnaam en een app-wachtwoord.',
  'setup.webdav.base_url.title': 'Noteer het WebDAV-adres',
  'setup.webdav.base_url.detail':
    'De WebDAV-basis-URL van de server voor dat account — Nextcloud toont deze onderaan de pagina met bestandsinstellingen.',
  'setup.webdav.base_url.yields': 'de host, poort en het pad voor in de wizard.',
  'setup.jmap.account_exists.title': 'Zorg dat het doelaccount bestaat',
  'setup.jmap.account_exists.detail':
    'Maak de postbus eerst aan op de JMAP-server, met genoeg quota. Dit product maakt zelf geen accounts aan.',
  'setup.jmap.api_token.title': 'Maak een API-token',
  'setup.jmap.api_token.detail':
    'Genereer in de instellingen van de server een token voor dat account, met rechten om mail en bestanden te schrijven.',
  'setup.jmap.api_token.yields': 'een gebruikersnaam en een API-token.',
  'setup.davbasic.account_exists.title': 'Zorg dat het doelaccount bestaat',
  'setup.davbasic.account_exists.detail':
    'Maak het account eerst aan op de doelserver, met genoeg quota voor wat eraan komt. Dit product maakt zelf geen accounts aan.',
  'setup.davbasic.app_password.title': 'Maak er een app-wachtwoord voor',
  'setup.davbasic.app_password.detail':
    'Gebruik waar de server dat aanbiedt een app-specifiek wachtwoord in plaats van de gewone login — dat kan ingetrokken worden zonder het wachtwoord van de persoon te wijzigen.',
  'setup.davbasic.app_password.yields': 'een gebruikersnaam en een app-wachtwoord.',
};

export type Locale = 'en' | 'nl';
export type StringKey = keyof typeof en;

export const STRINGS: Record<Locale, Record<StringKey, string>> = { en, nl };

export const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

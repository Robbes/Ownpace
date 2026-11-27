// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The operator's words, in English only (ADR-0013, amended 2026-10-11).
 *
 * ADR-0013 makes the screens a CUSTOMER reads bilingual. These are the screens
 * only a platform operator reads, on managed: the support screens, the access
 * queue and the redirect URIs, and their three entries in the menu. The owner,
 * who is that operator, on 2026-10-11: *"for me as operator English would
 * suffice; multi language is only important for end users."* So they have no
 * Dutch to write, review or keep in step, and `nl` in `strings.ts` holds none
 * of them.
 *
 * A screen made of these renders inside `EnglishOnly` (`index.tsx`), so the
 * shared words on it (a button, a date, the log's table) are English too, and
 * its `lang` says so to a screen reader in a Dutch app. Its own words come
 * from `useOperatorT()`, which reads this table first and the dictionary's
 * English after it. A key is in one of the two, never both
 * (`operator-strings.unit.test.ts`).
 *
 * What a customer reads stays in `strings.ts` in both languages, even when an
 * operator writes it: the hold's sentence is typed by the operator in each
 * language and shown to the organisation in its own.
 */

export const OPERATOR_STRINGS = {
  // ---- The menu's three entries an operator sees, and nobody else.
  'nav.accessRequests': 'Access requests',
  'nav.support': 'Support',
  'nav.redirectUris': 'Redirect URIs',
  // ---- Every address this deployment needs registered elsewhere
  // (2026-09-01). The owner registered the right Google callback, got
  // `redirect_uri_mismatch` because API_URL disagreed with it, and asked for
  // the surface: four consoles, near-identical strings, and each wrong one
  // fails with the same unhelpful sentence from a different vendor.
  'redirects.title': 'Redirect URIs',
  'redirects.intro':
    'The addresses other services send a browser back to; register each exactly as shown.',
  'redirects.intro.more':
    'They are built from this deployment’s settings, so what is here is what will actually be requested; each one has to be registered in that service’s own console.',
  'redirects.loading': 'Reading this deployment’s settings…',
  'redirects.failed': 'Could not read them; the API builds the list, so check that it is up.',
  'redirects.group.migration': 'Migration sources — in the provider’s own OAuth client',
  'redirects.group.signIn': 'Signing in — in your identity provider',
  'redirects.group.socialSignIn': 'Social sign-in — in each upstream provider',
  'redirects.none': 'No redirect URI to register.',
  'redirects.unconfigured':
    'This deployment has not been told its own address, so nothing shows yet.',
  // The social sign-in card's address is the identity provider's, not ours,
  // so what is missing there is the provider's setting.
  'redirects.unconfigured.upstream':
    'The identity provider’s upstream callback address (IDP_UPSTREAM_CALLBACK_URL) is not set, so nothing shows yet.',
  'redirects.unconfigured.why':
    'Set it first: registering a guess produces a mismatch later, at the provider’s screen.',
  // ---- The access queue, which an operator reads (workplan 0093 T7). The
  // `access.*` keys in `strings.ts` are the public page somebody asks on (T3),
  // in both languages; these are the screen where somebody answers.
  'accessQueue.title': 'Access requests',
  'accessQueue.subtitle': 'People who asked to be let in.',
  'accessQueue.empty': 'Nobody is waiting.',
  'accessQueue.emptyDecided': 'Nothing has been decided yet.',
  'accessQueue.tab.open': 'Waiting',
  'accessQueue.tab.granted': 'Granted',
  'accessQueue.tab.declined': 'Declined',
  'accessQueue.asked': 'Asked',
  'accessQueue.orgLabel': 'Organisation name',
  'accessQueue.orgHelp': 'What this organisation will be called.',
  'accessQueue.noteLabel': 'Note (for you, not for them)',
  'accessQueue.grant': 'Grant access',
  'accessQueue.decline': 'Decline',
  'accessQueue.granting': 'Creating the organisation…',
  'accessQueue.granted': 'Granted. They become the owner the first time they sign in.',
  'accessQueue.declined': 'Declined. The request stays on the record.',
  'accessQueue.decidedBy': 'Decided by',
  'accessQueue.confirmDecline': 'Decline this request and email them?',
  'accessQueue.confirmDeclineQuiet':
    'Decline this request without emailing them?',
  // The default is ON: staying silent should be something somebody chose, not
  // something they forgot. The help text says what the email does NOT contain,
  // because the field right above it is labelled "not for them" and an operator
  // deserves to know that promise survives the send.
  'accessQueue.tellThem': 'Email them if you decline',
  'accessQueue.tellThemHelp':
    'A short refusal in their language, without reason or your note; untick for junk.',
  'accessQueue.tellThemHelp.why':
    'This form is public, so anyone can register made-up addresses. Granting always emails them, and only someone who signs in with that verified address gets in.',
  // THE OVERRIDE (owner decision 2026-08-31). Granting a person who already
  // owns an organisation creates a SECOND one with them as owner of both, and
  // `/api/me` then has two tenants for somebody who asked once and pressed
  // twice. The server refuses and names what they already own; this is the
  // operator saying they meant it. Not a checkbox beside the button — a
  // deliberate second press, after seeing the list.
  'accessQueue.alreadyOwnsHeading': 'This address already owns an organisation',
  'accessQueue.alreadyOwnsHelp':
    'Granting again creates another organisation with them as owner of both; usually a double press.',
  'accessQueue.alreadyOwnsHelp.why':
    'The app then has to ask them which they meant every time they sign in. If it is genuinely a second organisation, say so below.',
  'accessQueue.grantAnyway': 'Create a second organisation',
  'accessQueue.grantAnywayCancel': 'Leave it as it is',
  'accessQueue.mailSent': 'We emailed {email}.',
  'accessQueue.mailOff': 'Nobody was emailed — this deployment sends no mail. Tell {email} yourself.',
  'accessQueue.mailFailed':
    'The email to {email} could not be sent; tell them yourself, check the mail settings.',
  'accessQueue.mailSkipped': 'Nobody was emailed, as you asked.',
  // ---------------------------------------------------------------------
  // The operator's support surface (workplan 0110 T4)
  //
  // Addressed to the OPERATOR, not to a customer. `support.recorded` is the
  // one that matters: the owner chose standing, disclosed support access over
  // a consent switch, so the log is what a customer can point at — and a
  // record nobody is told about is surveillance with paperwork. The
  // customer-facing half of this disclosure is 0110 T6.
  // ---------------------------------------------------------------------
  'support.heading': 'Support',
  // The Alpha's overview on the first screen (workplan 0177 D17, §20.4): the
  // three counts Gifts shows, from the same answer, and no names. `{gifts}` is
  // a link to Gifts, by its menu name.
  'support.alpha.title': 'The Alpha',
  'support.alpha.line': 'Nothing refuses your own yes: you keep count. The numbers are set on {gifts}.',
  'support.recorded':
    'Every screen you open here is logged against your name, and customers can view that.',
  'support.recorded.why':
    'The support read log records the organisation and time with each screen, and customers can view that record.',
  'support.metadataOnly':
    'Names, states, counts and timings only; no message, event, contact or file is shown here.',
  'support.metadataOnly.why':
    'None can be: the database serves this surface a fixed list of columns.',
  'support.noOrganisations': 'No organisations to show.',
  // Under a list served a page at a time (workplan 0006 §P).
  'support.more': 'Show more',
  'support.notFound': 'Nothing here to show.',
  'support.back': 'All organisations',
  'support.backToOrganisation': 'Back to the organisation',
  'support.joinedOn': 'Joined',
  // Who may act on the organisation, and the way through to their account at
  // the identity provider (migration 0018). "People" rather than "Members":
  // the row can be somebody who was removed, and the screen says so.
  // Finding a person across every organisation (owner request 2026-08-31). The
  // question an operator starts from is "somebody contacted me, who are they" —
  // the organisation list answers a question nobody's support day begins with.
  'support.findPerson': 'Find a person',
  'support.find': 'Find',
  'support.findPersonHint': 'Part of an email address',
  'support.findPersonRecorded':
    'A search reads every organisation; the query and hit count are logged to your name.',
  'support.noPeopleFound': 'Nobody matches that.',
  'support.findPersonCapped':
    'Showing the first matches only — narrow the search rather than scrolling.',
  'support.people': 'People',
  'support.noPeople': 'Nobody belongs to this organisation.',
  'support.col.email': 'Email',
  // The title on the link out. It names what happens — a different application
  // opens — because an operator clicking an address expects to mail it.
  // WHY there is no link, for the half of the cases that has a reason. The
  // other half — no console configured — is a deployment setting and says
  // nothing here, because there is nothing about the PERSON to say.
  'support.notArrivedYet':
    'Has not signed in yet; this becomes a link once the invitation is taken up.',
  // And the other reason a person has no account to open: there is no person.
  // Demo fixtures are written straight into the database, so the provider has
  // never heard of them and never will — which is a different sentence from
  // "not yet", and reading the wrong one sends somebody looking for an account
  // that was never going to exist.
  'support.seededDemoAccount':
    'A demo fixture from the seed; no identity-provider account exists to open, nor will one.',
  'support.openAtProvider': 'Open this account at the identity provider',
  'support.connections': 'Connections',
  'support.migrations': 'Migrations',
  'support.invoices': 'Invoices',
  'support.domains': 'Per domain',
  'support.noConnections': 'No connections.',
  'support.noMigrations': 'No migrations.',
  'support.noInvoices': 'No invoices.',
  // The platform status the customer sees (workplan 0110 T5): readiness and
  // the status page's endpoints. The group names are the page's own.
  // The drain (managed migration 0023): the one thing on these screens that
  // writes, and the only pause a customer can neither derive nor wait out.
  'support.hold': 'Hold new passes',
  // Since 0132 T6 (b) the message is also every refused button's answer, and
  // a refused press is not remembered, so the fold says what it should say.
  'support.hold.hint': 'Stops new passes, buttons included; the ones already running finish.',
  'support.hold.hint.why':
    'This is the drain: the sync tick stops enqueueing within a minute, and whatever is mid-pass finishes normally. Every signed-in customer sees a notice with your message on it, or a default sentence when left empty. Your message is also shown to every button-press that would start work while the hold is on (\'Sync now\', \'Start migration\', a check), and a refused press is not remembered. So say when copying resumes and ask them to try again after that, for example: \'We are updating the platform and copying resumes around 15:00. Nothing starts until then. Please try again after that.\' Lifting the hold starts the scheduled passes again on the next tick.',
  'support.hold.on': 'Held since {since}. No new passes are starting.',
  'support.hold.off': 'Not held. New passes start on the usual schedule.',
  'support.hold.start': 'Hold new passes',
  'support.hold.end': 'Lift the hold',
  'support.hold.message': 'What customers will read',
  'support.hold.message.placeholder': 'Back in about an hour.',
  'support.platform': 'Platform, as the customer sees it',
  'support.platform.database': 'Database',
  'support.platform.signIn': 'Sign-in',
  'support.platform.state.up': 'up',
  'support.platform.state.down': 'down',
  'support.platform.state.off': 'off',
  'support.platform.state.unchecked': 'not checked yet',
  'support.platform.page.off': 'This deployment has no status page.',
  'support.platform.page.unreachable': 'The status page did not answer.',
  'support.platform.unread': 'The platform status could not be read.',
  'support.platform.checked': 'Checked {when}.',
  'support.noDomains': 'Nothing has run yet.',
  // Their address changes, counted and never named (workplan 0168 D7).
  'support.addressChanges': 'Address changes',
  'support.addressChanges.none': 'No address changes.',
  'support.addressChanges.counts':
    '{rows} address change(s), {confirmed} of them confirmed. Their own screen says which addresses; here you see only the counts.',
  'support.waiting.none': 'Nothing is waiting on them.',
  'support.waiting.some':
    'Waiting on them: {count} decision(s). Their own screen says which; here you see only the count.',
  'support.noFourthLevel': 'There is no screen with more detail.',
  'support.col.organisation': 'Organisation',
  'support.col.status': 'Status',
  'support.col.joined': 'Joined',
  'support.col.migrations': 'Migrations',
  'support.col.failing': 'Failing',
  'support.col.waiting': 'Waiting on them',
  'support.col.name': 'Name',
  'support.col.role': 'Role',
  'support.col.kind': 'Kind',
  'support.col.lifecycle': 'Lifecycle',
  'support.col.mode': 'Mode',
  'support.col.updated': 'Updated',
  'support.col.period': 'Period',
  'support.col.total': 'Total',
  // The number the customer quotes from their own Billing page or PDF.
  'support.col.number': 'Number',
  'support.invoice.creditNote': 'Credit note {number}',
  'support.col.domain': 'Domain',
  'support.col.state': 'State',
  'support.col.whatToDo': 'What to do',
  // The tier evidence (0109 T4 surfaced). "Package" and not "tier": the same
  // customer-facing word `access.tier` uses — the operator reads what the
  // customer would recognise.
  'support.usage': 'Usage and package this month',
  'support.usage.beyondTable': 'Beyond the tiers — a talk-to-us size.',
  'support.usage.perMonth': 'per month',
  'support.usage.free': 'free',
  'support.usage.decidedBy.paths':
    'Decided by the paths axis — how many run at the same time.',
  'support.usage.decidedBy.data':
    'Decided by the data axis — what has moved sets the floor.',
  'support.usage.decidedBy.both': 'Both axes land on the same package.',
  'support.usage.peak': 'Recorded peak this month',
  'support.usage.noPeak': 'nothing recorded yet',
  'support.usage.now': 'Holding a slot right now',
  // As the tier counts it: the alpha's data does not (managed 0040).
  'support.usage.data': 'Data moved (first copies, without the Alpha)',
  'support.usage.note': 'The higher axis decides; a future invoice uses this same derivation.',
  'support.usage.why':
    'Paths running at the same time, or data moved since the start: first copies only, and a paused path keeps its slot.',
  // What an erasure kept, and could not be read until there was a screen.
  'support.retained.link': 'Invoices kept after an erasure',
  'support.retained.heading': 'Invoices kept after an erasure',
  'support.retained.why':
    'When an organisation is erased, our copy of each invoice the books hold is deleted ' +
    'and its number kept: the books keep the invoice as long as tax law asks, so look it ' +
    'up there by its number. An issued invoice the books do not hold is the only record ' +
    'of itself, so it is kept here, detached from the organisation. The reference is a ' +
    'one-way hash of the erased id, shown so that what comes from the same erasure can ' +
    'be seen to belong together; it does not lead back to anyone.',
  'support.retained.numbers.heading': 'Invoice numbers, held in the books',
  'support.retained.numbers.none': 'No invoice numbers have been kept: no erasure has deleted an invoice yet.',
  'support.retained.col.numbers': 'Invoice numbers',
  'support.retained.kept.heading': 'Invoices the books do not hold',
  'support.retained.none': 'No invoices are kept here.',
  'support.retained.noName': 'not recorded',
  'support.retained.notPurged': 'not yet erased',
  'support.retained.col.billedTo': 'Billed to',
  'support.retained.col.erased': 'Erased',
  'support.retained.col.erasure': 'Erasure',
  // The log page (workplan 0129 T2): the audit log and the application's
  // errors and warnings, one timeline. Metadata only, as the view serves it.
  'support.log.link': 'The log: audit events, errors and warnings',
  'support.log.heading': 'Log',
  'support.log.lead': 'The audit log and the application’s errors and warnings, newest first. Metadata only.',
  'support.log.lead.why':
    'What an audit event changed is not shown here: it stays in the database, for an investigation to query. The text of an error stays in the server’s output, on the line with the same reference. Every page of this log you open is recorded, with its filters.',
  'support.log.level': 'Level',
  'support.log.level.any': 'Any',
  'support.log.level.error': 'Error',
  'support.log.level.warn': 'Warning',
  'support.log.level.info': 'Audit',
  'support.log.event': 'Event starts with',
  'support.log.category': 'Error category',
  'support.log.category.any': 'Any',
  'support.log.reference': 'Reference',
  'support.log.from': 'From (UTC)',
  'support.log.to': 'To (UTC)',
  'support.log.search': 'Search',
  'support.log.organisation': 'Organisation: {name}',
  'support.log.migration': 'Migration: {name}',
  'support.log.remove': 'Remove this filter',
  'support.log.none': 'Nothing in the log matches.',
  'support.log.older': 'Older',
  'support.log.newest': 'Back to the newest',
  'support.log.byTheService': 'the service',
  'support.log.col.time': 'Time',
  'support.log.col.level': 'Level',
  'support.log.col.organisation': 'Organisation',
  'support.log.col.migration': 'Migration',
  'support.log.col.event': 'Event',
  'support.log.col.category': 'Category',
  'support.log.col.reference': 'Reference',
  'support.log.col.actor': 'Who',
  'support.log.forOrganisation': 'This organisation’s log',
  'support.log.forMigration': 'This migration’s log',
  // The audit export's download (0129 T4, managed; the owner, 2026-09-24: "an
  // operator-only route using your own session").
  'support.export.heading': 'Audit export',
  'support.export.lead': 'Every audit event as a JSON line, oldest first, for your log store.',
  'support.export.lead.why':
    'The same lines the API prints as each event is recorded, read back from the audit log: an address or a file name is its pseudonym. Leave the field empty to start at the first event, or give the cursor from the last download to carry on from there. Events from the last five minutes come with the next download. Every page fetched is recorded as one read of every customer.',
  'support.export.after': 'Start after (optional)',
  'support.export.download': 'Download',
  'support.export.busy': 'Downloading… lines so far: {count}',
  'support.export.done': 'Lines downloaded: {count}. The field now holds where the next download starts.',
  'support.export.nothing': 'Nothing new after that point. An event comes once it is five minutes old.',
  'support.export.stopped': 'The download stopped: {message}',
  'support.export.kept': 'Lines saved: {count}. The field holds where to carry on.',

  // ---- Money to give back (workplan 0111; the owner, 2026-10-11): what the
  // hourly invoice push asks the operator to pay back by hand, or watch.
  'support.money.link': 'Money to give back',
  'support.money.heading': 'Money to give back',
  'support.money.lead':
    'Credit notes whose money you pay back by bank transfer, and refunds to watch.',
  'support.money.lead.why':
    'The hourly invoice push puts each here and mails it to NOTIFY_TO once. Terms §7 promises the money back within 14 days of the withdrawal.',
  'support.money.open.heading': 'To give back or watch',
  'support.money.open.none': 'Nothing to give back.',
  'support.money.done.heading': 'Given back',
  'support.money.done.none': 'Nothing marked given back yet.',
  'support.money.col.organisation': 'Organisation',
  'support.money.col.creditNote': 'Credit note',
  'support.money.onInvoice': 'on invoice {number}',
  'support.money.col.amount': 'Amount',
  'support.money.col.what': 'What happened',
  'support.money.col.since': 'Since',
  'support.money.col.action': 'Done?',
  'support.money.col.givenBack': 'Given back',
  'support.money.reason.by_hand':
    'Paid, but not through Mollie: pay back by bank transfer, and book it on the credit note in Moneybird.',
  'support.money.reason.refund_failed': 'Mollie’s refund {refund} failed: pay back by bank transfer.',
  'support.money.reason.refund_canceled': 'Mollie’s refund {refund} was canceled: pay back by bank transfer.',
  'support.money.reason.inTheBooks': 'It was booked in Moneybird: take its payment off the credit note.',
  'support.money.reason.refund_late':
    'Mollie’s refund {refund} is still {status} a week on. A queued refund waits for Mollie’s balance.',
  'support.money.watching': 'Leaves the list when Mollie ends it',
  'support.money.mark': 'Given back',
  'support.money.mark.confirm': 'Paid back by transfer, and booked in Moneybird?',
  'support.money.mark.yes': 'Yes, mark it',
  'support.money.mark.failed': 'Could not mark it: {message}',
  'support.money.givenBackBy': 'by {who}',
  'support.money.someone': 'an operator no longer listed',
  // ---- Who uses an organisation, and closing one (workplan 0139 T7 (b);
  // managed migration 0060). The close is `closeAccount`, the function the
  // owner's Close and `operator.sh close` call, so its answer's sentences are
  // the customer's own, in both languages, and are not repeated here.
  'support.col.people': 'People',
  'support.col.connections': 'Connections',
  'support.col.lastPass': 'Last pass',
  'support.never': 'never',
  'support.unused.nobody': 'nobody signed in',
  'support.unused.nothing': 'nothing connected',
  'support.status.erasedAfter': 'erased after {day}',
  'support.filter.label': 'Show',
  'support.filter.all': 'All ({count})',
  'support.filter.unused': 'Not in use ({count})',
  'support.filter.closed': 'Closed ({count})',
  'support.filter.unused.why':
    'Not in use: open, and nobody has signed in, or nothing is connected and there is no migration. Close one from its page.',
  'support.filter.none': 'None to show.',
  'support.close.title': 'Close this organisation',
  'support.close.intro':
    'For a tester who asked to end their account and cannot press Close themselves, or an organisation nobody uses. It is the close operator.sh close makes, recorded in the audit log under your name with the request you name.',
  'support.close.effect':
    'From the moment it is closed, no new pass starts and nothing is billed; a pass under way finishes the item it is on. The erasure runs when the window is up.',
  'support.close.window': 'Window before the erasure',
  'support.close.window.0': 'None: erase at the next purge, within the hour. This cannot be undone.',
  'support.close.window.n': '{days} days: it can be reopened here until then.',
  'support.close.reference': 'Because of',
  'support.close.reference.hint':
    'The request you act on: a ticket, or the date of their mail. Kept on the audit row, beside your name.',
  'support.close.arm': 'Close…',
  'support.close.confirm': 'Close {name} with a window of {days} days?',
  'support.close.confirm.0': 'Close {name} and erase it at the next purge? This cannot be undone.',
  'support.close.typeName': 'Type the organisation’s name to confirm',
  'support.close.yes': 'Yes, close it',
  'support.close.failed': 'Could not close it: {message}',
  'support.close.done': 'Closed.',
  'support.close.done.purge': 'The live service stops holding its data on {when}.',
  'support.close.done.backups':
    'The erasure completes on {when}, when the last backup that could hold it ages out.',
  'support.close.done.reopen': 'It can be reopened here until {when}.',
  'support.close.done.final': 'A window of 0 cannot be undone.',
  'support.close.done.passes': 'Passes in flight the orchestrator was asked to stop: {count}.',
  'support.close.tell': 'What to tell them',
  'support.close.tell.en': 'In English',
  'support.close.tell.nl': 'In Dutch',
  'support.close.idp':
    'Its people’s sign-in accounts at the identity provider are not part of the erasure: idp-strays.sh finds them once nothing holds them (operator runbook, Sign-in accounts nobody let in).',
  'support.closed.on': 'Closed on {closed}. The purge erases it after {purge}.',
  'support.closed.reopenable': 'Until then it can be reopened, and its migrations start again.',
  'support.closed.final': 'Its window has run out: the next purge erases it, and it can no longer be reopened.',
  'support.closed.erasing': 'Its erasure is under way.',
  'support.reopen.reference.hint':
    'Why: the request, or the mistake, it answers. Kept on the audit row, beside your name.',
  'support.reopen.arm': 'Reopen…',
  'support.reopen.confirm': 'Reopen {name}? Its migrations start again at the next tick.',
  'support.reopen.yes': 'Yes, reopen it',
  'support.reopen.failed': 'Could not reopen it: {message}',
  // ---- A test organisation (workplan 0162 T1; ADR-0053): marked here, by an
  // appointed operator, only while it holds no migration. Every migration
  // made in it afterwards copies only the items whose own title carries the
  // marker, and is never finished or switched over. A refusal is the API's
  // own sentence, shown as it says it.
  'support.test.title': 'Test organisation',
  'support.test.intro':
    'A test organisation copies only the items whose own title contains its marker, ignoring case, and its migrations are never finished or switched over: they end by being deleted. Nobody in the organisation sees this setting.',
  'support.test.when':
    'Marked, or unmarked, only while it holds no migration. Each migration made here afterwards keeps the marker it was made with.',
  'support.test.is': 'This is a test organisation. Its marker:',
  'support.test.isNot': 'This is not a test organisation.',
  'support.test.marker': 'Marker',
  'support.test.marker.hint':
    '3 to 64 characters once trimmed, in an item’s own title: a mail’s subject, an event’s or a task’s title, a contact’s name, a file’s name. [Ownpace-test] is offered; type another if you like. The API says whether it can be used.',
  'support.test.arm': 'Mark as a test…',
  'support.test.change': 'Change the marker…',
  'support.test.confirm': 'Mark {name} as a test organisation, with the marker {marker}?',
  'support.test.yes': 'Yes, mark it',
  'support.test.failed': 'Could not mark it: {message}',
  'support.test.done': 'Marked. Each migration made here from now on copies only what carries {marker}.',
  'support.test.unchanged': 'It is a test organisation with the marker {marker} already. Nothing changed, and nothing was recorded.',
  'support.test.notOpen':
    'It is not open, so it is neither marked as a test nor unmarked: an organisation is, only while it is open.',
  'support.test.unarm': 'Stop being a test…',
  'support.test.unconfirm': 'Make {name} an ordinary organisation again? Migrations made here afterwards copy everything they are given.',
  'support.test.unyes': 'Yes, unmark it',
  'support.test.unfailed': 'Could not unmark it: {message}',
  'support.test.undone': 'Unmarked. It is an ordinary organisation again.',
  'support.test.badge': 'Test',
  'support.test.migration':
    'A test migration: it copies only the items whose own title contains its marker, and is never finished. Its marker:',
  // ---- Recommendations (workplans 0172 and 0177): the mark on the access
  // queue, the owner's line above it, and the operator's own screen, which
  // keeps the name *Gifts*: a paid code joins it after the Alpha (0177 §13).
  // The giver's screen, the card and the door are in `strings/gifts.ts`, in
  // both languages. Drafts for the owner's read (0177 §20.6).
  'nav.gifts': 'Gifts',
  'accessQueue.giftFrom': 'Recommended by {giver}',
  'accessQueue.giftFromNobody': 'Recommended by a member who has since left',
  // A request a code let in at the door (0177 D6): nobody decided it.
  'accessQueue.letInByRecommendation': 'Let in with a recommendation, at the door. Nobody decided it.',
  'gifts.title': 'Gifts',
  'gifts.subtitle':
    'Recommendations made by people already in the Alpha. A code lets its person in at once, and you are mailed for each one.',
  'gifts.count.title': 'Who the Alpha has let in',
  // The two counts of 0177 §20.1, with their ceilings, and the cards not used yet.
  'gifts.count.byOwner': 'People you let in: {n} of {max}',
  'gifts.count.byRecommendation': 'People let in by a recommendation: {n} of {max}',
  'gifts.count.unused': 'Cards not used yet: {n}',
  // Said beside a count at its ceiling or past it, so that it stands out in words and not by colour alone.
  'gifts.count.atCeiling': 'The number is reached.',
  // Under the counts: what each ceiling does. Nothing refuses the owner's own
  // yes: the owner keeps count (D17, the owner, 2026-11-26).
  'gifts.count.rule':
    'At its number a recommendation lets nobody in, and no new card is made. Nothing refuses your own yes past yours.',
  'gifts.count.google':
    'These count people. Google’s list of test users counts addresses, and ends at 100: the Google address of each member and of each person they help, family or acquaintance, takes a place, and so do your own test addresses.',
  'gifts.ceiling.owner': 'The most people you let in',
  'gifts.ceiling.recommendation': 'The most people let in by a recommendation',
  'gifts.rule.title': 'Recommendations per person',
  'gifts.rule.help': 'How many people each person may recommend. 0 stops new cards; unused ones keep working.',
  // Beside the number per person, during the Alpha (D18, §20.7).
  'gifts.rule.alphaOnly':
    'During the Alpha only the people you let in have these. A person let in by a recommendation has none until the Alpha ends.',
  'gifts.rule.save': 'Save',
  'gifts.allowance.title': 'For one person',
  'gifts.allowance.help':
    'A number for one person, by the address they sign in with, over the number for everyone. Leave the number empty to take theirs away.',
  'gifts.allowance.email': 'Address',
  'gifts.allowance.gifts': 'Recommendations',
  'gifts.allowance.note': 'Why (for you)',
  'gifts.allowance.save': 'Set',
  'gifts.allowance.none': 'Nobody has a number of their own.',
  'gifts.list.title': 'Every card',
  'gifts.list.empty': 'No card has been made yet.',
  'gifts.list.from': 'From {giver}',
  'gifts.list.fromNobody': 'From a member who has since left',
  'gifts.list.made': 'Made {date}, valid until {until}',
  'gifts.list.request': 'Became the request from {email}: {state}',
  'gifts.list.requestGone': 'Its request is no longer kept',
  'gifts.list.revoke': 'Revoke',
  'gifts.state.unused': 'Unused',
  'gifts.state.redeemed': 'Used',
  'gifts.state.revoked': 'Revoked',
  'gifts.state.expired': 'Expired',
  'gifts.saved': 'Saved.',
} as const;

export type OperatorKey = keyof typeof OPERATOR_STRINGS;

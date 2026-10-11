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
  'support.recorded':
    'Every screen you open here is logged against your name, and customers can view that.',
  'support.recorded.why':
    'The support read log records the organisation and time with each screen, and customers can view that record.',
  'support.metadataOnly':
    'Names, states, counts and timings only; no message, event, contact or file is shown here.',
  'support.metadataOnly.why':
    'None can be: the database serves this surface a fixed list of columns.',
  'support.noOrganisations': 'No organisations to show.',
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
    'This is the drain: the sync tick stops enqueueing within a minute, and whatever is mid-pass finishes normally. Every signed-in customer sees a notice with your message on it, or a default sentence when left empty. Your message is also shown to every button-press that would start work while the hold is on (\'Trigger sync\', \'Start migration\', a check), and a refused press is not remembered. So say when copying resumes and ask them to try again after that, for example: \'We are updating the platform and copying resumes around 15:00. Nothing starts until then. Please try again after that.\' Lifting the hold starts the scheduled passes again on the next tick.',
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
  'support.waiting.none': 'Nothing is waiting on them.',
  'support.waiting.some':
    'Decisions are waiting on this customer; their own screen says which, here you see only counts.',
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
  'support.money.col.invoice': 'Invoice',
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
  'support.money.givenBackBy': '{when}, by {who}',
  'support.money.someone': 'an operator no longer listed',
} as const;

export type OperatorKey = keyof typeof OPERATOR_STRINGS;

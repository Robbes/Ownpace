// Copyright 2026 The Ownpace authors (Apache-2.0)
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
  // The word on a fold (workplan 0118): one line stays on screen, the rest opens under it.
  'fold.why': 'Why?',
  'fold.how': 'How?',
  'fold.more': 'More',
  'status.link': 'Service status',
  'notFound.heading': 'Nothing here.',
  'notFound.lede':
    'No screen has that address; renamed or never there, your migrations are untouched.',
  'notFound.back': 'Back to the start',
  'nav.mappings': 'Migrations',
  'nav.back': 'Back',
  'nav.menu': 'Menu',
  'nav.review': 'Review',
  'nav.deletions': 'Deletions',
  'nav.moves': 'Moves',
  'nav.failures': 'Failures',
  'nav.check': 'Check',
  'nav.finish': 'Finish',
  'nav.log': 'Log',
  'nav.tenants': 'Team',
  'nav.billing': 'Billing',
  'nav.signOut': 'Sign out',
  // "Report a problem" (workplan 0130): what the person writes, and what goes
  // with it, said before anything is sent.
  'nav.reportProblem': 'Report a problem',
  'report.title': 'Report a problem',
  'report.lead': 'Tell us what happened. We read every report and reply by email.',
  'report.description': 'What happened?',
  'report.descriptionHint': 'What you were doing, what you expected, and what you saw instead.',
  'report.screenshot': 'Screenshot (optional)',
  'report.screenshotHint':
    'PNG or JPEG, up to 5 MB: choose one, drop it here, or paste it anywhere on this page. ' +
    'It shows your screen: check it first.',
  'report.screenshotTooBig': 'That picture is larger than 5 MB.',
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
    'Android: press power and volume down at the same time, on most phones. Then choose the picture from your photos.',
  'report.screenshotHelp.chromebook': 'Chromebook: press Ctrl+Show windows, then paste it here with Ctrl+V.',
  'report.screenshotHelp.check':
    'Before you send it, look at it: the picture shows everything that was on your screen, so check that ' +
    'nothing on it is something you would rather not send.',
  // What is attached, however it came: chosen, pasted or dropped.
  'report.screenshotAttached': 'Attached: {name} ({size}).',
  'report.screenshotRemove': 'Remove the screenshot',
  // Only where the browser can read a picture from the clipboard.
  'report.screenshotPaste': 'Paste screenshot',
  'report.screenshotPasteEmpty':
    'There is no picture on the clipboard. Make a screenshot first, then press Paste screenshot again.',
  'report.screenshotPasteFailed':
    'This browser could not read the clipboard. Paste with Ctrl+V instead, or with Command+V on a Mac.',
  'report.tooLarge': 'The screenshot is too large to send: choose a smaller one and send the report again.',
  'report.timedOut':
    'No answer came within {minutes} minutes, so this page cannot tell whether your report arrived. ' +
    'What you wrote is still here. If you send it again, a smaller screenshot goes faster.',
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
    'What you write, and your screenshot if you add one. With them go these lines, exactly as our support team reads them, in English:',
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
  'report.browser.appBuild': "this page's version, {build}, if the service runs another",
  'report.browser.dataType': 'the data type of the failure you came from: {dataType}',
  'report.browser.side.source': 'that it happened on the source side',
  'report.browser.side.target': 'that it happened on the destination side',
  'report.browser.migration': 'the migration it belongs to: {migration}',
  'report.browser.recentError': 'the reference of an error from the last {minutes} minutes: {reference} ({code})',
  'report.send': 'Send the report',
  'report.sending': 'Sending…',
  'report.sent': 'Sent. Your report is number {ticket}, and we will reply to {email}.',
  // Where the service has no helpdesk, a report goes to the support mailbox by
  // mail (the owner, for the alpha, 2026-09-28): no ticket, so no number, and
  // the report's own reference instead, which the mail carries too as `Report
  // reference:`. Named apart from the error's reference the form listed above
  // (`report.reference`), which the Log page finds and this one it does not.
  'report.sent.mail': 'Sent to our support team, with report reference {reference}. We will reply by email to {email}.',
  'report.unavailable': 'Reporting a problem is not set up on this service.',
  'language.label': 'Language',
  'common.requestFailed': 'The request did not complete.',
  'asof.updated': 'Updated',
  'asof.refresh': 'Refresh',
  'confirm.progress.lastSynced': 'last synced',
  'verify.checkedAt': 'Checked',
  'queue.itemId': 'ID',
  'queue.loadFailed': 'Could not load this queue.',
  'queue.noMappings': 'No migrations configured.',
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
  // ADR-0035 decision 5, the owner's option C (2026-10-03): for an account the
  // person connected through their own grant, the provider's words and the
  // items' names stay off the owner's pages.
  'failure.withheld':
    "The provider's own message is not shown: the person connected this account themselves, and it can name their files. Support can read it by the reference.",
  'failures.withheld':
    "Item names and the provider's messages are not shown: the person connected this account themselves, and they can name their files. Each failure still says what kind it is and what to do.",
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
    "with this migration's export format. Choose one that covers them, or accept leaving them.",
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
  'applyFlag.config.post': '; edit the file and restart to change it. No API changes it.',
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
  'scope.migrates': 'Migrates',
  'scope.partial': 'Partial',
  'scope.doesNotMigrate': 'Does not migrate',
  'scope.title': 'What migrates, and what does not',
  'login.title': 'Sign in to Ownpace',
  'login.tagline': 'Sovereign data migration for families and SMBs',
  'login.tokenLabel': 'Access token',
  'login.invalidToken':
    'That does not look like a valid access token (need sub, email, tenantId, role).',
  'login.expiredToken':
    'This token has expired; mint a fresh one from the seed script or identity provider.',
  // Not 'Sign in': when an issuer is configured this button sits on the same
  // screen as the one that starts the real flow, and two buttons reading
  // "Sign in" that do different things is a coin toss, not a choice.
  'login.submit': 'Use this token',
  'login.help.pre': 'Paste the access token from the seed script',
  // WAS 'or your identity provider.' — which stopped being true when the box
  // started appearing only where the API accepts a seed token (0102 T1). In
  // that state a provider token is not what this API verifies against either,
  // so the old sentence offered a second way in that does not exist.
  'login.help.post': '\u2014 this deployment has no identity provider configured.',
  // ---- Signing in with the configured issuer (ADR-0042) ----
  'login.withProvider': 'Sign in',
  'login.redirecting': 'Taking you to sign in…',
  'login.verifying': 'Checking that token…',
  'login.pasteToggle': 'Sign in with a token instead',
  // Not "you should not need this", which was true and too gentle. Once an
  // issuer is configured the API is in managed mode and verifies against the
  // provider's keys ONLY — never falling back to the secret the seed signs
  // with. A seed token here is not discouraged, it is refused.
  // The disclosure now appears ONLY where the API will accept a seed token
  // (0102 T1), which makes the old sentence — "a seed token will be refused
  // here" — the exact opposite of the case it labels. The odd state it labels
  // now: this build carries a provider's address while the API is not using
  // one.
  'login.pasteFallback':
    'This deployment’s API uses no identity provider; it accepts a token from the seed script.',
  'login.oidcFailed': 'We could not reach the sign-in service.',
  // Under the sign-in button (workplan 0144 T7): the way to the request page
  // for somebody who has no account yet. The mirror of `access.backToSignIn`.
  'login.requestAccess': 'No account yet? Request access.',
  // ---- Asking the API what it accepts, before offering it (workplan 0102 T1) ----
  'login.checking': 'Checking how this deployment signs people in…',
  // Not a fallback to the paste box: on a managed stack that box is refused
  // anyway, so offering it after a failed check would be inventing a way in
  // that does not exist.
  'login.modeUnavailable':
    'We could not ask this deployment which sign-in it accepts; nothing to offer yet.',
  // The state #562 left behind: the stack has an issuer and this build was
  // never told its address. Named exactly, because only an operator can fix it
  // and they need the two words to search for.
  'login.providerNotBuilt':
    'Identity provider sign-in, but this web build lacks its address: rebuild with VITE_OIDC_ISSUER and VITE_OIDC_CLIENT_ID.',
  'login.callback.working': 'Signing you in…',
  'login.callback.failed': 'That sign-in did not complete.',
  'login.callback.again': 'Try again',
  // ---- The dead end at the end of a sign-in that WORKED (2026-09-01). ----
  //
  // The token verified, the issuer is fine, and there is no membership. That
  // is not an error, and the old single sentence drew it as one — under the
  // heading "That sign-in did not complete", which was false.
  //
  // It also ASSERTED something nothing here had checked: *"If you asked for
  // access, we will email you when it is ready."* Nothing on this side can
  // know whether a request exists. `access_request` has no SELECT policy for
  // the person who made it (managed 0002/0005 — knocking is allowed, reading
  // the queue is not), and the public POST answers every caller identically on
  // purpose, because a different answer for an address that has already asked
  // is how somebody finds out which addresses have. So the app cannot tell,
  // and must not imply, that anything is in motion.
  //
  // Say what is true; NAME THE ADDRESS THAT ARRIVED, because a social button
  // can sign somebody in as an identity they did not mean to use; and offer
  // the one action that changes anything.
  'login.noOrganisation': 'Your account is not part of an organisation yet.',
  'login.noOrganisation.signedInAs': 'You signed in as {email}.',
  'login.noOrganisation.ask': 'Ask for access',
  'login.noOrganisation.already':
    'Already asked? Then it is waiting for an answer and you will hear by email.',
  'login.noOrganisation.already.why':
    'Asking again does no harm: a second request while the first is open is not recorded twice.',
  // ---- The access QUEUE, which an operator reads (workplan 0093 T7). The
  // `access.*` keys further down are the PUBLIC page somebody asks on (T3);
  // these are the screen where somebody answers, hence a separate prefix.
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
  // ---- Answering an invitation (workplan 0099). ----
  'invite.title': 'You have been invited',
  'invite.subtitle': 'Joining is your choice. Nothing happens until you make it.',
  'invite.none': 'Nothing is waiting for you.',
  'invite.asRole': 'as {role}',
  'invite.accept': 'Join',
  'invite.joining': 'Joining…',
  'invite.decline': 'Decline',
  'invite.skip': 'Not now',
  'invite.skipHelp': 'Not now changes nothing; we ask again next time you sign in.',
  'invite.skipHelp.why': 'Declining is recorded, and only the organisation can invite you again.',
  'invite.confirmDecline':
    'Decline the invitation from {name}? Only they can invite you again.',
  // The texts, accepted before anything else (workplan 0139 T3): the Alpha
  // conditions, the privacy policy and the terms, with their versions.
  'acceptance.title': 'Before you start',
  // When a text got a new version since this person last accepted (0139 T3,
  // review of 2026-09-29): the heading says so, and the text is marked.
  'acceptance.changedTitle': 'The texts have changed',
  'acceptance.lead': 'Read these three texts. They say what we do with your accounts and your data.',
  'acceptance.list': 'The texts to accept',
  'acceptance.doc.alpha': 'Alpha conditions',
  'acceptance.doc.privacy': 'Privacy policy',
  'acceptance.doc.terms': 'Terms of service',
  'acceptance.version': 'version {version}',
  'acceptance.newVersion': 'new version',
  'acceptance.newTab': '(opens in a new tab)',
  'acceptance.changed': 'One or more texts have changed since you last accepted them.',
  'acceptance.record': 'We record which version of each text you accepted, in which language, and when.',
  'acceptance.accept': 'Accept all three',
  'acceptance.accepting': 'Recording…',
  'acceptance.notNow': 'Not now, sign out',
  'acceptance.notCurrent':
    'These texts changed while this page was open. Read the current versions, then accept those.',
  'acceptance.checking': 'Checking your account…',
  'acceptance.readFailed': 'Your account could not be read.',
  'acceptance.retry': 'Try again',
  // The failures this screen can meet, in the reader's language; the
  // reference a fault carries is kept ('failure.reference').
  'acceptance.fault.read': 'The fault is on our side, not yours.',
  'acceptance.fault.record': 'Your acceptance was not recorded: the fault is on our side, not yours. Try again.',
  'acceptance.unreachable': 'The service could not be reached. Check your connection and try again.',
  'acceptance.forbidden':
    'This account has no access to this organisation. Sign out, and sign in with the account you were invited with.',
  // A door that stores access, refused because the texts were not accepted
  // yet (409 conditions_not_accepted). Read after accepting as well as before.
  'acceptance.refused':
    'Nothing was stored: the Alpha conditions, the privacy policy and the terms had not been accepted yet. Once you have accepted them, try again.',
  'queue.title': 'Access requests',
  'queue.subtitle': 'People who asked to be let in. A person reads these.',
  'queue.empty': 'Nobody is waiting.',
  'queue.emptyDecided': 'Nothing has been decided yet.',
  'queue.tab.open': 'Waiting',
  'queue.tab.granted': 'Granted',
  'queue.tab.declined': 'Declined',
  'queue.asked': 'Asked',
  'queue.orgLabel': 'Organisation name',
  'queue.orgHelp': 'What this organisation will be called. Defaults to what they told us.',
  'queue.noteLabel': 'Note (for you, not for them)',
  'queue.grant': 'Grant access',
  'queue.decline': 'Decline',
  'queue.granting': 'Creating the organisation…',
  'queue.granted': 'Granted. They become the owner the first time they sign in.',
  'queue.declined': 'Declined. The request stays on the record.',
  'queue.decidedBy': 'Decided by',
  'queue.confirmDecline': 'Decline this request and email them? It stays on the record either way.',
  'queue.confirmDeclineQuiet':
    'Decline this request without emailing them? It stays on the record either way.',
  // The default is ON: staying silent should be something somebody chose, not
  // something they forgot. The help text says what the email does NOT contain,
  // because the field right above it is labelled "not for them" and an operator
  // deserves to know that promise survives the send.
  'queue.tellThem': 'Email them if you decline',
  'queue.tellThemHelp':
    'A short refusal in their language, without reason or your note; untick for junk.',
  'queue.tellThemHelp.why':
    'This form is public, so a made-up address belongs to a stranger. Granting always emails them; that is how they learn they can sign in.',
  // THE OVERRIDE (owner decision 2026-08-31). Granting a person who already
  // owns an organisation creates a SECOND one with them as owner of both, and
  // `/api/me` then has two tenants for somebody who asked once and pressed
  // twice. The server refuses and names what they already own; this is the
  // operator saying they meant it. Not a checkbox beside the button — a
  // deliberate second press, after seeing the list.
  'queue.alreadyOwnsHeading': 'This address already owns an organisation',
  'queue.alreadyOwnsHelp':
    'Granting again creates another organisation with them as owner of both; usually a double press.',
  'queue.alreadyOwnsHelp.why':
    'The app then has to ask them which they meant every time they sign in. If it is genuinely a second organisation, say so below.',
  'queue.grantAnyway': 'Create a second organisation',
  'queue.grantAnywayCancel': 'Leave it as it is',
  'queue.mailSent': 'We emailed {email}.',
  'queue.mailOff': 'Nobody was emailed — this deployment sends no mail. Tell {email} yourself.',
  'queue.mailFailed':
    'The email to {email} could not be sent; tell them yourself, check the mail settings.',
  'queue.mailSkipped': 'Nobody was emailed, as you asked.',
  'wizard.proto.imap.hint': 'Standard email protocol',
  // The consent you can click (0089 T1): the button that replaces the OAuth
  // Playground walk. The full evidence stays in the API's refusals; these
  // are the button's own words.
  'wizard.google.connect': 'Connect with Google',
  'connections.googleFaces': 'What this account will serve',
  'wizard.google.connect.hint': 'Opens Google’s consent screen and fills in the refresh token.',
  'wizard.google.connect.why': 'Pasting a token you already have keeps working.',
  'wizard.google.connect.needsDomains':
    'Tick what to migrate first; the consent asks only for that.',
  'wizard.google.connect.needsClient': 'Enter the Client ID and client secret first.',
  // One sentence for every provider's consent: what lands is the same
  // token in the same box, and the same save-and-test follows.
  'wizard.consent.received': 'Consent received — saving and testing this connection.',
  // The arm that must never be silent (workplan 0114): a credential field
  // naming a provider no door has a consent for. Nothing sends a person to
  // the wrong company's consent screen; the form says so and the manual
  // token field is still there.
  'wizard.consent.noProvider':
    'This deployment has no consent button for this type; paste a refresh token instead.',
  // The account first (owner's walk, 2026-09-02): the consent saves and
  // tests in one go, and the save needs the address.
  'wizard.consent.needsAccount': 'Enter the account address first.',
  // A consent window the browser did not open (workplan 0145 T5): the window
  // opens in the press now, and when it still does not, this sentence and a
  // link to the provider's page take its place. Tapping the link is a new
  // press. Written to read on from the in-app browser line above it.
  'wizard.consent.windowBlocked': 'Your browser did not open {provider}’s page. Open it with this link:',
  // That link past the consent's ten minutes (CONSENT_STATE_TTL_MS): the
  // server has forgotten it, and a tap would end on its English "expired"
  // refusal. So the link goes, and this asks for the press that starts anew.
  'wizard.consent.windowExpired': 'The link to {provider}’s page has expired. Press {button} again.',
  // Beside every Connect button, on the managed service (0139 T4;
  // docs/google-oauth-verification.md §5: "Links to the privacy policy and
  // terms sit beside the button, not in a footer."). The two links follow,
  // named as the texts name themselves (`acceptance.doc.*`).
  'wizard.consent.legal': 'What we do with your data, and on what terms:',
  // The deployment's own client (ADR-0041, owner decision 2026-09-01): the
  // pair becomes optional as a whole, and a half-typed pair is named rather
  // than silently completed with the deployment's other half.
  'wizard.google.deploymentClient':
    'This deployment has its own Google client; enter both to use yours instead.',
  'wizard.google.connect.halfClient': 'Enter both the Client ID and the client secret, or neither.',
  'wizard.google.ownClient': 'Use your own Google client',
  // The string Google matches against the client's registered list. It was
  // always in the route's answer and the wizard threw it away, so
  // `redirect_uri_mismatch` arrived naming no address (2026-09-01).
  'wizard.google.redirectUri':
    'Register this exact address in your Google client under Authorised redirect URIs:',
  // Beside Connect with Google when the consent asks for mail, calendars or
  // contacts (workplan 0144 T3 (a)): Google's screen describes those scopes
  // as allowing changes and deletion, and a tester should hear it here first,
  // with what Ownpace does. Drive and Tasks are read-only at Google and get no
  // line; `googleConsentAllowsChanges` in shared decides. §3's two sentences,
  // whole: a consent sentence, which 0118 §2 keeps verbatim, not a `.hint`.
  'wizard.google.readsOnly':
    'For mail, calendars and contacts, Google describes a broader permission than Ownpace uses. Ownpace only reads; it changes and deletes nothing in this account.',
  // Beside Connect with Google, always (workplan 0140 T3 (a)): Google is
  // reported to refuse its consent inside another app's built-in browser, and
  // nothing said what to do. The grant page's twin ends "The link still
  // works"; this one ends by signing in again, because the wizard and the
  // Connections page have no grant link to reopen. A consent sentence, kept
  // whole (0118 §2), not a `.hint`.
  'wizard.google.inAppBrowser':
    'If this page opened inside another app, such as a chat or mail app, use that app\'s \'Open in browser\' option or copy the link into Safari or Chrome, then sign in to Ownpace there.',
  // Connect with Dropbox (2026-09-02): the same button, Dropbox's words.
  'wizard.dropbox.connect': 'Connect with Dropbox',
  'wizard.dropbox.connect.hint': 'Opens Dropbox’s consent screen and fills in the refresh token.',
  'wizard.dropbox.connect.why': 'Pasting a token you already have keeps working.',
  'wizard.dropbox.connect.needsClient': 'Enter the App key and App secret first.',
  'wizard.dropbox.connect.halfClient': 'Enter both the App key and the App secret, or neither.',
  'wizard.dropbox.deploymentClient':
    'This deployment has its own Dropbox app; enter both to use yours instead.',
  'wizard.dropbox.ownClient': 'Use your own Dropbox app',
  'wizard.dropbox.redirectUri':
    'Register this exact address in your Dropbox app under OAuth 2 → Redirect URIs:',
  // Connect with Microsoft (workplan 0114): the same button a third time.
  // Two things say Microsoft rather than Google or Dropbox — the words
  // "app registration" and "Microsoft Entra ID", which are the provider's
  // own, and the TENANT, which neither of the other two has.
  'wizard.microsoft.connect': 'Connect with Microsoft',
  'wizard.microsoft.connect.hint':
    'Opens Microsoft’s consent screen and fills in the refresh token.',
  'wizard.microsoft.connect.why':
    'It asks you which account, so a migration cannot quietly read the wrong mailbox. Pasting a token you already have keeps working.',
  'wizard.microsoft.connect.needsClient':
    'Enter the Application (client) ID and client secret first.',
  'wizard.microsoft.connect.halfClient':
    'Enter both the Application (client) ID and the client secret, or neither.',
  'wizard.microsoft.deploymentClient':
    'This deployment has its own Microsoft app registration; enter both to use yours instead.',
  'wizard.microsoft.ownClient': 'Use your own app registration',
  'wizard.microsoft.redirectUri':
    'Register this exact address in your app registration under Authentication → Redirect URIs:',
  // Beside Connect with Microsoft, before anything is pressed (workplan 0140
  // T6 (b)): an organisation decides who in it may consent, and a tester met
  // that only after the button, as microsoftConsentRefusal's sentence. True
  // whether or not publisher verification (T5) is done. The second sentence is
  // Microsoft's documented default as understood in 0140 §4.3; T6's personal
  // account confirms or corrects it.
  'wizard.microsoft.orgApproval':
    'A work or school account may need its organisation’s administrator to approve Ownpace first. A personal Microsoft account does not.',
  // The tenant, which is the field Google and Dropbox have no equivalent of.
  // Empty is the RIGHT answer for almost everybody, and a hint that only said
  // "optional" would leave the one person it matters to guessing.
  'wizard.microsoft.tenantId.hint': 'Leave empty unless your app registration is single-tenant.',
  'wizard.microsoft.tenantId.why':
    'Empty means this deployment’s own directory setting, which accepts any work, school or personal Microsoft account. A single-tenant registration sent to the wrong directory fails with a message about the application not being found, which reads like a typo and is not one.',
  // Apple's ONE credential field, and the hint carries the whole setup
  // (workplan 0115). Somebody who types their Apple Account password gets a
  // rejection saying the password is wrong — which it is not; it is the right
  // password of a kind Apple refuses on these protocols by design, because the
  // account has two-factor authentication and every Apple Account does. So the
  // hint names the page rather than describing the rule.
  'wizard.proto.apple.hint':
    'One Apple Account: mail, calendars, contacts and reminders, whichever you tick.',
  'wizard.appleAppPassword': 'App-specific password',
  'wizard.appleAppPassword.hint':
    'Not your Apple Account password: an app-specific password from account.apple.com.',
  'wizard.appleAppPassword.why':
    'Apple refuses the account password here by design. Make one at account.apple.com → Sign-In and Security → App-Specific Passwords and paste it. It reaches your mail, calendars, contacts and reminders, and you can revoke it there whenever you like.',
  // THE EXPORT ARCHIVE (workplan 0116 T1; a migration source since T5/T6).
  // One card for two exports, and the hint has to carry the two things the
  // card name cannot: this is a SNAPSHOT with a date on it, not a live
  // account — and because it is, a later export only ever ADDS: nothing is
  // removed from the target because an export no longer mentions it (§5).
  //
  // APPLE IS TAGGED WHILE NO READER OPENS IT (0148 T3, owner decision D7), in
  // the hint as in the form's option. The hint is a sentence, so it is the one
  // place a landed reader is answered by hand; `an-export-we-cannot-read-yet`
  // fails until it is. "download" rather than "export you downloaded" keeps
  // it inside the twelve words a hint may spend.
  'wizard.proto.archive.hint': 'A Google Takeout or Apple (to be tested) download: photos and files.',
  'wizard.archiveProvider': 'Which export',
  'wizard.archiveProvider.hint': 'Which company made the archive; the wrong choice finds nothing.',
  'wizard.archiveProvider.why':
    'It decides how we read the export, and the files themselves do not say. Google exports are requested at takeout.google.com, Apple exports at privacy.apple.com.',
  // An export no reader opens yet (0148 T3, D7): the tag inside the option's
  // name, and the line under the field while it is chosen, keyed per export
  // because it names the company. Both leave the form when a reader lands.
  'wizard.archiveProvider.untested': 'To be tested',
  'wizard.archiveProvider.noReader.apple-privacy':
    'We cannot read an Apple export yet. Request one only for your own records.',
  'wizard.archivePath': 'Where the archive is',
  'wizard.archivePath.hint': 'The folder you extracted the download into, or the .zip itself.',
  'wizard.archivePath.why':
    'If the export arrived in several parts, keep them in one folder and name any one of them: we read them all, and we say so if one is missing. Or extract them all into the same folder first. Nothing is written there: we only read.',
  // WHERE THE EXPORT IS KEPT (workplan 0148 T9, D11): in a folder of the
  // destination's own files, or on the appliance's disk. On managed the disk
  // is shown, disabled, with the line under it (the owner: "'Only on a
  // self-hosted appliance': ok").
  'wizard.archiveWhere': 'Where the export is',
  'wizard.archiveWhere.target': "In a folder of your destination's files (Nextcloud or WebDAV)",
  'wizard.archiveWhere.disk': "On this appliance's disk",
  'wizard.archiveWhere.disk.onlyAppliance': 'Only on a self-hosted appliance',
  'wizard.archivePath.target': "Folder in your destination's files",
  'wizard.archivePath.target.hint': 'The folder as your files show it, from the top.',
  'wizard.archivePath.target.why':
    'For example Exports/takeout-20260904, or one .zip in that folder: we read the other parts beside it too. Upload the .zip parts of the export into one folder of the files this migration writes to, and name that folder here. The parts stay there after the migration and take up space; delete them once you have checked the result.',
  // The ACCOUNT card. Four faces, and the sentence says why that is more than
  // Google offers rather than leaving it looking like an oversight there.
  'wizard.proto.microsoft.hint':
    'One Microsoft 365 account, one sign-in: mail, calendars, contacts and OneDrive.',
  // The two Microsoft 365 connection methods (0107 T1): the family heading
  // says WHO, the card says HOW — "OAuth2" as a card name said neither.
  'wizard.group.provider': 'Your provider',
  'wizard.group.protocol': 'Any server, by protocol',
  // The tag on a source that has not yet met a real account (workplan 0131
  // T2, the owner's D6). Text inside the card's button, so a screen reader
  // reads it as part of the card's name (0145 T2); the why folds beside it.
  'frontDoor.experimental': 'Experimental',
  'frontDoor.experimental.why':
    'Built, not yet run against a real account of this kind. Keep your old account and check what arrives.',
  'frontDoor.experimental.wholeDomain.why':
    'Domain-wide delegation is built and has not yet run against a real Workspace. Keep your old account and check what arrives.',
  'wizard.m365.viaImap': 'Via IMAP',
  'wizard.m365.viaGraph': 'Via the Graph API',
  'wizard.proto.oauth2.hint': 'IMAP with XOAUTH2, Graph fallback behind it (app registration)',
  'wizard.proto.graph.hint': 'Graph API only (app registration)',
  // The ACCOUNT card (workplan 0106 T3b). It names the faces it serves (three
  // since Tasks joined, 0126 T2), because "why is Gmail a separate card" is
  // the first question this card raises.
  'wizard.proto.google.hint': 'One Google account, one sign-in: calendars, contacts and tasks.',
  // The same card where the DEPLOYMENT'S own Google application carries the
  // restricted scopes (ADR-0041, owner decision 2026-09-01). The sentence
  // above names a wall that is not there on such an installation, and a card
  // that does that sends somebody looking for the wrong problem. The
  // single-purpose cards stay: an existing mapping keeps working, and one
  // account per face is still a reasonable thing to want.
  'wizard.proto.google.hint.restricted':
    'One Google account, one sign-in: mail, calendars, contacts, files and tasks.',
  'wizard.proto.googleDrive.hint': 'Files from a Google Drive (read-only OAuth)',
  'wizard.proto.dropbox.hint': 'Files from a Dropbox (read-only OAuth app)',
  'wizard.proto.box.hint': 'Files from a Box account (read-only platform app)',
  'wizard.boxUserId': 'Box user ID (numeric)',
  'wizard.boxUserId.placeholder': 'e.g. 1234567890',
  'wizard.boxRootFolderId': 'Root folder ID',
  'wizard.boxRootFolderId.placeholder': 'Empty = All Files',
  'wizard.review.boxUser': 'Box user',
  'wizard.dropboxAppKey': 'App key',
  'wizard.dropboxRootPath': 'Root folder path',
  'wizard.dropboxRootPath.placeholder': 'e.g. /Team Docs',
  'wizard.browseDropboxFolders': 'Browse shared folders…',
  'wizard.noDropboxSharedFolders': 'This account sees no shared folders.',
  'wizard.dropboxUnmounted': 'not mounted — add it to your Dropbox first',
  'wizard.review.wholeDropbox': 'the whole Dropbox',
  'wizard.proto.gmail.hint': 'Email from a Gmail mailbox (OAuth over IMAP)',
  'wizard.proto.googleCalendar.hint': 'Calendars from a Google account (OAuth over CalDAV)',
  'wizard.proto.googleContacts.hint': 'Contacts from a Google account (OAuth over CardDAV)',
  'wizard.gmailAppPassword': 'App password',
  'wizard.gmailAppPassword.hint': 'Personal Google accounts only; leave empty to use OAuth.',
  'wizard.gmailAppPassword.why':
    'Google recommends against it, and so do we: an app password opens the whole mailbox, where a consented token opens one thing. It needs 2-step verification on the account, does not exist on a Workspace account, and is withdrawn in the account’s own app-password list without touching Ownpace, which is the one real advantage it has.',
  'wizard.refreshToken': 'Refresh token',
  'wizard.refreshToken.hint': 'The account’s delegated token; treat it as a password.',
  'wizard.rootFolderId': 'Root folder ID',
  'wizard.rootFolderId.placeholder': 'Empty = all of My Drive',
  'wizard.review.myDrive': 'My Drive',
  'wizard.targetPrefix': 'Target folder (optional)',
  'wizard.targetPrefix.placeholder': 'Empty = merge into the account',
  'wizard.targetPrefix.hint': 'Everything lands under this folder; empty merges into the account.',
  'wizard.targetPrefix.why':
    'Useful when several sources share one target and you want a subfolder per source, such as "Gmail". Empty is the default: one account, one place to work. Under a folder, Sent and Drafts arrive as ordinary folders inside it rather than becoming the account’s own Sent and Drafts; a mail app can only have one of each.',
  'wizard.serviceAccountKey': 'Service account key',
  'wizard.serviceAccountKey.placeholder': 'Paste the whole JSON key file',
  'wizard.serviceAccountKey.width':
    'This key can read every user in the domain; revoke it at cutover.',
  'wizard.serviceAccountKey.why':
    'Domain-wide delegation can read any Workspace user, though each migration still names one account. Authorise only the scopes you need in the Admin console, and revoke the delegation at cutover.',
  'wizard.browseSharedDrives': 'Browse shared drives & folders…',
  'wizard.noSharedDrives': 'No shared drives or folders visible; an empty root migrates My Drive.',
  'wizard.sharedDrivesGroup': 'Shared drives',
  'wizard.sharedFoldersGroup': 'Folders shared with me',
  'wizard.nativePolicy': 'Google Docs, Sheets, Slides and Drawings',
  'wizard.nativePolicy.hint':
    'They have no file to copy, only a rendering Google makes.',
  'wizard.nativePolicy.hint.why':
    'A Google Doc lives in Google, not in a file: there is nothing to copy across. Drive can render one as a document or a PDF, and that rendering is what would arrive. Leaving them behind is the alternative, and the default.',
  // ONE SELECT PER KIND (0042 T9; the owner, 2026-09-23: "a per kind choice
  // makes more sense for the fileformats. Split that up."). Each select offers
  // the formats that carry that kind, so nothing on the list leaves its kind
  // behind while looking as though it would copy it. Every format carries every
  // kind since the refusals of measured-unstable exports went (ADR-0046,
  // amended 2026-09-23).
  'wizard.nativePolicy.leave': 'Leave behind, and report each one',
  'wizard.nativePolicy.as.odf': 'OpenDocument ({ext})',
  'wizard.nativePolicy.as.office': 'Microsoft Office ({ext})',
  'wizard.nativePolicy.as.pdf': 'PDF ({ext}), not editable',
  'wizard.nativePolicy.as.image': 'Image ({ext})',
  // The format in force for a kind it does not carry, shown as what it does.
  'wizard.nativePolicy.as.leftBehind': '{format}: left behind',
  'wizard.nativePolicy.editable': 'Use an editable format for every kind',
  // WHAT THE CHOICE LEAVES BEHIND, AND WHAT CANNOT BE EDITED, on the screen
  // where it is made. Read off the same tables the selects are built from.
  'wizard.nativePolicy.leftBehind': '{kinds} stay behind in Google, each reported by name.',
  'wizard.nativePolicy.leftBehind.why':
    'Nothing is copied for them and nothing is lost: each one appears on the Failures screen with its name, and you accept or retry them one at a time or all at once. Forms, My Maps, Sites and Apps Scripts always stay behind: Google can export those in no format at all.',
  'wizard.nativePolicy.notEditable': '{kinds} arrive as PDF, which nobody can edit afterwards.',
  'wizard.nativePolicy.notEditable.why':
    'A PDF is a copy of how the document looks: nobody gets a Google Doc back out of it, and fine formatting can shift. Choose it for a kind you want copied but do not need to edit.',
  'wizard.nativePolicy.allEditable': 'All four kinds arrive as files you can edit.',
  'wizard.nativePolicy.allEditable.why':
    'Each arrives as a rendering Google makes, not the original: fine formatting can shift, and drawings arrive as .svg images because Drive offers no editable drawing format. You can change a format later; files already copied keep the format they arrived in.',
  // THE SAME QUESTION FOR DROPBOX PAPER DOCS (workplan 0150 T3 (d)). One
  // select, since Paper is the one kind a Dropbox migration chooses a format
  // for (D7). The wizard suggests Markdown (D1): Nextcloud's Text app opens it.
  'wizard.paperFormat': 'Dropbox Paper docs',
  'wizard.paperFormat.hint': 'They have no file to copy, only an export Dropbox makes.',
  'wizard.paperFormat.hint.why':
    'A Paper doc lives in Dropbox, not in a file: there is nothing to download. Dropbox can export one as Markdown or HTML, and that export is what would arrive, under the doc’s own name with the format’s suffix added: Notes.paper arrives as Notes.paper.md. Paper templates follow the same choice. Leaving them behind is the alternative.',
  'wizard.paperFormat.leave': 'Leave behind, and report each one',
  'wizard.paperFormat.as.markdown': 'Markdown (.md), opens in Nextcloud Text',
  'wizard.paperFormat.as.html': 'HTML (.html), opens in a web browser',
  'wizard.paperFormat.leftBehind': 'Paper docs stay behind in Dropbox, each reported by name.',
  'wizard.paperFormat.leftBehind.why':
    'Nothing is copied for them and nothing is lost: each one appears on the Failures screen with its name, and you can choose a format for them later, or leave them behind.',
  'wizard.paperFormat.arrives': 'Each Paper doc arrives as a {ext} file you can edit.',
  'wizard.paperFormat.arrives.why':
    'An export is a rendering Dropbox makes, not the Paper doc itself: fine formatting can shift, and nothing you change on the new system goes back to Dropbox. You can change the format later; docs already copied keep the format they arrived in.',
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
    'The next pass tries Google files the old format refused again, in this format.',
  // The same sentence with the count, used only when the count is KNOWN and
  // above zero: a queue we could not read must not read as a queue of none.
  'settings.exportPolicy.refusedBefore.count':
    'The next pass tries {count} Google file(s) the old format refused again, in this format.',
  'settings.exportPolicy.refusedBefore.why':
    'A Google file’s name comes from its format (Report.docx, Report.odt), and the name is how a migration recognises a file, so under a new format each one is new to it. The next pass tries each under its new name, and the refusal recorded under the old name closes by itself, because the file is no longer listed by it. If the new format cannot carry a file either, it stays on the Failures screen once, under its new name. Saving changes nothing by itself: the pass does it. A file you chose to leave behind stays left behind.',
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
    'A Paper doc has no file name of its own: its format adds one to its name (Notes.paper.md, Notes.paper.html), and the name is how a migration recognises a file. So under a new format the next pass copies each Paper doc under its new name. Nothing on the new system is rewritten or removed: a copy in the old format stays where it is, and the Deletions screen lists it as an earlier export, never as deleted in Dropbox. Keep it, or remove it yourself on the new system.',
  'settings.exportPolicy.paper.refusedBefore':
    'The next pass tries the Paper docs left behind so far again, in this format.',
  // With the count, only when it is KNOWN and above zero, as Drive's.
  'settings.exportPolicy.paper.refusedBefore.count':
    'The next pass tries {count} Paper doc(s) left behind so far again, in this format.',
  'settings.exportPolicy.paper.refusedBefore.why':
    'Under a format a Paper doc arrives under a new name (Notes.paper.md), so it is new to the migration. The next pass copies each one, and the line recorded under its old name closes by itself, because the doc is no longer listed by it. A doc Dropbox does not offer in this format stays on the Failures screen once, saying so. Saving changes nothing by itself: the pass does it. Other documents Dropbox keeps in a format of its own stay behind.',
  // HOW OFTEN A MIGRATION SYNCS, changed on its own page (the owner,
  // 2026-09-28). The four cadences are the wizard's own words.
  'settings.schedule': 'How often to look for changes',
  'settings.schedule.default': 'Now: every 15 minutes, because this migration has no schedule of its own.',
  'settings.schedule.own': 'Now: {schedule}, set outside this page.',
  // The first copy runs pass after pass whatever the schedule, and the
  // schedule applies once every data type has been copied once (workplan
  // 0156 T5; the owner, 2026-10-03). Until then this said a daily schedule
  // copied for 50 minutes a day, which was true and was the defect.
  'settings.schedule.hint': 'Passes run back to back until the first copy is done.',
  'settings.schedule.hint.why':
    'A pass runs at most 50 minutes. Until every data type has been copied once in full, the next pass starts as soon as the last one ends, and no sooner than 15 minutes after it started, whatever this schedule says. A daily download limit at the source is waited out first. After that, passes follow this schedule and copy only what is new or changed. Items that could not be copied do not keep passes coming: they wait on the Failures screen.',
  'settings.schedule.save': 'Save this schedule',
  'settings.schedule.saving': 'Saving…',
  'settings.schedule.saved': 'Saved. The next pass follows it.',
  'settings.schedule.refused': 'This could not be changed:',
  'settings.schedule.failed': 'That did not save:',
  // WHAT THIS MIGRATION COPIES, and what it may still gain (workplan 0125 T6).
  // Adding only: the page never offers to take a data type off.
  'settings.kinds': 'Data types this migration copies',
  'settings.kinds.add': 'Add {kind}',
  'settings.kinds.adding': 'Adding…',
  'settings.kinds.added': '{kind} added. The next pass copies it.',
  // Before the press, like the export format's: what adding does and does not do.
  'settings.kinds.consequence':
    'An added data type is copied from the next pass. Nothing already copied changes.',
  'settings.kinds.consequence.why':
    'The new data type is copied in full from the next pass on, the way every data type is copied the first time: pass after pass, whatever the schedule, until it has been copied once. The ones this migration already copies carry on where they were. A data type cannot be taken off again here: what it had copied would stay on the new system with nothing keeping it up to date.',
  'settings.kinds.failed': 'That was not added:',
  // STOP AND RESUME ONE DATA TYPE (workplan 0128 T4, slice 3c). Offered where
  // the stop door accepts the press; what a stop does is said before it.
  'settings.kinds.stop': 'Stop {kind}',
  'settings.kinds.resume': 'Resume {kind}',
  'settings.kinds.stopping': 'Stopping…',
  'settings.kinds.resuming': 'Resuming…',
  'settings.kinds.stoppedByYou': 'stopped by you',
  'settings.kinds.stopped': '{kind} is stopped. Its copies stay; resume it to continue where it stopped.',
  'settings.kinds.resumed': '{kind} is resumed. The next pass continues where it stopped.',
  'settings.kinds.stop.consequence':
    'A stopped data type keeps what it copied, but no longer follows the source. Resuming it continues where it stopped.',
  'settings.kinds.stop.consequence.why':
    'For an account that closes before the others: stop the mail on the day the old mailbox closes, while calendars and contacts keep copying. Nothing is removed on either side. The last data type still copying cannot be stopped; to stop everything, end the migration.',
  'settings.kinds.held.lastOne':
    'The last data type still copying. To stop it, end the migration instead.',
  'settings.kinds.held.notRunning': 'This can be resumed once the migration runs again.',
  'settings.kinds.stop.failed': 'That did not change:',
  'wizard.step.migration': 'Migration',
  'wizard.testConnections.reused': 'Already saved; this only checks it still works.',
  'wizard.connectionName': 'Name for this account',
  'wizard.connectionName.taken':
    'This name is already taken; it saves, but two alike are hard to tell apart.',
  'wizard.testConnections.kept':
    'The details were kept: correct them and try again, or return later under Accounts.',
  'wizard.testConnections': 'Test and save connections',
  'wizard.testing': 'Testing…',
  'wizard.testConnections.hint': 'Signs in to both sides read-only and saves each side that works.',
  'wizard.testConnections.why':
    'It lists what it can see and writes nothing to either system. A side that works is saved as a connection, so leaving this wizard does not mean fetching those credentials again.',
  'wizard.proto.jmap.hint': 'Modern email protocol',
  'wizard.proto.caldav.hint': 'Calendar protocol',
  'wizard.proto.carddav.hint': 'Contact protocol',
  'wizard.proto.webdav.hint': 'File storage',
  'wizard.proto.soverin.hint': 'One account — email, calendars and contacts',
  // Says what it carries AND what it does not: a person whose mail is
  // elsewhere should not have to discover that by ticking Email and
  // finding no writer behind it.
  'wizard.proto.nextcloud.hint': 'One account — calendars, contacts, files and tasks (no email)',
  'wizard.title': 'Create Migration',
  // The heading every step card opens with (workplan 0145 T3 (a)). It takes
  // focus on Next and Back, so it is what a screen reader says for a new step.
  'wizard.stepHeading': 'Step {n} of {total}: {step}',
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
  // The DAV escape hatch (0105 T1) — see credential-fields.ts. It is the
  // ADDRESS rather than an escape hatch on the Nextcloud door, which is why
  // the label no longer calls itself optional: the descriptor says whether
  // it is demanded, and the asterisk repeats that answer.
  'wizard.targetDavUrl': 'DAV base URL',
  'wizard.targetDavUrl.hint': 'Only when the server’s DAV root is not at the host root.',
  'wizard.targetDavUrl.why': 'When filled in, this full URL is used and host and port are ignored.',
  // The SAME field on the Nextcloud door, where it is not an escape hatch:
  // the hint above talks about a host root, and that door has no host at all.
  'wizard.nextcloudDavUrl.hint':
    'The address you open Nextcloud at, with /remote.php/dav on the end.',
  'wizard.nextcloudDavUrl.why':
    'Nextcloud serves calendars, contacts and files under /remote.php/dav rather than at the root of the site, so a host and a port cannot say where it is. Paste the address from your browser’s bar — https://cloud.example.com — and add /remote.php/dav.',
  'wizard.soverinMailHost': 'Mail server',
  'wizard.soverinMailHost.hint': 'Only needed if this account will also receive mail.',
  'wizard.soverinMailHost.why':
    'Calendars and contacts need no mail server. Test measures the host you enter; nothing is assumed from the provider’s name.',
  'wizard.soverinMailPort': 'Mail port',
  // The provider directory (0106 T5): whose published settings sit in the
  // boxes, read when. They are measured by Test, never assumed.
  'wizard.providerDefaults.note':
    'Pre-filled from {provider}’s published settings, read {seen}. Test checks them.',
  'wizard.useSsl': 'Use SSL/TLS',
  'wizard.migrationName': 'Migration Name',
  'wizard.migrationName.placeholder': 'For example: Anna’s mail',
  'wizard.progress': 'Progress',
  'wizard.credentials': 'Credentials',
  // WHAT THE STAR MEANS, said once (2026-09-07). Eight labels used to carry
  // "(optional)" and the rest carried nothing, which read as "these eight are
  // the optional ones" — and it was wrong the moment a deployment carried no
  // OAuth client, because then the unmarked client pair was mandatory too.
  // The asterisk answers that question per field and per deployment, so it is
  // the only place the answer lives, and this line says how to read it.
  'form.requiredLegend': 'Fields marked * are required.',
  // NO SIDE IN THE LABEL (2026-09-07). These read "Source Username" and
  // "Target Password" because the wizard was once one screen with both sides
  // on it. It has had a step per side for some time, each under its own
  // heading — and the Connections add-form has no sides at all, so a Google
  // account added there was asking for a "Source Username" that is simply
  // the address. The two keys stay separate because each side's gate and
  // form map are keyed by them; only the words lost the prefix.
  'wizard.sourceUsername': 'Username',
  'wizard.sourcePassword': 'Password',
  'wizard.targetUsername': 'Username',
  'wizard.targetPassword': 'Password',
  'wizard.selectDataTypes': 'Select Data Types to Migrate',
  'wizard.domain.email.hint': 'Email messages and folders',
  'wizard.domain.calendar.hint': 'Events and appointments',
  'wizard.domain.contact.hint': 'Address book entries',
  'wizard.domain.file.hint': 'Attachments and documents',
  'wizard.domain.task.hint': 'To-do lists and their tasks',
  'wizard.schedule': 'Sync Schedule',
  'wizard.scheduleHint':
    'How often it repeats after the first copy, which starts when you press start and does not wait for this schedule.',
  'wizard.schedule.hourly': 'Hourly',
  'wizard.schedule.hourly.hint': 'Every hour',
  'wizard.schedule.daily': 'Daily',
  'wizard.schedule.daily.hint': 'Every day at 2 AM',
  'wizard.schedule.sixHourly': 'Every 6 hours',
  'wizard.schedule.sixHourly.hint': 'Four times a day',
  'wizard.schedule.quarterHourly': 'Every 15 minutes',
  'wizard.schedule.quarterHourly.hint': 'Frequent sync',
  'wizard.readyToCreate': 'Ready to create migration',
  'wizard.reviewDetails': 'Migration Details',
  'wizard.review.name': 'Name',
  'wizard.review.source': 'Source',
  'wizard.review.target': 'Target',
  'wizard.review.schedule': 'Schedule',
  'wizard.review.scheduleDefault': 'Daily at 2 AM',
  'wizard.review.dataTypes': 'Data Types',
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
  'wizard.credentials.storage': 'Encrypted at rest, used only to connect, and never shown again.',
  // 0037 T6, answered 2026-08-10: oauth2/graph collect the per-customer
  // Entra app registration (ADR-0006's row-14 model).
  'wizard.tenantId': 'Tenant ID',
  'wizard.clientId': 'Client ID (application ID)',
  'wizard.sourceClientSecret': 'Client secret',
  // 0037 T4: the coherence hint on an unselectable data type; the full
  // refusal sentence comes from shared and renders verbatim.
  'wizard.domain.notForTarget': 'Not available over the selected target protocol.',
  // The account's own measured record on the domain step (0106 T3a). The
  // full evidence sentence rides the hover title; unknown never locks.
  'wizard.domain.measuredNo': 'This account cannot carry this; test it again if that changed.',
  'wizard.domain.unmeasured': 'Not yet measured for this account; a test answers it.',
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
  // ADR-0014's tier, on the customer's own usage screen (0121 T4).
  'billing.yourTier': 'What this puts you on',
  'billing.tierSetup': 'to set up',
  'billing.tierPerMonth': 'per month',
  'billing.tierFree': 'Free: nothing is invoiced on this tier',
  'billing.tierDecidedByPaths': 'Set by how many migrations ran at the same time.',
  'billing.tierDecidedByData': 'Set by how much data has been moved.',
  'billing.tierDecidedByBoth': 'Set by both what ran at once and how much was moved.',
  'billing.tierPeakPaths': 'Most migrations at once',
  'billing.tierDataMoved': 'Data moved, all months',
  'billing.tierBeyondTable':
    'Past the published table — talk to us and we will price it properly.',
  'billing.noUsage': 'No usage data available yet',
  // The data ceiling and the yes that moves it (workplan 0109 T6, ADR-0014's
  // amendment of 2026-10-03): both ways on from 80%, with the break-even.
  'billing.ceiling.title': 'Your data ceiling',
  'billing.ceiling.moved': '{moved} of {ceiling} moved, on {tier}.',
  'billing.ceiling.bands': 'That includes {count} extra band(s) bought.',
  'billing.ceiling.under':
    'From 80% of the ceiling, this card offers the two ways on: moving up, or another band once.',
  'billing.ceiling.near':
    'You have moved {share} of your data ceiling. At the ceiling, new items wait until you choose a way on; changes to what is already copied carry on.',
  'billing.ceiling.reached':
    'Your data ceiling is reached. New items wait until you choose a way on; changes to what is already copied carry on.',
  'billing.ceiling.alpha':
    'During the alpha nothing waits at the ceiling and nothing is charged, so there is nothing to agree to yet. The prices below are what the ways on cost after the alpha.',
  'billing.ceiling.moveUp':
    'Move up to {tier}: {setup} once, then {monthly} a month. Your ceiling becomes {ceiling}, and {paths} migrations can run at once.',
  'billing.ceiling.moveUp.button': 'Move up to {tier}',
  'billing.ceiling.talkToUs': 'There is no tier past {tier}. Talk to us and we will price it properly.',
  'billing.ceiling.topUp':
    'Or buy another {band} once, for {price}. Your ceiling becomes {ceiling}, and your monthly price stays the same.',
  'billing.ceiling.topUp.button': 'Buy another {band}',
  'billing.ceiling.noTopUp': '{tier} has no top-up: the way on is moving up.',
  'billing.ceiling.breakEven':
    'Topping up costs {extra} more once and saves {saved} a month, so it pays back in about {days} day(s).',
  'billing.ceiling.breakEven.cheaper': 'Topping up costs no more once, and saves {saved} a month.',
  'billing.ceiling.betterBuy':
    'Moving up is the better buy when you need more migrations at once: {next} runs {nextPaths} at the same time, {tier} {paths}.',
  'billing.ceiling.confirm.moveUp': 'You agree to pay {setup} once, then {monthly} a month, for {tier}.',
  'billing.ceiling.confirm.topUp': 'You agree to pay {price} once for another {band}.',
  'billing.ceiling.confirm.yes': 'Yes, I agree',
  'billing.ceiling.confirm.no': 'Not now',
  'billing.ceiling.done': 'Done: your data ceiling is now {ceiling}.',
  'billing.ceiling.offerChanged':
    'What is offered changed since this page was shown, so nothing was agreed. This is the offer now.',
  'billing.ceiling.loadFailed': 'Your data ceiling could not be read',
  'billing.ceiling.yesFailed': 'Your yes was not recorded:',
  'billing.invoices': 'Invoices',
  'billing.noInvoices': 'No invoices yet',
  'billing.invoice': 'Invoice',
  'billing.period': 'Period:',
  'billing.paymentMethods': 'Payment Methods',
  // The channel's state, shown only when it is OFF (0043 T3). "On" is not worth
  // a banner; "off" is the state somebody has to act on, and until now it was
  // visible only in a container log line written once at boot.
  'notifications.off': 'Email notifications are off',
  'notifications.offHint':
    'Nobody is emailed when this migration needs a decision; configure SMTP to turn that on.',
  'notifications.offReason': 'Reason given by the server:',
  'mappings.title': 'Migrations',
  'mappings.subtitle': 'Manage your data migration configurations',
  'mappings.new': 'Start a migration',
  'mappings.empty.title': 'No migrations yet',
  'mappings.empty.hint': 'Start one: who it is for, where from, what, and where to.',
  'mappings.empty.cta': 'Start a migration',
  'mappings.th.name': 'Name',
  'mappings.th.sourceTarget': 'Source → Target',
  'mappings.th.status': 'Status',
  'mappings.th.lastSync': 'Last Sync',
  'mappings.th.actions': 'Actions',
  'mappings.action.triggerSync': 'Trigger sync',
  'mappings.action.pause': 'Pause',
  'hub.connections': 'From {source} to {target}',
  // Where the copies land (0153 open question 5, item 4).
  'hub.lands.folder': 'The copies land in the folder {folder} of the destination.',
  'hub.lands.merged': "The copies land in the destination's own folders.",
  'hub.details': 'Details',
  'hub.migrationId': 'Migration ID:',
  'timeLeft.label': 'How long:',
  'timeLeft.gmailDays': 'About {low} to {high} days, because Google lets a mailbox download {ceiling} GB a day.',
  'timeLeft.gmailWithinADay':
    'Within a day, because this mailbox holds less than the {ceiling} GB a day Google lets one download.',
  'timeLeft.notKnownYet': 'Depends on the provider; we will know after the first hour.',
  'timeLeft.filesLater': 'The files: we will know after the first hour.',
  'timeLeft.copying.days': 'About {low} to {high} days more, from the last {n} passes.',
  'timeLeft.copying.hours': 'About {low} to {high} hours more, from the last {n} passes.',
  'timeLeft.copying.upToDays': 'Up to {high} days more, from the last {n} passes.',
  'timeLeft.copying.upToHours': 'Up to {high} hours more, from the last {n} passes.',
  'timeLeft.slowedBy': 'Slowed by {provider}.',
  'timeLeft.afterThreePasses': 'We will know after three passes; {n} so far.',
  'migrationReport.title': 'Report',
  'migrationReport.person.title': 'Report: {name}',
  'migrationReport.lead': 'What was found, what arrived, what could not come and why, and what the check compared.',
  'migrationReport.loadFailed': 'Could not read this report.',
  'migrationReport.verdict.complete': 'Complete: everything has arrived, and nothing waits on a decision.',
  'migrationReport.verdict.decisionsPending': 'Everything has arrived, but some items still wait on a decision.',
  'migrationReport.verdict.inProgress': 'Still under way: this is where it stands, not a closing report.',
  'migrationReport.arrived.heading': 'What arrived',
  'migrationReport.col.type': 'Type',
  'migrationReport.col.found': 'Found',
  'migrationReport.col.arrived': 'Arrived',
  'migrationReport.col.leftAsIs': 'Left as it was',
  'migrationReport.col.couldNotCome': 'Could not come',
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
  'migrationReport.sharing.heading': 'Access carried over',
  'migrationReport.sharing.counts': '{applied} re-created, {manual} done by hand, {skipped} not carried over, {open} still open.',
  'migrationReport.check.heading': 'What the check compared',
  'migrationReport.check.col.old': 'On the old system',
  'migrationReport.check.col.new': 'On the new',
  'migrationReport.check.col.contents': 'Contents compared',
  'migrationReport.check.compared': '{matched} of {sampled} the same',
  'migrationReport.access.heading': 'Access you granted, which only you can withdraw',
  'migrationReport.access.lead': 'It still works after this migration, until you remove it. We cannot do this for you.',
  'migrationReport.asOf': 'As it stood on {when}.',
  'migrationReport.download': 'Download the report',
  'migrationReport.toConfirmed': 'What is confirmed, item by item',
  'migrationReport.open': 'The report',
  'confirmed.toReport': 'What happened: the report',
  'mappings.action.pause.why':
    'No new passes are started. A pass already running stops starting new items within about fifteen seconds, and finishes the ones it has begun; a very large file can take longer. Nothing is lost: Review and start continues from where it stopped.',
  'mappings.action.startSync': 'Start sync',
  // 0037 T2: a paused mapping's row leads to the confirm screen — the Play
  // button it used to render could only earn a 409.
  'mappings.action.reviewAndStart': 'Review and start',
  'mappings.action.open': 'Open',
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
    'No mail, calendars, contacts or files are deleted anywhere. Set the same migration up again later and it recognises what is already there and copies only what is new. What it finds already there is no longer updated when it changes at the source, and anything you deleted or moved on the new side comes back. To keep changes flowing, pause the migration instead.',
  'mappings.delete.confirm': 'Delete migration',
  'mappings.delete.cancel': 'Cancel',
  'mappings.delete.failed': 'The migration was not deleted.',
  'domain.email': 'Email',
  'domain.calendar': 'Calendar',
  'domain.contact': 'Contacts',
  'domain.file': 'Files',
  'domain.task': 'Tasks',
  'evidence.reported.title': 'The source itself reported the object gone.',
  'evidence.trashed.title': 'Found in the owner’s Deleted Items.',
  'evidence.inferred.title': 'Missing from complete scans: a suspicion, never applied.',
  'guidance.summary': 'What this means and what you can do',
  'receipt.queued': 'Removal queued — the job re-checks every gate before touching anything.',
  'receipt.applied.binned':
    "Removed — moved to the target's own bin; a copy may still be recoverable there.",
  'receipt.applied.deleted': 'Removed — gone, with no recovery path from here.',
  'receipt.applied.unknown': 'Removed. How final the removal was is not recorded on the receipt.',
  'receipt.failedPrefix': 'The removal job failed:',
  'lifecycle.paused':
    'This migration has not started, so nothing has been copied and nothing can have diverged.',
  // *Rename* beside a migration's title (0153 open question 5, item 4).
  'hub.rename': 'Rename',
  'hub.rename.label': 'Name of this migration',
  'hub.rename.save': 'Save',
  'hub.rename.saving': 'Saving…',
  'hub.rename.failed': 'Not renamed:',
  'hub.fallbackTitle': 'Migration',
  'hub.orderIntro': 'Work them from the top, in this order.',
  'hub.noId': 'No mapping id in the address.',
  'hub.detailError': "Could not read this migration's details — the screens below still work.",
  'hub.grantWithdrawn': 'On {date} the person being migrated withdrew their access. Nothing reads their account now.',
  'hub.grantWithdrawn.next': 'If they agree to continue, send them a new grant link. Links are made per person: see Links below.',
  'hub.deletions.name': 'Deletions',
  'hub.deletions.blurb': 'Deleted on the old system, still on the new; your call, per item.',
  'hub.moves.name': 'Moves',
  'hub.moves.blurb':
    'Items the old system reorganised since they were copied. An old copy goes only when you remove it, or by automatic removal if you turned that on.',
  'hub.failures.name': 'Failures',
  'hub.failures.blurb':
    'Items that could not be copied and now wait on a person. These block finishing.',
  'hub.sharing.name': 'Sharing',
  'hub.sharing.blurb':
    'Who could reach what on the old system; a checklist worked after finishing.',
  'sharing.title': 'Sharing checklist',
  'sharing.intro': 'Everything somebody else could reach on the old system, one row per grant.',
  'sharing.intro.more':
    'Settle each row: apply the share on the new system, tick it off as done by hand, or skip it on purpose. Done and Skip both settle a row and they record different things — Done means this access was re-established by hand, Skip means it is deliberately not carried across. After a cutover those are different answers to "why can this person no longer open it". Every settled row keeps who decided, and when.',
  'sharing.progressSettled': 'settled',
  'sharing.openManualNote':
    'row(s) marked manual: your steps on the new system; tick them off here when done.',
  'sharing.rescan': 'Refresh from the source…',
  'sharing.blindSpots': 'Could not be inventoried — capture these by hand:',
  'sharing.empty': 'No shares on the list yet. Refresh from the source to scan.',
  'sharing.apply': 'Apply Share on the new system',
  'sharing.applyArmed': 'Click again — this shares AND invites',
  'sharing.done': 'Mark done',
  'sharing.done.why': 'This access was re-established by hand on the new system.',
  'sharing.skip': 'Skip',
  'sharing.skip.why': 'This access is deliberately not carried across.',
  'sharing.linkShare': 'link share',
  'sharing.manualBadge': 'manual',
  'sharing.granteeLabel': 'share with',
  'sharing.inviteNote':
    'Applying creates the share, and the new system invites this address itself; check it first.',
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
  'sharing.group.confirmFirst': 'Check each address before one press invites them all.',
  'sharing.group.confirmFirst.why':
    'The new system sends the invitation itself, the moment the share is created — so a press over a whole folder is a wave of real mail to real people, and it cannot be unsent. That is why each address is shown here and each one is confirmed on its own: the tool proposes the address the old system recorded, and a person decides whether that is still where this person should be invited. An address you confirm here is remembered for that person\u2019s other rows in this migration, so nobody retypes the same correction twice.',
  'sharing.group.addressLabel': 'send to',
  'sharing.group.confirmOne': 'Confirm',
  'sharing.group.confirmed': 'confirmed',
  'sharing.group.stillToConfirm': '{count} address(es) still to check.',
  'sharing.alone.unplaced': 'The old system did not say where this sits, so it is on its own.',
  'sharing.alone.vsFolder': 'Shared differently from its folder',
  'sharing.alone.vsSiblings': 'Shared differently from the other items here',
  'sharing.alone.extra': 'extra:',
  'sharing.alone.missing': 'missing:',
  'sharing.notPlacedYet':
    'Found before this tool could group by folder. Refresh from the source to fold them.',
  'hub.check.name': 'Check',
  'hub.check.blurb':
    'Compare the two systems and sample the contents, behind one button.',
  'hub.confirmed.name': 'Confirmed',
  'hub.confirmed.blurb':
    'What is in the new home, item by item, and what was compared.',
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
  'runs.items.one': '1 item this pass',
  'runs.items.many': '{n} items this pass',
  'runs.errors.one': '1 error',
  'runs.errors.many': '{n} errors',
  'runs.events': 'Log',
  'grantLink.title': 'Grant links',
  'grantLink.blurb':
    'The person being migrated grants access themselves, without sending you a password.',
  'grantLink.why':
    'They need no Ownpace account. You send the link to them yourself; Ownpace never does, and never learns who they are.',
  'grantLink.expiryLabel': 'The link works for',
  'grantLink.expiry.1': '1 day',
  'grantLink.expiry.7': '7 days',
  'grantLink.expiry.30': '30 days',
  'grantLink.expiry.90': '90 days',
  'grantLink.expiry.180': '180 days',
  'grantLink.issue': 'Create grant link',
  'grantLink.issuing': 'Creating…',
  'grantLink.issued.once': 'Here it is — this is the only time it can be shown.',
  'grantLink.issued.urlLabel': 'The grant link',
  'grantLink.issued.until': 'It works until {date}.',
  'grantLink.issued.youSend':
    'Send it yourself; it cannot be shown again, so revoke and reissue if lost.',
  'grantLink.copy': 'Copy',
  'grantLink.copied': 'Copied',
  'grantLink.empty': 'No links yet for this migration.',
  'personLink.title': 'One grant link for everything',
  'personLink.blurb':
    'One link for all of this person’s Google accounts: they sign in to each once, and every migration that reads it is connected.',
  'personLink.empty': 'No link yet for this person.',
  'personLink.asksAgain':
    'Every Google account of theirs is connected, so this link asks them to connect each one again. Send it when a connection has stopped working.',
  'personLink.view.title': 'One progress link for everything',
  'personLink.view.blurb':
    'One page where this person follows all of their migrations, with no account, and can take back the access they gave.',
  'personLink.view.empty': 'No progress link yet for this person.',
  'grantLink.loadError': 'Could not read the links for this migration.',
  'grantLink.issuedBy': 'Issued {date} by {who}',
  'grantLink.issuedByGrant': 'Created {date}, when they gave access',
  'grantLink.worksUntil': 'Works until {date}.',
  'grantLink.grantedOn': 'Access was granted on {date}. This link is spent.',
  'grantLink.revokedOn': 'You revoked it on {date}.',
  'grantLink.expiredOn': 'Expired on {date} without being used.',
  'grantLink.expiredNudge':
    'Nobody got as far as granting access. Create another link and send it again.',
  'grantLink.revoke': 'Revoke',
  'grantLink.revokeArmed': 'Confirm revoke',
  // The link's OTHER lifetime (workplan 0122). Same panel, same revoke, and
  // its own words — the credential list's ("this link is spent") would be
  // wrong about a link that grants nothing and is never spent.
  'viewLink.title': 'Progress links',
  'viewLink.blurb': 'A page where they can watch their own migration, with no account.',
  'viewLink.why':
    'It carries counts and states only — never a folder, a file or a subject line — which is what makes a longer expiry safe. You send it yourself, and you can revoke it at any moment. A source that is not Google can have one too: it shows progress, it does not ask for a password.',
  'viewLink.issue': 'Create progress link',
  'viewLink.issued.urlLabel': 'The progress link',
  'viewLink.empty': 'No progress links yet for this migration.',
  'viewLink.expiredNudge': 'Their page has stopped working. Create another if they still need it.',
  // A migration's page, now that a link is the person's (ADR-0035, amended
  // 2026-09-29; the owner, 2026-10-03: "yes, replace the per-migration links").
  'migrationLinks.title': 'Links',
  'migrationLinks.perPerson': 'Grant and progress links are made per person: one for all of {name}’s migrations.',
  'migrationLinks.openPerson': 'Open {name}’s page',
  'migrationLinks.whoFor': 'Who is this for?',
  'migrationLinks.whoFor.why': 'Links are made per person, so first say who this migration is for.',
  'migrationLinks.whoFor.save': 'Save',
  'migrationLinks.peopleFailed': 'Could not read who this migration is for.',
  'migrationLinks.sent.grant': 'Grant links sent before',
  'migrationLinks.sent.view': 'Progress links sent before',
  'migrationLinks.sent.blurb': 'They work until they expire. Revoke one here if it should stop sooner.',
  'migrationLinks.sent.why':
    'Links are made per person now. One this migration was given before keeps working until it expires, so whoever holds it is not left with a link that fails.',
  // The migrator's page. Written for somebody with no account and no reason to
  // trust us, so: second person, no jargon, and nothing they have to look up.
  'grant.title': 'Connect your account',
  'grant.loading': 'One moment…',
  'grant.asking': '{organisation} is moving your account to a new provider, and needs your permission to read what is in it.',
  'grant.reads': 'You are about to give access to {reads}.',
  // What each data type reads, in the words a person would use about their
  // own account, joined into `grant.reads` as the page's language joins a list
  // (workplan 0145 T6). The server names the data types; the words are ours.
  'grant.reads.email': 'your email — messages, folders and labels',
  'grant.reads.calendar': 'your calendars and their events',
  'grant.reads.contact': 'your contacts',
  'grant.reads.file': 'your files in Google Drive',
  'grant.reads.task': 'your tasks',
  // Where from and where to (workplan 0108 T8a): what lets a person tell their
  // own migration from a stranger's, whose every other screen is genuine.
  'grant.company': 'Company',
  'grant.companyChecked': 'Checked in the EU VAT register (VIES).',
  'grant.askedBy': 'Asked by',
  'grant.phone': 'Phone',
  'grant.from': 'From',
  'grant.to': 'To',
  'grant.toWhere': '{provider} at {host}',
  'grant.check': 'Do you know who asked? Is the destination yours or your organisation’s? Only then continue.',
  'grant.readOnly':
    'Read-only. Nothing is ever deleted or changed in your account, and nobody — not the organisation, not Ownpace — ever sees your password. You sign in to Google yourself, on Google’s own page.',
  // "Read-only" only where Google enforces it (workplan 0144 T3 (c)): the box
  // above says it for Drive and Tasks, whose scopes Google holds to reading.
  // Every other grant gets this one, because Google's screen, one click later,
  // describes mail, calendars and contacts as allowing changes and deletion.
  'grant.readsOnly':
    'Ownpace only reads. Ownpace never deletes or changes anything in your account, and nobody — not the organisation, not Ownpace — ever sees your password. You sign in to Google yourself, on Google’s own page. Google may describe the permission more broadly: for mail, calendars and contacts, the permission Ownpace asks for also allows changes. Ownpace makes none.',
  'grant.scopeIntro': 'Google will record this permission as:',
  'grant.until': 'This link works until {date}.',
  // The account is a condition (0108 T8 (b)): what to sign in with, and why
  // Google also asks for their address.
  'grant.signInAs': 'Sign in as {account}. Google shares your address to confirm it; other accounts are refused.',
  // Above the button (workplan 0140 T3 (a)): a link sent by chat or mail opens
  // in that app's own browser, where Google is reported to refuse the consent.
  // Opening the link again elsewhere spends nothing (grant.ts), so it says so.
  'grant.inAppBrowser':
    'If this page opened inside another app, such as a chat or mail app, use that app\'s \'Open in browser\' option or copy the link into Safari or Chrome. The link still works.',
  'grant.connect': 'Continue with Google',
  // A person's link (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b)): one
  // card per Google account, each asked once.
  'grant.person.asking':
    '{organisation} is moving your accounts to a new provider, and needs your permission to read what is in them. Each account below asks once.',
  'grant.person.migration': 'To {where}: {reads}.',
  'grant.person.where': '{account}, {place}',
  'grant.person.connect': 'Continue with Google as {account}',
  'grant.person.connected': 'Connected. Nothing more is needed for this account.',
  'grant.person.again':
    'This account was connected before. Whoever sent this link asks you to connect it again, for instance because the connection stopped working.',
  'grant.person.connectAgain': 'Connect again with Google as {account}',
  'grant.connecting': 'Opening Google…',
  'grant.disclosure': 'By continuing you accept how your data is handled:',
  'grant.privacy': 'Privacy policy',
  'grant.terms': 'Terms',
  'grant.withdraw':
    'You can withdraw this access at any time: on the progress page you get once you have granted it, or in your Google account’s security settings, under the apps that have access.',
  // A failure on the grant or progress page that the server wrote no sentence
  // for (workplan 0145 T6, review): the page's own words, in its language,
  // rather than the transport's English or a parser's JSON. The server's own
  // refusals come in pairs from `@openmig/shared` and are not these.
  'link.unreachable': 'This page could not reach the server. Check your connection and try again.',
  'link.unreadable':
    'Something went wrong on this page. Try again later; if it keeps happening, please tell the person who sent you the link.',
  // An answer the page's schema refused, on a signed-in page (reported
  // 2026-09-29): `serverMessage` says this where it used to show zod's JSON,
  // most likely after the API and the web app were updated apart. {reference}
  // is the one the server keeps the report under, with where the answer did
  // not fit (`unreadable-answer.ts`). The owner's wording, both languages
  // (2026-09-29), and the owner's "Log it" for the reference.
  'answer.unreadable':
    'The server answered in a form this page does not know. Reload the page; if it stays like this, report it to support, and mention: reference {reference}.',
  // The site serves a newer build than the page on screen (workplan 0145):
  // most likely a deploy while the tab stayed open. The page never reloads by
  // itself, so the sentence says what a reload costs.
  'reload.newer':
    'A newer version of this page is available. Reload the page to use it; anything you have not saved yet is lost.',
  'reload.button': 'Reload the page',
  // The progress page (workplan 0122). The SAME reader as the grant page above
  // — no account, no jargon, second person — asking a different question:
  // has my mail arrived yet. So the states are sentences rather than the
  // operator's chips, and every count says what it counts.
  'view.title': 'Your migration',
  'view.loading': 'One moment…',
  'view.who': '{organisation} is moving your account to a new provider.',
  'view.state.active': 'Your things are being copied across now.',
  'view.state.paused': 'Copying is on hold at the moment.',
  'view.state.cutover': 'Your new account is now the one in use.',
  'view.state.done': 'Your migration is finished.',
  'view.state.continuous': 'Anything new is still copied across for you.',
  'view.notStarted': 'Nothing has been copied yet.',
  'view.notStarted.why':
    'Copying has not started, so there is nothing to count here yet. That is normal for the first day or two: a migration begins once everything it needs is connected, and this page fills in on its own once it does. Nothing is missing and nothing has gone wrong.',
  'view.copied.one': '{count} copied',
  'view.copied.many': '{count} copied',
  'view.upToDate': 'Up to date as of {date}.',
  'view.lastWorked': 'Still copying; last worked on {date}.',
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
  'view.failure.rateLimited': 'Your provider asked us to slow down. This carries on by itself.',
  'view.failure.quotaExceeded': 'A daily limit was reached. Copying resumes tomorrow on its own.',
  'view.failure.policyRefused':
    'Some items were left out by this migration\u2019s own settings, not by either account.',
  'view.failure.tooLarge':
    'Some files were left out: they are larger than this service copies during the alpha.',
  'view.failure.sourceRefused':
    'Your old account would not release some items. Nothing was sent to your new account.',
  'view.failure.targetRefused': 'Your new account would not accept some items.',
  'view.failure.formatRefused':
    'Your new account refuses some file types. Whoever set this up can change that.',
  'view.failure.network': 'A server could not be reached. This is usually brief and retries itself.',
  'view.failure.unknown': 'Something we could not put a name to. The person running this can see more.',
  'view.failure.side.source': 'It was your old account.',
  'view.failure.side.target': 'It was your new account.',
  'view.until': 'This page works until {date}.',
  'view.readOnly': 'This page only shows numbers; it holds nothing from your account.',
  // Taking the access back (workplan 0108 T8 (c)). The same reader and the same
  // words as the grant page: "access", given and withdrawn, second person.
  'view.state.withdrawn': 'Copying has stopped: on {date} you withdrew the access you gave.',
  'view.grant.title': 'The access you gave',
  'view.grant.body': '{organisation} reads your Google account for this migration because you allowed it.',
  'view.grant.whatHappens': 'Withdrawing stops the copying. What was already copied stays where it was copied to.',
  'view.grant.wholeApp': 'Google withdraws it for the whole app, so any other migration you allowed stops too.',
  'view.grant.withdraw': 'Withdraw access',
  'view.grant.confirm': 'Withdraw it now? Continuing later needs a new link from whoever sent this one.',
  'view.grant.confirmYes': 'Yes, withdraw it',
  'view.grant.keep': 'Keep it',
  'view.grant.withdrawing': 'Withdrawing…',
  'view.withdrawn.revoked': 'Done. Google confirmed the access is withdrawn, and it is deleted here as well.',
  'view.withdrawn.notConfirmed': 'Deleted here, so this migration cannot use it. Google did not confirm withdrawing it.',
  'view.withdrawn.removeYourself': 'To be sure, remove the app yourself from the apps with access:',
  'view.withdrawn.since': 'Nothing more is read from your account. To continue later, ask for a new link.',
  'view.withdrawn.check': 'Your Google account lists the apps that still have access:',
  // A PERSON'S progress page (ADR-0035, amended 2026-09-29; 0153 T5 (b), slice 3).
  'view.person.title': 'Your migrations',
  'view.person.who': '{organisation} is moving your accounts to new providers. Here is where each migration stands.',
  'view.person.none': 'There are no migrations here yet.',
  'view.person.account.only': 'Your Google account',
  'view.person.account': 'Google account {n}',
  'view.person.others': 'Your other migrations',
  'view.person.route': '{from} to {to}',
  'view.person.grant.body': '{organisation} reads this Google account for the migrations above because you allowed it.',
  'view.person.withdrawn.notConfirmed':
    'Deleted here, so these migrations cannot use it. Google did not confirm withdrawing it.',
  // Report this link (workplan 0108 T8 (d)): on the grant and progress pages,
  // to the owner's helpdesk, never to the organisation that asked.
  'linkReport.open': 'Report this link',
  'linkReport.intro': 'Your report goes to the Ownpace team, not to {organisation}.',
  'linkReport.description': 'What makes you doubt this link?',
  'linkReport.replyTo': 'Your email address (optional)',
  'linkReport.replyTo.hint': 'Only if you want an answer; we use it for nothing else.',
  'linkReport.sentWith':
    'Sent with it, from our records: which link this is; the organisation and the migration it belongs to, with the state of the migration; the address of whoever made the link; the account the migration copies from and the account it copies to; and whether you have given access.',
  'linkReport.send': 'Send the report',
  'linkReport.sending': 'Sending…',
  'linkReport.sent': 'Sent. Your report is number {ticket}, and we will reply to {email}.',
  'linkReport.sent.anonymous': 'Sent. Your report is number {ticket}. Without an address, we cannot answer you.',
  'linkReport.sent.mail': 'Sent to our support team, with report reference {reference}. We will reply by email to {email}.',
  'linkReport.sent.mail.anonymous':
    'Sent to our support team, with report reference {reference}. Without an address, we cannot answer you.',
  'linkReport.next.grant': 'You need not continue: nothing is read unless you allow it at Google.',
  'linkReport.next.withdraw': 'To stop the copying now, withdraw the access above.',
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
  'state.invoice.draft': 'Draft',
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
  'queue.waitingOnYou': 'Waiting on you',
  'queue.alreadyDecided': 'Already decided',
  'moves.title': 'Moved on the old system',
  'moves.intro':
    'Items the owner filed elsewhere since the copy; nothing has changed on either side.',
  'moves.intro.more': 'The new system still has them where we put them; each row is your call.',
  'moves.empty.open': 'Nothing has moved.',
  'moves.empty.acknowledged': 'Nothing has been decided yet.',
  'moves.keep': 'Leave it where it is',
  'moves.apply': 'Remove the old copy',
  'moves.applyArmed': 'Confirm removal',
  'moves.renamedTo': 'renamed',
  'failures.title': 'Could not be copied',
  'failures.intro': 'Items that did not make it across, what went wrong, and how often we tried.',
  'failures.empty.needsDecision': 'Nothing is waiting on a decision.',
  'failures.acceptedLeave':
    'Accepted items no longer appear here; migration continues without them, no longer counted as failed.',
  'failures.seeRuns': 'See the pass that failed (run history)',
  'failures.stillTrying': 'Still trying',
  'failures.empty.retrying': 'Nothing is being retried.',
  'failures.retry': 'Try again',
  'failures.retryCost':
    'Retrying re-lists everything to reach this item again, so the next pass takes longer.',
  'failures.retryCost.why':
    'It clears this migration’s sync cursors, so the whole source is listed again; nothing already copied is copied twice.',
  'failures.accept': 'Migrate without it',
  'failures.acceptAll': 'Migrate without all of these ({count})',
  'failures.group.title': 'Decide a whole group at once',
  'failures.group.hint': 'A connector fixed since these parked will not unpark them by itself.',
  'failures.group.hint.why':
    'Being parked is a stored count of attempts, so deploying a fix does not lower it — the items sit there while the migration reports itself complete. Pick a kind, or type part of the error the items share, and this decides all of them in one go: a retry also clears this migration’s sync cursors once, which is what puts the items back in front of the next pass. The wording is matched literally, so a % or an _ in what you type means a % or an _.',
  // THE GROUPS, READ OFF THE ROWS (the owner, 2026-09-17: *"why now detail
  // groups that share sumilarities and offer those to pick from to do bulk
  // actions?"*). Typing a substring describes a group somebody has already
  // worked out; these are the ones the queue announces about itself.
  'failures.group.found': 'Groups in this queue',
  'failures.group.items.one': '1 item',
  'failures.group.items.many': '{count} items',
  'failures.group.stillTrying.one': '1 still trying',
  'failures.group.stillTrying.many': '{count} still trying',
  'failures.group.noCategory': 'No kind of failure recorded',
  'failures.group.noCategory.why':
    'These items failed before this deployment stored a failure kind on each one. The next attempt on them records it, and they join a group. Until then they can be decided one at a time, or by the error text below.',
  'failures.group.manual': 'Match on the error text instead',
  'failures.group.domain': 'Kind',
  'failures.group.domain.any': 'Any kind',
  'failures.group.error': 'Error contains',
  'failures.group.error.placeholder': 'MKCOL',
  'failures.group.matches': 'Matches {count} of the {total} here.',
  'failures.group.needsNarrowing': 'Pick a kind, or type part of the error, first.',
  'failures.group.retry': 'Try all of these again',
  'failures.group.accept': 'Migrate without all of these',
  'failures.try.one': 'try',
  'failures.try.many': 'tries',
  // A parked item was tried ONCE and then set aside for a person, so printing
  // its attempt count as a try total claims attempts that never happened —
  // which is what an owner read on 2026-09-14 as "5 tries" against their
  // Google account for a setting they had chosen. Said instead of the count,
  // never beside it: two numbers where one is meaningless is worse.
  'failures.parked': 'waiting on you',
  'deletions.title': 'Deleted on the old system',
  'deletions.intro':
    'Items the owner deleted at the source; the new system still has them, untouched.',
  'deletions.empty.confirmed': 'Nothing is waiting on a decision.',
  'deletions.watching': 'Watching',
  'deletions.empty.watching': 'Nothing is being watched.',
  'deletions.empty.acknowledged': 'Nothing has been decided yet.',
  'deletions.keep': 'Keep our copy',
  'deletions.apply': 'Delete it here too',
  'deletions.applyArmed': 'Confirm delete',
  // Copies an earlier export policy left (workplan 0042 T8 (b), second half):
  // on this screen, and never called a deletion.
  'deletions.earlierExports': 'Earlier exports',
  'deletions.earlierExports.intro':
    'Copies an earlier export format left. The documents were not deleted in Google.',
  'deletions.earlierExport.badge': 'earlier export',
  'deletions.earlierExport.badgeTitle': 'Exported again under its new name; this is the old copy.',
  'common.loading': 'Loading…',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'docs.title': 'Setup guides',
  'docs.all': '← All setup guides',
  'docs.notFound': 'There is no guide by that name; these ship with this version:',
  // Workplan 0148 T4: a guide not yet written in the reader's language is
  // shown in the other one, under this line, in the reader's own.
  'docs.otherLanguage': 'This guide is not yet available in English; the Dutch version follows.',
  // Workplan 0148 D9: the appliance's index only. Its owner runs it, and the
  // operator material the guides stopped carrying is in the repository. The
  // plan's wording, one word shorter to fit 0118's fifteen-word line.
  'docs.operatorDocs':
    'Running your own appliance? Settings and commands are in the operator documents in the repository.',
  // Workplan 0148 T2 (c): the fold over a guide's own-app section, closed
  // where this service carries the provider's app.
  'docs.ownAppFold': 'Only if you want to use your own app',
  'mappings.lastSync': 'Last sync:',
  'mappings.never': 'Never',
  'mappings.filtered.lead': 'Showing only:',
  'mappings.filtered.clear': 'Show all migrations',
  'mappings.loadFailed': 'Could not load the migrations list.',
  'mappings.syncFailed': 'The sync request did not complete.',
  // The people being moved (ADR-0050, 0153 T3). A person on screen is their
  // name; the grouping has no noun (D6). "Needs you" is the approved family
  // (0153 T6 (b)).
  'people.count.one': '1 person',
  'people.count.many': '{n} people',
  'people.needYou.one': '1 needs you',
  'people.needYou.many': '{n} need you',
  'people.fromTo': 'From {from} to {to}',
  'people.needsYou': 'Needs you: {n}',
  'people.needsUnknown': 'Could not count what needs you.',
  'people.implicit': 'Your migrations',
  'people.addMigration': 'Add a migration',
  'people.noneYet': 'Nothing for this person yet.',
  'people.lastPass': 'Last pass {when}',
  'people.noPassYet': 'No pass yet',
  // THE SENTENCE UNDER A DATA TYPE'S STAGE (0154 T1 (b)), after its count:
  // *18,234 of ~19,000 · last pass 2 minutes ago*. *Pass* is the
  // glossary's word for a round of copying; *the check* is the verification,
  // as the menu's *Check* names it, and the two are kept apart.
  // An export's line before it starts (0153 open question 5, item 2).
  'people.line.waitsForExport': 'Waiting for the Takeout export',
  'people.line.howToExport': 'how to make one',
  'people.line.lastPass': 'last pass {when}',
  // What the count leaves out, short: its meaning is on the migration's page.
  'people.line.leftAsIs': '{count} left as they are',
  'people.line.checkPassed': 'The check passed {when}',
  'people.loadFailed': 'Could not load who each migration is for.',
  'people.unassigned.title': 'Not with a person yet',
  'people.unassigned.hint': 'Add each to the person it is for; it joins their card.',
  'people.addTo': 'Add to',
  'people.addTo.submit': 'Add',
  'people.addTo.failed': 'The migration was not added.',
  'people.notAdded': 'The migration was made, but not added to the person.',
  'people.notAdded.where': 'Migrations lists it under Not with a person yet, where one press adds it.',
  'people.new.title': 'Add a person',
  'people.new.name': 'Name',
  'people.new.email': 'Email address, for a grant link (optional)',
  'people.new.submit': 'Add person',
  'people.new.failed': 'The person was not added.',
  // Start a migration (0153 T4): who it is for, which accounts are left,
  // what moves, connecting, where it goes, and one screen that checks and starts.
  'start.step': 'Step {n} of {total}',
  'start.who.heading': 'Who is it for?',
  'start.who.someoneNew': 'Someone new',
  'start.who.whose': 'Who signs in to the accounts?',
  'start.who.myself': 'I do',
  'start.who.someoneElse': 'They do, with a link',
  'start.who.someoneElse.line':
    'They connect a Google account themselves, so you never hold that password. Other providers you sign in to together.',
  'start.who.needName': 'Type a name first.',
  'start.who.peopleFailed': 'The people you migrate for could not be read. A new name still works.',
  'start.from.heading': 'Which account are you leaving?',
  'start.from.hint': 'Tick each one you are leaving.',
  'start.from.otherMail': 'Another mail provider',
  'start.from.otherMail.inSentence': 'another mail provider',
  'start.from.needOne': 'Tick at least one account.',
  // OTHER WAYS TO CONNECT, without the wizard (0153 open question 5): IMAP
  // is the one source protocol; CalDAV, CardDAV, WebDAV and JMAP are where
  // things go, and this fold promised them as sources.
  'start.from.other': 'Other ways to connect (IMAP)',
  'start.from.other.line':
    'Any mail server is read over IMAP: that is Another mail provider. CalDAV, CardDAV, WebDAV and JMAP are where things go, chosen on Where does it go?',
  'start.from.other.choose': 'Choose Another mail provider',
  'start.byHand': 'Add one migration by hand',
  'start.what.heading': 'What moves?',
  'start.what.hint': 'Each sign-in asks only for what you tick here.',
  'start.what.from': 'From {provider}',
  'start.what.notFrom': 'Not from {provider}: {types}.',
  'start.what.notFrom.apple.why': 'Apple offers no way into iCloud Drive for anyone outside Apple.',
  'start.what.notFrom.imap.why':
    "Over IMAP only mail is read: a mail provider's calendar and contacts have no way in here yet.",
  'start.what.needOne': 'Tick at least one thing to move.',
  'start.what.photos': 'Photos',
  // A PROVIDER'S EXPORT UNDER ITS TILE (0153 open question 5, item 2): a tick
  // box where this build reads it, a line where it does not (0148 D7).
  'start.what.export.google-takeout': 'Photos: from a Takeout export',
  'start.what.export.apple-privacy': "iCloud Drive and photos: from Apple's export",
  'start.what.export.google-takeout.line':
    'You ask Google for the export yourself, and put it in your new files when it arrives.',
  'start.what.export.google-takeout.why':
    'Google lets other apps read only the photos they uploaded themselves, so its export is the one way to a whole library.',
  'start.what.export.askNow': 'It can take a few days to prepare, so ask for it now:',
  'start.connect.heading': 'Connect your accounts',
  'start.connect.googleApart': 'Google asks for mail and files apart on this service, so this takes {n} sign-ins.',
  'start.connect.asks': 'One sign-in: {types}',
  'start.connect.check': 'Check the sign-in',
  'start.connect.as': 'Connected as {account}',
  'start.connect.which': 'Which {provider} account',
  'start.connect.another': 'Another account',
  'start.connect.errored': 'Its last check did not pass.',
  'start.connect.tryAgain': 'Try again',
  'start.connect.needAll': 'Connect each account first.',
  'start.connect.together': 'No link reaches {provider}: sign in together with {person}.',
  'start.connect.byLink': '{person} connects it themselves, with a link you make on the last screen.',
  'start.connect.byLinkFor': 'By link: {account}',
  'start.connect.theirAddress': 'Their address at {provider}',
  'start.connect.saveAddress': 'Save the address',
  'start.connect.addressNeeded': 'Type their address first.',
  'start.connect.exportNoSignIn': 'Photos need no sign-in: they come from the Takeout export.',
  'start.accountsFailed': 'Your saved accounts could not be read. A new account still works.',
  'start.to.row': 'Where {type} goes',
  'start.to.yours': 'Your accounts',
  'start.to.new': 'A new account',
  'start.to.add': 'Add {provider}',
  'start.to.doesNotTake': '{provider} does not take {type}.',
  'start.to.needAll': 'Add each new account first.',
  'start.to.settingUp': 'Setting up…',
  'start.to.failed': 'Not set up: {migration}.',
  'start.to.exportFolder': 'Read from the folder {folder} in these files, once the export is put there.',
  // WHERE THE COPIES LAND, per migration (0153 open question 5, item 4).
  'start.to.lands': 'Where the copies land',
  'start.to.ownFolder': 'Put it in a folder of its own',
  'start.to.ownFolder.label': 'Folder',
  'start.to.ownFolder.hint': "Left empty, the copies go into the account's own folders.",
  'start.to.ownFolder.shared': 'Another migration sends the same kind of data here, so each gets a folder of its own.',
  'start.migrationName': '{person} — {provider} to {destination}',
  'start.check.intro': 'Set up and paused: nothing is copied before Start.',
  'start.check.route': '{types}: {from} → {to}',
  'start.check.start': 'Start',
  'start.check.waits': 'You can start once every count is in and each tick it asks for is ticked.',
  'start.check.waitsFor':
    'Waiting for {person} to connect. Make a link below and send it yourself: it is shown once. The count appears here once they have connected.',
  'start.check.waitsForLink': 'Its count appears here once {person} has connected through the link above.',
  'start.check.startsWhenGranted': 'Once you have started the others, it starts by itself when {person} connects.',
  'start.check.waitsForACount': 'You can start once {person} has connected and a count is in.',
  // AN EXPORT'S MIGRATION, SET UP AND WAITING (0153 open question 5, item 2).
  'start.check.export.waits': 'Set up, and waiting for the Takeout export:',
  'start.check.export.ask': 'Ask Google for it, with only Google Photos ticked:',
  'start.check.export.put':
    'When it arrives, put its .zip files, as Google sends them, in the folder {folder} of {destination}.',
  'start.check.export.start': 'Then start it on its page, with Review and start: it counts the export first.',
  'start.check.export.guide': 'Asking for a Takeout, step by step',
  'start.check.done': 'Done',
  'start.check.later':
    "You can close this page. {person}'s page keeps these migrations: once they have connected, start each one from its Details.",
  'start.company.question': 'Is this a company account with an administrator?',
  'start.company.no': 'No',
  'start.company.yes': 'Yes',
  'start.what.orgApp.lead':
    "Your administrator can have the mail read through your organisation's own app, with application permissions. That is also how a shared mailbox is read.",
  'start.what.orgApp.signIn': 'With the Microsoft sign-in',
  'start.what.orgApp.graph': 'Through our own app, with Microsoft Graph',
  'start.what.orgApp.imap': 'Through our own app, with IMAP',
  'start.moreOptions': 'More options',
  'start.appPassword': 'Use an app password instead',
  'start.serverSettings': 'Server settings',
  'start.serverSettings.filled': 'Server settings (filled in for {provider})',
  'start.to.nextcloudAddress': "Your Nextcloud's address",
  'start.to.nextcloudAddress.placeholder': 'cloud.example.eu',
  'start.to.nextcloudAddress.hint': 'The address you open Nextcloud at in your browser.',
  'start.to.heading': 'Where does it go?',
  'start.check.heading': 'Check, then start',
  // A person's page (0153 T5): their migrations, and the steps before they
  // switch as one list (0154 T4). The steps keep the hub's names (hub.*).
  'person.back': '← Migrations',
  'person.notFound': 'There is no such person here.',
  'person.loadFailed': 'Could not load this person.',
  'person.details': 'Details',
  // An appliance migration whose file gives it no name (0153 T8), called by where it goes.
  'person.rowName': '{from} to {to}',
  // A migration that waits for their grant, and what the grant does to it
  // when it lands (start when granted, per person; the owner, 2026-10-03).
  'person.awaiting.startsByItself':
    'Waits for {name} to connect, then starts by itself: another migration of theirs has been started.',
  'person.awaiting.reviewAndStart': 'Waits for {name} to connect. Once they have, open Details to review and start it.',
  'person.awaiting.ranBefore': 'Waits for {name} to connect again.',
  'person.awaiting.unread': 'Which of these wait for {name} to connect could not be read.',
  'person.links.title': 'For {name}',
  'person.steps.title': 'Before you switch',
  'person.steps.hint': 'Each step, summed across this person’s migrations.',
  'person.state.done': 'Done',
  'person.state.needsYou': 'Needs you',
  'person.state.notYet': 'Not yet',
  'person.step.none': 'None',
  'person.step.unread': 'Could not be read',
  // A migration's own link under a queue's step, when its count could not be read.
  'person.step.linkUnread': '{name} (could not be read)',
  'person.step.deletions': '{n} to decide',
  'person.step.moves': '{n} reported',
  'person.step.failures.one': '1 could not be copied',
  'person.step.failures.many': '{n} could not be copied',
  'person.step.sharing': '{n} to go through',
  'person.step.check.passed': 'Passed',
  'person.step.check.partly': 'Passed for {n} of {total}',
  'person.step.check.notYet': 'Not passed yet',
  'person.step.check.notRun': 'Not run yet',
  'person.step.check.running': 'Running now',
  'person.step.check.couldNotRun': 'Could not run {when}',
  'person.step.check.notPassedWhen': 'Did not pass {when}',
  'person.step.check.passedWhen': 'Passed {when}',
  'person.step.confirmed.notYet': 'After the check',
  'person.step.confirmed.done': 'Ready to read',
  'person.step.finish.notYet': 'Switch mail delivery, then end',
  'person.step.finish.done': 'Finished',
  'createMapping.createFailed':
    'Not created; your entries are still here, so fix what the message names and retry.',
  'billing.usageLoadFailed': 'Could not load the usage numbers.',
  'billing.pay': 'Pay',
  'billing.payFailed': 'The payment could not be started.',
  'billing.usagePeriod': 'Usage for',
  'billing.asOf': 'as of',
  'billing.noPaymentMethods': 'No payment methods stored.',
  'billing.paymentMethodsLoadFailed': 'Could not load the payment methods.',
  'billing.default': 'Default',
  'billing.adminOnly':
    'Billing is available to owners and admins only; ask one for usage or invoice details.',
  'billing.invoicesLoadFailed': 'Could not load the invoices.',
  'billing.party.title': 'Invoice details',
  'billing.party.intro': 'Who invoices are addressed to.',
  'billing.party.missing':
    'Not provided yet. Invoices cannot be issued until this is filled in.',
  'billing.party.notNeeded': 'Not needed while your tier is free: nothing is invoiced.',
  'billing.party.kindConsumer': 'Private person',
  'billing.party.kindBusiness': 'Business',
  'billing.party.name': 'Name on the invoice',
  'billing.party.addressLine1': 'Address',
  'billing.party.addressLine2': 'Address line 2 (optional)',
  'billing.party.postalCode': 'Postal code',
  'billing.party.city': 'City',
  'billing.party.country': 'Country',
  'billing.party.vatNumber': 'VAT number (optional)',
  'billing.party.save': 'Save',
  'billing.party.saved': 'Saved.',
  'billing.party.saveFailed': 'Saving failed.',
  'billing.party.loadFailed': 'Could not load the invoice details.',
  'billing.party.vat.notChecked': 'This VAT number has not been checked against VIES.',
  'billing.party.vat.checkNow': 'Check with VIES',
  'billing.party.vat.checking': 'Asking VIES…',
  'billing.party.vat.valid': 'VIES confirmed this number on {date}.',
  'billing.party.vat.invalid': 'VIES says this number is not valid (checked {date}).',
  'billing.party.vat.registeredTo': 'Registered to: {name}',
  'billing.party.vat.consultationNumber': 'Consultation number: {number}',
  'billing.party.vat.unqualified':
    'No consultation number — the check ran without the seller’s own VAT number configured.',
  'billing.party.vat.checkFailed': 'The check did not run.',
  'billing.party.vat.treatmentLabel': 'VAT on your invoices:',
  'billing.party.vat.treatment.domestic': 'Invoices will include VAT at the standard rate.',
  'billing.party.vat.treatment.reverseCharge':
    'Reverse charge: invoices carry no VAT; your business accounts for it in its own country.',
  'billing.party.vat.treatment.oss':
    'Invoices will include your own country’s VAT rate (One Stop Shop).',
  'billing.party.vat.treatment.outsideEu':
    'Outside the EU VAT area; how invoices are taxed is settled before the first invoice.',
  'confirm.nextSteps': 'Next, in cutover order:',
  'confirm.title': 'Review & confirm your migration',
  'confirm.intro': 'Nothing has been copied yet. Review what will migrate, then start it.',
  'confirm.readError': 'Could not read the migrations.',
  'confirm.noMappings': 'No mappings configured.',
  'confirm.noMappings.how': 'The appliance reads mappings from JSON files in its config directory.',
  'confirm.noMappings.more':
    'On Docker that is the mounted config folder; on Windows C:\\ProgramData\\OpenMigrate\\config. Copy mapping.json.example, fill in your source and target, reference secrets by environment-variable name, and restart the appliance: it reads the directory once at start. The full walkthrough is docs/selfhost-quickstart.md, step 3.',
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
    'Migrations here have started. Live progress is per migration; the scan stays as a snapshot.',
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
    'Not migrated: larger than this service copies during the alpha. Copy these files by hand, or leave them behind.',
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
    'Not migrated: the old account would not hand this over, so nothing was sent to the new one \u2014 there is nothing to check there. Try again if that has changed, or leave these items behind.',
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
    'Every screen you open here is logged against your name, and customers can see that.',
  'support.recorded.why':
    'The support read log records the organisation and the time with each screen, and customers can be shown that record.',
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
    'This is the drain: the sync tick stops enqueueing within a minute, and whatever is mid-pass finishes normally. Every signed-in customer sees a notice with your message on it, or a default sentence when you leave the box empty. Your message is also the answer, word for word, to every button that would start work while the hold is on (\'Trigger sync\', \'Start migration\', a check), and a refused press is not remembered. So say when copying resumes and ask them to try again after that, for example: \'We are updating the platform and copying resumes around 15:00. Nothing starts until then. Please try again after that.\' Lifting the hold starts the scheduled passes again on the next tick.',
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
  'support.platform.page.unreachable':
    'The status page did not answer; on a stack that has one, that is news.',
  'support.platform.unread': 'The platform status could not be read.',
  'support.platform.checked': 'Checked {when}.',
  'support.noDomains': 'Nothing has run yet.',
  'support.waiting.none': 'Nothing is waiting on them.',
  'support.waiting.some':
    'Decisions are waiting on this customer; their own screen says which, this one only counts.',
  'support.noFourthLevel':
    'There is no screen below this one; items would be subject lines, where support stops.',
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
  'support.usage.beyondTable': 'Beyond the published table — a talk-to-us size.',
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
  'support.usage.data': 'Data moved (first copies)',
  'support.usage.note':
    'The higher axis decides; a future invoice uses this same derivation, and looking changes nothing.',
  'support.usage.why':
    'Paths running at the same time, or data moved since the start: first copies only, and a paused path keeps its slot.',
  // What an erasure kept, and could not be read until there was a screen.
  'support.retained.link': 'Invoices kept after an erasure',
  'support.retained.heading': 'Invoices kept after an erasure',
  'support.retained.why':
    'When an organisation is erased its invoices are kept on purpose — tax retention ' +
    'outlives the customer relationship — and detached from the organisation. They ' +
    'belong to no tenant, so no organisation page can show them. This is where they ' +
    'are. The reference is a one-way hash of the erased id, shown so that invoices ' +
    'from the same erasure can be seen to belong together; it does not lead back to ' +
    'anybody.',
  'support.retained.none': 'No invoices have been kept — nothing has been erased yet.',
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
  // The appliance's own log page (0129 D5): the same page, for its owner, and
  // nothing recorded about reading it.
  'log.lead.why':
    'What an audit event changed is not shown here: it stays in the database, for an investigation to query. The text of an error stays in the appliance\u2019s output, on the line with the same reference.',
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
    'These were already on the new system, or have been changed there since, so they were left exactly as they are. Nothing was copied over them and nothing was lost: this tool never overwrites what it did not write. They are counted here rather than among the copies because nothing happened to them — which is the point.',
  // When a pass last touched this data type — NOT when it last finished.
  // A first copy that runs for two days used to show no time at all, because
  // every time on these screens came from a completion. A migration that is
  // working must never look like one that has died.
  'confirm.progress.lastActive': 'last active',
  // A data type switched off after copying (0125 T7). Said, because silence
  // is what was wrong: its copies stopped following the source without a word.
  'confirm.progress.stopped': 'Switched off: these copies stay, but no longer follow the source.',
  'confirm.progress.stopped.why':
    'Nothing was removed. The copies and their record stay where they are, as they were when it stopped. Switching it back on continues where it stopped: new items are copied, edits are picked up, and deletions at the source are reported.',
  // One its owner stopped (0128 T4): the same state, and Resume is the way back.
  'confirm.progress.stoppedByYou': 'Stopped by you: these copies stay, but no longer follow the source until resumed.',
  'confirm.progress.stoppedByYou.why':
    'Nothing was removed. The copies and their record stay as they were when you stopped it. Resuming it, on the migration\'s page, continues where it stopped: new items are copied, edits are picked up, and deletions at the source are reported.',
  // One state, three reasons (see pause-reason.ts). The word is the same
  // wherever it appears; the sentence under it says which of the three.
  'pause.label': 'Paused',
  'pause.ceiling':
    '{provider} reached its daily download limit. Copying continues after {resets}.',
  // Same fact, no window to name: the meter reported no running window, and
  // inventing a time would be worse than saying "when it resets".
  'pause.ceiling.unknown':
    '{provider} reached its daily download limit. Copying continues when that resets.',
  'pause.ceiling.why':
    'The limit belongs to your old provider, not to us. Passing it can lock you out of your own live mailbox for about a day, so copying stops before that happens. Nothing has failed and nothing is lost — the next pass carries on from exactly where this one stopped.',
  // The data ceiling (workplan 0109 T6): new first copies wait for the
  // customer's yes; updates carry on. Said with both prices (ADR-0014).
  // The ceiling said at Start (workplan 0109 T6): the preflight's measure and
  // the data already moved, against the ceiling. A note; it never blocks.
  'ceiling.atStart':
    'What these migrations hold, about {size}, and the {moved} already moved pass your data ceiling of {ceiling}.',
  'ceiling.atStart.holds':
    'At the ceiling, new items wait until you choose a way on; changes to what is already copied carry on.',
  'ceiling.atStart.choose': 'Choose now, or start anyway and choose when they wait:',
  'ceiling.atStart.billing': 'your data ceiling on the Billing page',
  'ceiling.atStart.alpha': 'During the alpha nothing waits at the ceiling and nothing is charged.',
  'pause.dataCeiling':
    'New items wait at your data ceiling of {ceiling}: {held} not copied yet. Changes to what is already copied carry on.',
  'pause.dataCeiling.moveUp': 'Move up to {tier}: €{setup} once, then €{monthly} a month.',
  'pause.dataCeiling.topUp': 'Or buy another {band} once, for €{price}.',
  'pause.dataCeiling.why':
    'Every step up is your choice: nothing moves your tier or adds room without your yes. Choose on the Billing page, and copying carries on from where it stopped.',
  'pause.hold.heading': 'Copying is paused',
  // The DEFAULT sentence: always present, so a hold is never wordless when
  // nobody typed one. An operator's own words replace it, verbatim.
  'pause.hold.default': 'We have paused copying while we update the platform.',
  'pause.hold.since': 'Paused since',
  // "By itself" is said of the SCHEDULED passes only (0132 T6 (b)): a button
  // pressed during the hold is refused with the operator's sentence and not
  // remembered, so nothing restarts it.
  'pause.hold.why':
    'Nothing is wrong with your migration and nothing is lost. Migrations already running finish normally, and scheduled copying starts again by itself once the update is done, from exactly where it stopped. Any copying you tried to start during the pause did not start: start it again after the update.',
  // The alpha note (workplan 0131 T1): four sentences, one paragraph, the
  // same words as the access-granted mail (`grantedAlpha` in @openmig/shared's
  // notifications.ts; `an-alpha-said-out-loud.unit.test.tsx` holds the two
  // together). Split into three keys; they render as one paragraph. The copy
  // before an update is the Alpha conditions §6 and privacy §9 (0139 T4,
  // ops-app-sentences (a); it said "nothing is backed up" until then).
  // `what-the-app-says.unit.test.tsx`.
  'alpha.note.lead': 'Alpha: a small invited group is trying this service out.',
  'alpha.note.terms':
    'Nothing is charged, and the alpha can end. There are no backups, apart from one copy before each update, kept up to 7 days.',
  'alpha.note.keep': 'Keep your old account until you have checked what arrived.',
  // Nothing charged (workplan 0131 T3): the first sentence of the Billing
  // line that takes the subtitle's place, and the last sentence of the
  // request form's package hint. One key, so the two cannot drift apart.
  // "Charged", as the note says it, and not "invoiced", which is what a tier
  // says (0109 T8).
  'alpha.nothingCharged': 'Nothing is charged during the alpha.',
  // A person to write to (workplan 0144 T6 (a)), in §3's words. `{address}` is
  // the deployment's VITE_SUPPORT_EMAIL, drawn as a mailto: link where it
  // stands (`SupportLine.tsx`); without it neither is shown. `help.line` goes
  // on the pages before sign-in. `help.sidebar` goes in the sidebar, where
  // *Report a problem* would be, while the report form is off.
  'help.line': 'Stuck? Mail {address} and name the page you are on. Never send a password.',
  'help.sidebar': 'Help: {address}',
  'confirm.snapshot.heading': 'Pre-start scan (snapshot)',
  'confirm.snapshot.more':
    'Counted once, before the start, to show what would migrate. The source keeps changing afterwards and these numbers do not update; live progress above is the ledger speaking.',
  'confirm.state.pending': 'Pending',
  'confirm.state.in_progress': 'Syncing',
  'confirm.state.completed': 'Completed',
  'confirm.state.failed': 'Failed',
  'confirm.state.skipped': 'Skipped',
  'confirm.state.stopped': 'Stopped',
  'confirm.foundInSource': 'What we found in your source',
  'confirm.starting': 'Starting…',
  'verify.title': 'Check the migration',
  'verify.intro':
    'Compares old against new and samples contents; read-only, it never writes to either side.',
  'verify.run': 'Run the check',
  'verify.runAgain': 'Check again',
  'verify.durationHint': 'Reads the whole destination — on a large mailbox this takes minutes.',
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
  // The confirmed list (workplan 0117 T2, D10) — the page somebody deletes
  // their originals on the strength of. The state words are deliberately not
  // a scale: see `confirmed-list.ts`, which argues they are different
  // questions, and a list that renders any two of them alike is a list
  // somebody empties the wrong folder on.
  'confirmed.title': 'What is confirmed in your new home',
  'confirmed.intro':
    'Re-reads each item on the destination and says what the check actually compared.',
  'confirmed.check': 'Check the destination',
  'confirmed.export': 'Download the full list',
  'confirmed.durationHint':
    'Reads the destination item by item — on a large account this takes minutes.',
  'confirmed.applianceScope': 'On this appliance a check covers every configured migration.',
  'confirmed.joined': 'A check was already running; this joined it.',
  'confirmed.loading': 'Reading the list…',
  'confirmed.couldNotRead': 'The list could not be read.',
  'confirmed.neverRun': 'No check has run yet, so nothing is confirmed.',
  'confirmed.running': 'Checking since',
  'confirmed.checkedAt': 'Checked',
  'confirmed.passFailed': 'The check stopped at',
  'confirmed.passStopped.closed': 'This organisation was closed, so the check stopped at',
  'confirmed.paused': 'Only part of the account was checked:',
  'confirmed.nothingYet': 'This migration has no items yet.',
  'confirmed.allVerified': 'Every item was re-read and matched. Nothing needs your attention.',
  'confirmed.headline.of': 'of',
  // WHAT THE NUMBER COUNTS, not where the items are (owner, 2026-09-17). It
  // read "items are in your new home, verified by hash" — two claims in one
  // sentence, and the first was wrong whenever the second was: six thousand of
  // the owner's items WERE in his new home, as copies he already had, and the
  // page led with a nought. The headline is the hash claim now, and
  // `confirmed.breakdown` below says where everything else stands.
  'confirmed.headline.rest': 'items in your new home are verified by hash.',
  'confirmed.breakdown': 'The rest of the account:',
  // CHECKED, not verified: the pass has walked this many items, of which the
  // headline above claims only the ones the target confirmed. Two numbers
  // that differ on purpose, and a reader who is told which is which.
  'confirmed.checked.of': 'of',
  'confirmed.checked.rest': 'checked so far',
  'confirmed.truncated.a': 'Showing the first',
  'confirmed.truncated.b': 'rows. The download has every one of them.',
  'confirmed.noKey': 'name not recorded',
  'confirmed.noKey.hover': 'Recorded only since 12 September 2026; a later pass fills this in.',
  'confirmed.col.domain': 'Type',
  'confirmed.col.collection': 'Where',
  'confirmed.col.item': 'Item',
  'confirmed.col.state': 'Result',
  'confirmed.col.claim': 'Compared',
  'confirmed.col.when': 'Checked',
  'confirmed.state.verified': 'Verified',
  'confirmed.state.differs': 'Differs',
  'confirmed.state.present': 'Present',
  'confirmed.state.yours': 'Yours already',
  'confirmed.state.missing': 'Missing',
  'confirmed.state.neverPlaced': 'Never placed',
  'confirmed.state.removed': 'Removed',
  'confirmed.state.unchecked': 'Not checked',
  'confirmed.help.verified': 'Re-read from the destination and it matched what we wrote.',
  'confirmed.help.differs':
    'Re-read from the destination and it did not match. Worth looking at.',
  'confirmed.help.present':
    'It is there, but nothing comparable could be computed. Not a failure.',
  'confirmed.help.yours': 'Your own copy was already there, so we never wrote these bytes.',
  'confirmed.help.missing':
    'We placed it and the re-read cannot find it. Keep your original.',
  'confirmed.help.neverPlaced':
    'It was never copied — skipped, failed, or left behind by choice.',
  'confirmed.help.removed':
    'We removed our own copy, on a decision recorded at the time.',
  'confirmed.help.unchecked':
    'The destination could not be asked. Nothing is known either way.',
  'confirmed.claim.byteHash': 'by hash',
  'confirmed.claim.fingerprint': 'by fingerprint',
  'confirmed.claim.containerParts': "by the document's parts",
  'confirmed.claim.none': 'not compared',
  'finish.title': 'Finish a migration',
  'finish.intro': 'Finishing stops the copying and the reporting; work the steps in order.',
  'finish.unknown.pre': 'No migration with id',
  'finish.unknown.post':
    'answered. Check the address; this is not a migration with nothing to finish.',
  'finish.readError.one': 'Could not read the migration.',
  'finish.readError.many': 'Could not read the migrations.',
  'finish.note.paused':
    'Never started, so there is nothing to finish. Remove the migration to retire it.',
  'finish.note.active':
    'Syncing on a schedule. Items still arriving on the old system are being copied across.',
  'finish.note.cutover': 'In cutover. If it was running, it copies until the grace period ends.',
  'finish.note.done':
    'Finished. This mapping no longer syncs and nothing is being reported for it.',
  'finish.note.continuous':
    'Continuous. It keeps copying after cutover. Ending each data type stops it; copies already made stay.',
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
    'The request failed; a pass may still be running, so re-check the queues shortly.',
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
    'being mirrored — anything you remove there stays in your new home. We will not bill ' +
    'past twelve months without asking you again.',
  'lane.confirm': 'Keep copying, and keep the tier',
  'lane.cancel': 'Not now',
  // The lane on the appliance (0128 D4): the same choice, and no tier to keep.
  'lane.selfhost.why':
    'Deletions at the old provider stop being mirrored — anything you remove there stays in ' +
    'your new home. It runs on this appliance until you end it.',
  'lane.selfhost.confirm': 'Keep copying',
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
    '. Only the first blocks finishing; the new system’s copy answers the other two.',
  'finish.step3.title': 'Run one final pass',
  'finish.step3.body': 'So the new system reflects the old one as of right now.',
  'finish.step3.run': 'Run a pass now',
  'finish.step3.runAgain': 'Run another',
  'finish.step3.finished': 'The pass has run and finished.',
  'finish.step3.queued':
    'Queued as a job; it lands in the run history, so re-check the queues shortly.',
  // A stopped data type is the one this step's promise leaves out (0125 T7):
  // nobody may finish believing its copies are current.
  'finish.step3.stopped.one': '{kind} is stopped and not in this pass: its one copy stays as it was.',
  'finish.step3.stopped.many': '{kind} is stopped and not in this pass: its {count} copies stay as they were.',
  'finish.step3.stopped.why':
    'It was switched off after copying. Its copies stay on the new system, but what changed on the old one since then has not reached them. If they must be current, switch it back on and let a pass run before you finish.',
  'finish.step3.stoppedByYou.why':
    'You stopped it. Its copies stay on the new system, but what changed on the old one since then has not reached them. If they must be current, resume it on the migration\'s page and let a pass run before you finish.',
  'finish.step3.stoppedUnread': 'Could not read whether a data type is stopped:',
  'finish.step4.title': 'Move delivery to the new system',
  'finish.step4.body':
    'Change MX/DNS and reconfigure clients so new mail arrives on the new system.',
  'finish.step4.more':
    'This happens outside this tool, so it is the one step here nobody can check for you.',
  'finish.step4.warn.pre': 'If you finish before this is done',
  'finish.step4.warn.post':
    ', anything that arrives on the old system afterwards will not be copied, and nothing will report it — the tool has stopped watching.',
  'finish.step4.checkbox': 'Delivery now goes to the new system.',
  'finish.step5.title': 'End or keep copying each data type',
  'finish.step5.nothingChanges.pre': 'Nothing is added to or removed from either system.',
  'finish.step5.nothingChanges.post':
    ' What is on the new system stays exactly as it is — this only stops the tool watching the old one.',
  'finish.button.disabledTitle':
    'Confirm step 4 first — finishing before delivery has moved loses anything that arrives afterwards.',
  // Each data type ended or kept copying on its own (workplan 0128 T3, T5
  // slice 7b; the owner's D3 and D8). The phase is the data type's own, as
  // the ending door believes it.
  'finish.each.title': 'Each data type',
  'finish.ending.phase.active': 'Copying; not cut over yet',
  'finish.ending.phase.cutover': 'In its cutover',
  'finish.ending.phase.done': 'Ended',
  'finish.ending.phase.continuous': 'Keeps copying after its cutover',
  'finish.ending.end': 'End {kind}',
  'finish.ending.keep': 'Keep copying {kind}',
  'finish.ending.forceButton': 'End {kind} anyway, leaving them behind',
  'finish.ending.stopped':
    'You stopped {kind}. End it, or resume it on the migration\'s page to keep copying it.',
  'finish.ending.failed': 'That did not go through:',
  // The grace period's end, when nobody chose (0128 D7, slice 7c).
  'finish.ending.graceEnded':
    'The grace period of {kind} ended on {date}, and nobody chose, so it no longer copies. End it, or keep it copying.',
  'tenants.title': 'Team & organization',
  'tenants.intro':
    'Who can sign in to this organization and what they may do; changes apply immediately.',
  'tenants.noTenant': 'No organization in this session.',
  'tenants.selfDemotionArmed':
    'This lowers your own role; you may not be able to change it back yourself.',
  'tenants.selfDemotionConfirm': 'Confirm role change',
  'tenants.org.heading': 'Organization',
  // The organisation's phone number (workplan 0108 T8a): optional, and shown
  // on the grant page to the people the organisation asks.
  'tenants.org.phone': 'Phone number',
  'tenants.org.phone.hint': 'Optional; shown to people you send a grant link to.',
  'tenants.org.phone.save': 'Save',
  'tenants.org.phone.saved': 'Saved.',
  'tenants.org.phone.none': 'None given.',
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
  // An open invitation's mail, again (0156 T3).
  'tenants.members.resend': 'Send again',
  'tenants.readOnly': 'Your role here is read-only. An owner or admin manages members.',
  'tenants.invite.heading': 'Invite someone',
  // The invitation is mailed since 0156 T3 (the owner, 2026-10-03). The
  // line said "No email yet; tell them yourself" until then, which was true.
  'tenants.invite.hint':
    'We email them where to sign in; they appear below as invited.',
  // What became of the mail, after Invite or Send again. Each leaves the
  // inviter a different thing to do, so each says it.
  'tenants.invite.mail.sent': 'Invitation emailed to {email}.',
  'tenants.invite.mail.off':
    'Invitation saved for {email}, but this installation sends no email: tell them yourself.',
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
    "An admin can do everything an owner can, except close or reopen the organisation, turn deleting by hand or the automatic removal of moved files' old copies on or off, and make somebody an owner.",
  'tenants.ownerOrAdminOnly': 'During the alpha, a person can only be an owner or an admin.',
  'tenants.notify.heading': 'Email summaries',
  'tenants.notify.intro':
    'How often a summary of waiting decisions is emailed; an empty one is never sent.',
  'tenants.notify.intro.more': 'Silence means nothing is waiting.',
  'tenants.notify.cadence': 'Summary',
  'tenants.notify.daily': 'Daily',
  'tenants.notify.weekly': 'Weekly (Monday)',
  'tenants.notify.off': 'No summary',
  'tenants.notify.locale': 'Language',
  'tenants.notify.recipients':
    'Sent to every owner and admin below; urgent events are emailed as they happen regardless.',
  'tenants.notify.save': 'Save',
  'tenants.notify.saved': 'Saved.',
  'tenants.notify.readError':
    'Could not read the setting; saving would overwrite something unknown, so the controls are off.',
  'tenants.invite.submit': 'Invite',
  'role.owner': 'Owner',
  'role.admin': 'Admin',
  'role.member': 'Member',
  'role.viewer': 'Viewer',
  'memberStatus.active': 'Active',
  'memberStatus.invited': 'Invited',
  'memberStatus.declined': 'Declined',
  'memberStatus.suspended': 'Suspended',
  'memberStatus.removed': 'Removed',
  'nav.decisions': 'Needs you',
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
    'The count shown is what we managed to read, not what is there — a queue that refused to answer is reported as unreadable rather than as empty, because "I found nothing" and "I could not look" are not the same sentence and only one of them means you are finished. The reason each one gave is listed beneath it, in the words the server used.',
  'attention.failed': 'This list could not be loaded, so nothing here is reliable.',
  'decisions.presets.heading': 'Standing answers',
  'decisions.presets.intro':
    'Categories set to answer themselves are still recorded here, but nobody is interrupted about them.',
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
    'Who could see whose calendar, who had access to which shared files: none of that moves. Get the list, work through it on the new system, and do it before delivery moves; rights added afterwards were missing for however long that took. The list names what it could not read, at the top.',
  'permissions.blindSpot':
    'Two blind spots: mailbox FullAccess or Send-As, and OneDrive and SharePoint sharing.',
  'permissions.blindSpot.more':
    'Who had full access to a mailbox or could send as it: Microsoft does not expose that to us at all, so you have to read it out of Exchange yourself. Sharing on the two file platforms is only included when this installation was given that extra permission. The document says which of the two it actually read, and how to cover the rest.',
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
  'decisions.readError': 'Could not read the decision queue.',
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
  'nav.connections': 'Accounts',
  'nav.setup': 'Setup checklist',
  'nav.docs': 'Setup guides',
  'nav.help': 'Help',
  'nav.needsYou.count.one': '1 waiting on you',
  'nav.needsYou.count.many': '{n} waiting on you',
  'wizard.reuseSource': 'Reuse a saved source connection',
  'wizard.reuseTarget': 'Reuse a saved target connection',
  'wizard.reuseNone': 'Enter new credentials',
  'wizard.reuse.hint': 'Reuses its saved credentials; the fields below disappear.',
  // What a source type IS, one line after the card is picked, and the rest under More (0118 T1).
  'wizard.about.o365': 'Uses an Entra app registration in your own tenant.',
  'wizard.about.o365.more':
    'Enter its tenant ID, client ID and client secret below, with the mailbox address. Register the app and grant admin consent in your own tenant first; the checklist below has the steps.',
  'wizard.about.googleDrive': 'Uses your own Google OAuth client and a read-only token.',
  'wizard.about.googleDrive.more':
    'The token cannot write to the Drive. Google Docs, Sheets, Slides and Drawings have no file to copy until you choose a format for each kind; until then each one is reported by name, with the reason. The setup guide walks through all three values, and the Test and save connections button checks them against Google before anything is copied.',
  // Where the deployment carries the provider's app (0148 T2 (a)): one line per
  // provider, and the fold keeps only what is particular to the card.
  'wizard.about.deploymentApp.google':
    'Uses this service’s own Google app: press Connect with Google and approve at Google.',
  'wizard.about.deploymentApp.dropbox':
    'Uses this service’s own Dropbox app: press Connect with Dropbox and approve at Dropbox.',
  'wizard.about.deploymentApp.googleDrive.more':
    'Google Docs, Sheets, Slides and Drawings have no file to copy until you choose a format for each kind; until then each one is reported by name, with the reason.',
  'wizard.about.dropbox': 'Uses your own read-only Dropbox app.',
  'wizard.about.dropbox.more':
    'Create it read-only: files.metadata.read and files.content.read, plus sharing.read if you want the shared-folder browse. The App key goes here; below it, the App secret goes in the client-secret field and the refresh token beside it.',
  'wizard.about.box': 'Uses your own Box platform app, authorised once by a Box admin.',
  'wizard.about.box.more':
    'It authenticates with the Client Credentials Grant, so there is no refresh token: Box rotates refresh tokens on every use. The Client ID goes here with the numeric user id being migrated; the client secret goes below them. A Box admin authorises the app once under Admin Console → Apps → Custom Apps Manager.',
  'wizard.about.gmail': 'Uses your own Google OAuth client; the token needs the mail scope.',
  'wizard.about.gmail.more':
    'The same client a Google Drive source uses, but its refresh token must be consented with https://mail.google.com/, the only scope Google accepts for IMAP. A token consented for Drive will not work here.',
  'wizard.about.googleDav':
    'Uses your own Google OAuth client; the token needs this product’s scope.',
  'wizard.about.googleDav.more':
    'The same client the other Google sources use, but the refresh token must be consented with https://www.googleapis.com/auth/calendar for Calendar or https://www.googleapis.com/auth/carddav for Contacts. A token consented for another Google product will not work here.',
  'wizard.about.apple':
    'Signs in with an app-specific password; iCloud Drive files cannot be migrated.',
  'wizard.about.apple.more':
    'Apple offers no consent screen for its own data, so you make an app-specific password instead, which takes a minute and can be revoked at any time. Nobody can migrate iCloud Drive files: Apple publishes no API for them.',
  'wizard.about.archive':
    'Photos land in folders named after your albums; a later export only adds.',
  'wizard.about.archive.more':
    'Connecting it shows what it holds: how many items, how many bytes, which albums, and the dates it covers. Each album is copied once, with one file listing everything Google knew about each photo. An archive is a snapshot of the day it was prepared, so a later export only adds; nothing is ever removed because an export no longer mentions it.',
  'connections.delete': 'Delete',
  'connections.rotate': 'Replace credentials',
  // The same panel, named for what it does on a row whose kind has a consent
  // button (Google, Dropbox, Microsoft): mint a new token (workplan 0140 T2 (b)).
  // failure.authExpired names this word.
  'connections.reconnect': 'Reconnect',
  'connections.rotate.hint':
    'Paste the new values; they are checked before replacing the old.',
  'connections.rotate.why':
    'If the check fails, nothing changes and your migrations keep whatever was working.',
  'connections.rotate.save': 'Check and replace',
  'connections.add': 'Add an account',
  'connections.addAndTest': 'Add and test',
  'connections.added': 'Added',
  'connections.role': 'Source or target?',
  'connections.type': 'Provider',
  'connections.name': 'Name for this account',
  'connections.title': 'Accounts',
  'connections.intro': 'The accounts your migrations sign in with. Test checks them read-only.',
  'connections.none': 'No accounts yet. Starting your first migration adds them.',
  'connections.sources': 'Sources',
  'connections.targets': 'Targets',
  'connections.test': 'Test',
  'connections.testing': 'Testing…',
  // A connection serves migrations, not mailboxes (owner remark 2026-09-02:
  // Dropbox is files, a Google account is four faces) — and none yet is a
  // sentence, not a zero.
  'connections.usedBy': 'migration(s) use this',
  'connections.usedBy.none': 'Not used by any migration yet',
  'connections.setupSteps': 'Setup steps',
  // What is STANDING against a connection (workplan 0094 T5): a pass that
  // failed since the last Test. "Migration <name> stopped 2 hours ago
  // (Email, Calendar):" and then the category's own remedy sentence.
  'connections.standing.migration': 'Migration',
  'connections.standing.stopped': 'stopped {when} ({domains}):',
  // Only where the connection is the thing to act on; the category does not
  // say which of a migration's two connections failed.
  'connections.standing.whichSide':
    'Signs in with this and one other connection; Test this one to find out which.',
  // And when the pass could tell (second slice): no guessing left to do.
  'connections.standing.thisSide': 'It failed on this account.',
  // What a probe FOUND, rendered from its outcome code (workplan 0080).
  // Ours, so translated; the provider's own refusal is never in here — it
  // renders verbatim, because that string is what you paste into their
  // console.
  // JUST THE FACT THAT IT CONNECTED (2026-09-07). This carried one face's
  // count — whichever the probe reached first — while the Found line below
  // already listed every face properly. The owner: *"why next to 'connected'
  // only part of what we know? leave that, since we mention what is
  // measured."* The count moved to where the other counts are; a listing
  // that stopped at its cap says so THERE, as `probe.measured.atLeast`.
  'probe.connected': 'Connected.',
  'probe.connectedSession': 'Connected. The JMAP session document answered.',
  'probe.targetStatus': 'The server at {url} answered {status}.',
  'probe.targetStatus.refused': 'It is reachable and refused the credentials.',
  'probe.targetStatus.check': 'Check the target host and port.',
  'probe.noProbe':
    'No check exists for a {kind} connection yet; that is our gap, not your credentials.',
  // The deadline (2026-09-02): unknown, not refused, and the connection is
  // kept so it can be tested again.
  'probe.timedOut':
    'No answer within {seconds} seconds; kept anyway, so test later or narrow the root folder.',
  // The export is in the migration's own file target (0116 T4, the relay), and
  // a connection is tested before any migration names one. Unknown, never a
  // measured no — the owner's answer of 2026-09-20.
  'probe.countedAtPreflight':
    'This export is in the migration\'s file target; it is counted at the preflight.',
  // WHAT HAPPENED AT AN ADDRESS THE TESTER TYPED (0136 T3), said from its
  // parts: a status, and a server's own words only when it sent an error
  // document we know. `{words}` is the server's and stays as it came, in both
  // languages (rule 9, docs/i18n-prose-boundary.md); the rest is ours. Every
  // sentence ends with the reference the full text is logged under.
  'probe.said.server': 'The server',
  'probe.said.mailServer': 'The mail server',
  'probe.said.answeredWords': '{who} answered {status}: {words}',
  'probe.said.answeredWordsNoStatus': '{who} answered: {words}',
  'probe.said.answeredOther':
    '{who} answered {status} with something that is not a DAV, JMAP or IMAP error.',
  'probe.said.answeredOtherNoStatus':
    '{who} answered with something that is not a DAV, JMAP or IMAP error.',
  'probe.said.unreachable':
    'Nothing answered at that address: the name did not resolve, the connection was refused, or no answer came in time. Check the host name and the port.',
  'probe.said.certificate':
    'The server\'s certificate did not verify for that name, or it has expired, so the test stopped before signing in.',
  'probe.said.insideOurNetwork':
    'That address is inside this service\'s own network, or the server sent the test on to one that is, so we did not connect to it. Give the address the server has on the internet.',
  'probe.said.unknown':
    'The test failed, and what came back is not shown here. Check the address and the port.',
  'probe.said.reference': 'Reference {reference}.',
  // A face the test could not measure, said the same way (0136 T3).
  'probe.said.unmeasured': 'Unmeasured — {sentence}',
  // The limit on tests (0136 T3): sixty an hour per member, across the doors
  // that connect to an address somebody typed.
  'probe.tooManyTests':
    'You have tested a lot of connections in the last hour. Wait a little, then test again.',
  'probe.measuring': 'Still measuring what this account can carry — refresh in a minute.',
  // A listing that stopped at its cap saw AT LEAST this many. It used to say
  // so in the headline; the headline no longer carries a count, so it says so
  // here — beside the number it qualifies, which is the better place anyway.
  'probe.measured.atLeast': 'at least {count} {unit}',
  'probe.unit.folder.one': 'folder',
  'probe.unit.folder.many': 'folders',
  'probe.unit.calendar.one': 'calendar',
  'probe.unit.calendar.many': 'calendars',
  'probe.unit.addressBook.one': 'address book',
  'probe.unit.addressBook.many': 'address books',
  'probe.unit.taskList.one': 'task list',
  'probe.unit.taskList.many': 'task lists',
  'probe.unit.collection.one': 'collection',
  'probe.unit.collection.many': 'collections',
  // The account's per-domain qualification line (0106 T0). Three marks,
  // deliberately three: '?' is unmeasured, never a quiet yes or no.
  'probe.qualify.lead': 'Carries:',
  'probe.qualify.unknownHint': "'?' is unmeasured — not safe to assume either way",
  // The measured-volume line (2026-09-02): how much each reached face holds.
  'probe.measured.lead': 'Found:',
  // A face that answered with nothing. "Tasks ✓ 0 task lists" read as a
  // contradiction and was not one — zero collections is a real answer and the
  // protocol works. This keeps the fact and drops the argument.
  'probe.found.none': 'none',
  'probe.measured.message.one': '{count} message',
  'probe.measured.message.many': '{count} messages',
  'probe.measured.card.one': '{count} card',
  'probe.measured.card.many': '{count} cards',
  'probe.measured.item.one': '{count} item',
  'probe.measured.item.many': '{count} items',
  'probe.measured.driveNote': 'Docs, Sheets and Slides not counted',
  'probe.measured.failed': 'not measured',
  // Items the listing found and could NOT read (2026-09-07). Shown beside the
  // count rather than instead of it: "0 cards" and "0 cards, 25 could not be
  // read" are different facts, and the second is the one worth acting on.
  'probe.measured.unreadable.one': '{count} could not be read',
  'probe.measured.unreadable.many': '{count} could not be read',

  'connections.ok': 'Reached it. The credentials still work.',
  'connections.failed': 'Could not reach it.',
  // The delete refusal's FRAME (workplan 0071). The migrations it names are
  // the server's finding and render verbatim; these words are ours, so they
  // are translated — the owner met the old five-clause English paragraph in a
  // Dutch UI and asked for both halves of that to change. It still answers
  // why, what to do first, and where, in two lines instead of five.
  'connections.inUse.lead': 'Still used by',
  // `mailbox_mapping.name` is nullable, so a migration can genuinely have no
  // name to quote. Saying so beats dropping back to the server's English.
  'connections.inUse.unnamed': 'a migration with no name',
  'connections.inUse.reason':
    'Deleting it would delete what those migrations recorded; remove them under Migrations first.',
  // A delete that went through (2026-09-20). The frame is ours; the provider's
  // reason, when there is one, follows it verbatim. `failed` must not be
  // softened: the reader has to go and withdraw the access themselves.
  'connections.removed.done': 'deleted.',
  'connections.removed.revoked': 'Its access at the provider has been revoked.',
  'connections.removed.failed':
    'Our copy is deleted, but the provider still has its access: withdraw it yourself.',
  'connections.removed.unsupported': 'We deleted our copy; this provider has no revocation we can call.',
  'connections.removed.none': 'No credential was stored for it.',
  // Filled in, but not usable — distinct from "still needed" (0072).
  'connections.invalidValues.lead': 'These values cannot be used as they are:',
  // The duplicate-migration refusal (workplan 0071 T6, owner decision
  // 2026-08-18). Two mappings between the same two accounts, into the same
  // place, copy every item twice — so the pair may only repeat under a
  // different target folder, and this says which existing one is in the way.
  'createMapping.duplicate.lead': 'You already have a migration between these two accounts:',
  'createMapping.duplicate.why':
    'Two migrations copying the same items into the same place would put everything on the target twice. Give this one a different target folder, or open the existing migration.',
  'createMapping.duplicate.open': 'Open the existing migration',
  // ---- Provider setup checklist (workplan 0061) ----
  'setup.title': 'Provider setup',
  'setup.intro':
    'Steps to take in the provider’s console; ticks are saved for your whole organisation.',
  'setup.backToWizard': '← Back to the wizard',
  'setup.backToConnections': '← Back to accounts',
  'setup.fullGuide': 'Read the full setup guide',
  'setup.settled': 'settled',
  'setup.stillOpen': 'still to do',
  'setup.waitingOnOthers': 'waiting on an administrator',
  'setup.allDone': 'Everything is settled; complete the wizard.',
  'setup.nothingToDo': 'Nothing to set up in advance; go straight to the wizard.',
  // Every step was about one's own app, and this service has its own (0148 T2 (b)).
  'setup.deploymentApp':
    'Nothing to create: this service has its own {provider} app. Press Connect with {provider}.',
  // ---- Choosing a provider, and narrowing by who you are (workplan 0068) ----
  'setup.choose.title': 'What are you setting up?',
  'setup.choose.intro':
    'Each system has its own short list to arrange before a migration can start.',
  'setup.choose.sources': 'Migrating from',
  'setup.choose.targets': 'Migrating to',
  'setup.admin.question': 'Do you administer this system for your organisation?',
  'setup.admin.yes': 'Yes, I am an administrator',
  'setup.admin.no': 'No, someone else is',
  'setup.admin.unsure': 'Show me everything',
  'setup.admin.hint': 'Only changes how the list is arranged; remembered on this device.',
  'setup.yours': 'What you can do yourself',
  'setup.forYourAdmin': 'What your administrator has to do',
  'setup.forYourAdmin.hint':
    'Send these to whoever administers the system; tick them off once confirmed.',
  'setup.yields': 'You get:',
  'setup.tick': 'Mark this step done',
  'setup.untick': 'Mark this step not done',
  'setup.skip': 'Skip',
  'setup.unskip': 'Un-skip',
  'setup.state.done': 'Done',
  'setup.state.skipped': 'Skipped — deliberately not needed',
  'setup.needsAnotherPerson': 'needs an administrator',
  'setup.needsAnotherPerson.hint':
    'Needs admin rights; usually the step you wait on.',
  'setup.openChecklist': 'Open the setup checklist',
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
  // Connect with Dropbox consents and exchanges the code (2026-09-02) where the
  // deployment serves it; the appliance does not, so both manual steps stay and
  // each line is true with or without the button (0148 T2 (b)).
  'setup.dropbox.redirect_uri.title': 'Using the button? Register its redirect address',
  'setup.dropbox.redirect_uri.detail':
    'Only for Connect with Dropbox in the wizard: under the button it shows an address. Add that exact address in the Dropbox App Console under OAuth 2 → Redirect URIs, then press the button again. Without the button, skip this step.',
  'setup.dropbox.consent.title': 'Have the account owner consent once',
  'setup.dropbox.consent.detail':
    'Connect with Dropbox does this step and the next when the account owner presses it. Without the button, send the person whose Dropbox is being migrated through the authorisation URL for this app, with token_access_type=offline so Dropbox returns a refresh token.',
  'setup.dropbox.exchange_code.title': 'Exchange the code for a refresh token',
  'setup.dropbox.exchange_code.detail':
    'Swap the code from the previous step at Dropbox\u2019s token endpoint, once. Access tokens are minted from the result per run; nothing else long-lived is stored.',
  'setup.dropbox.exchange_code.yields': 'a refresh token.',
  'setup.google.create_oauth_client.title': 'Create a Google OAuth client',
  'setup.google.create_oauth_client.detail':
    'Google Cloud console → APIs & Services → Credentials → Create credentials → OAuth client ID, as a Web application.',
  'setup.google.create_oauth_client.yields': 'a Client ID and a Client Secret.',
  'setup.google.enable_api.title': 'Enable the product’s API',
  'setup.google.enable_api.detail':
    'In the same project, enable the API that matches the source you picked — Google Drive API, Gmail API, CalDAV API, Google Contacts CardDAV API or Google Tasks API. A client without it fails on the first call.',
  'setup.google.consent_scope.title': 'Consent a read-only refresh token',
  'setup.google.consent_scope.detail':
    'Have the account owner consent with the scope for that product; a token consented for one Google product does not work for another. Or use a service account with domain-wide delegation, which an admin authorises once for the whole domain.',
  'setup.google.consent_scope.yields': 'a refresh token (or a service-account key file).',
  'setup.graph.app_registration.title': 'Register an app in Microsoft Entra',
  // Shared by Via the Graph API and Via IMAP: the Microsoft guide's {#application}.
  'setup.graph.app_registration.detail':
    'Entra admin centre → Identity → Applications → App registrations → New registration, in the tenant whose mailboxes you are migrating. Choose Accounts in this organizational directory only and leave the redirect address empty. The Overview page then shows the Application (client) ID and the Directory (tenant) ID.',
  'setup.graph.app_registration.yields': 'a Tenant ID and a Client ID.',
  // Via the Graph API only (0148 T5 (a)): both cards read one mailbox's mail,
  // and this one reads it with one Microsoft Graph permission.
  'setup.graph.api_permissions.title': 'Add Mail.Read and get admin consent',
  'setup.graph.api_permissions.detail':
    'API permissions → Add a permission → Microsoft Graph → Application permissions → Mail.Read. Nothing else: this card reads one mailbox’s mail. Then an administrator presses Grant admin consent for your organisation. As an application permission, Mail.Read can read every mailbox in the organisation; this service reads only the one the connection names.',
  'setup.graph.client_secret.title': 'Create a client secret',
  'setup.graph.client_secret.detail':
    'Certificates & secrets → New client secret. Copy it immediately — Entra shows the value once.',
  'setup.graph.client_secret.yields': 'a Client Secret.',
  // Via IMAP (0148 T5 (a)): its token carries only what Office 365 Exchange
  // Online gives, so its recipe is the Microsoft guide's {#application-imap}.
  'setup.exchange.permission.title': 'Add IMAP.AccessAsApp and get admin consent',
  'setup.exchange.permission.detail':
    'API permissions → Add a permission → APIs my organization uses → Office 365 Exchange Online → Application permissions → IMAP.AccessAsApp. Not a Microsoft Graph permission: this card signs in to Exchange Online’s IMAP server, and such a token carries only what Exchange Online gives. Then an administrator presses Grant admin consent for your organisation.',
  'setup.exchange.service_principal.title': 'Register the application in Exchange Online',
  'setup.exchange.service_principal.detail':
    'An Exchange administrator runs New-ServicePrincipal in Exchange Online PowerShell, with the Application (client) ID and the Object ID shown under Enterprise applications. Not the Object ID under App registrations: with that one, the card’s sign-in fails. The guide has the commands.',
  'setup.exchange.mailbox_permission.title': 'Give the application the mailbox',
  'setup.exchange.mailbox_permission.detail':
    'The Exchange administrator runs Add-MailboxPermission with -AccessRights FullAccess, once for each mailbox the card reads. FullAccess would let an application change the mailbox as well as read it. This service only reads it, and for this card Microsoft does not enforce that.',
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
  'setup.jmap.api_token.title': 'Create an app password for it',
  'setup.jmap.api_token.detail':
    'Create an app password for that account in the server\u2019s own settings, where it offers one; this product signs in with the username and that password.',
  'setup.jmap.api_token.yields': 'a username and an app password.',
  'setup.davbasic.account_exists.title': 'Make sure the destination account exists',
  'setup.davbasic.account_exists.detail':
    'Create the account on the target server first, with enough quota for what is coming. Nothing here creates accounts.',
  'setup.davbasic.app_password.title': 'Create an app password for it',
  'setup.davbasic.app_password.detail':
    'Use an app-specific password rather than the account\u2019s own login where the server offers one — it can be revoked without changing the person\u2019s password.',
  'setup.davbasic.app_password.yields': 'a username and an app password.',
  // ---- What comes first for Apple, Nextcloud and Soverin (0148 T5 (a)) ----
  // Each in its card guide's words: apple.md {#app-password}, nextcloud.md
  // {#app-password} and {#nextcloud}, soverin.md {#soverin}.
  'setup.apple.app_password.title': 'Make an app-specific password',
  'setup.apple.app_password.detail':
    'Sign in at account.apple.com → Sign-In and Security → App-Specific Passwords, and generate one. Apple shows it once, so copy it at once. Not your Apple Account password: Apple refuses that one here by design.',
  'setup.apple.app_password.yields': 'an app-specific password, such as abcd-efgh-ijkl-mnop.',
  'setup.nextcloud.account_exists.title': 'Make sure the Nextcloud account exists',
  'setup.nextcloud.account_exists.detail':
    'The account must exist on the Nextcloud already, with enough room for what is coming. This service creates no accounts.',
  'setup.nextcloud.app_password.title': 'Create an app password',
  'setup.nextcloud.app_password.detail':
    'In Nextcloud: Settings → Security → Devices & sessions. Type a name under App name, such as Migration, press Create new app password and copy the password. Use it rather than the account’s own password: it can be revoked without changing yours.',
  'setup.nextcloud.app_password.yields': 'an app password, for the wizard’s Password box.',
  'setup.nextcloud.dav_url.title': 'Note the address with /remote.php/dav',
  'setup.nextcloud.dav_url.detail':
    'The address you open Nextcloud at, with /remote.php/dav on the end, such as https://cloud.example.com/remote.php/dav. It goes in DAV base URL; there is no box for a host or a port. Nextcloud shows its WebDAV address at the bottom of the Files settings page: the name after /remote.php/dav/files/ is the user name to type.',
  'setup.nextcloud.dav_url.yields': 'the DAV base URL, and your user name.',
  'setup.soverin.account_exists.title': 'Make sure the Soverin account exists',
  'setup.soverin.account_exists.detail':
    'The Soverin account must exist already, with room for what is coming. This service creates no accounts.',
  'setup.soverin.password.title': 'Have the account’s password at hand',
  'setup.soverin.password.detail':
    'This service signs in with the Soverin email address and that account’s password. If Soverin offers you an app password, it can go in the same Password box instead. Whether one app password covers mail as well as calendars and contacts is not certain; the test says so per part.',
  'setup.soverin.password.yields': 'the email address, and the password or an app password.',
  'setup.soverin.mail_server.title': 'Mail moving too? Keep the mail server',
  'setup.soverin.mail_server.detail':
    'The wizard fills in Mail server, imap.soverin.net, and Mail port, 993, from Soverin’s published settings. If mail moves, leave Mail server filled in: a connection saved without it carries no mail. Calendars and contacts need no mail server.',
  // ---- Asking for access (workplan 0093) ----
  'access.title': 'Request access',
  'access.intro': 'Invite-only for now: tell us what you want to move, and we will email you.',
  'access.email': 'Email address',
  'access.emailHint': 'Where we reply. Nothing else is sent here.',
  'access.name': 'Your name',
  'access.organisation': 'Organisation',
  'access.optional': 'optional',
  'access.note': 'What are you moving?',
  'access.noteHint': 'Roughly how many mailboxes, and from where; one sentence is plenty.',
  'access.tier': 'Which package looks right?',
  'access.tierHint':
    'A guess is fine. The package follows what actually runs, so this is not binding.',
  'access.tierUnsure': 'Not sure yet',
  'access.submit': 'Send request',
  'access.sending': 'Sending…',
  'access.sent': 'Thank you — we have your request.',
  'access.sentDetail': 'You will hear back by email.',
  'access.failed': 'We could not send that:',
  'access.failedFallback': 'the request did not complete.',
  // Privacy §4.4's two purposes, decided and answered (0139 T4,
  // ops-app-sentences (a); it said "only to answer you" until then), and
  // since 2026-10-03 privacy §9's period for a request, in short sentences:
  // open, declined, granted. The links to the policy and, during the alpha,
  // the conditions follow it under the form.
  'access.privacy':
    'We keep what you type to decide on your request and to answer you; asking creates no account. ' +
    'We keep it while your request is open. If we decline it, we delete it 30 days after our decision. ' +
    'If we grant it, it stays with your account and is erased with it.',
  'access.backToSignIn': 'Already have an account? Sign in',
} as const;

const nl: Record<keyof typeof en, string> = {
  // Het woord op een uitklapbaar deel (workplan 0118) — zie het Engelse blok.
  'fold.more': 'Meer',
  // Het woord op een uitklapbaar deel (workplan 0118) — zie het Engelse blok.
  'fold.how': 'Hoe?',
  // Het woord op een uitklapbaar deel (workplan 0118) — zie het Engelse blok.
  'fold.why': 'Waarom?',
  'status.link': 'Storingsstatus',
  'notFound.heading': 'Hier staat niets.',
  'notFound.lede':
    'Geen scherm heeft dit adres; hernoemd of nooit bestaan, uw migraties zijn ongemoeid.',
  'notFound.back': 'Terug naar het begin',
  'nav.mappings': 'Migraties',
  'nav.back': 'Terug',
  'nav.menu': 'Menu',
  'nav.review': 'Controleren en bevestigen',
  'nav.deletions': 'Verwijderingen',
  'nav.moves': 'Verplaatsingen',
  'nav.failures': 'Mislukkingen',
  'nav.check': 'Verificatie',
  'nav.finish': 'Afronden',
  'nav.log': 'Logboek',
  'nav.tenants': 'Team',
  'nav.billing': 'Facturering',
  'nav.signOut': 'Uitloggen',
  'nav.reportProblem': 'Een probleem melden',
  'report.title': 'Een probleem melden',
  'report.lead': 'Vertel ons wat er gebeurde. We lezen elke melding en antwoorden per e-mail.',
  'report.description': 'Wat gebeurde er?',
  'report.descriptionHint': 'Wat u deed, wat u verwachtte, en wat u in plaats daarvan zag.',
  'report.screenshot': 'Schermafbeelding (optioneel)',
  'report.screenshotHint':
    'PNG of JPEG, tot 5 MB: kies er een, sleep hem hierheen of plak hem ergens op deze pagina. ' +
    'Hij toont uw scherm: bekijk hem eerst.',
  'report.screenshotTooBig': 'Die afbeelding is groter dan 5 MB.',
  'report.screenshotType': 'Kies een PNG of een JPEG.',
  'report.screenshotHelp': 'Hoe maak ik een schermafbeelding?',
  'report.screenshotHelp.windows':
    'Windows: druk op Windows+Shift+S, kies het deel van het scherm en plak hem hier met Ctrl+V. ' +
    'Of druk op Print Screen (in Windows 11 krijgt u dan dezelfde keuze) en plak hem daarna.',
  'report.screenshotHelp.mac':
    'Mac: druk op Shift+Command+4, sleep over het deel dat u wilt en kies de afbeelding daarna op uw bureaublad. ' +
    'Of druk op Control+Shift+Command+4 om hem te kopiëren, en plak hem hier met Command+V.',
  'report.screenshotHelp.iphone':
    'iPhone of iPad: druk tegelijk op de zij- of bovenknop en volume omhoog (op een model met een ' +
    "thuisknop: de zij- of bovenknop en de thuisknop). Kies de afbeelding daarna in Foto's.",
  'report.screenshotHelp.android':
    "Android: druk tegelijk op de aan/uit-knop en volume omlaag, op de meeste telefoons. Kies de afbeelding daarna uit uw foto's.",
  'report.screenshotHelp.chromebook': 'Chromebook: druk op Ctrl+Vensters weergeven en plak hem hier met Ctrl+V.',
  'report.screenshotHelp.check':
    'Bekijk hem voordat u hem verstuurt: de afbeelding toont alles wat er op uw scherm stond, dus kijk of ' +
    'er niets op staat wat u liever niet meestuurt.',
  'report.screenshotAttached': 'Bijgevoegd: {name} ({size}).',
  'report.screenshotRemove': 'Schermafbeelding verwijderen',
  'report.screenshotPaste': 'Schermafbeelding plakken',
  'report.screenshotPasteEmpty':
    'Er staat geen afbeelding op het klembord. Maak eerst een schermafbeelding en druk dan opnieuw op Schermafbeelding plakken.',
  'report.screenshotPasteFailed':
    'Deze browser kon het klembord niet lezen. Plak dan met Ctrl+V, of met Command+V op een Mac.',
  'report.tooLarge': 'De schermafbeelding is te groot om te versturen: kies een kleinere en verstuur de melding opnieuw.',
  'report.timedOut':
    'Binnen {minutes} minuten kwam er geen antwoord, dus deze pagina weet niet of uw melding is aangekomen. ' +
    'Wat u schreef staat er nog. Verstuurt u de melding opnieuw, dan gaat een kleinere schermafbeelding sneller.',
  'report.goesTo': 'Gaat naar het supportteam van Ownpace.',
  'report.goesTo.mail': 'Gaat naar het supportteam van Ownpace, per e-mail naar {address}.',
  'report.goesTo.helpdesk': 'Gaat naar de helpdesk van het supportteam van Ownpace.',
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
  'report.sending': 'Versturen…',
  'report.sent': 'Verstuurd. Uw melding heeft nummer {ticket}, en we antwoorden naar {email}.',
  'report.sent.mail': 'Verstuurd naar ons supportteam, met meldingskenmerk {reference}. We antwoorden per e-mail naar {email}.',
  'report.unavailable': 'Een probleem melden is op deze dienst niet ingesteld.',
  'language.label': 'Taal',
  'common.requestFailed': 'Het verzoek is niet voltooid.',
  'asof.updated': 'Bijgewerkt',
  'asof.refresh': 'Vernieuwen',
  'failure.authExpired':
    'De verbinding met dit account is verlopen. Druk op de pagina Accounts op Opnieuw verbinden of Inloggegevens vervangen, welke van de twee er bij dit account staat; daarna gaat dit verder waar het gestopt is \u2014 er gaat niets verloren.',
  'failure.rateLimited':
    'De provider vroeg ons om rustiger aan te doen. Er is niets mis: dit pauzeert en hervat vanzelf.',
  'failure.quotaExceeded':
    'Dit account heeft bereikt wat de provider per dag toestaat. Het hervat morgen vanzelf \u2014 u hoeft niets te doen.',
  'failure.policyRefused':
    'Nog niet gemigreerd: Google-bestanden in een formaat dat het nieuwe account niet kan ontvangen. Kies er een dat beide kanten aankunnen onder Exportformaat voor Google-bestanden en klik op Probeer opnieuw \u2014 of laat deze items achter.',
  'failure.policyRefused.dropbox':
    'Nog niet gemigreerd: Dropbox Paper-documenten, die Dropbox alleen als export afgeeft. Kies een formaat onder Exportformaat voor Paper-documenten en klik op Probeer opnieuw \u2014 of laat deze items achter. Andere documenten die Dropbox in een eigen formaat bewaart, worden hier niet geëxporteerd: exporteer ze zelf vanuit Dropbox, of laat ze achter.',
  'failure.tooLarge':
    'Niet gemigreerd: groter dan deze dienst tijdens de alfa kopieert. Kopieer deze bestanden met de hand, of laat ze achter.',
  'failure.sourceRefused':
    'Niet gemigreerd: het oude account wilde dit niet afgeven, dus er is niets naar het nieuwe gestuurd \u2014 daar valt niets te controleren. Probeer opnieuw als dat veranderd is, of laat deze items achter.',
  'failure.targetRefused':
    'De bestemming weigerde dit te accepteren. Veelvoorkomende oorzaken: geen ruimte meer, een grens aan de grootte van één upload, een alleen-lezen map, of ontbrekende rechten op het doelaccount. Antwoordde de bestemming met een interne fout, dan staat de reden in het logboek van de bestemming zelf en niet in het antwoord dat wij terugkregen.',
  'failure.formatRefused':
    'De bestemming accepteert dit SOORT bestand niet. Met het account zelf is niets mis \u2014 het is de indeling of de naam van dit bestand die daar niet is toegestaan. Geef het in het oude account een andere naam, wijzig het exportformaat op de koppeling, of laat deze items achter.',
  'failure.network':
    'We konden de server niet bereiken. Dit duurt meestal kort en wordt vanzelf opnieuw geprobeerd.',
  'failure.unknown':
    'We konden dit niet classificeren. De melding van de provider zelf staat hieronder \u2014 helpt die niet, stuur hem ons dan en we kijken mee.',
  'failure.sendItToUs': 'Stuur het ons',
  'failure.reference': 'Referentie: {reference}',
  'failure.side.source': 'Het gebeurde aan de bronkant.',
  'failure.side.target': 'Het gebeurde aan de doelkant.',
  // De supportschermen van de beheerder (werkplan 0110 T4). Gericht aan de
  // BEHEERDER, niet aan een klant.
  'support.heading': 'Support',
  'support.recorded':
    'Elk scherm dat u hier opent wordt op uw naam vastgelegd; klanten kunnen dat zien.',
  'support.recorded.why':
    'Het supportleeslogboek legt bij elk scherm de organisatie en het tijdstip vast, en klanten kunnen dat logboek te zien krijgen.',
  'support.metadataOnly':
    'Alleen namen, statussen, aantallen en tijden; geen bericht, afspraak, contact of bestand wordt hier getoond.',
  'support.metadataOnly.why':
    'Dat kan ook niet: de database levert dit scherm een vaste lijst kolommen.',
  'support.noOrganisations': 'Geen organisaties om te tonen.',
  'support.notFound': 'Hier is niets te tonen.',
  'support.back': 'Alle organisaties',
  'support.backToOrganisation': 'Terug naar de organisatie',
  'support.joinedOn': 'Klant sinds',
  'support.findPerson': 'Iemand zoeken',
  'support.find': 'Zoeken',
  'support.findPersonHint': 'Deel van een e-mailadres',
  'support.findPersonRecorded':
    'Een zoekopdracht leest alle organisaties; zoekterm en aantal treffers worden op uw naam vastgelegd.',
  'support.noPeopleFound': 'Niemand komt overeen.',
  'support.findPersonCapped':
    'Alleen de eerste resultaten — verfijn de zoekopdracht in plaats van te scrollen.',
  'support.people': 'Mensen',
  'support.noPeople': 'Niemand hoort bij deze organisatie.',
  'support.col.email': 'E-mailadres',
  'support.notArrivedYet':
    'Heeft zich nog niet aangemeld; dit wordt een link zodra de uitnodiging is aangenomen.',
  'support.seededDemoAccount':
    'Een demovoorbeeld uit het seed-script; er is geen identiteitsprovider-account, en dat komt er niet.',
  'support.openAtProvider': 'Dit account openen bij de identiteitsprovider',
  'support.connections': 'Verbindingen',
  'support.migrations': 'Migraties',
  'support.invoices': 'Facturen',
  'support.domains': 'Per soort',
  'support.noConnections': 'Geen verbindingen.',
  'support.noMigrations': 'Geen migraties.',
  'support.noInvoices': 'Geen facturen.',
  'support.hold': 'Nieuwe rondes pauzeren',
  'support.hold.hint': 'Stopt nieuwe rondes, ook via een knop; wat al loopt wordt afgerond.',
  'support.hold.hint.why':
    'Dit is de drain: de synchronisatietick stopt binnen een minuut met inplannen, en wat al loopt wordt normaal afgerond. Elke ingelogde klant ziet een melding met uw tekst, of een standaardzin als u het veld leeg laat. Uw tekst is ook, woord voor woord, het antwoord op elke knop die werk zou starten terwijl de pauze aanstaat (\'Synchroniseer nu\', \'Start migratie\', een controle), en wat zo geweigerd wordt, onthoudt het platform niet. Zeg dus wanneer het kopiëren weer begint en vraag de klant het daarna opnieuw te proberen, bijvoorbeeld: \'We werken het platform bij en kopiëren rond 15:00 weer. Tot die tijd start er niets. Probeer het daarna opnieuw.\' Zodra u de pauze opheft, starten de geplande rondes bij de volgende tick weer.',
  'support.hold.on': 'Gepauzeerd sinds {since}. Er starten geen nieuwe rondes.',
  'support.hold.off': 'Niet gepauzeerd. Nieuwe rondes starten volgens schema.',
  'support.hold.start': 'Nieuwe rondes pauzeren',
  'support.hold.end': 'Pauze opheffen',
  'support.hold.message': 'Wat klanten te lezen krijgen',
  'support.hold.message.placeholder': 'Over ongeveer een uur weer terug.',
  'support.platform': 'Platform, zoals de klant het ziet',
  'support.platform.database': 'Database',
  'support.platform.signIn': 'Inloggen',
  'support.platform.state.up': 'in orde',
  'support.platform.state.down': 'uitgevallen',
  'support.platform.state.off': 'uit',
  'support.platform.state.unchecked': 'nog niet gecontroleerd',
  'support.platform.page.off': 'Deze installatie heeft geen statuspagina.',
  'support.platform.page.unreachable':
    'De statuspagina antwoordde niet; op een omgeving die er een heeft is dat nieuws.',
  'support.platform.unread': 'De platformstatus kon niet worden gelezen.',
  'support.platform.checked': 'Gecontroleerd {when}.',
  'support.noDomains': 'Er is nog niets gedraaid.',
  'support.waiting.none': 'Er wacht niets op hen.',
  'support.waiting.some':
    'Er wachten beslissingen op deze klant; hun eigen scherm zegt welke, dit telt ze alleen.',
  'support.noFourthLevel':
    'Er is geen scherm onder dit scherm; items zouden onderwerpregels zijn, waar support ophoudt.',
  'support.col.organisation': 'Organisatie',
  'support.col.status': 'Status',
  'support.col.joined': 'Klant sinds',
  'support.col.migrations': 'Migraties',
  'support.col.failing': 'Mislukt',
  'support.col.waiting': 'Wacht op hen',
  'support.col.name': 'Naam',
  'support.col.role': 'Rol',
  'support.col.kind': 'Soort',
  'support.col.lifecycle': 'Fase',
  'support.col.mode': 'Modus',
  'support.col.updated': 'Bijgewerkt',
  'support.col.period': 'Periode',
  'support.col.total': 'Totaal',
  'support.col.domain': 'Soort',
  'support.col.state': 'Status',
  'support.col.whatToDo': 'Wat te doen',
  // Het staffelbewijs (0109 T4 zichtbaar gemaakt). "Pakket", hetzelfde woord
  // dat `access.tier` richting de klant gebruikt.
  'support.usage': 'Gebruik en pakket deze maand',
  'support.usage.beyondTable': 'Voorbij de gepubliceerde tabel — een maat om over te praten.',
  'support.usage.perMonth': 'per maand',
  'support.usage.free': 'gratis',
  'support.usage.decidedBy.paths':
    'Bepaald door de paden-as — hoeveel er tegelijk lopen.',
  'support.usage.decidedBy.data':
    'Bepaald door de data-as — wat verplaatst is, zet de ondergrens.',
  'support.usage.decidedBy.both': 'Beide assen komen op hetzelfde pakket uit.',
  'support.usage.peak': 'Vastgelegde piek deze maand',
  'support.usage.noPeak': 'nog niets vastgelegd',
  'support.usage.now': 'Houdt nu een plek vast',
  'support.usage.data': 'Verplaatste data (eerste kopieën)',
  'support.usage.note':
    'De hoogste as bepaalt; een toekomstige factuur gebruikt dezelfde afleiding, en kijken verandert niets.',
  'support.usage.why':
    'Paden die tegelijk lopen, of data die sinds het begin is verplaatst: alleen eerste kopieën, en een gepauzeerd pad houdt zijn plek.',
  // Wat na een wissing bewaard is gebleven.
  'support.retained.link': 'Facturen bewaard na een wissing',
  'support.retained.heading': 'Facturen bewaard na een wissing',
  'support.retained.why':
    'Wanneer een organisatie wordt gewist, blijven de facturen bewust bewaard — de ' +
    'fiscale bewaarplicht duurt langer dan de klantrelatie — en worden ze losgekoppeld ' +
    'van de organisatie. Ze horen bij geen enkele klant meer, dus geen enkele ' +
    'organisatiepagina kan ze tonen. Hier staan ze. De referentie is een eenrichtings- ' +
    'hash van het gewiste id, getoond zodat facturen uit dezelfde wissing bij elkaar ' +
    'te zien zijn; hij leidt niet terug naar iemand.',
  'support.retained.none': 'Er zijn geen facturen bewaard — er is nog niets gewist.',
  'support.retained.noName': 'niet vastgelegd',
  'support.retained.notPurged': 'nog niet gewist',
  'support.retained.col.billedTo': 'Gefactureerd aan',
  'support.retained.col.erased': 'Gewist',
  'support.retained.col.erasure': 'Wissing',
  'support.log.link': 'Het logboek: auditgebeurtenissen, fouten en waarschuwingen',
  'support.log.heading': 'Logboek',
  'support.log.lead': 'Het auditlog en de fouten en waarschuwingen van de applicatie, nieuwste eerst. Alleen metadata.',
  'support.log.lead.why':
    'Wat een auditgebeurtenis veranderde staat hier niet: dat blijft in de database, om bij een onderzoek op te vragen. De tekst van een fout blijft in de uitvoer van de server, op de regel met dezelfde referentie. Elke pagina van dit logboek die je opent wordt vastgelegd, met de filters.',
  'log.lead.why':
    'Wat een auditgebeurtenis veranderde staat hier niet: dat blijft in de database, om bij een onderzoek op te vragen. De tekst van een fout blijft in de uitvoer van de appliance, op de regel met dezelfde referentie.',
  'support.log.level': 'Niveau',
  'support.log.level.any': 'Alle',
  'support.log.level.error': 'Fout',
  'support.log.level.warn': 'Waarschuwing',
  'support.log.level.info': 'Audit',
  'support.log.event': 'Gebeurtenis begint met',
  'support.log.category': 'Foutcategorie',
  'support.log.category.any': 'Alle',
  'support.log.reference': 'Referentie',
  'support.log.from': 'Vanaf (UTC)',
  'support.log.to': 'Tot en met (UTC)',
  'support.log.search': 'Zoeken',
  'support.log.organisation': 'Organisatie: {name}',
  'support.log.migration': 'Migratie: {name}',
  'support.log.remove': 'Dit filter weghalen',
  'support.log.none': 'Niets in het logboek komt overeen.',
  'support.log.older': 'Ouder',
  'support.log.newest': 'Terug naar het nieuwste',
  'support.log.byTheService': 'de dienst',
  'support.log.col.time': 'Tijd',
  'support.log.col.level': 'Niveau',
  'support.log.col.organisation': 'Organisatie',
  'support.log.col.migration': 'Migratie',
  'support.log.col.event': 'Gebeurtenis',
  'support.log.col.category': 'Categorie',
  'support.log.col.reference': 'Referentie',
  'support.log.col.actor': 'Wie',
  'support.log.forOrganisation': 'Het logboek van deze organisatie',
  'support.log.forMigration': 'Het logboek van deze migratie',
  'support.export.heading': 'Auditexport',
  'support.export.lead': 'Elke auditgebeurtenis als JSON-regel, oudste eerst, voor je eigen logopslag.',
  'support.export.lead.why':
    'Dezelfde regels die de API afdrukt wanneer een gebeurtenis wordt vastgelegd, teruggelezen uit het auditlog: een adres of een bestandsnaam staat erin als pseudoniem. Laat het veld leeg om bij de eerste gebeurtenis te beginnen, of vul de cursor van de vorige download in om daar verder te gaan. Gebeurtenissen van de laatste vijf minuten komen mee met de volgende download. Elke opgehaalde pagina wordt vastgelegd als één inzage van alle klanten.',
  'support.export.after': 'Beginnen na (optioneel)',
  'support.export.download': 'Downloaden',
  'support.export.busy': 'Bezig met downloaden… regels tot nu toe: {count}',
  'support.export.done': 'Regels gedownload: {count}. In het veld staat nu waar de volgende download begint.',
  'support.export.nothing': 'Niets nieuws na dat punt. Een gebeurtenis komt mee zodra die vijf minuten oud is.',
  'support.export.stopped': 'De download is gestopt: {message}',
  'support.export.kept': 'Regels bewaard: {count}. In het veld staat waar je verder kunt gaan.',
  'confirm.progress.lastSynced': 'laatst gesynchroniseerd',
  'verify.checkedAt': 'Geverifieerd',
  'queue.itemId': 'ID',
  'queue.loadFailed': 'Deze wachtrij kon niet worden geladen.',
  'queue.noMappings': 'Geen migraties geconfigureerd.',
  'discovery.scanning': 'Uw bron wordt gescand (alleen-lezen)…',
  'discovery.stillCounting': 'Nog aan het tellen: {domains}. Deze pagina werkt zichzelf bij.',
  'discovery.stillCounting.slow':
    'Nog aan het tellen: {domains}. Dit duurt langer dan normaal; herlaad om te kijken.',
  'discovery.countedEarlier':
    'Cijfers voor {domains} komen van een eerdere controle; de laatste poging mislukte.',
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
    'De melding van de aanbieder bij een telling die stopte wordt niet getoond: de persoon heeft dit account zelf gekoppeld, en de melding kan hun bestanden noemen.',
  'failure.withheld':
    'De eigen melding van de aanbieder wordt niet getoond: de persoon heeft dit account zelf gekoppeld, en de melding kan hun bestanden noemen. Support kan haar lezen via de referentie.',
  'failures.withheld':
    'Namen van items en de meldingen van de aanbieder worden niet getoond: de persoon heeft dit account zelf gekoppeld, en ze kunnen hun bestanden noemen. Elke fout zegt nog steeds wat voor fout het is en wat u kunt doen.',
  'discovery.colliding.pre.one': 'item dat al op uw bestemming staat, komt overeen met iets in uw bron. We',
  'discovery.colliding.pre.many': 'items die al op uw bestemming staan, komen overeen met iets in uw bron. We',
  'discovery.colliding.strong': 'behouden de kopie op de bestemming',
  'discovery.colliding.post': 'en overschrijven die niet. Al het andere dat er al staat, blijft onaangeroerd.',
  'discovery.refusedNative.kind.document': 'Google Documenten',
  'discovery.refusedNative.kind.spreadsheet': 'Google Spreadsheets',
  'discovery.refusedNative.kind.presentation': 'Google Presentaties',
  'discovery.refusedNative.kind.drawing': 'Google Tekeningen',
  'discovery.refusedNative.kind.paper': 'Dropbox Paper-documenten',
  'discovery.refusedNative.kind.other': 'Google-bestanden',
  'discovery.refusedNative.strong': 'worden niet gekopieerd',
  'discovery.refusedNative.post':
    'met dit exportformaat. Kies er een die ze wel omvat, of laat ze achter.',
  'confirm.refusedAck': 'Ik begrijp dat {kinds} ({n} bestanden) niet worden gekopieerd.',
  'applyFlag.readFailed': 'Kon niet lezen of handmatig verwijderen aan staat:',
  'applyFlag.on': 'Handmatig verwijderen staat AAN voor deze migratie.',
  'applyFlag.off': 'Handmatig verwijderen staat UIT voor deze migratie (de standaard).',
  'applyFlag.onMeans': 'Er wordt niets verwijderd totdat u bij een item op een verwijderknop drukt.',
  'applyFlag.turnOff': 'Uitschakelen',
  'applyFlag.refusesUntilOn':
    'De server weigert elke verwijderknop op dit scherm totdat dit is ingeschakeld.',
  'applyFlag.config.pre': 'Op deze appliance staat de waarde in het configuratiebestand van de mapping',
  'applyFlag.config.post': '; bewerk het bestand en herstart om dit te wijzigen. Geen API past dit aan.',
  'applyFlag.turnOn': 'Handmatig verwijderen inschakelen',
  'applyFlag.turnOnArmed': 'Bevestig: handmatig verwijderen inschakelen',
  'autoApply.on':
    'Automatisch verwijderen van oude kopieën van verplaatste bestanden staat AAN voor deze migratie.',
  'autoApply.off':
    'Automatisch verwijderen van oude kopieën van verplaatste bestanden staat UIT voor deze migratie (de standaard).',
  'autoApply.onButWaiting':
    'Automatisch verwijderen van oude kopieën van verplaatste bestanden staat AAN, en doet niets zolang handmatig verwijderen uit staat.',
  'autoApply.hint':
    'Werkt zonder u: alleen oude kopieën van verplaatste bestanden, nooit verwijderingen.',
  'autoApply.why':
    'Alleen wanneer dezelfde bytes aantoonbaar onder de nieuwe naam aanwezig zijn, de koppeling uniek is, de melding een volledige ronde heeft doorstaan en er geen massale gebeurtenis wordt vermoed. Alles wat wordt geweigerd blijft op het scherm Verplaatsingen voor u staan. Verwijderingen worden nooit automatisch verwijderd.',
  'autoApply.turnOn': 'Automatisch verwijderen inschakelen',
  'autoApply.turnOnArmed': 'Bevestig: oude kopieën onbeheerd verwijderen',
  'autoApply.turnOff': 'Automatisch verwijderen uitschakelen',
  'scope.migrates': 'Migreert',
  'scope.partial': 'Gedeeltelijk',
  'scope.doesNotMigrate': 'Migreert niet',
  'scope.title': 'Wat migreert, en wat niet',
  'login.title': 'Aanmelden bij Ownpace',
  'login.tagline': 'Soevereine datamigratie voor gezinnen en mkb',
  'login.tokenLabel': 'Toegangstoken',
  'login.invalidToken':
    'Dit lijkt geen geldig toegangstoken (sub, e-mail, tenantId en rol zijn vereist).',
  'login.expiredToken':
    'Dit token is verlopen; maak een nieuw token (seedscript of identityprovider) en plak dat.',
  'login.submit': 'Dit token gebruiken',
  'login.help.pre': 'Plak het toegangstoken uit het seedscript',
  'login.help.post': '\u2014 deze omgeving heeft geen identiteitsprovider ingesteld.',
  // ---- Signing in with the configured issuer (ADR-0042) ----
  'login.withProvider': 'Aanmelden',
  'login.redirecting': 'U wordt doorgestuurd om aan te melden…',
  'login.verifying': 'Token wordt gecontroleerd…',
  'login.pasteToggle': 'Aanmelden met een token',
  'login.pasteFallback':
    'Deze API gebruikt geen identiteitsprovider en accepteert dus een token uit het seedscript.',
  'login.oidcFailed': 'Wij konden de aanmeldservice niet bereiken.',
  'login.requestAccess': 'Nog geen account? Vraag toegang aan.',
  // ---- De API vragen wat zij accepteert (workplan 0102 T1) — zie het Engelse blok. ----
  'login.checking': 'Bezig met controleren hoe deze omgeving mensen aanmeldt…',
  'login.modeUnavailable':
    'Wij konden deze omgeving niet vragen welke aanmelding zij accepteert; nog niets aan te bieden.',
  'login.providerNotBuilt':
    'Aanmelden via identiteitsprovider, maar deze webbuild mist het adres: bouw opnieuw met VITE_OIDC_ISSUER en VITE_OIDC_CLIENT_ID.',
  'login.callback.working': 'U wordt aangemeld…',
  'login.callback.failed': 'Die aanmelding is niet voltooid.',
  'login.callback.again': 'Opnieuw proberen',
  // ---- Het doodlopende eind van een GESLAAGDE aanmelding — zie het Engelse blok. ----
  'login.noOrganisation': 'Uw account hoort nog niet bij een organisatie.',
  'login.noOrganisation.signedInAs': 'U bent aangemeld als {email}.',
  'login.noOrganisation.ask': 'Toegang aanvragen',
  'login.noOrganisation.already':
    'Al aangevraagd? Dan wacht het op een antwoord en hoort u het per e-mail.',
  'login.noOrganisation.already.why':
    'Nogmaals aanvragen kan geen kwaad: een tweede aanvraag terwijl de eerste openstaat wordt niet twee keer vastgelegd.',
  // ---- The access QUEUE (workplan 0093 T7) — see the English block. ----
  'nav.accessRequests': 'Toegangsverzoeken',
  'nav.support': 'Support',
  'nav.redirectUris': 'Omleidings-URI\u2019s',
  // ---- Zie het Engelse blok. ----
  'redirects.title': 'Omleidings-URI\u2019s',
  'redirects.intro':
    'De adressen waarnaar andere diensten een browser terugsturen; registreer elk adres exact zoals getoond.',
  'redirects.intro.more':
    'Ze worden opgebouwd uit de instellingen van deze omgeving, dus wat hier staat is wat er daadwerkelijk wordt gevraagd; elk adres moet in de console van die dienst worden geregistreerd.',
  'redirects.loading': 'Instellingen van deze omgeving lezen\u2026',
  'redirects.failed':
    'Kon ze niet lezen. De lijst wordt door de API opgebouwd; controleer of die draait.',
  'redirects.group.migration': 'Migratiebronnen \u2014 in de eigen OAuth-client van de aanbieder',
  'redirects.group.signIn': 'Aanmelden \u2014 in uw identiteitsprovider',
  'redirects.group.socialSignIn': 'Sociaal aanmelden \u2014 bij elke bovenliggende aanbieder',
  'redirects.none': 'Geen omleidings-URI te registreren.',
  'redirects.unconfigured':
    'Deze omgeving kent haar eigen adres nog niet, dus hier valt nog niets te tonen.',
  'redirects.unconfigured.why':
    'Stel dat eerst in: een gok registreren levert later een mismatch op, op het scherm van de aanbieder.',
  // ---- Een uitnodiging beantwoorden (workplan 0099) — zie het Engelse blok. ----
  'invite.title': 'U bent uitgenodigd',
  'invite.subtitle': 'Meedoen is uw keuze. Er gebeurt niets tot u die maakt.',
  'invite.none': 'Er wacht niets op u.',
  'invite.asRole': 'als {role}',
  'invite.accept': 'Meedoen',
  'invite.joining': 'Bezig met meedoen…',
  'invite.decline': 'Afwijzen',
  'invite.skip': 'Nu niet',
  'invite.skipHelp': 'Nu niet verandert niets; wij vragen het opnieuw bij uw volgende aanmelding.',
  'invite.skipHelp.why':
    'Afwijzen wordt vastgelegd, en alleen de organisatie kan u opnieuw uitnodigen.',
  'invite.confirmDecline':
    'De uitnodiging van {name} afwijzen? Alleen zij kunnen u opnieuw uitnodigen.',
  // "Aanvaarden", the texts' own word (terms §1, Alpha §2 and §11, privacy
  // §4.4), and "uitloggen", the nav's (review of 2026-09-29).
  'acceptance.title': 'Voordat u begint',
  'acceptance.changedTitle': 'De teksten zijn gewijzigd',
  'acceptance.lead': 'Lees deze drie teksten. Ze zeggen wat we met uw accounts en uw gegevens doen.',
  'acceptance.list': 'De teksten om te aanvaarden',
  'acceptance.doc.alpha': 'Voorwaarden voor de Alpha',
  'acceptance.doc.privacy': 'Privacyverklaring',
  'acceptance.doc.terms': 'Servicevoorwaarden',
  'acceptance.version': 'versie {version}',
  'acceptance.newVersion': 'nieuwe versie',
  'acceptance.newTab': '(opent in een nieuw tabblad)',
  'acceptance.changed': 'Een of meer teksten zijn gewijzigd sinds u ze voor het laatst aanvaardde.',
  'acceptance.record': 'We leggen vast welke versie van elke tekst u hebt aanvaard, in welke taal, en wanneer.',
  'acceptance.accept': 'Alle drie aanvaarden',
  'acceptance.accepting': 'Bezig met vastleggen…',
  'acceptance.notNow': 'Nu niet, uitloggen',
  'acceptance.notCurrent':
    'Deze teksten zijn gewijzigd terwijl deze pagina openstond. Lees de huidige versies en aanvaard die.',
  'acceptance.checking': 'Uw account wordt gecontroleerd…',
  'acceptance.readFailed': 'Uw account kon niet worden gelezen.',
  'acceptance.retry': 'Opnieuw proberen',
  'acceptance.fault.read': 'De fout ligt bij ons, niet bij u.',
  'acceptance.fault.record': 'Uw aanvaarding is niet vastgelegd: de fout ligt bij ons, niet bij u. Probeer het opnieuw.',
  'acceptance.unreachable': 'De dienst was niet bereikbaar. Controleer uw verbinding en probeer het opnieuw.',
  'acceptance.forbidden':
    'Dit account heeft geen toegang tot deze organisatie. Log uit en log in met het account waarmee u bent uitgenodigd.',
  'acceptance.refused':
    'Er is niets opgeslagen: de voorwaarden voor de Alpha, de privacyverklaring en de servicevoorwaarden waren nog niet aanvaard. Probeer het opnieuw zodra u ze hebt aanvaard.',
  'queue.title': 'Toegangsverzoeken',
  'queue.subtitle': 'Mensen die om toegang hebben gevraagd. Een mens leest deze.',
  'queue.empty': 'Er wacht niemand.',
  'queue.emptyDecided': 'Er is nog niets besloten.',
  'queue.tab.open': 'Wachtend',
  'queue.tab.granted': 'Toegekend',
  'queue.tab.declined': 'Afgewezen',
  'queue.asked': 'Gevraagd',
  'queue.orgLabel': 'Naam van de organisatie',
  'queue.orgHelp': 'Hoe deze organisatie gaat heten. Standaard wat zij hebben opgegeven.',
  'queue.noteLabel': 'Notitie (voor u, niet voor hen)',
  'queue.grant': 'Toegang geven',
  'queue.decline': 'Afwijzen',
  'queue.granting': 'Organisatie wordt aangemaakt…',
  'queue.granted': 'Toegekend. Zij worden eigenaar zodra zij zich voor het eerst aanmelden.',
  'queue.declined': 'Afgewezen. Het verzoek blijft vastgelegd.',
  'queue.decidedBy': 'Besloten door',
  'queue.confirmDecline': 'Dit verzoek afwijzen en hen mailen? Het blijft hoe dan ook vastgelegd.',
  'queue.confirmDeclineQuiet':
    'Dit verzoek afwijzen zonder hen te mailen? Het blijft hoe dan ook vastgelegd.',
  'queue.tellThem': 'Mail hen als u afwijst',
  'queue.tellThemHelp':
    'Een korte afwijzing in hun taal, zonder reden of uw notitie; uitvinken bij rommel.',
  'queue.tellThemHelp.why':
    'Dit formulier is openbaar, dus een verzonnen adres is van een onbekende. Bij toekennen mailen wij altijd; zo weten zij dat zij zich kunnen aanmelden.',
  'queue.alreadyOwnsHeading': 'Dit adres is al eigenaar van een organisatie',
  'queue.alreadyOwnsHelp':
    'Nogmaals toekennen maakt nóg een organisatie, met hen als eigenaar van beide; meestal dubbel gedrukt.',
  'queue.alreadyOwnsHelp.why':
    'De app moet hen dan bij elke aanmelding vragen welke zij bedoelen. Gaat het echt om een tweede organisatie, geef dat hieronder aan.',
  'queue.grantAnyway': 'Tweede organisatie aanmaken',
  'queue.grantAnywayCancel': 'Laat het zoals het is',
  'queue.mailSent': 'Wij hebben {email} gemaild.',
  'queue.mailOff':
    'Er is niemand gemaild — deze installatie verstuurt geen e-mail. Laat het {email} zelf weten.',
  'queue.mailFailed':
    'De e-mail aan {email} is niet verstuurd; laat het hen zelf weten, controleer de e-mailinstellingen.',
  'queue.mailSkipped': 'Er is niemand gemaild, zoals u vroeg.',
  'wizard.proto.imap.hint': 'Standaard e-mailprotocol',
  'wizard.google.connect': 'Verbinden met Google',
  'connections.googleFaces': 'Wat dit account gaat leveren',
  'wizard.google.connect.hint':
    'Opent het toestemmingsscherm van Google en vult het vernieuwingstoken in.',
  'wizard.google.connect.why': 'Een token plakken dat u al heeft, blijft gewoon werken.',
  'wizard.google.connect.needsDomains':
    'Vink eerst aan wat u wilt migreren; de toestemming vraagt alleen daarom.',
  'wizard.google.connect.needsClient': 'Vul eerst de Client-ID en het clientgeheim in.',
  'wizard.consent.received': 'Toestemming ontvangen — de verbinding wordt opgeslagen en getest.',
  'wizard.consent.noProvider':
    'Deze installatie heeft geen toestemmingsknop voor dit type; plak in plaats daarvan een vernieuwingstoken.',
  'wizard.consent.needsAccount': 'Vul eerst het accountadres in.',
  'wizard.consent.windowBlocked':
    'Uw browser heeft de pagina van {provider} niet geopend. Open die met deze link:',
  'wizard.consent.windowExpired': 'De link naar de pagina van {provider} is verlopen. Druk opnieuw op {button}.',
  'wizard.consent.legal': 'Wat we met uw gegevens doen, en onder welke voorwaarden:',
  'wizard.google.deploymentClient':
    'Deze installatie heeft een eigen Google-client; vul beide in om uw eigen te gebruiken.',
  'wizard.google.connect.halfClient':
    'Vul zowel de Client-ID als het clientgeheim in, of geen van beide.',
  'wizard.google.ownClient': 'Uw eigen Google-client gebruiken',
  // Zie het Engelse blok.
  'wizard.google.redirectUri':
    'Registreer dit exacte adres in uw Google-client onder Geautoriseerde omleidings-URI’s:',
  'wizard.google.readsOnly':
    'Voor e-mail, agenda’s en contacten beschrijft Google een ruimere toestemming dan Ownpace gebruikt. Ownpace leest alleen; het wijzigt en verwijdert niets in dit account.',
  'wizard.google.inAppBrowser':
    'Is deze pagina geopend in een andere app, zoals een chat- of mailapp? Kies daar \'Openen in browser\' of kopieer de link naar Safari of Chrome, en meld u in die browser aan bij Ownpace.',
  'wizard.dropbox.connect': 'Verbinden met Dropbox',
  'wizard.dropbox.connect.hint':
    'Opent het toestemmingsscherm van Dropbox en vult het vernieuwingstoken in.',
  'wizard.dropbox.connect.why': 'Een token plakken dat u al heeft, blijft gewoon werken.',
  'wizard.dropbox.connect.needsClient': 'Vul eerst de App key en het App secret in.',
  'wizard.dropbox.connect.halfClient':
    'Vul zowel de App key als het App secret in, of geen van beide.',
  'wizard.dropbox.deploymentClient':
    'Deze installatie heeft een eigen Dropbox-app; vul beide in om uw eigen te gebruiken.',
  'wizard.dropbox.ownClient': 'Uw eigen Dropbox-app gebruiken',
  'wizard.dropbox.redirectUri':
    'Registreer dit exacte adres in uw Dropbox-app onder OAuth 2 → Redirect URIs:',
  'wizard.microsoft.connect': 'Verbinden met Microsoft',
  'wizard.microsoft.connect.hint':
    'Opent het toestemmingsscherm van Microsoft en vult het vernieuwingstoken in.',
  'wizard.microsoft.connect.why':
    'Het vraagt u welk account, zodat een migratie niet stilletjes de verkeerde postbus leest. Een token plakken dat u al heeft, blijft gewoon werken.',
  'wizard.microsoft.connect.needsClient':
    'Vul eerst de toepassings-id (client) en het clientgeheim in.',
  'wizard.microsoft.connect.halfClient':
    'Vul zowel de toepassings-id (client) als het clientgeheim in, of geen van beide.',
  'wizard.microsoft.deploymentClient':
    'Deze installatie heeft een eigen Microsoft-appregistratie; vul beide in om uw eigen te gebruiken.',
  'wizard.microsoft.ownClient': 'Uw eigen appregistratie gebruiken',
  'wizard.microsoft.redirectUri':
    'Registreer dit exacte adres in uw appregistratie onder Verificatie → Omleidings-URI’s:',
  'wizard.microsoft.orgApproval':
    'Voor een werk- of schoolaccount kan eerst goedkeuring van de beheerder van uw organisatie nodig zijn. Voor een persoonlijk Microsoft-account niet.',
  'wizard.microsoft.tenantId.hint': 'Laat leeg tenzij uw appregistratie voor één tenant is.',
  'wizard.microsoft.tenantId.why':
    'Leeg betekent de mapinstelling van deze installatie, die elk werk-, school- of persoonlijk Microsoft-account accepteert. Een registratie voor één tenant die naar de verkeerde map wordt gestuurd, mislukt met een melding dat de toepassing niet is gevonden, wat op een typefout lijkt en het niet is.',
  'wizard.proto.apple.hint':
    'Eén Apple-account: e-mail, agenda’s, contacten en herinneringen, wat u aanvinkt.',
  'wizard.appleAppPassword': 'App-specifiek wachtwoord',
  'wizard.appleAppPassword.hint':
    'Niet uw Apple-accountwachtwoord: een app-specifiek wachtwoord van account.apple.com.',
  'wizard.appleAppPassword.why':
    'Apple weigert het accountwachtwoord hier met opzet. Maak er een aan op account.apple.com → Aanmelden en beveiliging → App-specifieke wachtwoorden en plak het hier. Het bereikt uw e-mail, agenda’s, contacten en herinneringen, en u kunt het daar altijd weer intrekken.',
  'wizard.proto.archive.hint':
    'Een gedownloade Google Takeout- of Apple-export (nog te testen): foto’s en bestanden.',
  'wizard.archiveProvider': 'Welke export',
  'wizard.archiveProvider.hint':
    'Welk bedrijf het archief maakte; bij de verkeerde keuze vinden we niets.',
  'wizard.archiveProvider.why':
    'Dat bepaalt hoe wij de export lezen, en aan de bestanden zelf is het niet te zien. Google-exports vraagt u aan op takeout.google.com, Apple-exports op privacy.apple.com.',
  'wizard.archiveProvider.untested': 'Nog te testen',
  'wizard.archiveProvider.noReader.apple-privacy':
    'Een Apple-export kunnen we nog niet lezen. Vraag die alleen aan voor uw eigen archief.',
  'wizard.archivePath': 'Waar het archief staat',
  'wizard.archivePath.hint':
    'De map waarin u de download hebt uitgepakt, of het .zip-bestand zelf.',
  'wizard.archivePath.why':
    'Bestaat de export uit meerdere delen, zet die dan in één map en wijs er een willekeurig deel van aan: wij lezen ze allemaal, en zeggen het als er een ontbreekt. Of pak ze eerst allemaal uit in dezelfde map. Er wordt niets naar geschreven: wij lezen alleen.',
  'wizard.archiveWhere': 'Waar de export staat',
  'wizard.archiveWhere.target': 'In een map in de bestanden van uw bestemming (Nextcloud of WebDAV)',
  'wizard.archiveWhere.disk': 'Op de schijf van deze appliance',
  'wizard.archiveWhere.disk.onlyAppliance': 'Alleen op een eigen appliance',
  'wizard.archivePath.target': 'Map in de bestanden van uw bestemming',
  'wizard.archivePath.target.hint': 'De map zoals u die in uw bestanden ziet, vanaf de hoofdmap.',
  'wizard.archivePath.target.why':
    'Bijvoorbeeld Exports/takeout-20260904, of één .zip in die map: de andere delen ernaast lezen wij ook. Zet de .zip-delen van de export in één map in de bestanden waar deze migratie naartoe schrijft, en vul die map hier in. De delen blijven daar na de migratie staan en nemen ruimte in; verwijder ze zodra u het resultaat hebt gecontroleerd.',
  'wizard.proto.microsoft.hint':
    'Eén Microsoft 365-account, één aanmelding: e-mail, agenda’s, contacten en OneDrive.',
  'wizard.group.provider': 'Uw aanbieder',
  'wizard.group.protocol': 'Elke server, via protocol',
  'frontDoor.experimental': 'Experimenteel',
  'frontDoor.experimental.why':
    'Gebouwd, maar nog niet gebruikt met een echt account van deze soort. Houd uw oude account aan en controleer wat er aankomt.',
  'frontDoor.experimental.wholeDomain.why':
    'Domeinbrede delegatie is gebouwd, maar nog niet gebruikt met een echte Workspace. Houd uw oude account aan en controleer wat er aankomt.',
  'wizard.m365.viaImap': 'Via IMAP',
  'wizard.m365.viaGraph': 'Via de Graph-API',
  'wizard.proto.oauth2.hint': 'IMAP met XOAUTH2, met Graph-terugval erachter (appregistratie)',
  'wizard.proto.graph.hint': 'Alleen de Graph-API (appregistratie)',
  'wizard.proto.google.hint': 'Eén Google-account, één aanmelding: agenda’s, contacten en taken.',
  // Dezelfde kaart waar de EIGEN Google-applicatie van deze omgeving de
  // restricted scopes draagt — zie het Engelse blok.
  'wizard.proto.google.hint.restricted':
    'Eén Google-account, één aanmelding: e-mail, agenda’s, contacten, bestanden en taken.',
  'wizard.proto.googleDrive.hint': 'Bestanden uit een Google Drive (alleen-lezen OAuth)',
  'wizard.proto.dropbox.hint': 'Bestanden uit een Dropbox (alleen-lezen OAuth-app)',
  'wizard.proto.box.hint': 'Bestanden uit een Box-account (alleen-lezen platform-app)',
  'wizard.boxUserId': 'Box-gebruikers-ID (numeriek)',
  'wizard.boxUserId.placeholder': 'bijv. 1234567890',
  'wizard.boxRootFolderId': 'ID van de hoofdmap',
  'wizard.boxRootFolderId.placeholder': 'Leeg = All Files',
  'wizard.review.boxUser': 'Box-gebruiker',
  'wizard.dropboxAppKey': 'App-sleutel',
  'wizard.dropboxRootPath': 'Pad van de hoofdmap',
  'wizard.dropboxRootPath.placeholder': 'bijv. /Team Docs',
  'wizard.browseDropboxFolders': 'Gedeelde mappen bekijken…',
  'wizard.noDropboxSharedFolders': 'Dit account ziet geen gedeelde mappen.',
  'wizard.dropboxUnmounted': 'niet gekoppeld — voeg deze eerst toe aan uw Dropbox',
  'wizard.review.wholeDropbox': 'de hele Dropbox',
  'wizard.proto.gmail.hint': 'E-mail uit een Gmail-postvak (OAuth via IMAP)',
  'wizard.proto.googleCalendar.hint': "Agenda's uit een Google-account (OAuth via CalDAV)",
  'wizard.proto.googleContacts.hint': 'Contacten uit een Google-account (OAuth via CardDAV)',
  'wizard.gmailAppPassword': 'App-wachtwoord',
  'wizard.gmailAppPassword.hint':
    'Alleen voor persoonlijke Google-accounts; laat leeg om OAuth te gebruiken.',
  'wizard.gmailAppPassword.why':
    'Google raadt het af, en wij ook: een app-wachtwoord opent de hele mailbox, terwijl een token met toestemming één ding opent. Het vereist tweestapsverificatie op het account, bestaat niet op een Workspace-account en wordt ingetrokken in de app-wachtwoordenlijst van het account zelf, zonder Ownpace aan te raken, wat het enige echte voordeel ervan is.',
  'wizard.refreshToken': 'Refresh-token',
  'wizard.refreshToken.hint':
    'Het gedelegeerde token van het account; behandel het als een wachtwoord.',
  'wizard.rootFolderId': 'Hoofdmap-ID',
  'wizard.rootFolderId.placeholder': 'Leeg = heel Mijn Drive',
  'wizard.review.myDrive': 'Mijn Drive',
  'wizard.targetPrefix': 'Doelmap (optioneel)',
  'wizard.targetPrefix.placeholder': 'Leeg = samenvoegen in het account',
  'wizard.targetPrefix.hint': 'Alles komt onder deze map terecht; leeg voegt samen in het account.',
  'wizard.targetPrefix.why':
    'Handig wanneer meerdere bronnen één doel delen en u per bron een submap wilt, zoals "Gmail". Leeg is de standaard: één account, één plek om te werken. Onder een map komen Verzonden en Concepten als gewone mappen daarbinnen terecht, in plaats van de Verzonden en Concepten van het account zelf te worden; een mailprogramma kan er maar één van elk hebben.',
  'settings.exportPolicy': 'Exportformaat voor Google-bestanden',
  'settings.exportPolicy.save': 'Dit formaat opslaan',
  'settings.exportPolicy.saving': 'Opslaan…',
  'settings.exportPolicy.saved': 'Opgeslagen. De volgende ronde gebruikt het.',
  'settings.exportPolicy.consequence':
    'Gewijzigde soorten worden onder hun nieuwe namen gekopieerd. Oude kopieën blijven, vermeld als eerdere exports.',
  'settings.exportPolicy.consequence.why':
    'Een Google-document heeft geen eigen bestandsnaam: het formaat geeft het er een (Rapport.docx, Rapport.odt), en aan de naam herkent een migratie een bestand. Onder een nieuw formaat kopieert de volgende ronde dus elk document onder de nieuwe naam. Op het nieuwe systeem wordt niets herschreven of verwijderd: een kopie in het oude formaat blijft staan, en het scherm Verwijderingen vermeldt die als eerdere export, nooit als verwijderd in Google. Behoud hem, of verwijder hem zelf op het nieuwe systeem. Geeft een nieuw formaat een document dezelfde naam, dan staat bij elke kopie onder welk formaat die is gemaakt, dus een latere ronde leest de wijziging als een formaatwijziging en nooit als een bewerking.',
  'settings.exportPolicy.refusedBefore':
    'De volgende ronde probeert Google-bestanden die het oude formaat weigerde opnieuw, in dit formaat.',
  'settings.exportPolicy.refusedBefore.why':
    'De naam van een Google-bestand komt van het formaat (Rapport.docx, Rapport.odt), en aan de naam herkent een migratie een bestand, dus onder een nieuw formaat is elk bestand nieuw voor de migratie. De volgende ronde probeert elk bestand onder de nieuwe naam, en de weigering die onder de oude naam is vastgelegd, sluit vanzelf, omdat het bestand niet meer onder die naam voorkomt. Kan het nieuwe formaat een bestand ook niet meenemen, dan staat het één keer bij Mislukkingen, onder de nieuwe naam. Opslaan verandert zelf niets: de ronde doet het. Een bestand dat u hebt laten liggen, blijft liggen.',
  'settings.exportPolicy.toFailures': 'Bekijk ze bij Mislukkingen',
  'settings.exportPolicy.refusedBefore.count':
    'De volgende ronde probeert {count} Google-bestand(en) die het oude formaat weigerde opnieuw, in dit formaat.',
  'settings.exportPolicy.refused': 'Dit kon niet worden gewijzigd:',
  'settings.exportPolicy.failed': 'Dat is niet opgeslagen:',
  'settings.exportPolicy.paper': 'Exportformaat voor Paper-documenten',
  'settings.exportPolicy.paper.consequence':
    'Paper-documenten worden opnieuw gekopieerd onder hun nieuwe namen. Oude kopieën blijven, vermeld als eerdere exports.',
  'settings.exportPolicy.paper.consequence.why':
    'Een Paper-document heeft geen eigen bestandsnaam: het formaat voegt er een toe aan de naam (Notities.paper.md, Notities.paper.html), en aan de naam herkent een migratie een bestand. Onder een nieuw formaat kopieert de volgende ronde dus elk Paper-document onder de nieuwe naam. Op het nieuwe systeem wordt niets herschreven of verwijderd: een kopie in het oude formaat blijft staan, en het scherm Verwijderingen vermeldt die als eerdere export, nooit als verwijderd in Dropbox. Behoud hem, of verwijder hem zelf op het nieuwe systeem.',
  'settings.exportPolicy.paper.refusedBefore':
    'De volgende ronde probeert de Paper-documenten die tot nu toe bleven staan opnieuw, in dit formaat.',
  'settings.exportPolicy.paper.refusedBefore.count':
    'De volgende ronde probeert {count} Paper-document(en) die tot nu toe bleven staan opnieuw, in dit formaat.',
  'settings.exportPolicy.paper.refusedBefore.why':
    'Onder een formaat komt een Paper-document aan onder een nieuwe naam (Notities.paper.md), dus het is nieuw voor de migratie. De volgende ronde kopieert elk document, en de regel die onder de oude naam is vastgelegd, sluit vanzelf, omdat het document niet meer onder die naam voorkomt. Een document dat Dropbox niet in dit formaat aanbiedt, staat één keer bij Mislukkingen, met die reden. Opslaan verandert zelf niets: de ronde doet het. Andere documenten die Dropbox in een eigen formaat bewaart, blijven staan.',
  'settings.schedule': 'Hoe vaak naar wijzigingen kijken',
  'settings.schedule.default': 'Nu: elk kwartier, omdat deze migratie geen eigen schema heeft.',
  'settings.schedule.own': 'Nu: {schedule}, buiten deze pagina ingesteld.',
  'settings.schedule.hint': 'Rondes lopen direct na elkaar tot de eerste kopie klaar is.',
  'settings.schedule.hint.why':
    'Een ronde duurt hoogstens 50 minuten. Tot elk gegevenstype één keer volledig is gekopieerd, start de volgende ronde zodra de vorige klaar is, en niet eerder dan 15 minuten na de start ervan, wat dit schema ook zegt. Een daglimiet voor downloaden bij de bron wordt eerst afgewacht. Daarna volgen de rondes dit schema en kopiëren ze alleen wat nieuw of gewijzigd is. Items die niet gekopieerd konden worden, houden de rondes niet aan de gang: ze wachten bij Mislukkingen.',
  'settings.schedule.save': 'Dit schema opslaan',
  'settings.schedule.saving': 'Opslaan…',
  'settings.schedule.saved': 'Opgeslagen. De volgende ronde volgt het.',
  'settings.schedule.refused': 'Dit kon niet worden gewijzigd:',
  'settings.schedule.failed': 'Dat is niet opgeslagen:',
  'settings.kinds': 'Gegevenstypen die deze migratie kopieert',
  'settings.kinds.add': '{kind} toevoegen',
  'settings.kinds.adding': 'Toevoegen…',
  'settings.kinds.added': '{kind} toegevoegd. De volgende ronde kopieert het.',
  'settings.kinds.consequence':
    'Een toegevoegd gegevenstype wordt vanaf de volgende ronde gekopieerd. Wat al gekopieerd is, verandert niet.',
  'settings.kinds.consequence.why':
    'Het nieuwe gegevenstype wordt vanaf de volgende ronde volledig gekopieerd, zoals elk gegevenstype de eerste keer: ronde na ronde, wat het schema ook zegt, tot het één keer is gekopieerd. De gegevenstypen die deze migratie al kopieert, gaan verder waar ze waren. Een gegevenstype kan hier niet meer worden weggehaald: wat het al had gekopieerd, zou op het nieuwe systeem blijven staan zonder dat iets het nog bijwerkt.',
  'settings.kinds.failed': 'Dat is niet toegevoegd:',
  'settings.kinds.stop': '{kind} stoppen',
  'settings.kinds.resume': '{kind} hervatten',
  'settings.kinds.stopping': 'Stoppen…',
  'settings.kinds.resuming': 'Hervatten…',
  'settings.kinds.stoppedByYou': 'door u gestopt',
  'settings.kinds.stopped': '{kind} is gestopt. De kopieën blijven; hervat het om verder te gaan waar het stopte.',
  'settings.kinds.resumed': '{kind} is hervat. De volgende ronde gaat verder waar het stopte.',
  'settings.kinds.stop.consequence':
    'Een gestopt gegevenstype houdt wat het gekopieerd heeft, maar volgt de bron niet meer. Hervatten gaat verder waar het stopte.',
  'settings.kinds.stop.consequence.why':
    'Voor een account dat eerder sluit dan de andere: stop de e-mail op de dag dat het oude postvak sluit, terwijl agenda en contacten blijven kopiëren. Aan geen van beide kanten wordt iets verwijderd. Het laatste gegevenstype dat nog kopieert, kan niet worden gestopt; wilt u alles stoppen, beëindig dan de migratie.',
  'settings.kinds.held.lastOne':
    'Het laatste gegevenstype dat nog kopieert. Wilt u het stoppen, beëindig dan de migratie.',
  'settings.kinds.held.notRunning': 'Dit kan worden hervat zodra de migratie weer loopt.',
  'settings.kinds.stop.failed': 'Dat is niet gewijzigd:',
  'wizard.serviceAccountKey': 'Serviceaccount-sleutel',
  'wizard.serviceAccountKey.placeholder': 'Plak het volledige JSON-sleutelbestand',
  'wizard.serviceAccountKey.width':
    'Deze sleutel kan elke gebruiker in het domein lezen; trek hem bij de overstap in.',
  'wizard.serviceAccountKey.why':
    'Domeinbrede delegatie kan elke Workspace-gebruiker lezen, al benoemt elke migratie nog steeds één account. Autoriseer alleen de benodigde scopes in de Admin-console en trek de delegatie bij de overstap weer in.',
  'wizard.browseSharedDrives': 'Gedeelde Drives en mappen bekijken…',
  'wizard.noSharedDrives':
    'Geen gedeelde Drives of mappen zichtbaar; een lege hoofdmap migreert Mijn Drive.',
  'wizard.sharedDrivesGroup': 'Gedeelde Drives',
  'wizard.sharedFoldersGroup': 'Met mij gedeelde mappen',
  'wizard.nativePolicy': 'Google Documenten, Spreadsheets, Presentaties en Tekeningen',
  'wizard.nativePolicy.hint':
    'Hiervan is geen bestand te kopiëren, alleen een weergave van Google.',
  'wizard.nativePolicy.hint.why':
    'Een Google-document staat bij Google, niet in een bestand: er is niets om over te zetten. Drive kan er een document of een PDF van maken, en díe weergave zou aankomen. Ze laten staan is het alternatief, en de standaard.',
  'wizard.nativePolicy.leave': 'Laten staan, en elk bestand melden',
  'wizard.nativePolicy.as.odf': 'OpenDocument ({ext})',
  'wizard.nativePolicy.as.office': 'Microsoft Office ({ext})',
  'wizard.nativePolicy.as.pdf': 'PDF ({ext}), niet bewerkbaar',
  'wizard.nativePolicy.as.image': 'Afbeelding ({ext})',
  'wizard.nativePolicy.as.leftBehind': '{format}: blijft staan',
  'wizard.nativePolicy.editable': 'Kies voor elke soort een bewerkbaar formaat',
  'wizard.nativePolicy.leftBehind': '{kinds} blijven staan in Google, elk met naam gemeld.',
  'wizard.nativePolicy.leftBehind.why':
    'Er wordt niets van gekopieerd en niets gaat verloren: elk bestand verschijnt met naam op het scherm Mislukkingen, en u accepteert of probeert ze per stuk of in één keer. Formulieren, My Maps, Sites en Apps Scripts blijven altijd staan: die kan Google in geen enkel formaat exporteren.',
  'wizard.nativePolicy.notEditable': '{kinds} komen aan als PDF, die achteraf niet te bewerken is.',
  'wizard.nativePolicy.notEditable.why':
    'Een PDF legt vast hoe het document eruitziet: er komt nooit weer een Google-document uit, en fijne opmaak kan verschuiven. Kies het voor een soort die u gekopieerd wilt hebben, maar niet hoeft te bewerken.',
  'wizard.nativePolicy.allEditable': 'Alle vier de soorten komen aan als bestanden die u kunt bewerken.',
  'wizard.nativePolicy.allEditable.why':
    'Elk bestand komt aan als weergave van Google, niet als origineel: fijne opmaak kan verschuiven, en tekeningen komen aan als .svg-afbeelding omdat Drive geen bewerkbaar formaat voor tekeningen aanbiedt. U kunt een formaat later wijzigen; al gekopieerde bestanden houden het formaat waarin ze aankwamen.',
  'wizard.paperFormat': 'Dropbox Paper-documenten',
  'wizard.paperFormat.hint': 'Ze hebben geen bestand om te kopiëren, alleen een export van Dropbox.',
  'wizard.paperFormat.hint.why':
    'Een Paper-document staat in Dropbox, niet in een bestand: er valt niets te downloaden. Dropbox kan het exporteren als Markdown of HTML, en die export komt aan, onder de eigen naam van het document met de extensie van het formaat erachter: Notities.paper komt aan als Notities.paper.md. Paper-sjablonen volgen dezelfde keuze. Laten staan is het alternatief.',
  'wizard.paperFormat.leave': 'Laten staan, en elk document melden',
  'wizard.paperFormat.as.markdown': 'Markdown (.md), opent in Nextcloud Text',
  'wizard.paperFormat.as.html': 'HTML (.html), opent in een webbrowser',
  'wizard.paperFormat.leftBehind': 'Paper-documenten blijven staan in Dropbox, elk met naam gemeld.',
  'wizard.paperFormat.leftBehind.why':
    'Er wordt niets voor gekopieerd en er gaat niets verloren: elk document staat met zijn naam bij Mislukkingen, en u kunt er later een formaat voor kiezen, of ze laten staan.',
  'wizard.paperFormat.arrives': 'Elk Paper-document komt aan als {ext}-bestand dat u kunt bewerken.',
  'wizard.paperFormat.arrives.why':
    'Een export is een weergave die Dropbox maakt, niet het Paper-document zelf: fijne opmaak kan verschuiven, en wat u op het nieuwe systeem wijzigt, gaat niet terug naar Dropbox. U kunt het formaat later wijzigen; al gekopieerde documenten houden het formaat waarin ze aankwamen.',
  'wizard.step.migration': 'Migratie',
  'wizard.testConnections.reused': 'Al bewaard; dit controleert alleen of hij nog werkt.',
  'wizard.connectionName': 'Naam voor dit account',
  'wizard.connectionName.taken':
    'Deze naam bestaat al; hij wordt bewaard, maar twee gelijke namen zijn lastig te onderscheiden.',
  'wizard.testConnections.kept':
    'De gegevens zijn bewaard: corrigeer ze en probeer opnieuw, of kom later terug via Accounts.',
  'wizard.testConnections': 'Verbindingen testen en bewaren',
  'wizard.testing': 'Testen…',
  'wizard.testConnections.hint':
    'Meldt zich alleen-lezen aan beide kanten aan; werkende kanten worden bewaard.',
  'wizard.testConnections.why':
    'Het toont wat zichtbaar is en schrijft niets naar beide systemen. Een kant die werkt wordt als verbinding bewaard, zodat u die inloggegevens niet opnieuw hoeft op te halen als u de wizard verlaat.',
  'wizard.proto.jmap.hint': 'Modern e-mailprotocol',
  'wizard.proto.caldav.hint': 'Agendaprotocol',
  'wizard.proto.carddav.hint': 'Contactenprotocol',
  'wizard.proto.webdav.hint': 'Bestandsopslag',
  'wizard.proto.soverin.hint': 'Eén account — e-mail, agenda’s en contacten',
  'wizard.proto.nextcloud.hint':
    'Eén account — agenda’s, contacten, bestanden en taken (geen e-mail)',
  'wizard.title': 'Migratie aanmaken',
  'wizard.stepHeading': 'Stap {n} van {total}: {step}',
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
  'wizard.targetDavUrl': 'DAV-basis-URL',
  'wizard.targetDavUrl.hint': 'Alleen wanneer de DAV-root van de server niet op de hostroot staat.',
  'wizard.targetDavUrl.why':
    'Indien ingevuld wordt deze volledige URL gebruikt en worden host en poort genegeerd.',
  'wizard.nextcloudDavUrl.hint':
    'Het adres waarop u Nextcloud opent, met /remote.php/dav erachter.',
  'wizard.nextcloudDavUrl.why':
    'Nextcloud biedt agenda’s, contacten en bestanden aan onder /remote.php/dav en niet op de root van de site, dus een host en poort kunnen niet zeggen waar het staat. Plak het adres uit de adresbalk — https://cloud.example.com — en zet er /remote.php/dav achter.',
  'wizard.soverinMailHost': 'Mailserver',
  'wizard.soverinMailHost.hint': 'Alleen nodig als dit account ook e-mail gaat ontvangen.',
  'wizard.soverinMailHost.why':
    'Agenda’s en contacten hebben geen mailserver nodig. Test meet de host die u invult; er wordt niets aangenomen op basis van de naam van de aanbieder.',
  'wizard.soverinMailPort': 'Mailpoort',
  'wizard.providerDefaults.note':
    'Vooraf ingevuld met de gepubliceerde instellingen van {provider}, gelezen op {seen}. Test controleert ze.',
  'wizard.useSsl': 'SSL/TLS gebruiken',
  'wizard.migrationName': 'Naam van de migratie',
  'wizard.migrationName.placeholder': 'Bijvoorbeeld: mail van Anna',
  'wizard.progress': 'Voortgang',
  'wizard.credentials': 'Inloggegevens',
  'form.requiredLegend': 'Velden met * zijn verplicht.',
  'wizard.sourceUsername': 'Gebruikersnaam',
  'wizard.sourcePassword': 'Wachtwoord',
  'wizard.targetUsername': 'Gebruikersnaam',
  'wizard.targetPassword': 'Wachtwoord',
  'wizard.selectDataTypes': 'Kies de te migreren gegevenstypen',
  'wizard.domain.email.hint': 'E-mailberichten en mappen',
  'wizard.domain.calendar.hint': 'Afspraken en agenda-items',
  'wizard.domain.contact.hint': 'Adresboekvermeldingen',
  'wizard.domain.file.hint': 'Bijlagen en documenten',
  'wizard.domain.task.hint': 'Takenlijsten en de taken daarin',
  'wizard.schedule': 'Synchronisatieschema',
  'wizard.scheduleHint':
    'Hoe vaak het herhaalt na de eerste kopie, die start zodra u op starten drukt en niet op dit schema wacht.',
  'wizard.schedule.hourly': 'Elk uur',
  'wizard.schedule.hourly.hint': 'Ieder uur',
  'wizard.schedule.daily': 'Dagelijks',
  'wizard.schedule.daily.hint': 'Elke dag om 02:00',
  'wizard.schedule.sixHourly': 'Elke 6 uur',
  'wizard.schedule.sixHourly.hint': 'Vier keer per dag',
  'wizard.schedule.quarterHourly': 'Elk kwartier',
  'wizard.schedule.quarterHourly.hint': 'Frequente synchronisatie',
  'wizard.readyToCreate': 'Klaar om de migratie aan te maken',
  'wizard.reviewDetails': 'Migratiegegevens',
  'wizard.review.name': 'Naam',
  'wizard.review.source': 'Bron',
  'wizard.review.target': 'Doel',
  'wizard.review.schedule': 'Schema',
  'wizard.review.scheduleDefault': 'Dagelijks om 02:00',
  'wizard.review.dataTypes': 'Gegevenstypen',
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
    'Versleuteld opgeslagen, alleen gebruikt om te verbinden, en nooit meer getoond.',
  'wizard.tenantId': 'Tenant-ID',
  'wizard.clientId': 'Client-ID (applicatie-ID)',
  'wizard.sourceClientSecret': 'Clientgeheim',
  'wizard.domain.notForTarget': 'Niet beschikbaar via het gekozen doelprotocol.',
  'wizard.domain.measuredNo':
    'Dit account kan dit niet dragen; test het opnieuw als dat veranderd is.',
  'wizard.domain.unmeasured': 'Nog niet gemeten voor dit account; een test geeft het antwoord.',
  'wizard.leaveConfirm': 'Deze wizard verlaten? Alles wat u hier hebt ingevuld gaat verloren.',
  'billing.title': 'Facturatie',
  'billing.subtitle': 'Beheer uw abonnement, verbruik en betalingen',
  'billing.currentUsage': 'Huidig verbruik',
  'billing.storage': 'Opslag',
  'billing.dataTransfer': 'Dataverkeer',
  'billing.computeTime': 'Rekentijd',
  'billing.hours': 'uur',
  'billing.apiCalls': 'API-aanroepen',
  // ADR-0014's tier, on the customer's own usage screen (0121 T4).
  'billing.yourTier': 'Waar u hiermee op uitkomt',
  'billing.tierSetup': 'inrichting',
  'billing.tierPerMonth': 'per maand',
  'billing.tierFree': 'Gratis: op dit pakket wordt niets gefactureerd',
  'billing.tierDecidedByPaths': 'Bepaald door hoeveel migraties tegelijk liepen.',
  'billing.tierDecidedByData': 'Bepaald door hoeveel gegevens er verplaatst zijn.',
  'billing.tierDecidedByBoth':
    'Bepaald door zowel wat er tegelijk liep als hoeveel er verplaatst is.',
  'billing.tierPeakPaths': 'Meeste migraties tegelijk',
  'billing.tierDataMoved': 'Verplaatst, alle maanden',
  'billing.tierBeyondTable':
    'Voorbij de gepubliceerde tabel — neem contact op, dan prijzen we het goed.',
  'billing.noUsage': 'Nog geen verbruiksgegevens beschikbaar',
  'billing.ceiling.title': 'Uw datalimiet',
  'billing.ceiling.moved': '{moved} van {ceiling} verplaatst, op {tier}.',
  'billing.ceiling.bands': 'Inclusief {count} extra blok(ken) bijgekocht.',
  'billing.ceiling.under':
    'Vanaf 80% van de limiet biedt deze kaart de twee wegen verder: naar een groter pakket, of eenmalig een extra blok.',
  'billing.ceiling.near':
    'U hebt {share} van uw datalimiet verplaatst. Bij de limiet wachten nieuwe items tot u een weg verder kiest; wijzigingen aan wat al gekopieerd is gaan door.',
  'billing.ceiling.reached':
    'Uw datalimiet is bereikt. Nieuwe items wachten tot u een weg verder kiest; wijzigingen aan wat al gekopieerd is gaan door.',
  'billing.ceiling.alpha':
    'Tijdens de alfa wacht er niets bij de limiet en wordt niets in rekening gebracht, dus er is nog niets om mee in te stemmen. De prijzen hieronder zijn wat de wegen verder na de alfa kosten.',
  'billing.ceiling.moveUp':
    'Ga naar {tier}: eenmalig {setup}, daarna {monthly} per maand. Uw limiet wordt {ceiling}, en er kunnen {paths} migraties tegelijk lopen.',
  'billing.ceiling.moveUp.button': 'Ga naar {tier}',
  'billing.ceiling.talkToUs': 'Er is geen pakket boven {tier}. Neem contact op, dan prijzen we het goed.',
  'billing.ceiling.topUp':
    'Of koop eenmalig nog {band} erbij, voor {price}. Uw limiet wordt {ceiling}, en uw maandprijs blijft gelijk.',
  'billing.ceiling.topUp.button': 'Nog {band} erbij kopen',
  'billing.ceiling.noTopUp': '{tier} kent geen bijkoop: de weg verder is een groter pakket.',
  'billing.ceiling.breakEven':
    'Bijkopen kost eenmalig {extra} meer en bespaart {saved} per maand, dus het is in ongeveer {days} dag(en) terugverdiend.',
  'billing.ceiling.breakEven.cheaper': 'Bijkopen kost eenmalig niet meer, en bespaart {saved} per maand.',
  'billing.ceiling.betterBuy':
    'Een groter pakket is de betere koop als er meer migraties tegelijk moeten lopen: {next} draait er {nextPaths} tegelijk, {tier} {paths}.',
  'billing.ceiling.confirm.moveUp': 'U gaat akkoord met eenmalig {setup}, daarna {monthly} per maand, voor {tier}.',
  'billing.ceiling.confirm.topUp': 'U gaat akkoord met eenmalig {price} voor nog {band} erbij.',
  'billing.ceiling.confirm.yes': 'Ja, akkoord',
  'billing.ceiling.confirm.no': 'Nu niet',
  'billing.ceiling.done': 'Gedaan: uw datalimiet is nu {ceiling}.',
  'billing.ceiling.offerChanged':
    'Het aanbod is veranderd sinds deze pagina werd getoond, dus er is nergens mee ingestemd. Dit is het aanbod nu.',
  'billing.ceiling.loadFailed': 'Uw datalimiet kon niet worden gelezen',
  'billing.ceiling.yesFailed': 'Uw akkoord is niet vastgelegd:',
  'billing.invoices': 'Facturen',
  'billing.noInvoices': 'Nog geen facturen',
  'billing.invoice': 'Factuur',
  'billing.period': 'Periode:',
  'billing.paymentMethods': 'Betaalmethoden',
  'notifications.off': 'E-mailmeldingen staan uit',
  'notifications.offHint':
    'Niemand wordt gemaild als deze migratie een beslissing nodig heeft; stel SMTP in.',
  'notifications.offReason': 'Reden van de server:',
  'mappings.title': 'Migraties',
  'mappings.subtitle': 'Beheer uw datamigratieconfiguraties',
  'mappings.new': 'Migratie starten',
  'mappings.empty.title': 'Nog geen migraties',
  'mappings.empty.hint': 'Start er een: voor wie, van waar, wat en waarheen.',
  'mappings.empty.cta': 'Migratie starten',
  'mappings.th.name': 'Naam',
  'mappings.th.sourceTarget': 'Bron → Doel',
  'mappings.th.status': 'Status',
  'mappings.th.lastSync': 'Laatste synchronisatie',
  'mappings.th.actions': 'Acties',
  'mappings.action.triggerSync': 'Synchroniseer nu',
  'mappings.action.pause': 'Pauzeren',
  'hub.connections': 'Van {source} naar {target}',
  'hub.lands.folder': 'De kopieën komen in de map {folder} van de bestemming.',
  'hub.lands.merged': 'De kopieën komen in de eigen mappen van de bestemming.',
  'hub.details': 'Details',
  'hub.migrationId': 'Migratie-ID:',
  'timeLeft.label': 'Hoe lang:',
  'timeLeft.gmailDays': 'Ongeveer {low} tot {high} dagen, omdat Google een mailbox {ceiling} GB per dag laat downloaden.',
  'timeLeft.gmailWithinADay':
    'Binnen een dag, omdat deze mailbox minder bevat dan de {ceiling} GB per dag die Google laat downloaden.',
  'timeLeft.notKnownYet': 'Hangt af van de aanbieder; na het eerste uur weten we het.',
  'timeLeft.filesLater': 'De bestanden: na het eerste uur weten we het.',
  'timeLeft.copying.days': 'Ongeveer nog {low} tot {high} dagen, volgens de laatste {n} rondes.',
  'timeLeft.copying.hours': 'Ongeveer nog {low} tot {high} uur, volgens de laatste {n} rondes.',
  'timeLeft.copying.upToDays': 'Hoogstens nog {high} dagen, volgens de laatste {n} rondes.',
  'timeLeft.copying.upToHours': 'Hoogstens nog {high} uur, volgens de laatste {n} rondes.',
  'timeLeft.slowedBy': 'Vertraagd door {provider}.',
  'timeLeft.afterThreePasses': 'Na drie rondes weten we het; {n} tot nu toe.',
  'migrationReport.title': 'Rapport',
  'migrationReport.person.title': 'Rapport: {name}',
  'migrationReport.lead': 'Wat er is gevonden, wat er is aangekomen, wat niet mee kon en waarom, en wat de verificatie heeft vergeleken.',
  'migrationReport.loadFailed': 'Dit rapport kon niet worden gelezen.',
  'migrationReport.verdict.complete': 'Compleet: alles is aangekomen en niets wacht op een beslissing.',
  'migrationReport.verdict.decisionsPending': 'Alles is aangekomen, maar sommige items wachten nog op een beslissing.',
  'migrationReport.verdict.inProgress': 'Nog bezig: zo staat het nu, dit is geen afsluitend rapport.',
  'migrationReport.arrived.heading': 'Wat er is aangekomen',
  'migrationReport.col.type': 'Type',
  'migrationReport.col.found': 'Gevonden',
  'migrationReport.col.arrived': 'Aangekomen',
  'migrationReport.col.leftAsIs': 'Ongemoeid gelaten',
  'migrationReport.col.couldNotCome': 'Kon niet mee',
  'migrationReport.notCounted': 'niet geteld',
  'migrationReport.why': 'Waarom:',
  'migrationReport.seeWhich': 'Bekijk welke, en waarom',
  'migrationReport.notPart': 'Geen onderdeel van deze migratie: {types}.',
  'migrationReport.decisions.heading': 'Wat op een beslissing wacht',
  'migrationReport.decisions.none': 'Niets wacht op een beslissing.',
  'migrationReport.removed.heading': 'Wat er is verwijderd, en op wiens beslissing',
  'migrationReport.removed.counts':
    '{deletions} verwijderd na een beslissing, {relocations} oude kopieën van verplaatste items verwijderd, {refused} geweigerd door een beveiliging.',
  'migrationReport.removed.inTheLog': 'Elke verwijdering staat in het logboek en gebeurde alleen na een beslissing.',
  'migrationReport.sharing.heading': 'Meegenomen toegang',
  'migrationReport.sharing.counts': '{applied} opnieuw gemaakt, {manual} met de hand gedaan, {skipped} niet meegenomen, {open} nog open.',
  'migrationReport.check.heading': 'Wat de verificatie heeft vergeleken',
  'migrationReport.check.col.old': 'Op het oude systeem',
  'migrationReport.check.col.new': 'Op het nieuwe',
  'migrationReport.check.col.contents': 'Inhoud vergeleken',
  'migrationReport.check.compared': '{matched} van {sampled} gelijk',
  'migrationReport.access.heading': 'Toegang die u gaf en die alleen u kunt intrekken',
  'migrationReport.access.lead': 'Die werkt na deze migratie nog, tot u hem verwijdert. Dat kunnen wij niet voor u doen.',
  'migrationReport.asOf': 'Stand van {when}.',
  'migrationReport.download': 'Download het rapport',
  'migrationReport.toConfirmed': 'Wat is bevestigd, item voor item',
  'migrationReport.open': 'Het rapport',
  'confirmed.toReport': 'Wat er is gebeurd: het rapport',
  'mappings.action.pause.why':
    'Er worden geen nieuwe rondes gestart. Een ronde die al loopt, begint binnen ongeveer vijftien seconden niets nieuws meer en maakt af waar ze al aan begonnen was; een heel groot bestand kan langer duren. Er gaat niets verloren: Controleren en starten gaat verder waar het gebleven was.',
  'mappings.action.startSync': 'Start synchronisatie',
  'mappings.action.reviewAndStart': 'Controleren en starten',
  'mappings.action.open': 'Openen',
  'mappings.action.delete': 'Verwijderen',
  'mappings.delete.explain':
    'Verwijdert instellingen en registratie van de migratie; bij uw bron of bestemming wordt niets aangeraakt.',
  'mappings.delete.more':
    'Er wordt nergens e-mail, agenda, contact of bestand verwijderd. Stelt u later dezelfde migratie opnieuw in, dan herkent die wat er al staat en kopieert alleen wat nieuw is. Wat er al stond, wordt niet meer bijgewerkt als het bij de bron verandert, en wat u aan de nieuwe kant hebt verwijderd of verplaatst, komt terug. Wilt u wijzigingen blijven meenemen, pauzeer dan de migratie in plaats van die te verwijderen.',
  'mappings.delete.confirm': 'Migratie verwijderen',
  'mappings.delete.cancel': 'Annuleren',
  'mappings.delete.failed': 'De migratie is niet verwijderd.',
  'domain.email': 'E-mail',
  'domain.calendar': 'Agenda',
  'domain.contact': 'Contacten',
  'domain.file': 'Bestanden',
  'domain.task': 'Taken',
  'evidence.reported.title': 'De bron zelf meldde het object als weg.',
  'evidence.trashed.title': 'Gevonden in Verwijderde items van de eigenaar.',
  'evidence.inferred.title': 'Ontbreekt in volledige scans: een vermoeden, nooit toegepast.',
  'guidance.summary': 'Wat dit betekent en wat u kunt doen',
  'receipt.queued':
    'Verwijdering in de wachtrij; de taak controleert elk controlepunt opnieuw voordat iets wordt aangeraakt.',
  'receipt.applied.binned':
    'Verwijderd; nu in de prullenbak van het doel, mogelijk daar nog terug te halen.',
  'receipt.applied.deleted': 'Verwijderd — weg, zonder herstelmogelijkheid vanaf hier.',
  'receipt.applied.unknown':
    'Verwijderd. Hoe definitief de verwijdering was, staat niet op het ontvangstbewijs.',
  'receipt.failedPrefix': 'De verwijdertaak is mislukt:',
  'lifecycle.paused':
    'Deze migratie is niet gestart, dus er is niets gekopieerd en niets kan zijn afgeweken.',
  'hub.rename': 'Naam wijzigen',
  'hub.rename.label': 'Naam van deze migratie',
  'hub.rename.save': 'Opslaan',
  'hub.rename.saving': 'Opslaan…',
  'hub.rename.failed': 'Niet hernoemd:',
  'hub.fallbackTitle': 'Migratie',
  'hub.orderIntro': 'Werk ze van boven af, in deze volgorde.',
  'hub.noId': 'Geen mapping-id in het adres.',
  'hub.detailError':
    'De details van deze migratie konden niet worden gelezen — de schermen hieronder werken nog.',
  'hub.grantWithdrawn': 'Op {date} trok degene die gemigreerd wordt de toegang in. Er wordt niets meer gelezen.',
  'hub.grantWithdrawn.next':
    'Is die persoon akkoord om verder te gaan, stuur dan een nieuwe toegangslink. Links worden per persoon gemaakt: zie Links hieronder.',
  'hub.deletions.name': 'Verwijderingen',
  'hub.deletions.blurb':
    'Verwijderd op het oude systeem, nog op het nieuwe; uw beslissing, per item.',
  'hub.moves.name': 'Verplaatsingen',
  'hub.moves.blurb':
    'Items die het oude systeem heeft herschikt sinds ze zijn gekopieerd. Een oude kopie gaat pas als u die verwijdert, of door automatisch verwijderen als u dat hebt aangezet.',
  'hub.failures.name': 'Mislukkingen',
  'hub.failures.blurb':
    'Items die niet gekopieerd konden worden en op een persoon wachten; ze blokkeren het afronden.',
  'hub.sharing.name': 'Delen',
  'hub.sharing.blurb':
    'Wie wat kon bereiken op het oude systeem; een checklist voor na het afronden.',
  'sharing.title': 'Deel-checklist',
  'sharing.intro': 'Alles wat iemand anders kon bereiken op het oude systeem, één regel per recht.',
  'sharing.intro.more':
    'Werk elke regel af: pas het delen toe op het nieuwe systeem, vink af als handmatig gedaan, of sla bewust over. Afvinken en Overslaan werken allebei een regel af en leggen iets anders vast — Afvinken betekent dat dit recht handmatig opnieuw is ingericht, Overslaan dat het bewust niet meegaat. Na de omschakeling zijn dat verschillende antwoorden op "waarom kan deze persoon er niet meer bij". Elke afgewerkte regel onthoudt wie besliste, en wanneer.',
  'sharing.progressSettled': 'afgewerkt',
  'sharing.openManualNote':
    'regel(s) op handmatig: uw stappen op het nieuwe systeem; vink ze hier af zodra gedaan.',
  'sharing.rescan': 'Opnieuw inlezen van de bron…',
  'sharing.blindSpots': 'Kon niet worden geïnventariseerd — leg deze handmatig vast:',
  'sharing.empty': 'Nog geen gedeelde rechten. Lees opnieuw in van de bron om te scannen.',
  'sharing.apply': 'Delen toepassen op het nieuwe systeem',
  'sharing.applyArmed': 'Klik nogmaals — dit deelt ÉN nodigt uit',
  'sharing.done': 'Afvinken',
  'sharing.done.why': 'Dit recht is handmatig opnieuw ingericht op het nieuwe systeem.',
  'sharing.skip': 'Overslaan',
  'sharing.skip.why': 'Dit recht gaat bewust niet mee.',
  'sharing.linkShare': 'deel-link',
  'sharing.manualBadge': 'handmatig',
  'sharing.granteeLabel': 'delen met',
  'sharing.inviteNote':
    'Toepassen maakt het delen aan; het nieuwe systeem nodigt dit adres uit, controleer het eerst.',
  'sharing.state.applied': 'gedeeld op het nieuwe systeem',
  'sharing.state.doneManual': 'handmatig gedaan',
  'sharing.state.skipped': 'overgeslagen',
  'sharing.loadFailed': 'De deel-checklist kon niet worden gelezen.',
  'sharing.group.items': 'items',
  'sharing.group.unnamedFolder': 'Eén map (zelf niet gedeeld)',
  'sharing.group.holds': 'bevat',
  'sharing.group.sharedWith': 'Gedeeld met',
  'sharing.grant.link': 'iedereen met de link',
  'sharing.group.doneAll': 'Alles op gedaan zetten',
  'sharing.group.skipAll': 'Alles overslaan',
  'sharing.group.applyInside': 'Open de map om items op het nieuwe systeem te delen.',
  'sharing.group.applyFolder': 'Deze map delen op het nieuwe systeem',
  'sharing.group.applyFolderArmed': 'Druk nogmaals om ze allemaal uit te nodigen',
  'sharing.group.confirmFirst': 'Controleer elk adres voordat \u00e9\u00e9n druk ze allemaal uitnodigt.',
  'sharing.group.confirmFirst.why':
    'Het nieuwe systeem stuurt de uitnodiging zelf, zodra het delen is aangemaakt \u2014 een druk over een hele map is dus een golf echte mail naar echte mensen, en dat is niet terug te draaien. Daarom staat elk adres hier apart en bevestigt u ze stuk voor stuk: de tool stelt het adres voor dat het oude systeem vastlegde, en een mens beslist of deze persoon daar nog uitgenodigd moet worden. Een adres dat u hier bevestigt, onthouden we voor de andere regels van die persoon in deze migratie, zodat niemand dezelfde correctie twee keer typt.',
  'sharing.group.addressLabel': 'sturen naar',
  'sharing.group.confirmOne': 'Bevestigen',
  'sharing.group.confirmed': 'bevestigd',
  'sharing.group.stillToConfirm': 'Nog {count} adres(sen) te controleren.',
  'sharing.alone.unplaced': 'Het oude systeem gaf niet aan waar dit staat, dus het staat apart.',
  'sharing.alone.vsFolder': 'Anders gedeeld dan de map zelf',
  'sharing.alone.vsSiblings': 'Anders gedeeld dan de andere items hier',
  'sharing.alone.extra': 'extra:',
  'sharing.alone.missing': 'ontbreekt:',
  'sharing.notPlacedYet':
    'Gevonden voordat groeperen per map bestond. Ververs vanaf de bron om te vouwen.',
  'hub.check.name': 'Verificatie',
  'hub.check.blurb':
    'Vergelijk de twee systemen en controleer steekproeven van de inhoud, achter één knop.',
  'hub.confirmed.name': 'Bevestigd',
  'hub.confirmed.blurb':
    'Wat er in het nieuwe huis staat, item voor item, en wat is vergeleken.',
  'hub.finish.name': 'Afronden',
  'hub.finish.blurb':
    'De cutover-checklist; beëindigt de migratie in volgorde, met de ene stap die u zelf bevestigt.',
  'runs.title': 'Uitvoeringsgeschiedenis',
  'runs.blurb':
    'Elke synchronisatieronde van deze migratie, nieuwste eerst, met wat elke ronde meldde.',
  'runs.empty': 'Er zijn nog geen rondes uitgevoerd. Geschiedenis verschijnt na de eerste synchronisatie.',
  'runs.truncated': 'Alleen de nieuwste rondes worden getoond — oudere bestaan, maar staan niet in de lijst.',
  'runs.eventsTruncated': 'Alleen de nieuwste logregels — eerdere worden niet getoond.',
  'runs.error': 'Kon de uitvoeringsgeschiedenis van deze migratie niet lezen.',
  'runs.items.one': '1 item in deze ronde',
  'runs.items.many': '{n} items in deze ronde',
  'runs.errors.one': '1 fout',
  'runs.errors.many': '{n} fouten',
  'runs.events': 'Logboek',
  'grantLink.title': 'Toegangslinks',
  'grantLink.blurb':
    'Degene die gemigreerd wordt geeft zelf toegang, zonder u een wachtwoord te sturen.',
  'grantLink.why':
    'Een Ownpace-account is niet nodig. U stuurt de link zelf; Ownpace doet dat nooit en weet ook niet om wie het gaat.',
  'grantLink.expiryLabel': 'De link werkt',
  'grantLink.expiry.1': '1 dag',
  'grantLink.expiry.7': '7 dagen',
  'grantLink.expiry.30': '30 dagen',
  'grantLink.expiry.90': '90 dagen',
  'grantLink.expiry.180': '180 dagen',
  'grantLink.issue': 'Toegangslink maken',
  'grantLink.issuing': 'Bezig met maken…',
  'grantLink.issued.once': 'Hier is hij — dit is het enige moment waarop hij getoond kan worden.',
  'grantLink.issued.urlLabel': 'De toegangslink',
  'grantLink.issued.until': 'Hij werkt tot {date}.',
  'grantLink.issued.youSend':
    'Stuur hem zelf; niet opnieuw te tonen, dus bij verlies intrekken en opnieuw maken.',
  'grantLink.copy': 'Kopiëren',
  'grantLink.copied': 'Gekopieerd',
  'grantLink.empty': 'Nog geen links voor deze migratie.',
  'personLink.title': 'Eén toegangslink voor alles',
  'personLink.blurb':
    'Eén link voor alle Google-accounts van deze persoon: bij elk account één keer aanmelden, en elke migratie die het leest is verbonden.',
  'personLink.empty': 'Nog geen link voor deze persoon.',
  'personLink.asksAgain':
    'Elk Google-account van deze persoon is verbonden, dus deze link vraagt om elk account opnieuw te verbinden. Stuur hem als een verbinding niet meer werkt.',
  'personLink.view.title': 'Eén voortgangslink voor alles',
  'personLink.view.blurb':
    'Eén pagina waarop deze persoon alle eigen migraties volgt, zonder account, en gegeven toegang kan intrekken.',
  'personLink.view.empty': 'Nog geen voortgangslink voor deze persoon.',
  'grantLink.loadError': 'Kon de links van deze migratie niet lezen.',
  'grantLink.issuedBy': 'Gemaakt op {date} door {who}',
  'grantLink.issuedByGrant': 'Gemaakt op {date}, toen zij toegang gaven',
  'grantLink.worksUntil': 'Werkt tot {date}.',
  'grantLink.grantedOn': 'Op {date} is toegang gegeven. Deze link is verbruikt.',
  'grantLink.revokedOn': 'U hebt hem ingetrokken op {date}.',
  'grantLink.expiredOn': 'Op {date} verlopen zonder gebruikt te zijn.',
  'grantLink.expiredNudge':
    'Niemand heeft toegang gegeven. Maak een nieuwe link en stuur die opnieuw.',
  'grantLink.revoke': 'Intrekken',
  'grantLink.revokeArmed': 'Bevestig intrekken',
  'viewLink.title': 'Voortgangslinks',
  'viewLink.blurb': 'Een pagina waarop zij hun eigen migratie volgen, zonder account.',
  'viewLink.why':
    'Er staan alleen aantallen en statussen op — nooit een map, een bestand of een onderwerpregel — en juist daardoor is een langere geldigheid veilig. U stuurt hem zelf, en u kunt hem op elk moment intrekken. Ook een bron die geen Google is kan er een hebben: hij toont voortgang, hij vraagt niet om een wachtwoord.',
  'viewLink.issue': 'Voortgangslink maken',
  'viewLink.issued.urlLabel': 'De voortgangslink',
  'viewLink.empty': 'Nog geen voortgangslinks voor deze migratie.',
  'viewLink.expiredNudge': 'Hun pagina werkt niet meer. Maak een nieuwe als zij hem nog nodig hebben.',
  // De pagina van een migratie, nu een link van de persoon is (ADR-0035,
  // gewijzigd 2026-09-29; de eigenaar, 2026-10-03).
  'migrationLinks.title': 'Links',
  'migrationLinks.perPerson': 'Toegangs- en voortgangslinks worden per persoon gemaakt: één voor alle migraties van {name}.',
  'migrationLinks.openPerson': 'Pagina van {name} openen',
  'migrationLinks.whoFor': 'Voor wie is dit?',
  'migrationLinks.whoFor.why': 'Links worden per persoon gemaakt, dus kies eerst voor wie deze migratie is.',
  'migrationLinks.whoFor.save': 'Opslaan',
  'migrationLinks.peopleFailed': 'Kon niet lezen voor wie deze migratie is.',
  'migrationLinks.sent.grant': 'Eerder verstuurde toegangslinks',
  'migrationLinks.sent.view': 'Eerder verstuurde voortgangslinks',
  'migrationLinks.sent.blurb': 'Ze werken tot ze verlopen. Trek een link hier in als die eerder moet stoppen.',
  'migrationLinks.sent.why':
    'Links worden nu per persoon gemaakt. Een link die deze migratie eerder kreeg, blijft werken tot die verloopt, zodat wie hem heeft geen link krijgt die niet meer werkt.',
  'grant.title': 'Verbind uw account',
  'grant.loading': 'Een moment…',
  'grant.asking': '{organisation} migreert uw account naar een nieuwe provider en heeft uw toestemming nodig om te lezen wat erin zit.',
  'grant.reads': 'U staat op het punt toegang te geven tot {reads}.',
  'grant.reads.email': 'uw e-mail: berichten, mappen en labels',
  'grant.reads.calendar': 'uw agenda’s en de afspraken erin',
  'grant.reads.contact': 'uw contactpersonen',
  'grant.reads.file': 'uw bestanden in Google Drive',
  'grant.reads.task': 'uw taken',
  'grant.company': 'Bedrijf',
  'grant.companyChecked': 'Gecontroleerd in het EU-btw-register (VIES).',
  'grant.askedBy': 'Gevraagd door',
  'grant.phone': 'Telefoon',
  'grant.from': 'Van',
  'grant.to': 'Naar',
  'grant.toWhere': '{provider} op {host}',
  'grant.check': 'Kent u de vrager? Is de bestemming van u of uw organisatie? Alleen dan doorgaan.',
  'grant.readOnly':
    'Alleen lezen. Er wordt nooit iets verwijderd of gewijzigd in uw account, en niemand — niet de organisatie, niet Ownpace — ziet ooit uw wachtwoord. U logt zelf in bij Google, op de pagina van Google zelf.',
  'grant.readsOnly':
    'Ownpace leest alleen. Ownpace verwijdert of wijzigt nooit iets in uw account, en niemand — niet de organisatie, niet Ownpace — ziet ooit uw wachtwoord. U logt zelf in bij Google, op de pagina van Google zelf. Google kan de toestemming ruimer omschrijven: voor e-mail, agenda’s en contacten staat de toestemming die Ownpace vraagt ook wijzigingen toe. Ownpace brengt er geen aan.',
  'grant.scopeIntro': 'Google legt deze toestemming vast als:',
  'grant.until': 'Deze link werkt tot {date}.',
  'grant.signInAs': 'Log in als {account}. Google deelt uw adres ter controle; andere accounts worden geweigerd.',
  'grant.inAppBrowser':
    'Is deze pagina geopend in een andere app, zoals een chat- of mailapp? Kies daar \'Openen in browser\' of kopieer de link naar Safari of Chrome. De link blijft werken.',
  'grant.connect': 'Doorgaan met Google',
  'grant.person.asking':
    '{organisation} migreert uw accounts naar een nieuwe provider en heeft uw toestemming nodig om te lezen wat erin zit. Elk account hieronder vraagt het één keer.',
  'grant.person.migration': 'Naar {where}: {reads}.',
  'grant.person.where': '{account}, {place}',
  'grant.person.connect': 'Doorgaan met Google als {account}',
  'grant.person.connected': 'Verbonden. Voor dit account is niets meer nodig.',
  'grant.person.again':
    'Dit account was al verbonden. Wie u deze link stuurde, vraagt u het opnieuw te verbinden, bijvoorbeeld omdat de verbinding niet meer werkt.',
  'grant.person.connectAgain': 'Opnieuw verbinden met Google als {account}',
  'grant.connecting': 'Google wordt geopend…',
  'grant.disclosure': 'Door door te gaan gaat u akkoord met hoe uw gegevens worden behandeld:',
  'grant.privacy': 'Privacybeleid',
  'grant.terms': 'Voorwaarden',
  'grant.withdraw':
    'U kunt deze toegang op elk moment intrekken: op de voortgangspagina die u krijgt zodra u toegang hebt gegeven, of via de beveiligingsinstellingen van uw Google-account, bij de apps die toegang hebben.',
  'link.unreachable': 'Deze pagina kon de server niet bereiken. Controleer uw verbinding en probeer het opnieuw.',
  'link.unreadable':
    'Er ging iets mis op deze pagina. Probeer het later opnieuw; blijft het misgaan, laat het dan de persoon weten die u de link stuurde.',
  'answer.unreadable':
    'De server antwoordde in een vorm die deze pagina niet kent. Laad de pagina opnieuw; blijft het zo, meld het en geef daarbij het volgende door: referentie {reference}.',
  'reload.newer':
    'Er is een nieuwere versie van deze pagina. Laad de pagina opnieuw om die te gebruiken; wat u nog niet hebt opgeslagen, gaat daarbij verloren.',
  'reload.button': 'Pagina opnieuw laden',
  'view.title': 'Uw migratie',
  'view.loading': 'Een moment…',
  'view.who': '{organisation} migreert uw account naar een nieuwe provider.',
  'view.state.active': 'Uw spullen worden nu overgezet.',
  'view.state.paused': 'Het kopiëren ligt op dit moment stil.',
  'view.state.cutover': 'Uw nieuwe account is nu het account in gebruik.',
  'view.state.done': 'Uw migratie is klaar.',
  'view.state.continuous': 'Wat nieuw binnenkomt, wordt nog steeds overgezet.',
  'view.notStarted': 'Er is nog niets gekopieerd.',
  'view.notStarted.why':
    'Het kopiëren is nog niet begonnen, dus er valt hier nog niets te tellen. Dat is normaal in de eerste dag of twee: een migratie start zodra alles wat ervoor nodig is gekoppeld is, en deze pagina vult zich dan vanzelf. Er ontbreekt niets en er is niets misgegaan.',
  'view.copied.one': '{count} gekopieerd',
  'view.copied.many': '{count} gekopieerd',
  'view.upToDate': 'Bijgewerkt tot {date}.',
  'view.lastWorked': 'Nog bezig; laatst gewerkt op {date}.',
  'view.notYet': 'Nog niet begonnen.',
  'view.attention.one': 'Bij {count} item moet iemand even kijken.',
  'view.attention.many': 'Bij {count} items moet iemand even kijken.',
  'view.retrying.one': '{count} item wordt opnieuw geprobeerd.',
  'view.retrying.many': '{count} items worden opnieuw geprobeerd.',
  'view.moved': 'Tot nu toe {bytes} overgezet.',
  'view.failure.authExpired': 'De koppeling met uw account moet vernieuwd worden. Wie dit heeft ingesteld kan dat.',
  'view.failure.rateLimited': 'Uw provider vroeg ons rustiger aan te doen. Dit gaat vanzelf verder.',
  'view.failure.quotaExceeded': 'Een daglimiet is bereikt. Morgen gaat het kopiëren vanzelf verder.',
  'view.failure.policyRefused':
    'Sommige items bleven liggen door de instellingen van deze migratie, niet door uw accounts.',
  'view.failure.tooLarge':
    'Sommige bestanden bleven liggen: ze zijn groter dan deze dienst tijdens de alfa kopieert.',
  'view.failure.sourceRefused':
    'Uw oude account gaf sommige items niet vrij. Er ging niets naar uw nieuwe account.',
  'view.failure.targetRefused': 'Uw nieuwe account wilde sommige items niet aannemen.',
  'view.failure.formatRefused':
    'Uw nieuwe account accepteert sommige soorten bestanden niet. Wie dit uitvoert kan de indeling aanpassen.',
  'view.failure.network': 'Een server was niet bereikbaar. Dat is meestal kort en wordt opnieuw geprobeerd.',
  'view.failure.unknown': 'Iets wat we niet konden benoemen. Wie dit uitvoert kan er meer over zien.',
  'view.failure.side.source': 'Het ging om uw oude account.',
  'view.failure.side.target': 'Het ging om uw nieuwe account.',
  'view.until': 'Deze pagina werkt tot {date}.',
  'view.readOnly': 'Deze pagina toont alleen aantallen; er staat niets uit uw account op.',
  'view.state.withdrawn': 'Het kopiëren is gestopt: op {date} trok u de gegeven toegang in.',
  'view.grant.title': 'De toegang die u gaf',
  'view.grant.body': '{organisation} leest voor deze migratie uw Google-account, omdat u dat toestond.',
  'view.grant.whatHappens': 'Intrekken stopt het kopiëren. Wat al gekopieerd is, blijft waar het nu staat.',
  'view.grant.wholeApp': 'Google trekt het in voor de hele app; andere migraties die u toestond, stoppen ook.',
  'view.grant.withdraw': 'Toegang intrekken',
  'view.grant.confirm': 'Nu intrekken? Later verder gaan kan alleen met een nieuwe link van de afzender.',
  'view.grant.confirmYes': 'Ja, intrekken',
  'view.grant.keep': 'Niet intrekken',
  'view.grant.withdrawing': 'Bezig met intrekken…',
  'view.withdrawn.revoked': 'Klaar. Google bevestigde dat de toegang is ingetrokken, en hier is die verwijderd.',
  'view.withdrawn.notConfirmed': 'Hier verwijderd, dus deze migratie kan die niet gebruiken. Google bevestigde het intrekken niet.',
  'view.withdrawn.removeYourself': 'Verwijder voor de zekerheid zelf de app bij de apps met toegang:',
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
  'view.person.grant.body': '{organisation} leest dit Google-account voor de migraties hierboven, omdat u dat toestond.',
  'view.person.withdrawn.notConfirmed':
    'Hier verwijderd, dus deze migraties kunnen die niet gebruiken. Google bevestigde het intrekken niet.',
  'linkReport.open': 'Deze link melden',
  'linkReport.intro': 'Uw melding gaat naar het team van Ownpace, niet naar {organisation}.',
  'linkReport.description': 'Waarom twijfelt u aan deze link?',
  'linkReport.replyTo': 'Uw e-mailadres (niet verplicht)',
  'linkReport.replyTo.hint': 'Alleen als u antwoord wilt; we gebruiken het nergens anders voor.',
  'linkReport.sentWith':
    'Meegestuurd, uit onze gegevens: welke link dit is; de organisatie en de migratie waar hij bij hoort, met de stand van de migratie; het adres van wie de link heeft gemaakt; het account waaruit de migratie kopieert en het account waarnaar; en of u toegang hebt gegeven.',
  'linkReport.send': 'Melding versturen',
  'linkReport.sending': 'Versturen…',
  'linkReport.sent': 'Verstuurd. Uw melding heeft nummer {ticket}, en we antwoorden naar {email}.',
  'linkReport.sent.anonymous': 'Verstuurd. Uw melding heeft nummer {ticket}. Zonder adres kunnen we u niet antwoorden.',
  'linkReport.sent.mail': 'Verstuurd naar ons supportteam, met meldingskenmerk {reference}. We antwoorden per e-mail naar {email}.',
  'linkReport.sent.mail.anonymous':
    'Verstuurd naar ons supportteam, met meldingskenmerk {reference}. Zonder adres kunnen we u niet antwoorden.',
  'linkReport.next.grant': 'U hoeft niet door te gaan: er wordt niets gelezen zonder uw toestemming bij Google.',
  'linkReport.next.withdraw': 'Wilt u het kopiëren nu stoppen? Trek dan hierboven de toegang in.',
  'state.lifecycle.active': 'Actief',
  'state.lifecycle.paused': 'Gepauzeerd',
  'state.lifecycle.cutover': 'In cutover',
  'state.lifecycle.done': 'Afgerond',
  'state.lifecycle.continuous': 'Doorlopend',
  'state.stage.not_started': 'Nog niet gestart',
  'state.stage.paused': 'Gepauzeerd',
  'state.stage.copying': 'Wordt gekopieerd',
  'state.stage.kept_in_step': 'Wordt bijgehouden',
  'state.stage.ready_to_switch': 'Klaar om over te stappen',
  'state.stage.switching': 'Bezig met overstappen',
  'state.stage.done': 'Afgerond',
  'state.invoice.draft': 'Concept',
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
  'queue.waitingOnYou': 'Wacht op u',
  'queue.alreadyDecided': 'Al beslist',
  'moves.title': 'Verplaatst op het oude systeem',
  'moves.intro':
    'Items die de eigenaar elders onderbracht; aan geen van beide kanten is iets veranderd.',
  'moves.intro.more':
    'Het nieuwe systeem heeft ze nog waar wij ze plaatsten; elke regel is uw beslissing.',
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
    'Geaccepteerde items verdwijnen hier; de migratie gaat zonder ze verder, niet als mislukt geteld.',
  'failures.seeRuns': 'Bekijk de mislukte ronde (uitvoeringsgeschiedenis)',
  'failures.stillTrying': 'Wordt nog geprobeerd',
  'failures.empty.retrying': 'Er wordt niets opnieuw geprobeerd.',
  'failures.retry': 'Probeer opnieuw',
  'failures.retryCost':
    'Opnieuw proberen doorloopt alles opnieuw tot dit item, dus de volgende ronde duurt langer.',
  'failures.retryCost.why':
    'Het wist de synchronisatiecursors van deze migratie, zodat de hele bron opnieuw wordt doorlopen; er wordt niets dubbel gekopieerd.',
  'failures.accept': 'Migreer zonder dit item',
  'failures.acceptAll': 'Migreer zonder al deze items ({count})',
  'failures.group.title': 'Beslis over een hele groep',
  'failures.group.hint':
    'Een sindsdien opgeloste storing haalt deze items er niet zelf weer uit.',
  'failures.group.hint.why':
    'Geparkeerd zijn is een opgeslagen aantal pogingen, dus een oplossing uitrollen verlaagt dat niet — de items blijven staan terwijl de migratie zich voltooid noemt. Kies een soort, of typ een deel van de fout die de items delen, en dit beslist ze in één keer: opnieuw proberen wist ook eenmalig de synchronisatiecursors van deze migratie, en dat is wat de items weer vóór de volgende ronde zet. De tekst wordt letterlijk vergeleken, dus een % of een _ die je typt betekent een % of een _.',
  'failures.group.found': 'Groepen in deze wachtrij',
  'failures.group.items.one': '1 item',
  'failures.group.items.many': '{count} items',
  'failures.group.stillTrying.one': '1 wordt nog geprobeerd',
  'failures.group.stillTrying.many': '{count} worden nog geprobeerd',
  'failures.group.noCategory': 'Geen soort fout vastgelegd',
  'failures.group.noCategory.why':
    'Deze items mislukten voordat deze installatie per item een soort fout vastlegde. De volgende poging legt die vast en dan horen ze bij een groep. Tot dan kunt u ze \u00E9\u00E9n voor \u00E9\u00E9n beslissen, of via de fouttekst hieronder.',
  'failures.group.manual': 'Zoek in plaats daarvan op de fouttekst',
  'failures.group.domain': 'Soort',
  'failures.group.domain.any': 'Elke soort',
  'failures.group.error': 'Fout bevat',
  'failures.group.error.placeholder': 'MKCOL',
  'failures.group.matches': 'Past op {count} van de {total} hier.',
  'failures.group.needsNarrowing': 'Kies eerst een soort, of typ een deel van de fout.',
  'failures.group.retry': 'Probeer deze allemaal opnieuw',
  'failures.group.accept': 'Migreer zonder al deze items',
  'failures.try.one': 'poging',
  'failures.try.many': 'pogingen',
  'failures.parked': 'wacht op u',
  'deletions.title': 'Verwijderd op het oude systeem',
  'deletions.intro':
    'Items die de eigenaar bij de bron verwijderde; het nieuwe systeem heeft ze nog, onaangeroerd.',
  'deletions.empty.confirmed': 'Er wacht niets op een beslissing.',
  'deletions.watching': 'Wordt in de gaten gehouden',
  'deletions.empty.watching': 'Er wordt niets in de gaten gehouden.',
  'deletions.empty.acknowledged': 'Er is nog niets beslist.',
  'deletions.keep': 'Behoud onze kopie',
  'deletions.apply': 'Verwijder het hier ook',
  'deletions.applyArmed': 'Bevestig verwijderen',
  'deletions.earlierExports': 'Eerdere exports',
  'deletions.earlierExports.intro':
    'Kopieën die een eerder exportformaat achterliet. De documenten zijn niet verwijderd in Google.',
  'deletions.earlierExport.badge': 'eerdere export',
  'deletions.earlierExport.badgeTitle': 'Opnieuw geëxporteerd onder de nieuwe naam; dit is de oude kopie.',
  'common.loading': 'Laden…',
  'common.cancel': 'Annuleren',
  'common.close': 'Sluiten',
  'docs.title': 'Instelhandleidingen',
  'docs.all': '← Alle instelhandleidingen',
  'docs.notFound': 'Er is geen handleiding met die naam; deze horen bij deze versie:',
  'docs.otherLanguage': 'Deze handleiding is er nog niet in het Nederlands; hieronder staat de Engelse versie.',
  'docs.operatorDocs':
    "Draait u een eigen appliance? Instellingen en commando's staan in de beheerdersdocumenten in de repository.",
  'docs.ownAppFold': 'Alleen als u een eigen app wilt gebruiken',
  'mappings.lastSync': 'Laatste synchronisatie:',
  'mappings.never': 'Nooit',
  'mappings.filtered.lead': 'Alleen zichtbaar:',
  'mappings.filtered.clear': 'Toon alle migraties',
  'mappings.loadFailed': 'De migratielijst kon niet worden geladen.',
  'mappings.syncFailed': 'Het synchronisatieverzoek is niet voltooid.',
  'people.count.one': '1 persoon',
  'people.count.many': '{n} personen',
  'people.needYou.one': '1 wacht op u',
  'people.needYou.many': '{n} wachten op u',
  'people.fromTo': 'Van {from} naar {to}',
  'people.needsYou': 'Wacht op u: {n}',
  'people.needsUnknown': 'Kon niet tellen wat op u wacht.',
  'people.implicit': 'Uw migraties',
  'people.addMigration': 'Migratie toevoegen',
  'people.noneYet': 'Nog niets voor deze persoon.',
  'people.lastPass': 'Laatste ronde {when}',
  'people.noPassYet': 'Nog geen ronde',
  'people.line.waitsForExport': 'Wacht op de Takeout-export',
  'people.line.howToExport': 'zo maakt u er een',
  'people.line.lastPass': 'laatste ronde {when}',
  'people.line.leftAsIs': '{count} ongemoeid gelaten',
  'people.line.checkPassed': 'De verificatie is {when} geslaagd',
  'people.loadFailed': 'Kon niet laden bij wie elke migratie hoort.',
  'people.unassigned.title': 'Nog niet bij een persoon',
  'people.unassigned.hint': 'Voeg elke migratie toe aan de persoon voor wie ze is.',
  'people.addTo': 'Toevoegen aan',
  'people.addTo.submit': 'Toevoegen',
  'people.addTo.failed': 'De migratie is niet toegevoegd.',
  'people.notAdded': 'De migratie is gemaakt, maar niet aan de persoon toegevoegd.',
  'people.notAdded.where': 'Migraties toont haar onder Nog niet bij een persoon, waar één klik haar toevoegt.',
  'people.new.title': 'Persoon toevoegen',
  'people.new.name': 'Naam',
  'people.new.email': 'E-mailadres, voor een toegangslink (optioneel)',
  'people.new.submit': 'Persoon toevoegen',
  'people.new.failed': 'De persoon is niet toegevoegd.',
  // Migratie starten (0153 T4).
  'start.step': 'Stap {n} van {total}',
  'start.who.heading': 'Voor wie?',
  'start.who.someoneNew': 'Iemand anders',
  'start.who.whose': 'Wie meldt zich aan bij de accounts?',
  'start.who.myself': 'Ik',
  'start.who.someoneElse': 'Zij zelf, met een link',
  'start.who.someoneElse.line':
    'Een Google-account verbinden zij zelf, zodat u dat wachtwoord nooit in handen krijgt. Bij andere aanbieders meldt u zich samen aan.',
  'start.who.needName': 'Typ eerst een naam.',
  'start.who.peopleFailed': 'De mensen voor wie u migreert, konden niet worden gelezen. Een nieuwe naam werkt wel.',
  'start.from.heading': 'Welk account verlaat u?',
  'start.from.hint': 'Vink elk account aan dat u verlaat.',
  'start.from.otherMail': 'Een andere mailaanbieder',
  'start.from.otherMail.inSentence': 'een andere mailaanbieder',
  'start.from.needOne': 'Vink minstens één account aan.',
  'start.from.other': 'Andere manieren om te verbinden (IMAP)',
  'start.from.other.line':
    'Elke mailserver wordt via IMAP gelezen: dat is Een andere mailaanbieder. CalDAV, CardDAV, WebDAV en JMAP zijn bestemmingen, te kiezen bij Waar gaat het naartoe?',
  'start.from.other.choose': 'Een andere mailaanbieder kiezen',
  'start.byHand': 'Eén migratie handmatig toevoegen',
  'start.what.heading': 'Wat wilt u migreren?',
  'start.what.hint': 'Elke aanmelding vraagt alleen om wat u hier aanvinkt.',
  'start.what.from': 'Van {provider}',
  'start.what.notFrom': 'Niet van {provider}: {types}.',
  'start.what.notFrom.apple.why': 'Apple biedt niemand buiten Apple een weg naar iCloud Drive.',
  'start.what.notFrom.imap.why':
    'Via IMAP wordt alleen e-mail gelezen: voor de agenda en contacten van een mailaanbieder is hier nog geen weg.',
  'start.what.needOne': 'Vink minstens één ding aan om te migreren.',
  'start.what.photos': "Foto's",
  'start.what.export.google-takeout': "Foto's: uit een Takeout-export",
  'start.what.export.apple-privacy': "iCloud Drive en foto's: uit de export van Apple",
  'start.what.export.google-takeout.line':
    'U vraagt de export zelf aan bij Google en zet hem in uw nieuwe bestanden zodra hij binnen is.',
  'start.what.export.google-takeout.why':
    "Google laat andere apps alleen de foto's lezen die ze zelf hebben geüpload, dus de export is de enige weg naar een hele bibliotheek.",
  'start.what.export.askNow': 'Het klaarzetten kan een paar dagen duren, dus vraag hem nu aan:',
  'start.connect.heading': 'Uw accounts verbinden',
  'start.connect.googleApart': 'Google vraagt op deze dienst apart om e-mail en bestanden, dus dit zijn {n} aanmeldingen.',
  'start.connect.asks': 'Eén aanmelding: {types}',
  'start.connect.check': 'Aanmelding controleren',
  'start.connect.as': 'Verbonden als {account}',
  'start.connect.which': 'Welk account van {provider}',
  'start.connect.another': 'Een ander account',
  'start.connect.errored': 'De laatste controle is niet gelukt.',
  'start.connect.tryAgain': 'Opnieuw proberen',
  'start.connect.needAll': 'Verbind eerst elk account.',
  'start.connect.together': 'Geen link bereikt {provider}: meld u samen met {person} aan.',
  'start.connect.byLink': '{person} verbindt het zelf, met een link die u op het laatste scherm maakt.',
  'start.connect.byLinkFor': 'Met een link: {account}',
  'start.connect.theirAddress': 'Hun adres bij {provider}',
  'start.connect.saveAddress': 'Adres bewaren',
  'start.connect.addressNeeded': 'Typ eerst hun adres.',
  'start.connect.exportNoSignIn': "Foto's hebben geen aanmelding nodig: ze komen uit de Takeout-export.",
  'start.accountsFailed': 'Uw bewaarde accounts konden niet worden gelezen. Een nieuw account werkt wel.',
  'start.to.row': 'Waar {type} naartoe gaat',
  'start.to.yours': 'Uw accounts',
  'start.to.new': 'Een nieuw account',
  'start.to.add': '{provider} toevoegen',
  'start.to.doesNotTake': '{provider} neemt geen {type} aan.',
  'start.to.needAll': 'Voeg eerst elk nieuw account toe.',
  'start.to.settingUp': 'Bezig met klaarzetten…',
  'start.to.failed': 'Niet klaargezet: {migration}.',
  'start.to.exportFolder': 'Gelezen uit de map {folder} in deze bestanden, zodra de export daar staat.',
  'start.to.lands': 'Waar de kopieën komen',
  'start.to.ownFolder': 'In een eigen map zetten',
  'start.to.ownFolder.label': 'Map',
  'start.to.ownFolder.hint': 'Leeg gelaten komen de kopieën in de eigen mappen van het account.',
  'start.to.ownFolder.shared': 'Een andere migratie stuurt hetzelfde soort gegevens hierheen, dus elk krijgt een eigen map.',
  'start.migrationName': '{person} — {provider} naar {destination}',
  'start.check.intro': 'Klaargezet en gepauzeerd: er wordt niets gekopieerd vóór Starten.',
  'start.check.route': '{types}: {from} → {to}',
  'start.check.start': 'Starten',
  'start.check.waits': 'U kunt starten zodra elke telling binnen is en elk gevraagd vinkje staat.',
  'start.check.waitsFor':
    'Wacht tot {person} verbindt. Maak hieronder een link en stuur die zelf: hij wordt één keer getoond. De telling verschijnt hier zodra de verbinding er is.',
  'start.check.waitsForLink': 'De telling verschijnt hier zodra {person} via de link hierboven verbonden is.',
  'start.check.startsWhenGranted': 'Zodra u de andere hebt gestart, start deze vanzelf wanneer {person} verbindt.',
  'start.check.waitsForACount': 'U kunt starten zodra {person} verbonden is en er een telling binnen is.',
  'start.check.export.waits': 'Klaargezet, en wacht op de Takeout-export:',
  'start.check.export.ask': "Vraag hem aan bij Google, met alleen Google Foto's aangevinkt:",
  'start.check.export.put':
    'Zet de .zip-bestanden zodra ze binnen zijn, zoals Google ze stuurt, in de map {folder} van {destination}.',
  'start.check.export.start': 'Start de migratie daarna op haar pagina, met Controleren en starten: eerst wordt de export geteld.',
  'start.check.export.guide': 'Een Takeout aanvragen, stap voor stap',
  'start.check.done': 'Klaar',
  'start.check.later':
    'U kunt deze pagina sluiten. De pagina van {person} bewaart deze migraties: start elke migratie via Details zodra de verbinding er is.',
  'start.company.question': 'Is dit een bedrijfsaccount met een beheerder?',
  'start.company.no': 'Nee',
  'start.company.yes': 'Ja',
  'start.what.orgApp.lead':
    'Uw beheerder kan de e-mail laten lezen via de eigen app van uw organisatie, met toepassingsmachtigingen. Zo wordt ook een gedeelde mailbox gelezen.',
  'start.what.orgApp.signIn': 'Met de aanmelding bij Microsoft',
  'start.what.orgApp.graph': 'Via onze eigen app, met Microsoft Graph',
  'start.what.orgApp.imap': 'Via onze eigen app, met IMAP',
  'start.moreOptions': 'Meer opties',
  'start.appPassword': 'Liever een app-wachtwoord gebruiken',
  'start.serverSettings': 'Serverinstellingen',
  'start.serverSettings.filled': 'Serverinstellingen (ingevuld voor {provider})',
  'start.to.nextcloudAddress': 'Het adres van uw Nextcloud',
  'start.to.nextcloudAddress.placeholder': 'cloud.example.eu',
  'start.to.nextcloudAddress.hint': 'Het adres waarop u Nextcloud in uw browser opent.',
  'start.to.heading': 'Waar gaat het naartoe?',
  'start.check.heading': 'Controleren, dan starten',
  'person.back': '← Migraties',
  'person.notFound': 'Deze persoon bestaat hier niet.',
  'person.loadFailed': 'Kon deze persoon niet laden.',
  'person.details': 'Details',
  'person.rowName': '{from} naar {to}',
  'person.awaiting.startsByItself':
    'Wacht tot {name} verbindt en start dan vanzelf: een andere migratie van {name} is al gestart.',
  'person.awaiting.reviewAndStart': 'Wacht tot {name} verbindt. Open daarna Details om deze te controleren en te starten.',
  'person.awaiting.ranBefore': 'Wacht tot {name} opnieuw verbindt.',
  'person.awaiting.unread': 'Welke hiervan wachten tot {name} verbindt, kon niet worden gelezen.',
  'person.links.title': 'Voor {name}',
  'person.steps.title': 'Voordat u overstapt',
  'person.steps.hint': 'Elke stap, opgeteld over de migraties van deze persoon.',
  'person.state.done': 'Klaar',
  'person.state.needsYou': 'Wacht op u',
  'person.state.notYet': 'Nog niet',
  'person.step.none': 'Geen',
  'person.step.unread': 'Kon niet worden gelezen',
  'person.step.linkUnread': '{name} (kon niet worden gelezen)',
  'person.step.deletions': '{n} om te beslissen',
  'person.step.moves': '{n} gemeld',
  'person.step.failures.one': '1 kon niet worden gekopieerd',
  'person.step.failures.many': '{n} konden niet worden gekopieerd',
  'person.step.sharing': '{n} om door te lopen',
  'person.step.check.passed': 'Geslaagd',
  'person.step.check.partly': 'Geslaagd voor {n} van {total}',
  'person.step.check.notYet': 'Nog niet geslaagd',
  'person.step.check.notRun': 'Nog niet uitgevoerd',
  'person.step.check.running': 'Nu bezig',
  'person.step.check.couldNotRun': 'Kon {when} niet worden uitgevoerd',
  'person.step.check.notPassedWhen': 'Niet geslaagd {when}',
  'person.step.check.passedWhen': 'Geslaagd {when}',
  'person.step.confirmed.notYet': 'Na de verificatie',
  'person.step.confirmed.done': 'Klaar om te lezen',
  'person.step.finish.notYet': 'Zet de e-mailbezorging om en rond dan af',
  'person.step.finish.done': 'Afgerond',
  'createMapping.createFailed':
    'Niet aangemaakt; uw invoer staat er nog. Herstel wat de melding noemt en probeer opnieuw.',
  'billing.usageLoadFailed': 'De verbruikscijfers konden niet worden geladen.',
  'billing.pay': 'Betalen',
  'billing.payFailed': 'De betaling kon niet worden gestart.',
  'billing.usagePeriod': 'Verbruik voor',
  'billing.asOf': 'per',
  'billing.noPaymentMethods': 'Geen betaalmethoden opgeslagen.',
  'billing.paymentMethodsLoadFailed': 'De betaalmethoden konden niet worden geladen.',
  'billing.default': 'Standaard',
  'billing.adminOnly':
    'Facturatie is alleen voor eigenaren en beheerders; vraag een van hen naar gebruiks- of factuurgegevens.',
  'billing.invoicesLoadFailed': 'De facturen konden niet worden geladen.',
  'billing.party.title': 'Factuurgegevens',
  'billing.party.intro': 'Aan wie facturen worden gericht.',
  'billing.party.missing':
    'Nog niet ingevuld. Er kunnen geen facturen worden uitgereikt totdat dit is ingevuld.',
  'billing.party.notNeeded': 'Niet nodig zolang uw pakket gratis is: er wordt niets gefactureerd.',
  'billing.party.kindConsumer': 'Particulier',
  'billing.party.kindBusiness': 'Zakelijk',
  'billing.party.name': 'Naam op de factuur',
  'billing.party.addressLine1': 'Adres',
  'billing.party.addressLine2': 'Adresregel 2 (optioneel)',
  'billing.party.postalCode': 'Postcode',
  'billing.party.city': 'Plaats',
  'billing.party.country': 'Land',
  'billing.party.vatNumber': 'Btw-nummer (optioneel)',
  'billing.party.save': 'Opslaan',
  'billing.party.saved': 'Opgeslagen.',
  'billing.party.saveFailed': 'Opslaan is mislukt.',
  'billing.party.loadFailed': 'De factuurgegevens konden niet worden geladen.',
  'billing.party.vat.notChecked': 'Dit btw-nummer is nog niet gecontroleerd bij VIES.',
  'billing.party.vat.checkNow': 'Controleren bij VIES',
  'billing.party.vat.checking': 'VIES wordt gevraagd…',
  'billing.party.vat.valid': 'VIES heeft dit nummer bevestigd op {date}.',
  'billing.party.vat.invalid': 'Volgens VIES is dit nummer niet geldig (gecontroleerd op {date}).',
  'billing.party.vat.registeredTo': 'Geregistreerd op naam van: {name}',
  'billing.party.vat.consultationNumber': 'Consultatienummer: {number}',
  'billing.party.vat.unqualified':
    'Geen consultatienummer — de controle liep zonder geconfigureerd btw-nummer van de verkoper.',
  'billing.party.vat.checkFailed': 'De controle is niet uitgevoerd.',
  'billing.party.vat.treatmentLabel': 'Btw op uw facturen:',
  'billing.party.vat.treatment.domestic': 'Facturen bevatten btw tegen het standaardtarief.',
  'billing.party.vat.treatment.reverseCharge':
    'Btw verlegd: facturen bevatten geen btw; uw bedrijf draagt de btw in eigen land af.',
  'billing.party.vat.treatment.oss':
    'Facturen bevatten het btw-tarief van uw eigen land (One Stop Shop).',
  'billing.party.vat.treatment.outsideEu':
    'Buiten het btw-gebied van de EU; de belasting van facturen wordt vóór de eerste bepaald.',
  'confirm.nextSteps': 'Hierna, in cutover-volgorde:',
  'confirm.title': 'Controleer en bevestig uw migratie',
  'confirm.intro': 'Er is nog niets gekopieerd. Controleer wat er migreert en start het daarna.',
  'confirm.readError': 'De migraties konden niet worden gelezen.',
  'confirm.noMappings': 'Geen migraties geconfigureerd.',
  'confirm.noMappings.how':
    'De appliance leest migraties als JSON-bestanden uit de configuratiemap.',
  'confirm.noMappings.more':
    'Op Docker is dat de gekoppelde config-map; op Windows C:\\ProgramData\\OpenMigrate\\config. Kopieer mapping.json.example, vul uw bron en doel in, verwijs naar geheimen via de naam van een omgevingsvariabele en herstart de appliance: de map wordt eenmalig bij het starten gelezen. De volledige uitleg staat in docs/selfhost-quickstart.md, stap 3.',
  'confirm.start': 'Start migratie',
  'confirm.startError': 'Kon niet starten:',
  'confirm.startErrorFallback': 'het verzoek is mislukt',
  'confirm.countError': 'Het tellen is niet gestart:',
  'confirm.countAgain': 'Dit scherm telt vanzelf opnieuw zodra het kopiëren weer begint.',
  'confirm.startWaits': 'U kunt starten zodra de telling binnen is, of uiterlijk na 15 minuten.',
  'confirm.countUnfinished':
    'De telling was na 15 minuten niet klaar. U kunt toch starten: wat niet gekopieerd kan worden, staat op de pagina van de migratie zodra het gevonden is.',
  'confirm.manifestError': 'De lijst van wat er migreert kon niet worden gelezen:',
  'confirm.openConsole': 'Open de migratieconsole',
  'confirm.whatMigrates': 'Wat migreert er',
  'confirm.note.active': 'Actief. Het synchroniseert volgens schema en meldt alles wat uw aandacht nodig heeft.',
  'confirm.note.cutover': 'In cutover.',
  'confirm.note.done': 'Afgerond. Deze migratie synchroniseert niet meer.',
  'confirm.note.continuous':
    'Doorlopend. De cutover is geweest; dit blijft kopiëren in plaats van te eindigen.',
  'confirm.introStarted':
    'Migraties hier zijn gestart. Live voortgang staat per migratie; de scan blijft als momentopname.',
  'confirm.progress.heading': 'Live voortgang',
  'confirm.progress.ofAbout': '{done} van ~{total}',
  'confirm.progress.totalNotKnown': '{done} gekopieerd · totaal niet bekend',
  'confirm.progress.noneFound': 'niets gevonden om te kopiëren',
  'confirm.progress.failed': 'mislukt',
  'confirm.progress.retrying': 'in nieuwe poging',
  'confirm.progress.leftAsIs': '{count} ongemoeid gelaten: stonden al op het nieuwe systeem, of zijn daar sindsdien gewijzigd',
  'confirm.progress.leftAsIs.why':
    'Deze stonden al op het nieuwe systeem, of zijn daar sindsdien gewijzigd, en zijn daarom precies gelaten zoals ze zijn. Er is niets overheen gekopieerd en er is niets verloren gegaan: dit gereedschap overschrijft nooit wat het niet zelf heeft geschreven. Ze staan hier apart van de kopieën omdat er niets met ze is gebeurd — en dat is precies het punt.',
  'confirm.progress.lastActive': 'laatst actief',
  'confirm.progress.stopped': 'Uitgeschakeld: deze kopieën blijven, maar volgen de bron niet meer.',
  'confirm.progress.stopped.why':
    'Er is niets verwijderd. De kopieën en hun administratie blijven waar ze zijn, zoals ze waren toen het stopte. Weer inschakelen gaat verder waar het stopte: nieuwe items worden gekopieerd, wijzigingen worden opgepakt en verwijderingen in de bron worden gemeld.',
  'confirm.progress.stoppedByYou': 'Door u gestopt: deze kopieën blijven, maar volgen de bron pas weer na hervatten.',
  'confirm.progress.stoppedByYou.why':
    'Er is niets verwijderd. De kopieën en hun administratie blijven zoals ze waren toen u het stopte. Hervatten, op de pagina van de migratie, gaat verder waar het stopte: nieuwe items worden gekopieerd, wijzigingen worden opgepakt en verwijderingen in de bron worden gemeld.',
  'pause.label': 'Gepauzeerd',
  'pause.ceiling':
    '{provider} heeft de daglimiet voor downloaden bereikt. Kopiëren gaat verder na {resets}.',
  'pause.ceiling.unknown':
    '{provider} heeft de daglimiet voor downloaden bereikt. Kopiëren gaat verder zodra die reset.',
  'pause.ceiling.why':
    'De limiet is van uw oude provider, niet van ons. Erover gaan kan u ongeveer een dag buitensluiten uit uw eigen live mailbox, dus stopt het kopiëren daarvóór. Er is niets misgegaan en er gaat niets verloren — de volgende ronde gaat verder waar deze stopte.',
  'ceiling.atStart':
    'Wat deze migraties bevatten, ongeveer {size}, en de {moved} die al verplaatst is, gaan samen over uw datalimiet van {ceiling}.',
  'ceiling.atStart.holds':
    'Bij de limiet wachten nieuwe items tot u een weg verder kiest; wijzigingen aan wat al gekopieerd is gaan door.',
  'ceiling.atStart.choose': 'Kies nu, of start toch en kies wanneer ze wachten:',
  'ceiling.atStart.billing': 'uw datalimiet op de pagina Facturering',
  'ceiling.atStart.alpha': 'Tijdens de alfa wacht er niets bij de limiet en wordt niets in rekening gebracht.',
  'pause.dataCeiling':
    'Nieuwe items wachten bij uw datalimiet van {ceiling}: {held} nog niet gekopieerd. Wijzigingen aan wat al gekopieerd is gaan door.',
  'pause.dataCeiling.moveUp': 'Ga naar {tier}: eenmalig €{setup}, daarna €{monthly} per maand.',
  'pause.dataCeiling.topUp': 'Of koop eenmalig nog {band} erbij, voor €{price}.',
  'pause.dataCeiling.why':
    'Elke stap omhoog is uw keuze: niets verhoogt uw pakket of uw ruimte zonder uw ja. Kies op de pagina Facturering, en het kopiëren gaat verder waar het stopte.',
  'pause.hold.heading': 'Kopiëren is gepauzeerd',
  'pause.hold.default': 'We hebben het kopiëren gepauzeerd terwijl we het platform bijwerken.',
  'pause.hold.since': 'Gepauzeerd sinds',
  'pause.hold.why':
    'Er is niets mis met uw migratie en er gaat niets verloren. Migraties die al liepen worden normaal afgerond, en het geplande kopiëren start vanzelf weer zodra de update klaar is, precies waar het stopte. Kopiëren dat u tijdens de pauze probeerde te starten, is niet gestart: start het na de update opnieuw.',
  // 0131 T1's words, with de kopie vlak voor een update sinds 0139 T4 (zie het
  // Engelse blok). Een veiligheidszin wordt niet ingekort (0118).
  'alpha.note.lead': 'Alfa: een kleine, uitgenodigde groep probeert deze dienst uit.',
  'alpha.note.terms':
    'Er wordt niets in rekening gebracht en de alfa kan stoppen. Er worden geen back-ups gemaakt, op één kopie vlak voor elke update na, die hoogstens 7 dagen wordt bewaard.',
  'alpha.note.keep': 'Houd uw oude account tot u hebt gecontroleerd wat er is aangekomen.',
  'alpha.nothingCharged': 'Tijdens de alfa wordt niets in rekening gebracht.',
  // 0144 §3 T6's woorden; zie het Engelse blok.
  'help.line':
    'Komt u er niet uit? Mail naar {address} en noem de pagina waarop u bent. Stuur nooit een wachtwoord.',
  'help.sidebar': 'Hulp: {address}',
  'confirm.snapshot.heading': 'Scan van voor de start (momentopname)',
  'confirm.snapshot.more':
    'Eenmalig geteld, voor de start, om te tonen wat er zou migreren. De bron verandert daarna gewoon door en deze aantallen niet; de live voortgang hierboven komt uit het grootboek.',
  'confirm.state.pending': 'In afwachting',
  'confirm.state.in_progress': 'Synchroniseert',
  'confirm.state.completed': 'Voltooid',
  'confirm.state.failed': 'Mislukt',
  'confirm.state.skipped': 'Overgeslagen',
  'confirm.state.stopped': 'Gestopt',
  'confirm.foundInSource': 'Wat we in uw bron hebben gevonden',
  'confirm.starting': 'Bezig met starten…',
  'verify.title': 'Verifieer de migratie',
  'verify.intro':
    'Vergelijkt oud met nieuw en controleert steekproeven; alleen-lezen, er wordt aan geen kant geschreven.',
  'verify.run': 'Voer de verificatie uit',
  'verify.runAgain': 'Verifieer opnieuw',
  'verify.durationHint':
    'Leest de volledige bestemming — bij een grote mailbox duurt dit minuten.',
  'verify.applianceScope':
    'Op deze appliance omvat de verificatie altijd elke geconfigureerde migratie.',
  'verify.runningSince': 'Bezig sinds',
  'verify.didNotComplete': 'De verificatie is niet voltooid.',
  'verify.notAResult':
    'Over de volledigheid is niets bekend, in geen van beide richtingen; dit is geen resultaat.',
  'verify.restarted': 'De appliance is herstart terwijl de verificatie liep. Voer hem opnieuw uit.',
  'verify.didNotStart': 'De verificatie is niet gestart.',
  'verify.ready': 'Deze migratie is klaar voor cutover.',
  'verify.notReady': 'Nog niet klaar voor cutover. Zie de domeinen en problemen hieronder.',
  'verify.countsOnly': 'Er is geen inhoud vergeleken. Dit rust alleen op aantallen en groottes.',
  'verify.score': 'score',
  'verify.evidence.checked': 'inhoud gecontroleerd',
  'verify.evidence.partial': 'inhoud deels gecontroleerd',
  'verify.evidence.none': 'alleen aantallen',
  'verify.evidence.help.checked': 'Van elk bemonsterd item is de inhoud met het origineel vergeleken.',
  'verify.evidence.help.partial': 'Sommige bemonsterde items zijn vergeleken; andere konden niet gelezen worden.',
  'verify.evidence.help.none': 'Van geen enkel item is de inhoud vergeleken. Alleen aantallen en groottes.',
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
    'Afwijkingen binnen de tolerantie. Lees de problemen voordat u verdergaat.',
  'verify.help.FAIL':
    'Er ontbreken items op het doelsysteem, of gecontroleerde inhoud kwam niet overeen.',
  'verify.help.SKIPPED':
    'Uitgeschakeld in de configuratie; blokkeert de cutover niet, maar niemand controleerde het.',
  'verify.help.NOT_VERIFIABLE':
    'Ingeschakeld, maar het doel is er niet voor te lezen; ongecontroleerd blokkeert de cutover.',
  // Zie de Engelse blok-opmerking: de toestandswoorden zijn geen schaal.
  'confirmed.title': 'Wat er bevestigd is in uw nieuwe huis',
  'confirmed.intro':
    'Leest elk item terug op de bestemming en zegt wat er precies is vergeleken.',
  'confirmed.check': 'Controleer de bestemming',
  'confirmed.export': 'Download de volledige lijst',
  'confirmed.durationHint':
    'Leest de bestemming item voor item — bij een groot account duurt dit minuten.',
  'confirmed.applianceScope':
    'Op deze appliance omvat een controle elke geconfigureerde migratie.',
  'confirmed.joined': 'Er liep al een controle; deze is daarbij aangesloten.',
  'confirmed.loading': 'Bezig met lezen…',
  'confirmed.couldNotRead': 'De lijst kon niet worden gelezen.',
  'confirmed.neverRun': 'Er is nog geen controle uitgevoerd, dus niets is bevestigd.',
  'confirmed.running': 'Bezig sinds',
  'confirmed.checkedAt': 'Gecontroleerd',
  'confirmed.passFailed': 'De controle stopte om',
  'confirmed.passStopped.closed': 'Deze organisatie is gesloten, dus de controle stopte om',
  'confirmed.paused': 'Slechts een deel van het account is gecontroleerd:',
  'confirmed.nothingYet': 'Deze migratie heeft nog geen items.',
  'confirmed.allVerified': 'Elk item is teruggelezen en kwam overeen. Niets vraagt uw aandacht.',
  'confirmed.headline.of': 'van de',
  'confirmed.headline.rest': 'items in uw nieuwe huis zijn met een hash geverifieerd.',
  'confirmed.breakdown': 'De rest van het overzicht:',
  'confirmed.checked.of': 'van de',
  'confirmed.checked.rest': 'tot nu toe gecontroleerd',
  'confirmed.truncated.a': 'De eerste',
  'confirmed.truncated.b': 'rijen worden getoond. De download bevat ze allemaal.',
  'confirmed.noKey': 'naam niet vastgelegd',
  'confirmed.noKey.hover':
    'Pas sinds 12 september 2026 vastgelegd; een volgende passage vult dit aan.',
  'confirmed.col.domain': 'Type',
  'confirmed.col.collection': 'Waar',
  'confirmed.col.item': 'Item',
  'confirmed.col.state': 'Resultaat',
  'confirmed.col.claim': 'Vergeleken',
  'confirmed.col.when': 'Gecontroleerd',
  'confirmed.state.verified': 'Geverifieerd',
  'confirmed.state.differs': 'Wijkt af',
  'confirmed.state.present': 'Aanwezig',
  'confirmed.state.yours': 'Al van u',
  'confirmed.state.missing': 'Ontbreekt',
  'confirmed.state.neverPlaced': 'Nooit geplaatst',
  'confirmed.state.removed': 'Verwijderd',
  'confirmed.state.unchecked': 'Niet gecontroleerd',
  'confirmed.help.verified':
    'Teruggelezen van de bestemming en het kwam overeen met wat wij schreven.',
  'confirmed.help.differs':
    'Teruggelezen van de bestemming en het kwam niet overeen. Bekijk dit.',
  'confirmed.help.present':
    'Het staat er, maar er viel niets vergelijkbaars te berekenen. Geen fout.',
  'confirmed.help.yours': 'Uw eigen kopie stond er al, dus wij schreven deze bytes nooit.',
  'confirmed.help.missing':
    'Wij plaatsten het en bij teruglezen is het weg. Bewaar uw origineel.',
  'confirmed.help.neverPlaced':
    'Het is nooit gekopieerd — overgeslagen, mislukt, of bewust achtergelaten.',
  'confirmed.help.removed':
    'Wij verwijderden onze eigen kopie, op een destijds vastgelegd besluit.',
  'confirmed.help.unchecked':
    'De bestemming kon niet worden bevraagd. Er is niets over bekend.',
  'confirmed.claim.byteHash': 'via hash',
  'confirmed.claim.fingerprint': 'via vingerafdruk',
  'confirmed.claim.containerParts': 'via de onderdelen van het document',
  'confirmed.claim.none': 'niet vergeleken',
  'finish.title': 'Rond een migratie af',
  'finish.intro':
    'Afronden stopt het kopiëren en het rapporteren; doorloop de stappen in volgorde.',
  'finish.unknown.pre': 'Geen migratie met id',
  'finish.unknown.post':
    'gaf antwoord. Controleer het adres; dit is geen migratie zonder iets af te ronden.',
  'finish.readError.one': 'De migratie kon niet worden gelezen.',
  'finish.readError.many': 'De migraties konden niet worden gelezen.',
  'finish.note.paused':
    'Nooit gestart, dus niets af te ronden. Verwijder de migratie om op te ruimen.',
  'finish.note.active':
    'Synchroniseert volgens schema. Items die nog op het oude systeem binnenkomen, worden gekopieerd.',
  'finish.note.cutover': 'In cutover. Liep de migratie, dan kopieert die tot de overgangsperiode afloopt.',
  'finish.note.done':
    'Afgerond. Deze migratie synchroniseert niet meer en er wordt niets meer voor gerapporteerd.',
  'finish.note.continuous':
    'Doorlopend. Blijft kopiëren na de cutover. Elk gegevenstype beëindigen stopt dat; kopieën blijven staan.',
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
    'Het verzoek is mislukt; mogelijk loopt er nog een ronde, controleer de wachtrijen straks opnieuw.',
  'lane.intro': 'Het oude account blijft het nieuwe voeden en er wordt niets verwijderd.',
  'lane.why':
    'Uw tarief daalt niet zolang dit loopt: het pad houdt zijn plek tot u het beëindigt, ' +
    'net als een migratie die nog niet klaar is. Verwijderingen bij de oude aanbieder ' +
    'worden niet meer gespiegeld — wat u daar weghaalt blijft in uw nieuwe huis staan. ' +
    'We factureren niet langer dan twaalf maanden zonder het opnieuw te vragen.',
  'lane.confirm': 'Blijven kopiëren, tarief blijft',
  'lane.cancel': 'Nu niet',
  'lane.selfhost.why':
    'Verwijderingen bij de oude aanbieder worden niet meer gespiegeld — wat u daar weghaalt ' +
    'blijft in uw nieuwe huis staan. Het loopt op dit apparaat door tot u het beëindigt.',
  'lane.selfhost.confirm': 'Blijven kopiëren',
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
    '. Alleen de eerste blokkeert; de kopie op het nieuwe systeem beantwoordt de andere twee.',
  'finish.step3.title': 'Voer één laatste ronde uit',
  'finish.step3.body': 'Zodat het nieuwe systeem het oude weerspiegelt zoals het nu is.',
  'finish.step3.run': 'Voer nu een ronde uit',
  'finish.step3.runAgain': 'Voer er nog een uit',
  'finish.step3.finished': 'De ronde is uitgevoerd en voltooid.',
  'finish.step3.queued':
    'In de wachtrij als taak; het komt in de uitvoeringsgeschiedenis, controleer de wachtrijen straks opnieuw.',
  'finish.step3.stopped.one': '{kind} is gestopt en niet in deze ronde: de ene kopie blijft zoals die was.',
  'finish.step3.stopped.many': '{kind} is gestopt en niet in deze ronde: de {count} kopieën blijven zoals ze waren.',
  'finish.step3.stopped.why':
    'Het is uitgeschakeld nadat er gekopieerd was. De kopieën blijven op het nieuwe systeem, maar wat sindsdien op het oude veranderde, heeft ze niet bereikt. Moeten ze actueel zijn, schakel het dan weer in en laat een ronde lopen voordat u afrondt.',
  'finish.step3.stoppedByYou.why':
    'U hebt het gestopt. De kopieën blijven op het nieuwe systeem, maar wat sindsdien op het oude veranderde, heeft ze niet bereikt. Moeten ze actueel zijn, hervat het dan op de pagina van de migratie en laat een ronde lopen voordat u afrondt.',
  'finish.step3.stoppedUnread': 'Kon niet lezen of een gegevenstype gestopt is:',
  'finish.step4.title': 'Zet de e-mailbezorging om naar het nieuwe systeem',
  'finish.step4.body':
    'Wijzig MX/DNS en configureer de clients opnieuw zodat nieuwe e-mail op het nieuwe systeem aankomt.',
  'finish.step4.more':
    'Dit gebeurt buiten dit programma, dus dit is de ene stap die niemand hier voor u kan controleren.',
  'finish.step4.warn.pre': 'Als u afrondt voordat dit is gedaan',
  'finish.step4.warn.post':
    ', wordt alles wat daarna op het oude systeem binnenkomt niet gekopieerd, en niets zal het melden — het programma kijkt niet meer mee.',
  'finish.step4.checkbox': 'Nieuwe e-mail komt nu aan op het nieuwe systeem.',
  'finish.step5.title': 'Beëindig of blijf kopiëren, per gegevenstype',
  'finish.step5.nothingChanges.pre':
    'Er wordt aan geen van beide systemen iets toegevoegd of verwijderd.',
  'finish.step5.nothingChanges.post':
    ' Wat op het nieuwe systeem staat, blijft precies zoals het is — dit stopt alleen het meekijken met het oude.',
  'finish.button.disabledTitle':
    'Bevestig eerst stap 4; afronden voordat de bezorging is omgezet, verliest alles wat daarna binnenkomt.',
  'finish.each.title': 'Per gegevenstype',
  'finish.ending.phase.active': 'Kopieert; nog niet overgestapt',
  'finish.ending.phase.cutover': 'In de overstap',
  'finish.ending.phase.done': 'Beëindigd',
  'finish.ending.phase.continuous': 'Blijft kopiëren na de overstap',
  'finish.ending.end': '{kind} beëindigen',
  'finish.ending.keep': '{kind} blijven kopiëren',
  'finish.ending.forceButton': '{kind} toch beëindigen en ze achterlaten',
  'finish.ending.stopped':
    'U hebt {kind} gestopt. Beëindig het, of hervat het op de pagina van de migratie om het te blijven kopiëren.',
  'finish.ending.failed': 'Dat is niet gelukt:',
  'finish.ending.graceEnded':
    'De overgangsperiode van {kind} liep af op {date} en er is niets gekozen, dus het kopieert niet meer. Beëindig het, of laat het blijven kopiëren.',
  'tenants.title': 'Team & organisatie',
  'tenants.intro':
    'Wie zich bij deze organisatie kan aanmelden en wat ze mogen doen; wijzigingen gelden direct.',
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
  'tenants.members.resend': 'Opnieuw sturen',
  'tenants.readOnly': 'Uw rol hier is alleen-lezen. Een eigenaar of beheerder beheert de leden.',
  'tenants.invite.heading': 'Iemand uitnodigen',
  'tenants.invite.hint':
    'We mailen hen waar ze zich aanmelden; ze verschijnen hieronder als uitgenodigd.',
  'tenants.invite.mail.sent': 'Uitnodiging gemaild naar {email}.',
  'tenants.invite.mail.off':
    'Uitnodiging voor {email} opgeslagen, maar deze installatie verstuurt geen e-mail: vertel het zelf.',
  'tenants.invite.mail.failed':
    'Uitnodiging voor {email} opgeslagen, maar de e-mail kon niet worden verstuurd. Stuur hem opnieuw, of vertel het zelf.',
  'tenants.invite.mail.limited':
    'Uitnodiging voor {email} opgeslagen, maar de uitnodigingsmails van vandaag zijn op. Stuur hem morgen opnieuw, of vertel het zelf.',
  'tenants.invite.email': 'E-mailadres',
  'tenants.invite.role': 'Rol',
  'tenants.invite.adminCan':
    'Een beheerder kan alles wat een eigenaar kan, behalve de organisatie sluiten of heropenen, handmatig verwijderen of het automatisch verwijderen van oude kopieën van verplaatste bestanden aan- of uitzetten en iemand eigenaar maken.',
  'tenants.ownerOrAdminOnly': 'Tijdens de alfa kan iemand alleen eigenaar of beheerder zijn.',
  'tenants.notify.heading': 'E-mailsamenvattingen',
  'tenants.notify.intro':
    'Hoe vaak een samenvatting van wachtende beslissingen wordt gemaild; een lege wordt nooit verstuurd.',
  'tenants.notify.intro.more': 'Stilte betekent dat er niets wacht.',
  'tenants.notify.cadence': 'Samenvatting',
  'tenants.notify.daily': 'Dagelijks',
  'tenants.notify.weekly': 'Wekelijks (maandag)',
  'tenants.notify.off': 'Geen samenvatting',
  'tenants.notify.locale': 'Taal',
  'tenants.notify.recipients':
    'Gaat naar elke eigenaar en beheerder hieronder; dringende gebeurtenissen worden hoe dan ook direct gemaild.',
  'tenants.notify.save': 'Opslaan',
  'tenants.notify.saved': 'Opgeslagen.',
  'tenants.notify.readError':
    'De instelling is niet gelezen; opslaan zou iets onbekends overschrijven, dus de knoppen staan uit.',
  'tenants.invite.submit': 'Uitnodigen',
  'role.owner': 'Eigenaar',
  'role.admin': 'Beheerder',
  'role.member': 'Lid',
  'role.viewer': 'Kijker',
  'memberStatus.active': 'Actief',
  'memberStatus.invited': 'Uitgenodigd',
  'memberStatus.declined': 'Afgewezen',
  'memberStatus.suspended': 'Geschorst',
  'memberStatus.removed': 'Verwijderd',
  'nav.decisions': 'Wacht op u',
  'attention.title': 'Per migratie',
  'attention.intro': 'Eén regel per migratie, met een link naar alles wat wacht.',
  'attention.empty': 'Er wacht niets. Elke migratie loopt vanzelf door.',
  'attention.emptyNoneRunning': 'Er wacht niets en er loopt geen migratie.',
  'attention.organisation': 'Uw organisatie',
  'attention.quiet': '{count} lopen vanzelf door, zonder dat er iets wacht.',
  'attention.decisions': 'wijzigingen die een beslissing vragen',
  'attention.deletions': 'verwijderingen om te bevestigen',
  'attention.moves': 'verplaatsingen om te bevestigen',
  'attention.failures': 'items die niet gekopieerd konden worden',
  'attention.readyForCutover': 'gecontroleerd en klaar om af te ronden',
  'attention.graceEnded': 'overgangsperiode voorbij en niets gekozen, dus kopieert niet meer: {kinds}',
  'attention.sharingOpen': 'regels open op de deel-checklist',
  'attention.couldNotRead': 'Eén wachtrij kon niet gelezen worden; deze aantallen kunnen te laag zijn.',
  'attention.couldNotRead.why':
    'Het getoonde aantal is wat we konden lezen, niet wat er is — een wachtrij die niet antwoordde wordt als onleesbaar gemeld en niet als leeg, want "ik vond niets" en "ik kon niet kijken" zijn niet dezelfde zin en maar één ervan betekent dat u klaar bent. De reden die elke wachtrij gaf staat eronder, in de woorden van de server.',
  'attention.failed': 'Deze lijst kon niet geladen worden; niets hier is betrouwbaar.',
  'decisions.presets.heading': 'Vaste antwoorden',
  'decisions.presets.intro':
    'Categorieën die zichzelf beantwoorden worden hier nog vastgelegd, maar niemand wordt erover gestoord.',
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
    'Deelrechten gaan niet mee met de mail; werk de lijst door vóór het omzetten.',
  'permissions.body.more':
    'Wie wiens agenda kon zien, wie toegang had tot welke gedeelde bestanden: dat gaat niet mee. Haal de lijst op, werk hem door op het nieuwe systeem, en doe dat vóór het omzetten van de bezorging; rechten die daarna worden toegevoegd, ontbraken zolang dat duurde. Bovenaan de lijst staat wat er niet gelezen kon worden.',
  'permissions.blindSpot':
    'Twee blinde vlekken: FullAccess of Send-As op een postvak, en delen op OneDrive en SharePoint.',
  'permissions.blindSpot.more':
    'Wie volledige toegang tot een postvak had of eruit kon verzenden: Microsoft geeft ons dat helemaal niet, dat moet u zelf uit Exchange halen. Delen op de twee bestandsplatforms komt alleen mee als deze installatie die extra machtiging heeft gekregen. Het document zegt welke van de twee het werkelijk gelezen heeft, en hoe u de rest afdekt.',
  'permissions.blindSpot.google':
    'Twee blinde vlekken: Gmail-gemachtigden en verzenden-als, en delen in Google Agenda.',
  'permissions.blindSpot.google.more':
    'Wie iemands Gmail kon lezen of eruit kon verzenden, en wie wiens agenda kon zien: dit hulpmiddel leest geen van beide nog bij Google uit, dus noteer ze zelf in de instellingen van Gmail en Google Agenda. Delen op Google Drive wordt wel gelezen en staat in de lijst.',
  'permissions.download': 'Haal de rechtenlijst op',
  'permissions.failed': 'De rechtenlijst kon niet worden opgehaald.',
  'sharedAddresses.heading': 'Gevonden gedeelde adressen',
  'sharedAddresses.pattern.shared_s': 'Gedeeld postvak — het postvak wordt gekopieerd',
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
  'decisions.readError': 'De beslissingswachtrij kon niet worden gelezen.',
  'decisions.dismiss': 'Terzijde leggen',
  'decisions.sharedAddress.shared_s': 'Eén gedeeld postvak',
  'decisions.sharedAddress.distribution_d': 'Een distributielijst',
  'decisions.empty.noDetectors':
    'Niets wacht; detectoren draaien eenmaal per dag en melden een onleesbare bron als blinde vlek.',
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
  'nav.connections': 'Accounts',
  'nav.setup': 'Instelchecklist',
  'nav.docs': 'Handleidingen',
  'nav.help': 'Hulp',
  'nav.needsYou.count.one': '1 wacht op u',
  'nav.needsYou.count.many': '{n} wachten op u',
  'wizard.reuseSource': 'Bewaarde bronverbinding hergebruiken',
  'wizard.reuseTarget': 'Bewaarde doelverbinding hergebruiken',
  'wizard.reuseNone': 'Nieuwe inloggegevens invoeren',
  'wizard.reuse.hint': 'Hergebruikt de bewaarde inloggegevens; de velden hieronder verdwijnen.',
  // Wat een brontype IS, één regel nadat de kaart is gekozen, en de rest onder Meer (0118 T1).
  'wizard.about.o365': 'Gebruikt een Entra-appregistratie in uw eigen tenant.',
  'wizard.about.o365.more':
    'Vul hieronder de tenant-ID, client-ID en het clientgeheim in, samen met het mailboxadres. Registreer de app en verleen eerst beheerderstoestemming in uw eigen tenant; de checklist hieronder heeft de stappen.',
  'wizard.about.googleDrive': 'Gebruikt uw eigen Google OAuth-client en een alleen-lezen token.',
  'wizard.about.googleDrive.more':
    'Het token kan niet naar de Drive schrijven. Google Documenten, Spreadsheets, Presentaties en Tekeningen hebben geen bestand om te kopiëren totdat u per soort een formaat kiest; tot dan wordt elk bestand met naam gemeld, met de reden. De handleiding behandelt alle drie de waarden, en de knop Verbindingen testen en bewaren controleert ze bij Google voordat er iets wordt gekopieerd.',
  'wizard.about.deploymentApp.google':
    'Gebruikt de eigen Google-app van deze dienst: druk op Verbinden met Google en geef toestemming.',
  'wizard.about.deploymentApp.dropbox':
    'Gebruikt de eigen Dropbox-app van deze dienst: druk op Verbinden met Dropbox en geef toestemming.',
  'wizard.about.deploymentApp.googleDrive.more':
    'Google Documenten, Spreadsheets, Presentaties en Tekeningen hebben geen bestand om te kopiëren totdat u per soort een formaat kiest; tot dan wordt elk bestand met naam gemeld, met de reden.',
  'wizard.about.dropbox': 'Gebruikt uw eigen alleen-lezen Dropbox-app.',
  'wizard.about.dropbox.more':
    'Maak deze alleen-lezen aan: files.metadata.read en files.content.read, plus sharing.read als u gedeelde mappen wilt bekijken. De App-sleutel komt hier; daaronder komt het App-geheim in het clientgeheim-veld en het refresh-token ernaast.',
  'wizard.about.box':
    'Gebruikt uw eigen Box-platform-app, eenmalig geautoriseerd door een Box-beheerder.',
  'wizard.about.box.more':
    'Hij authenticeert met de Client Credentials Grant, dus er is geen refresh-token: Box vernieuwt refresh-tokens bij elk gebruik. De Client-ID komt hier samen met het numerieke gebruikers-id dat wordt gemigreerd; het clientgeheim komt daaronder. Een Box-beheerder autoriseert de app eenmalig onder Admin Console → Apps → Custom Apps Manager.',
  'wizard.about.gmail':
    'Gebruikt uw eigen Google OAuth-client; het token heeft de mailscope nodig.',
  'wizard.about.gmail.more':
    'Dezelfde client als een Google Drive-bron, maar het refresh-token moet zijn toegestemd met https://mail.google.com/, de enige scope die Google voor IMAP accepteert. Een token dat voor Drive is toegestemd werkt hier niet.',
  'wizard.about.googleDav':
    'Gebruikt uw eigen Google OAuth-client; het token heeft de scope van dit product nodig.',
  'wizard.about.googleDav.more':
    'Dezelfde client als de andere Google-bronnen, maar het refresh-token moet zijn toegestemd met https://www.googleapis.com/auth/calendar voor Agenda of https://www.googleapis.com/auth/carddav voor Contacten. Een token dat voor een ander Google-product is toegestemd werkt hier niet.',
  'wizard.about.apple':
    'Meldt zich aan met een app-specifiek wachtwoord; iCloud Drive-bestanden zijn niet te migreren.',
  'wizard.about.apple.more':
    'Apple biedt geen toestemmingsscherm voor zijn eigen gegevens, dus u maakt in plaats daarvan een app-specifiek wachtwoord, wat een minuut kost en altijd weer in te trekken is. iCloud Drive-bestanden kan niemand migreren: Apple publiceert daar geen API voor.',
  'wizard.about.archive':
    'Foto’s komen in mappen met uw albumnamen; een latere export voegt alleen toe.',
  'wizard.about.archive.more':
    'Koppelen laat zien wat erin zit: hoeveel items, hoeveel bytes, welke albums en welke periode. Elk album wordt één keer gekopieerd, met één bestand waarin alles staat wat Google over elke foto wist. Een archief is een momentopname van de dag waarop het is klaargezet, dus een latere export voegt alleen toe; er wordt nooit iets verwijderd omdat een export het niet meer noemt.',
  'connections.delete': 'Verwijderen',
  'connections.rotate': 'Inloggegevens vervangen',
  'connections.reconnect': 'Opnieuw verbinden',
  'connections.rotate.hint':
    'Plak de nieuwe waarden; ze worden gecontroleerd vóór ze de oude vervangen.',
  'connections.rotate.why':
    'Mislukt de controle, dan verandert er niets en houden uw migraties wat werkte.',
  'connections.rotate.save': 'Controleren en vervangen',
  'connections.add': 'Account toevoegen',
  'connections.addAndTest': 'Toevoegen en testen',
  'connections.added': 'Toegevoegd',
  'connections.role': 'Bron of doel?',
  'connections.type': 'Aanbieder',
  'connections.name': 'Naam voor dit account',
  'connections.title': 'Accounts',
  'connections.intro':
    'De accounts waarmee uw migraties inloggen. Test controleert ze alleen-lezen.',
  'connections.none': 'Nog geen accounts. Bij het starten van uw eerste migratie worden ze toegevoegd.',
  'connections.sources': 'Bronnen',
  'connections.targets': 'Doelen',
  'connections.test': 'Testen',
  'connections.testing': 'Bezig met testen…',
  'connections.usedBy': 'migratie(s) gebruiken dit',
  'connections.usedBy.none': 'Nog door geen enkele migratie gebruikt',
  'connections.setupSteps': 'Instelstappen',
  'connections.standing.migration': 'Migratie',
  'connections.standing.stopped': 'is {when} gestopt ({domains}):',
  'connections.standing.whichSide':
    'Logt in met deze en één andere verbinding; test deze om te weten welke.',
  'connections.standing.thisSide': 'Het ging mis bij dit account.',
  'probe.connected': 'Verbonden.',
  'probe.connectedSession': 'Verbonden. Het JMAP-sessiedocument antwoordde.',
  'probe.targetStatus': 'De server op {url} antwoordde {status}.',
  'probe.targetStatus.refused': 'Hij is bereikbaar en weigerde de inloggegevens.',
  'probe.targetStatus.check': 'Controleer de host en poort van het doel.',
  'probe.noProbe':
    'Er is nog geen controle voor een {kind}-verbinding; dat is ons gat, niet uw inloggegevens.',
  'probe.timedOut':
    'Geen antwoord binnen {seconds} seconden; toch bewaard, dus test later opnieuw of verklein de hoofdmap.',
  'probe.countedAtPreflight':
    'Deze export staat in het bestandsdoel van de migratie en wordt bij de preflight geteld.',
  'probe.said.server': 'De server',
  'probe.said.mailServer': 'De mailserver',
  'probe.said.answeredWords': '{who} antwoordde {status}: {words}',
  'probe.said.answeredWordsNoStatus': '{who} antwoordde: {words}',
  'probe.said.answeredOther':
    '{who} antwoordde {status} met iets dat geen DAV-, JMAP- of IMAP-foutmelding is.',
  'probe.said.answeredOtherNoStatus':
    '{who} antwoordde met iets dat geen DAV-, JMAP- of IMAP-foutmelding is.',
  'probe.said.unreachable':
    'Op dat adres antwoordde niets: de naam werd niet gevonden, de verbinding werd geweigerd, of er kwam niet op tijd antwoord. Controleer de hostnaam en de poort.',
  'probe.said.certificate':
    'Het certificaat van de server klopte niet voor die naam, of het is verlopen, dus de test stopte voordat er werd ingelogd.',
  'probe.said.insideOurNetwork':
    'Dat adres ligt binnen het eigen netwerk van deze dienst, of de server stuurde de test door naar een adres dat daar ligt, dus we hebben er geen verbinding mee gemaakt. Geef het adres dat de server op internet heeft.',
  'probe.said.unknown':
    'De test mislukte, en wat terugkwam wordt hier niet getoond. Controleer het adres en de poort.',
  'probe.said.reference': 'Referentie {reference}.',
  'probe.said.unmeasured': 'Niet gemeten — {sentence}',
  'probe.tooManyTests':
    'U hebt het afgelopen uur veel verbindingen getest. Wacht even en test dan opnieuw.',
  'probe.measuring': 'Er wordt nog gemeten wat dit account kan dragen — ververs over een minuut.',
  'probe.measured.atLeast': 'ten minste {count} {unit}',
  'probe.unit.folder.one': 'map',
  'probe.unit.folder.many': 'mappen',
  'probe.unit.calendar.one': 'agenda',
  'probe.unit.calendar.many': 'agenda\'s',
  'probe.unit.addressBook.one': 'adresboek',
  'probe.unit.addressBook.many': 'adresboeken',
  'probe.unit.taskList.one': 'takenlijst',
  'probe.unit.taskList.many': 'takenlijsten',
  'probe.unit.collection.one': 'verzameling',
  'probe.unit.collection.many': 'verzamelingen',
  'probe.qualify.lead': 'Draagt:',
  'probe.qualify.unknownHint': "'?' is niet gemeten — geen van beide aannemen is veilig",
  'probe.measured.lead': 'Gevonden:',
  'probe.found.none': 'geen',
  'probe.measured.message.one': '{count} bericht',
  'probe.measured.message.many': '{count} berichten',
  'probe.measured.card.one': '{count} kaart',
  'probe.measured.card.many': '{count} kaarten',
  'probe.measured.item.one': '{count} item',
  'probe.measured.item.many': '{count} items',
  'probe.measured.driveNote': 'Documenten, Spreadsheets en Presentaties niet meegeteld',
  'probe.measured.failed': 'niet gemeten',
  'probe.measured.unreadable.one': '{count} niet te lezen',
  'probe.measured.unreadable.many': '{count} niet te lezen',

  'connections.ok': 'Bereikt. De inloggegevens werken nog.',
  'connections.failed': 'Kon deze niet bereiken.',
  'connections.inUse.lead': 'Nog in gebruik door',
  'connections.inUse.unnamed': 'een migratie zonder naam',
  'connections.inUse.reason':
    'Verwijderen wist ook wat die migraties vastlegden; verwijder ze eerst onder Migraties.',
  'connections.removed.done': 'verwijderd.',
  'connections.removed.revoked': 'De toegang bij de aanbieder is ingetrokken.',
  'connections.removed.failed':
    'Onze kopie is verwijderd, maar de aanbieder heeft de toegang nog: trek die zelf in.',
  'connections.removed.unsupported': 'Wij hebben onze kopie verwijderd; deze aanbieder biedt geen intrekking die wij kunnen aanroepen.',
  'connections.removed.none': 'Er waren geen inloggegevens voor opgeslagen.',
  'connections.invalidValues.lead': 'Deze waarden kunnen zo niet worden gebruikt:',
  'createMapping.duplicate.lead': 'U heeft al een migratie tussen deze twee accounts:',
  'createMapping.duplicate.why':
    'Twee migraties die dezelfde items naar dezelfde plek kopiëren, zetten alles dubbel op het doel. Geef deze een andere doelmap, of open de bestaande migratie.',
  'createMapping.duplicate.open': 'Open de bestaande migratie',
  // ---- Provider setup checklist (workplan 0061) ----
  'setup.title': 'Aanbieder instellen',
  'setup.intro':
    'Stappen in de console van de aanbieder; vinkjes worden voor uw hele organisatie bewaard.',
  'setup.backToWizard': '← Terug naar de wizard',
  'setup.backToConnections': '← Terug naar accounts',
  'setup.fullGuide': 'Lees de volledige handleiding',
  'setup.settled': 'afgehandeld',
  'setup.stillOpen': 'nog te doen',
  'setup.waitingOnOthers': 'wacht op een beheerder',
  'setup.allDone': 'Alles is afgehandeld; rond de wizard af.',
  'setup.nothingToDo': 'Vooraf niets in te stellen; ga direct naar de wizard.',
  'setup.deploymentApp':
    'Niets aan te maken: deze dienst heeft een eigen {provider}-app. Druk op Verbinden met {provider}.',
  // ---- Aanbieder kiezen en de lijst afstemmen op wie u bent (workplan 0068) ----
  'setup.choose.title': 'Wat wilt u instellen?',
  'setup.choose.intro':
    'Elk systeem heeft een eigen korte lijst die u regelt voordat een migratie kan starten.',
  'setup.choose.sources': 'Migreren vanaf',
  'setup.choose.targets': 'Migreren naar',
  'setup.admin.question': 'Beheert u dit systeem voor uw organisatie?',
  'setup.admin.yes': 'Ja, ik ben beheerder',
  'setup.admin.no': 'Nee, iemand anders',
  'setup.admin.unsure': 'Laat alles zien',
  'setup.admin.hint': 'Verandert alleen de indeling van de lijst; onthouden op dit apparaat.',
  'setup.yours': 'Wat u zelf kunt doen',
  'setup.forYourAdmin': 'Wat uw beheerder moet doen',
  'setup.forYourAdmin.hint': 'Stuur deze naar de beheerder; vink ze af zodra die bevestigt.',
  'setup.yields': 'Dit levert op:',
  'setup.tick': 'Deze stap afvinken',
  'setup.untick': 'Vinkje weghalen',
  'setup.skip': 'Overslaan',
  'setup.unskip': 'Niet overslaan',
  'setup.state.done': 'Gedaan',
  'setup.state.skipped': 'Overgeslagen — bewust niet nodig',
  'setup.needsAnotherPerson': 'beheerder nodig',
  'setup.needsAnotherPerson.hint':
    'Vereist beheerdersrechten, dus op deze stap wacht u het vaakst.',
  'setup.openChecklist': 'Open de instelchecklist',
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
  'setup.dropbox.redirect_uri.title': 'Gebruikt u de knop? Registreer dan het redirect-adres',
  'setup.dropbox.redirect_uri.detail':
    'Alleen voor Verbinden met Dropbox in de wizard: onder de knop verschijnt een adres. Voeg precies dat adres toe in de Dropbox App Console onder OAuth 2 → Redirect URIs en druk daarna opnieuw op de knop. Zonder de knop slaat u deze stap over.',
  'setup.dropbox.consent.title': 'Laat de accounthouder eenmalig toestemming geven',
  'setup.dropbox.consent.detail':
    'Verbinden met Dropbox doet deze stap en de volgende als de accounthouder erop drukt. Zonder de knop stuurt u de persoon van wie de Dropbox gemigreerd wordt door de autorisatie-URL van deze app, met token_access_type=offline zodat Dropbox een refresh-token teruggeeft.',
  'setup.dropbox.exchange_code.title': 'Wissel de code in voor een refresh-token',
  'setup.dropbox.exchange_code.detail':
    'Wissel de code uit de vorige stap eenmalig in bij het token-eindpunt van Dropbox. Toegangstokens worden per run aangemaakt; verder wordt niets langlevends bewaard.',
  'setup.dropbox.exchange_code.yields': 'een refresh-token.',
  'setup.google.create_oauth_client.title': 'Maak een Google OAuth-client',
  'setup.google.create_oauth_client.detail':
    'Google Cloud console → APIs & Services → Credentials → Create credentials → OAuth client ID, als Web-toepassing.',
  'setup.google.create_oauth_client.yields': 'een Client-ID en een Client-geheim.',
  'setup.google.enable_api.title': 'Zet de API van het product aan',
  'setup.google.enable_api.detail':
    'Zet in hetzelfde project de API aan die past bij de gekozen bron — Google Drive API, Gmail API, CalDAV API, Google Contacts CardDAV API of Google Tasks API. Zonder dat mislukt de eerste aanroep.',
  'setup.google.consent_scope.title': 'Laat een alleen-lezen refresh-token toestemmen',
  'setup.google.consent_scope.detail':
    'Laat de accounthouder toestemmen met de scope van dat product; een token voor het ene Google-product werkt niet voor het andere. Of gebruik een service-account met domain-wide delegation, dat een beheerder eenmalig voor het hele domein autoriseert.',
  'setup.google.consent_scope.yields': 'een refresh-token (of een service-account-sleutelbestand).',
  'setup.graph.app_registration.title': 'Registreer een app in Microsoft Entra',
  'setup.graph.app_registration.detail':
    'Entra-beheercentrum → Identity → Applications → App registrations → New registration, in de tenant waarvan u de postvakken migreert. Kies Accounts in this organizational directory only en laat het omleidingsadres leeg. De pagina Overview toont daarna de Application (client) ID en de Directory (tenant) ID.',
  'setup.graph.app_registration.yields': 'een Tenant-ID en een Client-ID.',
  'setup.graph.api_permissions.title': 'Voeg Mail.Read toe en laat een beheerder toestemmen',
  'setup.graph.api_permissions.detail':
    'API permissions → Add a permission → Microsoft Graph → Application permissions → Mail.Read. Verder niets: deze kaart leest de mail van één postvak. Daarna drukt een beheerder op Grant admin consent for uw organisatie. Als toepassingsrecht kan Mail.Read elk postvak in de organisatie lezen; deze dienst leest alleen het postvak dat de verbinding noemt.',
  'setup.graph.client_secret.title': 'Maak een clientgeheim',
  'setup.graph.client_secret.detail':
    'Certificates & secrets → New client secret. Kopieer de waarde meteen — Entra toont deze één keer.',
  'setup.graph.client_secret.yields': 'een Client-geheim.',
  'setup.exchange.permission.title': 'Voeg IMAP.AccessAsApp toe en laat een beheerder toestemmen',
  'setup.exchange.permission.detail':
    'API permissions → Add a permission → APIs my organization uses → Office 365 Exchange Online → Application permissions → IMAP.AccessAsApp. Geen Microsoft Graph-recht: deze kaart meldt zich aan bij de IMAP-server van Exchange Online, en zo’n token draagt alleen rechten die Exchange Online geeft. Daarna drukt een beheerder op Grant admin consent for uw organisatie.',
  'setup.exchange.service_principal.title': 'Registreer de toepassing in Exchange Online',
  'setup.exchange.service_principal.detail':
    'Een Exchange-beheerder voert New-ServicePrincipal uit in Exchange Online PowerShell, met de Application (client) ID en de Object ID die onder Enterprise applications staat. Niet de Object ID onder App registrations: daarmee mislukt de aanmelding van de kaart. De handleiding geeft de opdrachten.',
  'setup.exchange.mailbox_permission.title': 'Geef de toepassing het postvak',
  'setup.exchange.mailbox_permission.detail':
    'De Exchange-beheerder voert Add-MailboxPermission uit met -AccessRights FullAccess, één keer voor elk postvak dat de kaart leest. Met FullAccess zou een toepassing het postvak ook kunnen wijzigen. Deze dienst leest het alleen, en Microsoft dwingt dat voor deze kaart niet af.',
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
  'setup.jmap.api_token.title': 'Maak er een app-wachtwoord voor',
  'setup.jmap.api_token.detail':
    'Maak in de instellingen van de server zelf een app-wachtwoord voor dat account, als die dat aanbiedt; dit product meldt zich aan met de gebruikersnaam en dat wachtwoord.',
  'setup.jmap.api_token.yields': 'een gebruikersnaam en een app-wachtwoord.',
  'setup.davbasic.account_exists.title': 'Zorg dat het doelaccount bestaat',
  'setup.davbasic.account_exists.detail':
    'Maak het account eerst aan op de doelserver, met genoeg quota voor wat eraan komt. Dit product maakt zelf geen accounts aan.',
  'setup.davbasic.app_password.title': 'Maak er een app-wachtwoord voor',
  'setup.davbasic.app_password.detail':
    'Gebruik waar de server dat aanbiedt een app-specifiek wachtwoord in plaats van de gewone login — dat kan ingetrokken worden zonder het wachtwoord van de persoon te wijzigen.',
  'setup.davbasic.app_password.yields': 'een gebruikersnaam en een app-wachtwoord.',
  'setup.apple.app_password.title': 'Maak een app-specifiek wachtwoord',
  'setup.apple.app_password.detail':
    'Meld u aan op account.apple.com → Aanmelden en beveiliging → App-specifieke wachtwoorden en maak er een. Apple toont het één keer, dus kopieer het meteen. Niet het wachtwoord van uw Apple-account: dat weigert Apple hier met opzet.',
  'setup.apple.app_password.yields': 'een app-specifiek wachtwoord, zoals abcd-efgh-ijkl-mnop.',
  'setup.nextcloud.account_exists.title': 'Zorg dat het Nextcloud-account bestaat',
  'setup.nextcloud.account_exists.detail':
    'Het account moet al bestaan op de Nextcloud, met genoeg ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.',
  'setup.nextcloud.app_password.title': 'Maak een app-wachtwoord',
  'setup.nextcloud.app_password.detail':
    'In Nextcloud: Instellingen → Beveiliging → Apparaten & sessies. Typ bij App naam een naam, zoals Migratie, druk op Creëer een nieuw app wachtwoord en kopieer het wachtwoord. Gebruik dat in plaats van het accountwachtwoord zelf: het kan ingetrokken worden zonder uw eigen wachtwoord te wijzigen.',
  'setup.nextcloud.app_password.yields': 'een app-wachtwoord, voor het vak Wachtwoord van de wizard.',
  'setup.nextcloud.dav_url.title': 'Noteer het adres met /remote.php/dav',
  'setup.nextcloud.dav_url.detail':
    'Het adres waarop u Nextcloud opent, met /remote.php/dav erachter, zoals https://cloud.example.com/remote.php/dav. Dat vult u in bij DAV-basis-URL; er is geen vak voor een host of een poort. Nextcloud toont het WebDAV-adres onderaan de pagina met bestandsinstellingen: de naam na /remote.php/dav/files/ is de gebruikersnaam die u invult.',
  'setup.nextcloud.dav_url.yields': 'de DAV-basis-URL en uw gebruikersnaam.',
  'setup.soverin.account_exists.title': 'Zorg dat het Soverin-account bestaat',
  'setup.soverin.account_exists.detail':
    'Het Soverin-account moet al bestaan, met ruimte voor wat eraan komt. Deze dienst maakt zelf geen accounts aan.',
  'setup.soverin.password.title': 'Houd het accountwachtwoord bij de hand',
  'setup.soverin.password.detail':
    'Deze dienst meldt zich aan met het Soverin-e-mailadres en het wachtwoord van dat account. Biedt Soverin u een app-wachtwoord, dan kan dat in hetzelfde vak Wachtwoord. Of één app-wachtwoord voor mail én voor agenda’s en contacten werkt, staat niet vast; de test zegt het per deel.',
  'setup.soverin.password.yields': 'het e-mailadres, en het wachtwoord of een app-wachtwoord.',
  'setup.soverin.mail_server.title': 'Gaat er mail mee? Laat de mailserver staan',
  'setup.soverin.mail_server.detail':
    'De wizard vult Mailserver, imap.soverin.net, en Mailpoort, 993, in met de gepubliceerde instellingen van Soverin. Gaat er mail mee, laat Mailserver dan ingevuld: een verbinding die zonder Mailserver is bewaard, draagt geen mail. Agenda’s en contacten hebben geen mailserver nodig.',
  // ---- Asking for access (workplan 0093) ----
  'access.title': 'Toegang aanvragen',
  'access.intro':
    'Voorlopig op uitnodiging: vertel ons wat u wilt migreren, dan komen we per e-mail terug.',
  'access.email': 'E-mailadres',
  'access.emailHint': 'Hier antwoorden wij. Er gaat verder niets naartoe.',
  'access.name': 'Uw naam',
  'access.organisation': 'Organisatie',
  'access.optional': 'optioneel',
  'access.note': 'Wat wilt u migreren?',
  'access.noteHint': 'Ongeveer hoeveel postbussen, en waarvandaan; één zin is genoeg.',
  'access.tier': 'Welk pakket lijkt te passen?',
  'access.tierHint':
    'Een inschatting volstaat; het pakket volgt wat werkelijk draait, dus dit is niet bindend.',
  'access.tierUnsure': 'Nog niet zeker',
  'access.submit': 'Aanvraag versturen',
  'access.sending': 'Versturen…',
  'access.sent': 'Dank u — wij hebben uw aanvraag.',
  'access.sentDetail': 'U hoort per e-mail van ons.',
  'access.failed': 'Wij konden dat niet versturen:',
  'access.failedFallback': 'de aanvraag is niet voltooid.',
  'access.privacy':
    'Wij bewaren wat u invult om over uw aanvraag te beslissen en u te antwoorden; een aanvraag maakt geen account aan. ' +
    'Wij bewaren het zolang uw aanvraag openstaat. Wijzen wij die af, dan verwijderen wij het 30 dagen na ons besluit. ' +
    'Kennen wij die toe, dan blijft het bij uw account en wordt het daarmee gewist.',
  'access.backToSignIn': 'Heeft u al een account? Aanmelden',
};

export type Locale = 'en' | 'nl';
export type StringKey = keyof typeof en;

export const STRINGS: Record<Locale, Record<StringKey, string>> = { en, nl };

export const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

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
  'notFound.back': 'Back to the dashboard',
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
    'This is not the same as an empty queue; unread items may be waiting.',
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
    'message arrived without a Message-ID; we generate one and add it to',
  'discovery.generatedId.pre.many':
    'messages arrived without a Message-ID; we generate one and add it to',
  'discovery.generatedId.strong': 'the copy on your new server',
  'discovery.generatedId.post':
    '— the original on your old server is not changed; they migrate with the rest.',
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
  'autoApply.hint': 'Old copies of moved files go after strict checks; deletions never do.',
  'autoApply.why':
    'Only where the same bytes are confirmed present under the new name, the pairing is unique, the report survived a full pass, and no mass event is suspected. Everything it refuses stays in this queue for you. Deletions are never applied automatically.',
  'autoApply.turnOn': 'Enable auto-apply for relocations',
  'autoApply.turnOnArmed': 'Confirm: auto-apply relocations unattended',
  'scope.migrates': 'Migrates',
  'scope.partial': 'Partial',
  'scope.doesNotMigrate': 'Does not migrate',
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
  'wizard.proto.archive.hint': 'A Google Takeout or Apple export you downloaded: photos and files.',
  'wizard.archiveProvider': 'Which export',
  'wizard.archiveProvider.hint': 'Which company made the archive; the wrong choice finds nothing.',
  'wizard.archiveProvider.why':
    'It decides how we read the export, and the files themselves do not say. Google exports are requested at takeout.google.com, Apple exports at privacy.apple.com.',
  'wizard.archivePath': 'Where the archive is',
  'wizard.archivePath.hint': 'The folder you extracted the download into, not the .zip itself.',
  'wizard.archivePath.why':
    'If the export arrived in several parts, extract them all into the same folder first. Nothing is written there: we only read.',
  // The ACCOUNT card. Four faces, and the sentence says why that is more than
  // Google offers rather than leaving it looking like an oversight there.
  'wizard.proto.microsoft.hint':
    'One Microsoft 365 account, one sign-in: mail, calendars, contacts and OneDrive.',
  // The two Microsoft 365 connection methods (0107 T1): the family heading
  // says WHO, the card says HOW — "OAuth2" as a card name said neither.
  'wizard.group.provider': 'Your provider',
  'wizard.group.protocol': 'Any server, by protocol',
  'wizard.m365.viaImap': 'Via IMAP',
  'wizard.m365.viaGraph': 'Via the Graph API',
  'wizard.proto.oauth2.hint': 'IMAP with XOAUTH2, Graph fallback behind it (app registration)',
  'wizard.proto.graph.hint': 'Graph API only (app registration)',
  // The ACCOUNT card (workplan 0106 T3b). It names the two faces AND why the
  // other two are not here, because "why is Gmail a separate card" is the
  // first question this card raises.
  'wizard.proto.google.hint': 'One Google account, one sign-in: calendars and contacts.',
  // The same card where the DEPLOYMENT'S own Google application carries the
  // restricted scopes (ADR-0041, owner decision 2026-09-01). The sentence
  // above names a wall that is not there on such an installation, and a card
  // that does that sends somebody looking for the wrong problem. The
  // single-purpose cards stay: an existing mapping keeps working, and one
  // account per face is still a reasonable thing to want.
  'wizard.proto.google.hint.restricted':
    'One Google account, one sign-in: mail, calendars, contacts and files.',
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
  'hub.completionReport': 'Download the completion report (Markdown)',
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
  'wizard.step.migration': 'Migration',
  'wizard.testConnections.reused': 'Already saved; this only checks it still works.',
  'wizard.connectionName': 'Connection name',
  'wizard.connectionName.taken':
    'This name is already taken; it saves, but two alike are hard to tell apart.',
  'wizard.testConnections.kept':
    'The details were kept: correct them and try again, or return later under Connections.',
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
  'wizard.scheduleHint': 'How often it repeats; the first sync starts when you press start.',
  'wizard.schedule.hourly': 'Hourly',
  'wizard.schedule.hourly.hint': 'Every hour',
  'wizard.schedule.daily': 'Daily',
  'wizard.schedule.daily.hint': 'Every day at 2 AM',
  'wizard.schedule.sixHourly': 'Every 6 hours',
  'wizard.schedule.sixHourly.hint': 'Six times per day',
  'wizard.schedule.quarterHourly': 'Every 15 minutes',
  'wizard.schedule.quarterHourly.hint': 'Frequent sync',
  'wizard.customCron': 'Custom Cron Expression (optional)',
  'wizard.customCronHint': 'Empty = daily at 2 AM',
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
  'wizard.review.note': 'Creating starts nothing: the migration is created paused.',
  'wizard.review.why':
    'Next you review what a read-only scan finds in your source and give the explicit start; nothing is copied until then.',
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
    'Nobody is emailed when this migration needs a decision; configure SMTP to turn that on.',
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
  // WHAT GOES, AND WHAT IS NOT TOUCHED (owner, 2026-09-03). The old sentence
  // asked for the migration's name to be typed, which is the gate you build
  // for something unrecoverable. This removes rows in our own database; the
  // mail, calendars and files at either provider are not reached at all.
  // Saying which is which is the part that makes one press enough.
  'mappings.delete.explain':
    'Removes the migration’s settings and record; nothing at your source or destination is touched.',
  'mappings.delete.more':
    'No mail, calendars, contacts or files are deleted anywhere. Setting the same migration up again starts a fresh record and copies nothing twice.',
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
  'hub.fallbackTitle': 'Migration',
  'hub.orderIntro': 'The screens below are in cutover order; work them top to bottom.',
  'hub.noId': 'No mapping id in the address.',
  'hub.detailError': "Could not read this migration's details — the screens below still work.",
  'hub.deletions.name': 'Deletions',
  'hub.deletions.blurb': 'Deleted on the old system, still on the new; your call, per item.',
  'hub.moves.name': 'Moves',
  'hub.moves.blurb':
    'Items the old system reorganised since they were copied. Reported, never acted on.',
  'hub.failures.name': 'Failures',
  'hub.failures.blurb':
    'Items that could not be copied and now wait on a person. These block finishing.',
  'hub.sharing.name': 'Sharing',
  'hub.sharing.blurb':
    'Who could reach what on the old system; a checklist worked after finishing.',
  'sharing.title': 'Sharing checklist',
  'sharing.intro': 'Everything somebody else could reach on the old system, one row per grant.',
  'sharing.intro.more':
    'Settle each row: create the share on the new system, tick it off as done by hand, or skip it on purpose. Every settled row keeps who decided, and when.',
  'sharing.progressSettled': 'settled',
  'sharing.openManualNote':
    'row(s) marked manual: your steps on the new system; tick them off here when done.',
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
    'Applying creates the share, and the new system invites this address itself; check it first.',
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
  'grantLink.title': 'Grant links',
  'grantLink.blurb':
    'The person being migrated grants access themselves, without sending you a password.',
  'grantLink.why':
    'They need no Ownpace account. You send the link to them yourself; Ownpace never does, and never learns who they are.',
  'grantLink.expiryLabel': 'The link works for',
  'grantLink.expiry.1': '1 day',
  'grantLink.expiry.7': '7 days',
  'grantLink.expiry.30': '30 days',
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
  'grantLink.loadError': 'Could not read the links for this migration.',
  'grantLink.issuedBy': 'Issued {date} by {who}',
  'grantLink.worksUntil': 'Works until {date}.',
  'grantLink.grantedOn': 'Access was granted on {date}. This link is spent.',
  'grantLink.revokedOn': 'You revoked it on {date}.',
  'grantLink.expiredOn': 'Expired on {date} without being used.',
  'grantLink.expiredNudge':
    'Nobody got as far as granting access. Create another link and send it again.',
  'grantLink.revoke': 'Revoke',
  'grantLink.revokeArmed': 'Confirm revoke',
  // The migrator's page. Written for somebody with no account and no reason to
  // trust us, so: second person, no jargon, and nothing they have to look up.
  'grant.title': 'Connect your account',
  'grant.loading': 'One moment…',
  'grant.asking': '{organisation} is moving your account to a new provider, and needs your permission to read what is in it.',
  'grant.reads': 'You are about to give access to {reads}.',
  'grant.readOnly':
    'Read-only. Nothing is ever deleted or changed in your account, and nobody — not the organisation, not Ownpace — ever sees your password. You sign in to Google yourself, on Google’s own page.',
  'grant.scopeIntro': 'Google will record this permission as:',
  'grant.until': 'This link works until {date}.',
  'grant.connect': 'Continue with Google',
  'grant.connecting': 'Opening Google…',
  'grant.disclosure': 'By continuing you accept how your data is handled:',
  'grant.privacy': 'Privacy policy',
  'grant.terms': 'Terms',
  'grant.withdraw':
    'You can withdraw this access at any time from your Google account’s security settings, under the apps that have access.',
  'state.lifecycle.active': 'Active',
  'state.lifecycle.paused': 'Paused',
  'state.lifecycle.cutover': 'In cutover',
  'state.lifecycle.done': 'Done',
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
  'failures.try.one': 'try',
  'failures.try.many': 'tries',
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
  'common.loading': 'Loading…',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'docs.title': 'Setup guides',
  'docs.all': '← All setup guides',
  'docs.notFound': 'There is no guide by that name; these ship with this version:',
  'mappings.lastSync': 'Last sync:',
  'mappings.never': 'Never',
  'mappings.filtered.lead': 'Showing only:',
  'mappings.filtered.clear': 'Show all migrations',
  'mappings.loadFailed': 'Could not load the migrations list.',
  'mappings.loadFailedNotEmpty':
    'Not the same as having no migrations; some may exist that could not be read.',
  'mappings.syncFailed': 'The sync request did not complete.',
  'createMapping.createFailed':
    'Not created; your entries are still here, so fix what the message names and retry.',
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
  'billing.adminOnly':
    'Billing is available to owners and admins only; ask one for usage or invoice details.',
  'billing.invoicesLoadFailed': 'Could not load the invoices.',
  'billing.loadFailedNotEmpty':
    'Not the same as having none; data may exist that could not be read.',
  'billing.party.title': 'Invoice details',
  'billing.party.intro': 'Who invoices are addressed to.',
  'billing.party.missing':
    'Not provided yet. Invoices cannot be issued until this is filled in.',
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
  'confirm.openConsole': 'Open the migration console',
  'confirm.whatMigrates': 'What migrates',
  'confirm.note.active': 'Active. It syncs on its schedule and reports anything that needs you.',
  'confirm.note.cutover': 'In cutover.',
  'confirm.note.done': 'Finished. This migration no longer syncs.',
  'confirm.introStarted':
    'Migrations here have started. Live progress is per migration; the scan stays as a snapshot.',
  // The six failure categories (workplan 0110 T3). Each is a SENTENCE with a
  // remedy, not a label: the owner's reframing made the customer the primary
  // reader, and nobody can act on the words "auth expired". The raw provider
  // message still renders verbatim beside these — this is the actionable
  // half, not a replacement for the precise one.
  'failure.authExpired':
    'The connection to this account has expired. Reconnect it on the Connections page and this will carry on from where it stopped \u2014 nothing is lost.',
  'failure.rateLimited':
    'The provider asked us to slow down. Nothing is wrong: this pauses and resumes on its own.',
  'failure.quotaExceeded':
    'This account has reached what its provider allows for one day. It resumes tomorrow on its own \u2014 no action needed.',
  'failure.targetRefused':
    'The destination refused to accept this. Common causes are a full mailbox, a read-only folder or missing permission on the target account.',
  'failure.network':
    'We could not reach the server. This is usually brief, and it retries by itself.',
  // The one whose text must carry the way OUT of self-service.
  'failure.unknown':
    'We could not classify this one. The provider\u2019s own message is below \u2014 if it does not help, send it to us and we will look.',
  // Which SIDE it happened on, when the pass could tell (0094 T5): said after
  // the remedy, so "reconnect it" points at the right account.
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
  'confirm.progress.heading': 'Live progress',
  'confirm.progress.synced': 'synced',
  'confirm.progress.failed': 'failed',
  'confirm.progress.retrying': 'retrying',
  'confirm.snapshot.heading': 'Pre-start scan (snapshot)',
  'confirm.snapshot.more':
    'Counted once, before the start, to show what would migrate. The source keeps changing afterwards and these numbers do not update; live progress above is the ledger speaking.',
  'confirm.state.pending': 'Pending',
  'confirm.state.in_progress': 'Syncing',
  'confirm.state.completed': 'Completed',
  'confirm.state.failed': 'Failed',
  'confirm.state.skipped': 'Skipped',
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
    'The request failed; a pass may still be running, so re-check the queues shortly.',
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
    '. Only the first blocks finishing; the new system’s copy answers the other two.',
  'finish.step3.title': 'Run one final pass',
  'finish.step3.body': 'So the new system reflects the old one as of right now.',
  'finish.step3.run': 'Run a pass now',
  'finish.step3.runAgain': 'Run another',
  'finish.step3.finished': 'The pass has run and finished.',
  'finish.step3.queued':
    'Queued as a job; it lands in the run history, so re-check the queues shortly.',
  'finish.step4.title': 'Move delivery to the new system',
  'finish.step4.body':
    'Change MX/DNS and reconfigure clients so new mail arrives on the new system.',
  'finish.step4.more':
    'This happens outside this tool, so it is the one step here nobody can check for you.',
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
    'The destination server is yours to run; we carry no service level for it.',
  'createMapping.target.userOperated.more':
    'We migrate your data into it; we do not operate, monitor or back it up. If it is a managed European platform, its own provider is responsible for it.',
  'tenants.title': 'Team & organization',
  'tenants.intro':
    'Who can sign in to this organization and what they may do; changes apply immediately.',
  'tenants.noTenant': 'No organization in this session.',
  'tenants.selfDemotionArmed':
    'This lowers your own role; you may not be able to change it back yourself.',
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
  'tenants.invite.hint': 'No email yet; tell them yourself, and they appear below as invited.',
  'tenants.invite.email': 'Email address',
  'tenants.invite.role': 'Role',
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
  'memberStatus.suspended': 'Suspended',
  'memberStatus.removed': 'Removed',
  'nav.decisions': 'Attention',
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
  'nav.connections': 'Connections',
  'nav.setup': 'Setup checklist',
  'nav.docs': 'Setup guides',
  'wizard.reuseSource': 'Reuse a saved source connection',
  'wizard.reuseTarget': 'Reuse a saved target connection',
  'wizard.reuseNone': 'Enter new credentials',
  'wizard.reuse.hint': 'Reuses its saved credentials; the fields below disappear.',
  // What a source type IS, one line after the card is picked, and the rest under More (0118 T1).
  'wizard.about.o365': 'Uses an Entra app registration in your own tenant.',
  'wizard.about.o365.more':
    'Enter its tenant ID and client ID here, and its client secret with the mailbox address on the credentials step. Register the app and grant admin consent in your own tenant first; the checklist below has the steps.',
  'wizard.about.googleDrive': 'Uses your own Google OAuth client and a read-only token.',
  'wizard.about.googleDrive.more':
    'The token cannot write to the Drive. Google Docs, Sheets and Slides are reported as un-migratable, one by one, with the reason: they have no file to copy, and rendering them is not enabled until export stability is measured. The setup guide walks through all three values and ends with one read-only command that proves them.',
  'wizard.about.dropbox': 'Uses your own read-only Dropbox app.',
  'wizard.about.dropbox.more':
    'Create it read-only: files.metadata.read and files.content.read, plus sharing.read if you want the shared-folder browse. The App key goes here; on the credentials step, the App secret goes in the client-secret field and the refresh token beside it.',
  'wizard.about.box': 'Uses your own Box platform app, authorised once by a Box admin.',
  'wizard.about.box.more':
    'It authenticates with the Client Credentials Grant, so there is no refresh token: Box rotates refresh tokens on every use. The Client ID goes here with the numeric user id being migrated; the client secret rides the credentials step. A Box admin authorises the app once under Admin Console → Apps → Custom Apps Manager.',
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
  'connections.rotate.hint':
    'Paste the new values; they are checked before replacing the old.',
  'connections.rotate.why':
    'If the check fails, nothing changes and your migrations keep whatever was working.',
  'connections.rotate.save': 'Check and replace',
  'connections.add': 'Add a connection',
  'connections.addAndTest': 'Add and test',
  'connections.added': 'Added',
  'connections.role': 'Source or target?',
  'connections.type': 'Provider',
  'connections.name': 'Connection name',
  'connections.title': 'Connections',
  'connections.intro': 'The accounts your migrations sign in with. Test checks them read-only.',
  'connections.none': 'No connections yet. Creating your first migration adds them.',
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
  'connections.standing.thisSide': 'It failed on this connection.',
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
  'setup.backToConnections': '← Back to connections',
  'setup.fullGuide': 'Read the full setup guide',
  'setup.settled': 'settled',
  'setup.stillOpen': 'still to do',
  'setup.waitingOnOthers': 'waiting on an administrator',
  'setup.allDone': 'Everything is settled; complete the wizard.',
  'setup.nothingToDo': 'Nothing to set up in advance; go straight to the wizard.',
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
  'setup.google.enable_api.title': 'Enable the product’s API',
  'setup.google.enable_api.detail':
    'In the same project, enable the API that matches the source you picked — Drive, Gmail, Calendar or People. A client without it fails on the first call.',
  'setup.google.consent_scope.title': 'Consent a read-only refresh token',
  'setup.google.consent_scope.detail':
    'Have the account owner consent with the scope for that product; a token consented for one Google product does not work for another. Or use a service account with domain-wide delegation, which an admin authorises once for the whole domain.',
  'setup.google.consent_scope.yields': 'a refresh token (or a service-account key file).',
  'setup.graph.app_registration.title': 'Register an app in Microsoft Entra',
  'setup.graph.app_registration.detail':
    'Entra admin centre → App registrations → New registration, in the tenant whose mailboxes you are migrating.',
  'setup.graph.app_registration.yields': 'a Tenant ID and a Client ID.',
  'setup.graph.api_permissions.title': 'Add read permissions and get admin consent',
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
  'access.privacy': 'We keep what you type only to answer you; asking creates no account.',
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
  'notFound.back': 'Terug naar het overzicht',
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
  'failure.authExpired':
    'De verbinding met dit account is verlopen. Herstel de verbinding op de pagina Verbindingen; daarna gaat dit verder waar het gestopt is \u2014 er gaat niets verloren.',
  'failure.rateLimited':
    'De provider vroeg ons om rustiger aan te doen. Er is niets mis: dit pauzeert en hervat vanzelf.',
  'failure.quotaExceeded':
    'Dit account heeft bereikt wat de provider per dag toestaat. Het hervat morgen vanzelf \u2014 u hoeft niets te doen.',
  'failure.targetRefused':
    'De bestemming weigerde dit te accepteren. Veelvoorkomende oorzaken: een volle mailbox, een alleen-lezen map, of ontbrekende rechten op het doelaccount.',
  'failure.network':
    'We konden de server niet bereiken. Dit duurt meestal kort en wordt vanzelf opnieuw geprobeerd.',
  'failure.unknown':
    'We konden dit niet classificeren. De melding van de provider zelf staat hieronder \u2014 helpt die niet, stuur hem ons dan en we kijken mee.',
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
  'confirm.progress.lastSynced': 'laatst gesynchroniseerd',
  'verify.checkedAt': 'Geverifieerd',
  'queue.loadFailed': 'Deze wachtrij kon niet worden geladen.',
  'queue.loadFailedNotEmpty':
    'Dit is niet hetzelfde als een lege wachtrij; er kunnen ongelezen items wachten.',
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
    'bericht kwam aan zonder Message-ID; we genereren er een en voegen die toe aan',
  'discovery.generatedId.pre.many':
    'berichten kwamen aan zonder Message-ID; we genereren er een en voegen die toe aan',
  'discovery.generatedId.strong': 'de kopie op uw nieuwe server',
  'discovery.generatedId.post':
    '— het origineel op uw oude server verandert niet; ze migreren met de rest mee.',
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
  'applyFlag.config.post': '; bewerk het bestand en herstart om dit te wijzigen. Geen API past dit aan.',
  'applyFlag.turnOn': 'Toepassen van verwijderingen inschakelen',
  'applyFlag.turnOnArmed': 'Bevestig: verwijderingen inschakelen',
  'autoApply.on': 'Automatisch toepassen van verplaatsingen staat AAN voor deze migratie.',
  'autoApply.off': 'Automatisch toepassen van verplaatsingen staat UIT voor deze migratie (de standaard).',
  'autoApply.hint':
    'Oude kopieën van verplaatste bestanden gaan na strenge controles; verwijderingen nooit.',
  'autoApply.why':
    'Alleen wanneer dezelfde bytes aantoonbaar onder de nieuwe naam aanwezig zijn, de koppeling uniek is, de melding een volledige ronde heeft doorstaan en er geen massale gebeurtenis wordt vermoed. Alles wat wordt geweigerd blijft in deze wachtrij voor u staan. Verwijderingen worden nooit automatisch toegepast.',
  'autoApply.turnOn': 'Automatisch toepassen van verplaatsingen inschakelen',
  'autoApply.turnOnArmed': 'Bevestig: verplaatsingen onbeheerd automatisch toepassen',
  'scope.migrates': 'Migreert',
  'scope.partial': 'Gedeeltelijk',
  'scope.doesNotMigrate': 'Migreert niet',
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
  'wizard.google.deploymentClient':
    'Deze installatie heeft een eigen Google-client; vul beide in om uw eigen te gebruiken.',
  'wizard.google.connect.halfClient':
    'Vul zowel de Client-ID als het clientgeheim in, of geen van beide.',
  'wizard.google.ownClient': 'Uw eigen Google-client gebruiken',
  // Zie het Engelse blok.
  'wizard.google.redirectUri':
    'Registreer dit exacte adres in uw Google-client onder Geautoriseerde omleidings-URI’s:',
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
    'Een Google Takeout- of Apple-export die u hebt gedownload: foto’s en bestanden.',
  'wizard.archiveProvider': 'Welke export',
  'wizard.archiveProvider.hint':
    'Welk bedrijf het archief maakte; bij de verkeerde keuze vinden we niets.',
  'wizard.archiveProvider.why':
    'Dat bepaalt hoe wij de export lezen, en aan de bestanden zelf is het niet te zien. Google-exports vraagt u aan op takeout.google.com, Apple-exports op privacy.apple.com.',
  'wizard.archivePath': 'Waar het archief staat',
  'wizard.archivePath.hint':
    'De map waarin u de download hebt uitgepakt, niet het .zip-bestand zelf.',
  'wizard.archivePath.why':
    'Bestaat de export uit meerdere delen, pak die dan eerst allemaal uit in dezelfde map. Er wordt niets naar geschreven: wij lezen alleen.',
  'wizard.proto.microsoft.hint':
    'Eén Microsoft 365-account, één aanmelding: e-mail, agenda’s, contacten en OneDrive.',
  'wizard.group.provider': 'Uw aanbieder',
  'wizard.group.protocol': 'Elke server, via protocol',
  'wizard.m365.viaImap': 'Via IMAP',
  'wizard.m365.viaGraph': 'Via de Graph-API',
  'wizard.proto.oauth2.hint': 'IMAP met XOAUTH2, met Graph-terugval erachter (appregistratie)',
  'wizard.proto.graph.hint': 'Alleen de Graph-API (appregistratie)',
  'wizard.proto.google.hint': 'Eén Google-account, één aanmelding: agenda’s en contacten.',
  // Dezelfde kaart waar de EIGEN Google-applicatie van deze omgeving de
  // restricted scopes draagt — zie het Engelse blok.
  'wizard.proto.google.hint.restricted':
    'Eén Google-account, één aanmelding: e-mail, agenda’s, contacten en bestanden.',
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
  'hub.completionReport': 'Download het opleveringsrapport (Markdown)',
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
  'wizard.step.migration': 'Migratie',
  'wizard.testConnections.reused': 'Al bewaard; dit controleert alleen of hij nog werkt.',
  'wizard.connectionName': 'Naam van de verbinding',
  'wizard.connectionName.taken':
    'Deze naam bestaat al; hij wordt bewaard, maar twee gelijke namen zijn lastig te onderscheiden.',
  'wizard.testConnections.kept':
    'De gegevens zijn bewaard: corrigeer ze en probeer opnieuw, of kom later terug via Verbindingen.',
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
    'Hoe vaak het herhaalt; de eerste synchronisatie start zodra u op starten drukt.',
  'wizard.schedule.hourly': 'Elk uur',
  'wizard.schedule.hourly.hint': 'Ieder uur',
  'wizard.schedule.daily': 'Dagelijks',
  'wizard.schedule.daily.hint': 'Elke dag om 02:00',
  'wizard.schedule.sixHourly': 'Elke 6 uur',
  'wizard.schedule.sixHourly.hint': 'Zes keer per dag',
  'wizard.schedule.quarterHourly': 'Elk kwartier',
  'wizard.schedule.quarterHourly.hint': 'Frequente synchronisatie',
  'wizard.customCron': 'Eigen cron-expressie (optioneel)',
  'wizard.customCronHint': 'Leeg = dagelijks om 02:00',
  'wizard.readyToCreate': 'Klaar om de migratie aan te maken',
  'wizard.reviewDetails': 'Migratiegegevens',
  'wizard.review.name': 'Naam',
  'wizard.review.source': 'Bron',
  'wizard.review.target': 'Doel',
  'wizard.review.schedule': 'Schema',
  'wizard.review.scheduleDefault': 'Dagelijks om 02:00',
  'wizard.review.dataTypes': 'Gegevenstypen',
  'wizard.review.note': 'Aanmaken start niets: de migratie wordt gepauzeerd aangemaakt.',
  'wizard.review.why':
    'Daarna beoordeelt u wat een alleen-lezen scan in uw bron vindt en geeft u expliciet het startsein; tot die tijd wordt er niets gekopieerd.',
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
    'Niemand wordt gemaild als deze migratie een beslissing nodig heeft; stel SMTP in.',
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
    'Verwijdert instellingen en registratie van de migratie; bij uw bron of bestemming wordt niets aangeraakt.',
  'mappings.delete.more':
    'Er wordt nergens e-mail, agenda, contact of bestand verwijderd. Dezelfde migratie opnieuw instellen begint met een nieuwe registratie en kopieert niets dubbel.',
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
  'hub.fallbackTitle': 'Migratie',
  'hub.orderIntro':
    'De schermen hieronder staan in cutover-volgorde; werk ze van boven naar beneden af.',
  'hub.noId': 'Geen mapping-id in het adres.',
  'hub.detailError':
    'De details van deze migratie konden niet worden gelezen — de schermen hieronder werken nog.',
  'hub.deletions.name': 'Verwijderingen',
  'hub.deletions.blurb':
    'Verwijderd op het oude systeem, nog op het nieuwe; uw beslissing, per item.',
  'hub.moves.name': 'Verplaatsingen',
  'hub.moves.blurb':
    'Items die het oude systeem heeft herschikt sinds ze zijn gekopieerd. Gemeld, nooit uitgevoerd.',
  'hub.failures.name': 'Mislukkingen',
  'hub.failures.blurb':
    'Items die niet gekopieerd konden worden en op een persoon wachten; ze blokkeren het afronden.',
  'hub.sharing.name': 'Delen',
  'hub.sharing.blurb':
    'Wie wat kon bereiken op het oude systeem; een checklist voor na het afronden.',
  'sharing.title': 'Deel-checklist',
  'sharing.intro': 'Alles wat iemand anders kon bereiken op het oude systeem, één regel per recht.',
  'sharing.intro.more':
    'Werk elke regel af: maak het delen aan op het nieuwe systeem, vink af als handmatig gedaan, of sla bewust over. Elke afgewerkte regel onthoudt wie besliste, en wanneer.',
  'sharing.progressSettled': 'afgewerkt',
  'sharing.openManualNote':
    'regel(s) op handmatig: uw stappen op het nieuwe systeem; vink ze hier af zodra gedaan.',
  'sharing.rescan': 'Opnieuw inlezen van de bron…',
  'sharing.blindSpots': 'Kon niet worden geïnventariseerd — leg deze handmatig vast:',
  'sharing.empty': 'Nog geen gedeelde rechten. Lees opnieuw in van de bron om te scannen.',
  'sharing.apply': 'Delen aanmaken op nieuw systeem',
  'sharing.applyArmed': 'Klik nogmaals — dit deelt ÉN nodigt uit',
  'sharing.done': 'Afvinken',
  'sharing.skip': 'Overslaan',
  'sharing.linkShare': 'deel-link',
  'sharing.manualBadge': 'handmatig',
  'sharing.granteeLabel': 'delen met',
  'sharing.inviteNote':
    'Toepassen maakt het delen aan; het nieuwe systeem nodigt dit adres uit, controleer het eerst.',
  'sharing.state.applied': 'gedeeld op het nieuwe systeem',
  'sharing.state.doneManual': 'handmatig gedaan',
  'sharing.state.skipped': 'overgeslagen',
  'sharing.loadFailed': 'De deel-checklist kon niet worden gelezen.',
  'hub.check.name': 'Verificatie',
  'hub.check.blurb':
    'Vergelijk de twee systemen en controleer steekproeven van de inhoud, achter één knop.',
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
  'runs.items': 'Items',
  'runs.errors': 'Fouten',
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
  'grantLink.loadError': 'Kon de links van deze migratie niet lezen.',
  'grantLink.issuedBy': 'Gemaakt op {date} door {who}',
  'grantLink.worksUntil': 'Werkt tot {date}.',
  'grantLink.grantedOn': 'Op {date} is toegang gegeven. Deze link is verbruikt.',
  'grantLink.revokedOn': 'U hebt hem ingetrokken op {date}.',
  'grantLink.expiredOn': 'Op {date} verlopen zonder gebruikt te zijn.',
  'grantLink.expiredNudge':
    'Niemand heeft toegang gegeven. Maak een nieuwe link en stuur die opnieuw.',
  'grantLink.revoke': 'Intrekken',
  'grantLink.revokeArmed': 'Bevestig intrekken',
  'grant.title': 'Verbind uw account',
  'grant.loading': 'Een moment…',
  'grant.asking': '{organisation} verhuist uw account naar een nieuwe provider en heeft uw toestemming nodig om te lezen wat erin zit.',
  'grant.reads': 'U staat op het punt toegang te geven tot {reads}.',
  'grant.readOnly':
    'Alleen lezen. Er wordt nooit iets verwijderd of gewijzigd in uw account, en niemand — niet de organisatie, niet Ownpace — ziet ooit uw wachtwoord. U logt zelf in bij Google, op de pagina van Google zelf.',
  'grant.scopeIntro': 'Google legt deze toestemming vast als:',
  'grant.until': 'Deze link werkt tot {date}.',
  'grant.connect': 'Doorgaan met Google',
  'grant.connecting': 'Google wordt geopend…',
  'grant.disclosure': 'Door door te gaan gaat u akkoord met hoe uw gegevens worden behandeld:',
  'grant.privacy': 'Privacybeleid',
  'grant.terms': 'Voorwaarden',
  'grant.withdraw':
    'U kunt deze toegang op elk moment intrekken via de beveiligingsinstellingen van uw Google-account, bij de apps die toegang hebben.',
  'state.lifecycle.active': 'Actief',
  'state.lifecycle.paused': 'Gepauzeerd',
  'state.lifecycle.cutover': 'In cutover',
  'state.lifecycle.done': 'Afgerond',
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
  'failures.try.one': 'poging',
  'failures.try.many': 'pogingen',
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
  'common.loading': 'Laden…',
  'common.cancel': 'Annuleren',
  'common.close': 'Sluiten',
  'docs.title': 'Instelhandleidingen',
  'docs.all': '← Alle instelhandleidingen',
  'docs.notFound': 'Er is geen handleiding met die naam; deze horen bij deze versie:',
  'mappings.lastSync': 'Laatste synchronisatie:',
  'mappings.never': 'Nooit',
  'mappings.filtered.lead': 'Alleen zichtbaar:',
  'mappings.filtered.clear': 'Toon alle migraties',
  'mappings.loadFailed': 'De migratielijst kon niet worden geladen.',
  'mappings.loadFailedNotEmpty':
    'Niet hetzelfde als geen migraties; er kunnen er bestaan die niet gelezen konden worden.',
  'mappings.syncFailed': 'Het synchronisatieverzoek is niet voltooid.',
  'createMapping.createFailed':
    'Niet aangemaakt; uw invoer staat er nog. Herstel wat de melding noemt en probeer opnieuw.',
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
  'billing.adminOnly':
    'Facturatie is alleen voor eigenaren en beheerders; vraag een van hen naar gebruiks- of factuurgegevens.',
  'billing.invoicesLoadFailed': 'De facturen konden niet worden geladen.',
  'billing.loadFailedNotEmpty':
    'Niet hetzelfde als geen gegevens; er kunnen gegevens bestaan die niet gelezen konden worden.',
  'billing.party.title': 'Factuurgegevens',
  'billing.party.intro': 'Aan wie facturen worden gericht.',
  'billing.party.missing':
    'Nog niet ingevuld. Er kunnen geen facturen worden uitgereikt totdat dit is ingevuld.',
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
  'confirm.openConsole': 'Open de migratieconsole',
  'confirm.whatMigrates': 'Wat migreert er',
  'confirm.note.active': 'Actief. Het synchroniseert volgens schema en meldt alles wat uw aandacht nodig heeft.',
  'confirm.note.cutover': 'In cutover.',
  'confirm.note.done': 'Afgerond. Deze migratie synchroniseert niet meer.',
  'confirm.introStarted':
    'Migraties hier zijn gestart. Live voortgang staat per migratie; de scan blijft als momentopname.',
  'confirm.progress.heading': 'Live voortgang',
  'confirm.progress.synced': 'gesynchroniseerd',
  'confirm.progress.failed': 'mislukt',
  'confirm.progress.retrying': 'in nieuwe poging',
  'confirm.snapshot.heading': 'Scan van voor de start (momentopname)',
  'confirm.snapshot.more':
    'Eenmalig geteld, voor de start, om te tonen wat er zou migreren. De bron verandert daarna gewoon door en deze aantallen niet; de live voortgang hierboven komt uit het grootboek.',
  'confirm.state.pending': 'In afwachting',
  'confirm.state.in_progress': 'Synchroniseert',
  'confirm.state.completed': 'Voltooid',
  'confirm.state.failed': 'Mislukt',
  'confirm.state.skipped': 'Overgeslagen',
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
    'Het verzoek is mislukt; mogelijk loopt er nog een ronde, controleer de wachtrijen straks opnieuw.',
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
    '. Alleen de eerste blokkeert; de kopie op het nieuwe systeem beantwoordt de andere twee.',
  'finish.step3.title': 'Voer één laatste ronde uit',
  'finish.step3.body': 'Zodat het nieuwe systeem het oude weerspiegelt zoals het nu is.',
  'finish.step3.run': 'Voer nu een ronde uit',
  'finish.step3.runAgain': 'Voer er nog een uit',
  'finish.step3.finished': 'De ronde is uitgevoerd en voltooid.',
  'finish.step3.queued':
    'In de wachtrij als taak; het komt in de uitvoeringsgeschiedenis, controleer de wachtrijen straks opnieuw.',
  'finish.step4.title': 'Zet de e-mailbezorging om naar het nieuwe systeem',
  'finish.step4.body':
    'Wijzig MX/DNS en configureer de clients opnieuw zodat nieuwe e-mail op het nieuwe systeem aankomt.',
  'finish.step4.more':
    'Dit gebeurt buiten dit programma, dus dit is de ene stap die niemand hier voor u kan controleren.',
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
    'Bevestig eerst stap 4; afronden voordat de bezorging is omgezet, verliest alles wat daarna binnenkomt.',
  'createMapping.target.userOperated':
    'De doelserver beheert u zelf; van onze kant geldt er geen serviceniveau voor.',
  'createMapping.target.userOperated.more':
    'Wij zetten uw gegevens erin over; wij beheren, bewaken of back-uppen hem niet. Is het een beheerd Europees platform, dan is de aanbieder ervan verantwoordelijk.',
  'tenants.title': 'Team & organisatie',
  'tenants.intro':
    'Wie zich bij deze organisatie kan aanmelden en wat ze mogen doen; wijzigingen gelden direct.',
  'tenants.noTenant': 'Geen organisatie in deze sessie.',
  'tenants.selfDemotionArmed':
    'Hiermee verlaagt u uw eigen rol; u kunt dit mogelijk niet zelf terugdraaien.',
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
    'Nog geen e-mail; vertel het zelf, en ze verschijnen hieronder als uitgenodigd.',
  'tenants.invite.email': 'E-mailadres',
  'tenants.invite.role': 'Rol',
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
  'memberStatus.suspended': 'Geschorst',
  'memberStatus.removed': 'Verwijderd',
  'nav.decisions': 'Aandacht',
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
    'Deelrechten verhuizen niet mee met de mail; werk de lijst door vóór het omzetten.',
  'permissions.body.more':
    'Wie wiens agenda kon zien, wie toegang had tot welke gedeelde bestanden: dat verhuist niet mee. Haal de lijst op, werk hem door op het nieuwe systeem, en doe dat vóór het omzetten van de bezorging; rechten die daarna worden toegevoegd, ontbraken zolang dat duurde. Bovenaan de lijst staat wat er niet gelezen kon worden.',
  'permissions.blindSpot':
    'Twee blinde vlekken: FullAccess of Send-As op een postvak, en delen op OneDrive en SharePoint.',
  'permissions.blindSpot.more':
    'Wie volledige toegang tot een postvak had of eruit kon verzenden: Microsoft geeft ons dat helemaal niet, dat moet u zelf uit Exchange halen. Delen op de twee bestandsplatforms komt alleen mee als deze installatie die extra machtiging heeft gekregen. Het document zegt welke van de twee het werkelijk gelezen heeft, en hoe u de rest afdekt.',
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
  'decisions.title': 'Vraagt om een beslissing',
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
  'nav.connections': 'Verbindingen',
  'nav.setup': 'Instelchecklist',
  'nav.docs': 'Handleidingen',
  'wizard.reuseSource': 'Bewaarde bronverbinding hergebruiken',
  'wizard.reuseTarget': 'Bewaarde doelverbinding hergebruiken',
  'wizard.reuseNone': 'Nieuwe inloggegevens invoeren',
  'wizard.reuse.hint': 'Hergebruikt de bewaarde inloggegevens; de velden hieronder verdwijnen.',
  // Wat een brontype IS, één regel nadat de kaart is gekozen, en de rest onder Meer (0118 T1).
  'wizard.about.o365': 'Gebruikt een Entra-appregistratie in uw eigen tenant.',
  'wizard.about.o365.more':
    'Vul hier de tenant-ID en client-ID in, en op de stap met inloggegevens het clientgeheim samen met het mailboxadres. Registreer de app en verleen eerst beheerderstoestemming in uw eigen tenant; de checklist hieronder heeft de stappen.',
  'wizard.about.googleDrive': 'Gebruikt uw eigen Google OAuth-client en een alleen-lezen token.',
  'wizard.about.googleDrive.more':
    'Het token kan niet naar de Drive schrijven. Google Documenten, Spreadsheets en Presentaties worden één voor één als niet-migreerbaar gemeld, met de reden: er is geen bestand om te kopiëren, en renderen staat uit totdat de exportstabiliteit is gemeten. De handleiding behandelt alle drie de waarden en eindigt met één alleen-lezen commando dat ze bewijst.',
  'wizard.about.dropbox': 'Gebruikt uw eigen alleen-lezen Dropbox-app.',
  'wizard.about.dropbox.more':
    'Maak deze alleen-lezen aan: files.metadata.read en files.content.read, plus sharing.read als u gedeelde mappen wilt bekijken. De App-sleutel komt hier; op de stap met inloggegevens komt het App-geheim in het clientgeheim-veld en het refresh-token ernaast.',
  'wizard.about.box':
    'Gebruikt uw eigen Box-platform-app, eenmalig geautoriseerd door een Box-beheerder.',
  'wizard.about.box.more':
    'Hij authenticeert met de Client Credentials Grant, dus er is geen refresh-token: Box vernieuwt refresh-tokens bij elk gebruik. De Client-ID komt hier samen met het numerieke gebruikers-id dat wordt gemigreerd; het clientgeheim komt op de stap met inloggegevens. Een Box-beheerder autoriseert de app eenmalig onder Admin Console → Apps → Custom Apps Manager.',
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
  'connections.rotate.hint':
    'Plak de nieuwe waarden; ze worden gecontroleerd vóór ze de oude vervangen.',
  'connections.rotate.why':
    'Mislukt de controle, dan verandert er niets en houden uw migraties wat werkte.',
  'connections.rotate.save': 'Controleren en vervangen',
  'connections.add': 'Verbinding toevoegen',
  'connections.addAndTest': 'Toevoegen en testen',
  'connections.added': 'Toegevoegd',
  'connections.role': 'Bron of doel?',
  'connections.type': 'Aanbieder',
  'connections.name': 'Naam van de verbinding',
  'connections.title': 'Verbindingen',
  'connections.intro':
    'De accounts waarmee uw migraties inloggen. Test controleert ze alleen-lezen.',
  'connections.none': 'Nog geen verbindingen. Bij het aanmaken van uw eerste migratie worden ze toegevoegd.',
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
  'connections.standing.thisSide': 'Het ging mis op deze verbinding.',
  'probe.connected': 'Verbonden.',
  'probe.connectedSession': 'Verbonden. Het JMAP-sessiedocument antwoordde.',
  'probe.targetStatus': 'De server op {url} antwoordde {status}.',
  'probe.targetStatus.refused': 'Hij is bereikbaar en weigerde de inloggegevens.',
  'probe.targetStatus.check': 'Controleer de host en poort van het doel.',
  'probe.noProbe':
    'Er is nog geen controle voor een {kind}-verbinding; dat is ons gat, niet uw inloggegevens.',
  'probe.timedOut':
    'Geen antwoord binnen {seconds} seconden; toch bewaard, dus test later opnieuw of verklein de hoofdmap.',
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
  'setup.backToConnections': '← Terug naar verbindingen',
  'setup.fullGuide': 'Lees de volledige handleiding',
  'setup.settled': 'afgehandeld',
  'setup.stillOpen': 'nog te doen',
  'setup.waitingOnOthers': 'wacht op een beheerder',
  'setup.allDone': 'Alles is afgehandeld; rond de wizard af.',
  'setup.nothingToDo': 'Vooraf niets in te stellen; ga direct naar de wizard.',
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
  'setup.google.enable_api.title': 'Zet de API van het product aan',
  'setup.google.enable_api.detail':
    'Zet in hetzelfde project de API aan die past bij de gekozen bron — Drive, Gmail, Calendar of People. Zonder dat mislukt de eerste aanroep.',
  'setup.google.consent_scope.title': 'Laat een alleen-lezen refresh-token toestemmen',
  'setup.google.consent_scope.detail':
    'Laat de accounthouder toestemmen met de scope van dat product; een token voor het ene Google-product werkt niet voor het andere. Of gebruik een service-account met domain-wide delegation, dat een beheerder eenmalig voor het hele domein autoriseert.',
  'setup.google.consent_scope.yields': 'een refresh-token (of een service-account-sleutelbestand).',
  'setup.graph.app_registration.title': 'Registreer een app in Microsoft Entra',
  'setup.graph.app_registration.detail':
    'Entra-beheercentrum → App registrations → New registration, in de tenant waarvan u de postbussen migreert.',
  'setup.graph.app_registration.yields': 'een Tenant-ID en een Client-ID.',
  'setup.graph.api_permissions.title': 'Voeg leesrechten toe en laat een beheerder toestemmen',
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
  // ---- Asking for access (workplan 0093) ----
  'access.title': 'Toegang aanvragen',
  'access.intro':
    'Voorlopig op uitnodiging: vertel ons wat u wilt verhuizen, dan komen we per e-mail terug.',
  'access.email': 'E-mailadres',
  'access.emailHint': 'Hier antwoorden wij. Er gaat verder niets naartoe.',
  'access.name': 'Uw naam',
  'access.organisation': 'Organisatie',
  'access.optional': 'optioneel',
  'access.note': 'Wat gaat u verhuizen?',
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
    'Wij bewaren wat u invult alleen om te antwoorden; een aanvraag maakt geen account aan.',
  'access.backToSignIn': 'Heeft u al een account? Aanmelden',
};

export type Locale = 'en' | 'nl';
export type StringKey = keyof typeof en;

export const STRINGS: Record<Locale, Record<StringKey, string>> = { en, nl };

export const LOCALES: ReadonlyArray<Locale> = ['en', 'nl'];

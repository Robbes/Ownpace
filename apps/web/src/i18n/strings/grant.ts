// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The grant page somebody opens from a link, and reporting a link.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  'grantLink.title': 'Grant links',
  'grantLink.blurb':
    'The person being migrated grants access themselves, without sending you credentials.',
  'grantLink.why':
    'They need no Ownpace account. You send the link to them yourself.',
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
  // The migrator's page. Written for somebody with no account and no reason to
  // trust us, so: second person, no jargon, and nothing they have to look up.
  'grant.title': 'Connect your account',
  'grant.loading': 'One moment…',
  'grant.asking': '{organisation} is migrating your email, calendar and files to a new provider, and needs your permission to read what you currently store.',
  'grant.reads': 'You are about to give (read) access to {reads}.',
  // What each data type reads, in the words a person would use about their
  // own account, joined into `grant.reads` as the page's language joins a list
  // (workplan 0145 T6). The server names the data types; the words are ours.
  'grant.reads.email': 'your email — messages, folders and labels',
  'grant.reads.calendar': 'your calendars and their events',
  'grant.reads.contact': 'your contacts',
  'grant.reads.file': 'your files in Google Drive',
  'grant.reads.task': 'your tasks',
  // Files on any card that is no Google or Microsoft sign-in (0174 §4.5).
  'grant.reads.file.other': 'your files',
  // Where from and where to (workplan 0108 T8a): what lets a person tell their
  // own migration from a stranger's, whose every other screen is genuine.
  'grant.company': 'Company',
  'grant.companyChecked': 'Checked in the EU VAT register (VIES).',
  'grant.askedBy': 'Asked by',
  'grant.phone': 'Phone',
  'grant.from': 'From',
  'grant.to': 'To',
  'grant.toWhere': '{provider} at {host}',
  'grant.check': 'Only continue if you know who asked and the destination is yours or your organisation’s.',
  'grant.readOnly':
    'Read-only. Nothing is ever deleted or changed in your account, and nobody — not the organisation, not Ownpace — ever sees your credentials. You sign in to Google yourself, on Google’s own page.',
  // "Read-only" only where Google enforces it (workplan 0144 T3 (c)): the box
  // above says it for Drive and Tasks, whose scopes Google holds to reading.
  // Every other grant gets this one, because Google's screen, one click later,
  // describes mail, calendars and contacts as allowing changes and deletion.
  'grant.readsOnly':
    'Ownpace only reads. Ownpace never deletes or changes anything in your account, and nobody — not the organisation, not Ownpace — sees your password. You sign in to Google yourself, on Google’s own page. Google may describe the permission more broadly: for mail, calendars and contacts, the permission Ownpace asks for also allows changes. Ownpace makes none.',
  // The permission, said per scope as what it allows (the owner, 2026-10-14;
  // `../google-scope-words.ts`), as Google's own screen describes it a click
  // later. The exact scope string folds under *Technical details*, closed
  // (ADR-0041 *Decision* 4: the scopes as scopes, not only a paraphrase).
  'grant.scopeIntro': 'The permission Google will ask you for:',
  'grant.scope.mail': 'Gmail: read, send and permanently delete all your email.',
  'grant.scope.calendar': 'Google Calendar: see, change, share and delete all your calendars.',
  'grant.scope.calendarReadOnly': 'Google Calendar: see and download all your calendars.',
  'grant.scope.contacts': 'Google Contacts: see, change and delete your contacts.',
  'grant.scope.drive': 'Google Drive: see, change, create and delete all your files.',
  'grant.scope.driveReadOnly': 'Google Drive: see and download all your files.',
  'grant.scope.tasks': 'Google Tasks: see, change and delete your tasks.',
  'grant.scope.tasksReadOnly': 'Google Tasks: see your tasks.',
  'grant.scope.account': 'Your Google account: which account you sign in with, and its email address.',
  'grant.scope.other': 'Another permission, named under Technical details.',
  'grant.scope.technical': 'Technical details',
  'grant.scope.technical.line': 'Google records this permission as:',
  'grant.until': 'This link works until {date}.',
  // The account is a condition (0108 T8 (b)): what to sign in with, and why
  // Google also asks for their address.
  'grant.signInAs': 'Sign in as {account}. Google shares your address to confirm it; other accounts are refused.',
  // Above the button (workplan 0140 T3 (a)): a link sent by chat or mail opens
  // in that app's own browser, where Google is reported to refuse the consent.
  // Opening the link again elsewhere spends nothing (grant.ts), so it says so.
  'grant.inAppBrowser':
    'If this page opened inside another app, such as a chat or mail app, use that app\'s \'Open in browser\' option or copy the link into your favorite browser, such as Firefox, Safari or Chrome. The link still works.',
  'grant.connect': 'Continue with Google',
  // A person's link (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b)).
  'grant.person.migration': 'To {where}: {reads}.',
  // Said plainly under a source's migration into a destination the organisation
  // connected (the owner's decisions of 2026-11-26, change 3). {who} is whoever
  // the page already names as having set it up.
  'grant.person.theyOpenIt': '{who} can open the copy at {destination} too.',
  // Before a Google button, while Google still warns about the unverified app
  // (the Alpha; the owner's decisions of 2026-11-26, change 4). An invitation
  // to sit together with whoever set it up, never a request for help sent by
  // message: that is the shape of a known scam.
  'grant.together':
    'Google shows a warning screen next, because this service is new. You can do this step together with {who}: on the phone, or at the table.',
  'grant.person.where': '{account}, {place}',
  'grant.person.connected': 'Connected. Nothing more is needed for this account.',
  // A link made while an account was connected asks it again (workplan 0176 §15).
  'grant.person.again': 'This account was connected before. {who} asks you to connect it again.',
  'grant.person.again.alpha': 'During the Alpha, Google asks again about once a week.',
  'grant.connecting': 'Opening Google…',
  // A Microsoft account's link (workplan 0171 §3.3–3.4): the same page, in
  // Microsoft's words where Google's above name Google. The scope words say
  // what each Graph permission allows, as Microsoft's screen does a click later.
  'grant.continue.microsoft': 'Continue with Microsoft as {account}',
  'grant.connecting.microsoft': 'Opening Microsoft…',
  'grant.reads.file.microsoft': 'your files in OneDrive',
  'grant.readOnly.microsoft':
    'Read-only. Nothing is ever deleted or changed in your account, and nobody — not the organisation, not Ownpace — ever sees your password. You sign in to Microsoft yourself, on Microsoft’s own page.',
  'grant.scopeIntro.microsoft': 'The permission Microsoft will ask you for:',
  'grant.scope.microsoft.mail': 'Outlook: read your email.',
  'grant.scope.microsoft.calendar': 'Outlook calendar: read your calendars.',
  'grant.scope.microsoft.contacts': 'Outlook contacts: read your contacts.',
  'grant.scope.microsoft.files': 'OneDrive: read your files.',
  'grant.scope.microsoft.tasks': 'Microsoft To Do: read your tasks.',
  'grant.scope.microsoft.account': 'Your Microsoft account: sign you in, and read your profile and addresses.',
  'grant.scope.microsoft.offline': 'Keep this access while you are away, until you withdraw it.',
  'grant.scope.technical.line.microsoft': 'Microsoft records this permission as:',
  'grant.signInAs.microsoft':
    'Sign in as {account}. Microsoft confirms which account signed in; other accounts are refused.',
  'grant.withdraw.microsoft':
    'You can withdraw this access at any time: on the progress page you get once you have granted it, or in your Microsoft account, under the apps that have access.',
  // A Dropbox link (workplan 0174 §6): the same page, in Dropbox's words.
  // Dropbox takes no login hint, so the sign-in line says what to do when it
  // offers another account.
  // A destination's Cirrux Drive on a person's link (workplan 0174 §4.4, T5),
  // shown once the account's app password is stored. The button's words are
  // the owner's own (`account.cirrux.connect`).
  // The person's progress page after a password (0174 §5.3 step 8), in the
  // words the sign-in ending's own page says it (`google-consent.ts`).
  // In the ending's own words (workplan 0176 D1, §15): kopiëren, never migreren.
  'grant.person.yourPage':
    'Here is your own page. Keep this one. It shows how far the copying is, and nothing from inside your account:',
  'grant.person.keepIt':
    'Keep this link: bookmark it or copy it somewhere safe. It works for the next 90 days, and {who} can turn it off at any time.',
  'grant.connecting.cirrux': 'Opening Cirrux…',
  'grant.cirrux.drive':
    'Your files go to Cirrux Drive, which takes your own Cirrux sign-in rather than the app password. You sign in to Cirrux yourself, on Cirrux’s own page.',
  'grant.cirrux.signInAs': 'Sign in to Cirrux with the account {account} belongs to.',
  'grant.continue.dropbox': 'Continue with Dropbox as {account}',
  'grant.connecting.dropbox': 'Opening Dropbox…',
  'grant.reads.file.dropbox': 'your files in Dropbox',
  'grant.readOnly.dropbox':
    'Read-only. Nothing is ever deleted or changed in your Dropbox, and nobody — not the organisation, not Ownpace — ever sees your password. You sign in to Dropbox yourself, on Dropbox’s own page.',
  'grant.scopeIntro.dropbox': 'The permission Dropbox will ask you for:',
  'grant.scope.dropbox.files': 'Dropbox: read your files.',
  'grant.scope.dropbox.account': 'Your Dropbox account: read your name, your email address and how much space you use.',
  'grant.scope.technical.line.dropbox': 'Dropbox records this permission as:',
  'grant.signInAs.dropbox':
    'Sign in as {account}. Dropbox confirms which account signed in; other accounts are refused. If Dropbox offers another account, sign out of it first.',
  'grant.withdraw.dropbox':
    'You can withdraw this access at any time: on the progress page you get once you have granted it, or in your Dropbox settings, under Connected apps.',
  'grant.disclosure': 'By continuing you accept how your data is handled:',
  'grant.withdraw':
    'You can withdraw this access at any time: on the progress page you get once you have granted it, or in your Google account’s security settings, under the apps that have access.',
  // A person's link asks for ACCOUNTS (workplan 0174 §4.5): the ones their
  // data is copied from, then the ones it is copied to, each with its state.
  'grant.group.from': 'The accounts your data is copied from',
  'grant.group.to': 'The accounts your data is copied to',
  'grant.person.migrationFrom': 'From {where}: {reads}.',
  'grant.state.connected': 'Connected',
  'grant.state.waiting': 'Waiting',
  'grant.state.locked': 'Locked on this link',
  'grant.person.allConnected': 'Every account is connected. You can close this page.',
  // A PERSON'S LINK, ONE THING AT A TIME (workplan 0176 T1, §5, §15): the
  // first screen and its question, the accounts, what to have ready, and what
  // the provider shows. A reader with no account, often older, who was taught
  // never to tap a link: every sentence one idea, plain, and true one screen
  // later (R3). Drafts for the owner's read.
  'grant.person.ownpace': 'This page is from Ownpace, the service that makes the copy.',
  'grant.person.title': '{who} asks for your permission',
  'grant.person.sender': 'Sender',
  // Who the sender is (workplan 0176 §7, T3; D7, D11): the name they gave,
  // then how the reader knows them, from the fixed list, said after the name.
  'grant.person.senderIs': '{who}, {relation}',
  'sender.relation.daughter': 'your daughter',
  'sender.relation.son': 'your son',
  'sender.relation.child': 'your child',
  'sender.relation.granddaughter': 'your granddaughter',
  'sender.relation.grandson': 'your grandson',
  'sender.relation.grandchild': 'your grandchild',
  'sender.relation.partner': 'your partner',
  'sender.relation.brother': 'your brother',
  'sender.relation.sister': 'your sister',
  'sender.relation.father': 'your father',
  'sender.relation.mother': 'your mother',
  'sender.relation.family': 'a family member',
  'sender.relation.acquaintance': 'someone you know',
  'sender.relation.colleague': 'your colleague',
  // A number to check, never proof (§7, D11): the member's own, else the
  // organisation's, saying whose it is. `{phone}` is drawn as a link.
  'grant.person.number': "{who}'s number: {phone}. Or use the number you already have for {who}.",
  'grant.person.number.organisation': 'The number of {organisation}: {phone}. Or use the number you already have for {who}.',
  'grant.person.place': '{place} ({account})',
  'grant.person.whatOne': '{who} wants to copy your {what} from {source} to {destination}.',
  'grant.person.whatMany': '{who} wants to copy your {what}. The next screen shows from where and to where.',
  'grant.person.fact.stays': 'Everything also stays in {source}.',
  'grant.person.fact.reads': 'Ownpace only reads there. It deletes nothing and changes nothing.',
  'grant.person.fact.noHurry': 'There is no hurry. You can do this until {date}.',
  'grant.person.told': 'Did {who} tell you about this link themselves?',
  'grant.person.yes': 'Yes, that is right',
  'grant.person.notYet': 'No, not yet',
  'grant.person.wait.title': 'Then wait a moment',
  'grant.person.wait.ask':
    'Ask {who} first, in a way you trust. Call the number you already have. Or ask when you see each other.',
  'grant.person.wait.until': 'This page can wait. The link works until {date}.',
  'grant.person.wait.unknown': 'Do you not know {who}? Then close this page. You can also report this link.',
  'grant.person.accounts.title': 'Your accounts',
  'grant.person.connectAccount': 'Connect {account}',
  'grant.person.ready.title': 'Have this ready',
  'grant.person.ready.address': 'The address {account}.',
  'grant.person.ready.password': 'The password of your {provider} account.',
  'grant.person.ready.passwordOf': 'The password of {account}.',
  'grant.person.ready.typeIt': 'You type it only on {provider}’s own page. Ownpace never sees it. {who} does not either.',
  'grant.person.ready.phone': 'Your phone. {provider} may send a code to it.',
  'grant.person.ready.code': 'Give that code to nobody. Not to {who} either.',
  'grant.person.ready.unknownPassword': 'Do you not know the password? Then stop here, and do this together with {who}.',
  'grant.person.ready.together': 'Do this together with {who} if you can: on the phone, or at the table.',
  'grant.person.see.title': 'What you will see at {provider}',
  'grant.person.see.signIn': '{provider} asks you to sign in.',
  // Google's warning, until the owner's hand test has Google's own words
  // (T0): what is known and ours, quoting nothing (D12 (a), 2026-11-26).
  'grant.person.see.warning': 'Google has not checked Ownpace yet. That is why Google warns, and Google is right to.',
  'grant.person.see.goOn': 'Go on to Ownpace there.',
  'grant.person.see.onlyHere':
    'Do this only here, because {who} told you about it themselves. At any other warning, stop.',
  'grant.person.see.broader':
    'Google’s words are broader than what Ownpace does. Ownpace only reads. It sends nothing and deletes nothing.',
  'grant.person.see.ticks': 'Make sure everything Ownpace asks for is ticked.',
  'grant.person.see.blocked':
    'Does Google not allow the connection? Then this address is not on Google’s list yet. Close the page and tell {who}. You did nothing wrong.',
  // Until one link is built (T4), the stop is on the page the ending hands over.
  'grant.person.see.stop': 'You can stop this at any time, on the page you get afterwards.',
  'grant.person.see.next': 'The next step is on {provider}’s own page.',
  'grant.person.signIn': 'Sign in with {provider}',
  'grant.person.ratherNot': 'No, rather not',
  'grant.person.ratherNot.title': 'That is fine',
  'grant.person.ratherNot.body': 'Nothing has happened. You can close this page, or come back later: the link works until {date}.',
  'grant.step': 'Step {n} of {total}',
  'grant.step.next': 'Next',
  'grant.step.back': 'Back',
  // The own-password card (0174 §5.2, §5.7, §5.8). Short sentences, in the
  // words the Google and Microsoft cards above already use.
  'grant.password.title': 'Connect {account} with your password',
  'grant.password.server': 'Your password is checked with {server}. Type it only if this is your own provider’s server.',
  'grant.password.published': 'Your password is checked with {provider}’s own server, {server}.',
  // The progress page, once a destination's password is removed (0174 §4.3, §5.9).
  'grant.password.withdrawn': 'Removed here. Delete or change this password at {provider} too, if you want to be sure.',
  // D3's addition (the owner, 2026-11-25): a warning, never a refusal.
  'grant.password.notAddressMail':
    'This server is not one your address’s mail uses, as far as we can tell. Type your password only if you know it is your provider’s.',
  'grant.password.nobody':
    'It is stored encrypted. Nobody can see it again: not {askedBy}, not {organisation}, not Ownpace’s staff.',
  'grant.password.never': 'Ownpace never emails you a link and never asks for your password by email or phone.',
  'grant.password.noPhone':
    '{organisation} has not given a phone number. If you are not sure this link came from {askedBy}, ask them some other way before you type anything.',
  'grant.password.appPassword': 'Use an app password if your provider offers one.',
  'grant.password.show': 'Show',
  'grant.password.hide': 'Hide',
  'grant.password.submit': 'Check and connect',
  'grant.password.checking': 'Checking with {server}…',
  'grant.password.connected': 'Connected. Your password works and is stored encrypted.',
  'grant.password.triesLeft': 'Tries left on this link: {left}.',
  'grant.password.refused': '{server} did not accept this password. Check it and try again. Tries left: {left}.',
  'grant.password.refused.app': 'Make sure it is an app password, not the password you sign in with.',
  'grant.password.unreachable':
    '{server} could not be reached. This is not your password. Try again in a few minutes; if it keeps happening, tell {askedBy}.',
  'grant.password.faceMissing': 'Your password works, but {server} gives no access to: {faces}.',
  'grant.password.locked': 'Too many tries on this link. Ask {askedBy} for a new link.',
  // How to make the password the card asks for, folded (the guides' own steps).
  'grant.apple.how': 'How do I make an app-specific password?',
  'grant.apple.how.more':
    'Sign in at account.apple.com. Choose Sign-In and Security, then App-Specific Passwords. Make one, name it Ownpace, and type it here. Apple shows it only once.',
  'grant.nextcloud.how': 'How do I make an app password?',
  'grant.nextcloud.how.more':
    'Open your Nextcloud in the browser. Go to Settings, Security, Devices & sessions. Type a name such as Ownpace, press Create new app password, and type the password it shows here.',
  // Report this link (workplan 0108 T8 (d)): on the grant and progress pages,
  // to the owner's helpdesk, never to the organisation that asked.
  'linkReport.open': 'Report this link',
  'linkReport.intro': 'Your report goes to the Ownpace team, not to {organisation}.',
  'linkReport.description': 'What makes you doubt this link?',
  'linkReport.replyTo': 'Your email address (optional)',
  'linkReport.replyTo.hint': 'Only for us to answer your report.',
  'linkReport.sentWith':
    'Sent with it, from our records: which link this is; the organisation and the copying it belongs to, and how far it is; the address of whoever made the link; the account it copies from and the account it copies to; and whether you have given access.',
  'linkReport.send': 'Send the report',
  'linkReport.sending': 'Sending…',
  'linkReport.sent': 'Sent. Your report is number {ticket}, and we will reply to {email}.',
  'linkReport.sent.anonymous': 'Sent. Your report is number {ticket}. Without an email address, we cannot answer you.',
  'linkReport.sent.mail': 'Sent to our support team, with report reference {reference}. We will reply by email to {email}.',
  'linkReport.sent.mail.anonymous':
    'Sent to our support team, with report reference {reference}. Without an email address, we cannot answer you.',
  'linkReport.next.grant': 'Nothing is read unless you allow it.',
  'linkReport.next.withdraw': 'To stop the copying now, press Stop copying above.',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'grantLink.title': 'Toegangslinks',
  'grantLink.blurb':
    'Degene die gemigreerd wordt geeft zelf toegang, zonder een wachtwoord met u te delen.',
  'grantLink.why':
    'Een Ownpace-account is niet nodig. Deel de link zelf met de ontvanger.',
  'grantLink.expiryLabel': 'De link werkt',
  'grantLink.expiry.1': '1 dag',
  'grantLink.expiry.7': '7 dagen',
  'grantLink.expiry.30': '30 dagen',
  'grantLink.expiry.90': '90 dagen',
  'grantLink.expiry.180': '180 dagen',
  'grantLink.issue': 'Toegangslink maken',
  'grantLink.issuing': 'Bezig met maken…',
  'grantLink.issued.once': 'Stel deze link veilig, omdat hij maar één keer wordt getoond.',
  'grantLink.issued.urlLabel': 'De toegangslink',
  'grantLink.issued.until': 'Werkt tot {date}.',
  'grantLink.issued.youSend':
    'Stuur hem zelf; niet opnieuw te tonen, dus bij verlies intrekken en opnieuw maken.',
  'grantLink.copy': 'Kopiëren',
  'grantLink.copied': 'Gekopieerd',
  'grantLink.empty': 'Nog geen links voor deze migratie.',
  'grantLink.loadError': 'Kon de links van deze migratie niet lezen.',
  'grantLink.issuedBy': 'Gemaakt op {date} door {who}',
  'grantLink.issuedByGrant': 'Gemaakt op {date}, toen zij toegang gaven',
  'grantLink.worksUntil': 'Werkt tot {date}.',
  'grantLink.grantedOn': 'Op {date} is toegang gegeven. Deze link is gebruikt en werkt niet meer.',
  'grantLink.revokedOn': 'U hebt hem ingetrokken op {date}.',
  'grantLink.expiredOn': 'Op {date} verlopen zonder te zijn gebruikt.',
  'grantLink.expiredNudge':
    'Niemand heeft toegang gegeven. Maak een nieuwe link en stuur die opnieuw.',
  'grantLink.revoke': 'Intrekken',
  'grantLink.revokeArmed': 'Bevestig intrekken',
  'grant.title': 'Verbind uw account',
  'grant.loading': 'Een moment…',
  'grant.asking': '{organisation} migreert uw e-mail, agenda en bestanden naar een nieuwe aanbieder en heeft uw toestemming nodig om te lezen wat u nu bewaart.',
  'grant.reads': 'U staat op het punt (lees)toegang te geven tot {reads}.',
  'grant.reads.email': 'uw e-mail: berichten, mappen en labels',
  'grant.reads.calendar': 'uw agenda’s en de afspraken daarin',
  'grant.reads.contact': 'uw contactpersonen',
  'grant.reads.file': 'uw bestanden in Google Drive',
  'grant.reads.task': 'uw taken',
  'grant.reads.file.other': 'uw bestanden',
  'grant.company': 'Bedrijf',
  'grant.companyChecked': 'Gecontroleerd in EU-btw-register (VIES).',
  'grant.askedBy': 'Gevraagd door',
  'grant.phone': 'Telefoon',
  'grant.from': 'Van',
  'grant.to': 'Naar',
  'grant.toWhere': '{provider} op {host}',
  'grant.check': 'Ga alleen verder als u de aanvrager kent en de bestemming van u of uw organisatie is.',
  'grant.readOnly':
    'Alleen lezen. Er wordt nooit iets verwijderd of gewijzigd in uw account, en niemand — niet de organisatie, niet Ownpace — ziet uw wachtwoord. U logt zelf in bij Google, op de pagina van Google zelf.',
  'grant.readsOnly':
    'Ownpace leest alleen. Ownpace verwijdert of wijzigt nooit iets in uw account, en niemand — niet de organisatie, niet Ownpace — ziet ooit uw wachtwoord. U logt zelf in bij Google, op de pagina van Google zelf. Google kan de toestemming ruimer omschrijven: voor e-mail, agenda’s en contacten staat de toestemming die Ownpace vraagt ook wijzigingen toe. Ownpace brengt er geen aan.',
  'grant.scopeIntro': 'De toestemming die Google u vraagt:',
  'grant.scope.mail': 'Gmail: al uw e-mail lezen, verzenden en definitief verwijderen.',
  'grant.scope.calendar': 'Google Agenda: al uw agenda’s bekijken, wijzigen, delen en verwijderen.',
  'grant.scope.calendarReadOnly': 'Google Agenda: al uw agenda’s bekijken en downloaden.',
  'grant.scope.contacts': 'Google Contacten: uw contactpersonen bekijken, wijzigen en verwijderen.',
  'grant.scope.drive': 'Google Drive: al uw bestanden bekijken, wijzigen, maken en verwijderen.',
  'grant.scope.driveReadOnly': 'Google Drive: al uw bestanden bekijken en downloaden.',
  'grant.scope.tasks': 'Google Tasks: uw taken bekijken, wijzigen en verwijderen.',
  'grant.scope.tasksReadOnly': 'Google Tasks: uw taken bekijken.',
  'grant.scope.account': 'Uw Google-account: met welk account u zich aanmeldt, en het e-mailadres ervan.',
  'grant.scope.other': 'Een andere toestemming, genoemd onder Technische details.',
  'grant.scope.technical': 'Technische details',
  'grant.scope.technical.line': 'Google legt deze toestemming vast als:',
  'grant.until': 'Deze link werkt tot {date}.',
  'grant.signInAs': 'Log in als {account}. Google deelt uw adres ter controle; andere accounts worden geweigerd.',
  'grant.inAppBrowser':
    'Is deze pagina geopend in een andere app, zoals een chat- of mailapp? Kies daar \'Openen in browser\' of kopieer de link naar uw favoriete browser, zoals Firefox, Safari of Chrome. De link blijft werken.',
  'grant.connect': 'Doorgaan met Google',
  'grant.person.migration': 'Naar {where}: {reads}.',
  'grant.person.theyOpenIt': '{who} kan de kopie bij {destination} ook openen.',
  'grant.together':
    'Google toont straks een waarschuwing, omdat deze dienst nieuw is. U kunt deze stap samen met {who} doen: aan de telefoon, of aan tafel.',
  'grant.person.where': '{account}, {place}',
  'grant.person.connected': 'Verbonden. Voor dit account hoeft u niets meer te doen.',
  'grant.person.again': 'Dit account was al verbonden. {who} vraagt u het opnieuw te verbinden.',
  'grant.person.again.alpha': 'Tijdens de Alpha vraagt Google dit ongeveer één keer per week opnieuw.',
  'grant.connecting': 'Google wordt geopend…',
  'grant.continue.microsoft': 'Doorgaan met Microsoft als {account}',
  'grant.connecting.microsoft': 'Microsoft wordt geopend…',
  'grant.reads.file.microsoft': 'uw bestanden in OneDrive',
  'grant.readOnly.microsoft':
    'Alleen lezen. Er wordt nooit iets verwijderd of gewijzigd in uw account, en niemand — niet de organisatie, niet Ownpace — ziet uw wachtwoord. U logt zelf in bij Microsoft, op de pagina van Microsoft zelf.',
  'grant.scopeIntro.microsoft': 'De toestemming die Microsoft u vraagt:',
  'grant.scope.microsoft.mail': 'Outlook: uw e-mail lezen.',
  'grant.scope.microsoft.calendar': 'Outlook-agenda: uw agenda’s lezen.',
  'grant.scope.microsoft.contacts': 'Outlook-contactpersonen: uw contactpersonen lezen.',
  'grant.scope.microsoft.files': 'OneDrive: uw bestanden lezen.',
  'grant.scope.microsoft.tasks': 'Microsoft To Do: uw taken lezen.',
  'grant.scope.microsoft.account': 'Uw Microsoft-account: u aanmelden, en uw profiel en adressen lezen.',
  'grant.scope.microsoft.offline': 'Deze toegang houden terwijl u weg bent, tot u die intrekt.',
  'grant.scope.technical.line.microsoft': 'Microsoft legt deze toestemming vast als:',
  'grant.signInAs.microsoft':
    'Log in als {account}. Microsoft bevestigt met welk account u zich aanmeldt; andere accounts worden geweigerd.',
  'grant.withdraw.microsoft':
    'U kunt deze toegang op elk moment intrekken: op de voortgangspagina die u krijgt zodra u toegang hebt gegeven, of in uw Microsoft-account, bij de apps die toegang hebben.',
  'grant.person.yourPage':
    'Hier is uw eigen pagina. Bewaar deze. Die laat zien hoe ver het kopiëren is, en niets uit uw account:',
  'grant.person.keepIt':
    'Bewaar deze link: zet hem bij uw favorieten of kopieer hem naar een veilige plek. Hij werkt de komende 90 dagen, en {who} kan hem op elk moment uitzetten.',
  'grant.connecting.cirrux': 'Cirrux wordt geopend…',
  'grant.cirrux.drive':
    'Uw bestanden gaan naar Cirrux Drive, en daarvoor is uw eigen aanmelding bij Cirrux nodig, niet het app-wachtwoord. U meldt zich zelf aan bij Cirrux, op de pagina van Cirrux zelf.',
  'grant.cirrux.signInAs': 'Meld u bij Cirrux aan met het account waar {account} bij hoort.',
  'grant.continue.dropbox': 'Doorgaan met Dropbox als {account}',
  'grant.connecting.dropbox': 'Dropbox wordt geopend…',
  'grant.reads.file.dropbox': 'uw bestanden in Dropbox',
  'grant.readOnly.dropbox':
    'Alleen lezen. Er wordt nooit iets verwijderd of gewijzigd in uw Dropbox, en niemand — niet de organisatie, niet Ownpace — ziet uw wachtwoord. U logt zelf in bij Dropbox, op de pagina van Dropbox zelf.',
  'grant.scopeIntro.dropbox': 'De toestemming die Dropbox u vraagt:',
  'grant.scope.dropbox.files': 'Dropbox: uw bestanden lezen.',
  'grant.scope.dropbox.account': 'Uw Dropbox-account: uw naam, uw e-mailadres en uw gebruikte ruimte lezen.',
  'grant.scope.technical.line.dropbox': 'Dropbox legt deze toestemming vast als:',
  'grant.signInAs.dropbox':
    'Log in als {account}. Dropbox bevestigt met welk account u zich aanmeldt; andere accounts worden geweigerd. Biedt Dropbox een ander account aan, meld u daar dan eerst af.',
  'grant.withdraw.dropbox':
    'U kunt deze toegang op elk moment intrekken: op de voortgangspagina die u krijgt zodra u toegang hebt gegeven, of in uw Dropbox-instellingen, bij Verbonden apps.',
  'grant.disclosure': 'Door door te gaan gaat u akkoord met hoe uw gegevens worden verwerkt:',
  'grant.withdraw':
    'U kunt deze toegang op elk moment intrekken: op de voortgangspagina die u krijgt zodra u toegang hebt gegeven, of via de beveiligingsinstellingen van uw Google-account, bij de apps die toegang hebben.',
  'grant.group.from': 'De accounts waaruit uw gegevens worden gekopieerd',
  'grant.group.to': 'De accounts waarnaar uw gegevens worden gekopieerd',
  'grant.person.migrationFrom': 'Van {where}: {reads}.',
  'grant.state.connected': 'Verbonden',
  'grant.state.waiting': 'Nog niet verbonden',
  'grant.state.locked': 'Geblokkeerd voor deze link',
  'grant.person.allConnected': 'Alle accounts zijn verbonden. U kunt deze pagina sluiten.',
  'grant.person.ownpace': 'Deze pagina is van Ownpace, de dienst die de kopie maakt.',
  'grant.person.title': '{who} vraagt uw toestemming',
  'grant.person.sender': 'Afzender',
  'grant.person.senderIs': '{who}, {relation}',
  'sender.relation.daughter': 'uw dochter',
  'sender.relation.son': 'uw zoon',
  'sender.relation.child': 'uw kind',
  'sender.relation.granddaughter': 'uw kleindochter',
  'sender.relation.grandson': 'uw kleinzoon',
  'sender.relation.grandchild': 'uw kleinkind',
  'sender.relation.partner': 'uw partner',
  'sender.relation.brother': 'uw broer',
  'sender.relation.sister': 'uw zus',
  'sender.relation.father': 'uw vader',
  'sender.relation.mother': 'uw moeder',
  'sender.relation.family': 'een familielid',
  'sender.relation.acquaintance': 'iemand die u kent',
  'sender.relation.colleague': 'uw collega',
  'grant.person.number': 'Nummer van {who}: {phone}. Of gebruik het nummer dat u al van {who} hebt.',
  'grant.person.number.organisation': 'Nummer van {organisation}: {phone}. Of gebruik het nummer dat u al van {who} hebt.',
  'grant.person.place': '{place} ({account})',
  'grant.person.whatOne': '{who} wil uw {what} kopiëren van {source} naar {destination}.',
  'grant.person.whatMany': '{who} wil uw {what} kopiëren. Op het volgende scherm staat waarvandaan en waarnaartoe.',
  'grant.person.fact.stays': 'Alles blijft ook in {source} staan.',
  'grant.person.fact.reads': 'Ownpace leest daar alleen. Het verwijdert niets en wijzigt niets.',
  'grant.person.fact.noHurry': 'Er is geen haast. Dit kan tot {date}.',
  'grant.person.told': 'Heeft {who} u zelf over deze link verteld?',
  'grant.person.yes': 'Ja, dat klopt',
  'grant.person.notYet': 'Nee, nog niet',
  'grant.person.wait.title': 'Wacht dan even',
  'grant.person.wait.ask':
    'Vraag het eerst aan {who}, op een manier die u vertrouwt. Bel het nummer dat u al hebt. Of vraag het als u elkaar ziet.',
  'grant.person.wait.until': 'Deze pagina kan wachten. De link werkt tot {date}.',
  'grant.person.wait.unknown': 'Kent u {who} niet? Sluit dan deze pagina. U kunt deze link ook melden.',
  'grant.person.accounts.title': 'Uw accounts',
  'grant.person.connectAccount': '{account} verbinden',
  'grant.person.ready.title': 'Leg dit klaar',
  'grant.person.ready.address': 'Het adres {account}.',
  'grant.person.ready.password': 'Het wachtwoord van uw {provider}-account.',
  'grant.person.ready.passwordOf': 'Het wachtwoord van {account}.',
  'grant.person.ready.typeIt': 'U typt het alleen op de pagina van {provider} zelf. Ownpace ziet het nooit. {who} ook niet.',
  'grant.person.ready.phone': 'Uw telefoon. {provider} kan daar een code naartoe sturen.',
  'grant.person.ready.code': 'Geef die code aan niemand. Ook niet aan {who}.',
  'grant.person.ready.unknownPassword': 'Weet u het wachtwoord niet? Stop dan hier, en doe dit samen met {who}.',
  'grant.person.ready.together': 'Doe dit het liefst samen met {who}: aan de telefoon, of aan tafel.',
  'grant.person.see.title': 'Dit ziet u straks bij {provider}',
  'grant.person.see.signIn': '{provider} vraagt u in te loggen.',
  'grant.person.see.warning': 'Google heeft Ownpace nog niet gecontroleerd. Daarom waarschuwt Google, en dat is terecht.',
  'grant.person.see.goOn': 'Ga daar verder naar Ownpace.',
  'grant.person.see.onlyHere':
    'Doe dit alleen hier, omdat {who} het u zelf heeft verteld. Bij elke andere waarschuwing stopt u.',
  'grant.person.see.broader':
    'Google beschrijft het ruimer dan wat Ownpace doet. Ownpace leest alleen. Het verzendt niets en verwijdert niets.',
  'grant.person.see.ticks': 'Zorg dat alles wat Ownpace vraagt een vinkje heeft.',
  'grant.person.see.blocked':
    'Laat Google de verbinding niet toe? Dan staat dit adres nog niet op de lijst van Google. Sluit de pagina en vertel het {who}. U hebt niets fout gedaan.',
  'grant.person.see.stop': 'U kunt dit altijd weer stoppen, op de pagina die u hierna krijgt.',
  'grant.person.see.next': 'De volgende stap doet u op de pagina van {provider} zelf.',
  'grant.person.signIn': 'Inloggen met {provider}',
  'grant.person.ratherNot': 'Nee, liever niet',
  'grant.person.ratherNot.title': 'Dat mag',
  'grant.person.ratherNot.body': 'Er is niets gebeurd. U kunt deze pagina sluiten, of later terugkomen: de link werkt tot {date}.',
  'grant.step': 'Stap {n} van {total}',
  'grant.step.next': 'Verder',
  'grant.step.back': 'Terug',
  'grant.password.title': 'Verbind {account} met uw wachtwoord',
  'grant.password.server':
    'Uw wachtwoord wordt gecontroleerd bij {server}. Typ het alleen als dit de server van uw eigen aanbieder is.',
  'grant.password.published': 'Uw wachtwoord wordt gecontroleerd bij de eigen server van {provider}, {server}.',
  'grant.password.withdrawn': 'Hier verwijderd. Verwijder of wijzig dit wachtwoord ook bij {provider} als u het zeker wilt weten.',
  'grant.password.notAddressMail':
    'Deze server hoort niet bij de mail van uw adres, voor zover wij kunnen zien. Typ uw wachtwoord alleen als u zeker weet dat het de server van uw aanbieder is.',
  'grant.password.nobody':
    'Het wordt versleuteld bewaard. Niemand kan het nog zien: niet {askedBy}, niet {organisation}, niet de medewerkers van Ownpace.',
  'grant.password.never': 'Ownpace mailt u nooit een link en vraagt nooit per e-mail of telefoon om uw wachtwoord.',
  'grant.password.noPhone':
    '{organisation} heeft geen telefoonnummer opgegeven. Weet u niet zeker of deze link van {askedBy} komt? Vraag het dan op een andere manier voordat u iets typt.',
  'grant.password.appPassword': 'Gebruik een app-wachtwoord als uw aanbieder dat biedt.',
  'grant.password.show': 'Tonen',
  'grant.password.hide': 'Verbergen',
  'grant.password.submit': 'Controleren en verbinden',
  'grant.password.checking': 'Bezig met controleren bij {server}…',
  'grant.password.connected': 'Verbonden. Uw wachtwoord werkt en is versleuteld bewaard.',
  'grant.password.triesLeft': 'Pogingen over met deze link: {left}.',
  'grant.password.refused':
    '{server} accepteerde dit wachtwoord niet. Controleer het en probeer het opnieuw. Pogingen over: {left}.',
  'grant.password.refused.app': 'Controleer of het een app-wachtwoord is, niet het wachtwoord waarmee u inlogt.',
  'grant.password.unreachable':
    '{server} was niet bereikbaar. Dat ligt niet aan uw wachtwoord. Probeer het over een paar minuten opnieuw. Blijft het gebeuren, laat het dan {askedBy} weten.',
  'grant.password.faceMissing': 'Uw wachtwoord werkt, maar {server} geeft geen toegang tot: {faces}.',
  'grant.password.locked': 'Te vaak geprobeerd met deze link. Vraag {askedBy} om een nieuwe link.',
  'grant.apple.how': 'Hoe maak ik een app-specifiek wachtwoord?',
  'grant.apple.how.more':
    'Meld u aan op account.apple.com. Kies Inloggen en beveiliging, dan App-specifieke wachtwoorden. Maak er een, noem het Ownpace en typ het hier. Apple toont het maar één keer.',
  'grant.nextcloud.how': 'Hoe maak ik een app-wachtwoord?',
  'grant.nextcloud.how.more':
    'Open uw Nextcloud in de browser. Ga naar Instellingen, Beveiliging, Apparaten & sessies. Typ een naam zoals Ownpace, druk op Creëer een nieuw app wachtwoord en typ hier het wachtwoord dat Nextcloud toont.',
  'linkReport.open': 'Deze link melden',
  'linkReport.intro': 'Uw melding gaat naar het Ownpace-supportteam, niet naar {organisation}.',
  'linkReport.description': 'Waarom twijfelt u aan deze link?',
  'linkReport.replyTo': 'Uw e-mailadres (niet verplicht)',
  'linkReport.replyTo.hint': 'Alleen zodat wij op uw melding kunnen antwoorden.',
  'linkReport.sentWith':
    'Meegestuurd, uit onze gegevens: welke link dit is; de organisatie en het kopiëren waar hij bij hoort, en hoe ver dat is; het adres van wie de link heeft gemaakt; het account waaruit wordt gekopieerd en het account waarnaar; en of u toegang hebt gegeven.',
  'linkReport.send': 'Melding versturen',
  'linkReport.sending': 'Versturen…',
  'linkReport.sent': 'Verstuurd. Uw melding heeft nummer {ticket}, en we antwoorden naar {email}.',
  'linkReport.sent.anonymous': 'Verstuurd. Uw melding heeft nummer {ticket}. Zonder mailadres kunnen we u niet antwoorden.',
  'linkReport.sent.mail': 'Verstuurd naar ons supportteam, met meldingskenmerk {reference}. We antwoorden per e-mail naar {email}.',
  'linkReport.sent.mail.anonymous':
    'Verstuurd naar ons supportteam, met meldingskenmerk {reference}. Zonder mailadres kunnen we u niet antwoorden.',
  'linkReport.next.grant': 'Er wordt niets gelezen zonder uw toestemming.',
  'linkReport.next.withdraw': 'Wilt u het kopiëren nu stoppen? Druk dan hierboven op Kopiëren stoppen.',
};

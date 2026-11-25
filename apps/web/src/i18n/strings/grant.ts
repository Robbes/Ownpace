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
  'grant.asking': '{organisation} is migrating your account and/or content to a new provider, and needs your permission to read what you currently store.',
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
  // A person's link (ADR-0035, amended 2026-09-29; workplan 0153 T5 (b)): one
  // card per Google account, each asked once.
  'grant.person.asking':
    '{organisation} is moving your accounts and/or content to a new provider, and needs your permission to read what you currently hold. Each account below asks once.',
  'grant.person.migration': 'To {where}: {reads}.',
  'grant.person.where': '{account}, {place}',
  'grant.person.connect': 'Continue with Google as {account}',
  'grant.person.connected': 'Connected. Nothing more is needed for this account.',
  'grant.person.again':
    'This account was connected before. Whoever sent this link asks you to connect again, for instance because the connection stopped working.',
  'grant.person.connectAgain': 'Connect again with Google as {account}',
  'grant.connecting': 'Opening Google…',
  // A Microsoft account's link (workplan 0171 §3.3–3.4): the same page, in
  // Microsoft's words where Google's above name Google. The scope words say
  // what each Graph permission allows, as Microsoft's screen does a click later.
  'grant.continue.microsoft': 'Continue with Microsoft as {account}',
  'grant.connectAgain.microsoft': 'Connect again with Microsoft as {account}',
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
  // The own-password card (0174 §5.2, §5.7, §5.8). Short sentences, in the
  // words the Google and Microsoft cards above already use.
  'grant.password.title': 'Connect {account} with your password',
  'grant.password.server': 'Your password is checked with {server}. Type it only if this is your own provider’s server.',
  'grant.password.published': 'Your password is checked with {provider}’s own server, {server}.',
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
  'grant.password.faceMissing': 'Your password works, but {server} refused {faces}.',
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
    'Sent with it, from our records: which link this is; the organisation and the migration it belongs to, the state of the migration; the address of whoever made the link; the account the migration copies from and the account it copies to; and whether you have given access.',
  'linkReport.send': 'Send the report',
  'linkReport.sending': 'Sending…',
  'linkReport.sent': 'Sent. Your report is number {ticket}, and we will reply to {email}.',
  'linkReport.sent.anonymous': 'Sent. Your report is number {ticket}. Without an email address, we cannot answer you.',
  'linkReport.sent.mail': 'Sent to our support team, with report reference {reference}. We will reply by email to {email}.',
  'linkReport.sent.mail.anonymous':
    'Sent to our support team, with report reference {reference}. Without an email address, we cannot answer you.',
  'linkReport.next.grant': 'Nothing is read unless you allow it at Google.',
  'linkReport.next.withdraw': 'To stop the copying now, withdraw the access above.',
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
  'grant.asking': '{organisation} migreert uw account naar een nieuwe aanbieder en heeft uw toestemming nodig om te lezen wat voor u moet worden gemigreerd.',
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
  'grant.person.asking':
    '{organisation} migreert uw accounts naar een nieuwe aanbieder en heeft uw toestemming nodig om te lezen wat erin zit. Elk account hieronder vraagt het één keer.',
  'grant.person.migration': 'Naar {where}: {reads}.',
  'grant.person.where': '{account}, {place}',
  'grant.person.connect': 'Doorgaan met Google als {account}',
  'grant.person.connected': 'Verbonden. Dit account is klaar om te gebruiken in een migratie.',
  'grant.person.again':
    'Dit account was al verbonden. Wie u deze link stuurde, vraagt u opnieuw te verbinden, bijvoorbeeld omdat de verbinding niet meer werkt.',
  'grant.person.connectAgain': 'Opnieuw verbinden met Google als {account}',
  'grant.connecting': 'Google wordt geopend…',
  'grant.continue.microsoft': 'Doorgaan met Microsoft als {account}',
  'grant.connectAgain.microsoft': 'Opnieuw verbinden met Microsoft als {account}',
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
  'grant.disclosure': 'Door door te gaan gaat u akkoord met hoe uw gegevens worden verwerkt:',
  'grant.withdraw':
    'U kunt deze toegang op elk moment intrekken: op de voortgangspagina die u krijgt zodra u toegang hebt gegeven, of via de beveiligingsinstellingen van uw Google-account, bij de apps die toegang hebben.',
  'grant.group.from': 'De accounts waaruit uw gegevens worden gekopieerd',
  'grant.group.to': 'De accounts waarnaar uw gegevens worden gekopieerd',
  'grant.person.migrationFrom': 'Van {where}: {reads}.',
  'grant.state.connected': 'Verbonden',
  'grant.state.waiting': 'Wacht',
  'grant.state.locked': 'Geblokkeerd voor deze link',
  'grant.person.allConnected': 'Alle accounts zijn verbonden. U kunt deze pagina sluiten.',
  'grant.password.title': 'Verbind {account} met uw wachtwoord',
  'grant.password.server':
    'Uw wachtwoord wordt gecontroleerd bij {server}. Typ het alleen als dit de server van uw eigen aanbieder is.',
  'grant.password.published': 'Uw wachtwoord wordt gecontroleerd bij de eigen server van {provider}, {server}.',
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
  'grant.password.faceMissing': 'Uw wachtwoord werkt, maar {server} weigerde {faces}.',
  'grant.password.locked': 'Te vaak geprobeerd met deze link. Vraag {askedBy} om een nieuwe link.',
  'grant.apple.how': 'Hoe maak ik een app-specifiek wachtwoord?',
  'grant.apple.how.more':
    'Meld u aan op account.apple.com. Kies Aanmelden en beveiliging, dan App-specifieke wachtwoorden. Maak er een, noem het Ownpace en typ het hier. Apple toont het maar één keer.',
  'grant.nextcloud.how': 'Hoe maak ik een app-wachtwoord?',
  'grant.nextcloud.how.more':
    'Open uw Nextcloud in de browser. Ga naar Instellingen, Beveiliging, Apparaten & sessies. Typ een naam zoals Ownpace, druk op Creëer een nieuw app wachtwoord en typ hier het wachtwoord dat Nextcloud toont.',
  'linkReport.open': 'Deze link melden',
  'linkReport.intro': 'Uw melding gaat naar het Ownpace-supportteam, niet naar {organisation}.',
  'linkReport.description': 'Waarom twijfelt u aan deze link?',
  'linkReport.replyTo': 'Uw e-mailadres (niet verplicht)',
  'linkReport.replyTo.hint': 'Alleen zodat wij op uw melding kunnen antwoorden.',
  'linkReport.sentWith':
    'Meegestuurd, uit onze gegevens: welke link dit is; de organisatie en de migratie waar hij bij hoort, met de stand van de migratie; het adres van wie de link heeft gemaakt; het account waaruit de migratie kopieert en het account waarnaar; en of u toegang hebt gegeven.',
  'linkReport.send': 'Melding versturen',
  'linkReport.sending': 'Versturen…',
  'linkReport.sent': 'Verstuurd. Uw melding heeft nummer {ticket}, en we antwoorden naar {email}.',
  'linkReport.sent.anonymous': 'Verstuurd. Uw melding heeft nummer {ticket}. Zonder mailadres kunnen we u niet antwoorden.',
  'linkReport.sent.mail': 'Verstuurd naar ons supportteam, met meldingskenmerk {reference}. We antwoorden per e-mail naar {email}.',
  'linkReport.sent.mail.anonymous':
    'Verstuurd naar ons supportteam, met meldingskenmerk {reference}. Zonder mailadres kunnen we u niet antwoorden.',
  'linkReport.next.grant': 'Er wordt niets gelezen zonder uw toestemming bij Google.',
  'linkReport.next.withdraw': 'Wilt u de migratie stoppen? Trek dan hierboven de toegang in.',
};

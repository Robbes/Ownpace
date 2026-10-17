// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Signing in, asking for access, accepting the conditions, and an invitation.
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one
 * file, the Dutch in the English order. `nl` is typed against `en`, so a
 * key missing from either is a typecheck failure here.
 */

export const en = {
  'login.title': 'Sign in to Ownpace',
  'login.tagline': 'Sovereign data migrations for families and SMBs',
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
  'login.verifying': 'Checking token…',
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
  'login.checking': 'Checking how to sign in…',
  // Not a fallback to the paste box: on a managed stack that box is refused
  // anyway, so offering it after a failed check would be inventing a way in
  // that does not exist.
  //
  // Followed by `serverMessage`'s sentence, which says why in the reader's
  // language when nothing answered (`answer.unreachable`).
  'login.modeUnavailable': 'Signing in is not possible right now.',
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
  'login.noOrganisation': 'Your account is not part of an organisation (family, team, etc.) yet.',
  'login.noOrganisation.signedInAs': 'You signed in as {email}.',
  'login.noOrganisation.ask': 'Ask for access',
  'login.noOrganisation.already':
    'Already asked? Then wait until we, or an owner of your organisation, give you access.',
  'login.noOrganisation.already.why':
    'Asking again doesn\'t help: a second request while the first is open is not recorded twice.',
  // ---- Answering an invitation (workplan 0099). ----
  'invite.title': 'You have been invited',
  'invite.subtitle': 'Join if you want to migrate.',
  'invite.none': 'Nothing is waiting for you.',
  'invite.asRole': 'as {role}',
  'invite.accept': 'Join',
  'invite.joining': 'Joining…',
  'invite.decline': 'Decline',
  'invite.skip': 'Not now',
  'invite.skipHelp': 'Not now changes nothing; we ask again next time you sign in.',
  'invite.skipHelp.why':
    "Declining is recorded, and only the organisation's owners and admins can invite you again.",
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
  'acceptance.accept': 'Accept all three to proceed',
  'acceptance.accepting': 'Recording…',
  'acceptance.notNow': 'Not now, sign out',
  'acceptance.notCurrent':
    'These texts changed while this page was open. Read the current versions, then accept those.',
  'acceptance.checking': 'Checking your account…',
  'acceptance.readFailed': 'Your account could not be read.',
  'acceptance.retry': 'Try again',
  // The failures this screen can meet, in the reader's language; the
  // reference a fault carries is kept ('failure.reference').
  'acceptance.fault.read':
    'We ran into some error on our side; try again later or contact support.',
  'acceptance.fault.record': 'Your acceptance was not recorded, please try again.',
  'acceptance.unreachable': 'The service could not be reached. Check your connection and try again.',
  'acceptance.forbidden':
    'This account has no access to this organisation. Sign out, and sign in with the account you were invited with.',
  // A door that stores access, refused because the texts were not accepted
  // yet (409 conditions_not_accepted). Read after accepting as well as before.
  'acceptance.refused':
    'Nothing was stored: the conditions, privacy policy and terms had not been accepted yet. Try again after you accepted them.',
  // ---- Asking for access (workplan 0093) ----
  'access.title': 'Request access',
  'access.intro': 'Invite-only for now.',
  'access.email': 'Email address',
  'access.emailHint': 'Where we reply. Nothing else is sent here.',
  'access.name': 'Your name',
  'access.organisation': 'Organisation',
  'access.optional': 'optional',
  'access.note': 'What are you moving?',
  'access.noteHint': 'Roughly how many mailboxes, file accounts, GB/TB, and from where; one sentence is plenty.',
  // The site's estimate and Leaving… pages hand their answers along (workplan
  // 0152 T7 (a)): the note arrives as one sentence built from them, which the
  // person reads and edits like anything else they type here.
  'access.answers.from': 'Moving away from {name}',
  'access.answers.noFrom': 'Moving',
  'access.answers.provider.google': 'Google',
  'access.answers.provider.microsoft': 'Microsoft 365',
  'access.answers.provider.apple': 'Apple iCloud',
  'access.answers.provider.dropbox': 'Dropbox',
  'access.answers.provider.box': 'Box',
  'access.answers.provider.other': 'another provider',
  'access.answers.photos': 'Photos',
  'access.answers.who.individual': 'for one person',
  'access.answers.who.family': 'for a household',
  'access.answers.who.sme': 'for a business',
  'access.tier': 'Which package looks right?',
  'access.tierHint':
    'A guess is fine. The package follows what actually runs, so this is not binding.',
  'access.tierUnsure': 'Not sure yet',
  'access.submit': 'Send request',
  'access.submitNeeds': 'Fill in your email address first.',
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
    'We keep what you fill in to decide on your request and to answer you; asking creates no account. ' +
    'We keep it while your request is open. If we decline it, we delete it 30 days after our decision. ' +
    'If we grant it, it stays with your account and is erased with it.',
  'access.backToSignIn': 'Already have an account? Sign in',
  // The label of the form's hidden trap field (workplan 0093 T2d). A person
  // never meets it; this is for the rare reader that does.
  'access.trap': 'Leave this field empty',
} as const;

export const nl: Record<keyof typeof en, string> = {
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
  'login.checking': 'Bezig met controleren hoe u zich aanmeldt…',
  'login.modeUnavailable': 'Aanmelden is nu niet mogelijk.',
  'login.providerNotBuilt':
    'Aanmelden via identiteitsprovider, maar deze webbuild mist het adres: bouw opnieuw met VITE_OIDC_ISSUER en VITE_OIDC_CLIENT_ID.',
  'login.callback.working': 'U wordt aangemeld…',
  'login.callback.failed': 'Die aanmelding is niet voltooid.',
  'login.callback.again': 'Opnieuw proberen',
  // ---- Het doodlopende eind van een GESLAAGDE aanmelding — zie het Engelse blok. ----
  'login.noOrganisation': 'Uw account hoort nog niet bij een organisatie (gezin/team/etc.).',
  'login.noOrganisation.signedInAs': 'U bent aangemeld als {email}.',
  'login.noOrganisation.ask': 'Toegang aanvragen',
  'login.noOrganisation.already':
    'Al aangevraagd? Dan wacht u tot wij, of een eigenaar van uw organisatie, u toegang geven.',
  'login.noOrganisation.already.why':
    'Nogmaals aanvragen kan geen kwaad: een tweede aanvraag terwijl de eerste openstaat wordt echter niet dubbel vastgelegd.',
  // ---- Een uitnodiging beantwoorden (workplan 0099) — zie het Engelse blok. ----
  'invite.title': 'U bent uitgenodigd',
  'invite.subtitle': 'Wilt u migreren?',
  'invite.none': 'Er wacht niets op u.',
  'invite.asRole': 'als {role}',
  'invite.accept': 'Meedoen',
  'invite.joining': 'Bezig toe te treden…',
  'invite.decline': 'Afwijzen',
  'invite.skip': 'Nu niet',
  'invite.skipHelp': 'Nu geen keuze is geen afstel, wij vragen het opnieuw bij uw volgende aanmelding.',
  'invite.skipHelp.why':
    'Afwijzen wordt vastgelegd, en alleen eigenaren en beheerders van de organisatie kunnen u opnieuw uitnodigen.',
  'invite.confirmDecline':
    'De uitnodiging van {name} afwijzen? Alleen zij kunnen u opnieuw uitnodigen.',
  // "Aanvaarden", the texts' own word (terms §1, Alpha §2 and §11, privacy
  // §4.4), and "uitloggen", the nav's (review of 2026-09-29).
  'acceptance.title': 'Voordat u begint',
  'acceptance.changedTitle': 'De teksten zijn gewijzigd',
  'acceptance.lead': 'Lees deze teksten. Ze zeggen wat we met uw accounts en uw gegevens doen.',
  'acceptance.list': 'De teksten om te aanvaarden',
  'acceptance.doc.alpha': 'Voorwaarden voor de Alpha',
  'acceptance.doc.privacy': 'Privacyverklaring',
  'acceptance.doc.terms': 'Servicevoorwaarden',
  'acceptance.version': 'versie {version}',
  'acceptance.newVersion': 'nieuwe versie',
  'acceptance.newTab': '(opent in een nieuw tabblad)',
  'acceptance.changed': 'Een of meer teksten zijn gewijzigd sinds u ze voor het laatst aanvaardde.',
  'acceptance.record': 'We leggen vast welke versie van elke tekst u hebt aanvaard, in welke taal, en wanneer.',
  'acceptance.accept': 'Allemaal aanvaarden',
  'acceptance.accepting': 'Bezig met vastleggen…',
  'acceptance.notNow': 'Nu niet, uitloggen',
  'acceptance.notCurrent':
    'Deze teksten zijn gewijzigd terwijl deze pagina openstond. Lees de huidige versies en aanvaard die.',
  'acceptance.checking': 'Uw account wordt gecontroleerd…',
  'acceptance.readFailed': 'Uw account kon niet worden gelezen.',
  'acceptance.retry': 'Opnieuw proberen',
  'acceptance.fault.read': 'Er ging iets fout bij ons... probeer later nog eens of neem contact op met support.',
  'acceptance.fault.record': 'Uw aanvaarding is niet vastgelegd: iets ging fout bij ons, probeer het opnieuw.',
  'acceptance.unreachable': 'De dienst was niet bereikbaar. Controleer uw verbinding en probeer het opnieuw.',
  'acceptance.forbidden':
    'Dit account heeft geen toegang tot deze organisatie. Log uit en log in met het account waarmee u bent uitgenodigd.',
  'acceptance.refused':
    'Er is niets opgeslagen: de voorwaarden waren nog niet aanvaard. Probeer het opnieuw zodra u ze hebt aanvaard.',
  // ---- Asking for access (workplan 0093) ----
  'access.title': 'Toegang aanvragen',
  'access.intro':
    'Voorlopig op uitnodiging.',
  'access.email': 'E-mailadres',
  'access.emailHint': 'Waar moet ons antwoord naartoe?',
  'access.name': 'Uw naam',
  'access.organisation': 'Organisatie',
  'access.optional': 'optioneel',
  'access.note': 'Wat wilt u migreren?',
  'access.noteHint': 'Ongeveer hoeveel mailboxes en bestanden, welke omvang, en waarvandaan; één zin is genoeg.',
  'access.answers.from': 'Weg bij {name}',
  'access.answers.noFrom': 'Migreren',
  'access.answers.provider.google': 'Google',
  'access.answers.provider.microsoft': 'Microsoft 365',
  'access.answers.provider.apple': 'Apple iCloud',
  'access.answers.provider.dropbox': 'Dropbox',
  'access.answers.provider.box': 'Box',
  'access.answers.provider.other': 'een andere aanbieder',
  'access.answers.photos': 'Foto’s',
  'access.answers.who.individual': 'voor één persoon',
  'access.answers.who.family': 'voor een huishouden',
  'access.answers.who.sme': 'voor een bedrijf',
  'access.tier': 'Welk pakket zou passen?',
  'access.tierHint':
    'Een inschatting volstaat; het pakket volgt wat werkelijk draait, dus dit is niet bindend.',
  'access.tierUnsure': 'Nog niet zeker',
  'access.submit': 'Aanvraag versturen',
  'access.submitNeeds': 'Vul eerst uw e-mailadres in.',
  'access.sending': 'Versturen…',
  'access.sent': 'Dank u — wij hebben uw aanvraag ontvangen.',
  'access.sentDetail': 'U hoort per e-mail van ons.',
  'access.failed': 'Versturen is niet gelukt:',
  'access.failedFallback': 'de aanvraag is niet voltooid.',
  'access.privacy':
    'Wij bewaren wat u opstuurt om uw aanvraag te beoordelen en u te antwoorden; een aanvraag maakt geen account aan. Wij bewaren dit zolang uw aanvraag openstaat. Wijzen wij die af, dan verwijderen wij uw gegevens 30 dagen na ons besluit. Kennen wij die toe, dan blijft het bij uw account en wordt het daarmee gewist.',
  'access.backToSignIn': 'Heeft u al een account? Aanmelden',
  'access.trap': 'Laat dit veld leeg',
};

// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A recommendation: what a member gives somebody they know during the Alpha
 * (workplans 0172 and 0177). In code it stays a gift (`gift`, `/api/gifts`);
 * on every screen it is a *recommendation* / *aanbeveling*, the owner's word
 * of 2026-11-26 (0177 D1, `GLOSSARY.md`).
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one file,
 * the Dutch in the English order. Three readers: the giver on *Recommend
 * someone*; whoever reads the card, in the card's language, which the giver
 * picks, whatever the app's; and the person at the door, `/code`. The
 * operator's screens are English only, in `operator-strings.ts`.
 *
 * The sentences are 0177 §7's, as drafts for the owner's read, but for the
 * five the owner read on 2026-11-26 (*"The G6 Dutch: all ok"*): `give.does`,
 * `give.handOver`, `card.alpha`, `code.in.title` and the first sentence of
 * `code.in.left`. Until T9 gives the door the giver's name, a row with
 * `{giver}` says *the person you got the code from* (§7). The refusals at the
 * door are the server's sentences, in both languages, and not here.
 */

export const en = {
  'nav.give': 'Recommend someone',
  // ---- The giver's page (0177 T5, T10, §9).
  'give.title': 'Recommend someone',
  'give.intro': 'Recommend someone dear to you for the Alpha, on a card.',
  'give.does': 'You tell us that you know this person. That is enough: they are let in at once.',
  'give.fact': 'They get an account of their own. You do not see what is in it.',
  'give.limit': 'People you may recommend: {limit}. Recommended: {held}.',
  'give.handOver': 'Give the card yourself. Whoever has the code is let in.',
  'give.tellFirst': 'Tell them first: by phone, or when you hand it over.',
  'give.willSee': 'You will see here when it is used. The person is then in.',
  'give.privacy':
    'We never receive the name or the message on the card. We keep that you recommended someone, a fingerprint of the code, the card’s language, its dates, and which request it became.',
  'give.language': 'Language of the card',
  'give.make': 'Make a recommendation',
  'give.making': 'Making your recommendation…',
  'give.atLimit': 'You have recommended someone already. Withdraw an unused card to make another.',
  'give.noneForNow': 'No new recommendation can be made for now.',
  'give.full': 'The Alpha is full for now. No new recommendation can be made.',
  // D18 (the owner, 2026-11-26): during the Alpha, only the people the owner let in recommend (§20.7).
  'give.onlyAfterAlpha':
    'During the Alpha, only the people Ownpace let in itself can recommend someone. After the Alpha, you can too.',
  'give.failed': 'The recommendation could not be made.',
  'give.once': 'The code is shown only now. Lost it? Withdraw it below and make a new one.',
  'give.giverName': 'Your name on the card',
  'give.recipient': 'The recipient’s first name',
  'give.message': 'A message',
  'give.notStored': 'Stays in this browser. It is not sent to us.',
  'give.print': 'Print or save as PDF',
  'give.link': 'Or send a link. Say in your own words what it is.',
  'give.theySee': 'What they will see',
  'give.theySee.code': 'They type the code at {address}.',
  'give.theySee.question': 'They answer one question: did you tell them about it yourself?',
  'give.theySee.address': 'They fill in their email address, and are let in at once.',
  'give.theySee.mail': 'They get an email, and make their account with the sign-in service.',
  'give.theySee.you': 'Your name is on the card, as the person to ask for help.',
  'give.mine': 'Your recommendations',
  'give.none': 'No recommendation yet.',
  'give.made': 'Made {date}, valid until {until}',
  'give.state.unused': 'Not used yet',
  'give.state.redeemed': 'Used on {date}: let in',
  'give.state.revoked': 'Withdrawn',
  'give.state.expired': 'Expired',
  'give.revoke': 'Withdraw',
  'give.revokeFailed': 'The recommendation could not be withdrawn.',
  // ---- The card, in the card's language (0177 T2, §6), in §6's order.
  'card.title': 'A recommendation from {giver}',
  'card.titleNoGiver': 'A recommendation',
  'card.titleFor': 'For {name}: a recommendation from {giver}',
  'card.titleForNoGiver': 'For {name}: a recommendation',
  'card.what':
    'Ownpace copies your mail, calendars, contacts and files to a European provider. You switch from Google or Microsoft at your own pace. Until then Ownpace keeps the copy up to date.',
  'card.alpha': 'Ownpace is in a free Alpha. With this card you are let in at once.',
  'card.where': 'Go to {address}. Type it in the bar at the top, not in a search box.',
  'card.step1': 'Type the code from this card.',
  'card.step2': 'Answer one question.',
  'card.step3': 'Fill in your email address.',
  'card.help': 'Need help? Ask {giver}.',
  'card.helpNoGiver': 'Need help? Ask the person who gave you this card.',
  'card.support': 'Or write to {support}: a person reads it.',
  'card.who': 'Who Ownpace is: {site}',
  'card.until': 'The code works once, until {date}.',
  // ---- Said on the card and at the door alike (R7, D5).
  'code.cost':
    'Ownpace charges nothing during the Alpha. Your new mailbox is at a European provider. You pay that provider for it, not Ownpace.',
  'code.after':
    'After the Alpha there are paid packages and a free one. You pay nothing before you have accepted the new conditions.',
  // ---- The door, `/code` (0177 T1, §5). Step 1: the code, alone.
  'code.step1.title': 'Type your code',
  'code.field': 'The code',
  'code.field.hint': 'As on the card. Capitals and dashes do not matter.',
  'code.noCode': 'No code? Ask for access without one.',
  'code.refused.title': 'This code does not work',
  'code.refused.line': 'You can correct the code below. Nothing about you has been sent.',
  // Step 2: what this is, and one question.
  'code.step2.title': 'Answer one question',
  'code.what': 'Ownpace copies your mail, calendars, contacts and files to a European provider.',
  'code.alpha': 'Ownpace is still a trial. It is called the Alpha.',
  'code.letIn': 'With this code you are let in at once.',
  'code.giverSees': 'The person you got the code from will see that the code was used.',
  'code.question': 'Did the person you got the code from tell you about this themselves: by phone, or when you saw each other?',
  'code.yes': 'Yes',
  'code.notYet': 'No, not yet',
  'code.noThanks': 'No, I do not want this',
  'code.notYet.title': 'Then ask them first',
  'code.notYet.later': 'You can use the code later, until {date}.',
  'code.nothingSent': 'Nothing has been sent.',
  'code.noThanks.title': 'That is fine',
  'code.noThanks.tell': 'Tell the person you got the code from: they can then recommend someone else.',
  // Step 3: the address.
  'code.step3.title': 'Fill in your email address',
  'code.email': 'Your email address',
  'code.email.hint': 'You sign in with it. It may be the email address you use today.',
  'code.name': 'Your name (you may leave this empty)',
  'code.google': 'Is this the email address of a Google account that you want to move?',
  'code.no': 'No',
  'code.google.hint': 'Gmail is a Google account.',
  'code.shownBack': 'We send an email to {email}. The code works once: after this step it is used.',
  'code.use': 'Use my code',
  'code.kept': 'What you fill in here stays with your account, and is erased with it.',
  // A full Alpha (§20.3).
  'code.full.title': 'The Alpha is full for now',
  'code.full.line': 'Keep your code. You can try again later, until {date}. Nothing about you has been kept.',
  // Let in.
  'code.in.title': 'You are in',
  'code.in.left':
    'One thing is left: make your account. The sign-in service mails a code to {email}. With it you confirm that the address is yours.',
  'code.in.create': 'Create your account',
  'code.in.mailed': 'We also sent you an email, from {from}. It says the same.',
  'code.in.google':
    'You want to move away from Google. We add {email} to a list at Google by hand, and write to you when that is done. Until then Google does not allow the connection.',
  'code.in.safety': 'Ownpace never asks for your password by email or phone.',
  'code.in.mistyped': 'Is {email} not right? Write to {support}.',
  // The site's page, from the door and the giver's page (§11).
  'code.readMore': 'Read more about a recommendation',
  // ---- The plain request form's way to the door (§5: one place checks a code).
  'access.gift.toggle': 'I have a code',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'nav.give': 'Iemand aanbevelen',
  'give.title': 'Iemand aanbevelen',
  'give.intro': 'Beveel iemand die u dierbaar is aan voor de Alpha, op een kaart.',
  'give.does': 'U zegt ons dat u deze persoon kent. Dat is genoeg: die persoon wordt meteen toegelaten.',
  'give.fact': 'Die persoon krijgt een eigen account. U ziet niet wat erin staat.',
  'give.limit': 'Mensen die u mag aanbevelen: {limit}. Aanbevolen: {held}.',
  'give.handOver': 'Geef de kaart zelf. Wie de code heeft, wordt toegelaten.',
  'give.tellFirst': 'Vertel het eerst zelf: aan de telefoon, of als u het geeft.',
  'give.willSee': 'U ziet hier wanneer hij is gebruikt. Die persoon is dan toegelaten.',
  'give.privacy':
    'Wij ontvangen de naam en de boodschap op de kaart nooit. Wij bewaren dat u iemand aanbeval, een vingerafdruk van de code, de taal van de kaart, de datums, en welke aanvraag het werd.',
  'give.language': 'Taal van de kaart',
  'give.make': 'Maak een aanbeveling',
  'give.making': 'Uw aanbeveling wordt gemaakt…',
  'give.atLimit': 'U hebt al iemand aanbevolen. Trek een ongebruikte kaart in om een nieuwe te maken.',
  'give.noneForNow': 'U kunt nu even geen aanbeveling maken.',
  'give.full': 'De Alpha is nu vol. U kunt nu geen aanbeveling maken.',
  'give.onlyAfterAlpha':
    'Tijdens de Alpha kunnen alleen de mensen die Ownpace zelf toeliet iemand aanbevelen. Na de Alpha kunt u dat ook.',
  'give.failed': 'De aanbeveling kon niet worden gemaakt.',
  'give.once': 'U ziet de code alleen nu. Kwijt? Trek hem hieronder in en maak een nieuwe.',
  'give.giverName': 'Uw naam op de kaart',
  'give.recipient': 'Voornaam van de ontvanger',
  'give.message': 'Een boodschap',
  'give.notStored': 'Blijft in deze browser. Het wordt niet naar ons gestuurd.',
  'give.print': 'Printen of bewaren als pdf',
  'give.link': 'Of stuur een link. Zeg in uw eigen woorden wat het is.',
  'give.theySee': 'Wat die persoon ziet',
  'give.theySee.code': 'Die persoon typt de code op {address}.',
  'give.theySee.question': 'Die persoon beantwoordt één vraag: hebt u er zelf over verteld?',
  'give.theySee.address': 'Die persoon vult een e-mailadres in, en wordt meteen toegelaten.',
  'give.theySee.mail': 'Daarna komt er een e-mail, en maakt die persoon een account aan bij de aanmeldservice.',
  'give.theySee.you': 'Uw naam staat op de kaart: bij u kan die persoon om hulp vragen.',
  'give.mine': 'Uw aanbevelingen',
  'give.none': 'Nog geen aanbeveling.',
  'give.made': 'Gemaakt op {date}, geldig tot {until}',
  'give.state.unused': 'Nog niet gebruikt',
  'give.state.redeemed': 'Gebruikt op {date}: toegelaten',
  'give.state.revoked': 'Ingetrokken',
  'give.state.expired': 'Verlopen',
  'give.revoke': 'Intrekken',
  'give.revokeFailed': 'De aanbeveling kon niet worden ingetrokken.',
  'card.title': 'Een aanbeveling van {giver}',
  'card.titleNoGiver': 'Een aanbeveling',
  'card.titleFor': 'Voor {name}: een aanbeveling van {giver}',
  'card.titleForNoGiver': 'Voor {name}: een aanbeveling',
  'card.what':
    'Ownpace kopieert uw e-mail, agenda’s, contacten en bestanden naar een Europese aanbieder. U stapt over van Google of Microsoft in uw eigen tempo. Tot dan houdt Ownpace de kopie bij.',
  'card.alpha': 'Ownpace zit in een gratis Alpha. Met deze kaart wordt u meteen toegelaten.',
  'card.where': 'Ga naar {address}. Typ dit bovenaan in de adresbalk, niet in een zoekvak.',
  'card.step1': 'Typ de code van deze kaart.',
  'card.step2': 'Beantwoord één vraag.',
  'card.step3': 'Vul uw e-mailadres in.',
  'card.help': 'Hulp nodig? Vraag het {giver}.',
  'card.helpNoGiver': 'Hulp nodig? Vraag het aan degene die u de kaart gaf.',
  'card.support': 'Of schrijf naar {support}: daar leest een mens uw bericht.',
  'card.who': 'Wie Ownpace is, leest u op {site}',
  'card.until': 'De code werkt één keer, tot {date}.',
  'code.cost':
    'Tijdens de Alpha kost Ownpace niets. Uw nieuwe mailbox staat bij een Europese aanbieder. Daarvoor betaalt u die aanbieder, niet Ownpace.',
  'code.after':
    'Na de Alpha zijn er betaalde pakketten en een gratis pakket. U betaalt niets voordat u de nieuwe voorwaarden hebt geaccepteerd.',
  'code.step1.title': 'Typ uw code',
  'code.field': 'De code',
  'code.field.hint': 'Zoals op de kaart. Hoofdletters en streepjes maken niet uit.',
  'code.noCode': 'Geen code? Vraag toegang aan zonder code.',
  'code.refused.title': 'Deze code werkt niet',
  'code.refused.line': 'U kunt de code hieronder verbeteren. Er is niets over u verstuurd.',
  'code.step2.title': 'Beantwoord één vraag',
  'code.what': 'Ownpace kopieert uw e-mail, agenda’s, contacten en bestanden naar een Europese aanbieder.',
  'code.alpha': 'Ownpace is nog een proef. Die heet de Alpha.',
  'code.letIn': 'Met deze code wordt u meteen toegelaten.',
  'code.giverSees': 'Degene van wie u de code kreeg, ziet dat de code is gebruikt.',
  'code.question': 'Heeft degene van wie u de code kreeg u hier zelf over verteld: aan de telefoon, of toen u elkaar zag?',
  'code.yes': 'Ja',
  'code.notYet': 'Nee, nog niet',
  'code.noThanks': 'Nee, ik wil dit niet',
  'code.notYet.title': 'Vraag het dan eerst na',
  'code.notYet.later': 'U kunt de code later gebruiken, tot {date}.',
  'code.nothingSent': 'Er is niets verstuurd.',
  'code.noThanks.title': 'Dat mag',
  'code.noThanks.tell': 'Vertel het aan degene van wie u de code kreeg: die kan dan iemand anders aanbevelen.',
  'code.step3.title': 'Vul uw e-mailadres in',
  'code.email': 'Uw e-mailadres',
  'code.email.hint': 'Daarmee meldt u zich aan. Het mag het e-mailadres zijn dat u nu gebruikt.',
  'code.name': 'Uw naam (mag, hoeft niet)',
  'code.google': 'Is dit het e-mailadres van een Google-account waar u weg wilt?',
  'code.no': 'Nee',
  'code.google.hint': 'Gmail is een Google-account.',
  'code.shownBack': 'Wij sturen een e-mail naar {email}. De code werkt één keer: na deze stap is hij gebruikt.',
  'code.use': 'Gebruik mijn code',
  'code.kept': 'Wat u hier invult, blijft bij uw account en wordt daarmee gewist.',
  'code.full.title': 'De Alpha is nu vol',
  'code.full.line': 'Bewaar uw code. U kunt het later opnieuw proberen, tot {date}. Er is niets over u bewaard.',
  'code.in.title': 'U bent toegelaten',
  'code.in.left':
    'Er is nog één ding te doen: maak uw account aan. De aanmeldservice mailt een code naar {email}. Daarmee bevestigt u dat het e-mailadres van u is.',
  'code.in.create': 'Maak uw account aan',
  'code.in.mailed': 'Wij hebben u ook een e-mail gestuurd, vanaf {from}. Daarin staat hetzelfde.',
  'code.in.google':
    'U wilt weg bij Google. Wij zetten {email} met de hand op een lijst bij Google, en schrijven u als dat is gebeurd. Tot dan laat Google de koppeling niet toe.',
  'code.in.safety': 'Ownpace vraagt nooit per e-mail of telefoon om uw wachtwoord.',
  'code.in.mistyped': 'Klopt {email} niet? Schrijf naar {support}.',
  'code.readMore': 'Lees meer over een aanbeveling',
  'access.gift.toggle': 'Ik heb een code',
};

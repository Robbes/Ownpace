// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Gifts: a place in the Alpha given as a present (workplan 0172).
 *
 * One area of the dictionary (`../strings.ts`), English and Dutch in one file,
 * the Dutch in the English order. Three readers: the giver on *Give Ownpace*,
 * whoever reads the card (in the card's language, which the giver picks,
 * whatever the app's), and the recipient at the request-access door. The
 * operator's screen is English only, in `operator-strings.ts`.
 */

export const en = {
  'nav.give': 'Give Ownpace',
  // ---- The giver's page.
  'give.title': 'Give Ownpace',
  'give.intro': 'Give someone dear to you a place in the Alpha, on a card.',
  'give.how':
    'They type the code when they ask for access. We still read every request and say yes ourselves, so a gift is a personal recommendation rather than a key. It is valid for two years.',
  'give.privacy':
    'We never ask who it is for. The name and message you put on the card stay in this browser. We keep only that you gave a gift, a fingerprint of its code, and its dates.',
  'give.limit': 'Gifts you may give: {limit}. Given: {held}.',
  'give.language': 'Language of the card',
  'give.make': 'Make my gift',
  'give.making': 'Making your gift…',
  'give.atLimit': 'You have given your gift already. Revoke an unused one to make another.',
  'give.failed': 'The gift could not be made.',
  'give.once': 'This code is shown only now. Print the card, or save it as a PDF, before you leave this page.',
  'give.giverName': 'Your name on the card',
  'give.recipient': 'The recipient’s first name',
  'give.message': 'A message',
  'give.notStored': 'Stays in this browser. It is not sent to us.',
  'give.print': 'Print or save as PDF',
  'give.mine': 'Your gifts',
  'give.none': 'No gift yet.',
  'give.made': 'Made {date}, valid until {until}',
  'give.state.unused': 'Unused',
  'give.state.redeemed': 'Used',
  'give.state.revoked': 'Revoked',
  'give.state.expired': 'Expired',
  'give.revoke': 'Revoke',
  'give.revokeFailed': 'The gift could not be revoked.',
  // ---- The card, in the card's language.
  'card.heading': 'A place in Ownpace, for you',
  'card.headingFor': 'For {name}: a place in Ownpace',
  'card.from': 'From {giver}',
  'card.what':
    'Ownpace copies your mail, calendars, contacts and files from Google or Microsoft to a European provider, at your own pace, and keeps them up to date until you switch.',
  'card.alpha':
    'Ownpace is in a free Alpha, and we let people in ourselves. With this card you ask us to let you in.',
  'card.code': 'Your code',
  'card.where': 'Use it at',
  'card.until': 'Valid until {date}',
  // ---- The request-access door.
  'access.gift.toggle': 'I have a gift code',
  'access.gift.code': 'Gift code',
  'access.gift.hint': 'As on the card; capitals and dashes do not matter.',
  'access.gift.sent': 'Thank you — we have your request, with your gift.',
} as const;

export const nl: Record<keyof typeof en, string> = {
  'nav.give': 'Geef Ownpace cadeau',
  'give.title': 'Geef Ownpace cadeau',
  'give.intro': 'Geef iemand die u dierbaar is een plaats in de Alpha, op een kaart.',
  'give.how':
    'Die persoon typt de code bij het aanvragen van toegang. We lezen elke aanvraag nog steeds zelf en zeggen zelf ja, dus een cadeau is een persoonlijke aanbeveling, geen sleutel. Het is twee jaar geldig.',
  'give.privacy':
    'We vragen nooit voor wie het is. De naam en de boodschap op de kaart blijven in deze browser. Wij bewaren alleen dat u een cadeau gaf, een vingerafdruk van de code en de datums.',
  'give.limit': 'Cadeaus die u mag geven: {limit}. Gegeven: {held}.',
  'give.language': 'Taal van de kaart',
  'give.make': 'Maak mijn cadeau',
  'give.making': 'Uw cadeau wordt gemaakt…',
  'give.atLimit': 'U hebt uw cadeau al gegeven. Trek een ongebruikt cadeau in om een nieuw te maken.',
  'give.failed': 'Het cadeau kon niet worden gemaakt.',
  'give.once': 'Deze code ziet u alleen nu. Print de kaart, of bewaar hem als pdf, voordat u deze pagina verlaat.',
  'give.giverName': 'Uw naam op de kaart',
  'give.recipient': 'Voornaam van de ontvanger',
  'give.message': 'Een boodschap',
  'give.notStored': 'Blijft in deze browser. Het wordt niet naar ons gestuurd.',
  'give.print': 'Printen of bewaren als pdf',
  'give.mine': 'Uw cadeaus',
  'give.none': 'Nog geen cadeau.',
  'give.made': 'Gemaakt op {date}, geldig tot {until}',
  'give.state.unused': 'Ongebruikt',
  'give.state.redeemed': 'Gebruikt',
  'give.state.revoked': 'Ingetrokken',
  'give.state.expired': 'Verlopen',
  'give.revoke': 'Intrekken',
  'give.revokeFailed': 'Het cadeau kon niet worden ingetrokken.',
  'card.heading': 'Een plaats in Ownpace, voor u',
  'card.headingFor': 'Voor {name}: een plaats in Ownpace',
  'card.from': 'Van {giver}',
  'card.what':
    'Ownpace kopieert uw e-mail, agenda’s, contacten en bestanden van Google of Microsoft naar een Europese aanbieder, in uw eigen tempo, en houdt ze bij tot u overstapt.',
  'card.alpha':
    'Ownpace zit in een gratis Alpha, en we laten mensen zelf toe. Met deze kaart vraagt u ons om u toe te laten.',
  'card.code': 'Uw code',
  'card.where': 'Gebruik hem op',
  'card.until': 'Geldig tot {date}',
  'access.gift.toggle': 'Ik heb een cadeaucode',
  'access.gift.code': 'Cadeaucode',
  'access.gift.hint': 'Zoals op de kaart; hoofdletters en streepjes maken niet uit.',
  'access.gift.sent': 'Dank u — wij hebben uw aanvraag ontvangen, met uw cadeau.',
};

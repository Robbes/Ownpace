// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ONE NAME FOR A FREE GIFT (workplan 0177 T3, §7; §21.2's point 19).
 *
 * One thing had eight names in the Dutch of the card, the door, the mails and
 * the site: *een plaats*, *kaart*, *uw code*, *cadeaucode*, *cadeau*,
 * *cadeaukaart*, *plek* and *persoonlijke aanbeveling* (§3.4). The owner
 * named it on 2026-11-26 (D1): *"aanbeveling (recommendation). Don't mention
 * 'geen sleutel', thats obvius)"*. The glossary has the row
 * (`GLOSSARY.md`): *gift* / *cadeau* is kept for a code somebody paid for,
 * *place* / *plaats* / *plek* promise room, *invitation* / *uitnodiging* are
 * taken, and no sentence says what a recommendation is not. The paper stays
 * *the card* / *de kaart*, and what is typed *the code* / *de code*.
 *
 * So:
 *
 * - every sentence of §7 that the web says is in the dictionary, in both
 *   languages, under one key (`strings/gifts.ts`). A row with `{giver}` is
 *   said as *the person you got the code from* until T9 gives the door a
 *   name (§7). Where a row holds a heading and a sentence, they are two keys;
 *   the server's sentences are the server's, and are not here;
 * - no word of the card, the door, the giver's page, the two mails or the
 *   site's page calls the free thing by a retired name, and none says *key*
 *   or *sleutel*;
 * - the giver's page, the card and the site's page say *recommendation* /
 *   *aanbeveling*.
 *
 * The operator's screens are English only and keep the name *Gifts* for the
 * screen that will also hold a paid code (§20.6), so they are not read here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderEvent, type NotificationLocale } from '@openmig/shared';
import { en, nl } from './strings/gifts.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** §7's sentences, English and Dutch, as the web says them. */
const SECTION_7: ReadonlyArray<readonly [string, string]> = [
  // The giver's page.
  ['Recommend someone', 'Iemand aanbevelen'],
  ['Recommend someone dear to you for the Alpha, on a card.', 'Beveel iemand die u dierbaar is aan voor de Alpha, op een kaart.'],
  [
    'You tell us that you know this person. That is enough: they are let in at once.',
    'U zegt ons dat u deze persoon kent. Dat is genoeg: die persoon wordt meteen toegelaten.',
  ],
  ['They get an account of their own. You do not see what is in it.', 'Die persoon krijgt een eigen account. U ziet niet wat erin staat.'],
  ['People you may recommend: {limit}. Recommended: {held}.', 'Mensen die u mag aanbevelen: {limit}. Aanbevolen: {held}.'],
  ['Give the card yourself. Whoever has the code is let in.', 'Geef de kaart zelf. Wie de code heeft, wordt toegelaten.'],
  ['Tell them first: by phone, or when you hand it over.', 'Vertel het eerst zelf: aan de telefoon, of als u het geeft.'],
  [
    'The code is shown only now. Lost it? Withdraw it below and make a new one.',
    'U ziet de code alleen nu. Kwijt? Trek hem hieronder in en maak een nieuwe.',
  ],
  ['You will see here when it is used. The person is then in.', 'U ziet hier wanneer hij is gebruikt. Die persoon is dan toegelaten.'],
  [
    'We never receive the name or the message on the card. We keep that you recommended someone, a fingerprint of the code, the card’s language, its dates, and which request it became.',
    'Wij ontvangen de naam en de boodschap op de kaart nooit. Wij bewaren dat u iemand aanbeval, een vingerafdruk van de code, de taal van de kaart, de datums, en welke aanvraag het werd.',
  ],
  ['Or send a link. Say in your own words what it is.', 'Of stuur een link. Zeg in uw eigen woorden wat het is.'],
  ['No new recommendation can be made for now.', 'U kunt nu even geen aanbeveling maken.'],
  ['The Alpha is full for now. No new recommendation can be made.', 'De Alpha is nu vol. U kunt nu geen aanbeveling maken.'],
  [
    'During the Alpha, only the people Ownpace let in itself can recommend someone. After the Alpha, you can too.',
    'Tijdens de Alpha kunnen alleen de mensen die Ownpace zelf toeliet iemand aanbevelen. Na de Alpha kunt u dat ook.',
  ],
  // The card.
  ['A recommendation from {giver}', 'Een aanbeveling van {giver}'],
  [
    'Ownpace copies your mail, calendars, contacts and files to a European provider. You switch from Google or Microsoft at your own pace. Until then Ownpace keeps the copy up to date.',
    'Ownpace kopieert uw e-mail, agenda’s, contacten en bestanden naar een Europese aanbieder. U stapt over van Google of Microsoft in uw eigen tempo. Tot dan houdt Ownpace de kopie bij.',
  ],
  ['Ownpace is in a free Alpha. With this card you are let in at once.', 'Ownpace zit in een gratis Alpha. Met deze kaart wordt u meteen toegelaten.'],
  [
    'Ownpace charges nothing during the Alpha. Your new mailbox is at a European provider. You pay that provider for it, not Ownpace.',
    'Tijdens de Alpha kost Ownpace niets. Uw nieuwe mailbox staat bij een Europese aanbieder. Daarvoor betaalt u die aanbieder, niet Ownpace.',
  ],
  [
    'After the Alpha there are paid packages and a free one. You pay nothing before you have accepted the new conditions.',
    'Na de Alpha zijn er betaalde pakketten en een gratis pakket. U betaalt niets voordat u de nieuwe voorwaarden hebt geaccepteerd.',
  ],
  ['Go to {address}. Type it in the bar at the top, not in a search box.', 'Ga naar {address}. Typ dit bovenaan in de adresbalk, niet in een zoekvak.'],
  ['Type the code from this card.', 'Typ de code van deze kaart.'],
  ['Answer one question.', 'Beantwoord één vraag.'],
  ['Fill in your email address.', 'Vul uw e-mailadres in.'],
  ['Need help? Ask {giver}.', 'Hulp nodig? Vraag het {giver}.'],
  ['Or write to {support}: a person reads it.', 'Of schrijf naar {support}: daar leest een mens uw bericht.'],
  ['Who Ownpace is: {site}', 'Wie Ownpace is, leest u op {site}'],
  ['The code works once, until {date}.', 'De code werkt één keer, tot {date}.'],
  // The door.
  ['Type your code', 'Typ uw code'],
  ['The code', 'De code'],
  // §7 drafted two sentences for each field's hint; a hint is one (0118), and the one that helps most stays.
  ['Capitals and dashes do not matter.', 'Hoofdletters en streepjes maken niet uit.'],
  ['No code? Ask for access without one.', 'Geen code? Vraag toegang aan zonder code.'],
  ['This code does not work', 'Deze code werkt niet'],
  ['You can correct the code below. Nothing about you has been sent.', 'U kunt de code hieronder verbeteren. Er is niets over u verstuurd.'],
  ['Ownpace is still a trial. It is called the Alpha.', 'Ownpace is nog een proef. Die heet de Alpha.'],
  ['With this code you are let in at once.', 'Met deze code wordt u meteen toegelaten.'],
  ['The person you got the code from will see that the code was used.', 'Degene van wie u de code kreeg, ziet dat de code is gebruikt.'],
  [
    'Did the person you got the code from tell you about this themselves: by phone, or when you saw each other?',
    'Heeft degene van wie u de code kreeg u hier zelf over verteld: aan de telefoon, of toen u elkaar zag?',
  ],
  ['Yes', 'Ja'],
  ['No, not yet', 'Nee, nog niet'],
  ['No, I do not want this', 'Nee, ik wil dit niet'],
  ['Then ask them first', 'Vraag het dan eerst na'],
  ['You can use the code later, until {date}.', 'U kunt de code later gebruiken, tot {date}.'],
  ['Nothing has been sent.', 'Er is niets verstuurd.'],
  ['That is fine', 'Dat mag'],
  [
    'Tell the person you got the code from: they can then recommend someone else.',
    'Vertel het aan degene van wie u de code kreeg: die kan dan iemand anders aanbevelen.',
  ],
  ['Your email address', 'Uw e-mailadres'],
  ['It may be the email address you use today.', 'Het mag het e-mailadres zijn dat u nu gebruikt.'],
  ['Your name (you may leave this empty)', 'Uw naam (mag, hoeft niet)'],
  ['Is this the email address of a Google account that you want to move?', 'Is dit het e-mailadres van een Google-account waar u weg wilt?'],
  ['No', 'Nee'],
  ['Gmail is a Google account.', 'Gmail is een Google-account.'],
  [
    'We send an email to {email}. The code works once: after this step it is used.',
    'Wij sturen een e-mail naar {email}. De code werkt één keer: na deze stap is hij gebruikt.',
  ],
  ['Use my code', 'Gebruik mijn code'],
  ['The Alpha is full for now', 'De Alpha is nu vol'],
  [
    'Keep your code. You can try again later, until {date}. Nothing about you has been kept.',
    'Bewaar uw code. U kunt het later opnieuw proberen, tot {date}. Er is niets over u bewaard.',
  ],
  ['You are in', 'U bent toegelaten'],
  [
    'One thing is left: make your account. The sign-in service mails a code to {email}. With it you confirm that the address is yours.',
    'Er is nog één ding te doen: maak uw account aan. De aanmeldservice mailt een code naar {email}. Daarmee bevestigt u dat het e-mailadres van u is.',
  ],
  ['Create your account', 'Maak uw account aan'],
  ['We also sent you an email, from {from}. It says the same.', 'Wij hebben u ook een e-mail gestuurd, vanaf {from}. Daarin staat hetzelfde.'],
  [
    'You want to move away from Google. We add {email} to a list at Google by hand, and write to you when that is done. Until then Google does not allow the connection.',
    'U wilt weg bij Google. Wij zetten {email} met de hand op een lijst bij Google, en schrijven u als dat is gebeurd. Tot dan laat Google de koppeling niet toe.',
  ],
  ['Ownpace never asks for your password by email or phone.', 'Ownpace vraagt nooit per e-mail of telefoon om uw wachtwoord.'],
  ['Is {email} not right? Write to {support}.', 'Klopt {email} niet? Schrijf naar {support}.'],
];

/**
 * The names the free thing does not take (`GLOSSARY.md`), and *key*. Whole
 * words, so that *pace* or *in plaats van* is not one: the last is not said
 * either, but a guard that refused it would refuse the wrong thing.
 */
const RETIRED = /\b(gifts?|cadeau\w*|\w*cadeau|places?|plaats|plek|keys?|sleutels?|invitations?|uitnodig\w*)\b/i;

/** Every word the dictionary holds for the card, the door and the giver's page. */
const DICTIONARY: ReadonlyArray<readonly [string, string]> = [
  ...Object.entries(en).map(([key, words]) => [`en ${key}`, words] as const),
  ...Object.entries(nl).map(([key, words]) => [`nl ${key}`, words] as const),
];

/** The site's page, as a reader reads it: without its comment, its anchors and its addresses. */
function sitePage(file: string): string {
  return readFileSync(join(ROOT, 'site', 'pages', file), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\{#[^}]*\}/g, ' ')
    .replace(/\]\([^)]*\)/g, ']');
}
const SITE = { en: sitePage('en/gift.md'), nl: sitePage('nl/cadeau.md') } as const;

/** The two mails every request gets (§8), as the person reads them: the yes mail for a request and for a code, and the no mail. */
function mails(locale: NotificationLocale): string[] {
  const yes = { kind: 'access_granted', organisation: 'Familie de Vries', appUrl: 'https://app.example.test', email: 'cato@example.test', alpha: true } as const;
  const said = [
    renderEvent(yes, locale),
    renderEvent({ ...yes, withCode: true, google: true }, locale),
    renderEvent({ kind: 'access_declined' }, locale),
  ];
  return said.flatMap((m) => [m.subject, m.body]);
}

describe('every sentence of §7 the web says is in the dictionary, in both languages', () => {
  it.each(SECTION_7)('%s', (english, dutch) => {
    const keys = (Object.keys(en) as Array<keyof typeof en>).filter((key) => en[key] === english);
    expect(keys, `no key says "${english}"`).not.toEqual([]);
    expect(
      keys.some((key) => nl[key] === dutch),
      `no key says "${english}" with its Dutch "${dutch}"; it says ${keys.map((k) => `"${nl[k]}"`).join(', ')}`,
    ).toBe(true);
  });
});

describe('the giver’s list, as one row of §7', () => {
  it('Not used yet · Used on {date}: let in · Withdrawn · Expired', () => {
    expect([en['give.state.unused'], en['give.state.redeemed'], en['give.state.revoked'], en['give.state.expired']]).toEqual([
      'Not used yet',
      'Used on {date}: let in',
      'Withdrawn',
      'Expired',
    ]);
    expect([nl['give.state.unused'], nl['give.state.redeemed'], nl['give.state.revoked'], nl['give.state.expired']]).toEqual([
      'Nog niet gebruikt',
      'Gebruikt op {date}: toegelaten',
      'Ingetrokken',
      'Verlopen',
    ]);
  });
});

describe('no retired name for the free thing, and no key', () => {
  it('in the dictionary of the card, the door and the giver’s page', () => {
    expect(DICTIONARY.filter(([, words]) => RETIRED.test(words))).toEqual([]);
  });

  it.each(['en', 'nl'] as const)('on the site’s page, in %s', (locale) => {
    expect(SITE[locale].match(RETIRED)).toBeNull();
  });

  it.each(['en', 'nl'] as const)('in the two mails, in %s', (locale) => {
    expect(mails(locale).filter((text) => RETIRED.test(text))).toEqual([]);
  });

  it('reads what it guards: the words are there to read', () => {
    expect(Object.keys(en).length).toBeGreaterThan(40);
    expect(SITE.en.length).toBeGreaterThan(500);
    expect(mails('nl').join(' ')).toMatch(/U gebruikte een code van iemand die u kent\./);
  });
});

describe('the giver’s page, the card and the site’s page say recommendation / aanbeveling', () => {
  it('the giver’s page and the card', () => {
    expect(en['give.title']).toMatch(/\brecommend/i);
    expect(nl['give.title']).toMatch(/\baanbevel/i);
    expect(en['card.title']).toMatch(/\brecommendation\b/);
    expect(nl['card.title']).toMatch(/\baanbeveling\b/);
  });

  it.each(['en', 'nl'] as const)('the site’s page, in %s, from its title on', (locale) => {
    const title = SITE[locale].split('\n').find((line) => line.startsWith('# ')) ?? '';
    expect(title).toMatch(locale === 'en' ? /\b[Rr]ecommendation\b/ : /\b[Aa]anbeveling\b/);
  });
});

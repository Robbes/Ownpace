// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE OWNER'S WORDS AT THE DOOR (the owner's answers of 2026-10-18 to the UX
 * sweep's word choices: sign-in, the first screens and the grant page).
 *
 * Each line below was the owner's own, from the text review of 2026-10-10, and
 * the sweep found a defect in it that only the owner could choose to fix: an
 * abbreviation (*zsm.*), English words in Dutch (*support*, *Service status*),
 * a comma splice, a pun, a Dutch sentence that said the opposite of its
 * English, a sign-out word that was not the pair of the sign-in word, and
 * *provider* where the rest of the Dutch says *aanbieder*. The owner chose
 * the words pinned here; the tagline is the owner's own.
 *
 * Literals, not the dictionary read back, so a word changed without the
 * owner is seen here.
 */
import { describe, it, expect } from 'vitest';
import { STRINGS } from './strings.ts';

const en = STRINGS.en as Record<string, string>;
const nl = STRINGS.nl as Record<string, string>;

describe('the owner’s words of 2026-10-18', () => {
  it('signs in with Aanmelden and out with Afmelden, in one pair', () => {
    expect(nl['login.title']).toBe('Aanmelden bij Ownpace');
    expect(nl['nav.signOut']).toBe('Afmelden');
    expect(nl['acceptance.notNow']).toBe('Nu niet, afmelden');
    expect(nl['acceptance.forbidden']).toBe(
      'Dit account heeft geen toegang tot deze organisatie. Meld u af en meld u opnieuw aan met het account waarmee u bent uitgenodigd.',
    );
    const other = Object.entries(nl).filter(([, v]) => /uitlog|log\s+uit\b/i.test(v));
    expect(other.map(([k]) => k), 'Dutch that still signs out with uitloggen').toEqual([]);
  });

  it('gives the same advice about asking again in both languages', () => {
    expect(en['login.noOrganisation.already.why']).toBe(
      "Asking again doesn't help: a second request while the first is open is not recorded twice.",
    );
    expect(nl['login.noOrganisation.already.why']).toBe(
      'Nogmaals aanvragen helpt niet: een tweede aanvraag terwijl de eerste openstaat, wordt niet dubbel vastgelegd.',
    );
  });

  it('says what moves under the sign-in title, in the owner’s own words', () => {
    expect(en['login.tagline']).toBe('Your mail, calendars, tasks, contacts and files back to Europe.');
    expect(nl['login.tagline']).toBe('Uw e-mail, agenda\'s, taken, contacten en bestanden terug naar Europa.');
  });

  it('writes the four entry lines without an abbreviation, English words or a comma splice', () => {
    expect(nl['invite.skipHelp']).toBe('Kiest u nu niet, dan vragen wij het opnieuw bij uw volgende aanmelding.');
    expect(en['report.lead']).toBe('Tell us what happened. We read every report and will contact you by email.');
    expect(nl['report.lead']).toBe('Wat is er aan de hand? U krijgt zo snel mogelijk antwoord per e-mail.');
    expect(en['acceptance.fault.read']).toBe('Something went wrong on our side. Try again later, or write to us.');
    expect(nl['acceptance.fault.read']).toBe('Er ging bij ons iets mis. Probeer het later opnieuw, of schrijf ons.');
    expect(en['status.link']).toBe('Service status');
    expect(nl['status.link']).toBe('Servicestatus');
    // Not chosen: the invitation's subtitle keeps the owner's words.
    expect(en['invite.subtitle']).toBe('Join if you want to migrate.');
    expect(nl['invite.subtitle']).toBe('Wilt u migreren?');
  });

  it('says who signs in to a linked account in whole English sentences, the Dutch as it was', () => {
    expect(en['start.who.someoneElse.line']).toBe(
      'They connect a Google account themselves, so you never hold those credentials. With other providers, which no link can reach, you sign in together.',
    );
    expect(nl['start.who.someoneElse.line']).toBe(
      'Een Google-account verbindt iemand anders zelf, zodat u dat wachtwoord nooit in handen krijgt. Bij andere aanbieders meldt u zich samen aan.',
    );
  });

  it('asks what is moving in Dutch postvakken, the glossary’s word for a mailbox', () => {
    expect(nl['access.noteHint']).toBe('Ongeveer hoeveel postvakken en bestanden, hoe groot, en waarvandaan; één zin is genoeg.');
  });
});

describe('a provider is an aanbieder in Dutch (GLOSSARY.md)', () => {
  it('no Dutch sentence says provider, outside a name filled in and the identity provider', () => {
    const said = Object.entries(nl)
      .filter(([, v]) => /\bproviders?\b/i.test(v.replace(/\{[^}]*\}/g, '')))
      .map(([k]) => k);
    expect(said).toEqual([]);
  });

  it('the grant page and the progress page say it in the owner’s chosen words', () => {
    expect(nl['grant.asking']).toBe(
      '{organisation} migreert uw account naar een nieuwe aanbieder en heeft uw toestemming nodig om te lezen wat voor u moet worden gemigreerd.',
    );
    expect(nl['grant.person.asking']).toMatch(/^\{organisation\} migreert uw accounts naar een nieuwe aanbieder en heeft/);
    expect(nl['view.who']).toBe('{organisation} migreert uw account naar een nieuwe aanbieder.');
    expect(nl['view.person.who']).toBe(
      '{organisation} migreert uw accounts naar nieuwe aanbieders. Hier ziet u hoe elke migratie ervoor staat.',
    );
    expect(nl['view.failure.rateLimited']).toBe(
      'Uw aanbieder vroeg ons (automatisch) rustiger aan te doen. Dit gaat vanzelf verder.',
    );
    expect(nl['failure.rateLimited']).toBe(
      'De aanbieder vroeg ons (automatisch) om rustiger aan te doen. Er is niets mis: dit pauzeert en hervat vanzelf.',
    );
    expect(nl['pause.ceiling.why']).toMatch(/^Deze limiet is van uw oude aanbieder, niet van ons\. /);
  });
});

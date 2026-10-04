// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN INVITATION THAT SAYS WHO ASKED (workplan 0156 T3).
 *
 * The mail an invited person receives. They never asked us for anything, so
 * unlike the access-granted mail it says who invited them, and it closes with
 * what we keep about them and where the privacy policy is (privacy §4.6).
 * Like that mail it carries an address to sign in at and the address to sign
 * in with, never a token, and it does not tell them to open an app they have
 * no account for.
 *
 * During the alpha it opens a paragraph with the note's welcome and then the
 * facts (the owner, 2026-10-04, 0131 D4's amendment), and, as the
 * access-granted mail does, links the Alpha conditions and the tester guide
 * after them, in its own language (0131 T1 (b), 2026-10-04). The privacy line
 * stays last. Those cases failed on cd318823: the paragraph ended with no
 * address.
 */

import { describe, it, expect } from 'vitest';
import { renderEvent } from './notifications.ts';

const LOCALES = ['en', 'nl'] as const;

const INVITED = {
  kind: 'member_invited',
  organisation: 'Familie Berentsen',
  invitedBy: 'rob@example.test',
  appUrl: 'https://app.example.test',
  email: 'test@ownpace.test',
  privacyPolicy: 'https://site.example.test/privacy.html',
} as const;

describe('the invitation mail', () => {
  it.each(LOCALES)('names the organisation, who asked, where and with which address, in %s', (locale) => {
    const { body } = renderEvent(INVITED, locale);
    for (const part of [INVITED.organisation, INVITED.invitedBy, INVITED.appUrl, INVITED.email]) {
      expect(body).toContain(part);
    }
  });

  it.each(LOCALES)('closes with what is kept and the privacy policy, in %s', (locale) => {
    const lines = renderEvent(INVITED, locale).body.trimEnd().split('\n');
    expect(lines.at(-1)).toMatch(/Ownpace/);
    expect(lines.at(-1)!.endsWith(INVITED.privacyPolicy)).toBe(true);
  });

  it.each(LOCALES)('says nothing happens unless they join, and carries no link to keep, in %s', (locale) => {
    const { body } = renderEvent(INVITED, locale);
    expect(body).toMatch(locale === 'en' ? /nothing happens unless you sign in and join/ : /er gebeurt niets tenzij/);
    expect(body).toMatch(locale === 'en' ? /There is no link or code in this email/ : /geen link of code/);
  });

  it.each(LOCALES)('does not tell them to open an app they have no account for, in %s', (locale) => {
    const { body } = renderEvent(INVITED, locale);
    expect(body).not.toMatch(locale === 'en' ? /Open the app to act/ : /Open de app om actie/);
  });

  it.each(LOCALES)('says only that they are invited when the inviter has no address, in %s', (locale) => {
    const { invitedBy: _dropped, ...withoutInviter } = INVITED;
    const { body } = renderEvent(withoutInviter, locale);
    expect(body).not.toMatch(/invitation is from|uitnodiging komt van/);
    expect(body).toMatch(locale === 'en' ? /You are invited to join this organisation/ : /U bent uitgenodigd/);
  });

  /** The note's welcome, which opens the alpha paragraph (the owner, 2026-10-04). */
  const WELCOME = { en: 'Welcome to the Alpha! ', nl: 'Welkom bij de Alpha! ' } as const;
  const opensWithTheWelcome = (body: string, locale: (typeof LOCALES)[number]) =>
    body.split('\n').some((l) => l.startsWith(WELCOME[locale]));

  it.each(LOCALES)('carries the alpha paragraph only during the alpha, in %s', (locale) => {
    expect(opensWithTheWelcome(renderEvent(INVITED, locale).body, locale)).toBe(false);
    expect(opensWithTheWelcome(renderEvent({ ...INVITED, alpha: true }, locale).body, locale)).toBe(true);
  });

  /** The addresses the API hands it during the alpha, in the mail's language. */
  const LINKED = {
    en: { alphaConditions: 'https://site.example.test/alpha.html', testerGuide: 'https://site.example.test/alpha-guide.html' },
    nl: {
      alphaConditions: 'https://site.example.test/nl/alpha.html',
      testerGuide: 'https://site.example.test/nl/alpha-handleiding.html',
    },
  } as const;
  const SAYS = {
    en: { conditions: 'Read the Alpha conditions here:', guide: 'Read the guide to the Alpha before you start:' },
    nl: {
      conditions: 'Lees hier de voorwaarden voor de Alpha:',
      guide: 'Lees de handleiding voor de Alpha voordat u begint:',
    },
  } as const;

  it.each(LOCALES)('during the alpha, links the conditions and the guide after the paragraph, in %s', (locale) => {
    const lines = renderEvent({ ...INVITED, alpha: true, ...LINKED[locale] }, locale).body.trimEnd().split('\n');
    const lead = lines.findIndex((l) => l.startsWith(WELCOME[locale]));
    expect(lead, 'the alpha paragraph is gone').toBeGreaterThan(-1);
    // In the paragraph, straight after its words: conditions, then the guide.
    expect(lines[lead + 1]).toBe(`${SAYS[locale].conditions} ${LINKED[locale].alphaConditions}`);
    expect(lines[lead + 2]).toBe(`${SAYS[locale].guide} ${LINKED[locale].testerGuide}`);
    // And the privacy policy is still the last line (privacy §4.6).
    expect(lines.at(-1)!.endsWith(INVITED.privacyPolicy)).toBe(true);
  });

  it.each(LOCALES)('outside the alpha, names neither, whatever it is handed, in %s', (locale) => {
    const { body } = renderEvent({ ...INVITED, ...LINKED[locale] }, locale);
    expect(body).not.toContain(LINKED[locale].alphaConditions);
    expect(body).not.toContain(LINKED[locale].testerGuide);
  });

  it('has its own subject in both languages', () => {
    expect(renderEvent(INVITED, 'en').subject).toBe('Ownpace — you are invited to join an organisation');
    expect(renderEvent(INVITED, 'nl').subject).toBe('Ownpace — u bent uitgenodigd voor een organisatie');
  });
});

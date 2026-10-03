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

  it('carries the alpha paragraph only during the alpha', () => {
    expect(renderEvent(INVITED, 'en').body).not.toMatch(/^Alpha:/m);
    expect(renderEvent({ ...INVITED, alpha: true }, 'en').body).toMatch(/^Alpha:/m);
  });

  it('has its own subject in both languages', () => {
    expect(renderEvent(INVITED, 'en').subject).toBe('Ownpace — you are invited to join an organisation');
    expect(renderEvent(INVITED, 'nl').subject).toBe('Ownpace — u bent uitgenodigd voor een organisatie');
  });
});

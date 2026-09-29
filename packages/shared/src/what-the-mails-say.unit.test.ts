// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT THE MAILS SAY, HELD TO WHAT THE PRIVACY POLICY SAYS (workplan 0139 T4;
 * the owner's ops-app-sentences (a) and privacy-share-mail-notice (a),
 * 2026-09-28; `site/legal/README.md`, *To build or to do*).
 *
 * Three things the service's mail said were less than, or other than, what the
 * privacy policy a tester accepts says:
 *
 *  - The access-granted mail said the password "lives with the sign-in
 *    service, never with us". The sign-in service is ours: we run it, on the
 *    same machine as the service, and it keeps a hash of the password (privacy
 *    §4.4). The mail now says so, in the README's words: *"we store only a
 *    hash of it, in the sign-in service we run"*.
 *  - Its alpha paragraph said "nothing is backed up". Since 0139 T6 one copy
 *    is made right before each update and kept up to 7 days (privacy §9,
 *    Alpha conditions §6). The paragraph now names that copy. It is the alpha
 *    note's own words (`an-alpha-said-out-loud.unit.test.tsx` holds the two
 *    together).
 *  - The mail to people items were shared with (Template 6) said nothing about
 *    who sent it or what is kept about them, and Art. 14(3)(b) GDPR asks for
 *    that at the first communication at the latest (privacy briefing, question
 *    2). On the managed service it now closes with one sentence and the
 *    policy's address, in the mail's language (privacy §4.6). The appliance's
 *    mail, which its owner sends from their own box, carries neither: our
 *    policy is not theirs.
 *
 * Each case pins the substance rather than every word, so a later edit may
 * reword a sentence and still fails here when it drops what the policy relies
 * on. The pages' half is `apps/web/src/pages/what-the-app-says.unit.test.tsx`;
 * the address itself, and that it is a page the site writes, is
 * `scripts/a-policy-link-that-answers.unit.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEvent } from './notifications.ts';
import { SHARE_ANNOUNCEMENT_PRIVACY, renderShareAnnouncement } from './share-announcement.ts';

const LOCALES = ['en', 'nl'] as const;

const GRANTED = {
  kind: 'access_granted',
  organisation: 'Familie de Vries',
  appUrl: 'https://app.example.test',
  email: 'stranger@example.test',
} as const;

describe('the access-granted mail, about the password', () => {
  /** The one sentence about the password: it is ours, and only its hash is kept. */
  const HASH = {
    en: /password[^.]*\bwe store only a hash of it, in the sign-in service we run\./i,
    nl: /wachtwoord[^.]*\bbewaren we alleen een hash, in de aanmeldservice die we zelf draaien\./i,
  } as const;

  it.each(LOCALES)('says only a hash of it is stored, in the sign-in service we run, in %s', (locale) => {
    expect(renderEvent(GRANTED, locale).body).toMatch(HASH[locale]);
  });

  it.each(LOCALES)('no longer says the password is never with us, in %s', (locale) => {
    // We run the sign-in service (privacy §4.4), so "never with us" was the
    // one claim in the mail the policy contradicts.
    const { body } = renderEvent({ ...GRANTED, alpha: true }, locale);
    expect(body).not.toMatch(/never with us|nooit bij ons/i);
  });
});

describe('the access-granted mail during the alpha, about backups', () => {
  /** No backups, and the one exception with its limit. */
  const COPY = {
    en: /There are no backups, apart from one copy before each update, kept up to 7 days\./,
    nl: /Er worden geen back-ups gemaakt, op één kopie vlak voor elke update na, die hoogstens 7 dagen wordt bewaard\./,
  } as const;

  it.each(LOCALES)('names the one copy before each update, kept up to 7 days, in %s', (locale) => {
    expect(renderEvent({ ...GRANTED, alpha: true }, locale).body).toMatch(COPY[locale]);
  });

  it.each(LOCALES)('no longer says that nothing at all is backed up, in %s', (locale) => {
    const { body } = renderEvent({ ...GRANTED, alpha: true }, locale);
    expect(body).not.toMatch(/nothing is backed up|er worden geen back-ups gemaakt en/i);
  });
});

describe('the mail to people items were shared with (Template 6)', () => {
  const digest = { grantee: 'anna@example.test', items: [{ on: 'Projects/budget.xlsx', role: 'writer' }] };
  const NOTE = 'Everything now lives at Team Cloud.';
  /** An address no default could produce, so a mail that ignores it fails. */
  const POLICY = {
    en: 'https://legal.example.test/privacy.html',
    nl: 'https://legal.example.test/nl/privacy.html',
  } as const;

  /** What the sentence must name, per language: who, what is kept, and where to read more. */
  const SUBSTANCE = {
    en: [/\bOwnpace\b/, /your address/, /names of these items/, /privacy policy/],
    nl: [/\bOwnpace\b/, /uw adres/, /namen van deze items/, /privacyverklaring/],
  } as const;

  it.each(LOCALES)('names who keeps what, and why and for how long is in the policy, in %s', (locale) => {
    const sentence = SHARE_ANNOUNCEMENT_PRIVACY?.[locale];
    expect(sentence, 'share-announcement.ts exports no privacy sentence').toBeTypeOf('string');
    for (const part of SUBSTANCE[locale]) expect(sentence).toMatch(part);
  });

  it.each(LOCALES)('closes with that sentence and the policy address it was given, in %s', (locale) => {
    const { body } = renderShareAnnouncement(digest, locale, NOTE, POLICY[locale]);
    const paragraphs = body.split('\n\n');
    expect(paragraphs.at(-1)).toBe(`${SHARE_ANNOUNCEMENT_PRIVACY?.[locale]} ${POLICY[locale]}`);
    // Once, and in the mail's own language: the other language's address is not there.
    expect(body.split(POLICY[locale])).toHaveLength(2);
    const other = locale === 'en' ? 'nl' : 'en';
    expect(body).not.toContain(SHARE_ANNOUNCEMENT_PRIVACY?.[other] ?? '\u0000');
  });

  it.each(LOCALES)('keeps the note, the items and the once-sentence above it, in %s', (locale) => {
    // The line is added at the end, never swapped for what the person needs.
    const without = renderShareAnnouncement(digest, locale, NOTE, null).body;
    const withIt = renderShareAnnouncement(digest, locale, NOTE, POLICY[locale]).body;
    expect(withIt.startsWith(`${without}\n\n`)).toBe(true);
  });

  it.each(LOCALES)('on the appliance, given no address, says nothing about our policy, in %s', (locale) => {
    // The appliance's owner sends this from their own box: Ownpace keeps
    // nothing of it, and our policy is not theirs.
    const { body } = renderShareAnnouncement(digest, locale, NOTE, null);
    expect(body).not.toMatch(/privacy|Ownpace/i);
    expect(body).not.toMatch(/https?:\/\//);
  });

  it('the human copy in docs/cutover-communication-templates.md carries the same sentence, in both languages', () => {
    const doc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'cutover-communication-templates.md'),
      'utf8',
    );
    // The template is wrapped at a line width, so its words are compared with
    // every run of white space made one space.
    const flat = doc.replace(/\s+/g, ' ');
    const template6 = flat.slice(flat.indexOf('## Template 6'), flat.indexOf('## Usage Guidelines'));
    expect(template6.length).toBeGreaterThan(100);
    for (const locale of LOCALES) {
      const sentence = SHARE_ANNOUNCEMENT_PRIVACY?.[locale];
      expect(sentence, 'share-announcement.ts exports no privacy sentence').toBeTypeOf('string');
      expect(template6, `Template 6 (${locale}) lacks the privacy line the mail sends`).toContain(sentence);
    }
  });
});

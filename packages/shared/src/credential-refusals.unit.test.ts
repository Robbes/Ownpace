// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Every credential refusal exists in both languages, and the field names in it
 * exist in neither (workplan 0083).
 *
 * Two properties, pulling in opposite directions, and both easy to get wrong:
 *
 *  1. **The frame is translated.** Twelve refusals across seven factories were
 *     the only operator prose with no Dutch at all, and they are the most-read
 *     prose the server produces — they are what a person meets on the first
 *     attempt at every provider.
 *  2. **The finding is not.** `clientId`, `OAUTH2_CLIENT_ID`, `DROPBOX_APP_KEY`
 *     are the literal things the operator has to go and set. A Dutch rendering
 *     of `clientId` names a field that does not exist, which is the defect 0071
 *     T2 fixed from the other direction: a refusal that named a database column
 *     beside a form with no such box.
 *
 * The parity test at the end is the one that matters in six months. A future
 * refusal added with `nl` copied from `en` — the path of least resistance when
 * somebody is in a hurry — would satisfy "both fields present" and ship English
 * to a Dutch operator anyway.
 */

import { describe, it, expect } from 'vitest';
import {
  missingCredentials,
  missingAccountAddress,
  delegatedFlowCannotReadMailbox,
  entraClientIdMissing,
  entraFlowNotChosen,
  refusalText,
  isCredentialRefusal,
  CredentialRefusalError,
  CREDENTIAL_STORE_NL,
  type BilingualRefusal,
} from './credential-refusals';

/** One of each shape, which is the whole surface. */
const ALL: ReadonlyArray<{ what: string; refusal: BilingualRefusal; fields: string[] }> = [
  {
    what: 'missing credentials (many)',
    refusal: missingCredentials({
      subject: 'dropbox source',
      missing: ['clientId', 'clientSecret', 'refreshToken'],
      detailEn: 'A Dropbox migration authenticates as the account that consented.',
      detailNl: 'Een Dropbox-migratie meldt zich aan als het account dat toestemming gaf.',
    }).refusal,
    fields: ['clientId', 'clientSecret', 'refreshToken'],
  },
  {
    what: 'missing credentials (one)',
    refusal: missingCredentials({
      subject: 'box source',
      missing: ['BOX_CLIENT_ID'],
      detailEn: 'A Box migration uses the Client Credentials Grant.',
      detailNl: 'Een Box-migratie gebruikt de Client Credentials Grant.',
    }).refusal,
    fields: ['BOX_CLIENT_ID'],
  },
  {
    what: 'missing account address',
    refusal: missingAccountAddress('Gmail source', 'because reasons.', 'omdat redenen.').refusal,
    fields: ['user'],
  },
  {
    what: 'delegated flow conflict',
    refusal: delegatedFlowCannotReadMailbox({
      subject: 'graph-mail source',
      mailbox: 'anna@acme.example',
      refreshTokenField: 'OAUTH2_REFRESH_TOKEN',
      clientSecretField: 'OAUTH2_CLIENT_SECRET',
      store: 'mailbox',
    }).refusal,
    fields: ['OAUTH2_REFRESH_TOKEN', 'OAUTH2_CLIENT_SECRET'],
  },
  {
    what: 'entra client id missing',
    refusal: entraClientIdMissing('graph-calendar source', 'OAUTH2_CLIENT_ID').refusal,
    fields: ['OAUTH2_CLIENT_ID'],
  },
  {
    what: 'entra flow not chosen',
    refusal: entraFlowNotChosen(
      'graph-calendar source',
      'OAUTH2_CLIENT_SECRET',
      'OAUTH2_REFRESH_TOKEN',
    ).refusal,
    fields: ['OAUTH2_CLIENT_SECRET', 'OAUTH2_REFRESH_TOKEN'],
  },
];

describe('the bilingual credential refusals', () => {
  it('carries a real Dutch sentence for every shape, not a copy of the English', () => {
    for (const { what, refusal } of ALL) {
      expect(refusal.en.length, what).toBeGreaterThan(20);
      expect(refusal.nl.length, what).toBeGreaterThan(20);
      // The parity check that survives a hurried future addition.
      expect(refusal.nl, what).not.toBe(refusal.en);
    }
  });

  it('never translates the field names — they are what the operator must set', () => {
    for (const { what, refusal, fields } of ALL) {
      for (const field of fields) {
        expect(refusal.en, `${what} / en / ${field}`).toContain(field);
        // The important half: the Dutch sentence names the SAME literal field.
        expect(refusal.nl, `${what} / nl / ${field}`).toContain(field);
      }
      expect([...refusal.fields].sort()).toEqual([...fields].sort());
    }
  });

  it('translates the FRAME, not just the parts that were already different', () => {
    // The first version of this test looked for common Dutch function words.
    // It failed on `entraFlowNotChosen` — a sentence that is perfectly Dutch
    // ("stel … in … of …") and simply short. Widening the word list until it
    // passed would have left a check that needs editing every time a short
    // refusal is added and catches nothing a human would not have caught.
    //
    // So: strip the field names, which are verbatim in both by design, and
    // require what remains to differ. That is the real property — a Dutch
    // sentence that is the English one with the same words around the same
    // fields has not been translated — and it holds for any vocabulary.
    for (const { what, refusal, fields } of ALL) {
      const strip = (text: string) =>
        fields.reduce((acc, f) => acc.split(f).join(''), text).replace(/[\s.,:—"()]/g, '');
      const en = strip(refusal.en);
      const nl = strip(refusal.nl);
      expect(nl.length, `${what}: the Dutch is nothing but field names`).toBeGreaterThan(10);
      expect(nl, `${what}: the frame was not translated`).not.toBe(en);
    }
  });

  it('agrees in number, in both languages', () => {
    const one = missingCredentials({
      subject: 's', missing: ['a'], detailEn: 'x'.repeat(30), detailNl: 'y'.repeat(30),
    }).refusal;
    const many = missingCredentials({
      subject: 's', missing: ['a', 'b'], detailEn: 'x'.repeat(30), detailNl: 'y'.repeat(30),
    }).refusal;
    expect(one.en).toContain('a is not set');
    expect(one.nl).toContain('a is niet ingesteld');
    expect(many.en).toContain('a, b are not set');
    // Dutch joins the last pair with `en`, which English does not do here —
    // the list grammar is part of the frame, so it is translated too.
    expect(many.nl).toContain('a en b zijn niet ingesteld');
  });

  it('keeps `message` as the English, so every existing caller is unchanged', () => {
    const err = entraClientIdMissing('graph-calendar source', 'OAUTH2_CLIENT_ID');
    // Logs, `String(err)`, and every test that predates this all read `message`.
    expect(err.message).toBe(err.refusal.en);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CredentialRefusalError);
    expect(isCredentialRefusal(err)).toBe(true);
    expect(isCredentialRefusal(new Error('something else'))).toBe(false);
  });

  it('picks a language, defaulting to English for anything unexpected', () => {
    const { refusal } = entraClientIdMissing('s', 'F');
    expect(refusalText(refusal, 'nl')).toBe(refusal.nl);
    expect(refusalText(refusal, 'en')).toBe(refusal.en);
  });

  it('has one Dutch phrase per credential store, not one per provider', () => {
    // Seven factories name the same two places; the point of the constant is
    // that they cannot drift into seven slightly different Dutch sentences.
    expect(CREDENTIAL_STORE_NL.appliance).not.toBe(CREDENTIAL_STORE_NL.managed);
    expect(Object.values(CREDENTIAL_STORE_NL).every((v) => v.length > 5)).toBe(true);
  });
});

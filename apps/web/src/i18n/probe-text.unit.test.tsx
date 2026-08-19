// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * A probe result in the reader's language — except the half that is not ours
 * (workplan 0080; 0068 T10d).
 *
 * The owner met *Connected. 12 folders visible.* in a Dutch UI. The naive fix
 * is to translate the probe result, and it is wrong: half of what a probe
 * returns is the PROVIDER's, and `invalid_client` is the exact string you
 * paste into their console. Translating that destroys its only use.
 *
 * So both halves are pinned here, and the second one matters more than the
 * first: **a provider's refusal must survive untouched under `nl`.**
 */

import { describe, it, expect } from 'vitest';
import type { ProbeOutcome } from '@openmig/shared';
import { probeText } from './probe-text.ts';
import { STRINGS, type StringKey } from './strings.ts';

/** A `t` bound to one locale, with the same interpolation the app uses. */
const translator =
  (locale: 'en' | 'nl') =>
  (key: StringKey, vars?: Readonly<Record<string, string | number>>): string =>
    STRINGS[locale][key].replace(/\{(\w+)\}/g, (whole, name: string) =>
      vars && name in vars ? String(vars[name]) : whole,
    );

const en = translator('en');
const nl = translator('nl');

describe('probeText — what we authored', () => {
  const connected: ProbeOutcome = { code: 'connected', count: 12, unit: 'folder' };

  it('reads in English under en', () => {
    expect(probeText(en, connected, 'ignored')).toBe('Connected. 12 folders visible.');
  });

  it('reads in DUTCH under nl — the whole point of the change', () => {
    expect(probeText(nl, connected, 'ignored')).toBe('Verbonden. 12 mappen zichtbaar.');
  });

  it('counts one thing in the singular, in both languages', () => {
    const one: ProbeOutcome = { code: 'connected', count: 1, unit: 'folder' };
    expect(probeText(en, one, '')).toBe('Connected. 1 folder visible.');
    expect(probeText(nl, one, '')).toBe('Verbonden. 1 map zichtbaar.');
  });

  it('names the unit a source actually counts', () => {
    expect(probeText(nl, { code: 'connected', count: 3, unit: 'calendar' }, '')).toContain(
      "agenda's",
    );
    expect(probeText(en, { code: 'connected', count: 2, unit: 'addressBook' }, '')).toContain(
      'address books',
    );
  });

  it('puts the values where each LANGUAGE puts them, not where English does', () => {
    // The reason `t` gained interpolation at all: a sentence concatenated from
    // fragments has English word order baked into the concatenation.
    const status: ProbeOutcome = { code: 'targetStatus', url: 'https://mail.acme.test', status: 401 };
    expect(probeText(en, status, '')).toContain('The server at https://mail.acme.test answered 401.');
    expect(probeText(nl, status, '')).toContain('De server op https://mail.acme.test antwoordde 401.');
    // 401 gets the sentence that says the server is fine and the login is not.
    expect(probeText(nl, status, '')).toContain('weigerde de inloggegevens');
  });
});

describe("probeText — what the PROVIDER said", () => {
  const theirs: ProbeOutcome = { code: 'providerRefused' };
  const verbatim = 'Dropbox refused the token request (400): {"error": "invalid_client"}';

  it('renders it untouched under nl', () => {
    // This is the string somebody pastes into the provider's console. A Dutch
    // rendering of it would be a Dutch rendering of somebody else's error code.
    expect(probeText(nl, theirs, verbatim)).toBe(verbatim);
  });

  it('renders it untouched under en too', () => {
    expect(probeText(en, theirs, verbatim)).toBe(verbatim);
  });
});

describe('probeText — when there is no outcome at all', () => {
  it('shows what arrived, rather than less', () => {
    // An older API, a cached response, a route not taught yet. Falling back to
    // the server's own sentence can never render less than before this existed.
    expect(probeText(nl, undefined, 'Connected. 12 folders visible.')).toBe(
      'Connected. 12 folders visible.',
    );
  });
});

describe('a credential refusal is OURS, so it is translated (workplan 0083)', () => {
  const refusal = {
    code: 'credentials_missing',
    fields: ['clientId', 'clientSecret'],
    en: 'dropbox source: clientId, clientSecret are not set. A Dropbox migration authenticates as the account that consented.',
    nl: 'dropbox source: clientId en clientSecret zijn niet ingesteld. Een Dropbox-migratie meldt zich aan als het account dat toestemming gaf.',
  } as const;

  it('renders the Dutch to a Dutch reader', () => {
    // The owner's report, in one assertion: this sentence was English on a
    // Dutch phone because it arrived labelled as the provider's.
    expect(probeText(nl, { code: 'credentialsRefused', refusal }, 'IGNORED', 'nl')).toBe(refusal.nl);
  });

  it('renders the English to an English reader', () => {
    expect(probeText(en, { code: 'credentialsRefused', refusal }, 'IGNORED', 'en')).toBe(refusal.en);
  });

  it('still names the exact fields in Dutch', () => {
    const dutch = probeText(nl, { code: 'credentialsRefused', refusal }, '', 'nl');
    // Translating `clientId` would name a box that is on no screen — the 0071
    // T2 defect, from the other direction.
    expect(dutch).toContain('clientId');
    expect(dutch).toContain('clientSecret');
  });

  it("does NOT translate a provider's own refusal, whatever the locale", () => {
    // The distinction the outcome exists to carry. `invalid_client` is the
    // string somebody pastes into Dropbox's console.
    expect(probeText(nl, { code: 'providerRefused' }, 'invalid_client', 'nl')).toBe('invalid_client');
  });

  it('defaults to English when no locale is passed', () => {
    // Every pre-existing call site omits the argument; none of them may start
    // rendering something different because this parameter was added.
    expect(probeText(en, { code: 'credentialsRefused', refusal }, 'IGNORED')).toBe(refusal.en);
  });
});

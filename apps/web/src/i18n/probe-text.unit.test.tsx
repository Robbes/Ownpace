// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import { probeText, qualificationEvidence, qualificationText, schedulingText } from './probe-text.ts';
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

describe('schedulingText — the verdict a DAV target test carries (0105 T0)', () => {
  it('says auto-schedule in the reader\'s language, and that it was MEASURED', () => {
    const verdict = { capability: 'auto-schedule', sentence: 'server english' };
    expect(schedulingText(en, verdict)).toContain('measured on this target, not assumed');
    expect(schedulingText(nl, verdict)).toContain('gemeten op dit doel, niet aangenomen');
  });

  it('unknown is worded as unmeasured-never-safe in BOTH languages', () => {
    // The run-#6 lesson survives translation: a Dutch screen must not soften
    // "unmeasured" into anything a reader could file under "fine".
    const verdict = { capability: 'unknown', sentence: 'server english' };
    expect(schedulingText(en, verdict)).toContain('UNMEASURED');
    expect(schedulingText(en, verdict)).toContain('not safe');
    expect(schedulingText(nl, verdict)).toContain('NIET GEMETEN');
    expect(schedulingText(nl, verdict)).toContain('niet veilig');
  });

  it('none says fan-out cannot happen here', () => {
    expect(schedulingText(en, { capability: 'none', sentence: 'x' })).toContain('cannot happen here');
    expect(schedulingText(nl, { capability: 'none', sentence: 'x' })).toContain('uitwaaieren');
  });

  it('a capability this build has no words for falls back to the server\'s sentence', () => {
    // The probeText rule, inherited: never render less than what arrived.
    expect(schedulingText(nl, { capability: 'brand-new', sentence: 'the server said this' })).toBe(
      'the server said this',
    );
  });

  it('no verdict means nothing at all — not an empty line', () => {
    expect(schedulingText(en, undefined)).toBeNull();
  });
});

describe('qualificationText — what the account can carry (0106 T0)', () => {
  const q = (
    mail: 'yes' | 'no' | 'unknown',
    calendar: 'yes' | 'no' | 'unknown',
    contact: 'yes' | 'no' | 'unknown',
    file: 'yes' | 'no' | 'unknown',
  ) => ({
    domains: {
      mail: { answer: mail, detail: 'd' },
      calendar: { answer: calendar, detail: 'd' },
      contact: { answer: contact, detail: 'd' },
      file: { answer: file, detail: 'd' },
    },
  });

  it('renders the three marks in the reader\'s language, domains in a fixed order', () => {
    expect(qualificationText(en, q('unknown', 'yes', 'yes', 'no'))).toBe(
      "Can carry: Email ? · Calendar ✓ · Contacts ✓ · Files ✗ — '?' is unmeasured — not safe to assume either way",
    );
    expect(qualificationText(nl, q('yes', 'yes', 'yes', 'yes'))).toBe(
      'Kan dragen: E-mail ✓ · Agenda ✓ · Contacten ✓ · Bestanden ✓',
    );
  });

  it('the unmeasured hint appears exactly when a ? is on the line', () => {
    expect(qualificationText(en, q('yes', 'yes', 'no', 'yes'))).not.toContain('unmeasured');
    expect(qualificationText(nl, q('yes', 'unknown', 'yes', 'yes'))).toContain('niet gemeten');
  });

  it('no qualification renders nothing at all', () => {
    expect(qualificationText(en, undefined)).toBeNull();
  });
});

describe('qualificationText — the count beside the tick, once a face was reached (2026-09-02)', () => {
  const reached = {
    domains: {
      mail: { answer: 'yes' as const, detail: 'The grant carries mail; 14 folders visible.', count: 14, unit: 'folder' as const },
      calendar: { answer: 'yes' as const, detail: '5 calendars visible.', count: 5, unit: 'calendar' as const },
      contact: { answer: 'unknown' as const, detail: 'The grant carries carddav, but the face did not answer: 403' },
      file: { answer: 'yes' as const, detail: '1 folder visible.', count: 1, unit: 'folder' as const },
    },
  };

  it('words each count in the reader\'s language, singular and plural, and leaves an unknown bare', () => {
    const english = qualificationText(en, reached)!;
    expect(english).toContain('Email ✓ 14 folders');
    expect(english).toContain('Calendar ✓ 5 calendars');
    expect(english).toContain('Contacts ?');
    expect(english).toContain('Files ✓ 1 folder');
    const dutch = qualificationText(nl, reached)!;
    expect(dutch).toContain('5 agenda');
    expect(dutch).toContain('1 map');
    expect(dutch).not.toContain('calendars');
  });

  it('an older record without counts renders exactly as before', () => {
    const bare = {
      domains: {
        mail: { answer: 'yes' as const, detail: 'x' },
        calendar: { answer: 'no' as const, detail: 'x' },
        contact: { answer: 'yes' as const, detail: 'x' },
        file: { answer: 'unknown' as const, detail: 'x' },
      },
    };
    expect(qualificationText(en, bare)).toBe(
      "Can carry: Email ✓ · Calendar ✗ · Contacts ✓ · Files ? — '?' is unmeasured — not safe to assume either way",
    );
  });
});

describe('qualificationEvidence — why each `?` is a `?`, as lines to show (2026-09-02)', () => {
  const GOOGLE_403 =
    'The grant carries https://www.googleapis.com/auth/carddav, but the face did not answer: ' +
    'PROPFIND failed with status 403: accessNotConfigured — Google Contacts CardDAV API has not ' +
    'been used in project 123 before or it is disabled.';
  const mixed = {
    domains: {
      mail: { answer: 'yes' as const, detail: '29 folders visible.' },
      calendar: { answer: 'yes' as const, detail: '5 calendars visible.' },
      contact: { answer: 'unknown' as const, detail: GOOGLE_403 },
      file: { answer: 'no' as const, detail: 'The grant does not carry drive.readonly — re-consent.' },
    },
  };

  it('one line per unknown face, labelled in the reader\'s language, the sentence verbatim', () => {
    expect(qualificationEvidence(en, mixed)).toEqual([`Contacts ?: ${GOOGLE_403}`]);
    expect(qualificationEvidence(nl, mixed)).toEqual([`Contacten ?: ${GOOGLE_403}`]);
  });

  it('nothing to show when every face was measured, and nothing for no record at all', () => {
    const measured = {
      domains: {
        mail: { answer: 'yes' as const, detail: 'x' },
        calendar: { answer: 'no' as const, detail: 'x' },
        contact: { answer: 'yes' as const, detail: 'x' },
        file: { answer: 'no' as const, detail: 'x' },
      },
    };
    expect(qualificationEvidence(en, measured)).toEqual([]);
    expect(qualificationEvidence(en, undefined)).toEqual([]);
  });
});

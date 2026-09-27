// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ANSWER A DUTCH TESTER READ IN ENGLISH (workplan 0136 T3, the web half).
 *
 * The managed Test button answers a typed address from its parts (#1227): a
 * status, a server's own words only when they came as an error document we
 * know, or what kind of failure it was, and a reference that finds the full
 * text in the log. That answer arrived as an English sentence in `reason`, and
 * the screens render `reason` for any code they do not know, so a Dutch tester
 * read *"Nothing answered at that address"* and *"That address is inside this
 * service's own network"* in English, and every refused face the same way.
 *
 * The API now keeps the parts beside its sentence, with the reference, and
 * the screens say them in the reader's language. What this holds:
 *
 * - every kind of failure reads in Dutch under `nl` and in English under
 *   `en`, and ends with the reference;
 * - a server's own words stay exactly as they came, in both languages;
 * - the parts win over the outcome code, which for a server that answered is
 *   still the probe's own;
 * - without a reference the parts are not an answer of the managed API's (the
 *   appliance, whose owner reads the full text, or a record stored before),
 *   and the screen shows the text it was given, as before;
 * - a refused face reads the same way on the connection card and the panels;
 * - the limit on tests is ours too, and reads in the reader's language.
 */

import { describe, it, expect } from 'vitest';
import axios, { AxiosError, AxiosHeaders } from 'axios';
import type { ProbeOutcome, WhatHappenedAnswer } from '@openmig/shared';
import { probeText, qualificationEvidence, saidText } from './probe-text.ts';
import { STRINGS, type StringKey } from './strings.ts';
import { tooManyTests } from '../services/api.ts';

/** A `t` bound to one locale, with the same interpolation the app uses. */
const translator =
  (locale: 'en' | 'nl') =>
  (key: StringKey, vars?: Readonly<Record<string, string | number>>): string =>
    STRINGS[locale][key].replace(/\{(\w+)\}/g, (whole, name: string) =>
      vars && name in vars ? String(vars[name]) : whole,
    );

const en = translator('en');
const nl = translator('nl');
const REF = '1a2b3c4d';
const SABRE = 'Sabre\\DAV\\Exception\\NotAuthenticated — No public access';

describe('what happened at a typed address, in the reader’s language', () => {
  it.each<[string, WhatHappenedAnswer, string, string]>([
    [
      'a DAV server that sent something that is not an error document',
      { kind: 'answered', protocol: 'dav', status: 500, reference: REF },
      `The server answered 500 with something that is not a DAV, JMAP or IMAP error. Reference ${REF}.`,
      `De server antwoordde 500 met iets dat geen DAV-, JMAP- of IMAP-foutmelding is. Referentie ${REF}.`,
    ],
    [
      'a DAV server’s own error document',
      { kind: 'answered', protocol: 'dav', status: 401, providerWords: SABRE, reference: REF },
      `The server answered 401: ${SABRE}. Reference ${REF}.`,
      `De server antwoordde 401: ${SABRE}. Referentie ${REF}.`,
    ],
    [
      'a mail server’s NO, which has no status',
      { kind: 'answered', protocol: 'imap', providerWords: 'NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)', reference: REF },
      `The mail server answered: NO [AUTHENTICATIONFAILED] Invalid credentials (Failure). Reference ${REF}.`,
      `De mailserver antwoordde: NO [AUTHENTICATIONFAILED] Invalid credentials (Failure). Referentie ${REF}.`,
    ],
    [
      'a server that answered without a status or an error document',
      { kind: 'answered', protocol: 'jmap', reference: REF },
      `The server answered with something that is not a DAV, JMAP or IMAP error. Reference ${REF}.`,
      `De server antwoordde met iets dat geen DAV-, JMAP- of IMAP-foutmelding is. Referentie ${REF}.`,
    ],
    [
      'nothing that answered',
      { kind: 'unreachable', reference: REF },
      `Nothing answered at that address: the name did not resolve, the connection was refused, or no answer came in time. Check the host name and the port. Reference ${REF}.`,
      `Op dat adres antwoordde niets: de naam werd niet gevonden, de verbinding werd geweigerd, of er kwam niet op tijd antwoord. Controleer de hostnaam en de poort. Referentie ${REF}.`,
    ],
    [
      'a certificate that did not verify',
      { kind: 'certificate', reference: REF },
      `The server's certificate did not verify for that name, or it has expired, so the test stopped before signing in. Reference ${REF}.`,
      `Het certificaat van de server klopte niet voor die naam, of het is verlopen, dus de test stopte voordat er werd ingelogd. Referentie ${REF}.`,
    ],
    [
      'an address inside our own network',
      { kind: 'insideOurNetwork', reference: REF },
      `That address is inside this service's own network, or the server sent the test on to one that is, so we did not connect to it. Give the address the server has on the internet. Reference ${REF}.`,
      `Dat adres ligt binnen het eigen netwerk van deze dienst, of de server stuurde de test door naar een adres dat daar ligt, dus we hebben er geen verbinding mee gemaakt. Geef het adres dat de server op internet heeft. Referentie ${REF}.`,
    ],
    [
      'anything else',
      { kind: 'unknown', reference: REF },
      `The test failed, and what came back is not shown here. Check the address and the port. Reference ${REF}.`,
      `De test mislukte, en wat terugkwam wordt hier niet getoond. Controleer het adres en de poort. Referentie ${REF}.`,
    ],
  ])('%s', (_what, said, english, dutch) => {
    expect(saidText(en, said)).toBe(english);
    expect(saidText(nl, said)).toBe(dutch);
  });

  it('keeps a server’s own words exactly as they came, and stops a sentence they did not', () => {
    const said: WhatHappenedAnswer = { kind: 'answered', protocol: 'dav', status: 403, providerWords: 'accessNotConfigured — CalDAV API has not been used in project 1 before or it is disabled.', reference: REF };
    // The words end with their own stop, so none is added.
    expect(saidText(nl, said)).toBe(
      `De server antwoordde 403: accessNotConfigured — CalDAV API has not been used in project 1 before or it is disabled. Referentie ${REF}.`,
    );
  });
});

describe('the Test result: the parts first, and the text it was given without them', () => {
  const unreachable: WhatHappenedAnswer = { kind: 'unreachable', reference: REF };
  const reason = `Nothing answered at that address … Reference ${REF}.`;

  it('the parts win over the outcome code, which for a server that answered is the probe’s own', () => {
    const outcome: ProbeOutcome = { code: 'providerRefused' };
    const said: WhatHappenedAnswer = { kind: 'answered', protocol: 'dav', status: 500, reference: REF };
    expect(probeText(nl, outcome, 'The server answered 500 …', 'nl', said)).toMatch(/^De server antwoordde 500 /);
  });

  it('the new codes read in Dutch through the parts', () => {
    expect(probeText(nl, { code: 'unreachable' }, reason, 'nl', unreachable)).toMatch(/^Op dat adres antwoordde niets/);
    expect(
      probeText(nl, { code: 'insideOurNetwork' }, reason, 'nl', { kind: 'insideOurNetwork', reference: REF }),
    ).toMatch(/^Dat adres ligt binnen het eigen netwerk van deze dienst/);
  });

  it('without a reference the parts are not ours to say: the appliance’s full text shows, as before', () => {
    const full = 'PROPFIND failed with status 500: Internal Server Error';
    const said: WhatHappenedAnswer = { kind: 'answered', protocol: 'dav', status: 500 };
    expect(saidText(nl, said)).toBeNull();
    expect(probeText(nl, { code: 'providerRefused' }, full, 'nl', said)).toBe(full);
    expect(probeText(nl, { code: 'providerRefused' }, full, 'nl')).toBe(full);
  });
});

describe('a face refused at a typed address', () => {
  const said: WhatHappenedAnswer = { kind: 'answered', protocol: 'dav', status: 500, reference: REF };
  const detail = `Unmeasured — the server answered 500 with something that is not a DAV, JMAP or IMAP error. Reference ${REF}.`;
  const record = { domains: { calendar: { answer: 'unknown' as const, reason: 'refused' as const, detail, said } } };

  it('reads in Dutch under nl, and as the server wrote it under en', () => {
    expect(qualificationEvidence(nl, record)).toEqual([
      `Agenda: Niet gemeten — de server antwoordde 500 met iets dat geen DAV-, JMAP- of IMAP-foutmelding is. Referentie ${REF}.`,
    ]);
    expect(qualificationEvidence(en, record)).toEqual([`Calendar: ${detail}`]);
  });

  it('a face stored before, or on the appliance, without a reference, shows its detail as before', () => {
    const { reference: _gone, ...parts } = said;
    const older = { domains: { calendar: { answer: 'unknown' as const, reason: 'refused' as const, detail: 'PROPFIND failed with status 500', said: parts } } };
    expect(qualificationEvidence(nl, older)).toEqual(['Agenda: PROPFIND failed with status 500']);
  });
});

describe('the limit on tests is ours, so it reads in the reader’s language', () => {
  const refusal = (status: number, error: string) =>
    new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      status,
      statusText: '',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: { error, reason: 'You have tested a lot of connections in the last hour. Wait a little, then test again.' },
    });

  it('a 429 too_many_tests is the limit, and nothing else is', () => {
    expect(axios.isAxiosError(refusal(429, 'too_many_tests'))).toBe(true);
    expect(tooManyTests(refusal(429, 'too_many_tests'))).toBe(true);
    expect(tooManyTests(refusal(429, 'too_many_reports'))).toBe(false);
    expect(tooManyTests(refusal(400, 'too_many_tests'))).toBe(false);
    expect(tooManyTests(new Error('too_many_tests'))).toBe(false);
  });

  it('has a sentence in both languages', () => {
    expect(en('probe.tooManyTests')).toBe(
      'You have tested a lot of connections in the last hour. Wait a little, then test again.',
    );
    expect(nl('probe.tooManyTests')).toBe('U hebt het afgelopen uur veel verbindingen getest. Wacht even en test dan opnieuw.');
  });
});

// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SENTENCE THE SCREEN AND THE API WORD APART (workplan 0136 T3).
 *
 * The managed API answers a Test at an address the tester typed in English,
 * in the result's `reason` and each refused face's `detail`, and keeps the
 * parts beside it, so the screen can say the same thing in its reader's
 * language. Under `en` the screen says it from the parts too. So one answer
 * has two English renderings: the API's, which a script, the smoke and the log
 * read, and the screen's. This holds that they are the same words, so a
 * sentence reworded on one side fails here, rather than the screen and the API
 * telling one tester two different things.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log, type WhatHappened } from '@openmig/shared';
import type { AccountQualification, QualifiedDomain } from '@openmig/orchestration/account-qualification';
import { probeAnswers } from '../apps/api/src/probe-answer.ts';
import { qualificationEvidence, saidText } from '../apps/web/src/i18n/probe-text.ts';
import { STRINGS, type StringKey } from '../apps/web/src/i18n/strings.ts';

/** The screen's `t` under `en`, with the app's interpolation. */
const en = (key: StringKey, vars?: Readonly<Record<string, string | number>>): string =>
  STRINGS.en[key].replace(/\{(\w+)\}/g, (whole, name: string) => (vars && name in vars ? String(vars[name]) : whole));

/** One of each thing that can happen at a typed address. */
const HAPPENINGS: ReadonlyArray<[string, WhatHappened]> = [
  ['a server that sent something else', { kind: 'answered', protocol: 'dav', status: 500 }],
  ['a server’s own error document', { kind: 'answered', protocol: 'dav', status: 401, providerWords: 'Sabre\\DAV\\Exception\\NotAuthenticated — No public access' }],
  ['a mail server’s NO', { kind: 'answered', protocol: 'imap', providerWords: 'NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)' }],
  ['a JMAP server without a status', { kind: 'answered', protocol: 'jmap' }],
  ['nothing that answered', { kind: 'unreachable' }],
  ['a certificate that did not verify', { kind: 'certificate' }],
  ['an address inside our own network', { kind: 'insideOurNetwork' }],
  ['anything else', { kind: 'unknown' }],
];

beforeEach(() => {
  // The API logs the full text under the reference; nothing here reads it.
  vi.spyOn(log, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Test result: the API’s reason is the screen’s English', () => {
  it.each(HAPPENINGS)('%s', (_what, said) => {
    const answered = probeAnswers('testing a connection').result({
      ok: false,
      reason: 'the full text, which only the log keeps',
      outcome: { code: 'providerRefused' },
      said,
    });
    if (answered.ok) throw new Error('a refusal answered as a pass');
    expect(answered.said?.reference, 'the answer keeps the parts with the reference').toMatch(/^[0-9a-f]{8}$/);
    expect(saidText(en, answered.said)).toBe(answered.reason);
  });
});

describe('a refused face: the API’s detail is the screen’s English line', () => {
  const unasked: QualifiedDomain = { answer: 'unknown', reason: 'notAskable', detail: 'This connection carries no mail server address.' };

  it.each(HAPPENINGS)('%s', (_what, said) => {
    const face: QualifiedDomain = { answer: 'unknown', reason: 'refused', detail: 'the full text', said };
    const measured: AccountQualification = {
      domains: { mail: unasked, calendar: face, contact: unasked, file: unasked, task: unasked },
    };
    const answered = probeAnswers('testing a connection').qualification(measured);
    expect(answered.domains.calendar.said?.reference).toMatch(/^[0-9a-f]{8}$/);
    expect(qualificationEvidence(en, answered)).toContain(`Calendar: ${answered.domains.calendar.detail}`);
  });
});

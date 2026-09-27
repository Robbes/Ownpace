// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MANAGED ANSWER, SAID FROM THE PARTS (workplan 0136 T3).
 *
 * `probeAnswers` is the one place the managed API turns what a host a tester
 * typed said into a sentence. What this holds: each kind of `said` becomes our
 * sentence and never the full text; the full text goes to the log once, under
 * the reference the sentence ends with; one request records one event; and a
 * result or a face without `said` passes as it came.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log, setAppEventSink, type AppEvent, type WhatHappened } from '@openmig/shared';
import type { ProbeResult } from '@openmig/orchestration/probe-connection';
import type { AccountQualification } from '@openmig/orchestration/account-qualification';
import { PROBE_REFUSED_EVENT, probeAnswers, whatHappenedSentence } from './probe-answer.ts';

const FULL = 'PROPFIND failed with status 500: <html><body>an internal admin page</body></html>';

let recorded: AppEvent[];
let warned: string[];

beforeEach(() => {
  recorded = [];
  warned = [];
  setAppEventSink({ record: async (event) => void recorded.push(event) });
  vi.spyOn(log, 'warn').mockImplementation((...args: unknown[]) => void warned.push(args.join(' ')));
});

afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

function refused(said: WhatHappened, reason = FULL): ProbeResult {
  return { ok: false, reason, outcome: { code: 'providerRefused' }, said };
}

describe('the sentence for each thing that can happen', () => {
  it.each<[string, WhatHappened, string]>([
    [
      'a DAV server with an error document',
      { kind: 'answered', protocol: 'dav', status: 401, providerWords: 'Sabre\\DAV\\Exception\\NotAuthenticated — No public access' },
      'The server answered 401: Sabre\\DAV\\Exception\\NotAuthenticated — No public access.',
    ],
    [
      'a DAV server with anything else',
      { kind: 'answered', protocol: 'dav', status: 500 },
      'The server answered 500 with something that is not a DAV, JMAP or IMAP error.',
    ],
    [
      'an IMAP server',
      { kind: 'answered', protocol: 'imap', providerWords: 'NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)' },
      'The mail server answered: NO [AUTHENTICATIONFAILED] Invalid credentials (Failure).',
    ],
  ])('%s', (_what, said, sentence) => {
    expect(whatHappenedSentence(said)).toBe(sentence);
  });

  it.each<[WhatHappened['kind'], RegExp]>([
    ['unreachable', /^Nothing answered at that address/],
    ['certificate', /certificate did not verify/],
    ['insideOurNetwork', /inside this service's own network/],
    ['unknown', /^The test failed, and what came back is not shown here/],
  ])('%s: a sentence of ours', (kind, words) => {
    expect(whatHappenedSentence({ kind } as WhatHappened)).toMatch(words);
  });
});

describe('the probe result', () => {
  it('said from its parts, ending with the reference, and never the full text', () => {
    const answered = probeAnswers('testing a connection', 'a-tenant').result(
      refused({ kind: 'answered', protocol: 'dav', status: 500 }),
    );
    expect(answered.ok).toBe(false);
    if (answered.ok) return;
    const ref = recorded[0]?.reference;
    expect(answered.reason).toBe(
      `The server answered 500 with something that is not a DAV, JMAP or IMAP error. Reference ${ref}.`,
    );
    expect(answered.reason).not.toContain('admin page');
    expect(answered).not.toHaveProperty('said');
    expect(answered.outcome).toEqual({ code: 'providerRefused' });
  });

  it("nothing answered: the outcome is 'unreachable'", () => {
    const answered = probeAnswers('testing a connection').result(refused({ kind: 'unreachable' }, 'connect ECONNREFUSED 10.0.0.9:5432'));
    expect(answered.outcome).toEqual({ code: 'unreachable' });
    if (!answered.ok) expect(answered.reason).not.toContain('10.0.0.9');
  });

  it("the rule's refusal: the outcome is 'insideOurNetwork', and no host", () => {
    const answered = probeAnswers('testing a connection').result(
      refused({ kind: 'insideOurNetwork' }, 'db.internal.example is an address inside this service’s own network'),
    );
    expect(answered.outcome).toEqual({ code: 'insideOurNetwork' });
    if (!answered.ok) expect(answered.reason).not.toContain('db.internal.example');
  });

  it('the full text goes to the log once, under the reference, with a warn event for the operator', () => {
    probeAnswers('testing a connection', 'a-tenant').result(refused({ kind: 'answered', protocol: 'dav', status: 500 }));
    expect(recorded).toEqual([
      { level: 'warn', event: PROBE_REFUSED_EVENT, reference: expect.stringMatching(/^[0-9a-f]{8}$/), tenantId: 'a-tenant' },
    ]);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(`[ref ${recorded[0]?.reference}]`);
    expect(warned[0]).toContain(FULL);
  });

  it('a result without parts passes as it came, and records nothing', () => {
    const ours: ProbeResult = { ok: false, reason: 'The test did not answer within 20 seconds.', outcome: { code: 'timedOut', seconds: 20 } };
    const connected: ProbeResult = { ok: true, detail: 'Connected.', outcome: { code: 'connectedSession' } };
    const answers = probeAnswers('testing a connection');
    expect(answers.result(ours)).toEqual(ours);
    expect(answers.result(connected)).toBe(connected);
    expect(recorded).toEqual([]);
    expect(warned).toEqual([]);
  });
});

function face(said?: WhatHappened) {
  return {
    answer: 'unknown' as const,
    reason: 'refused' as const,
    detail: `Unmeasured — the probe was refused: ${FULL}`,
    ...(said ? { said } : {}),
  };
}

describe('the qualification', () => {
  const measured: AccountQualification = {
    domains: {
      mail: { answer: 'unknown', reason: 'notAskable', detail: 'This connection carries no mail server address.' },
      calendar: face({ kind: 'answered', protocol: 'dav', status: 500 }),
      task: face({ kind: 'answered', protocol: 'dav', status: 500 }),
      contact: face({ kind: 'unreachable' }),
      file: { answer: 'yes', detail: '4 folders visible.', count: 4, unit: 'folder' },
    },
  };

  it('each face with parts is said from them, and the parts are not kept', () => {
    const answers = probeAnswers('testing a connection', 'a-tenant');
    const q = answers.qualification(measured);
    const ref = recorded[0]?.reference;
    expect(q.domains.calendar).toEqual({
      answer: 'unknown',
      reason: 'refused',
      detail: `Unmeasured — the server answered 500 with something that is not a DAV, JMAP or IMAP error. Reference ${ref}.`,
    });
    expect(q.domains.contact.detail).toMatch(/^Unmeasured — nothing answered at that address/);
    expect(JSON.stringify(q)).not.toContain('admin page');
    expect(JSON.stringify(q)).not.toContain('said');
    // The faces without parts are as they were.
    expect(q.domains.mail).toEqual(measured.domains.mail);
    expect(q.domains.file).toEqual(measured.domains.file);
  });

  it('one request, one reference and one event, however many answers; the same text logged once', () => {
    const answers = probeAnswers('testing a connection', 'a-tenant');
    const result = answers.result(refused({ kind: 'answered', protocol: 'dav', status: 500 }));
    const q = answers.qualification(measured);
    expect(recorded).toHaveLength(1);
    const ref = recorded[0]?.reference ?? '';
    if (!result.ok) expect(result.reason).toContain(`Reference ${ref}.`);
    for (const d of [q.domains.calendar, q.domains.task, q.domains.contact]) expect(d.detail).toContain(`Reference ${ref}.`);
    // The probe's reason, and the faces' one detail, which three faces share.
    expect(warned).toHaveLength(2);
  });
});

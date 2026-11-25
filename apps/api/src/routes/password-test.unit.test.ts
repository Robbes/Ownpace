// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PASSWORD TEST'S THREE CATEGORIES (workplan 0174 §5.4, D4, T3).
 *
 * The create door's probe and qualification, recorded: `refused_login` only
 * when the probe says the server refused the login; `unreachable` for every
 * other failure; `face_missing` only for a needed face's measured no, never
 * for a face the kind does not have or another grant carries.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ProbeResult } from '@openmig/orchestration/probe-connection';
import type { AccountQualification, QualifiedDomain } from '@openmig/orchestration/account-qualification';
import { runPasswordTest, type PasswordTestDeps } from './password-test.ts';
import { probeAnswers } from '../probe-answer.ts';
import type { PasswordTestInput } from './grant-providers.ts';

const yes: QualifiedDomain = { answer: 'yes', detail: 'ok' };
const unknown: QualifiedDomain = { answer: 'unknown', detail: '?', reason: 'notAskable' };
const refused: QualifiedDomain = { answer: 'no', detail: 'refused', reason: 'refused' };

function deps(probe: ProbeResult, q?: Partial<AccountQualification['domains']>): PasswordTestDeps {
  const domains = { mail: yes, calendar: yes, contact: yes, file: yes, task: yes, ...q };
  return {
    probeSource: vi.fn(async () => probe),
    probeTarget: vi.fn(async () => probe),
    qualify: vi.fn(async () => (q === undefined ? undefined : ({ domains } as AccountQualification))),
  };
}

const input = (over: Partial<PasswordTestInput> = {}): PasswordTestInput => ({
  role: 'target',
  kind: 'infomaniak',
  config: { url: 'https://sync.example.org/' },
  credentials: { username: 'anna@example.org', password: 'placeholder-password', mailPassword: 'placeholder-mail' },
  faces: ['email', 'calendar'],
  ...over,
});

const CONNECTED: ProbeResult = { ok: true, detail: 'Connected.', outcome: { code: 'connectedSession' } };

describe('runPasswordTest', () => {
  it('answers refused_login only when the probe says the server refused the login', async () => {
    const answers = probeAnswers('a unit test');
    const login = await runPasswordTest(input(), ['password'], answers, deps({ ok: false, reason: 'x', outcome: { code: 'providerRefused' }, refusedLogin: true }));
    expect(login.test).toEqual({ ok: false, category: 'refused_login' });
    for (const outcome of [
      { code: 'timedOut', seconds: 20 },
      { code: 'unreachable' },
      { code: 'insideOurNetwork' },
      { code: 'targetStatus', url: 'https://x.example/', status: 404 },
      { code: 'providerRefused' },
    ] as const) {
      const other = await runPasswordTest(input(), ['password'], answers, deps({ ok: false, reason: 'x', outcome }));
      expect(other.test, outcome.code).toEqual({ ok: false, category: 'unreachable' });
    }
  });

  it('answers face_missing for a needed face’s measured no, and nothing for a face not needed or not the password’s', async () => {
    const answers = probeAnswers('a unit test');
    const mail = await runPasswordTest(input(), ['password', 'mailPassword'], answers, deps(CONNECTED, { mail: refused }));
    expect(mail.test).toEqual({ ok: false, category: 'face_missing', faces: ['email'] });
    // Contacts are not this migration's: their no is no refusal.
    const notNeeded = await runPasswordTest(input(), ['password'], answers, deps(CONNECTED, { contact: refused }));
    expect(notNeeded.test.ok).toBe(true);
    // A face the kind does not carry, or another grant carries, is not the password's.
    const structural = await runPasswordTest(
      input({ role: 'source', kind: 'apple', faces: ['calendar', 'file'] }),
      ['password'],
      answers,
      deps(CONNECTED, { file: { answer: 'no', detail: 'iCloud Drive', reason: 'structural' } }),
    );
    expect(structural.test.ok).toBe(true);
    const drive = await runPasswordTest(
      input({ kind: 'cirrux', faces: ['calendar', 'file'] }),
      ['password'],
      answers,
      deps(CONNECTED, { file: { answer: 'no', detail: 'no grant', reason: 'refused' } }),
    );
    expect(drive.test).toMatchObject({ ok: true, faces: ['calendar'] });
    // An unknown is not a refusal: the probe's verdict stands.
    const unsure = await runPasswordTest(input(), ['password'], answers, deps(CONNECTED, { mail: unknown }));
    expect(unsure.test.ok).toBe(true);
  });

  it('hands back only the person’s keys as the secret to store', async () => {
    const run = await runPasswordTest(input(), ['password', 'mailPassword'], probeAnswers('a unit test'), deps(CONNECTED));
    expect(run.test).toEqual({
      ok: true,
      secret: { password: 'placeholder-password', mailPassword: 'placeholder-mail' },
      faces: ['email', 'calendar'],
    });
  });

  it('probes a destination as a destination, and a source as a source', async () => {
    const d = deps(CONNECTED);
    await runPasswordTest(input(), ['password'], probeAnswers('a unit test'), d);
    expect(d.probeTarget).toHaveBeenCalledWith('infomaniak', expect.any(Object), expect.objectContaining({ password: 'placeholder-password' }));
    const s = deps(CONNECTED);
    await runPasswordTest(input({ role: 'source', kind: 'imap' }), ['password'], probeAnswers('a unit test'), s);
    expect(s.probeSource).toHaveBeenCalledWith('imap', expect.any(Object), expect.any(Object));
    expect(s.probeTarget).not.toHaveBeenCalled();
  });
});

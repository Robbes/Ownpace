// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Turning an environment into a channel (workplan 0030 T1, wiring).
 *
 * The case worth the most tests is the HALF-configured one. "Nothing set" is
 * the normal default and deserves a plain sentence; "SMTP_HOST set and
 * nothing else" is somebody who tried, and telling them it is simply "off"
 * would leave them believing they are covered when they are not. So a
 * partial configuration names the missing variables (hard rule 9).
 *
 * Also pinned: a disabled notifier says so ONCE rather than per message, and
 * a sending one hands the transport exactly what it was configured with —
 * including a send failure it must NOT swallow.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  readNotifierConfig,
  createNotifier,
  createFailureStreakGate,
  disabledNotifier,
  type MailTransport,
} from './notifications';

const FULL = {
  SMTP_HOST: 'smtp.example.nl',
  NOTIFY_FROM: 'openmigrate@example.nl',
  NOTIFY_TO: 'owner@example.nl',
};

describe('nothing configured', () => {
  it('is off, and says so plainly rather than cryptically', () => {
    const config = readNotifierConfig({});
    expect(config.enabled).toBe(false);
    if (!config.enabled) {
      expect(config.reason).toContain('no SMTP settings configured');
      // Names the variables, so "how do I turn it on" is answered in place.
      expect(config.reason).toContain('SMTP_HOST');
    }
  });
});

describe('half configured — somebody tried', () => {
  it('names exactly what is missing, and stays off', () => {
    const config = readNotifierConfig({ SMTP_HOST: 'smtp.example.nl' });
    expect(config.enabled).toBe(false);
    if (!config.enabled) {
      expect(config.reason).toContain('partly configured');
      expect(config.reason).toContain('NOTIFY_FROM');
      expect(config.reason).toContain('NOTIFY_TO');
      // Not listed as missing — it is the one thing that WAS set.
      expect(config.reason).not.toContain('missing: SMTP_HOST');
    }
  });

  it('treats a lone recipient list as trying, too', () => {
    const config = readNotifierConfig({ NOTIFY_TO: 'owner@example.nl' });
    expect(config.enabled).toBe(false);
    if (!config.enabled) expect(config.reason).toContain('SMTP_HOST');
  });

  it('does not mistake an empty NOTIFY_TO for a recipient', () => {
    const config = readNotifierConfig({ ...FULL, NOTIFY_TO: '   ,  ' });
    expect(config.enabled).toBe(false);
    if (!config.enabled) expect(config.reason).toContain('NOTIFY_TO');
  });
});

describe('fully configured', () => {
  it('defaults to STARTTLS on 587 — the common case, not implicit TLS', () => {
    const config = readNotifierConfig(FULL);
    expect(config.enabled).toBe(true);
    if (config.enabled) {
      expect(config.smtp).toMatchObject({ host: 'smtp.example.nl', port: 587, secure: false });
      expect(config.settings).toMatchObject({
        from: 'openmigrate@example.nl',
        to: ['owner@example.nl'],
        locale: 'en',
      });
    }
  });

  it('moves to 465 when implicit TLS is asked for', () => {
    const config = readNotifierConfig({ ...FULL, SMTP_SECURE: 'true' });
    if (config.enabled) expect(config.smtp).toMatchObject({ port: 465, secure: true });
  });

  it('honours an explicit port over either default', () => {
    const config = readNotifierConfig({ ...FULL, SMTP_PORT: '2525' });
    if (config.enabled) expect(config.smtp.port).toBe(2525);
  });

  it('ignores a nonsense port rather than sending to port NaN', () => {
    const config = readNotifierConfig({ ...FULL, SMTP_PORT: 'yes please' });
    if (config.enabled) expect(config.smtp.port).toBe(587);
  });

  it('splits and trims several recipients', () => {
    const config = readNotifierConfig({ ...FULL, NOTIFY_TO: 'a@x.nl, b@x.nl ,c@x.nl' });
    if (config.enabled) expect(config.settings.to).toEqual(['a@x.nl', 'b@x.nl', 'c@x.nl']);
  });

  it('takes Dutch when asked, and English for anything else', () => {
    const nl = readNotifierConfig({ ...FULL, NOTIFY_LOCALE: 'nl' });
    const nonsense = readNotifierConfig({ ...FULL, NOTIFY_LOCALE: 'klingon' });
    if (nl.enabled) expect(nl.settings.locale).toBe('nl');
    // English is the dictionary's source language, so it is the safe default
    // rather than an error that would take the channel down.
    if (nonsense.enabled) expect(nonsense.settings.locale).toBe('en');
  });

  it('carries credentials through only when they were given', () => {
    const anon = readNotifierConfig(FULL);
    const auth = readNotifierConfig({ ...FULL, SMTP_USER: 'u', SMTP_PASSWORD: 'p' });
    if (anon.enabled) expect(anon.smtp.user).toBeUndefined();
    if (auth.enabled) expect(auth.smtp).toMatchObject({ user: 'u', password: 'p' });
  });
});

describe('the disabled notifier', () => {
  it('says why ONCE, however many times it is asked', async () => {
    const said: string[] = [];
    const notifier = disabledNotifier('no SMTP settings configured', (m) => said.push(m));

    await notifier.notify({ subject: 's', body: 'b' });
    await notifier.notify({ subject: 's', body: 'b' });
    await notifier.notify({ subject: 's', body: 'b' });

    // Once: a channel that is off is one fact. Repeating it per event would
    // bury the run's real output under its own bookkeeping.
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('not sending');
    expect(said[0]).toContain('no SMTP settings configured');
  });

  it('never throws — being off is not an error the caller must handle', async () => {
    const notifier = disabledNotifier('off', () => {});
    await expect(notifier.notify({ subject: 's', body: 'b' })).resolves.toBeUndefined();
  });
});

describe('the sending notifier', () => {
  it('hands the transport exactly its configured envelope', async () => {
    const sent: Parameters<MailTransport>[0][] = [];
    const notifier = createNotifier(
      async (m) => {
        sent.push(m);
      },
      { from: 'openmigrate@example.nl', to: ['a@x.nl', 'b@x.nl'], locale: 'nl' },
    );

    await notifier.notify({ subject: 'Onderwerp', body: 'Tekst' });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      from: 'openmigrate@example.nl',
      to: ['a@x.nl', 'b@x.nl'],
      subject: 'Onderwerp',
      body: 'Tekst',
    });
  });

  it('PROPAGATES a send failure instead of swallowing it', async () => {
    // The whole point of the channel is reaching someone who is not
    // watching; a send that failed silently is indistinguishable from one
    // that was never worth making (hard rule 9).
    const notifier = createNotifier(
      () => Promise.reject(new Error('535 authentication failed')),
      { from: 'a@x.nl', to: ['b@x.nl'] },
    );
    await expect(notifier.notify({ subject: 's', body: 'b' })).rejects.toThrow(
      /535 authentication failed/,
    );
  });

  it('does not call the transport more than once per message', async () => {
    const transport = vi.fn<MailTransport>(async () => {});
    const notifier = createNotifier(transport, { from: 'a@x.nl', to: ['b@x.nl'] });
    await notifier.notify({ subject: 's', body: 'b' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe('one outage, one email (the failure streak gate)', () => {
  it('stays quiet below the threshold — one bad pass is usually a blip', () => {
    const gate = createFailureStreakGate(3);
    expect(gate.record('m', 'failed', 'boom')).toBeUndefined();
    expect(gate.record('m', 'failed', 'boom')).toBeUndefined();
  });

  it('speaks EXACTLY once, at the threshold, and never again during the outage', () => {
    const gate = createFailureStreakGate(3);
    gate.record('m', 'failed', 'boom');
    gate.record('m', 'failed', 'boom');

    const event = gate.record('m', 'failed', 'getaddrinfo ENOTFOUND stalwart');
    expect(event).toMatchObject({
      kind: 'runs_failing',
      mappingId: 'm',
      consecutiveFailures: 3,
      // Verbatim, from the pass that crossed the line.
      lastError: 'getaddrinfo ENOTFOUND stalwart',
    });

    // The fourth, fifth and hundredth failure are the SAME outage. A cron
    // that runs every minute would otherwise send sixty emails an hour about
    // one unplugged server, and the channel would be filtered by lunchtime.
    for (let i = 0; i < 20; i++) {
      expect(gate.record('m', 'failed', 'boom')).toBeUndefined();
    }
  });

  it('resets on recovery, so a LATER outage is reported again', () => {
    const gate = createFailureStreakGate(2);
    gate.record('m', 'failed', 'boom');
    expect(gate.record('m', 'failed', 'boom')).toBeDefined();

    gate.record('m', 'ok');

    // A channel that went permanently quiet after its first bad day would be
    // worse than none at all.
    gate.record('m', 'failed', 'boom again');
    expect(gate.record('m', 'failed', 'boom again')).toMatchObject({
      consecutiveFailures: 2,
      lastError: 'boom again',
    });
  });

  it('counts each mapping separately', () => {
    const gate = createFailureStreakGate(2);
    gate.record('a', 'failed', 'x');
    // b's first failure must not be pushed over the line by a's.
    expect(gate.record('b', 'failed', 'y')).toBeUndefined();
    expect(gate.record('a', 'failed', 'x')).toMatchObject({ mappingId: 'a' });
  });

  it('says so rather than sending an empty reason when none was recorded', () => {
    const gate = createFailureStreakGate(1);
    expect(gate.record('m', 'failed')).toMatchObject({
      lastError: 'no error message was recorded',
    });
  });
});

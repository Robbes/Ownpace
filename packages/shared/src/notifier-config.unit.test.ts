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
  digestSchedule,
  DIGEST_CRON,
  type MailTransport,
} from './notifications.ts';

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

describe('the digest cadence (NOTIFY_DIGEST)', () => {
  const digests = (value?: string) => {
    const config = readNotifierConfig(value === undefined ? FULL : { ...FULL, NOTIFY_DIGEST: value });
    return config.enabled ? config.digests : undefined;
  };

  it('sends the daily summary when nothing was asked for', () => {
    // The default has to be ON: somebody who configured SMTP and stopped
    // reading the docs wanted to be told things.
    expect(digests()).toEqual(['daily']);
  });

  it('takes weekly, both, and off at their word', () => {
    expect(digests('weekly')).toEqual(['weekly']);
    expect(digests('both')).toEqual(['daily', 'weekly']);
    expect(digests('off')).toEqual([]);
    expect(digests('none')).toEqual([]);
  });

  it('accepts either order of the comma form', () => {
    expect(digests('daily,weekly')).toEqual(['daily', 'weekly']);
    expect(digests('weekly,daily')).toEqual(['daily', 'weekly']);
  });

  it('ignores case and stray whitespace', () => {
    expect(digests('  WEEKLY ')).toEqual(['weekly']);
    expect(digests('Off')).toEqual([]);
  });

  it('falls back to daily on a typo rather than silently going quiet', () => {
    // The asymmetry is deliberate. A typo that produces one email a day is a
    // visible mistake somebody fixes; a typo that produces silence is the
    // failure nobody notices until the migration has been stuck for a month.
    expect(digests('dayly')).toEqual(['daily']);
    expect(digests('')).toEqual(['daily']);
  });

  it('leaves the ad hoc events alone when the digest is off', () => {
    const config = readNotifierConfig({ ...FULL, NOTIFY_DIGEST: 'off' });
    // Still enabled: "no summary" and "no notifications" are different asks,
    // and wanting the interruptions without the weekly recap is reasonable.
    expect(config.enabled).toBe(true);
  });
});

describe('which digest jobs get registered', () => {
  it('schedules nothing at all when the channel is off', () => {
    // Not "schedules a job that discovers it every morning": a disabled
    // channel with a live cron would log a failure daily for a box whose
    // owner never asked for email in the first place.
    expect(digestSchedule({ enabled: false, reason: 'no SMTP settings configured' })).toEqual([]);
  });

  it('schedules nothing when the digest is switched off', () => {
    expect(digestSchedule(readNotifierConfig({ ...FULL, NOTIFY_DIGEST: 'off' }))).toEqual([]);
  });

  it('pairs each cadence with its morning cron', () => {
    expect(digestSchedule(readNotifierConfig({ ...FULL, NOTIFY_DIGEST: 'both' }))).toEqual([
      { cadence: 'daily', cron: '0 8 * * *' },
      { cadence: 'weekly', cron: '0 8 * * 1' },
    ]);
  });

  it('sends both digests in the morning, and the weekly one on Monday', () => {
    // Pinned because the value is a judgement, not an implementation detail:
    // a summary delivered at 03:00 is read twelve hours late, and a weekly
    // recap that lands on Friday afternoon is history rather than a to-do.
    expect(DIGEST_CRON.daily.startsWith('0 8 ')).toBe(true);
    expect(DIGEST_CRON.weekly).toBe('0 8 * * 1');
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

describe('SMTP_ALLOW_SELF_SIGNED (0043 T1)', () => {
  const base = {
    SMTP_HOST: 'mail.example',
    NOTIFY_FROM: 'openmig@example',
    NOTIFY_TO: 'owner@example',
  };

  it('carries the setting through when it is explicitly true', () => {
    // The reason it exists: the integration harness's Stalwart presents a
    // self-signed certificate, and without this nothing could prove this
    // product sends mail at all.
    const config = readNotifierConfig({ ...base, SMTP_ALLOW_SELF_SIGNED: 'true' });
    expect(config.enabled).toBe(true);
    expect(config.enabled && config.smtp.allowSelfSignedCertificate).toBe(true);
  });

  it('is off unless the value is exactly "true"', () => {
    // Nothing should switch certificate checking off by accident — not '1',
    // not 'yes', not 'TRUE'.
    for (const raw of ['1', 'yes', 'TRUE', 'on', '']) {
      const config = readNotifierConfig({ ...base, SMTP_ALLOW_SELF_SIGNED: raw });
      expect(config.enabled && config.smtp.allowSelfSignedCertificate).toBeUndefined();
    }
  });

  it('is absent entirely when nobody asked', () => {
    const config = readNotifierConfig(base);
    expect(config.enabled && config.smtp.allowSelfSignedCertificate).toBeUndefined();
  });

  it('REFUSES the whole channel in production rather than trusting any certificate', () => {
    // The guard that makes the escape hatch safe to ship. Losing notifications
    // is the safer failure, and since T3 it is a visible one — /status reports
    // the channel off with this reason.
    const config = readNotifierConfig({
      ...base,
      SMTP_ALLOW_SELF_SIGNED: 'true',
      NODE_ENV: 'production',
    });

    expect(config.enabled).toBe(false);
    expect(!config.enabled && config.reason).toContain('SMTP_ALLOW_SELF_SIGNED');
    expect(!config.enabled && config.reason).toContain('production');
  });

  it('leaves production alone when the switch is not set', () => {
    // The guard must not cost anybody their notifications for being in
    // production, which is the ordinary case.
    const config = readNotifierConfig({ ...base, NODE_ENV: 'production' });
    expect(config.enabled).toBe(true);
  });
});


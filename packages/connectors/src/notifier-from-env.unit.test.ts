// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Both editions build the channel the same way (workplan 0030 T4).
 *
 * The rule this pins is not "it constructs an object" — it is that an
 * UNCONFIGURED environment produces a working notifier rather than a missing
 * one, and an announcement that says WHY. The appliance and the managed
 * rollback job both depend on that: neither has anywhere sensible to handle
 * "there is no channel today", and a caller that must check first is a caller
 * that will one day forget to.
 */

import { describe, it, expect } from 'vitest';
import { notifierFromEnv } from './notifier-from-env';

const FULL = {
  SMTP_HOST: 'smtp.example.nl',
  NOTIFY_FROM: 'openmigrate@example.nl',
  NOTIFY_TO: 'owner@example.nl',
};

describe('an unconfigured environment', () => {
  it('still hands back a notifier that accepts and does not throw', async () => {
    const said: string[] = [];
    const channel = notifierFromEnv({}, (m) => said.push(m));

    expect(channel.config.enabled).toBe(false);
    await expect(channel.notifier.notify({ subject: 's', body: 'b' })).resolves.toBeUndefined();
    expect(said[0]).toContain('not sending');
  });

  it('announces OFF with the reason, not just OFF', () => {
    const channel = notifierFromEnv({}, () => {});
    expect(channel.announcement).toContain('OFF');
    expect(channel.announcement).toContain('no SMTP settings configured');
  });

  it('names what is missing when somebody half-configured it', () => {
    const channel = notifierFromEnv({ SMTP_HOST: 'smtp.example.nl' }, () => {});
    expect(channel.config.enabled).toBe(false);
    expect(channel.announcement).toContain('NOTIFY_TO');
  });

  it('falls back to English rather than leaving the locale undefined', () => {
    // Callers pass `channel.locale` straight into `renderEvent`. An undefined
    // here would be a crash at the moment somebody most needs the email.
    expect(notifierFromEnv({}, () => {}).locale).toBe('en');
  });
});

describe('a configured environment', () => {
  it('announces ON with the recipients and the server it will use', () => {
    const channel = notifierFromEnv(FULL, () => {});
    expect(channel.config.enabled).toBe(true);
    expect(channel.announcement).toContain('ON');
    expect(channel.announcement).toContain('owner@example.nl');
    // The host and port are in the line on purpose: "notifications are on" is
    // not a useful thing to read in a log when the box has three mail relays.
    expect(channel.announcement).toContain('smtp.example.nl:587');
  });

  it('carries the configured locale through to the renderer', () => {
    expect(notifierFromEnv({ ...FULL, NOTIFY_LOCALE: 'nl' }, () => {}).locale).toBe('nl');
  });
});

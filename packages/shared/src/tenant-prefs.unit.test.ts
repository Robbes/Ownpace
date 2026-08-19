// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Per-tenant notification preferences (workplan 0030 T4).
 *
 * Two properties carry the weight here, and both are about what happens when
 * the stored value is NOT what we expect:
 *
 *  - an unreadable preference falls back to the default, never to silence.
 *    A hand-edited row, an older shape, a typo — none of those may be the
 *    reason somebody stops hearing about their own migration.
 *  - writing a preference MERGES. `tenant.settings` holds other things (the
 *    slug, whatever comes next), and a cadence change that replaced the
 *    object would be silent data loss nobody notices until it matters.
 */

import { describe, it, expect } from 'vitest';
import {
  readTenantNotificationPrefs,
  withTenantNotificationPrefs,
  digestDueToday,
  DEFAULT_TENANT_NOTIFICATION_PREFS,
} from './notifications.ts';

describe('reading a stored preference', () => {
  it('takes what was stored', () => {
    expect(
      readTenantNotificationPrefs({ notifications: { digest: 'daily', locale: 'nl' } }),
    ).toEqual({ digest: 'daily', locale: 'nl' });
  });

  it('defaults when nothing was ever stored', () => {
    expect(readTenantNotificationPrefs({})).toEqual(DEFAULT_TENANT_NOTIFICATION_PREFS);
    expect(readTenantNotificationPrefs(null)).toEqual(DEFAULT_TENANT_NOTIFICATION_PREFS);
    expect(readTenantNotificationPrefs(undefined)).toEqual(DEFAULT_TENANT_NOTIFICATION_PREFS);
  });

  it('defaults ON — a tenant that never chose still hears from us', () => {
    // The alternative would be a product that emails nobody until somebody
    // finds the setting, which is the same as not having the channel.
    expect(DEFAULT_TENANT_NOTIFICATION_PREFS.digest).not.toBe('off');
  });

  it('survives a settings blob that is not an object at all', () => {
    expect(readTenantNotificationPrefs('nonsense')).toEqual(DEFAULT_TENANT_NOTIFICATION_PREFS);
    expect(readTenantNotificationPrefs({ notifications: 'weekly' })).toEqual(
      DEFAULT_TENANT_NOTIFICATION_PREFS,
    );
  });

  it('falls back to the DEFAULT on an unreadable cadence, never to off', () => {
    const prefs = readTenantNotificationPrefs({ notifications: { digest: 'fortnightly' } });
    expect(prefs.digest).toBe(DEFAULT_TENANT_NOTIFICATION_PREFS.digest);
    expect(prefs.digest).not.toBe('off');
  });

  it('honours an explicit off — that IS a choice', () => {
    expect(readTenantNotificationPrefs({ notifications: { digest: 'off' } }).digest).toBe('off');
  });

  it('takes English for an unknown language rather than failing', () => {
    expect(readTenantNotificationPrefs({ notifications: { locale: 'klingon' } }).locale).toBe('en');
  });
});

describe('writing a preference', () => {
  it('keeps every other key in settings', () => {
    const merged = withTenantNotificationPrefs(
      { slug: 'acme', maxMappings: 5 },
      { digest: 'weekly', locale: 'nl' },
    );
    expect(merged.slug).toBe('acme');
    expect(merged.maxMappings).toBe(5);
    expect(merged.notifications).toEqual({ digest: 'weekly', locale: 'nl' });
  });

  it('replaces the previous preference rather than merging into it', () => {
    // Half-applying a preference — a new cadence beside an old language —
    // would store a setting nobody chose.
    const merged = withTenantNotificationPrefs(
      { notifications: { digest: 'daily', locale: 'nl' } },
      { digest: 'off', locale: 'en' },
    );
    expect(merged.notifications).toEqual({ digest: 'off', locale: 'en' });
  });

  it('copes with settings that were never an object', () => {
    expect(withTenantNotificationPrefs(null, { digest: 'daily', locale: 'en' })).toEqual({
      notifications: { digest: 'daily', locale: 'en' },
    });
  });

  it('round-trips through the reader', () => {
    const prefs = { digest: 'weekly', locale: 'nl' } as const;
    expect(readTenantNotificationPrefs(withTenantNotificationPrefs({}, prefs))).toEqual(prefs);
  });
});

describe('whose day is today', () => {
  const MONDAY = 1;
  const THURSDAY = 4;
  const SUNDAY = 0;

  it('sends a daily digest every day', () => {
    for (const day of [SUNDAY, MONDAY, THURSDAY]) {
      expect(digestDueToday({ digest: 'daily', locale: 'en' }, day)).toBe('daily');
    }
  });

  it('sends a weekly digest on Monday and no other day', () => {
    // Monday, so a week's queue lands at the start of a working week rather
    // than at the end of one.
    expect(digestDueToday({ digest: 'weekly', locale: 'en' }, MONDAY)).toBe('weekly');
    expect(digestDueToday({ digest: 'weekly', locale: 'en' }, THURSDAY)).toBeUndefined();
    expect(digestDueToday({ digest: 'weekly', locale: 'en' }, SUNDAY)).toBeUndefined();
  });

  it('sends nothing when the tenant turned the summary off', () => {
    for (const day of [SUNDAY, MONDAY, THURSDAY]) {
      expect(digestDueToday({ digest: 'off', locale: 'en' }, day)).toBeUndefined();
    }
  });
});

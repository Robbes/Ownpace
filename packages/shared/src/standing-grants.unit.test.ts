// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The permission only the customer can take back (workplan 0085 T4b).
 *
 * Two properties, and the second is the one that keeps this honest:
 *
 *  1. the reminder appears for the providers where a grant really does persist;
 *  2. it does NOT appear for the ones where it does not. A reminder attached to
 *     a plain IMAP password — which has no consent object in any console —
 *     would be noise, and noise is how people learn to skim past the reminders
 *     that matter.
 */

import { describe, it, expect } from 'vitest';
import {
  standingGrantsFor,
  standingGrantReminders,
  leavesAStandingGrant,
  kindsWithStandingGrants,
} from './standing-grants';

describe('standing grants', () => {
  it('names a grant for the providers that keep one', () => {
    // The four where consent outlives the token: an Entra admin consent, a
    // Google account authorization, a Dropbox app link, a Box admin auth.
    expect([...kindsWithStandingGrants()].sort()).toEqual(['box', 'dropbox', 'gmail', 'o365']);
  });

  it('says nothing about a password-based connection', () => {
    // No consent object exists for these. Inventing one would be a reminder to
    // go and remove something that is not there.
    for (const kind of ['imap', 'caldav', 'carddav', 'webdav', 'jmap', 'nextcloud']) {
      expect(leavesAStandingGrant(kind), kind).toBe(false);
    }
    expect(standingGrantsFor(['imap', 'jmap'])).toEqual([]);
  });

  it('returns nothing at all when nothing applies', () => {
    // So a caller renders no section, rather than an empty heading.
    expect(standingGrantReminders(['imap'], 'en')).toEqual([]);
    expect(standingGrantReminders([], 'nl')).toEqual([]);
  });

  it('reminds only about the providers this tenant actually used', () => {
    const reminders = standingGrantReminders(['o365', 'imap'], 'en');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.body).toMatch(/Microsoft Entra/);
  });

  it('is bilingual, and the destination is not translated', () => {
    for (const kind of kindsWithStandingGrants()) {
      const [en] = standingGrantReminders([kind], 'en');
      const [nl] = standingGrantReminders([kind], 'nl');
      expect(en, kind).toBeDefined();
      expect(nl, kind).toBeDefined();
      expect(nl!.body, kind).not.toBe(en!.body);
      // `where` is a URL or a path through somebody else's console — the same
      // rule as a credential field name: it is the literal thing to go to.
      expect(nl!.where, kind).toBe(en!.where);
      expect(nl!.heading, kind).toBe(en!.heading);
    }
  });

  it('tells the person it is theirs to do, not ours', () => {
    // The whole point. Every message has to make clear the grant persists until
    // THEY remove it — a "revoke access" button that only deleted our row would
    // leave the grant standing while saying it was gone.
    for (const kind of kindsWithStandingGrants()) {
      const [en] = standingGrantReminders([kind], 'en');
      expect(en!.body, kind).toMatch(/stays|remains/i);
      expect(en!.body, kind).toMatch(/until (you|an administrator)/i);
    }
  });
});

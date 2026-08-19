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
  grantIds,
  identifiersWithStandingGrants,
  credentialRetirementsFor,
  identifiersWithRetirableCredentials,
  accessThatOutlivesErasure,
} from './standing-grants.ts';

describe('standing grants', () => {
  it('names a grant for the providers that keep one', () => {
    // The four where consent outlives the token: an Entra admin consent, a
    // Google account authorization, a Dropbox app link, a Box admin auth.
    expect([...grantIds()].sort()).toEqual(['box', 'dropbox', 'google', 'microsoft']);
  });

  it('answers in BOTH vocabularies, because this product uses both', () => {
    // A stored `connection.kind` and a wizard source type name the same
    // provider differently, and they do not line up. Keying on one would have
    // made the reminder silently never fire for callers holding the other —
    // the customer told nothing, and nothing looking wrong.
    expect(standingGrantsFor(['o365'])[0]?.id).toBe('microsoft');
    expect(standingGrantsFor(['graph'])[0]?.id).toBe('microsoft');
    expect(standingGrantsFor(['oauth2'])[0]?.id).toBe('microsoft');
    expect(standingGrantsFor(['google_drive'])[0]?.id).toBe('google');
    expect(standingGrantsFor(['google-drive'])[0]?.id).toBe('google');
  });

  it('reminds once per grant, not once per connector', () => {
    // Three Google connectors share ONE account authorization. Three reminders
    // pointing at the same page would teach the reader to skim.
    const reminders = standingGrantReminders(
      ['gmail', 'google_drive', 'google_calendar'],
      'en',
    );
    expect(reminders).toHaveLength(1);
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
    for (const kind of identifiersWithStandingGrants()) {
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
    for (const kind of identifiersWithStandingGrants()) {
      const [en] = standingGrantReminders([kind], 'en');
      expect(en!.body, kind).toMatch(/stays|remains/i);
      expect(en!.body, kind).toMatch(/until (you|an administrator)/i);
    }
  });
});

describe('the completion report carries it (workplan 0085 T4b)', () => {
  it('names the grant on a finished Microsoft → JMAP migration', async () => {
    const { buildCompletionReport, renderCompletionReportMarkdown } = await import(
      './completion-report.ts'
    );
    const report = buildCompletionReport({
      mappingId: 'm1',
      sourceType: 'graph',
      targetType: 'jmap',
      lifecycle: 'done',
      generatedAt: '2026-08-18T12:00:00.000Z',
      domains: [{ domain: 'email', state: 'completed' } as never],
      moves: [],
      deletions: [],
      failures: [],
    });
    expect(report.standingGrants.map((g) => g.id)).toEqual(['microsoft']);

    const md = renderCompletionReportMarkdown(report);
    // The section exists, and says whose job it is.
    expect(md).toContain('Access you granted, which only you can withdraw');
    expect(md).toContain('We cannot do this for you');
    expect(md).toContain('entra.microsoft.com');
  });

  const reportFor = async (sourceType: string, targetType: string) => {
    const { buildCompletionReport, renderCompletionReportMarkdown } = await import(
      './completion-report.ts'
    );
    const report = buildCompletionReport({
      mappingId: 'm2',
      sourceType,
      targetType,
      lifecycle: 'done',
      generatedAt: '2026-08-18T12:00:00.000Z',
      domains: [{ domain: 'email', state: 'completed' } as never],
      moves: [],
      deletions: [],
      failures: [],
    });
    return { report, md: renderCompletionReportMarkdown(report) };
  };

  it('an IMAP-only migration is reminded about the password, not passed over', async () => {
    // This test used to assert the opposite, on the reasoning that a password
    // connection leaves "no consent object sitting in a console". True, and
    // beside the point (owner, 2026-08-18): the app password we were given
    // still authenticates after we delete our copy, so somebody finishing an
    // IMAP migration is exactly who needs telling.
    const { report, md } = await reportFor('imap', 'imap');

    // No CONSENT — that part of the old reasoning was right.
    expect(report.standingGrants).toEqual([]);
    // But there is something outstanding, and it is a password.
    expect(report.outlivingAccess.map((a) => a.category)).toEqual(['credential']);
    expect(md).toContain('Access you granted, which only you can withdraw');
    expect(md).toContain('Passwords that still work');
    expect(md).toMatch(/app password/i);
  });

  it('shows passwords above permissions when a migration leaves both', async () => {
    const { md } = await reportFor('imap', 'graph');
    expect(md.indexOf('Passwords that still work')).toBeLessThan(
      md.indexOf('Permissions you granted'),
    );
  });

  it('says nothing when nothing is left behind', async () => {
    // No empty heading: a section with nothing under it reads as a bug and
    // trains people to skim past the real ones. Note this needs an
    // UNRECOGNISED type — every connection kind the schema actually allows now
    // leaves either a consent or a credential, which is the point.
    const { report, md } = await reportFor('nothing_we_know_of', 'nothing_we_know_of');

    expect(report.outlivingAccess).toEqual([]);
    expect(md).not.toContain('only you can withdraw');
  });
});

// ---------------------------------------------------------------------------
/**
 * The credential half (owner's finding, 2026-08-18).
 *
 * The consent list used to be the whole story, on the reasoning that a
 * password connection has "no consent object sitting in a console". True, and
 * beside the point: there is very often a **credential** object — an app
 * password we deleted our copy of that still authenticates. The risk is the
 * same shape, so the reminder has to exist.
 */
describe('credentials that outlive our erasure', () => {
  it.each(['nextcloud', 'proton', 'imap', 'jmap', 'caldav', 'carddav', 'webdav', 'selfhosted_mail', 'soverin'])(
    '%s leaves a credential the customer has to retire',
    (kind) => {
      const found = credentialRetirementsFor([kind]);
      expect(found, `${kind} has no retirement entry`).toHaveLength(1);
      expect(found[0]!.where.length).toBeGreaterThan(10);
    },
  );

  it('every password-shaped connection kind is covered', () => {
    // The coverage lock. A kind added to the schema without an entry here is a
    // credential nobody is ever told about — silent, and indistinguishable
    // from "nothing to do".
    const PASSWORD_KINDS = [
      'imap', 'jmap', 'caldav', 'carddav', 'webdav',
      'nextcloud', 'proton', 'soverin', 'selfhosted_mail',
    ];
    const covered = new Set(identifiersWithRetirableCredentials());
    expect(PASSWORD_KINDS.filter((k) => !covered.has(k))).toEqual([]);
  });

  it('says the credential STILL WORKS, which is the whole point', () => {
    for (const kind of ['imap', 'nextcloud', 'proton', 'webdav']) {
      const [item] = credentialRetirementsFor([kind]);
      expect(item!.en, kind).toMatch(/still works|keeps working/i);
    }
  });

  it('the vague ones name what to look for, since we cannot name the screen', () => {
    // We do not know which mail provider they use. We do know what the thing
    // is called, and that is the half they cannot supply.
    const [item] = credentialRetirementsFor(['imap']);
    expect(item!.where).toMatch(/app password/i);
    expect(item!.en).toMatch(/belongs to your provider/i);
  });

  it('deduplicates, so one Google-shaped answer is not repeated per domain', () => {
    expect(credentialRetirementsFor(['caldav', 'carddav', 'webdav'])).toHaveLength(1);
  });

  it('an OAuth kind leaves a consent, not a credential', () => {
    expect(credentialRetirementsFor(['o365'])).toEqual([]);
    expect(credentialRetirementsFor(['gmail'])).toEqual([]);
  });
});

describe('accessThatOutlivesErasure', () => {
  it('puts credentials before consents', () => {
    // A consent is a permission sitting unused; a live app password is a
    // working way in. If somebody reads one item and stops, it should be that.
    const items = accessThatOutlivesErasure(['o365', 'imap'], 'en');

    expect(items.map((i) => i.category)).toEqual(['credential', 'consent']);
  });

  it('returns both halves for a tenant that used both', () => {
    const items = accessThatOutlivesErasure(['gmail', 'nextcloud'], 'en');
    expect(items.map((i) => i.id).sort()).toEqual(['google', 'nextcloud']);
  });

  it('is empty when nothing applies, so no empty heading is rendered', () => {
    expect(accessThatOutlivesErasure(['something_unknown'], 'en')).toEqual([]);
  });

  it('translates the frame in Dutch and keeps the provider label verbatim', () => {
    const [nl] = accessThatOutlivesErasure(['nextcloud'], 'nl');
    const [en] = accessThatOutlivesErasure(['nextcloud'], 'en');

    expect(nl!.body).not.toBe(en!.body);
    expect(nl!.body).toMatch(/app-wachtwoord/);
    // The screen name is a label on their screen — never translated.
    expect(nl!.heading).toBe(en!.heading);
  });
});

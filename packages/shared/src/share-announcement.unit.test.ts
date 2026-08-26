// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The fallback digest (0104 T3) — what these hold, in cost order:
 *
 *  1. AUDIENCE: only `done_manual` rows are mailed about. `applied` rows the
 *     platform already announced; `skipped` rows carry no access to announce;
 *     `open` rows are not settled — a digest about them would announce work
 *     not done.
 *  2. LEAST DISCLOSURE (§17): one mail per grantee, THEIR items only.
 *  3. The unaddressable are COUNTED, never silently dropped — "announced"
 *     must not quietly mean "announced to the addressable".
 *  4. The note is in the body: the "where" comes from the person who carried
 *     the share by hand, or the mail is noise with a subject line.
 */

import { describe, it, expect } from 'vitest';
import type { ShareGrantRow } from './ports.ts';
import {
  SHARE_ANNOUNCEMENT_SUBJECTS,
  assembleShareAnnouncements,
  renderShareAnnouncement,
} from './share-announcement.ts';

let seq = 0;
function row(partial: Partial<ShareGrantRow>): ShareGrantRow {
  seq += 1;
  return {
    id: `g-${seq}`,
    grantHash: `h-${seq}`,
    subject: 'drive_item',
    onLabel: 'Projects/budget.xlsx',
    role: 'reader',
    viaLink: false,
    raw: '{}',
    verdict: 'clean',
    verdictTarget: 'a share on the target',
    state: 'open',
    scannedAt: '2026-08-26T06:00:00Z',
    ...partial,
  };
}

describe('assembleShareAnnouncements', () => {
  it('mails about done_manual rows only — the platform spoke for applied, skipped carries no access', () => {
    const assembly = assembleShareAnnouncements([
      row({ state: 'done_manual', grantee: 'anna@example.nl' }),
      row({ state: 'applied', grantee: 'bram@example.nl' }),
      row({ state: 'skipped', grantee: 'carla@example.nl' }),
      row({ state: 'open', grantee: 'dirk@example.nl' }),
    ]);

    expect(assembly.digests.map((d) => d.grantee)).toEqual(['anna@example.nl']);
    expect(assembly.platformAnnounced).toBe(1);
  });

  it('one digest per grantee, their items only, both orders deterministic', () => {
    const assembly = assembleShareAnnouncements([
      row({ state: 'done_manual', grantee: 'zoe@example.nl', onLabel: 'B-plan.docx' }),
      row({ state: 'done_manual', grantee: 'anna@example.nl', onLabel: 'Budget.xlsx', role: 'writer' }),
      row({ state: 'done_manual', grantee: 'zoe@example.nl', onLabel: 'A-notes.md' }),
    ]);

    expect(assembly.digests.map((d) => d.grantee)).toEqual(['anna@example.nl', 'zoe@example.nl']);
    expect(assembly.digests[1]!.items.map((i) => i.on)).toEqual(['A-notes.md', 'B-plan.docx']);
    // Anna's digest knows nothing about Zoe's items.
    expect(assembly.digests[0]!.items).toEqual([{ on: 'Budget.xlsx', role: 'writer' }]);
  });

  it('counts the unaddressable instead of dropping them', () => {
    const assembly = assembleShareAnnouncements([
      row({ state: 'done_manual', viaLink: true }), // a link, handled by hand — no address exists
      row({ state: 'done_manual', grantee: 'anna@example.nl' }),
    ]);

    expect(assembly.withoutAddress).toBe(1);
    expect(assembly.digests).toHaveLength(1);
  });
});

describe('renderShareAnnouncement — Template 6', () => {
  const digest = {
    grantee: 'anna@example.nl',
    items: [{ on: 'Projects/budget.xlsx', role: 'writer' }],
  };

  it('carries the note, the items and the once-sentence, in both languages', () => {
    for (const locale of ['en', 'nl'] as const) {
      const message = renderShareAnnouncement(digest, locale, 'Everything now lives at Team Cloud.');
      expect(message.subject).toBe(SHARE_ANNOUNCEMENT_SUBJECTS[locale]);
      expect(message.body).toContain('Everything now lives at Team Cloud.');
      expect(message.body).toContain('Projects/budget.xlsx (writer)');
    }
    expect(renderShareAnnouncement(digest, 'en', 'x').body).toContain('You receive this message once');
    expect(renderShareAnnouncement(digest, 'nl', 'x').body).toContain('U ontvangt dit bericht eenmalig');
  });

  it('the doc shows what the code sends — Template 6 subjects pinned to the templates file', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const doc = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..', '..', '..', 'docs', 'cutover-communication-templates.md',
      ),
      'utf8',
    );
    expect(doc).toContain(SHARE_ANNOUNCEMENT_SUBJECTS.en);
    expect(doc).toContain(SHARE_ANNOUNCEMENT_SUBJECTS.nl);
  });
});

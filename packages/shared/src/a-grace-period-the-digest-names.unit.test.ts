// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE DIGEST NAMES A GRACE PERIOD NOBODY CHOSE AT (workplan 0128 D7, T5
 * slice 7c).
 *
 * The owner's D7: when a grace period ends and nobody chose, copying stops,
 * and the organisation's *what needs attention* digest says so, beside the
 * Finish page. So a migration whose only news is that is sent on its own, its
 * line names each data type in the reader's language, and a migration with
 * none says nothing of it.
 */

import { describe, it, expect } from 'vitest';
import { renderDigest, summariseQueues, wantsAttention, type QueueReads } from './notifications.ts';

const quiet: QueueReads = {
  deletions: [],
  moves: [],
  failures: [],
  pendingDecisions: 0,
  status: 'cutover',
  blindSpots: [],
};

describe('a grace period nobody chose at, in the digest', () => {
  it('is carried, and is on its own reason enough to send', () => {
    const m = summariseQueues({ id: 'm-1', name: 'Acme' }, { ...quiet, status: 'active', graceEnded: ['email', 'file'] });
    expect(m.graceEnded).toEqual(['email', 'file']);
    expect(m.readyForCutover).toBe(false);
    expect(wantsAttention(m)).toBe(true);
  });

  it('is left out when there is none, and then asks nobody', () => {
    const m = summariseQueues({ id: 'm-1' }, { ...quiet, status: 'active', graceEnded: [] });
    expect('graceEnded' in m).toBe(false);
    expect(wantsAttention(m)).toBe(false);
  });

  it('names each data type in the reader’s language', () => {
    const m = summariseQueues({ id: 'm-1', name: 'Acme' }, { ...quiet, graceEnded: ['email', 'calendar'] });
    const en = renderDigest([m], 'en', 'daily')!.body;
    expect(en).toContain('Migration: Acme');
    expect(en).toContain(
      '  - grace period over and nobody chose, so no longer copying (end each, or keep it copying, on the Finish page): Email, Calendar',
    );
    const nl = renderDigest([m], 'nl', 'daily')!.body;
    expect(nl).toContain(
      '  - overgangsperiode voorbij en niets gekozen, dus kopieert niet meer (beëindig elk, of laat het blijven kopiëren, op de afrondpagina): E-mail, Agenda',
    );
  });
});

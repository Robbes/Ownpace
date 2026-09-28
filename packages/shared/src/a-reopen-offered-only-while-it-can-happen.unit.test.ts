// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REOPEN OFFERED ONLY WHILE IT CAN HAPPEN (workplan 0085 T2; a review of
 * 2026-09-28).
 *
 * Every door a closed organisation presses answers with one sentence, in
 * English and Dutch: the day of the close, the day its data is removed, and,
 * only while that day is still ahead, that its owner can reopen it
 * (`reopenTenant` refuses once the window has run out, and a window of 0 has
 * none). The door guard checked the two days in English and one in Dutch, and
 * nothing checked the reopen clause, so it could have been flipped or dropped
 * in either language with every guard green. These fix it, with `now` stated.
 */

import { describe, it, expect } from 'vitest';
import { ACCOUNT_CLOSED, organisationClosedRefusal } from './organisation-closed.ts';

const NOW = new Date('2026-09-28T12:00:00Z');
const CLOSED = new Date('2026-09-28T10:00:00Z');
const IN_30_DAYS = new Date('2026-10-28T10:00:00Z');

const REOPEN_EN = 'Until then, its owner can reopen it.';
const REOPEN_NL = 'Tot dan kan de eigenaar haar heropenen.';

describe('the sentence a closed organisation is refused with', () => {
  it('with a window still open: both days in both languages, and the reopen', () => {
    const refusal = organisationClosedRefusal({ closedAt: CLOSED, purgeAfter: IN_30_DAYS }, NOW);
    expect(refusal.code).toBe(ACCOUNT_CLOSED);
    expect(refusal.en).toBe(
      'This organisation was closed on 2026-09-28. Nothing is started, and nothing uses the access it gave. ' +
        'Its data is removed from the service on 2026-10-28. ' +
        REOPEN_EN,
    );
    expect(refusal.nl).toBe(
      'Deze organisatie is op 2026-09-28 gesloten. Er wordt niets gestart, en niets gebruikt de toegang die zij gaf. ' +
        'De gegevens worden op 2026-10-28 uit de dienst verwijderd. ' +
        REOPEN_NL,
    );
  });

  it('with a window of 0: the removal is named, and no reopen is offered in either language', () => {
    // `closeTenant` sets `purge_after` to the moment of the close.
    const refusal = organisationClosedRefusal({ closedAt: CLOSED, purgeAfter: CLOSED }, NOW);
    expect(refusal.en).toContain('closed on 2026-09-28');
    expect(refusal.en).toContain('removed from the service on 2026-09-28');
    expect(refusal.nl).toContain('op 2026-09-28 gesloten');
    expect(refusal.nl).toContain('op 2026-09-28 uit de dienst verwijderd');
    expect(refusal.en).not.toContain(REOPEN_EN);
    expect(refusal.nl).not.toContain(REOPEN_NL);
  });

  it('on the very moment of the removal, and after it: no reopen', () => {
    for (const now of [IN_30_DAYS, new Date('2026-10-29T00:00:00Z')]) {
      const refusal = organisationClosedRefusal({ closedAt: CLOSED, purgeAfter: IN_30_DAYS }, now);
      expect(refusal.en, now.toISOString()).not.toContain(REOPEN_EN);
      expect(refusal.nl, now.toISOString()).not.toContain(REOPEN_NL);
      expect(refusal.en).toContain('2026-10-28');
    }
  });

  it('without its days, as a builder says it: the dateless sentence, and no reopen', () => {
    const refusal = organisationClosedRefusal({ closedAt: null, purgeAfter: null }, NOW);
    expect(refusal.en).toBe('This organisation was closed. Nothing is started, and nothing uses the access it gave.');
    expect(refusal.nl).toBe('Deze organisatie is gesloten. Er wordt niets gestart, en niets gebruikt de toegang die zij gaf.');
  });

  it('names each day by its UTC date, the same in both languages, whatever the machine’s zone', () => {
    // 01:30 UTC on the 29th is still the 28th in São Paulo. Run there, so a
    // local date would show; a machine on UTC could not tell them apart.
    const zone = process.env.TZ;
    process.env.TZ = 'America/Sao_Paulo';
    try {
      const late = new Date('2026-09-29T01:30:00Z');
      expect(late.getDate(), 'the zone did not take').toBe(28);
      const refusal = organisationClosedRefusal({ closedAt: late, purgeAfter: IN_30_DAYS }, NOW);
      expect(refusal.en).toContain('closed on 2026-09-29');
      expect(refusal.nl).toContain('op 2026-09-29 gesloten');
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});

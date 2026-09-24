// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANT TAKEN BACK (workplan 0108 T8 (c)): what the two readers are told.
 *
 *  - the progress page offers to take back only a grant given through a link,
 *    and says when one was taken back, which wins over anything else the row
 *    holds;
 *  - the owner's refusal names the day in UTC, in both languages, and says
 *    what brings the migration back.
 */

import { describe, it, expect } from 'vitest';
import { grantWithdrawnRefusal } from './grant-withdrawal.ts';
import { viewGrantFor } from './migration-view.ts';

const AT = new Date('2026-09-24T23:30:00.000Z');

describe('what the progress page says about the grant', () => {
  it('offers to withdraw a grant the migration reads the account on', () => {
    expect(viewGrantFor({ sourceSecretRef: 'sealed', grantWithdrawnAt: null })).toEqual({ state: 'granted' });
  });

  it('offers nothing where there is no grant to take back', () => {
    expect(viewGrantFor({ sourceSecretRef: null, grantWithdrawnAt: null })).toEqual({ state: 'none' });
  });

  it('says when it was withdrawn, and that wins over a token still on the row', () => {
    const withdrawn = { state: 'withdrawn', withdrawnAt: AT.toISOString() };

    expect(viewGrantFor({ sourceSecretRef: null, grantWithdrawnAt: AT })).toEqual(withdrawn);
    expect(viewGrantFor({ sourceSecretRef: 'sealed', grantWithdrawnAt: AT })).toEqual(withdrawn);
  });
});

describe('what the owner is told', () => {
  it('names the day in UTC, in both languages, and what brings the migration back', () => {
    const refusal = grantWithdrawnRefusal(AT);

    expect(refusal.code).toBe('grant_withdrawn');
    expect(refusal.fields).toEqual([]);
    expect(refusal.en).toBe(
      'The person being migrated withdrew their permission on 2026-09-24, so nothing reads ' +
        'their account. Send them a new grant link if they agree to continue.',
    );
    expect(refusal.nl).toBe(
      'Degene die gemigreerd wordt heeft op 2026-09-24 de toegang ingetrokken, dus er wordt ' +
        'niets meer uit het account gelezen. Stuur een nieuwe toegangslink als die persoon ' +
        'akkoord is om verder te gaan.',
    );
  });
});

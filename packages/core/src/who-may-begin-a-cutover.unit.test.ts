// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHO MAY BEGIN A CUTOVER (workplan 0128 T5, slice 5b).
 *
 * Once a data type can be cut over on its own, a migration has more than one
 * cutover ledger: the whole migration's, and each data type's own (slice 4).
 * Two rules keep them apart. A data type's own may not begin while the whole
 * migration's is under way, since it reads that one as its own; and the whole
 * migration's may not begin once a data type has its own, since a rollback of
 * it would then move back a data type cut over on its own. A data type leaves
 * the whole migration's ledger only by beginning its own.
 */

import { describe, it, expect } from 'vitest';
import {
  CUTOVER_UNDER_WAY,
  cutoverBeginRefusal,
  leavingTheWholeLedgerRefusal,
  type CutoverState,
} from './cutover-state.ts';

const ALL: readonly CutoverState[] = [
  'PREPARING',
  'READY_FOR_CUTOVER',
  'APPROVED',
  'CUTOVER_IN_PROGRESS',
  'GRACE_PERIOD',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK',
];

describe('a data type beginning its own cutover', () => {
  it('may, with no ledger at all, or beside a whole migration’s that is not under way', () => {
    expect(cutoverBeginRefusal([], 'email')).toBeNull();
    for (const state of ['COMPLETED', 'FAILED', 'ROLLED_BACK'] as const) {
      expect(cutoverBeginRefusal([{ state }], 'email'), state).toBeNull();
    }
  });

  it('may not while the whole migration’s is under way, which it would otherwise be moving', () => {
    for (const state of CUTOVER_UNDER_WAY) {
      expect(cutoverBeginRefusal([{ state }], 'email'), state).toMatchObject({ code: 'whole_under_way' });
    }
  });

  it('goes on with its own where it has one, and another data type’s is no concern of its', () => {
    expect(cutoverBeginRefusal([{ state: 'APPROVED' }, { domain: 'email', state: 'PREPARING' }], 'email')).toBeNull();
    expect(cutoverBeginRefusal([{ domain: 'email', state: 'GRACE_PERIOD' }], 'file')).toBeNull();
  });
});

describe('the whole migration beginning its cutover', () => {
  it('may while no data type has its own, whatever its own ledger says', () => {
    expect(cutoverBeginRefusal([])).toBeNull();
    for (const state of ALL) expect(cutoverBeginRefusal([{ state }]), state).toBeNull();
  });

  it('may not once a data type has its own, and names it', () => {
    const refused = cutoverBeginRefusal([{ state: 'ROLLED_BACK' }, { domain: 'email', state: 'COMPLETED' }]);
    expect(refused).toMatchObject({ code: 'cut_over_by_data_type' });
    expect(refused!.refuse).toContain('email');
    expect(refused!.hint).toContain('--kind');
  });
});

describe('a data type leaving the whole migration’s ledger it read', () => {
  it('only by beginning its own, from one that is not under way', () => {
    expect(leavingTheWholeLedgerRefusal('FAILED', 'PREPARING')).toBeNull();
    expect(leavingTheWholeLedgerRefusal('ROLLED_BACK', 'PREPARING')).toBeNull();
    // Any other move on the whole migration's ledger is not its own to make.
    expect(leavingTheWholeLedgerRefusal('FAILED', 'ROLLED_BACK')).toContain('start it first');
    for (const state of CUTOVER_UNDER_WAY) {
      for (const to of ALL) expect(leavingTheWholeLedgerRefusal(state, to), `${state} -> ${to}`).toContain('under way');
    }
  });
});

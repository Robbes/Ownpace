// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The confirmation pass (workplan 0117 T2 slice 2).
 *
 * Colocated rather than in `scripts/`: its subject is this file, and the
 * cross-cutting half — that the vocabulary and the waiver cannot drift apart —
 * is already guarded next to the vocabulary.
 *
 * What is asserted here is the pass's own judgement, which is small and all of
 * it dangerous:
 *
 *  - a target that will not answer must never read as a target that said no;
 *  - a comparison that could not be made must never read as a mismatch;
 *  - the statuses the ledger decides must not cost a request;
 *  - and the headline must come through `countsAsVerified`, not a count of a
 *    state somebody typed twice.
 */

import { describe, it, expect } from 'vitest';
import { confirmEach, confirmOne, tally, type ConfirmableItem, type ConfirmationReader } from './confirmation-pass.ts';

const item = (over: Partial<ConfirmableItem> = {}): ConfirmableItem => ({
  naturalKeyHash: 'h1',
  status: 'copied',
  contentHash: 'sha-of-what-we-wrote',
  ...over,
});

/** A reader that answers, with whatever the test needs. */
const reader = (over: Partial<ConfirmationReader> = {}): ConfirmationReader => ({
  isPresent: async () => true,
  hashOnTarget: async () => 'sha-of-what-we-wrote',
  ...over,
});

/**
 * A reader that COUNTS what it was asked, rather than throwing.
 *
 * It threw, until a mutation harness found the flaw on 2026-09-10: this pass
 * catches everything the reader throws and turns it into `unreachable`, so a
 * throwing sentinel is swallowed by the very code it is meant to police and the
 * test passes while the unwanted read happens. A counter cannot be caught.
 */
function countingReader() {
  const calls = { presence: 0, hash: 0 };
  const reader: ConfirmationReader = {
    isPresent: async () => {
      calls.presence += 1;
      return true;
    },
    hashOnTarget: async () => {
      calls.hash += 1;
      return 'sha-of-what-we-wrote';
    },
  };
  return { calls, reader };
}

describe('a target that will not answer', () => {
  it('is unchecked, never missing', async () => {
    // The rule this pass exists to hold. `missing` is "we placed it and it is
    // gone" — the loudest row on the page somebody deletes their originals
    // from — and a timeout must not produce it.
    const row = await confirmOne(
      'file',
      item(),
      reader({
        isPresent: async () => {
          throw new Error('ETIMEDOUT');
        },
      }),
    );
    expect(row).toEqual({ state: 'unchecked', claim: 'none' });
  });

  it('is unchecked whether the throw comes from presence or from the hash… no', async () => {
    // …and this is the distinction. A failed HASH still leaves a fact we have:
    // `isPresent` already said the item is there. Reporting `unchecked` would
    // throw that away; reporting `differs` would invent a mismatch. It is
    // `present`, which claims exactly what was established.
    const row = await confirmOne(
      'file',
      item(),
      reader({
        hashOnTarget: async () => {
          throw new Error('read timed out');
        },
      }),
    );
    expect(row).toEqual({ state: 'present', claim: 'none' });
  });

  it('and a target that says no really is missing', async () => {
    const row = await confirmOne('file', item(), reader({ isPresent: async () => false }));
    expect(row).toEqual({ state: 'missing', claim: 'none' });
  });
});

describe('a comparison that could not be made is never a mismatch', () => {
  it('says present when the target implements no hash at all', async () => {
    // CalDAV and CardDAV, permanently: those servers re-serialise what they
    // store, so a hash off the target could never equal the ledger's.
    const row = await confirmOne('calendar', item(), { isPresent: async () => true });
    expect(row).toEqual({ state: 'present', claim: 'none' });
  });

  it('says present when the target has a hash function but no answer for this item', async () => {
    const row = await confirmOne('file', item(), reader({ hashOnTarget: async () => undefined }));
    expect(row).toEqual({ state: 'present', claim: 'none' });
  });

  it('says present when the LEDGER holds no hash to compare against', async () => {
    // A row written before the column existed. There is nothing to compare, so
    // there is nothing to disagree about — and the pass must not ask the target
    // to hash a large file to learn that.
    let hashed = 0;
    const row = await confirmOne(
      'file',
      item({ contentHash: null }),
      reader({
        hashOnTarget: async () => {
          hashed += 1;
          return 'anything';
        },
      }),
    );
    expect(row).toEqual({ state: 'present', claim: 'none' });
    expect(hashed, 'the pass fetched a body it had nothing to compare to').toBe(0);
  });
});

describe('what the pass may claim when both hashes are in hand', () => {
  it('verified, with the claim named by the DOMAIN and not by the agreement', async () => {
    const row = await confirmOne('file', item(), reader());
    expect(row).toEqual({ state: 'verified', claim: 'byte-hash' });
  });

  it('differs when they disagree', async () => {
    const row = await confirmOne('email', item(), reader({ hashOnTarget: async () => 'other' }));
    expect(row).toEqual({ state: 'differs', claim: 'byte-hash' });
  });

  it('never lets an adopted row reach verified, however well the hashes agree', async () => {
    // The customer's own bytes. Slice 1's rule, re-asserted through the
    // machinery: the pass has no way to overrule it, because it does not
    // decide rows.
    const row = await confirmOne('file', item({ status: 'adopted' }), reader());
    expect(row).toEqual({ state: 'yours', claim: 'none' });
  });
});

describe('the reads the ledger makes unnecessary', () => {
  it('asks the target nothing for a status it already decides', async () => {
    // D7's cost half. Seven of the ten statuses; a request each would be spent
    // to learn nothing, on the one pass whose cost was a decision.
    const { calls, reader: counting } = countingReader();
    for (const status of [
      'pending',
      'skipped',
      'failed',
      'left_behind',
      'adopted',
      'tombstoned',
      undefined,
    ] as const) {
      await confirmOne('file', item({ status }), counting);
    }
    expect(calls, 'the pass read the target for a status the ledger decides').toEqual({
      presence: 0,
      hash: 0,
    });
    expect(await confirmOne('file', item({ status: undefined }), counting)).toEqual({
      state: 'never-placed',
      claim: 'none',
    });
  });

  it('does ask for the three it cannot decide', async () => {
    for (const status of ['copied', 'updated', 'deleted_source'] as const) {
      let asked = 0;
      await confirmOne(
        'file',
        item({ status }),
        reader({
          isPresent: async () => {
            asked += 1;
            return true;
          },
        }),
      );
      expect(asked, `status '${status}' was decided without reading the target`).toBe(1);
    }
  });
});

describe('the pass streams, and the tally speaks for the headline', () => {
  it('yields one row per item, in order, keyed by the item', async () => {
    async function* items() {
      yield item({ naturalKeyHash: 'a' });
      yield item({ naturalKeyHash: 'b', status: 'skipped' });
    }
    const out = [];
    for await (const row of confirmEach('file', items(), reader())) out.push(row);
    expect(out.map((r) => r.naturalKeyHash)).toEqual(['a', 'b']);
    expect(out[0]!.row.state).toBe('verified');
    expect(out[1]!.row.state).toBe('never-placed');
  });

  it('counts every state and calls only `verified` verified', async () => {
    const rows = [
      { state: 'verified', claim: 'byte-hash' },
      { state: 'verified', claim: 'fingerprint' },
      { state: 'present', claim: 'none' },
      { state: 'yours', claim: 'none' },
      { state: 'unchecked', claim: 'none' },
      { state: 'missing', claim: 'none' },
    ] as const;
    const t = tally(rows);
    expect(t.total).toBe(6);
    // `present` and `yours` are genuinely on the target and are deliberately
    // not verified — the headline says verified, and neither was.
    expect(t.verified).toBe(2);
    expect(t.byState.present).toBe(1);
    expect(t.byState.yours).toBe(1);
    expect(t.byState.unchecked).toBe(1);
    expect(t.byState.missing).toBe(1);
    expect(t.byState.differs).toBe(0);
  });

  it('starts every state at zero, so an absent state is a zero and not a gap', () => {
    const t = tally([]);
    expect(t.total).toBe(0);
    expect(Object.values(t.byState).every((n) => n === 0)).toBe(true);
    // Eight states, all present. A template reading `byState.removed` on an
    // empty pass gets 0 rather than undefined.
    expect(Object.keys(t.byState).sort()).toEqual([
      'differs',
      'missing',
      'never-placed',
      'present',
      'removed',
      'unchecked',
      'verified',
      'yours',
    ]);
  });
});

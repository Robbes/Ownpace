// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Counting what the DESTINATION already holds, before anything is copied.
 *
 * Discovery counted the source only, so the confirm screen described every
 * migration as if it were going into an empty account. It very often is not:
 * the customer may already be using the destination, and a freshly provisioned
 * one ships with the provider's own starter content — the §20 run that
 * prompted this found 3 pre-existing items each in the destination's calendar
 * and address book.
 *
 * Two numbers, and the difference matters:
 *   - `targetExisting` — everything already there. Untouched, always.
 *   - `targetColliding` — the subset sharing a natural key with a source item.
 *     Those get ADOPTED: recorded as migrated, the destination's copy kept.
 *     This is the number that changes what the customer ends up with.
 */

import { describe, it, expect } from 'vitest';
import { naturalKeyHash } from '@openmig/shared';
import { discoverTarget, type CountableTarget } from './discovery.ts';

function target(keys: string[]): CountableTarget {
  return {
    async *listEntries() {
      for (const naturalKey of keys) yield { naturalKey };
    },
  };
}

describe('discoverTarget', () => {
  it('counts everything on the destination, and the colliding subset', async () => {
    const sourceKeys = new Set(['<a@x>', '<b@x>'].map(naturalKeyHash));

    const result = await discoverTarget(
      target(['<a@x>', '<theirs-1@x>', '<theirs-2@x>']),
      sourceKeys,
      naturalKeyHash,
    );

    expect(result.targetExisting).toBe(3);
    expect(result.targetColliding).toBe(1);
  });

  it('reports zero collisions when the destination holds only its own data', async () => {
    const sourceKeys = new Set(['<a@x>'].map(naturalKeyHash));

    const result = await discoverTarget(target(['<theirs@x>']), sourceKeys, naturalKeyHash);

    expect(result.targetExisting).toBe(1);
    expect(result.targetColliding).toBe(0);
  });

  it('reports an empty destination as zero and zero', async () => {
    const result = await discoverTarget(target([]), new Set(['x']), naturalKeyHash);

    expect(result.targetExisting).toBe(0);
    expect(result.targetColliding).toBe(0);
  });

  it('hashes the target key before comparing — raw keys would match nothing', async () => {
    // The ADR-0020 failure: a target yields a RAW Message-ID/UID while the
    // source side collected domain-prefixed hashes. Comparing the two unhashed
    // is what made every item look missing in #139, and here would report 0
    // collisions on a destination that fully collides — telling the customer
    // nothing would be adopted when everything would.
    const raw = '<a@x>';
    const sourceKeys = new Set([naturalKeyHash(raw)]);

    const hashed = await discoverTarget(target([raw]), sourceKeys, naturalKeyHash);
    expect(hashed.targetColliding).toBe(1);

    const unhashed = await discoverTarget(target([raw]), sourceKeys, (k) => k);
    expect(unhashed.targetColliding).toBe(0);
  });

  it('counts every collision, not just the first', async () => {
    const keys = ['<a@x>', '<b@x>', '<c@x>'];
    const sourceKeys = new Set(keys.map(naturalKeyHash));

    const result = await discoverTarget(target([...keys, '<theirs@x>']), sourceKeys, naturalKeyHash);

    expect(result.targetExisting).toBe(4);
    expect(result.targetColliding).toBe(3);
  });
});

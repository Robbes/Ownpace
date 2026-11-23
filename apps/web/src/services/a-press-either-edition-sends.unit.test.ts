// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * *APPLY THE NEW ADDRESSES HERE TOO*, SENT WHERE EACH EDITION'S DOOR IS
 * (workplan 0168 D5; the data-path review's S5 (b), (d); the screens' review
 * S3).
 *
 * The press went to `/migrations/{id}/…` in both editions, and the appliance
 * answers `/mappings/{id}/…`, so on the appliance it reached nothing. Now it
 * goes under the mapping's own path, as the decisions do, and it names the
 * table the page showed by its press digest, which the page takes with the
 * browser's own SHA-256: pinned here to the digest both servers compare
 * (`addressTablePressDigest`), or every press would be refused as a table
 * that moved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addressKey, addressTablePressDigest } from '@openmig/shared';

const { postMock, edition } = vi.hoisted(() => ({
  postMock: vi.fn(),
  edition: { selfhost: false },
}));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: () => ({
        get: vi.fn(),
        post: postMock,
        put: vi.fn(),
        delete: vi.fn(),
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
      }),
    },
  };
});

// VITE_EDITION is baked in at build time, so the edition is swapped here
// rather than through the environment (edition.unit.test.ts explains why).
vi.mock('./edition.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./edition.ts')>();
  return {
    ...actual,
    isSelfHost: () => edition.selfhost,
    mappingPath: (id: string) => actual.mappingPathFor(edition.selfhost ? 'selfhost' : 'managed', id),
  };
});

import { applyAddressChangesHere, pressDigestOf } from './address-change-service.ts';

const row = (oldAddress: string, newAddress: string, state: 'confirmed' | 'proposed' = 'confirmed') => ({
  oldKey: addressKey(oldAddress),
  oldAddress,
  newAddress,
  state,
});

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue({ data: { applied: true } });
});

describe('the press, sent where each edition’s door is', () => {
  it.each([
    [false, '/migrations/m%201/address-changes/apply'],
    [true, '/mappings/m%201/address-changes/apply'],
  ] as const)('on the appliance %s, posts to %s with the digest the page showed', async (selfhost, path) => {
    edition.selfhost = selfhost;
    await applyAddressChangesHere('m 1', 'a'.repeat(64));
    expect(postMock).toHaveBeenCalledWith(path, { digest: 'a'.repeat(64) });
  });
});

describe('the digest the page sends', () => {
  it('is the press digest both servers compare, of the confirmed rows only', async () => {
    const tables = [
      [],
      [row('ana@old.example.org', 'ana@example.org')],
      [row('Ben.Old@Old.Example.org', 'Ben@Example.org'), row('ana@old.example.org', 'ana@example.org')],
      [row('ana@old.example.org', 'ana@example.org'), row('carla@old.example.org', 'carla@example.org', 'proposed')],
      [row('dörte@old.example.org', 'dörte@example.org')],
    ];
    for (const rows of tables) {
      const confirmed = rows.filter((r) => r.state === 'confirmed');
      expect(await pressDigestOf(rows)).toBe(addressTablePressDigest(confirmed));
    }
  });
});

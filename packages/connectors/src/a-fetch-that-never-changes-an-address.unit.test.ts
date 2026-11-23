// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FETCH THAT NEVER CHANGES AN ADDRESS (`ContactSource.fetch`; ADR-0055;
 * workplan 0168, the review's S8).
 *
 * A pass decides whether a card's addresses need rewriting from the card the
 * source LISTED, and records that card's digest; the bytes it writes are the
 * fetched card's, changed by the same table. Those agree only while a fetch
 * leaves every `EMAIL` line as the listing had it. A source whose fetch added
 * an old address would have its card rewritten on every pass (the review's
 * E3), and since the pass records the listed card's digest now, it would
 * write a card whose digest says less than it carries.
 *
 * So the contract is held here, for every contact source that has a fetch:
 * Graph's, which adds the photo. The marked-only wrapper forwards a fetch
 * (`marked-only.ts`) and adds none of its own.
 */

import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraphContactsSource } from './graph-contacts-source.ts';
import type { HttpClient } from './dav-http.types.ts';
import { addressKey, applyAddressChanges, type ConfirmedAddressChange, type TokenProvider } from '@openmig/shared';

const HERE = dirname(fileURLToPath(import.meta.url));

const tokens: TokenProvider = {
  getToken: vi.fn().mockResolvedValue({ accessToken: 't', tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000 }),
  refresh: vi.fn(),
  isTokenValid: vi.fn().mockReturnValue(true),
  getTokenStatus: vi.fn().mockReturnValue({ isValid: true, timeUntilExpiry: 3600 }),
} as unknown as TokenProvider;

/** Every contact has a photo: the fetch has something to add. */
const photo: HttpClient = {
  request: vi.fn().mockResolvedValue({
    status: 200,
    body: '',
    bodyBytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    headers: { 'content-type': 'image/jpeg' },
  }),
};

const row = (o: string, n: string): ConfirmedAddressChange => ({ oldKey: addressKey(o), oldAddress: o, newAddress: n });
const TABLE = [row('ana@old.example.org', 'ana@example.org'), row('ben@old.example.org', 'ben@example.org')];
const ADDRESSES = ['ana@old.example.org', 'ANA@Old.Example.org', 'ben@old.example.org', 'ben@example.org', 'carla@stays.example.org'];

const emailLines = (vcard: string): string[] =>
  vcard
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/)
    .filter((l) => /^([\w-]+\.)?EMAIL[;:]/i.test(l));

describe('a contact source’s fetch never changes an address', () => {
  it('is held for every contact source in this package that has a fetch', () => {
    const withFetch = readdirSync(HERE)
      .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
      .filter((f) => {
        const text = readFileSync(join(HERE, f), 'utf8');
        return /implements\s+ContactSource\b/.test(text) && /^\s+(async\s+)?fetch\(/m.test(text);
      });
    // A new one is held to the contract below before it is added here.
    expect(withFetch).toEqual(['graph-contacts-source.ts']);
  });

  it('keeps every EMAIL line of the card Graph listed, byte for byte, and so its digest under the table', async () => {
    const source = new GraphContactsSource(tokens, 'tenant', undefined, { httpClient: photo });
    for (let k = 0; k < 40; k += 1) {
      const emails = ADDRESSES.filter((_, i) => (k >> i) % 2 === 1).map(
        (a, i) => `${i % 2 === 0 ? 'EMAIL;TYPE=work' : 'EMAIL;PREF=1'}:${a}`,
      );
      const listed = ['BEGIN:VCARD', 'VERSION:4.0', `UID:c-${k}`, `FN:Contact ${k}`, ...emails, 'END:VCARD', ''].join('\r\n');
      const fetched = await source.fetch({
        item: { uid: `c-${k}`, type: 'person', name: `Contact ${k}`, sourcePath: `/contacts/c-${k}`, vcard: listed, version: '4.0' },
        vcard: listed,
      } as never);
      expect(fetched.vcard, `card ${k}`).toContain('PHOTO:data:image/jpeg;base64,');
      expect(emailLines(fetched.vcard), `card ${k}`).toEqual(emailLines(listed));
      expect(applyAddressChanges('vcard', fetched.vcard, TABLE).digest, `card ${k}`).toBe(
        applyAddressChanges('vcard', listed, TABLE).digest,
      );
    }
  });
});

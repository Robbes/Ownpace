// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A quota reply that opens its property many times and never ends the tag,
 * read in one pass. The pattern it was read with took about a second at this
 * size; it must take well under a quarter of one, and answer as before.
 */

import { describe, it, expect } from 'vitest';
import { capacityFromDavQuota } from './destination-capacity.ts';

describe('a DAV reader, in one pass', () => {
  it('a quota reply', () => {
    const body = `<d:multistatus><d:response>${'<d:quota-available-bytes '.repeat(40_000)}</d:response></d:multistatus>`;
    const started = performance.now();
    capacityFromDavQuota(body, 'files');
    expect(performance.now() - started).toBeLessThan(250);
    const read = capacityFromDavQuota(
      '<d:multistatus><d:response><d:propstat><d:prop><d:quota-available-bytes> 1024 </d:quota-available-bytes><d:quota-used-bytes>10</d:quota-used-bytes></d:prop></d:propstat></d:response></d:multistatus>',
      'files',
    );
    expect(read).toMatchObject({ known: true });
  });
});

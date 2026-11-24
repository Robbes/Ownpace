// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ADDRESS WE WOULD NOT CONNECT TO IS SAID AS OURS (2026-11-24).
 *
 * A Dropbox → Nextcloud migration on the OTA test environment had its files
 * refused by our own rule for a host a tenant gives us (`HostInsideOurNetwork`,
 * workplan 0136). The classifier had no category for it, so it read
 * `unknown`, and the screen called our own sentence *"the provider's own
 * message"* and offered *"Send it to us"* instead of the way out: a different
 * address on the account.
 *
 * What this pins:
 *
 * - the refusal STATES `internal_address` on itself, and the classifier takes
 *   the statement over the prose, whichever side it happened on;
 * - the statement survives the wrappers it meets on its way up: undici's
 *   `fetch failed` (its `cause`), and a wrapper a caller tags later, since the
 *   first tag wins and the refusal is tagged as it is built;
 * - through a real request with the rule on, the error `tenantFetch` throws
 *   states it, and so does the IMAP door's;
 * - our sentence is NOT matched as prose: without the statement it stays
 *   `unknown`, so no provider can make a screen say this by echoing it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { classifyFailure } from './failure-category.ts';
import { statedFailureCategoryOf, withFailureCategory } from './stated-failure-category.ts';
import { HostInsideOurNetwork, reachableHost, refuseInternalAddresses, tenantFetch } from './reachable-host.ts';

describe('the refusal states its own category', () => {
  it('is internal_address, on the error itself', () => {
    expect(statedFailureCategoryOf(new HostInsideOurNetwork('db.internal.example'))).toBe('internal_address');
  });

  it('wins over the prose on either side', () => {
    const refused = new HostInsideOurNetwork('nextcloud.example.org');
    for (const side of ['source', 'target', undefined] as const) {
      expect(classifyFailure(refused.message, side, statedFailureCategoryOf(refused))).toBe('internal_address');
    }
  });

  it("is found under undici's `fetch failed`, the TypeError fetch wraps a connection error in", () => {
    const refused = new HostInsideOurNetwork('nextcloud.example.org');
    const fetchFailed = new TypeError('fetch failed', { cause: refused });
    expect(statedFailureCategoryOf(fetchFailed)).toBe('internal_address');
    // And one wrapper further up, as a pass that re-throws with a cause does.
    const passed = new Error(`PUT failed for /Documents/a.txt: ${fetchFailed.message}`, { cause: fetchFailed });
    expect(statedFailureCategoryOf(passed)).toBe('internal_address');
  });

  it('is not overwritten by a later tag on the same error', () => {
    const refused = withFailureCategory('target_refused', new HostInsideOurNetwork('nextcloud.example.org'));
    expect(statedFailureCategoryOf(refused)).toBe('internal_address');
  });

  it('is not matched from our sentence alone: without the statement, the prose stays unknown', () => {
    // A provider that echoed our words back must not be able to choose this
    // category. Only the code that refused states it.
    const sentence = new HostInsideOurNetwork('nextcloud.example.org').message;
    expect(classifyFailure(sentence, 'target')).toBe('unknown');
    expect(classifyFailure(sentence, 'source')).toBe('unknown');
  });
});

describe('through the doors a pass uses, with the rule on', () => {
  let release: (() => void) | undefined;
  afterEach(() => {
    release?.();
    release = undefined;
  });

  it('tenantFetch (DAV and JMAP): the error it throws states internal_address', async () => {
    release = refuseInternalAddresses({ resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]) });
    const error = await tenantFetch('http://127.0.0.1:8080/remote.php/dav/').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostInsideOurNetwork);
    expect(statedFailureCategoryOf(error)).toBe('internal_address');
  });

  it('reachableHost (IMAP): the error it throws states internal_address', async () => {
    release = refuseInternalAddresses({ resolve: () => Promise.resolve([{ address: '10.1.2.3', family: 4 }]) });
    const error = await reachableHost('imap.example.org').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HostInsideOurNetwork);
    expect(statedFailureCategoryOf(error)).toBe('internal_address');
  });
});

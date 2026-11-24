// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DESTINATION INSIDE OUR NETWORK (2026-11-24), the owner's case as far as
 * unit tests reach.
 *
 * A Dropbox → Nextcloud migration on the OTA test environment had its files
 * refused by our own rule for a host a tenant gives us (workplan 0136). The
 * data type read `unknown`, at the destination, and its screen called our own
 * sentence the provider's.
 *
 * Here a real WebDAV target writer, with its own HTTP client and the rule
 * switched on, is pointed at an address inside the network, and called the
 * way a pass calls it: through `sided('target', …)`. What the pass reads off
 * the error is what `markFailed` stores: the side, the stated category, and
 * the category `classifyFailure` makes of the three. It must be
 * `internal_address` on the target side, and never `unknown`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { classifyFailure, statedFailureCategoryOf, type Ledger, type MappingId, type TenantId } from '@openmig/shared';
import { refuseInternalAddresses } from '@openmig/shared/reachable-host';
import { WebDAVTargetWriter } from '@openmig/engines/webdav-target-writer';
import { failureSideOf, sided } from './failure-side.ts';

describe('a WebDAV destination the rule refuses', () => {
  let release: (() => void) | undefined;
  afterEach(() => {
    release?.();
    release = undefined;
  });

  it('is stated internal_address, on the target side, and not unknown', async () => {
    release = refuseInternalAddresses({ resolve: () => Promise.resolve([{ address: '10.0.0.7', family: 4 }]) });
    const writer = new WebDAVTargetWriter(
      { url: 'https://nextcloud.example.org/remote.php/dav/files/someone/', username: 'someone', password: 'x' },
      // The refusal comes before anything is recorded: no ledger is reached.
      { ledger: {} as Ledger, tenantId: 't' as TenantId, mappingId: 'm' as MappingId },
    );
    const ensure = sided('target', (path: string) => writer.ensureDirectory({ path }));
    const error = await ensure('Documents').catch((e: unknown) => e);

    expect(failureSideOf(error)).toBe('target');
    expect(statedFailureCategoryOf(error)).toBe('internal_address');
    const message = (error as Error).message;
    expect(classifyFailure(message, failureSideOf(error), statedFailureCategoryOf(error))).toBe('internal_address');
    // What the same words would have read without the statement: the defect.
    expect(classifyFailure(message, 'target')).toBe('unknown');
  });
});

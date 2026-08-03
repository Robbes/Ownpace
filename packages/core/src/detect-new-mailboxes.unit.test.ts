// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The first drift detector (workplan 0028 T2).
 *
 * The test that carries the most weight is the refusal one: a source that
 * could not enumerate the directory must produce a stated blind spot, not an
 * empty list. "You are covered" and "you are not watching" must never arrive
 * as the same answer (hard rule 9).
 */

import { describe, it, expect } from 'vitest';
import { asTenantId } from '@openmig/shared';
import { detectNewMailboxes, type DirectoryListing } from './detect-new-mailboxes';

const TENANT = asTenantId('11111111-1111-4111-8111-111111111111' as never);

const listed = (...addresses: string[]): DirectoryListing => ({ kind: 'listed', addresses });

describe('a source that could not look', () => {
  it('reports a blind spot instead of an empty result', () => {
    const result = detectNewMailboxes({
      tenantId: TENANT,
      listing: { kind: 'not_enumerable', reason: 'IMAP has no directory endpoint' },
      covered: [],
    });

    expect(result.decisions).toEqual([]);
    // Without this, an IMAP migration would silently report "no new mailboxes"
    // forever, and the owner would believe they were being watched.
    expect(result.blindSpot).toBe('IMAP has no directory endpoint');
  });

  it('carries the reason verbatim, whatever it says', () => {
    const reason = 'Graph said: Insufficient privileges to complete the operation.';
    const result = detectNewMailboxes({
      tenantId: TENANT,
      listing: { kind: 'not_enumerable', reason },
      covered: [],
    });
    expect(result.blindSpot).toBe(reason);
  });
});

describe('what counts as new', () => {
  it('raises one decision per uncovered mailbox', () => {
    const result = detectNewMailboxes({
      tenantId: TENANT,
      listing: listed('anna@acme.nl', 'info@acme.nl'),
      covered: [{ address: 'anna@acme.nl' }],
    });

    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({
      tenantId: TENANT,
      category: 'new_mailbox',
      subjectKey: 'info@acme.nl',
      proposedDefault: 'Create a mapping for this mailbox',
    });
    expect(result.blindSpot).toBeUndefined();
  });

  it('says what was found and what it means, not what to click', () => {
    const [decision] = detectNewMailboxes({
      tenantId: TENANT,
      listing: listed('info@acme.nl'),
      covered: [],
    }).decisions;

    // This sentence is rendered verbatim on the screen and in the email, so
    // it has to stand on its own.
    expect(decision?.summary).toContain('info@acme.nl');
    expect(decision?.summary).toContain('no migration covers it');
    expect(decision?.summary).toContain('Nothing is being copied from it');
  });

  it('matches coverage case-insensitively', () => {
    // A directory that reports Anna@Acme.nl and a mapping configured as
    // anna@acme.nl are the same mailbox; raising a decision would be noise
    // the owner cannot make go away.
    const result = detectNewMailboxes({
      tenantId: TENANT,
      listing: listed('Anna@Acme.NL'),
      covered: [{ address: 'anna@acme.nl' }],
    });
    expect(result.decisions).toEqual([]);
  });

  it('is quiet when everything is covered', () => {
    const result = detectNewMailboxes({
      tenantId: TENANT,
      listing: listed('anna@acme.nl'),
      covered: [{ address: 'anna@acme.nl' }],
    });
    expect(result.decisions).toEqual([]);
    expect(result.blindSpot).toBeUndefined();
  });

  it('is quiet on an empty directory it DID read', () => {
    // Distinct from the refusal above: this source looked and found nothing.
    const result = detectNewMailboxes({ tenantId: TENANT, listing: listed(), covered: [] });
    expect(result.decisions).toEqual([]);
    expect(result.blindSpot).toBeUndefined();
  });
});

describe('not asking twice', () => {
  it('uses the address as the subject key, so re-detection converges', () => {
    // The store's partial unique index makes a repeated raise a no-op while
    // the decision is pending — but only if the key is stable.
    const twice = [1, 2].map(
      () =>
        detectNewMailboxes({
          tenantId: TENANT,
          listing: listed('info@acme.nl'),
          covered: [],
        }).decisions[0]?.subjectKey,
    );
    expect(twice[0]).toBe(twice[1]);
    expect(twice[0]).toBe('info@acme.nl');
  });

  it('does not re-raise a subject the owner dismissed', () => {
    const result = detectNewMailboxes({
      tenantId: TENANT,
      listing: listed('info@acme.nl'),
      covered: [],
      dismissed: ['info@acme.nl'],
    });
    // Dismissing means "I know, leave it alone". A detector that asked again
    // every hour would make the queue unusable.
    expect(result.decisions).toEqual([]);
  });

  it('collapses a directory that lists the same address twice', () => {
    const result = detectNewMailboxes({
      tenantId: TENANT,
      listing: listed('info@acme.nl', 'INFO@acme.nl'),
      covered: [],
    });
    expect(result.decisions).toHaveLength(1);
  });
});

describe('malformed directory entries', () => {
  it('ignores empty entries rather than raising a decision about nothing', () => {
    const result = detectNewMailboxes({
      tenantId: TENANT,
      listing: listed('', '   ', 'info@acme.nl'),
      covered: [],
    });
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.subjectKey).toBe('info@acme.nl');
  });
});

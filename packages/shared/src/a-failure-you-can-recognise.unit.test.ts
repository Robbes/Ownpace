// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A failure names the item, and only where a person is entitled to see it.
 *
 * ## The failure this exists for
 *
 * On 2026-09-13 two of the owner's contacts were refused by a live Nextcloud,
 * five attempts each. The Failures screen is where he was meant to act on them
 * and all it could say was a hash. Four days later, handed the UIDs from the
 * database instead: *"I can not find these contacts, or atleast i do no know
 * how."*
 *
 * So `ItemFailure` now carries the name a person calls the item, under the same
 * §17 exception `ConfirmedRowView.naturalKey` is granted.
 *
 * ## What THIS file guards
 *
 * Not the screen — that is `Failures.unit.test.tsx`. This is the other half:
 * the surfaces that read the same rows and must NOT pass the name on. Both
 * project these rows into counts today, and both would leak personal data if
 * somebody later widened them without noticing, so the projection is asserted
 * against rows that carry names rather than against rows that happen not to.
 */

import { describe, it, expect } from 'vitest';
import { buildDomainStatusReports } from './operating-contract.ts';
import { summariseQueues } from './notifications.ts';
import type { ItemFailure } from './ports.ts';
import type { MigrationStatus } from './operating-contract.ts';

/** Two names that would be unmistakable in any output that carried them. */
const NAMES = ['Jan Jansen', 'Tandarts Wieke'] as const;

const failure = (over: Partial<ItemFailure> = {}): ItemFailure => ({
  domain: 'contact',
  naturalKeyHash: 'hash-1',
  displayName: NAMES[0],
  collection: 'Contacts',
  attempts: 5,
  lastError: 'PUT failed with status 500: TypeError',
  needsDecision: true,
  ...over,
});

const status = (over: Partial<MigrationStatus> = {}): MigrationStatus =>
  ({
    domain: 'contact',
    state: 'failed',
    itemsSynced: 1224,
    itemsFailed: 2,
    bytesTransferred: 0,
    updatedAt: '2026-09-17T20:00:00.000Z',
    ...over,
  }) as MigrationStatus;

describe('the progress view link never sees a name', () => {
  it('projects failures into counts, carrying no name through', () => {
    // `apps/api/src/routes/view.ts` reads `listFailures` and maps it through
    // exactly this function. A recipient of a progress link is not the owner
    // and is entitled to know HOW MANY items are waiting, not whose they are.
    const reports = buildDomainStatusReports(
      [status()],
      [failure(), failure({ naturalKeyHash: 'hash-2', displayName: NAMES[1] })],
    );

    expect(reports[0]?.itemsNeedingDecision).toBe(2);
    const serialised = JSON.stringify(reports);
    for (const name of NAMES) {
      expect(serialised, `the view link's rows carry ${name}`).not.toContain(name);
    }
  });
});

describe('a digest never mails a name', () => {
  it('counts what is waiting and says nothing about whose it is', () => {
    // Both digest builders read `failures.filter(needsDecision).length` through
    // this function. A name in an email is personal data leaving the system, in
    // the one place nobody can take it back from.
    const summary = summariseQueues(
      { id: 'm1', name: 'Rob to Nextcloud' },
      {
        status: 'active',
        pendingDecisions: 0,
        deletions: [],
        moves: [],
        failures: [failure(), failure({ naturalKeyHash: 'hash-2', displayName: NAMES[1] })],
        blindSpots: [],
      },
    );

    expect(summary.failuresWaiting).toBe(2);
    const serialised = JSON.stringify(summary);
    for (const name of NAMES) {
      expect(serialised, `the digest summary carries ${name}`).not.toContain(name);
    }
  });
});

// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * OF ABOUT HOW MANY (workplan 0154 T2).
 *
 * Each data type's progress row said how many had arrived and not of how many:
 * *"18,234 synced"*. Discovery counted the source before the first Start and
 * kept the counts for Review & confirm, and no row read them. Both editions now
 * join them on (`foundByDomain`, then `buildDomainStatusReports`' fourth
 * argument), and a page sets the copies against them.
 *
 * These guards hold what the total MEANS. It is discovery's latest count that
 * succeeded, kept through a later error because it is still the best *about*
 * there is; and it is absent, never 0, when nothing was counted, so a page says
 * the total is not known rather than *"of 0"* (hard rule 9).
 */
import { describe, it, expect } from 'vitest';
import { buildDomainStatusReports } from './operating-contract.ts';
import { foundByDomain, type DiscoveryRecord } from './discovery.ts';
import type { ItemFailure, MigrationStatus } from './ports.ts';

const discovered = (over: Partial<DiscoveryRecord> & Pick<DiscoveryRecord, 'domain'>): DiscoveryRecord => ({
  collections: 3,
  items: 19_000,
  bytes: 3_650_000_000,
  discoveredAt: '2026-10-01T09:00:00.000Z',
  ...over,
});

const status = (domain: MigrationStatus['domain']): MigrationStatus =>
  ({
    tenantId: 't-1',
    mappingId: 'm-1',
    domain,
    state: 'in_progress',
    itemsSynced: 18_234,
    itemsFailed: 0,
    bytesTransferred: 3_330_000_000,
    updatedAt: '2026-10-03T10:00:00.000Z',
  }) as unknown as MigrationStatus;

const NO_FAILURES: readonly ItemFailure[] = [];

describe('what discovery found, per data type', () => {
  it('is its count and its bytes', () => {
    expect(foundByDomain([discovered({ domain: 'email' })])).toEqual({
      email: { items: 19_000, bytes: 3_650_000_000 },
    });
  });

  it('has no bytes where the source has no cheap sizes', () => {
    const found = foundByDomain([discovered({ domain: 'contact', items: 612, bytes: undefined })]);
    expect(found.contact).toEqual({ items: 612 });
    expect(found.contact && 'bytes' in found.contact).toBe(false);
  });

  /**
   * A FIRST ATTEMPT THAT FAILED IS NO COUNT. `recordDiscoveryError` writes
   * zeros when it has nothing earlier to keep, and a total of 0 from that
   * would be a measurement nobody took.
   */
  it('has no entry for a type whose only attempt failed', () => {
    const found = foundByDomain([
      discovered({ domain: 'email' }),
      discovered({ domain: 'file', collections: 0, items: 0, bytes: 0, lastError: '403 insufficientPermissions' }),
    ]);
    expect(Object.keys(found)).toEqual(['email']);
  });

  /**
   * A COUNT KEPT THROUGH A LATER ERROR STILL STANDS: the same footprint
   * `domainsCountedBeforeTheirError` reads. It is a snapshot either way, which
   * is why a page reads it as *about*.
   */
  it('keeps a count from before a later error', () => {
    const found = foundByDomain([discovered({ domain: 'email', lastError: 'ETIMEDOUT' })]);
    expect(found.email).toEqual({ items: 19_000, bytes: 3_650_000_000 });
  });

  /** And a successful count of nothing is an answer: the source held none. */
  it('keeps a counted zero', () => {
    const found = foundByDomain([discovered({ domain: 'task', collections: 1, items: 0, bytes: undefined })]);
    expect(found.task).toEqual({ items: 0 });
    const empty = foundByDomain([discovered({ domain: 'task', collections: 0, items: 0, bytes: undefined })]);
    expect(empty.task).toEqual({ items: 0 });
  });

  it('is empty when discovery never ran', () => {
    expect(foundByDomain([])).toEqual({});
  });
});

describe('the row carries it', () => {
  it('lands on the data type it was counted for', () => {
    const [contact, email] = buildDomainStatusReports([status('contact'), status('email')], NO_FAILURES, undefined, {
      email: { items: 19_000, bytes: 3_650_000_000 },
      contact: { items: 612 },
    });
    expect(email?.itemsFound).toBe(19_000);
    expect(email?.bytesFound).toBe(3_650_000_000);
    expect(contact?.itemsFound).toBe(612);
    expect(contact && 'bytesFound' in contact).toBe(false);
  });

  /** Absent, never 0: the page then says the total is not known. */
  it('says nothing when nothing was counted', () => {
    const [omitted] = buildDomainStatusReports([status('email')], NO_FAILURES);
    expect(omitted && 'itemsFound' in omitted).toBe(false);
    expect(omitted && 'bytesFound' in omitted).toBe(false);
    const [missing] = buildDomainStatusReports([status('email')], NO_FAILURES, undefined, { file: { items: 4 } });
    expect(missing && 'itemsFound' in missing).toBe(false);
  });

  it('keeps a counted zero', () => {
    const [row] = buildDomainStatusReports([status('task')], NO_FAILURES, undefined, { task: { items: 0 } });
    expect(row?.itemsFound).toBe(0);
  });

  /** It is set beside the copies, and moves none of them. */
  it('changes none of the other counts', () => {
    const [withTotal] = buildDomainStatusReports([status('email')], NO_FAILURES, { email: 9 }, {
      email: { items: 19_000, bytes: 3_650_000_000 },
    });
    const [without] = buildDomainStatusReports([status('email')], NO_FAILURES, { email: 9 });
    expect({ ...withTotal, itemsFound: undefined, bytesFound: undefined }).toEqual({
      ...without,
      itemsFound: undefined,
      bytesFound: undefined,
    });
  });
});

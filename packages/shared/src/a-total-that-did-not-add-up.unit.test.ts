// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * LEFT ALONE IS NOT COPIED (workplan 0124 T2).
 *
 * `DomainStatusReport` could say what was copied, what failed, what is being
 * retried and what is waiting on a decision. It had no word at all for the
 * items hard rule 2 protects by doing nothing to them — so a migration that
 * adopted four hundred contacts reported four hundred fewer of everything, and
 * offered nothing to read in the gap.
 *
 * These guards are about the count MEANING something: one number for both kinds
 * of adoption, because the ledger cannot tell them apart; and absent when
 * nobody counted, because a screen saying "none were left behind" about a
 * deployment that never looked is the failure hard rule 9 exists for.
 */
import { describe, it, expect } from 'vitest';
import { buildDomainStatusReports } from './operating-contract.ts';
import type { ItemFailure, MigrationStatus } from './ports.ts';

const status = (domain: MigrationStatus['domain']): MigrationStatus =>
  ({
    tenantId: 't-1',
    mappingId: 'm-1',
    domain,
    state: 'in_progress',
    itemsSynced: 10,
    itemsFailed: 0,
    bytesTransferred: 100,
    updatedAt: '2026-09-18T10:00:00.000Z',
  }) as unknown as MigrationStatus;

const NO_FAILURES: readonly ItemFailure[] = [];

describe('the count of what was left as it was', () => {
  it('lands on the domain it was counted for', () => {
    const [email, contact] = buildDomainStatusReports(
      [status('email'), status('contact')],
      NO_FAILURES,
      { email: 17, contact: 402 },
    );
    expect(email?.itemsAdopted).toBe(17);
    expect(contact?.itemsAdopted).toBe(402);
  });

  /**
   * THE DISTINCTION THE WHOLE TASK RESTS ON.
   *
   * Omitted is "nobody counted" and must stay distinguishable from a counted
   * zero — five call sites build these reports, and one that cannot supply the
   * counts has to produce a row that says nothing rather than one claiming
   * none were adopted.
   */
  it('says nothing at all when nobody counted', () => {
    const [row] = buildDomainStatusReports([status('email')], NO_FAILURES);
    expect(row && 'itemsAdopted' in row).toBe(false);
  });

  it('says nothing for a domain missing from the counts', () => {
    const [email, contact] = buildDomainStatusReports(
      [status('email'), status('contact')],
      NO_FAILURES,
      { email: 3 },
    );
    expect(email?.itemsAdopted).toBe(3);
    expect(contact && 'itemsAdopted' in contact).toBe(false);
  });

  /**
   * AND A COUNTED ZERO IS AN ANSWER. "Nothing here was already on the new
   * system" is a fact somebody may want, and it is not the same fact as
   * "nobody looked" — a truthiness test would collapse the two.
   */
  it('keeps a counted zero', () => {
    const [row] = buildDomainStatusReports([status('email')], NO_FAILURES, { email: 0 });
    expect(row?.itemsAdopted).toBe(0);
  });

  /**
   * It is its OWN number, not a share of another. The copies, the failures and
   * the retries are untouched by it — the defect was precisely that adopted
   * items were falling out of every counter, and a fix that moved them into one
   * of those would be the same untruth in a different place.
   */
  it('changes none of the other counts', () => {
    const failures = [
      { domain: 'email', needsDecision: false },
      { domain: 'email', needsDecision: true },
    ] as unknown as ItemFailure[];
    const [withCount] = buildDomainStatusReports([status('email')], failures, { email: 9 });
    const [without] = buildDomainStatusReports([status('email')], failures);
    expect(withCount?.itemsSynced).toBe(without?.itemsSynced);
    expect(withCount?.itemsFailed).toBe(without?.itemsFailed);
    expect(withCount?.itemsRetrying).toBe(without?.itemsRetrying);
    expect(withCount?.itemsNeedingDecision).toBe(without?.itemsNeedingDecision);
  });
});

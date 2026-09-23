// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAILURE WITH ITS REFERENCE (workplan 0129 T1, ledger 0061): the reference
 * a failed data type's status row keeps reaches the owner's progress strip on
 * both editions, and stops short of a progress link.
 *
 * `buildDomainStatusReports` is the one place both editions build the strip's
 * rows from, so carrying the field there carries it everywhere the owner
 * reads. `viewRowFor` is what a shared progress link sees; its reader cannot
 * report a problem, and the link is kept to what that reader is entitled to.
 */

import { describe, it, expect } from 'vitest';
import { buildDomainStatusReports } from './operating-contract.ts';
import { viewRowFor } from './migration-view.ts';
import type { MigrationStatus } from './ports.ts';

const failed = {
  domain: 'calendar',
  state: 'failed',
  itemsSynced: 12,
  itemsFailed: 0,
  bytesTransferred: 0,
  updatedAt: '2026-09-23T10:00:00.000Z',
  lastError: 'boom',
  lastErrorCategory: 'unknown',
  lastErrorReference: '0a1b2c3d',
} as MigrationStatus;

describe("a failed data type's row", () => {
  it("carries the reference to the owner's strip", () => {
    const [report] = buildDomainStatusReports([failed], []);
    expect(report?.lastErrorReference).toBe('0a1b2c3d');
  });

  it('carries none when there is none', () => {
    const { lastErrorReference: _dropped, ...without } = failed;
    const [report] = buildDomainStatusReports([without as MigrationStatus], []);
    expect(report).not.toHaveProperty('lastErrorReference');
  });

  it('does not reach a progress link', () => {
    const [report] = buildDomainStatusReports([failed], []);
    expect(viewRowFor(report!)).not.toHaveProperty('lastErrorReference');
  });
});

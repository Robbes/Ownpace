// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A failure's provider text names the person's files, so for an account that
 * person granted it stays off the owner's pages (ADR-0035 decision 5, the
 * owner's option C of 2026-10-03).
 *
 * The text is kept free of secrets, not of data: `SELECT "Personal/Divorce
 * lawyer" failed` is that person's content, and decision 4's promise is that
 * their organisation cannot read it. Until this change the owner's migration
 * page and failure queue showed it verbatim for every account. The two shared
 * pieces that build those pages are pinned here: the status row keeps its
 * category, side and reference and says the text was kept back, and a failure
 * row keeps its kind and loses the provider's words and the items' names.
 */

import { describe, it, expect } from 'vitest';
import { buildDomainStatusReports, withheldFailure } from './operating-contract.ts';
import { discoveryFailed, domainsCountedBeforeTheirError, foundByDomain, withheldDiscovery, type DiscoveryRecord } from './discovery.ts';
import type { ItemFailure, MigrationStatus } from './ports.ts';

const failed = {
  domain: 'file',
  state: 'failed',
  itemsSynced: 12,
  itemsFailed: 1,
  bytesTransferred: 0,
  updatedAt: '2026-10-03T10:00:00.000Z',
  lastError: 'SELECT "Personal/Divorce lawyer" failed',
  lastErrorCategory: 'source_refused',
  failedSide: 'source',
  lastErrorReference: '0a1b2c3d',
} as MigrationStatus;

const failure: ItemFailure = {
  domain: 'file',
  naturalKeyHash: 'f'.repeat(64),
  displayName: 'Letter to the lawyer.pdf',
  collection: 'Personal/Divorce lawyer',
  attempts: 3,
  lastError: '403 Forbidden: /Personal/Divorce lawyer/Letter to the lawyer.pdf',
  category: 'source_refused',
  needsDecision: true,
};

describe("the migration page's row, for an account a person granted", () => {
  it('keeps the category, the side and the reference, and drops the text', () => {
    const [report] = buildDomainStatusReports([failed], [], undefined, undefined, { withholdProse: true });
    expect(report).not.toHaveProperty('lastError');
    expect(report?.lastErrorWithheld).toBe(true);
    expect(report?.lastErrorCategory).toBe('source_refused');
    expect(report?.failedSide).toBe('source');
    expect(report?.lastErrorReference).toBe('0a1b2c3d');
  });

  it('shows the text, and says nothing about withholding, for an account the organisation connected', () => {
    const [report] = buildDomainStatusReports([failed], []);
    expect(report?.lastError).toBe('SELECT "Personal/Divorce lawyer" failed');
    expect(report).not.toHaveProperty('lastErrorWithheld');
  });

  it('claims nothing was withheld when nothing failed', () => {
    const { lastError: _gone, ...clean } = failed;
    const [report] = buildDomainStatusReports([clean as MigrationStatus], [], undefined, undefined, {
      withholdProse: true,
    });
    expect(report).not.toHaveProperty('lastErrorWithheld');
  });
});

describe("the failure queue's row, for an account a person granted", () => {
  it('keeps what the owner acts on and loses what names the person’s files', () => {
    const row = withheldFailure(failure);
    expect(row.lastError).toBe('');
    expect(row).not.toHaveProperty('displayName');
    expect(row).not.toHaveProperty('collection');
    expect(row.category).toBe('source_refused');
    expect(row.domain).toBe('file');
    expect(row.attempts).toBe(3);
    expect(row.needsDecision).toBe(true);
    // The handle Retry and Accept send, and what support finds the row by.
    expect(row.naturalKeyHash).toBe('f'.repeat(64));
  });

  it('leaves no word of the original anywhere in the row', () => {
    const serialised = JSON.stringify(withheldFailure(failure));
    expect(serialised).not.toContain('Divorce');
    expect(serialised).not.toContain('lawyer');
  });
});

describe("the preflight's count, for an account a person granted", () => {
  const counted: DiscoveryRecord = {
    domain: 'file',
    collections: 4,
    items: 120,
    bytes: 1_000,
    discoveredAt: '2026-10-01T10:00:00.000Z',
    lastError: 'PROPFIND /Personal/Divorce lawyer: 403 Forbidden',
  };
  const neverCounted: DiscoveryRecord = { ...counted, domain: 'email', collections: 0, items: 0, bytes: 0 };
  const fine: DiscoveryRecord = { ...counted, domain: 'contact' };
  delete (fine as { lastError?: string }).lastError;

  it("keeps the counts and drops the provider's words, saying the count failed", () => {
    const [row] = withheldDiscovery([counted]);
    expect(row).not.toHaveProperty('lastError');
    expect(row!.lastErrorWithheld).toBe(true);
    expect(row!.items).toBe(120);
    expect(JSON.stringify(withheldDiscovery([counted, neverCounted]))).not.toContain('Divorce');
  });

  it('leaves a row with no error as it is', () => {
    expect(withheldDiscovery([fine])).toEqual([fine]);
  });

  it('is still a failure to every reader that asks: kept back is not gone', () => {
    const shown = withheldDiscovery([counted, neverCounted, fine]);
    expect(shown.map(discoveryFailed)).toEqual([true, true, false]);
    // The count from before the error is still flagged as older than the error...
    expect(domainsCountedBeforeTheirError(shown)).toEqual(['file']);
    // ...and a first count that failed still has no total.
    expect(Object.keys(foundByDomain(shown)).sort()).toEqual(['contact', 'file']);
  });
});


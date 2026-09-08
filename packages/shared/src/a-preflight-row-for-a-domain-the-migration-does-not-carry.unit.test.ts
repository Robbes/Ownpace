// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE FOSSIL ROW (2026-09-08).
 *
 * The owner ran a preflight over a Google mapping and read a Tasks row: 6
 * collections, 180 items, 857.5 MB — byte for byte the Files row above it. His
 * Tasks tick has never been on. Nobody had counted his tasks; a pass from
 * before #854 had counted his DRIVE and filed the answer under `task`, because
 * the job defaulted to all five domains and `task` fell through to the FILE
 * deps.
 *
 * #854 stopped the job writing that row. `migration_discovery` is keyed by
 * (tenant, mapping, domain) and nothing deletes from it, so the row already
 * written stayed written, and the confirm screen kept presenting it as part of
 * what was about to be migrated.
 *
 * Two questions, kept apart, because they fail differently:
 *
 *  - IS THIS ROW THIS MIGRATION'S? `discoveryForSelection` — a stored row
 *    belongs on the screen only while the mapping still carries its domain.
 *  - ARE ITS NUMBERS THIS ATTEMPT'S? `domainsCountedBeforeTheirError` — a row
 *    holding a count AND an error is one whose count came from an earlier
 *    pass, because `recordDiscoveryError` writes zeroes when there was nothing
 *    to keep.
 *
 * Both are pure so they can be asked of fake rows rather than of a database,
 * which is the same reason `domainsToCount` is exported from the job.
 */

import { describe, it, expect } from 'vitest';
import {
  DISCOVERY_DOMAINS,
  discoveryForSelection,
  domainsCountedBeforeTheirError,
  type DiscoveryDomain,
  type DiscoveryRecord,
} from './discovery.ts';

function row(over: Partial<DiscoveryRecord> & { domain: DiscoveryDomain }): DiscoveryRecord {
  return {
    collections: 1,
    items: 10,
    discoveredAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

describe('the rows a preflight is entitled to show', () => {
  it("drops the Tasks row a Google mapping carrying no tasks was still being shown", () => {
    // The owner's own screen: Files and Tasks holding identical numbers,
    // because one pass counted Drive twice and filed half of it under `task`.
    const stored = [
      row({ domain: 'calendar', collections: 4, items: 900 }),
      row({ domain: 'file', collections: 6, items: 180, bytes: 899_284_070 }),
      row({ domain: 'task', collections: 6, items: 180, bytes: 899_284_070 }),
    ];

    const shown = discoveryForSelection(stored, ['calendar', 'contact', 'file']);

    expect(shown.map((r) => r.domain)).toEqual(['calendar', 'file']);
    // Not merely absent from the list — the numbers themselves are gone, which
    // is the part the owner was reading.
    expect(shown.some((r) => r.bytes === 899_284_070 && r.domain === 'task')).toBe(false);
  });

  it('keeps a domain that is selected but has not been counted out of the answer entirely', () => {
    // Selection is not a promise that a row exists. A domain with nothing
    // stored yields nothing here; the confirm screen says "still counting"
    // about it from the selection, not from an invented empty row.
    const shown = discoveryForSelection([row({ domain: 'email' })], ['email', 'contact']);
    expect(shown.map((r) => r.domain)).toEqual(['email']);
  });

  it('answers with nothing when the mapping has selected nothing', () => {
    // No `scope_selection` row means "not selected" — here exactly as in the
    // tick, the sync job and `domainsToCount`. Filling an empty selection back
    // in with every domain is the defect this exists to stop.
    expect(discoveryForSelection(DISCOVERY_DOMAINS.map((domain) => row({ domain })), [])).toEqual([]);
  });

  it('shows every stored row when the mapping carries every domain', () => {
    const stored = DISCOVERY_DOMAINS.map((domain) => row({ domain }));
    expect(discoveryForSelection(stored, DISCOVERY_DOMAINS).map((r) => r.domain)).toEqual([
      ...DISCOVERY_DOMAINS,
    ]);
  });

  it('preserves the order the store sorted the rows into', () => {
    const stored = [row({ domain: 'calendar' }), row({ domain: 'email' }), row({ domain: 'file' })];
    expect(discoveryForSelection(stored, ['file', 'calendar', 'email']).map((r) => r.domain)).toEqual([
      'calendar',
      'email',
      'file',
    ]);
  });

  it('carries exactly one domain through for each of the five, and the other four not', () => {
    // Derived over the whole domain list rather than hand-picked cases, so a
    // sixth domain cannot arrive with only some of them thought about.
    const stored = DISCOVERY_DOMAINS.map((domain) => row({ domain }));
    for (const selected of DISCOVERY_DOMAINS) {
      expect(discoveryForSelection(stored, [selected]).map((r) => r.domain)).toEqual([selected]);
    }
  });
});

describe('the numbers that predate their error', () => {
  it("names the Files row showing an older count beside today's failure", () => {
    // The owner's Microsoft preflight: a full Files count and a rate-budget
    // error in one row, with nothing saying which of the two was current.
    const rows = [
      row({ domain: 'calendar', collections: 2, items: 30 }),
      row({
        domain: 'file',
        collections: 3430,
        items: 95_734,
        bytes: 23_193_571_328,
        lastError: 'relation "rate_budget" does not exist',
      }),
    ];

    expect(domainsCountedBeforeTheirError(rows)).toEqual(['file']);
  });

  it('says nothing about a domain that failed with nothing to keep', () => {
    // `recordDiscoveryError` inserts zeroes when no pass ever succeeded. That
    // row's error IS its whole answer, and calling its numbers "from an
    // earlier check" would invent an earlier check.
    const rows = [row({ domain: 'task', collections: 0, items: 0, lastError: 'Tasks.Read not granted' })];
    expect(domainsCountedBeforeTheirError(rows)).toEqual([]);
  });

  it('says nothing about a domain whose latest pass succeeded', () => {
    expect(domainsCountedBeforeTheirError([row({ domain: 'email', items: 4200 })])).toEqual([]);
  });

  it('catches a row with collections but no items, and one with items but no collections', () => {
    // Either number on its own is a number on the screen, so either is enough
    // to make the row's count older than its error.
    const rows = [
      row({ domain: 'calendar', collections: 5, items: 0, lastError: 'timed out' }),
      row({ domain: 'contact', collections: 0, items: 9, lastError: 'timed out' }),
    ];
    expect(domainsCountedBeforeTheirError(rows)).toEqual(['calendar', 'contact']);
  });

  it('reads an empty error string as no error, not as a failure', () => {
    // The store writes NULL for "no error" and the record drops the field, but
    // an empty string arriving over the wire must not turn a good count into a
    // caveat.
    expect(domainsCountedBeforeTheirError([row({ domain: 'email', lastError: '' })])).toEqual([]);
  });
});

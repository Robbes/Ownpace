// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `operator.sh links` (workplan 0108 T8 (d)): what the command reads from its
 * arguments, and what it prints. The writes run on a real Postgres in
 * `operator-links.integration.test.ts`.
 *
 *  - an organisation's id alone shows where it stands; a number sets it, for
 *    good or through a day; `--tier` clears it;
 *  - anything else is refused by name before the database is touched: an id
 *    that is not one, a number out of range or not a whole one, a day that is
 *    not a day or has passed, a note too long;
 *  - `--until` a day means through that day, UTC, and the output names that
 *    day, not the moment after it.
 */

import { describe, it, expect } from 'vitest';
import { MANAGED_TIERS } from '@openmig/managed';
import { describeStanding, parseLinksCommand } from './operator-links.ts';

const TENANT = '7c1b0000-e29b-41d4-a716-446655440001';
const NOW = new Date('2026-09-24T12:00:00Z');
const tier = (id: string) => MANAGED_TIERS.find((t) => t.id === id)!;

describe('what the command reads', () => {
  it('shows where an organisation stands, given its id alone', () => {
    expect(parseLinksCommand([TENANT], NOW)).toEqual({ kind: 'show', tenantId: TENANT });
    expect(parseLinksCommand([TENANT.toUpperCase()], NOW)).toEqual({ kind: 'show', tenantId: TENANT });
  });

  it('sets a number until it is cleared, with a note', () => {
    expect(parseLinksCommand([TENANT, '30', 'onboarding', 'week'], NOW)).toEqual({
      kind: 'set',
      tenantId: TENANT,
      liveLinks: 30,
      until: null,
      note: 'onboarding week',
    });
  });

  it('sets a number through a day, UTC: until the start of the next', () => {
    expect(parseLinksCommand([TENANT, '30', '--until', '2026-10-01'], NOW)).toEqual({
      kind: 'set',
      tenantId: TENANT,
      liveLinks: 30,
      until: new Date('2026-10-02T00:00:00.000Z'),
      note: null,
    });
    // Today still counts: it applies through the end of it.
    expect(parseLinksCommand([TENANT, '2', '--until', '2026-09-24'], NOW)).toMatchObject({ kind: 'set' });
  });

  it('clears it with --tier', () => {
    expect(parseLinksCommand([TENANT, '--tier'], NOW)).toEqual({ kind: 'clear', tenantId: TENANT });
  });

  it('refuses what is not one, by name, before anything is read', () => {
    const refused = (args: string[]) => (parseLinksCommand(args, NOW) as { error?: string }).error ?? '';

    expect(refused([])).toMatch(/needs an organisation's id/);
    expect(refused(['acme'])).toMatch(/needs an organisation's id/);
    for (const n of ['0', '1001', '2.5', '-3', 'many']) {
      expect(refused([TENANT, n]), n).toMatch(/a whole number from 1 to 1000/);
    }
    expect(refused([TENANT, '5', '--until'])).toMatch(/--until takes a day/);
    expect(refused([TENANT, '5', '--until', 'friday'])).toMatch(/--until takes a day/);
    expect(refused([TENANT, '5', '--until', '2026-02-30'])).toMatch(/--until takes a day/);
    expect(refused([TENANT, '5', '--until', '2026-09-23'])).toMatch(/has already passed/);
    expect(refused([TENANT, '5', 'x'.repeat(201)])).toMatch(/at most 200 characters/);
    expect(refused([TENANT, '--tier', 'now'])).toMatch(/--tier takes nothing after it/);
  });
});

describe('what it prints', () => {
  const base = { name: 'Example Works BV', live: 2, allowance: undefined };

  it("names the tier when the tier's number applies", () => {
    const small = { limit: 4, from: { kind: 'tier', tier: tier('small') } } as const;

    expect(describeStanding({ ...base, limit: small, tierLimit: small })).toEqual([
      'Example Works BV: 2 live grant links, may hold 4 at once (its tier, Small).',
    ]);
  });

  it("names the last day an override applies, the tier's number without it, and who set it", () => {
    const until = new Date('2026-10-02T00:00:00.000Z');
    const lines = describeStanding({
      ...base,
      live: 1,
      limit: { limit: 30, from: { kind: 'override', until } },
      tierLimit: { limit: 1, from: { kind: 'tier', tier: tier('tiny') } },
      allowance: {
        liveLinks: 30,
        until,
        setBy: 'operator.sh ops@host',
        setAt: new Date('2026-09-24T09:00:00Z'),
        note: 'onboarding week',
      },
    });

    expect(lines).toEqual([
      'Example Works BV: 1 live grant link, may hold 30 at once (set for it through 2026-10-01, UTC).',
      "Without it, the tier's number: 1.",
      'Set by operator.sh ops@host on 2026-09-24: onboarding week',
    ]);
  });

  it('says so when an override has ended', () => {
    const tiny = { limit: 1, from: { kind: 'tier', tier: tier('tiny') } } as const;
    const lines = describeStanding({
      ...base,
      limit: tiny,
      tierLimit: tiny,
      allowance: {
        liveLinks: 30,
        until: new Date('2026-09-20T00:00:00Z'),
        setBy: 'operator.sh ops@host',
        setAt: new Date('2026-09-10T09:00:00Z'),
        note: null,
      },
    });

    expect(lines.at(-1)).toBe('It has ended; the tier’s number applies.');
  });
});

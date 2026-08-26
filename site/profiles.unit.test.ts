// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The assumptions behind the pre-preflight, guarded (workplan 0088 T2).
 *
 * The plan's rule: a missing cell must be an ERROR rather than an omitted row
 * — the same reason `adr-operative.mjs` throws on an empty section instead of
 * dropping it. So this test refuses every silent gap the table could grow:
 * a customer type without every object type, a cell without provenance, a
 * table without a version, and — the single easiest way for it to start
 * lying — a paths count that stops following from what is ticked.
 *
 * The v1 numbers are pinned as literals. That is not distrust of the table;
 * it is what makes an edit DELIBERATE: changing an assumption must touch the
 * test and the version together, because a quoted estimate gets screenshotted
 * exactly like a quoted price.
 */

import { describe, it, expect } from 'vitest';
import {
  CUSTOMER_TYPES,
  INDICATIVE_PROFILES,
  OBJECT_TYPES,
  PROFILES_VERSION,
  indicativeGb,
  pathsFor,
} from './profiles.mjs';

describe('no silent gaps', () => {
  it('covers every customer type × every object type', () => {
    for (const who of CUSTOMER_TYPES) {
      const profile = INDICATIVE_PROFILES[who.id];
      expect(profile, `${who.id}: no profile at all`).toBeDefined();
      for (const obj of OBJECT_TYPES) {
        const cell = profile![obj];
        expect(cell, `${who.id}.${obj}: missing cell — a gap must be an error, not an omission`).toBeDefined();
        expect(cell!.items, `${who.id}.${obj}.items`).toBeGreaterThan(0);
        expect(cell!.gb, `${who.id}.${obj}.gb`).toBeGreaterThan(0);
      }
    }
  });

  it('declares no customer type or object type the other tables do not know', () => {
    // The reverse direction: a profile for a type the page cannot offer is a
    // number nobody can ever see or argue with.
    // Widened to string on purpose: the whole point of this direction is
    // asking about keys the const-typed table does NOT know.
    const knownWho = new Set<string>(CUSTOMER_TYPES.map((c) => c.id));
    for (const key of Object.keys(INDICATIVE_PROFILES)) {
      expect(knownWho.has(key), `profile for unknown customer type "${key}"`).toBe(true);
      for (const obj of Object.keys(INDICATIVE_PROFILES[key]!)) {
        expect(
          (OBJECT_TYPES as readonly string[]).includes(obj),
          `${key}: profile for unknown object type "${obj}"`,
        ).toBe(true);
      }
    }
  });

  it('every cell says where its number came from', () => {
    for (const who of CUSTOMER_TYPES) {
      for (const obj of OBJECT_TYPES) {
        const cell = INDICATIVE_PROFILES[who.id]![obj]!;
        expect(cell.provenance.length, `${who.id}.${obj}: provenance is the point`).toBeGreaterThan(20);
      }
    }
  });

  it('carries a version, a date, and an honest measured flag', () => {
    expect(PROFILES_VERSION.version).toBeGreaterThanOrEqual(1);
    expect(PROFILES_VERSION.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // v1 is judgement, and must say so. Flipping this to true belongs to the
    // change that swaps the numbers for migration_discovery medians.
    expect(PROFILES_VERSION.measured).toBe(false);
    expect(PROFILES_VERSION.source).toContain('migration_discovery');
  });
});

describe('paths are derived, never declared', () => {
  it("follows the plan's own worked examples", () => {
    // "an individual with mail, contacts, calendar and files is four, not one"
    expect(pathsFor('individual', ['mail', 'contacts', 'calendar', 'files'])).toBe(4);
    // The plan's ranges: individual 4–5, family 16–20 — the spread is exactly
    // the photos tick.
    expect(pathsFor('individual', [...OBJECT_TYPES])).toBe(5);
    expect(pathsFor('family', ['mail', 'contacts', 'calendar', 'files'])).toBe(16);
    expect(pathsFor('family', [...OBJECT_TYPES])).toBe(20);
    expect(pathsFor('sme', ['mail', 'contacts', 'calendar', 'files'])).toBe(40);
  });

  it('one thing ticked is accounts-many paths, and nothing ticked is none', () => {
    expect(pathsFor('family', ['mail'])).toBe(4);
    expect(pathsFor('sme', [])).toBe(0);
  });

  it('ignores a tick it does not know rather than counting it', () => {
    expect(pathsFor('individual', ['mail', 'ponies'])).toBe(1);
  });

  it('refuses an unknown customer type by name', () => {
    expect(() => pathsFor('enterprise', ['mail'])).toThrow(/enterprise/);
  });
});

describe('the data axis follows the ticks', () => {
  it('sums exactly the ticked cells', () => {
    expect(indicativeGb('individual', ['mail', 'files'])).toBeCloseTo(38, 5);
    expect(indicativeGb('family', [...OBJECT_TYPES])).toBeCloseTo(30 + 0.1 + 0.5 + 120 + 250, 5);
  });
});

describe('the v1 numbers, pinned so an edit is deliberate', () => {
  it('matches the transcribed plan table (bump PROFILES_VERSION with any change)', () => {
    const flat = Object.fromEntries(
      CUSTOMER_TYPES.map((who) => [
        who.id,
        Object.fromEntries(
          OBJECT_TYPES.map((obj) => {
            const { items, gb } = INDICATIVE_PROFILES[who.id]![obj]!;
            return [obj, { items, gb }];
          }),
        ),
      ]),
    );
    expect(flat).toEqual({
      individual: {
        mail: { items: 20_000, gb: 8 },
        contacts: { items: 300, gb: 0.1 },
        calendar: { items: 2_000, gb: 0.2 },
        files: { items: 10_000, gb: 30 },
        photos: { items: 15_000, gb: 60 },
      },
      family: {
        mail: { items: 80_000, gb: 30 },
        contacts: { items: 1_200, gb: 0.1 },
        calendar: { items: 8_000, gb: 0.5 },
        files: { items: 40_000, gb: 120 },
        photos: { items: 60_000, gb: 250 },
      },
      sme: {
        mail: { items: 400_000, gb: 160 },
        contacts: { items: 5_000, gb: 0.2 },
        calendar: { items: 40_000, gb: 2 },
        files: { items: 250_000, gb: 600 },
        photos: { items: 150_000, gb: 600 },
      },
    });
    expect(PROFILES_VERSION.version).toBe(1);
  });
});

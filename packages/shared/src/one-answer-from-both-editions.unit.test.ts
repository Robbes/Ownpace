// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE ANSWER FROM BOTH EDITIONS (ADR-0050, amended by the owner on 2026-09-28;
 * ADR-0026): `people.ts`'s two builders.
 *
 * Managed reads people from two tables and builds its answer with
 * `peopleFrom`; the appliance has one implicit person and builds its answer
 * with `implicitPeople`. One screen reads both, so the two must be one shape:
 * the same keys on a person, every state counted on both, and a state neither
 * knows shown as a fault rather than counted as nothing.
 */

import { describe, it, expect } from 'vitest';
import { MAPPING_LIFECYCLES, type MappingLifecycle } from './operating-contract.ts';
import { IMPLICIT_PERSON_ID, implicitPeople, lifecycleCounts, peopleFrom, type MigrationRow } from './people.ts';

const ANNA = { id: 'p-anna', displayName: 'Anna', email: 'anna@example.org', createdAt: '2026-09-28T10:00:00.000Z' };
const BRAM = { id: 'p-bram', displayName: 'Bram', email: null, createdAt: '2026-09-28T11:00:00.000Z' };

const row = (id: string, status: MappingLifecycle, personId: string | null): MigrationRow => ({ id, status, personId });

describe('managed’s answer, from its rows', () => {
  it('puts each migration under its person, in the order given, and the rest as nobody’s', () => {
    const got = peopleFrom(
      [ANNA, BRAM],
      [row('m-mail', 'active', ANNA.id), row('m-old', 'done', null), row('m-files', 'paused', ANNA.id)],
    );

    expect(got.people.map((p) => [p.displayName, p.migrations.map((m) => m.id)])).toEqual([
      ['Anna', ['m-mail', 'm-files']],
      ['Bram', []],
    ]);
    expect(got.unassigned).toEqual([{ id: 'm-old', status: 'done' }]);
    expect(got.people[0]!.counts).toMatchObject({ active: 1, paused: 1, done: 0 });
    expect(got.people[0]).toMatchObject({ implicit: false, email: 'anna@example.org', createdAt: ANNA.createdAt });
  });

  it('refuses a migration naming a person it was not handed: a fault, not somebody nobody knows', () => {
    expect(() => peopleFrom([BRAM], [row('m-mail', 'active', ANNA.id)])).toThrow(/p-anna/);
  });
});

describe('the appliance’s answer', () => {
  it('is one implicit person with every migration, and nobody unassigned', () => {
    const got = implicitPeople([
      { id: 'calendar', status: 'active' },
      { id: 'contacts', status: 'done' },
    ]);

    expect(got.unassigned).toEqual([]);
    expect(got.people).toHaveLength(1);
    expect(got.people[0]).toMatchObject({
      id: IMPLICIT_PERSON_ID,
      implicit: true,
      displayName: null,
      email: null,
      createdAt: null,
      migrations: [
        { id: 'calendar', status: 'active' },
        { id: 'contacts', status: 'done' },
      ],
    });
  });
});

describe('one shape', () => {
  it('a person has the same keys on both editions, and so do their counts', () => {
    const managed = peopleFrom([ANNA], [row('m-mail', 'active', ANNA.id)]);
    const appliance = implicitPeople([{ id: 'calendar', status: 'active' }]);

    expect(Object.keys(appliance).sort()).toEqual(Object.keys(managed).sort());
    expect(Object.keys(appliance.people[0]!).sort()).toEqual(Object.keys(managed.people[0]!).sort());
    expect(Object.keys(appliance.people[0]!.counts).sort()).toEqual(Object.keys(managed.people[0]!.counts).sort());
  });

  it('counts every state, nought included, and a person with nothing counts nought everywhere', () => {
    const counts = lifecycleCounts([]);

    expect(Object.keys(counts).sort()).toEqual([...MAPPING_LIFECYCLES].sort());
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it('shows a state it does not know as a fault, never as nothing (hard rule 9)', () => {
    for (const status of ['archived', 'toString', '']) {
      expect(() => lifecycleCounts([{ id: 'm', status: status as MappingLifecycle }]), status).toThrow(/not one of/);
    }
  });
});

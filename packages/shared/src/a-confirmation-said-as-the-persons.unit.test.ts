// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CONFIRMATION SAID AS THE PERSON'S (workplan 0168 §4.4, D6; the review's
 * B3).
 *
 * A person who confirms their own new address through their grant or progress
 * link has no sign-in, so there is no subject to store. The confirmation is
 * stored as theirs, `person:<id>` (`confirmedByPerson`), and `saidBy` says it
 * as `labelOf` names that person, which is their name and no address. Every
 * other stored value is said as before: an address, or the appliance's own
 * words, and never an id. The appliance, which has no people, says it as
 * nobody.
 */

import { describe, it, expect } from 'vitest';
import {
  ADDRESS_CHANGE_OPERATOR,
  ADDRESS_CHANGES_FILE,
  CONFIRMED_BY_PERSON,
  confirmedByPerson,
  personWhoConfirmed,
  saidBy,
} from './address-change-table.ts';

const KID = '0168b3d1-e29b-41d4-a716-446655443041';

describe('a confirmation through a person’s own link', () => {
  it('is stored as the person, and read back as the person', () => {
    expect(confirmedByPerson(KID)).toBe(`${CONFIRMED_BY_PERSON}${KID}`);
    expect(personWhoConfirmed(confirmedByPerson(KID))).toBe(KID);
    for (const other of [null, 'subject-1', ADDRESS_CHANGE_OPERATOR, ADDRESS_CHANGES_FILE, CONFIRMED_BY_PERSON]) {
      expect(personWhoConfirmed(other)).toBeNull();
    }
  });

  it('is said as the person’s name, which is no address', () => {
    const names = new Map([[confirmedByPerson(KID), 'Kid']]);
    expect(saidBy(confirmedByPerson(KID), (s) => names.get(s) ?? null)).toBe('Kid');
  });

  it('is never said as the id, the stored value or an empty name, and is nobody where nobody is named', () => {
    const stored = confirmedByPerson(KID);
    expect(saidBy(stored, () => null)).toBeNull();
    expect(saidBy(stored, () => KID)).toBeNull();
    expect(saidBy(stored, () => stored)).toBeNull();
    expect(saidBy(stored, () => '  ')).toBeNull();
  });

  it('leaves every other value said as it was: an address or the appliance’s words, never an id', () => {
    expect(saidBy('operator', () => null)).toBe('operator');
    expect(saidBy('address-changes.json', () => null)).toBe('address-changes.json');
    expect(saidBy('subject-1', () => 'member@example.org')).toBe('member@example.org');
    // A member's subject is still said only as an address, not as a name.
    expect(saidBy('subject-1', () => 'Kid')).toBeNull();
    expect(saidBy('subject-1', () => 'subject-1')).toBeNull();
    expect(saidBy(null, () => 'member@example.org')).toBeNull();
  });
});

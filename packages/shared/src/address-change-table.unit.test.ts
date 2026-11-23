// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The table of address changes' rules, refusals and file door (ADR-0055;
 * workplan 0168 T2, §4.2, §7), without a database.
 *
 *  - every refusal is said in both languages, and the halves differ;
 *  - `checkAddressChange` refuses a value that is not an address, the old
 *    address in another spelling, a second row for an old address, and a
 *    chain in either direction, naming the row;
 *  - `address-changes.json` is read, and refused when it is malformed, naming
 *    the file and what is wrong.
 */

import { describe, it, expect } from 'vitest';
import { addressKey } from './address-forms.ts';
import {
  ADDRESS_CHANGE_ROWS_MAX,
  addressChangeNotFound,
  alreadyChanged,
  chainedBack,
  chainedOnward,
  checkAddressChange,
  CONFIRMED_HERE,
  fileDoor,
  NO_PERSON_HERE,
  notAnAddress,
  notYourAddressChange,
  ownerOrAdminOnly,
  parseAddressChangesFile,
  personNotFound,
  refusalStatus,
  sameAddress,
  saidBy,
  tooManyAddressChanges,
  type StoredAddressChange,
} from './address-change-table.ts';

const ROW: StoredAddressChange = {
  oldKey: 'ab@gmail.com',
  oldAddress: 'a.b@gmail.com',
  newAddress: 'ab@example.org',
  state: 'confirmed',
  setBy: 'subject',
  confirmedBy: 'subject',
  createdAt: '2026-11-22T00:00:00.000Z',
  confirmedAt: '2026-11-22T00:00:00.000Z',
};

describe('every refusal, in both languages', () => {
  const all = [
    notAnAddress('oldAddress', 'nobody'),
    notAnAddress('newAddress', 'nobody'),
    sameAddress('a@example.org', 'A@example.org'),
    alreadyChanged(ROW),
    chainedOnward(ROW),
    chainedBack(ROW, 'later@example.org'),
    addressChangeNotFound('x@example.org'),
    fileDoor(),
  ];
  it.each(all.map((r) => [r.error, r]))('%s has an English and a different Dutch sentence', (_e, r) => {
    expect(r.message.length).toBeGreaterThan(20);
    expect(r.messageNl.length).toBeGreaterThan(20);
    expect(r.messageNl).not.toBe(r.message);
  });
  it('the appliance-only sentences differ too', () => {
    for (const b of [NO_PERSON_HERE, CONFIRMED_HERE]) expect(b.nl).not.toBe(b.en);
  });
  it('answers each with its status', () => {
    expect(all.map(refusalStatus)).toEqual([400, 400, 400, 409, 409, 409, 404, 409]);
  });
  it('names the row it is about, and the file', () => {
    expect(chainedOnward(ROW).row).toEqual({ oldAddress: 'a.b@gmail.com', oldKey: 'ab@gmail.com', newAddress: 'ab@example.org' });
    expect(fileDoor().file).toBe('address-changes.json');
    expect(fileDoor().messageNl).toContain('address-changes.json');
  });
});

// 0168's review: who may write (finding 1), the person not found in Dutch too
// (finding 9, N7) and the table's size (finding 11) are refusals like the
// others, in both languages, each with its status.
describe('the refusals the review added', () => {
  const added = [ownerOrAdminOnly(), notYourAddressChange(), personNotFound(), tooManyAddressChanges()];
  it.each(added.map((r) => [r.error, r]))('%s has an English and a different Dutch sentence', (_e, r) => {
    expect(r.message.length).toBeGreaterThan(20);
    expect(r.messageNl.length).toBeGreaterThan(20);
    expect(r.messageNl).not.toBe(r.message);
  });
  it('answers who may write with 403, the person with 404 and a full table with 409', () => {
    expect(added.map((r) => [r.error, refusalStatus(r)])).toEqual([
      ['owner_or_admin_only', 403],
      ['not_your_address_change', 403],
      ['person_not_found', 404],
      ['too_many_address_changes', 409],
    ]);
  });
  it('says the person not found in the people pages’ own words', () => {
    expect(personNotFound()).toMatchObject({ message: 'There is no such person here.', messageNl: 'Deze persoon bestaat hier niet.' });
  });
  it('names the most a table holds', () => {
    expect(tooManyAddressChanges().message).toContain(String(ADDRESS_CHANGE_ROWS_MAX));
    expect(tooManyAddressChanges().messageNl).toContain(String(ADDRESS_CHANGE_ROWS_MAX));
  });
});

// N6 of 0168's review: the dictionary says *de appliance*; *dit apparaat* is
// the reader's own device (`setup.admin.hint`).
describe('the appliance, in Dutch', () => {
  it('is de appliance, never dit apparaat', () => {
    for (const b of [NO_PERSON_HERE, CONFIRMED_HERE]) {
      expect(b.nl).toMatch(/\bdeze appliance\b/i);
      expect(b.nl).not.toMatch(/apparaat/i);
    }
  });
});

describe('checkAddressChange', () => {
  it('passes a fresh change, with its key', () => {
    expect(checkAddressChange([ROW], { oldAddress: 'c@example.net', newAddress: 'c@example.org' })).toEqual({
      ok: true,
      oldKey: 'c@example.net',
      same: null,
    });
  });
  it('answers the same change as the row it already is', () => {
    const r = checkAddressChange([ROW], { oldAddress: 'AB+x@googlemail.com', newAddress: 'ab@example.org' });
    expect(r.ok && r.same).toBe(ROW);
  });
  it.each([
    ['nobody', 'x@example.org', 'not_an_address'],
    ['x@example.org', 'not an address', 'not_an_address'],
    ['x@example.org', 'X@EXAMPLE.ORG', 'same_address'],
    ['ab@gmail.com', 'other@example.org', 'already_changed'],
    ['kid@example.net', 'a.b+y@gmail.com', 'chained'],
    ['ab@example.org', 'later@example.org', 'chained'],
  ])('%s → %s is %s', (oldAddress, newAddress, error) => {
    const r = checkAddressChange([ROW], { oldAddress, newAddress });
    expect(r.ok ? 'ok' : r.refusal.error).toBe(error);
  });
  it('leaves the row being changed out of the comparison', () => {
    expect(checkAddressChange([ROW], { oldAddress: 'a.b@gmail.com', newAddress: 'new@example.org' }, 'ab@gmail.com').ok).toBe(true);
  });

  // 0168's review, finding 3: these passed the check and then failed the
  // write with a 500, its log line carrying both addresses.
  it('refuses an old address with a NUL in it as not an address, before anything stores it', () => {
    const r = checkAddressChange([], { oldAddress: 'mum\u0000@example.com', newAddress: 'mum@example.org' });
    expect(r.ok ? 'ok' : [r.refusal.error, r.refusal.field]).toEqual(['not_an_address', 'oldAddress']);
    const n = checkAddressChange([], { oldAddress: 'mum@example.com', newAddress: 'mum\u0000@example.org' });
    expect(n.ok ? 'ok' : [n.refusal.error, n.refusal.field]).toEqual(['not_an_address', 'newAddress']);
  });

  it('refuses an old address whose key is longer than the table holds, though the address as typed is not', () => {
    // 254 characters as typed; `İ` is two once lower-cased, so the key is 255.
    const oldAddress = `İ${'a'.repeat(241)}@example.org`;
    expect(oldAddress.length).toBe(254);
    const r = checkAddressChange([], { oldAddress, newAddress: 'me@example.org' });
    expect(r.ok ? 'ok' : [r.refusal.error, r.refusal.field]).toEqual(['not_an_address', 'oldAddress']);
    // One character shorter, the key is 254, and the row is taken.
    expect(addressKey(`İ${'a'.repeat(240)}@example.org`)).toHaveLength(254);
    expect(checkAddressChange([], { oldAddress: `İ${'a'.repeat(240)}@example.org`, newAddress: 'me@example.org' }).ok).toBe(true);
  });

  // 0168's review, finding 11: a table nobody the table is for reaches.
  describe(`at ${ADDRESS_CHANGE_ROWS_MAX} rows`, () => {
    const full: StoredAddressChange[] = Array.from({ length: ADDRESS_CHANGE_ROWS_MAX }, (_, i) => ({
      ...ROW,
      oldKey: `old${i}@example.com`,
      oldAddress: `old${i}@example.com`,
      newAddress: `new${i}@example.org`,
    }));
    it('refuses a new row, in both languages', () => {
      const r = checkAddressChange(full, { oldAddress: 'one-more@example.com', newAddress: 'one-more@example.org' });
      expect(r.ok ? 'ok' : r.refusal.error).toBe('too_many_address_changes');
    });
    it('takes it with one row fewer', () => {
      expect(checkAddressChange(full.slice(1), { oldAddress: 'one-more@example.com', newAddress: 'one-more@example.org' }).ok).toBe(true);
    });
    it('still answers the same change again with its row, and still changes a row', () => {
      const same = checkAddressChange(full, { oldAddress: 'old7@example.com', newAddress: 'new7@example.org' });
      expect(same.ok && same.same?.oldKey).toBe('old7@example.com');
      expect(checkAddressChange(full, { oldAddress: 'old7@example.com', newAddress: 'other@example.org' }, 'old7@example.com').ok).toBe(true);
    });
  });
});

describe('address-changes.json', () => {
  it('reads the changes, keyed', () => {
    expect(
      parseAddressChangesFile(JSON.stringify({ changes: [{ oldAddress: ' A.B@gmail.com ', newAddress: 'ab@example.org' }] })),
    ).toEqual([{ oldKey: 'ab@gmail.com', oldAddress: 'A.B@gmail.com', newAddress: 'ab@example.org' }]);
  });
  it('reads an empty list as an empty table', () => {
    expect(parseAddressChangesFile('{"changes": []}')).toEqual([]);
  });
  it.each([
    ['not JSON', '{changes:', /not JSON/],
    ['a list at the top', '[]', /object with a "changes" list/],
    ['no changes list', '{"changes": {}}', /must be a list/],
    ['an unknown field', '{"changes": [], "tenant": "x"}', /does not take: "tenant"/],
    ['a row missing a field', '{"changes": [{"oldAddress": "a@example.net"}]}', /change 1 needs/],
    ['a row with a state', '{"changes": [{"oldAddress": "a@example.net", "newAddress": "a@example.org", "state": "proposed"}]}', /does not take: "state"/],
    ['a value that is not an address', '{"changes": [{"oldAddress": "nobody", "newAddress": "a@example.org"}]}', /change 1: The old address "nobody"/],
    [
      'a chain inside the file',
      '{"changes": [{"oldAddress": "a@example.net", "newAddress": "b@example.net"}, {"oldAddress": "b@example.net", "newAddress": "c@example.org"}]}',
      /change 2: a@example.net already becomes b@example.net/,
    ],
    [
      'a repeated row',
      '{"changes": [{"oldAddress": "a@example.net", "newAddress": "a@example.org"}, {"oldAddress": "A@example.net", "newAddress": "a@example.org"}]}',
      /change 2 repeats/,
    ],
  ])('refuses %s, naming the file', (_what, text, why) => {
    expect(() => parseAddressChangesFile(text)).toThrow(/^Invalid address-changes\.json: /);
    expect(() => parseAddressChangesFile(text)).toThrow(why);
  });

  it(`holds the file to the table's ${ADDRESS_CHANGE_ROWS_MAX} rows`, () => {
    const changes = (n: number) =>
      JSON.stringify({ changes: Array.from({ length: n }, (_, i) => ({ oldAddress: `old${i}@example.com`, newAddress: `new${i}@example.org` })) });
    expect(parseAddressChangesFile(changes(ADDRESS_CHANGE_ROWS_MAX))).toHaveLength(ADDRESS_CHANGE_ROWS_MAX);
    expect(() => parseAddressChangesFile(changes(ADDRESS_CHANGE_ROWS_MAX + 1))).toThrow(
      new RegExp(`^Invalid address-changes\\.json: it lists ${ADDRESS_CHANGE_ROWS_MAX + 1} changes, and a table holds at most ${ADDRESS_CHANGE_ROWS_MAX}\\.$`),
    );
  });
});

describe('who set it, said', () => {
  it('says an address or the appliance’s words, never an id', () => {
    expect(saidBy('operator', () => null)).toBe('operator');
    expect(saidBy('address-changes.json', () => null)).toBe('address-changes.json');
    expect(saidBy('subject-1', () => 'member@example.org')).toBe('member@example.org');
    expect(saidBy('subject-1', () => 'subject-1')).toBeNull();
    expect(saidBy('subject-1', () => null)).toBeNull();
    expect(saidBy(null, () => 'member@example.org')).toBeNull();
  });
});

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
import {
  addressChangeNotFound,
  alreadyChanged,
  chainedBack,
  chainedOnward,
  checkAddressChange,
  CONFIRMED_HERE,
  fileDoor,
  NO_PERSON_HERE,
  notAnAddress,
  parseAddressChangesFile,
  refusalStatus,
  sameAddress,
  saidBy,
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

// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MATCH UNDER AN OLDER ADDRESS TABLE (workplan 0168 T5, S3, S4; ADR-0055
 * decision 5).
 *
 * A contact or an event copied with an address changed is no longer the
 * source's bytes, and the confirmed list must say so: it counts the copies
 * carrying a change and names the table's digest. A copy that a pass found
 * should carry another change (`item.address_digest_due`), and that nothing
 * has written since, is NEVER a match, whatever the re-read said: its hash
 * agreeing with the ledger proves only that it is what we wrote then.
 *
 * A copy's digest is its own since S4 (the rows that decided its bytes), so
 * the list no longer compares it with the table's: the pass's mark decides.
 * That is also what makes a copy written with NO change, before a row was
 * added for an address it names, older (S3): it carries no digest at all, and
 * read as a match before.
 *
 * The last block runs a MUTANT of `confirmed-list.ts` with the mark's check
 * taken out, and shows these assertions catch it: a guard that passes with
 * the rule removed guards nothing.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as real from './confirmed-list.ts';
import { ADDRESS_DIGEST_OF_NO_CHANGE } from './address-changes.ts';

const TABLE = 'f'.repeat(64);
const MINE = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const MATCH = { onTarget: true, comparison: 'match' } as const;

type Module = typeof real;

/** The claims, against one module, so the mutant can be held to them too. */
function claims(m: Module) {
  const row = (
    item: string | null,
    due: string | null,
    status: 'copied' | 'adopted' = 'copied',
    waitsFor?: 'pass' | 'press',
  ) =>
    m.rowFor({
      domain: 'contact',
      status,
      answer: MATCH,
      contentHash: 'card1:x',
      addressDigest: { item, due, ...(waitsFor ? { waitsFor } : {}) },
    });
  return {
    current: row(MINE, null),
    older: row(MINE, OTHER),
    olderPastTheSwitch: row(MINE, OTHER, 'copied', 'press'),
    // Written with no change; a row for an address it names came after (E4).
    neverChanged: row(null, MINE),
    // Its row was deleted or sent back: it should carry no change now.
    rowGone: row(MINE, ADDRESS_DIGEST_OF_NO_CHANGE),
    // A mark that says what the copy already carries is no mark.
    settled: row(MINE, MINE),
    untouched: row(null, null),
    adopted: row(MINE, OTHER, 'adopted'),
    list: (() => {
      const list = m.confirmedListOf({ addressDigest: TABLE });
      for (const r of [row(MINE, null), row(MINE, OTHER), row(null, null), row(null, MINE)]) list.add(r);
      return list.result();
    })(),
  };
}

function holds(m: Module): void {
  const c = claims(m);
  expect(c.current).toEqual({ state: 'verified', claim: 'fingerprint', address: 'changed' });
  expect(c.older).toEqual({ state: 'differs', claim: 'fingerprint', address: 'older', waitsFor: 'pass' });
  expect(m.countsAsVerified(c.older)).toBe(false);
  expect(c.olderPastTheSwitch.waitsFor).toBe('press');
  expect(c.neverChanged.state).toBe('differs');
  expect(c.neverChanged.address).toBe('older');
  expect(c.rowGone.address).toBe('older');
  expect(c.settled).toEqual({ state: 'verified', claim: 'fingerprint', address: 'changed' });
  expect(c.untouched).toEqual({ state: 'verified', claim: 'fingerprint' });
  // The customer's own copy says nothing about a table.
  expect(c.adopted).toEqual({ state: 'yours', claim: 'none' });
  expect(c.list.verified).toBe(2);
  expect(c.list.addressChanges).toEqual({ digest: TABLE, changed: 1, older: 2 });
}

describe('the confirmed list and the address table', () => {
  it('marks a match with the change the table gives it, and never calls one a change waits for a match', () => {
    holds(real);
  });

  it('says nothing about a table when the caller had none to read, exactly as before', () => {
    const r = real.rowFor({ domain: 'contact', status: 'copied', answer: MATCH, contentHash: 'card1:x' });
    expect(r).toEqual({ state: 'verified', claim: 'fingerprint' });
    expect(real.confirmedListOf().result().addressChanges).toBeUndefined();
  });

  it('keeps every other state as it was for a copy a change waits for, marked', () => {
    const r = real.rowFor({
      domain: 'calendar',
      status: 'updated',
      answer: { onTarget: false },
      contentHash: 'cal1:x',
      addressDigest: { item: MINE, due: OTHER },
    });
    expect(r).toEqual({ state: 'missing', claim: 'none', address: 'older', waitsFor: 'pass' });
  });
});

/**
 * NO VERSION TO GUARD THE WRITE (workplan 0168 S1, and its finding on the
 * way). A copy that waits with no strong target version is left as it is by
 * every pass and every press, so it waits for neither, and says so.
 */
describe('a copy no pass changes, in the confirmed list', () => {
  const waiting = (targetVersion: string | null | undefined, waitsFor: 'pass' | 'press' = 'pass') =>
    real.rowFor({
      domain: 'contact',
      status: 'copied',
      answer: MATCH,
      contentHash: 'card1:x',
      addressDigest: { item: MINE, due: OTHER, waitsFor, ...(targetVersion !== undefined ? { targetVersion } : {}) },
    });

  it.each([
    ['no version', null],
    ['an empty one', ''],
    ['a weak one', 'W/abc'],
  ] as const)('says unguarded for a copy with %s, never the next pass or the press', (_name, version) => {
    expect(waiting(version).waitsFor).toBe('unguarded');
    expect(waiting(version, 'press').waitsFor).toBe('unguarded');
    expect(waiting(version).address).toBe('older');
    expect(real.countsAsVerified(waiting(version))).toBe(false);
  });

  it('says what the rest waits for when the version can guard the write, or was not read', () => {
    expect(waiting('abc').waitsFor).toBe('pass');
    expect(waiting('abc', 'press').waitsFor).toBe('press');
    expect(waiting(undefined).waitsFor).toBe('pass');
  });

  it('counts them apart in the list', () => {
    const list = real.confirmedListOf({ addressDigest: TABLE });
    for (const r of [waiting(null), waiting('abc'), waiting(null)]) list.add(r);
    expect(list.result().addressChanges).toEqual({ digest: TABLE, changed: 0, older: 3, unguarded: 2 });
  });
});

describe('the mutation that drops the check of the mark', () => {
  it('fails these claims', async () => {
    const source = readFileSync(new URL('./confirmed-list.ts', import.meta.url), 'utf8');
    const rule = '  if (waitsForAnAddressChange(digest.item, digest.due)) {';
    expect(source).toContain(rule);
    // The mutant: a copy is older only by its own digest's absence, as before S3.
    const here = (f: string) => pathToFileURL(join(import.meta.dirname, f)).href;
    const mutated = source
      .replace(rule, '  if (false) {')
      .replace("from './fingerprint-scheme.ts'", `from '${here('fingerprint-scheme.ts')}'`)
      .replace("from './address-changes.ts'", `from '${here('address-changes.ts')}'`)
      .replace("from './address-digest-due.ts'", `from '${here('address-digest-due.ts')}'`);
    const dir = mkdtempSync(join(tmpdir(), 'confirmed-list-mutant-'));
    try {
      const file = join(dir, 'confirmed-list.ts');
      writeFileSync(file, mutated);
      const mutant = (await import(pathToFileURL(file).href)) as Module;
      expect(() => holds(mutant)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

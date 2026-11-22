// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MATCH UNDER AN OLDER ADDRESS TABLE (workplan 0168 T5; ADR-0055 decision 5).
 *
 * A contact or an event copied with an address changed is no longer the
 * source's bytes, and the confirmed list must say so: it counts the copies
 * carrying a change and names the table's digest. A copy written under a
 * table that is no longer the table is NEVER a match, whatever the re-read
 * said: its hash agreeing with the ledger proves only that it is what we
 * wrote then.
 *
 * The last block runs a MUTANT of `confirmed-list.ts` with the digest check
 * taken out, and shows these assertions catch it: a guard that passes with
 * the rule removed guards nothing.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as real from './confirmed-list.ts';

const NOW = 'a'.repeat(64);
const OLDER = 'b'.repeat(64);
const MATCH = { onTarget: true, comparison: 'match' } as const;

type Module = typeof real;

/** The claims, against one module, so the mutant can be held to them too. */
function claims(m: Module) {
  const row = (item: string | null, status: 'copied' | 'adopted' = 'copied') =>
    m.rowFor({
      domain: 'contact',
      status,
      answer: MATCH,
      contentHash: 'card1:x',
      addressDigest: { item, table: NOW },
    });
  return {
    current: row(NOW),
    older: row(OLDER),
    untouched: row(null),
    adopted: row(OLDER, 'adopted'),
    list: (() => {
      const list = m.confirmedListOf({ addressDigest: NOW });
      for (const r of [row(NOW), row(OLDER), row(null), row(OLDER)]) list.add(r);
      return list.result();
    })(),
  };
}

function holds(m: Module): void {
  const c = claims(m);
  expect(c.current).toEqual({ state: 'verified', claim: 'fingerprint', address: 'changed' });
  expect(c.older.state).toBe('differs');
  expect(c.older.address).toBe('older');
  expect(m.countsAsVerified(c.older)).toBe(false);
  expect(c.untouched).toEqual({ state: 'verified', claim: 'fingerprint' });
  // The customer's own copy says nothing about a table.
  expect(c.adopted).toEqual({ state: 'yours', claim: 'none' });
  expect(c.list.verified).toBe(2);
  expect(c.list.addressChanges).toEqual({ digest: NOW, changed: 1, older: 2 });
}

describe('the confirmed list and the address table', () => {
  it('marks a match under the table as it is now, and never calls one under an older table a match', () => {
    holds(real);
  });

  it('says nothing about a table when the caller had none to read, exactly as before', () => {
    const r = real.rowFor({ domain: 'contact', status: 'copied', answer: MATCH, contentHash: 'card1:x' });
    expect(r).toEqual({ state: 'verified', claim: 'fingerprint' });
    expect(real.confirmedListOf().result().addressChanges).toBeUndefined();
  });

  it('keeps every other state as it was for a copy under an older table, marked', () => {
    const r = real.rowFor({
      domain: 'calendar',
      status: 'updated',
      answer: { onTarget: false },
      contentHash: 'cal1:x',
      addressDigest: { item: OLDER, table: NOW },
    });
    expect(r).toEqual({ state: 'missing', claim: 'none', address: 'older' });
  });

  it('calls a copy changed under a table that has since been emptied older, never a match', () => {
    const r = real.rowFor({
      domain: 'contact',
      status: 'copied',
      answer: MATCH,
      contentHash: 'card1:x',
      addressDigest: { item: OLDER, table: null },
    });
    expect(r.state).toBe('differs');
    expect(r.address).toBe('older');
  });
});

describe('the mutation that drops the digest check', () => {
  it('fails these claims', async () => {
    const source = readFileSync(new URL('./confirmed-list.ts', import.meta.url), 'utf8');
    const rule = "  if (digest.item === digest.table) return { ...row, address: 'changed' };";
    expect(source).toContain(rule);
    // The mutant: every copy carrying a change is marked as changed under the
    // table now, whichever table it was written under.
    const mutated = source
      .replace(rule, "  return { ...row, address: 'changed' };")
      .replace("from './fingerprint-scheme.ts'", `from '${pathToFileURL(join(import.meta.dirname, 'fingerprint-scheme.ts')).href}'`);
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

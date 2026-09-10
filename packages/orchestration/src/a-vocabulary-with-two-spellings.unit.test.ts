// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The gap between two spellings of the same five domains (workplan 0117 T2,
 * slice 7).
 *
 * The ledger says `email | calendar | contact | file | task`; the verification
 * gate says `mail | calendar | contacts | files | tasks`. `build-reindexers.ts`
 * carries what that gap has already cost, in full: the task domain got a
 * source, a writer, a ledger row, a tick, a place in the report and named
 * assertions in both gates — and never a target reindexer. Nothing failed. A
 * lookup answered `undefined`, and every layer above read it as an honest no,
 * so E2E #168 reported `tasks 0/4` about a target the tasks were sitting on.
 *
 * A confirmation pass reads the same map, and its version of that bug is worse:
 * a domain nobody translated is a domain whose every row stays `unchecked` on
 * the document somebody deletes their originals from.
 *
 * The second half is about **whose limit a confirmation spends** (D9). The key
 * has to name the TARGET; a per-mapping label would hand the pass a private
 * bucket, which is the second allowance D9 refuses, and it would look correct.
 */

import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { DISCOVERY_DOMAINS } from '@openmig/shared';
import { GATE_NAME, hostFromStoredConfig, targetProviderKey } from './build-confirmation-readers.ts';
import { buildTargetReindexers } from './build-reindexers.ts';

/** A pool that answers one row, or none, and records what it was asked. */
const poolAnswering = (
  rows: Array<{ id: string; config: Record<string, unknown> }>,
): Pool & { sql: string[] } => {
  const sql: string[] = [];
  return {
    sql,
    query: async (text: string) => {
      sql.push(text);
      return { rows };
    },
  } as unknown as Pool & { sql: string[] };
};

describe('the two spellings', () => {
  it('translates every ledger domain, with no lookup left to answer undefined', async () => {
    // The map itself is a total `Record` over `DiscoveryDomain`, so a sixth
    // domain fails to COMPILE. This asserts the other half: that the five it
    // does carry each reach a name the gate's builder actually knows, rather
    // than a plausible-looking string nothing answers to.
    const known = new Set(Object.keys(reindexerSlots()));
    const translated = DISCOVERY_DOMAINS.map((d) => gateNameFor(d));
    expect(translated.filter((name) => !known.has(name))).toEqual([]);
    // And no two domains collide onto one slot, which would silently confirm
    // one domain's items against another's listing.
    expect(new Set(translated).size).toBe(DISCOVERY_DOMAINS.length);
  });

  it('spells the four that differ the way the gate does', async () => {
    // Written out rather than derived, and that is the point: `contacts` and
    // `contact` are one letter apart, so a test that computed the expectation
    // from the map it is checking would pass on any spelling at all. These are
    // the names as a person reads them off `build-reindexers.ts`.
    expect(gateNameFor('email')).toBe('mail');
    expect(gateNameFor('contact')).toBe('contacts');
    expect(gateNameFor('file')).toBe('files');
    expect(gateNameFor('task')).toBe('tasks');
    expect(gateNameFor('calendar')).toBe('calendar');
  });
});

describe('whose limit a confirmation spends', () => {
  it('names the TARGET, never the mapping', async () => {
    // D9: *"the limit belongs to the PROVIDER, not to us"*. A key carrying the
    // mapping id would give every mapping its own full-size allowance, which
    // is exactly the second budget D9 refuses.
    const key = await targetProviderKey(
      poolAnswering([{ id: 'conn-1', config: { host: 'mail.example.net' } }]),
      'tenant-1',
      'mapping-1',
    );
    expect(key).toBe('target:mail.example.net');
    expect(key).not.toContain('mapping-1');
  });

  it('shares one key between two mappings pointing at the same server', async () => {
    const pool = poolAnswering([{ id: 'conn-1', config: { host: 'mail.example.net' } }]);
    const a = await targetProviderKey(pool, 'tenant-1', 'mapping-a');
    const b = await targetProviderKey(pool, 'tenant-1', 'mapping-b');
    expect(a).toBe(b);
  });

  it('falls back to the connection, which NARROWS rather than switching off', async () => {
    // The fallback matters more than it looks. Falling back to `undefined`
    // would leave the pass unbudgeted — the failure the whole `TargetBudget`
    // shape was corrected to avoid. Keying by the connection still shares
    // across every pass against that account (one customer, one target) and
    // never invents a bucket shared with an unrelated server.
    const key = await targetProviderKey(
      poolAnswering([{ id: 'conn-9', config: { nothing: 'useful' } }]),
      'tenant-1',
      'mapping-1',
    );
    expect(key).toBe('target-connection:conn-9');
  });

  it('answers undefined only when there is no target connection at all', async () => {
    // Not a budget question: nothing can be read off a target that is not
    // there, so the caller has a mapping it cannot confirm rather than one to
    // confirm unbudgeted.
    expect(await targetProviderKey(poolAnswering([]), 'tenant-1', 'mapping-1')).toBeUndefined();
  });
});

describe('the host, as the door stored it', () => {
  it('prefers the stored host field', () => {
    expect(hostFromStoredConfig({ host: 'IMAP.Example.NET', port: 993 })).toBe('imap.example.net');
  });

  it('reads a DAV url and a JMAP baseUrl', () => {
    expect(hostFromStoredConfig({ url: 'https://cloud.example.org/remote.php/dav' })).toBe(
      'cloud.example.org',
    );
    expect(hostFromStoredConfig({ baseUrl: 'https://mail.example.net:8443' })).toBe(
      'mail.example.net',
    );
  });

  it('answers undefined rather than a guess', () => {
    // A string that is not a URL must not become a key: a budget keyed to
    // nonsense is one nothing else shares, which is the private bucket again.
    expect(hostFromStoredConfig({ url: 'not a url' })).toBeUndefined();
    expect(hostFromStoredConfig({ host: '   ' })).toBeUndefined();
    expect(hostFromStoredConfig({})).toBeUndefined();
  });
});

/**
 * The slots `buildTargetReindexers` actually fills, read from its own source.
 *
 * Read rather than re-listed: a second hand-written copy of this list is the
 * exact shape that let `tasks` go missing, and a test carrying one would agree
 * with itself while the product disagreed.
 */
function reindexerSlots(): Record<string, true> {
  const source = buildTargetReindexers.toString();
  const slots: Record<string, true> = {};
  for (const m of source.matchAll(/collect\(\s*['"]([a-z]+)['"]/g)) {
    if (m[1]) slots[m[1]] = true;
  }
  if (Object.keys(slots).length === 0) {
    throw new Error('found no collect() calls — the extractor stopped matching, not the product');
  }
  return slots;
}

/** THE PRODUCT's map, not a copy of it. */
function gateNameFor(domain: (typeof DISCOVERY_DOMAINS)[number]): string {
  return GATE_NAME[domain];
}

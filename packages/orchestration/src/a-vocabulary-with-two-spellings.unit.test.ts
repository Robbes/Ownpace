// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHOSE LIMIT A CONFIRMATION SPENDS, and whether any domain can go missing
 * from the managed fan-out (workplan 0117 T2, slices 7 and 8).
 *
 * The two-spellings half of this file moved to
 * `a-fan-out-only-one-edition-updated.unit.test.ts` when the fan-out was
 * extracted (owner decision 2026-09-11, option (b)), because the map now has
 * one home and that is where it is guarded. What stays here is the END of that
 * chain — that the managed builder really does emit a slot for every one of the
 * five, which is what `tasks 0/4` proved cannot be taken on trust — and D9's
 * question about whose allowance a confirmation spends.
 *
 * **The first test used to scrape `buildTargetReindexers.toString()` for
 * `collect('…')` calls.** That was the best available reading of the product
 * while the loop was written out by hand in this file; with the loop extracted
 * there are no `collect` calls to find, and the extractor's own vacuity check
 * fired the moment the refactor landed — which is exactly what it was for. It
 * is replaced by something stronger: the real builder is run against a stubbed
 * deps layer and the keys it produces are read off the result. A source scrape
 * can go stale silently; this cannot.
 *
 * The second half is about **whose limit a confirmation spends** (D9). The key
 * has to name the TARGET; a per-mapping label would hand the pass a private
 * bucket, which is the second allowance D9 refuses, and it would look correct.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { DISCOVERY_DOMAINS } from '@openmig/shared';
import { hostFromStoredConfig, targetProviderKey } from './build-confirmation-readers.ts';
import { GATE_NAME } from './target-fan-out.ts';

/** Which domain literal each call asked `buildDomainDepsFromMapping` for. */
const asked: string[] = [];

vi.mock('./build-deps-from-mapping.ts', () => ({
  buildDomainDepsFromMapping: (
    _pool: unknown,
    _tenantId: string,
    _mappingId: string,
    domain: string,
  ) => {
    asked.push(domain);
    // Enumerable, so every domain is KEPT — this test is about whether each
    // one is reached at all, not about what a real target can do.
    return Promise.resolve({
      target: { listEntries: () => Promise.resolve([]) },
      close: () => Promise.resolve(),
    });
  },
}));

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

describe('every domain reaches the managed fan-out', () => {
  it('emits a reindexer slot for all five, asked for by the ledger’s own name', async () => {
    // THE `tasks 0/4` ASSERTION, run against the real builder. The task domain
    // got a source, a writer, a ledger row, a tick, a place in the report and
    // named assertions in both gates — and never a line in this fan-out. A
    // lookup answered `undefined` and every layer above read it as an honest
    // no, so E2E #168 reported an empty task domain about a target the tasks
    // were sitting on.
    asked.length = 0;
    const { buildTargetReindexers } = await import('./build-reindexers.ts');
    const built = await buildTargetReindexers({} as Pool, 'tenant-1', 'mapping-1');

    // Asked for every one of the five, in the deps layer's own spelling.
    expect(asked.sort()).toEqual(['calendar', 'contact', 'file', 'mail', 'task']);
    // And produced a slot for every one, in the GATE's spelling — which is the
    // half that went missing, since asking is not the same as landing.
    expect(Object.keys(built.reindexers).sort()).toEqual([
      'calendar',
      'contacts',
      'files',
      'mail',
      'tasks',
    ]);
    await built.close();
  });

  it('keys its answer the way the verification gate reads it', async () => {
    // `createRealVerificationDeps` looks a reindexer up by the gate's name. A
    // builder that keyed by the ledger's would answer `undefined` for four of
    // the five and report them all NOT_VERIFIABLE — the same silent no.
    asked.length = 0;
    const { buildTargetReindexers } = await import('./build-reindexers.ts');
    const built = await buildTargetReindexers({} as Pool, 'tenant-1', 'mapping-1');
    for (const domain of DISCOVERY_DOMAINS) {
      expect(built.reindexers[GATE_NAME[domain]], domain).toBeDefined();
    }
    await built.close();
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

// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAILURE SAYS WHICH SIDE IT CAME FROM (workplan 0094 T5, second slice).
 *
 * The tag has to survive everything between the closure that threw and the
 * catch that records it: a rethrow, a `PassAbortError` wrapping it as `cause`,
 * a promise rejection, a bare string thrown by a careless adapter. And the
 * seam has to be where the pass calls the closures, so that no connector
 * needs to know it exists — proved against `runDomainSync` itself with a
 * source that cannot list and a target that cannot hold a collection.
 */

import { describe, it, expect } from 'vitest';
import { asTenantId, asMappingId, type Ledger } from '@openmig/shared';
import { failureSideOf, sided, withFailureSide } from './failure-side.ts';
import { PassAbortError, runDomainSync } from './domain-sync.ts';

const TENANT = asTenantId('9a940000-e29b-41d4-a716-446655449901' as never);
const MAPPING = asMappingId('9a940000-e29b-41d4-a716-446655449902' as never);

const emptyLedger = {
  find: async () => undefined,
  recordIfAbsent: async () => undefined,
  placedItems: async () => [],
} as unknown as Ledger;

/** A pass over one folder and one item, with the two closures under test swappable. */
function pass(over: {
  listFolders?: () => Promise<ReadonlyArray<{ path: string }>>;
  ensureCollection?: () => Promise<string>;
}) {
  return runDomainSync({
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'file',
    source: {},
    target: {},
    ledger: emptyLedger,
    listFolders: over.listFolders ?? (async () => [{ path: 'f' }]),
    listSince: async () => ({ items: [{ id: 'i1' }], nextCursor: { value: 'c' } }),
    fetchRaw: async () => ({ raw: {}, sizeBytes: 1 }),
    upsert: async () => ({ targetId: 't', created: true }),
    naturalKey: (i: unknown) => (i as { id: string }).id,
    contentHash: () => 'h',
    ensureCollection: over.ensureCollection ?? (async () => 'coll'),
  } as never);
}

describe('withFailureSide / failureSideOf', () => {
  it('tags an Error without changing what it is', () => {
    const err = new TypeError('boom');
    const tagged = withFailureSide('source', err);
    expect(tagged).toBe(err);
    expect(err).toBeInstanceOf(TypeError);
    expect(failureSideOf(err)).toBe('source');
    // Invisible to logs and JSON: the tag is not the message's business.
    expect(Object.keys(err)).toEqual([]);
    expect(JSON.stringify(err)).toBe('{}');
  });

  it('keeps the FIRST tag — the innermost seam is the true one', () => {
    const err = withFailureSide('target', withFailureSide('source', new Error('x')));
    expect(failureSideOf(err)).toBe('source');
  });

  it('is found along the cause chain, which is how a PassAbortError carries it', () => {
    const inner = withFailureSide('target', new Error('507 insufficient storage'));
    const abort = new PassAbortError('file: 20 items failed in a row', { cause: inner });
    expect(failureSideOf(abort)).toBe('target');
  });

  it('wraps a thrown primitive once, keeping its text', () => {
    const wrapped = withFailureSide('source', 'AUTHENTICATIONFAILED') as Error;
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('AUTHENTICATIONFAILED');
    expect(wrapped.cause).toBe('AUTHENTICATIONFAILED');
    expect(failureSideOf(wrapped)).toBe('source');
  });

  it('answers undefined for anything untagged — never a guess', () => {
    expect(failureSideOf(new Error('plain'))).toBeUndefined();
    expect(failureSideOf(undefined)).toBeUndefined();
    expect(failureSideOf('a string')).toBeUndefined();
    expect(failureSideOf({ cause: { cause: new Error('deep') } })).toBeUndefined();
  });
});

describe('sided', () => {
  it('tags a synchronous throw', () => {
    const f = sided('source', (): number => {
      throw new Error('sync');
    });
    expect(() => f()).toThrow('sync');
    try {
      f();
    } catch (err) {
      expect(failureSideOf(err)).toBe('source');
    }
  });

  it('tags a rejection and leaves a resolution alone', async () => {
    const rejects = sided('target', async () => {
      throw new Error('async');
    });
    await expect(rejects()).rejects.toThrow('async');
    await rejects().catch((err: unknown) => expect(failureSideOf(err)).toBe('target'));
    const resolves = sided('target', async (n: number) => n * 2);
    await expect(resolves(21)).resolves.toBe(42);
  });

  it('passes a plain value through', () => {
    const f = sided('source', (a: string, b: string) => a + b);
    expect(f('a', 'b')).toBe('ab');
  });
});

describe('the seam: runDomainSync tags the closures by side', () => {
  it('a source that cannot list fails the pass with side = source', async () => {
    const failing = pass({
      listFolders: async () => {
        throw new Error('IMAP LOGIN failed: AUTHENTICATIONFAILED');
      },
    });
    await expect(failing).rejects.toThrow(/AUTHENTICATIONFAILED/);
    await failing.catch((err: unknown) => expect(failureSideOf(err)).toBe('source'));
  });

  it('a target that cannot hold a collection fails the pass with side = target', async () => {
    const failing = pass({
      ensureCollection: async () => {
        throw new Error('507 Insufficient Storage');
      },
    });
    await expect(failing).rejects.toThrow(/507/);
    await failing.catch((err: unknown) => expect(failureSideOf(err)).toBe('target'));
  });

  it('a clean pass is untouched by the tagging', async () => {
    const result = await pass({});
    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
  });
});

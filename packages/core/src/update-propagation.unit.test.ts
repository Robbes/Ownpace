// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Update propagation: the rules that decide whether a later pass rewrites an
 * item it has already copied.
 *
 * This is the one place in the product that overwrites anything on a target,
 * so it is the one place where getting the rule wrong destroys customer data
 * rather than merely being slow or duplicating. Two documents govern it and
 * they pull in opposite directions:
 *
 *   - hard rule 2, "never auto-delete/overwrite on the target";
 *   - §11.1, "the source is authoritative for content".
 *
 * The reconciliation is ownership. We may rewrite bytes THIS TOOL wrote; we
 * may never rewrite bytes the destination already had. `classifyKnownItem` is
 * where that line is drawn and this file is where it is enforced.
 */

import { describe, it, expect } from 'vitest';
import { classifyKnownItem, runDomainSync } from './domain-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import { asTenantId, asMappingId, type UpsertOptions, type UpsertResult } from '@openmig/shared';

const TENANT = asTenantId('6b110000-e29b-41d4-a716-4466554401aa');
const MAPPING = asMappingId('6b110000-e29b-41d4-a716-4466554401bb');

describe('classifyKnownItem', () => {
  it('skips when the source reports no version at all', () => {
    // Mail: messages are immutable, so there is nothing to compare. The
    // behaviour must be exactly what it was before update propagation existed.
    expect(classifyKnownItem({ sourceVersion: 'etag-1', status: 'copied' }, undefined)).toBe('skip');
    expect(classifyKnownItem({ status: 'copied' }, undefined)).toBe('skip');
  });

  it('records the version, without rewriting, for a row that predates the column', () => {
    // Every row written before migration 0020 is in this state. Rewriting them
    // would re-copy an entire corpus on first upgrade to prove nothing.
    expect(classifyKnownItem({ status: 'copied' }, 'etag-1')).toBe('record-version');
  });

  it('skips when the versions match', () => {
    expect(classifyKnownItem({ sourceVersion: 'etag-1', status: 'copied' }, 'etag-1')).toBe('skip');
  });

  it('rewrites when the version moved on and the copy is ours', () => {
    expect(classifyKnownItem({ sourceVersion: 'etag-1', status: 'copied' }, 'etag-2')).toBe(
      'rewrite',
    );
    expect(classifyKnownItem({ sourceVersion: 'etag-1', status: 'updated' }, 'etag-2')).toBe(
      'rewrite',
    );
  });

  it('NEVER rewrites an adopted item, however far the source has moved', () => {
    // The whole of hard rule 2 in one assertion. `adopted` means the
    // destination already held this item and we never wrote it — those bytes
    // are the customer's.
    expect(classifyKnownItem({ sourceVersion: 'etag-1', status: 'adopted' }, 'etag-2')).toBe(
      'leave-adopted',
    );
  });

  it('treats an empty-string version as a real value, not as unknown', () => {
    // A server that genuinely sends an empty ETag is different from one that
    // sends none, and the ledger keeps them apart (NULL vs ''). Conflating
    // them would make a real change look like a backfill.
    expect(classifyKnownItem({ sourceVersion: '', status: 'copied' }, 'etag-2')).toBe('rewrite');
    expect(classifyKnownItem({ sourceVersion: '', status: 'copied' }, '')).toBe('skip');
  });
});

/**
 * A minimal domain wired onto the memory ledger, one folder, one item.
 *
 * The fake `upsert` RECORDS THE LEDGER ROW ITSELF, before returning, because
 * that is what the three real DAV writers do — each says so in a comment:
 * "`recordIfAbsent` makes the first writer win, and that is this one."
 *
 * The first version of this harness did not, and that omission hid a real bug
 * through a green unit suite: the sync loop's own `recordIfAbsent` no-ops on
 * the row the writer already inserted, so a source version recorded only by
 * the loop was silently dropped, every row landed with `sourceVersion`
 * undefined, and the next pass read that as "not known" and backfilled instead
 * of rewriting. Update propagation worked exactly one pass late, and only
 * against a real ledger — CI's Nextcloud integration run is what caught it.
 *
 * So the fake models the awkward part of production rather than the
 * convenient part. A fake that is more forgiving than the real thing is not a
 * test.
 */
function harness(opts: {
  version: string | undefined;
  body: string;
  onUpsert?: (options?: UpsertOptions) => void;
  /**
   * Make the target REFUSE the rewrite, as a real writer does when the copy it
   * finds is not the one it wrote. Nothing is written — which is the whole
   * point, so the double must not write either.
   */
  refuseOverwrite?: boolean;
  /** What the writer reports the target version to be after a successful write. */
  targetVersion?: string;
}) {
  const upserts: Array<{ body: string; overwrite: boolean }> = [];
  const item = { key: 'k1', version: opts.version, body: opts.body };
  return {
    upserts,
    run: (ledger: MemoryLedger) =>
      runDomainSync<unknown, unknown, typeof item, { path: string }>({
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: 'calendar',
        source: {},
        target: {},
        ledger,
        listFolders: async () => [{ path: 'c1' }],
        listSince: async () => ({ items: [item], nextCursor: { value: '1' } }),
        fetchRaw: async (i) => ({ raw: i.body, sizeBytes: i.body.length }),
        upsert: async (_collection, raw, i, options): Promise<UpsertResult> => {
          opts.onUpsert?.(options);
          upserts.push({ body: raw as string, overwrite: options?.overwrite === true });
          if (!options?.overwrite) {
            // The writer wins this row — including its source version, which
            // it only knows because the loop handed it over in `options`.
            await ledger.recordIfAbsent({
              tenantId: TENANT,
              mappingId: MAPPING,
              itemType: 'calendar',
              naturalKeyHash: i.key,
              contentHash: `h:${raw as string}`,
              targetId: 't1',
              createdAt: new Date().toISOString(),
              sizeBytes: (raw as string).length,
              status: 'copied',
              ...(options?.sourceVersion !== undefined
                ? { sourceVersion: options.sourceVersion }
                : {}),
              // The real writers record this themselves — only they see the
              // server's answer to the PUT — and `recordIfAbsent` makes the
              // first writer win. A double that left it to the loop would prove
              // a protection the product does not have.
              ...(opts.targetVersion !== undefined ? { targetVersion: opts.targetVersion } : {}),
            });
          }
          if (options?.overwrite && opts.refuseOverwrite) {
            return { targetId: 't1', created: false, conflicted: true };
          }
          return {
            targetId: 't1',
            created: !options?.overwrite,
            updated: options?.overwrite,
            ...(opts.targetVersion !== undefined ? { targetVersion: opts.targetVersion } : {}),
          };
        },
        naturalKey: (i) => i.key,
        sourceVersion: (i) => i.version,
        contentHash: (raw) => `h:${raw as string}`,
        ensureCollection: async () => 'c1',
      }),
  };
}

describe('runDomainSync update propagation', () => {
  it('rewrites the target when the source version changed, exactly once', async () => {
    const ledger = new MemoryLedger();

    const first = harness({ version: 'etag-1', body: 'v1' });
    const r1 = await first.run(ledger);
    expect(r1.created).toBe(1);
    expect(r1.updated).toBe(0);

    // The version must be ON the row after the FIRST pass. If it is not, the
    // next pass reads "not known" and backfills instead of rewriting, and the
    // whole feature silently runs one pass behind the source.
    expect(
      (await ledger.find(TENANT, MAPPING, 'calendar', 'k1'))?.sourceVersion,
      'the writer records first — the version has to reach the row it writes',
    ).toBe('etag-1');

    // Same version again: no fetch, no write.
    const same = harness({ version: 'etag-1', body: 'v1' });
    const r2 = await same.run(ledger);
    expect(r2.skipped).toBe(1);
    expect(r2.updated).toBe(0);
    expect(same.upserts).toHaveLength(0);

    // Version moved on: rewrite, with overwrite set.
    const changed = harness({ version: 'etag-2', body: 'v2' });
    const r3 = await changed.run(ledger);
    expect(r3.updated).toBe(1);
    expect(r3.created).toBe(0);
    expect(r3.skipped).toBe(0);
    expect(changed.upserts).toEqual([{ body: 'v2', overwrite: true }]);

    // And the ledger now holds the NEW version and hash, so a further pass at
    // etag-2 is quiet. Without recordUpdate this would rewrite forever.
    const after = await ledger.find(TENANT, MAPPING, 'calendar', 'k1');
    expect(after?.sourceVersion).toBe('etag-2');
    expect(after?.contentHash).toBe('h:v2');

    const settled = harness({ version: 'etag-2', body: 'v2' });
    const r4 = await settled.run(ledger);
    expect(r4.skipped).toBe(1);
    expect(r4.updated).toBe(0);
    expect(settled.upserts).toHaveLength(0);
  });

  it('does not overwrite a copy the owner has edited on the target', async () => {
    // The one path in this product that can destroy someone's work. Shadow
    // migration invites the owner into the new system before cutover; if they
    // correct an item there, a later source change must not silently replace
    // their correction.
    const ledger = new MemoryLedger();
    const first = harness({ version: 'etag-1', body: 'v1', targetVersion: 'tv-1' });
    await first.run(ledger);
    expect(
      (await ledger.find(TENANT, MAPPING, 'calendar', 'k1'))?.targetVersion,
      'the writer records it — only the writer saw the PUT response',
    ).toBe('tv-1');

    // The source moves on, and the target says our copy is not the one we left.
    const edited = harness({ version: 'etag-2', body: 'v2', refuseOverwrite: true });
    const r = await edited.run(ledger);

    expect(r.conflicted).toBe(1);
    expect(r.updated).toBe(0);

    const after = await ledger.find(TENANT, MAPPING, 'calendar', 'k1');
    // ADOPTED, which is not a consolation prize but the exact truth: those bytes
    // are the customer's now, and adopted items are never rewritten however far
    // the source moves.
    expect(after?.status).toBe('adopted');
    // The source version is deliberately NOT advanced. Recording it would claim
    // the change had been applied, which is the opposite of what happened, and
    // would hide a real divergence from the operator.
    expect(after?.sourceVersion).toBe('etag-1');
    // And the hash still describes what we actually put there, not the bytes we
    // were refused — §20 compares the target against this.
    expect(after?.contentHash).toBe('h:v1');
  });

  it('never tries to rewrite that item again, and says so every pass', async () => {
    const ledger = new MemoryLedger();
    await harness({ version: 'etag-1', body: 'v1', targetVersion: 'tv-1' }).run(ledger);
    await harness({ version: 'etag-2', body: 'v2', refuseOverwrite: true }).run(ledger);

    // A later pass must not fetch or write. `leave-adopted` returns before the
    // fetch, so the cost of a conflicted item is one ledger read forever —
    // and the divergence stays visible rather than going quiet.
    const later = harness({ version: 'etag-3', body: 'v3' });
    const r = await later.run(ledger);
    expect(later.upserts, 'an adopted item is not ours to touch').toHaveLength(0);
    expect(r.changedButAdopted).toBe(1);
    expect(r.updated).toBe(0);
    expect(r.conflicted).toBe(0);
  });

  it('backfills the version of a pre-0020 row without touching the target', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'calendar',
      naturalKeyHash: 'k1',
      contentHash: 'h:v1',
      targetId: 't1',
      createdAt: new Date().toISOString(),
      status: 'copied',
      // No sourceVersion — this is what every row written before 0020 looks like.
    });

    const pass = harness({ version: 'etag-1', body: 'v1' });
    const result = await pass.run(ledger);

    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
    expect(pass.upserts, 'a backfill must not write to the target').toHaveLength(0);

    // Recorded, so the NEXT genuine change is detectable.
    expect((await ledger.find(TENANT, MAPPING, 'calendar', 'k1'))?.sourceVersion).toBe('etag-1');

    const changed = harness({ version: 'etag-2', body: 'v2' });
    expect((await changed.run(ledger)).updated).toBe(1);
  });

  it('leaves an adopted item alone and counts it', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'calendar',
      naturalKeyHash: 'k1',
      contentHash: 'h:theirs',
      targetId: 't1',
      createdAt: new Date().toISOString(),
      status: 'adopted',
      sourceVersion: 'etag-1',
    });

    const pass = harness({ version: 'etag-2', body: 'v2' });
    const result = await pass.run(ledger);

    expect(pass.upserts, 'hard rule 2: never overwrite the destination’s own data').toHaveLength(0);
    expect(result.changedButAdopted).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);

    // And the row is untouched — including its content hash, which still
    // describes what is actually on the target.
    const after = await ledger.find(TENANT, MAPPING, 'calendar', 'k1');
    expect(after?.contentHash).toBe('h:theirs');
    expect(after?.sourceVersion).toBe('etag-1');
  });

  it('keeps the old version when the rewrite fails, so it stays retryable', async () => {
    const ledger = new MemoryLedger();
    await (await harness({ version: 'etag-1', body: 'v1' })).run(ledger);

    const boom = runDomainSync<unknown, unknown, { key: string; version: string; body: string }, { path: string }>({
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'calendar',
      source: {},
      target: {},
      ledger,
      listFolders: async () => [{ path: 'c1' }],
      listSince: async () => ({
        items: [{ key: 'k1', version: 'etag-2', body: 'v2' }],
        nextCursor: { value: '1' },
      }),
      fetchRaw: async (i) => ({ raw: i.body, sizeBytes: i.body.length }),
      upsert: async () => {
        throw new Error('target refused the write');
      },
      naturalKey: (i) => i.key,
      sourceVersion: (i) => i.version,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async () => 'c1',
    });

    // Per-item isolation: the pass carries on and the item is recorded as
    // failed. It used to reject; what matters here never changed.
    const result = await boom;
    expect(result.failed).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.failures[0]!.lastError).toContain('target refused the write');

    // Still etag-1. Recording etag-2 here would tell the next pass the update
    // had landed, and the source edit would be lost until the item changed
    // again — which is exactly why `recordFailure` does not store the version
    // it failed on.
    const after = await ledger.find(TENANT, MAPPING, 'calendar', 'k1');
    expect(after?.sourceVersion).toBe('etag-1');
    expect(after?.contentHash).toBe('h:v1');
    // And it is retryable rather than parked, after one attempt.
    expect(after?.status).toBe('failed');
    expect(after?.attemptCount).toBe(1);
  });

  it('is unchanged for a source that reports no version', async () => {
    // The mail shape. Everything the ledger has seen is skipped, whatever the
    // body says — no fetch, no write, no rewrite loop.
    const ledger = new MemoryLedger();
    await harness({ version: undefined, body: 'v1' }).run(ledger);

    const later = harness({ version: undefined, body: 'COMPLETELY DIFFERENT' });
    const result = await later.run(ledger);

    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
    expect(later.upserts).toHaveLength(0);
  });
});

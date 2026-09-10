// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LANE THAT KEEPS COPYING AFTER CUTOVER, WITH THE DELETION DETECTOR STILL ON
 * (workplan 0117 T1 slice 2; owner decision D4).
 *
 * The failure this exists to prevent, in the order it happens:
 *
 *   1. Somebody finishes their migration and enters the continuous lane, so
 *      the product keeps copying new arrivals from the old system.
 *   2. They tidy the old system — empty its bin, delete a folder they no
 *      longer need. It is theirs, and it is no longer the authority on what
 *      exists; the new system is.
 *   3. The next pass reads that deletion as a signal.
 *   4. The item disappears from the new system too, and now exists nowhere.
 *
 * Every step behaving exactly as designed. 0117 §3a.
 *
 * Owner decision D4, 2026-09-09: *"indeed, after cutover the source is no
 * longer the authority on what exists, so we will not delete in target based
 * on changes in the source."*
 *
 * ## Absent, not gated — and why this file tests it twice
 *
 * §4D settled the mechanism, and it is stronger than switching the deletions
 * off: **the detectors do not run.** A gate strong enough to tell OUR deletion
 * from the person's own needs T4's tombstones anyway, and a gate can be wrong
 * once. Absence cannot.
 *
 * The distinction is invisible to a test that only checks the target. A GATED
 * implementation and an ABSENT one both leave the target untouched; they differ
 * in what the pass REPORTS. A gated one says "1 deletion detected, 0 applied";
 * only absence says nothing was detected at all. So every behavioural test
 * below asserts on `result.deletions`, not on the target — and asserts on the
 * target as well, because both have to be true.
 *
 * §7b's definition of done says it in the owner's terms:
 *
 * > Set `allowApplyDeletions: **true**` on a `continuous` mapping — the switch
 * > that normally enables everything above. Delete an item at the source. Run a
 * > pass. Assert the target copy is untouched **and that the pass reports
 * > `deletions: 0`**.
 *
 * Turning the switch ON is what makes the test mean something: a test that
 * leaves it off proves only that the default is off. Here that half is
 * structural rather than behavioural, and deliberately so — `allowApplyDeletions`
 * is not an input to `runDomainSync` AT ALL, which is the strongest possible
 * form of "the switch is not what stops this". The last test in the first
 * describe block pins exactly that.
 *
 * ## Three producers, not two
 *
 * §7b's survey named two detection sites. There are three, and the one it
 * missed is the mail domain's ONLY deletion evidence:
 *
 *   `removed` from `listSince`  a source announcing its own removals
 *                               (OneDrive's delta, RFC 6578 sync-collection)
 *   `listDiscardedKeys`         the owner's BIN — positive evidence that a
 *                               person deleted something, and all mail has
 *   `detectPathKeyedMoves`      absence-counting, where a FILE's deletions
 *                               come from, and its moves with them
 *
 * Each gets its own test below, so a leak names which one leaked rather than
 * reporting a number that is merely wrong.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDomainSync } from './domain-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  DELETION_CONFIRMATIONS,
  type UpsertResult,
} from '@openmig/shared';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Whole-line comments stripped, so a guard never matches its own explanation. */
const source = (rel: string) =>
  read(rel)
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

const TENANT = asTenantId('c1170000-e29b-41d4-a716-446655440201');
const MAPPING = asMappingId('c1170000-e29b-41d4-a716-446655440202');

/** One file on the source, keyed and addressed the way a file source is. */
interface Doc {
  readonly path: string;
  readonly href: string;
  readonly body: string;
}

/**
 * A file-shaped world with all three deletion signals available.
 *
 * `domain: 'file'` because it is the only domain that reaches
 * `detectPathKeyedMoves`, and this harness needs all three producers reachable
 * from one fixture — otherwise a "nothing was detected" result could be an
 * accident of the fixture rather than the property under test. Every test
 * below therefore runs its scenario TWICE: once with the source still the
 * authority (the signal must be seen) and once without (it must not be). The
 * first half is what stops this file passing vacuously.
 *
 * No cursor store: a cursor-less pass is `fullyEnumerated`, which is what
 * absence-counting requires to mean anything.
 */
function world() {
  const files = new Map<string, Doc[]>();
  /** Removals the source will announce on the next listing, per collection. */
  const removals = new Map<string, string[]>();
  /** Natural keys sitting in the owner's bin. */
  let binned: string[] = [];
  /** Everything on the target, and it is never removed by a pass. */
  const target = new Map<string, string>();

  const run = (ledger: MemoryLedger, sourceIsAuthorityOnExistence: boolean) =>
    runDomainSync<unknown, unknown, Doc, { path: string }>({
      sourceIsAuthorityOnExistence,
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'file',
      source: {},
      target: {},
      ledger,
      listFolders: async () => [...files.keys()].map((path) => ({ path })),
      listSince: async (folder) => {
        const reported = removals.get(folder.path) ?? [];
        removals.set(folder.path, []);
        return {
          items: files.get(folder.path) ?? [],
          nextCursor: { value: 'x' },
          ...(reported.length > 0 ? { removed: reported } : {}),
        };
      },
      // The bin, which is a deletion detector and nothing else — no item in it
      // is ever copied.
      listDiscardedKeys: async () => ({ keys: [...binned], unnameable: 0 }),
      fetchRaw: async (d) => ({ raw: d.body, sizeBytes: d.body.length }),
      upsert: async (collectionId, raw, d, options): Promise<UpsertResult> => {
        const at = `${collectionId}:${d.path}`;
        const existed = target.has(at);
        target.set(at, raw as string);
        if (options?.overwrite) return { targetId: at, created: false, updated: true };
        if (existed) return { targetId: at, created: false, adopted: true };
        await ledger.recordIfAbsent({
          tenantId: TENANT,
          mappingId: MAPPING,
          itemType: 'file',
          naturalKeyHash: d.path,
          contentHash: `h:${raw as string}`,
          targetId: at,
          createdAt: new Date().toISOString(),
          sizeBytes: (raw as string).length,
          status: 'copied',
          ...(options?.collection !== undefined ? { collection: options.collection } : {}),
          ...(options?.sourceRef !== undefined ? { sourceRef: options.sourceRef } : {}),
        });
        return { targetId: at, created: true };
      },
      naturalKey: (d) => d.path,
      sourceRef: (d) => d.href,
      contentHash: (raw) => `h:${raw as string}`,
      ensureCollection: async (folder) => folder.path,
    });

  return {
    files,
    removals,
    target,
    bin: (keys: string[]) => {
      binned = keys;
    },
    run,
  };
}

/** Copy everything once, so there is something on the target to lose. */
async function seeded(w: ReturnType<typeof world>) {
  const ledger = new MemoryLedger();
  const first = await w.run(ledger, true);
  expect(first.created, 'the fixture copied nothing, so nothing below can be lost').toBeGreaterThan(
    0,
  );
  return ledger;
}

describe('after cutover, a pass reports no deletion because it looked for none', () => {
  it('the source ANNOUNCES a removal, and the continuous pass does not hear it', async () => {
    const scenario = async (authority: boolean) => {
      const w = world();
      w.files.set('/docs', [
        { path: '/docs/keep.txt', href: 'h-keep', body: 'K' },
        { path: '/docs/gone.txt', href: 'h-gone', body: 'G' },
      ]);
      const ledger = await seeded(w);
      // The owner deletes it in the OLD system, and the server says so.
      w.files.set('/docs', [{ path: '/docs/keep.txt', href: 'h-keep', body: 'K' }]);
      w.removals.set('/docs', ['h-gone']);
      return { result: await w.run(ledger, authority), target: w.target };
    };

    // Before cutover: heard, as it must be — this half is what keeps the other
    // half from being a fixture that simply cannot produce a deletion.
    const before = await scenario(true);
    expect(before.result.deletions.map((d) => d.evidence)).toContain('reported');

    // After: not heard. Not heard-and-suppressed — `deletions` is where a
    // gated implementation would still show its one detected row.
    const after = await scenario(false);
    expect(
      after.result.deletions,
      'a continuous pass reported a deletion. If this is a gate rather than an ' +
        'absence, the count here is what gives it away.',
    ).toEqual([]);
    expect([...after.target.keys()].length, 'the target lost a copy').toBe(2);
  });

  it("the owner empties the OLD system's bin, and the continuous pass does not read it", async () => {
    const scenario = async (authority: boolean) => {
      const w = world();
      w.files.set('/docs', [
        { path: '/docs/keep.txt', href: 'h-keep', body: 'K' },
        { path: '/docs/trashed.txt', href: 'h-trash', body: 'T' },
      ]);
      const ledger = await seeded(w);
      w.files.set('/docs', [{ path: '/docs/keep.txt', href: 'h-keep', body: 'K' }]);
      w.bin(['/docs/trashed.txt']);
      return { result: await w.run(ledger, authority), target: w.target };
    };

    const before = await scenario(true);
    expect(before.result.deletions.map((d) => d.evidence)).toContain('trashed');

    const after = await scenario(false);
    expect(
      after.result.deletions,
      "the bin scan ran after cutover. It is the mail domain's ONLY deletion " +
        'evidence, and §7b\'s survey of "three sites" did not name it — which is ' +
        'why it has a test of its own.',
    ).toEqual([]);
    expect([...after.target.keys()].length, 'the target lost a copy').toBe(2);
  });

  it('an item stops being listed, and the continuous pass never counts its absence', async () => {
    const scenario = async (authority: boolean) => {
      const w = world();
      w.files.set('/docs', [
        { path: '/docs/keep.txt', href: 'h-keep', body: 'K' },
        { path: '/docs/vanished.txt', href: 'h-vanish', body: 'V' },
      ]);
      const ledger = await seeded(w);
      w.files.set('/docs', [{ path: '/docs/keep.txt', href: 'h-keep', body: 'K' }]);
      // Absence is the weak signal, so it takes repeated complete scans before
      // anyone is told. Run exactly as many as the product requires.
      let result = await w.run(ledger, authority);
      for (let i = 1; i < DELETION_CONFIRMATIONS + 1; i++) {
        result = await w.run(ledger, authority);
      }
      return { result, target: w.target };
    };

    const before = await scenario(true);
    expect(before.result.deletions.map((d) => d.evidence)).toContain('inferred');

    const after = await scenario(false);
    expect(
      after.result.deletions,
      'absence-counting ran after cutover. This is the producer §7b named first, ' +
        'and the one a file loses its copy to.',
    ).toEqual([]);
    expect([...after.target.keys()].length, 'the target lost a copy').toBe(2);
  });

  it('a rename after cutover duplicates rather than relocates, and says so', async () => {
    // The consequence of the third producer going absent, stated as a test
    // rather than left to be discovered. `detectPathKeyedMoves` yields moves
    // AND deletions from one correlation — a disappearance matched to an
    // arrival — so the moves go with the deletions.
    //
    // What that costs: the target keeps the old copy beside the new one. A
    // duplicate is the safe side of this trade. The alternative is
    // `applyRelocation` removing a copy from somebody's new home because they
    // reorganised the old one, which is the operation D4 forbids wearing a
    // different name.
    const w = world();
    w.files.set('/docs', [{ path: '/docs/report.pdf', href: 'h-r', body: 'R' }]);
    const ledger = await seeded(w);
    w.files.set('/docs', [{ path: '/docs/summary.pdf', href: 'h-r', body: 'R' }]);

    const after = await w.run(ledger, false);
    expect(after.moved, 'a continuous pass correlated a move').toBe(0);
    expect(after.deletions, 'a continuous pass reported the old path as gone').toEqual([]);
    expect(after.created, 'the new path was not copied — the lane stopped conveying').toBe(1);
    expect(
      [...w.target.keys()].sort(),
      'the old copy must still be there: after cutover we add, and never take away',
    ).toEqual(['/docs:/docs/report.pdf', '/docs:/docs/summary.pdf']);
  });

  it('the apply switch is not what stops it — the loop cannot even read it', () => {
    // §4D's rule in its structural form, and the reason this file's title is
    // about the DETECTOR rather than the deletion.
    //
    // `allowApplyDeletions` is the switch §7b's definition of done says to turn
    // ON before the test means anything. It is not an input to `runDomainSync`
    // at all — so there is no value of it that changes any assertion above.
    // That is stronger than any behavioural test could be: a gate can be wrong
    // once, and there is no gate here to be wrong.
    expect(
      source('packages/core/src/domain-sync.ts'),
      'the sync loop now reads `allowApplyDeletions`. Detection must not consult ' +
        'the apply switch: that turns absence back into a gate, which is what ' +
        '0117 §4D rejected.',
    ).not.toContain('allowApplyDeletions');

    // …and the downstream gate is still there. Absence upstream is not a reason
    // to drop the protection that stops a deletion being applied by accident.
    expect(
      source('packages/core/src/apply-deletion.ts'),
      'the apply-time gate on `allowApplyDeletions` is gone. Making detection ' +
        'absent after cutover does not make the switch redundant before it.',
    ).toContain('allowApplyDeletions');
  });
});

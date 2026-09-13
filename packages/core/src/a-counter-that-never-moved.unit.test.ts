// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The pass says how far it has got, on the row a watcher reads.
 *
 * Rob, 2026-09-13, watching a live pass over 7,468 real items in a Nextcloud:
 * *"I just don't see some indicator that it's still running/in progress."*
 *
 * He was right, and the cause was one line's absence. `runConfirmationPass`
 * wrote `itemsProcessed` at `finishRun` and nowhere else, so for the whole
 * twenty-seven minutes the run row said `0` — and the run row is precisely
 * where `operating-contract.ts` sends a screen watching a pass, *"which reads
 * one row"*. The cheap thing the contract designed for this had nothing in it.
 *
 * These tests pin the three properties that make the counter trustworthy: it
 * moves, it moves at a stated cadence rather than per item, and it can NEVER
 * end the pass it is merely reporting on.
 */

import { describe, expect, it, vi } from 'vitest';
import { runConfirmationPass, PROGRESS_EVERY } from './confirmation-run.ts';
import type { ConfirmationReader } from './confirmation-pass.ts';
import type { DiscoveryDomain, MappingId, TenantId } from '@openmig/shared';

const TENANT = 'tenant-1' as TenantId;
const MAPPING = 'mapping-1' as MappingId;

/** A ledger holding `count` contacts, each one the target will confirm. */
function ledgerOf(count: number) {
  return {
    async *itemsToConfirm() {
      for (let i = 0; i < count; i += 1) {
        yield {
          itemId: `item-${i}`,
          naturalKeyHash: `h-${i}`,
          status: 'copied',
          contentHash: 'h',
        };
      }
    },
    record: vi.fn().mockResolvedValue(undefined),
  };
}

/** A target that confirms everything it is asked about. */
const reader: ConfirmationReader = {
  isPresent: async () => true,
  hashOnTarget: async () => 'h',
};

function runsSpy(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    startRun: vi.fn().mockResolvedValue('run-1'),
    finishRun: vi.fn().mockResolvedValue(undefined),
    noteProgress: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function pass(count: number, runs: ReturnType<typeof runsSpy>) {
  return runConfirmationPass({
    tenantId: TENANT,
    mappingId: MAPPING,
    domains: ['contacts' as DiscoveryDomain],
    ledger: ledgerOf(count) as never,
    runs: runs as never,
    readerFor: () => reader,
  });
}

describe('a counter that never moved', () => {
  it('notes progress on the open run, so a watcher sees the pass advance', async () => {
    const runs = runsSpy();
    await pass(PROGRESS_EVERY * 3, runs);

    // THE WHOLE POINT: something reached the run row BEFORE the pass ended.
    expect(runs.noteProgress).toHaveBeenCalled();
    expect(runs.noteProgress).toHaveBeenCalledWith('run-1', {
      itemsProcessed: PROGRESS_EVERY,
    });
  });

  it('notes at the stated cadence, not once per item', async () => {
    // A note per item would be one UPDATE per target round trip — the counter
    // costing as much as the work it counts. The cadence is the contract, so
    // it is asserted rather than left to whatever the loop happens to do.
    const runs = runsSpy();
    await pass(PROGRESS_EVERY * 3, runs);

    expect(runs.noteProgress).toHaveBeenCalledTimes(3);
    expect(runs.noteProgress.mock.calls.map((c) => c[1])).toEqual([
      { itemsProcessed: PROGRESS_EVERY },
      { itemsProcessed: PROGRESS_EVERY * 2 },
      { itemsProcessed: PROGRESS_EVERY * 3 },
    ]);
  });

  it('says nothing at all on a pass too small to reach the cadence', async () => {
    // Not a gap: such a pass finishes before anybody could wonder whether it
    // had hung, and `finishRun` writes the final count a moment later.
    const runs = runsSpy();
    await pass(PROGRESS_EVERY - 1, runs);

    expect(runs.noteProgress).not.toHaveBeenCalled();
    expect(runs.finishRun).toHaveBeenCalledWith(
      'run-1',
      'succeeded',
      expect.objectContaining({ itemsProcessed: PROGRESS_EVERY - 1 }),
    );
  });

  it('carries on when a progress note fails — rule 3 outranks a number on a screen', async () => {
    // A note is bookkeeping ABOUT the work, never the work. Letting one failed
    // UPDATE throw would end the pass and discard every answer bought and not
    // yet flushed: the pass would die of its own progress report.
    const runs = runsSpy({
      noteProgress: vi.fn().mockRejectedValue(new Error('connection terminated')),
    });
    const result = await pass(PROGRESS_EVERY * 2, runs);

    expect(result.tally.total).toBe(PROGRESS_EVERY * 2);
    expect(runs.finishRun).toHaveBeenCalledWith(
      'run-1',
      'succeeded',
      expect.objectContaining({ itemsProcessed: PROGRESS_EVERY * 2 }),
    );
  });

  it('counts the same thing the finished run reports, so the number does not jump at the end', async () => {
    // If the live counter measured one thing and `finishRun` another, the
    // figure on screen would lurch the instant the pass landed — and a person
    // watching would be right to distrust both.
    const runs = runsSpy();
    await pass(PROGRESS_EVERY * 2, runs);

    const lastNote = runs.noteProgress.mock.calls.at(-1)?.[1] as { itemsProcessed: number };
    const finished = runs.finishRun.mock.calls.at(-1)?.[2] as { itemsProcessed: number };
    expect(lastNote.itemsProcessed).toBe(finished.itemsProcessed);
  });
});

// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The drift-lock between `evaluateApplyDeletion` and `applyDeletion`.
 *
 * The evaluator deliberately DUPLICATES the destructive path's ledger-side
 * gates instead of being called by it — folding them together would reorder
 * gate 2 relative to the ledger reads and change which refusal wins, on the
 * one path in the product that destroys data. Duplication's own hazard is
 * drift: the route promising what the job then refuses, which turns "you may
 * not do that, here is why" into a receipt that contradicts the 202 an
 * operator just received.
 *
 * So every ledger-side case below runs BOTH functions against the SAME ledger
 * and asserts the same refusal code comes back — or that both permit. The
 * target handed to `applyDeletion` is a spy that answers success; in refusal
 * cases it must never be reached, which is itself asserted, because a
 * divergence where the evaluator refuses but the full path touches the target
 * would be the worst possible kind.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  applyDeletion,
  applyRelocation,
  evaluateApplyDeletion,
  evaluateApplyRelocation,
  MASS_DELETION_MIN_ITEMS,
} from './apply-deletion';
import { MemoryLedger } from './__testing__/memory';
import { asTenantId, asMappingId, type LedgerRecord } from '@openmig/shared';

const TENANT = asTenantId('d2aa0000-e29b-41d4-a716-4466554406aa');
const MAPPING = asMappingId('d2aa0000-e29b-41d4-a716-4466554406bb');

function baseRow(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'calendar',
    naturalKeyHash: 'nk-1',
    contentHash: 'h1',
    targetId: 'target-path-1',
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Personal',
    ...overrides,
  };
}

/** Run both functions on the same ledger; return their outcomes plus the spy. */
async function both(ledger: MemoryLedger, allow: boolean, hash = 'nk-1') {
  const removeItem = vi.fn(async () => ({ kind: 'deleted' as const, conflicted: false }));
  const shared = {
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'calendar' as const,
    ledger,
    allowApplyDeletions: allow,
  };
  const evaluated = await evaluateApplyDeletion(shared, hash);
  const applied = await applyDeletion({ ...shared, target: { removeItem } }, hash);
  return { evaluated, applied, removeItem };
}

/** Every ledger-side refusal, as (name, ledger-setup, expected code). */
const CASES: Array<{
  name: string;
  allow: boolean;
  seed: (ledger: MemoryLedger) => Promise<unknown> | void;
  expectCode: string;
}> = [
  {
    name: 'gate 1: not enabled',
    allow: false,
    seed: (l) => l.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString() })),
    expectCode: 'not_enabled',
  },
  {
    name: 'no such item',
    allow: true,
    seed: () => {},
    expectCode: 'not_found',
  },
  {
    name: 'already applied',
    allow: true,
    seed: (l) =>
      l.recordIfAbsent(
        baseRow({
          deletionReportedAt: new Date().toISOString(),
          deletionAppliedAt: new Date().toISOString(),
          status: 'tombstoned',
        }),
      ),
    expectCode: 'already_applied',
  },
  {
    name: 'gate 3: nothing says it was deleted',
    allow: true,
    seed: (l) => l.recordIfAbsent(baseRow()),
    expectCode: 'not_confirmed',
  },
  {
    name: 'gate 3: inferred-only absence',
    allow: true,
    seed: (l) => l.recordIfAbsent(baseRow({ absentPasses: 3 })),
    expectCode: 'weak_evidence',
  },
  {
    name: 'gate 4: not on the target',
    allow: true,
    seed: (l) =>
      l.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString(), status: 'failed' })),
    expectCode: 'not_ours',
  },
  {
    name: 'gate 4: adopted bytes are the customer’s',
    allow: true,
    seed: (l) =>
      l.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString(), status: 'adopted' })),
    expectCode: 'not_ours',
  },
  {
    // On the target as far as `isOnTarget` is concerned, and outside the set
    // the ledger's own statement accepts. The two must refuse it identically,
    // or the route promises what the job destroys and then cannot record.
    name: 'gate 4: a status the ledger would refuse to record',
    allow: true,
    seed: (l) =>
      l.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString(), status: 'pending' })),
    expectCode: 'not_ours',
  },
];

describe('evaluate and apply agree on every ledger-side refusal', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const ledger = new MemoryLedger();
      await c.seed(ledger);
      const { evaluated, applied, removeItem } = await both(ledger, c.allow);

      expect(evaluated.ok).toBe(false);
      expect(applied.ok).toBe(false);
      if (!evaluated.ok && !applied.ok) {
        expect(evaluated.code).toBe(c.expectCode);
        // THE drift-lock: not just both-refuse, the SAME refusal.
        expect(applied.code).toBe(evaluated.code);
      }
      // A refusal the evaluator can see must stop the full path before the
      // target — the distinction several gates exist to keep visible.
      expect(removeItem).not.toHaveBeenCalled();
    });
  }

  it('gate 6: the mass-deletion breaker fires identically', async () => {
    const ledger = new MemoryLedger();
    // A corpus over the floor, every item pending confirmed deletion.
    for (let i = 0; i < MASS_DELETION_MIN_ITEMS + 5; i++) {
      await ledger.recordIfAbsent(
        baseRow({
          naturalKeyHash: `nk-${i}`,
          targetId: `t-${i}`,
          deletionReportedAt: new Date().toISOString(),
        }),
      );
    }
    const { evaluated, applied, removeItem } = await both(ledger, true, 'nk-3');
    expect(evaluated.ok).toBe(false);
    expect(applied.ok).toBe(false);
    if (!evaluated.ok && !applied.ok) {
      expect(evaluated.code).toBe('mass_deletion_suspected');
      expect(applied.code).toBe(evaluated.code);
    }
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('and when every ledger gate permits, the evaluator predicts what the path performs', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(baseRow({ deletionReportedAt: new Date().toISOString() }));
    const { evaluated, applied, removeItem } = await both(ledger, true);

    expect(evaluated).toEqual({ ok: true, domain: 'calendar' });
    // The prediction held: the full path went on to remove.
    expect(applied.ok).toBe(true);
    expect(removeItem).toHaveBeenCalledTimes(1);
  });
});

/**
 * The same drift-lock, for the RELOCATION pair (ADR-0030).
 *
 * `evaluateApplyRelocation` duplicates `applyRelocation`'s ledger-side gates
 * for the same reason and carries the same hazard, so it gets the same
 * treatment: every case runs both against one ledger and demands the same
 * refusal, with the target never reached when the evaluator can already say no.
 */
const RELOCATION_TENANT = TENANT;
const OLD = 'Docs/report.pdf';
const NEW = 'Docs/summary.pdf';

function fileRow(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: RELOCATION_TENANT,
    mappingId: MAPPING,
    itemType: 'file',
    naturalKeyHash: OLD,
    contentHash: 'h-same',
    targetId: 'target/report.pdf',
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Docs',
    ...overrides,
  };
}

async function bothRelocation(ledger: MemoryLedger, allow: boolean, hash = OLD) {
  const removeItem = vi.fn(async () => ({ kind: 'deleted' as const, conflicted: false }));
  const hasItem = vi.fn(async () => true);
  const shared = {
    tenantId: RELOCATION_TENANT,
    mappingId: MAPPING,
    domain: 'file' as const,
    ledger,
    allowApplyDeletions: allow,
  };
  const evaluated = await evaluateApplyRelocation(shared, hash);
  const applied = await applyRelocation({ ...shared, target: { removeItem, hasItem } }, hash);
  return { evaluated, applied, removeItem };
}

const RELOCATION_CASES: Array<{
  name: string;
  allow: boolean;
  seed: (l: MemoryLedger) => Promise<unknown>;
  expectCode: string;
}> = [
  {
    name: 'gate 1: the mapping has not opted in',
    allow: false,
    seed: (l) => l.recordIfAbsent(fileRow()),
    expectCode: 'not_enabled',
  },
  {
    name: 'no row at all',
    allow: true,
    seed: () => Promise.resolve(),
    expectCode: 'not_found',
  },
  {
    name: 'gate 3 (relocation form): nothing was relocated',
    allow: true,
    seed: (l) => l.recordIfAbsent(fileRow()),
    expectCode: 'not_relocated',
  },
  {
    name: 'gate 3 (relocation form): the arrival is not in the ledger',
    allow: true,
    seed: async (l) => {
      await l.recordIfAbsent(fileRow());
      await l.recordMove(RELOCATION_TENANT, MAPPING, 'file', OLD, 'Docs', NEW);
    },
    expectCode: 'relocation_unconfirmed',
  },
  {
    name: 'gate 3 (relocation form): the arrival was adopted, not written by us',
    allow: true,
    seed: async (l) => {
      await l.recordIfAbsent(fileRow());
      await l.recordIfAbsent(
        fileRow({ naturalKeyHash: NEW, targetId: 'target/summary.pdf', status: 'adopted' }),
      );
      await l.recordMove(RELOCATION_TENANT, MAPPING, 'file', OLD, 'Docs', NEW);
    },
    expectCode: 'relocation_unconfirmed',
  },
  {
    name: 'gate 4: the copy to be removed is not ours',
    allow: true,
    seed: async (l) => {
      await l.recordIfAbsent(fileRow({ status: 'adopted' }));
      await l.recordIfAbsent(fileRow({ naturalKeyHash: NEW, targetId: 'target/summary.pdf' }));
      await l.recordMove(RELOCATION_TENANT, MAPPING, 'file', OLD, 'Docs', NEW);
    },
    expectCode: 'not_ours',
  },
  {
    // The status set the SQL accepts, which is narrower than "on the target".
    name: 'gate 4: a status the ledger would refuse to record',
    allow: true,
    seed: async (l) => {
      await l.recordIfAbsent(fileRow({ status: 'pending' }));
      await l.recordIfAbsent(fileRow({ naturalKeyHash: NEW, targetId: 'target/summary.pdf' }));
      await l.recordMove(RELOCATION_TENANT, MAPPING, 'file', OLD, 'Docs', NEW);
    },
    expectCode: 'not_ours',
  },
  {
    name: 'the owner already answered this one with `keep`',
    allow: true,
    seed: async (l) => {
      await l.recordIfAbsent(fileRow());
      await l.recordIfAbsent(fileRow({ naturalKeyHash: NEW, targetId: 'target/summary.pdf' }));
      await l.recordMove(RELOCATION_TENANT, MAPPING, 'file', OLD, 'Docs', NEW);
      await l.resolveMove(RELOCATION_TENANT, MAPPING, OLD, 'keep');
    },
    expectCode: 'already_kept',
  },
  {
    // Gate 6's second half. The evaluator is what the managed route would call
    // before enqueueing, so a breaker only `applyRelocation` knew about would
    // promise an operator something the job then refuses.
    name: 'gate 6: too much of the domain has relocated at once',
    allow: true,
    seed: async (l) => {
      await l.recordIfAbsent(fileRow());
      await l.recordIfAbsent(fileRow({ naturalKeyHash: NEW, targetId: 'target/summary.pdf' }));
      await l.recordMove(RELOCATION_TENANT, MAPPING, 'file', OLD, 'Docs', NEW);
      for (let i = 0; i < 9; i += 1) {
        await l.recordIfAbsent(
          fileRow({ naturalKeyHash: `o-${i}`, contentHash: `c-${i}`, targetId: `t/o-${i}` }),
        );
        await l.recordIfAbsent(
          fileRow({ naturalKeyHash: `n-${i}`, contentHash: `c-${i}`, targetId: `t/n-${i}` }),
        );
        await l.recordMove(RELOCATION_TENANT, MAPPING, 'file', `o-${i}`, 'Docs', `n-${i}`);
      }
    },
    expectCode: 'mass_relocation_suspected',
  },
];

describe('evaluate and apply agree on every ledger-side relocation refusal', () => {
  for (const c of RELOCATION_CASES) {
    it(c.name, async () => {
      const ledger = new MemoryLedger();
      await c.seed(ledger);
      const { evaluated, applied, removeItem } = await bothRelocation(ledger, c.allow);

      expect(evaluated.ok).toBe(false);
      expect(applied.ok).toBe(false);
      if (!evaluated.ok && !applied.ok) {
        expect(evaluated.code).toBe(c.expectCode);
        expect(applied.code).toBe(evaluated.code);
      }
      expect(removeItem).not.toHaveBeenCalled();
    });
  }

  it('and when every ledger gate permits, the evaluator predicts the removal', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(fileRow());
    await ledger.recordIfAbsent(fileRow({ naturalKeyHash: NEW, targetId: 'target/summary.pdf' }));
    await ledger.recordMove(RELOCATION_TENANT, MAPPING, 'file', OLD, 'Docs', NEW);

    const { evaluated, applied, removeItem } = await bothRelocation(ledger, true);

    expect(evaluated).toEqual({ ok: true, domain: 'file' });
    expect(applied.ok).toBe(true);
    expect(removeItem).toHaveBeenCalledTimes(1);
  });
});

// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A DELETION KEPT WHILE ITS REMOVAL WAITED (2026-11-22; ADR-0024): the
 * managed job's half, read off its own source.
 *
 * On managed the route answers a press from the ledger
 * (`evaluateApplyDeletion`) and queues a job, and somebody can keep the copy
 * while the job waits. The refusal is core's: `applyDeletion` refuses a kept
 * row with `already_kept` before anything is sent to the target, and
 * `packages/core/src/a-deletion-the-owner-kept.unit.test.ts` holds exactly
 * that order (the route permits, the keep lands, the job's `applyDeletion`
 * refuses). What the job has to do for it to hold is ask core again, at the
 * removal, over the ledger as it is then, and land core's refusal on the
 * receipt as it came. The job opens its pools at import, so a test cannot run
 * it: the shape is pinned here, as `an-apply-pressed-after-cutover.unit.test.ts`
 * pins the question it hands over. The run is `apply-one-item.ts`, shared with
 * the relocation job, and the job hands it core's `applyDeletion`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dirname, 'run-apply-deletion.ts'), 'utf8');
/** The run the deletion job hands core's function to (`apply-one-item.ts`). */
const shared = readFileSync(join(import.meta.dirname, 'apply-one-item.ts'), 'utf8');
const run = shared.slice(shared.indexOf('export async function applyOneItem('));

describe('the managed deletion job, for a row kept after its press', () => {
  it("asks core's own applyDeletion at the removal, never the route's earlier answer", () => {
    expect(source).toMatch(/^import \{ applyDeletion \} from '@openmig\/core';$/m);
    expect(source).toContain('  apply: applyDeletion,\n');
    expect(source).toContain('applyOneItem(JOB, pool, payload)');
    expect(source).not.toContain('evaluateApplyDeletion');
    expect(shared).not.toContain('evaluateApplyDeletion');
    expect(run).toContain('outcome = await job.apply(');
  });

  it('over the ledger it opens for the removal, so a keep recorded meanwhile is read', () => {
    expect(run).toContain('const deps = await openDeps(pool, tenantId, mappingId, domain);');
    expect(run).toContain('ledger: deps.ledger,');
  });

  it("lands core's refusal on the receipt as it came, code and reason", () => {
    expect(run).toMatch(
      /await landReceipt\(pool, tenantId, receiptId, \{\s*state: 'refused',\s*code: outcome\.code,\s*reason: outcome\.reason,\s*\}\);/,
    );
  });
});

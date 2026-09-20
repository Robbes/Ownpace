// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A stranger's counts, on the nightly (workplan 0088 T6).
 *
 * `managed-retention.ts` is only wiring, and this holds the wiring to the one
 * thing the ledger cannot decide for itself: who is a customer. The ledger's
 * own test is "a pass has ever run for the tenant"; a customer whose runs were
 * pruned to an invoice has no run rows left, and only the managed job can see
 * the invoice. So the job must pass its invoiced tenants — the same rows it
 * just used to bound the run prune — or a paying customer's preflight counts
 * go the way of a stranger's after seven days.
 *
 * And the knob must reach the task: a variable a task reads and nobody uploads
 * is one that, set, does nothing (set-task-env.sh's own header).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const wiring = readFileSync(fileURLToPath(new URL('./managed-retention.ts', import.meta.url)), 'utf8');
const upload = readFileSync(
  fileURLToPath(new URL('../../../../deploy/compose/set-task-env.sh', import.meta.url)),
  'utf8',
);

describe('the nightly prunes a stranger\'s preflight counts', () => {
  it('read the real files', () => {
    expect(wiring.length).toBeGreaterThan(1000);
    expect(upload.length).toBeGreaterThan(1000);
  });

  it('calls the ledger rule with the invoiced tenants as customers, after finding them', () => {
    expect(wiring).toContain("prunePreflightCounts,");
    const billed = wiring.indexOf('FROM invoice');
    const call = wiring.indexOf('prunePreflightCounts(db, now, {');
    expect(billed).toBeGreaterThan(-1);
    expect(call, 'the prune must run after the invoiced tenants are known').toBeGreaterThan(billed);
    expect(wiring).toContain('customerTenantIds: (billed.rows ?? []).map((row) => row.tenant_id)');
  });

  it('reads the window through the shared parser, never a bare Number()', () => {
    expect(wiring).toContain('preflightRetentionDaysFromEnv(process.env.PREFLIGHT_RETENTION_DAYS)');
    expect(wiring).not.toMatch(/Number\(process\.env\.PREFLIGHT_RETENTION_DAYS/);
  });

  it('reports what it deleted, so an operator can see the promise being kept', () => {
    expect(wiring).toContain('preflightDeleted: preflight.deleted');
    expect(wiring).toMatch(/\[retention\] deleted \$\{preflight\.deleted\} preflight count row/);
  });

  it('is a knob the task can actually see', () => {
    expect(upload).toContain('PREFLIGHT_RETENTION_DAYS="${PREFLIGHT_RETENTION_DAYS:-}"');
    expect(upload).toContain('"PREFLIGHT_RETENTION_DAYS",');
  });
});

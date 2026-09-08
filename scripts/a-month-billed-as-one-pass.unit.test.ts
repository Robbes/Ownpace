// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A month of passes must not be billed as the last one — and the freeze that
 * lets the rows it is derived from be deleted must stay.
 *
 * ## The defect, and the fix that replaced the fix
 *
 * `usage_metric` was keyed (tenant, period, metricType, resource) with
 * `resource` = `domain-<domain>`, and the write REPLACED. So a billing period
 * held the duration of the LAST pass metered in it: on the default
 * fifteen-minute cadence, one 20-second pass standing for 2 976 of them,
 * which the invoice rounded to €0.00. Workplan 0121 narrowed the key to include the run.
 * That was correct and it cost 2 976 rows per mapping per month — measured at
 * 18.7 MB, on a table nothing prunes.
 *
 * So the owner asked why the rows existed at all, and T3 removed them:
 * compute and sync operations DERIVE from the `run` ledger, exactly as storage
 * and egress already derive from `item`. `usage_metric` now has no writer.
 *
 * ## The half nobody would think to look for
 *
 * Deriving billing from `run` gives its historical body its FIRST consumer.
 * Every other reader touches the newest twenty-one rows of a mapping
 * (`listRunsWithEvents`) or rows still `running`/`queued` (the sync tick,
 * `managed-purge-closed`, the erasure quiesce) — so before this, old run rows
 * were prunable, and `retention.ts` keeps them by choice rather than need.
 * Derivation alone would have made them load-bearing for ever and quietly
 * removed that choice.
 *
 * `invoice-generation.ts` freezing the measured quantities is what prevents
 * that: the number stops depending on the rows, ADR-0044 and migration 0014
 * make it immutable, and retention on `run` goes back to being a storage
 * decision. A future reader would see a `measured` object beside
 * `costByDriver` and reasonably call it redundant. It is not, and this fails
 * if it goes.
 *
 * ## Why read as text
 *
 * `BILLABLE_RUN_KINDS` is a value and is asserted for real. The rest is the
 * SHAPE of a SQL predicate, of an absent write, and of one object literal in
 * a route — none observable without a database, two DAV servers and a
 * Trigger.dev runtime. `usage-metering.integration.test.ts` runs the
 * behaviour against a real Postgres; this holds the seam those three files
 * must agree on, which none of them can see alone.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BILLABLE_RUN_KINDS } from '../packages/managed/src/usage-metering.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The same text with its comments removed — a comment is prose about code. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const read = (rel: string): string => code(readFileSync(join(REPO_ROOT, rel), 'utf8'));

const METERING = 'packages/managed/src/usage-metering.ts';
const DISPATCHER = 'apps/worker/src/jobs/run-delta-sync.ts';
const INVOICE = 'apps/api/src/services/invoice-generation.ts';

describe('compute is derived, and derived from the passes that ran', () => {
  const source = read(METERING);

  it('counts the two run kinds anything actually writes', () => {
    // `cutover`, `verify`, `discovery` and `backup` are in the CHECK with no
    // writer. Listed rather than open, so the day one gains a writer somebody
    // has to decide whether it is billable instead of it starting silently.
    expect([...BILLABLE_RUN_KINDS].sort()).toEqual(['incremental', 'initial_copy']);
  });

  it('sums the run ledger rather than reading a stored figure', () => {
    expect(source).toMatch(/export async function deriveComputeForPeriod/);
    expect(source).toMatch(/SUM\(EXTRACT\(EPOCH FROM \(\$\{schema\.run\.finishedAt\}/);
  });

  it('ignores a pass that never closed', () => {
    // No `finished_at` means the process was killed outright. Billing it would
    // invent a duration; the old upsert never metered it either.
    expect(source).toMatch(/isNotNull\(schema\.run\.finishedAt\)/);
  });

  it('asks for a half-open window, so the last day of the month is in it', () => {
    // `periodEnd` is a DATE: `lte` is midnight and drops the whole 31st.
    expect(source).toMatch(/lt\(schema\.run\.createdAt, until\)/);
    expect(source).not.toMatch(/lte\(schema\.run\.createdAt/);
  });

  it('no longer reads usage_metric, which has nothing left to write to it', () => {
    const body = source.slice(source.indexOf('export async function getUsageMetricsForPeriod'));
    expect(body).not.toContain('schema.usageMetric');
  });

  it('has no writer for usage_metric anywhere in the module', () => {
    expect(source).not.toMatch(/insert\(schema\.usageMetric\)/);
  });
});

describe('the dispatcher records where the time went, and writes no billing row', () => {
  const source = read(DISPATCHER);

  it('does not meter inside the per-domain try', () => {
    // Both upserts used to sit one line above the catch that logs
    // `Domain <domain> sync failed` and calls markFailed — so a billing write
    // that threw was reported to the customer as a failed mail migration.
    expect(source).not.toContain('recordComputeForRun');
    expect(source).not.toContain('recordApiCallForRun');
  });

  it('carries the per-domain seconds into the run row it already closes', () => {
    expect(source).toMatch(/domainSeconds\[domain\]\s*=/);
    expect(source).toMatch(/finishRun\(runId, outcome, \{[^}]*domainSeconds[^}]*\}\)/);
  });
});

describe('the invoice freezes what was measured, not only what was charged', () => {
  const source = read(INVOICE);

  it('writes the measured quantities onto the invoice', () => {
    // Without this the run rows ARE the invoice's basis and can never be
    // deleted. See this file's header.
    expect(source).toMatch(/const measured = \{/);
    for (const field of ['computeHours', 'syncCount', 'storageBytes', 'egressBytes']) {
      expect(source, `measured drops ${field}`).toMatch(new RegExp(`${field}:\\s*usage\\.`));
    }
  });

  it('puts them in the metadata the invoice actually stores', () => {
    expect(source).toMatch(/const metadata = \{[^}]*measured[^}]*\}/);
  });
});

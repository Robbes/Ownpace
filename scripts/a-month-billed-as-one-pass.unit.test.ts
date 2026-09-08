// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A month of passes must not be billed as the last one — compute and sync
 * operations are metered per PASS and summed at read.
 *
 * ## The defect
 *
 * `recordComputeForRun` and `recordApiCallForRun` write one row keyed by
 * (tenantId, periodStart, metricType, resource), and `resource` was
 * `domain-<domain>` / `sync-<domain>` — a value with no pass in it. The write
 * is an upsert that REPLACES, which is what makes a Trigger.dev retry safe,
 * and which also meant that the second pass of a month overwrote the first.
 * So `usage_metric` held, for a whole billing period:
 *
 *   - compute: the duration of the LAST pass metered in it. A mapping syncing
 *     every 15 minutes for 31 days recorded one 20-second pass — at
 *     €0.05/hour, €0.00 for a month of continuous copying.
 *   - api_calls: `quantity: '1'` per domain, so the "number of sync
 *     operations" in a month was the number of DOMAINS that had ever run in
 *     it. Never more than five, whether the mapping synced twice or 2 976
 *     times.
 *
 * `getUsageMetricsForPeriod` already SUMS the rows it finds. It was summing a
 * set that could never have more than one member per domain, so nothing about
 * the read was wrong and nothing about the read revealed it.
 *
 * ## The fix this pins
 *
 * The run id joins the key — `domain-<domain>#<runId>` — so each pass owns a
 * row and the period's compute is their sum. The upsert is untouched: a retry
 * of the same run rewrites its own row rather than adding a second, so
 * retry-safety is kept rather than traded for correctness. That was the whole
 * objection to the obvious alternative of making the write accumulate.
 *
 * Owner's decision, 2026-09-08, over accumulate-in-place and over leaving it:
 * *"the actual measures of compute are for me to understand if the pricing is
 * somewhat balanced and fair"* — which needs the per-pass grain, not merely a
 * correct monthly total.
 *
 * ## Why read as text
 *
 * `perPassResource` is a pure function and is called for real below. The rest
 * is the SHAPE of two writes and one read against a Postgres table under RLS,
 * plus a dispatcher that needs a database, two DAV servers and a Trigger.dev
 * runtime to reach. `usage-metering.integration.test.ts` runs the behaviour
 * against a real database; this holds the seam where the two meters and their
 * one caller must agree, which no single one of them can see.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { perPassResource } from '../packages/managed/src/usage-metering.ts';

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

/** The body of a named exported function, up to the next top-level `export`. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`) >= 0
    ? source.indexOf(`export async function ${name}`)
    : source.indexOf(`export function ${name}`);
  expect(start, `${name} is not an exported function of ${METERING}`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const end = rest.indexOf('\nexport ');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('the row key names the pass', () => {
  it('puts the run id in the resource, for both kinds', () => {
    expect(perPassResource('domain', 'email', 'run-a')).toBe('domain-email#run-a');
    expect(perPassResource('sync', 'calendar', 'run-b')).toBe('sync-calendar#run-b');
  });

  it('gives two passes of one domain two different keys', () => {
    // The whole defect in one assertion: these were equal.
    expect(perPassResource('domain', 'email', 'run-a')).not.toBe(
      perPassResource('domain', 'email', 'run-b'),
    );
  });

  it('gives a retry of one pass the same key', () => {
    // And this is what must NOT change: an upsert on an unchanged key is what
    // makes a Trigger.dev retry rewrite its own row instead of adding one.
    expect(perPassResource('domain', 'email', 'run-a')).toBe(
      perPassResource('domain', 'email', 'run-a'),
    );
  });

  it('keeps the two kinds apart, so a compute row cannot collide with a sync row', () => {
    expect(perPassResource('domain', 'email', 'run-a')).not.toBe(
      perPassResource('sync', 'email', 'run-a'),
    );
  });
});

describe('both meters key by the pass, through the one function', () => {
  const source = read(METERING);

  for (const meter of ['recordComputeForRun', 'recordApiCallForRun']) {
    it(`${meter} builds its resource with perPassResource`, () => {
      const body = functionBody(source, meter);
      expect(body).toMatch(/resource:\s*perPassResource\(/);
    });

    it(`${meter} does not build a resource string of its own`, () => {
      // A second way to spell the key is a second way for it to drift: the
      // property that matters is that BOTH are per-pass, and a literal here
      // is how one of them silently stops being.
      const body = functionBody(source, meter);
      expect(body).not.toMatch(/resource:\s*[`'"]/);
    });

    it(`${meter} still upserts on the same four columns`, () => {
      const body = functionBody(source, meter);
      expect(body).toContain('onConflictDoUpdate');
      for (const column of ['tenantId', 'periodStart', 'metricType', 'resource']) {
        expect(body).toContain(`schema.usageMetric.${column}`);
      }
    });
  }

  it('requires a run id on both inputs — an optional one is a row that silently collides', () => {
    for (const iface of ['ComputeUsageInput', 'ApiCallUsageInput']) {
      const block = source.slice(source.indexOf(`export interface ${iface}`));
      const fields = block.slice(0, block.indexOf('}'));
      expect(fields, `${iface} has no runId`).toMatch(/\brunId:\s*string/);
      expect(fields, `${iface}.runId is optional`).not.toMatch(/\brunId\?/);
    }
  });

  it('does not round a pass\u2019s cost to the cent', () => {
    // Rounding that happened once a month now happens once a pass. At
    // €0.05/hour a 20-second pass costs 0.028 cents; rounded it is 0, and a
    // month of them sums to nothing. `total_cost` is `numeric`, so the exact
    // value fits, and `calculateCost` still rounds once at the invoice.
    const body = functionBody(source, 'recordComputeForRun');
    expect(body).not.toMatch(/Math\.round/);
  });

  it('sums the rows it reads rather than taking one of them', () => {
    const body = functionBody(source, 'getUsageMetricsForPeriod');
    expect(body).toMatch(/computeHours\s*\+=/);
    expect(body).toMatch(/apiCallCount\s*\+=/);
  });
});

describe('the managed dispatcher hands each meter the run it just ran', () => {
  const source = read(DISPATCHER);

  it('passes runId to both meters', () => {
    // `runId` is in scope for the whole task; what matters is that it reaches
    // the two calls, so the assertion is scoped to each call's arguments.
    const compute = /await recordComputeForRun\(db, \{([\s\S]*?)\}, /.exec(source);
    expect(compute, 'recordComputeForRun is not called in the dispatcher').not.toBeNull();
    expect(compute?.[1]).toMatch(/(^|\n)\s*runId,/);

    const api = /await recordApiCallForRun\(db, \{([\s\S]*?)\}\)/.exec(source);
    expect(api, 'recordApiCallForRun is not called in the dispatcher').not.toBeNull();
    expect(api?.[1]).toMatch(/\brunId\b/);
  });

  it('meters the pass it just ran, not the window on the status row', () => {
    // Workplan 0121 is only about the KEY. The CLOCK was 0117's fix, in the
    // same three lines, and a rewrite that reintroduced `completedAt` from
    // `migration_status` would meter a negative hour for every paused pass
    // while every assertion above still passed.
    const compute = /await recordComputeForRun\(db, \{([\s\S]*?)\}, /.exec(source)?.[1] ?? '';
    expect(compute).toMatch(/startedAt:\s*domainPassStartedAt/);
    expect(compute).toMatch(/completedAt:\s*passEndedAt/);
  });
});

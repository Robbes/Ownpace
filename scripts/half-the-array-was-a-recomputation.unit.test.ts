// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `GET /api/billing/usage/history` returned one array whose two halves meant
 * different things by `cost` (workplan 0121 T4 follow-up; 0109 T5's neighbour).
 *
 * The endpoint answers for months two ways. Months the run ledger still holds
 * are derived from it. Months T5's prune removed are read off the issued
 * invoice that froze them (0121 §4b, the owner's choice on 2026-09-09:
 * *"fallback (read from issued invoices)"*).
 *
 * The invoice half was right, and the route says why in its own words —
 * *"the money comes off the invoice rather than being re-priced at today's
 * list."* The ledger half, in the same array and under the same field name,
 * called `calculateCost(...)` on every request. So `cost` meant *what you were
 * charged* on some rows and *what today's list would charge for those
 * quantities* on others, with nothing on the row saying which.
 *
 * And the list it re-priced at is **retired**: base fee, per-GB storage and
 * egress, per-hour compute — replaced by ADR-0014's five tiers on 2026-08-20,
 * and refused at `POST /invoices/generate` since 2026-08-27.
 *
 * ## Why the obvious repair is not available
 *
 * Deriving the month's TIER instead sounds right and cannot be done from what
 * is stored. ADR-0014 needs both axes **as they stood in that month**:
 *
 *  - the peak axis IS per month (`occupancy_peak`, keyed `(tenant_id, month)`);
 *  - the data axis is NOT (`bytes_moved`, one lifetime total per tenant).
 *
 * Pricing March against today's cumulative bytes files every old month under
 * whatever band the customer has since grown into — an error that grows with
 * the customer, on a screen about money. This suite pins that asymmetry, so
 * the argument survives as a fact about the schema rather than as a claim in
 * a comment somebody may doubt.
 *
 * So: quantities for what we hold, money only where an invoice recorded it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const ROUTES = 'apps/api/src/routes/billing/index.ts';

/** The `/usage/history` handler, comments stripped — guards read code. */
function historyHandler(): string {
  const src = read(ROUTES);
  const start = src.indexOf("router.get('/usage/history'");
  const end = src.indexOf("router.post('/estimate'", start);
  expect(start, `${ROUTES} no longer declares GET /usage/history`).toBeGreaterThan(-1);
  expect(end, `${ROUTES} no longer declares POST /estimate`).toBeGreaterThan(start);
  return src
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('half the array was a recomputation', () => {
  it('the history handler quotes no money of its own', () => {
    expect(
      historyHandler(),
      'GET /usage/history is pricing again. Its ledger-derived rows sit in the same array ' +
        'as rows whose money is read off a frozen invoice — a recomputation there means ' +
        '`cost` has two meanings in one response, and the recomputation would be at a ' +
        'price list ADR-0014 retired in August.',
    ).not.toMatch(/calculateCost/);
  });

  it('it does not read a price list it has no use for', () => {
    // The per-tenant agreement was fetched solely to feed the recomputation.
    // Left behind it is a round trip per request that answers nobody, and a
    // standing invitation to find a use for it.
    expect(
      historyHandler(),
      'the history handler resolves tenant pricing again. Nothing in it quotes a price.',
    ).not.toMatch(/resolveTenantPricing/);
  });

  it('a ledger-derived row may omit cost; the type says so', () => {
    // If `cost` goes back to required, the only way to satisfy the compiler is
    // to invent a number for months nobody invoiced.
    expect(
      read('apps/api/src/services/usage-history.ts'),
      'UsageHistoryRow.cost is required again, which forces every ledger month to carry a ' +
        'money figure that nothing recorded.',
    ).toMatch(/cost\?: UsageCost/);
  });

  it('the invoice half still reads its money off the invoice', () => {
    // The other direction: this must not be "fixed" by dropping money from the
    // invoice rows too. Those figures are the frozen record, and 0121 T3 froze
    // them precisely so pruning `run` could not erase a billed month.
    const service = read('apps/api/src/services/usage-history.ts');
    expect(service).toMatch(/costByDriver/);
    expect(
      service,
      'rowFromIssuedInvoice must keep reading the invoice, never re-deriving it',
    ).toMatch(/rowFromIssuedInvoice/);
  });

  it('the schema still cannot answer for a past month, which is why no tier is derived', () => {
    // THE LOAD-BEARING FACT. If `bytes_moved` ever gains a per-month grain,
    // deriving a historical tier becomes possible and this whole decision is
    // worth revisiting — so the guard fails then, rather than leaving a stale
    // "cannot be done" comment behind.
    const peak = read('packages/managed/migrations/0015_the_month_remembers_its_peak.sql');
    const bytes = read('packages/managed/migrations/0016_the_meter_counts_the_first_copy.sql');

    expect(peak, 'occupancy_peak is no longer keyed per month').toMatch(
      /CONSTRAINT occupancy_peak_pkey PRIMARY KEY \(tenant_id, month\)/,
    );
    expect(
      bytes,
      'bytes_moved has gained a grain finer than one row per tenant. If it now records ' +
        'per-month totals, a historical tier IS derivable and `/usage/history` could quote ' +
        'a real price for old months instead of none — revisit the decision this guard ' +
        'protects rather than editing the assertion.',
    ).toMatch(/tenant_id uuid NOT NULL PRIMARY KEY/);
  });
});

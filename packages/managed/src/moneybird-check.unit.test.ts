// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `operator.sh moneybird check` (workplan 0111, slice 1): what the
 * deployment would invoice with, asked of the administration.
 *
 * What matters here: off asks nothing; on makes exactly two reads, the rates
 * and the workflows, and nothing that costs a sandbox anything; each treatment
 * says what it resolves to, outside-EU refused by name without failing the
 * check; half a set still lists the ids to pick from and fails; and no line,
 * in any of these, carries the token.
 */

import { describe, it, expect } from 'vitest';
import { checkMoneybird } from './moneybird-check.ts';

const TOKEN = 'not-a-real-token-and-never-printed';

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const impl = (async (url: unknown) => {
    calls.push(String(url));
    return handler(String(url));
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A sandbox as it stood on 2026-10-05, with made-up ids. */
const RATES = [
  { id: '611', name: '21% btw', percentage: '21.0', tax_rate_type: 'sales_invoice', active: true, country: null },
  { id: '612', name: '9% btw', percentage: '9.0', tax_rate_type: 'sales_invoice', active: true, country: null },
  {
    id: '622',
    name: 'Dienst binnen EU (btw verlegd)',
    percentage: null,
    tax_rate_type: 'sales_invoice',
    active: true,
    country: null,
    show_tax: false,
  },
  { id: '640', name: 'DE 19%', percentage: '19.0', tax_rate_type: 'sales_invoice', active: true, country: 'DE' },
];
const WORKFLOWS = [
  { id: '701', type: 'InvoiceWorkflow', name: 'Standaard', default: true, active: true, prices_are_incl_tax: false },
  { id: '702', type: 'InvoiceWorkflow', name: 'Ownpace sandbox', default: false, active: true, prices_are_incl_tax: true },
  { id: '703', type: 'EstimateWorkflow', name: 'Offertes', default: true, active: true, prices_are_incl_tax: false },
];

function sandbox(rates: unknown = RATES, workflows: unknown = WORKFLOWS) {
  return fakeFetch((url) => (url.includes('/tax_rates.json') ? json(rates) : json(workflows)));
}

const ON = {
  MONEYBIRD_API_TOKEN: TOKEN,
  MONEYBIRD_ADMINISTRATION_ID: '123456789012345678',
  MONEYBIRD_WORKFLOW_ID: '702',
  MONEYBIRD_TAX_RATE_ID_DOMESTIC: '611',
  MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE: '622',
};

function noToken(lines: readonly string[]): void {
  for (const line of lines) expect(line).not.toContain(TOKEN);
}

describe('checkMoneybird', () => {
  it('off asks Moneybird nothing and passes', async () => {
    const { impl, calls } = sandbox();
    const report = await checkMoneybird({ MONEYBIRD_API_TOKEN: '', MONEYBIRD_DELIVERY: ' ' }, impl);
    expect(report.ok).toBe(true);
    expect(report.lines.join('\n')).toContain('Moneybird is off');
    expect(calls).toEqual([]);
  });

  it('on: two reads, each treatment resolved or refused by name, the workflow and its VAT setting', async () => {
    const { impl, calls } = sandbox();
    const report = await checkMoneybird(ON, impl);
    const text = report.lines.join('\n');

    expect(calls.map((url) => new URL(url).pathname)).toEqual([
      '/api/v2/123456789012345678/tax_rates.json',
      '/api/v2/123456789012345678/workflows.json',
    ]);
    expect(text).toContain('  622  Dienst binnen EU (btw verlegd)  (no percentage)');
    expect(text).toContain('  640  DE 19%  (19.0%, DE)');
    expect(text).toContain('  domestic_standard: 611 "21% btw" (21.0%)');
    expect(text).toContain('  reverse_charge: 622 "Dienst binnen EU (btw verlegd)" (no percentage)');
    expect(text).toMatch(/ {2}outside_eu: refused \(expected until it is set up\)\. .*MONEYBIRD_TAX_RATE_ID_/);
    expect(text).toMatch(/ {2}destination_oss: refused \(expected until it is set up\)\. OSS/);
    expect(text).toContain('Invoices go through workflow 702 "Ownpace sandbox" (prices include VAT).');
    expect(text).toContain('Delivery: manual.');
    expect(text).toContain('RESULT: ready.');
    expect(report.ok).toBe(true);
    noToken(report.lines);
  });

  it('fails when a treatment a buyer needs today, or the workflow, is not in the administration', async () => {
    const gone = await checkMoneybird({ ...ON, MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE: '999' }, sandbox().impl);
    expect(gone.ok).toBe(false);
    expect(gone.lines.join('\n')).toMatch(/reverse_charge: refused\. Tax rate 999 .*does not exist/);

    const estimate = await checkMoneybird({ ...ON, MONEYBIRD_WORKFLOW_ID: '703' }, sandbox().impl);
    expect(estimate.ok).toBe(false);
    expect(estimate.lines.join('\n')).toContain('not an invoice workflow');
    expect(estimate.lines.at(-1)).toContain('RESULT: not ready.');
  });

  it('an outside-EU rate, once set, resolves too', async () => {
    const report = await checkMoneybird({ ...ON, MONEYBIRD_TAX_RATE_ID_OUTSIDE_EU: '612' }, sandbox().impl);
    expect(report.ok).toBe(true);
    expect(report.lines.join('\n')).toContain('  outside_eu: 612 "9% btw" (9.0%)');
  });

  it('half a set with the token and the administration lists the ids to pick from, and fails', async () => {
    const { impl, calls } = sandbox();
    const report = await checkMoneybird(
      { MONEYBIRD_API_TOKEN: TOKEN, MONEYBIRD_ADMINISTRATION_ID: '123456789012345678' },
      impl,
    );
    const text = report.lines.join('\n');
    expect(report.ok).toBe(false);
    expect(report.lines[0]).toMatch(/^Moneybird is not ready: .*MONEYBIRD_WORKFLOW_ID/);
    expect(calls).toHaveLength(2);
    expect(text).toContain('  622  Dienst binnen EU (btw verlegd)');
    expect(text).toContain('  702  Ownpace sandbox  (InvoiceWorkflow, prices include VAT)');
    expect(text).toContain('  701  Standaard  (InvoiceWorkflow, default, prices exclude VAT)');
    expect(text).not.toContain('Each VAT treatment');
    noToken(report.lines);
  });

  it('half a set without a readable administration asks nothing', async () => {
    const { impl, calls } = sandbox();
    const report = await checkMoneybird({ MONEYBIRD_API_TOKEN: TOKEN, MONEYBIRD_ADMINISTRATION_ID: 'books' }, impl);
    expect(report.ok).toBe(false);
    expect(calls).toEqual([]);
    noToken(report.lines);
  });

  it('a refused token fails the check with the key to fix, and still no token in a line', async () => {
    const report = await checkMoneybird(ON, fakeFetch(() => json({}, 401)).impl);
    expect(report.ok).toBe(false);
    expect(report.lines.join('\n')).toContain('Sales tax rates: not read. Moneybird refused the token (HTTP 401)');
    expect(report.lines.join('\n')).toContain('Workflows: not read.');
    noToken(report.lines);
  });
});

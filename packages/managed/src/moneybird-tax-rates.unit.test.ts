// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The treatment→tax_rate_id seam (workplan 0111 T3).
 *
 * What matters here: the mapping is validated against the administration's
 * REAL list and refuses by name (a deleted rate, an archived one, a purchase
 * rate on a sales invoice), fetch failures are never an empty list, and no
 * selection ever consults a percentage — the resolver would work identically
 * if Moneybird renamed every rate to a colour.
 */

import { describe, it, expect } from 'vitest';
import { fetchSalesTaxRates, resolveTaxRateId, type MoneybirdTaxRate } from './moneybird-tax-rates.ts';

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const CONFIG = { administrationId: '123456789', apiToken: 'not-a-real-token' };

/** The shape Moneybird's own API answers with (snake_case, string ids). */
const WIRE_RATES = [
  { id: '111', name: '21% btw', percentage: '21.0', tax_rate_type: 'sales_invoice', active: true, country: null },
  { id: '222', name: 'Btw verlegd', percentage: '0.0', tax_rate_type: 'sales_invoice', active: true, country: null },
  { id: '333', name: 'Oud tarief', percentage: '19.0', tax_rate_type: 'sales_invoice', active: false, country: null },
  { id: '444', name: 'Voorbelasting', percentage: '21.0', tax_rate_type: 'purchase_invoice', active: true, country: null },
];

describe('fetchSalesTaxRates', () => {
  it('asks the administration for sales rates, bearing the token', async () => {
    const { impl, calls } = fakeFetch(() => json(WIRE_RATES));
    const outcome = await fetchSalesTaxRates(CONFIG, impl);

    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.rates.map((r) => r.id)).toEqual(['111', '222', '333', '444']);
      expect(outcome.rates[0]).toMatchObject({ name: '21% btw', active: true, taxRateType: 'sales_invoice' });
    }
    expect(calls[0]!.url).toContain('/api/v2/123456789/tax_rates.json');
    expect(calls[0]!.url).toContain(encodeURIComponent('tax_rate_type:sales_invoice'));
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer not-a-real-token');
  });

  it('a refused token names the remedy; other failures are unavailable, never an empty list', async () => {
    const denied = await fetchSalesTaxRates(CONFIG, fakeFetch(() => json({}, 401)).impl);
    expect(denied.kind).toBe('unavailable');
    if (denied.kind === 'unavailable') expect(denied.reason).toContain('MONEYBIRD_API_TOKEN');

    for (const impl of [
      fakeFetch(() => json({}, 500)).impl,
      fakeFetch(() => new Response('<html>', { status: 200 })).impl,
      fakeFetch(() => json({ not: 'an array' })).impl,
      (async () => {
        throw new Error('getaddrinfo ENOTFOUND moneybird.com');
      }) as unknown as typeof fetch,
    ]) {
      expect((await fetchSalesTaxRates(CONFIG, impl)).kind).toBe('unavailable');
    }
  });
});

const RATES: readonly MoneybirdTaxRate[] = [
  { id: '111', name: '21% btw', percentage: '21.0', taxRateType: 'sales_invoice', active: true, country: null },
  { id: '222', name: 'Btw verlegd', percentage: '0.0', taxRateType: 'sales_invoice', active: true, country: null },
  { id: '333', name: 'Oud tarief', percentage: '19.0', taxRateType: 'sales_invoice', active: false, country: null },
  { id: '444', name: 'Voorbelasting', percentage: '21.0', taxRateType: 'purchase_invoice', active: true, country: null },
];
const MAPPING = { domesticStandard: '111', reverseCharge: '222' };

describe('resolveTaxRateId', () => {
  it('resolves a configured, active sales rate — surfacing Moneybird’s own number', () => {
    const resolved = resolveTaxRateId('domestic_standard', MAPPING, RATES);
    expect(resolved).toEqual({
      kind: 'resolved',
      taxRateId: '111',
      name: '21% btw',
      percentage: '21.0',
    });
    expect(resolveTaxRateId('reverse_charge', MAPPING, RATES)).toMatchObject({ taxRateId: '222' });
  });

  it('refuses, by name: a missing mapping, a deleted rate, an archived one, a purchase rate', () => {
    const unconfigured = resolveTaxRateId('outside_eu', MAPPING, RATES);
    expect(unconfigured.kind).toBe('unresolved');
    if (unconfigured.kind === 'unresolved') expect(unconfigured.reason).toContain('MONEYBIRD_TAX_RATE_ID_');

    const deleted = resolveTaxRateId('domestic_standard', { ...MAPPING, domesticStandard: '999' }, RATES);
    expect(deleted.kind).toBe('unresolved');
    if (deleted.kind === 'unresolved') expect(deleted.reason).toContain('does not exist');

    const archived = resolveTaxRateId('domestic_standard', { ...MAPPING, domesticStandard: '333' }, RATES);
    expect(archived.kind).toBe('unresolved');
    if (archived.kind === 'unresolved') expect(archived.reason).toContain('INACTIVE');

    const purchase = resolveTaxRateId('domestic_standard', { ...MAPPING, domesticStandard: '444' }, RATES);
    expect(purchase.kind).toBe('unresolved');
    if (purchase.kind === 'unresolved') expect(purchase.reason).toContain('purchase_invoice');
  });

  it('OSS stays deliberately unresolved until the owner flips the threshold decision', () => {
    const oss = resolveTaxRateId('destination_oss', MAPPING, RATES);
    expect(oss.kind).toBe('unresolved');
    if (oss.kind === 'unresolved') expect(oss.reason).toContain('threshold');
  });

  it('selection never reads the percentage — rename every rate to a colour and it still works', () => {
    const colours = RATES.map((r) => ({ ...r, name: 'blauw', percentage: null }));
    expect(resolveTaxRateId('domestic_standard', MAPPING, colours)).toMatchObject({
      kind: 'resolved',
      taxRateId: '111',
      percentage: null,
    });
  });
});

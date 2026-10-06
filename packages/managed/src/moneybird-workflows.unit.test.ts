// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The invoice workflow (workplan 0111, slice 1).
 *
 * What matters here: the configured workflow is checked against the
 * administration's real list and refused by name when it is missing, an
 * estimate's, or archived; whether its prices include VAT is read, never
 * assumed; and a field Moneybird leaves out is unknown, not a refusal.
 */

import { describe, it, expect } from 'vitest';
import { fetchWorkflows, resolveInvoiceWorkflow, type MoneybirdWorkflow } from './moneybird-workflows.ts';

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

const ACCESS = { administrationId: '123456789012345678', apiToken: 'not-a-real-token' };

/** Moneybird's wire shape, the two a fresh sandbox showed plus the cases to refuse. Ids made up. */
const WIRE_WORKFLOWS = [
  {
    id: '111',
    type: 'InvoiceWorkflow',
    name: 'Standaard',
    default: true,
    currency: 'EUR',
    language: 'nl',
    active: true,
    prices_are_incl_tax: false,
  },
  {
    id: '222',
    type: 'InvoiceWorkflow',
    name: 'Ownpace sandbox',
    default: false,
    currency: 'EUR',
    language: 'nl',
    active: true,
    prices_are_incl_tax: true,
  },
  { id: '333', type: 'EstimateWorkflow', name: 'Offertes', default: true, active: true, prices_are_incl_tax: false },
  { id: '444', type: 'InvoiceWorkflow', name: 'Oud', default: false, active: false, prices_are_incl_tax: false },
  { id: 555, type: 'InvoiceWorkflow', name: 'A numeric id', active: true },
  { id: '666', type: 'InvoiceWorkflow', name: 'Says nothing more' },
];

describe('fetchWorkflows', () => {
  it('asks the administration for its workflows and reads each one defensively', async () => {
    const { impl, calls } = fakeFetch(() => json(WIRE_WORKFLOWS));
    const outcome = await fetchWorkflows(ACCESS, impl);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://moneybird.com/api/v2/123456789012345678/workflows.json');
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    // A numeric id is nothing anybody could have configured as text: skipped, never invented.
    expect(outcome.workflows.map((w) => w.id)).toEqual(['111', '222', '333', '444', '666']);
    expect(outcome.workflows[1]).toEqual({
      id: '222',
      name: 'Ownpace sandbox',
      type: 'InvoiceWorkflow',
      active: true,
      isDefault: false,
      pricesAreInclTax: true,
      language: 'nl',
    });
    expect(outcome.workflows[4]).toMatchObject({ active: null, pricesAreInclTax: null, isDefault: false });
  });

  it('a failed read is unavailable, never an empty list', async () => {
    for (const impl of [fakeFetch(() => json({}, 401)).impl, fakeFetch(() => json({ not: 'a list' })).impl]) {
      expect((await fetchWorkflows(ACCESS, impl)).kind).toBe('unavailable');
    }
  });
});

const WORKFLOWS: readonly MoneybirdWorkflow[] = [
  { id: '222', name: 'Ownpace sandbox', type: 'InvoiceWorkflow', active: true, isDefault: false, pricesAreInclTax: true, language: 'nl' },
  { id: '333', name: 'Offertes', type: 'EstimateWorkflow', active: true, isDefault: true, pricesAreInclTax: false, language: 'nl' },
  { id: '444', name: 'Oud', type: 'InvoiceWorkflow', active: false, isDefault: false, pricesAreInclTax: false, language: 'nl' },
  { id: '666', name: 'Says nothing more', type: null, active: null, isDefault: false, pricesAreInclTax: null, language: null },
];

describe('resolveInvoiceWorkflow', () => {
  it('resolves an active invoice workflow, with what it says about VAT', () => {
    const resolved = resolveInvoiceWorkflow('222', WORKFLOWS);
    expect(resolved.kind).toBe('resolved');
    if (resolved.kind === 'resolved') expect(resolved.workflow.pricesAreInclTax).toBe(true);
  });

  it('refuses by name: one the administration does not hold, an estimate workflow, an archived one', () => {
    const cases: Array<[string, string]> = [
      ['999', 'does not exist'],
      ['333', 'not an invoice workflow'],
      ['444', 'INACTIVE'],
    ];
    for (const [id, words] of cases) {
      const outcome = resolveInvoiceWorkflow(id, WORKFLOWS);
      expect(outcome.kind).toBe('unresolved');
      if (outcome.kind === 'unresolved') {
        expect(outcome.reason).toContain(words);
        expect(outcome.reason).toContain('MONEYBIRD_WORKFLOW_ID');
      }
    }
  });

  it('a field Moneybird left out is unknown, not a refusal', () => {
    expect(resolveInvoiceWorkflow('666', WORKFLOWS).kind).toBe('resolved');
  });
});

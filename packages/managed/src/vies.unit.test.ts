// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The VIES client's contract (workplan 0111 T2).
 *
 * The load-bearing assertions here are the DISHONESTY guards, not the happy
 * path: a fault response carrying `valid: false` beside its error code must
 * come back `unavailable` and never `checked` — an outage recorded as
 * "invalid" is a lie about a customer — and nothing but a boolean `valid`
 * may ever produce a verdict. The fetch is injected, so none of this tests
 * Brussels.
 */

import { describe, it, expect } from 'vitest';
import { parseVatForVies, checkVat, VIES_MEMBER_STATES, type ViesOutcome } from './vies.ts';

describe('parseVatForVies — what was typed becomes what VIES can be asked', () => {
  it('strips the country prefix, punctuation and case', () => {
    expect(parseVatForVies('NL', 'nl 1234.56.789-b01')).toEqual({
      ok: true,
      memberState: 'NL',
      number: '123456789B01',
    });
  });

  it('falls back to the billing country when the number carries no prefix', () => {
    expect(parseVatForVies('DE', '123456789')).toEqual({
      ok: true,
      memberState: 'DE',
      number: '123456789',
    });
  });

  it('speaks EL where ISO says GR, on both the prefix and the address path', () => {
    expect(parseVatForVies('GR', '123456789')).toMatchObject({ memberState: 'EL' });
    expect(parseVatForVies('NL', 'GR123456789')).toMatchObject({ memberState: 'EL' });
    expect(parseVatForVies('NL', 'EL123456789')).toMatchObject({ memberState: 'EL' });
  });

  it('the prefix names the issuing state and WINS over the address', () => {
    // A business with a GB address and an XI number is Northern Ireland's
    // whole point: the address alone would refuse, the prefix answers.
    expect(parseVatForVies('GB', 'XI123456789')).toEqual({
      ok: true,
      memberState: 'XI',
      number: '123456789',
    });
  });

  it('refuses what VIES can never answer, with the reason', () => {
    const gb = parseVatForVies('GB', '123456789');
    expect(gb.ok).toBe(false);
    if (!gb.ok) expect(gb.reason).toContain('GB');

    // Two leading letters ARE the prefix, full stop — predictable beats
    // clever, and no EU VAT number begins with two letters once its prefix
    // is off.
    expect(parseVatForVies('NL', 'AB123456')).toMatchObject({ ok: false });
  });

  it('refuses a remainder that is not VAT-number-shaped', () => {
    expect(parseVatForVies('NL', 'NL')).toMatchObject({ ok: false });
    expect(parseVatForVies('NL', '1')).toMatchObject({ ok: false });
    expect(parseVatForVies('NL', 'NL12345 6789#B01')).toMatchObject({ ok: false });
  });

  it('a single leading letter is a number, not half a prefix (ES-style)', () => {
    expect(parseVatForVies('ES', 'A12345674')).toEqual({
      ok: true,
      memberState: 'ES',
      number: 'A12345674',
    });
  });

  it('covers the EU-27 plus XI, and GB is absent on purpose', () => {
    expect(VIES_MEMBER_STATES.size).toBe(28);
    expect(VIES_MEMBER_STATES.has('EL')).toBe(true);
    expect(VIES_MEMBER_STATES.has('GR')).toBe(false);
    expect(VIES_MEMBER_STATES.has('XI')).toBe(true);
    expect(VIES_MEMBER_STATES.has('GB')).toBe(false);
  });
});

/** A fetch that answers what it is told and records what it was asked. */
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const NUMBER = { memberState: 'NL', number: '123456789B01' };

describe('checkVat — three outcomes, never two', () => {
  it('a qualified yes: valid, with the consultation number and the trader VIES named', async () => {
    const { impl, calls } = fakeFetch(() =>
      json({
        valid: true,
        requestDate: '2026-08-29+02:00',
        requestIdentifier: 'WAPIAAAAXYZ1234',
        name: 'ACME BV',
        address: 'Fabrieksweg 2, 5678 CD Elders',
      }),
    );
    const outcome = await checkVat(NUMBER, { memberStateCode: 'NL', vatNumber: '868754289B01' }, impl);

    expect(outcome).toEqual<ViesOutcome>({
      kind: 'checked',
      valid: true,
      requestDate: '2026-08-29+02:00',
      consultationNumber: 'WAPIAAAAXYZ1234',
      traderName: 'ACME BV',
      traderAddress: 'Fabrieksweg 2, 5678 CD Elders',
    });
    // The requester rode along — that is what made the check qualified.
    expect(calls[0]!.body).toMatchObject({
      countryCode: 'NL',
      vatNumber: '123456789B01',
      requesterMemberStateCode: 'NL',
      requesterNumber: '868754289B01',
    });
  });

  it('an unqualified check sends no requester and comes back with no consultation number', async () => {
    const { impl, calls } = fakeFetch(() => json({ valid: true, requestDate: '2026-08-29+02:00' }));
    const outcome = await checkVat(NUMBER, null, impl);

    expect(outcome).toMatchObject({ kind: 'checked', valid: true, consultationNumber: null });
    expect(calls[0]!.body).not.toHaveProperty('requesterMemberStateCode');
    expect(calls[0]!.body).not.toHaveProperty('requesterNumber');
  });

  it('a no is an answer: valid false, with the undisclosed "---" fields as null', async () => {
    const { impl } = fakeFetch(() => json({ valid: false, name: '---', address: '---' }));
    const outcome = await checkVat(NUMBER, null, impl);

    expect(outcome).toMatchObject({
      kind: 'checked',
      valid: false,
      traderName: null,
      traderAddress: null,
    });
  });

  it('NEVER turns an outage into a verdict, even when the fault carries valid:false', async () => {
    // The one assertion this file exists for. A member-state outage response
    // can say `valid: false` beside its error code; recording that as
    // "invalid" would be a lie about a customer, written into evidence.
    const { impl } = fakeFetch(() => json({ valid: false, userError: 'MS_UNAVAILABLE' }));
    const outcome = await checkVat(NUMBER, null, impl);

    expect(outcome.kind).toBe('unavailable');
    if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('MS_UNAVAILABLE');
  });

  it('INVALID_INPUT is not-checkable — retrying cannot change what the question is', async () => {
    const { impl } = fakeFetch(() => json({ userError: 'INVALID_INPUT' }));
    expect((await checkVat(NUMBER, null, impl)).kind).toBe('not_checkable');
  });

  it('an HTTP error, non-JSON, an unknown shape and a thrown fetch are all "unavailable"', async () => {
    const cases: Array<typeof fetch> = [
      fakeFetch(() => json({}, 500)).impl,
      fakeFetch(() => new Response('<html>maintenance</html>', { status: 200 })).impl,
      fakeFetch(() => json({ something: 'else' })).impl,
      (async () => {
        throw new Error('getaddrinfo ENOTFOUND ec.europa.eu');
      }) as unknown as typeof fetch,
    ];
    for (const impl of cases) {
      expect((await checkVat(NUMBER, null, impl)).kind).toBe('unavailable');
    }
  });

  it('a valid flag that is not a boolean is no verdict either', async () => {
    // 'true' the string, from some proxy or future shape change, must not
    // become a stored yes.
    const { impl } = fakeFetch(() => json({ valid: 'true' }));
    expect((await checkVat(NUMBER, null, impl)).kind).toBe('unavailable');
  });
});

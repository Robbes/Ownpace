// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The books' configuration (workplan 0111, slice 1): off, on, or refused by
 * key name.
 *
 * What matters here: the example file's empty keys are off, not half a set;
 * a set with a key missing names it and invoices nothing; an 18-digit id
 * comes out exactly as it went in, where a number would round it to another
 * id; and no refusal carries a value, the token above all.
 */

import { describe, it, expect } from 'vitest';
import {
  MONEYBIRD_OPTIONAL_KEYS,
  MONEYBIRD_REQUIRED_KEYS,
  moneybirdAccessFromEnv,
  moneybirdFromEnv,
} from './moneybird-config.ts';

const TOKEN = 'not-a-real-token-and-never-printed';

/** Moneybird's shape: 18-digit ids, longer than a JavaScript number holds exactly. Made up. */
const FULL = {
  MONEYBIRD_API_TOKEN: TOKEN,
  MONEYBIRD_ADMINISTRATION_ID: '123456789012345678',
  MONEYBIRD_WORKFLOW_ID: '123456789012345601',
  MONEYBIRD_TAX_RATE_ID_DOMESTIC: '123456789012345611',
  MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE: '123456789012345622',
} as const;

function reasonOf(env: Record<string, string | undefined>): string {
  const outcome = moneybirdFromEnv(env);
  expect(outcome.kind).toBe('refused');
  return outcome.kind === 'refused' ? outcome.reason : '';
}

describe('moneybirdFromEnv', () => {
  it('is off with no key set, and with every key empty, as the example ships them', () => {
    expect(moneybirdFromEnv({})).toEqual({ kind: 'off' });
    const empty = Object.fromEntries(
      [...MONEYBIRD_REQUIRED_KEYS, ...MONEYBIRD_OPTIONAL_KEYS].map((key) => [key, key.endsWith('ID') ? '' : '   ']),
    );
    expect(moneybirdFromEnv(empty)).toEqual({ kind: 'off' });
  });

  it('is on with the five, keeping every id exactly as written', () => {
    const outcome = moneybirdFromEnv(FULL);
    expect(outcome).toEqual({
      kind: 'on',
      config: {
        apiToken: TOKEN,
        administrationId: '123456789012345678',
        workflowId: '123456789012345601',
        taxRates: {
          domesticStandard: '123456789012345611',
          reverseCharge: '123456789012345622',
          outsideEu: null,
        },
        delivery: 'manual',
      },
    });
    // The trap is real: through a number, the administration is a different one.
    expect(String(Number(FULL.MONEYBIRD_ADMINISTRATION_ID))).not.toBe(FULL.MONEYBIRD_ADMINISTRATION_ID);
  });

  it('takes the optional two: an outside-EU rate, and email delivery in any case', () => {
    const outcome = moneybirdFromEnv({
      ...FULL,
      MONEYBIRD_TAX_RATE_ID_OUTSIDE_EU: ' 123456789012345633 ',
      MONEYBIRD_DELIVERY: ' Email ',
    });
    expect(outcome.kind).toBe('on');
    if (outcome.kind === 'on') {
      expect(outcome.config.taxRates.outsideEu).toBe('123456789012345633');
      expect(outcome.config.delivery).toBe('email');
    }
  });

  it('refuses half a set by naming each missing key and each set one, never a value', () => {
    for (const missing of MONEYBIRD_REQUIRED_KEYS) {
      const env: Record<string, string> = { ...FULL };
      delete env[missing];
      const reason = reasonOf(env);
      expect(reason).toContain(`${missing} is not set`);
      const setClause = reason.slice(reason.indexOf('while '), reason.indexOf('. Set all'));
      for (const set of MONEYBIRD_REQUIRED_KEYS.filter((key) => key !== missing)) expect(setClause).toContain(set);
      expect(setClause).not.toContain(missing);
      expect(reason).not.toContain(TOKEN);
      expect(reason).not.toContain('123456789012345');
    }
  });

  it('counts an optional key as a set one: the delivery alone is half a set, not off', () => {
    const reason = reasonOf({ MONEYBIRD_DELIVERY: 'manual' });
    for (const key of MONEYBIRD_REQUIRED_KEYS) expect(reason).toContain(key);
    expect(reason).toContain('are not set');
  });

  it('refuses an id that is not digits by its key, without repeating what was written', () => {
    for (const bad of ['5.0018e17', '-123', '123 456', 'abc123', '１２３']) {
      const reason = reasonOf({ ...FULL, MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE: bad });
      expect(reason).toContain('MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE');
      expect(reason).not.toContain(bad);
      expect(reason).not.toContain(TOKEN);
    }
    expect(reasonOf({ ...FULL, MONEYBIRD_TAX_RATE_ID_OUTSIDE_EU: 'later' })).toContain(
      'MONEYBIRD_TAX_RATE_ID_OUTSIDE_EU',
    );
  });

  it('refuses a delivery that is neither manual nor email', () => {
    const reason = reasonOf({ ...FULL, MONEYBIRD_DELIVERY: 'post' });
    expect(reason).toContain('MONEYBIRD_DELIVERY');
    expect(reason).not.toContain('post');
  });
});

describe('moneybirdAccessFromEnv', () => {
  it('reads with the token and a well-formed administration alone, and with nothing less', () => {
    expect(
      moneybirdAccessFromEnv({
        MONEYBIRD_API_TOKEN: TOKEN,
        MONEYBIRD_ADMINISTRATION_ID: ' 123456789012345678 ',
      }),
    ).toEqual({ apiToken: TOKEN, administrationId: '123456789012345678' });
    expect(moneybirdAccessFromEnv({ MONEYBIRD_API_TOKEN: TOKEN })).toBeNull();
    expect(moneybirdAccessFromEnv({ MONEYBIRD_ADMINISTRATION_ID: '123456789012345678' })).toBeNull();
    expect(
      moneybirdAccessFromEnv({ MONEYBIRD_API_TOKEN: TOKEN, MONEYBIRD_ADMINISTRATION_ID: 'my-books' }),
    ).toBeNull();
  });
});

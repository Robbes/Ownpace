// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Where this deployment's books are, read from its environment (workplan 0111
 * T4, slice 1 of §"The build, sliced").
 *
 * The adapter (`moneybird-sales-invoices.ts`) and the resolver
 * (`moneybird-tax-rates.ts`) take their configuration as parameters and read
 * no environment, so a test of them is never a test of a `.env`. This is the
 * one place the keys are read, and it answers one of three things:
 *
 *  - **off**: no `MONEYBIRD_*` key is set. Nothing is invoiced, nothing is
 *    asked of Moneybird, and nothing says otherwise. Every stack starts here.
 *  - **on**: the whole set is there and well formed.
 *  - **refused**: some of it is there. Half a set names what is missing and
 *    never guesses the rest: an invoice pushed with a default where the owner
 *    meant a value would be a legal document nobody chose.
 *
 * ## The keys
 *
 * Required together: the API token, the administration, the invoice workflow
 * every document is sent through, and the two tax rates a buyer can need
 * today (`domestic_standard`, `reverse_charge`). Optional: the outside-EU rate
 * (unset refuses a non-EU buyer by name, as `resolveTaxRateId` already does)
 * and the delivery, `manual` unless `email`. Off the live stack it stays
 * `manual`: a sandbox administration really sends what it is asked to e-mail,
 * ten a month.
 *
 * ## Two rules about the values
 *
 * **An id stays a string of digits.** Moneybird's ids are 18 digits, past
 * what a JavaScript number holds exactly (2^53 is 16 digits), so an id that
 * passed through `Number()` would name a different rate, or a different
 * administration, without any error. Anything but digits is refused by key.
 *
 * **A refusal names keys, never values.** The token is a credential; the ids
 * are not secret, but one sentence shape for all of them is the one that
 * cannot leak the token by a slip in a later edit. The guard is
 * `moneybird-config.unit.test.ts`.
 */

import type { MoneybirdAccess } from './moneybird-http.ts';
import type { TaxRateIdConfig } from './moneybird-tax-rates.ts';

/** The keys that must be set together, in the order a refusal names them. */
export const MONEYBIRD_REQUIRED_KEYS = [
  'MONEYBIRD_API_TOKEN',
  'MONEYBIRD_ADMINISTRATION_ID',
  'MONEYBIRD_WORKFLOW_ID',
  'MONEYBIRD_TAX_RATE_ID_DOMESTIC',
  'MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE',
] as const;

/** The keys that may be set or not, once the required set is. */
export const MONEYBIRD_OPTIONAL_KEYS = ['MONEYBIRD_TAX_RATE_ID_OUTSIDE_EU', 'MONEYBIRD_DELIVERY'] as const;

/** How Moneybird hands a document over: by its own e-mail, or not at all. */
export type MoneybirdDelivery = 'manual' | 'email';

export interface MoneybirdSettings {
  readonly apiToken: string;
  readonly administrationId: string;
  readonly workflowId: string;
  readonly taxRates: TaxRateIdConfig;
  readonly delivery: MoneybirdDelivery;
}

export type MoneybirdSettingsOutcome =
  | { readonly kind: 'off' }
  | { readonly kind: 'on'; readonly config: MoneybirdSettings }
  | { readonly kind: 'refused'; readonly reason: string };

type Env = Readonly<Record<string, string | undefined>>;

/** Moneybird's ids: digits only, kept as text (see the header). */
const ID = /^[0-9]{1,30}$/;

const ID_KEYS = [
  'MONEYBIRD_ADMINISTRATION_ID',
  'MONEYBIRD_WORKFLOW_ID',
  'MONEYBIRD_TAX_RATE_ID_DOMESTIC',
  'MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE',
  'MONEYBIRD_TAX_RATE_ID_OUTSIDE_EU',
] as const;

/** A value as set: trimmed, and empty counts as unset (the example's `KEY=`). */
function valueOf(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/** Reads the `MONEYBIRD_*` keys: off, on, or refused with the keys named. */
export function moneybirdFromEnv(env: Env): MoneybirdSettingsOutcome {
  const all = [...MONEYBIRD_REQUIRED_KEYS, ...MONEYBIRD_OPTIONAL_KEYS];
  const set = all.filter((key) => valueOf(env, key) !== undefined);
  if (set.length === 0) return { kind: 'off' };

  const missing = MONEYBIRD_REQUIRED_KEYS.filter((key) => valueOf(env, key) === undefined);
  if (missing.length > 0) {
    return {
      kind: 'refused',
      reason:
        `Moneybird is half configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set, ` +
        `while ${set.join(', ')} ${set.length === 1 ? 'is' : 'are'}. Set all of ` +
        `${MONEYBIRD_REQUIRED_KEYS.join(', ')}, or none of them; nothing is invoiced on half a set.`,
    };
  }

  const malformed = ID_KEYS.filter((key) => {
    const value = valueOf(env, key);
    return value !== undefined && !ID.test(value);
  });
  if (malformed.length > 0) {
    return {
      kind: 'refused',
      reason:
        `${malformed.join(', ')} must be Moneybird's id as it appears in the API, digits only ` +
        '(the long number in the URL, or the "id" field of the JSON), kept exactly as written.',
    };
  }

  const delivery = valueOf(env, 'MONEYBIRD_DELIVERY')?.toLowerCase() ?? 'manual';
  if (delivery !== 'manual' && delivery !== 'email') {
    return {
      kind: 'refused',
      reason: 'MONEYBIRD_DELIVERY must be manual or email, or be left empty for manual.',
    };
  }

  return {
    kind: 'on',
    config: {
      apiToken: valueOf(env, 'MONEYBIRD_API_TOKEN')!,
      administrationId: valueOf(env, 'MONEYBIRD_ADMINISTRATION_ID')!,
      workflowId: valueOf(env, 'MONEYBIRD_WORKFLOW_ID')!,
      taxRates: {
        domesticStandard: valueOf(env, 'MONEYBIRD_TAX_RATE_ID_DOMESTIC')!,
        reverseCharge: valueOf(env, 'MONEYBIRD_TAX_RATE_ID_REVERSE_CHARGE')!,
        outsideEu: valueOf(env, 'MONEYBIRD_TAX_RATE_ID_OUTSIDE_EU') ?? null,
      },
      delivery,
    },
  };
}

/**
 * Enough to read the administration, from a set that may be incomplete: the
 * token and a well-formed administration id, or null. For the check, which
 * lists the rates and workflows to pick from while the rest is still unset.
 * Never a reason to invoice: that takes `moneybirdFromEnv`'s `on`.
 */
export function moneybirdAccessFromEnv(env: Env): MoneybirdAccess | null {
  const apiToken = valueOf(env, 'MONEYBIRD_API_TOKEN');
  const administrationId = valueOf(env, 'MONEYBIRD_ADMINISTRATION_ID');
  if (apiToken === undefined || administrationId === undefined || !ID.test(administrationId)) return null;
  return { apiToken, administrationId };
}

// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Asking VIES whether a VAT number is real (workplan 0111 T2).
 *
 * VIES is the European Commission's VAT Information Exchange System — the one
 * place a seller can verify a buyer's VAT number before reverse-charging, and
 * the issuer of the CONSULTATION NUMBER that makes the verification a defence
 * rather than a claim. This module is the whole conversation with it; storage
 * is `vat_consultation` (migration 0013) and belongs to the caller.
 *
 * ## Three outcomes, never two
 *
 * The design rule this file exists to hold: **"we could not ask" is not an
 * answer.** VIES's member-state backends are famously intermittent
 * (MS_UNAVAILABLE and its cousins are documented, expected states), and a
 * client that collapses an outage into `valid: false` records a lie about a
 * customer. So the outcome is a three-way union — `checked` (VIES answered,
 * either way), `unavailable` (ask again later), `not_checkable` (VIES can
 * NEVER answer this one — a GB number, a malformed one) — and the failure
 * codes are tested BEFORE the `valid` flag, because a fault response may
 * carry `valid: false` beside its error code and the error is the truth.
 *
 * ## VIES speaks its own geography
 *
 * Greece is EL, not GR. Northern Ireland is XI and exists; GB does not — a
 * British VAT number simply cannot be consulted here (HMRC runs its own
 * service; wiring it is not T2). `parseVatForVies` owns that translation and
 * derives the member state from the NUMBER'S OWN PREFIX first, the billing
 * address second: the prefix names the issuing state, and a customer whose
 * address and registration differ is exactly when the difference matters.
 *
 * ## Qualified beats unqualified, and the row says which
 *
 * VIES issues a consultation number only when the requester identifies
 * itself with its own VAT number. Pass `requester` for that; omit it and the
 * check still answers but proves less — the caller stores
 * `consultationNumber: null` and the surface says so. The requester identity
 * is an instance fact (the operating entity is still an accountant
 * conversation), so it arrives as a parameter, never from this file.
 *
 * The HTTP seam (`fetchImpl`) is injectable because every test of this
 * module would otherwise be a test of Brussels.
 */

/** The member states VIES answers for, as VIES spells them (EL, XI). */
export const VIES_MEMBER_STATES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR',
  'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SE', 'SI', 'SK', 'XI',
]);

export interface ViesRequester {
  /** The deployment's own member state, as VIES spells it. */
  readonly memberStateCode: string;
  /** The deployment's own VAT number, without the country prefix. */
  readonly vatNumber: string;
}

export type ParsedVat =
  | { readonly ok: true; readonly memberState: string; readonly number: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Turn what a customer typed into what VIES can be asked.
 *
 * Spaces, dots and dashes go (every national convention writes them; no
 * register stores them), case goes to upper, and then: a two-letter start IS
 * the country prefix, full stop — predictable beats clever, and no EU VAT
 * number begins with two letters once its prefix is off. GR normalises to EL
 * on both paths, so a Greek customer is not refused over ISO trivia.
 */
export function parseVatForVies(addressCountryCode: string, vatNumber: string): ParsedVat {
  const compact = vatNumber.replace(/[\s.-]/g, '').toUpperCase();
  const address = addressCountryCode.trim().toUpperCase() === 'GR'
    ? 'EL'
    : addressCountryCode.trim().toUpperCase();

  let memberState = address;
  let number = compact;
  if (/^[A-Z]{2}/.test(compact)) {
    const prefix = compact.slice(0, 2);
    memberState = prefix === 'GR' ? 'EL' : prefix;
    number = compact.slice(2);
  }

  if (!VIES_MEMBER_STATES.has(memberState)) {
    return {
      ok: false,
      reason:
        `VIES answers for EU member states (and XI for Northern Ireland); ` +
        `${memberState} is not one, so this number cannot be checked there.`,
    };
  }
  if (!/^[0-9A-Z+*]{2,20}$/.test(number)) {
    return {
      ok: false,
      reason:
        'After the country prefix, a VAT number is 2–20 letters and digits — ' +
        'this is not one, so VIES cannot be asked about it.',
    };
  }
  return { ok: true, memberState, number };
}

export type ViesOutcome =
  | {
      readonly kind: 'checked';
      readonly valid: boolean;
      /** VIES's own stamp, verbatim; null when the answer carried none. */
      readonly requestDate: string | null;
      /** The defence. Null = the check was unqualified (no requester given). */
      readonly consultationNumber: string | null;
      readonly traderName: string | null;
      readonly traderAddress: string | null;
    }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'not_checkable'; readonly reason: string };

/**
 * The REST endpoint, and the SOAP one deliberately not: same data, and this
 * one speaks JSON without a client library.
 */
const VIES_ENDPOINT =
  'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

/**
 * VIES's own failure vocabulary. Everything here means "no verdict was
 * reached" — mapped to `unavailable` (try later) except INVALID_INPUT, which
 * means the question itself cannot be asked and retrying will not change
 * that.
 */
const VIES_FAILURE_CODES = new Set([
  'MS_UNAVAILABLE',
  'MS_MAX_CONCURRENT_REQ',
  'GLOBAL_MAX_CONCURRENT_REQ',
  'SERVICE_UNAVAILABLE',
  'TIMEOUT',
  'IP_BLOCKED',
  'VAT_BLOCKED',
  'INVALID_INPUT',
  'INVALID_REQUESTER_INFO',
]);

/** `'---'` is VIES for "this member state does not disclose that". */
function disclosed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === '---' ? null : trimmed;
}

/**
 * Ask VIES. Never throws for anything VIES-shaped: outages, garbage and
 * unknown shapes all come back as `unavailable` with the reason, because the
 * caller's contract is the three-way union, not an exception to forget.
 */
export async function checkVat(
  check: { readonly memberState: string; readonly number: string },
  requester: ViesRequester | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<ViesOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(VIES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        countryCode: check.memberState,
        vatNumber: check.number,
        ...(requester
          ? {
              requesterMemberStateCode: requester.memberStateCode,
              requesterNumber: requester.vatNumber,
            }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: `VIES could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    return { kind: 'unavailable', reason: `VIES answered HTTP ${response.status}.` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'unavailable', reason: 'VIES answered something that is not JSON.' };
  }
  if (typeof body !== 'object' || body === null) {
    return { kind: 'unavailable', reason: 'VIES answered a shape this client does not recognise.' };
  }
  const answer = body as Record<string, unknown>;

  // The failure codes FIRST, whatever else the body carries: a fault response
  // may say `valid: false` beside its error code, and recording that as
  // "invalid" would turn an outage into a verdict about a customer.
  const userError = typeof answer.userError === 'string' ? answer.userError.toUpperCase() : null;
  if (userError && VIES_FAILURE_CODES.has(userError)) {
    if (userError === 'INVALID_INPUT') {
      return {
        kind: 'not_checkable',
        reason: 'VIES refused the number as malformed (INVALID_INPUT) — retrying cannot change that.',
      };
    }
    return { kind: 'unavailable', reason: `VIES reported ${userError} — ask again later.` };
  }

  if (typeof answer.valid !== 'boolean') {
    return { kind: 'unavailable', reason: 'VIES answered a shape this client does not recognise.' };
  }

  return {
    kind: 'checked',
    valid: answer.valid,
    requestDate: typeof answer.requestDate === 'string' ? answer.requestDate : null,
    consultationNumber: disclosed(answer.requestIdentifier),
    traderName: disclosed(answer.name) ?? disclosed(answer.traderName),
    traderAddress: disclosed(answer.address) ?? disclosed(answer.traderAddress),
  };
}

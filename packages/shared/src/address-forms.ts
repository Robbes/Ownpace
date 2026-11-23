// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FORMS AN ADDRESS TAKES, AND THE ADDRESSES NOBODY CAN TAKE ALONG
 * (workplan 0168 §2.5, §6.1, T1; ADR-0055).
 *
 * ## The key
 *
 * `addressKey` is the form two spellings of one address share. It is the
 * address in lower case, trimmed. For Gmail only, dots and a `+suffix` in the
 * local part are dropped and `googlemail.com` is read as `gmail.com`, because
 * Google treats those as one account. On any other domain those characters
 * matter (two Workspace users can be `a.b@` and `ab@`), so nothing else is
 * folded. Microsoft's consumer plus-addressing is not folded either: it has
 * not been measured (0168 §2.5).
 *
 * This is the rule `googleAccountKey` applied in
 * `apps/api/src/routes/migrations/signed-in-account.ts` (workplan 0108 T8),
 * moved here so that the address table (0168 T2) and the change itself
 * (`address-changes.ts`, T3) match on the same key the sign-in binds with.
 *
 * ## The list
 *
 * `NOT_TAKEN_ALONG` is the domains whose addresses belong to the provider
 * being left (0168 §1.1). Each entry is taken from a source that can be cited,
 * named beside it with the date it was read. A domain is never added from
 * memory. The list only proposes a row in the table (0168 §6.1): a person can
 * still say no, or declare an address the list missed.
 */

/** Gmail's two spellings of one domain. */
const GMAIL = 'gmail.com';
const GOOGLEMAIL = 'googlemail.com';

/**
 * What no address holds: white space, a control character (NUL among them,
 * which Postgres refuses to store, 22021) and half of a surrogate pair, which
 * no encoding of an address can carry. A value with one is not an address, so
 * it is refused as one before anything stores it (0168's review, finding 3).
 */
const NOT_IN_AN_ADDRESS = /[\s\p{Cc}\p{Cs}]/u;

/** The local part and domain of an address, lower case, or null when it is not one. */
function partsOf(address: string): { readonly name: string; readonly domain: string } | null {
  const parts = address.trim().toLowerCase().split('@');
  if (parts.length !== 2) return null;
  const [name, domain] = parts as [string, string];
  if (name === '' || domain === '' || NOT_IN_AN_ADDRESS.test(name + domain)) return null;
  return { name, domain };
}

/** The Gmail fold of a local part and domain, or the two as they are elsewhere. */
function folded(name: string, domain: string): { readonly name: string; readonly domain: string } {
  const d = domain === GOOGLEMAIL ? GMAIL : domain;
  if (d !== GMAIL) return { name, domain: d };
  return { name: name.split('+')[0]!.replace(/\./g, ''), domain: d };
}

/**
 * Is this value an address the key can be taken of? One `@`, a local part and
 * a domain, no white space or control character, and for Gmail a local part
 * that is not empty once folded (`+x@gmail.com` names nobody).
 */
export function isAddress(address: string): boolean {
  const p = partsOf(address);
  return p !== null && folded(p.name, p.domain).name !== '';
}

/**
 * The matching key of an address (0168 §2.5): lower case and trimmed, and for
 * Gmail only, dots and a `+suffix` dropped and `googlemail.com` read as
 * `gmail.com`.
 *
 * A value that is not an address (`isAddress` false) gets its trimmed lower
 * case and no fold, so it can never share a key with an address it is not.
 */
export function addressKey(address: string): string {
  const p = partsOf(address);
  if (p === null) return address.trim().toLowerCase();
  const f = folded(p.name, p.domain);
  if (f.name === '') return address.trim().toLowerCase();
  return `${f.name}@${f.domain}`;
}

/** One domain whose addresses stay with its provider. */
export interface NotTakenAlong {
  /** The domain, lower case, as it follows the `@`. */
  readonly domain: string;
  /** The provider the domain belongs to, as a person would name it. */
  readonly provider: string;
}

/**
 * The domains whose addresses cannot be taken along (0168 §1.1, D10).
 *
 * Every entry names its source and the date it was read. Domains whose
 * sources could not be read when this list was built are not here; the
 * workplan's Status block names them.
 */
export const NOT_TAKEN_ALONG: ReadonlyArray<NotTakenAlong> = Object.freeze([
  // Google for Developers, "Manage offline conversions" (Google Ads API),
  // https://developers.google.com/google-ads/api/docs/conversions/upload-offline,
  // read 2026-11-22: "Apply domain-specific normalization (`gmail.com` and
  // `googlemail.com` only)". And "Format user data" (Data Manager API),
  // https://developers.google.com/data-manager/api/devguides/concepts/formatting,
  // read 2026-11-22: "If the email address has the `gmail.com` or
  // `googlemail.com` domain: Remove all dots".
  { domain: GMAIL, provider: 'Google' },
  { domain: GOOGLEMAIL, provider: 'Google' },
]);

const BY_DOMAIN: ReadonlyMap<string, NotTakenAlong> = new Map(NOT_TAKEN_ALONG.map((e) => [e.domain, e]));

/**
 * Whether an address belongs to a provider that keeps it, and which one, or
 * null when it does not or is not an address. Only the domain is read.
 */
export function cannotTakeAlong(address: string): { readonly provider: string } | null {
  const p = partsOf(address);
  if (p === null) return null;
  const entry = BY_DOMAIN.get(p.domain);
  return entry ? { provider: entry.provider } : null;
}

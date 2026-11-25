// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ADDRESSES THAT RECEIVE MAIL, as Finish lists them (workplan 0171 §7.2,
 * T10).
 *
 * Once MX points at the new provider, mail to an address that does not exist
 * there bounces. So Finish's step 4 lists the addresses the old provider
 * delivers into this mailbox, read from it, for the person to make at the new
 * provider first. This file is the pure half: which mailbox is on a domain
 * the person controls, and what Graph's and Gmail's answers name. The reads
 * themselves are in `packages/connectors/src/receiving-addresses.ts`.
 *
 * Addresses on the old provider's own domains (`onmicrosoft.com`,
 * `gmail.com`) are left out: they do not move with MX. `cannotTakeAlong` is
 * the one place that knows which those are (0168), so it decides here too.
 */

import { cannotTakeAlong, domainOf, isAddress } from './address-forms.ts';

/**
 * The mailbox's domain when it is one the person controls, or null: an
 * address the old provider keeps (`cannotTakeAlong`), or not an address.
 * Only then is there an MX record of the person's to move.
 */
export function ownDomainOf(address: string | undefined | null): string | null {
  const a = address?.trim().toLowerCase() ?? '';
  if (cannotTakeAlong(a) !== null) return null;
  return domainOf(a);
}

/** Lower-cased, de-duplicated, sorted, and without the old provider's own domains. */
export function movableAddresses(addresses: Iterable<string>): string[] {
  const kept = new Set<string>();
  for (const raw of addresses) {
    const a = raw.trim().toLowerCase();
    if (isAddress(a) && cannotTakeAlong(a) === null) kept.add(a);
  }
  return [...kept].sort();
}

/** An answer a reader could not parse: thrown, never read as no addresses (rule 9). */
export class UnreadableAddressAnswer extends Error {
  constructor(what: string) {
    super(`The answer about the mailbox's addresses could not be read: ${what}`);
    this.name = 'UnreadableAddressAnswer';
  }
}

/**
 * The addresses in a Graph user: `mail`, and every `smtp:` or `SMTP:` entry of
 * `proxyAddresses` (the capital one is the primary). Other proxy types (`x500:`,
 * `sip:`) are not addresses mail is delivered to and are left out, as is the
 * `userPrincipalName`, which is a sign-in name and need not receive anything.
 */
export function addressesFromGraphUser(answer: unknown): string[] {
  if (typeof answer !== 'object' || answer === null) throw new UnreadableAddressAnswer('Graph sent no user');
  const user = answer as { mail?: unknown; proxyAddresses?: unknown };
  if (user.proxyAddresses !== undefined && !Array.isArray(user.proxyAddresses)) {
    throw new UnreadableAddressAnswer('Graph sent proxyAddresses that are not a list');
  }
  const found: string[] = [];
  if (typeof user.mail === 'string') found.push(user.mail);
  for (const p of (user.proxyAddresses ?? []) as unknown[]) {
    if (typeof p === 'string' && /^smtp:/i.test(p)) found.push(p.slice(5));
  }
  return movableAddresses(found);
}

/** The addresses in Gmail's `users.settings.sendAs.list`: each `sendAsEmail`. */
export function addressesFromGmailSendAs(answer: unknown): string[] {
  if (typeof answer !== 'object' || answer === null) throw new UnreadableAddressAnswer('Gmail sent nothing');
  const list = (answer as { sendAs?: unknown }).sendAs;
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new UnreadableAddressAnswer('Gmail sent sendAs that is not a list');
  return movableAddresses(
    list
      .map((e: unknown) => (typeof e === 'object' && e !== null ? (e as { sendAsEmail?: unknown }).sendAsEmail : undefined))
      .filter((e): e is string => typeof e === 'string'),
  );
}

/** Which old provider was asked, in the words the screen says. */
export type AddressProvider = 'Microsoft' | 'Google';

/** What Finish is told about the addresses, read live and never stored (§8). */
export type ReceivingAddresses =
  | { readonly state: 'read'; readonly provider: AddressProvider; readonly addresses: readonly string[] }
  /**
   * Asked and not answered for a reason the person can act on: `reconnect`,
   * a Microsoft connection consented before alpha.20 without `User.Read`
   * (D7), or a grant without the scope; `api_off`, the Gmail API not enabled
   * on the deployment's Google project (§12 question 3).
   */
  | { readonly state: 'not_read'; readonly provider: AddressProvider; readonly why: 'reconnect' | 'api_off' }
  /** A source with nothing to ask: IMAP, Apple, any other. Added by hand. */
  | { readonly state: 'not_readable' }
  /** Asked, and it failed for a reason nobody here can name: said in its words. */
  | { readonly state: 'failed'; readonly provider: AddressProvider; readonly reason: string };

/** The answer of `GET …/finish/addresses`. */
export interface FinishAddresses {
  /** The mailbox's own address, or null when the migration records none. */
  readonly address: string | null;
  /** Its domain when the person controls it (`ownDomainOf`), else null. */
  readonly ownDomain: string | null;
  /** Read only when `ownDomain` is set: otherwise nothing moves with MX. */
  readonly receiving: ReceivingAddresses | null;
}

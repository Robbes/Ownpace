// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * IS THIS SERVER THE ADDRESS'S OWN MAIL? (workplan 0174 §5.8, the owner's D3
 * of 2026-11-25, T3.)
 *
 * A password link sends the person's password to the server the owner named.
 * The page shows that server with its registrable domain in bold; D3's
 * addition compares, for a generic kind whose account is an email address,
 * the server's registrable domain with the address's own domain and with the
 * registrable domains of that domain's MX hosts. When a host matches none,
 * the page (T4) adds a warning beside it. **A warning, never a refusal**: a
 * provider may serve IMAP or DAV from a domain its MX hosts do not name.
 *
 * The MX hosts are read through the same public DNS-over-HTTPS resolvers
 * Finish's MX check asks (`verifyMX`, 0171 T10), once per domain, held for a
 * while, and within a short deadline. **A lookup that fails says nothing
 * either way**: no comparison is answered, and the page shows only the bold
 * domain.
 *
 * The registrable domain is read without the public-suffix list, which this
 * repository does not carry: the last two labels, or three under a
 * second-level suffix the list below names (`co.uk`). Good enough to set a
 * name in bold and to compare one server with one address; a suffix missing
 * here makes a comparison stricter (more warnings), never quieter.
 */

import { verifyMX } from '@openmig/core';
import { mxHostOf } from '@openmig/shared';
import { isIP } from 'node:net';
import type { GrantServer } from './grant-providers.ts';

/** Second-level public suffixes under which a name is registered one label deeper. */
const SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz', 'co.za', 'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.tr', 'com.mx', 'co.in', 'co.il', 'com.cn', 'com.hk', 'com.sg',
]);

/** A host's registrable domain, lower-cased; an IP literal or a single label is itself. */
export function registrableDomain(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (isIP(h) !== 0) return h;
  const labels = h.split('.').filter((l) => l !== '');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return SECOND_LEVEL.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/** The domain of an email address, or null when the account is not one. */
export function addressDomain(account: string): string | null {
  const at = account.trim().lastIndexOf('@');
  if (at <= 0) return null;
  const domain = account.trim().slice(at + 1).toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/** The MX hosts of a domain, or null when no resolver could say. */
export type MxReader = (domain: string) => Promise<ReadonlyArray<string> | null>;

/** How long one domain's MX answer is held, and how long a lookup may take. */
const HELD_MS = 10 * 60 * 1000;
const FAILURE_HELD_MS = 60 * 1000;
const DEADLINE_MS = 3_000;

const held = new Map<string, { readonly at: number; readonly hosts: ReadonlyArray<string> | null }>();

/** `verifyMX`'s hosts, from every resolver that answered; null when none did. */
async function askResolvers(domain: string): Promise<ReadonlyArray<string> | null> {
  const result = await verifyMX(domain);
  const answered = Object.values(result.resolverResults).filter((r) => r.success && r.records.length > 0);
  if (answered.length === 0) return null;
  return [...new Set(answered.flatMap((r) => r.records.map(mxHostOf)).filter((h) => h !== ''))];
}

/** The public resolvers' MX hosts for a domain, held per domain, within a deadline. */
export const readMxHosts: MxReader = async (domain) => {
  const now = Date.now();
  const kept = held.get(domain);
  if (kept && now - kept.at < (kept.hosts === null ? FAILURE_HELD_MS : HELD_MS)) return kept.hosts;
  let timer: NodeJS.Timeout | undefined;
  const hosts = await Promise.race([
    askResolvers(domain).catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), DEADLINE_MS);
    }),
  ]);
  clearTimeout(timer);
  if (held.size > 5_000) held.clear();
  held.set(domain, { at: now, hosts });
  return hosts;
};

/**
 * The server as the page shows it (§5.8, D3): each host's registrable domain,
 * and, for a server the owner named and an account that is an address, the
 * hosts that are neither on the address's domain nor its mail's. A published
 * server (Apple's) is the provider's own and is not compared. The MX hosts
 * are read only when a host is not on the address's own domain.
 */
export async function serverAgainstAddress(
  account: string,
  server: GrantServer,
  readMx: MxReader = readMxHosts,
): Promise<GrantServer> {
  const domains = server.hosts.map(registrableDomain);
  if (server.published) return { ...server, domains };
  const own = addressDomain(account);
  if (own === null) return { ...server, domains };
  const ownRegistrable = registrableDomain(own);
  const offTheAddress = server.hosts.filter((_, i) => domains[i] !== ownRegistrable);
  if (offTheAddress.length === 0) return { ...server, domains, notTheAddressMail: [] };
  const mx = await readMx(own);
  // A lookup that fails says nothing either way.
  if (mx === null) return { ...server, domains };
  const mail = new Set(mx.map(registrableDomain));
  return { ...server, domains, notTheAddressMail: offTheAddress.filter((h) => !mail.has(registrableDomain(h))) };
}

/** Whether a host is an IP literal, which a password is never sent to (§5.8, D3 (a)). */
export function isAddressLiteral(host: string): boolean {
  return isIP(host.trim().replace(/^\[|\]$/g, '')) !== 0;
}

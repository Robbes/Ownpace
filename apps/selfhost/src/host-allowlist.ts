// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE NAMES THIS APPLIANCE ANSWERS TO (DNS rebinding; the owner, 2026-09-24:
 * "add a Host allowlist").
 *
 * The appliance has no login: the address it listens on is the boundary
 * (`SELFHOST_BIND`). `cross-site.ts` refuses a write a browser marks as sent
 * from another site. What that cannot stop is a page that makes itself this
 * appliance's own site. A page on a name its author controls points that name
 * at this machine (a DNS answer is the author's to give, and a short-lived one
 * can change between two requests), and from then on the browser treats the
 * appliance as the page's own origin: it may read what the appliance answers,
 * the audit download and the log included, and its writes carry no cross-site
 * mark.
 *
 * Every such request carries the page's own name in its `Host` header, because
 * that is the name the browser asked for. So the appliance answers only to:
 *
 * - an **IP address**, which no page can point anywhere;
 * - **localhost**;
 * - the names listed in **`SELFHOST_ALLOWED_HOSTS`** (comma-separated, ports
 *   ignored), for an owner who reaches it by a name on their network or
 *   through their own reverse proxy. `*` answers to any name, which is the old
 *   behaviour, chosen out loud.
 *
 * Anything else is refused before any route runs, reads included, with a
 * sentence naming the setting. A request with no `Host` at all is answered: no
 * browser sends one, so no page can.
 */

import { isIP } from 'node:net';

/** What `SELFHOST_ALLOWED_HOSTS` says, read once at start-up. */
export interface HostAllowlist {
  /** `*`: any name, the old behaviour, chosen out loud. */
  readonly any: boolean;
  readonly names: ReadonlySet<string>;
}

/**
 * The host a `Host` header names: lower-case, without its port or a trailing
 * dot, and an IPv6 address without its brackets.
 */
export function hostOf(header: string): string {
  const h = header.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(1, end) : h;
  }
  // One colon is a port; more than one is an IPv6 address someone forgot to
  // bracket, which is still an address.
  const colon = h.indexOf(':');
  const name = colon >= 0 && colon === h.lastIndexOf(':') ? h.slice(0, colon) : h;
  return name.endsWith('.') ? name.slice(0, -1) : name;
}

/** `SELFHOST_ALLOWED_HOSTS`: names separated by commas or spaces. */
export function hostAllowlistFrom(value: string | undefined): HostAllowlist {
  const entries = (value ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => (entry === '*' ? '*' : hostOf(entry)))
    .filter(Boolean);
  return { any: entries.includes('*'), names: new Set(entries.filter((e) => e !== '*')) };
}

/** Does this appliance answer a request that names this host? */
export function answersTo(hostHeader: string | undefined, allow: HostAllowlist): boolean {
  if (hostHeader === undefined || hostHeader.trim() === '') return true;
  if (allow.any) return true;
  const host = hostOf(hostHeader);
  if (isIP(host) !== 0 || host === 'localhost') return true;
  return allow.names.has(host);
}

/**
 * A name as a log line or an answer may repeat it: the request chose it, so it
 * is cut short and kept to the characters a name has.
 */
export function namedHost(hostHeader: string): string {
  return hostOf(hostHeader).replace(/[^a-z0-9.\-:[\]_]/g, '?').slice(0, 80);
}

/** What the appliance answers to, for its start-up line. */
export function describeAllowlist(allow: HostAllowlist): string {
  if (allow.any) return 'any name (SELFHOST_ALLOWED_HOSTS=*)';
  const names = [...allow.names].sort();
  return names.length === 0
    ? 'its IP addresses and localhost only (set SELFHOST_ALLOWED_HOSTS to reach it by a name)'
    : `its IP addresses, localhost and ${names.join(', ')}`;
}

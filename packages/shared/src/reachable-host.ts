// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A HOST WE ARE ASKED TO REACH (workplan 0136 T1).
 *
 * The managed edition connects to whatever host a tester types, from inside
 * the stack's own network: a DAV or JMAP address, an IMAP server, a Nextcloud.
 * Typed as `127.0.0.1`, `postgres` or `169.254.169.254`, that is the service's
 * own database, a neighbour's published port or a cloud machine's metadata,
 * and the probe says what came back. So on managed, a host is refused when it
 * RESOLVES to an address inside a network, and the check sits where the
 * connection is made:
 *
 * - **After resolution, on the address actually used.** A check on the typed
 *   name alone is defeated by a name that resolves inward, or that answers
 *   differently the second time (DNS rebinding). Every address the lookup
 *   returns is checked, and the socket is opened to the address that was
 *   checked, with no second lookup. TLS still verifies the certificate against
 *   the typed name.
 * - **On every connection.** A redirect, a CalDAV server's absolute href on
 *   another host, a keep-alive pool opening a second socket: each goes through
 *   the same connector, so none of them opens a path the typed host did not.
 *
 * MANAGED ONLY. The appliance's owner types their own LAN's Nextcloud and is
 * its only user, so the rule is off until a managed process switches it on
 * with `refuseInternalAddresses`. Until then `tenantFetch` is the global
 * `fetch`, unchanged, and `reachableHost` hands a host back as typed.
 *
 * NOT A GLOBAL DISPATCHER. The same processes also call their own services by
 * compose name (Trigger.dev, the identity provider, the status page), and those
 * must keep working. So the rule rides only the requests that go to a host a
 * tenant gave us: the clients that do are the callers of `tenantFetch`.
 *
 * NOT IN THE PACKAGE'S INDEX. The browser bundle loads `@openmig/shared` from
 * its index, and this module builds a `BlockList` and loads undici as it is
 * imported, neither of which a browser has. Node code imports it by its own
 * path, `@openmig/shared/reachable-host`.
 */

import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { Agent as UndiciAgent, buildConnector as UndiciBuildConnector } from 'undici';
// UNDICI'S AGENT AND CONNECTOR BY THEIR OWN PATHS, not its index. Importing
// `undici` installs its own Agent as the process's global dispatcher when none
// is set yet, and Node's built-in `fetch` reads that same global: every other
// request in the process, in both editions, would then go through a different
// client than the one it was written against. These two modules carry no such
// side effect. Static imports, so the task bundle (esbuild, through the
// Trigger.dev CLI) carries them; a `require` built at run time it cannot see.
// Their types are in `undici-internals.d.ts`, beside this file, which the
// root TypeScript program includes; undici ships none for these paths.
import Agent from 'undici/lib/dispatcher/agent.js';
import buildConnector from 'undici/lib/core/connect.js';

/**
 * Every range a host we are asked to reach may not resolve into.
 *
 * The Docker networks of both stacks, and their gateways, are not listed on
 * their own: with Docker's built-in address pools they lie inside the private
 * ranges below, which is one more reason those may never be narrowed. The
 * bring-up checks the daemon's networks against this list (0136 T1 (b)).
 */
export const REFUSED_RANGES: ReadonlyArray<{ readonly cidr: string; readonly what: string }> = [
  { cidr: '0.0.0.0/8', what: '"this network", which on Linux reaches the local host' },
  { cidr: '10.0.0.0/8', what: 'private' },
  { cidr: '100.64.0.0/10', what: 'shared address space (CGNAT), where mesh VPNs live' },
  { cidr: '127.0.0.0/8', what: 'loopback' },
  { cidr: '169.254.0.0/16', what: "link-local, where a cloud machine's metadata service answers" },
  { cidr: '172.16.0.0/12', what: 'private' },
  { cidr: '192.168.0.0/16', what: 'private' },
  { cidr: '224.0.0.0/4', what: 'multicast' },
  { cidr: '240.0.0.0/4', what: 'reserved, and the broadcast address' },
  { cidr: '::/128', what: 'unspecified, which reaches the local host' },
  { cidr: '::1/128', what: 'loopback' },
  { cidr: 'fc00::/7', what: 'unique-local' },
  { cidr: 'fe80::/10', what: 'link-local' },
  { cidr: 'ff00::/8', what: 'multicast' },
];

const refused = new BlockList();
for (const { cidr } of REFUSED_RANGES) {
  const [network = '', prefix = ''] = cidr.split('/');
  refused.addSubnet(network, Number(prefix), isIP(network) === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Is this address one we never connect to on a tenant's behalf?
 *
 * An IPv4-mapped IPv6 address (`::ffff:127.0.0.1`) is judged as the IPv4
 * address inside it, which `BlockList` does on its own. Anything that is not
 * an address at all is refused: there is nothing to connect to.
 */
export function isRefusedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return refused.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Each refused range on its own, to ask which one a network lies in. */
const eachRange = REFUSED_RANGES.map(({ cidr }) => {
  const [network = '', prefix = ''] = cidr.split('/');
  const family = isIP(network) === 6 ? 'ipv6' : 'ipv4';
  const list = new BlockList();
  list.addSubnet(network, Number(prefix), family);
  return { family, prefix: Number(prefix), list };
});

/**
 * Does a whole network lie inside the ranges the rule refuses?
 *
 * The bring-up asks this of every Docker network on the machine (0136 T1 (b)).
 * The rule holds no range of its own for the Docker networks: on a daemon with
 * Docker's built-in pools they lie inside the private ranges. A daemon can be
 * set to hand out others, and a network outside the ranges is one whose
 * containers a tenant's host could resolve to and be connected to.
 *
 * A network `n/p` lies inside a range `r/q` when `q <= p` and `n` is in the
 * range: every address that shares `n`'s first `p` bits shares its first `q`.
 * Anything that is not a network in CIDR form is answered `false`, so a value
 * the bring-up cannot read is reported rather than passed.
 */
export function networkInsideRefusedRanges(cidr: string): boolean {
  const match = /^([^/]+)\/(\d{1,3})$/.exec(cidr.trim());
  if (!match) return false;
  const network = match[1] ?? '';
  const prefix = Number(match[2]);
  const version = isIP(network);
  if (version === 0 || prefix > (version === 4 ? 32 : 128)) return false;
  const family = version === 4 ? 'ipv4' : 'ipv6';
  return eachRange.some((range) => range.family === family && range.prefix <= prefix && range.list.check(network, family));
}

/** `[::1]` as `new URL()` spells an IPv6 host, without its brackets. */
function unbracket(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * Why a host is refused on its shape alone, before any lookup, or `undefined`
 * when its shape is fine.
 *
 * - **Not a DNS name or an address.** A path, a user part, a port inside the
 *   host field: the field was meant to name a host, and this does not.
 * - **A single label** (`postgres`, `localhost`, `trigger-docker-proxy`).
 *   Compose names resolve through Docker's own DNS to private addresses
 *   anyway, and the refusal is clearer said by name.
 */
export function refusedHostShape(host: string): 'not a host name' | 'a single-label name' | undefined {
  const bare = unbracket(host);
  if (isIP(bare) !== 0) return undefined;
  if (!/^[a-z0-9.-]+$/i.test(bare) || bare.startsWith('.') || bare.includes('..')) return 'not a host name';
  const name = bare.endsWith('.') ? bare.slice(0, -1) : bare;
  if (name === '' || !name.includes('.')) return 'a single-label name';
  return undefined;
}

/**
 * THE REFUSAL, in our words. It names the host as it was typed and never the
 * address it resolved to: which address that was is the service's business,
 * and saying it would tell the person what is inside our network.
 */
export class HostInsideOurNetwork extends Error {
  /** A code a screen can key its own sentence on (0136 T1, in both languages). */
  readonly code = 'host_inside_our_network';
  /** The host as it was typed. */
  readonly host: string;

  constructor(host: string) {
    super(
      `${host} is an address inside this service's own network, so we do not connect to it. ` +
        'Give the address the server has on the internet.',
    );
    this.name = 'HostInsideOurNetwork';
    this.host = host;
  }
}

/** What a lookup answers: every address, in the resolver's order. */
export type ResolveAll = (host: string) => Promise<ReadonlyArray<{ address: string; family: number }>>;

/** What the rule is, once a process has switched it on. */
export interface ReachableHostRule {
  /**
   * Exact host names admitted although they resolve inward: the demo targets
   * on the gate's stack, by compose name (0136 T2). Lower case, no wildcards.
   */
  readonly allow: ReadonlySet<string>;
  readonly resolve: ResolveAll;
}

const resolveAll: ResolveAll = (host) => lookup(host, { all: true, verbatim: true });

/**
 * The address to connect to for `host`, checked, or the refusal.
 *
 * An address typed as an address is checked as it is; an allowed name is not
 * an address, so an address literal is never admitted by the list. A name is
 * checked for its shape, then resolved, and EVERY address it resolves to must
 * pass: a name with one public and one private answer is refused, because
 * which one a later connection would get is not ours to predict.
 */
export async function reachableAddress(
  host: string,
  rule: ReachableHostRule,
): Promise<{ address: string; family: 4 | 6 }> {
  const bare = unbracket(host);
  const literal = isIP(bare);
  if (literal !== 0) {
    if (isRefusedAddress(bare)) throw new HostInsideOurNetwork(host);
    return { address: bare, family: literal === 6 ? 6 : 4 };
  }
  const name = bare.toLowerCase().replace(/\.$/, '');
  const allowed = rule.allow.has(name);
  if (!allowed && refusedHostShape(bare) !== undefined) throw new HostInsideOurNetwork(host);
  const answers = await rule.resolve(name);
  const first = answers[0];
  if (first === undefined) throw new Error(`${host} did not resolve to any address.`);
  if (!allowed && answers.some((answer) => isRefusedAddress(answer.address))) {
    throw new HostInsideOurNetwork(host);
  }
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

/** What undici calls to open a socket, and calls back with it. */
type Connector = ReturnType<typeof UndiciBuildConnector>;

/**
 * A connector that opens every socket to a checked address.
 *
 * `hostname` is replaced by the address that was checked, and `host`, the
 * typed `name:port`, is passed on untouched: undici takes the TLS server name
 * from it (`getServerName`), so SNI and the certificate check are for the name
 * that was typed, while the socket goes to the address that was checked.
 * Exported for the guard, which drives it with a stand-in for the real one.
 */
export function checkedConnector(rule: ReachableHostRule, connect: Connector): Connector {
  return ((options, callback) => {
    reachableAddress(options.hostname, rule).then(
      ({ address }) => connect({ ...options, hostname: address }, callback),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), null),
    );
  }) as Connector;
}

/** The switched-on rule and the dispatcher that carries it, or nothing (the appliance). */
let active: { readonly rule: ReachableHostRule; readonly dispatcher: UndiciAgent } | undefined;

/**
 * Switch the rule on for this process. The managed API and the managed task
 * runtime call it at start-up; nothing the appliance runs does.
 *
 * Returns the way to switch it off again, which the guard uses. A process has
 * no other reason to. The dispatcher is handed to Node's own `fetch` per
 * request, never installed as the global one (see the imports above).
 */
export function refuseInternalAddresses(
  options: { readonly allow?: Iterable<string>; readonly resolve?: ResolveAll } = {},
): () => void {
  const rule: ReachableHostRule = {
    allow: new Set([...(options.allow ?? [])].map((name) => name.toLowerCase().replace(/\.$/, ''))),
    resolve: options.resolve ?? resolveAll,
  };
  const dispatcher = new Agent({ connect: checkedConnector(rule, buildConnector({})) });
  const mine = { rule, dispatcher };
  active = mine;
  return () => {
    if (active === mine) active = undefined;
    void dispatcher.close();
  };
}

/** Is the rule switched on in this process? */
export function refusesInternalAddresses(): boolean {
  return active !== undefined;
}

/**
 * `fetch`, for a request to a host a tenant gave us.
 *
 * With the rule off it IS the global `fetch`. With it on, the request goes
 * through the checked dispatcher, and a refusal comes back as itself rather
 * than as `fetch failed`, the `TypeError` fetch wraps every connection error
 * in: its sentence is what the person is shown.
 */
export async function tenantFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const current = active;
  if (current === undefined) return fetch(input, init);
  try {
    return await fetch(input, { ...init, dispatcher: current.dispatcher } as RequestInit);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause instanceof HostInsideOurNetwork) throw cause;
    throw error;
  }
}

/**
 * The host and TLS name to connect to for a client that opens its own socket
 * (IMAP). With the rule off, the host as typed. With it on, the checked
 * address, and the typed name as `servername` so TLS still verifies the
 * certificate against the name that was typed.
 */
export async function reachableHost(host: string): Promise<{ host: string; servername?: string }> {
  const current = active;
  if (current === undefined) return { host };
  const { address } = await reachableAddress(host, current.rule);
  const bare = unbracket(host);
  return isIP(bare) !== 0 ? { host: address } : { host: address, servername: bare };
}

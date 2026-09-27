// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY DOCKER NETWORK ON THIS MACHINE LIES INSIDE THE RULE'S RANGES
 * (workplan 0136 T1 (b)).
 *
 * `bootstrap-managed.sh` runs this before the API comes up, and feeds it
 * `docker network inspect` for every network on the machine: this stack's, the
 * other stack's on the same daemon, and Docker's own.
 *
 * WHY EVERY ONE. A container reaches its network's gateway, and the gateway is
 * the host, so a host a tester types that resolves into any Docker network
 * reaches what the machine publishes there. The rule in
 * `packages/shared/src/reachable-host.ts` refuses a host that resolves inside
 * its ranges, and holds no range of its own for Docker's networks: with
 * Docker's built-in address pools they lie inside the private ranges. A daemon
 * set to hand out other pools puts a network outside them, where the rule
 * would let a tester's host through. So the bring-up refuses to go on, and
 * names the network.
 *
 * Reads the JSON array `docker network inspect` prints on stdin. Prints one
 * line per network, and a last line that counts them. Exits 1 when a subnet or
 * a gateway lies outside, and 2 when the input is not what `docker network
 * inspect` prints.
 */

import { readFileSync } from 'node:fs';
import { isRefusedAddress, networkInsideRefusedRanges } from '../packages/shared/src/reachable-host.ts';

/** The fields of `docker network inspect` this reads. */
interface InspectedNetwork {
  readonly Name?: unknown;
  readonly Labels?: Record<string, string> | null;
  readonly IPAM?: {
    readonly Config?: ReadonlyArray<{ readonly Subnet?: unknown; readonly Gateway?: unknown }> | null;
  } | null;
}

function unreadable(why: string): never {
  process.stderr.write(`cannot read the networks: ${why}\n`);
  process.exit(2);
}

let networks: unknown;
try {
  networks = JSON.parse(readFileSync(0, 'utf8'));
} catch (error) {
  unreadable(error instanceof Error ? error.message : String(error));
}
if (!Array.isArray(networks) || networks.length === 0) unreadable('expected a non-empty JSON array');

let outside = 0;
for (const network of networks as InspectedNetwork[]) {
  const name = typeof network.Name === 'string' ? network.Name : '(unnamed)';
  const project = network.Labels?.['com.docker.compose.project'];
  const label = project ? `${name} (compose project ${project})` : name;
  const wrong: string[] = [];
  const held: string[] = [];
  for (const config of network.IPAM?.Config ?? []) {
    if (config.Subnet !== undefined && config.Subnet !== '') {
      const subnet = String(config.Subnet);
      (networkInsideRefusedRanges(subnet) ? held : wrong).push(`subnet ${subnet}`);
    }
    if (config.Gateway !== undefined && config.Gateway !== '') {
      const gateway = String(config.Gateway);
      (isRefusedAddress(gateway) ? held : wrong).push(`gateway ${gateway}`);
    }
  }
  if (wrong.length > 0) {
    outside += 1;
    process.stdout.write(`OUTSIDE ${label}: ${wrong.join(', ')}\n`);
  } else {
    process.stdout.write(`inside  ${label}${held.length > 0 ? `: ${held.join(', ')}` : ': no addresses'}\n`);
  }
}

const count = (networks as unknown[]).length;
if (outside > 0) {
  process.stdout.write(`${outside} of ${count} Docker networks lie outside the ranges the rule refuses\n`);
  process.exit(1);
}
process.stdout.write(`all ${count} Docker networks lie inside the ranges the rule refuses\n`);

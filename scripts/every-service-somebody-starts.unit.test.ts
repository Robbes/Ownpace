// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SERVICE NOBODY EVER STARTED, TWICE.
 *
 * `managed.yml` defines the stack. `bootstrap-managed.sh` starts it. Nothing
 * connected the two, so a service could be fully defined — image pinned, ports
 * published, variables required in `.env`, documented, given its own page in
 * `docs/` — and never once brought up. That has now happened twice:
 *
 *   zitadel   Added in #496 and left out of the bring-up's service list. For
 *             three weeks every compose command had to satisfy
 *             ZITADEL_MASTERKEY for a container that did not exist, E2E
 *             (managed) #34-#36 died on it, and the nightly said nothing at
 *             all about whether anybody could sign in.
 *
 *   gatus     Named ZERO times in bootstrap-managed.sh. `STATUS_PORT` in
 *             managed.env.example, a section in docs/managed-bring-up.md
 *             saying it "starts with everything else", and a whole
 *             status-page.md — for a container no bring-up had ever run.
 *             Found by reading `docker ps` on the Spark and noticing what was
 *             not in it.
 *
 * Both are the same defect and neither was a typo: it is what happens when the
 * definition and the thing that runs it are two files nothing compares. So
 * this compares them.
 *
 * THE RULE IS DELIBERATELY WEAK, and that is the point. It asks only whether
 * the bring-up MENTIONS the service by name — not whether it starts it
 * correctly, in the right phase, with the right flags. A stronger rule would
 * need to model `up_wait`, the phase list, `--with-demo` and `--from`, and a
 * guard that models its subject is a guard that goes stale. "Named nowhere at
 * all" is exactly the shape both failures had, and it is cheap to be sure of.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(REPO_ROOT, 'deploy/compose');
const managedYml = readFileSync(join(COMPOSE, 'managed.yml'), 'utf8');
const bootstrap = readFileSync(join(COMPOSE, 'bootstrap-managed.sh'), 'utf8');

/**
 * Services nothing is expected to bring up, each with the reason it is not a
 * hole. An exemption list is a promise that somebody looked; an empty rule with
 * a growing list is not.
 */
const NOT_BROUGHT_UP: Record<string, string> = {
  'zitadel-machinekey': 'a one-shot `run` that chowns a volume, not a service to start',
};

/**
 * The service names under the top-level `services:` key.
 *
 * Stops at the next top-level key — `volumes:`, `networks:` — because a naive
 * "two-space indent" scan reads `ownpace-network` as a service and then demands
 * the bring-up start a network.
 */
export function servicesIn(yml: string): string[] {
  const start = yml.indexOf('\nservices:');
  if (start < 0) return [];
  const rest = yml.slice(start + '\nservices:'.length);
  const end = rest.search(/\n[a-z][a-z0-9_-]*:/);
  const block = end < 0 ? rest : rest.slice(0, end);
  return [...block.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]!);
}

describe('every service the stack defines is one the bring-up knows about', () => {
  const services = servicesIn(managedYml);

  it('found the services, rather than passing on an empty list', () => {
    // The failure mode of a scan: the file moves, the regex finds nothing, and
    // a rule about everything becomes a rule about nothing.
    expect(services.length).toBeGreaterThan(10);
    expect(services).toContain('api');
    expect(services).toContain('gatus');
    expect(services, 'a network was read as a service').not.toContain('ownpace-network');
  });

  it.each(servicesIn(managedYml))('bootstrap-managed.sh names %s', (service) => {
    if (NOT_BROUGHT_UP[service]) return;
    expect(
      new RegExp(`\\b${service.replace(/[-]/g, '\\-')}\\b`).test(bootstrap),
      `${service} is defined in managed.yml and named nowhere in bootstrap-managed.sh,\n` +
        'so no bring-up has ever started it. That is what happened to zitadel for\n' +
        'three weeks and to gatus until 2026-08-24. Add it to the phase that owns\n' +
        'it, or add it to NOT_BROUGHT_UP with the reason it is not a hole.',
    ).toBe(true);
  });

  it('every exemption names a service that still exists', () => {
    // An exemption for a service that was removed is a comment claiming a
    // decision nobody is making any more.
    for (const name of Object.keys(NOT_BROUGHT_UP)) expect(services).toContain(name);
  });
});

describe('the rule itself', () => {
  it('reads service names and stops at the next top-level key', () => {
    const yml = [
      'name: x',
      'services:',
      '  api:',
      '    image: a',
      '  web:',
      '    image: b',
      'networks:',
      '  ownpace-network:',
      'volumes:',
      '  data:',
    ].join('\n');
    expect(servicesIn(yml)).toEqual(['api', 'web']);
  });

  it('answers nothing for a file with no services block, instead of guessing', () => {
    expect(servicesIn('name: x\nvolumes:\n  data:\n')).toEqual([]);
  });
});

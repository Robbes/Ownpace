// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A service with no healthcheck reports no health, for ever. Anything waiting
 * for it to report healthy waits for ever.
 *
 * E2E (managed) #48 is what that costs, and the miss was mine. #517 removed
 * zitadel's healthcheck — correctly: `zitadel ready` asks ExternalPort, the
 * address the OUTSIDE reaches Zitadel on, and nothing is bound to it inside the
 * container. Before shipping that I grepped for `depends_on: … service_healthy`,
 * found nothing, and concluded nothing depended on it.
 *
 * I never grepped for scripts that poll health themselves. `setup-zitadel.sh`
 * did, on `"Health":"healthy"`, so the run reached it, waited the full five
 * minutes for a field that could no longer be set, and died:
 *
 *   [setup-zitadel] FATAL: it did not become healthy within five minutes
 *
 * WHAT THIS READS, AND WHAT IT CANNOT: compose declarations only. A service
 * can also inherit a HEALTHCHECK from its IMAGE — `api` and `web` declare none
 * here and still report `(healthy)`, because their Dockerfiles carry one. So a
 * script polling one of those would be flagged wrongly. That is a loud failure
 * somebody investigates, not a silent pass, which is the right way round; and
 * zitadel is empirically clear either way — #48's `ps` shows `Up 5 minutes`
 * with no health column at all, so its image declares none either.
 *
 * `depends_on` is one way to depend on a healthcheck and a `ps --format json`
 * poll is another, and a guard that only knows the first is the guard that let
 * this through. So this one derives BOTH sides from the files: which services
 * declare a healthcheck, and which services the scripts wait on the health of.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'compose');
const MANAGED = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');

/**
 * Service names in managed.yml and whether each declares a healthcheck.
 *
 * Bounded to the `services:` block. The first version scanned to end-of-file
 * and duly reported `ownpace-network` as a service with no healthcheck, and
 * misparsed `api` and `web` — both of which do have one — because their blocks
 * open with a nested `build:`. A guard with a wrong list of services is worse
 * than no guard: it is a wrong answer wearing a green tick.
 */
const services = (() => {
  const start = MANAGED.indexOf('\nservices:');
  const after = [...MANAGED.slice(start + 1).matchAll(/\n(?=[a-z])/g)]
    .map((m) => m.index! + start + 1)
    .find((i) => i > start);
  const body = MANAGED.slice(start, after ?? MANAGED.length);
  const out = new Map<string, boolean>();
  const names = [...body.matchAll(/\n {2}([a-z][a-z0-9-]*):\n/g)];
  names.forEach(({ 1: name, index }, i) => {
    const end = i + 1 < names.length ? names[i + 1]!.index! : body.length;
    const block = body.slice(index!, end).replace(/^\s*#.*$/gm, '');
    out.set(name!, /^\s{4}healthcheck:/m.test(block));
  });
  return out;
})();

const scripts = readdirSync(COMPOSE_DIR)
  .filter((f) => f.endsWith('.sh'))
  .map((f) => ({ file: f, text: readFileSync(join(COMPOSE_DIR, f), 'utf8') }));

describe('nothing waits for a health signal that cannot arrive', () => {
  it('parsed the compose file and found both kinds of service', () => {
    // Vacuity guard: if the service regex stops matching, every case below
    // passes on an empty map — which is exactly how a guard stops guarding.
    expect(services.size, 'no services parsed out of managed.yml').toBeGreaterThan(8);
    const withCheck = [...services.values()].filter(Boolean).length;
    expect(withCheck, 'no service declares a healthcheck — the regex broke').toBeGreaterThan(3);
    expect(
      services.size - withCheck,
      'no service lacks a healthcheck, so this guard is testing nothing',
    ).toBeGreaterThan(0);
    // And the parse must STOP at the services block. Reading on picks up the
    // `networks:` and `volumes:` entries as though they were services, which
    // puts names in the checkless list that can never be polled and makes a
    // false positive possible for no reason.
    expect(
      [...services.keys()].filter((n) => /network|_data|_machinekey/.test(n)),
      'the parse ran past `services:` into networks or volumes',
    ).toEqual([]);
  });

  it('zitadel has no healthcheck, which is the premise', () => {
    // Stated separately so that restoring one fails HERE, loudly, rather than
    // quietly re-enabling the waits below.
    expect(services.get('zitadel'), 'zitadel is gone or renamed').toBeDefined();
    expect(
      services.get('zitadel'),
      'a healthcheck came back — see #517: `zitadel ready` cannot reach ExternalPort from inside',
    ).toBe(false);
  });

  it('no script polls the health of a service that declares none', () => {
    // A WINDOW, not the same line, and the first version of this got it wrong.
    // The real code reads
    //
    //   state="$("${COMPOSE[@]}" ps --format json zitadel …)"
    //   case "$state" in
    //     *'"Health":"healthy"'*) ready=1; break ;;
    //
    // — the health match and the service name are three lines apart. Requiring
    // both on one line made this case pass while the exact bug from #48 sat in
    // the file, which is the same mistake as the two bad breaks in #516: an
    // assertion checking something adjacent to the thing it meant to check.
    // Found by breaking it, which is the only reason it is not still wrong.
    const WINDOW = 6;
    const checkless = [...services].filter(([, has]) => !has).map(([name]) => name);
    const offenders: string[] = [];
    for (const { file, text } of scripts) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (/^\s*#/.test(line)) return;
        if (!/"Health"\s*:\s*"healthy"|\{\{\.Health\}\}/.test(line)) return;
        // Which service is this poll about? Look for a literal name near it.
        // A variable (`"$svc"`) is generic code and cannot be resolved here —
        // `explain_failure` is exactly that, and it REPORTS health rather than
        // waiting on it, so it is not this rule's business.
        // COMMENTS STRIPPED from the window too. `explain_failure` reads health
        // generically through `"$svc"` and its header explains itself by naming
        // zitadel — so an unstripped window read the prose and flagged the one
        // function in the file that REPORTS health rather than waiting on it.
        const near = lines
          .slice(Math.max(0, i - WINDOW), i + WINDOW + 1)
          .filter((l) => !/^\s*#/.test(l))
          .join('\n');
        for (const svc of checkless) {
          if (new RegExp(`\\b${svc}\\b`).test(near)) {
            offenders.push(`${file}:${i + 1}: ${line.trim()}   (about "${svc}")`);
          }
        }
      });
    }
    expect(
      [...new Set(offenders)],
      'waits for a health field that will never be set — the service declares no healthcheck',
    ).toEqual([]);
  });

  it('the two readiness waits agree on the address, so they cannot drift apart', () => {
    // One lives in the bring-up and one in setup-zitadel.sh, which is also run
    // standalone. Duplicated on purpose — but if they ever disagree about WHICH
    // port, one of them is asking an address that cannot answer, which is the
    // whole family of bug this file is about.
    const bootstrap = scripts.find((s) => s.file === 'bootstrap-managed.sh')!.text;
    const setup = scripts.find((s) => s.file === 'setup-zitadel.sh')!.text;
    for (const [name, text] of [
      ['bootstrap-managed.sh', bootstrap],
      ['setup-zitadel.sh', setup],
    ] as const) {
      expect(text, `${name} must ask the readiness endpoint`).toContain('/debug/ready');
      expect(text, `${name} must use the PUBLISHED port`).toMatch(/ZITADEL_PORT/);
    }
    // And neither may reach for ExternalPort when building that URL.
    const readyLines = [...bootstrap.split('\n'), ...setup.split('\n')]
      .filter((l) => !/^\s*#/.test(l) && l.includes('/debug/ready'));
    expect(readyLines.length, 'no readiness URL found in either script').toBeGreaterThan(1);
    for (const line of readyLines) {
      expect(line, 'ExternalPort is the address that cannot be reached').
        not.toMatch(/EXTERNALPORT/);
    }
  });
});

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
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

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

/**
 * A STATUS PAGE THAT PROBES ITSELF.
 *
 * Starting `gatus` (above) makes visible something that could not be seen while
 * it never ran: it reads `STATUS_WEB_URL`, defaulting to `WEB_URL`, and the
 * shipped default is `http://localhost:3123`. The probe runs INSIDE the gatus
 * container, where `localhost` is gatus and nothing serves 3123 — so a
 * perfectly healthy stack lights four red lamps.
 *
 * `WEB_URL` cannot simply be changed: the issuer, the redirect URIs and the
 * grant email all read it, and it has to stay the address a BROWSER uses. So
 * `STATUS_WEB_URL` became overridable, defaulting to `WEB_URL` — and the
 * bring-up says so when the effective value is a loopback one.
 *
 * A status page wrong in the pessimistic direction is exactly as useless as one
 * wrong in the optimistic direction, and gatus.yaml's own header says the
 * second half of that out loud.
 *
 * RUN, not read: the condition is a `case` over four URL shapes, which is
 * precisely the kind of thing that reads correct and behaves otherwise.
 */
describe('the bring-up says when the status page would probe itself', () => {
  function noteFor(env: Record<string, string>): string {
    const home = mkdtempSync(join(tmpdir(), 'statusnote-'));
    try {
      const envFile = join(home, '.env');
      writeFileSync(
        envFile,
        Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n',
      );
      const fn = (name: string) => {
        const at = bootstrap.indexOf(`${name}() {`);
        return at < 0 ? '' : bootstrap.slice(at, bootstrap.indexOf('\n}\n', at) + 3);
      };
      const program = [
        'set -uo pipefail',
        `ENV_FILE="${envFile}"`,
        'note() { echo "    $*"; }',
        fn('env_get'),
        fn('note_status_page_probes_itself'),
        'note_status_page_probes_itself',
      ].join('\n');
      const r = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
      return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  it('the function is in the script and is called', () => {
    expect(bootstrap).toContain('note_status_page_probes_itself() {');
    expect(bootstrap, 'defined but never called').toMatch(
      /^ {2}note_status_page_probes_itself$/m,
    );
  });

  it('speaks for the shipped default, which is the case that bites', () => {
    const said = noteFor({ WEB_URL: 'http://localhost:3123' });
    expect(said).toContain('PROBE ITSELF');
    expect(said, 'does not name the address it is complaining about').toContain(
      'http://localhost:3123',
    );
    expect(said, 'no way to fix it').toContain('STATUS_WEB_URL=');
    expect(said, 'does not say WEB_URL must stay as it is').toMatch(/WEB_URL must/);
  });

  it('says nothing once STATUS_WEB_URL points somewhere reachable', () => {
    expect(noteFor({ WEB_URL: 'http://localhost:3123', STATUS_WEB_URL: 'http://web:80' })).toBe('');
  });

  it('says nothing for a real deployment', () => {
    expect(noteFor({ WEB_URL: 'https://app.ota.ownpace.eu' })).toBe('');
  });

  it('covers 127.0.0.1 as well as the word localhost', () => {
    expect(noteFor({ WEB_URL: 'http://127.0.0.1:3123' })).toContain('PROBE ITSELF');
  });

  it('names the port the page is published on, from .env', () => {
    const said = noteFor({ WEB_URL: 'http://localhost:3123', STATUS_PORT: '3999' });
    expect(said).toContain('http://localhost:3999');
  });
});

describe('what gatus reads is what /api/ready answers', () => {
  // The other half of the same risk: field names that drifted would show red
  // for a healthy stack just as surely as an unreachable URL, and nothing
  // compared them while the page never ran.
  const gatus = readFileSync(join(COMPOSE, 'gatus.yaml'), 'utf8');
  const ready = readFileSync(join(REPO_ROOT, 'apps/api/src/routes/ready.ts'), 'utf8');

  it.each([...gatus.matchAll(/\[BODY\]\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]!))(
    'ready.ts answers with a `%s` field',
    (field) => {
      expect(
        new RegExp(`\\b${field}\\b`).test(ready),
        `gatus.yaml reads [BODY].${field} and apps/api/src/routes/ready.ts never\n` +
          'names it, so that lamp is red on a healthy stack.',
      ).toBe(true);
    },
  );

  it('found conditions to check, rather than passing on an empty list', () => {
    expect([...gatus.matchAll(/\[BODY\]\.([A-Za-z][A-Za-z0-9]*)/g)].length).toBeGreaterThan(1);
  });
});

/**
 * A HEALTHCHECK THAT COULD NEVER RUN.
 *
 * gatus carried this from #498 until 2026-08-25:
 *
 *     test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
 *
 * `ghcr.io/twin/gatus`'s final stage is `FROM scratch` — the binary and
 * ca-certificates, nothing else. No wget, no curl, no shell (so `CMD-SHELL` is
 * out too), and `main.go` parses no arguments, so there is no `gatus health`
 * subcommand the way mailpit has `/mailpit readyz`.
 *
 * It was never executed once, because nothing started the service until #547
 * added it to the bring-up's list. Its first real run was E2E (managed) #77,
 * where it marked a perfectly healthy container `unhealthy` and failed the
 * gate's residue check — the only red thing in the run.
 *
 * A healthcheck that can never pass is a permanent false negative, which is
 * worse than none: it hides a real one. So the question moved to the side that
 * can answer it, and this pins BOTH halves of that decision — the absence, and
 * the probe that replaces it. Re-adding a `CMD` healthcheck here without
 * changing the image fails this file rather than the nightly.
 *
 * DELIBERATELY NARROW. The general rule — every service without a healthcheck
 * is probed by the smoke or exempted with a reason — would also cover zitadel,
 * minio, the registry, the docker proxy and the TLS terminator, and is worth
 * writing when somebody has read what each of those images can actually
 * execute. Guessing that for five images is how this defect was written in the
 * first place.
 */
describe('the status page, which cannot check itself', () => {
  const smoke = readFileSync(join(COMPOSE, 'smoke-managed.sh'), 'utf8');
  // The gatus block as text, for the one assertion that is ABOUT the comment:
  // from its key to the next top-level service key.
  const gatusStart = managedYml.indexOf('\n  gatus:');
  const nextService = managedYml.slice(gatusStart + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  const gatusService = managedYml.slice(
    gatusStart,
    nextService === -1 ? undefined : gatusStart + 1 + nextService,
  );

  it('has no container healthcheck, because its image can execute nothing', () => {
    // Parsed rather than grepped: a commented-out `healthcheck:` in the
    // explanation above it must not read as a live one, and vice versa.
    const doc = parseYaml(managedYml) as {
      services: Record<string, { healthcheck?: unknown; image?: string }>;
    };
    expect(doc.services.gatus, 'the gatus service disappeared').toBeTruthy();
    expect(
      doc.services.gatus?.healthcheck,
      'gatus has a healthcheck again. Its image is FROM scratch — no wget, no\n' +
        'curl, no shell, no CLI subcommand — so any CMD here is a permanent\n' +
        'false negative that fails the gate on a healthy container. The probe\n' +
        'lives in smoke-managed.sh instead.',
    ).toBeUndefined();
    // The reasoning has to stay next to the absence, or the next person
    // "fixes" the missing healthcheck.
    expect(gatusService).toMatch(/NO HEALTHCHECK, AND THIS IS NOT AN OMISSION/);
  });

  it('is probed by the smoke instead, and a silent one fails the gate', () => {
    expect(
      /curl [^\n]*"\$\{STATUS\}\/health"/.test(smoke),
      'smoke-managed.sh no longer probes the status page. gatus has no\n' +
        'container healthcheck by design, so this probe is the only thing that\n' +
        'speaks for it — dropping both leaves a started service unchecked.',
    ).toBe(true);
    // Asserted, not merely present: a probe whose failure is only echoed lets
    // the gate pass while the service is down.
    const block = smoke.slice(smoke.indexOf('# ---------- the status page answers'));
    expect(block.slice(0, block.indexOf('# ---------- verdict'))).toMatch(/fail=1/);
  });
});

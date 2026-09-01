// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ALIAS THAT SHADOWED THE FRONT.
 *
 * `managed.yml` gives the provider a network alias so the origin its instance
 * was initialised with resolves to it from everywhere on the stack's network.
 * That was added for a real failure (#1f6a699): `ZITADEL_EXTERNALDOMAIN`
 * defaulted to `localhost`, `JWT_ISSUER` became `http://localhost:3126`, and
 * inside the API container `localhost` is the API — so every authenticated
 * request answered 500 with `ECONNREFUSED 127.0.0.1:3126`.
 *
 * It is the right answer when the provider IS the address. It is the wrong one
 * when something fronts it. On a fronted stack the browser reaches
 * `https://id.example.eu` on 443, a proxy terminates TLS and forwards to 3126;
 * the API must present that same origin because `iss` matches byte for byte —
 * and the alias pins the name to the container, so the API connects to the
 * container on 443, where nothing listens:
 *
 *     [ready] the issuer's key source at
 *     https://id.ota.ownpace.eu/.well-known/openid-configuration is unreachable
 *       Error: connect ECONNREFUSED 172.23.0.21:443
 *
 * Same 500, same shape, opposite cause. Measured rather than reasoned: a
 * container on the DEFAULT bridge — where the alias cannot reach — fetched that
 * exact URL and got 200 (Spark, 2026-09-01). The front was fine; the alias was
 * standing in front of it.
 *
 * So the alias is derived. This pins the decision, and pins that nothing starts
 * the provider before making it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy/compose');

let dir: string;
let script: string;
let envFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'idp-alias-'));
  const compose = join(dir, 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  // The real script AND the real upsert it writes through — a fixture upsert
  // could accept a value the shipped one refuses.
  for (const name of ['zitadel-network-alias.sh', 'env-upsert.sh']) {
    const p = join(compose, name);
    copyFileSync(join(COMPOSE_DIR, name), p);
    chmodSync(p, 0o755);
  }
  script = join(compose, 'zitadel-network-alias.sh');
  envFile = join(compose, '.env');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function decide(env: string) {
  writeFileSync(envFile, env);
  const res = spawnSync('bash', [script], { encoding: 'utf-8' });
  if (res.status !== 0) throw new Error(`exit ${res.status}: ${res.stderr}`);
  const written = readFileSync(envFile, 'utf-8')
    .split('\n')
    .filter((l) => l.startsWith('ZITADEL_NETWORK_ALIAS='))
    .map((l) => l.slice('ZITADEL_NETWORK_ALIAS='.length));
  expect(written.length, 'exactly one alias line').toBe(1);
  return written[0];
}

describe('which name the provider answers to on the network', () => {
  it('is the external domain when the provider serves that origin itself', () => {
    expect(
      decide(
        'ZITADEL_EXTERNALDOMAIN=id.example.eu\nZITADEL_PORT=3126\nZITADEL_EXTERNALPORT=3126\nZITADEL_EXTERNALSECURE=false\n',
      ),
    ).toBe('id.example.eu');
  });

  it('is the external domain when the external port is simply left to default', () => {
    expect(
      decide('ZITADEL_EXTERNALDOMAIN=id.example.eu\nZITADEL_PORT=3126\n'),
    ).toBe('id.example.eu');
  });

  it('is the container when TLS is terminated somewhere else', () => {
    // The Spark, 2026-09-01: Netbird terminates 443 and forwards to 3126.
    expect(
      decide(
        'ZITADEL_EXTERNALDOMAIN=id.ota.ownpace.eu\nZITADEL_PORT=3126\nZITADEL_EXTERNALPORT=443\nZITADEL_EXTERNALSECURE=true\n',
      ),
    ).toBe('ownpace-idp');
  });

  it('is the container when the external port is not the one it serves', () => {
    expect(
      decide(
        'ZITADEL_EXTERNALDOMAIN=id.example.eu\nZITADEL_PORT=3126\nZITADEL_EXTERNALPORT=8443\nZITADEL_EXTERNALSECURE=false\n',
      ),
    ).toBe('ownpace-idp');
  });

  it('falls back to the container name when nothing is configured at all', () => {
    expect(decide('POSTGRES_USER=openmigrate\n')).toBe('ownpace-idp');
  });

  it('reads values documented with an inline comment, like the example ships', () => {
    // managed.env.example puts comments on the same line as thirteen values;
    // see scripts/two-readings-of-one-env-file.unit.test.ts.
    expect(
      decide(
        'ZITADEL_EXTERNALDOMAIN=id.example.eu\nZITADEL_PORT=3126    # the port it serves\nZITADEL_EXTERNALSECURE=    # true = fronted\n',
      ),
    ).toBe('id.example.eu');
  });

  it('--print decides without writing anything', () => {
    writeFileSync(
      envFile,
      'ZITADEL_EXTERNALDOMAIN=id.example.eu\nZITADEL_PORT=3126\n',
    );
    const res = spawnSync('bash', [script, '--print'], { encoding: 'utf-8' });
    expect(res.status).toBe(0);
    expect(res.stdout.trim().split('\n').pop()).toBe('id.example.eu');
    expect(readFileSync(envFile, 'utf-8')).not.toContain(
      'ZITADEL_NETWORK_ALIAS',
    );
  });
});

describe('what uses it', () => {
  const managed = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');

  it('is what managed.yml aliases on — not the external domain directly', () => {
    expect(managed).toContain('- ${ZITADEL_NETWORK_ALIAS:-ownpace-idp}');
    expect(managed).not.toContain('- ${ZITADEL_EXTERNALDOMAIN:-ownpace-idp}');
  });

  it('is decided before anything starts the provider', () => {
    // A network alias is fixed when the container joins the network. Deciding
    // it after `up` would mean the value is right in .env and wrong in Docker.
    for (const file of ['bootstrap-managed.sh', 'setup-zitadel.sh']) {
      const text = readFileSync(join(COMPOSE_DIR, file), 'utf8');
      const lines = text.split('\n');
      const up = lines.findIndex((l) =>
        /^\s*"\$\{COMPOSE\[@\]\}" up -d zitadel/.test(l),
      );
      expect(up, `${file} brings the provider up`).toBeGreaterThan(0);
      const before = lines.slice(0, up).join('\n');
      expect(before, `${file} decides the alias first`).toContain(
        'zitadel-network-alias.sh',
      );
    }
  });
});

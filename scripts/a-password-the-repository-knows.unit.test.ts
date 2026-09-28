// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASSWORD THE REPOSITORY KNOWS (workplan 0132 T2, its first and smallest part:
 * Trigger.dev's own database).
 *
 * `trigger-db`, the database the Trigger.dev plane keeps its accounts, API
 * keys, deployments and encrypted task environment in, was given its password
 * as a literal in `deploy/compose/managed.yml`: `POSTGRES_PASSWORD:
 * trigger_password`, and the same word inside `trigger-api`'s `DATABASE_URL`
 * and `DIRECT_URL`. No `.env` could reach it, so every stack brought up from
 * this repository, live's included, ran that database on a password anybody
 * can read here (0132 §4). The owner's D8 sets live's database passwords in
 * live's `.env` before its first bring-up; this one had nowhere to be set.
 *
 * NOW IT IS `TRIGGER_DB_PASSWORD`, read from `.env` by all three places, and
 * the fallback when a stack does not set it is today's literal. That is not
 * an oversight. The OTA stack's `trigger_db_data` volume was initialised with
 * `trigger_password`, and Postgres keeps the password a role was created with:
 * a new value in `.env` does not reach it. Were the fallback anything else, or
 * the variable required, the first nightly gate after this merged would
 * recreate `trigger-api` with a password `trigger-db` refuses, and the OTA
 * stack's Trigger.dev would stop. For the same reason `ensure-env-secrets.sh`,
 * which the gate runs and which fills every blank secret it knows, must NOT
 * generate this one: it writes a value into a `.env` whose volume keeps the
 * old one. Only `stand-up-live.sh` sets it, and only while live's
 * `trigger_db_data` volume does not exist yet: a new volume is where a new
 * password costs nothing (0132 T1b step 5).
 *
 * WHAT IS ASSERTED.
 *
 *   `managed.yml` has no bare `trigger_password`: every occurrence is the
 *   fallback of `${TRIGGER_DB_PASSWORD:-…}`, and the three places that carry
 *   the database's password (`trigger-db`'s `POSTGRES_PASSWORD`, `trigger-api`'s
 *   `DATABASE_URL` and `DIRECT_URL`) read it, and render to the same value.
 *   The fallback is today's literal, byte for byte, so a stack that sets
 *   nothing renders exactly what it rendered before.
 *   `managed.env.example` names the key, empty, with its note on a line of
 *   its own (a note after the `=` is a value to Compose).
 *   `ensure-env-secrets.sh`, run with a `docker` stub that reports the
 *   stack's `<project>_trigger_db_data` volume, leaves the key unset or empty,
 *   and so does it without the volume: it never writes this key.
 *
 * WHAT IS NOT BUILT, and belongs to the rest of 0132 T2 (the plan's guard of
 * this name lists four checks; this file holds the part that is built): the
 * variable becoming required, `load_env` refusing shipped values on a real
 * address, and the `data` phase making the roles match `.env`. They wait for
 * the OTA stack's passwords to be changed first (T0 step 2). The OTA stack's
 * `trigger-db` keeps the published value until then; it is not published on
 * the host.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const MANAGED = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
const EXAMPLE = readFileSync(join(COMPOSE_DIR, 'managed.env.example'), 'utf8');

/** The literal the OTA stack's trigger_db_data volume was initialised with. */
const TODAYS_LITERAL = 'trigger_password';
const KEY = 'TRIGGER_DB_PASSWORD';
const READ = `\${${KEY}:-${TODAYS_LITERAL}}`;

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

interface Service {
  environment?: Record<string, unknown>;
}
const compose = parseYaml(MANAGED) as { services: Record<string, Service> };

/** The three values that carry trigger-db's password, as written in managed.yml. */
const carriers = (): Record<string, string> => ({
  'trigger-db POSTGRES_PASSWORD': String(compose.services['trigger-db']?.environment?.POSTGRES_PASSWORD ?? ''),
  'trigger-api DATABASE_URL': String(compose.services['trigger-api']?.environment?.DATABASE_URL ?? ''),
  'trigger-api DIRECT_URL': String(compose.services['trigger-api']?.environment?.DIRECT_URL ?? ''),
});

/** Compose's `${NAME:-default}` for this one variable: set and non-empty wins. */
const render = (text: string, value: string | undefined): string =>
  text.replaceAll(READ, value === undefined || value === '' ? TODAYS_LITERAL : value);

describe("managed.yml reads trigger-db's password from .env, and falls back to today's literal", () => {
  it('found the three places that carry it', () => {
    for (const [where, text] of Object.entries(carriers())) {
      expect(text, `${where} is missing from managed.yml`).not.toBe('');
    }
  });

  it('has no bare literal: every trigger_password is the fallback of the variable', () => {
    const bare = MANAGED.split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      .filter(({ line }) => line.split(READ).join('').includes(TODAYS_LITERAL))
      .map(({ n, line }) => `managed.yml:${n}: ${line.trim()}`);
    expect(bare, `write ${READ}: a literal is a password no .env can change`).toEqual([]);
  });

  it('each of the three reads the variable', () => {
    for (const [where, text] of Object.entries(carriers())) {
      expect(text, where).toContain(READ);
    }
  });

  it("the fallback is today's literal, so a stack that sets nothing renders what it rendered before", () => {
    // The OTA stack's volume keeps `trigger_password`; its .env sets no key.
    const fallbacks = [...MANAGED.matchAll(new RegExp(`\\$\\{${KEY}:-([^}]*)\\}`, 'g'))].map((m) => m[1]);
    expect(fallbacks.length).toBe(3);
    expect(new Set(fallbacks)).toEqual(new Set([TODAYS_LITERAL]));
    const c = carriers();
    expect(render(c['trigger-db POSTGRES_PASSWORD']!, undefined)).toBe(TODAYS_LITERAL);
    for (const url of [c['trigger-api DATABASE_URL']!, c['trigger-api DIRECT_URL']!]) {
      expect(render(url, undefined)).toBe(`postgresql://trigger:${TODAYS_LITERAL}@trigger-db:5432/triggerdb`);
      expect(render(url, '')).toBe(`postgresql://trigger:${TODAYS_LITERAL}@trigger-db:5432/triggerdb`);
    }
  });

  it('a stack that sets it gets the same value in the database and in both URLs', () => {
    const value = 'c0ffee'.repeat(8);
    const c = carriers();
    expect(render(c['trigger-db POSTGRES_PASSWORD']!, value)).toBe(value);
    expect(render(c['trigger-api DATABASE_URL']!, value)).toBe(`postgresql://trigger:${value}@trigger-db:5432/triggerdb`);
    expect(render(c['trigger-api DIRECT_URL']!, value)).toBe(`postgresql://trigger:${value}@trigger-db:5432/triggerdb`);
  });

  it('managed.env.example names the key, empty, with its note on a line of its own', () => {
    const lines = EXAMPLE.split('\n');
    const at = lines.findIndex((l) => l.startsWith(`${KEY}=`));
    expect(at, `${KEY} is not in managed.env.example`).toBeGreaterThan(-1);
    expect(lines[at]).toBe(`${KEY}=`);
    const note = lines.slice(Math.max(0, at - 20), at).join('\n');
    expect(note).toMatch(/stand-up-live\.sh/);
    expect(note).toMatch(/ensure-env-secrets\.sh/);
  });
});

describe('ensure-env-secrets.sh never writes TRIGGER_DB_PASSWORD', () => {
  /** A checkout with the script, its two helpers, and a docker that reports the stack's volumes. */
  function checkout(dotEnv: string, volumes: string[]) {
    const root = mkdtempSync(join(tmpdir(), 'trigger-db-password-'));
    tempDirs.push(root);
    const compose = join(root, 'deploy', 'compose');
    mkdirSync(join(compose, 'pgbouncer'), { recursive: true });
    for (const f of ['ensure-env-secrets.sh', 'env-read.sh', 'env-upsert.sh']) {
      copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
      chmodSync(join(compose, f), 0o755);
    }
    copyFileSync(join(COMPOSE_DIR, 'managed.yml'), join(compose, 'managed.yml'));
    writeFileSync(join(compose, '.env'), dotEnv);
    const bin = join(root, 'bin');
    mkdirSync(bin);
    // `docker volume ls` and `docker volume inspect` answer as a daemon with these volumes would.
    writeFileSync(
      join(bin, 'docker'),
      `#!/usr/bin/env bash
vols='${volumes.join(' ')}'
if [ "$1 $2" = "volume ls" ]; then for v in $vols; do echo "$v"; done; exit 0; fi
if [ "$1 $2" = "volume inspect" ]; then for v in $vols; do [ "$v" = "$3" ] && { echo '[{}]'; exit 0; }; done; exit 1; fi
exit 0
`,
    );
    chmodSync(join(bin, 'docker'), 0o755);
    const r = spawnSync(join(compose, 'ensure-env-secrets.sh'), [], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: root, LANG: 'C' },
      cwd: root,
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, env: readFileSync(join(compose, '.env'), 'utf8') };
  }

  const keyValue = (env: string): string | undefined =>
    env
      .split('\n')
      .filter((l) => l.startsWith(`${KEY}=`))
      .map((l) => l.slice(KEY.length + 1))
      .at(-1);

  it("leaves it unset on a stack whose trigger_db_data volume exists (the OTA stack's case)", () => {
    const r = checkout('JWT_SECRET=\n', ['ownpace-managed_trigger_db_data', 'ownpace-managed_postgres_data']);
    expect(r.status, r.out).toBe(0);
    // It did run: the secrets it does know were generated.
    expect(r.env).toMatch(/^JWT_SECRET=[0-9a-f]{64}$/m);
    expect(keyValue(r.env)).toBeUndefined();
    expect(r.out).not.toContain(KEY);
  });

  it('leaves an empty line empty, volume or not', () => {
    for (const volumes of [['ownpace-managed_trigger_db_data'], []]) {
      const r = checkout(`JWT_SECRET=\n${KEY}=\n`, volumes);
      expect(r.status, r.out).toBe(0);
      expect(keyValue(r.env)).toBe('');
    }
  });

  it('does not generate it on a stack with no volume either: stand-up-live.sh is the one writer', () => {
    const r = checkout('JWT_SECRET=\n', []);
    expect(r.status, r.out).toBe(0);
    expect(keyValue(r.env)).toBeUndefined();
  });

  it("leaves the OTA stack's literal alone when a .env carries it", () => {
    const r = checkout(`JWT_SECRET=\n${KEY}=${TODAYS_LITERAL}\n`, ['ownpace-managed_trigger_db_data']);
    expect(r.status, r.out).toBe(0);
    expect(keyValue(r.env)).toBe(TODAYS_LITERAL);
  });
});

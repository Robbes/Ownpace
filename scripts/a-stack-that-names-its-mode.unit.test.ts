// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A STACK THAT NAMES ITS MODE (workplan 0132 T4; the owner, 2026-10-04: the
 * OTA stack runs *"Development, said explicitly"*).
 *
 * `deploy/compose/managed.yml` handed the api `NODE_ENV: ${NODE_ENV:-development}`.
 * That default wins over the image's own `ENV NODE_ENV=production`
 * (`apps/api/Dockerfile`), so a stack whose `.env` did not say its mode ran in
 * development, and nothing said so. Development is the mode in which the API
 * lets a placeholder `JWT_SECRET` through, takes an unsigned token when no
 * verifier is set, and only warns about a localhost `WEB_URL`. A live `.env`
 * that lost one line would have served testers that way.
 *
 * The owner's answer (2026-10-04) has two halves:
 *
 *   - Every stack names its mode. `managed.yml` takes `${NODE_ENV:?…}`, so a
 *     `.env` without it, or with it blank, stops Compose with a message that
 *     names the fix. Live says production, and `stand-up-live.sh` and
 *     `deploy-live.sh` refuse anything else (their own guards).
 *   - The test stack (OTA) runs development, said explicitly, so its
 *     self-signed test mail keeps working: in production the API turns
 *     notifications off while `SMTP_ALLOW_SELF_SIGNED=true`
 *     (`packages/shared/src/notifications.ts`). "Production on both", 0132 T4's
 *     first proposal, was rejected for that reason.
 *
 * THE TRAP IS AN ORDER. `managed.env.example` keeps `NODE_ENV=production`, so a
 * stack copied from it starts in production: fail safe. The nightly gate's
 * step *Fill in everything the repo already knows how to supply* fills every
 * `${VAR:?}` key the OTA stack's `.env` lacks from that example, and persists
 * the result. Once NODE_ENV is required, that loop would write `production`
 * into the OTA stack's `.env` for good, against the owner's answer. So the step
 * writes `NODE_ENV=development` first, when the value Compose would use is
 * empty, and never over a value that is there. Put the write after the loop
 * and the loop has already written production; a text check cannot see that,
 * so the step's own `run:` is run here.
 *
 * WHAT IS ASSERTED.
 *
 *   managed.yml: every service that sets NODE_ENV requires it with `:?`, none
 *   defaults it, and the message names both values and the plan, with no `}`
 *   or `$` that would end or expand it early.
 *
 *   managed.env.example: `NODE_ENV=production`, bare, with its note on the
 *   line above (a note after the value is the value to Compose), and the note
 *   says the gate writes the test stack's value when the key is absent.
 *
 *   The gate, run: the Fill step's own `run:` under `bash -eo pipefail`, in a
 *   temp checkout holding the real `managed.yml`, example, `env-upsert.sh`,
 *   `env-read.sh`, `stack-kind.sh` and `ensure-env-secrets.sh`, with the
 *   persisted directory in a temp dir. NODE_ENV absent: the checkout's `.env`
 *   and the persisted one say development, and the log says it was written.
 *   NODE_ENV blank, whitespace only, a note alone or `""`: the same. NODE_ENV
 *   production or development, bare, with `export` or in double quotes: kept,
 *   no line added, and the log names it; with a warning when it is not
 *   development, and none when it is.
 *
 *   The bring-up: `load_env` (bootstrap-managed.sh), with a `docker` stub that
 *   fails `compose config` on NODE_ENV, names `env-upsert.sh` with both values
 *   and the plan, and not `ensure-env-secrets.sh`, which writes no mode.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy/compose');
const MANAGED_YML = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
const EXAMPLE = readFileSync(join(COMPOSE_DIR, 'managed.env.example'), 'utf8');
const GATE_REL = '.github/workflows/e2e-managed.yml';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'names-its-mode-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// managed.yml
// ---------------------------------------------------------------------------

type Services = Record<string, { environment?: Record<string, unknown> | string[] }>;
const services = (parseYaml(MANAGED_YML) as { services: Services }).services;

/** The NODE_ENV each service is handed, as written in managed.yml. */
function nodeEnvOf(env: Record<string, unknown> | string[] | undefined): string | undefined {
  if (!env) return undefined;
  if (Array.isArray(env)) {
    const entry = env.find((e) => String(e).startsWith('NODE_ENV='));
    return entry === undefined ? undefined : String(entry).slice('NODE_ENV='.length);
  }
  return 'NODE_ENV' in env ? String(env.NODE_ENV) : undefined;
}

const setters = Object.entries(services)
  .map(([name, s]) => ({ name, value: nodeEnvOf(s.environment) }))
  .filter((s): s is { name: string; value: string } => s.value !== undefined);

describe('managed.yml: every stack names its mode', () => {
  it('found the services that set NODE_ENV (the api, at least)', () => {
    expect(setters.map((s) => s.name)).toContain('api');
  });

  it('defaults NODE_ENV nowhere: a .env without it does not quietly run development', () => {
    expect(MANAGED_YML, 'managed.yml still defaults NODE_ENV').not.toMatch(/\$\{NODE_ENV:?-/);
  });

  it.each(setters.map((s) => [s.name, s.value] as const))(
    'the %s service requires it with :?, and the message names the fix',
    (_name, value) => {
      const m = /^\$\{NODE_ENV:\?([^}$]+)\}$/.exec(value);
      expect(m, `NODE_ENV is handed as ${JSON.stringify(value)}, not \${NODE_ENV:?<the fix>}`).not.toBeNull();
      const message = m![1]!;
      expect(message).toMatch(/\.env/);
      expect(message).toMatch(/production/);
      expect(message).toMatch(/development/);
      expect(message).toMatch(/0132 T4/);
    },
  );
});

// ---------------------------------------------------------------------------
// managed.env.example
// ---------------------------------------------------------------------------

describe('managed.env.example: a stack copied from it starts in production', () => {
  const lines = EXAMPLE.split('\n');
  const at = lines.findIndex((l) => /^NODE_ENV=/.test(l));

  it('carries NODE_ENV=production, bare', () => {
    expect(at, 'managed.env.example has no NODE_ENV line').toBeGreaterThanOrEqual(0);
    expect(lines.filter((l) => /^NODE_ENV=/.test(l))).toEqual(['NODE_ENV=production']);
  });

  it('says on the line above which stack runs which, and that the gate writes the test stack\'s', () => {
    expect(lines[at - 1], 'the line above NODE_ENV is not its note').toMatch(/^#/);
    // The note's block: the comment lines right above the key.
    let from = at;
    while (from > 0 && /^#/.test(lines[from - 1]!)) from -= 1;
    const note = lines
      .slice(from, at)
      .map((l) => l.replace(/^#\s?/, ''))
      .join(' ');
    expect(note).toMatch(/production/);
    expect(note).toMatch(/development/);
    expect(note).toMatch(/0132 T4/);
    expect(note, 'the note no longer says the gate writes the test stack\'s value').toMatch(/gate/);
    expect(note, 'the note no longer says when the gate writes it').toMatch(/absent/);
  });
});

// ---------------------------------------------------------------------------
// The gate: run its Fill step for real
// ---------------------------------------------------------------------------

interface Step {
  name?: string;
  run?: string;
}
const gate = parseYaml(readFileSync(join(REPO_ROOT, GATE_REL), 'utf8')) as { jobs: Record<string, { steps: Step[] }> };
const fill = Object.values(gate.jobs)
  .flatMap((j) => j.steps)
  .find((s) => s.name?.startsWith('Fill in everything the repo already knows how to supply'));

/** The two keys a human obtains, which the step before refuses without; the step under test needs nothing else. */
const OTA_ENV = ['TRIGGER_PROJECT_REF=proj_example', 'TRIGGER_SECRET_KEY=tr_prod_example', ''].join('\n');

function runFill(dotEnv: string): { status: number | null; out: string; env: string; persisted: string } {
  const checkout = tempDir();
  const home = tempDir();
  const persist = tempDir();
  mkdirSync(join(checkout, 'deploy/compose'), { recursive: true });
  for (const f of [
    'managed.yml',
    'managed.env.example',
    'env-upsert.sh',
    'env-read.sh',
    'stack-kind.sh',
    'ensure-env-secrets.sh',
  ]) {
    copyFileSync(join(COMPOSE_DIR, f), join(checkout, 'deploy/compose', f));
  }
  writeFileSync(join(checkout, 'deploy/compose/.env'), dotEnv);
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', fill?.run ?? 'exit 99'], {
    cwd: checkout,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, MANAGED_ENV_PERSIST_DIR: persist },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const persistedFile = join(persist, '.env');
  return {
    status: r.status,
    out: `${r.stdout}${r.stderr}`,
    env: readFileSync(join(checkout, 'deploy/compose/.env'), 'utf8'),
    persisted: existsSync(persistedFile) ? readFileSync(persistedFile, 'utf8') : '',
  };
}

/** Every line that sets NODE_ENV, `export` form too, as Compose and bash both read them. */
const nodeEnvLines = (text: string): string[] =>
  text.split('\n').filter((l) => /^(export[ \t]+)?NODE_ENV=/.test(l));

describe("the nightly gate gives the OTA stack development, and never the example's production", () => {
  it('found the Fill step', () => {
    expect(fill?.run, `${GATE_REL} has no step "Fill in everything the repo already knows how to supply"`).toBeTruthy();
  });

  // Each is a line Compose reads as no value, or as a note for a value (the
  // contract's own finding: Compose trims the blanks after `=` before it looks
  // for a note, so `NODE_ENV=   # note` hands the api "# note"). A test of the
  // line's shape (`^NODE_ENV=.`) took the last three for set, kept them, and
  // the stack then stopped on the blank or ran in "# note".
  it.each([
    ['absent', OTA_ENV],
    ['blank', `${OTA_ENV}NODE_ENV=\n`],
    ['whitespace only', `${OTA_ENV}NODE_ENV=   \n`],
    ['a note alone', `${OTA_ENV}NODE_ENV=   # the mode\n`],
    ['empty double quotes', `${OTA_ENV}NODE_ENV=""\n`],
  ])('NODE_ENV %s: the step writes development, persists it, and says so', (_label, dotEnv) => {
    const r = runFill(dotEnv);
    expect(r.status, r.out).toBe(0);
    expect(nodeEnvLines(r.env), `the OTA stack's .env after the step:\n${r.out}`).toEqual(['NODE_ENV=development']);
    expect(nodeEnvLines(r.persisted), 'the persisted .env, which the next run restores').toEqual(['NODE_ENV=development']);
    expect(r.out).toMatch(/wrote NODE_ENV=development/);
    expect(r.out, 'the example\'s production reached the OTA stack').not.toMatch(/backfilled NODE_ENV/);
  });

  // [the line, the value as Compose reads it]. A value that is there is never
  // overwritten, whatever its form: `export` (which `^NODE_ENV=` does not see,
  // so the step once appended development after it, and the loop would have
  // appended production) and double quotes (which env_value keeps, and
  // Compose does not).
  it.each([
    ['NODE_ENV=production', 'production'],
    ['NODE_ENV=development', 'development'],
    ['export NODE_ENV=production', 'production'],
    ['export NODE_ENV=development', 'development'],
    ['NODE_ENV="development"', 'development'],
  ])('%s already there: kept, and named in the log', (line, value) => {
    const r = runFill(`${OTA_ENV}${line}\n`);
    expect(r.status, r.out).toBe(0);
    expect(nodeEnvLines(r.env), `the OTA stack's .env after the step:\n${r.out}`).toEqual([line]);
    expect(nodeEnvLines(r.persisted)).toEqual([line]);
    expect(r.out).not.toMatch(/wrote NODE_ENV/);
    expect(r.out).not.toMatch(/backfilled NODE_ENV/);
    expect(r.out).toContain(`kept: NODE_ENV=${value}`);
    if (value === 'development') {
      expect(r.out, 'a warning for the value the owner chose').not.toContain('::warning::');
    } else {
      // The only signal the owner gets when the OTA stack's .env says
      // production (managed.env.example has said it since 2026-07-19).
      expect(r.out).toContain('::warning::');
      expect(r.out).toContain('not development');
    }
  });
});

// ---------------------------------------------------------------------------
// The bring-up's advice when Compose cannot render without it
// ---------------------------------------------------------------------------

describe('the bring-up names the fix for a .env without NODE_ENV, not the secrets script', () => {
  // `load_env` (bootstrap-managed.sh) asks `docker compose config -q` first,
  // and on "required variable X is missing a value" advises
  // ensure-env-secrets.sh. NODE_ENV is a decision, not a secret: that script
  // never writes it, so the advice would send the operator round in a circle.
  const BOOTSTRAP = readFileSync(join(COMPOSE_DIR, 'bootstrap-managed.sh'), 'utf8');
  const at = BOOTSTRAP.indexOf('load_env() {');
  const loadEnv = BOOTSTRAP.slice(at, BOOTSTRAP.indexOf('\n}\n', at) + 3);

  function loadEnvWith(composeError: string): { status: number | null; out: string } {
    const dir = tempDir();
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    // Compose's own words when a `${VAR:?}` has no value, and nothing else.
    writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\necho '${composeError}' >&2\nexit 1\n`, { mode: 0o755 });
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'NODE_ENV=\n');
    // The checks load_env makes before it asks Compose have guards of their
    // own; here they pass.
    const helpers = [
      'note_env_divergence',
      'note_mail_goes_nowhere_real',
      'note_relay_to_nowhere',
      'note_status_page_probes_itself',
      'note_site_row_half_configured',
      'note_dashboard_on_this_machine_only',
      'refuse_a_bind_that_is_not_an_address',
    ].map((f) => `${f}() { :; }`);
    const script = [
      'die() { echo "!!! $*" >&2; exit 1; }',
      ...helpers,
      `ENV_FILE="${envFile}"`,
      'COMPOSE=(docker compose -f managed.yml)',
      loadEnv,
      'load_env',
    ].join('\n');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
      env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: dir },
      encoding: 'utf8',
      timeout: 30_000,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  it('found load_env', () => {
    expect(at, 'no load_env in bootstrap-managed.sh').toBeGreaterThan(-1);
  });

  it('NODE_ENV: both values and the plan, and not ensure-env-secrets.sh', () => {
    const r = loadEnvWith(
      'error while interpolating services.api.environment.NODE_ENV: required variable NODE_ENV is missing a value: set NODE_ENV in .env - production on live, development on a test stack (workplan 0132 T4)',
    );
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(/env-upsert\.sh \S+ NODE_ENV=production/);
    expect(r.out).toMatch(/env-upsert\.sh \S+ NODE_ENV=development/);
    expect(r.out).toContain('0132 T4');
    expect(r.out, 'the secrets script writes no mode').not.toContain('ensure-env-secrets.sh');
  });

  it('a secret that has no value still gets the secrets script', () => {
    const r = loadEnvWith(
      'error while interpolating services.pgbouncer.environment.PGBOUNCER_AUTH_PASSWORD: required variable PGBOUNCER_AUTH_PASSWORD is missing a value',
    );
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('ensure-env-secrets.sh');
    expect(r.out).not.toContain('NODE_ENV=production');
  });
});

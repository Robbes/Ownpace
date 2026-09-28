// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GATE THAT LEAVES THE ALPHA ALONE: the nightly managed gate wrote into
 * whichever persisted `.env` a repository variable named, and would have
 * written into live's (workplan 0132 T1g, D7).
 *
 * Since 2026-09-24 two stacks share the reference machine: the OTA stack,
 * which the nightly gate rebuilds from `main` with the demo, and
 * `ownpace-live`, which holds testers' data and moves only by hand, from a
 * tag (0132 D7). Each keeps its `.env` in a directory of its own outside any
 * checkout, and the gate finds the OTA stack's through
 * `MANAGED_ENV_PERSIST_DIR`, a repository variable anybody with access can
 * change. Pointed at live's directory by mistake, the gate would have copied
 * live's `.env` into its checkout and then written to it: `ensure-env-secrets.sh`
 * fills every key it finds missing, the backfill adds the example's defaults
 * and the gate's placeholder client pairs, and the copy-back writes the result
 * into that directory, which live's checkout links to. The bring-up after it
 * runs with `--with-demo`, on the project that `.env` names: live's. Nothing
 * in the gate asked whose `.env` it had restored. It has not happened; the
 * variable is one edit away from it.
 *
 * Live's `.env` carries a marker saying that the stack holds people's data,
 * `STACK_KIND=production`, named once in `deploy/compose/stack-kind.sh`. The
 * gate now asks `deploy/compose/refuse-live-env.sh` about the persisted file
 * before the restore copies anything out of that directory, so nothing of
 * live's reaches the checkout, the CLI login or the steps after it. Keyed on
 * the marker rather than on `WEB_URL`, because the OTA stack's `WEB_URL` is a
 * real https address too.
 *
 * WHAT IS ASSERTED, in two halves.
 *
 *   The script, run for real against `.env` files the test writes. It refuses
 *   live's marker and every slip of it that `stack_may_be_live` takes for live
 *   (a refusal errs towards live): other quotes, case and spacing, a value
 *   nobody listed as not live, a line the reader cannot read. It names the key
 *   and the variable, never prints a value from the file (the gate's log is
 *   public), and writes nothing. Its advice follows the variable: set, point it
 *   back; empty or unset, the refused file is the workflow's own default, the
 *   OTA stack's, so take the line out or list the kind as not live. It passes
 *   the OTA stack's `.env`, which does not carry the key. A missing file or no
 *   argument is an error, not a pass. And it spells the marker nowhere itself.
 *
 *   The gate, read as YAML and run. The restore step calls the script on the
 *   file it is about to copy, with `set -e` in force at the call (switched on
 *   before it, not switched off between) and nothing on its line that could
 *   swallow a refusal, before its first copy out of the persisted directory.
 *   The step's own `run:` block is also run, in a temp checkout under
 *   `bash -eo pipefail` as the runner runs it: on live's `.env` and on one slip
 *   of it the step exits non-zero and leaves no `deploy/compose/.env`, no
 *   `pgbouncer/userlist.txt` and no CLI login; on the OTA stack's `.env` it
 *   copies them. Every step that writes the checkout's `.env` or runs the
 *   bring-up comes after that step.
 *
 * T1's guard (`two-stacks-on-one-box`) fails if any workflow names live's
 * project, so no workflow can be pointed at live by its name either.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_REL = 'deploy/compose/refuse-live-env.sh';
const SCRIPT = join(REPO_ROOT, SCRIPT_REL);
const GATE_REL = '.github/workflows/e2e-managed.yml';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gate-alpha-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A value from elsewhere in the file, which must never reach the log either. */
const SENTINEL = 'sentinel-7c1f0e';

/** The OTA stack's .env, as the gate restores it: no marker, no project. */
const OTA_ENV = [
  'POSTGRES_USER=openmigrate',
  `POSTGRES_PASSWORD=${SENTINEL}`,
  'WEB_URL=https://app.example.test',
  'TRIGGER_PROJECT_REF=proj_example',
  '',
].join('\n');

function refuse(args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; out: string } {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env },
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function refuseFile(
  text: string,
  env: NodeJS.ProcessEnv = {},
): { status: number | null; out: string; before: string; after: string } {
  const file = join(tempDir(), '.env');
  writeFileSync(file, text);
  const r = refuse([file], env);
  return { ...r, before: text, after: readFileSync(file, 'utf8') };
}

// ---------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------

describe("refuse-live-env.sh refuses live's .env, and only live's", () => {
  // [the line, a word of its value that must not reach the log]
  const LIVE_FORMS: Array<[string, string]> = [
    ['STACK_KIND=production', 'production'],
    ["STACK_KIND='production'", 'production'],
    ['STACK_KIND="production"', 'production'],
    ['export STACK_KIND=production', 'production'],
    ['STACK_KIND=production   # set by the owner at bring-up', 'production'],
    ['STACK_KIND=Production', 'production'],
    ['STACK_KIND=" Production "', 'production'],
    // Slips of it. Any value stack-kind.sh does not list as not live is taken
    // for live's, and so is a line the reader cannot read.
    ['STACK_KIND=prodution', 'prodution'],
    ['STACK_KIND=alpha-stack', 'alpha-stack'],
    ["STACK_KIND='production '", 'production'],
    ['  STACK_KIND=production', 'production'],
    ['STACK_KIND = production', 'production'],
  ];

  it('exists', () => {
    expect(existsSync(SCRIPT), `${SCRIPT_REL} is the gate's refusal (0132 T1g)`).toBe(true);
  });

  it.each(LIVE_FORMS)('refuses a .env carrying `%s`, naming the key and never the value', (line, value) => {
    const r = refuseFile(`${OTA_ENV}${line}\n`);
    expect(r.status, `not refused:\n${r.out}`).not.toBe(0);
    expect(r.out).toContain('STACK_KIND');
    expect(r.out, 'the refusal says which variable to point back').toContain('MANAGED_ENV_PERSIST_DIR');
    expect(r.out.toLowerCase(), "the gate's log is public: a value from the file was printed").not.toContain(value);
    expect(r.out).not.toContain(SENTINEL);
    expect(r.after, 'a refusal writes nothing').toBe(r.before);
  });

  // The workflow always exports MANAGED_ENV_PERSIST_DIR, empty when the
  // repository variable is absent. Then the refused file is the workflow's own
  // default, the OTA stack's directory, and "point the variable back" would
  // send the operator to a variable that is not set.
  it('with MANAGED_ENV_PERSIST_DIR set, says to point it back', () => {
    const r = refuseFile(`${OTA_ENV}STACK_KIND=production\n`, { MANAGED_ENV_PERSIST_DIR: tempDir() });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("MANAGED_ENV_PERSIST_DIR points at live's directory");
  });

  it.each([
    ['empty', { MANAGED_ENV_PERSIST_DIR: '' }],
    ['unset', {}],
  ])(
    "with MANAGED_ENV_PERSIST_DIR %s, says the OTA stack's own .env carries the line, not to fix the variable",
    (_, env) => {
      const r = refuseFile(`${OTA_ENV}STACK_KIND=ota-sandbox\n`, env);
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).not.toContain("points at live's directory");
      expect(r.out).toContain('STACK_KINDS_NOT_LIVE');
      expect(r.out, 'a value from the file was printed').not.toContain('sandbox');
      expect(r.after).toBe(r.before);
    },
  );

  it("passes the OTA stack's .env, which does not carry the key", () => {
    const r = refuseFile(OTA_ENV);
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toContain(SENTINEL);
    expect(r.after).toBe(r.before);
  });

  it('passes a key left empty, which names no kind (stack_may_be_live)', () => {
    expect(refuseFile(`${OTA_ENV}STACK_KIND=\n`).status).toBe(0);
  });

  it('a missing file, or no file named, is an error and not a pass', () => {
    const missing = refuse([join(tempDir(), 'no-such.env')]);
    expect(missing.status).not.toBe(0);
    expect(missing.status).not.toBeNull();
    expect(refuse([]).status).not.toBe(0);
  });

  it('reads the marker from stack-kind.sh and spells it nowhere itself', () => {
    const text = readFileSync(SCRIPT, 'utf8');
    expect(text).toMatch(/^\. "\$\{SCRIPT_DIR\}\/stack-kind\.sh"$/m);
    expect(text).toMatch(/\bstack_may_be_live\b/);
    const code = text.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(
      code.filter((l) => /\bproduction\b/i.test(l) || /\bSTACK_KIND\b/.test(l)),
      'the marker is named once, in stack-kind.sh',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  'continue-on-error'?: unknown;
}
const gate = parseYaml(readFileSync(join(REPO_ROOT, GATE_REL), 'utf8')) as {
  jobs: Record<string, { steps: Step[] }>;
};
const steps = Object.values(gate.jobs).flatMap((j) => j.steps);
const label = (i: number): string => `step ${i} (${steps[i]?.name ?? steps[i]?.uses ?? steps[i]?.run?.slice(0, 40)})`;

const RESTORE = steps.findIndex((s) => s.name?.startsWith('Restore the one-time setup'));
const REFUSAL_CALL = /^\s*\.\/deploy\/compose\/refuse-live-env\.sh "\$\{PERSIST_DIR\}\/\.env"\s*$/;

/** A step that writes the checkout's .env, or runs something that does. */
const WRITES_ENV = [
  /ensure-env-secrets\.sh/,
  /bootstrap-managed\.sh/,
  /env-upsert\.sh/,
  /trigger-credentials\.sh/,
  />>?\s*"?deploy\/compose\/\.env/,
  /\b(?:cp|mv|install|tee|ln)\b[^\n]*deploy\/compose\/\.env/,
];

describe("the gate asks before anything of that directory's is copied or written", () => {
  it('found the restore step and the steps that write .env', () => {
    expect(RESTORE, `${GATE_REL} has no step named "Restore the one-time setup …"`).toBeGreaterThanOrEqual(0);
    const writers = steps.filter((s) => WRITES_ENV.some((re) => re.test(s.run ?? '')));
    // Vacuity: the backfill and the bring-up, at least.
    expect(writers.length).toBeGreaterThanOrEqual(2);
  });

  it('the restore step refuses the persisted .env before its first copy out of that directory', () => {
    const run = steps[RESTORE]?.run ?? '';
    const lines = run.split('\n');
    const call = lines.findIndex((l) => REFUSAL_CALL.test(l));
    expect(call, `the restore step does not run ${SCRIPT_REL} "\${PERSIST_DIR}/.env" on a line of its own`).toBeGreaterThanOrEqual(0);
    const firstCopy = lines.findIndex((l) => /\bcp\b[^\n]*\$\{PERSIST_DIR\}/.test(l));
    expect(firstCopy, 'the restore step copies nothing out of ${PERSIST_DIR}: the guard lost its landmark').toBeGreaterThanOrEqual(0);
    expect(call, "the refusal comes after a copy out of the persisted directory").toBeLessThan(firstCopy);
    // The file refused is the file copied.
    expect(lines[firstCopy]).toContain('cp "${PERSIST_DIR}/.env" deploy/compose/.env');
    // A refusal that does not stop the step is not one.
    const setE = lines.findIndex((l) => /^\s*set -[a-z]*e[a-z]*\b/.test(l));
    expect(setE, 'the restore step must run under set -e').toBeGreaterThanOrEqual(0);
    expect(setE).toBeLessThan(call);
    // …and nothing between switches it off again (`set +e`, `set +o errexit`).
    const errexitOff = lines
      .slice(setE + 1, call)
      .filter((l) => /^\s*set\s+(?:\+[a-z]*e[a-z]*|\+o\s+errexit)\b/.test(l));
    expect(errexitOff, 'set -e is switched off before the refusal, so a refusal no longer stops the step').toEqual([]);
    expect(steps[RESTORE]?.['continue-on-error'], 'a refusal the job continues past').toBeUndefined();
  });

  // Run, not read: a `set +e` before the call, or a wrapper that swallows its
  // exit, reads the same as the call above and still copies live's .env.
  // Runs the step's own `run:` as the runner does (bash -eo pipefail), in a
  // checkout holding what it sources and calls, with HOME and the persisted
  // directory in temp dirs.
  function restore(env: string): { status: number | null; out: string; home: string; checkout: string } {
    const checkout = tempDir();
    const home = tempDir();
    const persist = tempDir();
    mkdirSync(join(checkout, 'deploy/compose'), { recursive: true });
    for (const f of ['env-read.sh', 'stack-kind.sh', 'refuse-live-env.sh', 'managed.yml']) {
      copyFileSync(join(REPO_ROOT, 'deploy/compose', f), join(checkout, 'deploy/compose', f));
    }
    writeFileSync(join(persist, '.env'), env);
    writeFileSync(join(persist, 'userlist.txt'), `"openmigrate" "${SENTINEL}"\n`);
    writeFileSync(join(persist, 'trigger-cli-config.json'), '{}\n');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', steps[RESTORE]?.run ?? 'exit 99'], {
      cwd: checkout,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, MANAGED_ENV_PERSIST_DIR: persist },
      encoding: 'utf8',
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, home, checkout };
  }

  it.each(['STACK_KIND=production', 'STACK_KIND = production'])(
    'run for real on a persisted .env carrying `%s`, the restore step fails and copies nothing',
    (line) => {
      const r = restore(`${OTA_ENV}${line}\n`);
      expect(r.status, `the step went on:\n${r.out}`).not.toBe(0);
      expect(existsSync(join(r.checkout, 'deploy/compose/.env')), "live's .env reached the checkout").toBe(false);
      expect(existsSync(join(r.checkout, 'deploy/compose/pgbouncer/userlist.txt'))).toBe(false);
      expect(existsSync(join(r.home, '.config/trigger/config.json')), "live's CLI login was restored").toBe(false);
      expect(r.out).not.toContain(SENTINEL);
    },
  );

  it("run for real on the OTA stack's persisted .env, the restore step copies it (vacuity)", () => {
    const r = restore(OTA_ENV);
    expect(r.status, r.out).toBe(0);
    expect(readFileSync(join(r.checkout, 'deploy/compose/.env'), 'utf8')).toBe(OTA_ENV);
    expect(existsSync(join(r.checkout, 'deploy/compose/pgbouncer/userlist.txt'))).toBe(true);
    expect(existsSync(join(r.home, '.config/trigger/config.json'))).toBe(true);
  });

  it('every step that writes .env or runs the bring-up comes after the restore', () => {
    // The restore's own copy is the case above.
    const early = steps
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => i < RESTORE && WRITES_ENV.some((re) => re.test(s.run ?? '')))
      .map(({ i }) => label(i));
    expect(early, 'these write .env before the gate has asked whose it is').toEqual([]);
  });

  it('no step before the restore reads the persisted directory', () => {
    const early = steps
      .slice(0, RESTORE)
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => /PERSIST_DIR|\.persistent/.test(s.run ?? ''))
      .map(({ i }) => label(i));
    expect(early).toEqual([]);
  });
});

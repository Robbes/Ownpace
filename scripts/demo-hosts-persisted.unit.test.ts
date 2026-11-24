// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE DEMO'S ADMITTED HOSTS, PERSISTED (workplan 0160, T2b, 2026-11-24).
 *
 * The gate's Fill step copies the OTA stack's `.env` back to the persisted
 * directory BEFORE the bring-up. The bring-up's demo phase then adds
 * `OWNPACE_REACHABLE_HOSTS=nextcloud,stalwart` (`admit_demo_hosts`) to the
 * checkout's copy only. A hand-run `bootstrap-managed.sh --only app` from the
 * operator's checkout, which links the persisted file, recreated the api and
 * the worker without the key, and the OTA stack refused its own Nextcloud
 * until the next nightly. The step `Persist the demo's admitted hosts` writes
 * that one key back after the bring-up.
 *
 * WHAT IS ASSERTED. The gate holds the step, after `Bring the stack up`. Run
 * under `bash -eo pipefail` in a checkout of the scripts it calls: the
 * persisted `.env` gets the key once, with the checkout's value, its other
 * lines unchanged, twice in a row; an existing stale value is replaced; an
 * empty key in the checkout fails the step and writes nothing.
 *
 * A NAME ADDED BY HAND STAYS (the owner, 2026-11-24: *"in OTA/test we need to
 * keep being able to add the internal addressess"*). The OTA stack and a test
 * box may list names of their own beside the demo's two: a test server on a
 * private network, by a name the stack resolves (an address is never admitted
 * by the list, `reachableAddress`). Live's list stays empty, and
 * `stand-up-live.sh` and `deploy-live.sh` refuse it otherwise. So a run of the
 * gate must keep such a name: the restore copies the persisted `.env` in, the
 * Fill step never names the key (and Compose reads it with a default, so the
 * required-key backfill never writes it), the demo phase's `admit_demo_hosts`
 * adds only the demo's missing names, and the persist step writes the whole
 * list back. The restore, `admit_demo_hosts` and the persist step are run here
 * in that order, twice.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy/compose');
const GATE = parseYaml(readFileSync(join(REPO_ROOT, '.github/workflows/e2e-managed.yml'), 'utf8')) as {
  jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
};
const STEPS = Object.values(GATE.jobs).flatMap((j) => j.steps);
const BRING_UP = STEPS.findIndex((s) => s.name === 'Bring the stack up');
const PERSIST = STEPS.findIndex((s) => s.name === "Persist the demo's admitted hosts");
const PROJECT = /^name:\s*(\S+)/m.exec(readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8'))?.[1] ?? '';

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function aRunner(checkoutEnv: string, persistedEnv: string): { root: string; home: string; persisted: string } {
  const root = mkdtempSync(join(tmpdir(), 'demo-hosts-'));
  const home = mkdtempSync(join(tmpdir(), 'demo-hosts-home-'));
  tempDirs.push(root, home);
  const compose = join(root, 'deploy/compose');
  mkdirSync(compose, { recursive: true });
  for (const f of ['managed.yml', 'env-read.sh', 'env-upsert.sh', 'stack-kind.sh', 'refuse-live-env.sh']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
  }
  writeFileSync(join(compose, '.env'), checkoutEnv);
  const persistDir = join(home, '.persistent', PROJECT);
  mkdirSync(persistDir, { recursive: true });
  const persisted = join(persistDir, '.env');
  writeFileSync(persisted, persistedEnv);
  return { root, home, persisted };
}

function runStep(r: { root: string; home: string }, step = PERSIST): { status: number | null; out: string } {
  const p = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', STEPS[step]?.run ?? 'exit 99'], {
    cwd: r.root,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: r.home },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: p.status, out: `${p.stdout}${p.stderr}` };
}

const lines = (text: string, key: string): string[] => text.split('\n').filter((l) => l.startsWith(`${key}=`));

describe("the gate persists the demo's admitted hosts after the bring-up", () => {
  it('holds the step, after the bring-up', () => {
    expect(PROJECT).not.toBe('');
    expect(BRING_UP).toBeGreaterThanOrEqual(0);
    expect(PERSIST).toBeGreaterThan(BRING_UP);
  });

  it("writes the checkout's value into the persisted .env once, and leaves its other lines alone, twice in a row", () => {
    const r = aRunner(
      'NODE_ENV=development\nOWNPACE_REACHABLE_HOSTS=nextcloud,stalwart\n',
      '# the OTA stack\nNODE_ENV=development\nCIRRUX_OAUTH_CLIENT_ID=deployment-client\n',
    );
    for (let i = 0; i < 2; i++) {
      const run = runStep(r);
      expect(run.status, run.out).toBe(0);
    }
    const after = readFileSync(r.persisted, 'utf8');
    expect(lines(after, 'OWNPACE_REACHABLE_HOSTS')).toEqual(['OWNPACE_REACHABLE_HOSTS=nextcloud,stalwart']);
    expect(lines(after, 'CIRRUX_OAUTH_CLIENT_ID')).toEqual(['CIRRUX_OAUTH_CLIENT_ID=deployment-client']);
    expect(after).toContain('# the OTA stack\n');
  });

  it('replaces a stale value', () => {
    const r = aRunner('OWNPACE_REACHABLE_HOSTS=nextcloud,stalwart\n', 'OWNPACE_REACHABLE_HOSTS=nextcloud\n');
    const run = runStep(r);
    expect(run.status, run.out).toBe(0);
    expect(lines(readFileSync(r.persisted, 'utf8'), 'OWNPACE_REACHABLE_HOSTS')).toEqual([
      'OWNPACE_REACHABLE_HOSTS=nextcloud,stalwart',
    ]);
  });

  it('fails, and writes nothing, when the bring-up left the key empty', () => {
    const r = aRunner('OWNPACE_REACHABLE_HOSTS=\n', 'NODE_ENV=development\n');
    const run = runStep(r);
    expect(run.status).not.toBe(0);
    expect(run.out).toContain('left OWNPACE_REACHABLE_HOSTS empty');
    expect(readFileSync(r.persisted, 'utf8')).toBe('NODE_ENV=development\n');
  });
});

describe('a name added by hand on the OTA stack survives a run of the gate', () => {
  const RESTORE = STEPS.findIndex((st) => st.name?.startsWith('Restore the one-time setup') === true);
  const FILL = STEPS.findIndex((st) => st.name === 'Fill in everything the repo already knows how to supply');
  const BOOTSTRAP = readFileSync(join(COMPOSE_DIR, 'bootstrap-managed.sh'), 'utf8');
  const lift = (name: string): string => {
    const at = BOOTSTRAP.indexOf(`${name}() {`);
    return at < 0 ? '' : BOOTSTRAP.slice(at, BOOTSTRAP.indexOf('\n}\n', at) + 3);
  };

  /** The demo phase's `admit_demo_hosts`, against the checkout's `.env`, as the bring-up runs it. */
  function admit(r: { root: string }): { status: number | null; out: string } {
    const compose = join(r.root, 'deploy/compose');
    const program = [
      'set -euo pipefail',
      `SCRIPT_DIR="${compose}"`,
      `ENV_FILE="${join(compose, '.env')}"`,
      '. "${SCRIPT_DIR}/env-read.sh"',
      'note() { echo "    $*"; }',
      lift('env_get'),
      lift('admit_demo_hosts'),
      'admit_demo_hosts',
    ].join('\n');
    const p = spawnSync('bash', ['--noprofile', '--norc', '-c', program], { encoding: 'utf8', timeout: 30_000 });
    return { status: p.status, out: `${p.stdout}${p.stderr}` };
  }

  it('holds the steps it rides on, in this order', () => {
    expect(RESTORE).toBeGreaterThanOrEqual(0);
    expect(FILL).toBeGreaterThan(RESTORE);
    expect(BRING_UP).toBeGreaterThan(FILL);
    expect(PERSIST).toBeGreaterThan(BRING_UP);
    expect(lift('admit_demo_hosts'), 'admit_demo_hosts was not found').toContain('env-upsert.sh');
  });

  it('the Fill step never names the key, and Compose reads it with a default, so no backfill writes it', () => {
    expect(STEPS[FILL]?.run ?? '').not.toContain('OWNPACE_REACHABLE_HOSTS');
    const managed = readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8');
    expect(managed).not.toMatch(/\$\{OWNPACE_REACHABLE_HOSTS:\?/);
    expect(managed).toContain('${OWNPACE_REACHABLE_HOSTS:-}');
  });

  it('restored, kept by the demo phase, and written back: the hand-added name and the demo’s two, twice in a row', () => {
    const r = aRunner('', '# the OTA stack\nNODE_ENV=development\nOWNPACE_REACHABLE_HOSTS=files.example.test\n');
    for (let i = 0; i < 2; i++) {
      const restore = runStep(r, RESTORE);
      expect(restore.status, restore.out).toBe(0);
      const demo = admit(r);
      expect(demo.status, demo.out).toBe(0);
      const persist = runStep(r);
      expect(persist.status, persist.out).toBe(0);
    }
    const after = readFileSync(r.persisted, 'utf8');
    expect(lines(after, 'OWNPACE_REACHABLE_HOSTS')).toEqual(['OWNPACE_REACHABLE_HOSTS=files.example.test,nextcloud,stalwart']);
    expect(lines(after, 'NODE_ENV')).toEqual(['NODE_ENV=development']);
    expect(after).toContain('# the OTA stack\n');
  });
});

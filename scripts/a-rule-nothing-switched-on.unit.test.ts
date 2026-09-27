// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RULE THAT NOTHING SWITCHED ON REFUSED NOTHING (workplan 0136 T1 (a), third
 * slice, with T2).
 *
 * `@openmig/shared/reachable-host` refuses a host a tenant gives us when it
 * resolves inside this service's own network, and every client of a tenant's
 * host goes through it (#1223). But nothing switched it on: the managed API and
 * the managed tasks connected wherever a tester pointed them. It is on now in
 * both managed processes, with the operator's allow list,
 * `OWNPACE_REACHABLE_HOSTS`, and off in the appliance.
 *
 * WHAT THIS HOLDS:
 *
 * - the API's start-up switches it on, before it listens, where the other
 *   start-up checks run;
 * - every task module imports the task runtime's switch, which reads the list
 *   and switches the rule on as it loads;
 * - nothing the appliance runs switches it on, and nothing hands it the list;
 * - the list reaches both halves: the API through `managed.yml`, the tasks
 *   through `set-task-env.sh`, which also deletes it from the task store when
 *   it is emptied; `managed.env.example` documents it, empty;
 * - the demo phase of the bring-up admits the demo's two compose names, adding
 *   only what is missing, and the bring-up says what the list holds;
 * - the smoke asks the API for the demo Nextcloud by its compose name, which the
 *   list admits, not by the host-side address the rule refuses.
 *
 * It fails if either process stops switching the rule on, if a new task module
 * forgets the switch, or if the list stops reaching a half.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');
const NAME = 'OWNPACE_REACHABLE_HOSTS';

/** Every file under `dir`, recursively, as a path from the repository root. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(REPO_ROOT, dir))) {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist') continue;
    if (statSync(join(REPO_ROOT, path)).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

describe('the managed API switches the rule on at start-up', () => {
  const index = read('apps/api/src/index.ts');
  const boot = index.slice(index.indexOf("if (process.env.NODE_ENV !== 'test') {"));

  it('in the start-up block, before it listens, beside the other start-up checks', () => {
    expect(boot, 'the start-up block was not found').toContain('app.listen(');
    const at = boot.search(/^\s*const reachable = refuseInternalAddressesFromEnv\(\);$/m);
    expect(at, 'the start-up block does not switch the rule on').toBeGreaterThan(0);
    expect(at).toBeLessThan(boot.indexOf('app.listen('));
    expect(at).toBeGreaterThan(boot.indexOf('assertProductionAuthConfig();'));
    expect(index).toContain("import { refuseInternalAddressesFromEnv } from '@openmig/shared/reachable-host';");
  });
});

describe('the managed tasks switch the rule on as each task module loads', () => {
  const JOBS = 'apps/worker/src/jobs';
  const SWITCH = 'apps/worker/src/jobs/refuse-internal-addresses.ts';
  const taskModules = readdirSync(join(REPO_ROOT, JOBS))
    .filter((file) => file.endsWith('.ts') && !file.includes('.test.'))
    .map((file) => `${JOBS}/${file}`)
    .filter((path) => /\b(?:schemaTask|task|schedules\.task)\(/.test(read(path)));

  it('there are task modules to hold, the vacuity floor', () => {
    expect(taskModules.length).toBeGreaterThanOrEqual(14);
  });

  it.each(taskModules)('%s imports the switch', (path) => {
    expect(read(path)).toMatch(/^import '\.\/refuse-internal-addresses\.ts';$/m);
  });

  it('the switch reads the list and switches the rule on once', () => {
    const text = read(SWITCH);
    expect(text).toContain(`${NAME}: process.env.${NAME}`);
    expect(text).toContain('refuseInternalAddressesFromEnv(');
    expect(text).toContain('if (!refusesInternalAddresses())');
  });

  describe('loaded, as a run loads it', () => {
    const before = process.env[NAME];
    beforeEach(() => vi.resetModules());
    afterEach(() => {
      if (before === undefined) delete process.env[NAME];
      else process.env[NAME] = before;
    });

    it('the rule is on, admits a listed name and refuses an unlisted one', async () => {
      process.env[NAME] = 'nextcloud';
      const rule = await import('@openmig/shared/reachable-host');
      await import('../apps/worker/src/jobs/refuse-internal-addresses.ts');
      expect(rule.refusesInternalAddresses()).toBe(true);
      // An unlisted compose name is refused on its shape, before any lookup; a
      // listed one gets past the rule to the lookup, which here finds nothing.
      await expect(rule.reachableHost('stalwart')).rejects.toBeInstanceOf(rule.HostInsideOurNetwork);
      await expect(rule.reachableHost('127.0.0.1')).rejects.toBeInstanceOf(rule.HostInsideOurNetwork);
      const listed = await rule.reachableHost('nextcloud').catch((error: unknown) => error);
      expect(listed).not.toBeInstanceOf(rule.HostInsideOurNetwork);
    });

    it('a list it cannot read fails the module, naming the entry', async () => {
      process.env[NAME] = 'nextcloud,*.example.test';
      await expect(import('../apps/worker/src/jobs/refuse-internal-addresses.ts')).rejects.toThrow(
        '"*.example.test" is not a host name',
      );
    });
  });
});

describe('the appliance keeps the rule off', () => {
  it('nothing it runs switches the rule on', () => {
    for (const path of filesUnder('apps/selfhost/src')) {
      expect(read(path), path).not.toMatch(/refuseInternalAddresses/);
    }
  });

  it.each([
    'deploy/selfhost/compose.yml',
    'deploy/selfhost/compose.dev.yml',
    'deploy/selfhost/compose.pglite.yml',
    'deploy/selfhost/compose.drill.yml',
    'deploy/selfhost/selfhost.env.example',
    'apps/selfhost/Dockerfile',
  ])('%s is never handed the list', (path) => {
    expect(read(path)).not.toContain(NAME);
  });
});

describe('the list reaches both managed halves', () => {
  it("the API's environment in managed.yml", () => {
    expect(read('deploy/compose/managed.yml')).toContain(`${NAME}: \${${NAME}:-}`);
  });

  it('the tasks, through set-task-env.sh, which deletes it there when it is emptied', () => {
    const script = read('deploy/compose/set-task-env.sh');
    expect(script).toContain(`${NAME}="\${${NAME}:-}" \\`);
    expect(script).toMatch(new RegExp(`^\\s*"${NAME}",$`, 'm'));
    expect(script).toContain(`if (!process.env.${NAME}) {`);
    expect(script).toContain(`await envvars.del(ref, slug, "${NAME}");`);
  });

  it('managed.env.example documents it, empty, and names the upload', () => {
    const example = read('deploy/compose/managed.env.example');
    const at = example.search(new RegExp(`^${NAME}=$`, 'm'));
    expect(at, `${NAME}= is not in the example, empty`).toBeGreaterThan(0);
    expect(example.slice(Math.max(0, at - 1500), at)).toContain('set-task-env.sh');
  });
});

describe('the demo admits its own two names, and the bring-up says what the list holds', () => {
  const script = read('deploy/compose/bootstrap-managed.sh');
  const lift = (name: string): string => {
    const at = script.indexOf(`${name}() {`);
    return at < 0 ? '' : script.slice(at, script.indexOf('\n}\n', at) + 3);
  };
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'a-rule-nothing-switched-on-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Run admit_demo_hosts against an .env holding `line`, and answer the file after. */
  function admit(line: string | undefined): { status: number; out: string; env: string } {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, `SOMETHING_ELSE=kept\n${line === undefined ? '' : `${line}\n`}`);
    const program = [
      'set -euo pipefail',
      `SCRIPT_DIR="${join(REPO_ROOT, 'deploy/compose')}"`,
      `ENV_FILE="${envFile}"`,
      '. "${SCRIPT_DIR}/env-read.sh"',
      'note() { echo "    $*"; }',
      lift('env_get'),
      lift('admit_demo_hosts'),
      'admit_demo_hosts',
    ].join('\n');
    const r = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, env: readFileSync(envFile, 'utf8') };
  }

  it('is in the script, and the demo phase runs it before the demo is set up', () => {
    expect(lift('admit_demo_hosts'), 'the function was not found').toContain('env-upsert.sh');
    const demo = lift('phase_demo');
    expect(demo).toMatch(/^ {2}admit_demo_hosts$/m);
    expect(demo.indexOf('admit_demo_hosts')).toBeLessThan(demo.indexOf('setup-managed-demo.sh'));
  });

  it.each<[string, string | undefined, string]>([
    ['absent', undefined, 'nextcloud,stalwart'],
    ['empty', `${NAME}=`, 'nextcloud,stalwart'],
    ['holding one of the two', `${NAME}=nextcloud`, 'nextcloud,stalwart'],
    ['holding another name', `${NAME}=demo.example.test`, 'demo.example.test,nextcloud,stalwart'],
  ])('%s: the missing names are added, and the rest kept', (_what, line, after) => {
    const r = admit(line);
    expect(r.status, r.out).toBe(0);
    expect(r.env).toMatch(new RegExp(`^${NAME}=${after.replace(/\./g, '\\.')}$`, 'm'));
    expect(r.env).toContain('SOMETHING_ELSE=kept');
    expect(r.out).toContain(`now admits the demo's names: ${after}`);
  });

  it('holding both already: nothing is written', () => {
    const r = admit(`${NAME}=stalwart,nextcloud`);
    expect(r.status, r.out).toBe(0);
    expect(r.env).toContain(`${NAME}=stalwart,nextcloud\n`);
    expect(r.out).toContain("admits the demo's names: stalwart,nextcloud");
  });

  it('the bring-up says what the list holds, once the API is up', () => {
    const app = lift('phase_app');
    const said = app.indexOf(`(${NAME}): $(env_or ${NAME} none)`);
    expect(said, 'phase_app does not say what the list holds').toBeGreaterThan(0);
    expect(said).toBeGreaterThan(app.indexOf('note "up and healthy'));
  });
});

describe('the smoke asks for the demo Nextcloud by its compose name', () => {
  const smoke = read('deploy/compose/smoke-managed.sh');

  it('the URL the API and the tasks are given is the compose name, which the list admits', () => {
    expect(smoke).toMatch(/^nc_dav_url="http:\/\/nextcloud\/remote\.php\/dav"$/m);
    const test = smoke.indexOf('/api/migrations/test-connection');
    expect(test).toBeGreaterThan(0);
    expect(smoke.slice(test, test + 300)).toContain('--arg u "$nc_dav_url"');
  });

  it('the seed and the demo say their compose names need the list', () => {
    expect(read('apps/api/src/scripts/seed-managed.ts')).toContain(NAME);
    expect(read('deploy/compose/setup-managed-demo.sh')).toContain(`${NAME}=nextcloud,stalwart`);
  });
});

// Keep the path helper honest about where it reads from.
it('reads from the repository root', () => {
  expect(relative(REPO_ROOT, join(REPO_ROOT, 'scripts'))).toBe('scripts');
});

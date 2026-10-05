// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DEMO ON A REAL ADDRESS (workplan 0132 T5, the code that keeps the demo off live).
 *
 * `bootstrap-managed.sh --with-demo` provisions the demo mail and DAV
 * backends and seeds two demo organisations whose credentials are published
 * in this repository. Its own help said "a REAL deployment must not have" it,
 * and nothing stopped one: the flag was accepted on every stack, live's
 * included. `ownpace-live` holds testers' data (0132 D7), and a demo
 * organisation there is a door with a published key.
 *
 * Before D7 the refusal was to key on `WEB_URL` being a real address. That
 * would now stop the nightly gate, which brings the OTA stack up with the demo
 * every night at a real address. So it keys on live's marker instead
 * (`deploy/compose/stack-kind.sh`), and errs towards live the way every
 * refusal there does: `stack_may_be_live`, which also takes a slip of the
 * marker (another case, quotes, spaces, an indented line, any kind not listed
 * as not live) for live.
 *
 * WHAT IS ASSERTED. The real `bootstrap-managed.sh`, in a checkout of its own
 * with a `docker` stub that logs every call:
 *
 *   `--with-demo`, wherever it stands, on a `.env` carrying live's marker or a
 *   slip of it, exits 1 before its first `docker` call, names the key, never
 *   prints the value, and leaves the `.env` as it was;
 *   the same `.env` without `--with-demo` goes on to the phase it was asked
 *   for, and so does `--with-demo` on the OTA stack's `.env`, which does not
 *   carry the key at all (the nightly gate's case);
 *   without `--with-demo`, the demo phase runs neither `setup-managed-demo.sh`
 *   (which starts the demo's Stalwart and provisions its Nextcloud accounts)
 *   nor `seed-managed.sh`, on live's `.env` or the OTA stack's, and no other
 *   part of the script names either, or `setup-stalwart.sh`.
 *
 * That last case matters on every deploy, not only at a first bring-up:
 * `deploy-live.sh` runs `bootstrap-managed.sh --from data`, which passes
 * through the demo phase, and only the phase's own first `if` stops it there.
 * The demo's Stalwart is kept on the OTA stack and never on live (workplan
 * 0139, 2026-09-29); these cases are what hold the scripted half of that.
 * `setup-managed-demo.sh` run by hand is not refused on live's `.env` yet.
 *
 * The guard failed first: on `main` every refused case reached preflight. The
 * demo phase's cases were added on 2026-09-29, after a review found that
 * taking the phase's `return 0` out left every guard green; with it taken out,
 * both of their skip cases fail.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Every call logged; `compose version` and `info` answer, as a daemon would. */
const DOCKER_STUB = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >>"$STUB_LOG"
exit 0
`;
const TOOL_STUB = (name: string) => `#!/usr/bin/env bash
printf '${name} %s\\n' "$*" >>"$STUB_LOG"
[ "$1" = -v ] && echo 9.0.0
exit 0
`;

/** What the demo phase runs, in this order: the demo's Stalwart and Nextcloud accounts, then its two organisations. */
const DEMO_SCRIPTS = ['setup-managed-demo.sh', 'seed-managed.sh'] as const;

function checkout(dotEnv: string): { root: string; compose: string; log: string; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), 'demo-on-live-'));
  tempDirs.push(root);
  const compose = join(root, 'deploy', 'compose');
  mkdirSync(compose, { recursive: true });
  // What the script sources at its top, and the file its reader reads, and
  // what the demo phase writes the .env with.
  for (const f of ['bootstrap-managed.sh', 'env-read.sh', 'stack-kind.sh', 'own-addresses.sh', 'trigger-cli-lib.sh', 'env-upsert.sh', 'shipped-passwords.sh']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    chmodSync(join(compose, f), 0o755);
  }
  // The two the demo phase runs, each a stub that logs its call.
  for (const f of DEMO_SCRIPTS) {
    writeFileSync(join(compose, f), TOOL_STUB(f));
    chmodSync(join(compose, f), 0o755);
  }
  copyFileSync(join(COMPOSE_DIR, 'managed.yml'), join(compose, 'managed.yml'));
  writeFileSync(join(compose, '.env'), dotEnv);
  // preflight asks for installed dependencies.
  mkdirSync(join(root, 'node_modules'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const log = join(root, 'calls.log');
  writeFileSync(log, '');
  writeFileSync(join(bin, 'docker'), DOCKER_STUB);
  chmodSync(join(bin, 'docker'), 0o755);
  for (const tool of ['pnpm', 'openssl', 'curl']) {
    writeFileSync(join(bin, tool), TOOL_STUB(tool));
    chmodSync(join(bin, tool), 0o755);
  }
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: root,
    LANG: 'C',
    STUB_LOG: log,
  };
  return { root, compose, log, env };
}

function bootstrap(c: ReturnType<typeof checkout>, args: string[]) {
  const r = spawnSync(join(c.compose, 'bootstrap-managed.sh'), args, {
    encoding: 'utf8',
    env: c.env,
    cwd: c.root,
    timeout: 60_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const dockerCalls = (c: ReturnType<typeof checkout>): string[] =>
  readFileSync(c.log, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('docker '));

const demoCalls = (c: ReturnType<typeof checkout>): string[] =>
  readFileSync(c.log, 'utf8')
    .split('\n')
    .map((l) => l.split(' ')[0] ?? '')
    .filter((name) => (DEMO_SCRIPTS as readonly string[]).includes(name));

/**
 * Every function of a shell script that names `name` outside a comment line,
 * each once, in order; a name at the top level is `(top level)`.
 */
function callersOf(script: string, name: string): string[] {
  const callers: string[] = [];
  let fn = '(top level)';
  for (const line of script.split('\n')) {
    const head = /^([A-Za-z_][A-Za-z0-9_]*)\(\) \{(.*)$/.exec(line);
    if (head) fn = head[1] ?? fn;
    if (!/^\s*#/.test(line) && line.includes(name) && !callers.includes(fn)) callers.push(fn);
    if (line === '}' || /\}\s*$/.test(head?.[2] ?? '')) fn = '(top level)';
  }
  return callers;
}

const LIVE = 'COMPOSE_PROJECT_NAME=ownpace-live\nSTACK_KIND=production\nWEB_URL=https://app.example.test\n';
// The OTA stack's database passwords are its own since 2026-10-05: on a real
// address the bring-up refuses the ones this repository publishes (0132 T2).
const OTA_PASSWORDS = ['POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'CLICKHOUSE_PASSWORD', 'MINIO_ROOT_PASSWORD']
  .map((k, i) => `${k}=${`0f${i}e0f`.repeat(8)}\n`)
  .join('');
const OTA = `WEB_URL=https://app.example.test\n${OTA_PASSWORDS}`;

describe('--with-demo on a .env that is, or could be, live\'s is refused before anything runs', () => {
  const LIVE_LIKE: Array<[string, string]> = [
    ["live's marker exactly", LIVE],
    ['in capitals, quoted, with a space', LIVE.replace('STACK_KIND=production', 'STACK_KIND="Production "')],
    ['a kind stack-kind.sh does not list as not live', LIVE.replace('STACK_KIND=production', 'STACK_KIND=staging-q7')],
    ['indented, which the reader does not read', LIVE.replace('STACK_KIND=production', '  STACK_KIND=production')],
    ['with spaces around =', LIVE.replace('STACK_KIND=production', 'STACK_KIND = production')],
  ];
  const PLACES: string[][] = [
    ['--with-demo', '--only', 'preflight'],
    ['--only', 'preflight', '--with-demo'],
    ['--from', 'data', '--with-demo'],
    ['--with-demo'],
  ];

  it.each(LIVE_LIKE)('%s', (_label, dotEnv) => {
    for (const args of PLACES) {
      const c = checkout(dotEnv);
      const r = bootstrap(c, args);
      expect(r.status, `${args.join(' ')}:\n${r.out}`).toBe(1);
      expect(r.out).toContain('--with-demo');
      expect(r.out).toContain('STACK_KIND');
      expect(r.out).toMatch(/0132 T5/);
      expect(r.out, 'the value is never printed').not.toMatch(/staging-q7|"Production "/);
      expect(dockerCalls(c), `docker was called before the refusal (${args.join(' ')})`).toEqual([]);
      expect(r.out).not.toMatch(/=== \[preflight\]/);
      expect(readFileSync(join(c.compose, '.env'), 'utf8')).toBe(dotEnv);
    }
  });
});

describe('everything else goes on to the phase it asked for', () => {
  it("--with-demo on the OTA stack's .env, which does not carry the key: the nightly gate's own case", () => {
    const c = checkout(OTA);
    const r = bootstrap(c, ['--only', 'preflight', '--with-demo']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/=== \[preflight\]/);
    expect(r.out).not.toMatch(/refused/);
    expect(dockerCalls(c).length).toBeGreaterThan(0);
  });

  it("live's .env without --with-demo", () => {
    const c = checkout(LIVE);
    const r = bootstrap(c, ['--only', 'preflight']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/=== \[preflight\]/);
    expect(r.out).not.toMatch(/refused/);
  });

  it('no .env yet (a first bring-up that has not made one): nothing to take for live', () => {
    const c = checkout('');
    rmSync(join(c.compose, '.env'));
    const r = bootstrap(c, ['--only', 'preflight', '--with-demo']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/=== \[preflight\]/);
  });
});

describe('the list of refusals says so', () => {
  it("stack-kind.sh no longer calls bootstrap-managed.sh's refusal unbuilt", () => {
    const text = readFileSync(join(COMPOSE_DIR, 'stack-kind.sh'), 'utf8');
    const entry = /#\s+bootstrap-managed\.sh[^\n]*\n(?:#\s{20,}[^\n]*\n)*/.exec(text)?.[0] ?? '';
    expect(entry, 'stack-kind.sh lists bootstrap-managed.sh among its callers').not.toBe('');
    expect(entry).not.toMatch(/not built/);
    expect(readFileSync(join(COMPOSE_DIR, 'bootstrap-managed.sh'), 'utf8')).toMatch(/stack_may_be_live "\$ENV_FILE"/);
  });
});

describe('without --with-demo the demo phase starts nothing, on live or anywhere else', () => {
  it.each<[string, string]>([
    ["live's .env", LIVE],
    ["the OTA stack's .env", OTA],
  ])('%s: the phase says it skipped, and neither demo script runs', (_label, dotEnv) => {
    const c = checkout(dotEnv);
    const r = bootstrap(c, ['--only', 'demo']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/=== \[demo\] skipped/);
    expect(demoCalls(c), `the demo phase ran without --with-demo:\n${r.out}`).toEqual([]);
    expect(dockerCalls(c)).toEqual([]);
    expect(readFileSync(join(c.compose, '.env'), 'utf8')).toBe(dotEnv);
  });

  it("with --with-demo on the OTA stack's .env the same phase runs both, so the stubs are the ones it calls", () => {
    const c = checkout(OTA);
    const r = bootstrap(c, ['--only', 'demo', '--with-demo']);
    expect(r.status, r.out).toBe(0);
    expect(demoCalls(c)).toEqual([...DEMO_SCRIPTS]);
  });

  it('no other part of bootstrap-managed.sh names a demo script, or setup-stalwart.sh', () => {
    const script = readFileSync(join(COMPOSE_DIR, 'bootstrap-managed.sh'), 'utf8');
    for (const name of DEMO_SCRIPTS) expect(callersOf(script, name), name).toEqual(['phase_demo']);
    expect(callersOf(script, 'setup-stalwart.sh')).toEqual([]);
  });

  it('callersOf names the function a call stands in, passes over comments, and ends a one-line function', () => {
    const script = [
      'say() { echo "$1"; }',
      '"${D}/x.sh" --top',
      'a() {',
      '  # x.sh, in a comment',
      '}',
      'b() {',
      '  "${D}/x.sh"',
      '  "${D}/x.sh" again',
      '}',
      '',
    ].join('\n');
    expect(callersOf(script, 'x.sh')).toEqual(['(top level)', 'b']);
  });
});

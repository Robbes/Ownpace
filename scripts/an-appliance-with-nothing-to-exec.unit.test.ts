// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN APPLIANCE WITH NOTHING TO EXEC (workplan 0119 §3 item 12; the owner's
 * decision of 2026-11-03: the shell goes, the image and the compose
 * healthcheck together, in alpha.5).
 *
 * The self-host appliance (`apps/selfhost/Dockerfile`) ran on the Node image's
 * Debian, its package managers removed (0146 T12) and the Debian Essentials
 * nothing runs purged (alpha.4, §3 item 11), still with a shell, coreutils,
 * dpkg and apt. Since 2026-11-06 its runtime stage is the API's distroless
 * base at the API's digest: Node at `/nodejs/bin/node`, off the PATH, and
 * nothing else to run. Built on amd64 from one payload it is 71.6 MB of
 * compressed layers instead of 97.1 MB.
 *
 * What the image no longer has is what five things around it used, and each
 * fails on distroless without a word about the appliance:
 *
 * - `deploy/selfhost/compose.yml`'s healthcheck for `app` was `CMD-SHELL`,
 *   which Docker runs as `/bin/sh -c`: `app` reads *unhealthy* while it
 *   serves, its health log saying `exec: "/bin/sh": stat /bin/sh: no such
 *   file or directory` (measured 2026-11-06). The owner's decision names this
 *   one: it changes in the same release, and the CHANGELOG says so, because
 *   a self-hoster following `:edge` with an older `compose.yml` sees exactly
 *   that.
 * - The upgrade drill proved the released image wrote PGlite's directory with
 *   `exec app sh -c 'ls …'`.
 * - E2E (self-hosted) asked `exec app dpkg-query` about the purged Essentials.
 * - Release's verify job asked `/version` with `docker exec <name> node`, and
 *   distroless has no `node` on its PATH: it would have refused alpha.5's
 *   release (held in `a-release-page-with-no-sbom`).
 * - The appliance's README said `docker compose exec app sh` opens a shell.
 *
 * So this file holds:
 *
 * 1. The appliance's runtime stage is FROM the same distroless line as the
 *    API's runtime stage, one string, so the managed smoke's check that the
 *    API's Node is the `FROM node:` line's version (`api_node`) is this
 *    image's too; and on the Node major and Debian release of its build
 *    stage's Node image, whose x.y.z the Windows payload's node.exe ships.
 * 2. It has no RUN; it runs as `10001:10001`, by number, as every existing
 *    `appdata` volume expects (not distroless's `nonroot`, 65532); it sets
 *    HOME, which no passwd line gives that uid; it starts `/nodejs/bin/node`
 *    by its path as ENTRYPOINT with `start.mjs`, and its HEALTHCHECK is exec
 *    form on that path.
 * 3. Every compose file of the appliance gives `app` no `CMD-SHELL` or
 *    shell-string healthcheck, and none but exec form on `/nodejs/bin/node`;
 *    and no `command` or `entrypoint` that starts a shell or a bare `node`.
 * 4. Nothing in `deploy/`, `scripts/`, the workflows, `test/` or `docs/`
 *    (records aside) execs into the appliance's container anything but its
 *    Node by its absolute path, or a variable holding one: not a shell, not a
 *    bare `node`, not `/usr/local/bin/node`, not `dpkg-query`, `ls` or `cat`.
 *    The container is known by its service, `app`, and by the names the
 *    compose files give it.
 * 5. The drill finds the released image's Node by its path, either image's,
 *    and asks the state directory with it, run here against a stand-in docker.
 * 6. E2E (self-hosted)'s step right after the appliance starts asks the
 *    image's Node, by its path, which of the programs distroless lacks it has
 *    and its version, and stops on any it has, on a Node other than the
 *    `FROM node:` line's, and on an answer it cannot read. Run here against a
 *    stand-in docker, and its probe against this machine, which has a shell.
 * 7. The CHANGELOG names the compose healthcheck change and what a
 *    self-hoster does about it.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const APPLIANCE_DOCKERFILE = 'apps/selfhost/Dockerfile';
const API_DOCKERFILE = 'apps/api/Dockerfile';
const COMPOSE_DIR = 'deploy/selfhost';
const DRILL = 'scripts/upgrade-drill.sh';
const E2E = '.github/workflows/e2e.yml';
const NODE_PATH = '/nodejs/bin/node';
/** Where Node is on the images before alpha.5, which an older release still runs. */
const OLD_NODE_PATH = '/usr/local/bin/node';
/** uid and gid: every existing `appdata` volume is uid 10001's. */
const USER = '10001:10001';
const DISTROLESS = /^gcr\.io\/distroless\/nodejs(\d+)-debian(\d+):nonroot@sha256:[0-9a-f]{64}$/;

type Instruction = { op: string; args: string };
type Stage = { name: string; base: string; body: Instruction[] };

/** A Dockerfile's stages, comments dropped before continuations are joined, as Docker reads it. */
function stagesOf(text: string): Stage[] {
  const logical = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\\r?\n/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const out: Stage[] = [];
  for (const line of logical) {
    const [, keyword = '', args = ''] = /^(\S+)\s*(.*)$/.exec(line) ?? [];
    const op = keyword.toUpperCase();
    if (op === 'FROM') {
      const words = args.split(/\s+/).filter((w) => !w.startsWith('--'));
      const as = words.findIndex((w) => w.toUpperCase() === 'AS');
      out.push({ name: as >= 0 ? words[as + 1]! : String(out.length), base: words[0]!, body: [] });
      continue;
    }
    out.at(-1)?.body.push({ op, args });
  }
  return out;
}

/** The exec form's words, or null for the shell form (or JSON Docker would not take). */
function execForm(args: string): string[] | null {
  const t = args.trim();
  if (!t.startsWith('[')) return null;
  try {
    const words = JSON.parse(t) as unknown;
    return Array.isArray(words) && words.every((w) => typeof w === 'string') ? (words as string[]) : null;
  } catch {
    return null;
  }
}

/** The x.y.z of the first `FROM node:<x.y.z>-…` line, as E2E's step and the packager read it. */
function nodeLineVersion(text: string): string | undefined {
  return /^FROM\s+node:(\d+\.\d+\.\d+)-/m.exec(text)?.[1];
}

// ---------------------------------------------------------------------------
// 1 and 2. The image
// ---------------------------------------------------------------------------

describe('the appliance runs on the API\'s distroless line, with nothing to run but Node', () => {
  const stages = stagesOf(read(APPLIANCE_DOCKERFILE));
  const runtime = stages.at(-1)!;
  const one = (op: string) => runtime.body.filter((i) => i.op === op);

  it("its last stage is the runtime, FROM the API runtime's line, one string", () => {
    expect(runtime.name).toBe('runtime');
    expect(runtime.base, `${APPLIANCE_DOCKERFILE}: the runtime stage builds FROM ${runtime.base}`).toMatch(DISTROLESS);
    const api = stagesOf(read(API_DOCKERFILE)).at(-1)!;
    // One line in two files: the managed smoke asks the API's Node its
    // version on every run, and that answer is this image's only while the
    // digest is the same.
    expect(runtime.base, `${APPLIANCE_DOCKERFILE} and ${API_DOCKERFILE} run on different distroless images`).toBe(api.base);
  });

  it("on the Node major and Debian release of its build stage's Node image", () => {
    const [, nodeMajor, debian] = DISTROLESS.exec(runtime.base)!;
    const build = stages.filter((s) => s.base.startsWith('node:'));
    expect(build.length, 'no FROM node: stage to build on (vacuity)').toBeGreaterThan(0);
    for (const s of build) {
      const m = /^node:(\d+)\.\d+\.\d+-([a-z]+)-slim@sha256:[0-9a-f]{64}$/.exec(s.base);
      expect(m, `${s.base} is not node:<x.y.z>-<codename>-slim@sha256:<digest>`).not.toBeNull();
      expect(m![1], `the build stage's Node ${m![1]} and the runtime's ${nodeMajor} differ`).toBe(nodeMajor);
      expect({ trixie: '13' }[m![2]!], `${s.base}: which Debian is ${m![2]}? Name it here with the runtime's`).toBe(debian);
    }
    // The line the Windows payload's node.exe follows (package-appliance.mjs).
    expect(nodeLineVersion(read(APPLIANCE_DOCKERFILE)), `${APPLIANCE_DOCKERFILE} has no FROM node:<x.y.z>- line`).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has no RUN: there is no shell in it to run one', () => {
    expect(one('RUN').map((i) => i.args)).toEqual([]);
  });

  it(`runs as ${USER}, by number, the owner of every existing appdata volume, with HOME set`, () => {
    const user = one('USER');
    expect(user, 'the runtime names its USER once').toHaveLength(1);
    // Not distroless's `nonroot` (65532): the appliance's volumes and the
    // directories self-hosters bound in their place are uid 10001's
    // (apps/selfhost/src/index.ts's startup hint).
    expect(user[0]!.args.trim()).toBe(USER);
    // Distroless's /etc/passwd has no line for 10001, so Docker would set
    // HOME=/; the Node image's `appuser` had /app.
    expect(one('ENV').map((i) => i.args.trim())).toContain('HOME=/app');
    const owners = runtime.body
      .filter((i) => i.op === 'COPY' || i.op === 'ADD')
      .map((i) => /--chown=(\S+)/.exec(i.args)?.[1])
      .filter((o): o is string => o !== undefined);
    expect(owners.length, 'nothing is copied in as the appliance\'s (vacuity: /data is)').toBeGreaterThan(0);
    for (const owner of owners) expect([USER, '0', '0:0', 'root', 'root:root'], `--chown=${owner}`).toContain(owner);
  });

  it(`starts ${NODE_PATH} by its path, with start.mjs`, () => {
    const entrypoint = one('ENTRYPOINT');
    expect(entrypoint).toHaveLength(1);
    expect(execForm(entrypoint[0]!.args)).toEqual([NODE_PATH]);
    const cmd = one('CMD');
    expect(cmd).toHaveLength(1);
    expect(execForm(cmd[0]!.args)).toEqual(['start.mjs']);
  });

  it(`its HEALTHCHECK is exec form, on ${NODE_PATH}`, () => {
    const hc = one('HEALTHCHECK');
    expect(hc).toHaveLength(1);
    const command = /\bCMD\s+(.*)$/.exec(hc[0]!.args)?.[1];
    expect(command, `HEALTHCHECK ${hc[0]!.args}`).toBeDefined();
    const words = execForm(command!);
    expect(words, 'a shell-form HEALTHCHECK needs /bin/sh, which the image has not got').not.toBeNull();
    expect(words![0]).toBe(NODE_PATH);
  });
});

// ---------------------------------------------------------------------------
// 3. The compose files
// ---------------------------------------------------------------------------

type Service = { build?: { dockerfile?: string }; command?: unknown; entrypoint?: unknown; healthcheck?: { test?: unknown } };

/** Every compose file of the appliance, as Compose reads it: merge keys applied, `!reset` kept as a value. */
function composeFiles(): Array<{ file: string; services: Record<string, Service | null> }> {
  return readdirSync(join(ROOT, COMPOSE_DIR))
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => `${COMPOSE_DIR}/${f}`)
    .map((file) => ({
      file,
      services: ((parseYaml(read(file), { merge: true, logLevel: 'error' }) ?? {}) as { services?: Record<string, Service | null> }).services ?? {},
    }));
}

const SHELL = /^(?:\/(?:usr\/)?bin\/)?(?:sh|bash|dash|ash|zsh|busybox)$/;

/** What is wrong with a service's healthcheck test for this image; null when nothing is. */
function healthcheckProblem(test: unknown): string | null {
  if (test === undefined) return null;
  if (typeof test === 'string') return 'a string test is run with /bin/sh -c';
  if (!Array.isArray(test) || !test.every((w) => typeof w === 'string')) return `not a list of strings: ${JSON.stringify(test)}`;
  const [kind, program] = test as string[];
  if (kind === 'NONE') return null;
  if (kind === 'CMD-SHELL') return 'CMD-SHELL needs /bin/sh, which the distroless image has not got';
  if (kind !== 'CMD') return `${kind}: not CMD`;
  if (program !== NODE_PATH) return `CMD ${program}: the image has Node at ${NODE_PATH} and nothing else to run`;
  return null;
}

describe("the appliance's compose files ask its health, and start it, without a shell", () => {
  const files = composeFiles();
  const apps = files.flatMap(({ file, services }) => (services.app ? [{ file, app: services.app }] : []));

  it('finds the app service in compose.yml, built from the appliance Dockerfile, with a healthcheck (vacuity)', () => {
    const base = apps.find((a) => a.file === `${COMPOSE_DIR}/compose.yml`);
    expect(base?.app.build?.dockerfile).toBe(APPLIANCE_DOCKERFILE);
    expect(base?.app.healthcheck?.test, 'compose.yml gives app no healthcheck').toBeDefined();
  });

  it(`gives app a healthcheck that is exec form on ${NODE_PATH}, or none, in every file`, () => {
    for (const { file, app } of apps) {
      expect(healthcheckProblem(app.healthcheck?.test), `${file}: app's healthcheck ${JSON.stringify(app.healthcheck?.test)}`).toBeNull();
    }
  });

  it('starts no shell and no bare node as its command or entrypoint, in any file', () => {
    for (const { file, app } of apps) {
      for (const [key, value] of [['command', app.command], ['entrypoint', app.entrypoint]] as const) {
        if (value === undefined) continue;
        const words = typeof value === 'string' ? value.split(/\s+/) : (value as string[]);
        expect(SHELL.test(words[0] ?? ''), `${file}: app's ${key} ${JSON.stringify(value)} starts a shell`).toBe(false);
        expect(words[0], `${file}: app's ${key} ${JSON.stringify(value)}: node is not on the image's PATH`).not.toBe('node');
      }
    }
  });

  it('refuses the shapes that slip', () => {
    expect(healthcheckProblem(['CMD-SHELL', 'node -e "fetch(1)"'])).toMatch(/CMD-SHELL/);
    expect(healthcheckProblem('node -e "fetch(1)"')).toMatch(/sh -c/);
    expect(healthcheckProblem(['CMD', 'node', '-e', 'fetch(1)'])).toMatch(/CMD node/);
    expect(healthcheckProblem(['CMD', OLD_NODE_PATH, '-e', 'fetch(1)'])).toMatch(/CMD \/usr\/local\/bin\/node/);
    expect(healthcheckProblem(['CMD', NODE_PATH, '-e', 'fetch(1)'])).toBeNull();
    expect(healthcheckProblem(['NONE'])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. What execs into it
// ---------------------------------------------------------------------------

/** The files that run commands, or tell somebody to. Records quote what WAS run, and are left out. */
function commandFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, keep: RegExp, skip: (rel: string) => boolean = () => false) => {
    if (!existsSync(join(ROOT, dir))) return;
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (name === 'node_modules' || skip(rel)) continue;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, keep, skip);
      else if (keep.test(name)) out.push(rel);
    }
  };
  walk('deploy', /\.(sh|mjs|ya?ml|md|ps1)$/);
  // The guards hold stubs and mutated copies of what they refuse; not commands.
  walk('scripts', /\.(sh|mjs|ps1)$|^(?!.*\.test\.ts$).*\.ts$/);
  walk('.github/workflows', /\.ya?ml$/);
  walk('docs', /\.md$/, (rel) => rel === 'docs/workplans' || rel === 'docs/adr/history' || rel === 'docs/LESSONS.md');
  walk('test', /\.(?:ts|mjs|sh)$/);
  for (const f of readdirSync(ROOT)) if (f.endsWith('.md') && f !== 'CHANGELOG.md') out.push(f);
  return out;
}

/** The container names the appliance's compose files give `app`. */
function appContainers(): Set<string> {
  const names = new Set<string>();
  for (const { services } of composeFiles()) {
    const name = (services.app as { container_name?: string } | null)?.container_name;
    if (name) names.add(name);
  }
  return names;
}

/** Flags of `docker exec` and `docker compose exec|run` that take a value as the next word. */
const VALUE_FLAGS = new Set(['-e', '--env', '-u', '--user', '-w', '--workdir', '--index', '--name', '-l', '--label', '-p', '--publish', '-v', '--volume', '--entrypoint', '--env-file']);
const word = (t: string) => t.replace(/^[`'"(]+|[`'",;)]+$/g, '');

type Exec = { file: string; how: 'exec' | 'run'; line: string; program: string | undefined };

/** Every `docker exec`, `docker compose … exec` and `docker compose … run` into the appliance's container, in one file's text. */
function execsIn(file: string, text: string, containers: ReadonlySet<string>): Exec[] {
  const found: Exec[] = [];
  const joined = text.replace(/\\\r?\n/g, ' ');
  const lines = file.endsWith('.md') ? joined.split(/\n\s*\n/).map((b) => b.replace(/\n/g, ' ')) : joined.split('\n');
  for (const line of lines) {
    const tokens = line.split(/\s+/).filter(Boolean);
    tokens.forEach((raw, i) => {
      const t = word(raw);
      if (t !== 'exec' && t !== 'run') return;
      const before: string[] = [];
      for (let j = i - 1; j >= 0; j--) {
        const tj = tokens[j]!;
        if (/^(?:\||;|&&|\|\||\$\(|then|do|if)$/.test(tj) || tj.endsWith(';')) break;
        const sub = tj.lastIndexOf('$(');
        if (sub >= 0) {
          before.unshift(word(tj.slice(sub + 2)));
          break;
        }
        before.unshift(word(tj));
      }
      const compose = before.some((b) => b === 'compose' || /COMPOSE/.test(b));
      const docker = before.includes('docker');
      if (t === 'run' ? !compose : !(compose || docker)) return;
      let k = i + 1;
      while (k < tokens.length && word(tokens[k]!).startsWith('-')) k += VALUE_FLAGS.has(word(tokens[k]!)) ? 2 : 1;
      const target = tokens[k] === undefined ? '' : word(tokens[k]!);
      const ours = compose ? target === 'app' : containers.has(target);
      if (!ours) return;
      const program = tokens[k + 1] === undefined ? undefined : word(tokens[k + 1]!);
      found.push({ file, how: t, line: line.trim().slice(0, 240), program });
    });
  }
  return found;
}

/** What one exec into the appliance runs, if it is not something the image has. */
function refusal(e: Exec): string | null {
  const p = e.program;
  if (e.how === 'run') {
    // The image's ENTRYPOINT is node: what follows `run app` is node's argument.
    if (p === undefined) return null;
    if (SHELL.test(p) || p === 'node' || p === NODE_PATH || p === OLD_NODE_PATH) return `${p}: the image's ENTRYPOINT is ${NODE_PATH}, which would take it as a script`;
    return null;
  }
  if (p === NODE_PATH) return null;
  if (p !== undefined && /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(p)) return null;
  if (p !== undefined && SHELL.test(p)) return 'a shell: the distroless image has none';
  if (p === 'node') return `a bare node: it is not on the distroless image's PATH; run ${NODE_PATH}`;
  if (p === OLD_NODE_PATH) return `${OLD_NODE_PATH}: the image has Node at ${NODE_PATH} only (try both by a variable, as the drill does, for an older release)`;
  return `${p ?? 'nothing'}: the distroless image has Node at ${NODE_PATH} and nothing else to run`;
}

describe("nothing execs into the appliance's container but its Node, by its path", () => {
  const containers = appContainers();
  const execs = commandFiles().flatMap((f) => execsIn(f, read(f), containers));

  it("finds the drill's, E2E's and the docs' (vacuity)", () => {
    expect(containers.has('ownpace-selfhost-app'), 'compose.yml names its container').toBe(true);
    expect(execs.filter((e) => e.file === DRILL).map((e) => e.program)).toEqual(['$p', '$released_node']);
    expect(execs.filter((e) => e.file === E2E).map((e) => e.program)).toEqual([NODE_PATH]);
    expect(execs.some((e) => e.file === 'deploy/selfhost/README.md' && e.program === NODE_PATH)).toBe(true);
    expect(execs.some((e) => e.file === 'docs/selfhost-quickstart.md' && e.program === NODE_PATH)).toBe(true);
  });

  it('none runs a shell, a bare node, or anything but Node by its path', () => {
    const refused = execs.flatMap((e) => {
      const why = refusal(e);
      return why ? [`${e.file}: ${e.line}\n    ${why}`] : [];
    });
    expect(refused).toEqual([]);
  });

  it('refuses what ran before, and what reads like it', () => {
    const c = new Set(['ownpace-selfhost-app']);
    const refuse = (file: string, text: string) => execsIn(file, text, c).map(refusal);
    expect(refuse('x.sh', `"\${COMPOSE[@]}" exec -T app sh -c 'ls /data/state/pglite >/dev/null'`)).toEqual(['a shell: the distroless image has none']);
    expect(refuse('x.yml', 'said="$(docker compose $SELFHOST_COMPOSE_FILES exec -T app dpkg-query -W util-linux 2>&1)"')).toEqual([
      `dpkg-query: the distroless image has Node at ${NODE_PATH} and nothing else to run`,
    ]);
    expect(refuse('x.md', 'Then `docker compose exec app sh` opens a shell.')).toEqual(['a shell: the distroless image has none']);
    expect(refuse('x.sh', 'docker exec ownpace-selfhost-app node -e 1')).toEqual([`a bare node: it is not on the distroless image's PATH; run ${NODE_PATH}`]);
    expect(refuse('x.sh', 'docker compose -f deploy/selfhost/compose.yml run --rm app sh')[0]).toMatch(/ENTRYPOINT/);
    // Not the appliance: another stack's service, a compose `logs`.
    expect(refuse('x.sh', 'docker compose -f deploy/compose/managed.yml exec -T api sh')).toEqual([]);
    expect(refuse('x.sh', 'docker compose logs app')).toEqual([]);
    expect(refuse('x.sh', `docker compose exec -T app ${NODE_PATH} -e 1`)).toEqual([null]);
  });
});

// ---------------------------------------------------------------------------
// 5. The drill asks the released image with its own Node
// ---------------------------------------------------------------------------

/** Bash, with stdout and stderr together and the exit code. */
function bash(script: string, env: Record<string, string> = {}): { status: number | null; out: string } {
  const run = spawnSync('bash', ['-c', script], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

describe('the upgrade drill asks the released image which Node it has, then its state directory, with no shell', () => {
  const drill = read(DRILL);
  const start = drill.indexOf('released_node=""');
  const end = drill.indexOf('say "    released image wrote its PGlite state directory"');
  const block = drill.slice(start, end);

  /**
   * The block, against a stand-in docker that runs `$HAS` (else nothing) and
   * answers for the state directory with `$DIR`.
   */
  function drillWith(has: string, dir: 'yes' | 'no') {
    const tmp = mkdtempSync(join(tmpdir(), 'drill-node-'));
    try {
      const calls = join(tmp, 'calls');
      writeFileSync(calls, '');
      const stub = `docker() {
  printf '%s\\n' "$*" >>"$CALLS"
  case "$*" in
    *" exec -T app $HAS --version") echo v26.13.0 ;;
    *" exec -T app $HAS -e "*) [ "$DIR" = yes ] || { echo "Error: ENOENT: no such file or directory, scandir '/data/state/pglite'" >&2; return 1; } ;;
    *) echo "OCI runtime exec failed: exec failed: unable to start container process: exec: \\"$7\\": stat $7: no such file or directory" >&2; return 127 ;;
  esac
}`;
      const run = bash(
        ['set -euo pipefail', 'say() { printf "%s\\n" "$*"; }', 'fail() { printf "DRILL FAILED: %s\\n" "$*" >&2; exit 1; }', 'COMPOSE=(docker compose -p drill)', stub, block, 'echo DRILL-ASKED'].join('\n'),
        { CALLS: calls, HAS: has, DIR: dir },
      );
      return { ...run, calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  it('is there, in step 1, before the swap (vacuity)', () => {
    expect(start, `${DRILL} has no released_node block`).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(end).toBeLessThan(drill.indexOf('say "2/5'));
  });

  it(`asks ${NODE_PATH} on a distroless release, and reads the directory with it`, () => {
    const run = drillWith(NODE_PATH, 'yes');
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain('DRILL-ASKED');
    expect(run.calls.at(-1)).toBe(`compose -p drill exec -T app ${NODE_PATH} -e require('node:fs').readdirSync('/data/state/pglite')`);
  });

  it(`asks ${OLD_NODE_PATH} on a release before alpha.5`, () => {
    const run = drillWith(OLD_NODE_PATH, 'yes');
    expect(run.status, run.out).toBe(0);
    expect(run.calls[0]).toBe(`compose -p drill exec -T app ${NODE_PATH} --version`);
    expect(run.calls.at(-1)).toMatch(new RegExp(`exec -T app ${OLD_NODE_PATH.replaceAll('/', '\\/')} -e `));
  });

  it('fails, saying which, when no Node answers and when the directory is not there', () => {
    const none = drillWith('/nowhere/node', 'yes');
    expect(none.status).toBe(1);
    expect(none.out).toContain(`neither ${NODE_PATH} nor ${OLD_NODE_PATH} runs in the released appliance`);
    const empty = drillWith(NODE_PATH, 'no');
    expect(empty.status).toBe(1);
    expect(empty.out).toContain('the released image left no PGlite state directory');
  });

  it('execs no shell', () => {
    for (const run of [drillWith(NODE_PATH, 'yes'), drillWith(OLD_NODE_PATH, 'yes')]) {
      for (const call of run.calls) expect(call.split(' ')[6], call).toMatch(/^\/(?:nodejs|usr\/local)\/bin\/node$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. E2E (self-hosted) asks the appliance it started
// ---------------------------------------------------------------------------

describe('E2E (self-hosted) asks the appliance it started, with its Node by its path', () => {
  type Step = { name?: string; run?: string };
  const workflow = parseYaml(read(E2E)) as { jobs: Record<string, { steps?: Step[] }> };
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
  const name = 'The appliance has no shell or package manager, and the Node its Dockerfile names';
  const at = steps.findIndex((s) => s.name === name);
  const step = steps[at];
  const want = `v${nodeLineVersion(read(APPLIANCE_DOCKERFILE))}`;

  /** The step's script under `bash -e`, as the runner runs it, against a stand-in docker; its exit code, docker's calls and what it said. */
  function outcome(answer: { RC?: string; SAYS?: string; LOCAL_NODE?: string }) {
    const dir = mkdtempSync(join(tmpdir(), 'appliance-e2e-'));
    try {
      writeFileSync(join(dir, 'calls'), '');
      // With LOCAL_NODE, the probe runs on this machine's Node, on this
      // machine's filesystem; otherwise the stand-in says $SAYS and exits $RC.
      const stub = `docker() {
  printf '%s\\n' "$*" >>"$CALLS"
  if [ -n "\${LOCAL_NODE:-}" ]; then
    local a probe=""
    while [ $# -gt 0 ]; do a="$1"; shift; if [ "$a" = -e ]; then probe="$1"; break; fi; done
    "$LOCAL_NODE" -e "$probe"
    return
  fi
  printf '%s\\n' "$SAYS"
  return "$RC"
}`;
      const run = bash(`set -e\n${stub}\n${step!.run!}`, {
        SELFHOST_COMPOSE_FILES: '-f deploy/selfhost/compose.yml',
        CALLS: join(dir, 'calls'),
        RC: answer.RC ?? '0',
        SAYS: answer.SAYS ?? '',
        LOCAL_NODE: answer.LOCAL_NODE ?? '',
      });
      return { status: run.status, calls: readFileSync(join(dir, 'calls'), 'utf8'), out: run.out };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('right after it builds and starts the appliance (vacuity)', () => {
    expect(step?.run, `${E2E} has no step "${name}"`).toBeDefined();
    expect(steps[at - 1]?.name).toBe('Build + start the self-host appliance');
    expect(want).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it(`passes the distroless image's answer, asking app's ${NODE_PATH}`, () => {
    const run = outcome({ SAYS: `${want} -` });
    expect(run.status, run.out).toBe(0);
    expect(run.calls).toMatch(new RegExp(`^compose -f deploy/selfhost/compose\\.yml exec -T app ${NODE_PATH.replaceAll('/', '\\/')} -e const fs=`));
    expect(run.out).toContain(`runs Node ${want}`);
  });

  it('fails a program the image has, another Node, and an answer it cannot read, by name', () => {
    const present = outcome({ SAYS: `${want} /bin/sh,/usr/bin/dpkg-query` });
    expect(present.status, present.out).toBe(1);
    expect(present.out).toContain('::error::the appliance has /bin/sh, /usr/bin/dpkg-query');
    const other = outcome({ SAYS: 'v26.99.0 -' });
    expect(other.status, other.out).toBe(1);
    expect(other.out).toContain(`names ${want}`);
    for (const answer of [
      // An image from before alpha.5: no /nodejs/bin/node to exec.
      { RC: '126', SAYS: 'OCI runtime exec failed: exec failed: unable to start container process: exec: "/nodejs/bin/node": stat /nodejs/bin/node: no such file or directory' },
      { RC: '0', SAYS: '' },
      { RC: '0', SAYS: 'hello' },
      { RC: '0', SAYS: `${want} -\nand more` },
      { RC: '1', SAYS: `${want} -` },
    ]) {
      const run = outcome(answer);
      expect(run.status, `${answer.RC}: ${answer.SAYS}\n${run.out}`).toBe(1);
      expect(run.out).toContain("::error::the appliance's /nodejs/bin/node could not be asked");
    }
  });

  it('its probe finds the shell on a machine that has one', () => {
    // This machine is no distroless image: the probe itself, run on its Node,
    // must name /bin/sh, or the step could pass an image that has one.
    expect(existsSync('/bin/sh'), 'this machine has no /bin/sh to find').toBe(true);
    const run = outcome({ LOCAL_NODE: process.execPath });
    expect(run.status, run.out).toBe(1);
    expect(run.out).toMatch(/::error::the appliance has \/bin\/sh\b/);
  });
});

// ---------------------------------------------------------------------------
// 7. The release notes
// ---------------------------------------------------------------------------

describe('the CHANGELOG names the compose healthcheck change for a self-hoster', () => {
  it('in one entry: compose.yml, CMD-SHELL, /nodejs/bin/node, unhealthy, and to update the checkout', () => {
    const entries = read('CHANGELOG.md')
      .split(/\n(?=- \*\*|#)/)
      .map((e) => e.replace(/\s+/g, ' '));
    const entry = entries.find((e) => e.includes('compose.yml') && e.includes('CMD-SHELL') && e.includes(NODE_PATH));
    expect(entry, 'no CHANGELOG entry names compose.yml, CMD-SHELL and /nodejs/bin/node together').toBeDefined();
    expect(entry).toMatch(/unhealthy/);
    expect(entry).toMatch(/update the checkout/i);
    expect(entry).toContain('docs/selfhost-quickstart.md');
  });
});

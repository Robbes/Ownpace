// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN API IMAGE WITH NOTHING TO EXEC (workplan 0146 T13a, the readers first, and
 * T13, the switch).
 *
 * The managed API, the one container the internet reaches through the web
 * app's `/api`, ran on `node:24.22.1-trixie-slim` with its package managers
 * removed: Debian 13.7 with a shell, coreutils, perl, util-linux and ncurses,
 * and 43 high findings that Debian has no fix for (Trivy 0.76.1, 2026-10-25,
 * amd64 and arm64 alike). Its runtime stage is now
 * `gcr.io/distroless/nodejs24-debian13:nonroot` by digest: fourteen Debian
 * packages and Node, 0 critical and 0 high the same day. Its
 * `/nodejs/bin/node` was the trixie image's `/usr/local/bin/node`, byte for
 * byte (sha256 `e32e2d16…` amd64, `c8c57216…` arm64). The tasks copy Node out
 * of the Dockerfile's `FROM node:` line, and the two pins move apart, so the
 * smoke holds the API's Node to that line's version on every managed run (5).
 *
 * What the image no longer has is what everything around it used. Before
 * T13a, seven script sites read a variable out of the container with `docker
 * exec … printenv`, three probes ran a bare `node -e` there, and two docs told
 * the operator to `exec … printenv` or `exec … sh -c`. On distroless every one
 * of them fails: there is no shell and no `printenv`, and Node is at
 * `/nodejs/bin/node`, which is not on the image's PATH. A smoke whose first
 * read fails says "cannot read JWT_ISSUER"; a `deploy-live.sh` whose NODE_ENV
 * read fails says the deploy did not take. Neither is about the API. And
 * `deploy-live.sh` runs the copy the checkout had BEFORE it moves to the tag it
 * deploys, and the readers (T13a, sections 2 to 5) ship in the same release as
 * the switch (T13, section 1), alpha.3 (the owner's decision of 2026-10-26).
 * So the deploy from alpha.2 or earlier meets this image with a copy that asks
 * the old way: it says the deploy did not take, though the stack has moved,
 * and is run a second time from the checkout now at the tag (6).
 *
 * So this file holds:
 *
 * 1. The API Dockerfile's runtime stage is distroless by digest, on the Node
 *    major of its build stage, runs as a non-root uid that does NOT own what
 *    it copies (root does, and the stage it copies from makes every file
 *    readable by all and writable by root alone, last), has no RUN (nothing
 *    could run it), starts `/nodejs/bin/node` by its path as ENTRYPOINT, and
 *    its HEALTHCHECK is exec form on that path. Owning /app, as `appuser` did
 *    before T13, a compromised API could rewrite the code it loads at its next
 *    start; it needs no write there, and booted and served without one.
 * 2. Nothing in `deploy/`, `scripts/`, `test/`, the workflows or `docs/`
 *    (records aside: workplans, LESSONS.md, the CHANGELOG, ADR history) execs
 *    into the API container anything but Node by its absolute path,
 *    `/nodejs/bin/node`, or a variable holding one (the smoke's `api_node`
 *    tries `/usr/local/bin/node` too, for a stack rolled back to an older
 *    tag): not a shell, not `printenv`, not a bare `node`, and not
 *    `/usr/local/bin/node` by name, which this image has not got. A `compose
 *    run` of the api starts no shell, `printenv` or `node` either (the
 *    image's ENTRYPOINT is node already). The container is known by its
 *    service, by its name, by the id `"$(docker compose … ps -q api)"` gives
 *    (the form the docs' read-backs teach), and by a variable the same file
 *    sets to that id (the gate's `api_id`, the live scripts' `id`).
 * 3. A variable the API was started with is read from Docker, `docker
 *    container inspect`'s `.Config.Env`, which answers the same on this image
 *    and the Node images before it (a stack rolled back to an older tag). Never
 *    a bare `docker inspect`: given a name that is no container it falls
 *    through to the IMAGE compose built under that name, `<project>-api`, and
 *    answers with the image's ENV alone. The scripts' `api_env` is run here,
 *    against a stub docker, for its three answers; the smoke's `api_node` for
 *    each image's path.
 * 4. A compose service built from the API Dockerfile, in every compose file of
 *    its directory, has no `CMD-SHELL` healthcheck, no shell-string one, and
 *    no `command` or `entrypoint` that starts a shell, `printenv` or a bare
 *    `node`; a healthcheck or entrypoint runs `/nodejs/bin/node`.
 * 5. The smoke's preflights ask the API container's Node its version
 *    (`api_node`) and stop unless it is the `x.y.z` of the Dockerfile's `FROM
 *    node:` line (`dockerfile_node`). The distroless `nonroot` tag names no
 *    Node version and Trivy lists no Node runtime in either image, so nothing
 *    else would say that a Node security release reached the build stage and
 *    the tasks but not the API. Run here against a stub docker.
 * 6. Every procedure that deploys live says the deploy from alpha.2 or earlier
 *    to alpha.3 or later runs twice: the first run's last words, word for word
 *    as alpha.2's script prints them, and the two commands of the second
 *    (`a-deploy-from-a-named-tag` runs both runs). Those last words name the
 *    old exec, as output; section 2 reads that one line as output and nothing
 *    else.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const API_DOCKERFILE = 'apps/api/Dockerfile';
const NODE_PATH = '/nodejs/bin/node';
/** Where Node is on the images before T13, which a rollback still runs. */
const OLD_NODE_PATH = '/usr/local/bin/node';
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

/** The exec form's words, or null for the shell form. */
function execForm(args: string): string[] | null {
  const t = args.trim();
  if (!t.startsWith('[')) return null;
  return JSON.parse(t) as string[];
}

// ---------------------------------------------------------------------------
// 1. The image
// ---------------------------------------------------------------------------

describe('the API runtime is distroless, by digest', () => {
  const stages = stagesOf(read(API_DOCKERFILE));
  const runtime = stages.at(-1)!;
  const one = (op: string) => runtime.body.filter((i) => i.op === op);

  it('its last stage is the runtime, FROM distroless nodejs at the nonroot tag and a digest', () => {
    expect(runtime.name).toBe('runtime');
    expect(runtime.base, `${API_DOCKERFILE}: the runtime stage builds FROM ${runtime.base}`).toMatch(DISTROLESS);
  });

  it("on the Node major and the Debian release of the build stage's Node image", () => {
    const [, nodeMajor, debian] = DISTROLESS.exec(runtime.base)!;
    const build = stages.filter((s) => s.base.startsWith('node:'));
    expect(build.length, 'no FROM node: stage to build on (vacuity)').toBeGreaterThan(0);
    for (const s of build) {
      // node:24.22.1-trixie-slim@sha256:… — the major, and trixie is Debian 13.
      const m = /^node:(\d+)\.\d+\.\d+-([a-z]+)-slim@sha256:[0-9a-f]{64}$/.exec(s.base);
      expect(m, `${s.base} is not node:<x.y.z>-<codename>-slim@sha256:<digest>`).not.toBeNull();
      expect(m![1], `the build stage's Node ${m![1]} and the runtime's ${nodeMajor} differ`).toBe(nodeMajor);
      expect({ trixie: '13' }[m![2]!], `${s.base}: which Debian is ${m![2]}? Name it here with the runtime's`).toBe(debian);
    }
  });

  it('has no RUN: there is no shell in it to run one', () => {
    expect(one('RUN').map((i) => i.args)).toEqual([]);
  });

  it('copies only into /app, as root\'s, and runs as a uid that is not root and owns none of it', () => {
    const copies = runtime.body.filter((i) => i.op === 'COPY' || i.op === 'ADD');
    expect(copies.length, 'nothing copied into the runtime (vacuity)').toBeGreaterThan(0);
    const user = one('USER');
    expect(user, 'the runtime names its USER, not inheriting it unsaid').toHaveLength(1);
    const uid = user[0]!.args.trim().split(':')[0]!;
    expect(uid, 'USER is a number, so nothing resolves it from a passwd file').toMatch(/^\d+$/);
    expect(uid).not.toBe('0');
    for (const c of copies) {
      expect(c.args.split(/\s+/).at(-1), `${c.op} ${c.args}`).toMatch(/^\/app\/?$/);
      // Root's, as COPY makes it without --chown: the API reads its code and
      // writes nothing there, so it is given no way to rewrite what it loads.
      const chown = /--chown=(\S+)/.exec(c.args)?.[1];
      expect(chown === undefined || /^(?:0|root)(?::(?:0|root))?$/.test(chown), `${c.op} ${c.args}: /app would be ${chown}'s, which the API runs as or could`).toBe(true);
      expect(c.args, `${c.op} ${c.args}: a mode for /app is the source stage's, below`).not.toMatch(/--chmod=/);
    }
  });

  it('the stage it copies /app from makes it readable by all and writable by root alone, last', () => {
    // COPY keeps a file's mode, and a checkout made under a umask of 077 has
    // 0600 files, which a root-owned /app would keep from the API. So the
    // source stage sets the modes after everything that writes there.
    const sources = runtime.body.filter((i) => i.op === 'COPY').map((c) => /--from=(\S+)/.exec(c.args)?.[1]);
    expect(sources.length).toBeGreaterThan(0);
    for (const from of sources) {
      expect(from, 'the runtime copies /app out of a stage of this Dockerfile').toBeDefined();
      const stage = stages.find((s) => s.name === from);
      expect(stage, `no stage named ${from}`).toBeDefined();
      const writes = stage!.body.filter((i) => ['RUN', 'COPY', 'ADD'].includes(i.op));
      const last = writes.at(-1);
      expect(last?.op, `${from}: its last RUN, COPY or ADD`).toBe('RUN');
      // Alone, or the last command of that RUN (the install's, so the tree is
      // not copied up into a second layer).
      expect(last!.args, `${from}: its last RUN`).toMatch(/(?:^|&&\s*)chmod -R u=rwX,go=rX \/app$/);
    }
  });

  it(`starts ${NODE_PATH} by its path, and runs the API's entry with it`, () => {
    const entrypoint = one('ENTRYPOINT');
    expect(entrypoint).toHaveLength(1);
    expect(execForm(entrypoint[0]!.args)).toEqual([NODE_PATH]);
    const cmd = one('CMD');
    expect(cmd).toHaveLength(1);
    expect(execForm(cmd[0]!.args)).toEqual(['apps/api/src/index.ts']);
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
// 2. What execs into it
// ---------------------------------------------------------------------------

/** The files that run commands, or tell somebody to. Records quote what WAS run, and are left out. */
function commandFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, keep: RegExp, skip: (rel: string) => boolean = () => false) => {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs)) {
      const rel = `${dir}/${name}`;
      if (name === 'node_modules' || skip(rel)) continue;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, keep, skip);
      else if (keep.test(name)) out.push(rel);
    }
  };
  walk('deploy', /\.(sh|ya?ml|ps1)$/);
  // The guards hold stubs and mutated copies of what they refuse; not commands.
  walk('scripts', /\.(sh|mjs|ps1)$|^(?!.*\.test\.ts$).*\.ts$/);
  walk('.github/workflows', /\.ya?ml$/);
  walk('docs', /\.md$/, (rel) => rel === 'docs/workplans' || rel === 'docs/adr/history' || rel === 'docs/LESSONS.md');
  // The e2e helpers already exec into other services; one into the api would be
  // the same failure as anywhere else.
  walk('test', /\.(?:ts|mjs|sh)$/);
  for (const f of readdirSync(ROOT)) if (f.endsWith('.md') && f !== 'CHANGELOG.md') out.push(f);
  return out;
}

/**
 * The commands of one file, as lines a reader would type: shell continuations
 * joined, and in Markdown each paragraph or block as one line, since prose
 * wraps a command across lines.
 */
function logicalLines(file: string, text: string): string[] {
  const joined = text.replace(/\\\r?\n/g, ' ');
  if (!file.endsWith('.md')) return joined.split('\n');
  return joined.split(/\n\s*\n/).map((block) => block.replace(/\n/g, ' '));
}

/** Flags of `docker exec` and `docker compose exec|run` that take a value as the next word. */
const VALUE_FLAGS = new Set(['-e', '--env', '-u', '--user', '-w', '--workdir', '--index', '--name', '-l', '--label', '-p', '--publish', '-v', '--volume', '--entrypoint', '--env-file']);
const word = (t: string) => t.replace(/^[`'"(]+|[`'",;)]+$/g, '');
const SHELL = /^(?:\/(?:usr\/)?bin\/)?(?:sh|bash|dash|ash|zsh|busybox)$/;

/** The API container, by compose service or by name: `api`, `$API_CONTAINER`, `<project>-api` — never trigger-api. */
function isApi(target: string): boolean {
  return target === 'api' || /^\$\{?(?:SMOKE_)?API_CONTAINER\}?$/.test(target) || (/-api$/.test(target) && !/trigger-api$/.test(target));
}

/** The command substitution whose `$(` is at `open`: its text, and where its own `)` is. */
function substitutionAt(text: string, open: number): { inner: string; end: number } | null {
  let depth = 0;
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return { inner: text.slice(open + 2, i), end: i };
  }
  return null;
}

/** A substitution that asks Compose for the API container: a `ps` of the service `api` (`-q`, `--format '{{.ID}}'`), never trigger-api's. */
function asksForTheApi(inner: string): boolean {
  const words = inner.split(/\s+/).map(word);
  return words.includes('ps') && words.includes('api');
}

/**
 * The variables a file sets from such a substitution: `api_id=$(docker compose
 * … ps --format '{{.ID}}' api)`, `id="$("${COMPOSE[@]}" ps -q api)"`. An exec
 * into `"$api_id"` there is one into the API.
 */
function apiVariables(text: string): Set<string> {
  const vars = new Set<string>();
  const joined = text.replace(/\\\r?\n/g, ' ');
  for (const m of joined.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)=["']?\$\(/g)) {
    const sub = substitutionAt(joined, m.index + m[0].length - 2);
    if (sub && asksForTheApi(sub.inner)) vars.add(m[1]!);
  }
  return vars;
}

type Exec = { file: string; how: 'exec' | 'run'; line: string; program: string | undefined };

/**
 * The last words of the first run of the deploy from alpha.2 or earlier (6):
 * what alpha.2's `deploy-live.sh` prints when the distroless API cannot be
 * asked with `printenv`. The procedures quote it so that the owner expects it.
 */
const ALPHA2_SAYS = 'NODE_ENV: the api container could not be asked (docker compose exec -T api printenv NODE_ENV).';

/**
 * Every `docker exec`, `docker compose … exec` and `docker compose … run` into
 * the API container. In Markdown, the one quoted line above, whole and on one
 * line, is output the owner reads, not a command; anything else is scanned.
 */
function execsIntoTheApi(): Exec[] {
  return commandFiles().flatMap((file) => execsIn(file, file.endsWith('.md') ? read(file).replaceAll(ALPHA2_SAYS, '') : read(file)));
}

/**
 * The execs into the API container in one file's text. The container is named
 * as `isApi` knows it, by the container id the docs teach (`"$(docker compose
 * -f deploy/compose/managed.yml ps -q api)"`, read to its own `)`, the program
 * after it), or by a variable the same file sets to that id (`apiVariables`).
 */
function execsIn(file: string, text: string): Exec[] {
  const found: Exec[] = [];
  const vars = apiVariables(text);
  for (const line of logicalLines(file, text)) {
    const tokens = line.split(/\s+/).filter(Boolean);
    tokens.forEach((raw, i) => {
      const t = word(raw);
      if (t !== 'exec' && t !== 'run') return;
      // Back to where this command started, for its docker or compose.
      const before: string[] = [];
      for (let j = i - 1; j >= 0; j--) {
        const tj = tokens[j]!;
        if (/^(?:\||;|&&|\|\||\$\(|then|do)$/.test(tj) || tj.endsWith(';')) break;
        // `x="$(docker` starts a command inside the word.
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
      let program = tokens[k + 1] === undefined ? undefined : word(tokens[k + 1]!);
      if (target.startsWith('$(')) {
        // The id by its substitution: up to its own `)`, whatever it spans.
        const rest = tokens.slice(k).join(' ');
        const sub = substitutionAt(rest, rest.indexOf('$('));
        if (!sub || !asksForTheApi(sub.inner)) return;
        const next = rest.slice(sub.end + 1).replace(/^\S*/, '').trim().split(/\s+/)[0];
        program = next ? word(next) : undefined;
      } else if (!isApi(target) && !vars.has(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(target)?.[1] ?? '')) return;
      found.push({ file, how: t, line: line.trim().slice(0, 240), program });
    });
  }
  return found;
}

/** What one exec into the API runs, if it is not something the image has. */
function refusal(e: Exec): string | null {
  const p = e.program;
  if (e.how === 'run') {
    if (p === undefined) return null;
    if (SHELL.test(p)) return 'a shell: the distroless image has none';
    if (/(^|\/)printenv$/.test(p)) return 'printenv: the distroless image has none';
    if (p === 'node' || p === NODE_PATH || p === OLD_NODE_PATH) return "node again: the distroless image's ENTRYPOINT is node already";
    return null;
  }
  if (p === NODE_PATH) return null;
  if (p === OLD_NODE_PATH) return `${OLD_NODE_PATH}: the distroless image has Node at ${NODE_PATH} only; a rolled-back stack is covered by api_node's $p fallback`;
  if (p !== undefined && /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(p)) return null;
  if (p !== undefined && SHELL.test(p)) return 'a shell: the distroless image has none';
  if (p !== undefined && /(^|\/)printenv$/.test(p)) return "printenv: the distroless image has none; read the variable with `docker container inspect`'s .Config.Env";
  if (p === 'node') return `a bare node: it is not on the distroless image's PATH; run ${NODE_PATH}`;
  return `${p ?? 'nothing'}: the distroless image has Node at ${NODE_PATH} and nothing else to run`;
}

describe('nothing execs into the API container but Node, by its path', () => {
  const execs = execsIntoTheApi();

  it("finds the smoke's probes and the doc's recipe (vacuity)", () => {
    const smoke = execs.filter((e) => e.file === 'deploy/compose/smoke-managed.sh');
    // Three probes through $API_NODE, and api_node trying each path.
    expect(smoke.filter((e) => e.program === '$API_NODE').length).toBe(3);
    expect(smoke.some((e) => e.program === '$p')).toBe(true);
    expect(execs.some((e) => e.file === 'docs/managed-bring-up.md' && e.program === NODE_PATH)).toBe(true);
    expect(execs.some((e) => e.file === 'docs/TROUBLESHOOTING.md' && e.how === 'run')).toBe(true);
  });

  it('none runs a shell, printenv, a bare node, or anything else the image has not got', () => {
    const offenders = execs.flatMap((e) => {
      const why = refusal(e);
      return why ? [`${e.file}: ${why}\n    ${e.line}`] : [];
    });
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the scan refuses the forms T13a removed (the reader still reads them)', () => {
    const sample = (program: string, how: 'exec' | 'run' = 'exec'): Exec => ({ file: 'x', how, line: '', program });
    expect(refusal(sample('printenv'))).toMatch(/printenv/);
    expect(refusal(sample('sh'))).toMatch(/shell/);
    expect(refusal(sample('/bin/sh'))).toMatch(/shell/);
    expect(refusal(sample('node'))).toMatch(/bare node/);
    // The Node image's path by name: this image has not got it.
    expect(refusal(sample(OLD_NODE_PATH))).toMatch(/Node at \/nodejs\/bin\/node only/);
    expect(refusal(sample(NODE_PATH))).toBeNull();
    expect(refusal(sample('true'))).toMatch(/nothing else/);
    expect(refusal(sample('sh', 'run'))).toMatch(/shell/);
    expect(isApi('trigger-api')).toBe(false);
    expect(isApi('$API_CONTAINER')).toBe(true);
    expect(isApi('ownpace-live-api')).toBe(true);
  });

  it('the scan knows the API by the container id the docs and the gate now use, and refuses a reader there', () => {
    const programs = (file: string, text: string) => execsIn(file, text).map((e) => [e.program, refusal(e)]);
    // The docs' form, the id by its substitution.
    expect(programs('docs/x.md', 'Run `docker exec "$(docker compose -f deploy/compose/managed.yml ps -q api)" printenv NODE_ENV` there.\n')).toEqual([
      ['printenv', expect.stringMatching(/printenv/)],
    ]);
    // The gate's and the live scripts' form, a variable set to the id, lines apart.
    const gate = `api_id=$(docker compose $MANAGED_COMPOSE ps --format '{{.ID}}' api)\necho "$api_id"\ndocker exec "$api_id" printenv NODE_ENV\n`;
    expect(programs('x.yml', gate)).toEqual([['printenv', expect.stringMatching(/printenv/)]]);
    const live = `  local id\n  id="$("\${COMPOSE[@]}" ps -q api)" || return 2\n  docker exec "\${id}" sh -c true\n`;
    expect(programs('x.sh', live)).toEqual([['sh', expect.stringMatching(/shell/)]]);
    // trigger-api's id, by either form, is not the API's.
    expect(execsIn('x.sh', 'docker exec "$(docker compose ps -q trigger-api)" sh\nid=$(docker compose ps -q trigger-api)\ndocker exec "$id" sh\n')).toEqual([]);
    // What the gate and the live scripts set (vacuity: the scan would see their execs).
    expect(apiVariables(read('.github/workflows/e2e-managed.yml')).has('api_id')).toBe(true);
    for (const f of ['deploy/compose/deploy-live.sh', 'deploy/compose/stand-up-live.sh']) expect(apiVariables(read(f)).has('id'), f).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Reading what it was started with
// ---------------------------------------------------------------------------

const ENV_READERS = ['deploy/compose/smoke-managed.sh', 'deploy/compose/deploy-live.sh', 'deploy/compose/stand-up-live.sh'];

/** One shell function's text, out of a script. */
function functionOf(file: string, name: string): string {
  const m = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, 'm').exec(read(file));
  if (!m) throw new Error(`${file} defines no ${name}()`);
  return m[0];
}

/** A docker on PATH that answers `container inspect`, `compose ps -q api` and `exec`, from the environment. */
const DOCKER_STUB = `#!/usr/bin/env bash
if [ "$1" = compose ]; then
  shift
  [ "$1" = ps ] && [ "$2" = -q ] && [ "$3" = api ] || { echo "stub: compose $*" >&2; exit 97; }
  [ -z "\${STUB_NO_API:-}" ] || exit 0
  echo api-id
  exit 0
fi
if [ "$1" = container ] && [ "$2" = inspect ]; then
  [ "$3" = --format ] && [ "$4" = '{{range .Config.Env}}{{println .}}{{end}}' ] || { echo "stub: $*" >&2; exit 96; }
  [ -z "\${STUB_GONE:-}" ] || { echo "Error: No such container: $5" >&2; exit 1; }
  printf '%s\\n' 'PATH=/usr/local/sbin:/usr/local/bin' 'JWT_ISSUER=' 'DIRECT_DATABASE_URL=postgresql://u:p@postgres:5432/db?sslmode=disable&x=y' 'NODE_ENV=production' ''
  exit 0
fi
if [ "$1" = exec ]; then
  [ "$4" = --version ] || { echo "stub: exec $*" >&2; exit 95; }
  [ "$3" = "\${STUB_NODE:-none}" ] || { echo "OCI runtime exec failed: stat $3: no such file or directory" >&2; exit 127; }
  echo "\${STUB_NODE_VERSION:-v24.22.1}"
  exit 0
fi
echo "stub: $*" >&2
exit 98
`;

function withStub<T>(fn: (bin: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'api-env-'));
  try {
    writeFileSync(join(dir, 'docker'), DOCKER_STUB);
    chmodSync(join(dir, 'docker'), 0o755);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runFn(bin: string, fnText: string, call: string, env: Record<string, string> = {}) {
  const script = `set -uo pipefail\nAPI_CONTAINER=ownpace-managed-api\nCOMPOSE=(docker compose)\n${fnText}\n${call}\n`;
  return spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, ...env } });
}

describe("a variable the API was started with is read from Docker's view of the container", () => {
  it.each(ENV_READERS)('%s reads it with `docker container inspect`, three answers apart', (file) => {
    const fn = functionOf(file, 'api_env');
    expect(fn).toContain("docker container inspect --format '{{range .Config.Env}}{{println .}}{{end}}'");
    withStub((bin) => {
      const set = runFn(bin, fn, 'api_env DIRECT_DATABASE_URL');
      expect(set.status, set.stderr).toBe(0);
      // Everything after the first '=': a URL's own '=' signs stay.
      expect(set.stdout).toBe('postgresql://u:p@postgres:5432/db?sslmode=disable&x=y\n');
      const empty = runFn(bin, fn, 'api_env JWT_ISSUER');
      expect([empty.status, empty.stdout]).toEqual([0, '\n']);
      const unset = runFn(bin, fn, 'api_env JWT_AUDIENCE');
      expect([unset.status, unset.stdout]).toEqual([1, '']);
      // A prefix is not the name.
      expect(runFn(bin, fn, 'api_env NODE').status).toBe(1);
      expect(runFn(bin, fn, 'api_env NODE_ENV', { STUB_GONE: '1' }).status).toBe(2);
    });
  });

  it('the live scripts find the container through Compose, and no container is not "not set"', () => {
    for (const file of ['deploy/compose/deploy-live.sh', 'deploy/compose/stand-up-live.sh']) {
      const fn = functionOf(file, 'api_env');
      expect(fn).toMatch(/"\$\{COMPOSE\[@\]\}" ps -q api/);
      withStub((bin) => {
        // Why it could not, on stderr: "could not be asked" alone sends the
        // owner looking. Docker's words name containers, never a value.
        const none = runFn(bin, fn, 'api_env NODE_ENV', { STUB_NO_API: '1' });
        expect([none.status, none.stdout], file).toEqual([2, '']);
        expect(none.stderr, file).toMatch(/no api container/);
        const gone = runFn(bin, fn, 'api_env NODE_ENV', { STUB_GONE: '1' });
        expect([gone.status, gone.stdout], file).toEqual([2, '']);
        expect(gone.stderr, file).toMatch(/No such container: api-id/);
      });
      expect(fn, `${file}: Docker's errors are thrown away`).not.toMatch(/2>\s*\/dev\/null/);
    }
  });

  it('nothing reads a container environment with a bare `docker inspect`', () => {
    const offenders = commandFiles().filter((f) => /docker inspect\b[^\n]*\.Config\.Env/.test(read(f)));
    expect(offenders, 'a bare docker inspect answers with the IMAGE when the container is gone').toEqual([]);
  });

  it('the managed gate reads DIRECT_DATABASE_URL that way too', () => {
    const wf = read('.github/workflows/e2e-managed.yml');
    expect(wf).toMatch(/docker container inspect --format '\{\{range \.Config\.Env\}\}\{\{println \.\}\}\{\{end\}\}' "\$api_id"/);
    expect(wf).toMatch(/sed -n 's\/\^DIRECT_DATABASE_URL=\/\/p' <<<"\$api_env"/);
  });
});

describe("the smoke's api_node finds Node on either image, and the version it gives", () => {
  const fn = functionOf('deploy/compose/smoke-managed.sh', 'api_node');

  it.each([NODE_PATH, OLD_NODE_PATH])('an image with Node at %s', (where) => {
    withStub((bin) => {
      const r = runFn(bin, fn, 'api_node', { STUB_NODE: where, STUB_NODE_VERSION: 'v24.99.7' });
      expect([r.status, r.stdout]).toEqual([0, `${where} v24.99.7\n`]);
    });
  });

  it('neither: nothing, and exit 1, which stops the preflights', () => {
    withStub((bin) => {
      const r = runFn(bin, fn, 'api_node');
      expect([r.status, r.stdout]).toEqual([1, '']);
    });
    expect(read('deploy/compose/smoke-managed.sh')).toMatch(/API_NODE_FOUND="\$\(api_node\)" \|\| \{\n\s+echo "FATAL:/);
  });
});

// ---------------------------------------------------------------------------
// 5. The API's Node is the Dockerfile's FROM node line's
// ---------------------------------------------------------------------------

describe("the smoke stops when the API's Node is not the FROM node line's version", () => {
  const SMOKE = 'deploy/compose/smoke-managed.sh';
  const fns = `${functionOf(SMOKE, 'api_node')}\n${functionOf(SMOKE, 'dockerfile_node')}`;
  /** The preflights from `api_node` to the line that says they passed. */
  const block = /^API_NODE_FOUND="\$\(api_node\)"[\s\S]*?^echo "preflights OK[^\n]*\n/m.exec(read(SMOKE))?.[0];
  const fromNode = /^FROM\s+node:(\d+\.\d+\.\d+)-/m.exec(read(API_DOCKERFILE))?.[1];

  const run = (bin: string, env: Record<string, string>, root = ROOT) =>
    runFn(bin, `REPO_ROOT='${root}'\n${fns}`, block!, { STUB_NODE: NODE_PATH, ...env });

  it("finds the block and the Dockerfile's version (vacuity)", () => {
    expect(block, `${SMOKE}: no preflight block from API_NODE_FOUND to "preflights OK"`).toBeDefined();
    expect(fromNode, `${API_DOCKERFILE}: no FROM node:<x.y.z>- line`).toBeDefined();
    expect(withStub((bin) => runFn(bin, `REPO_ROOT='${ROOT}'\n${fns}`, 'dockerfile_node').stdout)).toBe(`v${fromNode}\n`);
  });

  // The Node image the API runs on before T13 (and on a rollback past it), and
  // the distroless one: the same check, by whichever path runs.
  it.each([OLD_NODE_PATH, NODE_PATH])('the same version, Node at %s: the preflights pass, and say which', (where) => {
    withStub((bin) => {
      const r = run(bin, { STUB_NODE: where, STUB_NODE_VERSION: `v${fromNode}` });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toContain(`${where} v${fromNode} runs in the API container, the Dockerfile's Node`);
    });
  });

  it.each([OLD_NODE_PATH, NODE_PATH])('another version, Node at %s: FATAL, with both named, and exit 1', (where) => {
    withStub((bin) => {
      const r = run(bin, { STUB_NODE: where, STUB_NODE_VERSION: 'v24.0.0' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(`FATAL: the API container's ${where} is v24.0.0`);
      expect(r.stdout).toContain(`is v${fromNode}`);
      expect(r.stdout).not.toContain('preflights OK');
    });
  });

  it('a Dockerfile with no FROM node line: FATAL, never a pass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'api-dockerfile-'));
    try {
      writeFileSync(join(dir, 'Dockerfile'), 'FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime\n');
      withStub((bin) => {
        const r = runFn(bin, `REPO_ROOT='/nonexistent'\n${fns}`, `dockerfile_node '${join(dir, 'Dockerfile')}'`);
        expect([r.status, r.stdout]).toEqual([1, '']);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    withStub((bin) => {
      const missing = mkdtempSync(join(tmpdir(), 'api-root-'));
      try {
        const r = run(bin, { STUB_NODE_VERSION: `v${fromNode}` }, missing);
        expect(r.status).toBe(1);
        expect(r.stdout).not.toContain('preflights OK');
      } finally {
        rmSync(missing, { recursive: true, force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Compose
// ---------------------------------------------------------------------------

describe('no compose service built from the API image starts a shell', () => {
  type Service = { build?: { dockerfile?: string }; command?: unknown; entrypoint?: unknown; healthcheck?: { test?: unknown } };
  const files = ['deploy/compose', 'deploy/selfhost'].flatMap((dir) =>
    readdirSync(join(ROOT, dir))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => `${dir}/${f}`),
  );
  const services = files.flatMap((file) => {
    const doc = (parseYaml(read(file), { merge: true, logLevel: 'error' }) ?? {}) as { services?: Record<string, Service | null> };
    return Object.entries(doc.services ?? {}).map(([name, service]) => ({ file, name, service: service ?? {} }));
  });
  const built = services.filter((s) => s.service.build?.dockerfile === API_DOCKERFILE);
  // Node by the distroless image's path (T13): the image has no other.
  const NODE_PATHS = [NODE_PATH];

  it("finds managed.yml's api (vacuity)", () => {
    expect(built.map((s) => `${s.file}: ${s.name}`)).toEqual(['deploy/compose/managed.yml: api']);
  });

  it('its healthcheck, command and entrypoint, in every file of its directory', () => {
    const firstWord = (v: unknown): string => (Array.isArray(v) ? String(v[0]) : (String(v).trim().split(/\s+/)[0] ?? ''));
    for (const b of built) {
      for (const s of services.filter((x) => x.name === b.name && dirname(x.file) === dirname(b.file))) {
        const where = `${s.file}: ${s.name}`;
        const test = s.service.healthcheck?.test;
        if (test !== undefined) {
          expect(Array.isArray(test), `${where}: a string healthcheck runs in /bin/sh`).toBe(true);
          expect((test as string[])[0], `${where}: CMD-SHELL needs /bin/sh, which the distroless image has not got`).toBe('CMD');
          expect(NODE_PATHS, `${where}: ${String((test as string[])[1])}, not Node by its path`).toContain((test as string[])[1]);
        }
        if (s.service.entrypoint !== undefined) expect(NODE_PATHS, where).toContain(firstWord(s.service.entrypoint));
        if (s.service.command !== undefined) {
          const w = firstWord(s.service.command);
          expect(SHELL.test(w) || /printenv$/.test(w) || w === 'node', `${where}: command ${JSON.stringify(s.service.command)}`).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. The deploy from alpha.2 to alpha.3 runs twice
// ---------------------------------------------------------------------------

describe('every live-deploy procedure says the deploy from alpha.2 or earlier runs twice (the owner, 2026-10-26)', () => {
  // T13 ships with T13a in alpha.3, and deploy-live.sh runs the copy the
  // checkout had before it moved: from alpha.2, that copy asks the api
  // container with printenv, says the deploy did not take though the stack has
  // moved, and exits 3. The owner follows these, not the guards, and wants the
  // first run's words in them so that it is expected; the second run is
  // refused unless the task deploy's change to apps/worker/package.json is put
  // back first.
  const TWICE = /runs\s+(?:`deploy-live\.sh`\s+)?twice/;
  /** The second run, as a line to type: the same tag, alpha.3's or the placeholder the step uses. */
  const SECOND_RUN = /^\s*\.\/deploy\/compose\/deploy-live\.sh (?:v0\.2\.0-alpha\.3|<tag>)(?=\s|$)/m;
  const PUT_BACK = 'git checkout -- apps/worker/package.json';
  it.each([
    // file, quotes the first run's last line and types the second run
    ['docs/managed-bring-up.md', true],
    ['docs/release.md', true],
    ['docs/ending-the-alpha.md', true],
    ['docs/operator-runbook.md', false],
    ['CHANGELOG.md', false],
  ])('%s', (file, spellsItOut) => {
    const text = read(file);
    const at = text.search(TWICE);
    expect(at, `${file}: the two-run step`).toBeGreaterThanOrEqual(0);
    // What the step says, from where it starts: a deploy step before it is not its second run.
    const step = text.slice(at);
    const flat = text.replace(/\s+/g, ' ');
    expect(flat, `${file}: which deploys`).toContain('v0.2.0-alpha.2');
    expect(flat, file).toMatch(/the owner's decision of 2026-10-26/i);
    expect(flat, `${file}: the first run's words`).toContain('NODE_ENV: the api container could not be asked');
    expect(step.replace(/\s+/g, ' '), `${file}: the clean tree the second run needs`).toContain(PUT_BACK);
    if (spellsItOut) {
      // Whole, on one line, as the script prints it (and as section 2 reads it).
      expect(step, `${file}: the first run's last line, word for word`).toContain(`    ${ALPHA2_SAYS}\n`);
      const second = step.search(SECOND_RUN);
      expect(second, `${file}: the second run, a line to type`).toBeGreaterThanOrEqual(0);
      const putBack = step.indexOf(PUT_BACK);
      expect(putBack, `${file}: put back before the second run`).toBeGreaterThanOrEqual(0);
      expect(putBack, `${file}: put back before the second run`).toBeLessThan(second);
      expect(step.indexOf(ALPHA2_SAYS), `${file}: the first run's words before the second run`).toBeLessThan(second);
    }
  });

  it('section 2 reads the quoted line as output, and the same exec anywhere else as an exec', () => {
    const doc = (body: string) => execsIn('docs/x.md', body.replaceAll(ALPHA2_SAYS, '')).map((e) => [e.program, refusal(e)]);
    expect(doc(`It ends with:\n\n\`\`\`text\n    ${ALPHA2_SAYS}\n\`\`\`\n`)).toEqual([]);
    expect(doc('Ask it: `docker compose exec -T api printenv NODE_ENV`.\n')).toEqual([['printenv', expect.stringMatching(/printenv/)]]);
    // Wrapped, it is no longer the line the script prints, and is read as the exec it names.
    expect(doc(ALPHA2_SAYS.replace('exec -T', 'exec\n-T'))).toEqual([['printenv', expect.stringMatching(/printenv/)]]);
  });
});

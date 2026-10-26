// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DATABASE CONTAINER STARTED AS ROOT, FOR ONE CHOWN, AND THE BINARY THAT
 * DROPPED IT (workplan 0146 T15; the image scan of 2026-10-26).
 *
 * The official `postgres:18.6-alpine` starts as root. Its entrypoint makes the
 * data directory uid 70's and then runs gosu (`/usr/local/bin/gosu`) once, to
 * become uid 70 for good. gosu 1.19 is built with Go 1.24.6, and Trivy v0.76.1
 * counts the Go standard library in it as the image's one critical
 * (CVE-2025-68121) and 25 of its 26 highs, arm64 and amd64 alike: the
 * `trivy-image-postgres-managed` category in code scanning was 1 critical and
 * 26 highs, and only Alpine's brotli-libs was not gosu's. The entrypoint
 * reaches gosu only when `id -u` is 0. Started as uid 70, it never does: it
 * makes PGDATA itself on a new volume (which takes the image's
 * `/var/lib/postgresql`, uid 70's and mode 1777), and finds it uid 70's
 * already on a volume the root entrypoint ever started on, because that
 * entrypoint chowns every file in PGDATA to uid 70 on every start.
 *
 * So `deploy/compose/postgres/Dockerfile` builds the same image, by the same
 * digest, without gosu and with `USER 70:70`, and every Postgres of the
 * deploy/compose stacks runs it: managed.yml's `postgres` and `trigger-db`,
 * and dev.yml's `postgres`. The base stays Alpine and musl: a Debian base
 * collates text differently, and the indexes of a database made under one are
 * not to be trusted under the other. This holds:
 *
 *  - the Dockerfile: one FROM, the official image's exact version on Alpine,
 *    by tag and index digest; gosu removed with a plain `rm`, so a base
 *    without it fails the build and says the file has nothing left to do;
 *    `USER 70:70` after that, and no other USER; psql's and the shell's
 *    history kept in the container's /tmp, as root's were in /root, and not
 *    in the user's home, which is the data volume;
 *  - every Postgres the deploy/compose files run is that build, under
 *    `localhost/postgres:<builtTag>`, with `build: ./postgres` and no `user:`
 *    that puts root back. The tag carries the hash of the Dockerfile's
 *    instructions: compose builds such an image only when the machine has none
 *    of that name, so a name that stayed when the Dockerfile moved would keep
 *    the old build running for good;
 *  - the appliance's Postgres (deploy/selfhost/compose.yml) still starts as
 *    root on the official image, named below with its reason, so the list
 *    cannot rot in either direction;
 *  - the integration tests start the Dockerfile's base as uid 70, so every
 *    run initialises a new volume the way the stacks now do;
 *  - `db-roles.sh` and `stand-up-live.sh`, which ask the database over the
 *    stack's network with the image the stack's postgres runs, read the built
 *    image from managed.yml: their sed matched `image: postgres:` only, and a
 *    built image would have left them with nothing to ask with.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { COMPOSE_FILES, builtTag, dockerfileBase, parseRef } from './idp-pin-watch.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOCKERFILE = 'deploy/compose/postgres/Dockerfile';

/** Every Postgres service of the deploy/compose files, which run the build. */
const BUILT = ['deploy/compose/managed.yml:postgres', 'deploy/compose/managed.yml:trigger-db', 'deploy/compose/dev.yml:postgres'];

/**
 * A Postgres that still starts as root, on the official image, with its reason.
 * A listed one that runs the build since fails too.
 */
const NAMED_ROOT_STARTS: Readonly<Record<string, string>> = {
  'deploy/selfhost/compose.yml:postgres':
    "the appliance's pin is Dependabot's (.github/dependabot.yml, deploy/selfhost), which moves an image line and " +
    'no build; an appliance may keep its data in a bind mount of a host directory, which the root entrypoint made ' +
    "uid 70's and a start as uid 70 cannot (`mkdir: can't create directory '/var/lib/postgresql/18/': Permission " +
    "denied`); and it publishes no database port. Its turn is a decision of its own (workplan 0146 T15)",
};

interface Service {
  image?: string;
  build?: string | { context?: string; dockerfile?: string };
  user?: string | number;
}

function services(file: string, text = read(file)): Record<string, Service> {
  return ((parseYaml(text) as { services?: Record<string, Service | null> }).services ?? {}) as Record<string, Service>;
}

/** What is wrong with the Dockerfile, in words; empty when it holds. */
function dockerfileProblems(text: string): string[] {
  const problems: string[] = [];
  let base: ReturnType<typeof dockerfileBase> | null = null;
  try {
    base = dockerfileBase(text);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  if (base) {
    if (base.repo !== 'postgres') problems.push(`it builds on ${base.repo}, not the official postgres image`);
    if (!/^\d+\.\d+-alpine$/.test(base.tag)) {
      problems.push(`its base is ${base.tag}: the exact version on Alpine (\`18.6-alpine\`), whose musl collates as the existing databases were made`);
    }
  }
  const instructions = text.split('\n').filter((l) => !/^\s*(#|$)/.test(l));
  const rm = instructions.findIndex((l) => /^RUN\s+rm\s+\/usr\/local\/bin\/gosu\s*$/.test(l));
  if (rm < 0) problems.push('no `RUN rm /usr/local/bin/gosu` (a plain rm, so a base without gosu fails the build)');
  const users = instructions.map((l, i) => ({ l, i })).filter(({ l }) => /^USER\s/i.test(l));
  if (users.length !== 1 || !/^USER\s+70:70\s*$/.test(users[0]!.l)) {
    problems.push(`its USER lines are ${JSON.stringify(users.map((u) => u.l))}, not one \`USER 70:70\``);
  } else if (rm >= 0 && users[0]!.i < rm) {
    problems.push('USER 70:70 comes before the rm, which needs root');
  }
  for (const name of ['PSQL_HISTORY', 'HISTFILE']) {
    if (!instructions.some((l) => new RegExp(`^ENV\\s+${name}=/tmp/\\S+\\s*$`).test(l))) {
      problems.push(`no \`ENV ${name}=/tmp/…\`: uid 70's home is the data volume, where an interactive session would leave its history`);
    }
  }
  return problems;
}

/** What is wrong with the Postgres services of the deploy/compose files; empty when they hold. */
function composeProblems(texts: Readonly<Record<string, string>>, dockerfile: string): string[] {
  const problems: string[] = [];
  const want = `localhost/postgres:${builtTag(dockerfile)}`;
  const found: string[] = [];
  for (const [file, text] of Object.entries(texts)) {
    for (const [name, svc] of Object.entries(services(file, text))) {
      const key = `${file}:${name}`;
      const image = svc.image ? parseRef(svc.image) : null;
      if (image?.repo === 'postgres') {
        problems.push(`${key} runs ${svc.image}, which starts as root and carries gosu: run ${want}, built from ./postgres`);
        continue;
      }
      if (image?.repo !== 'localhost/postgres') continue;
      found.push(key);
      if (svc.image !== want) problems.push(`${key} runs ${svc.image}; the Dockerfile builds ${want}`);
      const context = typeof svc.build === 'string' ? svc.build : svc.build?.context;
      if (context !== './postgres') problems.push(`${key} is built from ${String(context)}, not ./postgres`);
      if (typeof svc.build === 'object' && svc.build.dockerfile !== undefined) problems.push(`${key} names a dockerfile of its own`);
      if (svc.user !== undefined && !/^70(:70)?$/.test(String(svc.user))) problems.push(`${key} runs as ${String(svc.user)}, not uid 70`);
    }
  }
  const missing = BUILT.filter((k) => !found.includes(k));
  const extra = found.filter((k) => !BUILT.includes(k));
  if (missing.length) problems.push(`not built: ${missing.join(', ')}`);
  if (extra.length) problems.push(`built, and not in this guard's list: ${extra.join(', ')}`);
  return problems;
}

const composeTexts = Object.fromEntries(COMPOSE_FILES.map((f) => [f, read(f)]));

describe('the Postgres of the deploy/compose stacks starts as uid 70, from an image without gosu', () => {
  it('the Dockerfile builds the official image by digest, without gosu, as uid 70', () => {
    expect(dockerfileProblems(read(DOCKERFILE))).toEqual([]);
  });

  it('refuses each way the Dockerfile could go back', () => {
    const real = read(DOCKERFILE);
    const swap = (from: RegExp, to: string) => {
      const text = real.replace(from, to);
      expect(text, `${String(from)} matched nothing`).not.toBe(real);
      return dockerfileProblems(text);
    };
    expect(swap(/^RUN rm \/usr\/local\/bin\/gosu$/m, 'RUN rm -f /usr/local/bin/gosu')).toEqual([expect.stringContaining('RUN rm /usr/local/bin/gosu')]);
    expect(swap(/^USER 70:70$/m, 'USER root')).toEqual([expect.stringContaining('not one `USER 70:70`')]);
    expect(swap(/^USER 70:70$/m, '')).toEqual([expect.stringContaining('not one `USER 70:70`')]);
    expect(swap(/^ENV PSQL_HISTORY=.*$/m, '')).toEqual([expect.stringContaining('ENV PSQL_HISTORY')]);
    expect(swap(/^FROM postgres:(\d+\.\d+)-alpine@/m, 'FROM postgres:$1-trixie@')).toEqual([expect.stringContaining('on Alpine')]);
    expect(swap(/^FROM (\S+)@sha256:[0-9a-f]{64}$/m, 'FROM $1')).toEqual([expect.stringContaining('carries no tag and digest')]);
    // USER moved above the rm: the build's rm would run as uid 70, and fail.
    const moved = real.replace(/^USER 70:70\n/m, '').replace(/^(RUN rm \/usr\/local\/bin\/gosu)$/m, 'USER 70:70\n$1');
    expect(dockerfileProblems(moved)).toEqual(['USER 70:70 comes before the rm, which needs root']);
  });

  it('every Postgres the deploy/compose files run is that build, by the name its instructions give it', () => {
    expect(COMPOSE_FILES).toEqual(['deploy/compose/managed.yml', 'deploy/compose/dev.yml', 'deploy/compose/www.yml']);
    expect(composeProblems(composeTexts, read(DOCKERFILE))).toEqual([]);
  });

  it('refuses the official image back, a name the Dockerfile moved past, another context, and a root user', () => {
    const dockerfile = read(DOCKERFILE);
    const managed = composeTexts['deploy/compose/managed.yml']!;
    const base = dockerfileBase(dockerfile).ref;
    const back = managed.replace(/^(\s*image:\s*)localhost\/postgres:\S+\n(\s*build:\s*\.\/postgres\n)/m, `$1${base}\n`);
    expect(back).not.toBe(managed);
    expect(composeProblems({ ...composeTexts, 'deploy/compose/managed.yml': back }, dockerfile)).toEqual([
      expect.stringContaining('deploy/compose/managed.yml:postgres runs postgres:'),
      'not built: deploy/compose/managed.yml:postgres',
    ]);
    // An instruction changed, and the names did not: compose would keep the old build.
    const edited = dockerfile.replace(/^(ENV HISTFILE=\S+)$/m, '$1\nENV LANG=en_US.utf8');
    expect(edited).not.toBe(dockerfile);
    expect(composeProblems(composeTexts, edited)).toHaveLength(BUILT.length);
    // A comment is no instruction, and moves no name.
    expect(composeProblems(composeTexts, `${dockerfile}\n# a note\n`)).toEqual([]);
    const elsewhere = managed.replace(/^(\s*build:\s*)\.\/postgres$/m, '$1./postgres-other');
    expect(composeProblems({ ...composeTexts, 'deploy/compose/managed.yml': elsewhere }, dockerfile)).toEqual([
      'deploy/compose/managed.yml:postgres is built from ./postgres-other, not ./postgres',
    ]);
    const rooted = managed.replace(/^(\s*build:\s*\.\/postgres)$/m, '$1\n    user: root');
    expect(composeProblems({ ...composeTexts, 'deploy/compose/managed.yml': rooted }, dockerfile)).toEqual([
      'deploy/compose/managed.yml:postgres runs as root, not uid 70',
    ]);
  });

  it('the Postgres that still starts as root is named, with its reason, and is still the official image', () => {
    for (const [key, reason] of Object.entries(NAMED_ROOT_STARTS)) {
      const [file, name] = key.split(':') as [string, string];
      const svc = services(file)[name];
      expect(svc, `${key} is gone: remove it from NAMED_ROOT_STARTS`).toBeDefined();
      expect(svc!.build, `${key} is built now: remove it from NAMED_ROOT_STARTS, and hold it with the others`).toBeUndefined();
      expect(parseRef(svc!.image ?? '').repo).toBe('postgres');
      expect(reason.length, `${key} gives no reason`).toBeGreaterThan(60);
    }
  });

  it("the integration tests start the Dockerfile's base as uid 70", () => {
    const setup = read('packages/testing/src/testcontainers-setup.ts');
    const started = [...setup.matchAll(/new GenericContainer\('(postgres:[^']+)'\)([\s\S]*?)\.start\(\)/g)];
    expect(started, 'testcontainers-setup.ts starts no single postgres').toHaveLength(1);
    expect(started[0]![1], "the integration tests' postgres is not the Dockerfile's base").toBe(dockerfileBase(read(DOCKERFILE)).ref);
    expect(started[0]![2], 'it starts as root, and initialises its volume the way no stack does any more').toMatch(/\.withUser\('70:70'\)/);
  });

  it("db-roles.sh and stand-up-live.sh ask with the build managed.yml's postgres runs", () => {
    const want = `localhost/postgres:${builtTag(read(DOCKERFILE))}`;
    for (const [script, variable] of [
      ['deploy/compose/db-roles.sh', 'DB_ROLES_CLIENT_IMAGE'],
      ['deploy/compose/stand-up-live.sh', 'PG_CHECK_IMAGE'],
    ] as const) {
      const program = new RegExp(`${variable}="\\$\\(sed -n '([^']+)' "\\$\\{SCRIPT_DIR\\}/managed\\.yml"`).exec(read(script))?.[1];
      expect(program, `${script} no longer reads ${variable} from managed.yml with sed`).toBeTruthy();
      const asked = spawnSync('sed', ['-n', program!, join(REPO_ROOT, 'deploy/compose/managed.yml')], { encoding: 'utf8' });
      expect(asked.status, asked.stderr).toBe(0);
      expect(asked.stdout, `${script} reads no image, or another one, from managed.yml`).toBe(`${want}\n`);
    }
  });
});

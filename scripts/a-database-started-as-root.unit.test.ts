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
 *    `localhost/postgres:<builtTag>`, with `build: ./postgres`,
 *    `pull_policy: never` and no `user:` that puts root back. The tag carries
 *    the hash of the Dockerfile's instructions: `up` builds such an image only
 *    when the machine has none of that name, so a name that stayed when the
 *    Dockerfile moved would keep the old build running for good, on live and
 *    the OTA stack alike, and on one daemon the stack that built the new
 *    content would hand it to the other under the old name.
 *    `pull_policy: never` because no registry serves the name: without it
 *    `docker compose pull` failed on it, and the first `up` asked whatever
 *    answers on the host's own port 443 for it before building;
 *  - THE NAME IS THE CONTENT, AND NOTHING ELSE IS (asked again on
 *    2026-10-26). When the instructions change, one failure names every image
 *    line that still says the old name and the `sed` that writes the new one.
 *    And nothing the hash does not cover may change what is built: no parser
 *    directive (`# syntax=`, `# escape=`, `# check=`: a comment to the hash,
 *    an instruction to the builder), no COPY, ADD or `--mount` (they read
 *    files or images the hash does not cover), and `build:` is the bare
 *    directory (args, a target or a Dockerfile of its own would be inputs the
 *    name does not carry). The context holds the Dockerfile alone, and nothing
 *    reads it but the builder;
 *  - Dependabot reads the Dockerfile, in a docker entry of its own that never
 *    offers a major (pg_upgrade is the owner's): a new digest or 18.x of the
 *    base arrives as its pull request, which fails here until the three names
 *    move with it, and says how;
 *  - NOTHING BUILDS IT AGAIN WHILE THE MACHINE HAS IT (the review of #1717,
 *    2026-10-26). `up --build` builds every service in its scope that has a
 *    `build:`, dependencies included (compose 5.1.1, cmd/compose/create.go and
 *    up.go), and api and web depend on both databases. The bring-up's app
 *    phase ran exactly that, so every bring-up rebuilt the image. Harmless
 *    while BuildKit kept its cache; from a pruned cache the same name got a
 *    new image ID, and the next `up` that reached a database recreated it, on
 *    a shared daemon live's as well, outside any hold. So the app phase builds
 *    `api web` by name and runs `up` without `--build`, and no script, compose
 *    comment or document gives a command that builds the databases' image:
 *    no `up --build` on managed.yml or dev.yml, no `build` naming no service
 *    or a database;
 *  - a pull request that touches deploy/ builds the Dockerfile and starts the
 *    result (images.yml, `build (postgres)`), so a FROM that does not resolve,
 *    or a base without gosu, is found there and not first by E2E (managed);
 *  - THE APPLIANCE'S POSTGRES TOO (workplan 0146 T15b, 2026-10-26). Its image
 *    carried the same gosu: Trivy v0.76.1 read 1 critical (CVE-2025-68121) and
 *    26 highs in `postgres:18.6-alpine@sha256:77f58511…` on arm64, and the
 *    newest digest of the tag ships the same gosu. So
 *    `deploy/selfhost/compose.yml`'s postgres runs a build of its own,
 *    `deploy/selfhost/postgres/Dockerfile` (compose builds `localhost/<name>`
 *    from `<name>/Dockerfile` beside the file): the managed Dockerfile's
 *    instructions on the appliance's own base, held by every rule above, its
 *    name by its own hash and its own `sed`, its pin by its own Dependabot
 *    entry (the docker-compose entry that moved the old image line ignores
 *    the build's name outright, which it would otherwise ask Docker Hub for),
 *    and built by the same `build (postgres)`. The appliance's override files
 *    may not put root, a pull or another build back on it. And no compose
 *    file under deploy/ runs the official image any more, which this used to
 *    allow for the appliance by name. E2E (self-hosted) builds `app` by name
 *    and runs `up` without `--build`, and no document gives an appliance
 *    command that rebuilds the database's image: that runner's Docker is the
 *    managed stacks' too, and once the two FROMs meet, so do the two names;
 *  - the integration tests start the Dockerfile's base as uid 70, so every
 *    run initialises a new volume the way the stacks now do;
 *  - `db-roles.sh` and `stand-up-live.sh`, which ask the database over the
 *    stack's network with the image the stack's postgres runs, read the built
 *    image from managed.yml: their sed matched `image: postgres:` only, and a
 *    built image would have left them with nothing to ask with.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineCounter, parse as parseYaml, parseDocument } from 'yaml';
import { COMPOSE_FILES, builtTag, dockerfileBase, parseRef, readImages } from './idp-pin-watch.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOCKERFILE = 'deploy/compose/postgres/Dockerfile';
/** The appliance's (0146 T15b): the same instructions on the appliance's own base. */
const APPLIANCE_DOCKERFILE = 'deploy/selfhost/postgres/Dockerfile';

/** Every Postgres service of the deploy/compose files, which run the build. */
const BUILT = ['deploy/compose/managed.yml:postgres', 'deploy/compose/managed.yml:trigger-db', 'deploy/compose/dev.yml:postgres'];

/**
 * The appliance's compose files: `compose.yml` and every override layered on
 * it (`compose.dev.yml`, `compose.pglite.yml`, `compose.drill.yml`), read
 * from the directory, so a new override is read too.
 */
const APPLIANCE_FILES = readdirSync(join(REPO_ROOT, 'deploy/selfhost'))
  .filter((name) => /^compose(\.[\w-]+)?\.ya?ml$/.test(name))
  .sort()
  .map((name) => `deploy/selfhost/${name}`);

/** One build: its Dockerfile, the services that run it, and what else reads its name. */
interface Build {
  readonly dockerfile: string;
  readonly built: readonly string[];
  /** Said at the end of a stale-name failure: who else names the image, so the `sed` is all there is to do. */
  readonly readers: string;
}

const MANAGED: Build = {
  dockerfile: DOCKERFILE,
  built: BUILT,
  readers: "Nothing else names it: db-roles.sh and stand-up-live.sh read managed.yml's, and the image scan and the pin watch read the Dockerfile.",
};

const APPLIANCE: Build = {
  dockerfile: APPLIANCE_DOCKERFILE,
  built: ['deploy/selfhost/compose.yml:postgres'],
  readers:
    "Nothing else names it: the image scan reads the Dockerfile, and an appliance's next `up -d` builds the new name. Dispatch E2E (self-hosted) on the branch.",
};

interface Service {
  image?: string;
  build?: string | { context?: string; dockerfile?: string };
  pull_policy?: string;
  user?: string | number;
}

/** A compose file's services. `logLevel: 'error'`: compose.pglite.yml carries Compose's own `!reset` tag, unknown to YAML. */
function services(file: string, text = read(file)): Record<string, Service> {
  return ((parseYaml(text, { logLevel: 'error' }) as { services?: Record<string, Service | null> }).services ?? {}) as Record<string, Service>;
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
  // The name hashes the instruction lines and nothing else (builtTag), so nothing else may change what is built.
  for (const line of text.split('\n')) {
    if (!/^\s*#\s*[a-z][a-z0-9]*\s*=/i.test(line)) break;
    problems.push(`\`${line}\` is a parser directive: it changes the build, and the image's name skips it as a comment. Remove it`);
  }
  for (const line of instructions) {
    if (/^(COPY|ADD)\s/i.test(line) || /--mount\b/i.test(line)) {
      problems.push(`\`${line}\` reads files or an image the image's name does not hash, so they could change under the same name. Write what it needs into an instruction line`);
    }
  }
  return problems;
}

/** The 1-based line of a service's `image:` in a compose file's text. */
function imageLine(text: string, service: string): number {
  const lineCounter = new LineCounter();
  const node = parseDocument(text, { lineCounter }).getIn(['services', service, 'image'], true) as { range?: [number, number, number] } | undefined;
  return node?.range ? lineCounter.linePos(node.range[0]).line : 0;
}

const escapeForSed = (s: string) => s.replace(/[.[\]\\*^$#]/g, '\\$&');

/**
 * The one failure for a Dockerfile whose instructions moved past the name the
 * compose files give its build: which lines, and the command that moves them.
 */
function staleNames(stale: ReadonlyArray<{ key: string; line: number; image: string }>, want: string, build: Build): string {
  const files = [...new Set(stale.map((s) => s.key.split(':')[0]!))];
  const olds = [...new Set(stale.map((s) => s.image))];
  return [
    `${build.dockerfile}'s instructions changed, so the image it builds is named ${want} now, and ${stale.length} image line(s) still give the old name:`,
    ...stale.map((s) => `  ${s.key.split(':')[0]}:${s.line} (${s.key.split(':')[1]}): ${s.image}`),
    'Compose builds an image only where its name is missing, so under the old name every stack that has it keeps running the old build, and on a',
    "shared daemon one stack's build of the new Dockerfile would be the other's too. Write the new name on those lines, from the repository's root:",
    `  sed -i ${olds.map((o) => `-e 's#${escapeForSed(o)}#${want}#'`).join(' ')} ${files.join(' ')}`,
    build.readers,
    "The twelve hex digits are the SHA-256 of the Dockerfile's instruction lines, comments and blank lines left out:",
    `  grep -Ev '^[[:space:]]*(#|$)' ${build.dockerfile} | sha256sum | cut -c1-12`,
  ].join('\n');
}

/**
 * What is wrong with the Postgres services of one build's compose files (the
 * deploy/compose stacks', or the appliance's with `APPLIANCE`); empty when
 * they hold.
 */
function composeProblems(texts: Readonly<Record<string, string>>, dockerfile: string, build: Build = MANAGED): string[] {
  const problems: string[] = [];
  const want = `localhost/postgres:${builtTag(dockerfile)}`;
  const found: string[] = [];
  const stale: Array<{ key: string; line: number; image: string }> = [];
  // An override layered on a built service names no image of its own (compose.pglite.yml's
  // `profiles`), and may not put back what the build's name and USER stand for.
  const builtNames = new Set(build.built.map((k) => k.split(':')[1]!));
  for (const [file, text] of Object.entries(texts)) {
    for (const [name, svc] of Object.entries(services(file, text))) {
      const key = `${file}:${name}`;
      const image = svc.image ? parseRef(svc.image) : null;
      if (image?.repo === 'postgres') {
        problems.push(`${key} runs ${svc.image}, which starts as root and carries gosu: run ${want}, built from ./postgres`);
        continue;
      }
      if (!image && builtNames.has(name) && svc) {
        if (svc.user !== undefined && !/^70(:70)?$/.test(String(svc.user))) problems.push(`${key}, an override, runs ${name} as ${String(svc.user)}, not uid 70`);
        if (svc.build !== undefined) problems.push(`${key}, an override, gives ${name} a build of its own, which the name ${want} does not carry`);
        if (svc.pull_policy !== undefined) problems.push(`${key}, an override, sets ${name}'s pull_policy to ${String(svc.pull_policy)}: no registry serves ${want}`);
        continue;
      }
      if (image?.repo !== 'localhost/postgres') continue;
      found.push(key);
      if (svc.image !== want) stale.push({ key, line: imageLine(text, name), image: svc.image! });
      if (typeof svc.build === 'object' && svc.build !== null) {
        problems.push(
          `${key}'s build: is a mapping (${Object.keys(svc.build).join(', ')}): args, a target or a Dockerfile of its own are inputs the image's name does not carry. Write \`build: ./postgres\``,
        );
      } else if (svc.build !== './postgres') {
        problems.push(`${key} is built from ${String(svc.build)}, not ./postgres`);
      }
      if (svc.pull_policy !== 'never') {
        problems.push(`${key} has pull_policy ${String(svc.pull_policy)}, not never: no registry serves ${want}, so \`docker compose pull\` fails on it and \`up\` asks the host's own port 443 before it builds`);
      }
      if (svc.user !== undefined && !/^70(:70)?$/.test(String(svc.user))) problems.push(`${key} runs as ${String(svc.user)}, not uid 70`);
    }
  }
  if (stale.length) problems.push(staleNames(stale, want, build));
  const missing = build.built.filter((k) => !found.includes(k));
  const extra = found.filter((k) => !build.built.includes(k));
  if (missing.length) problems.push(`not built: ${missing.join(', ')}`);
  if (extra.length) problems.push(`built, and not in this guard's list: ${extra.join(', ')}`);
  return problems;
}

const composeTexts = Object.fromEntries(COMPOSE_FILES.map((f) => [f, read(f)]));
const applianceTexts = Object.fromEntries(APPLIANCE_FILES.map((f) => [f, read(f)]));

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
    // What the builder reads and the name does not hash: a parser directive, the context, another image.
    expect(dockerfileProblems(`# syntax=docker/dockerfile:1\n${real}`)).toEqual([expect.stringContaining('`# syntax=docker/dockerfile:1` is a parser directive')]);
    expect(dockerfileProblems(`# escape=\`\n${real}`)).toEqual([expect.stringContaining('is a parser directive')]);
    expect(dockerfileProblems(`${real}\n# check=skip=all\n`), 'a directive below the first line is a comment, to the builder too').toEqual([]);
    for (const line of ['COPY postgresql.conf /etc/postgresql/', 'ADD https://example.org/x.tar.gz /tmp/', 'COPY --from=busybox:1.37 /bin/busybox /bin/', 'RUN --mount=type=bind,target=/src true']) {
      expect(dockerfileProblems(real.replace(/^(USER 70:70)$/m, `${line}\n$1`)), line).toEqual([expect.stringContaining(`\`${line}\` reads files or an image`)]);
    }
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
    // One failure, naming every line and the command that moves them; that command is enough.
    const edited = dockerfile.replace(/^(ENV HISTFILE=\S+)$/m, '$1\nENV LANG=en_US.utf8');
    expect(edited).not.toBe(dockerfile);
    const [stale, ...more] = composeProblems(composeTexts, edited);
    expect(more).toEqual([]);
    const next = `localhost/postgres:${builtTag(edited)}`;
    expect(stale).toContain(`${DOCKERFILE}'s instructions changed, so the image it builds is named ${next} now, and 3 image line(s) still give the old name:`);
    const lines = Object.entries(composeTexts).flatMap(([file, text]) =>
      readImages(text)
        .filter((i) => i.repo === 'localhost/postgres')
        .map((i) => `${file}:${i.line} `),
    );
    expect(lines).toHaveLength(BUILT.length);
    for (const at of lines) expect(stale).toContain(at);
    const sed = /^ {2}(sed -i .*)$/m.exec(stale!)?.[1];
    expect(sed, 'the failure gives no sed').toBeTruthy();
    const scratch = mkdtempSync(join(tmpdir(), 'built-name-'));
    try {
      mkdirSync(join(scratch, 'deploy/compose'), { recursive: true });
      for (const [file, text] of Object.entries(composeTexts)) writeFileSync(join(scratch, file), text);
      const ran = spawnSync('sh', ['-c', sed!], { cwd: scratch, encoding: 'utf8' });
      expect(ran.status, ran.stderr).toBe(0);
      const moved = Object.fromEntries(Object.keys(composeTexts).map((file) => [file, readFileSync(join(scratch, file), 'utf8')]));
      expect(composeProblems(moved, edited), 'the sed the failure gives does not move every name').toEqual([]);
      for (const file of Object.keys(composeTexts)) {
        const changed = composeTexts[file]!.split('\n').filter((line, i) => moved[file]!.split('\n')[i] !== line);
        expect(changed.every((line) => /^\s*image:\s*localhost\/postgres:/.test(line)), `the sed changed more than image lines in ${file}`).toBe(true);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    // A comment is no instruction, and moves no name.
    expect(composeProblems(composeTexts, `${dockerfile}\n# a note\n`)).toEqual([]);
    const elsewhere = managed.replace(/^(\s*build:\s*)\.\/postgres$/m, '$1./postgres-other');
    expect(composeProblems({ ...composeTexts, 'deploy/compose/managed.yml': elsewhere }, dockerfile)).toEqual([
      'deploy/compose/managed.yml:postgres is built from ./postgres-other, not ./postgres',
    ]);
    // Args, a target, a Dockerfile of its own: inputs the name does not carry.
    const mapped = managed.replace(/^(\s*)build:\s*\.\/postgres$/m, '$1build:\n$1  context: ./postgres\n$1  args:\n$1    PG_EXTRA: "1"');
    expect(mapped).not.toBe(managed);
    expect(composeProblems({ ...composeTexts, 'deploy/compose/managed.yml': mapped }, dockerfile)).toEqual([
      expect.stringContaining("deploy/compose/managed.yml:postgres's build: is a mapping (context, args)"),
    ]);
    const rooted = managed.replace(/^(\s*build:\s*\.\/postgres)$/m, '$1\n    user: root');
    expect(composeProblems({ ...composeTexts, 'deploy/compose/managed.yml': rooted }, dockerfile)).toEqual([
      'deploy/compose/managed.yml:postgres runs as root, not uid 70',
    ]);
    // Pulled, or pulled when missing (compose's default): a registry is asked for a name none serves.
    for (const policy of ['missing', 'always', 'build']) {
      const pulled = managed.replace(/^(\s*pull_policy:\s*)never$/m, `$1${policy}`);
      expect(pulled).not.toBe(managed);
      expect(composeProblems({ ...composeTexts, 'deploy/compose/managed.yml': pulled }, dockerfile)).toEqual([
        expect.stringContaining(`deploy/compose/managed.yml:postgres has pull_policy ${policy}, not never`),
      ]);
    }
    const unset = managed.replace(/^\s*pull_policy:\s*never\n/m, '');
    expect(composeProblems({ ...composeTexts, 'deploy/compose/managed.yml': unset }, dockerfile)).toEqual([
      expect.stringContaining('deploy/compose/managed.yml:postgres has pull_policy undefined, not never'),
    ]);
  });

  it('no compose file under deploy/ runs the official image, which starts as root and carries gosu (the appliance since 0146 T15b)', () => {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'deploy'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.ya?ml$/.test(f));
    expect(files, 'the listing found none of the compose files').toEqual(expect.arrayContaining([...COMPOSE_FILES, ...APPLIANCE_FILES]));
    const official = files.flatMap((file) =>
      Object.entries(services(file))
        .filter(([, svc]) => typeof svc?.image === 'string' && parseRef(svc.image).repo === 'postgres')
        .map(([name, svc]) => `${file}:${name} runs ${svc.image}`),
    );
    expect(official).toEqual([]);
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

/** The instruction lines of a Dockerfile but its FROM, in order. */
const besidesFrom = (text: string) => text.split('\n').filter((l) => !/^\s*(#|$)/.test(l) && !/^FROM\s/i.test(l));

/**
 * What differs between the two Dockerfiles but their FROM; empty when nothing
 * does. One change made in one of them and not the other would leave a stack
 * on an image the other has stopped running, with nothing to say so.
 */
function driftProblems(managed: string, appliance: string): string[] {
  const [a, b] = [besidesFrom(managed), besidesFrom(appliance)];
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  return [
    `${APPLIANCE_DOCKERFILE}'s instructions are not ${DOCKERFILE}'s but for the FROM. Only in ${DOCKERFILE}: ${JSON.stringify(a.filter((l) => !b.includes(l)))}; ` +
      `only in ${APPLIANCE_DOCKERFILE}: ${JSON.stringify(b.filter((l) => !a.includes(l)))}${a.filter((l) => b.includes(l)).length === a.length && a.length === b.length ? ' (the same lines, in another order)' : ''}. ` +
      'Make the change in both: each moves its own image name, and this failure then prints the sed for each.',
  ];
}

describe("the appliance's Postgres starts as uid 70, from a build of its own without gosu (0146 T15b)", () => {
  it('reads the appliance\'s compose file and every override layered on it', () => {
    expect(APPLIANCE_FILES).toEqual(
      expect.arrayContaining(['deploy/selfhost/compose.yml', 'deploy/selfhost/compose.dev.yml', 'deploy/selfhost/compose.pglite.yml', 'deploy/selfhost/compose.drill.yml']),
    );
  });

  it("its Dockerfile builds the official image by digest, without gosu, as uid 70, and is the managed one's but for the FROM", () => {
    const appliance = read(APPLIANCE_DOCKERFILE);
    expect(dockerfileProblems(appliance)).toEqual([]);
    expect(driftProblems(read(DOCKERFILE), appliance)).toEqual([]);
    expect(besidesFrom(appliance), 'nothing to compare').toContain('USER 70:70');
  });

  it('refuses an appliance Dockerfile that goes back, or drifts from the managed one', () => {
    const real = read(APPLIANCE_DOCKERFILE);
    const swap = (from: RegExp, to: string) => {
      const text = real.replace(from, to);
      expect(text, `${String(from)} matched nothing`).not.toBe(real);
      return text;
    };
    expect(dockerfileProblems(swap(/^RUN rm \/usr\/local\/bin\/gosu$/m, 'RUN true'))).toEqual([expect.stringContaining('RUN rm /usr/local/bin/gosu')]);
    expect(dockerfileProblems(swap(/^USER 70:70$/m, 'USER 0'))).toEqual([expect.stringContaining('not one `USER 70:70`')]);
    expect(dockerfileProblems(swap(/^FROM (\S+)@sha256:[0-9a-f]{64}$/m, 'FROM $1'))).toEqual([expect.stringContaining('carries no tag and digest')]);
    const managed = read(DOCKERFILE);
    // One instruction more in one file: the stacks would part with nothing to say so.
    expect(driftProblems(managed, swap(/^(ENV HISTFILE=\S+)$/m, '$1\nENV LANG=en_US.utf8'))).toEqual([
      expect.stringContaining('Only in deploy/compose/postgres/Dockerfile: []; only in deploy/selfhost/postgres/Dockerfile: ["ENV LANG=en_US.utf8"]'),
    ]);
    expect(driftProblems(managed, swap(/^ENV PSQL_HISTORY=.*\n/m, ''))).toEqual([expect.stringContaining('Only in deploy/compose/postgres/Dockerfile: ["ENV PSQL_HISTORY=')]);
    const reordered = real.replace(/^(ENV PSQL_HISTORY=\S+)\n(ENV HISTFILE=\S+)$/m, '$2\n$1');
    expect(reordered).not.toBe(real);
    expect(driftProblems(managed, reordered)).toEqual([expect.stringContaining('(the same lines, in another order)')]);
    // Another FROM alone is the point of two files.
    expect(driftProblems(managed, swap(/@sha256:[0-9a-f]{64}$/m, `@sha256:${'0'.repeat(64)}`))).toEqual([]);
  });

  it('compose.yml runs that build, by the name its instructions give it, never pulled, as uid 70', () => {
    expect(composeProblems(applianceTexts, read(APPLIANCE_DOCKERFILE), APPLIANCE)).toEqual([]);
    const postgres = services('deploy/selfhost/compose.yml')['postgres']!;
    expect(postgres.image).toBe(`localhost/postgres:${builtTag(read(APPLIANCE_DOCKERFILE))}`);
  });

  it('refuses the official image back, a name the Dockerfile moved past, a pull, root, and an override that puts any of them back', () => {
    const dockerfile = read(APPLIANCE_DOCKERFILE);
    const file = 'deploy/selfhost/compose.yml';
    const compose = applianceTexts[file]!;
    const check = (text: string, at = file, from = dockerfile) => composeProblems({ ...applianceTexts, [at]: text }, from, APPLIANCE);
    const back = compose.replace(/^(\s*image:\s*)localhost\/postgres:\S+\n(\s*build:\s*\.\/postgres\n)/m, `$1${dockerfileBase(dockerfile).ref}\n`);
    expect(back).not.toBe(compose);
    expect(check(back)).toEqual([expect.stringContaining(`${file}:postgres runs postgres:18`), `not built: ${file}:postgres`]);
    // An instruction changed, and the name did not: an appliance would keep the old build for good.
    const edited = dockerfile.replace(/^(ENV HISTFILE=\S+)$/m, '$1\nENV LANG=en_US.utf8');
    const [stale, ...more] = composeProblems(applianceTexts, edited, APPLIANCE);
    expect(more).toEqual([]);
    const next = `localhost/postgres:${builtTag(edited)}`;
    expect(stale).toContain(`${APPLIANCE_DOCKERFILE}'s instructions changed, so the image it builds is named ${next} now, and 1 image line(s) still give the old name:`);
    const line = readImages(compose).find((i) => i.repo === 'localhost/postgres')!.line;
    expect(stale).toContain(`  ${file}:${line} (postgres): `);
    expect(stale).toContain(`grep -Ev '^[[:space:]]*(#|$)' ${APPLIANCE_DOCKERFILE} | sha256sum | cut -c1-12`);
    const sed = /^ {2}(sed -i .*)$/m.exec(stale!)?.[1];
    expect(sed, 'the failure gives no sed').toBeTruthy();
    expect(sed).toMatch(/ deploy\/selfhost\/compose\.yml$/);
    const scratch = mkdtempSync(join(tmpdir(), 'built-name-'));
    try {
      mkdirSync(join(scratch, 'deploy/selfhost'), { recursive: true });
      for (const [at, text] of Object.entries(applianceTexts)) writeFileSync(join(scratch, at), text);
      const ran = spawnSync('sh', ['-c', sed!], { cwd: scratch, encoding: 'utf8' });
      expect(ran.status, ran.stderr).toBe(0);
      const moved = Object.fromEntries(Object.keys(applianceTexts).map((at) => [at, readFileSync(join(scratch, at), 'utf8')]));
      expect(composeProblems(moved, edited, APPLIANCE), 'the sed the failure gives does not move the name').toEqual([]);
      const changed = compose.split('\n').filter((l, i) => moved[file]!.split('\n')[i] !== l);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatch(/^\s*image:\s*localhost\/postgres:/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    // Pulled, or pulled when missing (compose's default), or as root.
    for (const policy of ['missing', 'always']) {
      expect(check(compose.replace(/^(\s*pull_policy:\s*)never$/m, `$1${policy}`))).toEqual([expect.stringContaining(`${file}:postgres has pull_policy ${policy}, not never`)]);
    }
    expect(check(compose.replace(/^\s*pull_policy:\s*never\n/m, ''))).toEqual([expect.stringContaining(`${file}:postgres has pull_policy undefined, not never`)]);
    expect(check(compose.replace(/^(\s*pull_policy:\s*never)$/m, '$1\n    user: "0:0"'))).toEqual([`${file}:postgres runs as 0:0, not uid 70`]);
    expect(check(compose.replace(/^(\s*build:\s*)\.\/postgres$/m, '$1../compose/postgres'))).toEqual([`${file}:postgres is built from ../compose/postgres, not ./postgres`]);
    // The overrides are merged onto it: none may put root, a pull or another build back.
    const override = 'deploy/selfhost/compose.dev.yml';
    const dev = applianceTexts[override]!;
    const layered = (lines: string) => dev.replace(/^services:\n/m, `services:\n  postgres:\n${lines}`);
    expect(check(layered('    user: root\n'), override)).toEqual([`${override}:postgres, an override, runs postgres as root, not uid 70`]);
    expect(check(layered('    pull_policy: always\n'), override)).toEqual([expect.stringContaining(`${override}:postgres, an override, sets postgres's pull_policy to always`)]);
    expect(check(layered('    build:\n      context: ./postgres\n      args:\n        X: "1"\n'), override)).toEqual([
      expect.stringContaining(`${override}:postgres, an override, gives postgres a build of its own`),
    ]);
    expect(check(layered(`    image: ${dockerfileBase(dockerfile).ref}\n`), override)).toEqual([expect.stringContaining(`${override}:postgres runs postgres:18`)]);
    expect(check(layered('    user: "70:70"\n'), override), 'uid 70 is what the image runs as anyway').toEqual([]);
    // compose.pglite.yml's postgres sets profiles alone, which is no override of these.
    expect(services('deploy/selfhost/compose.pglite.yml')['postgres']).toEqual({ profiles: ['never'] });
  });

  it('E2E (self-hosted) builds the app by name before its `up`, which builds the database only where its name is missing', () => {
    const e2e = parseYaml(read('.github/workflows/e2e.yml')) as { jobs: Record<string, { steps?: Array<{ name?: string; run?: string }> }> };
    const step = Object.values(e2e.jobs)
      .flatMap((j) => j.steps ?? [])
      .find((s) => s.name === 'Build + start the self-host appliance');
    expect(step, 'e2e.yml has no step that brings the appliance up').toBeDefined();
    const run = step!.run ?? '';
    const build = run.search(/^\s*docker compose \$SELFHOST_COMPOSE_FILES build app\s*$/m);
    const up = run.search(/^\s*docker compose \$SELFHOST_COMPOSE_FILES up -d --force-recreate --wait\b/m);
    expect(build, 'the app is not built by name').toBeGreaterThan(-1);
    expect(up, 'the appliance is not brought up without --build').toBeGreaterThan(-1);
    expect(build).toBeLessThan(up);
    expect(run.split('\n').flatMap(rebuilds)).toEqual([]);
  });
});

type Update = { 'package-ecosystem': string; directory?: string; directories?: string[]; ignore?: Array<Record<string, unknown>> };
const updates = (parseYaml(read('.github/dependabot.yml')) as { updates: Update[] }).updates;
const directoriesOf = (u: Update) => [...(u.directories ?? []), ...(u.directory ? [u.directory] : [])];

describe("Dependabot moves the Dockerfile's base", () => {
  for (const dockerfile of [DOCKERFILE, APPLIANCE_DOCKERFILE]) {
    const directory = `/${dirname(dockerfile)}`;
    it(`${dockerfile}: in a docker entry of its own, which never offers a major`, () => {
      const entries = updates.filter((u) => u['package-ecosystem'] === 'docker' && directoriesOf(u).includes(directory));
      expect(entries, `Dependabot does not read ${dockerfile}: nothing opens the pull request that moves its base`).toHaveLength(1);
      expect(entries[0]!.directories, 'it shares an entry, and its pull request, which fails here until the names move, would hold the others back').toBeUndefined();
      expect(entries[0]!.directory).toBe(directory);
      expect(entries[0]!.ignore, "a major is pg_upgrade, and the owner's decision").toContainEqual({
        'dependency-name': 'postgres',
        'update-types': ['version-update:semver-major'],
      });
    });
  }

  it("the docker-compose entry that reads the appliance's compose.yml never asks a registry for the build's name (0146 T15b)", () => {
    // Its parser takes a registry only from a host with a dot in it, so it reads
    // `localhost/postgres` as a Docker Hub repository; an ignore that names no
    // versions or update types is a dependency the updater never checks at all.
    const compose = updates.filter((u) => u['package-ecosystem'] === 'docker-compose' && directoriesOf(u).includes('/deploy/selfhost'));
    expect(compose).toHaveLength(1);
    expect(readImages(read('deploy/selfhost/compose.yml')).map((i) => i.repo)).toContain('localhost/postgres');
    expect(compose[0]!.ignore, 'Dependabot would ask Docker Hub for localhost/postgres every Monday').toContainEqual({ 'dependency-name': 'localhost/postgres' });
  });
});

// ---------------------------------------------------------------------------
// NOTHING BUILDS THE DATABASES' IMAGE AGAIN WHILE THE MACHINE HAS IT.

/** Global options of `docker compose` that take a value as the next word. */
const COMPOSE_OPTIONS_WITH_VALUE = new Set(['-f', '--file', '-p', '--project-name', '--env-file', '--profile', '--project-directory', '--ansi', '--progress', '--parallel']);
/** Options of `docker compose build` that take a value as the next word. */
const BUILD_OPTIONS_WITH_VALUE = new Set(['--build-arg', '--builder', '-m', '--memory', '--progress', '--ssh', '--provenance', '--sbom']);
/**
 * The compose files whose Postgres is a build: managed.yml and dev.yml, and
 * the appliance's compose.yml since 0146 T15b. A command naming only other
 * files is not this guard's.
 */
const BUILDS_THE_DATABASES = /(^|\/)(managed|dev)\.yml$|(^|\/)deploy\/selfhost\/compose\.yml$/;
/**
 * A word that expands to compose's options: E2E (self-hosted)'s
 * `$SELFHOST_COMPOSE_FILES` (the appliance's compose.yml and its overrides),
 * the quickstart's `$COMPOSE`. What it holds cannot be read here, so a command
 * that carries one is read as if it named a database's file.
 */
const COMPOSE_VARIABLE = /^"?\$\{?[A-Z_]*COMPOSE[A-Z_]*\}?"?$/;

/**
 * What is wrong with one line's compose commands, in words; empty when none
 * builds the databases' image. A command is `docker compose …` or the bring-up's
 * `"${COMPOSE[@]}" …`, up to the end of the line, a backtick, `&&`, `||`, `;`,
 * `|`, `)` or a comment. It builds that image when it is `up` with `--build`
 * (every service in scope that has a `build:`, dependencies included), or
 * `build` naming no service (all of them) or a database.
 */
function rebuilds(line: string): string[] {
  const problems: string[] = [];
  for (const m of line.matchAll(/(?:docker compose|docker-compose|"\$\{COMPOSE\[@\]\}")((?:[^`&|;)#\n]|#(?!\s))*)/g)) {
    const words = m[1]!.trim().split(/\s+/).filter((w) => w && w !== '\\');
    const files: string[] = [];
    let unread = false;
    let i = 0;
    while (i < words.length && (words[i]!.startsWith('-') || COMPOSE_VARIABLE.test(words[i]!))) {
      const word = words[i]!;
      if (COMPOSE_VARIABLE.test(word)) unread = true;
      else if (word === '-f' || word === '--file') files.push(words[i + 1] ?? '');
      else if (word.startsWith('--file=')) files.push(word.slice('--file='.length));
      i += COMPOSE_OPTIONS_WITH_VALUE.has(word) ? 2 : 1;
    }
    if (!unread && files.length > 0 && !files.some((f) => BUILDS_THE_DATABASES.test(f))) continue;
    const [command, ...rest] = words.slice(i);
    const said = m[0]!.trim();
    if (command === 'up' && rest.includes('--build')) {
      problems.push(`\`${said}\` builds every service in its scope that has a build:, the databases' image among them: build the images that carry code by name, then \`up\` without --build`);
    }
    if (command === 'build') {
      const named: string[] = [];
      for (let j = 0; j < rest.length; j += 1) {
        if (BUILD_OPTIONS_WITH_VALUE.has(rest[j]!)) j += 1;
        else if (!rest[j]!.startsWith('-')) named.push(rest[j]!);
      }
      if (named.length === 0) problems.push(`\`${said}\` builds every service, the databases' image among them: name the services (\`build api web\`)`);
      for (const db of named.filter((n) => n === 'postgres' || n === 'trigger-db')) {
        problems.push(`\`${said}\` builds ${db}'s image although the machine has it: it is built when its name is missing, and only then`);
      }
    }
  }
  return problems;
}

/**
 * The files whose commands somebody runs on a stack: scripts, the compose
 * files' comments, workflows and the documents. Not the records of what was
 * once run (workplans, the ADR history, the design handoffs) and not
 * LESSONS.md, which is generated from these guards' headers.
 */
function filesWithCommands(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'docs', 'deploy/compose', 'deploy/selfhost', '.github/workflows', 'README.md', 'CONTRIBUTING.md'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => /\.(md|sh|ya?ml)$/.test(f))
    .filter((f) => !/^docs\/(workplans|adr\/history|design)\//.test(f) && f !== 'docs/LESSONS.md');
}

const bootstrap = read('deploy/compose/bootstrap-managed.sh');
const lift = (name: string): string => {
  const at = bootstrap.indexOf(`\n${name}() {`);
  return at < 0 ? '' : bootstrap.slice(at, bootstrap.indexOf('\n}\n', at) + 3);
};

describe("nothing builds the databases' image again while the machine has it", () => {
  it('reads the commands it means, and refuses each way of rebuilding it', () => {
    for (const line of [
      'docker compose -f deploy/compose/managed.yml up -d --build web',
      'GIT_SHA=$(git rev-parse --short HEAD) docker compose -f deploy/compose/managed.yml up -d --build --wait api web',
      '    "${COMPOSE[@]}" up -d --build --wait "${services[@]}" || explain_failure "${services[@]}"',
      'docker compose -f deploy/compose/dev.yml up -d --build',
      '#   GIT_SHA=$(git rev-parse HEAD) docker compose -f managed.yml build',
      'docker compose build --no-cache',
      'docker compose -f deploy/compose/managed.yml build postgres',
      'docker compose -f deploy/compose/managed.yml build --build-arg GIT_SHA=x trigger-db api',
      'run `docker compose -f deploy/compose/managed.yml -f override.yml up -d --build` first',
      // The appliance's database is a build too since 0146 T15b, and E2E (self-hosted) runs on a
      // Docker the managed stacks share.
      '          docker compose $SELFHOST_COMPOSE_FILES up -d --build --force-recreate --wait || \\',
      'docker compose -f deploy/selfhost/compose.yml up -d --build',
      'docker compose -f deploy/selfhost/compose.yml -f deploy/selfhost/compose.dev.yml up -d --build --force-recreate',
      'docker compose -f deploy/selfhost/compose.yml build',
      'docker compose -f deploy/selfhost/compose.yml build postgres',
      'docker compose ${SELFHOST_COMPOSE_FILES} build --no-cache',
    ]) {
      expect(rebuilds(line), line).not.toEqual([]);
    }
    for (const line of [
      'GIT_SHA=$(git rev-parse --short HEAD) docker compose -f deploy/compose/managed.yml build api web',
      'docker compose -f deploy/compose/managed.yml up -d --wait api web',
      'docker compose -f deploy/compose/managed.yml build --build-arg GIT_SHA=x --no-cache web && docker compose -f deploy/compose/managed.yml up -d web',
      'docker compose -f deploy/compose/managed.yml up -d --no-deps --no-build api',
      '          docker compose $SELFHOST_COMPOSE_FILES build app',
      '          docker compose $SELFHOST_COMPOSE_FILES up -d --force-recreate --wait || \\',
      'docker compose -f deploy/selfhost/compose.yml -f deploy/selfhost/compose.dev.yml build app',
      'docker compose -f deploy/selfhost/compose.yml pull app',
      'docker compose -f deploy/selfhost/compose.yml up -d',
      'docker compose $COMPOSE stop app',
      'docker compose -p ownpace-live-www -f deploy/compose/www.yml --env-file deploy/compose/.env up -d --force-recreate',
      '# the app services used to need `--build` and a GIT_SHA',
    ]) {
      expect(rebuilds(line), line).toEqual([]);
    }
  });

  it('no script, compose file, workflow or document gives such a command', () => {
    const files = filesWithCommands();
    expect(files, 'the listing found none of the files it reads').toEqual(
      expect.arrayContaining([
        'deploy/compose/bootstrap-managed.sh',
        'deploy/compose/managed.yml',
        'docs/managed-bring-up.md',
        '.github/workflows/images.yml',
        '.github/workflows/e2e.yml',
        'deploy/selfhost/compose.dev.yml',
        'docs/selfhost-quickstart.md',
      ]),
    );
    const found = files.flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, n) => rebuilds(line).map((problem) => `${file}:${n + 1}: ${problem}`)),
    );
    expect(found).toEqual([]);
  });

  it('the app phase builds api and web by name, with the commit, before its `up`, which has no --build', () => {
    const app = lift('phase_app');
    expect(app, 'phase_app not found').toContain('local services=(');
    const build = app.search(/^\s*GIT_SHA="\$\(git -C "\$REPO_ROOT" rev-parse HEAD[^\n]*\\\n\s*"\$\{COMPOSE\[@\]\}" build api web \|\| die /m);
    const up = app.indexOf('up_wait "${services[@]}"');
    expect(build, 'phase_app does not build api and web by name, with GIT_SHA, and stop when they do not build').toBeGreaterThan(-1);
    expect(up, 'phase_app does not bring its services up through up_wait').toBeGreaterThan(-1);
    expect(build, 'the images that carry code are built after the `up` that runs them').toBeLessThan(up);
    expect(lift('up_wait'), 'up_wait builds what its services need').toMatch(/"\$\{COMPOSE\[@\]\}" up -d --wait "\$@"/);
  });

  it('a pull request that touches deploy/ builds both Dockerfiles with compose, and starts each result as uid 70', () => {
    const images = parseYaml(read('.github/workflows/images.yml')) as {
      on: { pull_request?: { paths?: string[] } };
      jobs: Record<string, { if?: string; 'runs-on'?: string; permissions?: unknown; env?: Record<string, string>; steps?: Array<{ run?: string; uses?: string }> }>;
    };
    expect(images.on.pull_request?.paths, "images.yml no longer runs on a pull request that touches deploy/").toContain('deploy/**');
    const job = images.jobs['database'];
    expect(job, 'images.yml has no `database` job').toBeDefined();
    expect(job!.if).toBe("github.event_name == 'pull_request'");
    expect(job!['runs-on']).toMatch(/^ubuntu-/);
    expect(job!.permissions).toEqual({ contents: 'read' });
    const run = (job!.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(run, 'it does not start the database the way dev.yml does, building it where it is missing').toMatch(
      /docker compose -f "\$file" up -d --wait\b[^\n]*\bpostgres\b/,
    );
    expect(run, 'it does not check what built').toContain('{{.Config.User}}');
    expect(run, 'it does not check the server and the data are uid 70').toMatch(/\/proc\/1\/status/);
    expect(run, 'it does not check gosu is gone').toContain('/usr/local/bin/gosu');
    expect(run, 'it builds the image itself, which would hide a compose that does not').not.toMatch(/docker (?:image )?build\b|\bbuild api\b|compose[^\n]* build\b/);
    // Each Dockerfile through a compose file that builds it: dev.yml's, and the appliance's (0146 T15b).
    const env = Object.entries(job!.env ?? {});
    for (const [build, file] of [
      [MANAGED, 'deploy/compose/dev.yml'],
      [APPLIANCE, 'deploy/selfhost/compose.yml'],
    ] as const) {
      expect(build.built.some((k) => k.startsWith(`${file}:`)), `${file} does not run ${build.dockerfile}`).toBe(true);
      const variable = env.find(([, value]) => value === file)?.[0];
      expect(variable, `the job names no ${file}, so ${build.dockerfile} is not built on a pull request`).toBeTruthy();
      expect(run, `the job does not bring up ${file}'s postgres`).toMatch(new RegExp(`^\\s*prove "\\$${variable}" \\w+ \\w+\\s*$`, 'm'));
    }
  });
});

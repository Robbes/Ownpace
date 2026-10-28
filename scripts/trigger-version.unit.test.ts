// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The Trigger.dev control plane's backup, and the version it is a backup FOR.
 *
 * ## Why this exists
 *
 * `triggerdb` holds the only copy of the things a person cannot rebuild
 * unattended — the account, the project, its API keys, the worker group, the
 * deployed-task records (deploy-tasks.sh's ONE-TIME prerequisites need a
 * browser and a magic link). The webapp applies its own schema migrations on
 * boot and Prisma has no down-migrations, so a version bump is ONE WAY: the
 * documented rollback runs the checkout that pinned the old version, which
 * restores the IMAGES and not the schema they migrated.
 *
 * Nothing backed that database up. `trigger-version.sh` does — and the tests
 * below are mostly about the parts that DESTROY things, because a restore is
 * a `DROP DATABASE` with a friendly name and the only safe version of it is
 * one that refuses by default.
 *
 * ## What is tested here, and what is not
 *
 * Anything needing a live Docker daemon is not tested here and cannot
 * usefully be: a stub would be testing the stub. What IS tested is every
 * refusal that fires BEFORE the first docker call — which is deliberately all
 * of them — plus the structural promises that a reader has to be able to rely
 * on: that the drill never names the live database in a DROP, that the gate
 * actually runs the drill, and that the destructive path cannot be reached by
 * accident.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, globSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtTag } from './idp-pin-watch.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'deploy/compose/trigger-version.sh');
const script = readFileSync(SCRIPT, 'utf8');
const workflow = readFileSync(join(REPO_ROOT, '.github/workflows/e2e-managed.yml'), 'utf8');

let dir: string;
let backups: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trigger-version-'));
  backups = join(dir, 'trigger-backups');
  mkdirSync(backups, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(SCRIPT, args, {
    encoding: 'utf8',
    env: { ...process.env, MANAGED_BACKUP_DIR: backups, ...env },
    cwd: dir,
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A file that decompresses to something that is NOT a database dump. */
const notADump = (text: string) => gzipSync(Buffer.from(text));
/** The smallest thing that passes for one: header, and enough of it. */
const looksLikeADump = () =>
  // Enough SQL to clear the floor. Deliberately repetitive: it compresses to
  // a few hundred bytes, which is exactly why the floor measures the
  // DECOMPRESSED size and not the archive.
  gzipSync(Buffer.from(`--\n-- PostgreSQL database dump\n--\n${'-- padding line\n'.repeat(600)}`));

describe('a restore refuses before it can destroy anything', () => {
  it('asks for a file, rather than guessing one', () => {
    const r = run(['restore']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--latest');
  });

  it('refuses a backup that does not exist', () => {
    const r = run(['restore', join(dir, 'nope.sql.gz'), '--yes']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('no such backup');
  });

  it('refuses --latest when there are no backups at all', () => {
    const r = run(['restore', '--latest', '--yes']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no backups/i);
  });

  it('refuses a gzip of an error message, which is still a valid gzip', () => {
    // The exact shape of #523: something non-empty, well-formed at the
    // envelope level, and not the thing it is claimed to be.
    const f = join(backups, 'triggerdb-20260824T000000Z.sql.gz');
    writeFileSync(f, notADump('Error response from daemon: No such container: trigger-db\n'.repeat(50)));
    const r = run(['restore', f, '--yes']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('not a pg_dump header');
  });

  it('refuses a dump too small to be a database', () => {
    const f = join(backups, 'triggerdb-20260824T000001Z.sql.gz');
    writeFileSync(f, gzipSync(Buffer.from('--\n-- PostgreSQL database dump\n--\n')));
    const r = run(['restore', f, '--yes']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/too little to be/);
  });

  it('refuses a VALID dump without --yes, and prints the commands that would do it', () => {
    // The one that matters: the happy path is the destructive one, so
    // reaching it has to be deliberate.
    const f = join(backups, 'triggerdb-20260824T000002Z.sql.gz');
    writeFileSync(f, looksLikeADump());
    const r = run(['restore', f]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('REFUSING');
    expect(r.stderr).toContain('stop trigger-api trigger-supervisor');
    expect(r.stderr).toContain('--yes');
  });

  it('after a restore, says to run the checkout that pinned the old version, never the old tag alone or a pin backwards (0146 T16)', () => {
    // The images are built from this checkout's Dockerfiles, which refuse another version
    // than their own: the old tag in .env alone builds nothing that runs.
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'docker'), '#!/usr/bin/env bash\ncase "$1" in inspect) echo false ;; exec) cat >/dev/null ;; esac\nexit 0\n', { mode: 0o755 });
    const f = join(backups, 'triggerdb-20260824T000003Z.sql.gz');
    writeFileSync(f, looksLikeADump());
    const r = run(['restore', f, '--yes'], { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('restored. Now run what that dump');
    expect(r.stderr).toContain('the checkout that pinned it');
    expect(r.stderr).toContain('Rolling back from it, step 9');
    expect(r.stderr).toContain('git checkout <the release before the move>');
    expect(r.stderr).toMatch(/up -d trigger-api trigger-supervisor/);
    expect(r.stderr).toContain('Not `');
    expect(r.stderr).not.toContain('Put TRIGGER_IMAGE_TAG and the SDK back');
  });
});

describe('pin refuses what it cannot pin', () => {
  it('asks for a version rather than guessing', () => {
    const r = run(['pin']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/needs a version/);
  });

  it('refuses something that is not a version, before asking the registry', () => {
    const r = run(['pin', 'latest']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('expected a tag like');
  });
});

describe('probe, which the pin watch runs, never reads an unread registry as "nothing newer"', () => {
  /**
   * `scripts/idp-pin-watch.mjs` asks `probe` for the tags above the pin
   * (workplan 0146 T8). The probe asks one manifest at a time, and a request
   * that fails reads exactly like a tag that does not exist. So a registry it
   * could not reach would say "nothing newer", and the watch would close its
   * issue. The tag it starts from has to answer first.
   */
  function offline(args: string[]) {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\necho "curl: (6) Could not resolve host" >&2\nexit 6\n', { mode: 0o755 });
    return run(args, { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` });
  }

  it('refuses when the tag it starts from does not answer, and prints no tag', () => {
    const r = offline(['probe', 'v4.7.2']);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('v4.7.2 does not answer in both images');
  });

  it('refuses something that is not a version, before asking the registry', () => {
    const r = offline(['probe', 'latest']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('expected a tag like');
    expect(r.stderr).not.toContain('Could not resolve host');
  });

  /**
   * The start answering is not enough: ghcr can flake halfway up the walk. A
   * tag above the pin that gets a 429, a 5xx, a timeout's 000 or the 403 an
   * empty token gets would read as "not published", so the newest the watch
   * reports could drop, or the issue close. Only a 404 is a missing tag.
   */
  function registry(v474: string) {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'curl'),
      [
        '#!/usr/bin/env bash',
        'url="${@: -1}"',
        'case "$url" in',
        `  *'/token?'*) echo '{"token":"t"}' ;;`,
        '  */manifests/v4.7.2|*/manifests/v4.7.3) printf 200 ;;',
        `  */manifests/v4.7.4) printf '%s' '${v474}' ;;`,
        '  *) printf 404 ;;',
        'esac',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    return run(['probe', 'v4.7.2'], { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` });
  }

  it('reads a 404 above the pin as a tag that is not there, and prints what it found', () => {
    const r = registry('404');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('v4.7.3\n');
  });

  it.each(['503', '429', '000', '403'])('refuses when a tag above the pin gets %s, and prints no tag', (code) => {
    const r = registry(code);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(`ghcr.io answered ${code} for triggerdotdev/trigger.dev:v4.7.4`);
  });
});

describe('pin moves every place the CI guard compares', () => {
  /**
   * `pin` moved apps/worker's SDK and left the root package.json (sdk AND
   * core) and packages/scheduler behind, so the scripted upgrade turned
   * bootstrap-managed.unit.test.ts red. The registry check comes first and
   * needs the network, so this runs the REWRITE — the lines from `bare=` to
   * the closing note — against copies of the real files.
   */
  const pin = /cmd_pin\(\) \{[\s\S]*?\n\}/.exec(script)?.[0] ?? '';
  const rewrite = pin.slice(pin.indexOf('  bare="${want#v}"'), pin.indexOf('  cat <<EOF'));
  const manifests = globSync('{,apps/*/,packages/*/}package.json', { cwd: REPO_ROOT });
  const TRIGGER_DEP = /("@trigger\.dev\/[a-z0-9-]+": ")[0-9]+\.[0-9]+\.[0-9]+(")/g;
  const declaresTrigger = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8').includes('"@trigger.dev/');

  it('read the real function', () => {
    expect(rewrite.startsWith('  bare='), 'cmd_pin no longer sets bare= the way this expects').toBe(true);
    expect(rewrite).toContain('sed -i');
    // Root, apps/worker and packages/scheduler today; none found means the glob moved.
    expect(manifests.filter(declaresTrigger).length).toBeGreaterThan(2);
  });

  /** The digests `tag_digest` would have read, before the slice; stubbed, since that asks ghcr. */
  const DIGESTS = { webapp_digest: `sha256:${'a'.repeat(64)}`, supervisor_digest: `sha256:${'b'.repeat(64)}` };
  const BUILDS = ['trigger.dev', 'supervisor'] as const;
  const copy = (rel: string) => {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), readFileSync(join(REPO_ROOT, rel)));
  };
  /** Runs the slice inside a function, as in the script: the block may declare `local`s. */
  const runRewrite = (want: string) =>
    spawnSync('bash', ['-c', `set -euo pipefail\nsay() { :; }\ndie() { echo "DIE: $*" >&2; exit 1; }\nrewrite() {\n${rewrite}\n}\nrewrite`], {
      encoding: 'utf8',
      env: { ...process.env, want, SCRIPT_DIR: join(dir, 'deploy/compose'), REPO_ROOT: dir, ...DIGESTS },
    });

  it('every @trigger.dev dependency, both compose defaults and the example, and nothing else', () => {
    const files = ['deploy/compose/managed.yml', 'deploy/compose/managed.env.example', ...manifests, ...BUILDS.map((b) => `deploy/compose/${b}/Dockerfile`)];
    files.forEach(copy);

    const r = runRewrite('v9.8.7');
    expect(r.status, r.stderr).toBe(0);

    for (const rel of manifests) {
      const before = readFileSync(join(REPO_ROOT, rel), 'utf8');
      expect(readFileSync(join(dir, rel), 'utf8'), `${rel} was not moved to 9.8.7, or more changed`).toBe(
        before.replace(TRIGGER_DEP, (_all, head: string, tail: string) => `${head}9.8.7${tail}`),
      );
    }
    const compose = readFileSync(join(dir, 'deploy/compose/managed.yml'), 'utf8');
    const defaults = [...compose.matchAll(/\$\{TRIGGER_IMAGE_TAG:-(v[^}]+)\}/g)].map((m) => m[1]);
    expect(defaults).toEqual(['v9.8.7', 'v9.8.7']);
    expect(readFileSync(join(dir, 'deploy/compose/managed.env.example'), 'utf8')).toMatch(
      /^TRIGGER_IMAGE_TAG=v9\.8\.7$/m,
    );
  });

  it("moves each build's FROM to the tag and its digest, and its name to the new hash, which is the pin watch's (0146 T16)", () => {
    ['deploy/compose/managed.yml', 'deploy/compose/managed.env.example', ...manifests, ...BUILDS.map((b) => `deploy/compose/${b}/Dockerfile`)].forEach(copy);
    const r = runRewrite('v9.8.7');
    expect(r.status, r.stderr).toBe(0);
    const before = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8').split('\n');
    const after = readFileSync(join(dir, 'deploy/compose/managed.yml'), 'utf8').split('\n');
    const changed = after.filter((line, i) => line !== before[i]);
    const want: string[] = [];
    for (const [i, name] of BUILDS.entries()) {
      const dockerfile = readFileSync(join(dir, `deploy/compose/${name}/Dockerfile`), 'utf8');
      const digest = i === 0 ? DIGESTS.webapp_digest : DIGESTS.supervisor_digest;
      expect(dockerfile, name).toMatch(new RegExp(`^FROM ghcr\\.io/triggerdotdev/${name.replace('.', '\\.')}:v9\\.8\\.7@${digest}$`, 'm'));
      // Only the FROM line moved in the Dockerfile.
      const real = readFileSync(join(REPO_ROOT, `deploy/compose/${name}/Dockerfile`), 'utf8').split('\n');
      expect(dockerfile.split('\n').filter((line, n) => line !== real[n]), name).toHaveLength(1);
      // The shell's hash and the JS one agree on the rewritten file.
      const hex = builtTag(dockerfile).slice('v9.8.7-'.length);
      want.push(`    image: localhost/${name}:\${TRIGGER_IMAGE_TAG:-v9.8.7}-${hex}`);
    }
    expect(changed).toEqual(want);
  });

  it('pins the same version again to take the digest it has today, and skips a build whose directory is gone', () => {
    ['deploy/compose/managed.yml', 'deploy/compose/managed.env.example', ...manifests, 'deploy/compose/trigger.dev/Dockerfile'].forEach(copy);
    // The supervisor's patch dropped: its line is ghcr's image again, and its directory is gone.
    const compose = join(dir, 'deploy/compose/managed.yml');
    const dropped = readFileSync(compose, 'utf8').replace(/localhost\/supervisor:(\$\{TRIGGER_IMAGE_TAG:-v[\d.]+\})-[0-9a-f]{12}/, 'ghcr.io/triggerdotdev/supervisor:$1');
    writeFileSync(compose, dropped);
    const pin = /\$\{TRIGGER_IMAGE_TAG:-(v[^}]+)\}/.exec(dropped)![1]!;
    const r = runRewrite(pin);
    expect(r.status, r.stderr).toBe(0);
    const after = readFileSync(compose, 'utf8');
    expect(after).toContain(`image: ghcr.io/triggerdotdev/supervisor:\${TRIGGER_IMAGE_TAG:-${pin}}\n`);
    expect(readFileSync(join(dir, 'deploy/compose/trigger.dev/Dockerfile'), 'utf8')).toMatch(new RegExp(`^FROM ghcr\\.io/triggerdotdev/trigger\\.dev:${pin.replaceAll('.', '\\.')}@${DIGESTS.webapp_digest}$`, 'm'));
    const hex = builtTag(readFileSync(join(dir, 'deploy/compose/trigger.dev/Dockerfile'), 'utf8')).slice(pin.length + 1);
    expect(after).toContain(`    image: localhost/trigger.dev:\${TRIGGER_IMAGE_TAG:-${pin}}-${hex}\n`);
  });

  it('refuses a Dockerfile whose FROM it cannot move, or a build line it cannot find, before it moves anything', () => {
    const files = ['deploy/compose/managed.yml', 'deploy/compose/managed.env.example', ...manifests, ...BUILDS.map((b) => `deploy/compose/${b}/Dockerfile`)];
    const snapshot = () => Object.fromEntries(files.map((rel) => [rel, readFileSync(join(dir, rel), 'utf8')]));
    files.forEach(copy);
    const file = join(dir, 'deploy/compose/supervisor/Dockerfile');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^FROM (\S+)@sha256:[0-9a-f]{64}$/m, 'FROM $1'));
    let before = snapshot();
    let r = runRewrite('v9.8.7');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('has no FROM ghcr.io/triggerdotdev/supervisor:<tag>@<digest> line to move');
    expect(r.stderr).toContain('Nothing was moved.');
    // The webapp's FROM and name, managed.yml's defaults, the example and every manifest are as they were.
    expect(snapshot()).toEqual(before);
    // The supervisor's name line gone from managed.yml: the same.
    files.forEach(copy);
    const compose = join(dir, 'deploy/compose/managed.yml');
    writeFileSync(compose, readFileSync(compose, 'utf8').replace(/^ {4}image: localhost\/supervisor:.*$/m, '    image: localhost/supervisor:latest'));
    before = snapshot();
    r = runRewrite('v9.8.7');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('managed.yml does not name the build of');
    expect(r.stderr).toContain('Nothing was moved.');
    expect(snapshot()).toEqual(before);
  });

  it("says to read the Dockerfiles again and wait for both builds before the backup and the drain, and never to pin backwards", () => {
    const text = pin.slice(pin.indexOf('  cat <<EOF'));
    const order = ['read_at', 'build (trigger, amd64) and build (trigger, arm64)', 'backup before-', 'drain EXECUTING first', 'E2E (managed)'].map((s) => text.indexOf(s));
    expect(order.every((i) => i > 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('Never pin\nbackwards');
    expect(text).not.toContain('and pinning the old version');
    // An unquoted heredoc runs anything in backticks: none in it.
    expect(text).not.toContain('`');
  });
});

describe('the builds here, read and asked for as trigger-version.sh does (0146 T16)', () => {
  const fn = (name: string) => new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}`, 'm').exec(script)?.[0] ?? '';

  it('`list` reads the running tag without the hash a build ends its name in', () => {
    expect(fn('running_tag')).toContain('docker inspect');
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    for (const [image, want] of [
      ['localhost/trigger.dev:v4.8.1-72939d99d1b8', 'v4.8.1'],
      ['ghcr.io/triggerdotdev/trigger.dev:v4.8.1', 'v4.8.1'],
    ] as const) {
      writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\necho '${image}'\n`, { mode: 0o755 });
      const r = spawnSync('bash', ['-c', `set -euo pipefail\nAPI_CONTAINER=x\n${fn('running_tag')}\nrunning_tag`], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` },
      });
      expect(r.stdout, image).toBe(`${want}\n`);
    }
  });

  it('`list` prints the image trigger-api runs in full and the build this checkout names, and says when they differ', () => {
    const compose = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');
    const named = /localhost\/trigger\.dev:\$\{TRIGGER_IMAGE_TAG:-(v[^}]+)\}-([0-9a-f]{12})/.exec(compose)!;
    const [, pin, hex] = named;
    const stack = join(dir, 'compose');
    mkdirSync(stack, { recursive: true });
    writeFileSync(join(stack, 'managed.yml'), compose);
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const lines = (running: string, env?: string) => {
      writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\necho '${running}'\n`, { mode: 0o755 });
      if (env === undefined) rmSync(join(stack, '.env'), { force: true });
      else writeFileSync(join(stack, '.env'), env);
      const body = ['set -euo pipefail', `. '${join(REPO_ROOT, 'deploy/compose/env-read.sh')}'`, `SCRIPT_DIR='${stack}'`, `ENV_FILE='${stack}/.env'`, 'API_CONTAINER=x', fn('repo_tag'), fn('checkout_image'), fn('build_lines'), 'build_lines'].join('\n');
      const r = spawnSync('bash', ['-c', body], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` } });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout;
    };
    const same = lines(`localhost/trigger.dev:${pin}-${hex}`);
    expect(same).toContain(`  image     localhost/trigger.dev:${pin}-${hex}\n`);
    expect(same).toContain(`  builds    localhost/trigger.dev:${pin}-${hex}`);
    expect(same).not.toContain('NOTE');
    // Another build of the same version: the version reads the same, the build does not.
    expect(lines(`localhost/trigger.dev:${pin}-000000000000`)).toContain('NOTE      trigger-api runs another image than this checkout names');
    // The .env's version names the build.
    expect(lines(`localhost/trigger.dev:v9.9.9-${hex}`, "TRIGGER_IMAGE_TAG='v9.9.9'\n")).not.toContain('NOTE');
  });

  /** `tag_digest` against a stubbed ghcr, whose headers come after a proxy's own answer to CONNECT. */
  function digestOf(type: string, digest: string) {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'curl'),
      [
        '#!/usr/bin/env bash',
        'url="${@: -1}"',
        'case "$url" in',
        `  *'/token?'*) echo '{"token":"t"}' ;;`,
        `  *) printf 'HTTP/1.1 200 Connection Established\r\n\r\nHTTP/2 200 \r\ncontent-type: %s\r\ndocker-content-digest: %s\r\n\r\n' '${type}' '${digest}' ;;`,
        'esac',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const body = ['set -euo pipefail', 'die() { echo "DIE: $*" >&2; exit 1; }', 'TOKEN_trigger_dev=""; TOKEN_supervisor=""', fn('ghcr_token'), fn('tag_digest'), 'tag_digest supervisor v9.8.7'].join('\n');
    return spawnSync('bash', ['-c', body], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` } });
  }

  it("reads an index's digest, and refuses a one-platform manifest or a missing digest", () => {
    const ok = digestOf('application/vnd.oci.image.index.v1+json', `sha256:${'c'.repeat(64)}`);
    expect(ok.stderr).toBe('');
    expect(ok.stdout).toBe(`sha256:${'c'.repeat(64)}\n`);
    expect(digestOf('application/vnd.docker.distribution.manifest.list.v2+json', `sha256:${'d'.repeat(64)}`).stdout).toBe(`sha256:${'d'.repeat(64)}\n`);
    const one = digestOf('application/vnd.oci.image.manifest.v1+json', `sha256:${'c'.repeat(64)}`);
    expect(one.status).not.toBe(0);
    expect(one.stderr).toContain('not an index of platforms');
    const none = digestOf('application/vnd.oci.image.index.v1+json', 'sha256:short');
    expect(none.status).not.toBe(0);
    expect(none.stderr).toContain('gave no digest');
  });

  it('pin asks both digests after both tags answer and before anything moves', () => {
    const pin = fn('cmd_pin');
    const asked = pin.indexOf('webapp_digest="$(tag_digest trigger.dev "$want")"');
    expect(asked).toBeGreaterThan(pin.indexOf('tag_exists supervisor'));
    expect(pin.indexOf('supervisor_digest="$(tag_digest supervisor "$want")"')).toBeGreaterThan(asked);
    expect(pin.indexOf('bare="${want#v}"')).toBeGreaterThan(asked);
  });
});

describe('the drill cannot touch the live database', () => {
  const drill = /cmd_drill\(\) \{[\s\S]*?\n\}/.exec(script)?.[0] ?? '';

  it('read the real function', () => {
    expect(drill.length).toBeGreaterThan(400);
  });

  it('drops only the throwaway, never the database it is protecting', () => {
    // Every DROP DATABASE in the drill names ${drill_db}. One naming
    // ${DB_NAME} would destroy the thing the backup exists for, during a
    // routine nightly, which is the worst failure this file can imagine.
    // To end of line: the trap's quoting puts a `'` mid-statement, and a
    // regex stopping there would inspect `DROP DATABASE IF EXISTS ` and find
    // no database name in it — passing while reading nothing.
    const drops = [...drill.matchAll(/DROP DATABASE[^\n]*/g)].map((m) => m[0]);
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) {
      expect(d, `a DROP in the drill does not name the throwaway: ${d}`).toContain('drill_db');
      expect(d).not.toContain('${DB_NAME}');
    }
  });

  it('compares against a schema big enough to be real', () => {
    // Two empty databases match perfectly. Without a floor, the drill would
    // pass most convincingly when it had proved nothing at all.
    expect(drill).toContain('-ge 10');
  });

  it('drops the throwaway even when the load fails', () => {
    expect(drill).toMatch(/trap .*DROP DATABASE IF EXISTS.*EXIT/);
  });
});

describe('the managed gate runs the drill, so the backup is never only a claim', () => {
  it('is a step in the gate', () => {
    expect(workflow).toContain('trigger-version.sh drill');
  });

  it('runs before the acceptance smoke, while the stack is known-good', () => {
    // After the bring-up (there is a database to dump) and before the smoke
    // starts writing to the product — a dump taken mid-migration is a
    // snapshot of a moving thing.
    const drillAt = workflow.indexOf('trigger-version.sh drill');
    const smokeAt = workflow.indexOf('The acceptance smoke');
    expect(drillAt).toBeGreaterThan(-1);
    expect(drillAt).toBeLessThan(smokeAt);
  });

  it('the gate never runs restore, which is a human decision', () => {
    expect(workflow).not.toMatch(/trigger-version\.sh restore/);
  });
});

describe('the backup lands where the next run can still find it', () => {
  it('defaults outside the checkout, like .env does', () => {
    // actions/checkout cleans ignored files before every run. A backup inside
    // the working tree would be deleted by the next run — precisely when it
    // was needed.
    expect(script).toContain('MANAGED_ENV_PERSIST_DIR');
    expect(script).not.toMatch(/BACKUP_DIR=.*SCRIPT_DIR/);
  });
});

describe('nothing but the path comes out of the thing that returns a path', () => {
  /**
   * `cmd_backup` returns the file it wrote by printing it, and `cmd_drill`
   * captures that. So anything else printed to stdout becomes part of the
   * value — which is how the drill's first live run logged its verdict but
   * not the "dumping"/"verified" lines above it: `$(cmd_backup drill |
   * tail -1)` had eaten them.
   *
   * The same shape as smoke-managed.sh's `mint()`, whose stdout was the token
   * and which printed a warning into it. A lesson written next to one caller,
   * again, not reaching the next one.
   */
  it('say goes to stderr', () => {
    expect(script).toMatch(/^say\(\) \{ echo "\[trigger-version\] \$\*" >&2; \}$/m);
  });

  it('cmd_backup prints exactly one thing to stdout: the path', () => {
    const fn = /cmd_backup\(\) \{[\s\S]*?\n\}/.exec(script)?.[0] ?? '';
    expect(fn.length).toBeGreaterThan(200);
    // Every bare `echo` in it would land in the caller's captured value.
    const bare = [...fn.matchAll(/^\s*echo .*$/gm)]
      .map((m) => m[0])
      .filter((l) => !/>&2/.test(l));
    expect(bare.map((l) => l.trim())).toEqual(['echo "$out"']);
  });
});

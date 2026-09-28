// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE RULE FOR A RELEASE TAG, IN TWO SCRIPTS (workplan 0146 T5, 0132 T6 (a) and T1b).
 *
 * Live runs releases. `deploy/compose/deploy-live.sh` moves live to one, and
 * `deploy/compose/stand-up-live.sh` stands live up the first time from the
 * one its checkout is parked on. The rule for what a release tag is (a tag
 * name, on origin, the same object here as there, annotated, named `v…`, and
 * its commit's root `package.json` saying the version) was written inline in
 * deploy-live.sh. A second copy in the stand-up script would drift from the
 * first the day somebody changed one, and live would then be stood up from a
 * tag it could never be deployed to again, or the other way round.
 *
 * So the rule is now `deploy/compose/release-tag.sh`, a sourced library,
 * with deploy-live.sh's own words. deploy-live.sh does not source it yet
 * (another change edits that script; a follow-up makes it source the library).
 * Until then this guard is what keeps them one rule: it drives BOTH on the
 * same tags, in real git repositories with a bare origin beside them, and
 * they must accept the same tags and refuse the rest in the same words, every
 * line of each refusal (until 2026-09-28 only the first sentence was
 * compared, and the library's words for a tag origin has and the fetch did
 * not bring were its own). The library is driven the way deploy-live.sh uses it: the origin
 * half, then `git fetch --tags origin`, then the half that asks this clone.
 * deploy-live.sh runs with `--dry-run`, which stops before the checkout, with
 * `docker` and `psql` stubbed to report an open hold and nothing in flight.
 *
 * A tag that differs here from origin is the one case where only the verdict
 * is compared: deploy-live.sh refuses it at its fetch, whose words are its
 * own, and the library refuses it at the same fetch in the harness below.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const RELEASE_SENTENCE = 'live runs releases: name a release tag';
const CASE_MS = 60_000;
/** The real git, for a wrapper on a case's PATH to hand everything else to. */
const REAL_GIT = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const DOCKER_STUB = `#!/usr/bin/env bash
[ "$1" = compose ] || exit 98
shift
file='' env_file=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -f) file="$2"; shift 2 ;;
    --env-file) env_file="$2"; shift 2 ;;
    *) break ;;
  esac
done
case "$1" in
  config) printf 'name: %s\\nservices: {}\\n' "$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' "$env_file")"; exit 0 ;;
  # exec -T postgres sh -c '<command>': the script's own psql line runs, against the stub.
  exec) export POSTGRES_USER=openmigrate POSTGRES_DB=openmigrate; exec sh -c "$6" ;;
esac
exit 96
`;
// An open hold fifteen minutes old, nothing in flight, as a superuser.
const PSQL_STUB = `#!/usr/bin/env bash
cat >/dev/null
printf 'yes|1|900|0\\n'
`;
const BOOTSTRAP_STUB = '#!/usr/bin/env bash\nexit 0\n';

const LIVE_ENV = 'COMPOSE_PROJECT_NAME=ownpace-live\nSTACK_KIND=production\nWEB_URL=https://app.example.test\n';

const gitEnv = (home: string): NodeJS.ProcessEnv => ({
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
  LANG: 'C',
});

function git(root: string, cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv(root) });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function writeExec(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

const pkg = (version: string): string => `${JSON.stringify({ name: 'ownpace', version, private: true }, null, 2)}\n`;

interface Stage {
  root: string;
  work: string;
  bin: string;
  commit: Record<string, string>;
}

/**
 * v0.2.0-alpha.1 is the release the checkout holds. `setup` adds whatever the
 * case needs on top, through the helpers it is handed.
 */
function stage(setup: (s: Stage, h: { release: (tag: string, version: string, opts?: { lightweight?: boolean; push?: boolean }) => void }) => void): Stage {
  const root = mkdtempSync(join(tmpdir(), 'release-rule-'));
  tempDirs.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'ownpace-live');
  const compose = join(work, 'deploy', 'compose');
  const commit: Record<string, string> = {};
  git(root, root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, root, 'init', '-q', '-b', 'main', work);
  git(root, work, 'remote', 'add', 'origin', origin);
  writeFileSync(join(work, '.gitignore'), '.env\n');
  writeFileSync(join(work, 'package.json'), pkg('0.2.0-alpha.1'));
  mkdirSync(compose, { recursive: true });
  for (const f of ['deploy-live.sh', 'env-read.sh', 'stack-kind.sh', 'release-tag.sh', 'own-addresses.sh', 'www-live.sh']) {
    copyFileSync(join(COMPOSE_DIR, f), join(compose, f));
    chmodSync(join(compose, f), 0o755);
  }
  copyFileSync(join(COMPOSE_DIR, 'managed.yml'), join(compose, 'managed.yml'));
  writeExec(join(compose, 'bootstrap-managed.sh'), BOOTSTRAP_STUB);
  writeExec(join(compose, 'exposure-check.sh'), BOOTSTRAP_STUB);
  // The copy before the update (0139): the dry run asks it, and it answers yes.
  writeExec(join(compose, 'copy-before-update.sh'), BOOTSTRAP_STUB);
  mkdirSync(join(work, 'packages', 'ledger', 'migrations'), { recursive: true });
  mkdirSync(join(work, 'packages', 'managed', 'migrations'), { recursive: true });
  writeFileSync(join(work, 'packages', 'ledger', 'migrations', '0001_first.sql'), 'SELECT 1;\n');
  writeFileSync(join(work, 'packages', 'managed', 'migrations', '0001_managed.sql'), 'SELECT 1;\n');
  git(root, work, 'add', '-A');
  git(root, work, 'commit', '-q', '-m', 'the running release');
  git(root, work, 'tag', '-a', 'v0.2.0-alpha.1', '-m', 'Ownpace v0.2.0-alpha.1');
  commit['v0.2.0-alpha.1'] = git(root, work, 'rev-parse', 'HEAD');
  git(root, work, 'push', '-q', 'origin', 'main', 'refs/tags/v0.2.0-alpha.1');

  const s: Stage = { root, work, bin: join(root, 'bin'), commit };
  const release = (tag: string, version: string, opts: { lightweight?: boolean; push?: boolean } = {}) => {
    writeFileSync(join(work, 'package.json'), pkg(version));
    writeFileSync(join(work, 'RELEASE'), `${tag}\n`);
    git(root, work, 'add', '-A');
    git(root, work, 'commit', '-q', '-m', `release ${tag}`);
    if (opts.lightweight) git(root, work, 'tag', tag);
    else git(root, work, 'tag', '-a', tag, '-m', `Ownpace ${tag}`);
    commit[tag] = git(root, work, 'rev-parse', 'HEAD');
    git(root, work, 'push', '-q', 'origin', 'main');
    if (opts.push !== false) git(root, work, 'push', '-q', 'origin', `refs/tags/${tag}`);
  };
  setup(s, { release });
  git(root, work, 'checkout', '-q', '--detach', 'refs/tags/v0.2.0-alpha.1');
  writeFileSync(join(compose, '.env'), LIVE_ENV);
  writeExec(join(s.bin, 'docker'), DOCKER_STUB);
  writeExec(join(s.bin, 'psql'), PSQL_STUB);
  return s;
}

const env = (s: Stage): NodeJS.ProcessEnv => ({ ...gitEnv(s.root), PATH: `${s.bin}:${gitEnv(s.root).PATH}` });

interface Verdict {
  accepted: boolean;
  first: string;
  /** Every line of the refusal: the first, then each one after it, unindented. */
  lines: string[];
  out: string;
}

/** The refusal's lines: the one after `marker`, then each indented line that follows it. */
function refusalLines(out: string, marker: string): string[] {
  const all = out.split('\n');
  const at = all.findIndex((l) => l.startsWith(marker));
  if (at < 0) return [];
  const lines = [all[at]!.slice(marker.length)];
  for (const l of all.slice(at + 1)) {
    if (!l.startsWith('  ')) break;
    lines.push(l.slice(2));
  }
  return lines;
}

/** deploy-live.sh --dry-run <tag>, stopped before the checkout. */
function viaDeployLive(s: Stage, tag: string): Verdict {
  const r = spawnSync(join(s.work, 'deploy', 'compose', 'deploy-live.sh'), ['--dry-run', tag], {
    cwd: s.work,
    encoding: 'utf8',
    env: env(s),
    timeout: 60_000,
  });
  // The refusal goes to stderr, whole, after anything said on stdout.
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const first = /\[deploy-live\] refused: (.*)/.exec(out)?.[1] ?? '';
  return { accepted: r.status === 0, first, lines: refusalLines(out, '[deploy-live] refused: '), out };
}

/** The library, the way deploy-live.sh will use it: origin, fetch, this clone. In a copy of the checkout. */
function viaLibrary(s: Stage, tag: string): Verdict & { commit: string; version: string } {
  const copy = `${s.work}-copy`;
  cpSync(s.work, copy, { recursive: true });
  const harness = `set -euo pipefail
. "$1/deploy/compose/release-tag.sh"
why() { printf 'refused: %s\\n' "\${RELEASE_TAG_WHY[0]}"; [ "\${#RELEASE_TAG_WHY[@]}" -eq 1 ] || printf '  %s\\n' "\${RELEASE_TAG_WHY[@]:1}"; }
if ! release_tag_on_origin "$1" "$2"; then why; exit 1; fi
git -C "$1" fetch -q --tags origin 2>/dev/null || { echo 'refused: at the fetch'; exit 1; }
if ! release_tag_is_release "$1" "$2" "$RELEASE_TAG_REMOTE_OBJECT"; then why; exit 1; fi
printf 'release: %s %s\\n' "$RELEASE_TAG_COMMIT" "$RELEASE_TAG_VERSION"
`;
  const r = spawnSync('bash', ['-c', harness, 'harness', copy, tag], { encoding: 'utf8', env: env(s), timeout: 60_000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const released = /release: (\S+) (\S+)/.exec(out);
  return {
    accepted: r.status === 0,
    first: /refused: (.*)/.exec(out)?.[1] ?? '',
    lines: refusalLines(out, 'refused: '),
    out,
    commit: released?.[1] ?? '',
    version: released?.[2] ?? '',
  };
}

type Case = [string, (s: Stage, h: { release: (tag: string, version: string, opts?: { lightweight?: boolean; push?: boolean }) => void }) => string, 'release' | 'refused' | 'refused, at the fetch'];

const CASES: Case[] = [
  ['an annotated v… tag on origin whose package.json agrees', (_s, h) => (h.release('v0.2.0-alpha.2', '0.2.0-alpha.2'), 'v0.2.0-alpha.2'), 'release'],
  [
    'a release tag origin has and this clone does not yet',
    (s, h) => {
      h.release('v0.2.0-alpha.2', '0.2.0-alpha.2');
      git(s.root, s.work, 'tag', '-d', 'v0.2.0-alpha.2');
      return 'v0.2.0-alpha.2';
    },
    'release',
  ],
  ['a branch name', () => 'main', 'refused'],
  ['a commit', (s, h) => (h.release('v0.2.0-alpha.2', '0.2.0-alpha.2'), s.commit['v0.2.0-alpha.2']!), 'refused'],
  ['a name that is no tag here or on origin', () => 'v9.9.9', 'refused'],
  ['a name git does not take as a tag', () => 'v1..2', 'refused'],
  ['a lightweight tag', (_s, h) => (h.release('v0.2.0-alpha.2', '0.2.0-alpha.2', { lightweight: true }), 'v0.2.0-alpha.2'), 'refused'],
  ['a tag only this clone has', (_s, h) => (h.release('v0.2.0-alpha.2', '0.2.0-alpha.2', { push: false }), 'v0.2.0-alpha.2'), 'refused'],
  ['a tag whose name does not start with v', (_s, h) => (h.release('alpha-2', '0.2.0-alpha.2'), 'alpha-2'), 'refused'],
  ["a tag whose package.json says another version", (_s, h) => (h.release('v0.2.0-alpha.2', '0.2.0-alpha.1'), 'v0.2.0-alpha.2'), 'refused'],
  [
    'a release tag origin has and the fetch does not bring here',
    (s, h) => {
      h.release('v0.2.0-alpha.2', '0.2.0-alpha.2');
      git(s.root, s.work, 'tag', '-d', 'v0.2.0-alpha.2');
      // git, but a fetch that brings nothing: what a fetch interrupted, or one
      // told to leave tags alone, leaves behind.
      writeExec(join(s.bin, 'git'), `#!/usr/bin/env bash\nfor a in "$@"; do [ "$a" = fetch ] && exit 0; done\nexec '${REAL_GIT}' "$@"\n`);
      return 'v0.2.0-alpha.2';
    },
    'refused',
  ],
  [
    "a tag here that is not origin's",
    (s, h) => {
      h.release('v0.2.0-alpha.2', '0.2.0-alpha.2');
      h.release('v0.2.0-alpha.3', '0.2.0-alpha.3');
      git(s.root, s.work, 'tag', '-f', '-a', 'v0.2.0-alpha.2', '-m', 'moved', s.commit['v0.2.0-alpha.3']!);
      return 'v0.2.0-alpha.2';
    },
    'refused, at the fetch',
  ],
];

describe('deploy-live.sh and release-tag.sh take the same tags, and refuse the rest in the same words', () => {
  it.each(CASES)(
    '%s',
    (_label, setup, expected) => {
      let tag = '';
      const s = stage((st, h) => {
        tag = setup(st, h);
      });
      const lib = viaLibrary(s, tag);
      const deploy = viaDeployLive(s, tag);

      expect(deploy.accepted, `deploy-live.sh:\n${deploy.out}`).toBe(expected === 'release');
      expect(lib.accepted, `release-tag.sh:\n${lib.out}`).toBe(expected === 'release');
      if (expected === 'release') {
        expect(lib.commit).toBe(git(s.root, s.work, 'rev-parse', `${tag}^{commit}`));
        expect(lib.version).toBe(tag.replace(/^v/, ''));
        expect(deploy.out).toContain(`${tag} is an annotated release tag on origin, at ${lib.commit}, version ${lib.version}`);
      } else if (expected === 'refused') {
        expect(lib.first, lib.out).not.toBe('');
        expect(lib.first).toBe(deploy.first);
        // Word for word, every line: deploy-live.sh will source the library.
        expect(lib.lines, lib.out).toEqual(deploy.lines);
        expect(lib.first).toMatch(/\bgit ls-remote\b|live runs releases: name a release tag|not here after the fetch/);
      } else {
        expect(deploy.first).toMatch(/fetch/);
        expect(lib.first).toMatch(/fetch/);
      }
    },
    CASE_MS,
  );

  it('the library holds the sentence 0146 T5 names, once', () => {
    const r = spawnSync('bash', ['-c', `. "${join(COMPOSE_DIR, 'release-tag.sh')}"; printf '%s' "$RELEASE_SENTENCE"`], {
      encoding: 'utf8',
    });
    expect(r.stdout).toBe(RELEASE_SENTENCE);
  });

  it('stops at the fetch with neither half: without a fetch, a tag here that is not origin\'s is refused by the second half', () => {
    // stand-up-live.sh fetches nothing (its HEAD is at the tag already), so the
    // second half is what refuses a moved tag there.
    let tag = '';
    const s = stage((st, h) => {
      h.release('v0.2.0-alpha.2', '0.2.0-alpha.2');
      h.release('v0.2.0-alpha.3', '0.2.0-alpha.3');
      git(st.root, st.work, 'tag', '-f', '-a', 'v0.2.0-alpha.2', '-m', 'moved', st.commit['v0.2.0-alpha.3']!);
      tag = 'v0.2.0-alpha.2';
    });
    const harness = `set -euo pipefail
. "$1/deploy/compose/release-tag.sh"
release_tag_on_origin "$1" "$2" || { printf 'refused: %s\\n' "\${RELEASE_TAG_WHY[0]}"; exit 1; }
release_tag_is_release "$1" "$2" "$RELEASE_TAG_REMOTE_OBJECT" || { printf 'refused: %s\\n' "\${RELEASE_TAG_WHY[@]}"; exit 1; }
echo release
`;
    const r = spawnSync('bash', ['-c', harness, 'harness', s.work, tag], { encoding: 'utf8', env: env(s) });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain(`the tag '${tag}' here is not origin's`);
    expect(r.stdout).toContain(RELEASE_SENTENCE);
    expect(r.stdout).toContain(`git tag -d ${tag}`);
  });
});

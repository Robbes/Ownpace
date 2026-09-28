// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RELEASE THAT NAMES ITSELF: nothing checked that a tag, the root `package.json` and `CHANGELOG.md` name the same release before the tag published images and a release (workplan 0146 T2).
 *
 * ## Three names for one release, and nothing comparing them
 *
 * A release is named three times. The tag (`v0.1.0-rc.1`) is what the three
 * publishing workflows read. The root `package.json`'s `version` is what
 * `/version` and the page's build stamp answer (`buildIdentity()`). The
 * changelog heading is the release's prose, and the release body links to it.
 * `docs/release.md` asks a person to bump the version and rename
 * `[Unreleased]` before the tag. No workflow checked that anybody had. A tag
 * pushed without the bump would have published images tagged with the new
 * version whose `/version` said `0.1.0-rc.1`, and a release whose body links
 * to a section that is not there.
 *
 * A name can also agree with itself and still be wrong. SemVer compares
 * pre-release identifiers in ASCII order, and `alpha` sorts before `rc`, so
 * `v0.1.0-alpha.1` is OLDER than `v0.1.0-rc.1` to anything that compares
 * versions: `sort -V`, a SemVer library, an upgrade check. That is option (c)
 * of 0146 T0, and it would have made the alpha older than the build of
 * 2026-08-04.
 *
 * ## What holds it
 *
 * `scripts/release-names-agree.mjs` refuses when the tag is not `v` plus the
 * root version, when `CHANGELOG.md` has no `## [<version>] - <date>` heading,
 * and when SemVer orders the tag at or below a release tag that already
 * exists. It runs as the first step after the checkout of each job that
 * publishes on a tag, so a tag whose names disagree publishes nothing. It
 * imports only Node's own modules, because it runs before any install.
 *
 * ## What this test holds
 *
 * (a) The check's pure function refuses the three shapes 0146 T2 names and
 * accepts a set that agrees; the SemVer order it uses is semver.org's §11; and
 * the command a workflow runs reads the tag, the two files and `git tag --list`
 * as a workflow would, in a throwaway repository.
 *
 * (b) Every workflow that runs on a tag, and has a step that publishes, calls
 * the check before its first publishing step. Read from the parsed YAML, by
 * these rules:
 *
 * - **Runs on a tag:** a `push` trigger with `tags` or `tags-ignore`, or with
 *   no ref filter at all (a bare `push` runs for every ref, tags included; a
 *   branch filter alone keeps tags out); or a `create` or `release` trigger.
 * - **Publishes:** a step that puts something where others fetch it. A
 *   `docker/build-push-action` or `docker/bake-action` whose `push` is not
 *   literally false (an expression counts: on a tag it is true); any action
 *   whose repository name says `release` or `publish`
 *   (`softprops/action-gh-release` and its kind); or a `run:` that calls
 *   `docker push`, `docker buildx … --push`, `docker buildx imagetools
 *   create`, `docker manifest push`, `gh release create|upload|edit`,
 *   `npm|pnpm|yarn publish`, `cosign sign|attest`, `oras|crane push|copy` or
 *   `skopeo copy`. Shell comment lines are not read. Artifacts
 *   (`upload-artifact`) and code-scanning uploads are not publishing: they
 *   are records of the run, not the release.
 * - **Calls the check:** a `run:` with a line `node
 *   scripts/release-names-agree.mjs`, with no `||` after it, no `set +e` in
 *   the block and no `continue-on-error`, whose `if:` is absent or a tag
 *   condition (`startsWith(github.ref, 'refs/tags/')`), and with the release
 *   tags fetched first, in the same step or by the checkout. Without that
 *   fetch a shallow checkout holds only the tag being cut, and the ordering
 *   check would compare it with nothing.
 *
 * The rules themselves are tested on small jobs below, so that a rule that
 * went blind fails here rather than passing everything. `ci.yml` runs on tags
 * and publishes nothing, so it is not wired (0146 T2 says so), and the test
 * says that too.
 *
 * ## What this does not prove
 *
 * That the check has run on a real tag: none has been cut since
 * `v0.1.0-rc.1`. It cannot stop a tag being pushed; it stops what the tag
 * would publish. And it does not read what the changelog section says, which
 * is the owner's to read (0146 T1).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { checkReleaseNames, compareSemVer, parseSemVer } from './release-names-agree.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const SCRIPT = join(HERE, 'release-names-agree.mjs');

/** A changelog in the repository's shape: `[Unreleased]` first, then the given headings, each with a line under it. */
function changelog(...headings: string[]): string {
  return [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '- Something not released yet.',
    '',
    ...headings.flatMap((h) => [h, '', '- What it has.', '']),
  ].join('\n');
}

const RC1 = '## [0.1.0-rc.1] - 2026-08-04';
const ALPHA1 = '## [0.2.0-alpha.1] - 2026-10-01';

// ---------------------------------------------------------------------------
// (a) The check
// ---------------------------------------------------------------------------

describe('the check: a tag, the root version and the changelog that name one release', () => {
  it('refuses v0.2.0-alpha.1 while package.json still says 0.1.0-rc.1', () => {
    const { refusals } = checkReleaseNames({
      tag: 'v0.2.0-alpha.1',
      version: '0.1.0-rc.1',
      changelog: changelog(ALPHA1, RC1),
      existingTags: ['v0.1.0-rc.1', 'v0.2.0-alpha.1'],
    });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('v0.2.0-alpha.1');
    expect(refusals[0]).toContain('package.json');
    expect(refusals[0]).toContain('0.1.0-rc.1');
  });

  it('refuses a version whose changelog has no section', () => {
    const { refusals } = checkReleaseNames({
      tag: 'v0.2.0-alpha.1',
      version: '0.2.0-alpha.1',
      changelog: changelog(RC1),
      existingTags: ['v0.1.0-rc.1'],
    });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('CHANGELOG.md');
    expect(refusals[0]).toContain('## [0.2.0-alpha.1] - ');
  });

  it('refuses v0.1.0-alpha.1 when v0.1.0-rc.1 exists, since SemVer orders it before', () => {
    const { refusals } = checkReleaseNames({
      tag: 'v0.1.0-alpha.1',
      version: '0.1.0-alpha.1',
      changelog: changelog('## [0.1.0-alpha.1] - 2026-10-01', RC1),
      existingTags: ['v0.1.0-rc.1', 'v0.1.0-alpha.1'],
    });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('v0.1.0-alpha.1');
    expect(refusals[0]).toContain('v0.1.0-rc.1');
  });

  it('accepts a tag, a version and a section that agree, newer than every release', () => {
    // The tag being cut is among the existing ones on its own run: the
    // checkout fetched it. It is not compared with itself.
    expect(
      checkReleaseNames({
        tag: 'v0.2.0-alpha.1',
        version: '0.2.0-alpha.1',
        changelog: changelog(ALPHA1, RC1),
        existingTags: ['v0.1.0-rc.1', 'v0.2.0-alpha.1'],
      }),
    ).toEqual({ refusals: [], ignoredTags: [] });
    expect(
      checkReleaseNames({ tag: 'v0.2.0-alpha.2', version: '0.2.0-alpha.2', changelog: changelog('## [0.2.0-alpha.2] - 2026-10-08', ALPHA1), existingTags: ['v0.1.0-rc.1', 'v0.2.0-alpha.1'] }).refusals,
    ).toEqual([]);
    // The first release of all has nothing to be newer than.
    expect(checkReleaseNames({ tag: 'v0.1.0-rc.1', version: '0.1.0-rc.1', changelog: changelog(RC1) }).refusals).toEqual([]);
  });

  it('names every disagreement at once, so one fix is not followed by another refusal', () => {
    const { refusals } = checkReleaseNames({
      tag: 'v0.1.0-alpha.1',
      version: '0.1.0-rc.1',
      changelog: changelog(RC1),
      existingTags: ['v0.1.0-rc.1'],
    });
    expect(refusals).toHaveLength(3);
    expect(refusals.join('\n')).toMatch(/package\.json[\s\S]*CHANGELOG\.md[\s\S]*v0\.1\.0-rc\.1/);
  });

  it('refuses a tag that is not "v" and a SemVer version', () => {
    for (const tag of ['0.2.0-alpha.1', 'v0.2', 'v0.2.0-alpha.01', 'release-0.2.0', 'v0.2.0-alpha.1 ', 'V0.2.0-alpha.1', '']) {
      const { refusals } = checkReleaseNames({ tag, version: '0.2.0-alpha.1', changelog: changelog(ALPHA1) });
      expect(refusals.length, `tag ${JSON.stringify(tag)}`).toBeGreaterThan(0);
      expect(refusals[0], `tag ${JSON.stringify(tag)}`).toContain('not a release name');
    }
  });

  it('refuses a tag equal in precedence to one that exists: build metadata does not make it newer', () => {
    const { refusals } = checkReleaseNames({
      tag: 'v0.2.0-alpha.1',
      version: '0.2.0-alpha.1',
      changelog: changelog(ALPHA1),
      existingTags: ['v0.2.0-alpha.1+first-try', 'v0.1.0-rc.1'],
    });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('v0.2.0-alpha.1+first-try');
  });

  it('says why the tag sorts below, from the first identifier that differs, not a stock sentence', () => {
    // The refusal most likely to be seen: alpha.N checked once alpha.N+1 is
    // tagged (a re-run of an older tag). Numbers decide it, not "alpha" and "rc".
    const whyBelow = (tag: string, existing: string): string => {
      const version = tag.slice(1);
      const { refusals } = checkReleaseNames({
        tag,
        version,
        changelog: changelog(`## [${version}] - 2026-10-01`),
        existingTags: [existing],
      });
      expect(refusals, `${tag} after ${existing}`).toHaveLength(1);
      return refusals[0]!;
    };

    const numbers = whyBelow('v0.2.0-alpha.1', 'v0.2.0-alpha.2');
    expect(numbers).toContain('1 is lower than 2');
    expect(numbers).not.toMatch(/\brc\b|ASCII/);

    const words = whyBelow('v0.1.0-alpha.1', 'v0.1.0-rc.1');
    expect(words).toContain('ASCII');
    expect(words).toContain('"alpha" sorts before "rc"');

    // The identifiers it quotes are the ones that differ, whatever they are.
    const otherWords = whyBelow('v0.2.0-beta.1', 'v0.2.0-rc.1');
    expect(otherWords).toContain('"beta" sorts before "rc"');
    expect(otherWords).not.toContain('alpha');

    expect(whyBelow('v0.2.0-1', 'v0.2.0-alpha')).toContain('a number sorts before a word');
    expect(whyBelow('v0.2.0-alpha', 'v0.2.0-alpha.1')).toContain('fewer identifiers sort first');
    expect(whyBelow('v0.2.0-rc.1', 'v0.2.0')).toContain('A pre-release sorts before the release');
    expect(whyBelow('v0.1.9', 'v0.1.10')).toContain('9 is lower than 10');

    const equal = whyBelow('v0.2.0-alpha.1', 'v0.2.0-alpha.1+x');
    expect(equal).toContain('equal precedence (build metadata is ignored)');
    expect(equal).not.toMatch(/\brc\b|ASCII|lower than/);
  });

  it('takes only a dated heading of its own version as the section', () => {
    const refused = (heading: string) =>
      checkReleaseNames({ tag: 'v0.2.0-alpha.1', version: '0.2.0-alpha.1', changelog: changelog(heading, RC1) }).refusals;
    expect(refused('## [0.2.0-alpha.1]')).toEqual([expect.stringContaining('no date')]);
    expect(refused('## [0.2.0-alpha.1] - 2026-13-01')).toEqual([expect.stringContaining('2026-13-01')]);
    expect(refused('## [0.2.0-alpha.1] - 2026-02-30')).toEqual([expect.stringContaining('2026-02-30')]);
    expect(refused('### [0.2.0-alpha.1] - 2026-10-01')).toHaveLength(1);
    expect(refused('## [0.2.0-alpha.10] - 2026-10-01')).toHaveLength(1);
    expect(refused('## [0x2x0-alpha.1] - 2026-10-01')).toHaveLength(1);
    expect(refused('## [0.2.0-alpha.1] - 2026-10-01  ')).toEqual([]);
  });

  it('lists a v* tag that is not a SemVer version, and orders the rest', () => {
    expect(
      checkReleaseNames({
        tag: 'v0.2.0-alpha.1',
        version: '0.2.0-alpha.1',
        changelog: changelog(ALPHA1),
        existingTags: ['v0.1.0-rc.1', 'vnext', ''],
      }),
    ).toEqual({ refusals: [], ignoredTags: ['vnext'] });
  });

  it("finds the section for the version the repository carries, in the real CHANGELOG.md", () => {
    // Not a release: the heading shape the check looks for is the one this
    // repository writes. `docs/release.md` bumps the version and renames the
    // section together, so the root version always has one.
    const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
    const real = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
    expect(checkReleaseNames({ tag: `v${version}`, version, changelog: real }).refusals).toEqual([]);
  });
});

describe("SemVer precedence, as semver.org's section 11 defines it", () => {
  it("orders the specification's own example", () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ];
    for (let i = 0; i + 1 < ordered.length; i += 1) {
      expect(compareSemVer(ordered[i]!, ordered[i + 1]!), `${ordered[i]} < ${ordered[i + 1]}`).toBe(-1);
      expect(compareSemVer(ordered[i + 1]!, ordered[i]!), `${ordered[i + 1]} > ${ordered[i]}`).toBe(1);
    }
    expect([...ordered].reverse().sort(compareSemVer)).toEqual(ordered);
  });

  it('compares major, minor and patch as numbers, however many digits', () => {
    expect(compareSemVer('1.9.0', '1.10.0')).toBe(-1);
    expect(compareSemVer('2.0.0', '1.99.99')).toBe(1);
    expect(compareSemVer('0.2.0-alpha.1', '0.1.0-rc.1')).toBe(1);
    expect(compareSemVer('0.1.0-alpha.1', '0.1.0-rc.1')).toBe(-1);
    expect(compareSemVer('1.0.0-9007199254740993', '1.0.0-9007199254740992')).toBe(1);
    expect(compareSemVer('0.1.0-rc.1', '0.1.0-rc.1')).toBe(0);
  });

  it('ignores build metadata', () => {
    expect(compareSemVer('1.0.0+a', '1.0.0+b')).toBe(0);
    expect(compareSemVer('1.0.0-rc.1+build.5', '1.0.0-rc.1')).toBe(0);
  });

  it('parses what the grammar allows and nothing else', () => {
    for (const ok of ['0.0.0', '1.0.0-0.3.7', '1.0.0-x.7.z.92', '1.0.0-x-y-z.--', '1.0.0+21AF26D3----117B344092BD', '1.0.0-alpha+001']) {
      expect(parseSemVer(ok), ok).not.toBeNull();
    }
    for (const bad of ['01.0.0', '1.0', '1.0.0-', '1.0.0-01', '1.0.0-a..b', 'v1.0.0', '1.0.0+', ' 1.0.0', '1.0.0-é']) {
      expect(parseSemVer(bad), bad).toBeNull();
    }
    expect(parseSemVer('1.0.0-rc.1+build.5')).toEqual({ major: '1', minor: '0', patch: '0', prerelease: ['rc', '1'], build: ['build', '5'] });
    expect(() => compareSemVer('1.0', '1.0.0')).toThrow(/not a SemVer version/);
  });
});

describe('the command a workflow runs', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  /** The environment, without anything that would point git or the check somewhere else. */
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('GITHUB_')),
  ) as NodeJS.ProcessEnv;

  /** A throwaway repository laid out like this one: the script, the root package.json, CHANGELOG.md, tags. */
  function repository(version: string, headings: string[], tags: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'release-names-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(SCRIPT, join(dir, 'scripts', 'release-names-agree.mjs'));
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'fixture', version }, null, 2)}\n`);
    writeFileSync(join(dir, 'CHANGELOG.md'), changelog(...headings));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args],
        { cwd: dir, env: cleanEnv, stdio: 'pipe' },
      );
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'fixture');
    for (const tag of tags) git('tag', tag);
    return dir;
  }

  function run(dir: string, args: string[], env: Record<string, string> = {}) {
    // From another directory on purpose: the script finds the repository by
    // its own location, not by where it was started.
    return spawnSync(process.execPath, [join(dir, 'scripts', 'release-names-agree.mjs'), ...args], {
      cwd: tmpdir(),
      env: { ...cleanEnv, ...env },
      encoding: 'utf8',
    });
  }

  it('passes a tag that agrees, read from GITHUB_REF_NAME as a workflow sets it', () => {
    const dir = repository('0.2.0-alpha.1', [ALPHA1, RC1], ['v0.1.0-rc.1', 'v0.2.0-alpha.1']);
    const result = run(dir, [], { GITHUB_REF_NAME: 'v0.2.0-alpha.1' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('v0.2.0-alpha.1');
    expect(result.stdout).toContain('agree');
  });

  it("refuses with the reasons as the run's errors, reading the existing tags from git", () => {
    const dir = repository('0.1.0-rc.1', [RC1], ['v0.1.0-rc.1']);
    const result = run(dir, ['v0.1.0-alpha.1'], { GITHUB_ACTIONS: 'true' });
    expect(result.status).toBe(1);
    const errors = result.stdout.split('\n').filter((l) => l.startsWith('::error::'));
    expect(errors).toHaveLength(3);
    // Only `git tag --list` could have told it that rc.1 exists.
    expect(errors.join('\n')).toContain('at or below v0.1.0-rc.1');
  });

  it('refuses when it is given no tag at all, rather than checking nothing', () => {
    const dir = repository('0.2.0-alpha.1', [ALPHA1], []);
    const result = run(dir, []);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('GITHUB_REF_NAME');
  });
});

// ---------------------------------------------------------------------------
// (b) The workflows
// ---------------------------------------------------------------------------

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: unknown;
  readonly with?: Record<string, unknown>;
  readonly 'continue-on-error'?: unknown;
}
interface Job {
  readonly steps?: ReadonlyArray<Step>;
}
interface Workflow {
  readonly on?: unknown;
  readonly jobs?: Record<string, Job>;
}

/** Whether a workflow's `on:` runs it for a tag. See the header for the rule. */
function runsOnTags(on: unknown): boolean {
  if (typeof on === 'string') return ['push', 'create', 'release'].includes(on);
  if (Array.isArray(on)) return on.some((event) => runsOnTags(event));
  if (on === null || typeof on !== 'object') return false;
  const events = on as Record<string, unknown>;
  if ('create' in events || 'release' in events) return true;
  if (!('push' in events)) return false;
  const push = events.push;
  if (push === null || typeof push !== 'object') return true;
  const filters = push as Record<string, unknown>;
  if ('tags' in filters || 'tags-ignore' in filters) return true;
  return !('branches' in filters || 'branches-ignore' in filters);
}

/**
 * Whether a workflow's `on:` also runs it for something that is not a tag: a
 * branch push, a pull request, a schedule or a dispatch. Its check step must
 * then say `if:` it is a tag, or every such run would be refused. `release`
 * is a tag's own event.
 */
function runsOffTags(on: unknown): boolean {
  if (typeof on === 'string') return on !== 'release';
  if (Array.isArray(on)) return on.some((event) => runsOffTags(event));
  if (on === null || typeof on !== 'object') return false;
  return Object.entries(on as Record<string, unknown>).some(([event, filters]) => {
    if (event === 'release') return false;
    if (event !== 'push') return true;
    if (filters === null || typeof filters !== 'object') return true;
    const f = filters as Record<string, unknown>;
    return 'branches' in f || 'branches-ignore' in f || !('tags' in f || 'tags-ignore' in f);
  });
}

/** A `run:` block as the shell reads it: continuations joined, comment lines gone. */
function shellOf(run: string): string {
  return run
    .replace(/\\\n/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

const PUBLISHING_COMMANDS: ReadonlyArray<RegExp> = [
  /\bdocker\s+(?:image\s+)?push\b/,
  /\bdocker\s+buildx\s+(?:build|bake)\b[^\n]*\s--push\b/,
  /\bdocker\s+buildx\s+imagetools\s+create\b/,
  /\bdocker\s+manifest\s+push\b/,
  /\bgh\s+release\s+(?:create|upload|edit)\b/,
  /\b(?:npm|pnpm|yarn)\s+publish\b/,
  /\bcosign\s+(?:sign|attest)\b/,
  /\b(?:oras|crane)\s+(?:push|copy|cp)\b/,
  /\bskopeo\s+copy\b/,
];

/** Whether a step publishes. See the header for the rule. */
function publishes(step: Step): boolean {
  if (typeof step.uses === 'string') {
    const action = step.uses.split('@')[0]!;
    const repo = action.split('/')[1] ?? '';
    if (/^docker\/(?:build-push-action|bake-action)$/.test(action)) {
      const push = step.with?.push;
      return push !== undefined && push !== false && push !== 'false';
    }
    if (/release|publish/i.test(repo)) return true;
  }
  if (typeof step.run === 'string') {
    const shell = shellOf(step.run);
    return PUBLISHING_COMMANDS.some((command) => command.test(shell));
  }
  return false;
}

const CHECK_LINE = /^\s*node\s+(?:\.\/)?scripts\/release-names-agree\.mjs\b(.*)$/m;
const TAG_CONDITION = /^\s*(?:\$\{\{\s*)?startsWith\(\s*github\.ref\s*,\s*'refs\/tags\/v?'\s*\)\s*(?:\}\})?\s*$/;
const FETCHES_TAGS = /\bgit\s+fetch\b[^\n]*(?:\s--tags\b|refs\/tags\/)/;

/** Why a step that runs the check would not hold a release back, or null when it would. */
function checkStepFlaw(step: Step, earlier: ReadonlyArray<Step>, offTags: boolean): string | null {
  const shell = shellOf(step.run ?? '');
  const line = CHECK_LINE.exec(shell);
  if (!line) return 'does not run `node scripts/release-names-agree.mjs`';
  if (line[1]!.includes('||')) return 'lets the check fail (`||` after it)';
  if (/^\s*set\s+\+e\b/m.test(shell)) return 'lets the check fail (`set +e`)';
  const soft = step['continue-on-error'];
  if (soft !== undefined && soft !== false && soft !== 'false') return 'lets the check fail (`continue-on-error`)';
  if (step.if !== undefined && !TAG_CONDITION.test(String(step.if))) {
    return `runs the check only when \`${String(step.if)}\`, which is not a tag condition`;
  }
  if (step.if === undefined && offTags) {
    return 'runs the check on every run, so a branch push, a pull request or a dispatch would be refused too';
  }
  const fetchedHere = FETCHES_TAGS.test(shell.slice(0, line.index));
  const fetchedByCheckout = earlier.some(
    (s) =>
      typeof s.uses === 'string' &&
      s.uses.startsWith('actions/checkout@') &&
      (String(s.with?.['fetch-depth']) === '0' || String(s.with?.['fetch-tags']) === 'true'),
  );
  if (!fetchedHere && !fetchedByCheckout) {
    return 'runs the check without the release tags fetched, so it would compare the tag with nothing';
  }
  return null;
}

/** Whether a job calls the check before its first publishing step: null when it does, else why not. */
function releaseHeldBack(job: Job, offTags = true): string | null {
  const steps = job.steps ?? [];
  const first = steps.findIndex(publishes);
  if (first === -1) return null;
  const checkAt = steps.findIndex((s) => typeof s.run === 'string' && CHECK_LINE.test(shellOf(s.run)));
  const publisher = steps[first]!.name ?? steps[first]!.uses ?? `step ${first + 1}`;
  if (checkAt === -1) return `publishes ("${publisher}") and never runs the check`;
  if (checkAt > first) return `runs the check after "${publisher}" has published`;
  const flaw = checkStepFlaw(steps[checkAt]!, steps.slice(0, checkAt), offTags);
  return flaw ? `has a check step that ${flaw}` : null;
}

function workflows(): ReadonlyArray<{ file: string; doc: Workflow }> {
  return readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((file) => ({ file, doc: parseYaml(readFileSync(join(WORKFLOWS, file), 'utf8')) as Workflow }));
}

describe('the rules this test reads the workflows by', () => {
  const checkout: Step = { uses: 'actions/checkout@0000000000000000000000000000000000000000' };
  const check: Step = {
    name: 'names agree',
    if: "startsWith(github.ref, 'refs/tags/')",
    run: "git fetch --depth=1 origin '+refs/tags/v*:refs/tags/v*'\nnode scripts/release-names-agree.mjs\n",
  };
  const push: Step = { uses: 'docker/build-push-action@0000000000000000000000000000000000000000', with: { push: "${{ github.event_name != 'pull_request' }}" } };

  it('knows when a workflow runs on a tag', () => {
    expect(runsOnTags({ push: { tags: ['v*'] } })).toBe(true);
    expect(runsOnTags({ push: { branches: ['main'], tags: ['v*'] } })).toBe(true);
    expect(runsOnTags({ push: null })).toBe(true);
    expect(runsOnTags('push')).toBe(true);
    expect(runsOnTags({ push: { paths: ['deploy/**'] } })).toBe(true);
    expect(runsOnTags({ release: { types: ['published'] } })).toBe(true);
    expect(runsOnTags({ push: { branches: ['main'] }, pull_request: null })).toBe(false);
    expect(runsOnTags({ schedule: [{ cron: '0 6 * * 1' }], workflow_dispatch: null })).toBe(false);
  });

  it('knows a publishing step by what it does', () => {
    expect(publishes(push)).toBe(true);
    expect(publishes({ ...push, with: { push: false } })).toBe(false);
    expect(publishes({ ...push, with: {} })).toBe(false);
    expect(publishes({ uses: 'softprops/action-gh-release@0000000000000000000000000000000000000000' })).toBe(true);
    expect(publishes({ run: 'gh release upload "$GITHUB_REF_NAME" dist/x.zip' })).toBe(true);
    expect(publishes({ run: 'docker buildx build . \\\n  --platform linux/amd64 \\\n  --push' })).toBe(true);
    expect(publishes({ run: 'cosign sign --yes "$ref"' })).toBe(true);
    expect(publishes({ run: 'docker build .\n# docker push comes later, elsewhere' })).toBe(false);
    expect(publishes({ uses: 'actions/upload-artifact@0000000000000000000000000000000000000000' })).toBe(false);
    expect(publishes({ uses: 'github/codeql-action/upload-sarif@0000000000000000000000000000000000000000' })).toBe(false);
  });

  it('holds a release back only with the check first, failing, on a tag, with the tags fetched', () => {
    expect(releaseHeldBack({ steps: [checkout, check, push] })).toBeNull();
    expect(releaseHeldBack({ steps: [checkout, { uses: 'docker/setup-buildx-action@0' }] })).toBeNull();
    expect(releaseHeldBack({ steps: [checkout, push] })).toContain('never runs the check');
    expect(releaseHeldBack({ steps: [checkout, push, check] })).toContain('after');
    expect(releaseHeldBack({ steps: [checkout, { ...check, 'continue-on-error': true }, push] })).toContain('continue-on-error');
    expect(releaseHeldBack({ steps: [checkout, { ...check, run: `${check.run!.trimEnd()} || true` }, push] })).toContain('||');
    expect(releaseHeldBack({ steps: [checkout, { ...check, if: "github.ref == 'refs/heads/nothing'" }, push] })).toContain(
      'not a tag condition',
    );
    expect(releaseHeldBack({ steps: [checkout, { ...check, run: 'node scripts/release-names-agree.mjs' }, push] })).toContain(
      'without the release tags fetched',
    );
    expect(
      releaseHeldBack({ steps: [{ ...checkout, with: { 'fetch-depth': 0 } }, { ...check, run: 'node scripts/release-names-agree.mjs' }, push] }),
    ).toBeNull();
    // With no `if:`, the check refuses every run that is not a tag, where the
    // workflow has such runs; a workflow that runs only on tags needs none.
    const { if: _unused, ...unconditional } = check;
    expect(releaseHeldBack({ steps: [checkout, unconditional, push] }, true)).toContain('every run');
    expect(releaseHeldBack({ steps: [checkout, unconditional, push] }, false)).toBeNull();
  });

  it('knows when a workflow also runs for something that is not a tag', () => {
    expect(runsOffTags({ push: { tags: ['v*'] } })).toBe(false);
    expect(runsOffTags({ release: { types: ['published'] } })).toBe(false);
    expect(runsOffTags({ push: { branches: ['main'], tags: ['v*'] } })).toBe(true);
    expect(runsOffTags({ push: { tags: ['v*'] }, workflow_dispatch: null })).toBe(true);
    expect(runsOffTags({ push: { tags: ['v*'] }, pull_request: { paths: ['x'] } })).toBe(true);
    expect(runsOffTags('push')).toBe(true);
  });
});

/** The jobs that publish on a tag, as 0146 T2 names them: file and job id. */
const PUBLISHERS: ReadonlyArray<readonly [string, string]> = [
  ['images.yml', 'build'],
  ['security-scan.yml', 'security-scan'],
  ['windows-payload.yml', 'build'],
];

describe('every workflow that publishes on a tag runs the check first', () => {
  const all = workflows();
  const onTags = all.filter(({ doc }) => runsOnTags(doc.on));
  const publishing = onTags.flatMap(({ file, doc }) =>
    Object.entries(doc.jobs ?? {})
      .filter(([, job]) => (job.steps ?? []).some(publishes))
      .map(([id, job]) => ({ where: `${file} › ${id}`, job, offTags: runsOffTags(doc.on) })),
  );

  it('sees the three publishers 0146 T2 names, and ci.yml as a tag workflow that publishes nothing', () => {
    expect(publishing.map((p) => p.where)).toEqual(
      expect.arrayContaining(PUBLISHERS.map(([file, job]) => `${file} › ${job}`)),
    );
    expect(onTags.map((w) => w.file)).toContain('ci.yml');
    expect(publishing.filter((p) => p.where.startsWith('ci.yml'))).toEqual([]);
  });

  it('calls the check before the first publishing step, in every one of them', () => {
    const problems = publishing
      .map(({ where, job, offTags }) => ({ where, problem: releaseHeldBack(job, offTags) }))
      .filter((p) => p.problem !== null)
      .map((p) => `${p.where} ${p.problem}`);
    expect(problems).toEqual([]);
  });

  it('runs the check straight after the checkout, before any install or build can run on a tag that disagrees', () => {
    for (const { where, job } of publishing) {
      const steps = job.steps ?? [];
      const checkoutAt = steps.findIndex((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'));
      const checkAt = steps.findIndex((s) => typeof s.run === 'string' && CHECK_LINE.test(shellOf(s.run)));
      expect(checkoutAt, where).toBeGreaterThanOrEqual(0);
      expect(checkAt, where).toBe(checkoutAt + 1);
    }
  });
});

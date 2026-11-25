// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PIN THAT KNOWS IT IS BEHIND: nothing said when upstream fixed a hole the
 * pinned identity provider still had (workplan 0135 T7 (b)).
 *
 * The identity provider is pinned in `managed.yml`, and Dependabot does not
 * move it: it reads no compose file in `deploy/compose`, and an upgrade moves its
 * schema one way and is the owner's call (0119 §3 item 2). So nothing said
 * when upstream moved on. v4.18.0 fixed GHSA-4hgj-wm6c-q7p2,
 * a rename of any account through login v1, on 2026-09-21, and a week later
 * this stack still ran v4.17.3. A person reading release notes found it.
 *
 * `scripts/idp-pin-watch.mjs` now compares the pin with upstream's newest
 * release of the same major once a week, and keeps one issue open while the
 * two differ. This holds what it compares, how it orders tags, the one issue,
 * and the workflow that runs it. The tag list is stubbed, and so is `gh`.
 *
 * EVERY PIN DEPENDABOT CANNOT SEE (workplan 0146 T8, 2026-10-21). The
 * identity provider was not the only one. Dependabot read no file in
 * `deploy/compose` (`a-dependabot-directory-with-nothing-to-read`; since
 * 0146 T15 it reads one, the databases' Dockerfile, and still no compose file), so
 * pgbouncer fell two releases and two CVEs behind and Trigger.dev four
 * releases; the tasks ran a Node two security releases old, and pnpm sat six
 * releases back. Each was found by somebody reading. The same watch now has
 * one row each for Trigger.dev, ClickHouse, the tasks' Node, pnpm and the
 * TypeScript split, each with its own issue, and one summary issue for the
 * routine pins (the first three removed with Trigger.dev in alpha.18). This
 * also holds those rows, against stubbed registries, npm,
 * nodejs.org's index and `gh`: that every image line of the compose files is
 * compared or named with a reason, that a row which cannot read its upstream
 * never reads as current, and that the identity provider's issue keeps its
 * title.
 *
 * A PIN WITH NO NUMBER (workplan 0146 T7, 2026-10-24). MinIO moved to
 * Chainguard's build, whose free tier publishes `latest` and `latest-dev`
 * only, so `managed.yml` pins `latest` by its index digest. A tag list cannot
 * say a `latest` is behind, and the watch refused it as a pin with no version
 * to compare. Such a pin is compared with the digest its registry names for
 * the tag today, read with a HEAD, and is behind when the two differ. MinIO
 * went with Trigger.dev in alpha.18; the rule is held on a stand-in line.
 *
 * WHAT CI DOWNLOADS (workplan 0119, 2026-11-01). The Atlas CLI came by its
 * `-latest` name (#1773); the stalwart-cli of the integration tests and both
 * E2E gates from `releases/latest` by its installer, piped to `sh`; the dev
 * database Atlas lints against from `docker://postgres/18`; and images.yml's
 * build job ran binfmt's `latest` and BuildKit's `buildx-stable-1` through
 * its actions' defaults. Each is a release named by its sha256 or digest now,
 * with a row here. This holds the stalwart-cli step as it holds Atlas's, by its
 * text and by running it, the install hints a developer reads to its release,
 * and every workflow to the rule: no `releases/latest` and no file or path
 * named `latest`, no `docker://` image without a digest, no action image
 * without a release tag and its digest, and no `npx` that may install.
 *
 * THE NODE.JS RELEASE KEYRING (#1780's review, 2026-11-01). The Windows
 * payload's `node.exe` check reads a copy of nodejs/release-keys' active
 * keyring pinned by commit and blob id (`NODE_RELEASE_KEYS`), which moved only
 * when a build met a releaser it lacked: a key retired, revoked or given a new
 * expiry upstream reached nothing. Its row compares the file at upstream's
 * newest commit with the blob id, and is held here to the module's own pin,
 * to the committed file, and to never reading a pin or an answer it cannot
 * parse as current.
 *
 * A CLICKHOUSE AHEAD OF TRIGGER.DEV'S ON PURPOSE (0119 §3 item 9) and A PIN
 * WHOSE DIGEST MOVES ON EVERY MERGE (the tasks' base, 0119 §3 item 13) were
 * held here too, with the Trigger.dev and tasks' Node rows, until alpha.18
 * removed Trigger.dev (workplan 0167 T9). Those rows are `removedRow`s since:
 * `current`, each with a sentence that closes its issue if it is still open,
 * once, and says nothing the week after.
 *
 * A TAG DEPENDABOT DOES NOT PROPOSE (workplan 0119, 2026-11-13, on review of
 * the pooler's build). An image built here that is behind said "Dependabot
 * reads this one too: take its pull request". For the pooler that pull
 * request never comes in the case its build waits for. edoburu/pgbouncer tags
 * a rebuild of the same PgBouncer `-p<n+1>` (v1.24.1-p0 and then -p1;
 * v1.23.1 up to -p3), and Dependabot proposes only a tag that ends as the
 * pin does: `v1.26.2-p0` for `v1.26.1-p0`, never `v1.26.1-p1`. So where the
 * newest tag ends otherwise than the pin, the line says the move is made by
 * hand. This holds that on the pooler's real pin, and that a newer PgBouncer
 * and every other image built here keep Dependabot's line.
 *
 * THE HADOLINT THE DOCKERFILE LINT RUNS (workplan 0119, 2026-11-19). The
 * lint, report only, runs `hadolint/hadolint` by the tag and index digest of
 * its job's one `HADOLINT_IMAGE`, which Dependabot cannot see in a workflow's
 * env. Its row compares the tag with Docker Hub's newest of the same shape
 * and major, past the Debian and Alpine builds and the per-commit tags the
 * same repository lists, and this holds that, the note it is listed with when
 * behind, and that a line it cannot read is an error.
 *
 * THE GITLEAKS CI READS A PULL REQUEST'S COMMITS WITH (workplan 0163 T6,
 * 2026-11-21). ci.yml's gitleaks job installs it from its GitHub release, an
 * archive per architecture checked by its sha256 before it is unpacked, in
 * the shape of the stalwart-cli step; its row compares the release with
 * upstream's git tags of the same major.
 *
 * THE SEMGREP THE TREE IS SCANNED WITH (workplan 0163 T3, 2026-11-21). The
 * scan, report only, runs `semgrep/semgrep` by the tag and index digest of its
 * job's one `SEMGREP_IMAGE`, in the same place, read the same way: against
 * Docker Hub's newest tag of the same shape and major, past the `-nonroot`
 * builds and the `latest` and `canary` channels the repository lists.
 *
 * THE ZIZMOR THE WORKFLOW AUDIT RUNS (workplan 0119, 2026-11-20). The audit,
 * blocking, runs `ghcr.io/zizmorcore/zizmor` by the tag and index digest of
 * its job's one `ZIZMOR_IMAGE`, which Dependabot cannot see either. Its row
 * compares the tag with ghcr.io's newest of the same shape and major, past
 * the release candidates and `latest` the same repository lists, and this
 * holds that, the note it is listed with when behind, and that a line it
 * cannot read is an error.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  ACTION_IMAGES,
  ACTION_IMAGES_WORKFLOW,
  ATLAS_ARCHES,
  ATLAS_HOST,
  ATLAS_IMAGE,
  ATLAS_NOTE,
  ATLAS_WORKFLOW,
  COMPARED_ELSEWHERE,
  COMPOSE,
  COMPOSE_FILES,
  COSIGN_FILES,
  HADOLINT_NOTE,
  HADOLINT_WORKFLOW,
  SEMGREP_NOTE,
  SEMGREP_WORKFLOW,
  ZIZMOR_NOTE,
  ZIZMOR_WORKFLOW,
  ISSUE_TITLE,
  STALWART_FILES,
  GOACCESS_DOCKERFILE,
  LINES,
  NODE_RELEASE_KEYS_FILE,
  GITLEAKS_ARCHES,
  GITLEAKS_HOST,
  GITLEAKS_NOTE,
  GITLEAKS_UPSTREAM,
  GITLEAKS_WORKFLOW,
  OSV_SCANNER_ARCHES,
  OSV_SCANNER_HOST,
  OSV_SCANNER_NOTE,
  OSV_SCANNER_UPSTREAM,
  OSV_SCANNER_WORKFLOW,
  SQUAWK_ARCHES,
  SQUAWK_HOST,
  SQUAWK_NOTE,
  SQUAWK_UPSTREAM,
  SQUAWK_WORKFLOW,
  NODE_RELEASE_KEYS_NOTE,
  NEXTCLOUD_SECOND_MAJOR_NOTE,
  NEXTCLOUD_SECOND_MAJOR_WORKFLOW,
  STALWART_CLI_ARCHES,
  STALWART_CLI_FILES,
  STALWART_CLI_HINTS,
  STALWART_CLI_HOST,
  STALWART_CLI_NOTE,
  STALWART_CLI_UPSTREAM,
  TRIVY_ARCHES,
  TRIVY_HOST,
  TRIVY_JOBS,
  TRIVY_NOTE,
  TRIVY_WORKFLOW,
  TITLES,
  WINDOW_DAYS,
  actionDefault,
  actionImages,
  atlasPin,
  builtImage,
  builtNote,
  byHandNote,
  channelNote,
  compareTags,
  comparePin,
  endingOf,
  gitBlobId,
  hadolintPin,
  semgrepPin,
  zizmorPin,
  issueBody,
  keepIssue,
  keepIssues,
  newestLike,
  newestRelease,
  gitleaksPin,
  osvScannerPin,
  squawkPin,
  pnpmRow,
  readImages,
  readPin,
  removedRow,
  releaseKeysPin,
  registryDigest,
  registryOf,
  repoReader,
  REBUILD_NOTE,
  routineRows,
  secondMajorPin,
  stalwartCliPin,
  trivyPin,
  stepsUsing,
  summaryOf,
  table,
  typescriptRow,
  watch,
  type Net,
  type Repo,
  type Row,
} from './idp-pin-watch.mjs';
import { NODE_RELEASE_KEYRING, NODE_RELEASE_KEYS } from './package-appliance.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED_YML = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.yml'), 'utf8');
const WORKFLOW_FILE = '.github/workflows/idp-pin-watch.yml';
const WORKFLOW = readFileSync(join(REPO_ROOT, WORKFLOW_FILE), 'utf8');

/** `git ls-remote --tags --refs` output: releases, a pre-release, and two other majors. */
const LS_REMOTE = [
  'a1\trefs/tags/v3.4.9',
  'a2\trefs/tags/v4.9.0',
  'a3\trefs/tags/v4.17.1',
  'a4\trefs/tags/v4.17.3',
  'a5\trefs/tags/v4.18.0',
  'a6\trefs/tags/v4.19.0',
  'a7\trefs/tags/v4.19.1',
  'a8\trefs/tags/v4.20.0-rc.1',
  'a9\trefs/tags/v5.1.0',
].join('\n');

type Issue = { number: number; title: string; body: string; state: 'open' | 'closed' };

/**
 * A `gh` that answers `issue list` from `issues` as the real one would: only
 * the state asked for, and only the fields asked for. Every other call is
 * recorded.
 */
function fakeGh(issues: Issue[]) {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    if (args[0] === 'issue' && args[1] === 'list') {
      const state = args[args.indexOf('--state') + 1];
      const fields = (args[args.indexOf('--json') + 1] ?? '').split(',');
      const listed = issues.filter((i) => state === 'all' || i.state === state);
      return JSON.stringify(listed.map((i) => Object.fromEntries(fields.map((f) => [f, i[f as keyof Issue]]))));
    }
    calls.push(args);
    return '';
  };
  return { gh, calls };
}

const OTHER: Issue = { number: 7, title: 'Something else', body: 'x', state: 'open' };

describe('what it compares', () => {
  it('reads the pin from managed.yml itself, its one image line for the identity provider', () => {
    expect(COMPOSE).toBe('deploy/compose/managed.yml');
    const lines = [...MANAGED_YML.matchAll(/^\s*image:\s*ghcr\.io\/zitadel\/zitadel:(\S+)\s*$/gm)];
    expect(lines).toHaveLength(1);
    expect(readPin(MANAGED_YML)).toBe(lines[0]![1]);
    expect(readPin(MANAGED_YML)).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('refuses a file with no pin, with two, or with a tag that is not a release', () => {
    const line = '    image: ghcr.io/zitadel/zitadel:v4.19.1\n';
    expect(() => readPin('services: {}\n')).toThrow(/0 times/);
    expect(() => readPin(line + line)).toThrow(/2 times/);
    expect(() => readPin('    image: ghcr.io/zitadel/zitadel:latest\n')).toThrow(/not a release tag/);
  });

  it('reports behind for v4.17.3 when upstream has v4.19.1, and names the newest', () => {
    expect(comparePin('v4.17.3', LS_REMOTE)).toEqual({ pin: 'v4.17.3', newest: 'v4.19.1', state: 'behind' });
  });

  it('reports current when the pin is the newest release', () => {
    expect(comparePin('v4.19.1', LS_REMOTE)).toEqual({ pin: 'v4.19.1', newest: 'v4.19.1', state: 'current' });
  });

  it('orders tags by their numbers, not their text: v4.10.0 is newer than v4.9.0', () => {
    expect(compareTags('v4.9.0', 'v4.10.0')).toBeLessThan(0);
    expect(newestRelease(4, 'x\trefs/tags/v4.10.0\ny\trefs/tags/v4.9.0')).toBe('v4.10.0');
    expect(comparePin('v4.9.0', 'x\trefs/tags/v4.10.0\ny\trefs/tags/v4.9.0').state).toBe('behind');
  });

  it('counts neither a pre-release nor another major as the newest release', () => {
    expect(newestRelease(4, LS_REMOTE)).toBe('v4.19.1');
  });

  it('calls a pin current only against a release it read: none of its major is an error', () => {
    expect(() => comparePin('v4.19.1', 'a1\trefs/tags/v3.4.9\na9\trefs/tags/v5.1.0')).toThrow(/no v4 release/);
    expect(() => comparePin('v4.19.1', '')).toThrow(/no v4 release/);
  });

  it('says so when the pin is ahead of every release', () => {
    expect(comparePin('v4.99.0', LS_REMOTE).state).toBe('ahead');
  });
});

describe('the one issue', () => {
  const behind = { pin: 'v4.17.3', newest: 'v4.19.1', state: 'behind' as const };
  const current = { pin: 'v4.19.1', newest: 'v4.19.1', state: 'current' as const };
  const watch = (body: string, state: Issue['state'] = 'open'): Issue => ({ number: 42, title: ISSUE_TITLE, body, state });

  it('opens one when the pin is behind and none is open', () => {
    const { gh, calls } = fakeGh([OTHER]);
    expect(keepIssue(behind, gh)).toBe('opened');
    expect(calls).toEqual([['issue', 'create', '--title', ISSUE_TITLE, '--body', issueBody(behind)]]);
  });

  it('opens a new one when the only one with its title was closed: a new time behind', () => {
    const { gh, calls } = fakeGh([OTHER, watch(issueBody(behind), 'closed')]);
    expect(keepIssue(behind, gh)).toBe('opened');
    expect(calls.map((c) => c.slice(0, 2))).toEqual([['issue', 'create']]);
  });

  it('brings the open one up to date instead of opening a second, and says the newer release in a comment', () => {
    const { gh, calls } = fakeGh([OTHER, watch(issueBody({ pin: 'v4.17.3', newest: 'v4.19.0' }))]);
    expect(keepIssue(behind, gh)).toBe('updated');
    expect(calls).toEqual([
      ['issue', 'edit', '42', '--body', issueBody(behind)],
      ['issue', 'comment', '42', '--body', "The pin is v4.17.3, and upstream's newest release is now **v4.19.1**."],
    ]);
  });

  it('writes nothing in a week with nothing new, whatever line endings GitHub hands back', () => {
    for (const body of [issueBody(behind), issueBody(behind).replace(/\n/g, '\r\n') + '\r\n']) {
      const { gh, calls } = fakeGh([OTHER, watch(body)]);
      expect(keepIssue(behind, gh)).toBe('unchanged');
      expect(calls).toEqual([]);
    }
  });

  it('closes it once the pin is current, and leaves every other issue alone', () => {
    const { gh, calls } = fakeGh([OTHER, watch(issueBody(behind))]);
    expect(keepIssue(current, gh)).toBe('closed');
    expect(calls).toEqual([['issue', 'close', '42', '--comment', 'The pin is current again: v4.19.1.']]);
  });

  it('writes nothing when the pin is current and nothing is open', () => {
    const { gh, calls } = fakeGh([OTHER, watch(issueBody(behind), 'closed')]);
    expect(keepIssue(current, gh)).toBe('untouched');
    expect(calls).toEqual([]);
  });

  it('names both versions, the seven-day window and the route an upgrade takes', () => {
    expect(WINDOW_DAYS).toBe(7);
    const body = issueBody(behind);
    expect(body).toContain('**v4.17.3**');
    expect(body).toContain('**v4.19.1**');
    expect(body).toContain('https://github.com/zitadel/zitadel/releases/tag/v4.19.1');
    expect(body).toContain('within 7 days');
    expect(body).toMatch(/Dump the OTA instance's `zitadel` database by hand first/);
    expect(body).toMatch(/Its own pull request moves the pin/);
    expect(body).toMatch(/E2E \(managed\) on that branch/);
    expect(body).toMatch(/Live takes it from a release tag/);
  });

  it('points at the dump script, which exists and dumps the identity provider\'s database', () => {
    const body = issueBody(behind);
    expect(body).toContain('`./deploy/compose/dump-idp.sh`');
    const script = readFileSync(join(REPO_ROOT, 'deploy/compose/dump-idp.sh'), 'utf8');
    expect(script).toMatch(/pg_dump [^\n]*--format=custom/);
    expect(script).toMatch(/ZITADEL_DB_NAME/);
  });

  it('says when the OTA dump can go, as a fifth step', () => {
    expect(issueBody(behind)).toMatch(/^5\. Delete the OTA dump once main's first scheduled E2E \(managed\) on the new pin is green\./m);
  });

  it('keeps its title, so the issue open today is the one it keeps', () => {
    expect(ISSUE_TITLE).toBe('The identity provider pin is behind its newest release');
    expect(TITLES.zitadel).toBe(ISSUE_TITLE);
  });
});

// ------------------------------------------------------------------------
// Every pin Dependabot cannot see (workplan 0146 T8).

const REAL = repoReader(REPO_ROOT);
/** The Node.js release keyring committed for the Windows payload's node.exe check (2026-11-01). */
const RELEASE_KEYRING = readFileSync(NODE_RELEASE_KEYRING);
/** The real checkout, with some files replaced (null: not there). */
const withFiles = (over: Record<string, string | null>): Repo => ({
  read: (rel) => (Object.hasOwn(over, rel) ? (over[rel] ?? null) : REAL.read(rel)),
  list: (rel) => REAL.list(rel),
});

type Answer = unknown;
interface Stubs {
  json?: Array<[RegExp, Answer]>;
  text?: Array<[RegExp, Answer]>;
  bytes?: Array<[RegExp, Answer]>;
  digest?: Array<[RegExp, Answer]>;
  lsRemote?: Record<string, string>;
  head?: Record<string, string>;
  npm?: (args: string[]) => string;
}

/** A network that answers only what a test stubbed, and records every read. */
function fakeNet(stubs: Stubs = {}): Net & { asked: string[] } {
  const asked: string[] = [];
  const answer = (list: Array<[RegExp, Answer]> | undefined, url: string): unknown => {
    asked.push(url);
    const hit = list?.find(([re]) => re.test(url));
    if (!hit) throw new Error(`nothing stubbed for ${url}`);
    const value = typeof hit[1] === 'function' ? (hit[1] as (u: string) => unknown)(url) : hit[1];
    if (value instanceof Error) throw value;
    return value;
  };
  return {
    asked,
    json: async (url) => answer(stubs.json, url),
    text: async (url) => answer(stubs.text, url) as string,
    bytes: async (url) => answer(stubs.bytes, url) as Buffer,
    digest: async (url) => answer(stubs.digest, url) as string,
    lsRemote: async (url) => {
      asked.push(url);
      const listed = stubs.lsRemote?.[url];
      if (listed === undefined) throw new Error(`nothing stubbed for ${url}`);
      return listed;
    },
    head: async (url) => {
      asked.push(`${url} HEAD`);
      const named = stubs.head?.[url];
      if (named === undefined) throw new Error(`nothing stubbed for ${url} HEAD`);
      return named;
    },
    npm: async (args) => {
      if (!stubs.npm) throw new Error('npm is not stubbed');
      return stubs.npm(args);
    },
  };
}

const TOKEN: [RegExp, Answer] = [/\/token\?/, { token: 'anonymous' }];
const lsRemote = (...tags: string[]) => tags.map((t, i) => `${i}\trefs/tags/${t}`).join('\n');

const MANAGED = REAL.read(COMPOSE)!;

describe('how a pin is compared with its registry', () => {
  it('compares a tag only with tags of its own scheme and major', () => {
    expect(newestLike('v1.25.2-p0', ['v1.25.2-p0', 'v1.26.1-p0', 'v1.26.0-p0', 'latest', 'v2.0.0-p0', 'v1.27.0'])).toBe('v1.26.1-p0');
    expect(newestLike('1.38', ['1.36', '1.37', '1.38', '1.38.0', '1.38-glibc', '1.40-uclibc'])).toBe('1.38');
    expect(newestLike('v0.16.10', ['v0.16.10', 'v0.16.27', 'v0.17.0', 'v0.16.27-alpine'], 2)).toBe('v0.16.27');
    expect(newestLike('3.1.1', ['3.1.1', '3.1.2', '3.1', '3', '2.8.3'])).toBe('3.1.2');
  });

  it('reads a floating tag as current within its line, so a floating line never opens an issue', () => {
    expect(newestLike('18-alpine', ['17-alpine', '18-alpine', '18.6-alpine', '19-alpine'])).toBe('18-alpine');
    expect(newestLike('7-alpine', ['7-alpine', '8-alpine', '7.4-alpine'])).toBe('7-alpine');
  });

  it('orders by numbers, not text, and never calls a pin current against nothing', () => {
    expect(newestLike('v4.9.0', ['v4.9.0', 'v4.10.0'])).toBe('v4.10.0');
    expect(() => newestLike('v1.31.1', ['latest', 'edge'])).toThrow(/cannot be called current/);
    expect(() => newestLike('latest', ['latest'])).toThrow(/no version number/);
  });

  it('reads every image line, a `${VAR:-default}` as its default, with tag and digest apart', () => {
    const images = readImages(
      [
        'services:',
        '  a:',
        '    image: ghcr.io/triggerdotdev/trigger.dev:${TRIGGER_IMAGE_TAG:-v4.7.2}',
        '  b:',
        `    image: axllent/mailpit:v1.31.1@sha256:${'9'.repeat(64)}`,
        '  c:',
        '    image: postgres:18-alpine            # a comment',
        '  # image: not-an-image:1',
      ].join('\n'),
    );
    expect(images.map((i) => [i.line, i.repo, i.tag, i.digest])).toEqual([
      [3, 'ghcr.io/triggerdotdev/trigger.dev', 'v4.7.2', ''],
      [5, 'axllent/mailpit', 'v1.31.1', `sha256:${'9'.repeat(64)}`],
      [7, 'postgres', '18-alpine', ''],
    ]);
  });

  it('knows where each tag list is, and refuses a registry it does not read', () => {
    expect(registryOf('ghcr.io/twin/gatus')).toEqual({ host: 'ghcr.io', name: 'twin/gatus' });
    expect(registryOf('postgres')).toEqual({ host: 'registry-1.docker.io', name: 'library/postgres' });
    expect(registryOf('edoburu/pgbouncer')).toEqual({ host: 'registry-1.docker.io', name: 'edoburu/pgbouncer' });
    expect(() => registryOf('quay.io/x/y')).toThrow(/does not read/);
  });

  it('reads a step of a workflow by its action, its pinned commit and its inputs, from the real files', () => {
    const scan = stepsUsing(REAL.read('.github/workflows/security-scan.yml')!, 'aquasecurity/trivy-action');
    expect(scan.length).toBeGreaterThan(0);
    expect(scan[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(scan[0]!.with['scan-type']).toBe('fs');
    const named = stepsUsing(
      ['    steps:', '      - name: Scan', `        uses: aquasecurity/trivy-action@${'e'.repeat(40)} # v0.36.0`, '        with:', "          version: 'v0.76.0'", '          format: sarif', '      - name: Next', '        run: true'].join('\n'),
      'aquasecurity/trivy-action',
    );
    expect(named).toEqual([{ sha: 'e'.repeat(40), version: 'v0.36.0', with: { version: 'v0.76.0', format: 'sarif' } }]);
    // The build job's, which signs (the task-base-pin job's, which verified the
    // tasks' base pin, went with Trigger.dev in alpha.18, workplan 0167 T9).
    const sign = stepsUsing(REAL.read('.github/workflows/images.yml')!, 'sigstore/cosign-installer');
    expect(sign).toHaveLength(1);
    expect(new Set(sign.map((s) => `${s.sha} ${s.with['cosign-release']}`)).size).toBe(1);
  });

  it("reads an action's default for an input, under inputs: only", () => {
    const action = ['name: x', 'inputs:', '  version:', "    description: 'v'", "    default: 'v0.70.0'", '  cache:', "    default: 'true'", 'outputs:', '  version:', "    default: 'no'"].join('\n');
    expect(actionDefault(action, 'version')).toBe('v0.70.0');
    expect(() => actionDefault(action, 'cosign-release')).toThrow(/no input/);
  });
});

describe('pnpm, and the TypeScript split', () => {
  const declared = (JSON.parse(REAL.read('package.json')!) as { packageManager: string }).packageManager.replace(/^pnpm@/, '').replace(/\+.*$/, '');
  const major = Number(declared.split('.')[0]);

  it("compares packageManager with npm's latest of its major, and says a newer major in a line", async () => {
    const net = fakeNet({ npm: () => JSON.stringify({ [`latest-${major}`]: `${major}.99.0`, latest: `${major + 1}.0.0` }) });
    const row = await pnpmRow(REAL, net);
    expect(row).toMatchObject({ pin: declared, newest: `${major}.99.0`, state: 'behind' });
    expect(row.notes).toEqual([`pnpm ${major + 1} is npm's latest (${major + 1}.0.0); a new major is the owner's call`]);
    expect(row.body).toContain('three days old');
    const same = await pnpmRow(REAL, fakeNet({ npm: () => JSON.stringify({ [`latest-${major}`]: declared, latest: declared }) }));
    expect(same.state).toBe('current');
  });

  const npm = (admitted: string[]) => (args: string[]) => {
    if (args[1] === 'typescript-eslint@latest') return JSON.stringify({ version: '8.99.0', peerDependencies: { typescript: '>=4.8.4 <7.2.0' } });
    if (args[1] === 'typescript@>=4.8.4 <7.2.0') return JSON.stringify(admitted);
    throw new Error(`unexpected npm ${args.join(' ')}`);
  };

  it('is not due while the peer range admits no stable 7.1 or later', async () => {
    const row = await typescriptRow(REAL, fakeNet({ npm: npm(['6.0.2', '6.0.3', '7.1.0-beta', '7.0.2']) }));
    expect(row).toMatchObject({ state: 'current', shown: 'not yet' });
  });

  it('is due when it admits one, and lists everything the exit takes', async () => {
    const row = await typescriptRow(REAL, fakeNet({ npm: npm(['6.0.3', '7.0.2', '7.1.0', '7.1.1']) }));
    expect(row).toMatchObject({ state: 'behind', newest: '7.1.1', shown: 'can go' });
    for (const step of ['.github/dependabot.yml', '@typescript/native', 'typecheck:legacy', 'scripts/toolchain-split.unit.test.ts', 'AGENTS.md', '0026 row 22']) {
      expect(row.body).toContain(step);
    }
    expect(row.body).toMatch(/not a security lag/);
  });

  it('has nothing to watch once the split is gone', async () => {
    const plain = REAL.read('package.json')!.replace(/\s*"@typescript\/native": "[^"]+",?/, '');
    const row = await typescriptRow(withFiles({ 'package.json': plain }), fakeNet());
    expect(row.state).toBe('current');
  });
});

/** The Trivy the scan names, once it names one; until then the action's default, which the stub gives as v0.70.0. */
const TRIVY_NAMED = stepsUsing(REAL.read('.github/workflows/security-scan.yml')!, 'aquasecurity/trivy-action')[0]?.with.version;
/** Every cosign-installer step of the workflows that install cosign, in COSIGN_FILES' order. */
const COSIGN_STEPS = COSIGN_FILES.flatMap((file) => stepsUsing(REAL.read(file)!, 'sigstore/cosign-installer'));
/** The cosign the workflows name; the installer's default, which the stub gives as v3.0.6, when they name none. */
const COSIGN_NAMED = COSIGN_STEPS[0]?.with['cosign-release'];
/** The workflows with every `cosign-release:` taken out, comments above it included: the installer's default again. */
const cosignDefault = (): Record<string, string> =>
  Object.fromEntries(COSIGN_FILES.map((file) => [file, REAL.read(file)!.replace(/\n( +)with:\n(?:\1 {2}#.*\n)*\1 {2}cosign-release: .*(?=\n)/g, '')]));

/** The Atlas release migration-lint installs (0119, 2026-11-01), and its tag on the community image. */
const ATLAS = atlasPin(REAL.read(ATLAS_WORKFLOW)!);
/** The osv-scanner release the Security Scan installs (0163 T2, 2026-11-20). */
const OSV = osvScannerPin(REAL.read(OSV_SCANNER_WORKFLOW)!);
/** The gitleaks release ci.yml's gitleaks job installs (0163 T6, 2026-11-21). */
const GL = gitleaksPin(REAL.read(GITLEAKS_WORKFLOW)!);
/** The squawk release the Migration locks workflow installs (0165, 2026-11-21). */
const SQUAWK = squawkPin(REAL.read(SQUAWK_WORKFLOW)!);
const ATLAS_TAG = `${ATLAS.version.slice(1)}-community`;

/**
 * THE ATLAS STEP, RUN (review of 2026-11-01). `atlasPin` reads the step's
 * text, and a text can say `exit 1` beside a comparison that no longer feeds
 * it: deleting `refused=1`, comparing `"$seen"` with itself, or dropping the
 * `exit 1` after the version check each left it, and CI, green, while a wrong
 * sum installed the download and ran it. So the step's real `run:` is run
 * here, under bash as the runner runs a step with no `shell:`, with `curl`
 * and `uname` stubbed on the PATH: `curl` serves a stand-in for each
 * architecture's release from ATLAS_HOST and nothing from anywhere else, and
 * the stand-in prints the version it is told to and leaves a mark that it ran.
 */
const atlasScratch = mkdtempSync(join(tmpdir(), 'atlas-step-'));
afterAll(() => rmSync(atlasScratch, { recursive: true, force: true }));
const STUBS = join(atlasScratch, 'bin');
mkdirSync(STUBS);
for (const [name, body] of Object.entries({
  curl: [
    '#!/bin/sh',
    'out= url= prev=',
    'for a in "$@"; do',
    '  [ "$prev" = -o ] && out="$a"',
    '  case "$a" in *://*) url="$a" ;; esac',
    '  prev="$a"',
    'done',
    'printf \'%s\\n\' "$url" >> "$STUB_FETCHED"',
    // The first STUB_FAILS fetches fail as a CDN blip does (the stalwart-cli step retries; 2026-11-01).
    'if [ -n "${STUB_FAILS:-}" ] && [ "$(wc -l < "$STUB_FETCHED")" -le "$STUB_FAILS" ]; then echo "curl: (22) The requested URL returned error: 502" >&2; exit 22; fi',
    'case "$url" in "$STUB_PREFIX"*) name="${url##*/}" ;; *) echo "curl: (6) Could not resolve host: $url" >&2; exit 6 ;; esac',
    '[ -f "$STUB_SERVED/$name" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }',
    '[ -n "$out" ] && cp "$STUB_SERVED/$name" "$out"',
  ],
  uname: ['#!/bin/sh', 'case "$1" in -m) echo "$STUB_MACHINE" ;; *) echo Linux ;; esac'],
  // The stalwart-cli step waits between attempts; here it only says it would.
  sleep: ['#!/bin/sh', 'printf \'%s\\n\' "$1" >> "${STUB_SLEPT:-/dev/null}"'],
})) {
  writeFileSync(join(STUBS, name), `${body.join('\n')}\n`);
  chmodSync(join(STUBS, name), 0o755);
}
/** The bytes served for each architecture: fixed, so each has one sum. */
const STAND_IN = Object.fromEntries(
  ATLAS_ARCHES.map((arch) => [
    arch,
    `#!/bin/sh\n# Not Atlas: the linux/${arch} stand-in a-pin-that-knows-it-is-behind serves.\n: > "$STUB_RAN"\nprintf '%s\\n' "$STUB_SAYS" 'https://github.com/ariga/atlas/releases/latest'\n`,
  ]),
) as Record<'amd64' | 'arm64', string>;
const STAND_IN_SHA256 = Object.fromEntries(
  ATLAS_ARCHES.map((arch) => [`ATLAS_SHA256_${arch.toUpperCase()}`, createHash('sha256').update(STAND_IN[arch as 'amd64' | 'arm64']).digest('hex')]),
);

/** The `run:` and `env:` of the one step of `workflow` that downloads from ATLAS_HOST. */
function atlasStep(workflow: string): { run: string; env: Record<string, string> } {
  type Step = { run?: unknown; env?: Record<string, unknown>; shell?: unknown };
  const jobs = (parseYaml(workflow) as { jobs?: Record<string, { steps?: Step[] }> }).jobs ?? {};
  const steps = Object.values(jobs).flatMap((job) => (job.steps ?? []).filter((s) => typeof s.run === 'string' && s.run.includes(ATLAS_HOST)));
  if (steps.length !== 1) throw new Error(`${steps.length} steps of ${ATLAS_WORKFLOW} download from ${ATLAS_HOST}; one installs Atlas`);
  const step = steps[0]!;
  if (step.shell !== undefined) throw new Error(`the Atlas step names shell: ${String(step.shell)}; this runs it as a step with none`);
  if ((step.run as string).includes('${{')) throw new Error('the Atlas step carries a ${{ }} expression, which this does not render');
  return { run: step.run as string, env: Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, String(v)])) };
}

interface Ran {
  readonly status: number | null;
  /** The file at RUNNER_TEMP/atlas-bin/atlas afterwards, if any. */
  readonly installed: string | undefined;
  /** Whether a stand-in was executed. */
  readonly ran: boolean;
  readonly onPath: boolean;
  readonly fetched: string[];
  readonly log: string;
}

/** Run the step on `machine` (what `uname -m` says), with these sums in its env and a stand-in that says `says`. */
function runAtlasStep(step: { run: string; env: Record<string, string> }, machine: string, sums: Record<string, string>, says: string): Ran {
  const dir = mkdtempSync(join(atlasScratch, 'run-'));
  const temp = join(dir, 'runner-temp');
  const served = join(dir, 'served');
  mkdirSync(temp);
  mkdirSync(served);
  for (const arch of ATLAS_ARCHES) writeFileSync(join(served, `atlas-community-linux-${arch}-${step.env.ATLAS_VERSION}`), STAND_IN[arch as 'amd64' | 'arm64']);
  const files = { script: join(dir, 'step.sh'), path: join(dir, 'GITHUB_PATH'), ran: join(dir, 'ran'), fetched: join(dir, 'fetched') };
  writeFileSync(files.script, step.run);
  writeFileSync(files.path, '');
  writeFileSync(files.fetched, '');
  const r = spawnSync('bash', ['-e', files.script], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      PATH: `${STUBS}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: dir,
      ...step.env,
      ...sums,
      RUNNER_TEMP: temp,
      GITHUB_PATH: files.path,
      STUB_PREFIX: `${ATLAS_HOST}atlas/`,
      STUB_SERVED: served,
      STUB_MACHINE: machine,
      STUB_SAYS: says,
      STUB_RAN: files.ran,
      STUB_FETCHED: files.fetched,
    },
  });
  const bin = join(temp, 'atlas-bin', 'atlas');
  return {
    status: r.status,
    installed: existsSync(bin) ? readFileSync(bin, 'utf8') : undefined,
    ran: existsSync(files.ran),
    onPath: readFileSync(files.path, 'utf8').split('\n').includes(join(temp, 'atlas-bin')),
    fetched: readFileSync(files.fetched, 'utf8').split('\n').filter(Boolean),
    log: `${r.stdout}${r.stderr}`.trim(),
  };
}

/**
 * What the Atlas step of `workflow` does that it must not, run on both
 * machines: install and run anything but the native release when both
 * architectures' bytes are the pinned ones (and fetch both), finish with
 * anything installed, run or on the PATH when either sum is wrong, accept a
 * binary that calls itself another version, or install anything on a machine
 * no release is pinned for. Empty when the step is right.
 */
function atlasStepFaults(workflow: string): string[] {
  const step = atlasStep(workflow);
  const version = step.env.ATLAS_VERSION;
  const release = `atlas community version ${version}`;
  const urls = ATLAS_ARCHES.map((arch) => `${ATLAS_HOST}atlas/atlas-community-linux-${arch}-${version}`);
  const faults: string[] = [];
  for (const [machine, arch] of [['x86_64', 'amd64'], ['aarch64', 'arm64']] as const) {
    const ok = runAtlasStep(step, machine, STAND_IN_SHA256, release);
    if (!(ok.status === 0 && ok.installed === STAND_IN[arch] && ok.ran && ok.onPath && ok.fetched.join(' ') === urls.join(' '))) {
      faults.push(`installs no release on ${machine}: exit ${ok.status}, fetched ${ok.fetched.join(' ') || 'nothing'}\n${ok.log}`);
    }
    const wrongs = [...ATLAS_ARCHES.map((a) => [`ATLAS_SHA256_${a.toUpperCase()}`]), ATLAS_ARCHES.map((a) => `ATLAS_SHA256_${a.toUpperCase()}`)];
    for (const wrong of wrongs) {
      // A wrong sum is the pin ci.yml commits: the stand-in is not those bytes.
      const sums = { ...STAND_IN_SHA256, ...Object.fromEntries(wrong.map((name) => [name, step.env[name] ?? ''])) };
      const r = runAtlasStep(step, machine, sums, release);
      if (r.status === 0 || r.installed !== undefined || r.ran || r.onPath) {
        faults.push(`goes on past a wrong ${wrong.join(' and ')} on ${machine}: exit ${r.status}, installed ${r.installed !== undefined}, ran ${r.ran}\n${r.log}`);
      }
    }
    const canary = runAtlasStep(step, machine, STAND_IN_SHA256, 'atlas community version v1.3.1-f851298-canary');
    if (canary.status === 0) faults.push(`accepts a binary that calls itself v1.3.1-f851298-canary on ${machine}\n${canary.log}`);
  }
  const other = runAtlasStep(step, 'riscv64', STAND_IN_SHA256, release);
  if (other.status === 0 || other.installed !== undefined) faults.push(`installs something on riscv64, which no release is pinned for: exit ${other.status}`);
  return faults;
}

/** The stalwart-cli release the three workflows install (0119, 2026-11-01), as ci.yml names it. */
const STALWART_CLI = stalwartCliPin(REAL.read('.github/workflows/ci.yml')!);
/** `uname -m` on each runner, which is also the release's name for the architecture. */
const STALWART_MACHINES = Object.values(STALWART_CLI_ARCHES);

/**
 * THE STALWART-CLI STEP, RUN (0119, 2026-11-01), as the Atlas step is above:
 * its real `run:` under bash, with `curl`, `uname` and `sleep` stubbed. `curl`
 * serves, for each architecture, a stand-in archive shaped like the
 * release's (`stalwart-cli-<arch>-unknown-linux-gnu/stalwart-cli` beside a
 * README), from STALWART_CLI_HOST at the release only; the stand-in binary
 * prints the version it is told to and leaves a mark that it ran.
 */
const STALWART_STAND_IN = Object.fromEntries(
  STALWART_MACHINES.map((arch) => {
    const dir = mkdtempSync(join(atlasScratch, `stalwart-${arch}-`));
    const top = `stalwart-cli-${arch}-unknown-linux-gnu`;
    mkdirSync(join(dir, top));
    writeFileSync(join(dir, top, 'README.md'), `Not stalwart-cli: the linux/${arch} stand-in a-pin-that-knows-it-is-behind serves.\n`);
    writeFileSync(join(dir, top, 'stalwart-cli'), `#!/bin/sh\n# linux/${arch}\n: > "$STUB_RAN"\nprintf '%s\\n' "$STUB_SAYS"\n`);
    chmodSync(join(dir, top, 'stalwart-cli'), 0o755);
    const made = spawnSync('tar', ['-cJf', join(dir, 'archive.tar.xz'), '-C', dir, top], { encoding: 'utf8' });
    if (made.status !== 0) throw new Error(`tar could not make the stand-in archive: ${made.stderr}`);
    const bytes = readFileSync(join(dir, 'archive.tar.xz'));
    return [arch, { bytes, binary: readFileSync(join(dir, top, 'stalwart-cli'), 'utf8'), sha256: createHash('sha256').update(bytes).digest('hex') }];
  }),
) as Record<string, { bytes: Buffer; binary: string; sha256: string }>;
const STALWART_STAND_IN_SHA256 = Object.fromEntries(
  Object.entries(STALWART_CLI_ARCHES).map(([name, arch]) => [`STALWART_CLI_SHA256_${name}`, STALWART_STAND_IN[arch]!.sha256]),
);

/** The `run:` and `env:` of the one step of `workflow` that downloads from STALWART_CLI_HOST. */
function stalwartStep(workflow: string): { run: string; env: Record<string, string> } {
  type Step = { run?: unknown; env?: Record<string, unknown>; shell?: unknown };
  const jobs = (parseYaml(workflow) as { jobs?: Record<string, { steps?: Step[] }> }).jobs ?? {};
  const steps = Object.values(jobs).flatMap((job) => (job.steps ?? []).filter((s) => typeof s.run === 'string' && s.run.includes(STALWART_CLI_HOST)));
  if (steps.length !== 1) throw new Error(`${steps.length} steps download from ${STALWART_CLI_HOST}; one installs stalwart-cli`);
  const step = steps[0]!;
  if (step.shell !== undefined) throw new Error(`the stalwart-cli step names shell: ${String(step.shell)}; this runs it as a step with none`);
  if ((step.run as string).includes('${{')) throw new Error('the stalwart-cli step carries a ${{ }} expression, which this does not render');
  return { run: step.run as string, env: Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, String(v)])) };
}

/**
 * Run the stalwart-cli step on `machine`, with these sums, a stand-in that says `says`, and the first
 * `fails` fetches failing. `toolCache` is the runner's RUNNER_TOOL_CACHE: a fresh one unless a test
 * passes the same directory to two runs, as one runner's nights share theirs.
 */
function runStalwartStep(
  step: { run: string; env: Record<string, string> },
  machine: string,
  sums: Record<string, string>,
  says: string,
  fails = 0,
  toolCache?: string,
): Ran & { slept: string[] } {
  const dir = mkdtempSync(join(atlasScratch, 'stalwart-run-'));
  const temp = join(dir, 'runner-temp');
  const served = join(dir, 'served');
  mkdirSync(temp);
  mkdirSync(served);
  for (const arch of STALWART_MACHINES) writeFileSync(join(served, `stalwart-cli-${arch}-unknown-linux-gnu.tar.xz`), STALWART_STAND_IN[arch]!.bytes);
  const files = { script: join(dir, 'step.sh'), path: join(dir, 'GITHUB_PATH'), ran: join(dir, 'ran'), fetched: join(dir, 'fetched'), slept: join(dir, 'slept') };
  writeFileSync(files.script, step.run);
  for (const file of [files.path, files.fetched, files.slept]) writeFileSync(file, '');
  const r = spawnSync('bash', ['-e', files.script], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      PATH: `${STUBS}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: dir,
      ...step.env,
      ...sums,
      RUNNER_TEMP: temp,
      RUNNER_TOOL_CACHE: toolCache ?? join(dir, 'tool-cache'),
      GITHUB_PATH: files.path,
      STUB_PREFIX: `${STALWART_CLI_HOST}${step.env.STALWART_CLI_VERSION}/`,
      STUB_SERVED: served,
      STUB_MACHINE: machine,
      STUB_SAYS: says,
      STUB_RAN: files.ran,
      STUB_FETCHED: files.fetched,
      STUB_SLEPT: files.slept,
      ...(fails ? { STUB_FAILS: String(fails) } : {}),
    },
  });
  const bin = join(temp, 'stalwart-cli-bin', 'stalwart-cli');
  return {
    status: r.status,
    installed: existsSync(bin) ? readFileSync(bin, 'utf8') : undefined,
    ran: existsSync(files.ran),
    onPath: readFileSync(files.path, 'utf8').split('\n').includes(join(temp, 'stalwart-cli-bin')),
    fetched: readFileSync(files.fetched, 'utf8').split('\n').filter(Boolean),
    slept: readFileSync(files.slept, 'utf8').split('\n').filter(Boolean),
    log: `${r.stdout}${r.stderr}`.trim(),
  };
}

/**
 * What the stalwart-cli step of `workflow` does that it must not, run on both
 * machines: install and run anything but the native release when both
 * architectures' archives are the pinned ones (and fetch both); finish with
 * anything installed, run or on the PATH when either sum is wrong; accept a
 * binary that calls itself another version; give up before four failed
 * fetches have been waited out, 5, 15, 45 and 135 seconds apart (2026-11-08:
 * GitHub's release download answered 503 for about two minutes, and a failed
 * night resets the count a release waits for), or go on after five; or install
 * anything on a machine no release is pinned for. Empty when the step is right.
 */
function stalwartStepFaults(workflow: string): string[] {
  const step = stalwartStep(workflow);
  const version = step.env.STALWART_CLI_VERSION;
  const release = `stalwart-cli ${version?.replace(/^v/, '')}`;
  const urls = STALWART_MACHINES.map((arch) => `${STALWART_CLI_HOST}${version}/stalwart-cli-${arch}-unknown-linux-gnu.tar.xz`);
  const names = Object.keys(STALWART_CLI_ARCHES).map((name) => `STALWART_CLI_SHA256_${name}`);
  const faults: string[] = [];
  for (const machine of STALWART_MACHINES) {
    const ok = runStalwartStep(step, machine, STALWART_STAND_IN_SHA256, release);
    if (!(ok.status === 0 && ok.installed === STALWART_STAND_IN[machine]!.binary && ok.ran && ok.onPath && ok.fetched.join(' ') === urls.join(' '))) {
      faults.push(`installs no release on ${machine}: exit ${ok.status}, fetched ${ok.fetched.join(' ') || 'nothing'}\n${ok.log}`);
    }
    for (const wrong of [...names.map((n) => [n]), names]) {
      // A wrong sum is the pin the workflow commits: the stand-in is not those bytes.
      const sums = { ...STALWART_STAND_IN_SHA256, ...Object.fromEntries(wrong.map((name) => [name, step.env[name] ?? ''])) };
      const r = runStalwartStep(step, machine, sums, release);
      if (r.status === 0 || r.installed !== undefined || r.ran || r.onPath) {
        faults.push(`goes on past a wrong ${wrong.join(' and ')} on ${machine}: exit ${r.status}, installed ${r.installed !== undefined}, ran ${r.ran}\n${r.log}`);
      }
    }
    const other = runStalwartStep(step, machine, STALWART_STAND_IN_SHA256, 'stalwart-cli 1.0.99');
    if (other.status === 0) faults.push(`accepts a binary that calls itself stalwart-cli 1.0.99 on ${machine}\n${other.log}`);
  }
  // Four failed fetches in a row are waited out, 5, 15, 45 and 135 seconds apart: about four
  // minutes of a download that answers 503; five in a row stop the step with nothing installed.
  const blip = runStalwartStep(step, 'x86_64', STALWART_STAND_IN_SHA256, release, 4);
  if (!(blip.status === 0 && blip.ran && blip.slept.join(' ') === '5 15 45 135')) faults.push(`does not ride out four failed fetches: exit ${blip.status}, slept ${blip.slept.join(' ') || 'never'}\n${blip.log}`);
  const outage = runStalwartStep(step, 'x86_64', STALWART_STAND_IN_SHA256, release, 5);
  if (outage.status === 0 || outage.installed !== undefined || outage.ran || outage.fetched.length !== 5) {
    faults.push(`goes on after five failed fetches: exit ${outage.status}, fetched ${outage.fetched.length} times\n${outage.log}`);
  }
  const riscv = runStalwartStep(step, 'riscv64', STALWART_STAND_IN_SHA256, release);
  if (riscv.status === 0 || riscv.installed !== undefined) faults.push(`installs something on riscv64, which no release is pinned for: exit ${riscv.status}`);
  // The copy a run keeps (2026-11-08: the self-hosted runner got 503 from GitHub's release download for
  // over half an hour). A run keeps both archives in the tool cache as the pinned bytes; the next run on
  // that runner fetches nothing and installs from them, hashed as a fetch is; a kept copy that is not the
  // pinned build stops the run with nothing installed and is removed, so the run after fetches it again.
  const cache = mkdtempSync(join(atlasScratch, 'stalwart-cache-'));
  const keptFile = (arch: string): string => join(cache, 'stalwart-cli', version ?? '', `stalwart-cli-${arch}-unknown-linux-gnu.tar.xz`);
  const keptRight = (arch: string): boolean => existsSync(keptFile(arch)) && readFileSync(keptFile(arch)).equals(STALWART_STAND_IN[arch]!.bytes);
  const first = runStalwartStep(step, 'x86_64', STALWART_STAND_IN_SHA256, release, 0, cache);
  if (!(first.status === 0 && STALWART_MACHINES.every(keptRight))) faults.push(`keeps no copy of both archives for the next run: exit ${first.status}\n${first.log}`);
  const second = runStalwartStep(step, 'x86_64', STALWART_STAND_IN_SHA256, release, 0, cache);
  if (!(second.status === 0 && second.ran && second.installed === STALWART_STAND_IN.x86_64!.binary && second.fetched.length === 0)) {
    faults.push(`fetches again, or installs nothing, with both archives kept: exit ${second.status}, fetched ${second.fetched.join(' ') || 'nothing'}\n${second.log}`);
  }
  mkdirSync(dirname(keptFile('x86_64')), { recursive: true });
  writeFileSync(keptFile('x86_64'), 'not the pinned build');
  const tampered = runStalwartStep(step, 'x86_64', STALWART_STAND_IN_SHA256, release, 0, cache);
  if (tampered.status === 0 || tampered.installed !== undefined || tampered.ran || existsSync(keptFile('x86_64'))) {
    faults.push(`goes on past, or keeps, a kept copy that is not the pinned build: exit ${tampered.status}, installed ${tampered.installed !== undefined}, kept ${existsSync(keptFile('x86_64'))}\n${tampered.log}`);
  }
  const after = runStalwartStep(step, 'x86_64', STALWART_STAND_IN_SHA256, release, 0, cache);
  if (!(after.status === 0 && after.ran && after.fetched.join(' ') === urls[0] && STALWART_MACHINES.every(keptRight))) {
    faults.push(`does not fetch the release again after a kept copy was refused: exit ${after.status}, fetched ${after.fetched.join(' ') || 'nothing'}\n${after.log}`);
  }
  return faults;
}

/**
 * What the install hints a developer reads (STALWART_CLI_HINTS) say that CI
 * does not (#1777's review, 2026-11-01): a hint with no stalwart-cli release
 * URL at all, or one that is not `version`'s own installer, which is how two
 * of them went on piping `releases/latest`'s installer to `sh` after the
 * workflows had stopped. Empty when every hint names `version`.
 */
function stalwartCliHintFaults(repo: Repo, version: string): string[] {
  const installer = `${STALWART_CLI_HOST}${version}/stalwart-cli-installer.sh`;
  return STALWART_CLI_HINTS.flatMap((file) => {
    const text = repo.read(file);
    if (text === null) return [`${file} is not there`];
    const urls = [...text.matchAll(/https:\/\/github\.com\/stalwartlabs\/cli\/releases\/[^\s'"`\\]+/g)].map((m) => m[0]);
    if (urls.length === 0) return [`${file} names no stalwart-cli release to install`];
    return urls.filter((url) => url !== installer).map((url) => `${file} installs ${url}, not the release CI runs (${installer})`);
  });
}

/**
 * What in a workflow's code fetches a moving target (0119, 2026-11-01): a
 * `releases/latest` or `latest/download` URL, or any URL with a `latest` path
 * segment or a `-latest`/`_latest` file name (Atlas's canary, #1773), which
 * names whatever upstream published last; a `docker://` dev database (Atlas's)
 * whose image carries no digest; and an `npx` that may install from npm
 * whatever it names newest when the package is not already installed (every
 * `npx` but `--yes=false`, which runs the lockfile's copy or fails: on CI,
 * npx assumes yes). Each offending line, with its number. Comments are not
 * code.
 */
function floatingFetches(workflow: string): string[] {
  return workflow.split('\n').flatMap((text, i) => {
    if (/^\s*#/.test(text)) return [];
    const found: string[] = [];
    const named = [...text.matchAll(/\bhttps?:\/\/[^\s"'`]+/g)].filter(([url]) => /[/_-]latest(?=[/._?#-]|$)/i.test(url));
    if (/\/releases\/latest\b|\/latest\/download\//.test(text) || named.length > 0) {
      found.push(`line ${i + 1} downloads upstream's newest release, whatever it is: ${text.trim()}`);
    }
    if (/(?:^|[\s;&|(!])npx\s/.test(text) && !/(?:^|[\s;&|(!])npx\s+--yes=false\s/.test(text)) {
      found.push(`line ${i + 1} runs npx, which installs from npm whatever it names newest when the package is missing; --yes=false runs the lockfile's copy or fails: ${text.trim()}`);
    }
    for (const [url] of text.matchAll(/\bdocker(?:\+[a-z]+)?:\/\/[^\s"']+/g)) {
      if (!/@sha256:[0-9a-f]{64}(?:\/|$)/.test(url)) found.push(`line ${i + 1} starts a dev database from an image with no digest: ${url}`);
    }
    return found;
  });
}

/** Every workflow file, by path. */
const WORKFLOWS = REAL.list('.github/workflows').filter((name) => /\.ya?ml$/.test(name)).map((name) => `.github/workflows/${name}`);

/** The GoAccess release `deploy/compose/goaccess/Dockerfile` builds (#1675), read from its own line. */
const GOACCESS_RELEASE = /^# GoAccess (v\d+(?:\.\d+)+)$/m.exec(REAL.read(GOACCESS_DOCKERFILE) ?? '')?.[1] ?? 'no release named';
/**
 * Every tag list answered with the pin itself, plus one newer tag for each of
 * `newer`; and a digest-only pin's tag answered with its own digest, or with
 * the one `newer` names for it.
 */
function registry(newer: Record<string, string> = {}): Stubs {
  const pins = new Map<string, string[]>();
  const digests = new Map<string, string>();
  for (const file of COMPOSE_FILES) {
    for (const line of readImages(REAL.read(file)!)) {
      // A built image's registry is its Dockerfile's FROM's: no registry lists its own name.
      const image = builtImage(REAL, file, line)?.base ?? line;
      pins.set(registryOf(image.repo).name, [...(pins.get(registryOf(image.repo).name) ?? []), image.tag]);
      if (image.digest) digests.set(`${registryOf(image.repo).name}:${image.tag}`, image.digest);
    }
  }
  for (const file of STALWART_FILES) for (const m of (REAL.read(file) ?? '').matchAll(/stalwartlabs\/stalwart:(v[\d.]+(?:-alpine)?)/g)) pins.set('stalwartlabs/stalwart', [m[1]!]);
  // The second Nextcloud major's leg names its own tag, beside the demo's major the compose files run.
  const second = secondMajorPin(REAL.read(NEXTCLOUD_SECOND_MAJOR_WORKFLOW)!);
  pins.set(registryOf(second.repo).name, [...(pins.get(registryOf(second.repo).name) ?? []), second.tag]);
  // The hadolint the lint runs (0119, 2026-11-19), beside the tags of other shapes Docker Hub lists for it (its
  // Debian build, `latest`, a commit's per-platform tag) and another major, none of which its row may take for newer.
  const lint = hadolintPin(REAL.read(HADOLINT_WORKFLOW)!);
  pins.set(registryOf(lint.repo).name, [lint.tag, `${lint.tag}-debian`, 'latest', '2eece55955ced00200be9729e9728cb7dacca505-amd64', 'v3.0.0']);
  // The Semgrep the scan runs (0163 T3, 2026-11-21), beside its `-nonroot` build, the channels Docker Hub lists for
  // it and another major, none of which its row may take for newer.
  const scan = semgrepPin(REAL.read(SEMGREP_WORKFLOW)!);
  pins.set(registryOf(scan.repo).name, [scan.tag, `${scan.tag}-nonroot`, 'latest', 'latest-nonroot', 'canary', 'canary-nonroot', '2.0.0']);
  // The zizmor the workflow audit runs (0119, 2026-11-20), beside a release candidate, `latest` and another
  // major, none of which its row may take for newer.
  const audit = zizmorPin(REAL.read(ZIZMOR_WORKFLOW)!);
  pins.set(registryOf(audit.repo).name, [audit.tag, '9.0.0-rc1', `${audit.tag.split('.')[0]}.999.0-rc2`, 'latest', '2.0.0']);
  // The Atlas release ci.yml installs, as the community image's tag, beside tags of other shapes
  // and another major that its row must never take for a newer release.
  pins.set(ATLAS_IMAGE, [ATLAS_TAG, 'latest-community', '1.99.0-community-alpine', '1.99.0-extended', '2.0.0-community']);
  // The channel each action image ran before it was named (0119, 2026-11-01) names the pinned build.
  for (const image of actionImages(REAL.read(ACTION_IMAGES_WORKFLOW)!)) {
    const spec = ACTION_IMAGES.find((s) => s.action === image.action)!;
    digests.set(`${registryOf(spec.repo).name}:${spec.channel}`, image.digest);
  }
  return {
    json: [
      TOKEN,
      [/\/v2\/(.+)\/tags\/list/, (url: string) => {
        const name = /\/v2\/(.+)\/tags\/list/.exec(url)![1]!;
        return { tags: [...(pins.get(name) ?? []), ...(newer[name] ? [newer[name]] : [])] };
      }],
    ],
    digest: [
      [/\/v2\/(.+)\/manifests\/([^/]+)$/, (url: string) => {
        const [, name, tag] = /\/v2\/(.+)\/manifests\/([^/]+)$/.exec(url)!;
        return newer[`${name}:${tag}`] ?? digests.get(`${name}:${tag}`) ?? new Error(`no digest stubbed for ${name}:${tag}`);
      }],
    ],
    // nodejs/release-keys, its newest commit the one pinned, holding the committed keyring.
    head: { [NODE_RELEASE_KEYS.repo]: `${NODE_RELEASE_KEYS.commit}\tHEAD\n` },
    bytes: [[/^https:\/\/raw\.githubusercontent\.com\/nodejs\/release-keys\//, RELEASE_KEYRING]],
    text: [
      [/trivy-action\/[0-9a-f]{40}\/action\.yaml$/, "inputs:\n  version:\n    default: 'v0.70.0'\n"],
      [/cosign-installer\/[0-9a-f]{40}\/action\.yml$/, "inputs:\n  cosign-release:\n    default: 'v3.0.6'\n"],
    ],
    lsRemote: {
      'https://github.com/aquasecurity/trivy': lsRemote('v0.70.0', ...(TRIVY_NAMED ? [TRIVY_NAMED] : []), ...(newer.trivy ? [newer.trivy] : [])),
      // GoAccess's releases as upstream tags them, two parts and three, up to the one the Dockerfile builds.
      'https://github.com/allinurl/goaccess': lsRemote('v1.9.4', 'v1.10', 'v1.10.2', GOACCESS_RELEASE, ...(newer.goaccess ? [newer.goaccess] : [])),
      'https://github.com/sigstore/cosign': lsRemote('v3.0.6', ...(COSIGN_NAMED ? [COSIGN_NAMED] : []), ...(newer.cosign ? [newer.cosign] : [])),
      // stalwart-cli's releases as upstream tags them, up to the one the workflows install, and another major.
      [STALWART_CLI_UPSTREAM]: lsRemote('v1.0.9', 'v1.0.10', STALWART_CLI.version, 'v2.0.0', ...(newer.stalwartCli ? [newer.stalwartCli] : [])),
      // osv-scanner's releases as upstream tags them, up to the one the Security Scan installs, and another major.
      [OSV_SCANNER_UPSTREAM]: lsRemote('v1.9.2', 'v2.6.0', OSV.version, 'v3.0.0', ...(newer.osvScanner ? [newer.osvScanner] : [])),
      // gitleaks' releases as upstream tags them, up to the one ci.yml installs, and another major.
      [GITLEAKS_UPSTREAM]: lsRemote('v7.6.1', 'v8.29.1', GL.version, 'v9.0.0', ...(newer.gitleaks ? [newer.gitleaks] : [])),
      // squawk's releases as upstream tags them, up to the one the Migration locks workflow installs, and another major.
      [SQUAWK_UPSTREAM]: lsRemote('v1.6.1', 'v2.66.0', SQUAWK.version, 'v3.0.0', ...(newer.squawk ? [newer.squawk] : [])),
    },
  };
}

describe('the routine pins, in one summary issue', () => {
  it('compares every image line of the compose files, or names the row that does, with a reason', async () => {
    const { rows } = await routineRows(REAL, fakeNet(registry()));
    const compared = new Set(rows.map((r) => r.name));
    for (const file of COMPOSE_FILES) {
      for (const line of readImages(REAL.read(file)!)) {
        const image = builtImage(REAL, file, line)?.base ?? line;
        const covered =
          compared.has(image.repo) ||
          image.repo in COMPARED_ELSEWHERE ||
          (file === 'deploy/compose/www.yml' && image.repo === 'nginx' && compared.has('nginx in www.yml'));
        expect(covered, `${file}:${line.line} runs ${image.repo}, which nothing compares`).toBe(true);
      }
    }
    for (const reason of Object.values(COMPARED_ELSEWHERE)) expect(reason.length).toBeGreaterThan(10);
  });

  it('is all current when every registry lists only the pin, and the run writes nothing', async () => {
    const { rows, status } = await routineRows(REAL, fakeNet(registry()));
    expect(rows.filter((r) => r.state !== 'current').map((r) => `${r.name}: ${r.state} ${r.error ?? ''}`)).toEqual([]);
    expect(rows.find((r) => r.name === 'cosign')).toMatchObject({ pin: COSIGN_NAMED, newest: COSIGN_NAMED, state: 'current' });
    expect(status, 'a named cosign is a row, never a status line').toEqual([]);
    const { gh, calls } = fakeGh([OTHER]);
    expect(keepIssue(summaryOf(rows, status), gh, TITLES.routine)).toBe('untouched');
    expect(calls).toEqual([]);
  });

  it("names what is behind: an image newer on its registry, and the Trivy the scan runs", async () => {
    // The pooler is built here since 2026-11-13, so its pin is its Dockerfile's FROM.
    const pgbouncer = builtImage(REAL, COMPOSE, readImages(MANAGED).find((i) => i.repo === 'localhost/pgbouncer')!)!.base;
    const newer = pgbouncer.tag.replace(/(\d+)-p(\d+)$/, (_all, patch: string) => `${Number(patch) + 9}-p0`);
    const { rows, status } = await routineRows(REAL, fakeNet(registry({ 'edoburu/pgbouncer': newer, trivy: 'v0.99.0', cosign: 'v3.99.0' })));
    const behind = rows.filter((r) => r.state === 'behind');
    expect(behind.map((r) => [r.name, r.newest])).toEqual([
      ['edoburu/pgbouncer', newer],
      ['Trivy', 'v0.99.0'],
      ['cosign', 'v3.99.0'],
    ]);
    const summary = summaryOf(rows, status);
    expect(summary.state).toBe('behind');
    expect(summary.body).toContain(`- \`edoburu/pgbouncer\` (deploy/compose/pgbouncer/Dockerfile, deploy/compose/managed.yml): ${pgbouncer.tag}, newest **${newer}**`);
    expect(behind[0]!.notes).toEqual([builtNote('deploy/compose/pgbouncer/Dockerfile')]);
    if (!TRIVY_NAMED) expect(summary.body).toMatch(/no version: named, so trivy-action \S+'s default/);
    expect(summary.body).toContain(`- \`cosign\` (${COSIGN_FILES.join(', ')}): ${COSIGN_NAMED}, newest **v3.99.0**`);
    expect(summary.body).not.toContain('Also known');
    const { gh, calls } = fakeGh([OTHER]);
    expect(keepIssue(summary, gh, TITLES.routine)).toBe('opened');
    expect(calls).toEqual([['issue', 'create', '--title', TITLES.routine, '--body', summary.body]]);
  });

  it("says a rebuild upstream tags `-p<n+1>` is moved by hand: Dependabot proposes no tag that ends otherwise than the pin", async () => {
    // edoburu/pgbouncer rebuilds one PgBouncer as v1.24.1-p0 and then v1.24.1-p1. That rebuild is the way out of
    // the pooler's build, and Dependabot opens no pull request for it, so the line must not point at one.
    const dockerfile = 'deploy/compose/pgbouncer/Dockerfile';
    const pgbouncer = builtImage(REAL, COMPOSE, readImages(MANAGED).find((i) => i.repo === 'localhost/pgbouncer')!)!.base;
    const rebuilt = pgbouncer.tag.replace(/-p(\d+)$/, (_all, build: string) => `-p${Number(build) + 1}`);
    expect(rebuilt, `${pgbouncer.tag} does not end in -p<n>`).not.toBe(pgbouncer.tag);
    expect([endingOf('v1.26.1-p0'), endingOf('v1.26.1-p1'), endingOf('v1.26.2-p0')]).toEqual(['-p0', '-p1', '-p0']);
    const { rows, status } = await routineRows(REAL, fakeNet(registry({ 'edoburu/pgbouncer': rebuilt })));
    const row = rows.find((r) => r.name === 'edoburu/pgbouncer')!;
    expect(row).toMatchObject({ pin: pgbouncer.tag, newest: rebuilt, state: 'behind', notes: [byHandNote(dockerfile, pgbouncer.tag, rebuilt)] });
    const line = (summaryOf(rows, status).body ?? '').split('\n').find((l) => l.startsWith('- `edoburu/pgbouncer`')) ?? '';
    expect(line).toContain(
      `newest **${rebuilt}**; Dependabot reads \`${dockerfile}\` and proposes only tags that end as the pin does, \`${endingOf(pgbouncer.tag)}\`, so never this one, which ends \`${endingOf(rebuilt)}\`: move the FROM to it by tag and digest by hand`,
    );
    expect(line, 'a pull request nobody opens').not.toContain('take its pull request');
    // Every other image built here ends in letters alone, or in nothing, so a newer tag of its shape ends the same
    // and stays Dependabot's; the pooler's ending is the one with a number in it.
    const endings = new Map<string, string>();
    for (const file of COMPOSE_FILES) {
      for (const image of readImages(REAL.read(file)!)) {
        const built = builtImage(REAL, file, image);
        if (built) endings.set(built.base.repo, endingOf(built.base.tag));
      }
    }
    expect(
      [...endings].filter(([, ending]) => /\d/.test(ending)),
      'the bases built here whose tag ends in a number: a newer tag of one may end otherwise, which Dependabot does not propose. Read how its upstream tags a rebuild, and name it here',
    ).toEqual([['edoburu/pgbouncer', endingOf(pgbouncer.tag)]]);
    expect([endingOf('18.7-alpine'), endingOf('7.4.12-bookworm'), endingOf('v4.8.5')]).toEqual(['-alpine', '-bookworm', '']);
  });

  it('names one cosign in every workflow that installs it: the release that signs is the release that checks', () => {
    for (const file of COSIGN_FILES) {
      expect(stepsUsing(REAL.read(file)!, 'sigstore/cosign-installer').length, `${file} installs no cosign`).toBeGreaterThan(0);
    }
    expect(COSIGN_NAMED, 'images.yml names no cosign-release').toMatch(/^v\d+\.\d+\.\d+$/);
    expect(COSIGN_STEPS.map((step) => step.with['cosign-release'])).toEqual(COSIGN_STEPS.map(() => COSIGN_NAMED));
    expect(new Set(COSIGN_STEPS.map((step) => step.sha)).size, 'one cosign-installer commit in both').toBe(1);
  });

  it('holds the cosign copies together, and reads one left to the installer as its default', async () => {
    const release = REAL.read('.github/workflows/release.yml')!;
    const older = withFiles({ '.github/workflows/release.yml': release.replace(`cosign-release: '${COSIGN_NAMED}'`, "cosign-release: 'v3.0.9'") });
    const disagree = (await routineRows(older, fakeNet(registry()))).rows.find((r) => r.name === 'cosign');
    expect(disagree).toMatchObject({ pin: `v3.0.9 / ${COSIGN_NAMED}`, state: 'behind', notes: ['the copies disagree'] });
    const unnamed = withFiles({ '.github/workflows/release.yml': cosignDefault()['.github/workflows/release.yml']! });
    const half = (await routineRows(unnamed, fakeNet(registry()))).rows.find((r) => r.name === 'cosign');
    expect(half).toMatchObject({ pin: `v3.0.6 / ${COSIGN_NAMED}`, state: 'behind', notes: ['the copies disagree'] });
  });

  it("keeps cosign-installer's default a status line: Dependabot moves it with the installer", async () => {
    const plain = cosignDefault();
    for (const text of Object.values(plain)) expect(text).not.toContain('cosign-release');
    const { rows, status } = await routineRows(withFiles(plain), fakeNet(registry({ cosign: 'v3.99.0' })));
    expect(rows.map((r) => r.name)).not.toContain('cosign');
    expect(status).toEqual([`cosign: cosign-installer ${COSIGN_STEPS[0]!.version} installs v3.0.6 (its default), and the newest cosign is v3.99.0`]);
    expect(summaryOf(rows, status).state, 'a status line opens no issue').toBe('current');
  });

  it("compares the Postgres built here by its Dockerfile's FROM, never by a name no registry lists (0146 T15)", async () => {
    const dockerfile = REAL.read('deploy/compose/postgres/Dockerfile')!;
    const from = /^FROM postgres:(\S+)@/m.exec(dockerfile)![1]!;
    // One since alpha.18: the stack's own (trigger-db, Trigger.dev's, built from the same Dockerfile, went with the plane).
    expect(readImages(MANAGED).filter((i) => i.repo === 'localhost/postgres').length, 'managed.yml builds no postgres').toBe(1);
    const [, major, minor, rest] = /^(\d+)\.(\d+)(.*)$/.exec(from)!;
    const newer = `${major}.${Number(minor) + 1}${rest}`;
    const { rows } = await routineRows(REAL, fakeNet(registry({ 'library/postgres': newer })));
    const postgres = rows.filter((r) => /postgres/.test(r.name ?? ''));
    expect(postgres.map((r) => [r.name, r.pin, r.newest, r.state])).toEqual([['postgres', from, newer, 'behind']]);
    expect(postgres[0]!.where).toBe('deploy/compose/postgres/Dockerfile, deploy/compose/managed.yml, deploy/compose/dev.yml');
    // Dependabot reads that Dockerfile too, so the issue says whose pull request moves it,
    // and says it on that line alone: a pulled image's line is Dependabot's blind spot.
    expect(postgres[0]!.notes).toEqual([builtNote('deploy/compose/postgres/Dockerfile')]);
    const body = summaryOf(rows, []).body ?? '';
    expect(body.split('\n').find((l) => l.startsWith('- `postgres`'))).toContain('Dependabot reads this one too, in `deploy/compose/postgres/Dockerfile`');
    expect(body).toMatch(/^Dependabot does not read these pins, but for an image built here, whose line says so:/);
    expect(rows.filter((r) => r.notes?.some((n) => n.startsWith('Dependabot reads'))).map((r) => r.name)).toEqual(['postgres']);
    // Without the Dockerfile there is nothing to say what the image is: an error, never "current".
    const without: Repo = { read: (rel) => (rel === 'deploy/compose/postgres/Dockerfile' ? null : REAL.read(rel)), list: REAL.list };
    await expect(routineRows(without, fakeNet(registry()))).rejects.toThrow(/deploy\/compose\/postgres\/Dockerfile, which is not in this checkout/);
  });

  it('holds the copies together: www.yml with the web image, the scripts with the compose busybox, Stalwart with itself', async () => {
    const www = REAL.read('deploy/compose/www.yml')!.replace(/image: nginx:\S+/, 'image: nginx:1.1-alpine');
    const smoke = REAL.read('deploy/compose/smoke-managed.sh')!.replace(/busybox:[0-9][\w.-]*/, 'busybox:1.2');
    const fixture = REAL.read('deploy/selfhost/setup-stalwart.sh')!.replace(/stalwartlabs\/stalwart:v[\d.]+(?:-alpine)?/, `stalwartlabs/stalwart:${STALWART_IN_LINE}`);
    const repo = withFiles({ 'deploy/compose/www.yml': www, 'deploy/compose/smoke-managed.sh': smoke, 'deploy/selfhost/setup-stalwart.sh': fixture });
    const { rows } = await routineRows(repo, fakeNet(registry()));
    const state = Object.fromEntries(rows.map((r) => [r.name, r.state]));
    expect(state['nginx in www.yml']).toBe('behind');
    expect(state['busybox in the scripts']).toBe('behind');
    expect(state['stalwartlabs/stalwart']).toBe('behind');
    expect(rows.find((r) => r.name === 'stalwartlabs/stalwart')!.notes).toEqual(['the copies disagree', STALWART_RULE]);
  });

  /** AGENTS.md: it moves "only on the owner's decision, recorded in ADR-0022". The issue says whose call. */
  const STALWART_RULE = "the owner's call: it moves only by docs/stalwart-integration-fix.md and ADR-0022, every copy together (AGENTS.md)";
  /**
   * Another tag of the pin's own minor line and shape, which the row compares
   * within (its major since v1, its minor while it was 0.x), derived from the
   * pin so these cases hold when it moves: until 2026-11-20 they named v0.16
   * tags, and a pin on v1.1 compared with v0.16.999 reads as current, not
   * behind; since 2026-11-23 the pin is the Alpine build, and the tag ends as
   * it does.
   */
  const STALWART_IN_LINE = (() => {
    const m = /stalwartlabs\/stalwart:(v\d+\.\d+)\.\d+(-alpine)?/.exec(REAL.read('deploy/selfhost/setup-stalwart.sh')!);
    return `${m?.[1] ?? 'v?'}.999${m?.[2] ?? ''}`;
  })();

  it("compares the GoAccess release the visit count builds with upstream's git tags, two-part and three-part, and holds the image's name to it (#1675)", async () => {
    expect(GOACCESS_RELEASE).toMatch(/^v\d+\.\d+/);
    const current = (await routineRows(REAL, fakeNet(registry()))).rows.find((r) => r.name === 'allinurl/goaccess')!;
    expect(current).toMatchObject({ state: 'current', pin: GOACCESS_RELEASE, newest: GOACCESS_RELEASE });
    // A patch release has three parts where the pin has two: it is still newer.
    const patch = `${GOACCESS_RELEASE}.1`;
    const behind = (await routineRows(REAL, fakeNet(registry({ goaccess: patch })))).rows.find((r) => r.name === 'allinurl/goaccess')!;
    expect(behind).toMatchObject({ state: 'behind', newest: patch });
    // The name the script runs is the release the Dockerfile builds.
    const script = REAL.read('deploy/compose/site-visits.sh')!.replace(/^(GOACCESS_IMAGE="[^:"]+:)[^"]+"$/m, '$19.9"');
    expect(script).not.toBe(REAL.read('deploy/compose/site-visits.sh'));
    const mismatch = (await routineRows(withFiles({ 'deploy/compose/site-visits.sh': script }), fakeNet(registry()))).rows.find((r) => r.name === 'allinurl/goaccess')!;
    expect(mismatch.state).toBe('error');
    expect(mismatch.error).toMatch(/builds GoAccess v/);
  });

  it('compares no image only within a line since the socket proxy, and its HAProxy, went with the plane (alpha.18)', () => {
    expect(LINES).toEqual({});
    expect(readImages(MANAGED).filter((i) => /docker-socket-proxy|haproxy/.test(i.repo))).toEqual([]);
  });

  it('names the rule Stalwart moves by, in the summary issue, beside its line', async () => {
    const { rows, status } = await routineRows(REAL, fakeNet(registry({ 'stalwartlabs/stalwart': STALWART_IN_LINE })));
    const stalwart = rows.find((r) => r.name === 'stalwartlabs/stalwart')!;
    expect(stalwart).toMatchObject({ state: 'behind', newest: STALWART_IN_LINE, notes: [STALWART_RULE] });
    const line = (summaryOf(rows, status).body ?? '').split('\n').find((l) => l.startsWith('- `stalwartlabs/stalwart`'));
    expect(line).toContain(`newest **${STALWART_IN_LINE}**; ${STALWART_RULE}`);
    for (const doc of ['docs/stalwart-integration-fix.md', 'docs/adr/0022-imap-dependency-security-strategy.md']) {
      expect(REAL.read(doc), `${doc} is gone`).not.toBeNull();
    }
  });

  it("compares the Alpine build with the Alpine build's tags of its major alone (ADR-0022, 2026-11-23)", async () => {
    const pin = /stalwartlabs\/stalwart:(v\d+\.\d+\.\d+(?:-alpine)?)/.exec(REAL.read('deploy/selfhost/setup-stalwart.sh')!)![1]!;
    expect(pin).toMatch(/^v\d+\.\d+\.\d+-alpine$/);
    const major = Number(/^v(\d+)/.exec(pin)![1]);
    const rowWith = async (tag: string) =>
      (await routineRows(REAL, fakeNet(registry({ 'stalwartlabs/stalwart': tag })))).rows.find((r) => r.name === 'stalwartlabs/stalwart')!;
    // The Debian build's newer tag, another major's Alpine build and a channel are never newer.
    for (const other of [`v${major}.99.0`, `v${major + 1}.0.0-alpine`, 'latest-alpine']) {
      expect(await rowWith(other), other).toMatchObject({ state: 'current', pin, newest: pin });
    }
    // A newer minor of its own major is, past the minor line the row kept while it was 0.x.
    expect(await rowWith(`v${major}.99.0-alpine`)).toMatchObject({ state: 'behind', newest: `v${major}.99.0-alpine`, notes: [STALWART_RULE] });
  });

  /**
   * Docker Hub's Stalwart tags on 2026-11-23, after v1.2.0 and its Alpine build were pushed at 18:25
   * UTC, newest first as it lists them, beside the last v0.16. The pin moved to v1.2.0-alpine that
   * day (ADR-0022, the owner's word, its three days waived), the newest of its shape in its major.
   */
  const HUB_STALWART_2026_11_23 = [
    'latest', 'v1.2.0', 'v1', 'v1.2', 'latest-alpine', 'v1.2.0-alpine', 'v1-alpine', 'v1.2-alpine',
    'v1.1.1', 'v1.1', 'v1.1.1-alpine', 'v1.1-alpine', 'v1.1.0', 'v1.1.0-alpine', 'v0.16.27',
  ];

  it("takes v1.2.0-alpine for the newest of Docker Hub's tags on 2026-11-23, and the pin for it (ADR-0022)", async () => {
    expect(newestLike('v1.1.1-alpine', HUB_STALWART_2026_11_23, 1)).toBe('v1.2.0-alpine');
    expect(newestLike('v1.2.0-alpine', HUB_STALWART_2026_11_23, 1)).toBe('v1.2.0-alpine');
    // The Debian build's tags have their own newest, which the Alpine pin is never compared with.
    expect(newestLike('v1.1.1', HUB_STALWART_2026_11_23, 1)).toBe('v1.2.0');
    const row = (await routineRows(REAL, fakeNet(registry()))).rows.find((r) => r.name === 'stalwartlabs/stalwart')!;
    expect(row).toMatchObject({ state: 'current', pin: 'v1.2.0-alpine', newest: 'v1.2.0-alpine' });
  });

  // No pin of the compose files is held by its digest alone since alpha.18
  // removed MinIO (`chainguard/minio:latest`, workplan 0167 T9); the rule is
  // held on a stand-in line of that shape, added to the real managed.yml.
  const NO_NUMBER = `sha256:${'a'.repeat(64)}`;
  const withANumberlessPin = () =>
    withFiles({ [COMPOSE]: MANAGED.replace(/\nservices:\n/, `\nservices:\n  store:\n    image: chainguard/minio:latest@${NO_NUMBER}\n`) });

  it("compares a pin with no number, held by its digest, with the digest its registry names for the tag today", async () => {
    const repo = withANumberlessPin();
    const minio = readImages(repo.read(COMPOSE)!).find((i) => i.repo === 'chainguard/minio')!;
    expect(minio).toMatchObject({ tag: 'latest', digest: NO_NUMBER });

    const same = await routineRows(repo, fakeNet(registry({ 'chainguard/minio:latest': NO_NUMBER })));
    expect(same.rows.find((r) => r.name === 'chainguard/minio')).toMatchObject({
      pin: `latest@${minio.digest}`,
      newest: `latest@${minio.digest}`,
      state: 'current',
    });

    const moved = `sha256:${'e'.repeat(64)}`;
    const { rows, status } = await routineRows(repo, fakeNet(registry({ 'chainguard/minio:latest': moved })));
    const row = rows.find((r) => r.name === 'chainguard/minio')!;
    expect(row).toMatchObject({ newest: `latest@${moved}`, state: 'behind', notes: [REBUILD_NOTE] });
    expect(rows.filter((r) => r.state !== 'current').map((r) => r.name)).toEqual(['chainguard/minio']);
    const summary = summaryOf(rows, status);
    expect(summary.state).toBe('behind');
    expect(summary.body).toContain(`- \`chainguard/minio\` (deploy/compose/managed.yml): latest@${minio.digest}, newest **latest@${moved}**; ${REBUILD_NOTE}`);
    expect(table({ issues: [], routine: rows, status })).toMatch(/chainguard\/minio\s+latest@sha256:[0-9a-f]{8}…\s+latest@sha256:eeeeeeee…\s+behind/);
  });

  it('asks the digest with the anonymous token, for the index, and never calls a pin current on an answer that is not a digest', async () => {
    const heads: Array<[string, Record<string, string> | undefined]> = [];
    const net: Net = {
      ...fakeNet({ json: [TOKEN] }),
      digest: async (url, headers) => {
        heads.push([url, headers]);
        return '';
      },
    };
    await expect(registryDigest(net, 'chainguard/minio', 'latest')).rejects.toThrow('registry-1.docker.io named no digest for chainguard/minio:latest');
    expect(heads).toEqual([
      [
        'https://registry-1.docker.io/v2/chainguard/minio/manifests/latest',
        { Authorization: 'Bearer anonymous', Accept: expect.stringContaining('application/vnd.oci.image.index.v1+json') },
      ],
    ]);
    const stubs = registry();
    stubs.digest = [[/\/manifests\//, new Error('registry-1.docker.io answered 429')]];
    const { rows, status } = await routineRows(withANumberlessPin(), fakeNet(stubs));
    expect(rows.find((r) => r.name === 'chainguard/minio')).toMatchObject({ state: 'error', error: 'registry-1.docker.io answered 429' });
    expect(summaryOf(rows, status).state).toBe('error');
  });

  it('reads a pin ahead of every listed tag as a read it cannot trust: the issue is neither closed nor called current', async () => {
    const gatus = readImages(MANAGED).find((i) => i.repo === 'ghcr.io/twin/gatus')!;
    const base = registry();
    const net = fakeNet({ ...base, json: [[/\/v2\/twin\/gatus\/tags\/list/, { tags: ['v5.1.0'] }], ...base.json!] });
    const { rows, status } = await routineRows(REAL, net);
    expect(rows.find((r) => r.name === 'ghcr.io/twin/gatus')).toMatchObject({ pin: gatus.tag, newest: 'v5.1.0', state: 'ahead' });
    const summary = summaryOf(rows, status);
    expect(summary.state).toBe('error');
    expect(summary.error).toBe('1 could not be read');
    expect(summary.body).toContain(`- \`ghcr.io/twin/gatus\` (deploy/compose/managed.yml): ${gatus.tag} is ahead of every listed tag (newest listed v5.1.0)`);
    const { gh, calls } = fakeGh([OTHER, { number: 9, title: TITLES.routine, body: 'x', state: 'open' }]);
    expect(keepIssue(summary, gh, TITLES.routine)).toBe('untouched');
    expect(calls).toEqual([]);
  });

  it('never reads a registry it could not reach as current, and never closes the issue for it', async () => {
    const stubs = registry();
    stubs.json = [TOKEN, [/\/v2\/.+\/tags\/list/, new Error('registry-1.docker.io answered 429')]];
    const { rows, status } = await routineRows(REAL, fakeNet(stubs));
    expect(rows.some((r) => r.state === 'error')).toBe(true);
    const summary = summaryOf(rows, status);
    expect(summary.state).toBe('error');
    const { gh, calls } = fakeGh([OTHER, { number: 9, title: TITLES.routine, body: 'x', state: 'open' }]);
    expect(keepIssue(summary, gh, TITLES.routine)).toBe('untouched');
    expect(calls).toEqual([]);
  });
});

/**
 * THE ATLAS CLI CI DOWNLOADED BY ITS `-latest` NAME (workplan 0119, 2026-11-01).
 * `migration-lint` in `.github/workflows/ci.yml` fetched
 * `atlas-community-linux-<arch>-latest` with no version and no checksum, and ran it, on the owner's machine for a main push.
 * That name is a canary build of upstream's master (CI printed
 * `v1.3.1-f851298-canary`), not a release. The step now names a release in
 * `ATLAS_VERSION`, pins a sha256 for both architectures the job runs on, reads
 * and compares both before anything is made executable, and checks that what
 * it installed calls itself that release. This holds the real step to that with
 * `atlasPin`, each refusal by a mutation of it, and the row that says when a
 * newer release is listed. `atlasPin` reads text, so the step is also RUN
 * (`atlasStepFaults`), and each way a review found to keep the text and lose
 * the refusal is a mutation that must fail it.
 */
describe('the Atlas CLI migration-lint runs: a named release, checked by its sha256 first', () => {
  const ci = REAL.read(ATLAS_WORKFLOW)!;
  /** ci.yml with one change, which must be a change. */
  const mutate = (from: string | RegExp, to: string): string => {
    const next = ci.replace(from, to);
    expect(next, `${String(from)} is not in ${ATLAS_WORKFLOW}`).not.toBe(ci);
    return next;
  };

  it('names a release and a sha256 for each architecture the job runs on', () => {
    expect(ATLAS.version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(Object.keys(ATLAS.sha256).sort()).toEqual([...ATLAS_ARCHES].sort());
    for (const arch of ATLAS_ARCHES) expect(ATLAS.sha256[arch as 'amd64' | 'arm64']).toMatch(/^[0-9a-f]{64}$/);
    // The machines the job lands on: one arm64 runner for a push (GitHub's while ci.yml's switch keeps the
    // push jobs off the machine, the self-hosted one when `CI_PUSH_ON_SELF_HOSTED` is `true`; 2026-11-08);
    // hosted amd64 AND arm64 for a pull request, so the arm64 binary has run before the owner's machine
    // runs it (review of 2026-11-01). Where each event lands is a-merge-that-ran-beside-the-socket's.
    type Job = { 'runs-on'?: unknown; strategy?: { 'fail-fast'?: unknown; matrix?: { runner?: unknown } } };
    const job = (parseYaml(ci) as { jobs: Record<string, Job> }).jobs['migration-lint'];
    expect(job?.['runs-on']).toBe('${{ matrix.runner }}');
    expect(job?.strategy?.['fail-fast']).toBe(false);
    expect(job?.strategy?.matrix?.runner).toBe(
      "${{ github.event_name == 'push' && vars.CI_PUSH_ON_SELF_HOSTED == 'true' && fromJSON('[\"self-hosted\"]') || github.event_name != 'pull_request' && fromJSON('[\"ubuntu-24.04-arm\"]') || fromJSON('[\"ubuntu-24.04\",\"ubuntu-24.04-arm\"]') }}",
    );
  });

  it("refuses the canary's name, a version that is no release, a missing or shared sum, a download run before it is checked, and no version check", () => {
    expect(() => atlasPin(mutate('-${ATLAS_VERSION}"', '-latest"'))).toThrow(/downloads a name with no version/);
    expect(() => atlasPin(mutate('linux-${arch}-${ATLAS_VERSION}"', 'linux-${arch}"'))).toThrow(/downloads a name with no version/);
    expect(() => atlasPin(mutate(/ATLAS_VERSION: v\d+\.\d+\.\d+/, 'ATLAS_VERSION: latest'))).toThrow(/names no release/);
    expect(() => atlasPin(mutate(/\n +ATLAS_SHA256_ARM64: [0-9a-f]{64}/, ''))).toThrow(/no sha256 for linux\/arm64/);
    expect(() => atlasPin(mutate(`ATLAS_SHA256_ARM64: ${ATLAS.sha256.arm64}`, `ATLAS_SHA256_ARM64: ${ATLAS.sha256.amd64}`))).toThrow(
      /one sha256 for two architectures/,
    );
    // Made executable before the loop that reads the sums.
    const install = /\n( +install -m 0755 [^\n]+)/.exec(ci)![1]!;
    const early = mutate(`\n${install}`, '').replace(/\n( +)for arch in amd64 arm64; do/, (all, space: string) => `\n${space}${install.trim()}${all}`);
    expect(() => atlasPin(early)).toThrow(/executable before its sha256 is read/);
    // Read, but a mismatch no longer stops the step.
    expect(() => atlasPin(mutate(/\n +\[ "\$refused" = 0 \] \|\| exit 1/, ''))).toThrow(/executable before its sha256 is read/);
    expect(() => atlasPin(mutate(/\n +seen="\$\(sha256sum "\$download"\)"/, ''))).toThrow(/never reads a sha256/);
    expect(() => atlasPin(mutate('"atlas community version $ATLAS_VERSION"', '"atlas"'))).toThrow(/calls itself the release named/);
  });

  it('refuses a step that compares with anything but the pinned sum, fetches from elsewhere, or makes another file executable', () => {
    expect(() => atlasPin(mutate('if [ "$seen" = "$pinned" ]; then', 'if true; then'))).toThrow(/never compares the sum it read/);
    expect(() => atlasPin(mutate('pinned="$ATLAS_SHA256_AMD64"', 'pinned="$(curl -sSfL "https://atlasbinaries.example/atlas-${ATLAS_VERSION}.sha256")"'))).toThrow(
      /fetches from somewhere other than/,
    );
    expect(() => atlasPin(mutate('pinned="$ATLAS_SHA256_ARM64"', 'pinned="$(cat "$RUNNER_TEMP/arm64.sha256")"'))).toThrow(/pinned sum is not only/);
    const install = /\n( +)install -m 0755 "\$RUNNER_TEMP\/atlas-\$ATLAS_VERSION-linux-\$native"/;
    expect(() => atlasPin(mutate(install, '\n$1curl -sSfL -o "$RUNNER_TEMP/x" https://mirror.example/atlas\n$1install -m 0755 "$RUNNER_TEMP/x"'))).toThrow(
      /fetches from somewhere other than/,
    );
    expect(() => atlasPin(mutate(install, '\n$1curl -sSfL -o "$RUNNER_TEMP/x" "$ATLAS_MIRROR"\n$1install -m 0755 "$RUNNER_TEMP/x"'))).toThrow(
      /fetches something that is not the release/,
    );
    expect(() => atlasPin(mutate(install, '\n$1install -m 0755 "$RUNNER_TEMP/atlas-$ATLAS_VERSION-linux-amd64"'))).toThrow(
      /makes executable something other than the file it hashed/,
    );
  });

  it('runs: the native release when both sums are the pinned ones, and nothing when either is not or it calls itself another version', () => {
    expect(atlasStepFaults(ci)).toEqual([]);
  });

  it('runs: a mismatch that no longer stops it, or a version check that no longer fails, fails it, each by a mutation of the real step', () => {
    const faults = (from: string | RegExp, to: string): string => atlasStepFaults(mutate(from, to)).join('\n');
    // A wrong sum is reported, and the step goes on to install and run it.
    expect(faults(/\n +refused=1\n/, '\n')).toMatch(/goes on past a wrong ATLAS_SHA256_AMD64 on x86_64/);
    expect(faults('if [ "$seen" = "$pinned" ]', 'if [ "$seen" = "$seen" ]')).toMatch(/goes on past a wrong ATLAS_SHA256_ARM64 on aarch64/);
    expect(faults('if [ "$seen" = "$pinned" ]', 'if true')).toMatch(/goes on past a wrong ATLAS_SHA256_AMD64 and ATLAS_SHA256_ARM64/);
    expect(faults(/\n +\[ "\$refused" = 0 \] \|\| exit 1/, '')).toMatch(/goes on past a wrong ATLAS_SHA256_ARM64 on x86_64/);
    // Each sum compared with the other architecture's pin.
    expect(faults('pinned="$ATLAS_SHA256_AMD64"; else pinned="$ATLAS_SHA256_ARM64"', 'pinned="$ATLAS_SHA256_ARM64"; else pinned="$ATLAS_SHA256_AMD64"')).toMatch(
      /installs no release on x86_64/,
    );
    // The version check that no longer stops it.
    expect(faults(/if \[ "\$\{said/, 'if false && [ "${said')).toMatch(/accepts a binary that calls itself v1\.3\.1-f851298-canary on x86_64/);
    expect(faults(/(does not call itself community \$ATLAS_VERSION\."\n) +exit 1\n/, '$1')).toMatch(/accepts a binary that calls itself v1\.3\.1-f851298-canary on aarch64/);
    // The other architecture's binary installed.
    expect(faults('linux-$native" "$RUNNER_TEMP/atlas-bin/atlas"', 'linux-amd64" "$RUNNER_TEMP/atlas-bin/atlas"')).toMatch(/installs no release on aarch64/);
  });

  it('is a routine pin, current while the community image lists no newer release of its shape and major', async () => {
    const { rows } = await routineRows(REAL, fakeNet(registry()));
    expect(rows.find((r) => r.name === 'Atlas')).toEqual({ name: 'Atlas', where: ATLAS_WORKFLOW, pin: ATLAS.version, newest: ATLAS.version, state: 'current' });
  });

  it('is behind when a newer community release is listed, and says the three values move together', async () => {
    const newer = ATLAS_TAG.replace(/^(\d+)\.(\d+)\.(\d+)/, (_all, major: string, minor: string, patch: string) => `${major}.${minor}.${Number(patch) + 9}`);
    const { rows, status } = await routineRows(REAL, fakeNet(registry({ [ATLAS_IMAGE]: newer })));
    const release = `v${newer.replace(/-community$/, '')}`;
    expect(rows.find((r) => r.name === 'Atlas')).toMatchObject({ pin: ATLAS.version, newest: release, state: 'behind', notes: [ATLAS_NOTE] });
    expect(summaryOf(rows, status).body).toContain(`- \`Atlas\` (${ATLAS_WORKFLOW}): ${ATLAS.version}, newest **${release}**; ${ATLAS_NOTE}`);
  });

  it('is never current when the step cannot be read', async () => {
    const canary = withFiles({ [ATLAS_WORKFLOW]: mutate('-${ATLAS_VERSION}"', '-latest"') });
    const row = (await routineRows(canary, fakeNet(registry()))).rows.find((r) => r.name === 'Atlas');
    expect(row).toMatchObject({ state: 'error' });
    expect(row?.error).toMatch(/downloads a name with no version/);
  });
});

/**
 * THE NODE.JS RELEASE KEYRING NOTHING WATCHED (#1780's review, 2026-11-01).
 * The Windows payload's `node.exe` check verifies the release's signed
 * `SHASUMS256.txt` with a copy of nodejs/release-keys'
 * `gpg-only-active-keys/pubring.kbx` at a named commit (`NODE_RELEASE_KEYS`).
 * A build notices only a releaser the copy lacks; a key retired, revoked or
 * given a new expiry upstream (two such commits came in the ten days before
 * the pin) reached nothing. Its row compares the file at upstream's newest
 * commit with the blob id the pin records.
 */
/**
 * THE OSV-SCANNER THE SECURITY SCAN READS THE LOCKFILE WITH (workplan 0163 T2,
 * 2026-11-20). It fails the build on a malicious package, so the binary that
 * decides must be the release named, as Atlas's is: `OSV_SCANNER_VERSION`, a
 * sha256 for both architectures a runner here has, both read and compared
 * before anything is made executable, and a check that what was installed
 * calls itself that release. `osvScannerPin` reads the step's text, each
 * refusal held by a mutation of it; the step is also RUN under bash with the
 * same `curl` and `uname` stubs, and each way to keep the text and lose the
 * refusal is a mutation that must fail it; and the row says when a newer
 * release of the same major is tagged.
 */
const osvScratch = mkdtempSync(join(tmpdir(), 'osv-step-'));
afterAll(() => rmSync(osvScratch, { recursive: true, force: true }));
/** The bytes served for each architecture: fixed, so each has one sum. */
const OSV_STAND_IN = Object.fromEntries(
  OSV_SCANNER_ARCHES.map((arch) => [
    arch,
    `#!/bin/sh\n# Not osv-scanner: the linux/${arch} stand-in a-pin-that-knows-it-is-behind serves.\n: > "$STUB_RAN"\nprintf '%s\\n' "$STUB_SAYS" 'osv-scalibr version: 0.0.0'\n`,
  ]),
) as Record<'amd64' | 'arm64', string>;
const OSV_STAND_IN_SHA256 = Object.fromEntries(
  OSV_SCANNER_ARCHES.map((arch) => [`OSV_SCANNER_SHA256_${arch.toUpperCase()}`, createHash('sha256').update(OSV_STAND_IN[arch as 'amd64' | 'arm64']).digest('hex')]),
);

/** The `run:` and `env:` of the one step of `workflow` that downloads from OSV_SCANNER_HOST. */
function osvStep(workflow: string): { run: string; env: Record<string, string> } {
  type Step = { run?: unknown; env?: Record<string, unknown>; shell?: unknown };
  const jobs = (parseYaml(workflow) as { jobs?: Record<string, { steps?: Step[] }> }).jobs ?? {};
  const steps = Object.values(jobs).flatMap((job) => (job.steps ?? []).filter((s) => typeof s.run === 'string' && s.run.includes(OSV_SCANNER_HOST)));
  if (steps.length !== 1) throw new Error(`${steps.length} steps of ${OSV_SCANNER_WORKFLOW} download from ${OSV_SCANNER_HOST}; one installs osv-scanner`);
  const step = steps[0]!;
  if (step.shell !== undefined) throw new Error(`the osv-scanner step names shell: ${String(step.shell)}; this runs it as a step with none`);
  if ((step.run as string).includes('${{')) throw new Error('the osv-scanner step carries a ${{ }} expression, which this does not render');
  return { run: step.run as string, env: Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, String(v)])) };
}

/** Run the step on `machine` (what `uname -m` says), with these sums in its env and a stand-in whose first line is `says`. */
function runOsvStep(step: { run: string; env: Record<string, string> }, machine: string, sums: Record<string, string>, says: string) {
  const dir = mkdtempSync(join(osvScratch, 'run-'));
  const temp = join(dir, 'runner-temp');
  const served = join(dir, 'served');
  mkdirSync(temp);
  mkdirSync(served);
  for (const arch of OSV_SCANNER_ARCHES) writeFileSync(join(served, `osv-scanner_linux_${arch}`), OSV_STAND_IN[arch as 'amd64' | 'arm64']);
  const files = { script: join(dir, 'step.sh'), ran: join(dir, 'ran'), fetched: join(dir, 'fetched') };
  writeFileSync(files.script, step.run);
  writeFileSync(files.fetched, '');
  const r = spawnSync('bash', ['-e', files.script], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      PATH: `${STUBS}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: dir,
      ...step.env,
      ...sums,
      RUNNER_TEMP: temp,
      STUB_PREFIX: `${OSV_SCANNER_HOST}${step.env.OSV_SCANNER_VERSION}/`,
      STUB_SERVED: served,
      STUB_MACHINE: machine,
      STUB_SAYS: says,
      STUB_RAN: files.ran,
      STUB_FETCHED: files.fetched,
    },
  });
  const bin = join(temp, 'osv-bin', 'osv-scanner');
  return {
    status: r.status,
    installed: existsSync(bin) ? readFileSync(bin, 'utf8') : undefined,
    ran: existsSync(files.ran),
    fetched: readFileSync(files.fetched, 'utf8').split('\n').filter(Boolean),
    log: `${r.stdout}${r.stderr}`.trim(),
  };
}

/**
 * What the osv-scanner step of `workflow` does that it must not, run on both
 * machines: install and run anything but the native release when both
 * architectures' bytes are the pinned ones (and fetch both), finish with
 * anything installed or run when either sum is wrong, accept a binary that
 * calls itself another version, or install anything on a machine no release
 * is pinned for. Empty when the step is right.
 */
function osvStepFaults(workflow: string): string[] {
  const step = osvStep(workflow);
  const version = step.env.OSV_SCANNER_VERSION!;
  const release = `osv-scanner version: ${version.slice(1)}`;
  const urls = OSV_SCANNER_ARCHES.map((arch) => `${OSV_SCANNER_HOST}${version}/osv-scanner_linux_${arch}`);
  const faults: string[] = [];
  for (const [machine, arch] of [['x86_64', 'amd64'], ['aarch64', 'arm64']] as const) {
    const ok = runOsvStep(step, machine, OSV_STAND_IN_SHA256, release);
    if (!(ok.status === 0 && ok.installed === OSV_STAND_IN[arch] && ok.ran && ok.fetched.join(' ') === urls.join(' '))) {
      faults.push(`installs no release on ${machine}: exit ${ok.status}, fetched ${ok.fetched.join(' ') || 'nothing'}\n${ok.log}`);
    }
    const names = OSV_SCANNER_ARCHES.map((a) => `OSV_SCANNER_SHA256_${a.toUpperCase()}`);
    for (const wrong of [...names.map((n) => [n]), names]) {
      // A wrong sum is the pin the workflow commits: the stand-in is not those bytes.
      const sums = { ...OSV_STAND_IN_SHA256, ...Object.fromEntries(wrong.map((name) => [name, step.env[name] ?? ''])) };
      const r = runOsvStep(step, machine, sums, release);
      if (r.status === 0 || r.installed !== undefined || r.ran) {
        faults.push(`goes on past a wrong ${wrong.join(' and ')} on ${machine}: exit ${r.status}, installed ${r.installed !== undefined}, ran ${r.ran}\n${r.log}`);
      }
    }
    const older = runOsvStep(step, machine, OSV_STAND_IN_SHA256, 'osv-scanner version: 2.6.0');
    if (older.status === 0) faults.push(`accepts a binary that calls itself osv-scanner 2.6.0 on ${machine}\n${older.log}`);
  }
  const other = runOsvStep(step, 'riscv64', OSV_STAND_IN_SHA256, release);
  if (other.status === 0 || other.installed !== undefined) faults.push(`installs something on riscv64, which no release is pinned for: exit ${other.status}`);
  return faults;
}

describe('the osv-scanner the Security Scan runs: a named release, checked by its sha256 first', () => {
  const scan = REAL.read(OSV_SCANNER_WORKFLOW)!;
  /** security-scan.yml with one change, which must be a change. */
  const mutate = (from: string | RegExp, to: string): string => {
    const next = scan.replace(from, to);
    expect(next, `${String(from)} is not in ${OSV_SCANNER_WORKFLOW}`).not.toBe(scan);
    return next;
  };

  it('names a release and a sha256 for each architecture a runner here has', () => {
    expect(OSV.version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(Object.keys(OSV.sha256).sort()).toEqual([...OSV_SCANNER_ARCHES].sort());
    for (const arch of OSV_SCANNER_ARCHES) expect(OSV.sha256[arch as 'amd64' | 'arm64']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a name with no version, a version that is no release, a missing or shared sum, a download run before it is checked, and no version check', () => {
    expect(() => osvScannerPin(mutate('${OSV_SCANNER_VERSION}/osv-scanner_linux_${arch}', 'latest/osv-scanner_linux_${arch}'))).toThrow(/downloads a name with no version/);
    expect(() => osvScannerPin(mutate(/OSV_SCANNER_VERSION: v\d+\.\d+\.\d+/, 'OSV_SCANNER_VERSION: latest'))).toThrow(/names no release/);
    expect(() => osvScannerPin(mutate(/\n +OSV_SCANNER_SHA256_ARM64: [0-9a-f]{64}/, ''))).toThrow(/no sha256 for linux\/arm64/);
    expect(() => osvScannerPin(mutate(`OSV_SCANNER_SHA256_ARM64: ${OSV.sha256.arm64}`, `OSV_SCANNER_SHA256_ARM64: ${OSV.sha256.amd64}`))).toThrow(
      /one sha256 for two architectures/,
    );
    // Made executable before the loop that reads the sums.
    const install = /\n( +install -m 0755 "\$RUNNER_TEMP\/osv-scanner-[^\n]+)/.exec(scan)![1]!;
    const early = mutate(`\n${install}`, '').replace(/\n( +)mismatched=0\n/, (all, space: string) => `\n${space}${install.trim()}${all}`);
    expect(() => osvScannerPin(early)).toThrow(/executable before its sha256 is read/);
    // Read, but a mismatch no longer stops the step.
    expect(() => osvScannerPin(mutate(/\n +\[ "\$mismatched" = 0 \] \|\| exit 1/, ''))).toThrow(/executable before its sha256 is read/);
    expect(() => osvScannerPin(mutate(/\n +sum="\$\(sha256sum "\$binary"\)"/, ''))).toThrow(/never reads a sha256/);
    expect(() => osvScannerPin(mutate('"osv-scanner version: ${OSV_SCANNER_VERSION#v}"', '"osv-scanner"'))).toThrow(/calls itself the release named/);
  });

  it('refuses a step that compares with anything but the pinned sum, fetches from elsewhere or pipes to a shell, or makes another file executable', () => {
    expect(() => osvScannerPin(mutate('if [ "$sum" = "$expected" ]; then', 'if true; then'))).toThrow(/never compares the sum it read/);
    expect(() =>
      osvScannerPin(mutate('expected="$OSV_SCANNER_SHA256_AMD64"', 'expected="$(curl -sSfL "https://mirror.example/osv-scanner_${OSV_SCANNER_VERSION}.sha256")"')),
    ).toThrow(/fetches from somewhere other than/);
    expect(() => osvScannerPin(mutate('expected="$OSV_SCANNER_SHA256_ARM64"', 'expected="$(cat "$RUNNER_TEMP/arm64.sha256")"'))).toThrow(/expected sum is not only/);
    const install = /\n( +)install -m 0755 "\$RUNNER_TEMP\/osv-scanner-\$OSV_SCANNER_VERSION-linux-\$native"/;
    expect(() =>
      osvScannerPin(mutate(install, '\n$1curl -sSfL "https://github.com/google/osv-scanner/releases/download/${OSV_SCANNER_VERSION}/install.sh" | sh\n$1install -m 0755 "$RUNNER_TEMP/osv-scanner-$OSV_SCANNER_VERSION-linux-$native"')),
    ).toThrow(/pipes something to a shell/);
    expect(() => osvScannerPin(mutate(install, '\n$1curl -sSfL -o "$RUNNER_TEMP/x" "$OSV_MIRROR"\n$1install -m 0755 "$RUNNER_TEMP/x"'))).toThrow(
      /fetches something that is not the release/,
    );
    expect(() => osvScannerPin(mutate(install, '\n$1install -m 0755 "$RUNNER_TEMP/osv-scanner-$OSV_SCANNER_VERSION-linux-amd64"'))).toThrow(
      /makes executable something other than the file it hashed/,
    );
  });

  it('runs: the native release when both sums are the pinned ones, and nothing when either is not or it calls itself another version', () => {
    expect(osvStepFaults(scan)).toEqual([]);
  });

  it('runs: a mismatch that no longer stops it, or a version check that no longer fails, fails it, each by a mutation of the real step', () => {
    const faults = (from: string | RegExp, to: string): string => osvStepFaults(mutate(from, to)).join('\n');
    expect(faults(/\n +mismatched=1\n/, '\n')).toMatch(/goes on past a wrong OSV_SCANNER_SHA256_AMD64 on x86_64/);
    expect(faults('if [ "$sum" = "$expected" ]', 'if [ "$sum" = "$sum" ]')).toMatch(/goes on past a wrong OSV_SCANNER_SHA256_ARM64 on aarch64/);
    expect(faults(/\n +\[ "\$mismatched" = 0 \] \|\| exit 1/, '')).toMatch(/goes on past a wrong OSV_SCANNER_SHA256_ARM64 on x86_64/);
    expect(faults(/(does not call itself \$\{OSV_SCANNER_VERSION#v\}\."\n) +exit 1\n/, '$1')).toMatch(/accepts a binary that calls itself osv-scanner 2\.6\.0 on x86_64/);
  });

  it('is a routine pin, current while upstream tags no newer release of its major, another major included', async () => {
    const { rows } = await routineRows(REAL, fakeNet(registry()));
    expect(rows.find((r) => r.name === 'osv-scanner')).toEqual({ name: 'osv-scanner', where: OSV_SCANNER_WORKFLOW, pin: OSV.version, newest: OSV.version, state: 'current' });
  });

  it('is behind when a newer release of its major is tagged, and says the three values move together', async () => {
    const { rows } = await routineRows(REAL, fakeNet(registry({ osvScanner: 'v2.99.0' })));
    expect(rows.find((r) => r.name === 'osv-scanner')).toMatchObject({ pin: OSV.version, newest: 'v2.99.0', state: 'behind', notes: [OSV_SCANNER_NOTE] });
  });

  it('is never current when the step cannot be read', async () => {
    const gone = withFiles({ [OSV_SCANNER_WORKFLOW]: mutate('https://github.com/google/osv-scanner/releases/download/', 'https://mirror.example/osv-scanner/') });
    const row = (await routineRows(gone, fakeNet(registry()))).rows.find((r) => r.name === 'osv-scanner');
    expect(row).toMatchObject({ state: 'error' });
  });
});

/**
 * THE GITLEAKS CI READS A PULL REQUEST'S COMMITS WITH (workplan 0163 T6,
 * 2026-11-21). It fails a pull request on a finding, so the binary that
 * decides must be the release named, as osv-scanner's is: `GITLEAKS_VERSION`,
 * a sha256 for both architectures' archives, both read and compared before
 * anything is unpacked, and a check that what was installed calls itself that
 * release. `gitleaksPin` reads the step's text, each refusal held by a
 * mutation of it; the step is also RUN under bash, against archives built here
 * and served by the same `curl` and `uname` stubs, and each way to keep the
 * text and lose the refusal is a mutation that must fail it; and the row says
 * when a newer release of the same major is tagged.
 */
const gitleaksScratch = mkdtempSync(join(tmpdir(), 'gitleaks-step-'));
afterAll(() => rmSync(gitleaksScratch, { recursive: true, force: true }));
/** The stand-in each archive holds as `gitleaks`: it says what STUB_SAYS says, and that it ran. */
const GL_STAND_IN = Object.fromEntries(
  GITLEAKS_ARCHES.map((arch) => [arch, `#!/bin/sh\n# Not gitleaks: the linux/${arch} stand-in a-pin-that-knows-it-is-behind serves.\n: > "$STUB_RAN"\nprintf '%s\\n' "$STUB_SAYS"\n`]),
) as Record<'x64' | 'arm64', string>;
/** Each architecture's archive, as the release names it, built once with the stand-in in it. */
const GL_SERVED = join(gitleaksScratch, 'served');
mkdirSync(GL_SERVED);
const GL_ARCHIVE = (arch: string): string => `gitleaks_${GL.version.slice(1)}_linux_${arch}.tar.gz`;
for (const arch of GITLEAKS_ARCHES) {
  const packed = join(gitleaksScratch, `packed-${arch}`);
  mkdirSync(packed);
  writeFileSync(join(packed, 'gitleaks'), GL_STAND_IN[arch as 'x64' | 'arm64']);
  chmodSync(join(packed, 'gitleaks'), 0o755);
  const made = spawnSync('tar', ['-czf', join(GL_SERVED, GL_ARCHIVE(arch)), '-C', packed, 'gitleaks'], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`tar could not build the linux/${arch} stand-in archive: ${made.stderr}`);
}
const GL_STAND_IN_SHA256 = Object.fromEntries(
  GITLEAKS_ARCHES.map((arch) => [`GITLEAKS_SHA256_${arch.toUpperCase()}`, createHash('sha256').update(readFileSync(join(GL_SERVED, GL_ARCHIVE(arch)))).digest('hex')]),
);

/** The `run:` and `env:` of the one step of `workflow` that downloads from GITLEAKS_HOST. */
function gitleaksStep(workflow: string): { run: string; env: Record<string, string> } {
  type Step = { run?: unknown; env?: Record<string, unknown>; shell?: unknown };
  const jobs = (parseYaml(workflow) as { jobs?: Record<string, { steps?: Step[] }> }).jobs ?? {};
  const steps = Object.values(jobs).flatMap((job) => (job.steps ?? []).filter((s) => typeof s.run === 'string' && s.run.includes(GITLEAKS_HOST)));
  if (steps.length !== 1) throw new Error(`${steps.length} steps of ${GITLEAKS_WORKFLOW} download from ${GITLEAKS_HOST}; one installs gitleaks`);
  const step = steps[0]!;
  if (step.shell !== undefined) throw new Error(`the gitleaks step names shell: ${String(step.shell)}; this runs it as a step with none`);
  if ((step.run as string).includes('${{')) throw new Error('the gitleaks step carries a ${{ }} expression, which this does not render');
  return { run: step.run as string, env: Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, String(v)])) };
}

/** Run the step on `machine` (what `uname -m` says), with these sums in its env and a stand-in that says `says`. */
function runGitleaksStep(step: { run: string; env: Record<string, string> }, machine: string, sums: Record<string, string>, says: string) {
  const dir = mkdtempSync(join(gitleaksScratch, 'run-'));
  const temp = join(dir, 'runner-temp');
  mkdirSync(temp);
  const files = { script: join(dir, 'step.sh'), ran: join(dir, 'ran'), fetched: join(dir, 'fetched') };
  writeFileSync(files.script, step.run);
  writeFileSync(files.fetched, '');
  const r = spawnSync('bash', ['-e', files.script], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      PATH: `${STUBS}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: dir,
      ...step.env,
      ...sums,
      RUNNER_TEMP: temp,
      STUB_PREFIX: `${GITLEAKS_HOST}${step.env.GITLEAKS_VERSION}/`,
      STUB_SERVED: GL_SERVED,
      STUB_MACHINE: machine,
      STUB_SAYS: says,
      STUB_RAN: files.ran,
      STUB_FETCHED: files.fetched,
    },
  });
  const bin = join(temp, 'gitleaks-bin', 'gitleaks');
  return {
    status: r.status,
    installed: existsSync(bin) ? readFileSync(bin, 'utf8') : undefined,
    ran: existsSync(files.ran),
    fetched: readFileSync(files.fetched, 'utf8').split('\n').filter(Boolean),
    log: `${r.stdout}${r.stderr}`.trim(),
  };
}

/**
 * What the gitleaks step of `workflow` does that it must not, run on both
 * machines: install and run anything but the native release when both
 * architectures' archives are the pinned ones (and fetch both), finish with
 * anything installed or run when either sum is wrong, accept a binary that
 * calls itself another version, or install anything on a machine no release
 * is pinned for. Empty when the step is right.
 */
function gitleaksStepFaults(workflow: string): string[] {
  const step = gitleaksStep(workflow);
  const version = step.env.GITLEAKS_VERSION!;
  const release = version.slice(1);
  const urls = GITLEAKS_ARCHES.map((arch) => `${GITLEAKS_HOST}${version}/${GL_ARCHIVE(arch)}`);
  const faults: string[] = [];
  for (const [machine, arch] of [['x86_64', 'x64'], ['aarch64', 'arm64']] as const) {
    const ok = runGitleaksStep(step, machine, GL_STAND_IN_SHA256, release);
    if (!(ok.status === 0 && ok.installed === GL_STAND_IN[arch] && ok.ran && ok.fetched.join(' ') === urls.join(' '))) {
      faults.push(`installs no release on ${machine}: exit ${ok.status}, fetched ${ok.fetched.join(' ') || 'nothing'}\n${ok.log}`);
    }
    const names = GITLEAKS_ARCHES.map((a) => `GITLEAKS_SHA256_${a.toUpperCase()}`);
    for (const wrong of [...names.map((n) => [n]), names]) {
      // A wrong sum is the pin the workflow commits: the stand-in archives are not those bytes.
      const sums = { ...GL_STAND_IN_SHA256, ...Object.fromEntries(wrong.map((name) => [name, step.env[name] ?? ''])) };
      const r = runGitleaksStep(step, machine, sums, release);
      if (r.status === 0 || r.installed !== undefined || r.ran) {
        faults.push(`goes on past a wrong ${wrong.join(' and ')} on ${machine}: exit ${r.status}, installed ${r.installed !== undefined}, ran ${r.ran}\n${r.log}`);
      }
    }
    const older = runGitleaksStep(step, machine, GL_STAND_IN_SHA256, '8.29.1');
    if (older.status === 0) faults.push(`accepts a binary that calls itself gitleaks 8.29.1 on ${machine}\n${older.log}`);
  }
  const other = runGitleaksStep(step, 'riscv64', GL_STAND_IN_SHA256, release);
  if (other.status === 0 || other.installed !== undefined) faults.push(`installs something on riscv64, which no release is pinned for: exit ${other.status}`);
  return faults;
}

describe('the gitleaks CI reads a pull request with: a named release, its archive checked by its sha256 first', () => {
  const ci = REAL.read(GITLEAKS_WORKFLOW)!;
  /** ci.yml with one change, which must be a change. */
  const mutate = (from: string | RegExp, to: string): string => {
    const next = ci.replace(from, to);
    expect(next, `${String(from)} is not in ${GITLEAKS_WORKFLOW}`).not.toBe(ci);
    return next;
  };

  it('names a release and a sha256 for each architecture a runner here has', () => {
    expect(GL.version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(Object.keys(GL.sha256).sort()).toEqual([...GITLEAKS_ARCHES].sort());
    for (const arch of GITLEAKS_ARCHES) expect(GL.sha256[arch as 'x64' | 'arm64']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a name with no version, a version that is no release, a missing or shared sum, an archive unpacked before it is checked, and no version check', () => {
    expect(() => gitleaksPin(mutate('${GITLEAKS_VERSION}/gitleaks_', 'latest/gitleaks_'))).toThrow(/downloads a name with no version/);
    expect(() => gitleaksPin(mutate(/GITLEAKS_VERSION: v\d+\.\d+\.\d+/, 'GITLEAKS_VERSION: latest'))).toThrow(/names no release/);
    expect(() => gitleaksPin(mutate(/\n +GITLEAKS_SHA256_ARM64: [0-9a-f]{64}/, ''))).toThrow(/no sha256 for linux\/arm64/);
    expect(() => gitleaksPin(mutate(`GITLEAKS_SHA256_ARM64: ${GL.sha256.arm64}`, `GITLEAKS_SHA256_ARM64: ${GL.sha256.x64}`))).toThrow(/one sha256 for two architectures/);
    // Unpacked before the loop that reads the sums.
    const unpack = /\n( +tar -xzf "\$RUNNER_TEMP\/gitleaks-[^\n]+)/.exec(ci)![1]!;
    const early = mutate(`\n${unpack}`, '').replace(/\n( +)bad=0\n/, (all, space: string) => `\n${space}${unpack.trim()}${all}`);
    expect(() => gitleaksPin(early)).toThrow(/unpacks its download before its sha256 is read/);
    // Read, but a mismatch no longer stops the step.
    expect(() => gitleaksPin(mutate(/\n +\[ "\$bad" = 0 \] \|\| exit 1/, ''))).toThrow(/unpacks its download before its sha256 is read/);
    expect(() => gitleaksPin(mutate(/\n +got="\$\(sha256sum "\$archive"\)"/, ''))).toThrow(/never reads a sha256/);
    expect(() => gitleaksPin(mutate('if [ "$answer" != "${GITLEAKS_VERSION#v}" ]; then', 'if false; then'))).toThrow(/calls itself the release named/);
  });

  it('refuses a step that compares with anything but the pinned sum, fetches from elsewhere or pipes to a shell, unpacks another archive or makes a file executable itself', () => {
    expect(() => gitleaksPin(mutate('if [ "$got" = "$pin" ]; then', 'if true; then'))).toThrow(/never compares the sum it read/);
    expect(() => gitleaksPin(mutate('pin="$GITLEAKS_SHA256_X64"', 'pin="$(curl -sSfL "https://mirror.example/gitleaks_${GITLEAKS_VERSION}.sha256")"'))).toThrow(
      /fetches from somewhere other than/,
    );
    expect(() => gitleaksPin(mutate('pin="$GITLEAKS_SHA256_ARM64"', 'pin="$(cat "$RUNNER_TEMP/arm64.sha256")"'))).toThrow(/pinned sum is not only/);
    const unpack = /\n( +)tar -xzf "\$RUNNER_TEMP\/gitleaks-\$GITLEAKS_VERSION-linux-\$wanted\.tar\.gz"/;
    expect(() =>
      gitleaksPin(mutate(unpack, '\n$1curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/${GITLEAKS_VERSION}/install.sh" | sh\n$1tar -xzf "$RUNNER_TEMP/gitleaks-$GITLEAKS_VERSION-linux-$wanted.tar.gz"')),
    ).toThrow(/pipes something to a shell/);
    expect(() => gitleaksPin(mutate(unpack, '\n$1curl -sSfL -o "$RUNNER_TEMP/x" "$GITLEAKS_MIRROR"\n$1tar -xzf "$RUNNER_TEMP/gitleaks-$GITLEAKS_VERSION-linux-$wanted.tar.gz"'))).toThrow(
      /fetches something that is not the release/,
    );
    expect(() => gitleaksPin(mutate(unpack, '\n$1tar -xzf "$RUNNER_TEMP/gitleaks-$GITLEAKS_VERSION-linux-x64.tar.gz"'))).toThrow(
      /unpacks something other than the archive it hashed/,
    );
    expect(() => gitleaksPin(mutate(/\n( +)answer="/, '\n$1chmod 0755 "$RUNNER_TEMP/gitleaks-bin/gitleaks"\n$1answer="'))).toThrow(/makes something executable itself/);
  });

  it('runs: the native release when both sums are the pinned ones, and nothing when either is not or it calls itself another version', () => {
    expect(gitleaksStepFaults(ci)).toEqual([]);
  });

  it('runs: a mismatch that no longer stops it, or a version check that no longer fails, fails it, each by a mutation of the real step', () => {
    const faults = (from: string | RegExp, to: string): string => gitleaksStepFaults(mutate(from, to)).join('\n');
    expect(faults(/\n +bad=1\n/, '\n')).toMatch(/goes on past a wrong GITLEAKS_SHA256_X64 on x86_64/);
    expect(faults('if [ "$got" = "$pin" ]', 'if [ "$got" = "$got" ]')).toMatch(/goes on past a wrong GITLEAKS_SHA256_ARM64 on aarch64/);
    expect(faults(/\n +\[ "\$bad" = 0 \] \|\| exit 1/, '')).toMatch(/goes on past a wrong GITLEAKS_SHA256_ARM64 on x86_64/);
    expect(faults(/(not \$\{GITLEAKS_VERSION#v\}\."\n) +exit 1\n/, '$1')).toMatch(/accepts a binary that calls itself gitleaks 8\.29\.1 on x86_64/);
  });

  it('is a routine pin, current while upstream tags no newer release of its major, another major included', async () => {
    const { rows } = await routineRows(REAL, fakeNet(registry()));
    expect(rows.find((r) => r.name === 'gitleaks')).toEqual({ name: 'gitleaks', where: GITLEAKS_WORKFLOW, pin: GL.version, newest: GL.version, state: 'current' });
  });

  it('is behind when a newer release of its major is tagged, and says the three values move together', async () => {
    const { rows } = await routineRows(REAL, fakeNet(registry({ gitleaks: 'v8.99.0' })));
    expect(rows.find((r) => r.name === 'gitleaks')).toMatchObject({ pin: GL.version, newest: 'v8.99.0', state: 'behind', notes: [GITLEAKS_NOTE] });
  });

  it('is never current when the step cannot be read', async () => {
    const gone = withFiles({ [GITLEAKS_WORKFLOW]: mutate('https://github.com/gitleaks/gitleaks/releases/download/', 'https://mirror.example/gitleaks/') });
    const row = (await routineRows(gone, fakeNet(registry()))).rows.find((r) => r.name === 'gitleaks');
    expect(row).toMatchObject({ state: 'error' });
  });
});

/**
 * THE SQUAWK THE MIGRATION LOCKS WORKFLOW READS THE MIGRATIONS WITH (workplan
 * 0165, 2026-11-21). It is report only, and still the binary that runs must be
 * the release named, as osv-scanner's is: `SQUAWK_VERSION`, a sha256 for both
 * architectures a runner here has, both read and compared before anything is
 * made executable, and a check that what was installed calls itself that
 * release. `squawkPin` reads the step's text, each refusal held by a mutation
 * of it; the step is also RUN under bash with the same `curl` and `uname`
 * stubs, and each way to keep the text and lose the refusal is a mutation that
 * must fail it; and the row says when a newer release of the same major is
 * tagged.
 */
const squawkScratch = mkdtempSync(join(tmpdir(), 'squawk-step-'));
afterAll(() => rmSync(squawkScratch, { recursive: true, force: true }));
/** The bytes served for each architecture: fixed, so each has one sum. */
const SQUAWK_STAND_IN = Object.fromEntries(
  SQUAWK_ARCHES.map((arch) => [
    arch,
    `#!/bin/sh\n# Not squawk: the linux-musl/${arch} stand-in a-pin-that-knows-it-is-behind serves.\n: > "$STUB_RAN"\nprintf '%s\\n' "$STUB_SAYS"\n`,
  ]),
) as Record<'x64' | 'arm64', string>;
const SQUAWK_STAND_IN_SHA256 = Object.fromEntries(
  SQUAWK_ARCHES.map((arch) => [`SQUAWK_SHA256_${arch.toUpperCase()}`, createHash('sha256').update(SQUAWK_STAND_IN[arch as 'x64' | 'arm64']).digest('hex')]),
);

/** The `run:` and `env:` of the one step of `workflow` that downloads from SQUAWK_HOST. */
function squawkStep(workflow: string): { run: string; env: Record<string, string> } {
  type Step = { run?: unknown; env?: Record<string, unknown>; shell?: unknown };
  const jobs = (parseYaml(workflow) as { jobs?: Record<string, { steps?: Step[] }> }).jobs ?? {};
  const steps = Object.values(jobs).flatMap((job) => (job.steps ?? []).filter((s) => typeof s.run === 'string' && s.run.includes(SQUAWK_HOST)));
  if (steps.length !== 1) throw new Error(`${steps.length} steps of ${SQUAWK_WORKFLOW} download from ${SQUAWK_HOST}; one installs squawk`);
  const step = steps[0]!;
  if (step.shell !== undefined) throw new Error(`the squawk step names shell: ${String(step.shell)}; this runs it as a step with none`);
  if ((step.run as string).includes('${{')) throw new Error('the squawk step carries a ${{ }} expression, which this does not render');
  return { run: step.run as string, env: Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, String(v)])) };
}

/** Run the step on `machine` (what `uname -m` says), with these sums in its env and a stand-in whose first line is `says`. */
function runSquawkStep(step: { run: string; env: Record<string, string> }, machine: string, sums: Record<string, string>, says: string) {
  const dir = mkdtempSync(join(squawkScratch, 'run-'));
  const temp = join(dir, 'runner-temp');
  const served = join(dir, 'served');
  mkdirSync(temp);
  mkdirSync(served);
  for (const arch of SQUAWK_ARCHES) writeFileSync(join(served, `squawk-linux-musl-${arch}`), SQUAWK_STAND_IN[arch as 'x64' | 'arm64']);
  const files = { script: join(dir, 'step.sh'), ran: join(dir, 'ran'), fetched: join(dir, 'fetched'), path: join(dir, 'github-path') };
  writeFileSync(files.script, step.run);
  writeFileSync(files.fetched, '');
  const r = spawnSync('bash', ['-e', files.script], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      PATH: `${STUBS}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: dir,
      ...step.env,
      ...sums,
      RUNNER_TEMP: temp,
      GITHUB_PATH: files.path,
      STUB_PREFIX: `${SQUAWK_HOST}${step.env.SQUAWK_VERSION}/`,
      STUB_SERVED: served,
      STUB_MACHINE: machine,
      STUB_SAYS: says,
      STUB_RAN: files.ran,
      STUB_FETCHED: files.fetched,
    },
  });
  const bin = join(temp, 'squawk-bin', 'squawk');
  return {
    status: r.status,
    installed: existsSync(bin) ? readFileSync(bin, 'utf8') : undefined,
    ran: existsSync(files.ran),
    onPath: existsSync(files.path) && readFileSync(files.path, 'utf8').includes(join(temp, 'squawk-bin')),
    fetched: readFileSync(files.fetched, 'utf8').split('\n').filter(Boolean),
    log: `${r.stdout}${r.stderr}`.trim(),
  };
}

/**
 * What the squawk step of `workflow` does that it must not, run on both
 * machines: install and run anything but the native release when both
 * architectures' bytes are the pinned ones (and fetch both, and put it on the
 * PATH), finish with anything installed or run when either sum is wrong, put
 * on the PATH a binary that calls itself another version, or install anything
 * on a machine no release is pinned for. Empty when the step is right.
 */
function squawkStepFaults(workflow: string): string[] {
  const step = squawkStep(workflow);
  const version = step.env.SQUAWK_VERSION!;
  const release = `squawk ${version.slice(1)}`;
  const urls = SQUAWK_ARCHES.map((arch) => `${SQUAWK_HOST}${version}/squawk-linux-musl-${arch}`);
  const faults: string[] = [];
  for (const [machine, arch] of [['x86_64', 'x64'], ['aarch64', 'arm64']] as const) {
    const ok = runSquawkStep(step, machine, SQUAWK_STAND_IN_SHA256, release);
    if (!(ok.status === 0 && ok.installed === SQUAWK_STAND_IN[arch] && ok.ran && ok.onPath && ok.fetched.join(' ') === urls.join(' '))) {
      faults.push(`installs no release on ${machine}: exit ${ok.status}, fetched ${ok.fetched.join(' ') || 'nothing'}, on the PATH ${ok.onPath}\n${ok.log}`);
    }
    const names = SQUAWK_ARCHES.map((a) => `SQUAWK_SHA256_${a.toUpperCase()}`);
    for (const wrong of [...names.map((n) => [n]), names]) {
      // A wrong sum is the pin the workflow commits: the stand-in is not those bytes.
      const sums = { ...SQUAWK_STAND_IN_SHA256, ...Object.fromEntries(wrong.map((name) => [name, step.env[name] ?? ''])) };
      const r = runSquawkStep(step, machine, sums, release);
      if (r.status === 0 || r.installed !== undefined || r.ran) {
        faults.push(`goes on past a wrong ${wrong.join(' and ')} on ${machine}: exit ${r.status}, installed ${r.installed !== undefined}, ran ${r.ran}\n${r.log}`);
      }
    }
    const older = runSquawkStep(step, machine, SQUAWK_STAND_IN_SHA256, 'squawk 2.66.0');
    if (older.status === 0 || older.onPath) faults.push(`accepts a binary that calls itself squawk 2.66.0 on ${machine}\n${older.log}`);
  }
  const other = runSquawkStep(step, 'riscv64', SQUAWK_STAND_IN_SHA256, release);
  if (other.status === 0 || other.installed !== undefined) faults.push(`installs something on riscv64, which no release is pinned for: exit ${other.status}`);
  return faults;
}

describe('the squawk the Migration locks workflow runs: a named release, checked by its sha256 first', () => {
  const locks = REAL.read(SQUAWK_WORKFLOW)!;
  /** migration-locks.yml with one change, which must be a change. */
  const mutate = (from: string | RegExp, to: string): string => {
    const next = locks.replace(from, to);
    expect(next, `${String(from)} is not in ${SQUAWK_WORKFLOW}`).not.toBe(locks);
    return next;
  };

  it('names a release and a sha256 for each architecture a runner here has', () => {
    expect(SQUAWK.version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(Object.keys(SQUAWK.sha256).sort()).toEqual([...SQUAWK_ARCHES].sort());
    for (const arch of SQUAWK_ARCHES) expect(SQUAWK.sha256[arch as 'x64' | 'arm64']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a name with no version, a version that is no release, a missing or shared sum, a download run before it is checked, and no version check', () => {
    expect(() => squawkPin(mutate('${SQUAWK_VERSION}/squawk-linux-musl-${arch}', 'latest/squawk-linux-musl-${arch}'))).toThrow(/downloads a name with no version/);
    expect(() => squawkPin(mutate(/SQUAWK_VERSION: v\d+\.\d+\.\d+/, 'SQUAWK_VERSION: latest'))).toThrow(/names no release/);
    expect(() => squawkPin(mutate(/\n +SQUAWK_SHA256_ARM64: [0-9a-f]{64}/, ''))).toThrow(/no sha256 for linux-musl\/arm64/);
    expect(() => squawkPin(mutate(`SQUAWK_SHA256_ARM64: ${SQUAWK.sha256.arm64}`, `SQUAWK_SHA256_ARM64: ${SQUAWK.sha256.x64}`))).toThrow(/one sha256 for two architectures/);
    // Made executable before the loop that reads the sums.
    const install = /\n( +install -m 0755 "\$RUNNER_TEMP\/squawk-[^\n]+)/.exec(locks)![1]!;
    const early = mutate(`\n${install}`, '').replace(/\n( +)differs=0\n/, (all, space: string) => `\n${space}${install.trim()}${all}`);
    expect(() => squawkPin(early)).toThrow(/executable before its sha256 is read/);
    // Read, but a mismatch no longer stops the step.
    expect(() => squawkPin(mutate(/\n +\[ "\$differs" = 0 \] \|\| exit 1/, ''))).toThrow(/executable before its sha256 is read/);
    expect(() => squawkPin(mutate(/\n +got="\$\(sha256sum "\$asset"\)"/, ''))).toThrow(/never reads a sha256/);
    expect(() => squawkPin(mutate('"squawk ${SQUAWK_VERSION#v}"', '"squawk"'))).toThrow(/calls itself the release named/);
  });

  it('refuses a step that compares with anything but the pinned sum, fetches from elsewhere or pipes to a shell, or makes another file executable', () => {
    expect(() => squawkPin(mutate('if [ "$got" = "$want" ]; then', 'if true; then'))).toThrow(/never compares the sum it read/);
    expect(() => squawkPin(mutate('want="$SQUAWK_SHA256_X64"', 'want="$(curl -sSfL "https://mirror.example/squawk_${SQUAWK_VERSION}.sha256")"'))).toThrow(
      /fetches from somewhere other than/,
    );
    expect(() => squawkPin(mutate('want="$SQUAWK_SHA256_ARM64"', 'want="$(cat "$RUNNER_TEMP/arm64.sha256")"'))).toThrow(/wanted sum is not only/);
    const install = /\n( +)install -m 0755 "\$RUNNER_TEMP\/squawk-\$SQUAWK_VERSION-linux-musl-\$native"/;
    expect(() =>
      squawkPin(mutate(install, '\n$1curl -sSfL "https://github.com/sbdchd/squawk/releases/download/${SQUAWK_VERSION}/install.sh" | sh\n$1install -m 0755 "$RUNNER_TEMP/squawk-$SQUAWK_VERSION-linux-musl-$native"')),
    ).toThrow(/pipes something to a shell/);
    expect(() => squawkPin(mutate(install, '\n$1curl -sSfL -o "$RUNNER_TEMP/x" "$SQUAWK_MIRROR"\n$1install -m 0755 "$RUNNER_TEMP/x"'))).toThrow(
      /fetches something that is not the release/,
    );
    expect(() => squawkPin(mutate(install, '\n$1install -m 0755 "$RUNNER_TEMP/squawk-$SQUAWK_VERSION-linux-musl-x64"'))).toThrow(
      /makes executable something other than the file it hashed/,
    );
  });

  it('runs: the native release when both sums are the pinned ones, and nothing when either is not or it calls itself another version', () => {
    expect(squawkStepFaults(locks)).toEqual([]);
  });

  it('runs: a mismatch that no longer stops it, or a version check that no longer fails, fails it, each by a mutation of the real step', () => {
    const faults = (from: string | RegExp, to: string): string => squawkStepFaults(mutate(from, to)).join('\n');
    expect(faults(/\n +differs=1\n/, '\n')).toMatch(/goes on past a wrong SQUAWK_SHA256_X64 on x86_64/);
    expect(faults('if [ "$got" = "$want" ]', 'if [ "$got" = "$got" ]')).toMatch(/goes on past a wrong SQUAWK_SHA256_ARM64 on aarch64/);
    expect(faults(/\n +\[ "\$differs" = 0 \] \|\| exit 1/, '')).toMatch(/goes on past a wrong SQUAWK_SHA256_ARM64 on x86_64/);
    expect(faults(/(does not call itself \$\{SQUAWK_VERSION#v\}\."\n) +exit 1\n/, '$1')).toMatch(/accepts a binary that calls itself squawk 2\.66\.0 on x86_64/);
  });

  it('is a routine pin, current while upstream tags no newer release of its major, another major included', async () => {
    const { rows } = await routineRows(REAL, fakeNet(registry()));
    expect(rows.find((r) => r.name === 'squawk')).toEqual({ name: 'squawk', where: SQUAWK_WORKFLOW, pin: SQUAWK.version, newest: SQUAWK.version, state: 'current' });
  });

  it('is behind when a newer release of its major is tagged, and says the three values move together', async () => {
    const { rows } = await routineRows(REAL, fakeNet(registry({ squawk: 'v2.99.0' })));
    expect(rows.find((r) => r.name === 'squawk')).toMatchObject({ pin: SQUAWK.version, newest: 'v2.99.0', state: 'behind', notes: [SQUAWK_NOTE] });
  });

  it('is never current when the step cannot be read', async () => {
    const gone = withFiles({ [SQUAWK_WORKFLOW]: mutate('https://github.com/sbdchd/squawk/releases/download/', 'https://mirror.example/squawk/') });
    const row = (await routineRows(gone, fakeNet(registry()))).rows.find((r) => r.name === 'squawk');
    expect(row).toMatchObject({ state: 'error' });
  });
});

describe('the Node.js release keyring, against the file at upstream\'s newest commit', () => {
  const PACKAGER = REAL.read(NODE_RELEASE_KEYS_FILE)!;
  const NEWER = 'f'.repeat(40);
  const row = async (repo: Repo, stubs: Stubs) => (await routineRows(repo, fakeNet({ ...registry(), ...stubs }))).rows.find((r) => r.name === 'Node.js release keys');

  it('reads the pin as scripts/package-appliance.mjs exports it, and the committed keyring is its blob', () => {
    expect(releaseKeysPin(PACKAGER)).toEqual({ ...NODE_RELEASE_KEYS });
    expect(gitBlobId(RELEASE_KEYRING)).toBe(NODE_RELEASE_KEYS.blob);
  });

  it('is current while upstream\'s newest commit holds the same file, whatever that commit is, and reads it at that commit', async () => {
    const net = fakeNet({ ...registry(), head: { [NODE_RELEASE_KEYS.repo]: `${NEWER}\tHEAD\n` } });
    const found = (await routineRows(REAL, net)).rows.find((r) => r.name === 'Node.js release keys');
    expect(found).toMatchObject({ where: NODE_RELEASE_KEYS_FILE, state: 'current', newest: `${NEWER} (blob ${NODE_RELEASE_KEYS.blob.slice(0, 12)})` });
    expect(net.asked).toContain(`https://raw.githubusercontent.com/nodejs/release-keys/${NEWER}/${NODE_RELEASE_KEYS.path}`);
  });

  it('is behind when upstream\'s file differs (a key retired, revoked, or given a new expiry), naming the newer commit and the route', async () => {
    const retired = Buffer.concat([RELEASE_KEYRING.subarray(0, 1000), RELEASE_KEYRING.subarray(1001)]);
    const stubs = { head: { [NODE_RELEASE_KEYS.repo]: `${NEWER}\tHEAD\n` }, bytes: [[/raw\.githubusercontent\.com\/nodejs\/release-keys\//, retired]] as Array<[RegExp, Answer]> };
    const { rows, status } = await routineRows(REAL, fakeNet({ ...registry(), ...stubs }));
    const found = rows.find((r) => r.name === 'Node.js release keys');
    expect(found).toMatchObject({ state: 'behind', newest: `${NEWER} (blob ${gitBlobId(retired).slice(0, 12)})`, notes: [NODE_RELEASE_KEYS_NOTE] });
    expect(summaryOf(rows, status).body).toContain(`- \`Node.js release keys\` (${NODE_RELEASE_KEYS_FILE}): ${NODE_RELEASE_KEYS.commit} `);
    expect(summaryOf(rows, status).body).toContain(`newest **${NEWER} (blob `);
  });

  it('is behind when the recorded blob id is not the file upstream holds, and never current on a pin or an answer it cannot read', async () => {
    const pinned = (from: string, to: string) => {
      expect(PACKAGER).toContain(from);
      return withFiles({ [NODE_RELEASE_KEYS_FILE]: PACKAGER.replace(from, to) });
    };
    expect(await row(pinned(`blob: '${NODE_RELEASE_KEYS.blob}'`, `blob: '${'0'.repeat(40)}'`), {})).toMatchObject({ state: 'behind' });
    expect(await row(pinned(`commit: '${NODE_RELEASE_KEYS.commit}'`, "commit: 'main'"), {})).toMatchObject({ state: 'error', error: expect.stringMatching(/names no commit: main/) });
    expect(await row(pinned('export const NODE_RELEASE_KEYS = {', 'export const NODE_KEYS = {'), {})).toMatchObject({ state: 'error', error: expect.stringMatching(/has no NODE_RELEASE_KEYS/) });
    expect(await row(pinned(`path: '${NODE_RELEASE_KEYS.path}'`, "path: '../pubring.kbx'"), {})).toMatchObject({ state: 'error', error: expect.stringMatching(/names no path/) });
    expect(await row(REAL, { head: { [NODE_RELEASE_KEYS.repo]: '' } })).toMatchObject({ state: 'error', error: expect.stringMatching(/named no commit for HEAD/) });
    expect(await row(REAL, { head: {} })).toMatchObject({ state: 'error' });
    expect(await row(REAL, { bytes: [[/raw\.githubusercontent\.com/, new Error('raw.githubusercontent.com answered 404')]] as Array<[RegExp, Answer]> })).toMatchObject({ state: 'error' });
  });
});

/**
 * THE STALWART-CLI CI INSTALLED FROM `releases/latest` (workplan 0119,
 * 2026-11-01). `ci.yml`'s integration tests and both E2E gates piped
 * `releases/latest/download/stalwart-cli-installer.sh` to `sh`: a script that
 * named no version until it was fetched, and installed whatever release was
 * newest that hour, on the owner's machine for a main push and every night.
 * The three now carry one step, word for word, that names a release, pins a
 * sha256 for both architectures, reads and compares both before anything is
 * unpacked, and checks that what it installed calls itself that release. This
 * holds the three to that step with `stalwartCliPin`, each refusal by a
 * mutation of the real one, RUNS it (`stalwartStepFaults`), each way to keep
 * the text and lose the refusal being a mutation that must fail it, and holds
 * the row that says when a newer release is tagged.
 */
describe('the stalwart-cli CI installs: a named release, checked by its sha256 first, the same in every workflow', () => {
  // e2e.yml's copy, which the mutations below can reach: ci.yml's Atlas step comes first and reads alike.
  const ci = REAL.read('.github/workflows/e2e.yml')!;
  /** e2e.yml with one change, which must be a change. */
  const mutate = (from: string | RegExp, to: string): string => {
    const next = ci.replace(from, to);
    expect(next, `${String(from)} is not in e2e.yml`).not.toBe(ci);
    return next;
  };

  it('names a release and a sha256 for each architecture, and every workflow that installs it carries the same step', () => {
    expect(STALWART_CLI.version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(STALWART_CLI.sha256.amd64).toMatch(/^[0-9a-f]{64}$/);
    expect(STALWART_CLI.sha256.arm64).toMatch(/^[0-9a-f]{64}$/);
    const reference = stalwartStep(REAL.read('.github/workflows/ci.yml')!);
    // Every workflow that names stalwart-cli in its code installs it by this step, and none is missing from the row.
    const installing = WORKFLOWS.filter((file) => REAL.read(file)!.split('\n').some((l) => !/^\s*#/.test(l) && /stalwartlabs\/cli\b/.test(l)));
    expect(installing.sort()).toEqual([...STALWART_CLI_FILES].sort());
    for (const file of STALWART_CLI_FILES) {
      expect(stalwartCliPin(REAL.read(file)!), file).toEqual({ ...STALWART_CLI, line: expect.any(Number) });
      expect(stalwartStep(REAL.read(file)!), file).toEqual(reference);
    }
  });

  it('refuses the installer, `releases/latest`, a version that is no release, a missing or shared sum, and no version check', () => {
    const installer = "curl --proto '=https' --tlsv1.2 -LsSf https://github.com/stalwartlabs/cli/releases/latest/download/stalwart-cli-installer.sh | sh";
    expect(() => stalwartCliPin(mutate(/\n( +)set -euo pipefail\n( +)case "\$\(uname -m\)"/, `\n$1${installer}\n$1set -euo pipefail\n$2case "$(uname -m)"`))).toThrow(
      /from its newest release or by its installer/,
    );
    expect(() => stalwartCliPin(mutate('/download/${STALWART_CLI_VERSION}/', '/latest/download/'))).toThrow(/newest release or by its installer|no version/);
    expect(() => stalwartCliPin(mutate('/download/${STALWART_CLI_VERSION}/', '/download/v1.0.14/'))).toThrow(/downloads a name with no version/);
    expect(() => stalwartCliPin(mutate(/STALWART_CLI_VERSION: v\d+\.\d+\.\d+/, 'STALWART_CLI_VERSION: latest'))).toThrow(/names no release/);
    expect(() => stalwartCliPin(mutate(/\n +STALWART_CLI_SHA256_ARM64: [0-9a-f]{64}/, ''))).toThrow(/no sha256 for linux\/aarch64/);
    expect(() =>
      stalwartCliPin(mutate(`STALWART_CLI_SHA256_ARM64: ${STALWART_CLI.sha256.arm64}`, `STALWART_CLI_SHA256_ARM64: ${STALWART_CLI.sha256.amd64}`)),
    ).toThrow(/one sha256 for two architectures/);
    expect(() => stalwartCliPin(mutate('"stalwart-cli ${STALWART_CLI_VERSION#v}"', '"stalwart-cli"'))).toThrow(/calls itself the release named/);
    expect(() => stalwartCliPin(mutate(/\n +seen="\$\(sha256sum "\$download"\)"/, ''))).toThrow(/never reads a sha256/);
  });

  it('refuses a comparison with anything but the pinned sum, a fetch from elsewhere or into another file, a pipe to a shell, and another file unpacked or installed', () => {
    expect(() => stalwartCliPin(mutate('if [ "$seen" = "$pinned" ]; then', 'if true; then'))).toThrow(/never compares the sum it read/);
    expect(() => stalwartCliPin(mutate('pinned="$STALWART_CLI_SHA256_ARM64"', 'pinned="$(cat "$RUNNER_TEMP/arm64.sha256")"'))).toThrow(/pinned sum is not only/);
    expect(() =>
      stalwartCliPin(mutate('pinned="$STALWART_CLI_SHA256_AMD64"', 'pinned="$(curl -sSfL https://example.org/stalwart-cli.sha256)"')),
    ).toThrow(/fetches from somewhere other than/);
    const install = /\n( +)install -m 0755 "\$unpacked\/stalwart-cli"/;
    expect(() => stalwartCliPin(mutate(install, '\n$1curl -sSfL -o "$RUNNER_TEMP/x" "$MIRROR"\n$1install -m 0755 "$unpacked/stalwart-cli"'))).toThrow(
      /fetches something that is not the release/,
    );
    expect(() => stalwartCliPin(mutate(install, '\n$1install -m 0755 "$RUNNER_TEMP/stalwart-cli-bin/other"'))).toThrow(/makes executable something other than/);
    expect(() => stalwartCliPin(mutate('-$native-unknown-linux-gnu.tar.xz" -C', '-x86_64-unknown-linux-gnu.tar.xz" -C'))).toThrow(
      /unpacks something other than the archive it hashed/,
    );
    expect(() => stalwartCliPin(mutate(/\n( +)\[ "\$refused" = 0 \] \|\| exit 1/, '\n$1curl -sSfL "${STUFF}" | sh'))).toThrow(/pipes something to a shell/);
    // Unpacked before the loop that reads the sums.
    const tar = /\n( +tar -xJf [^\n]+\n +--no-same-owner[^\n]+)/.exec(ci)![1]!;
    const early = mutate(`\n${tar}`, '').replace(/\n( +)refused=0\n/, (all) => `\n${tar}${all}`);
    expect(() => stalwartCliPin(early)).toThrow(/before its sha256 is read/);
    expect(() => stalwartCliPin(mutate(/\n +\[ "\$refused" = 0 \] \|\| exit 1/, ''))).toThrow(/before its sha256 is read/);
  });

  it('runs: the native release when both sums are the pinned ones, after a blip, and nothing when either is not, it calls itself another version, or the download is down', () => {
    expect(stalwartStepFaults(ci)).toEqual([]);
  });

  it('runs: a mismatch that no longer stops it, or a version check that no longer fails, fails it, each by a mutation of the real step', () => {
    const faults = (from: string | RegExp, to: string): string => stalwartStepFaults(mutate(from, to)).join('\n');
    expect(faults(/\n +refused=1\n/, '\n')).toMatch(/goes on past a wrong STALWART_CLI_SHA256_AMD64 on x86_64/);
    expect(faults('if [ "$seen" = "$pinned" ]', 'if [ "$seen" = "$seen" ]')).toMatch(/goes on past a wrong STALWART_CLI_SHA256_ARM64 on aarch64/);
    expect(faults(/\n +\[ "\$refused" = 0 \] \|\| exit 1/, '')).toMatch(/goes on past a wrong STALWART_CLI_SHA256_ARM64 on x86_64/);
    expect(
      faults('pinned="$STALWART_CLI_SHA256_AMD64"; else pinned="$STALWART_CLI_SHA256_ARM64"', 'pinned="$STALWART_CLI_SHA256_ARM64"; else pinned="$STALWART_CLI_SHA256_AMD64"'),
    ).toMatch(/installs no release on x86_64/);
    expect(faults(/if \[ "\$said" != /, 'if false && [ "$said" != ')).toMatch(/accepts a binary that calls itself stalwart-cli 1\.0\.99 on x86_64/);
    expect(faults(/(does not call itself \$\{STALWART_CLI_VERSION#v\}\."\n) +exit 1\n/, '$1')).toMatch(/accepts a binary that calls itself stalwart-cli 1\.0\.99 on aarch64/);
    expect(faults('-$native-unknown-linux-gnu.tar.xz" -C', '-x86_64-unknown-linux-gnu.tar.xz" -C')).toMatch(/installs no release on aarch64/);
    // The retry: none at all, the three attempts it had until 2026-11-08, one that waits for
    // nothing between attempts, or the 5s, 15s, 25s and 35s the old arithmetic would give.
    expect(faults('for attempt in 1 2 3 4 5; do', 'for attempt in 1; do')).toMatch(/does not ride out four failed fetches/);
    expect(faults('for attempt in 1 2 3 4 5; do', 'for attempt in 1 2 3; do')).toMatch(/does not ride out four failed fetches/);
    expect(faults(/\n +sleep \$\(\(5 \* 3 \*\* \(attempt - 1\)\)\)\n/, '\n')).toMatch(/does not ride out four failed fetches: exit 0, slept never/);
    expect(faults('sleep $((5 * 3 ** (attempt - 1)))', 'sleep $((attempt * 10 - 5))')).toMatch(/does not ride out four failed fetches: exit 0, slept 5 15 25 35/);
    // The kept copy: never kept, never used, used without its hash read, or left in place once refused.
    expect(faults('{ mkdir -p "${kept%/*}" && cp "$download" "$kept.$$" && mv -f "$kept.$$" "$kept"; } ||', 'false ||')).toMatch(/keeps no copy of both archives/);
    expect(faults('if [ -f "$kept" ] && cp "$kept" "$download"; then', 'if false; then')).toMatch(/fetches again, or installs nothing, with both archives kept/);
    expect(faults('from="the copy an earlier run kept"', 'from="the copy an earlier run kept"; continue')).toMatch(/goes on past, or keeps, a kept copy that is not the pinned build/);
    expect(faults('rm -f "$kept" || true', 'true')).toMatch(/goes on past, or keeps, a kept copy that is not the pinned build: exit 1, installed false, kept true/);
  });

  it('is a routine pin, current while upstream tags no newer release of its major', async () => {
    const { rows } = await routineRows(REAL, fakeNet(registry()));
    expect(rows.find((r) => r.name === 'stalwart-cli')).toEqual({
      name: 'stalwart-cli',
      where: STALWART_CLI_FILES.join(', '),
      pin: STALWART_CLI.version,
      newest: STALWART_CLI.version,
      state: 'current',
    });
  });

  it('is behind when a newer release is tagged, says the three values move together, and holds the copies together', async () => {
    const newer = STALWART_CLI.version.replace(/(\d+)$/, (patch) => String(Number(patch) + 9));
    const { rows, status } = await routineRows(REAL, fakeNet(registry({ stalwartCli: newer })));
    expect(rows.find((r) => r.name === 'stalwart-cli')).toMatchObject({ pin: STALWART_CLI.version, newest: newer, state: 'behind', notes: [STALWART_CLI_NOTE] });
    expect(summaryOf(rows, status).body).toContain(`- \`stalwart-cli\` (${STALWART_CLI_FILES.join(', ')}): ${STALWART_CLI.version}, newest **${newer}**; ${STALWART_CLI_NOTE}`);
    const older = withFiles({ '.github/workflows/e2e.yml': REAL.read('.github/workflows/e2e.yml')!.replace(`STALWART_CLI_VERSION: ${STALWART_CLI.version}`, 'STALWART_CLI_VERSION: v1.0.10') });
    const row = (await routineRows(older, fakeNet(registry()))).rows.find((r) => r.name === 'stalwart-cli');
    expect(row).toMatchObject({ pin: `v1.0.10 / ${STALWART_CLI.version}`, state: 'behind' });
    expect(row?.notes).toContain('the copies disagree');
  });

  it('is never current when a step cannot be read', async () => {
    const latest = withFiles({ '.github/workflows/e2e-managed.yml': REAL.read('.github/workflows/e2e-managed.yml')!.replace('/download/${STALWART_CLI_VERSION}/', '/latest/download/') });
    const row = (await routineRows(latest, fakeNet(registry()))).rows.find((r) => r.name === 'stalwart-cli');
    expect(row).toMatchObject({ state: 'error' });
  });

  it("names the workflows' release in every install hint a developer reads, by that release's own installer", () => {
    expect(STALWART_CLI_HINTS.length).toBe(3);
    expect(stalwartCliHintFaults(REAL, STALWART_CLI.version)).toEqual([]);
    // Every tracked file that names the installer is one of them; the workflows, which name
    // it only in a comment on what they replaced, the records, and this watch are not hints.
    const told = spawnSync('git', ['grep', '-l', '-F', 'stalwart-cli-installer.sh', '--', '.', ':!.github/workflows', ':!docs/workplans', ':!scripts', ':!CHANGELOG.md'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(told.status, told.stderr).toBe(0);
    expect(told.stdout.split('\n').filter(Boolean).sort()).toEqual([...STALWART_CLI_HINTS].sort());
  });

  it('refuses a hint left on `releases/latest`, on another release, or with no release at all, each by a mutation of the real file', () => {
    const hint = (file: string, from: string | RegExp, to: string): string[] => {
      const real = REAL.read(file)!;
      const next = real.replace(from, to);
      expect(next, `${String(from)} is not in ${file}`).not.toBe(real);
      return stalwartCliHintFaults(withFiles({ [file]: next }), STALWART_CLI.version);
    };
    const pinned = `/releases/download/${STALWART_CLI.version}/`;
    expect(hint('deploy/selfhost/setup-stalwart.sh', pinned, '/releases/latest/download/').join('\n')).toMatch(/setup-stalwart\.sh installs .*releases\/latest\/download/);
    expect(hint('packages/testing/src/testcontainers-setup.ts', pinned, '/releases/download/v1.0.13/').join('\n')).toMatch(/testcontainers-setup\.ts installs .*v1\.0\.13/);
    expect(hint('docs/stalwart-integration-fix.md', /\n +https:\/\/github\.com\/stalwartlabs\/cli\/[^\n]+/, '')).toEqual(['docs/stalwart-integration-fix.md names no stalwart-cli release to install']);
    // A workflow moved alone leaves every hint behind it.
    expect(stalwartCliHintFaults(REAL, 'v1.0.99')).toHaveLength(3);
  });
});

/**
 * THE TRIVY THE SECURITY SCAN TOOK FROM get.trivy.dev (workplan 0146,
 * 2026-11-04). trivy-action's setup-trivy ran Trivy's `contrib/install.sh`,
 * which takes the archive from `get.trivy.dev`; that name stopped resolving
 * on 2026-11-04 and main's push scan on the alpha.4 candidate failed before
 * it read a file. The repository scan and every image leg now carry one
 * step, word for word, that names a release, pins a sha256 for both
 * architectures, reads and compares both before anything is unpacked, and
 * checks that what it installed calls itself that release; and each job's
 * trivy-action steps skip setup-trivy and name the same release. This holds
 * both jobs to that with `trivyPin`, each refusal by a mutation of the real
 * file, RUNS the step (`trivyStepFaults`) as the stalwart-cli step is run
 * above, and holds the row that says when a newer release is tagged.
 */
const TRIVY = trivyPin(REAL.read(TRIVY_WORKFLOW)!, 'security-scan');
/** `uname -m` on each runner, and the release's name for that architecture. */
const TRIVY_MACHINES: Record<string, string> = { x86_64: TRIVY_ARCHES.AMD64, aarch64: TRIVY_ARCHES.ARM64 };
/** A stand-in archive per architecture, shaped like the release's (`trivy` beside a README), whose binary prints what it is told and a database line. */
const TRIVY_STAND_IN = Object.fromEntries(
  Object.values(TRIVY_ARCHES).map((arch) => {
    const dir = mkdtempSync(join(atlasScratch, `trivy-${arch}-`));
    writeFileSync(join(dir, 'README.md'), `Not Trivy: the Linux-${arch} stand-in a-pin-that-knows-it-is-behind serves.\n`);
    writeFileSync(join(dir, 'trivy'), `#!/bin/sh\n# Linux-${arch}\n: > "$STUB_RAN"\nprintf '%s\\n' "$STUB_SAYS" 'Vulnerability DB:' '  Version: 2'\n`);
    chmodSync(join(dir, 'trivy'), 0o755);
    const made = spawnSync('tar', ['-czf', join(dir, 'archive.tar.gz'), '-C', dir, 'README.md', 'trivy'], { encoding: 'utf8' });
    if (made.status !== 0) throw new Error(`tar could not make the stand-in archive: ${made.stderr}`);
    const bytes = readFileSync(join(dir, 'archive.tar.gz'));
    return [arch, { bytes, binary: readFileSync(join(dir, 'trivy'), 'utf8'), sha256: createHash('sha256').update(bytes).digest('hex') }];
  }),
) as Record<string, { bytes: Buffer; binary: string; sha256: string }>;
const TRIVY_STAND_IN_SHA256 = Object.fromEntries(
  Object.entries(TRIVY_ARCHES).map(([name, arch]) => [`INSTALL_TRIVY_SHA256_${name}`, TRIVY_STAND_IN[arch]!.sha256]),
);

/** The `run:` and `env:` of the one step of `job` in `workflow` that downloads from TRIVY_HOST. */
function trivyStep(workflow: string, job: string): { run: string; env: Record<string, string> } {
  type Step = { run?: unknown; env?: Record<string, unknown>; shell?: unknown };
  const jobs = (parseYaml(workflow) as { jobs?: Record<string, { steps?: Step[] }> }).jobs ?? {};
  const steps = (jobs[job]?.steps ?? []).filter((s) => typeof s.run === 'string' && s.run.includes(TRIVY_HOST));
  if (steps.length !== 1) throw new Error(`${steps.length} steps of job ${job} download from ${TRIVY_HOST}; one installs Trivy`);
  const step = steps[0]!;
  if (step.shell !== undefined) throw new Error(`the Trivy step names shell: ${String(step.shell)}; this runs it as a step with none`);
  if ((step.run as string).includes('${{')) throw new Error('the Trivy step carries a ${{ }} expression, which this does not render');
  return { run: step.run as string, env: Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, String(v)])) };
}

/** Run the Trivy step on `machine`, with these sums, a stand-in whose first line is `says`, and the first `fails` fetches failing. */
function runTrivyStep(step: { run: string; env: Record<string, string> }, machine: string, sums: Record<string, string>, says: string, fails = 0): Ran & { slept: string[] } {
  const dir = mkdtempSync(join(atlasScratch, 'trivy-run-'));
  const temp = join(dir, 'runner-temp');
  const served = join(dir, 'served');
  mkdirSync(temp);
  mkdirSync(served);
  const version = step.env.INSTALL_TRIVY_VERSION ?? '';
  for (const arch of Object.values(TRIVY_ARCHES)) writeFileSync(join(served, `trivy_${version.replace(/^v/, '')}_Linux-${arch}.tar.gz`), TRIVY_STAND_IN[arch]!.bytes);
  const files = { script: join(dir, 'step.sh'), path: join(dir, 'GITHUB_PATH'), ran: join(dir, 'ran'), fetched: join(dir, 'fetched'), slept: join(dir, 'slept') };
  writeFileSync(files.script, step.run);
  for (const file of [files.path, files.fetched, files.slept]) writeFileSync(file, '');
  const r = spawnSync('bash', ['-e', files.script], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      PATH: `${STUBS}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: dir,
      ...step.env,
      ...sums,
      RUNNER_TEMP: temp,
      GITHUB_PATH: files.path,
      STUB_PREFIX: `${TRIVY_HOST}${version}/`,
      STUB_SERVED: served,
      STUB_MACHINE: machine,
      STUB_SAYS: says,
      STUB_RAN: files.ran,
      STUB_FETCHED: files.fetched,
      STUB_SLEPT: files.slept,
      ...(fails ? { STUB_FAILS: String(fails) } : {}),
    },
  });
  const bin = join(temp, 'trivy-bin', 'trivy');
  return {
    status: r.status,
    installed: existsSync(bin) ? readFileSync(bin, 'utf8') : undefined,
    ran: existsSync(files.ran),
    onPath: readFileSync(files.path, 'utf8').split('\n').includes(join(temp, 'trivy-bin')),
    fetched: readFileSync(files.fetched, 'utf8').split('\n').filter(Boolean),
    slept: readFileSync(files.slept, 'utf8').split('\n').filter(Boolean),
    log: `${r.stdout}${r.stderr}`.trim(),
  };
}

/**
 * What the Trivy step of `job` does that it must not, run on both machines,
 * as `stalwartStepFaults` reads the stalwart-cli step: install and run
 * anything but the native release when both archives are the pinned ones (and
 * fetch both); finish with anything installed, run or on the PATH when either
 * sum is wrong, also for an archive that came only after four failed fetches;
 * accept a binary that calls itself another version; give up before four
 * failed fetches have been waited out, 5, 15, 45 and 135 seconds apart
 * (2026-11-09: GitHub's release download answered 504 to all three fetches in
 * both attempts of a pull request's scan, run 42580533989), or go on after
 * five; or install anything on a machine no release is pinned for. Empty when
 * the step is right.
 */
function trivyStepFaults(workflow: string, job: string): string[] {
  const step = trivyStep(workflow, job);
  const version = step.env.INSTALL_TRIVY_VERSION ?? '';
  const release = `Version: ${version.replace(/^v/, '')}`;
  const urls = Object.values(TRIVY_ARCHES).map((arch) => `${TRIVY_HOST}${version}/trivy_${version.replace(/^v/, '')}_Linux-${arch}.tar.gz`);
  const names = Object.keys(TRIVY_ARCHES).map((name) => `INSTALL_TRIVY_SHA256_${name}`);
  const faults: string[] = [];
  for (const [machine, arch] of Object.entries(TRIVY_MACHINES)) {
    const ok = runTrivyStep(step, machine, TRIVY_STAND_IN_SHA256, release);
    if (!(ok.status === 0 && ok.installed === TRIVY_STAND_IN[arch]!.binary && ok.ran && ok.onPath && ok.fetched.join(' ') === urls.join(' '))) {
      faults.push(`installs no release on ${machine}: exit ${ok.status}, fetched ${ok.fetched.join(' ') || 'nothing'}\n${ok.log}`);
    }
    for (const wrong of [...names.map((n) => [n]), names]) {
      // A wrong sum is the pin the workflow commits: the stand-in is not those bytes.
      const sums = { ...TRIVY_STAND_IN_SHA256, ...Object.fromEntries(wrong.map((name) => [name, step.env[name] ?? ''])) };
      const r = runTrivyStep(step, machine, sums, release);
      if (r.status === 0 || r.installed !== undefined || r.ran || r.onPath) {
        faults.push(`goes on past a wrong ${wrong.join(' and ')} on ${machine}: exit ${r.status}, installed ${r.installed !== undefined}, ran ${r.ran}\n${r.log}`);
      }
    }
    const other = runTrivyStep(step, machine, TRIVY_STAND_IN_SHA256, 'Version: 0.76.99');
    if (other.status === 0) faults.push(`accepts a binary that calls itself Version: 0.76.99 on ${machine}\n${other.log}`);
  }
  // Four failed fetches in a row are waited out, 5, 15, 45 and 135 seconds apart, and the archive the
  // fifth fetch brings is held to its pinned sum as a first one is; five in a row stop the step with
  // nothing installed.
  const blip = runTrivyStep(step, 'x86_64', TRIVY_STAND_IN_SHA256, release, 4);
  if (!(blip.status === 0 && blip.ran && blip.slept.join(' ') === '5 15 45 135')) faults.push(`does not ride out four failed fetches: exit ${blip.status}, slept ${blip.slept.join(' ') || 'never'}\n${blip.log}`);
  const late = runTrivyStep(step, 'x86_64', { ...TRIVY_STAND_IN_SHA256, INSTALL_TRIVY_SHA256_AMD64: step.env.INSTALL_TRIVY_SHA256_AMD64 ?? '' }, release, 4);
  if (late.status === 0 || late.installed !== undefined || late.ran || late.onPath) {
    faults.push(`goes on past a wrong INSTALL_TRIVY_SHA256_AMD64 fetched after four failed fetches: exit ${late.status}, installed ${late.installed !== undefined}, ran ${late.ran}\n${late.log}`);
  }
  const outage = runTrivyStep(step, 'x86_64', TRIVY_STAND_IN_SHA256, release, 5);
  if (outage.status === 0 || outage.installed !== undefined || outage.ran) {
    faults.push(`goes on after five failed fetches: exit ${outage.status}, fetched ${outage.fetched.length} times\n${outage.log}`);
  } else if (outage.fetched.length !== 5) {
    faults.push(`stops after fetch ${outage.fetched.length}, not the fifth: exit ${outage.status}\n${outage.log}`);
  }
  const riscv = runTrivyStep(step, 'riscv64', TRIVY_STAND_IN_SHA256, release);
  if (riscv.status === 0 || riscv.installed !== undefined) faults.push(`installs something on riscv64, which no release is pinned for: exit ${riscv.status}`);
  return faults;
}

describe('the Trivy the Security Scan runs: a named release from GitHub, checked by its sha256 first, the same in both jobs', () => {
  const real = REAL.read(TRIVY_WORKFLOW)!;
  /** The workflow with one change in the repository scan's job (the first copy), which must be a change. */
  const mutate = (from: string | RegExp, to: string): string => {
    const next = real.replace(from, to);
    expect(next, `${String(from)} is not in ${TRIVY_WORKFLOW}`).not.toBe(real);
    return next;
  };
  /** The workflow with one change in the image legs' job only. */
  const mutateImage = (from: string | RegExp, to: string): string => {
    const at = real.indexOf('\n  image-scan:\n');
    expect(at).toBeGreaterThan(0);
    const tail = real.slice(at).replace(from, to);
    expect(tail, `${String(from)} is not in job image-scan`).not.toBe(real.slice(at));
    return real.slice(0, at) + tail;
  };

  it('names a release and a sha256 for each architecture, in both jobs alike, and no other job or workflow runs Trivy', () => {
    expect(TRIVY.version).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(TRIVY.sha256.amd64).toMatch(/^[0-9a-f]{64}$/);
    expect(TRIVY.sha256.arm64).toMatch(/^[0-9a-f]{64}$/);
    const reference = trivyStep(real, 'security-scan');
    for (const job of TRIVY_JOBS) {
      expect(trivyPin(real, job), job).toEqual({ ...TRIVY, line: expect.any(Number) });
      expect(trivyStep(real, job), job).toEqual(reference);
    }
    type Step = { uses?: unknown };
    const jobs = (parseYaml(real) as { jobs: Record<string, { steps?: Step[] }> }).jobs;
    const running = Object.entries(jobs)
      .filter(([, job]) => (job.steps ?? []).some((s) => typeof s.uses === 'string' && /^aquasecurity\/(?:trivy-action|setup-trivy)@/.test(s.uses)))
      .map(([name]) => name);
    expect(running.sort()).toEqual([...TRIVY_JOBS].sort());
    const elsewhere = WORKFLOWS.filter((file) => file !== TRIVY_WORKFLOW && REAL.read(file)!.split('\n').some((l) => !/^\s*#/.test(l) && /aquasecurity\/(?:trivy-action|setup-trivy)@/.test(l)));
    expect(elsewhere).toEqual([]);
  });

  it('refuses get.trivy.dev, a name with no version, a version that is no release, a missing or shared sum, and no version check', () => {
    expect(() => trivyPin(mutate(/\n( +)set -euo pipefail\n( +)case "\$\(uname -m\)"/, '\n$1curl -sSfL "https://get.trivy.dev/trivy?os=Linux" -o x\n$1set -euo pipefail\n$2case "$(uname -m)"'), 'security-scan')).toThrow(
      /from get\.trivy\.dev or by its install script/,
    );
    expect(() => trivyPin(mutate('/download/${INSTALL_TRIVY_VERSION}/', '/download/v0.76.1/'), 'security-scan')).toThrow(/downloads a name with no version/);
    expect(() => trivyPin(mutate(/INSTALL_TRIVY_VERSION: v\d+\.\d+\.\d+/, 'INSTALL_TRIVY_VERSION: latest'), 'security-scan')).toThrow(/names no release/);
    expect(() => trivyPin(mutate(/\n +INSTALL_TRIVY_SHA256_ARM64: [0-9a-f]{64}/, ''), 'security-scan')).toThrow(/no sha256 for Linux-ARM64/);
    expect(() => trivyPin(mutate(`INSTALL_TRIVY_SHA256_ARM64: ${TRIVY.sha256.arm64}`, `INSTALL_TRIVY_SHA256_ARM64: ${TRIVY.sha256.amd64}`), 'security-scan')).toThrow(
      /one sha256 for two architectures/,
    );
    expect(() => trivyPin(mutate('"Version: ${INSTALL_TRIVY_VERSION#v}"', '"Version:"'), 'security-scan')).toThrow(/calls itself the release named/);
    expect(() => trivyPin(mutate(/\n +seen="\$\(sha256sum "\$download"\)"/, ''), 'security-scan')).toThrow(/never reads a sha256/);
  });

  it('refuses a comparison with anything but the pinned sum, a fetch from elsewhere or into another file, a pipe to a shell, and another file unpacked or installed', () => {
    expect(() => trivyPin(mutate('if [ "$seen" = "$pinned" ]; then', 'if true; then'), 'security-scan')).toThrow(/never compares the sum it read/);
    expect(() => trivyPin(mutate('pinned="$INSTALL_TRIVY_SHA256_ARM64"', 'pinned="$(cat "$RUNNER_TEMP/arm64.sha256")"'), 'security-scan')).toThrow(/pinned sum is not only/);
    expect(() => trivyPin(mutate('pinned="$INSTALL_TRIVY_SHA256_AMD64"', 'pinned="$(curl -sSfL https://example.org/trivy.sha256)"'), 'security-scan')).toThrow(
      /fetches from somewhere other than/,
    );
    const install = /\n( +)install -m 0755 "\$unpacked\/trivy"/;
    expect(() => trivyPin(mutate(install, '\n$1curl -sSfL -o "$RUNNER_TEMP/x" "$MIRROR"\n$1install -m 0755 "$unpacked/trivy"'), 'security-scan')).toThrow(
      /fetches something that is not the release/,
    );
    expect(() => trivyPin(mutate(install, '\n$1install -m 0755 "$RUNNER_TEMP/trivy-bin/other"'), 'security-scan')).toThrow(/makes executable something other than/);
    expect(() => trivyPin(mutate('_Linux-$native.tar.gz" -C', '_Linux-64bit.tar.gz" -C'), 'security-scan')).toThrow(/unpacks something other than the archive it hashed/);
    expect(() => trivyPin(mutate(/\n( +)\[ "\$refused" = 0 \] \|\| exit 1/, '\n$1curl -sSfL "${STUFF}" | sh'), 'security-scan')).toThrow(/pipes something to a shell/);
    // Unpacked before the loop that reads the sums.
    const tar = /\n( +tar -xzf [^\n]+)/.exec(real)![1]!;
    const early = mutate(`\n${tar}`, '').replace(/\n( +)refused=0\n/, (all) => `\n${tar}${all}`);
    expect(() => trivyPin(early, 'security-scan')).toThrow(/before its sha256 is read/);
    expect(() => trivyPin(mutate(/\n +\[ "\$refused" = 0 \] \|\| exit 1/, ''), 'security-scan')).toThrow(/before its sha256 is read/);
  });

  it("refuses a job whose trivy-action installs its own Trivy, names another release, or runs before the install, in either job", () => {
    const skip = /\n +skip-setup-trivy: true\n/;
    expect(() => trivyPin(mutate(skip, '\n'), 'security-scan')).toThrow(/without skip-setup-trivy: true/);
    expect(() => trivyPin(mutateImage(skip, '\n'), 'image-scan')).toThrow(/without skip-setup-trivy: true/);
    expect(() => trivyPin(mutateImage(/\n( +)skip-setup-trivy: true\n/, '\n$1skip-setup-trivy: false\n'), 'image-scan')).toThrow(/without skip-setup-trivy: true/);
    // Read from the pin, so a move of the release moves these mutations with it.
    const pinned = TRIVY.version.replace(/\./g, '\\.');
    expect(() => trivyPin(mutateImage(new RegExp(`\\n( +)version: ${pinned}\\n`), '\n$1version: v0.0.1\n'), 'image-scan')).toThrow(
      new RegExp(`with version: v0\\.0\\.1, and installs ${pinned}`),
    );
    const early = mutate(
      /\n( +)- name: Install Trivy from its GitHub release/,
      `\n$1- name: Too early\n$1  uses: aquasecurity/trivy-action@${'e'.repeat(40)} # v0.36.0\n$1  with:\n$1    version: ${TRIVY.version}\n$1    skip-setup-trivy: true\n$1- name: Install Trivy from its GitHub release`,
    );
    expect(() => trivyPin(early, 'security-scan')).toThrow(/before the step that installs Trivy/);
    // The other job is read on its own: a mutation in one leaves the other's reading as it was.
    expect(trivyPin(mutateImage(skip, '\n'), 'security-scan')).toEqual(TRIVY);
  });

  it('runs: the native release when both sums are the pinned ones, after a blip, and nothing when either is not, it calls itself another version, or the download is down', () => {
    for (const job of TRIVY_JOBS) expect(trivyStepFaults(real, job), job).toEqual([]);
  });

  it('runs: a mismatch that no longer stops it, or a version check that no longer fails, fails it, each by a mutation of the real step', () => {
    const faults = (from: string | RegExp, to: string): string => trivyStepFaults(mutate(from, to), 'security-scan').join('\n');
    expect(faults(/\n +refused=1\n/, '\n')).toMatch(/goes on past a wrong INSTALL_TRIVY_SHA256_AMD64 on x86_64/);
    expect(faults('if [ "$seen" = "$pinned" ]', 'if [ "$seen" = "$seen" ]')).toMatch(/goes on past a wrong INSTALL_TRIVY_SHA256_ARM64 on aarch64/);
    expect(faults(/\n +\[ "\$refused" = 0 \] \|\| exit 1/, '')).toMatch(/goes on past a wrong INSTALL_TRIVY_SHA256_ARM64 on x86_64/);
    expect(
      faults('pinned="$INSTALL_TRIVY_SHA256_AMD64"; else pinned="$INSTALL_TRIVY_SHA256_ARM64"', 'pinned="$INSTALL_TRIVY_SHA256_ARM64"; else pinned="$INSTALL_TRIVY_SHA256_AMD64"'),
    ).toMatch(/installs no release on x86_64/);
    expect(faults(/if \[ "\$\{said%%/, 'if false && [ "${said%%')).toMatch(/accepts a binary that calls itself Version: 0\.76\.99 on x86_64/);
    expect(faults(/(does not call itself \$\{INSTALL_TRIVY_VERSION#v\}\."\n) +exit 1\n/, '$1')).toMatch(/accepts a binary that calls itself Version: 0\.76\.99 on aarch64/);
    // The whole of what it says, not its first line: Trivy goes on to name its database.
    expect(faults('"${said%%$\'\\n\'*}"', '"$said"')).toMatch(/installs no release on x86_64/);
    expect(faults('_Linux-$native.tar.gz" -C', '_Linux-64bit.tar.gz" -C')).toMatch(/installs no release on aarch64/);
    // The retry: none at all, the three attempts it had until 2026-11-09, four, a give-up at the
    // third, one that waits for nothing between attempts, or the 5s, 15s, 25s and 35s the old
    // arithmetic would give; a sixth attempt; and an archive that came after the waits let through
    // unhashed, which the runs without a failed fetch never see.
    expect(faults('for attempt in 1 2 3 4 5; do', 'for attempt in 1; do')).toMatch(/does not ride out four failed fetches: exit 1, slept 5\n/);
    expect(faults('for attempt in 1 2 3 4 5; do', 'for attempt in 1 2 3; do')).toMatch(/does not ride out four failed fetches: exit 1, slept 5 15 45\n/);
    expect(faults('for attempt in 1 2 3 4 5; do', 'for attempt in 1 2 3 4; do')).toMatch(/stops after fetch 4, not the fifth: exit 1/);
    expect(faults('if [ "$attempt" = 5 ]; then', 'if [ "$attempt" = 3 ]; then')).toMatch(/does not ride out four failed fetches: exit 1, slept 5 15\n/);
    expect(faults(/\n +sleep \$\(\(5 \* 3 \*\* \(attempt - 1\)\)\)\n/, '\n')).toMatch(/does not ride out four failed fetches: exit 0, slept never/);
    expect(faults('sleep $((5 * 3 ** (attempt - 1)))', 'sleep $((attempt * 10 - 5))')).toMatch(/does not ride out four failed fetches: exit 0, slept 5 15 25 35/);
    expect(faults(/for attempt in 1 2 3 4 5; do\n([\s\S]*?)"\$attempt" = 5/, 'for attempt in 1 2 3 4 5 6; do\n$1"$attempt" = 6')).toMatch(/goes on after five failed fetches: exit 0/);
    expect(faults(/(_Linux-\$\{arch\}\.tar\.gz"; then\n)( +)break\n/, '$1$2[ "$attempt" = 1 ] || continue 2\n$2break\n')).toMatch(
      /goes on past a wrong INSTALL_TRIVY_SHA256_AMD64 fetched after four failed fetches: exit 0/,
    );
  });

  it('is a routine pin, current while upstream tags no newer release of its major', async () => {
    const { rows } = await routineRows(REAL, fakeNet(registry()));
    expect(rows.find((r) => r.name === 'Trivy')).toEqual({ name: 'Trivy', where: TRIVY_WORKFLOW, pin: TRIVY.version, newest: TRIVY.version, state: 'current' });
  });

  it('is behind when a newer release is tagged, says the values move together, and holds the copies together', async () => {
    const { rows } = await routineRows(REAL, fakeNet(registry({ trivy: 'v0.99.0' })));
    expect(rows.find((r) => r.name === 'Trivy')).toMatchObject({ pin: TRIVY.version, newest: 'v0.99.0', state: 'behind', notes: [TRIVY_NOTE] });
    const apart = withFiles({ [TRIVY_WORKFLOW]: mutateImage(`INSTALL_TRIVY_SHA256_ARM64: ${TRIVY.sha256.arm64}`, `INSTALL_TRIVY_SHA256_ARM64: ${'a'.repeat(64)}`) });
    const row = (await routineRows(apart, fakeNet(registry()))).rows.find((r) => r.name === 'Trivy');
    expect(row).toMatchObject({ pin: TRIVY.version, state: 'behind' });
    expect(row?.notes).toContain('the copies disagree');
  });

  it('is never current when a step cannot be read', async () => {
    const gone = withFiles({ [TRIVY_WORKFLOW]: mutateImage('https://github.com/aquasecurity/trivy/releases/download/', 'https://get.trivy.dev/trivy/') });
    const row = (await routineRows(gone, fakeNet(registry()))).rows.find((r) => r.name === 'Trivy');
    expect(row).toMatchObject({ state: 'error' });
  });
});

/**
 * WHAT CI FETCHES NAMES ITS RELEASE (workplan 0119, 2026-11-01). Atlas came by
 * its `-latest` name (#1773), stalwart-cli from `releases/latest`, the dev
 * database Atlas lints against from `docker://postgres/18`, and images.yml's
 * build job ran binfmt's `latest` and BuildKit's `buildx-stable-1` through
 * its actions' defaults, in the job that pushes and signs the published
 * images. Each is pinned now. This holds every workflow to it: no code line
 * downloads from `releases/latest` or a URL whose path or file name says
 * `latest` (the Atlas download #1773 replaced passed in any workflow but
 * ci.yml until #1777's review), every `docker://` dev database carries a
 * digest, every `npx` is `--yes=false` (the SBOM step's was `-y`), and every
 * action that runs an image from an input names a release tag and its digest
 * (`actionImages`), which also feeds the two rows that say when the channel
 * moved.
 */
describe('what CI fetches names its release: no `releases/latest`, no floating dev database, no image left to an action', () => {
  it('found the workflows, and none fetches a moving target', () => {
    expect(WORKFLOWS.length).toBeGreaterThan(10);
    expect(WORKFLOWS.flatMap((file) => floatingFetches(REAL.read(file)!).map((f) => `${file}: ${f}`))).toEqual([]);
  });

  it('refuses each of the three it replaced, by a mutation of the real line, and leaves a comment alone', () => {
    const ci = REAL.read('.github/workflows/ci.yml')!;
    const dev = /--dev-url "(docker:\/\/postgres\/[^/"]+\/dev)/.exec(ci)![1]!;
    expect(floatingFetches(ci.replace(dev, 'docker://postgres/18/dev')).join('\n')).toMatch(/image with no digest: docker:\/\/postgres\/18\/dev/);
    expect(floatingFetches(ci.replace(dev, 'docker+postgres://_/postgres:18.6-alpine/dev')).join('\n')).toMatch(/image with no digest/);
    const step = REAL.read('.github/workflows/e2e.yml')!;
    const url = /https:\/\/github\.com\/stalwartlabs\/cli\/releases\/download\/\$\{STALWART_CLI_VERSION\}\//;
    expect(floatingFetches(step.replace(url, 'https://github.com/stalwartlabs/cli/releases/latest/download/')).join('\n')).toMatch(/newest release, whatever it is/);
    const atlas = ci.replace(/atlas-community-linux-\$\{arch\}-\$\{ATLAS_VERSION\}/, 'atlas-community-linux-${arch}-latest');
    expect(atlas).not.toBe(ci);
    expect(() => atlasPin(atlas)).toThrow(/downloads a name with no version/);
    expect(floatingFetches('# from releases/latest until 2026-11-01, see docker://postgres/18/dev\n')).toEqual([]);
  });

  it("refuses a file named `-latest` or under a `latest` path, and an npx that may install, in any workflow, by a mutation of the real one (#1777's review)", () => {
    const file = '.github/workflows/security-scan.yml';
    const scan = REAL.read(file)!;
    // Anchored on the SBOM step's command: an npx there until 2026-11-24, `pnpm sbom` since (workplan 0006 §Q).
    const sbom = /\n( +)if ! pnpm sbom --sbom-format cyclonedx /;
    expect(sbom.test(scan), `the SBOM step's command is not in ${file}`).toBe(true);
    const mutate = (to: string): string => scan.replace(sbom, (all, indent: string) => `\n${indent}${to}${all}`);
    // The download #1773 replaced, word for word, in a workflow atlasPin never reads.
    const atlas = 'curl -sSf -o /tmp/atlas https://atlasbinaries.com/atlas/atlas-community-linux-amd64-latest && chmod +x /tmp/atlas';
    expect(floatingFetches(mutate(atlas)).join('\n')).toMatch(/newest release, whatever it is: curl -sSf -o \/tmp\/atlas https:\/\/atlasbinaries\.com/);
    for (const url of ['https://example.org/tool_latest.tar.gz', 'https://example.org/latest/tool', 'https://example.org/tool-LATEST?arch=amd64']) {
      expect(floatingFetches(mutate(`curl -sSfLO ${url}`)), url).toHaveLength(1);
    }
    // A release whose name only contains the word is not a channel.
    expect(floatingFetches(mutate('curl -sSfLO https://example.org/v1.2.3/latestish-1.2.3.tar.gz'))).toEqual([]);
    // The npx this step ran until 2026-11-24, put back: allowed as it was, refused in each form that may install.
    const npx = (flag: string): string => mutate(`npx ${flag}@cyclonedx/cyclonedx-npm --output-format JSON --output-file bom.json`);
    expect(floatingFetches(npx('--yes=false '))).toEqual([]);
    for (const flag of ['-y ', '', '--yes ']) {
      expect(floatingFetches(npx(flag)).join('\n'), flag).toMatch(/runs npx, which installs from npm/);
    }
  });

  it('reads both action images from images.yml, each by a release tag and its digest, and every other workflow without fault', () => {
    for (const file of WORKFLOWS) expect(() => actionImages(REAL.read(file)!), file).not.toThrow();
    const named = actionImages(REAL.read(ACTION_IMAGES_WORKFLOW)!);
    expect(named.map((i) => [i.action, registryOf(i.repo).name])).toEqual(ACTION_IMAGES.map((s) => [s.action, s.repo]));
    for (const image of named) {
      expect(image.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(image.tag).toMatch(/\d+\.\d+\.\d+/);
    }
  });

  it('refuses an action image left to its default, a channel tag, or a tag with no digest, each by a mutation of images.yml', () => {
    const images = REAL.read(ACTION_IMAGES_WORKFLOW)!;
    const [qemu, buildkit] = actionImages(images);
    const mutate = (from: string | RegExp, to: string): string => {
      const next = images.replace(from, to);
      expect(next, String(from)).not.toBe(images);
      return next;
    };
    expect(() => actionImages(mutate(/\n +with:\n +image: docker\.io\/tonistiigi\/binfmt:\S+/, ''))).toThrow(/names no image in `image`, so it runs its default, `tonistiigi\/binfmt:latest`/);
    expect(() => actionImages(mutate(/\n +with:\n +driver-opts: image=moby\/buildkit:\S+/, ''))).toThrow(/names no image in `driver-opts`, so it runs its default, `moby\/buildkit:buildx-stable-1`/);
    expect(() => actionImages(mutate(qemu!.ref, `docker.io/tonistiigi/binfmt:latest@${qemu!.digest}`))).toThrow(/not a release tag and its digest/);
    expect(() => actionImages(mutate(buildkit!.ref, `moby/buildkit:buildx-stable-1@${buildkit!.digest}`))).toThrow(/not a release tag and its digest/);
    expect(() => actionImages(mutate(buildkit!.ref, `moby/buildkit:${buildkit!.tag}`))).toThrow(/not a release tag and its digest/);
    expect(() => actionImages(mutate(qemu!.ref, `docker.io/tonistiigi/binfmt@${qemu!.digest}`))).toThrow(/not a release tag and its digest/);
    expect(() => actionImages(mutate(buildkit!.ref, `moby/buildkit:v0.34.0-rc1@${buildkit!.digest}`))).toThrow(/not a release tag and its digest/);
    // The docker driver starts no BuildKit container, so it needs no image.
    expect(actionImages(mutate(/driver-opts: image=moby\/buildkit:\S+/, 'driver: docker')).map((i) => i.action)).toEqual(['docker/setup-qemu-action']);
  });

  it("is a routine pin each, current while the channel the action ran names the pinned build, behind when it names another", async () => {
    const named = actionImages(REAL.read(ACTION_IMAGES_WORKFLOW)!);
    const { rows } = await routineRows(REAL, fakeNet(registry()));
    for (const spec of ACTION_IMAGES) {
      const image = named.find((i) => i.action === spec.action)!;
      expect(rows.find((r) => r.name === spec.repo)).toEqual({
        name: spec.repo,
        where: ACTION_IMAGES_WORKFLOW,
        pin: `${image.tag}@${image.digest}`,
        newest: `${spec.channel}@${image.digest}`,
        state: 'current',
      });
    }
    const moved = `sha256:${'7'.repeat(64)}`;
    const after = await routineRows(REAL, fakeNet(registry({ [`moby/buildkit:${ACTION_IMAGES[1]!.channel}`]: moved })));
    const buildkit = after.rows.find((r) => r.name === 'moby/buildkit');
    expect(buildkit).toMatchObject({ newest: `buildx-stable-1@${moved}`, state: 'behind', notes: [channelNote(ACTION_IMAGES[1]!)] });
    expect(after.rows.find((r) => r.name === 'tonistiigi/binfmt')).toMatchObject({ state: 'current' });
    expect(summaryOf(after.rows, after.status).body).toContain(`- \`moby/buildkit\` (${ACTION_IMAGES_WORKFLOW}): `);
  });
});

describe('the whole watch, one issue per row', () => {
  const everything = (): Net => {
    const base = registry();
    return fakeNet({
      ...base,
      lsRemote: { ...base.lsRemote, 'https://github.com/zitadel/zitadel.git': lsRemote(readPin(MANAGED)) },
      npm: (args) => {
        const asked = args.join(' ');
        if (asked === 'view pnpm dist-tags --json') {
          const pin = (JSON.parse(REAL.read('package.json')!) as { packageManager: string }).packageManager.replace(/^pnpm@/, '');
          return JSON.stringify({ [`latest-${pin.split('.')[0]}`]: pin, latest: pin });
        }
        if (asked.startsWith('view typescript-eslint@latest')) return JSON.stringify({ version: '8.0.0', peerDependencies: { typescript: '<6.1.0' } });
        return JSON.stringify(['6.0.3']);
      },
    });
  };

  it('gives each row its own title, the identity provider its old one, and prints a table', async () => {
    const report = await watch(REAL, everything());
    expect(report.issues.map((r) => r.key)).toEqual(['zitadel', 'trigger', 'clickhouse', 'taskNode', 'pnpm', 'typescript', 'routine']);
    expect(new Set(report.issues.map((r) => r.title)).size).toBe(7);
    expect(report.issues[0]!.title).toBe(ISSUE_TITLE);
    const printed = table(report);
    for (const name of ['identity provider', 'Trigger.dev', 'ClickHouse', "the tasks' Node", 'pnpm', 'TypeScript split', 'routine pins, one issue', 'edoburu/pgbouncer', 'Trivy']) {
      expect(printed).toContain(name);
    }
    expect(printed).toMatch(/^ {2}cosign +v\d/m);
  });

  it('keeps going when one row cannot read its upstream, and marks only that one', async () => {
    const net = everything();
    const broken: Net = {
      ...net,
      npm: (args) => {
        if (args.join(' ') === 'view pnpm dist-tags --json') throw new Error('registry.npmjs.org is unreachable');
        return net.npm(args);
      },
    };
    const report = await watch(REAL, broken);
    const state = Object.fromEntries(report.issues.map((r) => [r.key, r.state]));
    expect(Object.keys(state).filter((key) => state[key] === 'error')).toEqual(['pnpm']);
    expect(table(report)).toContain('registry.npmjs.org is unreachable');
    const { gh, calls } = fakeGh([{ number: 3, title: TITLES.pnpm, body: 'x', state: 'open' }]);
    expect(keepIssue(report.issues.find((r) => r.key === 'pnpm')!, gh, TITLES.pnpm)).toBe('untouched');
    expect(calls).toEqual([]);
  });

  it('closes the issue of each row that went with Trigger.dev, once, with a sentence that says why (alpha.18, 0167 T9)', async () => {
    const report = await watch(REAL, everything());
    const removed = report.issues.filter((r) => ['trigger', 'clickhouse', 'taskNode'].includes(r.key ?? ''));
    expect(removed.map((r) => r.key)).toEqual(['trigger', 'clickhouse', 'taskNode']);
    for (const row of removed) {
      expect(row).toMatchObject({ state: 'current', pin: 'removed in alpha.18' });
      expect(row.closing).toMatch(/ was removed with Trigger\.dev in alpha\.18 \(workplan 0167 T9\): the managed edition's jobs run on pg-boss, so there is no pin left to watch\.$/);
      const title = TITLES[row.key as keyof typeof TITLES];
      // Its issue still open: closed, with that sentence, and nothing else said.
      const open = fakeGh([{ number: 11, title, body: 'behind', state: 'open' }, OTHER]);
      expect(keepIssue(row, open.gh, title)).toBe('closed');
      expect(open.calls.filter((c) => c[0] === 'issue' && c[1] !== 'list')).toEqual([['issue', 'close', '11', '--comment', row.closing]]);
      // The next week: nothing open under that title, so nothing is written.
      const after = fakeGh([OTHER]);
      expect(keepIssue(row, after.gh, title)).toBe('untouched');
      expect(after.calls.filter((c) => c[0] === 'issue' && c[1] !== 'list')).toEqual([]);
    }
    expect(removedRow('X').closing).toBe(
      "X was removed with Trigger.dev in alpha.18 (workplan 0167 T9): the managed edition's jobs run on pg-boss, so there is no pin left to watch.",
    );
  });

  it('reports a missing compose file as an error row, and still compares the rest', async () => {
    const report = await watch(withFiles({ 'deploy/compose/www.yml': null }), everything());
    expect(report.routine).toEqual([expect.objectContaining({ state: 'error', error: 'deploy/compose/www.yml is not in this checkout' })]);
    expect(report.issues.at(-1)!.state).toBe('error');
    expect(report.issues[0]!.state).toBe('current');
  });
});

describe('one issue per title', () => {
  const row: Row = { state: 'behind', pin: '11.22.0', newest: '11.28.6', body: 'pnpm is behind **11.28.6**', update: 'newer: **11.28.6**' };

  it('opens, edits and closes under the title it is given, and leaves the others alone', () => {
    const { gh, calls } = fakeGh([{ number: 1, title: ISSUE_TITLE, body: 'x', state: 'open' }]);
    expect(keepIssue(row, gh, TITLES.pnpm)).toBe('opened');
    expect(calls).toEqual([['issue', 'create', '--title', TITLES.pnpm, '--body', row.body]]);
    const open = fakeGh([{ number: 5, title: TITLES.pnpm, body: 'pnpm is behind **11.27.0**', state: 'open' }]);
    expect(keepIssue({ ...row, state: 'current', closing: 'caught up' }, open.gh, TITLES.pnpm)).toBe('closed');
    expect(open.calls).toEqual([['issue', 'close', '5', '--comment', 'caught up']]);
  });

  it('edits a reworded body quietly when nothing is new, and comments when the newest moved', () => {
    const reworded = fakeGh([{ number: 5, title: TITLES.pnpm, body: 'old words, **11.28.6**', state: 'open' }]);
    expect(keepIssue(row, reworded.gh, TITLES.pnpm)).toBe('updated');
    expect(reworded.calls).toEqual([['issue', 'edit', '5', '--body', row.body]]);
    const moved = fakeGh([{ number: 5, title: TITLES.pnpm, body: 'pnpm is behind **11.27.0**', state: 'open' }]);
    expect(keepIssue(row, moved.gh, TITLES.pnpm)).toBe('updated');
    expect(moved.calls.map((c) => c.slice(0, 2))).toEqual([['issue', 'edit'], ['issue', 'comment']]);
  });
});

describe('every row from one list of the open issues (PERF-4)', () => {
  /** The fake of `fakeGh`, which also counts how often the open issues are listed. */
  function countingGh(issues: Issue[]) {
    const inner = fakeGh(issues);
    let lists = 0;
    const gh = (args: string[]) => {
      if (args[0] === 'issue' && args[1] === 'list') lists += 1;
      return inner.gh(args);
    };
    return { gh, calls: inner.calls, lists: () => lists };
  }

  it('lists the open issues once for every row, and keeps each row under its own title', () => {
    const rows: Row[] = [
      { key: 'zitadel', name: 'identity provider', title: TITLES.zitadel, state: 'current', pin: 'v4.19.1', newest: 'v4.19.1' },
      { key: 'trigger', name: 'Trigger.dev', title: TITLES.trigger, ...removedRow('Trigger.dev') },
      { key: 'clickhouse', name: 'ClickHouse', title: TITLES.clickhouse, ...removedRow('ClickHouse') },
      { key: 'pnpm', name: 'pnpm', title: TITLES.pnpm, state: 'behind', pin: '11.22.0', newest: '11.28.6', body: 'pnpm is behind' },
      { key: 'typescript', name: 'TypeScript split', title: TITLES.typescript, state: 'error', error: 'unread' },
    ];
    const open = countingGh([
      OTHER,
      { number: 11, title: TITLES.trigger, body: 'behind', state: 'open' },
      { number: 12, title: TITLES.clickhouse, body: 'behind', state: 'open' },
    ]);
    expect(keepIssues(rows, open.gh)).toEqual([
      { name: 'identity provider', outcome: 'untouched' },
      { name: 'Trigger.dev', outcome: 'closed' },
      { name: 'ClickHouse', outcome: 'closed' },
      { name: 'pnpm', outcome: 'opened' },
      { name: 'TypeScript split', outcome: 'untouched' },
    ]);
    expect(open.lists()).toBe(1);
    expect(open.calls.map((c) => c.slice(0, 4))).toEqual([
      ['issue', 'close', '11', '--comment'],
      ['issue', 'close', '12', '--comment'],
      ['issue', 'create', '--title', TITLES.pnpm],
    ]);
  });

  it('still lists them itself when called for one row, as before', () => {
    const open = countingGh([OTHER]);
    expect(keepIssue({ state: 'behind', pin: '1', newest: '2', body: 'b' }, open.gh, TITLES.pnpm)).toBe('opened');
    expect(open.lists()).toBe(1);
  });

  it('gives each row the error when the list cannot be read, and writes nothing', () => {
    const rows: Row[] = [
      { name: 'a', title: 'A', state: 'behind', body: 'a' },
      { name: 'b', title: 'B', state: 'current' },
    ];
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      throw new Error('gh: HTTP 502');
    };
    expect(keepIssues(rows, gh)).toEqual([
      { name: 'a', error: 'gh: HTTP 502' },
      { name: 'b', error: 'gh: HTTP 502' },
    ]);
    expect(calls.map((c) => c.slice(0, 2))).toEqual([['issue', 'list']]);
  });

  it('refuses two rows under one title, a row without one counting as the identity provider\'s', () => {
    const { gh, calls } = fakeGh([]);
    expect(() => keepIssues([{ name: 'a', title: ISSUE_TITLE, state: 'current' }, { name: 'b', state: 'current' }], gh)).toThrow(
      `two rows keep the issue titled "${ISSUE_TITLE}"`,
    );
    expect(calls).toEqual([]);
  });
});

describe(`${WORKFLOW_FILE}`, () => {
  const workflow = parseYaml(WORKFLOW) as {
    on: Record<string, unknown>;
    permissions: Record<string, string>;
    jobs: Record<string, { 'runs-on': string; steps: Array<{ run?: string; env?: Record<string, string>; with?: Record<string, unknown>; uses?: string }> }>;
  };

  it('runs once a week and on demand, and never on a pull request or a push', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    const crons = (workflow.on.schedule as Array<{ cron: string }>).map((s) => s.cron);
    expect(crons).toHaveLength(1);
    const fields = crons[0]!.trim().split(/\s+/);
    expect(fields).toHaveLength(5);
    expect(fields[4], 'one day of the week, so once a week').toMatch(/^[0-6]$/);
  });

  it('may read the code and write issues, and nothing else', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', issues: 'write' });
  });

  it("runs on a GitHub-hosted runner, never on the machine it watches, and keeps the issue with the script", () => {
    const jobs = Object.values(workflow.jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!['runs-on']).toMatch(/^ubuntu-/);
    const runs = jobs[0]!.steps.filter((s) => s.run);
    expect(runs.map((s) => s.run!.trim())).toEqual(['node scripts/idp-pin-watch.mjs --issue']);
    expect(runs[0]!.env).toMatchObject({ GH_TOKEN: '${{ github.token }}' });
    const checkout = jobs[0]!.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });
});

describe("the second Nextcloud major's leg, against its own major's newest tag (0119 T5)", () => {
  const LEG = REAL.read(NEXTCLOUD_SECOND_MAJOR_WORKFLOW)!;
  const pin = secondMajorPin(LEG);
  const demo = readImages(REAL.read('deploy/compose/dev.yml')!).find((i) => i.repo === 'nextcloud')!;
  const row = async (over: Record<string, string | null> = {}, newer: Record<string, string> = {}) =>
    (await routineRows(Object.keys(over).length ? withFiles(over) : REAL, fakeNet(registry(newer)))).rows.find((r) => r.name === 'nextcloud, the second major')!;

  it('reads the one NEXTCLOUD_IMAGE the leg runs, a major the demo does not run, by tag and index digest', () => {
    expect(pin.repo).toBe('nextcloud');
    expect(pin.tag).toMatch(/^\d+\.\d+\.\d+-apache$/);
    expect(pin.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(demo, 'dev.yml runs no Nextcloud: the demo major moved somewhere this case does not read').toBeDefined();
    expect(pin.tag.split('.')[0]).not.toBe(demo.tag.split('.')[0]);
  });

  it('is current while its major lists nothing newer, and the demo major listing a newer tag changes nothing', async () => {
    const next = `${Number(demo.tag.split('.')[0]) + 1}.0.0-apache`;
    expect(await row({}, { 'library/nextcloud': next })).toMatchObject({ state: 'current', pin: `${pin.tag}@${pin.digest}`, newest: pin.tag, where: NEXTCLOUD_SECOND_MAJOR_WORKFLOW });
  });

  it('is behind on a newer tag of its own major, and says how it moves', async () => {
    const [major, minor] = pin.tag.split('.');
    const newer = `${major}.${minor}.99-apache`;
    const behind = await row({}, { 'library/nextcloud': newer });
    expect(behind).toMatchObject({ state: 'behind', newest: newer, notes: [NEXTCLOUD_SECOND_MAJOR_NOTE] });
    const { rows, status } = await routineRows(REAL, fakeNet(registry({ 'library/nextcloud': newer })));
    const line = (summaryOf(rows, status).body ?? '').split('\n').find((l) => l.startsWith('- `nextcloud, the second major`'));
    expect(line).toContain(`newest **${newer}**; ${NEXTCLOUD_SECOND_MAJOR_NOTE}`);
  });

  it('a leg that names no image, two, another image or no digest is an error, never current', async () => {
    const line = /^\s*NEXTCLOUD_IMAGE:.*$/m.exec(LEG)![0];
    const cases: Array<[string, RegExp]> = [
      [LEG.replace(line, ''), /sets NEXTCLOUD_IMAGE 0 times, not once/],
      [LEG.replace(line, `${line}\n${line}`), /sets NEXTCLOUD_IMAGE 2 times, not once/],
      [LEG.replace(line, line.replace('nextcloud:', 'owncloud:')), /names owncloud:.*not nextcloud by a numbered tag and its index digest/],
      [LEG.replace(line, line.replace(/@sha256:[0-9a-f]{64}/, '')), /not nextcloud by a numbered tag and its index digest/],
    ];
    for (const [text, error] of cases) {
      expect(text).not.toBe(LEG);
      const broken = await row({ [NEXTCLOUD_SECOND_MAJOR_WORKFLOW]: text });
      expect(broken.state).toBe('error');
      expect(broken.error).toMatch(error);
    }
  });
});

describe('the hadolint the Dockerfile lint runs, against its newest release on Docker Hub (0119, 2026-11-19)', () => {
  const LINT = REAL.read(HADOLINT_WORKFLOW)!;
  const pin = hadolintPin(LINT);
  const row = async (over: Record<string, string | null> = {}, newer: Record<string, string> = {}) =>
    (await routineRows(Object.keys(over).length ? withFiles(over) : REAL, fakeNet(registry(newer)))).rows.find((r) => r.name === 'hadolint/hadolint')!;

  it('reads the one HADOLINT_IMAGE the job runs, hadolint/hadolint by a release tag and its index digest', () => {
    expect(HADOLINT_WORKFLOW).toBe('.github/workflows/hadolint.yml');
    expect(pin.repo).toBe('hadolint/hadolint');
    expect(pin.tag).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(pin.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(registryOf(pin.repo)).toEqual({ host: 'registry-1.docker.io', name: 'hadolint/hadolint' });
  });

  it('is current while Docker Hub lists nothing newer of its shape and major: not its Debian build, latest, a commit, or v3', async () => {
    expect(await row()).toMatchObject({ state: 'current', pin: `${pin.tag}@${pin.digest}`, newest: pin.tag, where: HADOLINT_WORKFLOW });
  });

  it('is behind on a newer release of its major, and says how it moves', async () => {
    const [major, minor] = pin.tag.slice(1).split('.');
    const newer = `v${major}.${minor}.99`;
    expect(await row({}, { 'hadolint/hadolint': newer })).toMatchObject({ state: 'behind', newest: newer, notes: [HADOLINT_NOTE] });
    const { rows, status } = await routineRows(REAL, fakeNet(registry({ 'hadolint/hadolint': newer })));
    const line = (summaryOf(rows, status).body ?? '').split('\n').find((l) => l.startsWith('- `hadolint/hadolint`'));
    expect(line).toContain(`(${HADOLINT_WORKFLOW}): ${pin.tag}@${pin.digest}, newest **${newer}**; ${HADOLINT_NOTE}`);
  });

  it('a job that names no image, two, another image, a tag of no release or no digest is an error, never current', async () => {
    const line = /^\s*HADOLINT_IMAGE:.*$/m.exec(LINT)![0];
    const cases: Array<[string, RegExp]> = [
      [LINT.replace(line, ''), /sets HADOLINT_IMAGE 0 times, not once/],
      [LINT.replace(line, `${line}\n${line}`), /sets HADOLINT_IMAGE 2 times, not once/],
      [LINT.replace(line, line.replace('hadolint/hadolint:', 'ghcr.io/hadolint/hadolint:')), /not hadolint\/hadolint by a release tag and its index digest/],
      [LINT.replace(line, line.replace(/:v[\d.]+@/, ':latest@')), /not hadolint\/hadolint by a release tag and its index digest/],
      [LINT.replace(line, line.replace(/@sha256:[0-9a-f]{64}/, '')), /not hadolint\/hadolint by a release tag and its index digest/],
    ];
    for (const [text, error] of cases) {
      expect(text).not.toBe(LINT);
      const broken = await row({ [HADOLINT_WORKFLOW]: text });
      expect(broken.state).toBe('error');
      expect(broken.error).toMatch(error);
    }
  });
});

describe('the Semgrep the tree is scanned with, against its newest release on Docker Hub (0163 T3, 2026-11-21)', () => {
  const SCAN = REAL.read(SEMGREP_WORKFLOW)!;
  const pin = semgrepPin(SCAN);
  const row = async (over: Record<string, string | null> = {}, newer: Record<string, string> = {}) =>
    (await routineRows(Object.keys(over).length ? withFiles(over) : REAL, fakeNet(registry(newer)))).rows.find((r) => r.name === 'semgrep/semgrep')!;

  it('reads the one SEMGREP_IMAGE the job runs, semgrep/semgrep by a release tag and its index digest', () => {
    expect(SEMGREP_WORKFLOW).toBe('.github/workflows/semgrep.yml');
    expect(pin.repo).toBe('semgrep/semgrep');
    expect(pin.tag).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pin.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(registryOf(pin.repo)).toEqual({ host: 'registry-1.docker.io', name: 'semgrep/semgrep' });
  });

  it('is current while Docker Hub lists nothing newer of its shape and major: not its -nonroot build, latest, canary, or 2.0.0', async () => {
    expect(await row()).toMatchObject({ state: 'current', pin: `${pin.tag}@${pin.digest}`, newest: pin.tag, where: SEMGREP_WORKFLOW });
  });

  it('is behind on a newer release of its major, and says how it moves', async () => {
    const [major, minor] = pin.tag.split('.');
    const newer = `${major}.${Number(minor) + 1}.0`;
    expect(await row({}, { 'semgrep/semgrep': newer })).toMatchObject({ state: 'behind', newest: newer, notes: [SEMGREP_NOTE] });
    const { rows, status } = await routineRows(REAL, fakeNet(registry({ 'semgrep/semgrep': newer })));
    const line = (summaryOf(rows, status).body ?? '').split('\n').find((l) => l.startsWith('- `semgrep/semgrep`'));
    expect(line).toContain(`(${SEMGREP_WORKFLOW}): ${pin.tag}@${pin.digest}, newest **${newer}**; ${SEMGREP_NOTE}`);
  });

  it('a job that names no image, two, another image, a tag of no release or no digest is an error, never current', async () => {
    const line = /^\s*SEMGREP_IMAGE:.*$/m.exec(SCAN)![0];
    const cases: Array<[string, RegExp]> = [
      [SCAN.replace(line, ''), /sets SEMGREP_IMAGE 0 times, not once/],
      [SCAN.replace(line, `${line}\n${line}`), /sets SEMGREP_IMAGE 2 times, not once/],
      [SCAN.replace(line, line.replace('semgrep/semgrep:', 'returntocorp/semgrep:')), /not semgrep\/semgrep by a release tag and its index digest/],
      [SCAN.replace(line, line.replace(/:[\d.]+@/, ':latest@')), /not semgrep\/semgrep by a release tag and its index digest/],
      [SCAN.replace(line, line.replace(/:([\d.]+)@/, ':$1-nonroot@')), /not semgrep\/semgrep by a release tag and its index digest/],
      [SCAN.replace(line, line.replace(/@sha256:[0-9a-f]{64}/, '')), /not semgrep\/semgrep by a release tag and its index digest/],
    ];
    for (const [text, error] of cases) {
      expect(text).not.toBe(SCAN);
      const broken = await row({ [SEMGREP_WORKFLOW]: text });
      expect(broken.state).toBe('error');
      expect(broken.error).toMatch(error);
    }
  });
});

describe('the zizmor the workflow audit runs, against its newest release on ghcr.io (0119, 2026-11-20)', () => {
  const AUDIT = REAL.read(ZIZMOR_WORKFLOW)!;
  const pin = zizmorPin(AUDIT);
  const row = async (over: Record<string, string | null> = {}, newer: Record<string, string> = {}) =>
    (await routineRows(Object.keys(over).length ? withFiles(over) : REAL, fakeNet(registry(newer)))).rows.find((r) => r.name === 'ghcr.io/zizmorcore/zizmor')!;

  it('reads the one ZIZMOR_IMAGE the job runs, ghcr.io/zizmorcore/zizmor by a release tag and its index digest', () => {
    expect(ZIZMOR_WORKFLOW).toBe('.github/workflows/zizmor.yml');
    expect(pin.repo).toBe('ghcr.io/zizmorcore/zizmor');
    expect(pin.tag).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pin.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(registryOf(pin.repo)).toEqual({ host: 'ghcr.io', name: 'zizmorcore/zizmor' });
  });

  it('is current while ghcr.io lists nothing newer of its shape and major: not a release candidate, latest, or 2.0.0', async () => {
    expect(await row()).toMatchObject({ state: 'current', pin: `${pin.tag}@${pin.digest}`, newest: pin.tag, where: ZIZMOR_WORKFLOW });
  });

  it('is behind on a newer release of its major, and says how it moves', async () => {
    const [major, minor] = pin.tag.split('.');
    const newer = `${major}.${minor}.99`;
    expect(await row({}, { 'zizmorcore/zizmor': newer })).toMatchObject({ state: 'behind', newest: newer, notes: [ZIZMOR_NOTE] });
    const { rows, status } = await routineRows(REAL, fakeNet(registry({ 'zizmorcore/zizmor': newer })));
    const line = (summaryOf(rows, status).body ?? '').split('\n').find((l) => l.startsWith('- `ghcr.io/zizmorcore/zizmor`'));
    expect(line).toContain(`(${ZIZMOR_WORKFLOW}): ${pin.tag}@${pin.digest}, newest **${newer}**; ${ZIZMOR_NOTE}`);
  });

  it('a job that names no image, two, another image, a release candidate or no digest is an error, never current', async () => {
    const line = /^\s*ZIZMOR_IMAGE:.*$/m.exec(AUDIT)![0];
    const cases: Array<[string, RegExp]> = [
      [AUDIT.replace(line, ''), /sets ZIZMOR_IMAGE 0 times, not once/],
      [AUDIT.replace(line, `${line}\n${line}`), /sets ZIZMOR_IMAGE 2 times, not once/],
      [AUDIT.replace(line, line.replace('ghcr.io/zizmorcore/zizmor:', 'zizmorcore/zizmor:')), /not ghcr\.io\/zizmorcore\/zizmor by a release tag and its index digest/],
      [AUDIT.replace(line, line.replace(/:[\d.]+@/, ':1.30.0-rc2@')), /not ghcr\.io\/zizmorcore\/zizmor by a release tag and its index digest/],
      [AUDIT.replace(line, line.replace(/@sha256:[0-9a-f]{64}/, '')), /not ghcr\.io\/zizmorcore\/zizmor by a release tag and its index digest/],
    ];
    for (const [text, error] of cases) {
      expect(text).not.toBe(AUDIT);
      const broken = await row({ [ZIZMOR_WORKFLOW]: text });
      expect(broken.state).toBe('error');
      expect(broken.error).toMatch(error);
    }
  });
});

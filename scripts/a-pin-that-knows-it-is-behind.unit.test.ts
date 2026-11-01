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
 * routine pins. This also holds those rows, against stubbed registries, npm,
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
 * the tag today, read with a HEAD, and is behind when the two differ.
 */

import { afterAll, describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  ATLAS_ARCHES,
  ATLAS_HOST,
  ATLAS_IMAGE,
  ATLAS_NOTE,
  ATLAS_WORKFLOW,
  COMPARED_ELSEWHERE,
  COMPOSE,
  COMPOSE_FILES,
  COSIGN_FILES,
  ISSUE_TITLE,
  STALWART_FILES,
  GOACCESS_DOCKERFILE,
  LINES,
  SOCKET_PROXY_DOCKERFILE,
  SOCKET_PROXY_UPSTREAM,
  TASK_ON_API_IMAGE,
  TITLES,
  WINDOW_DAYS,
  actionDefault,
  atlasPin,
  baseImageOf,
  builtImage,
  builtNote,
  clickhouseRow,
  clickhouseSupport,
  compareTags,
  comparePin,
  fileInTgz,
  issueBody,
  keepIssue,
  newestLike,
  newestRelease,
  nodeVersionOf,
  pnpmRow,
  readImages,
  readPin,
  readTriggerPin,
  TRIGGER_BUILDS,
  registryDigest,
  registryOf,
  repoReader,
  REBUILD_NOTE,
  routineRows,
  securityFloor,
  stepsUsing,
  summaryOf,
  table,
  taskNodeRow,
  triggerRow,
  typescriptRow,
  watch,
  type Net,
  type Repo,
  type Row,
} from './idp-pin-watch.mjs';

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
  npm?: (args: string[]) => string;
  probe?: (pin: string) => string;
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
    npm: async (args) => {
      if (!stubs.npm) throw new Error('npm is not stubbed');
      return stubs.npm(args);
    },
    probe: async (pin) => {
      if (!stubs.probe) throw new Error('the probe is not stubbed');
      return stubs.probe(pin);
    },
  };
}

const TOKEN: [RegExp, Answer] = [/\/token\?/, { token: 'anonymous' }];
const lsRemote = (...tags: string[]) => tags.map((t, i) => `${i}\trefs/tags/${t}`).join('\n');

/** A gzipped tar holding `files`, as an npm package tarball is. */
function tgz(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100);
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const D24 = `sha256:d2d0c018${'0'.repeat(56)}`;
/**
 * The stand-in CLI's `node-26` base, which the tasks' row reads: the config
 * names `runtime: 'node-26'` since the Node line moved to 26 (2026-10-31,
 * workplan 0119 §2.4). Before that these cases read a `node-24` row, and a
 * stand-in CLI without a row for the config's runtime failed them all with
 * "names no image for node-26". The digests are stand-ins, the shape is
 * trigger.dev 4.8.3's `buildImage.js`.
 */
const D26 = `sha256:e319f113${'0'.repeat(56)}`;
const D26_NEW = `sha256:9e9e9e9e${'0'.repeat(56)}`;
const buildImageJs = (node26: string) =>
  [
    'export const BASE_IMAGE = {',
    `    bun: "triggerdotdev/bun:1.3-node20-bookworm@sha256:${'a'.repeat(64)}",`,
    `    node: "triggerdotdev/node:24-bookworm@${D24}",`,
    `    "node-22": "triggerdotdev/node:22-bookworm@sha256:${'b'.repeat(64)}",`,
    `    "node-24": "triggerdotdev/node:24-bookworm@${D24}",`,
    `    "node-26": "triggerdotdev/node:26-bookworm@${node26}",`,
    '};',
    'export const BUILD_IMAGE = {',
    `    "node-24": "triggerdotdev/node:24-bookworm-build@sha256:${'c'.repeat(64)}",`,
    `    "node-26": "triggerdotdev/node:26-bookworm-build@sha256:${'e'.repeat(64)}",`,
    '};',
  ].join('\n');
const cliTarball = (node26: string) => tgz({ 'package/package.json': '{}', 'package/dist/esm/deploy/buildImage.js': buildImageJs(node26) });

/** Docker Hub as the task image's Node is read from it: an index, its amd64 manifest, the config. */
const taskImageRegistry = (digest: string, node: string): Array<[RegExp, Answer]> => [
  [
    new RegExp(`/v2/triggerdotdev/node/manifests/${digest}$`),
    {
      manifests: [
        { digest: `${digest}-arm64`, platform: { os: 'linux', architecture: 'arm64' } },
        { digest: `${digest}-amd64`, platform: { os: 'linux', architecture: 'amd64' } },
      ],
    },
  ],
  [new RegExp(`/v2/triggerdotdev/node/manifests/${digest}-amd64$`), { config: { digest: `${digest}-config` } }],
  [new RegExp(`/v2/triggerdotdev/node/blobs/${digest}-config$`), { config: { Env: ['PATH=/usr/bin', `NODE_VERSION=${node}`] } }],
];
const NODE_INDEX: [RegExp, Answer] = [
  /nodejs\.org\/dist\/index\.json$/,
  [
    { version: 'v26.12.1', date: '2026-10-21', security: true },
    { version: 'v24.22.1', date: '2026-10-20', security: true },
    { version: 'v24.22.0', date: '2026-10-14', security: false },
    { version: 'v24.18.1', date: '2026-07-28', security: true },
  ],
];

const MANAGED = REAL.read(COMPOSE)!;
const TRIGGER_PIN = /\$\{TRIGGER_IMAGE_TAG:-(v[^}]+)\}/.exec(MANAGED)![1]!;

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
    const sign = stepsUsing(REAL.read('.github/workflows/images.yml')!, 'sigstore/cosign-installer');
    expect(sign).toHaveLength(1);
  });

  it("reads an action's default for an input, under inputs: only", () => {
    const action = ['name: x', 'inputs:', '  version:', "    description: 'v'", "    default: 'v0.70.0'", '  cache:', "    default: 'true'", 'outputs:', '  version:', "    default: 'no'"].join('\n');
    expect(actionDefault(action, 'version')).toBe('v0.70.0');
    expect(() => actionDefault(action, 'cosign-release')).toThrow(/no input/);
  });
});

describe('Trigger.dev, against the newest tag both images carry', () => {
  it("reads the pin from managed.yml's two defaults, which agree with apps/worker's SDK", () => {
    expect(readTriggerPin(MANAGED, REAL.read('apps/worker/package.json')!)).toBe(TRIGGER_PIN);
    const one = MANAGED.replace(`:-${TRIGGER_PIN}}`, ':-v9.9.9}');
    expect(() => readTriggerPin(one, REAL.read('apps/worker/package.json')!)).toThrow(/disagree/);
    expect(() => readTriggerPin(MANAGED, '{"dependencies":{"@trigger.dev/sdk":"1.0.0"}}')).toThrow(/move together/);
  });

  it('asks the probe trigger-version.sh runs, upward from the pin, and calls the newest it answers', async () => {
    const asked: string[] = [];
    const probe = (pin: string) => {
      asked.push(pin);
      return 'v4.99.2\nv4.99.1\n';
    };
    const row = await triggerRow(REAL, fakeNet({ probe }));
    expect(asked).toEqual([TRIGGER_PIN]);
    expect(row).toMatchObject({ pin: TRIGGER_PIN, newest: 'v4.99.2', state: 'behind' });
    expect(row.body).toContain('Drain first');
    expect(row.body).toContain('`./deploy/compose/trigger-version.sh backup before-v4.99.2`');
    expect(row.body).toContain('`./deploy/compose/trigger-version.sh pin v4.99.2`, then `pnpm install`');
    expect(row.body).toMatch(/Its own pull request/);
    expect(row.body).toMatch(/E2E \(managed\) dispatched on that branch/);
    expect(row.body).toMatch(/Live takes it from a release tag/);
    // The builds are proven at the new tag before the drain, the backup and the window (0146 T16).
    const body = row.body ?? '';
    const order = ['trigger-version.sh pin v4.99.2', 'build (trigger, amd64)', 'Drain first', 'backup before-v4.99.2', 'E2E (managed) dispatched'].map((s) => body.indexOf(s));
    expect(order.every((i) => i >= 0), JSON.stringify(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(row.body).toContain('`read_at`');
  });

  it("reads the two images built here (0146 T16) by their Dockerfiles' FROM, which must name the pin", async () => {
    const built = readImages(MANAGED).filter((i) => i.repo in TRIGGER_BUILDS);
    expect(built.map((i) => i.repo).sort()).toEqual(['localhost/supervisor', 'localhost/trigger.dev']);
    for (const line of built) {
      const b = builtImage(REAL, COMPOSE, line)!;
      expect(b.base.repo).toBe(TRIGGER_BUILDS[line.repo]);
      expect(b.base.tag).toBe(TRIGGER_PIN);
      expect(line.tag).toBe(b.tag);
    }
    // A Dockerfile left at another version than the defaults: the row fails, and never says current.
    const file = 'deploy/compose/supervisor/Dockerfile';
    const behind = REAL.read(file)!.replace(/^(FROM \S+:)v[\d.]+@/m, '$1v4.0.0@');
    await expect(triggerRow(withFiles({ [file]: behind }), fakeNet({ probe: () => '' }))).rejects.toThrow(
      `${file} builds on ghcr.io/triggerdotdev/supervisor:v4.0.0, and ${COMPOSE} pins ghcr.io/triggerdotdev/supervisor:${TRIGGER_PIN}`,
    );
    // Their bases are compared by this row, so the routine rows leave them out, with no note of their own.
    const { rows } = await routineRows(REAL, fakeNet(registry()));
    expect(rows.filter((r) => /triggerdotdev|localhost/.test(r.name ?? '')).map((r) => r.name)).toEqual([]);
    expect(COMPARED_ELSEWHERE).toMatchObject({ 'ghcr.io/triggerdotdev/trigger.dev': 'the Trigger.dev row', 'ghcr.io/triggerdotdev/supervisor': 'the Trigger.dev row' });
    // The issue says the images are built here, and what to do with the builds on a move.
    const row = await triggerRow(REAL, fakeNet({ probe: () => 'v4.99.2\n' }));
    expect(row.body).toContain('deploy/compose/trigger.dev/Dockerfile');
    expect(row.body).toContain('`build (trigger, amd64|arm64)`');
  });

  it('is current when the probe finds nothing newer, and refuses an answer that is not a tag', async () => {
    expect((await triggerRow(REAL, fakeNet({ probe: () => '' }))).state).toBe('current');
    await expect(triggerRow(REAL, fakeNet({ probe: () => 'v4.8.0-rc.1\n' }))).rejects.toThrow(/not a release tag/);
  });

  it('runs the real probe, whose start must answer first', () => {
    const watcher = readFileSync(join(REPO_ROOT, 'scripts/idp-pin-watch.mjs'), 'utf8');
    expect(watcher).toContain("'deploy/compose/trigger-version.sh'), 'probe', pin]");
    const script = readFileSync(join(REPO_ROOT, 'deploy/compose/trigger-version.sh'), 'utf8');
    expect(script).toMatch(/^\s*probe\)\s+shift; cmd_probe "\$@" ;;$/m);
    expect(script).toMatch(/cmd_probe\(\) \{[\s\S]*?tag_usable "\$from" \|\| die[\s\S]*?probe_upgrades "\$from"/);
  });
});

describe("ClickHouse, against what Trigger.dev's own compose pins", () => {
  const ours = readImages(MANAGED).find((i) => i.repo === 'clickhouse/clickhouse-server')!;
  const security = '| Version | Supported |\n|:-|:-|\n| 26.9 | ✔️ |\n| 26.8 | ✔️ |\n| 26.3 | ✔️ |\n| 26.2 | ❌ |\n| 25.* | ❌ |\n';
  const upstream = (ref: string): [RegExp, Answer] => [/triggerdotdev\/trigger\.dev\/v4\.99\.2\/docker\/docker-compose\.yml$/, `services:\n  clickhouse:\n    image: ${ref}\n`];
  const trigger: Row = { state: 'behind', pin: TRIGGER_PIN, newest: 'v4.99.2' };

  it('reads the support of the pinned line from SECURITY.md, as text', () => {
    expect(clickhouseSupport(security, '26.2.19.43')).toBe(
      "ClickHouse 26.2 is not supported with security updates, by ClickHouse's SECURITY.md (supported: 26.9, 26.8, 26.3)",
    );
    expect(clickhouseSupport(security, '26.8.1.1')).toMatch(/^ClickHouse 26\.8 is supported/);
    expect(clickhouseSupport(security, '25.7.1.1')).toMatch(/^ClickHouse 25\.7 is not supported/);
  });

  it('is current when upstream pins the same tag and digest, whatever SECURITY.md says', async () => {
    const net = fakeNet({ text: [upstream(ours.ref), [/SECURITY\.md$/, security]] });
    const row = await clickhouseRow(REAL, net, trigger);
    expect(row.state).toBe('current');
    expect(row.notes?.[0]).toMatch(/is not supported/);
  });

  it('differs when upstream moved, and says the support line and the route in the issue', async () => {
    const net = fakeNet({ text: [upstream(`clickhouse/clickhouse-server:26.8.1.1@sha256:${'1'.repeat(64)}`), [/SECURITY\.md$/, security]] });
    const row = await clickhouseRow(REAL, net, trigger);
    expect(row.state).toBe('behind');
    expect(row.body).toContain(`pins **26.8.1.1@sha256:${'1'.repeat(64)}**`);
    expect(row.body).toContain('ClickHouse 26.2 is not supported');
    expect(row.body).toMatch(/E2E \(managed\) on its branch/);
  });

  it('reads nothing when the Trigger.dev row named no tag', async () => {
    await expect(clickhouseRow(REAL, fakeNet(), { state: 'error' })).rejects.toThrow(/named no tag/);
  });
});

describe("the tasks' Node, against Node's newest security release", () => {
  const cli = JSON.parse(REAL.read('apps/worker/package.json')!).dependencies['@trigger.dev/sdk'] as string;
  const config = REAL.read('apps/worker/trigger.config.ts')!;
  const net = (latest: string, latestDigest: string, latestNode = '26.12.0') =>
    fakeNet({
      bytes: [
        [new RegExp(`trigger\\.dev-${cli.replace(/\./g, '\\.')}\\.tgz$`), cliTarball(D26)],
        [new RegExp(`trigger\\.dev-${latest.replace(/\./g, '\\.')}\\.tgz$`), cliTarball(latestDigest)],
      ],
      json: [
        TOKEN,
        NODE_INDEX,
        ...taskImageRegistry(D24, '24.18.0'),
        ...taskImageRegistry(D26, '26.12.0'),
        ...taskImageRegistry(D26_NEW, latestNode),
      ],
      npm: (args) => (args.join(' ') === 'view trigger.dev version' ? `${latest}\n` : ''),
    });

  it("reads the CLI's base image as text from its tarball, never running it", () => {
    const js = fileInTgz(cliTarball(D26), 'package/dist/esm/deploy/buildImage.js');
    expect(baseImageOf(js, 'node-26')).toBe(`triggerdotdev/node:26-bookworm@${D26}`);
    expect(baseImageOf(js, 'node-24')).toBe(`triggerdotdev/node:24-bookworm@${D24}`);
    expect(baseImageOf(js, 'node')).toBe(`triggerdotdev/node:24-bookworm@${D24}`);
    expect(() => baseImageOf(js, 'node-28')).toThrow(/no image for node-28/);
    expect(() => fileInTgz(cliTarball(D26), 'package/missing.js')).toThrow(/not in the package/);
  });

  it("reads the image's Node from its amd64 config, and the floor from nodejs.org's index", async () => {
    expect(await nodeVersionOf(net('9.9.9', D26_NEW), `triggerdotdev/node:24-bookworm@${D24}`)).toBe('24.18.0');
    expect(await nodeVersionOf(net('9.9.9', D26_NEW), `triggerdotdev/node:26-bookworm@${D26}`)).toBe('26.12.0');
    expect(securityFloor(NODE_INDEX[1], 24)).toEqual({ version: '24.22.1', date: '2026-10-20' });
    expect(securityFloor(NODE_INDEX[1], 26)).toEqual({ version: '26.12.1', date: '2026-10-21' });
    expect(() => securityFloor([], 24)).toThrow(/no security release/);
  });

  it('is behind on 26.12.0 below 26.12.1, and names the pinned CLI, the newest CLI and the floor', async () => {
    // The config's own runtime, read as the row reads it: the stand-in CLI's row for it is D26.
    expect(/\bruntime:\s*['"]([^'"]+)['"]/.exec(config)?.[1]).toBe('node-26');
    const row = await taskNodeRow(withFiles({ 'apps/worker/trigger.config.ts': config.replace(TASK_ON_API_IMAGE, '') }), net('9.9.9', D26));
    expect(row).toMatchObject({ pin: '26.12.0', newest: '26.12.1', state: 'behind' });
    expect(row.body).toContain(`trigger.dev ${cli}`);
    expect(row.body).toContain('**26.12.1**');
    expect(row.body).toMatch(/trigger\.dev 9\.9\.9, still builds on Node 26\.12\.0: upstream has not republished/);
  });

  it('says a Trigger.dev move fixes it once the newest CLI builds on a Node at the floor', async () => {
    const row = await taskNodeRow(withFiles({ 'apps/worker/trigger.config.ts': config.replace(TASK_ON_API_IMAGE, '') }), net('9.9.9', D26_NEW, '26.12.1'));
    expect(row.body).toMatch(/trigger\.dev 9\.9\.9, builds on Node 26\.12\.1: moving Trigger\.dev to it/);
  });

  it("stops, and closes its issue, once the tasks build on the API image's base", async () => {
    const bare = config.replace(TASK_ON_API_IMAGE, '');
    expect(TASK_ON_API_IMAGE.test(bare), 'the vacuity case: without the mark the row reports').toBe(false);
    const onApiImage = `${bare}\n// manifest.image = { ...manifest.image, base: taskBase.image };\n`;
    const asked = fakeNet();
    const row = await taskNodeRow(withFiles({ 'apps/worker/trigger.config.ts': onApiImage }), asked);
    expect(row.state).toBe('current');
    expect(row.closing).toMatch(/Dependabot moves with `apps\/api\/Dockerfile`/);
    expect(asked.asked).toEqual([]);
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
    'case "$url" in "$STUB_HOST"atlas/*) name="${url##*/}" ;; *) echo "curl: (6) Could not resolve host: $url" >&2; exit 6 ;; esac',
    '[ -f "$STUB_SERVED/$name" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }',
    '[ -n "$out" ] && cp "$STUB_SERVED/$name" "$out"',
  ],
  uname: ['#!/bin/sh', 'case "$1" in -m) echo "$STUB_MACHINE" ;; *) echo Linux ;; esac'],
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
      STUB_HOST: ATLAS_HOST,
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

/** The GoAccess release `deploy/compose/goaccess/Dockerfile` builds (#1675), read from its own line. */
const GOACCESS_RELEASE = /^# GoAccess (v\d+(?:\.\d+)+)$/m.exec(REAL.read(GOACCESS_DOCKERFILE) ?? '')?.[1] ?? 'no release named';
/** The docker-socket-proxy release trigger-docker-proxy is built from (2026-10-30), read from its own line. */
const SOCKET_PROXY_RELEASE = /^# docker-socket-proxy (v\d+\.\d+\.\d+)$/m.exec(REAL.read(SOCKET_PROXY_DOCKERFILE) ?? '')?.[1] ?? 'no release named';

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
  for (const file of STALWART_FILES) for (const m of (REAL.read(file) ?? '').matchAll(/stalwartlabs\/stalwart:(v[\d.]+)/g)) pins.set('stalwartlabs/stalwart', [m[1]!]);
  // The Atlas release ci.yml installs, as the community image's tag, beside tags of other shapes
  // and another major that its row must never take for a newer release.
  pins.set(ATLAS_IMAGE, [ATLAS_TAG, 'latest-community', '1.99.0-community-alpine', '1.99.0-extended', '2.0.0-community']);
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
    text: [
      [/trivy-action\/[0-9a-f]{40}\/action\.yaml$/, "inputs:\n  version:\n    default: 'v0.70.0'\n"],
      [/cosign-installer\/[0-9a-f]{40}\/action\.yml$/, "inputs:\n  cosign-release:\n    default: 'v3.0.6'\n"],
    ],
    lsRemote: {
      'https://github.com/aquasecurity/trivy': lsRemote('v0.70.0', ...(TRIVY_NAMED ? [TRIVY_NAMED] : []), ...(newer.trivy ? [newer.trivy] : [])),
      // GoAccess's releases as upstream tags them, two parts and three, up to the one the Dockerfile builds.
      'https://github.com/allinurl/goaccess': lsRemote('v1.9.4', 'v1.10', 'v1.10.2', GOACCESS_RELEASE, ...(newer.goaccess ? [newer.goaccess] : [])),
      'https://github.com/sigstore/cosign': lsRemote('v3.0.6', ...(COSIGN_NAMED ? [COSIGN_NAMED] : []), ...(newer.cosign ? [newer.cosign] : [])),
      // docker-socket-proxy's releases as upstream tags them, up to the one the Dockerfile builds.
      [SOCKET_PROXY_UPSTREAM]: lsRemote('v0.1.0', 'v0.4.2', SOCKET_PROXY_RELEASE, ...(newer.socketProxy ? [newer.socketProxy] : [])),
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
    const pgbouncer = readImages(MANAGED).find((i) => i.repo === 'edoburu/pgbouncer')!;
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
    expect(summary.body).toContain(`- \`edoburu/pgbouncer\` (deploy/compose/managed.yml): ${pgbouncer.tag}, newest **${newer}**`);
    if (!TRIVY_NAMED) expect(summary.body).toMatch(/no version: named, so trivy-action \S+'s default/);
    expect(summary.body).toContain(`- \`cosign\` (${COSIGN_FILES.join(', ')}): ${COSIGN_NAMED}, newest **v3.99.0**`);
    expect(summary.body).not.toContain('Also known');
    const { gh, calls } = fakeGh([OTHER]);
    expect(keepIssue(summary, gh, TITLES.routine)).toBe('opened');
    expect(calls).toEqual([['issue', 'create', '--title', TITLES.routine, '--body', summary.body]]);
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
    expect(readImages(MANAGED).filter((i) => i.repo === 'localhost/postgres').length, 'managed.yml builds no postgres').toBe(2);
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
    const fixture = REAL.read('deploy/selfhost/setup-stalwart.sh')!.replace(/stalwartlabs\/stalwart:v[\d.]+/, 'stalwartlabs/stalwart:v0.16.1');
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

  it("compares the socket proxy's release with upstream's git tags, and its HAProxy only within its line (2026-10-30)", async () => {
    const proxy = readImages(MANAGED).find((i) => i.repo === 'localhost/docker-socket-proxy')!;
    expect(proxy, 'managed.yml no longer builds the Docker socket proxy').toBeDefined();
    const base = builtImage(REAL, COMPOSE, proxy)!.base;
    expect(base.repo).toBe('haproxy');
    expect(LINES).toEqual({ haproxy: 2 });
    const [major, minor, patch] = base.tag.match(/\d+/g)!.map(Number) as [number, number, number];
    const suffix = base.tag.replace(/^[\d.]+/, '');
    // The release: current against the tags upstream has, behind against a newer one.
    expect(SOCKET_PROXY_RELEASE).toMatch(/^v0\.\d+\.\d+$/);
    const rows = async (newer: Record<string, string> = {}) => (await routineRows(REAL, fakeNet(registry(newer)))).rows;
    expect((await rows()).find((r) => r.name === 'tecnativa/docker-socket-proxy')).toMatchObject({ state: 'current', pin: SOCKET_PROXY_RELEASE, newest: SOCKET_PROXY_RELEASE });
    const next = SOCKET_PROXY_RELEASE.replace(/^v0\.(\d+)\.\d+$/, (_all, m: string) => `v0.${Number(m) + 1}.0`);
    const release = (await rows({ socketProxy: next })).find((r) => r.name === 'tecnativa/docker-socket-proxy')!;
    expect(release).toMatchObject({ state: 'behind', pin: SOCKET_PROXY_RELEASE, newest: next, where: SOCKET_PROXY_DOCKERFILE });
    // HAProxy: a patch of its line is behind, with Dependabot's note; another line is not this row's.
    const haproxy = async (tag: string) => (await rows({ 'library/haproxy': tag })).find((r) => r.name === 'haproxy')!;
    const patched = await haproxy(`${major}.${minor}.${patch + 1}${suffix}`);
    expect(patched).toMatchObject({ state: 'behind', pin: base.tag, newest: `${major}.${minor}.${patch + 1}${suffix}`, notes: [builtNote(SOCKET_PROXY_DOCKERFILE)] });
    expect(patched.where).toBe(`${SOCKET_PROXY_DOCKERFILE}, ${COMPOSE}`);
    expect(await haproxy(`${major}.${minor + 1}.0${suffix}`)).toMatchObject({ state: 'current', newest: base.tag });
    expect(await haproxy(`${major + 1}.0.0${suffix}`)).toMatchObject({ state: 'current', newest: base.tag });
    // Without its release line the row cannot say which release it is built from: an error, never current.
    const unnamed = REAL.read(SOCKET_PROXY_DOCKERFILE)!.replace(/^# docker-socket-proxy v[\d.]+\n/m, '');
    expect(unnamed).not.toBe(REAL.read(SOCKET_PROXY_DOCKERFILE));
    const row = (await routineRows(withFiles({ [SOCKET_PROXY_DOCKERFILE]: unnamed }), fakeNet(registry()))).rows.find((r) => r.name === 'tecnativa/docker-socket-proxy')!;
    expect(row.state).toBe('error');
    expect(row.error).toMatch(/names no docker-socket-proxy release/);
  });

  it('names the rule Stalwart moves by, in the summary issue, beside its line', async () => {
    const { rows, status } = await routineRows(REAL, fakeNet(registry({ 'stalwartlabs/stalwart': 'v0.16.999' })));
    const stalwart = rows.find((r) => r.name === 'stalwartlabs/stalwart')!;
    expect(stalwart).toMatchObject({ state: 'behind', newest: 'v0.16.999', notes: [STALWART_RULE] });
    const line = (summaryOf(rows, status).body ?? '').split('\n').find((l) => l.startsWith('- `stalwartlabs/stalwart`'));
    expect(line).toContain(`newest **v0.16.999**; ${STALWART_RULE}`);
    for (const doc of ['docs/stalwart-integration-fix.md', 'docs/adr/0022-imap-dependency-security-strategy.md']) {
      expect(REAL.read(doc), `${doc} is gone`).not.toBeNull();
    }
  });

  it("compares a pin with no number, held by its digest, with the digest its registry names for the tag today", async () => {
    const minio = readImages(MANAGED).find((i) => i.repo === 'chainguard/minio')!;
    expect(minio, 'managed.yml no longer pins chainguard/minio: move this case to the pin that has no number').toBeDefined();
    expect(minio.tag).toBe('latest');
    expect(minio.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const same = await routineRows(REAL, fakeNet(registry()));
    expect(same.rows.find((r) => r.name === 'chainguard/minio')).toMatchObject({
      pin: `latest@${minio.digest}`,
      newest: `latest@${minio.digest}`,
      state: 'current',
    });

    const moved = `sha256:${'e'.repeat(64)}`;
    const { rows, status } = await routineRows(REAL, fakeNet(registry({ 'chainguard/minio:latest': moved })));
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
    const { rows, status } = await routineRows(REAL, fakeNet(stubs));
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
    // The machines the job lands on: the self-hosted arm64 runner for a push; hosted amd64 AND arm64 for a
    // pull request, so the arm64 binary has run before the owner's machine runs it (review of 2026-11-01).
    type Job = { 'runs-on'?: unknown; strategy?: { 'fail-fast'?: unknown; matrix?: { runner?: unknown } } };
    const job = (parseYaml(ci) as { jobs: Record<string, Job> }).jobs['migration-lint'];
    expect(job?.['runs-on']).toBe('${{ matrix.runner }}');
    expect(job?.strategy?.['fail-fast']).toBe(false);
    expect(job?.strategy?.matrix?.runner).toBe(
      "${{ github.event_name == 'push' && fromJSON('[\"self-hosted\"]') || fromJSON('[\"ubuntu-24.04\",\"ubuntu-24.04-arm\"]') }}",
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

describe('the whole watch, one issue per row', () => {
  const everything = (): Net => {
    const base = registry();
    return fakeNet({
      ...base,
      json: [...base.json!, NODE_INDEX, ...taskImageRegistry(D26, '26.12.0')],
      text: [
        ...base.text!,
        [/triggerdotdev\/trigger\.dev\/.+\/docker\/docker-compose\.yml$/, `services:\n  clickhouse:\n    image: ${readImages(MANAGED).find((i) => i.repo === 'clickhouse/clickhouse-server')!.ref}\n`],
        [/SECURITY\.md$/, '| 26.2 | ❌ |\n'],
      ],
      bytes: [[/trigger\.dev-.+\.tgz$/, cliTarball(D26)]],
      lsRemote: { ...base.lsRemote, 'https://github.com/zitadel/zitadel.git': lsRemote(readPin(MANAGED)) },
      probe: () => '',
      npm: (args) => {
        const asked = args.join(' ');
        if (asked === 'view trigger.dev version') return '4.7.2\n';
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
    const broken: Net = { ...net, probe: async () => Promise.reject(new Error('ghcr.io is unreachable')) };
    const report = await watch(REAL, broken);
    const state = Object.fromEntries(report.issues.map((r) => [r.key, r.state]));
    expect(state.trigger).toBe('error');
    expect(state.clickhouse, 'it needs the Trigger.dev tag').toBe('error');
    expect(Object.keys(state).filter((key) => state[key] === 'error').sort()).toEqual(['clickhouse', 'trigger']);
    expect(table(report)).toContain('ghcr.io is unreachable');
    const { gh, calls } = fakeGh([{ number: 3, title: TITLES.trigger, body: 'x', state: 'open' }]);
    expect(keepIssue(report.issues[1]!, gh, TITLES.trigger)).toBe('untouched');
    expect(calls).toEqual([]);
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

// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN IMAGE NOBODY SCANNED: no container image the stacks run was ever looked
 * inside (workplan 0146 T8, the scan half, 2026-10-22).
 *
 * Security Scan ran Trivy with `scan-type: fs`, which reads the repository's
 * lockfiles and nothing else (0135 §1 said as much). So an operating system
 * past its end of life, or a CVE in an image whose tag never moved, was
 * reported by nothing. Trigger.dev's Redis, `redis:7-alpine`, runs on Alpine
 * 3.21, which leaves support on 2026-11-01, around when the Alpha opens; the
 * lifecycle survey of 2026-10-21 found it by reading release pages. The pin
 * watch says when a newer TAG exists. It cannot say what is inside the one
 * that runs.
 *
 * `.github/workflows/security-scan.yml` now scans every image the stacks run
 * once a week and on dispatch, on GitHub-hosted runners, with the list from
 * `scripts/image-scan.mjs`, which reads the compose files with the pin watch's
 * own reader (`readImages` in `scripts/idp-pin-watch.mjs`). It is REPORT
 * ONLY: findings go to code scanning and fail nothing. What fails the run is a
 * report that is missing, because a scan that did not happen reads exactly
 * like a week with nothing found (`a-scan-that-skipped-itself`).
 *
 * Three facts that are easy to get wrong, each held below:
 *
 *  - A SARIF category that stops being uploaded leaves its alerts open. So
 *    an image's name must not move when its pin does, nor when the two
 *    stacks' pins of one image meet on one reference or part again; and
 *    nothing here may read today's pins as literals, or the pull requests
 *    that move them turn this guard red.
 *
 *  - SARIF never says an operating system is past its end of life. Trivy's
 *    SARIF writer emits findings and the image's name only; the end of life is
 *    `.Metadata.OS.EOSL` in the JSON report and a log line. So the scan writes
 *    JSON, converts it to SARIF with `trivy convert`, and the report job reads
 *    the JSON: a `::warning::`, a summary line, and one issue per image.
 *  - The existing job's step names are matched by `indexOf` in
 *    `a-scan-that-skipped-itself`, and its first `runs-on: ${{` is read as the
 *    runner condition. The new jobs come after it, with names of their own and
 *    a plain `runs-on`.
 *
 * And an image no registry serves cannot be pulled to be scanned (#1675,
 * 2026-10-25). GoAccess's upstream image is on an Alpine past its end of life,
 * so `site-visits.sh` builds `localhost/goaccess` from
 * `deploy/compose/goaccess/Dockerfile`. A script's `localhost/<name>` image is
 * listed with the directory it is built from, its leg builds that directory
 * on the arm64 runner before Trivy reads it, and its name (`goaccess`, the
 * category and the issue) is the one the pulled image had, so the issue
 * closes on the first scan on main that reads the supported base. Only a run
 * on main keeps the issues (`ISSUES_REF`): a review found that the dispatch
 * this change asked for, on its own branch, would have closed #1675 before
 * the merge, while main and live still ran 3.20, and Monday's scan on main
 * would then have opened it again under a new number. And a pull request
 * that changes such a Dockerfile builds it
 * (`.github/workflows/script-images.yml`), with Dependabot's move of its base
 * in a pull request of its own: grouped with the apps' images, a new Alpine
 * line would have been merged on checks that never built it.
 *
 * The network is stubbed (the git tags, the Trigger.dev CLI's tarball) and so
 * is `gh`; the compose files and scripts are the real ones.
 */

import { describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { COMPOSE_FILES, readImages, repoReader, stepsUsing, type Net, type Repo } from './idp-pin-watch.mjs';
import {
  BUILT_HERE,
  ISSUE_PREFIX,
  ISSUES_REF,
  OWNPACE_IMAGES,
  SCRIPT_DIRS,
  OWNPACE_REGISTRY,
  SCAN_FILES,
  eoslIssue,
  imagesFromEnv,
  imagesToScan,
  isFloating,
  keepIssues,
  newestReleaseTag,
  readReport,
  stackOf,
  summarize,
  type ScanImage,
} from './image-scan.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL = repoReader(REPO_ROOT);
const WORKFLOW_FILE = '.github/workflows/security-scan.yml';
const WORKFLOW = readFileSync(join(REPO_ROOT, WORKFLOW_FILE), 'utf8');

// ------------------------------------------------------------- stubs -----

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

const TASK_BASE = `triggerdotdev/node:24-bookworm@sha256:${'d'.repeat(64)}`;
const CLI_TARBALL = tgz({
  'package/package.json': '{}',
  'package/dist/esm/deploy/buildImage.js': `export const BASE_IMAGE = {\n    node: "triggerdotdev/node:22-bookworm",\n    "node-24": "${TASK_BASE}",\n};\n`,
});

const lsRemote = (...tags: string[]) => tags.map((t, i) => `${i}\trefs/tags/${t}`).join('\n');
const TAGS = lsRemote('v0.1.0-rc.1', 'v0.2.0-alpha.1', 'v0.2.0-alpha.9', 'v0.2.0-alpha.10', 'not-a-release');

/** A network that answers only the CLI's tarball and the repository's tags, and records what it was asked. */
function fakeNet(tags = TAGS): Net & { asked: string[] } {
  const asked: string[] = [];
  const refuse = async (what: string | string[]): Promise<never> => {
    const url = String(what);
    asked.push(url);
    throw new Error(`nothing stubbed for ${url}`);
  };
  return {
    asked,
    json: refuse,
    text: refuse,
    bytes: async (url) => {
      asked.push(url);
      if (/\/trigger\.dev\/-\/trigger\.dev-\d+\.\d+\.\d+\.tgz$/.test(url)) return CLI_TARBALL;
      throw new Error(`nothing stubbed for ${url}`);
    },
    lsRemote: async (url) => {
      asked.push(url);
      return tags;
    },
    digest: refuse,
    npm: refuse,
    probe: refuse,
  };
}

/** The real checkout, with some files replaced. */
const withFiles = (over: Record<string, string>): Repo => ({
  read: (rel) => (Object.hasOwn(over, rel) ? over[rel]! : REAL.read(rel)),
  list: (rel) => REAL.list(rel),
});

/**
 * A literal image in a script, the shape `image-scan.mjs` reads
 * (`DB_ROLES_CLIENT_IMAGE='postgres:18-alpine'`); a computed one is not.
 */
const SCRIPT_LITERAL = /^\s*(?:readonly\s+|export\s+|local\s+)?(?:[A-Z][A-Z0-9_]*_)?IMAGE=(["'])([a-z0-9][^"'\s$]*)\1\s*(?:#.*)?$/m;

/**
 * `text` with every `image:` line of `repo` pinned to `ref`, and the file's
 * real lines read for it, never a literal of today's pin: the sibling pull
 * requests that move these pins must not turn this guard red, or let a case
 * pass on a replace that matched nothing.
 */
function repin(text: string, repo: string, ref: string): string {
  const lines = text.split('\n');
  const hits = readImages(text).filter((i) => i.repo === repo);
  expect(hits.length, `no image line of ${repo} to move`).toBeGreaterThan(0);
  for (const { line } of hits) lines[line - 1] = lines[line - 1]!.replace(/image:.*$/, `image: ${ref}`);
  const moved = lines.join('\n');
  expect(readImages(moved).filter((i) => i.repo === repo).map((i) => i.ref)).toEqual(hits.map(() => ref));
  return moved;
}

/** A Trivy image report, as `trivy image --format json` writes one. */
function trivyJson(os: Record<string, unknown> | null, vulns: Array<{ Severity: string; FixedVersion?: string }> = []) {
  return JSON.stringify({
    SchemaVersion: 2,
    ArtifactName: 'example',
    ArtifactType: 'container_image',
    Metadata: { ...(os ? { OS: os } : {}), ImageID: 'sha256:0' },
    Results: [{ Target: 'example', Class: 'os-pkgs', Vulnerabilities: vulns.map((v, i) => ({ VulnerabilityID: `CVE-0-${i}`, ...v })) }],
  });
}

type Issue = { number: number; title: string; body: string; state: 'open' | 'closed' };

/** A `gh` that answers `issue list` from `issues`, and records every other call. */
function fakeGh(issues: Issue[]) {
  const calls: string[][] = [];
  const gh = (args: string[]) => {
    if (args[0] === 'issue' && args[1] === 'list') {
      const fields = (args[args.indexOf('--json') + 1] ?? '').split(',');
      return JSON.stringify(
        issues.filter((i) => i.state === 'open').map((i) => Object.fromEntries(fields.map((f) => [f, i[f as keyof Issue]]))),
      );
    }
    calls.push(args);
    return '';
  };
  return { gh, calls };
}

// ------------------------------------------------------- what it scans ---

describe('which images it scans', () => {
  it('every image line of the compose files, resolved, with its digest where one is pinned', async () => {
    const images = await imagesToScan(REAL, fakeNet());
    const refs = new Set(images.map((i) => i.ref));
    const ownpace = `${OWNPACE_REGISTRY}/ownpace-`;
    expect(SCAN_FILES).toEqual([...COMPOSE_FILES, 'deploy/selfhost/compose.yml']);
    for (const file of SCAN_FILES) {
      for (const image of readImages(REAL.read(file)!)) {
        if (image.repo.startsWith(ownpace)) continue;
        expect(refs.has(image.ref), `${file}:${image.line} runs ${image.ref}, which nothing scans`).toBe(true);
        expect(image.ref, `${file}:${image.line} kept a \${VAR:-default}`).not.toContain('${');
      }
    }
    // The reader's resolution and digests, on the real lines.
    const trigger = readImages(REAL.read('deploy/compose/managed.yml')!).find((i) => i.repo === 'ghcr.io/triggerdotdev/trigger.dev')!;
    expect(refs.has(`ghcr.io/triggerdotdev/trigger.dev:${trigger.tag}`)).toBe(true);
    const pinned = SCAN_FILES.flatMap((file) => readImages(REAL.read(file)!)).filter((i) => i.digest);
    expect(pinned.length, 'no image line is pinned by digest, so nothing here shows a digest is kept').toBeGreaterThan(0);
    for (const image of pinned) expect(refs.has(`${image.repo}${image.tag ? `:${image.tag}` : ''}@${image.digest}`)).toBe(true);
  });

  it('the images the scripts name for themselves, and none twice', async () => {
    const images = await imagesToScan(REAL, fakeNet());
    const goaccess = /GOACCESS_IMAGE="([^"]+)"/.exec(REAL.read('deploy/compose/site-visits.sh')!)![1]!;
    const stalwart = /^IMAGE="([^"]+)"/m.exec(REAL.read('deploy/selfhost/setup-stalwart.sh')!)![1]!;
    expect(images.find((i) => i.ref === goaccess)?.name).toBe('goaccess');
    expect(images.find((i) => i.ref === stalwart)?.name).toBe('stalwart');
    // db-roles.sh's client is the compose file's postgres: one scan, both
    // places named, for as long as the script names it literally. Once it
    // reads it from managed.yml, as stand-up-live.sh does, it is not listed
    // on its own.
    const managedPostgres = readImages(REAL.read('deploy/compose/managed.yml')!).find((i) => i.repo === 'postgres')!;
    expect(images.find((i) => i.name === 'postgres-managed')?.ref).toBe(managedPostgres.ref);
    const dbRoles = REAL.read('deploy/compose/db-roles.sh')!;
    const client = SCRIPT_LITERAL.exec(dbRoles)?.[2];
    if (client) {
      expect(client, "db-roles.sh's client is not the postgres managed.yml runs").toBe(managedPostgres.ref);
      expect(images.find((i) => i.name === 'postgres-managed')?.where).toContain('deploy/compose/db-roles.sh');
    } else {
      expect(images.some((i) => i.where.includes('db-roles.sh'))).toBe(false);
    }
    // One scan per reference in each stack, and each from one stack only.
    const fromFiles = images.filter((i) => i.where.startsWith('deploy/'));
    for (const image of fromFiles) expect(new Set(image.where.split(', ').map(stackOf)).size, image.where).toBe(1);
    const key = (i: ScanImage) => `${stackOf(i.where.split(', ')[0]!)} ${i.ref}`;
    expect(new Set(fromFiles.map(key)).size).toBe(fromFiles.length);
    // A script that computes its image is not read as one.
    expect(images.some((i) => i.ref.includes('$'))).toBe(false);
    const computed = dbRoles.replace(SCRIPT_LITERAL, `DB_ROLES_CLIENT_IMAGE="$(sed -n 's/^ *image: *//p' managed.yml | head -n 1)"`);
    const without = await imagesToScan(withFiles({ 'deploy/compose/db-roles.sh': computed }), fakeNet());
    expect(without.some((i) => i.where.includes('db-roles.sh'))).toBe(false);
    expect(without.find((i) => i.name === 'postgres-managed')?.ref).toBe(managedPostgres.ref);
  });

  it('an image a script builds here (localhost/<name>) is listed with the directory its leg builds, and refused without a Dockerfile (#1675)', async () => {
    const images = await imagesToScan(REAL, fakeNet());
    const goaccess = images.find((i) => i.name === 'goaccess')!;
    expect(goaccess.ref, 'GoAccess is pulled from a registry again').toMatch(new RegExp(`^${BUILT_HERE.replace('.', '\\.')}goaccess:`));
    expect(goaccess.context).toBe('deploy/compose/goaccess');
    expect(goaccess.floating, "its pins are its Dockerfile's").toBe(false);
    expect(REAL.read(`${goaccess.context}/Dockerfile`)).toMatch(/^FROM /m);
    // Every other image is pulled, and carries no context.
    for (const image of images.filter((i) => !i.ref.startsWith(BUILT_HERE))) expect(image.context, image.name).toBeUndefined();
    // The same name, its category and its issue, whether pulled or built: a reference moved
    // from a registry to localhost keeps `goaccess`.
    const script = REAL.read('deploy/compose/site-visits.sh')!;
    const pulled = script.replace(/^GOACCESS_IMAGE="[^"]+"$/m, 'GOACCESS_IMAGE="allinurl/goaccess:1.12@sha256:' + '9'.repeat(64) + '"');
    expect(pulled).not.toBe(script);
    const before = (await imagesToScan(withFiles({ 'deploy/compose/site-visits.sh': pulled }), fakeNet())).find((i) => i.name === 'goaccess');
    expect(before?.context).toBeUndefined();
    // A localhost image with nothing to build it from is refused, never left out.
    const missing: Repo = { read: (rel) => (rel === 'deploy/compose/goaccess/Dockerfile' ? null : REAL.read(rel)), list: REAL.list };
    await expect(imagesToScan(missing, fakeNet())).rejects.toThrow(/deploy\/compose\/goaccess\/Dockerfile, which is not in this checkout/);
  });

  it("the tasks' base image, as the pinned CLI names it for the runtime trigger.config.ts asks for", async () => {
    const net = fakeNet();
    const images = await imagesToScan(REAL, net);
    const cli = JSON.parse(REAL.read('apps/worker/package.json')!).dependencies['@trigger.dev/sdk'] as string;
    expect(images.find((i) => i.name === 'trigger-task-base')).toMatchObject({ ref: TASK_BASE, where: expect.stringContaining(cli) });
    expect(net.asked).toContain(`https://registry.npmjs.org/trigger.dev/-/trigger.dev-${cli}.tgz`);
  });

  it("Ownpace's three images at :edge and at the newest release tag, as images.yml publishes them", async () => {
    const net = fakeNet();
    const images = await imagesToScan(REAL, net, { upstream: 'https://github.com/example/repo.git' });
    expect(net.asked).toContain('https://github.com/example/repo.git');
    for (const image of OWNPACE_IMAGES) {
      expect(images.find((i) => i.name === `ownpace-${image}-edge`)?.ref).toBe(`${OWNPACE_REGISTRY}/ownpace-${image}:edge`);
      // SemVer order: alpha.10 after alpha.9, and the v dropped as metadata-action drops it.
      expect(images.find((i) => i.name === `ownpace-${image}-release`)?.ref).toBe(`${OWNPACE_REGISTRY}/ownpace-${image}:0.2.0-alpha.10`);
    }
    // The three are images.yml's matrix, published under this registry, and the appliance's default.
    const images_yml = parseYaml(REAL.read('.github/workflows/images.yml')!) as { jobs: Record<string, { strategy?: { matrix?: { image?: string[] } } }> };
    const matrix = Object.values(images_yml.jobs).find((j) => j.strategy?.matrix?.image)?.strategy?.matrix?.image;
    expect(matrix).toEqual(OWNPACE_IMAGES);
    const selfhost = readImages(REAL.read('deploy/selfhost/compose.yml')!).find((i) => i.repo.endsWith('/ownpace-selfhost'));
    expect(selfhost?.ref).toBe(`${OWNPACE_REGISTRY}/ownpace-selfhost:edge`);
  });

  it('orders release tags by SemVer: a pre-release before its release, and no tag means no list', () => {
    expect(newestReleaseTag(lsRemote('v0.2.0-alpha.2', 'v0.2.0', 'v0.2.0-rc.1'))).toBe('0.2.0');
    expect(newestReleaseTag(lsRemote('v0.2.0-alpha.9', 'v0.2.0-alpha.10'))).toBe('0.2.0-alpha.10');
    expect(() => newestReleaseTag(lsRemote('latest', 'edge'))).toThrow(/no v\* release tag/);
  });

  it("leaves out the Dockerfiles' FROM bases, which are inside Ownpace's images, but scans www.yml's nginx, which runs as it is", async () => {
    const images = await imagesToScan(REAL, fakeNet());
    for (const dockerfile of ['apps/api/Dockerfile', 'apps/selfhost/Dockerfile']) {
      const from = /^FROM\s+(node:\S+)/m.exec(REAL.read(dockerfile)!)![1]!;
      expect(images.some((i) => i.ref === from), `${from} is scanned twice`).toBe(false);
    }
    const www = readImages(REAL.read('deploy/compose/www.yml')!).find((i) => i.repo === 'nginx')!;
    expect(images.find((i) => i.ref === www.ref)?.where).toBe('deploy/compose/www.yml');
  });

  it('names each image once, with its stack only where both stacks run that name', async () => {
    const images = await imagesToScan(REAL, fakeNet());
    expect(new Set(images.map((i) => i.name)).size).toBe(images.length);
    for (const image of images) expect(image.name).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    const redis = readImages(REAL.read('deploy/compose/managed.yml')!).find((i) => i.repo === 'redis')!;
    expect(images.find((i) => i.ref === redis.ref)?.name).toBe('redis');
    expect(images.filter((i) => i.name.startsWith('postgres')).map((i) => i.name).sort()).toEqual(['postgres-managed', 'postgres-selfhost']);
    expect(stackOf('deploy/compose/managed.yml')).toBe('managed');
    expect(stackOf('deploy/compose/www.yml')).toBe('managed');
    expect(stackOf('deploy/compose/site-visits.sh')).toBe('managed');
    expect(stackOf('deploy/selfhost/compose.yml')).toBe('selfhost');
    expect(stackOf('deploy/selfhost/setup-stalwart.sh')).toBe('selfhost');
    expect(() => stackOf('deploy/elsewhere/compose.yml')).toThrow(/no stack/);
  });

  it('keeps every name when a pin moves, so its SARIF category and its issue stay the same', async () => {
    const managedYml = REAL.read('deploy/compose/managed.yml')!;
    const pgbouncer = readImages(managedYml).find((i) => i.repo === 'edoburu/pgbouncer')!;
    const to = `${pgbouncer.repo}:v99.0.0-p0`;
    expect(to, 'the pin would not move, so this case would prove nothing').not.toBe(pgbouncer.ref);
    const before = await imagesToScan(REAL, fakeNet());
    const moved = await imagesToScan(withFiles({ 'deploy/compose/managed.yml': repin(managedYml, pgbouncer.repo, to) }), fakeNet());
    expect(moved.find((i) => i.ref === to)?.name).toBe(before.find((i) => i.ref === pgbouncer.ref)?.name);
    expect(moved.map((i) => i.name)).toEqual(before.map((i) => i.name));
  });

  it("keeps both stacks' names when their pins meet on one reference, and when they part again", async () => {
    const selfhostYml = REAL.read('deploy/selfhost/compose.yml')!;
    const selfhost = readImages(selfhostYml).find((i) => i.repo === 'postgres')!;
    // The managed stack's postgres everywhere it is named, on the appliance's reference.
    const meet = (ref: string) => {
      const dbRoles = REAL.read('deploy/compose/db-roles.sh')!;
      return {
        'deploy/compose/managed.yml': repin(REAL.read('deploy/compose/managed.yml')!, 'postgres', ref),
        'deploy/compose/dev.yml': repin(REAL.read('deploy/compose/dev.yml')!, 'postgres', ref),
        'deploy/compose/db-roles.sh': dbRoles.replace(SCRIPT_LITERAL, (line, quote: string, old: string) => line.replace(old, ref)),
      };
    };
    const postgres = (list: ScanImage[]) => list.filter((i) => i.name.startsWith('postgres')).map((i) => [i.name, i.ref]).sort();
    const met = await imagesToScan(withFiles(meet(selfhost.ref)), fakeNet());
    expect(postgres(met)).toEqual([['postgres-managed', selfhost.ref], ['postgres-selfhost', selfhost.ref]]);
    const parted = await imagesToScan(withFiles({ ...meet(selfhost.ref), 'deploy/selfhost/compose.yml': repin(selfhostYml, 'postgres', 'postgres:99-alpine') }), fakeNet());
    expect(postgres(parted)).toEqual([['postgres-managed', selfhost.ref], ['postgres-selfhost', 'postgres:99-alpine']]);
    // One stack running two references of one name: the first read keeps the
    // name, the other is named apart by its file, and neither shares a category.
    const split = { 'deploy/compose/dev.yml': repin(REAL.read('deploy/compose/dev.yml')!, 'postgres', 'postgres:99-alpine') };
    const apart = await imagesToScan(withFiles(split), fakeNet());
    const managedPostgres = readImages(REAL.read('deploy/compose/managed.yml')!).find((i) => i.repo === 'postgres')!;
    expect(postgres(apart)).toEqual(
      [['postgres-managed', managedPostgres.ref], ['postgres-managed-dev', 'postgres:99-alpine'], ['postgres-selfhost', selfhost.ref]].sort(),
    );
  });

  it('says which tags float, since those are scanned as the registry serves them today', () => {
    expect(isFloating({ tag: '7-alpine', digest: '' })).toBe(true);
    expect(isFloating({ tag: '1.38', digest: '' })).toBe(true);
    expect(isFloating({ tag: 'v1.25.2-p0', digest: '' })).toBe(false);
    expect(isFloating({ tag: '1.12', digest: 'sha256:0' })).toBe(false);
  });

  it('refuses rather than lists less: a CLI it cannot read, or no release tag', async () => {
    const broken: Net = { ...fakeNet(), bytes: async () => Promise.reject(new Error('registry.npmjs.org answered 503')) };
    await expect(imagesToScan(REAL, broken)).rejects.toThrow(/503/);
    await expect(imagesToScan(REAL, fakeNet(lsRemote('edge')))).rejects.toThrow(/no v\* release tag/);
  });
});

// ----------------------------------------------------------- reports -----

describe('what a report says', () => {
  it('reads the end of life from the JSON, where SARIF never carries it', () => {
    expect(readReport(trivyJson({ Family: 'alpine', Name: '3.18.12', EOSL: true }))).toMatchObject({ os: 'alpine 3.18.12', eosl: true });
    // Trivy leaves EOSL out while the distribution still supports the release.
    expect(readReport(trivyJson({ Family: 'alpine', Name: '3.21.9' }))).toMatchObject({ os: 'alpine 3.21.9', eosl: false });
    expect(readReport(trivyJson(null))).toMatchObject({ os: null, eosl: false });
  });

  it('counts the findings of each severity, and those a newer package fixes', () => {
    const report = readReport(
      trivyJson({ Family: 'debian', Name: '12.11' }, [
        { Severity: 'CRITICAL', FixedVersion: '1.2' },
        { Severity: 'HIGH' },
        { Severity: 'HIGH', FixedVersion: '3.4' },
      ]),
    );
    expect(report).toEqual({ os: 'debian 12.11', eosl: false, critical: 1, high: 2, fixable: 2 });
  });

  it('never reads something that is not a Trivy image report as one without findings', () => {
    expect(() => readReport('')).toThrow(/not JSON/);
    expect(() => readReport('{}')).toThrow(/not a Trivy image report/);
    expect(() => readReport(JSON.stringify({ SchemaVersion: 2, ArtifactType: 'filesystem' }))).toThrow(/not a Trivy image report/);
  });
});

const IMAGES: ScanImage[] = [
  { name: 'redis', ref: 'redis:7-alpine', where: 'deploy/compose/managed.yml', floating: true },
  { name: 'minio', ref: `bitnamilegacy/minio:2025.5.24-debian-12-r5@sha256:${'4'.repeat(64)}`, where: 'deploy/compose/managed.yml', floating: false },
  { name: 'caddy', ref: 'caddy:2-alpine', where: 'deploy/compose/managed.yml', floating: true },
];
const reports = (files: Record<string, string>) => (name: string) => files[name] ?? null;

describe('the report job', () => {
  it('fails on a missing, empty or unreadable report, and says which image it was', () => {
    const summary = summarize(
      IMAGES,
      reports({ 'trivy-image-redis.json': trivyJson({ Family: 'alpine', Name: '3.21.9' }), 'trivy-image-minio.json': '' }),
    );
    expect(summary.missing.map((m) => m.image.name)).toEqual(['minio', 'caddy']);
    expect(summary.annotations.filter((a) => a.startsWith('::error::'))).toHaveLength(2);
    expect(summary.lines.join('\n')).toContain('2 without a report');
  });

  it('exits 1 from the command line when a report is missing, and 0 once every image has one', () => {
    // The step's own exit code is what turns the run red when a leg passed
    // but its report never reached this job (a download that failed, an
    // artifact gone). No --issue, so no gh; no GITHUB_STEP_SUMMARY, so a CI
    // run of this guard writes nothing into its own summary.
    const dir = mkdtempSync(join(tmpdir(), 'image-scan-report-'));
    try {
      const run = () =>
        spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/image-scan.mjs'), 'report', dir], {
          encoding: 'utf8',
          env: { PATH: process.env.PATH, IMAGES: JSON.stringify(IMAGES) },
        });
      const none = run();
      expect(none.status, none.stderr).toBe(1);
      for (const image of IMAGES) expect(none.stdout).toMatch(new RegExp(`^::error::${image.name}: `, 'm'));
      for (const image of IMAGES) writeFileSync(join(dir, `trivy-image-${image.name}.json`), trivyJson({ Family: 'alpine', Name: '3.23.3' }));
      const all = run();
      expect(all.status, all.stderr).toBe(0);
      expect(all.stdout).not.toContain('::error::');
      expect(all.stdout).toContain('3 listed, 3 scanned, 0 past their end of life, 0 without a report');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns, and says so in the summary, for an image past its end of life; findings alone warn nothing', () => {
    const summary = summarize(
      IMAGES,
      reports({
        'trivy-image-redis.json': trivyJson({ Family: 'alpine', Name: '3.21.9', EOSL: true }),
        'trivy-image-minio.json': trivyJson({ Family: 'debian', Name: '12.11' }, [{ Severity: 'CRITICAL', FixedVersion: '2' }]),
        'trivy-image-caddy.json': trivyJson({ Family: 'alpine', Name: '3.23.3' }),
      }),
    );
    expect(summary.missing).toEqual([]);
    expect(summary.annotations).toHaveLength(1);
    expect(summary.annotations[0]).toMatch(/^::warning::redis: .*alpine 3\.21\.9, past its end of life/);
    const table = summary.lines.join('\n');
    expect(table).toMatch(/\| `redis` \| `redis:7-alpine` \(floats\) \| alpine 3\.21\.9 \| \*\*past its end of life\*\* \|/);
    expect(table).toMatch(/\| `minio` \| `bitnamilegacy\/minio:2025\.5\.24-debian-12-r5@sha256:444444444444…` \| debian 12\.11 \| supported \| 1 \| 0 \| 1 \|/);
  });

  it('says which image was built here, and routes its issue to the Dockerfile rather than to a tag upstream moves', () => {
    const built: ScanImage = { name: 'goaccess', ref: 'localhost/goaccess:1.12', where: 'deploy/compose/site-visits.sh', floating: false, context: 'deploy/compose/goaccess' };
    const summary = summarize([built], reports({ 'trivy-image-goaccess.json': trivyJson({ Family: 'alpine', Name: '3.24.3' }) }));
    expect(summary.missing).toEqual([]);
    expect(summary.lines.join('\n')).toMatch(/\| `goaccess` \| `localhost\/goaccess:1\.12` \(built from `deploy\/compose\/goaccess`\) \| alpine 3\.24\.3 \| supported \|/);
    const issue = eoslIssue(built, readReport(trivyJson({ Family: 'alpine', Name: '3.20.10', EOSL: true })));
    expect(issue.state).toBe('behind');
    expect(issue.body).toContain('`deploy/compose/goaccess/Dockerfile`');
    expect(issue.body).toContain('dependabot.yml');
    expect(issue.body, 'Dependabot moves a new line of the base too').not.toMatch(/within its line/);
    expect(issue.body, 'a built image has no upstream tag to wait for').not.toContain('idp-pin-watch.yml');
    expect(issue.body).not.toContain('serves today');
    expect(eoslIssue(built, readReport(trivyJson({ Family: 'alpine', Name: '3.24.3' }))).state).toBe('current');
  });

  it('reads the image list the list job handed on, and refuses an empty one', () => {
    expect(imagesFromEnv(JSON.stringify(IMAGES))).toEqual(IMAGES);
    expect(() => imagesFromEnv('[]')).toThrow(/no image/);
    expect(() => imagesFromEnv(undefined)).toThrow(/not the JSON/);
  });
});

describe('one issue per image past its end of life', () => {
  const eosl = trivyJson({ Family: 'alpine', Name: '3.21.9', EOSL: true });
  const fine = trivyJson({ Family: 'alpine', Name: '3.23.3' });
  const all = (redis: string) =>
    reports({ 'trivy-image-redis.json': redis, 'trivy-image-minio.json': fine, 'trivy-image-caddy.json': fine });

  it('opens one, under the image name, with the reference, the operating system and the route', () => {
    const { gh, calls } = fakeGh([]);
    keepIssues(IMAGES, summarize(IMAGES, all(eosl)), gh);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 4)).toEqual(['issue', 'create', '--title', `${ISSUE_PREFIX}redis`]);
    const body = calls[0]![5]!;
    expect(body).toContain('`redis:7-alpine`');
    expect(body).toContain('**alpine 3.21.9**');
    expect(body).toContain('idp-pin-watch.yml');
    expect(body).toContain('serves today');
  });

  it('closes it once the scan reads a supported release, and leaves every other issue alone', () => {
    const open: Issue = { number: 12, title: `${ISSUE_PREFIX}redis`, body: 'old', state: 'open' };
    const other: Issue = { number: 13, title: 'Pins Dependabot cannot see are behind', body: 'x', state: 'open' };
    const { gh, calls } = fakeGh([open, other]);
    keepIssues(IMAGES, summarize(IMAGES, all(fine)), gh);
    expect(calls).toEqual([['issue', 'close', '12', '--comment', expect.stringContaining('supports')]]);
  });

  it('touches nothing for an image without a report, and closes no stray while any report is missing', () => {
    const open: Issue = { number: 12, title: `${ISSUE_PREFIX}redis`, body: 'old', state: 'open' };
    const stray: Issue = { number: 14, title: `${ISSUE_PREFIX}gone`, body: 'old', state: 'open' };
    const { gh, calls } = fakeGh([open, stray]);
    keepIssues(IMAGES, summarize(IMAGES, reports({ 'trivy-image-minio.json': fine })), gh);
    expect(calls).toEqual([]);
  });

  it('closes the issue of an image no longer scanned, once every listed image was read', () => {
    const stray: Issue = { number: 14, title: `${ISSUE_PREFIX}gone`, body: 'old', state: 'open' };
    const { gh, calls } = fakeGh([stray]);
    keepIssues(IMAGES, summarize(IMAGES, all(fine)), gh);
    expect(calls).toEqual([['issue', 'close', '14', '--comment', expect.stringContaining('No image of this name')]]);
  });

  it('keeps them from a run on main only: a run dispatched on a branch says what it found and touches no issue', () => {
    // From the command line, with a `gh` on the PATH that records what it is
    // asked and answers `issue list` with none open.
    const dir = mkdtempSync(join(tmpdir(), 'image-scan-issues-'));
    try {
      writeFileSync(join(dir, 'trivy-image-redis.json'), eosl);
      writeFileSync(join(dir, 'trivy-image-minio.json'), fine);
      writeFileSync(join(dir, 'trivy-image-caddy.json'), fine);
      const bin = join(dir, 'bin');
      const calls = join(dir, 'gh-calls');
      const summary = join(dir, 'summary.md');
      mkdirSync(bin);
      writeFileSync(join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$*" >>'${calls}'\nif [ "$1 $2" = "issue list" ]; then echo '[]'; fi\n`);
      chmodSync(join(bin, 'gh'), 0o755);
      const run = (ref: string | undefined) => {
        rmSync(calls, { force: true });
        writeFileSync(summary, '');
        const env: Record<string, string> = { PATH: `${bin}:${process.env.PATH}`, IMAGES: JSON.stringify(IMAGES), GITHUB_STEP_SUMMARY: summary };
        if (ref !== undefined) env.GITHUB_REF = ref;
        const r = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/image-scan.mjs'), 'report', dir, '--issue'], { encoding: 'utf8', env });
        return { ...r, calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [], summary: readFileSync(summary, 'utf8') };
      };
      expect(ISSUES_REF).toBe('refs/heads/main');
      for (const ref of ['refs/heads/claude/ownpace-public-readiness-y7orc6-goaccess-eol', 'refs/heads/release-gate/v0.2.0-alpha.3', 'refs/tags/v0.2.0-alpha.3', '', undefined]) {
        const branch = run(ref);
        expect(branch.status, branch.stderr).toBe(0);
        expect(branch.calls, `a run on ${ref} kept an issue`).toEqual([]);
        expect(branch.stdout).toMatch(/^::warning::redis: /m);
        expect(branch.stdout).toContain('Issues are kept by a run on main only.');
        expect(branch.summary).toContain(`This run is on ${ref || 'no ref'}, so no issue was opened, updated or closed.`);
      }
      const main = run(ISSUES_REF);
      expect(main.status, main.stderr).toBe(0);
      expect(main.calls.filter((c) => c.startsWith('issue create')), main.calls.join('\n')).toHaveLength(1);
      expect(main.stdout).toContain('issue, redis: opened');
      expect(main.summary).not.toContain('Issues are kept by a run on main only.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says in a comment when the image moved and is still past its end of life', () => {
    const before = eoslIssue(IMAGES[0]!, readReport(eosl)).body!;
    const open: Issue = { number: 12, title: `${ISSUE_PREFIX}redis`, body: before, state: 'open' };
    const moved = [{ ...IMAGES[0]!, ref: 'redis:7.4-alpine' }, IMAGES[1]!, IMAGES[2]!];
    const { gh, calls } = fakeGh([open]);
    keepIssues(moved, summarize(moved, all(eosl)), gh);
    expect(calls.map((c) => c.slice(0, 2))).toEqual([['issue', 'edit'], ['issue', 'comment']]);
  });
});

// ---------------------------------------------------------- the workflow -

type Step = { name?: string; id?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown>; 'continue-on-error'?: unknown };
type Job = {
  name?: string;
  if?: string;
  needs?: string | string[];
  'runs-on': string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  env?: Record<string, string>;
  strategy?: { 'fail-fast'?: boolean; matrix?: Record<string, unknown> };
  steps: Step[];
};
const workflow = parseYaml(WORKFLOW) as { jobs: Record<string, Job> };
// A dispatch scans the images unless it says not to: the Release workflow
// dispatches this file twice per release (on the commit, then on the tag) and
// passes `image_scans: false`, so its runs are the repository scan alone
// (workplan 0146, Status of 2026-10-23). A hand dispatch keeps the default.
const SCHEDULE_OR_DISPATCH = "github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.image_scans)";

describe(`${WORKFLOW_FILE}: the image scan`, () => {
  const list = workflow.jobs['image-list'];
  const scan = workflow.jobs['image-scan'];
  const report = workflow.jobs['image-scan-report'];

  it('has the three jobs, after the existing one, which keeps its name and its first place', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['security-scan', 'image-list', 'image-scan', 'image-scan-report']);
    expect(workflow.jobs['security-scan']!.name).toBe('security-scan');
  });

  it('runs only on the weekly schedule and on dispatch, so pull requests and the required check are untouched', () => {
    for (const job of [list, scan, report]) expect(job?.if ?? '').toContain(SCHEDULE_OR_DISPATCH);
    const on = (parseYaml(WORKFLOW) as { on: { workflow_dispatch: { inputs: Record<string, unknown> } } }).on;
    expect(on.workflow_dispatch.inputs.image_scans).toMatchObject({ type: 'boolean', default: true });
    expect(report?.if).toMatch(/^always\(\) && \(/);
    expect(report?.if).toContain("needs.image-list.result == 'success'");
  });

  it('runs on a GitHub-hosted runner, never on the machine whose images it scans', () => {
    for (const job of [list, report]) expect(job?.['runs-on']).toBe('ubuntu-24.04');
    // A leg that builds its image builds it natively, for the platform scanned.
    expect(scan?.['runs-on']).toBe("${{ matrix.context && 'ubuntu-24.04-arm' || 'ubuntu-24.04' }}");
  });

  it('may do what each job needs, and nothing else', () => {
    expect(list?.permissions).toEqual({ contents: 'read' });
    expect(scan?.permissions).toEqual({ contents: 'read', 'security-events': 'write' });
    expect(report?.permissions).toEqual({ contents: 'read', issues: 'write' });
  });

  it('takes its matrix from the list, keeps going past one image that fails, and scans the platform the stacks run', () => {
    const run = list!.steps.find((s) => s.id === 'list')!;
    expect(run.run?.trim()).toBe('node scripts/image-scan.mjs list >> "$GITHUB_OUTPUT"');
    expect(list!.outputs?.images).toBe('${{ steps.list.outputs.images }}');
    expect(scan!.needs).toBe('image-list');
    expect(scan!.strategy?.['fail-fast']).toBe(false);
    expect(scan!.strategy?.matrix).toEqual({ include: '${{ fromJSON(needs.image-list.outputs.images) }}' });
    expect(scan!.env).toEqual({ TRIVY_PLATFORM: 'linux/arm64', TRIVY_IMAGE_SRC: "${{ matrix.context && 'docker' || 'remote' }}" });
  });

  it('builds an image a script builds here, on its leg only and before Trivy, under the reference the script runs (#1675)', () => {
    const trivy = scan!.steps.findIndex((s) => s.uses?.startsWith('aquasecurity/trivy-action@'));
    const built = scan!.steps.filter((s) => s.if === 'matrix.context');
    expect(built, 'no step builds the image of a context leg').toHaveLength(2);
    for (const step of built) expect(scan!.steps.indexOf(step), 'a build step after the scan').toBeLessThan(trivy);
    expect(scan!.steps.slice(trivy).some((s) => s.if?.includes('matrix.context')), 'a build step after the scan').toBe(false);
    expect(built[0]!.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
    expect(built[0]!.with?.['persist-credentials']).toBe(false);
    expect(built[1]!.env).toEqual({ CONTEXT: '${{ matrix.context }}', REF: '${{ matrix.ref }}' });
    expect(built[1]!.run).toMatch(/^set -euo pipefail$/m);
    expect(built[1]!.run).toContain('docker build --pull --platform "$TRIVY_PLATFORM" --tag "$REF" "$CONTEXT"');
    // Every other step runs on every leg.
    expect(scan!.steps.filter((s) => s.if && s.if !== 'always()' && s !== built[0] && s !== built[1])).toEqual([]);
  });

  it('runs the same pinned trivy-action and the same named Trivy as the existing scan, as JSON, report only', () => {
    const [existing, image] = stepsUsing(WORKFLOW, 'aquasecurity/trivy-action');
    expect(image, 'the image scan runs no trivy-action').toBeDefined();
    expect(image!.sha).toBe(existing!.sha);
    expect(image!.with).toMatchObject({
      version: existing!.with.version,
      'scan-type': 'image',
      'image-ref': '${{ matrix.ref }}',
      format: 'json',
      output: 'trivy-image-${{ matrix.name }}.json',
      'exit-code': '0',
      // Vulnerabilities only: Trivy's default adds its secret scanner, whose
      // hits would reach code scanning while the report counts none of them.
      scanners: 'vuln',
      // Off: the legs start together, so the action's daily cache would only
      // add a failed save, and a warning, to every leg but one.
      cache: 'false',
    });
    const step = scan!.steps.find((s) => s.uses?.startsWith('aquasecurity/trivy-action@'))!;
    expect(step['continue-on-error'], 'a failed scan must fail its leg').toBeUndefined();
  });

  it('turns the JSON into SARIF and uploads it under a category of its own per image', () => {
    const convert = scan!.steps.find((s) => s.run?.includes('trivy convert'))!;
    expect(convert.run).toMatch(/trivy convert --format sarif --output "trivy-image-\$\{NAME\}\.sarif" "trivy-image-\$\{NAME\}\.json"/);
    const upload = scan!.steps.find((s) => s.uses?.startsWith('github/codeql-action/upload-sarif@'))!;
    expect(upload.id).toBe('image_upload');
    expect(upload.with).toMatchObject({ sarif_file: 'trivy-image-${{ matrix.name }}.sarif', category: 'trivy-image-${{ matrix.name }}' });
    const keep = scan!.steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'))!;
    expect(keep.with).toMatchObject({ name: 'trivy-image-${{ matrix.name }}', path: 'trivy-image-${{ matrix.name }}.json', 'if-no-files-found': 'error' });
  });

  it('each leg asserts its own report: the scan, a non-empty JSON and SARIF, and the upload', () => {
    const check = scan!.steps.at(-1)!;
    expect(check.if).toBe('always()');
    expect(check.env).toMatchObject({
      TRIVY_OUTCOME: '${{ steps.image_trivy.outcome }}',
      UPLOAD_OUTCOME: '${{ steps.image_upload.outcome }}',
    });
    expect(check.run).toMatch(/\[ ! -s "\$JSON" \]/);
    expect(check.run).toMatch(/\[ ! -s "\$SARIF" \]/);
    expect(check.run).toContain('::error::');
    expect(check.run).toContain('exit 1');
  });

  it('the report job reads every report, keeps the issues (from main only, in the script), and fails on a missing one', () => {
    const run = report!.steps.find((s) => s.run?.includes('image-scan.mjs report'))!;
    expect(run.run?.trim()).toBe('node scripts/image-scan.mjs report image-reports --issue');
    expect(run.if).toBe('always()');
    expect(run.env).toMatchObject({
      GH_TOKEN: '${{ github.token }}',
      IMAGES: '${{ needs.image-list.outputs.images }}',
    });
    const download = report!.steps.find((s) => s.uses?.startsWith('actions/download-artifact@'))!;
    expect(download.with).toMatchObject({ pattern: 'trivy-image-*', path: 'image-reports', 'merge-multiple': true });
    for (const job of [list, report]) {
      const checkout = job!.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
      expect(checkout?.with?.['persist-credentials']).toBe(false);
    }
  });

  it("names no step the way the existing job does, since a-scan-that-skipped-itself finds them by indexOf", () => {
    const existing = new Set(workflow.jobs['security-scan']!.steps.map((s) => s.name).filter(Boolean));
    for (const job of [list, scan, report]) {
      for (const step of job!.steps) {
        if (step.name) expect(existing.has(step.name), `${step.name} repeats a step name of security-scan`).toBe(false);
      }
    }
    // And the first `runs-on: ${{` is still the existing job's.
    expect(WORKFLOW.indexOf('runs-on: ${{')).toBeLessThan(WORKFLOW.indexOf('  image-list:'));
  });
});

// ------------------------------------- an image a script builds, on its PR -

describe('an image a script builds is built on the pull request that changes it (#1675)', () => {
  const FILE = '.github/workflows/script-images.yml';
  const text = readFileSync(join(REPO_ROOT, FILE), 'utf8');
  const wf = parseYaml(text) as {
    on: Record<string, { paths?: string[]; branches?: string[] } | null>;
    permissions?: Record<string, string>;
    jobs: Record<string, Job & { 'timeout-minutes'?: number; strategy?: { 'fail-fast'?: boolean; matrix?: { context?: string[] } } }>;
  };
  // Every directory a script beside it builds a `localhost/<name>` image from:
  // its literal `…IMAGE="localhost/<name>:…"`, the assignment image-scan.mjs
  // reads. A directory a compose file builds holds a Dockerfile too, and is
  // built on its pull request by images.yml, not here.
  const contexts = [
    ...new Set(
      SCRIPT_DIRS.flatMap((dir) =>
        readdirSync(join(REPO_ROOT, dir))
          .filter((n) => n.endsWith('.sh'))
          .flatMap((n) =>
            [...readFileSync(join(REPO_ROOT, dir, n), 'utf8').matchAll(/^\s*(?:readonly\s+|export\s+|local\s+)?(?:[A-Z][A-Z0-9_]*_)?IMAGE=(["'])localhost\/([a-z0-9][a-z0-9._-]*)[:@]/gm)].map(
              (m) => `${dir}/${m[2]}`,
            ),
          ),
      ),
    ),
  ].sort();

  it('finds the one there is, so the checks below are not vacuous', () => {
    expect(contexts).toContain('deploy/compose/goaccess');
    for (const context of contexts) expect(existsSync(join(REPO_ROOT, context, 'Dockerfile')), `${context}/Dockerfile`).toBe(true);
  });

  it('runs on a pull request that changes one of them, and on nothing else', () => {
    expect(Object.keys(wf.on)).toEqual(['pull_request']);
    expect(wf.on.pull_request?.branches, "no `branches:` filter (ci.yml's trigger block says why)").toBeUndefined();
    const paths = wf.on.pull_request?.paths ?? [];
    for (const context of contexts) expect(paths, `${context} is built by a script and not on its pull request`).toContain(`${context}/**`);
    expect(paths).toContain(FILE);
  });

  it('builds every one of them, natively on arm64, from a checkout that keeps no credential, pushing nothing', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    const jobs = Object.values(wf.jobs);
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job['runs-on']).toBe('ubuntu-24.04-arm');
    expect(job.permissions, 'the workflow grants contents: read and no job widens it').toBeUndefined();
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(job.strategy?.['fail-fast']).toBe(false);
    expect([...(job.strategy?.matrix?.context ?? [])].sort()).toEqual(contexts);
    const checkout = job.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
    expect(checkout?.with?.['persist-credentials']).toBe(false);
    const build = job.steps.find((s) => s.run?.includes('docker build'))!;
    expect(build.env).toEqual({ CONTEXT: '${{ matrix.context }}' });
    expect(build.run).toMatch(/^set -euo pipefail$/m);
    expect(build.run).toMatch(/docker build --pull --progress=plain --platform linux\/arm64 --tag "\$ref" "\$CONTEXT"/);
    expect(text, 'a build here pushes nothing and logs in nowhere').not.toMatch(/--push|docker login|login-action|secrets\./);
  });

  it("Dependabot moves each one's base in a pull request of its own, which that build covers", () => {
    type Update = { 'package-ecosystem': string; directory?: string; directories?: string[]; groups?: unknown; 'commit-message'?: { prefix?: string } };
    const updates = (parseYaml(readFileSync(join(REPO_ROOT, '.github/dependabot.yml'), 'utf8')) as { updates: Update[] }).updates;
    const docker = updates.filter((u) => u['package-ecosystem'] === 'docker');
    for (const context of contexts) {
      const entries = docker.filter((u) => [...(u.directories ?? []), ...(u.directory ? [u.directory] : [])].includes(`/${context}`));
      expect(entries, `${context}: one docker entry of Dependabot's`).toHaveLength(1);
      const [entry] = entries;
      expect(entry!.directories, `${context} shares a Dependabot entry, and so a pull request whose checks build only the apps' images`).toBeUndefined();
      expect(entry!.directory).toBe(`/${context}`);
      expect(entry!['commit-message']?.prefix).not.toBe('chore(images)');
    }
  });
});

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
 * The network is stubbed (the git tags, the Trigger.dev CLI's tarball) and so
 * is `gh`; the compose files and scripts are the real ones.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { COMPOSE_FILES, readImages, repoReader, stepsUsing, type Net, type Repo } from './idp-pin-watch.mjs';
import {
  ISSUE_PREFIX,
  OWNPACE_IMAGES,
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
 * (`GOACCESS_IMAGE="allinurl/goaccess:1.12@sha256:…"`, and `db-roles.sh`'s
 * client until 2026-10-22); a computed one is not.
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
    // db-roles.sh's client is the compose file's postgres. Since 2026-10-22
    // the script reads it from managed.yml's first postgres line, as
    // stand-up-live.sh does, so it names no literal and is not listed on its
    // own: the one scan of managed.yml's postgres covers it.
    const managedPostgres = readImages(REAL.read('deploy/compose/managed.yml')!).find((i) => i.repo === 'postgres')!;
    expect(images.find((i) => i.name === 'postgres-managed')?.ref).toBe(managedPostgres.ref);
    const dbRoles = REAL.read('deploy/compose/db-roles.sh')!;
    expect(
      SCRIPT_LITERAL.exec(dbRoles)?.[2],
      "db-roles.sh names its client as a literal again, which every postgres pin would then have to move by hand",
    ).toBeUndefined();
    expect(images.some((i) => i.where.includes('db-roles.sh'))).toBe(false);
    // One scan per reference in each stack, and each from one stack only.
    const fromFiles = images.filter((i) => i.where.startsWith('deploy/'));
    for (const image of fromFiles) expect(new Set(image.where.split(', ').map(stackOf)).size, image.where).toBe(1);
    const key = (i: ScanImage) => `${stackOf(i.where.split(', ')[0]!)} ${i.ref}`;
    expect(new Set(fromFiles.map(key)).size).toBe(fromFiles.length);
    // A script that computes its image is not read as one (db-roles.sh, as it
    // is); the same script with the literal it had until 2026-10-22 is, and
    // shares the compose file's scan rather than getting one of its own.
    expect(images.some((i) => i.ref.includes('$'))).toBe(false);
    const COMPUTED = /^DB_ROLES_CLIENT_IMAGE="\$\(.*\|\|\n\s*DB_ROLES_CLIENT_IMAGE=''$/m;
    const literal = dbRoles.replace(COMPUTED, `DB_ROLES_CLIENT_IMAGE='${managedPostgres.ref}'`);
    expect(literal, "db-roles.sh's computed client line was not found, so this case would prove nothing").not.toBe(dbRoles);
    const named = await imagesToScan(withFiles({ 'deploy/compose/db-roles.sh': literal }), fakeNet());
    expect(named.find((i) => i.name === 'postgres-managed')?.ref).toBe(managedPostgres.ref);
    expect(named.find((i) => i.name === 'postgres-managed')?.where).toContain('deploy/compose/db-roles.sh');
    expect(named.map((i) => i.name)).toEqual(images.map((i) => i.name));
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
    // The managed stack's postgres everywhere it is named, on the appliance's
    // reference: db-roles.sh's client follows managed.yml by itself.
    const meet = (ref: string) => ({
      'deploy/compose/managed.yml': repin(REAL.read('deploy/compose/managed.yml')!, 'postgres', ref),
      'deploy/compose/dev.yml': repin(REAL.read('deploy/compose/dev.yml')!, 'postgres', ref),
    });
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
    for (const job of [list, scan, report]) expect(job?.['runs-on']).toBe('ubuntu-24.04');
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
    expect(scan!.env).toEqual({ TRIVY_PLATFORM: 'linux/arm64', TRIVY_IMAGE_SRC: 'remote' });
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

  it('the report job reads every report, keeps the issues, and fails on a missing one', () => {
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

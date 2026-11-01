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
 *    a `runs-on` that names GitHub-hosted runners only.
 *
 * And one that went wrong in the first version (workplan 0146 T10, 2026-10-25).
 * The tasks' image is in no registry: each deploy builds it, on the base image
 * the pinned CLI names, with the layers `apps/worker/trigger.config.ts` adds
 * (the API image's Node, the Debian packages upgraded). The scan read that base
 * alone (14 critical and 119 high on 2026-10-25), so the alerts for the Debian
 * findings the upgrade fixes (42 on 2026-10-23) could never close. Its leg now
 * builds the deploy's `base` stage from the config's own extensions and scans
 * that, under the name, and so the category, its alerts were opened under.
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
 * And an image no registry serves cannot be pulled to be scanned (workplan
 * 0146 T15, 2026-10-26). The Postgres of managed.yml and dev.yml is built by
 * compose from `deploy/compose/postgres/Dockerfile`, the official image
 * without gosu, as `localhost/postgres:<tag>`, and the appliance's from
 * `deploy/selfhost/postgres/Dockerfile` (T15b, the same day). A compose file's
 * `localhost/<name>` image is listed with the directory it is built from, its
 * leg checks this commit out under `src/` and builds that directory on the
 * arm64 runner before Trivy reads it, and its name (`postgres-managed`,
 * `postgres-selfhost`, the category and the issue) is the one the pulled
 * image had.
 *
 *  - The tasks' base image is the one a deploy builds on. Since workplan 0146
 *    T14 the deploy config builds the tasks on the image `apps/api/Dockerfile`
 *    builds FROM, and the CLI's own base image is in nothing a deploy builds;
 *    a list that kept reading the CLI's would scan an image nothing runs, and
 *    nothing would scan the one that does. So the config's own extension is
 *    run here as the CLI runs it, and the scan's reference must be the base
 *    it leaves in the manifest.
 *
 * The network is stubbed (the git tags, the Trigger.dev CLI's tarball) and so
 * is `gh`; the compose files, the scripts and the deploy config are the real
 * ones.
 */

import { describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { BuildContext, BuildExtension, BuildLayer } from '@trigger.dev/core/v3/build';
import { COMPOSE_FILES, TASK_ON_API_IMAGE, builtTag, parseRef, readImages, repoReader, stepsUsing, type Net, type Repo } from './idp-pin-watch.mjs';
import {
  API_DOCKERFILE,
  BUILT_HERE,
  ISSUE_PREFIX,
  ISSUES_REF,
  OWNPACE_IMAGES,
  SCRIPT_DIRS,
  OWNPACE_REGISTRY,
  SCAN_FILES,
  TASK_CONFIG,
  TASK_IMAGE,
  eoslIssue,
  imagesFromEnv,
  imagesToScan,
  isFloating,
  keepIssues,
  newestReleaseTag,
  readReport,
  stackOf,
  summarize,
  taskBaseStage,
  taskBuildTag,
  type ScanImage,
  type TaskConfig,
} from './image-scan.mjs';
import taskConfig from '../apps/worker/trigger.config.ts';

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

/**
 * Where Trivy's SARIF puts an operating-system package's finding: the result's
 * target with its `(debian 12.x)` dropped, read as an image reference, and
 * its repository without the registry, Docker Hub's official images under
 * `library/` (`ToPathUri` in pkg/report/sarif.go at v0.76.1, through
 * go-containerregistry's `RepositoryStr`).
 */
function sarifOsLocation(target: string): string {
  const named = /^(.+?)(?:\s*\((?:.*?)\).*?)?$/.exec(target)![1]!;
  const parts = parseRef(named).repo.split('/');
  const registry = parts.length > 1 && (/[.:]/.test(parts[0]!) || parts[0] === 'localhost') ? parts.shift()! : 'docker.io';
  const hub = registry === 'docker.io' || registry === 'index.docker.io';
  return hub && parts.length === 1 ? `library/${parts[0]}` : parts.join('/');
}
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

/**
 * The base a task deploy builds on: every build extension of the real deploy
 * config run as the CLI runs them for a deploy (all starts, then all
 * completes, one manifest handed to each), and the manifest's `image.base`
 * read back, which is where the CLI takes the Containerfile's first FROM
 * from. Undefined when the config names none, and the CLI's own base is used.
 */
async function deployBase(): Promise<string | undefined> {
  const context = {
    target: 'deploy',
    workingDir: join(REPO_ROOT, 'apps/worker'),
    addLayer: (_layer: BuildLayer) => undefined,
  } as unknown as BuildContext;
  type Manifest = Parameters<NonNullable<BuildExtension['onBuildComplete']>>[1];
  const manifest = { image: { pkgs: [], instructions: [] } } as unknown as Manifest;
  const extensions = taskConfig.build?.extensions ?? [];
  for (const extension of extensions) await extension.onBuildStart?.(context);
  for (const extension of extensions) await extension.onBuildComplete?.(context, manifest);
  return manifest.image?.base;
}

/** The deploy config with the pin watch's mark of a base of its own taken out: a config that names none. */
const configWithoutBase = (): string => {
  const config = REAL.read('apps/worker/trigger.config.ts')!;
  const bare = config.replace(TASK_ON_API_IMAGE, '');
  expect(TASK_ON_API_IMAGE.test(bare), 'the mark is still in the config, so this case would prove nothing').toBe(false);
  return bare;
};

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
function trivyJson(
  os: Record<string, unknown> | null,
  vulns: Array<{ Severity: string; FixedVersion?: string; PkgName?: string; InstalledVersion?: string }> = [],
) {
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
    // A `${VAR:-default}` inside a tag, as the Trigger.dev builds name theirs (0146 T16).
    const trigger = readImages(REAL.read('deploy/compose/managed.yml')!).find((i) => i.repo === 'localhost/trigger.dev')!;
    expect(trigger.tag, "managed.yml's trigger-api image no longer carries the version default").toMatch(/^v\d+\.\d+\.\d+-[0-9a-f]{12}$/);
    expect(refs.has(`localhost/trigger.dev:${trigger.tag}`)).toBe(true);
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
    const managedPostgres = readImages(REAL.read('deploy/compose/managed.yml')!).find((i) => i.repo === 'localhost/postgres')!;
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

  it('an image a compose file builds here (localhost/<name>) is listed with the directory its leg builds, and refused without a Dockerfile (0146 T15, T15b)', async () => {
    const images = await imagesToScan(REAL, fakeNet());
    const postgres = images.find((i) => i.name === 'postgres-managed')!;
    expect(postgres.ref, "managed.yml's Postgres is pulled from a registry again").toMatch(/^localhost\/postgres:/);
    expect(postgres.ref.startsWith(BUILT_HERE)).toBe(true);
    expect(postgres.context).toBe('deploy/compose/postgres');
    expect(postgres.where, "managed.yml's and dev.yml's are one build, so one scan").toBe('deploy/compose/managed.yml, deploy/compose/dev.yml');
    expect(postgres.floating, "its pins are its Dockerfile's").toBe(false);
    expect(REAL.read(`${postgres.context}/Dockerfile`)).toMatch(/^FROM postgres:/m);
    // The appliance's is built too, from its own directory, under the name its pulled image had.
    const appliance = images.find((i) => i.name === 'postgres-selfhost')!;
    expect(appliance.ref, "the appliance's Postgres is pulled from a registry again").toMatch(/^localhost\/postgres:/);
    expect(appliance.context).toBe('deploy/selfhost/postgres');
    expect(appliance.where).toBe('deploy/selfhost/compose.yml');
    expect(appliance.floating).toBe(false);
    expect(REAL.read(`${appliance.context}/Dockerfile`)).toMatch(/^FROM postgres:/m);
    // One name exactly when the two Dockerfiles build the same content: a leg
    // never scans the other's build under its own name, and the two names
    // meeting is no failure when the FROMs do (Dependabot offers the same
    // newest digest to both entries; the review of T15b, 2026-10-26).
    const sameContent = builtTag(REAL.read(`${appliance.context}/Dockerfile`)!) === builtTag(REAL.read(`${postgres.context}/Dockerfile`)!);
    expect(appliance.ref === postgres.ref, 'the two legs share a name, and the two Dockerfiles build different content, or the other way round').toBe(sameContent);
    // The two Trigger.dev images built here (0146 T16) keep the names, and so the
    // categories and issues, the pulled images had.
    for (const [name, context] of [['trigger.dev', 'deploy/compose/trigger.dev'], ['supervisor', 'deploy/compose/supervisor']] as const) {
      const built = images.find((i) => i.name === name);
      expect(built?.ref, `${name} is pulled from a registry again`).toMatch(new RegExp(`^localhost/${name.replace('.', '\\.')}:v[\\d.]+-[0-9a-f]{12}$`));
      expect(built?.context).toBe(context);
      expect(built?.where).toBe('deploy/compose/managed.yml');
      expect(REAL.read(`${context}/Dockerfile`)).toMatch(new RegExp(`^FROM ghcr\\.io/triggerdotdev/${name.replace('.', '\\.')}:`, 'm'));
    }
    // The Docker socket proxy built here (2026-10-30) keeps the name, and so the
    // category and the issue, that `tecnativa/docker-socket-proxy` had.
    const proxy = images.find((i) => i.name === 'docker-socket-proxy');
    expect(proxy?.ref, 'the Docker socket proxy is pulled from a registry again').toMatch(/^localhost\/docker-socket-proxy:\d+\.\d+\.\d+-alpine-[0-9a-f]{12}$/);
    expect(proxy?.context).toBe('deploy/compose/docker-socket-proxy');
    expect(proxy?.where).toBe('deploy/compose/managed.yml');
    expect(proxy?.floating).toBe(false);
    expect(REAL.read('deploy/compose/docker-socket-proxy/Dockerfile')).toMatch(/^FROM haproxy:/m);
    expect(images.filter((i) => /socket-proxy/.test(i.name)).map((i) => i.name), 'one scan of the proxy, under its old name').toEqual(['docker-socket-proxy']);
    // The dashboard's TLS front built here without curl (2026-10-31) keeps the
    // name, and so the category and the issue, that `caddy` had.
    const front = images.find((i) => i.name === 'caddy');
    expect(front?.ref, 'the TLS front is pulled from a registry again').toMatch(/^localhost\/caddy:\d+\.\d+\.\d+-alpine-[0-9a-f]{12}$/);
    expect(front?.context).toBe('deploy/compose/caddy');
    expect(front?.where).toBe('deploy/compose/managed.yml');
    expect(front?.floating).toBe(false);
    expect(REAL.read('deploy/compose/caddy/Dockerfile')).toMatch(/^FROM caddy:/m);
    expect(images.filter((i) => /caddy/.test(i.name)).map((i) => i.name), 'one scan of the front, under its old name').toEqual(['caddy']);
    // Every other image is pulled, and carries no context.
    for (const image of images.filter((i) => !i.ref.startsWith(BUILT_HERE))) expect(image.context, image.name).toBeUndefined();
    // And the Postgres images built here are these two. Other images built
    // here (a script's, #1675) carry a context of their own.
    expect(images.filter((i) => i.context && i.name.startsWith('postgres')).map((i) => i.name).sort()).toEqual(['postgres-managed', 'postgres-selfhost']);
    // A localhost image with nothing to build it from is refused, never left out.
    for (const dockerfile of ['deploy/compose/postgres/Dockerfile', 'deploy/selfhost/postgres/Dockerfile']) {
      const missing: Repo = { read: (rel) => (rel === dockerfile ? null : REAL.read(rel)), list: REAL.list };
      await expect(imagesToScan(missing, fakeNet())).rejects.toThrow(`${dockerfile}, which is not in this checkout`);
    }
  });

  it("the tasks' base image is the one a deploy builds on: the API image's FROM, where the config names it", async () => {
    const base = await deployBase();
    // Vacuity guard: the config names a base of its own (0146 T14), so the
    // equality below compares two real references, not two undefineds.
    expect(base, 'the deploy config names no base, so the CLI builds the tasks on its own').toMatch(/^node:\S+@sha256:[0-9a-f]{64}$/);
    const net = fakeNet();
    const images = await imagesToScan(REAL, net);
    const task = images.find((i) => i.name === 'trigger-task-base');
    expect(task?.ref, "the scan reads an image no task deploy builds on").toBe(base);
    expect(task?.ref).toBe(/^FROM\s+(node:\S+)/m.exec(REAL.read(API_DOCKERFILE)!)![1]);
    expect(task?.where).toContain(API_DOCKERFILE);
    expect(task?.where).toContain('apps/worker/trigger.config.ts');
    expect(task?.floating).toBe(false);
    // Built in its leg as a deploy builds it, on that base (workplan 0146 T10).
    expect(task?.build, "its leg builds the deploy's stage on that base").toBe(taskBuildTag(base!));
    // The CLI's own base is in nothing a deploy builds, so it is not even read.
    expect(net.asked.some((url) => url.includes('registry.npmjs.org/trigger.dev/'))).toBe(false);
    expect(images.some((i) => i.ref === TASK_BASE)).toBe(false);
  });

  it("where the config names no base of its own, the one the pinned CLI names for the runtime the config asks for", async () => {
    const net = fakeNet();
    const images = await imagesToScan(withFiles({ 'apps/worker/trigger.config.ts': configWithoutBase() }), net);
    const cli = JSON.parse(REAL.read('apps/worker/package.json')!).dependencies['@trigger.dev/sdk'] as string;
    // The name, and so the SARIF category `trivy-image-trigger-task-base`, is
    // the one its alerts were opened under (workplan 0146 T10): renamed, the
    // old category would keep them open until somebody deleted it by hand.
    expect(TASK_IMAGE).toBe('trigger-task-base');
    expect(images.find((i) => i.name === TASK_IMAGE)).toEqual({
      name: TASK_IMAGE,
      ref: TASK_BASE,
      where: expect.stringContaining(cli),
      floating: false,
      build: 'triggerdotdev/node:trigger-task-base-built',
    });
    expect(images.find((i) => i.name === TASK_IMAGE)?.where).toContain(TASK_CONFIG);
    expect(net.asked).toContain(`https://registry.npmjs.org/trigger.dev/-/trigger.dev-${cli}.tgz`);
    // No other image is built: every other leg reads its registry.
    expect(images.filter((i) => i.build).map((i) => i.name)).toEqual([TASK_IMAGE]);
  });

  it("is built under the base's repository, so its alerts keep the location they were opened at", () => {
    // Trivy's SARIF writes an operating-system package's finding at the
    // image's repository and gives it no fingerprint, so code scanning tells
    // alerts apart by rule and that location. A tag of the leg's own would
    // close every Debian alert on the first scan, fixed or not, and open the
    // unfixed ones again under new numbers (the review of #1700).
    expect(sarifOsLocation(`${TASK_BASE} (debian 12.13)`)).toBe('triggerdotdev/node');
    expect(sarifOsLocation(`${taskBuildTag(TASK_BASE)} (debian 12.13)`)).toBe('triggerdotdev/node');
    // Vacuity guard: the tag the first draft built under was read elsewhere.
    expect(sarifOsLocation('trigger-task-base:built (debian 12.13)')).toBe('library/trigger-task-base');
    // It follows the base wherever upstream moves it, and is never a registry
    // reference by digest, which `docker build --tag` would refuse.
    expect(taskBuildTag('ghcr.io/triggerdotdev/node:26-trixie')).toBe('ghcr.io/triggerdotdev/node:trigger-task-base-built');
    expect(sarifOsLocation(taskBuildTag('ghcr.io/triggerdotdev/node:26-trixie'))).toBe(sarifOsLocation('ghcr.io/triggerdotdev/node:26-trixie'));
    expect(taskBuildTag(TASK_BASE)).not.toContain('@');
    for (const base of ['', 'node:24 AS base', `${TASK_BASE}\nRUN true`]) {
      expect(() => taskBuildTag(base)).toThrow(/must be an image reference/);
    }
  });

  it("builds on the base the config names, or else the CLI's own, since the managed stack names no other for its deploys", () => {
    // A Trigger.dev instance can make the CLI build on base images of its own
    // (the webapp's DEPLOY_BASE_IMAGES and DEPLOY_BUILD_BASE_IMAGES, which the
    // 4.7.6 CLI applies); the scan would then read a base no deploy uses.
    // managed.yml hands its Trigger.dev services only the keys it lists.
    const managed = REAL.read('deploy/compose/managed.yml')!;
    expect(managed).toContain('trigger-api:');
    for (const key of ['DEPLOY_BASE_IMAGES', 'DEPLOY_BUILD_BASE_IMAGES']) expect(managed, key).not.toContain(key);
  });

  it("follows the pinned CLI wherever it moves, and keeps the tasks' name and build tag when it does", async () => {
    // Nothing here names a Trigger.dev version: a move of the SDK pin (4.7.6
    // to 4.8.1, say) moves the tarball read and the `where`, and nothing else.
    const manifest = JSON.parse(REAL.read('apps/worker/package.json')!) as { dependencies: Record<string, string> };
    const moved = JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, '@trigger.dev/sdk': '99.0.1' } });
    // The CLI's base is read only where the config names no base of its own (0146 T14).
    const net = fakeNet();
    const images = await imagesToScan(withFiles({ 'apps/worker/package.json': moved, 'apps/worker/trigger.config.ts': configWithoutBase() }), net);
    expect(net.asked).toContain('https://registry.npmjs.org/trigger.dev/-/trigger.dev-99.0.1.tgz');
    const before = (await imagesToScan(withFiles({ 'apps/worker/trigger.config.ts': configWithoutBase() }), fakeNet())).find((i) => i.name === TASK_IMAGE)!;
    const after = images.find((i) => i.name === TASK_IMAGE)!;
    expect(after.where).toContain('trigger.dev 99.0.1');
    expect({ name: after.name, build: after.build }).toEqual({ name: before.name, build: before.build });
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
    // The API's is listed once, as the tasks' base, which is an image of its
    // own (the case above); under no other name. Without the config's base,
    // not at all.
    const images = await imagesToScan(REAL, fakeNet());
    const bare = await imagesToScan(withFiles({ 'apps/worker/trigger.config.ts': configWithoutBase() }), fakeNet());
    for (const dockerfile of ['apps/api/Dockerfile', 'apps/selfhost/Dockerfile']) {
      // Every image a stage builds FROM: the API's are the Node image it builds
      // on and the distroless one it runs on (0146 T13), both inside ownpace-api.
      // The Node one is listed once more, as the tasks' base (0146 T14), and
      // under no other name; without the config's base, not at all.
      const froms = [...REAL.read(dockerfile)!.matchAll(/^FROM\s+(\S+[:@]\S+)/gm)].map((m) => m[1]!);
      expect(froms.length, `${dockerfile} builds FROM no image`).toBeGreaterThan(0);
      for (const from of froms) {
        expect(images.filter((i) => i.ref === from && i.name !== 'trigger-task-base').map((i) => i.name), `${from} is scanned twice`).toEqual([]);
        expect(bare.some((i) => i.ref === from), `${from} is scanned twice`).toBe(false);
      }
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
    const selfhost = readImages(selfhostYml).find((i) => i.repo === 'localhost/postgres')!;
    // The managed stack's postgres everywhere it is named, and the appliance's,
    // on one reference: db-roles.sh's client follows managed.yml by itself.
    // Both are builds since 0146 T15 and T15b, whose names meet when the two
    // Dockerfiles' FROMs do; each stack's leg still builds its own directory.
    // The reference is made up, not the appliance's real one, which is
    // managed's already once the FROMs have met (the review of T15b).
    const back = (text: string, ref: string) => {
      const moved = text.replaceAll(/^(\s*image:\s*)localhost\/postgres:\S+/gm, `$1${ref}`);
      expect(moved, 'no built postgres line to move').not.toBe(text);
      return moved;
    };
    const at = 'localhost/postgres:18.6-alpine-aaaaaaaaaaaa';
    expect(at, 'the meeting name is a real one, so this case would prove nothing').not.toBe(selfhost.ref);
    const meet = (ref: string) => ({
      'deploy/compose/managed.yml': back(REAL.read('deploy/compose/managed.yml')!, ref),
      'deploy/compose/dev.yml': back(REAL.read('deploy/compose/dev.yml')!, ref),
      'deploy/selfhost/compose.yml': repin(selfhostYml, 'localhost/postgres', ref),
    });
    const postgres = (list: ScanImage[]) => list.filter((i) => i.name.startsWith('postgres')).map((i) => [i.name, i.ref]).sort();
    const met = await imagesToScan(withFiles(meet(at)), fakeNet());
    expect(postgres(met)).toEqual([['postgres-managed', at], ['postgres-selfhost', at]]);
    expect(met.filter((i) => i.name.startsWith('postgres')).map((i) => i.context).sort()).toEqual(['deploy/compose/postgres', 'deploy/selfhost/postgres']);
    const away = 'localhost/postgres:99-alpine-0123456789ab';
    const parted = await imagesToScan(withFiles({ ...meet(at), 'deploy/selfhost/compose.yml': repin(selfhostYml, 'localhost/postgres', away) }), fakeNet());
    expect(postgres(parted)).toEqual([['postgres-managed', at], ['postgres-selfhost', away]]);
    // One stack running two references of one name: the first read keeps the
    // name, the other is named apart by its file, and neither shares a category.
    const split = { 'deploy/compose/dev.yml': back(REAL.read('deploy/compose/dev.yml')!, 'postgres:99-alpine') };
    const apart = await imagesToScan(withFiles(split), fakeNet());
    const managedPostgres = readImages(REAL.read('deploy/compose/managed.yml')!).find((i) => i.repo === 'localhost/postgres')!;
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

  it("refuses rather than lists less: a CLI it cannot read, an API base it cannot read, or no release tag", async () => {
    const broken: Net = { ...fakeNet(), bytes: async () => Promise.reject(new Error('registry.npmjs.org answered 503')) };
    await expect(imagesToScan(withFiles({ 'apps/worker/trigger.config.ts': configWithoutBase() }), broken)).rejects.toThrow(/503/);
    // A FROM line without a digest is not the reference the config builds
    // on, and the CLI's base is not what the tasks run: neither is listed.
    const dockerfile = REAL.read(API_DOCKERFILE)!;
    const unpinned = dockerfile.replace(/^(FROM\s+node:\S+?)@sha256:[0-9a-f]{64}/m, '$1');
    expect(unpinned, 'the FROM line kept its digest, so this case would prove nothing').not.toBe(dockerfile);
    await expect(imagesToScan(withFiles({ [API_DOCKERFILE]: unpinned }), broken)).rejects.toThrow(/has no FROM node:<tag>@sha256:<digest> line/);
    await expect(imagesToScan(REAL, fakeNet(lsRemote('edge')))).rejects.toThrow(/no v\* release tag/);
  });
});

// -------------------------------------------- the tasks' image, built ---

const WORKER_DIR = join(REPO_ROOT, dirname(TASK_CONFIG));

/** The layers the deploy config's own extensions add for a deploy, run here apart from `taskBaseStage`. */
async function deployLayers(): Promise<BuildLayer[]> {
  const layers: BuildLayer[] = [];
  const context = { target: 'deploy', workingDir: WORKER_DIR, addLayer: (layer: BuildLayer) => layers.push(layer) } as unknown as BuildContext;
  const extensions = taskConfig.build?.extensions ?? [];
  for (const extension of extensions) await extension.onBuildStart?.(context);
  for (const extension of extensions) {
    await extension.onBuildComplete?.(context, {} as Parameters<NonNullable<typeof extension.onBuildComplete>>[1]);
  }
  return layers;
}

type Layer = { id: string; image?: { instructions?: string[]; pkgs?: string[] } };
type StubContext = { target: string; addLayer: (layer: Layer) => void };

/** A deploy config whose extensions record what the CLI's order makes of them. */
function stubConfig(calls: string[], layers: Record<string, Layer>, fail?: string): TaskConfig {
  const extension = (name: string) => ({
    name,
    onBuildStart(context: StubContext) {
      calls.push(`start ${name} ${context.target}`);
    },
    onBuildComplete(context: StubContext) {
      calls.push(`complete ${name} ${context.target}`);
      if (fail === name) throw new Error(`${name} could not read what it needs`);
      if (layers[name]) context.addLayer(layers[name]);
    },
  });
  return { build: { extensions: Object.keys(layers).map(extension) } };
}

describe("the tasks' image, built as a deploy builds it (workplan 0146 T10)", () => {
  it("is the deploy's base stage: the base the config names, then every instruction the config's extensions add", async () => {
    // The base a deploy builds on: the API image's FROM, which the config
    // names as the manifest's `image.base` (0146 T14).
    const base = await deployBase();
    expect(base, 'the deploy config names no base, so the CLI builds the tasks on its own').toMatch(/^node:\S+@sha256:[0-9a-f]{64}$/);
    const stage = await taskBaseStage(taskConfig, { base: base!, workingDir: WORKER_DIR });
    const instructions = (await deployLayers()).flatMap((layer) => layer.image?.instructions ?? []);
    // Vacuity guard: a config whose extensions add nothing would make the
    // built stage the base image again, which is what this was written to end.
    expect(instructions.length, `${TASK_CONFIG}'s extensions add no instruction for a deploy`).toBeGreaterThan(0);
    const lines = stage.split('\n');
    // No `# syntax=` line: it would pull a floating frontend image on every scan.
    expect(lines.filter((l) => /^#\s*syntax\s*=/i.test(l))).toEqual([]);
    const from = lines.indexOf(`FROM ${base} AS base`);
    expect(from, 'no FROM line naming the base image as the stage `base`').toBeGreaterThan(0);
    expect(lines.filter((l) => l.startsWith('FROM ')), 'one stage, the base one').toHaveLength(1);
    // After it, the stage is the CLI's ENV and the layers' instructions, whole
    // and in order (an instruction may span lines with a `\\` continuation).
    const body = lines.slice(from + 1).join('\n');
    expect(body).toBe(['', 'ENV DEBIAN_FRONTEND=noninteractive', '', ...instructions, ''].join('\n'));
    // On the API image's own base, its own Node: nothing copies a Node binary over it.
    expect(base).toBe(/^FROM\s+(node:\S+)/m.exec(REAL.read('apps/api/Dockerfile')!)![1]!);
    expect(stage).not.toMatch(/COPY --from=\S+ \/usr\/local\/bin\/node /);
  });

  it('runs the extensions in the CLI\'s order, as a deploy, and keeps the layers in theirs', async () => {
    const calls: string[] = [];
    const config = stubConfig(calls, {
      first: { id: 'first', image: { instructions: ['RUN echo one', 'RUN echo two'] } },
      second: { id: 'second', image: { instructions: ['COPY --from=example:1 /x /x'] } },
      third: { id: 'third' },
    });
    const stage = await taskBaseStage(config, { base: TASK_BASE, workingDir: WORKER_DIR });
    expect(calls).toEqual([
      'start first deploy', 'start second deploy', 'start third deploy',
      'complete first deploy', 'complete second deploy', 'complete third deploy',
    ]);
    expect(stage.split('\n').filter((l) => /^(RUN|COPY) /.test(l))).toEqual(['RUN echo one', 'RUN echo two', 'COPY --from=example:1 /x /x']);
    // No extension at all: the stage is the base image, said plainly.
    const bare = await taskBaseStage({}, { base: TASK_BASE, workingDir: WORKER_DIR });
    expect(bare.split('\n').filter((l) => /^[A-Z]+ /.test(l))).toEqual([`FROM ${TASK_BASE} AS base`, 'ENV DEBIAN_FRONTEND=noninteractive']);
  });

  it('refuses rather than scans less than the deploy builds', async () => {
    // A package the CLI would install with apt in this stage.
    const pkgs = stubConfig([], { tools: { id: 'tools', image: { instructions: ['RUN true'], pkgs: ['curl'] } } });
    await expect(taskBaseStage(pkgs, { base: TASK_BASE, workingDir: WORKER_DIR })).rejects.toThrow(/tools installs curl with apt/);
    // A throw the CLI would log and deploy past, without the layer.
    const failing = stubConfig([], { node: { id: 'node', image: { instructions: ['RUN true'] } } }, 'node');
    await expect(taskBaseStage(failing, { base: TASK_BASE, workingDir: WORKER_DIR })).rejects.toThrow(/could not read/);
    // A base that is not one reference: nothing reaches the Containerfile but an image.
    for (const base of [undefined, '', 'node:24 AS base\nRUN true', `${TASK_BASE} extra`]) {
      await expect(taskBaseStage({}, { base: base as unknown as string, workingDir: WORKER_DIR })).rejects.toThrow(/must be an image reference/);
    }
  });

  it('the command line writes the same stage, importing the config with Node alone', async () => {
    // The CI leg runs `node scripts/image-scan.mjs containerfile <base>`: the
    // config is a .ts file that Node strips, with the workspace installed.
    const run = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/image-scan.mjs'), 'containerfile', TASK_BASE], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe(await taskBaseStage(taskConfig, { base: TASK_BASE, workingDir: WORKER_DIR }));
    const refused = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/image-scan.mjs'), 'containerfile'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe('');
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
        { Severity: 'CRITICAL', FixedVersion: '1.2', PkgName: 'zlib1g', InstalledVersion: '1.1' },
        { Severity: 'HIGH' },
        { Severity: 'HIGH', FixedVersion: '3.4' },
      ]),
    );
    expect(report).toEqual({
      os: 'debian 12.11',
      eosl: false,
      critical: 1,
      high: 2,
      fixable: 2,
      criticals: [{ id: 'CVE-0-0', pkg: 'zlib1g', installed: '1.1', fixed: '1.2', where: 'the OS packages' }],
    });
  });

  it('lists each critical finding in the summary, with its fix or none, and where it sits (2026-10-26)', () => {
    // An OS package with no fix, and a Go binary's standard library with one:
    // the two cases the 2026-10-26 scan's 51 criticals came in.
    const mixed = JSON.stringify({
      SchemaVersion: 2,
      ArtifactName: 'example',
      ArtifactType: 'container_image',
      Metadata: { OS: { Family: 'alpine', Name: '3.24.2' }, ImageID: 'sha256:0' },
      Results: [
        {
          Target: 'example (alpine 3.24.2)',
          Class: 'os-pkgs',
          Vulnerabilities: [
            { VulnerabilityID: 'CVE-2023-45853', Severity: 'CRITICAL', PkgName: 'zlib', InstalledVersion: '1.3.1-r2' },
            { VulnerabilityID: 'CVE-2026-1', Severity: 'HIGH', PkgName: 'busybox', InstalledVersion: '1.37.0-r20', FixedVersion: '1.37.0-r21' },
          ],
        },
        {
          Target: 'usr/local/bin/gosu',
          Class: 'lang-pkgs',
          Vulnerabilities: [
            { VulnerabilityID: 'CVE-2025-68121', Severity: 'CRITICAL', PkgName: 'stdlib', InstalledVersion: 'v1.24.6', FixedVersion: '1.24.13, 1.25.7' },
          ],
        },
      ],
    });
    const summary = summarize(IMAGES, reports({ 'trivy-image-redis.json': mixed, 'trivy-image-minio.json': trivyJson(null), 'trivy-image-caddy.json': trivyJson(null) }));
    const text = summary.lines.join('\n');
    expect(summary.lines.filter((l) => l.startsWith('- `'))).toEqual([
      '- `redis`: CVE-2023-45853 in `zlib` 1.3.1-r2, **no fix yet** (the OS packages)',
      '- `redis`: CVE-2025-68121 in `stdlib` v1.24.6, fixed in 1.24.13, 1.25.7 (usr/local/bin/gosu)',
    ]);
    expect(text).toContain('### The critical findings, one by one');
    // A high is counted in the table and never listed.
    expect(text).not.toContain('CVE-2026-1');
    // No critical anywhere: no section, not an empty one.
    const none = summarize(IMAGES, reports(Object.fromEntries(IMAGES.map((i) => [`trivy-image-${i.name}.json`, trivyJson(null)]))));
    expect(none.lines.join('\n')).not.toContain('critical findings, one by one');
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

  it('marks the image a leg built, and says what that reading is', () => {
    const built: ScanImage = { name: TASK_IMAGE, ref: TASK_BASE, where: 'the CLI', floating: false, build: taskBuildTag(TASK_BASE) };
    const fine = trivyJson({ Family: 'debian', Name: '12.15' });
    const table = summarize([built, IMAGES[0]!], reports({ [`trivy-image-${TASK_IMAGE}.json`]: fine, 'trivy-image-redis.json': fine })).lines.join('\n');
    expect(table).toContain(`| \`${TASK_IMAGE}\` | \`triggerdotdev/node:24-bookworm@sha256:dddddddddddd…\` (built on) | debian 12.15 |`);
    expect(table).toMatch(/built on\* is scanned as a deploy builds on that reference/);
    // Without a built image, no such line.
    expect(summarize([IMAGES[0]!], reports({ 'trivy-image-redis.json': fine })).lines.join('\n')).not.toContain('built on');
    expect(imagesFromEnv(JSON.stringify([built]))).toEqual([built]);
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

  it("says which image was built here, and routes its issue to the Dockerfile rather than to a tag upstream moves (a compose file's Postgres, 0146 T15)", () => {
    const built: ScanImage = { name: 'postgres-managed', ref: 'localhost/postgres:18.6-alpine-0123456789ab', where: 'deploy/compose/managed.yml', floating: false, context: 'deploy/compose/postgres' };
    const summary = summarize([built], reports({ 'trivy-image-postgres-managed.json': trivyJson({ Family: 'alpine', Name: '3.24.3' }) }));
    expect(summary.missing).toEqual([]);
    expect(summary.lines.join('\n')).toMatch(/\| `postgres-managed` \| `localhost\/postgres:18\.6-alpine-0123456789ab` \(built from `deploy\/compose\/postgres`\) \| alpine 3\.24\.3 \| supported \|/);
    const issue = eoslIssue(built, readReport(trivyJson({ Family: 'alpine', Name: '3.20.10', EOSL: true })));
    expect(issue.state).toBe('behind');
    expect(issue.body).toContain('`deploy/compose/postgres/Dockerfile`');
    expect(issue.body, 'a built image has no upstream tag of its own to wait for').not.toContain('a newer tag of it once upstream');
    expect(issue.body).not.toContain('serves today');
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

type Step = {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'working-directory'?: string;
  'continue-on-error'?: unknown;
};
type Job = {
  name?: string;
  if?: string;
  needs?: string | string[];
  'runs-on': string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  env?: Record<string, string>;
  defaults?: unknown;
  strategy?: { 'fail-fast'?: boolean; matrix?: Record<string, unknown> };
  steps: Step[];
};
const workflow = parseYaml(WORKFLOW) as { defaults?: unknown; jobs: Record<string, Job> };
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
    // Whole conditions, not a part of one: `github.event_name == 'pull_request' || <this>`
    // contains it too, and would run the build leg on this repository's pull requests.
    expect(list?.if).toBe(SCHEDULE_OR_DISPATCH);
    expect(scan?.if).toBe(SCHEDULE_OR_DISPATCH);
    expect(report?.if).toBe(`always() && (${SCHEDULE_OR_DISPATCH}) && needs.image-list.result == 'success'`);
    const on = (parseYaml(WORKFLOW) as { on: { workflow_dispatch: { inputs: Record<string, unknown> } } }).on;
    expect(on.workflow_dispatch.inputs.image_scans).toMatchObject({ type: 'boolean', default: true });
  });

  it('runs on a GitHub-hosted runner, never on the machine whose images it scans', () => {
    for (const job of [list, report]) expect(job?.['runs-on']).toBe('ubuntu-24.04');
    // A leg that builds its image (the tasks' `build`, a script's or a compose file's `context`)
    // builds it natively for the platform scanned, on GitHub's arm64 runner;
    // every other leg reads a registry from amd64.
    expect(scan?.['runs-on']).toBe("${{ (matrix.build || matrix.context) && 'ubuntu-24.04-arm' || 'ubuntu-24.04' }}");
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
    // A registry, or for a leg that built its image this runner's Docker
    // alone, so a build that left nothing is never read from a registry instead.
    expect(scan!.env).toEqual({ TRIVY_PLATFORM: 'linux/arm64', TRIVY_IMAGE_SRC: "${{ (matrix.build || matrix.context) && 'docker' || 'remote' }}" });
  });

  it("builds an image built here (a script's, #1675, or a compose file's, 0146 T15) on its leg only, before Trivy, from a checkout under src/, under the reference that runs it", () => {
    const trivy = scan!.steps.findIndex((s) => s.uses?.startsWith('aquasecurity/trivy-action@'));
    // The checkout is shared with the tasks' leg (`matrix.build || matrix.context`); the build is this leg's alone.
    const built = scan!.steps.filter((s) => s.if?.split(' || ').includes('matrix.context'));
    expect(built, 'no step builds the image of a context leg').toHaveLength(2);
    for (const step of built) expect(scan!.steps.indexOf(step), 'a build step after the scan').toBeLessThan(trivy);
    expect(scan!.steps.slice(trivy).some((s) => s.if?.includes('matrix.context')), 'a build step after the scan').toBe(false);
    expect(built[0]!.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
    // Never the working directory, where Trivy would read a .trivyignore or a trivy.yaml on its own.
    expect(built[0]!.with).toEqual({ 'persist-credentials': false, path: 'src' });
    expect(built[1]!.if).toBe('matrix.context');
    // An id of its own: `build` is the tasks' stage's, and GitHub refuses a workflow whose job repeats a step id.
    expect(built[1]!.id).toBe('build_context');
    expect(built[1]!.env).toEqual({ CONTEXT: '${{ matrix.context }}', REF: '${{ matrix.ref }}' });
    expect(built[1]!.run).toMatch(/^set -euo pipefail$/m);
    expect(built[1]!.run).toContain('docker build --pull --platform "$TRIVY_PLATFORM" --tag "$REF" "src/$CONTEXT"');
    expect(built[1]!.run, 'a build here pushes nothing').not.toMatch(/--push|docker push|docker login/);
    // Every other step runs on every leg, or on the tasks' leg alone (the test of the tasks' build).
    expect(scan!.steps.filter((s) => s.if && s.if !== 'always()' && s.if !== 'matrix.build' && !built.includes(s))).toEqual([]);
    // No two steps of the job share an id.
    const ids = scan!.steps.map((s) => s.id).filter((id) => id !== undefined);
    expect(new Set(ids).size, `a step id repeats: ${ids.join(', ')}`).toBe(ids.length);
    // And a failed build is named by the leg's own check, before the scan it skipped.
    const check = scan!.steps.at(-1)!;
    expect(check.env).toMatchObject({ CONTEXT_BUILD_OUTCOME: '${{ steps.build_context.outcome }}' });
    expect(check.run).toMatch(/case "\$CONTEXT_BUILD_OUTCOME" in\n\s+success \| skipped\) ;;/);
  });

  it('runs the same pinned trivy-action and the same named Trivy as the existing scan, as JSON, report only', () => {
    const [existing, image] = stepsUsing(WORKFLOW, 'aquasecurity/trivy-action');
    expect(image, 'the image scan runs no trivy-action').toBeDefined();
    expect(image!.sha).toBe(existing!.sha);
    expect(image!.with).toMatchObject({
      version: existing!.with.version,
      'scan-type': 'image',
      'image-ref': '${{ matrix.build || matrix.ref }}',
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

  it("builds the tasks' image before it scans it, on that leg alone, from the deploy config itself", () => {
    const trivyAt = scan!.steps.findIndex((s) => s.uses?.startsWith('aquasecurity/trivy-action@'));
    // Every step before the scan is a build's (this one's, or a script's image's,
    // the checkout shared), and runs only where the list asked for one.
    for (const step of scan!.steps.slice(0, trivyAt)) {
      expect(['matrix.build', 'matrix.context', 'matrix.build || matrix.context'], `${step.name ?? step.uses} runs on every leg`).toContain(step.if);
    }
    const before = scan!.steps.slice(0, trivyAt).filter((s) => s.if?.split(' || ').includes('matrix.build'));
    expect(before.length).toBeGreaterThan(0);
    for (const step of scan!.steps.slice(trivyAt)) expect(step.if ?? '', `${step.name ?? step.uses}`).not.toContain('matrix.build');
    expect(before.map((s) => s.uses?.split('@')[0] ?? s.run?.trim().split('\n')[0])).toEqual([
      'actions/checkout',
      'pnpm/action-setup',
      'actions/setup-node',
      'pnpm install --frozen-lockfile',
      'set -euo pipefail',
    ]);
    expect(before[0]!.with?.['persist-credentials']).toBe(false);
    expect(before.slice(3).map((s) => s.id)).toEqual(['install', 'build']);
    const build = before.at(-1)!;
    expect(build.env).toEqual({ BASE: '${{ matrix.ref }}', TAG: '${{ matrix.build }}' });
    expect(build.run).toContain('node scripts/image-scan.mjs containerfile "$BASE" > "$context/Containerfile"');
    expect(build.run).toMatch(/docker build --pull --platform "\$TRIVY_PLATFORM" --tag "\$TAG" --file "\$context\/Containerfile" "\$context"/);
    expect(build.run, 'the Containerfile built is in the log').toContain('cat "$context/Containerfile"');
  });

  it("checks the repository out under src/, so the scan's working directory holds no .trivyignore or trivy.yaml of its own", () => {
    // trivy-action sets TRIVY_IGNOREFILE and TRIVY_CONFIG only when asked, so
    // Trivy, and `trivy convert` after it, read `.trivyignore` and `trivy.yaml`
    // from the working directory. A checkout there would let a file at the
    // repository's root drop findings from this one leg's SARIF, and code
    // scanning would call them fixed.
    const trivyAt = scan!.steps.findIndex((s) => s.uses?.startsWith('aquasecurity/trivy-action@'));
    const [checkout, pnpm, , install, build] = scan!.steps.slice(0, trivyAt);
    expect(checkout!.with?.path).toBe('src');
    expect(pnpm!.with?.package_json_file).toBe('src/package.json');
    expect(install!['working-directory']).toBe('src');
    expect(build!['working-directory']).toBe('src');
    // An image built here is built from the same checkout, so from src/ too.
    const scripted = scan!.steps.slice(0, trivyAt).filter((s) => s.if === 'matrix.context');
    expect(scripted.length).toBeGreaterThan(0);
    for (const step of scripted) expect(step.run, `${step.name ?? step.uses}`).toContain('"src/$CONTEXT"');
    expect(scan!.steps.filter((s) => s.uses?.startsWith('actions/checkout@')), 'one checkout, under src/').toHaveLength(1);
    // Every step from the scan on runs in the working directory every leg shares.
    for (const step of scan!.steps.slice(trivyAt)) expect(step['working-directory'], `${step.name ?? step.uses}`).toBeUndefined();
    expect(scan!.defaults, 'a job default would move the scan into the checkout').toBeUndefined();
    expect(workflow.defaults, 'a workflow default would move the scan into the checkout').toBeUndefined();
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
      INSTALL_OUTCOME: '${{ steps.install.outcome }}',
      BUILD_OUTCOME: '${{ steps.build.outcome }}',
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
    for (const job of [list, scan, report]) {
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
  // reads. A directory a compose file builds (deploy/compose/postgres, 0146
  // T15) holds a Dockerfile too, and is built on its pull request by
  // images.yml's `build (postgres)`, not here.
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

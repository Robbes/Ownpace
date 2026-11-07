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
 * The tasks' image was in no registry: each deploy built it, on the base image
 * the pinned CLI names, with the layers `apps/worker/trigger.config.ts` added
 * (the API image's Node, the Debian packages upgraded). The scan read that base
 * alone (14 critical and 119 high on 2026-10-25), so the alerts for the Debian
 * findings the upgrade fixes (42 on 2026-10-23) could never close. From then
 * until 2026-11-06 its leg built the deploy's `base` stage from the config's
 * own extensions and scanned that. Since 2026-11-06 the tasks run on the
 * prebuilt base the config pins (workplan 0119 §3 item 13), to which a deploy
 * adds the task code and nothing else, so the leg reads that pin from GHCR,
 * under the name, and so the category, its alerts were opened under.
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
 *  - The tasks' base image is the one a deploy builds on. Since 2026-11-06 the
 *    deploy config names the prebuilt base (from workplan 0146 T14 until then,
 *    the image `apps/api/Dockerfile` builds FROM), and the CLI's own base image
 *    is in nothing a deploy builds; a list that kept reading the CLI's would
 *    scan an image nothing runs, and nothing would scan the one that does. So
 *    the config's own extension is run here as the CLI runs it, and the scan's
 *    reference must be the base it leaves in the manifest.
 *
 * And every image has a tier (the owner, 2026-11-03, workplan 0119). The
 * report weighed the demo's Nextcloud like live's sign-in: five of the seven
 * criticals of 2026-11-02 were in images live never runs. Each listed image now
 * carries one of `TIERS` from `IMAGE_TIERS`, a name with none fails the list,
 * the summary leads with each tier's totals, production first and test-only
 * last, and a test-only leg uploads no SARIF: its findings are in the report
 * alone. The test-only set is held to the three the owner named (Nextcloud,
 * Stalwart, Mailpit), so moving an image into it, or out, is a change made on
 * purpose here.
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
import { COMPOSE_FILES, TASK_BASE_LINE, builtTag, parseRef, readImages, repoReader, stepsUsing, taskBasePin, type Net, type Repo } from './idp-pin-watch.mjs';
import {
  BUILT_HERE,
  IMAGE_TIERS,
  ISSUE_PREFIX,
  INVENTORY_LINES,
  ISSUES_REF,
  OWNPACE_IMAGES,
  SCRIPT_DIRS,
  OWNPACE_REGISTRY,
  SCAN_FILES,
  TASK_BASE_DOCKERFILE,
  TASK_CONFIG,
  TASK_IMAGE,
  TIERS,
  TIER_MEANS,
  compareVersions,
  eoslIssue,
  imagesFromEnv,
  imagesToScan,
  isFloating,
  keepIssues,
  neededFix,
  newestReleaseTag,
  readReport,
  stackOf,
  summarize,
  tierOf,
  type ScanImage,
  type Tier,
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

/**
 * The stand-in CLI's base for the config's runtime, `node-26` since the Node
 * line moved to 26 (2026-10-31, workplan 0119 §2.4). It was a `node-24` row
 * until then, and a stand-in CLI with no row for the config's runtime failed
 * the cases that read it with "names no image for node-26".
 */
const TASK_BASE = `triggerdotdev/node:26-bookworm@sha256:${'d'.repeat(64)}`;

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
  'package/dist/esm/deploy/buildImage.js': `export const BASE_IMAGE = {\n    node: "triggerdotdev/node:22-bookworm",\n    "node-24": "triggerdotdev/node:24-bookworm@sha256:${'c'.repeat(64)}",\n    "node-26": "${TASK_BASE}",\n};\n`,
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
    head: refuse,
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

/** The deploy config with its pin of a base of its own taken out: a config that names none. */
const configWithoutBase = (): string => {
  const config = REAL.read('apps/worker/trigger.config.ts')!;
  const bare = config.replace(TASK_BASE_LINE, '');
  expect(TASK_BASE_LINE.test(bare), 'the pin is still in the config, so this case would prove nothing').toBe(false);
  return bare;
};

/** The tasks' prebuilt base, as the deploy config pins it. */
const PIN = taskBasePin(REAL.read(TASK_CONFIG)!);

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
    // Trigger.dev's Redis built here with the Debian packages nothing runs
    // purged (2026-11-07, for alpha.6) keeps the name, and so the category and
    // the issue, that `redis` had.
    const queue = images.find((i) => i.name === 'redis');
    expect(queue?.ref, "Trigger.dev's Redis is pulled from a registry again").toMatch(/^localhost\/redis:\d+\.\d+\.\d+-bookworm-[0-9a-f]{12}$/);
    expect(queue?.context).toBe('deploy/compose/redis');
    expect(queue?.where).toBe('deploy/compose/managed.yml');
    expect(queue?.floating).toBe(false);
    expect(REAL.read('deploy/compose/redis/Dockerfile')).toMatch(/^FROM redis:/m);
    expect(images.filter((i) => /redis/.test(i.name)).map((i) => i.name), 'one scan of Redis, under its old name').toEqual(['redis']);
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

  it("the tasks' base image is the one a deploy builds on: the prebuilt base the config pins, read as published", async () => {
    const base = await deployBase();
    // Vacuity guard: the config names a base of its own (0119 §3 item 13), so
    // the equality below compares two real references, not two undefineds.
    expect(base, 'the deploy config names no base, so the CLI builds the tasks on its own').toMatch(
      /^ghcr\.io\/robbes\/ownpace-task-base:sha-[0-9a-f]{7}@sha256:[0-9a-f]{64}$/,
    );
    const net = fakeNet();
    const images = await imagesToScan(REAL, net);
    const task = images.find((i) => i.name === TASK_IMAGE);
    expect(task?.ref, 'the scan reads an image no task deploy builds on').toBe(base);
    expect(task?.ref).toBe(PIN.ref);
    expect(task?.where).toContain(TASK_CONFIG);
    expect(task?.where).toContain(TASK_BASE_DOCKERFILE);
    expect(task?.floating).toBe(false);
    // Read from GHCR as published: a deploy builds nothing into it, so nothing is built here.
    expect(Object.keys(task ?? {}).sort()).toEqual(['floating', 'name', 'ref', 'tier', 'where']);
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
      tier: 'production-internal',
      ref: TASK_BASE,
      where: expect.stringContaining(cli),
      floating: false,
    });
    expect(images.find((i) => i.name === TASK_IMAGE)?.where).toContain(TASK_CONFIG);
    expect(net.asked).toContain(`https://registry.npmjs.org/trigger.dev/-/trigger.dev-${cli}.tgz`);
  });

  it("keeps the name its alerts were opened under, and puts the base's Debian findings at its own repository", () => {
    // Trivy's SARIF writes an operating-system package's finding at the
    // image's repository and gives it no fingerprint, so code scanning tells
    // alerts apart by rule and that location. Until 2026-11-06 the leg built
    // the deploy's stage under the API's Node image's repository; the first
    // scan of the pin closes those alerts, once, and opens the base's at its own.
    expect(sarifOsLocation(`${PIN.ref} (debian 13.1)`)).toBe('robbes/ownpace-task-base');
    expect(sarifOsLocation('node:trigger-task-base-built (debian 13.1)')).toBe('library/node');
    // The tier is the one it had: live's task runs run in it, on the stack's own network.
    expect(tierOf(TASK_IMAGE)).toBe('production-internal');
  });

  it("reads the base the config names, or else the CLI's own, since the managed stack names no other for its deploys", () => {
    // A Trigger.dev instance can make the CLI build on base images of its own
    // (the webapp's DEPLOY_BASE_IMAGES and DEPLOY_BUILD_BASE_IMAGES, which the
    // 4.7.6 CLI applies); the scan would then read a base no deploy uses.
    // managed.yml hands its Trigger.dev services only the keys it lists.
    const managed = REAL.read('deploy/compose/managed.yml')!;
    expect(managed).toContain('trigger-api:');
    for (const key of ['DEPLOY_BASE_IMAGES', 'DEPLOY_BUILD_BASE_IMAGES']) expect(managed, key).not.toContain(key);
  });

  it("follows the pinned CLI wherever it moves, and keeps the tasks' name when it does", async () => {
    // Nothing here names a Trigger.dev version: a move of the SDK pin (4.7.6
    // to 4.8.1, say) moves the tarball read and the `where`, and nothing else.
    const manifest = JSON.parse(REAL.read('apps/worker/package.json')!) as { dependencies: Record<string, string> };
    const moved = JSON.stringify({ ...manifest, dependencies: { ...manifest.dependencies, '@trigger.dev/sdk': '99.0.1' } });
    // The CLI's base is read only where the config names no base of its own.
    const net = fakeNet();
    const images = await imagesToScan(withFiles({ 'apps/worker/package.json': moved, 'apps/worker/trigger.config.ts': configWithoutBase() }), net);
    expect(net.asked).toContain('https://registry.npmjs.org/trigger.dev/-/trigger.dev-99.0.1.tgz');
    const before = (await imagesToScan(withFiles({ 'apps/worker/trigger.config.ts': configWithoutBase() }), fakeNet())).find((i) => i.name === TASK_IMAGE)!;
    const after = images.find((i) => i.name === TASK_IMAGE)!;
    expect(after.where).toContain('trigger.dev 99.0.1');
    expect(after.name).toBe(before.name);
    // And a move of the pin keeps it too.
    const other = PIN.ref.replace(/@sha256:[0-9a-f]{64}$/, `@sha256:${'7'.repeat(64)}`);
    const repinned = await imagesToScan(withFiles({ [TASK_CONFIG]: REAL.read(TASK_CONFIG)!.replace(PIN.ref, other) }), fakeNet());
    expect(repinned.find((i) => i.name === TASK_IMAGE)?.ref).toBe(other);
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
    // The tasks' base is listed as the image it is, the pin; the images its
    // Dockerfile builds FROM are inside it, as the API's are inside ownpace-api.
    const images = await imagesToScan(REAL, fakeNet());
    const bare = await imagesToScan(withFiles({ 'apps/worker/trigger.config.ts': configWithoutBase() }), fakeNet());
    for (const dockerfile of ['apps/api/Dockerfile', 'apps/selfhost/Dockerfile', TASK_BASE_DOCKERFILE]) {
      // Every image a stage builds FROM: the API's are the Node image it builds
      // on and the distroless one it runs on (0146 T13), both inside ownpace-api;
      // the tasks' base's are the same two (0119 §3 item 13).
      const froms = [...REAL.read(dockerfile)!.matchAll(/^FROM\s+(\S+[:@]\S+)/gm)].map((m) => m[1]!);
      expect(froms.length, `${dockerfile} builds FROM no image`).toBeGreaterThan(0);
      for (const from of froms) {
        expect(images.filter((i) => i.ref === from).map((i) => i.name), `${from} is scanned twice`).toEqual([]);
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
    // Redis is built here since 2026-11-07, under the name the pulled image had.
    const redis = readImages(REAL.read('deploy/compose/managed.yml')!).find((i) => i.repo === 'localhost/redis')!;
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
    // The one named apart is the same image in another file, so it has its first's tier.
    expect(apart.find((i) => i.name === 'postgres-managed-dev')?.tier).toBe(tierOf('postgres-managed'));
  });

  it('says which tags float, since those are scanned as the registry serves them today', () => {
    expect(isFloating({ tag: '7-alpine', digest: '' })).toBe(true);
    expect(isFloating({ tag: '1.38', digest: '' })).toBe(true);
    expect(isFloating({ tag: 'v1.25.2-p0', digest: '' })).toBe(false);
    expect(isFloating({ tag: '1.12', digest: 'sha256:0' })).toBe(false);
  });

  it("refuses rather than lists less: a CLI it cannot read, a pin of another shape, or no release tag", async () => {
    const broken: Net = { ...fakeNet(), bytes: async () => Promise.reject(new Error('registry.npmjs.org answered 503')) };
    await expect(imagesToScan(withFiles({ 'apps/worker/trigger.config.ts': configWithoutBase() }), broken)).rejects.toThrow(/503/);
    // A pin without its digest is not the reference a deploy pulls, and the
    // CLI's base is not what the tasks run: neither is listed.
    const config = REAL.read(TASK_CONFIG)!;
    const unpinned = config.replace(PIN.ref, PIN.ref.replace(/@sha256:[0-9a-f]{64}$/, ''));
    expect(unpinned, 'the pin kept its digest, so this case would prove nothing').not.toBe(config);
    await expect(imagesToScan(withFiles({ [TASK_CONFIG]: unpinned }), broken)).rejects.toThrow(/not ghcr\.io\/robbes\/ownpace-task-base:sha-<commit>@sha256:<index digest>/);
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
      withFix: [
        { target: 'debian 12.11', pkg: 'zlib1g', installed: '1.1', severity: 'CRITICAL', ids: ['CVE-0-0'], fix: '1.2' },
        { target: 'debian 12.11', pkg: 'an unnamed package', installed: '', severity: 'HIGH', ids: ['CVE-0-2'], fix: '3.4' },
      ],
      withoutFix: [{ target: 'debian 12.11', pkg: 'an unnamed package', installed: '', severity: 'HIGH', ids: ['CVE-0-1'] }],
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
    // The section ends where the inventory by package starts (2026-11-03).
    const section = summary.lines.slice(0, summary.lines.indexOf('### What a newer package fixes, image by image'));
    const text = section.join('\n');
    expect(section.filter((l) => l.startsWith('- `'))).toEqual([
      '- `redis`: CVE-2023-45853 in `zlib` 1.3.1-r2, **no fix yet** (the OS packages)',
      '- `redis`: CVE-2025-68121 in `stdlib` v1.24.6, fixed in 1.24.13, 1.25.7 (usr/local/bin/gosu)',
    ]);
    expect(text).toContain('### The critical findings, one by one');
    // A high is counted in the table and never listed one by one.
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
  { name: 'redis', tier: 'production-internal', ref: 'redis:7-alpine', where: 'deploy/compose/managed.yml', floating: true },
  { name: 'minio', tier: 'production-internal', ref: `bitnamilegacy/minio:2025.5.24-debian-12-r5@sha256:${'4'.repeat(64)}`, where: 'deploy/compose/managed.yml', floating: false },
  { name: 'caddy', tier: 'production-internal', ref: 'caddy:2-alpine', where: 'deploy/compose/managed.yml', floating: true },
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
    expect(table).toMatch(/\| `redis` \| production-internal \| `redis:7-alpine` \(floats\) \| alpine 3\.21\.9 \| \*\*past its end of life\*\* \|/);
    expect(table).toMatch(/\| `minio` \| production-internal \| `bitnamilegacy\/minio:2025\.5\.24-debian-12-r5@sha256:444444444444…` \| debian 12\.11 \| supported \| 1 \| 0 \| 1 \|/);
  });

  it("lists the tasks' base as the pin it is, and routes its issue to the base's Dockerfile and the pin, not to a tag upstream moves", async () => {
    const task = (await imagesToScan(REAL, fakeNet())).find((i) => i.name === TASK_IMAGE)!;
    const fine = trivyJson({ Family: 'debian', Name: '13.1' });
    const table = summarize([task, IMAGES[0]!], reports({ [`trivy-image-${TASK_IMAGE}.json`]: fine, 'trivy-image-redis.json': fine })).lines.join('\n');
    expect(table).toContain(`| \`${TASK_IMAGE}\` | production-internal | \`${PIN.repo}:${PIN.tag}@${PIN.digest.slice(0, 19)}…\` | debian 13.1 |`);
    expect(table, 'nothing is built in its leg any more').not.toMatch(/built on|containerfile/);
    const issue = eoslIssue(task, readReport(trivyJson({ Family: 'debian', Name: '13.1', EOSL: true })));
    expect(issue.state).toBe('behind');
    expect(issue.body).toContain(`\`${TASK_BASE_DOCKERFILE}\``);
    expect(issue.body).toContain('`TASK_BASE_IMAGE`');
    expect(issue.body, 'its base is built here, from no tag upstream moves').not.toContain('a newer tag of it once upstream');
    // Where the config names no base, the CLI's is an upstream image like any other.
    const cli = (await imagesToScan(withFiles({ [TASK_CONFIG]: configWithoutBase() }), fakeNet())).find((i) => i.name === TASK_IMAGE)!;
    expect(eoslIssue(cli, readReport(trivyJson({ Family: 'debian', Name: '12.1', EOSL: true }))).body).toContain('a newer tag of it once upstream');
    expect(imagesFromEnv(JSON.stringify([task]))).toEqual([task]);
  });

  it('says which image was built here, and routes its issue to the Dockerfile rather than to a tag upstream moves', () => {
    const built: ScanImage = { name: 'goaccess', tier: 'production-internal', ref: 'localhost/goaccess:1.12', where: 'deploy/compose/site-visits.sh', floating: false, context: 'deploy/compose/goaccess' };
    const summary = summarize([built], reports({ 'trivy-image-goaccess.json': trivyJson({ Family: 'alpine', Name: '3.24.3' }) }));
    expect(summary.missing).toEqual([]);
    expect(summary.lines.join('\n')).toMatch(/\| `goaccess` \| production-internal \| `localhost\/goaccess:1\.12` \(built from `deploy\/compose\/goaccess`\) \| alpine 3\.24\.3 \| supported \|/);
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
    const built: ScanImage = { name: 'postgres-managed', tier: 'production-internal', ref: 'localhost/postgres:18.6-alpine-0123456789ab', where: 'deploy/compose/managed.yml', floating: false, context: 'deploy/compose/postgres' };
    const summary = summarize([built], reports({ 'trivy-image-postgres-managed.json': trivyJson({ Family: 'alpine', Name: '3.24.3' }) }));
    expect(summary.missing).toEqual([]);
    expect(summary.lines.join('\n')).toMatch(/\| `postgres-managed` \| production-internal \| `localhost\/postgres:18\.6-alpine-0123456789ab` \(built from `deploy\/compose\/postgres`\) \| alpine 3\.24\.3 \| supported \|/);
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

// ------------------------------------------- the fixable inventory -------

type Finding = { VulnerabilityID: string; Severity: string; PkgName: string; InstalledVersion: string; FixedVersion?: string; PkgPath?: string; PrimaryURL?: string };
const finding = (id: string, severity: string, pkg: string, installed: string, fixed: string | undefined, path?: string): Finding => ({
  VulnerabilityID: id,
  Severity: severity,
  PkgName: pkg,
  InstalledVersion: installed,
  ...(fixed === undefined ? {} : { FixedVersion: fixed }),
  ...(path ? { PkgPath: path } : {}),
  // Where the report links each finding (an address, in a real one) never reaches the inventory.
  PrimaryURL: `primary-url-of-${id}`,
});
const imageReport = (os: string, results: Array<{ Target: string; Class: string; Type: string; Vulnerabilities: Finding[] }>) =>
  JSON.stringify({
    SchemaVersion: 2,
    ArtifactName: 'localhost/trigger.dev:v4.8.3-0123456789ab',
    ArtifactType: 'container_image',
    Metadata: { OS: { Family: os.split(' ')[0], Name: os.split(' ')[1] }, ImageID: 'sha256:0' },
    Results: results,
  });

/**
 * Every shape the inventory groups (2026-11-03): an operating system's
 * packages, with one CVE of util-linux's source in three of its binary packages
 * (three alerts in code scanning, three lines here); two Go binaries with one
 * Go, whose fixes Trivy names one per line (`1.24.13, 1.25.7, 1.26.0-rc.3`);
 * npm's own tar and the app's, each by its directory; a finding listed twice
 * for one package; fixes that order by number and not by text (`deb12u10`
 * after `deb12u9`, `6.2.10` after `6.2.9`); findings with no fix; and a medium,
 * which the inventory leaves out.
 */
const INVENTORY_REPORT = imageReport('debian 12.15', [
  {
    Target: 'localhost/trigger.dev:v4.8.3-0123456789ab (debian 12.15)',
    Class: 'os-pkgs',
    Type: 'debian',
    Vulnerabilities: [
      finding('CVE-2025-14104', 'HIGH', 'libblkid1', '2.38.1-5+deb12u3', '2.38.1-5+deb12u9'),
      finding('CVE-2025-14104', 'HIGH', 'libmount1', '2.38.1-5+deb12u3', '2.38.1-5+deb12u9'),
      finding('CVE-2025-14104', 'HIGH', 'util-linux', '2.38.1-5+deb12u3', '2.38.1-5+deb12u9'),
      finding('CVE-2026-20001', 'HIGH', 'libmount1', '2.38.1-5+deb12u3', '2.38.1-5+deb12u10'),
      finding('CVE-2026-30002', 'HIGH', 'libssl3', '3.0.15-1~deb12u1', '3.0.16-1~deb12u1'),
      finding('CVE-2026-30001', 'CRITICAL', 'libssl3', '3.0.15-1~deb12u1', '3.0.17-1~deb12u2'),
      finding('CVE-2023-45853', 'CRITICAL', 'zlib1g', '1:1.2.13.dfsg-1', undefined),
      finding('CVE-2026-40001', 'HIGH', 'libxml2', '2.9.14+dfsg-1.3~deb12u4', ''),
      finding('CVE-2026-40002', 'HIGH', 'libxml2', '2.9.14+dfsg-1.3~deb12u4', undefined),
      finding('CVE-2026-50001', 'MEDIUM', 'libc6', '2.36-9+deb12u10', '2.36-9+deb12u13'),
    ],
  },
  {
    Target: 'usr/local/bin/goose',
    Class: 'lang-pkgs',
    Type: 'gobinary',
    Vulnerabilities: [
      // On 1.24.6, both ask a 1.24: 1.24.13, not 1.25.7 nor the release candidate.
      finding('CVE-2025-68121', 'CRITICAL', 'stdlib', 'v1.24.6', '1.24.13, 1.25.7, 1.26.0-rc.3'),
      finding('CVE-2025-61729', 'HIGH', 'stdlib', 'v1.24.6', '1.24.11, 1.25.5'),
      finding('GHSA-0000-0000-0001', 'HIGH', 'golang.org/x/net', 'v0.38.0', '0.45.0'),
    ],
  },
  {
    Target: 'usr/local/bin/gosu',
    Class: 'lang-pkgs',
    Type: 'gobinary',
    Vulnerabilities: [
      // One fixed on 1.25 only: 1.25.2 is still below the first one's 1.25.7.
      finding('CVE-2025-68121', 'CRITICAL', 'stdlib', 'v1.24.6', '1.24.13, 1.25.7, 1.26.0-rc.3'),
      finding('CVE-2026-25002', 'HIGH', 'stdlib', 'v1.24.6', '1.25.2'),
    ],
  },
  {
    Target: 'Node.js',
    Class: 'lang-pkgs',
    Type: 'node-pkg',
    Vulnerabilities: [
      finding('CVE-2026-60001', 'HIGH', 'tar', '6.2.0', '6.2.1, 7.5.2', 'usr/local/lib/node_modules/npm/node_modules/tar/package.json'),
      finding('CVE-2026-60002', 'HIGH', 'tar', '6.2.0', '6.2.9', 'usr/local/lib/node_modules/npm/node_modules/tar/package.json'),
      finding('CVE-2026-60003', 'HIGH', 'tar', '6.2.0', '6.2.10', 'usr/local/lib/node_modules/npm/node_modules/tar/package.json'),
      finding('CVE-2026-60001', 'HIGH', 'tar', '7.4.3', '6.2.1, 7.5.2', 'app/node_modules/tar/package.json'),
      finding('CVE-2026-60001', 'HIGH', 'tar', '7.4.3', '6.2.1, 7.5.2', 'app/node_modules/tar/package.json'),
      finding('CVE-2026-60004', 'HIGH', 'tar', '7.4.3', undefined, 'app/node_modules/tar/package.json'),
    ],
  },
]);

/** The inventory's lines in a summary: from its heading on. */
const inventoryOf = (lines: string[]) => lines.slice(lines.indexOf('### What a newer package fixes, image by image'));

describe('what a newer package fixes, image by image (2026-11-03)', () => {
  it('orders versions by number, with Go\'s v and a release candidate read as such', () => {
    expect(compareVersions('1.24.9', '1.24.13')).toBeLessThan(0);
    expect(compareVersions('v1.24.13', '1.24.13')).toBe(0);
    expect(compareVersions('1.26.0-rc.3', '1.26.0')).toBeLessThan(0);
    expect(compareVersions('2.38.1-5+deb12u10', '2.38.1-5+deb12u9')).toBeGreaterThan(0);
    expect(compareVersions('3.0.15-1~deb12u1', '3.0.15-1')).toBeLessThan(0);
    expect(compareVersions('1.37.0-r21', '1.37.0-r20')).toBeGreaterThan(0);
  });

  it('needs the highest fix a package\'s findings ask, read on the line of the version installed', () => {
    // One fix each: the highest, by number.
    expect(neededFix('6.2.0', ['6.2.9', '6.2.10'])).toBe('6.2.10');
    // A fix per line: the installed line's, not the highest named.
    expect(neededFix('v1.24.6', ['1.24.13, 1.25.7, 1.26.0-rc.3', '1.24.11, 1.25.5'])).toBe('1.24.13');
    // A finding fixed on a later line only takes the package there, and on that
    // line to the other's fix too: 1.25.2 is below 1.25.7.
    expect(neededFix('v1.24.6', ['1.24.13, 1.25.7, 1.26.0-rc.3', '1.25.2'])).toBe('1.25.7');
    // Installed on a later line, the earlier line's fix is no way out.
    expect(neededFix('7.4.3', ['6.2.1, 7.5.2'])).toBe('7.5.2');
    // A list's lines in order by number too: 1.9 before 1.10.
    expect(neededFix('1.9.1', ['1.9.5, 1.10.2'])).toBe('1.9.5');
    // Part of the Go in gosu as the scan of 2026-10-26 read it: one finding is
    // fixed on 1.26 and 1.27 only, and 1.26.10 is above every 1.26 fix named.
    expect(neededFix('v1.24.6', ['1.24.13, 1.25.7, 1.26.0-rc.3', '1.26.10, 1.27.3', '1.25.8, 1.26.1'])).toBe('1.26.10');
  });

  it('groups each image\'s critical and high findings by package where it sits, with the fix that clears them, and counts those without one', () => {
    const report = readReport(INVENTORY_REPORT);
    expect(report.withFix.map((p) => [p.pkg, p.target, p.fix, p.ids.length])).toEqual([
      ['libssl3', 'debian 12.15', '3.0.17-1~deb12u2', 2],
      ['stdlib', 'usr/local/bin/goose', '1.24.13', 2],
      ['stdlib', 'usr/local/bin/gosu', '1.25.7', 2],
      ['golang.org/x/net', 'usr/local/bin/goose', '0.45.0', 1],
      ['libblkid1', 'debian 12.15', '2.38.1-5+deb12u9', 1],
      ['libmount1', 'debian 12.15', '2.38.1-5+deb12u10', 2],
      ['tar', 'app/node_modules/tar', '7.5.2', 1],
      ['tar', 'usr/local/lib/node_modules/npm/node_modules/tar', '6.2.10', 3],
      ['util-linux', 'debian 12.15', '2.38.1-5+deb12u9', 1],
    ]);
    const summary = summarize([IMAGES[1]!], reports({ 'trivy-image-minio.json': INVENTORY_REPORT }));
    expect(inventoryOf(summary.lines)).toEqual([
      '### What a newer package fixes, image by image',
      '',
      expect.stringContaining(`at most ${INVENTORY_LINES} lines of each list are shown per image, the rest counted`),
      '',
      '#### `minio` (production-internal)',
      '',
      'With a fix: 15 findings in 9 packages, 11 distinct ids.',
      '',
      '- `libssl3` 3.0.15-1~deb12u1 → 3.0.17-1~deb12u2, critical, 2 findings: CVE-2026-30001, CVE-2026-30002 (debian 12.15)',
      '- `stdlib` v1.24.6 → 1.24.13, critical, 2 findings: CVE-2025-68121, CVE-2025-61729 (usr/local/bin/goose)',
      '- `stdlib` v1.24.6 → 1.25.7, critical, 2 findings: CVE-2025-68121, CVE-2026-25002 (usr/local/bin/gosu)',
      '- `golang.org/x/net` v0.38.0 → 0.45.0, high, 1 finding: GHSA-0000-0000-0001 (usr/local/bin/goose)',
      '- `libblkid1` 2.38.1-5+deb12u3 → 2.38.1-5+deb12u9, high, 1 finding: CVE-2025-14104 (debian 12.15)',
      '- `libmount1` 2.38.1-5+deb12u3 → 2.38.1-5+deb12u10, high, 2 findings: CVE-2025-14104, CVE-2026-20001 (debian 12.15)',
      '- `tar` 7.4.3 → 7.5.2, high, 1 finding: CVE-2026-60001 (app/node_modules/tar)',
      '- `tar` 6.2.0 → 6.2.10, high, 3 findings: CVE-2026-60001, CVE-2026-60002, CVE-2026-60003 (usr/local/lib/node_modules/npm/node_modules/tar)',
      '- `util-linux` 2.38.1-5+deb12u3 → 2.38.1-5+deb12u9, high, 1 finding: CVE-2025-14104 (debian 12.15)',
      '',
      'No fix yet: 4 findings in 3 packages.',
      '',
      '- `zlib1g` 1:1.2.13.dfsg-1, critical, 1 finding (debian 12.15)',
      '- `libxml2` 2.9.14+dfsg-1.3~deb12u4, high, 2 findings (debian 12.15)',
      '- `tar` 7.4.3, high, 1 finding (app/node_modules/tar)',
    ]);
    // The image reference Trivy's OS target starts with, and the link of each finding, stay out.
    const text = inventoryOf(summary.lines).join('\n');
    expect(text).not.toContain('localhost/');
    expect(text).not.toContain('primary-url-of-');
    expect(text).not.toContain('libc6');
    // The critical findings, one by one, are still there, before it.
    expect(summary.lines.indexOf('### The critical findings, one by one')).toBeLessThan(summary.lines.indexOf('### What a newer package fixes, image by image'));
  });

  it('puts the image with most to fix first, then the one with only findings no fix clears, and leaves out one with none', () => {
    const one = imageReport('alpine 3.24.3', [
      { Target: 'usr/bin/registry', Class: 'lang-pkgs', Type: 'gobinary', Vulnerabilities: [finding('CVE-2026-1', 'HIGH', 'stdlib', 'v1.26.8', '1.26.9')] },
    ]);
    const none = imageReport('debian 12.15', [
      { Target: 'redis (debian 12.15)', Class: 'os-pkgs', Type: 'debian', Vulnerabilities: [finding('CVE-2023-45853', 'CRITICAL', 'zlib1g', '1:1.2.13.dfsg-1', undefined)] },
    ]);
    const images: ScanImage[] = [...IMAGES, { name: 'nginx', tier: 'production-public', ref: 'nginx:1.31.8-alpine-slim', where: 'deploy/compose/www.yml', floating: false }];
    const summary = summarize(
      images,
      reports({ 'trivy-image-redis.json': none, 'trivy-image-minio.json': one, 'trivy-image-caddy.json': INVENTORY_REPORT, 'trivy-image-nginx.json': trivyJson(null) }),
    );
    expect(summary.lines.filter((l) => l.startsWith('#### '))).toEqual(['#### `caddy` (production-internal)', '#### `minio` (production-internal)', '#### `redis` (production-internal)']);
    // Nothing critical or high anywhere: no section, not an empty one.
    const clean = summarize([IMAGES[0]!], reports({ 'trivy-image-redis.json': trivyJson(null) }));
    expect(clean.lines.join('\n')).not.toContain('What a newer package fixes');
  });

  it(`shows at most ${INVENTORY_LINES} lines of each list per image, and counts the rest on a line of its own`, () => {
    // Two findings a package, so a count of packages cannot pass for one of findings.
    const many = (n: number, fixed: boolean) =>
      Array.from({ length: n }, (_, i) =>
        [1000, 5000].map((id) => finding(`CVE-2026-${id + i}`, 'HIGH', `pkg-${String(i).padStart(3, '0')}`, '1.0', fixed ? '1.1' : undefined)),
      ).flat();
    const capped = imageReport('alpine 3.24.3', [
      { Target: 'x (alpine 3.24.3)', Class: 'os-pkgs', Type: 'alpine', Vulnerabilities: [...many(INVENTORY_LINES + 2, true), ...many(INVENTORY_LINES + 3, false)] },
    ]);
    const lines = inventoryOf(summarize([IMAGES[0]!], reports({ 'trivy-image-redis.json': capped })).lines);
    const listed = (from: string, to?: string) => lines.slice(lines.indexOf(from), to ? lines.indexOf(to) : undefined).filter((l) => l.startsWith('- '));
    const withFix = listed('With a fix: 124 findings in 62 packages, 124 distinct ids.', 'No fix yet: 126 findings in 63 packages.');
    expect(withFix).toHaveLength(INVENTORY_LINES + 1);
    expect(withFix.at(-2)).toBe('- `pkg-059` 1.0 → 1.1, high, 2 findings: CVE-2026-1059, CVE-2026-5059 (alpine 3.24.3)');
    expect(withFix.at(-1)).toBe("- … and 2 more packages with a fix (4 findings), in the run's artifact `trivy-image-redis`");
    const withoutFix = listed('No fix yet: 126 findings in 63 packages.');
    expect(withoutFix).toHaveLength(INVENTORY_LINES + 1);
    expect(withoutFix.at(-1)).toBe("- … and 3 more packages with no fix yet (6 findings), in the run's artifact `trivy-image-redis`");
    // Exactly as many as fit: no line counting nothing.
    const full = imageReport('alpine 3.24.3', [{ Target: 'x (alpine 3.24.3)', Class: 'os-pkgs', Type: 'alpine', Vulnerabilities: many(INVENTORY_LINES, true) }]);
    const fits = inventoryOf(summarize([IMAGES[0]!], reports({ 'trivy-image-redis.json': full })).lines);
    expect(fits.filter((l) => l.startsWith('- '))).toHaveLength(INVENTORY_LINES);
    expect(fits.join('\n')).not.toContain('more package');
    // A package with many ids names the first few and counts the rest.
    const wide = imageReport('alpine 3.24.3', [
      { Target: 'usr/bin/x', Class: 'lang-pkgs', Type: 'gobinary', Vulnerabilities: Array.from({ length: 7 }, (_, i) => finding(`CVE-2026-${i + 1}`, 'HIGH', 'stdlib', 'v1.26.8', '1.26.9')) },
    ]);
    expect(inventoryOf(summarize([IMAGES[0]!], reports({ 'trivy-image-redis.json': wide })).lines)).toContain(
      '- `stdlib` v1.26.8 → 1.26.9, high, 7 findings: CVE-2026-1, CVE-2026-2, CVE-2026-3, CVE-2026-4 and 3 more (usr/bin/x)',
    );
  });

  it('prints it in the log and writes it to the job summary, from the command line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'image-scan-inventory-'));
    try {
      writeFileSync(join(dir, 'trivy-image-minio.json'), INVENTORY_REPORT);
      const summary = join(dir, 'summary.md');
      writeFileSync(summary, '');
      const run = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/image-scan.mjs'), 'report', dir], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, IMAGES: JSON.stringify([IMAGES[1]!]), GITHUB_STEP_SUMMARY: summary },
      });
      expect(run.status, run.stderr).toBe(0);
      const line = '- `stdlib` v1.24.6 → 1.25.7, critical, 2 findings: CVE-2025-68121, CVE-2026-25002 (usr/local/bin/gosu)';
      for (const out of [run.stdout, readFileSync(summary, 'utf8')]) {
        // The tiers' totals lead (2026-11-03), before the table and the inventory.
        expect(out.indexOf('### By tier, production first')).toBeGreaterThan(-1);
        expect(out.indexOf('### By tier, production first')).toBeLessThan(out.indexOf('### Image by image'));
        expect(out).toContain('### What a newer package fixes, image by image');
        expect(out).toContain(line);
        expect(out).toContain('- `tar` 7.4.3, high, 1 finding (app/node_modules/tar)');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

// ------------------------------------------------- every image's tier ----

/** A report with these findings, each in its own package: `fix` names a fixed version, or none. */
const findingsReport = (...vulns: Array<{ severity: 'CRITICAL' | 'HIGH'; fix?: string }>) =>
  trivyJson(
    { Family: 'alpine', Name: '3.24.3' },
    vulns.map((v, i) => ({ Severity: v.severity, PkgName: `pkg-${i}`, InstalledVersion: '1.0', ...(v.fix ? { FixedVersion: v.fix } : {}) })),
  );

/** One image of each tier and two of the production ones, in a list order that mixes them. */
const TIERED: ScanImage[] = [
  { name: 'nextcloud', tier: 'test-only', ref: 'nextcloud:35.0.2-apache', where: 'deploy/compose/managed.yml, deploy/compose/dev.yml', floating: false },
  { name: 'redis', tier: 'production-internal', ref: 'redis:7.4.12-bookworm', where: 'deploy/compose/managed.yml', floating: false },
  { name: 'ownpace-selfhost-edge', tier: 'shipped', ref: `${OWNPACE_REGISTRY}/ownpace-selfhost:edge`, where: 'main (images.yml)', floating: true },
  { name: 'zitadel', tier: 'production-public', ref: 'ghcr.io/zitadel/zitadel:v4.20.0', where: 'deploy/compose/managed.yml', floating: false },
  { name: 'trigger.dev', tier: 'production-internal', ref: 'localhost/trigger.dev:v4.8.3-0123456789ab', where: 'deploy/compose/managed.yml', floating: false, context: 'deploy/compose/trigger.dev' },
  { name: 'gatus', tier: 'production-public', ref: 'ghcr.io/twin/gatus:v5.38.0', where: 'deploy/compose/managed.yml', floating: false },
];
const TIERED_REPORTS: Record<string, string> = {
  // The most to fix of all, and still last: it is not in production.
  'trivy-image-nextcloud.json': findingsReport({ severity: 'CRITICAL' }, ...Array.from({ length: 4 }, () => ({ severity: 'HIGH' as const, fix: '2.0' }))),
  'trivy-image-redis.json': findingsReport({ severity: 'CRITICAL' }, { severity: 'HIGH' }),
  'trivy-image-ownpace-selfhost-edge.json': findingsReport({ severity: 'HIGH' }),
  'trivy-image-zitadel.json': findingsReport({ severity: 'HIGH', fix: '2.0' }),
  'trivy-image-trigger.dev.json': findingsReport(...Array.from({ length: 3 }, () => ({ severity: 'HIGH' as const, fix: '2.0' }))),
  'trivy-image-gatus.json': findingsReport({ severity: 'CRITICAL' }, { severity: 'HIGH', fix: '2.0' }, { severity: 'HIGH', fix: '3.0' }),
};

/** The headline's lines: from its heading to the per-image table's. */
const headlineOf = (lines: string[]) => lines.slice(lines.indexOf('### By tier, production first'), lines.indexOf('### Image by image'));

describe('every image has a tier, and the report leads with production (the owner, 2026-11-03)', () => {
  it('the tiers, in the order the report reads them: production first, test-only last', () => {
    expect(TIERS).toEqual(['production-public', 'production-internal', 'shipped', 'test-only']);
    expect(Object.keys(TIER_MEANS).sort()).toEqual([...TIERS].sort());
    expect(TIER_MEANS['test-only']).toContain('not in production');
  });

  it('gives every image the list names a tier, and none it does not name', async () => {
    const images = await imagesToScan(REAL, fakeNet());
    for (const image of images) {
      expect(TIERS, `${image.name} has no tier the report knows`).toContain(image.tier);
      expect(image.tier, image.name).toBe(IMAGE_TIERS[image.name]);
    }
    // A tier kept for a name nothing lists would place the next image of that name unread.
    expect(Object.keys(IMAGE_TIERS).sort()).toEqual(images.map((i) => i.name).sort());
    // Every tier has an image, so no row of the headline is there by accident.
    expect([...new Set(images.map((i) => i.tier))].sort()).toEqual([...TIERS].sort());
  });

  it('test-only is exactly Nextcloud, Stalwart and Mailpit, the three the owner named: moving an image in or out is done here, on purpose', async () => {
    const images = await imagesToScan(REAL, fakeNet());
    expect(images.filter((i) => i.tier === 'test-only').map((i) => i.name).sort()).toEqual(['mailpit', 'nextcloud', 'stalwart']);
    // The appliance's images are what self-hosters run: its compose file's, and Ownpace's selfhost image.
    const appliance = images.filter((i) => i.where === 'deploy/selfhost/compose.yml').map((i) => i.name);
    expect(appliance.length, 'the appliance runs no image this list names, so this case would prove nothing').toBeGreaterThan(0);
    expect(images.filter((i) => i.tier === 'shipped').map((i) => i.name).sort()).toEqual([...appliance, 'ownpace-selfhost-edge', 'ownpace-selfhost-release'].sort());
    // Ownpace's api and web are what the internet reaches on live, at :edge and at the release.
    for (const image of OWNPACE_IMAGES.filter((i) => i !== 'selfhost')) {
      for (const at of ['edge', 'release']) expect(images.find((i) => i.name === `ownpace-${image}-${at}`)?.tier).toBe('production-public');
    }
  });

  it('refuses an image with no tier: a new one fails the list, naming it, and the report refuses one handed on without', async () => {
    const managed = REAL.read('deploy/compose/managed.yml')!;
    const added = managed.replace(/^ {2}gatus:\n/m, '  newcomer:\n    image: example/newcomer:1.2.3\n  gatus:\n');
    expect(added, "managed.yml's gatus service was not found, so this case would prove nothing").not.toBe(managed);
    await expect(imagesToScan(withFiles({ 'deploy/compose/managed.yml': added }), fakeNet())).rejects.toThrow(
      /newcomer has no tier in image-scan\.mjs's IMAGE_TIERS/,
    );
    expect(() => tierOf('newcomer')).toThrow(/no tier/);
    // Read as the map's own keys, never what every object has.
    expect(() => tierOf('constructor')).toThrow(/no tier/);
    expect(tierOf('nextcloud')).toBe('test-only');
    // The report job: an image the list handed on without a tier, or with one it does not know.
    const { tier: _dropped, ...untiered } = IMAGES[0]!;
    expect(() => imagesFromEnv(JSON.stringify([untiered, IMAGES[1]]))).toThrow(/gives redis no tier the report knows/);
    expect(() => imagesFromEnv(JSON.stringify([{ ...IMAGES[0]!, tier: 'production' }]))).toThrow(/no tier the report knows/);
    expect(() => summarize([untiered as ScanImage], reports({}))).toThrow(/redis carries no tier the report knows/);
  });

  it('leads with the totals of each tier, production first and test-only last, said to be not in production', () => {
    const summary = summarize(TIERED, reports(TIERED_REPORTS));
    expect(summary.missing).toEqual([]);
    const row = (tier: Tier, rest: string) => `| \`${tier}\`: ${TIER_MEANS[tier]} | ${rest} |`;
    expect(headlineOf(summary.lines)).toEqual([
      '### By tier, production first',
      '',
      '| tier | images | critical | high | a newer package fixes |',
      '|---|---|---|---|---|',
      row('production-public', '2 | 1 | 3 | 3'),
      row('production-internal', '2 | 1 | 4 | 3'),
      row('shipped', '1 | 0 | 1 | 0'),
      row('test-only', '1 | 1 | 4 | 4'),
      '',
    ]);
    expect(headlineOf(summary.lines).at(-2)).toContain('**not in production**');
    // It comes first: after the one line of counts, before the table, the criticals and the inventory.
    expect(summary.lines.indexOf('### By tier, production first')).toBe(4);
    expect(summary.lines[2]).toMatch(/^6 listed, 6 scanned, 0 past their end of life, 0 without a report\. .*except a test-only image's, which are in this report alone\.$/);
    // A tier no image is in has no row; one whose report is missing says so in its count.
    const fewer = summarize(
      TIERED.filter((i) => i.tier !== 'shipped'),
      reports({ ...TIERED_REPORTS, 'trivy-image-redis.json': '' }),
    );
    expect(headlineOf(fewer.lines).filter((l) => l.startsWith('| `'))).toEqual([
      row('production-public', '2 | 1 | 3 | 3'),
      row('production-internal', '1 of 2, 1 without a report | 0 | 3 | 3'),
      row('test-only', '1 | 1 | 4 | 4'),
    ]);
  });

  it('lists the images by tier, then in their own order: the table, the criticals and the inventory', () => {
    const summary = summarize(TIERED, reports(TIERED_REPORTS));
    const table = summary.lines.filter((l) => /^\| `[^`]+` \| [a-z-]+/.test(l) && !l.startsWith('| `production') && !l.startsWith('| `shipped') && !l.startsWith('| `test-only'));
    expect(table.map((l) => /^\| `([^`]+)` \| ([^|]+) \|/.exec(l)!.slice(1, 3).map((x) => x.trim()))).toEqual([
      ['zitadel', 'production-public'],
      ['gatus', 'production-public'],
      ['redis', 'production-internal'],
      ['trigger.dev', 'production-internal'],
      ['ownpace-selfhost-edge', 'shipped'],
      ['nextcloud', 'test-only, not in production'],
    ]);
    expect(summary.lines.filter((l) => /^- `[^`]+`: CVE/.test(l)).map((l) => /^- `([^`]+)`/.exec(l)![1])).toEqual(['gatus', 'redis', 'nextcloud']);
    // Within a tier the most to fix first (gatus before zitadel, trigger.dev before redis), and
    // test-only last though it has the most.
    expect(summary.lines.filter((l) => l.startsWith('#### '))).toEqual([
      '#### `gatus` (production-public)',
      '#### `zitadel` (production-public)',
      '#### `trigger.dev` (production-internal)',
      '#### `redis` (production-internal)',
      '#### `ownpace-selfhost-edge` (shipped)',
      '#### `nextcloud` (test-only, not in production)',
    ]);
    // The end of life is read whatever the tier: a test-only image past it still warns and keeps its issue.
    const eosl = summarize(TIERED, reports({ ...TIERED_REPORTS, 'trivy-image-nextcloud.json': trivyJson({ Family: 'debian', Name: '11.11', EOSL: true }) }));
    expect(eosl.annotations).toEqual([expect.stringMatching(/^::warning::nextcloud: /)]);
    const { gh, calls } = fakeGh([]);
    keepIssues(TIERED, eosl, gh);
    expect(calls.filter((c) => c[1] === 'create').map((c) => c[3])).toEqual([`${ISSUE_PREFIX}nextcloud`]);
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
// The condition of the two steps a test-only leg skips: the SARIF and its upload (the owner, 2026-11-03).
const NOT_TEST_ONLY = "matrix.tier != 'test-only'";

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
    // A leg that builds its image (a script's or a compose file's `context`)
    // builds it natively for the platform scanned, on GitHub's arm64 runner;
    // every other leg, the tasks' since 2026-11-06, reads a registry from amd64.
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
    // A registry, or for a leg that built its image this runner's Docker
    // alone, so a build that left nothing is never read from a registry instead.
    expect(scan!.env).toEqual({ TRIVY_PLATFORM: 'linux/arm64', TRIVY_IMAGE_SRC: "${{ matrix.context && 'docker' || 'remote' }}" });
  });

  it("builds an image built here (a script's, #1675, or a compose file's, 0146 T15) on its leg only, before Trivy, from a checkout under src/, under the reference that runs it", () => {
    const trivy = scan!.steps.findIndex((s) => s.uses?.startsWith('aquasecurity/trivy-action@'));
    // The checkout and the build run on this leg alone, since no other leg builds anything (2026-11-06).
    const built = scan!.steps.filter((s) => s.if?.split(' || ').includes('matrix.context'));
    expect(built, 'no step builds the image of a context leg').toHaveLength(2);
    for (const step of built) expect(scan!.steps.indexOf(step), 'a build step after the scan').toBeLessThan(trivy);
    expect(scan!.steps.slice(trivy).some((s) => s.if?.includes('matrix.context')), 'a build step after the scan').toBe(false);
    expect(built[0]!.uses).toMatch(/^actions\/checkout@[0-9a-f]{40}$/);
    // Never the working directory, where Trivy would read a .trivyignore or a trivy.yaml on its own.
    expect(built[0]!.with).toEqual({ 'persist-credentials': false, path: 'src' });
    expect([built[0]!.if, built[1]!.if]).toEqual(['matrix.context', 'matrix.context']);
    expect(built[1]!.id).toBe('build_context');
    expect(built[1]!.env).toEqual({ CONTEXT: '${{ matrix.context }}', REF: '${{ matrix.ref }}' });
    expect(built[1]!.run).toMatch(/^set -euo pipefail$/m);
    expect(built[1]!.run).toContain('docker build --pull --platform "$TRIVY_PLATFORM" --tag "$REF" "src/$CONTEXT"');
    expect(built[1]!.run, 'a build here pushes nothing').not.toMatch(/--push|docker push|docker login/);
    // Every other step runs on every leg, or on every leg but a test-only
    // one's (the SARIF and its upload, the case of the tiers below); none on
    // the tasks' leg alone, which builds nothing since 2026-11-06.
    expect(scan!.steps.filter((s) => s.if && s.if !== 'always()' && s.if !== NOT_TEST_ONLY && !built.includes(s))).toEqual([]);
    expect(JSON.stringify(scan), 'a step of the tasks\' build is left').not.toMatch(/matrix\.build|containerfile|steps\.(install|build)\.outcome/);
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

  it('runs nothing before the scan on a leg that builds nothing, but the install of the Trivy it runs', () => {
    const trivyAt = scan!.steps.findIndex((s) => s.uses?.startsWith('aquasecurity/trivy-action@'));
    // Every step before the scan is a `context` leg's build (its checkout
    // and its build), but the last, which installs the Trivy the scan runs,
    // on every leg (2026-11-04, a-pin-that-knows-it-is-behind holds what it does).
    const installAt = scan!.steps.findIndex((s) => typeof s.env?.INSTALL_TRIVY_VERSION === 'string');
    expect(installAt, 'the step that installs Trivy comes right before the scan').toBe(trivyAt - 1);
    expect(scan!.steps[installAt]!.if).toBeUndefined();
    for (const step of scan!.steps.slice(0, installAt)) expect(step.if, `${step.name ?? step.uses} runs on every leg`).toBe('matrix.context');
  });

  it("checks the repository out under src/, so the scan's working directory holds no .trivyignore or trivy.yaml of its own", () => {
    // trivy-action sets TRIVY_IGNOREFILE and TRIVY_CONFIG only when asked, so
    // Trivy, and `trivy convert` after it, read `.trivyignore` and `trivy.yaml`
    // from the working directory. A checkout there would let a file at the
    // repository's root drop findings from this one leg's SARIF, and code
    // scanning would call them fixed.
    const trivyAt = scan!.steps.findIndex((s) => s.uses?.startsWith('aquasecurity/trivy-action@'));
    const [checkout] = scan!.steps.slice(0, trivyAt);
    expect(checkout!.uses).toMatch(/^actions\/checkout@/);
    expect(checkout!.with?.path).toBe('src');
    // An image built here is built from that checkout, so from src/ too.
    const scripted = scan!.steps.slice(0, trivyAt).filter((s) => s.if === 'matrix.context' && s.run);
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
    // Except for a test-only image (the case of the tiers below).
    expect([convert.if, upload.if]).toEqual([NOT_TEST_ONLY, NOT_TEST_ONLY]);
    expect(upload.with).toMatchObject({ sarif_file: 'trivy-image-${{ matrix.name }}.sarif', category: 'trivy-image-${{ matrix.name }}' });
    const keep = scan!.steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'))!;
    expect(keep.with).toMatchObject({ name: 'trivy-image-${{ matrix.name }}', path: 'trivy-image-${{ matrix.name }}.json', 'if-no-files-found': 'error' });
  });

  it("skips the SARIF and its upload exactly for a test-only image, and keeps its JSON for the report (the owner, 2026-11-03)", () => {
    const tiered = scan!.steps.filter((s) => s.if?.includes('matrix.tier'));
    expect(tiered.map((s) => s.name)).toEqual(['Turn the image report into SARIF', "Upload the image's SARIF to code scanning"]);
    for (const step of tiered) expect(step.if, step.name).toBe(NOT_TEST_ONLY);
    // The scan and the artifact the report job reads run on every leg, a test-only one's included.
    const trivy = scan!.steps.find((s) => s.uses?.startsWith('aquasecurity/trivy-action@'))!;
    const keep = scan!.steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'))!;
    expect([trivy.if, keep.if]).toEqual([undefined, undefined]);
    // And the check that ends the leg reads the tier from the matrix the list wrote.
    expect(scan!.steps.at(-1)!.env?.TIER).toBe('${{ matrix.tier }}');
  });

  it("each leg's check passes a test-only leg on its JSON with the upload skipped, and fails one code scanning took", () => {
    const check = scan!.steps.at(-1)!;
    const dir = mkdtempSync(join(tmpdir(), 'image-scan-check-'));
    try {
      const run = (tier: string, files: { json: boolean; sarif: boolean }, upload: string) => {
        for (const ext of ['json', 'sarif']) rmSync(join(dir, `trivy-image-x.${ext}`), { force: true });
        if (files.json) writeFileSync(join(dir, 'trivy-image-x.json'), '{"SchemaVersion":2}');
        if (files.sarif) writeFileSync(join(dir, 'trivy-image-x.sarif'), '{"version":"2.1.0"}');
        // As the runner renders the step's env for a leg named `x`; bash as GitHub runs a `run:` block.
        const env = {
          PATH: process.env.PATH!,
          NAME: 'x',
          REF: 'example/x:1.0.0',
          TIER: tier,
          JSON: 'trivy-image-x.json',
          SARIF: 'trivy-image-x.sarif',
          CONTEXT_BUILD_OUTCOME: 'skipped',
          TRIVY_OUTCOME: 'success',
          UPLOAD_OUTCOME: upload,
        };
        return spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', check.run!], { cwd: dir, env, encoding: 'utf8' });
      };
      const production = run('production-internal', { json: true, sarif: true }, 'success');
      expect(production.status, production.stdout + production.stderr).toBe(0);
      expect(production.stdout).toContain('code scanning took the SARIF');
      const notUploaded = run('production-internal', { json: true, sarif: false }, 'skipped');
      expect(notUploaded.status).toBe(1);
      expect(notUploaded.stdout).toContain('no trivy-image-x.sarif was written');
      expect(notUploaded.stdout).toContain("the SARIF upload ended 'skipped'");
      const testOnly = run('test-only', { json: true, sarif: false }, 'skipped');
      expect(testOnly.status, testOnly.stdout + testOnly.stderr).toBe(0);
      expect(testOnly.stdout).toContain('Test-only, so nothing went to code scanning.');
      const tookIt = run('test-only', { json: true, sarif: true }, 'success');
      expect(tookIt.status).toBe(1);
      expect(tookIt.stdout).toContain("the SARIF upload ended 'success' for a test-only image");
      const noJson = run('test-only', { json: false, sarif: false }, 'skipped');
      expect(noJson.status).toBe(1);
      expect(noJson.stdout).toContain('no trivy-image-x.json was written');
      // A leg with no tier (a list from before the tiers) is held to the SARIF, as before them.
      const untiered = run('', { json: true, sarif: false }, 'skipped');
      expect(untiered.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('each leg asserts its own report: the scan, a non-empty JSON and SARIF, and the upload', () => {
    const check = scan!.steps.at(-1)!;
    expect(check.if).toBe('always()');
    expect(check.env).toMatchObject({
      TIER: '${{ matrix.tier }}',
      CONTEXT_BUILD_OUTCOME: '${{ steps.build_context.outcome }}',
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

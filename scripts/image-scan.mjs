#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY IMAGE THE STACKS RUN, SCANNED ONCE A WEEK (workplan 0146 T8, the scan
 * half). Report only.
 *
 * Until 2026-10-22 no container image was scanned. Security Scan ran Trivy
 * with `scan-type: fs`, which reads the repository's lockfiles, and 0135 §1
 * already said so: it scans files, not images. So an operating system past its
 * end of life, or a CVE in an image whose tag never moved, was reported by
 * nothing. Redis's `7-alpine` runs on Alpine 3.21, which leaves support on
 * 2026-11-01, and a person reading release pages is what found it. The pin
 * watch (`idp-pin-watch.mjs`) says when a newer TAG exists; this says what is
 * inside the one that runs.
 *
 * THREE COMMANDS, all run by `.github/workflows/security-scan.yml` on its
 * weekly schedule and on dispatch, on GitHub-hosted runners only:
 *
 *   list    every image the stacks run, as the matrix of the scan job. Read
 *           with the pin watch's reader (`readImages`, which resolves
 *           `${VAR:-default}` to its default and keeps a digest apart from
 *           its tag), never a second compose parser:
 *             - every `image:` line of the compose files the pin watch reads
 *               (managed.yml, dev.yml, www.yml) and the appliance's
 *               deploy/selfhost/compose.yml. One named `localhost/<name>`
 *               is built by compose from `<name>/Dockerfile` beside the file
 *               (its `build:`), and no registry serves it (Postgres without
 *               gosu since workplan 0146 T15, deploy/compose/postgres, and
 *               the appliance's since T15b, deploy/selfhost/postgres;
 *               Trigger.dev's webapp and supervisor without the files nothing
 *               here runs since 0146 T16, under the names `trigger.dev` and
 *               `supervisor` the pulled images had; the Docker socket proxy,
 *               upstream's v0.5.0 on a current HAProxy, since 2026-10-30,
 *               deploy/compose/docker-socket-proxy, under the name
 *               `docker-socket-proxy` the pulled image had; the dashboard's TLS
 *               front, Caddy's image without curl, since 2026-10-31,
 *               deploy/compose/caddy, under the name `caddy` the pulled
 *               image had), so its leg builds that
 *               directory for linux/arm64 and scans what it built
 *               (`context`); the Dockerfile must be there;
 *             - every image a script in deploy/compose or deploy/selfhost
 *               names in a literal `…IMAGE=` assignment (GoAccess, Stalwart
 *               for the demo), deduplicated against the compose files of its
 *               stack. One named `localhost/<name>`
 *               is built by its script from `<name>/Dockerfile` beside it, and
 *               no registry serves it (GoAccess since #1675: upstream's image
 *               is on an Alpine past its end of life), so its leg builds that
 *               directory for linux/arm64 and scans what it built
 *               (`context`); the Dockerfile must be there;
 *             - the tasks' image (`trigger-task-base`), which no file here
 *               names, BUILT in the scan job (see `containerfile` below): the
 *               `base` stage a task deploy builds, on the image
 *               apps/api/Dockerfile builds FROM, where
 *               apps/worker/trigger.config.ts builds the tasks on it (the
 *               pin watch's `TASK_ON_API_IMAGE`, workplan 0146 T14), and
 *               otherwise on the one the pinned Trigger.dev CLI names for the
 *               tasks' runtime (the pin watch's `cliBaseImage`), with the
 *               layers the config adds to it at a deploy;
 *             - Ownpace's own three images, at `:edge` (what main publishes,
 *               which the OTA stack builds every night) and at the newest
 *               release tag (what live runs: it builds the tag it deploys).
 *           The FROM bases of apps/*\/Dockerfile (node, distroless, nginx)
 *           are inside Ownpace's images and are not scanned twice, except the
 *           API's Node line as the tasks' base, which is an image of its own.
 *           www.yml's nginx is, because the site runs it as it is.
 *           Each carries its `tier` (`IMAGE_TIERS`, below), and a name with
 *           none fails the list.
 *   report  reads the report each scan wrote, one per image. A missing or
 *           unreadable report is an error and fails the run: a scan that did
 *           not happen must never read like a week without findings. An
 *           image whose operating system Trivy calls past its end of life
 *           (`.Metadata.OS.EOSL`, which only the JSON report carries; SARIF
 *           never shows it) gets a `::warning::`, a line in the job summary,
 *           and one issue, kept open while it lasts and closed when it ends,
 *           by a run on main only (`ISSUES_REF`): a run dispatched on a pull
 *           request's branch scans that branch's images, and its report says
 *           what it found and touches no issue.
 *           Findings fail nothing: a CVE published upstream on a Sunday
 *           cannot turn main red. They go to code scanning as SARIF, one
 *           category per image, except a test-only image's (the tiers,
 *           below). The log and the job summary lead with the totals of each
 *           tier, production first; then they name the critical ones one by
 *           one, and since 2026-11-03 every critical and high one by package
 *           where it sits: with a fix, the version that clears them; without
 *           one, a count (`inventoryLines`). Each list goes by tier, then in
 *           its own order.
 *   containerfile <base>
 *           the tasks' image as `trigger.dev deploy` builds it, up to the
 *           task code: the `base` stage of the Containerfile the CLI writes,
 *           on the base image the list named. It runs the build extensions
 *           of `apps/worker/trigger.config.ts`, as the CLI does, and writes
 *           the instructions of every layer they add. So this one command
 *           needs the workspace installed; the list and the report do not.
 *           Workplan 0146 T10: until 2026-10-25 the scan read the base image
 *           alone, while every deploy copied the API image's Node over it
 *           and upgraded its Debian packages, so findings the deploy fixes
 *           stayed open in code scanning for good.
 *
 * Names are kept as steady as they can be, because a SARIF category that
 * stops being uploaded leaves its alerts open in code scanning for good. An
 * image is named after the last part of its repository (`redis`,
 * `clickhouse-server`), with its stack added when that name occurs in both
 * stacks (`postgres-managed`, `postgres-selfhost`), whether or not the two
 * references are the same. A stack is the directory, `managed` for
 * deploy/compose and `selfhost` for deploy/selfhost, and an image is listed
 * once per stack it runs in: so moving a pin keeps the name, and two pins
 * that converge on one reference, or part again, keep both. Ownpace's are
 * `ownpace-<image>-edge` and `ownpace-<image>-release`, whatever the release
 * is called.
 *
 * A name still changes when its image leaves the stacks, or when its short
 * name starts or stops occurring in both; and while one stack runs two
 * references of one image (a pin moved in one file and not yet in another),
 * the second has its file's name added (`postgres-managed-dev`) and drops it
 * when the two meet again. An old `trivy-image-<name>`
 * configuration then stays in code scanning with its alerts open, and the
 * owner deletes it on the code scanning tool status page (the Security tab,
 * Code scanning, Tool status). Its issue, if it had one, the report job
 * closes itself.
 *
 * EVERY IMAGE HAS A TIER, AND THE REPORT LEADS WITH PRODUCTION (the owner,
 * 2026-11-03, workplan 0119). The report weighed the demo's Nextcloud like
 * live's sign-in: five of the seven criticals of 2026-11-02 were in images
 * live never runs, Nextcloud's four and Stalwart's one, and code scanning
 * listed them beside live's. So each listed image carries one of `TIERS`, from
 * `IMAGE_TIERS` by its name, and the summary opens with each tier's totals,
 * production-public first and test-only last, said to be not in production.
 * A test-only image is still scanned and reported, its end of life included,
 * but security-scan.yml uploads no SARIF for it: its category stops, as above
 * for a name that changes, and the alerts it left open (`trivy-image-nextcloud`,
 * `-stalwart`, `-mailpit`) the owner dismissed as used in tests on 2026-11-03.
 *
 * THE TASKS' IMAGE KEEPS THE NAME IT HAD, `trigger-task-base`, which now
 * names the `base` stage it is: the stage of the CLI's Containerfile that
 * every later one starts from, the runtime's included, before the task code,
 * its `node_modules` and its index are copied in. Keeping it keeps the SARIF
 * category, so the first scan on `main` that reads the built stage closes the
 * alerts the deploy's layers fixed, with nothing to delete by hand.
 *
 * AND ITS ALERTS KEEP THEIR NUMBERS: the leg builds under the base's own
 * repository (`taskBuildTag`), never under a name of its own. Trivy's SARIF
 * gives an operating-system package's finding the image's repository as its
 * location (`ToPathUri` in its `pkg/report/sarif.go`, read at v0.76.1:
 * `node` for the API image's base since T14, `triggerdotdev/node` for the
 * CLI's before it, by tag and digest or not), and writes no
 * fingerprint, so code scanning tells one alert from another by rule and
 * location. Built as `trigger-task-base:built`, the location would have been
 * `library/trigger-task-base`: every Debian alert would close on the first
 * scan, fixed or not, and the ones without a fix would open again under new
 * numbers, their triage left on the closed ones. The tag is local: Trivy reads
 * that leg's image from the runner's Docker alone, and nothing pushes it.
 *
 * What the built stage leaves out is npm packages only: the bundled task
 * code, and the externals the CLI installs with `npm i` at a deploy (`pg`,
 * `@electric-sql/pglite`). Their own versions are the ones installed here, so
 * the repository scan of the lockfile reads them; the packages npm resolves
 * under them, with no lockfile, neither scan reads. And it is built on the
 * base the deploy config names (apps/api/Dockerfile's FROM image since
 * workplan 0146 T14), or else on the CLI's own: a Trigger.dev instance can
 * name other base images for its deploys (the webapp's `DEPLOY_BASE_IMAGES`
 * and `DEPLOY_BUILD_BASE_IMAGES`, which the CLI builds on when the instance
 * sends them, `applyServerBaseImages` read at 4.7.6), and `managed.yml`, which
 * hands its Trigger.dev services only the keys it lists, sets neither. The
 * guard holds that.
 *
 * A floating tag (`busybox:1.38`) is scanned as the registry serves it
 * today, which need not be what the box pulled last. The summary says which.
 * A built image is the same kind of reading: its packages are Debian's on the
 * day of the scan, while a deploy that the CLI's builder serves from its cache
 * keeps the packages of the build that filled it (the comment above
 * `defineConfig` in `trigger.config.ts`).
 *
 * `.mjs` for the reason `idp-pin-watch.mjs` gives: a CI step on a bare
 * checkout, no `node_modules` (except `containerfile`, above). Its guard,
 * `scripts/an-image-nobody-scanned.unit.test.ts`, runs it on the real
 * checkout with a stubbed network and a fake `gh`.
 */

import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { COMPOSE_FILES, TASK_ON_API_IMAGE, cliBaseImage, keepIssue, parseRef, readImages, realNet, repoReader, tagsOf } from './idp-pin-watch.mjs';
import { compareSemVer, parseSemVer } from './release-names-agree.mjs';

/** The compose files whose `image:` lines are scanned: the pin watch's, and the appliance's. */
export const SCAN_FILES = [...COMPOSE_FILES, 'deploy/selfhost/compose.yml'];

/** The directories whose scripts may name an image of their own. */
export const SCRIPT_DIRS = ['deploy/compose', 'deploy/selfhost'];

/** Where Ownpace's own images are published, and which: images.yml's matrix. */
export const OWNPACE_REGISTRY = 'ghcr.io/robbes';
export const OWNPACE_IMAGES = ['api', 'web', 'selfhost'];

/**
 * The tasks' image: its name (and so its SARIF category, `trivy-image-trigger-task-base`,
 * unchanged since 2026-10-22), and the deploy config whose layers are built on its base.
 */
export const TASK_IMAGE = 'trigger-task-base';
export const TASK_CONFIG = 'apps/worker/trigger.config.ts';

/**
 * The Dockerfile whose FROM image the tasks build on, where trigger.config.ts
 * says so (0146 T14), and that line as the config reads it: a Node image by
 * tag and digest.
 */
export const API_DOCKERFILE = 'apps/api/Dockerfile';
const API_FROM = /^FROM\s+(node:\S+@sha256:[0-9a-f]{64})(?:\s|$)/m;

/** Every image issue's title starts with this, and ends with the image's name. */
export const ISSUE_PREFIX = "An image's operating system is past its end of life: ";

/**
 * The only ref whose run keeps the issues: main, where the schedule runs and
 * where the stacks take their images from. A run dispatched on a pull
 * request's branch scans the images that branch would bring, so its report
 * would close an issue for a fix main does not have yet, or open one for an
 * image main does not run (#1675 would have closed on a dispatch of the
 * branch that fixes it, before its merge, and the next Monday on main would
 * have opened it again under a new number).
 */
export const ISSUES_REF = 'refs/heads/main';

/**
 * WHERE EACH IMAGE RUNS, AND SO WHAT ITS FINDINGS WEIGH (the owner, 2026-11-03,
 * workplan 0119). Every listed image has one tier, and the order here is the
 * report's: production first, test-only last.
 *
 *   production-public    the internet reaches it on live, through the mesh
 *                        provider's ingress to a routed port (managed.env.example,
 *                        "THE ROUTED PORTS NEED THEIRS"), or behind one that is;
 *   production-internal  live runs it, on the stack's own network or on a port
 *                        published on loopback or the mesh only;
 *   shipped              what self-hosters run: the appliance's images;
 *   test-only            development, the demo and CI only, never live. Its
 *                        findings are in the report and go to no code scanning
 *                        category (security-scan.yml skips its SARIF): the
 *                        owner's decision of 2026-11-03.
 */
export const TIERS = ['production-public', 'production-internal', 'shipped', 'test-only'];

/** What each tier means, as the report's headline says it. */
export const TIER_MEANS = {
  'production-public': 'what the internet reaches on live',
  'production-internal': 'live runs it, and nothing beyond its machine and the mesh reaches it',
  shipped: 'what self-hosters run: the appliance',
  'test-only': '**not in production**: development, the demo and CI only, and not sent to code scanning',
};

/**
 * EVERY IMAGE'S TIER, BY THE NAME THE LIST GIVES IT. A name with no tier here
 * fails the list, so a new image is placed before its first scan; a second
 * reference in one stack (`postgres-managed-dev`, the file's name added) takes
 * its first's. Where each runs, as read on 2026-11-03:
 */
export const IMAGE_TIERS = {
  // The site, www.ownpace.eu: www.yml, the name routed to WWW_PORT on WWW_BIND
  // (www.yml's header); live's copy is deploy-live.sh's.
  nginx: 'production-public',
  // Sign-in, id.ownpace.eu: routed to live's ZITADEL_PORT on ZITADEL_BIND
  // (managed-bring-up.md, the routes before the bring-up; stand-up-live.sh's
  // LIVE_IDP).
  zitadel: 'production-public',
  // The status page, status.ownpace.eu: routed to live's STATUS_PORT on
  // STATUS_BIND, the same three routes (stand-up-live.sh's LIVE_STATUS,
  // docs/status-page.md).
  gatus: 'production-public',
  // The app, app.ownpace.eu, routed to WEB_PORT on WEB_BIND; its nginx proxies
  // /api/ to the API (apps/web/nginx.conf.template), whose own API_BIND stays
  // empty. Live builds the release tag it deploys; `:edge` is what main
  // publishes, what the OTA stack builds every night, and the next release.
  'ownpace-web-edge': 'production-public',
  'ownpace-web-release': 'production-public',
  'ownpace-api-edge': 'production-public',
  'ownpace-api-release': 'production-public',
  // managed.yml's services that bootstrap-managed.sh's phase_app starts by name
  // on live, published on loopback or not at all: the ledger's and Trigger.dev's
  // databases (POSTGRES_BIND empty), the pooler, Trigger.dev's plane, its
  // object store and its registry (127.0.0.1 only).
  'postgres-managed': 'production-internal',
  pgbouncer: 'production-internal',
  redis: 'production-internal',
  'trigger.dev': 'production-internal',
  'clickhouse-server': 'production-internal',
  registry: 'production-internal',
  'docker-socket-proxy': 'production-internal',
  supervisor: 'production-internal',
  minio: 'production-internal',
  // The Trigger.dev dashboard's TLS front (trigger-tls), not a public one: a
  // certificate no public CA signs (`tls internal`), on loopback, or on the mesh
  // address TRIGGER_TLS_BIND names; live's is opened on localhost or through a
  // tunnel (stand-up-live.sh).
  caddy: 'production-internal',
  // The identity provider's one-shot chown, which the bring-up runs with
  // `compose run` (managed.yml's zitadel-machinekey, profile `init`).
  busybox: 'production-internal',
  // site-visits.sh, the daily duty that counts the visits to live's site
  // (box-duties.sh): no network, no port.
  goaccess: 'production-internal',
  // The image live's task runs run in, built by each deploy of the tasks.
  'trigger-task-base': 'production-internal',
  // The appliance: its image and its Postgres (deploy/selfhost/compose.yml).
  'postgres-selfhost': 'shipped',
  'ownpace-selfhost-edge': 'shipped',
  'ownpace-selfhost-release': 'shipped',
  // Never live (the owner, 2026-11-03). Mailpit catches the OTA stack's and the
  // demo's mail; live sends through a relay, and stand-up-live.sh refuses
  // SMTP_HOST=mailpit. Nextcloud is the demo's DAV backend and a test fixture;
  // phase_app starts it only with --with-demo, which live's scripts refuse.
  // Stalwart is a CI test fixture and the demo's mail backend (ADR-0022),
  // brought up by setup-stalwart.sh, never by live.
  mailpit: 'test-only',
  nextcloud: 'test-only',
  stalwart: 'test-only',
};

/** The tier of an image the list names `name`: IMAGE_TIERS's, or an error that says what to do. */
export function tierOf(name) {
  const tier = Object.hasOwn(IMAGE_TIERS, name) ? IMAGE_TIERS[name] : undefined;
  if (!TIERS.includes(tier)) {
    throw new Error(
      `${name} has no tier in image-scan.mjs's IMAGE_TIERS: say where it runs (${TIERS.join(', ')}) before it is scanned, since the report leads with production and a test-only image goes to no code scanning category`,
    );
  }
  return tier;
}

/** Where an image's tier puts it in the report: 0 for production-public. An image without a valid tier is an error. */
function tierRank(image) {
  const rank = TIERS.indexOf(image?.tier);
  if (rank < 0) throw new Error(`${image?.name ?? 'an image'} carries no tier the report knows (${TIERS.join(', ')})`);
  return rank;
}

/** What the report reads for a summary: the two severities the scan asks for. */
const SEVERITIES = ['CRITICAL', 'HIGH'];

/** A literal image in a script: `GOACCESS_IMAGE="localhost/goaccess:1.12"`, `IMAGE="stalwartlabs/stalwart:v0.16.10"`. */
const SCRIPT_IMAGE = /^\s*(?:readonly\s+|export\s+|local\s+)?(?:[A-Z][A-Z0-9_]*_)?IMAGE=(["'])([a-z0-9][^"'\s$]*)\1\s*(?:#.*)?$/gm;

const need = (repo, rel) => {
  const text = repo.read(rel);
  if (text === null) throw new Error(`${rel} is not in this checkout`);
  return text;
};

/** The stack each directory read here holds. */
export const STACKS = { 'deploy/compose': 'managed', 'deploy/selfhost': 'selfhost' };

/** The stack a file belongs to, by its directory: `managed` or `selfhost`. */
export function stackOf(file) {
  const stack = STACKS[dirname(file)];
  if (!stack) throw new Error(`${file} is in no stack this scan reads (${Object.keys(STACKS).join(', ')})`);
  return stack;
}

/** A tag that moves with its line: no digest, and fewer than three numbers (`7-alpine`, `1.38`, `34-apache`). */
export function isFloating(image) {
  return !image.digest && (image.tag.match(/\d+/g) ?? []).length < 3;
}

/**
 * The newest release tag, as the image tag images.yml gives it: `v0.2.0-alpha.1`
 * is published as `0.2.0-alpha.1`. Ordered by SemVer, so a pre-release comes
 * before its release and `alpha.10` after `alpha.9`. None is an error.
 */
export function newestReleaseTag(lsRemote) {
  const versions = tagsOf(lsRemote)
    .filter((tag) => tag.startsWith('v') && parseSemVer(tag.slice(1)))
    .map((tag) => tag.slice(1));
  if (versions.length === 0) throw new Error('the repository lists no v* release tag, so there is no release to scan');
  return versions.sort(compareSemVer).at(-1);
}

/** The registry no image is pulled from: an image named under it is built from a Dockerfile here. */
export const BUILT_HERE = 'localhost/';

/** The images a script names literally, each with its line. */
function scriptImages(text) {
  const images = [];
  for (const m of text.matchAll(SCRIPT_IMAGE)) {
    const image = parseRef(m[2]);
    if (!image.tag && !image.digest) continue;
    images.push({ line: text.slice(0, m.index).split('\n').length, ...image });
  }
  return images;
}

/**
 * Where a `localhost/<name>` image is built from: `<name>/` beside the file
 * that names it, which must hold a Dockerfile. Any other image is pulled: null.
 */
function buildContext(repo, dir, image) {
  if (!image.repo.startsWith(BUILT_HERE)) return null;
  const name = image.repo.slice(BUILT_HERE.length);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`${image.ref} names no directory a Dockerfile could be in`);
  const context = `${dir}/${name}`;
  if (repo.read(`${context}/Dockerfile`) === null) {
    throw new Error(`${image.ref} is built from ${context}/Dockerfile, which is not in this checkout: no registry serves it, so nothing could scan it`);
  }
  return context;
}

/**
 * Every image the stacks run, once each, in a stable order: the compose files,
 * the scripts, the tasks' base image, and Ownpace's own. Each has the name its
 * scan, its SARIF category, its artifact and its issue carry, the reference
 * Trivy pulls (or, for the one with `build`, the base its leg builds on and
 * the local tag it builds under), and where it comes from.
 */
export async function imagesToScan(repo, net, { upstream = 'origin' } = {}) {
  const ownpace = `${OWNPACE_REGISTRY}/ownpace-`;
  // Once per stack and reference: one reference both stacks run is two scans,
  // so neither name moves when two pins converge.
  const byStackRef = new Map();
  const add = (image, where, context = null) => {
    if (image.repo.startsWith(ownpace)) return;
    const stack = stackOf(where);
    const key = `${stack}\n${image.ref}`;
    if (!byStackRef.has(key)) byStackRef.set(key, { ...image, stack, context, where: [] });
    if (!byStackRef.get(key).where.includes(where)) byStackRef.get(key).where.push(where);
  };
  for (const file of SCAN_FILES) {
    for (const image of readImages(need(repo, file))) add(image, file, buildContext(repo, dirname(file), image));
  }
  for (const dir of SCRIPT_DIRS) {
    for (const name of repo.list(dir).filter((n) => n.endsWith('.sh')).sort()) {
      for (const image of scriptImages(need(repo, `${dir}/${name}`))) add(image, `${dir}/${name}`, buildContext(repo, dir, image));
    }
  }

  // Named after the repository's last part, with the stack where both stacks
  // run that name. Where one stack runs two references of it (a pin moved in
  // one file and not yet in another), the first read keeps the name and the
  // other adds its file's (`postgres-managed-dev`), until they meet again.
  const images = [...byStackRef.values()];
  const short = (image) => image.repo.split('/').at(-1);
  const stacks = new Map();
  for (const image of images) stacks.set(short(image), new Set([...(stacks.get(short(image)) ?? []), image.stack]));
  const taken = new Set();
  const entries = images.map((image) => {
    const base = stacks.get(short(image)).size > 1 ? `${short(image)}-${image.stack}` : short(image);
    const name = taken.has(base) ? `${base}-${basename(image.where[0]).replace(/\.(ya?ml|sh)$/, '')}` : base;
    taken.add(base);
    // The tier is the short name's: a second reference in one stack is the same image.
    const tier = tierOf(base);
    // A built image's pins are its Dockerfile's, so its tag does not float.
    if (image.context) return { name, tier, ref: image.ref, where: image.where.join(', '), floating: false, context: image.context };
    return { name, tier, ref: image.ref, where: image.where.join(', '), floating: isFloating(image) };
  });

  // The tasks' image, scanned as a deploy builds it: the leg builds its `base`
  // stage (`containerfile`) under `build` and scans that, not the reference.
  // Its base: where trigger.config.ts builds the tasks on the API image's own
  // base (0146 T14), the CLI's base image is in nothing a deploy builds, and
  // the base is the API Dockerfile's FROM node image, read as the config reads
  // it. Otherwise the CLI names it, for the runtime the config asks for. The
  // name stays, and so does the SARIF category.
  const config = need(repo, TASK_CONFIG);
  let base;
  let where;
  if (TASK_ON_API_IMAGE.test(config)) {
    base = API_FROM.exec(need(repo, API_DOCKERFILE))?.[1];
    if (!base) throw new Error(`${API_DOCKERFILE} has no FROM node:<tag>@sha256:<digest> line, and the tasks build on it`);
    where = `${API_DOCKERFILE}'s FROM line, which ${TASK_CONFIG} builds the tasks on, with the layers it adds at a deploy`;
  } else {
    const runtime = /\bruntime:\s*['"]([^'"]+)['"]/.exec(config)?.[1];
    if (!runtime) throw new Error(`${TASK_CONFIG} names no runtime`);
    const cli = JSON.parse(need(repo, 'apps/worker/package.json')).dependencies?.['@trigger.dev/sdk'];
    if (!/^\d+\.\d+\.\d+$/.test(cli ?? '')) throw new Error(`apps/worker's @trigger.dev/sdk is ${cli}, not a version`);
    base = await cliBaseImage(net, cli, runtime);
    where = `trigger.dev ${cli}'s BASE_IMAGE['${runtime}'], with the layers ${TASK_CONFIG} adds at a deploy`;
  }
  entries.push({ name: TASK_IMAGE, tier: tierOf(TASK_IMAGE), ref: base, where, floating: false, build: taskBuildTag(base) });

  // Ownpace's own: what main publishes, and the newest release.
  const release = newestReleaseTag(await net.lsRemote(upstream));
  for (const image of OWNPACE_IMAGES) {
    const edge = `ownpace-${image}-edge`;
    const tagged = `ownpace-${image}-release`;
    entries.push({ name: edge, tier: tierOf(edge), ref: `${ownpace}${image}:edge`, where: 'main (images.yml)', floating: true });
    entries.push({ name: tagged, tier: tierOf(tagged), ref: `${ownpace}${image}:${release}`, where: `v${release}, the newest release tag (images.yml)`, floating: false });
  }

  // Two images of one name would share a category, and each upload would
  // replace the other's.
  const seen = new Map();
  for (const { name, ref } of entries) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`${name} cannot name a scan, a SARIF category and an artifact`);
    if (seen.has(name)) throw new Error(`two images would both be named ${name}: ${seen.get(name)} and ${ref}`);
    seen.set(name, ref);
  }
  return entries;
}

// ------------------------------------------------------ the tasks' image ---

/** An image reference as the list writes one: no space, no newline, nothing a Containerfile would read as a second instruction. */
const IMAGE_REF = /^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?(?:@sha256:[0-9a-f]{64})?$/;

/**
 * The local tag the tasks' leg builds under: the base's repository, so the
 * SARIF location of every operating-system finding, and so the identity of
 * its alert, is the one the base's scans opened it at (the file's header).
 */
export function taskBuildTag(base) {
  if (typeof base !== 'string' || !IMAGE_REF.test(base)) {
    throw new Error(`the tasks' base image must be an image reference, not ${JSON.stringify(base)}`);
  }
  return `${parseRef(base).repo}:${TASK_IMAGE}-built`;
}

/**
 * THE TASKS' IMAGE AS `trigger.dev deploy` BUILDS IT, up to the task code
 * (workplan 0146 T10): the `base` stage of the Containerfile the CLI writes
 * (`generateNodeContainerfile` in its `deploy/buildImage.js`, read at 4.7.6),
 * which every later stage, the runtime's included, starts from.
 *
 * The CLI calls every build extension's `onBuildStart`, then every one's
 * `onBuildComplete`, with a context whose `target` is `deploy`, and puts the
 * `image.instructions` of each layer they add into that stage, in order, as
 * root, after `ENV DEBIAN_FRONTEND=noninteractive`. This does the same with
 * the config itself, so whatever the config adds is what gets scanned, and no
 * instruction or version is written here a second time.
 *
 * Two of the CLI's steps after the layers are left out because they install
 * nothing a scan reads: an `apt-get --fix-broken install` that repairs dpkg
 * state an instruction left broken, and the edits to the CA trust store. A
 * layer's `image.pkgs` is refused rather than left out, since the CLI installs
 * those with apt in this stage: the scan would read less than the deploy
 * builds. The CLI logs a throw in `onBuildComplete` and deploys without that
 * layer; here any throw stops the scan, so a base read without its layers can
 * never pass for the image a deploy built.
 */
export async function taskBaseStage(config, { base, workingDir }) {
  if (typeof base !== 'string' || !IMAGE_REF.test(base)) {
    throw new Error(`the tasks' base image must be an image reference, not ${JSON.stringify(base)}`);
  }
  const layers = [];
  const context = { target: 'deploy', config, workingDir, addLayer: (layer) => layers.push(layer) };
  const extensions = config?.build?.extensions ?? [];
  for (const extension of extensions) await extension.onBuildStart?.(context);
  for (const extension of extensions) await extension.onBuildComplete?.(context, {});
  const instructions = [];
  for (const layer of layers) {
    if ((layer.image?.pkgs ?? []).length > 0) {
      throw new Error(
        `the layer ${layer.id} installs ${layer.image.pkgs.join(', ')} with apt, which the deploy's base stage carries and this does not build: the scan would read less than the deploy builds`,
      );
    }
    instructions.push(...(layer.image?.instructions ?? []));
  }
  // No `# syntax=` line, though the CLI writes one: it would pull the floating
  // `docker/dockerfile:1` frontend on every scan, and FROM, ENV, COPY --from
  // and RUN need nothing beyond the builder's own.
  return [
    `# The tasks' image up to the task code: the base stage of the Containerfile a`,
    `# task deploy builds, as scripts/image-scan.mjs containerfile writes it from`,
    `# ${TASK_CONFIG} (workplan 0146 T10). Built and scanned, never pushed.`,
    `FROM ${base} AS base`,
    '',
    'ENV DEBIAN_FRONTEND=noninteractive',
    '',
    ...instructions,
    '',
  ].join('\n');
}

// ------------------------------------------------------------ reports ----

/**
 * What one Trivy JSON report says: the operating system, whether its
 * distribution still supports it, and how many findings of each severity, and
 * how many of those a newer package fixes. Anything that is not a Trivy image
 * report is an error, never "nothing found".
 *
 * The critical findings are also listed one by one (2026-10-26): a count says
 * how many, and not whether a rebuild, a newer tag or only upstream can clear
 * them. Code scanning has the detail, but only for those with write access;
 * the run's summary is read by anyone who reads the run. A CVE counted once per
 * binary package of one source (util-linux's, say) is listed once per package.
 *
 * And every critical and high finding is grouped by package where it sits
 * (2026-11-03): with a fix, the version that clears them all; without one, a
 * count (`withFix`, `withoutFix`, and `inventoryLines` below).
 */
export function readReport(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error('the report is not JSON');
  }
  if (report?.SchemaVersion !== 2 || report?.ArtifactType !== 'container_image') {
    throw new Error('the report is not a Trivy image report (SchemaVersion 2, container_image)');
  }
  const os = report.Metadata?.OS;
  const osName = os?.Family ? `${os.Family} ${os.Name ?? ''}`.trim() : null;
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  let fixable = 0;
  const criticals = [];
  const groups = new Map();
  for (const result of report.Results ?? []) {
    for (const vuln of result.Vulnerabilities ?? []) {
      if (SEVERITIES.includes(vuln.Severity)) addToGroup(groups, result, vuln, osName);
      if (vuln.Severity in counts) counts[vuln.Severity] += 1;
      if (vuln.FixedVersion) fixable += 1;
      if (vuln.Severity === 'CRITICAL') {
        criticals.push({
          id: vuln.VulnerabilityID ?? 'an unnamed finding',
          pkg: vuln.PkgName ?? 'an unnamed package',
          installed: vuln.InstalledVersion ?? '',
          fixed: vuln.FixedVersion ?? '',
          // An OS package is the image's; anything else is named by its path.
          where: result.Class === 'os-pkgs' ? 'the OS packages' : (vuln.PkgPath ?? result.Target ?? 'the image'),
        });
      }
    }
  }
  const packages = [...groups.values()].map((g) => ({
    target: g.target,
    pkg: g.pkg,
    installed: g.installed,
    severity: g.severity,
    ids: [...g.ids.entries()].sort(([a, sa], [b, sb]) => bySeverity(sa, sb) || compareVersions(a, b)).map(([id]) => id),
    ...(g.fixed.length > 0 ? { fix: neededFix(g.installed, g.fixed) } : {}),
  }));
  const ordered = (list) => list.sort((a, b) => bySeverity(a.severity, b.severity) || byText(a.pkg, b.pkg) || byText(a.target, b.target) || compareVersions(a.installed, b.installed));
  return {
    os: osName,
    eosl: os?.EOSL === true,
    critical: counts.CRITICAL,
    high: counts.HIGH,
    fixable,
    criticals,
    withFix: ordered(packages.filter((p) => 'fix' in p)),
    withoutFix: ordered(packages.filter((p) => !('fix' in p))),
  };
}

// ------------------------------------------ what a newer package fixes ---

/** The worse severity first: critical, then high. */
const bySeverity = (a, b) => SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Where a finding sits, as the inventory names it: the operating system for
 * its packages (`debian 12.15`, never the image reference Trivy's target
 * starts with), the package's own file where Trivy names one, as the directory
 * for an npm package (`…/node_modules/tar`, not its `package.json`), and the
 * result's target otherwise (`usr/local/bin/goose`, a Go binary).
 */
function targetOf(result, vuln, osName) {
  if (result.Class === 'os-pkgs') return osName ?? 'the OS packages';
  return String(vuln.PkgPath || result.Target || 'the image').replace(/\/package\.json$/, '');
}

/**
 * One finding into the group of its package where it sits, one group with a
 * fix and one without: (target, package, version installed). Two binary
 * packages of one source are two groups, as code scanning shows them; one id
 * is counted once per group.
 */
function addToGroup(groups, result, vuln, osName) {
  const fixed = String(vuln.FixedVersion ?? '').trim();
  const target = targetOf(result, vuln, osName);
  const pkg = vuln.PkgName ?? 'an unnamed package';
  const installed = vuln.InstalledVersion ?? '';
  const key = JSON.stringify([fixed !== '', target, pkg, installed]);
  if (!groups.has(key)) groups.set(key, { target, pkg, installed, severity: vuln.Severity, ids: new Map(), fixed: [] });
  const group = groups.get(key);
  const id = vuln.VulnerabilityID ?? 'an unnamed finding';
  if (bySeverity(vuln.Severity, group.severity) < 0) group.severity = vuln.Severity;
  if (!group.ids.has(id) || bySeverity(vuln.Severity, group.ids.get(id)) < 0) group.ids.set(id, vuln.Severity);
  if (fixed) group.fixed.push(fixed);
}

/**
 * A version as compared here: Go's leading `v` dropped (Trivy writes a Go
 * module's installed version `v1.24.6` and its fix `1.24.13`), and a
 * pre-release's `-rc.3` (`1.26.0-rc.3`, among Go's fixes) written as Debian's
 * `~`, which sorts before the release.
 */
const comparable = (version) =>
  String(version)
    .trim()
    .replace(/^v(?=\d)/, '')
    .replace(/-(?=(?:alpha|beta|rc|pre|preview|dev)(?![a-z]))/gi, '~');

/**
 * Two versions in order, as dpkg orders them (its `verrevcmp`), which orders
 * Alpine's, Go's and npm's well enough to choose among one package's own
 * fixes: a run of digits by its number (`1.24.13` after `1.24.9`), `~` before
 * anything, the end included, and letters before other characters. Negative,
 * zero or positive.
 */
export function compareVersions(a, b) {
  const x = comparable(a);
  const y = comparable(b);
  const digit = (c) => c !== undefined && c >= '0' && c <= '9';
  const order = (c) => (c === undefined || digit(c) ? 0 : c === '~' ? -1 : /[A-Za-z]/.test(c) ? c.charCodeAt(0) : c.charCodeAt(0) + 256);
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    while ((i < x.length && !digit(x[i])) || (j < y.length && !digit(y[j]))) {
      const d = order(x[i]) - order(y[j]);
      if (d !== 0) return d;
      i += 1;
      j += 1;
    }
    while (x[i] === '0') i += 1;
    while (y[j] === '0') j += 1;
    let first = 0;
    while (digit(x[i]) && digit(y[j])) {
      if (first === 0) first = x.charCodeAt(i) - y.charCodeAt(j);
      i += 1;
      j += 1;
    }
    if (digit(x[i])) return 1;
    if (digit(y[j])) return -1;
    if (first !== 0) return first;
  }
  return 0;
}

/** The fixes one finding names, in order: Trivy writes one per line it was fixed on, comma-separated (`1.24.13, 1.25.7, 1.26.0-rc.3`). */
const fixesOf = (fixed) => [...new Set(fixed.split(',').map((f) => f.trim()).filter(Boolean))].sort(compareVersions);

/** Where a fix's line starts, after the fix before it in its list: `1.25` for `1.25.7` after `1.24.13`, `7` for `7.5.2` after `6.2.1`. */
function lineStart(fix, before) {
  const runs = [...comparable(fix).matchAll(/\d+/g)];
  const prior = comparable(before).match(/\d+/g) ?? [];
  const at = runs.findIndex((run, k) => Number(run[0]) !== Number(prior[k]));
  return at === -1 ? fix : comparable(fix).slice(0, runs[at].index + runs[at][0].length);
}

/**
 * Whether a version clears a finding with these fixes, one per line: below the
 * first it does not, nor on a later fix's line below that fix (`1.25.3`
 * against `1.24.13, 1.25.7`).
 */
function clears(version, fixes) {
  if (compareVersions(version, fixes[0]) < 0) return false;
  for (let k = 1; k < fixes.length; k += 1) {
    if (compareVersions(version, lineStart(fixes[k], fixes[k - 1])) >= 0 && compareVersions(version, fixes[k]) < 0) return false;
  }
  return true;
}

/**
 * The version a package must reach to clear every finding of it at once: the
 * lowest of the fixes they name, above the version installed, that clears them
 * all. So the highest fix they need, read per line: a Go binary on 1.24.6 with
 * `1.24.13, 1.25.7` needs 1.24.13, not 1.25.7; and with a second finding fixed
 * only in `1.25.2` it needs 1.25.7, since 1.25.2 is still below the first
 * finding's fix on that line.
 */
export function neededFix(installed, fixedVersions) {
  const lists = fixedVersions.map(fixesOf).filter((list) => list.length > 0);
  const all = [...new Set(lists.flat())].sort(compareVersions);
  const above = all.filter((v) => !installed || compareVersions(v, installed) > 0);
  const candidates = above.length > 0 ? above : all;
  return candidates.find((v) => lists.every((list) => clears(v, list))) ?? candidates.at(-1) ?? '';
}

/** At most this many lines of each list per image; the rest is counted on a line of its own, never dropped unsaid. */
export const INVENTORY_LINES = 60;

/** How many ids a line names; it counts them all. */
const IDS_SHOWN = 4;

/** A field of the report as one plain line: no newline, no backtick to break the summary's Markdown. */
const plain = (value) => String(value).replace(/[\r\n`]+/g, ' ');

const findings = (n) => `${n} finding${n === 1 ? '' : 's'}`;

/** One package with a fix: what is installed, what clears it, the worst severity, and the ids. */
const fixLine = (p) =>
  `- \`${plain(p.pkg)}\`${p.installed ? ` ${plain(p.installed)}` : ''} → ${plain(p.fix)}, ${p.severity.toLowerCase()}, ${findings(p.ids.length)}: ${p.ids
    .slice(0, IDS_SHOWN)
    .map(plain)
    .join(', ')}${p.ids.length > IDS_SHOWN ? ` and ${p.ids.length - IDS_SHOWN} more` : ''} (${plain(p.target)})`;

/** One package without a fix: what is installed, the worst severity, and how many. */
const noFixLine = (p) => `- \`${plain(p.pkg)}\`${p.installed ? ` ${plain(p.installed)}` : ''}, ${p.severity.toLowerCase()}, ${findings(p.ids.length)} (${plain(p.target)})`;

/** A list of at most INVENTORY_LINES lines, and one more that counts the rest. */
function bounded(packages, line, kind, image) {
  const rest = packages.slice(INVENTORY_LINES);
  const more = rest.reduce((n, p) => n + p.ids.length, 0);
  return [
    ...packages.slice(0, INVENTORY_LINES).map(line),
    ...(rest.length > 0
      ? [`- … and ${rest.length} more package${rest.length === 1 ? '' : 's'} ${kind} (${findings(more)}), in the run's artifact \`trivy-image-${image.name}\``]
      : []),
  ];
}

/** An image's tier as a heading or a row names it: test-only says it is not in production. */
const tierNote = (tier) => (tier === 'test-only' ? 'test-only, not in production' : tier);

/**
 * The fixable inventory, image by image (2026-11-03): every critical and high
 * finding with a fix, by package where it sits, and those without one counted
 * by package. Code scanning shows each binary package of one source as an
 * alert of its own, and only to those with write access; the run's log and
 * summary are read by anyone who reads the run. Production first: by tier,
 * then the images with most to fix.
 */
export function inventoryLines(read) {
  const count = (packages) => packages.reduce((n, p) => n + p.ids.length, 0);
  const images = read
    .filter(({ report }) => report.withFix.length + report.withoutFix.length > 0)
    .sort(
      (a, b) =>
        tierRank(a.image) - tierRank(b.image) ||
        count(b.report.withFix) - count(a.report.withFix) ||
        count(b.report.withoutFix) - count(a.report.withoutFix),
    );
  if (images.length === 0) return [];
  const lines = [
    '',
    '### What a newer package fixes, image by image',
    '',
    `Each critical and high finding, by package where it sits: the version installed, the one that clears them all (the highest fix they need, on the installed version's line where Trivy names one fix per line, as \`1.24.13, 1.25.7\`), the worst severity, and the ids; then those no package fixes yet, counted by package. A CVE in a source package built into several binary packages is a line per package, as code scanning makes it an alert per package. The images come by tier, production first and test-only last, and within a tier those with most to fix first; at most ${INVENTORY_LINES} lines of each list are shown per image, the rest counted.`,
  ];
  for (const { image, report } of images) {
    lines.push('', `#### \`${image.name}\` (${tierNote(image.tier)})`);
    if (report.withFix.length > 0) {
      const ids = new Set(report.withFix.flatMap((p) => p.ids)).size;
      lines.push(
        '',
        `With a fix: ${findings(count(report.withFix))} in ${report.withFix.length} package${report.withFix.length === 1 ? '' : 's'}, ${ids} distinct id${ids === 1 ? '' : 's'}.`,
        '',
        ...bounded(report.withFix, fixLine, 'with a fix', image),
      );
    }
    if (report.withoutFix.length > 0) {
      lines.push(
        '',
        `No fix yet: ${findings(count(report.withoutFix))} in ${report.withoutFix.length} package${report.withoutFix.length === 1 ? '' : 's'}.`,
        '',
        ...bounded(report.withoutFix, noFixLine, 'with no fix yet', image),
      );
    }
  }
  return lines;
}

/** One critical finding as a line of the summary. */
const criticalLine = (name, c) =>
  `- \`${name}\`: ${c.id} in \`${c.pkg}\`${c.installed ? ` ${c.installed}` : ''}, ${c.fixed ? `fixed in ${c.fixed}` : '**no fix yet**'} (${c.where})`;

/** The issue for one image past its end of life, as `keepIssue` keeps it. */
export function eoslIssue(image, report) {
  const os = report.os ?? 'an operating system Trivy could not name';
  const body = [
    `\`${image.ref}\` (${image.where}) runs on **${os}**, which its distribution no longer supports: Trivy's report for it says \`EOSL\`, end of service life. Its packages get no more security fixes, so what the scan finds in them from now on stays open whatever else moves.`,
    '',
    image.context
      ? `This image is built here, from \`${image.context}/Dockerfile\`, and its base is the \`FROM\` there. The way out is a supported base in that file, by exact tag and digest. Dependabot moves that pin, a new line of the base included, in a pull request of its own (\`.github/dependabot.yml\`), and the pull request's checks build the image; read the base's release notes before merging it. An image of \`managed.yml\` takes E2E (managed) dispatched on its branch, and live takes it from a release tag. A major is the owner's call.`
      : 'The way out is the same image on a supported base: a newer tag of it once upstream has moved its base, or another variant of it. The pin watch (`.github/workflows/idp-pin-watch.yml`) says when a newer tag exists. The move goes in a pull request like any pin, with its release notes read; an image of `managed.yml` takes E2E (managed) dispatched on its branch, and live takes it from a release tag. A major is the owner\'s call.',
    ...(image.floating
      ? ['', 'The tag floats, so this is the image its registry serves today, which need not be the one the box pulled last.']
      : []),
    '',
    'This issue is kept by the image scan in `.github/workflows/security-scan.yml` (weekly, and on dispatch). It is updated while the scan finds the operating system past its end of life, and closed when it does not.',
  ].join('\n');
  return {
    state: report.eosl ? 'behind' : 'current',
    pin: image.ref,
    newest: os,
    body,
    news: [`\`${image.ref}\``, `**${os}**`],
    update: `The scan now reads \`${image.ref}\` on **${os}**, still past its end of life.`,
    closing: `The scan reads \`${image.ref}\` on ${os}, which its distribution supports.`,
  };
}

const shortRef = (ref) => ref.replace(/@sha256:([0-9a-f]{12})[0-9a-f]+/, '@sha256:$1…');

/**
 * The headline (the owner, 2026-11-03): the critical, high and fixable findings
 * of each tier, production first and test-only last, so what live runs is read
 * before what only a test runs. A tier no image is in has no row. A tier with
 * an image whose report is missing says so in its count, since its totals are
 * then of fewer images than it has.
 */
function tierLines(images, read) {
  const rows = [];
  for (const tier of TIERS) {
    const listed = images.filter((image) => image.tier === tier).length;
    if (listed === 0) continue;
    const reports = read.filter(({ image }) => image.tier === tier).map(({ report }) => report);
    const sum = (field) => reports.reduce((n, report) => n + report[field], 0);
    const count = reports.length === listed ? `${listed}` : `${reports.length} of ${listed}, ${listed - reports.length} without a report`;
    rows.push(`| \`${tier}\`: ${TIER_MEANS[tier]} | ${count} | ${sum('critical')} | ${sum('high')} | ${sum('fixable')} |`);
  }
  return [
    '### By tier, production first',
    '',
    '| tier | images | critical | high | a newer package fixes |',
    '|---|---|---|---|---|',
    ...rows,
  ];
}

/**
 * Every listed image against the report its scan left in `dir`, as
 * `trivy-image-<name>.json`. Returns the summary's lines, the annotations, and
 * which images had no report it could read. The summary leads with the totals
 * by tier, and every list in it goes by tier, production first, then in the
 * list's own order. An image without a tier is an error.
 */
export function summarize(images, readFile) {
  const rows = [];
  const annotations = [];
  const missing = [];
  const read = [];
  // Every image's tier read first, so one alone is checked too; the sort is
  // stable, so within a tier the list's own order holds.
  const ordered = images
    .map((image) => ({ rank: tierRank(image), image }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ image }) => image);
  for (const image of ordered) {
    let report;
    try {
      const text = readFile(`trivy-image-${image.name}.json`);
      if (text === null || text.trim() === '') throw new Error('no report was written (or it is empty)');
      report = readReport(text);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      missing.push({ image, why });
      annotations.push(`::error::${image.name}: ${why}, for ${shortRef(image.ref)}. A scan that did not happen is not a scan without findings.`);
      rows.push(`| \`${image.name}\` | ${tierNote(image.tier)} | \`${shortRef(image.ref)}\` | **no report**: ${why} | | | | |`);
      continue;
    }
    read.push({ image, report });
    if (report.eosl) {
      annotations.push(`::warning::${image.name}: ${shortRef(image.ref)} runs ${report.os}, past its end of life (Trivy: EOSL). An issue is kept open for it.`);
    }
    rows.push(
      `| \`${image.name}\` | ${tierNote(image.tier)} | \`${shortRef(image.ref)}\`${image.floating ? ' (floats)' : ''}${image.build ? ' (built on)' : ''}${image.context ? ` (built from \`${image.context}\`)` : ''} | ${report.os ?? 'not detected'} | ${report.eosl ? '**past its end of life**' : 'supported'} | ${report.critical} | ${report.high} | ${report.fixable} |`,
    );
  }
  const eosl = read.filter((r) => r.report.eosl).length;
  const lines = [
    '## Images the stacks run',
    '',
    `${images.length} listed, ${read.length} scanned, ${eosl} past their end of life, ${missing.length} without a report. Findings fail nothing; a missing report fails the run. They go to code scanning, one category per image (\`trivy-image-<name>\`), except a test-only image's, which are in this report alone.`,
    '',
    ...tierLines(ordered, read),
    '',
    '### Image by image',
    '',
    '| image | tier | reference | operating system | support | critical | high | a newer package fixes |',
    '|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    'A floating tag is scanned as its registry serves it today, which need not be what the box pulled last. An image built here is scanned as its Dockerfile builds today, which need not be what the box built last. The platform scanned is the one the stacks run on, linux/arm64.',
    ...(images.some((i) => i.build)
      ? [
          '',
          "An image marked *built on* is scanned as a deploy builds on that reference, built in this run (`image-scan.mjs containerfile`): with today's Debian packages, where a deploy served from the CLI's build cache keeps those of the build that filled it.",
        ]
      : []),
  ];
  const criticals = read.flatMap(({ image, report }) => report.criticals.map((c) => criticalLine(image.name, c)));
  if (criticals.length) {
    lines.push(
      '',
      '### The critical findings, one by one',
      '',
      'Where a fixed version is named, the fix exists: a newer tag, or a rebuild of the image (upstream\'s, or one made here), clears the finding. **No fix yet** waits on upstream.',
      '',
      ...criticals,
    );
  }
  lines.push(...inventoryLines(read));
  return { lines, annotations, missing, read };
}

/**
 * One issue per image past its end of life: opened, kept up to date, closed
 * when the scan no longer says so. An image with no report touches nothing.
 * Once every listed image was read, an open issue for an image no longer
 * listed is closed too.
 */
export function keepIssues(images, summary, gh) {
  const outcome = [];
  for (const { image, report } of summary.read) {
    outcome.push(`${image.name}: ${keepIssue(eoslIssue(image, report), gh, `${ISSUE_PREFIX}${image.name}`)}`);
  }
  if (summary.missing.length === 0) {
    const listed = new Set(images.map((i) => i.name));
    const open = JSON.parse(gh(['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,title']) || '[]');
    for (const issue of open) {
      if (!issue.title.startsWith(ISSUE_PREFIX) || listed.has(issue.title.slice(ISSUE_PREFIX.length))) continue;
      gh(['issue', 'close', String(issue.number), '--comment', 'No image of this name is scanned any more: it left the stacks, or was renamed.']);
      outcome.push(`${issue.title.slice(ISSUE_PREFIX.length)}: closed, no longer scanned`);
    }
  }
  return outcome;
}

// ------------------------------------------------------------ the run ----

/** The images the list job handed on, as the report job reads them from `IMAGES`. */
export function imagesFromEnv(text) {
  let images;
  try {
    images = JSON.parse(text ?? '');
  } catch {
    throw new Error('IMAGES is not the JSON the list job wrote');
  }
  if (!Array.isArray(images) || images.length === 0 || !images.every((i) => i?.name && i?.ref)) {
    throw new Error('IMAGES lists no image, so nothing can be said to be scanned');
  }
  const untiered = images.filter((i) => !TIERS.includes(i.tier)).map((i) => i.name);
  if (untiered.length > 0) {
    throw new Error(`IMAGES gives ${untiered.join(', ')} no tier the report knows (${TIERS.join(', ')}), so the report cannot say whether it runs in production`);
  }
  return images;
}

async function main(argv, env) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const [command, ...rest] = argv;
  if (command === 'list') {
    const upstream = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}.git` : 'origin';
    const images = await imagesToScan(repoReader(root), realNet(root), { upstream });
    for (const image of images) console.error(`${image.name.padEnd(28)} ${image.tier.padEnd(20)} ${shortRef(image.ref)}  (${image.where})`);
    console.log(`images=${JSON.stringify(images)}`);
    return 0;
  }
  if (command === 'containerfile') {
    // Imported here and only here: the config needs the workspace installed,
    // and the list and the report run on a bare checkout. Node strips its types.
    const { default: config } = await import(pathToFileURL(join(root, TASK_CONFIG)).href);
    process.stdout.write(await taskBaseStage(config, { base: rest[0], workingDir: join(root, dirname(TASK_CONFIG)) }));
    return 0;
  }
  if (command === 'report') {
    const dir = rest.find((a) => !a.startsWith('--'));
    if (!dir) throw new Error('report needs the directory the reports were downloaded to');
    const images = imagesFromEnv(env.IMAGES);
    const readFile = (name) => {
      const path = join(dir, name);
      return existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
    };
    const summary = summarize(images, readFile);
    for (const line of summary.annotations) console.log(line);
    console.log(summary.lines.join('\n'));
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary.lines.join('\n')}\n`);
    let failed = summary.missing.length > 0;
    if (rest.includes('--issue') && env.GITHUB_REF !== ISSUES_REF) {
      const line = `Issues are kept by a run on main only. This run is on ${env.GITHUB_REF || 'no ref'}, so no issue was opened, updated or closed.`;
      console.log(`issue, none: ${line}`);
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\n${line}\n`);
    } else if (rest.includes('--issue')) {
      const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });
      try {
        for (const line of keepIssues(images, summary, gh)) console.log(`issue, ${line}`);
      } catch (error) {
        console.error(`issue: ${error instanceof Error ? error.message : String(error)}`);
        failed = true;
      }
    }
    return failed ? 1 : 0;
  }
  throw new Error('usage: image-scan.mjs list | report <dir> [--issue] | containerfile <base image>');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = await main(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(`image-scan: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

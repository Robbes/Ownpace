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
 *               deploy/selfhost/compose.yml;
 *             - every image a script in deploy/compose or deploy/selfhost
 *               names in a literal `…IMAGE=` assignment (GoAccess, Stalwart
 *               for the demo, db-roles.sh's client), deduplicated against
 *               the compose files of its stack;
 *             - the tasks' image, which no file here names: the base image
 *               the pinned Trigger.dev CLI names for the tasks' runtime (the
 *               pin watch's `cliBaseImage`), with the layers a deploy adds
 *               to it, BUILT in the scan job (see `containerfile` below);
 *             - Ownpace's own three images, at `:edge` (what main publishes,
 *               which the OTA stack builds every night) and at the newest
 *               release tag (what live runs: it builds the tag it deploys).
 *           The FROM bases of apps/*\/Dockerfile (node, nginx) are inside
 *           Ownpace's images and are not scanned twice. www.yml's nginx is,
 *           because the site runs it as it is.
 *   report  reads the report each scan wrote, one per image. A missing or
 *           unreadable report is an error and fails the run: a scan that did
 *           not happen must never read like a week without findings. An
 *           image whose operating system Trivy calls past its end of life
 *           (`.Metadata.OS.EOSL`, which only the JSON report carries; SARIF
 *           never shows it) gets a `::warning::`, a line in the job summary,
 *           and one issue, kept open while it lasts and closed when it ends.
 *           Findings fail nothing: a CVE published upstream on a Sunday
 *           cannot turn main red. They go to code scanning as SARIF, one
 *           category per image.
 *   containerfile <base>
 *           the tasks' image as `trigger.dev deploy` builds it, up to the
 *           task code: the `base` stage of the Containerfile the CLI writes,
 *           on the base image the list named. It runs the build extensions
 *           of `apps/worker/trigger.config.ts`, as the CLI does, and writes
 *           the instructions of every layer they add. So this one command
 *           needs the workspace installed; the list and the report do not.
 *           Workplan 0146 T10: until 2026-10-25 the scan read the base image
 *           alone, while every deploy copies the API image's Node over it
 *           and upgrades its Debian packages, so findings the deploy fixes
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
 * `triggerdotdev/node` for the base, by tag and digest or not), and writes no
 * fingerprint, so code scanning tells one alert from another by rule and
 * location. Built as `trigger-task-base:built`, the location would have been
 * `library/trigger-task-base`: every Debian alert would close on the first
 * scan, fixed or not, and the ones without a fix would open again under new
 * numbers, their triage left on the closed ones. The tag is local: Trivy reads
 * that leg's image from the runner's Docker alone, and nothing pushes it.
 *
 * What is left out is npm packages only: the bundled task code, and the
 * externals the CLI installs with `npm i` at a deploy (`pg`,
 * `@electric-sql/pglite`). Their own versions are the ones installed here, so
 * the repository scan of the lockfile reads them; the packages npm resolves
 * under them, with no lockfile, neither scan reads. And the base is the CLI's
 * own: a Trigger.dev instance can name others for its deploys (the webapp's
 * `DEPLOY_BASE_IMAGES` and `DEPLOY_BUILD_BASE_IMAGES`, which the CLI applies
 * since `supportsInstanceBaseImages`, read at 4.7.6), and `managed.yml`, which
 * hands its Trigger.dev services only the keys it lists, sets neither. The
 * guard holds that.
 *
 * A floating tag (`redis:7-alpine`) is scanned as the registry serves it
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
import { COMPOSE_FILES, cliBaseImage, keepIssue, parseRef, readImages, realNet, repoReader, tagsOf } from './idp-pin-watch.mjs';
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

/** Every image issue's title starts with this, and ends with the image's name. */
export const ISSUE_PREFIX = "An image's operating system is past its end of life: ";

/** What the report reads for a summary: the two severities the scan asks for. */
const SEVERITIES = ['CRITICAL', 'HIGH'];

/** A literal image in a script: `GOACCESS_IMAGE="allinurl/goaccess:1.12@sha256:…"`. */
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
  const add = (image, where) => {
    if (image.repo.startsWith(ownpace)) return;
    const stack = stackOf(where);
    const key = `${stack}\n${image.ref}`;
    if (!byStackRef.has(key)) byStackRef.set(key, { ...image, stack, where: [] });
    if (!byStackRef.get(key).where.includes(where)) byStackRef.get(key).where.push(where);
  };
  for (const file of SCAN_FILES) for (const image of readImages(need(repo, file))) add(image, file);
  for (const dir of SCRIPT_DIRS) {
    for (const name of repo.list(dir).filter((n) => n.endsWith('.sh')).sort()) {
      for (const image of scriptImages(need(repo, `${dir}/${name}`))) add(image, `${dir}/${name}`);
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
    return { name, ref: image.ref, where: image.where.join(', '), floating: isFloating(image) };
  });

  // The tasks' base image: the CLI names it, for the runtime trigger.config.ts asks for.
  const config = need(repo, TASK_CONFIG);
  const runtime = /\bruntime:\s*['"]([^'"]+)['"]/.exec(config)?.[1];
  if (!runtime) throw new Error(`${TASK_CONFIG} names no runtime`);
  const cli = JSON.parse(need(repo, 'apps/worker/package.json')).dependencies?.['@trigger.dev/sdk'];
  if (!/^\d+\.\d+\.\d+$/.test(cli ?? '')) throw new Error(`apps/worker's @trigger.dev/sdk is ${cli}, not a version`);
  // Scanned as a deploy builds on it: the leg builds its `base` stage
  // (`containerfile`) under `build` and scans that, not the reference.
  const base = await cliBaseImage(net, cli, runtime);
  entries.push({
    name: TASK_IMAGE,
    ref: base,
    where: `trigger.dev ${cli}'s BASE_IMAGE['${runtime}'], with the layers ${TASK_CONFIG} adds at a deploy`,
    floating: false,
    build: taskBuildTag(base),
  });

  // Ownpace's own: what main publishes, and the newest release.
  const release = newestReleaseTag(await net.lsRemote(upstream));
  for (const image of OWNPACE_IMAGES) {
    entries.push({ name: `ownpace-${image}-edge`, ref: `${ownpace}${image}:edge`, where: 'main (images.yml)', floating: true });
    entries.push({ name: `ownpace-${image}-release`, ref: `${ownpace}${image}:${release}`, where: `v${release}, the newest release tag (images.yml)`, floating: false });
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
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  let fixable = 0;
  for (const result of report.Results ?? []) {
    for (const vuln of result.Vulnerabilities ?? []) {
      if (vuln.Severity in counts) counts[vuln.Severity] += 1;
      if (vuln.FixedVersion) fixable += 1;
    }
  }
  return {
    os: os?.Family ? `${os.Family} ${os.Name ?? ''}`.trim() : null,
    eosl: os?.EOSL === true,
    critical: counts.CRITICAL,
    high: counts.HIGH,
    fixable,
  };
}

/** The issue for one image past its end of life, as `keepIssue` keeps it. */
export function eoslIssue(image, report) {
  const os = report.os ?? 'an operating system Trivy could not name';
  const body = [
    `\`${image.ref}\` (${image.where}) runs on **${os}**, which its distribution no longer supports: Trivy's report for it says \`EOSL\`, end of service life. Its packages get no more security fixes, so what the scan finds in them from now on stays open whatever else moves.`,
    '',
    'The way out is the same image on a supported base: a newer tag of it once upstream has moved its base, or another variant of it. The pin watch (`.github/workflows/idp-pin-watch.yml`) says when a newer tag exists. The move goes in a pull request like any pin, with its release notes read; an image of `managed.yml` takes E2E (managed) dispatched on its branch, and live takes it from a release tag. A major is the owner\'s call.',
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
 * Every listed image against the report its scan left in `dir`, as
 * `trivy-image-<name>.json`. Returns the summary's lines, the annotations, and
 * which images had no report it could read.
 */
export function summarize(images, readFile) {
  const rows = [];
  const annotations = [];
  const missing = [];
  const read = [];
  for (const image of images) {
    let report;
    try {
      const text = readFile(`trivy-image-${image.name}.json`);
      if (text === null || text.trim() === '') throw new Error('no report was written (or it is empty)');
      report = readReport(text);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      missing.push({ image, why });
      annotations.push(`::error::${image.name}: ${why}, for ${shortRef(image.ref)}. A scan that did not happen is not a scan without findings.`);
      rows.push(`| \`${image.name}\` | \`${shortRef(image.ref)}\` | **no report**: ${why} | | | | |`);
      continue;
    }
    read.push({ image, report });
    if (report.eosl) {
      annotations.push(`::warning::${image.name}: ${shortRef(image.ref)} runs ${report.os}, past its end of life (Trivy: EOSL). An issue is kept open for it.`);
    }
    rows.push(
      `| \`${image.name}\` | \`${shortRef(image.ref)}\`${image.floating ? ' (floats)' : ''}${image.build ? ' (built on)' : ''} | ${report.os ?? 'not detected'} | ${report.eosl ? '**past its end of life**' : 'supported'} | ${report.critical} | ${report.high} | ${report.fixable} |`,
    );
  }
  const eosl = read.filter((r) => r.report.eosl).length;
  const lines = [
    '## Images the stacks run',
    '',
    `${images.length} listed, ${read.length} scanned, ${eosl} past their end of life, ${missing.length} without a report. Findings go to code scanning, one category per image (\`trivy-image-<name>\`), and fail nothing; a missing report fails the run.`,
    '',
    '| image | reference | operating system | support | critical | high | a newer package fixes |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    'A floating tag is scanned as its registry serves it today, which need not be what the box pulled last. The platform scanned is the one the stacks run on, linux/arm64.',
    ...(images.some((i) => i.build)
      ? [
          '',
          "An image marked *built on* is scanned as a deploy builds on that reference, built in this run (`image-scan.mjs containerfile`): with today's Debian packages, where a deploy served from the CLI's build cache keeps those of the build that filled it.",
        ]
      : []),
  ];
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
  return images;
}

async function main(argv, env) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const [command, ...rest] = argv;
  if (command === 'list') {
    const upstream = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}.git` : 'origin';
    const images = await imagesToScan(repoReader(root), realNet(root), { upstream });
    for (const image of images) console.error(`${image.name.padEnd(28)} ${shortRef(image.ref)}  (${image.where})`);
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
    if (rest.includes('--issue')) {
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

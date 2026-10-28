#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PIN THAT KNOWS IT IS BEHIND (workplan 0135 T7 (b); the owner's answer of
 * 2026-09-28, "a+b, 7 days"), and since 0146 T8 every pin Dependabot cannot
 * see.
 *
 * The identity provider is pinned in `deploy/compose/managed.yml`, and
 * Dependabot does not move it: it reads no file in `deploy/compose` (below),
 * and an upgrade is the owner's call, because Zitadel moves its schema one
 * way when it boots on the persistent stack (0119 §3 item 2). So nothing said
 * when upstream moved on. v4.18.0 fixed
 * GHSA-4hgj-wm6c-q7p2 on 2026-09-21, a rename of any account through login v1,
 * which this stack serves. A week later the stack still ran v4.17.3, and a
 * person reading release notes is what found it.
 *
 * EVERY PIN DEPENDABOT CANNOT SEE (0146 T8, 2026-10-21). The identity
 * provider was not the only one. Dependabot's compose fetcher reads only files
 * named like `compose.yml`, and none in `deploy/compose` is, so the images of
 * both managed stacks were moved by hand or not at all: pgbouncer fell two
 * releases and two CVEs behind, and Trigger.dev four patch releases. The
 * tasks ran a Node two security releases old, `packageManager` sat six pnpm
 * releases back, and nothing would say when the TypeScript split can go.
 * Each of those was found by somebody reading, which is the failure this file
 * exists to end. `a-dependabot-directory-with-nothing-to-read` holds the
 * other half: Dependabot is not given a directory it cannot read.
 *
 * WHAT IT COMPARES, once a week, each row on its own:
 *
 *   identity provider  managed.yml's pin against upstream's newest release of
 *                      the same major (`git ls-remote`). Its own issue, under
 *                      the title it has always had.
 *   Trigger.dev        managed.yml's default against the newest tag BOTH ghcr
 *                      images carry, by `trigger-version.sh probe`, the probe
 *                      `list` runs, which asks manifests because ghcr's tag
 *                      list is incomplete. Its own issue.
 *   ClickHouse         managed.yml's image against the one Trigger.dev's own
 *                      `docker/docker-compose.yml` pins at that newest tag,
 *                      with the line's row in ClickHouse's SECURITY.md as
 *                      text. Its own issue, while the two differ.
 *   the tasks' Node    the Node in the base image the pinned Trigger.dev CLI
 *                      names, against Node's newest security release, while
 *                      no overlay in `trigger.config.ts` gives the tasks the
 *                      API image's Node. Its own issue.
 *   pnpm               `packageManager` against the newest pnpm of its major.
 *                      Its own issue; a newer major is a line in it.
 *   TypeScript split   a cleanup notice, opened when typescript-eslint's
 *                      latest release admits a stable TypeScript 7.1 or later.
 *   routine pins       ONE summary issue: every other image line of
 *                      managed.yml, dev.yml and www.yml against its registry's
 *                      tag list (Docker Hub and ghcr, anonymous tokens), or,
 *                      for a tag with no number held by its digest
 *                      (`chainguard/minio:latest`, 0146 T7), against the digest
 *                      its registry names for that tag today; an image built
 *                      here (`localhost/postgres`, 0146 T15) by its
 *                      Dockerfile's FROM, the tag its own name starts with,
 *                      its line saying that Dependabot reads that one too; the
 *                      busybox copies in the scripts, www.yml's nginx against
 *                      apps/web/Dockerfile's, Stalwart's copies and its newest
 *                      v0.16.x, the GoAccess release site-visits.sh builds
 *                      against upstream's git tags, the Trivy the Security
 *                      Scan runs, and the cosign the workflows name, every
 *                      copy together.
 *                      cosign-installer's default is a status line only. Any
 *                      other image a script in deploy/compose runs is not
 *                      compared; today there is none (db-roles.sh reads its
 *                      client from managed.yml since 2026-10-22), and the
 *                      rest are in comments.
 *
 * A tag is compared with the tags shaped like it (the same letters and
 * separators, numbers where the digits are) that keep its major, since a major
 * is a decision. So `v1.25.2-p0` is compared with `v1.26.1-p0` and never with
 * `latest`, `1.38` with `1.39` and never with `1.38.0-glibc`, and a floating
 * `18-alpine` is current within its line by construction. That is why
 * floating tags need no exclusion here, and why pinning them exactly (by
 * digest) makes them watched without a change to this file, as the stores and
 * the TLS front were on 2026-10-22. A digest is not compared against a
 * registry: a rebuild under the same tag is the image scan's to report
 * (`image-scan.mjs`). The one row that compares a digest is www.yml's nginx,
 * held to apps/web/Dockerfile's FROM by tag and digest, so a digest-only move
 * of the web image's base by Dependabot lists www.yml too.
 *
 * Each own-issue row keeps one issue open while it is behind: opened, brought
 * up to date (with a comment when its newest moved, since an edit notifies
 * nobody), and closed when the pin catches up. A row that cannot read its
 * upstream touches nothing and fails the run, so a broken read never reads as
 * "current" and never closes an issue.
 *
 * WHAT IT DOES NOT DO. It opens no pull request. Moving a pin is the owner's
 * call, by the route each issue spells out. It reads no advisories either. A
 * newer release is reason enough to read the notes, and a security release of
 * the identity provider is applied within seven days.
 *
 * `.mjs` for the reason `audit-advisories.mjs` gives: it runs in a CI step on
 * a bare checkout, with no `node_modules`, and needs no type stripping. So it
 * parses its YAML with regular expressions, and leaves semver ranges to npm.
 * Its guard, `scripts/a-pin-that-knows-it-is-behind.unit.test.ts`, runs the
 * functions below with stubbed registries, npm, nodejs.org's index and `gh`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMPOSE = 'deploy/compose/managed.yml';
export const UPSTREAM = 'https://github.com/zitadel/zitadel.git';
/** Unchanged since 0135 T7: issue #1643 carries it, and a new title would open a second. */
export const ISSUE_TITLE = 'The identity provider pin is behind its newest release';
/** 0135 T7: a security release is applied within this many days. */
export const WINDOW_DAYS = 7;

/** One issue per row that is the owner's call, and one for the routine pins. */
export const TITLES = {
  zitadel: ISSUE_TITLE,
  trigger: 'The Trigger.dev pin is behind its newest release',
  clickhouse: 'The ClickHouse pin differs from the one Trigger.dev pins',
  taskNode: "The tasks' Node is below Node's newest security release",
  pnpm: 'The pnpm pin is behind its newest release',
  typescript: 'The TypeScript split can go',
  routine: 'Pins Dependabot cannot see are behind',
};

/** The compose files whose images this reads, since Dependabot reads none of them. */
export const COMPOSE_FILES = ['deploy/compose/managed.yml', 'deploy/compose/dev.yml', 'deploy/compose/www.yml'];

/**
 * Images in those files that the registry comparison leaves to another row,
 * each with the reason. Every other image line is compared with its registry;
 * the guard holds that nothing falls between the two.
 */
export const COMPARED_ELSEWHERE = {
  'ghcr.io/zitadel/zitadel': 'the identity provider row',
  'ghcr.io/triggerdotdev/trigger.dev': 'the Trigger.dev row',
  'ghcr.io/triggerdotdev/supervisor': 'the Trigger.dev row',
  'clickhouse/clickhouse-server': 'the ClickHouse row',
};

/**
 * Said beside a digest-only pin that is behind: its tag is the only one the
 * image publishes free, so a new digest is a rebuild, and nothing else says
 * what changed in it.
 */
export const REBUILD_NOTE =
  'a rebuild of the same tag: move the digest in a pull request of its own, with the image scan of the new one read and E2E (managed) on its branch';

/**
 * Said beside an image built here that is behind (`localhost/postgres`, 0146
 * T15): Dependabot reads its Dockerfile too (its entry in
 * .github/dependabot.yml), so the pull request that moves it is Dependabot's.
 */
export const builtNote = (dockerfile) =>
  `Dependabot reads this one too, in \`${dockerfile}\`: take its pull request, and push to it the \`sed\` its failing test prints for the image lines`;

/** How Stalwart moves, said beside its line in the summary issue: AGENTS.md forbids moving it otherwise. */
export const STALWART_RULE =
  "the owner's call: it moves only by docs/stalwart-integration-fix.md and ADR-0022, every copy together (AGENTS.md)";

/** The visit count's GoAccess, built here (#1675). */
export const GOACCESS_DOCKERFILE = 'deploy/compose/goaccess/Dockerfile';

/** Every copy of the Stalwart pin. The fixture's Dockerfile may go; a missing file is skipped. */
export const STALWART_FILES = [
  'packages/testing/src/testcontainers-setup.ts',
  'deploy/selfhost/setup-stalwart.sh',
  'packages/testing/fixtures/stalwart/Dockerfile',
  'scripts/a-service-that-phones-home.unit.test.ts',
];

/**
 * The workflows that install cosign: images.yml signs every published image
 * with it, and release.yml's verify job checks those signatures with it.
 */
export const COSIGN_FILES = ['.github/workflows/images.yml', '.github/workflows/release.yml'];

const IMAGE_LINE = /^\s*image:\s*ghcr\.io\/zitadel\/zitadel:(\S+)\s*$/gm;
const RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;

/** A release tag's three numbers, or null for anything else (a pre-release, a name). */
function numbersOf(tag) {
  const m = RELEASE.exec(tag);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Orders two release tags by their numbers, never by their text: v4.9.0 comes before v4.10.0. */
export function compareTags(a, b) {
  const x = numbersOf(a);
  const y = numbersOf(b);
  if (!x || !y) throw new Error(`not a release tag: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The tag `managed.yml` runs, from its one `image:` line for the identity provider. */
export function readPin(compose) {
  const lines = [...compose.matchAll(IMAGE_LINE)];
  if (lines.length !== 1) {
    throw new Error(`${COMPOSE} names the identity provider's image ${lines.length} times, not once`);
  }
  const tag = lines[0][1];
  if (!numbersOf(tag)) throw new Error(`${COMPOSE} pins the identity provider at ${tag}, which is not a release tag`);
  return tag;
}

/** Every tag in `git ls-remote --tags --refs` output. */
export function tagsOf(lsRemote) {
  return lsRemote
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[1] ?? '')
    .filter((ref) => ref.startsWith('refs/tags/'))
    .map((ref) => ref.slice('refs/tags/'.length));
}

/**
 * The newest release of `major`, from `git ls-remote --tags --refs` output. A
 * pre-release (`v4.20.0-rc.1`) and another major are not releases of it. None
 * at all is an error, never "current".
 */
export function newestRelease(major, lsRemote) {
  const releases = tagsOf(lsRemote).filter((tag) => numbersOf(tag)?.[0] === major);
  if (releases.length === 0) {
    throw new Error(`upstream lists no v${major} release, so the pin cannot be called current`);
  }
  return releases.sort(compareTags).at(-1);
}

/** The pin against the newest release of its major: current, behind, or ahead of every release. */
export function comparePin(pin, lsRemote) {
  const major = numbersOf(pin)?.[0];
  if (major === undefined) throw new Error(`not a release tag: ${pin}`);
  const newest = newestRelease(major, lsRemote);
  const order = compareTags(pin, newest);
  return { pin, newest, state: order === 0 ? 'current' : order < 0 ? 'behind' : 'ahead' };
}

/** The line `dump-idp.sh` prints too, so the dump and the issue agree on when it goes. */
const DUMP_GOES = "Delete the OTA dump once main's first scheduled E2E (managed) on the new pin is green.";

/** What the issue says: the two versions, the window, and the route an upgrade takes. */
export function issueBody({ pin, newest }) {
  return [
    `The identity provider runs **${pin}** (\`${COMPOSE}\`), and upstream's newest release of that major is **${newest}**.`,
    '',
    `Read the notes of every release after ${pin}, up to https://github.com/zitadel/zitadel/releases/tag/${newest}. A release that fixes a security issue in something this stack uses is applied within ${WINDOW_DAYS} days (workplan 0135 T7), by the route 0119 §3 item 2 sets:`,
    '',
    "1. Dump the OTA instance's `zitadel` database by hand first: `./deploy/compose/dump-idp.sh` in its checkout, which reads the dump back and writes the way back beside it. The gate drills Trigger.dev's database, not the identity provider's.",
    '2. Its own pull request moves the pin, with the notes read.',
    "3. E2E (managed) on that branch applies it to the OTA instance, whose schema then moves one way.",
    '4. Live takes it from a release tag.',
    `5. ${DUMP_GOES} The dump holds the provider's accounts. On live, the copy before the update holds its dump, and the copy's own rules delete it.`,
    '',
    'This issue is kept by `.github/workflows/idp-pin-watch.yml`. It is updated while the two differ, and closed when the pin catches up.',
  ].join('\n');
}

// ------------------------------------------------------------- tags ------

/** A tag with every run of digits replaced, so tags of one scheme compare: `v1.25.2-p0` is `v#.#.#-p#`. */
const shapeOf = (tag) => tag.replace(/\d+/g, '#');
const partsOf = (tag) => (tag.match(/\d+/g) ?? []).map(Number);

/** Orders two tags of one shape by their numbers, never by their text. */
export function compareParts(a, b) {
  const x = partsOf(a);
  const y = partsOf(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The newest of `tags` shaped like `pin` that keeps its first `keep` numbers:
 * its major by default, its 0.x line with 2. None is an error, never
 * "current": a tag list read wrong would otherwise close an issue.
 */
export function newestLike(pin, tags, keep = 1) {
  const shape = shapeOf(pin);
  if (!shape.includes('#')) throw new Error(`${pin} has no version number to compare`);
  const head = partsOf(pin).slice(0, keep);
  const alike = tags.filter(
    (tag) => shapeOf(tag) === shape && partsOf(tag).slice(0, keep).every((n, i) => n === head[i]),
  );
  if (alike.length === 0) throw new Error(`no tag shaped like ${pin} was listed, so it cannot be called current`);
  return alike.sort(compareParts).at(-1);
}

/** current, behind, or ahead of the newest listed. */
export function stateOf(pin, newest) {
  const order = compareParts(pin, newest);
  return order === 0 ? 'current' : order < 0 ? 'behind' : 'ahead';
}

// ----------------------------------------------------------- images ------

/** An image reference in its three parts: `axllent/mailpit:v1.31.6@sha256:…`. */
export function parseRef(ref) {
  const at = ref.indexOf('@');
  const digest = at >= 0 ? ref.slice(at + 1) : '';
  const named = at >= 0 ? ref.slice(0, at) : ref;
  const colon = named.lastIndexOf(':');
  const tagged = colon > named.lastIndexOf('/');
  return { ref, repo: tagged ? named.slice(0, colon) : named, tag: tagged ? named.slice(colon + 1) : '', digest };
}

/**
 * Every `image:` line of a compose file, with its line number, and a
 * `${VAR:-default}` read as its default: what the stack runs when `.env`
 * leaves the variable unset.
 */
export function readImages(text) {
  const images = [];
  text.split('\n').forEach((line, i) => {
    const m = /^\s*image:\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/.exec(line);
    if (!m) return;
    images.push({ line: i + 1, ...parseRef(m[1].replace(/\$\{[A-Za-z0-9_]+:-([^}]*)\}/g, '$1')) });
  });
  return images;
}

/**
 * The outside image a Dockerfile builds on: its one FROM, as a reference.
 * A Dockerfile built beside a compose file builds on one image, so a second
 * FROM, or one without a tag and a digest, is an error rather than a guess.
 */
export function dockerfileBase(text) {
  const froms = [...text.matchAll(/^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+\S+)?\s*$/gim)].map((m) => m[1]);
  if (froms.length !== 1) throw new Error(`a Dockerfile built beside a compose file has one FROM; this one has ${froms.length}`);
  const base = parseRef(froms[0]);
  if (!base.tag || !/^sha256:[0-9a-f]{64}$/.test(base.digest)) throw new Error(`FROM ${froms[0]} carries no tag and digest`);
  return base;
}

/**
 * The tag a compose file gives an image it builds (2026-10-26): the base's tag
 * and the first twelve hex digits of the SHA-256 of the Dockerfile's
 * instruction lines, each with its newline, comments and blank lines left out:
 * `18.6-alpine-0123456789ab`. `up` builds such an image only when the machine
 * has none of that name (nothing here asks it to build one it has: no `up
 * --build`, no bare `build`), so a name that did not change when the Dockerfile
 * did would keep the old build running for good, and nothing would say so. The
 * shell gives the same digits:
 *   grep -Ev '^[[:space:]]*(#|$)' <Dockerfile> | sha256sum | cut -c1-12
 */
export function builtTag(text) {
  const instructions = text.split('\n').filter((line) => !/^\s*(#|$)/.test(line));
  const digits = createHash('sha256').update(instructions.map((line) => `${line}\n`).join('')).digest('hex').slice(0, 12);
  return `${dockerfileBase(text).tag}-${digits}`;
}

/**
 * A compose file's image that is built here, not pulled (2026-10-26):
 * `localhost/<name>:<tag>`, a name no registry serves, built by compose from
 * `<name>/Dockerfile` beside the file. Its pins are that Dockerfile's FROM.
 * Null for an image a registry serves; an error when the Dockerfile is not
 * there, since nothing could then say what the image is.
 */
export function builtImage(repo, file, image) {
  if (!image.repo.startsWith('localhost/')) return null;
  const name = image.repo.slice('localhost/'.length);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`${file} runs ${image.ref}, which names no directory a Dockerfile could be in`);
  const context = `${dirname(file)}/${name}`;
  const text = repo.read(`${context}/Dockerfile`);
  if (text === null) throw new Error(`${file} runs ${image.ref}, built from ${context}/Dockerfile, which is not in this checkout`);
  return { context, dockerfile: `${context}/Dockerfile`, base: dockerfileBase(text), tag: builtTag(text) };
}

/** Where an image's tag list is: ghcr, or Docker Hub (with `library/` for an official image). */
export function registryOf(repo) {
  const [first, ...rest] = repo.split('/');
  if (first === 'ghcr.io') return { host: 'ghcr.io', name: rest.join('/') };
  if (rest.length > 0 && /[.:]/.test(first) && first !== 'docker.io') {
    throw new Error(`${repo} is on ${first}, whose tag list this watch does not read`);
  }
  const name = first === 'docker.io' ? rest.join('/') : repo;
  return { host: 'registry-1.docker.io', name: name.includes('/') ? name : `library/${name}` };
}

async function registryToken(net, host, name) {
  const url =
    host === 'ghcr.io'
      ? `https://ghcr.io/token?scope=repository:${name}:pull&service=ghcr.io`
      : `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${name}:pull`;
  const token = (await net.json(url))?.token;
  if (!token) throw new Error(`${host} gave no pull token for ${name}`);
  return token;
}

/**
 * An image's tags, from the registry's own list with an anonymous pull token.
 * Docker Hub and ghcr return these repositories' lists whole in one page.
 * Trigger.dev's ghcr list is the one that is not whole, which is why its row
 * asks manifests instead.
 */
export async function registryTags(net, repo) {
  const { host, name } = registryOf(repo);
  const token = await registryToken(net, host, name);
  const listed = await net.json(`https://${host}/v2/${name}/tags/list?n=10000`, { Authorization: `Bearer ${token}` });
  if (!Array.isArray(listed?.tags) || listed.tags.length === 0) throw new Error(`${host} listed no tags for ${name}`);
  return listed.tags;
}

const INDEX_TYPES = 'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json';
const MANIFEST_TYPES = 'application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json';

/**
 * The digest a tag names today: the registry's `Docker-Content-Digest` for the
 * tag's manifest, the index when there is one, which is the digest a compose
 * file pins. Asked with a HEAD, which Docker Hub does not count against its
 * anonymous pull limit, as it counts a GET, but does refuse with a 429 once an
 * address shared with others has used that limit up (seen 2026-10-24, with
 * `ratelimit-remaining: 0`). That throws in `net.digest`, and the row reads
 * as not read that week, as any other unreadable row does. Anything but a
 * sha256 is an error, never "current".
 */
export async function registryDigest(net, repo, tag) {
  const { host, name } = registryOf(repo);
  const token = await registryToken(net, host, name);
  const digest = await net.digest(`https://${host}/v2/${name}/manifests/${tag}`, {
    Authorization: `Bearer ${token}`,
    Accept: `${INDEX_TYPES},${MANIFEST_TYPES}`,
  });
  if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? '')) throw new Error(`${host} named no digest for ${name}:${tag}`);
  return digest;
}

/** The `NODE_VERSION` an image's linux/amd64 config sets: index, manifest, config, as `docker pull` reads them. */
export async function nodeVersionOf(net, image) {
  const { repo, tag, digest } = parseRef(image);
  const { host, name } = registryOf(repo);
  const auth = { Authorization: `Bearer ${await registryToken(net, host, name)}` };
  let manifest = await net.json(`https://${host}/v2/${name}/manifests/${digest || tag}`, {
    ...auth,
    Accept: `${INDEX_TYPES},${MANIFEST_TYPES}`,
  });
  if (Array.isArray(manifest?.manifests)) {
    const amd64 = manifest.manifests.find((m) => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64');
    if (!amd64) throw new Error(`${image} has no linux/amd64 image`);
    manifest = await net.json(`https://${host}/v2/${name}/manifests/${amd64.digest}`, { ...auth, Accept: MANIFEST_TYPES });
  }
  if (!manifest?.config?.digest) throw new Error(`${image} has no config to read`);
  const config = await net.json(`https://${host}/v2/${name}/blobs/${manifest.config.digest}`, auth);
  const version = (config?.config?.Env ?? []).find((e) => e.startsWith('NODE_VERSION='))?.slice('NODE_VERSION='.length);
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${image} sets no NODE_VERSION`);
  return version;
}

// -------------------------------------------------------- workflows ------

/**
 * Every step of a workflow that uses `action`: its pinned commit, the version
 * its comment names, and its `with:` inputs. Read by indentation, since a bare
 * checkout has no YAML parser: the step's keys sit at the column of `uses:`,
 * and the step ends at the first line left of it.
 */
export function stepsUsing(workflow, action) {
  const lines = workflow.split('\n');
  const escaped = action.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const uses = new RegExp(`^(\\s*(?:- )?)uses:\\s*${escaped}@([0-9a-f]{40})(?:\\s*#\\s*(\\S+))?`);
  // A key's column, with a list item's `- ` counted as indentation.
  const columnOf = (text) => text.replace(/^(\s*)- /, (_all, space) => `${space}  `).search(/\S/);
  const quiet = (text) => text.trim() === '' || text.trim().startsWith('#');
  const steps = [];
  lines.forEach((line, i) => {
    const m = uses.exec(line);
    if (!m || m[1].length < 2) return;
    const column = m[1].length;
    const opens = (text) => text.startsWith(`${' '.repeat(column - 2)}- `);
    let start = i;
    while (!opens(lines[start]) && start > 0 && (quiet(lines[start - 1]) || columnOf(lines[start - 1]) >= column)) start--;
    let end = i + 1;
    while (end < lines.length && !opens(lines[end]) && (quiet(lines[end]) || columnOf(lines[end]) >= column)) end++;
    const inputs = {};
    let inWith = false;
    for (const text of lines.slice(start, end)) {
      const key = quiet(text) ? null : /^\s*(?:- )?([A-Za-z0-9_-]+):\s*(.*)$/.exec(text);
      if (!key) continue;
      if (columnOf(text) === column) inWith = key[1] === 'with';
      else if (inWith && columnOf(text) > column) {
        inputs[key[1]] = key[2].replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
      }
    }
    steps.push({ sha: m[2], version: m[3] ?? '', with: inputs });
  });
  return steps;
}

/** The default an action's `action.yml` gives one of its `inputs:`. */
export function actionDefault(actionYml, input) {
  const lines = actionYml.split('\n');
  const inputs = lines.findIndex((l) => /^inputs:\s*$/.test(l));
  const at = inputs < 0 ? -1 : lines.findIndex((l, i) => i > inputs && new RegExp(`^\\s{2}${input}:\\s*$`).test(l));
  const ends = lines.findIndex((l, i) => i > inputs && /^\S/.test(l));
  if (at < 0 || (ends > 0 && at > ends)) throw new Error(`the action declares no input ${input}`);
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= 2) break;
    const m = /^\s+default:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (m) return m[1];
  }
  throw new Error(`the action gives ${input} no default`);
}

// ------------------------------------------------------------- npm -------

/** One file of an npm package tarball, read in memory. The package is never installed or run. */
export function fileInTgz(tgz, path) {
  const tar = gunzipSync(tgz);
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from, length) => header.subarray(from, from + length).toString('utf8').replace(/\0[\s\S]*$/, '');
    const ustar = field(257, 5) === 'ustar';
    const name = [ustar ? field(345, 155) : '', field(0, 100)].filter(Boolean).join('/');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    const start = at + 512;
    if ((type === '0' || type === '') && name === path) return tar.subarray(start, start + size).toString('utf8');
    at = start + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${path} is not in the package`);
}

/** The base image the Trigger.dev CLI's `BASE_IMAGE` table names for `runtime`, read as text, never run. */
export function baseImageOf(buildImageJs, runtime) {
  const table = /export const BASE_IMAGE = \{([\s\S]*?)\};/.exec(buildImageJs)?.[1];
  if (!table) throw new Error("the CLI's buildImage.js has no BASE_IMAGE table");
  const key = runtime.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const m = new RegExp(`(?:^|[\\s,{])["']?${key}["']?\\s*:\\s*["']([^"']+)["']`).exec(table);
  if (!m) throw new Error(`the CLI's BASE_IMAGE names no image for ${runtime}`);
  return m[1];
}

/** The base image the CLI at `version` names for `runtime`. Also what the image scan scans for the tasks. */
export async function cliBaseImage(net, version, runtime) {
  const tgz = await net.bytes(`https://registry.npmjs.org/trigger.dev/-/trigger.dev-${version}.tgz`);
  return baseImageOf(fileInTgz(tgz, 'package/dist/esm/deploy/buildImage.js'), runtime);
}

/** Node's newest security release of `major`, from nodejs.org's index: the floor below which a Node is behind. */
export function securityFloor(index, major) {
  const releases = (Array.isArray(index) ? index : [])
    .filter((r) => r?.security === true && typeof r.version === 'string' && r.version.startsWith(`v${major}.`))
    .map((r) => ({ version: r.version.slice(1), date: String(r.date ?? '') }));
  if (releases.length === 0) throw new Error(`nodejs.org lists no security release of Node ${major}`);
  return releases.sort((a, b) => compareParts(a.version, b.version)).at(-1);
}

// ------------------------------------------------------------- rows ------

const need = (repo, rel) => {
  const text = repo.read(rel);
  if (text === null) throw new Error(`${rel} is not in this checkout`);
  return text;
};

const closingOf = (pin) => `The pin is current again: ${pin}.`;

export async function zitadelRow(repo, net) {
  const result = comparePin(readPin(need(repo, COMPOSE)), await net.lsRemote(UPSTREAM));
  return { ...result, where: COMPOSE, body: issueBody(result) };
}

/**
 * Trigger.dev's pin: managed.yml's two `${TRIGGER_IMAGE_TAG:-…}` defaults,
 * which must agree with each other and with apps/worker's SDK, as the
 * bring-up and `bootstrap-managed.unit.test.ts` require.
 */
export function readTriggerPin(compose, workerManifest) {
  const defaults = [...compose.matchAll(/\$\{TRIGGER_IMAGE_TAG:-([^}]+)\}/g)].map((m) => m[1]);
  if (defaults.length === 0) throw new Error(`${COMPOSE} has no \${TRIGGER_IMAGE_TAG:-…} default`);
  if (new Set(defaults).size !== 1) throw new Error(`${COMPOSE}'s Trigger.dev defaults disagree: ${defaults.join(', ')}`);
  const pin = defaults[0];
  if (!numbersOf(pin)) throw new Error(`${COMPOSE} pins Trigger.dev at ${pin}, which is not a release tag`);
  const sdk = JSON.parse(workerManifest).dependencies?.['@trigger.dev/sdk'];
  if (sdk !== pin.slice(1)) {
    throw new Error(`apps/worker's @trigger.dev/sdk is ${sdk}, and ${COMPOSE} pins ${pin}; they move together (trigger-version.sh pin)`);
  }
  return pin;
}

export function triggerBody({ pin, newest }) {
  return [
    `The Trigger.dev webapp and supervisor run **${pin}** (\`${COMPOSE}\`, with the \`@trigger.dev/*\` manifests), and the newest tag both images carry on ghcr is **${newest}**.`,
    '',
    `Read the notes of every release after ${pin}, up to https://github.com/triggerdotdev/trigger.dev/releases/tag/${newest}. Dependabot ignores \`@trigger.dev/*\` on purpose: the webapp migrates its schema one way when it boots. The route (docs/managed-bring-up.md, *Upgrading Trigger.dev*):`,
    '',
    '1. Drain first: start the hold and wait until nothing is EXECUTING. Upgrading with runs in flight left every run looping.',
    `2. Back \`triggerdb\` up: \`./deploy/compose/trigger-version.sh backup before-${newest}\` in the OTA checkout. On live, the copy \`deploy-live.sh\` takes before a tag that moves the pin holds that dump.`,
    `3. \`./deploy/compose/trigger-version.sh pin ${newest}\`, then \`pnpm install\`.`,
    '4. Its own pull request, with the notes read, and the telemetry the release ships re-read (`scripts/a-service-that-phones-home.unit.test.ts`).',
    '5. E2E (managed) dispatched on that branch, which applies it to the OTA instance, one way. Dispatch it only when the branch can merge within the hour.',
    '6. Live takes it from a release tag.',
    '',
    'This issue is kept by `.github/workflows/idp-pin-watch.yml`. It is updated while the two differ, and closed when the pin catches up.',
  ].join('\n');
}

export async function triggerRow(repo, net) {
  const pin = readTriggerPin(need(repo, COMPOSE), need(repo, 'apps/worker/package.json'));
  const listed = (await net.probe(pin))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const tag of listed) if (!numbersOf(tag)) throw new Error(`the probe answered ${tag}, which is not a release tag`);
  const newest = [pin, ...listed].sort(compareTags).at(-1);
  const state = compareTags(pin, newest) === 0 ? 'current' : 'behind';
  return { pin, newest, state, where: COMPOSE, body: triggerBody({ pin, newest }) };
}

/** ClickHouse's own word on a line, from the supported table in its SECURITY.md. */
export function clickhouseSupport(securityMd, tag) {
  const [major, minor] = partsOf(tag);
  const rows = [...securityMd.matchAll(/^\|\s*(\d+(?:\.(?:\d+|\*))?)\s*\|\s*([^|\n]*?)\s*\|/gm)].map((m) => ({
    line: m[1],
    supported: /✔|✅/.test(m[2]),
  }));
  const row = rows.find((r) => r.line === `${major}.${minor}`) ?? rows.find((r) => r.line === `${major}.*`);
  if (!row) return `ClickHouse's SECURITY.md has no row for ${major}.${minor}`;
  const supported = rows.filter((r) => r.supported).map((r) => r.line);
  return `ClickHouse ${major}.${minor} is ${row.supported ? '' : 'not '}supported with security updates, by ClickHouse's SECURITY.md (supported: ${supported.join(', ') || 'none listed'})`;
}

const refText = (image) => `${image.tag}${image.digest ? `@${image.digest}` : ''}`;

export async function clickhouseRow(repo, net, trigger) {
  if (trigger?.state === 'error' || !trigger?.newest) throw new Error('the Trigger.dev row named no tag to read its compose file at');
  const repoName = 'clickhouse/clickhouse-server';
  const ours = readImages(need(repo, COMPOSE)).filter((i) => i.repo === repoName);
  if (ours.length !== 1) throw new Error(`${COMPOSE} names ${repoName} ${ours.length} times, not once`);
  const upstream = await net.text(
    `https://raw.githubusercontent.com/triggerdotdev/trigger.dev/${trigger.newest}/docker/docker-compose.yml`,
  );
  const theirs = readImages(upstream).filter((i) => i.repo === repoName);
  if (theirs.length !== 1) throw new Error(`Trigger.dev ${trigger.newest}'s docker-compose.yml names ${repoName} ${theirs.length} times`);
  let support;
  try {
    support = clickhouseSupport(await net.text('https://raw.githubusercontent.com/ClickHouse/ClickHouse/master/SECURITY.md'), ours[0].tag);
  } catch (error) {
    support = `ClickHouse's SECURITY.md could not be read (${error instanceof Error ? error.message : String(error)})`;
  }
  const pin = refText(ours[0]);
  const want = refText(theirs[0]);
  const body = [
    `The stack runs ClickHouse **${pin}** (\`${COMPOSE}\`), and Trigger.dev **${trigger.newest}**'s own \`docker/docker-compose.yml\` pins **${want}**.`,
    '',
    `${support}.`,
    '',
    "Trigger.dev's ClickHouse migrations are written against the ClickHouse its own compose file pins, and the v4.5.12 upgrade crash-looped on one it did not expect (docs/managed-bring-up.md, *Upgrading Trigger.dev*). So this pin follows upstream's, tag and digest, with the Trigger.dev move or in a pull request of its own, proven by E2E (managed) on its branch, and live takes it from a release tag. ClickHouse's data moves forward only.",
    '',
    'This issue stays open while the two differ, also when the stack differs on purpose; record that decision in workplan 0119 §3. It is kept by `.github/workflows/idp-pin-watch.yml`.',
  ].join('\n');
  return {
    pin,
    newest: want,
    state: pin === want ? 'current' : 'behind',
    where: COMPOSE,
    notes: [support],
    body,
    update: `Trigger.dev ${trigger.newest}'s compose file now pins **${want}**; the stack runs ${pin}.`,
    closing: `The stack runs what Trigger.dev pins again: ${pin}.`,
  };
}

/** The overlay that gives the tasks the API image's Node, once `trigger.config.ts` has one. */
export const TASK_OVERLAY = /COPY --from=\S+ \/usr\/local\/bin\/node /;

export async function taskNodeRow(repo, net) {
  const config = need(repo, 'apps/worker/trigger.config.ts');
  if (TASK_OVERLAY.test(config)) {
    return {
      pin: 'apps/api/Dockerfile',
      newest: '-',
      state: 'current',
      notes: ["the tasks copy the API image's Node (apps/worker/trigger.config.ts), which Dependabot moves"],
      closing:
        "The tasks now take the API image's Node (`apps/worker/trigger.config.ts`), which Dependabot moves with `apps/api/Dockerfile`. Nothing is left for this row to watch.",
    };
  }
  const runtime = /\bruntime:\s*['"]([^'"]+)['"]/.exec(config)?.[1];
  if (!runtime) throw new Error('apps/worker/trigger.config.ts names no runtime');
  const cli = JSON.parse(need(repo, 'apps/worker/package.json')).dependencies?.['@trigger.dev/sdk'];
  if (!/^\d+\.\d+\.\d+$/.test(cli ?? '')) throw new Error(`apps/worker's @trigger.dev/sdk is ${cli}, not a version`);
  const image = await cliBaseImage(net, cli, runtime);
  const node = await nodeVersionOf(net, image);
  const floor = securityFloor(await net.json('https://nodejs.org/dist/index.json'), partsOf(node)[0]);
  const latest = (await net.npm(['view', 'trigger.dev', 'version'])).trim();
  if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error(`npm names trigger.dev's latest ${latest}, not a version`);
  let latestNode = node;
  if (latest !== cli) {
    const latestImage = await cliBaseImage(net, latest, runtime);
    if (latestImage !== image) latestNode = await nodeVersionOf(net, latestImage);
  }
  const state = compareParts(node, floor.version) < 0 ? 'behind' : 'current';
  const route =
    compareParts(latestNode, floor.version) >= 0
      ? `The newest CLI, trigger.dev ${latest}, builds on Node ${latestNode}: moving Trigger.dev to it (its issue's route) moves the tasks too.`
      : `The newest CLI, trigger.dev ${latest}, still builds on Node ${latestNode}: upstream has not republished its base image. The way that does not wait for it is an overlay in \`apps/worker/trigger.config.ts\` that copies the API image's Node (\`apps/api/Dockerfile\`, which Dependabot moves) over the base image's. Once it is there, this issue closes.`;
  const body = [
    `The tasks run on the base image the pinned CLI, trigger.dev ${cli}, names for \`runtime: '${runtime}'\`: \`${image}\`, whose Node is **${node}**. Node's newest ${partsOf(node)[0]}.x security release is **${floor.version}** (${floor.date}, https://nodejs.org/dist/index.json).`,
    '',
    route,
    '',
    'The tasks hold every tenant\'s mailbox and calendar credentials during a pass, and they are HTTPS clients. Dependabot ignores `@trigger.dev/*`, and nothing else moves this image. A change to the tasks takes a task deploy on both stacks.',
    '',
    'This issue is kept by `.github/workflows/idp-pin-watch.yml`. It is updated while the Node is below the floor, and closed when it is not.',
  ].join('\n');
  return {
    pin: node,
    newest: floor.version,
    state,
    where: `trigger.dev ${cli}'s BASE_IMAGE['${runtime}']`,
    notes: [`newest CLI trigger.dev ${latest}: Node ${latestNode}`],
    body,
    news: [`**${floor.version}**`, `trigger.dev ${latest}`],
    update: `The tasks' Node is ${node}; Node's newest security release is now **${floor.version}**, and the newest CLI is trigger.dev ${latest} (Node ${latestNode}).`,
    closing: `The tasks' Node, ${node}, is at or above Node's newest security release again.`,
  };
}

export async function pnpmRow(repo, net) {
  const declared = JSON.parse(need(repo, 'package.json')).packageManager ?? '';
  const pin = /^pnpm@(\d+\.\d+\.\d+)(?:\+\S+)?$/.exec(declared)?.[1];
  if (!pin) throw new Error(`package.json's packageManager is '${declared}', not pnpm@x.y.z`);
  const major = partsOf(pin)[0];
  const tags = JSON.parse(await net.npm(['view', 'pnpm', 'dist-tags', '--json']));
  const newest = tags?.[`latest-${major}`];
  if (!/^\d+\.\d+\.\d+$/.test(newest ?? '')) throw new Error(`npm has no latest-${major} tag for pnpm`);
  const notes = [];
  if (/^\d+\./.test(tags.latest ?? '') && partsOf(tags.latest)[0] > major) {
    notes.push(`pnpm ${partsOf(tags.latest)[0]} is npm's latest (${tags.latest}); a new major is the owner's call`);
  }
  const body = [
    `\`package.json\` declares \`packageManager: pnpm@${pin}\`, and the newest pnpm ${major} is **${newest}** (npm's \`latest-${major}\`). CI and the images take pnpm from that field.`,
    '',
    `Take it once it is three days old (\`minimumReleaseAge\` in \`pnpm-workspace.yaml\`): set \`packageManager\` to \`pnpm@${newest}\`, run \`pnpm install\`, and check the lockfile did not change, in a pull request of its own.`,
    ...notes.map((note) => `\n${note}.`),
    '',
    'This issue is kept by `.github/workflows/idp-pin-watch.yml`. It is updated while the two differ, and closed when the pin catches up.',
  ].join('\n');
  return {
    pin,
    newest,
    state: stateOf(pin, newest),
    where: 'package.json packageManager',
    notes,
    body,
    update: `The pin is ${pin}, and the newest pnpm ${major} is now **${newest}**.`,
  };
}

export async function typescriptRow(repo, net) {
  const manifest = JSON.parse(need(repo, 'package.json'));
  const all = { ...manifest.dependencies, ...manifest.devDependencies };
  if (!all['@typescript/native']) {
    return {
      pin: 'no split',
      newest: '-',
      state: 'current',
      notes: ['package.json has no @typescript/native: the split is gone'],
      closing: 'The split is gone: `package.json` has no `@typescript/native` any more.',
    };
  }
  const eslint = JSON.parse(await net.npm(['view', 'typescript-eslint@latest', 'version', 'peerDependencies', '--json']));
  const range = eslint?.peerDependencies?.typescript;
  if (!range) throw new Error("typescript-eslint's latest declares no typescript peer range");
  const listed = (await net.npm(['view', `typescript@${range}`, 'version', '--json'])).trim();
  const versions = listed ? [].concat(JSON.parse(listed)) : [];
  const admitted = versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v) && compareParts(v, '7.1.0') >= 0).sort(compareParts);
  const newest = admitted.at(-1);
  const body = [
    `typescript-eslint ${eslint.version}'s peer range, \`typescript ${range}\`, admits TypeScript **${newest}**, a stable 7.1 or later. So the two-TypeScript split AGENTS.md describes can go. This is a cleanup, not a security lag: TypeScript checks types here and ships in no image.`,
    '',
    'In one pull request:',
    '',
    '1. Delete the `typescript` semver-major ignore in `.github/dependabot.yml`.',
    `2. Set \`"typescript"\` back to plain \`^${newest}\` and drop \`"@typescript/native"\` in \`package.json\`, \`apps/api/package.json\` and \`apps/web/package.json\`.`,
    '3. Remove the `typecheck:legacy` script, and delete `scripts/toolchain-split.unit.test.ts`.',
    '4. Rewrite the "two TypeScripts" paragraph of AGENTS.md, and record the outcome in workplan 0026 row 22.',
    '5. `pnpm install`, a cold `pnpm lint` (no cache), `pnpm typecheck` and the full gate. If typescript-eslint supports 7.1 only behind a flag, wait, or name the flag in `eslint.config.js`.',
    '',
    'This issue is kept by `.github/workflows/idp-pin-watch.yml`.',
  ].join('\n');
  return {
    pin: `typescript-eslint ${eslint.version}: typescript ${range}`,
    newest: newest ?? 'no stable 7.1 admitted',
    state: newest ? 'behind' : 'current',
    shown: newest ? 'can go' : 'not yet',
    where: 'package.json (two TypeScripts)',
    body,
    news: newest ? `**${newest}**` : undefined,
    update: `typescript-eslint ${eslint.version} now admits TypeScript **${newest}**.`,
    closing: `typescript-eslint ${eslint.version}'s peer range no longer admits a stable TypeScript 7.1.`,
  };
}

// -------------------------------------------------- routine pins ---------

/**
 * Every routine pin, each compared on its own, and the status lines that
 * never open the summary issue. A row that cannot be read is an `error` row,
 * listed and never "current".
 */
export async function routineRows(repo, net) {
  const tagLists = new Map();
  const tagsFor = (name) => {
    if (!tagLists.has(name)) tagLists.set(name, registryTags(net, name));
    return tagLists.get(name);
  };
  const jobs = [];

  // Every image line of the compose files, but for those another row compares
  // and www.yml's nginx, which follows the web image.
  // An image built here (`localhost/postgres`, 2026-10-26) is compared by its
  // Dockerfile's FROM: its own tag is this repository's, and no registry lists it.
  const images = new Map();
  for (const file of COMPOSE_FILES) {
    for (const line of readImages(need(repo, file))) {
      const built = builtImage(repo, file, line);
      const image = built ? { ...built.base, line: line.line } : line;
      if (image.repo in COMPARED_ELSEWHERE) continue;
      if (file === 'deploy/compose/www.yml' && image.repo === 'nginx') continue;
      const key = `${image.repo}:${image.tag}`;
      if (!images.has(key)) images.set(key, { ...image, where: [] });
      if (built) images.get(key).dockerfile = built.dockerfile;
      for (const where of built ? [built.dockerfile, file] : [file]) {
        if (!images.get(key).where.includes(where)) images.get(key).where.push(where);
      }
    }
  }
  for (const image of images.values()) {
    jobs.push([image.repo, image.where.join(', '), async () => {
      if (!image.tag) throw new Error(`${image.repo} is pinned by no tag`);
      // A tag with no number to compare, held by its digest: what moves is the
      // digest the registry names for it (Chainguard's free `latest`, 0146 T7).
      if (!/\d/.test(image.tag) && image.digest) {
        const now = await registryDigest(net, image.repo, image.tag);
        const state = now === image.digest ? 'current' : 'behind';
        return {
          pin: `${image.tag}@${image.digest}`,
          newest: `${image.tag}@${now}`,
          state,
          ...(state === 'behind' ? { notes: [REBUILD_NOTE] } : {}),
        };
      }
      const newest = newestLike(image.tag, await tagsFor(image.repo));
      const state = stateOf(image.tag, newest);
      return { pin: image.tag, newest, state, ...(state === 'behind' && image.dockerfile ? { notes: [builtNote(image.dockerfile)] } : {}) };
    }]);
  }

  // busybox: the scripts run the same image by hand, so they keep the compose file's tag.
  jobs.push(['busybox in the scripts', 'deploy/compose/*.sh', async () => {
    const own = readImages(need(repo, COMPOSE)).filter((i) => i.repo === 'busybox');
    if (own.length === 0) throw new Error(`${COMPOSE} runs no busybox to compare the scripts with`);
    const tags = new Set();
    for (const name of repo.list('deploy/compose').filter((n) => n.endsWith('.sh'))) {
      for (const m of need(repo, `deploy/compose/${name}`).matchAll(/\bbusybox:([0-9][\w.-]*)/g)) tags.add(m[1]);
    }
    if (tags.size === 0) throw new Error('no script in deploy/compose names busybox');
    const pin = [...tags].sort(compareParts);
    const stray = pin.filter((t) => t !== own[0].tag);
    return { pin: pin.join(' / '), newest: own[0].tag, state: stray.length ? 'behind' : 'current' };
  }]);

  // nginx: www.yml runs the line the web image runs, and Dependabot moves the web image.
  jobs.push(['nginx in www.yml', 'deploy/compose/www.yml, apps/web/Dockerfile', async () => {
    const www = readImages(need(repo, 'deploy/compose/www.yml')).filter((i) => i.repo === 'nginx');
    const from = /^FROM\s+(nginx:\S+)/m.exec(need(repo, 'apps/web/Dockerfile'))?.[1];
    if (www.length !== 1 || !from) throw new Error('www.yml or apps/web/Dockerfile names no single nginx');
    const pin = refText(www[0]);
    const newest = refText(parseRef(from));
    return { pin, newest, state: pin === newest ? 'current' : 'behind' };
  }]);

  // Stalwart: a test fixture, never on live, but its copies drift together.
  jobs.push(['stalwartlabs/stalwart', 'the testing fixtures, setup-stalwart.sh', async () => {
    const pins = new Set();
    for (const file of STALWART_FILES) {
      for (const m of (repo.read(file) ?? '').matchAll(/stalwartlabs\/stalwart:(v\d+\.\d+\.\d+)/g)) pins.add(m[1]);
    }
    if (pins.size === 0) throw new Error('no file names a Stalwart pin');
    const pin = [...pins].sort(compareParts);
    const newest = newestLike(pin[0], await tagsFor('stalwartlabs/stalwart'), 2);
    const state = pin.length > 1 ? 'behind' : stateOf(pin[0], newest);
    // AGENTS.md: "Never change the pinned Stalwart version". An agent reading
    // the summary issue is told whose call it is, and by which document.
    const notes = [...(pin.length > 1 ? ['the copies disagree'] : []), ...(state === 'behind' ? [STALWART_RULE] : [])];
    return { pin: pin.join(' / '), newest, state, notes };
  }]);

  // GoAccess: the visit count's image, built here since #1675 from the commit
  // of a release (deploy/compose/goaccess/Dockerfile, whose Alpine Dependabot
  // moves). So its release is compared with upstream's git tags, the two-part
  // and the three-part alike (1.10.1 followed 1.10), and the name the script
  // runs must be that release's.
  jobs.push(['allinurl/goaccess', 'deploy/compose/site-visits.sh, deploy/compose/goaccess/Dockerfile', async () => {
    const ref = /GOACCESS_IMAGE="([^"]+)"/.exec(need(repo, 'deploy/compose/site-visits.sh'))?.[1];
    if (!ref) throw new Error('site-visits.sh names no GOACCESS_IMAGE');
    const release = /^# GoAccess (v\d+(?:\.\d+)+)$/m.exec(need(repo, GOACCESS_DOCKERFILE))?.[1];
    if (!release) throw new Error(`${GOACCESS_DOCKERFILE} names no GoAccess release ("# GoAccess v1.12") above the commit it builds`);
    const { tag } = parseRef(ref);
    if (`v${tag}` !== release) throw new Error(`site-visits.sh runs ${ref}, and ${GOACCESS_DOCKERFILE} builds GoAccess ${release}`);
    const tags = tagsOf(await net.lsRemote('https://github.com/allinurl/goaccess'));
    const candidates = [];
    for (const shape of [release, `${release}.0`]) {
      try {
        candidates.push(newestLike(shape, tags));
      } catch {
        // No tag of that shape: the other shape still answers, and none at all fails below.
      }
    }
    if (candidates.length === 0) throw new Error(`no tag shaped like ${release} was listed, so it cannot be called current`);
    const newest = candidates.sort(compareParts).at(-1);
    return { pin: release, newest, state: stateOf(release, newest) };
  }]);

  // Trivy: the binary the Security Scan runs, named or the action's default.
  jobs.push(['Trivy', '.github/workflows/security-scan.yml', async () => {
    const steps = stepsUsing(need(repo, '.github/workflows/security-scan.yml'), 'aquasecurity/trivy-action');
    if (steps.length === 0) throw new Error('security-scan.yml runs no trivy-action');
    const pins = new Set();
    const notes = [];
    for (const step of steps) {
      if (step.with.version) {
        pins.add(step.with.version);
        continue;
      }
      const fallback = actionDefault(
        await net.text(`https://raw.githubusercontent.com/aquasecurity/trivy-action/${step.sha}/action.yaml`),
        'version',
      );
      pins.add(fallback);
      notes.push(`no version: named, so trivy-action ${step.version || step.sha.slice(0, 7)}'s default`);
    }
    const pin = [...pins].sort(compareParts);
    const newest = newestLike(pin[0], tagsOf(await net.lsRemote('https://github.com/aquasecurity/trivy')));
    return { pin: pin.join(' / '), newest, state: stateOf(pin[0], newest), notes: [...new Set(notes)] };
  }]);

  // cosign: what signs the images and what checks them. Named in a step
  // (`cosign-release:`), it is a pin nothing else moves, as Trivy's is, and a
  // row, its copies held together. Left to cosign-installer's default,
  // Dependabot moves it with the installer, and it is a status line only.
  const status = [];
  const cosignSteps = [];
  try {
    for (const file of COSIGN_FILES) {
      const steps = stepsUsing(need(repo, file), 'sigstore/cosign-installer');
      if (steps.length === 0) throw new Error(`${file} runs no cosign-installer`);
      cosignSteps.push(...steps);
    }
  } catch (error) {
    status.push(`cosign: could not be read (${error instanceof Error ? error.message : String(error)})`);
  }
  const installs = async (step) =>
    step.with['cosign-release'] ??
    actionDefault(await net.text(`https://raw.githubusercontent.com/sigstore/cosign-installer/${step.sha}/action.yml`), 'cosign-release');
  const cosignNewest = async (pin) => newestLike(pin, tagsOf(await net.lsRemote('https://github.com/sigstore/cosign')));
  const named = status.length === 0 && cosignSteps.some((step) => step.with['cosign-release']);
  if (named) {
    jobs.push(['cosign', COSIGN_FILES.join(', '), async () => {
      const pins = new Set();
      for (const step of cosignSteps) pins.add(await installs(step));
      const pin = [...pins].sort(compareParts);
      const newest = await cosignNewest(pin[0]);
      const state = pin.length > 1 ? 'behind' : stateOf(pin[0], newest);
      return { pin: pin.join(' / '), newest, state, notes: pin.length > 1 ? ['the copies disagree'] : [] };
    }]);
  }

  const rows = [];
  for (const [name, where, job] of jobs) rows.push(await settle(job, { name, where }));

  if (status.length === 0 && !named) {
    try {
      const [step] = cosignSteps;
      const pin = await installs(step);
      status.push(
        `cosign: cosign-installer ${step.version || step.sha.slice(0, 7)} installs ${pin} (its default), and the newest cosign is ${await cosignNewest(pin)}`,
      );
    } catch (error) {
      status.push(`cosign: could not be read (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return { rows, status };
}

const lineOf = (row) => `- \`${row.name}\` (${row.where}): ${row.pin}, newest **${row.newest}**${row.notes?.length ? `; ${row.notes.join('; ')}` : ''}`;
const failedLineOf = (row) =>
  row.state === 'ahead'
    ? `- \`${row.name}\` (${row.where}): ${row.pin} is ahead of every listed tag (newest listed ${row.newest}): a tag withdrawn upstream, or a list read short`
    : `- \`${row.name}\` (${row.where}): ${row.error}`;

/**
 * The one issue for the routine pins: open while any is behind, closed when
 * none is and every row was read. A pin ahead of every listed tag is a read
 * this cannot trust, like an error: it never lets the issue close.
 */
export function summaryOf(rows, status) {
  const behind = rows.filter((r) => r.state === 'behind');
  const failed = rows.filter((r) => r.state === 'error' || r.state === 'ahead');
  const body = [
    "Dependabot does not read these pins, but for an image built here, whose line says so: its compose fetcher reads only files named like `compose.yml`, and no file in `deploy/compose` is (`a-dependabot-directory-with-nothing-to-read`). So this watch reads them, each against its own registry's tags of the same major. Behind:",
    '',
    ...behind.map(lineOf),
    '',
    'Each moves in a pull request with its release notes read, and with what it phones home re-read where `scripts/a-service-that-phones-home.unit.test.ts` pins it. An image of `managed.yml` takes E2E (managed) dispatched on its branch, and live takes it from a release tag. A release younger than three days waits (CONTRIBUTING.md). A major is the owner\'s call, and is never offered here.',
    ...(failed.length ? ['', 'Could not be read this week:', '', ...failed.map(failedLineOf)] : []),
    ...(status.length ? ['', 'Also known, and no reason for this issue on its own:', '', ...status.map((s) => `- ${s}`)] : []),
    '',
    'This issue is kept by `.github/workflows/idp-pin-watch.yml`. It is updated while any is behind, and closed when none is.',
  ].join('\n');
  return {
    pin: `${behind.length} behind`,
    newest: `${rows.length} read`,
    state: behind.length ? 'behind' : failed.length ? 'error' : 'current',
    error: failed.length && !behind.length ? `${failed.length} could not be read` : undefined,
    where: 'the routine pins',
    body,
    news: behind.map(lineOf),
    update: (fresh) => ['Newly behind, or behind a newer release:', '', ...fresh].join('\n'),
    closing: 'Every pin this issue lists is current again.',
  };
}

// ---------------------------------------------------------- issues -------

/** Two issue bodies are the same text, whatever line endings GitHub hands back. */
function sameText(a, b) {
  const plain = (text) => String(text ?? '').replace(/\r\n/g, '\n').trim();
  return plain(a) === plain(b);
}

/**
 * Keeps one issue open, under `title`, while a row is behind: opens it, or
 * brings the one already open up to date; closes it once the row is current.
 * `gh` takes the arguments of the GitHub CLI and returns its output.
 *
 * An edit notifies nobody, so when the newest moved while the issue was open
 * that is also said in a comment. A reworded body with nothing new is edited
 * quietly, and a week with nothing new writes nothing. A row in error, or
 * ahead of every release, touches nothing.
 */
export function keepIssue(result, gh, title = ISSUE_TITLE) {
  const listed = JSON.parse(
    gh(['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,title,body']) || '[]',
  );
  const open = listed.filter((issue) => issue.title === title);
  if (result.state === 'behind') {
    const body = result.body ?? issueBody(result);
    if (open.length === 0) {
      gh(['issue', 'create', '--title', title, '--body', body]);
      return 'opened';
    }
    const [issue] = open;
    if (sameText(issue.body, body)) return 'unchanged';
    const number = String(issue.number);
    gh(['issue', 'edit', number, '--body', body]);
    const news = [].concat(result.news ?? `**${result.newest}**`).filter(Boolean);
    const fresh = news.filter((n) => !String(issue.body ?? '').includes(n));
    if (fresh.length > 0) {
      const update =
        typeof result.update === 'function'
          ? result.update(fresh)
          : (result.update ?? `The pin is ${result.pin}, and upstream's newest release is now **${result.newest}**.`);
      gh(['issue', 'comment', number, '--body', update]);
    }
    return 'updated';
  }
  if (result.state === 'current' && open.length > 0) {
    for (const issue of open) {
      gh(['issue', 'close', String(issue.number), '--comment', result.closing ?? closingOf(result.pin)]);
    }
    return 'closed';
  }
  return 'untouched';
}

// ------------------------------------------------------------ the run ----

async function settle(job, meta) {
  try {
    return { ...meta, ...(await job()) };
  } catch (error) {
    return { ...meta, state: 'error', error: error instanceof Error ? error.message : String(error) };
  }
}

/** Every row, in the order the table prints them. */
export async function watch(repo, net) {
  const own = (key, name) => ({ key, name, title: TITLES[key] });
  const zitadel = await settle(() => zitadelRow(repo, net), own('zitadel', 'identity provider'));
  const trigger = await settle(() => triggerRow(repo, net), own('trigger', 'Trigger.dev'));
  const clickhouse = await settle(() => clickhouseRow(repo, net, trigger), own('clickhouse', 'ClickHouse'));
  const taskNode = await settle(() => taskNodeRow(repo, net), own('taskNode', "the tasks' Node"));
  const pnpm = await settle(() => pnpmRow(repo, net), own('pnpm', 'pnpm'));
  const typescript = await settle(() => typescriptRow(repo, net), own('typescript', 'TypeScript split'));
  // The routine rows settle one by one; this catches only a checkout that lacks a compose file.
  const { rows, status } = await routineRows(repo, net).catch((error) => ({
    rows: [{ name: 'the compose files', where: COMPOSE_FILES.join(', '), state: 'error', error: error instanceof Error ? error.message : String(error) }],
    status: [],
  }));
  const summary = { ...own('routine', 'routine pins'), ...summaryOf(rows, status) };
  return { issues: [zitadel, trigger, clickhouse, taskNode, pnpm, typescript, summary], routine: rows, status };
}

const short = (text) => String(text ?? '').replace(/@sha256:([0-9a-f]{8})[0-9a-f]+/g, '@sha256:$1…');

/** The report as the job's log shows it: one line per row, notes indented under it. */
export function table(report) {
  const entries = [{ cells: ['', 'pinned', 'newest', 'state'], notes: [] }];
  const add = (row, name = row.name) =>
    entries.push({
      cells: [name, short(row.pin), short(row.newest), row.state === 'error' ? 'ERROR' : (row.shown ?? row.state)],
      notes: [...(row.notes ?? []), ...(row.state === 'error' ? [row.error] : [])],
    });
  for (const row of report.issues) if (row.key !== 'routine') add(row);
  const summary = report.issues.find((row) => row.key === 'routine');
  entries.push({ cells: ['routine pins, one issue', '', '', summary?.state ?? ''], notes: [] });
  for (const row of report.routine) add(row, `  ${row.name}`);
  const width = [0, 1, 2].map((i) => Math.max(...entries.map((e) => e.cells[i].length)));
  const out = [];
  for (const { cells, notes } of entries) {
    out.push(cells.map((cell, i) => (i < 3 ? cell.padEnd(width[i]) : cell)).join('  ').trimEnd());
    for (const note of notes) out.push(`      ${short(note)}`);
  }
  for (const line of report.status) out.push(`status: ${line}`);
  return out.join('\n');
}

/** The real network: fetch, git, npm, and the probe `trigger-version.sh list` runs. */
export function realNet(root) {
  const get = async (url, headers = {}) => {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ownpace-pin-watch', ...headers },
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status} for ${new URL(url).pathname}`);
    return res;
  };
  const run = (command, args, stdio) => execFileSync(command, args, { encoding: 'utf8', timeout: 120_000, stdio });
  return {
    text: async (url, headers) => (await get(url, headers)).text(),
    json: async (url, headers) => (await get(url, headers)).json(),
    bytes: async (url, headers) => Buffer.from(await (await get(url, headers)).arrayBuffer()),
    digest: async (url, headers = {}) => {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'ownpace-pin-watch', ...headers },
        signal: globalThis.AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status} for ${new URL(url).pathname}`);
      return res.headers.get('docker-content-digest') ?? '';
    },
    lsRemote: async (url) => run('git', ['ls-remote', '--tags', '--refs', url]),
    npm: async (args) => run('npm', args, ['ignore', 'pipe', 'inherit']),
    probe: async (pin) => run('bash', [join(root, 'deploy/compose/trigger-version.sh'), 'probe', pin], ['ignore', 'pipe', 'inherit']),
  };
}

/** The checkout, read: a file's text or null, and a directory's names. */
export function repoReader(root) {
  return {
    read: (rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null),
    list: (rel) => readdirSync(join(root, rel)),
  };
}

async function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const report = await watch(repoReader(root), realNet(root));
  console.log(table(report));
  if (argv.includes('--issue')) {
    const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });
    for (const row of report.issues) {
      try {
        console.log(`issue, ${row.name}: ${keepIssue(row, gh, row.title)}`);
      } catch (error) {
        console.error(`issue, ${row.name}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    }
  }
  // A row that could not be read says nothing about its pin, and a pin newer
  // than every release is a pre-release, or a tag list read wrong.
  if ([...report.issues, ...report.routine].some((r) => r.state === 'error' || r.state === 'ahead')) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`idp-pin-watch: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

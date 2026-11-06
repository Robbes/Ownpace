#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A TAG PUBLISHED, CHECKED (the `verify` job of
 * `.github/workflows/release.yml`, and `mode=verify` for any existing tag;
 * `docs/release.md` §3 and §4).
 *
 * - **The release:** exists, is not a draft, is a pre-release exactly when
 *   the version has a hyphen, and its body holds exactly one block Security
 *   Scan generated (counted by its `cosign verify` line) and links the
 *   changelog at the tag. `bom.json` and the Windows zip are uploaded and not
 *   empty. Two generated blocks is the half-published state of
 *   `docs/release.md` §3: a scan re-run on a release that already had its
 *   body; one is deleted from the body by hand.
 * - **The SBOM** is CycloneDX and names the version.
 * - **The zip:** its own `SHA256SUMS.txt` holds for every file it names,
 *   and its `node.exe` hashes to the sum the tagged commit pins for it
 *   (`NODE_RUNTIME_SHA256` in `scripts/package-appliance.mjs`, for the Node
 *   `apps/selfhost/Dockerfile` names, both read at COMMIT through the API,
 *   since this job checks out the ref it was dispatched on). The zip's own
 *   list could be swapped with the binary; the commit cannot (#1780's review).
 *   A tag from before those sums were committed (2026-11-01) gets a note.
 * - **The images** `ghcr.io/robbes/ownpace-{api,web,selfhost}` at `X.Y.Z`:
 *   an index with linux/amd64 and linux/arm64, its revision label the
 *   commit, `sha-<commit>` the same index, `latest` withheld from a
 *   pre-release and given to a release. Read from the registry's own API
 *   with an anonymous pull token.
 * - **The signatures:** `cosign verify` by digest, first with the exact
 *   identity of `images.yml` at the tag and GitHub's issuer, then with the
 *   regexp `docs/release.md` documents, so the command a reader copies is
 *   proven too.
 * - **The tasks' base** the tagged commit's `apps/worker/trigger.config.ts`
 *   pins (`TASK_BASE_IMAGE`, workplan 0119 §3 item 13, read through the API):
 *   `ghcr.io/robbes/ownpace-task-base` at that index digest, with linux/amd64
 *   and linux/arm64; its revision label the commit its `sha-` tag names, and
 *   an ancestor of the tagged commit (the compare API), since main published
 *   it; and `cosign verify` by digest with the exact identity of `images.yml`
 *   on `refs/heads/main`, which is the only ref that publishes it. A tag
 *   whose config pins none (before 2026-11-06) gets a note.
 * - **`GET /version`** on the selfhost image started on PGlite in a
 *   container this job removes, asked from inside it with the image's own
 *   Node by its path (`APPLIANCE_NODES`): the version and the commit.
 *
 * It writes nothing anywhere: no release, no tag, no package.
 *
 * Environment: VERSION (the tag), COMMIT (the commit it peels to), GH_TOKEN
 * (optional; the repository is public). Exit 1 on any refusal.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { github, pass, refuse, note, report, short } from './release-github.mjs';
import { nodeRuntimeVersion } from './package-appliance.mjs';
import { TASK_BASE_CONFIG, TASK_BASE_LINE, taskBasePin } from './idp-pin-watch.mjs';

export const IMAGES = ['api', 'web', 'selfhost'];
export const REGISTRY = 'ghcr.io/robbes';
export const ISSUER = 'https://token.actions.githubusercontent.com';
/** The identity regexp `docs/release.md` documents, to the character. */
export const IDENTITY_REGEXP = '^https://github\\.com/Robbes/(open-migrate|ownpace|Ownpace)/';

const bare = (version) => version.replace(/^v/, '');
export const zipName = (version) => `ownpace-appliance-win-x64-${version}.zip`;

/** How many blocks Security Scan generated are in a release body. */
export function generatedBlocks(body, version) {
  const marker = `cosign verify ${REGISTRY}/ownpace-selfhost:${bare(version)}`;
  return (body ?? '').split(marker).length - 1;
}

/** The release itself: exists, flag, body, assets. */
export function checkRelease(release, version) {
  if (!release) return [refuse('release-exists', `there is no release for ${version}`)];
  const lines = [];
  lines.push(release.draft ? refuse('release-exists', `the release for ${version} is a draft`) : pass('release-exists', `the release for ${version} is published`));
  const pre = version.includes('-');
  lines.push(
    release.prerelease === pre
      ? pass('release-prerelease', pre ? 'marked pre-release, as a hyphenated version is' : 'not marked pre-release, as a release is not')
      : refuse('release-prerelease', `prerelease is ${release.prerelease}, and ${version} ${pre ? 'is' : 'is not'} a pre-release`),
  );
  const blocks = generatedBlocks(release.body, version);
  if (blocks === 0) {
    lines.push(refuse('release-body', `the body holds no block Security Scan generated (no "cosign verify ${REGISTRY}/ownpace-selfhost:${bare(version)}" line)`));
  } else if (blocks > 1) {
    lines.push(
      refuse('release-body', `the body holds ${blocks} generated blocks: a scan was re-run on a release that already had its body; delete all but one by hand`),
    );
  } else if (!(release.body ?? '').includes(`/blob/${version}/CHANGELOG.md`)) {
    lines.push(refuse('release-body', `the generated block does not link CHANGELOG.md at ${version}`));
  } else {
    lines.push(pass('release-body', 'one generated block: the pull lines, the signature check and the changelog link'));
  }
  const problems = [];
  for (const name of ['bom.json', zipName(version)]) {
    const asset = (release.assets ?? []).find((a) => a.name === name);
    if (!asset) problems.push(`${name} is not attached`);
    else if (asset.state !== 'uploaded') problems.push(`${name} is ${asset.state}, not uploaded`);
    else if (!(asset.size > 0)) problems.push(`${name} is empty`);
  }
  lines.push(
    problems.length === 0
      ? pass('release-assets', `bom.json and ${zipName(version)} are attached`)
      : refuse('release-assets', problems.join('; ')),
  );
  return lines;
}

/** The SBOM: CycloneDX, naming the version. */
export function checkBom(bom, version) {
  if (bom?.bomFormat !== 'CycloneDX') return refuse('sbom', `bom.json is not a CycloneDX SBOM (${bom?.bomFormat ?? 'unreadable'})`);
  const named = bom.metadata?.component?.version;
  return named === bare(version)
    ? pass('sbom', `CycloneDX ${bom.specVersion ?? ''} for ${named}`.replace('  ', ' '))
    : refuse('sbom', `bom.json names ${named}, not ${bare(version)}`);
}

/** Every file SHA256SUMS.txt names hashes as it says. `hashOf` answers null for a missing file. */
export function verifySums(sums, hashOf) {
  const entries = (sums ?? '')
    .split('\n')
    .map((l) => /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => ({ hash: m[1], file: m[2].replace(/^\.\//, '') }));
  if (entries.length === 0) return refuse('zip-sums', 'SHA256SUMS.txt names no file: it proves nothing');
  const bad = [];
  for (const { hash, file } of entries) {
    const got = hashOf(file);
    if (got === null) bad.push(`${file} is missing`);
    else if (got !== hash) bad.push(`${file} does not match`);
  }
  return bad.length === 0
    ? pass('zip-sums', `SHA256SUMS.txt holds for all ${entries.length} files`)
    : refuse('zip-sums', bad.slice(0, 5).join('; ') + (bad.length > 5 ? `, and ${bad.length - 5} more` : ''));
}

/** The `NODE_RUNTIME_SHA256` literal in `scripts/package-appliance.mjs`'s text. */
const RUNTIME_PINS = /^export const NODE_RUNTIME_SHA256 = \{$([\s\S]*?)^\};$/m;

/**
 * The SHA-256 the packager's text pins for one runtime: the `NODE_RUNTIME_SHA256`
 * entry of `scripts/package-appliance.mjs` as read at a commit, for `version`
 * and `platform`. null when the text has no NODE_RUNTIME_SHA256 at all (a
 * commit from before 2026-11-01); throws when it has one without that sum.
 * Text, not an import: the file is the tagged commit's, not this checkout's.
 */
export function pinnedRuntimeIn(packagerText, version, platform) {
  const block = RUNTIME_PINS.exec(packagerText ?? '');
  if (!block) return null;
  const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entry = new RegExp(`^  '${literal(version)}': \\{$([\\s\\S]*?)^  \\},?$`, 'm').exec(block[1]);
  const sum = entry && new RegExp(`^    '${literal(platform)}': '([0-9a-f]{64})',?$`, 'm').exec(entry[1]);
  if (!sum) throw new Error(`scripts/package-appliance.mjs at the tag pins no ${platform} sum for Node ${version} in NODE_RUNTIME_SHA256`);
  return sum[1];
}

/** The zip's `node.exe` (its sha256, or null when absent) is the one the tagged commit pins. */
export function checkRuntime(seen, pinned, nodeVersion) {
  if (pinned === null) {
    return note('zip-node', "the tagged commit pins no node.exe sum (NODE_RUNTIME_SHA256 came on 2026-11-01): node.exe is held only to the zip's own SHA256SUMS.txt");
  }
  if (seen === null) return refuse('zip-node', `the zip holds no node.exe, and the tagged commit pins Node ${nodeVersion} win-x64`);
  return seen === pinned
    ? pass('zip-node', `node.exe is Node ${nodeVersion} win-x64 as the tagged commit pins it (sha256 ${short(pinned)}…)`)
    : refuse('zip-node', `node.exe's sha256 is ${seen}, and the tagged commit pins ${pinned} for Node ${nodeVersion} win-x64`);
}

/** A multi-arch index with both platforms. */
export function checkIndex(index, { image, tag }) {
  const check = `image-${image}`;
  if (!Array.isArray(index?.manifests)) return refuse(check, `ownpace-${image}:${tag} is not a multi-arch index`);
  const has = (arch) => index.manifests.some((m) => m.platform?.os === 'linux' && m.platform?.architecture === arch);
  const missing = ['amd64', 'arm64'].filter((a) => !has(a)).map((a) => `linux/${a}`);
  return missing.length === 0
    ? pass(check, `ownpace-${image}:${tag} has linux/amd64 and linux/arm64`)
    : refuse(check, `ownpace-${image}:${tag} has no ${missing.join(' and no ')}`);
}

/** The image's revision label is the commit. */
export function checkRevision(config, { image, commit }) {
  const label = config?.config?.Labels?.['org.opencontainers.image.revision'];
  return label === commit
    ? pass(`revision-${image}`, `ownpace-${image} was built from ${short(commit)}`)
    : refuse(`revision-${image}`, `ownpace-${image}'s revision label is ${label ? short(label) : 'missing'}, not ${short(commit)}`);
}

/** `latest` withheld from a pre-release, and given to a release. */
export function latestWithheld({ image, version, versionDigest, latestDigest }) {
  const check = `latest-${image}`;
  if (version.includes('-')) {
    return latestDigest === versionDigest
      ? refuse(check, `ownpace-${image}:latest is this pre-release: latest must be withheld from it`)
      : pass(check, `ownpace-${image}:latest is not this pre-release`);
  }
  return latestDigest === versionDigest
    ? pass(check, `ownpace-${image}:latest is this release`)
    : refuse(check, `ownpace-${image}:latest is not this release`);
}

/**
 * THE TASKS' BASE (workplan 0119 §3 item 13). Published from main only, never
 * from a tag, so its signature is images.yml's on `refs/heads/main`; the image
 * name under REGISTRY.
 */
export const TASK_BASE_IMAGE = 'task-base';
export const MAIN_IDENTITY = 'https://github.com/Robbes/Ownpace/.github/workflows/images.yml@refs/heads/main';

/** The tagged commit's pin of the tasks' base, or null when its config names none (a tag from before 2026-11-06). */
export function taskBasePinIn(configText) {
  if (configText === null || !TASK_BASE_LINE.test(configText)) return null;
  return taskBasePin(configText);
}

/** The pinned index has both platforms. */
export function checkTaskBaseIndex(index, pin) {
  if (!Array.isArray(index?.manifests)) return refuse('task-base', `ownpace-task-base@${short(pin.digest)} is not a multi-arch index`);
  const has = (arch) => index.manifests.some((m) => m.platform?.os === 'linux' && m.platform?.architecture === arch);
  const missing = ['amd64', 'arm64'].filter((a) => !has(a)).map((a) => `linux/${a}`);
  return missing.length === 0
    ? pass('task-base', `ownpace-task-base:${pin.tag}@${short(pin.digest)}, which the tagged commit pins, has linux/amd64 and linux/arm64`)
    : refuse('task-base', `ownpace-task-base@${short(pin.digest)} has no ${missing.join(' and no ')}`);
}

/** The pinned base's revision label: the full commit, starting with the seven its `sha-` tag names; null when it is not. */
export function taskBaseRevision(config, pin) {
  const label = config?.config?.Labels?.['org.opencontainers.image.revision'];
  return typeof label === 'string' && /^[0-9a-f]{40}$/.test(label) && label.startsWith(pin.commit) ? label : null;
}

/** The compare API's answer for `<revision>...<tag's commit>`: the revision is the commit, or behind it. */
export function checkTaskBaseAncestry(compare, { revision, commit }) {
  const status = compare?.status;
  return status === 'ahead' || status === 'identical'
    ? pass('task-base-revision', `the tasks' base was built from ${short(revision)}, ${status === 'identical' ? 'the tagged commit itself' : 'an ancestor of the tagged commit'}`)
    : refuse('task-base-revision', `the tasks' base was built from ${short(revision)}, which is not an ancestor of ${short(commit)} (the compare API says ${status ?? 'nothing'})`);
}

/** The one `cosign verify` of the tasks' base: by digest, with the identity of images.yml on main. */
export function taskBaseCosignCall(digest) {
  return ['verify', `${REGISTRY}/ownpace-${TASK_BASE_IMAGE}@${digest}`, '--certificate-identity', MAIN_IDENTITY, '--certificate-oidc-issuer', ISSUER];
}

/** The two `cosign verify` calls: the exact identity, then the documented regexp. */
export function cosignCalls({ image, digest, version }) {
  const ref = `${REGISTRY}/ownpace-${image}@${digest}`;
  return [
    [
      'verify',
      ref,
      '--certificate-identity',
      `https://github.com/Robbes/Ownpace/.github/workflows/images.yml@refs/tags/${version}`,
      '--certificate-oidc-issuer',
      ISSUER,
    ],
    ['verify', ref, '--certificate-identity-regexp', IDENTITY_REGEXP, '--certificate-oidc-issuer', ISSUER],
  ];
}

/** `GET /version` answers the version and the commit. */
export function versionAnswer(answer, { version, commit }) {
  if (answer?.version === bare(version) && answer?.commit === commit) {
    return pass('version', `GET /version on ownpace-selfhost:${bare(version)} answers ${answer.version} and ${short(commit)}`);
  }
  return refuse('version', `GET /version answered ${JSON.stringify(answer)}, not ${bare(version)} and ${short(commit)}`);
}

// ---------------------------------------------------------------------------
// The network, the registry and the tools
// ---------------------------------------------------------------------------

const INDEX = 'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json';
const MANIFEST = 'application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json';

async function fetchOk(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ownpace-release', ...headers }, signal: globalThis.AbortSignal.timeout(120_000) });
  return res;
}

/** One image's registry: manifests by tag or digest, and blobs. */
async function registryOf(image) {
  const name = `robbes/ownpace-${image}`;
  const token = (await (await fetchOk(`https://ghcr.io/token?scope=repository:${name}:pull&service=ghcr.io`)).json()).token;
  const auth = { Authorization: `Bearer ${token}` };
  return {
    async manifest(ref) {
      const res = await fetchOk(`https://ghcr.io/v2/${name}/manifests/${ref}`, { ...auth, Accept: `${INDEX},${MANIFEST}` });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`ghcr answered ${res.status} for ${name}:${ref}`);
      return { json: await res.json(), digest: res.headers.get('docker-content-digest') };
    },
    async blob(digest) {
      const res = await fetchOk(`https://ghcr.io/v2/${name}/blobs/${digest}`, auth);
      if (!res.ok) throw new Error(`ghcr answered ${res.status} for a blob of ${name}`);
      return res.json();
    },
  };
}

const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000, ...options });

/** Every file under a directory, relative to it. */
function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, base) : [path.slice(base.length + 1)];
  });
}

/** A file's text at a commit, through the contents API; null when the commit has no such file. */
function atCommit(client, commit) {
  return async (path) => {
    const file = await client.get(`contents/${path}?ref=${commit}`, { allow404: true });
    if (file === null) return null;
    if (file?.encoding !== 'base64') throw new Error(`the API gave ${path} at ${short(commit)} as ${file?.encoding ?? 'nothing'}, not base64`);
    return Buffer.from(file.content, 'base64').toString('utf8');
  };
}

/** The `zip-node` line: the zip's node.exe against the sum the tagged commit pins. */
async function runtimeLine(hashOf, readAt) {
  try {
    const packager = await readAt('scripts/package-appliance.mjs');
    if (packager === null) throw new Error('the tagged commit has no scripts/package-appliance.mjs');
    if (!RUNTIME_PINS.test(packager)) return checkRuntime(hashOf('node.exe'), null, null);
    const nodeVersion = nodeRuntimeVersion((await readAt('apps/selfhost/Dockerfile')) ?? '');
    return checkRuntime(hashOf('node.exe'), pinnedRuntimeIn(packager, nodeVersion, 'win-x64'), nodeVersion);
  } catch (err) {
    return refuse('zip-node', `the sum the tagged commit pins for node.exe could not be read: ${String(err?.message ?? err).split('\n')[0]}`);
  }
}

async function checkAssets(release, version, readAt) {
  const lines = [];
  const asset = (name) => (release?.assets ?? []).find((a) => a.name === name && a.state === 'uploaded');
  const bom = asset('bom.json');
  if (bom) {
    const res = await fetchOk(bom.browser_download_url);
    lines.push(checkBom(res.ok ? await res.json() : null, version));
  }
  const zip = asset(zipName(version));
  if (zip) {
    const dir = mkdtempSync(join(tmpdir(), 'release-zip-'));
    try {
      const res = await fetchOk(zip.browser_download_url);
      writeFileSync(join(dir, 'payload.zip'), Buffer.from(await res.arrayBuffer()));
      run('unzip', ['-q', join(dir, 'payload.zip'), '-d', join(dir, 'out')]);
      const sums = walk(join(dir, 'out')).find((f) => f.endsWith('SHA256SUMS.txt'));
      if (!sums) {
        lines.push(refuse('zip-sums', `${zipName(version)} holds no SHA256SUMS.txt`));
      } else {
        const root = join(dir, 'out', dirname(sums));
        const hashOf = (file) =>
          existsSync(join(root, file)) ? createHash('sha256').update(readFileSync(join(root, file))).digest('hex') : null;
        lines.push(verifySums(readFileSync(join(dir, 'out', sums), 'utf8'), hashOf));
        lines.push(await runtimeLine(hashOf, readAt));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return lines;
}

/** The tasks' base the tagged commit pins: index, platforms, revision, ancestry and signature. */
async function checkTaskBase({ commit, readAt, client }) {
  let pin;
  try {
    pin = taskBasePinIn(await readAt(TASK_BASE_CONFIG));
  } catch (err) {
    return [refuse('task-base', `the tasks' base the tagged commit pins could not be read: ${String(err?.message ?? err).split('\n')[0]}`)];
  }
  if (pin === null) {
    return [note('task-base', "the tagged commit's trigger.config.ts pins no task base (TASK_BASE_IMAGE came on 2026-11-06): its tasks build on apps/api/Dockerfile's FROM image")];
  }
  const lines = [];
  try {
    const reg = await registryOf(TASK_BASE_IMAGE);
    const index = await reg.manifest(pin.digest);
    if (!index) return [refuse('task-base', `ownpace-task-base@${short(pin.digest)}, which the tagged commit pins, is not on ghcr`)];
    lines.push(checkTaskBaseIndex(index.json, pin));
    const amd64 = (index.json.manifests ?? []).find((m) => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64');
    const manifest = amd64 ? await reg.manifest(amd64.digest) : null;
    const revision = taskBaseRevision(manifest?.json?.config?.digest ? await reg.blob(manifest.json.config.digest) : null, pin);
    if (revision === null) {
      lines.push(refuse('task-base-revision', `the tasks' base carries no revision label that starts with ${pin.commit}, the commit its tag ${pin.tag} names`));
    } else {
      lines.push(checkTaskBaseAncestry(await client.get(`compare/${revision}...${commit}?per_page=1`), { revision, commit }));
    }
  } catch (err) {
    lines.push(refuse('task-base', `ownpace-task-base@${short(pin.digest)} could not be read: ${String(err?.message ?? err).split('\n')[0]}`));
  }
  try {
    run('cosign', taskBaseCosignCall(pin.digest));
    lines.push(pass('signature-task-base', 'cosign verify passes with the exact identity of images.yml on refs/heads/main'));
  } catch (err) {
    const said = String(err?.stderr ?? err?.message ?? err).trim().split('\n').pop();
    lines.push(refuse('signature-task-base', `cosign verify fails with the exact identity of images.yml on refs/heads/main: ${said}`));
  }
  return lines;
}

async function checkImages({ version, commit }) {
  const lines = [];
  const tag = bare(version);
  const digests = {};
  for (const image of IMAGES) {
    try {
      lines.push(...(await checkImage({ image, tag, version, commit, digests })));
    } catch (err) {
      lines.push(refuse(`image-${image}`, `ownpace-${image}:${tag} could not be read: ${String(err?.message ?? err).split('\n')[0]}`));
    }
  }
  return { lines, digests };
}

async function checkImage({ image, tag, version, commit, digests }) {
  const lines = [];
  const reg = await registryOf(image);
  const index = await reg.manifest(tag);
  if (!index) return [refuse(`image-${image}`, `ownpace-${image}:${tag} is not on ghcr`)];
  digests[image] = index.digest;
  lines.push(checkIndex(index.json, { image, tag }));
  const amd64 = (index.json.manifests ?? []).find((m) => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64');
  try {
    const manifest = amd64 ? await reg.manifest(amd64.digest) : null;
    lines.push(checkRevision(manifest?.json?.config?.digest ? await reg.blob(manifest.json.config.digest) : null, { image, commit }));
  } catch (err) {
    lines.push(refuse(`revision-${image}`, `the image's configuration could not be read: ${String(err?.message ?? err).split('\n')[0]}`));
  }
  const sha = await reg.manifest(`sha-${commit.slice(0, 7)}`);
  lines.push(
    sha?.digest === index.digest
      ? pass(`sha-tag-${image}`, `ownpace-${image}:sha-${commit.slice(0, 7)} is the same index`)
      : refuse(`sha-tag-${image}`, `ownpace-${image}:sha-${commit.slice(0, 7)} is ${sha ? 'another index' : 'missing'}`),
  );
  const latest = await reg.manifest('latest');
  lines.push(latestWithheld({ image, version, versionDigest: index.digest, latestDigest: latest?.digest ?? null }));
  for (const args of cosignCalls({ image, digest: index.digest, version })) {
    const how = args.includes('--certificate-identity') ? 'the exact identity of images.yml at the tag' : 'the documented regexp';
    try {
      run('cosign', args);
      lines.push(pass(`signature-${image}`, `cosign verify passes with ${how}`));
    } catch (err) {
      const said = String(err?.stderr ?? err?.message ?? err).trim().split('\n').pop();
      lines.push(refuse(`signature-${image}`, `cosign verify fails with ${how}: ${said}`));
    }
  }
  return lines;
}

/**
 * The appliance image's Node, by its path, newest first. The image is
 * distroless from 0.2.0-alpha.5 on, with Node at `/nodejs/bin/node`, off the
 * PATH, and no shell (workplan 0119 §3 item 12), so a bare `node` finds
 * nothing there; the Node image before it has `/usr/local/bin/node`. Each is
 * tried, so a release before alpha.5 is still asked.
 */
export const APPLIANCE_NODES = ['/nodejs/bin/node', '/usr/local/bin/node'];

/** The `docker exec` that asks the appliance's own `GET /version` from inside it, with the Node at `node`. */
export function versionExec(name, node) {
  const ask = "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/version').then(r=>r.text()).then(t=>console.log(t)).catch(()=>process.exit(1))";
  return ['exec', name, node, '-e', ask];
}

async function checkVersion({ version, commit }) {
  const name = `release-version-${process.env.GITHUB_RUN_ID ?? process.pid}`;
  const image = `${REGISTRY}/ownpace-selfhost:${bare(version)}`;
  try {
    run('docker', ['run', '-d', '--rm', '--name', name, '-e', 'SELFHOST_PERSISTENCE=pglite', '-e', 'SELFHOST_PGLITE_DIR=/data/state/pglite', image], {
      timeout: 600_000,
    });
    let last = null;
    for (let i = 0; i < 24 && last === null; i += 1) {
      await delay(5_000);
      for (const node of APPLIANCE_NODES) {
        try {
          last = JSON.parse(run('docker', versionExec(name, node)).trim());
          break;
        } catch {
          last = null;
        }
      }
    }
    return versionAnswer(last, { version, commit });
  } catch (err) {
    return refuse('version', `the selfhost image did not start to answer /version: ${String(err?.message ?? err).split('\n')[0]}`);
  } finally {
    try {
      run('docker', ['rm', '-f', name]);
    } catch {
      // Already gone: `--rm` removed it when it stopped.
    }
  }
}

async function main() {
  const { VERSION: version, COMMIT: commit } = process.env;
  if (!version || !/^[0-9a-f]{40}$/.test(commit ?? '')) {
    report([refuse('verify', 'VERSION and a full COMMIT are needed')]);
    return 1;
  }
  const client = github();
  const release = await client.get(`releases/tags/${encodeURIComponent(version)}`, { allow404: true });
  const lines = [...checkRelease(release, version), ...(await checkAssets(release, version, atCommit(client, commit)))];
  const images = await checkImages({ version, commit });
  lines.push(...images.lines);
  lines.push(...(await checkTaskBase({ commit, readAt: atCommit(client, commit), client })));
  lines.push(await checkVersion({ version, commit }));
  lines.push(note('next', 'still the owner’s: prose in the release body if the pointers need it, the announcement, and docs/release.md §5'));
  report(lines);
  return lines.some((l) => l.kind === 'refuse') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => (process.exitCode = code),
    (err) => {
      console.log(`refuse verify: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    },
  );
}

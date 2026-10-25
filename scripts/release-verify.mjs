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
 * - **The zip:** its own `SHA256SUMS.txt` holds for every file it names.
 * - **The images** `ghcr.io/robbes/ownpace-{api,web,selfhost}` at `X.Y.Z`:
 *   an index with linux/amd64 and linux/arm64, its revision label the
 *   commit, `sha-<commit>` the same index, `latest` withheld from a
 *   pre-release and given to a release. Read from the registry's own API
 *   with an anonymous pull token.
 * - **The signatures:** `cosign verify` by digest, first with the exact
 *   identity of `images.yml` at the tag and GitHub's issuer, then with the
 *   regexp `docs/release.md` documents, so the command a reader copies is
 *   proven too.
 * - **`GET /version`** on the selfhost image started on PGlite in a
 *   container this job removes: the version and the commit.
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

async function checkAssets(release, version) {
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
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

async function checkVersion({ version, commit }) {
  const name = `release-version-${process.env.GITHUB_RUN_ID ?? process.pid}`;
  const image = `${REGISTRY}/ownpace-selfhost:${bare(version)}`;
  try {
    run('docker', ['run', '-d', '--rm', '--name', name, '-e', 'SELFHOST_PERSISTENCE=pglite', '-e', 'SELFHOST_PGLITE_DIR=/data/state/pglite', image], {
      timeout: 600_000,
    });
    const ask = "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/version').then(r=>r.text()).then(t=>console.log(t)).catch(()=>process.exit(1))";
    let last = null;
    for (let i = 0; i < 24; i += 1) {
      await delay(5_000);
      try {
        last = JSON.parse(run('docker', ['exec', name, 'node', '-e', ask]).trim());
        break;
      } catch {
        last = null;
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
  const lines = [...checkRelease(release, version), ...(await checkAssets(release, version))];
  const images = await checkImages({ version, commit });
  lines.push(...images.lines);
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

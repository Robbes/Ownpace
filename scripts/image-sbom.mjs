#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY PUBLISHED IMAGE CARRIES ITS OWN SBOM, AND THE RELEASE CARRIES A COPY
 * (SBOM-1, the image half: the owner's decision of 2026-11-24, for alpha.20,
 * after an outside, read-only check compared the release's `bom.json` with a
 * list of its own).
 *
 * `bom.json` is made from the lockfile, so it lists the npm packages and
 * nothing the images were built on: not the Debian packages of the distroless
 * runtime under api, worker and selfhost, nor the Alpine packages of nginx
 * under web. `images.yml` now builds each published image with a BuildKit SBOM
 * attestation (`sbom:` on both build-push-action steps, its generator pinned by
 * digest), which scans the image's final filesystem: OS packages and the npm
 * packages installed in it. This module is the two ends of that:
 *
 * - **`extract`**, in `images.yml` on every publish: reads what
 *   `docker buildx imagetools inspect <image>@<index digest> --format
 *   '{{ json .SBOM }}'` printed (one SPDX document per platform, read from the
 *   registry, not from the build), refuses an index with no SBOM for a
 *   platform, an SBOM that lists nothing, or one that lists no OS package, and
 *   writes one file per platform, named after the image, the version (or
 *   `sha-<commit>` on main) and the platform. The SPDX document's own `name`
 *   is BuildKit's placeholder, `sbom`; it is set to the image by digest and
 *   platform, so the file says what it covers wherever it is copied to, and
 *   a one-line `comment` says the same. Nothing else in the document is changed.
 * - **`expect`**, in `images.yml`'s attach job on a tag: the files every
 *   build leg read back are exactly the set the release carries
 *   (`imageSbomFiles` in `release-verify.mjs`), each an SBOM, before any is
 *   attached.
 * - **`checkImageSbom`**, in `release-verify.mjs`: each file on the release is
 *   SPDX, names the index the version tag resolves to now, and lists OS
 *   packages.
 *
 * What it cannot see: the JavaScript bundled into a file (the web build's
 * assets, the appliance's esbuild bundle) is not a package on the image's
 * filesystem, so a scanner reading the filesystem does not find it.
 * `bom.json`, from the lockfile, does.
 *
 * Held by `scripts/an-image-that-carries-no-list-of-itself.unit.test.ts`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pass, refuse } from './release-github.mjs';

/** Where the published images live, lowercase as ghcr requires (images.yml's raw refs). */
export const SBOM_REGISTRY = 'ghcr.io/robbes';
/** The platforms every published image is built for (images.yml, SAD §22). */
export const SBOM_PLATFORMS = ['linux/amd64', 'linux/arm64'];
/** The first release whose images carry an SBOM, and whose release carries their files. */
export const FIRST_IMAGE_SBOM_RELEASE = '0.2.0-alpha.20';
/** The purl types of operating-system packages: Debian's and Alpine's. */
export const OS_PURL_TYPES = ['deb', 'apk'];

/** The file one image's SBOM for one platform is published as: `ownpace-api-0.2.0-alpha.20.linux-amd64.spdx.json`. */
export function sbomFileName(image, label, platform) {
  return `ownpace-${image}-${label}.${platform.replace(/\//g, '-')}.spdx.json`;
}

/** What the document is named after: the image by its index digest, and the platform. */
export function sbomDocumentName(image, digest, platform) {
  return `${SBOM_REGISTRY}/ownpace-${image}@${digest} ${platform}`;
}

/** A package's purl type (`deb`, `apk`, `npm`, …), or null when it carries no purl. */
function purlType(pkg) {
  const ref = (pkg?.externalRefs ?? []).find((r) => r?.referenceType === 'purl');
  const m = /^pkg:([a-z0-9.+-]+)\//i.exec(ref?.referenceLocator ?? '');
  return m ? m[1].toLowerCase() : null;
}

/** How many packages of each purl type a document lists, those without one under `none`. */
export function packageCounts(doc) {
  const counts = {};
  for (const pkg of doc?.packages ?? []) {
    if (pkg?.SPDXID === 'SPDXRef-DocumentRoot') continue;
    const type = purlType(pkg) ?? 'none';
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

/** The operating-system packages a document lists, as `name version`. */
export function osPackages(doc) {
  return (doc?.packages ?? []).filter((p) => OS_PURL_TYPES.includes(purlType(p) ?? '')).map((p) => `${p.name} ${p.versionInfo ?? ''}`.trim());
}

/** "deb 113, npm 144" */
export const describeCounts = (counts) =>
  Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, n]) => `${type} ${n}`)
    .join(', ');

/** Why one platform's document is not an SBOM of the image, or null when it is. */
export function sbomFault(doc) {
  if (!doc || typeof doc !== 'object') return 'there is no SPDX document';
  if (!/^SPDX-2\.\d+$/.test(String(doc.spdxVersion ?? ''))) return `it is not an SPDX 2 document (spdxVersion ${JSON.stringify(doc.spdxVersion ?? null)})`;
  const counts = packageCounts(doc);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return 'it lists no package';
  if (osPackages(doc).length === 0) return `it lists no operating-system package (${OS_PURL_TYPES.join(' or ')}), only ${describeCounts(counts)}`;
  return null;
}

/**
 * The files for one image, from what `imagetools inspect --format '{{ json .SBOM }}'`
 * printed for its index: `[{ file, platform, doc, counts }]`, one per platform.
 * Throws with every platform's fault at once.
 */
export function splitImageSbom(inspected, { image, digest, label }) {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? '')) throw new Error(`ownpace-${image}: ${JSON.stringify(digest)} is not an index digest`);
  if (!label) throw new Error(`ownpace-${image}: no version or sha-<commit> to name its files by`);
  const faults = [];
  const out = [];
  for (const platform of SBOM_PLATFORMS) {
    const doc = inspected?.[platform]?.SPDX;
    const fault = doc ? sbomFault(doc) : 'the index carries no SBOM attestation for it';
    if (fault) {
      faults.push(`${platform}: ${fault}`);
      continue;
    }
    const named = {
      ...doc,
      name: sbomDocumentName(image, digest, platform),
      comment: `BuildKit's SBOM attestation of ${SBOM_REGISTRY}/ownpace-${image}@${digest} for ${platform}, read from the registry by digest by images.yml.`,
    };
    out.push({ file: sbomFileName(image, label, platform), platform, doc: named, counts: packageCounts(doc) });
  }
  if (faults.length > 0) throw new Error(`${SBOM_REGISTRY}/ownpace-${image}@${digest} has no usable SBOM: ${faults.join('; ')}`);
  return out;
}

/** One file on the release, as release-verify reads it: SPDX, named after the index the version tag resolves to now, and listing OS packages. */
export function checkImageSbom(doc, { image, digest, platform, file }) {
  const check = `image-sbom-${image}`;
  if (!doc) return refuse(check, `${file} is not JSON`);
  const fault = sbomFault(doc);
  if (fault) return refuse(check, `${file} is not an SBOM of the image: ${fault}`);
  const want = sbomDocumentName(image, digest, platform);
  if (doc.name !== want) {
    return refuse(check, `${file} is named ${JSON.stringify(doc.name ?? null)}, not ${JSON.stringify(want)}: it is not the SBOM of the index the version tag names`);
  }
  return pass(check, `${file}: ${doc.spdxVersion} of ${platform}, ${describeCounts(packageCounts(doc))}`);
}

function argsOf(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`unexpected argument ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

/**
 * Why the files in a directory are not the set a release at `version` must
 * carry (`expected`, from release-verify's imageSbomFiles), or [] when they
 * are: each expected file present and an SBOM of its image, and no other.
 */
export function setFaults(expected, present, read) {
  const faults = [];
  const names = new Set(expected.map((e) => e.file));
  for (const { file } of expected) {
    if (!present.includes(file)) {
      faults.push(`${file} is missing`);
      continue;
    }
    let doc;
    try {
      doc = JSON.parse(read(file));
    } catch {
      faults.push(`${file} is not JSON`);
      continue;
    }
    const fault = sbomFault(doc);
    if (fault) faults.push(`${file}: ${fault}`);
  }
  for (const file of present) if (!names.has(file)) faults.push(`${file} is not a file this release carries`);
  return faults;
}

/**
 * `extract --image api --digest sha256:… --label 0.2.0-alpha.20 --from inspected.json --out dir`
 * `expect --version v0.2.0-alpha.20 --dir dir`
 */
async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'expect') {
    const { version, dir } = argsOf(rest);
    if (!version || !dir) throw new Error('expect needs --version and --dir');
    // Imported here, not at the top: release-verify.mjs imports this module.
    const { imageSbomFiles } = await import('./release-verify.mjs');
    const expected = imageSbomFiles(version);
    const present = existsSync(dir) ? readdirSync(dir).sort() : [];
    const faults = setFaults(expected, present, (file) => readFileSync(join(dir, file), 'utf8'));
    if (faults.length > 0) throw new Error(`the images' SBOMs for ${version} are not the set the release carries, so none is attached: ${faults.join('; ')}`);
    console.log(`${expected.length} SBOMs for ${version}: ${expected.map((e) => e.file).join(', ')}`);
    return;
  }
  if (command !== 'extract') {
    throw new Error('usage: image-sbom.mjs extract --image <name> --digest <index digest> --label <version or sha-commit> --from <inspect output> --out <dir> | expect --version <tag> --dir <dir>');
  }
  const { image, digest, label, from, out } = argsOf(rest);
  if (!image || !from || !out) throw new Error('extract needs --image, --digest, --label, --from and --out');
  const text = readFileSync(from, 'utf8');
  let inspected;
  try {
    inspected = JSON.parse(text);
  } catch {
    throw new Error(`${from} is not JSON (${text.length} bytes): imagetools printed no SBOM`);
  }
  const files = splitImageSbom(inspected, { image, digest, label });
  mkdirSync(out, { recursive: true });
  for (const { file, platform, doc, counts } of files) {
    writeFileSync(join(out, file), `${JSON.stringify(doc)}\n`);
    const os = osPackages(doc);
    console.log(`${file}: ${platform}, ${describeCounts(counts)}; OS packages such as ${os.slice(0, 5).join(', ')}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.log(`::error::${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}

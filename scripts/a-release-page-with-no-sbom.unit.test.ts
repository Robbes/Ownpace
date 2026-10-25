// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RELEASE PAGE WITH NO SBOM: neither release this repository has published is complete, and nothing said so (workplan 0146, Status of 2026-10-23).
 *
 * ## What the record says
 *
 * - `v0.1.0-rc.1`'s release has `bom.json` and no body and no Windows zip.
 * - `v0.2.0-alpha.1`'s has the zip and no body and no `bom.json`: its tag's
 *   Security Scan (run 37523297841) failed at the advisory gate, and the body
 *   and the SBOM come after it. `docs/release.md` §3 asked a person to check
 *   each of these by eye, and §4 asked for `GET /version` on a pulled image.
 *
 * ## What `scripts/release-verify.mjs` checks, for any tag (`mode=verify`)
 *
 * - **The release:** it exists and is not a draft; it is a pre-release
 *   exactly when the version has a hyphen; its body holds exactly ONE block
 *   Security Scan generated, counted by its `cosign verify` line, so a scan
 *   re-run on a release that already had its body (the half-published state
 *   `docs/release.md` describes) shows as two; it links the changelog at the
 *   tag; and `bom.json` and `ownpace-appliance-win-x64-<tag>.zip` are both
 *   uploaded and not empty.
 * - **The SBOM** is CycloneDX and names the version.
 * - **The zip's own `SHA256SUMS.txt`** holds for every file it names.
 * - **The images:** each of `ownpace-{api,web,selfhost}` at `X.Y.Z` is an
 *   index with `linux/amd64` and `linux/arm64`, whose revision label is the
 *   commit; `sha-<commit>` is the same index; `latest` is withheld from a
 *   pre-release and is this index for a release.
 * - **The signatures:** `cosign verify` by digest with the exact identity
 *   `https://github.com/Robbes/Ownpace/.github/workflows/images.yml@refs/tags/<tag>`
 *   and GitHub's issuer, and again with the regexp `docs/release.md`
 *   documents, so the command a reader copies is proven too.
 * - **`GET /version`** on the selfhost image, started on PGlite: the version
 *   and the commit.
 *
 * ## What this test holds
 *
 * The parsers, against both real releases (each refuses, for its own
 * reasons), the real index of `ownpace-selfhost:0.2.0-alpha.1`, and a complete
 * release whose body is built from `security-scan.yml`'s own template, so the
 * count of generated blocks is tied to what the workflow writes.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  IMAGES,
  ISSUER,
  IDENTITY_REGEXP,
  zipName,
  generatedBlocks,
  checkRelease,
  checkBom,
  verifySums,
  checkIndex,
  checkRevision,
  latestWithheld,
  cosignCalls,
  versionAnswer,
} from './release-verify.mjs';
import type { Release } from './release-verify.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const fixture = <T>(name: string): T => JSON.parse(read(`scripts/fixtures/release/${name}`)) as T;

const V = 'v0.2.0-alpha.2';
const C = '721c6ea82bf0214e2d132c37e84d8da2d43247bc';
const refusedChecks = (lines: Array<{ kind: string; check: string }>) =>
  lines.filter((l) => l.kind === 'refuse').map((l) => l.check);

/**
 * The body security-scan.yml writes for a tag: its own step, run by bash as
 * the workflow runs it, so the heredoc's escapes and line continuations come
 * out as they do on the release page.
 */
function generatedBody(tag: string): string {
  type Step = { name?: string; run?: string };
  const workflow = parse(read('.github/workflows/security-scan.yml')) as { jobs: Record<string, { steps: Step[] }> };
  const step = workflow.jobs['security-scan']!.steps.find((s) => s.name === 'Compose release body');
  const dir = mkdtempSync(join(tmpdir(), 'release-body-'));
  try {
    execFileSync('bash', ['-c', step!.run!], { cwd: dir, env: { PATH: process.env.PATH ?? '', GITHUB_REF_NAME: tag } });
    return readFileSync(join(dir, 'release-body.md'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const complete = (over: Partial<Release> = {}): Release => ({
  tag_name: V,
  name: V,
  draft: false,
  prerelease: true,
  body: generatedBody(V),
  assets: [
    { name: 'bom.json', size: 2_000_000, state: 'uploaded', browser_download_url: 'https://example.invalid/bom.json' },
    { name: zipName(V), size: 45_000_000, state: 'uploaded', browser_download_url: 'https://example.invalid/zip' },
  ],
  ...over,
});

describe('the two releases this repository has published', () => {
  it('alpha.1 refuses: no generated body, no bom.json (its tag’s scan failed at the advisory gate)', () => {
    const release = fixture<Release>('release-v0.2.0-alpha.1.json');
    const lines = checkRelease(release, 'v0.2.0-alpha.1');
    expect(refusedChecks(lines).sort()).toEqual(['release-assets', 'release-body']);
    expect(lines.find((l) => l.check === 'release-assets')!.sentence).toMatch(/bom\.json is not attached/);
  });

  it('rc.1 refuses: no generated body, no Windows zip', () => {
    const release = fixture<Release>('release-v0.1.0-rc.1.json');
    const lines = checkRelease(release, 'v0.1.0-rc.1');
    expect(refusedChecks(lines).sort()).toEqual(['release-assets', 'release-body']);
    expect(lines.find((l) => l.check === 'release-assets')!.sentence).toMatch(/ownpace-appliance-win-x64-v0\.1\.0-rc\.1\.zip is not attached/);
  });
});

describe('a complete release', () => {
  it('passes, with its body exactly as security-scan.yml writes it', () => {
    expect(generatedBlocks(generatedBody(V), V)).toBe(1);
    expect(refusedChecks(checkRelease(complete(), V))).toEqual([]);
  });

  it('keeps passing with prose written above the generated block', () => {
    expect(refusedChecks(checkRelease(complete({ body: `What this alpha is for.\n\n${generatedBody(V)}` }), V))).toEqual([]);
  });

  it('refuses two generated blocks: a scan re-run on a release that had its body', () => {
    const twice = complete({ body: `${generatedBody(V)}\n${generatedBody(V)}` });
    const lines = checkRelease(twice, V);
    expect(refusedChecks(lines)).toEqual(['release-body']);
    expect(lines.find((l) => l.check === 'release-body')!.sentence).toMatch(/2 generated blocks/);
  });

  it('refuses a draft, a wrong pre-release flag, and an asset that never finished uploading', () => {
    expect(refusedChecks(checkRelease(complete({ draft: true }), V))).toContain('release-exists');
    expect(refusedChecks(checkRelease(complete({ prerelease: false }), V))).toContain('release-prerelease');
    const stuck = complete();
    stuck.assets[0] = { ...stuck.assets[0]!, state: 'starter' };
    expect(refusedChecks(checkRelease(stuck, V))).toContain('release-assets');
    expect(refusedChecks(checkRelease(null, V))).toEqual(['release-exists']);
  });
});

describe('the SBOM and the zip', () => {
  it('a CycloneDX SBOM naming the version passes; another version or format refuses', () => {
    const bom = { bomFormat: 'CycloneDX', specVersion: '1.6', metadata: { component: { version: '0.2.0-alpha.2' } } };
    expect(checkBom(bom, V).kind).toBe('pass');
    expect(checkBom({ ...bom, metadata: { component: { version: '0.2.0-alpha.1' } } }, V).kind).toBe('refuse');
    expect(checkBom({ ...bom, bomFormat: 'SPDX' }, V).kind).toBe('refuse');
    expect(checkBom(null, V).kind).toBe('refuse');
  });

  it('every file SHA256SUMS.txt names hashes as it says, and an empty list proves nothing', () => {
    const hashes: Record<string, string> = { 'start.mjs': 'a'.repeat(64), 'ui/index.html': 'b'.repeat(64) };
    const sums = `${'a'.repeat(64)}  start.mjs\n${'b'.repeat(64)}  ui/index.html\n`;
    expect(verifySums(sums, (f) => hashes[f] ?? null).kind).toBe('pass');
    expect(verifySums(sums.replace('b'.repeat(64), 'c'.repeat(64)), (f) => hashes[f] ?? null).kind).toBe('refuse');
    expect(verifySums(sums, (f) => (f === 'start.mjs' ? hashes[f]! : null)).sentence).toMatch(/ui\/index\.html is missing/);
    expect(verifySums('', () => null).kind).toBe('refuse');
  });

  it('names the zip as windows-payload.yml does', () => {
    expect(zipName('v0.2.0-alpha.1')).toBe('ownpace-appliance-win-x64-v0.2.0-alpha.1.zip');
  });
});

describe('the images', () => {
  const index = fixture<{ manifests: Array<{ platform: { os: string; architecture: string } }> }>(
    'ghcr-ownpace-selfhost-0.2.0-alpha.1-index.json',
  );

  it('checks all three', () => {
    expect(IMAGES).toEqual(['api', 'web', 'selfhost']);
  });

  it('passes ownpace-selfhost:0.2.0-alpha.1 as published, both architectures', () => {
    expect(checkIndex(index, { image: 'selfhost', tag: '0.2.0-alpha.1' }).kind).toBe('pass');
  });

  it('refuses an index missing an architecture, and a single manifest', () => {
    const amd64Only = { ...index, manifests: index.manifests.filter((m) => m.platform.architecture !== 'arm64') };
    expect(checkIndex(amd64Only, { image: 'selfhost', tag: '0.2.0-alpha.1' }).sentence).toMatch(/linux\/arm64/);
    expect(checkIndex({ schemaVersion: 2, config: {} }, { image: 'selfhost', tag: '0.2.0-alpha.1' }).kind).toBe('refuse');
  });

  it('wants the commit in the revision label', () => {
    const config = { config: { Labels: { 'org.opencontainers.image.revision': C } } };
    expect(checkRevision(config, { image: 'api', commit: C }).kind).toBe('pass');
    expect(checkRevision({ config: { Labels: {} } }, { image: 'api', commit: C }).kind).toBe('refuse');
  });

  it('withholds latest from a pre-release, and gives it to a release', () => {
    const d = 'sha256:' + '1'.repeat(64);
    const e = 'sha256:' + '2'.repeat(64);
    expect(latestWithheld({ image: 'web', version: V, versionDigest: d, latestDigest: null }).kind).toBe('pass');
    expect(latestWithheld({ image: 'web', version: V, versionDigest: d, latestDigest: d }).kind).toBe('refuse');
    expect(latestWithheld({ image: 'web', version: 'v0.2.0', versionDigest: d, latestDigest: d }).kind).toBe('pass');
    expect(latestWithheld({ image: 'web', version: 'v0.2.0', versionDigest: d, latestDigest: e }).kind).toBe('refuse');
  });
});

describe('the signatures', () => {
  const digest = 'sha256:' + '4'.repeat(64);

  it('verifies by digest with the exact identity of images.yml at the tag, and GitHub’s issuer', () => {
    const [exact] = cosignCalls({ image: 'selfhost', digest, version: V });
    expect(exact).toEqual([
      'verify',
      `ghcr.io/robbes/ownpace-selfhost@${digest}`,
      '--certificate-identity',
      `https://github.com/Robbes/Ownpace/.github/workflows/images.yml@refs/tags/${V}`,
      '--certificate-oidc-issuer',
      ISSUER,
    ]);
    expect(ISSUER).toBe('https://token.actions.githubusercontent.com');
  });

  it('verifies again with the regexp docs/release.md documents, so the reader’s command is proven too', () => {
    const [, documented] = cosignCalls({ image: 'selfhost', digest, version: V });
    // Built from a string so that a-signature-checked-under-either-name, which
    // reads every documented flag followed by a quoted pattern, does not read
    // this line as one.
    const flag = new RegExp(`${'--certificate-identity-regexp'}\\s+'([^']+)'`);
    const inDoc = flag.exec(read('docs/release.md'))![1];
    expect(IDENTITY_REGEXP).toBe(inDoc);
    expect(documented).toEqual([
      'verify',
      `ghcr.io/robbes/ownpace-selfhost@${digest}`,
      '--certificate-identity-regexp',
      inDoc,
      '--certificate-oidc-issuer',
      ISSUER,
    ]);
  });
});

describe('/version on the pulled image', () => {
  it('answers the version and the commit', () => {
    expect(versionAnswer({ version: '0.2.0-alpha.2', commit: C }, { version: V, commit: C }).kind).toBe('pass');
    expect(versionAnswer({ version: '0.2.0-alpha.1', commit: C }, { version: V, commit: C }).kind).toBe('refuse');
    expect(versionAnswer({ version: '0.2.0-alpha.2', commit: 'unknown' }, { version: V, commit: C }).kind).toBe('refuse');
    expect(versionAnswer(null, { version: V, commit: C }).kind).toBe('refuse');
  });
});

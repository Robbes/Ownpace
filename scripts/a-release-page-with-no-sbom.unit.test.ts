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
 * - **The zip's own `SHA256SUMS.txt`** holds for every file it names, and
 *   its `node.exe` hashes to the sum the TAGGED COMMIT pins
 *   (`NODE_RUNTIME_SHA256` in `scripts/package-appliance.mjs`, for the Node
 *   `apps/selfhost/Dockerfile` names, both read at the commit), so a zip whose
 *   `node.exe` and `SHA256SUMS.txt` were swapped together after the build is
 *   refused (#1780's review). A tag from before 2026-11-01 gets a note.
 * - **The downloads** of both (2026-11-10). GitHub's release download
 *   answered 504 for minutes on 2026-11-09, and the verify fetched each asset
 *   once: a 504 for `bom.json` was refused as "not a CycloneDX SBOM
 *   (unreadable)", and one for the zip was unpacked as the zip, so the job
 *   died on unzip's exception. Each is now fetched up to five times, 5, 15,
 *   45 and 135 seconds apart, as CI's stalwart-cli and Trivy downloads and
 *   the webapp's goose fetch are (#1850, #1862, #1866), and only for no
 *   answer, a file cut short, a 5xx or a 429; never for a file that is gone
 *   (404, 410), any other answer, or a body its own check refuses.
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
 * - **The tasks' base** the tagged commit's `apps/worker/trigger.config.ts`
 *   pins (workplan 0119 §3 item 13, 2026-11-06): the index at that digest has
 *   both platforms, its revision label starts with the commit its `sha-` tag
 *   names and is an ancestor of the tag's (the compare API's `ahead` or
 *   `identical`), and `cosign verify` passes by digest with the identity of
 *   images.yml on `refs/heads/main`, the only ref that publishes it; a tag
 *   whose config pins none gets a note.
 *
 * ## What this test holds
 *
 * The parsers, against both real releases (each refuses, for its own
 * reasons), the real index of `ownpace-selfhost:0.2.0-alpha.1`, and a complete
 * release whose body is built from `security-scan.yml`'s own template, so the
 * count of generated blocks is tied to what the workflow writes.
 *
 * And the downloads, run over a stand-in for GitHub's release download and a
 * sleep that only records what it is asked to wait: four fetches that fail,
 * one of each kind, are waited out with exactly 5, 15, 45 and 135 seconds,
 * each saying which of the five it was, and the fifth's body is the one
 * judged; five stop at the fifth with a refusal that names the asset and what
 * GitHub answered; a file that is gone, any other answer, and a body that is
 * not JSON or not a zip are fetched once, with no wait.
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
  MAIN_IDENTITY,
  TASK_BASE_IMAGE,
  checkTaskBaseAncestry,
  checkTaskBaseIndex,
  taskBaseCosignCall,
  taskBasePinIn,
  taskBaseRevision,
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
  versionExec,
  APPLIANCE_NODES,
  pinnedRuntimeIn,
  checkRuntime,
  checkAssets,
  downloadAsset,
} from './release-verify.mjs';
import type { Asset, Release } from './release-verify.mjs';
import type { Line } from './release-github.mjs';
import { NODE_RUNTIMES, NODE_RUNTIME_SHA256, nodeRuntimeVersion } from './package-appliance.mjs';

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

  it("holds the zip's node.exe to the sum the tagged commit pins, read from that commit's text", () => {
    const packager = read('scripts/package-appliance.mjs');
    const nodeVersion = nodeRuntimeVersion(read('apps/selfhost/Dockerfile'));
    // The text reader gives what the module exports: a literal reshaped so it cannot read it fails here, not at a tag.
    for (const platform of Object.keys(NODE_RUNTIMES)) {
      expect(pinnedRuntimeIn(packager, nodeVersion, platform)).toBe(NODE_RUNTIME_SHA256[nodeVersion]![platform]);
    }
    const pinned = pinnedRuntimeIn(packager, nodeVersion, 'win-x64')!;
    expect(checkRuntime(pinned, pinned, nodeVersion)).toMatchObject({ kind: 'pass', check: 'zip-node' });
    // A node.exe swapped together with the zip's own list: those sums hold, the pinned one does not.
    expect(checkRuntime('0'.repeat(64), pinned, nodeVersion).sentence).toMatch(/^node\.exe's sha256 is 0{64}, and the tagged commit pins [0-9a-f]{64}/);
    expect(checkRuntime(null, pinned, nodeVersion)).toMatchObject({ kind: 'refuse', check: 'zip-node' });
    // A version the commit pins nothing for throws, which the job reports as a refusal, never a pass.
    expect(() => pinnedRuntimeIn(packager, 'v26.99.0', 'win-x64')).toThrow(/pins no win-x64 sum for Node v26\.99\.0/);
    expect(() => pinnedRuntimeIn(packager, nodeVersion.replaceAll('.', 'x'), 'win-x64')).toThrow(/pins no win-x64 sum/);
    expect(() => pinnedRuntimeIn(packager, nodeVersion, 'win-x86')).toThrow(/pins no win-x86 sum/);
    // A tag from before the sums were committed: a note, never a pass.
    const before = packager.replace(/^export const NODE_RUNTIME_SHA256 = \{$[\s\S]*?^\};$/m, '');
    expect(before).not.toBe(packager);
    expect(pinnedRuntimeIn(before, nodeVersion, 'win-x64')).toBeNull();
    expect(checkRuntime(pinned, null, null).kind).toBe('note');
    // And the job asks it, for the zip it unpacked, with the files read at COMMIT.
    const verify = read('scripts/release-verify.mjs');
    expect(verify).toContain('lines.push(await runtimeLine(hashOf, readAt));');
    expect(verify).toContain('checkAssets(release, version, atCommit(client, commit))');
    expect(verify).toContain('client.get(`contents/${path}?ref=${commit}`, { allow404: true })');
  });

  it('names the zip as windows-payload.yml does', () => {
    expect(zipName('v0.2.0-alpha.1')).toBe('ownpace-appliance-win-x64-v0.2.0-alpha.1.zip');
  });
});

describe("bom.json and the zip, downloaded: a few minutes of GitHub's release download not answering are waited out (2026-11-10)", () => {
  // On 2026-11-09 GitHub's release download answered 504 on and off from 07:37 to 07:50 UTC, and at
  // 06:23; the stalwart-cli, Trivy and goose downloads each failed on it and now fetch again (#1850,
  // #1862, #1866), and this job fetched each asset once.
  const [bom, zip] = complete().assets as [Asset, Asset];
  const BOM = JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', metadata: { component: { version: '0.2.0-alpha.2' } } });
  const only = (asset: Asset): Release => complete({ assets: [asset] });
  const readAt = async (): Promise<string | null> => null;
  const noted = (check: string, sentence: string): Line => ({ kind: 'note', check, sentence });
  const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  type Answer = number | 'no answer' | 'timeout' | 'cut off' | { status: number; retryAfter: string };

  /**
   * GitHub's release download, stood in for: one answer per fetch, in order, and once they are spent
   * `file` itself, as it is served again after an outage. Every fetch, every wait (in seconds) and every
   * line said on the way is recorded; nothing is waited for real.
   */
  function releaseDownload(answers: Answer[], file = BOM) {
    const fetched: string[] = [];
    const slept: number[] = [];
    const said: Line[] = [];
    const fetchImpl = async (url: string): Promise<Response> => {
      fetched.push(url);
      const answer = answers[fetched.length - 1];
      if (answer === undefined) return new Response(file);
      // What Node's fetch throws for no answer at all, and for none within fetchOk's 120 seconds.
      if (answer === 'no answer') throw Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND github.com') });
      if (answer === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      // A 200 whose connection closes before the end of the file, as undici reports it.
      if (answer === 'cut off') {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode(file.slice(0, 10)));
            c.error(Object.assign(new TypeError('terminated'), { cause: new Error('other side closed') }));
          },
        });
        return new Response(body);
      }
      if (typeof answer === 'number') return new Response('stand-in', { status: answer });
      return new Response('stand-in', { status: answer.status, headers: { 'Retry-After': answer.retryAfter } });
    };
    const sleep = async (ms: number) => {
      slept.push(ms / 1000);
    };
    return { fetched, slept, said, seams: { fetchImpl, sleep, say: (l: Line) => void said.push(l) } };
  }

  it('waits out four fetches that failed, one of each kind, 5, 15, 45 and 135 seconds apart, each saying which of the five it was, and judges the fifth body', async () => {
    const gh = releaseDownload(['no answer', 504, 'timeout', 'cut off']);
    const got = await downloadAsset(bom, 'sbom', gh.seams);
    expect(got.body?.toString('utf8')).toBe(BOM);
    expect(gh.fetched).toEqual(Array(5).fill(bom.browser_download_url));
    expect(gh.slept).toEqual([5, 15, 45, 135]);
    expect(gh.said).toEqual([
      noted('sbom', 'bom.json: GitHub did not answer (getaddrinfo ENOTFOUND github.com) at fetch 1 of 5; it is fetched again in 5 seconds'),
      noted('sbom', 'bom.json: GitHub answered HTTP 504 at fetch 2 of 5; it is fetched again in 15 seconds'),
      noted('sbom', 'bom.json: GitHub did not answer within 120 seconds at fetch 3 of 5; it is fetched again in 45 seconds'),
      noted('sbom', 'bom.json: GitHub answered HTTP 200 and stopped before the end of the file (other side closed) at fetch 4 of 5; it is fetched again in 135 seconds'),
    ]);
    // The job's own path: the SBOM the fifth fetch brought is judged as a first fetch's is.
    const job = releaseDownload([503, 504, 503, 504]);
    expect(await checkAssets(only(bom), V, readAt, job.seams)).toEqual([checkBom(JSON.parse(BOM), V)]);
    expect(job.slept).toEqual([5, 15, 45, 135]);
  });

  it('stops at the fifth fetch that failed, and refuses a download that failed as one, naming the asset and what GitHub answered', async () => {
    const gh = releaseDownload([504, 504, 504, 504, 504]);
    const lines = await checkAssets(only(bom), V, readAt, gh.seams);
    expect(gh.fetched).toHaveLength(5);
    expect(gh.slept).toEqual([5, 15, 45, 135]);
    expect(lines).toEqual([
      {
        kind: 'refuse',
        check: 'sbom',
        sentence:
          "bom.json could not be downloaded: GitHub answered HTTP 504 at each of 5 fetches, 5, 15, 45 and 135 seconds apart. This is not a verdict on bom.json, which was never read: run verify on the tag again once GitHub's release download answers",
      },
    ]);
    expect(gh.said.map((l) => l.sentence)).toEqual([
      'bom.json: GitHub answered HTTP 504 at fetch 1 of 5; it is fetched again in 5 seconds',
      'bom.json: GitHub answered HTTP 504 at fetch 2 of 5; it is fetched again in 15 seconds',
      'bom.json: GitHub answered HTTP 504 at fetch 3 of 5; it is fetched again in 45 seconds',
      'bom.json: GitHub answered HTTP 504 at fetch 4 of 5; it is fetched again in 135 seconds',
      'bom.json: GitHub answered HTTP 504 at fetch 5 of 5; it is not fetched again',
    ]);
    // Answers of different kinds are named fetch by fetch.
    const mixed = releaseDownload([503, 'no answer', 429, 'timeout', 504]);
    expect((await downloadAsset(bom, 'sbom', mixed.seams)).reason).toBe(
      "bom.json could not be downloaded: in 5 fetches, 5, 15, 45 and 135 seconds apart, GitHub answered HTTP 503 at fetch 1, did not answer (getaddrinfo ENOTFOUND github.com) at fetch 2, answered HTTP 429 at fetch 3, did not answer within 120 seconds at fetch 4 and answered HTTP 504 at fetch 5. This is not a verdict on bom.json, which was never read: run verify on the tag again once GitHub's release download answers",
    );
    // The zip alike: a refusal that names it, where unzip's exception ended the job.
    const z = releaseDownload([504, 504, 504, 504, 504]);
    const zipped = await checkAssets(only(zip), V, readAt, z.seams);
    expect(z.fetched).toEqual(Array(5).fill(zip.browser_download_url));
    expect(z.slept).toEqual([5, 15, 45, 135]);
    expect(zipped).toEqual([
      {
        kind: 'refuse',
        check: 'zip-sums',
        sentence: `${zipName(V)} could not be downloaded: GitHub answered HTTP 504 at each of 5 fetches, 5, 15, 45 and 135 seconds apart. This is not a verdict on ${zipName(V)}, which was never read: run verify on the tag again once GitHub's release download answers`,
      },
    ]);
  });

  it('fetches a file that is gone (404, 410) once, with no wait, and says it is gone', async () => {
    for (const [asset, check] of [[bom, 'sbom'], [zip, 'zip-sums']] as const) {
      for (const status of [404, 410]) {
        const gh = releaseDownload([status]);
        expect(await checkAssets(only(asset), V, readAt, gh.seams), `${asset.name}, ${status}`).toEqual([
          {
            kind: 'refuse',
            check,
            sentence: `${asset.name} is gone from its own address: GitHub answered HTTP ${status} for ${asset.browser_download_url}, though the release lists it as uploaded. A file that is gone is not fetched again, and nothing in it was checked`,
          },
        ]);
        expect(gh.fetched).toHaveLength(1);
        expect(gh.slept).toEqual([]);
        expect(gh.said).toEqual([]);
      }
    }
  });

  it('fetches any other answer once, with no wait: a wait does not change a 400, a 401 or a 403', async () => {
    for (const status of [400, 401, 403]) {
      const gh = releaseDownload([status]);
      expect((await downloadAsset(zip, 'zip-sums', gh.seams)).reason).toBe(
        `${zipName(V)} could not be downloaded: GitHub answered HTTP ${status} for ${zip.browser_download_url}, an answer a wait does not change, so it was not fetched again and nothing in it was checked`,
      );
      expect(gh.fetched).toHaveLength(1);
      expect(gh.slept).toEqual([]);
    }
  });

  it('fetches a 200 whose body is not JSON once, and the SBOM check refuses it; a zip that is not a zip, likewise', async () => {
    const page = '<!DOCTYPE html><title>Not the file</title>';
    const gh = releaseDownload([], page);
    expect(await checkAssets(only(bom), V, readAt, gh.seams)).toEqual([
      { kind: 'refuse', check: 'sbom', sentence: 'bom.json is not a CycloneDX SBOM (unreadable)' },
    ]);
    expect(gh.fetched).toHaveLength(1);
    expect(gh.slept).toEqual([]);
    // Unpacked for real: a body unzip cannot open is refused by name, where its exception ended the job.
    const z = releaseDownload([], page);
    expect(await checkAssets(only(zip), V, readAt, z.seams)).toEqual([
      {
        kind: 'refuse',
        check: 'zip-sums',
        sentence: expect.stringMatching(new RegExp(`^${literally(zipName(V))} could not be unpacked \\(.+\\), so nothing in it was checked$`)),
      },
    ]);
    expect(z.fetched).toHaveLength(1);
    expect(z.slept).toEqual([]);
  });

  it('makes a 429 again, as a 5xx, and waits a Retry-After that asks for longer than the wait due, up to 135 seconds', async () => {
    const gh = releaseDownload([{ status: 429, retryAfter: '60' }, { status: 503, retryAfter: '600' }, 429, { status: 503, retryAfter: '1' }]);
    expect((await downloadAsset(bom, 'sbom', gh.seams)).body?.toString('utf8')).toBe(BOM);
    expect(gh.fetched).toHaveLength(5);
    expect(gh.slept).toEqual([60, 135, 45, 135]);
  });

  it('is what the job runs, over fetchOk and its 120 seconds a fetch, with real waits', () => {
    const verify = read('scripts/release-verify.mjs');
    expect(verify).toContain('{ fetchImpl = (url) => fetchOk(url), sleep = (ms) => delay(ms), say = sayNow } = {}');
    expect(verify).toContain("headers: { 'User-Agent': 'ownpace-release', ...headers }, signal: globalThis.AbortSignal.timeout(120_000)");
    expect(verify).toContain('checkAssets(release, version, atCommit(client, commit))');
    // No asset is fetched past the helper, as both were until 2026-11-10.
    expect(verify).not.toMatch(/fetchOk\(\w+\.browser_download_url\)/);
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

describe("the tasks' base the tagged commit pins (0119 §3 item 13)", () => {
  const config = read('apps/worker/trigger.config.ts');
  const pin = taskBasePinIn(config)!;
  const index = fixture<{ manifests: Array<{ platform: { os: string; architecture: string } }> }>('ghcr-ownpace-selfhost-0.2.0-alpha.1-index.json');

  it("reads the pin from the commit's trigger.config.ts with the pin watch's reader, and a tag from before the switch has none", () => {
    expect(pin.ref).toMatch(/^ghcr\.io\/robbes\/ownpace-task-base:sha-[0-9a-f]{7}@sha256:[0-9a-f]{64}$/);
    expect(pin.tag).toBe(`sha-${pin.commit}`);
    expect(taskBasePinIn(null)).toBeNull();
    expect(taskBasePinIn(config.replace(/^const TASK_BASE_IMAGE =[\s\S]*?;$/m, ''))).toBeNull();
    // A line of another shape is a refusal, not a release without a base.
    expect(() => taskBasePinIn(config.replace(pin.ref, pin.ref.replace(/@sha256:.+$/, '')))).toThrow(/not ghcr\.io\/robbes\/ownpace-task-base/);
  });

  it('wants both platforms in the pinned index', () => {
    expect(checkTaskBaseIndex(index, pin).kind).toBe('pass');
    const amd64Only = { ...index, manifests: index.manifests.filter((m) => m.platform.architecture !== 'arm64') };
    expect(checkTaskBaseIndex(amd64Only, pin).sentence).toMatch(/no linux\/arm64/);
    expect(checkTaskBaseIndex({ schemaVersion: 2, config: {} }, pin).kind).toBe('refuse');
  });

  it('wants a revision label that is the commit its tag names, and that commit an ancestor of the tag', () => {
    const full = `${pin.commit}${'a'.repeat(33)}`;
    expect(taskBaseRevision({ config: { Labels: { 'org.opencontainers.image.revision': full } } }, pin)).toBe(full);
    expect(taskBaseRevision({ config: { Labels: { 'org.opencontainers.image.revision': C } } }, pin)).toBeNull();
    expect(taskBaseRevision({ config: { Labels: { 'org.opencontainers.image.revision': pin.commit } } }, pin)).toBeNull();
    expect(taskBaseRevision({ config: { Labels: {} } }, pin)).toBeNull();
    expect(checkTaskBaseAncestry({ status: 'ahead' }, { revision: full, commit: C }).kind).toBe('pass');
    expect(checkTaskBaseAncestry({ status: 'identical' }, { revision: C, commit: C }).kind).toBe('pass');
    for (const status of ['behind', 'diverged', undefined]) {
      expect(checkTaskBaseAncestry({ status }, { revision: full, commit: C }).kind, String(status)).toBe('refuse');
    }
    const verify = read('scripts/release-verify.mjs');
    expect(verify).toContain('client.get(`compare/${revision}...${commit}?per_page=1`)');
    expect(verify).toContain('lines.push(...(await checkTaskBase({ commit, readAt: atCommit(client, commit), client })));');
  });

  it('verifies the signature by digest with the identity of images.yml on main, which alone publishes it', () => {
    expect(TASK_BASE_IMAGE).toBe('task-base');
    expect(MAIN_IDENTITY).toBe('https://github.com/Robbes/Ownpace/.github/workflows/images.yml@refs/heads/main');
    expect(taskBaseCosignCall(pin.digest)).toEqual([
      'verify',
      `ghcr.io/robbes/ownpace-task-base@${pin.digest}`,
      '--certificate-identity',
      MAIN_IDENTITY,
      '--certificate-oidc-issuer',
      ISSUER,
    ]);
    // Never a tag's identity: images.yml builds no task base on a tag.
    expect(taskBaseCosignCall(pin.digest).join(' ')).not.toContain('refs/tags/');
  });
});

describe('/version on the pulled image', () => {
  it('answers the version and the commit', () => {
    expect(versionAnswer({ version: '0.2.0-alpha.2', commit: C }, { version: V, commit: C }).kind).toBe('pass');
    expect(versionAnswer({ version: '0.2.0-alpha.1', commit: C }, { version: V, commit: C }).kind).toBe('refuse');
    expect(versionAnswer({ version: '0.2.0-alpha.2', commit: 'unknown' }, { version: V, commit: C }).kind).toBe('refuse');
    expect(versionAnswer(null, { version: V, commit: C }).kind).toBe('refuse');
  });

  it("asks it with the image's Node by its path, the distroless one first, and never a bare node", () => {
    // From 0.2.0-alpha.5 the appliance is distroless (workplan 0119 §3 item
    // 12): Node at /nodejs/bin/node, off the PATH, and no shell, so `docker
    // exec <name> node` finds nothing and the check would refuse every release.
    expect(APPLIANCE_NODES).toEqual(['/nodejs/bin/node', '/usr/local/bin/node']);
    for (const node of APPLIANCE_NODES) {
      const args = versionExec('release-version-1', node);
      expect(args.slice(0, 4)).toEqual(['exec', 'release-version-1', node, '-e']);
      expect(args[4]).toContain("+'/version'");
    }
    const verify = read('scripts/release-verify.mjs');
    expect(verify).toContain("run('docker', versionExec(name, node))");
    expect(verify).not.toMatch(/\[\s*'exec',\s*name,\s*'node'/);
  });
});

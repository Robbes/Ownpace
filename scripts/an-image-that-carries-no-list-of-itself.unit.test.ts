// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN IMAGE THAT CARRIES NO LIST OF ITSELF: the release's `bom.json` lists npm packages, and nothing
 * listed the operating-system packages the published images are built on (SBOM-1, the image half;
 * the owner's decision of 2026-11-24, for alpha.20).
 *
 * ## What an outside, read-only check found
 *
 * It compared the SBOM a release publishes with a list of its own. `bom.json` is made from the
 * lockfile, so it cannot see the Debian packages of the distroless runtime under `ownpace-api`,
 * `ownpace-worker` and `ownpace-selfhost`, nor the Alpine packages of nginx under `ownpace-web`.
 * The published indexes carried a provenance attestation per platform (read on `ownpace-selfhost:edge`,
 * 2026-11-24: one in-toto layer, `https://slsa.dev/provenance/v1`) and no SBOM.
 *
 * ## What changed
 *
 * - `images.yml` builds each published image with `sbom:` on both build-push-action steps, its
 *   generator `docker/buildkit-syft-scanner` by release tag and digest, on the publish path only.
 * - After the signature, each build leg reads the SBOM back from the registry by the index digest
 *   it pushed (`docker buildx imagetools inspect … --format '{{ json .SBOM }}'`), and
 *   `scripts/image-sbom.mjs extract` writes one SPDX file per platform, named after the image, the
 *   version (or `sha-<commit>` on main) and the platform, refusing an index with no SBOM, or an
 *   SBOM with no operating-system package. Kept with the run as an artifact, on main too.
 * - On a tag, a job of its own (`contents: write`, nothing else) checks that the files are
 *   exactly the set the release carries (`expect`) and attaches them next to `bom.json`.
 * - `release-verify.mjs` refuses a release from alpha.20 on without each file, or with one that
 *   is not SPDX, lists no OS package, or is not named after the index the version tag names now.
 *
 * ## What this test holds
 *
 * The module on two real SBOM attestations cut down to what it reads (the pinned
 * `nginx:1.31.9-alpine-slim`, Alpine, and `node:26.13.1-trixie-slim`, Debian and npm, both as
 * Docker publishes them), and each refusal by a mutation of them; release-verify's check over a
 * stand-in download; and the workflow: the `sbom:` input, the read-back step run by bash against a
 * stand-in `docker`, and the attach job run against a stand-in `gh`.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  FIRST_IMAGE_SBOM_RELEASE,
  SBOM_PLATFORMS,
  checkImageSbom,
  osPackages,
  packageCounts,
  sbomDocumentName,
  sbomFault,
  sbomFileName,
  setFaults,
  splitImageSbom,
} from './image-sbom.mjs';
import type { Inspected, SpdxDocument } from './image-sbom.mjs';
import { IMAGES, checkImageSboms, imageSbomFiles, imageSbomsAt } from './release-verify.mjs';
import type { Asset, Release } from './release-verify.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const fixture = (name: string): Inspected => JSON.parse(read(`scripts/fixtures/image-sbom/${name}`)) as Inspected;
const NGINX = 'nginx-1.31.9-alpine-slim.sbom.json';
const NODE = 'node-26.13.1-trixie-slim.sbom.json';
const DIGEST = `sha256:${'ab'.repeat(32)}`;
const V = 'v0.2.0-alpha.20';

type Step = { name?: string; id?: string; if?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Job = { needs?: string | string[]; if?: string; permissions?: Record<string, string>; steps: Step[]; strategy?: { matrix?: { image?: string[] } } };
const workflow = parse(read('.github/workflows/images.yml')) as { jobs: Record<string, Job> };
const build = workflow.jobs['build']!;
const stepNamed = (job: Job, name: RegExp): Step => {
  const step = job.steps.find((s) => name.test(s.name ?? ''));
  expect(step, String(name)).toBeDefined();
  return step!;
};

describe('an SBOM attestation, split into one file per platform (scripts/image-sbom.mjs)', () => {
  it('reads a Debian image and an Alpine one as Docker publishes them: SPDX 2.3, OS packages, and npm where installed', () => {
    const node = splitImageSbom(fixture(NODE), { image: 'api', digest: DIGEST, label: '0.2.0-alpha.20' });
    expect(node.map((f) => f.file)).toEqual([
      'ownpace-api-0.2.0-alpha.20.linux-amd64.spdx.json',
      'ownpace-api-0.2.0-alpha.20.linux-arm64.spdx.json',
    ]);
    for (const f of node) {
      expect(f.doc.spdxVersion).toBe('SPDX-2.3');
      expect(f.doc.name).toBe(`ghcr.io/robbes/ownpace-api@${DIGEST} ${f.platform}`);
      expect(f.counts).toMatchObject({ deb: 113, npm: 144 });
      expect(osPackages(f.doc)).toEqual(expect.arrayContaining(['libc6 2.41-12+deb13u4', 'openssl 3.5.7-1~deb13u3', 'tzdata 2026f-0+deb13u1']));
      // Everything but the name and the comment is the attestation's own.
      const { name: _n, comment: _c, ...rest } = f.doc;
      const { name: _o, ...original } = fixture(NODE)[f.platform]!.SPDX!;
      expect(rest).toEqual(original);
    }
    const nginx = splitImageSbom(fixture(NGINX), { image: 'web', digest: DIGEST, label: 'sha-cdd6e89' });
    expect(nginx.map((f) => f.file)).toEqual(['ownpace-web-sha-cdd6e89.linux-amd64.spdx.json', 'ownpace-web-sha-cdd6e89.linux-arm64.spdx.json']);
    expect(nginx.map((f) => f.counts)).toEqual([{ apk: 26 }, { apk: 26 }]);
    expect(osPackages(nginx[0]!.doc)).toContain('alpine-baselayout 3.7.2-r1');
  });

  it('refuses an index with no SBOM, a platform missing, an SBOM with nothing in it or no OS package, and a bad digest', () => {
    const args = { image: 'selfhost', digest: DIGEST, label: '0.2.0-alpha.20' };
    // What imagetools prints for an index with attestations and no SBOM (binfmt's pinned build, 2026-11-24).
    expect(() => splitImageSbom({}, args)).toThrow(/linux\/amd64: the index carries no SBOM attestation for it; linux\/arm64: the index carries no SBOM attestation for it/);
    expect(() => splitImageSbom(null, args)).toThrow(/no usable SBOM/);
    const { 'linux/arm64': _gone, ...amd64Only } = fixture(NODE);
    expect(() => splitImageSbom(amd64Only, args)).toThrow(/linux\/arm64: the index carries no SBOM attestation/);
    const mutate = (change: (doc: SpdxDocument) => SpdxDocument): Inspected =>
      Object.fromEntries(Object.entries(fixture(NODE)).map(([p, v]) => [p, { SPDX: change(v.SPDX!) }]));
    expect(() => splitImageSbom(mutate((d) => ({ ...d, packages: [] })), args)).toThrow(/lists no package/);
    const noOs = mutate((d) => ({ ...d, packages: d.packages!.filter((p) => !(p.externalRefs ?? []).some((r) => /^pkg:(deb|apk)\//.test(r.referenceLocator ?? ''))) }));
    expect(() => splitImageSbom(noOs, args)).toThrow(/lists no operating-system package \(deb or apk\), only generic 1, npm 144/);
    expect(() => splitImageSbom(mutate((d) => ({ ...d, spdxVersion: 'SPDX-3.0' })), args)).toThrow(/not an SPDX 2 document/);
    expect(() => splitImageSbom(fixture(NODE), { ...args, digest: 'sha256:abc' })).toThrow(/is not an index digest/);
    expect(() => splitImageSbom(fixture(NODE), { ...args, label: '' })).toThrow(/no version or sha-<commit>/);
  });

  it('counts by purl type, leaving out the document root', () => {
    const doc = fixture(NGINX)['linux/amd64']!.SPDX!;
    expect(doc.packages!.length).toBe(27);
    expect(packageCounts(doc)).toEqual({ apk: 26 });
    expect(sbomFault(doc)).toBeNull();
  });

  it('judges a file on the release against the index the version tag names', () => {
    const [f] = splitImageSbom(fixture(NODE), { image: 'worker', digest: DIGEST, label: '0.2.0-alpha.20' });
    const args = { image: 'worker', digest: DIGEST, platform: 'linux/amd64', file: f!.file };
    expect(checkImageSbom(f!.doc, args)).toMatchObject({ kind: 'pass', check: 'image-sbom-worker' });
    expect(checkImageSbom(f!.doc, args).sentence).toBe(`${f!.file}: SPDX-2.3 of linux/amd64, deb 113, generic 1, npm 144`);
    const other = `sha256:${'cd'.repeat(32)}`;
    expect(checkImageSbom(f!.doc, { ...args, digest: other })).toMatchObject({ kind: 'refuse' });
    expect(checkImageSbom(f!.doc, { ...args, digest: other }).sentence).toMatch(/not the SBOM of the index the version tag names/);
    expect(checkImageSbom(f!.doc, { ...args, platform: 'linux/arm64' }).kind).toBe('refuse');
    expect(checkImageSbom(null, args).sentence).toMatch(/is not JSON/);
    expect(checkImageSbom({ ...f!.doc, packages: [] }, args).sentence).toMatch(/lists no package/);
  });

  it('takes exactly the set the release carries before any is attached (`expect`)', () => {
    const expected = imageSbomFiles(V);
    const docs = new Map<string, string>();
    for (const image of IMAGES) {
      for (const f of splitImageSbom(fixture(NGINX), { image, digest: DIGEST, label: '0.2.0-alpha.20' })) docs.set(f.file, JSON.stringify(f.doc));
    }
    const all = [...docs.keys()].sort();
    expect(setFaults(expected, all, (file) => docs.get(file)!)).toEqual([]);
    const short = all.filter((f) => f !== 'ownpace-worker-0.2.0-alpha.20.linux-arm64.spdx.json');
    expect(setFaults(expected, short, (file) => docs.get(file)!)).toEqual(['ownpace-worker-0.2.0-alpha.20.linux-arm64.spdx.json is missing']);
    expect(setFaults(expected, [...all, 'stray.json'], (file) => docs.get(file)!)).toEqual(['stray.json is not a file this release carries']);
    expect(setFaults(expected, all, (file) => (file.includes('web') ? '{' : docs.get(file)!))).toHaveLength(2);
  });
});

describe('release-verify: each image SBOM on the release', () => {
  it('expects one file per image published at the version and per platform, from alpha.20 on', () => {
    expect(FIRST_IMAGE_SBOM_RELEASE).toBe('0.2.0-alpha.20');
    expect(imageSbomsAt('0.2.0-alpha.19')).toBe(false);
    expect(imageSbomsAt('0.2.0-alpha.20')).toBe(true);
    expect(imageSbomsAt('0.2.0')).toBe(true);
    expect(imageSbomFiles(V)).toHaveLength(IMAGES.length * SBOM_PLATFORMS.length);
    expect(imageSbomFiles(V)[0]).toEqual({ image: 'api', platform: 'linux/amd64', file: 'ownpace-api-0.2.0-alpha.20.linux-amd64.spdx.json' });
    // Before the worker's first release it has none, as it has no image.
    expect(imageSbomFiles('v0.2.0-alpha.15').map((f) => f.image)).not.toContain('worker');
  });

  const files = new Map<string, Buffer>();
  const digests = Object.fromEntries(IMAGES.map((image, i) => [image, `sha256:${String(i).repeat(64)}`]));
  for (const image of IMAGES) {
    for (const f of splitImageSbom(fixture(NODE), { image, digest: digests[image]!, label: '0.2.0-alpha.20' })) {
      files.set(f.file, Buffer.from(JSON.stringify(f.doc)));
    }
  }
  const asset = (name: string, over: Partial<Asset> = {}): Asset => ({
    name,
    size: files.get(name)?.length ?? 10,
    state: 'uploaded',
    browser_download_url: `https://example.invalid/${name}`,
    ...over,
  });
  const release = (assets: Asset[]): Release => ({ tag_name: V, draft: false, prerelease: true, body: '', assets });
  const seams = {
    fetchImpl: async (url: string) => new Response(new Uint8Array(files.get(url.split('/').pop()!) ?? Buffer.from('{}'))),
    sleep: async () => {},
    say: () => {},
  };

  it('passes a complete release, and says what each file lists', async () => {
    const lines = await checkImageSboms(release([...files.keys()].map((n) => asset(n))), V, digests, seams);
    expect(lines).toHaveLength(8);
    expect(lines.every((l) => l.kind === 'pass')).toBe(true);
    expect(lines[0]!.sentence).toBe('ownpace-api-0.2.0-alpha.20.linux-amd64.spdx.json: SPDX-2.3 of linux/amd64, deb 113, generic 1, npm 144');
  });

  it('refuses a file missing, empty, not uploaded, naming another index, or with no index to hold it to; notes a release before alpha.20', async () => {
    const names = [...files.keys()];
    const lines = await checkImageSboms(
      release([
        ...names.slice(1, 5).map((n) => asset(n)),
        asset(names[5]!, { size: 0 }),
        asset(names[6]!, { state: 'starter' }),
        asset(names[7]!),
      ]),
      V,
      { ...digests, worker: `sha256:${'f'.repeat(64)}` },
      seams,
    );
    const refused = lines.filter((l) => l.kind === 'refuse').map((l) => l.sentence);
    expect(refused).toEqual([
      'ownpace-api-0.2.0-alpha.20.linux-amd64.spdx.json is not attached',
      'ownpace-selfhost-0.2.0-alpha.20.linux-arm64.spdx.json is empty',
      'ownpace-worker-0.2.0-alpha.20.linux-amd64.spdx.json is starter, not uploaded',
      expect.stringMatching(/^ownpace-worker-0\.2\.0-alpha\.20\.linux-arm64\.spdx\.json is named .* not the SBOM of the index the version tag names$/),
    ]);
    const { selfhost: _s, ...unread } = digests;
    const noIndex = await checkImageSboms(release(names.map((n) => asset(n))), V, unread, seams);
    expect(noIndex.filter((l) => l.kind === 'refuse').map((l) => l.sentence)).toEqual([
      'ownpace-selfhost-0.2.0-alpha.20.linux-amd64.spdx.json is attached, and ownpace-selfhost:0.2.0-alpha.20 could not be read, so there is no index to hold it to',
      'ownpace-selfhost-0.2.0-alpha.20.linux-arm64.spdx.json is attached, and ownpace-selfhost:0.2.0-alpha.20 could not be read, so there is no index to hold it to',
    ]);
    expect(await checkImageSboms(release([]), 'v0.2.0-alpha.19', digests, seams)).toEqual([
      { kind: 'note', check: 'image-sbom', sentence: "the images' own SBOMs are attached from 0.2.0-alpha.20 on, and v0.2.0-alpha.19 is older" },
    ]);
  });
});

describe('images.yml: every published image carries its SBOM, read back by digest, attached on a tag', () => {
  it('builds every published image, and only those, with the same pinned generator, on the publish path only', () => {
    expect(build.strategy?.matrix?.image).toEqual(IMAGES);
    const builds = build.steps.filter((s) => (s.uses ?? '').startsWith('docker/build-push-action@'));
    expect(builds).toHaveLength(2);
    const sboms = builds.map((s) => String(s.with?.['sbom'] ?? ''));
    expect(new Set(sboms).size).toBe(1);
    expect(sboms[0]).toMatch(
      /^\$\{\{ github\.event_name != 'pull_request' && 'generator=docker\/buildkit-syft-scanner:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}' \|\| '' \}\}$/,
    );
    // Provenance is left as the action adds it: nothing turns it off.
    for (const s of builds) expect(s.with?.['provenance']).toBeUndefined();
  });

  it('reads the SBOM back after the signature, keeps it with the run, and runs Node only after setup-node names it', () => {
    const names = build.steps.map((s) => s.name ?? s.uses ?? '');
    const sign = names.findIndex((n) => /^Sign the published image/.test(n));
    const back = names.findIndex((n) => /^Read the image's own SBOM back/.test(n));
    const keep = names.findIndex((n) => /^Keep the image's SBOM with the run/.test(n));
    expect(sign).toBeGreaterThan(0);
    expect(back).toBe(sign + 1);
    expect(keep).toBe(back + 1);
    expect(build.steps[back]!.if).toBe("github.event_name != 'pull_request'");
    expect(build.steps[keep]!.if).toBe("github.event_name != 'pull_request'");
    expect(build.steps[keep]!.with).toMatchObject({ name: 'image-sbom-${{ matrix.image }}-${{ github.sha }}', 'if-no-files-found': 'error' });
    expect(build.steps[0]!.uses).toMatch(/^actions\/setup-node@/);
    expect(build.steps[0]!.if).toBe(build.steps[back]!.if);
  });

  /** The read-back step, run by bash with a stand-in `docker` that prints what imagetools would. */
  function readBack(inspected: string, env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'image-sbom-step-'));
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho "$*" >> "${dir}/docker.log"\ncat "${inspected}"\n`);
      chmodSync(join(bin, 'docker'), 0o755);
      const step = stepNamed(build, /^Read the image's own SBOM back/);
      const run = spawnSync('bash', ['-c', step.run!], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { PATH: `${bin}:${process.env.PATH ?? ''}`, RUNNER_TEMP: dir, IMAGE: 'selfhost', BUILT_DIGEST: DIGEST, GITHUB_SHA: 'cdd6e89'.padEnd(40, '0'), ...env },
      });
      const out = join(dir, 'image-sbom');
      const written = (() => {
        try {
          return readdirSync(out).sort();
        } catch {
          return [];
        }
      })();
      return { status: run.status, stdout: run.stdout, docker: readFileSync(join(dir, 'docker.log'), 'utf8').trim(), written };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('on a tag, names the files after the version; on main, after sha-<commit>; asks imagetools for the pushed digest', () => {
    const tag = readBack(join(ROOT, 'scripts/fixtures/image-sbom', NODE), { GITHUB_REF: `refs/tags/${V}`, GITHUB_REF_NAME: V });
    expect(tag.status, tag.stdout).toBe(0);
    expect(tag.docker).toBe(`buildx imagetools inspect ghcr.io/robbes/ownpace-selfhost@${DIGEST} --format {{ json .SBOM }}`);
    expect(tag.written).toEqual(imageSbomFiles(V).filter((f) => f.image === 'selfhost').map((f) => f.file));
    const main = readBack(join(ROOT, 'scripts/fixtures/image-sbom', NODE), { GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'main' });
    expect(main.status, main.stdout).toBe(0);
    expect(main.written).toEqual(SBOM_PLATFORMS.map((p) => sbomFileName('selfhost', 'sha-cdd6e89', p)));
    expect(sbomDocumentName('selfhost', DIGEST, 'linux/amd64')).toBe(`ghcr.io/robbes/ownpace-selfhost@${DIGEST} linux/amd64`);
  });

  it('fails the leg, loudly, on an index with no SBOM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'image-sbom-empty-'));
    try {
      writeFileSync(join(dir, 'empty.json'), '{}\n');
      const got = readBack(join(dir, 'empty.json'), { GITHUB_REF: `refs/tags/${V}`, GITHUB_REF_NAME: V });
      expect(got.status).toBe(1);
      expect(got.stdout).toMatch(/::error::ghcr\.io\/robbes\/ownpace-selfhost@sha256:.* has no usable SBOM/);
      expect(got.written).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('attaches on a tag only, after every leg, with only contents: write, the names check first and the set checked before any upload', () => {
    const job = workflow.jobs['image-sboms']!;
    expect(job.needs).toBe('build');
    expect(job.if).toBe("startsWith(github.ref, 'refs/tags/')");
    expect(job.permissions).toEqual({ contents: 'write' });
    const download = job.steps.find((s) => (s.uses ?? '').startsWith('actions/download-artifact@'))!;
    expect(download.with).toMatchObject({ pattern: 'image-sbom-*-${{ github.sha }}', 'merge-multiple': true });
    const attach = stepNamed(job, /^Attach the images' SBOMs/).run!;
    expect(attach.indexOf('node scripts/image-sbom.mjs expect')).toBeGreaterThan(-1);
    expect(attach.indexOf('node scripts/image-sbom.mjs expect')).toBeLessThan(attach.indexOf('gh release'));
  });

  /** The attach step, run by bash with a stand-in `gh` whose `release create` answers `created`. */
  function attach(created: boolean, files: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'image-sbom-attach-'));
    try {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeFileSync(
        join(bin, 'gh'),
        `#!/bin/sh\necho "$*" >> "${dir}/gh.log"\nif [ "$1 $2" = "release create" ]; then exit ${created ? 0 : 1}; fi\nexit 0\n`,
      );
      chmodSync(join(bin, 'gh'), 0o755);
      const work = join(dir, 'work');
      mkdirSync(join(work, 'image-sbom'), { recursive: true });
      // The checkout's scripts, as the job's checkout has them.
      symlinkSync(join(ROOT, 'scripts'), join(work, 'scripts'));
      for (const image of IMAGES) {
        for (const f of splitImageSbom(fixture(NGINX), { image, digest: DIGEST, label: '0.2.0-alpha.20' })) {
          if (files.includes(f.file)) writeFileSync(join(work, 'image-sbom', f.file), JSON.stringify(f.doc));
        }
      }
      const step = stepNamed(workflow.jobs['image-sboms']!, /^Attach the images' SBOMs/);
      const run = spawnSync('bash', ['-c', step.run!], {
        cwd: work,
        encoding: 'utf8',
        // The symlink kept as the path Node runs, or `import.meta.url` (the real path) would not be
        // `argv[1]` and the script would run nothing, and pass.
        env: { PATH: `${bin}:${process.env.PATH ?? ''}`, GITHUB_REF_NAME: V, NODE_OPTIONS: '--preserve-symlinks --preserve-symlinks-main' },
      });
      let log = '';
      try {
        log = readFileSync(join(dir, 'gh.log'), 'utf8').trim();
      } catch {
        log = '';
      }
      return { status: run.status, stdout: run.stdout, log };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('makes the release with the eight files when a hand-pushed tag has none, adds them to the one Security Scan made, and attaches nothing from a set short of one', () => {
    const all = imageSbomFiles(V).map((f) => f.file);
    const made = attach(true, all);
    expect(made.status, made.stdout).toBe(0);
    expect(made.log.split('\n')).toHaveLength(1);
    expect(made.log).toMatch(new RegExp(`^release create ${V.replace(/\./g, '\\.')} --verify-tag --title ${V.replace(/\./g, '\\.')} --prerelease=true --notes  image-sbom/`));
    for (const f of all) expect(made.log).toContain(`image-sbom/${f}`);
    const added = attach(false, all);
    expect(added.status, added.stdout).toBe(0);
    expect(added.log.split('\n').map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(['release create', 'release view', 'release upload', 'release edit']);
    expect(added.log).toMatch(/release upload .* --clobber$/m);
    const short = attach(true, all.slice(1));
    expect(short.status).toBe(1);
    expect(short.stdout).toMatch(/::error::the images' SBOMs for v0\.2\.0-alpha\.20 are not the set the release carries, so none is attached: ownpace-api-0\.2\.0-alpha\.20\.linux-amd64\.spdx\.json is missing/);
    expect(short.log).toBe('');
  });
});

describe('the docs say what each list covers', () => {
  it('release.md and SECURITY.md name the image SBOMs and what a filesystem scan cannot see', () => {
    for (const doc of ['docs/release.md', 'SECURITY.md']) {
      const text = read(doc);
      expect(text, doc).toMatch(/\.spdx\.json/);
      expect(text, doc).toMatch(/bundle/);
    }
    // The generator the docs name is the one images.yml pins.
    const pinned = /generator=(docker\/buildkit-syft-scanner:[^@]+)@/.exec(read('.github/workflows/images.yml'))![1]!;
    expect(read('docs/release.md')).toContain(pinned);
  });
});

// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RELEASE ATTACHED TWICE: alpha.15's image scan after the tag ran on the tag, replaced the `bom.json` verify had read and appended its body a second time (workplan 0146, Status of 2026-11-22).
 *
 * ## What happened
 *
 * `v0.2.0-alpha.15` was released and verified on 2026-11-22. The image scan
 * after a release (Security Scan dispatched with `image_scans: true`) runs on
 * `main` at the release commit; alpha.13's and alpha.14's did. alpha.15's was
 * dispatched on the tag. On a tag ref, `.github/workflows/security-scan.yml`'s
 * two release steps run, *Compose release body* and *Attach SBOM to GitHub
 * release*: the attach found the release there, so it ran
 * `gh release upload "$tag" bom.json --clobber`, which replaced the SBOM
 * release-verify had already read, and appended its body to the one there,
 * so the release page says everything twice.
 *
 * ## Which run is meant to do what (release.yml, windows-payload.yml)
 *
 * - Under Release, Security Scan dispatched on the tag (`image_scans=false`)
 *   creates the release with its body and `bom.json`, before anything else
 *   ships; `windows-payload.yml` attaches the zip after it.
 * - Under a tag pushed by hand, whichever attaches first creates it. When
 *   `windows-payload.yml` is first, its release has the zip and an empty body,
 *   and NEVER a `bom.json` (its attach uploads the zip alone): Security Scan
 *   then adds `bom.json` and appends its body. So no intended path needs a
 *   `bom.json` replaced, and the rule is plain: one already there stays.
 * - A re-run of a failed scan on the tag (docs/release.md §3) adds what is
 *   missing and nothing twice.
 *
 * ## What this test holds
 *
 * 1. **The body is appended once.** The attach step, run by bash against a
 *    stand-in `gh` that keeps a release's state, leaves a body that already
 *    holds the generated block (its `cosign verify` line, the one
 *    release-verify.mjs counts) as it is, and says so in the log.
 * 2. **A verified SBOM is not replaced.** Against a release that carries a
 *    `bom.json`, the step uploads nothing and says so; `--clobber` appears
 *    nowhere in it.
 * 3. **The scan after a release belongs on main.** A dispatch with
 *    `image_scans` on a tag ref refuses at the job's first step, with a
 *    sentence that says to dispatch it on `main` at the release commit; the
 *    image jobs skip a tag ref; Release's own dispatches pass
 *    `image_scans=false`; `docs/release.md` says it plainly.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { generatedBlocks } from './release-verify.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const WORKFLOW = '.github/workflows/security-scan.yml';

type Step = { name?: string; if?: string; run?: string };
type Job = { if?: string; steps?: Step[] };
const workflow = parse(read(WORKFLOW)) as { jobs: Record<string, Job> };
const scanSteps = workflow.jobs['security-scan']!.steps ?? [];
const step = (name: string): Step => {
  const found = scanSteps.find((s) => s.name === name);
  if (!found?.run) throw new Error(`${WORKFLOW} has no step "${name}" with a run block`);
  return found;
};
const COMPOSE = step('Compose release body');
const ATTACH = step('Attach SBOM to GitHub release');
const REFUSE_ON_TAG = 'A dispatch with the image scans runs on main, not on a tag';

const TAG = 'v0.2.0-alpha.15';

/**
 * A stand-in for the `gh` the attach step calls. It keeps one release in
 * files (`exists`, `assets`, `body`) and answers the calls the step makes the
 * way the real one does: `create` fails when the release is there, `upload`
 * refuses an asset that is there unless `--clobber`, `edit --notes-file`
 * replaces the body. Every call is logged.
 */
const FAKE_GH = `
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.FAKE_GH_STATE;
const f = (n) => path.join(dir, n);
const args = process.argv.slice(2);
fs.appendFileSync(f('calls'), JSON.stringify(args) + '\\n');
const exists = fs.existsSync(f('exists'));
const assets = () => (fs.existsSync(f('assets')) ? fs.readFileSync(f('assets'), 'utf8').split('\\n').filter(Boolean) : []);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const [group, verb] = args;
if (group !== 'release') { console.error('unexpected gh ' + args.join(' ')); process.exit(2); }
if (verb === 'create') {
  if (exists) { console.error('a release with the same tag name already exists: ' + args[2]); process.exit(1); }
  fs.writeFileSync(f('exists'), '');
  fs.writeFileSync(f('body'), fs.readFileSync(flag('--notes-file'), 'utf8'));
  fs.writeFileSync(f('assets'), args.filter((a) => a === 'bom.json').join('\\n') + '\\n');
  process.exit(0);
}
if (!exists) { console.error('release not found'); process.exit(1); }
if (verb === 'view') {
  const field = flag('--json');
  if (field === 'tagName') { console.log(JSON.stringify({ tagName: args[2] })); process.exit(0); }
  if (field === 'assets') { for (const a of assets()) console.log(a); process.exit(0); }
  if (field === 'body') { process.stdout.write(fs.readFileSync(f('body'), 'utf8') + '\\n'); process.exit(0); }
}
if (verb === 'upload') {
  const name = args[3];
  if (assets().includes(name) && !args.includes('--clobber')) { console.error('asset under the same name already exists: ' + name); process.exit(1); }
  if (args.includes('--clobber')) fs.appendFileSync(f('clobbered'), name + '\\n');
  if (!assets().includes(name)) fs.appendFileSync(f('assets'), name + '\\n');
  process.exit(0);
}
if (verb === 'edit') {
  const notes = flag('--notes-file');
  if (notes) fs.writeFileSync(f('body'), fs.readFileSync(notes, 'utf8'));
  process.exit(0);
}
console.error('unexpected gh ' + args.join(' '));
process.exit(2);
`;

type Release = { assets: string[]; body: string } | null;
type Result = { status: number | null; stdout: string; stderr: string; calls: string[][]; release: Release; clobbered: string[] };

/** Run Compose, then Attach, by bash as the workflow runs them, against a release in the state given. */
function attach(before: Release, opts: { compose?: (run: string) => string; attach?: (run: string) => string } = {}): Result {
  const dir = mkdtempSync(join(tmpdir(), 'attach-twice-'));
  try {
    const work = join(dir, 'work');
    const state = join(dir, 'state');
    const bin = join(dir, 'bin');
    for (const d of [work, state, bin]) mkdirSync(d);
    writeFileSync(join(bin, 'gh'), `#!${process.execPath}\n${FAKE_GH}`);
    chmodSync(join(bin, 'gh'), 0o755);
    if (before) {
      writeFileSync(join(state, 'exists'), '');
      writeFileSync(join(state, 'assets'), before.assets.map((a) => `${a}\n`).join(''));
      writeFileSync(join(state, 'body'), before.body);
    }
    writeFileSync(join(work, 'bom.json'), '{"bomFormat":"CycloneDX"}');
    const env = { PATH: `${bin}:${process.env.PATH ?? ''}`, GITHUB_REF_NAME: TAG, FAKE_GH_STATE: state, GH_TOKEN: 'unused', GH_REPO: 'owner/repo' };
    const compose = (opts.compose ?? ((r) => r))(COMPOSE.run!);
    execFileSync('bash', ['-e', '-c', compose], { cwd: work, env });
    const run = (opts.attach ?? ((r) => r))(ATTACH.run!);
    const r = spawnSync('bash', ['-e', '-c', run], { cwd: work, env, encoding: 'utf8' });
    const lines = (n: string) => (existsSync(join(state, n)) ? readFileSync(join(state, n), 'utf8').split('\n').filter(Boolean) : []);
    const release: Release = existsSync(join(state, 'exists')) ? { assets: lines('assets'), body: readFileSync(join(state, 'body'), 'utf8') } : null;
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls: lines('calls').map((l) => JSON.parse(l) as string[]), release, clobbered: lines('clobbered') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const uploads = (r: Result) => r.calls.filter((c) => c[1] === 'upload');
const bodyEdits = (r: Result) => r.calls.filter((c) => c[1] === 'edit' && c.includes('--notes-file'));

describe(`${WORKFLOW}: the release attach runs once per release, whatever runs on the tag again`, () => {
  const fresh = attach(null);

  it('creates the release, with its body and bom.json, when there is none (Release’s scan on the tag)', () => {
    expect(fresh.status, fresh.stderr).toBe(0);
    expect(fresh.release?.assets).toEqual(['bom.json']);
    expect(generatedBlocks(fresh.release!.body, TAG)).toBe(1);
  });

  it('adds bom.json and appends the body once to a release windows-payload.yml made first (a tag pushed by hand)', () => {
    const r = attach({ assets: ['ownpace-appliance-win-x64-v0.2.0-alpha.15.zip'], body: '' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.release?.assets).toEqual(['ownpace-appliance-win-x64-v0.2.0-alpha.15.zip', 'bom.json']);
    expect(generatedBlocks(r.release!.body, TAG)).toBe(1);
    expect(r.clobbered).toEqual([]);
  });

  it('keeps prose a person wrote when it appends', () => {
    const r = attach({ assets: ['ownpace-appliance-win-x64-v0.2.0-alpha.15.zip'], body: 'Written by hand.' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.release!.body.startsWith('Written by hand.\n')).toBe(true);
    expect(generatedBlocks(r.release!.body, TAG)).toBe(1);
  });

  it('a second run on a complete release replaces no bom.json and appends no body, and says both in the log (alpha.15’s image scan)', () => {
    const r = attach(fresh.release);
    expect(r.status, r.stderr).toBe(0);
    expect(uploads(r), 'a bom.json was uploaded over the one the release carries').toEqual([]);
    expect(r.clobbered).toEqual([]);
    expect(bodyEdits(r), 'the body was rewritten').toEqual([]);
    expect(r.release).toEqual(fresh.release);
    expect(generatedBlocks(r.release!.body, TAG)).toBe(1);
    expect(r.stdout).toContain(`The release for ${TAG} already carries bom.json: left as it is, not replaced.`);
    expect(r.stdout).toContain(`The release body for ${TAG} already holds the generated block`);
    expect(r.stdout).toContain('not appended again');
  });

  it('a re-run after a half-done attach adds only what is missing', () => {
    const noBody = attach({ assets: ['bom.json'], body: '' });
    expect(noBody.status, noBody.stderr).toBe(0);
    expect(uploads(noBody)).toEqual([]);
    expect(generatedBlocks(noBody.release!.body, TAG)).toBe(1);

    const noBom = attach({ assets: [], body: fresh.release!.body });
    expect(noBom.status, noBom.stderr).toBe(0);
    expect(noBom.release?.assets).toEqual(['bom.json']);
    expect(bodyEdits(noBom)).toEqual([]);
    expect(generatedBlocks(noBom.release!.body, TAG)).toBe(1);
  });

  it('never clobbers: no intended path puts a bom.json on a release before this step, so none is replaced', () => {
    expect(ATTACH.run).not.toContain('--clobber');
    // windows-payload.yml's attach, the only other writer of a release, uploads its zip alone.
    const payload = read('.github/workflows/windows-payload.yml');
    expect(payload).toMatch(/gh release create "\$tag" --verify-tag --title "\$tag" --prerelease="\$pre" --notes "" "\$zip"/);
    expect(payload).not.toMatch(/bom\.json/);
  });

  it('tells a body already attached by the line release-verify.mjs counts, and refuses to attach when the composed body lacks it', () => {
    // The marker is the verify's: a body this step calls attached is one verify counts as one block.
    expect(ATTACH.run).toContain('marker="cosign verify ghcr.io/robbes/ownpace-selfhost:${tag#v}"');
    const r = attach(null, { compose: (run) => run.replace('cosign verify ghcr.io/robbes/ownpace-selfhost:${VER}', 'cosign verify elsewhere:${VER}') });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('::error::release-body.md has no line');
    expect(r.release).toBeNull();
  });
});

describe(`${WORKFLOW}: the image scan after a release belongs on main, never on the tag`, () => {
  const job = workflow.jobs['security-scan']!;

  it('a dispatch with image_scans on a tag ref refuses at the job’s first step, and only that dispatch does', () => {
    expect(scanSteps[0]?.name).toBe(REFUSE_ON_TAG);
    expect(scanSteps[0]?.if).toBe("github.event_name == 'workflow_dispatch' && inputs.image_scans && startsWith(github.ref, 'refs/tags/')");
    expect(job.if, 'the job is not skipped around the refusal').toBeUndefined();
  });

  it('says to dispatch it on main at the release commit, and fails the run', () => {
    const r = spawnSync('bash', ['-e', '-c', scanSteps[0]!.run!], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', GITHUB_REF_NAME: TAG } });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^::error::/);
    expect(r.stdout).toContain(`on the tag ${TAG}`);
    expect(r.stdout).toContain('Dispatch Security Scan on main at the release commit instead');
  });

  it('the image jobs skip a tag ref', () => {
    for (const name of ['image-list', 'image-scan', 'image-scan-report']) {
      expect(workflow.jobs[name]?.if, name).toContain("inputs.image_scans && !startsWith(github.ref, 'refs/tags/')");
    }
  });

  it('Release’s dispatches of Security Scan on a tag pass image_scans=false, so the refusal never meets them', () => {
    expect(read('.github/workflows/release.yml')).toContain('node scripts/release-dispatch.mjs publish --workflow security-scan.yml --input image_scans=false');
    const dispatch = read('scripts/release-dispatch.mjs');
    const scans = dispatch.match(/dispatchRun\(client, \{ workflow: 'security-scan\.yml'[^}]*\}/g) ?? [];
    expect(scans.length).toBe(2); // the gate scan and the tag rehearsal
    for (const s of scans) expect(dispatch.slice(dispatch.indexOf(s), dispatch.indexOf(s) + 200)).toContain("inputs: { image_scans: 'false' }");
  });

  it('docs/release.md says the image scan after the tag is dispatched on main at the release commit, never on the tag', () => {
    const doc = read('docs/release.md').replace(/\s+/g, ' ');
    expect(doc).toContain('**The image scan after the tag:** dispatch Security Scan **on `main` at the release commit**');
    expect(doc).toContain('never on the tag');
  });
});

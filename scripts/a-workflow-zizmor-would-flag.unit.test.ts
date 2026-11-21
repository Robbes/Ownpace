// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WORKFLOW ZIZMOR WOULD FLAG (a read-only check of the repository,
 * 2026-11-20: GEN-26, by zizmor 1.30.1's rules; workplan 0119).
 *
 * ## How it was found
 *
 * An outside, read-only check read `.github/` at `b4d11ee7` with zizmor 1.30.1
 * and named three lines, each `actions/setup-node@949feb24… # v7.1.0`:
 * images.yml's `build`, Security Scan's job and windows-payload's `build`.
 * The pin was right (a-tag-the-publisher-can-move holds each commit to the
 * tag its comment names). What fired is zizmor's `cache-poisoning` audit
 * (crates/zizmor/src/audit/cache_poisoning.rs at v1.30.1): in a workflow a
 * tag push, a `release` event or a release branch starts, or a job that runs a
 * known publisher (docker/build-push-action among them), every cache-aware
 * step is a finding unless it turns its cache off in a way zizmor can read.
 * For setup-node that is BOTH `cache` absent (or not npm, yarn or pnpm) AND
 * `package-manager-cache: false`, since v5 caches by default and zizmor
 * cannot see that this repository's `packageManager` names pnpm, which
 * setup-node's automatic cache ignores. a-token-the-job-never-asked-for had
 * read those three lines on 2026-11-19 and left them, rightly as far as the
 * runner goes; zizmor reads the file, not the runner, so the file now says it.
 *
 * The three were a sample: zizmor flags every cache-aware step in all four
 * workflows a tag starts. ci.yml (on `v*` since 2026-08-10) had four
 * setup-node steps with `cache: pnpm` and two actions/cache steps, Security
 * Scan two more setup-node steps, images.yml and windows-payload.yml one more
 * each.
 *
 * ## What changed
 *
 *  1. EVERY setup-node IN A WORKFLOW A TAG STARTS SAYS
 *     `package-manager-cache: false` and names no `cache:` zizmor reads as on.
 *  2. ci.yml's pnpm store, which setup-node's `cache: pnpm` restored, is an
 *     actions/cache step of its own, keyed as setup-node keyed it (OS, arch,
 *     the lockfile's hash), and every actions/cache there says
 *     `lookup-only: ${{ startsWith(github.ref, 'refs/tags/') }}`: a pull
 *     request and main restore as before, a tag's run looks and restores
 *     nothing. zizmor reads that expression (its tag-push heuristic) only in
 *     a workflow every release trigger of which is a tag push or a release,
 *     which this holds too.
 *  3. A STEP THAT SKIPS WORK ON A CACHE HIT ALSO RUNS ON A TAG: lookup-only
 *     still reports `cache-hit: true`, so ci.yml's Chromium install would
 *     otherwise be skipped on a tag with nothing restored.
 *
 * ## zizmor in CI, blocking
 *
 * `.github/workflows/zizmor.yml` runs zizmor 1.32.0 since 2026-11-21 (until
 * then 1.30.1, the version the outside check runs), by tag and index digest
 * (`ZIZMOR`, below, the reference read on 2026-11-21), on every pull request
 * and push to main that touches `.github/` or an action file, offline
 * (`--offline`, `--network none`, no token), with `--config .github/zizmor.yml`
 * and `--no-ignores`, so nothing in the tree can turn a rule or a location off.
 * Its first run found 24 findings already on main (template injection,
 * Dependabot's cooldown, two release actions the runner's `gh` replaces), all
 * fixed with it; a finding fails it now. The pin
 * watch's row `ghcr.io/zizmorcore/zizmor` lists a newer release.
 * This holds the job to that, each rule broken on purpose below as well; that
 * the one zizmor config, `.github/zizmor.yml`, holds `dependabot-cooldown`'s
 * three days and nothing else (since 2026-11-21, when Dependabot's cooldown
 * went from seven days to three), that every Dependabot entry waits at least
 * that long, and that no workflow carries an ignore comment; and
 * the three changes above, on every workflow, so a step added later is held
 * before zizmor ever reads it.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = '.github/workflows';
const WORKFLOW = '.github/workflows/zizmor.yml';
const JOB = 'zizmor';

/** zizmor 1.32.0 by its index digest, read on 2026-11-21 (the workflow's comment says how). */
const ZIZMOR = 'ghcr.io/zizmorcore/zizmor:1.32.0@sha256:3014cc8f68f663935f69b3c3e0e41f5ce102b268d97db13db0f62208747f860d';

/** The flags that keep the run offline and let nothing in the tree silence a finding. */
const FLAGS = ['--offline', '--config .github/zizmor.yml', '--no-ignores', '--network none'];

/** The expression zizmor's tag-push heuristic reads as "on" for a tag. */
const ON_A_TAG = "${{ startsWith(github.ref, 'refs/tags/') }}";

interface Step {
  readonly id?: string;
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly env?: Record<string, unknown>;
  readonly with?: Record<string, unknown>;
  readonly 'continue-on-error'?: unknown;
}

interface Job {
  readonly 'runs-on'?: unknown;
  readonly if?: unknown;
  readonly env?: Record<string, unknown>;
  readonly permissions?: unknown;
  readonly 'continue-on-error'?: unknown;
  readonly steps?: ReadonlyArray<Step>;
}

interface Workflow {
  readonly on?: unknown;
  readonly permissions?: unknown;
  readonly env?: Record<string, unknown>;
  readonly jobs?: Record<string, Job>;
}

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

function workflowFiles(): ReadonlyArray<string> {
  return readdirSync(join(REPO_ROOT, WORKFLOWS))
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((f) => `${WORKFLOWS}/${f}`);
}

function repoOf(uses: string | undefined): string {
  return typeof uses === 'string' ? (uses.split('@')[0] ?? '') : '';
}

type Release = 'tag push' | 'release branch push' | 'release event';

/**
 * What zizmor calls a release trigger (`triggers_used_when_publishing_artifacts`
 * in crates/zizmor/src/audit/cache_poisoning.rs), at v1.30.1 and v1.32.0,
 * unchanged: v1.32.0 reads the same three from one normalized set of events,
 * whatever the shape of `on:`.
 */
export function releaseTriggers(workflow: Workflow): ReadonlyArray<Release> {
  const on = workflow.on;
  const names = typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(String) : [];
  if (names.includes('release')) return ['release event'];
  if (!on || typeof on !== 'object' || Array.isArray(on)) return [];
  const events = on as Record<string, unknown>;
  const out: Release[] = [];
  const push = events['push'];
  if (push && typeof push === 'object') {
    const body = push as Record<string, unknown>;
    if (body['tags'] !== undefined || body['tags-ignore'] !== undefined) out.push('tag push');
    const branches = body['branches'];
    if (Array.isArray(branches) && branches.some((b) => String(b).toLowerCase().includes('release'))) out.push('release branch push');
  }
  if ('release' in events) out.push('release event');
  return out;
}

/** The publishers zizmor knows (`KNOWN_PUBLISHER_ACTIONS`), at v1.30.1 and v1.32.0, unchanged. */
const PUBLISHERS = [
  'pypa/gh-action-pypi-publish',
  'rubygems/release-gem',
  'jreleaser/release-action',
  'goreleaser/goreleaser-action',
  'softprops/action-gh-release',
  'release-drafter/release-drafter',
  'googleapis/release-please-action',
  'docker/build-push-action',
  'redhat-actions/push-to-registry',
  'aws-actions/amazon-ecs-deploy-task-definition',
  'aws-actions/aws-cloudformation-github-deploy',
  'Azure/aci-deploy',
  'Azure/container-apps-deploy-action',
  'Azure/functions-action',
  'Azure/sql-action',
  'cloudflare/wrangler-action',
  'google-github-actions/deploy-appengine',
  'google-github-actions/deploy-cloudrun',
  'google-github-actions/deploy-cloud-functions',
];

/**
 * Every cache-aware step zizmor would flag, in every job zizmor calls a
 * publishing one, read as zizmor reads it: setup-node with `cache` set to a
 * package manager (or an expression), or without `package-manager-cache:
 * false`; actions/cache without `lookup-only` true, or the tag expression in a
 * workflow whose release triggers are tag pushes or releases only; and any
 * other action on zizmor's list of cache-aware actions
 * (`KNOWN_CACHE_AWARE_ACTIONS`) that this file names, none of which this
 * repository uses. pnpm/setup joined that list in v1.31.0, its one change
 * between v1.30.1 and v1.32.0; pnpm/action-setup, which this repository
 * uses, is not on it.
 */
export function cacheFindings(path: string, workflow: Workflow): ReadonlyArray<string> {
  const triggers = releaseTriggers(workflow);
  const heuristic = triggers.length > 0 && triggers.every((t) => t === 'tag push' || t === 'release event');
  return Object.entries(workflow.jobs ?? {}).flatMap(([name, job]) => {
    const steps = job.steps ?? [];
    const publishes = triggers.length > 0 || steps.some((s) => PUBLISHERS.some((p) => repoOf(s.uses).toLowerCase() === p.toLowerCase()));
    if (!publishes) return [];
    return steps.flatMap((s, i) => {
      const where = `${path} job ${name}, step ${i + 1}`;
      const repo = repoOf(s.uses);
      const w = s.with ?? {};
      if (repo === 'actions/setup-node') {
        const out: string[] = [];
        const cache = w['cache'];
        if (cache !== undefined && (/\$\{\{/.test(String(cache)) || ['npm', 'yarn', 'pnpm'].includes(String(cache)))) {
          out.push(`${where}: setup-node cache: ${String(cache)}`);
        }
        if (w['package-manager-cache'] !== false) {
          out.push(`${where}: setup-node without package-manager-cache: false (${JSON.stringify(w['package-manager-cache'] ?? '(absent, so true)')})`);
        }
        return out;
      }
      if (repo === 'actions/cache' || repo === 'actions/cache/restore') {
        const look = w['lookup-only'];
        if (look === true) return [];
        if (heuristic && look === ON_A_TAG) return [];
        return [`${where}: ${repo} lookup-only ${JSON.stringify(look ?? '(absent, so false)')}`];
      }
      if (/^(actions\/setup-(go|java|python|dotnet)|astral-sh\/setup-uv|Swatinem\/rust-cache|ruby\/setup-ruby|oven-sh\/setup-bun|pnpm\/setup|jdx\/mise-action)$/i.test(repo)) {
        return [`${where}: ${repo}, a cache-aware action this file does not read: read zizmor's coordinate for it and teach this file`];
      }
      return [];
    });
  });
}

/**
 * Every step whose `if:` reads a `cache-hit` from a cache that only looks on
 * a tag, and does not also run on a tag (3): lookup-only reports the hit and
 * restores nothing, so the step would be skipped with nothing in its place.
 */
export function skippedOnATag(path: string, workflow: Workflow): ReadonlyArray<string> {
  return Object.entries(workflow.jobs ?? {}).flatMap(([name, job]) => {
    const steps = job.steps ?? [];
    const looking = new Set(steps.filter((s) => s.id && s.with?.['lookup-only'] === ON_A_TAG).map((s) => s.id!));
    return steps.flatMap((s, i) => {
      const cond = typeof s.if === 'string' ? s.if : '';
      const reads = [...cond.matchAll(/steps\.([\w-]+)\.outputs\.cache-hit/g)].map((m) => m[1]!).filter((id) => looking.has(id));
      return reads.length > 0 && !cond.includes("startsWith(github.ref, 'refs/tags/')")
        ? [`${path} job ${name}, step ${i + 1} (${s.name ?? s.run ?? s.uses ?? '?'}) skips on ${reads.join(', ')}'s cache-hit, which a tag reports without restoring`]
        : [];
    });
  });
}

/** What is wrong with zizmor.yml's job: each way it could run another zizmor, go online, hide a finding or land where it should not. */
export function jobProblems(text: string): string[] {
  const out: string[] = [];
  const workflow = parseYaml(text) as Workflow;
  const on = (workflow.on ?? {}) as Record<string, { paths?: unknown; branches?: unknown } | null>;
  for (const event of ['pull_request', 'push'] as const) {
    const body = on[event];
    if (!body) out.push(`it does not run on ${event}`);
    else if (!Array.isArray(body.paths) || !body.paths.includes('.github/**')) out.push(`its ${event} does not run on a change under .github/`);
  }
  if (on['pull_request'] && 'branches' in (on['pull_request'] ?? {})) out.push('its pull_request filters by branch (every-pr-gets-checked)');
  if (JSON.stringify(workflow.permissions) !== JSON.stringify({ contents: 'read' })) out.push(`its permissions are ${JSON.stringify(workflow.permissions)}, not contents: read`);
  const jobs = Object.keys(workflow.jobs ?? {});
  if (jobs.length !== 1 || jobs[0] !== JOB) out.push(`it has the jobs ${jobs.join(', ') || '(none)'}, not the one ${JOB}`);
  const job = workflow.jobs?.[JOB];
  if (!job) return out;
  if (job['runs-on'] !== 'ubuntu-24.04') out.push(`it runs on ${JSON.stringify(job['runs-on'])}, not a GitHub-hosted ubuntu runner`);
  if (job.if !== undefined) out.push('the job has an if:');
  if (job['continue-on-error'] !== undefined) out.push(`the job sets continue-on-error (${String(job['continue-on-error'])})`);
  if (job.permissions !== undefined) out.push('the job widens or names its own permissions');
  const tokens = /\b(GH_TOKEN|GITHUB_TOKEN|ZIZMOR_GITHUB_TOKEN)\b|github\.token|secrets\./;
  if (tokens.test(JSON.stringify([workflow.env, job.env, job.steps]))) out.push('it hands zizmor a token, which turns its online audits on');
  const image = job.env?.['ZIZMOR_IMAGE'];
  if (typeof image !== 'string' || !/^ghcr\.io\/zizmorcore\/zizmor:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/.test(image)) {
    out.push(`ZIZMOR_IMAGE is ${JSON.stringify(image)}, not ghcr.io/zizmorcore/zizmor:<x.y.z>@sha256:<index digest>`);
  } else {
    const [, version, digest] = /:([\d.]+)@sha256:([0-9a-f]{64})$/.exec(image)!;
    if (!text.includes(`zizmor ${version} by its index digest`)) out.push(`the comment above ZIZMOR_IMAGE does not name the release it pins (zizmor ${version})`);
    if (!text.includes(`\`${digest!.slice(0, 12)}…\``)) out.push(`the comment above ZIZMOR_IMAGE does not name the digest it carries (${digest!.slice(0, 12)}…)`);
    for (const platform of ['linux/amd64', 'linux/arm64']) if (!text.includes(platform)) out.push(`the comment does not say its index holds ${platform}`);
    if (!/read on \d{4}-\d{2}-\d{2}/.test(text)) out.push('the comment does not say the day its digest was read');
  }
  const named = [...text.matchAll(/zizmorcore\/zizmor:/g)].length;
  if (named !== 1) out.push(`it names a zizmor image ${named} times, not once`);
  const steps = job.steps ?? [];
  steps.forEach((s, i) => {
    if (s['continue-on-error'] !== undefined) out.push(`step ${i + 1} sets continue-on-error (${String(s['continue-on-error'])})`);
  });
  const audit = steps.filter((s) => typeof s.run === 'string' && s.run.includes('"$ZIZMOR_IMAGE"') && s.run.includes('docker run'));
  if (audit.length !== 1) {
    out.push(`${audit.length} steps run zizmor, not one`);
    return out;
  }
  const run = audit[0]!.run!;
  if (audit[0]!.if !== undefined) out.push('the audit step has an if:');
  for (const flag of FLAGS) if (!run.includes(flag)) out.push(`the audit does not run with ${flag}`);
  if (/\|\|\s*(true|:)\b/.test(run) || /--no-exit-codes|--format[ =]sarif|--min-(severity|confidence)|--persona|--fix/.test(run)) {
    out.push('the audit reads a finding as success, or narrows what zizmor reports');
  }
  if (!/^\s*exit "\$status"\s*$/m.test(run)) out.push('the audit does not exit with zizmor\'s own status');
  if (!/\bdocker run --rm --pull never\b/.test(run)) out.push('the audit does not run the image it pulled, by its digest, alone');
  return out;
}

/** The files a zizmor config could live in, by its documented discovery (docs/configuration.md at v1.30.1 and v1.32.0, unchanged). */
const CONFIG_FILES = ['zizmor.yml', 'zizmor.yaml', '.github/zizmor.yml', '.github/zizmor.yaml'];

/** The one config the job passes with `--config`. */
const CONFIG = '.github/zizmor.yml';

/**
 * The three days CONTRIBUTING.md asks of every dependency, which Dependabot's
 * cooldown waits and `dependabot-cooldown`'s `days` is held to (zizmor's own
 * default is seven; docs/audits.md at v1.32.0).
 */
const COOLDOWN_DAYS = 3;

/**
 * What is wrong with the zizmor config and Dependabot's cooldowns: any setting
 * but `dependabot-cooldown`'s three days (a `disable`, an `ignore`, another
 * rule, another number), and any Dependabot entry that waits less than that.
 */
export function configProblems(config: string, dependabot: string): string[] {
  const out: string[] = [];
  const want = { rules: { 'dependabot-cooldown': { config: { days: COOLDOWN_DAYS } } } };
  const got: unknown = parseYaml(config);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    out.push(`${CONFIG} holds ${JSON.stringify(got)}, not only dependabot-cooldown's days: ${COOLDOWN_DAYS}`);
  }
  const updates = ((parseYaml(dependabot) as { updates?: unknown } | null)?.updates ?? []) as ReadonlyArray<{
    'package-ecosystem'?: unknown;
    directory?: unknown;
    directories?: unknown;
    cooldown?: { 'default-days'?: unknown } | null;
  }>;
  if (updates.length === 0) out.push('dependabot.yml has no updates entry');
  for (const u of updates) {
    const days = u.cooldown?.['default-days'];
    if (typeof days !== 'number' || days < COOLDOWN_DAYS) {
      out.push(`the ${String(u['package-ecosystem'])} entry for ${JSON.stringify(u.directory ?? u.directories)} waits ${JSON.stringify(days)} days, not at least ${COOLDOWN_DAYS}`);
    }
  }
  return out;
}

const docs = workflowFiles().map((path) => ({ path, text: read(path), workflow: parseYaml(read(path)) as Workflow }));

describe('no cache-aware step zizmor would flag (cache-poisoning, 2026-11-20)', () => {
  it('reads every workflow, and the four a tag starts', () => {
    expect(docs.length, 'almost no workflows found').toBeGreaterThan(10);
    expect(docs.filter(({ workflow }) => releaseTriggers(workflow).length > 0).map(({ path }) => path)).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/images.yml',
      '.github/workflows/security-scan.yml',
      '.github/workflows/windows-payload.yml',
    ]);
  });

  it('every cache-aware step in a publishing job turns its cache off the way zizmor reads it', () => {
    expect(
      docs.flatMap(({ path, workflow }) => cacheFindings(path, workflow)),
      'a cache restored into a run a tag starts is another run’s files in what it checks or publishes: give setup-node ' +
        "`package-manager-cache: false` and no `cache:`, and actions/cache `lookup-only: ${{ startsWith(github.ref, 'refs/tags/') }}`",
    ).toEqual([]);
  });

  it('found the steps it was written for: thirteen setup-node steps and six caches', () => {
    const steps = docs.flatMap(({ path, workflow }) =>
      releaseTriggers(workflow).length === 0
        ? []
        : Object.values(workflow.jobs ?? {}).flatMap((job) => (job.steps ?? []).map((s) => `${path} ${repoOf(s.uses)}`)),
    );
    expect(steps.filter((s) => s.endsWith(' actions/setup-node')).length).toBeGreaterThanOrEqual(13);
    expect(steps.filter((s) => s.endsWith(' actions/cache')).length).toBeGreaterThanOrEqual(6);
  });

  it('refuses each of the three lines the outside check named, put back as it was', () => {
    for (const path of ['.github/workflows/images.yml', '.github/workflows/security-scan.yml', '.github/workflows/windows-payload.yml']) {
      const before = read(path);
      const after = before.replace(/^ +package-manager-cache: false.*\n/m, '');
      expect(after, `${path}: the mutation changed nothing`).not.toBe(before);
      expect(cacheFindings(path, parseYaml(after) as Workflow).join('\n')).toMatch(/setup-node without package-manager-cache: false \("\(absent, so true\)"\)/);
    }
  });

  it("refuses ci.yml's pnpm cache put back on setup-node, and a cache that restores on a tag", () => {
    const path = '.github/workflows/ci.yml';
    const before = read(path);
    const pnpm = before.replace(/^( +)package-manager-cache: false\n/m, '$1cache: pnpm\n');
    expect(pnpm).not.toBe(before);
    expect(cacheFindings(path, parseYaml(pnpm) as Workflow).join('\n')).toMatch(/setup-node cache: pnpm/);
    const restores = before.replace(`lookup-only: ${ON_A_TAG}`, 'lookup-only: false');
    expect(restores).not.toBe(before);
    expect(cacheFindings(path, parseYaml(restores) as Workflow).join('\n')).toMatch(/actions\/cache lookup-only false/);
  });

  it('reads the tag expression only where zizmor does: a workflow a branch push named release also starts is flagged', () => {
    const path = '.github/workflows/ci.yml';
    const before = read(path);
    const after = before.replace("    branches: [main]\n    # A tag pushed by hand", "    branches: [main, release/x]\n    # A tag pushed by hand");
    expect(after).not.toBe(before);
    expect(cacheFindings(path, parseYaml(after) as Workflow).join('\n')).toMatch(/actions\/cache lookup-only "\$\{\{ startsWith/);
  });

  it('calls a job publishing when it runs a known publisher, whatever starts its workflow', () => {
    const job = (steps: Step[]): Workflow => ({ on: { pull_request: null }, jobs: { j: { steps } } });
    const node = { uses: 'actions/setup-node@0000000000000000000000000000000000000000', with: { 'node-version': '26' } };
    expect(cacheFindings('x.yml', job([node]))).toEqual([]);
    expect(cacheFindings('x.yml', job([node, { uses: 'docker/build-push-action@0000000000000000000000000000000000000000' }]))).toHaveLength(1);
  });

  it('names pnpm/setup in a publishing job, the cache-aware action zizmor 1.31.0 added, and not pnpm/action-setup', () => {
    const tag = (uses: string): Workflow => ({ on: { push: { tags: ['v*'] } }, jobs: { j: { steps: [{ uses }] } } });
    expect(cacheFindings('x.yml', tag('pnpm/setup@0000000000000000000000000000000000000000')).join('\n')).toMatch(
      /x\.yml job j, step 1: pnpm\/setup, a cache-aware action this file does not read/,
    );
    expect(cacheFindings('x.yml', tag('pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115'))).toEqual([]);
  });

  it('a step that skips on a cache hit also runs on a tag, where the cache only looked', () => {
    expect(docs.flatMap(({ path, workflow }) => skippedOnATag(path, workflow))).toEqual([]);
    const path = '.github/workflows/ci.yml';
    const before = read(path);
    const after = before.replace(" || startsWith(github.ref, 'refs/tags/')\n", '\n');
    expect(after).not.toBe(before);
    expect(skippedOnATag(path, parseYaml(after) as Workflow).join('\n')).toMatch(/skips on pw-cache's cache-hit/);
  });
});

describe('zizmor in CI, blocking (2026-11-20)', () => {
  const text = read(WORKFLOW);

  it('runs zizmor by tag and index digest, offline, in one job that hides nothing', () => {
    expect(jobProblems(text)).toEqual([]);
    const image = (parseYaml(text) as Workflow).jobs![JOB]!.env!['ZIZMOR_IMAGE'];
    expect(image, `${WORKFLOW} runs another zizmor than the one read: read the new one as its comment says, then move both`).toBe(ZIZMOR);
  });

  it('refuses a pin moved without its reading, a tag alone, a release candidate and another registry', () => {
    const pin = /^ {6}ZIZMOR_IMAGE: (\S+)$/m.exec(text)?.[1];
    expect(pin, `${WORKFLOW} pins no ZIZMOR_IMAGE to mutate`).toBeDefined();
    const mutate = (from: string, to: string): string => {
      const next = text.replace(from, to);
      expect(next, from).not.toBe(text);
      return jobProblems(next).join('\n');
    };
    expect(mutate(pin!, pin!.replace(/@sha256:[0-9a-f]{64}/, `@sha256:${'0'.repeat(64)}`))).toMatch(/does not name the digest it carries \(000000000000…\)/);
    expect(mutate(pin!, pin!.replace(/@sha256:.*/, ''))).toMatch(/not ghcr\.io\/zizmorcore\/zizmor:<x\.y\.z>@sha256:<index digest>/);
    expect(mutate(pin!, pin!.replace(/:[\d.]+@/, ':1.30.0-rc2@'))).toMatch(/not ghcr\.io\/zizmorcore\/zizmor:<x\.y\.z>@sha256:<index digest>/);
    expect(mutate(pin!, pin!.replace('ghcr.io/', 'docker.io/'))).toMatch(/not ghcr\.io\/zizmorcore\/zizmor:<x\.y\.z>@sha256:<index digest>/);
    expect(mutate(pin!, pin!.replace('1.32.0', '1.32.1'))).toMatch(/does not name the release it pins \(zizmor 1\.32\.1\)/);
    expect(mutate('linux/arm64', 'arm64')).toMatch(/does not say its index holds linux\/arm64/);
    expect(mutate('read on 2026-11-21', 'read')).toMatch(/does not say the day its digest was read/);
  });

  it('refuses each way the job could go online, silence a finding, or read a failed run as green', () => {
    const mutate = (from: string, to: string): string => {
      const next = text.replace(from, to);
      expect(next, from).not.toBe(text);
      return jobProblems(next).join('\n');
    };
    expect(mutate('--offline ', '')).toMatch(/does not run with --offline/);
    expect(mutate('--config .github/zizmor.yml ', '')).toMatch(/does not run with --config \.github\/zizmor\.yml/);
    expect(mutate('--config .github/zizmor.yml ', '--no-config ')).toMatch(/does not run with --config \.github\/zizmor\.yml/);
    expect(mutate('--no-ignores ', '')).toMatch(/does not run with --no-ignores/);
    expect(mutate('--network none ', '')).toMatch(/does not run with --network none/);
    expect(mutate('--no-progress ', '--no-progress --min-severity high ')).toMatch(/narrows what zizmor reports/);
    expect(mutate('--no-progress ', '--no-progress --no-exit-codes ')).toMatch(/narrows what zizmor reports/);
    expect(mutate('          exit "$status"\n', '          exit 0\n')).toMatch(/does not exit with zizmor's own status/);
    expect(mutate('    timeout-minutes: 10\n', '    timeout-minutes: 10\n    continue-on-error: true\n')).toMatch(/the job sets continue-on-error/);
    expect(mutate('    timeout-minutes: 10\n', "    timeout-minutes: 10\n    if: github.event_name != 'pull_request'\n")).toMatch(/the job has an if:/);
    expect(mutate('    env:\n      # zizmor', '    env:\n      GH_TOKEN: ${{ github.token }}\n      # zizmor')).toMatch(/hands zizmor a token/);
    expect(mutate('runs-on: ubuntu-24.04', 'runs-on: self-hosted')).toMatch(/not a GitHub-hosted ubuntu runner/);
    expect(mutate("      - '.github/**'\n", '')).toMatch(/does not run on a change under \.github\//);
  });

  it('the one zizmor config holds dependabot-cooldown\'s three days and nothing else, and no workflow carries an ignore comment', () => {
    expect(CONFIG_FILES.filter((f) => existsSync(join(REPO_ROOT, f)))).toEqual([CONFIG]);
    expect(configProblems(read(CONFIG), read('.github/dependabot.yml'))).toEqual([]);
    expect(docs.filter(({ text }) => /zizmor:\s*ignore/i.test(text)).map(({ path }) => path)).toEqual([]);
  });

  it('refuses a config that turns an audit off, ignores a place, adds a rule or lowers the days, and a Dependabot entry that waits less', () => {
    const config = read(CONFIG);
    const dependabot = read('.github/dependabot.yml');
    const mutate = (from: string, to: string, inDependabot = false): string => {
      const text = inDependabot ? dependabot : config;
      const next = text.replace(from, to);
      expect(next, from).not.toBe(text);
      return (inDependabot ? configProblems(config, next) : configProblems(next, dependabot)).join('\n');
    };
    expect(mutate('      days: 3\n', '      days: 1\n')).toMatch(/not only dependabot-cooldown's days: 3/);
    expect(mutate('      days: 3\n', '      days: 3\n  template-injection:\n    disable: true\n')).toMatch(/not only dependabot-cooldown's days: 3/);
    expect(mutate('    config:\n', '    ignore:\n      - ci.yml\n    config:\n')).toMatch(/not only dependabot-cooldown's days: 3/);
    expect(mutate('    config:\n', '    disable: true\n    config:\n')).toMatch(/not only dependabot-cooldown's days: 3/);
    expect(mutate('rules:\n', 'rules:\n  unpinned-uses:\n    config:\n      policies:\n        "*": any\n')).toMatch(/not only dependabot-cooldown's days: 3/);
    expect(mutate('      default-days: 3\n', '      default-days: 1\n', true)).toMatch(/waits 1 days, not at least 3/);
    expect(mutate('    cooldown:\n      default-days: 3\n', '', true)).toMatch(/waits undefined days, not at least 3/);
  });
});

// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TOKEN THE JOB NEVER ASKED FOR: six workflows ran on whatever token the
 * repository's settings hand out, images.yml's `build` held `packages: write`
 * and `id-token: write` only because the workflow gave them to every job, and
 * eighteen checkouts left the token in `.git/config` for every step after them
 * (workplan 0119, 2026-11-19).
 *
 * ## How it was found
 *
 * An outside, read-only check of `.github/workflows/` on `646b9de2`
 * (2026-11-19) read three points: an action from outside this repository is
 * pinned to a commit, no workflow has a dangerous trigger, and every job's
 * permissions are as small as the job (OWASP's CI/CD Security Cheat Sheet). It
 * named nineteen lines, one for each shape a file had: sixteen are the three
 * shapes below, and three are `actions/setup-node` steps, answered in the last
 * section. Every `uses:` was already a commit, and each commit was the tag its
 * comment names (`git ls-remote`, read the same day), which
 * `a-tag-the-publisher-can-move` holds.
 *
 * ## The token nobody chose
 *
 * `ci.yml`, the four E2E workflows and `no-committed-artifacts.yml` said
 * nothing about permissions, at the top or on any job. A job that says nothing
 * gets the repository's default `GITHUB_TOKEN`, whose scopes are a setting
 * (Settings, Actions, General), not a line in this tree: read on contents and
 * packages, or write on every scope, by whatever was chosen there and when.
 * Four of those workflows run on the self-hosted runner, and `ci.yml`'s push
 * jobs do whenever `CI_PUSH_ON_SELF_HOSTED` is `true`. None uses more than the
 * checkout's `contents: read`: actions/cache and upload-artifact use the
 * runner's own token, not `GITHUB_TOKEN`'s scopes, and what the E2E lanes log
 * in with is a repository secret, the machine's persisted `.env` or the dev
 * stack's own password, none of which `permissions:` touches. Each now says
 * `contents: read` at the top.
 *
 * ## A write every job was handed
 *
 * `images.yml` granted `packages: write` and `id-token: write` at the top.
 * Seven of its eight jobs replace that with a `contents: read` of their own;
 * `build` did not, and it is the job that uses both: its login to ghcr.io
 * pushes with the token (`packages: write`), and cosign signs keyless with the
 * run's OIDC identity (`id-token: write`). The two now sit on `build`, which
 * holds exactly what it held, and the top says `contents: read`, so a job
 * added later starts from read and asks for what it uses. A workflow of one
 * job keeps its write at the top (`clock-watch.yml`, `idp-pin-watch.yml`,
 * whose own guards hold it there): with one job, the top is that job's block.
 *
 * ## A token left where every later step can read it
 *
 * `actions/checkout` keeps the job's token in `.git/config`, as an
 * `http.extraheader`, until the job ends, unless it is given
 * `persist-credentials: false`. Every step after it can read that file:
 * `pnpm install`'s lifecycle scripts, a test, a build. Eighteen checkouts kept
 * it, in jobs that never push with git, among them `images.yml`'s `build`
 * (`packages: write`), Security Scan's job and windows-payload's `release`
 * (both `contents: write`). An action that takes `github.token` as an input
 * still gets it (upload-sarif, the release attach, the ghcr.io login); what
 * changes is that no file on the runner holds it. The release check's
 * `git fetch` of the tags now runs without it, as the exposure probe's fetch
 * of a commit already does, which works because this repository is public:
 * were it private, that fetch would need a token of its own.
 *
 * ## No trigger that hands a stranger the token
 *
 * `pull_request_target` runs on a pull request from anywhere with this
 * repository's token and secrets, and `workflow_run` runs after another run
 * with the same; with a checkout of the pull request's head, either runs a
 * stranger's code holding both. No workflow here has either.
 *
 * ## A job that publishes restores no cache
 *
 * The other three lines were the `actions/setup-node` steps that open
 * `images.yml`'s `build`, Security Scan's job and windows-payload's `build`,
 * three jobs that publish. setup-node is a cache-aware action, and a cache
 * restored into a job that publishes is another run's files in the release.
 * None is restored there, for three reasons this file holds for every job that
 * runs the release check: those steps name no `cache:`; they run before the
 * job's checkout, so on a fresh runner setup-node has no package.json to read;
 * and its automatic cache (on by default since v5, `package-manager-cache`)
 * engages only when `packageManager` names npm, and this repository's names
 * pnpm. The pin is right, and `check-latest: true` is
 * `a-gate-on-a-version-nothing-ships`' rule. So those lines did not change
 * that day. They did on 2026-11-20: the check named them again, by zizmor
 * 1.30.1's `cache-poisoning` audit, which reads the file and not the runner,
 * so each now says `package-manager-cache: false`, as every setup-node in a
 * workflow a tag starts does (`a-workflow-zizmor-would-flag`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows');

type Permissions = string | Record<string, string> | undefined;

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}

interface Job {
  readonly permissions?: Permissions;
  readonly steps?: ReadonlyArray<Step>;
}

interface Workflow {
  readonly on?: unknown;
  readonly permissions?: Permissions;
  readonly jobs?: Record<string, Job>;
}

/**
 * The six workflows that named no permissions, less `e2e-o365.yml`, deleted on
 * 2026-11-20 without having run a test (workplan 0141 T13 (a)). Named, so a
 * walk that stops seeing one fails here instead of passing over less.
 */
const UNDECLARED_FIXED = [
  '.github/workflows/ci.yml',
  '.github/workflows/e2e.yml',
  '.github/workflows/e2e-managed.yml',
  '.github/workflows/e2e-live-target.yml',
  '.github/workflows/no-committed-artifacts.yml',
];

/** The jobs whose checkouts kept the token, by file. */
const CHECKOUTS_FIXED: Readonly<Record<string, ReadonlyArray<string>>> = {
  '.github/workflows/ci.yml': [
    'detect-changes',
    'commit-convention',
    'docs-hygiene',
    'fixture-uuid-check',
    'migration-lint',
    'lint',
    'unit-tests',
    'ui-tests',
    'integration-tests',
  ],
  '.github/workflows/e2e.yml': ['e2e-selfhost'],
  '.github/workflows/e2e-managed.yml': ['e2e-managed'],
  '.github/workflows/e2e-live-target.yml': ['live-target'],
  '.github/workflows/images.yml': ['build'],
  '.github/workflows/no-committed-artifacts.yml': ['check-artifacts'],
  '.github/workflows/security-scan.yml': ['security-scan'],
  '.github/workflows/windows-payload.yml': ['build', 'release'],
};

/** The four jobs that run the release check, and so publish a release. */
const RELEASE_JOBS = [
  '.github/workflows/images.yml job build',
  '.github/workflows/security-scan.yml job security-scan',
  '.github/workflows/windows-payload.yml job build',
  '.github/workflows/windows-payload.yml job release',
];

function workflowFiles(): ReadonlyArray<string> {
  return readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((f) => `.github/workflows/${f}`);
}

function parse(text: string): Workflow {
  return parseYaml(text) as Workflow;
}

function text(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/** `write-all`, or a write on any one scope. */
function grantsWrite(permissions: Permissions): boolean {
  if (permissions === undefined) return false;
  if (typeof permissions === 'string') return permissions === 'write-all';
  return Object.values(permissions).some((level) => level === 'write');
}

/** Every job that runs on the repository's default token: no block of its own and none at the top. */
function undeclared(path: string, workflow: Workflow): ReadonlyArray<string> {
  if (workflow.permissions !== undefined) return [];
  return Object.entries(workflow.jobs ?? {})
    .filter(([, job]) => job.permissions === undefined)
    .map(([name]) => `${path} job ${name}`);
}

/**
 * Every job, in a workflow of more than one, that holds a write it does not
 * declare itself: it has no block of its own, and the top grants a write.
 */
function inheritedWrites(path: string, workflow: Workflow): ReadonlyArray<string> {
  const jobs = Object.entries(workflow.jobs ?? {});
  if (jobs.length < 2 || !grantsWrite(workflow.permissions)) return [];
  return jobs
    .filter(([, job]) => job.permissions === undefined)
    .map(([name]) => `${path} job ${name} inherits ${JSON.stringify(workflow.permissions)}`);
}

/** A block that names no scope at all: `read-all` or `write-all`. */
function blanketGrants(path: string, workflow: Workflow): ReadonlyArray<string> {
  const blocks: Array<[string, Permissions]> = [
    [`${path} (top)`, workflow.permissions],
    ...Object.entries(workflow.jobs ?? {}).map(([name, job]): [string, Permissions] => [`${path} job ${name}`, job.permissions]),
  ];
  return blocks.filter(([, p]) => typeof p === 'string').map(([where, p]) => `${where}: permissions: ${String(p)}`);
}

function isCheckout(step: Step): boolean {
  return typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@');
}

/** A `run:` that pushes with git, which is what a checkout's kept token would be for. */
const PUSHES = /\bgit\b[^\n]*\bpush\b/;

/** Every checkout, in a job that does not push with git, that keeps the token on disk. */
function keptTokens(path: string, workflow: Workflow): ReadonlyArray<string> {
  return Object.entries(workflow.jobs ?? {}).flatMap(([name, job]) => {
    const steps = job.steps ?? [];
    if (steps.some((s) => typeof s.run === 'string' && PUSHES.test(s.run))) return [];
    return steps.flatMap((s, i) =>
      isCheckout(s) && s.with?.['persist-credentials'] !== false
        ? [`${path} job ${name}, step ${i + 1}: persist-credentials ${JSON.stringify(s.with?.['persist-credentials'] ?? '(absent, so true)')}`]
        : [],
    );
  });
}

/** Every job with a checkout, in the form the fixes are named in. */
function checkoutJobs(path: string, workflow: Workflow): ReadonlyArray<string> {
  return Object.entries(workflow.jobs ?? {})
    .filter(([, job]) => (job.steps ?? []).some(isCheckout))
    .map(([name]) => `${path} job ${name}`);
}

function isSetupNode(step: Step): boolean {
  return typeof step.uses === 'string' && step.uses.startsWith('actions/setup-node@');
}

/** setup-node v7.1.0's own test for an npm project (src/main.ts, `getNameFromPackageManagerField`). */
const NPM = /^(\^)?npm(@.*)?$/;

const RUNS_RELEASE_CHECK = /\bnode scripts\/release-names-agree\.mjs\b/;

/** Every job that runs the release check: where Node is set up, and what in it could restore a cache. */
function releaseJobs(
  path: string,
  workflow: Workflow,
): ReadonlyArray<{ where: string; nodeBeforeCheckout: boolean; caches: ReadonlyArray<string> }> {
  return Object.entries(workflow.jobs ?? {})
    .filter(([, job]) => (job.steps ?? []).some((s) => typeof s.run === 'string' && RUNS_RELEASE_CHECK.test(s.run)))
    .map(([name, job]) => {
      const steps = job.steps ?? [];
      const setupAt = steps.findIndex(isSetupNode);
      const checkoutAt = steps.findIndex(isCheckout);
      return {
        where: `${path} job ${name}`,
        nodeBeforeCheckout: setupAt !== -1 && checkoutAt !== -1 && setupAt < checkoutAt,
        caches: steps.flatMap((s, i) => {
          if (typeof s.uses !== 'string') return [];
          if (/^actions\/cache(\/restore)?@/.test(s.uses)) return [`step ${i + 1}: ${s.uses.split('@')[0]!}`];
          if (!isSetupNode(s)) return [];
          const cache = s.with?.['cache'];
          if (cache !== undefined && cache !== '') return [`step ${i + 1}: setup-node cache: ${String(cache)}`];
          const auto = s.with?.['package-manager-cache'];
          if (auto === true || auto === 'true') return [`step ${i + 1}: setup-node package-manager-cache: ${String(auto)}`];
          return [];
        }),
      };
    });
}

/** The events a workflow triggers on, in any of the three shapes `on:` takes. */
function events(workflow: Workflow): ReadonlyArray<string> {
  const on = workflow.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on && typeof on === 'object') return Object.keys(on);
  return [];
}

const DANGEROUS = ['pull_request_target', 'workflow_run'];

const files = workflowFiles();
const docs = files.map((path) => ({ path, workflow: parse(text(path)) }));

describe('a job runs on the token its workflow names, not on the repository default', () => {
  it('reads every workflow, the five of the six that named none among them', () => {
    expect(files.length, 'almost no workflows found: every assertion below would pass over nothing').toBeGreaterThan(10);
    for (const path of UNDECLARED_FIXED) expect(files, path).toContain(path);
  });

  it('every job has permissions, of its own or from the top of its workflow', () => {
    expect(
      docs.flatMap(({ path, workflow }) => undeclared(path, workflow)),
      'these jobs get whatever Settings, Actions, General grants the default token, which this tree cannot see ' +
        'and a click can widen to write on every scope: give the workflow `permissions: contents: read` at the top, ' +
        'or each job the block it uses',
    ).toEqual([]);
  });

  it('refuses a workflow that names none, by taking the block off a real one', () => {
    const before = text('.github/workflows/e2e.yml');
    const after = before.replace(/^permissions:\n(?: {2}.*\n)+/m, '');
    expect(after, 'the mutation changed nothing').not.toBe(before);
    expect(undeclared('.github/workflows/e2e.yml', parse(after))).toEqual(['.github/workflows/e2e.yml job e2e-selfhost']);
  });
});

describe('a write reaches only the job that declares it', () => {
  it('no job of a workflow with several holds a write from the top', () => {
    expect(
      docs.flatMap(({ path, workflow }) => inheritedWrites(path, workflow)),
      'a write at the top reaches every job without a block of its own, and every job added later: ' +
        'move it onto the job that uses it, and leave `contents: read` at the top',
    ).toEqual([]);
  });

  it("images.yml's build holds what it pushes and signs with, and the top only reads", () => {
    const images = parse(text('.github/workflows/images.yml'));
    expect(images.permissions).toEqual({ contents: 'read' });
    expect(images.jobs?.['build']?.permissions).toEqual({ contents: 'read', packages: 'write', 'id-token': 'write' });
  });

  it('refuses the writes back at the top, by moving them on the real file', () => {
    const images = parse(text('.github/workflows/images.yml')) as {
      permissions?: Permissions;
      jobs: Record<string, { permissions?: Permissions }>;
    };
    images.permissions = images.jobs['build']!.permissions;
    delete images.jobs['build']!.permissions;
    expect(inheritedWrites('.github/workflows/images.yml', images as Workflow)).toEqual([
      '.github/workflows/images.yml job build inherits {"contents":"read","packages":"write","id-token":"write"}',
    ]);
  });

  it('no block grants every scope at once', () => {
    expect(
      docs.flatMap(({ path, workflow }) => blanketGrants(path, workflow)),
      '`read-all` and `write-all` name no scope: list the ones the job uses',
    ).toEqual([]);
  });
});

describe('a checkout leaves no token on the runner for the steps after it', () => {
  it('found every job each fix was made in', () => {
    const seen = docs.flatMap(({ path, workflow }) => checkoutJobs(path, workflow));
    const missing = Object.entries(CHECKOUTS_FIXED).flatMap(([path, jobs]) =>
      jobs.map((job) => `${path} job ${job}`).filter((where) => !seen.includes(where)),
    );
    expect(missing, 'the walk no longer finds these checkouts').toEqual([]);
    expect(seen.length, 'almost no checkouts found').toBeGreaterThan(30);
  });

  it('every checkout in a job that does not push with git says persist-credentials: false', () => {
    expect(
      docs.flatMap(({ path, workflow }) => keptTokens(path, workflow)),
      'actions/checkout keeps the token in .git/config until the job ends, where `pnpm install`, a test or a ' +
        'build can read it: add `persist-credentials: false` to its `with:`',
    ).toEqual([]);
  });

  it('refuses a checkout that keeps it, by taking the line off a real one', () => {
    const before = text('.github/workflows/no-committed-artifacts.yml');
    const after = before.replace(/^ +persist-credentials: false\n/m, '');
    expect(after, 'the mutation changed nothing').not.toBe(before);
    expect(keptTokens('.github/workflows/no-committed-artifacts.yml', parse(after))).toEqual([
      '.github/workflows/no-committed-artifacts.yml job check-artifacts, step 1: persist-credentials "(absent, so true)"',
    ]);
  });

  it('lets a job that pushes with git keep it, and only that job', () => {
    const job = (run: string): Workflow => ({
      jobs: { j: { steps: [{ uses: 'actions/checkout@0000000000000000000000000000000000000000' }, { run }] } },
    });
    expect(keptTokens('x.yml', job('git push origin HEAD:refs/heads/x'))).toEqual([]);
    expect(keptTokens('x.yml', job('git fetch --tags origin'))).toHaveLength(1);
  });
});

describe('no workflow runs on an event that hands a stranger the token', () => {
  it('no pull_request_target and no workflow_run', () => {
    expect(
      docs.flatMap(({ path, workflow }) => events(workflow).filter((e) => DANGEROUS.includes(e)).map((e) => `${path}: on ${e}`)),
      'both run with this repository’s token and secrets on an event somebody outside it can cause',
    ).toEqual([]);
  });

  it('reads `on:` in all three of its shapes', () => {
    expect(events(parse('on: pull_request_target\njobs: {}\n'))).toEqual(['pull_request_target']);
    expect(events(parse('on: [push, workflow_run]\njobs: {}\n'))).toEqual(['push', 'workflow_run']);
    expect(events(parse('on:\n  workflow_run:\n    workflows: [CI]\njobs: {}\n'))).toEqual(['workflow_run']);
    expect(events(parse(text('.github/workflows/ci.yml')))).toEqual(['pull_request', 'push', 'workflow_dispatch']);
  });
});

describe('a job that publishes a release restores no cache', () => {
  const found = docs.flatMap(({ path, workflow }) => releaseJobs(path, workflow));

  it('found the four jobs that run the release check', () => {
    expect(found.map((f) => f.where).sort()).toEqual([...RELEASE_JOBS].sort());
  });

  it('none of them restores a cache through setup-node or actions/cache', () => {
    expect(
      found.filter((f) => f.caches.length > 0).map((f) => `${f.where}: ${f.caches.join(', ')}`),
      'a cache restored into a job that publishes is another run’s files in the release: leave `cache:` off here',
    ).toEqual([]);
  });

  it('each sets Node up before its checkout, so setup-node finds no package.json to cache from on a fresh runner', () => {
    expect(found.filter((f) => !f.nodeBeforeCheckout).map((f) => f.where)).toEqual([]);
  });

  it("package.json's packageManager is not one setup-node caches by itself", () => {
    const pkg = JSON.parse(text('package.json')) as { packageManager?: unknown; devEngines?: { packageManager?: unknown } };
    expect(pkg.packageManager, 'the root package.json names its package manager').toMatch(/^pnpm@/);
    expect(NPM.test(String(pkg.packageManager))).toBe(false);
    const dev = pkg.devEngines?.packageManager;
    for (const entry of Array.isArray(dev) ? dev : dev === undefined ? [] : [dev]) {
      expect(NPM.test(String((entry as { name?: unknown }).name)), 'devEngines.packageManager names npm').toBe(false);
    }
    // The pattern is setup-node's, so it must say yes where setup-node would cache.
    for (const npm of ['npm', 'npm@11.6.0', '^npm@11']) expect(NPM.test(npm), npm).toBe(true);
  });

  it('refuses a cache on one of those steps, by adding it to the real file', () => {
    const before = text('.github/workflows/images.yml');
    const after = before.replace(/^( +)check-latest: true(.*)\n/m, '$1check-latest: true$2\n$1cache: pnpm\n');
    expect(after, 'the mutation changed nothing').not.toBe(before);
    expect(releaseJobs('.github/workflows/images.yml', parse(after)).flatMap((f) => f.caches)).toEqual([
      'step 1: setup-node cache: pnpm',
    ]);
  });
});

// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NEXTCLOUD THE DEMO DOES NOT RUN: a customer's own server may be on 35 while every suite here ran against 34 (workplan 0119, Status of 2026-10-25).
 *
 * ## What was missing
 *
 * The demo Nextcloud, the dev stack and the integration tier all ran
 * `nextcloud:34-apache`. Nextcloud 35 was on Docker Hub from mid-September, and a
 * customer migrating into their own Nextcloud runs whatever they run. Moving
 * the demo to 35 is one way (Nextcloud's data never goes back a version) and
 * waits for after the alpha.2 tag, so the question "does the WebDAV, CalDAV,
 * CardDAV, chunked-upload and share code work against 35" had no answer
 * anywhere, and the first to ask it would have been a customer.
 *
 * ## Since the demo moved (2026-10-26)
 *
 * The leg answered: every suite green against 35.0.1 and 35.0.2 (#1705). The
 * demo, the dev stack and the integration tier then move to
 * `nextcloud:35.0.2-apache` by digest, and the leg flips to
 * `nextcloud:34.0.5-apache` by the digest they ran before (#1678): 34 is the
 * major a customer who has not upgraded still runs, maintained by Nextcloud
 * until 2027-06. The rule below did not change, and is what made the flip one
 * change: with the demo on 35 and the leg left on 35 it fails, "the same
 * major", until the leg names the other one. The move waits on the owner's OK
 * (a major is the owner's call, and one way for the demo's data:
 * `docs/managed-bring-up.md`, *A Nextcloud major on the OTA stack*).
 *
 * ## What answers it
 *
 * `.github/workflows/nextcloud-second-major.yml` runs the integration suites
 * that talk to Nextcloud, found by `scripts/nextcloud-suites.mjs`, against the
 * image its `NEXTCLOUD_IMAGE` names, on a GitHub-hosted runner: on a push to
 * main that touches their code, on a pull request that changes how the leg
 * runs, weekly, and on demand. Not on every pull request: `ci.yml` already
 * runs every suite against the demo's major on two architectures.
 *
 * ## What this holds
 *
 *  - the triggers: never every pull request, never a branch filter on one,
 *    and a pull request that changes the leg runs it;
 *  - the runner: GitHub-hosted, since a pull request can start it;
 *  - the image: exact version and index digest, and a major other than the
 *    one the integration tier, the demo and the dev stack run, or the leg
 *    proves nothing new;
 *  - the run: the found suites, without Stalwart, with a report in which a
 *    skipped test fails the run, and neither step nor the job able to be
 *    skipped or to fail quietly;
 *  - the finder: the suites it must find, each one reading the Nextcloud the
 *    setup exports and none waiting for a Stalwart the leg does not start;
 *    and a refusal, not an empty list, when it finds none;
 *  - the setup: an image asked for by name fails the run when it does not
 *    start, and is checked against the version that answered
 *    (`packages/testing/src/nextcloud-image.ts`, unit-tested beside it).
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { READS_NEXTCLOUD, main, nextcloudSuites } from './nextcloud-suites.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const WORKFLOW_PATH = '.github/workflows/nextcloud-second-major.yml';
const SETUP_PATH = 'packages/testing/src/testcontainers-setup.ts';

interface Step {
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly env?: Record<string, unknown>;
}
interface Job {
  readonly 'runs-on'?: unknown;
  readonly env?: Record<string, unknown>;
  readonly steps?: ReadonlyArray<Step>;
}
interface Workflow {
  readonly on?: Record<string, unknown>;
  readonly jobs?: Record<string, Job>;
}

const workflow = parseYaml(read(WORKFLOW_PATH)) as Workflow;
const triggers = (workflow.on ?? {}) as Record<string, { branches?: unknown; paths?: unknown } | null>;
const jobs = Object.entries(workflow.jobs ?? {});
const job = jobs[0]?.[1] ?? {};
const steps = job.steps ?? [];
const image = String(job.env?.NEXTCLOUD_IMAGE ?? '');

/** The major of a `nextcloud:` reference's tag, or NaN. */
const majorOf = (ref: string): number => Number(/^nextcloud:(\d+)/.exec(ref)?.[1] ?? NaN);

/** The integration tier's default: the one literal `new GenericContainer('nextcloud:…')`. */
const setup = read(SETUP_PATH);
const defaults = [...setup.matchAll(/new GenericContainer\('(nextcloud:[^']+)'\)/g)].map((m) => m[1]!);

/** The stacks': every `image: nextcloud:` line of managed.yml (the demo) and dev.yml (the dev stack). */
const COMPOSE_PATHS = ['deploy/compose/managed.yml', 'deploy/compose/dev.yml'] as const;
const stacks = COMPOSE_PATHS.map((path) => ({
  path,
  refs: [...read(path).matchAll(/^\s*image:\s*(nextcloud:\S+)/gm)].map((m) => m[1]!),
}));

describe('when the second-major leg runs', () => {
  it('read a workflow with one job and its steps', () => {
    expect(jobs).toHaveLength(1);
    expect(steps.length).toBeGreaterThan(4);
  });

  it('on a push to main, weekly and on demand', () => {
    expect(triggers.push?.branches).toEqual(['main']);
    // Both roots the finder walks (ROOTS in scripts/nextcloud-suites.mjs), so a
    // suite under apps/ moves the leg as one under packages/ does.
    expect(triggers.push?.paths).toEqual(
      expect.arrayContaining(['packages/**', 'apps/**', 'vitest.config.ts', 'pnpm-lock.yaml', WORKFLOW_PATH]),
    );
    expect(Object.keys(triggers)).toEqual(expect.arrayContaining(['schedule', 'workflow_dispatch']));
  });

  it('on a pull request only when it changes how the leg runs, with no branch filter', () => {
    const pr = triggers.pull_request;
    expect(pr, 'no pull_request trigger: a change to the leg would first run after it merged').toBeTruthy();
    expect(
      pr?.paths,
      'a pull_request trigger without `paths:` runs the leg on every pull request, which ci.yml\'s ' +
        'integration job against the default major already covers',
    ).toEqual(
      expect.arrayContaining([
        WORKFLOW_PATH,
        SETUP_PATH,
        'packages/testing/src/nextcloud-image.ts',
        // The integration project's include and timeouts.
        'vitest.config.ts',
        'vitest.global-setup.ts',
        'scripts/nextcloud-suites.mjs',
      ]),
    );
    // every-pr-gets-checked.unit.test.ts says why a branch filter is refused.
    expect(pr?.branches).toBeUndefined();
  });

  it('on a GitHub-hosted runner, never the self-hosted one', () => {
    for (const [name, j] of jobs) {
      const runsOn = JSON.stringify(j['runs-on'] ?? '');
      expect(runsOn, `${name} can be started by a pull request, which must never reach the self-hosted runner`).not.toContain(
        'self-hosted',
      );
      expect(runsOn, `${name} names no pinned GitHub-hosted image`).toMatch(/^"ubuntu-\d+\.\d+(-arm)?"$/);
    }
  });
});

describe('which Nextcloud it runs', () => {
  it('by exact version and index digest', () => {
    expect(image, 'NEXTCLOUD_IMAGE is not `nextcloud:<x.y.z>-apache@sha256:<64 hex>`').toMatch(
      /^nextcloud:\d+\.\d+\.\d+-apache@sha256:[0-9a-f]{64}$/,
    );
  });

  it('a major other than the one the integration tier, the demo and the dev stack run', () => {
    expect(defaults, `${SETUP_PATH} starts no single default Nextcloud by a literal reference`).toHaveLength(1);
    for (const { path, refs } of stacks) expect(refs.length, `${path} runs no Nextcloud`).toBeGreaterThan(0);
    const ours = majorOf(image);
    for (const ref of [...defaults, ...stacks.flatMap((s) => s.refs)]) {
      expect(Number.isFinite(majorOf(ref)), `${ref} names no major`).toBe(true);
      expect(
        majorOf(ref),
        `the leg runs ${image}, the same major as ${ref}: it proves nothing the integration job does not. ` +
          'Point it at the other supported major (the one customers may still run, or already run).',
      ).not.toBe(ours);
    }
  });
});

describe('what it runs', () => {
  const run = steps.find((s) => s.run?.includes('vitest run'));

  it('the suites the finder finds, in the integration project, without Stalwart', () => {
    expect(run, 'no step runs vitest').toBeDefined();
    expect(run!.run).toContain('node scripts/nextcloud-suites.mjs');
    expect(run!.run).toContain('--project integration');
    expect(run!.run).toContain('"${files[@]}"');
    expect(run!.env?.SKIP_STALWART).toBe('true');
    // Under `set -e`, so a finder that refuses stops the step before vitest,
    // which with no file filter would run every integration suite there is.
    expect(run!.run).toMatch(/^set -euo pipefail$/m);
    expect(run!.run).toMatch(/^suites=\$\(node scripts\/nextcloud-suites\.mjs\)$/m);
  });

  it('with a report, and a step after it that fails on a skipped test', () => {
    const report = /--outputFile\.json=(\S+)/.exec(run?.run ?? '')?.[1];
    expect(report, 'the run writes no JSON report').toBeDefined();
    const check = steps.find((s) => s.run?.includes(report!) && s !== run);
    expect(check, 'no step reads the report').toBeDefined();
    // One condition, every clause joined by `and`: an `or` anywhere lets a
    // skipped or failed test through.
    const condition = /jq -e '([^']+)'/.exec(check!.run!)?.[1] ?? '';
    expect(condition, 'the report step decides with no `jq -e` condition').not.toBe('');
    expect(condition.split(/\s+and\s+/).map((c) => c.trim())).toEqual(
      expect.arrayContaining([
        '.numTotalTests > 0',
        '.numPendingTests == 0',
        '.numTodoTests == 0',
        '.numPassedTests == .numTotalTests',
      ]),
    );
    expect(condition, 'a clause of the report condition is joined by `or`').not.toMatch(/\bor\b/);
    expect(check!.run).toMatch(/^set -euo pipefail$/m);
    expect(check!.run).toContain('exit 1');
    expect(steps.indexOf(check!)).toBeGreaterThan(steps.indexOf(run!));
  });

  it('with neither step allowed to fail quietly or be skipped', () => {
    const report = /--outputFile\.json=(\S+)/.exec(run?.run ?? '')?.[1] ?? '';
    const check = steps.find((s) => s.run?.includes(report) && s !== run);
    for (const step of [run, check]) {
      expect(step, 'the run or the report step is gone').toBeDefined();
      const keys = Object.keys(step!);
      expect(keys, `"${step!.name ?? step!.run}" carries continue-on-error, so its red is a green job`).not.toContain(
        'continue-on-error',
      );
      expect(keys, `"${step!.name ?? step!.run}" carries an if:, so it can be skipped and the job still pass`).not.toContain(
        'if',
      );
    }
    expect(Object.keys(job), 'the job carries continue-on-error').not.toContain('continue-on-error');
    expect(Object.keys(job), 'the job carries an if:').not.toContain('if');
  });
});

describe('the suites that talk to Nextcloud', () => {
  const found = nextcloudSuites(ROOT);

  it('found the WebDAV, CalDAV, CardDAV, sync, chunked-upload and share suites', () => {
    expect(found).toEqual(
      expect.arrayContaining([
        'packages/connectors/src/webdav-source.integration.test.ts',
        'packages/connectors/src/caldav-source.integration.test.ts',
        'packages/connectors/src/carddav-source.integration.test.ts',
        'packages/connectors/src/nextcloud-ocs.integration.test.ts',
        'packages/core/src/dav-sync.integration.test.ts',
        'packages/core/src/dav-update-propagation.integration.test.ts',
        'packages/engines/src/a-file-larger-than-the-servers-request-limit.integration.test.ts',
      ]),
    );
  });

  it('each reads the Nextcloud the setup exports, and none waits for Stalwart', () => {
    for (const file of found) {
      const src = read(file);
      expect(src, `${file} was found but reads no NEXTCLOUD_WEBDAV_URL`).toContain('process.env.NEXTCLOUD_WEBDAV_URL');
      expect(
        /process\.env\.STALWART_/.test(src),
        `${file} reads a STALWART_ variable, and the leg starts no Stalwart (SKIP_STALWART): that suite would skip ` +
          'there, and the report check would fail the run. Start Stalwart in the leg, or keep the suite to Nextcloud.',
      ).toBe(false);
    }
  });

  it('a file that reads no Nextcloud variable is not found', () => {
    expect(READS_NEXTCLOUD.test("const url = process.env.NEXTCLOUD_WEBDAV_URL;")).toBe(true);
    expect(READS_NEXTCLOUD.test("const url = process.env.STALWART_JMAP_URL;")).toBe(false);
    expect(READS_NEXTCLOUD.test("kind: 'nextcloud', url: NEXTCLOUD_URL")).toBe(false);
  });

  it('refuses, rather than prints nothing, when it finds none', () => {
    const empty = mkdtempSync(join(tmpdir(), 'nextcloud-suites-'));
    try {
      mkdirSync(join(empty, 'packages', 'x', 'src'), { recursive: true });
      mkdirSync(join(empty, 'apps'), { recursive: true });
      writeFileSync(join(empty, 'packages', 'x', 'src', 'y.integration.test.ts'), 'process.env.TEST_DATABASE_URL;\n');
      const said: string[] = [];
      const status = main(empty, { log: (m) => said.push(`log: ${m}`), error: (m) => said.push(`error: ${m}`) });
      expect(status).toBe(1);
      expect(said.join('\n')).toMatch(/^error: No \*\.integration\.test\.ts/);

      writeFileSync(join(empty, 'apps', 'z.integration.test.ts'), 'process.env.NEXTCLOUD_WEBDAV_URL;\n');
      said.length = 0;
      expect(main(empty, { log: (m) => said.push(m), error: (m) => said.push(m) })).toBe(0);
      expect(said).toEqual(['apps/z.integration.test.ts']);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('the setup, for an image asked for by name', () => {
  it('starts it, and checks the server that answered against its tag', () => {
    expect(setup).toContain("from './nextcloud-image.ts'");
    expect(setup).toMatch(/\(asked \? new GenericContainer\(asked\) : new GenericContainer\('nextcloud:[^']+'\)\)/);
    expect(setup).toMatch(/const notAsked = wrongServer\(asked, statusBody\);\s*if \(notAsked\) \{[\s\S]{0,120}throw new Error\(notAsked\)/);
  });

  it('fails the run when it does not start, where the default only warns', () => {
    const start = setup.indexOf('if (!skipNextcloud) {');
    const block = setup.slice(start, setup.indexOf("console.log('[Testcontainers] Skipping Nextcloud startup.');", start));
    expect(start, 'startTestEnvironment no longer starts Nextcloud where it did').toBeGreaterThan(0);
    expect(block).toMatch(/if \(asked\) \{\s*throw new Error\(`NEXTCLOUD_IMAGE asks for/);
    expect(block.indexOf('throw new Error(`NEXTCLOUD_IMAGE asks for')).toBeLessThan(block.indexOf('Continuing without Nextcloud'));
  });
});

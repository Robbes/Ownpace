// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GATE ON A VERSION NOTHING SHIPS.
 *
 * A gate answers "does what we ship work", and it can only answer for the
 * versions it actually ran. Three of this repository's gates were running a
 * version the product does not run on — two on Node, one on Postgres — with
 * nothing beside any of them saying why.
 *
 * ## Node: every `actions/setup-node` asks for the major the images run
 *
 * The api, web and selfhost images build `FROM node:24.x-slim`, `package.json`
 * declares `"engines": { "node": ">=24" }`, and eight `setup-node` steps asked
 * for `'24'`. The managed gate (`e2e-managed.yml`) and the live-target lane
 * (`e2e-live-target.yml`) asked for `22` — found 2026-09-24. The managed gate
 * stayed green, because the api, worker and web run in their own Node 24
 * containers whatever the runner has. What ran on 22 was everything that gate
 * runs on the HOST: the seed, the Trigger.dev deploy CLI and the smoke — the
 * very steps the managed bring-up guide has an operator run by hand, checked
 * on a Node below the repository's own `engines` floor. The vitest alias file
 * already records one resolver behaviour that differs between the two.
 *
 * A `setup-node` step with no `node-version` at all is refused too: it runs
 * whatever Node the runner image happens to carry, which is a version nobody
 * chose.
 *
 * ## Postgres: migration-lint replays onto the major the deployments run
 *
 * Found the same day. The `migration-lint` job in `.github/workflows/ci.yml`
 * has Atlas replay every migration into a disposable dev database named by
 * `--dev-url "docker://postgres/<major>/dev"`, and it said `16` while
 * `deploy/compose/managed.yml` and `deploy/selfhost/compose.yml` both run
 * `postgres:18` — as do the dev stack and the Testcontainers setup the
 * integration tests use. A lint that replays the chain on a server nothing
 * deploys can pass a migration the real one refuses, and refuse one it
 * accepts. (PGlite, the appliance's embedded alternative, carries its own
 * engine version inside an npm package; it is not what this compares.)
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

type Step = { uses?: string; with?: Record<string, unknown> };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

/** Every `FROM node:<major>…` line in every app image, found rather than listed. */
function imageNodeMajors(): ReadonlyArray<{ image: string; major: number }> {
  return readdirSync(join(REPO_ROOT, 'apps'))
    .map((app) => `apps/${app}/Dockerfile`)
    .filter((p) => existsSync(join(REPO_ROOT, p)))
    .flatMap((image) =>
      [...read(image).matchAll(/^FROM\s+node:(\d+)[.\-@\s]/gm)].map((m) => ({ image, major: Number(m[1]) })),
    );
}

/** Every `actions/setup-node` step in every workflow, with what it asks for. */
function setupNodeSteps(): ReadonlyArray<{ where: string; version: string | undefined }> {
  return readdirSync(join(REPO_ROOT, '.github/workflows'))
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .flatMap((file) => {
      const workflow = parseYaml(read(`.github/workflows/${file}`)) as Workflow;
      return Object.entries(workflow.jobs ?? {}).flatMap(([job, { steps }]) =>
        (steps ?? [])
          .filter((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/setup-node@'))
          .map((s) => {
            const version = s.with?.['node-version'];
            return {
              where: `.github/workflows/${file} job ${job}`,
              version: version === undefined ? undefined : String(version),
            };
          }),
      );
    });
}

/**
 * The two workflows that asked for 22. Named so a scan that stops finding
 * them fails here instead of passing on less.
 */
const ANCHORS = ['.github/workflows/e2e-managed.yml', '.github/workflows/e2e-live-target.yml'];

describe('every gate runs the Node major the images ship', () => {
  const images = imageNodeMajors();
  const steps = setupNodeSteps();

  it('found the images and the steps', () => {
    // Vacuity guard: a Dockerfile rewritten past the regex, or a workflow
    // layout the walk no longer understands, would pass everything below.
    expect(images.map((i) => i.image)).toEqual(
      expect.arrayContaining(['apps/api/Dockerfile', 'apps/selfhost/Dockerfile']),
    );
    for (const anchor of ANCHORS) {
      expect(
        steps.some((s) => s.where.startsWith(`${anchor} `)),
        `no setup-node step found in ${anchor}`,
      ).toBe(true);
    }
  });

  it('the images agree with each other on one major', () => {
    const majors = new Set(images.map((i) => i.major));
    expect([...majors], images.map((i) => `${i.image}: node ${i.major}`).join('; ')).toHaveLength(1);
  });

  it('every setup-node step names a version, and it is that major', () => {
    const shipped = images[0]!.major;
    const wrong = steps
      .filter((s) => s.version === undefined || Number(/^\d+/.exec(s.version)?.[0]) !== shipped)
      .map((s) => `${s.where}: node-version ${s.version ?? '(none — the runner image decides)'}`);
    expect(
      wrong,
      `the images run Node ${shipped}; a gate on another major checks something nothing ships`,
    ).toEqual([]);
  });
});

/** The two deployments, and the Postgres server image each one runs. */
const DEPLOYMENTS = ['deploy/compose/managed.yml', 'deploy/selfhost/compose.yml'];

describe('migration-lint replays onto the Postgres major the deployments run', () => {
  const deployed = DEPLOYMENTS.flatMap((file) =>
    [...read(file).matchAll(/^\s*image:\s*postgres:(\d+)[.\-@]/gm)].map((m) => ({ file, major: Number(m[1]) })),
  );
  const linted = [...read('.github/workflows/ci.yml').matchAll(/--dev-url\s+"docker:\/\/postgres\/(\d+)\//g)].map(
    (m) => Number(m[1]),
  );

  it('found the deployments and the lint', () => {
    // Vacuity guard: an image line or a dev-url rewritten past these regexes
    // would pass everything below on nothing.
    for (const file of DEPLOYMENTS) {
      expect(deployed.some((d) => d.file === file), `no postgres image found in ${file}`).toBe(true);
    }
    expect(linted.length, 'no --dev-url "docker://postgres/<major>/…" found in ci.yml').toBeGreaterThan(0);
  });

  it('the deployments agree on one major', () => {
    const majors = new Set(deployed.map((d) => d.major));
    expect([...majors], deployed.map((d) => `${d.file}: postgres ${d.major}`).join('; ')).toHaveLength(1);
  });

  it('every dev database Atlas lints against is that major', () => {
    const shipped = deployed[0]!.major;
    expect(
      linted.filter((major) => major !== shipped),
      `the deployments run postgres ${shipped}; migration-lint replays the chain on another major`,
    ).toEqual([]);
  });
});

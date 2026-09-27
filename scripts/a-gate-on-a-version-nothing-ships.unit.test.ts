// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GATE ON A VERSION NOTHING SHIPS.
 *
 * A gate answers "does what we ship work", and it can only answer for the
 * versions it actually ran. Three of this repository's gates were running a
 * version the product does not run on — two on Node, one on Postgres — with
 * nothing beside any of them saying why. And one part of the product, the
 * managed tasks, ran a Node that no gate runs.
 *
 * ## Node: every `actions/setup-node` asks for the major the images run
 *
 * The api, web and selfhost images build `FROM node:24.x-slim`, `package.json`
 * declares `"engines": { "node": ">=24" }`, and eight `setup-node` steps asked
 * for `'24'`. The managed gate (`e2e-managed.yml`) and the live-target lane
 * (`e2e-live-target.yml`) asked for `22` — found 2026-09-24. The managed gate
 * stayed green, because the api runs in its own Node 24 image (and the web is
 * built in one) whatever the runner has. What ran on 22 was everything that
 * gate runs on the HOST: the seed, the Trigger.dev deploy CLI and the smoke —
 * the very steps the managed bring-up guide has an operator run by hand,
 * checked on a Node below the repository's own `engines` floor. The vitest
 * alias file already records one resolver behaviour that differs between the
 * two.
 *
 * A `setup-node` step with no `node-version` at all is refused too: it runs
 * whatever Node the runner image happens to carry, which is a version nobody
 * chose.
 *
 * ## Node: the tasks' runtime is the major the images run
 *
 * The other way round: something that ships, on a version no gate runs. The
 * managed worker's task image comes from no Dockerfile here. The Trigger.dev
 * CLI builds it, on the base image of the `runtime` that the worker's deploy
 * config (apps/worker/trigger.config.ts) names. The config named none, so the
 * CLI took its default `node`, which in the 4.5.16 CLI the deploy runs is
 * `triggerdotdev/node:21-bookworm`: the tasks, which hold every tenant's
 * credentials while they run, ran Node 21, and no workflow or Dockerfile
 * stated it. The `node:zlib` `crc32` import that
 * `a-checksum-the-runtime-did-not-have` records is what it cost (workplan 0146
 * T6).
 *
 * So the config names `runtime: 'node-<N>'`, N being the images' one major, and
 * this block holds it there. It imports the config and reads the value the CLI
 * reads, not the file's text: a line inside a block comment, or a second key
 * that overrides the first, reads one way as text and another to the CLI. It
 * also hands the value to the pinned `@trigger.dev/core`'s
 * `resolveBuildRuntime`, the function the CLI calls on it, so a major the
 * pinned CLI has no base image for fails here, not on the nightly deploy. The
 * import also brings trigger.config.ts under `pnpm typecheck`, which did not
 * read it before: the root tsconfig takes each app's `src` and `scripts`, and
 * the config sits beside `src`.
 *
 * What this does not prove: that the deploy then builds on that image (the
 * nightly managed gate's task deploy does, and its build output names the base
 * image), or that the task bundle loads on it (0146 T6's second guard).
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
import { resolveBuildRuntime } from '@trigger.dev/core/v3/build';
import taskConfig from '../apps/worker/trigger.config.ts';

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

/**
 * The two deployments. What is compared is each one's `postgres` service, the
 * server the migrations run on. managed.yml's `trigger-db` is Trigger.dev's own
 * database, never sees these migrations, and is not held to the same major.
 */
const DEPLOYMENTS = ['deploy/compose/managed.yml', 'deploy/selfhost/compose.yml'];

describe('migration-lint replays onto the Postgres major the deployments run', () => {
  const deployed = DEPLOYMENTS.flatMap((file) => {
    const image = (parseYaml(read(file)) as { services?: { postgres?: { image?: unknown } } }).services?.postgres
      ?.image;
    const m = typeof image === 'string' ? /^postgres:(\d+)[.\-@]/.exec(image) : null;
    return m ? [{ file, major: Number(m[1]) }] : [];
  });
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

/**
 * The worker's deploy config. The Trigger.dev CLI loads it and builds the task
 * image on the base image of the `runtime` it names. Imported above; the path
 * is for the messages.
 */
const TASK_CONFIG = 'apps/worker/trigger.config.ts';

describe('the tasks run the Node major the images ship', () => {
  const images = imageNodeMajors();
  // The evaluated value, as the CLI reads it (`config.runtime` in the pinned
  // CLI's config loader). Typed `unknown` so the cases below say what a wrong
  // value is rather than the compiler narrowing it away.
  const runtime: unknown = taskConfig.runtime;

  it('the worker deploy config names a runtime', () => {
    // Absent, the CLI takes the server project's default, or else its own
    // `node`, which in the pinned 4.5.16 CLI is triggerdotdev/node:21-bookworm.
    expect(
      runtime,
      `${TASK_CONFIG} names no runtime, so the task image's Node is whatever the server project or the CLI defaults to`,
    ).toBeDefined();
  });

  it("that runtime is node-<the images' major>", () => {
    const shipped = images[0]!.major;
    expect(
      runtime,
      `the images run Node ${shipped}; the tasks, which hold every tenant's credentials while they run, must too`,
    ).toBe(`node-${shipped}`);
  });

  it('the pinned Trigger.dev core accepts it as it stands, not as a deprecated alias', () => {
    // `resolveBuildRuntime` is what the CLI calls on this value. It throws on
    // a runtime the pinned version has no base image for, and maps a
    // deprecated alias to its replacement. The config's type allows only
    // the runtimes the pinned SDK knows, but this case does not rest on the
    // typecheck having run: a major the CLI cannot build fails here, not on
    // the nightly deploy.
    expect(resolveBuildRuntime(runtime)).toBe(runtime);
  });
});

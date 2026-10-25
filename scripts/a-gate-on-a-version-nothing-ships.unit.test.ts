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
 * The three app images build `FROM node:24.x-trixie-slim`, `package.json`
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
 * ## Node: and the newest release of that major, on a runner that keeps its cache
 *
 * The right major was not enough. With `check-latest` left at its default,
 * false, setup-node takes the first `24.x` it finds in the runner's own tool
 * cache. A GitHub-hosted runner gets a fresh image every week; the Spark's
 * self-hosted runner keeps its cache for ever. Its jobs logged `check-latest:
 * false`, `Found in cache @ …/_tool/node/24.18.0/arm64` and `node: v24.18.0`
 * on 2026-10-21 (E2E (managed) #262 and the unit-tests job of the same day's
 * push run), while the images built `FROM node:24.22.0-slim` and 24.18.1
 * (2026-07-28) and 24.22.1 (2026-10-20) were security releases. Every
 * push-to-main job and every nightly gate on the Spark ran four minors behind
 * what ships and two security releases behind the newest 24.x, and nothing
 * would ever have moved it. So every `setup-node` step says `check-latest:
 * true`, the hosted ones too: it costs them a few seconds at most, and one rule
 * is simpler to hold than "the steps whose `runs-on` can land on the Spark". If
 * the version manifest cannot be reached, setup-node logs it and falls back to
 * the cache, so the flag cannot fail a job.
 *
 * Security Scan had no `setup-node` step at all, so none of this saw it: it ran
 * the Spark's apt Node on main and the hosted image's default elsewhere, and
 * installed pnpm by piping get.pnpm.io's script into `sh` with no version, into
 * the runner user's own pnpm home (found 2026-10-21). It now sets up pnpm and
 * Node like every other job, and STEP_ANCHORS below names it, so a scan job
 * that loses its `setup-node` again fails here instead of escaping the walk.
 *
 * ## Trivy: the scan names the engine it runs
 *
 * The same scan had the same shape one step further down. trivy-action
 * installs the Trivy its `version` input names, and with none it installs the
 * default compiled into the action: v0.70.0 (2026-04-17) at the pinned v0.36.0,
 * six months behind on 2026-10-21. Dependabot moves the action, never that
 * default, and the vulnerability database updating daily does not move the
 * engine that parses lockfiles and matches against it. It is the `setup-node`
 * step with no `node-version` again: a version nobody chose. So every
 * trivy-action (or setup-trivy) step in every workflow names an exact release,
 * `vX.Y.Z`, not `latest`, and a second scan step added later is held to it too.
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
 * ## Node: the tasks run the API image's Node, not the base image's
 *
 * The right major was not enough here either. The base image the CLI names for
 * `node-24`, `triggerdotdev/node:24-bookworm@sha256:d2d0c018…`, is Node
 * 24.18.0 on a Debian snapshot of 2026-07-13, in every CLI from 4.7.2 to 4.7.6:
 * below the security releases 24.18.1 (2026-07-28) and 24.22.1 (2026-10-20),
 * while the API image moved to 24.22.1 the day after it shipped. The tasks hold
 * every tenant's mailbox and calendar credentials during a pass and are HTTPS
 * clients, and nothing moved their Node: Dependabot ignores `@trigger.dev/*`,
 * and upstream rebuilt that image only when it chose to (issue #1669, the pin
 * watch's record of it).
 *
 * So the deploy config adds one layer, for every target but `trigger dev`,
 * that copies the Node binary out of the very image `apps/api/Dockerfile`
 * builds FROM over the base image's, and refreshes the base image's Debian
 * packages. Dependabot moves that FROM line every week, and the tasks move
 * with it. This block holds the layer to that line exactly: it runs the
 * config's own extension with a stand-in build context and compares the
 * instruction with the image this file reads from the Dockerfile itself, and
 * it checks that `trigger dev`, which builds no image, gets no layer. It also
 * holds that the pin watch's `TASK_OVERLAY` finds the layer in the config's
 * text exactly once, because that is how the watch knows to stop reporting
 * the base image's Node.
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
import type { BuildContext, BuildLayer } from '@trigger.dev/core/v3/build';
import { TASK_OVERLAY } from './idp-pin-watch.mjs';
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
function setupNodeSteps(): ReadonlyArray<{ where: string; version: string | undefined; checkLatest: unknown }> {
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
              // As the YAML parser hands it over: `check-latest: true` is the
              // boolean true, and anything else (absent, 'false', a quoted
              // 'true') is refused below.
              checkLatest: s.with?.['check-latest'],
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

/**
 * Every `setup-node` step there is, by workflow and job: the nine that can run
 * on the Spark (ci.yml's five on a push, the four E2E lanes), the three that
 * run on hosted runners only, and Security Scan's. Named rather than counted,
 * so a walk that stops seeing one fails here and says which, while a new
 * workflow's step needs no number raised (it is still held to everything
 * below).
 */
const STEP_ANCHORS = [
  '.github/workflows/ci.yml job docs-hygiene',
  '.github/workflows/ci.yml job lint',
  '.github/workflows/ci.yml job unit-tests',
  '.github/workflows/ci.yml job ui-tests',
  '.github/workflows/ci.yml job integration-tests',
  '.github/workflows/e2e-managed.yml job e2e-managed',
  '.github/workflows/e2e.yml job e2e-selfhost',
  '.github/workflows/e2e-o365.yml job e2e-o365',
  '.github/workflows/e2e-live-target.yml job live-target',
  '.github/workflows/exposure-probe.yml job probe',
  '.github/workflows/idp-pin-watch.yml job watch',
  '.github/workflows/windows-payload.yml job build',
  '.github/workflows/security-scan.yml job security-scan',
];

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
    const missing = STEP_ANCHORS.filter((where) => !steps.some((s) => s.where === where));
    expect(
      missing,
      'setup-node steps the walk no longer finds (a job without one runs whatever Node the runner has)',
    ).toEqual([]);
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

  it('every setup-node step asks for the newest release of it, not the first one in the cache', () => {
    const cached = steps
      .filter((s) => s.checkLatest !== true)
      .map(
        (s) =>
          `${s.where}: check-latest ${s.checkLatest === undefined ? '(absent, so false)' : JSON.stringify(s.checkLatest)}`,
      );
    expect(
      cached,
      'without `check-latest: true` setup-node takes the first matching version in the tool cache, and the ' +
        "self-hosted runner's cache is never refreshed: the Spark ran 24.18.0 for months while the images moved on",
    ).toEqual([]);
  });
});

/** Every step that installs Trivy, in every workflow, with the version it names. */
function trivySteps(): ReadonlyArray<{ where: string; version: unknown }> {
  return readdirSync(join(REPO_ROOT, '.github/workflows'))
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .flatMap((file) => {
      const workflow = parseYaml(read(`.github/workflows/${file}`)) as Workflow;
      return Object.entries(workflow.jobs ?? {}).flatMap(([job, { steps }]) =>
        (steps ?? [])
          .filter((s) => typeof s.uses === 'string' && /^aquasecurity\/(trivy-action|setup-trivy)@/.test(s.uses))
          .map((s) => ({ where: `.github/workflows/${file} job ${job}`, version: s.with?.['version'] })),
      );
    });
}

describe('every Trivy the scans run is one somebody named', () => {
  const steps = trivySteps();

  it('found the scan', () => {
    // Vacuity guard: a renamed action or job would pass the case below on nothing.
    expect(
      steps.some((s) => s.where === '.github/workflows/security-scan.yml job security-scan'),
      'no trivy-action step found in security-scan.yml job security-scan',
    ).toBe(true);
  });

  it('every Trivy step names an exact release, not the action default or latest', () => {
    const unnamed = steps
      .filter((s) => typeof s.version !== 'string' || !/^v\d+\.\d+\.\d+$/.test(s.version))
      .map(
        (s) =>
          `${s.where}: version ${s.version === undefined ? "(absent, so the action's default)" : JSON.stringify(s.version)}`,
      );
    expect(
      unnamed,
      'without `version: vX.Y.Z` trivy-action installs the default compiled into it (v0.70.0 at v0.36.0), and ' +
        'Dependabot moves the action, never that default',
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

/** The image `apps/api/Dockerfile` builds FROM, read here on its own: a Node image by tag and digest. */
const API_DOCKERFILE = 'apps/api/Dockerfile';
const API_NODE = /^FROM\s+(node:\S+)/m.exec(read(API_DOCKERFILE))?.[1];

/** The config's own extension run with a stand-in context, as the CLI runs it: start, then complete. */
async function layersFor(target: BuildContext['target']): Promise<BuildLayer[]> {
  const extension = (taskConfig.build?.extensions ?? []).find((e) => e.name === 'task-node');
  if (!extension) throw new Error(`${TASK_CONFIG} has no task-node build extension`);
  const layers: BuildLayer[] = [];
  const context = {
    target,
    workingDir: join(REPO_ROOT, 'apps/worker'),
    addLayer: (layer: BuildLayer) => layers.push(layer),
  } as unknown as BuildContext;
  await extension.onBuildStart?.(context);
  await extension.onBuildComplete?.(context, {} as Parameters<NonNullable<typeof extension.onBuildComplete>>[1]);
  return layers;
}

describe("the tasks run the API image's Node", () => {
  it('the API image builds FROM a Node image pinned by tag and digest', () => {
    // Vacuity guard: a FROM line the regex no longer reads would leave
    // nothing below to compare with.
    expect(API_NODE, `${API_DOCKERFILE} has no FROM node:… line`).toMatch(/^node:\d+\.\d+\.\d+[^@\s]*@sha256:[0-9a-f]{64}$/);
  });

  it("a deploy's image copies that image's Node over the base image's, and refreshes its packages", async () => {
    const layers = await layersFor('deploy');
    expect(layers, 'one layer, from the task-node extension').toHaveLength(1);
    expect(layers[0]!.id).toBe('task-node');
    expect(layers[0]!.image?.instructions).toEqual([
      `COPY --from=${API_NODE} /usr/local/bin/node /usr/local/bin/node`,
      'RUN apt-get update && apt-get -y upgrade && apt-get clean && rm -rf /var/lib/apt/lists/*',
    ]);
  });

  it('`trigger dev` builds no image, and gets no layer', async () => {
    expect(await layersFor('dev')).toEqual([]);
  });

  it("the pin watch finds the layer in the config's text, exactly once", () => {
    // `taskNodeRow` stops reporting the base image's Node when this matches,
    // and its own guard takes the first match out to see the row report again.
    const text = read(TASK_CONFIG);
    expect(text.match(new RegExp(TASK_OVERLAY.source, 'g')) ?? []).toHaveLength(1);
  });
});

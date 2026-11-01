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
 * The three app images built `FROM node:24.x-trixie-slim`, `package.json`
 * declared `"engines": { "node": ">=24" }`, and eight `setup-node` steps asked
 * for `'24'`. (All three moved to 26 together on 2026-10-31, with the API's
 * distroless runtime, the tasks' runtime and all 27 `setup-node` steps, when
 * Node 26 was LTS: workplan 0119 §2.4. This file is why they move in one
 * pull request: a pin left on 24 fails here, `engines` among them since
 * 2026-11-01. Until then nothing here read `engines`, and the move's own
 * review found `>=24` passing every case beside images on 26.) The managed gate
 * (`e2e-managed.yml`) and the live-target lane (`e2e-live-target.yml`) asked
 * for `22` — found 2026-09-24. The managed gate
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
 * So is a step that runs Node, pnpm, npm or npx with no `setup-node` step
 * before it in its job: the same version nobody chose, and one the walk over
 * `setup-node` steps cannot see, since there is no step to walk. Found
 * 2026-11-01 in the Node 26 move's review: ci.yml's `commit-convention` and
 * images.yml's `build` (its release check, on a tag) had no `setup-node` at
 * all, and the release checks of `security-scan` and windows-payload's
 * `build` ran before theirs. Each now sets Node up first; the three release
 * checks' come before the checkout, since a-release-that-names-itself holds
 * the check straight after it.
 *
 * `engines` in the root `package.json` (the one package here that declares
 * it) names the same major, as `>=<major>`. It is what a host that runs the
 * steps by hand is told: live's deploy runs `pnpm install`, the task deploy
 * and the site build on the host's own Node, and pnpm compares that Node with
 * `engines`.
 *
 * deploy-live.sh and stand-up-live.sh read that `engines.node` themselves, to
 * refuse a host Node below it (`release_tag_node` in
 * `deploy/compose/release-tag.sh`), and read it without node, since node may
 * be what is wrong. Such a read can disagree with JSON.parse: #1767's third
 * review found an `engines` nested under another key, or an object inside
 * `engines`, read as asking for no node. The script refuses those shapes as
 * unread now; this file holds the root `package.json` to one it reads, and
 * runs the script's own read on it to say the same `engines.node` as
 * JSON.parse, so the two cannot drift apart without failing here.
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
 * watch's record of it). CLI 4.7.7, 4.8.1 and 4.8.3 name a rebuild on 24.22.1
 * (`…@sha256:3cdc8242…`), which is when upstream chose to.
 *
 * From #1689 the deploy config copied the Node binary out of the very image
 * `apps/api/Dockerfile` builds FROM over the base image's. Since workplan
 * 0146 T14 it builds the tasks on that image itself: for every target but
 * `trigger dev`, its extension sets the build manifest's `image.base` to the
 * FROM line's image, so the tasks run that image's own Node and Debian, and
 * Dependabot's move of the line is the only way either moves. (Since 0146
 * T13 that FROM line is the API's BUILD stage: the API runs on distroless,
 * whose `/nodejs/bin/node` was the same file, byte for byte, on both
 * architectures when T13 pinned it. The two pins move separately, the Node
 * tag and the distroless digest, on the one major the next block holds, and
 * the managed smoke's preflights stop when the API container's Node is not
 * this line's x.y.z: `an-api-image-with-nothing-to-exec`, section 5.) On a
 * base of its own the CLI adds nothing to the image, so the extension's one layer
 * brings what the runtime uses: dumb-init (the image's ENTRYPOINT) and
 * Debian's `ca-certificates`, with the trust edits the CLI makes to its own
 * images (four roots distrusted, eight intermediates rejected, Node on the
 * OpenSSL store). It drops every package manager from the runtime stage,
 * where nothing runs one, and names the CLI's own build image for the build
 * stage, where the CLI runs `npm i`: a base of our own with a layer would
 * otherwise make the CLI build that stage FROM the runtime base.
 *
 * This block runs the config's own extension with a stand-in build context
 * and manifest, as the CLI does, and holds what it sets: the base to the image
 * this file reads from the Dockerfile itself, the build stage to the CLI's
 * image for the same major, the packages to the two the runtime uses, the
 * trust edits to the CLI 4.8.3 list, the vendored intermediates to the CLI's
 * bytes, and the removal to a stage with no C++ compiler. It checks that
 * `trigger dev`, which builds no image, gets nothing, and that no instance
 * setting (`DEPLOY_BASE_IMAGES`) can override the config's base. It fails when
 * the deploying CLI's version leaves the one the build image and the trust
 * list were read from, naming what to read again: nothing else would say that
 * a later CLI distrusts more than this keeps. And it holds
 * that the pin watch's `TASK_ON_API_IMAGE` finds the base in the config's text
 * exactly once, because that is how the watch knows to stop reporting the
 * CLI's base image's Node.
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
 *
 * The major was right and the build still floated (workplan 0119,
 * 2026-11-01): `docker://postgres/18/dev` is Docker Hub's `18`, Debian, a
 * different build every time upstream rebuilt it, while the stacks build on
 * `postgres:18.6-alpine` by its index digest. So the dev URL names that base
 * itself, tag and digest (Atlas's docker driver hands the whole tag to `docker
 * run`), and this holds it to `deploy/compose/postgres/Dockerfile`'s FROM: a
 * Dependabot pull request that moves the FROM fails here, printing the `sed`
 * that moves the dev URL with it.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash, X509Certificate } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { resolveBuildRuntime } from '@trigger.dev/core/v3/build';
import type { BuildContext, BuildExtension, BuildLayer } from '@trigger.dev/core/v3/build';
import { TASK_ON_API_IMAGE, dockerfileBase } from './idp-pin-watch.mjs';
import taskConfig from '../apps/worker/trigger.config.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

type Step = { uses?: string; run?: string; name?: string; with?: Record<string, unknown> };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

/**
 * Every `FROM node:<major>…` line in every app image, found rather than listed,
 * and every `FROM gcr.io/distroless/nodejs<major>-…` line: the API's runtime
 * stage since 0146 T13, which names its Node major in the image's name.
 */
function imageNodeMajors(): ReadonlyArray<{ image: string; major: number }> {
  return readdirSync(join(REPO_ROOT, 'apps'))
    .map((app) => `apps/${app}/Dockerfile`)
    .filter((p) => existsSync(join(REPO_ROOT, p)))
    .flatMap((image) =>
      [...read(image).matchAll(/^FROM\s+(?:node:|gcr\.io\/distroless\/nodejs)(\d+)[.\-@\s]/gm)].map((m) => ({ image, major: Number(m[1]) })),
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
 * A shell line that starts Node, pnpm, npm or npx: at the start of a line, or
 * after `;`, `&`, `|`, `(`, `$(`, `then`, `do` or `else`. A `node` handed to
 * `docker run` or `docker compose exec` is an argument, not a command, and
 * runs in the container's own Node, so it does not count.
 */
const RUNS_NODE = /(?:^|[;&|(]|\$\(|\b(?:then|do|else)\b)\s*(?:node|pnpm|npm|npx)(?=\s|$)/m;

/**
 * Every step, in every job of every workflow, that runs Node with no
 * `setup-node` step before it in the same job.
 */
function nodeBeforeSetupNode(): ReadonlyArray<string> {
  return readdirSync(join(REPO_ROOT, '.github/workflows'))
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .flatMap((file) => {
      const workflow = parseYaml(read(`.github/workflows/${file}`)) as Workflow;
      return Object.entries(workflow.jobs ?? {}).flatMap(([job, { steps }]) => {
        const all = steps ?? [];
        const setupAt = all.findIndex((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/setup-node@'));
        return all.flatMap((s, i) =>
          typeof s.run === 'string' && RUNS_NODE.test(s.run) && (setupAt === -1 || setupAt > i)
            ? [`.github/workflows/${file} job ${job}, step ${i + 1} (${s.name ?? s.run.trim().split('\n')[0]})`]
            : [],
        );
      });
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
 * run on hosted runners only, Security Scan's, and the two added 2026-11-01
 * to jobs that ran Node without one (ci.yml's `commit-convention`, images.yml's
 * `build`). Named rather than counted,
 * so a walk that stops seeing one fails here and says which, while a new
 * workflow's step needs no number raised (it is still held to everything
 * below).
 */
const STEP_ANCHORS = [
  '.github/workflows/ci.yml job commit-convention',
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
  '.github/workflows/images.yml job build',
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
    // The API's two: the Node image it builds on, and the distroless one it
    // runs on (0146 T13). Both are held to the one major below.
    expect(images.filter((i) => i.image === 'apps/api/Dockerfile')).toHaveLength(2);
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

  it('package.json engines asks for that major, so a host running the steps by hand is told the Node the gates ran', () => {
    const { engines } = JSON.parse(read('package.json')) as { engines?: { node?: unknown } };
    expect(
      engines?.node,
      `the images run Node ${images[0]!.major}; package.json's engines.node must be ">=${images[0]!.major}"`,
    ).toBe(`>=${images[0]!.major}`);
  });

  it("the deploy's own read of the root package.json, without node, finds the engines.node JSON.parse does", () => {
    const text = read('package.json');
    const { engines } = JSON.parse(text) as { engines?: Record<string, unknown> };
    expect(text.match(/"engines"\s*:/g), 'one "engines" key in the file, the root one').toHaveLength(1);
    expect(
      Object.entries(engines ?? {}).filter(([, v]) => typeof v !== 'string'),
      'every engines value a plain string',
    ).toEqual([]);
    // release_tag_node on a commit of this package.json, with a node on the
    // PATH that says the images' major: it must pass and name what JSON.parse reads.
    const root = mkdtempSync(join(tmpdir(), 'engines-read-'));
    try {
      const repo = join(root, 'repo');
      const bin = join(root, 'bin');
      mkdirSync(repo);
      mkdirSync(bin);
      writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash\necho 'v${images[0]!.major}.0.0'\n`);
      chmodSync(join(bin, 'node'), 0o755);
      writeFileSync(join(repo, 'package.json'), text);
      const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
      for (const args of [['init', '-q'], ['add', 'package.json'], ['commit', '-q', '-m', 'package.json']]) {
        const g = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: gitEnv });
        expect(g.status, `git ${args.join(' ')}: ${g.stderr}`).toBe(0);
      }
      const r = spawnSync(
        'bash',
        ['-c', '. "$1"; if release_tag_node "$2" v0 HEAD; then printf "%s\\n" "$RELEASE_TAG_NODE"; else printf "%s\\n" "${RELEASE_TAG_WHY[@]}"; exit 1; fi', 'read', join(REPO_ROOT, 'deploy/compose/release-tag.sh'), repo],
        { encoding: 'utf8', env: { ...gitEnv, PATH: `${bin}:${process.env.PATH ?? ''}` } },
      );
      expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
      expect(r.stdout).toContain(`v0 asks for ${String(engines?.node)} (engines in its package.json)`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('no job runs Node before a setup-node step has named it', () => {
    // Vacuity guard: the pattern still sees a plain `node scripts/…` line and
    // the forms after `&&` and `$(`, and not an argument to `docker`.
    for (const line of ['node scripts/x.mjs', 'cd a && pnpm install', 'echo "$(npx y)"', 'if x; then npm ci; fi']) {
      expect(RUNS_NODE.test(line), line).toBe(true);
    }
    for (const line of ['docker compose exec api node -e 1', 'echo nodejs', 'apt-get install -y nodejs']) {
      expect(RUNS_NODE.test(line), line).toBe(false);
    }
    expect(
      nodeBeforeSetupNode(),
      'these run whatever Node the runner image carries, a version nobody chose: put the setup-node step first',
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

/** The managed stacks' Postgres build, whose FROM is the dev database migration-lint replays onto. */
const STACKS_POSTGRES = 'deploy/compose/postgres/Dockerfile';

/**
 * What is wrong with ci.yml's dev databases, against the FROM of the
 * Dockerfile the stacks build their Postgres from: each must be that base's
 * tag and index digest, and there must be one. Empty when right.
 */
function devUrlFaults(ci: string, dockerfile: string): string[] {
  const base = dockerfileBase(dockerfile);
  if (base.repo !== 'postgres') return [`${STACKS_POSTGRES} builds on ${base.ref}, not the official postgres image`];
  const pinned = `${base.tag}@${base.digest}`;
  const tags = [...ci.matchAll(/--dev-url\s+"docker:\/\/postgres\/([^/"\s]+)\/[^"]*"/g)].map((m) => m[1]!);
  if (tags.length === 0) return ['ci.yml names no --dev-url "docker://postgres/…"'];
  return tags
    .filter((tag) => tag !== pinned)
    .map(
      (tag) =>
        `migration-lint's dev database postgres:${tag} is not ${STACKS_POSTGRES}'s FROM (${base.ref}). Move it with: ` +
        `sed -i 's#docker://postgres/[^/"]*/dev#docker://postgres/${pinned}/dev#' .github/workflows/ci.yml`,
    );
}

describe('migration-lint replays onto the Postgres major the deployments run', () => {
  const deployed = DEPLOYMENTS.flatMap((file) => {
    const image = (parseYaml(read(file)) as { services?: { postgres?: { image?: unknown } } }).services?.postgres
      ?.image;
    // managed.yml's is the build `localhost/postgres:18.6-alpine-<hash>` since
    // 0146 T15, whose tag starts with its base's.
    const m = typeof image === 'string' ? /^(?:localhost\/)?postgres:(\d+)[.\-@]/.exec(image) : null;
    return m ? [{ file, major: Number(m[1]) }] : [];
  });
  // The tag part of each dev URL: `18.6-alpine@sha256:…` since 2026-11-01, `18` before.
  const devTags = [...read('.github/workflows/ci.yml').matchAll(/--dev-url\s+"docker:\/\/postgres\/(\d[^/"\s]*)\/[^"]*"/g)].map((m) => m[1]!);
  const linted = devTags.map((tag) => Number(/^\d+/.exec(tag)![0]));

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

  it('every dev database is the image the stacks build on, by tag and digest (0119, 2026-11-01)', () => {
    expect(devUrlFaults(read('.github/workflows/ci.yml'), read(STACKS_POSTGRES))).toEqual([]);
  });

  it('refuses a dev URL that floats, or names another build than the stacks run, each by a mutation of the real line', () => {
    const ci = read('.github/workflows/ci.yml');
    const base = dockerfileBase(read(STACKS_POSTGRES));
    const pinned = `${base.tag}@${base.digest}`;
    expect(ci, `ci.yml's dev URL is not docker://postgres/${pinned}/dev`).toContain(`docker://postgres/${pinned}/dev`);
    for (const tag of ['18', '18-alpine', base.tag, `18.6@${base.digest}`, `${base.tag}@sha256:${'0'.repeat(64)}`]) {
      const faults = devUrlFaults(ci.replace(`docker://postgres/${pinned}/dev`, `docker://postgres/${tag}/dev`), read(STACKS_POSTGRES));
      expect(faults.join('\n'), tag).toMatch(/is not deploy\/compose\/postgres\/Dockerfile's FROM .*sed -i/);
    }
    // And the other way round: the FROM moved by Dependabot, the dev URL left behind.
    const moved = read(STACKS_POSTGRES).replace(base.digest, `sha256:${'1'.repeat(64)}`);
    expect(devUrlFaults(ci, moved).join('\n')).toMatch(new RegExp(`docker://postgres/${base.tag}@sha256:${'1'.repeat(64)}/dev`));
    // No dev URL at all is not a pass.
    expect(devUrlFaults(ci.replaceAll('--dev-url', '--url'), read(STACKS_POSTGRES))).toEqual(['ci.yml names no --dev-url "docker://postgres/…"']);
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

/** The extension's name, which is also its one layer's id. */
const TASK_BASE = 'task-base';

type BuildManifest = Parameters<NonNullable<BuildExtension['onBuildComplete']>>[1];

/**
 * The config's own extension run with a stand-in context and manifest, as the
 * CLI runs it: start, then complete, the manifest handed to the second and
 * read back after it, which is where the CLI takes `image.base` from.
 */
async function buildFor(target: BuildContext['target']): Promise<{ layers: BuildLayer[]; manifest: BuildManifest }> {
  const extension = (taskConfig.build?.extensions ?? []).find((e) => e.name === TASK_BASE);
  if (!extension) throw new Error(`${TASK_CONFIG} has no ${TASK_BASE} build extension`);
  const layers: BuildLayer[] = [];
  const context = {
    target,
    workingDir: join(REPO_ROOT, 'apps/worker'),
    addLayer: (layer: BuildLayer) => layers.push(layer),
  } as unknown as BuildContext;
  const manifest = { image: { pkgs: [], instructions: [] } } as unknown as BuildManifest;
  await extension.onBuildStart?.(context);
  await extension.onBuildComplete?.(context, manifest);
  return { layers, manifest };
}

/** The deploy's one layer's instructions. */
async function deployInstructions(): Promise<string[]> {
  const { layers } = await buildFor('deploy');
  expect(layers.map((l) => l.id), `one layer, from the ${TASK_BASE} extension`).toEqual([TASK_BASE]);
  return layers[0]!.image?.instructions ?? [];
}

/** The one instruction that matches, or a failure naming what was looked for. */
function only(instructions: string[], what: RegExp): string {
  const found = instructions.filter((i) => what.test(i));
  expect(found, `exactly one instruction matches ${what}`).toHaveLength(1);
  return found[0]!;
}

/**
 * What trigger.dev 4.8.3 does to its own images' trust store, as 4.8.1 did
 * (`dist/esm/deploy/buildImage.js`, `distrustCompromisedRoots`), which it
 * leaves out of a stage on a base of one's own (`trustStoreHardening`).
 */
const CLI_DISTRUSTED_ROOTS = ['emSign_ECC_Root_CA_-_G3', 'emSign_Root_CA_-_C1', 'emSign_ECC_Root_CA_-_C3', 'Comodo_AAA_Services_root'];
const CLI_REJECT_DIR = '/usr/local/share/ca-certificates/emsign-block';
/**
 * SHA-256 of the eight `EMSIGN_COMPROMISE_REJECTED_INTERMEDIATES` of
 * trigger.dev 4.8.3 (`dist/esm/deploy/emsignRejectedIntermediates.js`, the same
 * file as 4.8.1's), each as the CLI writes it (its `pemLines`, a newline after
 * each), in file-name order: the bytes the vendored files must be.
 */
const CLI_REJECTED_SHA256 = 'f4b2b13e9429b1beeda72e78bd7c48a13c0556c2c33ab77236eac90d187832ac';
const REJECTED_DIR = 'apps/worker/task-image/emsign-block';

/**
 * The trigger.dev version every hand-kept value above, and the config's
 * `TASK_BUILD_IMAGE`, was read from. The CLI no longer applies its trust edits
 * on a base of one's own, so a newly distrusted root or rejected intermediate
 * in a later CLI reaches the tasks only by hand. A Trigger.dev move fails
 * here until they have been read again.
 */
const CLI_READ_AT = '4.8.3';

/** The DER certificate at the head of a `TRUSTED CERTIFICATE` PEM, without OpenSSL's trust settings after it. */
function certificateOf(pem: string): X509Certificate {
  const der = Buffer.from(pem.split('\n').filter((l) => l && !l.startsWith('-----')).join(''), 'base64');
  // A SEQUENCE with a two-byte long-form length (0x30 0x82 hi lo): a certificate's.
  expect([der[0], der[1]], 'the PEM starts with a certificate').toEqual([0x30, 0x82]);
  return new X509Certificate(der.subarray(0, 4 + der.readUInt16BE(2)));
}

describe("the tasks build on the API image's own base", () => {
  it('the API image builds FROM a Node image pinned by tag and digest', () => {
    // Vacuity guard: a FROM line the regex no longer reads would leave
    // nothing below to compare with.
    expect(API_NODE, `${API_DOCKERFILE} has no FROM node:… line`).toMatch(/^node:\d+\.\d+\.\d+[^@\s]*@sha256:[0-9a-f]{64}$/);
  });

  it("a deploy's runtime stage is that image, and its build stage the CLI's own build image for the same major", async () => {
    const { manifest } = await buildFor('deploy');
    expect(manifest.image?.base, `the tasks build on ${API_DOCKERFILE}'s FROM image`).toBe(API_NODE);
    // The CLI builds its build stage FROM the runtime base when a layer adds
    // instructions and no build base is named; there `npm i` would find the
    // npm the layer removes. Named, it is a `-build` image of the major the
    // config's runtime asks for, by tag and digest.
    const major = String(taskConfig.runtime).replace(/^node-/, '');
    expect(manifest.image?.buildBase).toMatch(new RegExp(`^triggerdotdev/node:${major}-bookworm-build@sha256:[0-9a-f]{64}$`));
    // Kept, not replaced: what the CLI and other layers put there stays.
    expect(manifest.image?.pkgs).toEqual([]);
  });

  it('the layer copies no Node binary and asks the CLI to install nothing', async () => {
    const { layers } = await buildFor('deploy');
    for (const layer of layers) {
      expect(layer.image?.pkgs ?? [], 'apt packages go in the instructions, where the scan of the stage reads them').toEqual([]);
      for (const instruction of layer.image?.instructions ?? []) expect(instruction).not.toMatch(/^COPY\b|\/usr\/local\/bin\/node\b/);
    }
  });

  it('installs what the runtime runs, dumb-init and the CA store, and nothing else', async () => {
    const apt = only(await deployInstructions(), /\bapt-get install\b/);
    const packages = /apt-get install -y --no-install-recommends ((?:[a-z0-9.+-]+ ?)+?) &&/.exec(apt)?.[1]?.trim().split(' ');
    // dumb-init is the ENTRYPOINT the CLI writes (`dumb-init node <controller>`);
    // ca-certificates (with openssl, which it depends on) is the store Node
    // reads under --use-openssl-ca. The CLI's own images add busybox and git:
    // the run controller forks only `process.execPath`, and no task runs a
    // binary of its own.
    expect(packages?.sort()).toEqual(['ca-certificates', 'dumb-init']);
    expect(apt).toMatch(/^RUN apt-get update && apt-get -y upgrade && /);
    expect(apt).toMatch(/&& rm -rf \/var\/lib\/apt\/lists\/\*$/);
  });

  it('keeps the trust edits the CLI makes to its own images', async () => {
    const instructions = await deployInstructions();
    const sed = only(instructions, /\/etc\/ca-certificates\.conf/);
    const roots = /mozilla\/\(([^)]+)\)\\\.crt\)\$#!\\1#' \/etc\/ca-certificates\.conf/.exec(sed)?.[1]?.split('|');
    expect(roots, 'the roots the CLI distrusts, all four').toEqual(CLI_DISTRUSTED_ROOTS);
    expect(sed).toMatch(/&& \\\n {2}update-ca-certificates --fresh$/);
    expect(only(instructions, /^ENV\b/)).toBe('ENV NODE_OPTIONS=--use-openssl-ca SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt');
    // In this order: the package that brings the store, the rejected
    // intermediates, the distrust that rebuilds the store with them.
    const at = (what: RegExp) => instructions.findIndex((i) => what.test(i));
    expect(at(/apt-get install/)).toBeLessThan(at(new RegExp(`mkdir -p ${CLI_REJECT_DIR}`)));
    expect(at(new RegExp(`mkdir -p ${CLI_REJECT_DIR}`))).toBeLessThan(at(/update-ca-certificates/));
  });

  it("writes the eight rejected intermediates, the CLI's bytes, each whole", async () => {
    const files = readdirSync(join(REPO_ROOT, REJECTED_DIR)).sort();
    expect(files).toHaveLength(8);
    const pems = files.map((f) => read(`${REJECTED_DIR}/${f}`));
    expect(createHash('sha256').update(pems.join('')).digest('hex'), `${REJECTED_DIR} is not trigger.dev 4.8.3's list`).toBe(
      CLI_REJECTED_SHA256,
    );
    for (const [i, pem] of pems.entries()) {
      // What each file says it is: an eMudhra intermediate under one of
      // emSign's G3 roots.
      const cert = certificateOf(pem);
      expect(cert.issuer, files[i]).toMatch(/CN=emSign Root (TLS|CS) CA - G3/);
      expect(cert.ca, files[i]).toBe(true);
    }
    const write = only(await deployInstructions(), new RegExp(`mkdir -p ${CLI_REJECT_DIR}`));
    for (const [i, pem] of pems.entries()) {
      const lines = pem.trimEnd().split('\n');
      const printf = [`printf '%s\\n'`, ...lines.map((l) => `'${l}'`)].join(' \\\n    ');
      expect(write, files[i]).toContain(`${printf} \\\n    > ${CLI_REJECT_DIR}/${files[i]}`);
    }
  });

  it('drops every package manager where no C++ compiler is, so the runtime has none and the build stage keeps npm', async () => {
    const removal = only(await deployInstructions(), /\/usr\/local\/lib\/node_modules/);
    // The layer runs in both stages. The build image has g++ (the CLI's
    // `-build` images add python3, make and g++); the runtime base has none.
    expect(removal).toMatch(/^RUN if ! command -v g\+\+ >\/dev\/null; then rm -rf .+; fi$/);
    const removed = /then rm -rf (.+); fi$/.exec(removal)?.[1]?.split(' ');
    expect(removed?.sort()).toEqual(
      [
        '/usr/local/lib/node_modules',
        '/usr/local/bin/npm',
        '/usr/local/bin/npx',
        '/usr/local/bin/corepack',
        '/usr/local/bin/pnpm',
        '/usr/local/bin/pnpx',
        '/usr/local/bin/yarn',
        '/usr/local/bin/yarnpkg',
        '/opt/yarn-v*',
      ].sort(),
    );
  });

  it(`a Trigger.dev move reads again what the config keeps of the CLI ${CLI_READ_AT}'s by hand`, () => {
    // deploy-tasks.sh deploys with the CLI of apps/worker's SDK version.
    const sdk = (JSON.parse(read('apps/worker/package.json')) as { dependencies?: Record<string, string> }).dependencies?.[
      '@trigger.dev/sdk'
    ];
    expect(
      sdk,
      [
        `apps/worker deploys with trigger.dev ${sdk}, and ${TASK_CONFIG} keeps three things read from ${CLI_READ_AT}'s`,
        '`dist/esm/deploy/` by hand. Read each again in the new version and carry it over, then set CLI_READ_AT:',
        `  - \`buildImage.js\`'s \`BUILD_IMAGE['${String(taskConfig.runtime)}']\`, into the config's TASK_BUILD_IMAGE;`,
        "  - `buildImage.js`'s `EMSIGN_COMPROMISE_DISTRUSTED_ROOTS`, into the config's DISTRUSTED_ROOTS and CLI_DISTRUSTED_ROOTS here;",
        `  - \`emsignRejectedIntermediates.js\`, into ${REJECTED_DIR}/ and CLI_REJECTED_SHA256 here.`,
      ].join('\n'),
    ).toBe(CLI_READ_AT);
  });

  it('`trigger dev` builds no image: no layer, and the manifest as it was', async () => {
    const { layers, manifest } = await buildFor('dev');
    expect(layers).toEqual([]);
    expect(manifest).toEqual({ image: { pkgs: [], instructions: [] } });
  });

  it("no instance setting overrides the config's base", () => {
    // The CLI lays an instance's DEPLOY_BASE_IMAGES / DEPLOY_BUILD_BASE_IMAGES
    // over the manifest's `image` key by key (deploy.js, `applyServerBaseImages`;
    // the webapp sends only the keys it has, `resolveDeployBaseImages`), so a
    // base named there would replace the config's, and the FROM line would no
    // longer be the one place the tasks' image moves.
    for (const file of ['deploy/compose/managed.yml', 'deploy/compose/managed.env.example']) {
      expect(read(file), file).not.toMatch(/DEPLOY_(BUILD_)?BASE_IMAGES/);
    }
  });

  it("the pin watch finds the API base in the config's text, exactly once", () => {
    // `taskNodeRow` stops reporting the CLI base image's Node when this
    // matches, and its own guard takes the first match out to see the row
    // report again.
    const text = read(TASK_CONFIG);
    expect(text.match(new RegExp(TASK_ON_API_IMAGE.source, 'g')) ?? []).toHaveLength(1);
  });
});

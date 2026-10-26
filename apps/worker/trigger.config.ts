// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Trigger.dev deploy configuration (workplan 0018 T2).
 *
 * Read by the `trigger.dev` CLI, not by any runtime in this repo — deploying
 * builds each task under `src/jobs/` into an image, pushes it to the stack's
 * registry, and registers it with the self-hosted instance, whose supervisor
 * then runs one container per task run (see deploy/compose/managed.yml and
 * deploy/compose/deploy-tasks.sh).
 *
 * All task files under src/jobs are registered, not just verify/apply: deploying the
 * discovery/sync/cutover tasks costs nothing extra and stops them bit-rotting
 * as undeployable code. Deploying them changes NOTHING about what runs —
 * syncs run through the managed-sync-tick scheduled task (0022 retired the poller)
 * deliberately (0018's stated non-goal).
 *
 * Lives in apps/worker on purpose (hard rule 5): nothing under packages/ or
 * apps/selfhost may know this exists.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@trigger.dev/sdk';

/**
 * THE TASKS BUILD ON THE API IMAGE'S OWN BASE (workplan 0146 T14; issue #1669
 * before it).
 *
 * The CLI builds the task image on the base image it names for `node-24`:
 * `triggerdotdev/node:24-bookworm@sha256:3cdc8242…` at 4.8.1, Debian 12 with
 * busybox, git and openssl added, read by Trivy 0.76.1 on 2026-10-26 at 1
 * critical and 83 high findings (at 4.7.6's `…@sha256:d2d0c018…`, 14 and 119).
 * From #1689 a deploy here copied the API image's Node binary over it. Now a
 * deploy builds the tasks on the image `apps/api/Dockerfile` builds FROM: the
 * extension below sets the build manifest's `image.base` to that line's image,
 * and the CLI writes it into the Containerfile's first stage, which the final
 * stage starts from. So the tasks run that image's own Node binary, with no
 * copy, and its Debian; Dependabot moves the line, and nothing else moves
 * either. On `node:24.22.1-trixie-slim@sha256:43b9ba11…` (Debian 13.7, where
 * #1708 puts that line), the runtime stage reads 0 critical and 43 high, none
 * with a fix (the same scan; 0146 T14 has the figures).
 *
 * The manifest is where the CLI keeps a custom base. 4.8.1's documented way to
 * fill it is an instance setting, `DEPLOY_BASE_IMAGES` on the webapp, which
 * would name the image in `managed.yml` too, a second place for it to move;
 * an instance setting is laid over this one, and `managed.yml` sets none
 * (`scripts/a-gate-on-a-version-nothing-ships.unit.test.ts` holds that).
 *
 * ON A BASE OF ITS OWN THE IMAGE GETS NOTHING FROM THE CLI: no packages (its
 * own base images carry them) and none of its trust edits (`trustStoreHardening`
 * in `deploy/buildImage.js` leaves a custom base alone). So the layer brings
 * what the runtime uses, read from the CLI's runtime entrypoint: `dumb-init`,
 * the final stage's ENTRYPOINT (`dumb-init node <controller>`), and Debian's
 * `ca-certificates` (with `openssl`, which it depends on), the store Node reads
 * under `--use-openssl-ca`. Not busybox or git: the controller forks only
 * `process.execPath`, `@trigger.dev/core` spawns nothing, and no task runs a
 * binary (AGENTS.md: the engines are JS-native). And it makes the CLI's trust
 * edits as the CLI writes them at 4.8.1: four roots distrusted in
 * `/etc/ca-certificates.conf` (Debian 13's `20250419+deb13u1` already drops two
 * of them, the emSign ECC G3 and Comodo AAA roots; emSign C1 and ECC C3 it
 * still ships), the eight eMudhra intermediates the CLI rejects, kept in
 * `task-image/emsign-block/` byte for byte, and `NODE_OPTIONS=--use-openssl-ca`
 * with `SSL_CERT_FILE`, which the run controller hands to every task process.
 * The CLI's list is now this repository's to keep: a CLI move compares them.
 *
 * NO PACKAGE MANAGER AT RUNTIME. The controller and the tasks never run npm,
 * npx, corepack, pnpm or yarn, so the runtime stage drops them all, as the API
 * image's runtime stage does (0146 T12), and with them npm's bundled undici,
 * brace-expansion and http-cache-semantics, the base's 5 Node.js findings.
 * The CLI's build stage does run `npm i` (the externals below), and with a
 * layer and no build base named it builds that stage FROM the runtime base,
 * where npm is gone. So the build stage is named: `TASK_BUILD_IMAGE`, the
 * CLI's own build image for `node-24`, which also brings python3, make and g++
 * prebuilt instead of installing them with apt. The layer runs in both stages
 * (the CLI replays it on a build base), and the removal runs only where there
 * is no C++ compiler: every `-build` image has one, and the runtime base has
 * none. Only `node_modules` and `index.json` leave the build stage.
 *
 * The Dockerfile and the certificates are read on the DEPLOYING machine, at
 * the start of the build: a throw in `onBuildStart` stops the deploy, where
 * one in `onBuildComplete` is only logged and the deploy goes on without the
 * layer or the base. `trigger dev` builds no image, so it gets nothing. The
 * indexer container imports this file again, and neither hook runs there.
 *
 * The layer's text is the same at every deploy, so the CLI's persistent
 * `trigger` builder serves it from its cache: the packages are refreshed when
 * the API's FROM line moves or the builder's cache is gone, not at every
 * deploy, and a deploy that misses the cache runs apt in both stages and needs
 * the Debian archive. `scripts/a-gate-on-a-version-nothing-ships.unit.test.ts`
 * holds all of it. A change here takes a task re-deploy.
 */
const TASK_BASE = 'task-base';

/**
 * The CLI's own build-stage image for `node-24` at trigger.dev 4.8.1
 * (`BUILD_IMAGE` in `dist/esm/deploy/buildImage.js`; pushed 2026-10-22): its
 * runtime image with python3, make and g++. It moves with the CLI, read from
 * the new version's `buildImage.js` (workplan 0119 §2); a stale one still
 * builds, since only `node_modules` and `index.json` leave the stage.
 */
const TASK_BUILD_IMAGE =
  'triggerdotdev/node:24-bookworm-build@sha256:34a3f4554d1684e078b104bd2b7ba6743776ad9002ebceef707dee91fa629c41';

/** The roots trigger.dev 4.8.1 distrusts in its own images (`EMSIGN_COMPROMISE_DISTRUSTED_ROOTS`). */
const DISTRUSTED_ROOTS = ['emSign_ECC_Root_CA_-_G3', 'emSign_Root_CA_-_C1', 'emSign_ECC_Root_CA_-_C3', 'Comodo_AAA_Services_root'];

/** Where the CLI puts the intermediates it rejects (`EMSIGN_REJECT_DIR`), and where this repository keeps them. */
const REJECT_DIR = '/usr/local/share/ca-certificates/emsign-block';
const REJECTED = join('task-image', 'emsign-block');

/** Every package manager the Node image ships, as `apps/api/Dockerfile`'s runtime stage removes them (0146 T12). */
const PACKAGE_MANAGERS = [
  '/usr/local/lib/node_modules',
  '/usr/local/bin/npm',
  '/usr/local/bin/npx',
  '/usr/local/bin/corepack',
  '/usr/local/bin/pnpm',
  '/usr/local/bin/pnpx',
  '/usr/local/bin/yarn',
  '/usr/local/bin/yarnpkg',
  '/opt/yarn-v*',
];

let taskBase: { image: string; instructions: string[] } | undefined;

/** The image `apps/api/Dockerfile` builds FROM, by tag and digest, or a refusal. */
function readApiNodeImage(workingDir: string): string {
  const dockerfile = join(workingDir, '..', 'api', 'Dockerfile');
  const image = /^FROM\s+(node:\S+@sha256:[0-9a-f]{64})(?:\s|$)/m.exec(readFileSync(dockerfile, 'utf8'))?.[1];
  if (!image) {
    throw new Error(
      `${dockerfile} has no FROM node:<tag>@sha256:<digest> line, so the tasks cannot build on the API image's base; the deploy stops here`,
    );
  }
  return image;
}

/**
 * Each rejected intermediate as the lines of its PEM, or a refusal. Every line
 * goes between single quotes in a RUN, so nothing but a PEM's armour and its
 * base64 is let through.
 */
function readRejected(workingDir: string): Array<{ file: string; lines: string[] }> {
  const dir = join(workingDir, REJECTED);
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.crt'))
    .sort();
  if (files.length === 0) throw new Error(`${dir} holds no .crt, so the tasks would trust what the CLI rejects; the deploy stops here`);
  return files.map((file) => {
    const lines = readFileSync(join(dir, file), 'utf8').trimEnd().split('\n');
    const whole =
      /^[A-Za-z0-9._-]+\.crt$/.test(file) &&
      lines[0] === '-----BEGIN TRUSTED CERTIFICATE-----' &&
      lines.at(-1) === '-----END TRUSTED CERTIFICATE-----' &&
      lines.slice(1, -1).every((line) => /^[A-Za-z0-9+/=]+$/.test(line));
    if (!whole) throw new Error(`${join(dir, file)} is not one TRUSTED CERTIFICATE PEM; the deploy stops here`);
    return { file, lines };
  });
}

/** The image the tasks build on, and the one layer they get there. */
function readTaskBase(workingDir: string): { image: string; instructions: string[] } {
  const image = readApiNodeImage(workingDir);
  const rejected = readRejected(workingDir);
  return {
    image,
    instructions: [
      'RUN apt-get update && apt-get -y upgrade && apt-get install -y --no-install-recommends ca-certificates dumb-init && apt-get clean && rm -rf /var/lib/apt/lists/*',
      `RUN if ! command -v g++ >/dev/null; then rm -rf ${PACKAGE_MANAGERS.join(' ')}; fi`,
      [
        `RUN mkdir -p ${REJECT_DIR}`,
        ...rejected.map(
          ({ file, lines }) =>
            `${[`printf '%s\\n'`, ...lines.map((line) => `'${line}'`)].join(' \\\n    ')} \\\n    > ${REJECT_DIR}/${file}`,
        ),
      ].join(' && \\\n  '),
      `RUN sed -i -E 's#^(mozilla/(${DISTRUSTED_ROOTS.join('|')})\\.crt)$#!\\1#' /etc/ca-certificates.conf && \\\n  update-ca-certificates --fresh`,
      'ENV NODE_OPTIONS=--use-openssl-ca SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt',
    ],
  };
}

export default defineConfig({
  // Resolved on the DEPLOYING machine, where deploy-tasks.sh guards that the
  // env var is set. This file is imported a SECOND time inside the build's
  // indexer container, where no such env var exists — so it must never throw
  // on a missing ref (a defensive throw here aborted the first real deploy at
  // exactly that point). The deployment's real project was already fixed by
  // the CLI before the indexer runs; the fallback string is never acted on.
  project: process.env.TRIGGER_PROJECT_REF ?? 'proj_ref_set_at_deploy_time',
  // The Node the task image is built on (workplan 0146 T6). 24 is the images'
  // Node major (the api and selfhost images run it; the web image builds on
  // it), and scripts/a-gate-on-a-version-nothing-ships.unit.test.ts holds the
  // two together. It is set explicitly because without it the CLI takes the
  // server project's default runtime, or else its own `node`, which in the
  // 4.5.16 CLI is triggerdotdev/node:21-bookworm: the tasks ran Node 21 until
  // this line.
  // For node-24 the CLI would build on triggerdotdev/node:24-bookworm; the
  // extension below names the API image's base instead, and the build stage
  // image for this major. A change here takes a task re-deploy.
  runtime: 'node-24',
  // What a run logs stays in its container's output, and out of Trigger.dev's
  // own database (workplan 0134, open question 3 (a)). Upstream's interceptor
  // copies every `console.*` line of a run into the plane's store, where it
  // is kept with no limit and every dump of `triggerdb` carries it, and this
  // repository's `log.*` writes to `console.*`: folder paths, file names and
  // a provider's own sentences with them. Off, `console.*` writes to the
  // container's output alone, which is where the smoke's runner-log capture
  // reads it. The SDK's `logger` writes to the plane directly, so no task uses
  // it, and a run's error and discovery's output carry a reference instead of
  // the words (`src/jobs/what-a-run-leaves.ts`). A change here takes a task
  // re-deploy.
  disableConsoleInterceptor: true,
  dirs: ['./src/jobs'],
  // EVERY TASK NAMES ITS MACHINE (workplan 0143 T1 step 2). The plane's own
  // default was `small-1x` too, half a CPU and 512 MB, enforced on the
  // container, and nobody had chosen it. The owner chose it on 2026-09-28
  // (0143, open question 7), and the stacks' caps are counted in it. A copy
  // pass and a discovery count name theirs as well, beside what they were
  // measured at. A change here takes a task re-deploy, and changes what the
  // caps in `managed.env.example` must be counted in.
  machine: 'small-1x',
  // Verification counts and samples a real mailbox; an hour is generous
  // headroom, not an expectation.
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    // Retries re-run the WHOLE task, which is safe by construction: every job
    // here re-checks its gates freshly, and run-apply-deletion lands its
    // receipt on every attempt (a retry that succeeds flips failed → applied,
    // which is the truth).
    default: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000, factor: 2 },
  },
  build: {
    // The @openmig/* workspace packages are not on npm and MUST be bundled;
    // what must NOT be bundled is the native/wasm tail they drag in — these
    // are npm-installable inside the task image instead. First cut; T5's
    // live deploy on the Spark is what proves the list.
    external: ['@electric-sql/pglite', 'pg'],
    // The tasks build on the API image's base (the comment above `defineConfig`).
    extensions: [
      {
        name: TASK_BASE,
        onBuildStart(context) {
          if (context.target === 'dev') return;
          taskBase = readTaskBase(context.workingDir);
        },
        onBuildComplete(context, manifest) {
          if (context.target === 'dev') return;
          taskBase ??= readTaskBase(context.workingDir);
          manifest.image = { ...manifest.image, base: taskBase.image, buildBase: TASK_BUILD_IMAGE };
          context.addLayer({ id: TASK_BASE, image: { instructions: taskBase.instructions } });
        },
      },
    ],
  },
});

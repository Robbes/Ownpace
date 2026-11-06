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

import { defineConfig } from '@trigger.dev/sdk';

/**
 * THE TASKS RUN ON A PREBUILT BASE (workplan 0119 §3 item 13; the owner's
 * decision of 2026-11-03, for alpha.5: "CI builds it, signs it and publishes
 * it to GHCR like the other release images").
 *
 * `ghcr.io/robbes/ownpace-task-base`, built from `task-image/Dockerfile` by
 * `.github/workflows/images.yml` on main only, signed there by digest, and
 * named here by its `sha-<commit>` tag and its index digest: distroless at the
 * API's runtime digest, with what the CLI's runtime stage needs already in it
 * (a `node` account at 1000:1000, dumb-init and node on its PATH, the CA bundle
 * with the CLI's trust edits, `--use-openssl-ca`) and no shell. The extension
 * below sets the build manifest's `image.base` to it and adds NO LAYER, so the
 * CLI builds nothing into it: the base stage of the Containerfile it writes is
 * `FROM <this> AS base` with one ENV line, and the runtime stage is `FROM base
 * AS final` with no RUN (trigger.dev 4.8.3, `generateNodeContainerfile` in
 * `dist/esm/deploy/buildImage.js`). A layer, even one ENV line, would make the
 * CLI write its apt repair into the base stage, which has no shell to run it:
 * `scripts/a-task-base-the-cli-builds-nothing-into.unit.test.ts` runs the
 * installed CLI's own generator on this config and fails on one.
 *
 * So a deploy pulls this image (public: no login), runs no apt and needs no
 * Debian mirror, and the OTA stack, which deploys main, and live, which
 * deploys the release tag that carries this line, run the same bytes, the ones
 * the weekly image scan reads as `trigger-task-base`. Until 2026-11-06 the
 * tasks built on `apps/api/Dockerfile`'s FROM image with a layer of their own:
 * apt, the CLI's trust edits, the package managers removed and ten Debian
 * Essentials purged (workplan 0146 T14; 0119 §3 item 11). The trust edits are
 * `task-image/Dockerfile`'s now, and distroless has no package manager and
 * none of the ten.
 *
 * THE TASKS' NODE IS THE BASE'S: distroless's, at the digest
 * `apps/api/Dockerfile`'s runtime stage named on the commit the base was built
 * from. images.yml's `task-base` leg starts each base it builds and stops when
 * its Node is not `apps/api/Dockerfile`'s FROM node line, and the managed smoke
 * asks the newest image the runners started from and stops when its Node is
 * not that line's either. A Dependabot move of the API's Node or distroless
 * moves `task-image/Dockerfile` in the same group, main publishes a base with
 * other layers, and from then this pin is behind until it moves: the pin watch
 * lists it (`scripts/idp-pin-watch.mjs`, the row *the tasks' base*), and the
 * smoke stops on the two Nodes. A merge that changes nothing the base is built
 * from republishes the same layers under a new digest (the revision label
 * moves), and the watch calls that current.
 *
 * MOVING IT: the newest signed `sha-<commit>` main published (`edge`'s index),
 * by tag and digest, in a pull request of its own with E2E (managed) dispatched
 * on its branch. There images.yml's `task-base pin` job pulls it anonymously
 * on both platforms and verifies its signature by images.yml's identity on
 * `refs/heads/main`; `scripts/release-verify.mjs` checks the same at the tag,
 * with its revision an ancestor of the tag's commit.
 * `scripts/a-gate-on-a-version-nothing-ships.unit.test.ts` holds the line's
 * shape. A change here takes a task re-deploy.
 */
const TASK_BASE_IMAGE =
  'ghcr.io/robbes/ownpace-task-base:sha-691b235@sha256:a6039c90eea23bcb166d22e984207e1eb7c01ea8cf3f22005d272a08568b7c9f';

/** The extension's name. */
const TASK_BASE = 'task-base';

/**
 * The CLI's own build-stage image for `node-26` at trigger.dev 4.8.3
 * (`BUILD_IMAGE['node-26']` in `dist/esm/deploy/buildImage.js`; Docker Hub's
 * `26-bookworm-build-20261021-000000-40f241b`, pushed 2026-10-22 08:03 UTC,
 * Node 26.12.1 in its amd64 and arm64 configs): its runtime image with
 * python3, make and g++. Named as the manifest's `image.buildBase`, the CLI's
 * build stage starts FROM it, so `npm i` (the externals below) and the indexer
 * run there and never on the base, which has no shell; with no build base and
 * a layer the CLI would build that stage FROM the base. It was `node-24`'s,
 * `…@sha256:34a3f455…`, until the runtime moved to 26 on 2026-10-31. It moves
 * with the CLI and with the runtime's major, read from the new version's
 * `buildImage.js` (workplan 0119 §2; the version gate fails on a CLI move until
 * it is read again, and on a major this image does not name); a stale one
 * still builds, since only `node_modules` and `index.json` leave the stage,
 * and the tasks run the base's Node, not this one's.
 */
const TASK_BUILD_IMAGE =
  'triggerdotdev/node:26-bookworm-build@sha256:86d5a599fc69a81e15c1276440702144cd3d857258fdaf78f8c9b864768c1ab9';

export default defineConfig({
  // Resolved on the DEPLOYING machine, where deploy-tasks.sh guards that the
  // env var is set. This file is imported a SECOND time inside the build's
  // indexer container, where no such env var exists — so it must never throw
  // on a missing ref (a defensive throw here aborted the first real deploy at
  // exactly that point). The deployment's real project was already fixed by
  // the CLI before the indexer runs; the fallback string is never acted on.
  project: process.env.TRIGGER_PROJECT_REF ?? 'proj_ref_set_at_deploy_time',
  // The Node the task image is built on (workplan 0146 T6). 26 is the images'
  // Node major (the api and selfhost images run it; the web image builds on
  // it), and scripts/a-gate-on-a-version-nothing-ships.unit.test.ts holds the
  // two together; it was 24 until 2026-10-31 (workplan 0119 §2.4). It is set
  // explicitly because without it the CLI takes the server project's default
  // runtime, or else its own `node`, which in the 4.5.16 CLI is
  // triggerdotdev/node:21-bookworm (in 4.8.3, triggerdotdev/node:24-bookworm):
  // the tasks ran Node 21 until this line.
  // For node-26 the CLI would build on triggerdotdev/node:26-bookworm; the
  // extension below names the prebuilt base instead, and the build stage
  // image for this major. A change here takes a task re-deploy.
  runtime: 'node-26',
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
    // The tasks run on the prebuilt base, and the CLI adds no layer to it
    // (the comment above TASK_BASE_IMAGE). `trigger dev` builds no image, so
    // it gets nothing. The indexer container imports this file again, where
    // the hook does not run.
    extensions: [
      {
        name: TASK_BASE,
        onBuildComplete(context, manifest) {
          if (context.target === 'dev') return;
          manifest.image = { ...manifest.image, base: TASK_BASE_IMAGE, buildBase: TASK_BUILD_IMAGE };
        },
      },
    ],
  },
});

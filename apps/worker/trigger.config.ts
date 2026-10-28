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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@trigger.dev/sdk';

/**
 * THE TASKS RUN THE API IMAGE'S NODE (lifecycle round 2026-10-21; issue #1669).
 *
 * The base image the CLI names for `node-24` was Node 24.18.0 in every CLI up
 * to 4.7.6, two security releases behind, and nothing here moved it. So a
 * deploy adds one layer to the task image: the Node binary out of the image
 * `apps/api/Dockerfile` builds FROM, copied over the base image's, and the base
 * image's Debian packages upgraded. Dependabot moves that FROM line, and the
 * tasks move with it. Since workplan 0146 T13 that line is the API's BUILD
 * stage: the API runs on distroless, with a Node of its own pinned by a digest
 * that moves apart from the tag. Same Node version as this line, checked, not
 * assumed: the managed smoke's preflights stop when the API container's Node
 * is not this line's x.y.z (deploy/compose/smoke-managed.sh, `dockerfile_node`).
 * The CLI puts a layer's instructions in the image's
 * first stage, as root, which its build, indexer and final stages all start
 * from. An official Node binary needs only glibc 2.28, so one taken from a
 * trixie image runs on the base image's bookworm.
 *
 * CLI 4.7.7 and 4.8.x name a base image rebuilt on Node 24.22.1
 * (`triggerdotdev/node:24-bookworm@sha256:3cdc8242…` at 4.8.1), the same Node
 * the API image runs today. The layer stays: it moves the tasks when the API's
 * Node moves, where the base image moves only when upstream rebuilds it and
 * this repository moves the CLI.
 *
 * The upgrade's text never changes, so the CLI's persistent `trigger` builder
 * serves it from its cache: the packages are refreshed when the API's Node
 * image moves (the COPY above it invalidates the cache) or when the builder's
 * cache is gone, not at every deploy. Since CLI 4.7.6 the image also sets
 * `NODE_OPTIONS=--use-openssl-ca`, so the tasks verify TLS against Debian's
 * `ca-certificates`, which that upgrade moves, and no longer against the list
 * built into Node.
 *
 * The Dockerfile is read on the DEPLOYING machine, at the start of the build:
 * a throw in `onBuildStart` stops the deploy, where one in `onBuildComplete`
 * is only logged and the deploy goes on without the layer. `trigger dev` builds
 * no image, so it gets nothing. The indexer container imports this file again,
 * and neither hook runs there.
 *
 * Instructions in the first stage have a cost: the CLI then builds its build
 * stage on that stage instead of its prebuilt `-build` image, installing
 * python3, make and g++ itself, so a deploy that misses the cache (the first
 * after the Node image moves) runs apt in both stages, takes longer and needs
 * the Debian archive. `scripts/a-gate-on-a-version-nothing-ships.unit.test.ts`
 * holds the layer to the Dockerfile's FROM line. A change here takes a task
 * re-deploy.
 */
const TASK_NODE = 'task-node';
let apiNodeImage: string | undefined;

/** The image `apps/api/Dockerfile` builds FROM, by tag and digest, or a refusal. */
function readApiNodeImage(workingDir: string): string {
  const dockerfile = join(workingDir, '..', 'api', 'Dockerfile');
  const image = /^FROM\s+(node:\S+@sha256:[0-9a-f]{64})(?:\s|$)/m.exec(readFileSync(dockerfile, 'utf8'))?.[1];
  if (!image) {
    throw new Error(
      `${dockerfile} has no FROM node:<tag>@sha256:<digest> line, so the tasks cannot take the API image's Node; the deploy stops here`,
    );
  }
  return image;
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
  // For node-24 the CLI builds on triggerdotdev/node:24-bookworm, and a task
  // deploy's build output names it. A change here takes a task re-deploy.
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
    // The tasks' Node is the API image's (the comment above `defineConfig`).
    extensions: [
      {
        name: TASK_NODE,
        onBuildStart(context) {
          if (context.target === 'dev') return;
          apiNodeImage = readApiNodeImage(context.workingDir);
        },
        onBuildComplete(context) {
          if (context.target === 'dev') return;
          apiNodeImage ??= readApiNodeImage(context.workingDir);
          context.addLayer({
            id: TASK_NODE,
            image: {
              instructions: [
                `COPY --from=${apiNodeImage} /usr/local/bin/node /usr/local/bin/node`,
                'RUN apt-get update && apt-get -y upgrade && apt-get clean && rm -rf /var/lib/apt/lists/*',
              ],
            },
          });
        },
      },
    ],
  },
});

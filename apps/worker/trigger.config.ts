// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Trigger.dev deploy configuration (workplan 0018 T2).
 *
 * Read by the `trigger.dev` CLI, not by any runtime in this repo — deploying
 * builds each task under `src/jobs/` into an image, pushes it to the stack's
 * registry, and registers it with the self-hosted instance, whose supervisor
 * then runs one container per task run (see deploy/compose/managed.yml and
 * deploy/compose/deploy-tasks.sh).
 *
 * All seven task files are registered, not just verify/apply: deploying the
 * discovery/sync/cutover tasks costs nothing extra and stops them bit-rotting
 * as undeployable code. Deploying them changes NOTHING about what runs —
 * syncs run through the managed-sync-tick scheduled task (0022 retired the poller)
 * deliberately (0018's stated non-goal).
 *
 * Lives in apps/worker on purpose (hard rule 5): nothing under packages/ or
 * apps/selfhost may know this exists.
 */

import { defineConfig } from '@trigger.dev/sdk';

export default defineConfig({
  // Resolved on the DEPLOYING machine, where deploy-tasks.sh guards that the
  // env var is set. This file is imported a SECOND time inside the build's
  // indexer container, where no such env var exists — so it must never throw
  // on a missing ref (a defensive throw here aborted the first real deploy at
  // exactly that point). The deployment's real project was already fixed by
  // the CLI before the indexer runs; the fallback string is never acted on.
  project: process.env.TRIGGER_PROJECT_REF ?? 'proj_ref_set_at_deploy_time',
  dirs: ['./src/jobs'],
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
  },
});

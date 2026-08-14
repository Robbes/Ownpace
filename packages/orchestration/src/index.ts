// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The multi-domain orchestration layer.
 *
 * This is what actually runs a migration: `runAllDomains` plans the per-domain
 * lanes, drives each domain independently so a failed one does not block the
 * others, and records the outcome. `discoverAllDomains`, `verifyMapping` and
 * `applyMappingDeletion` are the same shape for the other three operations.
 *
 * WHY IT IS A PACKAGE AND NOT PART OF THE WORKER. It lived in `apps/worker/src`
 * until 2026-08-14, which made `apps/selfhost` depend on an *application* for
 * library code, and made `packages/core`'s test reach up out of the workspace
 * with `import … from '../../../apps/worker/src/build-deps-from-mapping'` — a
 * relative traversal no manifest declared and nothing enforced. See
 * `docs/workplans/0040-orchestration-is-a-library.md`.
 *
 * The barrel carries the surface that OTHER packages consume. Modules inside
 * `apps/worker` (its `jobs/` and `cli/`) import the individual files by subpath
 * — `@openmig/orchestration/build-deps-from-mapping` — which maps one-to-one
 * onto the relative imports they used before the move.
 */

export {
  runAllDomains,
  discoverAllDomains,
  verifyMapping,
  applyMappingDeletion,
  planDomainLanes,
  type DomainSyncResult,
  type SyncDomain,
} from './orchestration';

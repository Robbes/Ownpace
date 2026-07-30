// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Self-host mapping lifecycle (workplan 0013 T7).
 *
 * The decisions moved to `@openmig/shared` under ADR-0026 — both editions make
 * them and must make them identically. Re-exported here so this app's own
 * imports (and its tests) are unaffected by where they live.
 */

export {
  startTransition,
  finishTransition,
  type StartTransition,
  type FinishTransition,
} from '@openmig/shared';

// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// THE ONE alias map, imported by the root vitest config and by every per-app
// config. It exists because there used to be four copies of it, and the three
// in apps/ had all drifted from the root's in the same way: they aliased the
// bare specifiers and omitted every SUBPATH.
//
// That is not a cosmetic difference. A bare '@openmig/core' alias is a PREFIX
// match, so '@openmig/core/cutover-state' becomes
// '<root>/packages/core/src/index.ts/cutover-state' and the run dies with
// `ENOTDIR: not a directory`. On 2026-08-13 that made `pnpm --filter <app> test`
// red for three of the four apps — worker 1 failed, selfhost 9, api 3 — while
// the root `pnpm test` stayed green, because only the root config had the
// subpath pins. CI runs only root scripts, so nothing ever saw it.
//
// ORDER IS LOAD-BEARING. Subpaths first: Vite takes the first matching prefix,
// so a bare entry listed above its own subpaths swallows them.
//
// Without the subpath pins, whether a dynamic import like
// CutoverStore.transitionState's resolves depends on the Node version running
// vitest: it works on Node 24 and throws "Cannot find package" on Node 22.
// Pinning makes every environment resolve identically instead of leaning on the
// runtime's resolver.
//
// A NOTE FOR apps/selfhost, which is the reason the bare '@openmig/scheduler'
// entry is safe to share: self-host must import '@openmig/scheduler/in-process'
// and NEVER the package index, which re-exports the Trigger.dev client (AGENTS.md
// hard rule 5, workplan 0010 T2). The subpath pin above resolves that import to
// scheduler.ts directly, and `apps/selfhost/src/no-managed-leakage.unit.test.ts`
// walks the appliance's real transitive imports to prove nothing pulls the index
// in. The old per-app config aliased the bare specifier WITHOUT the subpath,
// which both broke the import and pointed it at exactly the module the rule
// forbids.
import { resolve } from 'path';

const rootDir = resolve(import.meta.dirname);

export const aliases = {
  // Subpath exports — FIRST. See the ordering note above.
  '@openmig/core/cutover-state': resolve(rootDir, 'packages/core/src/cutover-state.ts'),
  '@openmig/core/secret-store': resolve(rootDir, 'packages/core/src/secret-store.ts'),
  '@openmig/core/secrets': resolve(rootDir, 'packages/core/src/secrets.ts'),
  '@openmig/ledger/schema-pg': resolve(rootDir, 'packages/ledger/src/schema-pg.ts'),
  '@openmig/ledger/db': resolve(rootDir, 'packages/ledger/src/db.ts'),
  '@openmig/managed/schema-managed': resolve(rootDir, 'packages/managed/src/schema-managed.ts'),
  '@openmig/scheduler/in-process': resolve(rootDir, 'packages/scheduler/src/scheduler.ts'),

  // Bare specifiers.
  '@openmig/managed': resolve(rootDir, 'packages/managed/src/index.ts'),
  '@openmig/shared': resolve(rootDir, 'packages/shared/src/index.ts'),
  '@openmig/ledger': resolve(rootDir, 'packages/ledger/src/index.ts'),
  '@openmig/core': resolve(rootDir, 'packages/core/src/index.ts'),
  '@openmig/connectors': resolve(rootDir, 'packages/connectors/src/index.ts'),
  '@openmig/scheduler': resolve(rootDir, 'packages/scheduler/src/index.ts'),
  '@openmig/engines': resolve(rootDir, 'packages/engines/src/index.ts'),
};

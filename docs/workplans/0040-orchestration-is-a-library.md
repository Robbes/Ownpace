# Workplan 0040 — Orchestration is a library, not a corner of the worker

## Status — 2026-08-14 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 create `packages/orchestration` and move the twelve library modules | ✅ **Done** | 12 modules + 12 tests moved with `git mv`; every `./` edge internal to the set, so no import inside the moved code changed — as predicted below. `apps/worker/src` is left with `index.ts` (157 lines) plus `cli/` and `jobs/`. |
| T2 repoint the three consumers, delete the path traversal | ✅ **Done** | `packages/core`'s `'../../../apps/worker/src/…'` is now `@openmig/orchestration/build-deps-from-mapping`, declared as a devDependency. `apps/selfhost` imports the barrel and **no longer depends on `@openmig/worker` at all**. `apps/worker` lost its `exports` map. |
| T3 gates | ✅ **Done — with one correction, below** | `tsc --noEmit` clean; `pnpm lint` clean; **212 test files / 2229 tests, all passing**, equal to the 212 `*.unit.test.*` files on disk. Both entry points load: the worker reaches its own `--config <path> is required`, selfhost imports clean. |

### What T1's plan got wrong, and what it caught

**Wrong:** the survey behind this plan used a flat `apps/worker/src/*.ts` glob and so missed
`cli/` and `jobs/` — 15 further `../`-relative imports into the moved modules. They are
worker-internal (nothing outside `apps/worker` imports them), so the cut still holds; they were
repointed to `@openmig/orchestration/<module>` subpaths rather than moved.

**Caught:** two guard tests in `packages/shared` — `no-raw-console` and `one-concurrency-default`
— scan a hard-coded `ROOTS` list that named `apps/worker/src`. Moving 2,935 lines out of that
directory would have silently dropped them from both guards while leaving every test green.
`packages/orchestration/src` was added to both lists, and the addition is verified rather than
assumed: injecting a `console.log` into a moved file makes `no-raw-console` fail on it by exact
path and line.

**Also worth recording:** the `exports` map was briefly changed from `./src/*` to `./src/*.ts` on
the strength of a bare-`node` probe that reported `ERR_MODULE_NOT_FOUND`. That probe was invalid —
`node` cannot load `.ts` at all, and it was run from a directory with no `@openmig` link. Under
`tsx`, which is what actually runs this code, **both forms resolve**. The explicit `.ts` was kept
for consistency with `packages/scheduler` and `packages/core`, but it fixed nothing.

## The problem, stated from the imports rather than from taste

`apps/worker/src` holds 3,092 lines across thirteen non-test modules. **One** of them —
`index.ts`, 157 lines — is a worker. It parses argv, reads a config file, and calls
`runAllDomains`. The other twelve, 2,935 lines, are a library that three different consumers
already depend on:

| Consumer | How it reaches in | What that means |
|---|---|---|
| `apps/selfhost/src/index.ts` | `import { runAllDomains, discoverAllDomains, verifyMapping, applyMappingDeletion } from '@openmig/worker/orchestration'` | **an app depends on another app** |
| `packages/core/src/sync-job.integration.test.ts` | `import { buildDepsFromMapping } from '../../../apps/worker/src/build-deps-from-mapping'` | **a package reaches UP into an app, by relative path**, escaping the workspace boundary entirely |
| `apps/worker/src/index.ts` | `import { runAllDomains } from './orchestration'` | the only consumer for which the current location is correct |

The second row is the one that cannot be defended. `../../../` is not a dependency the package
manager knows about, so nothing enforces it, nothing versions it, and `packages/core` builds
against a file no manifest of its own mentions. It is the kind of edge that keeps working right
up until someone moves a directory.

The first row is why `@openmig/worker` — an application — carries an `exports` map with a
`./orchestration` subpath. That subpath is the tell: **a package only needs a public entry point
for code somebody else consumes**, and an app should have no such consumers.

## Why this was not done in the Tier-3 housekeeping commit

Everything else in the structural audit was comments, deletions and documentation. This moves
2,935 lines of real code across a package boundary and changes what two editions import at
startup. It gets a plan and its own commit so that a bisect lands on it cleanly.

## T1 — create the package, move the twelve modules

New `packages/orchestration`, following the `packages/scheduler` template (private, `type:
module`, `main: src/index.ts`). The internal `./`-relative graph is already acyclic and
self-contained:

```
orchestration          -> build-deps, discovery
build-deps             -> contact-target-factory, dav-factories, deps-lifecycle, file-target-factory
build-deps-from-mapping-> contact-target-factory, dav-endpoint, dav-factories, deps-lifecycle, file-target-factory
build-reindexers       -> build-deps-from-mapping
contact-target-factory -> dav-factories
dav-endpoint           -> dav-factories
file-target-factory    -> dav-factories
dav-factories, deps-lifecycle, discovery, enabled-domains, sync-due -> (leaves)
```

Because every edge is internal to the moved set, **the `./` imports do not change** — the whole
cluster relocates intact. That is what makes this a move rather than a rewrite, and it is worth
stating because it bounds the risk: any import that needed editing would be a sign the cut is in
the wrong place.

Tests follow their subjects, per the rule in `docs/testing.md`. Three carry names that do not
match a module and are placed by what they import: `ledger-injection` and `review-fixes` test
`build-deps`/`dav-endpoint` and move; `domain-lanes` tests `planDomainLanes` in
`orchestration.ts` and moves. Four stay in `apps/worker` because they test the worker or the
running system, not the library: `index.unit.test.ts`, `cron-schedule-parity.unit.test.ts`, and
the two integration tests (`jmap-reindex`, `shared-mailbox`).

## T2 — repoint the consumers

- `apps/selfhost`: `@openmig/worker/orchestration` → `@openmig/orchestration`, and its dependency
  on `@openmig/worker` goes away **if nothing else in it needs the worker**. Verify rather than
  assume.
- `packages/core`: the `../../../apps/worker/src/...` traversal becomes a normal
  `@openmig/orchestration` import, declared as a **devDependency** — it is used only by a test.
  This is the same shape as the existing `core` → `ledger` devDependency edge and introduces no
  runtime cycle: `orchestration` depends on `core`, `core` does not depend on `orchestration` at
  runtime.
- `apps/worker`: keeps `index.ts`, gains a dependency on `@openmig/orchestration`, and **loses its
  `exports` map** — with no external consumers it no longer needs a public surface.
- `tsconfig.base.json`: `@openmig/worker/orchestration` is replaced by `@openmig/orchestration`
  (+ the `/*` subpath form the other packages have).

## T3 — what "done" has to show

Not "it compiles". Specifically:

1. `pnpm lint` clean and the full unit suite at its current count with **no test lost in the
   move** — the file count before and after must reconcile explicitly, because a test that
   silently stops being collected is the failure mode this whole exercise is supposed to make
   harder.
2. `grep` proves the traversal is gone: no `apps/worker` string remains in any `packages/**`
   import.
3. Both editions still start. `apps/selfhost` importing four symbols from a package that did not
   exist an hour ago is the part most likely to break at runtime rather than at build time.

## Explicitly not in scope

Splitting `build-deps.ts` (713) and `build-deps-from-mapping.ts` (599), which are large and
overlap in purpose — the audit noted a third concurrency default living in them. That is a
separate refactor with its own risk, and doing it inside a move would make the move impossible to
review.

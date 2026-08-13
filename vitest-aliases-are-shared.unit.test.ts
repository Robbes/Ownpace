// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Every vitest config resolves `@openmig/*` through the SAME alias map, and that
 * map lists subpaths before the bare specifiers they are prefixed by.
 *
 * Both halves are here because both broke, silently, and stayed broken.
 *
 * Until 2026-08-13 there were four copies of the alias block: the root's, which
 * pinned five subpath exports, and one each in `apps/api`, `apps/selfhost` and
 * `apps/worker`, which pinned none. A bare `'@openmig/core'` alias is a PREFIX
 * match, so `@openmig/core/cutover-state` resolved to
 * `packages/core/src/index.ts/cutover-state` and the run died with `ENOTDIR`.
 * Measured that day: `pnpm --filter @openmig/selfhost test` was 9 files failed of
 * 17, worker 1 of 16, api 3 of 11 — while root `pnpm test` was green, because
 * only the root config had the pins. **CI runs only root scripts**, so no gate
 * could see it, and the first thing a new contributor runs in the package they
 * are touching failed as though their machine were broken.
 *
 * The selfhost copy was worse than broken: aliasing bare `@openmig/scheduler` to
 * the package index points the appliance at the module that re-exports the
 * Trigger.dev client, which AGENTS.md hard rule 5 forbids outright.
 *
 * Ordering is the second half because it is invisible on inspection. The map
 * reads as a flat list; nothing about `'@openmig/core': …` sitting above
 * `'@openmig/core/secrets': …` looks wrong, and Vite silently takes the first
 * matching prefix.
 *
 * Kept at the repository root, next to the configs it is about. Root-level test
 * files cannot import workspace packages (see `vitest.config.ts`), so this uses
 * node builtins only.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = import.meta.dirname;
const SHARED = 'vitest.aliases.ts';

/** Alias keys, in declaration order, from the shared map's source. */
function sharedAliasKeysInOrder(): string[] {
  const src = readFileSync(join(ROOT, SHARED), 'utf8');
  const body = src.slice(src.indexOf('export const aliases'));
  return [...body.matchAll(/^\s*'(@openmig\/[^']+)'\s*:/gm)].map((m) => m[1]);
}

/** Every app that has its own vitest config. */
function appConfigs(): string[] {
  return readdirSync(join(ROOT, 'apps'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join('apps', e.name, 'vitest.config.ts'))
    .filter((p) => existsSync(join(ROOT, p)));
}

describe('vitest alias map', () => {
  it('is declared in exactly one place', () => {
    expect(existsSync(join(ROOT, SHARED))).toBe(true);
    expect(sharedAliasKeysInOrder().length).toBeGreaterThan(5);
  });

  it('lists every subpath BEFORE the bare specifier that prefixes it', () => {
    const keys = sharedAliasKeysInOrder();
    const offenders: string[] = [];

    keys.forEach((key, i) => {
      if (key.includes('/', '@openmig/'.length)) return; // this one IS a subpath
      const swallowed = keys.slice(i + 1).filter((later) => later.startsWith(`${key}/`));
      swallowed.forEach((later) => offenders.push(`'${key}' (position ${i}) swallows '${later}'`));
    });

    expect(
      offenders,
      `A bare alias listed above its own subpaths captures them as a prefix match, ` +
        `rewriting e.g. '@openmig/core/secrets' to '<root>/packages/core/src/index.ts/secrets'. ` +
        `Move the subpath entries above the bare one.`,
    ).toEqual([]);
  });

  it('every subpath target is a real file, not a directory path built by accident', () => {
    const src = readFileSync(join(ROOT, SHARED), 'utf8');
    const targets = [...src.matchAll(/'(@openmig\/[^']+)':\s*resolve\(rootDir,\s*'([^']+)'\)/g)];
    expect(targets.length).toBeGreaterThan(5);

    const missing = targets
      .filter(([, , rel]) => !existsSync(join(ROOT, rel)))
      .map(([, key, rel]) => `${key} -> ${rel}`);

    expect(missing, 'An alias pointing at a file that does not exist fails at import time, not here.').toEqual([]);
  });
});

describe('per-app vitest configs', () => {
  const configs = appConfigs();

  it('there is at least one to check', () => {
    expect(configs.length).toBeGreaterThan(0);
  });

  configs.forEach((rel) => {
    it(`${rel} imports the shared map instead of restating it`, () => {
      const src = readFileSync(join(ROOT, rel), 'utf8');

      expect(
        /from\s+'(\.\.\/)+vitest\.aliases(\.ts)?'/.test(src),
        `${rel} must import { aliases } from the repo-root vitest.aliases.ts.`,
      ).toBe(true);

      // A local `'@openmig/x': resolve(...)` entry is the exact shape that drifted.
      const localEntries = [...src.matchAll(/'(@openmig\/[^']+)'\s*:\s*resolve\(/g)].map((m) => m[1]);
      expect(
        localEntries,
        `${rel} declares its own alias targets. That is how four copies of this map ` +
          `drifted apart and left three apps unable to run their own tests.`,
      ).toEqual([]);
    });
  });
});

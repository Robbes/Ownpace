// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE VERSION NUMBER, IN ONE FILE.
 *
 * The build stamp now appears in three places — the app's sidebar, the public
 * site's footer, and `GET /version` — and every one of them must read the
 * SAME source: the monorepo root `package.json`. A second copy is not a
 * cosmetic problem. This repository has now spent two separate days on values
 * kept in more than one place:
 *
 *   - Trigger.dev's version across four files, where dependabot moved one and
 *     the managed gate died at the next bring-up (0018 T0 / 0099).
 *   - `.env` in two checkouts describing one stack, where the `zitadel` role's
 *     password matched one copy and the bring-up presented the other (0099).
 *
 * A version the UI hardcodes would fail the same way and worse: it would be
 * WRONG rather than absent, on a line whose only job is to be trusted when
 * somebody asks what is running.
 *
 * The commit is the other half. It cannot come from a file — git is not
 * present in an image build — so it is handed in as `GIT_SHA`, and every image
 * that BUILDS something which displays it has to accept and forward that
 * argument. Miss one and the stamp silently loses its most useful half on
 * exactly one edition.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const rootVersion = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

/**
 * Source with comments blanked out.
 *
 * The SECOND guard today to need this, which is itself the lesson: a scanner
 * that cannot tell an example from a value flags its own explanation. This one
 * caught `site/build.mjs` on its first run — for the doc comment describing
 * what the stamp looks like, which naturally used today's real version.
 * (`an-integration-test-is-handed-its-database.unit.test.ts` hit the identical
 * thing this morning.)
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', 'dist-selfhost', 'build', '.git', 'coverage'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, acc);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe('the version is read, never retyped', () => {
  it('has a version at the root to read', () => {
    expect(rootVersion, 'the root package.json has no version').toBeTruthy();
    expect(rootVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('appears as a literal nowhere in the app or the site', () => {
    // The exact current version, searched for as a string. Precise rather than
    // clever: a semver-shaped regex would trip over every unrelated dependency
    // pin and teach people to work around it. This catches the one thing that
    // actually goes wrong — somebody copying today's number into a component.
    const offenders: string[] = [];
    for (const file of [...sources(join(ROOT, 'apps/web')), ...sources(join(ROOT, 'site'))]) {
      // A test may legitimately assert on a version string it constructs.
      if (/\.(test|unit\.test)\.(ts|tsx)$/.test(file)) continue;
      const code = withoutComments(readFileSync(file, 'utf8'));
      if (code.includes(rootVersion)) offenders.push(relative(ROOT, file));
    }
    expect(
      offenders,
      `these hardcode ${rootVersion} instead of reading the root package.json`,
    ).toEqual([]);
  });

  it('the web bundle reads the root package.json at build time', () => {
    const vite = readFileSync(join(ROOT, 'apps/web/vite.config.ts'), 'utf8');
    expect(vite).toContain("'../../package.json'");
    expect(vite).toContain('VITE_VERSION');
  });

  it('the site reads it too, without importing a workspace package', () => {
    const build = readFileSync(join(ROOT, 'site/build.mjs'), 'utf8');
    expect(build).toContain("'..', 'package.json'");
    // site/ depends on no workspace package and no npm dependency, by design
    // (0086 T7 / ADR-0036). Reading one JSON does not change that; importing
    // @openmig/core to get a version would have.
    expect(build).not.toMatch(/from '@openmig\//);
  });
});

describe('the commit reaches every bundle that displays it', () => {
  const dockerfiles = [
    ['apps/web/Dockerfile', 'pnpm --filter @openmig/web build'],
    ['apps/selfhost/Dockerfile', 'pnpm --filter @openmig/web build:selfhost'],
  ] as const;

  it.each(dockerfiles)('%s takes GIT_SHA BEFORE it builds the bundle', (file, buildCmd) => {
    // Order is the whole point: an ARG declared after the RUN that consumes it
    // is not in scope for it, and the bundle ships unstamped while the
    // Dockerfile looks correct.
    const text = readFileSync(join(ROOT, file), 'utf8');
    const arg = text.indexOf('ARG GIT_SHA');
    const build = text.indexOf(buildCmd);

    expect(arg, `${file} never takes a GIT_SHA`).toBeGreaterThan(-1);
    expect(build, `${file} no longer runs ${buildCmd}`).toBeGreaterThan(-1);
    expect(arg, `${file} declares GIT_SHA after the build that needs it`).toBeLessThan(build);
  });

  it('managed.yml passes GIT_SHA to every service it builds', () => {
    const compose = readFileSync(join(ROOT, 'deploy/compose/managed.yml'), 'utf8');
    // Both api and web build from source here, and both display or serve a
    // build identity. One of them left out is the silent half-stamp.
    const passes = [...compose.matchAll(/GIT_SHA:\s*\$\{GIT_SHA/g)];
    expect(passes.length, 'a service that builds does not receive GIT_SHA').toBeGreaterThanOrEqual(2);
  });

  it('an unstamped build shows nothing rather than a placeholder', () => {
    // `unknown` and `0.0.0` are the tempting fallbacks and both are worse than
    // silence: they read as answers. The server-side buildIdentity() still
    // answers `unknown` for its own callers, which is why shortCommit() treats
    // that word as "no answer" rather than rendering it.
    const vite = readFileSync(join(ROOT, 'apps/web/vite.config.ts'), 'utf8');
    expect(vite).not.toMatch(/VITE_COMMIT[^\n]*unknown/);

    const identity = readFileSync(join(ROOT, 'apps/web/src/services/build-identity.ts'), 'utf8');
    expect(identity).toContain("commit === 'unknown'");
  });
});

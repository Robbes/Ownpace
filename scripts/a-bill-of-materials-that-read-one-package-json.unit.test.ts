// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BILL OF MATERIALS THAT READ ONE PACKAGE.JSON: alpha.18's `bom.json` lacked 56 production packages the apps import, and nothing said so (workplan 0006 §Q).
 *
 * ## What happened
 *
 * Security Scan's "Generate CycloneDX SBOM" ran `cyclonedx-npm`, which walks
 * `npm ls` from the root `package.json`. This is a pnpm workspace, and the
 * root names 3 dependencies and no `workspaces`. So the SBOM every release
 * attaches listed 545 name@version pairs, lacked 56 packages the product runs
 * (`jose` in `apps/api/src/middleware/auth.ts`, `helmet` in
 * `apps/api/src/index.ts`, `pg-boss` in `packages/scheduler`, `axios`,
 * `@mollie/api-client`, `react-router` among them), and marked none of its 344
 * pairs of dev tooling as dev. An outside, read-only check found it (SBOM-1).
 * The release verify read only the format and the version, so every check
 * there was passed.
 *
 * ## What holds it now
 *
 * The step runs `pnpm sbom`, which reads every workspace project from the
 * lockfile. And `scripts/sbom-complete.mjs`, in the step right after it,
 * compares `bom.json` with pnpm's own production set (`pnpm ls -r --prod`),
 * read separately: every package in it must be a component, and none marked
 * `scope: excluded`. Four names the apps import must be in that set, so a
 * `pnpm ls` that answered nothing has nothing to pass on.
 *
 * ## What this test holds
 *
 * The check, over a fixture cut from a real `pnpm sbom` and `pnpm ls` of this
 * repository (three projects, the four names and what they pull in, three dev
 * packages, two of them in two versions): it passes as it is, and refuses each
 * production package by name when it is deleted, and when it is marked dev.
 * And the workflow: the step runs `pnpm sbom` and not `--lockfile-only`, and
 * the check runs on its `bom.json` before anything uploads it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANARIES, incompleteness, productionSet } from './sbom-complete.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'scripts', 'fixtures', 'sbom');
const WORKFLOW = '.github/workflows/security-scan.yml';

type Component = { name: string; group?: string; version: string; scope?: string };
type Bom = { bomFormat: string; metadata: { component: { name: string; version: string } }; components: Component[] };

const read = (file: string): unknown => JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
const bom = (): Bom => read('bom.json') as Bom;
const production = productionSet(read('pnpm-ls-prod.json') as object[]);
const keyOf = (c: Component): string => `${c.group ? `${c.group}/` : ''}${c.name}@${c.version}`;

describe('sbom-complete: every production package is in bom.json, and none marked dev', () => {
  it('reads the production set from pnpm ls, its own workspace packages left out', () => {
    expect(production).toEqual([
      'axios@1.21.1',
      'croner@11.0.1',
      'follow-redirects@1.16.2',
      'form-data@4.0.6',
      'helmet@8.3.0',
      'jose@6.2.18',
      'pg-boss@12.38.2',
      'proxy-from-env@2.1.0',
    ]);
    expect(production.some((p) => p.startsWith('@openmig/'))).toBe(false);
  });

  it('passes the fixture, whose dev packages are excluded and in two versions', () => {
    const fixture = bom();
    expect(incompleteness(fixture, production)).toEqual([]);
    const dev = fixture.components.filter((c) => c.scope === 'excluded').map(keyOf);
    expect(dev).toEqual(expect.arrayContaining(['magic-string@1.4.5', 'magic-string@1.4.3', 'ansi-styles@4.3.0', 'ansi-styles@5.2.0']));
  });

  it('refuses each production package by name when it is deleted', () => {
    for (const gone of production) {
      const fixture = bom();
      fixture.components = fixture.components.filter((c) => keyOf(c) !== gone);
      expect(incompleteness(fixture, production), gone).toEqual([`1 production packages missing from bom.json: ${gone}`]);
    }
  });

  it('refuses each production package by name when it is marked dev', () => {
    for (const dev of production) {
      const fixture = bom();
      for (const c of fixture.components) if (keyOf(c) === dev) c.scope = 'excluded';
      expect(incompleteness(fixture, production), dev).toEqual([`1 production packages marked excluded (dev) in bom.json: ${dev}`]);
    }
  });

  it('refuses another version of a package: the old BOM listed one of two', () => {
    const fixture = bom();
    for (const c of fixture.components) if (c.name === 'jose') c.version = '6.2.17';
    expect(incompleteness(fixture, production).join('\n')).toMatch(/missing from bom\.json: jose@6\.2\.18/);
  });

  it('refuses a production set without the four names, so an empty pnpm ls passes nothing', () => {
    expect(incompleteness(bom(), [])).toEqual([`the production set does not hold ${CANARIES.join(', ')}: pnpm ls was not read (0 packages)`]);
    expect(incompleteness(bom(), production.filter((p) => !p.startsWith('pg-boss@'))).join('\n')).toMatch(/does not hold pg-boss/);
    expect(incompleteness({ bomFormat: 'CycloneDX' }, production)).toEqual(['bom.json has no components']);
  });
});

describe(`${WORKFLOW} builds bom.json from the lockfile and checks it`, () => {
  const wf = readFileSync(join(ROOT, WORKFLOW), 'utf8');
  const generate = wf.indexOf('- name: Generate CycloneDX SBOM');
  const check = wf.indexOf('- name: The SBOM lists every production package');
  const upload = wf.indexOf('- name: Upload SBOM artifact');
  const step = (at: number): string => wf.slice(at, wf.indexOf('\n      - ', at + 1));

  it('runs pnpm sbom, with the licenses, and no longer the npm walk', () => {
    const run = step(generate)
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(run).toContain('if ! pnpm sbom --sbom-format cyclonedx --out bom.json; then');
    expect(run).not.toContain('--lockfile-only');
    expect(run).not.toContain('cyclonedx-npm');
  });

  it('checks the bom.json it wrote, before anything uploads it, and cannot be let off', () => {
    expect(generate).toBeGreaterThan(-1);
    expect(check, 'the completeness check must come right after the SBOM is written').toBeGreaterThan(generate);
    expect(wf.indexOf('\n      - ', generate + 1)).toBe(check - 7);
    expect(check).toBeLessThan(upload);
    expect(step(check)).toContain('run: node scripts/sbom-complete.mjs bom.json');
    expect(step(check)).not.toMatch(/continue-on-error/);
  });
});

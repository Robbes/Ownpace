#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE BILL OF MATERIALS LISTS WHAT THE PRODUCT RUNS: every package in pnpm's
 * production set is a component of `bom.json`, and none of them is marked
 * `scope: excluded` (workplan 0006 §Q).
 *
 * Until alpha.20 Security Scan built `bom.json` with `cyclonedx-npm`, which
 * walks `npm ls` from the root `package.json`. This repository is a pnpm
 * workspace and the root names 3 dependencies, so alpha.18's SBOM lacked 56
 * production packages the apps import (`jose`, `helmet`, `pg-boss`, `axios`
 * among them) and marked nothing as dev. Nothing said so: the release verify
 * reads only the format and the version.
 *
 * The production set is read from the lockfile by pnpm itself, separately
 * from the SBOM: `pnpm ls -r --prod --depth Infinity --json`, every
 * `name@version` under any of the workspace's projects, the workspace's own
 * `link:` packages left out (they are this product, not a dependency of it).
 * Four names the apps import must be in that set too, so a `pnpm ls` that
 * answered nothing cannot pass by having nothing to look for.
 *
 * Usage, from the repository (it runs `pnpm ls` there):
 *
 *   node scripts/sbom-complete.mjs bom.json
 *
 * Exits 0 with one line saying how many it found; exits 1 naming the first
 * packages missing or excluded.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Imported by the apps, and missing from alpha.18's SBOM. A production set without them was not read. */
export const CANARIES = ['jose', 'helmet', 'pg-boss', 'axios'];

/** A version pnpm gives a workspace package, or a local path: this product's own, not a dependency. */
const OWN = /^(link|workspace|file):/;

/** `name@version` for every package in the output of `pnpm ls -r --prod --depth Infinity --json`, sorted. */
export function productionSet(projects) {
  const found = new Set();
  const walk = (deps) => {
    for (const [name, dep] of Object.entries(deps ?? {})) {
      if (!OWN.test(dep.version ?? '')) found.add(`${name}@${dep.version}`);
      walk(dep.dependencies);
      walk(dep.optionalDependencies);
    }
  };
  for (const project of projects ?? []) {
    walk(project.dependencies);
    walk(project.optionalDependencies);
  }
  return [...found].sort();
}

/** `name@version` of a CycloneDX component, its npm scope (`group`) put back in front of the name. */
const keyOf = (c) => `${c.group ? `${c.group}/` : ''}${c.name}@${c.version}`;

/** The problems with `bom` against `production`: empty when every package is listed and none excluded. */
export function incompleteness(bom, production) {
  if (!Array.isArray(bom?.components)) return ['bom.json has no components'];
  const names = new Set(production.map((p) => p.slice(0, p.lastIndexOf('@'))));
  const unread = CANARIES.filter((c) => !names.has(c));
  if (unread.length > 0) {
    return [`the production set does not hold ${unread.join(', ')}: pnpm ls was not read (${production.length} packages)`];
  }
  const scopes = new Map(bom.components.map((c) => [keyOf(c), c.scope ?? 'required']));
  const missing = production.filter((p) => !scopes.has(p));
  const excluded = production.filter((p) => scopes.get(p) === 'excluded');
  const said = (what, list) => `${list.length} ${what}: ${list.slice(0, 10).join(', ')}${list.length > 10 ? ', …' : ''}`;
  return [
    ...(missing.length ? [said('production packages missing from bom.json', missing)] : []),
    ...(excluded.length ? [said('production packages marked excluded (dev) in bom.json', excluded)] : []),
  ];
}

/** The CLI: the exit status, with the count or the refusal printed. */
export function main(argv = process.argv.slice(2), out = console, root = REPO_ROOT) {
  const [file] = argv;
  if (!file) {
    out.error('usage: node scripts/sbom-complete.mjs <bom.json>');
    return 2;
  }
  const bom = JSON.parse(readFileSync(file, 'utf8'));
  const projects = JSON.parse(
    execFileSync('pnpm', ['ls', '-r', '--prod', '--depth', 'Infinity', '--json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  const production = productionSet(projects);
  const problems = incompleteness(bom, production);
  if (problems.length > 0) {
    for (const p of problems) out.error(`${file} is not complete: ${p}`);
    return 1;
  }
  out.log(`${file} lists all ${production.length} production packages, none excluded, of ${bom.components.length} components`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}

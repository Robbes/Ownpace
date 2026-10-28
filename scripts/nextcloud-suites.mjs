#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE INTEGRATION SUITES THAT TALK TO NEXTCLOUD, found by what they read
 * rather than listed (workplan 0119, Status of 2026-10-25).
 *
 * The second-major leg (`.github/workflows/nextcloud-second-major.yml`) runs
 * these and no others against the Nextcloud major the demo does not run yet.
 * A suite talks to Nextcloud when it reads one of the variables the global
 * setup exports for it (`process.env.NEXTCLOUD_WEBDAV_URL` and its siblings;
 * `vitest.global-setup.ts`). A list written into the workflow would miss the
 * next such suite and say nothing; this finds it, the way
 * `harness-exports-what-tests-guard-on.unit.test.ts` finds what the suites
 * wait for.
 *
 * Usage, from any directory (it finds the repository by its own location):
 *
 *   node scripts/nextcloud-suites.mjs
 *
 * Prints one path per line, relative to the repository and sorted, and exits
 * 0; exits 1 with a sentence when it finds none, because then the leg would
 * run nothing, or (with no file filter) every integration suite there is.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where integration suites live: beside their source (AGENTS.md, repo map). */
export const ROOTS = ['packages', 'apps'];

/** What a suite reads when it talks to Nextcloud. */
export const READS_NEXTCLOUD = /process\.env\.NEXTCLOUD_[A-Z0-9_]+/;

const SKIPPED = new Set(['node_modules', 'dist', '.git']);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.integration.test.ts')) out.push(full);
  }
  return out;
}

/** Every integration suite under `root` that reads a Nextcloud variable, relative, `/`-separated, sorted. */
export function nextcloudSuites(root = REPO_ROOT) {
  const found = [];
  for (const top of ROOTS) {
    for (const file of walk(join(root, top), [])) {
      if (READS_NEXTCLOUD.test(readFileSync(file, 'utf8'))) found.push(relative(root, file).split(sep).join('/'));
    }
  }
  return found.sort();
}

/** The CLI: the exit status, with the list or the refusal printed. */
export function main(root = REPO_ROOT, out = console) {
  const found = nextcloudSuites(root);
  if (found.length === 0) {
    out.error(
      `No *.integration.test.ts under ${ROOTS.join(' or ')} reads a NEXTCLOUD_ variable, so there is no ` +
        'suite to run against Nextcloud. Something moved the suites or renamed the variables ' +
        '(vitest.global-setup.ts exports them).',
    );
    return 1;
  }
  out.log(found.join('\n'));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}

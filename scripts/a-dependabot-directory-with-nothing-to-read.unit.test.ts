// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DEPENDABOT DIRECTORY WITH NOTHING TO READ: `.github/dependabot.yml` listed
 * `/deploy/compose` for its `docker-compose` updater from 2026-09-06, and in
 * seven weeks of Mondays it never moved one image there (workplan 0146 T8).
 *
 * Dependabot's compose fetcher (dependabot-docker_compose 0.401.0,
 * `lib/dependabot/docker_compose/file_fetcher.rb`) lists the directory's
 * direct children, keeps the files whose NAME matches
 * `/(docker-)?compose(-[\w]+)?(?>\.[\w-]+)?\.ya?ml/i`, unanchored, and raises
 * when none does. `managed.yml`, `www.yml`, `dev.yml`, `dev.ci.yml` and
 * `gatus.yaml` all miss. So the entry covered nothing and errored every week,
 * while 0119 §2.1 and the deployment doc said Dependabot kept those images
 * current: pgbouncer fell two releases and two CVEs behind, and mailpit,
 * gatus and the registry one each. A dozen ignores in the same block, for
 * images that only `managed.yml` runs, had never ignored anything either.
 *
 * So, for every `docker-compose` directory Dependabot is given:
 *
 *   - at least one direct child is a file whose name the fetcher reads;
 *   - every name the block ignores is an image in a file it reads.
 *
 * The images in `deploy/compose` are `scripts/idp-pin-watch.mjs`'s instead,
 * which reads those files itself; `a-pin-that-knows-it-is-behind` holds that
 * every image there is watched or listed with a reason. Renaming
 * `managed.yml` to fit the rule was weighed and rejected: over two hundred
 * files name it, and the Trigger.dev version script edits it in place.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEPENDABOT = '.github/dependabot.yml';

/**
 * Dependabot's FILENAME_REGEX, unanchored, as the fetcher applies it. Ruby's
 * atomic group `(?>\.[\w-]+)?` becomes a plain group: `[\w-]` cannot match
 * the `.` that has to follow it, so giving back characters never finds
 * another match, and the two accept the same names.
 */
const FILENAME_REGEX = /(docker-)?compose(-[\w]+)?(?:\.[\w-]+)?\.ya?ml/i;

/** The files the fetcher would read in `dir`: its direct children only, never a subdirectory's. */
function readable(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && FILENAME_REGEX.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

interface Update {
  'package-ecosystem': string;
  directory?: string;
  directories?: string[];
  ignore?: Array<{ 'dependency-name': string }>;
}
const updates = (parse(readFileSync(join(ROOT, DEPENDABOT), 'utf8')) as { updates: Update[] }).updates;
const compose = updates.filter((u) => u['package-ecosystem'] === 'docker-compose');
const directoriesOf = (u: Update) => u.directories ?? (u.directory ? [u.directory] : []);

/** The repository of every `image:` line in a compose file: `postgres`, `ghcr.io/twin/gatus`. */
function imagesIn(text: string): string[] {
  return [...text.matchAll(/^\s*image:\s*["']?([^\s"'#]+)/gm)].map((m) => {
    // `${VAR:-default}` resolved to its default, then the tag and digest dropped.
    const ref = m[1]!.replace(/\$\{[A-Z0-9_]+:-([^}]*)\}/g, '$1');
    return ref.replace(/@sha256:[0-9a-f]+$/, '').replace(/:[^/:]+$/, '');
  });
}

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('the rule this mirrors', () => {
  it("reads the names Dependabot's fetcher reads, and misses the ones it misses", () => {
    for (const name of ['compose.yml', 'docker-compose.yml', 'compose.pglite.yml', 'docker-compose-dev.yaml', 'Compose.YML']) {
      expect(FILENAME_REGEX.test(name), name).toBe(true);
    }
    for (const name of ['managed.yml', 'www.yml', 'dev.yml', 'dev.ci.yml', 'gatus.yaml', 'compose.json']) {
      expect(FILENAME_REGEX.test(name), name).toBe(false);
    }
  });

  it('looks at the directory itself and not below it, as the fetcher does', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dependabot-dir-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'compose.yml'), 'services: {}\n');
    writeFileSync(join(dir, 'managed.yml'), 'services: {}\n');
    expect(readable(dir)).toEqual([]);
    writeFileSync(join(dir, 'compose.override.yml'), 'services: {}\n');
    expect(readable(dir)).toEqual(['compose.override.yml']);
  });
});

describe(`${DEPENDABOT}, its docker-compose updater`, () => {
  it('is there, with at least one directory', () => {
    expect(compose).toHaveLength(1);
    expect(directoriesOf(compose[0]!).length).toBeGreaterThan(0);
  });

  it('lists only directories in which Dependabot finds a compose file to read', () => {
    const empty = directoriesOf(compose[0]!).filter((dir) => readable(join(ROOT, dir)).length === 0);
    expect(empty, 'Dependabot reads no file here and errors every week; the pin watch covers these').toEqual([]);
  });

  it('ignores only images that a file it reads runs', () => {
    const images = new Set(
      directoriesOf(compose[0]!).flatMap((dir) =>
        readable(join(ROOT, dir)).flatMap((name) => imagesIn(readFileSync(join(ROOT, dir, name), 'utf8'))),
      ),
    );
    expect(images.size, 'no image read at all: the reader above is broken').toBeGreaterThan(0);
    const names = (compose[0]!.ignore ?? []).map((i) => i['dependency-name']);
    expect(names.filter((name) => !images.has(name)), 'an ignore for an image Dependabot never reads ignores nothing').toEqual([]);
  });
});

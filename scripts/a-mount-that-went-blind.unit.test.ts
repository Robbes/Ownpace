// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE REPUBLISH THAT MADE THE SITE DISAPPEAR.
 *
 * `deploy/compose/www.yml` bind-mounts `site/dist` into nginx read-only, and
 * its header promised that re-publishing was the build command "and nothing
 * else — nginx serves from the mount, so no restart is needed."
 *
 * It was not. `site/build.mjs` started with
 *
 *     rmSync(DIST, { recursive: true, force: true });
 *     mkdirSync(DIST, { recursive: true });
 *
 * which replaces the directory and therefore its INODE. A bind mount resolves
 * to an inode when the container starts, so a running nginx goes on looking at
 * the old, now-unlinked directory. On the Spark, 2026-08-24:
 *
 *   19:49  "GET / HTTP/1.1" 200 11367        served fine
 *   20:20  (republish)
 *   20:20  directory index of "/usr/share/nginx/html/" is forbidden → 403
 *
 * `docker exec ownpace-www ls -la /usr/share/nginx/html` said `total 0` while
 * the host directory held every file, correctly written, the whole time. A 403
 * that reads like a permissions problem and is not one — the mount had simply
 * gone blind, and nothing on either side said so.
 *
 * The fix is not to document the restart. It is to make the promise true: clear
 * the CONTENTS, keep the directory. Which is a property this test can check for
 * real, with no container anywhere near it — an inode is an inode.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  statSync,
  fstatSync,
  openSync,
  closeSync,
  constants,
  existsSync,
  writeFileSync,
  readdirSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(REPO_ROOT, 'site/dist');

/** A build for the test environment: the coherent combination, no --public. */
function buildSite() {
  execFileSync('node', [join(REPO_ROOT, 'site', 'build.mjs')], {
    cwd: REPO_ROOT,
    env: { ...process.env, OWNPACE_APP_URL: 'https://app.ota.ownpace.eu' },
    stdio: 'pipe',
  });
}

/**
 * HOLD THE DIRECTORY OPEN ACROSS THE BUILD, exactly as the mount does.
 *
 * The first version of this simply compared `statSync(DIST).ino` before and
 * after — and it PASSED with the bug deliberately restored. Nothing held a
 * reference to the removed directory, so the filesystem handed its inode
 * NUMBER straight back to the `mkdir` that followed. A guard that cannot fail
 * is not a guard, and it was the same shape as the socket check that started
 * all of this: the right-looking question asked down a channel that could only
 * ever answer yes.
 *
 * An open directory fd is what a bind mount actually is. It pins the inode so
 * the number cannot be recycled, and `fstat` on the fd against `stat` on the
 * path is precisely the comparison nginx makes without knowing it.
 */
function inodeSurvives(work: () => void): { held: number; onDisk: number } {
  const fd = openSync(DIST, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    work();
    return { held: fstatSync(fd).ino, onDisk: statSync(DIST).ino };
  } finally {
    closeSync(fd);
  }
}

describe('a republish keeps the directory a running container is mounted on', () => {
  beforeAll(() => {
    buildSite();
  });

  it('leaves site/dist the same directory something already had open', () => {
    const { held, onDisk } = inodeSurvives(buildSite);
    expect(
      onDisk,
      'site/dist was replaced rather than emptied. Every container already\n' +
        'mounting it is now looking at an unlinked directory: `total 0` inside,\n' +
        'files present outside, 403 on every request. See this file’s header.',
    ).toBe(held);
  });

  it('survives several republishes, which is what publishing actually is', () => {
    const { held, onDisk } = inodeSurvives(() => {
      for (let i = 0; i < 3; i++) buildSite();
    });
    expect(onDisk).toBe(held);
  });

  it('still replaces the CONTENTS — this is not a no-op dressed as a fix', () => {
    // Keeping the inode is worthless if it also keeps yesterday's pages. A
    // stale file left behind is the other way to serve something nobody built.
    const stray = join(DIST, 'not-a-page-anybody-built.html');
    writeFileSync(stray, 'stale');
    buildSite();
    expect(existsSync(stray), 'a file from the previous build survived').toBe(false);
    expect(existsSync(join(DIST, 'index.html'))).toBe(true);
  });

  it('creates the directory when it genuinely is not there', () => {
    // A fresh clone has no site/dist at all, and the first publish must work.
    rmSync(DIST, { recursive: true, force: true });
    buildSite();
    expect(existsSync(join(DIST, 'index.html'))).toBe(true);
    // Everything above is measured against the new inode from here on, so the
    // suite is ordered with this case last on purpose.
    expect(readdirSync(DIST).length).toBeGreaterThan(0);
  });
});

describe('what www.yml promises about republishing is what the build does', () => {
  const wwwYml = join(REPO_ROOT, 'deploy/compose/www.yml');

  it('the header ties "no restart" to the reason it is true', () => {
    // The first version of this test simply forbade the phrase "no restart is
    // needed". Wrong: with the build emptying `dist`, the phrase is TRUE, and
    // banning a true sentence teaches nothing. What went wrong was a promise
    // floating free of its mechanism — so what is required is the mechanism
    // beside it, where somebody changing one sees the other.
    const header = readFileSync(wwwYml, 'utf8');
    expect(header).toMatch(/no restart/i);
    expect(header, 'the header promises no restart without saying what makes that true').toMatch(
      /EMPTIES `dist`/,
    );
    expect(header, 'nothing tells a reader what breaks it').toMatch(/INODE|inode/);
    expect(header, 'no way out when it does happen').toMatch(/--force-recreate/);
  });

  it('the build script empties rather than replaces, which is what makes it true', () => {
    const build = readFileSync(join(REPO_ROOT, 'site/build.mjs'), 'utf8');
    expect(build).toContain('emptyDist()');
    expect(
      build,
      'rmSync on DIST itself is back — that is the inode swap, whatever else changed',
    ).not.toMatch(/rmSync\(DIST,/);
  });
});

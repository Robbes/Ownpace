// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TASK IMAGE DATED 1970 (live's deploy of 2026-11-08; workplan 0132 T6, 0119 §3 item 13).
 *
 * After live's deploy of `v0.2.0-alpha.6`, the check of the tasks' runners
 * read the creation time of the image they ran: 1970-01-01, on the image the
 * deploy had just built (deployment `20261108.1`; 0132's Status, 2026-11-08).
 * It was not a stale image. Trigger.dev 4.8.3's CLI builds reproducibly: its
 * `dist/esm/deploy/buildImage.js` passes `SOURCE_DATE_EPOCH=0` to every build,
 * which dates the image's config at the epoch, and writes an image it exports
 * to push with `rewrite-timestamp=true`. So a task image's creation time says
 * nothing of when it was built, and a check that reads it as "old", or picks
 * "the newest" by it, is reading noise: the managed smoke picked its image by
 * `docker image inspect`'s Created until #1833 (2026-11-07), and asked the
 * wrong one in E2E (managed) run 42238877459.
 *
 * ## What this holds
 *
 * 1. The installed CLI, the one apps/worker pins, still passes both settings.
 *    A CLI move that drops either makes the date mean something again, and
 *    the guide's sentence untrue: this fails until both are read again.
 * 2. `docs/managed-bring-up.md` says it in step 5 of live's deploy, where the
 *    checks after it are read: the date, the two settings, and that a check
 *    compares tags or digests, never dates.
 * 3. The scripts that deploy live or check a deploy read no creation time,
 *    outside their comments. The smoke's own image block is held, in more
 *    detail, by `a-task-base-the-cli-builds-nothing-into`.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');
const CLI = join(REPO_ROOT, 'apps/worker/node_modules/trigger.dev');
const LESSON = '**A task image dated 1970-01-01 is not a stale image.**';
const SECTION = '### `ownpace-live`: a release tag, with `deploy-live.sh`';

/** The scripts that deploy live or check what a deploy left running. */
const CHECKS = [
  'deploy/compose/deploy-live.sh',
  'deploy/compose/deploy-tasks.sh',
  'deploy/compose/bootstrap-managed.sh',
  'deploy/compose/stand-up-live.sh',
  'deploy/compose/smoke-managed.sh',
  'deploy/compose/live-pass-check.sh',
];

describe('a task image is told by its tag or digest, never by its creation date', () => {
  it('the installed CLI builds with SOURCE_DATE_EPOCH=0, and pushes with rewrite-timestamp=true', () => {
    expect(existsSync(CLI), `${CLI} is missing: install the workspace (pnpm install)`).toBe(true);
    const version = (JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8')) as { version: string }).version;
    const pinned = (JSON.parse(read('apps/worker/package.json')) as { devDependencies?: Record<string, string> })
      .devDependencies?.['trigger.dev'];
    expect(version, 'the installed CLI is the one apps/worker pins').toBe(pinned);
    const build = readFileSync(realpathSync(join(CLI, 'dist/esm/deploy/buildImage.js')), 'utf8');
    // Once in the remote build's arguments, once in the local build's.
    expect(build.match(/`SOURCE_DATE_EPOCH=0`/g)?.length ?? 0, `trigger.dev ${version} no longer builds with SOURCE_DATE_EPOCH=0`).toBe(2);
    expect(build, `trigger.dev ${version} no longer writes a pushed image with rewrite-timestamp=true`).toContain(
      'outputOptions.push("rewrite-timestamp=true")',
    );
  });

  it("the guide says it where live's deploy is checked, with both settings and what a check compares", () => {
    const guide = read('docs/managed-bring-up.md');
    const section = guide.slice(Math.max(0, guide.indexOf(SECTION)));
    expect(section.length, `docs/managed-bring-up.md has no section "${SECTION}"`).toBeLessThan(guide.length);
    // Step 5, "Read what it printed, then lift the hold yourself": from its "5." to its "6.".
    const step = section.slice(section.search(/^5\. /m), section.search(/^6\. /m));
    const at = step.indexOf(LESSON);
    expect(at, "step 5 of live's deploy no longer says a task image dated 1970-01-01 is not stale").toBeGreaterThan(0);
    const paragraph = step.slice(at).replace(/\s+/g, ' ');
    expect(paragraph).toContain('`SOURCE_DATE_EPOCH=0`');
    expect(paragraph).toContain('`rewrite-timestamp=true`');
    expect(paragraph).toMatch(/by its tag or its digest/);
    expect(paragraph).toMatch(/never by a creation date/);
  });

  it.each(CHECKS)('%s reads no creation time, outside its comments', (rel) => {
    const code = read(rel)
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    expect(code, `${rel} reads a creation time: compare a tag or a digest instead`).not.toMatch(/\.Created\b|CreatedAt|\bCreated\b/);
  });
});

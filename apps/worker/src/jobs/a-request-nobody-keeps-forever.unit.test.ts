// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REQUEST NOBODY KEEPS FOREVER (workplan 0139 T6): the job half.
 *
 * `pruneDeclinedAccessRequests` deletes a request declined more than 30 days
 * ago; its own guard, in `packages/managed`, proves that against PGlite. This
 * file proves the nightly `managed-retention` task runs it, read from the
 * task's body as text, the way `a-tick-that-says-it-ran` does, because the body
 * needs a runner to execute. Its log line says how many, never who.
 *
 * It fails today: the task does not call it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Comments removed: a comment may name the call without making it. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const RUN = (() => {
  const whole = code(readFileSync(join(HERE, 'managed-retention.ts'), 'utf8'));
  const body = whole.indexOf("run: leavesAReference('managed-retention', async () => {");
  expect(body, 'the scheduled task body is no longer recognisable').toBeGreaterThan(-1);
  return whole.slice(body);
})();

describe('the nightly retention task', () => {
  it('deletes the declined requests that aged out', () => {
    expect(RUN).toMatch(/const (\w+) = await pruneDeclinedAccessRequests\(db, now\);/);
  });

  it('says how many, and never who', () => {
    const name = RUN.match(/const (\w+) = await pruneDeclinedAccessRequests\(/)?.[1];
    expect(name).toBeTruthy();
    const after = RUN.slice(RUN.indexOf(`const ${name} = await pruneDeclinedAccessRequests(`));
    const logged = after.match(/log\.info\(([\s\S]*?)\);/)?.[1] ?? '';
    const interpolated = [...logged.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]!.trim());
    expect(interpolated.length, 'the prune is not followed by its log line').toBeGreaterThan(0);
    for (const value of interpolated) {
      expect(value, 'the log line names more than the count and the date').toMatch(
        new RegExp(`^${name}\\.(deleted|cutoff\\.toISOString\\(\\))$`),
      );
    }
  });
});

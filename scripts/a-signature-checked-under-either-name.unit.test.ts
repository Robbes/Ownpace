// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Every documented `cosign verify` accepts the images signed under either of
 * the repository's names, and nothing else (ADR-0040).
 *
 * The repository was `Robbes/open-migrate` before it was `Robbes/Ownpace`, and
 * a keyless signature carries the workflow identity of the repository that
 * built the image. ADR-0040 says the documented identity regexp matches both.
 * It was written as `(open-migrate|Ownpace)` in four places, and the blanket
 * `open-migrate` → `ownpace` rename that followed turned three of them into
 * `(ownpace|Ownpace)`: one name in two spellings. The command a reader copied
 * then refused an image signed before the rename, and nothing went red. A
 * rename is exactly the edit that cannot see this, so a test reads the
 * patterns as cosign will.
 *
 * Not swept: `CHANGELOG.md`, whose `v0.1.0-rc.1` entry names the old identity
 * because that release was signed under it, and `docs/adr/history/`, which is
 * frozen.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The workflow identities a signature of ours can carry. */
const OURS = [
  'https://github.com/Robbes/open-migrate/.github/workflows/images.yml@refs/tags/v0.1.0-rc.1',
  'https://github.com/Robbes/Ownpace/.github/workflows/images.yml@refs/heads/main',
  'https://github.com/Robbes/Ownpace/.github/workflows/images.yml@refs/tags/v0.1.0',
];

/** Identities that must never verify as ours. */
const NOT_OURS = [
  'https://github.com/Robbes/Ownpace-fork/.github/workflows/images.yml@refs/heads/main',
  'https://github.com/someone/Ownpace/.github/workflows/images.yml@refs/heads/main',
  'https://evil.example/https://github.com/Robbes/Ownpace/.github/workflows/images.yml@refs/heads/main',
  'https://githubXcom/Robbes/Ownpace/.github/workflows/images.yml@refs/heads/main',
];

function documentedPatterns(): Array<{ file: string; pattern: string }> {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((f) => /\.(md|ya?ml|sh|mjs|ts)$/.test(f))
    .filter((f) => f !== 'CHANGELOG.md' && !f.startsWith('docs/adr/history/'))
    .filter((f) => f !== 'scripts/a-signature-checked-under-either-name.unit.test.ts');
  const found: Array<{ file: string; pattern: string }> = [];
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const m of text.matchAll(/--certificate-identity-regexp\s+'([^']+)'/g)) {
      found.push({ file, pattern: m[1]! });
    }
  }
  return found;
}

describe('a documented signature check accepts either of our names (ADR-0040)', () => {
  const patterns = documentedPatterns();

  it('finds the places that document one', () => {
    // The release notes, the release guide, the appliance README and the
    // deployment guide. Fewer means the sweep stopped reading them.
    expect(patterns.length).toBeGreaterThanOrEqual(4);
  });

  it.each(patterns.map((p) => [p.file, p.pattern]))('%s: accepts every identity of ours', (_file, pattern) => {
    const re = new RegExp(pattern);
    for (const identity of OURS) expect(re.test(identity), `${pattern} refuses ${identity}`).toBe(true);
  });

  it.each(patterns.map((p) => [p.file, p.pattern]))('%s: accepts no other repository', (_file, pattern) => {
    const re = new RegExp(pattern);
    for (const identity of NOT_OURS) expect(re.test(identity), `${pattern} accepts ${identity}`).toBe(false);
  });
});

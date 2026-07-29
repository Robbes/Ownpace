// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Product code logs through the logger, not through `console` directly.
 *
 * Replacing 422 call sites is a one-off; keeping them replaced is not. A single
 * `console.log` added later is invisible in review and silently un-levelled —
 * it prints during a 500k-item migration no matter what the operator asked for.
 *
 * So the rule is enforced rather than documented. Scoped to product source
 * only: tests, test harnesses, CLI entrypoints that legitimately print to
 * stdout as their OUTPUT rather than as logging, and standalone scripts are all
 * out of scope.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Packages whose source is product runtime code. */
const ROOTS = [
  'packages/core/src',
  'packages/ledger/src',
  'packages/connectors/src',
  'packages/engines/src',
  'packages/shared/src',
  'apps/api/src',
  'apps/worker/src',
  'apps/selfhost/src',
];

/**
 * `logger.ts` is the one place allowed to touch console — it IS the wrapper,
 * and its own misconfiguration warning has to print before a level exists.
 */
const ALLOWED = ['packages/shared/src/logger.ts'];

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsFilesUnder(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

describe('product code logs through the logger', () => {
  it('has no bare console.* calls outside the logger itself', () => {
    const repoRoot = resolve(__dirname, '../../..');
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of tsFilesUnder(join(repoRoot, root))) {
        const rel = file.slice(repoRoot.length + 1);
        if (ALLOWED.includes(rel)) continue;
        const src = readFileSync(file, 'utf8');
        src.split('\n').forEach((line, i) => {
          // Skip comments and anything inside a string — the encryption-key
          // error message legitimately quotes a `node -e "console.log(...)"`
          // command for the operator to run, and a blanket rewrite of that
          // would hand out advice that does not work.
          const code = line.replace(/\/\/.*$/, '');
          if (/^\s*\*/.test(line)) return;
          if (/(['"`])[^'"`]*console\.(log|warn|error|info|debug)\(/.test(code)) return;
          if (/\bconsole\.(log|warn|error|info|debug)\(/.test(code)) {
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }

    expect(
      offenders,
      `use \`log.info/warn/error/debug\` from @openmig/shared instead of console.*, ` +
        `so an operator can raise or lower detail with LOG_LEVEL:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('actually scans a meaningful number of files', () => {
    // Guards the guard. A path typo would make the check above pass by
    // examining nothing at all — the single most common way a lint-style test
    // becomes decorative.
    const repoRoot = resolve(__dirname, '../../..');
    const scanned = ROOTS.flatMap((r) => tsFilesUnder(join(repoRoot, r)));
    expect(scanned.length).toBeGreaterThan(100);
  });
});
